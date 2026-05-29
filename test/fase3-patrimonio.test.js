'use strict';

// Fase 3 — Integrações e agrupamento de dados (Meu Patrimônio).
// Carrega os classic scripts numa sandbox vm e valida:
//   3.1  Salário/receita (sem flag "pago") compõem o saldo e o caixa por
//        instituição; saídas só contam quando pagas; futuro é excluído.
//   3.2  Agrupamento "Por instituição" normaliza nomes (Itaú/itau) e
//        "Por categoria" passa a incluir o caixa (100% do patrimônio).

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
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    dataset: {},
    children: [],
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() {
      return null;
    },
    querySelector() {
      return makeDeadNode();
    },
    querySelectorAll() {
      return [];
    },
    getContext() {
      return null;
    },
    getBoundingClientRect() {
      return { top: 0, left: 0, width: 0, height: 0 };
    },
    cloneNode() {
      return makeDeadNode();
    },
    closest() {
      return null;
    },
    matches() {
      return false;
    },
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
    get length() {
      return map.size;
    },
  };
}
function makeSandbox() {
  const win = {
    location: {
      hostname: 'localhost',
      pathname: '/app',
      search: '',
      hash: '',
      origin: 'http://localhost',
      protocol: 'http:',
      replace() {},
      reload() {},
    },
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
    Chart: Object.assign(
      function ChartStub() {
        return { destroy() {}, update() {}, data: { datasets: [] }, options: {} };
      },
      {
        register() {},
        unregister() {},
        defaults: {
          font: {},
          plugins: {
            tooltip: { titleFont: {}, bodyFont: {} },
            legend: { labels: {} },
            datalabels: {},
          },
          scale: { ticks: {} },
          scales: { x: { ticks: {} }, y: { ticks: {} } },
          elements: { line: {}, point: {}, bar: {}, arc: {} },
          color: '',
          borderColor: '',
        },
      }
    ),
    ChartDataLabels: {},
    firebase: undefined,
    AppliqueiFirebase: undefined,
    AppliqueiBilling: undefined,
    AppliqueiCloudSync: undefined,
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: clearTimeout,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    URL,
    URLSearchParams,
    Blob: class Blob {
      constructor() {}
    },
    FileReader: class FileReader {
      constructor() {}
      readAsText() {}
    },
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    Set,
    Map,
    Symbol,
    Error,
    TypeError,
    RangeError,
    Intl,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    encodeURIComponent,
    decodeURIComponent,
    btoa: (s) => Buffer.from(s).toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString(),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    open() {
      return null;
    },
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
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  return sandbox;
}

const NOW = Date.now();
const ontem = new Date(NOW - 86400000).toISOString();
const futuro = new Date(NOW + 30 * 86400000).toISOString();

// ---- 3.1: salário/receita compõem o saldo mesmo sem "pago" -------------

test('3.1 mpCalcularSaldoTotal inclui salário não-pago e ignora saída não-paga', () => {
  const s = loadApp();
  s.transacoes = [
    { categoria: 'receita', valor: 5000, banco: 'Bradesco', data: ontem, pago: false }, // salário recebido
    { categoria: 'despesa_fixa', valor: 1000, data: ontem, pago: true }, // conta paga
    { categoria: 'despesa_variavel', valor: 500, data: ontem, pago: false }, // ainda não paga
  ];
  // 5000 (receita conta) - 1000 (paga) ; 500 não-paga não abate
  assert.equal(s.mpCalcularSaldoTotal(NOW), 4000);
});

test('3.1 salário fixo/recorrente não infla o saldo (usa competência mes/ano)', () => {
  const s = loadApp();
  const hoje = new Date();
  const criadoEm = hoje.toISOString(); // recorrentes guardam o MESMO `data` p/ todos os meses
  // 1 parcela deste mês + 2 meses futuros, todas data=hoje mas mes/ano distintos.
  s.transacoes = [
    {
      categoria: 'receita',
      valor: 8000,
      banco: 'Bradesco',
      data: criadoEm,
      mes: hoje.getMonth(),
      ano: hoje.getFullYear(),
      pago: false,
    },
    {
      categoria: 'receita',
      valor: 8000,
      banco: 'Bradesco',
      data: criadoEm,
      mes: (hoje.getMonth() + 1) % 12,
      ano: hoje.getMonth() === 11 ? hoje.getFullYear() + 1 : hoje.getFullYear(),
      pago: false,
    },
    {
      categoria: 'receita',
      valor: 8000,
      banco: 'Bradesco',
      data: criadoEm,
      mes: (hoje.getMonth() + 2) % 12,
      ano: hoje.getFullYear() + (hoje.getMonth() >= 10 ? 1 : 0),
      pago: false,
    },
  ];
  // Só a parcela do mês corrente entra; as futuras são excluídas pela competência.
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 8000);
});

