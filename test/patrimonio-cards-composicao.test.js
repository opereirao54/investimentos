'use strict';

// "Meu patrimônio" no web trocou os quatro cards de componente por um balanço
// (o que você tem / o que você deve) e ganhou a linha do tempo, o "por que
// mudou" e o fôlego. São as MESMAS parcelas mostradas de outro jeito, e o
// risco é o de sempre: duas somas que divergem sem nada quebrar.
//
// O que este arquivo tranca:
//
//   1. As fatias somam 100% do que você tem; patrimônio zero não vira "0,0%".
//   2. Líquido = o que tem − o que deve, e a dívida só conta o que já é dívida
//      hoje: financiamento ativo e fatura aberta/fechada. Parcela de fatura
//      futura e financiamento quitado ficam de fora.
//   3. "Por que mudou" fecha com a variação do gráfico ao centavo, e aporte não
//      é contado como ganho.
//   4. O eixo do gráfico cobre a série inteira (a linha não escapa do topo).
//   5. As porcentagens saem em pt-BR no texto e com ponto no CSS.
//   6. Os ganchos do web existem, somem no celular e borram no "ocultar valores".

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_BASE } = require('./_harness-integracao.js');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const PATR = fs.readFileSync(path.join(ROOT, 'web/appliquei-patrimonio.js'), 'utf8');

const { ORDEM_CONTROLE } = require('./_harness-integracao.js');
const ORDEM_DIVIDA = ORDEM_CONTROLE.concat(['web/appliquei-bens.js', 'web/appliquei-faturas.js']);

test('as quatro fatias somam o patrimônio inteiro', () => {
  const s = carregarApp({}, ORDEM_BASE);
  const partes = { saldo: 24000, investido: 37989.69, imoveis: 420000, veiculos: 78000 };
  const total = Object.values(partes).reduce((a, b) => a + b, 0);

  const soma = Object.values(partes).reduce((acc, v) => acc + (v / total) * 100, 0);
  assert.ok(Math.abs(soma - 100) < 1e-9, 'as parcelas mostradas têm de esgotar o total');

  // E a função que pinta cada card usa exatamente essa razão.
  for (const v of Object.values(partes)) {
    const g = s.mpFatiaDoTotal(v, total);
    assert.ok(Math.abs(g - (v / total) * 100) < 1e-9);
  }
});

test('patrimônio zero não vira "0,0%" nem NaN', () => {
  const s = carregarApp({}, ORDEM_BASE);
  assert.equal(s.mpFatiaDoTotal(0, 0), null, 'sem total não há fatia a mostrar');
  assert.equal(s.mpFatiaDoTotal(500, 0), null);
  assert.equal(s.mpFatiaDoTotal(0, 1000), 0, 'com total, uma parcela zerada é 0% de verdade');
});

test('a fatia fica sempre entre 0% e 100%', () => {
  const s = carregarApp({}, ORDEM_BASE);
  // Bens podem ter valor negativo digitado errado, e o saldo em conta pode
  // ficar negativo de verdade (conta no vermelho).
  assert.equal(s.mpFatiaDoTotal(-5000, 100000), 0, 'parcela negativa não puxa a barra para trás');
  assert.equal(s.mpFatiaDoTotal(150000, 100000), 100, 'nem estoura o trilho');
  assert.equal(s.mpFatiaDoTotal(NaN, 100000), 0);
});

test('as porcentagens usam vírgula, como o resto dos números do app', () => {
  const s = carregarApp({}, ORDEM_BASE);
  // Variação (leva sinal).
  assert.equal(s.mpFmtPct(15.94), '+15,9%');
  assert.equal(s.mpFmtPct(-3.5), '-3,5%');
  assert.equal(s.mpFmtPct(0), '+0,0%');
  assert.equal(s.mpFmtPct(Infinity), '—', 'sem base de comparação não se inventa percentual');
  // Participação (sem sinal): fatia do card, legenda, "% do patrimônio".
  assert.equal(s.mpPctBR(75), '75,0%');
  assert.equal(s.mpPctBR(4.28), '4,3%');
  assert.equal(s.mpPctBR(NaN), '—');
});

