'use strict';

// Catálogo da B3: achar qualquer ativo pelo código ou pelo nome, com o tipo
// certo (web/appliquei-catalogo-b3.js, api/market.js?op=catalogo|busca e a
// parte do app em web/appliquei-yahoo-finance.js).
//
// O que ficou para trás e este arquivo segura:
//  - a busca só conhecia ~45 ativos escritos à mão: KLBN11 e qualquer outro
//    código aparecia como "Ativo não catalogado", sem nome nem preço;
//  - todo código terminado em 11 virava FII, inclusive as units (KLBN11,
//    TAEE11, SANB11), que são ações;
//  - código que não existe e código fora da lista recebiam o mesmo aviso;
//  - o campo de renda fixa não sugeria os títulos do Tesouro à venda.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'web', 'appliquei-catalogo-b3.js'));
const market = require(path.join(ROOT, 'api', 'market.js'));
const S = market.catalogo;

test('tipo: units são ação, FII é FII, ETF e BDR pelo código', () => {
  assert.equal(C.classificarAtivoB3('KLBN11'), 'Ação', 'unit conhecida, sem nome');
  assert.equal(C.classificarAtivoB3('TAEE11'), 'Ação');
  assert.equal(C.classificarAtivoB3('MXRF11'), 'FII');
  assert.equal(C.classificarAtivoB3('BOVA11'), 'ETF');
  assert.equal(C.classificarAtivoB3('AAPL34'), 'BDR');
  assert.equal(C.classificarAtivoB3('B3SA3'), 'Ação', 'dígito na segunda letra');
  assert.equal(C.classificarAtivoB3('BRKM5'), 'Ação', 'PNA também é ação');
  assert.equal(C.classificarAtivoB3('petr4f'), 'Ação', 'fracionário');
  assert.equal(C.classificarAtivoB3('BTC'), 'Cripto');
});

test('tipo: o nome da fonte desempata o sufixo 11', () => {
  assert.equal(C.classificarAtivoB3('XPTO11', 'XPTO S.A. UNT N2'), 'Ação');
  assert.equal(C.classificarAtivoB3('XPTO11', 'FII XPTO Logística'), 'FII');
  assert.equal(C.classificarAtivoB3('XPTO11', 'Fdo Inv Imob XPTO'), 'FII');
  assert.equal(C.classificarAtivoB3('XPTO11', 'iShares XPTO Fundo de Índice'), 'ETF');
  // A BRAPI chama ETF de 'fund' e unit de 'stock'; o Yahoo chama FII de EQUITY.
  assert.equal(C.classificarAtivoB3('XPTO11', '', 'stock'), 'Ação');
  assert.equal(C.classificarAtivoB3('XPTO11', 'FII XPTO', 'EQUITY'), 'FII');
});

test('tipo: renda fixa e texto livre não viram ação', () => {
  assert.equal(C.classificarAtivoB3('CDB25'), null);
  assert.equal(C.classificarAtivoB3('LCA2030'), null);
  assert.equal(C.classificarAtivoB3('TESOUROIPCA'), null);
  assert.equal(C.classificarAtivoB3(''), null);
});

test('busca: código exato primeiro, depois prefixo, nome sem acento', () => {
  const lista = [
    { t: 'KLBN4', n: 'Klabin PN', k: 'Ação' },
    { t: 'KLBN11', n: 'Klabin Unit', k: 'Ação' },
    { t: 'ITUB4', n: 'Itaú Unibanco PN', k: 'Ação' },
    { t: 'ITSA4', n: 'Itaúsa PN', k: 'Ação' },
    { t: 'HGLG11', n: 'CSHG Logística', k: 'FII' },
  ];
  assert.deepEqual(
    C.buscarNoCatalogoB3(lista, 'klbn11').map((a) => a.t),
    ['KLBN11']
  );
  assert.deepEqual(
    C.buscarNoCatalogoB3(lista, 'KLBN').map((a) => a.t),
    ['KLBN4', 'KLBN11']
  );
  assert.deepEqual(
    C.buscarNoCatalogoB3(lista, 'itau')
      .map((a) => a.t)
      .sort(),
    ['ITSA4', 'ITUB4']
  );
  assert.deepEqual(
    C.buscarNoCatalogoB3(lista, 'logistica').map((a) => a.t),
    ['HGLG11']
  );
  assert.deepEqual(C.buscarNoCatalogoB3(lista, 'zzz'), []);
});

