'use strict';

// Cadastro retroativo e aporte externo — "Meus investimentos".
//
// O apontamento: quem chega à Appliquei com patrimônio já formado (R$ 10.000
// numa previdência aberta em 2019) não conseguia cadastrá-lo. O formulário
// exigia uma conta COM SALDO de onde o dinheiro saísse, e esse dinheiro saiu da
// conta anos atrás — o cadastro travava em "Escolha a conta de onde o dinheiro
// sai" para todo mundo que não tivesse caixa sobrando hoje.
//
// A regra do produto, que estes testes travam:
//   · operação retroativa NÃO impacta o saldo atual das contas;
//   · o investimento entra no patrimônio normalmente;
//   · o banco/corretora segue obrigatório, mas só IDENTIFICA a instituição —
//     não exige que o dinheiro esteja lá em caixa hoje;
//   · aporte novo feito dentro do app continua seguindo a regra normal
//     (conta de origem → saída de dinheiro → investimento).
//
// "Aporte externo" é o irmão do retroativo: compra de hoje, com dinheiro que
// nunca passou por conta cadastrada. Também não debita caixa.

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

function app(fields) {
  const s = carregarApp(fields);
  // Stubs de UI que o drawer toca e o DOM falso não tem.
  s.abrirDrawerOperacao = () => {};
  s.calcularTotalCompra = () => {};
  s.atualizarProjecaoForm = () => {};
  return s;
}

const semViolacoes = (s) => validarEstado(estadoDe(s)).map((v) => `${v.inv}: ${v.mensagem}`);

test('retroativo: previdência de R$ 10.000 entra no patrimônio sem conta nenhuma cadastrada', () => {
  const f = campos({
    compraTicker: 'BRASILPREV VGBL',
    compraCategoria: 'previdencia',
    compraCorretora: 'Brasilprev',
    compraPreco: '10.000,00',
    compraData: '2019-03-01',
    compraOrigemRecurso: '__retroativo__',
    prevTaxaMensal: '0,80',
  });
  const s = app(f);
  // Cenário do apontamento: nenhuma conta, nenhum saldo. Antes travava aqui.
  s.registrarOperacaoAtivo();

  assert.equal(s.__ultimoToast.tipo, 'sucesso', s.__ultimoToast.msg);
  assert.equal(s.historicoCompras.length, 1, 'a posição entra na carteira');
  assert.equal(s.transacoes.length, 0, 'e NÃO gera lançamento no Controle Financeiro');
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 0, 'nenhum saldo em conta foi debitado');

  const op = s.historicoCompras[0];
  assert.equal(op.origemRecurso, 'retroativo');
  assert.equal(op.corretora, 'Brasilprev', 'a instituição fica registrada como origem do ativo');
  assert.equal(op.data_op.slice(0, 10), '2019-03-01', 'a data de início informada é preservada');
  assert.deepEqual(semViolacoes(s), []);
});

test('retroativo: o valor informado é o de HOJE — não capitaliza desde a data de início', () => {
  const f = campos({
    compraTicker: 'BRASILPREV VGBL',
    compraCategoria: 'previdencia',
    compraCorretora: 'Brasilprev',
    compraPreco: '10.000,00',
    compraData: '2019-03-01',
    compraOrigemRecurso: '__retroativo__',
    prevTaxaMensal: '0,80',
  });
  const s = app(f);
  s.registrarOperacaoAtivo();

  // Sem esta regra, 0,8% a.m. desde 2019 dobraria o valor na tela.
  const saldo = s.calcularSaldoPrevidencia('BRASILPREV VGBL');
  assert.ok(
    Math.abs(saldo - 10000) < 1,
    `previdência retroativa deveria valer ~R$ 10.000 hoje, veio ${saldo}`
  );
  assert.equal(
    s.historicoCompras[0].saldoInicial,
    true,
    'marcada para render a partir do cadastro'
  );
});

test('retroativo: renda fixa antiga também não capitaliza desde a data de início', () => {
  const f = campos({
    compraTicker: 'CDB NUBANK 2030',
    compraCategoria: 'renda_fixa',
    compraCorretora: 'Nubank',
    compraPreco: '25.000,00',
    compraRentabilidade: '12% a.a.',
    compraData: '2020-01-15',
    compraOrigemRecurso: '__retroativo__',
  });
  const s = app(f);
  s.registrarOperacaoAtivo();

  assert.equal(s.transacoes.length, 0);
  const valor = s.valorAtualRendaFixa('CDB NUBANK 2030', 'renda_fixa');
  assert.ok(
    Math.abs(valor - 25000) < 1,
    `RF retroativa deveria valer ~R$ 25.000 hoje, veio ${valor}`
  );
});

