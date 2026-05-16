const { auth } = require('./firebase-admin');

// Cache LRU em memória do lambda: evita chamar verifyIdToken em todos os
// requests. O Firebase Admin já valida assinatura localmente, mas o
// network/JWKs fetch ainda é o caminho quente. TTL curto (60s) mantém
// reflexo rápido de revogação ou token novo após emailVerified=true.
const TOKEN_CACHE_TTL_MS = 60 * 1000;
const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map(); // token -> { decoded, expiresAt }

function cacheGet(token) {
  const e = tokenCache.get(token);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    tokenCache.delete(token);
    return null;
  }
  // Move para o final (LRU recency).
  tokenCache.delete(token);
  tokenCache.set(token, e);
  return e.decoded;
}

function cacheSet(token, decoded) {
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const oldest = tokenCache.keys().next().value;
    if (oldest) tokenCache.delete(oldest);
  }
  // Respeita exp do próprio token quando menor que TTL.
  const tokenExpMs = decoded && decoded.exp ? decoded.exp * 1000 : 0;
  const expiresAt = Math.min(Date.now() + TOKEN_CACHE_TTL_MS, tokenExpMs || Infinity);
  tokenCache.set(token, { decoded, expiresAt });
}

async function requireUser(req, res) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'missing_token' });
    return null;
  }
  const token = match[1];
  const cached = cacheGet(token);
  if (cached) return cached;
  try {
    const decoded = await auth().verifyIdToken(token);
    cacheSet(token, decoded);
    return decoded;
  } catch (e) {
    // B4: não devolver detalhes do Firebase (e.code/e.message) para o cliente.
    console.error('[auth] verifyIdToken failed:', e && e.code);
    res.status(401).json({ error: 'invalid_token' });
    return null;
  }
}

// requireVerifiedUser: valida token + exige email verificado.
// Quando EMAIL_VERIFY_ENFORCE !== 'true', apenas loga warning e segue
// (fase 1 de rollout, sem bloquear legados). Quando 'true', bloqueia com 403.
// Provedores OAuth confiáveis (google.com) sempre vêm com email_verified=true
// no token, portanto passam sem fricção.
async function requireVerifiedUser(req, res) {
  const decoded = await requireUser(req, res);
  if (!decoded) return null;
  if (decoded.email_verified === true) return decoded;
  const enforce = String(process.env.EMAIL_VERIFY_ENFORCE || '').toLowerCase() === 'true';
  if (!enforce) {
    console.warn('[auth] email_not_verified (log-only)', decoded.uid, decoded.email);
    return decoded;
  }
  res.status(403).json({ error: 'email_not_verified' });
  return null;
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

module.exports = { requireUser, requireVerifiedUser, cors };
