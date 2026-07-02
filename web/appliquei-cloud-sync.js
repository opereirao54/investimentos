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
 * Merge por registro (v2.1): chaves cujo valor é um array JSON de objetos
 * com `id` único (futurorico_transacoes, appliquei_contas, …) NÃO fazem mais
 * LWW cego do array inteiro no pull. Quando local e remoto divergem, o merge
 * une os registros por id — o lançamento feito no celular sobrevive mesmo
 * que outro device tenha escrito a mesma chave no intervalo. Deleções de
 * registros são propagadas via ledger de tombstones (appliquei_sync_
 * tombstones_v1, sincronizado como chave normal e unido por max-timestamp),
 * senão o merge ressuscitaria registros apagados no outro device.
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
// Beacon eager: curto, para o fetch (página ativa, sem limite de tamanho)
// partir cedo — antes de o utilizador mandar o tab para segundo plano.
var BEACON_DEBOUNCE_MS = 300;
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
// Último rev por chave CONFIRMADO pelo servidor (adotado num pull ou aceito
// num push). localRevs[k] > syncedRevs[k] ⟺ há mudança local que o servidor
// nunca viu — é exatamente a janela em que o LWW cego perderia dados e onde
// o merge por registro entra. Persistido: sobrevive a reload (dirtyKeys não).
var SYNCED_REVS_LS = 'appliquei_cloud_synced_revs';
// Ledger de deleções POR REGISTRO (id → msEpoch da deleção), agrupado por
// chave sincronizável. Prefixo appliquei_ (sem "cloud_") de propósito: o
// ledger VIAJA no sync como uma chave normal, para o outro device saber que
// um registro foi apagado (e não apenas "sumiu" do array — que o merge por id
// interpretaria como registro novo do outro lado e ressuscitaria).
var TOMBSTONES_KEY = 'appliquei_sync_tombstones_v1';
// Tombstones antigos são podados: depois de 60 dias todos os devices ativos
// já convergiram; guardar mais só incha o payload.
var TOMBSTONE_TTL_MS = 60 * 86400 * 1000;
var TOMBSTONE_MAX_PER_KEY = 3000;

// Retry do beacon: uma falha de rede ao sair do mercado não pode significar
// perda silenciosa — reagenda com backoff e também no evento 'online'.
var beaconRetryTimer = null;
var beaconFailures = 0;
var BEACON_RETRY_BASE_MS = 5000;
var BEACON_RETRY_MAX_MS = 60000;
// Toasts de diagnóstico (403 email não verificado / acesso bloqueado, chave
// grande demais rejeitada) mostrados no máximo 1x por sessão por motivo.
var syncToastShown = {};
// Anti-loop: pull de reconciliação disparado por accepted<sent no máx. 1x/30s.
var lastReconcilePullAt = 0;

