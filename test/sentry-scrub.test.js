'use strict';

// Limpeza de dados pessoais nos eventos do Sentry (api/_lib/sentry-scrub.js e
// a cópia do navegador, web/appliquei-sentry-scrub.js). A Política de
// Privacidade promete erros "sem dados pessoais": e-mail, CPF/CNPJ, cartão,
// valores em R$ e tokens não podem sair no evento. Os mesmos casos rodam nas
// duas cópias, para elas não divergirem.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const servidor = require('../api/_lib/sentry-scrub.js');

function evento() {
  return {
    message: 'Falhou para joao.silva@gmail.com',
    exception: {
      values: [{ type: 'Error', value: 'CPF 123.456.789-09 recusado; cartão 4111 1111 1111 1111' }],
    },
    breadcrumbs: [
      { category: 'console', message: 'saldo R$ 1.234,56 em 1700000000000' },
      { category: 'fetch', data: { url: '/api/x', authorization: 'Bearer abc.def.ghi' } },
    ],
    extra: {
      customer: { cpfCnpj: '12345678909', email: 'a@b.com', id: 'cus_1' },
      nota: 'CNPJ 12.345.678/0001-95',
    },
    user: { id: 'uid1', email: 'a@b.com', ip_address: '1.2.3.4' },
  };
}

// O package é CommonJS: o módulo ES do navegador é avaliado num contexto à
// parte, sem os `export`.
function carregarCopiaWeb() {
  const src = fs
    .readFileSync(path.join(ROOT, 'web/appliquei-sentry-scrub.js'), 'utf8')
    .replace(/^export /gm, '');
  const ctx = vm.createContext({});
  vm.runInContext(src + '\nthis.limparEventoSentry = limparEventoSentry;', ctx);
  return ctx;
}

async function copias() {
  const web = carregarCopiaWeb();
  return [
    ['servidor', servidor.limparEventoSentry],
    ['navegador', web.limparEventoSentry],
  ];
}

test('nenhum dado pessoal sobra no evento, nas duas cópias', async () => {
  for (const [nome, limpar] of await copias()) {
    const e = limpar(evento());
    const tudo = JSON.stringify(e);
    for (const vazado of [
      'joao.silva@gmail.com',
      'a@b.com',
      '123.456.789-09',
      '12345678909',
      '4111 1111 1111 1111',
      '1.234,56',
      '12.345.678/0001-95',
      'abc.def.ghi',
      '1.2.3.4',
    ]) {
      assert.ok(!tudo.includes(vazado), `${nome}: "${vazado}" vazou em ${tudo}`);
    }
    assert.equal(e.message, 'Falhou para [email]', nome);
    assert.match(e.exception.values[0].value, /\[cpf\].*\[cartao\]/, nome);
    assert.equal(e.extra.customer.cpfCnpj, '[removido]', nome);
    // JSON: o objeto da cópia do navegador nasce noutro contexto (outro Object).
    assert.equal(JSON.stringify(e.user), '{"id":"uid1"}', nome);
  }
});

test('o que não é dado pessoal continua útil para depurar', async () => {
  for (const [nome, limpar] of await copias()) {
    const e = limpar(evento());
    // Timestamp em milissegundos não é confundido com cartão.
    assert.match(e.breadcrumbs[0].message, /1700000000000/, nome);
    assert.equal(e.extra.customer.id, 'cus_1', nome);
    assert.equal(e.breadcrumbs[1].data.url, '/api/x', nome);
    assert.equal(e.exception.values[0].type, 'Error', nome);
  }
});

test('evento estranho não derruba a limpeza', async () => {
  for (const [nome, limpar] of await copias()) {
    assert.equal(limpar(null), null, nome);
    const circular = { a: 1 };
    circular.self = circular;
    assert.doesNotThrow(() => limpar({ extra: circular }), nome);
  }
});

test('as duas cópias têm a mesma lógica', () => {
  const corpo = (f) =>
    fs
      .readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/^[\s\S]*?const CHAVES_SENSIVEIS/, 'const CHAVES_SENSIVEIS')
      .replace(/export function/g, 'function')
      .replace(/\nmodule\.exports[^\n]*\n?/, '\n')
      .trim();
  assert.equal(corpo('web/appliquei-sentry-scrub.js'), corpo('api/_lib/sentry-scrub.js'));
});

test('as duas inicializações do Sentry usam a limpeza', () => {
  const web = fs.readFileSync(path.join(ROOT, 'web/appliquei-sentry-init.js'), 'utf8');
  assert.match(web, /return limparEventoSentry\(event\)/);
  const api = fs.readFileSync(path.join(ROOT, 'api/_lib/sentry.js'), 'utf8');
  assert.match(api, /beforeSend: \(event\) => limparEventoSentry\(event\)/);
});
