const admin = require('firebase-admin');

let app = null;

function init() {
  if (app) return app;
  if (admin.apps.length) {
    app = admin.app();
    return app;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
    || process.env.FIREBASE_SERVICE_ACCOUNT
    || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 não definida.');

  const cleaned = raw.replace(/\s+/g, '');
  let decoded;
  if (cleaned.startsWith('{')) {
    decoded = raw;
  } else {
    decoded = Buffer.from(cleaned, 'base64').toString('utf8');
  }
  if (decoded.includes('\\n') && !decoded.includes('\n-----BEGIN')) {
    decoded = decoded.replace(/\\n/g, '\n');
  }

  let json;
  try {
    json = JSON.parse(decoded);
  } catch (e) {
    throw new Error('service_account_invalid_json: ' + e.message + ' (decoded length=' + decoded.length + ')');
  }
  if (json.private_key && json.private_key.indexOf('\\n') !== -1 && json.private_key.indexOf('\n') === -1) {
    json.private_key = json.private_key.replace(/\\n/g, '\n');
  }
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
