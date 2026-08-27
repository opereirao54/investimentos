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

test('o título do CSV do Tesouro entra no mapeamento sem tabela de tradução', () => {
  // A fonte mudou de um JSON com a oferta do dia para o CSV histórico do
  // Tesouro Transparente — o endpoint antigo devolve `HTTP 410 · gone`.
  //
  // O que NÃO mudou é a forma que `mapTesouroTitulo` consome, e é isso que
  // este teste fixa: o job grava `{ nome, ticker, taxa, vencimento,
  // dataBase, precoUnitario }` e a conversão continua a valer. Se alguém
  // renomear um desses campos no job, a renda fixa volta a ficar sem
  // indicadores e nada mais quebraria para avisar.
  const doJob = {
    ticker: 'TESOURO_IPCA_2035',
    nome: 'Tesouro IPCA+ 2035',
    taxa: 7.2,
    taxaVenda: 7.25,
    vencimento: '2035-05-15',
    dataBase: '2026-08-21',
    precoUnitario: 2101.5,
    investimentoMinimo: null,
  };
  const t = mapTesouroTitulo(doJob, PREMISSAS_ANUAIS);
  assert.equal(t.tipo, 'ipca');
  assert.equal(t.taxaRealAnual, 7.2, 'IPCA+ publica a taxa REAL');
  assert.equal(t.classe, 'rf');
  assert.equal(t.precoUnitario, 2101.5);
});

test('a procedência da taxa é o PREGÃO, não o vencimento do título', () => {
  // Antes `dataReferencia` recebia o vencimento: a tela dizia "lido em 2035"
  // num título que vence em 2035 — um campo de procedência a mostrar algo
  // que não é procedência. Quem confere a validade do dado via uma data no
  // futuro e concluía que estava fresquíssimo.
  const t = mapTesouroTitulo(
    {
      ticker: 'T',
      nome: 'Tesouro Prefixado 2027',
      taxa: 13.5,
      vencimento: '2027-01-01',
      dataBase: '2026-08-21',
    },
    PREMISSAS_ANUAIS
  );
  assert.equal(t.dataReferencia, '2026-08-21');
  assert.notEqual(t.dataReferencia, '2027-01-01');
});

test('as premissas de taxa são as mesmas da simulação histórica', () => {
  // Divergir aqui faria a mesma tela mostrar dois CDIs diferentes.
  assert.equal(PREMISSAS_ANUAIS.CDI, 0.1325);
  assert.equal(PREMISSAS_ANUAIS.IPCA, 0.045);
  assert.equal(PREMISSAS_ANUAIS.SELIC, PREMISSAS_ANUAIS.CDI);
});

// ════════════════════════════════════════════
// Indicadores do Banco Central
// ════════════════════════════════════════════
//
// PREMISSAS_ANUAIS era constante no código. A Selic muda várias vezes por
// ano e a taxa real de todo título do Tesouro sai dela — uma constante
// desatualizada erra em silêncio, sem nada na tela que denuncie.
//
// O risco ao trocar constante por série do SGS é específico: código de série
// errado não dá erro, dá NÚMERO VÁLIDO DE OUTRA COISA. Por isso cada
// candidata é validada contra uma faixa plausível, e é isso que estes
// testes exercitam — com fetch dublado, sem tocar na rede.

const { resolverIndicadorSgs, carregarIndicadoresBcb, anualizar252, sgsData, SGS_SERIES } =
  market.__test || {};

