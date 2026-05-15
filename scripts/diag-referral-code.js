'use strict';

// Diagnóstico de cupons de indicação (referralCodes vs billing.referralCode).
//
// Usos:
//   node scripts/diag-referral-code.js APP-XXXXXX     -> diagnostica 1 código
//   node scripts/diag-referral-code.js --all          -> varre tudo, lista órfãos
//   node scripts/diag-referral-code.js --fix APP-XXX  -> recria a reserva
//
// Pré-requisito: variável FIREBASE_SERVICE_ACCOUNT_BASE64 no ambiente
// (mesma que a produção usa). Rode local com:
//   FIREBASE_SERVICE_ACCOUNT_BASE64=... node scripts/diag-referral-code.js ...

const path = require('path');
const { db, init, timestamp } = require(path.join(__dirname, '..', 'api', '_lib', 'firebase-admin'));
const codes = require(path.join(__dirname, '..', 'api', '_lib', 'codes'));

function color(s, c) {
  const m = { red: 31, green: 32, yellow: 33, cyan: 36, gray: 90, bold: 1 };
  return '\x1b[' + (m[c] || 0) + 'm' + s + '\x1b[0m';
}

async function diagOne(code) {
  const D = db();
  const c = codes.normalize(code);
  console.log('\n' + color('== ' + c + ' ==', 'bold'));
  if (!codes.isValid(c)) {
    console.log(color('formato inválido (esperado APP-XXXXXX)', 'red'));
    return;
  }

  const resSnap = await D.collection('referralCodes').doc(c).get();
  const reservedUid = resSnap.exists ? resSnap.data().uid : null;
  console.log('referralCodes/' + c + ': ' + (resSnap.exists
    ? color('existe', 'green') + ' (uid=' + reservedUid + ')'
    : color('NÃO existe', 'red')));

  const ownersQ = await D.collectionGroup('billing').where('referralCode', '==', c).get();
  const owners = ownersQ.docs.map(d => ({ uid: d.data().uid, path: d.ref.path, email: d.data().email || null }));
  if (owners.length === 0) {
    console.log('billing.referralCode == ' + c + ': ' + color('nenhum', 'gray'));
  } else {
    console.log('billing.referralCode == ' + c + ':');
    for (const o of owners) console.log('  - ' + o.uid + ' (' + (o.email || '?') + ')  [' + o.path + ']');
  }

  if (resSnap.exists && owners.length === 0) {
    console.log(color('AVISO: reserva existe mas nenhum billing aponta para ela', 'yellow'));
  }
  if (!resSnap.exists && owners.length > 0) {
    console.log(color('ÓRFÃO: billing aponta para um código sem reserva', 'red') +
      ' — corrija com `--fix ' + c + '`');
  }
  if (resSnap.exists && owners.length > 0) {
    const mismatch = owners.filter(o => o.uid !== reservedUid);
    if (mismatch.length === 0) console.log(color('OK: reserva e billing consistentes', 'green'));
    else console.log(color('MISMATCH: reserva.uid != billing.uid em ' + mismatch.length + ' caso(s)', 'red'));
  }
}

async function scanAll() {
  const D = db();
  console.log(color('Varrendo referralCodes/ e billing collectionGroup…', 'cyan'));
  const [resSnap, billSnap] = await Promise.all([
    D.collection('referralCodes').get(),
    D.collectionGroup('billing').where('referralCode', '!=', null).get(),
  ]);
  const reserved = new Map();
  resSnap.docs.forEach(d => reserved.set(d.id, d.data().uid));
  const inBilling = new Map();
  billSnap.docs.forEach(d => {
    const v = d.data();
    if (!v.referralCode) return;
    const arr = inBilling.get(v.referralCode) || [];
    arr.push({ uid: v.uid, email: v.email, path: d.ref.path });
    inBilling.set(v.referralCode, arr);
  });

  const orphans = [];
  const dangling = [];
  const mismatches = [];
  for (const [code, owners] of inBilling.entries()) {
    if (!reserved.has(code)) {
      orphans.push({ code, owners });
    } else {
      const rUid = reserved.get(code);
      const bad = owners.filter(o => o.uid !== rUid);
      if (bad.length) mismatches.push({ code, reservedUid: rUid, owners });
    }
  }
  for (const [code, rUid] of reserved.entries()) {
    if (!inBilling.has(code)) dangling.push({ code, reservedUid: rUid });
  }

  console.log('\n' + color('Resultado:', 'bold'));
  console.log('  total reservas (referralCodes/): ' + reserved.size);
  console.log('  total billing com referralCode:  ' + Array.from(inBilling.values()).reduce((a, b) => a + b.length, 0));
  console.log('  ' + color('órfãos (billing sem reserva): ' + orphans.length, orphans.length ? 'red' : 'green'));
  console.log('  ' + color('mismatches (uid divergente): ' + mismatches.length, mismatches.length ? 'red' : 'green'));
  console.log('  ' + color('reservas sem billing dono:    ' + dangling.length, dangling.length ? 'yellow' : 'green'));

  if (orphans.length) {
    console.log('\n' + color('Órfãos (precisam --fix):', 'red'));
    for (const o of orphans) {
      console.log('  ' + o.code + ' -> ' + o.owners.map(x => x.uid).join(', '));
    }
  }
  if (mismatches.length) {
    console.log('\n' + color('Mismatches:', 'red'));
    for (const m of mismatches) {
      console.log('  ' + m.code + ' reservedUid=' + m.reservedUid + ', billing uids=' + m.owners.map(x => x.uid).join(','));
    }
  }
}

async function fixOne(code) {
  const D = db();
  const c = codes.normalize(code);
  if (!codes.isValid(c)) { console.log(color('formato inválido', 'red')); return; }

  const ownersQ = await D.collectionGroup('billing').where('referralCode', '==', c).get();
  if (ownersQ.empty) {
    console.log(color('Nenhum billing tem esse código — nada a corrigir.', 'yellow'));
    return;
  }
  if (ownersQ.size > 1) {
    console.log(color('Mais de um billing tem esse código:', 'red'));
    ownersQ.docs.forEach(d => console.log('  - ' + d.data().uid + ' [' + d.ref.path + ']'));
    console.log('Corrija manualmente — não vou adivinhar o dono.');
    return;
  }
  const uid = ownersQ.docs[0].data().uid;
  const ok = await codes.ensureReserved(D, c, uid, timestamp());
  console.log(ok
    ? color('Reserva recriada: referralCodes/' + c + ' -> uid=' + uid, 'green')
    : color('Já existia reserva com outro uid — não sobrescrevi.', 'yellow'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Uso: node scripts/diag-referral-code.js <APP-XXXXXX | --all | --fix APP-XXXXXX>');
    process.exit(1);
  }
  init();
  if (args[0] === '--all') return scanAll();
  if (args[0] === '--fix') {
    if (!args[1]) { console.log('Faltou o código depois de --fix'); process.exit(1); }
    return fixOne(args[1]);
  }
  return diagOne(args[0]);
}

main().then(() => process.exit(0)).catch(e => {
  console.error(color('Falhou:', 'red'), e);
  process.exit(2);
});
