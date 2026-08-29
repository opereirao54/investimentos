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
        // Sem estes, qualquer aria-* no render quebra aqui e passa no browser.
        setAttribute() {},
        getAttribute: () => null,
        removeAttribute() {},
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

test('ativo sem setor entra no plano pelo balde "Outros setores"', () => {
  // Antes ele ficava FORA: aparecia pontuado na lista e nunca recebia aporte.
  // O balde curinga existe para isso — e cede o lugar sozinho quando não há
  // ninguém para pôr nele, deixando as proporções declaradas exatas.
  const s = carregar();
  s.run(`
    function acaoSemSetor(t, n, setor, q) {
      return { ticker:t, nome:n, classe:'acao', setor:setor, preco:20, pl:q, pvp:1, dy:8,
        dyMedio5a:7, payout:50, anosPagandoDividendo:15, roe:q*2.2, margemLiquida:20,
        dividaLiquidaPl:0.3, liquidezCorrente:1.6, cagrReceita5a:q, cagrLucro5a:q,
        liquidezDiaria:4e7 };
    }
    var comLacuna = motorRanquear([
      acaoSemSetor('BBAS3','Banco do Brasil','Bancos',6),
      acaoSemSetor('EGIE3','Engie Brasil','Utilities',5),
      acaoSemSetor('XPTO3','Sem Setor A',null,9)
    ], { lente:'equilibrio' });
    var planoLacuna = motorPlanoAporte({
      aporteMensal: 6000, alocacaoAlvo: { rf: 0, acao: 100, fii: 0, cripto: 0 },
      ranking: comLacuna
    });
    cartRenderizarMotorPlano(planoLacuna);
  `);
  const html = s.dom.els.get('cartMotorPlano').innerHTML;
  assert.ok(html.includes('XPTO3'), 'o ativo sem setor tem de receber aporte');
  assert.ok(html.includes('Outros setores'), 'e o balde dele tem de aparecer na faixa');
  assert.ok(
    !html.includes('ficaram fora do plano por não terem setor'),
    'não há mais ninguém de fora para declarar'
  );
});

test('zerar "Outros setores" volta a excluir — e a tela diz quantos', () => {
  // A exclusão passa a ser uma ESCOLHA do utilizador, não uma limitação nossa.
  // Continua a ter de ser dita: o ativo aparece pontuado na lista e nunca no
  // plano, e sem esta linha a seleção pareceria arbitrária.
  const s = carregar();
  s.run(`
    function acaoSemSetor2(t, n, setor, q) {
      return { ticker:t, nome:n, classe:'acao', setor:setor, preco:20, pl:q, pvp:1, dy:8,
        dyMedio5a:7, payout:50, anosPagandoDividendo:15, roe:q*2.2, margemLiquida:20,
        dividaLiquidaPl:0.3, liquidezCorrente:1.6, cagrReceita5a:q, cagrLucro5a:q,
        liquidezDiaria:4e7 };
    }
    var rankLacuna = motorRanquear([
      acaoSemSetor2('BBAS3','Banco do Brasil','Bancos',6),
      acaoSemSetor2('EGIE3','Engie Brasil','Utilities',5),
      acaoSemSetor2('XPTO3','Sem Setor A',null,9),
      acaoSemSetor2('ZZZZ3','Sem Setor B',null,8)
    ], { lente:'equilibrio' });
    // Política do utilizador SEM o curinga.
    cartEstado.custom = { ativo: true, alloc: null, ativos: null,
      setores: { acao: { financeiro: 50, energia: 50, saneamento: 0,
                         tecindustria: 0, consumo: 0, outros: 0 } } };
    var planoSemCuringa = motorPlanoAporte({
      aporteMensal: 6000, alocacaoAlvo: { rf: 0, acao: 100, fii: 0, cripto: 0 },
      ranking: rankLacuna, porClasse: cartPorClasseCustom()
    });
    cartRenderizarMotorPlano(planoSemCuringa);
  `);
  const html = s.dom.els.get('cartMotorPlano').innerHTML;
  assert.ok(html.includes('2 ativos pontuados ficaram fora do plano por não terem setor'));
  assert.ok(!html.includes('XPTO3'), 'zerado é zerado');
});

