'use strict';

// INV-07 — Saldo de abertura entra uma única vez.
//
// mpCalcularSaldoPorInstituicao soma o saldoInicial de contasAtivas(). Duas
// formas de o patrimônio subir sozinho:
//   1. duas contas ATIVAS com o mesmo nome (o usuário cadastrou "Itaú" e
//      "itau") — os dois saldos de abertura entram e o agrupamento fragmenta;
//   2. uma fusão que não transfere os aliases — os registros legados que
//      citavam o nome absorvido deixam de resolver e viram "A reconciliar".
//
// Ver .claude/integracoes/mapa.json → INV-07.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

test('INV-07: conta arquivada não entra no saldo', () => {
  const s = carregarApp();
  const viva = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 1000 });
  const morta = s.criarConta({ nome: 'Banco Velho', tipo: 'banco', saldoInicial: 500 });
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 1500);

  s.arquivarConta(morta.id);
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 1000, 'o saldo da arquivada sai do total');
  assert.ok(!s.mpCalcularSaldoPorInstituicao(Date.now())[morta.id]);
  assert.ok(s.mpCalcularSaldoPorInstituicao(Date.now())[viva.id]);
});

test('INV-07: duas contas ativas com o mesmo nome normalizado são acusadas', () => {
  const s = carregarApp();
  // criarConta não deduplica: quem chama obterOuCriarContaPorNome está protegido,
  // mas o cadastro manual pode criar a colisão.
  s.criarConta({ nome: 'Itaú', tipo: 'banco', saldoInicial: 1000 });
  s.criarConta({ nome: 'itau', tipo: 'banco', saldoInicial: 1000 });

  const v = validarEstado(estadoDe(s), { apenas: ['INV-07'] });
  assert.ok(v.length >= 1, 'a colisão de nome tem de ser acusada');
  assert.match(v[0].mensagem, /mesmo nome normalizado/);
});

test('INV-07: obterOuCriarContaPorNome não duplica ao variar acento e caixa', () => {
  const s = carregarApp();
  const a = s.obterOuCriarContaPorNome('Itaú');
  const b = s.obterOuCriarContaPorNome('itau');
  const c = s.obterOuCriarContaPorNome('  ITAÚ  ');
  assert.equal(a.id, b.id);
  assert.equal(a.id, c.id);
  assert.equal(s.contas.length, 1, 'uma conta só, não três');
  assert.equal(validarEstado(estadoDe(s), { apenas: ['INV-07'] }).length, 0);
});

test('INV-07: fusão transfere os aliases — registros legados continuam resolvendo', () => {
  const s = carregarApp();
  const destino = s.criarConta({ nome: 'Itaú', tipo: 'banco', saldoInicial: 1000 });
  const origem = s.criarConta({ nome: 'Banco Itau S.A.', tipo: 'banco', saldoInicial: 500 });

  // Lançamento legado que só tem o texto livre do nome absorvido.
  const legado = {
    id: 'legado1',
    categoria: 'despesa_fixa',
    valor: 100,
    banco: 'Banco Itau S.A.',
    mes: 0,
    ano: 2026,
    pago: true,
  };
  s.transacoes.push(legado);
  assert.equal(s.resolverContaDeTransacao(legado).id, origem.id, 'antes da fusão resolve');

  s.fundirContas(destino.id, [origem.id]);

  const resolvida = s.resolverContaDeTransacao(legado);
  assert.ok(
    resolvida,
    'depois da fusão o lançamento legado tem de continuar resolvendo — pelo alias'
  );
  assert.equal(resolvida.id, destino.id, 'agora aponta para a conta de destino');
  assert.equal(validarEstado(estadoDe(s), { apenas: ['INV-07', 'INV-01'] }).length, 0);
});
