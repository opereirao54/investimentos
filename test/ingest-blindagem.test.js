'use strict';

// Blindagem da execução automática da ingestão.
//
// As duas regras aqui saíram de uma execução real: 27/08 15:22, a CVM caiu
// por minutos, o job gravou 32 documentos só com preço e o check ficou VERDE.
// Uma execução degradada era indistinguível de uma boa no painel do GitHub, e
// o dado teria parado de envelhecer em silêncio.

const test = require('node:test');
const assert = require('node:assert/strict');

// Zera a espera do retry ANTES de carregar o módulo: o comportamento sob
// teste é "quantas vezes tenta", não "quanto tempo dorme", e 8 s de espera
// real por caso entrariam em cada execução do CI.
process.env.INGEST_RETRY_ESPERA_MS = '0,0,0';
const ingest = require('../scripts/ingest-cvm.js');

test('404 não se repete: é resposta, não falha de rede', () => {
  // Este job SONDA nomes de arquivo de propósito (ver listarDiretorio), então
  // 404 é rotina. Repetir triplicaria o tempo de cada sondagem que já
  // respondeu.
  assert.equal(ingest.erroTransitorio(new Error('http_404')), false);
  assert.equal(ingest.erroTransitorio(new Error('http_400')), false);
  assert.equal(ingest.erroTransitorio(new Error('http_403')), false);
});

test('5xx e falha de rede se repetem: não são resposta nenhuma', () => {
  assert.equal(ingest.erroTransitorio(new Error('http_500')), true);
  assert.equal(ingest.erroTransitorio(new Error('http_503')), true);
  assert.equal(ingest.erroTransitorio(new TypeError('fetch failed')), true);
  assert.equal(ingest.erroTransitorio(new Error('The operation was aborted')), true);
});

test('a rede que falha e volta não custa a execução', async () => {
  // A janela de 27/08 durou minutos. Duas falhas seguidas seguidas de sucesso
  // é exatamente o caso que o retry existe para cobrir.
  const original = global.fetch;
  let chamadas = 0;
  global.fetch = async () => {
    chamadas++;
    if (chamadas < 3) throw new TypeError('fetch failed');
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  try {
    const buf = await ingest.baixar('https://exemplo/arquivo.zip');
    assert.equal(buf.length, 4, 'devolveu o conteúdo da tentativa bem-sucedida');
    assert.equal(chamadas, 3, 'tentou três vezes');
  } finally {
    global.fetch = original;
  }
});

test('rede fora do ar o tempo todo ainda falha — o retry não esconde', async () => {
  const original = global.fetch;
  let chamadas = 0;
  global.fetch = async () => {
    chamadas++;
    throw new TypeError('fetch failed');
  };
  try {
    await assert.rejects(() => ingest.baixar('https://exemplo/x.zip'), /fetch failed/);
    assert.equal(chamadas, 3, 'tentou três vezes e desistiu');
  } finally {
    global.fetch = original;
  }
});

test('404 desiste na primeira: não gasta as três tentativas', async () => {
  const original = global.fetch;
  let chamadas = 0;
  global.fetch = async () => {
    chamadas++;
    return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  try {
    await assert.rejects(() => ingest.baixar('https://exemplo/nao-existe.zip'), /http_404/);
    assert.equal(chamadas, 1, 'uma tentativa só — o servidor já respondeu');
  } finally {
    global.fetch = original;
  }
});

test('execução só com preço NÃO conta como colheita', () => {
  // O caso real: cotação chegou, fundamento nenhum. É esta conta que faz o
  // job sair vermelho em vez de verde.
  const soPreco = [
    { ticker: 'BBAS3', dados: null, mercado: { preco: 30 } },
    { ticker: 'ITUB4', dados: null, mercado: { preco: 40 } },
  ];
  assert.equal(ingest.contarComFundamento(soPreco), 0, 'preço não é fundamento');
});

test('fundamento da CVM ou do Yahoo conta', () => {
  const mistura = [
    { ticker: 'BBAS3', dados: { roe: 10 } },
    { ticker: 'ITUB4', yahoo: { roe: 12 } },
    { ticker: 'VALE3', dados: null, mercado: { preco: 60 } },
    { ticker: 'PETR4', dados: null, yahoo: null, mercado: { preco: 38 } },
  ];
  assert.equal(ingest.contarComFundamento(mistura), 2);
});

test('lista vazia ou inválida não quebra a conta', () => {
  assert.equal(ingest.contarComFundamento([]), 0);
  assert.equal(ingest.contarComFundamento(null), 0);
  assert.equal(ingest.contarComFundamento([null, undefined]), 0);
});