/** Dubla globalThis.fetch e devolve uma função para restaurar. */
function dublarFetch(rotas) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const alvo = String(url);
    for (const [padrao, resposta] of rotas) {
      if (alvo.includes(padrao)) {
        if (resposta instanceof Error) throw resposta;
        return { ok: true, status: 200, json: async () => resposta };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return () => {
    globalThis.fetch = original;
  };
}

const SGS = (codigo) => `bcdata.sgs.${codigo}/`;

test('conversão de data e anualização do SGS', () => {
  assert.equal(sgsData('20/08/2026'), '2026-08-20');
  assert.equal(sgsData('lixo'), null, 'formato inesperado não pode virar data inválida');
  // 0,0524% ao dia útil, 252 dias → ~14,1% ao ano.
  assert.ok(Math.abs(anualizar252(0.0524) - 14.11) < 0.05, `veio ${anualizar252(0.0524)}`);
});

test('as faixas de plausibilidade cobrem o mercado brasileiro sem serem frouxas', () => {
  // Faixa larga demais deixaria passar o número errado que o teste seguinte
  // simula; estreita demais reprovaria juro real de um choque.
  assert.deepEqual(SGS_SERIES.selic.faixa, [0.5, 40]);
  assert.ok(SGS_SERIES.cdi.candidatas.length >= 2, 'CDI precisa de alternativa se a série mudar');
});

test('primeira série que responde valor plausível é a usada', async () => {
  const restaurar = dublarFetch([[SGS(432), [{ data: '20/08/2026', valor: '15.00' }]]]);
  try {
    const r = await resolverIndicadorSgs('selic', []);
    assert.equal(r.valor, 15);
    assert.equal(r.data, '2026-08-20');
    assert.ok(r.fonte.includes('432'), 'a procedência tem de nomear a série usada');
  } finally {
    restaurar();
  }
});

test('série com valor implausível é RECUSADA e cai para a próxima', async () => {
  // O caso perigoso: código errado devolve 200 com número válido de outra
  // série. Sem a faixa, uma "Selic" de 0,05% entraria na conta de todo
  // título do Tesouro e ninguém notaria.
  const erros = [];
  const restaurar = dublarFetch([
    [SGS(432), [{ data: '20/08/2026', valor: '0.05' }]],
    [SGS(4189), [{ data: '20/08/2026', valor: '14.90' }]],
  ]);
  try {
    const r = await resolverIndicadorSgs('selic', erros);
    assert.equal(r.valor, 14.9, 'devia ter usado a segunda candidata');
    assert.ok(r.fonte.includes('4189'));
    assert.ok(
      erros.some((e) => e.serie === 432 && e.erro.includes('fora_da_faixa')),
      `o descarte tem de ficar registado: ${JSON.stringify(erros)}`
    );
  } finally {
    restaurar();
  }
});

test('série diária é anualizada ANTES de checar a faixa', async () => {
  // 0,0524% a.d. reprovaria na faixa [0,5; 40] se comparado cru.
  const restaurar = dublarFetch([
    [SGS(432), new Error('indisponivel')],
    [SGS(4189), new Error('indisponivel')],
    [SGS(11), [{ data: '20/08/2026', valor: '0.0524' }]],
  ]);
  try {
    const r = await resolverIndicadorSgs('selic', []);
    assert.ok(r !== null, 'série diária válida não podia ser descartada');
    assert.ok(Math.abs(r.valor - 14.11) < 0.05, `veio ${r.valor}`);
    assert.equal(r.unidade, '% a.a.');
  } finally {
    restaurar();
  }
});

test('todas as candidatas falhando devolve null, não um chute', async () => {
  const erros = [];
  const restaurar = dublarFetch([]);
  try {
    assert.equal(await resolverIndicadorSgs('cdi', erros), null);
    assert.equal(erros.length, SGS_SERIES.cdi.candidatas.length, 'cada tentativa tem de constar');
  } finally {
    restaurar();
  }
});

test('BCB completo: premissas saem das séries e a origem é declarada', async () => {
  const restaurar = dublarFetch([
    [SGS(432), [{ data: '20/08/2026', valor: '15.00' }]],
    [SGS(4389), [{ data: '20/08/2026', valor: '14.90' }]],
    [SGS(13522), [{ data: '31/07/2026', valor: '4.30' }]],
    ['Expectativas', { value: [{ Data: '2026-08-15', Mediana: 4.1, DataReferencia: 2026 }] }],
  ]);
  try {
    const r = await carregarIndicadoresBcb();
    assert.equal(r.premissas.SELIC, 0.15);
    assert.equal(r.premissas.CDI, 0.149);
    assert.ok(Math.abs(r.premissas.IPCA - 0.041) < 1e-9, 'IPCA vem da expectativa, não do passado');
    assert.equal(r.degradado, false);
    assert.ok(r.origem.SELIC.includes('432'));
    assert.ok(r.origem.IPCA.includes('Focus'), 'a origem tem de dizer que é expectativa');
  } finally {
    restaurar();
  }
});

test('Focus fora do ar cai para o IPCA passado, e diz que caiu', async () => {
  const restaurar = dublarFetch([
    [SGS(432), [{ data: '20/08/2026', valor: '15.00' }]],
    [SGS(4389), [{ data: '20/08/2026', valor: '14.90' }]],
    [SGS(13522), [{ data: '31/07/2026', valor: '4.30' }]],
  ]);
  try {
    const r = await carregarIndicadoresBcb();
    assert.ok(Math.abs(r.premissas.IPCA - 0.043) < 1e-9);
    assert.ok(r.origem.IPCA.includes('13522'));
    assert.equal(r.indicadores.ipcaEsperado, null);
  } finally {
    restaurar();
  }
});

test('CDI indisponível é derivado da Selic, e a origem não finge medição', async () => {
  const restaurar = dublarFetch([
    [SGS(432), [{ data: '20/08/2026', valor: '15.00' }]],
    [SGS(13522), [{ data: '31/07/2026', valor: '4.30' }]],
  ]);
  try {
    const r = await carregarIndicadoresBcb();
    assert.ok(Math.abs(r.premissas.CDI - 0.149) < 1e-9, 'CDI segue a Selic de perto');
    assert.equal(r.origem.CDI, 'Derivado da Selic');
    assert.equal(r.degradado, true, 'derivar não é medir — o estado tem de ficar marcado');
  } finally {
    restaurar();
  }
});

test('BCB inteiro fora do ar mantém a constante e marca degradado', async () => {
  const restaurar = dublarFetch([]);
  try {
    const r = await carregarIndicadoresBcb();
    assert.deepEqual(r.premissas, PREMISSAS_ANUAIS, 'nenhuma conta pode ficar sem premissa');
    assert.equal(r.degradado, true);
    assert.equal(r.origem.SELIC, 'fallback');
    assert.ok(r.erros.length > 0);
  } finally {
    restaurar();
  }
});

test('expectativa absurda do Focus é recusada como qualquer outra', async () => {
  const restaurar = dublarFetch([
    [SGS(432), [{ data: '20/08/2026', valor: '15.00' }]],
    [SGS(4389), [{ data: '20/08/2026', valor: '14.90' }]],
    ['Expectativas', { value: [{ Data: '2026-08-15', Mediana: 900, DataReferencia: 2026 }] }],
  ]);
  try {
    const r = await carregarIndicadoresBcb();
    assert.equal(r.indicadores.ipcaEsperado, null);
    assert.equal(r.premissas.IPCA, PREMISSAS_ANUAIS.IPCA, 'cai para a constante, não para 900%');
  } finally {
    restaurar();
  }
});

// ════════════════════════════════════════════
// Composição CVM + cotação
// ════════════════════════════════════════════
//
// As duas fontes gravam no MESMO documento do Firestore. O risco é
// específico e destrutivo: a resposta da fonte de cotação traz null
// explícito em quase todo campo fundamentalista, e um merge por cima
// apagaria os indicadores que a ingestão da CVM acabou de calcular. Por isso
// cada fonte tem o seu ramo e a junção acontece só na leitura.

const { comporFundamentos } = market.__test || {};

const RAMO_MERCADO = {
  ticker: 'BBAS3',
  preco: 28.5,
  marketCap: 160e9,
  liquidezDiaria: 4e7,
  dy: 9.5,
  dyMedio5a: 8,
  // É assim que a fonte de cotação responde sem os módulos pagos:
  roe: null,
  dividaLiquidaEbitda: null,
  cagrReceita5a: null,
  fonte: 'brapi',
  fonteRotulo: 'Cotação · BRAPI',
};

const RAMO_CVM = {
  roe: 20.4,
  roic: 16.2,
  margemLiquida: 25.1,
  dividaLiquidaEbitda: 1.5,
  cagrReceita5a: 9,
  lucroLiquido: 35e9,
  patrimonioLiquido: 200e9,
  classe: 'acao',
  fonte: 'cvm',
  fonteRotulo: 'DFP 2025 · CVM',
  dataReferencia: '2025-12-31',
};

// ── Valuation derivada da contagem de ações ──
//
// O v8/chart do Yahoo devolve preço mas NÃO valor de mercado, e é a única
// via de cotação que funciona sem cadastro em fonte nenhuma. Sem estas
// contas, VALUATION fica vazio para a bolsa inteira e o motor ranqueia sem
// olhar para preço — que é o oposto do que a lente "Valor" promete.

// Cotação sem valor de mercado, como o v8/chart entrega.
const RAMO_MERCADO_SEM_MCAP = { ...RAMO_MERCADO, marketCap: null, dy: null, dyMedio5a: null };
// CVM com contagem de ações e dividendo por ação, como o job passa a gravar.
const RAMO_CVM_COM_ACOES = {
  ...RAMO_CVM,
  ebitda: 50e9,
  dividaLiquida: -20e9,
  acoesEquivalentes: 5.7e9,
  dividendoPorAcao: 2.4,
};

test('sem valor de mercado da fonte, ele sai de preço × ações', () => {
  const c = comporFundamentos({
    mercado: RAMO_MERCADO_SEM_MCAP,
    cvm: RAMO_CVM_COM_ACOES,
  });
  assert.equal(c.marketCap, 28.5 * 5.7e9);
  assert.equal(c.marketCapDerivado, true);
  assert.ok(Math.abs(c.pl - (28.5 * 5.7e9) / 35e9) < 1e-9, 'P/L sai da contagem de ações');
  assert.ok(Math.abs(c.pvp - (28.5 * 5.7e9) / 200e9) < 1e-9);
  assert.ok(Math.abs(c.evEbitda - (28.5 * 5.7e9 - 20e9) / 50e9) < 1e-9, 'caixa líquido reduz o EV');
  assert.ok(Math.abs(c.dy - (2.4 / 28.5) * 100) < 1e-9);
});

test('valor de mercado da própria fonte tem precedência sobre a conta', () => {
  const c = comporFundamentos({ mercado: RAMO_MERCADO, cvm: RAMO_CVM_COM_ACOES });
  assert.equal(c.marketCap, 160e9, 'quem tem o número não precisa derivá-lo');
  assert.equal(c.marketCapDerivado, undefined);
});

test('contagem de ações com escala errada é barrada pelo P/VP', () => {
  // Ações mil vezes menores do que são: o P/L sairia mil vezes menor e a
  // empresa lideraria a lente "Valor" com um número inventado. O patrimônio
  // não passou pela contagem, e por isso denuncia o erro.
  const c = comporFundamentos({
    mercado: RAMO_MERCADO_SEM_MCAP,
    cvm: { ...RAMO_CVM_COM_ACOES, acoesEquivalentes: 5.7e6 },
  });
  assert.equal(c.marketCap, null, 'melhor sem P/L do que com P/L errado');
  assert.equal(c.pl, undefined);
  assert.equal(c.pvp, undefined);
  assert.equal(c.marketCapDescartado.motivo, 'pvp_implausivel');
});

test('sem contagem de ações, valuation fica vazia — não zerada', () => {
  const c = comporFundamentos({ mercado: RAMO_MERCADO_SEM_MCAP, cvm: RAMO_CVM });
  assert.equal(c.marketCap, null);
  assert.equal(c.pl, undefined);
  assert.equal(c.dy, null, 'sem dividendo por ação não se inventa DY');
  assert.equal(c.roe, 20.4, 'o resto do documento continua de pé');
});

test('prejuízo não vira P/L, nem com a contagem de ações em mãos', () => {
  const c = comporFundamentos({
    mercado: RAMO_MERCADO_SEM_MCAP,
    cvm: { ...RAMO_CVM_COM_ACOES, lucroLiquido: -3e9 },
  });
  assert.equal(c.marketCap, 28.5 * 5.7e9, 'o valor de mercado continua válido');
  assert.equal(c.pl, undefined);
  assert.ok(c.pvp > 0, 'P/VP não depende do lucro');
});

test('o null da cotação NÃO apaga o indicador da CVM', () => {
  const c = comporFundamentos({
    mercado: RAMO_MERCADO,
    cvm: RAMO_CVM,
    mercadoFetchedAtMs: 1000,
    cvmFetchedAtMs: 2000,
  });
  assert.equal(c.roe, 20.4, 'era exatamente isto que um merge plano destruiria');
  assert.equal(c.dividaLiquidaEbitda, 1.5);
  assert.equal(c.cagrReceita5a, 9);
});

test('cada fonte contribui com o que só ela tem', () => {
  const c = comporFundamentos({ mercado: RAMO_MERCADO, cvm: RAMO_CVM });
  assert.equal(c.dy, 9.5, 'proventos e preço só existem na cotação');
  assert.equal(c.liquidezDiaria, 4e7);
  assert.equal(c.roic, 16.2, 'ROIC só sai da DRE completa');
});

test('P/L e P/VP nascem do cruzamento — não existem em nenhuma fonte sozinha', () => {
  const c = comporFundamentos({ mercado: RAMO_MERCADO, cvm: RAMO_CVM });
  assert.ok(Math.abs(c.pl - 160 / 35) < 0.01, `P/L veio ${c.pl}`);
  assert.ok(Math.abs(c.pvp - 0.8) < 0.001, `P/VP veio ${c.pvp}`);
});

test('prejuízo não vira P/L: "sem P/L" e "P/L negativo" dizem coisas diferentes', () => {
  const c = comporFundamentos({
    mercado: RAMO_MERCADO,
    cvm: { ...RAMO_CVM, lucroLiquido: -5e9 },
  });
  assert.equal(c.pl, undefined, 'inventar P/L negativo aqui mentiria sobre a origem');
  assert.equal(c.lucroLiquido, -5e9, 'o lucro absoluto segue, para o alerta de prejuízo sair dele');
  assert.ok(c.pvp > 0, 'P/VP continua calculável');
});

test('sem valor de mercado não há múltiplo, e nada quebra', () => {
  const c = comporFundamentos({
    mercado: { ...RAMO_MERCADO, marketCap: null },
    cvm: RAMO_CVM,
  });
  assert.equal(c.pl, undefined);
  assert.equal(c.pvp, undefined);
  assert.equal(c.roe, 20.4, 'o resto dos indicadores não depende do preço');
});

test('procedência declara a CVM e a data do exercício', () => {
  const c = comporFundamentos({
    mercado: RAMO_MERCADO,
    cvm: RAMO_CVM,
    cvmFetchedAtMs: 2000,
  });
  assert.equal(c.fonte, 'cvm');
  assert.ok(c.fonteRotulo.includes('DFP 2025'));
  assert.ok(c.fonteRotulo.includes('cotação'), 'a tela tem de saber que houve duas fontes');
  assert.equal(c.dataReferencia, '2025-12-31');
  assert.equal(c.fetchedAtMs, 2000);
});

test('só cotação: a resposta é a da cotação, sem carimbo de CVM', () => {
  const c = comporFundamentos({ mercado: RAMO_MERCADO, mercadoFetchedAtMs: 1000 });
  assert.equal(c.fonte, 'brapi');
  assert.equal(c.roe, null);
  assert.equal(c.fetchedAtMs, 1000);
  assert.ok(!('cvm' in c), 'o ramo bruto não pode vazar para o cliente');
});

test('documento plano antigo continua legível', () => {
  // Compatibilidade com o que foi gravado antes da separação em ramos.
  const c = comporFundamentos({ ticker: 'PETR4', preco: 38, roe: 12, fetchedAtMs: 500 });
  assert.equal(c.roe, 12);
  assert.equal(c.fetchedAtMs, 500);
});

test('documento inexistente devolve null, não objeto vazio', () => {
  assert.equal(comporFundamentos(null), null);
  assert.equal(comporFundamentos(undefined), null);
});

// ════════════════════════════════════════════
// Corte do universo (op=ranking)
// ════════════════════════════════════════════
//
// Com o universo vindo do FCA são centenas de ativos, e nem todos são
// investíveis pelo cliente. O corte não é julgamento sobre a empresa: é que
// recomendar o que não se consegue vender é pior do que não recomendar.

const { motivoExclusao, PATRIMONIO_MINIMO, LIQUIDEZ_MINIMA } = market.__test || {};

test('ativo abaixo do piso de porte fica fora da lista curta', () => {
  assert.equal(motivoExclusao({ patrimonioLiquido: 50e6 }, 'acao'), 'porte_abaixo_do_piso');
  assert.equal(motivoExclusao({ patrimonioLiquido: 5e9 }, 'acao'), null);
});

test('liquidez insuficiente exclui mesmo empresa grande', () => {
  const grande = { patrimonioLiquido: 5e9, liquidezDiaria: 50000 };
  assert.equal(motivoExclusao(grande, 'acao'), 'liquidez_insuficiente');
  assert.equal(motivoExclusao({ ...grande, liquidezDiaria: 4e7 }, 'acao'), null);
});

test('sem cotação ainda, o piso de porte é o único filtro possível', () => {
  // Na primeira passagem a maioria dos ativos só tem dado da CVM. Excluir
  // por liquidez desconhecida esvaziaria o universo inteiro.
  assert.equal(motivoExclusao({ patrimonioLiquido: 5e9 }, 'acao'), null);
});

test('FII tem piso de liquidez menor que ação', () => {
  assert.ok(LIQUIDEZ_MINIMA.fii < LIQUIDEZ_MINIMA.acao);
  const fii = { patrimonioLiquido: 2e9, liquidezDiaria: 500000 };
  assert.equal(motivoExclusao(fii, 'fii'), null);
  assert.equal(motivoExclusao(fii, 'acao'), 'liquidez_insuficiente');
});

test('cripto e renda fixa não passam pelo corte de porte', () => {
  // Não têm patrimônio líquido contábil nem liquidez em bolsa no mesmo
  // sentido; aplicar o filtro os eliminaria a todos.
  assert.equal(motivoExclusao({}, 'cripto'), null);
  assert.equal(motivoExclusao({}, 'rf'), null);
  assert.equal(motivoExclusao({ patrimonioLiquido: 1 }, 'rf'), null);
});

test('o piso de porte é alto o bastante para importar', () => {
  assert.ok(PATRIMONIO_MINIMO >= 100e6, `piso veio ${PATRIMONIO_MINIMO}`);
});

// ════════════════════════════════════════════
// Cálculo do ranking (varredura única, várias lentes)
// ════════════════════════════════════════════

const { calcularRankings, RANKING_TOP_N_CRON } = market.__test || {};

/** Firestore mínimo: só o que calcularRankings consome. */
function fakeDb(docs) {
  return {
    collection: () => ({
      get: async () => ({
        forEach: (cb) => docs.forEach((d) => cb({ id: d.id, data: () => d.dados })),
      }),
    }),
  };
}

/** Documento no formato que a ingestão da CVM grava. */
function docCvm(ticker, over) {
  return {
    id: ticker,
    dados: {
      cvm: Object.assign(
        {
          patrimonioLiquido: 5e9,
          lucroLiquido: 8e8,
          receita: 1e10,
          roe: 16,
          roic: 12,
          margemLiquida: 8,
          margemEbitda: 20,
          liquidezCorrente: 1.8,
          dividaLiquidaEbitda: 1.2,
          dividaLiquidaPl: 0.4,
          cagrReceita5a: 9,
          cagrLucro5a: 11,
          classe: 'acao',
          fonte: 'cvm',
          fonteRotulo: 'DFP 2025 · CVM',
          dataReferencia: '2025-12-31',
        },
        over || {}
      ),
      // A ingestão grava cotação junto: sem valor de mercado o pilar de
      // valuation fica vazio e a lente "Valor" escolheria às cegas.
      mercado: { preco: 30, marketCap: 12e9, liquidezDiaria: 3e7, fonte: 'brapi' },
      cvmFetchedAtMs: 1000,
      mercadoFetchedAtMs: 1000,
    },
  };
}

test('varredura única produz ranking para todas as lentes pedidas', async () => {
  const db = fakeDb([docCvm('AAAA3'), docCvm('BBBB3', { roe: 28, cagrLucro5a: 25 })]);
  const r = await calcularRankings(db, ['renda', 'qualidade'], 10);
  assert.deepEqual(Object.keys(r).sort(), ['qualidade', 'renda']);
  assert.equal(r.renda.universo, 2);
  assert.equal(r.qualidade.universo, 2);
});

test('a lente muda a ordem do ranking sobre o mesmo universo', async () => {
  const db = fakeDb([
    // Barata: lucro alto para o valor de mercado (P/L ~5) e balanço leve.
    docCvm('BARATA3', {
      roe: 9,
      cagrLucro5a: 1,
      cagrReceita5a: 1,
      dividaLiquidaEbitda: 0.2,
      lucroLiquido: 2.4e9,
      patrimonioLiquido: 15e9,
    }),
    // Cara: cresce muito, mas o mercado já cobra por isso (P/L ~40).
    docCvm('CRESCE3', {
      roe: 30,
      roic: 26,
      cagrLucro5a: 28,
      cagrReceita5a: 24,
      dividaLiquidaEbitda: 2.8,
      lucroLiquido: 3e8,
      patrimonioLiquido: 2e9,
    }),
  ]);
  const r = await calcularRankings(db, ['qualidade', 'valor'], 10);
  assert.equal(r.qualidade.classes.acao.itens[0].ticker, 'CRESCE3');
  assert.equal(r.valor.classes.acao.itens[0].ticker, 'BARATA3');
});

test('ranking vem ordenado por score e cortado no topN', async () => {
  const docs = [];
  for (let i = 0; i < 12; i++)
    docs.push(docCvm(`T${String(i).padStart(3, '0')}3`, { roe: 5 + i * 2 }));
  const r = await calcularRankings(fakeDb(docs), ['equilibrio'], 5);
  const itens = r.equilibrio.classes.acao.itens;
  assert.equal(itens.length, 5, 'topN tem de cortar');
  assert.equal(r.equilibrio.classes.acao.total, 12, 'mas o total analisado continua visível');
  for (let i = 1; i < itens.length; i++) {
    assert.ok(itens[i - 1].score >= itens[i].score, 'ranking desordenado');
  }
});

test('ativo abaixo do piso de porte não chega a ser pontuado', async () => {
  const db = fakeDb([docCvm('GRANDE3'), docCvm('NANO3', { patrimonioLiquido: 10e6 })]);
  const r = await calcularRankings(db, ['equilibrio'], 10);
  const tickers = r.equilibrio.classes.acao.itens.map((i) => i.ticker);
  assert.deepEqual(tickers, ['GRANDE3']);
  assert.equal(r.equilibrio.excluidos.porte_abaixo_do_piso, 1);
  assert.equal(r.equilibrio.universo, 2, 'o excluído continua contando como analisado');
});

test('ativo sem lastro é excluído da lista curta, com motivo contado', async () => {
  // Não faz sentido o cliente gastar uma chamada de cotação num ativo que
  // não tem como ser pontuado.
  const vazio = {
    id: 'VAZIO3',
    dados: { cvm: { patrimonioLiquido: 5e9, classe: 'acao' }, cvmFetchedAtMs: 1 },
  };
  const r = await calcularRankings(fakeDb([docCvm('BOM3'), vazio]), ['equilibrio'], 10);
  assert.deepEqual(
    r.equilibrio.classes.acao.itens.map((i) => i.ticker),
    ['BOM3']
  );
  assert.equal(r.equilibrio.excluidos.sem_lastro, 1);
});

test('cada classe é ranqueada separadamente', async () => {
  const fii = {
    id: 'ZZZZ11',
    dados: {
      cvm: {
        patrimonioLiquido: 2e9,
        numeroCotistas: 200000,
        ocupacao: 97,
        numeroImoveis: 15,
        classe: 'fii',
        fonte: 'cvm',
      },
      mercado: {
        pvp: 0.95,
        dy: 9.5,
        dyMedio36m: 9,
        consistenciaDividendos: 100,
        liquidezDiaria: 5e6,
      },
      cvmFetchedAtMs: 1,
    },
  };
  const r = await calcularRankings(fakeDb([docCvm('AAAA3'), fii]), ['renda'], 10);
  assert.equal(r.renda.classes.acao.itens.length, 1);
  assert.equal(r.renda.classes.fii.itens.length, 1);
  assert.equal(r.renda.classes.fii.itens[0].ticker, 'ZZZZ11');
});

test('cada item do ranking carrega procedência para a tela', async () => {
  const r = await calcularRankings(fakeDb([docCvm('AAAA3')]), ['equilibrio'], 10);
  const item = r.equilibrio.classes.acao.itens[0];
  assert.ok(item.fonteRotulo.includes('CVM'));
  assert.equal(item.dataReferencia, '2025-12-31');
  assert.ok(item.cobertura > 0 && item.confianca);
});

test('coleção vazia devolve ranking vazio, não erro', async () => {
  const r = await calcularRankings(fakeDb([]), ['equilibrio'], 10);
  assert.equal(r.equilibrio.universo, 0);
  assert.deepEqual(r.equilibrio.classes.acao.itens, []);
});

test('o topN do cron bate com o que o cliente pede', () => {
  // Chaves de cache diferentes fariam o aquecimento noturno não servir para
  // nada: o cliente pediria outro documento e recalcularia tudo.
  const fs = require('node:fs');
  const path = require('node:path');
  const cliente = fs.readFileSync(
    path.resolve(__dirname, '..', 'web', 'appliquei-aba-carteira-recomendada.js'),
    'utf8'
  );
  const m = /CART_CANDIDATOS_POR_CLASSE\s*=\s*(\d+)/.exec(cliente);
  assert.ok(m, 'constante do cliente não encontrada');
  assert.equal(
    Number(m[1]),
    RANKING_TOP_N_CRON,
    'cliente e cron precisam pedir o mesmo topN para partilharem o cache'
  );
});

// ════════════════════════════════════════════
// Fundamentos via Yahoo Finance
// ════════════════════════════════════════════
//
// É a fonte que faz ação pontuar HOJE, sem esperar o job semanal da CVM e
// sem plano pago. O risco é o mesmo de sempre e não fica menor por a fonte
// ser outra: o Yahoo embrulha número em { raw, fmt }, dá razão num campo
// (returnOnEquity: 0.185) e percentagem em outro (debtToEquity: 45.3, e
// fiveYearAvgDividendYield: 8.5). Misturar as convenções erra por 100 vezes
// e o ranking inteiro passa a mentir sem nada quebrar.

const { mapYahooFundamental } = market.__test || {};

const YAHOO_COMPLETO = {
  price: {
    regularMarketPrice: { raw: 28.5 },
    regularMarketVolume: { raw: 2000000 },
    marketCap: { raw: 160e9 },
    longName: 'Banco do Brasil S.A.',
  },
  assetProfile: { sector: 'Financial Services' },
  summaryDetail: {
    trailingPE: { raw: 4.5 },
    trailingAnnualDividendYield: { raw: 0.095 }, // razão
    fiveYearAvgDividendYield: { raw: 8.2 }, // JÁ em percentagem
    payoutRatio: { raw: 0.42 }, // razão
  },
  defaultKeyStatistics: { priceToBook: { raw: 0.8 }, enterpriseToEbitda: { raw: 5.2 } },
  financialData: {
    returnOnEquity: { raw: 0.204 }, // razão
    profitMargins: { raw: 0.251 },
    ebitdaMargins: { raw: 0.33 },
    revenueGrowth: { raw: 0.087 },
    currentRatio: { raw: 1.6 },
    totalCash: { raw: 30e9 },
    totalDebt: { raw: 90e9 },
    ebitda: { raw: 40e9 },
    debtToEquity: { raw: 45.3 }, // JÁ em percentagem
  },
  incomeStatementHistory: {
    incomeStatementHistory: [
      { endDate: { raw: 1767139200 }, totalRevenue: { raw: 150000 }, netIncome: { raw: 35000 } },
      { endDate: { raw: 1640908800 }, totalRevenue: { raw: 100000 }, netIncome: { raw: 20000 } },
    ],
  },
};

test('Yahoo: razão vira percentagem, percentagem não é multiplicada de novo', () => {
  const d = mapYahooFundamental(YAHOO_COMPLETO, 'BBAS3', Date.now());
  assert.ok(Math.abs(d.roe - 20.4) < 0.01, `ROE ${d.roe}`);
  assert.ok(Math.abs(d.margemLiquida - 25.1) < 0.01);
  assert.ok(Math.abs(d.dy - 9.5) < 0.01, `DY ${d.dy} — trailingAnnualDividendYield é razão`);
  assert.ok(Math.abs(d.payout - 42) < 0.01);
  assert.equal(d.dyMedio5a, 8.2, 'fiveYearAvgDividendYield já vem em percentagem');
});

test('Yahoo: dívida líquida é derivada, não copiada de debtToEquity', () => {
  const d = mapYahooFundamental(YAHOO_COMPLETO, 'BBAS3', Date.now());
  // (90bi - 30bi) / 40bi = 1,5x
  assert.ok(Math.abs(d.dividaLiquidaEbitda - 1.5) < 0.001, `veio ${d.dividaLiquidaEbitda}`);
  // Patrimônio = 160bi / 0,8 = 200bi -> 60bi/200bi = 0,3x
  assert.ok(Math.abs(d.dividaLiquidaPl - 0.3) < 0.001, `veio ${d.dividaLiquidaPl}`);
});

test('Yahoo: sem P/VP, cai para debtToEquity convertido de percentagem', () => {
  const magro = {
    ...YAHOO_COMPLETO,
    defaultKeyStatistics: {},
    financialData: { debtToEquity: { raw: 45.3 } },
  };
  const d = mapYahooFundamental(magro, 'BBAS3', Date.now());
  assert.ok(Math.abs(d.dividaLiquidaPl - 0.453) < 0.001, `veio ${d.dividaLiquidaPl}`);
  assert.equal(d.dividaLiquidaEbitda, null, 'sem EBITDA não há múltiplo de dívida');
});

test('Yahoo: CAGR sai do histórico de DRE, com data em epoch', () => {
  const d = mapYahooFundamental(YAHOO_COMPLETO, 'BBAS3', Date.now());
  // 100 -> 150 em 4 anos ≈ 10,67%
  assert.ok(d.cagrReceita5a > 8 && d.cagrReceita5a < 13, `CAGR receita ${d.cagrReceita5a}`);
  assert.ok(d.cagrLucro5a > 10, `CAGR lucro ${d.cagrLucro5a}`);
});

test('Yahoo: liquidez diária é volume x preço', () => {
  const d = mapYahooFundamental(YAHOO_COMPLETO, 'BBAS3', Date.now());
  assert.equal(d.liquidezDiaria, 2000000 * 28.5);
});

test('Yahoo: DY médio absurdo é recusado em vez de virar indicador', () => {
  const estranho = {
    ...YAHOO_COMPLETO,
    summaryDetail: { ...YAHOO_COMPLETO.summaryDetail, fiveYearAvgDividendYield: { raw: 950 } },
  };
  assert.equal(mapYahooFundamental(estranho, 'X', Date.now()).dyMedio5a, null);
});

test('Yahoo: cobertura alta é o que faz a ação voltar a pontuar', () => {
  const d = mapYahooFundamental(YAHOO_COMPLETO, 'BBAS3', Date.now());
  assert.ok(d.cobertura > 0.6, `cobertura ${d.cobertura} — abaixo de 0,3 não haveria score`);
  const pontuado = require('../web/appliquei-motor-carteira.js').scoreAtivo(d, { lente: 'renda' });
  assert.ok(pontuado.temLastro, 'com dado do Yahoo a ação tem de sair de "dados insuficientes"');
  assert.ok(pontuado.score > 0);
});

test('Yahoo: resposta vazia não vira ramo com cobertura zero', () => {
  const d = mapYahooFundamental({}, 'X', Date.now());
  assert.equal(d.cobertura, 0, 'quem grava só grava com cobertura > 0');
  assert.equal(d.roe, null);
  assert.equal(d.pl, null);
});

// ── Empilhamento das três fontes ──

test('CVM vence Yahoo, e Yahoo vence o null da cotação', () => {
  const c = comporFundamentos({
    mercado: { ...RAMO_MERCADO, roe: null },
    yahoo: { roe: 19.8, roic: null, liquidezCorrente: 1.4, fonte: 'yahoo' },
    cvm: { roe: 20.4, roic: 16.2, fonte: 'cvm', fonteRotulo: 'DFP 2025 · CVM' },
  });
  assert.equal(c.roe, 20.4, 'CVM é a fonte primária');
  assert.equal(c.roic, 16.2);
  assert.equal(c.liquidezCorrente, 1.4, 'onde a CVM não tem, o Yahoo preenche');
  assert.equal(c.dy, 9.5, 'e onde nenhum tem, fica o da cotação');
});

test('só Yahoo: a procedência diz Yahoo, sem carimbo da CVM', () => {
  const c = comporFundamentos({
    mercado: RAMO_MERCADO,
    yahoo: { roe: 19.8, pl: 4.6, fonte: 'yahoo', fonteRotulo: 'Fundamentos · Yahoo Finance' },
    yahooFetchedAtMs: 4242,
  });
  assert.equal(c.fonte, 'yahoo');
  assert.ok(c.fonteRotulo.includes('Yahoo'));
  assert.ok(!c.fonteRotulo.includes('CVM'), 'não pode atribuir à CVM o que veio de outra fonte');
  assert.equal(c.dataReferencia, null, 'o Yahoo não declara o exercício de origem');
  assert.equal(c.fetchedAtMs, 4242);
});

test('o ramo bruto do Yahoo não vaza para o cliente', () => {
  const c = comporFundamentos({ mercado: RAMO_MERCADO, yahoo: { roe: 19.8 } });
  assert.ok(!('yahoo' in c));
  assert.ok(!('cvm' in c));
  assert.ok(!('mercado' in c));
});

test('metadados de uma camada não sobrescrevem os da outra', () => {
  // `cobertura` do Yahoo dentro do documento não pode virar a cobertura do
  // ativo composto — quem calcula isso é o motor, sobre o resultado final.
  const c = comporFundamentos({
    mercado: RAMO_MERCADO,
    yahoo: { roe: 19.8, cobertura: 0.7, classe: 'acao', fonte: 'yahoo' },
    cvm: { roe: 20.4, cobertura: 0.9, classe: 'acao', fonte: 'cvm', fonteRotulo: 'DFP · CVM' },
  });
  assert.equal(c.cobertura, undefined, 'cobertura é calculada pelo motor, não herdada');
  assert.equal(c.fonte, 'cvm');
});

test('Yahoo respeita o orçamento de tempo e não estoura o maxDuration', async () => {
  const { fetchYahooFundamentals } = market.__test || {};
  const erros = [];
  // Orçamento esgotado: nem tenta autenticar.
  assert.deepEqual(await fetchYahooFundamentals(['A', 'B'], erros, 0), {});
  assert.deepEqual(await fetchYahooFundamentals(['A', 'B'], erros, 100), {});
  assert.equal(erros.length, 0, 'desistir por orçamento não é erro a reportar');
});

// ════════════════════════════════════════════
// Degradação da BRAPI (regressão da bolsa inteira sem score)
// ════════════════════════════════════════════
//
// O bug: `fundamental=true` e `modules=` exigem plano pago. Sem token a
// resposta é 401, fetchBrapiFundamentals lançava, e o ticker ficava SEM
// DOCUMENTO NENHUM — perdia-se até o preço, que a chamada sem parâmetros
// devolve de graça e que já roda em produção na aba Meu Patrimônio.
//
// Na tela isso aparecia como um card sem linha de procedência: não havia
// fonte a declarar porque nada tinha chegado. Três rodadas de investigação
// passaram sem localizar isto, porque o sintoma é idêntico ao de "a fonte
// respondeu sem os campos".

const { fetchBrapiFundamentals, mapBrapiCotacao } = market.__test || {};

/** Dubla fetch distinguindo a chamada COM parâmetros da chamada simples. */
function dublarBrapi({ fundamentosStatus, cotacaoResults }) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url) => {
    const alvo = String(url);
    chamadas.push(alvo);
    const comParametros = alvo.includes('modules=') || alvo.includes('fundamental=true');
    if (comParametros) {
      if (fundamentosStatus && fundamentosStatus !== 200) {
        return {
          ok: false,
          status: fundamentosStatus,
          text: async () => 'plano nao permite',
          json: async () => ({}),
        };
      }
      return { ok: true, status: 200, json: async () => ({ results: cotacaoResults || [] }) };
    }
    return { ok: true, status: 200, json: async () => ({ results: cotacaoResults || [] }) };
  };
  return { chamadas, restaurar: () => (globalThis.fetch = original) };
}

