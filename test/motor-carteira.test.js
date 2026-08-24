'use strict';

// Motor da Carteira Recomendada — score dos ativos e montagem do aporte.
//
// O arquivo em web/ é classic script (o browser carrega por <script src>),
// mas termina com module.exports para poder ser exercitado aqui sem DOM,
// sem Firebase e sem rede. Só matemática entra neste teste; o que desenha a
// tela vive em web/appliquei-aba-carteira-recomendada.js e fica de fora.
//
// O que estes testes protegem, em ordem de gravidade se quebrar:
//   1. Indicador ruim não pode virar nota boa (P/L negativo, payout > 100%).
//   2. Ativo sem dado não pode liderar ranking por sorte de ter 1 métrica.
//   3. A soma da carteira tem de fechar: 100% nas classes, e o plano de
//      aporte nunca pode mandar gastar mais do que o aporte do mês.

const test = require('node:test');
const assert = require('node:assert/strict');

const M = require('../web/appliquei-motor-carteira.js');

// ── Fixtures: números plausíveis, para o teste falhar por lógica e não por
//    input absurdo que nunca apareceria em produção.
const ACAO_DIVIDENDOS = {
  ticker: 'BBAS3',
  nome: 'Banco do Brasil',
  setor: 'Bancos',
  preco: 28.5,
  pl: 4.5,
  pvp: 0.8,
  dy: 9.5,
  dyMedio5a: 8,
  payout: 45,
  anosPagandoDividendo: 20,
  roe: 20,
  margemLiquida: 25,
  dividaLiquidaPl: 0.3,
  liquidezCorrente: 1.6,
  cagrReceita5a: 9,
  cagrLucro5a: 14,
  liquidezDiaria: 4e7,
};

const ACAO_CRESCIMENTO = {
  ticker: 'WEGE3',
  nome: 'WEG ON',
  setor: 'Bens de Capital',
  preco: 52,
  pl: 32,
  pvp: 9.5,
  dy: 1.1,
  dyMedio5a: 1.3,
  payout: 38,
  anosPagandoDividendo: 20,
  roe: 34,
  roic: 28,
  margemLiquida: 17,
  dividaLiquidaEbitda: -0.4,
  liquidezCorrente: 2.3,
  cagrReceita5a: 22,
  cagrLucro5a: 26,
  liquidezDiaria: 9e7,
};

const FII_TIJOLO = {
  ticker: 'BTLG11',
  nome: 'BTLG Logística',
  preco: 101,
  pvp: 0.95,
  dy: 9.2,
  dyMedio36m: 8.8,
  consistenciaDividendos: 100,
  crescimentoDividendo12m: 6,
  ocupacao: 98,
  alavancagem: 18,
  liquidezDiaria: 7e6,
  patrimonioLiquido: 3e9,
  numeroCotistas: 300000,
  numeroImoveis: 20,
};

// ════════════════════════════════════════════
// 1. Normalização
// ════════════════════════════════════════════

test('motorInterpolar satura nas pontas e interpola no meio', () => {
  const curva = [
    [0, 0],
    [10, 10],
  ];
  assert.equal(M.interpolar(-5, curva), 0, 'abaixo do primeiro ponto satura no primeiro');
  assert.equal(M.interpolar(15, curva), 10, 'acima do último ponto satura no último');
  assert.equal(M.interpolar(5, curva), 5, 'meio do intervalo interpola linear');
});

test('motorInterpolar devolve null para valor não numérico', () => {
  const curva = [
    [0, 0],
    [10, 10],
  ];
  assert.equal(M.interpolar(null, curva), null);
  assert.equal(M.interpolar(NaN, curva), null);
  // Infinity não é cotação de indicador — é lixo de divisão por zero na
  // origem. Vale mais como "sem dado" do que saturado no melhor extremo.
  assert.equal(M.interpolar(Infinity, curva), null);
  assert.equal(M.interpolar('7', curva), null, 'string não é número: quem converte é notaMetrica');
});

test('DY altíssimo pontua MENOS que DY saudável (curva de faixa ideal)', () => {
  // Dividendo de 25% quase sempre é extraordinário ou preço em queda livre.
  // Uma régua monotônica premiaria justamente esse caso.
  const metrica = M.CRITERIOS.acao.dividendos.find((m) => m.id === 'dy');
  const saudavel = M.notaMetrica(metrica, 10).nota;
  const suspeito = M.notaMetrica(metrica, 28).nota;
  assert.ok(suspeito < saudavel, `DY 28% (${suspeito}) devia pontuar abaixo de 10% (${saudavel})`);
});

test('payout acima de 100% pontua abaixo de payout saudável', () => {
  const metrica = M.CRITERIOS.acao.dividendos.find((m) => m.id === 'payout');
  assert.ok(M.notaMetrica(metrica, 120).nota < M.notaMetrica(metrica, 50).nota);
});

test('P/L negativo não vira "barato": cai para a nota de prejuízo', () => {
  const metrica = M.CRITERIOS.acao.valuation.find((m) => m.id === 'pl');
  const prejuizo = M.notaMetrica(metrica, -8);
  assert.equal(prejuizo.invalido, true);
  assert.ok(prejuizo.nota <= 2, 'empresa com prejuízo não pode pontuar como ação barata');
  assert.ok(prejuizo.nota < M.notaMetrica(metrica, 6).nota);
});

