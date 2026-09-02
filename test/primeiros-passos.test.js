'use strict';

// Guia de primeiros passos (web/appliquei-primeiros-passos.js).
//
// O guia existe por causa de uma pergunta real de primeiro uso: "preciso criar
// uma conta em Meu patrimônio para cadastrar uma despesa? e para a receita?".
// A resposta é não — executarInsercao() cria a conta a partir do nome digitado
// —, e o que quebra em silêncio aqui é sempre a mesma família de coisas:
//
//  1. QUEM VÊ. O convite só pode aparecer com o app REALMENTE vazio. Mostrá-lo
//     a quem já tem dados é ruído; escondê-lo de quem acabou de zerar é
//     justamente o defeito que ele veio corrigir. `cartoes` não entra na conta
//     do "vazio" porque appliquei-app.js semeia um cartão padrão no boot de
//     todo mundo — usá-lo esconderia o guia de 100% dos usuários novos.
//
//  2. QUANDO SOME. O estado mora em `appliquei_primeiros_passos`, que NÃO está
//     na lista preservada do reset. Se alguém a adicionar lá, "recomeçar do
//     zero" deixa de trazer o guia de volta e o problema volta inteiro.
//
//  3. O QUE MARCA O PASSO. Os passos leem DADOS, não cliques: importar um
//     backup ou lançar por fora do guia tem de concluí-los igual.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const ARQUIVO = path.join(ROOT, 'web/appliquei-primeiros-passos.js');
const FONTE = fs.readFileSync(ARQUIVO, 'utf8');

function makeDeadNode() {
  return {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    hidden: false,
    innerHTML: '',
    textContent: '',
    value: '',
    click() {},
    focus() {},
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    scrollIntoView() {},
    querySelector: () => makeDeadNode(),
    querySelectorAll: () => [],
  };
}

