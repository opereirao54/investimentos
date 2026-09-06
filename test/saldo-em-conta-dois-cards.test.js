'use strict';

// O Controle financeiro passou a mostrar DOIS saldos lado a lado, e eles
// respondem a perguntas diferentes:
//
//   · Saldo livre    → do MÊS: receita − despesas − cartão − investimentos − sonhos.
//   · Saldo em conta → de AGORA: o dinheiro que existe nas contas.
//
// Dois números parecidos na mesma dobra são um convite a desconfiar do app.
// O que este arquivo tranca:
//
//   1. O "Saldo em conta" tem de ser IGUAL ao que Meu patrimônio mostra. São
//      duas telas exibindo o mesmo dinheiro; divergir é o pior defeito
//      possível aqui, e o mais fácil de introduzir (basta alguém recalcular
//      por conta própria em vez de chamar saldoCaixaPorConta).
//   2. Os dois cards têm de poder DIVERGIR entre si. Uma despesa lançada e
//      não paga baixa o saldo livre e NÃO baixa o saldo em conta — é
//      exatamente a distinção que justifica os dois cards existirem. Um teste
//      que só exigisse igualdade esconderia a fusão dos dois de volta.
//   3. A referência acompanha o mês na tela: passado é foto, futuro é
//      projeção. Cravar "hoje" faria o card ao lado falar de setembro
//      enquanto este fala de agora, sem avisar.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

const DIA = 86400000;

/** Soma o mapa {contaId: saldo} que saldoCaixaPorConta devolve. */
function somar(mapa) {
  return Object.keys(mapa || {}).reduce((s, k) => s + (Number(mapa[k]) || 0), 0);
}

test('o saldo em conta do card é o mesmo saldo que Meu patrimônio mostra', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 2000 });
  const hoje = new Date();
  const dia = (n) => new Date(hoje.getFullYear(), hoje.getMonth(), n);

  s.transacoes.push(
    {
      id: 'r1',
      categoria: 'receita',
      valor: 8000,
      contaId: conta.id,
      data: dia(5).toISOString(),
      dataVencimento: dia(5).toISOString().slice(0, 10),
      mes: hoje.getMonth(),
      ano: hoje.getFullYear(),
      pago: true,
    },
    {
      id: 'd1',
      categoria: 'despesa_fixa',
      valor: 3000,
      contaId: conta.id,
      data: dia(6).toISOString(),
      dataVencimento: dia(6).toISOString().slice(0, 10),
      mes: hoje.getMonth(),
      ano: hoje.getFullYear(),
      pago: true,
    }
  );

  const doCard = s.calcularSaldoEmContaDoMes(hoje.getMonth(), hoje.getFullYear());
  const doPatrimonio = s.mpCalcularSaldoTotal(Date.now());
  assert.equal(
    doCard,
    doPatrimonio,
    'o Controle financeiro e o Meu patrimônio têm de mostrar o MESMO dinheiro'
  );
  assert.equal(doCard, 7000, '2.000 de abertura + 8.000 de salário − 3.000 de aluguel pago');
});

test('despesa não paga separa os dois cards — é para isso que eles são dois', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 0 });
  const hoje = new Date();
  const dia = (n) => new Date(hoje.getFullYear(), hoje.getMonth(), n);

  s.transacoes.push(
    {
      id: 'r1',
      categoria: 'receita',
      valor: 5000,
      contaId: conta.id,
      data: dia(1).toISOString(),
      dataVencimento: dia(1).toISOString().slice(0, 10),
      mes: hoje.getMonth(),
      ano: hoje.getFullYear(),
      pago: true,
    },
    {
      // Lançada, ainda não paga: já compromete o mês, mas o dinheiro
      // continua no banco.
      id: 'd1',
      categoria: 'despesa_variavel',
      valor: 1200,
      contaId: conta.id,
      data: dia(28).toISOString(),
      dataVencimento: dia(28).toISOString().slice(0, 10),
      mes: hoje.getMonth(),
      ano: hoje.getFullYear(),
      pago: false,
    }
  );

  const emConta = s.calcularSaldoEmContaDoMes(hoje.getMonth(), hoje.getFullYear());
  const resumo = s.calcularResumoMes(hoje.getMonth(), hoje.getFullYear());
  // A mesma conta que o card "Saldo livre" faz na tela.
  const saldoLivre =
    resumo.receita - resumo.despFixa - resumo.despVar - resumo.cartao - resumo.sonho;

  assert.equal(emConta, 5000, 'a despesa por pagar NÃO saiu do banco');
  assert.equal(resumo.despVar, 1200, 'mas ela JÁ pesa no mês');
  assert.equal(saldoLivre, 3800, 'o saldo livre desconta o que ainda não foi pago');
  assert.notEqual(
    saldoLivre,
    emConta,
    'os dois cards precisam poder divergir — se fossem sempre iguais, um bastaria'
  );
});