test('métrica sem dado devolve null (e não zero)', () => {
  const metrica = M.CRITERIOS.acao.valuation.find((m) => m.id === 'pl');
  assert.equal(M.notaMetrica(metrica, null), null);
  assert.equal(M.notaMetrica(metrica, undefined), null);
  assert.equal(M.notaMetrica(metrica, ''), null);
});

// ════════════════════════════════════════════
// 2. Classificação e pilares
// ════════════════════════════════════════════

test('inferirClasse separa FII, ETF, unit, cripto e renda fixa', () => {
  assert.equal(M.inferirClasse('MXRF11', 'Maxi Renda'), 'fii');
  assert.equal(M.inferirClasse('BOVA11', 'iShares Ibovespa ETF'), 'acao');
  assert.equal(M.inferirClasse('SANB11', 'Santander Unit'), 'acao');
  assert.equal(M.inferirClasse('BTC', 'Bitcoin'), 'cripto');
  assert.equal(M.inferirClasse('TESOURO_SELIC_2029', 'Tesouro Selic 2029'), 'rf');
  assert.equal(M.inferirClasse('PETR4', 'Petrobras PN'), 'acao');
  assert.equal(M.inferirClasse('AAPL34', 'Apple BDR', 'bdr'), 'acao', 'BDR entra como ação');
});

test('pilar sem nenhuma métrica preenchida devolve nota null', () => {
  const r = M.notaPilar(M.CRITERIOS.acao.valuation, { roe: 20 });
  assert.equal(r.nota, null);
  assert.equal(r.cobertura, 0);
  assert.equal(r.aplicavel, true, 'valuation se aplica a ação — falta dado, não conceito');
});

test('pilar inexistente na classe é marcado como não aplicável', () => {
  // Cripto não tem dividendo: é diferente de "não encontrei o dividendo".
  const r = M.notaPilar(M.CRITERIOS.cripto.dividendos, {});
  assert.equal(r.aplicavel, false);
});

// ════════════════════════════════════════════
// 3. Score
// ════════════════════════════════════════════

test('score fica no intervalo 0-100 e expõe os cinco pilares', () => {
  const r = M.scoreAtivo(ACAO_DIVIDENDOS, { lente: 'equilibrio' });
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.deepEqual(Object.keys(r.pilares).sort(), M.PILARES.slice().sort());
  assert.equal(r.classe, 'acao');
});

test('a lente troca o vencedor: dividendos x crescimento', () => {
  const rendaDiv = M.scoreAtivo(ACAO_DIVIDENDOS, { lente: 'renda' }).scoreExato;
  const rendaCres = M.scoreAtivo(ACAO_CRESCIMENTO, { lente: 'renda' }).scoreExato;
  const qualDiv = M.scoreAtivo(ACAO_DIVIDENDOS, { lente: 'qualidade' }).scoreExato;
  const qualCres = M.scoreAtivo(ACAO_CRESCIMENTO, { lente: 'qualidade' }).scoreExato;

  assert.ok(rendaDiv > rendaCres, 'sob a lente de renda, a pagadora de dividendos vence');
  assert.ok(
    qualCres - qualDiv > rendaCres - rendaDiv,
    'trocar para a lente de qualidade tem de favorecer a de crescimento, em termos relativos'
  );
});

test('bônus setorial só existe na lente que declara setores preferidos', () => {
  const comBonus = M.scoreAtivo(ACAO_DIVIDENDOS, { lente: 'renda' });
  const semBonus = M.scoreAtivo(ACAO_DIVIDENDOS, { lente: 'equilibrio' });
  assert.equal(comBonus.bonusSetor, M.LENTES.renda.bonusSetor);
  assert.equal(semBonus.bonusSetor, 0);
  assert.equal(comBonus.setorCanon, 'banco');
});

test('setor fora da lista preferida não recebe bônus', () => {
  const r = M.scoreAtivo(ACAO_CRESCIMENTO, { lente: 'renda' });
  assert.equal(r.setorCanon, 'industria');
  assert.equal(r.bonusSetor, 0);
});

test('sem lastro NÃO há score: o motor diz o que falta em vez de dar nota', () => {
  // Regressão da falha que aparecia com o plano grátis da BRAPI: o score
  // encolhia para ~25 e o cliente lia 25/100 como veredito sobre o ativo,
  // quando era veredito sobre os nossos dados. Ranking inteiro empatado, com
  // desempate alfabético do ticker fazendo as vezes de análise.
  const magro = M.scoreAtivo({ ticker: 'XXXX3', nome: 'Só um indicador', pl: 4 }, {});
  assert.equal(magro.score, null, 'score sem lastro tem de ser ausência, não número baixo');
  assert.equal(magro.scoreExato, null);
  assert.equal(magro.temLastro, false);
  assert.equal(magro.confianca, 'insuficiente');
  assert.ok(magro.cobertura < M.COBERTURA_MINIMA);
  assert.ok(
    magro.alertas.some((a) => a.includes('Indicadores insuficientes')),
    'a tela precisa dizer por que não há nota'
  );
});

test('o que falta vem discriminado por pilar, para a tela ser acionável', () => {
  const magro = M.scoreAtivo({ ticker: 'XXXX3', nome: 'Só um indicador', pl: 4 }, {});
  const pilares = magro.faltando.map((f) => f.pilar);
  assert.ok(pilares.includes('Qualidade'), `faltando veio ${JSON.stringify(pilares)}`);
  assert.ok(pilares.includes('Endividamento'));

  const valuation = magro.faltando.find((f) => f.pilar === 'Valuation');
  assert.ok(valuation.metricas.includes('P/VP'), 'P/VP faltou e tem de ser nomeado');
  assert.ok(
    !valuation.metricas.includes('P/L'),
    'P/L veio preenchido: não pode constar como falta'
  );
});

