'use strict';

// Editar e excluir categorias de despesa (Configurações).
//
// A regra que sustenta tudo e que é fácil quebrar sem ninguém notar:
// RENOMEAR NÃO PODE MEXER NO SLUG. O slug (`v`) é o que está gravado em
// t.categoriaDespesa de cada lançamento. Se o rename recalculasse o slug a
// partir do nome novo, todo o histórico daquela categoria ficaria órfão em
// silêncio — o extrato passaria a mostrar o slug cru e a composição do mês
// jogaria os lançamentos em "sem categoria".
//
// O resto cobre a partição padrão-vs-criada (padrão oculta, criada exclui),
// a reatribuição dos lançamentos e a compatibilidade com o formato antigo da
// chave futurorico_categoriasDespesa (array só com categorias criadas).

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

// Só os arquivos de que as funções de categoria dependem.
const LOAD_ORDER = [
  'web/appliquei-utils.js',
  'web/appliquei-yahoo-finance.js',
  'web/appliquei-app.js',
  'web/appliquei-aba-controle-financeiro.js',
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

function carregar(dadosIniciais) {
  const localStorage = makeStorage();
  Object.keys(dadosIniciais || {}).forEach((k) => localStorage.setItem(k, dadosIniciais[k]));

  const elementos = {};
  const toasts = [];
  const win = {
    location: { hostname: 'localhost', pathname: '/app', search: '', hash: '', reload() {} },
    navigator: { userAgent: 'node-test', sendBeacon: () => true },
    document: {
      readyState: 'complete',
      documentElement: makeDeadNode(),
      body: makeDeadNode(),
      head: makeDeadNode(),
      getElementById: (id) => elementos[id] || makeDeadNode(),
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

  // Re-render de tela é caro e depende de DOM real; as funções testadas aqui
  // são a camada de dados.
  win.atualizarTelaControle = () => {};
  win.popularSelectCategoriaDespesa = () => {};
  win.mostrarToast = (msg, tipo) => toasts.push({ msg, tipo });
  win.renderizarListaCategoriasConfig = () => {};

  return { win, localStorage, elementos, toasts };
}

const ajustesSalvos = (env) =>
  JSON.parse(env.localStorage.getItem('futurorico_categoriasDespesa') || '[]');
const transacoesSalvas = (env) =>
  JSON.parse(env.localStorage.getItem('futurorico_transacoes') || '[]');

// Formulário de categoria do modal de Configurações, já preenchido.
function preencherForm(env, { nome, emoji = '🏷️', editandoV = '' }) {
  env.elementos.categoriaDespesaNovaConfig = Object.assign(makeDeadNode(), {
    value: nome,
    dataset: { editandoV },
  });
  env.elementos.categoriaDespesaNovaEmojiConfig = Object.assign(makeDeadNode(), { value: emoji });
}

// ---- leitura: padrões + criadas + ocultas ------------------------------

test('obterCategoriasDespesa: padrões primeiro, depois as criadas', () => {
  const env = carregar({
    futurorico_categoriasDespesa: JSON.stringify([{ v: 'viagens', label: '✈️ Viagens' }]),
  });
  const cats = env.win.obterCategoriasDespesa();
  assert.equal(cats.length, env.win.CATEGORIAS_DESPESA_PADRAO.length + 1);
  assert.equal(cats[0].v, 'moradia');
  assert.equal(cats[0].padrao, true);
  const ultima = cats[cats.length - 1];
  assert.deepEqual(
    { v: ultima.v, label: ultima.label, padrao: ultima.padrao },
    { v: 'viagens', label: '✈️ Viagens', padrao: false }
  );
});

test('formato antigo (só categorias criadas) continua válido', () => {
  const env = carregar({
    futurorico_categoriasDespesa: JSON.stringify([
      { v: 'pets_exoticos', label: '🦎 Pets exóticos' },
      { v: 'academia', label: '🏋️ Academia' },
    ]),
  });
  const vs = env.win.obterCategoriasDespesa().map((c) => c.v);
  assert.ok(vs.includes('pets_exoticos') && vs.includes('academia'));
  assert.ok(vs.includes('moradia'), 'padrões continuam aparecendo');
});

test('ajuste de label sobrescreve o rótulo de uma categoria padrão', () => {
  const env = carregar({
    futurorico_categoriasDespesa: JSON.stringify([{ v: 'lazer', label: '🎬 Streaming' }]),
  });
  const lazer = env.win.obterCategoriasDespesa().find((c) => c.v === 'lazer');
  assert.equal(lazer.label, '🎬 Streaming');
  assert.equal(lazer.padrao, true, 'continua sendo padrão, só o nome mudou');
});

test('categoria oculta some da lista mas o rótulo ainda resolve', () => {
  const env = carregar({
    futurorico_categoriasDespesa: JSON.stringify([{ v: 'pets', oculta: true }]),
  });
  assert.ok(!env.win.obterCategoriasDespesa().some((c) => c.v === 'pets'));
  // Lançamento antigo apontando para ela não pode mostrar o slug cru.
  assert.equal(env.win.rotuloCategoriaDespesa('pets'), '🐶 Pets');
});

test('rotuloCategoriaDespesa: slug desconhecido não quebra', () => {
  const env = carregar({});
  assert.equal(env.win.rotuloCategoriaDespesa('slug_que_sumiu'), 'slug_que_sumiu');
  assert.equal(env.win.rotuloCategoriaDespesa(''), '');
});

// ---- renomear ----------------------------------------------------------

test('RENOMEAR NÃO MEXE NO SLUG — o histórico continua ligado à categoria', () => {
  const env = carregar({
    futurorico_categoriasDespesa: JSON.stringify([{ v: 'mercado', label: '🛒 Mercado' }]),
    futurorico_transacoes: JSON.stringify([
      { id: 1, categoriaDespesa: 'mercado' },
      { id: 2, categoriaDespesa: 'mercado' },
    ]),
  });

  preencherForm(env, { nome: 'Supermercado do mês', emoji: '🥑', editandoV: 'mercado' });
  env.win.salvarCategoriaConfig();

  const cats = env.win.obterCategoriasDespesa();
  const renomeada = cats.find((c) => c.label === '🥑 Supermercado do mês');
  assert.ok(renomeada, 'a categoria deveria ter o novo rótulo');
  assert.equal(renomeada.v, 'mercado', 'o slug NÃO pode mudar');
  assert.ok(
    !cats.some((c) => c.v === 'supermercado_do_mes'),
    'não pode nascer uma categoria nova a partir do nome'
  );
  // E os lançamentos continuam encontrando a categoria.
  assert.equal(env.win.contarLancamentosDaCategoria('mercado'), 2);
  assert.equal(env.win.rotuloCategoriaDespesa('mercado'), '🥑 Supermercado do mês');
});

test('renomear uma padrão grava só o ajuste de label, sem virar categoria criada', () => {
  const env = carregar({});
  preencherForm(env, { nome: 'Casa', emoji: '🏡', editandoV: 'moradia' });
  env.win.salvarCategoriaConfig();

  assert.deepEqual(ajustesSalvos(env), [{ v: 'moradia', label: '🏡 Casa' }]);
  const moradia = env.win.obterCategoriasDespesa().find((c) => c.v === 'moradia');
  assert.equal(moradia.label, '🏡 Casa');
  assert.equal(moradia.padrao, true);
});

// ---- criar -------------------------------------------------------------

test('criar categoria gera slug sem acento e sem espaço', () => {
  const env = carregar({});
  preencherForm(env, { nome: 'Educação das crianças', emoji: '📚' });
  env.win.salvarCategoriaConfig();
  assert.deepEqual(ajustesSalvos(env), [
    { v: 'educacao_das_criancas', label: '📚 Educação das crianças' },
  ]);
});

test('criar categoria com nome já existente é recusado', () => {
  const env = carregar({});
  preencherForm(env, { nome: 'Moradia', emoji: '🏠' });
  env.win.salvarCategoriaConfig();
  assert.deepEqual(ajustesSalvos(env), [], 'nada foi gravado');
  assert.equal(env.toasts.at(-1).tipo, 'erro');
});

test('criar categoria com nome de uma oculta reativa em vez de duplicar', () => {
  const env = carregar({
    futurorico_categoriasDespesa: JSON.stringify([{ v: 'pets', oculta: true }]),
  });
  preencherForm(env, { nome: 'Pets', emoji: '🐱' });
  env.win.salvarCategoriaConfig();

  const pets = ajustesSalvos(env).filter((a) => a.v === 'pets');
  assert.equal(pets.length, 1, 'não pode haver duas entradas para o mesmo slug');
  assert.equal(pets[0].oculta, undefined);
  assert.equal(pets[0].label, '🐱 Pets');
  assert.equal(env.win.obterCategoriasDespesa().filter((c) => c.v === 'pets').length, 1);
});

test('criar sem nome não grava nada', () => {
  const env = carregar({});
  preencherForm(env, { nome: '   ' });
  env.win.salvarCategoriaConfig();
  assert.deepEqual(ajustesSalvos(env), []);
  assert.equal(env.toasts.at(-1).tipo, 'erro');
});

// ---- excluir / ocultar -------------------------------------------------

test('excluir categoria criada some de vez e move os lançamentos para o destino', () => {
  const env = carregar({
    futurorico_categoriasDespesa: JSON.stringify([{ v: 'uber', label: '🚕 Uber' }]),
    futurorico_transacoes: JSON.stringify([
      { id: 1, categoriaDespesa: 'uber' },
      { id: 2, categoriaDespesa: 'uber' },
      { id: 3, categoriaDespesa: 'moradia' },
    ]),
  });
  env.elementos.categoriaConfigDestino = Object.assign(makeDeadNode(), { value: 'transporte' });

  env.win.confirmarExclusaoCategoriaConfig('uber');

  assert.deepEqual(ajustesSalvos(env), [], 'a categoria criada é removida do array');
  assert.ok(!env.win.obterCategoriasDespesa().some((c) => c.v === 'uber'));
  const ts = transacoesSalvas(env);
  assert.equal(ts.filter((t) => t.categoriaDespesa === 'transporte').length, 2);
  assert.equal(
    ts.find((t) => t.id === 3).categoriaDespesa,
    'moradia',
    'lançamentos de outras categorias não são tocados'
  );
});

test('excluir com destino vazio deixa os lançamentos sem categoria', () => {
  const env = carregar({
    futurorico_categoriasDespesa: JSON.stringify([{ v: 'uber', label: '🚕 Uber' }]),
    futurorico_transacoes: JSON.stringify([{ id: 1, categoriaDespesa: 'uber' }]),
  });
  env.elementos.categoriaConfigDestino = Object.assign(makeDeadNode(), { value: '' });

  env.win.confirmarExclusaoCategoriaConfig('uber');

  const t = transacoesSalvas(env)[0];
  assert.ok(!('categoriaDespesa' in t), 'o campo é removido, não fica string vazia');
});

test('excluir categoria criada sem uso não mexe em lançamento nenhum', () => {
  const env = carregar({
    futurorico_categoriasDespesa: JSON.stringify([{ v: 'uber', label: '🚕 Uber' }]),
    futurorico_transacoes: JSON.stringify([{ id: 1, categoriaDespesa: 'moradia' }]),
  });
  env.win.confirmarExclusaoCategoriaConfig('uber');
  assert.equal(transacoesSalvas(env)[0].categoriaDespesa, 'moradia');
});

test('categoria padrão é OCULTA, não excluída — e o histórico fica intacto', () => {
  const env = carregar({
    futurorico_transacoes: JSON.stringify([{ id: 1, categoriaDespesa: 'pets' }]),
  });
  // Sem destino escolhido: manter o histórico como está é o padrão.
  env.win.confirmarExclusaoCategoriaConfig('pets');

  assert.deepEqual(ajustesSalvos(env), [{ v: 'pets', oculta: true }]);
  assert.ok(!env.win.obterCategoriasDespesa().some((c) => c.v === 'pets'));
  assert.equal(transacoesSalvas(env)[0].categoriaDespesa, 'pets', 'histórico preservado');
  assert.equal(env.win.rotuloCategoriaDespesa('pets'), '🐶 Pets', 'e ainda tem rótulo');
});

test('ocultar uma padrão renomeada preserva o nome ao restaurar', () => {
  const env = carregar({
    futurorico_categoriasDespesa: JSON.stringify([{ v: 'lazer', label: '🎬 Streaming' }]),
  });
  env.win.confirmarExclusaoCategoriaConfig('lazer');
  assert.deepEqual(ajustesSalvos(env), [{ v: 'lazer', label: '🎬 Streaming', oculta: true }]);

  env.win.restaurarCategoriaConfig('lazer');
  const lazer = env.win.obterCategoriasDespesa().find((c) => c.v === 'lazer');
  assert.equal(lazer.label, '🎬 Streaming');
});

test('restaurar padrão sem rótulo próprio limpa o ajuste em vez de deixar lixo', () => {
  const env = carregar({
    futurorico_categoriasDespesa: JSON.stringify([{ v: 'pets', oculta: true }]),
  });
  env.win.restaurarCategoriaConfig('pets');
  assert.deepEqual(ajustesSalvos(env), []);
  assert.ok(env.win.obterCategoriasDespesa().some((c) => c.v === 'pets'));
});

test('reatribuirCategoriaDespesa devolve quantos moveu e persiste', () => {
  const env = carregar({
    futurorico_transacoes: JSON.stringify([
      { id: 1, categoriaDespesa: 'a' },
      { id: 2, categoriaDespesa: 'a' },
      { id: 3, categoriaDespesa: 'b' },
    ]),
  });
  assert.equal(env.win.reatribuirCategoriaDespesa('a', 'b'), 2);
  assert.equal(transacoesSalvas(env).filter((t) => t.categoriaDespesa === 'b').length, 3);
  assert.equal(env.win.reatribuirCategoriaDespesa('inexistente', 'b'), 0);
});
