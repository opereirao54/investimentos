'use strict';

// Fase 4 — UX e regras de negócio. Carrega os classic scripts numa sandbox vm.
//   4.6  Data da fatura do cartão (cartaoCalcularVencimento) — pura/determinística.
//   4.8  Datalist de bancos só sugere instituições com saldo nas despesas.

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
function makeSandbox(getEl) {
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
      getElementById: (id) => (getEl && getEl(id)) || makeDeadNode(),
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
function loadApp(getEl) {
  const sandbox = makeSandbox(getEl);
  const ctx = vm.createContext(sandbox);
  for (const file of LOAD_ORDER) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  return sandbox;
}

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---- 4.6: data da fatura do cartão -------------------------------------

test('4.6 compra após o fechamento vai para a PRÓXIMA fatura (fech 5, venc 5)', () => {
  const s = loadApp();
  // Hoje dia 25; fechamento dia 5 (já passou); vencimento dia 5.
  const hoje = new Date(2026, 4, 25); // 25/mai/2026
  const venc = s.cartaoCalcularVencimento(hoje, 5, 5);
  // Fecha em jun/5 (mês seguinte); venc dia 5 <= fech 5 => mês seguinte ao fechamento => jul/5.
  assert.equal(ymd(venc), '2026-07-05');
  assert.ok(venc.getTime() > hoje.getTime(), 'vencimento deve ser no futuro, não na fatura atual');
});

test('4.6 venc < fech: vencimento cai no mês seguinte ao fechamento (fech 25, venc 5)', () => {
  const s = loadApp();
  const hoje = new Date(2026, 4, 10); // dia 10, antes do fechamento 25
  const venc = s.cartaoCalcularVencimento(hoje, 25, 5);
  // Fecha mai/25 (este mês); venc 5 <= fech 25 => jun/5.
  assert.equal(ymd(venc), '2026-06-05');
});

test('4.6 venc > fech: vencimento no mesmo mês do fechamento (fech 5, venc 15)', () => {
  const s = loadApp();
  const hoje = new Date(2026, 4, 3); // dia 3, antes do fechamento 5
  const venc = s.cartaoCalcularVencimento(hoje, 5, 15);
  // Fecha mai/5; venc 15 > fech 5 => mai/15.
  assert.equal(ymd(venc), '2026-05-15');
});

test('4.6 sem fechamento cadastrado assume fech = venc', () => {
  const s = loadApp();
  const hoje = new Date(2026, 4, 10);
  const venc = s.cartaoCalcularVencimento(hoje, null, 20);
  // fech=venc=20; hoje 10 <= 20 => fecha mai/20; venc 20<=20 => jun/20.
  assert.equal(ymd(venc), '2026-06-20');
});

// ---- 4.3 / 4.4: projeção 1–50 anos e prêmio de risco -------------------

test('4.3 cartSeriesSintetica projeta horizontes longos (50 anos = 600 meses)', () => {
  const s = loadApp();
  assert.equal(s.cartRangeEhProjecao('50y'), true);
  assert.equal(s.cartRangeEhProjecao('3y'), false);
  const serie = s.cartSeriesSintetica('IBOV', '50y');
  assert.equal(serie.length, 601, '600 meses + ponto inicial');
  assert.ok(serie[serie.length - 1].p > serie[0].p, 'juros compostos crescem ao longo do tempo');
});

test('4.4 prêmio de risco: arrojado projeta MAIS que moderado e conservador', () => {
  const s = loadApp();
  const proxies = { rf: 'TESOURO_SELIC_2027', acao: 'IBOV', fii: 'IFIX', cripto: 'BTC' };
  const alloc = s.CART_ALLOC_DEFAULT;
  const tickers = ['TESOURO_SELIC_2027', 'IBOV', 'IFIX', 'BTC', 'CDI'];
  const seriesMap = {};
  tickers.forEach((t) => (seriesMap[t] = s.cartSeriesSintetica(t, '30y')));
  const finalDe = (perfil) => {
    const b = s.cartCalcularBlendedSeries(alloc[perfil], proxies, seriesMap);
    return b[b.length - 1].p;
  };
  const cons = finalDe('Conservador');
  const mod = finalDe('Moderado');
  const arr = finalDe('Arrojado');
  assert.ok(arr > mod, `arrojado (${arr.toFixed(0)}) deve superar moderado (${mod.toFixed(0)})`);
  assert.ok(
    mod > cons,
    `moderado (${mod.toFixed(0)}) deve superar conservador (${cons.toFixed(0)})`
  );
});

// ---- 4.8: datalist de bancos só com saldo nas despesas -----------------

test('4.8 despesa só sugere bancos com saldo; receita lista completa', () => {
  // Stub mínimo do datalist e do input de banco.
  const options = [];
  const datalist = { innerHTML: '', appendChild: (o) => options.push(o) };
  const bancoInput = { value: '' };
  const getEl = (id) => {
    if (id === 'listaBancosTransacao') return datalist;
    if (id === 'bancoTransacao') return bancoInput;
    return null;
  };
  const s = loadApp(getEl);
  // createElement precisa devolver objeto com value/label graváveis.
  s.document.createElement = () => ({ value: '', label: '' });

  // Bradesco tem saldo (recebeu salário); Itaú zerado.
  s.transacoes = [
    {
      categoria: 'receita',
      valor: 5000,
      banco: 'Bradesco',
      data: new Date(2026, 0, 5).toISOString(),
      pago: false,
    },
  ];
  s.historicoCompras = [];

  // Reset coletor e roda para DESPESA
  options.length = 0;
  datalist.innerHTML = '';
  s.inicializarDatalistBancosTransacao('despesa_fixa');
  const valoresDespesa = options.map((o) => o.value);
  assert.deepEqual(valoresDespesa, ['Bradesco'], 'despesa só sugere banco com saldo');
  assert.equal(
    bancoInput.value,
    'Bradesco',
    'preenche automaticamente quando há só um banco com saldo'
  );

  // Reset e roda para RECEITA — lista completa (inclui corretoras padrão)
  options.length = 0;
  datalist.innerHTML = '';
  bancoInput.value = '';
  s.inicializarDatalistBancosTransacao('receita');
  assert.ok(options.length > 1, 'receita deve trazer a lista completa de instituições');
});
