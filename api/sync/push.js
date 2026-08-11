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

// Teto por chave. O documento do Firestore tem limite RÍGIDO de 1 MiB, então
// nenhuma chave sozinha pode chegar perto disso.
//
// Este teto era 200KB e foi a causa raiz confirmada de "grava no PC mas não no
// celular" (ver DIAGNOSTICO-SYNC.md). futurorico_transacoes guarda TODAS as
// transações num único JSON e chega a 354KB numa carteira de uso normal. O
// `return` que aplicava o teto ficava dentro do forEach: a chave era descartada
// em SILÊNCIO, não entrava em `accepted`, não gerava erro, e o endpoint
// respondia HTTP 200. O cliente exibia "Salvo às HH:MM" para um write que nunca
// existiu. No PC o push via SDK (sem este teto) tinha tempo de completar; no
// celular o tab congela antes e só resta o beacon — que morria aqui.
//
// Duas mudanças: o teto passou a ser compatível com o limite real do Firestore,
// e NENHUMA rejeição é mais silenciosa (ver `rejected[]` abaixo).
const MAX_VALUE_BYTES = 800 * 1024;

// Teto do documento inteiro, com folga sobre o 1 MiB do Firestore — que conta
// nomes de campo e overhead de serialização, não só os valores. Sem esta
// checagem, estourar o limite viraria uma exceção opaca na transação.
const MAX_DOC_BYTES = 900 * 1024;

function byteLen(s) {
  return Buffer.byteLength(String(s == null ? '' : s), 'utf8');
}

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
      const exists = snap.exists;
      const cur = exists ? snap.data() || {} : {};
      const curRevs = cur.keyRevs || {};
      const curKeys = cur.keys || {};

      // Constrói update incremental respeitando LWW por-rev.
      const updateFields = {};
      const initKeys = {};
      const initRevs = {};
      // Toda chave recusada entra aqui com o motivo. É o que impede este
      // endpoint de voltar a mentir sucesso: o cliente lê `rejected` e mostra
      // erro em vez de "Salvo".
      const rejected = [];
      let accepted = 0;
      let stale = 0;
      let count = 0;

      // Base do documento projetado: as chaves que este push NÃO toca. As que
      // ele toca entram abaixo, já com o tamanho novo.
      const incoming = Object.keys(keys);
      const touched = new Set(incoming);
      let projected = 0;
      Object.keys(curKeys).forEach((k) => {
        if (touched.has(k)) return;
        projected += byteLen(k) + byteLen(curKeys[k]);
      });

      incoming.forEach((k) => {
        if (count >= MAX_KEYS_PER_PUSH) {
          rejected.push({ key: k, reason: 'too_many_keys', limit: MAX_KEYS_PER_PUSH });
          return;
        }
        count++;
        if (!isSyncKey(k)) {
          rejected.push({ key: k, reason: 'not_syncable' });
          return;
        }
        const rev = Number(keyRevs[k] || 0);
        if (!rev || !isFinite(rev)) {
          rejected.push({ key: k, reason: 'bad_rev' });
          return;
        }
        const curRev = Number(curRevs[k] || 0);
        // Rev antigo é o LWW funcionando como projetado (outro device gravou
        // depois), não uma falha — contabilizado à parte de `rejected`.
        if (curRev >= rev) {
          stale++;
          return;
        }

        const v = keys[k];
        const isDelete = v === null || v === undefined;
        if (!isDelete && typeof v !== 'string') {
          rejected.push({ key: k, reason: 'bad_value' });
          return;
        }

        const bytes = isDelete ? 0 : byteLen(v);
        if (bytes > MAX_VALUE_BYTES) {
          rejected.push({ key: k, reason: 'too_large', bytes, limit: MAX_VALUE_BYTES });
          return;
        }
        if (projected + byteLen(k) + bytes > MAX_DOC_BYTES) {
          rejected.push({
            key: k,
            reason: 'doc_full',
            bytes,
            docBytes: projected,
            limit: MAX_DOC_BYTES,
          });
          return;
        }
        projected += byteLen(k) + bytes;

        if (exists) {
          updateFields['keys.' + k] = isDelete ? FV.delete() : v;
          updateFields['keyRevs.' + k] = rev;
        } else {
          if (!isDelete) initKeys[k] = v;
          initRevs[k] = rev;
        }
        accepted++;
      });

      if (accepted === 0) return { accepted: 0, rejected, stale, docBytes: projected };

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
      return { accepted, rejected, stale, docBytes: projected };
    });

    return res.status(200).json({
      ok: true,
      accepted: result.accepted,
      stale: result.stale,
      docBytes: result.docBytes,
      rejected: result.rejected,
    });
  },
});
