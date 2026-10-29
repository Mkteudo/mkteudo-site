/* ══════════════════════════════════════════════════════════════════════
   LEADS DO SITE MKTEÚDO — recebedor da planilha
   ──────────────────────────────────────────────────────────────────────
   Recebe os envios do site (formulário de contato e calculadora),
   valida o anti-spam e grava UMA linha por pessoa, atualizando-a
   conforme ela avança. A costura é feita pelo sessao_id.

   ANTES DE USAR, uma única vez:
     1. Extensões → Apps Script, cole este arquivo por cima do antigo.
     2. Configurações do projeto → Propriedades do script → adicione:
          TURNSTILE_SECRET   chave secreta da Cloudflare (anti-spam)
          EMAIL_NOTIFICACAO  para onde vai o aviso de conversão
                             (se vazio, vai para o dono do script)
          TRELLO_KEY         chave da API do Trello      (opcional)
          TRELLO_TOKEN       token da API do Trello      (opcional)
          TRELLO_LIST_ID     id da lista que recebe os leads (opcional)
        Sem as três do Trello o cartão simplesmente não é criado;
        o e-mail continua saindo.
     3. Rode configurar() uma vez (cria o cabeçalho).
     4. Implantar → Nova implantação → App da Web
          Executar como: Eu
          Quem tem acesso: Qualquer pessoa
        Copie a URL /exec e cole em ENDPOINT no arquivo
        /js/mkt-leads.js do site.
   ══════════════════════════════════════════════════════════════════════ */

const ABA = 'Leads';

/* A ordem aqui é a ordem das colunas. Para acrescentar um campo,
   basta incluir o nome na lista e rodar configurar() de novo. */
const COLS = [
  'Recebido em', 'Atualizado em', 'etapa', 'origem_form', 'verificacao',
  'lead_score', 'lead_tier', 'lead_sinais',
  'nome', 'email', 'telefone', 'empresa', 'site', 'setor',
  'cidade', 'estado', 'nivel_decisao', 'area',
  'objetivo', 'desafio', 'colaboradores', 'faturamento',
  'investe_hoje', 'investimento', 'prazo', 'mensagem', 'origem',
  /* mapeamento de terceirização */
  'frentes', 'frentes_qtd', 'frentes_descobertas', 'quem_faz', 'pessoas',
  'custo_pessoas', 'custo_ferramentas', 'custo_atual_estimado',
  'ja_tem', 'ja_tem_qtd', 'verba_midia',
  /* calculadora */
  'calc_modelo', 'calc_segmento', 'calc_ticket', 'calc_recorrencia',
  'calc_estrutura', 'calc_crm', 'calc_vendedores', 'calc_cap_por_vendedor',
  'calc_tipo_produto', 'calc_logistica', 'calc_perfil', 'calc_cenario',
  'calc_trafego', 'calc_leads', 'calc_mql', 'calc_sql', 'calc_vendas',
  'calc_meta_faturamento', 'calc_investimento_atual',
  'calc_receita_atual_mes', 'calc_receita_potencial',
  'calc_ganho_mes', 'calc_ganho_ano', 'calc_roi_midia',
  'calc_verba_sugerida', 'calc_cac_atual', 'calc_cac_otimizado',
  'calc_gargalos_qtd', 'calc_gargalos',
  /* atribuição e contexto */
  'pagina', 'dispositivo', 'visitas',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'fbclid', 'primeiro_toque', 'primeiro_toque_em',
  'sessao_id',
  /* controle de notificação */
  'notificado', 'trello_card'
];

/* ─────────────────────────── instalação ─────────────────────────── */
function configurar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let aba = ss.getSheetByName(ABA) || ss.insertSheet(ABA);

  aba.getRange(1, 1, 1, COLS.length).setValues([COLS])
     .setFontWeight('bold').setBackground('#4c0059').setFontColor('#ffffff');
  aba.setFrozenRows(1);
  aba.getRange(1, 1, 1, COLS.length).createFilter();

  /* destaque automático para os leads que merecem ligação hoje */
  const col = COLS.indexOf('lead_tier') + 1;
  const faixa = aba.getRange(2, 1, aba.getMaxRows() - 1, COLS.length);
  const letra = aba.getRange(1, col).getA1Notation().replace(/\d+/, '');
  aba.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().setRanges([faixa])
      .whenFormulaSatisfied('=$' + letra + '2="ICP-A"')
      .setBackground('#e9d5ff').setBold(true).build(),
    SpreadsheetApp.newConditionalFormatRule().setRanges([faixa])
      .whenFormulaSatisfied('=$' + letra + '2="ICP-B"')
      .setBackground('#f5ebff').build()
  ]);
  /* Formata tudo como texto. Sem isso, um valor como "+R$10 mil" é
     lido como fórmula pelo Planilhas e vira #ERROR! na célula. */
  aba.getRange(2, 1, Math.max(1, aba.getMaxRows() - 1), COLS.length)
     .setNumberFormat('@');

  aba.autoResizeColumns(1, 8);
  return 'Pronto: ' + COLS.length + ' colunas na aba "' + ABA + '".';
}

