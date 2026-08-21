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

// ════════════════════════════════════════════
// Status
// ════════════════════════════════════════════

test('o status informa a lente e a cobertura real dos dados', () => {
  const s = carregar();
  s.run(SEMENTE);
  s.run(
    'cartMotor.ranking = rankingTeste; cartEstado.lente = "renda"; cartRenderizarMotorStatus();'
  );
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('Renda &amp; Perenidade') || html.includes('Renda & Perenidade'));
  assert.ok(
    /\d+ de 3 ativos com indicadores/.test(html),
    'o cliente precisa saber quantos ativos têm dado'
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

test('cobertura baixa avisa antes de o cliente confiar no ranking', () => {
  const s = carregar();
  s.run(`
    cartMotor.ranking = motorRanquear([{ ticker:'AAAA3', nome:'Quase sem dado', pl: 7 }], {});
    cartRenderizarMotorStatus();
  `);
  const html = s.dom.els.get('cartMotorStatus').innerHTML;
  assert.ok(html.includes('Cobertura de indicadores baixa'));
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

test('ativo desmarcado sai do universo do motor', () => {
  const s = carregar();
  const antes = JSON.parse(
    s.run('JSON.stringify(cartUniversoBase().map(function(a){return a.ticker}))')
  );
  assert.ok(antes.includes('BBAS3'), 'a carteira modelo padrão tem BBAS3');

  const depois = JSON.parse(
    s.run(`
      cartEstado.selecionados.acao = ['EGIE3'];
      JSON.stringify(cartUniversoBase().map(function(a){ return a.ticker }))
    `)
  );
  assert.ok(!depois.includes('BBAS3'), 'desmarcar tem de tirar o ativo dos candidatos');
  assert.ok(depois.includes('EGIE3'));
  assert.ok(depois.includes('MXRF11'), 'desmarcar em ações não pode afetar as outras classes');
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
