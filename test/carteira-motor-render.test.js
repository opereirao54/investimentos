'use strict';

// Aba Carteira Recomendada — camada que liga o motor à tela.
//
// O motor já é testado isolado em test/motor-carteira.test.js. O que sobra
// aqui é justamente o que aquele teste não alcança: as funções desta aba
// montam HTML por concatenação de string, e um nome de campo errado no meio
// de um template não quebra nada — imprime "undefined" na tela do cliente e
// só aparece em produção. Por isso as asserções olham o HTML produzido.
//
// Também cobre as três traduções entre mundos que ninguém mais faz:
//   - categorias da aba Meu Patrimônio -> classes do motor;
//   - item da carteira modelo -> título do Tesouro (nomes com acento);
//   - perfil + objetivo + prazo -> alocação-alvo da tela toda.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

/** DOM mínimo que GUARDA o innerHTML, em vez de o descartar. */
function makeDom() {
  const els = new Map();
  function el(id) {
    if (!els.has(id)) {
      els.set(id, {
        id,
        innerHTML: '',
        textContent: '',
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      });
    }
    return els.get(id);
  }
  return {
    els,
    document: {
      getElementById: el,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({
        style: {},
        classList: { add() {}, remove() {} },
        innerHTML: '',
        appendChild() {},
      }),
    },
  };
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

/** Carrega motor + aba num contexto próprio e devolve o sandbox. */
function carregar(extras) {
  const dom = makeDom();
  const ctx = {
    document: dom.document,
    localStorage: makeStorage(),
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout,
    clearTimeout,
    Math,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    isFinite,
    parseFloat,
    parseInt,
    Set,
    Promise,
    encodeURIComponent,
    firebase: undefined,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    // Globais do app que a aba consome (definidos em app.js/utils.js).
    formatarMoeda: (v) =>
      'R$ ' +
      Number(v || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    parseBRL: (v) => parseFloat(String(v).replace(/\./g, '').replace(',', '.')) || 0,
    mostrarToast: () => {},
    Chart: function () {
      return { destroy() {} };
    },
  };
  Object.assign(ctx, extras || {});
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of [
    'web/appliquei-motor-carteira.js',
    'web/appliquei-aba-carteira-recomendada.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return { ctx, dom, run: (code) => vm.runInContext(code, ctx) };
}

/** Universo pontuado, com números plausíveis, para alimentar os renders. */
const SEMENTE = `
  var universoTeste = [
    { ticker:'BBAS3', nome:'Banco do Brasil', setor:'Bancos', preco:28.5, pl:4.5, pvp:0.8,
      dy:9.5, dyMedio5a:8, payout:45, anosPagandoDividendo:20, roe:20, margemLiquida:25,
      dividaLiquidaPl:0.3, liquidezCorrente:1.6, cagrReceita5a:9, cagrLucro5a:14, liquidezDiaria:4e7 },
    { ticker:'MXRF11', nome:'Maxi Renda', preco:9.8, pvp:1.02, dy:11.5, dyMedio36m:11,
      consistenciaDividendos:100, crescimentoDividendo12m:2, alavancagem:8, liquidezDiaria:9e6,
      patrimonioLiquido:4e9, numeroCotistas:900000 },
    { ticker:'TESOURO_IPCA_2035', nome:'Tesouro IPCA+ 2035', classe:'rf', taxaRealAnual:7.2,
      premioSobreCdi:105, geraRendaPeriodica:1, riscoEmissor:10, liquidezDias:1, isentoIR:0 }
  ];
  var rankingTeste = motorRanquear(universoTeste, { lente: 'renda' });
  var planoTeste = motorPlanoAporte({
    aporteMensal: 3000,
    alocacaoAlvo: { rf: 40, acao: 35, fii: 25, cripto: 0 },
    ranking: rankingTeste
  });
`;

// ════════════════════════════════════════════
// Render do plano
// ════════════════════════════════════════════

test('o plano renderiza uma coluna por classe com valor e quantidade', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run('cartRenderizarMotorPlano(planoTeste);');
  const html = s.dom.els.get('cartMotorPlano').innerHTML;

  assert.ok(html.includes('BBAS3'), 'o ativo tem de aparecer na tela');
  assert.ok(html.includes('MXRF11'));
  assert.ok(html.includes('Tesouro IPCA+ 2035'));
  assert.ok(html.includes('Renda Fixa') && html.includes('Ações') && html.includes('FIIs'));
  assert.ok(/\d+ ações/.test(html), 'ação tem de mostrar a quantidade a comprar');
  assert.ok(/\d+ cotas/.test(html), 'FII tem de mostrar a quantidade a comprar');
  assert.ok(html.includes('Aporte do mês'));
});

test('nenhum render deixa escapar undefined ou NaN para a tela', () => {
  // Campo renomeado no motor e não acompanhado aqui não quebra o script:
  // imprime "undefined" no meio do valor e passa despercebido no code review.
  const s = carregar();
  s.run(SEMENTE);
  s.run('cartRenderizarMotorPlano(planoTeste); cartRenderizarMotorRanking(rankingTeste);');
  for (const id of ['cartMotorPlano', 'cartMotorRanking']) {
    const html = s.dom.els.get(id).innerHTML;
    assert.ok(!html.includes('undefined'), `${id} imprimiu "undefined"`);
    assert.ok(!html.includes('NaN'), `${id} imprimiu "NaN"`);
    assert.ok(!html.includes('[object Object]'), `${id} imprimiu "[object Object]"`);
  }
});

test('classe sem alocação aparece esmaecida em vez de sumir', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run('cartRenderizarMotorPlano(planoTeste);');
  const html = s.dom.els.get('cartMotorPlano').innerHTML;
  assert.ok(html.includes('cart-classe-cripto'), 'cripto está em 0% mas continua visível');
  assert.ok(html.includes('dimmed'));
  assert.ok(html.includes('Sem alocação nesta classe'));
});

// ════════════════════════════════════════════
// Render do ranking
// ════════════════════════════════════════════

test('cada ativo vira um card com score e os cinco pilares', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run('cartRenderizarMotorRanking(rankingTeste);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;

  const cards = html.split('cart-score-card').length - 1;
  assert.equal(cards, 3, `esperava 3 cards, vieram ${cards}`);
  const barras = html.split('cart-pilar-trilho').length - 1;
  assert.equal(barras, 15, `3 ativos x 5 pilares = 15 barras, vieram ${barras}`);

  ['Valuation', 'Dividendos', 'Crescimento', 'Endividamento', 'Qualidade'].forEach((p) => {
    assert.ok(html.includes(p), `pilar ${p} ausente`);
  });
  assert.ok(html.includes('/100'), 'o score precisa mostrar a escala');
  assert.ok(html.includes('confiança'), 'a confiança do dado precisa aparecer junto do score');
});

test('pilar sem dado desenha barra vazia em vez de barra zerada', () => {
  // Barra em zero lê-se como "nota zero"; vazia lê-se como "sem informação".
  const s = carregar();
  s.run(`
    var semDado = motorRanquear([{ ticker:'XPTO3', nome:'Sem fundamentos', pl:8 }], {});
    cartRenderizarMotorRanking(semDado);
  `);
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(html.includes('cart-pilar-barra vazio'), 'faltou marcar o pilar sem dado');
  assert.ok(html.includes('—'), 'pilar sem nota mostra travessão, não 0,0');
});

test('ranking vazio não gera cards órfãos', () => {
  const s = carregar();
  s.run('cartRenderizarMotorRanking([]);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(!html.includes('cart-score-card'));
  assert.ok(html.includes('Nenhum ativo'));
});

test('ranking vazio não deixa classe sem destino para o dinheiro', () => {
  // Estado de hoje, antes de a ingestão da CVM rodar: sem este resgate,
  // R$ 1.460 de um aporte de R$ 2.000 ficavam sem destino porque ações e
  // FIIs desapareciam da tela.
  const s = carregar();
  const r = JSON.parse(
    s.run(`JSON.stringify(cartUniversoAutomatico({ classes: {} }, ${JSON.stringify(TITULOS_RF)}))`)
  );
  const classes = new Set(r.itens.map((a) => a.classe));
  assert.ok(classes.has('acao'), 'ações caem para a carteira modelo');
  assert.ok(classes.has('fii'), 'FIIs também');
  assert.ok(classes.has('rf'), 'RF veio do Tesouro, não da reserva');
  assert.deepEqual(r.fallback.sort(), ['acao', 'fii']);
});

// ════════════════════════════════════════════
// Status
// ════════════════════════════════════════════

test('o status informa a lente e quantos ativos foram pontuados', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run(
    'cartMotor.ranking = rankingTeste; cartEstado.lente = "renda"; cartRenderizarMotorStatus();'
  );
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('Renda &amp; Perenidade') || html.includes('Renda & Perenidade'));
  assert.ok(
    /3 de 3 ativos pontuados/.test(html),
    `a contagem tem de ser de PONTUADOS, não de "com algum dado": ${html}`
  );
  assert.ok(html.includes('cobertura média'));
});

