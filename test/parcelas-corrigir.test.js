'use strict';

// Parcelado: lançar começando na parcela certa, e corrigir a numeração de uma
// série já lançada.
//
// O relato que originou: "comprei em 10x, lancei começando no 1/10, mas a
// compra já estava na 2/10. Para corrigir eu teria de apagar a última e
// renomear todas as outras na mão." Agora:
//   1. no lançamento, "Parcela atual" = 2 cria só 2/10..10/10 (9 lançamentos);
//   2. na edição, "Esta é a parcela 2 de 10" renumera a série inteira: renomeia,
//      apaga a sobra no fim, cria a que faltar — sem mexer em vencimento nem
//      valor, e sem apagar parcela já paga.

const test = require('node:test');
// Comparação por conteúdo: os objetos nascem dentro da sandbox (outro realm).
const assert = require('node:assert');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado, formatar } = require('../scripts/lib/invariantes.js');

const CARTAO = 'card_x';

function app(fields) {
  const win = carregarApp(fields || {}, ORDEM_CONTROLE);
  win.contas = [{ id: 'c1', nome: 'Banco', tipo: 'banco' }];
  win.cartoes.length = 0;
  win.cartoes.push({
    id: CARTAO,
    nome: 'Nubank',
    diaVencimento: 5,
    diaFechamento: 28,
    contaPagadoraId: 'c1',
  });
  win.transacoes.length = 0;
  return win;
}

function lancar10x(win, extra) {
  const novos = win.criarLancamentos(
    Object.assign(
      {
        descricao: 'TV',
        valor: 3000,
        categoria: 'cartao_credito',
        cartaoId: CARTAO,
        tipoCartao: 'parcelado',
        parcelas: 10,
        dataVencimento: '2026-10-05',
        mesBase: 9,
        anoBase: 2026,
        agora: new Date(2026, 9, 1, 12),
        idBase: 'tv',
      },
      extra
    )
  );
  novos.forEach((t) => win.transacoes.push(t));
  return novos;
}

const resumo = (lista) => lista.map((t) => [t.descricao, t.dataVencimento]);

test('lançar com "parcela atual" 2 de 10: entram só as 9 que faltam, a 2/10 na fatura escolhida', () => {
  const win = app();
  const novos = lancar10x(win, { parcelaInicial: 2 });
  assert.equal(novos.length, 9);
  assert.deepEqual(resumo(novos).slice(0, 2), [
    ['TV (2/10)', '2026-10-05'],
    ['TV (3/10)', '2026-11-05'],
  ]);
  assert.deepEqual(resumo(novos).at(-1), ['TV (10/10)', '2027-06-05']);
  assert.ok(
    novos.every((t) => t.valor === 300),
    'valor da parcela = total / 10'
  );
  const v = validarEstado(estadoDe(win), { apenas: ['INV-08', 'INV-20'] });
  assert.equal(v.length, 0, formatar(v));
});

test('parcela atual fora do intervalo recomeça do 1 (nunca "12/10")', () => {
  assert.equal(lancar10x(app(), { parcelaInicial: 12 }).length, 10);
  assert.equal(lancar10x(app(), { parcelaInicial: 0 }).length, 10);
  assert.equal(lancar10x(app(), { parcelaInicial: 10 }).length, 1);
});

test('o relato: lançou 1/10 a partir de outubro, era 2/10 — renumera, apaga a sobra, nada criado', () => {
  const win = app();
  const serie = lancar10x(win);
  const out = serie[0];
  const plano = win.renumerarSerieParcelas(win.transacoes, out.id, 2, 10);
  assert.equal(plano.erro, undefined);
  assert.equal(plano.renomear.length, 9);
  assert.deepEqual(
    plano.remover.map((t) => [t.descricao, t.dataVencimento]),
    [['TV (10/10)', '2027-07-05']],
    'a última (jul/27) é a sobra'
  );
  assert.equal(plano.criar.length, 0);
  assert.equal(plano.renomear[0].descricao, 'TV (2/10)');
  assert.equal(plano.renomear.at(-1).descricao, 'TV (10/10)');
});

