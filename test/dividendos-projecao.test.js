'use strict';

// Dividendos: de onde vêm, quem tem direito e quanto vem nos próximos 12 meses.
//
// O que ficou para trás e este arquivo segura:
//  - o celular não mostrava projeção nenhuma de proventos;
//  - a quantidade com direito era a da data do PAGAMENTO — quem comprava depois
//    da data-com "recebia" o que não tinha direito;
//  - JCP entrava bruto (cai na conta 85%, com 15% de IR na fonte);
//  - o relatório mensal lia op.data/op.qtd, campos que não existem, e mostrava
//    sempre R$ 0 de dividendos;
//  - os proventos vinham de proxies públicos no navegador, que caíam à toa.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const market = require(path.join(ROOT, 'api', 'market.js'));
const { mapYahooProventos, mapBrapiProventos, deduplicarProventos } = market.__test;

function carregar(historicoCompras) {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    historicoCompras,
    formatarMoeda: (v) => 'R$ ' + v.toFixed(2),
    Date,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
  };
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'web', 'appliquei-aba-dividendos.js'), 'utf8'),
    ctx
  );
  return ctx;
}

const ymd = (d) =>
  d.getFullYear() +
  '-' +
  String(d.getMonth() + 1).padStart(2, '0') +
  '-' +
  String(d.getDate()).padStart(2, '0');
function mesesAtras(n, dia) {
  const h = new Date();
  return ymd(new Date(h.getFullYear(), h.getMonth() - n, dia || 15));
}

test('Yahoo: data-ex vira o mês do provento e a data-com é o dia útil anterior', () => {
  // 2026-03-02 (segunda) 13:00 UTC → data-com na sexta anterior.
  const ts = Date.parse('2026-03-02T13:00:00Z') / 1000;
  const out = mapYahooProventos({
    a: { date: ts, amount: 0.5 },
    b: { date: ts, amount: 0.5 }, // repetido
    c: { date: ts, amount: 0 }, // sem valor
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].data, '2026-03-02');
  assert.equal(out[0].dataCom, '2026-02-27');
  assert.equal(out[0].valor, 0.5);
  assert.equal(out[0].fonte, 'yahoo');
});

test('BRAPI: tipo pelo rótulo, mês pelo pagamento e data-com do lastDatePrior', () => {
  const out = mapBrapiProventos([
    {
      label: 'JUROS SOBRE CAPITAL PRÓPRIO',
      rate: 1.2,
      paymentDate: '2026-05-20T00:00:00.000Z',
      lastDatePrior: '2026-04-10T00:00:00.000Z',
    },
    { label: 'RENDIMENTO', rate: 0.9, paymentDate: null, lastDatePrior: '2026-02-27' },
    { label: 'DIVIDENDO', rate: 0.3, paymentDate: '2026-01-15', lastDatePrior: '2025-12-30' },
  ]);
  assert.deepEqual(
    out.map((p) => [p.data, p.dataCom, p.tipo]),
    [
      ['2026-01-15', '2025-12-30', 'DIVIDENDO'],
      ['2026-02-27', '2026-02-27', 'RENDIMENTO'],
      ['2026-05-20', '2026-04-10', 'JCP'],
    ]
  );
});

test('deduplicar mantém tipos diferentes na mesma data', () => {
  const out = deduplicarProventos([
    { data: '2026-01-10', valor: 1, tipo: 'JCP' },
    { data: '2026-01-10', valor: 1, tipo: 'DIVIDENDO' },
    { data: '2026-01-10', valor: 1, tipo: 'JCP' },
  ]);
  assert.equal(out.length, 2);
});

test('quem comprou depois da data-com não tem direito ao provento', () => {
  const ctx = carregar([
    { ticker: 'XPTO3', tipo: 'compra', quantidade: 100, data_op: '2026-01-05' },
    { ticker: 'XPTO3', tipo: 'compra', quantidade: 50, data_op: '2026-03-01' },
  ]);
  // Data-com 27/02, pagamento 20/03: só as 100 primeiras contam.
  assert.equal(ctx.qtdNoProvento('XPTO3', { data: '2026-03-20', dataCom: '2026-02-27' }), 100);
  // Compra NO dia da data-com ainda tem direito.
  assert.equal(ctx.qtdNoProvento('XPTO3', { data: '2026-03-20', dataCom: '2026-03-01' }), 150);
  // Sem data-com, cai para a data do provento (comportamento antigo).
  assert.equal(ctx.qtdNoProvento('XPTO3', { data: '2026-03-20' }), 150);
});

