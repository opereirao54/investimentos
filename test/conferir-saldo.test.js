'use strict';

// "Conferir saldo" (web/appliquei-conferir-saldo.js) e as duas correções de
// causa que vieram com ele.
//
// O caso real: o Patrimônio mostrava -R$ 726,83 no Nubank de quem tinha mais
// de R$ 2.000 no banco, sem nada que avisasse que o número não batia. O que
// este arquivo tranca:
//
//   1. O ajuste acerta o saldo da conta em TODAS as telas que mostram caixa
//      (Patrimônio, extrato, seletores, Telegram) e em NENHUMA que mostra
//      resultado do mês — ajuste não é receita nem despesa.
//   2. Desfazer devolve exatamente o saldo de antes.
//   3. O aviso aparece quando deve (negativo, nunca conferida) e some quando a
//      conta foi conferida ou o aviso foi dispensado.
//   4. A conta nova pede o saldo de HOJE e não conta duas vezes o que já foi
//      lançado com aquele nome de banco.
//   5. "Foi no cartão" e o "Pagou com" do lançamento tiram do caixa a compra
//      no crédito, que só sai quando a fatura é paga.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const consultas = require(path.join(__dirname, '..', 'api', '_lib', 'telegram-consultas.js'));

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-conferir-saldo.js']);
const DIA = 86400000;

function ymd(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/** Nubank sem saldo de abertura e uma conta fixa marcada paga ontem. */
function cenario(fields) {
  const s = carregarApp(fields || {}, ORDEM);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco' });
  const hoje = new Date();
  const ontem = new Date(Date.now() - DIA);
  s.transacoes.push({
    id: 'aluguel',
    descricao: 'Aluguel',
    categoria: 'despesa_fixa',
    valor: 1000,
    contaId: conta.id,
    data: ontem.toISOString(),
    dataVencimento: ymd(ontem),
    mes: ontem.getMonth(),
    ano: ontem.getFullYear(),
    pago: true,
    pagoEm: ontem.toISOString(),
  });
  return { s, conta, hoje };
}

function caixaDe(s, contaId) {
  const m = s.mpCalcularSaldoPorInstituicao(Date.now());
  return m[contaId] ? Math.round(m[contaId].caixa * 100) / 100 : 0;
}

test('o ajuste acerta o saldo da conta em todas as telas de caixa', () => {
  const { s, conta } = cenario();
  assert.equal(caixaDe(s, conta.id), -1000, 'antes: só a conta paga, sem abertura');

  const aj = s.conferirAjustar(conta.id, 2150);
  assert.ok(aj, 'diferença ≠ 0 gera ajuste');
  assert.equal(aj.valor, 3150);

  assert.equal(caixaDe(s, conta.id), 2150, 'Patrimônio por instituição');
  assert.equal(Math.round(s.mpCalcularSaldoTotal(Date.now()) * 100) / 100, 2150, 'saldo total');
  assert.equal(s.saldoCaixaPorConta()[conta.id], 2150, 'seletores de conta');

  const movs = s.mpExtratoInstituicao(conta.id, Date.now());
  const ultimo = movs[movs.length - 1];
  assert.equal(ultimo.categoria, 'ajuste_saldo', 'o ajuste aparece no extrato');
  assert.equal(ultimo.saldoApos, 2150, 'e o extrato fecha no saldo real');

  const tg = consultas.saldoPorInstituicao(
    { contas: s.contas, transacoes: s.transacoes },
    Date.now()
  );
  assert.equal(Math.round(tg[conta.id].caixa * 100) / 100, 2150, '/saldo do Telegram');
});

test('ajuste não é receita nem despesa: o resultado do mês não muda', () => {
  const { s, conta, hoje } = cenario();
  const antes = JSON.stringify(s.calcularResumoMes(hoje.getMonth(), hoje.getFullYear()));
  const qtd = s.transacoes.length;
  s.conferirAjustar(conta.id, 2150);
  assert.equal(
    JSON.stringify(s.calcularResumoMes(hoje.getMonth(), hoje.getFullYear())),
    antes,
    'Projeção/Controle seguem iguais'
  );
  assert.equal(s.transacoes.length, qtd, 'nenhuma transação criada');
  assert.equal(s.mpCalcularDespesasJanela(0, Date.now() + DIA), 1000, 'despesa da janela igual');
});

test('desfazer o ajuste devolve o saldo de antes', () => {
  const { s, conta } = cenario();
  const aj = s.conferirAjustar(conta.id, 2150);
  assert.equal(s.conferirDesfazerAjuste(conta.id, aj.id), true);
  assert.equal(caixaDe(s, conta.id), -1000);
  assert.equal(s.conferirDesfazerAjuste(conta.id, aj.id), false, 'idempotente');
});

test('saldo que já bate: marca conferido sem criar ajuste', () => {
  const { s, conta } = cenario();
  const aj = s.conferirAjustar(conta.id, -1000);
  assert.equal(aj, null);
  assert.ok(conta.conferidoEm, 'conta marcada como conferida');
  assert.ok(!conta.ajustes || !conta.ajustes.length);
});

test('aviso: negativo, nunca conferida, conferida, dispensada', () => {
  const { s, conta } = cenario();
  assert.equal(s.conferirAviso(conta, -726.83).nivel, 'negativo');
  assert.equal(s.conferirAviso(conta, 50).nivel, 'sem-abertura', 'sem abertura nem conferência');

  s.conferirAjustar(conta.id, 2150);
  assert.equal(s.conferirAviso(conta, 2150), null, 'recém-conferida');
  assert.equal(
    s.conferirAviso(conta, 2150, Date.now() + 31 * DIA).nivel,
    'antigo',
    'depois de 30 dias pede de novo'
  );

  conta.avisoSaldoDispensadoEm = new Date().toISOString();
  assert.equal(s.conferirAviso(conta, -10), null, '"Agora não" cala por 30 dias');
  assert.equal(s.conferirAviso(conta, -10, Date.now() + 31 * DIA).nivel, 'negativo');

  assert.equal(
    s.conferirAviso({ id: 'x', tipo: 'corretora' }, 100),
    null,
    'corretora não é cobrada por abertura'
  );
});

test('explicações: aponta a conta paga e a falta de abertura, com "Não paguei"', () => {
  const { s, conta } = cenario();
  const exp = s.conferirExplicacoes(conta.id, 3150);
  const ids = exp.map((e) => e.id);
  assert.ok(ids.includes('sem-abertura'), ids.join(','));
  const pagas = exp.find((e) => e.id === 'pagas');
  assert.ok(pagas, 'lista as contas marcadas como pagas');
  assert.equal(pagas.itens[0].txId, 'aluguel');
  assert.equal(pagas.itens[0].acao, 'nao-paguei');

  const menos = s.conferirExplicacoes(conta.id, -100).map((e) => e.id);
  assert.equal(menos[0], 'faltou-gasto', 'app mostra mais: gasto não lançado');
  assert.equal(s.conferirExplicacoes(conta.id, 0).length, 0, 'sem diferença, sem lista');
});

test('explicações: entrada do mês com data futura ganha "Já caiu"', () => {
  const { s, conta } = cenario();
  const hoje = new Date();
  // Último dia do mês ao meio-dia: sempre no futuro (exceto na última tarde do mês).
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 12);
  if (fim.getTime() <= Date.now()) return;
  s.transacoes.push({
    id: 'salario',
    descricao: 'Salário',
    categoria: 'receita',
    valor: 6700,
    contaId: conta.id,
    data: hoje.toISOString(),
    dataVencimento: ymd(fim),
    mes: hoje.getMonth(),
    ano: hoje.getFullYear(),
  });
  const fut = s.conferirExplicacoes(conta.id, 500).find((e) => e.id === 'futuras');
  assert.ok(fut);
  assert.equal(fut.itens[0].acao, 'ja-caiu');
  const antes = caixaDe(s, conta.id);
  s.conferirJaCaiu('salario');
  assert.equal(caixaDe(s, conta.id), antes + 6700, 'a entrada passa a contar hoje');
});

