'use strict';

// O termômetro financeiro passou a aparecer também no cabeçalho do Controle,
// em versão de chip. São DUAS telas mostrando o MESMO diagnóstico, e é essa a
// parte frágil: no dia em que alguém recalcular o score aqui dentro em vez de
// perguntar ao Relatório mensal, o chip vai dizer "Saudável" na tela onde a
// pessoa lança e "Atenção" na tela onde ela confere — sem nada quebrar.
//
// O que este arquivo tranca:
//
//   1. O score do chip é IDÊNTICO ao do Relatório mensal, porque sai das
//      mesmas funções (buildMonthlyReport + rmCalcularTermometro).
//   2. A agulha e o arco traduzem o score certo — inclusive nos extremos.
//   3. Mês sem lançamento nenhum não recebe diagnóstico. Sem essa guarda o
//      chip abre em "Atenção" para quem acabou de instalar o app: quatro dos
//      cinco critérios são neutros e a média já cai na faixa do meio.
//   4. O chip acompanha o mês EM EXIBIÇÃO, não o mês corrente.
//   5. As três faixas de RM_FAIXAS_SCORE têm cor no CSS — uma faixa sem regra
//      deixaria o chip transparente justamente no estado que ele existe para
//      denunciar.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

const ROOT = path.resolve(__dirname, '..');
const CF = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba-controle-financeiro.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');

// O chip vive no Controle mas consome o Relatório mensal, que por sua vez
// depende de bens e da jornada. Esta é a pilha mínima para o score existir.
const ORDEM_TERMOMETRO = ORDEM_CONTROLE.concat([
  'web/appliquei-bens.js',
  'web/appliquei-jornada-conteudo.js',
  'web/appliquei-jornada.js',
  'web/appliquei-relatorio-mensal.js',
]);

/** Um mês com receita, despesa e aporte — o suficiente para haver diagnóstico. */
function lancarMes(s, contaId, dataRef, { receita, despesa, aporte }) {
  const base = {
    contaId,
    data: dataRef.toISOString(),
    dataVencimento: dataRef.toISOString().slice(0, 10),
    mes: dataRef.getMonth(),
    ano: dataRef.getFullYear(),
    pago: true,
  };
  const sufixo = dataRef.getMonth() + '-' + dataRef.getFullYear();
  if (receita)
    s.transacoes.push({ id: 'r' + sufixo, categoria: 'receita', valor: receita, ...base });
  if (despesa)
    s.transacoes.push({ id: 'd' + sufixo, categoria: 'despesa_fixa', valor: despesa, ...base });
  if (aporte)
    s.transacoes.push({
      id: 'i' + sufixo,
      categoria: 'investimento_fixo',
      valor: aporte,
      ...base,
    });
}

test('o chip e o Relatório mensal saem da MESMA conta — não há segundo score', () => {
  // Trava estrutural. O teste de valor abaixo passaria mesmo com a régua
  // duplicada (bastaria copiar os cinco critérios), e continuaria passando até
  // o dia em que só uma das cópias fosse ajustada.
  const ini = CF.indexOf('function atualizarTermometroControle');
  assert.ok(ini > -1, 'atualizarTermometroControle não encontrada');
  const corpo = CF.slice(ini, CF.indexOf('\nfunction ', ini + 10));
  assert.ok(
    corpo.includes('buildMonthlyReport') && corpo.includes('rmCalcularTermometro'),
    'o chip tem de perguntar ao Relatório mensal em vez de calcular por fora'
  );
  assert.ok(
    !/pctDespesas\s*[<>]|pctInvestimentos\s*[<>]|criterios\s*\.push/.test(corpo),
    'apareceu uma segunda régua de critérios dentro do Controle'
  );
});

