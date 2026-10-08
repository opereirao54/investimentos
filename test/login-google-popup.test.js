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

// Conta Google nova na aba "Entrar": antes o app apagava a conta e mandava
// para "Criar conta" (só por causa do cupom e do aceite). Agora confirma na
// mesma tela, com o billing segurado até a confirmação.
test('conta Google nova pede confirmação na mesma tela, sem apagar a conta', () => {
  const start = SRC.indexOf('function handleGoogleAuthResult');
  const fn = SRC.slice(start, SRC.indexOf('window.appliqueiAuthGoogle = function'));
  assert.match(fn, /pedirConfirmacaoGoogle\(/);
  assert.doesNotMatch(fn, /\.delete\(\)/, 'a conta nova não é mais apagada de cara');
  assert.doesNotMatch(fn, /appliqueiAuthSetModo\('registro'\)/, 'nada de mandar para a outra aba');
});

test('o painel de confirmação traz cupom e aceite da Política', () => {
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'Appliquei_v13.0.html'), 'utf8');
  const i = HTML.indexOf('id="authGateGoogle"');
  assert.notEqual(i, -1);
  const painel = HTML.slice(i, HTML.indexOf('Usar outra conta Google', i) + 40);
  assert.match(painel, /id="authGoogleCupom"/);
  assert.match(painel, /id="authGooglePrivAceite"/);
  assert.match(painel, /appliqueiAuthGoogleConfirmar\(\)/);
  assert.match(painel, /appliqueiAuthGoogleOutraConta\(\)/);
});

test('confirmar só solta o billing depois do aceite e de um cupom válido', () => {
  const fn = corpo('appliqueiAuthGoogleConfirmar');
  const aceite = fn.indexOf('authGooglePrivAceite');
  const formato = fn.indexOf('APP-[A-Z0-9]{6}');
  const solta = fn.indexOf(
    'appliqueiSetSignupBlock(false)',
    fn.indexOf('registrarAceitePrivacidade')
  );
  assert.ok(aceite > -1 && formato > -1 && solta > -1);
  assert.ok(aceite < solta && formato < solta);
  assert.match(fn, /appliquei_pending_referral/, 'o cupom vai para o /init');
});

test('a pendência de confirmação não sobe para a nuvem nem some na troca de conta', () => {
  const SYNC = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'appliquei-cloud-sync.js'),
    'utf8'
  );
  const s = SYNC.indexOf('function shouldSyncKey');
  const fn = SYNC.slice(s, SYNC.indexOf('\n}\n', s) + 2);
  const shouldSyncKey = new Function(fn + '; return shouldSyncKey;')();
  assert.equal(shouldSyncKey('appliquei_auth_google_confirmar'), false);
  assert.equal(shouldSyncKey('appliquei_auth_guest'), false);
  assert.equal(
    shouldSyncKey('appliquei_transacoes'),
    true,
    'dado do usuário continua sincronizando'
  );
  assert.match(SRC, /GOOGLE_CONFIRMAR_KEY = 'appliquei_auth_google_confirmar'/);
});
