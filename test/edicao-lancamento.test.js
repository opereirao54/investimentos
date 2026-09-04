'use strict';

// Edição de lançamento já realizado + data de vencimento do cartão.
//
// Quatro defeitos reais, todos reproduzidos em browser antes de corrigir:
//
//  1. COMPETÊNCIA NÃO ACOMPANHAVA A DATA. Toda a tela do Controle filtra por
//     t.mes/t.ano; a edição gravava dataVencimento e não mexia neles. Corrigir
//     a data de um lançamento salvava a data nova e deixava o lançamento no mês
//     errado — "editei a data e não corrigiu".
//  2. O modo "todos os meses" IGNORAVA A DATA por completo: dava para mudar
//     valor e descrição de uma conta fixa, nunca o vencimento.
//  3. Abrir uma despesa de CARTÃO para editar SOBRESCREVIA a data guardada com
//     a fatura calculada de hoje — uma despesa de maio virava setembro só por
//     ter sido aberta.
//  4. Trocar para um cartão SEM dia de vencimento deixava no campo a data do
//     cartão anterior, em silêncio: a despesa entrava na fatura de outro cartão.
//
// O par de testes que mais protege é "data mudou → competência acompanha" e
// "data não mudou → competência intacta": o segundo existe porque competência e
// vencimento divergem de propósito (conta de agosto que vence em setembro), e
// recalcular sempre arrastaria esses lançamentos para o mês errado.

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
];

function makeDeadNode(extra) {
  return Object.assign(
    {
      style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      dataset: {},
      children: [],
      options: [],
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
      innerText: '',
      textContent: '',
      value: '',
      checked: false,
      readOnly: false,
      title: '',
    },
    extra || {}
  );
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
    setTimeout: () => 0,
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

  // Render de tela depende de DOM real; aqui interessa a camada de dados.
  win.mostrarToast = (msg, tipo) => toasts.push({ msg, tipo });
  win.atualizarTelaControle = () => {};
  win.atualizarDatalistDescricoes = () => {};
  win.fecharPainelLancamento = () => {};
  win.abrirPainelLancamento = () => {};
  win.popularSelectCategoriaDespesa = () => {};

  return { win, localStorage, elementos, toasts };
}

const gravadas = (env) => JSON.parse(env.localStorage.getItem('futurorico_transacoes') || '[]');

// Monta o formulário do painel de lançamento com os valores informados.
function montarFormulario(env, campos) {
  const set = (id, value) => {
    env.elementos[id] = makeDeadNode({ value: String(value) });
  };
  set('descTransacao', campos.desc ?? 'Conta de luz');
  set('valorTransacao', campos.valor ?? '200,00');
  set('categoriaTransacao', campos.categoria ?? 'despesa_fixa');
  set('dataVencimento', campos.venc ?? '');
  set('obsTransacao', campos.obs ?? '');
  set('editTransacaoId', campos.editId ?? '');
  set('bancoTransacao', campos.banco ?? 'Nubank');
  set('selectCartao', campos.cartao ?? '');
  set('categoriaDespesa', campos.catDespesa ?? '');
  set('qtdParcelas', '1');
  set('tipoCartaoSelecionado', 'parcelado');
  env.elementos.transacaoFixa = makeDeadNode({ checked: false });
  [
    'grupoParcelas',
    'grupoFixa',
    'grupoCartaoSelect',
    'grupoBancoReceita',
    'grupoCategoriaDespesa',
    'btnSalvarControle',
    'btnCancelarEdicao',
    'opcoesEdicaoRecorrente',
    'tituloPainelControle',
    'lblValorOpControle',
    'lblBancoTransacao',
    'btnTipoParcelado',
    'btnTipoFixo',
    'listaDescricoes',
    'categoriaDespesaNova',
    // Seletor de fatura: o formulário de cartão passa a escolher a fatura em
    // vez de exibir uma data derivada.
    'grupoSeletorFatura',
    'seletorFaturaOpcoes',
    'seletorFaturaAviso',
    'seletorFaturaResumo',
    'seletorFaturaSemDados',
    'grupoVencimentoControle',
    'gridCategoriaVencimento',
  ].forEach((id) => {
    env.elementos[id] = makeDeadNode();
  });
  env.elementos.faturaEscolhida = makeDeadNode({ value: campos.fatura ?? 'aberta' });
}

