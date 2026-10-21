'use strict';

// Admin: "Quem está usando" (api/_lib/uso-testadores.js) e "Excluir cadastro"
// (action delete_user em api/admin/action.js).
//
// O que estas travas seguram:
//   - a lista lê SÓ datas: o Firestore é consultado com fieldMask
//     ['updatedAt', 'keyRevs'], e nenhum conteúdo de dado sai na resposta;
//   - preferências de tela não contam como uso; Telegram conta;
//   - situação: ativo até 3 dias, esfriando até 14, parado depois ou nunca;
//   - excluir exige o e-mail digitado de novo; sem ele nada é apagado;
//   - excluir usa a mesma exclusão da LGPD e invalida o cache do token.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const { listarUso, resumirUso, situacaoDoUso } = require('../api/_lib/uso-testadores');

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 9, 21, 12, 0, 0);

// ─── Firestore de mentira, com getAll e registro das máscaras pedidas ───────

function criarMundo(docs) {
  const mascaras = [];
  function docRef(caminho) {
    return {
      path: caminho,
      collection: (c) => colRef(caminho + '/' + c),
    };
  }
  function colRef(colPath) {
    return {
      doc: (id) => docRef(colPath + '/' + id),
      where: (campo, op, valor) => ({
        get: async () => ({
          docs: Object.keys(docs)
            .filter(
              (k) =>
                k.startsWith(colPath + '/') &&
                k.split('/').length === colPath.split('/').length + 1 &&
                docs[k][campo] === valor
            )
            .map((k) => ({ id: k.split('/').pop(), data: () => ({ ...docs[k] }) })),
        }),
      }),
    };
  }
  const D = {
    collection: (c) => colRef(c),
    getAll: async (...args) => {
      const opt = args[args.length - 1];
      const refs = opt && opt.fieldMask ? args.slice(0, -1) : args;
      mascaras.push(opt && opt.fieldMask ? opt.fieldMask.slice() : null);
      return refs.map((r) => {
        const d = docs[r.path];
        if (!d) return { exists: false, data: () => undefined };
        const vis = {};
        (opt && opt.fieldMask ? opt.fieldMask : Object.keys(d)).forEach((f) => {
          if (f in d) vis[f] = d[f];
        });
        return { exists: true, data: () => vis };
      });
    },
  };
  return { D, mascaras };
}

function usuario(uid, email, extra) {
  return Object.assign(
    {
      uid,
      email,
      disabled: false,
      metadata: {
        creationTime: new Date(AGORA - 20 * DIA).toUTCString(),
        lastSignInTime: new Date(AGORA - 19 * DIA).toUTCString(),
      },
    },
    extra || {}
  );
}

function deps(mundo, usuarios) {
  return { db: () => mundo.D, auth: () => ({ listUsers: async () => ({ users: usuarios }) }) };
}

test('situação: ativo até 3 dias, esfriando até 14, parado depois ou nunca', () => {
  assert.equal(situacaoDoUso(AGORA - 2 * DIA, AGORA), 'ativo');
  assert.equal(situacaoDoUso(AGORA - 9 * DIA, AGORA), 'esfriando');
  assert.equal(situacaoDoUso(AGORA - 20 * DIA, AGORA), 'parado');
  assert.equal(situacaoDoUso(0, AGORA), 'parado');
});

test('preferências de tela não contam como uso', () => {
  const r = resumirUso({
    appliquei_tema: AGORA,
    appliquei_mob_seg_controle: AGORA,
    futurorico_transacoes: AGORA - 5 * DIA,
  });
  assert.deepEqual(r.areas, ['Lançamentos']);
  assert.equal(r.ultimoUsoMs, AGORA - 5 * DIA);
});

