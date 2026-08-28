'use strict';

// Relatório Mensal — régua do score e card de Bens.
//
// Duas regras que o desenho da tela depende e que quebram em silêncio:
//
// 1) A RÉGUA. O status do termômetro (vermelho 0-29, amarelo 30-59, verde
//    60-100) e a barra de cores desenhada na aba e no PDF têm que sair da
//    MESMA fonte — RM_FAIXAS_SCORE. Antes disso os limiares viviam soltos
//    dentro de rmCalcularTermometro (40/70) e um score de 60 aparecia como
//    "amarelo" mesmo caindo na faixa verde da régua.
//
// 2) BENS é ESTOQUE, não fluxo do mês. Não há snapshot mensal de bens, então
//    o filtro é pela EXISTÊNCIA: o carro comprado em agosto não pode aparecer
//    no relatório de março.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

// Mesma ordem das tags <script> do HTML: bens.js carrega DEPOIS do relatório,
// e é por isso que rmBensAteFimDoMes checa `typeof bensAtivos`.
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

// `dados` é semeado ANTES dos scripts: bens.js lê localStorage no top-level.
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

// Relatório com N critérios verdes — os demais vermelhos. Cada critério vale
// 100/50/0, então 3 de 5 verdes dão exatamente 60 pontos.
function repComCriterios({ despesasOk, investimentosOk, sonhosOk, jornadaOk, applicashOk }) {
  return {
    entradas: 8300,
    pctDespesas: despesasOk ? 37.6 : 90,
    pctInvestimentos: investimentosOk ? 62.8 : 5,
    sonhos: { ativos: 2, noPrazo: sonhosOk ? 2 : 0, progressoMedio: 50, lista: [] },
    jornadaModulosMes: jornadaOk ? 1 : 0,
    applicash: { indicacoes: applicashOk ? 2 : 0, receita: 0 },
  };
}

// ---- régua do score ----------------------------------------------------

test('régua: cada ponta de faixa cai na cor certa', () => {
  const s = carregar();
  const faixa = (n) => s.rmFaixaDoScore(n).status;
  assert.equal(faixa(0), 'vermelho');
  assert.equal(faixa(29), 'vermelho');
  assert.equal(faixa(30), 'amarelo');
  assert.equal(faixa(59), 'amarelo');
  assert.equal(faixa(60), 'verde');
  assert.equal(faixa(100), 'verde');
});

test('régua: score fora de 0-100 não escapa das faixas', () => {
  const s = carregar();
  assert.equal(s.rmFaixaDoScore(-40).status, 'vermelho');
  assert.equal(s.rmFaixaDoScore(300).status, 'verde');
  assert.equal(s.rmFaixaDoScore(undefined).status, 'vermelho');
});

test('régua: as três faixas cobrem 0-100 sem buraco nem sobreposição', () => {
  const s = carregar();
  const faixas = s.RM_FAIXAS_SCORE;
  assert.equal(faixas[0].min, 0);
  assert.equal(faixas[faixas.length - 1].max, 100);
  for (let i = 1; i < faixas.length; i++) {
    assert.equal(faixas[i].min, faixas[i - 1].max + 1, `faixa ${i} não emenda na anterior`);
  }
});

test('60 pontos (3 de 5 critérios) é VERDE, não amarelo', () => {
  const s = carregar();
  const t = s.rmCalcularTermometro(
    repComCriterios({
      despesasOk: true,
      investimentosOk: true,
      sonhosOk: true,
      jornadaOk: false,
      applicashOk: false,
    })
  );
  assert.equal(t.score, 60);
  assert.equal(t.statusGeral, 'verde');
  assert.equal(t.faixa.rotulo, 'Saudável');
});

test('20 pontos (1 de 5 critérios) é VERMELHO', () => {
  const s = carregar();
  const t = s.rmCalcularTermometro(
    repComCriterios({
      despesasOk: true,
      investimentosOk: false,
      sonhosOk: false,
      jornadaOk: false,
      applicashOk: false,
    })
  );
  assert.equal(t.score, 20);
  assert.equal(t.statusGeral, 'vermelho');
});

// ---- barra de cores ----------------------------------------------------

test('barra mostra as três faixas e destaca só a atual', () => {
  const s = carregar();
  const html = s.rmBarraFaixasHtml(60);
  ['0–29', '30–59', '60–100', 'Crítico', 'Atenção', 'Saudável'].forEach((txt) => {
    assert.ok(html.includes(txt), `barra não mostra "${txt}"`);
  });
  // Fundo saturado (destaque) só na faixa da vez; as outras ficam claras.
  assert.ok(html.includes('background:#10b981'), 'faixa verde não está destacada');
  assert.ok(!html.includes('background:#ef4444'), 'faixa vermelha não devia estar destacada');
  assert.ok(html.includes('background:#fee2e2'), 'faixa vermelha devia estar em tom claro');
  assert.ok(html.includes('60 pontos · Saudável'));
});

test('barra: o ponteiro anda com o score e fica dentro da faixa', () => {
  const s = carregar();
  const pos = (n) => Number(/left:([\d.]+)%/.exec(s.rmBarraFaixasHtml(n))[1]);
  // 30 faixas de 0-29 → a divisa vermelho/amarelo fica em ~29.7%.
  assert.ok(pos(0) < 29.7, 'score 0 devia cair no vermelho');
  assert.ok(pos(29) < 29.7, 'score 29 devia cair no vermelho');
  assert.ok(pos(30) > 29.7 && pos(30) < 59.41, 'score 30 devia cair no amarelo');
  assert.ok(pos(60) > 59.41, 'score 60 devia cair no verde');
  assert.ok(pos(100) <= 100, 'ponteiro não pode passar do fim da barra');
});

