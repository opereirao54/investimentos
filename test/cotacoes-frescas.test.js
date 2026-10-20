'use strict';

// Cotações: quanto tempo um preço vale e de onde ele vem.
//
// O defeito que motivou este arquivo: o cache do servidor valia o DIA inteiro
// (dateYmd === hoje). O primeiro pedido do dia — às vezes antes do pregão —
// congelava o preço de todo mundo até a meia-noite, e a queixa era "o valor
// das ações nem sempre está atualizado".
//
// A estrutura da fonte também fica presa aqui: Yahoo por padrão (grátis), a
// BRAPI entra sozinha quando BRAPI_TOKEN existir, e cripto vai à CoinGecko.

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const market = require(path.resolve(__dirname, '..', 'api', 'market.js'));
const { cotacaoFresca, pregaoAberto, ultimoFechamentoMs, fetchCotacoesMercado, sanitizeTicker } =
  market.__test;

// Horário de Brasília (UTC-3) → ms.
const brt = (iso) => Date.parse(iso + '-03:00');
const MIN = 60 * 1000;

test('pregão aberto: dia útil entre 10:00 e 18:10 de Brasília', () => {
  assert.equal(pregaoAberto(brt('2026-10-20T09:59:00')), false, 'antes da abertura');
  assert.equal(pregaoAberto(brt('2026-10-20T10:00:00')), true);
  assert.equal(pregaoAberto(brt('2026-10-20T18:09:00')), true);
  assert.equal(pregaoAberto(brt('2026-10-20T18:10:00')), false, 'depois do fechamento');
  assert.equal(pregaoAberto(brt('2026-10-24T12:00:00')), false, 'sábado');
});

test('último fechamento: sexta 18:10 para quem olha no sábado ou na segunda cedo', () => {
  const sexta = brt('2026-10-23T18:10:00');
  assert.equal(ultimoFechamentoMs(brt('2026-10-24T11:00:00')), sexta);
  assert.equal(ultimoFechamentoMs(brt('2026-10-26T08:00:00')), sexta);
  assert.equal(ultimoFechamentoMs(brt('2026-10-26T19:00:00')), brt('2026-10-26T18:10:00'));
});

test('durante o pregão a cotação vale 15 minutos, não o dia inteiro', () => {
  const agora = brt('2026-10-20T14:00:00');
  assert.equal(cotacaoFresca({ price: 10, fetchedAtMs: agora - 5 * MIN }, agora), true);
  assert.equal(cotacaoFresca({ price: 10, fetchedAtMs: agora - 16 * MIN }, agora), false);
  // O caso que gerou a queixa: buscada antes da abertura, hoje mesmo.
  assert.equal(
    cotacaoFresca({ price: 10, fetchedAtMs: brt('2026-10-20T08:30:00') }, agora),
    false,
    'preço de antes do pregão não pode valer durante o pregão'
  );
});

test('fora do pregão vale o que foi buscado depois do último fechamento', () => {
  const sabado = brt('2026-10-24T15:00:00');
  assert.equal(
    cotacaoFresca({ price: 10, fetchedAtMs: brt('2026-10-23T19:00:00') }, sabado),
    true,
    'fechamento de sexta vale o fim de semana'
  );
  assert.equal(
    cotacaoFresca({ price: 10, fetchedAtMs: brt('2026-10-23T15:00:00') }, sabado),
    false,
    'preço do meio do pregão de sexta não é o fechamento'
  );
});

test('cripto negocia 24h: 15 minutos até no fim de semana', () => {
  const sabado = brt('2026-10-24T15:00:00');
  assert.equal(cotacaoFresca({ price: 1, fetchedAtMs: sabado - 20 * MIN }, sabado, true), false);
  assert.equal(cotacaoFresca({ price: 1, fetchedAtMs: sabado - 5 * MIN }, sabado, true), true);
});

test('documento antigo, sem fetchedAtMs, nunca conta como fresco', () => {
  assert.equal(cotacaoFresca({ price: 10, dateYmd: '2026-10-20' }, Date.now()), false);
});

test('códigos de cripto com 3 letras passam; o resto continua exigindo 4', () => {
  assert.equal(sanitizeTicker('btc'), 'BTC');
  assert.equal(sanitizeTicker('ETH'), 'ETH');
  assert.equal(sanitizeTicker('ABC'), null);
  assert.equal(sanitizeTicker('petr4.sa'), 'PETR4', 'o sufixo do Yahoo sai');
  assert.equal(sanitizeTicker('PETR4F'), 'PETR4F');
});

function dublarFetch(responder) {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return responder(String(url));
  };
  return { urls, restaurar: () => (globalThis.fetch = original) };
}

const chart = (preco) => ({
  ok: true,
  status: 200,
  json: async () => ({
    chart: { result: [{ meta: { regularMarketPrice: preco, chartPreviousClose: preco } }] },
  }),
});

test('cripto vai à CoinGecko, nunca ao Yahoo com ".SA"', async () => {
  const { urls, restaurar } = dublarFetch(async (url) => {
    if (url.includes('coingecko')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ bitcoin: { brl: 600000, brl_24h_change: 2, last_updated_at: 1 } }),
      };
    }
    return chart(30);
  });
  try {
    const r = await fetchCotacoesMercado(['BTC', 'BBAS3'], []);
    assert.equal(r.BTC.price, 600000);
    assert.equal(r.BTC.fonteCotacao, 'coingecko');
    assert.equal(r.BBAS3.price, 30);
    assert.ok(!urls.some((u) => u.includes('BTC.SA')), 'BTC.SA não existe no Yahoo');
  } finally {
    restaurar();
  }
});

test('fracionário usa o preço do lote padrão e volta com o código da pessoa', async () => {
  const { urls, restaurar } = dublarFetch(async () => chart(37.2));
  try {
    const r = await fetchCotacoesMercado(['PETR4F'], []);
    assert.equal(r.PETR4F.price, 37.2);
    assert.equal(r.PETR4F.ticker, 'PETR4F');
    assert.ok(urls[0].includes('PETR4.SA'));
  } finally {
    restaurar();
  }
});

test('o Yahoo é chamado com User-Agent (sem ele, mais 429)', async () => {
  const original = globalThis.fetch;
  let cabecalhos = null;
  globalThis.fetch = async (url, op) => {
    cabecalhos = op && op.headers;
    return chart(10);
  };
  try {
    await fetchCotacoesMercado(['VALE3'], []);
    assert.ok(cabecalhos && cabecalhos['User-Agent'], 'faltou User-Agent');
  } finally {
    globalThis.fetch = original;
  }
});

test('com BRAPI_TOKEN, o que a BRAPI não devolver é buscado no Yahoo', async () => {
  const antes = process.env.BRAPI_TOKEN;
  process.env.BRAPI_TOKEN = 'token-de-teste';
  const { urls, restaurar } = dublarFetch(async (url) => {
    if (url.includes('brapi.dev')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [{ symbol: 'BBAS3', regularMarketPrice: 28 }] }),
      };
    }
    return chart(55);
  });
  try {
    const r = await fetchCotacoesMercado(['BBAS3', 'KLBN11'], []);
    assert.equal(r.BBAS3.price, 28);
    assert.equal(r.KLBN11.price, 55, 'o que faltou veio do Yahoo');
    assert.ok(urls.some((u) => u.includes('KLBN11.SA')));
    assert.ok(!urls.some((u) => u.includes('BBAS3.SA')), 'não busca de novo o que a BRAPI trouxe');
  } finally {
    restaurar();
    if (antes === undefined) delete process.env.BRAPI_TOKEN;
    else process.env.BRAPI_TOKEN = antes;
  }
});