// ════════════════════════════════════════════
// Montar do meu jeito
// ════════════════════════════════════════════
//
// A regra de produto que estes testes protegem: a RECOMENDAÇÃO é o que a tela
// apresenta primeiro, sempre. Quem não entende de investimento recebe uma
// carteira pronta sem ter de decidir nada; o personalizado é opt-in explícito
// e volta atrás num clique. Um bug que ligue o custom sozinho, ou que não
// consiga desligá-lo, quebra o produto para o utilizador que ele mais serve.

test('o modo personalizado nasce desligado e não interfere na recomendação', () => {
  const s = carregar();
  s.run("cartEstado.perfil = 'Moderado';");
  const padrao = s.run('JSON.stringify(cartAlocacaoAlvo())');
  assert.equal(s.run('cartCustomAtivo()'), false);
  assert.equal(s.run("String(cartSetoresCustom('acao'))"), 'undefined', 'usa a política padrão');
  // Ligar sem escolher nada continua sendo a recomendação: o interruptor não
  // é a personalização, as escolhas é que são.
  s.run('cartCustom().ativo = true;');
  assert.equal(s.run('cartCustomAtivo()'), false);
  assert.equal(s.run('JSON.stringify(cartAlocacaoAlvo())'), padrao);
});

test('a divisão escolhida à mão vence perfil, objetivo e prazo', () => {
  const s = carregar();
  s.run(`
    cartEstado.perfil = 'Conservador';
    cartEstado.custom = { ativo: true, alloc: { rf: 10, acao: 60, fii: 25, cripto: 5 },
      setores: null, ativos: null };
  `);
  assert.deepEqual(JSON.parse(s.run('JSON.stringify(cartAlocacaoAlvo())')), {
    rf: 10,
    acao: 60,
    fii: 25,
    cripto: 5,
  });
});

test('setor zerado sai da política em vez de ficar com alvo zero', () => {
  // Alvo zero continuaria a ganhar vaga na repartição por maior média — o
  // utilizador zerou porque não quer o setor, não porque quer pouco dele.
  const s = carregar();
  s.run(`
    cartEstado.custom = { ativo: true, alloc: null, ativos: null,
      setores: { acao: { financeiro: 50, energia: 0, saneamento: 0, tecindustria: 25, consumo: 25 } } };
  `);
  const chaves = JSON.parse(
    s.run("JSON.stringify(cartSetoresCustom('acao').map(function (b) { return b.chave; }))")
  );
  assert.deepEqual(chaves, ['financeiro', 'tecindustria', 'consumo']);
  // FIIs, que ele não tocou, continuam na recomendação.
  assert.equal(s.run("String(cartSetoresCustom('fii'))"), 'undefined');
});

test('zerar TODOS os setores devolve a classe à recomendação, não a esvazia', () => {
  const s = carregar();
  s.run(`
    cartEstado.custom = { ativo: true, alloc: null, ativos: null,
      setores: { acao: { financeiro: 0, energia: 0, saneamento: 0, tecindustria: 0, consumo: 0 } } };
  `);
  assert.equal(
    s.run("String(cartSetoresCustom('acao'))"),
    'undefined',
    'classe sem nenhum setor seria classe sem seleção nenhuma'
  );
});

