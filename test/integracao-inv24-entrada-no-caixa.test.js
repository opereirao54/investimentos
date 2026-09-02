'use strict';

// INV-24 — A entrada cai no caixa pela data do DINHEIRO, não pela da escrituração.
//
// `mpTransacaoComputaCaixa(t, refMs)` responde "esta transação já está no caixa
// em refMs?". Para ENTRADA não existe botão "pago" na tela do Controle, então
// quem decide é a data — e escolher a data errada aqui não erra por pouco: a
// entrada some do saldo, e some SÓ ÀS VEZES.
//
// O defeito que este arquivo trava foi encontrado em produção, com a suíte
// verde: `mpDataMovimento` cai para o campo `data` quando não há vencimento, e
// `data` é carimbo de escrituração, não data do dinheiro. `criarTransferencia`
// normaliza para MEIO-DIA (`dataStr + 'T12:00:00'`, para o fuso não puxar o dia
// para trás). Uma transferência feita de manhã nascia com `data` até doze horas
// no futuro: a perna de SAÍDA entrava no caixa pela competência, a de ENTRADA
// não entrava por nada, e o patrimônio encolhia pelo valor transferido numa
// operação que só troca dinheiro de bolso.
//
// POR QUE A VARREDURA POR HORA. O defeito é função da HORA em que o teste roda:
// depois do meio-dia local as duas pernas contam e tudo passa. Rodando à tarde,
// como se roda ao desenvolver, a suíte fica verde; o CI roda de madrugada em
// UTC e fica vermelha. Uma trava que só vale meio dia não é trava — por isso
// aqui o relógio é FINGIDO e as 24 horas são percorridas.

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Roda `corpo(sandbox, hoje)` com o relógio parado numa hora específica de hoje.
 * `hoje()` devolve o 'AAAA-MM-DD' daquele instante — é o que o campo de data do
 * modal de transferência entrega, e é o que dispara a normalização para o
 * meio-dia dentro de criarTransferencia.
 * Os módulos são recarregados DENTRO do relógio fingido: eles capturam `Date`
 * no topo, então trocar depois não teria efeito.
 */
function naHora(hora, corpo) {
  const agora = new Date();
  const falso = new Date(
    agora.getFullYear(),
    agora.getMonth(),
    agora.getDate(),
    hora,
    7,
    0
  ).getTime();
  const RealDate = Date;
  const realNow = Date.now;
  Date.now = () => falso;
  global.Date = class extends RealDate {
    constructor(...a) {
      return a.length ? new RealDate(...a) : new RealDate(falso);
    }
    static now() {
      return falso;
    }
  };
  try {
    for (const k of Object.keys(require.cache)) delete require.cache[k];
    const { carregarApp } = require('./_harness-integracao.js');
    const d = new global.Date();
    const hoje = () =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
      `${String(d.getDate()).padStart(2, '0')}`;
    return corpo(carregarApp({}), hoje);
  } finally {
    global.Date = RealDate;
    Date.now = realNow;
  }
}

test('INV-24: transferência não muda o patrimônio — em qualquer hora do dia', () => {
  const falhas = [];
  for (let h = 0; h < 24; h++) {
    const delta = naHora(h, (s, hoje) => {
      const a = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 1000 });
      const b = s.criarConta({ nome: 'Itaú', tipo: 'banco', saldoInicial: 0 });
      const antes = s.mpCalcularSaldoTotal(Date.now());
      const t = s.criarTransferencia(a.id, b.id, 300, hoje());
      if (!t) return 'RECUSADA';
      return Math.round((s.mpCalcularSaldoTotal(Date.now()) - antes) * 100) / 100;
    });
    if (delta !== 0) falhas.push(`${String(h).padStart(2, '0')}h: delta ${delta}`);
  }
  assert.equal(
    falhas.length,
    0,
    'transferência criou ou destruiu dinheiro — a perna de entrada não contou:\n  ' +
      falhas.join('\n  ')
  );
});

