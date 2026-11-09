'use strict';

// "Seu plano do mês" (nov/2026): a soma dos limites por categoria contra a
// renda, como ela se divide, e o estado de cada limite olhando o que ainda
// pode mudar (o fixo da categoria não deixa ninguém "perto do limite").

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

const NOV = 10;
const ANO = 2026;
const DIA9 = new Date(ANO, NOV, 9, 12);

function mundo() {
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.transacoes.length = 0;
  const L = (id, valor, categoria, categoriaDespesa, extra) =>
    s.transacoes.push(
      Object.assign(
        { id, descricao: id, valor, categoria, categoriaDespesa, mes: NOV, ano: ANO },
        extra || {}
      )
    );
  // O mês do print de 09/11.
  L('renda', 6700, 'receita');
  L('fin', 1250, 'despesa_fixa', 'moradia', { groupId: 'g1' });
  L('cond', 1038.92, 'despesa_fixa', 'moradia', { groupId: 'g2' });
  L('merc', 860.84, 'despesa_variavel', 'alimentacao');
  L('comb', 284, 'despesa_variavel', 'transporte');
  L('loja', 189.99, 'despesa_variavel', 'cuidados_pessoais');
  s.definirLimiteCategoria('moradia', 2300);
  s.definirLimiteCategoria('alimentacao', 491);
  s.definirLimiteCategoria('transporte', 300);
  return s;
}

test('estado: fixo dentro do limite é "ok", não "perto" — mesmo em 99%', () => {
  const s = mundo();
  assert.equal(s.estadoLimiteCategoria('moradia', NOV, ANO, 2288.92, 2300, DIA9), 'ok');
  assert.equal(s.estadoLimiteCategoria('alimentacao', NOV, ANO, 860.84, 491, DIA9), 'passou');
  assert.equal(s.estadoLimiteCategoria('transporte', NOV, ANO, 284, 300, DIA9), 'perto');
  assert.equal(s.estadoLimiteCategoria('transporte', NOV, ANO, 284, 0, DIA9), null);
});

test('estado "ritmo": dentro dos 80%, mas rápido demais para o dia do mês', () => {
  const s = mundo();
  s.definirLimiteCategoria('transporte', 1000);
  // 284 de 1000 no dia 9: o esperado era 300 → no ritmo.
  assert.equal(s.estadoLimiteCategoria('transporte', NOV, ANO, 284, 1000, DIA9), 'ok');
  // No dia 3, o esperado era 100: R$ 184 acima, folga de R$ 100.
  const dia3 = new Date(ANO, NOV, 3, 12);
  assert.equal(s.estadoLimiteCategoria('transporte', NOV, ANO, 284, 1000, dia3), 'ritmo');
});

test('plano: soma dos limites, sobra planejada sobre a renda e quem passou', () => {
  const s = mundo();
  const p = s.planoDoMes(NOV, ANO, DIA9);
  assert.equal(p.renda, 6700);
  assert.equal(p.planejado, 3091);
  assert.equal(p.sobraPlanejada, 3609);
  assert.deepEqual(
    JSON.parse(JSON.stringify(p.cats.map((c) => c.slug))),
    ['moradia', 'alimentacao', 'transporte'],
    'do maior limite para o menor'
  );
  assert.equal(Math.round(p.gastoNoPlano * 100), Math.round((2288.92 + 860.84 + 284) * 100));
  assert.equal(p.passou, 1);
  assert.equal(p.atencao, 1);
  assert.equal(p.dentro, 1);
  assert.equal(p.fora.length, 1);
  assert.equal(p.fora[0].slug, 'cuidados_pessoais');
  assert.equal(p.foraDoPlano, 189.99);
});

test('cartão do plano: valores, sobra, aviso de passar e o caminho para ajustar', () => {
  const s = mundo();
  const html = s.htmlPlanoDoMes(s.planoDoMes(NOV, ANO, DIA9));
  assert.match(html, /Seu plano do mês/);
  assert.match(html, /com destino, <b>46%<\/b> da renda/);
  assert.match(html, /Sobra prevista no plano/);
  assert.match(html, /passou R\$/);
  assert.match(html, /class="cem"/, 'a marca do 100%');
  assert.match(html, /1 passou/);
  assert.match(html, /Fora do plano/);
  assert.match(html, /1 sem limite/);
  assert.match(html, /planoIrParaCategorias\(\)/, 'os selos levam à lista');
  assert.match(html, /abrirMontarPlano\(\)/, 'Ajustar abre a montagem do plano');
  assert.doesNotMatch(html, /<details class="plano-div" open/, 'divisão fechada por padrão');
  assert.match(
    s.htmlPlanoDoMes(s.planoDoMes(NOV, ANO, DIA9), { aberta: true }),
    /<details class="plano-div" open/
  );
});

