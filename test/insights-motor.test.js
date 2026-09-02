'use strict';

// Motor de insights (Camada 1) — web/appliquei-insights.js.
//
// O que estes testes protegem, em ordem de importância:
//
// 1. O MOTOR NÃO ESCREVE. É o contrato que sustenta a decisão de produto
//    "sempre sugerir, nunca aplicar": se um detector puder alterar transação,
//    a promessa cai por terra em silêncio.
// 2. O motor CALA quando não sabe. Base curta, categoria pequena, série
//    instável — em todos, a resposta certa é não dizer nada. Alerta falso
//    treina o usuário a ignorar o painel e leva junto o alerta que importava.
// 3. Pico ≠ reajuste. Foi o primeiro defeito real encontrado: o mesmo Uber
//    saía como anomalia E como reajuste, o mesmo fato contado duas vezes.

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../web/appliquei-insights.js');

const REF = { ano: 2026, mes: 8 }; // setembro/2026

function lancamento(desc, valor, mes, extra) {
  return Object.assign(
    {
      id: desc + ':' + mes + ':' + Math.random().toString(36).slice(2, 7),
      descricao: desc,
      valor: valor,
      ano: 2026,
      mes: mes,
      categoria: 'despesa_variavel',
      categoriaDespesa: 'lazer',
    },
    extra || {}
  );
}

/** Base saudável: 6 meses (mar–ago) + setembro, valor estável. */
function baseEstavel(desc, valor, extra) {
  const out = [];
  for (let m = 2; m <= 8; m++) out.push(lancamento(desc, valor, m, extra));
  return out;
}

// ════════════════════════════════════════════════════════════
// Contrato: pureza
// ════════════════════════════════════════════════════════════

test('não modifica as transações recebidas', () => {
  const base = baseEstavel('Netflix', 39.9).concat([
    lancamento('Uber', 900, 8, { categoriaDespesa: 'transporte' }),
    lancamento('Uber', 180, 7, { categoriaDespesa: 'transporte' }),
    lancamento('Uber', 180, 6, { categoriaDespesa: 'transporte' }),
    lancamento('Uber', 180, 5, { categoriaDespesa: 'transporte' }),
  ]);
  const antes = JSON.parse(JSON.stringify(base));
  M.analisar(base, { ref: REF });
  assert.deepEqual(base, antes, 'o motor alterou o array de entrada');
});

test('tolera entrada malformada sem lançar', () => {
  for (const entrada of [null, undefined, [], [null], [{}], [{ valor: 'x' }]]) {
    assert.doesNotThrow(() => M.analisar(entrada, { ref: REF }));
  }
});

// ════════════════════════════════════════════════════════════
// Normalização
// ════════════════════════════════════════════════════════════

test('normaliza acento, caixa e sufixo de parcela para a mesma chave', () => {
  const alvo = M.normalizarDescricao('Academia');
  assert.equal(M.normalizarDescricao('ACADEMIA  '), alvo);
  assert.equal(
    M.normalizarDescricao('acadêmia'.normalize('NFC')),
    M.normalizarDescricao('acadêmia')
  );
  // O sufixo de parcela é o caso que mais importa: sem removê-lo, cada
  // parcela vira uma descrição diferente e nenhuma recorrência é detectada.
  assert.equal(M.normalizarDescricao('Academia (3/12)'), alvo);
  assert.equal(M.normalizarDescricao('Academia (11/12)'), alvo);
});

test('mediana ignora o extremo que a média absorveria', () => {
  assert.equal(M.mediana([100, 100, 100, 100, 5000]), 100);
});

// ════════════════════════════════════════════════════════════
// Categorização aprendida
// ════════════════════════════════════════════════════════════

test('sugere a classificação que o próprio usuário repetiu', () => {
  const s = M.sugerirCategoria('Netflix', baseEstavel('Netflix', 39.9));
  assert.equal(s.categoria, 'despesa_variavel');
  assert.equal(s.categoriaDespesa, 'lazer');
  assert.equal(s.via, 'exata');
});

