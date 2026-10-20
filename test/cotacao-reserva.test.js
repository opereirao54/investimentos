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
