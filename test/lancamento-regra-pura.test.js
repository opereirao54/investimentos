'use strict';

// validarLancamento / criarLancamentos — a regra de lançamento sem DOM.
//
// Existem para que o formulário e o lançamento pelo Telegram passem pelo MESMO
// código. O que este arquivo prova:
//   1. o formulário (executarInsercao) produz exatamente o que criarLancamentos
//      produz com os mesmos dados — a extração não mudou comportamento;
//   2. criarLancamentos é pura: não grava, não mexe em `transacoes`;
//   3. idBase/agora tornam o resultado determinístico (o Telegram usa o id
//      fixo para não lançar duas vezes e para o "Desfazer");
//   4. validarLancamento devolve o código certo para cada recusa.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const HOJE = new Date();
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const EM_10_DIAS = ymd(new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate() + 10));

// Cada cenário: os campos do formulário e os `dados` equivalentes.
const CENARIOS = [
  {
    nome: 'despesa variável à vista',
    campos: { categoriaTransacao: 'despesa_variavel', bancoTransacao: 'Nubank' },
    dados: { categoria: 'despesa_variavel', banco: 'Nubank' },
  },
  {
    nome: 'despesa variável com vencimento futuro',
    campos: {
      categoriaTransacao: 'despesa_variavel',
      bancoTransacao: 'Nubank',
      dataVencimento: EM_10_DIAS,
    },
    dados: { categoria: 'despesa_variavel', banco: 'Nubank', dataVencimento: EM_10_DIAS },
  },
  {
    nome: 'despesa fixa recorrente',
    campos: { categoriaTransacao: 'despesa_fixa', bancoTransacao: 'Itaú', transacaoFixa: true },
    dados: { categoria: 'despesa_fixa', banco: 'Itaú', fixo: true },
  },
  {
    nome: 'receita',
    campos: { categoriaTransacao: 'receita', bancoTransacao: 'Itaú' },
    dados: { categoria: 'receita', banco: 'Itaú' },
  },
  {
    nome: 'cartão parcelado 3x',
    campos: {
      categoriaTransacao: 'cartao_credito',
      selectCartao: 'card_padrao',
      tipoCartaoSelecionado: 'parcelado',
      qtdParcelas: '3',
      dataVencimento: EM_10_DIAS,
    },
    dados: {
      categoria: 'cartao_credito',
      cartaoId: 'card_padrao',
      tipoCartao: 'parcelado',
      parcelas: 3,
      dataVencimento: EM_10_DIAS,
    },
  },
  {
    nome: 'cartão fixo mensal',
    campos: {
      categoriaTransacao: 'cartao_credito',
      selectCartao: 'card_padrao',
      tipoCartaoSelecionado: 'fixo',
      dataVencimento: EM_10_DIAS,
    },
    dados: {
      categoria: 'cartao_credito',
      cartaoId: 'card_padrao',
      tipoCartao: 'fixo',
      dataVencimento: EM_10_DIAS,
    },
  },
  {
    // O campo de tipo vem vazio quando o bloco do cartão nunca foi tocado.
    // Vazio NÃO é 'parcelado': o formulário sempre lançou uma parcela só.
    nome: 'cartão com tipo vazio',
    campos: {
      categoriaTransacao: 'cartao_credito',
      selectCartao: 'card_padrao',
      tipoCartaoSelecionado: '',
      qtdParcelas: '3',
    },
    dados: { categoria: 'cartao_credito', cartaoId: 'card_padrao', tipoCartao: '', parcelas: 3 },
  },
];

function camposBase(extra) {
  return Object.assign(
    {
      descTransacao: 'Compra',
      valorTransacao: '300,00',
      transacaoFixa: false,
      qtdParcelas: '1',
      dataVencimento: '',
      obsTransacao: '',
      tipoCartaoSelecionado: '',
      selectCartao: '',
      bancoTransacao: '',
      categoriaDespesa: '',
    },
    extra
  );
}

// Objetos da sandbox vm têm protótipos de outro realm; deepStrictEqual os
// recusaria mesmo com valores iguais.
const plano = (v) => JSON.parse(JSON.stringify(v));

// O que pode variar entre duas execuções sem ser comportamento.
function semRelogio(t) {
  const { id: _id, groupId, data: _data, ...resto } = t;
  return { ...resto, temGrupo: groupId != null };
}

