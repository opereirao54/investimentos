'use strict';

// Relatório Mensal — "Para onde foi o dinheiro" detalhado por categoria.
//
// O usuário cadastra categorias no Controle Financeiro ("Mercado", "Academia")
// e o relatório mostrava só o total do bloco: "Cartão de crédito R$ 1.900,00",
// sem dizer no quê. O detalhe quebra cada bloco nas suas categorias.
//
// As regras que sustentam isso e que quebram calado:
//  - o rótulo sai de rotuloCategoriaDespesa, que resolve também categoria
//    renomeada ou oculta — sem ele o relatório mostraria o slug cru;
//  - a soma do detalhe TEM que bater com o total do bloco em calcularResumoMes,
//    senão o relatório se contradiz na mesma página;
//  - o filtro é por t.mes/t.ano, a mesma competência do resumo (cartão entra no
//    mês da FATURA, não no da compra).

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
  'web/appliquei-aba-controle-financeiro.js',
  'web/appliquei-relatorio-mensal.js',
  'web/appliquei-bens.js',
  'web/appliquei-jornada.js',
];

function makeDeadNode() {
  return {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    children: [],
    appendChild() {},
    removeChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => makeDeadNode(),
    querySelectorAll: () => [],
    getContext: () => null,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    cloneNode: () => makeDeadNode(),
    closest: () => null,
    matches: () => false,
    focus() {},
    innerHTML: '',
    innerText: '',
    textContent: '',
    value: '',
    checked: false,
  };
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

function carregar(dados) {
  const localStorage = makeStorage();
  Object.keys(dados || {}).forEach((k) => localStorage.setItem(k, dados[k]));

  const win = {
    location: { hostname: 'localhost', pathname: '/app', search: '', hash: '', reload() {} },
    navigator: { userAgent: 'node-test', sendBeacon: () => true },
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
    },
    localStorage,
    sessionStorage: makeStorage(),
    matchMedia: () => ({ matches: false }),
    Chart: Object.assign(function () {}, {
      register() {},
      defaults: {
        font: {},
        plugins: { tooltip: { titleFont: {}, bodyFont: {} }, legend: { labels: {} } },
        scales: { x: { ticks: {} }, y: { ticks: {} } },
      },
    }),
    ChartDataLabels: {},
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: () => 0,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener() {},
    removeEventListener() {},
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    Blob: class Blob {},
    FileReader: class FileReader {},
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;

  const ctx = vm.createContext(win);
  for (const f of LOAD_ORDER) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return win;
}

// Objeto vindo do vm tem outro realm, e deepStrictEqual reprova pelo
// protótipo. O round-trip por JSON traz o valor para cá.
const simples = (v) => JSON.parse(JSON.stringify(v));

// Agosto/2026 — o mês do relatório que o usuário mandou.
const MES = 7;
const ANO = 2026;
const lanc = (o) => Object.assign({ mes: MES, ano: ANO, pago: true, obs: '' }, o);
const comLancamentos = (lista, categorias) => {
  const d = { futurorico_transacoes: JSON.stringify(lista.map(lanc)) };
  if (categorias) d.futurorico_categoriasDespesa = JSON.stringify(categorias);
  return d;
};

// ---- quebra por bloco ---------------------------------------------------

test('cada bloco de gasto abre nas suas categorias, da maior pra menor', () => {
  const s = carregar(
    comLancamentos(
      [
        { id: 1, categoria: 'despesa_variavel', valor: 1000, categoriaDespesa: 'alimentacao' },
        { id: 2, categoria: 'despesa_variavel', valor: 220, categoriaDespesa: 'academia' },
        { id: 3, categoria: 'cartao_credito', valor: 1900, categoriaDespesa: 'lazer' },
      ],
      [{ v: 'academia', label: '🏋️ Academia' }]
    )
  );
  const d = s.rmDetalhePorCategoria(MES, ANO);

  assert.deepEqual(simples(d.despesa_variavel.map((c) => [c.label, c.valor])), [
    ['🛒 Alimentação', 1000],
    ['🏋️ Academia', 220],
  ]);
  assert.deepEqual(simples(d.cartao_credito.map((c) => [c.label, c.valor])), [
    ['🍿 Lazer e Assinaturas', 1900],
  ]);
});

test('a categoria criada pelo usuário aparece pelo nome, não pelo slug', () => {
  const s = carregar(
    comLancamentos(
      [{ id: 1, categoria: 'despesa_variavel', valor: 220, categoriaDespesa: 'academia' }],
      [{ v: 'academia', label: '🏋️ Academia' }]
    )
  );
  assert.equal(s.rmDetalhePorCategoria(MES, ANO).despesa_variavel[0].label, '🏋️ Academia');
});

test('categoria renomeada ou oculta ainda resolve o rótulo', () => {
  const s = carregar(
    comLancamentos(
      [
        { id: 1, categoria: 'despesa_variavel', valor: 300, categoriaDespesa: 'lazer' },
        { id: 2, categoria: 'despesa_variavel', valor: 100, categoriaDespesa: 'pets' },
      ],
      [
        { v: 'lazer', label: '🎬 Streaming' }, // renomeia uma padrão
        { v: 'pets', oculta: true }, // some do select, mas o lançamento fica
      ]
    )
  );
  const labels = s.rmDetalhePorCategoria(MES, ANO).despesa_variavel.map((c) => c.label);
  assert.deepEqual(simples(labels), ['🎬 Streaming', '🐶 Pets']);
});

test('lançamento sem categoria vira "Sem categoria" ao lado das outras', () => {
  const s = carregar(
    comLancamentos([
      { id: 1, categoria: 'despesa_fixa', valor: 800, categoriaDespesa: 'moradia' },
      { id: 2, categoria: 'despesa_fixa', valor: 150 },
    ])
  );
  assert.deepEqual(
    simples(s.rmDetalhePorCategoria(MES, ANO).despesa_fixa.map((c) => [c.label, c.valor])),
    [
      ['🏠 Moradia', 800],
      ['Sem categoria', 150],
    ]
  );
});

test('bloco inteiro sem categoria não vira detalhe — só repetiria o total', () => {
  const s = carregar(
    comLancamentos([
      { id: 1, categoria: 'cartao_credito', valor: 1900 },
      { id: 2, categoria: 'cartao_credito', valor: 100 },
    ])
  );
  assert.equal(s.rmDetalhePorCategoria(MES, ANO).cartao_credito, undefined);
});

test('sonho e aporte não têm detalhe — não são categorizados', () => {
  const s = carregar(
    comLancamentos([
      { id: 1, categoria: 'sonho', valor: 436.65 },
      { id: 2, categoria: 'investimento_variavel', valor: 5210 },
      { id: 3, categoria: 'receita', valor: 8300 },
    ])
  );
  assert.deepEqual(Object.keys(s.rmDetalhePorCategoria(MES, ANO)), []);
});

// ---- coerência com o resumo do mês --------------------------------------

test('a soma do detalhe bate com o total do bloco no resumo do mês', () => {
  const s = carregar(
    comLancamentos([
      { id: 1, categoria: 'despesa_variavel', valor: 1000, categoriaDespesa: 'alimentacao' },
      { id: 2, categoria: 'despesa_variavel', valor: 220, categoriaDespesa: 'saude' },
      { id: 3, categoria: 'cartao_credito', valor: 1200, categoriaDespesa: 'alimentacao' },
      { id: 4, categoria: 'cartao_credito', valor: 700, categoriaDespesa: 'transporte' },
      { id: 5, categoria: 'despesa_fixa', valor: 900, categoriaDespesa: 'moradia' },
    ])
  );
  const resumo = s.calcularResumoMes(MES, ANO);
  const d = s.rmDetalhePorCategoria(MES, ANO);
  const soma = (lista) => lista.reduce((a, c) => a + c.valor, 0);

  assert.equal(soma(d.despesa_variavel), resumo.despVar);
  assert.equal(soma(d.cartao_credito), resumo.cartao);
  assert.equal(soma(d.despesa_fixa), resumo.despFixa);
});

test('outro mês não vaza para o detalhe', () => {
  const s = carregar({
    futurorico_transacoes: JSON.stringify([
      lanc({ id: 1, categoria: 'despesa_variavel', valor: 220, categoriaDespesa: 'academia' }),
      {
        id: 2,
        mes: 6,
        ano: ANO,
        pago: true,
        obs: '',
        categoria: 'despesa_variavel',
        valor: 999,
        categoriaDespesa: 'lazer',
      },
    ]),
  });
  const lista = s.rmDetalhePorCategoria(MES, ANO).despesa_variavel;
  assert.equal(lista.length, 1);
  assert.equal(lista[0].valor, 220);
});

test('sem lançamento nenhum o detalhe é vazio, e não quebra', () => {
  const s = carregar();
  assert.deepEqual(Object.keys(s.rmDetalhePorCategoria(MES, ANO)), []);
});

// ---- PDF ----------------------------------------------------------------

test('o PDF lista as categorias embaixo de cada bloco', () => {
  const s = carregar(
    comLancamentos(
      [
        { id: 1, categoria: 'despesa_variavel', valor: 1000, categoriaDespesa: 'alimentacao' },
        { id: 2, categoria: 'despesa_variavel', valor: 220, categoriaDespesa: 'academia' },
      ],
      [{ v: 'academia', label: '🏋️ Academia' }]
    )
  );
  const html = s.rmConstruirRelatorioImprimivel('2026-08');
  assert.ok(html.includes('rm-print-cats'), 'bloco de detalhe ausente');
  assert.ok(html.includes('🏋️ Academia'), 'categoria criada pelo usuário ausente');
  assert.ok(html.includes('🛒 Alimentação'), 'categoria padrão ausente');
  // O total do bloco continua na linha de cima.
  assert.ok(html.includes('Despesas variáveis'));
});
