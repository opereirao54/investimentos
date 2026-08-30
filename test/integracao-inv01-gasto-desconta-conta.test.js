'use strict';

// INV-01 — Todo gasto pago desconta de uma conta identificável.
//
// É a invariante que o usuário enunciou como "tudo o que se gasta desconta de
// uma conta no Meu Patrimônio". A ligação entre a transação e a instituição é
// `contaId` (com fallback textual `banco` → nome/alias), resolvida por
// resolverContaDeTransacao e agrupada por mpChaveInstTransacao.
//
// Quando ela quebra NADA falha: mpCalcularSaldoPorInstituicao joga o valor num
// bucket "A reconciliar". O total do patrimônio cai certo, o saldo do banco não
// mexe, e a queixa que chega é "gastei e o saldo do banco não mudou".
//
// Ver .claude/integracoes/mapa.json → INV-01.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe } = require('./_harness-integracao.js');
const { validarEstado, assertSemViolacoes } = require('../scripts/lib/invariantes.js');

const ONTEM = new Date(Date.now() - 86400000).toISOString();

function comSalario(s, nomeConta, valor) {
  const conta = s.criarConta({ nome: nomeConta, tipo: 'banco' });
  s.transacoes.push({
    id: 'rec1',
    categoria: 'receita',
    valor,
    banco: nomeConta,
    contaId: conta.id,
    mes: new Date().getMonth(),
    ano: new Date().getFullYear(),
    data: ONTEM,
    pago: false,
  });
  return conta;
}

test('INV-01: despesa paga com contaId debita o caixa daquela instituição', () => {
  const s = carregarApp();
  const nubank = comSalario(s, 'Nubank', 5000);
  s.transacoes.push({
    id: 'desp1',
    categoria: 'despesa_variavel',
    valor: 200,
    banco: 'Nubank',
    contaId: nubank.id,
    mes: new Date().getMonth(),
    ano: new Date().getFullYear(),
    data: ONTEM,
    pago: true,
  });

  const mapa = s.mpCalcularSaldoPorInstituicao(Date.now());
  assert.equal(mapa[nubank.id].caixa, 4800, 'caixa do Nubank = 5000 - 200');
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 4800);
  assert.ok(!mapa['a-reconciliar'], 'nada pode cair em "A reconciliar"');
  assertSemViolacoes(assert, estadoDe(s));
});

test('INV-01: despesa paga só com `banco` (sem contaId) ainda resolve por nome', () => {
  const s = carregarApp();
  const nubank = comSalario(s, 'Nubank', 5000);
  // Registro legado: tem o texto livre, não tem o id.
  s.transacoes.push({
    id: 'desp_legado',
    categoria: 'despesa_fixa',
    valor: 300,
    banco: 'nubank ', // grafia diferente de propósito
    mes: new Date().getMonth(),
    ano: new Date().getFullYear(),
    data: ONTEM,
    pago: true,
  });

  const conta = s.resolverContaDeTransacao(s.transacoes[1]);
  assert.equal(conta && conta.id, nubank.id, 'resolve por nome normalizado');
  const mapa = s.mpCalcularSaldoPorInstituicao(Date.now());
  assert.equal(mapa[nubank.id].caixa, 4700);
  assertSemViolacoes(assert, estadoDe(s));
});

test('INV-01: despesa paga SEM conta cai em "A reconciliar" — e o validador acusa', () => {
  const s = carregarApp();
  const nubank = comSalario(s, 'Nubank', 5000);
  s.transacoes.push({
    id: 'desp_orfa',
    categoria: 'despesa_variavel',
    valor: 200,
    mes: new Date().getMonth(),
    ano: new Date().getFullYear(),
    data: ONTEM,
    pago: true,
  });

  // O sintoma real, reproduzido: o total cai, o banco não mexe.
  const mapa = s.mpCalcularSaldoPorInstituicao(Date.now());
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 4800, 'o total desconta');
  assert.equal(mapa[nubank.id].caixa, 5000, 'mas o Nubank fica intacto — o sintoma');
  assert.ok(mapa['a-reconciliar'], 'o valor foi para o bucket de reconciliação');

  // E a trava pega.
  const v = validarEstado(estadoDe(s), { apenas: ['INV-01'] });
  assert.equal(v.length, 1, 'o validador tem de acusar exatamente esta violação');
  assert.match(v[0].mensagem, /sem conta resolvível/);
  assert.equal(v[0].gravidade, 'critica');
});

