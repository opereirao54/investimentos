'use strict';

// Financiamento de bem: custo real e simulação de amortização.
//
// A parte que precisa estar certa é a matemática — é dela que sai a resposta
// "quanto esse financiamento realmente me custa". Os números abaixo são
// conferidos contra as fórmulas fechadas, não contra o próprio código:
//
//   PRICE  PMT = SD·i / (1 − (1+i)^−n)        juros = PMT·n − SD
//   SAC    A = SD/n, parcela_k = A + SD_k·i   juros = i·SD·(n+1)/2
//
// Escolher o sistema errado não é detalhe: num saldo de R$ 300 mil a 0,8% a.m.
// em 240 meses, Price acusa R$ 375.840 de juros e SAC R$ 289.200 — R$ 86.640 de
// diferença, 30% a mais. Apresentar um pelo outro informaria mal o usuário
// sobre a maior dívida da vida dele.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

function carregar() {
  const map = new Map();
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
  const dead = () => ({
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    options: [],
    appendChild() {},
    addEventListener() {},
    querySelector: () => dead(),
    querySelectorAll: () => [],
    focus() {},
    innerHTML: '',
    textContent: '',
    value: '',
  });
  const win = {
    location: { hostname: 'localhost' },
    navigator: { userAgent: 'node-test' },
    document: {
      readyState: 'complete',
      body: dead(),
      head: dead(),
      documentElement: dead(),
      getElementById: () => dead(),
      querySelector: () => dead(),
      querySelectorAll: () => [],
      createElement: () => dead(),
      addEventListener() {},
    },
    localStorage: storage,
    sessionStorage: storage,
    matchMedia: () => ({ matches: false }),
    Chart: Object.assign(function () {}, {
      register() {},
      defaults: { font: {}, plugins: {}, scales: {} },
    }),
    ChartDataLabels: {},
    fetch: () => Promise.reject(new Error('sem rede')),
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    console: { log() {}, warn() {}, error() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener() {},
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  const ctx = vm.createContext(win);
  for (const f of [
    'web/appliquei-utils.js',
    'web/appliquei-yahoo-finance.js',
    'web/appliquei-app.js',
    'web/appliquei-contas.js',
    'web/appliquei-bens.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return win;
}

const perto = (a, b, tol, msg) =>
  assert.ok(
    Math.abs(a - b) <= tol,
    `${msg || 'valor'}: esperado ~${b.toFixed(2)}, veio ${Number(a).toFixed(2)}`
  );

// ---- parcela -----------------------------------------------------------

test('parcela Price bate com a fórmula fechada', () => {
  const w = carregar();
  // SD=100.000, i=1% a.m., n=120  →  PMT = 100000·0,01/(1−1,01^−120)
  const esperado = (100000 * 0.01) / (1 - Math.pow(1.01, -120));
  perto(w.finParcelaPrice(100000, 0.01, 120), esperado, 0.01, 'PMT');
  perto(w.finParcelaPrice(100000, 0.01, 120), 1434.71, 0.5, 'PMT conferido à mão');
});

test('parcela Price sem juros é o saldo dividido pelo prazo', () => {
  const w = carregar();
  perto(w.finParcelaPrice(120000, 0, 120), 1000, 0.01);
});

test('primeira parcela SAC = amortização + juros sobre o saldo cheio', () => {
  const w = carregar();
  // 100.000/120 = 833,33 de amortização + 1% de 100.000 = 1.000 → 1.833,33
  perto(w.finPrimeiraParcelaSac(100000, 0.01, 120), 1833.33, 0.01);
});

// ---- juros restantes ---------------------------------------------------

test('juros do SAC seguem i·SD·(n+1)/2', () => {
  const w = carregar();
  const esperado = (0.008 * 300000 * (240 + 1)) / 2;
  perto(w.finJurosRestantes('sac', 300000, 0.008, 240), esperado, 0.01);
  perto(w.finJurosRestantes('sac', 300000, 0.008, 240), 289200, 1);
});

test('juros do Price são PMT·n − SD', () => {
  const w = carregar();
  const pmt = w.finParcelaPrice(300000, 0.008, 240);
  perto(w.finJurosRestantes('price', 300000, 0.008, 240), pmt * 240 - 300000, 0.01);
});

test('Price cobra bem mais juros que SAC no mesmo contrato', () => {
  const w = carregar();
  const sac = w.finJurosRestantes('sac', 300000, 0.008, 240);
  const price = w.finJurosRestantes('price', 300000, 0.008, 240);
  // Conferido na mão: 375.840 contra 289.200 nesse contrato.
  assert.ok(price > sac * 1.25, `Price (${price.toFixed(0)}) x SAC (${sac.toFixed(0)})`);
  perto(price, 375840, 50, 'juros do Price');
});

test('sem saldo, sem prazo ou sem juros não gera juros', () => {
  const w = carregar();
  assert.equal(w.finJurosRestantes('sac', 0, 0.01, 120), 0);
  assert.equal(w.finJurosRestantes('sac', 100000, 0.01, 0), 0);
  assert.equal(w.finJurosRestantes('price', 100000, 0, 120), 0);
});

// ---- resumo ------------------------------------------------------------

test('resumo: custo total, juros e patrimônio líquido do bem', () => {
  const w = carregar();
  const r = w.finResumo(
    {
      sistema: 'sac',
      saldoDevedor: 300000,
      taxaMensal: 0.008,
      parcelasRestantes: 240,
      valorPago: 120000,
      valorParcela: 3650,
    },
    500000
  );
  perto(r.jurosRestantes, 289200, 1, 'juros restantes');
  perto(r.totalAPagar, 589200, 1, 'saldo + juros');
  perto(r.custoTotal, 709200, 1, 'já pago + o que falta');
  perto(r.patrimonioLiquido, 200000, 0.01, 'mercado − dívida');
});

test('patrimônio líquido fica negativo quando a dívida passa o valor do bem', () => {
  const w = carregar();
  const r = w.finResumo({ saldoDevedor: 60000, taxaMensal: 0.015, parcelasRestantes: 36 }, 45000);
  perto(r.patrimonioLiquido, -15000, 0.01);
});

test('parcela informada muito fora da esperada é sinalizada', () => {
  const w = carregar();
  // A parcela coerente com 300k/240/0,8% no SAC é ~3.650. Informar 1.200 é
  // incompatível — melhor avisar do que calcular por cima.
  const r = w.finResumo({
    sistema: 'sac',
    saldoDevedor: 300000,
    taxaMensal: 0.008,
    parcelasRestantes: 240,
    valorParcela: 1200,
  });
  assert.ok(r.divergencia !== null, 'deveria sinalizar divergência');
  assert.ok(r.divergencia < 0, 'a informada está abaixo da esperada');
});

test('parcela coerente não gera alarme falso', () => {
  const w = carregar();
  const esperada = w.finPrimeiraParcelaSac(300000, 0.008, 240);
  const r = w.finResumo({
    sistema: 'sac',
    saldoDevedor: 300000,
    taxaMensal: 0.008,
    parcelasRestantes: 240,
    valorParcela: esperada * 1.03,
  });
  assert.equal(r.divergencia, null);
});

// ---- simulação de amortização -----------------------------------------

test('antecipar reduz juros nas duas estratégias', () => {
  const w = carregar();
  const fin = { sistema: 'sac', saldoDevedor: 300000, taxaMensal: 0.008, parcelasRestantes: 240 };
  const sim = w.finSimularAmortizacao(fin, 50000);

  assert.ok(sim.prazo.economia > 0);
  assert.ok(sim.parcela.economia > 0);
  assert.ok(sim.prazo.parcelas < 240, 'reduzir prazo encurta o contrato');
  assert.equal(sim.parcela.parcelas, 240, 'reduzir parcela mantém o prazo');
});

test('reduzir PRAZO economiza mais juros que reduzir PARCELA', () => {
  const w = carregar();
  for (const sistema of ['sac', 'price']) {
    const sim = w.finSimularAmortizacao(
      { sistema, saldoDevedor: 300000, taxaMensal: 0.008, parcelasRestantes: 240 },
      50000
    );
    assert.ok(
      sim.prazo.economia > sim.parcela.economia,
      `${sistema}: prazo ${sim.prazo.economia.toFixed(0)} deveria superar parcela ${sim.parcela.economia.toFixed(0)}`
    );
  }
});

test('reduzir parcela realmente diminui o valor mensal', () => {
  const w = carregar();
  const fin = { sistema: 'price', saldoDevedor: 300000, taxaMensal: 0.008, parcelasRestantes: 240 };
  const antes = w.finParcelaPrice(300000, 0.008, 240);
  const sim = w.finSimularAmortizacao(fin, 50000);
  assert.ok(sim.parcela.novaParcela < antes);
  // O saldo caiu 1/6, então a parcela cai na mesma proporção no Price.
  perto(sim.parcela.novaParcela, antes * (250000 / 300000), 1);
});

test('SAC: reduzir prazo mantém a amortização e corta parcelas na proporção', () => {
  const w = carregar();
  // A = 300.000/240 = 1.250. Antecipar 50.000 tira 40 parcelas.
  const sim = w.finSimularAmortizacao(
    { sistema: 'sac', saldoDevedor: 300000, taxaMensal: 0.008, parcelasRestantes: 240 },
    50000
  );
  assert.equal(sim.prazo.parcelas, 200);
  assert.equal(sim.prazo.parcelasReduzidas, 40);
});

test('antecipar o saldo inteiro quita e zera os juros', () => {
  const w = carregar();
  const fin = { sistema: 'sac', saldoDevedor: 80000, taxaMensal: 0.01, parcelasRestantes: 48 };
  const sim = w.finSimularAmortizacao(fin, 80000);
  assert.equal(sim.quitou, true);
  assert.equal(sim.prazo.parcelas, 0);
  assert.equal(sim.prazo.economia, sim.jurosAtuais, 'economiza todos os juros futuros');
});

test('antecipar mais que o saldo não gera economia fantasma', () => {
  const w = carregar();
  const sim = w.finSimularAmortizacao(
    { sistema: 'price', saldoDevedor: 80000, taxaMensal: 0.01, parcelasRestantes: 48 },
    120000
  );
  assert.equal(sim.quitou, true);
  assert.equal(sim.prazo.economia, sim.jurosAtuais);
});

test('antecipar zero não muda nada', () => {
  const w = carregar();
  const sim = w.finSimularAmortizacao(
    { sistema: 'sac', saldoDevedor: 80000, taxaMensal: 0.01, parcelasRestantes: 48 },
    0
  );
  assert.equal(sim.prazo.economia, 0);
  assert.equal(sim.parcela.economia, 0);
  assert.equal(sim.prazo.parcelas, 48);
});

test('financiamento sem saldo ou sem prazo não simula', () => {
  const w = carregar();
  assert.equal(w.finSimularAmortizacao({ saldoDevedor: 0, parcelasRestantes: 10 }, 100), null);
  assert.equal(w.finSimularAmortizacao({ saldoDevedor: 1000, parcelasRestantes: 0 }, 100), null);
});

// ---- soma das dívidas --------------------------------------------------

test('totalDividaBens soma só os bens ativos e financiados', () => {
  const w = carregar();
  w.bens.length = 0;
  w.bens.push(
    {
      id: 'a',
      nome: 'Apto',
      arquivado: false,
      valorAtual: 500000,
      financiamento: { ativo: true, saldoDevedor: 300000 },
    },
    {
      id: 'b',
      nome: 'Carro',
      arquivado: false,
      valorAtual: 60000,
      financiamento: { ativo: true, saldoDevedor: 20000 },
    },
    { id: 'c', nome: 'Moto quitada', arquivado: false, valorAtual: 15000, financiamento: null },
    {
      id: 'd',
      nome: 'Antigo',
      arquivado: true,
      valorAtual: 90000,
      financiamento: { ativo: true, saldoDevedor: 50000 },
    }
  );
  assert.equal(w.totalDividaBens(), 320000, 'arquivado e quitado ficam de fora');
});

test('o patrimônio dos bens continua contando o valor cheio', () => {
  // Decisão de produto: os KPIs não descontam a dívida; ela aparece à parte.
  const w = carregar();
  w.bens.length = 0;
  w.bens.push({
    id: 'a',
    nome: 'Apto',
    arquivado: false,
    valorAtual: 500000,
    financiamento: { ativo: true, saldoDevedor: 300000 },
  });
  assert.equal(w.totalBensAtual(), 500000);
});
