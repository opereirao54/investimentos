/**
 * Cria documentos seed em `webhookEvents` e `rateLimits` com o campo
 * `expiresAt` já preenchido como timestamp. Necessário quando essas
 * coleções ainda não existem (ou estão vazias) e o Firebase Console
 * recusa criar a política TTL porque "não encontra o campo".
 *
 * Uso:
 *   FIREBASE_SERVICE_ACCOUNT_BASE64=... node scripts/seed-ttl-collections.js
 *
 * Os docs criados têm expiresAt = agora+1h, então quando a política TTL
 * estiver ativa, eles são apagados sozinhos na primeira varredura.
 */
const admin = require('firebase-admin');

function loadServiceAccount() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!b64) {
    console.error('Defina FIREBASE_SERVICE_ACCOUNT_BASE64 (mesmo valor que está no Vercel).');
    process.exit(1);
  }
  const json = Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json);
}

async function main() {
  const sa = loadServiceAccount();
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: process.env.FIREBASE_PROJECT_ID || sa.project_id,
  });
  const db = admin.firestore();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);

  const targets = [
    { collection: 'webhookEvents', docId: '_ttl_seed' },
    { collection: 'rateLimits', docId: '_ttl_seed' },
  ];

  for (const t of targets) {
    const ref = db.collection(t.collection).doc(t.docId);
    await ref.set({
      _seed: true,
      note: 'Documento descartável para destravar a política TTL no Firebase Console. Sera apagado automaticamente quando a política estiver ativa.',
      expiresAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('[seed] ok →', t.collection + '/' + t.docId);
  }

  console.log('\nPróximos passos:');
  console.log('1. Firebase Console → Firestore → TTL → Create policy');
  console.log('2. Collection group: webhookEvents · Timestamp field: expiresAt');
  console.log('3. Repetir para: rateLimits / expiresAt');
  console.log('4. Os docs _ttl_seed serão removidos sozinhos quando o TTL rodar (até 24h).');
  process.exit(0);
}

main().catch(err => {
  console.error('[seed] falhou:', err);
  process.exit(1);
});