test('"Foi no cartão": a compra variável sai do caixa e vai para o cartão', () => {
  const { s, conta } = cenario();
  s.cartoes.length = 0;
  s.cartoes.push({ id: 'cc1', nome: 'Nubank', diaFechamento: 3, diaVencimento: 10 });
  const ontem = new Date(Date.now() - DIA);
  s.transacoes.push({
    id: 'mercado',
    descricao: 'Mercado',
    categoria: 'despesa_variavel',
    valor: 50,
    contaId: conta.id,
    banco: 'Nubank',
    data: ontem.toISOString(),
    dataVencimento: ymd(ontem),
    mes: ontem.getMonth(),
    ano: ontem.getFullYear(),
    pago: true,
  });
  assert.equal(caixaDe(s, conta.id), -1050);
  const exp = s.conferirExplicacoes(conta.id, 100).find((e) => e.id === 'variaveis');
  assert.equal(exp.itens[0].acao, 'foi-no-cartao');

  assert.equal(s.conferirFoiNoCartao('mercado', 'nao-existe'), false, 'cartão inválido');
  assert.equal(s.conferirFoiNoCartao('mercado', 'cc1'), true);
  const t = s.transacoes.find((x) => x.id === 'mercado');
  assert.equal(t.categoria, 'cartao_credito');
  assert.equal(t.cartaoId, 'cc1');
  assert.equal(t.pago, false);
  assert.ok(/^\d{4}-\d{2}-10$/.test(t.dataVencimento), 'vence no dia da fatura');
  assert.equal(t.mes, Number(t.dataVencimento.slice(5, 7)) - 1, 'competência = mês da fatura');
  assert.equal(caixaDe(s, conta.id), -1000, 'só sai quando a fatura for paga');
});

