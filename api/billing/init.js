const { db, fieldValue, timestamp } = require('../_lib/firebase-admin');
const { requireVerifiedUser, cors } = require('../_lib/auth');
const asaas = require('../_lib/asaas');
const { computeAccess, TRIAL_DAYS } = require('../_lib/access');
const { syncBillingFromAsaas } = require('../_lib/billing-sync');
const codes = require('../_lib/codes');
const rl = require('../_lib/rate-limit');
const { assertReferralAllowed } = require('../_lib/referral-guard');

const MONTHLY_PRICE_CENTS = 1500;
const REFERRAL_DISCOUNT_PERCENT = 10;

// Antifraude: limites de criação de billing por IP/device. Conservador para
// não punir famílias compartilhando IP (NAT). Pode ser endurecido depois.
const TRIAL_RATE_LIMIT_IP_WINDOW_MS = 24 * 60 * 60 * 1000;
const TRIAL_RATE_LIMIT_IP_MAX = 5;
const TRIAL_RATE_LIMIT_DEVICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TRIAL_RATE_LIMIT_DEVICE_MAX = 3;

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

  const user = await requireVerifiedUser(req, res);
  if (!user) return;

  // M9: providers OAuth podem não retornar email se o escopo não foi pedido
  // ou o user negou. Sem email, Asaas.createCustomer falha (400). Falha
  // cedo com mensagem clara.
  if (!user.email) {
    return res.status(400).json({
      error: 'email_required_from_provider',
      detail: 'Não foi possível obter o e-mail da sua conta. Faça login novamente concedendo permissão de e-mail.',
    });
  }

  const body = await readBody(req);
  // M1: rejeita tipos inválidos antes de normalizar. codes.normalize já
  // tem guard, mas falhar cedo com erro estruturado é mais claro.
  let rawCode = null;
  if (body.referralCode != null) {
    if (typeof body.referralCode !== 'string') {
      return res.status(400).json({ error: 'invalid_referral_code' });
    }
    rawCode = codes.normalize(body.referralCode) || null;
  }

  try {
    const D = db();
    const ref = D.collection('users').doc(user.uid).collection('billing').doc('account');

    // Antifraude:
    //  - Primeira criação de billing: rate-limit por IP+device (TRIAL_RATE_LIMIT_*).
    //  - Retro-apply de cupom (billing já existe, ainda sem referredByUserId
    //    e com rawCode informado): rate-limit menor, escopo separado
    //    'init-retroref-*'. Evita usar uma conta legítima como sonda de
    //    enumeração de cupons.
    const preSnap = await ref.get();
    const isFirstInit = !preSnap.exists;
    const isRetroRefAttempt = !isFirstInit && !!rawCode && !(preSnap.data() && preSnap.data().referredByUserId);
    if (isFirstInit || isRetroRefAttempt) {
      const ip = signupIp(req) || 'unknown';
      const device = rl.deviceFingerprint(req);
      const antifraudEnabled = String(process.env.ANTIFRAUD_INIT_ENABLED || '').toLowerCase() === 'true';
      const scopePrefix = isFirstInit ? 'init' : 'init-retroref';
      const windowIp = isFirstInit ? TRIAL_RATE_LIMIT_IP_WINDOW_MS : 60 * 60 * 1000;
      const maxIp = isFirstInit ? TRIAL_RATE_LIMIT_IP_MAX : 10;
      const windowDev = isFirstInit ? TRIAL_RATE_LIMIT_DEVICE_WINDOW_MS : 60 * 60 * 1000;
      const maxDev = isFirstInit ? TRIAL_RATE_LIMIT_DEVICE_MAX : 10;
      const ipCheck = await rl.check({
        scope: scopePrefix + '-ip', key: ip,
        windowMs: windowIp, max: maxIp,
      });
      const devCheck = await rl.check({
        scope: scopePrefix + '-device', key: device,
        windowMs: windowDev, max: maxDev,
      });
      if (!ipCheck.allowed || !devCheck.allowed) {
        console.warn('[init] rate-limit hit', {
          scope: scopePrefix, uid: user.uid, ip, device,
          ipCount: ipCheck.count, devCount: devCheck.count,
          enforced: antifraudEnabled,
        });
        if (antifraudEnabled) {
          const retry = Math.max(ipCheck.retryAfterMs || 0, devCheck.retryAfterMs || 0);
          res.setHeader('Retry-After', Math.ceil(retry / 1000));
          return res.status(429).json({
            error: isFirstInit ? 'too_many_trials' : 'too_many_referral_attempts',
            detail: isFirstInit
              ? 'Muitas contas criadas a partir deste dispositivo/IP recentemente. Tente novamente mais tarde ou entre em contato com o suporte.'
              : 'Muitas tentativas de aplicar cupom recentemente. Tente novamente em alguns minutos.',
          });
        }
      }
    }

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

      // Self-heal: se billing.referralCode aponta para um doc que não existe
      // mais em referralCodes/ (estado órfão herdado de versões antigas ou
      // edição manual), recria a reserva. Sem isto, ninguém consegue usar
      // o cupom deste utilizador — `lookupOwner` devolve null e o /init de
      // quem tenta usar bate referral_code_not_found.
      if (existing.referralCode && codes.isValid(existing.referralCode)) {
        try {
          await codes.ensureReserved(D, existing.referralCode, user.uid, timestamp());
        } catch (e) {
          console.warn('[init] self-heal referralCodes failed', e.message || e);
        }
      }

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
        // H2/H3/L2: política unificada (self-referral por uid/device/IP/CPF
        // e indicador INACTIVE).
        const guard = await assertReferralAllowed(D, { indicatorUid: owner.uid, user, req });
        if (!guard.allowed) {
          return res.status(400).json({ error: guard.reason });
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
        // H2/H3/L2: política unificada (self-referral por uid/device/IP/CPF
        // e indicador INACTIVE).
        const guard = await assertReferralAllowed(D, { indicatorUid: owner.uid, user, req });
        if (!guard.allowed) {
          await releaseLock();
          return res.status(400).json({ error: guard.reason });
        }
        referredByUserId = owner.uid;
        referredByCode = owner.code;
        discountPercent = REFERRAL_DISCOUNT_PERCENT;
      }

      let ownCode;
      if (existing && existing.referralCode) {
        ownCode = existing.referralCode;
        // Self-heal: re-cria a reserva se sumiu (mesma razão do bloco
        // has_customer acima).
        if (codes.isValid(ownCode)) {
          try { await codes.ensureReserved(D, ownCode, user.uid, timestamp()); }
          catch (e) { console.warn('[init] self-heal referralCodes failed', e.message || e); }
        }
      } else {
        ownCode = await codes.reserveUniqueCode(D, user.uid, timestamp());
      }

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
      const deviceHash = rl.deviceFingerprint(req);

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
        signupDevice: (existing && existing.signupDevice) || deviceHash,
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
