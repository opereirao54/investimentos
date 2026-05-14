const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  let s = 'APP-';
  for (let i = 0; i < 6; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}

function normalize(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
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

module.exports = { randomCode, normalize, isValid, reserveUniqueCode, lookupOwner };
