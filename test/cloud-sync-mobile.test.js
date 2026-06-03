'use strict';

// Regressão do bug "lancei um registro no celular e não gravou / não apareceu
// no web". Carrega o módulo REAL web/appliquei-cloud-sync.js numa sandbox vm
// (o ficheiro só usa `var` + globais, sem import/export, por isso roda direto)
// e reproduz o cenário crítico do mobile:
//
//   1. utilizador abre a app (sessão já autenticada);
//   2. o pull inicial .get({source:'server'}) ainda está PENDENTE
//      (rede lenta / ligação meia-aberta — comum no mobile);
//   3. o utilizador lança um registo (escreve futurorico_transacoes);
//   4. bloqueia o ecrã → visibilitychange:hidden / pagehide.
//
// ANTES da correção, beaconFlushNow/flushPush estavam ambos gateados em
// initialPullDone, então NADA saía do device nessa janela e, se o SO matasse
// o tab, o dado nunca chegava ao Firestore. A correção desacopla o beacon
// (rev-safe no servidor) do pull inicial.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const FILE = path.resolve(__dirname, '..', 'web/appliquei-cloud-sync.js');
const SOURCE = fs.readFileSync(FILE, 'utf8');

function makeStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Espera alguns turnos de microtask para as Promises internas do módulo
// (getIdToken, get, set) propagarem.
async function flush(times) {
  for (let i = 0; i < (times || 6); i++) await Promise.resolve();
}

// Constrói a sandbox + carrega o módulo. Devolve handles para dirigir o cenário.
function load(opts) {
  opts = opts || {};
  const docListeners = {};
  const winListeners = {};
  const beaconPosts = []; // { keys, keyRevs, idToken }
  const sdkSets = []; // payloads de dataDoc.set()
  const idTokenResolvers = [];

  const serverGet = deferred();
  const cacheSnap = opts.cacheSnap || { exists: false };

  const dataDoc = {
    get: (o) => {
      if (o && o.source === 'cache') return Promise.resolve(cacheSnap);
      return serverGet.promise; // source:'server' fica sob controlo do teste
    },
    set: (payload) => {
      sdkSets.push(payload);
      return Promise.resolve();
    },
    onSnapshot: () => function unsub() {},
  };
  const db = {
    collection: () => ({ doc: () => ({ collection: () => ({ doc: () => dataDoc }) }) }),
  };

  const idTokenForceCalls = [];
  const user = {
    uid: 'user-abc',
    // Token nunca resolve sozinho: o teste decide quando, para simular
    // "token ainda não cacheado" vs "já cacheado". Regista se foi pedido com
    // forceRefresh=true (getIdToken(true)) — usado para testar a auto-cura.
    getIdToken: (force) => {
      idTokenForceCalls.push(!!force);
      return new Promise((res) => idTokenResolvers.push(res));
    },
    reload: () => Promise.resolve(),
  };
  let authCb = null;
  const auth = {
    currentUser: user,
    onAuthStateChanged: (cb) => {
      authCb = cb;
    },
    onIdTokenChanged: () => {},
  };

  const firebase = {
    firestore: { FieldValue: { delete: () => '__DEL__', serverTimestamp: () => '__TS__' } },
  };

  const win = {
    AppliqueiFirebase: { ready: true, app: {}, auth, db },
    firebase,
    localStorage: makeStorage(opts.seed),
    navigator: {
      sendBeacon: (url, blob) => {
        beaconPosts.push({ via: 'sendBeacon', url });
        return true;
      },
    },
    fetch: (url, init) => {
      let parsed = {};
      try {
        parsed = JSON.parse(init.body);
      } catch (_) {}
      const keepalive = init && init.keepalive === true;
      const bytes = init && init.body ? init.body.length : 0;
      // Modela o limite real do browser: keepalive/sendBeacon rejeitam corpo
      // acima de ~64KB. Só ativo quando o teste pede (opts.enforce64k).
      if (opts.enforce64k && keepalive && bytes > 64 * 1024) {
        beaconPosts.push({ via: 'fetch', url, keepalive, bytes, rejected: true });
        return Promise.reject(new TypeError('keepalive body exceeds 64KB'));
      }
      // opts.beaconStatuses: sequência de status HTTP por chamada (ex.: [403,
      // 200] para testar a auto-cura). Sem ela, sempre 200.
      let status = 200;
      if (Array.isArray(opts.beaconStatuses)) {
        const i = Math.min(
          beaconPosts.filter((p) => p.via === 'fetch').length,
          opts.beaconStatuses.length - 1
        );
        status = opts.beaconStatuses[i];
      }
      const ok = status >= 200 && status < 300;
      beaconPosts.push({ via: 'fetch', url, keepalive, bytes, rejected: false, status, ...parsed });
      const errBody = JSON.stringify({
        error:
          status === 403 ? 'email_not_verified' : status === 401 ? 'invalid_token' : 'invalid_body',
      });
      return Promise.resolve({
        ok,
        status,
        json: async () =>
          ok ? { ok: true, accepted: Object.keys(parsed.keys || {}).length } : JSON.parse(errBody),
        text: async () => (ok ? 'ok' : errBody),
      });
    },
    document: {
      visibilityState: 'visible',
      addEventListener: (ev, cb) => {
        docListeners[ev] = cb;
      },
      removeEventListener: () => {},
    },
    addEventListener: (ev, cb) => {
      winListeners[ev] = cb;
    },
    removeEventListener: () => {},
    mostrarToast: () => {},
    // Timers reais, mas unref para não segurar o processo (o teto de 8s do
    // pull cria um timer que normalmente não dispara durante o teste).
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t && t.unref) t.unref();
      return t;
    },
    clearTimeout,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Date,
    Math,
    Promise,
    Blob: class Blob {
      constructor() {}
    },
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;

  const ctx = vm.createContext(win);
  vm.runInContext(SOURCE, ctx, { filename: 'appliquei-cloud-sync.js' });

  return {
    win,
    api: win.AppliqueiCloudSync,
    beaconPosts,
    sdkSets,
    idTokenForceCalls,
    fireAuth: () => authCb && authCb(user),
    resolveIdTokens: (tok) => {
      const r = idTokenResolvers.splice(0);
      r.forEach((res) => res(tok || 'TOKEN_aaaaaaaaaaaaaaaaaaaa'));
    },
    resolveServerGet: (snap) => serverGet.resolve(snap),
    hidden: () => {
      win.document.visibilityState = 'hidden';
      if (docListeners.visibilitychange) docListeners.visibilitychange();
    },
    pagehide: () => {
      if (winListeners.pagehide) winListeners.pagehide();
    },
    write: (k, v) => {
      win.localStorage.setItem(k, v);
      win.AppliqueiCloudSync.onLocalWrite(k);
    },
  };
}

