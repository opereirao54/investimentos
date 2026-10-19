'use strict';

// Primeiro acesso: o caminho da landing até o app, para quem acabou de chegar.
//
// Três tropeços que este arquivo segura:
//  1. "Começar grátis" abria em "Bem-vindo de volta" (modo Entrar): quem veio
//     começar tinha de achar a aba "Criar conta" sozinho.
//  2. A tela "confirme o seu e-mail" só seguia com o clique em "Já verifiquei".
//     Quem confirmava no celular e voltava ficava parado sem saber o que fazer.
//  3. Falha ao iniciar o login mostrava texto de desenvolvedor (F12, Firebase).

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const AUTH = fs.readFileSync(path.join(ROOT, 'web/appliquei-auth-gate.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const LANDING = fs.readFileSync(path.join(ROOT, 'landing.html'), 'utf8');

test('todo "Começar grátis" da landing abre direto em Criar conta', () => {
  const ctas = LANDING.match(/<a href="\/app[^"]*"[^>]*>[\s\S]*?<\/a>/g) || [];
  const comecar = ctas.filter((a) => /Começar grátis|Criar conta/.test(a));
  assert.ok(comecar.length >= 5, 'CTAs de cadastro não encontrados');
  for (const a of comecar) assert.match(a, /href="\/app\?modo=cadastro"/, a);
  // "Entrar" continua no login.
  const entrar = ctas.filter((a) => />\s*Entrar\s*</.test(a));
  assert.ok(entrar.length >= 1);
  for (const a of entrar) assert.match(a, /href="\/app"/);
});

test('o portão lê ?modo=cadastro ao abrir para quem não tem sessão', () => {
  assert.match(AUTH, /function modoInicialDoLink\(\)/);
  assert.match(AUTH, /get\('modo'\) === 'cadastro' \? 'registro' : 'login'/);
  assert.match(AUTH, /appliqueiAuthSetModo\(modoInicialDoLink\(\)\)/);
});

test('no cadastro, a dica do Google aparece; no login, não', () => {
  assert.match(HTML, /id="authDicaGoogle"[^>]*>Mais rápido: com o Google/);
  const setModo = AUTH.slice(AUTH.indexOf('window.appliqueiAuthSetModo = function'));
  assert.match(setModo, /dicaGoogle\.style\.display = login \? 'none' : ''/);
});

test('a tela de confirmação de e-mail segue sozinha quando a pessoa confirma', () => {
  assert.match(AUTH, /setInterval\(conferirVerificacaoSozinho, 5000\)/);
  assert.match(AUTH, /visibilitychange[\s\S]{0,200}conferirVerificacaoSozinho/);
  // A confirmação passa pelo mesmo caminho do botão, que renova o token
  // (o email_verified precisa chegar às regras do Firestore).
  const fn = AUTH.slice(AUTH.indexOf('function conferirVerificacaoSozinho'));
  assert.match(fn.slice(0, 900), /window\.appliqueiAuthVerifyCheck\(\)/);
  const hard = AUTH.slice(AUTH.indexOf("setCabecalho('Quase lá'"));
  assert.match(hard.slice(0, 300), /vigiarVerificacao\(\)/);
  assert.match(HTML, /Esta tela continua sozinha/);
});

test('"Abrir meu e-mail" só aparece para provedores conhecidos', () => {
  assert.match(HTML, /id="authVerifyAbrirEmail"/);
  assert.match(AUTH, /mail\.google\.com/);
  assert.match(AUTH, /outlook\.live\.com/);
  assert.match(AUTH, /a\.style\.display = url \? '' : 'none'/);
});

test('falha ao iniciar o login fala com quem usa o app, não com quem o mantém', () => {
  const i = HTML.indexOf('id="authGateNoConfig"');
  const painel = HTML.slice(i, HTML.indexOf('id="authGateForm"', i));
  assert.doesNotMatch(painel.replace(/<!--[\s\S]*?-->/g, ''), /F12|initializeApp|gstatic/);
  assert.match(painel, /Tentar de novo/);
});

test('o formulário fala a língua de quem está começando', () => {
  const ctrl = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba-controle-financeiro.js'), 'utf8');
  assert.doesNotMatch(ctrl, /'Valor Monetário/);
  assert.doesNotMatch(ctrl, /mostrarToast\(\s*'[^']*Classificação Contábil/);
  assert.match(ctrl, /'Data do recebimento'/);
  assert.match(HTML, /id="lblVencimentoControle"/);
});
