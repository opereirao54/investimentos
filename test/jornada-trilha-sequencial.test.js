'use strict';

// Trilha sequencial da Jornada Financeira.
//
// Os oito módulos são ordenados de propósito: o 5 fala de indexador de renda
// fixa supondo que a reserva do 3 já existe, e o 8 calcula o patrimônio-alvo em
// cima do aporte que o 2 dimensionou. Com tudo aberto, o caminho natural era
// pular para o assunto que soa mais interessante e ler fora de ordem o material
// que foi escrito em ordem.
//
// A regra tem três braços, e o terceiro é o que evita estrago: quem já concluiu
// um módulo nunca perde o acesso a ele. A trilha era livre até agora, então
// existe gente com o módulo 5 concluído e o 4 não — re-trancar seria apagar
// progresso que a pessoa já fez.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'web/appliquei-jornada.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');

/**
 * Carrega só as funções de trilha, com um localStorage de mentira.
 * Elas não tocam DOM — dá para exercitar a REGRA sem simular a tela.
 */
function carregarTrilha(progresso) {
  const guardado = JSON.stringify(progresso || {});
  const inicio = SRC.indexOf('var JORNADA_MODULOS');
  const fim = SRC.indexOf('var jornadaModuloAberto');
  assert.ok(inicio > -1 && fim > inicio, 'as funções de trilha precisam estar no arquivo');
  const fn = new Function(
    'localStorage',
    SRC.slice(inicio, fim) +
      '\nreturn { JORNADA_MODULOS, jornadaModuloLiberado, jornadaProximoModulo, ' +
      'jornadaConcluido, jornadaIndiceModulo };'
  );
  return fn({ getItem: () => guardado, setItem() {} });
}

const feito = (...ids) => {
  const p = {};
  for (const id of ids) p[id] = { concluidoEm: new Date().toISOString() };
  return p;
};

// ---------------------------------------------------------------------------
// A regra
// ---------------------------------------------------------------------------

test('o primeiro módulo está sempre liberado', () => {
  const t = carregarTrilha({});
  assert.equal(t.jornadaModuloLiberado('m1'), true);
});

test('nada concluído: só o primeiro abre', () => {
  const t = carregarTrilha({});
  const abertos = t.JORNADA_MODULOS.filter((m) => t.jornadaModuloLiberado(m.id)).map((m) => m.id);
  assert.deepEqual(abertos, ['m1']);
});

test('concluir um módulo abre o seguinte — e só ele', () => {
  const t = carregarTrilha(feito('m1'));
  const abertos = t.JORNADA_MODULOS.filter((m) => t.jornadaModuloLiberado(m.id)).map((m) => m.id);
  assert.deepEqual(abertos, ['m1', 'm2'], 'o m3 não pode abrir junto');
});

test('a trilha avança um por vez até o fim', () => {
  let prog = {};
  for (const m of carregarTrilha({}).JORNADA_MODULOS) {
    const t = carregarTrilha(prog);
    assert.equal(t.jornadaModuloLiberado(m.id), true, `${m.id} devia estar aberto agora`);
    prog = Object.assign({}, prog, feito(m.id));
  }
  const fim = carregarTrilha(prog);
  assert.equal(fim.jornadaProximoModulo(), null, 'sem próximo quando tudo está concluído');
});

test('módulo já concluído nunca volta a trancar', () => {
  // O caso real: a trilha era livre, então existe gente com o 5 concluído e o
  // 4 não. Trancar o 5 apagaria progresso que a pessoa fez.
  const t = carregarTrilha(feito('m5'));
  assert.equal(t.jornadaModuloLiberado('m5'), true, 'o concluído tem de continuar acessível');
  assert.equal(t.jornadaModuloLiberado('m4'), false, 'mas o 4 continua fechado');
  assert.equal(t.jornadaModuloLiberado('m6'), true, 'e o 6 abre, porque o 5 está feito');
});

test('"seu próximo passo" é o primeiro NÃO concluído, não o último liberado', () => {
  // Quem pulou pode ter dois módulos abertos. A trilha aponta um alvo só.
  const t = carregarTrilha(feito('m5'));
  assert.equal(t.jornadaProximoModulo().id, 'm1');
  const t2 = carregarTrilha(feito('m1', 'm2', 'm3'));
  assert.equal(t2.jornadaProximoModulo().id, 'm4');
});

test('id desconhecido não trava nem explode', () => {
  const t = carregarTrilha({});
  assert.equal(t.jornadaIndiceModulo('nao-existe'), -1);
  assert.equal(t.jornadaModuloLiberado('nao-existe'), true, 'índice -1 cai no ramo do primeiro');
});

// ---------------------------------------------------------------------------
// A trava vale também fora do card
// ---------------------------------------------------------------------------

test('abrirModalJornada recusa módulo trancado', () => {
  // O cadeado no card é a sinalização; esta checagem é a regra. Sem ela,
  // qualquer outro caminho até a função (um link, o console, um atalho futuro)
  // abriria o material fora de ordem.
  const ini = SRC.indexOf('function abrirModalJornada');
  const corpo = SRC.slice(ini, SRC.indexOf('function fecharModalJornada'));
  assert.match(corpo, /if \(!jornadaModuloLiberado\(id\)\) \{/);
  assert.match(corpo, /return;/, 'e sai sem abrir');
  assert.match(corpo, /mostrarToast\(/, 'dizendo por quê');
});

// ---------------------------------------------------------------------------
// A tela
// ---------------------------------------------------------------------------

test('o card trancado não é clicável', () => {
  // Sem onclick no cartão: cursor de mão e hover num alvo que não responde é
  // pior do que não parecer clicável.
  assert.match(
    SRC,
    /const acaoCard = liberado \? ' onclick="abrirModalJornada\(/,
    'o onclick do cartão tem de ser condicional'
  );
  assert.match(HTML, /\.jor-card\.trancado \{[^}]*cursor: default/s);
  assert.match(HTML, /\.jor-card\.trancado:hover \{ transform: none; box-shadow: none; \}/);
});

test('os três estados do cartão têm desenho próprio', () => {
  for (const c of ['.jor-card.feito', '.jor-card.agora', '.jor-card.trancado']) {
    assert.match(HTML, new RegExp(c.replace(/\./g, '\\.') + '[ ,{:]'), `${c} sem estilo`);
  }
  for (const c of ['.jor-selo.ok', '.jor-selo.agora', '.jor-selo.trancado', '.jor-selo.livre']) {
    assert.match(HTML, new RegExp(c.replace(/\./g, '\\.') + '[ ,{:]'), `${c} sem estilo`);
  }
});

test('o cartão trancado diz o que falta para abrir', () => {
  // "Bloqueado" sozinho não é instrução. O nome do módulo que destrava é.
  assert.match(SRC, /Abre ao concluir <strong>' \+ anterior\.titulo/);
  assert.match(SRC, /Conclua o anterior/);
});

test('a mensagem do topo aponta o próximo módulo pelo nome', () => {
  const ini = SRC.indexOf('const msg = document.getElementById');
  const corpo = SRC.slice(ini, ini + 1400);
  assert.match(corpo, /proximo \? proximo\.titulo/);
  assert.match(corpo, /abrem um por vez, na ordem/, 'e explica a regra na primeira visita');
});

test('o selo do concluído continua legível no tema escuro', () => {
  // Fundo verde-menta com texto branco dá 1,9:1 no escuro — a mesma armadilha
  // já corrigida nos outros selos do app.
  assert.match(HTML, /body\.dark \.jor-selo\.ok \{ color: #052e1a; \}/);
});
