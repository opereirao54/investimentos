'use strict';

// Sugestões do ✏️ Descrição (api/_lib/telegram-descricao.js): sem IA, do
// vocabulário da própria pessoa.

const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../api/_lib/telegram-descricao.js');

const T = (descricao, categoriaDespesa = 'alimentacao') => ({ descricao, categoriaDespesa });

test('parecida com o histórico vem primeiro; a mais usada antes; erro de digitação casa', () => {
  const hist = [T('Uber', 'transporte'), T('Uber', 'transporte'), T('Uber Eats'), T('Padaria')];
  const s = D.sugerir('Ubr', hist, 'transporte');
  assert.equal(s[0], 'Uber');
  assert.ok(s.includes('Uber Eats'));
  assert.ok(s.length <= 3);
});

test('abreviação casa pelo começo da palavra: "mc" → "McDonald\'s"', () => {
  const s = D.sugerir('mc', [T("McDonald's"), T("McDonald's"), T('Mercado')]);
  assert.equal(s[0], "McDonald's");
});

test('sem histórico parecido: oferece a digitada arrumada', () => {
  assert.deepEqual(D.sugerir('padaria do ze', []), ['Padaria do Ze']);
});

test('completa com as mais usadas da mesma categoria, sem repetir', () => {
  const hist = [T('Feira'), T('Feira'), T('Açougue'), T('Uber', 'transporte')];
  const s = D.sugerir('xyz', hist, 'alimentacao');
  assert.deepEqual(s, ['Xyz', 'Feira', 'Açougue']);
});

test('arrumada entra quando muda as maiúsculas; do histórico, variação só de maiúsculas não', () => {
  assert.deepEqual(D.sugerir('Padaria do ze', []), ['Padaria do Ze']);
});

test('nunca sugere a própria descrição, nem variação só de maiúsculas', () => {
  const s = D.sugerir('Mercado', [T('mercado'), T('MERCADO'), T('Mercado Extra')]);
  assert.ok(!s.some((x) => x.toLowerCase() === 'mercado'), JSON.stringify(s));
  assert.ok(s.includes('Mercado Extra'));
});

test('parcela "(2/10)" não entra na sugestão nem conta como outra descrição', () => {
  const s = D.sugerir('tenis', [T('Tênis Nike (1/3)'), T('Tênis Nike (2/3)')]);
  assert.equal(s[0], 'Tênis Nike');
});

test('arrumar: maiúsculas certas, preposição minúscula, sigla e iFood intactos', () => {
  assert.equal(D.arrumar('  padaria   DO zé '), 'Padaria do Zé');
  assert.equal(D.arrumar('ifood'), 'Ifood');
  assert.equal(D.arrumar('iFood jantar'), 'iFood Jantar');
  assert.equal(D.arrumar('IPVA carro'), 'IPVA Carro');
});

test('limpar: tira quebra de linha e corta em 60', () => {
  assert.equal(D.limpar('a\nb\tc'), 'a b c');
  assert.equal(D.limpar('x'.repeat(100)).length, 60);
  assert.equal(D.limpar('   '), '');
});

test('chave do apelido ignora maiúsculas, acento, parcela e número', () => {
  assert.equal(D.chaveApelido('Ubr'), D.chaveApelido('ubr'));
  assert.equal(D.chaveApelido('Tênis (1/3)'), 'tenis');
});
