const { db, fieldValue, timestamp } = require('../_lib/firebase-admin');
const { requireUser, cors } = require('../_lib/auth');
const asaas = require('../_lib/asaas');
const { computeAccess, TRIAL_DAYS } = require('../_lib/access');
const { syncBillingFromAsaas } = require('../_lib/billing-sync');
const codes = require('../_lib/codes');

const MONTHLY_PRICE_CENTS = 1500;
const REFERRAL_DISCOUNT_PERCENT = 10;

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function signupIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || null;
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const body = await readBody(req);
  const rawCode = body.referralCode ? codes.normalize(body.referralCode) : null;

  try {
    const D = db();
    const ref = D.collection('users').doc(user.uid).collection('billing').doc('account');

    // A3: lock transacional contra inicializações concorrentes do mesmo uid
    // (duas abas / app+web simultâneo). Evita criar dois customers no Asaas.
    const LOCK_TTL_MS = 30000;
    const claim = await D.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const ex = s.exists ? s.data() : null;
      if (ex && ex.customerId) return { state: 'has_customer', existing: ex };
      const lockedAtMs = ex && ex.initLockAt && typeof ex.initLockAt.toMillis === 'function'
        ? ex.initLockAt.toMillis()
        : 0;
      if (ex && ex.initLock && (Date.now() - lockedAtMs) < LOCK_TTL_MS) {
        return { state: 'locked' };
      }
      tx.set(ref, {
        initLock: true,
        initLockAt: timestamp().fromMillis(Date.now()),
      }, { merge: true });
      return { state: 'acquired', existing: ex };
    });

    if (claim.state === 'locked') {
      return res.status(409).json({ error: 'init_in_progress', detail: 'Inicialização em andamento, tente novamente em instantes.' });
    }

    if (claim.state === 'has_customer') {
      const existing = claim.existing;
      let billingNow = existing;

      // Bug #1 fix: aplicar cupom retroativo se o usuário ainda não criou
      // a subscription no Asaas (ou seja, ainda não pagou nenhuma fatura
      // recorrente). Cobre os casos:
      //   - Usuário já estava logado e só agora clicou no link de indicação
      //   - Usuário criou conta sem cupom e depois recebeu o link
      // Após /subscribe (subscriptionId existe), o cupom não pode mais ser
      // aplicado retroativamente porque a recorrência no Asaas já foi
      // criada com valor fixo. Também recusa se já há referral vinculado
      // (não permite trocar de cupom).
      if (rawCode && !existing.subscriptionId && !existing.referredByUserId) {
        if (!codes.isValid(rawCode)) {
          return res.status(400).json({ error: 'invalid_referral_code' });
        }
        const owner = await codes.lookupOwner(D, rawCode);
        if (!owner) {
          return res.status(400).json({ error: 'referral_code_not_found' });
        }
        if (owner.uid === user.uid) {
          return res.status(400).json({ error: 'self_referral_not_allowed' });
        }
        await ref.set({
          referredByUserId: owner.uid,
          referredByCode: owner.code,
          referralUsedAt: timestamp().fromMillis(Date.now()),
          recurringDiscountPercent: REFERRAL_DISCOUNT_PERCENT,
          updatedAt: fieldValue().serverTimestamp(),
        }, { merge: true });
        const reread = await ref.get();
        billingNow = reread.data();
      }

      const synced = await syncBillingFromAsaas(ref, billingNow);
      return res.json({ access: computeAccess(synced.billing), billing: safeBilling(synced.billing) });
    }

    const existing = claim.existing;
    let releasedOnError = false;
    const releaseLock = async () => {
      if (releasedOnError) return;
      releasedOnError = true;
      try {
        await ref.set({
          initLock: fieldValue().delete(),
          initLockAt: fieldValue().delete(),
        }, { merge: true });
      } catch (_) {}
    };

    try {
      let referredByUserId = null;
      let referredByCode = null;
      let discountPercent = (existing && existing.recurringDiscountPercent) || 0;

      if (rawCode && !(existing && existing.referredByUserId)) {
        if (!codes.isValid(rawCode)) {
          await releaseLock();
          return res.status(400).json({ error: 'invalid_referral_code' });
        }
        const owner = await codes.lookupOwner(D, rawCode);
        if (!owner) {
          await releaseLock();
          return res.status(400).json({ error: 'referral_code_not_found' });
        }
        if (owner.uid === user.uid) {
          await releaseLock();
          return res.status(400).json({ error: 'self_referral_not_allowed' });
        }
        referredByUserId = owner.uid;
        referredByCode = owner.code;
        discountPercent = REFERRAL_DISCOUNT_PERCENT;
      }

      const ownCode = (existing && existing.referralCode)
        ? existing.referralCode
        : await codes.reserveUniqueCode(D, user.uid, timestamp());

      const customer = await asaas.createCustomer({
        email: user.email,
        name: user.name || user.email,
        uid: user.uid,
      });

      const now = Date.now();
      const trialEnd = now + TRIAL_DAYS * 86400000;

      // M6: rastreabilidade de signup (IP + UA). Preserva os valores
      // originais se já existirem — só grava na primeira criação.
      const ip = signupIp(req);
      const ua = (req.headers['user-agent'] || '').slice(0, 256) || null;

      const data = {
        uid: user.uid,
        email: user.email || null,
        customerId: customer.id,
        createdAt: (existing && existing.createdAt) || timestamp().fromMillis(now),
        trialStartsAt: timestamp().fromMillis(now),
        trialEndsAt: timestamp().fromMillis(trialEnd),
        subscriptionId: null,
        subscriptionStatus: null,
        lastPaymentStatus: null,
        lastPaymentId: null,
        referralCode: ownCode,
        monthlyPriceCents: MONTHLY_PRICE_CENTS,
        recurringDiscountPercent: discountPercent,
        signupIp: (existing && existing.signupIp) || ip,
        signupUserAgent: (existing && existing.signupUserAgent) || ua,
        updatedAt: fieldValue().serverTimestamp(),
        initLock: fieldValue().delete(),
        initLockAt: fieldValue().delete(),
      };
      if (referredByUserId) {
        data.referredByUserId = referredByUserId;
        data.referredByCode = referredByCode;
        data.referralUsedAt = timestamp().fromMillis(now);
      }
      await ref.set(data, { merge: true });
      releasedOnError = true; // lock já saiu junto com o set acima

      return res.json({ access: computeAccess(data), billing: safeBilling(data) });
    } catch (innerErr) {
      await releaseLock();
      throw innerErr;
    }
  } catch (e) {
    console.error('[init]', e, e.data);
    return res.status(500).json({
      error: 'init_failed',
      detail: e.message,
      asaasStatus: e.status || null,
      asaasErrors: (e.data && e.data.errors) || e.data || null,
    });
  }
};

function safeBilling(b) {
  return {
    customerId: b.customerId || null,
    subscriptionId: b.subscriptionId || null,
    subscriptionStatus: b.subscriptionStatus || null,
    lastPaymentStatus: b.lastPaymentStatus || null,
    trialEndsAt: tsToIso(b.trialEndsAt),
    createdAt: tsToIso(b.createdAt),
    referralCode: b.referralCode || null,
    referredByCode: b.referredByCode || null,
    recurringDiscountPercent: b.recurringDiscountPercent || 0,
    monthlyPriceCents: b.monthlyPriceCents || MONTHLY_PRICE_CENTS,
  };
}
function tsToIso(t) {
  if (!t) return null;
  if (typeof t.toDate === 'function') return t.toDate().toISOString();
  if (typeof t === 'number') return new Date(t).toISOString();
  return null;
}