const CARTAO_COM_VENC = { id: 'card_a', nome: 'Cartão A', diaFechamento: 28, diaVencimento: 5 };
const CARTAO_SEM_VENC = { id: 'card_padrao', nome: 'Cartão principal', diaVencimento: null };

// ---- competência acompanha a data -------------------------------------

test('editar a data move o lançamento para o mês daquela data', () => {
  const env = carregar({
    futurorico_transacoes: JSON.stringify([
      {
        id: 't1',
        groupId: null,
        descricao: 'Luz',
        valor: 200,
        categoria: 'despesa_fixa',
        banco: 'Nubank',
        obs: '',
        mes: 7,
        ano: 2026,
        dataVencimento: '2026-08-10',
        pago: false,
      },
    ]),
  });
  montarFormulario(env, { editId: 't1', desc: 'Luz', valor: '200,00', venc: '2026-06-10' });

  env.win.executarEdicao('unica');

  const t = gravadas(env)[0];
  assert.equal(t.dataVencimento, '2026-06-10');
  assert.equal(t.mes, 5, 'junho é mês 5');
  assert.equal(t.ano, 2026);
});

test('editar a data para outro ANO leva mês e ano juntos', () => {
  const env = carregar({
    futurorico_transacoes: JSON.stringify([
      {
        id: 't1',
        groupId: null,
        descricao: 'IPVA',
        valor: 900,
        categoria: 'despesa_fixa',
        banco: 'Nubank',
        obs: '',
        mes: 0,
        ano: 2026,
        dataVencimento: '2026-01-15',
        pago: false,
      },
    ]),
  });
  montarFormulario(env, { editId: 't1', desc: 'IPVA', valor: '900,00', venc: '2027-03-15' });

  env.win.executarEdicao('unica');

  const t = gravadas(env)[0];
  assert.equal(t.mes, 2);
  assert.equal(t.ano, 2027);
});

test('editar SEM mexer na data preserva a competência original', () => {
  // Conta lançada na competência de agosto que vence em setembro — divergência
  // de propósito. Recalcular sempre a arrastaria para setembro sozinha.
  const env = carregar({
    futurorico_transacoes: JSON.stringify([
      {
        id: 't1',
        groupId: null,
        descricao: 'Escola',
        valor: 800,
        categoria: 'despesa_fixa',
        banco: 'Nubank',
        obs: '',
        mes: 7,
        ano: 2026,
        dataVencimento: '2026-09-05',
        pago: false,
      },
    ]),
  });
  montarFormulario(env, {
    editId: 't1',
    desc: 'Escola do João',
    valor: '850,00',
    venc: '2026-09-05',
  });

  env.win.executarEdicao('unica');

  const t = gravadas(env)[0];
  assert.equal(t.descricao, 'Escola do João');
  assert.equal(t.valor, 850);
  assert.equal(t.mes, 7, 'competência não pode se mover sozinha');
  assert.equal(t.ano, 2026);
});

test('limpar a data não bagunça a competência', () => {
  const env = carregar({
    futurorico_transacoes: JSON.stringify([
      {
        id: 't1',
        groupId: null,
        descricao: 'Luz',
        valor: 200,
        categoria: 'despesa_fixa',
        banco: 'Nubank',
        obs: '',
        mes: 7,
        ano: 2026,
        dataVencimento: '2026-08-10',
        pago: false,
      },
    ]),
  });
  montarFormulario(env, { editId: 't1', desc: 'Luz', valor: '200,00', venc: '' });

  env.win.executarEdicao('unica');

  const t = gravadas(env)[0];
  assert.equal(t.dataVencimento, '');
  assert.equal(t.mes, 7, 'sem data válida, fica onde estava');
  assert.equal(t.ano, 2026);
});

