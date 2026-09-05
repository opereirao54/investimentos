'use strict';

// Regressão da causa raiz de "cadastrei no celular e não apareceu no PC"
// (DIAGNOSTICO-SYNC.md).
//
// O interceptador de localStorage.setItem em appliquei-utils.js é o ÚNICO
// gatilho do sync: sem ele, onLocalWrite nunca roda, nenhuma chave é marcada
// como suja e NADA é enviado — nunca.
//
// Ele era instalado com `localStorage.setItem = function(...)`. Storage é um
// legacy platform object com setter de propriedade nomeada: em navegadores que
// seguem o WebIDL à risca (Safari/iOS), atribuir uma propriedade que não é own
// property vai para o setter nomeado — grava um ITEM chamado "setItem" e NÃO
// sombreia o método do protótipo. Em Chrome sombreia e tudo funciona, o que
// escondeu o defeito por meses e fez cinco correções de sync mirarem no elo
// errado: todas consertavam o que vinha DEPOIS de um gatilho que nunca
// disparava no iPhone.
//
// Este teste roda com a semântica do Safari simulada. Com a atribuição na
// instância ele falha; com o patch no protótipo, passa.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'web/appliquei-utils.js'), 'utf8');

// Storage com a semântica do Safari: atribuir uma propriedade qualquer vira
// uma GRAVAÇÃO DE ITEM e não sombreia o método herdado.
function makeSafariStorage() {
  const store = new Map();
  const proto = {
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    getItem(k) {
      return store.has(String(k)) ? store.get(String(k)) : null;
    },
    removeItem(k) {
      store.delete(String(k));
    },
    clear() {
      store.clear();
    },
    key(i) {
      return Array.from(store.keys())[i] ?? null;
    },
  };
  const alvo = Object.create(proto);
  const proxy = new Proxy(alvo, {
    set(t, p, v) {
      if (typeof p === 'string') {
        store.set(p, String(v));
        return true; // aceita, mas NÃO sombreia — é o ponto do teste
      }
      return Reflect.set(t, p, v);
    },
    get(t, p, r) {
      if (p === 'length') return store.size;
      return Reflect.get(t, p, r);
    },
  });
  return { proxy, proto, store };
}

function carregarUtils() {
  const ls = makeSafariStorage();
  // sessionStorage compartilha o protótipo, como no browser real.
  const ss = Object.create(ls.proto);

  const avisos = { escritas: [], remocoes: [] };
  const elemento = { textContent: '', style: {}, classList: { add() {} } };

  const sandbox = {
    localStorage: ls.proxy,
    sessionStorage: ss,
    console: { log() {}, warn() {}, error() {} },
    Object,
    String,
    Number,
    Date,
    Math,
    JSON,
    Array,
    isNaN,
    parseFloat,
    parseInt,
    setTimeout,
    clearTimeout,
    document: {
      getElementById: () => elemento,
      querySelector: () => elemento,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => elemento,
      body: elemento,
    },
    AppliqueiCloudSync: {
      onLocalWrite: (k) => avisos.escritas.push(k),
      onLocalDelete: (k) => avisos.remocoes.push(k),
    },
  };
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.matchMedia = () => ({ matches: false, addEventListener() {} });
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'appliquei-utils.js' });

  return { sandbox, avisos, ls, ss };
}

test('escrita em chave do app avisa o sync mesmo com a semântica do Safari', () => {
  const { sandbox, avisos, ls } = carregarUtils();

  sandbox.localStorage.setItem('futurorico_transacoes', '[{"id":1}]');

  assert.deepEqual(
    avisos.escritas,
    ['futurorico_transacoes'],
    'onLocalWrite TEM de ser chamado — é o único gatilho do sync'
  );
  assert.equal(
    ls.store.get('futurorico_transacoes'),
    '[{"id":1}]',
    'e o dado tem de ficar realmente gravado'
  );
});

test('o interceptador não deixa lixo: nenhum item chamado "setItem"', () => {
  const { ls } = carregarUtils();
  // A impressão digital do bug: a atribuição virava uma gravação de dado.
  assert.equal(ls.store.get('setItem'), undefined);
  assert.equal(ls.store.get('removeItem'), undefined);
});

test('reescrever o MESMO valor não avisa o sync (short-circuit de migração)', () => {
  const { sandbox, avisos } = carregarUtils();

  sandbox.localStorage.setItem('futurorico_cartoes', '[]');
  assert.equal(avisos.escritas.length, 1);

  sandbox.localStorage.setItem('futurorico_cartoes', '[]');
  assert.equal(avisos.escritas.length, 1, 'valor idêntico não deve marcar como sujo');
});

test('chave fora do app é gravada normalmente', () => {
  const { sandbox, ls } = carregarUtils();
  sandbox.localStorage.setItem('outra_coisa', 'x');
  assert.equal(ls.store.get('outra_coisa'), 'x');
  // onLocalWrite é notificado para qualquer chave; quem decide o que de fato
  // sincroniza é shouldSyncKey() no cloud-sync. Comportamento preservado de
  // propósito: esta correção mudou ONDE o interceptador é instalado, não o que
  // ele notifica.
});

test('remoção de chave existente avisa o sync', () => {
  const { sandbox, avisos } = carregarUtils();
  sandbox.localStorage.setItem('appliquei_bens', '[1]');
  sandbox.localStorage.removeItem('appliquei_bens');
  assert.deepEqual(avisos.remocoes, ['appliquei_bens']);
});

test('sessionStorage compartilha o protótipo mas NÃO é interceptado', () => {
  const { sandbox, avisos, ss } = carregarUtils();
  ss.setItem('futurorico_transacoes', 'x');
  assert.deepEqual(
    avisos.escritas,
    [],
    'só o localStorage sincroniza; interceptar o sessionStorage geraria writes fantasma'
  );
});
