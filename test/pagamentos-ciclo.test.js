'use strict';

/**
 * Ciclo de cobrança: quando o dinheiro sai e até quando o acesso vale.
 *
 * A pergunta que originou estes testes: *"se eu pagar a fatura antes do
 * vencimento, só para antecipar, o sistema começa a contar um ciclo novo
 * daquele dia e eu perco os dias que ainda tinha?"*
 *
 * Perdia. E não era só na antecipação — era a mesma regra errada em três
 * lugares: quem assinava no meio do trial, quem renovava o avulso cedo, e
 * quem pagava boleto no dia do vencimento. Todos perdiam tempo que já era
 * deles. A regra correta é CRÉDITO DE TEMPO: pagar cedo SOMA um ciclo ao
 * que resta, nunca reinicia a contagem.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const S = require('./_simulador-pagamentos.js');

test('antecipar a renovação avulsa SOMA o ciclo — não queima os dias restantes', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'ana');

  // Dia 0: paga o avulso. Ainda tem 7 dias de trial em pé, então a janela
  // comprada vai até dia 37 (7 de avaliação + 30 pagos).
  let r = await S.assinar(m, 'ana', { modo: 'avulso' });
  await S.pagar('ana', r.body.paymentId);
  const apos1 = S.acessoAteDia(m, 'ana');
  assert.equal(apos1, 37, 'primeiro pagamento: trial restante + 30 dias');
  assert.equal(S.problemas(m), '');

  // Dia 20: antecipa a renovação, com 17 dias ainda por usar.
  S.avancarDias(20);
  r = await S.assinar(m, 'ana', { modo: 'avulso' });
  await S.pagar('ana', r.body.paymentId);

  const apos2 = S.acessoAteDia(m, 'ana');
  assert.equal(
    apos2,
    67,
    'antecipar no dia 20 tem de somar 30 aos 37 que já tinha, não recomeçar em 20+30=50'
  );
  assert.equal(S.problemas(m), '');

  // O que o usuário sente: continua dentro no dia 60, sai no dia 68.
  S.avancarDias(40); // dia 60
  assert.equal(S.acesso('ana').status, 'active', 'dia 60 ainda dentro do que pagou');
  S.avancarDias(8); // dia 68
  assert.equal(S.acesso('ana').status, 'blocked', 'dia 68 já passou dos dois ciclos');
});

test('assinar no meio do trial não antecipa a cobrança — os dias grátis são honrados', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'bia');
  const fimTrial = S.billing('bia').trialEndsAt.toMillis();

  // Dia 3 de 7: decide assinar cedo.
  S.avancarDias(3);
  await S.assinar(m, 'bia');

  const sub = Array.from(S.asaasState.subscriptions.values())[0];
  const vence = Date.parse(sub.nextDueDate + 'T23:59:59Z');
  assert.ok(
    vence >= fimTrial - S.DIA,
    'a 1ª cobrança (' + sub.nextDueDate + ') não pode cair antes do fim do trial'
  );
  assert.equal(S.problemas(m), '');
});

test('CONFIRMED + RECEIVED da MESMA cobrança estendem o acesso uma vez só', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'caio');
  const r = await S.assinar(m, 'caio', { modo: 'avulso' });

  // O Asaas emite os dois eventos para a mesma cobrança. São eventos
  // distintos, então o guard de webhookEvents não os deduplica — a
  // idempotência tem de ser por payment.id.
  await S.pagar('caio', r.body.paymentId, { duplo: true });

  assert.equal(S.acessoAteDia(m, 'caio'), 37, 'um pagamento = um ciclo, mesmo com dois eventos');
  assert.equal(S.problemas(m), '');
});

test('fatura SEGUINTE vencida não revoga o mês que já foi pago', async () => {
  // Boleto e PIX compensam em 1-3 dias úteis. Quem paga no dia do vencimento
  // recebe um PAYMENT_OVERDUE antes da compensação chegar — e era bloqueado
  // na hora, tendo pago.
  const m = S.criarMundoPagamentos({ cartaoCapturaNaHora: false });
  await S.criarConta(m, 'dora');
  await S.assinar(m, 'dora');
  await S.pagar('dora', S.faturaEmAberto('dora'));
  assert.equal(S.acesso('dora').status, 'active');

  await S.vencer('dora');
  assert.equal(
    S.acesso('dora').status,
    'active',
    'com a janela paga em pé, um vencimento da PRÓXIMA fatura não pode cortar o acesso'
  );
  assert.equal(S.problemas(m), '');

  // Passada a janela comprada, aí sim bloqueia.
  S.avancarDias(40);
  assert.equal(S.acesso('dora').status, 'blocked', 'acabado o ciclo pago, o vencido bloqueia');
});

test('estorno bloqueia na hora — a janela paga não protege quem recebeu o dinheiro de volta', async () => {
  const m = S.criarMundoPagamentos({ cartaoCapturaNaHora: false });
  await S.criarConta(m, 'edu');
  await S.assinar(m, 'edu');
  const fatura = S.faturaEmAberto('edu');
  await S.pagar('edu', fatura);
  assert.equal(S.acesso('edu').status, 'active');

  await S.estornar('edu', fatura);
  assert.equal(
    S.acesso('edu').status,
    'blocked',
    'estorno devolve o dinheiro: o acesso tem de cair mesmo dentro da janela'
  );
  assert.equal(S.acesso('edu').reason, 'refunded');
});

test('cancelar mantém o acesso até o fim do ciclo já pago', async () => {
  const m = S.criarMundoPagamentos({ cartaoCapturaNaHora: false });
  await S.criarConta(m, 'fabi');
  await S.assinar(m, 'fabi');
  await S.pagar('fabi', S.faturaEmAberto('fabi'));

  // Passa do trial primeiro: enquanto ele vive, computeAccess devolve
  // 'trial' de propósito e o teste mediria a avaliação, não o ciclo pago.
  S.avancarDias(10);
  await S.cancelar('fabi');
  assert.equal(
    S.acesso('fabi').status,
    'active',
    'quem cancela no dia 2 não perde os 28 que pagou (CDC + prática SaaS)'
  );

  S.avancarDias(30);
  assert.equal(S.acesso('fabi').status, 'blocked', 'passado o ciclo pago, cancelada é bloqueada');
  assert.equal(S.problemas(m), '');
});

test('contas antigas, sem paidUntil gravado, continuam com acesso', async () => {
  // Migração: quem pagou antes de o campo existir só tem lastPaidAt. Se o
  // fallback sumir, todo assinante antigo é bloqueado no deploy.
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'gil');
  const b = S.billing('gil');
  b.subscriptionStatus = 'ACTIVE';
  b.lastPaymentStatus = 'CONFIRMED';
  b.lastPaidAt = { toMillis: () => S.store.now - 5 * S.DIA, toDate: () => new Date() };
  delete b.paidUntil;
  delete b.trialEndsAt;

  assert.equal(S.acesso('gil').status, 'active', 'conta legada sem paidUntil segue ativa');
  S.avancarDias(40);
  assert.equal(S.acesso('gil', S.store.now).reason, 'paid', 'assinatura ACTIVE continua a valer');
});
