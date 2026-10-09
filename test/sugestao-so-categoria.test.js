'use strict';

// O caminho do relato, pelo lado da DATA.
//
// "Descrição diversos → sugeriu cartão → usei → tive que mudar para despesa →
// a data ficou com o vencimento do cartão, do mês que vem → lancei sem ver e
// demorei para achar o lançamento."
//
// A sugestão já não troca o tipo (test/sugestao-ordem-preenchimento.test.js).
// Mas a armadilha de fundo existe sem ela: escolher Cartão, depois Saída,
// carregava o vencimento da fatura para a despesa. Aqui se tranca:
//   1. sair do cartão num lançamento NOVO limpa a data que a fatura pôs;
//   2. na edição, a data guardada no lançamento fica;
//   3. data digitada à mão (campo não travado) também fica;
//   4. lançamento salvo fora do mês corrente diz para onde foi.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

/** O app com nós de formulário persistentes (o harness cria um nó por chamada). */
function app(fields) {
  const s = carregarApp(fields, ORDEM_CONTROLE);
  const orig = s.document.getElementById;
  const nos = {};
  s.document.getElementById = (id) => nos[id] || (nos[id] = orig(id));
  return { s, nos };
}

test('cartão → saída num lançamento novo: a data da fatura não fica na despesa', () => {
  const fields = { categoriaTransacao: 'despesa_variavel', editTransacaoId: '' };
  const { s, nos } = app(fields);
  const venc = s.document.getElementById('dataVencimento');
  // O estado que preencherVencimentoPorCartao deixa: vencimento da fatura,
  // campo travado.
  venc.value = '2026-11-10';
  venc.readOnly = true;
  s.verificarRegraCartao();
  assert.equal(fields.dataVencimento, '', 'a data da fatura vazou para a despesa');
  assert.equal(nos.dataVencimento.readOnly, false);
});

test('na edição, a data guardada no lançamento fica', () => {
  const fields = { categoriaTransacao: 'despesa_variavel', editTransacaoId: 't1' };
  const { s } = app(fields);
  const venc = s.document.getElementById('dataVencimento');
  venc.value = '2026-11-10';
  venc.readOnly = true;
  s.verificarRegraCartao();
  assert.equal(fields.dataVencimento, '2026-11-10');
});

test('data digitada à mão continua lá ao trocar o tipo', () => {
  const fields = { categoriaTransacao: 'despesa_fixa', editTransacaoId: '' };
  const { s } = app(fields);
  const venc = s.document.getElementById('dataVencimento');
  venc.value = '2026-12-05';
  venc.readOnly = false;
  s.verificarRegraCartao();
  assert.equal(fields.dataVencimento, '2026-12-05');
});

test('despesa salva fora do mês corrente: o aviso diz o mês', () => {
  const { s } = app({});
  const hoje = new Date(2026, 9, 8);
  assert.equal(
    s.mensagemLancamentoSalvo('despesa_variavel', '2026-11-10', 1, hoje),
    'Lançado em novembro/2026 — vence em 10/11.'
  );
  assert.equal(
    s.mensagemLancamentoSalvo('despesa_variavel', '2026-10-20', 1, hoje),
    'Lançamento salvo com sucesso!'
  );
  assert.equal(
    s.mensagemLancamentoSalvo('despesa_variavel', '', 1, hoje),
    'Lançamento salvo com sucesso!'
  );
  // Cartão continua com a mensagem da fatura.
  assert.match(s.mensagemLancamentoSalvo('cartao_credito', '2026-11-10', 1, hoje), /fatura/);
});
