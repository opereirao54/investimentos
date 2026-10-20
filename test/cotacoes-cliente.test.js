'use strict';

// Cotações no app (web/appliquei-yahoo-finance.js).
//
// O que ficou para trás e este arquivo segura:
//  - só os ~45 ativos da lista fixa recebiam preço; o resto ficava no preço
//    médio para sempre ("faltam ativos", "preço desatualizado");
//  - cripto nunca tinha preço (o app pedia "BTC.SA");
//  - o selo de horário apontava para um elemento que não existia.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const FONTE = fs.readFileSync(
  path.join(__dirname, '..', 'web', 'appliquei-yahoo-finance.js'),
  'utf8'
);

function storage(inicial) {
  const m = new Map(Object.entries(inicial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}

function carregar({ ops, respostas, ls }) {
  const status = { innerHTML: '', title: '', style: {}, classList: { toggle() {} } };
  const pedidos = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: storage(ls),
    setTimeout,
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
    historicoCompras: ops,
    mpEstado: { cotacoes: {} },
    formatarMoeda: (v) => 'R$ ' + v,
    CustomEvent: function () {},
    document: {
      getElementById: () => ({ innerHTML: '', appendChild() {}, style: {} }),
      querySelectorAll: (sel) => (sel === '.cotacoes-status' ? [status] : []),
      querySelector: () => null,
      createElement: () => ({}),
      addEventListener() {},
      visibilityState: 'visible',
    },
    fetch: async (url) => {
      pedidos.push(url);
      const r = respostas(url);
      return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body };
    },
  };
  ctx.window = ctx;
  ctx.window.AppliqueiFirebase = {
    auth: { currentUser: { getIdToken: async () => 'tok' } },
  };
  ctx.dispatchEvent = () => true;
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx);
  return { ctx, status, pedidos };
}

const OPS = [
  { ticker: 'PETR4', categoria: 'renda_variavel' },
  { ticker: 'itsa4.sa', categoria: 'renda_variavel' }, // fora da lista, digitado à moda Yahoo
  { ticker: 'BTC', categoria: 'renda_variavel' },
  { ticker: 'TESOURO_SELIC_2029', categoria: 'renda_fixa' },
  { ticker: 'CDB Banco X', categoria: 'renda_fixa' },
];

test('cota todos os ativos de renda variável, inclusive fora da lista e cripto', () => {
  const { ctx } = carregar({ ops: OPS, respostas: () => ({ body: {} }) });
  const t = ctx.tickersParaCotar();
  assert.deepEqual(Array.from(t).sort(), ['BTC', 'ITSA4', 'PETR4']);
});

test('preço novo chega às telas: lista de ativos, Meu patrimônio e aparelho', async () => {
  const { ctx, status, pedidos } = carregar({
    ops: OPS,
    respostas: () => ({
      body: {
        quotes: {
          PETR4: { price: 37.1, asOfMs: 1 },
          ITSA4: { price: 10.9, shortName: 'ITAUSA PN', asOfMs: 1 },
          BTC: { price: 600000, asOfMs: 1 },
        },
      },
    }),
  });
  await ctx.atualizarCotacoes(true, { semRender: true });
  assert.equal(pedidos.length, 1, 'um pedido para o lote');
  const itsa = ctx.mockAtivosMercado.find((a) => a.ticker === 'ITSA4');
  assert.ok(itsa, 'ativo fora da lista entra com o nome da fonte');
  assert.equal(itsa.preco_atual, 10.9);
  assert.equal(itsa.nome, 'ITAUSA PN');
  assert.equal(ctx.mockAtivosMercado.find((a) => a.ticker === 'BTC').preco_atual, 600000);
  assert.equal(ctx.mpEstado.cotacoes.PETR4.price, 37.1);
  assert.ok(ctx.localStorage.getItem('apq-cotacoes-v1'), 'último preço fica no aparelho');
  assert.match(status.innerHTML, /Cotações de \d\d:\d\d/);
});

test('cotação atrasada ou ausente aparece no selo, não some calada', async () => {
  const { ctx, status } = carregar({
    ops: OPS,
    respostas: () => ({
      body: {
        quotes: {
          PETR4: { price: 37.1, stale: true, asOfMs: 1 },
          ITSA4: { price: null, error: 'unavailable' },
          BTC: { price: 600000 },
        },
      },
    }),
  });
  await ctx.atualizarCotacoes(true, { semRender: true });
  assert.match(status.innerHTML, /2 atrasadas/);
  assert.match(status.title, /PETR4/);
  assert.match(status.title, /ITSA4/);
});

test('falha de rede mantém o último preço e avisa', async () => {
  const { ctx, status } = carregar({
    ops: OPS,
    respostas: () => ({ ok: false, status: 500, body: { error: 'x' } }),
  });
  await ctx.atualizarCotacoes(true, { semRender: true });
  assert.equal(ctx.cotacoesEstado.falhou, true);
  assert.match(status.innerHTML, /indisponíveis|Sem conexão/);
});

test('o app abre com o último preço salvo, não com o preço de semente', () => {
  const salvo = JSON.stringify({
    porTicker: { PETR4: { price: 41.5, asOfMs: 5 }, KLBN11: { price: 22, nome: 'KLABIN UNIT' } },
    atualizadoEm: 5,
  });
  const { ctx } = carregar({
    ops: OPS,
    respostas: () => ({ body: {} }),
    ls: { 'apq-cotacoes-v1': salvo },
  });
  ctx.restaurarCotacoesSalvas();
  assert.equal(ctx.mockAtivosMercado.find((a) => a.ticker === 'PETR4').preco_atual, 41.5);
  assert.equal(ctx.mockAtivosMercado.find((a) => a.ticker === 'KLBN11').preco_atual, 22);
});

test('a chave do aparelho não sobe para a nuvem (fora do prefixo appliquei_)', () => {
  const { ctx } = carregar({ ops: [], respostas: () => ({ body: {} }) });
  assert.ok(!/^appliquei_|^futurorico_/.test(ctx.COTACOES_CACHE_KEY));
});

test('o navegador não busca mais cotação por proxy CORS', () => {
  const corpo = FONTE.slice(FONTE.indexOf('function atualizarCotacoes'));
  assert.doesNotMatch(corpo.slice(0, 4000), /fetchComFallback|corsproxy|allorigins/);
});
