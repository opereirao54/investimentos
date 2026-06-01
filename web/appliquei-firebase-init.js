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
    w.AppliqueiFirebase = {
      ready: false,
      app: null,
      auth: null,
      db: null,
      analytics: null,
      appCheckActivated: false,
    };
  }
  const cfg = w.__APPLIQUEI_FIREBASE_CONFIG__ || {};
  const key = (cfg.apiKey && String(cfg.apiKey).trim()) || '';
  if (!key || key === 'REPLACE' || typeof firebase === 'undefined') {
    return w.AppliqueiFirebase;
  }
  try {
    w.AppliqueiFirebase.app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);

    // App Check — anexa um token de atestação (reCAPTCHA v3) às chamadas dos
    // serviços Firebase (Auth, Firestore). Com o enforcement ligado no
    // console, impede que a apiKey pública seja usada fora do app para abusar
    // de Auth/Firestore (criação de contas em massa, consumo de quota). Os
    // dados seguem protegidos por uid pelas Security Rules; o App Check fecha
    // o canal de abuso/custo. Ativado ANTES de auth()/firestore() para os
    // tokens já acompanharem as primeiras chamadas.
    //
    // Gated na presença da site key pública (window.__APPLIQUEI_APPCHECK_SITE_KEY__)
    // e no script firebase-app-check-compat.js: sem qualquer um deles — dev/local
    // ou ambiente ainda não configurado — o App Check é pulado e o app segue
    // normal. Idempotente via flag appCheckActivated. Ver docs/APP-CHECK.md.
    var appCheckSiteKey = (cfg.appCheckSiteKey || w.__APPLIQUEI_APPCHECK_SITE_KEY__ || '').trim();
    if (
      appCheckSiteKey &&
      !w.AppliqueiFirebase.appCheckActivated &&
      typeof firebase.appCheck === 'function'
    ) {
      try {
        // Em dev, defina window.__APPLIQUEI_APPCHECK_DEBUG__ = true (gera um
        // debug token impresso no console) ANTES deste módulo. Não comitar em
        // produção. Ver docs/APP-CHECK.md.
        if (w.__APPLIQUEI_APPCHECK_DEBUG__) {
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = w.__APPLIQUEI_APPCHECK_DEBUG__;
        }
        firebase
          .appCheck()
          .activate(new firebase.appCheck.ReCaptchaV3Provider(appCheckSiteKey), true);
        w.AppliqueiFirebase.appCheckActivated = true;
      } catch (eAppCheck) {
        // App Check nunca pode derrubar o bootstrap: se falhar (site key
        // inválida, script ausente), loga e segue — o enforcement do servidor
        // decide o resto.
        console.warn('[AppliqueiFirebase] App Check', eAppCheck);
      }
    }

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
