'use strict';

// "Recomeçar do zero" (Configurações) — apaga os dados do usuário e devolve a
// Appliquei ao primeiro uso.
//
// Dois pontos são fáceis de quebrar sem ninguém perceber, e os dois custam
// caro:
//
//  1. A PARTIÇÃO de chaves. É blocklist: tudo em futurorico_*/appliquei_* some,
//     exceto identidade, indicações, preferências de UI e os metadados do sync.
//     Apagar de menos deixa lixo; apagar `appliquei_cloud_deletions` (os
//     tombstones) faz o pull seguinte RESSUSCITAR tudo o que acabou de sumir.
//
//  2. A PROPAGAÇÃO. A deleção precisa passar pelo interceptador de
//     `removeItem` de appliquei-utils.js para virar tombstone no cloud-sync.
//     Um `localStorage.clear()` (ou qualquer atalho que fuja do interceptador)
//     limpa só este aparelho — e o Firestore devolve os dados no próximo boot.
//     Por isso o localStorage falso aqui tem os métodos no PROTÓTIPO, como o
//     Storage real: é onde o interceptador se instala.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

function makeDeadNode() {
  return {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    appendChild() {},
    removeChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => makeDeadNode(),
    querySelectorAll: () => [],
    focus() {},
    innerHTML: '',
    textContent: '',
    value: '',
  };
}

// Storage com os métodos no protótipo (como o Storage do browser) — é isso que
// dá ao interceptador de appliquei-utils.js um lugar por onde passar.
function makeProtoStorage() {
  const store = new Map();
  const proto = {
    getItem(k) {
      return store.has(String(k)) ? store.get(String(k)) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
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
  const ls = Object.create(proto);
  Object.defineProperty(ls, 'length', { get: () => store.size });
  return ls;
}

function carregarUtils(dadosIniciais) {
  const localStorageFake = makeProtoStorage();
  Object.keys(dadosIniciais || {}).forEach((k) => localStorageFake.setItem(k, dadosIniciais[k]));

  const timers = [];
  const deletadasNoSync = [];
  const flushes = [];
  const elementos = {};
  const recarregou = [];

  const win = {
    location: {
      hostname: 'localhost',
      reload() {
        recarregou.push(Date.now());
      },
    },
    navigator: { userAgent: 'node-test' },
    document: {
      readyState: 'complete',
      body: makeDeadNode(),
      getElementById: (id) => elementos[id] || makeDeadNode(),
      querySelector: () => makeDeadNode(),
      querySelectorAll: () => [],
      createElement: () => makeDeadNode(),
      addEventListener() {},
    },
    localStorage: localStorageFake,
    matchMedia: () => ({ matches: false }),
    // setTimeout controlado: nada roda sozinho, e o teste consegue afirmar
    // que o reload foi agendado.
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout() {},
    AppliqueiCloudSync: {
      onLocalWrite() {},
      onLocalDelete(key) {
        deletadasNoSync.push(key);
      },
      forceFlush() {
        flushes.push('forceFlush');
      },
      beaconNow() {
        flushes.push('beaconNow');
      },
    },
    console: { log() {}, warn() {}, error() {} },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: class Blob {},
    FileReader: class FileReader {},
    addEventListener() {},
    removeEventListener() {},
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;

  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/appliquei-utils.js'), 'utf8'), ctx, {
    filename: 'web/appliquei-utils.js',
  });

  return {
    win,
    localStorage: localStorageFake,
    timers,
    deletadasNoSync,
    flushes,
    elementos,
    recarregou,
  };
}

// Um localStorage povoado como o de quem já usa o app: dados do usuário +
// identidade + metadados de sync + preferências + chave de outro domínio.
function dadosDeUsuarioReal() {
  return {
    // --- anotações do usuário: devem sumir ---
    futurorico_transacoes: JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]),
    futurorico_compras: JSON.stringify([{ ticker: 'BTLG11' }]),
    futurorico_cartoes: JSON.stringify([{ id: 'card_padrao' }]),
    futurorico_categoriasDespesa: JSON.stringify(['Pets']),
    futurorico_metaVerde: '3000',
    futurorico_metaVermelha: '1000',
    futurorico_limiteCartao: '5000',
    futurorico_saldoCarregado: JSON.stringify({}),
    futurorico_carteira_snapshots: JSON.stringify([]),
    futurorico_carteira_admin: JSON.stringify({ mesAno: 'Mai/2026' }),
    appliquei_contas: JSON.stringify([{ id: 'c1' }, { id: 'c2' }]),
    appliquei_contas_seed_v1: '1',
    appliquei_bens: JSON.stringify([{ id: 'b1' }]),
    appliquei_sonhos: JSON.stringify([{ id: 's1' }, { id: 's2' }]),
    appliquei_jornada_progresso: JSON.stringify({ modulo: 3 }),
    appliquei_carteira_v2: JSON.stringify({ versao: 2 }),
    appliquei_carteira_extras: JSON.stringify([]),
    appliquei_cart_estado: JSON.stringify({ perfil: 'Moderado' }),
    // --- conta, indicações e preferências: devem ficar ---
    appliquei_auth_guest: '1',
    appliquei_user_id: 'ABC123',
    appliquei_cupom_codigo: 'APP-ABC123',
    appliquei_applicash_indicacoes: JSON.stringify([{ nome: 'Fulano' }]),
    appliquei_applicash_assinatura: JSON.stringify({ plano: 'Mensal' }),
    appliquei_applicash_creditos: '90',
    appliquei_applicash_resumo: JSON.stringify({}),
    appliquei_email_verify_snooze: '1',
    appliquei_valores_ocultos: '1',
    appliquei_sidebar_collapsed: '1',
    // --- metadados do sync e caches globais: devem ficar ---
    appliquei_cloud_key_revs: JSON.stringify({ futurorico_transacoes: 1 }),
    appliquei_cloud_deletions: JSON.stringify({}),
    appliquei_cloud_last_uid: 'uid-1',
    appliquei_cloud_carteira_modelo: JSON.stringify({ alocacoes: {} }),
    // --- fora do namespace do app: nem é olhada ---
    adminTheme: 'dark',
  };
}

