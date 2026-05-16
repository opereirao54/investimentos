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
    // B4: não devolver detalhes do Firebase (e.code/e.message) para o cliente.
    console.error('[auth] verifyIdToken failed:', e && e.code);
    res.status(401).json({ error: 'invalid_token' });
    return null;
  }
}

// M1: CORS configurável por ALLOWED_ORIGINS (lista separada por vírgula).
// Sem env definida, mantém '*' por compatibilidade com deploys atuais.
function cors(req, res) {
  const origin = req.headers.origin || '';
  const raw = String(process.env.ALLOWED_ORIGINS || '').trim();
  const allowed = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
  let allowOrigin;
  if (allowed.length === 0 || allowed.includes('*')) {
    allowOrigin = '*';
  } else if (origin && allowed.includes(origin)) {
    allowOrigin = origin;
    res.setHeader('Vary', 'Origin');
  } else {
    // Origem não autorizada: responde preflight 204 sem Allow-Origin
    // (navegador bloqueia a chamada real). Em request real, deixa o
    // CORS falhar do lado do cliente.
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return true;
    }
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { requireUser, cors };