test('corrigir pela tela: prévia, aplicar, salvar — vencimentos e valores intocados', () => {
  const fields = {};
  const win = app(fields);
  const serie = lancar10x(win);
  const antes = new Map(serie.map((t) => [t.id, [t.dataVencimento, t.valor, t.mes, t.ano]]));
  fields.editTransacaoId = serie[0].id;
  fields.cpParcela = '2';
  fields.cpTotal = '10';
  win.corrigirParcelasPrevia();
  assert.ok(win.corrigirParcelasPlano, 'a prévia montou o plano');
  win.corrigirParcelasAplicar();
  const tv = win.transacoes.filter((t) => t.descricao.startsWith('TV'));
  assert.equal(tv.length, 9);
  assert.deepEqual(
    tv.map((t) => t.descricao),
    [
      'TV (2/10)',
      'TV (3/10)',
      'TV (4/10)',
      'TV (5/10)',
      'TV (6/10)',
      'TV (7/10)',
      'TV (8/10)',
      'TV (9/10)',
      'TV (10/10)',
    ]
  );
  tv.forEach((t) => assert.deepEqual([t.dataVencimento, t.valor, t.mes, t.ano], antes.get(t.id)));
  assert.equal(JSON.parse(win.localStorage.getItem('futurorico_transacoes')).length, 9, 'salvou');
  const v = validarEstado(estadoDe(win), { apenas: ['INV-08', 'INV-20'] });
  assert.equal(v.length, 0, formatar(v));
});

test('corrigir para mais parcelas (era 2 de 12): cria a que falta no fim', () => {
  const win = app();
  const serie = lancar10x(win);
  const plano = win.renumerarSerieParcelas(win.transacoes, serie[0].id, 2, 12);
  assert.equal(plano.remover.length, 0);
  assert.deepEqual(
    plano.criar.map((t) => [t.descricao, t.dataVencimento, t.mes, t.ano, t.valor, t.pago]),
    [['TV (12/12)', '2027-08-05', 7, 2027, 300, false]],
    'a série ia até 11/12 em jul/27; falta a 12/12 em ago/27'
  );
});

test('corrigir a partir do meio da série: as anteriores também se ajustam', () => {
  const win = app();
  const serie = lancar10x(win);
  // Na fatura de jan/27 está "TV (4/10)", mas é a 5/10.
  const plano = win.renumerarSerieParcelas(win.transacoes, serie[3].id, 5, 10);
  assert.equal(plano.renomear[0].descricao, 'TV (2/10)', 'outubro vira 2/10');
  assert.deepEqual(
    plano.remover.map((t) => t.dataVencimento),
    ['2027-07-05']
  );
});

test('parcela já paga não é apagada: pede para desfazer o pagamento antes', () => {
  const win = app();
  const serie = lancar10x(win);
  serie[0].pago = true; // outubro pago
  // "Era a 2/10, mas lancei em novembro como 2/10"... dizer que novembro é 1/10
  // apagaria outubro (vira 0/10): bloqueia.
  const plano = win.renumerarSerieParcelas(win.transacoes, serie[1].id, 1, 10);
  assert.equal(plano.erro, 'parcela_paga');
  assert.equal(plano.pagas[0].id, serie[0].id);
});

test('número inválido e lançamento que não é parcela', () => {
  const win = app();
  const serie = lancar10x(win);
  assert.equal(
    win.renumerarSerieParcelas(win.transacoes, serie[0].id, 11, 10).erro,
    'numero_invalido'
  );
  assert.equal(
    win.renumerarSerieParcelas(win.transacoes, serie[0].id, 1, 1).erro,
    'numero_invalido'
  );
  win.transacoes.push({
    id: 'avulsa',
    descricao: 'Mercado',
    valor: 10,
    categoria: 'despesa_variavel',
  });
  assert.equal(win.renumerarSerieParcelas(win.transacoes, 'avulsa', 1, 2).erro, 'nao_parcelado');
});

test('série já certa: nada a mudar', () => {
  const win = app();
  const serie = lancar10x(win);
  const plano = win.renumerarSerieParcelas(win.transacoes, serie[0].id, 1, 10);
  assert.deepEqual([plano.renomear.length, plano.remover.length, plano.criar.length], [0, 0, 0]);
});
