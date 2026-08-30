'use strict';

// INV-06 — Resgate credita a conta de destino.
//
// O caminho inverso do aporte: a venda/resgate CREDITA o caixa de uma conta.
// Duas coisas podem quebrar em silêncio:
//   1. a conta de destino não ser resolvida → o dinheiro entra no total do
//      patrimônio mas não aparece em banco nenhum;
//   2. o valor creditado ser o BRUTO quando houve IR retido na fonte (RF,
//      reserva, previdência) → o usuário vê mais dinheiro do que recebeu.
//
// A regra do código (renda-fixa.js): credita o LÍQUIDO em `valor`, preserva o
// bruto em `valorBruto` e o imposto em `irRetido`.
//
// Ver .claude/integracoes/mapa.json → INV-06.

const test = require('node:test');
const assert = require('node:assert/strict');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const HOJE = new Date();
const CONTAS = [{ id: 'conta_1', nome: 'Nubank', tipo: 'banco', arquivada: false }];

function resgate(extra) {
  return Object.assign(
    {
      id: '90',
      operacaoId: 90,
      descricao: 'Resgate: CDB',
      valor: 1000,
      categoria: 'resgate_investimento',
      banco: 'Nubank',
      contaId: 'conta_1',
      mes: HOJE.getMonth(),
      ano: HOJE.getFullYear(),
      pago: true,
    },
    extra || {}
  );
}

test('INV-06: resgate com conta de destino é válido', () => {
  assert.equal(validarEstado({ contas: CONTAS, transacoes: [resgate()] }).length, 0);
});

test('INV-06: resgate sem conta de destino é acusado', () => {
  const v = validarEstado(
    { contas: CONTAS, transacoes: [resgate({ contaId: undefined, banco: undefined })] },
    { apenas: ['INV-06'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /sem conta de destino/);
});

test('INV-06: resgate com IR credita o LÍQUIDO, não o bruto', () => {
  // Correto: bruto 1000, IR 150, credita 850.
  const ok = validarEstado(
    { contas: CONTAS, transacoes: [resgate({ valor: 850, valorBruto: 1000, irRetido: 150 })] },
    { apenas: ['INV-06'] }
  );
  assert.equal(ok.length, 0);

  // Errado: creditou o bruto e ainda assim registrou o IR.
  const ruim = validarEstado(
    { contas: CONTAS, transacoes: [resgate({ valor: 1000, valorBruto: 1000, irRetido: 150 })] },
    { apenas: ['INV-06'] }
  );
  assert.equal(ruim.length, 1);
  assert.match(ruim[0].mensagem, /credita 1000.*bruto 1000.*IR 150/);
});

test('INV-06: IR registrado sem o bruto impede auditoria', () => {
  const v = validarEstado(
    { contas: CONTAS, transacoes: [resgate({ valor: 850, irRetido: 150 })] },
    { apenas: ['INV-06'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /sem valorBruto/);
});

test('INV-06: resgate sem retenção (renda variável) não precisa de bruto', () => {
  assert.equal(
    validarEstado({ contas: CONTAS, transacoes: [resgate()] }, { apenas: ['INV-06'] }).length,
    0
  );
});
