'use strict';

// "✅ Já paguei" dos alertas do Telegram, do lado do app.
//
// O bot deixa {tipo:'pagar', alvos:[ids]} na caixa de entrada; o app dá a
// baixa por telegramPagar(), que usa marcarTransacaoPaga + efeitosDoPagamento
// — as mesmas funções do botão "Baixar" do Controle. O que se prova aqui:
//   1. a baixa pelo Telegram deixa a transação IGUAL à baixa pelo app
//      (conta pagadora do cartão — INV-17; aporte do sonho — INV-16);
//   2. repetir o item não duplica nada (o Telegram reentrega, dois aparelhos);
//   3. alvo que não é conta a pagar (receita, inexistente, já pago) é ignorado;
//   4. o Desfazer só desfaz o que o Telegram pagou, e nunca sonho/compromisso
//      (INV-18);
//   5. o estado continua são para o validador de invariantes.

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarMundo } = require('./_simulador.js');
const { estadoDe } = require('./_harness-integracao.js');
const { validarEstado, formatar } = require('../scripts/lib/invariantes.js');

function semCarimbo(t) {
  const c = Object.assign({}, t);
  delete c.pagoEm;
  delete c.pagoVia;
  return c;
}

function sao(s) {
  const v = validarEstado(estadoDe(s));
  assert.deepEqual(v, [], formatar(v));
}

const tx = (s, id) => s.transacoes.find((t) => t.id === id);

test('cartão: a baixa pelo Telegram é a mesma do botão do app (conta pagadora, INV-17)', () => {
  const a = criarMundo();
  const b = criarMundo();
  a.s.telegramAplicarItens([{ id: 'pagar_k1', tipo: 'pagar', alvos: ['sim_fatura'] }]);
  b.s.document.getElementById('input-pago-sim_fatura').value = '350,00';
  b.s.confirmarPagamento('sim_fatura');
  const ta = tx(a.s, 'sim_fatura');
  assert.equal(ta.pago, true);
  assert.equal(ta.contaId, a.ref.nubank.id, 'debita a conta pagadora do cartão');
  assert.equal(ta.pagoVia, 'telegram');
  assert.ok(ta.pagoEm);
  // Ids de conta são gerados por mundo; compara o resto.
  const sa = semCarimbo(ta);
  const sb = semCarimbo(tx(b.s, 'sim_fatura'));
  delete sa.contaId;
  delete sb.contaId;
  delete sa.data; // carimbo de quando cada mundo foi criado
  delete sb.data;
  assert.deepEqual(sa, sb);
  sao(a.s);
});

test('sonho: registra o aporte uma vez só, mesmo com o item repetido (INV-16)', () => {
  const { s, ref } = criarMundo();
  const parcela = s.transacoes.find((t) => t.categoria === 'sonho' && !t.pago);
  const antes = ref.sonho.valorAtual;
  const r = s.telegramAplicarItens([
    { id: 'pagar_k2', tipo: 'pagar', alvos: [parcela.id], criadoEmMs: 1 },
    { id: 'pagar_k2b', tipo: 'pagar', alvos: [parcela.id], criadoEmMs: 2 },
  ]);
  assert.equal(r.pagos, 1);
  assert.deepEqual([...r.confirmar], ['pagar_k2', 'pagar_k2b']);
  const sonho = s.sonhos.find((x) => x.id === ref.sonho.id);
  assert.equal(sonho.valorAtual, antes + parcela.valor);
  assert.equal(sonho.aportes.filter((a) => a.txId === parcela.id).length, 1);
  sao(s);
});

test('alvo que não é conta a pagar fica como está', () => {
  const { s, ref } = criarMundo();
  // Receita futura, ainda não recebida: tem vencimento e pago:false, mas é entrada.
  s.transacoes.push({
    id: 'rec_futura',
    categoria: 'receita',
    valor: 900,
    contaId: ref.nubank.id,
    mes: 9,
    ano: 2026,
    dataVencimento: '2099-01-01',
    pago: false,
  });
  const antes = JSON.stringify(s.transacoes);
  const r = s.telegramAplicarItens([
    {
      id: 'pagar_k3',
      tipo: 'pagar',
      alvos: ['sim_receita', 'rec_futura', 'nao_existe', 'tx_origem_9001'],
    },
    { id: 'pagar_k4', tipo: 'pagar', alvos: 'sim_fatura' }, // formato errado
  ]);
  assert.equal(r.pagos, 0);
  assert.equal(r.mudou, false);
  assert.equal(JSON.stringify(s.transacoes), antes);
  assert.deepEqual([...r.confirmar], ['pagar_k3', 'pagar_k4'], 'confirma para não travar a caixa');
});

test('Desfazer: volta a pagar só o que o Telegram pagou; sonho não (INV-18)', () => {
  const { s } = criarMundo();
  const parcela = s.transacoes.find((t) => t.categoria === 'sonho' && !t.pago);
  s.telegramAplicarItens([
    { id: 'pagar_a', tipo: 'pagar', alvos: ['sim_fatura', parcela.id], criadoEmMs: 1 },
  ]);
  s.telegramAplicarItens([
    { id: 'despagar_a', tipo: 'despagar', alvos: ['sim_fatura', parcela.id], criadoEmMs: 2 },
  ]);
  const f = tx(s, 'sim_fatura');
  assert.equal(f.pago, false);
  assert.equal(f.pagoEm, undefined);
  assert.equal(f.pagoVia, undefined);
  assert.equal(tx(s, parcela.id).pago, true, 'sonho gerou aporte: desfaz-se na aba Sonhos');
  sao(s);
});

test('Desfazer não mexe no que foi pago pelo app', () => {
  const { s } = criarMundo();
  s.document.getElementById('input-pago-sim_fatura').value = '350,00';
  s.confirmarPagamento('sim_fatura');
  s.telegramAplicarItens([{ id: 'despagar_b', tipo: 'despagar', alvos: ['sim_fatura'] }]);
  assert.equal(tx(s, 'sim_fatura').pago, true);
});

test('pagar e desfazer na mesma busca, na ordem em que foram feitos', () => {
  const { s } = criarMundo();
  const r = s.telegramAplicarItens([
    { id: 'despagar_c', tipo: 'despagar', alvos: ['sim_fatura'], criadoEmMs: 20 },
    { id: 'pagar_c', tipo: 'pagar', alvos: ['sim_fatura'], criadoEmMs: 10 },
  ]);
  assert.equal(tx(s, 'sim_fatura').pago, false);
  assert.deepEqual([...r.confirmar], ['pagar_c', 'despagar_c']);
});
