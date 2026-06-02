/**
 * Sincronização segura: espelha chaves da app (futurorico_* / appliquei_*)
 * em Firestore em users/{uid}/data/main — só após login Firebase.
 * Requer firestore.rules publicados (ver firestore.rules na raiz do projeto).
 *
 * Schema v2: conflict resolution por chave (last-write-wins por timestamp local).
 *   {
 *     schemaVersion: 2,
 *     keys:    { [k]: stringValue },   // valores correntes; deleções saem via FieldValue.delete()
 *     keyRevs: { [k]: msEpoch },       // rev por chave; sobrevive a tombstones (k presente aqui mesmo após delete)
 *     updatedAt: serverTimestamp
 *   }
 * Compat: docs antigos sem keyRevs usam updatedAt como rev de fallback global.
 *
 * Onda 3 — convertido para ES module. O IIFE e o bloco-com-chaves que
 * embrulhavam o conteúdo foram removidos: o escopo do módulo já isola as
 * `var` do global, e o bloco extra induzia o esbuild minifier a gerar
 * conflito de nome (`w` declarado duas vezes no chunk minificado, ver
 * https://github.com/vitejs/vite/issues — symptom: tela travada em
 * "A preparar autenticação…" porque o chunk inteiro nem chega a parsear).
 * A indentação +2 ficou para minimizar o diff da conversão.
 * `window.AppliqueiCloudSync` continua exposto no final para os
 * consumidores legados (HTML inline).
 */
var DEBOUNCE_MS = 2000;
var BEACON_DEBOUNCE_MS = 600;
// No mobile, .get({source:'server'}) pode ficar pendurado numa ligação
// meia-aberta (após background / troca de rede) sem resolver nem rejeitar.
// Sem um teto, pullInFlight/initialPullDone ficavam presos para sempre e TODO
// o sync via SDK parava. Ao estourar, caímos para a cópia em cache (ver
// pullAndApply) e destravamos os caminhos de push.
var PULL_SERVER_TIMEOUT_MS = 8000;
var timer = null;
var beaconTimer = null;
var applyingPull = false;
var authHooked = false;
var pullInFlight = false;
// initialPullDone: o boot completou uma tentativa de pull (servidor OU cache).
// Destrava a lógica de visibilidade/re-pull.
var initialPullDone = false;
// serverViewReady: já tivemos uma visão FRESCA do servidor (get server ok ou
// snapshot não-cache). Gateia só o push via SDK set(merge) — que não compara
// rev e poderia clobberar uma key que outro device atualizou. O beacon NÃO
// depende disto: o endpoint /api/sync/push faz LWW por-rev no servidor, então
// é seguro enviar antes mesmo de termos visto o remoto.
var serverViewReady = false;
var unsubscribeSnapshot = null;
var listenerUid = null;
var pendingLocalWrite = false;
// Set in-memory de chaves alteradas localmente aguardando push. Não precisa
// de persistência: em cada pull reconciliamos comparando localRevs vs remoteRevs.
var dirtyKeys = {};

var LAST_UID_KEY = 'appliquei_cloud_last_uid';
var KEY_REVS_LS = 'appliquei_cloud_key_revs';
var DELETIONS_LS = 'appliquei_cloud_deletions';

function shouldSyncKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (key === 'appliquei_auth_guest') return false;
  if (key.indexOf('appliquei_cloud_') === 0) return false;
  return key.indexOf('futurorico_') === 0 || key.indexOf('appliquei_') === 0;
}

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

