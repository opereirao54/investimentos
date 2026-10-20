'use strict';

// Cotação de reserva: quando o Yahoo recusa o servidor, o preço não some.
//
// O Yahoo limita pedidos vindos de IPs de nuvem (429), e a Vercel é nuvem.
// Com o Yahoo como fonte única, um dia ruim deixava TODA ação sem preço
// ("ainda não aparece valor pra Vivara e Klabin, e provavelmente de outras").
// Agora: query1 → query2 (limites separados) → Google Finance. E o servidor
// devolve o motivo por ticker, que o app mostra no selo de cotações.

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const market = require(path.resolve(__dirname, '..', 'api', 'market.js'));
const { parseGoogleFinance, resumirErrosCotacao } = market.cotacaoReserva;
const { fetchCotacoesMercado } = market.__test;

const PAGINA_GOOGLE =
  '<html><div class="zzDege">Vivara Participações S.A.</div>' +
  '<div jsname="ip75Cb" data-source="BVMF" data-last-price="36.13" data-last-normal-market-timestamp="1" data-currency-code="BRL" data-previous-close="35.80"></div>' +
  '<div data-last-price="999" data-currency-code="USD"></div></html>';

test('Google Finance: preço em BRL, fechamento anterior e nome', () => {
  const q = parseGoogleFinance(PAGINA_GOOGLE, 'VIVA3');
  assert.equal(q.price, 36.13);
  assert.equal(q.previousClose, 35.8);
  assert.ok(Math.abs(q.changePct - ((36.13 - 35.8) / 35.8) * 100) < 1e-9);
  assert.equal(q.shortName, 'Vivara Participações S.A.');
  assert.equal(q.fonteCotacao, 'google');
  assert.equal(parseGoogleFinance('<html>sem preço</html>', 'X'), null);
  assert.equal(
    parseGoogleFinance('<div data-last-price="10" data-currency-code="USD"></div>', 'X'),
    null,
    'preço em dólar não é o do ativo da B3'
  );
});

function comFetch(fn, corpo) {
  const antes = global.fetch;
  const pedidos = [];
  global.fetch = async (url, opcoes) => {
    pedidos.push(String(url));
    return fn(String(url), opcoes);
  };
  return corpo(pedidos).finally(() => {
    global.fetch = antes;
  });
}

const resp = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => body,
});

const chartYahoo = (preco) => ({
  chart: { result: [{ meta: { regularMarketPrice: preco, shortName: 'KLABIN S/A UNT N2' } }] },
});

test('Yahoo recusa no query1: tenta o query2 antes de desistir', async () => {
  const antes = process.env.BRAPI_TOKEN;
  delete process.env.BRAPI_TOKEN;
  try {
    await comFetch(
      (url) => (/query1\./.test(url) ? resp(429, {}) : resp(200, chartYahoo(21.37))),
      async (pedidos) => {
        const erros = [];
        const out = await fetchCotacoesMercado(['KLBN11'], erros, 5000);
        assert.equal(out.KLBN11.price, 21.37);
        assert.ok(pedidos.some((u) => /query2\.finance\.yahoo\.com/.test(u)));
        assert.ok(!pedidos.some((u) => /google/.test(u)), 'não precisou da reserva');
      }
    );
  } finally {
    if (antes !== undefined) process.env.BRAPI_TOKEN = antes;
  }
});

test('Yahoo fora nos dois endereços: o preço vem do Google, e o motivo fica registrado', async () => {
  const antes = process.env.BRAPI_TOKEN;
  delete process.env.BRAPI_TOKEN;
  try {
    await comFetch(
      (url) => (/google\.com\/finance/.test(url) ? resp(200, PAGINA_GOOGLE) : resp(429, {})),
      async (pedidos) => {
        const erros = [];
        const out = await fetchCotacoesMercado(['VIVA3'], erros, 5000);
        assert.equal(out.VIVA3.price, 36.13);
        assert.equal(out.VIVA3.fonteCotacao, 'google');
        assert.ok(pedidos.some((u) => /\/finance\/quote\/VIVA3:BVMF/.test(u)));
        const resumo = resumirErrosCotacao(erros);
        assert.deepEqual(resumo.VIVA3, ['yahoo_chart_429']);
      }
    );
  } finally {
    if (antes !== undefined) process.env.BRAPI_TOKEN = antes;
  }
});

