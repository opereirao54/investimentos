'use strict';

// Fase 2 — Motor de cálculos e fluxo de caixa.
//
// Carrega os classic scripts numa sandbox vm (mesmo padrão de
// classic-scripts-load.test.js) e exercita a lógica de cálculo afetada
// pelos ajustes da Fase 2:
//   2.1  Resgate de ações para sonhos abate o saldo do investimento.
//   2.2  Aporte (investimento) não conta como despesa de consumo.
//   2.3  calcularPatrimonioTotal() soma TODAS as categorias (RF + RV + …).
//   2.4  Parsing de datas padronizado + saldo/despesas por período corretos.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

const LOAD_ORDER = [
  'web/appliquei-utils.js',
  'web/appliquei-yahoo-finance.js',
  'web/appliquei-app.js',
  'web/appliquei-aba1-charts.js',
  'web/appliquei-renda-fixa.js',
  'web/appliquei-previdencia.js',
  'web/appliquei-aba-simulador.js',
  'web/appliquei-aba-carteira-recomendada.js',
  'web/appliquei-aba-info-mercado.js',
  'web/appliquei-aba-dividendos.js',
  'web/appliquei-aba-controle-financeiro.js',
  'web/appliquei-relatorio-mensal.js',
  'web/appliquei-applicash.js',
  'web/appliquei-duvidas.js',
  'web/appliquei-patrimonio.js',
  'web/appliquei-jornada.js',
  'web/appliquei-sonhos.js',
];

function makeDeadNode() {
  const node = {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {},
    children: [],
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return makeDeadNode(); },
    querySelectorAll() { return []; },
    getContext() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    cloneNode() { return makeDeadNode(); },
    closest() { return null; },
    matches() { return false; },
    focus() {},
    innerHTML: '',
    innerText: '',
    textContent: '',
    value: '',
    checked: false,
  };
  return node;
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  };
}

function makeSandbox() {
  const win = {
    location: { hostname: 'localhost', pathname: '/app', search: '', hash: '', origin: 'http://localhost', protocol: 'http:', replace() {}, reload() {} },
    navigator: { userAgent: 'node-test', sendBeacon: () => true, clipboard: null },
    document: {
      readyState: 'complete',
      documentElement: makeDeadNode(),
      body: makeDeadNode(),
      head: makeDeadNode(),
      getElementById: () => makeDeadNode(),
      querySelector: () => makeDeadNode(),
      querySelectorAll: () => [],
      createElement: () => makeDeadNode(),
      addEventListener() {},
      removeEventListener() {},
      execCommand() {},
      cookie: '',
    },
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    Chart: Object.assign(function ChartStub() { return { destroy() {}, update() {}, data: { datasets: [] }, options: {} }; }, {
      register() {}, unregister() {},
      defaults: { font: {}, plugins: { tooltip: { titleFont: {}, bodyFont: {} }, legend: { labels: {} }, datalabels: {} }, scale: { ticks: {} }, scales: { x: { ticks: {} }, y: { ticks: {} } }, elements: { line: {}, point: {}, bar: {}, arc: {} }, plugins_: {}, color: '', borderColor: '' },
    }),
    ChartDataLabels: {},
    firebase: undefined,
    AppliqueiFirebase: undefined,
    AppliqueiBilling: undefined,
    AppliqueiCloudSync: undefined,
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' }),
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: clearTimeout,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    URL, URLSearchParams,
    Blob: class Blob { constructor() {} },
    FileReader: class FileReader { constructor() {} readAsText() {} },
    Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, Set, Map, Symbol, Error, TypeError, RangeError, Intl,
    isFinite, isNaN, parseFloat, parseInt, encodeURIComponent, decodeURIComponent,
    btoa: (s) => Buffer.from(s).toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString(),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    open() { return null; },
    history: { replaceState() {} },
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  return win;
}

function loadApp() {
  const sandbox = makeSandbox();
  const ctx = vm.createContext(sandbox);
  for (const file of LOAD_ORDER) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(code, ctx, { filename: file });
  }
  return sandbox;
}

// ---- 2.4: parsing de datas padronizado --------------------------------

test('2.4 appliqueiParseData: "YYYY-MM-DD" vira meio-dia local (não vaza de mês)', () => {
  const s = loadApp();
  const d = s.appliqueiParseData('2024-01-01');
  // Meio-dia local — mês e dia preservados em qualquer fuso negativo.
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 1);
  assert.equal(d.getHours(), 12);
});