test('a lista lê só datas e marca testador, áreas, Telegram e situação', async () => {
  const docs = {
    'convites/BETA-1': {
      codigo: 'BETA-1',
      status: 'usado',
      usadoPor: 'ana',
      nota: 'Ana – trabalho',
    },
    'convites/BETA-2': { codigo: 'BETA-2', status: 'livre' },
    'users/ana/data/main': {
      updatedAt: AGORA - DIA,
      keyRevs: { futurorico_transacoes: AGORA - DIA, futurorico_cartoes: AGORA - 3 * DIA },
      keys: { futurorico_transacoes: '[{"descricao":"Mercado","valor":52.9}]' },
    },
    'users/ana/integracoes/telegram': { chatId: 99, aprendidas: { mercado: 'alimentacao' } },
    'users/joao/data/main': {
      updatedAt: AGORA - 9 * DIA,
      keyRevs: { appliquei_contas: AGORA - 9 * DIA },
      keys: { appliquei_contas: '[{"nome":"Nubank","saldoInicial":5000}]' },
    },
  };
  const mundo = criarMundo(docs);
  const r = await listarUso(
    deps(mundo, [
      usuario('ana', 'ana@x.com'),
      usuario('joao', 'joao@x.com'),
      usuario('caio', 'caio@x.com'),
    ]),
    AGORA
  );

  // Nenhuma leitura pediu o documento inteiro.
  assert.ok(mundo.mascaras.length > 0);
  mundo.mascaras.forEach((m) => {
    assert.ok(Array.isArray(m), 'toda leitura usa fieldMask');
    assert.ok(!m.includes('keys'), 'o conteúdo dos dados nunca é pedido');
  });
  // E nada do conteúdo vaza na resposta.
  const json = JSON.stringify(r);
  assert.doesNotMatch(json, /Mercado|Nubank|52\.9|5000|alimentacao/);

  const porUid = Object.fromEntries(r.itens.map((i) => [i.uid, i]));
  assert.equal(porUid.ana.testador, true);
  assert.equal(porUid.ana.nota, 'Ana – trabalho');
  assert.deepEqual(porUid.ana.areas, ['Lançamentos', 'Cartões', 'Telegram']);
  assert.equal(porUid.ana.situacao, 'ativo');
  assert.equal(porUid.joao.testador, false);
  assert.equal(porUid.joao.situacao, 'esfriando');
  assert.equal(porUid.caio.situacao, 'parado');
  assert.deepEqual(porUid.caio.areas, []);
  // Ordem: quem usou mais recentemente primeiro.
  assert.deepEqual(
    r.itens.map((i) => i.uid),
    ['ana', 'joao', 'caio']
  );
});

// ─── A ação delete_user no endpoint do admin ────────────────────────────────

const P = {
  admin: require.resolve('../api/_lib/firebase-admin'),
  auth: require.resolve('../api/_lib/auth'),
  sentry: require.resolve('../api/_lib/sentry'),
  excl: require.resolve('../api/_lib/excluir-conta'),
  tg: require.resolve('../api/_lib/telegram-bot'),
  asaas: require.resolve('../api/_lib/asaas'),
};

function stub(id, exports) {
  const m = new Module(id);
  m.exports = exports;
  m.loaded = true;
  m.filename = id;
  Module._cache[id] = m;
}

let excluidos = [];
let invalidados = [];
let auditoria = [];

function carregarAction() {
  stub(P.admin, {
    init: () => {},
    db: () => {
      const doc = () => ({ get: async () => ({ exists: false }), collection: () => col });
      const col = { add: async (d) => auditoria.push(d), doc };
      return { collection: () => col };
    },
    auth: () => ({
      getUserByEmail: async (e) => ({ uid: 'u_' + e.split('@')[0], email: e }),
      getUser: async (uid) => ({ uid, email: uid + '@x.com' }),
    }),
    fieldValue: () => ({}),
    timestamp: () => ({ now: () => 0 }),
  });
  stub(P.auth, {
    cors: () => false,
    requireUser: async () => null,
    invalidateUid: (uid) => invalidados.push(uid),
  });
  stub(P.sentry, { captureError: () => {}, captureMessage: () => {}, ensureInit: () => null });
  stub(P.excl, {
    excluirConta: async (uid) => {
      excluidos.push(uid);
      return { ok: true, etapas: { dadosApagados: true }, avisos: [] };
    },
  });
  stub(P.tg, {});
  stub(P.asaas, {});
  delete require.cache[require.resolve('../api/admin/action.js')];
  return require('../api/admin/action.js');
}

async function chamar(endpoint, body) {
  process.env.ADMIN_API_TOKEN = 'tok_teste';
  const req = {
    method: 'POST',
    body,
    query: {},
    headers: { authorization: 'Bearer tok_teste' },
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

test('excluir sem digitar o e-mail de novo não apaga nada', async () => {
  const ep = carregarAction();
  excluidos = [];
  for (const v of [undefined, '', 'sim', 'outra@x.com']) {
    const r = await chamar(ep, { action: 'delete_user', email: 'ana@x.com', actionValue: v });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'confirmacao_invalida');
  }
  assert.deepEqual(excluidos, []);
});

test('excluir com o e-mail confirmado usa a exclusão da LGPD e registra no audit', async () => {
  const ep = carregarAction();
  excluidos = [];
  invalidados = [];
  auditoria = [];
  const r = await chamar(ep, {
    action: 'delete_user',
    email: 'ana@x.com',
    actionValue: ' ANA@x.com ',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.deepEqual(excluidos, ['u_ana']);
  assert.deepEqual(invalidados, ['u_ana']);
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].action, 'delete_user');
  assert.equal(auditoria[0].uid, 'u_ana');
});