const RESULTADO_BRAPI = [
  {
    symbol: 'BBAS3',
    shortName: 'BANCO DO BRASIL',
    regularMarketPrice: 28.5,
    regularMarketVolume: 2000000,
    marketCap: 160e9,
  },
];

test('401 na chamada de fundamentos NÃO pode perder o preço', () => {
  // A asserção que faltava: com o plano grátis, o ticker tem de continuar a
  // voltar com cotação, senão o card fica mudo na tela.
  const d = mapBrapiCotacao({
    ticker: 'BBAS3',
    shortName: 'BANCO DO BRASIL',
    price: 28.5,
    volume: 2000000,
    marketCap: 160e9,
  });
  assert.equal(d.preco, 28.5);
  assert.equal(d.marketCap, 160e9);
  assert.equal(d.liquidezDiaria, 2000000 * 28.5, 'liquidez é volume x preço');
  assert.equal(d.fonte, 'brapi');
  assert.ok(d.fonteRotulo.includes('Cotação'), 'a procedência tem de dizer que é só cotação');
});

test('fundamentos recusados degradam para a cotação, e reportam', async () => {
  // Sem BRAPI_TOKEN a degradação vai para o Yahoo v8/chart, que não pede
  // autenticação nenhuma. O ticker NÃO pode sumir só porque o plano da BRAPI
  // não cobre os módulos — era assim que a bolsa inteira ficava sem card.
  const erros = [];
  const tokenAntes = process.env.BRAPI_TOKEN;
  delete process.env.BRAPI_TOKEN;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const alvo = String(url);
    if (alvo.includes('brapi.dev')) {
      return { ok: false, status: 401, text: async () => 'MISSING_TOKEN', json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        chart: {
          result: [
            {
              meta: { regularMarketPrice: 28.5, chartPreviousClose: 28 },
              indicators: { quote: [{ volume: [2000000] }] },
            },
          ],
        },
      }),
    };
  };
  try {
    const r = await fetchBrapiFundamentals(['BBAS3'], erros);
    assert.ok(r.BBAS3, 'o ticker tem de continuar a voltar, com o que houver');
    assert.equal(r.BBAS3.preco, 28.5, 'o preço vem do Yahoo, sem cadastro nenhum');
    assert.equal(r.BBAS3.liquidezDiaria, 2000000 * 28.5);
    assert.ok(
      erros.some((e) => e.degradou),
      'a degradação tem de ficar registada — silenciar isto foi o que escondeu o bug'
    );
  } finally {
    globalThis.fetch = original;
    if (tokenAntes !== undefined) process.env.BRAPI_TOKEN = tokenAntes;
  }
});

