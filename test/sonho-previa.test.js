'use strict';

// Prévia do plano (passo 2 do cadastro de sonho).
//
// O contrato que importa: a prévia tem de mostrar EXATAMENTE o plano que
// salvarSonho() vai gravar. Se ela calcular por conta própria — por exemplo
// usando o prazo digitado em vez do horizonte real até dataFim — o usuário
// aprova um número e recebe outro, que é a mesma dor de antes, só que pior
// (agora com uma promessa quebrada no meio).
//
// O caso que separa os dois é o mês de início no futuro: prazo de 12 meses
// começando daqui a 3 meses dá um horizonte de 15 meses, e a mensalidade cai.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

const LOAD_ORDER = [
  'web/appliquei-utils.js',
  'web/appliquei-yahoo-finance.js',
  'web/appliquei-app.js',
  'web/appliquei-contas.js',
  'web/appliquei-aba-controle-financeiro.js',
  'web/appliquei-sonhos.js',
];

function makeDeadNode() {
  return {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    children: [],
    appendChild() {},
    removeChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => makeDeadNode(),
    querySelectorAll: () => [],
    getContext: () => null,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    cloneNode: () => makeDeadNode(),
    closest: () => null,
    matches: () => false,
    focus() {},
    innerHTML: '',
    innerText: '',
    textContent: '',
    value: '',
    checked: false,
  };
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function carregar(dados) {
  const localStorage = makeStorage();
  Object.keys(dados || {}).forEach((k) => localStorage.setItem(k, dados[k]));
  const elementos = {};
  const toasts = [];
  // setTimeout controlado: nada dispara sozinho no load, e o teste roda os
  // callbacks quando quiser (o vínculo com o Controle sai num setTimeout).
  const timers = [];

  const win = {
    location: { hostname: 'localhost', pathname: '/app', search: '', hash: '', reload() {} },
    navigator: { userAgent: 'node-test', sendBeacon: () => true },
    document: {
      readyState: 'complete',
      documentElement: makeDeadNode(),
      body: makeDeadNode(),
      head: makeDeadNode(),
      getElementById: (id) => elementos[id] || makeDeadNode(),
      querySelector: () => makeDeadNode(),
      querySelectorAll: () => [],
      createElement: () => makeDeadNode(),
      addEventListener() {},
      removeEventListener() {},
    },
    localStorage,
    sessionStorage: makeStorage(),
    matchMedia: () => ({ matches: false }),
    Chart: Object.assign(function () {}, {
      register() {},
      defaults: {
        font: {},
        plugins: { tooltip: { titleFont: {}, bodyFont: {} }, legend: { labels: {} } },
        scales: { x: { ticks: {} }, y: { ticks: {} } },
      },
    }),
    ChartDataLabels: {},
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    setTimeout: (fn) => timers.push(fn),
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: () => 0,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener() {},
    removeEventListener() {},
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    Blob: class Blob {},
    FileReader: class FileReader {},
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;

  const ctx = vm.createContext(win);
  for (const f of LOAD_ORDER) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }

  win.mostrarToast = (msg, tipo) => toasts.push({ msg, tipo });
  win.renderizarSonhos = () => {};
  win.atualizarTelaControle = () => {};
  win.renderPreviaSonho = win.renderPreviaSonho; // usado direto em alguns testes

  const rodarTimers = () => {
    while (timers.length) timers.shift()();
  };
  return { win, localStorage, elementos, toasts, rodarTimers };
}

const ymMes = (offset) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Preenche o passo 1 exatamente como o usuário faria.
function preencher(
  env,
  { nome = 'Viagem', total, prazo, unidade = 'meses', inicial = 0, mesInicio } = {}
) {
  const set = (id, value) => {
    env.elementos[id] = Object.assign(makeDeadNode(), { value: String(value) });
  };
  set('sonhoNome', nome);
  set('sonhoValorTotal', total);
  set('sonhoPrazo', prazo);
  set('sonhoPrazoUnidade', unidade);
  set('sonhoValorInicial', inicial);
  set('sonhoMesInicio', mesInicio || ymMes(0));
  set('sonhoDescricao', '');
  set('sonhoCategoria', 'viagem');
  set('sonhoEsforco', 'medio');
  // Conta de origem passou a ser obrigatória no cadastro (INV-22 / RISCO-02):
  // sem ela o compromisso nasceria com contaId indefinido e a parcela paga
  // cairia em "A reconciliar". Estes testes são sobre o PLANO (mensal, prazo,
  // data de fim), então a conta é só o que destrava a gravação.
  const conta = env.win.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 100000 });
  set('sonhoContaOrigem', conta.id);
  env.elementos.sonhoVincularPlano = Object.assign(makeDeadNode(), { checked: false });
}

