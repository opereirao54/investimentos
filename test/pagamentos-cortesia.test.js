'use strict';

/**
 * Cortesia do admin (Superpoderes) × tela de assinatura.
 *
 * A dor que originou estes testes: "eu libero o PRO e ele continua
 * funcionando, mas aparece mensagem de pagamento pendente". O "Tornar PRO"
 * antigo gravava subscriptionStatus=ACTIVE + lastPaymentStatus=CONFIRMED —
 * fingia um pagamento nos campos que são do Asaas. O primeiro webhook de uma
 * fatura (PAYMENT_CREATED, PAYMENT_OVERDUE) sobrescrevia esses campos e a
 * conta liberada caía em "Aguardando confirmação do pagamento" ou era
 * bloqueada; e quem nunca assinou via "Assinatura ativa · próxima cobrança".
 *
 * Agora a cortesia vive em campos próprios (courtesyPermanent/courtesyUntil),
 * que nenhum webhook toca.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const S = require('./_simulador-pagamentos.js');
const M = require('../scripts/lib/mock-billing');

test('Tornar PRO: webhooks de fatura não derrubam a cortesia', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'ana');
  // Assinou por Pix e não pagou: a fatura está em aberto no Asaas.
  await S.assinar(m, 'ana');
  await S.anunciarFaturasNovas('ana');

  const r = await S.superpoder('make_pro', 'ana');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(
    r.body.message,
    /assinatura no Asaas continua ativa/,
    'admin é avisado das cobranças'
  );
  // Não fingiu pagamento nenhum.
  assert.notEqual(S.billing('ana').lastPaymentStatus, 'CONFIRMED');

  // Trial acaba, a fatura vence: antes isto bloqueava a conta "PRO".
  S.avancarDias(10);
  await S.vencer('ana');
  const a = S.acesso('ana');
  assert.equal(a.status, 'active');
  assert.equal(a.reason, 'courtesy');

  const me = await S.verMinhaConta('ana');
  assert.equal(me.courtesy.active, true);
  assert.equal(me.courtesy.permanent, true);
  assert.equal(S.problemas(m), '');
});

test('Oferecer PRO N dias SOMA ao que já tinha e não mexe no trial', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'bia');
  const trialAntes = S.billing('bia').trialEndsAt.toMillis();

  await S.superpoder('gift_pro_days', 'bia', 30);
  S.avancarDias(10);
  await S.superpoder('gift_pro_days', 'bia', 30);

  const b = S.billing('bia');
  assert.equal(b.trialEndsAt.toMillis(), trialAntes, 'presente não regrava o trial');
  assert.equal(
    (b.courtesyUntil.toMillis() - m.t0) / S.DIA,
    60,
    '30 + 30, sem perder os 20 que restavam'
  );

  const me = await S.verMinhaConta('bia');
  assert.equal(me.courtesy.permanent, false);
  assert.equal(me.courtesy.daysLeft, 50);

  // Expira no dia 60 e a conta volta para o fluxo normal (trial já acabou).
  S.avancarDias(51);
  assert.equal(S.acesso('bia').status, 'blocked');
  assert.equal(S.problemas(m), '');
});

test('assinar durante a cortesia: o ciclo pago começa quando a cortesia acaba', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'caio');
  await S.superpoder('gift_pro_days', 'caio', 30);

  S.avancarDias(10);
  const r = await S.assinar(m, 'caio', { modo: 'avulso' });
  await S.pagar('caio', r.body.paymentId);

  assert.equal(S.acessoAteDia(m, 'caio'), 60, '20 dias de cortesia restantes + 30 pagos');
  assert.equal(S.problemas(m), '');
});

test('Revogar cortesia devolve a conta ao que ela pagou', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'duda');
  await S.superpoder('make_pro', 'duda');
  S.avancarDias(10);
  assert.equal(S.acesso('duda').reason, 'courtesy');

  const r = await S.superpoder('revoke_pro', 'duda');
  assert.equal(r.status, 200);
  assert.equal(S.acesso('duda').status, 'blocked', 'trial acabou e nada foi pago');
  assert.equal(S.problemas(m), '');
});

test('PRO antigo (ACTIVE+CONFIRMED sem assinatura) aparece como cortesia e pode ser revogado', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'eva');
  // Estado deixado pelo "Tornar PRO" de antes desta mudança.
  const doc = S.store.docs.get('users/eva/billing/account');
  doc.subscriptionStatus = 'ACTIVE';
  doc.lastPaymentStatus = 'CONFIRMED';
  S.avancarDias(10);

  const me = await S.verMinhaConta('eva');
  assert.equal(me.access.status, 'active', 'o gate continua a honrar quem já foi liberado');
  assert.equal(me.courtesy && me.courtesy.permanent, true, 'a tela sabe que é cortesia');

  await S.superpoder('revoke_pro', 'eva');
  assert.equal(S.acesso('eva').status, 'blocked');
  void m;
});

test('Cancelar assinatura no Asaas pelo admin para as cobranças', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'fabi');
  await S.assinar(m, 'fabi');
  await S.superpoder('make_pro', 'fabi');

  const r = await S.superpoder('cancel_asaas_sub', 'fabi');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(S.billing('fabi').subscriptionStatus, 'INACTIVE');
  const sub = S.asaasState.subscriptions.get(S.billing('fabi').subscriptionId);
  assert.ok(!sub || sub.status === 'INACTIVE' || sub.deleted, 'Asaas não cobra mais');

  S.avancarDias(10);
  assert.equal(S.acesso('fabi').reason, 'courtesy', 'a cortesia continua liberando');
  const me = await S.verMinhaConta('fabi');
  assert.deepEqual(me.upcomingCharges, [], 'nenhuma fatura para pagar');
  void m;
});

test('Minha assinatura: faturas de assinatura antiga e avulsos vencidos não aparecem para pagar', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'gil');
  await S.assinar(m, 'gil');
  await S.anunciarFaturasNovas('gil');
  const subAtual = S.billing('gil').subscriptionId;

  // Lixo que se acumula no histórico: fatura vencida de uma assinatura
  // trocada e um Pix avulso gerado e abandonado.
  const ts = M.makeTimestamp(S.store.now);
  S.store.docs.set('users/gil/payments/pay_velha', {
    id: 'pay_velha',
    status: 'OVERDUE',
    value: 15,
    dueDate: '2020-01-10',
    subscriptionId: 'sub_antiga',
    invoiceUrl: 'https://asaas/velha',
    receivedAt: ts,
  });
  S.store.docs.set('users/gil/payments/pay_avulso', {
    id: 'pay_avulso',
    status: 'OVERDUE',
    value: 15,
    dueDate: '2020-01-05',
    subscriptionId: null,
    invoiceUrl: 'https://asaas/avulso',
    receivedAt: ts,
  });

  const me = await S.verMinhaConta('gil');
  const ids = me.upcomingCharges.map((u) => u.paymentId).filter(Boolean);
  assert.ok(!ids.includes('pay_velha'), 'fatura de assinatura antiga não é cobrança atual');
  assert.ok(!ids.includes('pay_avulso'), 'avulso abandonado não é cobrança atual');
  const abertas = me.upcomingCharges.filter((u) => u.source === 'invoice');
  assert.equal(abertas.length, 1, 'uma fatura em aberto: a da assinatura atual');
  const fatura = S.cobrancas('gil').find((p) => p.id === abertas[0].paymentId);
  assert.equal(fatura.subscription, subAtual);
  void m;
});

test('Minha assinatura: sem assinatura, o Pix avulso gerado aparece para concluir', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'hel');
  const r = await S.assinar(m, 'hel', { modo: 'avulso' });
  await S.anunciarFaturasNovas('hel');

  const me = await S.verMinhaConta('hel');
  assert.equal(me.upcomingCharges.length, 1);
  assert.equal(me.upcomingCharges[0].oneShot, true);
  assert.equal(me.upcomingCharges[0].paymentId, r.body.paymentId);
  void m;
});