test('beacon do registro lançado no celular sai ANTES do pull inicial terminar', async () => {
  const h = load();
  h.fireAuth(); // login restaurado → pullAndApply começa (get pendente)
  h.resolveIdTokens(); // token aquece (startIdTokenCache)
  await flush();

  // Pull inicial AINDA pendente — initialPullDone=false. Utilizador lança um
  // registo e bloqueia o ecrã imediatamente.
  h.write('futurorico_transacoes', JSON.stringify([{ id: 1, valor: 100 }]));
  h.hidden();
  await flush();

  const posts = h.beaconPosts.filter((p) => p.url === '/api/sync/push');
  assert.ok(
    posts.length >= 1,
    'esperava ≥1 POST p/ /api/sync/push antes do pull terminar (regressão do bug mobile)'
  );
  const last = posts[posts.length - 1];
  assert.ok(
    last.keys && Object.prototype.hasOwnProperty.call(last.keys, 'futurorico_transacoes'),
    'o beacon deve carregar a key futurorico_transacoes'
  );
  assert.equal(
    last.keys.futurorico_transacoes,
    JSON.stringify([{ id: 1, valor: 100 }]),
    'o beacon deve carregar o valor escrito'
  );
  assert.ok(last.keyRevs && last.keyRevs.futurorico_transacoes > 0, 'rev positivo por key');
});

test('beacon obtém o ID token sob demanda quando ainda não está cacheado', async () => {
  const h = load();
  h.fireAuth();
  // NÃO resolvemos o token do startIdTokenCache → cachedIdToken fica null,
  // simulando write logo após login (antes de onIdTokenChanged).
  await flush();

  h.write('futurorico_compras', JSON.stringify([{ id: 9 }]));
  h.hidden();
  await flush();

  // Sem token cacheado o beacon ainda não pôde postar...
  assert.equal(
    h.beaconPosts.filter((p) => p.url === '/api/sync/push').length,
    0,
    'sem token cacheado, ainda não há POST'
  );

  // ...mas pediu o token ao SDK. Quando este resolve, o POST sai.
  h.resolveIdTokens('TOKEN_bbbbbbbbbbbbbbbbbbbb');
  await flush();

  const posts = h.beaconPosts.filter((p) => p.url === '/api/sync/push');
  assert.ok(posts.length >= 1, 'após resolver getIdToken, o beacon deve postar');
  assert.ok(
    posts[posts.length - 1].keys.futurorico_compras !== undefined,
    'o POST deve conter a key escrita'
  );
});