function readJsonMap(lsKey) {
  try {
    var raw = localStorage.getItem(lsKey);
    if (!raw) return {};
    var v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (_) {
    return {};
  }
}

function writeJsonMap(lsKey, m) {
  try {
    localStorage.setItem(lsKey, JSON.stringify(m || {}));
  } catch (_) {}
}

function getLocalRevs() {
  return readJsonMap(KEY_REVS_LS);
}
function getLocalDeletions() {
  return readJsonMap(DELETIONS_LS);
}

function setLocalRev(k, t) {
  var m = getLocalRevs();
  m[k] = t;
  writeJsonMap(KEY_REVS_LS, m);
}

// Rev monotónico (Lamport-style). O LWW por-rev do servidor decide quem ganha
// comparando revs; se usássemos só Date.now(), um device com o relógio
// atrasado perderia SEMPRE — o seu write seria descartado em silêncio (curRev
// >= rev). Causa real de "lancei no celular e não gravou" quando o telemóvel
// está alguns segundos atrás do relógio que escreveu por último.
//
// Garantia: o novo rev é estritamente maior que (a) o rev que já vimos para
// esta key (que, após um pull, é o rev remoto) e (b) qualquer rev emitido
// nesta sessão. Assim, um write feito DEPOIS de ler o valor da web ganha
// sempre, independentemente de desvio de relógio. Continua a usar Date.now()
// como base para manter ordenação temporal entre devices saudáveis.
var lastRevIssued = 0;
function nextRev(key) {
  var seen = getLocalRevs()[key] || 0;
  var rev = Date.now();
  if (rev <= seen) rev = seen + 1;
  if (rev <= lastRevIssued) rev = lastRevIssued + 1;
  lastRevIssued = rev;
  return rev;
}

function setLocalDeletion(k, t) {
  var d = getLocalDeletions();
  d[k] = t;
  writeJsonMap(DELETIONS_LS, d);
}

function removeLocalDeletion(k) {
  var d = getLocalDeletions();
  if (k in d) {
    delete d[k];
    writeJsonMap(DELETIONS_LS, d);
  }
}

function mainRef(uid) {
  var db = window.AppliqueiFirebase && AppliqueiFirebase.db;
  if (!db) throw new Error('Firestore não inicializado');
  return db.collection('users').doc(uid).collection('data').doc('main');
}

function collectDirtyPayload() {
  var dirty = Object.keys(dirtyKeys);
  var deletions = getLocalDeletions();
  var keysOut = {};
  var revsOut = {};
  var localRevs = getLocalRevs();

  dirty.forEach(function (k) {
    if (!shouldSyncKey(k)) return;
    var v;
    try {
      v = localStorage.getItem(k);
    } catch (_) {
      v = null;
    }
    if (v === null) return; // chave já não existe localmente: deixa para deletions
    keysOut[k] = v;
    revsOut[k] = localRevs[k] || Date.now();
  });

  Object.keys(deletions).forEach(function (k) {
    if (!shouldSyncKey(k)) return;
    keysOut[k] = firebase.firestore.FieldValue.delete();
    revsOut[k] = deletions[k];
  });

  var dirtyList = Object.keys(keysOut);
  var deletionList = Object.keys(deletions);
  return {
    hasAny: dirtyList.length > 0,
    keys: keysOut,
    keyRevs: revsOut,
    dirtySnapshot: dirty.slice(),
    deletionSnapshot: deletionList,
  };
}

function flushPush() {
  timer = null;
  // Sem visão FRESCA do servidor não arriscamos o push via SDK (set(merge)
  // não compara rev e poderia sobrescrever uma key que outro device acabou de
  // atualizar). Local fica preservado em localRevs/DELETIONS_LS e o próximo
  // pullAndApply re-marca dirty. O egress dos writes não fica refém disto: o
  // beacon (rev-safe no servidor) cobre essa janela.
  if (!serverViewReady || pullInFlight) return;
  var fb = window.AppliqueiFirebase;
  if (!fb || !fb.ready || !fb.db || !fb.auth) return;
  var u = fb.auth.currentUser;
  if (!u) return;

  var build = collectDirtyPayload();
  if (!build.hasAny) {
    pendingLocalWrite = false;
    return;
  }

  var snapshotDirty = build.dirtySnapshot;
  var snapshotDeletions = build.deletionSnapshot;
  pendingLocalWrite = false;
  dirtyKeys = {};

  var payload = {
    keys: build.keys,
    keyRevs: build.keyRevs,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 2,
  };

  mainRef(u.uid)
    .set(payload, { merge: true })
    .then(function () {
      snapshotDeletions.forEach(function (k) {
        removeLocalDeletion(k);
      });
    })
    .catch(function (err) {
      console.warn('[AppliqueiCloudSync] push', err);
      // Restaura dirty para retry. Deletions já estão persistidas, não
      // precisam de restore.
      snapshotDirty.forEach(function (k) {
        dirtyKeys[k] = true;
      });
      pendingLocalWrite = true;
      // Antes: permission-denied/unauthenticated saíam em silêncio — o
      // usuário via "Salvo às HH:MM" mas o doc nunca chegava no Firestore
      // (regras bloqueavam). Agora avisamos explicitamente para que o
      // usuário saiba que precisa reautenticar / renovar acesso.
      if (typeof window.mostrarToast === 'function') {
        if (err && err.code === 'permission-denied') {
          window.mostrarToast(
            'Sessão expirou ou acesso bloqueado: os dados ficaram salvos só neste dispositivo. Atualize a página e refaça o login.',
            'erro'
          );
        } else if (err && err.code === 'unauthenticated') {
          window.mostrarToast(
            'Você precisa estar autenticado para sincronizar. Refaça o login e tente novamente.',
            'erro'
          );
        } else {
          window.mostrarToast(
            'Não foi possível guardar na nuvem. Verifique a sua ligação à internet.',
            'erro'
          );
        }
      }
    });
}

function forceFlushNow() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pendingLocalWrite) flushPush();
}

