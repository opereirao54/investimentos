'use strict';

// Simulação exaustiva dos botões da aba Meus Sonhos.
//
// Enquanto os testes de invariante perguntam "este estado está são?", estes
// perguntam "e se o usuário apertar ESTE botão, de todas as formas possíveis?".
// Cada caso roda num mundo completo — contas com saldo, receita, cartão com
// fatura, investimento com as duas pernas, bem — e valida o sistema INTEIRO
// depois. Assim um botão de Sonhos que estrague o Patrimônio é pego.
//
// Cinco defeitos reais saíram desta simulação, todos já corrigidos:
//
//  1. finalizarAporteSonho não validava NADA (é o funil de três caminhos):
//     valor zero, negativo ou não-finito gravava um aporte lixo.
//  2. data inválida estourava "Invalid time value" no toISOString e travava.
//  3. aporte acima do saldo deixava o caixa NEGATIVO — dinheiro inventado,
//     o que a compra de ativo já bloqueava desde sempre.
//  4. salvarEdicaoAporteSonho tinha a MESMA porta aberta: fechar a do aporte
//     não fechou a da edição.
//  5. trocar a conta de origem do sonho não recarimbava os compromissos já
//     criados — cada parcela pendente seguia debitando o banco antigo.
//
// Ver .claude/skills/simular-acao/SKILL.md.

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarMundo, executar, problemas, ymd } = require('./_simulador.js');

const H = ymd(new Date());

/** Roda um caso e falha com o relatório completo se houver problema. */
function simular(nome, fn, esperado) {
  const m = criarMundo();
  const rel = executar(m, { nome, fn: fn(m) });
  const p = problemas(rel, esperado);
  assert.equal(p, '', p);
  return { m, rel };
}

// ---------------------------------------------------------------- aporte ----

test('aporte: entradas inválidas são recusadas sem tocar no estado', () => {
  const invalidas = [
    ['zero', 0],
    ['negativo', -500],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['gigante (acima do saldo)', 1e15],
    ['acima do saldo da conta', 999999],
  ];
  for (const [rotulo, valor] of invalidas) {
    simular(
      `aporte ${rotulo}`,
      () => (s) => s.finalizarAporteSonho('sonho_sim', valor, H, 'esporadico', null),
      { deveRecusar: true, semMudarPatrimonio: true }
    );
  }
});

test('aporte: valor válido debita a conta e mantém tudo coerente', () => {
  const { m } = simular(
    'aporte válido',
    () => (s) => s.finalizarAporteSonho('sonho_sim', 500, H, 'esporadico', null),
    { deltaPatrimonio: -500 }
  );
  const sonho = m.s.sonhos[0];
  assert.equal(sonho.valorAtual, 1500, 'o sonho subiu exatamente o aporte');
  const ap = sonho.aportes[sonho.aportes.length - 1];
  assert.ok(ap.txId, 'o aporte ficou ligado à transação');
});

test('aporte: data inválida cai para hoje em vez de travar a tela', () => {
  simular(
    'aporte com data lixo',
    () => (s) => s.finalizarAporteSonho('sonho_sim', 500, 'abacaxi', 'esporadico', null),
    { deltaPatrimonio: -500 }
  );
});

test('aporte: sonho inexistente é no-op silencioso', () => {
  simular(
    'aporte em sonho inexistente',
    () => (s) => s.finalizarAporteSonho('nao_existe', 500, H, 'esporadico', null)
  );
});

test('aporte por migração: caixa parado, investimento abatido', () => {
  // Migração é dinheiro mudando de lugar, não gasto novo — o CAIXA não se
  // move, porque as duas pernas (aporte + resgate compensatório) se anulam.
  // Mas o ativo de origem é VENDIDO, então o investido cai. O patrimônio total
  // desce pelo mesmo motivo que um aporte comum o faz: sonho não é um bolso do
  // patrimônio, é dinheiro comprometido que saiu de vista.
  const m = criarMundo();
  const caixaAntes = m.s.mpCalcularSaldoTotal(Date.now());
  const rel = executar(m, {
    nome: 'migração',
    fn: (s) => s.finalizarAporteSonho('sonho_sim', 2000, H, 'migracao', { origemAtivo: 'PETR4' }),
  });
  assert.equal(problemas(rel, { deltaPatrimonio: -2000 }), '');
  assert.equal(m.s.mpCalcularSaldoTotal(Date.now()), caixaAntes, 'o caixa não se move');
  const venda = m.s.historicoCompras.find((o) => o.tipo === 'venda');
  assert.ok(venda, 'a migração registra a venda do ativo de origem');
  assert.equal(venda.quantidade * venda.preco_op, 2000);
});