test('plano maior que a renda vira aviso; sem limite nenhum, o convite para montar', () => {
  const s = mundo();
  s.definirLimiteCategoria('moradia', 9000);
  const p = s.planoDoMes(NOV, ANO, DIA9);
  assert.ok(p.sobraPlanejada < 0);
  assert.match(s.htmlPlanoDoMes(p), /O plano passa da renda/);
  ['moradia', 'alimentacao', 'transporte'].forEach((c) => s.definirLimiteCategoria(c, 0));
  assert.match(s.htmlPlanoDoMes(s.planoDoMes(NOV, ANO, DIA9)), /Montar meu plano/);
});

test('categoria quase toda fixa não mostra "cabe R$ 3 por semana"', () => {
  const s = mundo();
  const r = s.ritmoLimiteCategoria('moradia', NOV, ANO, DIA9);
  assert.equal(r.estado, 'ok');
  assert.equal(s.ritmoTemFolgaUtil(r), false);
  assert.equal(s.textoRitmoLimite(r), '');
});

// ---------------------------------------------------------------------------
// Reorganização de nov/2026: cor fixa, ordem por situação, sobra prevista,
// linha de categoria e o cartão do topo do celular.
// ---------------------------------------------------------------------------

test('sobra prevista desconta o que já saiu fora do plano; sobra real é a do topo', () => {
  const s = mundo();
  const p = s.planoDoMes(NOV, ANO, DIA9);
  assert.equal(p.sobraPrevista, 6700 - 3091 - 189.99);
  assert.equal(
    Math.round(p.sobraReal * 100),
    Math.round((6700 - 2288.92 - 860.84 - 284 - 189.99) * 100)
  );
  assert.equal(p.semLimite, 1);
});

test('cor fixa: a mesma categoria tem a mesma cor em qualquer ordem, e as criadas não repetem', () => {
  const s = mundo();
  s.salvarCategoriasDespesaCustom(
    s.obterCategoriasDespesaCustom().concat([
      { v: 'dizimo', label: '💡 Dizimo' },
      { v: 'combustivel', label: '⛽ Comb' },
    ])
  );
  const corPlano = s.planoDoMes(NOV, ANO, DIA9).cats.find((c) => c.slug === 'moradia').cor;
  assert.equal(corPlano, s.corCategoriaDespesa('moradia'));
  const cores = ['moradia', 'alimentacao', 'transporte', 'saude', 'dizimo', 'combustivel'].map(
    (c) => s.corCategoriaDespesa(c)
  );
  assert.equal(new Set(cores).size, cores.length, 'cores distintas');
  assert.equal(new Set(s.PALETA_CATEGORIA_DESPESA).size, 12);
  assert.equal(s.corCategoriaDespesa('__sem_categoria__'), '#9aa7a0');
});

test('lista por categoria: quem passou primeiro, depois atenção, dentro e sem limite', () => {
  const s = mundo();
  const ordem = s.linhasCategoriaMes(NOV, ANO).map((l) => l.slug);
  assert.deepEqual(JSON.parse(JSON.stringify(ordem)), [
    'alimentacao',
    'transporte',
    'moradia',
    'cuidados_pessoais',
  ]);
});

test('categoria com limite e sem gasto ainda aparece na lista (faz parte do plano)', () => {
  const s = mundo();
  s.definirLimiteCategoria('lazer', 200);
  const l = s.linhasCategoriaMes(NOV, ANO).find((x) => x.slug === 'lazer');
  assert.ok(l);
  assert.equal(l.valor, 0);
});

test('frases da linha: curta no web, com o limite no celular', () => {
  const s = mundo();
  const linhas = s.linhasCategoriaMes(NOV, ANO);
  const por = (slug) => linhas.find((l) => l.slug === slug);
  assert.equal(
    s.fraseLinhaCategoria(por('alimentacao'), NOV, ANO, true),
    'Passou R$ 370 do limite de R$ 491'
  );
  assert.match(s.fraseLinhaCategoria(por('alimentacao'), NOV, ANO, false), /^Passou R\$\s369,84$/);
  assert.match(s.fraseLinhaCategoria(por('moradia'), NOV, ANO, true), /só contas fixas$/);
  assert.match(s.fraseLinhaCategoria(por('cuidados_pessoais'), NOV, ANO, true), /^Sem limite/);
});

