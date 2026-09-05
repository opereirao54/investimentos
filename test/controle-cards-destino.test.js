'use strict';

// Os cards do Controle deixaram de ser sete números soltos: cada um ganhou a
// fatia da receita, a variação contra o mês anterior e a linha dos 6 meses, e
// o card de saldo livre ganhou a barra de "para onde foi o dinheiro".
//
// Tudo isso é a MESMA informação apresentada de novas maneiras, e é aí que
// mora o risco: uma segunda soma em qualquer um desses lugares faz a barra, o
// card e a linha contarem histórias diferentes sobre o mesmo mês, sem que nada
// quebre. O que este arquivo tranca:
//
//   1. As cinco parcelas saem de um agrupamento só (totaisDoResumo), que é
//      também o que calcularResultadoMes usa — a linha de 6 meses termina
//      exatamente no número impresso acima dela.
//   2. As fatias da barra esgotam a entrada do mês, saldo carregado incluído.
//   3. Gastar mais do que entrou não estoura a barra nem inventa fatia
//      negativa; vira excedente.
//   4. Variação sem base de comparação é `null`, não +∞%.
//   5. O painel de vencimentos nasce recolhido — MENOS quando há conta
//      vencida ou vencendo hoje, que é quando esconder custa juros.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

const ROOT = path.resolve(__dirname, '..');
const CF = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba-controle-financeiro.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');

/** Lança um mês inteiro de uma vez. */
function lancarMes(s, contaId, d, v) {
  const base = {
    contaId,
    data: d.toISOString(),
    dataVencimento: d.toISOString().slice(0, 10),
    mes: d.getMonth(),
    ano: d.getFullYear(),
    pago: true,
  };
  const suf = d.getMonth() + '' + d.getFullYear();
  const põe = (id, categoria, valor) => {
    if (valor) s.transacoes.push({ id: id + suf, categoria, valor, ...base });
  };
  põe('r', 'receita', v.receita);
  põe('f', 'despesa_fixa', v.fixa);
  põe('v', 'despesa_variavel', v.varia);
  põe('c', 'cartao_credito', v.cartao);
  põe('i', 'investimento_fixo', v.aporte);
  põe('s', 'sonho', v.sonho);
}

test('as cinco parcelas saem de um agrupamento só', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const t = s.totaisDoResumo({
    receita: 9000,
    resgate: 500,
    despFixa: 2600,
    despVar: 1740,
    cartao: 1180,
    invFixo: 1500,
    invVar: 500,
    invExterno: 3000,
    sonho: 600,
  });
  assert.equal(t.receita, 9500, 'resgate entra na receita — é dinheiro que voltou ao caixa');
  assert.equal(t.despesas, 4340, 'fixa + variável, sem o cartão, que tem card próprio');
  assert.equal(t.cartao, 1180);
  assert.equal(
    t.investimentos,
    2000,
    'invExterno fica de fora: nunca passou pelo caixa, não desconta do mês'
  );
  assert.equal(t.sonhos, 600, 'sonho não se esconde dentro de despesa');
});

test('o resultado do mês usa o mesmo agrupamento dos cards', () => {
  // Trava estrutural: é o que garante que a mini-linha de 6 meses termine no
  // número impresso logo acima dela. Duas somas = dois números, e a diferença
  // não aparece em nenhuma tela.
  const ini = CF.indexOf('function calcularResultadoMes');
  const corpo = CF.slice(ini, CF.indexOf('\n// ===', ini));
  assert.ok(
    corpo.includes('totaisDoResumo'),
    'calcularResultadoMes voltou a agrupar as parcelas por conta própria'
  );

  const s = carregarApp({}, ORDEM_CONTROLE);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 0 });
  const hoje = new Date();
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), 5);
  lancarMes(s, conta.id, d, {
    receita: 9000,
    fixa: 2600,
    varia: 1740,
    cartao: 1180,
    aporte: 2000,
    sonho: 600,
  });
  const t = s.totaisDoResumo(s.calcularResumoMes(d.getMonth(), d.getFullYear()));
  assert.equal(
    s.calcularResultadoMes(d.getMonth(), d.getFullYear()),
    t.receita - t.despesas - t.cartao - t.investimentos - t.sonhos
  );
});

