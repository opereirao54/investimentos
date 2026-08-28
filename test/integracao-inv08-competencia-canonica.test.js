'use strict';

// INV-08 — mes/ano é a competência canônica.
//
// Toda a filtragem de tela do Controle usa t.mes/t.ano. `data` e
// `dataVencimento` são derivados.
//
// ATENÇÃO À REGRA REAL — a leitura ingênua ("mes/ano têm de bater com
// dataVencimento") está ERRADA e quebra o fluxo normal de despesa fixa.
// São TRÊS caminhos com TRÊS origens de competência:
//
//   executarInsercao        → visaoMes/visaoAno (o mês que o usuário está vendo)
//   salvarEdicaoTransacao   → competenciaDaData(dataVencimento)
//   cartao_credito          → sobrescreve com o mês da FATURA
//
// Registrar em agosto um aluguel que vence em 10/set é legítimo: competência
// agosto, vencimento setembro. O que NÃO é legítimo é o cartão cair fora da
// fatura, ou uma parcela sair de passo com as irmãs da mesma série.
//
// (A divergência entre inserção e edição está registrada como RISCO-03 no mapa
// — é decisão de produto pendente, não bug declarado.)
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

test('INV-08: despesa com vencimento em outro mês é LEGÍTIMA (não é violação)', () => {
  // Registrei em agosto (competência 7) o aluguel que vence em 10 de setembro.
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
  assert.equal(v.length, 0, 'competência ≠ vencimento é o fluxo normal de despesa fixa');
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
  assert.match(v[0].mensagem, /fora da fatura/);
});

test('INV-08: parcela fora de passo na série é acusada', () => {
  const serie = [0, 1, 2].map((i) => ({
    id: 'p' + i,
    groupId: 'g1',
    categoria: 'despesa_fixa',
    valor: 100,
    banco: 'Nubank',
    mes: 7 + i,
    ano: 2026,
    dataVencimento: `2026-${String(8 + i + 1).padStart(2, '0')}-10`,
  }));
  assert.equal(validarEstado({ contas: [], transacoes: serie }, { apenas: ['INV-08'] }).length, 0);

  // A terceira parcela teve a competência mexida sem mexer no vencimento.
  serie[2].mes = 7;
  const v = validarEstado({ contas: [], transacoes: serie }, { apenas: ['INV-08'] });
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /fora de passo/);
});

test('INV-08: a inserção real grava competência e vencimento coerentes entre si', () => {
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
  assert.equal(typeof t.mes, 'number', 'a competência existe');
  assert.equal(typeof t.ano, 'number');
  // A competência é a do mês em VISÃO (documenta o comportamento atual — ver RISCO-03).
  assert.equal(t.mes, s.visaoMes, 'competência = mês em visão, não o do vencimento');
  assert.equal(t.ano, s.visaoAno);
  // E o registro nasce válido perante todas as invariantes da Onda 1.
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