// ------------------------------------------------------------------ servidor

test('servidor: catálogo não perde nome, ignora fracionário e volta do texto igual', () => {
  const mapa = new Map();
  assert.ok(S.catalogoIncluir(mapa, 'KLBN11.SA', 'Klabin S.A. UNT N2', 'EQUITY'));
  assert.ok(!S.catalogoIncluir(mapa, 'KLBN11', '', null), 'nome vazio não apaga o conhecido');
  assert.equal(mapa.get('KLBN11').n, 'Klabin S.A. UNT N2');
  assert.equal(mapa.get('KLBN11').k, 'Ação');
  assert.ok(!S.catalogoIncluir(mapa, 'PETR4F', 'Petrobras', null), 'fracionário fica de fora');
  assert.ok(!S.catalogoIncluir(mapa, 'BTC', 'Bitcoin', null), 'cripto não é da B3');
  const volta = S.catalogoDeTexto(S.catalogoParaTexto(mapa));
  assert.deepEqual(Array.from(volta.entries()), Array.from(mapa.entries()));
});

function fetchFalso(respostas) {
  const pedidos = [];
  const f = async (url, opcoes) => {
    pedidos.push({ url: String(url), opcoes });
    const r = respostas(String(url));
    return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body };
  };
  f.pedidos = pedidos;
  return f;
}

test('servidor: busca no Yahoo (sem BRAPI_TOKEN) só traz o que é da B3', async () => {
  const antes = process.env.BRAPI_TOKEN;
  delete process.env.BRAPI_TOKEN;
  try {
    const f = fetchFalso(() => ({
      body: {
        quotes: [
          {
            symbol: 'KLBN11.SA',
            longname: 'Klabin S.A.',
            shortname: 'KLABIN UNT',
            quoteType: 'EQUITY',
          },
          { symbol: 'KLBAY', shortname: 'Klabin ADR', quoteType: 'EQUITY' },
        ],
      },
    }));
    const r = await S.buscarAtivosNaFonte('klabin', f);
    assert.equal(r.fonte, 'yahoo');
    assert.deepEqual(
      r.lista.map((a) => a.t),
      ['KLBN11.SA']
    );
    assert.match(f.pedidos[0].url, /finance\/search\?q=klabin/);
    assert.ok(f.pedidos[0].opcoes.headers['User-Agent'], 'Yahoo recusa pedido sem User-Agent');
  } finally {
    if (antes !== undefined) process.env.BRAPI_TOKEN = antes;
  }
});

test('servidor: com BRAPI_TOKEN a busca vai à BRAPI, e cai no Yahoo se ela falhar', async () => {
  const antes = process.env.BRAPI_TOKEN;
  process.env.BRAPI_TOKEN = 'tk';
  try {
    const ok = fetchFalso(() => ({
      body: { stocks: [{ stock: 'KLBN11', name: 'Klabin UNT', type: 'stock' }] },
    }));
    const r = await S.buscarAtivosNaFonte('klabin', ok);
    assert.equal(r.fonte, 'brapi');
    assert.match(ok.pedidos[0].url, /brapi\.dev\/api\/quote\/list\?search=klabin/);
    assert.equal(ok.pedidos[0].opcoes.headers.Authorization, 'Bearer tk');

    const falha = fetchFalso((url) =>
      /brapi/.test(url) ? { ok: false, status: 500, body: {} } : { body: { quotes: [] } }
    );
    const r2 = await S.buscarAtivosNaFonte('klabin', falha);
    assert.equal(r2.fonte, 'yahoo');
  } finally {
    if (antes === undefined) delete process.env.BRAPI_TOKEN;
    else process.env.BRAPI_TOKEN = antes;
  }
});

