'use strict';

// Smoke test runtime: carrega os classic scripts em uma sandbox Node vm
// com window/document stubados e verifica que (a) nenhum lança no top-level,
// (b) os globais que outros arquivos consomem estão expostos no window.
//
// Não substitui validação em browser real (DOM/Firebase/Chart.js de verdade
// só rodam lá), mas pega regressões grosseiras antes de subir pro Vercel:
//  - declarações top-level que viram script-scoped (let/const "invisíveis")
//  - typos em nomes de função/var
//  - chamadas a APIs do browser desconhecidas
//
// Funcionou em vez de happy-dom para evitar dependência pesada — usa
// `vm.createContext` + stubs mínimos do que os scripts tocam no parse-time.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

// Order matches HTML <script> tags. utils + yahoo + app vêm antes das ABAs
// porque declaram as state vars (transacoes, cartoes, historicoCompras).
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

// Stub mínimo de DOM/browser APIs que o código toca em parse-time.
// Qualquer .getElementById('foo') no top-level retorna um nó "morto" que
// aceita .style/.classList/.addEventListener sem efeito — basta não jogar.
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
    // CDN globais que código clássico assume existirem. Chart.js expõe
    // métodos estáticos (register, defaults.*) que são chamados no top-level
    // de app.js.
    Chart: Object.assign(
      function ChartStub() {
        return {
          destroy() {},
          update() {},
          data: { datasets: [] },
          options: {},
        };
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
          plugins_: {},
          color: '',
          borderColor: '',
        },
      }
    ),
    ChartDataLabels: {},
    // Firebase compat stub — apenas o suficiente para o top-level não lançar.
    // Os scripts checam `typeof firebase === 'undefined'` ou
    // `window.AppliqueiFirebase && AppliqueiFirebase.ready` antes de chamar.
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
    console: {
      log() {},
      warn() {},
      error() {},
      info() {},
      debug() {},
    },
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

test('todos os classic scripts carregam sem lançar', () => {
  const sandbox = makeSandbox();
  const ctx = vm.createContext(sandbox);
  const errors = [];
  for (const file of LOAD_ORDER) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    try {
      vm.runInContext(code, ctx, { filename: file });
    } catch (e) {
      errors.push(`${file}: ${e.message}\n  at line ${e.lineNumber || '?'}`);
    }
  }
  assert.equal(
    errors.length,
    0,
    `Classic scripts lançaram durante load:\n${errors.join('\n')}`
  );
});

test('depois do load, globais cross-file vivem em window', () => {
  const sandbox = makeSandbox();
  const ctx = vm.createContext(sandbox);
  for (const file of LOAD_ORDER) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    try {
      vm.runInContext(code, ctx, { filename: file });
    } catch (_) {
      // Erros são problema do outro teste — aqui só validamos exports.
    }
  }
  // Estes globais (definidos com `var` no top-level de app.js) precisam
  // chegar em window para os scripts seguintes lerem-os. Se algum cair
  // como undefined, voltamos ao bug do PR #54.
  const expected = [
    'transacoes',
    'cartoes',
    'historicoCompras',
    // helpers de utils.js
    'parseBRL',
    'mostrarToast',
    'formatarBRLInput',
    'exportarDados',
    // helpers de app.js consumidos por ABAs
    'formatarMoeda',
    // funções de aba1-charts.js chamadas pelo window.onload em app.js
    'setPeriodoEvolucao',
    'aplicarTemaChartJs',
    // funções de yahoo-finance chamadas no init
    'buscarCotacoesReais',
    // funções de duvidas/applicash chamadas no init
    'renderizarFaq',
    'inicializarFormSugestao',
  ];
  const missing = expected.filter((name) => sandbox[name] === undefined);
  assert.equal(
    missing.length,
    0,
    `Globais esperados não chegaram em window:\n  ${missing.join('\n  ')}\n\n` +
      `Provavelmente foram declarados com let/const no top-level (script-scoped). ` +
      `Mude para \`var\` ou exponha explicitamente em window.X = X.`
  );
});