test('3.1 receita futura não entra no saldo', () => {
  const s = loadApp();
  s.transacoes = [
    { categoria: 'receita', valor: 9999, banco: 'Bradesco', data: futuro, pago: false },
  ];
  assert.equal(s.mpCalcularSaldoTotal(NOW), 0);
});

test('3.1 salário aparece no caixa da instituição (Bradesco)', () => {
  const s = loadApp();
  s.transacoes = [
    { categoria: 'receita', valor: 5000, banco: 'Bradesco', data: ontem, pago: false },
  ];
  const mapa = s.mpCalcularSaldoPorInstituicao(NOW);
  const bradesco = Object.values(mapa).find((v) => v.label === 'Bradesco');
  assert.ok(bradesco, 'deve existir bucket Bradesco');
  assert.equal(bradesco.caixa, 5000);
});

// ---- 3.2: agrupamento por instituição normalizado ----------------------

test('3.2 instituições com grafia diferente (Itaú/itau ) somam na mesma linha', () => {
  const s = loadApp();
  s.transacoes = [
    { categoria: 'receita', valor: 1000, banco: 'Itaú', data: ontem, pago: false },
    { categoria: 'receita', valor: 500, banco: 'itau ', data: ontem, pago: false },
  ];
  const mapa = s.mpCalcularSaldoPorInstituicao(NOW);
  const chaves = Object.keys(mapa);
  assert.equal(chaves.length, 1, 'Itaú e itau devem cair na mesma chave');
  assert.equal(Object.values(mapa)[0].caixa, 1500);
});

test('3.2 despesa paga com banco abate o caixa da própria instituição', () => {
  const s = loadApp();
  // Salário entra no Bradesco; aluguel pago também sai do Bradesco.
  s.transacoes = [
    { categoria: 'receita', valor: 8000, banco: 'Bradesco', data: ontem, pago: false },
    { categoria: 'despesa_fixa', valor: 1200, banco: 'Bradesco', data: ontem, pago: true },
  ];
  const mapa = s.mpCalcularSaldoPorInstituicao(NOW);
  const chaves = Object.keys(mapa);
  assert.equal(chaves.length, 1, 'deve haver só o Bradesco — sem bucket "Sem banco"');
  assert.equal(Object.values(mapa)[0].label, 'Bradesco');
  assert.equal(Object.values(mapa)[0].caixa, 6800, 'caixa do Bradesco = 8000 - 1200');
});

test('3.2 controleCategoriaUsaBanco cobre receitas e despesas (não cartão)', () => {
  const s = loadApp();
  assert.equal(s.controleCategoriaUsaBanco('receita'), true);
  assert.equal(s.controleCategoriaUsaBanco('resgate_investimento'), true);
  assert.equal(s.controleCategoriaUsaBanco('despesa_fixa'), true);
  assert.equal(s.controleCategoriaUsaBanco('despesa_variavel'), true);
  assert.equal(s.controleCategoriaUsaBanco('cartao_credito'), false);
  assert.equal(s.controleBancoObrigatorio('despesa_fixa'), false);
  assert.equal(s.controleBancoObrigatorio('receita'), true);
});

test('3.2 mpConsolidar normaliza a corretora (XP / xp )', () => {
  const s = loadApp();
  s.historicoCompras = [
    {
      id: 1,
      ticker: 'AAA3',
      quantidade: 10,
      preco_op: 10,
      tipo: 'compra',
      categoria: 'renda_variavel',
      subcategoria: 'acoes',
      corretora: 'XP',
      data_op: ontem,
    },
    {
      id: 2,
      ticker: 'BBB3',
      quantidade: 10,
      preco_op: 10,
      tipo: 'compra',
      categoria: 'renda_variavel',
      subcategoria: 'acoes',
      corretora: 'xp ',
      data_op: ontem,
    },
  ];
  const cons = s.mpConsolidar();
  const insts = Object.keys(cons.porInstituicao);
  assert.equal(insts.length, 1, 'XP e xp devem ser a mesma instituição');
  assert.equal(Object.values(cons.porInstituicao)[0].label, 'XP');
});
