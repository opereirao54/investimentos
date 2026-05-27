const { db, fieldValue } = require('../_lib/firebase-admin');
const { handler } = require('../_lib/handler');
const { billingCustomerBody } = require('../_lib/schemas');
const asaas = require('../_lib/asaas');

function digits(s) {
  return String(s || '').replace(/\D+/g, '');
}

module.exports = handler({
  method: 'POST',
  auth: 'verified',
  bodySchema: billingCustomerBody,
  handle: async ({ res, user, body }) => {
    // Schema valida formato; normalizamos cpfCnpj/phone/cep para só dígitos
    // (Asaas armazena assim).
    const cpfCnpj = body.cpfCnpj ? digits(body.cpfCnpj) : null;
    const mobilePhone = digits(body.mobilePhone || body.phone || '');
    const postalCode = digits(body.postalCode || '');

    const ref = db().collection('users').doc(user.uid).collection('billing').doc('account');
    const snap = await ref.get();
    if (!snap.exists) return res.status(400).json({ error: 'billing_not_initialized' });
    const billing = snap.data();
    if (!billing.customerId) return res.status(400).json({ error: 'no_customer' });

    // Anti-fraude: o mesmo CPF/CNPJ não pode estar associado a múltiplos uids.
    if (cpfCnpj && cpfCnpj !== billing.cpfCnpj) {
      const dup = await db()
        .collectionGroup('billing')
        .where('cpfCnpj', '==', cpfCnpj)
        .limit(5)
        .get();
      const conflict = dup.docs.find((d) => {
        const owner = d.ref.parent && d.ref.parent.parent;
        return owner && owner.id !== user.uid;
      });
      if (conflict) {
        return res.status(409).json({ error: 'cpfcnpj_in_use' });
      }
    }

    const asaasFields = {};
    if (body.name) asaasFields.name = body.name;
    if (body.email) asaasFields.email = body.email;
    if (cpfCnpj) asaasFields.cpfCnpj = cpfCnpj;
    if (mobilePhone) asaasFields.mobilePhone = mobilePhone;
    if (postalCode) asaasFields.postalCode = postalCode;
    if (body.address) asaasFields.address = body.address;
    if (body.addressNumber) asaasFields.addressNumber = body.addressNumber;
    if (body.complement) asaasFields.complement = body.complement;
    if (body.province) asaasFields.province = body.province;
    if (body.city) asaasFields.city = body.city;
    if (body.state) asaasFields.state = body.state;

    if (Object.keys(asaasFields).length === 0) {
      return res.status(400).json({ error: 'nothing_to_update' });
    }

    try {
      await asaas.updateCustomer(billing.customerId, asaasFields);
    } catch (e) {
      console.error('[customer]', e, e.data);
      return res.status(e.status || 500).json({
        error: 'customer_update_failed',
        detail: e.message,
        asaasErrors: (e.data && e.data.errors) || e.data || null,
      });
    }

    const localUpdate = { updatedAt: fieldValue().serverTimestamp() };
    if (body.name) localUpdate.customerName = body.name;
    if (body.email) localUpdate.customerEmail = body.email;
    if (cpfCnpj) localUpdate.cpfCnpj = cpfCnpj;
    if (mobilePhone) localUpdate.customerPhone = mobilePhone;
    if (postalCode) localUpdate.customerPostalCode = postalCode;
    if (body.address) localUpdate.customerAddress = body.address;
    if (body.addressNumber) localUpdate.customerAddressNumber = body.addressNumber;
    if (body.complement) localUpdate.customerComplement = body.complement;
    if (body.province) localUpdate.customerProvince = body.province;
    if (body.city) localUpdate.customerCity = body.city;
    if (body.state) localUpdate.customerState = body.state;
    await ref.set(localUpdate, { merge: true });

    return res.json({ ok: true, customer: asaasFields });
  },
});
