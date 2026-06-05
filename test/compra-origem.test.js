'use strict';

// Compra de ativo → conta pagadora escolhida pelo usuário (sem default
// silencioso "própria corretora"). Garante que:
//   1. registrarOperacaoAtivo BLOQUEIA a compra quando nenhuma conta-origem foi
//      escolhida (o débito precisa cair numa conta de verdade).
//   2. ao escolher uma conta cadastrada, a perna `transferencia_saida` carimba o
//      `contaId` daquela conta e o saldo dela (Meu Patrimônio) é debitado.
// Reproduz o bug "fiz compra variável e não descontou do saldo": antes o
// padrão debitava a corretora (sem saldo), o caixa negava e a linha sumia.

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
  'web/appliquei-contas.js',
  'web/appliquei-aba1-charts.js',
  'web/appliquei-renda-fixa.js',
  'web/appliquei-previdencia.js',
  'web/appliquei-patrimonio.js',
];

// Nó de formulário cujo value/checked espelha um mapa `fields` compartilhado.
function makeFieldNode(id, fields) {
  return {
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
    innerText: '',
    textContent: '',
    innerHTML: '',
    addEventListener() {},
    querySelector: () => makeFieldNode('_', fields),
    querySelectorAll: () => [],
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
function loadApp(fields) {
  const doc = {
    readyState: 'complete',
    getElementById: (id) => makeFieldNode(id, fields),
    querySelector: () => makeFieldNode('_', fields),
    querySelectorAll: () => [],
    createElement: () => makeFieldNode('_', fields),
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
  for (const f of LOAD_ORDER) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  // Stubs de UI que tocam DOM inexistente após registrar a operação.
  const noop = () => {};
  win.mostrarToast = (msg, tipo) => {
    win.__ultimoToast = { msg, tipo };
  };
  win.atualizarCarteiraAtivos = noop;
  win.atualizarDatalistDescricoes = noop;
  win.inicializarDatalistCorretoras = noop;
  win.renderizarOperacoes = noop;
  win.fecharDrawerOperacao = noop;
  return win;
}

function camposCompraRV(extra) {
  return Object.assign(
    {
      compraTicker: 'PETR4',
      tipoOperacao: 'compra',
      compraCategoria: 'renda_variavel',
      compraCorretora: 'Rico',
      compraData: '',
      compraVencimento: '',
      compraRentabilidade: '',
      compraQtd: '10',
      compraPreco: '100,00',
      compraSubcategoria: 'acoes',
      compraOrigemRecurso: '',
      compraOrigemBanco: '',
      prevSaldoInicial: '',
      prevRecorrente: false,
      prevDiaRecorrencia: '',
      prevDuracaoAnos: '',
      prevTaxaMensal: '',
      compraTotalOp: '',
    },
    extra || {}
  );
}

test('compra bloqueia quando nenhuma conta-origem foi escolhida', () => {
  const fields = camposCompraRV({ compraOrigemRecurso: '' });
  const s = loadApp(fields);
  s.contas = [];
  s.transacoes = [];
  s.historicoCompras = [];
  s.registrarOperacaoAtivo();
  // Nada lançado: nem carteira (historicoCompras) nem caixa (transacoes).
  assert.equal(s.historicoCompras.length, 0, 'não deve registrar a compra sem conta-origem');
  assert.equal(s.transacoes.length, 0, 'não deve criar pernas de caixa sem conta-origem');
  assert.equal(s.__ultimoToast.tipo, 'erro');
});

test('compra debita a conta-origem escolhida (saldo do Meu Patrimônio reflete)', () => {
  const fields = camposCompraRV();
  const s = loadApp(fields);
  s.contas = [];
  s.transacoes = [];
  s.historicoCompras = [];
  // Salário de 5000 no Nubank + a conta Nubank cadastrada.
  const ontem = new Date(Date.now() - 86400000).toISOString();
  s.transacoes.push({
    categoria: 'receita',
    valor: 5000,
    banco: 'Nubank',
    data: ontem,
    pago: false,
  });
  const nubank = s.criarConta({ nome: 'Nubank', tipo: 'banco' });

  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 5000);

  // Usuário escolhe explicitamente a conta Nubank como origem do recurso.
  fields.compraOrigemRecurso = nubank.id;
  s.registrarOperacaoAtivo();

  const leg = s.transacoes.find((t) => t.categoria === 'transferencia_saida');
  assert.ok(leg, 'deve criar a perna transferencia_saida');
  assert.equal(leg.contaId, nubank.id, 'a perna debita a conta escolhida');
  assert.equal(leg.valor, 1000);

  // Saldo total cai 5000 → 4000 e o caixa do Nubank reflete o débito.
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 4000);
  const mapa = s.mpCalcularSaldoPorInstituicao(Date.now());
  assert.equal(mapa[nubank.id].caixa, 4000, 'caixa do Nubank = 5000 - 1000');
});
