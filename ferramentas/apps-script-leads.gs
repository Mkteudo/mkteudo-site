/* ══════════════════════════════════════════════════════════════════════
   LEADS DO SITE MKTEÚDO — recebedor da planilha
   ──────────────────────────────────────────────────────────────────────
   Recebe os envios do site (formulário de contato e calculadora),
   valida o anti-spam e grava UMA linha por pessoa, atualizando-a
   conforme ela avança. A costura é feita pelo sessao_id.

   ANTES DE USAR, uma única vez:
     1. Extensões → Apps Script, cole este arquivo por cima do antigo.
     2. Configurações do projeto → Propriedades do script →
        adicione TURNSTILE_SECRET com a chave secreta da Cloudflare.
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
  'Recebido em', 'Atualizado em', 'etapa', 'origem_form',
  'lead_score', 'lead_tier', 'lead_sinais',
  'nome', 'email', 'telefone', 'empresa', 'site', 'setor',
  'cidade', 'estado', 'nivel_decisao', 'area',
  'objetivo', 'desafio', 'colaboradores', 'faturamento',
  'investe_hoje', 'investimento', 'prazo', 'mensagem', 'origem',
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
  'sessao_id'
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
  aba.autoResizeColumns(1, 8);
  return 'Pronto: ' + COLS.length + ' colunas na aba "' + ABA + '".';
}

/* ───────────────────────── anti-spam ───────────────────────── */
function turnstileOk(token, ip) {
  const segredo = PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET');
  if (!segredo) return true;      /* ainda não configurado: não bloqueia */
  if (!token) return false;
  try {
    const r = UrlFetchApp.fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'post', payload: { secret: segredo, response: token, remoteip: ip || '' },
        muteHttpExceptions: true });
    return !!JSON.parse(r.getContentText()).success;
  } catch (e) { return true; }    /* Cloudflare fora do ar não derruba o lead */
}

/* ───────────────────────── recebimento ───────────────────────── */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (err) { return resposta({ ok: false, erro: 'ocupado' }); }

  try {
    const d = JSON.parse(e.postData.contents || '{}');

    /* Só exigimos o anti-spam nas etapas finais. As parciais vêm de
       quem já passou pelo formulário e travá-las só perderia dado. */
    const exigeToken = d.etapa === 'completo' || d.etapa === 'pediu_diagnostico';
    if (exigeToken && !turnstileOk(d.turnstile_token, d.ip)) {
      return resposta({ ok: false, erro: 'anti-spam' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(ABA) || ss.insertSheet(ABA);
    if (aba.getLastRow() === 0) configurar();

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
        return (v === undefined || v === null || v === '') ? atual[i] : v;
      });
      aba.getRange(linha, 1, 1, COLS.length).setValues([novo]);
      return resposta({ ok: true, acao: 'atualizada', linha: linha });
    }

    /* INSERE */
    const nova = COLS.map(function (c) {
      if (c === 'Recebido em' || c === 'Atualizado em') return agora;
      const v = d[c];
      return (v === undefined || v === null) ? '' : v;
    });
    aba.appendRow(nova);
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

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