test('casa por semelhança de tokens quando não há descrição idêntica', () => {
  const base = baseEstavel('Mercado Extra', 600, { categoriaDespesa: 'alimentacao' });
  const s = M.sugerirCategoria('mercado', base);
  assert.equal(s.categoriaDespesa, 'alimentacao');
  assert.equal(s.via, 'aproximada');
});

test('não sugere para descrição sem histórico', () => {
  assert.equal(M.sugerirCategoria('coisa que nunca lancei', baseEstavel('Netflix', 39.9)), null);
});

test('não sugere com uma única ocorrência — base curta demais', () => {
  assert.equal(M.sugerirCategoria('Netflix', [lancamento('Netflix', 39.9, 8)]), null);
});

test('não sugere quando o histórico está dividido entre categorias', () => {
  // 3 × lazer contra 3 × saúde: nenhuma domina, então o motor cala em vez de
  // desempatar por acaso.
  const base = [
    lancamento('Consulta', 200, 3),
    lancamento('Consulta', 200, 4),
    lancamento('Consulta', 200, 5),
    lancamento('Consulta', 200, 6, { categoriaDespesa: 'saude' }),
    lancamento('Consulta', 200, 7, { categoriaDespesa: 'saude' }),
    lancamento('Consulta', 200, 8, { categoriaDespesa: 'saude' }),
  ];
  const s = M.sugerirCategoria('Consulta', base);
  assert.equal(s && s.categoriaDespesa, null, 'desempatou uma divisão 50/50');
});

// ════════════════════════════════════════════════════════════
// Anomalia
// ════════════════════════════════════════════════════════════

function comAnomalia(valorSetembro) {
  const out = [];
  for (let m = 4; m <= 7; m++)
    out.push(lancamento('Uber', 180, m, { categoriaDespesa: 'transporte' }));
  out.push(lancamento('Uber', valorSetembro, 8, { categoriaDespesa: 'transporte' }));
  return out;
}

test('acusa categoria muito acima da própria mediana', () => {
  const a = M.anomalias(comAnomalia(900), REF);
  assert.equal(a.length, 1);
  assert.equal(a[0].categoriaDespesa, 'transporte');
  assert.equal(a[0].fator, 5);
});

test('não acusa variação dentro do normal', () => {
  assert.equal(M.anomalias(comAnomalia(220), REF).length, 0);
});

test('não acusa quando a diferença em reais é irrisória', () => {
  // 4× a mediana, mas a mediana é R$ 9 — o alerta seria verdadeiro e inútil.
  const out = [];
  for (let m = 4; m <= 7; m++)
    out.push(lancamento('Café', 9, m, { categoriaDespesa: 'alimentacao' }));
  out.push(lancamento('Café', 36, 8, { categoriaDespesa: 'alimentacao' }));
  assert.equal(M.anomalias(out, REF).length, 0);
});

test('não acusa sem meses anteriores suficientes', () => {
  const out = [
    lancamento('Uber', 180, 7, { categoriaDespesa: 'transporte' }),
    lancamento('Uber', 900, 8, { categoriaDespesa: 'transporte' }),
  ];
  assert.equal(M.anomalias(out, REF).length, 0);
});

// ════════════════════════════════════════════════════════════
// Recorrência oculta
// ════════════════════════════════════════════════════════════

test('aponta despesa que se repete e não está marcada como fixa', () => {
  const r = M.recorrentesOcultos(baseEstavel('Academia', 120), REF);
  assert.equal(r.length, 1);
  assert.equal(r[0].mesesSeguidos, 7);
  assert.equal(r[0].anualizado, 1440);
});

test('não aponta o que já está declarado fixo', () => {
  assert.equal(
    M.recorrentesOcultos(baseEstavel('Aluguel', 1800, { groupId: 'g1' }), REF).length,
    0
  );
  assert.equal(
    M.recorrentesOcultos(baseEstavel('Luz', 200, { categoria: 'despesa_fixa' }), REF).length,
    0
  );
});

test('não aponta série com meses salteados', () => {
  // mar, mai, set — mesmo valor, mas não é assinatura: é coincidência.
  const out = [
    lancamento('Oficina', 300, 2),
    lancamento('Oficina', 300, 4),
    lancamento('Oficina', 300, 8),
  ];
  assert.equal(M.recorrentesOcultos(out, REF).length, 0);
});