test('nenhuma fonte respondeu: sem preço, com o motivo de cada uma', async () => {
  const antes = process.env.BRAPI_TOKEN;
  delete process.env.BRAPI_TOKEN;
  try {
    await comFetch(
      () => resp(503, ''),
      async () => {
        const erros = [];
        const out = await fetchCotacoesMercado(['XPTO3'], erros, 3000);
        assert.equal(out.XPTO3, undefined);
        assert.deepEqual(resumirErrosCotacao(erros).XPTO3, ['yahoo_chart_503', 'google_503']);
      }
    );
  } finally {
    if (antes !== undefined) process.env.BRAPI_TOKEN = antes;
  }
});

test('a lista fixa não tem preço de exemplo: sem cotação, vale o preço médio', () => {
  // Os preços de exemplo apareciam como se fossem de mercado quando a cotação
  // falhava ("ITUB4 e WEGE3 diferentes do fechamento do dia").
  const fs = require('node:fs');
  const fonte = fs.readFileSync(
    path.resolve(__dirname, '..', 'web', 'appliquei-yahoo-finance.js'),
    'utf8'
  );
  const lista = fonte.slice(fonte.indexOf('var mockAtivosMercado = ['), fonte.indexOf('];'));
  const comPreco = lista.match(
    /tipo: '(?:Ação|FII|ETF|BDR|Cripto)',\s*preco_atual: (?!0\b)[0-9.]+/g
  );
  assert.equal(comPreco, null, 'preço de exemplo na lista: ' + (comPreco || []).join(' | '));
  // E quem lê o preço cai no preço médio quando ele é 0.
  for (const arq of ['appliquei-aba1-charts.js', 'appliquei-app.js', 'appliquei-projecao.js']) {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'web', arq), 'utf8');
    assert.doesNotMatch(src, /\b(\w+) \? \1\.preco_atual :/, arq + ' usa o preço sem checar > 0');
  }
});

test('preço velho tem data: documento antigo sem fetchedAtMs usa updatedAt ou o dia', () => {
  const { asOfDoDocumento } = market.cotacaoReserva;
  assert.equal(asOfDoDocumento({ fetchedAtMs: 5 }), 5);
  assert.equal(asOfDoDocumento({ updatedAt: { toMillis: () => 7 } }), 7);
  assert.equal(asOfDoDocumento({ updatedAt: { _seconds: 2 } }), 2000);
  assert.equal(asOfDoDocumento({ dateYmd: '2026-10-03' }), Date.parse('2026-10-03T18:00:00-03:00'));
  assert.equal(asOfDoDocumento({}), null);
});

test('formulário: preço atrasado vira aviso com data; cotação nova diz a fonte', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {} },
    Date,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    setTimeout,
    clearTimeout,
    historicoCompras: [],
    mpEstado: { cotacoes: {} },
    formatarMoeda: (v) => 'R$ ' + v,
    document: { getElementById: () => null, querySelectorAll: () => [] },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, '..', 'web', 'appliquei-yahoo-finance.js'), 'utf8'),
    ctx
  );
  const dia3 = new Date(2026, 9, 3, 17, 5).getTime();
  ctx.aplicarCotacao('WEGE3', { price: 51.27, stale: true, asOfMs: dia3 });
  ctx.cotacoesEstado.motivos.WEGE3 = ['yahoo_chart_429', 'google_sem_preco'];
  const velho = ctx.textoCotacaoDoAtivo('wege3');
  assert.equal(velho.alerta, true);
  assert.match(velho.texto, /último preço conhecido, de 03\/10 às 17:05/);
  assert.match(velho.texto, /limitou os pedidos/);
  assert.match(velho.texto, /Confira o preço antes de salvar/);

  ctx.aplicarCotacao('WEGE3', { price: 47.67, asOfMs: dia3, fonteCotacao: 'google' });
  const novo = ctx.textoCotacaoDoAtivo('WEGE3');
  assert.equal(novo.alerta, false);
  assert.match(novo.texto, /Cotação de 03\/10 às 17:05 · Google Finance/);
});