test('conta nova: o saldo de hoje vira abertura sem contar duas vezes o já lançado', () => {
  const s = carregarApp({}, ORDEM);
  const ontem = new Date(Date.now() - DIA);
  // Receita lançada com o banco digitado, antes de a conta existir.
  s.transacoes.push({
    id: 'r',
    categoria: 'receita',
    valor: 300,
    banco: 'Inter',
    data: ontem.toISOString(),
    dataVencimento: ymd(ontem),
    mes: ontem.getMonth(),
    ano: ontem.getFullYear(),
  });
  const abertura = s.saldoAberturaParaSaldoHoje('Inter', 500);
  assert.equal(abertura, 200);
  const c = s.criarConta({ nome: 'Inter', tipo: 'banco', saldoInicial: abertura });
  assert.equal(caixaDe(s, c.id), 500, 'o saldo da conta é o que a pessoa digitou');
});

test('formulário de conta nova recusa saldo de hoje vazio', () => {
  const fields = { contaNome: 'C6', contaTipo: 'banco', contaSaldoInicial: '', contaEditId: '' };
  const s = carregarApp(fields, ORDEM);
  s.salvarFormConta();
  assert.equal(s.contas.length, 0, 'sem saldo, não cria');
  fields.contaSaldoInicial = '0,00';
  s.salvarFormConta();
  assert.equal(s.contas.length, 1, 'zero é resposta válida');
  assert.ok(s.contas[0].conferidoEm, 'nasce conferida');
});

test('fundir contas leva os ajustes junto', () => {
  const { s, conta } = cenario();
  s.conferirAjustar(conta.id, 2150);
  const outra = s.criarConta({ nome: 'Nu Conta', tipo: 'banco', saldoInicial: 100 });
  const total = s.mpCalcularSaldoTotal(Date.now());
  s.fundirContas(outra.id, [conta.id]);
  assert.equal(
    Math.round(s.mpCalcularSaldoTotal(Date.now()) * 100) / 100,
    Math.round(total * 100) / 100
  );
  assert.equal(caixaDe(s, outra.id), 2250);
});

test('"Pagou com": cartões só na saída variável nova', () => {
  const fields = {
    categoriaTransacao: 'despesa_variavel',
    editTransacaoId: '',
    transacaoFixa: false,
  };
  const s = carregarApp(fields, ORDEM.concat(['web/appliquei-lancamento-ui.js']));
  s.cartoes.length = 0;
  s.cartoes.push({ id: 'cc1', nome: 'Nubank', diaFechamento: 3, diaVencimento: 10 });
  assert.equal(s.lancUiCartoesPagouCom('saida').length, 1);
  assert.equal(s.lancUiCartoesPagouCom('entrada').length, 0);
  fields.categoriaTransacao = 'despesa_fixa';
  assert.equal(s.lancUiCartoesPagouCom('saida').length, 0, 'conta fixa não é no crédito');
  fields.categoriaTransacao = 'despesa_variavel';
  fields.editTransacaoId = 'x';
  assert.equal(s.lancUiCartoesPagouCom('saida').length, 0, 'na edição, não');
});

// ---------------------------------------------------------------------------
// "Lançar como gasto / entrada" (canvas Conferir saldo, nov/2026)
// ---------------------------------------------------------------------------

test('lançar a diferença como gasto: despesa paga hoje nesta conta, e a conta bate', () => {
  const { s, conta } = cenario();
  const antes = s.conferirSaldoApp(conta.id, Date.now());
  const t = s.conferirLancarDiferenca(conta.id, antes - 120);
  assert.equal(t.categoria, 'despesa_variavel');
  assert.equal(t.valor, 120);
  assert.equal(t.contaId, conta.id);
  assert.equal(t.pago, true);
  assert.ok(!t.categoriaDespesa, 'fica em "Outros" (sem categoria)');
  assert.equal(Math.round(s.conferirSaldoApp(conta.id, Date.now()) * 100) / 100, antes - 120);
  assert.ok(s.obterConta(conta.id).conferidoEm);
  assert.ok(!(s.obterConta(conta.id).ajustes || []).length, 'sem ajuste de saldo');
});

test('lançar a diferença como entrada quando o banco tem mais', () => {
  const { s, conta } = cenario();
  const antes = s.conferirSaldoApp(conta.id, Date.now());
  const t = s.conferirLancarDiferenca(conta.id, antes + 50);
  assert.equal(t.categoria, 'receita');
  assert.equal(t.valor, 50);
  assert.equal(Math.round(s.conferirSaldoApp(conta.id, Date.now()) * 100) / 100, antes + 50);
  assert.equal(s.conferirLancarDiferenca(conta.id, antes + 50), null, 'sem diferença, nada');
});
