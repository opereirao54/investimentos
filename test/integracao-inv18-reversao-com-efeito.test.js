'use strict';

// INV-18 — Desfazer pagamento com efeito colateral desfaz o efeito junto.
//
// Pagar uma despesa comum só alterna um flag. Pagar um compromisso de sonho ou
// de previdência ATRAVESSA MÓDULOS: gera aporte no sonho, ou posição no
// patrimônio. Desfazer só o flag deixaria o efeito de pé — o mesmo dinheiro
// contado duas vezes: guardado no sonho E ainda pendente no Controle.
//
// Por isso a reversão passa por desfazerBaixaTransacao: na parcela do sonho o
// aporte sai junto com o flag. Compromisso de previdência continua recusado e
// volta pela aba dele.
//
// Ver .claude/integracoes/mapa.json → INV-18 e cadeiasDeEfeito CADEIA-01/02.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-sonhos.js']);
const HOJE = new Date();

function base(fields) {
  const s = carregarApp(fields || {}, ORDEM);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 50000 });
  return { s, conta };
}

test('INV-18: despesa comum paga PODE ser revertida', () => {
  const { s, conta } = base();
  s.transacoes.push({
    id: 'd1',
    categoria: 'despesa_variavel',
    valor: 200,
    banco: 'Nubank',
    contaId: conta.id,
    mes: HOJE.getMonth(),
    ano: HOJE.getFullYear(),
    pago: true,
  });
  assert.equal(s.controlePodeReverterPagamento(s.transacoes[0]), true);

  s.reverterPagamento('d1');
  assert.equal(s.transacoes[0].pago, false, 'volta para "a pagar"');
  assert.equal(
    s.mpCalcularSaldoPorInstituicao(Date.now())[conta.id].caixa,
    50000,
    'e o dinheiro volta para o caixa'
  );
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

function sonhoComParcelaPaga(planoVinculado) {
  const fields = {};
  const { s, conta } = base(fields);
  const sonho = {
    id: 'sonho_1',
    nome: 'Viagem',
    valorTotal: 12000,
    valorAtual: 0,
    aportes: [],
    contaOrigemId: conta.id,
    prazoMeses: 12,
    mesesRestantes: 12,
    planoVinculado,
    dataInicio: new Date(HOJE.getFullYear(), HOJE.getMonth(), 1).toISOString(),
  };
  s.sonhos = [sonho];
  s.gerarLancamentosMensaisSonho(sonho, 1000, 3);
  const parcela = s.transacoes.find((t) => t.categoria === 'sonho');
  fields['input-pago-' + parcela.id] = '1.000,00';
  s.confirmarPagamento(parcela.id);
  return { s, conta, sonho, parcela };
}

test('INV-18: parcela de sonho paga volta para "a pagar" e o aporte sai JUNTO', () => {
  // Pedido real: "antes dava para estornar uma quitação feita errada" — a
  // parcela do sonho paga por engano não tinha desfazer no Controle.
  const { s, conta, sonho, parcela } = sonhoComParcelaPaga(false);
  assert.equal(sonho.aportes.length, 1, 'o pagamento gerou aporte no sonho');
  assert.equal(s.controlePodeReverterPagamento(parcela), true);

  s.reverterPagamento(parcela.id);
  assert.equal(parcela.pago, false, 'a parcela volta para "a pagar"');
  assert.ok(s.transacoes.includes(parcela), 'e continua no Controle — não é exclusão');
  assert.equal(sonho.aportes.length, 0, 'o aporte gerado pela baixa sai');
  assert.equal(sonho.valorAtual, 0, 'e o guardado volta ao que era');
  assert.equal(
    s.mpCalcularSaldoPorInstituicao(Date.now())[conta.id].caixa,
    50000,
    'o dinheiro volta para a conta'
  );
  assert.equal(validarEstado(estadoDe(s)).length, 0);

  // Pagar de novo depois de desfazer registra o aporte uma vez só (INV-16).
  s.confirmarPagamento(parcela.id);
  assert.equal(sonho.aportes.length, 1);
  assert.equal(sonho.valorAtual, 1000);
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-18: no sonho vinculado ao Controle, desfazer recalcula as parcelas seguintes', () => {
  const { s, sonho, parcela } = sonhoComParcelaPaga(true);
  const parcelasDepoisDePagar = sonho.aporteMensalPlano;
  s.reverterPagamento(parcela.id);
  assert.equal(parcela.pago, false);
  assert.equal(sonho.valorAtual, 0);
  assert.ok(sonho.aporteMensalPlano > parcelasDepoisDePagar, 'falta mais → a parcela sobe');
  const pendentesMesAtual = s.transacoes.filter(
    (t) =>
      t.sonhoId === sonho.id &&
      !t.aporteExtra &&
      t.mes === HOJE.getMonth() &&
      t.ano === HOJE.getFullYear()
  );
  assert.equal(pendentesMesAtual.length, 1, 'o mês atual não ganha parcela em dobro');
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-18: aporte de migração continua sendo desfeito só na aba Sonhos', () => {
  const { s, sonho, parcela } = sonhoComParcelaPaga(false);
  sonho.aportes[0].vendaOpId = 'op_1';
  assert.equal(s.controlePodeReverterPagamento(parcela), false);
  s.reverterPagamento(parcela.id);
  assert.equal(parcela.pago, true, 'a guarda de dentro segura');
  assert.equal(sonho.valorAtual, 1000);
});

test('INV-18: parcela de compromisso (previdência) NÃO pode ser revertida', () => {
  const { s, conta } = base();
  s.transacoes.push({
    id: 'tx_compromisso_9_1',
    compromissoId: 9,
    compromissoCategoria: 'previdencia',
    categoria: 'investimento_fixo',
    descricao: 'Previdência: PGBL',
    valor: 500,
    contaId: conta.id,
    mes: HOJE.getMonth(),
    ano: HOJE.getFullYear(),
    pago: true,
  });
  assert.equal(s.controlePodeReverterPagamento(s.transacoes[0]), false);
});

test('INV-18: aporte de pé com transação pendente é acusado', () => {
  const v = validarEstado(
    {
      contas: [{ id: 'c1', nome: 'Nubank' }],
      transacoes: [
        {
          id: 'tx_1',
          categoria: 'sonho',
          sonhoId: 'sonho_1',
          valor: 1000,
          contaId: 'c1',
          mes: 0,
          ano: 2026,
          pago: false, // foi revertida...
        },
      ],
      sonhos: [
        {
          id: 'sonho_1',
          nome: 'Viagem',
          valorAtual: 1000,
          aportes: [{ id: 'a1', valor: 1000, txId: 'tx_1' }], // ...mas o aporte ficou
        },
      ],
    },
    { apenas: ['INV-18'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /contado duas vezes/);
  assert.equal(v[0].gravidade, 'critica');
});

test('INV-18: posição de pé com parcela pendente é acusada', () => {
  const v = validarEstado(
    {
      contas: [{ id: 'c1', nome: 'Nubank' }],
      transacoes: [
        {
          id: 'tx_compromisso_9_1',
          compromissoId: 9,
          categoria: 'investimento_fixo',
          valor: 500,
          contaId: 'c1',
          mes: 0,
          ano: 2026,
          pago: false,
        },
      ],
      historicoCompras: [
        {
          id: 'aporte_compromisso_tx_compromisso_9_1',
          geradoDoCompromissoTx: 'tx_compromisso_9_1',
        },
      ],
    },
    { apenas: ['INV-18'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /continua no patrimônio/);
});

test('INV-18: parcela desfeita passa a sair da conta que o sonho usa HOJE (INV-22)', () => {
  // Achado pelo simulador (semente 19): pagar, trocar a conta do sonho e
  // desfazer deixava o compromisso pendente apontando para a conta antiga.
  const { s, sonho, parcela } = sonhoComParcelaPaga(false);
  const nova = s.criarConta({ nome: 'Itaú', tipo: 'banco', saldoInicial: 0 });
  // O que a edição do sonho faz: muda a conta e leva junto as parcelas a pagar.
  sonho.contaOrigemId = nova.id;
  s.transacoes.filter((t) => t.sonhoId && !t.pago).forEach((t) => (t.contaId = nova.id));
  s.reverterPagamento(parcela.id);
  assert.equal(parcela.pago, false);
  assert.equal(parcela.contaId, nova.id);
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-18: sonho excluído com histórico — a parcela paga é só registro', () => {
  // Achado pelo simulador (semente 28): desfazer recriava uma conta a pagar
  // de um sonho que não existe mais.
  const { s, parcela } = sonhoComParcelaPaga(false);
  s.sonhos = [];
  assert.equal(s.controlePodeReverterPagamento(parcela), false);
  s.reverterPagamento(parcela.id);
  assert.equal(parcela.pago, true);
});