// Versão do build do sync. Aparece no painel de diagnóstico (?syncdebug=1) e
// no console — confirma em campo qual código o aparelho está REALMENTE
// rodando (aba de celular ressuscitada roda JS antigo por dias após deploy).
var SYNC_BUILD = '2026-07-02.4';
// Últimos eventos observáveis, para o painel de diagnóstico.
var diag = {
  lastBeacon: null, // { t, reason, status, accepted, sent, rejected, stale, error }
  lastPull: null, // { t, ok, changed, fromServer, error }
  lastSdkPush: null, // { t, ok, error }
};
// true depois do primeiro callback de onAuthStateChanged — distingue "ainda
// restaurando a sessão" de "realmente sem login".
var authSettled = false;

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
function getSyncedRevs() {
  return readJsonMap(SYNCED_REVS_LS);
}
function markSyncedRevs(revMap, skip) {
  var m = getSyncedRevs();
  var touched = false;
  Object.keys(revMap).forEach(function (k) {
    if (skip && skip[k]) return;
    if (m[k] !== revMap[k]) {
      m[k] = revMap[k];
      touched = true;
    }
  });
  if (touched) writeJsonMap(SYNCED_REVS_LS, m);
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
function revAbove(base) {
  var rev = Date.now();
  if (rev <= base) rev = base + 1;
  if (rev <= lastRevIssued) rev = lastRevIssued + 1;
  lastRevIssued = rev;
  return rev;
}
function nextRev(key) {
  return revAbove(getLocalRevs()[key] || 0);
}

// ---------------------------------------------------------------
// Merge por registro: helpers
// ---------------------------------------------------------------

// Devolve o array de objetos-com-id se (e só se) o valor for elegível para
// merge por registro: array JSON de objetos não-nulos, todos com `id`
// definido e único. Qualquer outra forma → null → cai no LWW clássico.
function parseIdArray(str) {
  if (typeof str !== 'string') return null;
  var s = str.charAt(0);
  if (s !== '[') return null;
  var arr;
  try {
    arr = JSON.parse(str);
  } catch (_) {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  var seen = {};
  for (var i = 0; i < arr.length; i++) {
    var it = arr[i];
    if (!it || typeof it !== 'object' || Array.isArray(it)) return null;
    if (it.id === undefined || it.id === null) return null;
    var id = String(it.id);
    if (seen[id]) return null;
    seen[id] = true;
  }
  return arr;
}

function getTombstones() {
  return readJsonMap(TOMBSTONES_KEY);
}

function pruneTombMap(m) {
  var cutoff = Date.now() - TOMBSTONE_TTL_MS;
  var ids = Object.keys(m);
  ids.forEach(function (id) {
    if (!(typeof m[id] === 'number') || m[id] < cutoff) delete m[id];
  });
  ids = Object.keys(m);
  if (ids.length > TOMBSTONE_MAX_PER_KEY) {
    ids
      .sort(function (a, b) {
        return m[a] - m[b];
      })
      .slice(0, ids.length - TOMBSTONE_MAX_PER_KEY)
      .forEach(function (id) {
        delete m[id];
      });
  }
  return m;
}

function writeTombstones(all) {
  try {
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(all || {}));
  } catch (_) {}
}

// Regista deleções de registros (ids sumiram do array numa escrita local) e
// remove tombstones de ids que voltaram (registro re-criado com o mesmo id).
function updateRecordTombstones(key, removedIds, revivedIds) {
  if (!removedIds.length && !revivedIds.length) return;
  var all = getTombstones();
  var m = all[key];
  if (!m || typeof m !== 'object' || Array.isArray(m)) m = {};
  var now = Date.now();
  removedIds.forEach(function (id) {
    m[String(id)] = now;
  });
  revivedIds.forEach(function (id) {
    delete m[String(id)];
  });
  all[key] = pruneTombMap(m);
  writeTombstones(all);
  // O ledger viaja no sync como chave normal: carimba rev + marca dirty.
  // (O wrapper de setItem também notifica em produção; bump duplo de rev é
  // inofensivo — e assim o módulo não depende do wrapper para propagar.)
  setLocalRev(TOMBSTONES_KEY, nextRev(TOMBSTONES_KEY));
  dirtyKeys[TOMBSTONES_KEY] = true;
}

// Compara o array local (mais antigo por rev) com o remoto (mais novo) e
// devolve a união por id, respeitando tombstones de AMBOS os lados:
//   - id nos dois → versão remota vence (rev da chave remota é mais novo);
//   - id só no remoto → entra, salvo tombstone local;
//   - id só no local → SOBREVIVE (é o lançamento do celular!), salvo
//     tombstone remoto (foi apagado no outro device).
// Retorna null quando algum lado não é elegível → chamador faz LWW clássico.
function mergeIdArrays(key, localStr, remoteStr, tombUnion) {
  var localArr = parseIdArray(localStr);
  if (!localArr) return null;
  var remoteArr = parseIdArray(remoteStr);
  if (!remoteArr) return null;

  var tomb = (tombUnion && tombUnion[key]) || {};
  var out = [];
  var present = {};
  remoteArr.forEach(function (it) {
    var id = String(it.id);
    if (tomb[id]) return;
    present[id] = true;
    out.push(it);
  });
  localArr.forEach(function (it) {
    var id = String(it.id);
    if (present[id] || tomb[id]) return;
    present[id] = true;
    out.push(it);
  });

  var value = JSON.stringify(out);
  return {
    value: value,
    // Diverge do remoto → o merge precisa voltar para o servidor com rev
    // maior, senão os registros locais preservados nunca chegam à nuvem.
    divergesFromRemote: value !== JSON.stringify(remoteArr),
  };
}

// União de dois ledgers de tombstones (max timestamp por id).
function unionTombstones(a, b) {
  var out = {};
  [a, b].forEach(function (src) {
    if (!src || typeof src !== 'object') return;
    Object.keys(src).forEach(function (key) {
      var m = src[key];
      if (!m || typeof m !== 'object' || Array.isArray(m)) return;
      if (!out[key]) out[key] = {};
      Object.keys(m).forEach(function (id) {
        var ts = Number(m[id]) || 0;
        if (!ts) return;
        if (!out[key][id] || out[key][id] < ts) out[key][id] = ts;
      });
    });
  });
  Object.keys(out).forEach(function (key) {
    out[key] = pruneTombMap(out[key]);
    if (Object.keys(out[key]).length === 0) delete out[key];
  });
  return out;
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
      // set(merge) não passa por LWW: o servidor agora tem exatamente estes
      // revs — regista como sincronizados.
      markSyncedRevs(build.keyRevs);
      diag.lastSdkPush = { t: Date.now(), ok: true };
      if (Object.keys(dirtyKeys).length === 0 && Object.keys(getLocalDeletions()).length === 0) {
        setCloudStatus('saved');
      }
    })
    .catch(function (err) {
      console.warn('[AppliqueiCloudSync] push', err);
      setCloudStatus('error');
      diag.lastSdkPush = {
        t: Date.now(),
        ok: false,
        error: (err && (err.code || err.message)) || 'erro',
      };
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
// Indicador honesto de sync. O "Salvo às HH:MM" do wrapper de setItem mente:
// atualiza no gravar LOCAL, mesmo quando a nuvem falhou — o usuário saía do
// mercado achando que sincronizou. Aqui refletimos o estado real do push.
function setCloudStatus(state) {
  try {
    var el = document.getElementById('ultimoSalvoTxt');
    if (!el) return;
    if (state === 'saved') {
      var agora = new Date();
      var hh = String(agora.getHours());
      if (hh.length < 2) hh = '0' + hh;
      var mm = String(agora.getMinutes());
      if (mm.length < 2) mm = '0' + mm;
      el.textContent = 'Salvo na nuvem às ' + hh + ':' + mm;
    } else if (state === 'pending') {
      el.textContent = 'Sincronizando…';
    } else if (state === 'error') {
      el.textContent = 'Sem nuvem — dados salvos só neste aparelho';
    } else if (state === 'local-only') {
      // Sem login não existe sincronização — o antigo "Salvo às HH:MM"
      // deixava parecer que sim.
      el.textContent = 'Salvo neste aparelho (sem login — não vai para a nuvem)';
    }
  } catch (_) {}
}

function toastOnce(reasonKey, msg) {
  if (syncToastShown[reasonKey]) return;
  syncToastShown[reasonKey] = true;
  if (typeof window.mostrarToast === 'function') {
    window.mostrarToast(msg, 'erro');
  }
}

function scheduleBeaconRetry() {
  beaconFailures++;
  setCloudStatus('error');
  if (beaconRetryTimer) return;
  var delay = BEACON_RETRY_BASE_MS * Math.pow(2, Math.min(beaconFailures - 1, 4));
  if (delay > BEACON_RETRY_MAX_MS) delay = BEACON_RETRY_MAX_MS;
  beaconRetryTimer = setTimeout(function () {
    beaconRetryTimer = null;
    if (Object.keys(dirtyKeys).length === 0 && Object.keys(getLocalDeletions()).length === 0)
      return;
    beaconFlushNow('retry#' + beaconFailures, false);
  }, delay);
}

// Sucesso confirmado pelo servidor: limpa dirty/deletions das chaves cujo rev
// enviado ainda é o corrente (se o usuário escreveu de novo no intervalo, o
// rev local mudou e a chave continua dirty para o próximo envio).
function clearAckedKeys(payload, skip) {
  var localRevs = getLocalRevs();
  var deletions = getLocalDeletions();
  Object.keys(payload.keyRevs).forEach(function (k) {
    if (skip && skip[k]) return;
    var sentRev = payload.keyRevs[k];
    if (dirtyKeys[k] && localRevs[k] === sentRev) delete dirtyKeys[k];
    if (deletions[k] === sentRev) removeLocalDeletion(k);
  });
  markSyncedRevs(payload.keyRevs, skip);
}

// O servidor descartou parte das chaves por LWW (outro device escreveu com
// rev maior). Puxa o remoto para reconciliar: o merge por registro preserva
// os lançamentos locais e re-agenda um push com rev vencedor.
function reconcileAfterStale() {
  var now = Date.now();
  if (now - lastReconcilePullAt < 30000) return;
  lastReconcilePullAt = now;
  var u = window.AppliqueiFirebase && AppliqueiFirebase.auth && AppliqueiFirebase.auth.currentUser;
  if (u) pullAndApply(u.uid, function () {});
}

function postBeacon(token, payload, reason, viaUnload, isAuthRetry) {
  var body = JSON.stringify({
    idToken: token,
    keys: payload.keys,
    keyRevs: payload.keyRevs,
  });
  var sentN = Object.keys(payload.keys).length;

  // CAUSA RAIZ do "grava na web mas não no celular": fetch({keepalive:true}) e
  // navigator.sendBeacon têm limite de ~64KB de corpo no browser — ACIMA disso
  // o request falha em SILÊNCIO. futurorico_transacoes (todas as transações num
  // único JSON) passa disso facilmente. Na web o push via SDK (sem limite de
  // tamanho) tinha tempo de completar com o tab aberto; no celular, que congela
  // rápido, só sobrava o beacon com keepalive — e ele morria pelo limite.
  //
  // Em página ATIVA (beacon eager) NÃO precisamos de keepalive: um fetch normal
  // não tem limite de tamanho e o request já segue para o servidor mesmo que o
  // tab vá a background logo depois (não dependemos de ler a resposta). Só no
  // unload (visibility-hidden/pagehide) é que keepalive faz falta — e aí, se o
  // corpo for grande, não o forçamos (cairia); o eager já terá enviado.
  var KEEPALIVE_MAX = 50 * 1024;
  var tooBigForKeepalive = body.length > KEEPALIVE_MAX;
  var useKeepalive = !!viaUnload && !tooBigForKeepalive;

  var sent = false;
  try {
    if (typeof window.fetch === 'function') {
      sent = true;
      var opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        credentials: 'same-origin',
      };
      if (useKeepalive) opts.keepalive = true;
      window
        .fetch('/api/sync/push', opts)
        .then(function (r) {
          var rec = { t: Date.now(), reason: reason || '', status: r.status, sent: sentN };
          diag.lastBeacon = rec;
          if (!r.ok) {
            console.warn('[AppliqueiCloudSync] beacon HTTP', r.status, reason || '');
            if (r.status === 401 && !isAuthRetry) {
              // Token cacheado expirou (aba mobile ressuscitada horas depois:
              // onIdTokenChanged não disparou durante o freeze). Antes, o 401
              // descartava o write em SILÊNCIO. Agora força refresh e reenvia.
              cachedIdToken = null;
              try {
                var fb = window.AppliqueiFirebase;
                var u = fb && fb.auth && fb.auth.currentUser;
                if (u) {
                  u.getIdToken(true)
                    .then(function (t) {
                      cachedIdToken = t;
                      var fresh = buildBeaconPayload();
                      if (fresh) postBeacon(t, fresh, (reason || '') + '+401retry', false, true);
                    })
                    .catch(function () {
                      scheduleBeaconRetry();
                    });
                  return;
                }
              } catch (_) {}
              scheduleBeaconRetry();
              return;
            }
            if (r.status === 403) {
              // Sem retry: é estado de conta, não de rede. Mas o usuário
              // PRECISA saber — era a falha silenciosa clássica ("Salvo às
              // HH:MM" no aparelho, nada na nuvem).
              setCloudStatus('error');
              try {
                r.json().then(function (j) {
                  var err = j && j.error;
                  rec.error = err || 'http_403';
                  if (err === 'email_not_verified') {
                    toastOnce(
                      'email_not_verified',
                      'Sincronização desativada: verifique seu e-mail (link enviado na criação da conta) para gravar seus dados na nuvem.'
                    );
                  } else if (err === 'access_blocked') {
                    toastOnce(
                      'access_blocked',
                      'Sincronização desativada: sua assinatura/período de teste expirou. Os dados estão sendo salvos só neste aparelho.'
                    );
                  }
                });
              } catch (_) {}
              return;
            }
            // 5xx / outros: transitório — reagenda.
            scheduleBeaconRetry();
            return;
          }
          beaconFailures = 0;
          try {
            r.json()
              .then(function (j) {
                var rejected = (j && j.rejected) || [];
                var stale = (j && j.stale) || [];
                rec.accepted = j && j.accepted;
                if (rejected.length) rec.rejected = rejected;
                if (stale.length) rec.stale = stale;
                if (rejected.length) {
                  console.warn('[AppliqueiCloudSync] beacon: keys rejeitadas', rejected);
                  toastOnce(
                    'rejected:' + rejected.join(','),
                    'Parte dos dados não coube na sincronização (' +
                      rejected.join(', ') +
                      '). Exporte um backup e contate o suporte.'
                  );
                }
                var skip = {};
                rejected.forEach(function (k) {
                  skip[k] = true;
                });
                stale.forEach(function (k) {
                  skip[k] = true;
                });
                clearAckedKeys(payload, skip);
                if (stale.length) {
                  // Outro device escreveu com rev maior: puxa e o merge por
                  // registro preserva os lançamentos locais + re-push.
                  console.warn(
                    '[AppliqueiCloudSync] beacon: keys stale (LWW)',
                    stale,
                    reason || ''
                  );
                  reconcileAfterStale();
                } else if (
                  Object.keys(dirtyKeys).length === 0 &&
                  Object.keys(getLocalDeletions()).length === 0
                ) {
                  setCloudStatus('saved');
                }
                console.log(
                  '[AppliqueiCloudSync] beacon ok',
                  reason || '',
                  'accepted',
                  j && j.accepted,
                  'de',
                  sentN,
                  '(' + body.length + 'B, keepalive=' + useKeepalive + ')'
                );
              })
              .catch(function () {
                console.log('[AppliqueiCloudSync] beacon ok', reason || '', sentN, 'keys');
              });
          } catch (_) {
            console.log('[AppliqueiCloudSync] beacon ok', reason || '', sentN, 'keys');
          }
        })
        .catch(function (e) {
          console.warn('[AppliqueiCloudSync] beacon fetch', reason || '', e && (e.message || e));
          diag.lastBeacon = {
            t: Date.now(),
            reason: reason || '',
            status: 0,
            sent: sentN,
            error: 'rede: ' + ((e && e.message) || e),
          };
          // Falha de rede (saindo do mercado, elevador…): NÃO desistir.
          scheduleBeaconRetry();
        });
    }
  } catch (e) {
    sent = false;
    console.warn('[AppliqueiCloudSync] beacon fetch threw', e && (e.message || e));
  }

  // Fallback sendBeacon: só quando o fetch não pôde ser usado E o corpo cabe no
  // limite (senão sendBeacon também rejeita silenciosamente).
  if (
    !sent &&
    !tooBigForKeepalive &&
    typeof navigator !== 'undefined' &&
    typeof navigator.sendBeacon === 'function'
  ) {
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
function beaconFlushNow(reason, viaUnload) {
  var fb = window.AppliqueiFirebase;
  if (!fb || !fb.auth || !fb.auth.currentUser) return;

  var payload = buildBeaconPayload();
  if (!payload) return;

  if (cachedIdToken) {
    postBeacon(cachedIdToken, payload, reason, viaUnload);
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
        if (fresh) postBeacon(t, fresh, reason, viaUnload);
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
    // Eager = página ativa → sem keepalive (fetch normal, sem limite de 64KB).
    beaconFlushNow(reason || 'debounced', false);
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
  var syncedRevs = getSyncedRevs();
  var localDeletions = getLocalDeletions();
  var changed = 0;
  var revsTouched = false;
  var syncedTouched = false;

  var allRemoteKeys = {};
  Object.keys(remoteKeys).forEach(function (k) {
    allRemoteKeys[k] = true;
  });
  Object.keys(remoteRevs).forEach(function (k) {
    allRemoteKeys[k] = true;
  });

  applyingPull = true;
  var tombUnion;
  try {
    // ---- Ledger de tombstones: SEMPRE união (nunca LWW cego) ----
    // Se fizesse LWW, um push do ledger local sobrescreveria deleções
    // registadas por outro device que ainda não vimos.
    var localTomb = getTombstones();
    var remoteTombRaw =
      typeof remoteKeys[TOMBSTONES_KEY] === 'string' ? remoteKeys[TOMBSTONES_KEY] : null;
    var remoteTomb = null;
    if (remoteTombRaw !== null) {
      try {
        remoteTomb = JSON.parse(remoteTombRaw);
      } catch (_) {}
    }
    tombUnion = unionTombstones(localTomb, remoteTomb);
    var tombUnionStr = JSON.stringify(tombUnion);
    if (tombUnionStr !== JSON.stringify(localTomb)) {
      writeTombstones(tombUnion);
    }
    if (remoteTombRaw !== null) {
      var rRevTomb = remoteRevs[TOMBSTONES_KEY] || fallbackRev;
      if (tombUnionStr !== JSON.stringify(remoteTomb || {})) {
        // União difere do remoto → precisa voltar ao servidor com rev maior.
        localRevs[TOMBSTONES_KEY] = revAbove(rRevTomb);
        dirtyKeys[TOMBSTONES_KEY] = true;
        syncedRevs[TOMBSTONES_KEY] = rRevTomb;
      } else if (rRevTomb > (localRevs[TOMBSTONES_KEY] || 0)) {
        localRevs[TOMBSTONES_KEY] = rRevTomb;
        syncedRevs[TOMBSTONES_KEY] = rRevTomb;
      }
      revsTouched = true;
      syncedTouched = true;
    }

    Object.keys(allRemoteKeys).forEach(function (k) {
      if (!shouldSyncKey(k)) return;
      if (k === TOMBSTONES_KEY) return; // tratado acima (união)
      var rRev = remoteRevs[k] || fallbackRev;
      var lRev = localRevs[k] || 0;
      var syncedRev = syncedRevs[k] || 0;
      var isTombstone = !(k in remoteKeys) || remoteKeys[k] === undefined || remoteKeys[k] === null;

      // ---- Divergência concorrente (a causa do "cada aparelho com um total
      // diferente, ambos dizendo que sincronizaram") ----
      // Os dois lados avançaram além do último ponto comum de sync
      // (lRev > syncedRev E rRev > syncedRev). O rev é escalar e o LWW dele
      // dropava um dos lados — QUAL depende só de qual relógio estava à frente.
      // Para uma coleção (array de registros com id), unir é sempre correto,
      // independentemente de qual rev é maior. Faz ISTO antes do LWW abaixo,
      // que de outra forma (rRev <= lRev) retornaria e perderia o remoto.
      if (!isTombstone && lRev > syncedRev && rRev > syncedRev) {
        var curD = null;
        try {
          curD = localStorage.getItem(k);
        } catch (_) {}
        if (curD !== null) {
          var mergedD = mergeIdArrays(k, curD, String(remoteKeys[k]), tombUnion);
          if (mergedD) {
            if (!storageValuesEqual(curD, mergedD.value)) {
              localStorage.setItem(k, mergedD.value);
              changed++;
            }
            if (mergedD.divergesFromRemote) {
              // A união tem registros que o servidor ainda não tem → volta com
              // rev acima de AMBOS (vence o LWW dos dois lados).
              localRevs[k] = revAbove(rRev > lRev ? rRev : lRev);
              dirtyKeys[k] = true;
            } else {
              // A união == remoto → já convergimos com o servidor.
              localRevs[k] = rRev > lRev ? rRev : lRev;
            }
            syncedRevs[k] = rRev;
            revsTouched = true;
            syncedTouched = true;
            if (localDeletions[k] && localDeletions[k] < rRev) removeLocalDeletion(k);
            return;
          }
          // Não é array de registros → cai no LWW clássico abaixo.
        }
      }

      // Empate vai para o local: protege writes feitos durante o pull
      // inicial (que carimbam localRev = Date.now() > 0, enquanto remoto
      // ainda tem o rev antigo).
      if (rRev <= lRev) return;
      // Se a deleção local é mais recente, mantém para propagar.
      if (localDeletions[k] && localDeletions[k] >= rRev) return;

      try {
        if (isTombstone) {
          if (localStorage.getItem(k) !== null) {
            localStorage.removeItem(k);
            changed++;
          }
        } else {
          var next = String(remoteKeys[k]);
          var cur = localStorage.getItem(k);
          if (!storageValuesEqual(cur, next)) {
            localStorage.setItem(k, next);
            changed++;
          }
        }
      } catch (e) {
        console.warn('[AppliqueiCloudSync] apply key', k, e);
      }

      localRevs[k] = rRev;
      syncedRevs[k] = rRev;
      revsTouched = true;
      syncedTouched = true;
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
  if (syncedTouched) writeJsonMap(SYNCED_REVS_LS, syncedRevs);

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
    // O push via SDK pode ficar gateado (serverViewReady) ou o debounce de 2s
    // não sobreviver ao reload abaixo — o beacon (rev-safe) garante o egress.
    scheduleBeacon('reconcile');
  }

  if (changed > 0) {
    var msg =
      (opts && opts.reloadMessage) || 'Dados atualizados em outro dispositivo. Recarregando…';
    if (typeof window.mostrarToast === 'function') {
      window.mostrarToast(msg, 'sucesso');
    }
    setTimeout(function () {
      // O reload aborta fetches em voo: manda o que estiver dirty via
      // keepalive antes de navegar (dirtyKeys é in-memory e morre no reload;
      // localRevs>syncedRevs persistidos re-marcam dirty depois, mas só num
      // próximo pull — melhor não depender disso).
      try {
        if (beaconTimer) {
          clearTimeout(beaconTimer);
          beaconTimer = null;
        }
        beaconFlushNow('pre-reload', true);
      } catch (_) {}
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
    diag.lastPull = { t: Date.now(), ok: true, changed: changed, fromServer: !!fromServer };
    if (Object.keys(dirtyKeys).length > 0 || Object.keys(getLocalDeletions()).length > 0) {
      schedulePush();
      scheduleBeacon('post-pull');
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
    diag.lastPull = {
      t: Date.now(),
      ok: false,
      error: (err && (err.code || err.message)) || 'erro',
    };
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
  authSettled = true;
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
    localStorage.removeItem(SYNCED_REVS_LS);
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
    // Unload → keepalive (sobrevive ao kill do tab; limitado a ~64KB).
    beaconFlushNow('visibility-hidden', true);
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
  beaconFlushNow('pagehide', true);
  forceFlushNow();
}

try {
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  // A rede voltou (saiu do mercado, pegou o wi-fi de casa): descarrega o que
  // ficou pendente imediatamente, sem esperar o próximo write/visibility.
  window.addEventListener('online', function () {
    if (Object.keys(dirtyKeys).length > 0 || Object.keys(getLocalDeletions()).length > 0) {
      beaconFlushNow('online', false);
      forceFlushNow();
    }
  });
} catch (_) {}

// ===================================================================
// Diagnóstico em campo: /app?syncdebug=1 (ou #syncdebug) abre um painel
// que mostra, sem DevTools, exatamente onde o sync está travando:
// versão do código, login/e-mail verificado, pendências e o resultado
// dos últimos envio/pull — inclusive o motivo de um 403 (e-mail não
// verificado / assinatura expirada). Também dá para forçar um teste de
// ida-e-volta com um toque.
// ===================================================================
function collectDiagnostics() {
  var fb = window.AppliqueiFirebase;
  var u = fb && fb.auth && fb.auth.currentUser;
  var guest = false;
  try {
    guest = localStorage.getItem('appliquei_auth_guest') === '1';
  } catch (_) {}
  return {
    build: SYNC_BUILD,
    firebasePronto: !!(fb && fb.ready),
    autenticacaoResolvida: authSettled,
    logado: !!u,
    email: (u && u.email) || null,
    emailVerificado: u ? u.emailVerified === true : null,
    convidado: guest,
    pullInicialFeito: initialPullDone,
    visaoFrescaDoServidor: serverViewReady,
    chavesPendentes: Object.keys(dirtyKeys),
    delecoesPendentes: Object.keys(getLocalDeletions()),
    ultimoBeacon: diag.lastBeacon,
    ultimoPull: diag.lastPull,
    ultimoPushSdk: diag.lastSdkPush,
  };
}

function fmtHora(t) {
  if (!t) return '—';
  var d = new Date(t);
  function p(n) {
    n = String(n);
    return n.length < 2 ? '0' + n : n;
  }
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function renderDebugPanel(el) {
  var d = collectDiagnostics();
  var lines = [];
  lines.push('<b>Sync build:</b> ' + d.build);
  if (!d.logado) {
    lines.push(
      '<b style="color:#fca5a5">SEM LOGIN' +
        (d.convidado ? ' (modo convidado)' : '') +
        ' — nada é sincronizado.</b>'
    );
  } else {
    lines.push(
      '<b>Login:</b> ' +
        (d.email || '(sem e-mail)') +
        (d.emailVerificado ? ' — verificado ✓' : ' — <b style="color:#fca5a5">NÃO VERIFICADO ✗</b>')
    );
  }
  lines.push(
    '<b>Pull inicial:</b> ' +
      (d.pullInicialFeito ? 'feito' : 'pendente') +
      ' · <b>visão do servidor:</b> ' +
      (d.visaoFrescaDoServidor ? 'ok' : 'ainda não')
  );
  lines.push(
    '<b>Pendências:</b> ' +
      d.chavesPendentes.length +
      ' chave(s)' +
      (d.chavesPendentes.length ? ' — ' + d.chavesPendentes.join(', ') : '')
  );
  var b = d.ultimoBeacon;
  if (b) {
    var okB = b.status === 200 && !b.error;
    lines.push(
      '<b>Último envio:</b> ' +
        fmtHora(b.t) +
        ' — ' +
        (okB
          ? 'ok (aceitas ' + (b.accepted != null ? b.accepted : '?') + ' de ' + b.sent + ')'
          : (b.status ? 'HTTP ' + b.status : 'falha') + (b.error ? ' · ' + b.error : '')) +
        (b.stale ? ' · conflito: ' + b.stale.join(', ') : '') +
        (b.rejected ? ' · rejeitadas: ' + b.rejected.join(', ') : '')
    );
  } else {
    lines.push('<b>Último envio:</b> nenhum ainda');
  }
  var p = d.ultimoPull;
  lines.push(
    '<b>Último pull:</b> ' +
      (p
        ? fmtHora(p.t) +
          ' — ' +
          (p.ok
            ? (p.fromServer ? 'servidor' : 'cache') + ', ' + (p.changed || 0) + ' mudança(s)'
            : 'ERRO: ' + (p.error || '?'))
        : 'nenhum ainda')
  );
  var s = d.ultimoPushSdk;
  if (s && !s.ok) lines.push('<b>Push SDK:</b> ERRO: ' + (s.error || '?'));
  el.querySelector('#syncDebugBody').innerHTML = lines.join('<br>');
}

function initDebugPanel() {
  var wants = false;
  try {
    var loc = window.location;
    var qs = (loc ? String(loc.search || '') + String(loc.hash || '') : '').toLowerCase();
    wants = qs.indexOf('syncdebug') !== -1;
  } catch (_) {}
  if (!wants) return;
  try {
    var el = document.createElement('div');
    el.id = 'syncDebugPanel';
    el.style.cssText =
      'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#111827;color:#e5e7eb;' +
      'border:1px solid #374151;border-radius:10px;padding:12px;font:12px/1.6 monospace;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.45);max-height:45vh;overflow:auto;';
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
      '<strong>Diagnóstico da sincronização</strong>' +
      '<button id="syncDebugClose" style="background:none;border:0;color:#e5e7eb;font-size:16px;cursor:pointer;">&times;</button>' +
      '</div>' +
      '<div id="syncDebugBody">carregando…</div>' +
      '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button id="syncDebugSend" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;">Enviar teste agora</button>' +
      '<button id="syncDebugPull" style="background:#374151;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;">Puxar da nuvem</button>' +
      '</div>';
    document.body.appendChild(el);
    var iv = setInterval(function () {
      try {
        renderDebugPanel(el);
      } catch (_) {}
    }, 2000);
    renderDebugPanel(el);
    el.querySelector('#syncDebugClose').addEventListener('click', function () {
      clearInterval(iv);
      el.remove();
    });
    el.querySelector('#syncDebugSend').addEventListener('click', function () {
      // Ida-e-volta real: escreve uma chave-sonda, empurra já e o painel
      // mostra o resultado do envio nos próximos segundos.
      try {
        localStorage.setItem('appliquei_sync_probe', new Date().toISOString());
      } catch (_) {}
      try {
        window.AppliqueiCloudSync.onLocalWrite('appliquei_sync_probe');
      } catch (_) {}
      beaconFlushNow('debug-panel', false);
      forceFlushNow();
    });
    el.querySelector('#syncDebugPull').addEventListener('click', function () {
      var u =
        window.AppliqueiFirebase && AppliqueiFirebase.auth && AppliqueiFirebase.auth.currentUser;
      if (u) pullAndApply(u.uid, function () {});
    });
  } catch (e) {
    console.warn('[AppliqueiCloudSync] debug panel', e);
  }
}

try {
  console.log('[AppliqueiCloudSync] build', SYNC_BUILD);
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDebugPanel);
  } else {
    initDebugPanel();
  }
} catch (_) {}

window.AppliqueiCloudSync = {
  version: SYNC_BUILD,
  getDiagnostics: collectDiagnostics,
  // prevValue (opcional): valor anterior da chave, passado pelo wrapper de
  // localStorage.setItem. Usado para detectar registros REMOVIDOS de arrays
  // com id (despesa apagada) e registá-los no ledger de tombstones — sem
  // isso, o merge por registro do outro device ressuscitaria o apagado.
  onLocalWrite: function (key, prevValue) {
    if (applyingPull) return;
    if (!shouldSyncKey(key)) return;
    if (key !== TOMBSTONES_KEY && typeof prevValue === 'string') {
      try {
        var prevArr = parseIdArray(prevValue);
        if (prevArr) {
          var curArr = parseIdArray(localStorage.getItem(key));
          if (curArr) {
            var curIds = {};
            curArr.forEach(function (it) {
              curIds[String(it.id)] = true;
            });
            var removed = [];
            prevArr.forEach(function (it) {
              var id = String(it.id);
              if (!curIds[id]) removed.push(id);
            });
            var tombNow = getTombstones()[key] || {};
            var revived = [];
            curArr.forEach(function (it) {
              var id = String(it.id);
              if (tombNow[id]) revived.push(id);
            });
            updateRecordTombstones(key, removed, revived);
          }
        }
      } catch (_) {}
    }
    setLocalRev(key, nextRev(key));
    dirtyKeys[key] = true;
    removeLocalDeletion(key);
    schedulePush();
    // Beacon eager: garante entrega antes de o iOS suspender o processo.
    // Esperar pelo visibilitychange é arriscado porque iOS dispara esse
    // evento depois do freeze em alguns cenários (lock screen rápido).
    scheduleBeacon('write:' + key);
    if (window.AppliqueiFirebase && AppliqueiFirebase.auth && AppliqueiFirebase.auth.currentUser) {
      setCloudStatus('pending');
    } else if (authSettled) {
      // Sem login (convidado / sessão perdida) não há sincronização — deixa
      // isso explícito em vez do "Salvo às HH:MM" que sugeria nuvem.
      setCloudStatus('local-only');
    }
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
    if (window.AppliqueiFirebase && AppliqueiFirebase.auth && AppliqueiFirebase.auth.currentUser) {
      setCloudStatus('pending');
    }
  },
  flushNow: flushPush,
  forceFlush: forceFlushNow,
  beaconNow: function () {
    beaconFlushNow('manual', false);
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
