'use strict';

// Fase 4 da avaliação de investimentos:
//  - "Sua carteira x mercado": rentabilidade da carteira (Dietz modificado,
//    mês a mês, encadeado) contra CDI, Ibovespa e IPCA reais;
//  - "Imposto de renda das vendas": apuração mensal com isenção de R$ 20 mil,
//    compensação de prejuízo, FII a 20%, IRRF e DARF mínimo de R$ 10.
//
// Os índices eram curvas sintéticas de juro constante; o servidor agora lê o
// Banco Central (CDI, IPCA) e o Yahoo (Ibovespa) e só cai na premissa,
// marcada, quando a fonte não responde.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const market = require(path.join(ROOT, 'api', 'market.js'));

function carregar(arquivos, globais) {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Date,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    isFinite,
    formatarMoeda: (v) => 'R$ ' + v.toFixed(2),
    document: { getElementById: () => null },
    ...globais,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const a of arquivos) vm.runInContext(fs.readFileSync(path.join(ROOT, a), 'utf8'), ctx);
  return ctx;
}

const iso = (s) => new Date(s + 'T12:00:00-03:00').toISOString();
const op = (ticker, tipo, quantidade, preco, data, subcategoria) => ({
  ticker,
  tipo,
  quantidade,
  preco_op: preco,
  data_op: iso(data),
  categoria: 'renda_variavel',
  subcategoria,
});

// ------------------------------------------------------------------- IR

test('IR: ações até R$ 20 mil vendidos no mês são isentas', () => {
  const ctx = carregar(['web/appliquei-ir.js']);
  const r = ctx.irApurar([
    op('AAAA3', 'compra', 1000, 12, '2026-01-10', 'acoes'),
    op('AAAA3', 'venda', 1000, 15, '2026-03-10', 'acoes'),
  ]);
  const m = r.meses[0];
  assert.equal(m.isentoAcoes, true);
  assert.equal(m.lucroIsento, 3000);
  assert.equal(m.darf, 0);
});

test('IR: acima de R$ 20 mil, 15% sobre o lucro menos o IRRF, vence no fim do mês seguinte', () => {
  const ctx = carregar(['web/appliquei-ir.js']);
  const r = ctx.irApurar([
    op('AAAA3', 'compra', 1000, 25, '2026-01-10', 'acoes'),
    op('AAAA3', 'compra', 1000, 25, '2026-02-10', 'acoes'),
    op('AAAA3', 'venda', 1000, 30, '2026-10-05', 'acoes'),
  ]);
  const m = r.meses[0];
  assert.equal(m.isentoAcoes, false);
  assert.equal(m.lucroAcoes, 5000, 'preço médio de R$ 25');
  assert.ok(Math.abs(m.darf - (750 - 30000 * 0.00005)) < 1e-9);
  assert.equal(m.vencimento, '2026-11-30');
});

test('IR: prejuízo compensa o lucro dos meses seguintes, mesmo vindo de mês isento', () => {
  const ctx = carregar(['web/appliquei-ir.js']);
  const r = ctx.irApurar([
    op('AAAA3', 'compra', 2000, 10, '2026-01-10', 'acoes'),
    op('AAAA3', 'venda', 1000, 8, '2026-02-10', 'acoes'), // prejuízo 2 mil, mês isento
    op('BBBB3', 'compra', 1000, 20, '2026-02-15', 'acoes'),
    op('BBBB3', 'venda', 1000, 25, '2026-03-10', 'acoes'), // lucro 5 mil, vendas 25 mil
  ]);
  const [fev, mar] = r.meses;
  assert.equal(fev.prejuizoComum, 2000);
  assert.equal(mar.compensadoComum, 2000);
  assert.ok(Math.abs(mar.darf - (3000 * 0.15 - 25000 * 0.00005)) < 1e-9);
  assert.equal(r.prejuizoComum, 0);
});

test('IR: FII paga 20% sem isenção; ETF e BDR não têm a isenção das ações', () => {
  const ctx = carregar(['web/appliquei-ir.js']);
  const r = ctx.irApurar([
    op('FUND11', 'compra', 100, 100, '2026-01-10', 'fiis'),
    op('FUND11', 'venda', 50, 120, '2026-04-10', 'fiis'), // lucro 1.000, vendas 6.000
    op('INDX11', 'compra', 100, 100, '2026-01-10', 'etfs'),
    op('INDX11', 'venda', 50, 110, '2026-05-10', 'etfs'), // lucro 500, vendas 5.500
  ]);
  const [abr, mai] = r.meses;
  assert.ok(Math.abs(abr.darf - (200 - 6000 * 0.00005)) < 1e-9);
  assert.ok(Math.abs(mai.darf - (75 - 5500 * 0.00005)) < 1e-9);
});