// -------------------------------------------------------------------
// Beacon path: garante entrega quando o tab é morto pelo OS no mobile.
// O Firestore SDK enfileira a escrita em IndexedDB e tenta enviar via
// WebSocket interna — mas o iOS pode suspender o processo antes da
// transmissão real. navigator.sendBeacon é desenhado precisamente
// para sobreviver ao unload, então duplicamos o envio para /api/sync/push,
// que valida o token e faz merge transacional com LWW por-rev.
// O endpoint é idempotente, portanto este duplo-envio é seguro.
// -------------------------------------------------------------------
var cachedIdToken = null;
function refreshIdTokenCache(fb) {
  try {
    var u = fb && fb.auth && fb.auth.currentUser;
    if (!u) {
      cachedIdToken = null;
      return;
    }
    u.getIdToken()
      .then(function (t) {
        cachedIdToken = t;
      })
      .catch(function () {});
  } catch (_) {}
}

function startIdTokenCache(fb) {
  if (!fb || !fb.auth) return;
  // Warm imediato: se já existe currentUser no attach, garante token cacheado
  // antes do primeiro beacon disparar.
  refreshIdTokenCache(fb);
  if (typeof fb.auth.onIdTokenChanged !== 'function') return;
  try {
    fb.auth.onIdTokenChanged(function (user) {
      if (!user) {
        cachedIdToken = null;
        return;
      }
      try {
        user
          .getIdToken()
          .then(function (t) {
            cachedIdToken = t;
          })
          .catch(function () {});
      } catch (_) {}
    });
  } catch (_) {}
}

function buildBeaconPayload() {
  var dirty = Object.keys(dirtyKeys);
  var deletions = getLocalDeletions();
  if (dirty.length === 0 && Object.keys(deletions).length === 0) return null;

  var localRevs = getLocalRevs();
  var keysOut = {};
  var revsOut = {};

  dirty.forEach(function (k) {
    if (!shouldSyncKey(k)) return;
    var v;
    try {
      v = localStorage.getItem(k);
    } catch (_) {
      v = null;
    }
    if (v === null) return;
    keysOut[k] = v;
    revsOut[k] = localRevs[k] || Date.now();
  });

  Object.keys(deletions).forEach(function (k) {
    if (!shouldSyncKey(k)) return;
    // null no JSON é convertido em FieldValue.delete() pelo endpoint.
    keysOut[k] = null;
    revsOut[k] = deletions[k];
  });

  if (Object.keys(keysOut).length === 0) return null;
  return { keys: keysOut, keyRevs: revsOut };
}