test('push via SDK fica gateado até visão fresca do servidor; beacon cobre a janela', async () => {
  const h = load();
  h.fireAuth();
  h.resolveIdTokens();
  await flush();

  h.write('futurorico_transacoes', JSON.stringify([{ id: 2 }]));
  h.hidden();
  await flush();

  // Antes de ver o servidor: beacon enviou, mas o SDK set() NÃO foi arriscado.
  assert.ok(h.beaconPosts.length >= 1, 'beacon enviou na janela pré-pull');
  assert.equal(h.sdkSets.length, 0, 'SDK set() não deve ocorrer antes da visão do servidor');

  // Servidor responde (doc inexistente → semeia). Agora serverViewReady=true.
  h.resolveServerGet({ exists: false });
  await flush();

  // Um flush manual agora deve empurrar via SDK (caminho secundário liberado).
  h.api.flushNow();
  await flush();
  assert.ok(h.sdkSets.length >= 1, 'após visão do servidor, o SDK push deve funcionar');
});

test('pagehide também dispara o beacon na janela pré-pull', async () => {
  const h = load();
  h.fireAuth();
  h.resolveIdTokens();
  await flush();

  h.write('appliquei_sonhos', JSON.stringify({ x: 1 }));
  h.pagehide();
  await flush();

  const posts = h.beaconPosts.filter((p) => p.url === '/api/sync/push');
  assert.ok(posts.length >= 1, 'pagehide deve disparar o beacon mesmo antes do pull');
});

test('payload grande (>64KB): beacon eager usa fetch normal, sem keepalive (não cai no limite)', async () => {
  // ~70KB num único valor — acima do limite de 64KB do keepalive/sendBeacon.
  const big = 'y'.repeat(70 * 1024);
  const h = load({ enforce64k: true });
  h.fireAuth();
  h.resolveIdTokens();
  await flush();

  h.write('futurorico_transacoes', JSON.stringify([{ id: 1, nota: big }]));
  h.api.beaconNow(); // beacon eager (página ativa, viaUnload=false)
  await flush();

  const posts = h.beaconPosts.filter((p) => p.url === '/api/sync/push');
  assert.ok(posts.length >= 1, 'o beacon grande deve ter saído');
  const last = posts[posts.length - 1];
  assert.equal(last.keepalive, false, 'eager NÃO pode usar keepalive (senão >64KB falha)');
  assert.ok(!last.rejected, 'o request não pode ser rejeitado pelo limite de 64KB');
  assert.ok(last.bytes > 64 * 1024, 'sanity: o corpo realmente passa de 64KB');
  assert.ok(last.keys && last.keys.futurorico_transacoes, 'o servidor recebeu a key grande');
});

test('payload grande no unload: não força keepalive (evita rejeição 64KB)', async () => {
  const big = 'z'.repeat(70 * 1024);
  const h = load({ enforce64k: true });
  h.fireAuth();
  h.resolveIdTokens();
  await flush();

  h.write('futurorico_transacoes', JSON.stringify([{ id: 2, nota: big }]));
  h.hidden(); // caminho de unload (visibility-hidden → viaUnload=true)
  await flush();

  const posts = h.beaconPosts.filter((p) => p.url === '/api/sync/push' && !p.rejected);
  assert.ok(
    posts.length >= 1,
    'mesmo no unload, corpo grande deve sair (sem keepalive) em vez de ser descartado'
  );
  assert.equal(
    posts[posts.length - 1].keepalive,
    false,
    'corpo >64KB no unload deve abrir mão do keepalive em vez de falhar'
  );
});

test('CAUSA RAIZ pós-pull: forceFlush (salvar no controle financeiro) tem de disparar o beacon, não só o SDK', async () => {
  // Reproduz o cenário REAL que sobreviveu a todas as correções anteriores:
  // o utilizador já está com a app aberta há alguns segundos, o pull inicial
  // JÁ terminou (serverViewReady=true). Lança uma despesa no controle
  // financeiro — que chama AppliqueiCloudSync.forceFlush() logo a seguir ao
  // setItem.
  //
  // ANTES do fix, forceFlush só dispara flushPush (SDK set merge), que LIMPA
  // dirtyKeys imediatamente. O beacon eager (300ms) corre depois e encontra
  // dirtyKeys vazio → NÃO envia nada. No mobile o SDK set fica só na
  // IndexedDB e não sobrevive ao freeze do tab, então o lançamento some.
  // O beacon é o único caminho que sobrevive ao freeze — e estava a ser
  // esfomeado nesta janela (a mais comum: salvar depois do pull).
  const h = load();
  h.fireAuth(); // pull inicial começa
  h.resolveServerGet({ exists: false }); // pull termina → serverViewReady=true
  h.resolveIdTokens(); // token aquece → cachedIdToken
  await flush();

  h.write('futurorico_transacoes', JSON.stringify([{ id: 7, valor: 50 }]));
  h.api.forceFlush(); // exatamente o que o controle financeiro faz ao salvar
  await flush();

  const posts = h.beaconPosts.filter((p) => p.url === '/api/sync/push');
  assert.ok(
    posts.length >= 1,
    'forceFlush após o pull deve garantir o beacon — o SDK set sozinho não sobrevive ao freeze do tab no mobile'
  );
  assert.ok(
    posts[posts.length - 1].keys && posts[posts.length - 1].keys.futurorico_transacoes,
    'o beacon disparado pelo forceFlush deve carregar a transação lançada'
  );
});

