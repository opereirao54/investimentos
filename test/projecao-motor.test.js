'use strict';

// Motor da projeção de investimentos (sub-aba "Futuro").
//
// O arquivo em web/ é classic script, mas termina com module.exports para
// poder ser exercitado aqui sem DOM, sem Chart.js e sem rede — mesmo contrato
// do motor da Carteira Recomendada.
//
// O que estes testes protegem, em ordem de gravidade se quebrar:
//   1. A projeção não pode ser OTIMISTA por acidente. Aporte que rende no mês
//      em que foi depositado, prêmio somado em vez de composto sobre o IPCA,
//      cenário pessimista acima do provável — todos inflam o número que a
//      pessoa vai usar para decidir quanto guardar.
//   2. O total tem de FECHAR: capital de hoje + aportes + juros = valor final.
//      A tela decompõe exatamente essa soma; se ela não bate, a barra mente.
//   3. Horizonte zero, carteira vazia e taxa zero não podem virar NaN. São os
//      três estados em que a aba nasce antes de a pessoa cadastrar qualquer
//      coisa.

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../web/appliquei-projecao.js');

const TAXAS = { cdi: 0.1, ipca: 0.05, selic: 0.1, fonte: 'BCB' };

/** Erro relativo tolerável em conta de juros compostos longa. */
function perto(a, b, tolerancia = 1e-6) {
  const escala = Math.max(1, Math.abs(b));
  return Math.abs(a - b) / escala <= tolerancia;
}

// ── Conversão de taxas ─────────────────────────────────────────────────────

test('mensal e anual são a mesma taxa em unidades diferentes', () => {
  const anual = 0.12;
  const mensal = P.anualParaMensal(anual);
  assert.ok(mensal > 0.0094 && mensal < 0.0096, `12% a.a. ≈ 0,949% a.m., veio ${mensal}`);
  assert.ok(perto(P.mensalParaAnual(mensal), anual, 1e-12), 'ida e volta tem de fechar');
});

test('taxa inválida vira zero em vez de NaN', () => {
  assert.equal(P.anualParaMensal(undefined), 0);
  assert.equal(P.anualParaMensal(-1), 0);
  assert.equal(P.anualParaMensal('abc'), 0);
  assert.equal(P.mensalParaAnual(null), 0);
});

// ── Premissas por classe ───────────────────────────────────────────────────

test('prêmio real COMPÕE sobre o IPCA, não soma', () => {
  // IPCA 5% + 7% real = 12,35% nominal, não 12%. Somar subestima o nominal e,
  // ao longo de 30 anos, some com dezenas de milhares de reais na projeção.
  const taxa = P.taxaBaseClasse('acoes', TAXAS);
  assert.ok(perto(taxa, 1.05 * 1.07 - 1), `esperava 12,35%, veio ${(taxa * 100).toFixed(2)}%`);
});

test('classe indexada ao CDI acompanha o CDI do dia', () => {
  assert.ok(perto(P.taxaBaseClasse('reserva_emergencia', TAXAS), 0.1));
  assert.ok(perto(P.taxaBaseClasse('renda_fixa', TAXAS), 0.1));
  // Um CDI mais alto tem de subir a projeção da reserva na mesma proporção.
  const comCdiAlto = P.taxaBaseClasse('reserva_emergencia', { cdi: 0.15, ipca: 0.05 });
  assert.ok(perto(comCdiAlto, 0.15));
});

test('toda classe da ordem de exibição tem premissa declarada', () => {
  for (const chave of P.ORDEM_CLASSES) {
    assert.ok(P.PREMISSAS[chave], `classe sem premissa: ${chave}`);
    assert.ok(P.PREMISSAS[chave].rotulo, `classe sem rótulo: ${chave}`);
    assert.ok(P.PREMISSAS[chave].faixa >= 0, `classe sem faixa: ${chave}`);
  }
});

// ── Cenários ───────────────────────────────────────────────────────────────

test('pessimista < provável < otimista, sempre', () => {
  for (const chave of P.ORDEM_CLASSES) {
    const base = P.taxaBaseClasse(chave, TAXAS);
    const faixa = P.PREMISSAS[chave].faixa;
    const baixo = P.taxaCenario(base, faixa, 'conservador');
    const meio = P.taxaCenario(base, faixa, 'base');
    const alto = P.taxaCenario(base, faixa, 'otimista');
    assert.ok(baixo <= meio, `${chave}: pessimista ${baixo} acima do provável ${meio}`);
    assert.ok(meio < alto, `${chave}: otimista ${alto} não supera o provável ${meio}`);
  }
});

test('cripto tem cenário pessimista de PERDA — a faixa não pode ser maquiada', () => {
  const base = P.taxaBaseClasse('cripto', TAXAS);
  const baixo = P.taxaCenario(base, P.PREMISSAS.cripto.faixa, 'conservador');
  assert.ok(baixo < 0, `cenário ruim de cripto tem de ser negativo, veio ${baixo}`);
  assert.ok(baixo >= P.PISO_CONSERVADOR, 'o piso é o que segura a queda');
});