test('IR: DARF abaixo de R$ 10 passa para o mês seguinte', () => {
  const ctx = carregar(['web/appliquei-ir.js']);
  const r = ctx.irApurar([
    op('FUND11', 'compra', 100, 100, '2026-01-10', 'fiis'),
    op('FUND11', 'venda', 10, 103, '2026-04-10', 'fiis'), // lucro 30 → 6
    op('FUND11', 'venda', 10, 103, '2026-05-10', 'fiis'), // mais 6 → 12
  ]);
  const [abr, mai] = r.meses;
  assert.equal(abr.darf, 0);
  assert.ok(abr.passaParaProximo > 5);
  assert.ok(mai.darf > 10, 'soma o que ficou do mês anterior');
});

test('IR: cripto isenta até R$ 35 mil no mês; acima, 15% do ganho (DARF 4600)', () => {
  const ctx = carregar(['web/appliquei-ir.js']);
  const r = ctx.irApurar([
    op('BTC', 'compra', 1, 30000, '2026-01-10', 'cripto'),
    op('BTC', 'venda', 1, 40000, '2026-06-10', 'cripto'),
  ]);
  assert.equal(r.meses[0].isentoCripto, false);
  assert.equal(r.meses[0].darfCripto, 1500);
  assert.equal(r.meses[0].darf, 0, 'cripto não entra no DARF 6015');
});

test('IR: vencimento no último dia útil (fim de semana recua)', () => {
  const ctx = carregar(['web/appliquei-ir.js']);
  assert.equal(ctx.irVencimentoDarf('2026-04'), '2026-05-29', '31/05/2026 é domingo');
  assert.equal(ctx.irVencimentoDarf('2026-12'), '2027-01-29', '31/01/2027 é domingo');
});

test('IR: o card mostra o DARF, o prejuízo e o aviso de estimativa', () => {
  const ctx = carregar(['web/appliquei-ir.js']);
  const html = ctx.htmlImpostoRenda(
    ctx.irApurar([
      op('AAAA3', 'compra', 2000, 25, '2026-01-10', 'acoes'),
      op('AAAA3', 'venda', 1000, 30, '2026-10-05', 'acoes'),
      op('AAAA3', 'venda', 1000, 20, '2026-11-05', 'acoes'),
    ])
  );
  assert.match(html, /DARF <b class="valor-mascarado">R\$ 748\.50<\/b> · código 6015/);
  assert.match(html, /Prejuízo para compensar: ações\/ETF\/BDR/);
  assert.match(html, /Não inclui day trade/);
  assert.equal(ctx.htmlImpostoRenda(ctx.irApurar([])), '');
});

// ------------------------------------------------------------- desempenho

const MES = 30 * 24 * 3600 * 1000;

function cenario() {
  const ini = Date.parse('2025-10-01T00:00:00-03:00');
  // Preço sobe de 10 para 12 em 12 meses, um fechamento no início de cada mês.
  const serie = [];
  for (let i = 0; i <= 12; i++) {
    const d = new Date(ini);
    serie.push({
      t: new Date(d.getFullYear(), d.getMonth() + i, 1).getTime(),
      p: 10 + (2 * i) / 12,
    });
  }
  return { ini, serie };
}

test('desempenho: aporte no meio do caminho não distorce a rentabilidade (tempo ponderado)', () => {
  const { serie } = cenario();
  const meio = serie[6];
  const ctx = carregar(['web/appliquei-rendimento.js', 'web/appliquei-desempenho.js'], {
    historicoCompras: [
      {
        ticker: 'AAAA3',
        tipo: 'compra',
        quantidade: 100,
        preco_op: 10,
        data_op: new Date(serie[0].t).toISOString(),
        categoria: 'renda_variavel',
      },
      // Segundo aporte, 6 meses depois, ao preço do dia.
      {
        ticker: 'AAAA3',
        tipo: 'compra',
        quantidade: 1000,
        preco_op: meio.p,
        data_op: new Date(meio.t).toISOString(),
        categoria: 'renda_variavel',
      },
    ],
    mockAtivosMercado: [{ ticker: 'AAAA3', preco_atual: 12 }],
  });
  ctx.rendHistorico.AAAA3 = serie;
  const r = ctx.desempenhoRetornoCarteira(serie[0].t, serie[12].t);
  // O ativo subiu 20%: é isso que a carteira rendeu, por maior que tenha
  // sido o segundo aporte. (Valor ÷ aportado daria outro número.)
  assert.ok(Math.abs(r.retorno - 0.2) < 1e-6, String(r.retorno));
  assert.equal(r.estimado, false);
});

