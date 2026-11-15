'use strict';

// Entrada recorrente que cai em dia útil, e o dia do mês que não existe.
//
// Relato de uso: "recebo dia 15 e dia 30; o saldo batia até o dia 15 e agora
// dá diferença". O 15/11/2026 é domingo E feriado: o app somava o salário no
// domingo, e o banco mostra o dinheiro na sexta (antecipado) ou na segunda.
// Quem recebe no "5º dia útil" não tinha como dizer isso ao app.
//
// O que este arquivo prova:
//   1. o calendário: fim de semana, feriados fixos e os móveis (Páscoa);
//   2. as quatro regras, e que nenhuma tira o lançamento do mês dele;
//   3. a série recorrente não transborda mais: o dia 30 em fevereiro vira 28,
//      e o dia 31 não pula novembro (antes caía em 02/03 e em 01/12);
//   4. o formulário grava a regra só onde ela faz sentido (entrada que repete);
//   5. editar "todos os meses" recalcula a série pela regra, e "só este mês"
//      tira a regra do lançamento que saiu da série;
//   6. o saldo passa a somar a entrada no dia em que o banco a mostra.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

const plano = (v) => JSON.parse(JSON.stringify(v));

function camposBase(extra) {
  return Object.assign(
    {
      descTransacao: 'Salário',
      valorTransacao: '2.000,00',
      transacaoFixa: false,
      qtdParcelas: '1',
      dataVencimento: '',
      obsTransacao: '',
      tipoCartaoSelecionado: '',
      selectCartao: '',
      bancoTransacao: 'Itaú',
      categoriaDespesa: '',
      categoriaTransacao: 'receita',
      regraDiaReceita: 'dia',
      nDiaUtil: '5',
    },
    extra
  );
}

test('calendário: feriados nacionais fixos e móveis', () => {
  const win = carregarApp(camposBase(), ORDEM_CONTROLE);
  const f = win.appliqueiFeriadosNacionais(2027);
  // Páscoa de 2027: 28/03 → Carnaval 08 e 09/02, Sexta Santa 26/03, Corpus 27/05.
  for (const d of ['2027-02-08', '2027-02-09', '2027-03-26', '2027-05-27', '2027-11-20']) {
    assert.ok(f[d], d + ' deveria ser feriado');
  }
  assert.ok(!win.appliqueiEhDiaUtil(new Date(2026, 10, 15)), '15/11/2026: domingo e feriado');
  assert.ok(!win.appliqueiEhDiaUtil(new Date(2026, 10, 2)), 'Finados');
  assert.ok(win.appliqueiEhDiaUtil(new Date(2026, 10, 16)));
});

test('as quatro regras, e nenhuma sai do mês', () => {
  const win = carregarApp(camposBase(), ORDEM_CONTROLE);
  const r = (ano, mes, regra) => win.appliqueiDataPelaRegra(ano, mes, regra);
  assert.equal(r(2026, 10, { tipo: 'dia', dia: 15 }), '2026-11-15');
  assert.equal(r(2026, 10, { tipo: 'util_anterior', dia: 15 }), '2026-11-13');
  assert.equal(r(2026, 10, { tipo: 'util_seguinte', dia: 15 }), '2026-11-16');
  // 5º dia útil: novembro pula Finados (seg, 02).
  assert.equal(r(2026, 10, { tipo: 'util_n', n: 5 }), '2026-11-09');
  assert.equal(r(2027, 0, { tipo: 'util_n', n: 5 }), '2027-01-08');
  // Dia que o mês não tem fica no último dia.
  assert.equal(r(2027, 1, { tipo: 'dia', dia: 30 }), '2027-02-28');
  // 01/08/2026 é sábado: antecipar atravessaria o mês — vai para segunda, 03.
  assert.equal(r(2026, 7, { tipo: 'util_anterior', dia: 1 }), '2026-08-03');
  // 31/10/2026 é sábado: adiar atravessaria o mês — vai para sexta, 30.
  assert.equal(r(2026, 9, { tipo: 'util_seguinte', dia: 31 }), '2026-10-30');
  // Mais dias úteis do que o mês tem: o último dia útil.
  assert.equal(r(2026, 10, { tipo: 'util_n', n: 23 }), '2026-11-30');
});

test('série do dia 30 e do dia 31 não transborda o mês', () => {
  const win = carregarApp(camposBase(), ORDEM_CONTROLE);
  const serie = (venc) =>
    win.criarLancamentos({
      descricao: 'Salário',
      valor: 2000,
      categoria: 'receita',
      banco: 'Itaú',
      fixo: true,
      dataVencimento: venc,
      mesBase: 9,
      anoBase: 2026,
    });
  const d30 = serie('2026-10-30');
  const v30 = d30.map((t) => t.dataVencimento);
  assert.equal(v30[4], '2027-02-28', 'fevereiro fica com a parcela dele');
  assert.equal(v30[5], '2027-03-30');
  // Uma parcela por mês, nos 60 meses.
  const meses30 = new Set(d30.map((t) => t.ano * 12 + t.mes));
  assert.equal(meses30.size, 60);

  const v31 = serie('2026-10-31').map((t) => t.dataVencimento);
  assert.equal(v31[1], '2026-11-30', 'novembro não é pulado');
  assert.equal(v31[2], '2026-12-31');
});

