'use strict';

// Simulação exaustiva das ações de Investimentos e Meu Patrimônio.
//
// É onde o dinheiro atravessa mais telas: uma compra cria duas pernas de
// transação e uma posição; um pagamento de fatura debita a conta pagadora do
// cartão; uma transferência move caixa entre instituições sem mudar o total.
//
// Dois defeitos reais saíram daqui, ambos corrigidos:
//
//  1. criarTransferencia aceitava conta INEXISTENTE — `obterConta(id) || {}`
//     engolia o caso e as duas pernas nasciam apontando para o nada (INV-01).
//  2. criarTransferencia não checava saldo, deixando a conta de origem
//     negativa — a mesma saída de dinheiro que a compra de ativo bloqueia.
//
// Ver .claude/skills/simular-acao/SKILL.md.

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarMundo, executar, problemas, ymd } = require('./_simulador.js');

const H = ymd(new Date());

function camposCompra(m, extra) {
  return Object.assign(
    {
      compraTicker: 'VALE3',
      tipoOperacao: 'compra',
      compraCategoria: 'renda_variavel',
      compraCorretora: 'Rico',
      compraData: '',
      compraVencimento: '',
      compraRentabilidade: '',
      compraQtd: '10',
      compraPreco: '50,00',
      compraSubcategoria: 'acoes',
      compraOrigemRecurso: m.ref.nubank.id,
      compraOrigemBanco: '',
      prevSaldoInicial: '',
      prevRecorrente: false,
      prevDiaRecorrencia: '',
      prevDuracaoAnos: '',
      prevTaxaMensal: '',
      compraTotalOp: '',
      compraDestinoRecurso: '',
    },
    extra || {}
  );
}

// ----------------------------------------------------------- investimentos --

test('compra: entradas inválidas são recusadas sem tocar no estado', () => {
  const invalidas = [
    ['qtd zero', { compraQtd: '0' }],
    ['qtd negativa', { compraQtd: '-10' }],
    ['preço zero', { compraPreco: '0' }],
    ['preço negativo', { compraPreco: '-50' }],
    ['ticker vazio', { compraTicker: '' }],
    ['acima do saldo', { compraQtd: '10000' }],
    ['sem conta-origem', { compraOrigemRecurso: '' }],
    ['conta-origem inexistente', { compraOrigemRecurso: 'fantasma' }],
  ];
  for (const [rotulo, extra] of invalidas) {
    const m = criarMundo();
    const rel = executar(m, {
      nome: 'compra ' + rotulo,
      campos: camposCompra(m, extra),
      fn: (s) => s.registrarOperacaoAtivo(),
    });
    assert.equal(problemas(rel, { deveRecusar: true, semMudarPatrimonio: true }), '');
  }
});

test('compra válida: patrimônio total não muda (caixa vira ativo)', () => {
  const m = criarMundo();
  const rel = executar(m, {
    nome: 'compra válida',
    campos: camposCompra(m),
    fn: (s) => s.registrarOperacaoAtivo(),
  });
  assert.equal(problemas(rel, { deltaPatrimonio: 0 }), '');
  assert.equal(m.s.historicoCompras.length, 2, 'a nova operação entrou');
});

test('compra: clicar duas vezes não duplica a operação', () => {
  const m = criarMundo();
  const primeiro = executar(m, {
    nome: 'primeiro clique',
    campos: camposCompra(m),
    fn: (s) => s.registrarOperacaoAtivo(),
  });
  assert.equal(problemas(primeiro, { deltaPatrimonio: 0 }), '');
  const opsDepois = m.s.historicoCompras.length;

  // O formulário é limpo no sucesso, então o segundo clique não tem o que gravar.
  const segundo = executar(m, { nome: 'segundo clique', fn: (s) => s.registrarOperacaoAtivo() });
  assert.equal(problemas(segundo, { semMudarPatrimonio: true }), '');
  assert.equal(m.s.historicoCompras.length, opsDepois, 'nenhuma operação a mais');
});

test('venda acima da posição é recusada', () => {
  const m = criarMundo();
  const rel = executar(m, {
    nome: 'venda acima da posição',
    campos: camposCompra(m, {
      compraTicker: 'PETR4',
      tipoOperacao: 'venda',
      compraQtd: '99999',
      compraPreco: '30,00',
      compraDestinoRecurso: m.ref.nubank.id,
    }),
    fn: (s) => s.registrarOperacaoAtivo(),
  });
  assert.equal(problemas(rel, { deveRecusar: true, semMudarPatrimonio: true }), '');
});

test('venda parcial credita a conta de destino', () => {
  const m = criarMundo();
  const caixaAntes = m.s.mpCalcularSaldoTotal(Date.now());
  const rel = executar(m, {
    nome: 'venda parcial',
    campos: camposCompra(m, {
      compraTicker: 'PETR4',
      tipoOperacao: 'venda',
      compraQtd: '50',
      compraPreco: '30,00',
      compraDestinoRecurso: m.ref.nubank.id,
    }),
    fn: (s) => s.registrarOperacaoAtivo(),
  });
  assert.equal(problemas(rel), '');
  assert.equal(m.s.mpCalcularSaldoTotal(Date.now()), caixaAntes + 1500, 'o caixa recebeu a venda');
});