test('INV-01: despesa PENDENTE (pago:false) sem conta não é violação', () => {
  const s = carregarApp();
  comSalario(s, 'Nubank', 5000);
  // Compromisso a vencer: ainda não saiu dinheiro de lugar nenhum.
  s.transacoes.push({
    id: 'desp_futura',
    categoria: 'cartao_credito',
    valor: 400,
    mes: new Date().getMonth(),
    ano: new Date().getFullYear(),
    data: ONTEM,
    pago: false,
  });
  assertSemViolacoes(assert, estadoDe(s), { apenas: ['INV-01'] });
});

test('INV-01: entrada de caixa sem conta não dispara INV-01 (é INV-02 que cobre)', () => {
  const s = carregarApp();
  s.transacoes.push({
    id: 'div1',
    categoria: 'dividendo',
    valor: 50,
    mes: new Date().getMonth(),
    ano: new Date().getFullYear(),
    data: ONTEM,
    pago: true,
  });
  assertSemViolacoes(assert, estadoDe(s), { apenas: ['INV-01'] });
});

// A regra original supunha que toda saída sai de ALGUMA instituição. Isso é
// verdade para gasto e para aporte feito de dentro do app — não para o aporte
// externo, terceiro caso já reconhecido em INV-03 como padrão C-sem-perna:
// dinheiro que nunca passou por conta cadastrada. Sem a isenção, o validador
// acusaria o comportamento CORRETO e empurraria para uma "correção" que
// inventaria uma conta que não existe.
test('INV-01: parcela de aporte EXTERNO paga não é violação — nunca esteve em conta', () => {
  const s = carregarApp();
  s.transacoes.push({
    id: 'tx_compromisso_ext_1',
    compromissoId: 'op_ext',
    compromissoCategoria: 'previdencia',
    categoria: 'investimento_fixo',
    descricao: 'Previdência: BRASILPREV',
    valor: 500,
    origemExterna: true,
    mes: new Date().getMonth(),
    ano: new Date().getFullYear(),
    data: ONTEM,
    pago: true,
  });
  assertSemViolacoes(assert, estadoDe(s), { apenas: ['INV-01'] });
});

test('INV-01: a isenção é só para quem tem a marca — sem ela, continua acusando', () => {
  // Prova que a trava não foi relaxada: a mesma parcela SEM origemExterna
  // continua sendo violação. Sem este teste, a isenção poderia estar aberta
  // demais e ninguém veria.
  const s = carregarApp();
  s.transacoes.push({
    id: 'tx_compromisso_semmarca_1',
    compromissoId: 'op_x',
    compromissoCategoria: 'previdencia',
    categoria: 'investimento_fixo',
    descricao: 'Previdência: SEM MARCA',
    valor: 500,
    mes: new Date().getMonth(),
    ano: new Date().getFullYear(),
    data: ONTEM,
    pago: true,
  });
  const v = validarEstado(estadoDe(s), { apenas: ['INV-01'] });
  assert.equal(v.length, 1, 'aporte pago sem conta e sem marca continua caindo em "A reconciliar"');
});

test('INV-01: a marca não isenta uma DESPESA — ela vale para aporte, não para gasto', () => {
  // origemExterna descreve dinheiro que nunca passou por conta cadastrada num
  // APORTE. Uma despesa paga saiu de algum lugar, sempre: aceitar a marca ali
  // abriria um buraco por onde qualquer gasto escaparia da trava.
  const s = carregarApp();
  s.transacoes.push({
    id: 'desp_ext',
    categoria: 'despesa_fixa',
    descricao: 'Aluguel',
    valor: 2000,
    origemExterna: true,
    mes: new Date().getMonth(),
    ano: new Date().getFullYear(),
    data: ONTEM,
    pago: true,
  });
  const v = validarEstado(estadoDe(s), { apenas: ['INV-01'] });
  assert.equal(v.length, 1, 'despesa paga não pode escapar da trava por causa da marca');
});