test('os demais campos continuam sendo salvos na edição', () => {
  const env = carregar({
    futurorico_transacoes: JSON.stringify([
      {
        id: 't1',
        groupId: null,
        descricao: 'Antigo',
        valor: 100,
        categoria: 'despesa_variavel',
        banco: 'Nubank',
        obs: 'nota velha',
        mes: 7,
        ano: 2026,
        dataVencimento: '2026-08-10',
      },
    ]),
  });
  montarFormulario(env, {
    editId: 't1',
    desc: 'Novo nome',
    valor: '333,00',
    categoria: 'despesa_variavel',
    venc: '2026-08-11',
    obs: 'nota nova',
    banco: 'Itaú',
    catDespesa: 'transporte',
  });

  env.win.executarEdicao('unica');

  const t = gravadas(env)[0];
  assert.equal(t.descricao, 'Novo nome');
  assert.equal(t.valor, 333);
  assert.equal(t.obs, 'nota nova');
  assert.equal(t.banco, 'Itaú');
  assert.equal(t.categoriaDespesa, 'transporte');
});

// ---- série recorrente --------------------------------------------------

test('"todos os meses" muda o DIA do vencimento sem empurrar as parcelas', () => {
  const env = carregar({
    futurorico_transacoes: JSON.stringify([
      {
        id: 'a',
        groupId: 'g1',
        descricao: 'Aluguel',
        valor: 1000,
        categoria: 'despesa_fixa',
        banco: 'Nubank',
        obs: '',
        mes: 7,
        ano: 2026,
        dataVencimento: '2026-08-05',
        pago: false,
      },
      {
        id: 'b',
        groupId: 'g1',
        descricao: 'Aluguel',
        valor: 1000,
        categoria: 'despesa_fixa',
        banco: 'Nubank',
        obs: '',
        mes: 8,
        ano: 2026,
        dataVencimento: '2026-09-05',
        pago: false,
      },
      {
        id: 'c',
        groupId: 'g1',
        descricao: 'Aluguel',
        valor: 1000,
        categoria: 'despesa_fixa',
        banco: 'Nubank',
        obs: '',
        mes: 9,
        ano: 2026,
        dataVencimento: '2026-10-05',
        pago: false,
      },
    ]),
  });
  montarFormulario(env, { editId: 'a', desc: 'Aluguel', valor: '1.200,00', venc: '2026-08-25' });

  env.win.executarEdicao('todas');

  const ts = gravadas(env);
  assert.deepEqual(
    ts.map((t) => t.dataVencimento),
    ['2026-08-25', '2026-09-25', '2026-10-25'],
    'o dia novo vale para toda a série, cada parcela no seu mês'
  );
  assert.ok(ts.every((t) => t.valor === 1200));
  assert.deepEqual(
    ts.map((t) => t.mes),
    [7, 8, 9],
    'as competências da série não se mexem'
  );
});

test('"todos os meses" respeita mês curto (dia 31 em fevereiro)', () => {
  const env = carregar({
    futurorico_transacoes: JSON.stringify([
      {
        id: 'a',
        groupId: 'g1',
        descricao: 'Plano',
        valor: 90,
        categoria: 'despesa_fixa',
        banco: 'Nubank',
        obs: '',
        mes: 0,
        ano: 2027,
        dataVencimento: '2027-01-10',
        pago: false,
      },
      {
        id: 'b',
        groupId: 'g1',
        descricao: 'Plano',
        valor: 90,
        categoria: 'despesa_fixa',
        banco: 'Nubank',
        obs: '',
        mes: 1,
        ano: 2027,
        dataVencimento: '2027-02-10',
        pago: false,
      },
    ]),
  });
  montarFormulario(env, { editId: 'a', desc: 'Plano', valor: '90,00', venc: '2027-01-31' });

  env.win.executarEdicao('todas');

  assert.deepEqual(
    gravadas(env).map((t) => t.dataVencimento),
    ['2027-01-31', '2027-02-28'],
    'fevereiro não pode virar 31'
  );
});