test('login força token FRESCO (getIdToken(true)) — cura claim email_verified velho que isola o mobile', async () => {
  // Se o e-mail foi verificado noutro aparelho (web), o token deste device pode
  // continuar com email_verified=false em cache. As Firestore rules E o
  // /api/sync/push exigem email_verified=true → o claim velho rejeita PULL e
  // PUSH, isolando o mobile nas duas direções. Forçar um token novo no login
  // reemite o claim atual e destrava ambos.
  const h = load();
  h.fireAuth();
  await flush();
  assert.ok(
    h.idTokenForceCalls.some(Boolean),
    'onUser deve chamar getIdToken(true) no login para reemitir o claim email_verified'
  );
});

test('beacon 403 (claim velho): força token fresco e REENVIA uma vez (auto-cura)', async () => {
  // 1ª POST do beacon volta 403 (email_not_verified por token velho); o módulo
  // deve refrescar o token (getIdToken(true)) e reenviar — a 2ª POST é aceite.
  const h = load({ beaconStatuses: [403, 200] });
  h.fireAuth();
  h.resolveIdTokens(); // resolve o getIdToken(true) do login + warm do cache
  await flush();
  h.resolveServerGet({ exists: false });
  await flush();

  const forcesBefore = h.idTokenForceCalls.filter(Boolean).length;

  h.write('futurorico_transacoes', JSON.stringify([{ id: 1, valor: 9 }]));
  h.api.beaconNow(); // eager → 1ª POST → 403
  await flush();

  assert.ok(
    h.idTokenForceCalls.filter(Boolean).length > forcesBefore,
    'após 403 o beacon deve forçar um token fresco (getIdToken(true))'
  );

  h.resolveIdTokens('TOKEN_fresh_aaaaaaaaaaaaaaaa'); // resolve o token da retry
  await flush();

  const posts = h.beaconPosts.filter((p) => p.url === '/api/sync/push' && p.via === 'fetch');
  assert.ok(posts.length >= 2, 'deve reenviar o beacon após refrescar o token (1ª 403 + 2ª)');
  assert.equal(posts[posts.length - 1].status, 200, 'o reenvio com token fresco deve ser aceite');
  assert.ok(
    posts[posts.length - 1].keys && posts[posts.length - 1].keys.futurorico_transacoes,
    'o reenvio deve carregar a mesma transação'
  );
});

test('rev monotónico: write após pull ganha mesmo com relógio atrasado (anti clock-skew)', async () => {
  // Simula o device já tendo PUXADO um rev remoto alto (como se outro device
  // tivesse o relógio adiantado, ou a web tivesse acabado de escrever). O rev
  // local do device (Date.now) é MENOR que esse rev visto.
  const seenRev = Date.now() + 10_000_000; // ~2h "no futuro" vs. o relógio local
  const h = load({
    seed: { appliquei_cloud_key_revs: JSON.stringify({ futurorico_transacoes: seenRev }) },
  });
  h.fireAuth();
  h.resolveIdTokens();
  await flush();

  // O utilizador lança um registo nessa key.
  h.write('futurorico_transacoes', JSON.stringify(['A', 'B']));
  h.hidden();
  await flush();

  const posts = h.beaconPosts.filter((p) => p.url === '/api/sync/push');
  assert.ok(posts.length >= 1, 'beacon deve enviar');
  const rev = posts[posts.length - 1].keyRevs.futurorico_transacoes;
  // Sem o rev monotónico, rev = Date.now() < seenRev → o servidor (LWW)
  // descartaria o write (curRev >= rev). Com o fix, rev > seenRev → ganha.
  assert.ok(
    rev > seenRev,
    `o rev do write (${rev}) deve superar o rev já visto (${seenRev}) para vencer o LWW`
  );
});
