const { auth } = require('./firebase-admin');

async function requireUser(req, res) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'missing_token' });
    return null;
  }
  try {
    const decoded = await auth().verifyIdToken(match[1]);
    return decoded;
  } catch (e) {
    console.error('[auth] verifyIdToken failed:', e && e.code, e && e.message);
    res.status(401).json({
      error: 'invalid_token',
      code: (e && e.code) || null,
      detail: (e && e.message) || null,
    });
    return null;
  }
}

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { requireUser, cors };
