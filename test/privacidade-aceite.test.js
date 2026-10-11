'use strict';

// Aceite da Política de Privacidade (/api/user?op=privacidade e
// web/appliquei-privacidade.js).
//
// O registro do aceite é a PROVA do consentimento (LGPD, art. 8º, §2º). O que
// estes testes travam: o uid vem do token e a hora do servidor (nada do
// cliente), só a versão vigente é aceita, o primeiro aceite não é reescrito,
// e cliente e servidor falam da mesma versão. No cadastro, sem o aceite não
// há conta.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const AUTH_PATH = require.resolve('../api/_lib/auth');
const SENTRY_PATH = require.resolve('../api/_lib/sentry');
const ADMIN_PATH = require.resolve('../api/_lib/firebase-admin');
const RL_PATH = require.resolve('../api/_lib/rate-limit');

function stubModule(id, exports) {
  const m = new Module(id);
  m.exports = exports;
  m.loaded = true;
  m.filename = id;
  Module._cache[id] = m;
}

// Firestore de mentira: users/{uid}/consentimentos/{id}.
const docs = {};
const gravacoes = [];
function fakeDb() {
  return {
    collection(c1) {
      assert.equal(c1, 'users');
      return {
        doc(uid) {
          return {
            collection(c2) {
              assert.equal(c2, 'consentimentos');
              return {
                doc(id) {
                  const chave = uid + '/' + id;
                  return {
                    get: async () => ({ exists: !!docs[chave], data: () => docs[chave] }),
                    set: async (d) => {
                      gravacoes.push({ chave, d });
                      docs[chave] = Object.assign({}, d, {
                        aceitoEm: { toMillis: () => 1700000000000 },
                      });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

stubModule(ADMIN_PATH, {
  init: () => {},
  db: fakeDb,
  auth: () => ({}),
  fieldValue: () => ({ serverTimestamp: () => 'SERVER_TS' }),
  timestamp: () => ({ fromMillis: (n) => n }),
});
stubModule(RL_PATH, { check: async () => ({ allowed: true }), ipFrom: () => '127.0.0.1' });

let usuario = { uid: 'u1', email: 'a@b.c', email_verified: false };
stubModule(AUTH_PATH, {
  cors: () => false,
  requireUser: async (req, res) => {
    if (!usuario) {
      res.status(401).json({ error: 'missing_token' });
      return null;
    }
    return usuario;
  },
  requireVerifiedUser: async () => usuario,
  requireFreshVerifiedUser: async () => usuario,
});
stubModule(SENTRY_PATH, {
  captureError: () => {},
  captureMessage: () => {},
  ensureInit: () => null,
});

const endpoint = require('../api/user.js');
const VERSAO = endpoint.PRIVACIDADE_VERSAO;
const TERMOS = endpoint.TERMOS_VERSAO;

async function chamar(method, body) {
  const req = {
    method,
    body: body || {},
    query: { op: 'privacidade' },
    headers: { authorization: 'Bearer x' },
    socket: { remoteAddress: '127.0.0.1' },
    on(ev, cb) {
      if (ev === 'end') setImmediate(cb);
    },
  };
  const res = {
    statusCode: 200,
    body: null,
    headersSent: false,
    setHeader() {},
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(d) {
      this.body = d;
      this.headersSent = true;
      return this;
    },
    end() {
      this.headersSent = true;
      return this;
    },
  };
  await endpoint(req, res);
  return { status: res.statusCode, body: res.body };
}

function limpar() {
  Object.keys(docs).forEach((k) => delete docs[k]);
  gravacoes.length = 0;
  usuario = { uid: 'u1', email: 'a@b.c', email_verified: false };
}

test('sem aceite, GET diz que a versão vigente não foi aceita', async () => {
  limpar();
  const r = await chamar('GET');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    versao: VERSAO,
    aceito: false,
    aceitoEmMs: 0,
    termosVersao: TERMOS,
    termosAceito: false,
    termosAceitoEmMs: 0,
  });
});

test('POST grava o aceite com o uid do token e a hora do servidor', async () => {
  limpar();
  // O corpo tenta ditar uid e data: nada disso pode entrar.
  const r = await chamar('POST', { versao: VERSAO, origem: 'cadastro', uid: 'outro', aceitoEm: 1 });
  assert.equal(r.status, 201);
  assert.equal(gravacoes.length, 1);
  assert.equal(gravacoes[0].chave, 'u1/privacidade-' + VERSAO);
  assert.deepEqual(gravacoes[0].d, {
    uid: 'u1',
    versao: VERSAO,
    origem: 'cadastro',
    aceitoEm: 'SERVER_TS',
  });
  const g = await chamar('GET');
  assert.equal(g.body.aceito, true);
});

test('aceitar de novo não reescreve o primeiro aceite', async () => {
  limpar();
  await chamar('POST', { versao: VERSAO, origem: 'app' });
  const r = await chamar('POST', { versao: VERSAO, origem: 'app' });
  assert.equal(r.status, 200);
  assert.equal(gravacoes.length, 1);
});

test('versão diferente da vigente é recusada', async () => {
  limpar();
  const r = await chamar('POST', { versao: '2000-01-01', origem: 'app' });
  assert.equal(r.status, 409);
  assert.equal(r.body.versao, VERSAO);
  assert.equal(gravacoes.length, 0);
});

test('origem desconhecida vira "app"; sem login, 401', async () => {
  limpar();
  await chamar('POST', { versao: VERSAO, origem: 'qualquer' });
  assert.equal(gravacoes[0].d.origem, 'app');
  usuario = null;
  const r = await chamar('GET');
  assert.equal(r.status, 401);
});

test('cliente e servidor falam da mesma versão da política', () => {
  const cli = fs.readFileSync(path.join(ROOT, 'web/appliquei-privacidade.js'), 'utf8');
  const m = cli.match(/var PRIVACIDADE_VERSAO = '([^']+)'/);
  assert.ok(m, 'PRIVACIDADE_VERSAO no cliente');
  assert.equal(m[1], VERSAO);
});

test('o cadastro exige o aceite e o registra antes de criar a conta', () => {
  const gate = fs.readFileSync(path.join(ROOT, 'web/appliquei-auth-gate.js'), 'utf8');
  const fn = gate.slice(gate.indexOf('window.appliqueiAuthSubmit'));
  const iChk = fn.indexOf("$('authPrivAceite')");
  const iCria = fn.indexOf('createUserWithEmailAndPassword');
  assert.ok(iChk > -1 && iChk < iCria, 'o checkbox é conferido antes de criar a conta');
  assert.match(fn, /registrarAceitePrivacidade\('cadastro', email\)/);
  const html = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
  assert.match(html, /id="authPrivAceite"/);
  assert.match(html, /id="modalPrivacidade"/);
});

// ─── Termos de Uso: aceitos junto com a política ────────────────────────────

test('POST com os Termos grava os dois aceites, cada um com seu documento', async () => {
  limpar();
  const r = await chamar('POST', { versao: VERSAO, termosVersao: TERMOS, origem: 'cadastro' });
  assert.equal(r.status, 201);
  assert.deepEqual(
    gravacoes.map((g) => g.chave),
    ['u1/privacidade-' + VERSAO, 'u1/termos-' + TERMOS]
  );
  assert.deepEqual(gravacoes[1].d, {
    uid: 'u1',
    versao: TERMOS,
    origem: 'cadastro',
    aceitoEm: 'SERVER_TS',
  });
  const g = await chamar('GET');
  assert.equal(g.body.aceito, true);
  assert.equal(g.body.termosAceito, true);
});

test('quem aceitou só a política (antes dos Termos) aceita os Termos depois', async () => {
  limpar();
  // Cliente antigo: sem termosVersao, grava só a política.
  await chamar('POST', { versao: VERSAO, origem: 'app' });
  let g = await chamar('GET');
  assert.equal(g.body.aceito, true);
  assert.equal(g.body.termosAceito, false, 'o app novo abre a janela para os Termos');
  // Aceite novo: a política não é regravada, os Termos entram.
  const r = await chamar('POST', { versao: VERSAO, termosVersao: TERMOS, origem: 'app' });
  assert.equal(r.status, 201);
  assert.equal(gravacoes.length, 2);
  assert.equal(gravacoes[1].chave, 'u1/termos-' + TERMOS);
  g = await chamar('GET');
  assert.equal(g.body.termosAceito, true);
  // E repetir não reescreve nenhum dos dois.
  const deNovo = await chamar('POST', { versao: VERSAO, termosVersao: TERMOS, origem: 'app' });
  assert.equal(deNovo.status, 200);
  assert.equal(gravacoes.length, 2);
});

test('versão dos Termos diferente da vigente é recusada sem gravar nada', async () => {
  limpar();
  const r = await chamar('POST', { versao: VERSAO, termosVersao: '2000-01-01', origem: 'app' });
  assert.equal(r.status, 409);
  assert.equal(r.body.termosVersao, TERMOS);
  assert.equal(gravacoes.length, 0);
});

test('cliente e servidor falam da mesma versão dos Termos', () => {
  const termos = require('../web/appliquei-termos.js');
  assert.equal(termos.TERMOS_VERSAO, TERMOS);
});

test('o cliente só dá o aceite por válido com as duas versões', () => {
  const cli = fs.readFileSync(path.join(ROOT, 'web/appliquei-privacidade.js'), 'utf8');
  // Registro local carrega a versão dos Termos e a confere.
  assert.match(cli, /termos: _privTermosVersao\(\)/);
  assert.match(cli, /r\.termos !== _privTermosVersao\(\)/);
  // O POST manda as duas versões.
  assert.match(cli, /termosVersao: r\.termos/);
  // O servidor só vale com os dois aceitos.
  assert.match(cli, /j\.aceito && j\.termosAceito/);
  // Termos carregam antes da política, no app e na landing.
  for (const f of ['Appliquei_v13.0.html', 'landing.html']) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const iT = html.search(/<script src="\/?web\/appliquei-termos\.js/);
    const iP = html.search(/<script src="\/?web\/appliquei-privacidade\.js/);
    assert.ok(iT > -1 && iT < iP, f + ': appliquei-termos.js antes de appliquei-privacidade.js');
  }
});

test('o texto dos Termos cobre o que o usuário precisa saber antes de aceitar', () => {
  const { termosTextoHtml } = require('../web/appliquei-termos.js');
  const html = termosTextoHtml();
  for (const trecho of [
    'não é instituição financeira',
    'recomendação individualizada',
    '7 dias grátis',
    'R$ 15,00',
    'sem multa',
    'art. 49',
    'valor integral',
    'Applicash',
    'não pode ser sacado',
    'Programa de testadores',
    '1 (um) ano depois da data de lançamento',
    '50% de desconto',
    'perda de dados',
    'foro do seu domicílio',
  ]) {
    assert.ok(html.includes(trecho), 'falta nos Termos: ' + trecho);
  }
  // Sem dados do controlador, nada de lacuna no texto.
  assert.ok(!/CNPJ\s*[,.<]/.test(html), 'CNPJ vazio não pode aparecer');
  assert.ok(!html.includes('undefined'));
});

test('a política cita o Telegram e a IA (Gemini) que recebem dados', () => {
  const cli = fs.readFileSync(path.join(ROOT, 'web/appliquei-privacidade.js'), 'utf8');
  assert.match(cli, /Google Gemini/);
  assert.match(cli, /Telegram \(opcional\)/);
  assert.match(cli, /GitHub \(Microsoft\)/);
});
