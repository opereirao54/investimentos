'use strict';

// Aba "Meus sonhos" — o card responde "quanto tempo até conquistar".
//
// A visão geral tinha um bloco de mini-cards ("Tempo para conquistar cada
// sonho") que repetia, um a um, tudo o que o card da lista logo abaixo já
// mostrava: nome, status, barra, aporte/mês, quanto falta e o percentual.
// O bloco saiu. O que ele tinha de EXCLUSIVO — o horizonte até a conquista de
// um sonho AGENDADO, que o card só sabia dizer como "Inicia em set de 26" —
// virou um chip no próprio card.
//
// A regra que fecha o raciocínio: em sonho já em andamento o horizonte e o
// antigo "N meses restantes" são o mesmo número, então só um dos dois aparece.
// Duplicar ali seria repetir justamente o que motivou a remoção.

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
  'web/appliquei-aba-controle-financeiro.js',
  'web/appliquei-sonhos.js',
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

// Renderiza a aba de verdade e devolve o HTML que cada container recebeu.
function renderizar(lista) {
  const localStorage = makeStorage();
  localStorage.setItem('appliquei_sonhos', JSON.stringify(lista));

  const html = {};
  const capturado = (id) => {
    const n = makeDeadNode();
    Object.defineProperty(n, 'innerHTML', {
      set(v) {
        html[id] = v;
      },
      get() {
        return html[id] || '';
      },
    });
    return n;
  };
  const containers = ['sonhosResumoContainer', 'sonhosListaContainer', 'painelSaudeSonhos'];

  const win = {
    location: { hostname: 'localhost', pathname: '/app', search: '', hash: '', reload() {} },
    navigator: { userAgent: 'node-test', sendBeacon: () => true },
    document: {
      readyState: 'complete',
      documentElement: makeDeadNode(),
      body: makeDeadNode(),
      head: makeDeadNode(),
      getElementById: (id) => (containers.includes(id) ? capturado(id) : makeDeadNode()),
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
  win.renderizarSonhos();
  return { win, resumo: html.sonhosResumoContainer || '', lista: html.sonhosListaContainer || '' };
}

const hoje = new Date();
const emDias = (d) => new Date(hoje.getTime() + d * 86400000).toISOString();
const emMeses = (m) => new Date(hoje.getFullYear(), hoje.getMonth() + m, 15).toISOString();

const sonho = (o) =>
  Object.assign(
    {
      id: 's1',
      nome: 'Moto',
      categoria: 'veiculo',
      valorTotal: 30000,
      valorAtual: 5000,
      prazoMeses: 27,
      esforco: 'medio',
      dataInicio: emMeses(-1),
      dataFim: emMeses(12),
      dataCriacao: emMeses(-1),
    },
    o
  );

// ---- o bloco duplicado saiu --------------------------------------------

test('a visão geral não traz mais o bloco de mini-cards por sonho', () => {
  const r = renderizar([sonho({}), sonho({ id: 's2', nome: 'Viagem', dataInicio: emDias(40) })]);
  assert.ok(!r.resumo.includes('tempo-conquistar'), 'a seção continua sendo montada');
  assert.ok(!r.resumo.includes('tempo-card'), 'os mini-cards continuam sendo montados');
  assert.ok(!/Tempo para conquistar/i.test(r.resumo));
  // Os KPIs e o progresso geral, que não eram cópia de nada, continuam.
  assert.ok(r.resumo.includes('Meta total'));
  assert.ok(r.resumo.includes('Progresso geral'));
});

test('a visão geral não repete o nome de cada sonho — isso é da lista', () => {
  const r = renderizar([sonho({ nome: 'Moto' })]);
  assert.ok(!r.resumo.includes('Moto'), 'o nome do sonho voltou para a visão geral');
  assert.ok(r.lista.includes('Moto'), 'o card da lista tem que continuar mostrando o nome');
});

// ---- o horizonte até a conquista, no card -------------------------------

test('sonho agendado mostra QUANDO começa e QUANTO falta até conquistar', () => {
  // Começa daqui a 40 dias e termina daqui a 8 meses.
  const r = renderizar([sonho({ dataInicio: emDias(40), dataFim: emMeses(8) })]);
  assert.ok(/Inicia em/.test(r.lista), 'sumiu a data de início do agendado');
  assert.ok(/Conquista em 8 meses/.test(r.lista), 'faltou o horizonte até a conquista');
});

test('sonho em andamento não repete o prazo com dois nomes', () => {
  const r = renderizar([sonho({ dataInicio: emMeses(-3), dataFim: emMeses(6) })]);
  assert.ok(/Conquista em 6 meses/.test(r.lista));
  assert.ok(!/meses restantes/.test(r.lista), 'o rótulo antigo voltou junto — vira duplicata');
  assert.ok(!/Inicia em/.test(r.lista), 'sonho que já começou não anuncia início');
});

test('prazo longo sai em anos, como no resto da tela', () => {
  const r = renderizar([sonho({ dataInicio: emDias(10), dataFim: emMeses(27) })]);
  assert.ok(/Conquista em 2a 3m/.test(r.lista), r.lista.slice(0, 400));
});

// ---- quem já não tem horizonte -----------------------------------------

test('sonho conquistado não promete tempo nenhum', () => {
  const r = renderizar([sonho({ valorAtual: 30000, dataFim: emMeses(6) })]);
  assert.ok(/Conquistado/.test(r.lista));
  assert.ok(!/Conquista em/.test(r.lista), 'sonho já conquistado não tem horizonte');
});

test('sonho vencido mostra o prazo encerrado, e não um horizonte', () => {
  const r = renderizar([sonho({ dataInicio: emMeses(-10), dataFim: emMeses(-2) })]);
  assert.ok(/Prazo encerrado/.test(r.lista));
  assert.ok(!/Conquista em/.test(r.lista), 'sonho vencido não tem horizonte');
});

test('sem sonhos, a visão geral não desenha nada e a tela não quebra', () => {
  const r = renderizar([]);
  assert.equal(r.resumo, '');
});
