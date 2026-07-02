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
const { handler } = require('../_lib/handler');
const { syncPushBody } = require('../_lib/schemas');
const { computeAccess } = require('../_lib/access');

const MAX_KEYS_PER_PUSH = 200;
// 500KB por chave. Era 200KB — atingível por futurorico_transacoes (despesas
// fixas geram 60 lançamentos cada) e a chave era DESCARTADA em silêncio: a
// despesa "não gravava" para sempre, enquanto chaves menores sincronizavam.
// O teto real continua sendo 1MB/documento do Firestore; chaves rejeitadas
// agora voltam nomeadas na resposta para o cliente avisar o usuário.
const MAX_VALUE_BYTES = 500 * 1024;

function isSyncKey(k) {
  if (!k || typeof k !== 'string') return false;
  if (k === 'appliquei_auth_guest') return false;
  if (k.indexOf('appliquei_cloud_') === 0) return false;
  return k.indexOf('futurorico_') === 0 || k.indexOf('appliquei_') === 0;
}

module.exports = handler({
  method: 'POST',
  // Token vem no body (sendBeacon não permite headers); verificação manual
  // após Zod confirmar estrutura.
  auth: 'none',
  bodySchema: syncPushBody,
  handle: async ({ res, body }) => {
    const { idToken, keys, keyRevs } = body;

    let decoded;
    try {
      decoded = await adminAuth().verifyIdToken(idToken);
    } catch (_e) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    if (!decoded || !decoded.uid) return res.status(401).json({ error: 'invalid_token' });
    if (decoded.email_verified !== true) {
      return res.status(403).json({ error: 'email_not_verified' });
    }

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
      let written = 0;
      let count = 0;
      // Diagnóstico de volta ao cliente: antes, chaves grandes/invalidas eram
      // descartadas em SILÊNCIO (o cliente via 200 ok e achava que gravou).
      //   rejected: inválidas (tamanho/tipo) — o cliente avisa o usuário;
      //   stale:    perderam o LWW (outro device tem rev maior) — o cliente
      //             puxa o remoto, faz merge por registro e reenvia.
      const rejected = [];
      const stale = [];

      Object.keys(keys).forEach((k) => {
        if (count >= MAX_KEYS_PER_PUSH) return;
        count++;
        if (!isSyncKey(k)) return;
        const rev = Number(keyRevs[k] || 0);
        if (!rev || !isFinite(rev)) {
          rejected.push(k);
          return;
        }
        const curRev = Number(curRevs[k] || 0);
        if (curRev === rev) {
          // Duplicata exata: o cliente reenvia o mesmo payload de propósito
          // (eager + debounce + visibilitychange, para sobreviver ao freeze
          // do iOS). Já está aplicado — ack idempotente, sem reescrever.
          // Antes caía em "stale" e o cliente reportava conflito falso.
          accepted++;
          return;
        }
        if (curRev > rev) {
          stale.push(k);
          return;
        }

        const v = keys[k];
        const isDelete = v === null || v === undefined;
        if (!isDelete && typeof v !== 'string') {
          rejected.push(k);
          return;
        }
        if (!isDelete && Buffer.byteLength(v, 'utf8') > MAX_VALUE_BYTES) {
          rejected.push(k);
          return;
        }

        if (exists) {
          updateFields['keys.' + k] = isDelete ? FV.delete() : v;
          updateFields['keyRevs.' + k] = rev;
        } else {
          if (!isDelete) initKeys[k] = v;
          initRevs[k] = rev;
        }
        accepted++;
        written++;
      });

      // Nada NOVO para gravar (só duplicatas/stale/rejeitadas): responde sem
      // tocar no doc — duplicatas contam como accepted (ack idempotente).
      if (written === 0) return { accepted, rejected, stale };

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
      return { accepted, rejected, stale };
    });

    return res.status(200).json({
      ok: true,
      accepted: result.accepted,
      rejected: result.rejected,
      stale: result.stale,
    });
  },
});