test('cobertura parcial ainda pontua, mas encolhida e marcada como média', () => {
  // Entre o mínimo e 60% há dado suficiente para uma opinião fraca. É a
  // faixa em que o encolhimento para a média continua a fazer sentido.
  const parcial = M.scoreAtivo(
    {
      ticker: 'PARC3',
      nome: 'Parcial',
      pl: 4,
      pvp: 0.7,
      evEbitda: 4,
      roe: 22,
      liquidezDiaria: 3e7,
    },
    { lente: 'equilibrio' }
  );
  assert.ok(parcial.cobertura >= M.COBERTURA_MINIMA, `cobertura veio ${parcial.cobertura}`);
  assert.ok(parcial.score !== null, 'com dado acima do mínimo tem de haver score');
  assert.equal(parcial.confianca, 'media');
  assert.ok(
    parcial.score < parcial.scoreBruto,
    `cobertura parcial devia encolher o score (bruto ${parcial.scoreBruto}, final ${parcial.score})`
  );
});

test('mesmos fundamentos com mais cobertura pontuam mais que a versão magra', () => {
  const completo = M.scoreAtivo(ACAO_DIVIDENDOS, { lente: 'equilibrio' });
  const magro = M.scoreAtivo({ ticker: 'BBAS3', nome: 'Banco do Brasil', pl: 4.5 }, {});
  assert.ok(completo.score > 0);
  assert.equal(magro.score, null, 'não é "pontua menos": é não pontuar');
  assert.equal(completo.confianca, 'alta');
});

test('bônus setorial não ressuscita ativo sem lastro', () => {
  // O bônus somava 4 pontos em cima do score encolhido e era o ÚNICO
  // diferenciador quando não havia dado — banco sem indicador nenhum
  // aparecia em primeiro lugar do ranking.
  const semDado = M.scoreAtivo(
    { ticker: 'BBAS3', nome: 'Banco', setor: 'Bancos' },
    { lente: 'renda' }
  );
  assert.equal(semDado.score, null);
});

test('ranking manda os sem lastro para o fim, em bloco', () => {
  const rk = M.ranquear(
    [
      { ticker: 'ZZZZ3', nome: 'Sem dado' },
      ACAO_DIVIDENDOS,
      { ticker: 'AAAA3', nome: 'Sem dado tambem' },
      FII_TIJOLO,
    ],
    { lente: 'renda' }
  );
  assert.equal(rk[0].ticker, 'BBAS3', 'quem tem dado vem primeiro');
  assert.ok(rk[0].score !== null && rk[1].score !== null);
  assert.equal(rk[2].score, null);
  assert.equal(rk[3].score, null);
  // Sem tratamento explícito, subtrair null daria NaN e o sort devolveria a
  // ordem de entrada — a pior falha possível num ranking.
  assert.deepEqual(
    [rk[2].ticker, rk[3].ticker],
    ['AAAA3', 'ZZZZ3'],
    'empate sem score é alfabético'
  );
});

test('havendo ativo pontuado na classe, o sem lastro não recebe aporte', () => {
  const lista = [
    { ticker: 'COMDADO3', scoreExato: 72, score: 72 },
    { ticker: 'SEMDADO3', scoreExato: null, score: null },
  ];
  const r = M.pesosPorScore(lista, { topN: 4, minPct: 0.01 });
  assert.deepEqual(
    r.map((x) => x.ativo.ticker),
    ['COMDADO3'],
    'escolher no escuro tendo alternativa avaliada não se justifica'
  );
});

test('sem NENHUM ativo pontuado, o peso sai igual em vez de arbitrário', () => {
  const lista = [
    { ticker: 'AAA3', scoreExato: null, score: null },
    { ticker: 'BBB3', scoreExato: null, score: null },
    { ticker: 'CCC3', scoreExato: null, score: null },
  ];
  const r = M.pesosPorScore(lista, { topN: 4, minPct: 0.01 });
  assert.equal(r.length, 3, 'a classe não pode ficar sem destino para o dinheiro');
  r.forEach((x) => assert.ok(Math.abs(x.peso - 1 / 3) < 1e-9, `peso veio ${x.peso}`));
});

test('classe sem ativo pontuado NÃO recomenda: retém o valor e explica', () => {
  // Requisito do produto: a recomendação sai dos ativos mais bem pontuados.
  // Dividir igual entre ativos não pontuados fabricaria uma seleção que
  // análise nenhuma sustenta, e o utilizador não teria como distinguir isso
  // de uma recomendação de verdade.
  const ranking = M.ranquear(
    [
      { ticker: 'AAAA3', nome: 'Sem dado A', preco: 10 },
      { ticker: 'BBBB3', nome: 'Sem dado B', preco: 20 },
    ],
    {}
  );
  const plano = M.planoAporte({
    aporteMensal: 1000,
    alocacaoAlvo: { rf: 0, acao: 100, fii: 0, cripto: 0 },
    ranking,
  });
  assert.equal(plano.classes.acao.modo, 'aguardando_dados');
  assert.deepEqual(plano.classes.acao.itens, [], 'nenhum ativo pode ser recomendado');
  assert.equal(plano.classes.acao.retido, 1000, 'o valor fica retido, não alocado');
  assert.equal(plano.classes.acao.investido, 0);
  assert.equal(plano.retido, 1000);
  assert.equal(plano.sobra, 0, 'retido não é sobra de caixa: sobra é troco de lote');
  assert.deepEqual(plano.aguardandoDados, ['acao']);
  assert.ok(plano.avisos.some((a) => a.includes('mais bem pontuados')));
});

