'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../api/_lib/schemas');

test('cpfCnpj aceita formatado e cru, ambos válidos', () => {
  assert.deepEqual(S.cpfCnpj.parse('529.982.247-25'), '529.982.247-25');
  assert.deepEqual(S.cpfCnpj.parse('52998224725'), '52998224725');
});

test('cpfCnpj rejeita DV inválido', () => {
  const r = S.cpfCnpj.safeParse('11122233344');
  assert.equal(r.success, false);
});

test('referralCode normaliza para uppercase e valida pattern', () => {
  assert.equal(S.referralCode.parse('app-abc123'), 'APP-ABC123');
  const r = S.referralCode.safeParse('XYZ-12345');
  assert.equal(r.success, false);
});

test('email normaliza lowercase + trim', () => {
  assert.equal(S.email.parse('  Foo@Bar.COM '), 'foo@bar.com');
  assert.equal(S.email.safeParse('not-email').success, false);
});

test('phoneBR aceita 10 e 11 dígitos com ou sem máscara', () => {
  assert.equal(S.phoneBR.parse('(11) 98765-4321'), '(11) 98765-4321');
  assert.equal(S.phoneBR.parse('1198765432'), '1198765432');
  assert.equal(S.phoneBR.safeParse('123').success, false);
});

test('cep aceita 8 dígitos com ou sem hífen', () => {
  assert.equal(S.cep.parse('01310-100'), '01310-100');
  assert.equal(S.cep.parse('01310100'), '01310100');
  assert.equal(S.cep.safeParse('123').success, false);
});

test('billingInitBody aceita objeto vazio (referralCode opcional)', () => {
  assert.deepEqual(S.billingInitBody.parse({}), {});
  assert.deepEqual(S.billingInitBody.parse({ referralCode: 'APP-AAA111' }), {
    referralCode: 'APP-AAA111',
  });
});

test('billingInitBody rejeita campos extras (strict)', () => {
  const r = S.billingInitBody.safeParse({ extra: 1 });
  assert.equal(r.success, false);
});

test('billingSubscribeBody exige cpfCnpj válido + nome', () => {
  const ok = S.billingSubscribeBody.safeParse({
    cpfCnpj: '52998224725',
    name: 'Anna Silva',
  });
  assert.equal(ok.success, true);

  const noCpf = S.billingSubscribeBody.safeParse({ name: 'X' });
  assert.equal(noCpf.success, false);

  const invalidCpf = S.billingSubscribeBody.safeParse({
    cpfCnpj: '11111111111',
    name: 'X X',
  });
  assert.equal(invalidCpf.success, false);
});

test('billingSubscribeBody valida creditCard quando presente', () => {
  const r = S.billingSubscribeBody.safeParse({
    cpfCnpj: '52998224725',
    name: 'Anna Silva',
    creditCard: {
      holderName: 'Anna Silva',
      number: '4111111111111111',
      expiryMonth: '12',
      expiryYear: '2030',
      ccv: '123',
    },
  });
  assert.equal(r.success, true);
});

test('billingSubscribeBody rejeita expiryMonth fora de 01-12', () => {
  const r = S.billingSubscribeBody.safeParse({
    cpfCnpj: '52998224725',
    name: 'Anna Silva',
    creditCard: {
      holderName: 'A B',
      number: '4111111111111111',
      expiryMonth: '13',
      expiryYear: '2030',
      ccv: '123',
    },
  });
  assert.equal(r.success, false);
});

test('marketQuoteQuery / marketHistoryQuery / marketWarmupQuery', () => {
  assert.equal(S.marketQuoteQuery.safeParse({ op: 'quote', tickers: 'PETR4' }).success, true);
  assert.equal(S.marketQuoteQuery.safeParse({ op: 'history', tickers: 'x' }).success, false);
  assert.equal(
    S.marketHistoryQuery.safeParse({ op: 'history', ticker: 'PETR4', range: '1y' }).success,
    true
  );
  assert.equal(
    S.marketHistoryQuery.safeParse({ op: 'history', ticker: 'PETR4', range: 'invalid' }).success,
    false
  );
  assert.equal(S.marketWarmupQuery.safeParse({ op: 'warmup' }).success, true);
});

test('syncPushBody exige idToken, keys, keyRevs', () => {
  const r = S.syncPushBody.safeParse({
    idToken: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.payload.sig',
    keys: { 'futurorico_transacoes': '[]' },
    keyRevs: { 'futurorico_transacoes': 1234567890 },
  });
  assert.equal(r.success, true);

  const bad = S.syncPushBody.safeParse({ idToken: 'short', keys: {}, keyRevs: {} });
  assert.equal(bad.success, false);
});
