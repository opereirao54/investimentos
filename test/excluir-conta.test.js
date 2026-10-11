'use strict';

// Exclusão da conta pelo próprio usuário (api/_lib/excluir-conta.js e a rota
// POST /api/user?op=excluir-conta).
//
// O que estas travas seguram:
//   - a ORDEM: Asaas falhou → nada é apagado (o cartão não pode continuar
//     cobrando uma conta que já não existe);
//   - o registro fiscal dos pagamentos fica, sem e-mail;
//   - o que é de OUTRA pessoa (crédito do indicador, convite) é anonimizado,
//     não apagado;
//   - tudo do usuário some: users/{uid}/**, sugestões, anexos, Telegram, login;
//   - repetir é seguro (idempotente);
//   - a rota exige a palavra EXCLUIR e um login recente.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const { excluirConta } = require('../api/_lib/excluir-conta');

// ─── Firestore de mentira, por caminho ──────────────────────────────────────

function criarDb() {
  const docs = new Map(); // caminho → dados

  function docRef(caminho) {
    return {
      path: caminho,
      id: caminho.split('/').pop(),
      get: async () => ({
        exists: docs.has(caminho),
        id: caminho.split('/').pop(),
        data: () => (docs.has(caminho) ? { ...docs.get(caminho) } : undefined),
      }),
      set: async (d, opt) => {
        docs.set(caminho, opt && opt.merge ? { ...(docs.get(caminho) || {}), ...d } : { ...d });
      },
      delete: async () => {
        docs.delete(caminho);
      },
      collection: (c) => colRef(caminho + '/' + c),
    };
  }

  function filhosDiretos(colPath) {
    const prof = colPath.split('/').length + 1;
    return [...docs.keys()].filter(
      (k) => k.startsWith(colPath + '/') && k.split('/').length === prof
    );
  }

  function colRef(colPath) {
    return {
      doc: (id) => docRef(colPath + '/' + id),
      where: (campo, op, valor) => ({
        get: async () => ({
          docs: filhosDiretos(colPath)
            .filter((k) => docs.get(k)[campo] === valor)
            .map((k) => ({
              id: k.split('/').pop(),
              ref: docRef(k),
              data: () => ({ ...docs.get(k) }),
            })),
        }),
      }),
      get: async () => ({
        docs: filhosDiretos(colPath).map((k) => ({
          id: k.split('/').pop(),
          ref: docRef(k),
          data: () => ({ ...docs.get(k) }),
        })),
      }),
    };
  }

  return {
    docs,
    db: {
      collection: (c) => colRef(c),
      recursiveDelete: async (ref) => {
        for (const k of [...docs.keys()]) {
          if (k === ref.path || k.startsWith(ref.path + '/')) docs.delete(k);
        }
      },
    },
  };
}

function semear(docs) {
  // Ana (a que exclui) foi indicada pelo Bia e usou um convite.
  docs.set('users/ana/data/main', { transacoes: [1, 2, 3] });
  docs.set('users/ana/billing/account', {
    uid: 'ana',
    email: 'ana@x.com',
    customerId: 'cus_ana',
    subscriptionId: 'sub_ana',
    lastOneShotPaymentId: 'pay_avulso',
    referredByUserId: 'bia',
    referralCode: 'APP-ANA111',
  });
  docs.set('users/ana/billing/account/credits/c1', { fromUid: 'zeca', amountCents: 150 });
  docs.set('users/ana/payments/pay_1', {
    id: 'pay_1',
    status: 'RECEIVED',
    value: 15,
    netValue: 14.01,
    billingType: 'PIX',
    dueDate: '2026-09-01',
    paymentDate: '2026-09-01',
    invoiceUrl: 'https://asaas/x',
  });
  docs.set('users/ana/consentimentos/privacidade-2026-10-11', { uid: 'ana' });
  docs.set('users/ana/integracoes/telegram', { chatId: 99 });
  docs.set('users/ana/telegramInbox/m1', { texto: 'mercado 50' });
  // O que é de outras pessoas.
  docs.set('users/bia/billing/account', { uid: 'bia', email: 'bia@x.com' });
  docs.set('users/bia/billing/account/credits/pay_1', {
    fromUid: 'ana',
    fromEmail: 'ana@x.com',
    amountCents: 150,
  });
  docs.set('users/bia/billing/account/credits/pay_9', { fromUid: 'caio', fromEmail: 'caio@x.com' });
  docs.set('convites/BETA-1', { status: 'usado', usadoPor: 'ana', usadoEmail: 'ana@x.com' });
  docs.set('convites/BETA-2', { status: 'usado', usadoPor: 'caio', usadoEmail: 'caio@x.com' });
  docs.set('referralCodes/APP-ANA111', { uid: 'ana' });
  // Fora da conta, mas da Ana.
  docs.set('feedback/f1', { uid: 'ana', texto: 'sugestão' });
  docs.set('feedback_anexos/f1', { dados: 'img' });
  docs.set('feedback/f2', { uid: 'caio', texto: 'outra' });
  docs.set('telegramLinks/99', { uid: 'ana' });
  docs.set('telegramCodigos/ABC', { uid: 'ana' });
  docs.set('telegramPendentes/desc_1', { uid: 'ana' });
  docs.set('telegramRelatorios/r1', { uid: 'ana' });
  docs.set('telegramRelatorios/r2', { uid: 'caio' });
}