// ---- o plano da prévia é o plano que será gravado ----------------------

test('prévia bate com o sonho gravado: mensal, prazo e data de fim', () => {
  const env = carregar({});
  preencher(env, { total: 12000, prazo: 24, inicial: 2000 });

  const previa = env.win.lerPlanoDoFormularioSonho();
  env.win.salvarSonho();

  const s = JSON.parse(env.localStorage.getItem('appliquei_sonhos'))[0];
  assert.equal(s.prazoMeses, previa.prazo);
  assert.equal(s.mesesRestantes, previa.mesesAteFim);
  assert.equal(new Date(s.dataFim).toDateString(), previa.dataFim.toDateString());
  // O número que o usuário aprovou é o mesmo que o app usa para o plano.
  assert.equal(
    env.win.calcSonhoMensal(s.valorTotal, s.valorAtual, s.mesesRestantes).toFixed(2),
    previa.mensal.toFixed(2)
  );
});

test('mês de início no futuro: o horizonte é maior que o prazo digitado', () => {
  const env = carregar({});
  preencher(env, { total: 12000, prazo: 12, inicial: 0, mesInicio: ymMes(3) });

  const previa = env.win.lerPlanoDoFormularioSonho();
  assert.equal(previa.prazo, 12);
  assert.ok(
    previa.mesesAteFim > 12,
    `horizonte deveria passar de 12 meses, veio ${previa.mesesAteFim}`
  );
  assert.equal(previa.comecaNoFuturo, true);

  // E o gravado tem de bater com o previsto — este é o caso que pegaria uma
  // prévia que usasse o prazo digitado como horizonte.
  env.win.salvarSonho();
  const s = JSON.parse(env.localStorage.getItem('appliquei_sonhos'))[0];
  assert.equal(s.mesesRestantes, previa.mesesAteFim);
});

test('prazo em anos vira meses', () => {
  const env = carregar({});
  preencher(env, { total: 60000, prazo: 5, unidade: 'anos' });
  assert.equal(env.win.lerPlanoDoFormularioSonho().prazo, 60);
});

// ---- composição --------------------------------------------------------

test('composição fecha: já guardado + aportes + juros = projeção final', () => {
  const env = carregar({});
  preencher(env, { total: 20000, prazo: 36, inicial: 3000 });
  const p = env.win.lerPlanoDoFormularioSonho();
  assert.ok(
    Math.abs(p.valorInicial + p.totalAportado + p.juros - p.projecaoFinal) < 0.01,
    'as parcelas exibidas têm de somar o total exibido'
  );
  assert.ok(p.juros > 0, 'com 0,8% a.m. em 36 meses tem de haver juros');
});

test('meta já coberta pelo que o usuário tem: mensal zero e nada a faltar', () => {
  const env = carregar({});
  preencher(env, { total: 5000, prazo: 12, inicial: 5000 });
  const p = env.win.lerPlanoDoFormularioSonho();
  assert.equal(p.mensal, 0);
  assert.equal(p.falta, 0);
});

test('prazo maior derruba a mensalidade', () => {
  const env = carregar({});
  preencher(env, { total: 30000, prazo: 12 });
  const curto = env.win.lerPlanoDoFormularioSonho().mensal;
  env.elementos.sonhoPrazo.value = '60';
  const longo = env.win.lerPlanoDoFormularioSonho().mensal;
  assert.ok(longo < curto, 'em 60 meses a parcela tem de ser menor que em 12');
});

test('aplicarPrazoPreviaSonho escreve de volta no formulário (fonte única)', () => {
  const env = carregar({});
  preencher(env, { total: 30000, prazo: 12 });
  env.win.renderPreviaSonho = () => {}; // só interessa o efeito no formulário

  env.win.aplicarPrazoPreviaSonho(24);
  assert.equal(env.elementos.sonhoPrazoUnidade.value, 'anos');
  assert.equal(env.elementos.sonhoPrazo.value, 2);

  env.win.aplicarPrazoPreviaSonho(6);
  assert.equal(env.elementos.sonhoPrazoUnidade.value, 'meses');
  assert.equal(env.elementos.sonhoPrazo.value, 6);
  // E o plano recalculado usa o valor novo.
  assert.equal(env.win.lerPlanoDoFormularioSonho().prazo, 6);
});

// ---- veredito contra a sobra real --------------------------------------

test('sem lançamentos no Controle, o veredito assume semDados', () => {
  const env = carregar({});
  assert.equal(env.win.avaliarFolgaParaSonho(500).semDados, true);
});