test('linha HTML: pílula com % do limite; sem limite oferece "+ Limite" sem abrir o extrato', () => {
  const s = mundo();
  const html = s.htmlListaCategorias(NOV, ANO, { curto: true });
  assert.match(html, /class="cat-lista curta"/);
  assert.match(html, /class="cat-row passou"[^]*?175%/);
  assert.match(html, /event\.stopPropagation\(\);definirLimiteRapido\('cuidados_pessoais'\)/);
  assert.match(html, /\+ Limite/);
  assert.match(s.htmlListaCategorias(NOV, ANO, {}), />Definir</);
});

test('formatarMoedaCurta arredonda para reais e mantém o sinal', () => {
  const s = mundo();
  assert.equal(s.formatarMoedaCurta(4712.9), 'R$ 4.713');
  assert.equal(s.formatarMoedaCurta(-421.67), '−R$ 422');
});

test('celular: o cartão da sobra tem as duas visões (por tipo e fixas × variáveis)', () => {
  const s = carregarApp({}, ORDEM_CONTROLE.concat(['web/appliquei-mobile.js']));
  const resumo = {
    receita: 6700,
    resgate: 0,
    despFixa: 3624.82,
    despVar: 1883.73,
    cartao: 0,
    invFixo: 0,
    invVar: 0,
    sonho: 0,
  };
  const html = s._mobDestinoNoCartao({ mes: NOV, ano: ANO, resumo });
  assert.match(html, /mi-visao-seg/);
  assert.match(html, /data-v="tipo"/);
  assert.match(html, /data-v="fv"/);
  for (const rot of [
    'Receitas',
    'Despesas',
    'Cartão',
    'Investimentos',
    'Sonhos',
    'Entrou',
    'Contas fixas',
    'Gastos variáveis',
  ])
    assert.match(html, new RegExp(rot));
  assert.equal((html.match(/Sobra do mês/g) || []).length, 2, 'as duas visões fecham na sobra');
  // Na visão fixas × variáveis, cartão zerado não aparece; na por tipo, sim (cinza).
  const v = s.mobVisoesDaSobra(resumo);
  assert.equal(v.sobra.toFixed(2), '1191.45');
  assert.equal(v.tipo.find((p) => p[0] === 'Cartão')[4], true);
  assert.equal(v.fv.find((p) => p[0] === 'Cartão')[4], false);
  const faltou = s._mobDestinoNoCartao({
    mes: NOV,
    ano: ANO,
    resumo: Object.assign({}, resumo, { despVar: 5000 }),
  });
  assert.match(faltou, /Faltou no mês/);
});

test('celular: sem botões rápidos nem "O mês por tipo" no Resumo', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const MOB = fs.readFileSync(path.join(__dirname, '..', 'web', 'appliquei-mobile.js'), 'utf8');
  const corpo = MOB.slice(
    MOB.indexOf('function mobRenderInicio('),
    MOB.indexOf('function _mobPreencherPrecisaNotamos(')
  );
  assert.doesNotMatch(corpo, /mi-atalhos/);
  assert.doesNotMatch(
    corpo,
    /<h2 class="mi-h2">O mês por tipo/,
    'o mês por tipo mora no cartão da sobra'
  );
  assert.match(corpo, /_mobPlanoNoCartao\(d\)/);
  assert.match(corpo, /_mobCategorias\(d\)/);
});

// ---------------------------------------------------------------------------
// Montagem do plano (nov/2026): sugestão, soma ao vivo, onde cortar, lote.
// ---------------------------------------------------------------------------

function comHistorico() {
  const s = mundo();
  for (let k = 1; k <= 3; k++) {
    const d = new Date(ANO, NOV - k, 1);
    const L = (id, valor, categoria, categoriaDespesa, extra) =>
      s.transacoes.push(
        Object.assign(
          {
            id: id + k,
            descricao: id,
            valor,
            categoria,
            categoriaDespesa,
            mes: d.getMonth(),
            ano: d.getFullYear(),
          },
          extra || {}
        )
      );
    L('r', 6700, 'receita');
    L('fin', 2288.92, 'despesa_fixa', 'moradia', { groupId: 'g1' });
    L('merc', 1000 + k * 100, 'despesa_variavel', 'alimentacao');
    L('plano', 659.9, 'despesa_fixa', 'saude', { groupId: 'g3' });
    L('farm', 150, 'despesa_variavel', 'saude');
  }
  s.transacoes.push({
    id: 'planoNov',
    descricao: 'Plano',
    valor: 659.9,
    categoria: 'despesa_fixa',
    categoriaDespesa: 'saude',
    groupId: 'g3',
    mes: NOV,
    ano: ANO,
  });
  return s;
}

