'use strict';

// Regressão do bug "cadastrei no celular e não gravou no banco", diagnosticado
// em DIAGNOSTICO-SYNC.md.
//
// Causa raiz: /api/sync/push aplicava um teto de 200KB por chave com um
// `return` dentro do forEach. A chave era descartada em SILÊNCIO — não entrava
// em `accepted`, não gerava erro, e o endpoint respondia HTTP 200. Como
// futurorico_transacoes guarda todas as transações num único JSON (354KB numa
// carteira real), TODO push vindo do celular era jogado fora enquanto o app
// exibia "Salvo às HH:MM".
//
// Os dois invariantes que este teste tranca:
//   1. uma chave grande de tamanho realista PERSISTE;
//   2. quando o servidor recusa alguma coisa, ele NOMEIA o que recusou —
//      rejeição silenciosa é o que fez o bug sobreviver a quatro tentativas
//      de correção.

const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const M = require('../scripts/lib/mock-billing');
// setup() injeta os mocks de firebase-admin no require.cache; precisa rodar
// ANTES de carregarmos o handler.
M.setup();
const { store, call } = M;
const ROOT = path.resolve(__dirname, '..');
const push = require(path.join(ROOT, 'api/sync/push'));

const UID = 'u_sync';
const TOKEN = 'fake:' + UID + ':sync@test.com';

function reset() {
  store.docs.clear();
  store.docs.set('users/' + UID + '/billing/account', {
    subscriptionStatus: 'ACTIVE',
    lastPaymentStatus: 'CONFIRMED',
    lastPaidAt: Date.now(),
  });
}

function blob(kb) {
  return 'x'.repeat(kb * 1024);
}

function mainDoc() {
  return store.docs.get('users/' + UID + '/data/main');
}

async function send(keys, keyRevs) {
  return call(push, { method: 'POST', body: { idToken: TOKEN, keys, keyRevs } });
}

test('chave de 354KB (tamanho real de futurorico_transacoes) persiste', async () => {
  reset();
  const valor = blob(354);
  const r = await send({ futurorico_transacoes: valor }, { futurorico_transacoes: 1000 });

  assert.equal(r.status, 200);
  assert.equal(r.body.accepted, 1, 'a chave grande tem de ser aceita');
  assert.deepEqual(r.body.rejected, [], 'nada deveria ser recusado');
  assert.equal(
    mainDoc().keys.futurorico_transacoes,
    valor,
    'o valor tem de estar no documento — este é o write que se perdia'
  );
});

test('chave acima do teto é recusada COM motivo, nunca em silêncio', async () => {
  reset();
  const r = await send({ futurorico_transacoes: blob(900) }, { futurorico_transacoes: 1000 });

  assert.equal(r.status, 200);
  assert.equal(r.body.accepted, 0);
  assert.equal(r.body.rejected.length, 1, 'a recusa TEM de ser reportada');
  assert.equal(r.body.rejected[0].key, 'futurorico_transacoes');
  assert.equal(r.body.rejected[0].reason, 'too_large');
  assert.ok(r.body.rejected[0].bytes > 0, 'o tamanho real tem de vir na resposta');
});

test('recusa de uma chave não impede as outras, e diz qual caiu', async () => {
  reset();
  const r = await send(
    { futurorico_transacoes: blob(900), futurorico_cartoes: '[]' },
    { futurorico_transacoes: 1000, futurorico_cartoes: 1000 }
  );

  assert.equal(r.body.accepted, 1);
  assert.equal(mainDoc().keys.futurorico_cartoes, '[]');
  assert.equal(mainDoc().keys.futurorico_transacoes, undefined);
  assert.deepEqual(
    r.body.rejected.map((x) => x.key),
    ['futurorico_transacoes']
  );
});

test('documento cheio recusa a chave em vez de estourar o limite do Firestore', async () => {
  reset();
  // Preenche o documento perto do teto com chaves que este push não toca.
  await send({ futurorico_compras: blob(700) }, { futurorico_compras: 1000 });
  const r = await send({ futurorico_transacoes: blob(400) }, { futurorico_transacoes: 1000 });

  assert.equal(r.body.accepted, 0);
  assert.equal(r.body.rejected.length, 1);
  assert.equal(r.body.rejected[0].reason, 'doc_full');
  assert.ok(r.body.rejected[0].docBytes > 0, 'o tamanho do doc tem de vir na resposta');
});

test('rev antigo conta como stale (LWW normal), não como rejeição', async () => {
  reset();
  await send({ futurorico_cartoes: 'novo' }, { futurorico_cartoes: 2000 });
  const r = await send({ futurorico_cartoes: 'velho' }, { futurorico_cartoes: 1000 });

  assert.equal(r.body.accepted, 0);
  assert.equal(r.body.stale, 1, 'LWW rejeitando rev antigo é comportamento correto');
  assert.deepEqual(r.body.rejected, [], 'stale não é falha — não polui `rejected`');
  assert.equal(mainDoc().keys.futurorico_cartoes, 'novo');

  // Só a contagem esconde o porquê. Os dois revs são o que permite distinguir
  // relógio atrasado de pull que não chegou, sem adivinhação.
  assert.deepEqual(r.body.staleKeys, [
    { key: 'futurorico_cartoes', sentRev: 1000, serverRev: 2000 },
  ]);
});
