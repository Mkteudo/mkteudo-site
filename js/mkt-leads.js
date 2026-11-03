/* ══════════════════════════════════════════════════════════════════════
   MKT LEADS — módulo central de captura e qualificação
   Mkteúdo Comunicação · www.mkteudo.com.br
   ──────────────────────────────────────────────────────────────────────
   Um único arquivo cuida de tudo que os formulários do site precisam:

     1. Sessão        — identificador próprio, 1ª parte, 90 dias
     2. Atribuição    — UTMs de primeiro e último toque + referenciador
     3. Pontuação     — motor de ICP configurável (PESOS, logo abaixo)
     4. Eventos       — dataLayer para GTM / GA4 / Meta
     5. Entrega       — POST para a planilha, com fila de retentativa
     6. Turnstile     — anti-spam da Cloudflare

   PARA LIGAR A PLANILHA: preencha ENDPOINT com a URL /exec do Apps
   Script. Enquanto estiver vazio, tudo funciona (eventos, pontuação,
   RD Station) e os envios ficam enfileirados no navegador do visitante
   até a URL existir — nada é perdido silenciosamente.
   ══════════════════════════════════════════════════════════════════════ */
(function (window, document) {
  'use strict';

  var CONFIG = {
    /* URL /exec da implantação do Apps Script. Vazio = fila local. */
    ENDPOINT: 'https://script.google.com/macros/s/AKfycbxj4Ff3pKi4AlKMqMHW2WKfTtSdokS7a62E4E7JZ3b0hZt-Tedbi41H1SRJ_pPO5Cbrng/exec',
    /* Chave pública do Cloudflare Turnstile (pode ficar no código). */
    TURNSTILE_SITE_KEY: '0x4AAAAAAFrUQu2VfFUGikMh',
    /* Dias que o identificador de sessão sobrevive. */
    SESSAO_DIAS: 90,
    /* Tempo máximo esperando a planilha responder. */
    TIMEOUT_MS: 9000,
    DEBUG: /[?&]mktdebug=1/.test(window.location.search)
  };

  /* ────────────────────────── armazenamento ────────────────────────── */
  function ler(chave) {
    try { return window.localStorage.getItem(chave); } catch (e) { return null; }
  }
  function gravar(chave, valor) {
    try { window.localStorage.setItem(chave, valor); return true; }
    catch (e) { return false; }
  }
  function log() {
    if (CONFIG.DEBUG && window.console) {
      console.log.apply(console, ['%c[mkt]', 'color:#9428e4;font-weight:600'].concat([].slice.call(arguments)));
    }
  }

  /* ──────────────────────────── 1. SESSÃO ───────────────────────────
     Identificador aleatório, gerado e guardado no navegador do
     visitante. Não é rastreamento entre sites: serve só para costurar
     as respostas da mesma pessoa numa única linha da planilha,
     enquanto ela avança pelos passos. */
  function novoId() {
    var r = '';
    try {
      var b = new Uint8Array(9);
      (window.crypto || window.msCrypto).getRandomValues(b);
      for (var i = 0; i < b.length; i++) r += ('0' + b[i].toString(16)).slice(-2);
    } catch (e) {
      r = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 10);
    }
    return 's-' + Date.now().toString(36) + '-' + r;
  }

  function sessao() {
    var bruto = ler('mkt_sessao');
    if (bruto) {
      try {
        var o = JSON.parse(bruto);
        var idade = (Date.now() - o.criada) / 86400000;
        if (o.id && idade < CONFIG.SESSAO_DIAS) return o.id;
      } catch (e) { /* formato inválido: recria abaixo */ }
    }
    var id = novoId();
    gravar('mkt_sessao', JSON.stringify({ id: id, criada: Date.now() }));
    return id;
  }

  /* ─────────────────────────── 2. ATRIBUIÇÃO ─────────────────────────
     Primeiro toque = como a pessoa descobriu a Mkteúdo (nunca muda).
     Último toque   = o que a trouxe nesta visita.
     Os dois importam: o primeiro diz onde investir para gerar demanda,
     o último diz o que fecha. Guardar só um dos dois é perder metade
     da resposta. */
  var CAMPOS_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];

  function utmsDaUrl() {
    var p = new URLSearchParams(window.location.search), out = {}, achou = false;
    CAMPOS_UTM.forEach(function (c) {
      var v = p.get(c);
      if (v) { out[c] = v.slice(0, 120); achou = true; }
    });
    return achou ? out : null;
  }

  function classificaReferenciador() {
    var ref = document.referrer || '';
    if (!ref) return { utm_source: 'direto', utm_medium: 'nenhum' };
    try {
      var host = new URL(ref).hostname.replace(/^www\./, '');
      if (host === window.location.hostname.replace(/^www\./, '')) return null; /* navegação interna */
      var buscadores = /^(google|bing|duckduckgo|yahoo|ecosia|brave|search\.)/;
      var sociais = /^(instagram|facebook|l\.facebook|lm\.facebook|linkedin|lnkd|t\.co|x|twitter|youtube|tiktok|wa\.me|api\.whatsapp)/;
      return {
        utm_source: host,
        utm_medium: buscadores.test(host) ? 'busca_organica'
                  : sociais.test(host) ? 'social_organico'
                  : 'referencia'
      };
    } catch (e) { return { utm_source: 'desconhecido', utm_medium: 'referencia' }; }
  }

  function atribuicao() {
    var agora = utmsDaUrl() || classificaReferenciador();

    /* primeiro toque: grava uma vez e nunca sobrescreve */
    var primeiro = null;
    try { primeiro = JSON.parse(ler('mkt_primeiro_toque') || 'null'); } catch (e) {}
    if (!primeiro && agora) {
      primeiro = { dados: agora, em: new Date().toISOString(), pagina: window.location.pathname };
      gravar('mkt_primeiro_toque', JSON.stringify(primeiro));
    }

    /* último toque: atualiza sempre que houver sinal novo */
    var ultimo = null;
    try { ultimo = JSON.parse(ler('mkt_ultimo_toque') || 'null'); } catch (e) {}
    if (agora) {
      ultimo = { dados: agora, em: new Date().toISOString() };
      gravar('mkt_ultimo_toque', JSON.stringify(ultimo));
    }

    var p = (primeiro && primeiro.dados) || {};
    var u = (ultimo && ultimo.dados) || p;
    return {
      utm_source: u.utm_source || '', utm_medium: u.utm_medium || '',
      utm_campaign: u.utm_campaign || '', utm_content: u.utm_content || '',
      utm_term: u.utm_term || '', gclid: u.gclid || '', fbclid: u.fbclid || '',
      primeiro_toque: [p.utm_source || '', p.utm_medium || '', p.utm_campaign || ''].filter(Boolean).join(' / '),
      primeiro_toque_em: (primeiro && primeiro.em) || '',
      visitas: contaVisita()
    };
  }

  function contaVisita() {
    var n = parseInt(ler('mkt_visitas') || '0', 10) || 0;
    if (!window.__mktVisitaContada) {
      window.__mktVisitaContada = true;
      n += 1; gravar('mkt_visitas', String(n));
    }
    return n;
  }

  /* ──────────────────────────── contexto ───────────────────────────── */
  function contexto() {
    var a = atribuicao();
    a.sessao_id = sessao();
    a.pagina = window.location.pathname + window.location.hash;
    a.dispositivo = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
    a.enviado_em = new Date().toISOString();
    return a;
  }

  /* ─────────────────────── 3. MOTOR DE PONTUAÇÃO ─────────────────────
     Felipe pediu, textualmente: "quero empresa e pessoa com poder de
     decisão grande". Por isso o modelo tem DUAS partes:

       · soma  — 100 pontos distribuídos pelos critérios abaixo
       · porta — para ser ICP-A não basta somar: a pessoa precisa ter
                 poder de decisão E a empresa precisa ter porte.

     A porta existe porque um modelo só somativo deixaria um analista
     de uma empresa grande, com verba alta, chegar ao topo da fila —
     e esse lead não decide nada. A soma mede interesse; a porta mede
     se vale a reunião. */
  var PESOS = {
    nivel_decisao: {            /* 30 — maior peso do modelo */
      'Sócio / Proprietário': 30, 'CEO / Presidente': 30,
      'Diretor(a)': 26, 'Gerente': 16,
      'Coordenador(a) / Supervisor(a)': 9,
      'Analista / Assistente': 3, 'Outro': 5
    },
    faturamento: {              /* 22 — porte real da empresa */
      'Acima de R$1 milhão': 22, 'R$500 mil–1 milhão': 18,
      'R$200–500 mil': 14, 'R$50–200 mil': 8, 'Até R$50 mil': 2,
      'Prefiro não informar': 6
    },
    colaboradores: {            /* 8 — confirma o porte */
      '+100': 8, '51–100': 7, '21–50': 5, '6–20': 3, '1–5': 1
    },
    investimento: {             /* 20 — verba disponível */
      '+R$10 mil': 20, 'R$5–10 mil': 15, 'R$2–5 mil': 9,
      'Até R$2 mil': 3, 'Ainda não sei': 7
    },
    prazo: {                    /* 12 — urgência */
      'Imediato': 12, '30 dias': 10, '60–90 dias': 6,
      'Só estou pesquisando': 1
    },
    investe_hoje: {             /* 8 — maturidade */
      'Sim, com agência': 8, 'Sim, internamente': 6, 'Não': 3
    }
  };

  var PORTA_ICP_A = { nivel_decisao: 26, porte: 14 };  /* decisor + empresa média/grande */

  function pontuar(d) {
    d = d || {};
    var total = 0, detalhe = {};
    Object.keys(PESOS).forEach(function (campo) {
      var p = PESOS[campo][d[campo]] || 0;
      detalhe[campo] = p; total += p;
    });

    var sinais = [];
    if (detalhe.nivel_decisao >= PORTA_ICP_A.nivel_decisao) sinais.push('decisor');
    if (detalhe.faturamento >= PORTA_ICP_A.porte) sinais.push('porte_alto');
    if (detalhe.investimento >= 15) sinais.push('verba_alta');
    if (detalhe.prazo >= 10) sinais.push('urgente');
    /* já tem agência = oportunidade de substituição, conversa diferente */
    if (d.investe_hoje === 'Sim, com agência') sinais.push('troca_de_agencia');
    if (d.investe_hoje === 'Não') sinais.push('primeira_vez');
    if (detalhe.investimento <= 3 && detalhe.investimento > 0) sinais.push('verba_baixa');
    if (d.prazo === 'Só estou pesquisando') sinais.push('pesquisando');

    var passaPorta = detalhe.nivel_decisao >= PORTA_ICP_A.nivel_decisao
                  && detalhe.faturamento   >= PORTA_ICP_A.porte;

    var tier;
    if (total >= 70 && passaPorta)      tier = 'ICP-A';
    else if (total >= 70)               tier = 'ICP-B';   /* soma alta, sem a porta */
    else if (total >= 50)               tier = 'ICP-B';
    else if (total >= 30)               tier = 'ICP-C';
    else                                tier = 'Fora do ICP';

    log('pontuação', total, tier, sinais, detalhe);
    return { score: total, tier: tier, sinais: sinais, detalhe: detalhe };
  }

  /* ───────────────────────────── 4. EVENTOS ─────────────────────────
     Nada de dado pessoal no dataLayer: o GA4 proíbe e o Meta também.
     Vai só o que é categoria — faixa, nível, pontuação, sinais. */
  function push(evento, extra) {
    window.dataLayer = window.dataLayer || [];
    var payload = { event: evento };
    if (extra) Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
    window.dataLayer.push(payload);
    log('evento →', evento, extra || '');
    return payload;
  }

  /* Dispara a família de eventos de um lead qualificado. */
  function eventosDeLead(origem, dados, p) {
    var base = {
      form_origem: origem,
      lead_score: p.score,
      lead_tier: p.tier,
      lead_sinais: p.sinais.join(','),
      lead_nivel_decisao: dados.nivel_decisao || '',
      lead_area: dados.area || '',
      lead_setor: dados.setor || '',
      lead_faturamento: dados.faturamento || '',
      lead_investimento: dados.investimento || '',
      lead_prazo: dados.prazo || '',
      lead_visitas: dados.visitas || 1
    };

    /* evento padrão — é o que o GA4 entende nativamente */
    push('generate_lead', base);

    /* eventos de qualificação — para públicos e lances no Ads/Meta */
    if (p.tier === 'ICP-A') push('lead_icp_a', base);
    if (p.sinais.indexOf('decisor') > -1) push('lead_decisor', base);
    if (p.sinais.indexOf('verba_alta') > -1) push('lead_verba_alta', base);
    if (p.sinais.indexOf('urgente') > -1) push('lead_urgente', base);
    if (p.sinais.indexOf('troca_de_agencia') > -1) push('lead_troca_agencia', base);

    return base;
  }

  /* ──────────────────────── 5. ENTREGA + FILA ────────────────────────
     Regra: nenhum lead morre em silêncio. Se o POST falhar — endpoint
     vazio, rede caída, planilha fora do ar — o envio entra numa fila
     no navegador e é retentado na próxima página que a pessoa abrir.
     O visitante nunca vê erro: ele fez a parte dele. */
  var FILA = 'mkt_fila_envios';

  function enfileirar(payload) {
    var fila = [];
    try { fila = JSON.parse(ler(FILA) || '[]'); } catch (e) {}
    fila.push({ payload: payload, tentativas: 0, em: Date.now() });
    if (fila.length > 25) fila = fila.slice(-25);   /* não encher o disco de ninguém */
    gravar(FILA, JSON.stringify(fila));
    log('enfileirado (total ' + fila.length + ')');
  }

  function postar(payload) {
    if (!CONFIG.ENDPOINT) return Promise.reject(new Error('endpoint-vazio'));

    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS) : null;

    /* text/plain de propósito: evita a verificação prévia de CORS,
       que o Apps Script não sabe responder. */
    return fetch(CONFIG.ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
      keepalive: true
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('http-' + r.status);
      return r.json().catch(function () { return { ok: true }; });
    });
  }

  function enviar(payload) {
    return postar(payload)
      .then(function (r) { log('entregue', r); return { ok: true, resposta: r }; })
      .catch(function (e) {
        log('falhou (' + e.message + ') — enfileirando');
        enfileirar(payload);
        return { ok: false, erro: e.message, enfileirado: true };
      });
  }

  function drenarFila() {
    if (!CONFIG.ENDPOINT) return;
    var fila = [];
    try { fila = JSON.parse(ler(FILA) || '[]'); } catch (e) { return; }
    if (!fila.length) return;
    log('drenando fila:', fila.length);

    var pendentes = [];
    var passos = fila.map(function (item) {
      return postar(item.payload)
        .then(function () { log('reenviado com sucesso'); })
        .catch(function () {
          item.tentativas += 1;
          if (item.tentativas < 10) pendentes.push(item);
        });
    });
    Promise.all(passos).then(function () {
      gravar(FILA, JSON.stringify(pendentes));
      log('fila agora:', pendentes.length);
    });
  }

  /* ─────────────────────────── 6. TURNSTILE ──────────────────────────
     Modo "managed": invisível para quase todo mundo, com um clique de
     fallback quando a Cloudflare desconfia. Escolhido em vez do
     reCAPTCHA por não plantar cookie de rastreamento entre sites —
     o que também simplifica o aviso de cookies. */
  function carregarTurnstile() {
    if (window.turnstile || document.getElementById('cf-turnstile-js')) return;
    var s = document.createElement('script');
    s.id = 'cf-turnstile-js';
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }

  function tokenTurnstile(formEl) {
    var campo = formEl && formEl.querySelector('[name="cf-turnstile-response"]');
    return campo ? campo.value : '';
  }

  /* No modo "managed" o Turnstile se resolve sozinho, mas leva 1 a 3
     segundos. Quem clica em enviar antes disso recebia um erro pedindo
     para "confirmar que não é um robô" — sem nada visível para clicar.
     Beco sem saída que custa lead. Agora a gente espera o token chegar,
     e só desiste depois do prazo: nesse caso o envio segue sem token e
     a planilha marca a linha como não verificada, em vez de perdê-la. */
  function esperarToken(formEl, msEspera) {
    return new Promise(function (resolve) {
      if (!window.turnstile) return resolve('');          /* não carregou */
      var jaTem = tokenTurnstile(formEl);
      if (jaTem) return resolve(jaTem);

      var limite = Date.now() + (msEspera || 8000);
      var timer = setInterval(function () {
        var t = tokenTurnstile(formEl);
        if (t)                { clearInterval(timer); resolve(t); }
        else if (Date.now() > limite) { clearInterval(timer); resolve(''); }
      }, 180);
    });
  }

  /* ───────────────────────── utilidades de form ─────────────────────── */
  function valores(formEl) {
    var out = {};
    new FormData(formEl).forEach(function (v, k) {
      if (k === 'cf-turnstile-response') return;
      if (typeof v !== 'string') return;
      out[k] = out[k] ? out[k] + '; ' + v.trim() : v.trim();
    });
    return out;
  }

  function emailValido(v) {
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test((v || '').trim());
  }

  /* Telefone brasileiro: 10 ou 11 dígitos depois de limpar. */
  function telefoneValido(v) {
    var d = (v || '').replace(/\D/g, '');
    return d.length >= 10 && d.length <= 13;
  }

  function mascaraTelefone(input) {
    if (!input) return;
    input.addEventListener('input', function () {
      var d = input.value.replace(/\D/g, '').slice(0, 11), s = d;
      if (d.length > 2)  s = '(' + d.slice(0, 2) + ') ' + d.slice(2);
      if (d.length > 7)  s = '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
      if (d.length > 10) s = '(' + d.slice(0, 2) + ') ' + d.slice(2, 3) + ' ' + d.slice(3, 7) + '-' + d.slice(7);
      input.value = s;
    });
  }

  /* Normaliza o site da empresa: a pessoa digita "empresa.com.br",
     "www.empresa.com.br" ou cola a URL inteira. Tudo vira host limpo,
     que é o que serve para pesquisar a empresa antes da reunião. */
  function normalizaSite(v) {
    v = (v || '').trim();
    if (!v) return '';
    v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? v.toLowerCase() : (v || '');
  }

  /* ──────────────────────────── exposição ──────────────────────────── */
  var MKT = {
    config: CONFIG,
    sessao: sessao,
    contexto: contexto,
    pontuar: pontuar,
    push: push,
    eventosDeLead: eventosDeLead,
    enviar: enviar,
    enfileirar: enfileirar,
    drenarFila: drenarFila,
    carregarTurnstile: carregarTurnstile,
    tokenTurnstile: tokenTurnstile,
    esperarToken: esperarToken,
    valores: valores,
    emailValido: emailValido,
    telefoneValido: telefoneValido,
    mascaraTelefone: mascaraTelefone,
    normalizaSite: normalizaSite,
    PESOS: PESOS
  };
  window.MKT = MKT;

  /* Na carga: fixa a sessão, registra atribuição e tenta esvaziar a fila. */

  /* ───────────────── 7. WHATSAPP: BOTÃO E MAPEAMENTO DO LEAD ─────────────────
     O receio é legítimo: WhatsApp aberto é lead que começa a conversa fora do
     funil, sem origem, sem campanha, sem registro. Aqui o clique não é um link
     solto — antes de abrir a conversa ele grava um registro com sessão,
     atribuição de primeiro e último toque, página e dispositivo, e carimba um
     código curto na mensagem. O código é o que liga a conversa no celular à
     linha na planilha. Quem chega pelo WhatsApp fica mapeado como quem chega
     pelo formulário; o que falta é só o nome, e esse a conversa dá.

     O evento whatsapp_click do dataLayer continua sendo disparado pelo handler
     que já existe no rodapé de cada página — por isso aqui não se empurra
     evento nenhum: empurrar de novo contaria o mesmo clique duas vezes no GA4. */
  var WA = {
    numero: '5516991402609',
    rotulo: 'Falar no WhatsApp'
  };

  /* Código curto e legível em voz alta: sem 0/O e 1/I, que o cliente lê errado. */
  function refCurto() {
    var alfabeto = 'ACDEFGHJKLMNPQRTUVWXY2345679';
    var semente = (sessao() + '|' + window.location.pathname);
    var h = 5381;
    for (var i = 0; i < semente.length; i++) h = ((h * 33) ^ semente.charCodeAt(i)) >>> 0;
    var out = '';
    for (var j = 0; j < 4; j++) { out += alfabeto[h % alfabeto.length]; h = Math.floor(h / alfabeto.length) + 7; }
    return out;
  }

  function linkWhatsapp() {
    var ref = refCurto();
    var pag = window.location.pathname === '/' ? 'a página inicial' : window.location.pathname;
    var msg = 'Olá! Vim pelo site da Mkteúdo (' + pag + '). Gostaria de conversar sobre marketing e vendas. [ref ' + ref + ']';
    return 'https://wa.me/' + WA.numero + '?text=' + encodeURIComponent(msg);
  }

  /* Um registro por sessão e por página: recliques não viram linha nova. */
  function registrarWhatsapp() {
    var chave = 'mkt_wa_' + refCurto();
    if (ler(chave)) { log('whatsapp já registrado nesta página'); return; }
    gravar(chave, '1');
    var p = contexto();
    p.etapa = 'whatsapp';
    p.origem_form = 'whatsapp';
    p.ref = refCurto();
    p.visitas = contaVisita();
    enviar(p);
    log('whatsapp registrado · ref', p.ref);
  }

  function montarBotaoWhatsapp() {
    if (document.querySelector('.wa-flut')) return;

    var css = document.createElement('style');
    css.id = 'mkt-wa-v1';
    css.textContent =
      '.wa-flut{position:fixed;right:18px;bottom:18px;z-index:9990;display:flex;align-items:center;gap:.55rem;' +
      'background:#25D366;color:#fff;padding:.7rem 1.05rem .7rem .85rem;border-radius:100px;' +
      'font:600 .9rem/1 var(--font-body,system-ui),sans-serif;text-decoration:none;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.22);transition:transform .25s,box-shadow .25s,bottom .25s}' +
      '.wa-flut:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(0,0,0,.28);text-decoration:none;color:#fff}' +
      '.wa-flut svg{width:21px;height:21px;flex:0 0 auto;fill:currentColor}' +
      '@media(max-width:560px){.wa-flut{right:14px;bottom:14px;padding:.72rem;gap:0}.wa-flut span{display:none}}' +
      '@media(prefers-reduced-motion:reduce){.wa-flut{transition:none}}';
    document.head.appendChild(css);

    var a = document.createElement('a');
    a.className = 'wa-flut';
    a.href = linkWhatsapp();
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('aria-label', WA.rotulo);
    a.dataset.linkLocation = 'flutuante';
    a.dataset.linkText = WA.rotulo;
    a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z"/><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.13h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.17 8.17 0 0 1-1.25-4.36c0-4.54 3.7-8.23 8.24-8.23a8.18 8.18 0 0 1 5.82 2.42 8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23z"/></svg>' +
                  '<span>' + WA.rotulo + '</span>';
    document.body.appendChild(a);

    /* O aviso de cookies é fixo no rodapé e tem z-index maior.
       Enquanto estiver na tela, o botão sobe para não ficar embaixo dele. */
    var aviso = document.querySelector('.mkt-cookie');
    function ajustar() {
      var visivel = aviso && !aviso.hasAttribute('hidden') && aviso.offsetHeight > 0;
      a.style.bottom = visivel ? (aviso.offsetHeight + 30) + 'px' : '';
    }
    if (aviso) {
      ajustar();
      new MutationObserver(ajustar).observe(aviso, { attributes: true, attributeFilter: ['hidden', 'style'] });
      window.addEventListener('resize', ajustar, { passive: true });
    }
  }

  /* Qualquer link de WhatsApp da página — o flutuante, o do rodapé ou um do
     meio do texto — grava o registro antes de abrir a conversa. */
  function ouvirCliquesWhatsapp() {
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest && ev.target.closest('a');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (href.indexOf('wa.me') === -1 && href.indexOf('api.whatsapp.com') === -1) return;
      try { registrarWhatsapp(); } catch (e) { log('falha ao registrar whatsapp', e.message); }
    }, true);
  }

  function whatsappIniciar() {
    try {
      ouvirCliquesWhatsapp();
      montarBotaoWhatsapp();
      /* O rodapé traz o número em HTML, para SEO local e para quem copia.
         O link ganha a mensagem com código aqui, no cliente. */
      Array.prototype.forEach.call(document.querySelectorAll('[data-wa-link]'), function (el) {
        el.href = linkWhatsapp();
      });
    } catch (e) { log('whatsapp: ' + e.message); }
  }

  function iniciar() {
    contexto();
    /* O script da Cloudflare precisa estar carregado ANTES do envio: no modo
       "managed" o token leva de 1 a 3 segundos para aparecer, e esperarToken
       desiste na hora se window.turnstile nao existe. carregarTurnstile estava
       definida e nunca era chamada — resultado: nenhum lead vinha com token e
       o anti-spam ficava inerte. Carrega so nas paginas que tem o widget. */
    if (document.querySelector('.cf-turnstile')) carregarTurnstile();
    whatsappIniciar();
    setTimeout(drenarFila, 1500);   /* depois da página pintar */
    log('pronto · sessão', sessao(), '· endpoint', CONFIG.ENDPOINT ? 'configurado' : 'VAZIO (fila local)');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else { iniciar(); }

})(window, document);