test('a escolha de ativos filtra o PLANO e deixa a lista inteira', () => {
  // Esconder o que ficou de fora tiraria do utilizador a única forma de rever
  // a própria escolha.
  const s = carregar();
  s.run(`
    cartEstado.custom = { ativo: true, alloc: null, setores: null,
      ativos: { acao: ['BBAS3', 'WEGE3'] } };
    var rankFake = [
      { ticker: 'BBAS3', classe: 'acao' }, { ticker: 'ITUB4', classe: 'acao' },
      { ticker: 'WEGE3', classe: 'acao' }, { ticker: 'MXRF11', classe: 'fii' }
    ];
  `);
  const filtrado = JSON.parse(
    s.run('JSON.stringify(cartRankingParaPlano(rankFake).map(function (a) { return a.ticker; }))')
  );
  assert.deepEqual(filtrado, ['BBAS3', 'WEGE3', 'MXRF11'], 'classe sem escolha passa inteira');
});

test('os pesos são reescalados para 100 sem perder nem inventar ponto', () => {
  // O painel não obriga o utilizador a fechar a conta na unha. Arredondar
  // cada peso por si deixaria o total em 99 ou 101, e a tela mostraria uma
  // alocação que não fecha.
  const s = carregar();
  [
    { a: 3, b: 3, c: 3 },
    { a: 10, b: 20, c: 70 },
    { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 },
    { a: 250, b: 250 },
  ].forEach((entrada) => {
    const r = JSON.parse(
      s.run('JSON.stringify(cartNormalizar100(' + JSON.stringify(entrada) + '))')
    );
    const soma = Object.values(r).reduce((x, y) => x + y, 0);
    assert.ok(Math.abs(soma - 100) < 0.001, `${JSON.stringify(entrada)} somou ${soma}, não 100`);
  });
  assert.equal(s.run('String(cartNormalizar100({ a: 0, b: 0 }))'), 'null', 'tudo zero não fecha');
});

test('voltar à recomendação apaga as escolhas, não só o interruptor', () => {
  // Desligar guardando a escolha faria a próxima ativação ressuscitar uma
  // carteira que o utilizador achava ter descartado.
  const s = carregar();
  s.run(`
    cartEstado.perfil = 'Moderado';
    cartEstado.custom = { ativo: true, alloc: { rf: 0, acao: 100, fii: 0, cripto: 0 },
      setores: { acao: { financeiro: 100 } }, ativos: { acao: ['BBAS3'] } };
    cartMotor.buscadoEm = null;
    cartRestaurarRecomendacao();
  `);
  assert.equal(s.run('cartCustomAtivo()'), false);
  assert.equal(s.run('String(cartCustom().alloc)'), 'null');
  assert.equal(s.run('String(cartCustom().setores)'), 'null');
  assert.equal(s.run('String(cartCustom().ativos)'), 'null');

  // E a BARRA tem de acompanhar. O painel dependia de cartRecalcularMotor
  // para se redesenhar, e essa função desiste cedo enquanto a busca não
  // aconteceu: o utilizador aplicava, o painel fechava, e a barra continuava
  // a dizer o contrário do estado — sem caminho de volta à vista.
  const cta = s.dom.els.get('cartCustomWrap').innerHTML;
  assert.ok(cta.includes('Esta é a nossa recomendação'), 'a barra tem de voltar ao texto padrão');
  assert.ok(!cta.includes('Carteira personalizada por você'));
});

test('o painel abre com a recomendação carregada, não com tudo em zero', () => {
  // Abrir em branco devolveria ao utilizador a decisão que ele veio buscar.
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run(
    "cartEstado.perfil = 'Moderado'; cartMotor.ranking = rankingLista; cartRenderizarCustom();"
  );
  const html = s.dom.els.get('cartCustomWrap').innerHTML;

  assert.ok(html.includes('Esta é a nossa recomendação'), 'a recomendação é o que se apresenta');
  assert.ok(html.includes('Montar do meu jeito'));
  assert.ok(html.includes('cart-custom-painel'));
  assert.ok(html.includes('hidden'), 'o painel nasce fechado');
  // Os três níveis existem.
  assert.ok(html.includes('Divisão entre as classes'));
  assert.ok(html.includes('Setores dentro de cada classe'));
  assert.ok(html.includes('Ativos que podem entrar'));
  // E os controles partem dos valores da recomendação.
  assert.ok(/data-grupo="classe" data-chave="rf"/.test(html));
  assert.ok(/data-grupo="setor:acao" data-chave="financeiro"/.test(html));
  assert.ok(!/value="0"[^>]*data-grupo="classe"/.test(html), 'não abre tudo zerado');
});

