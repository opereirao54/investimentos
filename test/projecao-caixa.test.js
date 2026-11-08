'use strict';

// Projeção do caixa (web/appliquei-projecao-caixa.js): o resumo do topo, o
// motivo do mês negativo, a receita não lançada, "o que muda" e o "E se…?".

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-projecao-caixa.js']);

function mes(mes, ano, receita, despesas, acumulado, carregado) {
  return {
    mes,
    ano,
    receita,
    resgate: 0,
    despesas,
    invFixo: 0,
    invVar: 0,
    sonho: 0,
    saldoAcumulado: acumulado,
    saldoCarregado: carregado,
  };
}

const JANELA = [
  mes(10, 2026, 6000, 5300, 700, 0),
  mes(11, 2026, 6000, 5300, 1400, 700),
  mes(0, 2027, 6000, 7750, -350, 1400),
  mes(1, 2027, 6000, 5200, 450, -350),
  mes(2, 2027, 0, 5200, -4750, 450),
];

test('resumo: final, menor ponto, primeiro negativo e sobra média', () => {
  const s = carregarApp({}, ORDEM);
  const r = s.projResumo(JANELA, 0);
  assert.equal(r.final, -4750);
  assert.equal(r.primeiroNeg, 2);
  assert.equal(r.menorIdx, 4);
  // Sobras do mês: 700, 700, −1750, 800, −5200 → média −950.
  assert.equal(Math.round(r.mediaSobra), -950);
});

test('receita não lançada: o primeiro mês futuro sem entrada', () => {
  const s = carregarApp({}, ORDEM);
  assert.equal(s.projSemReceita(JANELA, 0), 4);
  assert.equal(s.projSemReceita(JANELA.slice(0, 4), 0), -1);
  // Quem nunca lançou receita não recebe o aviso.
  assert.equal(
    s.projSemReceita(
      JANELA.map((m) => Object.assign({}, m, { receita: 0 })),
      0
    ),
    -1
  );
});

test('simular: à vista tira tudo no mês; parcelado divide; entrada mensal soma todo mês', () => {
  const s = carregarApp({}, ORDEM);
  const vals = [100, 200, 300, 400];
  assert.deepEqual(Array.from(s.projSimularSerie(vals, 1, 300, 1, -1)), [100, -100, 0, 100]);
  assert.deepEqual(Array.from(s.projSimularSerie(vals, 1, 300, 3, -1)), [100, 100, 100, 100]);
  assert.deepEqual(Array.from(s.projSimularSerie(vals, 2, 50, 1, 1, true)), [100, 200, 350, 500]);
});

test('resposta do "E se…?": à vista deixa negativo; sugere parcelar ou esperar', () => {
  const s = carregarApp({}, ORDEM);
  const vals = [500, 1000, 1500, 2000, 2500, 3000];
  const r = s.projSimResposta(vals, 1, 1800, '1', 'compra', ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(r.neg, 1);
  const par = r.alternativas.find((a) => a.tipo === 'parcelas');
  assert.equal(par.n, 3);
  const esp = r.alternativas.find((a) => a.tipo === 'esperar');
  assert.equal(esp.rotulo, 'd');
  const ok = s.projSimResposta(vals, 1, 300, '1', 'compra');
  assert.equal(ok.neg, -1);
  assert.equal(ok.dif, -300);
  const ent = s.projSimResposta(vals, 2, 100, 'mensal', 'entrada');
  assert.equal(ent.dif, 400);
});

test('motivo do negativo e o que muda saem dos lançamentos', () => {
  const s = carregarApp({}, ORDEM);
  s.transacoes.length = 0;
  const add = (id, descricao, valor, mes, ano, extra) =>
    s.transacoes.push(
      Object.assign(
        { id, descricao, valor, mes, ano, categoria: 'despesa_fixa', pago: false },
        extra || {}
      )
    );
  [10, 11, 0, 1, 2].forEach((m, k) =>
    add('alug' + k, 'Aluguel', 2150, m, k < 2 ? 2026 : 2027, { groupId: 'galug' })
  );
  add('ipva', 'IPVA', 1900, 0, 2027, { categoria: 'despesa_variavel' });
  add('matr', 'Matrícula', 600, 0, 2027, { categoria: 'despesa_variavel' });
  // TV parcelada: termina em janeiro.
  [10, 11, 0].forEach((m, k) =>
    add('tv' + k, 'TV (' + (k + 1) + '/3)', 440, m, k < 2 ? 2026 : 2027, {
      groupId: 'gtv',
      categoria: 'cartao_credito',
    })
  );
  const mot = s.projMotivoNegativo(JANELA, 2, 0);
  assert.deepEqual(
    Array.from(mot.culpados, (c) => c.desc),
    ['IPVA', 'Matrícula']
  );
  assert.equal(mot.falta, 350);
  assert.equal(mot.guardarPorMes, 175);
  const ev = s.projOQueMuda(JANELA, 0);
  const titulos = Array.from(ev, (e) => e.titulo);
  assert.ok(titulos.includes('IPVA'));
  assert.ok(titulos.includes('Matrícula'));
  assert.ok(
    titulos.some((t) => /^Acaba a parcela de tv/i.test(t)),
    titulos.join(' | ')
  );
  const tv = ev.find((e) => /tv/i.test(e.titulo));
  assert.equal(tv.mes, 1);
  assert.equal(tv.valor, 440);
});
