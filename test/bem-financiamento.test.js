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
    // Um nó falso sem setAttribute mente sobre o que um elemento é: código de
    // acessibilidade (aria-pressed, aria-expanded) explode aqui e passa no
    // navegador.
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
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
  // incompatível — melhor avisar do que calcular por cima. E 1.200 fica ABAIXO
  // do piso sem juros (300k/240 = 1.250), então nenhuma taxa a explica: não há
  // alternativa a oferecer, mas o conflito continua sinalizado.
  const r = w.finResumo({
    sistema: 'sac',
    saldoDevedor: 300000,
    taxaInformada: 0.008,
    parcelasRestantes: 240,
    valorParcela: 1200,
  });
  assert.equal(r.taxa.conflito, true, 'deveria sinalizar conflito');
  assert.equal(r.taxa.taxaImplicita, null, 'nenhuma taxa explica essa parcela');
  assert.equal(r.taxa.escolha, null, 'sem alternativa, não há escolha a fazer');
  assert.equal(r.taxaMensal, 0.008, 'na falta de alternativa, segue a digitada');
});

test('parcela coerente não gera alarme falso', () => {
  const w = carregar();
  const esperada = w.finPrimeiraParcelaSac(300000, 0.008, 240);
  const r = w.finResumo({
    sistema: 'sac',
    saldoDevedor: 300000,
    taxaInformada: 0.008,
    parcelasRestantes: 240,
    valorParcela: esperada * 1.03,
  });
  assert.equal(r.taxa.conflito, false);
  assert.equal(r.taxaMensal, 0.008, 'concordando, vale a taxa que a pessoa digitou');
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

// ============================================================
// === TAXA IMPLÍCITA: o que a parcela informada está dizendo ===
// ============================================================
//
// Quando os quatro dados (saldo, parcela, taxa, prazo) não fecham, avisar "não
// fecha" deixa a pessoa sem saber qual conferir. Invertendo a fórmula pela
// parcela — o número que ela tem na mão, no boleto — sai a taxa que explicaria
// aquele valor, e daí a explicação provável do erro de digitação.

test('SAC: a taxa implícita sai da parcela informada', () => {
  const w = carregar();
  // parcela₁ = sd/n + sd·i  →  36800/45 + 36800·0,0074 = 817,78 + 272,32
  const i = w.finTaxaImplicita('sac', 36800, 1090, 45);
  assert.ok(Math.abs(i - 0.007397) < 1e-5, 'esperado ~0,74% a.m., veio ' + i);
  // Volta e meia: a taxa encontrada reproduz a parcela informada.
  assert.ok(Math.abs(w.finPrimeiraParcelaSac(36800, i, 45) - 1090) < 0.01);
});

test('Price: a bissecção encontra a taxa que reproduz a parcela', () => {
  const w = carregar();
  const parcela = w.finParcelaPrice(300000, 0.008, 240); // 2.899,52...
  const i = w.finTaxaImplicita('price', 300000, parcela, 240);
  assert.ok(Math.abs(i - 0.008) < 1e-6, 'esperado 0,8% a.m., veio ' + i);
});

test('parcela abaixo do piso sem juros não tem taxa que explique', () => {
  const w = carregar();
  // Sem juros nenhum a parcela já seria 36800/45 = 817,78.
  assert.equal(w.finTaxaImplicita('sac', 36800, 700, 45), null);
  assert.equal(w.finTaxaImplicita('price', 36800, 700, 45), null);
  assert.equal(w.finTaxaImplicita('sac', 0, 1090, 45), null);
  assert.equal(w.finTaxaImplicita('sac', 36800, 0, 45), null);
  assert.equal(w.finTaxaImplicita('sac', 36800, 1090, 0), null);
});

test('diagnóstico: casa decimal a menos na taxa', () => {
  const w = carregar();
  // O caso real que motivou a tela: digitou 7,3 onde cabia 0,73.
  assert.equal(w.finDiagnosticoTaxa(0.073, 0.007397), 'decimal');
});

test('diagnóstico: taxa do ano digitada no campo do mês', () => {
  const w = carregar();
  const mensal = 0.0072;
  const anualComposta = Math.pow(1 + mensal, 12) - 1; // ~8,99%
  assert.equal(w.finDiagnosticoTaxa(anualComposta, mensal), 'anual');
  // Muita gente usa a conta simples (×12) — cai no mesmo diagnóstico, não em
  // 'decimal', porque 12× está dentro da faixa das duas regras.
  assert.equal(w.finDiagnosticoTaxa(mensal * 12, mensal), 'anual');
});

test('diagnóstico não chuta quando a diferença não tem padrão conhecido', () => {
  const w = carregar();
  assert.equal(w.finDiagnosticoTaxa(0.012, 0.008), null, '1,5× não é erro típico');
  assert.equal(w.finDiagnosticoTaxa(0.5, 0.008), null, '62× não é erro típico');
  assert.equal(w.finDiagnosticoTaxa(0, 0.008), null);
  assert.equal(w.finDiagnosticoTaxa(0.008, 0), null);
});

test('havendo conflito, a parcela ganha da taxa digitada por padrão', () => {
  const w = carregar();
  const caso = {
    ativo: true,
    sistema: 'sac',
    saldoDevedor: 36800,
    valorParcela: 1090,
    taxaInformada: 0.073,
    parcelasRestantes: 45,
  };
  const r = w.finResumo(caso, 0);
  assert.equal(r.taxa.conflito, true, 'a parcela informada não fecha com a taxa');
  assert.equal(r.taxa.escolha, 'parcela', 'o padrão é acreditar na parcela');
  assert.equal(r.taxa.causa, 'decimal');
  assert.ok(Math.abs(r.taxa.taxaImplicita - 0.007397) < 1e-5);
  assert.equal(r.taxa.taxaInformada, 0.073, 'a digitada segue disponível para a tela');
  // O que muda de verdade: o número grande da tela.
  assert.ok(Math.abs(r.taxaMensal - 0.007397) < 1e-5, 'calcula pela taxa da parcela');
  assert.ok(Math.abs(r.jurosRestantes - 6261.11) < 0.5, 'R$ 6.261, não R$ 61.787');
  assert.ok(Math.abs(r.parcelaEsperada - 1090) < 0.01, 'e a parcela volta a bater');
});

test('escolhendo a taxa, a conta passa a ser feita por ela', () => {
  const w = carregar();
  const r = w.finResumo(
    {
      ativo: true,
      sistema: 'sac',
      saldoDevedor: 36800,
      valorParcela: 1090,
      taxaInformada: 0.073,
      parcelasRestantes: 45,
      fonteVerdade: 'taxa',
    },
    0
  );
  assert.equal(r.taxa.escolha, 'taxa');
  assert.equal(r.taxaMensal, 0.073);
  assert.ok(Math.abs(r.jurosRestantes - 61787.2) < 0.01);
  assert.ok(Math.abs(r.parcelaEsperada - 3504.18) < 0.01, 'a parcela que essa taxa produz');
});

test('sem conflito não há escolha nem alternativa a mostrar', () => {
  const w = carregar();
  const r = w.finResumo(
    {
      ativo: true,
      sistema: 'sac',
      saldoDevedor: 36800,
      valorParcela: 1090.1,
      taxaInformada: 0.0074,
      parcelasRestantes: 45,
    },
    0
  );
  assert.equal(r.taxa.conflito, false);
  assert.equal(r.taxa.escolha, null);
  assert.equal(r.taxa.causa, null);
  assert.equal(r.taxa.origem, 'informada');
});

test('corrigindo a taxa, os juros caem para a ordem de grandeza real', () => {
  const w = carregar();
  // Mesmo saldo e prazo, taxa certa: R$ 61.787 viram R$ 6.261. É a diferença
  // entre um número que assusta e um que informa.
  const errado = w.finJurosRestantes('sac', 36800, 0.073, 45);
  const certo = w.finJurosRestantes('sac', 36800, 0.007397, 45);
  assert.ok(Math.abs(errado - 61787.2) < 0.01);
  assert.ok(Math.abs(certo - 6261.0) < 5, 'esperado ~R$ 6.261, veio ' + certo);
});

// ============================================================
// === TAXA DEDUZIDA, SEGUROS E SALDO x TOTAL A PAGAR        ===
// ============================================================
//
// A taxa é o dado que a pessoa mais erra: o contrato traz nominal a.a.,
// efetiva a.a., CET a.a. e CET a.m., e ela escolhe uma e converte. Saldo,
// parcela e prazo estão na mesma tela do app do banco. Então a taxa deixou de
// ser obrigatória — é deduzida da parcela — e o conflito virou escolha.

test('sem taxa digitada, a taxa sai da parcela', () => {
  const w = carregar();
  const r = w.finResumo({
    sistema: 'sac',
    saldoDevedor: 36800,
    valorParcela: 1090,
    parcelasRestantes: 45,
  });
  assert.equal(r.taxa.origem, 'derivada');
  assert.ok(Math.abs(r.taxaMensal - 0.007397) < 1e-5);
  assert.equal(r.taxa.conflito, false, 'não há taxa digitada com que conflitar');
  assert.ok(Math.abs(r.jurosRestantes - 6261.11) < 0.5);
});

test('seguros e tarifas saem da parcela antes de inverter a conta', () => {
  const w = carregar();
  const base = { sistema: 'sac', saldoDevedor: 36800, valorParcela: 1090, parcelasRestantes: 45 };
  const semSeguro = w.finResolverTaxa(base);
  const comSeguro = w.finResolverTaxa(Object.assign({}, base, { segurosTarifas: 80 }));
  // R$ 80 do boleto não são juro: a taxa real é menor, e por uma margem que
  // importa — 0,74% vira 0,52%, quase um terço a menos.
  assert.ok(Math.abs(semSeguro.taxaMensal - 0.007397) < 1e-5);
  assert.ok(Math.abs(comSeguro.taxaMensal - 0.005223) < 1e-5);
  assert.equal(comSeguro.parcelaLiquida, 1010, 'inverte pela parcela sem os acessórios');
  assert.ok(comSeguro.taxaMensal < semSeguro.taxaMensal, 'ignorar seguro superestima o juro');
});

test('seguro maior que a parcela não vira taxa negativa', () => {
  const w = carregar();
  const r = w.finResolverTaxa({
    sistema: 'sac',
    saldoDevedor: 36800,
    valorParcela: 1090,
    segurosTarifas: 5000,
    parcelasRestantes: 45,
  });
  assert.equal(r.parcelaLiquida, 0);
  assert.equal(r.taxaImplicita, null);
  assert.equal(r.taxaMensal, 0);
  assert.equal(r.origem, 'nenhuma');
});

test('saldo igual a parcela × prazo denuncia o total a pagar', () => {
  const w = carregar();
  // 1.090 × 45 = 49.050. Quem copia esse número do app do banco está pegando o
  // total que falta pagar (juros embutidos), não o saldo devedor de hoje.
  assert.equal(w.finSaldoPareceTotalAPagar(49050, 1090, 45), true);
  assert.equal(w.finSaldoPareceTotalAPagar(48000, 1090, 45), true, 'até 5% de folga');
  assert.equal(w.finSaldoPareceTotalAPagar(36800, 1090, 45), false, 'saldo de verdade');
  assert.equal(w.finSaldoPareceTotalAPagar(0, 1090, 45), false);
  assert.equal(w.finSaldoPareceTotalAPagar(49050, 0, 45), false);
});

test('o resumo carrega a suspeita do saldo para a tela', () => {
  const w = carregar();
  const r = w.finResumo({
    sistema: 'sac',
    saldoDevedor: 49050,
    valorParcela: 1090,
    parcelasRestantes: 45,
  });
  assert.equal(r.taxa.saldoPareceTotal, true);
  // Sem juros na conta, porque parcela × prazo já é o total: o número não
  // mente, mas a tela precisa avisar que a entrada é que está errada.
  assert.equal(r.taxa.taxaImplicita, null);
  assert.equal(r.jurosRestantes, 0);
});

test('a taxa resolvida é a que fica gravada e alimenta a antecipação', () => {
  const w = carregar();
  // O simulador de antecipação lê financiamento.taxaMensal direto. Se ali
  // ficasse a taxa digitada errada, a economia simulada sairia inflada junto.
  const fin = {
    ativo: true,
    sistema: 'sac',
    saldoDevedor: 36800,
    valorParcela: 1090,
    taxaInformada: 0.073,
    parcelasRestantes: 45,
  };
  const resolvida = w.finResolverTaxa(fin);
  const gravado = Object.assign({}, fin, { taxaMensal: resolvida.taxaMensal });
  const sim = w.finSimularAmortizacao(gravado, 5000);
  assert.ok(Math.abs(sim.jurosAtuais - 6261.11) < 0.5, 'usa a taxa da parcela, não a digitada');
  assert.ok(sim.prazo.economia > 0 && sim.prazo.economia < 6261.11);
});

test('registro antigo, gravado quando a taxa era obrigatória, segue valendo', () => {
  const w = carregar();
  // Não tem taxaInformada; o que existe é taxaMensal, digitada pela pessoa.
  const r = w.finResolverTaxa({
    sistema: 'sac',
    saldoDevedor: 300000,
    valorParcela: 3650,
    taxaMensal: 0.008,
    parcelasRestantes: 240,
  });
  assert.equal(r.taxaInformada, 0.008, 'lê a taxa do formato antigo');
  assert.equal(r.origem, 'informada');
  assert.equal(r.conflito, false);
});

// ============================================================
// === REGISTRO ANTIGO: reconhecer sem obrigar a recadastrar  ===
// ============================================================
//
// Quem cadastrou antes de a taxa virar opcional pode ter uma taxa que não
// combina com a própria parcela, e nunca foi perguntado. Tudo que lê
// `taxaMensal` — a simulação de antecipação, sobretudo — está prometendo
// número errado até alguém revisar. O app precisa reconhecer esses registros
// sem exigir que a pessoa apague e cadastre de novo.

test('registro anterior à mudança, com taxa que não bate, é sinalizado', () => {
  const w = carregar();
  assert.equal(
    w.finConflitoNaoRevisado({
      ativo: true,
      sistema: 'sac',
      saldoDevedor: 36800,
      valorParcela: 1090,
      taxaMensal: 0.073,
      parcelasRestantes: 45,
    }),
    true
  );
});

test('registro antigo coerente não é sinalizado', () => {
  const w = carregar();
  assert.equal(
    w.finConflitoNaoRevisado({
      ativo: true,
      sistema: 'sac',
      saldoDevedor: 300000,
      valorParcela: 3650,
      taxaMensal: 0.008,
      parcelasRestantes: 240,
    }),
    false
  );
});

test('depois de revisado, o mesmo conflito para de cutucar', () => {
  const w = carregar();
  const revisado = {
    ativo: true,
    sistema: 'sac',
    saldoDevedor: 36800,
    valorParcela: 1090,
    taxaInformada: 0.073,
    taxaMensal: 0.007397,
    parcelasRestantes: 45,
    fonteVerdade: 'parcela',
  };
  // O conflito continua existindo — a pessoa é que já escolheu em quem acreditar.
  assert.equal(w.finResolverTaxa(revisado).conflito, true);
  assert.equal(w.finConflitoNaoRevisado(revisado), false);
  // Inclusive quem escolheu ficar com a taxa digitada.
  assert.equal(
    w.finConflitoNaoRevisado(Object.assign({}, revisado, { fonteVerdade: 'taxa' })),
    false
  );
});

test('bem quitado ou sem financiamento nunca é sinalizado', () => {
  const w = carregar();
  assert.equal(w.finConflitoNaoRevisado(null), false);
  assert.equal(w.finConflitoNaoRevisado({ ativo: false, saldoDevedor: 36800 }), false);
});