test('as fatias esgotam tudo o que entrou — saldo carregado incluído', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const d = s.calcularDestinoDoMes({
    receita: 9000,
    carregado: 7660,
    despesas: 6469,
    cartao: 1180,
    investimentos: 2000,
    sonhos: 600,
  });
  assert.equal(d.base, 16660, 'o que sobrou do mês passado é dinheiro disponível neste');
  assert.equal(d.livre, 6411, 'e o resto bate com o número do card');
  assert.equal(d.estourou, false);

  const soma = d.fatias.reduce((a, f) => a + f.pct, 0);
  assert.ok(Math.abs(soma - 100) < 1e-9, 'as fatias têm de somar exatamente a barra inteira');
  // join em vez de deepEqual: o array nasce dentro da sandbox `vm` e o
  // deepStrictEqual compara protótipos, que são de realms diferentes.
  assert.equal(
    d.fatias.map((f) => f.chave).join(','),
    'despesas,cartao,investimentos,sonhos,livre',
    'a ordem da barra é a ordem dos cards abaixo, que servem de legenda'
  );
  assert.equal(
    d.fatias.reduce((a, f) => a + f.valor, 0),
    d.base,
    'nenhum real entra ou some entre a entrada e as fatias'
  );
});

test('gastar mais do que entrou vira excedente, não fatia negativa', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const d = s.calcularDestinoDoMes({
    receita: 4000,
    despesas: 3800,
    cartao: 1500,
    investimentos: 300,
    sonhos: 0,
  });
  assert.equal(d.estourou, true);
  assert.equal(d.excedente, 1600, '5.600 saíram de 4.000 que entraram');
  assert.ok(
    !d.fatias.some((f) => f.chave === 'livre'),
    'não existe "livre" num mês que estourou — inventar um mentiria'
  );
  assert.ok(
    d.fatias.every((f) => f.pct >= 0),
    'nenhuma fatia negativa: uma barra que anda para trás não se lê'
  );
  const soma = d.fatias.reduce((a, f) => a + f.pct, 0);
  assert.ok(Math.abs(soma - 100) < 1e-9, 'a régua vira o próprio gasto, e as fatias cabem nela');
});

test('parcela negativa não vira fatia reversa', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  // Estorno maior que o lançamento deixa a parcela negativa.
  const d = s.calcularDestinoDoMes({ receita: 5000, despesas: -200, cartao: 1000 });
  const desp = d.fatias.filter((f) => f.chave === 'despesas')[0];
  assert.equal(desp.valor, 0);
  assert.equal(desp.pct, 0);
});

test('mês sem entrada e sem saída não desenha barra nenhuma', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const d = s.calcularDestinoDoMes({});
  assert.equal(d.temDados, false, 'uma barra zerada se lê como defeito, não como mês vazio');
  assert.ok(
    d.fatias.every((f) => Number.isFinite(f.pct)),
    'e nada de NaN por divisão por zero'
  );
});

test('variação sem base de comparação é null, não +∞%', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  assert.equal(s.variacaoMensal(500, 0), null, 'o primeiro mês não subiu infinito por cento');
  assert.equal(s.variacaoMensal(0, 0), null);
  assert.equal(s.variacaoMensal(1100, 1000), 10);
  assert.equal(s.variacaoMensal(900, 1000), -10);
  // Base negativa (mês fechado no vermelho) compara em módulo, senão o sinal
  // da variação inverte e "melhorou" aparece como queda.
  assert.equal(s.variacaoMensal(-500, -1000), 50);
});

test('a série de 6 meses termina no mês em exibição', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 0 });
  const hoje = new Date();
  const esteMes = new Date(hoje.getFullYear(), hoje.getMonth(), 5);
  const mesPassado = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 5);
  lancarMes(s, conta.id, esteMes, { receita: 9000, fixa: 2000 });
  lancarMes(s, conta.id, mesPassado, { receita: 7000, fixa: 3000 });

  const serie = s.serieTotaisMeses(hoje.getMonth(), hoje.getFullYear(), 6);
  assert.equal(serie.length, 6);
  assert.equal(serie[5].receita, 9000, 'o último ponto é o mês na tela');
  assert.equal(serie[4].receita, 7000, 'o penúltimo é o mês anterior');
  assert.equal(serie[0].receita, 0, 'meses sem lançamento entram como zero, não somem');
});

