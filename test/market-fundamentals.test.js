'use strict';

// /api/market?op=fundamentals e ?op=rendafixa — normalização dos dados que
// alimentam o motor da Carteira Recomendada.
//
// Esta é a camada onde erro passa despercebido: a BRAPI devolve razão num
// campo (returnOnEquity = 0.185) e percentagem em outro (debtToEquity =
// 45.3), e vários indicadores que o motor usa não existem em campo nenhum —
// saem de conta feita aqui (dívida líquida/EBITDA, CAGR, payout, DY médio).
// Um fator 100 trocado não quebra nada: só faz o ranking inteiro mentir.
//
// Por isso o teste é sobre CONVERSÃO e DERIVAÇÃO, não sobre rede. Nada aqui
// chama BRAPI, CoinGecko ou Tesouro — todas as funções exercitadas são puras.

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const market = require(path.resolve(__dirname, '..', 'api', 'market.js'));

const {
  fundAgregarDividendos,
  fundCrescimentoDre,
  fundCobertura,
  mapBrapiFundamental,
  mapTesouroTitulo,
  parseTesouroResposta,
  rfClassificarTipo,
  PREMISSAS_ANUAIS,
  CHAVES_ACAO,
} = market.__test || {};

const AGORA = Date.parse('2026-08-21T12:00:00Z');
const MES = 30.4 * 24 * 3600 * 1000;

test('o módulo expõe os normalizadores de fundamentos para teste', () => {
  assert.equal(typeof mapBrapiFundamental, 'function');
  assert.equal(typeof mapTesouroTitulo, 'function');
  assert.equal(typeof fundAgregarDividendos, 'function');
});

// ════════════════════════════════════════════
// Proventos
// ════════════════════════════════════════════

/** Pagamentos mensais de valor fixo, terminando `mesesAtras` meses atrás. */
function mensais(qtd, valor, comecaMesesAtras) {
  const out = [];
  for (let i = 0; i < qtd; i++) {
    out.push({
      rate: valor,
      paymentDate: new Date(AGORA - (comecaMesesAtras - i) * MES).toISOString(),
    });
  }
  return out;
}

test('lista vazia ou sem pagamento válido devolve tudo null (e não zero)', () => {
  for (const entrada of [null, [], undefined, [{ rate: null }], [{ rate: 1, paymentDate: 'xx' }]]) {
    const r = fundAgregarDividendos(entrada, 10, AGORA);
    assert.equal(r.dy, null, 'sem provento é ausência de dado, não DY de 0%');
    assert.equal(r.anosPagandoDividendo, null);
  }
});

test('DY de 12 meses usa só a janela de 12 meses', () => {
  // 24 pagamentos de R$0,10; só os 12 últimos entram no DY corrente.
  const r = fundAgregarDividendos(mensais(24, 0.1, 23.5), 10, AGORA);
  assert.ok(Math.abs(r.dividendos12m - 1.2) < 0.01, `somou ${r.dividendos12m}`);
  assert.ok(Math.abs(r.dy - 12) < 0.2, `DY veio ${r.dy}`);
});

test('consistência conta MESES pagos nos últimos 24, não pagamentos', () => {
  const mensal = fundAgregarDividendos(mensais(24, 0.1, 23.5), 10, AGORA);
  assert.ok(
    mensal.consistenciaDividendos > 95,
    `FII mensal veio com ${mensal.consistenciaDividendos}%`
  );

  // Ação que paga 2x por ano em 2 anos: 4 pagamentos, 4 meses distintos.
  const semestral = [0, 6, 12, 18].map((m) => ({
    rate: 0.5,
    paymentDate: new Date(AGORA - (m + 0.5) * MES).toISOString(),
  }));
  const r = fundAgregarDividendos(semestral, 10, AGORA);
  assert.ok(
    r.consistenciaDividendos < 25,
    `semestral não pode parecer mensal (${r.consistenciaDividendos}%)`
  );
});

test('crescimento do dividendo compara os dois blocos de 12 meses', () => {
  const anterior = mensais(12, 0.1, 23.5); // 12 meses anteriores: R$1,20
  const recente = mensais(12, 0.15, 11.5); // 12 meses correntes: R$1,80
  const r = fundAgregarDividendos([...anterior, ...recente], 10, AGORA);
  assert.ok(Math.abs(r.crescimentoDividendo12m - 50) < 1, `veio ${r.crescimentoDividendo12m}%`);
});

