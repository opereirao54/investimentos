'use strict';

// Cenários de assinatura — "pagou usa, não pagou não usa".
// Cobre: trial, paga sem cupom, paga com cupom, não paga, inadimplência,
// chargeback, refund, cancelamento, defesa contra dessincronia (C5) e
// defesa contra revivência de INACTIVE (M3).

const M = require('./lib/mock-billing');
const H = M.setup();
const { store, asaasState, call, makeTimestamp } = M;

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { console.log('   \x1b[32m✓\x1b[0m ' + msg); pass++; }
  else { console.log('   \x1b[31m✗ ' + msg + '\x1b[0m'); fail++; }
}
function step(n, t) { console.log('\n\x1b[36m== ' + n + ' — ' + t + '\x1b[0m'); }
function log(...a) { console.log('   ', ...a); }
const TEST_TOKEN = 'test_webhook_token';

function getPayment(subId) {
  return Array.from(asaasState.payments.values()).find(p => p.subscription === subId);
}

async function main() {
  console.log('\x1b[1mTeste: assinatura com e sem cupom — pagou usa, não pagou não usa\x1b[0m');

  // ============================================================
  // CENÁRIO A: SEM CUPOM, PAGA
  // ============================================================
  step('A1', 'Anna cria conta SEM cupom (em trial)');
  const annaTok = 'fake:anna_uid:anna@example.com';
  const a1 = await call(H.init, { headers: { authorization: 'Bearer ' + annaTok }, body: {} });
  check(a1.status === 200, 'init ok');
  check(a1.body.access.status === 'trial', 'access.status = trial');
  check(a1.body.access.trialDaysLeft === 7, 'trialDaysLeft = 7');
  const annaB = store.docs.get('users/anna_uid/billing/account');
  check(annaB.subscriptionStatus === null, 'subscriptionStatus inicial = null');
  check(annaB.recurringDiscountPercent === 0, 'sem desconto (sem cupom)');

  step('A2', '/me durante o trial confirma acesso');
  const a2 = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + annaTok } });
  check(a2.body.access.status === 'trial', '/me devolve trial');
  check(a2.body.recurringDiscountPercent === 0, 'sem desconto recorrente');

  step('A3', 'Anna assina (sem cupom, valor cheio R$ 15)');
  const a3 = await call(H.subscribe, { headers: { authorization: 'Bearer ' + annaTok }, body: { cpfCnpj: '11122233344', name: 'Anna Sem Cupom' } });
  check(a3.status === 200, 'subscribe ok');
  const annaB3 = store.docs.get('users/anna_uid/billing/account');
  check(annaB3.subscriptionBaseValueCents === 1500, 'valor recorrente = R$ 15,00 (sem desconto)');
  check(!!annaB3.subscriptionId, 'subscription criada');

  step('A4', 'Antes do webhook confirmar, /me ainda mostra trial (não há cobrança paga ainda)');
  const a4 = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + annaTok } });
  check(a4.body.access.status === 'trial', '/me ainda trial (trial dura 7d, paga ou não)');

  step('A5', 'PAYMENT_CONFIRMED chega → access.status passa a active');
  const annaPay = getPayment(annaB3.subscriptionId);
  annaPay.status = 'CONFIRMED';
  await call(H.webhook, {
    headers: { 'asaas-access-token': TEST_TOKEN },
    body: { id: 'evt_anna_paid', event: 'PAYMENT_CONFIRMED', payment: { ...annaPay } },
  });
  const a5 = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + annaTok } });
  check(a5.body.access.status === 'active', '/me: active');
  check(a5.body.access.reason === 'paid', 'reason: paid');
  check(a5.body.lastPaymentStatus === 'CONFIRMED', 'lastPaymentStatus = CONFIRMED');

  // ============================================================
  // CENÁRIO B: SEM CUPOM, NÃO PAGA
  // ============================================================
  step('B1', 'Beto cria conta SEM cupom e NÃO assina');
  const betoTok = 'fake:beto_uid:beto@example.com';
  await call(H.init, { headers: { authorization: 'Bearer ' + betoTok }, body: {} });
  const betoMe1 = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + betoTok } });
  check(betoMe1.body.access.status === 'trial', 'inicialmente em trial');

  step('B2', 'Trial do Beto expira sem assinatura → acesso bloqueado');
  const betoB = store.docs.get('users/beto_uid/billing/account');
  betoB.trialEndsAt = makeTimestamp(Date.now() - 3600 * 1000); // 1h atrás
  const b2 = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + betoTok } });
  check(b2.body.access.status === 'blocked', 'access = blocked');
  check(b2.body.access.reason === 'trial_expired', 'reason = trial_expired');

  step('B3', '/status (rota usada pelo polling) também devolve blocked');
  const b3 = await call(H.status, { method: 'GET', headers: { authorization: 'Bearer ' + betoTok } });
  check(b3.body.access.status === 'blocked', 'blocked');
  check(b3.body.access.reason === 'trial_expired', 'trial_expired');

  // ============================================================
  // CENÁRIO C: COM CUPOM, PAGA
  // ============================================================
  step('C1', 'Carla cria conta e gera cupom');
  const carlaTok = 'fake:carla_uid:carla@example.com';
  await call(H.init, { headers: { authorization: 'Bearer ' + carlaTok }, body: {} });
  await call(H.subscribe, { headers: { authorization: 'Bearer ' + carlaTok }, body: { cpfCnpj: '33344455566', name: 'Carla Indicadora' } });
  const carlaCode = store.docs.get('users/carla_uid/billing/account').referralCode;
  log('cupom da Carla =', carlaCode);

  step('C2', 'Carlos usa o cupom da Carla — billing tem 10% off');
  const carlosTok = 'fake:carlos_uid:carlos@example.com';
  const c2 = await call(H.init, { headers: { authorization: 'Bearer ' + carlosTok }, body: { referralCode: carlaCode } });
  check(c2.status === 200, 'init com cupom ok');
  check(c2.body.billing.recurringDiscountPercent === 10, '10% off recorrente registado');
  check(c2.body.access.status === 'trial', 'em trial (cupom não dá acesso, só desconto SE pagar)');

  step('C3', 'Carlos assina com CPF próprio → fatura recorrente com desconto');
  const c3 = await call(H.subscribe, { headers: { authorization: 'Bearer ' + carlosTok }, body: { cpfCnpj: '22233344455', name: 'Carlos Indicado' } });
  check(c3.status === 200, 'subscribe ok');
  const carlosB = store.docs.get('users/carlos_uid/billing/account');
  check(carlosB.subscriptionBaseValueCents === 1350, 'valor recorrente = R$ 13,50 (15 - 10%)');

  step('C4', 'PAYMENT_CONFIRMED do Carlos → access active + crédito para Carla');
  const carlosPay = getPayment(carlosB.subscriptionId);
  carlosPay.status = 'CONFIRMED';
  await call(H.webhook, {
    headers: { 'asaas-access-token': TEST_TOKEN },
    body: { id: 'evt_carlos_paid', event: 'PAYMENT_CONFIRMED', payment: { ...carlosPay } },
  });
  const c4 = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + carlosTok } });
  check(c4.body.access.status === 'active', 'Carlos: active');
  const carlaCredit = store.docs.get('users/carla_uid/billing/account/credits/' + carlosPay.id);
  check(!!carlaCredit && carlaCredit.amountCents === 135, 'Carla recebeu crédito de R$ 1,35');

  // ============================================================
  // CENÁRIO D: COM CUPOM, NÃO PAGA
  // ============================================================
  step('D1', 'Diana cria conta com cupom mas NÃO assina');
  const dianaTok = 'fake:diana_uid:diana@example.com';
  await call(H.init, { headers: { authorization: 'Bearer ' + dianaTok }, body: { referralCode: carlaCode } });
  const dianaB = store.docs.get('users/diana_uid/billing/account');
  check(dianaB.recurringDiscountPercent === 10, 'cupom registrado mesmo sem pagar (vale para quando pagar)');

  step('D2', 'Trial da Diana expira sem pagamento → bloqueado (cupom não substitui pagamento)');
  dianaB.trialEndsAt = makeTimestamp(Date.now() - 3600 * 1000);
  const d2 = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + dianaTok } });
  check(d2.body.access.status === 'blocked', 'Diana: blocked');
  check(d2.body.access.reason === 'trial_expired', 'reason: trial_expired (cupom só dá DESCONTO ao pagar)');

  step('D3', 'Carla NÃO recebeu crédito da Diana (ninguém pagou)');
  const carlaCreditsAfterD = Array.from(store.docs.keys()).filter(k => k.startsWith('users/carla_uid/billing/account/credits/'));
  log('créditos da Carla =', carlaCreditsAfterD.length);
  check(carlaCreditsAfterD.length === 1, 'apenas o crédito vindo do Carlos (que pagou) — Diana não gera crédito');

  // ============================================================
  // CENÁRIO E: ESTADOS PROBLEMÁTICOS (C5)
  // ============================================================
  step('E1', 'PAYMENT_OVERDUE da Anna → access blocked/overdue');
  await call(H.webhook, {
    headers: { 'asaas-access-token': TEST_TOKEN },
    body: { id: 'evt_anna_over', event: 'PAYMENT_OVERDUE', payment: { ...annaPay, status: 'OVERDUE' } },
  });
  const e1 = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + annaTok } });
  check(e1.body.access.status === 'blocked', 'blocked');
  check(e1.body.access.reason === 'overdue', 'overdue');

  step('E2', 'Defesa C5: forçar subscriptionStatus=ACTIVE com lastPaymentStatus=OVERDUE — não restaura acesso');
  store.docs.get('users/anna_uid/billing/account').subscriptionStatus = 'ACTIVE';
  const e2 = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + annaTok } });
  check(e2.body.access.status === 'blocked', 'ainda blocked (computeAccess prioriza lastPaymentStatus)');
  check(e2.body.access.reason === 'overdue', 'reason permanece overdue');

  step('E3', 'PAYMENT_CHARGEBACK_REQUESTED — access blocked/chargeback');
  const annaForChg = store.docs.get('users/anna_uid/billing/account');
  annaForChg.subscriptionStatus = 'ACTIVE'; annaForChg.lastPaymentStatus = 'CONFIRMED';
  await call(H.webhook, {
    headers: { 'asaas-access-token': TEST_TOKEN },
    body: { id: 'evt_anna_chg', event: 'PAYMENT_CHARGEBACK_REQUESTED', payment: { ...annaPay, status: 'CHARGEBACK_REQUESTED' } },
  });
  const e3 = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + annaTok } });
  check(e3.body.access.status === 'blocked', 'blocked');
  check(e3.body.access.reason === 'chargeback', 'chargeback');

  // ============================================================
  // CENÁRIO F: CANCELAMENTO + M3
  // ============================================================
  step('F1', 'Carlos cancela a assinatura');
  const carlosForCancel = store.docs.get('users/carlos_uid/billing/account');
  carlosForCancel.subscriptionStatus = 'ACTIVE';
  carlosForCancel.lastPaymentStatus = 'CONFIRMED';
  const f1 = await call(H.cancel, { headers: { authorization: 'Bearer ' + carlosTok }, body: {} });
  check(f1.status === 200, 'cancel ok');
  const carlosAfterF1 = store.docs.get('users/carlos_uid/billing/account');
  check(carlosAfterF1.subscriptionStatus === 'INACTIVE', 'subscriptionStatus = INACTIVE');

  step('F2', 'M3: webhook PAYMENT_CONFIRMED atrasado NÃO revive INACTIVE');
  await call(H.webhook, {
    headers: { 'asaas-access-token': TEST_TOKEN },
    body: { id: 'evt_carlos_stale', event: 'PAYMENT_CONFIRMED', payment: { id: 'stale_' + carlosPay.id, subscription: carlosForCancel.subscriptionId, status: 'CONFIRMED', value: 13.50 } },
  });
  const carlosAfterF2 = store.docs.get('users/carlos_uid/billing/account');
  check(carlosAfterF2.subscriptionStatus === 'INACTIVE', 'subscriptionStatus permanece INACTIVE');

  step('F3', '/me após cancelamento durante o trial: mantém trial até vencer (comportamento do produto)');
  const f3a = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + carlosTok } });
  check(f3a.body.access.status === 'trial', 'durante o trial: ainda trial (cancelamento só toma efeito após o trial vencer)');

  step('F4', 'Quando o trial expira após o cancelamento → blocked/cancelled');
  const carlosForExpire = store.docs.get('users/carlos_uid/billing/account');
  carlosForExpire.trialEndsAt = makeTimestamp(Date.now() - 3600 * 1000);
  const f4 = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + carlosTok } });
  check(f4.body.access.status === 'blocked', 'blocked');
  check(f4.body.access.reason === 'cancelled', 'cancelled');

  // ============================================================
  // CENÁRIO G: computeAccess direto (espelho do firestore.rules M4)
  // ============================================================
  step('G1', 'computeAccess: trial vivo → trial');
  const g1 = H.computeAccess({ trialEndsAt: makeTimestamp(Date.now() + 86400 * 1000), subscriptionStatus: null });
  check(g1.status === 'trial', 'trial');

  step('G2', 'computeAccess: ACTIVE + CONFIRMED → active');
  const g2 = H.computeAccess({ subscriptionStatus: 'ACTIVE', lastPaymentStatus: 'CONFIRMED', lastPaidAt: makeTimestamp(Date.now() - 1000) });
  check(g2.status === 'active', 'active');
  check(g2.reason === 'paid', 'reason paid');

  step('G3', 'computeAccess: ACTIVE + OVERDUE → blocked/overdue (defesa C5)');
  const g3 = H.computeAccess({ subscriptionStatus: 'ACTIVE', lastPaymentStatus: 'OVERDUE', lastPaidAt: makeTimestamp(Date.now() - 86400 * 1000) });
  check(g3.status === 'blocked', 'blocked');
  check(g3.reason === 'overdue', 'overdue');

  step('G4', 'computeAccess: ACTIVE + REFUNDED → blocked/refunded');
  const g4 = H.computeAccess({ subscriptionStatus: 'ACTIVE', lastPaymentStatus: 'REFUNDED', lastPaidAt: makeTimestamp(Date.now() - 86400 * 1000) });
  check(g4.status === 'blocked', 'blocked');
  check(g4.reason === 'refunded', 'refunded');

  step('G5', 'computeAccess: ACTIVE + CHARGEBACK_REQUESTED → blocked/chargeback');
  const g5 = H.computeAccess({ subscriptionStatus: 'ACTIVE', lastPaymentStatus: 'CHARGEBACK_REQUESTED' });
  check(g5.status === 'blocked', 'blocked');
  check(g5.reason === 'chargeback', 'chargeback');

  step('G6', 'computeAccess: INACTIVE → blocked/cancelled');
  const g6 = H.computeAccess({ subscriptionStatus: 'INACTIVE' });
  check(g6.status === 'blocked', 'blocked');
  check(g6.reason === 'cancelled', 'cancelled');

  step('G7', 'computeAccess: nada (billing null) → blocked/no_billing');
  const g7 = H.computeAccess(null);
  check(g7.status === 'blocked', 'blocked');
  check(g7.reason === 'no_billing', 'no_billing');

  step('G8', 'computeAccess: trial expirado + sem subscription → blocked/trial_expired');
  const g8 = H.computeAccess({ trialEndsAt: makeTimestamp(Date.now() - 1000), subscriptionStatus: null });
  check(g8.status === 'blocked', 'blocked');
  check(g8.reason === 'trial_expired', 'trial_expired');

  console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + '== Resultado: ' + pass + ' ok, ' + fail + ' falha(s)\x1b[0m');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FAIL:', e); process.exit(2); });
