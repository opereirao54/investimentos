const { db, fieldValue, timestamp } = require('../_lib/firebase-admin');
const { requireVerifiedUser, cors } = require('../_lib/auth');
const asaas = require('../_lib/asaas');
const { isValidCpfCnpj } = require('../_lib/cpf-cnpj');

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

    // Lock contra clique duplo. Reusa a estrutura do /subscribe (subscribeLock)
    // — só pode haver uma operação de cobrança em curso por uid de cada vez,
    // independente de avulso ou assinatura.
    const PAY_LOCK_TTL_MS = 60 * 1000;
    const claim = await db().runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const ex = s.exists ? s.data() : null;
      const lockedAtMs = ex && ex.subscribeLockAt && typeof ex.subscribeLockAt.toMillis === 'function'
        ? ex.subscribeLockAt.toMillis()
        : 0;
      if (ex && ex.subscribeLock && (Date.now() - lockedAtMs) < PAY_LOCK_TTL_MS) {
        return { state: 'locked' };
      }
      tx.set(ref, {
        subscribeLock: true,
        subscribeLockAt: timestamp().fromMillis(Date.now()),
      }, { merge: true });
      return { state: 'acquired' };
    });
    if (claim.state === 'locked') {
      return res.status(409).json({
        error: 'pay_in_progress',
        detail: 'Pagamento em andamento, tente novamente em instantes.',
      });
    }

    let lockReleased = false;
    const releaseLock = async () => {
      if (lockReleased) return;
      lockReleased = true;
      try {
        await ref.set({
          subscribeLock: fieldValue().delete(),
          subscribeLockAt: fieldValue().delete(),
        }, { merge: true });
      } catch (e) {
        console.warn('[pay-month] failed to release lock', e && e.message);
      }
    };

    const billing = snap.data();

    // Bloqueia avulso se já existe assinatura ativa — evita o usuário
    // pagar duplicado (recorrente + avulso). Para mudar de modo, ele
    // primeiro cancela a assinatura via /api/billing/cancel.
    if (billing.subscriptionId && billing.subscriptionStatus && billing.subscriptionStatus !== 'INACTIVE') {
      await releaseLock();
      return res.status(409).json({
        error: 'subscription_active',
        detail: 'Já existe uma assinatura recorrente ativa. Cancele-a antes de optar pelo pagamento avulso.',
      });
    }

    if (!billing.cpfCnpj && !cpfCnpj) {
      await releaseLock();
      return res.status(400).json({ error: 'cpfcnpj_required', detail: 'CPF ou CNPJ é obrigatório para emitir a fatura.' });
    }
    if (cpfCnpj && cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
      await releaseLock();
      return res.status(400).json({ error: 'cpfcnpj_invalid', detail: 'CPF deve ter 11 dígitos ou CNPJ 14.' });
    }
    if (cpfCnpj && !isValidCpfCnpj(cpfCnpj)) {
      await releaseLock();
      return res.status(400).json({ error: 'cpfcnpj_invalid', detail: 'Os dígitos verificadores não conferem.' });
    }

    // Espelha o customer no Asaas com CPF/nome se mudaram (mesmo bloco do
    // /subscribe). Bloqueia CPF duplicado entre uids.
    if (cpfCnpj && cpfCnpj !== billing.cpfCnpj) {
      let dupDocs = [];
      try {
        const dup = await db().collectionGroup('billing')
          .where('cpfCnpj', '==', cpfCnpj)
          .limit(5)
          .get();
        dupDocs = dup.docs;
      } catch (err) {
        console.warn('[pay-month] CPF uniqueness check skipped (missing index)', err.message);
      }
      const conflict = dupDocs.find(d => {
        const owner = d.ref.parent && d.ref.parent.parent;
        return owner && owner.id !== user.uid;
      });
      if (conflict) {
        await releaseLock();
        return res.status(409).json({ error: 'cpfcnpj_in_use' });
      }
      const fields = { cpfCnpj };
      if (customerName) fields.name = customerName;
      await asaas.updateCustomer(billing.customerId, fields);
      await ref.set({
        cpfCnpj,
        customerName: customerName || billing.customerName || null,
        updatedAt: fieldValue().serverTimestamp(),
      }, { merge: true });
      billing.cpfCnpj = cpfCnpj;
    }

    // Valor com desconto recorrente (cupom) — mesma fórmula da subscription
    // para manter consistência. O desconto de créditos pendentes (Applicash)
    // é aplicado depois pelo webhook PAYMENT_CREATED via applyPendingCreditsTo.
    const monthly = (billing.monthlyPriceCents || 1500) / 100;
    const pct = billing.recurringDiscountPercent || 0;
    const value = Math.round(monthly * (100 - pct)) / 100;
    const dueDate = formatDate(new Date(Date.now() + 24 * 3600 * 1000));

    const payload = {
      customerId: billing.customerId,
      value,
      dueDate,
      externalReference: user.uid,
      description: 'Appliquei — 1 mês de acesso',
      billingType: wantsCard ? 'CREDIT_CARD' : 'UNDEFINED',
    };
    if (wantsCard) {
      payload.creditCard = rawCard;
      payload.creditCardHolderInfo = rawHolder || {
        name: customerName || billing.customerName || user.email,
        email: user.email,
        cpfCnpj: cpfCnpj || billing.cpfCnpj,
        postalCode: (rawHolder && rawHolder.postalCode) || null,
        addressNumber: (rawHolder && rawHolder.addressNumber) || null,
        phone: (rawHolder && rawHolder.phone) || null,
      };
      payload.remoteIp = clientIp(req);
    }

    let pay;
    try {
      pay = await asaas.createPayment(payload);
    } catch (e) {
      await releaseLock();
      console.error('[pay-month] createPayment failed', e, e.data);
      return res.status(e.status || 500).json({
        error: 'pay_failed',
        detail: e.message,
        asaasStatus: e.status || null,
        asaasErrors: (e.data && e.data.errors) || e.data || null,
      });
    }

    // Marca o billing como modo avulso. O webhook PAYMENT_CONFIRMED vai
    // limpar trialEndsAt e setar lastPaidAt — o paid_period em computeAccess
    // garante 30 dias de acesso a partir daí, sem precisar de subscriptionId.
    await ref.set({
      paymentMode: 'one_shot',
      lastOneShotPaymentId: pay.id,
      paymentMethod: wantsCard ? 'CREDIT_CARD' : 'UNDEFINED',
      updatedAt: fieldValue().serverTimestamp(),
      subscribeLock: fieldValue().delete(),
      subscribeLockAt: fieldValue().delete(),
    }, { merge: true });
    lockReleased = true;

    return res.json({
      paymentId: pay.id,
      invoiceUrl: pay.invoiceUrl || null,
      bankSlipUrl: pay.bankSlipUrl || null,
      status: pay.status || null,
      value: pay.value || null,
      dueDate: pay.dueDate || dueDate,
      paymentMethod: payload.billingType,
    });
  } catch (e) {
    console.error('[pay-month]', e, e.data);
    try {
      const ref = db().collection('users').doc(user.uid).collection('billing').doc('account');
      await ref.set({
        subscribeLock: fieldValue().delete(),
        subscribeLockAt: fieldValue().delete(),
      }, { merge: true });
    } catch (_) {}
    return res.status(500).json({
      error: 'pay_failed',
      detail: e.message,
      asaasStatus: e.status || null,
      asaasErrors: (e.data && e.data.errors) || e.data || null,
    });
  }
};