test('"todos os meses" não toca em parcelas anteriores à editada', () => {
  const env = carregar({
    futurorico_transacoes: JSON.stringify([
      {
        id: 'a',
        groupId: 'g1',
        descricao: 'Curso',
        valor: 500,
        categoria: 'despesa_fixa',
        banco: 'Nubank',
        obs: '',
        mes: 6,
        ano: 2026,
        dataVencimento: '2026-07-05',
        pago: true,
      },
      {
        id: 'b',
        groupId: 'g1',
        descricao: 'Curso',
        valor: 500,
        categoria: 'despesa_fixa',
        banco: 'Nubank',
        obs: '',
        mes: 7,
        ano: 2026,
        dataVencimento: '2026-08-05',
        pago: false,
      },
    ]),
  });
  montarFormulario(env, { editId: 'b', desc: 'Curso', valor: '600,00', venc: '2026-08-20' });

  env.win.executarEdicao('todas');

  const ts = gravadas(env);
  assert.equal(ts[0].dataVencimento, '2026-07-05', 'o mês já pago fica como está');
  assert.equal(ts[0].valor, 500);
  assert.equal(ts[1].dataVencimento, '2026-08-20');
  assert.equal(ts[1].valor, 600);
});

// ---- data de vencimento do cartão -------------------------------------

test('competenciaDaData: só aceita data válida', () => {
  const env = carregar({});
  // JSON normaliza: o objeto vem do realm do vm e deepEqual estrito compara protótipos.
  assert.deepEqual(JSON.parse(JSON.stringify(env.win.competenciaDaData('2026-08-10'))), {
    mes: 7,
    ano: 2026,
  });
  assert.equal(env.win.competenciaDaData(''), null);
  assert.equal(env.win.competenciaDaData(null), null);
  assert.equal(env.win.competenciaDaData('2026-13-10'), null);
  assert.equal(env.win.competenciaDaData('abacaxi'), null);
});

test('abrir despesa de cartão para editar preserva a data guardada', () => {
  const env = carregar({
    futurorico_cartoes: JSON.stringify([CARTAO_COM_VENC]),
    futurorico_transacoes: JSON.stringify([
      {
        id: 't1',
        groupId: null,
        descricao: 'Compra',
        valor: 300,
        categoria: 'cartao_credito',
        cartaoId: 'card_a',
        obs: '',
        mes: 4,
        ano: 2026,
        dataVencimento: '2026-05-05',
        pago: false,
      },
    ]),
  });
  montarFormulario(env, { editId: '', categoria: 'cartao_credito' });

  env.win.prepararEdicao('t1');

  assert.equal(
    env.elementos.dataVencimento.value,
    '2026-05-05',
    'a fatura de hoje não pode sobrescrever a data do lançamento'
  );
});

test('trocar para cartão SEM dia de vencimento limpa e destrava o campo', () => {
  const env = carregar({ futurorico_cartoes: JSON.stringify([CARTAO_COM_VENC, CARTAO_SEM_VENC]) });
  montarFormulario(env, { categoria: 'cartao_credito', cartao: 'card_a', venc: '2026-09-05' });
  env.elementos.dataVencimento.readOnly = true;

  env.elementos.selectCartao.value = 'card_padrao';
  env.win.preencherVencimentoPorCartao();

  assert.equal(env.elementos.dataVencimento.value, '', 'não pode herdar a data do cartão anterior');
  assert.equal(env.elementos.dataVencimento.readOnly, false, 'o usuário precisa poder digitar');

  // O aviso era um toast, que some em três segundos e não resolve nada. Virou
  // um bloco fixo no lugar das opções de fatura, que diz QUAL cartão está
  // incompleto e traz os dois campos para completar ali mesmo — mandar para
  // Configurações custaria o lançamento que estava sendo digitado.
  const bloco = env.elementos.seletorFaturaSemDados;
  assert.equal(bloco.style.display, 'block', 'o bloco tem de aparecer no lugar das faturas');
  assert.match(bloco.innerHTML, /não tem fechamento e vencimento/i, 'diz o que falta');
  assert.match(bloco.innerHTML, /Cartão principal/, 'diz de qual cartão está falando');
  assert.match(bloco.innerHTML, /id="faturaDiaFech"/, 'e traz o campo para resolver ali');
  assert.match(bloco.innerHTML, /id="faturaDiaVenc"/);
});

// ---- seletor de fatura: nada se move sem escolha ------------------------
//
// O relato que originou o seletor: comprou antes do fechamento, lançou depois,
// e caiu na fatura errada sem poder corrigir. A correção deu a escolha — e a
// escolha trouxe um risco novo: mover um lançamento antigo por acidente.