test('2.4 appliqueiMesAnoDe deriva mês/ano corretos de date-only', () => {
  const s = loadApp();
  assert.deepEqual(
    { mes: s.appliqueiMesAnoDe('2024-03-15').mes, ano: s.appliqueiMesAnoDe('2024-03-15').ano },
    { mes: 2, ano: 2024 }
  );
});

// ---- 2.2 / 2.4: classificação de caixa e despesa ----------------------

test('2.2 mpEhDespesaConsumo exclui aportes e transferências', () => {
  const s = loadApp();
  assert.equal(s.mpEhDespesaConsumo('despesa_fixa'), true);
  assert.equal(s.mpEhDespesaConsumo('despesa_variavel'), true);
  assert.equal(s.mpEhDespesaConsumo('cartao_credito'), true);
  assert.equal(s.mpEhDespesaConsumo('investimento_fixo'), false);
  assert.equal(s.mpEhDespesaConsumo('investimento_variavel'), false);
  assert.equal(s.mpEhDespesaConsumo('resgate_investimento'), false);
  assert.equal(s.mpEhDespesaConsumo('transferencia_saida'), false);
  assert.equal(s.mpEhDespesaConsumo('receita'), false);
});

test('2.3/2.4 mpEhEntradaCaixa: resgate de investimento credita o caixa', () => {
  const s = loadApp();
  assert.equal(s.mpEhEntradaCaixa('receita'), true);
  assert.equal(s.mpEhEntradaCaixa('resgate_investimento'), true);
  assert.equal(s.mpEhEntradaCaixa('investimento_variavel'), false);
});

test('2.4 mpCalcularDespesasJanela soma só consumo no período', () => {
  const s = loadApp();
  const jan = new Date(2024, 0, 10).toISOString();
  const fev = new Date(2024, 1, 10).toISOString();
  s.transacoes = [
    { categoria: 'despesa_fixa', valor: 100, data: jan, pago: true },
    { categoria: 'despesa_variavel', valor: 50, data: jan, pago: true },
    { categoria: 'investimento_variavel', valor: 1000, data: jan, pago: true }, // não é despesa
    { categoria: 'resgate_investimento', valor: 300, data: jan, pago: true },   // não é despesa
    { categoria: 'despesa_fixa', valor: 999, data: fev, pago: true },           // fora da janela
  ];
  const ini = new Date(2024, 0, 1).getTime();
  const fim = new Date(2024, 0, 31, 23, 59, 59).getTime();
  assert.equal(s.mpCalcularDespesasJanela(ini, fim), 150);
});

test('2.3/2.4 mpCalcularSaldoTotal: aporte abate, resgate devolve ao caixa', () => {
  const s = loadApp();
  const ref = new Date(2024, 5, 1).getTime();
  const dt = new Date(2024, 0, 10).toISOString();
  s.transacoes = [
    { categoria: 'receita', valor: 5000, data: dt, pago: true },
    { categoria: 'investimento_variavel', valor: 2000, data: dt, pago: true }, // -2000
    { categoria: 'resgate_investimento', valor: 800, data: dt, pago: true },   // +800
    { categoria: 'despesa_fixa', valor: 500, data: dt, pago: true },           // -500
  ];
  // 5000 - 2000 + 800 - 500 = 3300
  assert.equal(s.mpCalcularSaldoTotal(ref), 3300);
});

// ---- 2.3: patrimônio total soma todas as categorias -------------------

test('2.3 calcularPatrimonioTotal soma renda fixa + renda variável', () => {
  const s = loadApp();
  // RV: 10 cotas a 10 = 100 investido. RF: 1 unidade de 500.
  s.historicoCompras = [
    { id: 1, ticker: 'XPTO3', quantidade: 10, preco_op: 10, tipo: 'compra', categoria: 'renda_variavel', subcategoria: 'acoes', data_op: new Date(2024, 0, 1).toISOString() },
    { id: 2, ticker: 'CDB-X', quantidade: 1, preco_op: 500, tipo: 'compra', categoria: 'renda_fixa', data_op: new Date(2024, 0, 1).toISOString() },
  ];
  const p = s.calcularPatrimonioTotal();
  assert.ok(p.totalRendaVariavel > 0, 'renda variável deve entrar no total');
  assert.ok(p.totalRendaFixa > 0, 'renda fixa deve entrar no total');
  // Total = soma exata das categorias (sem ignorar nenhuma).
  const soma = p.totalRendaFixa + p.totalRendaVariavel + p.totalPrevidencia + p.totalReservaEmergencia;
  assert.ok(Math.abs(p.totalPatrimonio - soma) < 1e-6, 'totalPatrimonio deve ser a soma de todas as categorias');
});