test('o score do chip é exatamente o que o Relatório mensal mostraria', () => {
  const s = carregarApp({}, ORDEM_TERMOMETRO);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 1000 });
  const hoje = new Date();
  const ref = new Date(hoje.getFullYear(), hoje.getMonth(), 5);
  lancarMes(s, conta.id, ref, { receita: 9000, despesa: 3000, aporte: 3000 });

  const yyyymm = s.rmMesAnoToYyyymm(ref.getMonth(), ref.getFullYear());
  const doRelatorio = s.rmCalcularTermometro(s.buildMonthlyReport(yyyymm));

  // O chip lê o mês em exibição; alinhamos a visão com o mês lançado.
  s.visaoMes = ref.getMonth();
  s.visaoAno = ref.getFullYear();
  const doChip = s.rmCalcularTermometro(
    s.buildMonthlyReport(s.visaoAno + '-' + String(s.visaoMes + 1).padStart(2, '0'))
  );

  assert.equal(doChip.score, doRelatorio.score, 'os dois lugares têm de mostrar o mesmo número');
  assert.equal(doChip.statusGeral, doRelatorio.statusGeral);
  assert.ok(doChip.score > 0, 'com receita, despesa baixa e aporte alto o score não pode ser zero');
});

test('a agulha e o arco traduzem o score — inclusive nas pontas', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const g = s.termChipGeometria;

  // Semicírculo: 0 aponta para a esquerda (-90°), 100 para a direita (+90°).
  assert.equal(g(0).angulo, -90);
  assert.equal(g(50).angulo, 0);
  assert.equal(g(100).angulo, 90);

  // O arco preenchido é o complemento do dashoffset.
  assert.equal(g(0, 60).offset, 60, 'score 0 não preenche nada');
  assert.equal(g(100, 60).offset, 0, 'score 100 preenche o arco inteiro');
  assert.equal(g(25, 60).offset, 45);

  // Nada de agulha girando fora do mostrador se um score vier torto.
  assert.equal(g(-30).angulo, -90);
  assert.equal(g(180).angulo, 90);
  assert.equal(g(NaN).angulo, -90);
  assert.equal(g(undefined).offset, 60, 'sem score o arco fica vazio, não NaN');
});

test('mês sem lançamento nenhum não ganha diagnóstico', () => {
  const s = carregarApp({}, ORDEM_TERMOMETRO);
  const hoje = new Date();
  const yyyymm = s.rmMesAnoToYyyymm(hoje.getMonth(), hoje.getFullYear());
  const rep = s.buildMonthlyReport(yyyymm);

  assert.equal(rep.hasData, false, 'o mês está vazio');
  // Este é o motivo da guarda: sem dado nenhum, o score NÃO é zero — quatro
  // critérios contam como neutros e a média cai no meio da régua.
  const t = s.rmCalcularTermometro(rep);
  assert.ok(t.score > 0, 'o cálculo cru devolve um score plausível para dado nenhum');

  const ini = CF.indexOf('function atualizarTermometroControle');
  const corpo = CF.slice(ini, CF.indexOf('\nfunction ', ini + 10));
  assert.ok(
    /rep\.hasData/.test(corpo),
    'sem checar hasData o chip abre em "Atenção" para quem nunca lançou nada'
  );
  assert.ok(
    corpo.indexOf('rep.hasData') < corpo.indexOf('rmCalcularTermometro(rep)'),
    'a guarda tem de vir ANTES de calcular o score'
  );
});

test('o chip acompanha o mês em exibição, não o mês corrente', () => {
  const s = carregarApp({}, ORDEM_TERMOMETRO);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 1000 });
  const hoje = new Date();
  const esteMes = new Date(hoje.getFullYear(), hoje.getMonth(), 5);
  const mesPassado = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 5);

  // Um mês exemplar e um mês ruim, para os scores não coincidirem por acaso.
  lancarMes(s, conta.id, esteMes, { receita: 9000, despesa: 2000, aporte: 4000 });
  lancarMes(s, conta.id, mesPassado, { receita: 9000, despesa: 8500, aporte: 100 });

  const scoreDe = (d) =>
    s.rmCalcularTermometro(s.buildMonthlyReport(s.rmMesAnoToYyyymm(d.getMonth(), d.getFullYear())))
      .score;

  assert.notEqual(
    scoreDe(esteMes),
    scoreDe(mesPassado),
    'os dois meses precisam pontuar diferente para o teste ter valor'
  );

  // O que a tela faz: passa visaoMes/visaoAno para atualizarTermometroControle.
  const chamada = CF.slice(CF.indexOf('function atualizarTelaControle'));
  assert.ok(
    /atualizarTermometroControle\(visaoMes,\s*visaoAno\)/.test(chamada),
    'o chip tem de receber o mês em exibição — cravar "hoje" mentiria ao navegar'
  );
});