const CHAVES_QUE_SOBREVIVEM = [
  'appliquei_auth_guest',
  'appliquei_user_id',
  'appliquei_cupom_codigo',
  'appliquei_applicash_indicacoes',
  'appliquei_applicash_assinatura',
  'appliquei_applicash_creditos',
  'appliquei_applicash_resumo',
  'appliquei_email_verify_snooze',
  'appliquei_valores_ocultos',
  'appliquei_sidebar_collapsed',
  'appliquei_cloud_key_revs',
  'appliquei_cloud_deletions',
  'appliquei_cloud_last_uid',
  'appliquei_cloud_carteira_modelo',
  'adminTheme',
];

const CHAVES_QUE_SOMEM = [
  'futurorico_transacoes',
  'futurorico_compras',
  'futurorico_cartoes',
  'futurorico_categoriasDespesa',
  'futurorico_metaVerde',
  'futurorico_metaVermelha',
  'futurorico_limiteCartao',
  'futurorico_saldoCarregado',
  'futurorico_carteira_snapshots',
  'futurorico_carteira_admin',
  'appliquei_contas',
  'appliquei_contas_seed_v1',
  'appliquei_bens',
  'appliquei_sonhos',
  'appliquei_jornada_progresso',
  'appliquei_carteira_v2',
  'appliquei_carteira_extras',
  'appliquei_cart_estado',
];

// Modal de confirmação já preenchido com a palavra certa (ou com outra coisa).
function montarModal(env, textoDigitado) {
  env.elementos.inputConfirmaRecomecar = Object.assign(makeDeadNode(), {
    value: textoDigitado,
  });
  env.elementos.btnConfirmaRecomecar = makeDeadNode();
  env.elementos.modalConfirmacao = makeDeadNode();
  env.elementos.modalTitulo = makeDeadNode();
  env.elementos.modalMensagem = makeDeadNode();
  env.elementos.modalAcoes = makeDeadNode();
  env.elementos['toast-container'] = makeDeadNode();
}

test('listarChavesDoUsuario: separa anotações de conta/preferências/metadados', () => {
  const env = carregarUtils(dadosDeUsuarioReal());
  const chaves = env.win.listarChavesDoUsuario();

  for (const k of CHAVES_QUE_SOMEM) {
    assert.ok(chaves.includes(k), `${k} deveria entrar no reset`);
  }
  for (const k of CHAVES_QUE_SOBREVIVEM) {
    assert.ok(!chaves.includes(k), `${k} NÃO deveria entrar no reset`);
  }
  assert.equal(chaves.length, CHAVES_QUE_SOMEM.length);
});