// ----------------------------------------------------------- editar aporte --

function comAporteExtra() {
  const m = criarMundo();
  m.s.finalizarAporteSonho('sonho_sim', 500, H, 'esporadico', null);
  const sonho = m.s.sonhos[0];
  m.ref.aporte = sonho.aportes[sonho.aportes.length - 1];
  return m;
}

test('editar aporte: entradas inválidas são recusadas', () => {
  const invalidas = [
    ['zero', '0'],
    ['negativo', '-100'],
    ['vazio', ''],
    ['acima do saldo', '999.999,00'],
  ];
  for (const [rotulo, valor] of invalidas) {
    const m = comAporteExtra();
    const rel = executar(m, {
      nome: `editar aporte ${rotulo}`,
      campos: { editAporteValor: valor, editAporteData: H },
      fn: (s) => s.salvarEdicaoAporteSonho('sonho_sim', m.ref.aporte.id),
    });
    const p = problemas(rel, { deveRecusar: true, semMudarPatrimonio: true });
    assert.equal(p, '', p);
  }
});

test('editar aporte: data inválida é recusada em vez de virar lixo no histórico', () => {
  const m = comAporteExtra();
  const rel = executar(m, {
    nome: 'editar aporte com data lixo',
    campos: { editAporteValor: '600,00', editAporteData: 'abacaxi' },
    fn: (s) => s.salvarEdicaoAporteSonho('sonho_sim', m.ref.aporte.id),
  });
  assert.equal(problemas(rel, { deveRecusar: true, semMudarPatrimonio: true }), '');
});

test('editar aporte: aumentar respeita o saldo; diminuir sempre passa', () => {
  const m1 = comAporteExtra();
  const sobe = executar(m1, {
    nome: 'aumentar dentro do saldo',
    campos: { editAporteValor: '800,00', editAporteData: H },
    fn: (s) => s.salvarEdicaoAporteSonho('sonho_sim', m1.ref.aporte.id),
  });
  assert.equal(problemas(sobe, { deltaPatrimonio: -300 }), '');

  const m2 = comAporteExtra();
  const desce = executar(m2, {
    nome: 'diminuir',
    campos: { editAporteValor: '200,00', editAporteData: H },
    fn: (s) => s.salvarEdicaoAporteSonho('sonho_sim', m2.ref.aporte.id),
  });
  assert.equal(problemas(desce, { deltaPatrimonio: 300 }), '');
});

test('editar aporte: ids inexistentes não quebram nada', () => {
  for (const [sonhoId, aporteId] of [
    ['sonho_sim', 'ap_fantasma'],
    ['nao_existe', 'ap_fantasma'],
  ]) {
    const m = comAporteExtra();
    const rel = executar(m, {
      nome: `editar aporte ${sonhoId}/${aporteId}`,
      campos: { editAporteValor: '600,00', editAporteData: H },
      fn: (s) => s.salvarEdicaoAporteSonho(sonhoId, aporteId),
    });
    assert.equal(problemas(rel, { semMudarPatrimonio: true }), '');
  }
});

// ---------------------------------------------------------- excluir aporte --

test('excluir aporte: devolve o dinheiro e some das duas pontas', () => {
  const m = comAporteExtra();
  const txId = m.ref.aporte.txId;
  const rel = executar(m, {
    nome: 'excluir aporte',
    fn: (s) => s.confirmarExcluirAporteSonho('sonho_sim', m.ref.aporte.id),
  });
  assert.equal(problemas(rel, { deltaPatrimonio: 500 }), '');
  assert.ok(!m.s.transacoes.some((t) => t.id === txId), 'a transação vinculada saiu junto');
  assert.equal(m.s.sonhos[0].valorAtual, 1000, 'o sonho voltou ao que era');
});

