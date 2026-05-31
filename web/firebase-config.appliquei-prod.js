/**
 * Configuração web Firebase — projeto appliquei-prod.
 *
 * Onda 3 — convertido para ES module. Continua setando o global
 * window.__APPLIQUEI_FIREBASE_CONFIG__ para preservar o contrato com
 * appliquei-firebase-init.js (que lê desse global). Para override em
 * dev, edite este arquivo localmente (commit-back não obrigatório).
 */
window.__APPLIQUEI_FIREBASE_CONFIG__ = {
  apiKey: 'AIzaSyABW6nLy_eN7fo63D1ZSDQ4Ejfg1Q8iChQ',
  authDomain: 'appliquei-prod.firebaseapp.com',
  projectId: 'appliquei-prod',
  storageBucket: 'appliquei-prod.firebasestorage.app',
  messagingSenderId: '662305867797',
  appId: '1:662305867797:web:930d37325f9cd8e11e661c',
  measurementId: 'G-FCB2LS8K1D'
};

// App Check — site key do reCAPTCHA v3 (pública). Preencha após criar o
// provider reCAPTCHA v3 em Firebase Console → App Check → Apps → Web.
// Enquanto vazia, o App Check NÃO inicializa (deixa enforcement desligado
// para não quebrar clientes em produção antes do rollout). Passos completos
// de ativação/enforcement em docs/APP-CHECK.md.
window.__APPLIQUEI_APPCHECK_SITE_KEY__ = '';
