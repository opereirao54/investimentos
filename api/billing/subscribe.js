const { db, fieldValue } = require('../_lib/firebase-admin');
const { requireVerifiedUser, cors } = require('../_lib/auth');
const asaas = require('../_lib/asaas');
const { assertReferralAllowed } = require('../_lib/referral-guard');

function formatDate(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

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

function cleanDigits(s) {
  return String(s || '').replace(/\D+/g, '');
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || null;
}

function brandFromNumber(n) {
  const d = String(n || '').replace(/\D+/g, '');
  if (/^4/.test(d)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'MASTERCARD';
  if (/^3[47]/.test(d)) return 'AMEX';
  if (/^(36|30[0-5]|3[89])/.test(d)) return 'DINERS';
  if (/^(6011|65|64[4-9])/.test(d)) return 'DISCOVER';
  if (/^(606282|3841)/.test(d)) return 'HIPERCARD';
  if (/^(4011|4312|4389|4514|4573|5041|5066|5067|6277|6363|6504|6505|6516|6550)/.test(d)) return 'ELO';
  return 'UNKNOWN';
}

function cardMetadataFromAsaas(sub, fallbackNumber) {
  const cc = (sub && sub.creditCard) || {};
  const masked = cc.creditCardNumber || '';
  const last4 = masked.replace(/\D+/g, '').slice(-4) || (fallbackNumber ? String(fallbackNumber).replace(/\D+/g, '').slice(-4) : null);
  return {
    cardBrand: cc.creditCardBrand || (fallbackNumber ? brandFromNumber(fallbackNumber) : null),
    cardLast4: last4 || null,
    cardToken: cc.creditCardToken || null,
  };
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireVerifiedUser(req, res);
  if (!user) return;

  const body = await readBody(req);
  const cpfCnpj = cleanDigits(body.cpfCnpj);
  const customerName = (body.name || '').trim();
  const rawCard = body.creditCard && typeof body.creditCard === 'object' ? body.creditCard : null;
  const rawHolder = body.creditCardHolderInfo && typeof body.creditCardHolderInfo === 'object' ? body.creditCardHolderInfo : null;
  const wantsCard = !!rawCard;

  try {
    const ref = db().collection('users').doc(user.uid).collection('billing').doc('account');
    const snap = await ref.get();
    if (!snap.exists || !snap.data().customerId) {
      return res.status(400).json({ error: 'billing_not_initialized' });
    }
    const billing = snap.data();

    if (!billing.cpfCnpj && !cpfCnpj) {
      return res.status(400).json({ error: 'cpfcnpj_required', detail: 'CPF ou CNPJ é obrigatório para emitir a fatura.' });
    }
    if (cpfCnpj && cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
      return res.status(400).json({ error: 'cpfcnpj_invalid', detail: 'CPF deve ter 11 dígitos ou CNPJ 14.' });
    }

    if (cpfCnpj && cpfCnpj !== billing.cpfCnpj) {
      // C4: o mesmo CPF/CNPJ não pode estar associado a múltiplos uids
      // (anti multi-conta para fraudar referral).
      let dupDocs = [];
      try {
        const dup = await db().collectionGroup('billing')
          .where('cpfCnpj', '==', cpfCnpj)
          .limit(5)
          .get();
        dupDocs = dup.docs;
      } catch (err) {
        console.warn('[subscribe] CPF uniqueness check skipped (missing index)', err.message);
      }

      const conflict = dupDocs.find(d => {
        const owner = d.ref.parent && d.ref.parent.parent;
        return owner && owner.id !== user.uid;
      });
      if (conflict) {
        return res.status(409).json({ error: 'cpfcnpj_in_use' });
      }

      // H3/L2: revalida referral com a política unificada. Agora que o CPF
      // chegou, o guard pode bloquear por CPF, device, IP ou INACTIVE do
      // indicador. Se o vínculo cair, o desconto e o crédito também.
      // Persiste o CPF em billing localmente para o guard ler.
      billing.cpfCnpj = cpfCnpj;
      if (billing.referredByUserId) {
        try {
          const guard = await assertReferralAllowed(db(), {
            indicatorUid: billing.referredByUserId,
            user: { uid: user.uid, cpfCnpj },
            req,
          });
          if (!guard.allowed) {
            await ref.set({
              referredByUserId: fieldValue().delete(),
              referredByCode: fieldValue().delete(),
              referralUsedAt: fieldValue().delete(),
              recurringDiscountPercent: 0,
              referralDroppedReason: guard.reason,
              updatedAt: fieldValue().serverTimestamp(),
            }, { merge: true });
            billing.referredByUserId = null;
            billing.referredByCode = null;
            billing.recurringDiscountPercent = 0;
            console.warn('[subscribe] referral dropped at subscribe', { uid: user.uid, reason: guard.reason });
          }
        } catch (e) {
          console.warn('[subscribe] referral revalidation failed', e && e.message);
        }
      }

      const fields = { cpfCnpj };
      if (customerName) fields.name = customerName;
      await asaas.updateCustomer(billing.customerId, fields);
      await ref.set({
        cpfCnpj,
        customerName: customerName || billing.customerName || null,
        updatedAt: fieldValue().serverTimestamp(),
      }, { merge: true });
    }

    if (billing.subscriptionId) {
      const payments = await asaas.listPaymentsBySubscription(billing.subscriptionId).catch(() => null);
      const pending = payments && payments.data && payments.data.find(p => p.status === 'PENDING' || p.status === 'OVERDUE');
      if (pending) {
        return res.json({
          subscriptionId: billing.subscriptionId,
          invoiceUrl: pending.invoiceUrl,
          status: pending.status,
        });
      }
      return res.json({ subscriptionId: billing.subscriptionId, alreadyActive: true });
    }

    const monthly = (billing.monthlyPriceCents || 1500) / 100;
    const pct = billing.recurringDiscountPercent || 0;
    const subscriptionValue = Math.round(monthly * (100 - pct)) / 100;

    const nextDue = formatDate(new Date(Date.now() + 24 * 3600 * 1000));
    const subPayload = {
      customerId: billing.customerId,
      uid: user.uid,
      nextDueDate: nextDue,
      value: subscriptionValue,
    };
    if (wantsCard) {
      subPayload.billingType = 'CREDIT_CARD';
      subPayload.creditCard = rawCard;
      subPayload.creditCardHolderInfo = rawHolder || {
        name: customerName || billing.customerName || user.email,
        email: user.email,
        cpfCnpj: cpfCnpj || billing.cpfCnpj,
        postalCode: (rawHolder && rawHolder.postalCode) || null,
        addressNumber: (rawHolder && rawHolder.addressNumber) || null,
        phone: (rawHolder && rawHolder.phone) || null,
      };
      subPayload.remoteIp = clientIp(req);
    }
    const sub = await asaas.createSubscription(subPayload);

    const billingUpdate = {
      subscriptionId: sub.id,
      subscriptionStatus: sub.status || 'ACTIVE',
      subscriptionBaseValueCents: Math.round(subscriptionValue * 100),
      paymentMethod: wantsCard ? 'CREDIT_CARD' : 'UNDEFINED',
      updatedAt: fieldValue().serverTimestamp(),
    };
    if (wantsCard) {
      const meta = cardMetadataFromAsaas(sub, rawCard.number);
      billingUpdate.cardBrand = meta.cardBrand;
      billingUpdate.cardLast4 = meta.cardLast4;
      if (meta.cardToken) billingUpdate.cardToken = meta.cardToken;
      billingUpdate.cardHolderName = (rawCard.holderName || '').trim() || null;
    }
    await ref.set(billingUpdate, { merge: true });

    let invoiceUrl = null;
    let firstPaymentStatus = null;
    try {
      const payments = await asaas.listPaymentsBySubscription(sub.id);
      const first = payments && payments.data && payments.data[0];
      if (first) {
        invoiceUrl = first.invoiceUrl;
        firstPaymentStatus = first.status;
      }
    } catch (_) {}

    return res.json({
      subscriptionId: sub.id,
      invoiceUrl,
      status: sub.status,
      paymentMethod: billingUpdate.paymentMethod,
      cardLast4: billingUpdate.cardLast4 || null,
      cardBrand: billingUpdate.cardBrand || null,
      firstPaymentStatus,
    });
  } catch (e) {
    console.error('[subscribe]', e, e.data);
    return res.status(500).json({
      error: 'subscribe_failed',
      detail: e.message,
      asaasStatus: e.status || null,
      asaasErrors: (e.data && e.data.errors) || e.data || null,
    });
  }
};
