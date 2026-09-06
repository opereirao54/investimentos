'use strict';

// Taxas do Tesouro Direto, a partir do CSV do Tesouro Transparente.
//
// A fonte antiga morreu — `HTTP 410 · gone`, registrado pela sonda no runner —
// e o substituto tem uma forma completamente diferente: em vez de um JSON com
// a oferta de hoje, um CSV de 14,4 MB com a série histórica inteira desde
// 2002, uma linha por título POR DIA.
//
// Essa diferença é a fonte dos defeitos possíveis aqui, e é o que estes
// testes cobrem: escolher a linha errada do histórico publica a taxa de um
// pregão qualquer como se fosse a de hoje — um número plausível, no campo
// certo, que ninguém confere.

const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairTaxasTesouro } = require('../scripts/lib/tesouro.js');

const CAB =
  'Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;' +
  'PU Compra Manha;PU Venda Manha;PU Base Manha';

function csv(linhas) {
  return [CAB].concat(linhas).join('\n');
}

test('vence a Data Base mais recente, não a ordem do arquivo', () => {
  // O arquivo vem ordenado por tipo e vencimento, NÃO por data. Pegar a
  // última linha entregaria o último título do alfabeto, não o pregão de
  // hoje — e a taxa sairia de um dia qualquer sem nada denunciar.
  const r = extrairTaxasTesouro(
    csv([
      'Tesouro IPCA+;15/05/2035;21/08/2026;7,30;7,35;2101,50;2100,00;2101,00',
      'Tesouro IPCA+;15/05/2035;20/08/2026;7,20;7,25;2100,50;2099,00;2100,00',
      'Tesouro IPCA+;15/05/2035;19/08/2026;9,99;9,99;2000,00;1999,00;2000,00',
    ]),
    '2026-08-25'
  );
  assert.equal(r.titulos.length, 1, 'três dias do mesmo papel são UM título');
  assert.equal(r.titulos[0].taxa, 7.3, 'a taxa tem de ser a do dia mais recente');
  assert.equal(r.titulos[0].dataBase, '2026-08-21');
});

test('título vencido não entra: não se recomenda comprar papel que não existe', () => {
  const r = extrairTaxasTesouro(
    csv([
      'Tesouro Prefixado;01/10/2007;02/10/2006;13,63;13,67;881,83;881,53;881,08',
      'Tesouro Selic;01/03/2029;21/08/2026;0,12;0,15;15000,00;14999,00;15000,00',
    ]),
    '2026-08-25'
  );
  assert.deepEqual(
    r.titulos.map((t) => t.nome),
    ['Tesouro Selic 2029']
  );
  assert.equal(r.vencidos, 1, 'e o descarte é contado, não silencioso');
});

test('o nome sai no formato que a carteira modelo já casa', () => {
  // `cartCasarTesouro` liga o item da carteira ao título pelo nome
  // normalizado. Mudar o formato aqui quebraria esse casamento sem erro
  // nenhum — a renda fixa voltaria a ficar sem indicadores.
  const r = extrairTaxasTesouro(
    csv([
      'Tesouro IPCA+ com Juros Semestrais;15/05/2045;21/08/2026;7,00;7,05;3000,00;2999,00;3000,00',
      'Tesouro Prefixado;01/01/2027;21/08/2026;13,50;13,55;900,00;899,00;900,00',
    ]),
    '2026-08-25'
  );
  const nomes = r.titulos.map((t) => t.nome).sort();
  assert.deepEqual(nomes, ['Tesouro IPCA+ com Juros Semestrais 2045', 'Tesouro Prefixado 2027']);
  const tickers = r.titulos.map((t) => t.ticker).sort();
  assert.deepEqual(tickers, ['TESOURO_IPCA_COM_JUROS_SEMESTRAIS_2045', 'TESOURO_PREFIXADO_2027']);
});

test('vírgula decimal e milhar do padrão brasileiro', () => {
  const r = extrairTaxasTesouro(
    csv(['Tesouro Selic;01/03/2029;21/08/2026;0,12;0,15;15.432,10;15.431,00;15.432,00']),
    '2026-08-25'
  );
  assert.equal(r.titulos[0].taxa, 0.12);
  assert.equal(r.titulos[0].precoUnitario, 15432.1, 'o ponto é separador de milhar, não decimal');
});

test('a taxa de venda vai junto para o spread ser conferível', () => {
  // Compra e venda diferem por poucos pontos-base. Ver as duas no log é o
  // que permite descobrir que as colunas foram lidas trocadas — sozinha,
  // qualquer uma das duas parece certa.
  const r = extrairTaxasTesouro(
    csv(['Tesouro Prefixado;01/01/2027;21/08/2026;13,63;13,67;900,00;899,00;900,00']),
    '2026-08-25'
  );
  assert.equal(r.titulos[0].taxa, 13.63);
  assert.equal(r.titulos[0].taxaVenda, 13.67);
});

test('aplicação mínima fica nula em vez de inventada', () => {
  // O CSV não traz esse campo. Derivá-lo de uma regra lembrada de cabeça
  // seria publicar um número que ninguém conferiu.
  const r = extrairTaxasTesouro(
    csv(['Tesouro Selic;01/03/2029;21/08/2026;0,12;0,15;15000,00;14999,00;15000,00']),
    '2026-08-25'
  );
  assert.equal(r.titulos[0].investimentoMinimo, null);
});

test('cabeçalho mudado é reportado por nome, não vira lista vazia calada', () => {
  // Zero títulos com o arquivo aberto é indistinguível de "não há títulos".
  // Nomear a coluna que sumiu é o que separa as duas na próxima investigação.
  const r = extrairTaxasTesouro(
    'Tipo Titulo;Data Vencimento;Data Base;Taxa Outra\nTesouro Selic;01/03/2029;21/08/2026;0,12',
    '2026-08-25'
  );
  assert.deepEqual(r.titulos, []);
  assert.ok(r.semEssencial.includes('Taxa Compra Manha'));
  assert.ok(r.cabecalho.includes('Taxa Outra'), 'o cabeçalho real vai junto');
});