for (const c of CENARIOS) {
  test(`formulário ≡ criarLancamentos: ${c.nome}`, () => {
    const win = carregarApp(camposBase(c.campos), ORDEM_CONTROLE);
    const antes = win.transacoes.length;
    win.executarInsercao();
    const doForm = win.transacoes.slice(antes);
    assert.ok(doForm.length > 0, 'o formulário deveria ter lançado');

    const puros = win.criarLancamentos(
      Object.assign(
        {
          descricao: 'Compra',
          valor: 300,
          obs: '',
          mesBase: win.visaoMes,
          anoBase: win.visaoAno,
          contaId: doForm[0].contaId,
          categoriaDespesa: doForm[0].categoriaDespesa,
        },
        c.dados
      )
    );
    assert.deepEqual(plano(puros.map(semRelogio)), plano(doForm.map(semRelogio)));
  });
}

test('criarLancamentos não grava nem mexe em transacoes', () => {
  const win = carregarApp(camposBase(), ORDEM_CONTROLE);
  const antes = win.transacoes.length;
  const salvoAntes = win.localStorage.getItem('futurorico_transacoes');
  const novos = win.criarLancamentos({
    descricao: 'Mercado',
    valor: 52.9,
    categoria: 'despesa_variavel',
    banco: 'Nubank',
    mesBase: 9,
    anoBase: 2026,
  });
  assert.equal(novos.length, 1);
  assert.equal(win.transacoes.length, antes);
  assert.equal(win.localStorage.getItem('futurorico_transacoes'), salvoAntes);
});

test('idBase e agora tornam o resultado determinístico', () => {
  const win = carregarApp(camposBase(), ORDEM_CONTROLE);
  const agora = new Date(2026, 9, 7, 12, 0, 0);
  const dados = {
    descricao: 'Tênis',
    valor: 300,
    categoria: 'cartao_credito',
    cartaoId: 'card_padrao',
    tipoCartao: 'parcelado',
    parcelas: 3,
    dataVencimento: '2026-11-10',
    mesBase: 9,
    anoBase: 2026,
    idBase: 'tg_42_',
    agora,
  };
  const a = win.criarLancamentos(dados);
  const b = win.criarLancamentos(dados);
  assert.deepEqual(a, b);
  assert.deepEqual(plano(a.map((t) => t.id)), ['tg_42_0', 'tg_42_1', 'tg_42_2']);
  assert.ok(a.every((t) => t.groupId === 'tg_42_' && t.data === agora.toISOString()));
  assert.deepEqual(
    plano(a.map((t) => [t.descricao, t.valor, t.mes, t.ano, t.dataVencimento, t.pago])),
    [
      ['Tênis (1/3)', 100, 10, 2026, '2026-11-10', false],
      ['Tênis (2/3)', 100, 11, 2026, '2026-12-10', false],
      ['Tênis (3/3)', 100, 0, 2027, '2027-01-10', false],
    ]
  );
});

test('lançamento de despesa variável respeita os invariantes de integração', () => {
  const win = carregarApp(camposBase(), ORDEM_CONTROLE);
  const conta = win.obterOuCriarContaPorNome('Nubank');
  const novos = win.criarLancamentos({
    descricao: 'Mercado',
    valor: 52.9,
    categoria: 'despesa_variavel',
    banco: 'Nubank',
    contaId: conta.id,
    mesBase: HOJE.getMonth(),
    anoBase: HOJE.getFullYear(),
  });
  assert.equal(novos[0].pago, true);
  assert.equal(novos[0].contaId, conta.id);
  const violacoes = validarEstado({
    transacoes: novos,
    contas: win.contas,
    cartoes: win.cartoes,
  });
  assert.deepEqual(plano(violacoes), []);
});

test('validarLancamento devolve o código de cada recusa', () => {
  const win = carregarApp(camposBase(), ORDEM_CONTROLE);
  const ok = { descricao: 'Mercado', valor: 10, categoria: 'despesa_variavel', banco: 'Nubank' };
  assert.equal(win.validarLancamento(ok), null);
  assert.equal(win.validarLancamento({ ...ok, descricao: '' }), 'dados_invalidos');
  assert.equal(win.validarLancamento({ ...ok, valor: 0 }), 'dados_invalidos');
  assert.equal(win.validarLancamento({ ...ok, valor: NaN }), 'dados_invalidos');
  assert.equal(win.validarLancamento({ ...ok, categoria: '' }), 'dados_invalidos');
  assert.equal(win.validarLancamento({ ...ok, banco: '' }), 'banco_obrigatorio');
  assert.equal(
    win.validarLancamento({ descricao: 'X', valor: 10, categoria: 'cartao_credito' }),
    'cartao_invalido'
  );
  assert.equal(
    win.validarLancamento({
      descricao: 'X',
      valor: 10,
      categoria: 'cartao_credito',
      cartaoId: '__novo__',
    }),
    'cartao_invalido'
  );
  assert.equal(
    win.validarLancamento({
      descricao: 'X',
      valor: 10,
      categoria: 'cartao_credito',
      cartaoId: 'card_padrao',
    }),
    null
  );
});