test('DY médio de 5 anos dilui pelo número de anos da janela', () => {
  // 5 anos pagando R$1,20/ano com a cota a R$10 → DY médio de 12%.
  const r = fundAgregarDividendos(mensais(60, 0.1, 59.5), 10, AGORA);
  assert.ok(Math.abs(r.dyMedio5a - 12) < 0.3, `DY médio 5a veio ${r.dyMedio5a}`);
  assert.ok(r.anosPagandoDividendo >= 5);
});

test('sem preço não há DY, mas o histórico continua contando', () => {
  const r = fundAgregarDividendos(mensais(24, 0.1, 23.5), null, AGORA);
  assert.equal(r.dy, null);
  assert.ok(r.dividendos12m > 0);
  assert.ok(r.consistenciaDividendos > 0);
});

// ════════════════════════════════════════════
// DRE
// ════════════════════════════════════════════

test('CAGR sai do primeiro ao último exercício, em qualquer ordem de entrada', () => {
  // 100 -> 200 em 4 anos ≈ 18,92% a.a.
  const hist = [
    { endDate: '2026-12-31', totalRevenue: 200, netIncome: 40 },
    { endDate: '2022-12-31', totalRevenue: 100, netIncome: 10 },
    { endDate: '2024-12-31', totalRevenue: 140, netIncome: 22 },
  ];
  const r = fundCrescimentoDre(hist);
  assert.ok(Math.abs(r.cagrReceita5a - 18.92) < 0.3, `receita: ${r.cagrReceita5a}`);
  assert.ok(r.cagrLucro5a > 40, `lucro 4x em 4 anos: ${r.cagrLucro5a}`);
  assert.equal(r.anosDre, 3);
});

test('receita em queda devolve CAGR negativo', () => {
  const r = fundCrescimentoDre([
    { endDate: '2022-12-31', totalRevenue: 200, netIncome: 30 },
    { endDate: '2026-12-31', totalRevenue: 100, netIncome: 10 },
  ]);
  assert.ok(r.cagrReceita5a < 0, `veio ${r.cagrReceita5a}`);
});

test('prejuízo não vira CAGR: log de número negativo não existe', () => {
  const r = fundCrescimentoDre([
    { endDate: '2022-12-31', totalRevenue: 100, netIncome: -20 },
    { endDate: '2026-12-31', totalRevenue: 150, netIncome: 30 },
  ]);
  assert.equal(r.cagrLucro5a, null, 'sair do prejuízo não é taxa de crescimento');
  assert.ok(r.cagrReceita5a > 0, 'a receita continua calculável');
});

test('histórico curto demais não inventa crescimento', () => {
  assert.equal(
    fundCrescimentoDre([{ endDate: '2026-12-31', totalRevenue: 100 }]).cagrReceita5a,
    null
  );
  assert.equal(fundCrescimentoDre(null).cagrReceita5a, null);
  assert.equal(fundCrescimentoDre([]).anosDre, 0);
});

// ════════════════════════════════════════════
// Mapeamento BRAPI
// ════════════════════════════════════════════

const BRAPI_COMPLETO = {
  symbol: 'bbas3',
  longName: 'Banco do Brasil S.A.',
  regularMarketPrice: 28.5,
  regularMarketVolume: 2000000,
  marketCap: 160000000000,
  priceEarnings: 4.5,
  priceToBook: 0.8,
  earningsPerShare: 6.3,
  summaryProfile: { sector: 'Financial Services', industry: 'Banks' },
  defaultKeyStatistics: { enterpriseToEbitda: 5.2, trailingEps: 6.3 },
  financialData: {
    returnOnEquity: 0.204, // razão
    profitMargins: 0.251, // razão
    ebitdaMargins: 0.33, // razão
    revenueGrowth: 0.087, // razão
    currentRatio: 1.6,
    totalCash: 30000000000,
    totalDebt: 90000000000,
    ebitda: 40000000000,
    debtToEquity: 45.3, // percentagem
  },
  incomeStatementHistory: [
    { endDate: '2022-12-31', totalRevenue: 100000, netIncome: 20000 },
    { endDate: '2026-12-31', totalRevenue: 150000, netIncome: 35000 },
  ],
  dividendsData: { cashDividends: mensais(24, 0.1, 23.5) },
};

test('campos em razão viram percentagem; campos já em percentagem não são multiplicados', () => {
  const d = mapBrapiFundamental(BRAPI_COMPLETO, AGORA);
  assert.ok(Math.abs(d.roe - 20.4) < 0.01, `ROE veio ${d.roe} (esperado 20,4%)`);
  assert.ok(Math.abs(d.margemLiquida - 25.1) < 0.01);
  assert.ok(Math.abs(d.margemEbitda - 33) < 0.01);
  assert.ok(Math.abs(d.crescimentoReceitaAno - 8.7) < 0.01);
});