// Transmissão de facto do beacon. Separada para podermos chamá-la tanto com o
// token em cache (síncrono) como após resolver getIdToken() (assíncrono).
// 1) fetch+keepalive: caminho preferencial — logamos status/erro e sobrevive
//    ao unload. 2) sendBeacon: fallback se fetch keepalive não existir.
// O endpoint /api/sync/push é idempotente e faz LWW por-rev, por isso reenviar
// o mesmo payload (eager + visibility + pagehide) é seguro.
function postBeacon(token, payload, reason) {
  var body = JSON.stringify({
    idToken: token,
    keys: payload.keys,
    keyRevs: payload.keyRevs,
  });

  var sent = false;
  try {
    if (typeof window.fetch === 'function') {
      sent = true;
      window
        .fetch('/api/sync/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
          credentials: 'same-origin',
        })
        .then(function (r) {
          if (!r.ok) {
            console.warn('[AppliqueiCloudSync] beacon HTTP', r.status, reason || '');
            try {
              r.text().then(function (t) {
                console.warn('[AppliqueiCloudSync] beacon body', t);
              });
            } catch (_) {}
          } else {
            // Diagnóstico: o endpoint responde 200 mesmo quando o LWW por-rev
            // descarta TODAS as keys (accepted:0) — sintoma clássico de
            // conflito de rev / clock skew. Sem isto, a perda do write no
            // mobile era 100% silenciosa. O rev monotónico (nextRev) deve
            // manter accepted > 0; se aparecer accepted:0, é sinal vermelho.
            var sentN = Object.keys(payload.keys).length;
            try {
              r.json()
                .then(function (j) {
                  if (j && j.accepted === 0 && sentN > 0) {
                    console.warn(
                      '[AppliqueiCloudSync] beacon aceitou 0 de',
                      sentN,
                      'keys — write descartado pelo LWW (conflito de rev / clock skew). reason:',
                      reason || ''
                    );
                  } else {
                    console.log(
                      '[AppliqueiCloudSync] beacon ok',
                      reason || '',
                      'accepted',
                      j && j.accepted,
                      'de',
                      sentN
                    );
                  }
                })
                .catch(function () {
                  console.log('[AppliqueiCloudSync] beacon ok', reason || '', sentN, 'keys');
                });
            } catch (_) {
              console.log('[AppliqueiCloudSync] beacon ok', reason || '', sentN, 'keys');
            }
          }
        })
        .catch(function (e) {
          console.warn('[AppliqueiCloudSync] beacon fetch', e && (e.message || e));
        });
    }
  } catch (e) {
    sent = false;
    console.warn('[AppliqueiCloudSync] beacon fetch threw', e && (e.message || e));
  }

  if (!sent && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      var blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/sync/push', blob);
    } catch (e) {
      console.warn('[AppliqueiCloudSync] sendBeacon', e && (e.message || e));
    }
  }
}

