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
