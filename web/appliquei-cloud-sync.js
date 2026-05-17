/**
 * Sincronização segura: espelha chaves da app (futurorico_* / appliquei_*)
 * em Firestore em users/{uid}/data/main — só após login Firebase.
 * Requer firestore.rules publicados (ver firestore.rules na raiz do projeto).
 */
(function () {
  var DEBOUNCE_MS = 4000;
  var timer = null;
  var applyingPull = false;
  var authHooked = false;
  var pullInFlight = false;
  var initialPullDone = false; // Previne pushes antes da restauração completa

  function shouldSyncKey(key) {
    if (!key || typeof key !== 'string') return false;
    if (key === 'appliquei_auth_guest') return false;
    if (key.indexOf('appliquei_cloud_') === 0) return false;
    return key.indexOf('futurorico_') === 0 || key.indexOf('appliquei_') === 0;
  }

  /** Compara valores de localStorage com o que veio do Firestore (strings / JSON). */
  function storageValuesEqual(cur, next) {
    if (cur === next) return true;
    var a = cur == null ? '' : String(cur);
    var b = next == null ? '' : String(next);
    if (a === b) return true;
    try {
      return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
    } catch (_) {
      return false;
    }
  }

  function tsMillis(t) {
    if (!t) return null;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.seconds === 'number') return t.seconds * 1000;
    return null;
  }

  function collectKeysPayload() {
    var out = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (shouldSyncKey(k)) out[k] = localStorage.getItem(k);
      }
    } catch (e) {
      console.warn('[AppliqueiCloudSync] collect', e);
    }
    return out;
  }

  function mainRef(uid) {
    var db = window.AppliqueiFirebase && AppliqueiFirebase.db;
    if (!db) throw new Error('Firestore não inicializado');
    return db.collection('users').doc(uid).collection('data').doc('main');
  }

  function flushPush() {
    if (!initialPullDone) return;
    timer = null;
    var fb = window.AppliqueiFirebase;
    if (!fb || !fb.ready || !fb.db || !fb.auth) return;
    var u = fb.auth.currentUser;
    if (!u) return;
    var keys = collectKeysPayload();
    var payload = {
      keys: keys,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 1
    };
    mainRef(u.uid)
      .set(payload, { merge: true })
      .then(function () {
        return mainRef(u.uid).get({ source: 'server' });
      })
      .then(function (snap) {
        if (!snap.exists) return;
        var d = snap.data() || {};
        var r = tsMillis(d.updatedAt);
        if (r != null) {
          try {
            localStorage.setItem('appliquei_cloud_applied_rev', String(r));
          } catch (_) {}
        }
      })
      .catch(function (err) {
        console.warn('[AppliqueiCloudSync] push', err);
        if (typeof window.mostrarToast === 'function') {
          window.mostrarToast(
            'Não foi possível guardar na nuvem. Verifique as regras do Firestore e a rede.',
            'erro'
          );
        }
      });
  }

  function schedulePush() {
    if (!initialPullDone) return;
    if (!window.AppliqueiFirebase || !AppliqueiFirebase.ready || !AppliqueiFirebase.auth.currentUser) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flushPush, DEBOUNCE_MS);
  }

  function pullAndApply(uid, done) {
    if (pullInFlight) {
      if (done) done(false);
      return;
    }
    pullInFlight = true;
    mainRef(uid)
      .get({ source: 'server' })
      .then(function (snap) {
        if (!snap.exists) {
          initialPullDone = true;
          flushPush();
          pullInFlight = false;
          if (done) done(false);
          return;
        }
        var data = snap.data() || {};
        var keys = data.keys || {};
        var rev = tsMillis(data.updatedAt);
        var prevRev = null;
        try {
          prevRev = parseInt(localStorage.getItem('appliquei_cloud_applied_rev') || '0', 10);
        } catch (_) {
          prevRev = 0;
        }
        if (rev != null && prevRev && rev === prevRev) {
          initialPullDone = true;
          pullInFlight = false;
          if (done) done(false);
          return;
        }

        var changed = 0;
        applyingPull = true;
        try {
          Object.keys(keys).forEach(function (k) {
            if (!shouldSyncKey(k)) return;
            try {
              var next = keys[k];
              if (next === undefined || next === null) return;
              var cur = localStorage.getItem(k);
              if (!storageValuesEqual(cur, next)) {
                localStorage.setItem(k, String(next));
                changed++;
              }
            } catch (e) {
              console.warn('[AppliqueiCloudSync] apply key', k, e);
            }
          });
        } finally {
          applyingPull = false;
        }

        try {
          if (rev != null) localStorage.setItem('appliquei_cloud_applied_rev', String(rev));
        } catch (_) {}

        initialPullDone = true;

        if (changed > 0) {
          if (typeof window.mostrarToast === 'function') {
            window.mostrarToast(
              'Dados da nuvem restaurados! Atualizando a página para carregar as informações...',
              'sucesso'
            );
          }
          setTimeout(function() {
            window.location.reload();
          }, 1500);
        }
        pullInFlight = false;
        if (done) done(changed > 0);
      })
      .catch(function (err) {
        console.warn('[AppliqueiCloudSync] pull', err);
        initialPullDone = true;
        pullInFlight = false;
        if (typeof window.mostrarToast === 'function') {
          window.mostrarToast(
            'Não foi possível ler dados na nuvem (regras Firestore ou rede).',
            'erro'
          );
        }
        if (done) done(false);
      });
  }

  function onUser(user) {
    if (!user) {
      if (timer) clearTimeout(timer);
      timer = null;
      // Logout: limpa dados do usuário deste browser para evitar vazamento
      // entre contas no mesmo navegador. Próximo signup novo nao vai
      // empurrar dados antigos para o doc do user novo.
      clearUserScopedKeys();
      initialPullDone = false;
      try { localStorage.removeItem(LAST_UID_KEY); } catch (_) {}
      return;
    }
    var last = lastSeenUid();
    if (last && last !== user.uid) {
      // Trocou de conta neste browser. Limpa o que sobrou da conta anterior
      // antes do pull, e zera o initialPullDone para que NÃO ocorra push
      // de localStorage stale para o doc do user novo.
      clearUserScopedKeys();
      initialPullDone = false;
      try { localStorage.setItem(LAST_UID_KEY, user.uid); } catch (_) {}
      // Reload para que a UI deixe de mostrar dados em memória da conta
      // anterior. O pull do user novo ocorre após o reload via attachWhenReady.
      try {
        if (window.AppliqueiFirebase && AppliqueiFirebase.auth && AppliqueiFirebase.auth.currentUser) {
          if (typeof window.mostrarToast === 'function') {
            window.mostrarToast('Trocando de conta — recarregando…', 'sucesso');
          }
          setTimeout(function () { try { location.reload(); } catch (_) {} }, 400);
        }
      } catch (_) {}
      return;
    }
    try { localStorage.setItem(LAST_UID_KEY, user.uid); } catch (_) {}
    pullAndApply(user.uid, function () {});
  }

  var LAST_UID_KEY = 'appliquei_cloud_last_uid';
  function lastSeenUid() {
    try { return localStorage.getItem(LAST_UID_KEY) || ''; } catch (_) { return ''; }
  }
  function clearUserScopedKeys() {
    try {
      var toRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && shouldSyncKey(k)) toRemove.push(k);
      }
      toRemove.forEach(function (k) { try { localStorage.removeItem(k); } catch (_) {} });
      localStorage.removeItem('appliquei_cloud_applied_rev');
    } catch (_) {}
  }

  function attach() {
    var fb = window.AppliqueiFirebase;
    if (!fb || !fb.ready || !fb.auth) return;
    if (authHooked) return;
    authHooked = true;
    fb.auth.onAuthStateChanged(onUser);
  }

  var attachAttempts = 0;
  function attachWhenReady() {
    attachAttempts++;
    if (attachAttempts > 60) return;
    if (window.AppliqueiFirebase && AppliqueiFirebase.ready && AppliqueiFirebase.auth) {
      attach();
      return;
    }
    setTimeout(attachWhenReady, 250);
  }
  attachWhenReady();

  window.AppliqueiCloudSync = {
    onLocalWrite: function (key) {
      if (applyingPull) return;
      if (!shouldSyncKey(key)) return;
      schedulePush();
    },
    flushNow: flushPush,
    pullNow: function (cb) {
      var u = window.AppliqueiFirebase && AppliqueiFirebase.auth && AppliqueiFirebase.auth.currentUser;
      if (u) pullAndApply(u.uid, cb || function () {});
    }
  };
})();
