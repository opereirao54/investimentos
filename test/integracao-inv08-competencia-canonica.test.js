'use strict';

// INV-08 — mes/ano é a competência canônica.
//
// Toda a filtragem de tela do Controle usa t.mes/t.ano. `data` e
// `dataVencimento` são derivados.
//
// A REGRA: havendo dataVencimento, a competência é a DELE, em qualquer
// categoria. Sem vencimento informado, fica o mês em visão no momento do
// lançamento — não há de onde derivar.
//
// O porquê está na tela: o painel de Vencimentos filtra por mes/ano e desenha
// só o DIA do dataVencimento. Competência fora do mês do vencimento põe o card
// no mês errado exibindo um dia pelado, que se lê como daquele mês.
//
// Isto era o RISCO-03, agora resolvido: executarInsercao derivava a competência
// de visaoMes/visaoAno mesmo havendo vencimento, então um aluguel registrado em
// agosto com vencimento em 10/set nascia na competência de agosto — e numa
// despesa fixa recorrente cada parcela ficava um mês atrás do próprio
// vencimento, para sempre. A edição já derivava do vencimento, de modo que
// abrir e salvar sem mudar nada movia o lançamento de mês.
//
// Ver .claude/integracoes/mapa.json → INV-08.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

test('INV-08: transação sem mes/ano é acusada', () => {
  const v = validarEstado(
    { contas: [], transacoes: [{ id: 'x', categoria: 'despesa_fixa', valor: 10, banco: 'N' }] },
    { apenas: ['INV-08'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /sem competência/);
});

test('INV-08: despesa com competência atrás do vencimento é acusada', () => {
  // O bug do RISCO-03, reproduzido: competência agosto, vencimento 10/set.
  // No painel de agosto isto aparecia como um "10" pelado.
  const v = validarEstado(
    {
      contas: [],
      transacoes: [
        {
          id: 'x',
          categoria: 'despesa_fixa',
          valor: 1500,
          banco: 'Nubank',
          mes: 7,
          ano: 2026,
          dataVencimento: '2026-09-10',
        },
      ],
    },
    { apenas: ['INV-08'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /fora do mês do vencimento/);
});

test('INV-08: lançamento SEM vencimento não é acusado (não há de onde derivar)', () => {
  const v = validarEstado(
    {
      contas: [],
      transacoes: [
        { id: 'x', categoria: 'despesa_variavel', valor: 50, banco: 'Nubank', mes: 7, ano: 2026 },
      ],
    },
    { apenas: ['INV-08'] }
  );
  assert.equal(v.length, 0);
});

test('INV-08: cartão fora da fatura é acusado', () => {
  const v = validarEstado(
    {
      contas: [],
      transacoes: [
        {
          id: 'x',
          categoria: 'cartao_credito',
          valor: 300,
          cartaoId: 'c1',
          mes: 0, // janeiro
          ano: 2026,
          dataVencimento: '2026-03-15', // fatura de março
        },
      ],
    },
    { apenas: ['INV-08'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /fora do mês do vencimento/);
});

test('INV-08: série em passo passa; parcela deslocada é acusada', () => {
  // Com a regra (b) valendo para toda parcela, a série fica em passo por
  // construção — não é preciso checar o deslocamento parcela a parcela.
  const serie = [0, 1, 2].map((i) => ({
    id: 'p' + i,
    groupId: 'g1',
    categoria: 'despesa_fixa',
    valor: 100,
    banco: 'Nubank',
    mes: 8 + i,
    ano: 2026,
    dataVencimento: `2026-${String(9 + i).padStart(2, '0')}-10`,
  }));
  assert.equal(validarEstado({ contas: [], transacoes: serie }, { apenas: ['INV-08'] }).length, 0);

  // A terceira parcela teve a competência mexida sem mexer no vencimento.
  serie[2].mes = 7;
  const v = validarEstado({ contas: [], transacoes: serie }, { apenas: ['INV-08'] });
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /fora do mês do vencimento/);
});

test('INV-08: a inserção real deriva a competência do vencimento', () => {
  const proximoMes = new Date();
  proximoMes.setDate(1);
  proximoMes.setMonth(proximoMes.getMonth() + 1);
  const venc = `${proximoMes.getFullYear()}-${String(proximoMes.getMonth() + 1).padStart(2, '0')}-10`;

  const s = carregarApp(
    {
      descTransacao: 'Aluguel',
      valorTransacao: '1.500,00',
      categoriaTransacao: 'despesa_fixa',
      transacaoFixa: false,
      qtdParcelas: '1',
      dataVencimento: venc,
      obsTransacao: '',
      tipoCartaoSelecionado: '',
      selectCartao: '',
      bancoTransacao: 'Nubank',
      categoriaDespesaTransacao: 'moradia',
    },
    ORDEM_CONTROLE
  );
  s.executarInsercao();

  assert.equal(s.transacoes.length, 1);
  const t = s.transacoes[0];
  assert.equal(t.dataVencimento, venc, 'o vencimento é o que o usuário digitou');
  assert.equal(
    t.mes,
    proximoMes.getMonth(),
    'a competência segue o vencimento, não o mês em visão'
  );
  assert.equal(t.ano, proximoMes.getFullYear());
  assert.notEqual(
    t.mes,
    s.visaoMes,
    'o cenário tem de exercitar mesmo a diferença: o mês em visão não é o do vencimento'
  );
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-08: série recorrente real nasce em passo constante', () => {
  const s = carregarApp(
    {
      descTransacao: 'Internet',
      valorTransacao: '120,00',
      categoriaTransacao: 'despesa_fixa',
      transacaoFixa: true, // gera a série
      qtdParcelas: '1',
      dataVencimento: '2026-09-10',
      obsTransacao: '',
      tipoCartaoSelecionado: '',
      selectCartao: '',
      bancoTransacao: 'Nubank',
      categoriaDespesaTransacao: 'moradia',
    },
    ORDEM_CONTROLE
  );
  s.executarInsercao();

  assert.ok(s.transacoes.length > 1, 'despesa fixa gera série');
  assert.equal(
    validarEstado(estadoDe(s), { apenas: ['INV-08'] }).length,
    0,
    'todas as parcelas da série têm de estar em passo'
  );
});