function criarDeps(mundo, opts) {
  const o = opts || {};
  const chamadas = { asaas: [], authApagados: [], desvinculados: [] };
  const deps = {
    db: () => mundo.db,
    fieldValue: () => ({ serverTimestamp: () => 'SERVER_TS' }),
    auth: () => ({
      deleteUser: async (uid) => {
        if (o.authErro) throw o.authErro;
        chamadas.authApagados.push(uid);
      },
    }),
    asaas: {
      cancelSubscription: async (id) => {
        chamadas.asaas.push('cancel:' + id);
        if (o.cancelErro) throw o.cancelErro;
      },
      getPaymentLink: async (id) => {
        chamadas.asaas.push('get:' + id);
        return { id, status: o.statusAvulso || 'PENDING' };
      },
      call: async (metodo, caminho) => {
        chamadas.asaas.push(metodo + ':' + caminho);
      },
    },
    telegram: {
      desvincular: async (uid) => {
        chamadas.desvinculados.push(uid);
        // O real apaga o link do chat e o doc de integração.
        mundo.docs.delete('telegramLinks/99');
        mundo.docs.delete('users/' + uid + '/integracoes/telegram');
      },
    },
  };
  return { deps, chamadas };
}

function chavesDe(docs, prefixo) {
  return [...docs.keys()].filter((k) => k.startsWith(prefixo)).sort();
}

test('exclui tudo da conta, cancela no Asaas e guarda só o registro fiscal', async () => {
  const mundo = criarDb();
  semear(mundo.docs);
  const { deps, chamadas } = criarDeps(mundo);

  const r = await excluirConta('ana', deps);
  assert.equal(r.ok, true);

  // Asaas: assinatura cancelada e boleto avulso em aberto apagado.
  assert.deepEqual(chamadas.asaas, [
    'cancel:sub_ana',
    'get:pay_avulso',
    'DELETE:/payments/pay_avulso',
  ]);
  // Nada sobra em users/ana/**.
  assert.deepEqual(chavesDe(mundo.docs, 'users/ana'), []);
  // Sugestão, anexo e Telegram da Ana somem; os dos outros ficam.
  assert.ok(!mundo.docs.has('feedback/f1'));
  assert.ok(!mundo.docs.has('feedback_anexos/f1'));
  assert.ok(mundo.docs.has('feedback/f2'));
  assert.deepEqual(chavesDe(mundo.docs, 'telegram'), ['telegramRelatorios/r2']);
  assert.deepEqual(chamadas.desvinculados, ['ana']);
  // Login por último.
  assert.deepEqual(chamadas.authApagados, ['ana']);

  // Registro fiscal: pagamentos e cliente do Asaas, sem e-mail nem link.
  const fiscal = mundo.docs.get('contasExcluidas/ana');
  assert.equal(fiscal.customerId, 'cus_ana');
  assert.deepEqual(fiscal.pagamentos, [
    {
      id: 'pay_1',
      status: 'RECEIVED',
      value: 15,
      netValue: 14.01,
      billingType: 'PIX',
      dueDate: '2026-09-01',
      paymentDate: '2026-09-01',
    },
  ]);
  assert.ok(!JSON.stringify(fiscal).includes('ana@x.com'));
  assert.ok(!JSON.stringify(fiscal).includes('https://'));
});

