'use strict';

// INV-10 — Compromisso pendente não sobrevive ao sonho.
//
// A integração que o usuário enunciou como "criar um sonho pode criar uma
// entrada no controle financeiro": gerarLancamentosMensaisSonho grava N
// transações com categoria 'sonho' e sonhoId apontando de volta.
//
// A REGRA INGÊNUA ESTARIA ERRADA. "Todo sonhoId aponta para um sonho que
// existe" reprovaria um fluxo legítimo: ao excluir um sonho, o modal oferece
// DUAS saídas, e as duas são corretas —
//
//   "Excluir tudo"        → apaga o sonho E todas as tx vinculadas
//   "Manter histórico"    → apaga o sonho e só os compromissos FUTUROS e NÃO
//                           PAGOS; as pagas ficam no Controle como registro de
//                           que aquele dinheiro saiu de verdade
//
// O que distingue órfão de histórico é o campo `pago`.
//
// Ver .claude/integracoes/mapa.json → INV-10 e entidades.sonho.regrasDeExclusao.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-sonhos.js']);
const HOJE = new Date();

function comSonho(s, extra) {
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 10000 });
  const sonho = Object.assign(
    {
      id: 'sonho_1',
      nome: 'Viagem',
      valorTotal: 12000,
      valorAtual: 0,
      aportes: [],
      contaOrigemId: conta.id,
      prazoMeses: 12,
      mesesRestantes: 12,
      dataInicio: new Date(HOJE.getFullYear(), HOJE.getMonth(), 1).toISOString(),
    },
    extra || {}
  );
  s.sonhos = [sonho];
  return { sonho, conta };
}

test('INV-10: criar o plano do sonho gera compromissos ligados de volta ao sonho', () => {
  const s = carregarApp({}, ORDEM);
  const { sonho, conta } = comSonho(s);

  const criados = s.gerarLancamentosMensaisSonho(sonho, 1000, 6);
  assert.ok(criados > 0, 'a integração Sonho → Controle tem de criar lançamentos');

  const doSonho = s.transacoes.filter((t) => t.categoria === 'sonho');
  assert.equal(doSonho.length, criados);
  for (const t of doSonho) {
    assert.equal(t.sonhoId, sonho.id, 'cada compromisso aponta de volta para o sonho');
    assert.equal(t.contaId, conta.id, 'e carrega a conta de origem do sonho');
    assert.equal(t.groupId, 'sonho_grp_' + sonho.id, 'todos na mesma série');
    assert.equal(t.pago, false, 'compromisso nasce pendente');
  }
  assert.equal(sonho.groupIdControle, 'sonho_grp_' + sonho.id, 'o groupId fica gravado no sonho');
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-10: "excluir tudo" não deixa rastro', () => {
  const s = carregarApp({}, ORDEM);
  const { sonho } = comSonho(s);
  s.gerarLancamentosMensaisSonho(sonho, 1000, 6);
  // Uma parcela já paga, para provar que esta saída leva as pagas também.
  s.transacoes[0].pago = true;

  s.confirmarExcluirSonhoCompleto(sonho.id);

  assert.equal(s.sonhos.length, 0);
  assert.equal(
    s.transacoes.filter((t) => t.sonhoId === sonho.id).length,
    0,
    'nenhuma transação do sonho pode sobrar'
  );
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-10: "manter histórico" tira os pendentes futuros e preserva os pagos', () => {
  const s = carregarApp({}, ORDEM);
  const { sonho } = comSonho(s);
  s.gerarLancamentosMensaisSonho(sonho, 1000, 6);

  // O usuário pagou a primeira parcela.
  const paga = s.transacoes[0];
  paga.pago = true;
  const pendentesAntes = s.transacoes.filter((t) => t.sonhoId === sonho.id && !t.pago).length;
  assert.ok(pendentesAntes > 0);

  s.confirmarExcluirSonho(sonho.id);

  assert.equal(s.sonhos.length, 0, 'o sonho foi removido');
  const restantes = s.transacoes.filter((t) => t.sonhoId === sonho.id);
  assert.ok(
    restantes.every((t) => t.pago),
    'só podem sobrar lançamentos PAGOS — o histórico que o usuário escolheu manter'
  );
  assert.ok(restantes.length > 0, 'o histórico pago tem de sobreviver');

  // E isso NÃO é violação: histórico pago com sonho apagado é intencional.
  assert.equal(
    validarEstado(estadoDe(s), { apenas: ['INV-10'] }).length,
    0,
    'transação PAGA com sonhoId inexistente é histórico, não órfã'
  );
});

test('INV-10: compromisso PENDENTE sobrevivendo ao sonho é acusado', () => {
  const v = validarEstado(
    {
      sonhos: [],
      contas: [{ id: 'conta_1', nome: 'Nubank', arquivada: false }],
      transacoes: [
        {
          id: 'tx_1',
          categoria: 'sonho',
          sonhoId: 'sonho_apagado',
          valor: 1000,
          contaId: 'conta_1',
          mes: HOJE.getMonth(),
          ano: HOJE.getFullYear(),
          pago: false,
        },
      ],
    },
    { apenas: ['INV-10'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /pendente órfão/);
  assert.match(v[0].mensagem, /sonho_apagado/);
});
