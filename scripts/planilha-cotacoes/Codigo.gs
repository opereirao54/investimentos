/**
 * Appliquei — cotações da B3 pela função GOOGLEFINANCE.
 *
 * Por que existe: o Yahoo bloqueia (erro 429) pedidos vindos de servidores
 * de nuvem — Vercel e GitHub. O Google Sheets busca a cotação do lado do
 * Google, sem esse bloqueio. Este script vira um endereço (app da web) que o
 * servidor do Appliquei chama com a lista de códigos e recebe os preços.
 *
 * Instalação: docs/COTACOES-PLANILHA.md (5 passos, uns 10 minutos).
 *
 * Endereço: https://script.google.com/macros/s/…/exec?tickers=WEGE3,ITUB4&chave=SEGREDO
 * Resposta: { cotacoes: { WEGE3: { price, previousClose, changePct, name } }, geradoEm }
 */

// Troque pelo MESMO valor de COTACAO_PLANILHA_SEGREDO (Vercel e GitHub).
// Sem ele, qualquer pessoa com o endereço usaria a sua planilha.
var SEGREDO = 'TROQUE-ESTE-SEGREDO';

var MAX_TICKERS = 200;
var ABA = 'cotacoes';

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!SEGREDO || SEGREDO === 'TROQUE-ESTE-SEGREDO' || p.chave !== SEGREDO) {
    return json_({ error: 'nao_autorizado' });
  }
  var tickers = String(p.tickers || '')
    .toUpperCase()
    .split(',')
    .map(function (t) {
      return t.trim();
    })
    .filter(function (t) {
      return /^[A-Z0-9]{4}[0-9]{1,2}$/.test(t);
    })
    .slice(0, MAX_TICKERS);
  if (!tickers.length) return json_({ error: 'sem_tickers' });

  // Uma chamada por vez: as fórmulas moram numa aba só.
  var trava = LockService.getScriptLock();
  trava.waitLock(25000);
  try {
    var aba = abaDeTrabalho_();
    var valores = calcular_(aba, tickers, ',');
    // Planilha em português pode exigir ';' entre os argumentos: se a fórmula
    // nem foi entendida (#ERROR!/#NAME?), escreve de novo com ';'.
    var naoEntendeu = valores.some(function (l) {
      return /^#(ERROR|NAME|ERRO|NOME)/.test(String(l[1]));
    });
    if (naoEntendeu) valores = calcular_(aba, tickers, ';');

    var cotacoes = {};
    valores.forEach(function (l) {
      var preco = Number(l[1]);
      if (!(preco > 0)) return;
      var anterior = Number(l[2]);
      var pct = Number(l[3]);
      cotacoes[l[0]] = {
        price: preco,
        previousClose: anterior > 0 ? anterior : null,
        changePct: isFinite(pct) && l[3] !== '' ? pct : null,
        name: l[4] ? String(l[4]) : null,
      };
    });
    return json_({ cotacoes: cotacoes, geradoEm: new Date().toISOString() });
  } finally {
    trava.releaseLock();
  }
}

/** Escreve as fórmulas e espera o GOOGLEFINANCE responder (até 12 s). */
function calcular_(aba, tickers, sep) {
  aba.clearContents();
  var n = tickers.length;
  aba.getRange(1, 1, n, 1).setValues(
    tickers.map(function (t) {
      return [t];
    })
  );
  var formulas = tickers.map(function (t, i) {
    var ref = '"BVMF:"&A' + (i + 1);
    return ['price', 'closeyest', 'changepct', 'name'].map(function (atributo) {
      return '=IFERROR(GOOGLEFINANCE(' + ref + sep + '"' + atributo + '")' + sep + '"")';
    });
  });
  aba.getRange(1, 2, n, 4).setFormulas(formulas);
  var valores = [];
  for (var tentativa = 0; tentativa < 12; tentativa++) {
    SpreadsheetApp.flush();
    valores = aba.getRange(1, 1, n, 5).getValues();
    var carregando = valores.some(function (l) {
      return /^(Loading|Carregando)/.test(String(l[1]));
    });
    if (!carregando) break;
    Utilities.sleep(1000);
  }
  return valores;
}

function abaDeTrabalho_() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  return planilha.getSheetByName(ABA) || planilha.insertSheet(ABA);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** Para testar no editor: Executar → testar. O resultado aparece no registro. */
function testar() {
  var r = doGet({ parameter: { tickers: 'WEGE3,ITUB4,MXRF11', chave: SEGREDO } });
  Logger.log(r.getContent());
}