test('excluir aporte: duas vezes seguidas — a segunda é no-op', () => {
  const m = comAporteExtra();
  const rel = executar(m, {
    nome: 'excluir aporte duas vezes',
    fn: (s) => {
      s.confirmarExcluirAporteSonho('sonho_sim', m.ref.aporte.id);
      s.confirmarExcluirAporteSonho('sonho_sim', m.ref.aporte.id);
    },
  });
  assert.equal(problemas(rel, { deltaPatrimonio: 500 }), '');
});

// ------------------------------------------------------------ editar sonho --

function camposSonho(m, extra) {
  return Object.assign(
    {
      sonhoNome: 'Viagem',
      sonhoValorTotal: '12.000,00',
      sonhoPrazo: '12',
      sonhoPrazoUnidade: 'meses',
      sonhoValorInicial: '1.000,00',
      sonhoDescricao: '',
      sonhoContaOrigem: m.ref.nubank.id,
      sonhoMesInicio: '',
      sonhoCategoria: 'viagem',
      sonhoEsforco: 'medio',
    },
    extra || {}
  );
}

test('editar sonho: trocar a conta recarimba os compromissos pendentes', () => {
  const m = criarMundo();
  const rel = executar(m, {
    nome: 'trocar conta de origem',
    campos: camposSonho(m, { sonhoContaOrigem: m.ref.itau.id }),
    fn: (s) => {
      s.sonhoEditandoId = 'sonho_sim';
      s.salvarSonho();
    },
  });
  assert.equal(problemas(rel), '');
  const pendentes = m.s.transacoes.filter((t) => t.categoria === 'sonho' && !t.pago);
  assert.ok(pendentes.length > 0);
  for (const t of pendentes) {
    assert.equal(t.contaId, m.ref.itau.id, 'cada parcela pendente passou a debitar a conta nova');
  }
});

test('editar sonho: conta inexistente é recusada', () => {
  const m = criarMundo();
  const rel = executar(m, {
    nome: 'conta fantasma',
    campos: camposSonho(m, { sonhoContaOrigem: 'conta_fantasma' }),
    fn: (s) => {
      s.sonhoEditandoId = 'sonho_sim';
      s.salvarSonho();
    },
  });
  assert.equal(problemas(rel, { deveRecusar: true, semMudarPatrimonio: true }), '');
});

test('editar sonho: metas e prazos degenerados não quebram o sistema', () => {
  for (const extra of [
    { sonhoValorTotal: '0' },
    { sonhoValorTotal: '500,00' }, // abaixo do já guardado
    { sonhoPrazo: '0' },
    { sonhoPrazo: '9999' },
    { sonhoValorInicial: '-100' },
  ]) {
    const m = criarMundo();
    const rel = executar(m, {
      nome: 'editar sonho ' + JSON.stringify(extra),
      campos: camposSonho(m, extra),
      fn: (s) => {
        s.sonhoEditandoId = 'sonho_sim';
        s.salvarSonho();
      },
    });
    assert.equal(problemas(rel), '');
  }
});

// --------------------------------------------------------------- exclusão ---

test('excluir sonho (manter histórico): nenhum pendente sobrevive, nem o do mês corrente', () => {
  const m = criarMundo();
  const rel = executar(m, {
    nome: 'excluir mantendo histórico',
    fn: (s) => s.confirmarExcluirSonho('sonho_sim'),
  });
  assert.equal(problemas(rel), '');
  const sobra = m.s.transacoes.filter((t) => t.sonhoId === 'sonho_sim');
  assert.ok(
    sobra.every((t) => t.pago),
    'só o histórico pago pode sobrar — pendente do mês CORRENTE também tem de sair'
  );
});

test('excluir sonho (tudo): não sobra rastro', () => {
  const m = criarMundo();
  const rel = executar(m, {
    nome: 'excluir tudo',
    fn: (s) => s.confirmarExcluirSonhoCompleto('sonho_sim'),
  });
  assert.equal(problemas(rel), '');
  assert.equal(m.s.transacoes.filter((t) => t.sonhoId === 'sonho_sim').length, 0);
});