test('BRAPI no plano grátis: lote recusado vira um pedido por ativo', async () => {
  const antes = process.env.BRAPI_TOKEN;
  process.env.BRAPI_TOKEN = 'gratis';
  try {
    await comFetch(
      (url) => {
        const sim = decodeURIComponent(url.split('/quote/')[1] || '');
        if (sim.includes(',')) return { ok: false, status: 400, text: async () => 'plano' };
        return resp(200, {
          results: [{ symbol: sim, regularMarketPrice: sim === 'WEGE3' ? 47.67 : 10 }],
        });
      },
      async (pedidos) => {
        const out = await market.brapi.fetchBrapi(['WEGE3', 'ITUB4']);
        assert.equal(out.WEGE3.price, 47.67);
        assert.equal(out.ITUB4.price, 10);
        assert.equal(pedidos.length, 3, 'o lote e depois um por ativo');
      }
    );
  } finally {
    if (antes === undefined) delete process.env.BRAPI_TOKEN;
    else process.env.BRAPI_TOKEN = antes;
  }
});

// ------------------------------------------------ Yahoo em lote e o job

test('Yahoo v7 em lote: cookie + crumb, um pedido para vários ativos', async () => {
  const { fetchYahooCotacoesLote, mapYahooQuoteV7 } = market.yahooLote;
  assert.equal(mapYahooQuoteV7({ symbol: 'X.SA', regularMarketPrice: 0 }), null);
  const pedidos = [];
  const f = async (url, opcoes) => {
    pedidos.push({ url: String(url), opcoes });
    if (/fc\.yahoo\.com/.test(url))
      return { ok: false, status: 404, headers: { get: () => 'A3=abc; Path=/' } };
    if (/getcrumb/.test(url)) return { ok: true, status: 200, text: async () => 'Crumb123' };
    return resp(200, {
      quoteResponse: {
        result: [
          {
            symbol: 'WEGE3.SA',
            regularMarketPrice: 47.67,
            regularMarketPreviousClose: 47.67,
            shortName: 'WEG ON',
          },
          { symbol: 'ITUB4.SA', regularMarketPrice: 39.84, shortName: 'ITAU UNIBANCO PN' },
        ],
      },
    });
  };
  const erros = [];
  const out = await fetchYahooCotacoesLote(['WEGE3', 'ITUB4', 'XPTO3'], erros, f);
  assert.equal(out.WEGE3.price, 47.67);
  assert.equal(out.ITUB4.shortName, 'ITAU UNIBANCO PN');
  assert.equal(out.XPTO3, undefined);
  const lote = pedidos.find((p) => /v7\/finance\/quote/.test(p.url));
  assert.match(lote.url, /symbols=WEGE3\.SA%2CITUB4\.SA%2CXPTO3\.SA/);
  assert.match(lote.url, /crumb=Crumb123/);
  assert.equal(lote.opcoes.headers.Cookie, 'A3=abc');
  assert.equal(pedidos.filter((p) => /v7\/finance\/quote/.test(p.url)).length, 1);
});

test('cotação gravada pelo job há pouco não é "atrasada"; a de ontem no pregão é', () => {
  const { cotacaoAceitavel } = market.yahooLote;
  const pregao = Date.parse('2026-10-20T14:00:00-03:00');
  assert.equal(cotacaoAceitavel({ price: 1, fetchedAtMs: pregao - 40 * 60000 }, pregao), true);
  assert.equal(cotacaoAceitavel({ price: 1, fetchedAtMs: pregao - 80 * 60000 }, pregao), false);
  const noite = Date.parse('2026-10-20T22:00:00-03:00');
  const fechamento = Date.parse('2026-10-20T18:20:00-03:00');
  assert.equal(cotacaoAceitavel({ price: 1, fetchedAtMs: fechamento }, noite), true);
  assert.equal(
    cotacaoAceitavel({ price: 1, fetchedAtMs: Date.parse('2026-10-19T18:20:00-03:00') }, noite),
    false
  );
  assert.equal(cotacaoAceitavel({ price: 1 }, noite), false, 'sem data não é aceitável');
});