test('o que é de outras pessoas é anonimizado, não apagado', async () => {
  const mundo = criarDb();
  semear(mundo.docs);
  const { deps } = criarDeps(mundo);
  await excluirConta('ana', deps);

  // O crédito que a Ana gerou para a Bia continua valendo, sem o e-mail.
  const cred = mundo.docs.get('users/bia/billing/account/credits/pay_1');
  assert.equal(cred.amountCents, 150);
  assert.equal(cred.fromEmail, null);
  assert.equal(cred.fromExcluida, true);
  // O crédito de outra pessoa não é tocado.
  assert.equal(mundo.docs.get('users/bia/billing/account/credits/pay_9').fromEmail, 'caio@x.com');
  // Convite: continua "usado" (não volta a valer), sem o e-mail.
  assert.equal(mundo.docs.get('convites/BETA-1').status, 'usado');
  assert.equal(mundo.docs.get('convites/BETA-1').usadoEmail, null);
  assert.equal(mundo.docs.get('convites/BETA-2').usadoEmail, 'caio@x.com');
  // O código de indicação fica reservado: não pode ir para outra pessoa.
  assert.ok(mundo.docs.has('referralCodes/APP-ANA111'));
});

test('Asaas falhou: nada é apagado', async () => {
  const mundo = criarDb();
  semear(mundo.docs);
  const antes = [...mundo.docs.keys()].sort();
  const { deps, chamadas } = criarDeps(mundo, {
    cancelErro: Object.assign(new Error('timeout'), { status: 500 }),
  });
  await assert.rejects(excluirConta('ana', deps), (e) => e.etapa === 'asaas' && e.status === 502);
  assert.deepEqual([...mundo.docs.keys()].sort(), antes);
  assert.deepEqual(chamadas.authApagados, []);
});

test('assinatura já cancelada no Asaas (404) não impede a exclusão', async () => {
  const mundo = criarDb();
  semear(mundo.docs);
  const { deps, chamadas } = criarDeps(mundo, {
    cancelErro: Object.assign(new Error('not found'), { status: 404 }),
  });
  const r = await excluirConta('ana', deps);
  assert.equal(r.ok, true);
  assert.deepEqual(chamadas.authApagados, ['ana']);
});

test('cobrança avulsa já paga não é apagada no Asaas', async () => {
  const mundo = criarDb();
  semear(mundo.docs);
  const { deps, chamadas } = criarDeps(mundo, { statusAvulso: 'RECEIVED' });
  await excluirConta('ana', deps);
  assert.ok(!chamadas.asaas.some((c) => c.startsWith('DELETE')));
});

test('repetir depois de uma exclusão completa é seguro', async () => {
  const mundo = criarDb();
  semear(mundo.docs);
  await excluirConta('ana', criarDeps(mundo).deps);
  // Segunda vez: sem billing, sem login (o Auth responde user-not-found).
  const { deps, chamadas } = criarDeps(mundo, {
    authErro: Object.assign(new Error('x'), { code: 'auth/user-not-found' }),
  });
  const r = await excluirConta('ana', deps);
  assert.equal(r.ok, true);
  assert.deepEqual(chamadas.asaas, [], 'sem assinatura, não chama o Asaas');
  // O registro fiscal da primeira vez não é perdido.
  assert.equal(mundo.docs.get('contasExcluidas/ana').customerId, 'cus_ana');
});

test('conta sem billing (nunca assinou) também é excluída', async () => {
  const mundo = criarDb();
  mundo.docs.set('users/novo/data/main', { transacoes: [] });
  const { deps, chamadas } = criarDeps(mundo);
  const r = await excluirConta('novo', deps);
  assert.equal(r.ok, true);
  assert.deepEqual(chavesDe(mundo.docs, 'users/novo'), []);
  assert.deepEqual(chamadas.asaas, []);
  assert.deepEqual(chamadas.authApagados, ['novo']);
});

// ─── A rota: confirmação e login recente ────────────────────────────────────

const AUTH_PATH = require.resolve('../api/_lib/auth');
const SENTRY_PATH = require.resolve('../api/_lib/sentry');
const ADMIN_PATH = require.resolve('../api/_lib/firebase-admin');
const RL_PATH = require.resolve('../api/_lib/rate-limit');
const EXCL_PATH = require.resolve('../api/_lib/excluir-conta');

function stubModule(id, exports) {
  const m = new Module(id);
  m.exports = exports;
  m.loaded = true;
  m.filename = id;
  Module._cache[id] = m;
}

let usuario = null;
let excluidos = [];
let falhaExclusao = null;
let invalidados = [];

