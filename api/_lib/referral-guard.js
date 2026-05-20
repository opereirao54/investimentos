const { deviceFingerprint, ipFrom } = require('./rate-limit');

// Política unificada de aceitação de referral. Chamada em /init (criação
// e retro-apply) e em /subscribe (revalidação quando o CPF chega).
//
// Bloqueia se:
//  - mesma uid (self-referral direto);
//  - mesmo signupDevice do indicador (mesmo browser);
//  - mesmo signupIp do indicador (com check de exata igualdade — NAT pode
//    causar falso positivo, então é gated por env REFERRAL_BLOCK_SAME_IP);
//  - mesmo cpfCnpj (quando ambos os lados já têm cpfCnpj registrado);
//  - indicador está com `subscriptionStatus === 'INACTIVE'` (conta
//    cancelada não pode mais distribuir cupom).
//
// Retorna { allowed, reason } — reason mapeia para mensagens já em uso:
//  'self_referral_not_allowed', 'referral_code_not_found'.
async function assertReferralAllowed(D, opts) {
  const { indicatorUid, user, req } = opts;
  if (!indicatorUid || !user || !user.uid) return { allowed: false, reason: 'self_referral_not_allowed' };
  if (indicatorUid === user.uid) return { allowed: false, reason: 'self_referral_not_allowed' };

  let indicatorBilling = null;
  try {
    const snap = await D.collection('users').doc(indicatorUid).collection('billing').doc('account').get();
    if (snap.exists) indicatorBilling = snap.data();
  } catch (e) {
    console.warn('[referral-guard] indicator read failed', indicatorUid, e && e.message);
  }
  if (!indicatorBilling) return { allowed: false, reason: 'referral_code_not_found' };

  // L2: indicador com subscription INACTIVE não pode mais convidar.
  if (indicatorBilling.subscriptionStatus === 'INACTIVE') {
    return { allowed: false, reason: 'referral_code_not_found' };
  }

  // H2: mesmo browser. Usa o fingerprint do request atual contra o
  // signupDevice gravado do indicador.
  if (req) {
    const myDevice = deviceFingerprint(req);
    if (myDevice && indicatorBilling.signupDevice && indicatorBilling.signupDevice === myDevice) {
      console.warn('[referral-guard] same device', { uid: user.uid, indicatorUid });
      return { allowed: false, reason: 'self_referral_not_allowed' };
    }

    if (String(process.env.REFERRAL_BLOCK_SAME_IP || '').toLowerCase() === 'true') {
      const myIp = ipFrom(req);
      if (myIp && indicatorBilling.signupIp && indicatorBilling.signupIp === myIp) {
        console.warn('[referral-guard] same ip', { uid: user.uid, indicatorUid });
        return { allowed: false, reason: 'self_referral_not_allowed' };
      }
    }
  }

  // H3: mesmo CPF (quando disponível dos dois lados). Aceita cpfCnpj
  // injetado direto (caso /subscribe que ainda nao gravou) ou lê do
  // billing do user.
  let userCpf = user.cpfCnpj || null;
  if (!userCpf) {
    try {
      const snap = await D.collection('users').doc(user.uid).collection('billing').doc('account').get();
      if (snap.exists) userCpf = snap.data().cpfCnpj || null;
    } catch (_) {}
  }
  const indicatorCpf = indicatorBilling.cpfCnpj;
  if (userCpf && indicatorCpf && userCpf === indicatorCpf) {
    return { allowed: false, reason: 'self_referral_not_allowed' };
  }

  return { allowed: true };
}

module.exports = { assertReferralAllowed };