test('falha na busca vira aviso explícito, não score silenciosamente neutro', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run(
    'cartMotor.ranking = rankingTeste; cartMotor.erro = "sem_token"; cartRenderizarMotorStatus();'
  );
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('cart-motor-alerta erro'));
  assert.ok(html.includes('sem_token'));
  assert.ok(html.includes('neutros'), 'tem de dizer que o score não vale nada neste estado');
});

test('nenhum ativo pontuado é a PRIMEIRA coisa que a tela diz', () => {
  // É o estado que o plano grátis da fonte de mercado produz. Antes passava
  // despercebido atrás de uma parede de scores baixos, todos iguais.
  const s = carregar();
  s.run(`
    cartMotor.ranking = motorRanquear([{ ticker:'AAAA3', nome:'Quase sem dado', pl: 7 }], {});
    cartRenderizarMotorStatus();
  `);
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('cart-motor-alerta erro'), 'tem de ser alerta forte, não nota de rodapé');
  assert.ok(html.includes('Nenhum ativo pôde ser pontuado'));
  assert.ok(
    html.includes('não é resultado de análise'),
    'tem de dizer o que o plano abaixo significa'
  );
  assert.ok(/0 de 1 ativos pontuados/.test(html));
});

test('ativos parcialmente sem dado são contados e explicados', () => {
  const s = carregar();
  s.run(`
    cartMotor.ranking = motorRanquear([
      { ticker:'BBAS3', nome:'BB', setor:'Bancos', preco:28.5, pl:4.5, pvp:0.8, dy:9.5, dyMedio5a:8,
        payout:45, anosPagandoDividendo:20, roe:20, margemLiquida:25, dividaLiquidaPl:0.3,
        liquidezCorrente:1.6, cagrReceita5a:9, cagrLucro5a:14, liquidezDiaria:4e7 },
      { ticker:'ZZZZ3', nome:'Sem dado' }
    ], { lente:'renda' });
    cartRenderizarMotorStatus();
  `);
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(/1 de 2 ativos pontuados/.test(html));
  assert.ok(html.includes('não recebem aporte enquanto'), 'tem de dizer a consequência prática');
});

test('card sem lastro mostra a ausência do score e o que falta', () => {
  const s = carregar();
  s.run(`
    var semDado = motorRanquear([{ ticker:'ZZZZ3', nome:'Sem fundamentos' }], {});
    cartRenderizarMotorRanking(semDado);
  `);
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(html.includes('cart-score-badge sem-dado'), 'o selo tem de ser ausência, não número');
  assert.ok(!html.includes('/100'), 'nenhuma escala de nota pode aparecer em ativo não pontuado');
  assert.ok(html.includes('Faltam indicadores para pontuar'));
  assert.ok(
    html.includes('Valuation:') && html.includes('Qualidade:'),
    'o que falta vem por pilar'
  );
  assert.ok(html.includes('dados insuficientes'));
  assert.ok(!html.includes('#1'), 'ativo sem score não ocupa posição no ranking');
});

test('card pontuado NÃO carrega a moldura de dados insuficientes', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run('cartRenderizarMotorRanking(rankingTeste);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(!html.includes('cart-score-badge sem-dado'));
  assert.ok(!html.includes('Faltam indicadores para pontuar'));
  assert.ok(html.includes('/100'));
});

test('classe retida aparece como retida, não como vazia nem como sobra', () => {
  const s = carregar();
  s.run(`
    var semDado = motorRanquear([{ ticker:'ZZZZ3', nome:'Sem fundamentos', preco: 12 }], {});
    var planoSemDado = motorPlanoAporte({
      aporteMensal: 1000, alocacaoAlvo: { rf:0, acao:100, fii:0, cripto:0 }, ranking: semDado
    });
    cartRenderizarMotorPlano(planoSemDado);
  `);
  const html = s.dom.els.get('cartMotorPlano').innerHTML;
  assert.ok(html.includes('Aguardando indicadores para selecionar os ativos'));
  assert.ok(html.includes('mais bem pontuados'), 'tem de dizer por que não há seleção');
  assert.ok(html.includes('Retido:'), 'o rodapé da classe diz retido, não sobra');
  assert.ok(html.includes('Retido por falta de dados'), 'o resumo do topo também');
  assert.ok(!html.includes('ZZZZ3'), 'ativo não pontuado não pode ser recomendado');
});

test('procedência mostra fonte, exercício e idade do dado', () => {
  const s = carregar();
  s.run(`
    var comFonte = motorRanquear([{
      ticker:'BBAS3', nome:'BB', setor:'Bancos', preco:28.5, pl:4.5, pvp:0.8, dy:9.5, dyMedio5a:8,
      payout:45, anosPagandoDividendo:20, roe:20, margemLiquida:25, dividaLiquidaPl:0.3,
      liquidezCorrente:1.6, cagrReceita5a:9, cagrLucro5a:14, liquidezDiaria:4e7,
      fonteRotulo:'DFP 2025 · CVM', dataReferencia:'2025-12-31', fetchedAtMs: Date.now()
    }], { lente:'renda' });
    cartRenderizarMotorRanking(comFonte);
  `);
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(html.includes('DFP 2025'), 'a fonte tem de aparecer no card');
  assert.ok(html.includes('ref. '), 'o exercício de referência tem de aparecer');
  assert.ok(html.includes('lido hoje'));
  assert.ok(!html.includes('vencido'));
});

test('dado velho é sinalizado como vencido', () => {
  const s = carregar();
  s.run(`
    var antigo = motorRanquear([{
      ticker:'BBAS3', nome:'BB', setor:'Bancos', preco:28.5, pl:4.5, pvp:0.8, dy:9.5, dyMedio5a:8,
      payout:45, anosPagandoDividendo:20, roe:20, margemLiquida:25, dividaLiquidaPl:0.3,
      liquidezCorrente:1.6, cagrReceita5a:9, cagrLucro5a:14, liquidezDiaria:4e7,
      fonteRotulo:'Fundamentos · BRAPI', fetchedAtMs: Date.now() - 200 * 86400000
    }], { lente:'renda' });
    cartRenderizarMotorRanking(antigo);
  `);
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(html.includes('cart-score-fonte vencido'));
  assert.ok(html.includes('lido há 200 dias'));
  assert.ok(html.includes('atualize antes de decidir'));
});

