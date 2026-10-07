'use strict';

// INV-25 — Id de transação é único.
//
// O lançamento pelo Telegram é idempotente PORQUE o id é fixo: o servidor
// reentrega itens da caixa de entrada quando a confirmação se perde, e dois
// aparelhos abertos leem a mesma caixa. Duplicata = gasto dobrado.
//
// Prova as duas metades: (1) o fluxo real, entregando o mesmo item de novo,
// não duplica; (2) o validador ACUSA quando há id repetido.
//
// Ver .claude/integracoes/mapa.json → INV-25.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-telegram.js']);
const hoje = new Date();
const HOJE = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

function estado(win) {
  return { transacoes: win.transacoes, contas: win.contas, cartoes: win.cartoes };
}

test('INV-25: o mesmo item do Telegram entregue três vezes, em ordens diferentes, não duplica', () => {
  const win = carregarApp({}, ORDEM);
  win.contas.push({ id: 'c1', nome: 'Itaú', tipo: 'banco', principal: true });
  win.cartoes.length = 0;
  win.cartoes.push({ id: 'card_x', nome: 'X', diaFechamento: 5, diaVencimento: 12 });
  const lanc = {
    categoria: 'cartao_credito',
    valor: 90,
    descricao: 'Fone',
    dataCompra: HOJE,
    parcelas: 3,
    tipoCartao: 'parcelado',
    cartaoId: 'card_x',
  };
  const a = { id: 'tg9_1', tipo: 'lancamento', criadoEmMs: 1, lanc };
  const b = {
    id: 'tg9_2',
    tipo: 'lancamento',
    criadoEmMs: 2,
    lanc: { ...lanc, descricao: 'Capa' },
  };
  win.telegramAplicarItens([a]);
  win.telegramAplicarItens([b, a]); // confirmação de `a` perdida
  win.telegramAplicarItens([a, b]); // segundo aparelho
  assert.equal(win.transacoes.length, 6, '3 parcelas de cada, nenhuma a mais');
  const v = validarEstado(estado(win), { apenas: ['INV-25'] });
  assert.equal(v.length, 0);
});

test('INV-25: o validador acusa id repetido', () => {
  const t = {
    id: 'tg9_1_0',
    categoria: 'despesa_variavel',
    valor: 10,
    descricao: 'X',
    mes: 0,
    ano: 2026,
    pago: false,
  };
  const v = validarEstado({ transacoes: [t, { ...t }] }, { apenas: ['INV-25'] });
  assert.equal(v.length, 1);
  assert.equal(v[0].inv, 'INV-25');
  assert.match(v[0].mensagem, /tg9_1_0/);
});