test('não aponta série de valor instável', () => {
  const out = [2, 3, 4, 5, 6, 7, 8].map((m, i) => lancamento('Feira', 100 + i * 90, m));
  assert.equal(M.recorrentesOcultos(out, REF).length, 0);
});

// ════════════════════════════════════════════════════════════
// Reajuste — e a fronteira com anomalia
// ════════════════════════════════════════════════════════════

test('acusa reajuste que se sustentou por dois meses', () => {
  const out = [];
  for (let m = 2; m <= 6; m++) out.push(lancamento('Netflix', 39.9, m));
  out.push(lancamento('Netflix', 59.9, 7));
  out.push(lancamento('Netflix', 59.9, 8));
  const r = M.reajustes(out, REF);
  assert.equal(r.length, 1);
  assert.equal(r[0].anterior, 39.9);
  assert.equal(r[0].valor, 59.9);
  assert.ok(r[0].pct > 50 && r[0].pct < 51);
});

test('pico de um mês só NÃO vira reajuste — é anomalia', () => {
  // A regressão que este teste tranca: sem a exigência de dois meses no valor
  // novo, o mesmo Uber saía como anomalia E como reajuste.
  const base = comAnomalia(900);
  assert.equal(M.reajustes(base, REF).length, 0, 'pico foi classificado como reajuste');
  assert.equal(M.anomalias(base, REF).length, 1, 'o pico deixou de ser anomalia');
});

test('queda de preço vira insight positivo', () => {
  const out = [];
  for (let m = 2; m <= 6; m++) out.push(lancamento('Plano', 200, m));
  out.push(lancamento('Plano', 150, 7));
  out.push(lancamento('Plano', 150, 8));
  const r = M.reajustes(out, REF);
  assert.equal(r[0].severidade, 'positivo');
  assert.ok(r[0].delta < 0);
});

test('cobrança duplicada não é lida como preço dobrado', () => {
  // O defeito real: o reajuste somava o mês inteiro, então duas cobranças de
  // R$ 59,90 viravam "subiu 200%". A régua tem de ser o valor unitário.
  const out = [];
  for (let m = 2; m <= 7; m++) out.push(lancamento('Netflix', 39.9, m));
  out.push(lancamento('Netflix', 39.9, 8));
  out.push(lancamento('Netflix', 39.9, 8));
  assert.equal(M.reajustes(out, REF).length, 0, 'a duplicata foi lida como reajuste');
});

// ════════════════════════════════════════════════════════════
// Duplicata
// ════════════════════════════════════════════════════════════

test('acusa a segunda cobrança do que sempre veio uma vez por mês', () => {
  const out = [];
  for (let m = 2; m <= 7; m++) out.push(lancamento('Netflix', 39.9, m));
  out.push(lancamento('Netflix', 39.9, 8));
  out.push(lancamento('Netflix', 39.9, 8));
  const d = M.duplicadas(out, REF);
  assert.equal(d.length, 1);
  assert.equal(d[0].ocorrencias, 2);
  assert.equal(d[0].valorUnitario, 39.9);
});

test('não acusa gasto que sempre se repetiu no mês', () => {
  // Uber várias vezes por mês é o comportamento normal dele. Sem esta trava,
  // o detector dispararia justamente onde repetir não significa nada.
  const out = [];
  for (let m = 2; m <= 8; m++) {
    out.push(lancamento('Uber', 30, m, { categoriaDespesa: 'transporte' }));
    out.push(lancamento('Uber', 30, m, { categoriaDespesa: 'transporte' }));
  }
  assert.equal(M.duplicadas(out, REF).length, 0);
});

test('não acusa parcelas do mesmo grupo', () => {
  const out = [];
  for (let m = 2; m <= 7; m++) out.push(lancamento('Sofá', 300, m));
  out.push(lancamento('Sofá', 300, 8, { groupId: 'p1' }));
  out.push(lancamento('Sofá', 300, 8, { groupId: 'p1' }));
  assert.equal(M.duplicadas(out, REF).length, 0);
});

