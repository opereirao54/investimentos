'use strict';

// Rendimento acumulado da DRE (web/appliquei-rendimento.js).
//
// A linha "Investimento acumulado" do Controle é custo de aquisição: quanto
// saiu do bolso. A linha nova é quanto isso virou, no fim de CADA mês da
// janela — e é aí que mora a armadilha que este arquivo trava.
//
// Valorar a posição de março com o preço de setembro não devolve o rendimento
// de março: devolve o de hoje aplicado a uma posição antiga. Numa tabela
// contábil isso é um número errado com cara de certo, e ele cresce quanto mais
// longe no passado a coluna está. Por isso a renda variável é valorada pelo
// FECHAMENTO DA ÉPOCA, e quando ele falta o resultado vem marcado `estimado`
// para a tela poder dizer a verdade sobre o próprio número.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const FONTE = fs.readFileSync(path.join(ROOT, 'web/appliquei-rendimento.js'), 'utf8');

const DIA = 86400000;

/** Sandbox mínima: só o que o módulo lê do resto do app. */
function carregar({ operacoes = [], precoAtual = {}, rendaFixa = null, previdencia = null } = {}) {
  const win = {
    historicoCompras: operacoes,
    mockAtivosMercado: Object.keys(precoAtual).map((t) => ({
      ticker: t,
      preco_atual: precoAtual[t],
    })),
    console: { log() {}, warn() {}, error() {} },
    fetch: () => Promise.reject(new Error('sem rede no teste')),
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    isFinite,
    encodeURIComponent,
  };
  if (rendaFixa) win.valorAtualRendaFixa = rendaFixa;
  if (previdencia) win.calcularSaldoPrevidencia = previdencia;
  win.window = win;
  win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(FONTE, ctx, { filename: 'web/appliquei-rendimento.js' });
  return win;
}

/** Série mensal sintética de fechamentos, do mais antigo ao mais novo. */
function serie(precoInicial, passo, meses, fimMs) {
  const out = [];
  for (let i = meses; i >= 0; i--) {
    out.push({ t: fimMs - i * 30 * DIA, p: precoInicial + (meses - i) * passo });
  }
  return out;
}

// ---------------------------------------------------------------- preço ----

test('sem série, o preço é o de hoje — e é só esse o caso de estimativa', () => {
  const w = carregar({ precoAtual: { PETR4: 38 } });
  assert.equal(w.rendTemHistorico('PETR4'), false);
  assert.equal(w.rendPrecoEm('PETR4', Date.now() - 180 * DIA, 38), 38);
});

test('com série, devolve o último fechamento ATÉ a data pedida', () => {
  const w = carregar({ precoAtual: { PETR4: 38 } });
  const agora = Date.now();
  // 12 meses: 20, 21, 22, ... 32
  w.rendHistorico.PETR4 = serie(20, 1, 12, agora);
  assert.equal(w.rendTemHistorico('PETR4'), true);
  // Exatamente em cima de um ponto
  assert.equal(w.rendPrecoEm('PETR4', agora - 6 * 30 * DIA, 38), 26);
  // Entre dois pontos: vale o anterior — o seguinte ainda não aconteceu
  assert.equal(w.rendPrecoEm('PETR4', agora - 6 * 30 * DIA + 5 * DIA, 38), 26);
  assert.equal(w.rendPrecoEm('PETR4', agora - 12 * 30 * DIA, 38), 20);
});

test('antes do início da série e depois do fim, cai para o preço de hoje', () => {
  const w = carregar({ precoAtual: { PETR4: 38 } });
  const agora = Date.now();
  w.rendHistorico.PETR4 = serie(20, 1, 12, agora - 30 * DIA);
  assert.equal(w.rendPrecoEm('PETR4', agora - 5 * 365 * DIA, 38), 38, 'antes da série');
  assert.equal(w.rendPrecoEm('PETR4', agora, 38), 38, 'depois da série: hoje é mais fresco');
});

// -------------------------------------------------------------- posição ----