function carregarRota() {
  stubModule(ADMIN_PATH, {
    init: () => {},
    db: () => ({}),
    auth: () => ({}),
    fieldValue: () => ({}),
    timestamp: () => ({}),
  });
  stubModule(RL_PATH, { check: async () => ({ allowed: true }), ipFrom: () => '127.0.0.1' });
  stubModule(AUTH_PATH, {
    cors: () => false,
    requireUser: async () => usuario,
    requireVerifiedUser: async () => usuario,
    requireFreshVerifiedUser: async () => usuario,
    invalidateUid: (uid) => invalidados.push(uid),
  });
  stubModule(SENTRY_PATH, {
    captureError: () => {},
    captureMessage: () => {},
    ensureInit: () => null,
  });
  stubModule(EXCL_PATH, {
    excluirConta: async (uid) => {
      if (falhaExclusao) throw falhaExclusao;
      excluidos.push(uid);
      return { ok: true, etapas: {}, avisos: [] };
    },
  });
  delete require.cache[require.resolve('../api/user.js')];
  return require('../api/user.js');
}

async function chamar(endpoint, body, method) {
  const req = {
    method: method || 'POST',
    body: body || {},
    query: { op: 'excluir-conta' },
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

const agoraS = () => Math.floor(Date.now() / 1000);

test('rota: sem a palavra EXCLUIR, recusa sem excluir', async () => {
  const endpoint = carregarRota();
  usuario = { uid: 'ana', auth_time: agoraS() };
  excluidos = [];
  const r = await chamar(endpoint, { confirmacao: 'sim' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'confirmacao_invalida');
  assert.deepEqual(excluidos, []);
});

test('rota: login antigo pede para confirmar a identidade de novo', async () => {
  const endpoint = carregarRota();
  usuario = { uid: 'ana', auth_time: agoraS() - 3600 };
  excluidos = [];
  const r = await chamar(endpoint, { confirmacao: 'EXCLUIR' });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'reautenticar');
  assert.deepEqual(excluidos, []);
});

test('rota: login recente + EXCLUIR exclui e invalida o cache do token', async () => {
  const endpoint = carregarRota();
  usuario = { uid: 'ana', auth_time: agoraS() - 30 };
  excluidos = [];
  invalidados = [];
  falhaExclusao = null;
  const r = await chamar(endpoint, { confirmacao: ' excluir ' });
  assert.equal(r.status, 200);
  assert.deepEqual(excluidos, ['ana']);
  assert.deepEqual(invalidados, ['ana']);
});

test('rota: falha no Asaas volta 502 com a etapa, para a tela explicar', async () => {
  const endpoint = carregarRota();
  usuario = { uid: 'ana', auth_time: agoraS() };
  falhaExclusao = Object.assign(new Error('asaas_cancel_failed'), { etapa: 'asaas', status: 502 });
  const r = await chamar(endpoint, { confirmacao: 'EXCLUIR' });
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: 'exclusao_falhou', etapa: 'asaas' });
  falhaExclusao = null;
});

test('rota: só POST', async () => {
  const endpoint = carregarRota();
  usuario = { uid: 'ana', auth_time: agoraS() };
  const r = await chamar(endpoint, {}, 'GET');
  assert.equal(r.status, 405);
});

// ─── A tela ─────────────────────────────────────────────────────────────────

test('tela: botão em Configurações, script carregado e identidade antes do pedido', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ROOT = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
  assert.match(html, /id="btnExcluirConta"[^>]*onclick="abrirModalExcluirConta\(\)"/);
  assert.match(html, /<script src="\/web\/appliquei-excluir-conta\.js/);

  const cli = fs.readFileSync(path.join(ROOT, 'web/appliquei-excluir-conta.js'), 'utf8');
  const fn = cli.slice(cli.indexOf('function executarExclusaoConta'));
  const iReauth = fn.indexOf('_exclReautenticar(u)');
  const iToken = fn.indexOf('getIdToken(true)');
  const iFetch = fn.indexOf("fetch('/api/user?op=excluir-conta'");
  assert.ok(
    iReauth > -1 && iReauth < iToken && iToken < iFetch,
    'reautentica, renova o token, depois pede'
  );
  // Depois de excluir: limpa o aparelho, sai e vai para a landing com o aviso.
  assert.match(fn, /_exclLimparAparelho\(\)/);
  assert.match(fn, /clearPersistence\(\)/);
  assert.match(fn, /location\.replace\('\/\?conta=excluida'\)/);
  const lp = fs.readFileSync(path.join(ROOT, 'landing.html'), 'utf8');
  assert.match(lp, /get\('conta'\) === 'excluida'/);
  // A política e as dúvidas apontam para o botão, não mais para um pedido manual.
  const priv = fs.readFileSync(path.join(ROOT, 'web/appliquei-privacidade.js'), 'utf8');
  assert.match(priv, /Excluir minha conta, em Configurações/);
});
