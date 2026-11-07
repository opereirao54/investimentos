'use strict';

// Registrar antecipação pelo painel do bem (canvas "Antecipar parcelas").
// O dinheiro sai do caixa da conta como ajuste (fora do resultado do mês) e
// a dívida cai o mesmo tanto: o patrimônio líquido não muda.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

function mundo() {
  const s = carregarApp({}, ORDEM_CONTROLE.concat(['web/appliquei-bens.js']));
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 60000 });
  const b = s.criarBem({
    nome: 'Apartamento',
    tipo: 'imovel',
    valorAtual: 520000,
    financiamento: {
      ativo: true,
      sistema: 'sac',
      saldoDevedor: 190000,
      parcelasRestantes: 120,
      taxaMensal: 0.008,
      valorParcela: 3103,
    },
  });
  return { s, conta, b };
}

const caixa = (s, conta) =>
  s.mpSaldoInicialConta(s.obterConta(conta.id), Date.now()) +
  s.mpSomaAjustesConta(s.obterConta(conta.id), Date.now());

test('reduzir o prazo: saldo cai, parcelas encurtam, caixa sai o mesmo tanto', () => {
  const { s, conta, b } = mundo();
  const antesCaixa = caixa(s, conta);
  const antesDivida = s.totalDividaBens();
  const r = s.bemRegistrarAntecipacao(b.id, 20000, 'prazo', conta.id);
  const fin = s.obterBem(b.id).financiamento;
  assert.equal(fin.saldoDevedor, 170000);
  assert.ok(fin.parcelasRestantes < 120);
  assert.equal(fin.parcelasRestantes, r.sim.prazo.parcelas);
  assert.equal(fin.antecipacoes.length, 1);
  assert.equal(caixa(s, conta), antesCaixa - 20000);
  assert.equal(s.totalDividaBens(), antesDivida - 20000);
  // Ajuste não é transação: o resultado do mês não vê a antecipação.
  assert.equal(s.transacoes.length, 0);
});

test('reduzir a parcela: prazo igual, parcela menor', () => {
  const { s, conta, b } = mundo();
  s.bemRegistrarAntecipacao(b.id, 20000, 'parcela', conta.id);
  const fin = s.obterBem(b.id).financiamento;
  assert.equal(fin.parcelasRestantes, 120);
  assert.ok(fin.valorParcela < 3103);
});

test('antecipar mais que o saldo quita e não tira do caixa além da dívida', () => {
  const { s, conta, b } = mundo();
  const antes = caixa(s, conta);
  s.bemRegistrarAntecipacao(b.id, 999999, 'prazo', conta.id);
  const fin = s.obterBem(b.id).financiamento;
  assert.equal(fin.saldoDevedor, 0);
  assert.equal(fin.parcelasRestantes, 0);
  assert.equal(caixa(s, conta), antes - 190000);
});

test('valores sugeridos e mês da quitação', () => {
  const { s } = mundo();
  assert.deepEqual(Array.from(s.bemValoresAntecipar(190000)), [10000, 20000, 50000]);
  assert.deepEqual(Array.from(s.bemValoresAntecipar(30000)), [3000, 7500, 15000]);
  const q = s.bemQuitacao(12, new Date(2026, 10, 7));
  assert.equal(q.getFullYear(), 2027);
  assert.equal(q.getMonth(), 10);
});

// ---------------------------------------------------------------------------
// As parcelas lançadas no Controle acompanham a antecipação
// ---------------------------------------------------------------------------

function comSerie(extra) {
  const m = mundo();
  const h = new Date();
  const add = (gid, desc, valor, k, pago) => {
    const d = new Date(h.getFullYear(), h.getMonth() + k, 10);
    m.s.transacoes.push({
      id: gid + '_' + k,
      groupId: gid,
      descricao: desc,
      valor,
      categoria: 'despesa_fixa',
      mes: d.getMonth(),
      ano: d.getFullYear(),
      pago: !!pago,
    });
  };
  for (let k = -2; k < 60; k++) add('gfin', 'Financiamento apê', 3103, k, k < 0);
  for (let k = 0; k < 60; k++) add('galug', 'Condomínio', 900, k, false);
  if (extra) extra(add);
  return m;
}
const futuras = (s, gid) => s.transacoes.filter((t) => t.groupId === gid && !t.pago);

test('prazo: a série do Controle fica com as parcelas que restam; as pagas e as outras séries não mudam', () => {
  const { s, conta, b } = comSerie();
  // 100 mil: o prazo cai para 57 meses, menos que os 60 lançados no Controle.
  const r = s.bemRegistrarAntecipacao(b.id, 100000, 'prazo', conta.id);
  const n = s.obterBem(b.id).financiamento.parcelasRestantes;
  assert.ok(n < 60);
  assert.equal(futuras(s, 'gfin').length, n);
  assert.equal(r.registro.controle.removidos.length, 60 - n);
  assert.equal(s.transacoes.filter((t) => t.groupId === 'gfin' && t.pago).length, 2);
  assert.equal(futuras(s, 'galug').length, 60);
  assert.equal(s.obterBem(b.id).financiamento.parcelasGrupoId, 'gfin');
});

test('parcela: as que faltam passam a ter o valor novo', () => {
  const { s, conta, b } = comSerie();
  s.bemRegistrarAntecipacao(b.id, 20000, 'parcela', conta.id);
  const nova = s.obterBem(b.id).financiamento.valorParcela;
  assert.ok(futuras(s, 'gfin').every((t) => t.valor === nova));
  assert.ok(
    s.transacoes.filter((t) => t.groupId === 'gfin' && t.pago).every((t) => t.valor === 3103)
  );
});

test('quitar tira todas as parcelas que faltam', () => {
  const { s, conta, b } = comSerie();
  s.bemRegistrarAntecipacao(b.id, 999999, 'prazo', conta.id);
  assert.equal(futuras(s, 'gfin').length, 0);
});

test('duas séries com o mesmo valor e sem nome que diga qual: não mexe em nada', () => {
  const { s, conta, b } = comSerie((add) => {
    for (let k = 0; k < 60; k++) add('gx', 'Prestação carro', 3050, k, false);
  });
  // "Financiamento apê" e "Prestação carro" batem pelo nome: ambíguo.
  const r = s.bemRegistrarAntecipacao(b.id, 20000, 'prazo', conta.id);
  assert.equal(r.registro.controle.grupoId, null);
  assert.equal(futuras(s, 'gfin').length, 60);
  assert.equal(futuras(s, 'gx').length, 60);
});

test('desfazer devolve dívida, caixa e as parcelas do Controle', () => {
  const { s, conta, b } = comSerie();
  const antesCaixa = caixa(s, conta);
  const r = s.bemRegistrarAntecipacao(b.id, 20000, 'prazo', conta.id);
  assert.ok(s.bemDesfazerAntecipacao(b.id, r.registro.id));
  const fin = s.obterBem(b.id).financiamento;
  assert.equal(fin.saldoDevedor, 190000);
  assert.equal(fin.parcelasRestantes, 120);
  assert.equal(fin.antecipacoes.length, 0);
  assert.equal(caixa(s, conta), antesCaixa);
  assert.equal(futuras(s, 'gfin').length, 60);
});