test('desempenho: venda não conta como perda e proventos contam como ganho', () => {
  const { serie } = cenario();
  const plano = serie.map((p) => ({ t: p.t, p: 10 }));
  const ctx = carregar(
    [
      'web/appliquei-aba-dividendos.js',
      'web/appliquei-rendimento.js',
      'web/appliquei-desempenho.js',
    ],
    {
      historicoCompras: [
        {
          ticker: 'AAAA3',
          tipo: 'compra',
          quantidade: 100,
          preco_op: 10,
          data_op: new Date(plano[0].t).toISOString(),
          categoria: 'renda_variavel',
        },
        {
          ticker: 'AAAA3',
          tipo: 'venda',
          quantidade: 50,
          preco_op: 10,
          data_op: new Date(plano[3].t).toISOString(),
          categoria: 'renda_variavel',
        },
      ],
      mockAtivosMercado: [{ ticker: 'AAAA3', preco_atual: 10 }],
    }
  );
  ctx.rendHistorico.AAAA3 = plano;
  assert.ok(Math.abs(ctx.desempenhoRetornoCarteira(plano[0].t, plano[12].t).retorno) < 1e-9);
  // Um provento de R$ 0,50 por ação no 2º mês (com 100 ações) = +5%.
  const dia = new Date(plano[1].t + 10 * 24 * 3600 * 1000);
  const ymd = dia.toISOString().slice(0, 10);
  ctx.cacheDividendos.AAAA3 = {
    fetchedAt: Date.now(),
    pagamentos: [{ data: ymd, dataCom: ymd, valor: 0.5 }],
  };
  const r = ctx.desempenhoRetornoCarteira(plano[0].t, plano[12].t).retorno;
  assert.ok(Math.abs(r - 0.05) < 1e-9, String(r));
});

test('desempenho: índice interpolado entre os fechamentos e card com % do CDI', () => {
  const ctx = carregar(['web/appliquei-rendimento.js', 'web/appliquei-desempenho.js'], {
    historicoCompras: [],
  });
  const s = [
    { t: 0, p: 100 },
    { t: 2 * MES, p: 121 },
  ];
  assert.ok(
    Math.abs(ctx.desempenhoNivelEm(s, MES) - 110) < 1e-9,
    'juro composto: meio do caminho é 110'
  );
  assert.equal(ctx.desempenhoNivelEm(s, -1), null);
  const html = ctx.htmlDesempenho({
    iniMs: 0,
    fimMs: 12 * MES,
    carteira: { retorno: 0.088, estimado: false },
    indices: {
      CDI: { retorno: 0.11, ateMs: 12 * MES },
      IBOV: { retorno: -0.03, ateMs: 12 * MES },
      IPCA: { retorno: 0.045, ateMs: 12 * MES },
    },
  });
  assert.match(html, /80% do CDI<\/b> no período — abaixo da renda fixa sem risco/);
  assert.match(html, /Ganho acima da inflação: <b>\+4,1%<\/b>/);
  assert.match(html, /dsp-neg/, 'Ibovespa negativo em vermelho');
  assert.match(html, /Rentabilidade passada não garante resultado futuro/);
});

test('servidor: CDI do Banco Central vira índice base 100, mês a mês', () => {
  const s = market.historico.indiceDeSgsMensal([
    { data: '01/08/2026', valor: '1.00' },
    { data: '01/09/2026', valor: '0,50' },
  ]);
  assert.equal(s.length, 3);
  assert.equal(s[0].p, 100);
  assert.ok(Math.abs(s[2].p - 101.505) < 1e-9);
  assert.ok(s[1].t > s[0].t && s[2].t > s[1].t);
});

test('a tela liga os dois cards', () => {
  const html = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
  assert.match(html, /<div id="cardDesempenho"/);
  assert.match(html, /<div id="cardImpostoRenda"/);
  assert.ok(
    html.indexOf('src="/web/appliquei-rendimento.js') <
      html.indexOf('src="/web/appliquei-desempenho.js'),
    'desempenho usa rendCarteiraEm'
  );
});
