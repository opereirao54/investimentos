// Endpoint de ingestão para writes que precisam sobreviver ao freeze
// do tab no mobile. Chamado via navigator.sendBeacon a partir de
// visibilitychange→hidden / pagehide. O Firestore SDK do cliente
// resolve set() rapidamente contra a IndexedDB local, mas a transmissão
// real para o servidor pode não acontecer antes do iOS suspender o
// processo — daí a necessidade deste caminho independente.
//
// Como sendBeacon não permite headers customizados, o ID token vai no
// corpo. Verifica-se via Admin SDK (mesma assinatura do requireUser,
// só que pegando do body em vez do header).
//
// Schema v2 LWW por-chave: aceita um payload {keys, keyRevs} e faz
// merge transacional — só sobrescreve uma key se o rev recebido for
// estritamente maior que o atual no servidor.

const { db, auth: adminAuth, fieldValue } = require('../_lib/firebase-admin');
const { computeAccess } = require('../_lib/access');

const MAX_KEYS_PER_PUSH = 200;
const MAX_VALUE_BYTES = 200 * 1024; // 200KB por chave (defesa em profundidade)

function isSyncKey(k) {
  if (!k || typeof k !== 'string') return false;
  if (k === 'appliquei_auth_guest') return false;
  if (k.indexOf('appliquei_cloud_') === 0) return false;
  return k.indexOf('futurorico_') === 0 || k.indexOf('appliquei_') === 0;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (_) {
      return null;
    }
  }
  // Fallback: lê stream manualmente (sendBeacon com Blob pode chegar como buffer).
  return await new Promise(function (resolve) {
    const chunks = [];
    let total = 0;
    req.on('data', function (c) {
      total += c.length;
      if (total > 5 * 1024 * 1024) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', function () {
      try {
        const s = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(s));
      } catch (_) {
        resolve(null);
      }
    });
    req.on('error', function () {
      resolve(null);
    });
  });
}

module.exports = async (req, res) => {
  // CORS: sendBeacon é "no-cors" no browser, mas mantemos headers para
  // o caso de o cliente cair em fetch+keepalive (fallback que usamos no JS).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'bad_body' });
  }
  const idToken = body.idToken;
  const keys = body.keys;
  const keyRevs = body.keyRevs;
  if (typeof idToken !== 'string' || !idToken) {
    return res.status(400).json({ error: 'missing_token' });
  }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
    return res.status(400).json({ error: 'missing_keys' });
  }
  if (!keyRevs || typeof keyRevs !== 'object' || Array.isArray(keyRevs)) {
    return res.status(400).json({ error: 'missing_revs' });
  }

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(idToken);
  } catch (_e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  if (!decoded || !decoded.uid) return res.status(401).json({ error: 'invalid_token' });
  if (decoded.email_verified !== true) return res.status(403).json({ error: 'email_not_verified' });

  try {
    const D = db();
    const userRef = D.collection('users').doc(decoded.uid);
    const billingRef = userRef.collection('billing').doc('account');
    const billingSnap = await billingRef.get();
    const access = computeAccess(billingSnap.exists ? billingSnap.data() : null);
    if (access.status === 'blocked') {
      return res.status(403).json({ error: 'access_blocked', reason: access.reason });
    }

    const dataRef = userRef.collection('data').doc('main');
    const FV = fieldValue();

    const result = await D.runTransaction(async (tx) => {
      const snap = await tx.get(dataRef);
      const curRevs = snap.exists ? snap.data().keyRevs || {} : {};
      const exists = snap.exists;

      // Constrói update incremental respeitando LWW por-rev.
      const updateFields = {};
      const initKeys = {};
      const initRevs = {};
      let accepted = 0;
      let count = 0;

      Object.keys(keys).forEach((k) => {
        if (count >= MAX_KEYS_PER_PUSH) return;
        count++;
        if (!isSyncKey(k)) return;
        const rev = Number(keyRevs[k] || 0);
        if (!rev || !isFinite(rev)) return;
        const curRev = Number(curRevs[k] || 0);
        if (curRev >= rev) return;

        const v = keys[k];
        const isDelete = v === null || v === undefined;
        if (!isDelete && typeof v !== 'string') return;
        if (!isDelete && Buffer.byteLength(v, 'utf8') > MAX_VALUE_BYTES) return;

        if (exists) {
          updateFields['keys.' + k] = isDelete ? FV.delete() : v;
          updateFields['keyRevs.' + k] = rev;
        } else {
          if (!isDelete) initKeys[k] = v;
          initRevs[k] = rev;
        }
        accepted++;
      });

      if (accepted === 0) return { accepted: 0 };

      if (exists) {
        updateFields.schemaVersion = 2;
        updateFields.updatedAt = FV.serverTimestamp();
        tx.update(dataRef, updateFields);
      } else {
        tx.set(dataRef, {
          schemaVersion: 2,
          keys: initKeys,
          keyRevs: initRevs,
          updatedAt: FV.serverTimestamp(),
        });
      }
      return { accepted };
    });

    return res.status(200).json({ ok: true, accepted: result.accepted });
  } catch (e) {
    console.error('[sync-push]', e && (e.code || e.message), decoded && decoded.uid);
    return res.status(500).json({ error: 'push_failed' });
  }
};
