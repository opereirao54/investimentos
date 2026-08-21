'use strict';

// Cadastro de imóvel: CEP, área/m², tipo e estimativa por referência de m².
//
// Dois pontos que já quebraram uma vez e por isso têm teste próprio:
//
//  1. TROCAR O TIPO PRECISA LIMPAR O BLOCO. editarBem aplica o patch campo a
//     campo; se `imovel` não for tratado com `!== undefined`, passar null é
//     ignorado e um veículo fica com CEP e área de imóvel pendurados.
//  2. A BUSCA DE CEP NÃO PODE TRAVAR O CADASTRO. ViaCEP e BrasilAPI são
//     serviços de terceiros; fora do ar, o usuário tem de conseguir salvar
//     assim mesmo.

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
  'web/appliquei-bens.js',
];

function makeDeadNode(extra) {
  const node = Object.assign(
    {
      style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      dataset: {},
      children: [],
      options: [],
      appendChild() {},
      removeChild() {},
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
      disabled: false,
    },
    extra || {}
  );
  return node;
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

function carregar(dados, opts) {
  opts = opts || {};
  const localStorage = makeStorage();
  Object.keys(dados || {}).forEach((k) => localStorage.setItem(k, dados[k]));
  const elementos = {};
  const toasts = [];
  const urlsChamadas = [];

  const win = {
    location: { hostname: 'localhost', pathname: '/app', search: '', hash: '' },
    navigator: { userAgent: 'node-test' },
    document: {
      readyState: 'complete',
      documentElement: makeDeadNode(),
      body: makeDeadNode(),
      head: makeDeadNode(),
      getElementById: (id) => elementos[id] || makeDeadNode(),
      querySelector: () => elementos.__card || makeDeadNode(),
      querySelectorAll: () => [],
      createElement: () => makeDeadNode(),
      addEventListener() {},
    },
    localStorage,
    sessionStorage: makeStorage(),
    matchMedia: () => ({ matches: false }),
    Chart: Object.assign(function () {}, {
      register() {},
      defaults: { font: {}, plugins: {}, scales: {} },
    }),
    ChartDataLabels: {},
    fetch: (url) => {
      urlsChamadas.push(url);
      return opts.fetch ? opts.fetch(url) : Promise.reject(new Error('sem rede'));
    },
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener() {},
    removeEventListener() {},
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;

  const ctx = vm.createContext(win);
  for (const f of LOAD_ORDER) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  win.mostrarToast = (msg, tipo) => toasts.push({ msg, tipo });
  win.renderMeuPatrimonio = () => {};

  return { win, localStorage, elementos, toasts, urlsChamadas };
}

const bensSalvos = (env) => JSON.parse(env.localStorage.getItem('appliquei_bens') || '[]');

// Monta os campos do modal com os valores informados.
function montarModal(env, campos) {
  campos = campos || {};
  const set = (id, value) => {
    env.elementos[id] = makeDeadNode({ value: String(value == null ? '' : value) });
  };
  set('bemEditId', campos.editId || '');
  set('bemNome', campos.nome || 'Apartamento');
  set('bemTipo', campos.tipo || 'imovel');
  set('bemDescricao', campos.descricao || '');
  set('bemCep', campos.cep || '');
  set('bemImovelTipo', campos.tipoImovel || 'apartamento');
  set('bemAreaM2', campos.area || '');
  set('bemValorM2', campos.valorM2 || '');
  set('bemValorAtual', campos.valorAtual || '');
  set('bemValorCompra', campos.valorCompra || '');
  set('bemDataCompra', campos.dataCompra || '');
  [
    'bemPasso1',
    'bemPasso2',
    'bemAcoesPasso1',
    'bemAcoesPasso2',
    'bemImovelWrap',
    'bemFipeWrap',
    'bemEnderecoInfo',
    'bemEstimativaM2',
    'bemFipeInfo',
    'modalBem',
    'listaBens',
    'bemFipeVeiculoTipo',
    'bemFipeMarca',
    'bemFipeModelo',
    'bemFipeAno',
  ].forEach((id) => {
    env.elementos[id] = makeDeadNode();
  });
  env.elementos.tituloModalBem = makeDeadNode();
  env.elementos.tituloModalBem.querySelector = () => makeDeadNode();
}

const respostaViaCep = {
  cep: '01310-100',
  logradouro: 'Avenida Paulista',
  bairro: 'Bela Vista',
  localidade: 'São Paulo',
  uf: 'SP',
};
const okJson = (d) => Promise.resolve({ ok: true, json: () => Promise.resolve(d) });

// ---- campos do imóvel --------------------------------------------------

test('salva CEP, área, tipo e referência de m² no bem', () => {
  const env = carregar({});
  montarModal(env, {
    nome: 'Apto Paulista',
    tipo: 'imovel',
    cep: '01310-100',
    area: '72',
    valorM2: '12.000,00',
    tipoImovel: 'apartamento',
    valorAtual: '950.000,00',
  });

  env.win.salvarFormBem();

  const b = bensSalvos(env)[0];
  assert.equal(b.tipo, 'imovel');
  assert.equal(b.valorAtual, 950000);
  assert.equal(b.imovel.cep, '01310100', 'o CEP é guardado só com dígitos');
  assert.equal(b.imovel.areaM2, 72);
  assert.equal(b.imovel.tipoImovel, 'apartamento');
  assert.equal(b.imovel.valorM2, 12000);
});

test('área com vírgula é aceita', () => {
  const env = carregar({});
  montarModal(env, { tipo: 'imovel', area: '72,5' });
  env.win.salvarFormBem();
  assert.equal(bensSalvos(env)[0].imovel.areaM2, 72.5);
});

test('veículo não guarda bloco de imóvel', () => {
  const env = carregar({});
  montarModal(env, { nome: 'Civic', tipo: 'veiculo', cep: '01310-100', area: '72' });
  env.win.salvarFormBem();
  assert.equal(bensSalvos(env)[0].imovel, null);
});

test('imóvel só com o tipo escolhido não guarda campos vazios como lixo', () => {
  // O select de tipo do imóvel sempre tem valor, então o bloco existe — mas o
  // que não foi preenchido tem de virar null, não string vazia ou NaN.
  const env = carregar({});
  montarModal(env, { tipo: 'imovel', cep: '', area: '', valorM2: '' });

  env.win.salvarFormBem();

  const im = bensSalvos(env)[0].imovel;
  assert.equal(im.tipoImovel, 'apartamento');
  assert.equal(im.cep, null);
  assert.equal(im.areaM2, null);
  assert.equal(im.valorM2, null);
});

test('TROCAR imóvel para veículo LIMPA os dados de imóvel', () => {
  // editarBem aplica o patch campo a campo: sem tratar `imovel` com
  // `!== undefined`, passar null é ignorado e o bloco fica pendurado.
  const env = carregar({
    appliquei_bens: JSON.stringify([
      {
        id: 'b1',
        nome: 'Apto',
        tipo: 'imovel',
        valorAtual: 500000,
        valorCompra: 0,
        descricao: '',
        fipe: null,
        arquivado: false,
        imovel: {
          cep: '01310100',
          areaM2: 72,
          tipoImovel: 'apartamento',
          valorM2: 12000,
          endereco: null,
        },
      },
    ]),
  });
  montarModal(env, { editId: 'b1', nome: 'Civic', tipo: 'veiculo' });

  env.win.salvarFormBem();

  assert.equal(bensSalvos(env)[0].imovel, null, 'veículo não pode ficar com CEP e área');
  assert.equal(bensSalvos(env)[0].tipo, 'veiculo');
});

test('editar um imóvel mantendo o tipo preserva os dados', () => {
  const env = carregar({
    appliquei_bens: JSON.stringify([
      {
        id: 'b1',
        nome: 'Apto',
        tipo: 'imovel',
        valorAtual: 500000,
        valorCompra: 0,
        descricao: '',
        fipe: null,
        arquivado: false,
        imovel: {
          cep: '01310100',
          areaM2: 72,
          tipoImovel: 'apartamento',
          valorM2: 12000,
          endereco: null,
        },
      },
    ]),
  });
  montarModal(env, {
    editId: 'b1',
    nome: 'Apto reformado',
    tipo: 'imovel',
    cep: '01310-100',
    area: '80',
    tipoImovel: 'apartamento',
    valorM2: '13.000,00',
    valorAtual: '1.040.000,00',
  });

  env.win.salvarFormBem();

  const b = bensSalvos(env)[0];
  assert.equal(b.nome, 'Apto reformado');
  assert.equal(b.imovel.areaM2, 80);
  assert.equal(b.imovel.valorM2, 13000);
});

// ---- máscara e busca de CEP -------------------------------------------

test('máscara do CEP', () => {
  const env = carregar({});
  const campo = makeDeadNode({ value: '01310100' });
  env.win.bemMascaraCep(campo);
  assert.equal(campo.value, '01310-100');
  campo.value = '013';
  env.win.bemMascaraCep(campo);
  assert.equal(campo.value, '013', 'não põe hífen antes da hora');
  campo.value = 'abc01310100999';
  env.win.bemMascaraCep(campo);
  assert.equal(campo.value, '01310-100', 'descarta letras e o que passa de 8 dígitos');
});

test('CEP válido consulta o ViaCEP e mostra o endereço', async () => {
  const env = carregar({}, { fetch: () => okJson(respostaViaCep) });
  montarModal(env, { cep: '01310-100' });

  env.win.buscarCepBem();
  await new Promise((r) => setImmediate(r));

  assert.match(env.urlsChamadas[0], /viacep\.com\.br/);
  assert.match(env.elementos.bemEnderecoInfo.innerHTML, /Avenida Paulista/);
  assert.match(env.elementos.bemEnderecoInfo.innerHTML, /São Paulo/);
});

test('ViaCEP fora do ar cai para a BrasilAPI', async () => {
  const env = carregar(
    {},
    {
      fetch: (url) =>
        /viacep/.test(url)
          ? Promise.reject(new Error('offline'))
          : okJson({
              street: 'Rua da Assembleia',
              neighborhood: 'Centro',
              city: 'Rio de Janeiro',
              state: 'RJ',
            }),
    }
  );
  montarModal(env, { cep: '20011-001' });

  env.win.buscarCepBem();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(env.urlsChamadas.length, 2);
  assert.match(env.urlsChamadas[1], /brasilapi/);
  assert.match(env.elementos.bemEnderecoInfo.innerHTML, /Rua da Assembleia/);
});

test('as duas APIs fora do ar avisam sem travar o cadastro', async () => {
  const env = carregar({}, { fetch: () => Promise.reject(new Error('offline')) });
  montarModal(env, { cep: '20011-001', tipo: 'imovel', nome: 'Casa', area: '90' });

  env.win.buscarCepBem();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.match(env.elementos.bemEnderecoInfo.innerHTML, /não consegui consultar o cep/i);
  // E o cadastro continua possível.
  env.win.salvarFormBem();
  assert.equal(bensSalvos(env).length, 1);
  assert.equal(bensSalvos(env)[0].imovel.areaM2, 90);
});

test('CEP incompleto nem chega a chamar a API', () => {
  const env = carregar({});
  montarModal(env, { cep: '013' });
  env.win.buscarCepBem();
  assert.equal(env.urlsChamadas.length, 0);
  assert.match(env.elementos.bemEnderecoInfo.innerHTML, /incompleto/i);
});

test('CEP repetido usa cache em vez de nova chamada', async () => {
  const env = carregar({}, { fetch: () => okJson(respostaViaCep) });
  montarModal(env, { cep: '01310-100' });

  env.win.buscarCepBem();
  await new Promise((r) => setImmediate(r));
  env.win.buscarCepBem();
  await new Promise((r) => setImmediate(r));

  assert.equal(env.urlsChamadas.length, 1);
});

// ---- estimativa por m² -------------------------------------------------

test('estimativa por m² e comparação com o valor cadastrado', () => {
  const env = carregar({});
  montarModal(env, { area: '72', valorM2: '12.000,00', valorAtual: '950.000,00' });

  env.win.bemEstimarPorM2();

  const html = env.elementos.bemEstimativaM2.innerHTML;
  assert.match(html, /864\.000,00/, '72 × 12.000 = 864.000');
  assert.match(html, /10% <\/strong>?acima|10%.*acima/, 'compara com o valor cadastrado');
});

test('estimativa não aparece sem área ou sem referência', () => {
  const env = carregar({});
  montarModal(env, { area: '72', valorM2: '' });
  env.win.bemEstimarPorM2();
  assert.equal(env.elementos.bemEstimativaM2.style.display, 'none');

  montarModal(env, { area: '', valorM2: '12.000,00' });
  env.win.bemEstimarPorM2();
  assert.equal(env.elementos.bemEstimativaM2.style.display, 'none');
});

test('sem valor cadastrado, mostra só a estimativa (sem comparação)', () => {
  const env = carregar({});
  montarModal(env, { area: '50', valorM2: '10.000,00', valorAtual: '' });
  env.win.bemEstimarPorM2();
  const html = env.elementos.bemEstimativaM2.innerHTML;
  assert.match(html, /500\.000,00/);
  assert.ok(!/acima|abaixo/.test(html));
});
