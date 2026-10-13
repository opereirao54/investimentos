'use strict';

// Faturas do cartão e extrato por dia — Controle financeiro.
//
// 1) A FATURA PAGA "SUMIA". Não o dado (pagar só marca os lançamentos como
//    pagos): a tela. O único lugar que mostrava a fatura como fatura era o
//    painel de Vencimentos, que só lista o que falta pagar. A tela de Faturas
//    (web/appliquei-faturas.js) mostra todo ciclo do cartão, pago ou não, com
//    status derivado dos lançamentos — sem gravar entidade nova.
//
// 2) O EXTRATO SÓ ORDENAVA POR VALOR. Agora abre por data, agrupado por dia
//    com subtotal, e o cartão entra como UMA linha por fatura.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const CF = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba-controle-financeiro.js'), 'utf8');

const HOJE = new Date(2026, 9, 13); // 13/out/2026
const ymd = (d) => d.toISOString().slice(0, 10);

function mundo() {
  const s = carregarApp({}, ORDEM_CONTROLE.concat(['web/appliquei-faturas.js']));
  s.cartoes.length = 0;
  s.cartoes.push({
    id: 'card_nu',
    nome: 'Nubank',
    limite: 5000,
    diaFechamento: 5,
    diaVencimento: 15,
    contaPagadoraId: 'conta_itau',
  });
  s.transacoes.length = 0;
  return s;
}

let seq = 0;
function compra(s, venc, valor, extra) {
  const [a, m] = venc.split('-').map(Number);
  const t = Object.assign(
    {
      id: 'c' + ++seq,
      descricao: 'Compra ' + seq,
      valor,
      categoria: 'cartao_credito',
      cartaoId: 'card_nu',
      mes: m - 1,
      ano: a,
      data: new Date(a, m - 2, 20).toISOString(),
      dataVencimento: venc,
      pago: false,
    },
    extra || {}
  );
  s.transacoes.push(t);
  return t;
}

// ---------------------------------------------------------------------------
// Ciclo da fatura
// ---------------------------------------------------------------------------

test('o fechamento de uma fatura espelha a regra de compra', () => {
  const s = mundo();
  // Vence 15, fecha 5: fecha no mesmo mês do vencimento.
  assert.equal(ymd(s.faturaFechamentoDe(new Date(2026, 9, 15, 12), 5, 15)), '2026-10-05');
  // Vence 5, fecha 25: o vencimento cai no mês seguinte ao fechamento.
  assert.equal(ymd(s.faturaFechamentoDe(new Date(2026, 10, 5, 12), 25, 5)), '2026-10-25');
  // Fecha 31 em fevereiro: o dia é limitado ao tamanho do mês.
  assert.equal(
    s.faturaFechamentoDe(new Date(2027, 2, 10), 31, 10).getDate(),
    28,
    'fevereiro de 2027 tem 28 dias'
  );
});

test('a fatura PAGA continua na lista, com status "paga" — o defeito do sumiço', () => {
  const s = mundo();
  compra(s, '2026-09-15', 300, { pago: true, pagoEm: '2026-09-14T12:00:00.000Z' });
  compra(s, '2026-10-15', 200);
  const ciclos = s.faturasDoCartao('card_nu', HOJE);
  const set = ciclos.find((c) => c.vencimento === '2026-09-15');
  assert.ok(set, 'a fatura de setembro, paga, tem de existir');
  assert.equal(set.status, 'paga');
  assert.equal(set.total, 300);
  assert.equal(set.pagoEm, '2026-09-14T12:00:00.000Z');
});

test('cada ciclo tem o status certo: vencida, fechada, aberta, futura', () => {
  const s = mundo();
  compra(s, '2026-08-15', 90); // venceu sem pagar
  compra(s, '2026-10-15', 200); // fechou 05/10, vence 15/10
  compra(s, '2026-11-15', 120); // ciclo aberto (fecha 05/11)
  compra(s, '2026-12-15', 50); // parcela futura
  const st = Object.fromEntries(
    s.faturasDoCartao('card_nu', HOJE).map((c) => [c.vencimento, c.status])
  );
  assert.equal(st['2026-08-15'], 'vencida');
  assert.equal(st['2026-10-15'], 'fechada');
  assert.equal(st['2026-11-15'], 'aberta');
  assert.equal(st['2026-12-15'], 'futura');
});

test('a fatura atual existe mesmo sem compra nenhuma', () => {
  // "Fatura atual" precisa abrir algo no primeiro dia do ciclo.
  const s = mundo();
  const ciclos = s.faturasDoCartao('card_nu', HOJE);
  const atual = ciclos.find((c) => c.atual);
  assert.ok(atual);
  assert.equal(atual.vencimento, '2026-11-15');
  assert.equal(atual.status, 'aberta');
});

