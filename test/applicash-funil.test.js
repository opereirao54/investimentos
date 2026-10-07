'use strict';

/**
 * Funil de indicação: abriu o link → criou conta → está assinando.
 *
 * O vão entre "compartilhei" e "deu certo" era invisível — o indicador
 * mandava o link e nunca mais sabia de nada. As duas últimas etapas já
 * existiam nos dados de billing; só a primeira precisou de infraestrutura, e
 * é ela que estes testes cercam.
 *
 * O contador de cliques é público por necessidade (quem clica ainda não tem
 * conta), então as travas são sobre o que ele NÃO pode fazer: guardar dado
 * do visitante, criar cupom, ou aceitar tráfego ilimitado.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const M = require('../scripts/lib/mock-billing');
const H = M.setup();
const { store, asaasState, call } = M;
const ROOT = path.resolve(__dirname, '..');
const usuario = require(path.join(ROOT, 'api/user.js'));

function reset() {
  store.docs.clear();
  store.now = Date.now();
  asaasState.customers.clear();
  asaasState.subscriptions.clear();
  asaasState.payments.clear();
  asaasState.deletedUids.clear();
  asaasState.seq = 1;
}

const tok = (u) => 'fake:' + u + ':' + u + '@example.com';
const autorizado = (u) => ({ authorization: 'Bearer ' + tok(u) });
const bil = (u) => store.docs.get('users/' + u + '/billing/account') || {};

function clicar(code) {
  return call(usuario, { method: 'POST', body: { code }, headers: {}, query: { op: 'ref-hit' } });
}
function docDoCupom(code) {
  return store.docs.get('referralCodes/' + code);
}

test('o clique no link conta para o dono do cupom', async () => {
  reset();
  await call(H.init, { headers: autorizado('alice'), body: {} });
  const cupom = bil('alice').referralCode;
  assert.ok(cupom, 'a conta precisa nascer com cupom');

  const r = await clicar(cupom);
  assert.equal(r.status, 204, 'telemetria responde sem corpo');
  assert.equal(docDoCupom(cupom).hits, 1);

  await clicar(cupom);
  await clicar(cupom);
  assert.equal(docDoCupom(cupom).hits, 3, 'cada clique soma');
});

test('o contador não guarda nada do visitante', async () => {
  reset();
  await call(H.init, { headers: autorizado('alice'), body: {} });
  const cupom = bil('alice').referralCode;

  await call(usuario, {
    method: 'POST',
    query: { op: 'ref-hit' },
    body: { code: cupom },
    headers: {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
      'x-forwarded-for': '203.0.113.42',
      referer: 'https://instagram.com/perfil-de-alguem',
    },
  });

  const doc = docDoCupom(cupom);
  const gravado = JSON.stringify(doc);
  for (const vazamento of ['203.0.113', 'iPhone', 'Mozilla', 'instagram']) {
    assert.ok(!gravado.includes(vazamento), 'vazou "' + vazamento + '" para o documento do cupom');
  }
  assert.deepEqual(
    Object.keys(doc).sort(),
    ['createdAt', 'hits', 'lastHitAt', 'uid'],
    'o documento só pode ganhar o contador e o carimbo de tempo'
  );
});

test('cupom inexistente não é criado nem revelado', async () => {
  reset();
  // Se `update` virasse `set`, qualquer um criaria reservas de cupom por aqui
  // — e o /init de quem tentasse usá-lo depois casaria com um dono vazio.
  const r = await clicar('APP-ZZZZZZ');
  assert.equal(r.status, 204, 'a resposta não pode distinguir cupom válido de inválido');
  assert.equal(docDoCupom('APP-ZZZZZZ'), undefined, 'não pode criar o documento');
});

test('código malformado é descartado sem tocar o banco', async () => {
  reset();
  for (const lixo of ['', 'nao-e-cupom', 'APP-!!!', null, { toString: () => 'APP-AAAAAA' }]) {
    const r = await clicar(lixo);
    assert.equal(r.status, 204);
  }
  assert.equal(store.docs.size, 0, 'nada foi escrito');
});

test('rate-limit por IP existe', async () => {
  reset();
  await call(H.init, { headers: autorizado('alice'), body: {} });
  const cupom = bil('alice').referralCode;

  for (let i = 0; i < 80; i++) await clicar(cupom);
  const hits = docDoCupom(cupom).hits;
  assert.ok(hits < 80, 'sem teto, o endpoint público vira escrita barata no Firestore');
  assert.ok(hits >= 60, 'o teto não pode ser tão apertado que engula tráfego legítimo');
});

test('/me devolve o funil com as três etapas', async () => {
  reset();
  await call(H.init, { headers: autorizado('alice'), body: {} });
  const cupom = bil('alice').referralCode;

  // Cinco pessoas abriram o link.
  for (let i = 0; i < 5; i++) await clicar(cupom);

  // Duas criaram conta; só uma assinou e pagou.
  await call(H.init, { headers: autorizado('bob'), body: { referralCode: cupom } });
  await call(H.init, { headers: autorizado('caio'), body: { referralCode: cupom } });
  await call(H.subscribe, {
    headers: autorizado('bob'),
    body: { cpfCnpj: '10000000442', name: 'Bob' },
  });
  const pag = Array.from(asaasState.payments.values()).find(
    (p) => p.subscription === bil('bob').subscriptionId
  );
  pag.status = 'CONFIRMED';
  await call(H.webhook, {
    headers: { 'asaas-access-token': 'test_webhook_token' },
    body: { id: 'ev1', event: 'PAYMENT_CONFIRMED', payment: { ...pag } },
  });

  const me = (await call(H.me, { method: 'GET', headers: autorizado('alice') })).body;
  assert.equal(me.funnel.hits, 5, 'cliques');
  assert.equal(me.funnel.signups, 2, 'criaram conta');
  assert.equal(me.funnel.subscribers, 1, 'estão assinando');
  assert.equal(me.funnel.pending, 1, 'o Caio é quem vale um empurrão');
});

test('o funil nunca mostra menos cliques do que cadastros', async () => {
  reset();
  // Quem digitou o cupom à mão, ou clicou antes de o contador existir, não
  // passou pelo ping. Sem o piso o funil exibiria 0 → 1 → 1, que lê como bug.
  await call(H.init, { headers: autorizado('alice'), body: {} });
  const cupom = bil('alice').referralCode;
  await call(H.init, { headers: autorizado('bob'), body: { referralCode: cupom } });

  const me = (await call(H.me, { method: 'GET', headers: autorizado('alice') })).body;
  assert.equal(docDoCupom(cupom).hits, undefined, 'ninguém clicou no link');
  assert.equal(me.funnel.hits, 1, 'o piso é o número de cadastros');
  assert.equal(me.funnel.signups, 1);
});

test('as ops autenticadas de /api/user continuam exigindo login', async () => {
  reset();
  // O roteador passou a fazer a própria auth para poder ter uma op pública.
  // Se a allowlist vazar, feedback e resend-verification ficam abertos.
  for (const op of ['feedback', 'feedback-anexo', 'resend-verification', 'inexistente']) {
    const r = await call(usuario, { method: 'POST', body: {}, headers: {}, query: { op } });
    assert.equal(r.status, 401, 'op "' + op + '" respondeu ' + r.status + ' sem token');
  }
});