// Caminho rápido para iOS: dispara um POST que sobrevive ao kill do tab.
//
// CRÍTICO: deliberadamente NÃO gateamos em initialPullDone. Esta era a causa
// raiz do "lancei no celular e não gravou": no mobile o tab congela/morre
// durante o pull inicial (.get source:'server' pode demorar/pendurar), e o
// beacon — o ÚNICO caminho desenhado para sobreviver ao freeze — nunca
// disparava nessa janela porque esperava o pull terminar. Como o endpoint
// /api/sync/push faz LWW por-rev no servidor (só sobrescreve uma key se o rev
// recebido for estritamente maior), enviar antes do pull é seguro: nunca
// clobbera um write mais novo de outro device.
function beaconFlushNow(reason) {
  var fb = window.AppliqueiFirebase;
  if (!fb || !fb.auth || !fb.auth.currentUser) return;

  var payload = buildBeaconPayload();
  if (!payload) return;

  if (cachedIdToken) {
    postBeacon(cachedIdToken, payload, reason);
    return;
  }

  // Token ainda não cacheado (ex.: write logo após o login, antes de
  // onIdTokenChanged disparar). Antes, isto fazia o beacon desistir em silêncio
  // e delegar ao SDK — que também estava gateado. Agora obtemos o token do SDK
  // (normalmente em memória, resolve no mesmo tick) e enviamos via fetch+
  // keepalive, que sobrevive ao unload. Reconstruímos o payload porque
  // dirtyKeys pode ter mudado no intervalo.
  try {
    fb.auth.currentUser
      .getIdToken()
      .then(function (t) {
        cachedIdToken = t;
        var fresh = buildBeaconPayload();
        if (fresh) postBeacon(t, fresh, reason);
      })
      .catch(function () {
        refreshIdTokenCache(fb);
      });
  } catch (_) {
    refreshIdTokenCache(fb);
  }
}

function scheduleBeacon(reason) {
  if (beaconTimer) clearTimeout(beaconTimer);
  beaconTimer = setTimeout(function () {
    beaconTimer = null;
    beaconFlushNow(reason || 'debounced');
  }, BEACON_DEBOUNCE_MS);
}

function schedulePush() {
  if (!window.AppliqueiFirebase || !AppliqueiFirebase.ready || !AppliqueiFirebase.auth.currentUser)
    return;
  pendingLocalWrite = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushPush, DEBOUNCE_MS);
}