test('classe com ativo pontuado recomenda normalmente ao lado de outra retida', () => {
  const ranking = M.ranquear(
    [ACAO_DIVIDENDOS, { ticker: 'ZZZZ11', nome: 'FII sem dado', preco: 100 }],
    { lente: 'renda' }
  );
  const plano = M.planoAporte({
    aporteMensal: 2000,
    alocacaoAlvo: { rf: 0, acao: 60, fii: 40, cripto: 0 },
    ranking,
  });
  assert.ok(plano.classes.acao.investido > 0, 'a classe com dado continua a recomendar');
  assert.equal(plano.classes.fii.modo, 'aguardando_dados');
  assert.equal(plano.classes.fii.retido, 800);
  assert.ok(
    plano.totalInvestido + plano.retido + plano.sobra - 2000 < 0.02,
    'investido + retido + sobra tem de reconstituir o aporte'
  );
});

test('classe com ativo pontuado é marcada como decidida por score', () => {
  const plano = M.planoAporte({
    aporteMensal: 2000,
    alocacaoAlvo: { rf: 0, acao: 100, fii: 0, cripto: 0 },
    ranking: M.ranquear([ACAO_DIVIDENDOS, ACAO_CRESCIMENTO], { lente: 'equilibrio' }),
  });
  assert.equal(plano.classes.acao.modo, 'score');
});

test('a justificativa de ativo sem lastro nomeia a lacuna', () => {
  const rk = M.ranquear([{ ticker: 'ZZZZ3', nome: 'Sem dado' }], {});
  const texto = M.justificativa ? M.justificativa(rk[0]) : rk[0].alertas.join(' ');
  assert.ok(rk[0].score === null, 'sem lastro não pontua');
  assert.ok(
    (rk[0].faltando || []).length > 0,
    'e a lacuna tem de vir nomeada por pilar, para a tela poder dizer o que falta'
  );
});

test('alertas apontam payout insustentável e dívida alta', () => {
  const r = M.scoreAtivo(
    { ...ACAO_DIVIDENDOS, payout: 130, dividaLiquidaEbitda: 4.2 },
    { lente: 'equilibrio' }
  );
  assert.ok(r.alertas.some((a) => a.includes('Payout acima de 100%')));
  assert.ok(r.alertas.some((a) => a.includes('3,5')));
});

test('filtro da lente marca inelegível sem sumir com o ativo', () => {
  const r = M.scoreAtivo(ACAO_CRESCIMENTO, { lente: 'renda' }); // DY 1,1% < mínimo 4%
  assert.equal(r.elegivel, false);
  assert.ok(r.alertas.some((a) => a.includes('DY mínimo')));
  assert.ok(r.score > 0, 'inelegível ainda é pontuado — quem some da tela ninguém audita');
});

test('FII é pontuado pelos critérios de FII, não pelos de ação', () => {
  const r = M.scoreAtivo(FII_TIJOLO, { lente: 'renda' });
  assert.equal(r.classe, 'fii');
  assert.ok(r.pilares.valuation.nota > 7, 'P/VP 0,95 é bom para FII');
  assert.ok(r.pilares.dividendos.nota > 7);
  assert.equal(r.confianca, 'alta');
});

test('cripto não é penalizada por não ter dividendo nem valuation', () => {
  const r = M.scoreAtivo(
    {
      ticker: 'BTC',
      nome: 'Bitcoin',
      retorno12m: 65,
      marketCap: 1.3e12,
      volume24h: 3e10,
      anosExistencia: 17,
    },
    { lente: 'equilibrio' }
  );
  assert.equal(r.classe, 'cripto');
  assert.equal(r.pilares.dividendos.nota, null);
  assert.equal(r.pilares.dividendos.aplicavel, false);
  assert.equal(r.confianca, 'alta', 'pilar que não existe não pode contar como dado em falta');
});

test('ranquear ordena por score e desempata de forma estável', () => {
  const rk = M.ranquear([ACAO_CRESCIMENTO, ACAO_DIVIDENDOS, FII_TIJOLO], { lente: 'renda' });
  assert.equal(rk[0].ticker, 'BBAS3');
  assert.equal(rk[0].posicao, 1);
  for (let i = 1; i < rk.length; i++) {
    assert.ok(rk[i - 1].scoreExato >= rk[i].scoreExato, 'ranking tem de vir ordenado');
  }
});

// ════════════════════════════════════════════
// 4. Distribuição por classe
// ════════════════════════════════════════════

test('alocação por classe sempre fecha em 100', () => {
  for (const perfil of ['Conservador', 'Moderado', 'Arrojado']) {
    for (const objetivo of ['preservar', 'renda', 'aposentadoria', 'aumentar']) {
      for (const prazo of [1, 4, 8, 30]) {
        const { alocacao } = M.distribuicaoClasses({ perfil, objetivo, prazoAnos: prazo });
        const soma = M.CLASSES.reduce((s, c) => s + alocacao[c], 0);
        assert.equal(soma, 100, `${perfil}/${objetivo}/${prazo}a somou ${soma}`);
        M.CLASSES.forEach((c) => assert.ok(alocacao[c] >= 0, 'nenhuma classe pode ficar negativa'));
      }
    }
  }
});

