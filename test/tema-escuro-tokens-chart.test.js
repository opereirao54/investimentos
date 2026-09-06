'use strict';

// getToken alimenta a cor de TODO gráfico do app: a grade, o texto dos eixos,
// o tooltip, a paleta das classes. Ele lia as custom properties do
// `document.documentElement`.
//
// O tema claro declara os tokens em `:root` (que é o <html>), mas o escuro os
// sobrescreve em `body.dark`. getComputedStyle no <html> nunca vê essa
// sobrescrita — então, com o app no escuro, getToken('--cor-borda') devolvia
// #dfe7e0 (a borda CLARA) e os gráficos desenhavam grade clara sobre fundo
// escuro. Silencioso: nada quebra, só fica feio, e em todas as abas de uma vez.
//
// Ler do body corrige porque custom property HERDA: onde o escuro não
// sobrescreve, o valor do :root chega ao body igual.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const CHARTS = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba1-charts.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');

function corpoDe(nome) {
  const ini = CHARTS.indexOf(`function ${nome}(`);
  assert.ok(ini > -1, `${nome} não encontrada`);
  // Até a próxima declaração de função no topo do arquivo.
  const prox = CHARTS.indexOf('\nfunction ', ini + 10);
  return CHARTS.slice(ini, prox > -1 ? prox : CHARTS.length);
}

test('getToken lê os tokens do body, onde o tema escuro os sobrescreve', () => {
  const corpo = corpoDe('getToken');
  assert.ok(
    /document\.body/.test(corpo),
    'getToken tem de ler do body — no <html> o tema escuro é invisível'
  );
  assert.ok(
    !/getComputedStyle\(document\.documentElement\)/.test(corpo),
    'voltou a ler do documentElement: no escuro os gráficos usariam a paleta clara'
  );
});

test('o tema escuro realmente mora no body — é o que torna a leitura do <html> errada', () => {
  // Se um dia os tokens escuros migrarem para :root[data-theme], o teste
  // acima deixa de ser necessário; este avisa que a premissa mudou.
  assert.ok(
    /body\.dark\s*\{/.test(HTML),
    'o seletor do tema escuro mudou — reveja de onde getToken deve ler'
  );
  const bloco = HTML.slice(HTML.indexOf('body.dark {'), HTML.indexOf('body.dark {') + 2600);
  assert.ok(
    bloco.includes('--cor-borda:'),
    'body.dark tem de redefinir --cor-borda; é um dos tokens que o gráfico lê'
  );
  assert.ok(
    bloco.includes('--cor-texto-secundario:'),
    'body.dark tem de redefinir --cor-texto-secundario; é a cor do texto dos eixos'
  );
});

test('o gráfico da projeção não deixa o rotulador global carimbar os pontos', () => {
  // ChartDataLabels é registrado GLOBALMENTE (Chart.register em app.js). Sem
  // desligá-lo por gráfico, ele imprime o valor bruto de cada ponto: com ~60
  // pontos × 4 séries, a curva desaparecia sob centenas de números.
  const proj = fs.readFileSync(path.join(ROOT, 'web/appliquei-projecao.js'), 'utf8');
  const ini = proj.indexOf('function projRenderGrafico');
  assert.ok(ini > -1, 'projRenderGrafico não encontrada');
  const corpo = proj.slice(ini, proj.indexOf('\nfunction ', ini + 10));
  assert.match(
    corpo,
    /datalabels:\s*\{\s*display:\s*false\s*\}/,
    'a projeção precisa desligar o datalabels — ele é global e carimba cada ponto'
  );
});
