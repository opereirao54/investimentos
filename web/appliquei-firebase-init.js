/**
 * Inicialização Firebase (compat). Em Appliquei_v13.0.html o mesmo bloco está
 * inline no <head> para funcionar mesmo se web/*.js não carregar (file://, 404).
 * Mantém este ficheiro alinhado ao script inline ao alterar a config.
 */
(function () {
  var w = window;
  var cfg = w.__APPLIQUEI_FIREBASE_CONFIG__ || {};
  var k0 = (cfg.apiKey && String(cfg.apiKey).trim()) || '';
  if (!k0 || k0 === 'REPLACE') {
    w.__APPLIQUEI_FIREBASE_CONFIG__ = {
      apiKey: 'AIzaSyABW6nLy_eN7fo63D1ZSDQ4Ejfg1Q8iChQ',
      authDomain: 'appliquei-prod.firebaseapp.com',
      projectId: 'appliquei-prod',
      storageBucket: 'appliquei-prod.firebasestorage.app',
      messagingSenderId: '662305867797',
      appId: '1:662305867797:web:930d37325f9cd8e11e661c',
      measurementId: 'G-FCB2LS8K1D',
    };
  }
  w.AppliqueiFirebase = { ready: false, app: null, auth: null, db: null, analytics: null };
  var c = w.__APPLIQUEI_FIREBASE_CONFIG__ || {};
  var key = (c.apiKey && String(c.apiKey).trim()) || '';
  if (!key || key === 'REPLACE' || typeof firebase === 'undefined') return;
  try {
    w.AppliqueiFirebase.app = firebase.apps.length ? firebase.app() : firebase.initializeApp(c);
    w.AppliqueiFirebase.auth = firebase.auth();
    w.AppliqueiFirebase.db = firebase.firestore();
    try {
      w.AppliqueiFirebase.db.enablePersistence({ synchronizeTabs: true }).catch(function () {});
    } catch (eP) {}
    if (typeof firebase.analytics === 'function' && c.measurementId) {
      try {
        w.AppliqueiFirebase.analytics = firebase.analytics();
      } catch (e2) {
        console.warn('[AppliqueiFirebase] Analytics', e2);
      }
    }
    w.AppliqueiFirebase.ready = true;
  } catch (e) {
    console.warn('[AppliqueiFirebase]', e);
  }
})();