test('prazo curto força renda fixa mesmo no perfil arrojado', () => {
  const curto = M.distribuicaoClasses({ perfil: 'Arrojado', objetivo: 'aumentar', prazoAnos: 1 });
  const longo = M.distribuicaoClasses({ perfil: 'Arrojado', objetivo: 'aumentar', prazoAnos: 30 });
  assert.ok(
    curto.alocacao.rf >= 60,
    `dinheiro de 1 ano precisa de RF alta, veio ${curto.alocacao.rf}%`
  );
  assert.ok(longo.alocacao.rf < curto.alocacao.rf);
  assert.equal(curto.prazo.id, 'curto');
});

test('perfil conservador nunca recebe cripto', () => {
  for (const objetivo of ['preservar', 'renda', 'aposentadoria', 'aumentar']) {
    const { alocacao } = M.distribuicaoClasses({ perfil: 'Conservador', objetivo, prazoAnos: 20 });
    assert.equal(alocacao.cripto, 0, `objetivo ${objetivo} furou a cerca do conservador`);
  }
});

test('objetivo muda a carteira com perfil e prazo iguais', () => {
  const renda = M.distribuicaoClasses({ perfil: 'Moderado', objetivo: 'renda', prazoAnos: 10 });
  const crescer = M.distribuicaoClasses({
    perfil: 'Moderado',
    objetivo: 'aumentar',
    prazoAnos: 10,
  });
  assert.ok(renda.alocacao.fii > crescer.alocacao.fii, 'renda passiva pede mais FII');
  assert.ok(crescer.alocacao.acao > renda.alocacao.acao, 'crescimento pede mais ação');
});

test('normalizarComLimites respeita mínimo e máximo e fecha em 100', () => {
  const limites = { rf: [50, 100], acao: [0, 25], fii: [0, 25], cripto: [0, 0] };
  const r = M.normalizarComLimites({ rf: 10, acao: 60, fii: 20, cripto: 10 }, limites);
  const soma = M.CLASSES.reduce((s, c) => s + r[c], 0);
  assert.ok(Math.abs(soma - 100) < 0.01, `somou ${soma}`);
  assert.ok(r.rf >= 50 - 1e-6);
  assert.ok(r.acao <= 25 + 1e-6);
  assert.ok(r.cripto <= 1e-6);
});

test('carteira modelo publicada é respeitada como ponto de partida', () => {
  const base = { rf: 90, acao: 5, fii: 5, cripto: 0 };
  const comBase = M.distribuicaoClasses({ perfil: 'Moderado', prazoAnos: 10, base });
  const semBase = M.distribuicaoClasses({ perfil: 'Moderado', prazoAnos: 10 });
  assert.ok(
    comBase.alocacao.rf > semBase.alocacao.rf,
    'a base do consultor tem de puxar o resultado'
  );
});

// ════════════════════════════════════════════
// 5. Pesos dentro da classe
// ════════════════════════════════════════════

const QUATRO = [
  { ticker: 'A', scoreExato: 88 },
  { ticker: 'B', scoreExato: 74 },
  { ticker: 'C', scoreExato: 61 },
  { ticker: 'D', scoreExato: 52 },
];

test('pesos somam 1 e seguem a ordem do score', () => {
  const r = M.pesosPorScore(QUATRO, { topN: 4, maxPct: 0.4, minPct: 0.01 });
  const soma = r.reduce((s, x) => s + x.peso, 0);
  assert.ok(Math.abs(soma - 1) < 1e-9, `somou ${soma}`);
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i - 1].peso >= r[i].peso - 1e-9, 'score maior não pode receber peso menor');
  }
});

test('teto de concentração é respeitado quando é factível', () => {
  const muitos = Array.from({ length: 10 }, (_, i) => ({
    ticker: 'T' + i,
    scoreExato: 90 - i * 4,
  }));
  const r = M.pesosPorScore(muitos, { topN: 10, maxPct: 0.25, minPct: 0.01 });
  r.forEach((x) => assert.ok(x.peso <= 0.25 + 1e-6, `peso ${x.peso} passou do teto`));
});

test('teto infactível não apaga o score (regressão: 3 ativos com teto de 30%)', () => {
  // 3 x 30% = 90% — nenhuma combinação fecha 100%. A versão ingênua caía
  // para peso igual e o ranking deixava de significar qualquer coisa.
  const r = M.pesosPorScore(QUATRO.slice(0, 3), { topN: 3, maxPct: 0.3, minPct: 0.01 });
  const soma = r.reduce((s, x) => s + x.peso, 0);
  assert.ok(Math.abs(soma - 1) < 1e-9);
  assert.ok(
    r[0].peso > r[2].peso + 0.05,
    `primeiro (${r[0].peso}) devia ficar bem acima do terceiro (${r[2].peso})`
  );
});

test('fatia irrelevante é cortada em vez de virar troco', () => {
  const r = M.pesosPorScore([...QUATRO, { ticker: 'E', scoreExato: 41 }], {
    topN: 5,
    maxPct: 0.4,
    minPct: 0.1,
  });
  r.forEach((x) => assert.ok(x.peso >= 0.1 - 1e-9, `sobrou peso de ${x.peso}, abaixo do piso`));
  assert.ok(r.length < 5, 'o pior colocado tinha de sair');
});

