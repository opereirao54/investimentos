const DEFAULT_URL = 'https://api.asaas.com/v3';
const SANDBOX_URL = 'https://api-sandbox.asaas.com/v3';

// As chaves novas do Asaas dizem o ambiente no prefixo: `$aact_prod_...`
// (produção) e `$aact_hmlg_...` (sandbox). Chave antiga, sem a marca, devolve
// null e vale o que ASAAS_API_URL disser.
function ambienteDaChave(k) {
  if (/^\$?aact_prod_/i.test(k)) return 'producao';
  if (/^\$?aact_hmlg_/i.test(k)) return 'sandbox';
  return null;
}

function limpar(v) {
  return String(v)
    .trim()
    .replace(/^[\s"'`<\[]+|[\s"'`>\]]+$/g, '');
}

function baseUrl() {
  const bruta = process.env.ASAAS_API_URL;
  let u;
  if (bruta && limpar(bruta)) {
    u = limpar(bruta).replace(/\/$/, '');
  } else {
    // Sem URL: a própria chave escolhe o ambiente. Antes caía sempre em
    // produção, e uma chave de sandbox respondia 401 sem dizer por quê.
    const k = process.env.ASAAS_API_KEY ? limpar(process.env.ASAAS_API_KEY) : '';
    u = ambienteDaChave(k) === 'sandbox' ? SANDBOX_URL : DEFAULT_URL;
  }
  if (!/^https?:\/\//i.test(u)) {
    throw new Error(
      'ASAAS_API_URL inválida (recebida: "' +
        u +
        '"). Use ' +
        DEFAULT_URL +
        ' (produção) ou ' +
        SANDBOX_URL +
        ' (sandbox).'
    );
  }
  return u;
}

/** 'producao' ou 'sandbox' — o ambiente para onde as chamadas vão. */
function ambiente() {
  return /sandbox/i.test(baseUrl()) ? 'sandbox' : 'producao';
}

function apiKey() {
  const k = process.env.ASAAS_API_KEY;
  if (!k) throw new Error('ASAAS_API_KEY não definida.');
  const chave = limpar(k);
  // Chave de um ambiente com a URL do outro: o Asaas só responde 401. Falha
  // aqui, com o nome do erro, antes de mandar a chave para o lugar errado.
  const daChave = ambienteDaChave(chave);
  if (daChave && daChave !== ambiente()) {
    throw new Error(
      'ASAAS_API_KEY é de ' +
        daChave +
        ', mas ASAAS_API_URL aponta para ' +
        ambiente() +
        '. Use a chave e a URL do mesmo ambiente.'
    );
  }
  return chave;
}

async function call(method, path, body) {
  const r = await fetch(baseUrl() + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      access_token: apiKey(),
      'User-Agent': 'Appliquei/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }
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

async function findCustomerByExternalReference(uid) {
  if (!uid) return null;
  try {
    const r = await call(
      'GET',
      '/customers?externalReference=' + encodeURIComponent(uid) + '&limit=1'
    );
    if (r && Array.isArray(r.data) && r.data.length > 0) return r.data[0];
  } catch (e) {
    console.warn('[asaas] lookup by externalReference failed', e && e.message);
  }
  return null;
}

async function createCustomer({ name, email, uid, cpfCnpj }) {
  // M5: idempotência. Se uma tentativa anterior criou o customer mas falhou
  // antes de gravar customerId no Firestore (function timeout, falha de
  // rede), reusa em vez de criar duplicado. Asaas aceita múltiplos
  // customers com mesmo email — externalReference=uid é nossa chave única.
  const existing = await findCustomerByExternalReference(uid);
  if (existing && existing.id) return existing;
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

async function createSubscription({
  customerId,
  uid,
  nextDueDate,
  value,
  billingType,
  creditCard,
  creditCardHolderInfo,
  remoteIp,
}) {
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

async function updateSubscriptionCard(
  subscriptionId,
  { creditCard, creditCardHolderInfo, remoteIp, updatePendingPayments }
) {
  const body = { creditCard, creditCardHolderInfo };
  if (remoteIp) body.remoteIp = remoteIp;
  if (typeof updatePendingPayments === 'boolean')
    body.updatePendingPayments = updatePendingPayments;
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

// Cobrança avulsa (1 mês) — não cria subscription, não projeta faturas futuras.
// Usada pelo endpoint /api/billing/pay-month. O cashback do indicador continua
// a funcionar via webhook PAYMENT_CONFIRMED (creditIndicatorFromIndicado roda
// para qualquer pagamento confirmado, com ou sem subscription).
async function createPayment({
  customerId,
  value,
  billingType,
  dueDate,
  description,
  externalReference,
  creditCard,
  creditCardHolderInfo,
  remoteIp,
}) {
  const body = {
    customer: customerId,
    billingType: billingType || 'UNDEFINED',
    value: typeof value === 'number' ? value : PLAN_VALUE,
    dueDate,
    description: description || PLAN_DESCRIPTION + ' (avulso)',
    externalReference,
  };
  if (creditCard) body.creditCard = creditCard;
  if (creditCardHolderInfo) body.creditCardHolderInfo = creditCardHolderInfo;
  if (remoteIp) body.remoteIp = remoteIp;
  return call('POST', '/payments', body);
}

async function listPaymentsBySubscription(subscriptionId) {
  return call('GET', `/payments?subscription=${encodeURIComponent(subscriptionId)}&limit=20`);
}

async function getPaymentLink(paymentId) {
  return call('GET', `/payments/${encodeURIComponent(paymentId)}`);
}

module.exports = {
  call,
  ambiente,
  ambienteDaChave,
  createCustomer,
  findCustomerByExternalReference,
  updateCustomer,
  createSubscription,
  updateSubscription,
  updateSubscriptionCard,
  cancelSubscription,
  tokenizeCard,
  getSubscription,
  updatePayment,
  createPayment,
  listPaymentsBySubscription,
  getPaymentLink,
  PLAN_VALUE,
};
