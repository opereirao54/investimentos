'use strict';

// INV-05 — Vocabulário de categorias é fechado e classificado.
//
// O vocabulário é fechado POR CONSEQUÊNCIA, não por declaração: mpEhEntradaCaixa
// lista as entradas, e tudo o que não está lá vira saída. Uma categoria nova
// inventada por um produtor qualquer não dá erro — ela é silenciosamente tratada
// como despesa de consumo que debita quando pago:true, infla o indicador de
// Despesa e some do agrupamento do relatório.
//
// Este teste varre o CÓDIGO à procura de literais gravados em transacoes.push
// e confere contra o mapa. É a trava que pega o produtor novo.
//
// CUIDADO com a armadilha: existem DOIS vocabulários de `categoria` no app.
// O de transacao (este) e o de operacao (renda_variavel, renda_fixa,
// reserva_emergencia, previdencia). previdencia.js usa os dois no mesmo fluxo.
//
// Ver .claude/integracoes/mapa.json → INV-05.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./_harness-integracao.js');
const { MAPA, CATEGORIAS_CONHECIDAS, validarEstado } = require('../scripts/lib/invariantes.js');

const ROOT = path.resolve(__dirname, '..');

/**
 * Extrai as categorias gravadas em `transacoes.push({...})` de um arquivo.
 * Devolve { literais: Set<string>, dinamicas: Array<{expr, linha}> }.
 */
function categoriasEscritas(arquivo) {
  const src = fs.readFileSync(path.join(ROOT, arquivo), 'utf8');
  const literais = new Set();
  const dinamicas = [];
  const alvo = 'transacoes.push(';
  let i = 0;
  while ((i = src.indexOf(alvo, i)) !== -1) {
    // Casa as chaves a partir do '(' para isolar o objeto literal.
    let j = i + alvo.length;
    let profundidade = 0;
    const inicio = j;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '(' || c === '{' || c === '[') profundidade++;
      else if (c === ')' && profundidade === 0) break;
      else if (c === ')' || c === '}' || c === ']') profundidade--;
    }
    const bloco = src.slice(inicio, j);
    const m = /(?:^|[\s,{])categoria\s*:\s*([^,\n]+)/.exec(bloco);
    if (m) {
      const valor = m[1].trim().replace(/,$/, '');
      const lit = /^'([a-z_]+)'$/.exec(valor);
      if (lit) literais.add(lit[1]);
      else {
        const linha = src.slice(0, inicio).split('\n').length;
        dinamicas.push({ expr: valor, linha, arquivo });
      }
    }
    i = j;
  }
  return { literais, dinamicas };
}

const PRODUTORES = MAPA.entidades.transacao.produtores;

test('INV-05: toda categoria literal gravada em transacoes consta no mapa', () => {
  const desconhecidas = [];
  for (const arquivo of PRODUTORES) {
    if (!fs.existsSync(path.join(ROOT, arquivo))) continue;
    const { literais } = categoriasEscritas(arquivo);
    for (const cat of literais) {
      if (!CATEGORIAS_CONHECIDAS.has(cat)) desconhecidas.push(`${arquivo} → "${cat}"`);
    }
  }
  assert.deepEqual(
    desconhecidas,
    [],
    'Categorias gravadas em transacoes que não estão no vocabulário do mapa:\n  ' +
      desconhecidas.join('\n  ') +
      '\n\nUma categoria fora do vocabulário é tratada como despesa de consumo por ' +
      'omissão. Classifique-a em .claude/integracoes/mapa.json → ' +
      'entidades.transacao.vocabularioCategorias e confira se mpEhEntradaCaixa / ' +
      'mpEhDespesaConsumo (patrimonio.js) a tratam como você espera.'
  );
});

test('INV-05: categorias dinâmicas são poucas e conhecidas', () => {
  // `categoria: categoria` (o valor vem do <select>) e `categoria: tipoAtivoStr`
  // não dão para resolver estaticamente — precisam de teste de cenário, e têm.
  // O que este teste protege é o INVENTÁRIO: se aparecer uma expressão dinâmica
  // nova, alguém tem de decidir conscientemente como cobri-la.
  const dinamicas = [];
  for (const arquivo of PRODUTORES) {
    if (!fs.existsSync(path.join(ROOT, arquivo))) continue;
    dinamicas.push(...categoriasEscritas(arquivo).dinamicas);
  }
  const esperadas = ['categoria', 'tipoAtivoStr'];
  const inesperadas = dinamicas.filter((d) => !esperadas.includes(d.expr));
  assert.deepEqual(
    inesperadas.map((d) => `${d.arquivo}:${d.linha} → ${d.expr}`),
    [],
    'Expressão dinâmica nova em transacoes.push({categoria: ...}). Uma categoria que ' +
      'só existe em runtime não pode ser validada estaticamente: garanta que existe um ' +
      'teste de cenário cobrindo os valores que ela assume, e some-a à lista `esperadas`.'
  );
});

test('INV-05: o vocabulário do mapa bate com mpEhEntradaCaixa do código', () => {
  const s = carregarApp();
  const v = MAPA.entidades.transacao.vocabularioCategorias;
  for (const cat of v.entradaCaixa) {
    assert.equal(
      s.mpEhEntradaCaixa(cat),
      true,
      `o mapa classifica "${cat}" como entrada de caixa, mas mpEhEntradaCaixa diz que não`
    );
  }
  for (const cat of [].concat(
    v.aporte,
    v.transferenciaSaida,
    v.despesaConsumo,
    v.poupancaDirecionada
  )) {
    assert.equal(
      s.mpEhEntradaCaixa(cat),
      false,
      `o mapa NÃO classifica "${cat}" como entrada, mas mpEhEntradaCaixa diz que sim — ` +
        'divergência entre o mapa e o código'
    );
  }
});

test('INV-05: aporte, transferência e poupança dirigida não contam como despesa de consumo', () => {
  const s = carregarApp();
  const v = MAPA.entidades.transacao.vocabularioCategorias;
  // `poupancaDirecionada` (sonho) entra nesta lista pelo mesmo motivo do aporte:
  // é dinheiro guardado, não consumido. Estava em despesaConsumo e inflava o
  // indicador de Despesa no mês em que a pessoa guardou mais.
  for (const cat of [].concat(
    v.aporte,
    v.transferenciaSaida,
    v.entradaCaixa,
    v.poupancaDirecionada
  )) {
    assert.equal(
      s.mpEhDespesaConsumo(cat),
      false,
      `"${cat}" não pode entrar no indicador de Despesa — inflaria o gasto do usuário ` +
        'com o próprio investimento'
    );
  }
  for (const cat of v.despesaConsumo) {
    assert.equal(s.mpEhDespesaConsumo(cat), true, `"${cat}" deveria contar como despesa`);
  }
});

test('INV-05: categoria inventada é acusada pelo validador', () => {
  const v = validarEstado(
    {
      contas: [],
      transacoes: [{ id: 'x', categoria: 'assinatura_streaming', valor: 30, mes: 0, ano: 2026 }],
    },
    { apenas: ['INV-05'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /não consta no vocabulário/);
});
