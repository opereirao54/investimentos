'use strict';

// Regressão do bug persistente "lancei a despesa no celular e não apareceu no
// PC". A causa estrutural: cada chave (ex.: futurorico_transacoes) guarda TODAS
// as transações num único JSON e o sync fazia last-write-wins do array INTEIRO
// — quando dois devices divergiam, um lado perdia tudo o que fez. Estes testes
// cobrem o merge por registro (união por id), os tombstones de deleção e a
// resiliência do beacon (401 → refresh de token → reenvio).

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const FILE = path.resolve(__dirname, '..', 'web/appliquei-cloud-sync.js');
const SOURCE = fs.readFileSync(FILE, 'utf8');

const TOMB_KEY = 'appliquei_sync_tombstones_v1';

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

async function flush(times) {
  for (let i = 0; i < (times || 8); i++) await Promise.resolve();
}

// Sandbox igual à de cloud-sync-mobile.test.js, com dois extras:
//  - opts.fetchResponses: fila de respostas do /api/sync/push (para simular
//    401, stale, etc.). Sem fila → 200 aceitando tudo.
//  - getIdToken resolve imediatamente (token não é o foco aqui).
function load(opts) {
  opts = opts || {};
  const docListeners = {};
  const winListeners = {};
  const beaconPosts = [];
  const sdkSets = [];
  const fetchQueue = (opts.fetchResponses || []).slice();

  const serverGet = deferred();
  const cacheSnap = opts.cacheSnap || { exists: false };

  const dataDoc = {
    get: (o) => {
      if (o && o.source === 'cache') return Promise.resolve(cacheSnap);
      return serverGet.promise;
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

  const tokenLog = [];
  const user = {
    uid: 'user-abc',
    getIdToken: (force) => {
      tokenLog.push({ force: !!force });
      return Promise.resolve(force ? 'TOKEN_fresh_ffffffffffff' : 'TOKEN_warm_wwwwwwwwwwww');
    },
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
    navigator: { sendBeacon: () => true },
    fetch: (url, init) => {
      let parsed = {};
      try {
        parsed = JSON.parse(init.body);
      } catch (_) {}
      const next = fetchQueue.length ? fetchQueue.shift() : null;
      const status = (next && next.status) || 200;
      const post = {
        url,
        status,
        idToken: parsed.idToken,
        keys: parsed.keys,
        keyRevs: parsed.keyRevs,
      };
      beaconPosts.push(post);
      if (status !== 200) {
        return Promise.resolve({
          ok: false,
          status,
          json: async () => (next && next.body) || { error: 'x' },
          text: async () => JSON.stringify((next && next.body) || {}),
        });
      }
      const accepted = Object.keys(parsed.keys || {}).length;
      const body = (next && next.body) || { ok: true, accepted, rejected: [], stale: [] };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => 'ok',
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
    tokenLog,
    fireAuth: () => authCb && authCb(user),
    resolveServerGet: (snap) => serverGet.resolve(snap),
    hidden: () => {
      win.document.visibilityState = 'hidden';
      if (docListeners.visibilitychange) docListeners.visibilitychange();
    },
    online: () => winListeners.online && winListeners.online(),
    write: (k, v) => {
      const prev = win.localStorage.getItem(k);
      win.localStorage.setItem(k, v);
      win.AppliqueiCloudSync.onLocalWrite(k, prev);
    },
  };
}

function snapOf(keys, keyRevs) {
  return {
    exists: true,
    metadata: { fromCache: false, hasPendingWrites: false },
    data: () => ({ schemaVersion: 2, keys, keyRevs, updatedAt: { toMillis: () => 1 } }),
  };
}

test('merge por id: lançamento local sobrevive a pull com rev remoto maior (o bug do celular)', async () => {
  const A = { id: 'a', descricao: 'aluguel', valor: 1000 };
  const B = { id: 'b', descricao: 'mercado (celular)', valor: 87.5 };
  const C = { id: 'c', descricao: 'internet (web)', valor: 120 };

  const h = load({
    seed: {
      // Local: A + B (B é o lançamento do celular, ainda não sincronizado:
      // localRev 2000 > syncedRev 1000).
      futurorico_transacoes: JSON.stringify([A, B]),
      appliquei_cloud_key_revs: JSON.stringify({ futurorico_transacoes: 2000 }),
      appliquei_cloud_synced_revs: JSON.stringify({ futurorico_transacoes: 1000 }),
    },
  });
  h.fireAuth();
  await flush();

  // Remoto mais novo (a web escreveu C): rev 3000 > 2000. LWW cego apagaria B.
  h.resolveServerGet(
    snapOf({ futurorico_transacoes: JSON.stringify([A, C]) }, { futurorico_transacoes: 3000 })
  );
  await flush();

  const merged = JSON.parse(h.win.localStorage.getItem('futurorico_transacoes'));
  const ids = merged.map((t) => t.id).sort();
  assert.deepEqual(ids, ['a', 'b', 'c'], 'o merge deve unir os registros dos dois devices');

  // E o merge volta para o servidor com rev que vence o LWW de lá.
  h.hidden();
  await flush();
  const posts = h.beaconPosts.filter((p) => p.keys && p.keys.futurorico_transacoes);
  assert.ok(posts.length >= 1, 'o resultado do merge deve ser re-enviado');
  const last = posts[posts.length - 1];
  assert.ok(
    last.keyRevs.futurorico_transacoes > 3000,
    'o rev do merge deve superar o rev remoto para vencer o LWW'
  );
  const sentIds = JSON.parse(last.keys.futurorico_transacoes)
    .map((t) => t.id)
    .sort();
  assert.deepEqual(sentIds, ['a', 'b', 'c']);
});

test('sem mudança local pendente → LWW normal (deleção de outro device NÃO ressuscita)', async () => {
  const A = { id: 'a', v: 1 };
  const B = { id: 'b', v: 2 };
  const h = load({
    seed: {
      futurorico_transacoes: JSON.stringify([A, B]),
      // Tudo sincronizado: localRev == syncedRev.
      appliquei_cloud_key_revs: JSON.stringify({ futurorico_transacoes: 2000 }),
      appliquei_cloud_synced_revs: JSON.stringify({ futurorico_transacoes: 2000 }),
    },
  });
  h.fireAuth();
  await flush();

  // Outro device apagou B e escreveu com rev maior.
  h.resolveServerGet(
    snapOf({ futurorico_transacoes: JSON.stringify([A]) }, { futurorico_transacoes: 3000 })
  );
  await flush();

  const val = JSON.parse(h.win.localStorage.getItem('futurorico_transacoes'));
  assert.deepEqual(
    val.map((t) => t.id),
    ['a'],
    'sem mudança local pendente, o remoto (que apagou B) vence — sem ressuscitar'
  );
});

test('divergência concorrente com rev REMOTO MENOR que o local (clock skew): merge, não perde nenhum lado', async () => {
  // O bug real do "cada aparelho com um total diferente, ambos dizendo synced".
  // PC editou por último (ou tem relógio adiantado): localRev 5000. Celular
  // editou uma OUTRA transação com rev 3000 (relógio atrasado) e já subiu.
  // Ambos avançaram além do último sync comum (syncedRev 1000).
  // O LWW antigo fazia `if (rRev(3000) <= lRev(5000)) return` → o registro do
  // celular era DESCARTADO no PC (e vice-versa) → divergência permanente.
  const A = { id: 'a', v: 1 }; // comum
  const PC = { id: 'pc', v: 2 }; // editado no PC (local)
  const CEL = { id: 'cel', v: 3 }; // lançado no celular (remoto, rev menor)

  const h = load({
    seed: {
      futurorico_transacoes: JSON.stringify([A, PC]),
      appliquei_cloud_key_revs: JSON.stringify({ futurorico_transacoes: 5000 }),
      appliquei_cloud_synced_revs: JSON.stringify({ futurorico_transacoes: 1000 }),
    },
  });
  h.fireAuth();
  await flush();

  // Remoto tem rev MENOR (3000 < 5000) mas também avançou além de 1000.
  h.resolveServerGet(
    snapOf({ futurorico_transacoes: JSON.stringify([A, CEL]) }, { futurorico_transacoes: 3000 })
  );
  await flush();

  const ids = JSON.parse(h.win.localStorage.getItem('futurorico_transacoes'))
    .map((t) => t.id)
    .sort();
  assert.deepEqual(
    ids,
    ['a', 'cel', 'pc'],
    'apesar do rev remoto ser MENOR, o registro do celular deve ser unido (não descartado pelo LWW)'
  );

  // E deve re-subir a união com rev acima de ambos.
  h.hidden();
  await flush();
  const posts = h.beaconPosts.filter((p) => p.keys && p.keys.futurorico_transacoes);
  assert.ok(posts.length >= 1, 'a união deve voltar ao servidor');
  const last = posts[posts.length - 1];
  assert.ok(
    last.keyRevs.futurorico_transacoes > 5000,
    'o rev da união deve superar AMBOS os revs (5000 e 3000)'
  );
});

test('tombstone remoto: registro apagado no outro device não ressuscita via merge', async () => {
  const A = { id: 'a', v: 1 };
  const B = { id: 'b', v: 2 };
  const NOVO = { id: 'novo', v: 3 };
  const h = load({
    seed: {
      // Local tem A, B e um lançamento novo não sincronizado.
      futurorico_transacoes: JSON.stringify([A, B, NOVO]),
      appliquei_cloud_key_revs: JSON.stringify({ futurorico_transacoes: 2000 }),
      appliquei_cloud_synced_revs: JSON.stringify({ futurorico_transacoes: 1000 }),
    },
  });
  h.fireAuth();
  await flush();

  // Remoto: apagou B (array sem B + tombstone) e tem rev maior.
  h.resolveServerGet(
    snapOf(
      {
        futurorico_transacoes: JSON.stringify([A]),
        [TOMB_KEY]: JSON.stringify({ futurorico_transacoes: { b: Date.now() } }),
      },
      { futurorico_transacoes: 3000, [TOMB_KEY]: 3000 }
    )
  );
  await flush();

  const ids = JSON.parse(h.win.localStorage.getItem('futurorico_transacoes'))
    .map((t) => t.id)
    .sort();
  assert.deepEqual(ids, ['a', 'novo'], 'B (tombstoned) fica fora; NOVO (local) sobrevive');
});

test('deleção local de registro gera tombstone e viaja no beacon', async () => {
  const A = { id: 'a', v: 1 };
  const B = { id: 'b', v: 2 };
  const h = load();
  h.fireAuth();
  h.resolveServerGet({ exists: false });
  await flush();

  h.write('futurorico_transacoes', JSON.stringify([A, B]));
  // Usuário apaga B: escrita do array sem B, com prev contendo B.
  h.write('futurorico_transacoes', JSON.stringify([A]));

  const ledger = JSON.parse(h.win.localStorage.getItem(TOMB_KEY) || '{}');
  assert.ok(
    ledger.futurorico_transacoes && ledger.futurorico_transacoes.b > 0,
    'a deleção do registro b deve estar no ledger de tombstones'
  );

  h.hidden();
  await flush();
  const posts = h.beaconPosts.filter((p) => p.keys && p.keys[TOMB_KEY]);
  assert.ok(posts.length >= 1, 'o ledger de tombstones deve ser sincronizado junto');
});

test('beacon 401 (token expirado): força refresh do token e reenvia', async () => {
  const h = load({
    fetchResponses: [{ status: 401, body: { error: 'invalid_token' } }],
  });
  h.fireAuth();
  // Pull inicial fica pendente (cenário mobile): o push via SDK segue gateado
  // e o beacon é o único caminho de egress — exatamente a janela do bug.
  await flush();

  h.write('futurorico_transacoes', JSON.stringify([{ id: 'x', v: 1 }]));
  h.hidden(); // beacon imediato → leva o 401
  await flush(16);

  const posts = h.beaconPosts;
  assert.ok(posts.length >= 2, 'após o 401 deve haver um reenvio');
  assert.ok(
    h.tokenLog.some((t) => t.force === true),
    'o reenvio deve pedir getIdToken(true) — refresh forçado'
  );
  const last = posts[posts.length - 1];
  assert.equal(last.status, 200, 'o reenvio (token fresco) deve suceder');
  assert.ok(last.keys.futurorico_transacoes, 'o reenvio carrega a chave escrita');
});

test('evento online reenvia o que ficou pendente', async () => {
  // Primeira tentativa cai com 500 (rede/servidor); o evento online dispara o reenvio.
  const h = load({ fetchResponses: [{ status: 500, body: { error: 'boom' } }] });
  h.fireAuth();
  // Pull pendente → SDK gateado; o beacon é o único egress (cenário mobile).
  await flush();

  h.write('futurorico_transacoes', JSON.stringify([{ id: 'y', v: 2 }]));
  h.hidden();
  await flush(16);
  const before = h.beaconPosts.length;
  assert.ok(before >= 1, 'primeira tentativa saiu (e falhou com 500)');

  h.online();
  await flush(16);
  assert.ok(h.beaconPosts.length > before, 'o evento online deve reenviar');
  assert.equal(h.beaconPosts[h.beaconPosts.length - 1].status, 200);
});

test('resposta stale (perdeu o LWW) dispara pull de reconciliação', async () => {
  const A = { id: 'a', v: 1 };
  const B = { id: 'b', v: 2 };
  const h = load({
    cacheSnap: { exists: false },
    fetchResponses: [
      {
        status: 200,
        body: { ok: true, accepted: 0, rejected: [], stale: ['futurorico_transacoes'] },
      },
    ],
    seed: {
      futurorico_transacoes: JSON.stringify([A]),
      appliquei_cloud_key_revs: JSON.stringify({ futurorico_transacoes: 2000 }),
      appliquei_cloud_synced_revs: JSON.stringify({ futurorico_transacoes: 1000 }),
    },
  });
  h.fireAuth();
  // Pull inicial resolve com o remoto MAIS NOVO contendo B (rev 5000).
  h.resolveServerGet(
    snapOf({ futurorico_transacoes: JSON.stringify([A, B]) }, { futurorico_transacoes: 5000 })
  );
  await flush(16);

  // O pull inicial já reconciliou via merge: local ganhou B e ficou dirty
  // (localRev > 5000). Um beacon "stale" adicional não pode quebrar nada:
  h.api.beaconNow();
  await flush(16);

  const ids = JSON.parse(h.win.localStorage.getItem('futurorico_transacoes'))
    .map((t) => t.id)
    .sort();
  assert.deepEqual(ids, ['a', 'b'], 'estado local converge com o remoto sem perder registros');
});