test('ativo sem procedência não inventa selo de fonte', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run('cartRenderizarMotorRanking(rankingTeste);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(!html.includes('cart-score-fonte'), 'sem fonte declarada, nada de carimbo de origem');
});

test('as quatro lentes aparecem e a ativa fica marcada', () => {
  const s = carregar();
  s.run('cartEstado.lente = "valor"; cartRenderizarMotorLentes();');
  const html = s.dom.els.get('cartMotorLentes').innerHTML;
  [
    'Equilíbrio',
    'Renda &amp; Perenidade',
    'Qualidade &amp; Crescimento',
    'Valor &amp; Margem de Segurança',
  ].forEach((nome) =>
    assert.ok(
      html.includes(nome) || html.includes(nome.replace('&amp;', '&')),
      `lente ${nome} ausente`
    )
  );
  assert.ok(html.includes('data-lente="valor"'));
  assert.ok(/data-lente="valor"[^>]*/.test(html));
  assert.equal(html.split('active').length - 1, 1, 'só uma lente pode estar ativa');
});

// ════════════════════════════════════════════
// Traduções entre mundos
// ════════════════════════════════════════════

test('alocação-alvo reage a objetivo e prazo, não só ao perfil', () => {
  const s = carregar();
  const renda = s.run(
    'cartEstado.perfil="Moderado"; cartEstado.objetivo="renda"; cartEstado.prazoAnos=20; JSON.stringify(cartAlocacaoAlvo())'
  );
  const curto = s.run(
    'cartEstado.objetivo="preservar"; cartEstado.prazoAnos=1; JSON.stringify(cartAlocacaoAlvo())'
  );
  const a = JSON.parse(renda);
  const b = JSON.parse(curto);
  assert.ok(a.fii > b.fii, 'renda passiva de longo prazo pede mais FII');
  assert.ok(b.rf > a.rf, 'preservar capital em 1 ano pede mais renda fixa');
  assert.equal(
    ['rf', 'acao', 'fii', 'cripto'].reduce((s2, c) => s2 + b[c], 0),
    100
  );
});

test('a lente padrão é derivada do objetivo declarado', () => {
  const s = carregar();
  assert.equal(s.run('cartEstado.objetivo="renda"; cartLenteAtiva()'), 'renda');
  assert.equal(s.run('cartEstado.objetivo="aumentar"; cartLenteAtiva()'), 'qualidade');
  assert.equal(s.run('cartEstado.objetivo="preservar"; cartLenteAtiva()'), 'valor');
  assert.equal(s.run('cartEstado.objetivo=null; cartLenteAtiva()'), 'equilibrio');
  assert.equal(
    s.run('cartEstado.objetivo="renda"; cartEstado.lente="valor"; cartLenteAtiva()'),
    'valor',
    'escolha explícita do utilizador vence o padrão'
  );
});

test('categorias da aba Meu Patrimônio são traduzidas para as classes do motor', () => {
  const s = carregar({
    mpConsolidar: () => ({
      porCategoriaExibicao: {
        renda_fixa: { atual: 10000 },
        reserva_emergencia: { atual: 5000 },
        previdencia: { atual: 2000 },
        acoes: { atual: 8000 },
        bdrs: { atual: 1000 },
        etfs: { atual: 500 },
        fiis: { atual: 4000 },
        cripto: { atual: 700 },
      },
    }),
  });
  const r = JSON.parse(s.run('JSON.stringify(cartPatrimonioPorClasse())'));
  assert.equal(r.origem, 'carteira');
  assert.equal(r.valores.rf, 17000, 'RF junta renda fixa + reserva + previdência');
  assert.equal(r.valores.acao, 9500, 'ações juntam ações + BDRs + ETFs');
  assert.equal(r.valores.fii, 4000);
  assert.equal(r.valores.cripto, 700);
});

test('sem carteira registada, o patrimônio informado entra pela proporção-alvo', () => {
  const s = carregar();
  const r = JSON.parse(
    s.run(
      'cartEstado.perfil="Moderado"; cartEstado.patrimonio=10000; JSON.stringify(cartPatrimonioPorClasse())'
    )
  );
  assert.equal(r.origem, 'informado');
  const soma = ['rf', 'acao', 'fii', 'cripto'].reduce((s2, c) => s2 + r.valores[c], 0);
  assert.ok(Math.abs(soma - 10000) < 1, `distribuiu ${soma} de 10000`);
});

test('sem carteira e sem valor informado, não se inventa desvio nenhum', () => {
  const s = carregar();
  const r = JSON.parse(s.run('JSON.stringify(cartPatrimonioPorClasse())'));
  assert.equal(r.origem, 'nenhum');
  assert.equal(r.valores, null, 'null desliga o rebalanceamento, 0 fingiria carteira vazia');
});

test('item da carteira modelo casa com o título do Tesouro apesar do acento e da pontuação', () => {
  const s = carregar();
  const casou = s.run(`
    var titulos = [
      { ticker: 'TESOURO_IPCA_2035', nome: 'Tesouro IPCA+ 2035', taxaRealAnual: 7.2 },
      { ticker: 'TESOURO_SELIC_2029', nome: 'Tesouro Selic 2029', taxaRealAnual: 8.5 }
    ];
    JSON.stringify([
      cartCasarTesouro({ ticker: 'TESOURO_IPCA_2035', nome: 'Tesouro IPCA+ 2035' }, titulos),
      cartCasarTesouro({ ticker: 'TESOURO-SELIC-2029', nome: 'Tesouro Selic 2029' }, titulos),
      cartCasarTesouro({ ticker: 'CDB_BANCO_X', nome: 'CDB Banco X' }, titulos)
    ])
  `);
  const [ipca, selic, cdb] = JSON.parse(casou);
  assert.equal(ipca.taxaRealAnual, 7.2);
  assert.equal(selic.taxaRealAnual, 8.5, 'separador diferente não pode impedir o casamento');
  assert.equal(cdb, null, 'o que não é do Tesouro fica sem taxa, e não com a taxa errada');
});

test('o universo base é a carteira modelo inteira, sem filtro invisível', () => {
  // A grade "Ativos selecionados" saiu: ela duplicava o plano do motor e
  // dividia o aporte IGUALMENTE entre os ativos, que é exatamente o que a
  // regra do projeto proíbe — divisão igual disfarçada de recomendação.
  //
  // Com a grade fora, o veto gravado não teria tela que o mostrasse nem que
  // o desfizesse: o universo encolheria em silêncio e ninguém descobriria
  // por quê olhando o produto. Por isso o filtro saiu junto.
  const s = carregar();
  const tickers = JSON.parse(
    s.run('JSON.stringify(cartUniversoBase().map(function(a){return a.ticker}))')
  );
  assert.ok(tickers.includes('BBAS3'), 'a carteira modelo padrão tem BBAS3');
  assert.ok(tickers.includes('MXRF11'), 'e as outras classes continuam presentes');
  assert.equal(
    s.run('typeof cartRenderizarSelecaoGrid'),
    'undefined',
    'a grade duplicada não pode voltar'
  );
  assert.equal(s.run('typeof cartToggleAtivo'), 'undefined', 'nem o toggle que a operava');
});

test('universo montado herda os fundamentos e preserva o nome da carteira modelo', () => {
  const s = carregar();
  const r = JSON.parse(
    s.run(`
      var base = [{ ticker:'BBAS3', nome:'Banco do Brasil', classe:'acao' }];
      var fund = { BBAS3: { ticker:'BBAS3', nome:'BANCO DO BRASIL S.A.', roe: 20, pl: 4.5 } };
      JSON.stringify(cartMontarUniverso(base, fund, []))
    `)
  );
  assert.equal(r[0].roe, 20, 'os indicadores têm de chegar ao motor');
  assert.equal(r[0].nome, 'Banco do Brasil', 'o nome do consultor vence o da fonte de mercado');
  assert.equal(r[0].classe, 'acao');
});