test('a posição ignora operação com data futura', () => {
  const agora = Date.now();
  const w = carregar({
    precoAtual: { PETR4: 10 },
    operacoes: [
      {
        ticker: 'PETR4',
        quantidade: 100,
        preco_op: 5,
        tipo: 'compra',
        data_op: new Date(agora - 30 * DIA).toISOString(),
        categoria: 'renda_variavel',
      },
      {
        ticker: 'PETR4',
        quantidade: 50,
        preco_op: 8,
        tipo: 'compra',
        data_op: new Date(agora + 30 * DIA).toISOString(),
        categoria: 'renda_variavel',
      },
    ],
  });
  const r = w.rendPosicaoEm(agora);
  assert.equal(r.posicao.PETR4.qtd, 100, 'a compra agendada não existe ainda');
  assert.equal(r.investido, 500);
});

test('a venda reduz o custo pelo preço médio, não pelo preço da venda', () => {
  // Vender caro não pode reduzir o "investido" mais do que se pagou: isso
  // misturaria resultado com aporte e faria o rendimento aparecer duas vezes.
  const agora = Date.now();
  const w = carregar({
    precoAtual: { PETR4: 30 },
    operacoes: [
      {
        ticker: 'PETR4',
        quantidade: 100,
        preco_op: 10,
        tipo: 'compra',
        data_op: new Date(agora - 60 * DIA).toISOString(),
        categoria: 'renda_variavel',
      },
      {
        ticker: 'PETR4',
        quantidade: 40,
        preco_op: 30,
        tipo: 'venda',
        data_op: new Date(agora - 10 * DIA).toISOString(),
        categoria: 'renda_variavel',
      },
    ],
  });
  const r = w.rendPosicaoEm(agora);
  assert.equal(r.posicao.PETR4.qtd, 60);
  assert.equal(r.investido, 600, '1000 − 40×10 (preço médio), não 40×30');
});

// ------------------------------------------------------------ rendimento ---

test('o rendimento de um mês passado usa o preço DAQUELE mês', () => {
  // É o defeito que a linha existe para não cometer. Comprou 100 a 20 há seis
  // meses; naquele mês a ação valia 26 e hoje vale 38. O rendimento de seis
  // meses atrás é 600, não 1.800.
  const agora = Date.now();
  const w = carregar({
    precoAtual: { PETR4: 38 },
    operacoes: [
      {
        ticker: 'PETR4',
        quantidade: 100,
        preco_op: 20,
        tipo: 'compra',
        data_op: new Date(agora - 365 * DIA).toISOString(),
        categoria: 'renda_variavel',
      },
    ],
  });
  w.rendHistorico.PETR4 = serie(20, 1, 12, agora); // 20 há 12 meses … 32 hoje

  const hoje = w.rendCarteiraEm(agora);
  assert.equal(hoje.investido, 2000);
  assert.equal(hoje.mercado, 3800, 'hoje vale a cotação de hoje, mais fresca que o fechamento');
  assert.equal(hoje.rendimento, 1800);
  assert.equal(hoje.estimado, false);

  const seisMeses = w.rendCarteiraEm(agora - 6 * 30 * DIA);
  assert.equal(seisMeses.mercado, 2600, '100 × 26, o fechamento da época');
  assert.equal(seisMeses.rendimento, 600);
  assert.equal(seisMeses.estimado, false);
});

test('sem histórico o número vem marcado como estimado', () => {
  const agora = Date.now();
  const w = carregar({
    precoAtual: { PETR4: 38 },
    operacoes: [
      {
        ticker: 'PETR4',
        quantidade: 100,
        preco_op: 20,
        tipo: 'compra',
        data_op: new Date(agora - 365 * DIA).toISOString(),
        categoria: 'renda_variavel',
      },
    ],
  });
  const seisMeses = w.rendCarteiraEm(agora - 6 * 30 * DIA);
  assert.equal(seisMeses.estimado, true, 'a tela precisa saber para marcar a célula');
  assert.equal(seisMeses.mercado, 3800, 'sem série, o preço de hoje é o que há');
});