// ---- 2.1: resgate para sonho abate o investimento de origem -----------

// Renderizações pesadas de UI/Chart não são exercitáveis na sandbox vm
// (clientHeight, getContext etc.). Neutralizamos só o que é puramente visual
// para isolar a lógica de cálculo/persistência.
function silenciarUI(s) {
  s.atualizarCarteiraAtivos = () => {};
  s.renderizarSonhos = () => {};
  s.atualizarTelaControle = () => {};
}

test('2.1 finalizarAporteSonho (migração) abate cotas do investimento', () => {
  const s = loadApp();
  silenciarUI(s);
  // Ativo fora do mockAtivosMercado → usa preço médio (10) como cotação.
  s.historicoCompras = [
    { id: 1, ticker: 'ZZZZ9', quantidade: 100, preco_op: 10, tipo: 'compra', categoria: 'renda_variavel', subcategoria: 'acoes', corretora: 'XP', data_op: new Date(2024, 0, 1).toISOString() },
  ];
  s.transacoes = [];
  s.sonhos = [{ id: 'sonho_1', nome: 'Viagem', valorTotal: 10000, valorAtual: 0, prazoMeses: 12, mesesRestantes: 12, planoVinculado: false, aportes: [] }];

  const qtdAntes = s.obterResumoCarteira()['ZZZZ9'].qtdTotal;
  assert.equal(qtdAntes, 100);

  // Resgata R$ 200 de ZZZZ9 (preço médio 10 → 20 cotas) para o sonho.
  s.finalizarAporteSonho('sonho_1', 200, '2024-02-01', 'migracao', { origemAtivo: 'ZZZZ9', origemDesc: 'Resgate de ZZZZ9' });

  const resumo = s.obterResumoCarteira();
  assert.ok(resumo['ZZZZ9'], 'ativo deve continuar existindo');
  assert.equal(resumo['ZZZZ9'].qtdTotal, 80, 'saldo do ativo deve cair 20 cotas (R$200 / R$10)');
  assert.equal(s.sonhos[0].valorAtual, 200, 'sonho deve receber o valor resgatado');

  // Deve haver uma operação de venda registrada na carteira.
  const venda = s.historicoCompras.find((o) => o.tipo === 'venda' && o.ticker === 'ZZZZ9');
  assert.ok(venda, 'deve existir uma operação de venda gerada pela migração');
});

test('2.1 excluir aporte de migração devolve as cotas ao investimento', () => {
  const s = loadApp();
  silenciarUI(s);
  s.historicoCompras = [
    { id: 1, ticker: 'ZZZZ9', quantidade: 100, preco_op: 10, tipo: 'compra', categoria: 'renda_variavel', subcategoria: 'acoes', corretora: 'XP', data_op: new Date(2024, 0, 1).toISOString() },
  ];
  s.transacoes = [];
  s.sonhos = [{ id: 'sonho_1', nome: 'Viagem', valorTotal: 10000, valorAtual: 0, prazoMeses: 12, mesesRestantes: 12, planoVinculado: false, aportes: [] }];

  s.finalizarAporteSonho('sonho_1', 200, '2024-02-01', 'migracao', { origemAtivo: 'ZZZZ9', origemDesc: 'Resgate de ZZZZ9' });
  const aporteId = s.sonhos[0].aportes[s.sonhos[0].aportes.length - 1].id;
  assert.equal(s.obterResumoCarteira()['ZZZZ9'].qtdTotal, 80);

  s.confirmarExcluirAporteSonho('sonho_1', aporteId);
  assert.equal(s.obterResumoCarteira()['ZZZZ9'].qtdTotal, 100, 'cotas devem voltar ao saldo original');
  assert.equal(s.sonhos[0].valorAtual, 0, 'valor do sonho deve ser revertido');
});