test('dívida líquida é derivada de caixa e dívida bruta, não copiada', () => {
  const d = mapBrapiFundamental(BRAPI_COMPLETO, AGORA);
  // (90bi - 30bi) / 40bi = 1,5x
  assert.ok(Math.abs(d.dividaLiquidaEbitda - 1.5) < 0.001, `veio ${d.dividaLiquidaEbitda}`);
  // Patrimônio = marketCap / P/VP = 160bi / 0,8 = 200bi → 60bi/200bi = 0,3x
  assert.ok(Math.abs(d.dividaLiquidaPl - 0.3) < 0.001, `veio ${d.dividaLiquidaPl}`);
});

test('sem caixa e sem EBITDA, cai para debtToEquity convertido de %', () => {
  const semDetalhe = {
    ...BRAPI_COMPLETO,
    priceToBook: null,
    defaultKeyStatistics: {},
    financialData: { debtToEquity: 45.3 },
  };
  const d = mapBrapiFundamental(semDetalhe, AGORA);
  assert.ok(Math.abs(d.dividaLiquidaPl - 0.453) < 0.001, `veio ${d.dividaLiquidaPl}`);
  assert.equal(d.dividaLiquidaEbitda, null, 'sem EBITDA não há múltiplo de dívida');
});

test('payout sai do dividendo pago sobre o lucro por ação', () => {
  const d = mapBrapiFundamental(BRAPI_COMPLETO, AGORA);
  // R$1,20 pagos / LPA 6,30 ≈ 19%
  assert.ok(Math.abs(d.payout - 19.05) < 0.5, `payout veio ${d.payout}`);
});

test('liquidez diária é volume x preço, não volume cru', () => {
  const d = mapBrapiFundamental(BRAPI_COMPLETO, AGORA);
  assert.equal(d.liquidezDiaria, 2000000 * 28.5);
});

test('ticker é normalizado para maiúsculas e o setor vem do perfil', () => {
  const d = mapBrapiFundamental(BRAPI_COMPLETO, AGORA);
  assert.equal(d.ticker, 'BBAS3');
  assert.equal(d.setor, 'Financial Services');
  assert.equal(d.nome, 'Banco do Brasil S.A.');
});

test('resposta sem os módulos pagos devolve nulls, não zeros', () => {
  // É o caso do plano grátis da BRAPI — tem de degradar, não mentir.
  const magro = { symbol: 'PETR4', regularMarketPrice: 38.2, shortName: 'PETROBRAS PN' };
  const d = mapBrapiFundamental(magro, AGORA);
  assert.equal(d.roe, null);
  assert.equal(d.dividaLiquidaEbitda, null);
  assert.equal(d.cagrReceita5a, null);
  assert.equal(d.dy, null);
  assert.equal(d.preco, 38.2, 'o que existe continua vindo');
  assert.ok(fundCobertura(d, CHAVES_ACAO) < 0.15);
});

test('cobertura mede a fração de indicadores preenchidos', () => {
  const cheio = mapBrapiFundamental(BRAPI_COMPLETO, AGORA);
  const magro = mapBrapiFundamental({ symbol: 'X', regularMarketPrice: 10 }, AGORA);
  assert.ok(fundCobertura(cheio, CHAVES_ACAO) > 0.7, 'resposta completa devia cobrir a maioria');
  assert.ok(fundCobertura(cheio, CHAVES_ACAO) > fundCobertura(magro, CHAVES_ACAO));
  assert.equal(fundCobertura(cheio, []), 0);
});

// ════════════════════════════════════════════
// Tesouro Direto
// ════════════════════════════════════════════

test('classificação do título sai do nome', () => {
  assert.equal(rfClassificarTipo('Tesouro IPCA+ 2035'), 'ipca');
  assert.equal(rfClassificarTipo('Tesouro Selic 2029'), 'selic');
  assert.equal(rfClassificarTipo('Tesouro Prefixado 2027'), 'prefixado');
  assert.equal(rfClassificarTipo('Tesouro RENDA+ Aposentadoria Extra 2065'), 'ipca');
});

test('IPCA+: a taxa publicada JÁ é a taxa real', () => {
  const t = mapTesouroTitulo(
    { ticker: 'T', nome: 'Tesouro IPCA+ 2035', taxa: 7.2 },
    PREMISSAS_ANUAIS
  );
  assert.equal(t.taxaRealAnual, 7.2);
  // Nominal = (1,072 x 1,045) - 1 ≈ 12,02%
  assert.ok(Math.abs(t.taxaNominalAnual - 12.02) < 0.05, `nominal veio ${t.taxaNominalAnual}`);
});