test('servidor: o catálogo junta setores, CVM, cotações e a lista pública', async () => {
  const antes = process.env.BRAPI_TOKEN;
  delete process.env.BRAPI_TOKEN;
  try {
    const colecoes = {
      marketFundamentals: [
        { id: 'XPTO3', data: { nome: 'Xpto Indústria', classe: 'acao' } },
        { id: 'ABCD11', data: { nome: 'Abcd Fundo Imobiliário', classe: 'fii' } },
      ],
      marketQuotes: [{ id: 'KLBN11', data: { shortName: 'KLABIN S/A UNT N2' } }],
    };
    const snap = (docs) => ({
      forEach: (fn) => docs.forEach((d) => fn({ id: d.id, data: () => d.data })),
    });
    const database = {
      collection: (nome) => ({
        get: async () => snap(colecoes[nome] || []),
        where: () => ({ get: async () => snap(colecoes[nome] || []) }),
      }),
    };
    const f = fetchFalso((url) => {
      assert.match(url, /brapi\.dev\/api\/available/);
      return { body: { stocks: ['NOVO3', 'PETR4F'] } };
    });
    const { mapa, fontes } = await S.montarCatalogo(database, null, f);
    assert.equal(mapa.get('XPTO3').n, 'Xpto Indústria');
    assert.equal(mapa.get('ABCD11').k, 'FII');
    assert.equal(mapa.get('KLBN11').k, 'Ação', 'unit pelo nome da cotação');
    assert.equal(mapa.get('NOVO3').k, 'Ação', 'código da lista pública, mesmo sem nome');
    assert.ok(!mapa.has('PETR4F'));
    assert.ok(mapa.has('MXRF11'), 'setores-b3.json entra no catálogo');
    assert.equal(fontes.brapi, 1);
  } finally {
    if (antes !== undefined) process.env.BRAPI_TOKEN = antes;
  }
});

test('servidor: chave da busca ignora caixa, acento e símbolos', () => {
  assert.equal(S.chaveBusca('  Itaú   Unibanco! '), 'itau unibanco');
  assert.equal(S.chaveBusca('x'.repeat(80)).length, 40);
});

// ------------------------------------------------------------------- app

function storage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

