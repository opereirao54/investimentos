'use strict';

// Painel de insights — camada de tela (web/appliquei-insights-ui.js).
//
// O teste mais importante deste arquivo é o primeiro, e ele é estrutural: a
// decisão de produto foi "SEMPRE SUGERIR, NUNCA APLICAR", e uma decisão dessas
// não sobrevive a revisão nenhuma se só existir em comentário. Aqui ela vira
// falha de CI: se alguém, com a melhor das intenções, fizer o card gravar
// direto ("é só um clique a menos"), o build para.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const ARQUIVOS = ['web/appliquei-insights.js', 'web/appliquei-insights-ui.js'];

/**
 * Lê o arquivo SEM comentários.
 *
 * O guarda tem de olhar para o código, não para a prosa: os dois arquivos
 * explicam em comentário justamente por que NÃO chamam salvarTransacoes() nem
 * tocam em localStorage, e uma busca crua acusaria a explicação da regra como
 * se fosse a violação dela.
 */
function codigoDe(rel) {
  return fs
    .readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ════════════════════════════════════════════════════════════
// O contrato "sugere, nunca aplica"
// ════════════════════════════════════════════════════════════

test('os arquivos de insight nunca gravam transação', () => {
  // Toda escrita de transação passa por salvarTransacoes() (ver o mapa de
  // integrações, entidade `transacao`, topologia escrita-central). Nenhum
  // caminho de insight pode chamá-la, nem mexer na chave direto.
  const proibidos = [
    /\bsalvarTransacoes\b/,
    /futurorico_transacoes/,
    /\btransacoes\s*\.\s*(push|splice|pop|shift|unshift|sort|reverse)\b/,
    // Atribuição, não comparação: `transacoes ===` é leitura e é permitida.
    /\btransacoes\s*=(?!=)/,
  ];
  for (const rel of ARQUIVOS) {
    const src = codigoDe(rel);
    for (const re of proibidos) {
      assert.ok(
        !re.test(src),
        `${rel} casa com ${re}. O painel de insights SUGERE — quem aplica é o ` +
          `usuário, pelo formulário. Gravar daqui passa por fora de salvarTransacoes() ` +
          `e dos contratos de integração.`
      );
    }
  }
});

test('a única chave que o painel escreve é a de dispensados', () => {
  const src = codigoDe('web/appliquei-insights-ui.js');
  const escritas = src.match(/localStorage\.(setItem|removeItem)\(([^,)]+)/g) || [];
  for (const e of escritas) {
    assert.ok(
      e.includes('INSIGHTS_LS_DISPENSADOS'),
      'escrita em localStorage fora da chave de dispensados: ' + e
    );
  }
});

test('o motor não toca em DOM, rede nem Firebase', () => {
  const src = codigoDe('web/appliquei-insights.js');
  for (const termo of ['document.', 'fetch(', 'firebase', 'localStorage']) {
    assert.ok(!src.includes(termo), `motor deixou de ser puro: encontrou "${termo}"`);
  }
});

// ════════════════════════════════════════════════════════════
// Carga da camada de tela
// ════════════════════════════════════════════════════════════

function carregarUI() {
  const janela = { matchMedia: () => ({ matches: false }) };
  global.window = janela;
  global.document = { getElementById: () => null };
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  global.formatarMoeda = (v) => 'R$ ' + Number(v || 0).toFixed(2);
  global.transacoes = [];
  const motor = require('../web/appliquei-insights.js');
  janela.AppliqueiInsights = motor;
  delete require.cache[require.resolve('../web/appliquei-insights-ui.js')];
  require('../web/appliquei-insights-ui.js');
  return { UI: janela.AppliqueiInsightsUI, motor };
}

test('a camada de tela carrega e expõe a API que o HTML chama', () => {
  const { UI } = carregarUI();
  for (const m of ['renderizar', 'dispensar', 'card', 'sparkline', 'apresentar']) {
    assert.equal(typeof UI[m], 'function', 'faltou ' + m);
  }
});

// ════════════════════════════════════════════════════════════
// Sparkline — a escala não pode mentir
// ════════════════════════════════════════════════════════════

/** Amplitude vertical desenhada, em px, a partir do path do SVG. */
function amplitude(svg) {
  const d = /d="([^"]+)"/.exec(svg);
  if (!d) return 0;
  const ys = d[1]
    .split(/[ML]\s*/)
    .filter(Boolean)
    .map((p) => Number(p.trim().split(/\s+/)[1]))
    .filter((n) => isFinite(n));
  return Math.max(...ys) - Math.min(...ys);
}