test('job de cotações: lista vem dos pedidos e dos cotados, e o resumo conta as fontes', async () => {
  const { tickersDoJob, resumo } = require(
    path.resolve(__dirname, '..', 'scripts', 'cotacoes-job.js')
  );
  const docs = (ids) => ({ forEach: (fn) => ids.forEach((id) => fn({ id })) });
  const database = {
    collection: () => ({
      where: (campo) => ({
        get: async () =>
          campo === 'ultimoPedidoMs'
            ? docs(['WEGE3', 'VIVA3'])
            : campo === 'dateYmd'
              ? docs(['KLBN11'])
              : docs(['WEGE3', 'ITUB4']),
      }),
    }),
  };
  // Documento antigo (só dateYmd) também entra: a 1ª rodada achou 0 tickers.
  assert.deepEqual(await tickersDoJob(database, Date.now()), ['ITUB4', 'KLBN11', 'VIVA3', 'WEGE3']);
  const r = resumo(
    { WEGE3: { price: 1, fonteCotacao: 'yahoo' }, ITUB4: { price: 2, fonteCotacao: 'google' } },
    ['WEGE3', 'ITUB4', 'VIVA3'],
    [{ fonte: 'yahoo_quote', erro: 'yahoo_quote_429' }]
  );
  assert.equal(r.cotados, 2);
  assert.deepEqual(r.porFonte, { yahoo: 1, google: 1 });
  assert.deepEqual(r.sem, ['VIVA3']);
  assert.deepEqual(r.motivos, { 'yahoo_quote: yahoo_quote_429': 1 });
});

// ------------------------------------------- planilha Google (GOOGLEFINANCE)

function comPlanilha(id, corpo) {
  const antes = process.env.COTACAO_PLANILHA_ID;
  if (id) process.env.COTACAO_PLANILHA_ID = id;
  else delete process.env.COTACAO_PLANILHA_ID;
  market.planilha.definirTokenSheets(async () => 'tok-sheets');
  return Promise.resolve(corpo()).finally(() => {
    market.planilha.definirTokenSheets(null);
    if (antes === undefined) delete process.env.COTACAO_PLANILHA_ID;
    else process.env.COTACAO_PLANILHA_ID = antes;
  });
}

test('planilha: linhas viram cotações; célula vazia ou "Loading" fica de fora', () => {
  const { mapPlanilhaLinhas } = market.planilha;
  const out = mapPlanilhaLinhas([
    ['WEGE3', 47.67, 47.67, 0, 'WEG SA'],
    ['XPTO3', '', '', '', ''],
    ['VIVA3', 'Loading...'],
  ]);
  assert.deepEqual(Object.keys(out), ['WEGE3']);
  assert.equal(out.WEGE3.price, 47.67);
  assert.equal(out.WEGE3.change, 0);
  assert.equal(out.WEGE3.shortName, 'WEG SA');
  assert.equal(out.WEGE3.fonteCotacao, 'planilha');
});

test('planilha: fechamento anterior absurdo (PATL11 a R$ 0,01) não vira variação de +641.400%', () => {
  const out = market.planilha.mapPlanilhaLinhas([
    ['PATL11', 64.15, 0.01, 641400, 'Patria Log FII'],
  ]);
  assert.equal(out.PATL11.price, 64.15);
  assert.equal(out.PATL11.previousClose, null);
  assert.equal(out.PATL11.changePct, null);
});

test('planilha: o id padrão é a planilha configurada (COTACAO_PLANILHA_ID troca)', () => {
  const antes = process.env.COTACAO_PLANILHA_ID;
  delete process.env.COTACAO_PLANILHA_ID;
  try {
    assert.equal(market.planilha.planilhaId(), '1-CJ010GTW2MJe9vWTMHIsw6bZ7QJTgDnzD8W4ZQzKVQ');
    process.env.COTACAO_PLANILHA_ID = 'outra';
    assert.equal(market.planilha.planilhaId(), 'outra');
  } finally {
    if (antes === undefined) delete process.env.COTACAO_PLANILHA_ID;
    else process.env.COTACAO_PLANILHA_ID = antes;
  }
});