test('topN limita o número de posições', () => {
  const r = M.pesosPorScore(QUATRO, { topN: 2, maxPct: 0.9, minPct: 0.01 });
  assert.equal(r.length, 2);
  assert.deepEqual(
    r.map((x) => x.ativo.ticker),
    ['A', 'B']
  );
});

test('corte por score mínimo nunca deixa a classe sem destino', () => {
  const r = M.pesosPorScore(QUATRO, { scoreMinimo: 99, topN: 4 });
  assert.equal(r.length, 1, 'sem ninguém acima do corte, mantém o melhor');
  assert.equal(r[0].ativo.ticker, 'A');
});

test('somenteElegiveis ignora inelegíveis, mas não zera a classe', () => {
  const lista = [
    { ticker: 'A', scoreExato: 88, elegivel: false },
    { ticker: 'B', scoreExato: 70, elegivel: true },
  ];
  const r = M.pesosPorScore(lista, { somenteElegiveis: true, topN: 2, minPct: 0.01 });
  assert.deepEqual(
    r.map((x) => x.ativo.ticker),
    ['B']
  );
  const soTodosInelegiveis = M.pesosPorScore([{ ticker: 'A', scoreExato: 88, elegivel: false }], {
    somenteElegiveis: true,
    topN: 2,
  });
  assert.equal(
    soTodosInelegiveis.length,
    1,
    'se ninguém é elegível, não some com a classe inteira'
  );
});

test('aplicarTeto redistribui o excesso e preserva a soma', () => {
  const r = M.aplicarTeto([0.7, 0.2, 0.1], 0.5);
  assert.ok(Math.abs(r.reduce((s, v) => s + v, 0) - 1) < 1e-9);
  assert.ok(r[0] <= 0.5 + 1e-9);
});

// ════════════════════════════════════════════
// 6. Divisão do aporte entre classes
// ════════════════════════════════════════════

const ALVO = { rf: 40, acao: 30, fii: 25, cripto: 5 };

test('sem patrimônio informado, o aporte segue a proporção-alvo', () => {
  const r = M.distribuirAporte(ALVO, 1000);
  assert.equal(r.modo, 'proporcional');
  assert.equal(r.valores.rf, 400);
  assert.equal(r.valores.acao, 300);
  assert.equal(r.valores.cripto, 50);
});

test('com carteira torta, o aporte vai para a classe atrasada', () => {
  // Tudo em RF: o mês inteiro tem de ir para as outras classes.
  const r = M.distribuirAporte(ALVO, 2000, { rf: 50000, acao: 0, fii: 0, cripto: 0 });
  assert.equal(r.modo, 'rebalanceia');
  assert.equal(r.valores.rf, 0, 'não faz sentido reforçar a classe que já passou do alvo');
  const soma = M.CLASSES.reduce((s, c) => s + r.valores[c], 0);
  assert.ok(Math.abs(soma - 2000) < 1e-6, `distribuiu ${soma} de 2000`);
  assert.ok(r.valores.acao > 0 && r.valores.fii > 0);
});

test('aporte maior que os buracos cobre tudo e distribui o resto pelo alvo', () => {
  const r = M.distribuirAporte(ALVO, 10000, { rf: 1000, acao: 900, fii: 800, cripto: 150 });
  assert.equal(r.modo, 'rebalanceia_e_sobra');
  const soma = M.CLASSES.reduce((s, c) => s + r.valores[c], 0);
  assert.ok(Math.abs(soma - 10000) < 1e-6);
  M.CLASSES.forEach((c) => assert.ok(r.valores[c] >= 0));
});

test('aporte zero não distribui nada', () => {
  const r = M.distribuirAporte(ALVO, 0);
  assert.equal(r.modo, 'vazio');
  M.CLASSES.forEach((c) => assert.equal(r.valores[c], 0));
});

// ════════════════════════════════════════════
// 7. Plano de aporte
// ════════════════════════════════════════════

function universoPontuado(lente) {
  return M.ranquear(
    [
      ACAO_DIVIDENDOS,
      ACAO_CRESCIMENTO,
      FII_TIJOLO,
      {
        ticker: 'MXRF11',
        nome: 'Maxi Renda',
        preco: 9.8,
        pvp: 1.02,
        dy: 11.5,
        dyMedio36m: 11,
        consistenciaDividendos: 100,
        crescimentoDividendo12m: 2,
        alavancagem: 8,
        liquidezDiaria: 9e6,
        patrimonioLiquido: 4e9,
        numeroCotistas: 900000,
      },
      {
        ticker: 'TESOURO_IPCA_2035',
        nome: 'Tesouro IPCA+ 2035',
        classe: 'rf',
        taxaRealAnual: 7.2,
        premioSobreCdi: 105,
        geraRendaPeriodica: 1,
        riscoEmissor: 10,
        liquidezDias: 1,
        isentoIR: 0,
      },
      {
        ticker: 'TESOURO_SELIC_2029',
        nome: 'Tesouro Selic 2029',
        classe: 'rf',
        taxaRealAnual: 8.5,
        premioSobreCdi: 100,
        geraRendaPeriodica: 0,
        riscoEmissor: 10,
        liquidezDias: 1,
        isentoIR: 0,
      },
    ],
    { lente: lente || 'equilibrio' }
  );
}