// ════════════════════════════════════════════
// Faixa de indicadores do Banco Central
// ════════════════════════════════════════════

test('Selic, CDI e inflação esperada aparecem com a fonte anexada', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run(`
    cartMotor.ranking = rankingTeste;
    cartMotor.indicadores = {
      selic: { valor: 15, unidade: '% a.a.', fonte: 'Meta Selic (SGS 432)', data: '2026-08-20' },
      cdi: { valor: 14.9, unidade: '% a.a.', fonte: 'CDI anualizado (SGS 4389)', data: '2026-08-20' },
      ipcaEsperado: { valor: 4.1, fonte: 'Expectativa Focus (BCB)', data: '2026-08-15' },
      ipca12m: { valor: 4.3, fonte: 'IPCA 12 meses (SGS 13522)', data: '2026-07-31' }
    };
    cartRenderizarMotorStatus();
  `);
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('15,00%'), 'a Selic corrente tem de aparecer');
  assert.ok(html.includes('14,90%'));
  assert.ok(html.includes('SGS 432'), 'a série usada tem de ficar disponível ao utilizador');
  assert.ok(html.includes('Banco Central'));
  assert.ok(
    !html.includes('IPCA 12m'),
    'com expectativa disponível, o IPCA passado não deve competir na mesma faixa'
  );
});

test('sem expectativa do Focus, o IPCA passado assume o lugar', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run(`
    cartMotor.ranking = rankingTeste;
    cartMotor.indicadores = {
      selic: { valor: 15, fonte: 'Meta Selic (SGS 432)' },
      ipca12m: { valor: 4.3, fonte: 'IPCA 12 meses (SGS 13522)' }
    };
    cartRenderizarMotorStatus();
  `);
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('IPCA 12m'));
  assert.ok(html.includes('4,30%'));
});

test('premissa de reserva é declarada como tal, não passada por taxa do dia', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run(`
    cartMotor.ranking = rankingTeste;
    cartMotor.premissasDegradadas = true;
    cartMotor.indicadores = { selic: { valor: 13.25, fonte: 'fallback' } };
    cartRenderizarMotorStatus();
  `);
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('premissa de reserva'));
  assert.ok(
    !html.includes('Banco Central'),
    'não pode carimbar o BCB num número que não veio dele'
  );
});

test('sem indicadores nenhuns, a faixa simplesmente não existe', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run('cartMotor.ranking = rankingTeste; cartRenderizarMotorStatus();');
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(!html.includes('cart-indicadores'));
});

// ════════════════════════════════════════════
// Universo automático
// ════════════════════════════════════════════
//
// Até aqui um humano escolhia QUAIS ativos entravam e o motor só decidia
// QUANTO em cada um. Lista escrita à mão envelhece sem avisar — foi assim
// que a renda fixa parou de pontuar, com títulos de vencimento 2027 numa
// oferta que já não os tinha.

const RANKING = {
  universo: 412,
  excluidos: { porte_abaixo_do_piso: 180, liquidez_insuficiente: 40, sem_lastro: 25 },
  classes: {
    acao: {
      total: 90,
      itens: [
        { ticker: 'BBAS3', nome: 'Banco do Brasil', score: 88 },
        { ticker: 'EGIE3', nome: 'Engie Brasil', score: 81 },
      ],
    },
    fii: { total: 60, itens: [{ ticker: 'BTLG11', nome: 'BTG Logística', score: 84 }] },
    cripto: { total: 0, itens: [] },
    rf: { total: 0, itens: [] },
  },
};

const TITULOS_RF = [
  { ticker: 'TESOURO_SELIC_2031', nome: 'Tesouro Selic 2031' },
  { ticker: 'TESOURO_IPCA_2040', nome: 'Tesouro IPCA+ 2040' },
];

test('o universo automático não usa lista escrita à mão em classe nenhuma', () => {
  const s = carregar();
  const u = JSON.parse(
    s.run(
      `JSON.stringify(cartUniversoAutomatico(${JSON.stringify(RANKING)}, ${JSON.stringify(TITULOS_RF)}).itens)`
    )
  );
  const tickers = u.map((a) => a.ticker);

  assert.ok(tickers.includes('BBAS3') && tickers.includes('EGIE3'), 'ações vêm do ranking');
  assert.ok(tickers.includes('BTLG11'), 'FIIs vêm do ranking');
  assert.ok(tickers.includes('TESOURO_SELIC_2031'), 'RF vem da oferta corrente do Tesouro');
  assert.ok(tickers.includes('BTC'), 'cripto vem do alcance da integração');

  // Nenhum dos títulos com vencimento fixo da antiga lista padrão sobrevive.
  assert.ok(!tickers.includes('TESOURO_SELIC_2027'), 'título vencido não pode reaparecer');
  assert.ok(!tickers.includes('MXRF11'), 'nada da carteira modelo entra sem passar pelo ranking');
});

test('cada classe do universo automático é rotulada corretamente', () => {
  const s = carregar();
  const u = JSON.parse(
    s.run(
      `JSON.stringify(cartUniversoAutomatico(${JSON.stringify(RANKING)}, ${JSON.stringify(TITULOS_RF)}).itens)`
    )
  );
  const porClasse = {};
  u.forEach((a) => (porClasse[a.classe] = (porClasse[a.classe] || 0) + 1));
  assert.equal(porClasse.acao, 2);
  assert.equal(porClasse.fii, 1);
  assert.equal(porClasse.rf, 2);
  assert.ok(porClasse.cripto >= 2);
});

test('o universo automático entrega o ranking inteiro, sem veto gravado', () => {
  // Um veto gravado numa sessão anterior, sem tela que o revele, seria
  // indistinguível de "o ranking não trouxe esse ativo". O filtro saiu com
  // a grade que o operava.
  const s = carregar();
  const r = JSON.parse(
    s.run(`
      cartEstado.selecionados = { acao: ['EGIE3'] };
      JSON.stringify(cartUniversoAutomatico(${JSON.stringify(RANKING)}, ${JSON.stringify(TITULOS_RF)}))
    `)
  );
  const acoes = r.itens.filter((a) => a.classe === 'acao').map((a) => a.ticker);
  assert.ok(acoes.length > 1, `estado antigo não pode filtrar o universo: ${acoes.join(',')}`);
  assert.ok(acoes.includes('EGIE3'));
  assert.ok(r.itens.some((a) => a.classe === 'fii'));
});

test('Tesouro fora do ar cai para a carteira modelo, e a tela diz', () => {
  // Antes esta classe simplesmente sumia — e o aporte dela virava sobra de
  // caixa sem nada explicar. Reserva declarada é melhor que buraco mudo.
  const s = carregar();
  const r = JSON.parse(
    s.run(`JSON.stringify(cartUniversoAutomatico(${JSON.stringify(RANKING)}, []))`)
  );
  assert.ok(
    r.itens.some((a) => a.classe === 'rf'),
    'a classe não pode ficar vazia'
  );
  assert.ok(r.fallback.includes('rf'), 'e a origem da reserva tem de ser declarada');
});

test('o status diz quantos ativos foram analisados e quantos caíram no corte', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run(`
    cartMotor.rankingServidor = ${JSON.stringify(RANKING)};
    cartMotor.automatico = true;
    cartRenderizarMotorStatus();
  `);
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('412 ativos analisados'), `veio: ${html}`);
  assert.ok(html.includes('245 fora do corte'), 'o total peneirado tem de ser visível');
});

