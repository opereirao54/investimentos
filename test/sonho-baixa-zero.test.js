'use strict';

// Baixa de parcela de sonho com R$ 0 no Controle.
//
// Antes: a parcela virava "paga" com R$ 0,00, o sonho ganhava um "aporte" de
// R$ 0,00 no histórico e as próximas parcelas ficavam iguais — o plano deixava
// de fechar no prazo sem ninguém avisar (12 mil em 12 meses: sobravam 11 × 956,76).
// Agora o R$ 0 não baixa: abre o "Pular este mês", que tira a parcela e
// redistribui a falta nos meses que restam, mantendo o prazo.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-sonhos.js']);
const H = new Date();

function cenario() {
  const fields = {};
  const s = carregarApp(fields, ORDEM);
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
    planoVinculado: true,
    dataFim: new Date(H.getFullYear(), H.getMonth() + 12, 15).toISOString(),
    dataInicio: new Date(H.getFullYear(), H.getMonth(), 1).toISOString(),
  };
  s.sonhos = [sonho];
  const mensal = s.calcSonhoMensal(12000, 0, 12);
  s.gerarLancamentosMensaisSonho(sonho, mensal, 12);
  sonho.aporteMensalPlano = mensal;
  const parcelas = () =>
    s.transacoes
      .filter((t) => t.categoria === 'sonho' && !t.pago)
      .sort((a, b) => a.ano - b.ano || a.mes - b.mes);
  return { s, sonho, fields, mensal, parcelas };
}

const doMes = (t, d) => t.mes === d.getMonth() && t.ano === d.getFullYear();

test('baixa de R$ 0 na parcela do mês não registra pagamento nem aporte de R$ 0', () => {
  const { s, sonho, fields, parcelas } = cenario();
  const p = parcelas().find((t) => doMes(t, H));
  fields['input-pago-' + p.id] = '0,00';
  const chamadas = [];
  s.pularMesSonho = (id, txId) => chamadas.push([id, txId]);

  s.confirmarPagamento(p.id);

  assert.equal(p.pago, false, 'continua a pagar');
  assert.equal(sonho.aportes.length, 0, 'nenhum aporte de R$ 0,00 no histórico');
  assert.deepEqual(chamadas, [[sonho.id, p.id]], 'oferece o "Pular este mês" desta parcela');
});

test('confirmando o "Pular este mês", a falta vai para as próximas parcelas no mesmo prazo', () => {
  const { s, sonho, fields, mensal, parcelas } = cenario();
  const p = parcelas().find((t) => doMes(t, H));
  fields['input-pago-' + p.id] = '0,00';
  s.confirmarPagamento(p.id);
  assert.equal(p.pago, false);

  s.confirmarPularMes(sonho.id, p.id);

  const resto = parcelas();
  assert.equal(resto.length, 11, 'a parcela deste mês saiu');
  assert.ok(!resto.some((t) => doMes(t, H)));
  assert.ok(resto[0].valor > mensal, 'a próxima parcela sobe');
  // O plano conta com o rendimento do guardado (calcSonhoMensal): a projeção
  // das 11 parcelas novas fecha os 12 mil; as antigas não fechariam.
  const fecha = s.calcSonhoProjecao(0, resto[0].valor, 11);
  assert.ok(fecha >= 12000 - 1, `as 11 parcelas fecham o sonho (${fecha.toFixed(2)})`);
  assert.ok(s.calcSonhoProjecao(0, mensal, 11) < 12000 - 1, 'sem redistribuir, não fecharia');
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('parcela atrasada com R$ 0: sai só ela e a deste mês continua, recalculada', () => {
  const { s, sonho, fields, parcelas } = cenario();
  const passado = new Date(H.getFullYear(), H.getMonth() - 1, 15);
  const atrasada = parcelas().find((t) => doMes(t, H));
  atrasada.mes = passado.getMonth();
  atrasada.ano = passado.getFullYear();
  fields['input-pago-' + atrasada.id] = '0,00';

  s.confirmarPagamento(atrasada.id);
  assert.equal(atrasada.pago, false);
  s.confirmarPularMes(sonho.id, atrasada.id);

  assert.ok(!s.transacoes.some((t) => t.id === atrasada.id), 'a atrasada saiu');
  assert.ok(
    parcelas().some((t) => doMes(t, H)),
    'a parcela deste mês continua no Controle'
  );
  assert.equal(sonho.mesesPulados || 0, 0, 'pular atrasada não encurta o calendário');
});

test('parcela futura com R$ 0 não baixa nem pula: só avisa', () => {
  const { s, sonho, fields, parcelas } = cenario();
  const prox = new Date(H.getFullYear(), H.getMonth() + 1, 15);
  const futura = parcelas().find((t) => doMes(t, prox));
  const antes = parcelas().length;
  fields['input-pago-' + futura.id] = '0,00';

  s.confirmarPagamento(futura.id);

  assert.equal(futura.pago, false);
  assert.equal(parcelas().length, antes);
  assert.equal(sonho.aportes.length, 0);
});

test('botão "Pular mês": aparece na parcela do mês e na atrasada, não na futura nem na paga', () => {
  const { s, sonho, parcelas } = cenario();
  const atual = parcelas().find((t) => doMes(t, H));
  const prox = new Date(H.getFullYear(), H.getMonth() + 1, 15);
  const futura = parcelas().find((t) => doMes(t, prox));
  assert.equal(s.controlePodePularSonho(atual), true);
  assert.equal(s.controlePodePularSonho(futura), false, 'mês futuro: ainda não');
  const passado = new Date(H.getFullYear(), H.getMonth() - 1, 15);
  futura.mes = passado.getMonth();
  futura.ano = passado.getFullYear();
  assert.equal(s.controlePodePularSonho(futura), true, 'atrasada pode');
  assert.equal(s.controlePodePularSonho({ ...atual, pago: true }), false, 'paga não');
  sonho.planoVinculado = false;
  assert.equal(s.controlePodePularSonho(atual), false, 'sonho sem plano no Controle não');
});

test('clicar em "Pular mês" abre o pular daquela parcela, sem passar pelo R$ 0', () => {
  const { s, sonho, parcelas } = cenario();
  const atual = parcelas().find((t) => doMes(t, H));
  const chamadas = [];
  s.pularMesSonho = (id, txId) => chamadas.push([id, txId]);
  s.pularParcelaSonho(atual.id);
  assert.deepEqual(chamadas, [[sonho.id, atual.id]]);
  assert.equal(atual.pago, false);
});