function makeStorage(inicial) {
  const map = new Map(Object.entries(inicial || {}));
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(String(k)),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

// Carrega o módulo sozinho, sem o resto do app: sem os globais `transacoes`,
// `contas` etc., ele lê do localStorage — que é exatamente o caminho de
// fallback que interessa exercitar aqui.
function carregar(dados) {
  const elementos = {};
  const ouvintes = {};
  const win = {
    document: {
      readyState: 'loading',
      body: makeDeadNode(),
      getElementById: (id) => elementos[id] || makeDeadNode(),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    localStorage: makeStorage(dados),
    sessionStorage: makeStorage({}),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console: { log() {}, warn() {}, error() {} },
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    addEventListener(nome, fn) {
      (ouvintes[nome] = ouvintes[nome] || []).push(fn);
    },
    removeEventListener() {},
    dispatchEvent: () => true,
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  const ctx = vm.createContext(win);
  vm.runInContext(FONTE, ctx, { filename: 'web/appliquei-primeiros-passos.js' });
  return { win, elementos, ouvintes };
}

const APP_VAZIO = {};

function comLancamentos(lista) {
  return { futurorico_transacoes: JSON.stringify(lista) };
}

// ============================================================
// 1. Quem vê o convite
// ============================================================

test('app vazio e sem resposta anterior: o convite aparece', () => {
  const { win } = carregar(APP_VAZIO);
  assert.equal(win.ppEstadoAtual(), 'pendente');
  assert.equal(win.ppAppVazio(), true);
  assert.equal(win.ppDeveMostrarBoasVindas(), true);
});

test('o cartão padrão semeado no boot NÃO conta como dado do usuário', () => {
  // appliquei-app.js cria 'card_padrao' para todo mundo. Se ele contasse, o
  // guia nunca apareceria para ninguém.
  const { win } = carregar({
    futurorico_cartoes: JSON.stringify([{ id: 'card_padrao', nome: 'Cartão principal' }]),
  });
  assert.equal(win.ppAppVazio(), true);
  assert.equal(win.ppDeveMostrarBoasVindas(), true);
});

test('qualquer registro do usuário cancela o convite', () => {
  const casos = {
    lançamento: comLancamentos([{ id: '1', categoria: 'receita' }]),
    investimento: { futurorico_compras: JSON.stringify([{ ticker: 'BTLG11' }]) },
    conta: { appliquei_contas: JSON.stringify([{ id: 'c1', nome: 'Nubank' }]) },
    bem: { appliquei_bens: JSON.stringify([{ id: 'b1' }]) },
    sonho: { appliquei_sonhos: JSON.stringify([{ id: 's1' }]) },
  };
  for (const [rotulo, dados] of Object.entries(casos)) {
    const { win } = carregar(dados);
    assert.equal(win.ppAppVazio(), false, `${rotulo} deveria contar como dado`);
    assert.equal(win.ppDeveMostrarBoasVindas(), false, `${rotulo} não deveria ver o convite`);
  }
});

test('quem já respondeu não é convidado de novo', () => {
  for (const estado of ['pulado', 'guiando', 'concluido']) {
    const { win } = carregar({
      appliquei_primeiros_passos: JSON.stringify({ v: 1, estado: estado }),
    });
    assert.equal(win.ppEstadoAtual(), estado);
    assert.equal(win.ppDeveMostrarBoasVindas(), false, estado);
  }
});

test('estado corrompido cai para pendente em vez de lançar', () => {
  for (const bruto of ['{{{', 'null', '"texto"', '{"estado":"marte"}', '[]']) {
    const { win } = carregar({ appliquei_primeiros_passos: bruto });
    assert.equal(win.ppEstadoAtual(), 'pendente', bruto);
  }
});

// ============================================================
// 2. Pular e seguir são as duas saídas exigidas
// ============================================================

test('pular grava "pulado" e o cartão some', () => {
  const { win } = carregar(APP_VAZIO);
  win.ppPularGuia();
  assert.equal(win.ppEstadoAtual(), 'pulado');
  assert.equal(win.ppDeveMostrarCartao(), false);
  assert.equal(win.ppDeveMostrarBoasVindas(), false);
});

test('seguir grava "guiando" e o cartão passa a aparecer', () => {
  const { win } = carregar(APP_VAZIO);
  win.ppComecarGuia();
  assert.equal(win.ppEstadoAtual(), 'guiando');
  assert.equal(win.ppDeveMostrarCartao(), true);
});

test('reabrir pelas Configurações traz o guia de volta depois de pulado', () => {
  const { win } = carregar(APP_VAZIO);
  win.ppPularGuia();
  win.ppReabrirGuia();
  // App vazio + já respondeu → volta ao convite, com a explicação inteira.
  assert.equal(win.ppEstadoAtual(), 'pendente');
  assert.equal(win.ppDeveMostrarBoasVindas(), true);
});

test('reabrir com dados já lançados vai direto para a lista de passos', () => {
  const { win } = carregar(comLancamentos([{ id: '1', categoria: 'receita' }]));
  win.ppPularGuia();
  win.ppReabrirGuia();
  assert.equal(win.ppEstadoAtual(), 'guiando');
  assert.equal(win.ppDeveMostrarCartao(), true);
});

// ============================================================
// 3. Os passos leem dados, não cliques
// ============================================================

test('nenhum passo nasce marcado num app vazio', () => {
  const { win } = carregar(APP_VAZIO);
  // JSON e não deepEqual: os objetos nascem dentro da sandbox vm, logo com os
  // protótipos DELA — deepStrictEqual reprova por realm, não por conteúdo.
  assert.equal(JSON.stringify(win.ppPassos().map((p) => p.feito)), '[false,false,false,false]');
  assert.equal(JSON.stringify(win.ppProgresso()), JSON.stringify({ feitos: 0, total: 3 }));
  assert.equal(win.ppEssenciaisConcluidos(), false);
});

test('a receita marca o passo da receita', () => {
  const { win } = carregar(comLancamentos([{ id: '1', categoria: 'receita' }]));
  assert.equal(win.ppTemReceita(), true);
  assert.equal(win.ppTemDespesa(), false);
});

test('as três formas de saída marcam o passo da despesa', () => {
  for (const cat of ['despesa_fixa', 'despesa_variavel', 'cartao_credito']) {
    const { win } = carregar(comLancamentos([{ id: '1', categoria: cat }]));
    assert.equal(win.ppTemDespesa(), true, cat);
    assert.equal(win.ppTemReceita(), false, cat);
  }
});

test('categoria que não é receita nem saída não marca nada', () => {
  // Aporte, dividendo e transferência entram em `transacoes` como plumbing —
  // não são "o mês da pessoa" e não podem concluir passo nenhum.
  for (const cat of ['investimento_fixo', 'dividendo', 'transferencia_entrada']) {
    const { win } = carregar(comLancamentos([{ id: '1', categoria: cat }]));
    assert.equal(win.ppTemReceita(), false, cat);
    assert.equal(win.ppTemDespesa(), false, cat);
  }
});

test('conta arquivada continua contando como cadastro feito', () => {
  const { win } = carregar({
    appliquei_contas: JSON.stringify([{ id: 'c1', nome: 'Nubank', arquivada: true }]),
  });
  assert.equal(win.ppTemConta(), true);
});

test('os três essenciais concluídos fecham o guia; o investimento é opcional', () => {
  const { win } = carregar({
    appliquei_contas: JSON.stringify([{ id: 'c1', nome: 'Nubank' }]),
    futurorico_transacoes: JSON.stringify([
      { id: '1', categoria: 'receita' },
      { id: '2', categoria: 'despesa_fixa' },
    ]),
  });
  assert.equal(JSON.stringify(win.ppProgresso()), JSON.stringify({ feitos: 3, total: 3 }));
  assert.equal(win.ppEssenciaisConcluidos(), true);
  const opcional = win.ppPassos().find((p) => p.id === 'investimento');
  assert.equal(opcional.essencial, false);
  assert.equal(opcional.feito, false);
});

test('o global preferido é o array em memória, não o localStorage', () => {
  // O app grava o localStorage DEPOIS de mexer no array; ler o disco primeiro
  // deixaria o cartão um passo atrás do que a tela já mostra.
  const { win } = carregar(APP_VAZIO);
  win.transacoes = [{ id: '1', categoria: 'receita' }];
  assert.equal(win.ppTemReceita(), true);
});

// ============================================================
// 4. Contratos com o resto do app
// ============================================================

test('a chave do guia NÃO é preservada pelo "Recomeçar do zero"', () => {
  const utils = fs.readFileSync(path.join(ROOT, 'web/appliquei-utils.js'), 'utf8');
  const bloco = utils.slice(
    utils.indexOf('var RESET_CHAVES_PRESERVADAS'),
    utils.indexOf('function _ehChavePreservadaNoReset')
  );
  assert.ok(bloco.length > 0, 'lista de chaves preservadas não encontrada');
  assert.ok(
    !bloco.includes('appliquei_primeiros_passos'),
    'appliquei_primeiros_passos na lista preservada: o guia deixaria de voltar depois de zerar'
  );
});

test('o reset deixa a marca de pós-reset para o guia mudar o texto', () => {
  const utils = fs.readFileSync(path.join(ROOT, 'web/appliquei-utils.js'), 'utf8');
  const corpo = utils.slice(utils.indexOf('function executarRecomecarDoZero'));
  assert.ok(
    corpo.includes('appliquei_pp_pos_reset'),
    'executarRecomecarDoZero deveria marcar o pós-reset'
  );
  assert.ok(
    corpo.indexOf('appliquei_pp_pos_reset') < corpo.indexOf('window.location.reload'),
    'a marca precisa ser gravada ANTES do reload'
  );
});

test('o interceptador de localStorage avisa a mudança para o cartão redesenhar', () => {
  const utils = fs.readFileSync(path.join(ROOT, 'web/appliquei-utils.js'), 'utf8');
  assert.ok(utils.includes("new CustomEvent('appliquei:dados'"), 'evento appliquei:dados sumiu');
  for (const fn of ['_interceptarSetItem', '_interceptarRemoveItem']) {
    const corpo = utils.slice(utils.indexOf('function ' + fn));
    const fim = corpo.indexOf('\n}\n');
    assert.ok(
      corpo.slice(0, fim).includes('_avisarMudancaLocal'),
      `${fn} deixou de avisar a mudança`
    );
  }
});

test('o cloud-sync expõe se o pull inicial já respondeu', () => {
  // Sem isto o guia decide "app vazio" antes de o Firestore responder, e
  // quem só trocou de aparelho vê o convite piscar até o reload do pull.
  const sync = fs.readFileSync(path.join(ROOT, 'web/appliquei-cloud-sync.js'), 'utf8');
  assert.ok(sync.includes('pullInicialConcluido'), 'AppliqueiCloudSync.pullInicialConcluido sumiu');
  assert.ok(FONTE.includes('pullInicialConcluido'), 'o guia deixou de esperar pelo pull');
});

test('o guia só espera a nuvem quando existe um pull a caminho', () => {
  // Esperar por um pull que nunca vem esconderia o guia exatamente de quem
  // está sozinho com o app vazio — o defeito que ele veio corrigir.
  const { win } = carregar(APP_VAZIO);

  assert.equal(win.ppNuvemRespondeu(), true, 'sem cloud-sync não há o que esperar');

  win.AppliqueiCloudSync = { pullInicialConcluido: () => true };
  assert.equal(win.ppNuvemRespondeu(), true, 'pull concluído');

  win.AppliqueiCloudSync = { pullInicialConcluido: () => false };
  assert.equal(win.ppNuvemRespondeu(), true, 'sem Firebase não há pull a caminho');

  win.AppliqueiFirebase = { ready: false, auth: {} };
  assert.equal(win.ppNuvemRespondeu(), true, 'Firebase que não subiu não puxa nada');

  // Firebase de pé e sessão ainda a restaurar: aqui sim vale esperar, senão o
  // aparelho novo de um usuário antigo vê o convite piscar até o pull recarregar.
  win.AppliqueiFirebase = { ready: true, auth: { currentUser: null } };
  assert.equal(win.ppNuvemRespondeu(), false, 'sessão em restauração: espera');

  // Sessão restaurada COM usuário: continua esperando o pull dele.
  win.AppliqueiFirebase = { ready: true, auth: { currentUser: { uid: 'u1' } } };
  assert.equal(win.ppNuvemRespondeu(), false, 'usuário logado: espera o pull');

  win.AppliqueiCloudSync = { pullInicialConcluido: () => true };
  assert.equal(win.ppNuvemRespondeu(), true, 'pull do usuário chegou');
});

test('auth que resolve sem usuário destrava o guia sem esperar o teto', () => {
  const { win } = carregar(APP_VAZIO);
  let aoResolver = null;
  win.AppliqueiCloudSync = { pullInicialConcluido: () => false };
  win.AppliqueiFirebase = {
    ready: true,
    auth: {
      currentUser: null,
      onAuthStateChanged(cb) {
        aoResolver = cb;
      },
    },
  };
  win.ppObservarAuth();
  assert.equal(win.ppNuvemRespondeu(), false, 'antes de resolver, espera');
  assert.equal(typeof aoResolver, 'function', 'o guia deveria observar a autenticação');
  aoResolver(null); // "não há ninguém logado"
  assert.equal(win.ppNuvemRespondeu(), true, 'resolvido sem usuário: não há pull a esperar');
});

// ============================================================
// 5. O HTML tem o que o módulo precisa
// ============================================================

test('o HTML traz o container, o convite e o botão de reabrir', () => {
  const html = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
  assert.ok(html.includes('id="ppGuia"'), 'container do cartão ausente');
  assert.ok(html.includes('id="ppBoasVindas"'), 'modal de convite ausente');
  assert.ok(html.includes('ppComecarGuia()'), 'botão "seguir o guia" ausente');
  assert.ok(html.includes('ppPularGuia()'), 'botão "pular" ausente');
  assert.ok(html.includes('ppReabrirGuia()'), 'reabertura por Configurações ausente');
  assert.ok(
    html.includes('appliquei-primeiros-passos.js'),
    'o script do guia não é carregado pelo HTML'
  );
});

test('o convite responde à dúvida em vez de só dar boas-vindas', () => {
  const html = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
  const inicio = html.indexOf('id="ppBoasVindas"');
  const bloco = html.slice(inicio, html.indexOf('id="modalConfirmacao"'));
  assert.ok(/Não precisa/i.test(bloco), 'o convite não responde "precisa criar conta antes?"');
  assert.ok(/saldo que você já tem/i.test(bloco), 'falta dizer para que serve cadastrar a conta');
});

test('o campo de banco do lançamento diz que a conta não precisa existir antes', () => {
  const html = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
  const inicio = html.indexOf('id="grupoBancoReceita"');
  const bloco = html.slice(inicio, inicio + 2400);
  assert.ok(
    /não precisa ter cadastrado a conta antes/i.test(bloco),
    'a dica ao lado do campo obrigatório sumiu — é o ponto exato da confusão'
  );
});

test('o FAQ responde a mesma pergunta que travou o primeiro uso', () => {
  const faq = fs.readFileSync(path.join(ROOT, 'web/appliquei-duvidas.js'), 'utf8');
  assert.ok(
    /Preciso cadastrar uma conta antes de lançar/i.test(faq),
    'a pergunta literal do primeiro uso saiu do FAQ'
  );
  assert.ok(/guia de primeiros passos/i.test(faq), 'o FAQ não menciona o guia');
  // O "Sim, e é rápido" da resposta antiga era metade do problema: dizia que
  // cadastrar a conta vinha antes de conseguir lançar.
  const bloco = faq.slice(faq.indexOf('Preciso cadastrar minhas contas e bancos?'));
  assert.ok(
    /Não é obrigatório para lançar/i.test(bloco.slice(0, 700)),
    'a resposta voltou a sugerir que o cadastro da conta é pré-requisito'
  );
});

test('o vazio de Minhas Contas não se lê como pré-requisito', () => {
  const contas = fs.readFileSync(path.join(ROOT, 'web/appliquei-contas.js'), 'utf8');
  const inicio = contas.indexOf('function renderMinhasContas');
  const bloco = contas.slice(inicio, inicio + 2600);
  assert.ok(/não precisa/i.test(bloco), 'o estado vazio voltou a sugerir que a conta vem antes');
});