test('o piso do cenário conservador não deixa a curva virar ficção', () => {
  assert.equal(P.taxaCenario(0.02, 5, 'conservador'), P.PISO_CONSERVADOR);
  // O piso vale só para baixo: o otimista não é limitado.
  assert.equal(P.taxaCenario(0.02, 5, 'otimista'), 5.02);
});

// ── Projeção ───────────────────────────────────────────────────────────────

test('sem aporte, é juros compostos puro sobre o capital de hoje', () => {
  const r = P.projetar({
    meses: 120,
    aporteMensal: 0,
    classes: [{ chave: 'renda_fixa', valor: 10000, taxaAnual: 0.1 }],
  });
  // 10 anos a 10% a.a. efetivos: 10.000 × 1,1^10 = 25.937,42
  assert.ok(perto(r.totalFinal, 10000 * Math.pow(1.1, 10), 1e-9), `veio ${r.totalFinal}`);
  assert.equal(r.aportado, 0);
  assert.ok(perto(r.juros, r.totalFinal - 10000, 1e-9));
});

test('o aporte NÃO rende no mês em que entra — a projeção não pode ser otimista', () => {
  // Um mês, capital zero, um aporte de 1.000: o saldo tem de ser exatamente
  // 1.000. Se o aporte rendesse no próprio mês (annuity due), viria 1.008 e a
  // tela estaria devolvendo juros que não existiram.
  const r = P.projetar({
    meses: 1,
    aporteMensal: 1000,
    classes: [{ chave: 'renda_fixa', valor: 0, peso: 1, taxaAnual: 0.1 }],
  });
  assert.ok(perto(r.totalFinal, 1000, 1e-12), `veio ${r.totalFinal}`);
  assert.ok(perto(r.juros, 0, 1e-12), `juros fantasma: ${r.juros}`);
});

test('capital + aportes + juros fecham o total exibido', () => {
  const r = P.projetar({
    meses: 240,
    aporteMensal: 500,
    classes: [
      { chave: 'acoes', valor: 30000, taxaAnual: 0.12 },
      { chave: 'renda_fixa', valor: 20000, taxaAnual: 0.1 },
      { chave: 'reserva_emergencia', valor: 5000, taxaAnual: 0.09 },
    ],
  });
  assert.ok(
    perto(r.totalHoje + r.aportado + r.juros, r.totalFinal, 1e-9),
    'a decomposição da barra não fecha com o número do hero'
  );
  assert.equal(r.aportado, 500 * 240);
  assert.ok(perto(r.totalHoje, 55000, 1e-12));
});

test('a soma das classes é o total, em todo ponto da série', () => {
  const r = P.projetar({
    meses: 60,
    aporteMensal: 300,
    classes: [
      { chave: 'acoes', valor: 8000, taxaAnual: 0.12 },
      { chave: 'fiis', valor: 2000, taxaAnual: 0.11 },
    ],
  });
  const somaClasses = r.porClasse.reduce((s, c) => s + c.valorFinal, 0);
  assert.ok(perto(somaClasses, r.totalFinal, 1e-9), 'classe por classe não soma o total');
  // E os pesos do aporte, que a tela promete distribuir "na proporção de hoje".
  assert.ok(perto(r.porClasse[0].peso, 0.8, 1e-12));
  assert.ok(perto(r.porClasse[1].peso, 0.2, 1e-12));
});

test('a série tem um ponto por mês, começando em hoje', () => {
  const r = P.projetar({
    meses: 12,
    aporteMensal: 0,
    classes: [{ chave: 'renda_fixa', valor: 1000, taxaAnual: 0.1 }],
  });
  assert.equal(r.pontos.length, 13, 'mês 0 (hoje) mais os 12 projetados');
  assert.equal(r.pontos[0].mes, 0);
  assert.equal(r.pontos[0].total, 1000);
  assert.equal(r.pontos[12].mes, 12);
  assert.ok(perto(r.pontos[12].total, r.totalFinal, 1e-12));
  // Monotonia: com taxa positiva e sem resgate, a curva nunca desce.
  for (let i = 1; i < r.pontos.length; i++) {
    assert.ok(r.pontos[i].total >= r.pontos[i - 1].total, `curva desceu no mês ${i}`);
  }
});

test('taxa zero devolve exatamente o que entrou — sem NaN, sem divisão por zero', () => {
  const r = P.projetar({
    meses: 24,
    aporteMensal: 100,
    classes: [{ chave: 'reserva_emergencia', valor: 1000, taxaAnual: 0 }],
  });
  assert.ok(perto(r.totalFinal, 1000 + 100 * 24, 1e-12), `veio ${r.totalFinal}`);
  assert.ok(perto(r.juros, 0, 1e-12));
});

