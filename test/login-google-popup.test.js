'use strict';

// Login Google: popup em todo aparelho, redirect só como último recurso.
//
// O celular usava signInWithRedirect. O redirect passa pelo authDomain
// (appliquei-prod.firebaseapp.com), que não é o domínio do app; com a
// partição de armazenamento dos navegadores atuais o resultado do login fica
// preso lá, getRedirectResult() volta vazio e quem já tem conta Google cai em
// loop na tela de login. Estas travas olham a fonte de appliquei-auth-gate.js
// porque o fluxo depende do SDK do Firebase, que não roda no Node.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'appliquei-auth-gate.js'), 'utf8');

function corpo(nome) {
  const start = SRC.indexOf('window.' + nome + ' = function');
  assert.notEqual(start, -1, nome + ' não encontrada');
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
  }
  throw new Error('chaves de ' + nome);
}

test('o botão do Google não escolhe redirect pelo tipo de aparelho', () => {
  const fn = corpo('appliqueiAuthGoogle');
  assert.doesNotMatch(fn, /isMobile/, 'celular não pode cair direto no redirect');
  assert.match(fn, /signInWithPopup\(provider\)/);
});

test('redirect só depois de o navegador recusar o popup', () => {
  const fn = corpo('appliqueiAuthGoogle');
  const popup = fn.indexOf('signInWithPopup(provider)');
  const recusa = fn.indexOf("'auth/popup-blocked'");
  const redirect = fn.indexOf('signInWithRedirect(provider)');
  assert.ok(popup > -1 && recusa > -1 && redirect > -1);
  assert.ok(popup < redirect && recusa < redirect, 'redirect é o plano B, não o A');
  assert.match(fn, /GOOGLE_REDIRECT_FLAG/, 'marca a saída para o Google');
});

test('volta do Google sem resultado vira aviso, não tela de login muda', () => {
  assert.match(SRC, /consumirFlagRedirectGoogle\(\)/);
  assert.match(SRC, /O navegador não devolveu o login do Google/);
  // O timer de "sem sessão" chama setModo('login'), que limpa o erro: o
  // aviso tem de ser reaplicado depois dele.
  const timer = SRC.indexOf("window.appliqueiAuthSetModo('login');\n      if (avisoLoginPendente)");
  assert.notEqual(timer, -1, 'aviso reaplicado depois do setModo do timer');
});
