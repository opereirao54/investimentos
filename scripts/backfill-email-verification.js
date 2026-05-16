'use strict';

// Backfill: identifica contas Firebase Auth com emailVerified=false e
// dispara reenvio do e-mail de verificação. Útil antes de ativar
// EMAIL_VERIFY_ENFORCE=true para que usuários legados não fiquem
// presos.
//
// Estratégia:
// 1. Lista todos os users via auth().listUsers() em páginas.
// 2. Filtra os com emailVerified=false e providerData incluindo password
//    (não toca em quem só tem provider social — google.com já vem verificado).
// 3. Para cada um, gera link de verificação e (em modo --send) chama uma
//    API SMTP custom; em modo --dry-run, só lista.
// 4. Grava marcador users/{uid}/billing/account.emailVerificationSentAt
//    para evitar reenvio em loop.
//
// O Firebase Admin SDK NÃO envia e-mail diretamente (só gera o link).
// Em produção há 3 caminhos práticos:
//   A) Pedir aos usuários para se relogarem — o app dispara sendEmailVerification
//      automaticamente quando vê emailVerified=false (já implementado).
//   B) Mandar e-mail por SMTP custom (SendGrid/Mailgun) com o link gerado.
//   C) Usar Firebase Trigger Email Extension (firestore-send-email).
//
// Este script implementa (A) — apenas grava sinalizador e imprime relatório.
// Para (B), basta editar a função sendMail() abaixo.
//
// Uso:
//   FIREBASE_SERVICE_ACCOUNT_BASE64=... node scripts/backfill-email-verification.js --dry-run
//   FIREBASE_SERVICE_ACCOUNT_BASE64=... node scripts/backfill-email-verification.js --send

const path = require('path');
const { auth, db, fieldValue } = require(path.join(__dirname, '..', 'api', '_lib', 'firebase-admin'));

function color(s, c) {
  const m = { red: 31, green: 32, yellow: 33, cyan: 36, gray: 90, bold: 1 };
  return '\x1b[' + (m[c] || 0) + 'm' + s + '\x1b[0m';
}

const APP_ORIGIN = (process.env.APP_ORIGIN || '').replace(/\/$/, '');

async function sendMail(/* email, link */) {
  // Placeholder. Plugar SMTP custom aqui quando disponível.
  // Em modo --send sem SMTP plugado, apenas marca como "pendente envio
  // por relogin": o app dispara sendEmailVerification ao detectar
  // emailVerified=false no proximo login.
  return { skipped: true, reason: 'no-smtp-configured' };
}

function hasPasswordProvider(u) {
  return Array.isArray(u.providerData) && u.providerData.some(p => p.providerId === 'password');
}

async function listAllUsers() {
  const out = [];
  let pageToken;
  do {
    const page = await auth().listUsers(1000, pageToken);
    out.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return out;
}

async function markBilling(uid) {
  try {
    const ref = db().collection('users').doc(uid).collection('billing').doc('account');
    await ref.set({
      emailVerificationSentAt: fieldValue().serverTimestamp(),
    }, { merge: true });
  } catch (_) {}
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--send');
  console.log(color('Modo: ' + (dryRun ? 'dry-run (apenas relatório)' : 'send (gera links e marca)'), 'cyan'));

  const users = await listAllUsers();
  const candidates = users.filter(u => !u.emailVerified && u.email && hasPasswordProvider(u));
  console.log(color('Total users: ' + users.length, 'gray'));
  console.log(color('Candidatos (email/senha + nao verificado): ' + candidates.length, 'bold'));

  let sent = 0, skipped = 0;
  for (const u of candidates) {
    try {
      const link = await auth().generateEmailVerificationLink(u.email, APP_ORIGIN ? { url: APP_ORIGIN + '/' } : undefined);
      if (dryRun) {
        console.log(color('[dry] ', 'gray') + u.uid + '  ' + u.email);
        continue;
      }
      const r = await sendMail(u.email, link);
      if (r && r.skipped) {
        // Sem SMTP plugado: marca para que o app dispare verificação no
        // próximo onAuthStateChanged. Como nosso fluxo já dispara
        // sendEmailVerification() em qualquer signup novo, este é o
        // caminho mais seguro: confiar no fluxo do cliente quando o user
        // voltar.
        await markBilling(u.uid);
        skipped++;
        console.log(color('[mark] ', 'yellow') + u.uid + '  ' + u.email);
      } else {
        await markBilling(u.uid);
        sent++;
        console.log(color('[send] ', 'green') + u.uid + '  ' + u.email);
      }
    } catch (e) {
      console.warn(color('[err] ', 'red') + u.uid + '  ' + u.email + '  ' + (e && e.code), e && e.message);
    }
  }

  console.log('');
  console.log(color('Concluido. enviados=' + sent + ' marcados=' + skipped + ' total=' + candidates.length, 'bold'));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