test('comprar NO dia do fechamento ainda entra na fatura: ela só fecha no dia seguinte', () => {
  const s = mundo();
  compra(s, '2026-10-15', 100);
  const noDia = s.faturasDoCartao('card_nu', new Date(2026, 9, 5));
  assert.equal(noDia.find((c) => c.vencimento === '2026-10-15').status, 'aberta');
  const depois = s.faturasDoCartao('card_nu', new Date(2026, 9, 6));
  assert.equal(depois.find((c) => c.vencimento === '2026-10-15').status, 'fechada');
});

test('a tela abre na fatura mais antiga que ainda tem coisa a pagar', () => {
  const s = mundo();
  compra(s, '2026-09-15', 80, { pago: true });
  compra(s, '2026-10-15', 200);
  const ciclos = s.faturasDoCartao('card_nu', HOJE);
  assert.equal(ciclos[s.faturaIndicePadrao(ciclos)].vencimento, '2026-10-15');
});

test('pagar a fatura debita a conta pagadora (INV-17) e desfazer volta tudo', () => {
  const s = mundo();
  const a = compra(s, '2026-10-15', 200);
  const b = compra(s, '2026-10-15', 50, { pago: true, pagoEm: 'x', contaId: 'conta_itau' });
  const outra = compra(s, '2026-11-15', 70);
  assert.equal(s.faturaBaixar('card_nu', '2026-10-15'), 1, 'só o que faltava pagar');
  assert.equal(a.pago, true);
  assert.ok(a.pagoEm, 'pagamento explícito carimba a data');
  assert.equal(a.contaId, 'conta_itau', 'sai da conta pagadora do cartão');
  assert.equal(outra.pago, false, 'a fatura seguinte não é tocada');
  const ciclo = s.faturasDoCartao('card_nu', HOJE).find((c) => c.vencimento === '2026-10-15');
  assert.equal(ciclo.status, 'paga');

  assert.equal(s.faturaDesfazer('card_nu', '2026-10-15'), 2);
  assert.equal(a.pago, false);
  assert.equal(b.pago, false);
  const volta = s.faturasDoCartao('card_nu', HOJE).find((c) => c.vencimento === '2026-10-15');
  assert.equal(volta.status, 'fechada');
});

test('pagamento parcial: a fatura mostra quanto falta', () => {
  const s = mundo();
  compra(s, '2026-10-15', 200);
  compra(s, '2026-10-15', 50, { pago: true });
  const c = s.faturasDoCartao('card_nu', HOJE).find((x) => x.vencimento === '2026-10-15');
  assert.equal(c.status, 'fechada');
  assert.equal(c.qtdPagos, 1);
  assert.equal(c.aPagar, 200);
});

test('id de cartão desconhecido não cai no primeiro cartão (INV-20)', () => {
  const s = mundo();
  compra(s, '2026-10-15', 200);
  assert.deepEqual(
    Array.from(s.faturasDoCartao('card_fantasma', HOJE), (c) => c.total),
    [],
    'obterCartao devolveria o Nubank; a tela não pode mostrar a fatura dele com outro nome'
  );
});

// ---------------------------------------------------------------------------
// Extrato por dia
// ---------------------------------------------------------------------------

test('o dia do lançamento: vencimento, ou o dia do cadastro levado ao mês da competência', () => {
  const s = mundo();
  // Com vencimento, vale o vencimento.
  assert.equal(
    s.extratoDiaDe({ dataVencimento: '2026-10-10', data: '2026-09-01T10:00:00' }, 9, 2026),
    '2026-10-10'
  );
  // Recorrente: os 60 meses têm a MESMA data de cadastro. O de dezembro
  // aparece no dia 12 de dezembro, não em "12 de outubro".
  assert.equal(
    s.extratoDiaDe({ data: new Date(2026, 9, 12, 9).toISOString() }, 11, 2026),
    '2026-12-12'
  );
  // Dia 31 num mês de 30 dias.
  assert.equal(
    s.extratoDiaDe({ data: new Date(2026, 9, 31, 9).toISOString() }, 10, 2026),
    '2026-11-30'
  );
  // Sem data nenhuma: dia 1.
  assert.equal(s.extratoDiaDe({}, 9, 2026), '2026-10-01');
});

const lanc = (id, categoria, valor, dia, extra) =>
  Object.assign(
    {
      id,
      descricao: id,
      categoria,
      valor,
      mes: 9,
      ano: 2026,
      data: new Date(2026, 9, dia, 10).toISOString(),
    },
    extra || {}
  );

test('o cartão vira UMA linha por fatura, no dia do vencimento', () => {
  const s = mundo();
  const lista = [
    lanc('mercado', 'cartao_credito', 300, 2, {
      cartaoId: 'card_nu',
      dataVencimento: '2026-10-15',
    }),
    lanc('posto', 'cartao_credito', 150, 3, { cartaoId: 'card_nu', dataVencimento: '2026-10-15' }),
    lanc('salario', 'receita', 5000, 5),
  ];
  const grupos = s.extratoAgrupar(lista, 'recentes', 9, 2026);
  const faturas = grupos.flatMap((g) => g.entradas).filter((e) => e.tipo === 'fatura');
  assert.equal(faturas.length, 1);
  assert.equal(faturas[0].total, 450);
  assert.equal(faturas[0].itens.length, 2);
  assert.equal(grupos[0].dia, '2026-10-15', 'a fatura entra no dia em que vence');
});

