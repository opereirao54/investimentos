'use strict';

// Extrato e DRE — Controle financeiro.
//
// 1) O EXTRATO saía na ordem de cadastro, que não diz nada sobre o mês, e as
//    abas do topo só separavam por TIPO (entrada / saída / cartão / aporte).
//    Faltava a pergunta que quem abre o extrato realmente faz: "no quê eu
//    gastei?". Agora ordena por valor decrescente e tem chips por categoria,
//    também do maior total para o menor.
//
// 2) A DRE só mostrava FLUXO — o que entrou e saiu naquele mês. Faltava o
//    ESTOQUE: quanto de capital já foi aplicado. A armadilha do acumulado é a
//    borda esquerda: a tabela mostra uma janela de meses, e um acumulado que
//    começasse do zero ali esconderia todo o histórico anterior.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

const ROOT = path.resolve(__dirname, '..');
const CF = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba-controle-financeiro.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');

// ---------------------------------------------------------------------------
// Investimento acumulado
// ---------------------------------------------------------------------------

function comLancamentos(lista) {
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.transacoes.push(...lista);
  return s;
}

const lanc = (categoria, valor, mes, ano) => ({
  id: `${categoria}-${mes}-${ano}-${valor}`,
  categoria,
  valor,
  mes,
  ano,
  data: new Date(ano, mes, 10).toISOString(),
  pago: true,
});

test('acumulado: soma aportes de renda fixa e variável', () => {
  const s = comLancamentos([
    lanc('investimento_fixo', 1000, 0, 2025),
    lanc('investimento_variavel', 500, 0, 2025),
  ]);
  assert.equal(s.aporteLiquidoAcumuladoAte(1, 2025), 1500);
});

test('acumulado: resgate reduz o capital aplicado', () => {
  // Sem descontar o resgate a linha só subiria, mesmo para quem tirou tudo.
  const s = comLancamentos([
    lanc('investimento_fixo', 10000, 0, 2025),
    lanc('resgate_investimento', 4000, 1, 2025),
  ]);
  assert.equal(s.aporteLiquidoAcumuladoAte(2, 2025), 6000);
});

test('acumulado: é estritamente ANTERIOR ao mês pedido', () => {
  // O próprio mês entra pela soma da tabela; contá-lo aqui dobraria o valor.
  const s = comLancamentos([
    lanc('investimento_fixo', 700, 4, 2025),
    lanc('investimento_fixo', 300, 5, 2025),
  ]);
  assert.equal(s.aporteLiquidoAcumuladoAte(5, 2025), 700, 'maio conta, junho não');
  assert.equal(s.aporteLiquidoAcumuladoAte(6, 2025), 1000);
});

test('acumulado: a virada de ano é comparada como competência, não como número', () => {
  // `t.mes >= mesAlvo` sozinho jogaria dezembro/2024 para fora ao perguntar por
  // janeiro/2025 — dezembro é mês 11, janeiro é 0.
  const s = comLancamentos([
    lanc('investimento_fixo', 900, 11, 2024),
    lanc('investimento_fixo', 100, 0, 2025),
  ]);
  assert.equal(s.aporteLiquidoAcumuladoAte(0, 2025), 900, 'dez/24 conta para jan/25');
  assert.equal(s.aporteLiquidoAcumuladoAte(1, 2025), 1000);
});

test('acumulado: sonho e despesa não entram — não é dinheiro aplicado em ativo', () => {
  const s = comLancamentos([
    lanc('investimento_fixo', 100, 0, 2025),
    lanc('sonho', 5000, 0, 2025),
    lanc('despesa_fixa', 2000, 0, 2025),
    lanc('receita', 9000, 0, 2025),
  ]);
  assert.equal(s.aporteLiquidoAcumuladoAte(1, 2025), 100);
});

test('acumulado: sem lançamento nenhum é zero, não NaN', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  assert.equal(s.aporteLiquidoAcumuladoAte(0, 2025), 0);
});

test('a DRE parte do acumulado anterior à janela, não de zero', () => {
  assert.match(
    CF,
    /const aporteLiquidoAntesDaJanela = aporteLiquidoAcumuladoAte\(inicioMes, inicioAno\)/,
    'o ponto de partida tem de vir de antes do primeiro mês exibido'
  );
  assert.match(CF, /let acumInv = aporteLiquidoAntesDaJanela/);
});