test('não há escolha de universo: o dado é o produto, não uma opção', () => {
  // Os dois botões — "Todo o mercado" e a lista curada — não eram escolha de
  // gosto: um é o produto (CVM e Tesouro, auditável) e o outro é uma lista
  // escrita à mão. Lado a lado sugeriam valer o mesmo, e convidavam a
  // desligar exatamente o que se está a vender.
  //
  // A carteira modelo continua a existir como RESERVA declarada quando uma
  // classe volta vazia do ranking — degradação com aviso, não alternativa.
  const s = carregar();
  assert.equal(s.run('typeof cartRenderizarModoUniverso'), 'undefined');
  assert.equal(s.run('typeof cartTrocarModoUniverso'), 'undefined');
  assert.equal(s.run('cartEstado.modoUniverso'), undefined, 'o modo saiu do estado');

  // E o status continua a declarar o universo analisado, que é o que
  // substitui a informação que o par de botões dava.
  s.run(SEMENTE);
  s.run(`
    cartMotor.ranking = rankingTeste;
    cartMotor.rankingServidor = { universo: 400, excluidos: { porte_abaixo_do_piso: 245 } };
    cartRenderizarMotorStatus();
  `);
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('400 ativos analisados'));
  assert.ok(!/consultor/i.test(html), 'o jargão interno não sobrevive no status');
});

test('a lista pontuada e a resposta do ranking não compartilham campo', () => {
  // Regressão: as duas coisas moravam em cartMotor.ranking e o significado
  // dependia da ordem de execução — o status lia um array como se fosse o
  // objeto do servidor e quebrava.
  const s = carregar();
  s.run(SEMENTE);
  s.run(`
    cartMotor.ranking = rankingTeste;
    cartMotor.rankingServidor = ${JSON.stringify(RANKING)};
    cartMotor.automatico = true;
    cartRenderizarMotorStatus();
  `);
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('3 de 3 ativos pontuados'), 'a lista pontuada continua a ser lida');
  assert.ok(html.includes('412 ativos analisados'), 'e a resposta do servidor também');
});

test('a reserva é anunciada na tela, não passada por seleção do motor', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run(`
    cartMotor.ranking = rankingTeste;
    cartMotor.automatico = true;
    cartMotor.rankingServidor = { universo: 0, excluidos: {}, classes: {} };
    cartMotor.fallback = ['acao', 'fii'];
    cartRenderizarMotorStatus();
  `);
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('Ações e FIIs'), `veio: ${html}`);
  assert.ok(html.includes('carteira do consultor como reserva'));
  assert.ok(html.includes('ingestão de dados da CVM'), 'tem de dizer o que resolve');
});

test('sem reserva, nenhum aviso de reserva aparece', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run('cartMotor.ranking = rankingTeste; cartMotor.fallback = []; cartRenderizarMotorStatus();');
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(!html.includes('como reserva'));
});

// ════════════════════════════════════════════
// "Nenhuma fonte respondeu" x "fonte sem os campos"
// ════════════════════════════════════════════
//
// Os dois estados produziam a MESMA tela — card com "faltam indicadores" —
// e têm consertos opostos: um é rede/plano da fonte, o outro é cobertura de
// dado. Três rodadas de investigação se perderam nessa ambiguidade.

test('ativo sem nenhuma fonte diz isso, em vez de listar indicadores', () => {
  const s = carregar();
  s.run(`
    var mudo = motorRanquear([{
      ticker: 'BBAS3', nome: 'Banco do Brasil', classe: 'acao',
      indisponivel: true, motivo: 'brapi_fundamentos: brapi_401 · yahoo: yahoo_sem_crumb'
    }], {});
    cartRenderizarMotorRanking(mudo);
  `);
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(html.includes('Nenhuma fonte de mercado respondeu'));
  assert.ok(html.includes('brapi_401'), 'o motivo literal tem de chegar à tela');
  assert.ok(
    !html.includes('FALTAM INDICADORES') && !html.includes('Faltam indicadores'),
    'não pode dizer que faltam indicadores quando o problema é a fonte não responder'
  );
});

test('ativo com fonte mas sem campos continua a listar o que falta', () => {
  const s = carregar();
  s.run(`
    var incompleto = motorRanquear([{
      ticker: 'PETR4', nome: 'Petrobras', classe: 'acao', preco: 38,
      fonteRotulo: 'Cotação · BRAPI', fetchedAtMs: Date.now()
    }], {});
    cartRenderizarMotorRanking(incompleto);
  `);
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(html.includes('Faltam indicadores para pontuar'));
  assert.ok(!html.includes('Nenhuma fonte de mercado respondeu'));
  assert.ok(html.includes('Cotação · BRAPI'), 'com fonte, a procedência aparece');
});

test('a linha de procedência é o que distingue os dois estados na tela', () => {
  // Regra de leitura da skill de diagnóstico: card SEM procedência significa
  // que o endpoint não devolveu nada para o ticker.
  const s = carregar();
  s.run(`
    var mudo = motorRanquear([{ ticker: 'ZZZZ3', nome: 'Mudo', classe: 'acao', indisponivel: true }], {});
    cartRenderizarMotorRanking(mudo);
  `);
  assert.ok(!s.dom.els.get('cartMotorRanking').innerHTML.includes('cart-score-fonte'));
});

test('pendência de configuração aparece antes de tudo, com a ação a tomar', () => {
  // Enquanto falta uma variável de ambiente, tudo o mais na tela é
  // consequência. O aviso genérico "nenhum ativo pôde ser pontuado" mandava
  // o operador procurar no lugar errado.
  const s = carregar();
  s.run(SEMENTE);
  s.run(`
    cartMotor.ranking = motorRanquear([{ ticker:'AAAA3', nome:'Sem dado' }], {});
    cartMotor.pendencias = [{
      chave: 'BRAPI_TOKEN', fonte: 'BRAPI',
      diagnostico: 'A BRAPI passou a exigir token mesmo na cotação simples.',
      acao: 'Registe-se em brapi.dev e defina BRAPI_TOKEN.',
      alcance: 'Afeta também as cotações da aba Meu Patrimônio.'
    }];
    cartRenderizarMotorStatus();
  `);
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('BRAPI'), 'a fonte tem de ser nomeada');
  assert.ok(html.includes('O que fazer'), 'e a ação concreta tem de estar na tela');
  assert.ok(html.includes('brapi.dev'));
  assert.ok(html.includes('Meu Patrimônio'), 'o alcance real evita procurar no lugar errado');
  assert.ok(
    !html.includes('Nenhum ativo pôde ser pontuado'),
    'com pendência conhecida, o aviso genérico só atrapalha'
  );
});

test('sem pendência, o aviso genérico volta a valer', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run(`
    cartMotor.ranking = motorRanquear([{ ticker:'AAAA3', nome:'Sem dado' }], {});
    cartMotor.pendencias = [];
    cartRenderizarMotorStatus();
  `);
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('Nenhum ativo pôde ser pontuado'));
});

// ════════════════════════════════════════════
// Pilar apoiado em quase nada não pode parecer completo
// ════════════════════════════════════════════
//
// Na tela: BBAS3 com "DADOS INSUFICIENTES" e, ao lado, Qualidade com barra
// verde CHEIA em 10,0 — apoiada só na liquidez diária, com ROE, ROIC e
// margem líquida ausentes. É o mesmo erro do score encolhido para 25,
// repetido uma camada abaixo: um número que se lê como veredito quando é
// veredito sobre os nossos dados.

