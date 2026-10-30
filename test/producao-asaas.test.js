'use strict';

/**
 * Entrada em produção: Asaas de verdade e Applicash fora do ar.
 *
 * 1. A chave do Asaas diz o ambiente no prefixo ($aact_prod_ / $aact_hmlg_).
 *    Chave de um com URL do outro só rende 401 — aqui vira erro com nome.
 * 2. A virada sandbox → produção deixa no Firestore customerIds que não
 *    existem no Asaas de produção. O /subscribe troca o cliente e esquece a
 *    assinatura do sandbox sem tirar dia nenhum de quem já tinha.
 * 3. Com APPLICASH_ENABLED desligado, o /init ignora cupom.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const S = require('./_simulador-pagamentos.js');
const M = require('../scripts/lib/mock-billing');

// ── 1. Ambiente pela chave ────────────────────────────────────────────────
function asaasReal(env) {
  const salvo = {};
  for (const k of ['ASAAS_API_KEY', 'ASAAS_API_URL']) salvo[k] = process.env[k];
  for (const k of Object.keys(env)) {
    if (env[k] == null) delete process.env[k];
    else process.env[k] = env[k];
  }
  // O mock troca api/_lib/asaas no require.cache; aqui o real é lido do disco.
  const arquivo = path.join(__dirname, '..', 'api', '_lib', 'asaas.js');
  const Module = require('module');
  const m = new Module(arquivo, module);
  m.filename = arquivo;
  m.paths = Module._nodeModulePaths(path.dirname(arquivo));
  m._compile(require('fs').readFileSync(arquivo, 'utf8'), arquivo);
  return {
    A: m.exports,
    restaurar() {
      for (const k of Object.keys(salvo)) {
        if (salvo[k] == null) delete process.env[k];
        else process.env[k] = salvo[k];
      }
    },
  };
}

test('ambiente: sem ASAAS_API_URL, a chave de sandbox vai para o sandbox', () => {
  const { A, restaurar } = asaasReal({ ASAAS_API_KEY: '$aact_hmlg_abc', ASAAS_API_URL: null });
  try {
    assert.equal(A.ambiente(), 'sandbox');
  } finally {
    restaurar();
  }
});

test('ambiente: sem ASAAS_API_URL, a chave de produção vai para produção', () => {
  const { A, restaurar } = asaasReal({ ASAAS_API_KEY: '$aact_prod_abc', ASAAS_API_URL: null });
  try {
    assert.equal(A.ambiente(), 'producao');
  } finally {
    restaurar();
  }
});

test('ambiente: chave de produção com URL do sandbox falha com o motivo', async () => {
  const { A, restaurar } = asaasReal({
    ASAAS_API_KEY: '$aact_prod_abc',
    ASAAS_API_URL: 'https://api-sandbox.asaas.com/v3',
  });
  try {
    await assert.rejects(() => A.call('GET', '/customers'), /é de producao.*aponta para sandbox/);
  } finally {
    restaurar();
  }
});

test('ambiente: chave antiga (sem marca) segue a URL', () => {
  const { A, restaurar } = asaasReal({
    ASAAS_API_KEY: '$aact_YTU5YTE0M2M2',
    ASAAS_API_URL: 'https://sandbox.asaas.com/api/v3',
  });
  try {
    assert.equal(A.ambienteDaChave('$aact_YTU5YTE0M2M2'), null);
    assert.equal(A.ambiente(), 'sandbox');
  } finally {
    restaurar();
  }
});

// ── 2. Virada sandbox → produção ──────────────────────────────────────────
function virarParaProducao() {
  // O Asaas de produção não conhece nada do sandbox.
  M.asaasState.customers.clear();
  M.asaasState.subscriptions.clear();
  M.asaasState.payments.clear();
  M.asaasState.ambiente = 'producao';
}

test('virada: conta do sandbox assina em produção com cliente novo', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'ana');
  const doSandbox = S.billing('ana').customerId;
  assert.equal(S.billing('ana').asaasAmbiente, 'sandbox');

  virarParaProducao();
  const r = await S.assinar(m, 'ana');
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const b = S.billing('ana');
  assert.equal(b.asaasAmbiente, 'producao');
  assert.notEqual(b.customerId, doSandbox, 'customerId trocado');
  assert.equal(b.asaasClienteAnterior, doSandbox);
  const sub = M.asaasState.subscriptions.get(b.subscriptionId);
  assert.ok(sub, 'assinatura criada no Asaas de produção');
  assert.equal(sub.customer, b.customerId);
  // O CPF foi para o cliente novo.
  assert.ok(M.asaasState.customers.get(b.customerId).cpfCnpj);
  assert.equal(S.problemas(m), '');
});

test('virada: assinatura do sandbox some, a janela já paga fica', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'bia');
  await S.assinar(m, 'bia');
  await S.pagar('bia', S.faturaEmAberto('bia'));
  const antes = S.billing('bia');
  assert.equal(antes.subscriptionStatus, 'ACTIVE');
  const paidUntil = antes.paidUntil.toMillis();
  assert.ok(paidUntil > m.t0);

  virarParaProducao();
  S.avancarDias(20);
  const r = await S.assinar(m, 'bia');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = S.billing('bia');
  assert.equal(b.asaasAmbiente, 'producao');
  assert.notEqual(b.subscriptionId, antes.subscriptionId, 'assinatura nova, de produção');
  assert.ok(M.asaasState.subscriptions.get(b.subscriptionId));
  assert.ok(b.paidUntil.toMillis() >= paidUntil, 'ninguém perde os dias já pagos');
  assert.equal(S.acesso('bia').status, 'active');
  assert.equal(S.problemas(m), '');
});

test('virada: conta já criada em produção não troca de cliente', async () => {
  const m = S.criarMundoPagamentos({ ambiente: 'producao' });
  await S.criarConta(m, 'caio');
  const id = S.billing('caio').customerId;
  const r = await S.assinar(m, 'caio');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(S.billing('caio').customerId, id);
  assert.equal(S.billing('caio').asaasClienteAnterior, undefined);
});

// ── 3. Applicash desligado ───────────────────────────────────────────────
test('Applicash desligado: o /init ignora o cupom e não vincula indicação', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'dono');
  const cupom = S.billing('dono').referralCode;
  const antes = process.env.APPLICASH_ENABLED;
  delete process.env.APPLICASH_ENABLED;
  try {
    const r = await S.criarConta(m, 'amigo', { cupom });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const b = S.billing('amigo');
    assert.equal(b.referredByUserId, undefined);
    assert.equal(b.recurringDiscountPercent || 0, 0);
  } finally {
    if (antes != null) process.env.APPLICASH_ENABLED = antes;
  }
});

// ── 4. O que está à venda é o que existe ─────────────────────────────────
test('landing e tela de assinatura: um plano só, sem Pro + IA e sem Applicash', () => {
  const fs = require('fs');
  const ROOT = path.join(__dirname, '..');
  const landing = fs.readFileSync(path.join(ROOT, 'landing.html'), 'utf8');
  // Só o que o visitante vê: sem <style>, <script> e comentários.
  const visivel = landing
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');
  assert.ok(!/Pro \+ IA/.test(visivel), 'landing ainda vende o Pro + IA');
  assert.ok(!/Applicash/i.test(visivel), 'landing ainda fala do Applicash');
  assert.equal((visivel.match(/class="plan[ "]/g) || []).length, 1, 'um card de plano');

  const billing = fs
    .readFileSync(path.join(ROOT, 'web/appliquei-billing.js'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l)) // comentário não é tela
    .join('\n');
  assert.ok(!/Pro \+ IA/.test(billing), 'tela de assinatura ainda mostra o Pro + IA');

  const app = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
  assert.match(app, /window\.APPLICASH_ATIVO = false;/, 'Applicash desligado no app');
  assert.match(app, /<section id="applicash"[^>]*data-applicash/);
  assert.match(app, /class="nav-group" data-applicash/);
});
