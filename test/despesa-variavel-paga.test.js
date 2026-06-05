'use strict';

// Despesa variável avulsa (sorvete, suco…) é compra à vista: nasce `pago: true`
// e debita o caixa do Meu Patrimônio na hora. Despesa fixa segue `pago: false`
// (compromisso a vencer). Reproduz "comprei um sorvete e não descontou do
// patrimônio": antes toda despesa nascia pendente e só descontava ao clicar
// "pagar".

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
  'web/appliquei-aba-controle-financeiro.js',
  'web/appliquei-patrimonio.js',
];

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
  const noop = () => {};
  win.mostrarToast = (msg, tipo) => {
    win.__ultimoToast = { msg, tipo };
  };
  win.atualizarTelaControle = noop;
  win.atualizarDatalistDescricoes = noop;
  win.fecharPainelLancamento = noop;
  win.resetarEmojiCategoriaNova = noop;
  win.selecionarTipoCartao = noop;
  return win;
}

// Campos do painel "Novo lançamento".
function camposLancamento(extra) {
  return Object.assign(
    {
      descTransacao: 'Sorvete',
      valorTransacao: '15,00',
      categoriaTransacao: 'despesa_variavel',
      transacaoFixa: false,
      qtdParcelas: '1',
      dataVencimento: '',
      obsTransacao: '',
      tipoCartaoSelecionado: 'parcelado',
      selectCartao: '',
      bancoTransacao: 'Nubank',
      categoriaDespesa: '',
      categoriaDespesaNova: '',
    },
    extra || {}
  );
}

test('despesa variável avulsa nasce paga e debita o caixa do Meu Patrimônio', () => {
  const fields = camposLancamento();
  const s = loadApp(fields);
  s.contas = [];
  s.transacoes = [];
  s.historicoCompras = [];
  // 100 de saldo no Nubank (saldo inicial) para o sorvete debitar.
  s.criarConta({
    nome: 'Nubank',
    tipo: 'banco',
    saldoInicial: 100,
    dataSaldoInicial: '2020-01-01',
  });

  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 100);
  s.executarInsercao();

  const sorvete = s.transacoes.find((t) => t.categoria === 'despesa_variavel');
  assert.ok(sorvete, 'deve criar a despesa variável');
  assert.equal(sorvete.pago, true, 'despesa variável avulsa nasce paga');
  // Caixa do Meu Patrimônio reflete o gasto: 100 - 15 = 85.
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 85);
});

test('despesa fixa continua pendente (não debita até pagar)', () => {
  const fields = camposLancamento({
    descTransacao: 'Aluguel',
    categoriaTransacao: 'despesa_fixa',
    valorTransacao: '50,00',
  });
  const s = loadApp(fields);
  s.contas = [];
  s.transacoes = [];
  s.historicoCompras = [];
  s.criarConta({
    nome: 'Nubank',
    tipo: 'banco',
    saldoInicial: 100,
    dataSaldoInicial: '2020-01-01',
  });

  s.executarInsercao();
  const aluguel = s.transacoes.find((t) => t.categoria === 'despesa_fixa');
  assert.ok(aluguel, 'deve criar a despesa fixa');
  assert.equal(aluguel.pago, false, 'despesa fixa nasce pendente');
  // Sem pagar, o caixa não muda (compromisso a vencer).
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 100);
});