test('carteira vazia e horizonte zero não produzem NaN', () => {
  const vazia = P.projetar({ meses: 120, aporteMensal: 0, classes: [] });
  assert.equal(vazia.totalFinal, 0);
  assert.equal(vazia.pontos.length, 121, 'a série mantém um ponto por mês, ainda que zerada');
  assert.ok(Number.isFinite(vazia.juros));
  assert.ok(
    vazia.pontos.every((p) => p.total === 0),
    'carteira vazia não pode render nada'
  );

  const agora = P.projetar({
    meses: 0,
    aporteMensal: 500,
    classes: [{ chave: 'acoes', valor: 1234.56, taxaAnual: 0.12 }],
  });
  assert.equal(agora.totalFinal, 1234.56);
  assert.equal(agora.aportado, 0);
  assert.equal(agora.juros, 0);
});

test('aporte em carteira zerada é distribuído em vez de sumir', () => {
  // Sem peso informado e sem valor de partida, a divisão por zero deixaria os
  // pesos NaN e o aporte inteiro desapareceria da projeção.
  const r = P.projetar({
    meses: 12,
    aporteMensal: 200,
    classes: [
      { chave: 'acoes', valor: 0, peso: 1, taxaAnual: 0.12 },
      { chave: 'renda_fixa', valor: 0, peso: 1, taxaAnual: 0.1 },
    ],
  });
  assert.ok(r.totalFinal > 200 * 12 * 0.99, `o aporte sumiu: ${r.totalFinal}`);
  assert.ok(Number.isFinite(r.totalFinal));
});

test('aporte negativo é tratado como zero — a aba não saca dinheiro', () => {
  const r = P.projetar({
    meses: 12,
    aporteMensal: -500,
    classes: [{ chave: 'renda_fixa', valor: 1000, taxaAnual: 0.1 }],
  });
  assert.equal(r.aportado, 0);
  assert.ok(r.totalFinal > 1000);
});

// ── Marcos ─────────────────────────────────────────────────────────────────

test('o marco é encontrado no mês em que a curva cruza o alvo', () => {
  const r = P.projetar({
    meses: 480,
    aporteMensal: 0,
    classes: [{ chave: 'renda_fixa', valor: 10000, taxaAnual: 0.1 }],
  });
  const meses = P.mesesParaAlvo(r.pontos, 20000);
  // Dobrar a 10% a.a. leva ln2/ln1,1 ≈ 7,27 anos ≈ 87,3 meses.
  assert.ok(meses > 86 && meses < 89, `esperava ~87 meses, veio ${meses}`);
  // Coerência com a série: no mês seguinte ao cruzamento já passou do alvo.
  assert.ok(r.pontos[Math.ceil(meses)].total >= 20000);
  assert.ok(r.pontos[Math.floor(meses)].total <= 20000);
});

test('alvo já alcançado hoje devolve zero, e alvo inatingível devolve null', () => {
  const r = P.projetar({
    meses: 12,
    aporteMensal: 0,
    classes: [{ chave: 'renda_fixa', valor: 10000, taxaAnual: 0.1 }],
  });
  assert.equal(P.mesesParaAlvo(r.pontos, 5000), 0);
  assert.equal(P.mesesParaAlvo(r.pontos, 1e9), null);
  assert.equal(P.mesesParaAlvo([], 100), null);
});

test('os marcos estão em ordem crescente — a régua não pode voltar no tempo', () => {
  for (let i = 1; i < P.MARCOS.length; i++) {
    assert.ok(P.MARCOS[i] > P.MARCOS[i - 1], `marco fora de ordem em ${i}`);
  }
});

// ── Inflação ───────────────────────────────────────────────────────────────

test('o valor de hoje é sempre MENOR que o nominal quando há inflação', () => {
  const nominal = 100000;
  const real = P.deflacionar(nominal, 0.05, 10);
  assert.ok(real < nominal, 'deflacionar tem de reduzir');
  assert.ok(perto(real, nominal / Math.pow(1.05, 10), 1e-9), `veio ${real}`);
});

test('deflacionar com entrada inválida devolve o próprio valor', () => {
  assert.equal(P.deflacionar(1000, undefined, 10), 1000);
  assert.equal(P.deflacionar(1000, 0.05, 0), 1000);
  assert.equal(P.deflacionar(1000, -1, 10), 1000);
});

test('juro real zero: renda fixa em 100% do CDI com CDI igual ao IPCA não cria patrimônio', () => {
  // Cenário-controle do toggle "valores de hoje": se o CDI empata com a
  // inflação, dez anos de renda fixa não aumentam poder de compra nenhum.
  const taxas = { cdi: 0.05, ipca: 0.05 };
  const taxa = P.taxaBaseClasse('renda_fixa', taxas);
  const r = P.projetar({
    meses: 120,
    aporteMensal: 0,
    classes: [{ chave: 'renda_fixa', valor: 10000, taxaAnual: taxa }],
  });
  const real = P.deflacionar(r.totalFinal, taxas.ipca, 10);
  assert.ok(perto(real, 10000, 1e-9), `poder de compra deveria ficar igual, veio ${real}`);
});