/* ───────────────────────── anti-spam ───────────────────────── */
/* Devolve um rótulo, não um booleano, porque os três casos são
   diferentes e só UM deles é motivo para recusar o lead:

     'ok'          token conferido pela Cloudflare
     'sem-token'   o widget não carregou (bloqueador de anúncios,
                   rede corporativa, JS falhou). É gente de verdade
                   na esmagadora maioria das vezes — recusar aqui
                   seria jogar fora lead bom. Grava e sinaliza.
     'falhou'      veio token e a Cloudflare reprovou. Isso sim é
                   sinal de forja: recusa.
*/
function turnstileOk(token, ip) {
  const segredo = PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET');
  if (!segredo) return 'sem-chave';
  if (!token)   return 'sem-token';
  try {
    const r = UrlFetchApp.fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'post', payload: { secret: segredo, response: token, remoteip: ip || '' },
        muteHttpExceptions: true });
    return JSON.parse(r.getContentText()).success ? 'ok' : 'falhou';
  } catch (e) { return 'cloudflare-fora'; }   /* indisponibilidade não derruba o lead */
}

/* ───────────────────────── recebimento ───────────────────────── */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (err) { return resposta({ ok: false, erro: 'ocupado' }); }

  try {
    const d = JSON.parse(e.postData.contents || '{}');

    /* Só exigimos o anti-spam nas etapas finais. As parciais vêm de
       quem já passou pelo formulário e travá-las só perderia dado. */
    const etapaFinal = d.etapa === 'completo' || d.etapa === 'pediu_diagnostico';
    if (etapaFinal) {
      const v = turnstileOk(d.turnstile_token, d.ip);
      if (v === 'falhou') return resposta({ ok: false, erro: 'anti-spam' });
      d.verificacao = v;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(ABA) || ss.insertSheet(ABA);

    /* O cabeçalho precisa bater com COLS. Se o código ganhou colunas
       novas e a planilha ficou com o cabeçalho antigo, os valores
       passam a cair embaixo do rótulo errado — foi o que aconteceu
       quando o mapeamento de terceirização acrescentou 11 campos.
       Aqui a planilha se conserta sozinha antes de gravar. */
    if (aba.getLastRow() === 0) {
      configurar();
    } else {
      const cab = aba.getRange(1, 1, 1, Math.max(aba.getLastColumn(), COLS.length))
                     .getValues()[0].slice(0, COLS.length);
      const bate = COLS.every(function (c, i) { return cab[i] === c; });
      if (!bate) configurar();
    }

    const agora = new Date();
    const colSessao = COLS.indexOf('sessao_id') + 1;
    let linha = 0;

    /* procura uma linha já aberta para esta sessão */
    if (d.sessao_id && aba.getLastRow() > 1) {
      const ids = aba.getRange(2, colSessao, aba.getLastRow() - 1, 1).getValues();
      for (let i = ids.length - 1; i >= 0; i--) {
        if (ids[i][0] === d.sessao_id) { linha = i + 2; break; }
      }
    }

    if (linha) {
      /* ATUALIZA: só sobrescreve o que veio preenchido, para um envio
         parcial não apagar o que já estava na linha. */
      const atual = aba.getRange(linha, 1, 1, COLS.length).getValues()[0];
      const novo = COLS.map(function (c, i) {
        if (c === 'Recebido em')   return atual[i];
        if (c === 'Atualizado em') return agora;
        const v = d[c];
        return (v === undefined || v === null || v === '') ? atual[i] : texto(v);
      });
      aba.getRange(linha, 1, 1, COLS.length).setValues([novo]);
      notificar(aba, linha, d);
      return resposta({ ok: true, acao: 'atualizada', linha: linha });
    }

    /* INSERE */
    const nova = COLS.map(function (c) {
      if (c === 'Recebido em' || c === 'Atualizado em') return agora;
      const v = d[c];
      return (v === undefined || v === null) ? '' : texto(v);
    });
    aba.appendRow(nova);
    notificar(aba, aba.getLastRow(), d);
    return resposta({ ok: true, acao: 'criada', linha: aba.getLastRow() });

  } catch (err) {
    return resposta({ ok: false, erro: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return resposta({ ok: true, servico: 'leads-mkteudo', colunas: COLS.length });
}

/* O Planilhas interpreta como fórmula qualquer texto começando por
   = + - @. Valores legítimos do formulário caem nessa armadilha
   ("+R$10 mil", "-"), então o prefixo vira apóstrofo, que o Planilhas
   usa justamente para forçar texto. */
function texto(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ══════════════════════════════════════════════════════════════════════
   NOTIFICAÇÃO DE CONVERSÃO
   ──────────────────────────────────────────────────────────────────────
   Dois momentos, nunca mais que isso por pessoa:
     1. "novo"      — assim que a linha ganha e-mail ou telefone.
                      É o aviso que permite ligar no mesmo dia.
     2. "completo"  — quando a pessoa termina o formulário ou fecha a
                      calculadora. Traz o resultado e o diagnóstico.
   O que já foi avisado fica marcado na coluna notificado, então um envio
   parcial a mais não vira um e-mail a mais.
   ══════════════════════════════════════════════════════════════════════ */

const ETAPAS_FINAIS = ['completo','pediu_diagnostico','mapeamento_completo',
                       'calc_resultado','calc_funil','resultado'];

function notificar(aba, linha, d) {
  try {
    const iNot = COLS.indexOf('notificado');
    const valores = aba.getRange(linha, 1, 1, COLS.length).getValues()[0];
    const feito = String(valores[iNot] || '');

    const temContato = !!(valores[COLS.indexOf('email')] || valores[COLS.indexOf('telefone')]);
    const final = ETAPAS_FINAIS.indexOf(String(d.etapa || '')) > -1;

    let momento = '';
    if (final && feito.indexOf('completo') < 0)   momento = 'completo';
    else if (temContato && feito.indexOf('novo') < 0) momento = 'novo';
    if (!momento) return;

    const r = retrato(valores);
    enviarEmail(momento, r, linha);
    const cardAtual = String(valores[COLS.indexOf('trello_card')] || '');
    const card = trello(momento, r, linha, cardAtual);

    aba.getRange(linha, iNot + 1).setValue((feito ? feito + ',' : '') + momento);
    if (card && card !== cardAtual) aba.getRange(linha, COLS.indexOf('trello_card') + 1).setValue(card);
  } catch (err) {
    console.error('notificar: ' + err);   /* nunca derruba a gravação do lead */
  }
}

/* Monta o retrato da pessoa: só o que ela preencheu, na ordem em que
   interessa para quem vai ligar. */
function retrato(v) {
  function g(c) { const i = COLS.indexOf(c); return i < 0 ? '' : String(v[i] == null ? '' : v[i]); }
  const campos = [];
  COLS.forEach(function (c) {
    if (c === 'notificado' || c === 'trello_card') return;
    const val = g(c);
    if (val !== '' && val !== 'null') campos.push([rotulo(c), val]);
  });
  return {
    nome: g('nome') || '(sem nome)',
    empresa: g('empresa'),
    email: g('email'),
    telefone: g('telefone'),
    tier: g('lead_tier'),
    score: g('lead_score'),
    origem: g('origem_form'),
    etapa: g('etapa'),
    campos: campos
  };
}

function rotulo(c) {
  const m = {
    'origem_form':'Formulário','lead_score':'Pontuação','lead_tier':'Classificação',
    'lead_sinais':'Sinais','nivel_decisao':'Nível de decisão','investe_hoje':'Já investe',
    'custo_atual_estimado':'Custo atual estimado (R$)','frentes_qtd':'Frentes pedidas',
    'frentes_descobertas':'Frentes descobertas','verba_midia':'Verba de mídia',
    'primeiro_toque':'Primeiro toque','primeiro_toque_em':'Primeiro toque em','sessao_id':'Sessão'
  };
  if (m[c]) return m[c];
  if (c.indexOf('calc_') === 0) return 'Calculadora · ' + c.slice(5).replace(/_/g, ' ');
  return c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ');
}

function enviarEmail(momento, r, linha) {
  const props = PropertiesService.getScriptProperties();
  const para = props.getProperty('EMAIL_NOTIFICACAO') || Session.getEffectiveUser().getEmail();
  if (!para) return;

  const marca = r.tier ? '[' + r.tier + (r.score ? ' · ' + r.score : '') + '] ' : '';
  const quem  = r.nome + (r.empresa ? ' — ' + r.empresa : '');
  const assunto = (momento === 'completo' ? 'Lead completo ' : 'Novo lead ') + marca + quem;

  const url = SpreadsheetApp.getActiveSpreadsheet().getUrl() + '#gid=' +
              SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA).getSheetId() +
              '&range=A' + linha;

  const linhas = r.campos.map(function (c) {
    return '<tr><td style="padding:6px 14px 6px 0;color:#6b6b6b;font-size:13px;white-space:nowrap;' +
           'vertical-align:top">' + esc(c[0]) + '</td>' +
           '<td style="padding:6px 0;font-size:14px;color:#0d0010">' + esc(c[1]) + '</td></tr>';
  }).join('');

  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px">' +
      '<div style="background:#0d0010;padding:22px 26px;border-radius:14px 14px 0 0">' +
        '<div style="color:#c18cff;font-size:11px;letter-spacing:.18em;text-transform:uppercase">' +
          (momento === 'completo' ? 'Formulário concluído' : 'Nova conversão no site') + '</div>' +
        '<div style="color:#fff;font-size:21px;font-weight:700;margin-top:6px">' + esc(quem) + '</div>' +
        (r.tier ? '<div style="display:inline-block;margin-top:10px;background:rgba(148,40,228,.25);' +
          'border:1px solid rgba(148,40,228,.5);color:#e9d5ff;border-radius:20px;padding:3px 12px;' +
          'font-size:12px">' + esc(r.tier) + (r.score ? ' · ' + esc(r.score) + ' pontos' : '') + '</div>' : '') +
      '</div>' +
      '<div style="border:1px solid #ebebeb;border-top:none;border-radius:0 0 14px 14px;padding:20px 26px">' +
        (r.telefone ? '<p style="margin:0 0 6px"><a href="https://wa.me/55' + r.telefone.replace(/\D/g,'') +
            '" style="color:#9428e4;font-weight:600;text-decoration:none">Chamar no WhatsApp</a>' +
            ' &nbsp;·&nbsp; ' + esc(r.telefone) + '</p>' : '') +
        (r.email ? '<p style="margin:0 0 16px"><a href="mailto:' + esc(r.email) +
            '" style="color:#9428e4;text-decoration:none">' + esc(r.email) + '</a></p>' : '') +
        '<table style="border-collapse:collapse;width:100%">' + linhas + '</table>' +
        '<p style="margin:20px 0 0"><a href="' + url + '" style="color:#9428e4;font-size:13px">' +
          'Abrir a linha na planilha</a></p>' +
      '</div></div>';

  MailApp.sendEmail({ to: para, subject: assunto, htmlBody: html,
                      name: 'Leads do site Mkteúdo' });
}

function trello(momento, r, linha, cardAtual) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('TRELLO_KEY');
  const tok = props.getProperty('TRELLO_TOKEN');
  const lista = props.getProperty('TRELLO_LIST_ID');
  if (!key || !tok || !lista) return cardAtual;   /* sem credencial, segue sem cartão */

  const titulo = (r.tier ? '[' + r.tier + '] ' : '') + r.nome + (r.empresa ? ' — ' + r.empresa : '');
  const url = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  let desc = '**' + (r.origem ? 'Formulário: ' + r.origem : 'Lead do site') + '**' +
             (r.etapa ? '  ·  etapa: ' + r.etapa : '') + '\n\n';
  if (r.telefone) desc += '📞 ' + r.telefone + '  ·  [WhatsApp](https://wa.me/55' + r.telefone.replace(/\D/g,'') + ')\n';
  if (r.email) desc += '✉️ ' + r.email + '\n';
  desc += '\n| Campo | Valor |\n| --- | --- |\n';
  r.campos.forEach(function (c) { desc += '| ' + c[0] + ' | ' + String(c[1]).replace(/\|/g,'\\|') + ' |\n'; });
  desc += '\n[Linha na planilha](' + url + ')';

  const base = 'https://api.trello.com/1/cards';
  const auth = 'key=' + encodeURIComponent(key) + '&token=' + encodeURIComponent(tok);
  const opc = { method: 'post', muteHttpExceptions: true,
                contentType: 'application/x-www-form-urlencoded' };

  if (cardAtual) {
    /* já existe: só atualiza a descrição com o que a pessoa completou */
    const res = UrlFetchApp.fetch(base + '/' + cardAtual + '?' + auth, {
      method: 'put', muteHttpExceptions: true,
      payload: { name: titulo, desc: desc }
    });
    return res.getResponseCode() === 200 ? cardAtual : cardAtual;
  }

  opc.payload = { idList: lista, name: titulo, desc: desc, pos: 'top' };
  const res = UrlFetchApp.fetch(base + '?' + auth, opc);
  if (res.getResponseCode() !== 200) {
    console.error('trello ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
    return cardAtual;
  }
  return JSON.parse(res.getContentText()).id;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* Roda uma vez para conferir que o e-mail e o Trello estão de pé. */
function testarNotificacao() {
  const r = { nome:'Teste de notificação', empresa:'Mkteúdo', email:'teste@mkteudo.com.br',
              telefone:'(16) 90000-0000', tier:'ICP-A', score:'93', origem:'teste', etapa:'completo',
              campos:[['Formulário','teste'],['Classificação','ICP-A'],['Pontuação','93']] };
  enviarEmail('novo', r, 2);
  const c = trello('novo', r, 2, '');
  console.log('e-mail enviado; cartão: ' + (c || 'nao configurado'));
}