test('variação pequena é desenhada pequena', () => {
  // A regressão que este teste tranca: o eixo se ajustava sempre ao min/max,
  // então 5% de variação virava uma rampa íngreme — no card que afirma, em
  // texto, que o valor é ESTÁVEL. O desenho contradizia a frase ao lado.
  const { UI } = carregarUI();
  const svg = UI.sparkline([610, 620, 615, 630, 625, 640]);
  assert.ok(
    amplitude(svg) < 6,
    'variação de 5% desenhada com amplitude ' + amplitude(svg).toFixed(1) + 'px'
  );
});

test('pico de verdade continua parecendo pico', () => {
  const { UI } = carregarUI();
  const svg = UI.sparkline([180, 180, 180, 180, 180, 900]);
  assert.ok(amplitude(svg) > 15, 'o pico foi achatado: ' + amplitude(svg).toFixed(1) + 'px');
});

test('série curta demais não vira gráfico', () => {
  const { UI } = carregarUI();
  assert.equal(UI.sparkline([100]), '');
  assert.equal(UI.sparkline([]), '');
});

test('o sparkline tem rótulo acessível', () => {
  const { UI } = carregarUI();
  const svg = UI.sparkline([1, 2, 3], { rotuloAcessivel: 'Gastos de Transporte' });
  assert.ok(svg.includes('role="img"'));
  assert.ok(svg.includes('aria-label="Gastos de Transporte"'));
});

// ════════════════════════════════════════════════════════════
// Apresentação
// ════════════════════════════════════════════════════════════

test('todo tipo de insight tem apresentação — nenhum cai no vazio', () => {
  const { UI } = carregarUI();
  const amostras = [
    {
      tipo: 'anomalia',
      categoriaDespesa: 'transporte',
      valor: 900,
      referencia: 180,
      fator: 5,
      delta: 720,
      mesesBase: 4,
    },
    {
      tipo: 'recorrente_oculto',
      rotulo: 'Academia',
      valor: 120,
      mesesSeguidos: 5,
      anualizado: 1440,
    },
    {
      tipo: 'reajuste',
      rotulo: 'Netflix',
      valor: 59.9,
      anterior: 39.9,
      delta: 20,
      pct: 50.1,
      impactoAnual: 240,
    },
    { tipo: 'duplicada', rotulo: 'Netflix', ocorrencias: 2, valor: 79.8, valorUnitario: 39.9 },
    { tipo: 'aperto', valor: -100, emDias: 11, quandoMs: Date.UTC(2026, 8, 13) },
  ];
  for (const a of amostras) {
    const ap = UI.apresentar(a);
    assert.ok(ap, 'sem apresentação para ' + a.tipo);
    for (const campo of ['icone', 'titulo', 'valor', 'frase', 'prova', 'acao']) {
      assert.ok(ap[campo], `${a.tipo}: faltou ${campo}`);
    }
    assert.ok(ap.prova.length >= 2, a.tipo + ': prova rasa demais');
  }
});

test('o card escapa HTML vindo da descrição do usuário', () => {
  const { UI } = carregarUI();
  const html = UI.card(
    {
      id: 'x',
      tipo: 'recorrente_oculto',
      severidade: 'informativo',
      rotulo: '<img src=x onerror=alert(1)>',
      valor: 10,
      mesesSeguidos: 3,
      anualizado: 120,
    },
    null
  );
  assert.ok(!html.includes('<img src=x'), 'descrição do usuário entrou crua no HTML');
  assert.ok(html.includes('&lt;img'), 'o escape não aconteceu');
});
