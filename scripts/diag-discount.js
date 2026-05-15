'use strict';

// Diagnóstico: por que o usuário vê R$ 15 no momento de pagar?
// Cobre 4 cenários para isolar a causa.

const M = require('./lib/mock-billing');
const H = M.setup();
const { store, asaasState, call } = M;

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { console.log('   \x1b[32m✓\x1b[0m ' + msg); pass++; }
  else { console.log('   \x1b[31m✗ ' + msg + '\x1b[0m'); fail++; }
}
function step(n, t) { console.log('\n\x1b[36m== ' + n + ' — ' + t + '\x1b[0m'); }
function log(...a) { console.log('   ', ...a); }

async function main() {
  console.log('\x1b[1mDiagnóstico: R$ 15 na hora do pagamento — onde está o desconto?\x1b[0m');

  // ========== Setup: indicador existente ==========
  step('SETUP', 'Indicador (Alice) já existe e tem cupom');
  await call(H.init, { headers: { authorization: 'Bearer fake:alice:alice@x.com' }, body: {} });
  const aliceCode = store.docs.get('users/alice/billing/account').referralCode;
  log('cupom da Alice =', aliceCode);

  // =====================================================================
  // CENÁRIO 1: NOVO usuário usa cupom desde a 1ª chamada de /init
  // (Caminho ideal — deve funcionar)
  // =====================================================================
  step(1, 'NOVO usuário (Bob) — chama /init JÁ com o cupom');
  const bobTok = 'fake:bob:bob@x.com';
  const r1 = await call(H.init, {
    headers: { authorization: 'Bearer ' + bobTok },
    body: { referralCode: aliceCode },
  });
  log('billing devolvido por /init =', JSON.stringify({
    recurringDiscountPercent: r1.body.billing.recurringDiscountPercent,
    referredByCode: r1.body.billing.referredByCode,
  }));
  check(r1.body.billing.recurringDiscountPercent === 10, 'Cenário ideal: desconto = 10%');

  // Bob assina
  await call(H.subscribe, { headers: { authorization: 'Bearer ' + bobTok }, body: { cpfCnpj: '11122233344', name: 'Bob' } });
  const bobB = store.docs.get('users/bob/billing/account');
  const bobAsaasSub = asaasState.subscriptions.get(bobB.subscriptionId);
  log('valor da subscription Asaas do Bob =', bobAsaasSub.value);
  check(bobAsaasSub.value === 13.5, 'Asaas recebeu value=13.50 (com desconto)');
  const bobPay = Array.from(asaasState.payments.values()).find(p => p.subscription === bobB.subscriptionId);
  log('valor da PRIMEIRA fatura Asaas do Bob =', bobPay.value);
  check(bobPay.value === 13.5, 'fatura inicial = R$ 13,50');

  // =====================================================================
  // CENÁRIO 2: EXISTENTE usa cupom retroativamente
  // (Provável caminho do bug)
  // =====================================================================
  step(2, 'EXISTENTE: Carla criou conta SEM cupom, depois recebe um cupom de amigo e tenta aplicar');
  const carlaTok = 'fake:carla:carla@x.com';
  // 1ª init SEM cupom
  await call(H.init, { headers: { authorization: 'Bearer ' + carlaTok }, body: {} });
  const carlaB1 = store.docs.get('users/carla/billing/account');
  log('1ª init (sem cupom): customerId =', carlaB1.customerId, '· discount =', carlaB1.recurringDiscountPercent);
  check(carlaB1.recurringDiscountPercent === 0, '1ª init sem cupom: discount=0 (esperado)');

  // 2ª init AGORA com cupom (usuário clicou em link de indicação)
  const r2 = await call(H.init, {
    headers: { authorization: 'Bearer ' + carlaTok },
    body: { referralCode: aliceCode },
  });
  const carlaB2 = store.docs.get('users/carla/billing/account');
  log('2ª init (com cupom): customerId =', carlaB2.customerId, '· discount =', carlaB2.recurringDiscountPercent);
  log('billing devolvido pela 2ª init =', JSON.stringify({
    recurringDiscountPercent: r2.body.billing.recurringDiscountPercent,
    referredByCode: r2.body.billing.referredByCode,
  }));
  check(carlaB2.recurringDiscountPercent === 10, 'EXPECTATIVA: 2ª init aplica o cupom retroativamente');

  // Carla assina
  await call(H.subscribe, { headers: { authorization: 'Bearer ' + carlaTok }, body: { cpfCnpj: '22233344455', name: 'Carla' } });
  const carlaB3 = store.docs.get('users/carla/billing/account');
  const carlaAsaasSub = asaasState.subscriptions.get(carlaB3.subscriptionId);
  log('valor da subscription Asaas da Carla =', carlaAsaasSub.value);
  check(carlaAsaasSub.value === 13.5, 'EXPECTATIVA: Asaas com value=13.50');

  // =====================================================================
  // CENÁRIO 3: o que o GATE da UI mostra
  // =====================================================================
  step(3, 'O QUE A UI MOSTRA — Bob, que tem cupom aplicado (cenário 1)');
  const me = await call(H.me, { method: 'GET', headers: { authorization: 'Bearer ' + bobTok } });
  log('me.recurringDiscountPercent      =', me.body.recurringDiscountPercent);
  log('me.monthlyPriceCents             =', me.body.monthlyPriceCents);
  log('me.subscriptionBaseValueCents    =', me.body.subscriptionBaseValueCents);
  log('');
  log('No appliquei-billing.js, o gate mostra strings hardcoded:');
  log("   linha 26:  '<strong>Valor:</strong> R$ 15,00 / mês'");
  log("   linha 76:  'Assinar agora (R$ 15/mês)'");
  log("   linha 105: 'Assinar com cartão (R$ 15/mês)'");
  log("   linha 111: 'Gerar fatura (R$ 15/mês)'");
  log('');
  log('Mesmo com recurringDiscountPercent=10 vindo do backend, esses textos');
  log('NÃO consultam o estado — sempre mostram R$ 15.');
  check(true, '(observação acima — não é assert)');

  // =====================================================================
  // RESUMO
  // =====================================================================
  console.log('\n\x1b[1m== RESUMO ==\x1b[0m');
  console.log('  Cenário 1 (novo usuário, cupom no 1º /init): desconto APLICADO no backend ✓');
  console.log('  Cenário 2 (usuário existente, cupom retroativo): ' + (pass >= 7 ? 'aplicado ✓' : '\x1b[31mFALHA — cupom IGNORADO\x1b[0m'));
  console.log('  Cenário 3 (display): UI mostra R$ 15 hardcoded mesmo com desconto válido no backend ✗');

  console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + '== ' + pass + ' ok, ' + fail + ' falha(s)\x1b[0m');
  process.exit(0); // exit 0 — este script é diagnóstico, não validação
}

main().catch(e => { console.error('FAIL:', e); process.exit(2); });