test('com o custom ligado, a tela diz de quem é a carteira e como voltar', () => {
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run(`
    cartEstado.perfil = 'Moderado';
    cartEstado.custom = { ativo: true, alloc: { rf: 20, acao: 50, fii: 25, cripto: 5 },
      setores: null, ativos: null };
    cartMotor.ranking = rankingLista;
    cartRenderizarCustom();
  `);
  const html = s.dom.els.get('cartCustomWrap').innerHTML;
  assert.ok(html.includes('Carteira personalizada por você'));
  assert.ok(html.includes('Voltar à recomendação'), 'o caminho de volta tem de estar à vista');
});

test('o painel não deixa escapar undefined nem NaN', () => {
  const s = carregar();
  s.run(SEMENTE_LISTA);
  s.run('cartMotor.ranking = rankingLista; cartRenderizarCustom();');
  const html = s.dom.els.get('cartCustomWrap').innerHTML;
  ['undefined', 'NaN', '[object Object]'].forEach((lixo) => {
    assert.ok(!html.includes(lixo), `o painel imprimiu "${lixo}"`);
  });
});

// ════════════════════════════════════════════
// Performance histórica
// ════════════════════════════════════════════

/** Série mensal sintética: 36 meses subindo, com oscilação. */
function serieDeTeste(meses, taxa) {
  const out = [];
  let p = 100;
  for (let i = 0; i <= meses; i++) {
    out.push({ t: i, p });
    p *= 1 + taxa;
  }
  return out;
}

test('a simulação responde à pergunta do título antes de tudo', () => {
  // Oito caixas do mesmo tamanho é o mesmo que não ter destaque: a pergunta
  // ("como teria performado?") tem UMA resposta, e ela competia em pé de
  // igualdade com o drawdown máximo.
  const s = carregar();
  s.ctx.cartEstado.capital = 2000;
  s.ctx.cartEstado.perfil = 'Moderado';
  s.ctx.serie = serieDeTeste(36, 0.011);
  s.ctx.cdiSerie = serieDeTeste(36, 0.0095);
  s.run('cartRenderizarSimKpis(serie, cdiSerie);');
  const html = s.dom.els.get('cartSimKpis').innerHTML;

  assert.ok(html.includes('cart-sim-hero'), 'o número principal precisa de destaque próprio');
  assert.ok(html.includes('Patrimônio final estimado'));
  assert.ok(html.includes('cart-sim-principais'), 'os que sustentam a resposta');
  assert.ok(html.includes('cart-sim-secundarios'), 'os de risco, em peso menor');
  // A frase em português é o que faz a secção informar quem não lê número.
  assert.ok(/Aportando .* por mês durante 3 anos/.test(html));
});

test('o ganho aparece uma vez só, no destaque', () => {
  // Ele estava no hero E numa das caixas principais: o mesmo número duas
  // vezes gasta a atenção que o resto da secção precisa.
  const s = carregar();
  s.ctx.cartEstado.capital = 2000;
  s.ctx.serie = serieDeTeste(36, 0.011);
  s.ctx.cdiSerie = serieDeTeste(36, 0.0095);
  s.run('cartRenderizarSimKpis(serie, cdiSerie);');
  const html = s.dom.els.get('cartSimKpis').innerHTML;
  const vezes = html.split('Ganho sobre o aportado').length - 1;
  assert.equal(vezes, 1, `"Ganho sobre o aportado" apareceu ${vezes} vezes`);
});