test('a referência acompanha o mês na tela: passado é foto, futuro é projeção', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 1000 });
  const hoje = new Date();

  // Uma despesa agendada para daqui a alguns dias, dentro do mês seguinte.
  const futuro = new Date(Date.now() + 40 * DIA);
  s.transacoes.push({
    id: 'd-futura',
    categoria: 'despesa_fixa',
    valor: 400,
    contaId: conta.id,
    data: futuro.toISOString(),
    dataVencimento: futuro.toISOString().slice(0, 10),
    mes: futuro.getMonth(),
    ano: futuro.getFullYear(),
    pago: false,
  });

  const agora = s.calcularSaldoEmContaDoMes(hoje.getMonth(), hoje.getFullYear());
  const depois = s.calcularSaldoEmContaDoMes(futuro.getMonth(), futuro.getFullYear());

  assert.equal(agora, 1000, 'a despesa de daqui a 40 dias não pode encolher o saldo de hoje');
  assert.equal(depois, 600, 'mas o mês dela tem de mostrá-la descontada');

  // Mês passado: nada tinha acontecido além da abertura da conta.
  const anterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 15);
  assert.equal(
    s.calcularSaldoEmContaDoMes(anterior.getMonth(), anterior.getFullYear()),
    1000,
    'no passado vale a foto daquele instante'
  );
});

test('sem conta cadastrada o saldo é zero, não NaN', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const hoje = new Date();
  const v = s.calcularSaldoEmContaDoMes(hoje.getMonth(), hoje.getFullYear());
  assert.equal(v, 0);
  assert.ok(Number.isFinite(v));
});

test('o card usa saldoCaixaPorConta em vez de refazer a conta por fora', () => {
  // Trava estrutural: o dia em que alguém recalcular o caixa aqui dentro, as
  // duas telas passam a poder divergir sem nenhum teste acusar. A regra de
  // caixa mora em contas.js/patrimonio.js e é lá que ela tem de continuar.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'web/appliquei-aba-controle-financeiro.js'),
    'utf8'
  );
  const corpo = src.slice(
    src.indexOf('function calcularSaldoEmContaDoMes'),
    src.indexOf('function atualizarKpiSaldoEmConta')
  );
  assert.ok(corpo.length > 0, 'calcularSaldoEmContaDoMes não encontrada');
  assert.ok(
    corpo.includes('saldoCaixaPorConta'),
    'o card tem de perguntar à mesma função que monta o saldo do Patrimônio'
  );
  assert.ok(
    !/mpEhEntradaCaixa|saldoInicial|transacoes\.forEach/.test(corpo),
    'o card voltou a montar o caixa por conta própria'
  );
});

test('a soma do mapa por conta é o total — nenhuma conta fica de fora', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 1500 });
  s.criarConta({ nome: 'Itaú', tipo: 'banco', saldoInicial: 2500 });
  s.criarConta({ nome: 'XP', tipo: 'corretora', saldoInicial: 700 });
  const hoje = new Date();

  assert.equal(
    s.calcularSaldoEmContaDoMes(hoje.getMonth(), hoje.getFullYear()),
    somar(s.saldoCaixaPorConta(Date.now())),
    'o card soma exatamente o mapa por instituição'
  );
  assert.equal(s.calcularSaldoEmContaDoMes(hoje.getMonth(), hoje.getFullYear()), 4700);
});
