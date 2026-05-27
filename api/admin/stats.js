const { db, auth, timestamp } = require('../_lib/firebase-admin');
const { cors } = require('../_lib/auth');

// Endpoint admin CONSOLIDADO (cabe em 1 função Vercel — antes eram 3):
//   GET /api/admin/stats                            → dashboard JSON (default)
//   GET /api/admin/stats?include=audit&limit=N      → audit log
//        &actionFilter=set_discount&emailFilter=... → filtros de audit
//   GET /api/admin/stats?format=csv                 → export CSV billing
//
// Autenticação: header `Authorization: Bearer <ADMIN_API_TOKEN>` ou
// query string `?token=<ADMIN_API_TOKEN>`.

const PAID_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);

function authCheck(req) {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected)
    return { status: 503, error: 'admin_disabled', detail: 'Defina ADMIN_API_TOKEN no Vercel.' };
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  const token = (m && m[1]) || (req.query && req.query.token) || null;
  if (!token || token !== expected) return { status: 401, error: 'unauthorized' };
  return null;
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ─── CSV EXPORT ────────────────────────────────────────────────
async function exportCsv(req, res) {
  const billingSnap = await db().collectionGroup('billing').get();

  const billingByUid = new Map();
  billingSnap.forEach((d) => {
    if (d.id !== 'account') return;
    const uid = d.ref.parent.parent ? d.ref.parent.parent.id : null;
    if (uid) billingByUid.set(uid, d.data() || {});
  });

  const emailByUid = new Map();
  let pageToken;
  do {
    const page = await auth().listUsers(1000, pageToken);
    page.users.forEach((u) => emailByUid.set(u.uid, u.email || ''));
    pageToken = page.pageToken;
  } while (pageToken);

  const rows = [];
  rows.push(
    [
      'uid',
      'email',
      'subscriptionStatus',
      'lastPaymentStatus',
      'paymentMethod',
      'monthlyPriceCents',
      'pendingDiscountCents',
      'totalReferralEarningsCents',
      'trialEndsAt',
      'subscriptionId',
      'customerId',
      'referredByUserId',
    ]
      .map(csvEscape)
      .join(',')
  );

  for (const [uid, b] of billingByUid.entries()) {
    const stats = b.stats || {};
    const trialEndsAt =
      b.trialEndsAt && typeof b.trialEndsAt.toDate === 'function'
        ? b.trialEndsAt.toDate().toISOString()
        : '';
    rows.push(
      [
        uid,
        emailByUid.get(uid) || '',
        b.subscriptionStatus || '',
        b.lastPaymentStatus || '',
        b.paymentMethod || '',
        b.subscriptionBaseValueCents || b.monthlyPriceCents || '',
        stats.pendingDiscountCents || 0,
        stats.totalReferralEarningsCents || 0,
        trialEndsAt,
        b.subscriptionId || '',
        b.customerId || '',
        b.referredByUserId || '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  try {
    const actor = (req.headers['x-admin-actor'] || '').toString().slice(0, 120) || 'admin';
    await db().collection('adminAuditLog').add({
      action: 'export_csv',
      actor,
      rows: billingByUid.size,
      at: timestamp().now(),
    });
  } catch (_) {}

  const fname = `appliquei-billing-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  return res.send(rows.join('\n'));
}

// ─── AUDIT LIST ────────────────────────────────────────────────
async function auditList(req, res) {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const filterAction = req.query.actionFilter || null;
  const filterEmail = (req.query.emailFilter || '').toLowerCase();
  const sinceMs = parseInt(req.query.sinceMs) || 0;

  let query = db().collection('adminAuditLog').orderBy('at', 'desc');
  if (filterAction) query = query.where('action', '==', filterAction);
  query = query.limit(limit);

  const snap = await query.get();
  const entries = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    if (filterEmail && !(data.email || '').toLowerCase().includes(filterEmail)) return;
    const atMs = data.at && typeof data.at.toMillis === 'function' ? data.at.toMillis() : 0;
    if (sinceMs && atMs < sinceMs) return;
    entries.push({
      id: d.id,
      action: data.action || '',
      email: data.email || '',
      uid: data.uid || '',
      actor: data.actor || '',
      at: data.at && typeof data.at.toDate === 'function' ? data.at.toDate().toISOString() : '',
      before: data.before || null,
      after: data.after || null,
      extra: data.extra || null,
    });
  });

  // Enriquece entradas antigas que só têm UID (campo `email` adicionado depois).
  const missingUids = [...new Set(entries.filter((e) => !e.email && e.uid).map((e) => e.uid))];
  await Promise.all(
    missingUids.map(async (uid) => {
      try {
        const u = await auth().getUser(uid);
        if (u.email)
          entries.forEach((e) => {
            if (!e.email && e.uid === uid) e.email = u.email;
          });
      } catch (_) {}
    })
  );

  return res.json({ entries, total: entries.length });
}

// ─── DASHBOARD ─────────────────────────────────────────────────
async function dashboard(req, res) {
  const D = db();
  const now = Date.now();
  const dayAgo = timestamp().fromMillis(now - 24 * 3600 * 1000);
  const weekAgo = timestamp().fromMillis(now - 7 * 24 * 3600 * 1000);

  const [billingSnap, webhooks24h, webhooks7d, rateLimits24h] = await Promise.all([
    D.collectionGroup('billing').get(),
    D.collection('webhookEvents')
      .where('receivedAt', '>=', dayAgo)
      .get()
      .catch(() => null),
    D.collection('webhookEvents')
      .where('receivedAt', '>=', weekAgo)
      .get()
      .catch(() => null),
    D.collection('rateLimits')
      .where('updatedAt', '>=', dayAgo)
      .get()
      .catch(() => null),
  ]);

  // Agrega billing
  const subscriptionStatus = {};
  const lastPaymentStatus = {};
  const paymentMethods = {};
  const billingByUid = new Map(); // uid → billing doc (para enriquecer listas)
  let billingDocs = 0;
  let trialActive = 0;
  let withSubscription = 0;
  let withReferral = 0;
  let active = 0;
  let totalPendingCashbackCents = 0;
  let totalEarningsCents = 0;
  let mrrCents = 0;
  let trialExpiredNoConversion = 0;
  let converted = 0;
  let churnedCount = 0;
  let overdueCount = 0;
  let trialExpiringSoon48h = 0;
  let usersWithDiscount = 0;
  const topReferrersRaw = [];
  const topPendingRaw = [];
  const overdueListRaw = [];
  const expiringListRaw = [];
  const referralCountByUid = {}; // referrerUid → quantos indicou

  billingSnap.forEach((d) => {
    if (d.id !== 'account') return;
    billingDocs++;
    const b = d.data() || {};
    const uid = d.ref.parent.parent ? d.ref.parent.parent.id : null;
    if (uid) billingByUid.set(uid, b);

    const ss = b.subscriptionStatus || 'NONE';
    subscriptionStatus[ss] = (subscriptionStatus[ss] || 0) + 1;
    if (ss === 'DELETED' || ss === 'INACTIVATED') churnedCount++;

    const ls = b.lastPaymentStatus || 'NONE';
    lastPaymentStatus[ls] = (lastPaymentStatus[ls] || 0) + 1;
    if (ls === 'OVERDUE') {
      overdueCount++;
      if (uid)
        overdueListRaw.push({
          uid,
          sinceMs: b.lastPaymentDueAtMs || 0,
          // Fallback 1500 (R$15) se ambos os campos forem omitidos no doc.
          valueCents: b.subscriptionBaseValueCents || b.monthlyPriceCents || 1500,
        });
    }

    const pm = b.paymentMethod || 'NONE';
    paymentMethods[pm] = (paymentMethods[pm] || 0) + 1;

    const trialEnds =
      b.trialEndsAt && typeof b.trialEndsAt.toMillis === 'function' ? b.trialEndsAt.toMillis() : 0;
    if (trialEnds > now) {
      trialActive++;
      if (trialEnds <= now + 48 * 3600 * 1000) {
        trialExpiringSoon48h++;
        if (uid) expiringListRaw.push({ uid, trialEndsMs: trialEnds });
      }
    } else if (trialEnds > 0 && trialEnds <= now && !b.subscriptionId) {
      trialExpiredNoConversion++;
    }

    if (b.subscriptionId) {
      withSubscription++;
      if (PAID_STATUSES.has(b.lastPaymentStatus)) converted++;
    }
    if (b.referredByUserId) {
      withReferral++;
      referralCountByUid[b.referredByUserId] = (referralCountByUid[b.referredByUserId] || 0) + 1;
    }
    const isActive = ss === 'ACTIVE' && PAID_STATUSES.has(b.lastPaymentStatus);
    if (isActive) {
      active++;
      mrrCents += b.subscriptionBaseValueCents || b.monthlyPriceCents || 1500;
    }
    const stats = b.stats || {};
    const earnings = stats.totalReferralEarningsCents || 0;
    const pending = stats.pendingDiscountCents || 0;
    totalPendingCashbackCents += pending;
    totalEarningsCents += earnings;
    if (pending > 0) usersWithDiscount++;

    if (uid && earnings > 0) topReferrersRaw.push({ uid, earningsCents: earnings });
    if (uid && pending > 0) topPendingRaw.push({ uid, pendingCents: pending });
  });

  // Enriquece topReferrers com a contagem de pessoas que cada um indicou
  topReferrersRaw.forEach((r) => {
    r.indications = referralCountByUid[r.uid] || 0;
  });

  topReferrersRaw.sort((a, b) => b.earningsCents - a.earningsCents);
  topPendingRaw.sort((a, b) => b.pendingCents - a.pendingCents);
  overdueListRaw.sort((a, b) => (a.sinceMs || 0) - (b.sinceMs || 0));
  expiringListRaw.sort((a, b) => a.trialEndsMs - b.trialEndsMs);
  const topReferrers = topReferrersRaw.slice(0, 8);
  const topPending = topPendingRaw.slice(0, 8);
  const overdueList = overdueListRaw.slice(0, 10);
  const expiringList = expiringListRaw.slice(0, 10);

  // ── Receita do mês (collectionGroup payments, filtrada por receivedAt no mês corrente)
  const monthStart = new Date(now);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  let revenueThisMonthCents = 0;
  let paymentsThisMonth = 0;
  let revenueLast30dCents = 0;
  let paymentsLast30d = 0;
  try {
    const last30 = timestamp().fromMillis(now - 30 * 24 * 3600 * 1000);
    const paySnap = await D.collectionGroup('payments').where('receivedAt', '>=', last30).get();
    paySnap.forEach((p) => {
      const d = p.data() || {};
      if (!PAID_STATUSES.has(d.status)) return;
      const valueCents = Math.round((d.value || 0) * 100);
      const recMs =
        d.receivedAt && typeof d.receivedAt.toMillis === 'function' ? d.receivedAt.toMillis() : 0;
      revenueLast30dCents += valueCents;
      paymentsLast30d++;
      if (recMs >= monthStart.getTime()) {
        revenueThisMonthCents += valueCents;
        paymentsThisMonth++;
      }
    });
  } catch (e) {
    console.warn('[admin/stats] payments aggregate failed', e && e.message);
  }

  // Agrega webhooks
  const webhookByEvent = {};
  if (webhooks24h) {
    webhooks24h.forEach((d) => {
      const ev = (d.data() && d.data().event) || 'unknown';
      webhookByEvent[ev] = (webhookByEvent[ev] || 0) + 1;
    });
  }
  const webhook7dByEvent = {};
  if (webhooks7d) {
    webhooks7d.forEach((d) => {
      const ev = (d.data() && d.data().event) || 'unknown';
      webhook7dByEvent[ev] = (webhook7dByEvent[ev] || 0) + 1;
    });
  }

  // Agrega rate-limits
  const rateLimitByScope = {};
  let suspiciousHits = 0;
  if (rateLimits24h) {
    rateLimits24h.forEach((d) => {
      const data = d.data() || {};
      const scope = data.scope || 'unknown';
      if (!rateLimitByScope[scope])
        rateLimitByScope[scope] = { totalDocs: 0, highCount: 0, maxCount: 0 };
      rateLimitByScope[scope].totalDocs++;
      if (typeof data.count === 'number') {
        if (data.count > rateLimitByScope[scope].maxCount)
          rateLimitByScope[scope].maxCount = data.count;
        if (data.count >= 5) {
          rateLimitByScope[scope].highCount++;
          suspiciousHits++;
        }
      }
    });
  }

  // Auth users (página única — caps a 1000)
  const authUsers = {
    totalKnown: 0,
    emailVerifiedCount: 0,
    unverifiedPassword: 0,
    disabled: 0,
    newUsers7d: 0,
    newUsers30d: 0,
    truncated: false,
  };
  let allUsers = [];
  const dailyNewUsers = []; // [{date:'YYYY-MM-DD', count}]
  const emailDomainCount = {};
  const emailByUid = new Map();

  try {
    const page = await auth().listUsers(1000);
    authUsers.totalKnown = page.users.length;
    authUsers.truncated = !!page.pageToken;
    const weekAgoMs = now - 7 * 24 * 3600 * 1000;
    const monthAgoMs = now - 30 * 24 * 3600 * 1000;

    // Buckets para sparkline (últimos 30 dias)
    const bucketCount = new Map();
    for (let i = 29; i >= 0; i--) {
      const dt = new Date(now - i * 24 * 3600 * 1000);
      const key = dt.toISOString().slice(0, 10);
      bucketCount.set(key, 0);
    }

    page.users.forEach((u) => {
      if (u.emailVerified) authUsers.emailVerifiedCount++;
      if (u.disabled) authUsers.disabled++;
      if (u.email) emailByUid.set(u.uid, u.email);
      if (
        !u.emailVerified &&
        u.email &&
        Array.isArray(u.providerData) &&
        u.providerData.some((p) => p.providerId === 'password')
      ) {
        authUsers.unverifiedPassword++;
      }
      const createdAt =
        u.metadata && u.metadata.creationTime ? Date.parse(u.metadata.creationTime) : 0;
      if (createdAt >= weekAgoMs) authUsers.newUsers7d++;
      if (createdAt >= monthAgoMs) authUsers.newUsers30d++;
      if (createdAt >= monthAgoMs) {
        const key = new Date(createdAt).toISOString().slice(0, 10);
        if (bucketCount.has(key)) bucketCount.set(key, bucketCount.get(key) + 1);
      }
      // Top domínios
      if (u.email) {
        const dom = u.email.split('@')[1] || '';
        if (dom) emailDomainCount[dom] = (emailDomainCount[dom] || 0) + 1;
      }
    });

    for (const [date, count] of bucketCount.entries()) dailyNewUsers.push({ date, count });

    // Lista completa enriquecida (até 1000) — usada para tabela com filtros
    allUsers = page.users.map((u) => {
      const b = billingByUid.get(u.uid) || {};
      const trialEndsMs =
        b.trialEndsAt && typeof b.trialEndsAt.toMillis === 'function'
          ? b.trialEndsAt.toMillis()
          : 0;
      const isActive = b.subscriptionStatus === 'ACTIVE' && PAID_STATUSES.has(b.lastPaymentStatus);
      const isTrialActive = trialEndsMs > now;
      const isOverdue = b.lastPaymentStatus === 'OVERDUE';
      const isSuspended = !!u.disabled;
      const isUnverified = !u.emailVerified;
      let status = 'unknown';
      if (isSuspended) status = 'suspended';
      else if (isOverdue) status = 'overdue';
      else if (isActive) status = 'paying';
      else if (isTrialActive) status = 'trial';
      else if (isUnverified) status = 'unverified';
      else if (b.subscriptionStatus === 'DELETED' || b.subscriptionStatus === 'INACTIVATED')
        status = 'churned';
      else status = 'inactive';
      return {
        uid: u.uid,
        email: u.email || null,
        emailVerified: !!u.emailVerified,
        disabled: !!u.disabled,
        createdAtMs:
          u.metadata && u.metadata.creationTime ? Date.parse(u.metadata.creationTime) : 0,
        lastSignInMs:
          u.metadata && u.metadata.lastSignInTime ? Date.parse(u.metadata.lastSignInTime) : 0,
        providers: u.providerData ? u.providerData.map((p) => p.providerId) : [],
        status,
        subscriptionStatus: b.subscriptionStatus || null,
        lastPaymentStatus: b.lastPaymentStatus || null,
        trialEndsMs,
        pendingDiscountCents: (b.stats && b.stats.pendingDiscountCents) || 0,
        earningsCents: (b.stats && b.stats.totalReferralEarningsCents) || 0,
        hasReferrer: !!b.referredByUserId,
        indications: referralCountByUid[u.uid] || 0,
      };
    });
    allUsers.sort((a, b) => b.createdAtMs - a.createdAtMs);
  } catch (e) {
    authUsers.error = (e && e.code) || 'list_failed';
  }

  // Enriquecer rankings/listas com emails. 3 níveis:
  //   1) cache listUsers (sync, free)
  //   2) email cacheado no próprio doc billing (campos `email` / `customerEmail`
  //      gravados em init.js e customer.js) — sync, free
  //   3) auth().getUser(uid) async — trata listUsers truncado ou
  //      utilizadores deletados da auth com billing residual
  async function attachEmails(arr) {
    await Promise.all(
      arr.map(async (row) => {
        if (row.email) return;
        const cached = emailByUid.get(row.uid);
        if (cached) {
          row.email = cached;
          return;
        }
        const b = billingByUid.get(row.uid);
        if (b && (b.email || b.customerEmail)) {
          row.email = b.email || b.customerEmail;
          emailByUid.set(row.uid, row.email);
          return;
        }
        try {
          const u = await auth().getUser(row.uid);
          row.email = u.email || null;
          if (u.email) emailByUid.set(row.uid, u.email);
        } catch (_) {
          row.email = null;
        }
      })
    );
  }
  await Promise.all([
    attachEmails(topReferrers),
    attachEmails(topPending),
    attachEmails(overdueList),
    attachEmails(expiringList),
  ]);

  // Top domínios (top 10)
  const topEmailDomains = Object.entries(emailDomainCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));

  // Recent audit (snapshot p/ dashboard)
  const recentAudit = [];
  try {
    const auditSnap = await D.collection('adminAuditLog').orderBy('at', 'desc').limit(20).get();
    auditSnap.forEach((d) => {
      const data = d.data() || {};
      recentAudit.push({
        id: d.id,
        action: data.action || '',
        email: data.email || '',
        actor: data.actor || '',
        at: data.at && typeof data.at.toDate === 'function' ? data.at.toDate().toISOString() : '',
        before: data.before || null,
        after: data.after || null,
      });
    });
  } catch (e) {
    console.warn('[admin/stats] audit fetch failed', e && e.message);
  }

  // Derived KPIs
  const churnRate = billingDocs > 0 ? churnedCount / billingDocs : 0;
  const conversionRate = billingDocs > 0 ? converted / billingDocs : 0;
  const arpu = active > 0 ? Math.round(mrrCents / active) : 0;
  // LTV estimado: ARPU / monthlyChurnRate. Aproximação: usa churnRate global.
  const ltvCents = churnRate > 0 ? Math.round(arpu / churnRate) : 0;
  const viralCoefficient = authUsers.totalKnown > 0 ? withReferral / authUsers.totalKnown : 0;

  return res.json({
    generatedAt: new Date().toISOString(),
    funnel: {
      registered: authUsers.totalKnown,
      emailVerified: authUsers.emailVerifiedCount,
      billingInitiated: billingDocs,
      trialActive,
      trialExpiredNoConversion,
      converted,
      churned: churnedCount,
    },
    recentAudit,
    users: authUsers,
    recentUsers: allUsers.slice(0, 20),
    allUsers,
    billing: {
      totalBillingDocs: billingDocs,
      active,
      inactive: Math.max(0, billingDocs - active),
      trialActive,
      withSubscription,
      withReferral,
      subscriptionStatus,
      lastPaymentStatus,
      paymentMethods,
      totalPendingCashbackCents,
      totalEarningsCents,
      mrrCents,
      arrCents: mrrCents * 12,
      churnedCount,
      churnRate,
      overdueCount,
      arpu,
      ltvCents,
      viralCoefficient,
      trialExpiringSoon48h,
      conversionRate,
      topReferrers,
      topPending,
      overdueList,
      expiringList,
      // Novos:
      revenueThisMonthCents,
      paymentsThisMonth,
      revenueLast30dCents,
      paymentsLast30d,
      usersWithDiscount,
      discountRate: billingDocs > 0 ? usersWithDiscount / billingDocs : 0,
    },
    series: {
      dailyNewUsers30d: dailyNewUsers,
      topEmailDomains,
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
}

// ─── ROUTER ────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const err = authCheck(req);
  if (err) return res.status(err.status).json({ error: err.error, detail: err.detail });

  try {
    if (req.query.format === 'csv') return await exportCsv(req, res);
    if (req.query.include === 'audit') return await auditList(req, res);
    return await dashboard(req, res);
  } catch (e) {
    console.error('[admin/stats]', e);
    return res.status(500).json({ error: 'stats_failed', detail: e.message });
  }
};