test('INV-24: as duas pernas da transferência entram no caixa juntas', () => {
  // O teste acima olha o total; este olha CADA conta, para o caso de as duas
  // pernas errarem em direções que se cancelam no agregado.
  const falhas = [];
  for (let h = 0; h < 24; h++) {
    const r = naHora(h, (s, hoje) => {
      const a = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 1000 });
      const b = s.criarConta({ nome: 'Itaú', tipo: 'banco', saldoInicial: 0 });
      s.criarTransferencia(a.id, b.id, 300, hoje());
      const saldos = s.saldoCaixaPorConta();
      return { origem: saldos[a.id] || 0, destino: saldos[b.id] || 0 };
    });
    if (r.origem !== 700 || r.destino !== 300) {
      falhas.push(`${String(h).padStart(2, '0')}h: origem=${r.origem} destino=${r.destino}`);
    }
  }
  assert.equal(
    falhas.length,
    0,
    'esperava origem=700 e destino=300 em toda hora:\n  ' + falhas.join('\n  ')
  );
});

test('INV-24: o salário do dia 10 não aparece no saldo do dia 1º', () => {
  // A propriedade original da INV-24, na direção oposta: a entrada não pode
  // adiantar. Fica aqui para que o conserto do adiantamento e o conserto do
  // atraso não possam se desfazer um ao outro sem alguém notar.
  const { carregarApp } = require('./_harness-integracao.js');
  const s = carregarApp({});
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 0 });
  const ano = 2027;
  const mes = 0;
  s.transacoes.push({
    id: 'sal',
    categoria: 'receita',
    valor: 5000,
    contaId: conta.id,
    banco: 'Nubank',
    mes,
    ano,
    data: new Date(ano, mes, 10, 12).toISOString(),
    dataVencimento: '2027-01-10',
    pago: false,
  });
  const noDia = (d) => s.saldoCaixaPorConta(new Date(ano, mes, d, 23, 59).getTime())[conta.id] || 0;
  assert.equal(noDia(1), 0, 'no dia 1º o salário do dia 10 já estava no saldo');
  assert.equal(noDia(9), 0, 'na véspera o salário já estava no saldo');
  assert.equal(noDia(10), 5000, 'no dia do vencimento o salário tem de estar no saldo');
});

test('INV-24: a entrada sem vencimento conta pela competência, nunca por `data`', () => {
  // O caso do lançamento recorrente: as 60 parcelas nascem no mesmo instante,
  // e esse instante não tem relação com o mês de cada uma.
  const { carregarApp } = require('./_harness-integracao.js');
  const s = carregarApp({});
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 0 });
  const criadoEm = new Date(2027, 5, 30, 23, 0).toISOString(); // muito depois
  s.transacoes.push({
    id: 'rec1',
    categoria: 'receita',
    valor: 1000,
    contaId: conta.id,
    banco: 'Nubank',
    mes: 0,
    ano: 2027,
    data: criadoEm,
    pago: false,
  });
  const emJaneiro = s.saldoCaixaPorConta(new Date(2027, 0, 15).getTime())[conta.id] || 0;
  assert.equal(emJaneiro, 1000, 'a parcela de janeiro foi jogada para junho pelo campo `data`');
});

test('INV-24: mpTransacaoComputaCaixa não consulta o campo `data` da entrada', () => {
  // A trava estrutural. Os testes acima acusam o sintoma; este acusa o atalho
  // que o produz, mesmo que alguém o reintroduza num caminho que eles não
  // exercitem. `mpDataMovimento` é útil em outros lugares — o que não pode é
  // decidir caixa de entrada, porque ela cai para `data`.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'web/appliquei-patrimonio.js'), 'utf8');

  const iCorpo = src.indexOf('function mpTransacaoComputaCaixa');
  assert.ok(iCorpo > 0, 'mpTransacaoComputaCaixa não encontrada');
  const corpo = src.slice(iCorpo, src.indexOf('\nfunction ', iCorpo + 1));
  assert.ok(
    !/mpDataMovimento/.test(corpo),
    'mpTransacaoComputaCaixa voltou a usar mpDataMovimento, que cai para o campo `data` ' +
      '(carimbo de escrituração) e faz a transferência do período da manhã sumir do caixa'
  );
  assert.ok(
    /mpQuandoEntraNoCaixa/.test(corpo),
    'a data da entrada tem de vir de mpQuandoEntraNoCaixa (vencimento, ou competência)'
  );

  const iData = src.indexOf('function mpQuandoEntraNoCaixa');
  assert.ok(iData > 0, 'mpQuandoEntraNoCaixa não encontrada');
  const corpoData = src.slice(iData, src.indexOf('\nfunction ', iData + 1));
  assert.ok(
    !/\bt\.data\b/.test(corpoData),
    'mpQuandoEntraNoCaixa passou a ler t.data — é o carimbo de escrituração, não a data do dinheiro'
  );
});
