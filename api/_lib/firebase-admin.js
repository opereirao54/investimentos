const admin = require('firebase-admin');

let app = null;

function init() {
  if (app) return app;
  if (admin.apps.length) {
    app = admin.app();
    return app;
  }
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!b64) throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 não definida.');
  const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  app = admin.initializeApp({
    credential: admin.credential.cert(json),
    projectId: process.env.FIREBASE_PROJECT_ID || json.project_id,
  });
  return app;
}

function db() {
  init();
  return admin.firestore();
}

function auth() {
  init();
  return admin.auth();
}

function fieldValue() {
  return admin.firestore.FieldValue;
}

function timestamp() {
  return admin.firestore.Timestamp;
}

module.exports = { init, db, auth, fieldValue, timestamp };