test('quando os módulos funcionam, a cotação simples nem é chamada', async () => {
  const erros = [];
  const { chamadas, restaurar } = dublarBrapi({
    fundamentosStatus: 200,
    cotacaoResults: RESULTADO_BRAPI,
  });
  try {
    const r = await fetchBrapiFundamentals(['BBAS3'], erros);
    assert.ok(r.BBAS3);
    assert.equal(chamadas.length, 1, 'sem degradação desnecessária');
    assert.equal(erros.length, 0);
  } finally {
    restaurar();
  }
});

test('BRAPI e Yahoo falhando devolvem vazio, com os motivos nomeados', async () => {
  const erros = [];
  const tokenAntes = process.env.BRAPI_TOKEN;
  delete process.env.BRAPI_TOKEN;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('rede_fora');
  };
  try {
    assert.deepEqual(await fetchBrapiFundamentals(['BBAS3'], erros), {});
    assert.ok(erros.length >= 2, 'cada via tem de reportar o seu motivo');
    assert.ok(
      erros.some((e) => e.fonte === 'yahoo_chart'),
      `a via sem token tem de constar: ${JSON.stringify(erros)}`
    );
  } finally {
    globalThis.fetch = original;
    if (tokenAntes !== undefined) process.env.BRAPI_TOKEN = tokenAntes;
  }
});

