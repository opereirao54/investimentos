'use strict';

// Edição de operação em "Meus investimentos" — "ele não traz os dados da compra
// para editar".
//
// Cinco defeitos reproduzidos no fluxo antigo, cada um travado por um teste:
//
//  1. `editarOperacao(${op.id})` era interpolado SEM aspas e o find usava `===`.
//     Depois de uma volta pela nuvem o id volta como string: número no onclick
//     vs string no array = "Operação não encontrada".
//  2. O drawer focava o ticker ao abrir; o blur disparava preencherPrecoAutomatico,
//     que sobrescrevia o preço PAGO pela cotação de hoje.
//  3. A conta de origem não era restaurada. Confirmar batia em "escolha a conta
//     de onde o dinheiro sai" — a edição não salvava de jeito nenhum.
//  4. A operação era removida ao ABRIR o drawer. Fechar sem confirmar apagava a
//     compra para sempre.
//  5. A remoção pegava só a perna do ativo; a perna de caixa (tx_origem_) ficava
//     órfã, mantendo o saldo debitado por uma compra que já não existia (INV-04).

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

function campos(extra) {
  return Object.assign(
    {
      compraTicker: 'PETR4',
      tipoOperacao: 'compra',
      compraCategoria: 'renda_variavel',
      compraCorretora: 'Rico',
      compraData: '',
      compraVencimento: '',
      compraRentabilidade: '',
      compraQtd: '10',
      compraPreco: '100,00',
      compraSubcategoria: 'acoes',
      compraOrigemRecurso: '',
      compraOrigemBanco: '',
      compraDestinoRecurso: '',
      prevSaldoInicial: '',
      prevRecorrente: false,
      prevDiaRecorrencia: '',
      prevDuracaoAnos: '',
      prevTaxaMensal: '',
      compraTotalOp: '',
    },
    extra || {}
  );
}

// Monta um app com 5.000 no Nubank e uma compra de 10 × R$ 100 já registrada.
function comCompraRegistrada(extra) {
  const fields = campos(extra);
  const s = carregarApp(fields);
  s.abrirDrawerOperacao = () => {};
  s.calcularTotalCompra = () => {};
  s.atualizarProjecaoForm = () => {};

  const ontem = new Date(Date.now() - 86400000);
  s.transacoes.push({
    id: 'r1',
    categoria: 'receita',
    valor: 5000,
    banco: 'Nubank',
    data: ontem.toISOString(),
    mes: ontem.getMonth(),
    ano: ontem.getFullYear(),
    pago: false,
  });
  const nubank = s.criarConta({ nome: 'Nubank', tipo: 'banco' });
  fields.compraOrigemRecurso = nubank.id;
  s.registrarOperacaoAtivo();
  return { s, fields, nubank, op: s.historicoCompras[0] };
}

test('editar traz ticker, quantidade, preço pago, data e corretora de volta ao formulário', () => {
  const { s, fields, op } = comCompraRegistrada();
  // A cotação de hoje é bem diferente do preço pago — é o que sobrescrevia.
  s.mockAtivosMercado = [{ ticker: 'PETR4', nome: 'Petrobras', preco_atual: 42.5, tipo: 'acao' }];

  s.editarOperacao(op.id);

  assert.equal(fields.compraTicker, 'PETR4');
  assert.equal(fields.compraQtd, '10');
  assert.equal(fields.compraPreco, '100,00', 'traz o PREÇO PAGO, não a cotação de hoje');
  assert.equal(fields.compraCorretora, 'Rico');
  assert.equal(fields.compraCategoria, 'renda_variavel');
  assert.equal(fields.compraData, op.data_op.slice(0, 10));
});

test('editar encontra a operação mesmo com o id em string (volta da nuvem)', () => {
  const { s, op } = comCompraRegistrada();
  s.editarOperacao(String(op.id));
  assert.notEqual(s.__ultimoToast.tipo, 'erro', s.__ultimoToast.msg);
  assert.equal(s.operacaoEmEdicaoId, op.id);
});

test('o blur no ticker não sobrescreve o preço pago durante a edição', () => {
  const { s, fields, op } = comCompraRegistrada();
  s.mockAtivosMercado = [{ ticker: 'PETR4', nome: 'Petrobras', preco_atual: 42.5, tipo: 'acao' }];
  s.editarOperacao(op.id);

  s.preencherPrecoAutomatico(); // é o que o onblur do campo dispara

  assert.equal(fields.compraPreco, '100,00', 'o preço histórico permanece');
});

test('numa compra NOVA a cotação continua sendo preenchida sozinha', () => {
  const fields = campos({ compraPreco: '' });
  const s = carregarApp(fields);
  s.mockAtivosMercado = [{ ticker: 'PETR4', nome: 'Petrobras', preco_atual: 42.5, tipo: 'acao' }];
  s.calcularTotalCompra = () => {};

  s.preencherPrecoAutomatico();

  assert.equal(fields.compraPreco, '42,50');
});

test('editar restaura a conta de origem — sem isso o Confirmar não salvava', () => {
  const { s, fields, nubank, op } = comCompraRegistrada();
  s.editarOperacao(op.id);
  assert.equal(fields.compraOrigemRecurso, nubank.id);
});

