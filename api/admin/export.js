const { db, auth, timestamp } = require('../_lib/firebase-admin');
const { cors } = require('../_lib/auth');

// Export CSV dos documentos de billing, juntado com email do Firebase Auth.
// Auth: Bearer ADMIN_API_TOKEN (igual a stats.js e action.js).
//
// Cada chamada é registada em adminAuditLog com action="export_csv".
// Custo: ~1 read por billing doc + 1 getUser por linha. Usar com moderação
// (chamar 1x/mês para arquivo, não em loop).

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rowToLine(cols) {
  return cols.map(csvEscape).join(',');
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return res.status(503).json({ error: 'admin_disabled' });
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  const token = (m && m[1]) || (req.query && req.query.token) || null;
  if (!token || token !== expected) return res.status(401).json({ error: 'unauthorized' });

  try {
    const billingSnap = await db().collectionGroup('billing').get();
    const rows = [];
    rows.push(rowToLine([
      'uid', 'email', 'subscriptionStatus', 'lastPaymentStatus', 'paymentMethod',
      'monthlyPriceCents', 'pendingDiscountCents', 'totalReferralEarningsCents',
      'trialEndsAt', 'subscriptionId', 'customerId', 'referredByUserId',
    ]));

    // Pré-recolhe uids para fazer um único listUsers (mais barato que getUser por linha).
    const billingByUid = new Map();
    billingSnap.forEach(d => {
      if (d.id !== 'account') return;
      const uid = d.ref.parent.parent ? d.ref.parent.parent.id : null;
      if (uid) billingByUid.set(uid, d.data() || {});
    });

    // listUsers cap = 1000 por página
    const emailByUid = new Map();
    let pageToken;
    do {
      const page = await auth().listUsers(1000, pageToken);
      page.users.forEach(u => emailByUid.set(u.uid, u.email || ''));
      pageToken = page.pageToken;
    } while (pageToken);

    for (const [uid, b] of billingByUid.entries()) {
      const stats = b.stats || {};
      const trialEndsAt = (b.trialEndsAt && typeof b.trialEndsAt.toDate === 'function')
        ? b.trialEndsAt.toDate().toISOString() : '';
      rows.push(rowToLine([
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
      ]));
    }

    // Audit (best-effort)
    try {
      const actor = (req.headers['x-admin-actor'] || '').toString().slice(0, 120) || 'admin';
      await db().collection('adminAuditLog').add({
        action: 'export_csv', actor, rows: billingByUid.size, at: timestamp().now(),
      });
    } catch (_) {}

    const fname = `appliquei-billing-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    return res.send(rows.join('\n'));
  } catch (e) {
    console.error('[admin/export]', e);
    return res.status(500).json({ error: 'export_failed', detail: e.message });
  }
};
