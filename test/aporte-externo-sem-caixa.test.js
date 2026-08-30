'use strict';

// Aporte externo NÃO é saída de caixa — nem hoje, nem na recorrência.
//
// O apontamento: "investimento cadastrado como aporte extra, dinheiro fora do
// app, não pode ser considerado saída de caixa. Ele pode ser somado como
// investimento, mas o valor não deve ser descontado do caixa. Além do valor
// guardado retroativo, a recorrência também não desconta em caixa."
//
// O patrimônio já respeitava isso (mpTransacaoComputaCaixa ignora
// `origemExterna`). Faltavam três lugares, e é o que estes testes travam:
//
//   1. calcularResumoMes somava a parcela externa em invFixo/invVar — o bucket
//      que a sobra do mês, a DRE e o relatório mensal SUBTRAEM. O dinheiro
//      nunca saiu de conta nenhuma e ainda assim derrubava o resultado do mês.
//   2. processarAportesRecorrentesPrevidencia gerava os aportes retroativos da
//      recorrência sem herdar a marca do template — a cada carregamento do app
//      a recorrência externa voltava a debitar caixa (e, sem conta de origem,
//      caía no bucket "A reconciliar").
//   3. aplicarAgendadoNoSaldo descontava a parcela externa agendada do saldo
//      PROJETADO das contas.
//
// A contrapartida: o valor continua sendo investimento. Ele soma no capital
// aplicado (aporteLiquidoAcumuladoAte e a linha "Investimento acumulado" da
// DRE) — só não sai do caixa.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { carregarApp, estadoDe, ORDEM_BASE, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ROOT = path.resolve(__dirname, '..');
const CF = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba-controle-financeiro.js'), 'utf8');

const semViolacoes = (s) => validarEstado(estadoDe(s)).map((v) => `${v.inv}: ${v.mensagem}`);

const aporte = (extra) =>
  Object.assign(
    {
      id: 'tx-' + Math.random().toString(36).slice(2),
      descricao: 'Reserva: RESERVA EXTERNA',
      categoria: 'investimento_fixo',
      valor: 300,
      mes: 0,
      ano: 2025,
      data: new Date(2025, 0, 10).toISOString(),
      pago: true,
    },
    extra || {}
  );

// ---------------------------------------------------------------------------
// 1. O resumo do mês separa o que saiu do caixa do que não saiu
// ---------------------------------------------------------------------------

test('resumo do mês: aporte externo tem bucket próprio e não entra em invFixo/invVar', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.transacoes.push(
    aporte({ valor: 300, origemExterna: true }),
    aporte({ valor: 200, categoria: 'investimento_variavel', origemExterna: true }),
    aporte({ valor: 700, contaId: 'c1' })
  );
  const r = s.calcularResumoMes(0, 2025);
  assert.equal(r.invFixo, 700, 'só o aporte que saiu de uma conta conta como saída');
  assert.equal(r.invVar, 0);
  assert.equal(r.invExterno, 500, 'os dois externos somam no bucket próprio');
});

test('sobra do mês: o aporte externo não derruba o resultado', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.transacoes.push(
    {
      id: 'rec1',
      categoria: 'receita',
      valor: 5000,
      mes: 0,
      ano: 2025,
      data: new Date(2025, 0, 5).toISOString(),
      pago: true,
    },
    aporte({ valor: 1000, origemExterna: true })
  );
  assert.equal(
    s.calcularResultadoMes(0, 2025),
    5000,
    'dinheiro que nunca esteve em conta nenhuma não pode virar saída de caixa'
  );
});

test('sobra do mês: aporte NORMAL continua descontando — a trava não foi relaxada', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.transacoes.push(
    {
      id: 'rec1',
      categoria: 'receita',
      valor: 5000,
      mes: 0,
      ano: 2025,
      data: new Date(2025, 0, 5).toISOString(),
      pago: true,
    },
    aporte({ valor: 1000, contaId: 'c1' })
  );
  assert.equal(s.calcularResultadoMes(0, 2025), 4000);
});

test('a marca não isenta uma DESPESA — ela só vale para aporte', () => {
  // Uma despesa paga saiu de algum lugar, sempre. Aceitar `origemExterna`
  // ali abriria um buraco por onde qualquer gasto escaparia da trava.
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.transacoes.push(
    aporte({ categoria: 'despesa_fixa', valor: 800, origemExterna: true, contaId: 'c1' })
  );
  const r = s.calcularResumoMes(0, 2025);
  assert.equal(r.despFixa, 800);
  assert.equal(r.invExterno, 0);
});

test('capital aplicado: o aporte externo SOMA — ele é investimento de verdade', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.transacoes.push(aporte({ valor: 1200, origemExterna: true }), aporte({ valor: 800 }));
  assert.equal(s.aporteLiquidoAcumuladoAte(1, 2025), 2000);
});

test('a DRE soma o externo no acumulado e o exibe em linha própria, sem sinal de menos', () => {
  assert.match(
    CF,
    /acumInv \+= \(d\.invFixo \|\| 0\) \+ \(d\.invVar \|\| 0\) \+ \(d\.invExterno \|\| 0\) - \(d\.resgate \|\| 0\);/,
    'o acumulado é ESTOQUE: o externo é capital aplicado e tem de entrar'
  );
  assert.match(CF, /Aporte externo \(fora do caixa\)/, 'a linha informativa da DRE');
  assert.match(
    CF,
    /const algumExterno = dreDados\.some\(\(d\) => \(d\.invExterno \|\| 0\) > 0\.005\);/,
    'só aparece para quem usa a origem — para os outros seria ruído'
  );
});