// -------------------------------------------------------------- patrimônio --

test('transferência: move caixa sem mudar o total', () => {
  const m = criarMundo();
  const rel = executar(m, {
    nome: 'transferência válida',
    fn: (s) => s.criarTransferencia(m.ref.nubank.id, m.ref.itau.id, 300, H),
  });
  assert.equal(problemas(rel, { semMudarPatrimonio: true }), '');
  const saldos = m.s.mpCalcularSaldoPorInstituicao(Date.now());
  assert.equal(saldos[m.ref.itau.id].caixa, 800, 'Itaú: 500 + 300');
});

test('transferência: casos inválidos não criam nada', () => {
  const casos = [
    ['acima do saldo', (m) => [m.ref.itau.id, m.ref.nubank.id, 999999]],
    ['mesma conta', (m) => [m.ref.nubank.id, m.ref.nubank.id, 100]],
    ['valor zero', (m) => [m.ref.nubank.id, m.ref.itau.id, 0]],
    ['valor negativo', (m) => [m.ref.nubank.id, m.ref.itau.id, -100]],
    ['origem inexistente', (m) => ['fantasma', m.ref.itau.id, 100]],
    ['destino inexistente', (m) => [m.ref.nubank.id, 'fantasma', 100]],
  ];
  for (const [rotulo, args] of casos) {
    const m = criarMundo();
    const antes = m.s.transacoes.length;
    const rel = executar(m, {
      nome: 'transferência ' + rotulo,
      fn: (s) => s.criarTransferencia(...args(m), H),
    });
    assert.equal(problemas(rel, { semMudarPatrimonio: true }), '');
    assert.equal(m.s.transacoes.length, antes, `"${rotulo}" não pode criar perna nenhuma`);
  }
});

test('fusão de contas preserva o patrimônio e os registros legados', () => {
  const m = criarMundo();
  const rel = executar(m, {
    nome: 'fundir Itaú em Nubank',
    fn: (s) => s.fundirContas(m.ref.nubank.id, [m.ref.itau.id]),
  });
  assert.equal(problemas(rel, { semMudarPatrimonio: true }), '');
});

test('pagar a fatura do cartão debita a conta pagadora', () => {
  const m = criarMundo();
  const rel = executar(m, {
    nome: 'pagar fatura',
    campos: { 'input-pago-sim_fatura': '350,00' },
    fn: (s) => s.confirmarPagamento('sim_fatura'),
  });
  assert.equal(problemas(rel, { deltaPatrimonio: -350 }), '');
  const t = m.s.transacoes.find((x) => x.id === 'sim_fatura');
  assert.equal(t.contaId, m.ref.nubank.id, 'carimbou a conta pagadora do cartão');
});

test('pagar fatura com valor negativo é recusado', () => {
  const m = criarMundo();
  const rel = executar(m, {
    nome: 'pagar fatura negativa',
    campos: { 'input-pago-sim_fatura': '-350' },
    fn: (s) => s.confirmarPagamento('sim_fatura'),
  });
  assert.equal(problemas(rel, { deveRecusar: true, semMudarPatrimonio: true }), '');
});

test('reverter o pagamento devolve o dinheiro ao caixa', () => {
  const m = criarMundo();
  const rel = executar(m, {
    nome: 'pagar e reverter',
    campos: { 'input-pago-sim_fatura': '350,00' },
    fn: (s) => {
      s.confirmarPagamento('sim_fatura');
      s.reverterPagamento('sim_fatura');
    },
  });
  assert.equal(problemas(rel, { deltaPatrimonio: 0 }), '');
});

test('arquivar conta com saldo tira o saldo do patrimônio', () => {
  const m = criarMundo();
  const rel = executar(m, {
    nome: 'arquivar conta com saldo',
    fn: (s) => s.arquivarConta(m.ref.itau.id),
  });
  assert.equal(problemas(rel), '');
  assert.ok(rel.deltaPatrimonio < 0, 'o saldo da conta arquivada sai do total');
});

test('a limpeza de órfãs remove AS DUAS pernas, não só a de caixa', () => {
  const m = criarMundo();
  // Estado torto que só chegaria por outro caminho (sync parcial, bug antigo).
  m.s.historicoCompras.length = 0;
  const rel = executar(m, { nome: 'limpeza de órfãs', fn: (s) => s.mpLimparTxOrigemOrfas() });
  assert.equal(problemas(rel), '');
  assert.equal(
    m.s.transacoes.filter((t) => t.operacaoId != null).length,
    0,
    'perna do ativo órfã também tem de sair — senão fica com temLegCaixa e nada debita'
  );
});