// Aplica snapshot do Firestore no localStorage usando LWW por-chave.
// Diferenças do schema v1 (sem keyRevs):
//   - rev por chave em vez de global → preserva writes locais durante boot.
//   - tombstones (k em keyRevs sem entry em keys) propagam deleções.
function applyRemoteSnapshot(snap, opts) {
  if (!snap || !snap.exists) return 0;
  var data = snap.data() || {};
  var remoteKeys = data.keys || {};
  var remoteRevs = data.keyRevs || {};
  var fallbackRev = tsMillis(data.updatedAt) || 0;
  var localRevs = getLocalRevs();
  var localDeletions = getLocalDeletions();
  var changed = 0;
  var revsTouched = false;

  var allRemoteKeys = {};
  Object.keys(remoteKeys).forEach(function (k) {
    allRemoteKeys[k] = true;
  });
  Object.keys(remoteRevs).forEach(function (k) {
    allRemoteKeys[k] = true;
  });

  applyingPull = true;
  try {
    Object.keys(allRemoteKeys).forEach(function (k) {
      if (!shouldSyncKey(k)) return;
      var rRev = remoteRevs[k] || fallbackRev;
      var lRev = localRevs[k] || 0;
      // Empate vai para o local: protege writes feitos durante o pull
      // inicial (que carimbam localRev = Date.now() > 0, enquanto remoto
      // ainda tem o rev antigo).
      if (rRev <= lRev) return;
      // Se a deleção local é mais recente, mantém para propagar.
      if (localDeletions[k] && localDeletions[k] >= rRev) return;

      var isTombstone = !(k in remoteKeys) || remoteKeys[k] === undefined || remoteKeys[k] === null;

      try {
        if (isTombstone) {
          if (localStorage.getItem(k) !== null) {
            localStorage.removeItem(k);
            changed++;
          }
        } else {
          var next = remoteKeys[k];
          var cur = localStorage.getItem(k);
          if (!storageValuesEqual(cur, next)) {
            localStorage.setItem(k, String(next));
            changed++;
          }
        }
      } catch (e) {
        console.warn('[AppliqueiCloudSync] apply key', k, e);
      }

      localRevs[k] = rRev;
      revsTouched = true;
      if (localDeletions[k] && localDeletions[k] < rRev) {
        removeLocalDeletion(k);
      }
    });
  } finally {
    applyingPull = false;
  }

  // Seed dirty para chaves só-locais (presentes no localStorage mas não
  // no remoto). Cobre a migração v1→v2: utilizadores existentes têm
  // localStorage populado mas KEY_REVS_LS vazio.
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var lk = localStorage.key(i);
      if (!shouldSyncKey(lk)) continue;
      if (lk in allRemoteKeys) continue;
      if (!(lk in localRevs)) {
        localRevs[lk] = Date.now();
        revsTouched = true;
      }
      dirtyKeys[lk] = true;
    }
  } catch (_) {}

  if (revsTouched) writeJsonMap(KEY_REVS_LS, localRevs);

  // Reconciliação: keys locais que ficaram mais recentes que o remoto
  // (ex.: escritas durante o pull) entram em dirty para o próximo push.
  var hasLocalNewer = Object.keys(dirtyKeys).length > 0;
  Object.keys(localRevs).forEach(function (k) {
    if (!shouldSyncKey(k)) return;
    var rRev = remoteRevs[k] || fallbackRev;
    if (localRevs[k] > rRev) {
      try {
        if (localStorage.getItem(k) !== null) {
          dirtyKeys[k] = true;
          hasLocalNewer = true;
        }
      } catch (_) {}
    }
  });
  if (hasLocalNewer || Object.keys(getLocalDeletions()).length > 0) {
    schedulePush();
  }

  if (changed > 0) {
    var msg =
      (opts && opts.reloadMessage) || 'Dados atualizados em outro dispositivo. Recarregando…';
    if (typeof window.mostrarToast === 'function') {
      window.mostrarToast(msg, 'sucesso');
    }
    setTimeout(function () {
      try {
        window.location.reload();
      } catch (_) {}
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
        if (snap && snap.metadata && snap.metadata.fromCache) return;
        if (snap && snap.metadata && snap.metadata.hasPendingWrites) return;
        // Visão fresca do servidor chegou pelo tempo-real: destrava o push via
        // SDK mesmo que o .get inicial tenha estourado/falhado (caiu p/ cache).
        serverViewReady = true;
        applyRemoteSnapshot(snap);
      },
      function (err) {
        console.warn('[AppliqueiCloudSync] snapshot', err);
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
    try {
      unsubscribeSnapshot();
    } catch (_) {}
  }
  unsubscribeSnapshot = null;
  listenerUid = null;
}

function reconcileAgainstEmptyRemote() {
  // Doc não existe (utilizador novo OU nunca sincronizou neste schema).
  // Tudo o que estiver com localRev > 0 conta como dirty para semear o doc.
  var localRevs = getLocalRevs();
  Object.keys(localRevs).forEach(function (k) {
    if (!shouldSyncKey(k)) return;
    if ((localRevs[k] || 0) > 0) {
      try {
        if (localStorage.getItem(k) !== null) dirtyKeys[k] = true;
      } catch (_) {}
    }
  });
  // Se temos chaves locais mas ainda sem rev (ex.: dados criados antes
  // do upgrade do schema), atribui um rev agora para que o push as suba.
  try {
    var now = Date.now();
    var bumped = false;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!shouldSyncKey(k)) continue;
      if (!(k in localRevs)) {
        localRevs[k] = now;
        dirtyKeys[k] = true;
        bumped = true;
      }
    }
    if (bumped) writeJsonMap(KEY_REVS_LS, localRevs);
  } catch (_) {}
}

