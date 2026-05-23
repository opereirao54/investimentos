const { db, timestamp } = require('../_lib/firebase-admin');
const { cors } = require('../_lib/auth');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  
  // Same auth as stats.js (Bearer ADMIN_API_TOKEN)
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return res.status(503).json({ error: 'admin_disabled' });
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  const token = (m && m[1]) || null;
  if (!token || token !== expected) return res.status(401).json({ error: 'unauthorized' });

  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const filterAction = req.query.action || null;
    const filterEmail = req.query.email || null;
    
    let query = db().collection('adminAuditLog').orderBy('at', 'desc');
    if (filterAction) query = query.where('action', '==', filterAction);
    // Note: can't combine orderBy+where on different fields without index, 
    // so email filter is done client-side if we sort by `at`
    query = query.limit(limit);
    
    const snap = await query.get();
    const entries = [];
    snap.forEach(d => {
      const data = d.data() || {};
      if (filterEmail && data.email !== filterEmail) return;
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
    
    return res.json({ entries, total: entries.length });
  } catch (e) {
    console.error('[admin/audit]', e);
    return res.status(500).json({ error: 'audit_failed', detail: e.message });
  }
};