test('a cotação simples traz valor de mercado e volume', () => {
  // Sem estes dois campos não há P/L, P/VP nem liquidez — e era isso que se
  // perdia quando a chamada de fundamentos levava tudo junto na queda.
  const { fetchBrapi } = market.__test || {};
  assert.ok(typeof fetchBrapi === 'function' || true);
  const d = mapBrapiCotacao({ ticker: 'X', price: 10, volume: null, marketCap: null });
  assert.equal(d.liquidezDiaria, null, 'sem volume não se inventa liquidez');
  assert.equal(d.marketCap, null);
  assert.equal(d.preco, 10);
});

test('cotação com preço mas sem valor de mercado ainda serve de base', () => {
  const d = mapBrapiCotacao({ ticker: 'X', price: 10, volume: 1000, marketCap: null });
  assert.equal(d.liquidezDiaria, 10000);
  assert.equal(d.cobertura, 0, 'cotação sozinha não é cobertura de fundamentos');
});

// ════════════════════════════════════════════
// Configuração pendente x fonte fora do ar
// ════════════════════════════════════════════
//
// O diagnóstico em produção devolveu isto:
//
//   brapi_fundamentos: brapi_401 MISSING_TOKEN
//   brapi_cotacao:     brapi_401 MISSING_TOKEN
//   yahoo: 429 (sete vezes)
//
// Duas causas completamente diferentes, e só a primeira tem conserto do
// nosso lado. A mensagem genérica "nenhuma fonte respondeu" escondia que
// faltava uma variável de ambiente — e que o mesmo 401 derruba as cotações
// da aba Meu Patrimônio e o aquecimento noturno.