test('plano nunca manda investir mais do que o aporte do mês', () => {
  for (const aporte of [150, 300, 1000, 2000, 7500, 25000]) {
    const plano = M.planoAporte({
      aporteMensal: aporte,
      alocacaoAlvo: ALVO,
      ranking: universoPontuado('renda'),
    });
    assert.ok(
      plano.totalInvestido <= aporte + 1e-6,
      `aporte ${aporte}: plano gastou ${plano.totalInvestido}`
    );
    assert.ok(plano.sobra >= -1e-6, `sobra negativa em aporte ${aporte}`);
    assert.ok(
      Math.abs(plano.totalInvestido + plano.sobra - aporte) < 0.02,
      'investido + sobra tem de reconstituir o aporte'
    );
  }
});

test('ações e FIIs saem em quantidade inteira, ao preço de mercado', () => {
  const plano = M.planoAporte({
    aporteMensal: 5000,
    alocacaoAlvo: ALVO,
    ranking: universoPontuado('renda'),
  });
  plano.itens
    .filter((i) => i.classe === 'acao' || i.classe === 'fii')
    .forEach((i) => {
      assert.ok(Number.isInteger(i.quantidade), `${i.ticker} veio com ${i.quantidade} cotas`);
      assert.ok(i.quantidade >= 0);
      assert.ok(
        Math.abs(i.quantidade * i.preco - i.valorInvestido) < 0.02,
        `${i.ticker}: quantidade x preço tem de bater com o valor`
      );
    });
});

test('a sobra da classe é sempre menor que o ativo mais barato dela', () => {
  const plano = M.planoAporte({
    aporteMensal: 3000,
    alocacaoAlvo: ALVO,
    ranking: universoPontuado('renda'),
  });
  ['acao', 'fii'].forEach((c) => {
    const classe = plano.classes[c];
    if (!classe.itens.length) return;
    const maisBarato = Math.min(...classe.itens.map((i) => i.preco));
    assert.ok(
      classe.sobra < maisBarato + 0.01,
      `${c}: sobraram ${classe.sobra} e o mais barato custa ${maisBarato} — dava para comprar mais`
    );
  });
});

test('renda fixa recebe valor exato, sem arredondar para cota', () => {
  const plano = M.planoAporte({
    aporteMensal: 1000,
    alocacaoAlvo: ALVO,
    ranking: universoPontuado('renda'),
  });
  assert.ok(Math.abs(plano.classes.rf.sobra) < 0.02, 'RF não tem lote — não devia sobrar caixa');
  plano.classes.rf.itens.forEach((i) => assert.equal(i.quantidade, null));
});

test('cripto aceita fração de unidade', () => {
  const ranking = M.ranquear(
    [
      {
        ticker: 'BTC',
        nome: 'Bitcoin',
        preco: 350000,
        retorno12m: 65,
        marketCap: 1.3e12,
        volume24h: 3e10,
        anosExistencia: 17,
      },
    ],
    {}
  );
  const plano = M.planoAporte({
    aporteMensal: 2000,
    alocacaoAlvo: { rf: 0, acao: 0, fii: 0, cripto: 100 },
    ranking,
  });
  const btc = plano.itens.find((i) => i.ticker === 'BTC');
  assert.ok(btc, 'BTC devia estar no plano');
  assert.ok(
    btc.quantidade > 0 && btc.quantidade < 1,
    `quantidade fracionária esperada, veio ${btc.quantidade}`
  );
  assert.ok(Math.abs(plano.sobra) < 0.02, 'cripto não tem lote mínimo — não devia sobrar caixa');
});

test('aporte pequeno concentra em vez de pulverizar', () => {
  const grande = M.planoAporte({
    aporteMensal: 20000,
    alocacaoAlvo: ALVO,
    ranking: universoPontuado('renda'),
  });
  const pequeno = M.planoAporte({
    aporteMensal: 300,
    alocacaoAlvo: ALVO,
    ranking: universoPontuado('renda'),
  });
  assert.ok(
    pequeno.itens.length < grande.itens.length,
    `R$300 abriu ${pequeno.itens.length} posições e R$20k abriu ${grande.itens.length}`
  );
  assert.ok(pequeno.avisos.length > 0, 'o utilizador tem de saber por que só apareceram 2 ativos');
});

test('ativo sem cotação não some do plano: entra com valor e aviso', () => {
  const ranking = M.ranquear(
    [{ ticker: 'ZZZZ3', nome: 'Sem cotação', pl: 8, pvp: 1, roe: 15, dy: 6, dyMedio5a: 6 }],
    {}
  );
  const plano = M.planoAporte({
    aporteMensal: 1000,
    alocacaoAlvo: { rf: 0, acao: 100, fii: 0, cripto: 0 },
    ranking,
  });
  const item = plano.itens.find((i) => i.ticker === 'ZZZZ3');
  assert.ok(item, 'o ativo tem de aparecer mesmo sem preço');
  assert.equal(item.semPreco, true);
  assert.equal(item.quantidade, null);
  assert.ok(item.valorInvestido > 0);
  assert.ok(plano.avisos.some((a) => a.includes('ZZZZ3')));
});

test('classe com alocação zero não recebe dinheiro', () => {
  const plano = M.planoAporte({
    aporteMensal: 2000,
    alocacaoAlvo: { rf: 50, acao: 50, fii: 0, cripto: 0 },
    ranking: universoPontuado('renda'),
  });
  assert.equal(plano.classes.fii.investido, 0);
  assert.equal(plano.classes.fii.itens.length, 0);
});

