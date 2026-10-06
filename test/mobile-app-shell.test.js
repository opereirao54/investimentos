'use strict';

// Casca de app no celular (web/appliquei-mobile.js).
//
// No celular o app era o site de desktop espremido: o menu ficava atrás de
// um ☰ e cada troca de tela custava dois toques. A casca põe uma barra fixa
// embaixo e a tela "Mais". Ela não duplica lógica — navega clicando o botão
// da sidebar — então o que precisa ficar de pé é a costura entre as duas.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'web/appliquei-app.js'), 'utf8');
const MOB = fs.readFileSync(path.join(ROOT, 'web/appliquei-mobile.js'), 'utf8');

/** Seções que a sidebar sabe abrir: mudarAba(event,'<id>'). */
function abasDaSidebar() {
  const ids = new Set();
  const re = /class="menu-btn[^"]*"\s+onclick="mudarAba\(event,'([a-z_]+)'/g;
  let m;
  while ((m = re.exec(HTML))) ids.add(m[1]);
  return ids;
}

test('a barra tem Início, Patrimônio, cadastro, Carteira e Mais', () => {
  const i = HTML.indexOf('id="mobTabbar"');
  assert.ok(i > -1, 'a barra precisa existir');
  const barra = HTML.slice(i, HTML.indexOf('</nav>', i));
  const abas = [...barra.matchAll(/data-aba="([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(abas, ['controle', 'meu_patrimonio', 'carteira', 'mais_mobile']);
  // Duas de cada lado: o "+" fica exatamente no centro.
  const ordem = [...barra.matchAll(/data-aba="([a-z_]+)"|id="mobTabCadastro"/g)].map(
    (m) => m[1] || '+'
  );
  assert.equal(ordem.indexOf('+'), 2);
  assert.match(barra, /id="mobTabCadastro"[^>]*onclick="alternarMenuCadastro\(\)"/);
});

test('todo destino da barra e do "Mais" tem botão na sidebar', () => {
  // mobIrPara navega clicando o botão da sidebar; um destino sem botão
  // seria um toque que não faz nada.
  const sidebar = abasDaSidebar();
  const destinos = [...HTML.matchAll(/mobIrPara\('([a-z_]+)'\)/g)].map((m) => m[1]);
  assert.ok(destinos.length >= 12, `esperava a barra e os tiles, achei ${destinos.length}`);
  for (const d of destinos) {
    if (d === 'mais_mobile') continue;
    assert.ok(sidebar.has(d), `"${d}" não tem botão na sidebar`);
    assert.match(HTML, new RegExp(`<section id="${d}"`), `"${d}" não é uma seção`);
  }
});

test('o "Mais" alcança toda seção que não está na barra', () => {
  const naBarra = new Set(['controle', 'meu_patrimonio', 'carteira']);
  const i = HTML.indexOf('<section id="mais_mobile"');
  const mais = HTML.slice(i, HTML.indexOf('</section>', i));
  for (const aba of abasDaSidebar()) {
    if (naBarra.has(aba)) continue;
    assert.ok(mais.includes(`mobIrPara('${aba}')`), `"${aba}" ficou inalcançável no celular`);
  }
});

test('mudarAba avisa a barra a cada troca de aba', () => {
  const i = APP.indexOf('function mudarAba');
  const fn = APP.slice(i, APP.indexOf('\n}\n', i));
  assert.match(fn, /mobSincronizarAba\(idAba\)/);
});

test('a reserva do rodapé cobre a barra no celular', () => {
  // A barra é fixa; sem reservar a altura dela, o último item de cada tela
  // ficaria preso embaixo — o mesmo bug que a reserva do "+" já matou.
  assert.match(HTML, /--fab-reserva:\s*calc\(var\(--mob-barra\) \+ env\(safe-area-inset-bottom\)/);
});

test('nada da casca aparece no desktop', () => {
  assert.match(
    HTML,
    /\.mob-tabbar, \.mob-voltar, \.mob-seg, \.mob-dre, \.mob-sim-fixo, \.mob-inicio, \.mob-story, \.mob-saudacao, \.mob-olho, \.mob-stories, \.mob-folha \{ display: none; \}/
  );
  assert.match(
    HTML,
    /@media \(min-width: 769px\) \{\s*#mais_mobile \{ display: none !important; \}/
  );
  assert.match(MOB, /matchMedia\('\(max-width: 768px\)'\)/);
});

// ---------------------------------------------------------------------------
// Controle no celular: Resumo | Extrato | Projeção
// ---------------------------------------------------------------------------

function secaoControle() {
  const i = HTML.indexOf('<section id="controle"');
  return HTML.slice(i, HTML.indexOf('<section id="aulas"', i));
}

test('todo bloco do Controle aponta para uma aba que existe', () => {
  const sec = secaoControle();
  const abas = new Set([...sec.matchAll(/data-mob-seg="([a-z]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...abas], ['resumo', 'extrato', 'projecao']);
  const usadas = [...sec.matchAll(/data-mob-aba="([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(usadas.length >= 7, `esperava os blocos marcados, achei ${usadas.length}`);
  for (const a of usadas) assert.ok(abas.has(a), `bloco aponta para aba inexistente: ${a}`);
  assert.match(sec, /<section id="controle"[^>]*data-mob-aba-ativa="resumo"/);
});

test('o formulário de lançamento não mora dentro de um bloco de aba', () => {
  // O painel é `position: fixed` no celular, mas um pai com display:none o
  // apaga junto. Ele abre de qualquer aba (e pelo "+" de qualquer tela):
  // nenhum ancestral pode ser escondido pela troca de aba.
  const sec = secaoControle();
  const alvo = sec.indexOf('id="painelNovoLancamento"');
  assert.ok(alvo > -1);
  const abertos = [];
  const re = /<(\/?)div\b([^>]*)>/g;
  let m;
  while ((m = re.exec(sec)) && m.index < alvo) {
    if (m[1]) abertos.pop();
    else abertos.push(/data-mob-aba=/.test(m[2]));
  }
  assert.ok(!abertos.includes(true), 'painelNovoLancamento ficou dentro de um data-mob-aba');
});

test('os alertas de conta vencida aparecem em qualquer aba', () => {
  const sec = secaoControle();
  for (const id of ['alertaContaVencida', 'alertaVencimentoHoje', 'alertaCartaoKanban']) {
    const tag = sec.match(new RegExp(`<div id="${id}"[^>]*>`));
    assert.ok(tag, id);
    assert.doesNotMatch(tag[0], /data-mob-aba/, `${id} não pode sumir ao trocar de aba`);
  }
});

// ---------------------------------------------------------------------------
// DRE no celular
// ---------------------------------------------------------------------------

test('a DRE do celular recebe os números prontos da tabela', () => {
  // Um cálculo paralelo seria a receita para a tabela e os cartões
  // discordarem. mobRenderDRE só desenha o que atualizarTelaControle já fez.
  const CF = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba-controle-financeiro.js'), 'utf8');
  const i = CF.indexOf('tbodyDRE.innerHTML = htmlLinhas;');
  const trecho = CF.slice(i, i + 900);
  assert.match(trecho, /mobRenderDRE\(\{[\s\S]*meses: dreDados[\s\S]*acumulado: acumPorMes/);
  const fn = MOB.slice(MOB.indexOf('function mobRenderDRE'), MOB.indexOf('function mobDreIrPara'));
  assert.doesNotMatch(fn, /calcularResumoMes|obterSaldoCarregadoParaMes/);
});

test('a tabela da DRE continua a um toque no celular', () => {
  assert.match(HTML, /id="mobDRE"[^>]*data-mob-aba="projecao"/);
  assert.match(HTML, /id="cardTabelaDRE"/);
  assert.match(
    HTML,
    /#controle:not\(\.mob-dre-tabela\) #cardTabelaDRE \{ display: none !important; \}/
  );
  assert.match(MOB, /function mobDreAlternarTabela/);
});

test('as ações do extrato no celular são os botões originais', () => {
  // O painel de deslize reaproveita os botões da linha (mesmos onclick):
  // pagar, editar e excluir continuam passando pelas funções de sempre,
  // e excluir continua pedindo confirmação.
  for (const fn of ['prepararPagamento', 'prepararEdicao', 'deletarTransacao']) {
    assert.match(
      HTML,
      new RegExp(`\\[id\\^="acao-pagar-list-"\\] > button\\[onclick\\^="${fn}"\\]`)
    );
  }
  assert.doesNotMatch(MOB, /deletarTransacao\(|prepararEdicao\(|prepararPagamento\(/);
});

test('a faixa do Simulador lê o resultado do próprio herói', () => {
  // Ela repete o número que o simulador já calculou — nunca calcula outro.
  const i = MOB.indexOf('function _mobSimAtualizar');
  const fn = MOB.slice(i, MOB.indexOf('function mobSimIrResultado'));
  assert.match(fn, /getElementById\('heroRendaMensal'\)/);
  assert.doesNotMatch(fn, /calcularSimulador|Math\.pow/);
  assert.match(HTML, /id="simHero"/);
});

test('no celular nenhum rótulo fica abaixo de 11px por estilo inline', () => {
  for (const t of ['9px', '9.5px', '10px', '10.5px']) {
    assert.ok(
      HTML.includes(`.main-content [style*="font-size:${t}"]`),
      `faltou o piso para font-size:${t}`
    );
  }
});

// ---------------------------------------------------------------------------
// Início e Meu patrimônio no celular
// ---------------------------------------------------------------------------

test('o Início do celular usa o mesmo saldo livre e as mesmas barras do desktop', () => {
  const CF = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba-controle-financeiro.js'), 'utf8');
  // Uma conta só para o saldo livre, impressa no card e mandada ao celular.
  assert.match(
    CF,
    /const saldoLivre = totRec - totDesp - totCartao - totInv - totSonho \+ saldoCarregado;/
  );
  assert.match(CF, /kpiSaldo\.innerText = formatarMoeda\(saldoLivre\)/);
  assert.match(
    CF,
    /mobRenderInicio\(\{[\s\S]*saldoLivre: saldoLivre[\s\S]*composicao: \{ modo: agrupamentoComposicao, itens: dadosComposicao \}/
  );
  // Baixar pelo celular passa pelo confirmarPagamento do desktop.
  assert.match(MOB, /function mobConfirmarBaixa[\s\S]*confirmarPagamento\(id\)/);
});

test('Meu patrimônio no celular desenha os números que a aba já calculou', () => {
  const PAT = fs.readFileSync(path.join(ROOT, 'web/appliquei-patrimonio.js'), 'utf8');
  assert.match(PAT, /const kpis = mpRenderKPIs\(consolidado, janela\);/);
  assert.match(PAT, /mobRenderPatrimonio\(\{[\s\S]*kpis: kpis/);
  // A série mensal soma as parcelas pelas funções que já respondem por elas.
  const serie = PAT.slice(PAT.indexOf('function mpSerieMensalPatrimonio'));
  assert.match(serie, /mpCalcularSaldoTotal\(fim\)/);
  assert.match(serie, /calcularSerieEvolucao\('todos', ''\)/);
  assert.match(serie, /rmBensAteFimDoMes\(mes, ano\)/);
  const fn = MOB.slice(MOB.indexOf('function mobRenderPatrimonio'));
  assert.doesNotMatch(fn, /mpConsolidar\(|calcularPatrimonioTotal\(/);
});