function pullAndApply(uid, done) {
  if (pullInFlight) {
    if (done) done(false);
    return;
  }
  pullInFlight = true;
  var settled = false;
  var timeoutId = null;

  function clearPullTimeout() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  // Conclui o pull aplicando um snapshot (ou semeando contra remoto vazio).
  // fromServer=true marca serverViewReady → destrava o push via SDK. O caminho
  // de cache (fallback do timeout) passa fromServer=false: destrava a boot mas
  // mantém o SDK push à espera de uma visão real do servidor; entretanto o
  // beacon (rev-safe) já cobre o egress.
  function settle(snap, fromServer) {
    if (settled) return;
    settled = true;
    clearPullTimeout();
    var changed = 0;
    if (!snap || !snap.exists) {
      reconcileAgainstEmptyRemote();
    } else {
      changed = applyRemoteSnapshot(snap, {
        reloadMessage:
          'Dados da nuvem restaurados! Atualizando a página para carregar as informações...',
      });
    }
    initialPullDone = true;
    if (fromServer) serverViewReady = true;
    pullInFlight = false;
    if (Object.keys(dirtyKeys).length > 0 || Object.keys(getLocalDeletions()).length > 0) {
      schedulePush();
    }
    startSnapshotListener(uid);
    if (done) done(changed > 0);
  }

  function fail(err) {
    if (settled) return;
    settled = true;
    clearPullTimeout();
    console.warn('[AppliqueiCloudSync] pull', err);
    initialPullDone = true;
    pullInFlight = false;
    if (err && (err.code === 'permission-denied' || err.code === 'unauthenticated')) {
      if (done) done(false);
      return;
    }
    // Erro transitório de rede: mantém o tempo-real vivo — quando a ligação
    // voltar, o snapshot reconcilia e marca serverViewReady. O beacon rev-safe
    // cobre o egress entretanto.
    startSnapshotListener(uid);
    if (typeof window.mostrarToast === 'function') {
      window.mostrarToast(
        'Não foi possível ler dados na nuvem. Verifique a sua ligação à internet.',
        'erro'
      );
    }
    if (done) done(false);
  }

  // Teto defensivo: se o get do servidor não resolver nem rejeitar a tempo
  // (ligação meia-aberta típica de mobile), cai para a cópia em cache
  // (última vista do servidor, persistida em IndexedDB). applyRemoteSnapshot
  // usa LWW por-rev, então isto nunca sobrescreve um write local mais novo.
  timeoutId = setTimeout(function () {
    if (settled) return;
    mainRef(uid)
      .get({ source: 'cache' })
      .then(function (snap) {
        settle(snap, false);
      })
      .catch(function () {
        // Sem cache utilizável: trata como remoto vazio para destravar a boot.
        settle(null, false);
      });
  }, PULL_SERVER_TIMEOUT_MS);

  mainRef(uid)
    .get({ source: 'server' })
    .then(function (snap) {
      settle(snap, true);
    })
    .catch(function (err) {
      fail(err);
    });
}

function onUser(user) {
  if (!user) {
    var prevUid = lastSeenUid();
    if (timer) clearTimeout(timer);
    timer = null;
    stopSnapshotListener();
    clearUserScopedKeys();
    initialPullDone = false;
    serverViewReady = false;
    dirtyKeys = {};
    try {
      localStorage.removeItem(LAST_UID_KEY);
    } catch (_) {}
    if (prevUid) {
      setTimeout(function () {
        try {
          location.reload();
        } catch (_) {}
      }, 300);
    }
    return;
  }
  var last = lastSeenUid();
  if (last && last !== user.uid) {
    stopSnapshotListener();
    clearUserScopedKeys();
    initialPullDone = false;
    serverViewReady = false;
    dirtyKeys = {};
    try {
      localStorage.setItem(LAST_UID_KEY, user.uid);
    } catch (_) {}
    try {
      if (typeof window.mostrarToast === 'function') {
        window.mostrarToast('Trocando de conta — recarregando…', 'sucesso');
      }
    } catch (_) {}
    setTimeout(function () {
      try {
        location.reload();
      } catch (_) {}
    }, 400);
    return;
  }
  try {
    localStorage.setItem(LAST_UID_KEY, user.uid);
  } catch (_) {}
  pullAndApply(user.uid, function () {});
}