test('o painel de vencimentos nasce recolhido, mas nunca esconde o que está vencido', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  assert.equal(s.vencDeveAbrir({}), false, 'recolhido por padrão — é o motivo de existir');
  assert.equal(s.vencDeveAbrir({ salvo: '1' }), true, 'a escolha de quem abriu fica valendo');
  assert.equal(s.vencDeveAbrir({ salvo: '0' }), false);
  // Estes dois ganham da preferência: é o único caso em que recolher custa
  // dinheiro (juros, multa).
  assert.equal(s.vencDeveAbrir({ salvo: '0', temAtraso: true }), true);
  assert.equal(s.vencDeveAbrir({ salvo: '0', temHoje: true }), true);
});

test('quem manda olhar os vencimentos abre o painel antes de rolar até ele', () => {
  // O insight de aperto de caixa diz "confira os vencimentos" e rola até o
  // painel. Recolhido, a pessoa chegaria num cabeçalho fechado.
  const ui = fs.readFileSync(path.join(ROOT, 'web/appliquei-insights-ui.js'), 'utf8');
  // A partir de insightsUiAgir: 'aperto' também aparece no render do card, e
  // ancorar na primeira ocorrência mediria a função errada.
  const agir = ui.indexOf('function insightsUiAgir');
  assert.ok(agir > -1, 'insightsUiAgir não encontrada');
  const ini = ui.indexOf("if (ins.tipo === 'aperto')", agir);
  assert.ok(ini > -1, 'o ramo do insight de aperto sumiu');
  const bloco = ui.slice(ini, ini + 400);
  assert.ok(bloco.includes('abrirPainelVencimentos'), 'falta abrir o painel');
  assert.ok(
    bloco.indexOf('abrirPainelVencimentos') < bloco.indexOf('insightsUiIrPara'),
    'abrir antes de rolar — abrir depois faz a página pular'
  );
});

test('os cinco cards existem, na ordem da barra, com os ganchos que o JS preenche', () => {
  const secao = HTML.slice(
    HTML.indexOf('<div class="kpis-controle-grid">'),
    HTML.indexOf('<div id="alertaContaVencida"')
  );
  const ordem = Array.from(secao.matchAll(/data-tipo="([a-z]+)"/g)).map((m) => m[1]);
  assert.deepEqual(
    ordem,
    ['receita', 'despesas', 'cartao', 'investimentos', 'sonhos'],
    'a ordem dos cards é a das fatias da barra — eles são a legenda dela'
  );
  for (const t of ordem) {
    assert.match(
      HTML,
      new RegExp('\\.kpi-mini\\[data-tipo="' + t + '"\\]'),
      `o card "${t}" ficaria sem cor`
    );
  }
  // Um card sem os três slots fica mudo: sem fatia, sem linha e sem variação.
  assert.equal((secao.match(/kpi-mini-fatia/g) || []).length, 5);
  assert.equal((secao.match(/kpi-mini-linha/g) || []).length, 5);
  assert.equal((secao.match(/kpi-mini-delta/g) || []).length, 5);
});

test('a barra de destino e o cabeçalho dos vencimentos estão no HTML', () => {
  assert.ok(HTML.includes('id="destinoMes"'), 'falta o container da barra de destino');
  assert.ok(
    HTML.includes('onclick="alternarPainelVencimentos()"'),
    'o painel de vencimentos precisa do botão de exibe/esconde'
  );
  assert.ok(HTML.includes('id="vencResumo"'), 'falta o resumo do cabeçalho recolhido');
  assert.match(
    HTML,
    /\.venc-painel\[data-aberto="0"\] \.vencimentos-grid \{ display: none; \}/,
    'sem esta regra o painel não esconde nada'
  );
  // As cinco fatias precisam de cor; uma sem regra some da barra.
  for (const c of ['despesas', 'cartao', 'investimentos', 'sonhos', 'livre']) {
    assert.ok(
      HTML.includes('.kpi-destino-seg[data-destino="' + c + '"]'),
      `a fatia "${c}" ficaria invisível`
    );
  }
});