test('sem CDI a comparação some, em vez de imprimir travessão ou zero', () => {
  const s = carregar();
  s.ctx.cartEstado.capital = 1000;
  s.ctx.serie = serieDeTeste(24, 0.01);
  s.run('cartRenderizarSimKpis(serie, null);');
  const html = s.dom.els.get('cartSimKpis').innerHTML;
  assert.ok(!html.includes('CDI'), 'sem a série, nada de CDI na tela');
  assert.ok(html.includes('Patrimônio final estimado'), 'o resto continua de pé');
  ['undefined', 'NaN', 'null'].forEach((lixo) => {
    assert.ok(!html.includes(lixo), `a simulação imprimiu "${lixo}"`);
  });
});

// ════════════════════════════════════════════
// Trocar o ativo de um lugar do plano
// ════════════════════════════════════════════
//
// A troca é do LUGAR, não da carteira: o motor decidiu que aquele slot vale
// R$ 1.800, e pôr outro ticker ali não pode reordenar nada. É isso que a torna
// previsível — trocar um banco por outro não muda quanto vai para energia.

const SEMENTE_TROCA = `
  function acaoTroca(t, setor, q, preco) {
    return { ticker:t, nome:t, classe:'acao', setor:setor, preco:preco, pl:q, pvp:1, dy:8,
      dyMedio5a:7, payout:50, anosPagandoDividendo:15, roe:q*2.2, margemLiquida:20,
      dividaLiquidaPl:0.3, liquidezCorrente:1.6, cagrReceita5a:q, cagrLucro5a:q,
      liquidezDiaria:4e7 };
  }
  var rankTroca = motorRanquear([
    acaoTroca('BBAS3','Bancos',9,28.5), acaoTroca('ITUB4','Bancos',8,33),
    acaoTroca('BBDC4','Bancos',5,14), acaoTroca('EGIE3','Utilities',7,40),
    acaoTroca('TAEE11','Utilities',4,11), acaoTroca('SBSP3','Saneamento',6,90),
    acaoTroca('CSMG3','Saneamento',3,22), acaoTroca('WEGE3','Industrials',8,50),
    acaoTroca('TOTS3','Technology',3,35), acaoTroca('LREN3','Comércio Varejista',7,15),
    acaoTroca('XPTO3',null,9,20)
  ], { lente:'equilibrio' });
  var planoTroca = motorPlanoAporte({
    aporteMensal: 6000, alocacaoAlvo: { rf: 0, acao: 100, fii: 0, cripto: 0 }, ranking: rankTroca
  });
  cartMotor.ranking = rankTroca;
  cartMotor.plano = planoTroca;
`;

test('a troca mantém o valor do lugar e recalcula a quantidade pelo preço novo', () => {
  const s = carregar();
  s.run(SEMENTE_TROCA);
  const r = JSON.parse(
    s.run(`
    var lugar = planoTroca.classes.acao.itens[0];
    var de = lugar.ticker, alvo = lugar.valorAlvo;
    var para = cartCandidatosTroca('acao', de)[0].ticker;
    var precoNovo = rankTroca.filter(function (x) { return x.ticker === para; })[0].preco;
    cartEstado.custom = { ativo:true, alloc:null, setores:null, ativos:null, trocas:{} };
    cartCustom().trocas[de] = para;
    cartAplicarTrocas(planoTroca, rankTroca);
    var novo = planoTroca.classes.acao.itens.filter(function (i) { return i.trocadoDe; })[0];
    JSON.stringify({ de: de, para: para, alvo: alvo, precoNovo: precoNovo,
      ticker: novo.ticker, trocadoDe: novo.trocadoDe, quantidade: novo.quantidade,
      valorInvestido: novo.valorInvestido, valorAlvo: novo.valorAlvo });
  `)
  );

  assert.equal(r.ticker, r.para, 'o lugar passa a ser do substituto');
  assert.equal(r.trocadoDe, r.de, 'e guarda de quem era, para a tela poder dizer');
  assert.equal(r.valorAlvo, r.alvo, 'o VALOR do lugar não muda — é o ponto da troca');
  assert.equal(
    r.quantidade,
    Math.floor(r.alvo / r.precoNovo),
    'a quantidade sai do preço novo, em lote inteiro'
  );
  assert.equal(r.valorInvestido, Math.round(r.quantidade * r.precoNovo * 100) / 100);
});

