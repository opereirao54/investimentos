'use strict';

// Regras do INSS usadas na comparação do "Simule sua liberdade".
//
// O simulador antigo comparava o aporte da pessoa (ex.: R$ 3.500/mês) com um
// "INSS" que recebia esse MESMO aporte e rendia 3% ao ano. Não é o INSS: a
// contribuição sai da RENDA e trava no teto, e o retorno não é saldo — é um
// benefício mensal definido por regra. Os números abaixo são conferidos contra
// as regras, não contra o próprio código:
//
//   Contribuição CLT   progressiva por faixa, cada alíquota só sobre a parte
//                      do salário dentro da faixa; nada acima do teto.
//   Coeficiente        60% da média + 2% por ano acima do tempo mínimo
//                      (15 anos mulher / 20 homem), limitado a 100%.
//   Benefício          entre o salário mínimo e o teto.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

function carregar() {
  const ctx = vm.createContext({ Math, Number, JSON, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/appliquei-inss.js'), 'utf8'), ctx);
  return ctx;
}

// Tabela fixa nos testes: eles verificam a REGRA, não os valores do ano — que
// mudam todo janeiro sem que a regra mude.
const T = {
  ano: 2026,
  salarioMinimo: 1621.0,
  teto: 8475.55,
  faixas: [
    { ate: 1621.0, aliquota: 0.075 },
    { ate: 2903.84, aliquota: 0.09 },
    { ate: 4354.27, aliquota: 0.12 },
    { ate: 8475.55, aliquota: 0.14 },
  ],
};

// ---- contribuição -------------------------------------------------------

test('CLT: cada alíquota incide só sobre a sua faixa', () => {
  const w = carregar();
  // Salário mínimo: só a 1ª faixa.
  assert.equal(w.inssContribuicaoMensal(1621, 'clt', T), 121.58);
  // R$ 2.000: 1621×7,5% + 379×9% = 121,575 + 34,11
  assert.equal(w.inssContribuicaoMensal(2000, 'clt', T), 155.69);
  // R$ 3.500: + (2903,84−1621)×9% + (3500−2903,84)×12%
  //         = 121,575 + 115,456 + 71,539 = 308,57
  assert.equal(w.inssContribuicaoMensal(3500, 'clt', T), 308.57);
});

test('CLT: acima do teto a contribuição para de crescer', () => {
  const w = carregar();
  const noTeto = w.inssContribuicaoMensal(8475.55, 'clt', T);
  // 121,575 + 115,456 + 174,052 + (8475,55−4354,27)×14% = 576,979 → 988,06
  assert.ok(Math.abs(noTeto - 988.06) < 0.02, 'contribuição máxima, veio ' + noTeto);
  // É ESTE o ponto do ajuste: quem ganha 30 mil paga o mesmo que quem ganha o teto.
  assert.equal(w.inssContribuicaoMensal(30000, 'clt', T), noTeto);
  assert.equal(w.inssContribuicaoMensal(100000, 'clt', T), noTeto);
});

test('autônomo paga 20%, também travado no teto', () => {
  const w = carregar();
  assert.equal(w.inssContribuicaoMensal(3500, 'autonomo', T), 700);
  assert.equal(w.inssContribuicaoMensal(30000, 'autonomo', T), 1695.11); // 8475,55×20%
  // Abaixo do mínimo, o piso é o próprio mínimo.
  assert.equal(w.inssContribuicaoMensal(800, 'autonomo', T), 324.2); // 1621×20%
});

test('MEI recolhe 5% do mínimo, não importa quanto fature', () => {
  const w = carregar();
  assert.equal(w.inssContribuicaoMensal(3500, 'mei', T), 81.05);
  assert.equal(w.inssContribuicaoMensal(30000, 'mei', T), 81.05);
});

test('renda zero não gera contribuição', () => {
  const w = carregar();
  ['clt', 'autonomo', 'mei'].forEach((v) => {
    assert.equal(w.inssContribuicaoMensal(0, v, T), 0);
    assert.equal(w.inssContribuicaoMensal(-100, v, T), 0);
  });
});

// ---- coeficiente --------------------------------------------------------

test('coeficiente: 60% no tempo mínimo, +2% por ano extra', () => {
  const w = carregar();
  assert.equal(w.inssCoeficiente(15, 'mulher'), 0.6);
  assert.ok(Math.abs(w.inssCoeficiente(20, 'mulher') - 0.7) < 1e-9);
  assert.equal(w.inssCoeficiente(20, 'homem'), 0.6);
  assert.ok(Math.abs(w.inssCoeficiente(30, 'homem') - 0.8) < 1e-9);
});

test('coeficiente não passa de 100%', () => {
  const w = carregar();
  // Mulher chega a 100% com 35 anos; homem com 40.
  assert.equal(w.inssCoeficiente(35, 'mulher'), 1);
  assert.equal(w.inssCoeficiente(50, 'mulher'), 1);
  assert.equal(w.inssCoeficiente(40, 'homem'), 1);
  assert.equal(w.inssCoeficiente(60, 'homem'), 1);
});

test('abaixo do tempo mínimo o coeficiente é zero', () => {
  const w = carregar();
  assert.equal(w.inssCoeficiente(14, 'mulher'), 0);
  assert.equal(w.inssCoeficiente(19, 'homem'), 0);
  assert.equal(w.inssCoeficiente(0, 'mulher'), 0);
});

// ---- benefício ----------------------------------------------------------

test('quem não cumpre o tempo mínimo não se aposenta — e a tela precisa dizer', () => {
  const w = carregar();
  const r = w.inssBeneficio(3500, 10, 'homem', 'clt', T);
  assert.equal(r.qualifica, false);
  assert.equal(r.beneficio, 0);
  assert.equal(r.anosMinimos, 20);
  assert.equal(r.anosFaltando, 10);
  assert.equal(r.idadeMinima, 65);
});

test('benefício = média × coeficiente', () => {
  const w = carregar();
  // Homem, 30 anos: 60% + 2%×10 = 80% de R$ 3.500.
  const r = w.inssBeneficio(3500, 30, 'homem', 'clt', T);
  assert.equal(r.qualifica, true);
  assert.ok(Math.abs(r.coeficiente - 0.8) < 1e-9);
  assert.equal(r.beneficio, 2800);
});

test('benefício não passa do teto nem cai abaixo do mínimo', () => {
  const w = carregar();
  // Renda de 30 mil: a média já é limitada ao teto, e 100% dela é o teto.
  const alto = w.inssBeneficio(30000, 40, 'homem', 'clt', T);
  assert.equal(alto.media, T.teto);
  assert.equal(alto.beneficio, T.teto);
  // Renda no mínimo com coeficiente de 60%: 972,60 seria menos que um mínimo.
  const baixo = w.inssBeneficio(1621, 20, 'homem', 'clt', T);
  assert.equal(baixo.beneficio, T.salarioMinimo);
  assert.equal(baixo.limitadoAoMinimo, true);
});

test('MEI contribui sobre o mínimo, então recebe o mínimo', () => {
  const w = carregar();
  // Fatura R$ 30 mil, mas a base é sempre o salário mínimo.
  const r = w.inssBeneficio(30000, 40, 'homem', 'mei', T);
  assert.equal(r.media, T.salarioMinimo);
  assert.equal(r.beneficio, T.salarioMinimo);
});

// ---- projeção no período do simulador -----------------------------------

test('a projeção usa o MESMO período dos dois lados', () => {
  const w = carregar();
  const p = w.inssProjecao({ renda: 3500, vinculo: 'clt', sexo: 'homem', meses: 120, tabela: T });
  assert.equal(p.meses, 120);
  assert.equal(p.contribuicaoMensal, 308.57);
  assert.equal(p.totalPago, 308.57 * 120);
  // 10 anos de contribuição não aposentam ninguém.
  assert.equal(p.beneficio.qualifica, false);
});

test('anos já contribuídos somam ao período simulado', () => {
  const w = carregar();
  const p = w.inssProjecao({
    renda: 3500,
    vinculo: 'clt',
    sexo: 'homem',
    meses: 120,
    anosJaContribuidos: 15,
    tabela: T,
  });
  assert.equal(p.anosTotais, 25);
  assert.equal(p.beneficio.qualifica, true);
  // 60% + 2%×5 = 70% de R$ 3.500
  assert.equal(p.beneficio.beneficio, 2450);
});

test('a projeção mostra quanto da renda o teto deixou de fora', () => {
  const w = carregar();
  const p = w.inssProjecao({ renda: 20000, vinculo: 'clt', sexo: 'mulher', meses: 120, tabela: T });
  assert.equal(p.salarioDeContribuicao, T.teto);
  assert.ok(Math.abs(p.rendaAcimaDoTeto - (20000 - T.teto)) < 0.01);
  // Quem ganha 20 mil compromete menos de 5% da renda com o INSS — e é por isso
  // que o benefício dele também para no teto.
  assert.ok(p.pesoNaRenda < 0.05);
});

test('sem renda informada não há contribuição nem benefício', () => {
  const w = carregar();
  const p = w.inssProjecao({ renda: 0, vinculo: 'clt', sexo: 'mulher', meses: 120, tabela: T });
  assert.equal(p.contribuicaoMensal, 0);
  assert.equal(p.totalPago, 0);
  assert.equal(p.beneficio.qualifica, false);
});

test('a tabela embutida traz os âncoras oficiais de 2026', () => {
  const w = carregar();
  // Se alguém atualizar a tabela e errar o teto, este teste pega.
  assert.equal(w.INSS_TABELA.salarioMinimo, 1621.0);
  assert.equal(w.INSS_TABELA.teto, 8475.55);
  assert.equal(w.INSS_TABELA.faixas.length, 4);
  assert.deepEqual(
    JSON.parse(JSON.stringify(w.INSS_TABELA.faixas.map((f) => f.aliquota))),
    [0.075, 0.09, 0.12, 0.14]
  );
  // A última faixa tem que terminar exatamente no teto.
  assert.equal(w.INSS_TABELA.faixas[3].ate, w.INSS_TABELA.teto);
});
