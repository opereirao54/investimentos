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

// Janela que começa no mês de hoje, com a sobra acumulada dada mês a mês.
function janelaDeHoje(acumulados) {
  const h = new Date();
  let ant = 0;
  return acumulados.map((acum, i) => {
    const d = new Date(h.getFullYear(), h.getMonth() + i, 1);
    const m = mes(d.getMonth(), d.getFullYear(), 6000, 6000 - (acum - ant), acum, ant);
    ant = acum;
    return m;
  });
}

test('celular: o topo responde "vai faltar dinheiro?" antes dos números', () => {
  const s = carregarApp({}, ORDEM);
  const folgado = s.projHtmlTopo(s.projPreparar({ meses: janelaDeHoje([900, 300, 1200]) }));
  assert.match(folgado, /Vai faltar dinheiro\?/);
  assert.match(folgado, /Não, em nenhum mês/);
  assert.match(folgado, /O mês mais apertado é/);
  // Só há previsto na linha: a legenda não fala em "já aconteceu".
  assert.doesNotMatch(folgado, /já aconteceu/);
  // O valor do menor ponto e o do fim vão escritos na linha.
  assert.equal((folgado.match(/pj-svg-rot/g) || []).length, 2);

  const aperto = s.projHtmlTopo(s.projPreparar({ meses: janelaDeHoje([900, -400, -700, 500]) }));
  assert.match(aperto, /Sim, em /);
  assert.match(aperto, /Faltam <b[^>]*>R\$ 400<\/b>/);
  // O pior ponto vem depois do primeiro mês negativo: a frase diz os dois.
  assert.match(aperto, /O pior ponto é [^:]+: <b[^>]*>−R\$ 700<\/b>/);
});

test('web: o topo segue com o número do fim do horizonte', () => {
  const s = carregarApp({}, ORDEM);
  const web = s.projHtmlTopo(s.projPreparar({ meses: janelaDeHoje([900, 300, 1200]), web: true }));
  assert.match(web, /você deve ter/);
  assert.doesNotMatch(web, /Vai faltar dinheiro\?/);
});

test('celular: o mês aberto esconde linha zerada e separa sobra do mês de acumulada', () => {
  const s = carregarApp({}, ORDEM);
  const meses = janelaDeHoje([900, 300]);
  const cel = s.projHtmlMes(s.projPreparar({ meses }), 0);
  assert.doesNotMatch(cel, /Resgates \(venda de ativos\)/);
  assert.doesNotMatch(cel, /Sonhos \(separado/);
  assert.match(cel, /Sobra do mês/);
  assert.match(cel, /Sobra acumulada/);
  assert.doesNotMatch(cel, /Resultado do mês/);
  const web = s.projHtmlMes(s.projPreparar({ meses, web: true }), 0);
  assert.match(web, /Resgates \(venda de ativos\)/);
  assert.match(web, /Resultado do mês/);
});

test('celular: "o que muda" abre com as primeiras linhas e o resto a um toque', () => {
  const h = new Date();
  const s = carregarApp({}, ORDEM);
  s.transacoes.length = 0;
  for (let i = 1; i <= 6; i++) {
    const d = new Date(h.getFullYear(), h.getMonth() + i, 5);
    s.transacoes.push({
      id: 'u' + i,
      descricao: 'Conta ' + i,
      categoria: 'despesa_fixa',
      valor: 400 + i,
      mes: d.getMonth(),
      ano: d.getFullYear(),
    });
  }
  const p = s.projPreparar({ meses: janelaDeHoje([900, 800, 700, 600, 500, 400, 300]) });
  const curto = s.projHtmlOQueMuda(p, 4);
  assert.equal((curto.match(/pj-muda-l/g) || []).length, 4);
  assert.match(curto, /Ver mais 2/);
  const tudo = s.projHtmlOQueMuda(p);
  assert.equal((tudo.match(/pj-muda-l/g) || []).length, 6);
  assert.doesNotMatch(tudo, /Ver mais/);
});