test('prefixado: a taxa publicada é nominal e precisa ser deflacionada', () => {
  const t = mapTesouroTitulo(
    { ticker: 'T', nome: 'Tesouro Prefixado 2029', taxa: 13.0 },
    PREMISSAS_ANUAIS
  );
  assert.equal(t.taxaNominalAnual, 13.0);
  // (1,13 / 1,045) - 1 ≈ 8,13%
  assert.ok(Math.abs(t.taxaRealAnual - 8.13) < 0.05, `real veio ${t.taxaRealAnual}`);
  assert.ok(t.taxaRealAnual < t.taxaNominalAnual);
});

test('Selic: a taxa publicada é spread sobre a Selic, não a taxa toda', () => {
  const t = mapTesouroTitulo(
    { ticker: 'T', nome: 'Tesouro Selic 2029', taxa: 0.15 },
    PREMISSAS_ANUAIS
  );
  // Ler 0,15 como taxa cheia daria um título rendendo 0,15% ao ano.
  assert.ok(Math.abs(t.taxaNominalAnual - 13.4) < 0.01, `nominal veio ${t.taxaNominalAnual}`);
  assert.ok(t.taxaRealAnual > 8, `real veio ${t.taxaRealAnual}`);
  assert.ok(Math.abs(t.premioSobreCdi - 101.13) < 0.1);
});

test('título com juros semestrais é marcado como gerador de renda', () => {
  const comCupom = mapTesouroTitulo(
    { ticker: 'T', nome: 'Tesouro IPCA+ com Juros Semestrais 2045', taxa: 7 },
    PREMISSAS_ANUAIS
  );
  const semCupom = mapTesouroTitulo(
    { ticker: 'T', nome: 'Tesouro IPCA+ 2045', taxa: 7 },
    PREMISSAS_ANUAIS
  );
  assert.equal(comCupom.geraRendaPeriodica, 1);
  assert.equal(semCupom.geraRendaPeriodica, 0);
});

test('todo título do Tesouro entra com risco de emissor máximo e liquidez diária', () => {
  const t = mapTesouroTitulo(
    { ticker: 'T', nome: 'Tesouro Selic 2031', taxa: 0.1 },
    PREMISSAS_ANUAIS
  );
  assert.equal(t.riscoEmissor, 10);
  assert.equal(t.liquidezDias, 1);
  assert.equal(t.classe, 'rf');
});

test('título sem nome ou sem taxa é descartado em vez de virar NaN', () => {
  assert.equal(mapTesouroTitulo({ ticker: 'T', nome: null, taxa: 7 }, PREMISSAS_ANUAIS), null);
  assert.equal(
    mapTesouroTitulo({ ticker: 'T', nome: 'Tesouro X', taxa: null }, PREMISSAS_ANUAIS),
    null
  );
});

test('parse do Tesouro aceita os dois formatos e ignora item quebrado', () => {
  const resposta = {
    response: {
      TrsrBdTradgList: [
        {
          TrsrBd: {
            nm: 'Tesouro Selic 2029',
            anulInvstmtRate: 0.15,
            mtrtyDt: '2029-03-01',
            untrInvstmtVal: 15000,
          },
        },
        { TrsrBd: { nm: 'Tesouro IPCA+ 2035', anulInvstmtRate: 7.2 } },
        { TrsrBd: { nm: 'Sem taxa' } },
        { TrsrBd: { anulInvstmtRate: 9 } },
        null,
      ],
    },
  };
  const r = parseTesouroResposta(resposta);
  assert.equal(r.length, 2, 'os dois títulos válidos passam, os quebrados caem');
  assert.equal(r[0].ticker, 'TESOURO_SELIC_2029');
  assert.equal(r[1].ticker, 'TESOURO_IPCA_2035');
  assert.equal(r[0].precoUnitario, 15000);
});

test('parse do Tesouro tolera resposta com formato inesperado', () => {
  assert.deepEqual(parseTesouroResposta(null), []);
  assert.deepEqual(parseTesouroResposta({}), []);
  assert.deepEqual(parseTesouroResposta({ response: {} }), []);
});

test('as premissas de taxa são as mesmas da simulação histórica', () => {
  // Divergir aqui faria a mesma tela mostrar dois CDIs diferentes.
  assert.equal(PREMISSAS_ANUAIS.CDI, 0.1325);
  assert.equal(PREMISSAS_ANUAIS.IPCA, 0.045);
  assert.equal(PREMISSAS_ANUAIS.SELIC, PREMISSAS_ANUAIS.CDI);
});