test('mais recentes: dias do último para o primeiro; mais antigos: ao contrário', () => {
  const s = mundo();
  const lista = [
    lanc('a', 'despesa_variavel', 10, 2),
    lanc('b', 'despesa_variavel', 20, 9),
    lanc('c', 'despesa_variavel', 30, 9),
    lanc('d', 'receita', 40, 5),
  ];
  const rec = s.extratoAgrupar(lista, 'recentes', 9, 2026);
  assert.deepEqual(
    Array.from(rec, (g) => g.dia),
    ['2026-10-09', '2026-10-05', '2026-10-02']
  );
  assert.equal(rec[0].entradas.length, 2, 'dois lançamentos no dia 9, um cabeçalho só');
  const ant = s.extratoAgrupar(lista, 'antigos', 9, 2026);
  assert.deepEqual(
    Array.from(ant, (g) => g.dia),
    ['2026-10-02', '2026-10-05', '2026-10-09']
  );
});

test('maior valor: uma lista só, e a fatura conta pelo total', () => {
  const s = mundo();
  const lista = [
    lanc('aluguel', 'despesa_fixa', 1500, 5, { dataVencimento: '2026-10-05' }),
    lanc('m1', 'cartao_credito', 900, 2, { cartaoId: 'card_nu', dataVencimento: '2026-10-15' }),
    lanc('m2', 'cartao_credito', 800, 3, { cartaoId: 'card_nu', dataVencimento: '2026-10-15' }),
    lanc('cafe', 'despesa_variavel', 8, 9),
  ];
  const g = s.extratoAgrupar(lista, 'valor', 9, 2026);
  assert.equal(g.length, 1);
  assert.equal(g[0].dia, null, 'por valor não há cabeçalho de dia');
  assert.deepEqual(
    Array.from(g[0].entradas, (e) => (e.tipo === 'fatura' ? 'fatura' : e.t.id)),
    ['fatura', 'aluguel', 'cafe'],
    'a fatura de R$ 1.700 pesa mais que o aluguel'
  );
});

test('o rótulo do dia diz hoje e ontem', () => {
  const s = mundo();
  assert.match(s.extratoRotuloDia('2026-10-13', HOJE), /^Hoje · 13 out$/);
  assert.match(s.extratoRotuloDia('2026-10-12', HOJE), /^Ontem · 12 out$/);
  assert.match(s.extratoRotuloDia('2026-10-09', HOJE), /^9 out · sex$/);
  // Dia que ainda não chegou é compromisso, não fato.
  assert.match(s.extratoRotuloDia('2026-10-20', HOJE), /^20 out · ter · previsto$/);
});

test('origem: cartão, conta, banco digitado ou sem conta', () => {
  const s = mundo();
  assert.equal(
    s.extratoOrigemDe({ categoria: 'cartao_credito', cartaoId: 'card_nu' }).rotulo,
    'Nubank'
  );
  assert.equal(s.extratoOrigemDe({ categoria: 'receita', banco: 'Inter' }).chave, 'banco:Inter');
  assert.equal(s.extratoOrigemDe({ categoria: 'receita' }).chave, 'sem');
});

// ---------------------------------------------------------------------------
// Ligações na tela
// ---------------------------------------------------------------------------

test('a tela tem Faturas, ordem, conta/cartão e o rodapé do filtro', () => {
  assert.match(HTML, /id="telaFaturas"/);
  assert.match(HTML, /onclick="abrirFaturas\(\)"/, 'botão Faturas no cabeçalho do Controle');
  assert.match(HTML, /id="faturasBtnAtual"[^>]*onclick="faturasIrParaAtual\(\)"/);
  assert.match(HTML, /id="extratoOrdem"[^>]*onchange="mudarOrdemExtrato\(this\.value\)"/);
  assert.match(HTML, /id="extratoOrigem"[^>]*onchange="filtrarExtratoPorOrigem\(this\.value\)"/);
  assert.match(HTML, /id="extratoRodape"/);
  assert.match(HTML, /<script src="\/web\/appliquei-faturas\.js/);
});

test('o card de Vencimentos e o "Ver fatura" do celular abrem a tela de Faturas', () => {
  assert.match(CF, /return abrirFaturas\(grupo\.cartaoId, grupo\.dataVencimento\)/);
});

test('os três filtros se somam, e o de conta/cartão entra no mesmo teste', () => {
  assert.match(
    CF,
    /\(!extratoOrigemAtiva \|\| el\.dataset\.extOrigem === extratoOrigemAtiva\)/,
    'conta/cartão vale junto com tipo e categoria'
  );
  assert.match(CF, /data-ext-origem="\$\{origem\.chave/);
  assert.match(CF, /data-ext-valor="\$\{/, 'o subtotal do dia soma o que está visível');
});
