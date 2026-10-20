'use strict';

// P0 da avaliação de UX (docs/AVALIACAO-UX-2026-10.md): o app não pode decidir
// coisas importantes em silêncio.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-sonhos.js']);
const H = new Date();
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function app() {
  const fields = {};
  const s = carregarApp(fields, ORDEM);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 5000 });
  return { s, fields, conta };
}

function conta(s, contaId, extra) {
  const t = Object.assign(
    {
      id: 'tx_luz',
      descricao: 'Luz',
      valor: 180,
      categoria: 'despesa_fixa',
      banco: 'Nubank',
      contaId,
      mes: H.getMonth(),
      ano: H.getFullYear(),
      data: H.toISOString(),
      dataVencimento: ymd(new Date(H.getFullYear(), H.getMonth(), 31)),
      pago: false,
    },
    extra || {}
  );
  s.transacoes.push(t);
  return t;
}

test('P0-1: baixa com R$ 0 numa conta comum não marca como paga', () => {
  const { s, fields, conta: c } = app();
  const t = conta(s, c.id);
  fields['input-pago-' + t.id] = '0,00';
  s.confirmarPagamento(t.id);
  assert.equal(t.pago, false);
  assert.equal(t.valor, 180, 'o valor previsto não vira zero');
});

test('P0-1: "Passar para o mês que vem" leva a conta e o vencimento juntos', () => {
  const { s, conta: c } = app();
  const t = conta(s, c.id, { dataVencimento: ymd(new Date(H.getFullYear(), H.getMonth(), 31)) });
  s.adiarLancamentoUmMes(t.id);
  const prox = new Date(H.getFullYear(), H.getMonth() + 1, 1);
  assert.equal(t.mes, prox.getMonth());
  assert.equal(t.ano, prox.getFullYear());
  assert.equal(t.pago, false);
  const [a, m, d] = t.dataVencimento.split('-').map(Number);
  assert.equal(m - 1, prox.getMonth(), 'vencimento no mês seguinte');
  assert.equal(a, prox.getFullYear());
  assert.ok(d >= 28 && d <= 31, 'dia 31 vira o último dia do mês seguinte');
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('P0-1: baixa com valor > 0 continua normal', () => {
  const { s, fields, conta: c } = app();
  const t = conta(s, c.id);
  fields['input-pago-' + t.id] = '175,00';
  s.confirmarPagamento(t.id);
  assert.equal(t.pago, true);
  assert.equal(t.valor, 175);
});

test('P0-2: parcela de sonho não se exclui pelo Controle (nem a paga, nem a a pagar)', () => {
  const { s, conta: c } = app();
  const sonho = {
    id: 'sonho_1',
    nome: 'Viagem',
    valorTotal: 1200,
    valorAtual: 100,
    aportes: [{ id: 'ap1', valor: 100, txId: 'tx_s1', tipo: 'mensal_pago' }],
    contaOrigemId: c.id,
    planoVinculado: true,
    prazoMeses: 12,
    mesesRestantes: 11,
  };
  s.sonhos = [sonho];
  const paga = conta(s, c.id, {
    id: 'tx_s1',
    descricao: 'Sonho: Viagem',
    categoria: 'sonho',
    sonhoId: 'sonho_1',
    valor: 100,
    pago: true,
    groupId: 'g1',
  });
  const aPagar = conta(s, c.id, {
    id: 'tx_s2',
    descricao: 'Sonho: Viagem',
    categoria: 'sonho',
    sonhoId: 'sonho_1',
    valor: 100,
    groupId: 'g1',
  });

  s.deletarTransacao(paga.id);
  s.executarDelecao('todas'); // mesmo que alguém chame direto
  s.deletarTransacao(aPagar.id);
  s.executarDelecao('unica');

  assert.ok(
    s.transacoes.some((t) => t.id === 'tx_s1'),
    'a paga continua'
  );
  assert.ok(
    s.transacoes.some((t) => t.id === 'tx_s2'),
    'a pagar continua'
  );
  assert.equal(sonho.valorAtual, 100);
  assert.equal(sonho.aportes.length, 1);
});

test('P0-2: lançamento comum continua sendo excluído', () => {
  const { s, conta: c } = app();
  const t = conta(s, c.id);
  s.deletarTransacao(t.id);
  s.executarDelecao('unica');
  assert.ok(!s.transacoes.some((x) => x.id === t.id));
});

test('P0-3: a mensagem de salvar diz o que o app decidiu sozinho', () => {
  const { s } = app();
  const um = (o) => [Object.assign({ categoria: 'despesa_variavel', pago: true }, o)];
  assert.match(s.complementoLancamentoSalvo(um(), { banco: 'Nubank' }), /pago e saiu de Nubank/);
  assert.match(s.complementoLancamentoSalvo(um({ pago: false }), {}), /a pagar até o vencimento/);
  const serie = Array.from({ length: 60 }, () => ({ categoria: 'despesa_fixa', pago: false }));
  assert.match(s.complementoLancamentoSalvo(serie, {}), /próximos 5 anos/);
  const parcelado = Array.from({ length: 3 }, () => ({ categoria: 'cartao_credito' }));
  assert.equal(s.complementoLancamentoSalvo(parcelado, {}), '', 'parcelado já tem a mensagem dele');
  assert.equal(s.complementoLancamentoSalvo(um({ categoria: 'receita' }), {}), '');
});

test('P0-5: arquivar conta pede confirmação; só arquiva depois do "Arquivar"', () => {
  const { s, conta: c } = app();
  s.renderMinhasContas = () => {};
  s.arquivarContaUI(c.id);
  assert.ok(!c.arquivada, 'o primeiro clique só abre a confirmação');
  s.arquivarContaUI(c.id, true);
  assert.equal(c.arquivada, true);
});

test('P0-5: arquivar cartão pede confirmação (sem confirm do navegador)', () => {
  const { s } = app();
  s.cartoes.length = 0;
  s.cartoes.push({ id: 'k1', nome: 'Nubank', diaFechamento: 2, diaVencimento: 10 });
  s.cartoes.push({ id: 'k2', nome: 'Inter', diaFechamento: 5, diaVencimento: 12 });
  s.confirm = () => {
    throw new Error('confirm() não deve ser usado');
  };
  s.renderizarListaCartoesConfig = () => {};
  s.atualizarSelectCartoesForm = () => {};
  s.arquivarCartaoConfig('k1');
  assert.ok(!s.cartoes[0].arquivado);
  s.arquivarCartaoConfig('k1', true);
  assert.equal(s.cartoes[0].arquivado, true);
});

test('P0-6: cartão criado no lançamento nasce com a conta que paga a fatura', () => {
  const { s, fields, conta: c } = app();
  s.cartoes.length = 0;
  Object.assign(fields, {
    inlineCartaoNome: 'C6',
    inlineCartaoLimite: '1.000,00',
    inlineCartaoDiaFech: '3',
    inlineCartaoDiaVenc: '10',
  });
  s.salvarNovoCartaoInline();
  const novo = s.cartoes.find((k) => k.nome === 'C6');
  assert.ok(novo);
  assert.equal(novo.contaPagadoraId, c.id, 'com uma conta só, ela paga a fatura');
});

test('P0-7: simulador avisa que é simulação; carteira sugerida não ancora em R$ 10 mil', () => {
  const fs = require('fs');
  const html = fs.readFileSync(
    require('path').join(__dirname, '..', 'Appliquei_v13.0.html'),
    'utf8'
  );
  const sim = html.slice(
    html.indexOf('<section id="simulador"'),
    html.indexOf('<section id="simulador"') + 3000
  );
  assert.match(sim, /não é promessa de rendimento nem recomendação de investimento/);
  assert.match(html, /id="cartQCapital" value="1\.000,00"/);
});