test('a linha acumulada não é somável com as de fluxo — e o HTML diz isso', () => {
  // Estoque no meio de fluxo é convite para somar a coluna e errar. A linha
  // fica depois do resultado, com classe própria.
  assert.match(CF, /<tr class="linha-acumulada">/);
  const iResultado = CF.indexOf('<tr class="linha-liquida">');
  const iAcum = CF.indexOf('<tr class="linha-acumulada">');
  assert.ok(iResultado > -1 && iAcum > iResultado, 'a linha de estoque vem DEPOIS do resultado');
  assert.match(HTML, /\.linha-acumulada td \{/, 'a classe precisa de estilo próprio');
});

// ---------------------------------------------------------------------------
// Extrato: ordem e sub-filtro
// ---------------------------------------------------------------------------

test('o extrato é ordenado por valor decrescente', () => {
  // Tolerante à quebra de linha: o Prettier reflui a expressão conforme ela
  // cresce, e o que importa aqui é a regra, não onde cai o \n.
  assert.match(
    CF.replace(/\s+/g, ' '),
    /\.sort\( ?\(a, b\) => \(b\.valor \|\| 0\) - \(a\.valor \|\| 0\)/,
    'a lista tem de sair do maior para o menor'
  );
  assert.match(
    CF,
    /String\(a\.data\)\.localeCompare\(String\(b\.data\)\)/,
    'com desempate estável — senão a lista dança entre renders'
  );
});

test('cada item carrega a categoria que o sub-filtro usa', () => {
  assert.match(CF, /data-ext-cat="\$\{catFiltro/);
  assert.match(
    CF,
    /const catFiltro = t\.categoriaDespesa \|\| 'tipo:' \+ t\.categoria/,
    'sem categoria de gasto, o tipo do lançamento é a melhor etiqueta que existe'
  );
});

test('os chips saem do maior total para o menor', () => {
  assert.match(CF, /\.sort\(\(a, b\) => b\[1\]\.total - a\[1\]\.total\)/);
});

test('um chip só não vira filtro', () => {
  // Com uma categoria só, a linha seria um rótulo inútil ocupando espaço.
  assert.match(CF, /if \(cats\.length < 2\) \{/);
});

test('trocar de mês não deixa o extrato preso num filtro que não existe mais', () => {
  assert.match(
    CF,
    /if \(extratoCategoriaAtiva && !mapa\.has\(extratoCategoriaAtiva\)\) extratoCategoriaAtiva = ''/,
    'categoria ausente no mês novo tem de voltar para "Todas", não mostrar lista vazia'
  );
});

test('o filtro esconde itens em vez de redesenhar a lista', () => {
  // Redesenhar perderia os botões de pagar/editar já ligados e o scroll.
  assert.match(CF, /el\.style\.display = bate \? '' : 'none'/);
});

test('o extrato é UMA lista, não quatro caixas empilhadas', () => {
  // Com quatro caixas (entradas, saídas, cartão, aportes) a ordem visível era
  // "todas as entradas, depois todas as saídas…" — o maior gasto do mês podia
  // aparecer abaixo de uma receita de R$ 20, e o pedido era ordem decrescente.
  const APP = fs.readFileSync(path.join(ROOT, 'web/appliquei-app.js'), 'utf8');
  for (const id of [
    'extratoReceitas',
    'extratoDespesas',
    'extratoCartao',
    'extratoInvestimentos',
  ]) {
    assert.ok(!HTML.includes(`id="${id}"`), `${id} devia ter saído do HTML`);
    assert.ok(!CF.includes(id), `${id} devia ter saído do render`);
    assert.ok(!APP.includes(id), `${id} devia ter saído do filtro`);
  }
  assert.match(CF, /listaExtrato\.innerHTML = htmlExtrato/);
});

test('o filtro por tipo e o por categoria se somam', () => {
  assert.match(CF, /data-ext-tipo="\$\{tipoFiltro\}"/);
  assert.match(
    CF,
    /extratoTipoAtivo === 'todos' \|\|\s*el\.dataset\.extTipo === extratoTipoAtivo\) &&/s,
    'os dois filtros precisam valer ao mesmo tempo'
  );
});

test('lista vazia por filtro diz coisa diferente de mês sem lançamento', () => {
  // Na primeira, o caminho de volta é limpar o filtro — e a mensagem tem de
  // dizer isso, senão parece que o mês não tem nada.
  assert.match(CF, /Nenhum lançamento com este filtro/);
  assert.match(CF, /Nenhum lançamento neste mês/);
  assert.match(HTML, /id="extratoVazio"/);
});

test('o container dos chips existe no HTML', () => {
  assert.match(HTML, /id="extratoCategorias"/);
  assert.match(HTML, /\.ext-cat \{/, 'os chips precisam de estilo');
  assert.match(HTML, /\.ext-cat\.on \{/, 'e de estado ativo');
});
