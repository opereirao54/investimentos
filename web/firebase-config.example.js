/**
 * Defaults vazios (Firebase não inicializa, app só roda local).
 * appliquei-firebase-init.js detecta e cai num path vazio.
 *
 * Onda 3 — ES module. Em produção é sobrescrito por
 * firebase-config.appliquei-prod.js (carregado depois na document order).
 */
window.__APPLIQUEI_FIREBASE_CONFIG__ = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

// App Check — site key do reCAPTCHA v3 (pública, igual à apiKey do Firebase).
// Vazia = App Check não inicializa (app roda local sem atestação). Em produção
// é sobrescrita por firebase-config.appliquei-prod.js. Ver docs/APP-CHECK.md.
window.__APPLIQUEI_APPCHECK_SITE_KEY__ = '';