test('barra de impressão usa cores chapadas (o PDF não enxerga as vars do app)', () => {
  const s = carregar();
  const html = s.rmBarraFaixasHtml(60, { impressao: true });
  assert.ok(!html.includes('var(--'), 'barra do PDF não pode depender de CSS var');
  assert.ok(html.includes('#059669'), 'verde de impressão ausente');
});

// ---- bens ---------------------------------------------------------------

const bensSalvos = (lista) => ({ appliquei_bens: JSON.stringify(lista) });

test('bem comprado em agosto não aparece no relatório de março', () => {
  const s = carregar(
    bensSalvos([
      {
        id: 'bem_1',
        nome: 'Moto',
        tipo: 'veiculo',
        valorAtual: 900,
        dataCompra: '2026-08-10',
        criadoEm: '2026-08-10T12:00:00.000Z',
      },
    ])
  );
  const marco = s.rmBensAteFimDoMes(2, 2026);
  assert.equal(marco.total, 0);
  assert.equal(marco.qtd, 0);
  const agosto = s.rmBensAteFimDoMes(7, 2026);
  assert.equal(agosto.total, 900);
  assert.equal(agosto.qtd, 1);
});

test('bem comprado no último dia do mês entra no mês', () => {
  const s = carregar(
    bensSalvos([{ id: 'bem_1', nome: 'Carro', valorAtual: 40000, dataCompra: '2026-08-31' }])
  );
  assert.equal(s.rmBensAteFimDoMes(7, 2026).total, 40000);
  assert.equal(s.rmBensAteFimDoMes(6, 2026).total, 0);
});

test('sem dataCompra, vale a data de cadastro', () => {
  const s = carregar(
    bensSalvos([
      { id: 'bem_1', nome: 'Casa', valorAtual: 300000, criadoEm: '2026-06-15T09:00:00.000Z' },
    ])
  );
  assert.equal(s.rmBensAteFimDoMes(4, 2026).total, 0); // maio
  assert.equal(s.rmBensAteFimDoMes(5, 2026).total, 300000); // junho
});

test('bem arquivado sai da conta; financiamento não abate o valor', () => {
  const s = carregar(
    bensSalvos([
      {
        id: 'bem_1',
        nome: 'Carro financiado',
        valorAtual: 50000,
        dataCompra: '2026-01-05',
        financiamento: { ativo: true, saldoDevedor: 30000 },
      },
      {
        id: 'bem_2',
        nome: 'Moto vendida',
        valorAtual: 900,
        dataCompra: '2026-01-05',
        arquivado: true,
      },
    ])
  );
  // Valor CHEIO — a mesma decisão de produto dos KPIs de "Meu patrimônio".
  const total = s.rmBensAteFimDoMes(7, 2026);
  assert.equal(total.total, 50000);
  assert.equal(total.qtd, 1);
});

test('sem bens cadastrados o total é zero, e não quebra', () => {
  const s = carregar();
  assert.equal(s.rmBensAteFimDoMes(7, 2026).total, 0);
  assert.equal(s.rmBensAteFimDoMes(7, 2026).qtd, 0);
  assert.equal(s.buildMonthlyReport('2026-08').bens, 0);
});

test('buildMonthlyReport publica bens e quantidade', () => {
  const s = carregar(
    bensSalvos([
      { id: 'bem_1', nome: 'Moto', valorAtual: 900, dataCompra: '2026-08-10' },
      { id: 'bem_2', nome: 'Carro', valorAtual: 40000, dataCompra: '2026-08-12' },
    ])
  );
  const rep = s.buildMonthlyReport('2026-08');
  assert.equal(rep.bens, 40900);
  assert.equal(rep.bensQtd, 2);
});

test('bens não ligam o hasData — mês futuro continua vazio', () => {
  const s = carregar(bensSalvos([{ id: 'bem_1', nome: 'Moto', valorAtual: 900 }]));
  const daquiUmAno = new Date();
  daquiUmAno.setFullYear(daquiUmAno.getFullYear() + 1);
  const ym = daquiUmAno.getFullYear() + '-' + String(daquiUmAno.getMonth() + 1).padStart(2, '0');
  const rep = s.buildMonthlyReport(ym);
  assert.equal(rep.bens, 900, 'o bem existe no mês futuro');
  assert.equal(rep.hasData, false, 'mas não pode apagar o aviso de "mês futuro"');
});

// ---- PDF ---------------------------------------------------------------

test('PDF traz o card de Bens no resumo e a régua no cabeçalho', () => {
  const s = carregar(
    bensSalvos([{ id: 'bem_1', nome: 'Moto', valorAtual: 900, dataCompra: '2026-08-10' }])
  );
  const html = s.rmConstruirRelatorioImprimivel('2026-08');
  assert.ok(html.includes('Bens (carro, casa, etc.)'), 'card de bens ausente no PDF');
  assert.ok(html.includes('rm-print-faixas'), 'régua ausente no PDF');
  assert.ok(html.includes('0–29') && html.includes('60–100'), 'faixas ausentes no PDF');
});
