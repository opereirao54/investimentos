'use strict';

// "O pagamento de conta e os gastos, tanto no extrato como na aba Meu
// Patrimônio, deveriam constar a saída no dia do pagamento — hoje consta no dia
// do vencimento." E pior do que a data mostrada: a saída paga só descontava do
// saldo a partir do 1º dia do MÊS DA CONTA. Pagar hoje a conta de novembro
// deixava o saldo do banco no app intacto até 1º/11.
//
// O que este arquivo tranca:
//   1. saída paga sai do caixa no dia da baixa (pagoEm) — adiantada ou atrasada;
//   2. a projeção não desconta de novo o que já saiu (sem duplo débito);
//   3. o extrato do Meu Patrimônio data a saída pelo pagamento;
//   4. o extrato do Controle põe a conta no dia em que foi paga, se o pagamento
//      caiu no mês dela; senão fica no vencimento, com "Pago dd/mm";
//   5. o "Baixar" aceita o dia do pagamento (passado), nunca futuro;
//   6. a cópia do servidor (alertas do Telegram) calcula o mesmo saldo.

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado, formatar } = require('../scripts/lib/invariantes.js');

const HOJE = new Date();
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const diaDoMes = (deltaMes, dia) =>
  new Date(HOJE.getFullYear(), HOJE.getMonth() + deltaMes, dia, 12);

function mundo(fields) {
  const s = carregarApp(fields || {}, ORDEM_CONTROLE);
  const nu = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 1000 });
  return { s, nu };
}

function contaDoMes(s, nu, id, deltaMes, valor) {
  const v = diaDoMes(deltaMes, 15);
  const t = {
    id,
    descricao: 'Conta ' + id,
    categoria: 'despesa_fixa',
    valor,
    contaId: nu.id,
    banco: 'Nubank',
    mes: v.getMonth(),
    ano: v.getFullYear(),
    data: HOJE.toISOString(),
    dataVencimento: ymd(v),
    pago: false,
  };
  s.transacoes.push(t);
  return t;
}

const caixa = (s, nu, ms) => s.mpCalcularSaldoPorInstituicao(ms)[nu.id].caixa;
const sao = (s) => {
  const v = validarEstado(estadoDe(s));
  assert.deepEqual(v, [], formatar(v));
};

test('conta do mês que vem paga hoje sai do saldo HOJE, não no mês dela', () => {
  const fields = {};
  const { s, nu } = mundo(fields);
  const t = contaDoMes(s, nu, 'nov', 1, 300);
  fields['input-pago-nov'] = '300,00';
  s.confirmarPagamento('nov');
  assert.equal(t.pago, true);
  assert.equal(caixa(s, nu, Date.now()), 700, 'o dinheiro saiu hoje');
  sao(s);
});

test('a projeção não desconta de novo o que já foi pago adiantado', () => {
  const fields = {};
  const { s, nu } = mundo(fields);
  contaDoMes(s, nu, 'nov', 1, 300);
  fields['input-pago-nov'] = '300,00';
  s.confirmarPagamento('nov');
  const depoisDoVencimento = diaDoMes(1, 20).getTime();
  assert.equal(s.saldoCaixaPorConta(depoisDoVencimento)[nu.id], 700);
});

test('conta atrasada paga hoje: antes do pagamento o saldo ainda não tinha caído', () => {
  const { s, nu } = mundo();
  const t = contaDoMes(s, nu, 'set', -1, 200);
  s.marcarTransacaoPaga(t);
  const meioDoMesPassado = diaDoMes(-1, 20).getTime();
  assert.equal(caixa(s, nu, meioDoMesPassado), 1000, 'o dinheiro ainda estava lá');
  assert.equal(caixa(s, nu, Date.now()), 800);
});

test('o "Baixar" aceita o dia em que foi pago — passado vira meio-dia daquele dia', () => {
  const { s, nu } = mundo();
  const t = contaDoMes(s, nu, 'a', 0, 100);
  const ontem = new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate() - 1, 12);
  s.marcarTransacaoPaga(t, ymd(ontem));
  assert.equal(s.appliqueiDiaDoPagamento(t), ymd(ontem));
  assert.equal(new Date(t.pagoEm).getHours(), 12);

  const u = contaDoMes(s, nu, 'b', 0, 100);
  const amanha = new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate() + 1, 12);
  s.marcarTransacaoPaga(u, ymd(amanha));
  assert.equal(s.appliqueiDiaDoPagamento(u), ymd(HOJE), 'não se paga amanhã: vira agora');
});

test('confirmarPagamento recusa data de pagamento no futuro', () => {
  const fields = {};
  const { s, nu } = mundo(fields);
  const t = contaDoMes(s, nu, 'x', 0, 100);
  const amanha = new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate() + 1, 12);
  fields['input-pago-x'] = '100,00';
  fields['input-pago-dia-x'] = ymd(amanha);
  s.confirmarPagamento('x');
  assert.equal(t.pago, false);
});

test('extrato do Meu Patrimônio data a saída pelo pagamento', () => {
  const { s, nu } = mundo();
  const t = contaDoMes(s, nu, 'nov', 1, 300);
  s.marcarTransacaoPaga(t);
  assert.equal(ymd(new Date(s.mpDataMovimento(t))), ymd(HOJE));
  // Sem pagamento, continua o vencimento.
  const u = contaDoMes(s, nu, 'dez', 2, 50);
  assert.equal(ymd(new Date(s.mpDataMovimento(u))), u.dataVencimento);
});

test('extrato do Controle: dia do pagamento se caiu no mês da conta; senão o vencimento', () => {
  const { s, nu } = mundo();
  // Paga neste mês uma conta deste mês (vence dia 15).
  const t = contaDoMes(s, nu, 'este', 0, 100);
  const dia3 = new Date(HOJE.getFullYear(), HOJE.getMonth(), 3, 12);
  if (dia3 <= HOJE) {
    s.marcarTransacaoPaga(t, ymd(dia3));
    assert.equal(s.extratoDiaDe(t, t.mes, t.ano), ymd(dia3));
  }
  // Paga hoje a conta do mês que vem: fica no mês dela, no vencimento.
  const u = contaDoMes(s, nu, 'prox', 1, 100);
  s.marcarTransacaoPaga(u);
  assert.equal(s.extratoDiaDe(u, u.mes, u.ano), u.dataVencimento);
  // Lançamento antigo pago sem data de baixa: como sempre foi.
  const v = contaDoMes(s, nu, 'velho', 0, 100);
  v.pago = true;
  assert.equal(s.extratoDiaDe(v, v.mes, v.ano), v.dataVencimento);
});

test('a cópia do servidor (alertas do Telegram) calcula o mesmo saldo', () => {
  const C = require(path.resolve(__dirname, '..', 'api/_lib/telegram-consultas.js'));
  const fields = {};
  const { s, nu } = mundo(fields);
  contaDoMes(s, nu, 'nov', 1, 300);
  contaDoMes(s, nu, 'set', -1, 200);
  fields['input-pago-nov'] = '300,00';
  s.confirmarPagamento('nov');
  s.marcarTransacaoPaga(s.transacoes.find((t) => t.id === 'set'));
  const d = JSON.parse(JSON.stringify(estadoDe(s)));
  const agora = Date.now();
  for (const ms of [agora, diaDoMes(1, 20).getTime(), diaDoMes(-1, 20).getTime()]) {
    const app = s.saldoCaixaPorConta(ms)[nu.id];
    const srv = C.saldoCaixaPorConta(d, ms, agora)[nu.id];
    assert.equal(Math.round(srv * 100), Math.round(app * 100), new Date(ms).toISOString());
  }
});