test('editar lançamento de outra fatura: abrir as opções NÃO move nada', () => {
  // Uma compra de 2020: nunca vai ser uma das duas candidatas, em nenhuma data
  // em que a suíte rode.
  const env = carregar({
    futurorico_cartoes: JSON.stringify([CARTAO_COM_VENC]),
    futurorico_transacoes: JSON.stringify([
      {
        id: 'antigo',
        descricao: 'Compra antiga',
        valor: 99,
        categoria: 'cartao_credito',
        cartaoId: 'card_a',
        mes: 2,
        ano: 2020,
        dataVencimento: '2020-03-10',
        pago: true,
      },
    ]),
  });
  montarFormulario(env, { editId: '', categoria: 'cartao_credito', cartao: 'card_a' });

  env.win.prepararEdicao('antigo');
  assert.equal(
    env.elementos.dataVencimento.value,
    '2020-03-10',
    'abrir para editar não pode mexer na fatura'
  );

  // Clicar em "Mover para outra fatura" mostra as opções, mas nenhuma marcada:
  // quem clicou ainda não escolheu para onde, e sair sem escolher tem de
  // deixar o lançamento onde estava.
  env.win.expandirSeletorFatura();
  assert.equal(
    env.elementos.dataVencimento.value,
    '2020-03-10',
    'expandir o seletor não pode mover o lançamento'
  );
  assert.equal(env.elementos.faturaEscolhida.value, 'manter');
});

test('seletor de fatura: escolher a fechada move o lançamento para ela', () => {
  const env = carregar({ futurorico_cartoes: JSON.stringify([CARTAO_COM_VENC]) });
  montarFormulario(env, { categoria: 'cartao_credito', cartao: 'card_a' });

  env.win.selecionarFatura('aberta');
  const naAberta = env.elementos.dataVencimento.value;
  env.win.selecionarFatura('fechada');
  const naFechada = env.elementos.dataVencimento.value;

  assert.match(naAberta, /^\d{4}-\d{2}-05$/, 'dia do vencimento do Cartão A');
  assert.match(naFechada, /^\d{4}-\d{2}-05$/);
  assert.ok(naFechada < naAberta, 'a fechada vence antes da aberta');
  // E é a MESMA data que a função pura devolve — a tela não recalcula por
  // conta própria.
  const cand = env.win.cartaoFaturasCandidatas(new Date(), 28, 5);
  const ymdPuro = (d) =>
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0');
  assert.equal(naFechada, ymdPuro(cand.fechada.vencimento));
  assert.equal(naAberta, ymdPuro(cand.aberta.vencimento));
});

test('trocar para cartão COM vencimento recalcula e volta a travar o campo', () => {
  const env = carregar({ futurorico_cartoes: JSON.stringify([CARTAO_COM_VENC, CARTAO_SEM_VENC]) });
  montarFormulario(env, { categoria: 'cartao_credito', cartao: 'card_padrao' });
  // Estado deixado por um cartão sem data: campo vazio e destravado.
  env.elementos.dataVencimento.readOnly = false;

  env.elementos.selectCartao.value = 'card_a';
  env.win.preencherVencimentoPorCartao();

  const v = env.elementos.dataVencimento.value;
  assert.match(v, /^\d{4}-\d{2}-05$/, 'dia do vencimento do Cartão A');
  assert.equal(env.elementos.dataVencimento.readOnly, true, 'volta a ser derivado do cartão');
});

test('cada troca de cartão reescreve a data — nunca fica a do cartão anterior', () => {
  const outro = { id: 'card_b', nome: 'Cartão B', diaFechamento: 12, diaVencimento: 20 };
  const env = carregar({ futurorico_cartoes: JSON.stringify([CARTAO_COM_VENC, outro]) });
  montarFormulario(env, { categoria: 'cartao_credito', cartao: 'card_a' });

  env.win.preencherVencimentoPorCartao();
  const doA = env.elementos.dataVencimento.value;
  env.elementos.selectCartao.value = 'card_b';
  env.win.preencherVencimentoPorCartao();
  const doB = env.elementos.dataVencimento.value;

  assert.match(doA, /-05$/);
  assert.match(doB, /-20$/);
  assert.notEqual(doA, doB);
});
