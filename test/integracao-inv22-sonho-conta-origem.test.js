'use strict';

// INV-22 — Sonho tem conta de origem, e o compromisso a carrega.
//
// Era o RISCO-02. A categoria 'sonho' NÃO está em controleBancoObrigatorio — a
// trava do Controle não a cobre. Então um sonho sem conta de origem gerava
// parcelas com contaId indefinido que, ao serem pagas, caíam em "A reconciliar":
// o valor saía do total do patrimônio sem sair de nenhuma instituição, furando
// INV-01 pela porta dos fundos.
//
// A obrigatoriedade tem de viver no cadastro do sonho, porque não há rede
// nenhuma embaixo. Validada em dois pontos: irParaPreviaSonho (para o usuário
// não descobrir no fim) e salvarSonho (a trava que garante a invariante).
//
// Ver .claude/integracoes/mapa.json → INV-22 e riscosConhecidos RISCO-02.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-sonhos.js']);
const HOJE = new Date();

function camposSonho(extra) {
  return Object.assign(
    {
      sonhoNome: 'Viagem',
      sonhoValorTotal: '12.000,00',
      sonhoPrazo: '12',
      sonhoUnidadePrazo: 'meses',
      sonhoValorInicial: '',
      sonhoDescricao: '',
      sonhoContaOrigem: '',
      sonhoMesInicio: '',
      sonhoCategoria: 'viagem',
    },
    extra || {}
  );
}

test('INV-22: a prévia é bloqueada sem conta de origem', () => {
  const fields = camposSonho();
  const s = carregarApp(fields, ORDEM);
  s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 50000 });

  s.irParaPreviaSonho();

  assert.equal(s.__ultimoToast.tipo, 'erro');
  assert.match(s.__ultimoToast.msg, /conta de onde sai o dinheiro/i);
});

test('INV-22: sem NENHUMA conta cadastrada, a mensagem manda cadastrar', () => {
  const fields = camposSonho();
  const s = carregarApp(fields, ORDEM);
  s.contas = [];

  s.irParaPreviaSonho();

  assert.equal(s.__ultimoToast.tipo, 'erro');
  assert.match(s.__ultimoToast.msg, /Cadastre uma conta/i);
});

test('INV-22: a gravação é bloqueada sem conta de origem', () => {
  const fields = camposSonho();
  const s = carregarApp(fields, ORDEM);
  s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 50000 });

  s.salvarSonho();

  assert.equal(s.sonhos.length, 0, 'nenhum sonho pode ser gravado sem conta de origem');
  assert.equal(s.__ultimoToast.tipo, 'erro');
});

test('INV-22: com conta escolhida, o sonho grava e o compromisso a carrega', () => {
  const fields = camposSonho();
  const s = carregarApp(fields, ORDEM);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 50000 });
  fields.sonhoContaOrigem = conta.id;

  s.salvarSonho();

  assert.equal(s.sonhos.length, 1);
  const sonho = s.sonhos[0];
  assert.equal(sonho.contaOrigemId, conta.id, 'a conta fica gravada no sonho');

  // E o compromisso nasce carregando a conta — é o que faz a parcela debitar.
  s.gerarLancamentosMensaisSonho(sonho, 1000, 3);
  const compromissos = s.transacoes.filter((t) => t.categoria === 'sonho');
  assert.ok(compromissos.length > 0);
  for (const t of compromissos) {
    assert.equal(t.contaId, conta.id, 'cada parcela debita a conta de origem do sonho');
  }
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-22: pagar a parcela debita a instituição de verdade (não "A reconciliar")', () => {
  const fields = camposSonho();
  const s = carregarApp(fields, ORDEM);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 50000 });
  fields.sonhoContaOrigem = conta.id;
  s.salvarSonho();

  const sonho = s.sonhos[0];
  s.gerarLancamentosMensaisSonho(sonho, 1000, 3);
  const parcela = s.transacoes.find((t) => t.categoria === 'sonho');
  fields['input-pago-' + parcela.id] = '1.000,00';
  s.confirmarPagamento(parcela.id);

  const mapa = s.mpCalcularSaldoPorInstituicao(Date.now());
  assert.equal(mapa[conta.id].caixa, 49000, 'o caixa do Nubank desceu de verdade');
  assert.ok(!mapa['a-reconciliar'], 'nada pode cair em "A reconciliar"');
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-22: sonho sem conta de origem é acusado pelo validador', () => {
  const v = validarEstado(
    {
      contas: [{ id: 'c1', nome: 'Nubank' }],
      transacoes: [],
      sonhos: [{ id: 's1', nome: 'Viagem' }],
    },
    { apenas: ['INV-22'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /sem conta de origem/);
  assert.equal(v[0].gravidade, 'critica');
});

test('INV-22: sonho apontando para conta inexistente é acusado', () => {
  const v = validarEstado(
    {
      contas: [{ id: 'c1', nome: 'Nubank' }],
      transacoes: [],
      sonhos: [{ id: 's1', nome: 'Viagem', contaOrigemId: 'conta_apagada' }],
    },
    { apenas: ['INV-22'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /não existe/);
});

test('INV-22: compromisso divergindo da conta do sonho é acusado', () => {
  const v = validarEstado(
    {
      contas: [
        { id: 'c1', nome: 'Nubank' },
        { id: 'c2', nome: 'Outro' },
      ],
      transacoes: [
        {
          id: 't1',
          categoria: 'sonho',
          sonhoId: 's1',
          valor: 1000,
          contaId: 'c2',
          mes: 0,
          ano: 2026,
          pago: false,
        },
      ],
      sonhos: [{ id: 's1', nome: 'Viagem', contaOrigemId: 'c1' }],
    },
    { apenas: ['INV-22'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /mas o sonho debita a conta c1/);
});