test('JCP entra líquido (85%); dividendo e rendimento entram cheios', () => {
  const ctx = carregar([]);
  assert.equal(ctx.valorCotaLiquido({ valor: 1, tipo: 'JCP' }), 0.85);
  assert.equal(ctx.valorCotaLiquido({ valor: 1, tipo: 'DIVIDENDO' }), 1);
  assert.equal(ctx.valorCotaLiquido({ valor: 1, tipo: null }), 1);
});

test('projeção: últimos 12 meses se repetem no mesmo mês, com a quantidade de hoje', () => {
  const ctx = carregar([]);
  ctx.cacheDividendos.FIIX11 = {
    fetchedAt: Date.now(),
    // FII mensal: 12 pagamentos de 1,00, um por mês, nos últimos 12 meses
    // (do mês passado para trás) e um que já caiu este mês.
    pagamentos: Array.from({ length: 12 }, (_, i) => ({
      data: mesesAtras(i + 1, 1),
      valor: 1,
    })).concat([{ data: mesesAtras(0, 1), valor: 1 }]),
  };
  ctx.cacheDividendos.ACAO3 = {
    fetchedAt: Date.now(),
    pagamentos: [{ data: mesesAtras(3, 10), valor: 2, tipo: 'JCP' }],
  };
  const proj = ctx.projecaoProventos12m({
    FIIX11: { qtdTotal: 10 },
    ACAO3: { qtdTotal: 100 },
    SEMDADO3: { qtdTotal: 5 },
    VENDIDO3: { qtdTotal: 0 },
  });
  assert.equal(proj.meses.length, 12);
  // A janela começa no mês que vem (o mês corrente é o card "Dividendos do
  // mês"). FII mensal: cada um dos 12 meses recebe 10 × 1,00 — uma vez só.
  const hoje = new Date();
  const prox = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
  assert.equal(proj.meses[0].mes, prox.getMonth());
  for (let k = 0; k < 12; k++) assert.equal(proj.meses[k].itens.FIIX11, 10, 'mês ' + k);
  // JCP de 3 meses atrás volta daqui a 9 (posição 8 da janela), líquido:
  // 100 × 2 × 0,85.
  assert.ok(Math.abs(proj.meses[8].itens.ACAO3 - 170) < 1e-9);
  assert.ok(Math.abs(proj.total - (120 + 170)) < 1e-9);
  assert.equal(proj.porAtivo[0].ticker, 'ACAO3');
  assert.ok(Math.abs(proj.mediaMensal - proj.total / 12) < 1e-9);
});

test('card da projeção: some sem proventos e mostra aviso de estimativa com eles', () => {
  const ctx = carregar([]);
  assert.equal(ctx.htmlProjecaoProventos({ total: 0, meses: [], porAtivo: [] }), '');
  ctx.cacheDividendos.ACAO3 = {
    fetchedAt: Date.now(),
    pagamentos: [{ data: mesesAtras(2), valor: 1 }],
  };
  const html = ctx.htmlProjecaoProventos(ctx.projecaoProventos12m({ ACAO3: { qtdTotal: 10 } }), {
    link: "mobIrPara('patrimonio')",
  });
  assert.match(html, /Previsão de proventos/);
  assert.match(html, /Não é garantia de pagamento/);
  assert.match(html, /Detalhes/);
  assert.equal((html.match(/class="pp-div-col"/g) || []).length, 12);
});

test('relatório mensal conta os proventos pelas operações reais (data_op/quantidade)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'web', 'appliquei-relatorio-mensal.js'), 'utf8');
  assert.doesNotMatch(
    src.replace(/\/\/.*$/gm, ''),
    /op\.qtd\b/,
    'op.qtd não existe: o relatório ficava em R$ 0'
  );
  assert.match(src, /qtdNoProvento\(ticker, p\)/);
});

test('o celular desenha a projeção na tela de patrimônio', () => {
  const html = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
  const mob = fs.readFileSync(path.join(ROOT, 'web', 'appliquei-mobile.js'), 'utf8');
  assert.match(html, /id="mpMobProventos"/);
  assert.match(html, /id="cardProjecaoProventos"/);
  assert.match(mob, /function mobPatDesenharProventos\(\)/);
});