test('depois da troca o dinheiro continua fechando com o aporte', () => {
  // A invariante que importa: investido + retido + sobra = aporte. A diferença
  // de lote do ativo trocado cai na sobra da classe, não desaparece.
  const s = carregar();
  s.run(SEMENTE_TROCA);
  const r = JSON.parse(
    s.run(`
    var de = planoTroca.classes.acao.itens[0].ticker;
    var para = cartCandidatosTroca('acao', de)[0].ticker;
    cartEstado.custom = { ativo:true, alloc:null, setores:null, ativos:null, trocas:{} };
    cartCustom().trocas[de] = para;
    cartAplicarTrocas(planoTroca, rankTroca);
    var somaClasses = 0;
    MOTOR_CLASSES.forEach(function (c) {
      if (planoTroca.classes[c]) somaClasses += planoTroca.classes[c].investido;
    });
    JSON.stringify({ aporte: planoTroca.aporte, total: planoTroca.totalInvestido,
      retido: planoTroca.retido, sobra: planoTroca.sobra, somaClasses: somaClasses,
      itens: planoTroca.itens.length, naClasse: planoTroca.classes.acao.itens.length });
  `)
  );
  assert.ok(
    Math.abs(r.total + r.retido + r.sobra - r.aporte) < 0.02,
    `não fechou: ${r.total} + ${r.retido} + ${r.sobra} != ${r.aporte}`
  );
  assert.ok(Math.abs(r.somaClasses - r.total) < 0.02, 'o total tem de ser a soma das classes');
  assert.equal(r.itens, r.naClasse, 'a lista achatada tem de acompanhar a troca');
});

test('candidatos à troca incluem quem não tem setor', () => {
  // Quem escolhe à mão não devia ser barrado por uma lacuna da NOSSA fonte de
  // dados. O ativo sem setor aparece como qualquer outro.
  const s = carregar();
  s.run(SEMENTE_TROCA);
  s.run(`
    cartEstado.custom = { ativo:true, alloc:null, setores:null, ativos:null,
      trocas:{} };
    // Tira o XPTO3 do plano para ele virar candidato.
    planoTroca.classes.acao.itens = planoTroca.classes.acao.itens.filter(
      function (i) { return i.ticker !== 'XPTO3'; });
  `);
  const cands = JSON.parse(
    s.run(
      "JSON.stringify(cartCandidatosTroca('acao', 'BBAS3').map(function (a) { return a.ticker; }))"
    )
  );
  assert.ok(cands.includes('XPTO3'), `ativo sem setor tem de ser oferecido: ${cands.join(', ')}`);
  assert.ok(!cands.includes('BBAS3'), 'o próprio não se troca por si');
});

test('candidato já no plano não é oferecido — trocar por ele seria duplicar', () => {
  const s = carregar();
  s.run(SEMENTE_TROCA);
  const r = JSON.parse(
    s.run(`
    var noPlano = planoTroca.classes.acao.itens.map(function (i) { return i.ticker; });
    var de = noPlano[0];
    JSON.stringify({ noPlano: noPlano,
      cands: cartCandidatosTroca('acao', de).map(function (a) { return a.ticker; }) });
  `)
  );
  r.cands.forEach((t) => {
    assert.ok(!r.noPlano.includes(t), `${t} já está no plano e foi oferecido`);
  });
});

