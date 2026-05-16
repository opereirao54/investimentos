'use strict';

// Cenário: Alice envia o cupom para o colega (Bob).
// Cobre o fluxo completo de indicação + idempotência + estorno + bloqueios.

const M = require('./lib/mock-billing');
const H = M.setup();
const { store, asaasState, call } = M;

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { console.log('   \x1b[32m✓\x1b[0m ' + msg); pass++; }
  else { console.log('   \x1b[31m✗ ' + msg + '\x1b[0m'); fail++; }
}
function step(n, title) { console.log('\n\x1b[36m== STEP ' + n + ' — ' + title + '\x1b[0m'); }
function log(...a) { console.log('   ', ...a); }

async function main() {
  console.log('\x1b[1mCenário: Alice envia o cupom para o colega (Bob)\x1b[0m');

  // ============ STEP 1 ============
  step(1, 'Alice cria a conta (sem cupom; é a indicadora)');
  const aliceTok = 'fake:alice_uid:alice@example.com';
  const r1 = await call(H.init, { headers: { authorization: 'Bearer ' + aliceTok }, body: {} });
  check(r1.status === 200, 'init status 200');
  const aliceB = store.docs.get('users/alice_uid/billing/account');
  log('cupom da Alice =', aliceB.referralCode);
  check(/^APP-[A-Z0-9]{6}$/.test(aliceB.referralCode), 'cupom no formato APP-XXXXXX');
  const aliceCode = aliceB.referralCode;
  check(store.docs.has('referralCodes/' + aliceCode), 'cupom registado em referralCodes/' + aliceCode);
  check(aliceB.customerId && aliceB.customerId.startsWith('cus_'), 'customer Asaas criado');
  check(aliceB.signupIp === '127.0.0.1', 'signupIp registado (M6)');

  // ============ STEP 2 ============
  step(2, 'Alice copia o link de indicação');
  const link = 'https://app.appliquei.com/?ref=' + encodeURIComponent(aliceCode);
  log('link →', link);

  // ============ STEP 3 ============
  step(3, 'Bob clica no link, abre o app, cria a conta usando o cupom da Alice');
  log('(no frontend: ?ref capturado da URL -> sessionStorage -> body.referralCode no /init)');
  const bobTok = 'fake:bob_uid:bob@example.com';
  const r3 = await call(H.init, { headers: { authorization: 'Bearer ' + bobTok }, body: { referralCode: aliceCode } });
  check(r3.status === 200, 'init status 200');
  const bobB = store.docs.get('users/bob_uid/billing/account');
  check(bobB.referredByUserId === 'alice_uid', 'Bob vinculado à Alice');
  check(bobB.referredByCode === aliceCode, 'cupom gravado no billing de Bob');
  check(bobB.recurringDiscountPercent === 10, '10% de desconto recorrente para Bob');
  check(!!bobB.referralUsedAt, 'referralUsedAt timestamp registado');

  // ============ STEP 4 ============
  step(4, 'Charlie tenta criar conta com cupom inexistente');
  const charlieTok = 'fake:charlie_uid:charlie@example.com';
  const r4 = await call(H.init, { headers: { authorization: 'Bearer ' + charlieTok }, body: { referralCode: 'APP-NOPE99' } });
  check(r4.status === 400, 'status 400');
  check(r4.body.error === 'referral_code_not_found', 'erro = referral_code_not_found');
  const charlieB = store.docs.get('users/charlie_uid/billing/account');
  check(!charlieB || !charlieB.customerId, 'nenhum customer Asaas criado para Charlie (rollback ok)');
  check(!charlieB || !charlieB.initLock, 'init lock liberado após erro de cupom');

  // ============ STEP 5 ============
  step(5, 'Bob completa /subscribe com CPF próprio');
  const r5 = await call(H.subscribe, { headers: { authorization: 'Bearer ' + bobTok }, body: { cpfCnpj: '12345678901', name: 'Bob Friend' } });
  check(r5.status === 200, 'subscribe ok');
  const bobB2 = store.docs.get('users/bob_uid/billing/account');
  check(!!bobB2.subscriptionId, 'subscription criada no Asaas');
  check(bobB2.subscriptionBaseValueCents === 1350, 'valor recorrente = R$ 13,50 (15 - 10%)');
  log('valueCents Bob =', bobB2.subscriptionBaseValueCents);

  // ============ STEP 6 ============
  step(6, 'Asaas dispara PAYMENT_CONFIRMED do Bob → gera crédito para Alice');
  const bobPay = Array.from(asaasState.payments.values()).find(p => p.subscription === bobB2.subscriptionId);
  bobPay.status = 'CONFIRMED';
  const r6 = await call(H.webhook, {
    headers: { 'asaas-access-token': 'test_webhook_token' },
    body: { id: 'evt_001', event: 'PAYMENT_CONFIRMED', payment: { ...bobPay } },
  });
  check(r6.status === 200, 'webhook ok');
  const aliceCredit = store.docs.get('users/alice_uid/billing/account/credits/' + bobPay.id);
  check(!!aliceCredit, 'crédito criado em users/alice_uid/billing/account/credits/' + bobPay.id);
  check(aliceCredit.amountCents === 135, 'crédito = 10% de R$ 13,50 = R$ 1,35');
  check(aliceCredit.fromUid === 'bob_uid', 'crédito vem de Bob');
  check(aliceCredit.appliedAt === null, 'crédito ainda não aplicado (pending)');
  const aliceAfter6 = store.docs.get('users/alice_uid/billing/account');
  check(aliceAfter6.stats && aliceAfter6.stats.totalReferralEarningsCents === 135, 'stats.totalReferralEarningsCents = 135');
  check(aliceAfter6.stats.pendingDiscountCents === 135, 'stats.pendingDiscountCents = 135');

  // ============ STEP 7 ============
  step(7, 'Asaas retransmite o MESMO evento — idempotência (C2)');
  const r7 = await call(H.webhook, {
    headers: { 'asaas-access-token': 'test_webhook_token' },
    body: { id: 'evt_001', event: 'PAYMENT_CONFIRMED', payment: { ...bobPay } },
  });
  check(r7.body && r7.body.duplicate === true, 'duplicado marcado como duplicate');
  const aliceAfter7 = store.docs.get('users/alice_uid/billing/account');
  check(aliceAfter7.stats.totalReferralEarningsCents === 135, 'totalReferralEarningsCents permanece 135');
  check(aliceAfter7.stats.pendingDiscountCents === 135, 'pendingDiscountCents permanece 135');

  // ============ STEP 8 ============
  step(8, 'Alice ativa subscription; webhook PAYMENT_CREATED aplica o crédito acumulado');
  await call(H.subscribe, { headers: { authorization: 'Bearer ' + aliceTok }, body: { cpfCnpj: '99988877766', name: 'Alice Indicator' } });
  const aliceB3 = store.docs.get('users/alice_uid/billing/account');
  const alicePay = Array.from(asaasState.payments.values()).find(p => p.subscription === aliceB3.subscriptionId);
  log('fatura inicial da Alice =', alicePay.value);
  const r8 = await call(H.webhook, {
    headers: { 'asaas-access-token': 'test_webhook_token' },
    body: { id: 'evt_002', event: 'PAYMENT_CREATED', payment: { ...alicePay } },
  });
  check(r8.status === 200, 'webhook ok');
  log('fatura da Alice após aplicar crédito =', alicePay.value);
  check(alicePay.value === 15 - 1.35, 'fatura agora = R$ 13,65');
  const aliceCreditAfter = store.docs.get('users/alice_uid/billing/account/credits/' + bobPay.id);
  check(!!aliceCreditAfter.appliedAt, 'crédito marcado como aplicado');
  check(aliceCreditAfter.appliedToPaymentId === alicePay.id, 'crédito apontado para a fatura da Alice');

  // ============ STEP 9 ============
  step(9, 'Atacante (Dave) tenta auto-indicação: 2ª conta com MESMO CPF da 1ª');
  const dave1Tok = 'fake:dave1_uid:dave1@example.com';
  await call(H.init, { headers: { authorization: 'Bearer ' + dave1Tok }, body: {} });
  const dave1Code = store.docs.get('users/dave1_uid/billing/account').referralCode;
  await call(H.subscribe, { headers: { authorization: 'Bearer ' + dave1Tok }, body: { cpfCnpj: '55544433322', name: 'Dave One' } });
  log('Dave1 cupom =', dave1Code, '(CPF 555.444.333-22)');

  const dave2Tok = 'fake:dave2_uid:dave2@example.com';
  await call(H.init, { headers: { authorization: 'Bearer ' + dave2Tok }, body: { referralCode: dave1Code } });
  const dave2Sub = await call(H.subscribe, { headers: { authorization: 'Bearer ' + dave2Tok }, body: { cpfCnpj: '55544433322', name: 'Dave Two' } });
  check(dave2Sub.status === 409 && dave2Sub.body && dave2Sub.body.error === 'cpfcnpj_in_use',
        'subscribe da 2ª conta recusado (cpfcnpj_in_use)');
  log('resposta =', dave2Sub.status, JSON.stringify(dave2Sub.body));

  // ============ STEP 10 ============
  step(10, 'PAYMENT_REFUNDED do Bob — crédito da Alice deve ser estornado');
  const r10 = await call(H.webhook, {
    headers: { 'asaas-access-token': 'test_webhook_token' },
    body: { id: 'evt_003', event: 'PAYMENT_REFUNDED', payment: { ...bobPay, status: 'REFUNDED' } },
  });
  check(r10.status === 200, 'webhook ok');
  const aliceCreditAfterRefund = store.docs.get('users/alice_uid/billing/account/credits/' + bobPay.id);
  check(!!aliceCreditAfterRefund.voidedAt, 'crédito da Alice marcado com voidedAt');
  check(aliceCreditAfterRefund.voidedReason === 'payment_refunded', 'voidedReason = payment_refunded');
  const aliceAfter10 = store.docs.get('users/alice_uid/billing/account');
  check(aliceAfter10.stats.totalReferralEarningsCents === 0, 'totalReferralEarningsCents estornado para 0');

  // ============ STEP 11 ============
  step(11, 'Webhook com token errado é recusado (C1)');
  const r11 = await call(H.webhook, {
    headers: { 'asaas-access-token': 'wrong_token' },
    body: { id: 'evt_attack', event: 'PAYMENT_CONFIRMED', payment: { id: 'forged', subscription: bobB2.subscriptionId, value: 9999 } },
  });
  check(r11.status === 401, 'status 401 com token errado');
  check(r11.body.error === 'invalid_webhook_token', 'erro = invalid_webhook_token');

  // ============ STEP 12 ============
  step(12, 'Alice consulta /me — e-mail do indicado vem mascarado (A7)');
  const r12 = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + aliceTok } });
  check(r12.status === 200, 'me ok');
  const ref = r12.body.referrals.find(r => r.uid === 'bob_uid');
  log('referral retornado para a UI =', JSON.stringify(ref));
  check(!!ref, 'Bob está na lista de referrals');
  check(ref.email && ref.email !== 'bob@example.com' && ref.email.includes('***'),
        'e-mail mascarado (não vaza endereço real)');

  console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + '== Resultado: ' + pass + ' ok, ' + fail + ' falha(s)\x1b[0m');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('\nFalha inesperada:\n', e); process.exit(2); });