// ════════════════════════════════════════════════════════════
// Aperto de caixa
// ════════════════════════════════════════════════════════════

const DIA = 86400000;

test('aponta o PRIMEIRO dia em que o caixa fura', () => {
  const agora = Date.UTC(2026, 8, 2, 12);
  const r = M.aperto({ agora, saldoEm: (ms) => 1000 - Math.floor((ms - agora) / DIA) * 100 });
  assert.equal(r.emDias, 11, 'não é o primeiro furo');
  // Sem volta ao azul dentro da janela: aí sim é crítico.
  assert.equal(r.severidade, 'critico');
  assert.equal(r.recuperaMs, null);
});

test('descompasso de datas que se resolve sozinho não é crítico', () => {
  // O caso real: contas vencem antes de a receita cair, e o mês fecha bem.
  // Tratar isto com a mesma gravidade de um rombo é o que gera alarme falso —
  // e foi o que fez o primeiro utilizador desconfiar do painel inteiro.
  const agora = Date.UTC(2026, 8, 2, 12);
  const r = M.aperto({
    agora,
    saldoEm: (ms) => {
      const d = Math.floor((ms - agora) / DIA);
      return d < 1 ? 500 : d < 8 ? -3627 : 4373;
    },
  });
  assert.equal(r.severidade, 'atencao', 'aperto passageiro tratado como rombo');
  assert.equal(r.emDias, 1);
  assert.equal(r.recuperaEmDias, 8);
  assert.equal(r.diasNoVermelho, 7);
  assert.equal(r.valor, -3627, 'devolve o pior dia, não o primeiro');
});

test('o valor devolvido é o PIOR dia do período, não o primeiro', () => {
  const agora = Date.UTC(2026, 8, 2, 12);
  const r = M.aperto({
    agora,
    saldoEm: (ms) => {
      const d = Math.floor((ms - agora) / DIA);
      return d === 1 ? -100 : d === 2 ? -900 : d === 3 ? -400 : 1000;
    },
  });
  assert.equal(r.emDias, 1);
  assert.equal(r.valor, -900);
});

test('cala quando o caixa não fura na janela', () => {
  const agora = Date.UTC(2026, 8, 2, 12);
  assert.equal(M.aperto({ agora, saldoEm: () => 5000 }), null);
});

test('cala quando não recebe a fonte de saldo — não inventa projeção', () => {
  assert.equal(M.aperto({ agora: Date.now() }), null);
});

// ════════════════════════════════════════════════════════════
// Orquestração
// ════════════════════════════════════════════════════════════

test('ordena por severidade: crítico antes de informativo', () => {
  const base = comAnomalia(900).concat(baseEstavel('Academia', 120));
  const r = M.analisar(base, { ref: REF });
  const pos = r.insights.map((i) => i.severidade);
  assert.equal(pos[0], 'critico');
  assert.ok(pos.indexOf('informativo') > 0);
});

test('dispensa esconde o insight e é contada na meta', () => {
  const base = comAnomalia(900);
  const antes = M.analisar(base, { ref: REF });
  const id = antes.insights[0].id;
  const depois = M.analisar(base, { ref: REF, dispensados: { [id]: Date.now() } });
  assert.equal(depois.insights.length, antes.insights.length - 1);
  assert.equal(depois.meta.dispensados, 1);
});

test('o id do insight carrega a competência — dispensar em setembro não cala outubro', () => {
  // Sem isto, "já vi isto" viraria "nunca mais me fale disto", e o detector
  // ficaria mudo para sempre depois de um clique.
  const base = comAnomalia(900);
  const idSet = M.analisar(base, { ref: REF }).insights[0].id;
  assert.ok(idSet.endsWith(':2026-09'), 'id sem competência: ' + idSet);
});

test('base curta não gera análise e a meta diz o que falta', () => {
  const r = M.analisar([lancamento('Netflix', 39.9, 8)], { ref: REF });
  assert.equal(r.insights.length, 0);
  assert.equal(r.meta.mesesDisponiveis, 1);
  assert.equal(r.meta.minMesesHistorico, 3);
});