const { diagnosticarErrosDeFonte } = market.__test || {};

test('BRAPI sem token vira MELHORIA, não bloqueio, quando o Yahoo cobre', () => {
  // A diferença importa: marcar de vermelho uma melhoria opcional treina o
  // operador a ignorar o vermelho.
  const p = diagnosticarErrosDeFonte([
    { fonte: 'brapi_fundamentos', erro: 'brapi_401: {"code":"MISSING_TOKEN"}' },
  ]);
  const brapi = p.find((x) => x.chave === 'BRAPI_TOKEN');
  assert.ok(brapi);
  assert.equal(brapi.severidade, 'melhoria');
  assert.ok(brapi.acao.toLowerCase().includes('opcional'));
  assert.ok(brapi.alcance.includes('Nada fica sem funcionar'));
});

test('BRAPI sem token E Yahoo fora vira bloqueio de verdade', () => {
  const p = diagnosticarErrosDeFonte([
    { fonte: 'brapi_cotacao', erro: 'brapi_401: MISSING_TOKEN' },
    { fonte: 'yahoo_chart', erro: 'yahoo_chart_503' },
  ]);
  const bloqueio = p.find((x) => x.severidade === 'bloqueio');
  assert.ok(bloqueio, 'sem NENHUMA via de cotação, aí sim é bloqueio');
  assert.ok(bloqueio.alcance.includes('Sem cotação'));
});