test('planilha: as fórmulas servem em qualquer linha (INDIRECT de ROW) e usam a BVMF', () => {
  for (const f of market.planilha.PLANILHA_FORMULAS) {
    assert.match(f, /GOOGLEFINANCE\("BVMF:"&INDIRECT\("A"&ROW\(\)\),"/);
    assert.match(f, /^=IFERROR\(/);
  }
});

test('planilha: lê num pedido só, com o token da conta de serviço, e acrescenta o que falta', async () => {
  await comPlanilha('PLAN123', async () => {
    const pedidos = [];
    const f = async (url, opcoes) => {
      pedidos.push({ url: String(url), opcoes });
      if (opcoes.method === 'POST') return resp(200, {});
      return resp(200, { values: [['WEGE3', 47.67, 47.67, 0, 'WEG SA']] });
    };
    const erros = [];
    const out = await market.planilha.fetchPlanilhaCotacoes(['WEGE3', 'VIVA3'], erros, f);
    assert.equal(out.WEGE3.price, 47.67);
    assert.equal(out.VIVA3, undefined);
    const leitura = pedidos[0];
    assert.match(
      leitura.url,
      /spreadsheets\/PLAN123\/values\/cotacoes!A2:E2000\?valueRenderOption=UNFORMATTED_VALUE/
    );
    assert.equal(leitura.opcoes.headers.Authorization, 'Bearer tok-sheets');
    const append = pedidos.find((p) => p.opcoes.method === 'POST');
    assert.match(append.url, /:append\?valueInputOption=USER_ENTERED/);
    const linhas = JSON.parse(append.opcoes.body).values;
    assert.deepEqual(
      linhas.map((l) => l[0]),
      ['VIVA3'],
      'só o código que não estava'
    );
    assert.equal(linhas[0].length, 5);
    assert.deepEqual(erros, [{ fonte: 'planilha', ticker: 'VIVA3', erro: 'planilha_novo' }]);
  });
});

test('planilha: sem permissão (403) vira motivo e o resto da cadeia segue', async () => {
  const antesBrapi = process.env.BRAPI_TOKEN;
  delete process.env.BRAPI_TOKEN;
  try {
    await comPlanilha('PLAN123', async () => {
      await comFetch(
        (url) =>
          /sheets\.googleapis/.test(url)
            ? resp(403, {})
            : /query2.*v7|fc\.yahoo|getcrumb/.test(url)
              ? resp(429, {})
              : resp(200, chartYahoo(47.67)),
        async () => {
          const erros = [];
          const out = await fetchCotacoesMercado(['WEGE3'], erros, 5000);
          assert.equal(out.WEGE3.price, 47.67, 'o Yahoo um a um ainda responde');
          assert.ok(erros.some((e) => e.fonte === 'planilha' && e.erro === 'planilha_403'));
        }
      );
    });
  } finally {
    if (antesBrapi !== undefined) process.env.BRAPI_TOKEN = antesBrapi;
  }
});

test('com a planilha, o Yahoo nem é chamado quando ela traz tudo; sem id, nada muda', async () => {
  const antesBrapi = process.env.BRAPI_TOKEN;
  delete process.env.BRAPI_TOKEN;
  try {
    await comPlanilha('PLAN123', async () => {
      await comFetch(
        (url) =>
          /sheets\.googleapis/.test(url)
            ? resp(200, {
                values: [
                  ['WEGE3', 47.67],
                  ['VIVA3', 25.1],
                ],
              })
            : resp(429, {}),
        async (pedidos) => {
          const out = await fetchCotacoesMercado(['WEGE3', 'VIVA3'], [], 5000);
          assert.equal(out.VIVA3.fonteCotacao, 'planilha');
          assert.ok(!pedidos.some((u) => /yahoo/.test(u)));
        }
      );
    });
    if (!market.planilha.planilhaId()) {
      await comFetch(
        () => resp(429, {}),
        async (pedidos) => {
          await fetchCotacoesMercado(['WEGE3'], [], 2000);
          assert.ok(!pedidos.some((u) => /sheets\.googleapis/.test(u)));
        }
      );
    }
  } finally {
    if (antesBrapi !== undefined) process.env.BRAPI_TOKEN = antesBrapi;
  }
});
