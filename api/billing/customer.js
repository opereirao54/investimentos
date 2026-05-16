const { db, fieldValue } = require('../_lib/firebase-admin');
const { requireVerifiedUser, cors } = require('../_lib/auth');
const asaas = require('../_lib/asaas');

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

function clean(s) { return typeof s === 'string' ? s.trim() : s; }
function digits(s) { return String(s || '').replace(/\D+/g, ''); }

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireVerifiedUser(req, res);
  if (!user) return;

  const body = await readBody(req);
  const name = clean(body.name);
  const email = clean(body.email);
  const cpfCnpj = digits(body.cpfCnpj);
  const mobilePhone = digits(body.mobilePhone || body.phone);
  const postalCode = digits(body.postalCode);
  const address = clean(body.address);
  const addressNumber = clean(body.addressNumber);
  const complement = clean(body.complement);
  const province = clean(body.province);
  const city = clean(body.city);
  const state = clean(body.state);

  if (cpfCnpj && cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    return res.status(400).json({ error: 'cpfcnpj_invalid' });
  }
  if (postalCode && postalCode.length !== 8) {
    return res.status(400).json({ error: 'postalcode_invalid' });
  }
  if (name !== undefined && name !== null && name.length > 0 && name.length < 3) {
    return res.status(400).json({ error: 'name_invalid' });
  }

  try {
    const ref = db().collection('users').doc(user.uid).collection('billing').doc('account');
    const snap = await ref.get();
    if (!snap.exists) return res.status(400).json({ error: 'billing_not_initialized' });
    const billing = snap.data();
    if (!billing.customerId) return res.status(400).json({ error: 'no_customer' });

    // Anti-fraude: o mesmo CPF/CNPJ não pode estar associado a múltiplos uids.
    if (cpfCnpj && cpfCnpj !== billing.cpfCnpj) {
      const dup = await db().collectionGroup('billing')
        .where('cpfCnpj', '==', cpfCnpj)
        .limit(5)
        .get();
      const conflict = dup.docs.find(d => {
        const owner = d.ref.parent && d.ref.parent.parent;
        return owner && owner.id !== user.uid;
      });
      if (conflict) {
        return res.status(409).json({ error: 'cpfcnpj_in_use' });
      }
    }

    const asaasFields = {};
    if (name) asaasFields.name = name;
    if (email) asaasFields.email = email;
    if (cpfCnpj) asaasFields.cpfCnpj = cpfCnpj;
    if (mobilePhone) asaasFields.mobilePhone = mobilePhone;
    if (postalCode) asaasFields.postalCode = postalCode;
    if (address) asaasFields.address = address;
    if (addressNumber) asaasFields.addressNumber = addressNumber;
    if (complement) asaasFields.complement = complement;
    if (province) asaasFields.province = province;
    if (city) asaasFields.city = city;
    if (state) asaasFields.state = state;

    if (Object.keys(asaasFields).length === 0) {
      return res.status(400).json({ error: 'nothing_to_update' });
    }

    await asaas.updateCustomer(billing.customerId, asaasFields);

    const localUpdate = { updatedAt: fieldValue().serverTimestamp() };
    if (name) localUpdate.customerName = name;
    if (email) localUpdate.customerEmail = email;
    if (cpfCnpj) localUpdate.cpfCnpj = cpfCnpj;
    if (mobilePhone) localUpdate.customerPhone = mobilePhone;
    if (postalCode) localUpdate.customerPostalCode = postalCode;
    if (address) localUpdate.customerAddress = address;
    if (addressNumber) localUpdate.customerAddressNumber = addressNumber;
    if (complement) localUpdate.customerComplement = complement;
    if (province) localUpdate.customerProvince = province;
    if (city) localUpdate.customerCity = city;
    if (state) localUpdate.customerState = state;
    await ref.set(localUpdate, { merge: true });

    return res.json({ ok: true, customer: asaasFields });
  } catch (e) {
    console.error('[customer]', e, e.data);
    return res.status(e.status || 500).json({
      error: 'customer_update_failed',
      detail: e.message,
      asaasErrors: (e.data && e.data.errors) || e.data || null,
    });
  }
};