test('resumoDadosParaApagar: conta o que o usuário vai perder', () => {
  const env = carregarUtils(dadosDeUsuarioReal());
  assert.deepEqual(JSON.parse(JSON.stringify(env.win.resumoDadosParaApagar())), {
    lancamentos: 3,
    investimentos: 1,
    contas: 2,
    cartoes: 1,
    bens: 1,
    sonhos: 2,
  });
});

test('validarConfirmacaoRecomecar: aceita com/sem acento e caixa, recusa o resto', () => {
  const env = carregarUtils({});
  montarModal(env, '');
  const input = env.elementos.inputConfirmaRecomecar;

  for (const ok of ['RECOMECAR', 'recomecar', ' Recomeçar ', 'RECOMEÇAR']) {
    input.value = ok;
    assert.equal(env.win.validarConfirmacaoRecomecar(), true, `deveria aceitar "${ok}"`);
  }
  for (const nao of ['', 'recomeca', 'apagar', 'RECOMECAR TUDO']) {
    input.value = nao;
    assert.equal(env.win.validarConfirmacaoRecomecar(), false, `deveria recusar "${nao}"`);
  }
  assert.equal(env.elementos.btnConfirmaRecomecar.disabled, true);
});

test('executarRecomecarDoZero: sem a palavra digitada, não apaga nada', () => {
  const env = carregarUtils(dadosDeUsuarioReal());
  montarModal(env, 'quero apagar');

  assert.equal(env.win.executarRecomecarDoZero(), 0);
  assert.equal(
    env.localStorage.getItem('futurorico_transacoes'),
    JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }])
  );
  assert.deepEqual(env.deletadasNoSync, []);
  assert.deepEqual(env.flushes, []);
});

test('executarRecomecarDoZero: apaga as anotações e preserva conta/sync', () => {
  const env = carregarUtils(dadosDeUsuarioReal());
  montarModal(env, 'RECOMECAR');

  assert.equal(env.win.executarRecomecarDoZero(), CHAVES_QUE_SOMEM.length);

  for (const k of CHAVES_QUE_SOMEM) {
    assert.equal(env.localStorage.getItem(k), null, `${k} deveria ter sido apagada`);
  }
  for (const k of CHAVES_QUE_SOBREVIVEM) {
    assert.notEqual(env.localStorage.getItem(k), null, `${k} NÃO deveria ter sido apagada`);
  }
});

test('executarRecomecarDoZero: cada deleção vira tombstone no cloud-sync', () => {
  const env = carregarUtils(dadosDeUsuarioReal());
  montarModal(env, 'RECOMECAR');
  env.win.executarRecomecarDoZero();

  // Sem isto a limpeza fica só neste aparelho e o próximo pull traz tudo de
  // volta — o modo de falha que o botão existe para não ter.
  assert.deepEqual(env.deletadasNoSync.slice().sort(), CHAVES_QUE_SOMEM.slice().sort());
  // E o push sai na hora pelos dois caminhos (SDK + beacon).
  assert.ok(env.flushes.includes('forceFlush'));
  assert.ok(env.flushes.includes('beaconNow'));
});

test('executarRecomecarDoZero: recarrega a página para zerar o estado em memória', () => {
  const env = carregarUtils(dadosDeUsuarioReal());
  montarModal(env, 'RECOMECAR');
  env.win.executarRecomecarDoZero();

  const reload = env.timers.find((t) => t.ms === 1500);
  assert.ok(reload, 'deveria agendar o reload');
  assert.equal(env.recarregou.length, 0, 'não recarrega antes do timer');
  reload.fn();
  assert.equal(env.recarregou.length, 1);
});

test('executarRecomecarDoZero: sem cloud-sync (deslogado) apaga local sem quebrar', () => {
  const env = carregarUtils(dadosDeUsuarioReal());
  env.win.AppliqueiCloudSync = undefined;
  montarModal(env, 'RECOMECAR');

  assert.equal(env.win.executarRecomecarDoZero(), CHAVES_QUE_SOMEM.length);
  assert.equal(env.localStorage.getItem('futurorico_transacoes'), null);
  assert.equal(env.localStorage.getItem('appliquei_user_id'), 'ABC123');
});

test('executarRecomecarDoZero: é idempotente — rodar de novo não quebra', () => {
  const env = carregarUtils(dadosDeUsuarioReal());
  montarModal(env, 'RECOMECAR');
  env.win.executarRecomecarDoZero();
  assert.equal(env.win.executarRecomecarDoZero(), 0);
});