test('troca para um ticker que saiu do universo é ignorada, sem furar o plano', () => {
  // O substituto pode ter saído do ranking entre uma sessão e outra. O certo é
  // voltar ao ativo do motor, não deixar o lugar vazio.
  const s = carregar();
  s.run(SEMENTE_TROCA);
  const r = JSON.parse(
    s.run(`
    var de = planoTroca.classes.acao.itens[0].ticker;
    cartEstado.custom = { ativo:true, alloc:null, setores:null, ativos:null,
      trocas: {} };
    cartCustom().trocas[de] = 'FANTASMA9';
    cartAplicarTrocas(planoTroca, rankTroca);
    JSON.stringify({ primeiro: planoTroca.classes.acao.itens[0].ticker, de: de,
      trocados: planoTroca.classes.acao.itens.filter(function (i) { return i.trocadoDe; }).length });
  `)
  );
  assert.equal(r.primeiro, r.de, 'o lugar continua com o ativo que o motor escolheu');
  assert.equal(r.trocados, 0);
});

test('a folha de troca lista, busca e oferece o caminho de volta', () => {
  const s = carregar();
  s.run(SEMENTE_TROCA);
  s.run("cartAbrirTroca('BBAS3', 'acao');");
  const html = s.dom.els.get('cartTrocaWrap').innerHTML;

  assert.ok(html.includes('Trocar <strong>BBAS3</strong>'));
  assert.ok(html.includes('cart-troca-op'), 'os candidatos têm de aparecer');
  assert.ok(html.includes('id="cartTrocaBusca"'), 'com busca, como o resto da aba');
  assert.ok(html.includes('O lugar mantém o valor'), 'tem de dizer o que a troca faz');
  ['undefined', 'NaN', '[object Object]'].forEach((lixo) => {
    assert.ok(!html.includes(lixo), `a folha imprimiu "${lixo}"`);
  });

  s.run('cartFecharTroca();');
  assert.equal(s.dom.els.get('cartTrocaWrap').innerHTML, '', 'fechar limpa a sobreposição');
});

test('desfazer a troca aceita tanto o ativo original quanto o substituto', () => {
  // Na tela vê-se o SUBSTITUTO; a chave gravada é o original. Aceitar só um
  // dos dois deixaria o botão da tela sem efeito.
  const s = carregar();
  s.run(SEMENTE_TROCA);
  s.run(`
    cartEstado.custom = { ativo:true, alloc:null, setores:null, ativos:null,
      trocas: { BBAS3: 'ITUB4' } };
    cartMotor.buscadoEm = null;
    cartDesfazerTroca('ITUB4');
  `);
  assert.equal(s.run('String(cartCustom().trocas)'), 'null', 'desfez pelo substituto');

  s.run(`
    cartEstado.custom = { ativo:true, alloc:null, setores:null, ativos:null,
      trocas: { BBAS3: 'ITUB4' } };
    cartDesfazerTroca('BBAS3');
  `);
  assert.equal(s.run('String(cartCustom().trocas)'), 'null', 'e pelo original');
});

test('o plano marca o lugar trocado e oferece o botão de troca em cada item', () => {
  const s = carregar();
  s.run(SEMENTE_TROCA);
  s.run(`
    cartEstado.custom = { ativo:true, alloc:null, setores:null, ativos:null, trocas:{} };
    var de = planoTroca.classes.acao.itens[0].ticker;
    cartCustom().trocas[de] = cartCandidatosTroca('acao', de)[0].ticker;
    cartAplicarTrocas(planoTroca, rankTroca);
    cartRenderizarMotorPlano(planoTroca);
  `);
  const html = s.dom.els.get('cartMotorPlano').innerHTML;
  assert.ok(html.includes('cart-plano-item trocado'), 'o lugar trocado tem de se identificar');
  assert.ok(html.includes('cart-plano-trocar'), 'todo item oferece a troca');
  assert.ok(html.includes('cartAbrirTroca('));
  assert.ok(html.includes('Trocado por você no lugar de'), 'e diz de quem era');
});