test('sugestão: fixas do mês + média do variável, de 10 em 10; sem fixas, a média', () => {
  const s = comHistorico();
  // Saúde: plano 659,90 neste mês + farmácia 150 de média → 809,90 → 810.
  assert.equal(s.sugestaoLimiteCategoria('saude', NOV, ANO), 810);
  // Alimentação: média de 1.100, 1.200 e 1.300 = 1.200.
  assert.equal(s.sugestaoLimiteCategoria('alimentacao', NOV, ANO), 1200);
  // Sem histórico nem gasto: sem sugestão.
  assert.equal(s.sugestaoLimiteCategoria('pets', NOV, ANO), 0);
});

test('dados da montagem: renda, grupos e a renda média quando o mês não tem receita', () => {
  const s = comHistorico();
  let d = s.dadosMontagemPlano(NOV, ANO);
  assert.equal(d.renda, 6700, 'mundo() lança 6.700 de renda em novembro');
  const por = (slug) => d.cats.find((c) => c.slug === slug);
  assert.equal(por('saude').grupo, 'fixas');
  assert.equal(por('alimentacao').grupo, 'dia');
  assert.equal(por('pets').grupo, 'sem');
  s.transacoes.splice(
    s.transacoes.findIndex((t) => t.id === 'renda'),
    1
  );
  d = s.dadosMontagemPlano(NOV, ANO);
  assert.equal(d.renda, 6700);
  assert.equal(d.rendaRotulo, 'da renda média de');
});

test('resumo ao vivo e onde cortar quando passa da renda', () => {
  const s = comHistorico();
  const d = s.dadosMontagemPlano(NOV, ANO);
  const v = { moradia: 2300, alimentacao: 1200, saude: 810 };
  let r = s.resumoMontagemPlano(d, v);
  assert.equal(r.planejado, 4310);
  assert.equal(r.sobra, 2390);
  assert.equal(r.passou, false);
  assert.equal(s.ondeCortarPlano(d, v).slug, 'moradia', 'o maior excesso sobre a média');
  v.alimentacao = 4000;
  r = s.resumoMontagemPlano(d, v);
  assert.equal(r.passou, true);
  const c = s.ondeCortarPlano(d, v);
  assert.equal(c.slug, 'alimentacao');
  assert.equal(Math.round(c.excesso), 2800);
  assert.ok(s.vezesDaMedia(4000, 1200) > 3);
  assert.equal(s.vezesDaMedia(1300, 1200), 0);
});

test('salvar em lote grava todos de uma vez e "0" tira o limite', () => {
  const s = comHistorico();
  s.definirLimiteCategoria('lazer', 300);
  s.aplicarLimitesEmLote({ moradia: 2300, alimentacao: 1200, lazer: 0 });
  assert.equal(s.obterLimiteCategoria('moradia'), 2300);
  assert.equal(s.obterLimiteCategoria('alimentacao'), 1200);
  assert.equal(s.obterLimiteCategoria('lazer'), 0);
  const aj = JSON.parse(s.localStorage.getItem('futurorico_categoriasDespesa'));
  assert.ok(!aj.some((a) => a.v === 'lazer'), 'sem ajuste vazio sobrando');
});

test('"+ Limite" e "Ajustar limites" abrem a montagem do plano', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const CF = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'appliquei-aba-controle-financeiro.js'),
    'utf8'
  );
  assert.match(CF, /function definirLimiteRapido\(slug\) \{\s*abrirMontarPlano\(slug\);/);
  assert.match(CF, /class="plano-ajustar" onclick="abrirMontarPlano\(\)"/);
  assert.match(CF, /Montar o plano \(todos os limites com a soma\)/);
});

test('Precisa de você: o botão abre e recolhe a lista (não só abre)', () => {
  const s = carregarApp({}, ORDEM_CONTROLE.concat(['web/appliquei-mobile.js']));
  const hoje = '2026-11-09';
  const itens = [10, 12, 15, 20].map((d, i) => ({
    tipo: 'conta',
    dataVencimento: '2026-11-' + d,
    conta: { id: 'c' + i, descricao: 'Conta ' + i, valor: 100, categoria: 'despesa_fixa' },
  }));
  s._mobPrecisaAberta = false;
  let html = s._mobProximos(itens, hoje, '');
  assert.match(html, /class="mi-card mp-fila mp-lista"/);
  assert.match(html, /onclick="mobPrecisaAlternar\(this\)"/);
  assert.match(html, /\+ 2 até o fim do mês/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /this\.remove\(\)/, 'o botão não some mais');
  s._mobPrecisaAberta = true;
  html = s._mobProximos(itens, hoje, '');
  assert.match(html, /mp-lista todos/);
  assert.match(html, /Recolher/);
  assert.match(html, /aria-expanded="true"/);
});