test('a largura das barras continua em CSS válido — ponto, não vírgula', () => {
  // A mesma porcentagem vai para dois lugares: o texto (pt-BR) e o
  // `style="width:...%"`. Trocar o ponto por vírgula no segundo faz o
  // navegador descartar a declaração inteira e o segmento sumir da barra —
  // um erro silencioso, sem exceção nenhuma no console.
  const largurasEmCss = PATR.match(/style="width:\$\{[^}]+\}%/g) || [];
  assert.ok(largurasEmCss.length > 0, 'as barras somem se este padrão mudar de forma');
  for (const t of largurasEmCss) {
    assert.ok(!/mpPctBR|replace\('\.'/.test(t), `largura de barra formatada em pt-BR: ${t}`);
  }
  const concatenadas =
    PATR.match(/'<div class="mp-composition-seg" style="width:' \+\s*[^\n]+/g) || [];
  for (const t of concatenadas) {
    assert.ok(/toFixed/.test(t) && !/mpPctBR/.test(t), `largura do segmento em pt-BR: ${t}`);
  }
});

test('líquido = o que tem − o que deve; só entra o que já é dívida hoje', () => {
  const s = carregarApp({}, ORDEM_DIVIDA);
  const hoje = new Date();
  s.bens.push(
    {
      id: 'b1',
      nome: 'Apartamento',
      tipo: 'imovel',
      valorAtual: 500000,
      financiamento: { ativo: true, saldoDevedor: 190000 },
    },
    {
      id: 'b2',
      nome: 'Carro quitado',
      tipo: 'veiculo',
      valorAtual: 80000,
      financiamento: { ativo: false, saldoDevedor: 30000 },
    }
  );
  s.cartoes.push({ id: 'c1', nome: 'Visa', diaFechamento: 28, diaVencimento: 5 });
  const cand = s.cartaoFaturasCandidatas(hoje, 28, 5);
  const ymd = (d) =>
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0');
  const aberta = ymd(cand.aberta.vencimento);
  const v = cand.aberta.vencimento;
  const futura = ymd(new Date(v.getFullYear(), v.getMonth() + 3, v.getDate()));
  const compra = (id, venc, valor, pago) => ({
    id,
    categoria: 'cartao_credito',
    cartaoId: 'c1',
    dataVencimento: venc,
    valor,
    pago,
    mes: hoje.getMonth(),
    ano: hoje.getFullYear(),
  });
  s.transacoes.push(
    compra('t1', aberta, 1200, false),
    compra('t2', aberta, 300, true),
    compra('t3', futura, 900, false)
  );

  const d = s.mpDividas(hoje);
  assert.equal(d.bens.length, 1, 'financiamento quitado não é dívida');
  assert.equal(d.bens[0].valor, 190000);
  assert.equal(d.cartoes.length, 1);
  assert.equal(
    d.cartoes[0].valor,
    1200,
    'a fatura aberta conta o que falta pagar; a futura fica de fora'
  );
  assert.equal(d.total, 191200);
});

test('"por que mudou" fecha com a variação do gráfico e não conta aporte como ganho', () => {
  const s = carregarApp({}, ORDEM_BASE);
  const serie = [
    {
      mes: 8,
      ano: 2026,
      caixa: 40000,
      investido: 50000,
      custo: 48000,
      bens: 600000,
      total: 690000,
    },
    {
      mes: 9,
      ano: 2026,
      caixa: 37000,
      investido: 56500,
      custo: 53000,
      bens: 599350,
      total: 692850,
    },
  ];
  const m = s.mpMudancaDoMes(serie);
  assert.equal(m.aportes, 5000);
  assert.equal(m.contas, 2000, 'saíram 3 mil do caixa, mas 5 mil foram para investimento');
  assert.equal(m.valorizacao, 1500, 'só o que o investimento ganhou além do aporte');
  assert.equal(m.bens, -650);
  assert.ok(
    Math.abs(m.contas + m.valorizacao + m.bens - m.total) < 1e-9,
    'as parcelas somam a variação'
  );
  assert.equal(s.mpMudancaDoMes(serie.slice(0, 1)), null, 'com um mês só não há o que comparar');
});

test('o eixo do gráfico cobre a série inteira', () => {
  const s = carregarApp({}, ORDEM_BASE);
  const casos = [
    [698090, 736415],
    [0, 0],
    [1000, 1000],
    [-5000, 20000],
    [12.5, 13.1],
    [1496814.74, 1496814.74],
  ];
  for (const [mn, mx] of casos) {
    const t = s.mpEixoRedondo(mn, mx);
    assert.equal(t.length, 3);
    assert.ok(t[0] <= mn && t[2] >= mx, `eixo ${t} não cobre ${mn}..${mx}`);
  }
});

test('ganho ou perda do bem sobre a compra', () => {
  const s = carregarApp({}, ORDEM_DIVIDA);
  assert.ok(
    Math.abs(s.bemVariacaoCompra({ valorCompra: 480000, valorAtual: 520000 }) - 8.333) < 0.01
  );
  assert.ok(s.bemVariacaoCompra({ valorCompra: 120000, valorAtual: 98000 }) < 0);
  assert.equal(
    s.bemVariacaoCompra({ valorAtual: 98000 }),
    null,
    'sem valor de compra não há comparação'
  );
  assert.equal(s.bemVariacaoCompra({ valorCompra: 1000, valorAtual: 1000 }), null);
});

test('os ganchos do web existem, somem no celular e borram em "ocultar valores"', () => {
  const inicio = HTML.indexOf('<section id="meu_patrimonio"');
  const secao = HTML.slice(inicio, HTML.indexOf('CADASTRO DE BEM', inicio));
  for (const id of ['mpwHeroi', 'mpwBalanco', 'mpwMudou', 'mpwFolego', 'mp-classes-lista']) {
    assert.ok(secao.includes('id="' + id + '"'), `falta o gancho #${id}`);
  }
  assert.ok(!secao.includes('mp-kpi-saldo-fatia'), 'os cards de componente saíram');
  assert.match(HTML, /#meu_patrimonio \.mpd-web,/, 'os blocos do web somem no celular');
  assert.ok(
    HTML.includes('body.valores-ocultos #meu_patrimonio .mpd-oculta'),
    'valores do web têm de sumir no modo "ocultar valores"'
  );
  // Cada função de desenho é chamada no render.
  for (const fn of [
    'mpRenderHeroiWeb',
    'mpRenderBalancoWeb',
    'mpRenderMudouWeb',
    'mpRenderFolegoWeb',
    'mpRenderClassesWeb',
  ]) {
    assert.ok(
      new RegExp(fn + '\\(web\\)|' + fn + '\\(consolidado\\)').test(PATR),
      `${fn} não é chamada`
    );
  }
});

test('a barra do balanço usa ponto no CSS', () => {
  const ini = PATR.indexOf('function mpRenderBalancoWeb');
  const corpo = PATR.slice(ini, PATR.indexOf('function mpRenderMudouWeb'));
  assert.match(corpo, /toFixed\(2\)\s*\+\s*'%;background:'/);
  assert.ok(!/mpPctBR\([^)]*\) \+ '%;background/.test(corpo));
});

test('painel da instituição: filtros do extrato e caixa no fim de cada mês', () => {
  const s = carregarApp({}, ORDEM_BASE);
  const agora = new Date(2026, 10, 7, 12).getTime();
  const ts = (m, d) => new Date(2026, m, d, 12).getTime();
  const movs = [
    { ts: ts(0, 1), desc: 'Saldo inicial', valor: 1000, abertura: true, saldoApos: 1000 },
    { ts: ts(8, 5), desc: 'Salário', valor: 500, saldoApos: 1500 },
    { ts: ts(10, 3), desc: 'Mercado', valor: -200, saldoApos: 1300 },
    { ts: ts(10, 5), desc: 'Salário', valor: 500, saldoApos: 1800 },
  ];
  const mes = s.mpFiltrarExtratoPainel(movs, 'mes', 'todos', agora);
  assert.deepEqual(
    mes.map((m) => m.valor),
    [-200, 500],
    'este mês: só novembro, sem a abertura'
  );
  assert.equal(s.mpFiltrarExtratoPainel(movs, '3m', 'todos', agora).length, 3, 'set a nov');
  assert.equal(
    s.mpFiltrarExtratoPainel(movs, 'tudo', 'todos', agora).length,
    4,
    'tudo inclui a abertura'
  );
  assert.deepEqual(
    s.mpFiltrarExtratoPainel(movs, 'tudo', 'saidas', agora).map((m) => m.desc),
    ['Mercado']
  );
  assert.ok(
    s.mpFiltrarExtratoPainel(movs, 'tudo', 'entradas', agora).every((m) => m.valor > 0),
    'entradas só com valor positivo'
  );
  // O caixa de cada mês é o saldo do último movimento até o fim dele.
  const barras = s.mpCaixaFimDeMes(movs, 6);
  assert.equal(barras.length, 6);
  assert.equal(barras[barras.length - 1].atual, true, 'a última barra é o mês corrente');
});