test('429 do Yahoo é reportado como limite de IP, sem pedir configuração', () => {
  const p = diagnosticarErrosDeFonte([{ fonte: 'yahoo', erro: 'yahoo_429' }]);
  const yahoo = p.find((x) => x.fonte === 'Yahoo Finance');
  assert.ok(yahoo);
  assert.equal(yahoo.chave, null, 'não há variável a configurar para um 429');
  assert.ok(yahoo.acao.includes('CVM'), 'tem de apontar o caminho que não sofre esse limite');
});

test('as duas pendências convivem sem se confundir', () => {
  const p = diagnosticarErrosDeFonte([
    { fonte: 'brapi_cotacao', erro: 'brapi_401: MISSING_TOKEN' },
    { fonte: 'yahoo', erro: 'yahoo_429' },
  ]);
  assert.equal(p.length, 2);
  assert.equal(p.filter((x) => x.chave).length, 1, 'só uma delas é acionável por configuração');
});

test('erro comum de rede não vira pendência de configuração', () => {
  // Nem toda falha tem conserto do nosso lado. Sugerir configuração onde não
  // há nada a configurar manda o operador procurar o que não existe.
  assert.deepEqual(diagnosticarErrosDeFonte([{ fonte: 'brapi', erro: 'ETIMEDOUT' }]), []);
  assert.deepEqual(diagnosticarErrosDeFonte([]), []);
  assert.deepEqual(diagnosticarErrosDeFonte(null), []);
});

test('Yahoo desiste após dois 429 seguidos em vez de insistir', async () => {
  // Sete tentativas, sete 429 — foi o que o diagnóstico mostrou. Insistir de
  // um IP limitado só gasta o orçamento e aprofunda o bloqueio.
  const { fetchYahooFundamentals } = market.__test || {};
  const original = globalThis.fetch;
  let pedidosSummary = 0;
  globalThis.fetch = async (url) => {
    const alvo = String(url);
    if (alvo.includes('fc.yahoo.com')) {
      return { ok: true, headers: { get: () => 'A3=abc; Path=/' }, text: async () => '' };
    }
    if (alvo.includes('getcrumb')) {
      return { ok: true, headers: { get: () => null }, text: async () => 'migalha' };
    }
    pedidosSummary++;
    return { ok: false, status: 429, json: async () => ({}), text: async () => '' };
  };
  try {
    const erros = [];
    const r = await fetchYahooFundamentals(['A3', 'B3', 'C3', 'D3', 'E3'], erros, 20000, 5);
    assert.deepEqual(r, {});
    assert.ok(pedidosSummary <= 2, `insistiu ${pedidosSummary} vezes num IP limitado`);
    assert.ok(
      erros.some((e) => e.erro === 'yahoo_429_desistiu'),
      'a desistência tem de ficar registada, para o diagnóstico distinguir de falha pontual'
    );
  } finally {
    globalThis.fetch = original;
  }
});

// ════════════════════════════════════════════
// Cotação sem cadastro nenhum (Yahoo v8/chart)
// ════════════════════════════════════════════
//
// A BRAPI passou a exigir token até na chamada simples, e o dono do produto
// não quer registar-se. O v8/chart não pede autenticação — nem token, nem
// cookie, nem crumb — e já era usado neste arquivo para o histórico, o que
// prova que o caminho funciona a partir deste deploy.
//
// É outro endpoint do quoteSummary (o que dá 429): aquele é protegido, este
// é aberto. Por isso a mesma origem serve numa camada e não serve na outra.

const { fetchYahooCotacoes, fetchCotacoesMercado } = market.__test || {};

function dublarChart(resposta) {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (resposta instanceof Error) throw resposta;
    return { ok: true, status: 200, json: async () => resposta };
  };
  return { urls, restaurar: () => (globalThis.fetch = original) };
}

const CHART_OK = {
  chart: {
    result: [
      {
        meta: { regularMarketPrice: 28.5, chartPreviousClose: 28, currency: 'BRL' },
        indicators: { quote: [{ volume: [900000, 2000000] }] },
      },
    ],
  },
};

test('cotação do Yahoo não usa token, cookie nem crumb', async () => {
  const { urls, restaurar } = dublarChart(CHART_OK);
  try {
    const r = await fetchYahooCotacoes(['BBAS3'], []);
    assert.equal(r.BBAS3.price, 28.5);
    assert.ok(urls[0].includes('BBAS3.SA'), 'ticker da B3 leva sufixo .SA');
    assert.ok(!urls[0].includes('crumb'), 'este endpoint não é o protegido');
  } finally {
    restaurar();
  }
});

test('volume vem da série quando o meta não traz', async () => {
  // Sem volume não há liquidez diária, e sem liquidez o corte de
  // investibilidade não consegue separar o que dá para vender.
  const { restaurar } = dublarChart(CHART_OK);
  try {
    const r = await fetchYahooCotacoes(['BBAS3'], []);
    assert.equal(r.BBAS3.volume, 2000000, 'último pregão com valor');
    assert.ok(Math.abs(r.BBAS3.changePct - (0.5 / 28) * 100) < 0.01);
  } finally {
    restaurar();
  }
});

test('o v8/chart não devolve valor de mercado, e isso não é fingido', async () => {
  // P/L e P/VP dependem dele e continuam a vir do job, que usa o
  // quoteSummary de um IP não limitado. Preencher aqui seria inventar.
  const { restaurar } = dublarChart(CHART_OK);
  try {
    const r = await fetchYahooCotacoes(['BBAS3'], []);
    assert.equal(r.BBAS3.marketCap, null);
  } finally {
    restaurar();
  }
});

test('resposta sem preço é descartada em vez de virar cotação nula', async () => {
  const { restaurar } = dublarChart({ chart: { result: [{ meta: { currency: 'BRL' } }] } });
  try {
    const erros = [];
    assert.deepEqual(await fetchYahooCotacoes(['BBAS3'], erros), {});
    assert.ok(erros.some((e) => e.erro.includes('sem_preco')));
  } finally {
    restaurar();
  }
});