test('renda fixa e previdência são exatas em qualquer data, e não marcam estimativa', () => {
  const agora = Date.now();
  const w = carregar({
    operacoes: [
      {
        ticker: 'CDB-X',
        quantidade: 1,
        preco_op: 1000,
        tipo: 'compra',
        data_op: new Date(agora - 365 * DIA).toISOString(),
        categoria: 'renda_fixa',
      },
      {
        ticker: 'PREV-Y',
        quantidade: 1,
        preco_op: 500,
        tipo: 'compra',
        data_op: new Date(agora - 365 * DIA).toISOString(),
        categoria: 'previdencia',
      },
    ],
    // Juros compostos fingidos: 1% ao mês desde a compra.
    rendaFixa: (ticker, cat, refMs) =>
      1000 * Math.pow(1.01, (refMs - (agora - 365 * DIA)) / (30 * DIA)),
    previdencia: (ticker, refMs) =>
      500 * Math.pow(1.01, (refMs - (agora - 365 * DIA)) / (30 * DIA)),
  });
  const seis = w.rendCarteiraEm(agora - 6 * 30 * DIA);
  assert.equal(seis.estimado, false, 'nenhuma das duas depende de cotação');
  assert.equal(seis.investido, 1500);
  // ~6 meses a 1% ao mês sobre 1500
  assert.ok(seis.mercado > 1580 && seis.mercado < 1600, `mercado inesperado: ${seis.mercado}`);
  assert.ok(seis.rendimento > 80 && seis.rendimento < 100);
});

test('carteira vazia devolve zeros sem estimar nada', () => {
  const w = carregar({});
  const r = w.rendCarteiraEm(Date.now());
  assert.deepEqual(
    { investido: r.investido, mercado: r.mercado, rendimento: r.rendimento, estimado: r.estimado },
    { investido: 0, mercado: 0, rendimento: 0, estimado: false }
  );
});

test('posição zerada por venda total não conta valor de mercado', () => {
  const agora = Date.now();
  const w = carregar({
    precoAtual: { PETR4: 38 },
    operacoes: [
      {
        ticker: 'PETR4',
        quantidade: 100,
        preco_op: 20,
        tipo: 'compra',
        data_op: new Date(agora - 200 * DIA).toISOString(),
        categoria: 'renda_variavel',
      },
      {
        ticker: 'PETR4',
        quantidade: 100,
        preco_op: 30,
        tipo: 'venda',
        data_op: new Date(agora - 10 * DIA).toISOString(),
        categoria: 'renda_variavel',
      },
    ],
  });
  const r = w.rendCarteiraEm(agora);
  assert.equal(r.mercado, 0, 'não há mais posição');
  assert.equal(r.investido, 0, 'o custo saiu junto');
});

// ------------------------------------------------------------ integração ---

test('a DRE desenha a linha e marca a estimativa', () => {
  const src = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba-controle-financeiro.js'), 'utf8');
  assert.match(src, /Rendimento acumulado/, 'a linha sumiu da DRE');
  assert.match(src, /rendCarteiraEm/, 'a DRE deixou de calcular o rendimento');
  assert.match(src, /dre-rend-aprox/, 'o marcador de estimativa sumiu');
  // A busca é disparada pelo próprio render: sem isto, quem registra o primeiro
  // investimento com o app aberto nunca recebe o histórico.
  assert.match(src, /rendCarregarHistorico/, 'a DRE não pede mais o histórico');
});

test('o gráfico de evolução também usa o fechamento da época', () => {
  // A limitação "RV usa a cotação atual" era declarada em comentário e fazia a
  // barra de março nascer com o ganho de setembro embutido.
  const src = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba1-charts.js'), 'utf8');
  const trecho = src.slice(src.indexOf('function calcularSerieEvolucao'));
  assert.match(
    trecho.slice(0, 6000),
    /rendPrecoEm/,
    'o gráfico voltou a usar só a cotação de hoje'
  );
});
