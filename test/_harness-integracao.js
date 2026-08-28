'use strict';

/**
 * Harness compartilhado dos testes de integração.
 *
 * Carrega os classic scripts numa sandbox `vm` com um DOM falso, do mesmo jeito
 * que compra-origem.test.js e fase3-patrimonio.test.js já faziam — só que uma
 * vez só, em vez de ~150 linhas duplicadas por arquivo de teste.
 *
 * Os classic scripts compartilham estado por `window` (top-level `var`), então a
 * ORDEM de carregamento importa: é a mesma dos <script src> no HTML. Ver
 * test/classic-scripts-globals.test.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

// Ordem canônica (subconjunto do HTML). Cada teste carrega só o que precisa.
const ORDEM_BASE = [
  'web/appliquei-utils.js',
  'web/appliquei-yahoo-finance.js',
  'web/appliquei-app.js',
  'web/appliquei-contas.js',
  'web/appliquei-aba1-charts.js',
  'web/appliquei-renda-fixa.js',
  'web/appliquei-previdencia.js',
  'web/appliquei-patrimonio.js',
];

const ORDEM_CONTROLE = ORDEM_BASE.concat(['web/appliquei-aba-controle-financeiro.js']);

/** Nó de formulário cujo value/checked espelha um mapa `fields` compartilhado. */
function makeFieldNode(id, fields) {
  return {
    id,
    get value() {
      return fields[id] ?? '';
    },
    set value(v) {
      fields[id] = v;
    },
    get checked() {
      return !!fields[id];
    },
    set checked(v) {
      fields[id] = v;
    },
    style: {},
    dataset: {},
    options: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    focus() {},
    click() {},
    remove() {},
    appendChild() {},
    insertAdjacentHTML() {},
    innerText: '',
    textContent: '',
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => makeFieldNode('_', fields),
    querySelectorAll: () => [],
    closest: () => null,
    // Canvas: os renders do Controle/Patrimônio chamam getContext para o Chart.js.
    // Sem isto o teste morre no render, depois de a gravação já ter dado certo —
    // falha de harness disfarçada de falha de produto.
    getContext: () => ({
      canvas: { width: 0, height: 0 },
      clearRect() {},
      fillRect() {},
      beginPath() {},
      arc() {},
      fill() {},
      stroke() {},
      save() {},
      restore() {},
      measureText: () => ({ width: 0 }),
      createLinearGradient: () => ({ addColorStop() {} }),
    }),
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }),
  };
}

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size;
    },
  };
}

/**
 * Sobe a sandbox e roda os scripts.
 *
 * @param {object}   [fields]  valores dos campos de formulário por id
 * @param {string[]} [ordem]   arquivos a carregar (default ORDEM_BASE)
 * @returns {object} o objeto `window` da sandbox
 */
function carregarApp(fields, ordem) {
  fields = fields || {};
  const doc = {
    readyState: 'complete',
    getElementById: (id) => makeFieldNode(id, fields),
    querySelector: () => makeFieldNode('_', fields),
    querySelectorAll: () => [],
    createElement: () => makeFieldNode('_', fields),
    createDocumentFragment: () => makeFieldNode('_', fields),
    addEventListener() {},
    removeEventListener() {},
    documentElement: makeFieldNode('_', fields),
    body: makeFieldNode('_', fields),
    head: makeFieldNode('_', fields),
    execCommand() {},
    cookie: '',
  };
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
    navigator: { userAgent: 'node', sendBeacon: () => true, clipboard: null },
    document: doc,
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    Chart: Object.assign(
      function () {
        return { destroy() {}, update() {}, data: { datasets: [] }, options: {} };
      },
      {
        register() {},
        unregister() {},
        defaults: { font: {}, plugins: {}, scales: {}, elements: {} },
      }
    ),
    ChartDataLabels: {},
    firebase: undefined,
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
    Blob: class {},
    FileReader: class {
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
    dispatchEvent: () => true,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    open: () => null,
    history: { replaceState() {} },
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;

  const ctx = vm.createContext(win);
  for (const f of ordem || ORDEM_BASE) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }

  // Stubs de UI que tocam DOM inexistente depois de gravar.
  const noop = () => {};
  win.__toasts = [];
  win.mostrarToast = (msg, tipo) => {
    win.__ultimoToast = { msg, tipo };
    win.__toasts.push({ msg, tipo });
  };
  for (const nome of [
    'atualizarCarteiraAtivos',
    'atualizarDatalistDescricoes',
    'inicializarDatalistCorretoras',
    'renderizarOperacoes',
    'fecharDrawerOperacao',
    'renderMinhasContas',
    'atualizarTudo',
    'renderizarTransacoes',
    'atualizarDashboard',
    'fecharModal',
  ]) {
    win[nome] = noop;
  }

  // Estado limpo: cada teste monta o seu.
  win.contas = [];
  win.transacoes = [];
  win.historicoCompras = [];
  win.sonhos = [];
  return win;
}

/** Extrai de uma sandbox o estado que o validador de invariantes consome. */
function estadoDe(win) {
  return {
    transacoes: win.transacoes || [],
    contas: win.contas || [],
    historicoCompras: win.historicoCompras || [],
    sonhos: win.sonhos || [],
  };
}

module.exports = { ROOT, ORDEM_BASE, ORDEM_CONTROLE, carregarApp, estadoDe, makeFieldNode };
