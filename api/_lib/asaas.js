const DEFAULT_URL = 'https://api.asaas.com/v3';

function baseUrl() {
  let u = process.env.ASAAS_API_URL || DEFAULT_URL;
  u = String(u).trim().replace(/^[\s"'`<\[]+|[\s"'`>\]]+$/g, '').replace(/\/$/, '');
  if (!/^https?:\/\//i.test(u)) {
    throw new Error('ASAAS_API_URL inválida (recebida: "' + u + '"). Use https://api.asaas.com/v3 ou https://sandbox.asaas.com/api/v3.');
  }
  return u;
}

function apiKey() {
  const k = process.env.ASAAS_API_KEY;
  if (!k) throw new Error('ASAAS_API_KEY não definida.');
  return String(k).trim().replace(/^[\s"'`<\[]+|[\s"'`>\]]+$/g, '');
}

async function call(method, path, body) {
  const r = await fetch(baseUrl() + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'access_token': apiKey(),
      'User-Agent': 'Appliquei/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!r.ok) {
    const err = new Error('asaas_error_' + r.status);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

const PLAN_VALUE = 15.0;
const PLAN_CYCLE = 'MONTHLY';
const PLAN_DESCRIPTION = 'Appliquei — Acesso mensal';

async function createCustomer({ name, email, uid, cpfCnpj }) {
  const body = {
    name: name || email,
    email,
    externalReference: uid,
    notificationDisabled: false,
  };
  if (cpfCnpj) body.cpfCnpj = cpfCnpj;
  return call('POST', '/customers', body);
}

async function updateCustomer(customerId, fields) {
  return call('POST', '/customers/' + encodeURIComponent(customerId), fields);
}

async function createSubscription({ customerId, uid, nextDueDate, value, billingType, creditCard, creditCardHolderInfo, remoteIp }) {
  const body = {
    customer: customerId,
    billingType: billingType || 'UNDEFINED',
    value: typeof value === 'number' ? value : PLAN_VALUE,
    cycle: PLAN_CYCLE,
    description: PLAN_DESCRIPTION,
    nextDueDate,
    externalReference: uid,
  };
  if (creditCard) body.creditCard = creditCard;
  if (creditCardHolderInfo) body.creditCardHolderInfo = creditCardHolderInfo;
  if (remoteIp) body.remoteIp = remoteIp;
  return call('POST', '/subscriptions', body);
}

async function updateSubscription(subscriptionId, fields) {
  return call('POST', '/subscriptions/' + encodeURIComponent(subscriptionId), fields);
}

async function updateSubscriptionCard(subscriptionId, { creditCard, creditCardHolderInfo, remoteIp, updatePendingPayments }) {
  const body = { creditCard, creditCardHolderInfo };
  if (remoteIp) body.remoteIp = remoteIp;
  if (typeof updatePendingPayments === 'boolean') body.updatePendingPayments = updatePendingPayments;
  return call('POST', '/subscriptions/' + encodeURIComponent(subscriptionId), body);
}

async function cancelSubscription(subscriptionId) {
  return call('DELETE', '/subscriptions/' + encodeURIComponent(subscriptionId));
}

async function tokenizeCard({ customerId, creditCard, creditCardHolderInfo, remoteIp }) {
  return call('POST', '/creditCard/tokenizeCreditCard', {
    customer: customerId,
    creditCard,
    creditCardHolderInfo,
    remoteIp,
  });
}

async function getSubscription(subscriptionId) {
  return call('GET', '/subscriptions/' + encodeURIComponent(subscriptionId));
}

async function updatePayment(paymentId, fields) {
  return call('POST', '/payments/' + encodeURIComponent(paymentId), fields);
}

async function listPaymentsBySubscription(subscriptionId) {
  return call('GET', `/payments?subscription=${encodeURIComponent(subscriptionId)}&limit=20`);
}

async function getPaymentLink(paymentId) {
  return call('GET', `/payments/${encodeURIComponent(paymentId)}`);
}

module.exports = {
  call,
  createCustomer,
  updateCustomer,
  createSubscription,
  updateSubscription,
  updateSubscriptionCard,
  cancelSubscription,
  tokenizeCard,
  getSubscription,
  updatePayment,
  listPaymentsBySubscription,
  getPaymentLink,
  PLAN_VALUE,
};