function carregarApp(respostas) {
  const pedidos = [];
  const campos = {
    compraTicker: { value: '' },
    compraCategoria: { value: 'renda_variavel' },
    compraVencimento: { value: '' },
    compraRentabilidade: { value: '' },
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: storage(),
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout,
    Promise,
    Date,
    Math,
    JSON,
    Set,
    Map,
    Number,
    String,
    Array,
    Object,
    encodeURIComponent,
    historicoCompras: [],
    mpEstado: { cotacoes: {} },
    formatarMoeda: (v) => 'R$ ' + v,
    CustomEvent: function () {},
    document: {
      getElementById: (id) => campos[id] || null,
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: () => ({}),
      addEventListener() {},
      visibilityState: 'visible',
    },
    fetch: async (url) => {
      pedidos.push(String(url));
      const r = respostas(String(url));
      return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body };
    },
  };
  ctx.window = ctx;
  ctx.window.AppliqueiFirebase = { auth: { currentUser: { getIdToken: async () => 'tok' } } };
  ctx.dispatchEvent = () => true;
  vm.createContext(ctx);
  for (const f of ['appliquei-catalogo-b3.js', 'appliquei-yahoo-finance.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'web', f), 'utf8'), ctx);
  return { ctx, pedidos, campos };
}

const esperar = () => new Promise((r) => setTimeout(r, 20));

test('app: código fora da lista é cotado na hora e entra com nome e tipo certos', async () => {
  const { ctx, pedidos } = carregarApp(() => ({
    body: { quotes: { KLBN11: { price: 21.3, shortName: 'KLABIN S/A UNT N2' } }, semCotacao: [] },
  }));
  ctx.consultarAtivoDigitado('Klbn11');
  await esperar();
  assert.equal(pedidos.length, 1);
  assert.match(pedidos[0], /op=quote&tickers=KLBN11/);
  const info = ctx.infoAtivoB3('KLBN11');
  assert.equal(info.n, 'KLABIN S/A UNT N2');
  assert.equal(info.k, 'Ação', 'unit não é FII');
  assert.equal(ctx.mockAtivosMercado.find((a) => a.ticker === 'KLBN11').preco_atual, 21.3);
  ctx.consultarAtivoDigitado('KLBN11');
  await esperar();
  assert.equal(pedidos.length, 1, 'já cotado: não pergunta de novo');
});

test('app: código que a fonte não conhece vira "não encontrado", sem rede vira nada', async () => {
  const { ctx } = carregarApp(() => ({ body: { quotes: {}, semCotacao: ['XPTO3'] } }));
  ctx.consultarAtivoDigitado('XPTO3');
  await esperar();
  assert.equal(ctx.estadoConsultaAtivo('XPTO3'), 'nao_encontrado');

  const off = carregarApp(() => ({ ok: false, status: 503, body: { error: 'x' } }));
  off.ctx.consultarAtivoDigitado('XPTO3');
  await esperar();
  assert.equal(off.ctx.estadoConsultaAtivo('XPTO3'), '', 'falha de rede não afirma que não existe');
});

test('app: nome sem resultado bom no aparelho pergunta ao servidor', async () => {
  const { ctx, pedidos } = carregarApp(() => ({
    body: {
      ativos: [
        ['KLBN11', 'Klabin UNT', 'Ação'],
        ['KLBN4', 'Klabin PN', 'Ação'],
      ],
    },
  }));
  ctx.consultarAtivoDigitado('klabin');
  await esperar();
  assert.match(pedidos[0], /op=busca&q=klabin/);
  assert.deepEqual(
    Array.from(ctx.buscarAtivosLocal('klabin'), (a) => a.t),
    ['KLBN4', 'KLBN11']
  );
  assert.ok(ctx.localStorage.getItem('apq-catalogo-v1'), 'o que achou fica no aparelho');
});

test('app: catálogo do servidor é baixado uma vez por dia', async () => {
  const { ctx, pedidos } = carregarApp(() => ({
    body: { ativos: [['ABCD11', 'Abcd FII', 'FII']], atualizadoMs: 1 },
  }));
  assert.equal(await ctx.carregarCatalogoAtivos(false), true);
  assert.equal(ctx.infoAtivoB3('ABCD11').k, 'FII');
  assert.equal(await ctx.carregarCatalogoAtivos(false), false);
  assert.equal(pedidos.length, 1);
});

test('app: título do Tesouro preenche vencimento e taxa no formato do formulário', async () => {
  const { ctx, campos } = carregarApp(() => ({
    body: {
      titulos: [
        {
          nome: 'Tesouro IPCA+ 2035',
          tipo: 'ipca',
          taxaContratada: 7.45,
          vencimento: '2035-05-15',
        },
        {
          nome: 'Tesouro Selic 2029',
          tipo: 'selic',
          taxaContratada: 0.05,
          vencimento: '2029-03-01',
        },
        { nome: 'Tesouro Prefixado 2031', tipo: 'prefixado', taxaContratada: 13.2 },
      ],
    },
  }));
  await ctx.carregarTitulosTesouro();
  assert.equal(ctx.rentabilidadeDoTitulo(ctx.titulosTesouro[1]), 'SELIC+0,05%');
  assert.equal(ctx.rentabilidadeDoTitulo(ctx.titulosTesouro[2]), '13,20% a.a.');
  assert.equal(ctx.preencherTituloTesouro('tesouro ipca+ 2035'), true);
  assert.equal(campos.compraVencimento.value, '2035-05-15');
  assert.equal(campos.compraRentabilidade.value, 'IPCA+7,45%');
  campos.compraRentabilidade.value = 'IPCA+6%';
  campos.compraVencimento.value = '';
  ctx.preencherTituloTesouro('Tesouro IPCA+ 2035');
  assert.equal(campos.compraRentabilidade.value, 'IPCA+6%', 'não apaga o que a pessoa digitou');
});

test('o formulário liga a busca, a lista do Tesouro e o aviso de não encontrado', () => {
  const app = fs.readFileSync(path.join(ROOT, 'web', 'appliquei-app.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
  assert.match(app, /consultarAtivoDigitado\(inputTicker\.value\)/);
  assert.match(app, /setAttribute\('list', 'listaTitulosTesouro'\)/);
  assert.match(app, /Não encontramos esse código na B3/);
  assert.match(html, /<datalist id="listaTitulosTesouro">/);
  assert.ok(
    html.indexOf('appliquei-catalogo-b3.js') < html.indexOf('appliquei-yahoo-finance.js'),
    'o catálogo carrega antes de quem o usa'
  );
});