test('pilar com menos de metade dos indicadores é marcado como parcial', () => {
  const s = carregar();
  s.run(`
    var soLiquidez = motorRanquear([{
      ticker: 'BBAS3', nome: 'Banco do Brasil', classe: 'acao',
      preco: 28.5, liquidezDiaria: 4e7
    }], { lente: 'renda' });
    cartRenderizarMotorRanking(soLiquidez);
  `);
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(html.includes('cart-pilar-barra parcial'), 'a barra tem de sair listrada');
  assert.ok(html.includes('1/4'), 'a fração de indicadores tem de aparecer sob a nota');
  assert.ok(
    html.includes('1 de 4 indicadores'),
    'e o title tem de dizer sobre quantos indicadores a nota foi calculada'
  );
});

test('pilar completo continua a desenhar barra cheia, sem listras', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run('cartRenderizarMotorRanking(rankingTeste);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(
    !html.includes('cart-pilar-barra parcial'),
    'não pode marcar de parcial o que está completo'
  );
  assert.ok(html.includes('indicadores'), 'o title continua a informar a contagem');
});

test('pilar sem dado nenhum continua vazio, não parcial', () => {
  // Vazio e parcial dizem coisas diferentes: um é "não sei", o outro é
  // "sei pouco". Confundi-los apaga a distinção que a tela existe para fazer.
  const s = carregar();
  s.run(`
    var nada = motorRanquear([{ ticker: 'ZZZZ3', nome: 'Sem nada', classe: 'acao' }], {});
    cartRenderizarMotorRanking(nada);
  `);
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(html.includes('cart-pilar-barra vazio'));
  assert.ok(!html.includes('cart-pilar-barra parcial'));
});

// ════════════════════════════════════════════
// Critérios de análise e pontuação
// ════════════════════════════════════════════

test('os critérios exibidos saem do motor, não de uma lista escrita à mão', () => {
  // A tela explica COMO o score é calculado. Se essa explicação for escrita
  // à parte, ela diverge do motor no primeiro ajuste de peso — e passa a
  // descrever um cálculo que o produto já não executa, o que é pior do que
  // não explicar nada. Este teste falha se a lista deixar de ser derivada.
  const s = carregar();
  s.run('cartRenderizarCriterios();');
  const html = s.dom.els.get('cartCriterios').innerHTML;

  // Um indicador que existe SÓ no motor tem de aparecer aqui sem ninguém o
  // ter copiado: se alguém trocar a fonte por texto fixo, isto quebra.
  const nomes = JSON.parse(
    s.run('JSON.stringify(MOTOR_CRITERIOS.acao.valuation.map(function(m){return m.nome}))')
  );
  for (const nome of nomes) {
    assert.ok(html.includes(nome), `indicador do motor ausente na explicação: ${nome}`);
  }
  // O peso distingue "entra na conta" de "decide a conta".
  const peso = s.run('MOTOR_CRITERIOS.acao.valuation[0].peso');
  assert.ok(html.includes('peso ' + peso), 'o peso de cada indicador tem de ir junto');
});

test('a explicação cobre as classes com critérios próprios, tijolo e papel à parte', () => {
  const s = carregar();
  s.run('cartRenderizarCriterios();');
  const html = s.dom.els.get('cartCriterios').innerHTML;
  assert.ok(html.includes('FIIs de tijolo'));
  assert.ok(html.includes('FIIs de papel'), 'o fundo de papel tem critérios próprios');
  // Ocupação só se aplica a tijolo — é a diferença que justifica separá-los.
  assert.ok(html.includes('Taxa de ocupação'));
});

test('a explicação acompanha a lente ativa, não uma lente fixa', () => {
  // Trocar de lente muda o PESO de cada pilar e reordena a carteira. Uma
  // explicação presa a uma lente descreveria o cálculo errado.
  const s = carregar();
  s.run("cartEstado.lente = 'renda'; cartRenderizarCriterios();");
  const renda = s.dom.els.get('cartCriterios').innerHTML;
  assert.ok(renda.includes('Renda &amp; Perenidade') || renda.includes('Renda & Perenidade'));
  assert.ok(renda.includes('×2.2'), 'o peso do pilar de dividendos da lente renda');

  s.run("cartEstado.lente = 'valor'; cartRenderizarCriterios();");
  const valor = s.dom.els.get('cartCriterios').innerHTML;
  assert.ok(valor.includes('Valor & Margem') || valor.includes('Valor &amp; Margem'));
  assert.notEqual(renda, valor, 'trocar de lente tem de mudar a explicação');
});

test('a explicação diz o que acontece quando falta indicador', () => {
  // É a pergunta que o utilizador faz olhando um travessão no card. Sem
  // resposta na tela, "sem dado" parece nota zero.
  const s = carregar();
  s.run('cartRenderizarCriterios();');
  const html = s.dom.els.get('cartCriterios').innerHTML;
  assert.ok(html.includes('não vira nota zero'));
  const minimo = Math.round(s.run('MOTOR_COBERTURA_MINIMA') * 100);
  assert.ok(html.includes(minimo + '%'), 'o piso de cobertura real tem de ser o exibido');
});

// ════════════════════════════════════════════
// Lista de ativos: nome curto, abas e busca
// ════════════════════════════════════════════
//
// O que estes testes protegem é o que o utilizador relatou: no telemóvel a
// lista era um bloco único de cards abertos, os nomes do Tesouro
// transbordavam o card e a página rolava para o lado. As asserções olham para
// o HTML porque é ele que carrega os atributos de que o filtro depende.

/** Ranking com as quatro classes e um nome de Tesouro dos longos. */
const SEMENTE_LISTA = `
  var universoLista = [
    { ticker:'BBAS3', nome:'Banco do Brasil', setor:'Bancos', preco:28.5, pl:4.5, pvp:0.8,
      dy:9.5, dyMedio5a:8, payout:45, anosPagandoDividendo:20, roe:20, margemLiquida:25,
      dividaLiquidaPl:0.3, liquidezCorrente:1.6, cagrReceita5a:9, cagrLucro5a:14, liquidezDiaria:4e7 },
    { ticker:'EGIE3', nome:'Engie Brasil', setor:'Energia Elétrica', preco:40, pl:9, pvp:2.4,
      dy:7.5, dyMedio5a:7, payout:80, anosPagandoDividendo:18, roe:24, margemLiquida:22,
      dividaLiquidaPl:1.1, liquidezCorrente:1.2, cagrReceita5a:8, cagrLucro5a:9, liquidezDiaria:2e7 },
    { ticker:'BTLG11', nome:'BTLG Logística', classe:'fii', tipoFii:'tijolo', preco:100, pvp:1,
      dy:10, dyMedio36m:9, consistenciaDividendos:100, crescimentoDividendo12m:2,
      alavancagem:8, liquidezDiaria:9e6, patrimonioLiquido:2e9, numeroCotistas:200000,
      ocupacao:96, numeroImoveis:14 },
    { ticker:'TESOURO_IPCA_COM_JUROS_SEMESTRAIS_2055',
      nome:'Tesouro IPCA+ com Juros Semestrais 2055', classe:'rf', taxaRealAnual:7.1,
      premioSobreCdi:106, geraRendaPeriodica:1, riscoEmissor:10, liquidezDias:1, isentoIR:0 },
    { ticker:'BTC', nome:'Bitcoin', classe:'cripto', preco:300000, marketCap:1e12,
      volume24h:2e10, retorno12m:35, anosExistencia:17 }
  ];
  var rankingLista = motorRanquear(universoLista, { lente: 'equilibrio' });
`;
/** Dois rótulos de setor do provedor: um em inglês, outro em português. */
const SEMENTE_MISTA = `
  var rankingMisto = motorRanquear([
    { ticker:'VALE3', nome:'Vale', setor:'Basic Materials', preco:60, pl:6, pvp:1.4, dy:9,
      dyMedio5a:8, payout:60, anosPagandoDividendo:12, roe:18, margemLiquida:20,
      dividaLiquidaPl:0.5, liquidezCorrente:1.5, cagrReceita5a:7, cagrLucro5a:6, liquidezDiaria:9e7 },
    { ticker:'LREN3', nome:'Lojas Renner', setor:'Comércio Varejista', preco:15, pl:14, pvp:2,
      dy:3, dyMedio5a:3, payout:40, anosPagandoDividendo:10, roe:12, margemLiquida:9,
      dividaLiquidaPl:0.6, liquidezCorrente:1.9, cagrReceita5a:11, cagrLucro5a:8, liquidezDiaria:3e7 }
  ], { lente:'equilibrio' });
`;
/** Cinco setores com um nome cada — cenário em que o teto por ativo morde. */
const SEMENTE_TETO = `
  function acaoTeto(t, n, setor, q) {
    return { ticker:t, nome:n, classe:'acao', setor:setor, preco:20, pl:q, pvp:1, dy:8,
      dyMedio5a:7, payout:50, anosPagandoDividendo:15, roe:q*2.2, margemLiquida:20,
      dividaLiquidaPl:0.3, liquidezCorrente:1.6, cagrReceita5a:q, cagrLucro5a:q, liquidezDiaria:4e7 };
  }
  var rankingTeto = motorRanquear([
    acaoTeto('BBAS3','Banco do Brasil','Bancos',6),
    acaoTeto('EGIE3','Engie Brasil','Utilities',5),
    acaoTeto('SBSP3','Sabesp','Saneamento',4),
    acaoTeto('WEGE3','WEG','Industrials',8),
    acaoTeto('LREN3','Lojas Renner','Comércio Varejista',7)
  ], { lente:'equilibrio' });
  var planoTeto = motorPlanoAporte({
    aporteMensal: 6000, alocacaoAlvo: { rf: 0, acao: 100, fii: 0, cripto: 0 },
    ranking: rankingTeto
  });
`;