// ---------------------------------------------------------------------------
// 2. A recorrência
// ---------------------------------------------------------------------------

function comRecorrenteExterna(ordem) {
  const s = carregarApp(
    {
      compraTicker: 'BRASILPREV VGBL',
      tipoOperacao: 'compra',
      compraCategoria: 'previdencia',
      compraCorretora: 'Brasilprev',
      compraData: '',
      compraVencimento: '',
      compraRentabilidade: '',
      compraQtd: '',
      compraPreco: '500,00',
      compraSubcategoria: '',
      compraOrigemRecurso: '__externo__',
      compraOrigemBanco: '',
      compraDestinoRecurso: '',
      prevSaldoInicial: '',
      prevRecorrente: true,
      prevDiaRecorrencia: '10',
      prevDuracaoAnos: '3',
      prevTaxaMensal: '0,80',
      compraTotalOp: '',
    },
    ordem || ORDEM_BASE
  );
  s.abrirDrawerOperacao = () => {};
  s.calcularTotalCompra = () => {};
  s.atualizarProjecaoForm = () => {};
  s.registrarOperacaoAtivo();
  return s;
}

test('recorrência externa: as parcelas nascem marcadas e sem conta', () => {
  const s = comRecorrenteExterna();
  const parcelas = s.transacoes.filter((t) => t.compromissoId);
  assert.ok(parcelas.length > 30, `esperava ~35 parcelas, veio ${parcelas.length}`);
  parcelas.forEach((p) => {
    assert.equal(p.origemExterna, true, 'toda parcela herda a marca do template');
    assert.equal(p.contaId, undefined, 'não há conta — é o ponto do aporte externo');
  });
});

test('recorrência externa: nenhuma parcela paga vira saída de caixa no Controle', () => {
  const s = comRecorrenteExterna(ORDEM_CONTROLE);
  s.transacoes.forEach((t) => {
    if (t.compromissoId) t.pago = true;
  });
  const parcela = s.transacoes.find((t) => t.compromissoId);
  const r = s.calcularResumoMes(parcela.mes, parcela.ano);
  assert.equal(r.invFixo, 0, 'a parcela externa paga não pode contar como saída');
  assert.equal(r.invExterno, 500, 'ela conta como investimento, no bucket que não desconta');
  assert.deepEqual(semViolacoes(s), []);
});

test('recorrência externa: o gerador retroativo de previdência herda a marca', () => {
  // Este era o vazamento silencioso: processarAportesRecorrentesPrevidencia
  // roda a cada carregamento do app e recriava os aportes vencidos SEM a marca
  // — a recorrência externa voltava a debitar caixa sozinha.
  const s = comRecorrenteExterna();
  const template = s.historicoCompras[0];
  // Joga o template seis meses para trás para o gerador ter o que preencher.
  const seisMesesAtras = new Date();
  seisMesesAtras.setMonth(seisMesesAtras.getMonth() - 6);
  template.data_op = seisMesesAtras.toISOString();

  const saldoAntes = s.mpCalcularSaldoTotal(Date.now());
  const criados = s.processarAportesRecorrentesPrevidencia();
  assert.ok(criados > 0, 'o gerador precisa ter criado aportes para o teste valer');

  s.historicoCompras
    .filter((o) => o.gerado && o.categoria === 'previdencia')
    .forEach((o) => {
      assert.equal(o.origemExterna, true, 'o aporte gerado herda a origem do template');
      assert.equal(o.origemRecurso, 'externo');
    });
  s.transacoes
    .filter((t) => t.gerado && t.categoria === 'investimento_fixo' && !t.compromissoId)
    .forEach((t) => {
      assert.equal(t.origemExterna, true, 'e a transação gerada também');
    });

  assert.equal(
    s.mpCalcularSaldoTotal(Date.now()),
    saldoAntes,
    'a recorrência retroativa não pode mexer no caixa'
  );
  assert.deepEqual(semViolacoes(s), []);
});

test('recorrência externa: a parcela paga vira posição marcada como externa', () => {
  const s = comRecorrenteExterna();
  const parcela = s.transacoes.find((t) => t.compromissoId);
  parcela.pago = true;
  assert.equal(s.registrarAportePorPagamentoCompromisso(parcela), true);
  const pos = s.historicoCompras.find((o) => o.geradoDoCompromissoTx === parcela.id);
  assert.ok(pos, 'a posição precisa existir');
  assert.equal(pos.origemExterna, true);
  assert.equal(pos.origemRecurso, 'externo');
});

// ---------------------------------------------------------------------------
// 3. O saldo projetado das contas
// ---------------------------------------------------------------------------

test('saldo projetado: parcela externa agendada não derruba o saldo futuro', () => {
  const s = carregarApp({}, ORDEM_BASE);
  s.contas.push({ id: 'c1', nome: 'Nubank', saldoInicial: 1000 });
  const daquiUmMes = new Date();
  daquiUmMes.setMonth(daquiUmMes.getMonth() + 1);
  s.transacoes.push(
    aporte({
      id: 'futura-externa',
      valor: 400,
      origemExterna: true,
      pago: false,
      mes: daquiUmMes.getMonth(),
      ano: daquiUmMes.getFullYear(),
      data: daquiUmMes.toISOString(),
      dataVencimento: daquiUmMes.toISOString().slice(0, 10),
    })
  );
  const ref = new Date(daquiUmMes.getTime() + 5 * 24 * 3600 * 1000).getTime();
  const saldos = s.saldoCaixaPorConta(ref);
  assert.equal(saldos['a-reconciliar'] || 0, 0, 'não há caixa a debitar em lugar nenhum');
  assert.equal(saldos.c1, 1000, 'e a conta real segue intacta');
});