test('abrir a edição não apaga nada — desistir no meio preserva a operação', () => {
  const { s, op } = comCompraRegistrada();
  const saldoAntes = s.mpCalcularSaldoTotal(Date.now());

  s.editarOperacao(op.id);
  assert.equal(s.historicoCompras.length, 1, 'a operação continua registrada durante a edição');
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), saldoAntes, 'e o saldo não oscila');

  // O harness troca fecharDrawerOperacao por um noop (ele mexe em DOM que não
  // existe aqui), então a saída do modo é exercitada pela função que ele chama.
  s.encerrarModoEdicaoOperacao();
  assert.equal(s.historicoCompras.length, 1, 'desistir não perde a compra');
  assert.equal(s.operacaoEmEdicaoId, null, 'e sai do modo edição');
  assert.deepEqual(validarEstado(estadoDe(s)), []);
});

test('trocar Compra↔Venda no meio da edição abandona a edição em vez de sequestrá-la', () => {
  const { s, op } = comCompraRegistrada();
  s.editarOperacao(op.id);
  assert.equal(s.operacaoEmEdicaoId, op.id);

  // O toggle zera o formulário; continuar "editando" gravaria a operação nova
  // por cima da antiga sem que o usuário tenha pedido isso.
  s.alternarTipoOperacao('venda');

  assert.equal(s.operacaoEmEdicaoId, null);
  assert.equal(s.historicoCompras.length, 1, 'a compra original segue de pé');
});

test('confirmar a edição substitui a operação e as DUAS pernas — sem órfã, sem duplo débito', () => {
  const { s, fields, nubank, op } = comCompraRegistrada();
  s.editarOperacao(op.id);
  fields.compraQtd = '20'; // 10 → 20 unidades

  s.registrarOperacaoAtivo();

  assert.equal(s.historicoCompras.length, 1, 'uma operação, não duas');
  assert.equal(s.historicoCompras[0].quantidade, 20);

  const pernasCaixa = s.transacoes.filter((t) => t.categoria === 'transferencia_saida');
  assert.equal(pernasCaixa.length, 1, 'uma única perna de caixa');
  assert.equal(pernasCaixa[0].valor, 2000);
  assert.equal(pernasCaixa[0].contaId, nubank.id);
  assert.equal(
    s.transacoes.filter((t) => String(t.id) === 'tx_origem_' + op.id).length,
    0,
    'a perna de caixa antiga foi embora junto com a operação antiga'
  );
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 3000, '5000 − 2000, debitado uma vez só');
  assert.deepEqual(validarEstado(estadoDe(s)), []);
});

test('editar para um valor maior não é barrado pelo saldo que a própria operação consumiu', () => {
  // Saldo 5000, compra de 1000 → sobram 4000. Editar para 4500 tem de passar:
  // ao confirmar, os 1000 antigos voltam ao caixa.
  const { s, fields, op } = comCompraRegistrada();
  s.editarOperacao(op.id);
  fields.compraQtd = '45'; // 45 × 100 = 4500

  s.registrarOperacaoAtivo();

  assert.equal(s.__ultimoToast.tipo, 'sucesso', s.__ultimoToast.msg);
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 500);
  assert.deepEqual(validarEstado(estadoDe(s)), []);
});

test('editar acima do saldo real continua bloqueado — e a operação original sobrevive', () => {
  const { s, fields, op } = comCompraRegistrada();
  s.editarOperacao(op.id);
  fields.compraQtd = '80'; // 8000 > 5000 mesmo devolvendo os 1000

  s.registrarOperacaoAtivo();

  assert.equal(s.__ultimoToast.tipo, 'erro');
  assert.equal(s.historicoCompras.length, 1, 'a versão antiga não foi apagada');
  assert.equal(s.historicoCompras[0].id, op.id);
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 4000, 'saldo intacto');
  assert.deepEqual(validarEstado(estadoDe(s)), []);
});

test('excluir operação funciona com id em string e leva as duas pernas', () => {
  const { s, op } = comCompraRegistrada();
  s.fecharModal = () => {};
  s.atualizarTelaControle = () => {};

  s.confirmarExclusaoOperacao(String(op.id));

  assert.equal(s.historicoCompras.length, 0);
  assert.equal(s.transacoes.filter((t) => t.operacaoId != null).length, 0);
  assert.equal(
    s.transacoes.filter((t) => String(t.id).startsWith('tx_origem_')).length,
    0,
    'nenhuma perna de caixa órfã (INV-04)'
  );
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 5000, 'o débito é devolvido');
  assert.deepEqual(validarEstado(estadoDe(s)), []);
});

test('editar operação retroativa devolve a origem "retroativo" e segue sem tocar no caixa', () => {
  const fields = campos({
    compraTicker: 'BRASILPREV VGBL',
    compraCategoria: 'previdencia',
    compraCorretora: 'Brasilprev',
    compraPreco: '10.000,00',
    compraData: '2019-03-01',
    compraOrigemRecurso: '__retroativo__',
    prevTaxaMensal: '0,80',
  });
  const s = carregarApp(fields);
  s.abrirDrawerOperacao = () => {};
  s.calcularTotalCompra = () => {};
  s.atualizarProjecaoForm = () => {};
  s.registrarOperacaoAtivo();
  const op = s.historicoCompras[0];

  s.editarOperacao(op.id);
  assert.equal(fields.compraOrigemRecurso, '__retroativo__');
  assert.equal(fields.compraPreco, '10.000,00');

  fields.compraPreco = '12.000,00';
  s.registrarOperacaoAtivo();

  assert.equal(s.historicoCompras.length, 1);
  assert.equal(s.historicoCompras[0].preco_op, 12000);
  assert.equal(s.transacoes.length, 0, 'edição de retroativo continua fora do Controle');
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 0);
});