test('veredito soma o sonho novo aos compromissos que já existem', () => {
  const env = carregar({
    appliquei_sonhos: JSON.stringify([
      {
        id: 'sonho_a',
        nome: 'Outro',
        valorTotal: 12000,
        valorAtual: 0,
        prazoMeses: 24,
        mesesRestantes: 24,
        aportes: [],
      },
    ]),
  });
  // Sobra confortável: o compromisso existente + o novo cabem.
  env.win.analisarSaudeFinanceiraSonhos = () => ({
    semDados: false,
    sobraMedia: 4000,
    compromissoSonhos: 400,
  });

  const f = env.win.avaliarFolgaParaSonho(600);
  assert.equal(f.jaComprometido, 400);
  assert.equal(f.depois, 1000);
  assert.equal(f.pct, 25);
  assert.equal(f.nivel, 'cabe');
});

test('veredito muda de faixa conforme o peso na sobra', () => {
  const env = carregar({});
  const comSobra = (sobra, comprometido) => {
    env.win.analisarSaudeFinanceiraSonhos = () => ({
      semDados: false,
      sobraMedia: sobra,
      compromissoSonhos: comprometido,
    });
  };
  comSobra(1000, 0);
  assert.equal(env.win.avaliarFolgaParaSonho(600).nivel, 'cabe'); // 60%
  assert.equal(env.win.avaliarFolgaParaSonho(900).nivel, 'aperta'); // 90%
  assert.equal(env.win.avaliarFolgaParaSonho(1500).nivel, 'nao_cabe'); // 150%
  comSobra(-200, 0);
  assert.equal(env.win.avaliarFolgaParaSonho(100).nivel, 'nao_cabe');
});

test('na edição, o veredito não conta o próprio sonho duas vezes', () => {
  const env = carregar({
    appliquei_sonhos: JSON.stringify([
      {
        id: 'sonho_a',
        nome: 'Carro',
        valorTotal: 24000,
        valorAtual: 0,
        prazoMeses: 24,
        mesesRestantes: 24,
        aportes: [],
      },
    ]),
  });
  const mensalDoSonho = env.win.calcSonhoMensal(24000, 0, 24);
  env.win.analisarSaudeFinanceiraSonhos = () => ({
    semDados: false,
    sobraMedia: 5000,
    compromissoSonhos: mensalDoSonho,
  });

  env.win.sonhoEditandoId = 'sonho_a';
  const f = env.win.avaliarFolgaParaSonho(mensalDoSonho);
  assert.ok(
    Math.abs(f.jaComprometido) < 0.01,
    'o compromisso antigo do sonho editado tem de sair da conta'
  );
  assert.ok(Math.abs(f.depois - mensalDoSonho) < 0.01);
});

// ---- vínculo com o Controle decidido na prévia -------------------------

test('checkbox marcado na prévia já cria o compromisso no Controle', () => {
  const env = carregar({});
  preencher(env, { total: 12000, prazo: 12 });
  env.elementos.sonhoVincularPlano.checked = true;

  env.win.salvarSonho();
  env.rodarTimers();

  const s = JSON.parse(env.localStorage.getItem('appliquei_sonhos'))[0];
  assert.equal(s.planoVinculado, true);
  assert.ok(s.aporteMensalPlano > 0);
  const lancamentos = JSON.parse(env.localStorage.getItem('futurorico_transacoes') || '[]').filter(
    (t) => t.sonhoId === s.id
  );
  assert.ok(lancamentos.length > 0, 'deveria ter gerado lançamentos mensais');
});

test('checkbox desmarcado cria o sonho sem mexer no Controle', () => {
  const env = carregar({});
  preencher(env, { total: 12000, prazo: 12 });
  env.elementos.sonhoVincularPlano.checked = false;

  env.win.salvarSonho();
  env.rodarTimers();

  const s = JSON.parse(env.localStorage.getItem('appliquei_sonhos'))[0];
  assert.equal(s.planoVinculado, false);
  const lancamentos = JSON.parse(env.localStorage.getItem('futurorico_transacoes') || '[]').filter(
    (t) => t.sonhoId === s.id
  );
  assert.equal(lancamentos.length, 0);
});

// ---- navegação entre passos -------------------------------------------

test('irParaPreviaSonho exige nome e valor antes de mostrar o plano', () => {
  const env = carregar({});
  preencher(env, { nome: '', total: 1000, prazo: 12 });
  env.elementos.sonhoPasso1 = makeDeadNode();
  env.elementos.sonhoPasso2 = makeDeadNode();

  env.win.irParaPreviaSonho();
  assert.equal(env.toasts.at(-1).tipo, 'erro');
  assert.equal(env.elementos.sonhoPasso2.style.display, undefined, 'não avança de passo');

  env.elementos.sonhoNome.value = 'Viagem';
  env.elementos.sonhoValorTotal.value = '0';
  env.win.irParaPreviaSonho();
  assert.equal(env.toasts.at(-1).tipo, 'erro');
});