test('o ticker gigante do Tesouro vira código curto, com o nome inteiro ao lado', () => {
  // TESOURO_IPCA_COM_JUROS_SEMESTRAIS_2055 tem 38 caracteres em fonte
  // monoespaçada. Era ele que esticava o card e a coluna do plano, e era daí
  // que vinha a rolagem lateral no telemóvel.
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run('cartRenderizarMotorRanking(rankingLista);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;

  assert.ok(html.includes('IPCA+ 2055'), 'o código curto tem de aparecer');
  assert.ok(html.includes('juros semestrais'), 'o cupom é parte da identidade do título');
  assert.ok(
    html.includes('Tesouro IPCA+ com Juros Semestrais 2055'),
    'o nome completo continua na tela — encurtar não é esconder'
  );
  assert.ok(
    !/cart-score-ticker[^>]*>TESOURO_IPCA/.test(html),
    'o ticker cru não pode voltar a ser o rótulo do card'
  );
});

test('ação e FII continuam identificados pelo próprio ticker', () => {
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run('cartRenderizarMotorRanking(rankingLista);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(html.includes('>BBAS3<'), 'ticker de ação é o código de verdade, não se encurta');
  assert.ok(html.includes('>BTLG11<'));
});

test('a lista separa por classe, com aba e contagem de cada uma', () => {
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run('cartRenderizarMotorRanking(rankingLista);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;

  ['rf', 'acao', 'fii', 'cripto'].forEach((c) => {
    assert.ok(
      html.includes('cart-rank-grupo" data-classe="' + c + '"'),
      `faltou o grupo da classe ${c}`
    );
    assert.ok(html.includes('data-classe="' + c + '"'), `faltou a aba da classe ${c}`);
  });
  // Todos os cards ficam no DOM: quem esconde é o filtro, não o render — é
  // isso que deixa a busca atravessar classes sem redesenhar nada.
  assert.equal(html.split('cart-score-card').length - 1, 5);
});

test('a colocação é dentro da classe, não no bolo de todas', () => {
  // "Ranking por tipo de ativo" só significa alguma coisa se o #1 for o
  // primeiro da classe. Com a numeração global, a melhor ação podia aparecer
  // como #7 atrás de FIIs e cripto.
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run('cartRenderizarMotorRanking(rankingLista);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  const primeiros = html.split('cart-score-pos">#1<').length - 1;
  assert.equal(primeiros, 4, `cada classe tem o seu #1; vieram ${primeiros}`);
});

test('o campo de busca existe e carrega a chave de cada ativo', () => {
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run('cartRenderizarMotorRanking(rankingLista);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;

  assert.ok(html.includes('id="cartRankBusca"'), 'sem campo não há busca');
  assert.ok(html.includes('oninput="cartFiltrarRanking()"'));
  // A chave é normalizada no render, uma vez, para o filtro não repetir a
  // normalização a cada tecla.
  assert.ok(html.includes('data-busca="'), 'cada card precisa da chave de busca');
  assert.ok(/data-busca="[^"]*BANCODOBRASIL/.test(html), 'nome entra na chave');
  assert.ok(/data-busca="[^"]*IPCA/.test(html), 'código curto entra na chave');
});

test('a busca acha por setor e ignora acento — normalização compartilhada', () => {
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run('cartRenderizarMotorRanking(rankingLista);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  // 'Energia elétrica' é o nome do balde; digitando "energia eletrica" a
  // chave normalizada tem de casar.
  const chave = s.run("cartNormalizarNome('energia eletrica')");
  assert.ok(html.includes(chave), `chave "${chave}" não está em nenhum card`);
});

test('o card mostra o setor A QUE O ATIVO PERTENCE, não o bloco da política', () => {
  // O FII já mostrava o tipo dele (Papel, Logística). A ação mostrava o BALDE
  // — e o balde descreve mal o ativo: a Vale aparecia como
  // 'Consumo/Commodities', que é onde ela entra na alocação, não o que ela é.
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run('cartRenderizarMotorRanking(rankingLista);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;

  assert.ok(html.includes('Banco do Brasil · Bancos e Financeiro'), 'ação mostra o próprio setor');
  assert.ok(html.includes('Engie Brasil · Energia Elétrica'));
  assert.ok(html.includes('BTLG Logística · Logística'), 'FII continua mostrando o segmento');
  // O bloco da política não some: muda de lugar, para onde explica alguma
  // coisa — o title do ativo e a faixa do plano.
  assert.ok(html.includes('no plano entra no bloco Bancos/Financeiro'));
});

test('o rótulo do setor é sempre em português, seja qual for a régua do provedor', () => {
  // O provedor devolve 'Basic Materials' num ativo e 'Comércio Varejista' no
  // outro. Repassar cru misturava idioma e granularidade na mesma lista.
  const s = carregar();
  s.run(SEMENTE_MISTA);
  s.run('cartRenderizarMotorRanking(rankingMisto);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(html.includes('Mineração e Siderurgia'), 'Basic Materials tem de virar rótulo local');
  assert.ok(html.includes('Varejo e Consumo'));
  assert.ok(
    !/cart-score-nome[^>]*>[^<]*Basic Materials/.test(html),
    'o rótulo cru do provedor não vai para a linha do ativo'
  );
});

test('ação sem setor diz que não foi informado, em vez de repetir a classe', () => {
  // 'Ações' na linha do setor lê-se como se fosse um setor. A ausência é a
  // informação — e é ela que explica por que o ativo fica fora da política.
  const s = carregar();
  s.run(`
    var semSetor = motorRanquear([
      { ticker:'XPTO3', nome:'Empresa Sem Setor', preco:15, pl:8, pvp:1.2, dy:5, dyMedio5a:5,
        payout:40, anosPagandoDividendo:8, roe:14, margemLiquida:12, dividaLiquidaPl:0.4,
        liquidezCorrente:1.5, cagrReceita5a:6, cagrLucro5a:5, liquidezDiaria:2e7 }
    ], { lente:'equilibrio' });
    cartRenderizarMotorRanking(semSetor);
  `);
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(html.includes('setor não informado'));
  assert.ok(!html.includes('Empresa Sem Setor · Ações'));
});

test('a busca acha o ativo pelo setor E pelo bloco da política', () => {
  // São dois nomes para a mesma coisa na cabeça do utilizador: a Vale é
  // 'mineração' e está no bloco 'commodities'. Os dois têm de achar.
  const s = carregar();
  s.run(SEMENTE_MISTA);
  s.run('cartRenderizarMotorRanking(rankingMisto);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  ['mineração', 'commodities', 'basic materials', 'vale'].forEach((termo) => {
    const chave = s.run('cartNormalizarNome(' + JSON.stringify(termo) + ')');
    assert.ok(
      new RegExp('data-busca="[^"]*' + chave).test(html),
      `buscar por "${termo}" tem de achar a Vale`
    );
  });
});

test('setor que cedeu ao teto mostra alvo e aplicado, não só o aplicado', () => {
  // Bancos tem alvo de 40% da classe; com um único nome elegível, o teto de
  // concentração por ativo corta para 30%. Mostrar só os 30% faria a política
  // parecer ignorada.
  const s = carregar();
  s.run(SEMENTE_TETO);
  s.run('cartRenderizarMotorPlano(planoTeto);');
  const html = s.dom.els.get('cartMotorPlano').innerHTML;
  assert.ok(html.includes('cart-setor-chip cedeu'), 'o chip tem de se marcar como cedido');
  assert.ok(html.includes('alvo 40% da classe, aplicado'));
  assert.ok(html.includes('teto de concentração por ativo'));
});

test('o chip do setor lista os ativos que caíram nele', () => {
  // É o que liga a faixa à lista: sem os tickers, ler 'Consumo/Commodities' e
  // ver 'Vale · Mineração e Siderurgia' na linha seguinte não fecha.
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run(`
    var planoChips = motorPlanoAporte({
      aporteMensal: 6000, alocacaoAlvo: { rf: 0, acao: 100, fii: 0, cripto: 0 },
      ranking: rankingLista
    });
    cartRenderizarMotorPlano(planoChips);
  `);
  const html = s.dom.els.get('cartMotorPlano').innerHTML;
  assert.ok(/Bancos\/Financeiro[^"]*BBAS3/.test(html), 'o chip precisa nomear quem entrou');
});

test('o detalhe do card nasce fechado, mas continua no HTML', () => {
  // Esconder por CSS e não por render é o que permite abrir sem ir à rede e
  // buscar sem redesenhar. Se o detalhe saísse do HTML, a busca deixaria de
  // encontrar o que está dentro dele.
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run('cartRenderizarMotorRanking(rankingLista);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.ok(html.includes('cart-score-detalhe'));
  assert.ok(html.includes('aria-expanded="false"'), 'o estado tem de ser anunciado');
  assert.ok(html.includes('onclick="cartAlternarCard(this)"'));
  assert.ok(html.includes('confiança'), 'o conteúdo do detalhe continua presente');
});

test('cada classe tem o seu "ver mais" — a lista não é rolagem infinita', () => {
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run('cartRenderizarMotorRanking(rankingLista);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  assert.equal(html.split('cart-rank-mais').length - 1, 4);
  assert.ok(html.includes("cartVerMaisRanking('acao')"));
});

test('a lista nova não deixa escapar undefined nem NaN', () => {
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run('cartRenderizarMotorRanking(rankingLista);');
  const html = s.dom.els.get('cartMotorRanking').innerHTML;
  ['undefined', 'NaN', '[object Object]'].forEach((lixo) => {
    assert.ok(!html.includes(lixo), `a lista imprimiu "${lixo}"`);
  });
});

test('o plano mostra o setor de cada ativo e a faixa de diversificação', () => {
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run(`
    var planoLista = motorPlanoAporte({
      aporteMensal: 4000, alocacaoAlvo: { rf: 30, acao: 40, fii: 25, cripto: 5 },
      ranking: rankingLista
    });
    cartRenderizarMotorPlano(planoLista);
  `);
  const html = s.dom.els.get('cartMotorPlano').innerHTML;
  assert.ok(html.includes('Diversificação por setor'), 'a política tem de ser visível');
  assert.ok(html.includes('cart-setor-chip'));
  assert.ok(html.includes('Bancos/Financeiro'));
  // Nome longo também encurtado na coluna do plano — era ele que empurrava a
  // coluna e a página para o lado.
  assert.ok(html.includes('IPCA+ 2055'));
  assert.ok(html.includes('Tesouro IPCA+ com Juros Semestrais 2055'), 'o nome inteiro fica junto');
});

test('setor sem candidato é nomeado na tela, não some em silêncio', () => {
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run(`
    var planoParcial = motorPlanoAporte({
      aporteMensal: 4000, alocacaoAlvo: { rf: 0, acao: 100, fii: 0, cripto: 0 },
      ranking: rankingLista
    });
    cartRenderizarMotorPlano(planoParcial);
  `);
  const html = s.dom.els.get('cartMotorPlano').innerHTML;
  assert.ok(html.includes('sem candidato pontuado neste ciclo'));
  assert.ok(html.includes('alvo foi redistribuído'), 'tem de dizer para onde foi o dinheiro');
});

test('o setor do ranking do servidor sobrevive à segunda busca de dados', () => {
  // Era aqui que o setor morria: o universo automático descartava o campo, e
  // a cotação simples devolve `setor: null`, que o Object.assign cru
  // escrevia por cima. Sem setor, a política inteira deixa de se aplicar.
  const s = carregar();
  const RANKING_COM_SETOR = {
    classes: {
      acao: {
        total: 2,
        itens: [
          { ticker: 'BBAS3', nome: 'Banco do Brasil', score: 88, setor: 'Bancos' },
          { ticker: 'EGIE3', nome: 'Engie Brasil', score: 81, setor: 'Utilities' },
        ],
      },
      fii: {
        total: 1,
        itens: [
          { ticker: 'KNCR11', nome: 'Kinea Rendimentos', score: 84, setor: null, tipoFii: 'papel' },
        ],
      },
      cripto: { total: 0, itens: [] },
      rf: { total: 0, itens: [] },
    },
  };
  const base = JSON.parse(
    s.run(`JSON.stringify(cartUniversoAutomatico(${JSON.stringify(RANKING_COM_SETOR)}, []).itens)`)
  );
  const bbas = base.find((a) => a.ticker === 'BBAS3');
  assert.equal(bbas.setor, 'Bancos', 'o setor do ranking tem de entrar no universo');
  assert.equal(base.find((a) => a.ticker === 'KNCR11').tipoFii, 'papel');

  // Fundamentos que voltam sem setor (cotação simples) não podem apagá-lo.
  const universo = JSON.parse(
    s.run(`JSON.stringify(cartMontarUniverso(
      ${JSON.stringify(base)},
      { BBAS3: { preco: 28.5, setor: null }, KNCR11: { preco: 100, tipoFii: null } },
      []
    ))`)
  );
  assert.equal(universo.find((a) => a.ticker === 'BBAS3').setor, 'Bancos');
  assert.equal(universo.find((a) => a.ticker === 'KNCR11').tipoFii, 'papel');
});