test('formulário: "dia útil anterior" grava a regra e ajusta cada mês', () => {
  const win = carregarApp(
    camposBase({
      transacaoFixa: true,
      dataVencimento: '2026-11-15',
      regraDiaReceita: 'util_anterior',
    }),
    ORDEM_CONTROLE
  );
  const antes = win.transacoes.length;
  win.executarInsercao();
  const novos = win.transacoes.slice(antes);
  assert.equal(novos.length, 60);
  assert.deepEqual(plano(novos.slice(0, 3).map((t) => [t.dataVencimento, t.mes, t.ano])), [
    ['2026-11-13', 10, 2026],
    ['2026-12-15', 11, 2026],
    ['2027-01-15', 0, 2027],
  ]);
  assert.deepEqual(plano(novos[0].regraDia), { tipo: 'util_anterior', dia: 15 });
});

test('formulário: "5º dia útil" sem data usa o mês em visão', () => {
  const win = carregarApp(
    camposBase({ transacaoFixa: true, regraDiaReceita: 'util_n', nDiaUtil: '5' }),
    ORDEM_CONTROLE
  );
  win.visaoMes = 10;
  win.visaoAno = 2026;
  const antes = win.transacoes.length;
  win.executarInsercao();
  const novos = win.transacoes.slice(antes);
  assert.deepEqual(plano(novos.slice(0, 3).map((t) => t.dataVencimento)), [
    '2026-11-09',
    '2026-12-07',
    '2027-01-08',
  ]);
  assert.deepEqual(plano(novos[0].regraDia), { tipo: 'util_n', n: 5 });
});

test('a regra só vale para entrada que repete todo mês', () => {
  const win = carregarApp(camposBase(), ORDEM_CONTROLE);
  const base = {
    descricao: 'X',
    valor: 10,
    banco: 'Itaú',
    dataVencimento: '2026-11-15',
    mesBase: 10,
    anoBase: 2026,
    regraDia: { tipo: 'util_anterior', dia: 15 },
  };
  const avulsa = win.criarLancamentos(Object.assign({}, base, { categoria: 'receita' }));
  assert.equal(avulsa[0].dataVencimento, '2026-11-15');
  assert.ok(!('regraDia' in avulsa[0]));
  const conta = win.criarLancamentos(
    Object.assign({}, base, { categoria: 'despesa_fixa', fixo: true })
  );
  assert.equal(conta[0].dataVencimento, '2026-11-15');
  assert.ok(!('regraDia' in conta[0]));
});

test('editar "todos os meses" troca a regra da série; "só este mês" tira a regra', () => {
  const win = carregarApp(
    camposBase({ transacaoFixa: true, dataVencimento: '2026-11-15', regraDiaReceita: 'dia' }),
    ORDEM_CONTROLE
  );
  win.executarInsercao();
  const serie = win.transacoes.filter((t) => t.descricao === 'Salário');
  assert.equal(serie[0].dataVencimento, '2026-11-15');

  // Passa a série inteira para o 5º dia útil.
  win.prepararEdicao(serie[0].id);
  win.document.getElementById('regraDiaReceita').value = 'util_n';
  win.document.getElementById('nDiaUtil').value = '5';
  win.executarEdicao('todas');
  const depois = win.transacoes.filter((t) => t.groupId === serie[0].groupId);
  assert.deepEqual(plano(depois.slice(0, 2).map((t) => [t.dataVencimento, t.mes])), [
    ['2026-11-09', 10],
    ['2026-12-07', 11],
  ]);
  assert.ok(depois.every((t) => t.regraDia && t.regraDia.tipo === 'util_n'));

  // Só dezembro, com data à mão: sai da série e perde a regra.
  const dez = depois[1];
  win.prepararEdicao(dez.id);
  win.document.getElementById('dataVencimento').value = '2026-12-04';
  win.executarEdicao('unica');
  const dezDepois = win.transacoes.find((t) => t.id === dez.id);
  assert.equal(dezDepois.dataVencimento, '2026-12-04');
  assert.ok(!('regraDia' in dezDepois));
});

test('saldo: a entrada antecipada soma na sexta, não no domingo', () => {
  const win = carregarApp(camposBase(), ORDEM_CONTROLE.concat(['web/appliquei-patrimonio.js']));
  const [t] = win.criarLancamentos({
    descricao: 'Salário',
    valor: 2000,
    categoria: 'receita',
    banco: 'Itaú',
    fixo: true,
    dataVencimento: '2026-11-15',
    mesBase: 10,
    anoBase: 2026,
    regraDia: { tipo: 'util_anterior' },
  });
  const sexta = new Date(2026, 10, 13, 9, 0).getTime();
  const quinta = new Date(2026, 10, 12, 23, 0).getTime();
  assert.equal(win.mpTransacaoComputaCaixa(t, sexta), true);
  assert.equal(win.mpTransacaoComputaCaixa(t, quinta), false);
});