function lastSeenUid() {
  try {
    return localStorage.getItem(LAST_UID_KEY) || '';
  } catch (_) {
    return '';
  }
}

function clearUserScopedKeys() {
  try {
    var toRemove = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && shouldSyncKey(k)) toRemove.push(k);
    }
    toRemove.forEach(function (k) {
      try {
        localStorage.removeItem(k);
      } catch (_) {}
    });
    // Limpa metadata de sync também — outro user vai recriar via pull.
    localStorage.removeItem('appliquei_cloud_applied_rev'); // legado v1
    localStorage.removeItem(KEY_REVS_LS);
    localStorage.removeItem(DELETIONS_LS);
  } catch (_) {}
}

function attach() {
  var fb = window.AppliqueiFirebase;
  if (!fb || !fb.ready || !fb.auth) return;
  if (authHooked) return;
  authHooked = true;
  fb.auth.onAuthStateChanged(onUser);
  startIdTokenCache(fb);
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
// No mobile, o browser congela/mata o tab antes do debounce de 2s.
//   hidden  → flush imediato (dados vão pro Firestore antes do freeze)
//   visible → pull forçado  (busca dados frescos que outro device enviou)
// ===================================================================
function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    // Beacon primeiro: dispara o request HTTP que sobrevive ao kill do tab.
    // forceFlushNow é o caminho rápido enquanto o SDK ainda corre.
    if (beaconTimer) {
      clearTimeout(beaconTimer);
      beaconTimer = null;
    }
    beaconFlushNow('visibility-hidden');
    forceFlushNow();
  } else if (document.visibilityState === 'visible') {
    var u =
      window.AppliqueiFirebase && AppliqueiFirebase.auth && AppliqueiFirebase.auth.currentUser;
    if (u && initialPullDone) {
      pullAndApply(u.uid, function () {});
      startSnapshotListener(u.uid);
    }
  }
}

function onPageHide() {
  if (beaconTimer) {
    clearTimeout(beaconTimer);
    beaconTimer = null;
  }
  beaconFlushNow('pagehide');
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
    setLocalRev(key, nextRev(key));
    dirtyKeys[key] = true;
    removeLocalDeletion(key);
    schedulePush();
    // Beacon eager: garante entrega antes de o iOS suspender o processo.
    // Esperar pelo visibilitychange é arriscado porque iOS dispara esse
    // evento depois do freeze em alguns cenários (lock screen rápido).
    scheduleBeacon('write:' + key);
  },
  onLocalDelete: function (key) {
    if (applyingPull) return;
    if (!shouldSyncKey(key)) return;
    var rev = nextRev(key);
    setLocalRev(key, rev);
    setLocalDeletion(key, rev);
    delete dirtyKeys[key];
    schedulePush();
    scheduleBeacon('delete:' + key);
  },
  flushNow: flushPush,
  forceFlush: forceFlushNow,
  beaconNow: function () {
    beaconFlushNow('manual');
  },
  pullNow: function (cb) {
    var u =
      window.AppliqueiFirebase && AppliqueiFirebase.auth && AppliqueiFirebase.auth.currentUser;
    if (u) pullAndApply(u.uid, cb || function () {});
  },
  // Limpa todas as chaves sincronizáveis do localStorage. Chamado pelo
  // gate de billing quando o backend reporta access.status === 'blocked'
  // para que remover o modal via DevTools não dê acesso ao cache local.
  // Idempotente; deixa intactas chaves não-sincronizáveis (preferências
  // de UI puramente locais).
  purgeLocalCache: function () {
    stopSnapshotListener();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (beaconTimer) {
      clearTimeout(beaconTimer);
      beaconTimer = null;
    }
    dirtyKeys = {};
    initialPullDone = false;
    serverViewReady = false;
    clearUserScopedKeys();
  },
};