test('retroativo: renda variável entra na carteira pela quantidade e preço médio informados', () => {
  const f = campos({
    compraTicker: 'PETR4',
    compraQtd: '300',
    compraPreco: '22,50',
    compraData: '2021-06-10',
    compraOrigemRecurso: '__retroativo__',
  });
  const s = app(f);
  s.registrarOperacaoAtivo();

  assert.equal(s.transacoes.length, 0, 'sem impacto no caixa');
  const carteira = s.obterResumoCarteira();
  assert.equal(carteira.PETR4.qtdTotal, 300);
  assert.equal(carteira.PETR4.valorTotalInvestido, 6750, 'custo de aquisição = 300 × 22,50');
  assert.ok(!s.historicoCompras[0].saldoInicial, 'RV vale pela cotação — não usa saldo inicial');
});

test('aporte externo: compra de hoje com dinheiro de fora não debita conta alguma', () => {
  const f = campos({ compraOrigemRecurso: '__externo__' });
  const s = app(f);
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
  s.criarConta({ nome: 'Nubank', tipo: 'banco' });
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 5000);

  s.registrarOperacaoAtivo();

  assert.equal(s.__ultimoToast.tipo, 'sucesso', s.__ultimoToast.msg);
  assert.equal(s.historicoCompras[0].origemRecurso, 'externo');
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 5000, 'o saldo do Nubank fica intacto');
  assert.equal(
    s.transacoes.filter((t) => t.categoria === 'transferencia_saida').length,
    0,
    'não existe perna de caixa'
  );
  assert.deepEqual(semViolacoes(s), []);
});

test('aporte novo pela conta segue a regra normal — conta de origem, saída de dinheiro', () => {
  const f = campos();
  const s = app(f);
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
  f.compraOrigemRecurso = nubank.id;
  s.registrarOperacaoAtivo();

  const caixa = s.transacoes.find((t) => t.categoria === 'transferencia_saida');
  assert.ok(caixa, 'a compra normal continua criando a perna de caixa');
  assert.equal(caixa.contaId, nubank.id);
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 4000, 'e o saldo cai');
  assert.deepEqual(semViolacoes(s), []);
});

test('sem origem escolhida a compra continua bloqueada — nada de aporte órfão', () => {
  const f = campos({ compraOrigemRecurso: '' });
  const s = app(f);
  s.registrarOperacaoAtivo();
  assert.equal(s.historicoCompras.length, 0);
  assert.equal(s.transacoes.length, 0);
  assert.equal(s.__ultimoToast.tipo, 'erro');
});

test('retroativo/externo não geram compromisso recorrente (a parcela não teria conta pagadora)', () => {
  const f = campos({
    compraTicker: 'RESERVA ITAU',
    compraCategoria: 'reserva_emergencia',
    compraCorretora: 'Itaú',
    compraPreco: '8.000,00',
    compraRentabilidade: '100% CDI',
    compraData: '2022-02-01',
    compraOrigemRecurso: '__retroativo__',
    prevRecorrente: true,
    prevDuracaoAnos: '5',
  });
  const s = app(f);
  s.registrarOperacaoAtivo();

  assert.equal(s.historicoCompras[0].recorrente, false);
  assert.equal(
    s.transacoes.filter((t) => t.compromissoId != null).length,
    0,
    'nenhuma parcela futura sem conta pagadora (INV-01)'
  );
  assert.deepEqual(semViolacoes(s), []);
});

test('as origens que não debitam aparecem no seletor mesmo sem nenhuma conta com saldo', () => {
  const f = campos();
  const s = app(f);
  let html = '';
  const sel = {
    set innerHTML(v) {
      html = v;
    },
    get innerHTML() {
      return html;
    },
    get options() {
      return Array.from(html.matchAll(/value="([^"]*)"/g)).map((m) => ({ value: m[1] }));
    },
    value: '',
    style: {},
    focus() {},
  };
  s.document.getElementById = (id) =>
    id === 'compraOrigemRecurso' ? sel : { value: '', style: {}, dataset: {}, focus() {} };
  s.popularOrigemRecurso();

  assert.match(html, /__retroativo__/, 'cadastro retroativo sempre disponível');
  assert.match(html, /__externo__/, 'aporte externo sempre disponível');
  assert.match(html, /nenhuma conta com saldo/, 'e o aviso de que não há conta com saldo');
});
