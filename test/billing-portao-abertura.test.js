'use strict';

// Portão de assinatura na ABERTURA do app.
//
// O defeito: a cada abertura o auth-gate liga setSignupBlock(true) enquanto
// confere getRedirectResult(). Quando a sessão do Firebase restaurava nesse
// meio-tempo, onUser desistia (signupBlocked) e, ao soltar o bloqueio,
// ninguém o chamava de novo. A conta sem assinatura abria o app sem portão,
// lançava, o servidor recusava a gravação e tudo sumia ao reabrir — até
// clicar em "Minha assinatura", que era o único caminho que verificava.
//
// Extrai as funções REAIS de web/appliquei-billing.js (como em
// billing-report-swallowed.test.js) e simula a ordem dos eventos.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'appliquei-billing.js'), 'utf8');

function extract(name) {
  const start = SRC.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' não encontrada');
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1) + ';';
  }
  throw new Error('chaves de ' + name);
}

function mundo() {
  const chamadas = { init: 0 };
  const sandbox = {
    window: { AppliqueiFirebase: { auth: { currentUser: null } } },
    document: { getElementById: () => null },
    lastAccess: null,
    hideGate() {},
    ensureTrialBanner() {},
    ensureVerifyBanner() {},
    stopPolling() {},
    syncApplicashFromServer: () => Promise.resolve(),
    initBilling() {
      chamadas.init++;
      return Promise.resolve();
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var signupBlocked = false; var deferredUser = null;', ctx);
  vm.runInContext(extract('setSignupBlock'), ctx);
  vm.runInContext(extract('onUser'), ctx);
  return { ctx, chamadas, auth: sandbox.window.AppliqueiFirebase.auth };
}

const ANA = { uid: 'ana' };

test('sessão restaurada durante o bloqueio: a verificação é retomada ao soltar', () => {
  const { ctx, chamadas, auth } = mundo();
  ctx.setSignupBlock(true); // auth-gate começa a conferir getRedirectResult
  auth.currentUser = ANA;
  ctx.onUser(ANA); // Firebase restaurou a sessão no meio-tempo
  assert.equal(chamadas.init, 0, 'durante o bloqueio não verifica');
  ctx.setSignupBlock(false); // getRedirectResult: sem login pendente
  assert.equal(chamadas.init, 1, 'ao soltar, verifica a assinatura — e o portão pode aparecer');
});

test('cadastro Google recusado: deslogou antes de soltar → nada de billing', () => {
  const { ctx, chamadas, auth } = mundo();
  ctx.setSignupBlock(true);
  auth.currentUser = ANA;
  ctx.onUser(ANA);
  auth.currentUser = null; // auth-gate fez signOut da conta recusada
  ctx.setSignupBlock(false);
  assert.equal(chamadas.init, 0);
});

test('sem corrida: verifica uma vez só, e soltar o bloqueio depois não repete', () => {
  const { ctx, chamadas, auth } = mundo();
  auth.currentUser = ANA;
  ctx.onUser(ANA);
  ctx.setSignupBlock(true);
  ctx.setSignupBlock(false);
  assert.equal(chamadas.init, 1);
});
