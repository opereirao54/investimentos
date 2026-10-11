'use strict';

// Limite de tentativas de pagamento (api/_lib/limite-pagamento.js), contra o
// "teste de cartão roubado" na conta Asaas. Trava: cartão conta por conta E
// por IP; PIX/boleto só por conta; barrado volta 429 com a frase para a
// tela; e as duas rotas que mandam cartão ao Asaas conferem o limite ANTES
// de qualquer chamada ao gateway.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const RL_PATH = require.resolve('../api/_lib/rate-limit');
const contagem = new Map();
const chamadas = [];
const m = new Module(RL_PATH);
m.exports = {
  ipFrom: (req) => req.ip,
  check: async ({ scope, key, max }) => {
    chamadas.push(scope);
    const k = scope + ':' + key;
    const n = (contagem.get(k) || 0) + 1;
    contagem.set(k, n);
    return { allowed: n <= max, count: n, retryAfterMs: n <= max ? 0 : 1234 };
  },
};
m.loaded = true;
m.filename = RL_PATH;
Module._cache[RL_PATH] = m;

const { conferirLimitePagamento, LIMITES } = require('../api/_lib/limite-pagamento');

function limpar() {
  contagem.clear();
  chamadas.length = 0;
}

test('cartão: a 6ª tentativa da mesma conta na hora é barrada com 429', async () => {
  limpar();
  for (let i = 0; i < LIMITES.cartaoUid.max; i++) {
    assert.equal(await conferirLimitePagamento({ ip: '1.1.1.1' }, 'ana', true), null);
  }
  const r = await conferirLimitePagamento({ ip: '1.1.1.1' }, 'ana', true);
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'rate_limited');
  assert.match(r.body.detail, /Muitas tentativas/);
  assert.equal(r.body.retryAfterMs, 1234);
});

test('cartão: contas novas no mesmo IP também esbarram no limite por IP', async () => {
  limpar();
  let barrado = null;
  for (let i = 0; i < LIMITES.cartaoIp.max + 1; i++) {
    barrado = await conferirLimitePagamento({ ip: '2.2.2.2' }, 'conta' + i, true);
  }
  assert.equal(barrado && barrado.status, 429);
});

test('PIX/boleto: só o limite por conta, mais folgado, e sem olhar o IP', async () => {
  limpar();
  for (let i = 0; i < LIMITES.cobrancaUid.max; i++) {
    assert.equal(await conferirLimitePagamento({ ip: '3.3.3.3' }, 'bia', false), null);
  }
  assert.equal((await conferirLimitePagamento({ ip: '3.3.3.3' }, 'bia', false)).status, 429);
  assert.ok(chamadas.every((s) => s === 'pag-cobranca-uid'));
  assert.ok(LIMITES.cobrancaUid.max > LIMITES.cartaoUid.max);
});

test('as rotas de assinatura e de cartão conferem o limite antes do Asaas', () => {
  const ROOT = path.resolve(__dirname, '..');
  for (const [arq, chamadaAsaas] of [
    ['api/billing/subscribe.js', 'asaas.'],
    ['api/billing/card.js', 'asaas.updateSubscriptionCard'],
  ]) {
    const src = fs.readFileSync(path.join(ROOT, arq), 'utf8');
    const corpo = src.slice(src.indexOf('handle:'));
    const iLimite = corpo.indexOf('conferirLimitePagamento(');
    const iAsaas = corpo.indexOf(chamadaAsaas);
    assert.ok(
      iLimite > -1 && iLimite < iAsaas,
      arq + ': limite antes da primeira chamada ao Asaas'
    );
  }
  // A tela mostra a frase do servidor em vez do código do erro.
  const cli = fs.readFileSync(path.join(ROOT, 'web/appliquei-billing.js'), 'utf8');
  assert.match(cli, /data\.error === 'rate_limited'/);
});
