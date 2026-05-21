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
  var unsubscribeSnapshot = null;
  var listenerUid = null;
  var pendingLocalWrite = false; // true quando há escritas locais ainda não enviadas

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
    pendingLocalWrite = false;
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
        // permission-denied = Firestore rules bloquearam o write porque o
        // utilizador não tem acesso ativo (trial expirado, fatura em aberto,
        // assinatura cancelada). A UI de "Minha assinatura" já comunica
        // este estado, portanto não duplicamos com um toast genérico.
        if (err && (err.code === 'permission-denied' || err.code === 'unauthenticated')) return;
        if (typeof window.mostrarToast === 'function') {
          window.mostrarToast(
            'Não foi possível guardar na nuvem. Verifique a sua ligação à internet.',
            'erro'
          );
        }
      });
  }

  /** Cancela qualquer debounce pendente e envia imediatamente. */
  function forceFlushNow() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (pendingLocalWrite) flushPush();
  }

  function schedulePush() {
    if (!initialPullDone) return;
    if (!window.AppliqueiFirebase || !AppliqueiFirebase.ready || !AppliqueiFirebase.auth.currentUser) return;
    pendingLocalWrite = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flushPush, DEBOUNCE_MS);
  }

  // Aplica um snapshot do Firestore no localStorage. Usado tanto no pull
  // inicial (via get) quanto pelo listener em tempo real (onSnapshot).
  // `opts.reloadMessage` é o toast exibido quando algo realmente muda.
  function applyRemoteSnapshot(snap, opts) {
    if (!snap || !snap.exists) return 0;
    var data = snap.data() || {};
    var keys = data.keys || {};
    var rev = tsMillis(data.updatedAt);
    var prevRev = 0;
    try {
      prevRev = parseInt(localStorage.getItem('appliquei_cloud_applied_rev') || '0', 10);
    } catch (_) {}
    if (rev != null && prevRev && rev <= prevRev) return 0;

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

    if (changed > 0) {
      var msg = (opts && opts.reloadMessage) ||
        'Dados atualizados em outro dispositivo. Recarregando…';
      if (typeof window.mostrarToast === 'function') {
        window.mostrarToast(msg, 'sucesso');
      }
      setTimeout(function () {
        try { window.location.reload(); } catch (_) {}
      }, 1500);
    }
    return changed;
  }

  function startSnapshotListener(uid) {
    if (!uid) return;
    if (unsubscribeSnapshot && listenerUid === uid) return;
    stopSnapshotListener();
    var fb = window.AppliqueiFirebase;
    if (!fb || !fb.db) return;
    try {
      listenerUid = uid;
      unsubscribeSnapshot = mainRef(uid).onSnapshot(
        function (snap) {
          // Ignora frames vindos do cache local — só reagimos a confirmações
          // do servidor para evitar loops com a própria escrita pendente.
          if (snap && snap.metadata && snap.metadata.fromCache) return;
          if (snap && snap.metadata && snap.metadata.hasPendingWrites) return;
          applyRemoteSnapshot(snap);
        },
        function (err) {
          console.warn('[AppliqueiCloudSync] snapshot', err);
          // permission-denied/unauthenticated: trial expirou, fatura em aberto
          // ou logout em andamento. O gate de assinatura comunica isso.
          if (err && (err.code === 'permission-denied' || err.code === 'unauthenticated')) return;
        }
      );
    } catch (e) {
      console.warn('[AppliqueiCloudSync] startSnapshotListener', e);
      listenerUid = null;
    }
  }

  function stopSnapshotListener() {
    if (unsubscribeSnapshot) {
      try { unsubscribeSnapshot(); } catch (_) {}
    }
    unsubscribeSnapshot = null;
    listenerUid = null;
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
          startSnapshotListener(uid);
          if (done) done(false);
          return;
        }
        var changed = applyRemoteSnapshot(snap, {
          reloadMessage: 'Dados da nuvem restaurados! Atualizando a página para carregar as informações...'
        });
        initialPullDone = true;
        pullInFlight = false;
        startSnapshotListener(uid);
        if (done) done(changed > 0);
      })
      .catch(function (err) {
        console.warn('[AppliqueiCloudSync] pull', err);
        initialPullDone = true;
        pullInFlight = false;
        // Mesmo critério do push: permission-denied/unauthenticated significa
        // que o acesso pago está fechado — o gate de "Minha assinatura" cobre.
        if (err && (err.code === 'permission-denied' || err.code === 'unauthenticated')) {
          if (done) done(false);
          return;
        }
        if (typeof window.mostrarToast === 'function') {
          window.mostrarToast(
            'Não foi possível ler dados na nuvem. Verifique a sua ligação à internet.',
            'erro'
          );
        }
        if (done) done(false);
      });
  }

  function onUser(user) {
    if (!user) {
      var prevUid = lastSeenUid();
      if (timer) clearTimeout(timer);
      timer = null;
      stopSnapshotListener();
      // Logout: limpa dados do usuário deste browser para evitar vazamento
      // entre contas no mesmo navegador.
      clearUserScopedKeys();
      initialPullDone = false;
      try { localStorage.removeItem(LAST_UID_KEY); } catch (_) {}
      // Se HAVIA usuário antes (sign-out real, não boot inicial sem login),
      // recarrega para zerar o estado em memória (variáveis JS com carteira,
      // sonhos etc. ainda renderizadas). Sem reload, o próximo signIn no
      // mesmo browser veria a UI populada com dados da conta anterior até
      // o user fazer F5 ou navegar. LAST_UID_KEY já foi removido, então
      // o onUser(null) após o reload não vai cair aqui de novo.
      if (prevUid) {
        setTimeout(function () { try { location.reload(); } catch (_) {} }, 300);
      }
      return;
    }
    var last = lastSeenUid();
    if (last && last !== user.uid) {
      // Trocou de conta neste browser sem passar por signOut completo
      // (ex.: link de autenticação direto, troca de provider). Mesma
      // política: limpa e recarrega.
      stopSnapshotListener();
      clearUserScopedKeys();
      initialPullDone = false;
      try { localStorage.setItem(LAST_UID_KEY, user.uid); } catch (_) {}
      try {
        if (typeof window.mostrarToast === 'function') {
          window.mostrarToast('Trocando de conta — recarregando…', 'sucesso');
        }
      } catch (_) {}
      setTimeout(function () { try { location.reload(); } catch (_) {} }, 400);
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

  // ===================================================================
  // MOBILE FIX: visibilitychange + pagehide
  // No mobile, quando o usuário troca de app ou fecha a aba, o browser
  // congela/mata a página rapidamente — o debounce de 4s nunca dispara
  // e os dados ficam presos no localStorage sem ir pro Firestore.
  //
  // Solução:
  //   hidden  → flush imediato (dados vão pro Firestore antes do freeze)
  //   visible → pull forçado  (busca dados frescos que outro device enviou)
  // ===================================================================
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      // Página está saindo de foco (mobile: troca de app, fecha aba, etc.)
      // Envia imediatamente qualquer escrita pendente. Com enablePersistence
      // ativo, mesmo que a request não complete antes do freeze, o Firestore
      // SDK enfileira a escrita no IndexedDB e sincroniza quando o browser
      // retomar ou na próxima abertura.
      forceFlushNow();
    } else if (document.visibilityState === 'visible') {
      // Página voltou ao foco — pode ter havido alterações em outro device.
      // O onSnapshot pode ter se desconectado durante o freeze; um pull
      // explícito garante dados frescos.
      var u = window.AppliqueiFirebase && AppliqueiFirebase.auth && AppliqueiFirebase.auth.currentUser;
      if (u && initialPullDone) {
        pullAndApply(u.uid, function () {});
        // Reconecta o listener se caiu durante o freeze
        startSnapshotListener(u.uid);
      }
    }
  }

  // pagehide é mais confiável que beforeunload no mobile Safari/Chrome.
  // Serve como safety-net caso visibilitychange não dispare.
  function onPageHide() {
    forceFlushNow();
  }

  try {
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
  } catch (_) {}

  window.AppliqueiCloudSync = {
    onLocalWrite: function (key) {
      if (applyingPull) return;
      if (!shouldSyncKey(key)) return;
      schedulePush();
    },
    flushNow: flushPush,
    forceFlush: forceFlushNow,
    pullNow: function (cb) {
      var u = window.AppliqueiFirebase && AppliqueiFirebase.auth && AppliqueiFirebase.auth.currentUser;
      if (u) pullAndApply(u.uid, cb || function () {});
    }
  };
})();
