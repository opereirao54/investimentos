'use strict';

// INV-27 — Fatura importada não duplica compra.
//
// A importação de fatura (web/appliquei-importar-fatura.js) é idempotente
// porque casa cada linha do banco com o que já está na fatura antes de criar:
// pelo FITID do OFX, pela parcela (N/M) e pelo valor. Duplicata = gasto dobrado
// e a fatura do app maior que a do banco.
//
// Prova as duas metades: (1) o fluxo real — importar, reimportar, e importar
// por cima do que veio pelo Telegram — não duplica; (2) o validador ACUSA
// quando a mesma linha do banco vira dois lançamentos.
//
// Ver .claude/integracoes/mapa.json → INV-27.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat([
  'web/appliquei-insights.js',
  'web/appliquei-faturas.js',
  'web/appliquei-categorias-palavras.js',
  'web/appliquei-importar-fatura.js',
  'web/appliquei-importar-fatura-ui.js',
]);
const NOME = 'Nubank_2026-11-05.ofx';
const OFX = fs.readFileSync(path.join(__dirname, 'fixtures', 'nubank', NOME));
const VENC = '2026-11-05';

function estado(win) {
  return { transacoes: win.transacoes, contas: win.contas, cartoes: win.cartoes };
}

function importar(win) {
  win.impfatUi.cartaoId = 'card_nu';
  win.impfatUi.arquivo = win.AppliqueiImportarFatura.lerArquivo(new Uint8Array(OFX), NOME);
  win.impfatUi.arquivoNome = NOME;
  win.impfatUi.vencimento = VENC;
  win.impfatUi.passo = 'revisao';
  win.impfatUiReplanejar();
  win.impfatUiConfirmar();
}

function app() {
  const win = carregarApp({}, ORDEM, { globais: { TextDecoder } });
  win.contas.push({ id: 'c_nu', nome: 'Nubank', tipo: 'banco' });
  win.cartoes.length = 0;
  win.cartoes.push({ id: 'card_nu', nome: 'Nubank', diaVencimento: 5, contaPagadoraId: 'c_nu' });
  win.transacoes.length = 0;
  return win;
}

function totalDaFatura(win) {
  return (
    Math.round(
      win.transacoes
        .filter((t) => t.cartaoId === 'card_nu' && t.dataVencimento === VENC)
        .reduce((s, t) => s + t.valor, 0) * 100
    ) / 100
  );
}

test('INV-27: importar a mesma fatura três vezes não duplica nada', () => {
  const win = app();
  importar(win);
  const depois = win.transacoes.length;
  importar(win);
  importar(win);
  assert.equal(win.transacoes.length, depois);
  assert.equal(totalDaFatura(win), 725.11, 'a fatura do app continua igual à do Nubank');
  assert.deepEqual(validarEstado(estado(win), { apenas: ['INV-27'] }), []);
});

test('INV-27: o que veio pelo Telegram não entra de novo pela importação', () => {
  const win = app();
  const base = { categoria: 'cartao_credito', cartaoId: 'card_nu', dataVencimento: VENC };
  win.transacoes.push(
    { ...base, id: 'tg1_1_0', descricao: 'gasolina', valor: 120, mes: 10, ano: 2026, pago: false },
    { ...base, id: 'tg1_2_0', descricao: 'pão doce', valor: 18, mes: 10, ano: 2026, pago: false }
  );
  importar(win);
  assert.equal(win.transacoes.filter((t) => t.valor === 120).length, 1, 'gasolina uma vez só');
  assert.equal(
    win.transacoes.filter((t) => t.valor === 18 || t.valor === 18.37).length,
    1,
    'pão doce 18 × R$ 18,37 do banco: uma vez só'
  );
  assert.deepEqual(validarEstado(estado(win), { apenas: ['INV-27'] }), []);
});

test('INV-27: o validador acusa a mesma linha do banco virando dois lançamentos', () => {
  const t = {
    id: 'imp1_0',
    descricao: 'Rappi',
    valor: 27.45,
    categoria: 'cartao_credito',
    cartaoId: 'card_nu',
    dataVencimento: VENC,
    mes: 10,
    ano: 2026,
    importacao: { id: 'imp1', fitid: 'abc' },
  };
  const v = validarEstado(
    {
      transacoes: [t, { ...t, id: 'imp2_0', importacao: { id: 'imp2', fitid: 'abc' } }],
      contas: [],
      cartoes: [],
    },
    { apenas: ['INV-27'] }
  );
  assert.equal(v.length, 1);
  assert.equal(v[0].inv, 'INV-27');
  // O mesmo FITID em cartões diferentes não é a mesma compra.
  const outro = {
    ...t,
    id: 'imp3_0',
    cartaoId: 'card_x',
    importacao: { id: 'imp3', fitid: 'abc' },
  };
  assert.deepEqual(
    validarEstado({ transacoes: [t, outro], contas: [], cartoes: [] }, { apenas: ['INV-27'] }),
    []
  );
});
