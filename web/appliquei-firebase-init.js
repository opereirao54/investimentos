/**
 * Inicialização Firebase — ES module (Onda 3, primeira conversão).
 *
 * API:
 *   import { initFirebase, getFirebase } from '/web/appliquei-firebase-init.js';
 *   initFirebase();                  // idempotente
 *   const fb = getFirebase();        // { ready, app, auth, db, analytics }
 *
 * Side effect: o próprio import já chama initFirebase(). Preserva o
 * contrato do IIFE original — código existente que depende do global
 * `window.AppliqueiFirebase` continua funcionando sem mudanças.
 *
 * Convivência com o bloco inline em Appliquei_v13.0.html: o inline roda
 * durante o parsing (sync); este módulo roda depois (deferred). Ambos
 * são idempotentes — firebase.apps.length impede dupla inicialização.
 * O inline permanece como defesa em profundidade até a Onda 3 amadurecer.
 */

const DEFAULT_CONFIG = {
  apiKey: 'AIzaSyABW6nLy_eN7fo63D1ZSDQ4Ejfg1Q8iChQ',
  authDomain: 'appliquei-prod.firebaseapp.com',
  projectId: 'appliquei-prod',
  storageBucket: 'appliquei-prod.firebasestorage.app',
  messagingSenderId: '662305867797',
  appId: '1:662305867797:web:930d37325f9cd8e11e661c',
  measurementId: 'G-FCB2LS8K1D',
};

export function initFirebase() {
  const w = window;
  const existing = w.__APPLIQUEI_FIREBASE_CONFIG__ || {};
  const existingKey = (existing.apiKey && String(existing.apiKey).trim()) || '';
  if (!existingKey || existingKey === 'REPLACE') {
    w.__APPLIQUEI_FIREBASE_CONFIG__ = { ...DEFAULT_CONFIG };
  }
  if (!w.AppliqueiFirebase) {
    w.AppliqueiFirebase = { ready: false, app: null, auth: null, db: null, analytics: null };
  }
  const cfg = w.__APPLIQUEI_FIREBASE_CONFIG__ || {};
  const key = (cfg.apiKey && String(cfg.apiKey).trim()) || '';
  if (!key || key === 'REPLACE' || typeof firebase === 'undefined') {
    return w.AppliqueiFirebase;
  }
  try {
    w.AppliqueiFirebase.app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    w.AppliqueiFirebase.auth = firebase.auth();
    w.AppliqueiFirebase.db = firebase.firestore();
    try {
      w.AppliqueiFirebase.db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    } catch (_ePersist) {
      // enablePersistence pode falhar em contextos sem IndexedDB (private mode);
      // não é fatal — auth/firestore seguem funcionando em memória.
    }
    if (typeof firebase.analytics === 'function' && cfg.measurementId) {
      try {
        w.AppliqueiFirebase.analytics = firebase.analytics();
      } catch (eAnalytics) {
        console.warn('[AppliqueiFirebase] Analytics', eAnalytics);
      }
    }
    w.AppliqueiFirebase.ready = true;
  } catch (e) {
    console.warn('[AppliqueiFirebase]', e);
  }
  return w.AppliqueiFirebase;
}

export function getFirebase() {
  return (typeof window !== 'undefined' && window.AppliqueiFirebase) || null;
}

// Auto-init no import — espelha o IIFE original. Importadores que
// quiserem controlar o timing podem chamar initFirebase() de novo (no-op).
if (typeof window !== 'undefined') {
  initFirebase();
}
