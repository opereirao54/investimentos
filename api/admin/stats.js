const { db, auth } = require('../_lib/firebase-admin');
const { cors } = require('../_lib/auth');
const { timestamp } = require('../_lib/firebase-admin');

// Endpoint de observabilidade administrativa. Devolve um snapshot de
// métricas úteis para decidir quando ligar antifraude / email-verify
// enforce sem precisar vasculhar logs do Vercel.
//
// Autenticação: header `Authorization: Bearer <ADMIN_API_TOKEN>` ou
// query string `?token=<ADMIN_API_TOKEN>`. Sem env, endpoint devolve 503.
// O token deve ser configurado no Vercel (env `ADMIN_API_TOKEN`) com um
// valor aleatório longo (ex.: `openssl rand -hex 32`).
//
// Custo: ~1 read por documento billing + 1 por webhook 24h + 1 por
// rateLimit 24h + 1 lista de até 1000 users do Firebase Auth. Em apps
// com <1000 usuários, fica sob R$0,01 por chamada. Chame uma vez por dia.

const PAID_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) {
    return res.status(503).json({
      error: 'admin_disabled',
      detail: 'Defina ADMIN_API_TOKEN no Vercel para ativar este endpoint.',
    });
  }
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  const token = (m && m[1]) || (req.query && req.query.token) || null;
  if (!token || token !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const D = db();
    const now = Date.now();
    const dayAgo = timestamp().fromMillis(now - 24 * 3600 * 1000);
    const weekAgo = timestamp().fromMillis(now - 7 * 24 * 3600 * 1000);

    const [billingSnap, webhooks24h, webhooks7d, rateLimits24h] = await Promise.all([
      D.collectionGroup('billing').get(),
      D.collection('webhookEvents').where('receivedAt', '>=', dayAgo).get().catch(() => null),
      D.collection('webhookEvents').where('receivedAt', '>=', weekAgo).get().catch(() => null),
      D.collection('rateLimits').where('updatedAt', '>=', dayAgo).get().catch(() => null),
    ]);

    // Agrega billing
    const subscriptionStatus = {};
    const lastPaymentStatus = {};
    const paymentMethods = {};
    let billingDocs = 0;
    let trialActive = 0;
    let withSubscription = 0;
    let withReferral = 0;
    let active = 0;
    let totalPendingCashbackCents = 0;
    let totalEarningsCents = 0;

    billingSnap.forEach(d => {
      if (d.id !== 'account') return;
      billingDocs++;
      const b = d.data() || {};
      const ss = b.subscriptionStatus || 'NONE';
      subscriptionStatus[ss] = (subscriptionStatus[ss] || 0) + 1;
      const ls = b.lastPaymentStatus || 'NONE';
      lastPaymentStatus[ls] = (lastPaymentStatus[ls] || 0) + 1;
      const pm = b.paymentMethod || 'NONE';
      paymentMethods[pm] = (paymentMethods[pm] || 0) + 1;
      if (b.trialEndsAt && typeof b.trialEndsAt.toMillis === 'function' && b.trialEndsAt.toMillis() > now) trialActive++;
      if (b.subscriptionId) withSubscription++;
      if (b.referredByUserId) withReferral++;
      if (ss === 'ACTIVE' && PAID_STATUSES.has(b.lastPaymentStatus)) active++;
      const stats = b.stats || {};
      totalPendingCashbackCents += stats.pendingDiscountCents || 0;
      totalEarningsCents += stats.totalReferralEarningsCents || 0;
    });

    // Agrega webhooks
    const webhookByEvent = {};
    if (webhooks24h) {
      webhooks24h.forEach(d => {
        const ev = (d.data() && d.data().event) || 'unknown';
        webhookByEvent[ev] = (webhookByEvent[ev] || 0) + 1;
      });
    }
    const webhook7dByEvent = {};
    if (webhooks7d) {
      webhooks7d.forEach(d => {
        const ev = (d.data() && d.data().event) || 'unknown';
        webhook7dByEvent[ev] = (webhook7dByEvent[ev] || 0) + 1;
      });
    }

    // Agrega rate-limits por scope
    const rateLimitByScope = {};
    let suspiciousHits = 0;
    if (rateLimits24h) {
      rateLimits24h.forEach(d => {
        const data = d.data() || {};
        const scope = data.scope || 'unknown';
        if (!rateLimitByScope[scope]) rateLimitByScope[scope] = { totalDocs: 0, highCount: 0, maxCount: 0 };
        rateLimitByScope[scope].totalDocs++;
        if (typeof data.count === 'number') {
          if (data.count > rateLimitByScope[scope].maxCount) rateLimitByScope[scope].maxCount = data.count;
          if (data.count >= 5) {
            rateLimitByScope[scope].highCount++;
            suspiciousHits++;
          }
        }
      });
    }

    // Auth users (página única — caps a 1000)
    let authUsers = { totalKnown: 0, unverifiedPassword: 0, truncated: false };
    try {
      const page = await auth().listUsers(1000);
      authUsers.totalKnown = page.users.length;
      authUsers.truncated = !!page.pageToken;
      authUsers.unverifiedPassword = page.users.filter(u =>
        !u.emailVerified && u.email
        && Array.isArray(u.providerData)
        && u.providerData.some(p => p.providerId === 'password')
      ).length;
    } catch (e) {
      authUsers.error = (e && e.code) || 'list_failed';
    }

    return res.json({
      generatedAt: new Date().toISOString(),
      users: authUsers,
      billing: {
        totalBillingDocs: billingDocs,
        active,
        trialActive,
        withSubscription,
        withReferral,
        subscriptionStatus,
        lastPaymentStatus,
        paymentMethods,
        totalPendingCashbackCents,
        totalEarningsCents,
      },
      webhooks: {
        last24h: { total: webhooks24h ? webhooks24h.size : 0, byEvent: webhookByEvent },
        last7d: { total: webhooks7d ? webhooks7d.size : 0, byEvent: webhook7dByEvent },
      },
      rateLimits24h: {
        totalScopes: Object.keys(rateLimitByScope).length,
        suspiciousHits,
        byScope: rateLimitByScope,
      },
      readinessHints: {
        antifraudInitSafeToEnable: suspiciousHits < 5,
        emailVerifyEnforceCandidates: authUsers.unverifiedPassword,
      },
    });
  } catch (e) {
    console.error('[admin/stats]', e);
    return res.status(500).json({ error: 'stats_failed', detail: e.message });
  }
};
