const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  let s = 'APP-';
  for (let i = 0; i < 6; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}

function normalize(code) {
  // Rejeita tipos não-string explicitamente (objetos/arrays geram lixo via
  // String(...)). Callers em /init e /subscribe já validam o tipo, mas
  // este guard fecha o ponto único da função.
  if (typeof code !== 'string') return '';
  return code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

function isValid(code) {
  return /^APP-[A-Z0-9]{6}$/.test(normalize(code));
}

async function reserveUniqueCode(db, uid, timestamp) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const ref = db.collection('referralCodes').doc(code);
    const reserved = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      tx.set(ref, { uid, createdAt: timestamp.fromMillis(Date.now()) });
      return true;
    });
    if (reserved) return code;
  }
  throw new Error('referral_code_collision');
}

async function lookupOwner(db, code) {
  const c = normalize(code);
  if (!isValid(c)) return null;
  const snap = await db.collection('referralCodes').doc(c).get();
  if (!snap.exists) return null;
  return { code: c, uid: snap.data().uid };
}

// Self-heal: garante que referralCodes/CODE existe e pertence ao uid esperado.
// Idempotente. Se já existe com o uid correto, no-op. Se existe com outro uid,
// não sobrescreve (devolve false). Se não existe, cria via transação.
async function ensureReserved(db, code, uid, timestamp) {
  const c = normalize(code);
  if (!isValid(c)) return false;
  const ref = db.collection('referralCodes').doc(c);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return snap.data().uid === uid;
    tx.set(ref, { uid, createdAt: timestamp.fromMillis(Date.now()) });
    return true;
  });
}

module.exports = { randomCode, normalize, isValid, reserveUniqueCode, lookupOwner, ensureReserved };