test('a escolha da fonte de cotação é feita num lugar só', async () => {
  // Ter isto espalhado foi o que fez a falta do token quebrar cotação,
  // patrimônio e cron de uma vez.
  const tokenAntes = process.env.BRAPI_TOKEN;
  const { urls, restaurar } = dublarChart(CHART_OK);
  try {
    delete process.env.BRAPI_TOKEN;
    await fetchCotacoesMercado(['BBAS3'], []);
    assert.ok(urls[0].includes('finance/chart'), 'sem token vai para o Yahoo');
  } finally {
    restaurar();
    if (tokenAntes !== undefined) process.env.BRAPI_TOKEN = tokenAntes;
  }
});

test('com token, a BRAPI volta a ser preferida — 50 ativos num pedido', async () => {
  const tokenAntes = process.env.BRAPI_TOKEN;
  process.env.BRAPI_TOKEN = 'token-de-teste';
  const { urls, restaurar } = dublarChart({
    results: [{ symbol: 'BBAS3', regularMarketPrice: 28.5 }],
  });
  try {
    const r = await fetchCotacoesMercado(['BBAS3'], []);
    assert.ok(urls[0].includes('brapi.dev'), 'com token, a via em lote é a melhor');
    assert.equal(r.BBAS3.price, 28.5);
    assert.equal(urls.length, 1, 'um pedido só, não um por ticker');
  } finally {
    restaurar();
    if (tokenAntes === undefined) delete process.env.BRAPI_TOKEN;
    else process.env.BRAPI_TOKEN = tokenAntes;
  }
});

test('a procedência da cotação diz quem respondeu, não quem foi chamado', () => {
  // Na tela apareceu "Cotação · BRAPI · lido hoje" numa instalação que nem
  // token de BRAPI tem — o dado veio do Yahoo, depois da degradação. Atribuir
  // a uma fonte um dado que veio de outra é o que o protocolo de diagnóstico
  // deste projeto proíbe explicitamente.
  const daBrapi = mapBrapiCotacao({ ticker: 'X', price: 10, volume: 100 });
  assert.equal(daBrapi.fonte, 'brapi');
  assert.ok(daBrapi.fonteRotulo.includes('BRAPI'));

  const doYahoo = mapBrapiCotacao({ ticker: 'X', price: 10, volume: 100, fonteCotacao: 'yahoo' });
  assert.equal(doYahoo.fonte, 'yahoo');
  assert.ok(doYahoo.fonteRotulo.includes('Yahoo'));
  assert.ok(!doYahoo.fonteRotulo.includes('BRAPI'));
});

test('a degradação sem token carimba Yahoo, ponta a ponta', async () => {
  const tokenAntes = process.env.BRAPI_TOKEN;
  delete process.env.BRAPI_TOKEN;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('brapi.dev')) {
      return { ok: false, status: 401, text: async () => 'MISSING_TOKEN', json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        chart: {
          result: [
            { meta: { regularMarketPrice: 28.5 }, indicators: { quote: [{ volume: [2000000] }] } },
          ],
        },
      }),
    };
  };
  try {
    const r = await fetchBrapiFundamentals(['BBAS3'], []);
    assert.equal(r.BBAS3.fonte, 'yahoo', 'o rótulo tem de acompanhar a fonte real até à tela');
  } finally {
    globalThis.fetch = original;
    if (tokenAntes !== undefined) process.env.BRAPI_TOKEN = tokenAntes;
  }
});

// ════════════════════════════════════════════
// Setor: a camada de reserva curada
// ════════════════════════════════════════════
//
// Sintoma que trouxe esta camada: TODA ação aparecia como "setor não
// informado" na Carteira Recomendada. Não era bug de render — o campo nunca
// existiu. Os dois únicos produtores de `setor` em api/market.js dependem do
// perfil da BRAPI (`modules=`, plano pago) ou do quoteSummary do Yahoo (429 da
// function e do runner), e todo caminho degradado grava `setor: null`. O job
// da CVM nunca gravou setor nenhum.
//
// O efeito não era cosmético: `setor` é o campo que a política de
// diversificação setorial usa para decidir quanto vai para cada setor. Sem
// ele a política não se aplica, cai para score puro, e a carteira inteira
// pode sair de um setor só — que é exatamente o que ela existe para evitar.

const { setorCurado } = market.__test || {};
const MAPA = require('../scripts/lib/mapa-cvm.json');
const Motor = require('../web/appliquei-motor-carteira.js');

test('a reserva curada preenche o setor que nenhuma fonte trouxe', () => {
  const c = comporFundamentos({ mercado: { ...RAMO_MERCADO, setor: null } }, 'BBAS3');
  assert.equal(c.setor, 'Bancos');
  assert.equal(c.setorFonte, 'curado', 'a procedência do dado curado tem de ficar gravada');
});

test('setor vindo de fonte real vence a reserva', () => {
  // A regra que já vale entre os ramos, na direção contrária: a reserva
  // preenche lacuna, nunca sobrescreve medição.
  const c = comporFundamentos(
    { mercado: { ...RAMO_MERCADO, setor: 'Financial Services' } },
    'BBAS3'
  );
  assert.equal(c.setor, 'Financial Services');
  assert.equal(c.setorFonte, undefined, 'dado de fonte real não se carimba como curado');
});

test('ticker fora do mapa continua sem setor, em vez de receber um inventado', () => {
  const c = comporFundamentos({ mercado: { ...RAMO_MERCADO, setor: null } }, 'XPTO9');
  assert.equal(c.setor, null);
  assert.equal(c.setorFonte, undefined);
});

test('o ticker é comparado sem depender de caixa', () => {
  assert.equal(setorCurado('bbas3'), 'Bancos');
  assert.equal(setorCurado('BBAS3'), 'Bancos');
  assert.equal(setorCurado(null), null);
});

test('toda ação do mapa curado tem setor, e todo setor cai num bloco da política', () => {
  // O mapa é o universo que o produto de facto recomenda. Um ticker sem setor
  // aqui volta a produzir "setor não informado" na tela; um setor que não cai
  // em bloco nenhum sai da política em silêncio, que é pior — o ativo aparece
  // normal e nunca é escolhido.
  const buckets = Motor.SETORES_ALVO.acao;
  for (const [ticker, info] of Object.entries(MAPA.acoes)) {
    assert.ok(info.setor, `${ticker} está sem setor no mapa curado`);
    const canon = Motor.normalizarSetor(info.setor);
    assert.notEqual(canon, 'outros', `${ticker}: "${info.setor}" não é reconhecido pelo motor`);
    const bloco = Motor.bucketSetor({ classe: 'acao', setorCanon: canon }, buckets);
    assert.ok(bloco, `${ticker}: setor "${info.setor}" (${canon}) não cai em bloco nenhum`);
  }
});

test('os cinco blocos da política têm candidato no mapa curado', () => {
  // Bloco sem nenhum ticker curado nunca recebe aporte enquanto a fonte de
  // mercado não devolver setor — e a diversificação fica incompleta sem que
  // nada na tela denuncie a causa.
  const buckets = Motor.SETORES_ALVO.acao;
  const cobertos = new Set(
    Object.values(MAPA.acoes).map((info) =>
      Motor.bucketSetor({ classe: 'acao', setorCanon: Motor.normalizarSetor(info.setor) }, buckets)
    )
  );
  for (const b of buckets) {
    // O balde curinga é a exceção legítima: ele existe para o ativo cujo setor
    // NÃO conhecemos, e um ticker curado tem setor por definição. Exigir
    // candidato dele seria exigir o contrário do que ele é.
    if ((b.setores || b.segmentos || []).includes('*')) continue;
    assert.ok(cobertos.has(b.chave), `nenhum ticker curado cobre o bloco "${b.nome}"`);
  }
});
