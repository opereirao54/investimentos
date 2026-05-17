const { db, fieldValue, timestamp } = require('./firebase-admin');
const crypto = require('crypto');

// Rate-limit baseado em Firestore — sem dependência externa. Granularidade:
// bucket por (scope, keyHash, windowStart). Conta incrementos atômicos e
// rejeita quando excede `max` na janela.
//
// Trade-offs aceitos:
// - Custo: 1 write + 1 read por hit (mas hits maliciosos já são caros, então
//   é OK; em produção pode-se migrar para Upstash REST se virar gargalo).
// - Eventual consistency: increment atômico em Firestore via FieldValue.
//   Sob alta concorrência pode passar 1-2 hits acima do max, aceitável.

const SALT = process.env.RATE_LIMIT_SALT || 'appliquei-rl-v1';

function hashKey(s) {
  return crypto.createHash('sha256').update(SALT + ':' + String(s || '')).digest('hex').slice(0, 24);
}

function windowStart(windowMs) {
  return Math.floor(Date.now() / windowMs) * windowMs;
}

/**
 * Incrementa contador e devolve { allowed, count, retryAfterMs }.
 *
 * @param {Object} opts
 * @param {string} opts.scope    Identificador estático do endpoint (ex.: 'init').
 * @param {string} opts.key      Identificador da entidade (IP, uid, email).
 * @param {number} opts.windowMs Tamanho da janela em ms.
 * @param {number} opts.max      Máximo de hits permitidos na janela.
 */
async function check(opts) {
  if (!opts || !opts.scope || !opts.key) {
    throw new Error('rate-limit: scope and key required');
  }
  const windowMs = opts.windowMs || 60000;
  const max = opts.max || 10;
  const ws = windowStart(windowMs);
  const id = `${opts.scope}_${hashKey(opts.key)}_${ws}`;
  const ref = db().collection('rateLimits').doc(id);

  // TTL leve: grava expiresAt; coleção pode ter TTL policy no Firestore
  // depois (config manual). Sem TTL ainda funciona.
  const expiresAt = timestamp().fromMillis(ws + windowMs * 2);

  // Tenta increment atômico; em caso de doc inexistente, set inicial.
  try {
    await ref.set({
      scope: opts.scope,
      windowStart: timestamp().fromMillis(ws),
      expiresAt,
      count: fieldValue().increment(1),
      updatedAt: fieldValue().serverTimestamp(),
    }, { merge: true });
    const snap = await ref.get();
    const count = (snap.data() && snap.data().count) || 1;
    if (count > max) {
      const retryAfterMs = ws + windowMs - Date.now();
      return { allowed: false, count, retryAfterMs: Math.max(0, retryAfterMs) };
    }
    return { allowed: true, count, retryAfterMs: 0 };
  } catch (e) {
    // Em falha do Firestore, "fail open" — não bloqueia legítimos. Loga.
    console.warn('[rate-limit] firestore error, allowing through:', e && e.message);
    return { allowed: true, count: 0, retryAfterMs: 0, failedOpen: true };
  }
}

// M7: TRUSTED_PROXY_HOPS = quantos proxies confiáveis estão na frente.
// XFF tem formato "client, proxy1, proxy2". Vercel injeta 1 hop, então
// default 0 = pega o primeiro (o cliente). Se houver Cloudflare na frente
// da Vercel, definir TRUSTED_PROXY_HOPS=1 e o IP do client vira o
// penúltimo do XFF.
function ipFrom(req) {
  const xff = req && req.headers && req.headers['x-forwarded-for'];
  if (xff) {
    const parts = String(xff).split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      const hops = parseInt(process.env.TRUSTED_PROXY_HOPS || '0', 10) || 0;
      // O IP do cliente real está em (length - 1 - hops). Sem hops: 0 (primeiro).
      const idx = Math.max(0, parts.length - 1 - hops);
      return parts[idx];
    }
  }
  return (req && req.headers && req.headers['x-real-ip'])
    || (req && req.socket && req.socket.remoteAddress)
    || null;
}

function deviceFingerprint(req) {
  const ip = ipFrom(req) || '';
  const ua = (req && req.headers && req.headers['user-agent']) || '';
  return crypto.createHash('sha256').update(SALT + ':dev:' + ip + ':' + ua).digest('hex').slice(0, 16);
}

module.exports = { check, ipFrom, deviceFingerprint, hashKey };
