'use strict';

// Cobre o módulo de Contas / Instituições (web/appliquei-contas.js), Fase 1.
// Carrega o classic script numa sandbox vm com os globais que ele lê
// (historicoCompras, transacoes) pré-populados, e valida seed/dedup/CRUD +
// a invariante "Fase 1 é inerte" (não carimba contaId nem toca futurorico_*).

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const CONTAS_SRC = fs.readFileSync(path.join(ROOT, 'web/appliquei-contas.js'), 'utf8');

function makeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

// Carrega contas.js num contexto vm. O IIFE de seed roda no load.
function loadContas({ compras = [], transacoes = [], storage = {} } = {}) {
  const sandbox = {
    localStorage: makeStorage(storage),
    console: { error() {}, warn() {}, log() {} },
    historicoCompras: compras,
    transacoes: transacoes,
    AppliqueiCloudSync: undefined,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(CONTAS_SRC, ctx, { filename: 'web/appliquei-contas.js' });
  return sandbox;
}

test('seed cria uma conta por instituição citada (corretora + banco)', () => {
  const s = loadContas({
    compras: [
      { ticker: 'PETR4', corretora: 'XP Investimentos' },
      { ticker: 'ITUB4', corretora: 'Rico' },
    ],
    transacoes: [
      { categoria: 'receita', banco: 'Nubank' },
      { categoria: 'despesa_fixa', banco: 'Itaú' },
    ],
  });
  // Copia para um array do realm do teste — s.contas vem do vm context e tem
  // outro Array.prototype, o que faz deepStrictEqual reclamar de protótipo.
  const nomes = [...s.contas.map((c) => c.nome)].sort();
  assert.deepEqual(nomes, ['Itaú', 'Nubank', 'Rico', 'XP Investimentos']);
  const tipos = {};
  s.contas.forEach((c) => (tipos[c.nome] = c.tipo));
  assert.equal(tipos['XP Investimentos'], 'corretora');
  assert.equal(tipos['Nubank'], 'banco');
});

test('seed deduplica nomes equivalentes (acento/caixa/espaços)', () => {
  const s = loadContas({
    transacoes: [
      { categoria: 'receita', banco: 'Itaú' },
      { categoria: 'despesa_fixa', banco: 'itau' },
      { categoria: 'despesa_variavel', banco: '  ITAÚ  ' },
    ],
  });
  const itau = s.contas.filter((c) => s.appliqueiNormalizarNomeConta(c.nome) === 'itau');
  assert.equal(itau.length, 1, 'Itaú/itau/ITAÚ devem virar UMA conta');
});

test('Fase 1 é inerte: não carimba contaId nem reescreve futurorico_*', () => {
  const compras = [{ ticker: 'PETR4', corretora: 'XP' }];
  const transacoes = [{ categoria: 'receita', banco: 'Nubank' }];
  const s = loadContas({ compras, transacoes });
  assert.equal(compras[0].contaId, undefined);
  assert.equal(transacoes[0].contaId, undefined);
  assert.equal(s.localStorage.getItem('futurorico_compras'), null);
  assert.equal(s.localStorage.getItem('futurorico_transacoes'), null);
  // A chave nova foi escrita (registro existe para a Fase 2).
  assert.ok(s.localStorage.getItem('appliquei_contas'));
});

test('CRUD: criar, buscar por nome normalizado, editar, idempotência', () => {
  const s = loadContas({});
  const c = s.criarConta({ nome: 'Banco do Brasil', tipo: 'banco', saldoInicial: 1500 });
  assert.ok(c.id);
  assert.equal(c.saldoInicial, 1500);
  assert.equal(s.obterContaPorNome('  banco do brasil ').id, c.id);
  s.editarConta(c.id, { saldoInicial: 2000, nome: 'BB' });
  assert.equal(s.obterConta(c.id).saldoInicial, 2000);
  assert.equal(s.obterConta(c.id).nome, 'BB');
  const antes = s.contas.length;
  const mesmo = s.obterOuCriarContaPorNome('BB');
  assert.equal(mesmo.id, c.id, 'não deve duplicar conta existente');
  assert.equal(s.contas.length, antes);
});

test('seed é idempotente — rodar de novo não duplica', () => {
  const s = loadContas({ transacoes: [{ categoria: 'receita', banco: 'Inter' }] });
  const antes = s.contas.length;
  s.appliqueiSeedContasDeStrings();
  assert.equal(s.contas.length, antes);
});

test('fundirContas: re-aponta contaId, soma saldoInicial e remove duplicata', () => {
  const s = loadContas({});
  const a = s.criarConta({ nome: 'Itaú', tipo: 'banco', saldoInicial: 100 });
  const b = s.criarConta({ nome: 'Itaú Unibanco', tipo: 'banco', saldoInicial: 50 });
  assert.equal(s.contas.length, 2);
  // Simula um registro já carimbado com contaId (cenário Fase 2+).
  s.transacoes.push({ categoria: 'receita', contaId: b.id, valor: 10 });
  const destino = s.fundirContas(a.id, [b.id]);
  assert.equal(destino.id, a.id);
  assert.equal(s.contas.length, 1, 'duplicata removida');
  assert.equal(s.obterConta(a.id).saldoInicial, 150, 'saldos iniciais somados');
  assert.equal(s.transacoes[s.transacoes.length - 1].contaId, a.id, 'contaId re-apontado');
});

test('resolverContaDeTransacao: contaId tem prioridade; depois nome; senão null', () => {
  const s = loadContas({ transacoes: [{ categoria: 'receita', banco: 'Nubank' }] });
  const nubank = s.obterContaPorNome('Nubank');
  // por nome (normalizado)
  assert.equal(s.resolverContaDeTransacao({ banco: 'nubank' }).id, nubank.id);
  // contaId vence mesmo com banco divergente
  const inter = s.criarConta({ nome: 'Inter', tipo: 'banco' });
  assert.equal(s.resolverContaDeTransacao({ contaId: inter.id, banco: 'Nubank' }).id, inter.id);
  // sem instituição → null (vai para "A reconciliar" no Patrimônio)
  assert.equal(s.resolverContaDeTransacao({ categoria: 'investimento_variavel' }), null);
});

test('fusão cria alias — registro antigo por texto resolve no destino', () => {
  const s = loadContas({});
  const a = s.criarConta({ nome: 'Itaú', tipo: 'banco' });
  const b = s.criarConta({ nome: 'Itaú Unibanco', tipo: 'banco' });
  s.fundirContas(a.id, [b.id]);
  const conta = s.resolverContaDeTransacao({ banco: 'Itaú Unibanco' });
  assert.ok(conta, 'deve resolver via alias');
  assert.equal(conta.id, a.id);
});

test('criarTransferencia: par balanceado (saída origem + entrada destino)', () => {
  const s = loadContas({});
  const a = s.criarConta({ nome: 'Nubank', tipo: 'banco' });
  const b = s.criarConta({ nome: 'XP', tipo: 'corretora' });
  const r = s.criarTransferencia(a.id, b.id, 250, '2026-03-10');
  assert.ok(r, 'deve criar a transferência');
  assert.equal(s.transacoes.length, 2);
  assert.equal(r.saida.categoria, 'transferencia_saida');
  assert.equal(r.saida.contaId, a.id);
  assert.equal(r.entrada.categoria, 'transferencia_entrada');
  assert.equal(r.entrada.contaId, b.id);
  assert.equal(r.saida.valor, r.entrada.valor);
  assert.equal(r.saida.transferenciaId, r.entrada.transferenciaId);
});

test('criarTransferencia: rejeita mesma conta, valor<=0 e conta faltando', () => {
  const s = loadContas({});
  const a = s.criarConta({ nome: 'Nubank', tipo: 'banco' });
  const b = s.criarConta({ nome: 'XP', tipo: 'corretora' });
  assert.equal(s.criarTransferencia(a.id, a.id, 100, ''), null, 'mesma conta');
  assert.equal(s.criarTransferencia(a.id, b.id, 0, ''), null, 'valor zero');
  assert.equal(s.criarTransferencia('', b.id, 100, ''), null, 'sem origem');
  assert.equal(s.transacoes.length, 0, 'nenhuma transação criada em casos inválidos');
});
