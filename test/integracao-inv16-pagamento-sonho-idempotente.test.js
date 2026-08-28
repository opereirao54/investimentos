'use strict';

// INV-16 — Pagar compromisso de sonho registra o aporte exatamente uma vez.
//
// É a CADEIA-01, a mais longa do app: um clique em "pagar" no Controle
// atravessa três módulos.
//
//   confirmarPagamento              marca pago:true, grava pagoEm
//   registrarAportePorPagamentoSonho cria sonho.aportes[] com txId, soma valorAtual
//   recálculo do plano              remove os futuros e regera com a parcela nova
//   caixa                           a conta de origem debita (INV-01)
//
// Duas formas de quebrar em silêncio: registrar o aporte duas vezes (o sonho
// sobe o dobro do que saiu da conta) e registrar o valor PLANEJADO em vez do
// valor efetivamente pago — o usuário pode editar o valor no ato.
//
// Ver .claude/integracoes/mapa.json → INV-16 e cadeiasDeEfeito CADEIA-01.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-sonhos.js']);
const HOJE = new Date();

function cenario(fields) {
  const s = carregarApp(fields || {}, ORDEM);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 50000 });
  const sonho = {
    id: 'sonho_1',
    nome: 'Viagem',
    valorTotal: 12000,
    valorAtual: 0,
    aportes: [],
    contaOrigemId: conta.id,
    prazoMeses: 12,
    mesesRestantes: 12,
    dataInicio: new Date(HOJE.getFullYear(), HOJE.getMonth(), 1).toISOString(),
  };
  s.sonhos = [sonho];
  s.gerarLancamentosMensaisSonho(sonho, 1000, 6);
  return { s, sonho, conta };
}

test('INV-16: pagar a parcela registra o aporte e soma no sonho', () => {
  const fields = {};
  const { s, sonho, conta } = cenario(fields);
  const parcela = s.transacoes.find((t) => t.categoria === 'sonho');
  fields['input-pago-' + parcela.id] = '1.000,00';

  s.confirmarPagamento(parcela.id);

  assert.equal(parcela.pago, true);
  assert.ok(parcela.pagoEm, 'o pagamento explícito é carimbado');
  assert.equal(sonho.aportes.length, 1, 'o aporte foi registrado no sonho');
  assert.equal(sonho.aportes[0].txId, parcela.id, 'ligado de volta à transação');
  assert.equal(sonho.valorAtual, 1000);

  // E o dinheiro saiu da conta de verdade.
  assert.equal(s.mpCalcularSaldoPorInstituicao(Date.now())[conta.id].caixa, 49000);
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-16: pagar duas vezes a mesma parcela não duplica o aporte', () => {
  const fields = {};
  const { s, sonho } = cenario(fields);
  const parcela = s.transacoes.find((t) => t.categoria === 'sonho');
  fields['input-pago-' + parcela.id] = '1.000,00';

  s.confirmarPagamento(parcela.id);
  s.confirmarPagamento(parcela.id); // duplo clique, re-render, o que for

  assert.equal(sonho.aportes.length, 1, 'a guarda por txId tem de segurar');
  assert.equal(sonho.valorAtual, 1000, 'o sonho não pode subir o dobro');
  assert.equal(validarEstado(estadoDe(s), { apenas: ['INV-16'] }).length, 0);
});

test('INV-16: o aporte espelha o valor EDITADO no ato do pagamento', () => {
  const fields = {};
  const { s, sonho, conta } = cenario(fields);
  const parcela = s.transacoes.find((t) => t.categoria === 'sonho');
  // O usuário conseguiu guardar só 700 este mês.
  fields['input-pago-' + parcela.id] = '700,00';

  s.confirmarPagamento(parcela.id);

  assert.equal(parcela.valor, 700, 'a transação passa a valer o que foi pago');
  assert.equal(sonho.aportes[0].valor, 700, 'e o aporte espelha o valor pago, não o planejado');
  assert.equal(sonho.valorAtual, 700);
  assert.equal(s.mpCalcularSaldoPorInstituicao(Date.now())[conta.id].caixa, 49300);
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-16: aporte em dobro para a mesma transação é acusado', () => {
  const v = validarEstado(
    {
      contas: [],
      transacoes: [
        {
          id: 'tx_1',
          categoria: 'sonho',
          sonhoId: 'sonho_1',
          valor: 1000,
          mes: 0,
          ano: 2026,
          pago: true,
          contaId: 'c1',
        },
      ],
      sonhos: [
        {
          id: 'sonho_1',
          nome: 'Viagem',
          valorAtual: 2000,
          aportes: [
            { id: 'a1', valor: 1000, txId: 'tx_1' },
            { id: 'a2', valor: 1000, txId: 'tx_1' },
          ],
        },
      ],
    },
    { apenas: ['INV-16'] }
  );
  assert.ok(v.some((x) => /mesma transação/.test(x.mensagem)));
  assert.ok(v.some((x) => x.gravidade === 'critica'));
});

test('INV-16: aporte com valor diferente do pago é acusado', () => {
  const v = validarEstado(
    {
      contas: [{ id: 'c1', nome: 'Nubank' }],
      transacoes: [
        {
          id: 'tx_1',
          categoria: 'sonho',
          sonhoId: 'sonho_1',
          valor: 700,
          mes: 0,
          ano: 2026,
          pago: true,
          contaId: 'c1',
        },
      ],
      sonhos: [
        {
          id: 'sonho_1',
          nome: 'Viagem',
          valorAtual: 1000,
          aportes: [{ id: 'a1', valor: 1000, txId: 'tx_1' }], // planejado, não pago
        },
      ],
    },
    { apenas: ['INV-16'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /valor EFETIVAMENTE pago/);
});