test('clicar no chip abre o Relatório mensal já no mês que está na tela', () => {
  const ini = CF.indexOf('function abrirRelatorioDoMesVisao');
  assert.ok(ini > -1, 'abrirRelatorioDoMesVisao não encontrada');
  const corpo = CF.slice(ini, CF.indexOf('\nfunction ', ini + 10));
  assert.ok(
    corpo.includes('rmSeletorMes') && corpo.includes('visaoAno') && corpo.includes('visaoMes'),
    'o mês precisa ser passado adiante, senão o relatório abre em outro mês'
  );
  assert.ok(
    corpo.indexOf('rmSeletorMes') < corpo.indexOf('menu-btn'),
    'o seletor tem de ser preenchido ANTES da navegação — renderRelatorioMensal lê o valor dele'
  );
  assert.ok(
    !/mudarAba\(/.test(corpo),
    'mudarAba usa e.currentTarget; a navegação programática vai pelo botão da barra lateral'
  );
});

test('o chip existe no cabeçalho do Controle com os ganchos que o JS escreve', () => {
  const secao = HTML.slice(
    HTML.indexOf('<section id="controle"'),
    HTML.indexOf('<div class="kpis-controle">')
  );
  assert.ok(
    secao.includes('id="termometroControle"'),
    'o chip tem de estar dentro da seção do Controle'
  );
  assert.ok(
    secao.indexOf('id="termometroControle"') < secao.indexOf('Novo lançamento'),
    'o chip fica no campo superior direito, antes do botão de ação'
  );
  for (const id of ['termChipScore', 'termChipRotulo', 'termChipArco', 'termChipPonteiro']) {
    assert.ok(secao.includes('id="' + id + '"'), `falta o gancho #${id} que o JS atualiza`);
  }
  assert.match(
    secao,
    /onclick="abrirRelatorioDoMesVisao\(\)"/,
    'o chip tem de levar ao relatório completo'
  );
});

test('as três faixas do score têm cor no CSS do chip', () => {
  // RM_FAIXAS_SCORE é a fonte da verdade das faixas. Se alguém acrescentar uma
  // quarta lá, o chip fica sem regra para ela e nasce transparente.
  const rm = fs.readFileSync(path.join(ROOT, 'web/appliquei-relatorio-mensal.js'), 'utf8');
  const bloco = rm.slice(rm.indexOf('var RM_FAIXAS_SCORE'), rm.indexOf('function rmFaixaDoScore'));
  const faixas = Array.from(bloco.matchAll(/status:\s*'([a-z]+)'/g)).map((m) => m[1]);
  assert.deepEqual(faixas.sort(), ['amarelo', 'verde', 'vermelho'], 'as faixas mudaram');
  for (const f of faixas) {
    assert.ok(
      HTML.includes('.term-chip[data-faixa="' + f + '"]'),
      `a faixa "${f}" existe no score mas não tem cor no chip`
    );
  }
  assert.ok(
    HTML.includes('.term-chip[data-faixa="vazio"]'),
    'falta o estado "vazio" — o mês sem lançamento não pode exibir número'
  );
});

test('o valor do chip não é borrado pelo modo "ocultar valores"', () => {
  // O score é um índice de 0 a 100, não dinheiro: borrá-lo esconderia
  // justamente o aviso, e o próprio CSS do app diz que percentuais ficam
  // visíveis. A regra universal pega qualquer .valor-mascarado.
  const secao = HTML.slice(
    HTML.indexOf('id="termometroControle"'),
    HTML.indexOf('<div class="kpis-controle">')
  );
  const chip = secao.slice(0, secao.indexOf('</button>'));
  assert.ok(
    !chip.includes('valor-mascarado'),
    'o chip não pode carregar a classe que borra valores em dinheiro'
  );
});
