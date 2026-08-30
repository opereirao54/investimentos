'use strict';

// INV-18 — Pagamento com efeito colateral não é reversível pelo Controle.
//
// Pagar uma despesa comum só alterna um flag. Pagar um compromisso de sonho ou
// de previdência ATRAVESSA MÓDULOS: gera aporte no sonho, ou posição no
// patrimônio. Desfazer só o flag deixaria o efeito de pé — o mesmo dinheiro
// contado duas vezes: guardado no sonho E ainda pendente no Controle.
//
// Por isso controlePodeReverterPagamento recusa qualquer transação com
// sonhoId ou compromissoId. Essas voltam pelas suas próprias abas, onde o
// efeito é desfeito junto.
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

test('INV-18: parcela de sonho paga NÃO pode ser revertida', () => {
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
    dataInicio: new Date(HOJE.getFullYear(), HOJE.getMonth(), 1).toISOString(),
  };
  s.sonhos = [sonho];
  s.gerarLancamentosMensaisSonho(sonho, 1000, 3);
  const parcela = s.transacoes.find((t) => t.categoria === 'sonho');
  fields['input-pago-' + parcela.id] = '1.000,00';
  s.confirmarPagamento(parcela.id);

  assert.equal(sonho.aportes.length, 1, 'o pagamento gerou aporte no sonho');
  assert.equal(
    s.controlePodeReverterPagamento(parcela),
    false,
    'reverter aqui deixaria o aporte de pé — tem de ser recusado'
  );

  // E se alguém chamar mesmo assim, a guarda de dentro segura.
  s.reverterPagamento(parcela.id);
  assert.equal(parcela.pago, true, 'a transação continua paga');
  assert.equal(sonho.valorAtual, 1000, 'e o sonho continua coerente');
  assert.equal(validarEstado(estadoDe(s)).length, 0);
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