test('plano com patrimônio real corrige o desvio da carteira', () => {
  const ranking = universoPontuado('renda');
  const semPatrimonio = M.planoAporte({ aporteMensal: 2000, alocacaoAlvo: ALVO, ranking });
  const comDesvio = M.planoAporte({
    aporteMensal: 2000,
    alocacaoAlvo: ALVO,
    ranking,
    patrimonioAtual: { rf: 80000, acao: 1000, fii: 500, cripto: 0 },
  });
  assert.equal(comDesvio.rebalanceando, true);
  assert.equal(semPatrimonio.rebalanceando, false);
  assert.ok(
    comDesvio.classes.rf.investido < semPatrimonio.classes.rf.investido,
    'quem já tem RF a mais não devia reforçar RF'
  );
  assert.ok(comDesvio.classes.acao.investido > semPatrimonio.classes.acao.investido);
});

test('cada item traz score, justificativa e a fatia do aporte', () => {
  const plano = M.planoAporte({
    aporteMensal: 4000,
    alocacaoAlvo: ALVO,
    ranking: universoPontuado('renda'),
  });
  assert.ok(plano.itens.length > 0);
  plano.itens.forEach((i) => {
    assert.ok(typeof i.score === 'number', `${i.ticker} sem score`);
    assert.ok(i.justificativa && i.justificativa.length > 0, `${i.ticker} sem justificativa`);
    assert.ok(i.pctAporte >= 0);
  });
  const somaPct = plano.itens.reduce((s, i) => s + i.pctAporte, 0);
  assert.ok(somaPct <= 100.5, `as fatias somaram ${somaPct}% do aporte`);
});

// ════════════════════════════════════════════
// FII de papel: régua própria, mesma classe
// ════════════════════════════════════════════

test('fundo de papel não é cobrado por ocupação nem por contagem de imóveis', () => {
  const papel = {
    ticker: 'KNCR11',
    classe: 'fii',
    tipoFii: 'papel',
    pvp: 1.0,
    dy: 14.6,
    dyMedio36m: 12.9,
    consistenciaDividendos: 100,
    crescimentoDividendo12m: 9.7,
    alavancagem: null,
    liquidezDiaria: 3e6,
    patrimonioLiquido: 10.98e9,
    numeroCotistas: 578802,
    ocupacao: null,
    numeroImoveis: null,
  };
  const r = M.scoreAtivo(papel, { lente: 'equilibrio' });
  const ausentes = (r.faltando || []).flatMap((f) => f.metricas);
  assert.ok(
    !ausentes.includes('Taxa de ocupação'),
    'ocupação não se aplica a fundo sem imóvel — não pode ser cobrada'
  );
  assert.ok(!ausentes.includes('Imóveis na carteira'), 'idem para a contagem de imóveis');
  // E o pilar de crescimento existe, apoiado no indicador que se aplica.
  assert.ok(r.pilares.crescimento.nota !== null, 'crescimento do dividendo carrega o pilar');
  assert.equal(r.pilares.crescimento.cobertura, 1);
});

test('o mesmo fundo, cobrado como tijolo, perde cobertura por dado que não existe nele', () => {
  const base = {
    ticker: 'KNCR11',
    classe: 'fii',
    pvp: 1.0,
    dy: 14.6,
    dyMedio36m: 12.9,
    consistenciaDividendos: 100,
    crescimentoDividendo12m: 9.7,
    alavancagem: null,
    liquidezDiaria: 3e6,
    patrimonioLiquido: 10.98e9,
    numeroCotistas: 578802,
    ocupacao: null,
    numeroImoveis: null,
  };
  const comoTijolo = M.scoreAtivo(base, { lente: 'equilibrio' });
  const comoPapel = M.scoreAtivo({ ...base, tipoFii: 'papel' }, { lente: 'equilibrio' });
  assert.ok(
    comoPapel.cobertura > comoTijolo.cobertura,
    `papel devia ter cobertura maior: ${comoPapel.cobertura} vs ${comoTijolo.cobertura}`
  );
});

test('fundo de papel continua sendo FII na alocação, não uma quinta classe', () => {
  // A régua muda; a classe não. Sem esta garantia o fundo sumiria da
  // distribuição do aporte, que percorre MOTOR_CLASSES.
  assert.equal(M.inferirClasse('KNCR11', 'Kinea Rendimentos', 'fiiPapel'), 'fii');
  assert.equal(M.CLASSES.indexOf('fiiPapel'), -1, 'não entra na lista de classes');
  const r = M.scoreAtivo(
    { ticker: 'KNCR11', classe: 'fii', tipoFii: 'papel', pvp: 1, dy: 12 },
    { lente: 'equilibrio' }
  );
  assert.equal(r.classe, 'fii');
});

test('tijolo segue com a régua de sempre — ocupação continua sendo cobrada', () => {
  const tijolo = {
    ticker: 'HGLG11',
    classe: 'fii',
    tipoFii: 'tijolo',
    pvp: 1.0,
    dy: 8.4,
    dyMedio36m: 8.1,
    consistenciaDividendos: 100,
    crescimentoDividendo12m: -0.8,
    alavancagem: 7.5,
    liquidezDiaria: 3e6,
    patrimonioLiquido: 7.59e9,
    numeroCotistas: 608345,
    ocupacao: null,
    numeroImoveis: null,
  };
  const r = M.scoreAtivo(tijolo, { lente: 'equilibrio' });
  const ausentes = (r.faltando || []).flatMap((f) => f.metricas);
  assert.ok(ausentes.includes('Taxa de ocupação'), 'de um fundo de tijolo, a ocupação se cobra');
  assert.ok(ausentes.includes('Imóveis na carteira'));
});
