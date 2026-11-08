// ============================================================
// --- App mobile: barra inferior, tela "Mais" e voltar ---
// ============================================================
// No celular o app era o site de desktop espremido: o menu morava atrás de
// um ☰ no canto, cada troca de tela custava dois toques e nada dizia onde a
// pessoa estava. Aqui fica a casca de app que vale só até 768px:
//
//   - uma barra fixa embaixo, na zona do polegar, com as telas de uso
//     diário, duas de cada lado do "+" de cadastro (a última é o "Mais");
//   - a tela "Mais", que reúne as demais seções e as preferências que antes
//     viviam no rodapé da sidebar;
//   - um "‹ Mais" no topo das telas que se abre a partir dela.
//
// A casca NÃO duplica lógica: navegar é clicar no botão da sidebar (que já
// chama mudarAba com o callback certo — Info Mercado carrega notícias, por
// exemplo), e o "+" reaproveita o menu de cadastro global. No desktop nada
// disto aparece; o CSS esconde a barra e a seção "Mais" acima de 768px.

var MOB_ABAS_BARRA = ['controle', 'meu_patrimonio', 'carteira'];
var MOB_ABA_MAIS = 'mais_mobile';

function mobEhCelular() {
  return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
}

/** Leva à seção pelo mesmo caminho do menu lateral. */
function mobIrPara(idAba) {
  if (typeof fecharMenuCadastro === 'function') fecharMenuCadastro();
  if (idAba === MOB_ABA_MAIS) {
    mobMostrarMais();
    return;
  }
  const btn = Array.from(document.querySelectorAll('#mainSidebar .menu-btn')).find((b) =>
    (b.getAttribute('onclick') || '').includes("'" + idAba + "'")
  );
  if (btn) btn.click();
  // mudarAba já sincroniza no fim; repetir aqui garante a barra certa mesmo
  // se o render da aba lançar no meio do caminho.
  mobSincronizarAba(idAba);
}

/**
 * A seção "Mais" não tem botão na sidebar (no desktop a própria sidebar já é
 * o "mais"), então a troca é feita aqui, espelhando o que mudarAba faz.
 */
function mobMostrarMais() {
  const sec = document.getElementById(MOB_ABA_MAIS);
  if (!sec) return;
  document.querySelectorAll('.section').forEach((s) => s.classList.remove('ativa'));
  document.querySelectorAll('.menu-btn').forEach((b) => b.classList.remove('ativo'));
  sec.classList.add('ativa');
  document.body.classList.remove('controle-ativo');
  if (typeof fecharPainelLancamento === 'function') fecharPainelLancamento();
  mobAtualizarMais();
  mobSincronizarAba(MOB_ABA_MAIS);
}

/**
 * Acende a aba certa da barra e decide se a tela ganha o "‹ Mais".
 * Chamada por mudarAba a cada troca — é o único ponto que sabe a aba nova.
 */
function mobSincronizarAba(idAba) {
  const naBarra = MOB_ABAS_BARRA.indexOf(idAba) > -1 || idAba === MOB_ABA_MAIS;
  const acesa = naBarra ? idAba : MOB_ABA_MAIS;
  document.querySelectorAll('#mobTabbar .mob-tab[data-aba]').forEach((t) => {
    const on = t.dataset.aba === acesa;
    t.classList.toggle('ativo', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  document.body.classList.toggle('mob-secundaria', !naBarra);
  if (typeof _mobIconesBarra === 'function') _mobIconesBarra();
  // App de verdade abre a tela nova no topo. O rolador é .main-content.
  if (mobEhCelular()) {
    const rol = document.querySelector('.main-content');
    if (rol) rol.scrollTop = 0;
  }
}

/** Espelha na tela "Mais" o que a sidebar sabe: conta, tema, valores, salvo. */
function mobAtualizarMais() {
  const copia = (de, para) => {
    const a = document.getElementById(de);
    const b = document.getElementById(para);
    if (a && b) b.textContent = (a.textContent || '').trim();
  };
  copia('sidebarAuthEmail', 'mobContaEmail');
  copia('sidebarAuthBtnLabel', 'mobAuthLabel');
  copia('ultimoSalvoTxt', 'mobUltimoSalvo');

  const email = document.getElementById('mobContaEmail');
  const avatar = document.getElementById('mobContaAvatar');
  if (avatar && email) {
    const t = (email.textContent || '').trim();
    avatar.textContent = t && t !== 'Conta' ? t.charAt(0).toUpperCase() : '?';
  }

  const liga = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('aria-checked', on ? 'true' : 'false');
  };
  liga('mobPrefTema', document.body.classList.contains('dark'));
  liga('mobPrefValores', document.body.classList.contains('valores-ocultos'));
}

function mobAlternarTema() {
  if (typeof toggleDarkMode === 'function') toggleDarkMode();
  mobAtualizarMais();
}

function mobAlternarValores() {
  if (typeof toggleValoresOcultos === 'function') toggleValoresOcultos();
  mobAtualizarMais();
}

// Voltar ao desktop com a tela "Mais" aberta deixaria a página em branco:
// ela não existe acima de 768px. Cai no Controle, a tela inicial.
function _mobAoRedimensionar() {
  const sec = document.getElementById(MOB_ABA_MAIS);
  if (!mobEhCelular() && sec && sec.classList.contains('ativa')) mobIrPara('controle');
}

document.addEventListener('DOMContentLoaded', function () {
  const ativa = document.querySelector('.section.ativa');
  mobSincronizarAba(ativa ? ativa.id : 'controle');
  window.addEventListener('resize', _mobAoRedimensionar);
});

// A página nunca rola: o body tem a altura da tela e quem rola é o
// .main-content. Mas o iPhone, ao abrir o teclado num campo, empurra a
// JANELA para cima para mostrar o campo — e não a devolve quando o teclado
// fecha. No app instalado isso deixava o topo cortado sob a barra de status e
// uma faixa vazia abaixo da barra inferior até fechar o app. Sem campo em
// foco, qualquer deslocamento da janela é esse resto: volta para o zero.
function mobDesfazerDeslocamento() {
  if (!mobEhCelular()) return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
}
document.addEventListener('focusout', function () {
  setTimeout(mobDesfazerDeslocamento, 80);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', function () {
    setTimeout(mobDesfazerDeslocamento, 80);
  });
}
window.addEventListener('pageshow', mobDesfazerDeslocamento);
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) mobDesfazerDeslocamento();
});

// ------------------------------------------------------------
// Controle no celular: Resumo | Extrato | Projeção
// ------------------------------------------------------------
// A seção empilhava indicadores, alertas, vencimentos, saúde, composição,
// extrato e DRE — umas quatro telas de rolagem. No celular ela vira três
// abas que trocam o conteúdo no mesmo espaço. Quem diz a que aba cada bloco
// pertence é o próprio HTML (data-mob-aba); aqui só se troca o estado.
var MOB_SEG_CONTROLE = ['resumo', 'extrato', 'projecao'];

function mobSegControle(aba) {
  if (MOB_SEG_CONTROLE.indexOf(aba) === -1) return;
  const sec = document.getElementById('controle');
  if (!sec) return;
  sec.dataset.mobAbaAtiva = aba;
  try {
    sessionStorage.setItem(MOB_SEG_CHAVE, aba);
  } catch (e) {}
  document.querySelectorAll('#mobSegControle [data-mob-seg]').forEach((b) => {
    b.setAttribute('aria-selected', b.dataset.mobSeg === aba ? 'true' : 'false');
  });
  const rol = document.querySelector('.main-content');
  const seg = document.getElementById('mobSegControle');
  // Volta ao começo da aba, mas sem esconder a própria barra de abas.
  if (rol && seg && rol.scrollTop > seg.offsetTop) rol.scrollTop = seg.offsetTop;
}

// ------------------------------------------------------------
// DRE no celular: gráfico do resultado + um cartão por mês
// ------------------------------------------------------------
// A DRE é uma tabela de 12 a 48 colunas; com a primeira coluna fixa, numa
// tela de 390px cabia um mês e pouco por vez, e comparar meses exigia rolar
// de lado e decorar números. A pergunta da Projeção é "vou ficar no vermelho
// em algum mês?" — então o celular mostra primeiro a resposta (barras e um
// alerta do primeiro mês negativo) e depois o detalhe, um mês por cartão,
// só com as linhas que tiveram movimento. A tabela segue a um toque.
//
// Os números chegam prontos de atualizarTelaControle: nada é recalculado.

function _mobDreClasse(v, d) {
  if (v < 0) return 'neg';
  if (v < d.metaVermelha) return 'baixo';
  if (v >= d.metaVerde) return 'ok';
  return 'neutro';
}

function _mobDreFmt(v) {
  return typeof formatarMoeda === 'function'
    ? formatarMoeda(v)
    : 'R$ ' +
        Number(v || 0)
          .toFixed(2)
          .replace('.', ',');
}

function mobRenderDRE(d) {
  const alvo = document.getElementById('mobDRE');
  if (!alvo || !d || !Array.isArray(d.meses) || !d.meses.length) return;
  _mobDreUltimo = d;
  if (typeof projPreparar !== 'function') return;
  // Projeção do caixa (appliquei-projecao-caixa.js): resposta primeiro, a
  // linha da sobra acumulada, os alertas com o motivo, entra × sai, o que
  // muda, o "E se…?" e o mês a mês — tudo numa coluna, sem arrastar de lado.
  const p = projPreparar(d);
  if (_mobDreAberto == null || _mobDreAberto >= d.meses.length) _mobDreAberto = d.indiceAtual;
  alvo.innerHTML =
    projHtmlTopo(p) +
    projHtmlAlertas(p) +
    projHtmlEntraSai(p) +
    projHtmlOQueMuda(p) +
    '<button type="button" class="pj-btn2 pj-simular" onclick="projSimAbrir()"><i class="ph ph-plus" aria-hidden="true"></i> E se…? Simular uma compra ou entrada</button>' +
    '<section class="mdre-mm" aria-label="Mês a mês"><h3 class="mdre-mm-tit">Mês a mês</h3><div class="mdre-mm-lista" id="mdreLista">' +
    _mobDreLista(d) +
    '</div><p class="pj-nota">A barrinha de cada mês é quanto do que entra já tem destino. Vermelha: sai mais do que entra.</p></section>';
}

var _mobDreAberto = null;

function _mobDreLista(d) {
  const fmt = _mobDreFmt;
  const p = typeof projUltimo !== 'undefined' && projUltimo ? projUltimo : d;
  return d.meses
    .map((m, i) => {
      const v = m.saldoAcumulado || 0;
      const atual = i === d.indiceAtual;
      const aberto = i === _mobDreAberto;
      const comp = typeof projComprometido === 'function' ? projComprometido(m) : 0;
      return (
        '<div class="mdre-mes-item' +
        (atual ? ' atual' : '') +
        (aberto ? ' aberto' : '') +
        (v < 0 ? ' neg' : '') +
        '" id="mdreMes' +
        i +
        '"><button type="button" class="mdre-mes-cab" aria-expanded="' +
        aberto +
        '" onclick="mobDreIrPara(' +
        i +
        ', true)"><span class="mdre-mes-rot">' +
        d.rotulos[i] +
        (atual ? '<em>agora</em>' : '') +
        '</span><span class="pj-comp' +
        (comp > 100 ? ' estourou' : '') +
        '" aria-hidden="true"><i style="width:' +
        Math.min(100, comp) +
        '%"></i></span><span class="mdre-mes-v valor-mascarado ' +
        _mobDreClasse(v, d) +
        '">' +
        fmt(v) +
        '</span><i class="ph ph-caret-down mdre-mes-seta" aria-hidden="true"></i></button>' +
        (aberto && typeof projHtmlMes === 'function' ? projHtmlMes(p, i) : '') +
        '</div>'
      );
    })
    .join('');
}

/** Abre o mês i na lista (tocar na barra ou no mês) e acende a barra dele. */
function mobDreIrPara(i, alternar) {
  const d = _mobDreUltimo;
  if (!d) return;
  _mobDreAberto = alternar && _mobDreAberto === i ? -1 : i;
  const lista = document.getElementById('mdreLista');
  if (lista) lista.innerHTML = _mobDreLista(d);
  _mobDreAcender(i);
  const el = document.getElementById('mdreMes' + i);
  if (el && _mobDreAberto === i && typeof el.scrollIntoView === 'function') {
    try {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (_e) {}
  }
}

function _mobDreAcender(i) {
  document.querySelectorAll('#mobDRE .mdre-barra').forEach((b) => {
    b.classList.toggle('sel', Number(b.dataset.i) === i);
  });
}

// ------------------------------------------------------------
// Extrato no celular: ações por deslize (ou toque)
// ------------------------------------------------------------
// Cada linha trazia três ou quatro ícones de ~20px (pagar, desfazer,
// editar, excluir) lado a lado — pequenos para o dedo e perigosamente
// perto um do outro: excluir ficava a 8px de editar. No celular os mesmos
// botões viram um painel que entra pela direita, com alvos de 56px, ao
// deslizar a linha para a esquerda ou ao tocar nela. Os botões são os
// originais (mesmos onclick); só a apresentação muda.
var _mobExtToque = null;

function _mobExtFecharTodos(exceto) {
  document.querySelectorAll('#extratoUnificado .extrato-item.mob-acoes').forEach((el) => {
    if (el !== exceto) el.classList.remove('mob-acoes');
  });
}

function _mobLigarExtrato() {
  const lista = document.getElementById('extratoUnificado');
  if (!lista || lista.dataset.mobAcoes) return;
  lista.dataset.mobAcoes = '1';

  lista.addEventListener(
    'touchstart',
    (e) => {
      const item = e.target.closest('.extrato-item');
      if (!item || !mobEhCelular()) return;
      const t = e.touches[0];
      _mobExtToque = { item, x: t.clientX, y: t.clientY, decidido: false };
    },
    { passive: true }
  );
  lista.addEventListener(
    'touchmove',
    (e) => {
      if (!_mobExtToque || _mobExtToque.decidido) return;
      const t = e.touches[0];
      const dx = t.clientX - _mobExtToque.x;
      const dy = t.clientY - _mobExtToque.y;
      if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      _mobExtToque.decidido = true;
      if (dx < 0) {
        _mobExtFecharTodos(_mobExtToque.item);
        _mobExtToque.item.classList.add('mob-acoes');
      } else {
        _mobExtToque.item.classList.remove('mob-acoes');
      }
    },
    { passive: true }
  );
  lista.addEventListener('touchend', () => {
    _mobExtToque = null;
  });

  // Toque simples na linha (fora dos botões) abre a edição; o deslize mostra
  // as ações (pagar, editar, excluir) para quem conhece o gesto.
  lista.addEventListener('click', (e) => {
    if (!mobEhCelular()) return;
    if (e.target.closest('button')) {
      _mobExtFecharTodos(null);
      return;
    }
    const item = e.target.closest('.extrato-item');
    if (!item) return;
    // A linha da fatura abre as compras (onclick dela); as ações vêm no deslize.
    if (item.classList.contains('ext-fatura-linha')) {
      _mobExtFecharTodos(null);
      return;
    }
    // Toque na linha abre a edição (com Excluir dentro) — era linha → lápis,
    // e o lápis só aparecia depois de descobrir o toque. Painel aberto pelo
    // deslize fecha com o toque, como antes; linha sem edição (ex.: aporte de
    // investimento) continua mostrando as ações.
    if (item.classList.contains('mob-acoes')) {
      item.classList.remove('mob-acoes');
      return;
    }
    // Toque na linha abre a folha do lançamento (pagar, outro valor, adiar,
    // editar, excluir) — canvas "Detalhe do lançamento".
    const editar = item.querySelector('button[onclick^="prepararEdicao"]');
    const idLinha =
      editar && (editar.getAttribute('onclick').match(/prepararEdicao\('([^']+)'\)/) || [])[1];
    if (
      idLinha &&
      typeof transacoes !== 'undefined' &&
      transacoes.some((x) => String(x.id) === idLinha)
    ) {
      _mobExtFecharTodos(null);
      mobLancFolha(idLinha);
      return;
    }
    if (editar) {
      _mobExtFecharTodos(null);
      editar.click();
      return;
    }
    _mobExtFecharTodos(item);
    item.classList.add('mob-acoes');
  });
}

document.addEventListener('DOMContentLoaded', _mobLigarExtrato);

// Topo do extrato no celular: cinco caixas coloridas lado a lado viravam uma
// faixa deslizante em que só cabiam duas e meia. A pergunta de quem abre o
// extrato é "quanto entrou, quanto gastei, quanto guardei" — três números e
// uma barra que divide o que entrou entre os destinos. Os totais chegam
// prontos de atualizarTelaControle (os mesmos das caixas do desktop).
function mobRenderExtratoResumo(t) {
  const alvo = document.getElementById('mobExtResumo');
  if (!alvo || !t) return;
  const fmt = _mobDreFmt;
  const gastou = (t.despesas || 0) + (t.cartao || 0);
  const guardou = (t.investido || 0) + (t.sonhos || 0);
  const base = Math.max(t.receitas || 0, gastou + guardou, 1);
  const fatias = [
    ['desp', t.despesas, 'Despesas'],
    ['cartao', t.cartao, 'Cartão'],
    ['inv', t.investido, 'Investido'],
    ['sonho', t.sonhos, 'Sonhos'],
  ].filter((f) => (f[1] || 0) > 0.005);
  const barra = fatias
    .map(
      (f) => '<i class="' + f[0] + '" style="width:' + ((f[1] / base) * 100).toFixed(2) + '%"></i>'
    )
    .join('');
  const legenda = fatias
    .map(
      (f) =>
        '<span class="' +
        f[0] +
        '"><b></b>' +
        f[2] +
        ' <strong class="valor-mascarado">' +
        fmt(f[1]) +
        '</strong></span>'
    )
    .join('');
  const col = (rot, v, cls, sinal) =>
    '<div class="mer-col"><span>' +
    rot +
    '</span><strong class="valor-mascarado ' +
    cls +
    '">' +
    (v > 0.005 ? sinal : '') +
    fmt(v) +
    '</strong></div>';
  alvo.innerHTML =
    '<div class="mer-cols">' +
    col('Entrou', t.receitas || 0, 'verde', '+') +
    col('Gastou', gastou, 'vermelho', '−') +
    col('Guardou', guardou, 'azul', '') +
    '</div>' +
    (barra ? '<div class="mer-barra" aria-hidden="true">' + barra + '</div>' : '') +
    (fatias.length > 1 ? '<div class="mer-legenda">' + legenda + '</div>' : '');
}

// ------------------------------------------------------------
// Micro: comportamentos de app
// ------------------------------------------------------------

// Tocar de novo na aba que já está acesa volta ao topo (padrão iOS/Android).
// A troca de aba já faz isso; aqui é o caso de quem rolou e quer subir.
function _mobTocarAbaAtiva(e) {
  const tab = e.target.closest('.mob-tab[data-aba]');
  if (!tab || !tab.classList.contains('ativo')) return;
  const ativa = document.querySelector('.section.ativa');
  // "Mais" aceso com uma tela secundária aberta: aí o toque volta ao Mais.
  if (tab.dataset.aba === MOB_ABA_MAIS && ativa && ativa.id !== MOB_ABA_MAIS) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  const rol = document.querySelector('.main-content');
  if (rol) rol.scrollTo({ top: 0, behavior: 'smooth' });
}

// Ícone da aba acesa preenchido, como nos apps nativos: a forma diz onde a
// pessoa está antes da cor.
function _mobIconesBarra() {
  document.querySelectorAll('#mobTabbar .mob-tab[data-aba] > i').forEach((i) => {
    const acesa = i.parentElement.classList.contains('ativo');
    i.classList.toggle('ph-fill', acesa);
    i.classList.toggle('ph', !acesa);
  });
}

// A barra de status do celular acompanha o fundo do app (claro/escuro), em
// vez de uma faixa verde fixa por cima de uma página clara.
function _mobCorBarraStatus() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta || !mobEhCelular()) return;
  meta.setAttribute('content', document.body.classList.contains('dark') ? '#0b1410' : '#f2f5f2');
}

// A aba do Controle (Resumo/Extrato/Projeção) sobrevive a ir e voltar.
var MOB_SEG_CHAVE = 'appliquei_mob_seg_controle';
function _mobRestaurarSegControle() {
  let salvo = null;
  try {
    salvo = sessionStorage.getItem(MOB_SEG_CHAVE);
  } catch (e) {}
  if (salvo && MOB_SEG_CONTROLE.indexOf(salvo) > -1) mobSegControle(salvo);
}

document.addEventListener('DOMContentLoaded', function () {
  const barra = document.getElementById('mobTabbar');
  if (barra) barra.addEventListener('click', _mobTocarAbaAtiva, true);
  _mobIconesBarra();
  _mobCorBarraStatus();
  _mobRestaurarSegControle();
  new MutationObserver(_mobCorBarraStatus).observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
});

// ------------------------------------------------------------
// Simulador: resultado sempre à vista
// ------------------------------------------------------------
// Os parâmetros ficam no alto e o resultado lá embaixo: quem ajusta o
// aporte não vê o efeito sem rolar. A faixa fixa repete a renda passiva
// (lida do próprio herói, que o simulador já atualiza) e some quando o
// herói está na tela — não há duas respostas visíveis ao mesmo tempo.
function _mobSimAtualizar() {
  const val = document.getElementById('heroRendaMensal');
  const alvo = document.getElementById('mobSimFixoVal');
  const rot = document.getElementById('mobSimFixoRot');
  if (val && alvo) alvo.textContent = (val.textContent || '').trim();
  const tempo = document.getElementById('simTempo');
  const tipo = document.getElementById('simTipoTempo');
  if (rot && tempo) {
    const n = (tempo.value || '').trim();
    const un = tipo && tipo.value === 'mes' ? 'meses' : 'anos';
    rot.textContent = n ? 'Renda passiva em ' + n + ' ' + un : 'Renda passiva estimada';
  }
  // No modo "Planejar minha meta" o herói é outro: a faixa não se aplica.
  const meta = document.getElementById('simModoMeta');
  document.body.classList.toggle('mob-sim-meta', !!(meta && meta.style.display !== 'none'));
  // Cada cálculo também acerta os controles deslizantes e o resumo do INSS
  // (o select do vínculo só é preenchido depois da carga).
  if (typeof mobSimRanges === 'function') mobSimRanges();
  if (typeof _mobSimInssResumo === 'function') _mobSimInssResumo();
}

function mobSimIrResultado() {
  const hero = document.getElementById('simHero');
  if (hero) hero.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function _mobLigarSimulador() {
  const hero = document.getElementById('simHero');
  const faixa = document.getElementById('mobSimFixo');
  const val = document.getElementById('heroRendaMensal');
  if (!hero || !faixa || !val) return;
  // O simulador reescreve o herói inteiro a cada cálculo (o <span> do valor
  // é recriado), então a observação é no bloco, não no número.
  new MutationObserver(_mobSimAtualizar).observe(hero, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  const meta = document.getElementById('simModoMeta');
  if (meta) new MutationObserver(_mobSimAtualizar).observe(meta, { attributes: true });
  ['simTempo', 'simTipoTempo'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', _mobSimAtualizar);
    if (el) el.addEventListener('change', _mobSimAtualizar);
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      (ents) => {
        ents.forEach((en) => faixa.classList.toggle('oculto', en.isIntersecting));
      },
      { threshold: 0.15 }
    ).observe(hero);
  }
  _mobSimAtualizar();
}

document.addEventListener('DOMContentLoaded', _mobLigarSimulador);

// ------------------------------------------------------------
// Simulador: ajustar com o dedo
// ------------------------------------------------------------
// Ao lado de cada número importante há um controle deslizante (só no
// celular). Ele escreve no campo de sempre e recalcula pelo mesmo caminho;
// digitar no campo move o controle. Os limites da taxa e do prazo seguem a
// unidade escolhida (% ao mês ou ao ano, anos ou meses).
var MOB_SIM_LIMITES = {
  simCapital: [0, 200000, 1000],
  simAporte: [0, 10000, 50],
  metaValor: [10000, 5000000, 10000],
  metaCapital: [0, 200000, 1000],
  simTaxa: { un: 'simTipoTaxa', mes: [0.1, 2, 0.05], ano: [1, 25, 0.5] },
  metaTaxa: { un: 'metaTipoTaxa', mes: [0.1, 2, 0.05], ano: [1, 25, 0.5] },
  simTempo: { un: 'simTipoTempo', ano: [1, 50, 1], mes: [1, 600, 1] },
  metaPrazo: { un: 'metaTipoPrazo', ano: [1, 50, 1], mes: [1, 600, 1] },
};

function _mobSimLimites(id) {
  const lim = MOB_SIM_LIMITES[id];
  if (!lim || Array.isArray(lim)) return lim;
  const un = document.getElementById(lim.un);
  return lim[un && un.value === 'ano' ? 'ano' : 'mes'] || lim.ano;
}

function _mobSimValorDoCampo(campo) {
  return campo.dataset.brl === '1' ? parseBRL(campo.value) : Number(campo.value) || 0;
}

function _mobSimRecalcular(id) {
  if (id.indexOf('meta') === 0) {
    if (typeof calcularMeta === 'function') calcularMeta();
  } else if (typeof calcularSimulador === 'function') calcularSimulador();
}

/** Copia o valor de cada campo para o seu controle (e os limites da unidade). */
function mobSimRanges() {
  document.querySelectorAll('#simulador .mob-sim-range').forEach((r) => {
    const campo = document.getElementById(r.dataset.mobRangeDe);
    const lim = _mobSimLimites(r.dataset.mobRangeDe);
    if (!campo || !lim) return;
    r.min = String(lim[0]);
    r.max = String(lim[1]);
    r.step = String(lim[2]);
    r.value = String(Math.max(lim[0], Math.min(lim[1], _mobSimValorDoCampo(campo))));
  });
  document.querySelectorAll('#simulador .mob-sim-prazos').forEach((box) => {
    const campo = document.getElementById(box.dataset.mobPrazoDe);
    const un = document.getElementById(MOB_SIM_LIMITES[box.dataset.mobPrazoDe].un);
    const anos = un && un.value === 'ano' ? Number(campo && campo.value) : NaN;
    box.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', Number(b.dataset.anos) === anos ? 'true' : 'false');
    });
  });
}

function _mobSimDoControle(r) {
  const id = r.dataset.mobRangeDe;
  const campo = document.getElementById(id);
  if (!campo) return;
  const v = Number(r.value);
  if (campo.dataset.brl === '1') setValorBRLInput(campo, v);
  else campo.value = String(Math.round(v * 100) / 100);
  _mobSimRecalcular(id);
  mobSimRanges();
}

function _mobSimPrazo(botao) {
  const box = botao.closest('.mob-sim-prazos');
  const id = box && box.dataset.mobPrazoDe;
  const campo = id && document.getElementById(id);
  if (!campo) return;
  const un = document.getElementById(MOB_SIM_LIMITES[id].un);
  if (un) un.value = 'ano';
  campo.value = botao.dataset.anos;
  campo.dispatchEvent(new Event('input'));
  _mobSimRecalcular(id);
  mobSimRanges();
}

/** O bloco do INSS recolhido, com o resumo do que está valendo. */
function mobSimInss() {
  const b = document.getElementById('mobSimInss');
  if (!b) return;
  b.setAttribute('aria-expanded', b.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
}

function _mobSimInssResumo() {
  const alvo = document.getElementById('mobSimInssResumo');
  const vinc = document.getElementById('simVinculo');
  const renda = document.getElementById('simRenda');
  if (!alvo) return;
  const opt = vinc && vinc.options[vinc.selectedIndex];
  const nome = opt ? opt.textContent.split(/\s+[—(]/)[0].trim() : '';
  const r = renda ? parseBRL(renda.value) : 0;
  alvo.textContent =
    (nome ? nome + ' · ' : '') +
    'renda de ' +
    (typeof formatarMoeda === 'function' ? formatarMoeda(r) : r);
}

document.addEventListener('input', function (e) {
  const t = e.target;
  if (!t || !t.closest || !t.closest('#simulador')) return;
  if (t.classList && t.classList.contains('mob-sim-range')) return _mobSimDoControle(t);
  if (MOB_SIM_LIMITES[t.id]) mobSimRanges();
  if (t.id === 'simRenda') _mobSimInssResumo();
});
document.addEventListener('change', function (e) {
  const t = e.target;
  if (!t || !t.closest || !t.closest('#simulador')) return;
  if (/TipoTaxa$|TipoTempo$|TipoPrazo$/.test(t.id)) mobSimRanges();
  if (t.id === 'simVinculo') _mobSimInssResumo();
});
document.addEventListener('click', function (e) {
  const b = e.target.closest && e.target.closest('#simulador .mob-sim-prazos button');
  if (b) _mobSimPrazo(b);
});

// ------------------------------------------------------------
// Início no celular: resposta primeiro, detalhe depois
// ------------------------------------------------------------
// O Resumo era o desktop em fila: dois cartões-herói, cinco indicadores,
// termômetro, composição — e a pergunta de quem abre o app ("quanto ainda
// posso gastar?") ficava diluída. No celular o topo vira um cartão só, com
// a sobra (o que entrou menos o que saiu) e três anéis (gastos, investido,
// sonhos). Logo abaixo, os atalhos do dia a dia. Os blocos
// originais continuam na tela, reordenados pelo CSS; o que este código
// desenha é resumo e atalho, e todo botão chama a função que o desktop usa.
//
// Os números chegam prontos de atualizarTelaControle: nada é recalculado.

var _mobDreUltimo = null;
var _mobAnelRealce = null;

var MOB_ANEIS = [
  { k: 'gastos', nome: 'Gastos', cor: 'var(--cor-primaria)', r: 56 },
  { k: 'investido', nome: 'Investido', cor: 'var(--cor-info)', r: 41 },
  { k: 'sonhos', nome: 'Sonhos', cor: 'var(--cor-patrimonio)', r: 26 },
];

function _mobEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _mobPct(v) {
  return (Math.round(v * 10) / 10).toString().replace('.', ',') + '%';
}

function _mobSaudacao() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/**
 * Os três anéis. Cada um enche até a sua regra: gastos até o teto de 60% da
 * receita (a regra do termômetro), investido até os 30% do Relatório mensal
 * e sonhos até o total das metas. Passar da regra fecha o anel; a cor é que
 * diz se passar é bom (investido) ou ruim (gastos).
 */
function _mobAneis(d) {
  const r = d.resumo || {};
  const receita = Number(r.receita) || 0;
  const gastos = (Number(r.despFixa) || 0) + (Number(r.despVar) || 0) + (Number(r.cartao) || 0);
  const investido = (Number(r.invFixo) || 0) + (Number(r.invVar) || 0);
  const pGastos = receita > 0 ? (gastos / receita) * 100 : 0;
  const pInv = receita > 0 ? (investido / receita) * 100 : 0;
  // Sonhos na mesma régua das outras duas linhas: o que foi para os sonhos
  // NESTE mês, sobre o que entrou. Antes era o progresso de todas as metas
  // desde sempre (guardado ÷ alvo) — ao lado de Gastos e Investido, que são do
  // mês, o 6,4% de cima brigava com o "36% da receita" do card de baixo.
  // O anel enche até o plano mensal somado dos sonhos ainda em curso.
  const metas = Array.isArray(d.sonhos) ? d.sonhos.filter((s) => s && !s.arquivado) : [];
  const sonhoMes = Number(r.sonho) || 0;
  const pSonhos = receita > 0 ? (sonhoMes / receita) * 100 : 0;
  const plano = metas
    .filter((s) => (Number(s.valorAtual) || 0) < (Number(s.valorTotal) || 0))
    .reduce((a, s) => a + (Number(s.aporteMensalPlano) || 0), 0);
  return {
    gastos: {
      frac: receita > 0 ? pGastos / 60 : 0,
      val: receita > 0 ? _mobPct(pGastos) : '—',
      sub:
        receita > 0
          ? pGastos <= 60
            ? 'dentro dos 60% do que entrou'
            : 'passou dos 60% do que entrou'
          : 'sem receita no mês',
      alerta: pGastos > 60,
    },
    investido: {
      frac: receita > 0 ? pInv / 30 : 0,
      val: receita > 0 ? _mobPct(pInv) : '—',
      sub: pInv >= 30 ? 'meta de 30% batida' : 'meta: 30% do que entrou',
    },
    sonhos: {
      frac: plano > 0 ? sonhoMes / plano : sonhoMes > 0 ? 1 : 0,
      val: receita > 0 && (metas.length || sonhoMes > 0) ? _mobPct(pSonhos) : '—',
      sub: !metas.length
        ? 'nenhum sonho cadastrado'
        : plano > 0
          ? sonhoMes >= plano
            ? 'plano do mês cumprido'
            : Math.round((sonhoMes / plano) * 100) + '% do plano do mês'
          : 'do que entrou',
    },
  };
}

function _mobSvgAneis(a) {
  const circ = MOB_ANEIS.map((x) => {
    const c = 2 * Math.PI * x.r;
    const f = Math.max(0, Math.min(1, a[x.k].frac || 0));
    const cor = x.k === 'gastos' && a.gastos.alerta ? 'var(--cor-erro)' : x.cor;
    const apagado =
      (f <= 0 ? ' vazio' : '') + (_mobAnelRealce && _mobAnelRealce !== x.k ? ' apagado' : '');
    return (
      '<circle class="mi-trilho" cx="66" cy="66" r="' +
      x.r +
      '"></circle>' +
      '<circle class="mi-arco' +
      apagado +
      '" data-anel="' +
      x.k +
      '" cx="66" cy="66" r="' +
      x.r +
      '" stroke="' +
      cor +
      '" stroke-dasharray="' +
      (c * f).toFixed(1) +
      ' ' +
      c.toFixed(1) +
      '"></circle>'
    );
  }).join('');
  return '<svg class="mi-aneis" viewBox="0 0 132 132" aria-hidden="true">' + circ + '</svg>';
}

/** Realça um anel e apaga os outros; tocar de novo desfaz. Só visual. */
function mobAnelRealcar(k) {
  _mobAnelRealce = _mobAnelRealce === k ? null : k;
  document.querySelectorAll('#mobInicio .mi-arco').forEach((c) => {
    c.classList.toggle('apagado', !!_mobAnelRealce && c.dataset.anel !== _mobAnelRealce);
  });
  document.querySelectorAll('#mobInicio .mi-leg').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.anel === _mobAnelRealce ? 'true' : 'false');
  });
}

/** Atalhos do Início: cada um abre o mesmo formulário que o desktop. */
function mobAcaoRapida(tipo) {
  if (tipo === 'aporte') {
    if (typeof cadastrarEm === 'function') cadastrarEm('investimento');
    return;
  }
  if (tipo === 'transferir') {
    if (typeof abrirTransferenciaModal === 'function') abrirTransferenciaModal();
    return;
  }
  if (tipo === 'pagar') {
    mobIrVencimentos();
    return;
  }
  if (typeof abrirPainelLancamento === 'function') abrirPainelLancamento();
  const chip = { despesa: 'saida', receita: 'entrada', cartao: 'cartao' }[tipo];
  if (chip && typeof selecionarChipTipo === 'function') selecionarChipTipo(chip);
}

/** "Pagar": abre os vencimentos do mês e leva até eles. */
function mobIrVencimentos() {
  const alvo = document.getElementById('mobProximos');
  if (!alvo || !alvo.innerHTML.trim()) {
    if (typeof mostrarToast === 'function') mostrarToast('Nada a pagar neste mês.', 'info');
    return;
  }
  mobRevelar(alvo);
}

/**
 * Mostra um elemento do Controle que pode estar noutra aba do celular. Os
 * avisos de "O que notamos" mandam para o extrato ou para os vencimentos;
 * no celular eles moram em abas diferentes, e rolar até um bloco escondido
 * não leva a lugar nenhum.
 */
function mobRevelar(el) {
  if (!el || !mobEhCelular()) return;
  // No celular os vencimentos moram em "Próximos dias".
  if (el.id === 'painelVencimentos') el = document.getElementById('mobProximos') || el;
  const bloco = el.closest('#controle [data-mob-aba]');
  if (bloco) {
    const sec = document.getElementById('controle');
    if (sec && sec.dataset.mobAbaAtiva !== bloco.dataset.mobAba)
      mobSegControle(bloco.dataset.mobAba);
  }
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
}

/** Movimentações recentes do mês em visão: as últimas já realizadas. */
function _mobMovimentos(mes, ano) {
  if (typeof transacoes === 'undefined' || !Array.isArray(transacoes)) return [];
  const agora = Date.now();
  return transacoes
    .filter((t) => t && t.mes === mes && t.ano === ano && !t.transferenciaId)
    .filter((t) => t.pago !== false && (!t.data || new Date(t.data).getTime() <= agora))
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
    .slice(0, 5);
}

function _mobLinhaMovimento(t) {
  const entrada = t.categoria === 'receita' || t.categoria === 'resgate_investimento';
  const cat =
    t.categoriaDespesa && typeof rotuloCategoriaDespesa === 'function'
      ? rotuloCategoriaDespesa(t.categoriaDespesa)
      : entrada
        ? 'Receita'
        : t.categoria === 'cartao_credito'
          ? 'Cartão'
          : /invest|aporte/.test(t.categoria || '')
            ? 'Investimento'
            : 'Despesa';
  const catTxt = cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : '';
  const dia = t.data
    ? new Date(t.data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    : '';
  // Tocar na movimentação abre a edição dela (antes: Extrato → linha → lápis).
  return (
    '<li class="mi-mov" role="button" tabindex="0" onclick="prepararEdicao(\'' +
    _mobEsc(String(t.id)) +
    '\')"><span class="mi-mov-ic' +
    (entrada ? ' in' : '') +
    '"><i class="ph ' +
    (entrada
      ? 'ph-arrow-down-left'
      : t.categoria === 'cartao_credito'
        ? 'ph-credit-card'
        : 'ph-arrow-up-right') +
    '"></i></span><span class="mi-mov-txt"><b>' +
    _mobEsc(t.descricao || 'Lançamento') +
    '</b><small>' +
    _mobEsc(catTxt) +
    (dia ? ' · ' + _mobEsc(dia) : '') +
    '</small></span><span class="mi-mov-val valor-mascarado' +
    (entrada ? ' in' : '') +
    '">' +
    (entrada ? '+ ' : '− ') +
    _mobEsc(_mobDreFmt(Math.abs(Number(t.valor) || 0))) +
    '</span></li>'
  );
}

/** Cartão "Próximos meses": o resultado acumulado daqui em diante. */
function _mobCartaoProjecao() {
  const d = _mobDreUltimo;
  if (!d || !Array.isArray(d.meses) || !d.meses.length) return '';
  const ini = Math.max(0, d.indiceAtual || 0);
  const vals = d.meses.slice(ini, ini + 12).map((m) => m.saldoAcumulado || 0);
  const rots = d.rotulos.slice(ini, ini + 12);
  if (!vals.length) return '';
  const iNeg = vals.findIndex((v) => v < 0);
  const fim = rots[rots.length - 1];
  const aviso =
    iNeg > -1
      ? '<span class="mi-proj-aviso neg"><i class="ph-fill ph-warning-circle"></i><span>Em <b>' +
        _mobEsc(rots[iNeg]) +
        '</b> o caixa fica negativo: <b class="valor-mascarado">' +
        _mobEsc(_mobDreFmt(vals[iNeg])) +
        '</b>.</span></span>'
      : '<span class="mi-proj-aviso"><i class="ph-fill ph-check-circle"></i><span>Sem mês negativo até ' +
        _mobEsc(fim) +
        '. O menor resultado é <b class="valor-mascarado">' +
        _mobEsc(_mobDreFmt(Math.min(...vals))) +
        '</b>.</span></span>';
  const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const barras = vals
    .map((v, i) => {
      const h = Math.max(6, Math.round((Math.abs(v) / maxAbs) * 100));
      return (
        '<span class="mi-proj-col"><span class="mi-proj-area"><span class="mi-proj-barra ' +
        _mobDreClasse(v, d) +
        (i === 0 ? ' atual' : '') +
        '" style="height:' +
        h +
        '%"></span></span><span class="mi-proj-rot">' +
        _mobEsc(
          String(rots[i] || '')
            .charAt(0)
            .toUpperCase()
        ) +
        '</span></span>'
      );
    })
    .join('');
  return (
    '<button type="button" class="mi-card mi-proj" onclick="mobSegControle(\'projecao\')">' +
    '<span class="mi-tit-linha"><span class="mi-h2">Próximos meses</span><span class="mi-link">Projeção <i class="ph ph-caret-right"></i></span></span>' +
    aviso +
    '<span class="mi-proj-barras" aria-hidden="true">' +
    barras +
    '</span></button>'
  );
}

/**
 * Desenha o topo e o fim do Início no celular. `d` vem de
 * atualizarTelaControle com os totais do mês já calculados.
 */
/**
 * "Para onde foi" dentro do cartão do topo (canvas): a barra do mês e uma
 * linha por destino com valor e fatia do que entrou. Os números são os do
 * resumo que o Controle já calculou (d.resumo = calcularResumoMes).
 */
function _mobDestinoNoCartao(d) {
  const r = d && d.resumo;
  if (!r) return '';
  const n = (v) => Number(v) || 0;
  const entrou = n(r.receita) + n(r.resgate);
  const partes = [
    ['Fixas', n(r.despFixa), '#f97316'],
    ['Variáveis', n(r.despVar), '#e11d48'],
    ['Cartão', n(r.cartao), '#f59e0b'],
    ['Investido', n(r.invFixo) + n(r.invVar), '#2563eb'],
    ['Sonhos', n(r.sonho), '#7c3aed'],
  ];
  const saiu = partes.reduce((a, p) => a + p[1], 0);
  partes.push(['Sobra', Math.max(0, entrou - saiu), '#10b981']);
  const visiveis = partes.filter((p) => p[1] > 0.005);
  if (!visiveis.length) return '';
  const base = Math.max(entrou, saiu) || 1;
  const aPagar = typeof saidasAPagarDoMes === 'function' ? saidasAPagarDoMes(d.mes, d.ano) : 0;
  return (
    (aPagar > 0.005
      ? '<p class="mi-falta">falta pagar <b class="valor-mascarado">' +
        _mobEsc(_mobDreFmt(aPagar)) +
        '</b> este mês</p>'
      : '') +
    '<div class="mc-barra mi-destino-barra" aria-hidden="true">' +
    visiveis
      .map(
        (p) =>
          '<span style="background:' +
          p[2] +
          ';width:' +
          ((p[1] / base) * 100).toFixed(2) +
          '%"></span>'
      )
      .join('') +
    '</div><div class="mi-destino">' +
    visiveis
      .map(
        (p) =>
          '<div><i style="background:' +
          p[2] +
          '"></i><span>' +
          p[0] +
          '</span><b class="valor-mascarado">' +
          _mobEsc(_mobDreFmt(p[1])) +
          '</b><small>' +
          (entrou > 0 ? Math.round((p[1] / entrou) * 100) + '%' : '') +
          '</small></div>'
      )
      .join('') +
    '</div>'
  );
}

/** "O que notamos" em cartão: o primeiro aviso, com o valor e o normal. */
function _mobNotamosCartao() {
  const lista = _mobInsights();
  if (!lista.length || typeof insightsUiApresentar !== 'function') return '';
  const ap = insightsUiApresentar(lista[0]) || {};
  return (
    '<section class="mi-card mi-notamos"><span class="mi-notamos-rot">O que notamos' +
    (lista.length > 1 ? ' · 1 de ' + lista.length : '') +
    '</span><b>' +
    _mobEsc(ap.titulo || '') +
    '</b>' +
    (ap.frase ? '<p>' + ap.frase + '</p>' : '') +
    '<button type="button" class="mi-link" onclick="mobStoryAbrir(0)">Ver detalhes <i class="ph ph-caret-right"></i></button></section>'
  );
}

function mobRenderInicio(d) {
  const topo = document.getElementById('mobInicio');
  const fim = document.getElementById('mobInicioFim');
  const sec = document.getElementById('controle');
  if (!topo || !fim || !sec || !d) return;

  const hoje = new Date();
  const noMes = d.mes === hoje.getMonth() && d.ano === hoje.getFullYear();
  sec.classList.toggle('mob-fora-do-mes', !noMes);
  const saud = document.getElementById('mobSaudacao');
  if (saud) saud.textContent = _mobSaudacao();

  // O número é a sobra: o que entrou menos o que saiu, mais o que sobrou dos
  // meses anteriores (obterSaldoCarregadoParaMes, que soma em cadeia desde o
  // primeiro lançamento). Ele se chamava "Livre para gastar" e vinha com
  // "≈ R$ X por dia até o fim do mês" — mas a sobra acumulada carrega todo
  // mês em que alguma despesa não foi lançada, e com o tempo vira quase tudo o
  // que entrou. Ler isso como orçamento diário levava a gastar dinheiro que
  // não existe (feedback de 23/10/2026). Agora o rótulo diz o que o
  // número é, e a linha de baixo diz de onde ele vem.
  //
  // Desde a reorganização de nov/2026 o número grande é a sobra DO MÊS, a
  // mesma do web: a acumulada só cresce e escondia um mês ruim atrás de meses
  // bons. Ela continua no cartão, na linha de baixo (_mobLinhaCarregado).
  const livre = (Number(d.saldoLivre) || 0) - (Number(d.carregado) || 0);
  const nomeMes = new Date(d.ano, d.mes, 1).toLocaleDateString('pt-BR', { month: 'long' });
  const rotulo = 'Sobra de ' + nomeMes;
  const origem =
    livre < 0
      ? 'Saiu mais do que entrou.'
      : Math.abs(livre) < 0.005
        ? 'Tudo o que entrou já tem destino.'
        : 'O que entrou menos o que sai' +
          (noMes ? ' neste mês' : ' no mês') +
          ', já contando o que falta pagar.';

  const scoreEl = document.getElementById('termChipScore');
  const rotEl = document.getElementById('termChipRotulo');
  const score = scoreEl ? (scoreEl.textContent || '').trim() : '';
  const rot = rotEl ? (rotEl.textContent || '').trim() : '';
  const termo =
    '<button type="button" class="mi-termo" onclick="abrirRelatorioDoMesVisao()">' +
    '<span class="mi-termo-chip"><i class="ph ph-thermometer"></i> ' +
    _mobEsc(score && score !== '—' ? score + ' · ' + rot : rot || '—') +
    '</span><span class="mi-termo-txt">Relatório do mês</span><i class="ph ph-caret-right"></i></button>';

  const conta =
    d.saldoConta == null
      ? ''
      : '<button type="button" class="mi-conta" onclick="ppNavegarPara(\'meu_patrimonio\')">' +
        '<i class="ph ph-bank"></i><span>Saldo em conta <b class="valor-mascarado' +
        (d.saldoConta < 0 ? ' neg' : '') +
        '">' +
        _mobEsc(_mobDreFmt(d.saldoConta)) +
        '</b></span><span class="mi-link">Por banco <i class="ph ph-caret-right"></i></span></button>';

  const atalhos = [
    ['despesa', 'Despesa', 'ph-minus', 'erro'],
    ['receita', 'Receita', 'ph-plus', 'ok'],
    ['pagar', 'Pagar', 'ph-check', 'ambar'],
    ['aporte', 'Aporte', 'ph-trend-up', 'info'],
    ['transferir', 'Transferir', 'ph-arrows-left-right', 'neutro'],
  ]
    .map(
      (x) =>
        '<button type="button" class="mi-atalho" onclick="mobAcaoRapida(\'' +
        x[0] +
        '\')"><span class="mi-atalho-ic ' +
        x[3] +
        '"><i class="ph-bold ' +
        x[2] +
        '"></i></span><span>' +
        x[1] +
        '</span></button>'
    )
    .join('');

  topo.innerHTML =
    '<section class="mi-card mi-hero">' +
    termo +
    '<div class="mi-hero-corpo"><div class="mi-hero-num">' +
    '<span class="mi-rot">' +
    rotulo +
    '</span><span class="mi-livre valor-mascarado' +
    (livre < 0 ? ' neg' : '') +
    (_mobDreFmt(livre).length > 10 ? ' longo' : '') +
    '">' +
    _mobEsc(_mobDreFmt(livre)) +
    '</span><span class="mi-dia">' +
    origem +
    '</span></div>' +
    '</div>' +
    _mobDestinoNoCartao(d) +
    _mobLinhaCarregado(d) +
    conta +
    '</section>' +
    '<nav class="mi-atalhos" aria-label="Atalhos">' +
    atalhos +
    '</nav>' +
    // Receitas, despesas, cartão, investimentos e sonhos: lista vertical.
    (d.tiposHtml
      ? '<section class="mi-card mi-tipos" aria-label="O mês por tipo"><div class="mi-tit-linha"><h2 class="mi-h2">O mês por tipo</h2></div>' +
        d.tiposHtml +
        '</section>'
      : '');

  // "Para onde foi" entrou no cartão do topo (_mobDestinoNoCartao); a
  // projeção mora na aba Projeção. Ordem do canvas: O que notamos, Falta
  // pagar, Por categoria, Movimentações.
  const comp = document.getElementById('mobComposicao');
  if (comp) comp.innerHTML = '';
  const prox = document.getElementById('mobProximos');
  if (prox)
    prox.innerHTML =
      _mobNotamosCartao() +
      _mobProximos(d.vencimentos, d.hojeStr) +
      // "Para onde foi" completo (todas as categorias, com "Ver todas"), como
      // era antes; "Destino do dinheiro" mostra fixas, variáveis, cartão etc.
      _mobComposicao(d.composicao);

  const movs = _mobMovimentos(d.mes, d.ano);
  fim.innerHTML =
    '<section class="mi-movs"><div class="mi-tit-linha"><h2 class="mi-h2">Movimentações</h2>' +
    '<button type="button" class="mi-link" onclick="mobSegControle(\'extrato\')">Extrato completo <i class="ph ph-caret-right"></i></button></div>' +
    (movs.length
      ? '<ul class="mi-mov-lista">' + movs.map(_mobLinhaMovimento).join('') + '</ul>'
      : '<p class="mi-vazio">Nenhum lançamento realizado neste mês ainda.</p>') +
    '</section>';
}

// ------------------------------------------------------------
// "O que notamos" em histórias
// ------------------------------------------------------------
// No desktop os avisos são uma grade de cartões. No celular eles viram uma
// fileira de círculos no topo — o formato que todo mundo já sabe usar — e
// cada um abre em tela cheia com o MESMO cartão do desktop (insightsUiCard),
// com os mesmos botões. A grade some só quando há histórias para mostrar.

var _mobStoryAtual = -1;

function _mobInsights() {
  return typeof insightsUiUltimo !== 'undefined' &&
    insightsUiUltimo &&
    Array.isArray(insightsUiUltimo.insights)
    ? insightsUiUltimo.insights
    : [];
}

/** Chamada no fim de insightsUiRenderizar: refaz a fileira de histórias. */
function mobRenderStories() {
  const host = document.getElementById('painelInsights');
  if (!host) return;
  const lista = _mobInsights();
  const velha = host.querySelector('.mob-stories');
  if (velha) velha.remove();
  host.classList.toggle('mob-com-stories', lista.length > 0);
  if (!lista.length) {
    mobStoryFechar();
    return;
  }
  const itens = lista
    .map((ins, i) => {
      const ap = typeof insightsUiApresentar === 'function' ? insightsUiApresentar(ins) : null;
      if (!ap) return '';
      const sev =
        (typeof INSIGHTS_UI_SEVERIDADE !== 'undefined' && INSIGHTS_UI_SEVERIDADE[ins.severidade]) ||
        {};
      return (
        '<button type="button" class="mob-story-bola ' +
        _mobEsc(sev.classe || '') +
        '" onclick="mobStoryAbrir(' +
        i +
        ')"><span class="mob-story-anel"><span class="mob-story-ic"><i class="' +
        _mobEsc(ap.icone) +
        '"></i></span></span><span class="mob-story-nome">' +
        _mobEsc(ap.titulo) +
        '</span></button>'
      );
    })
    .join('');
  const fila = document.createElement('div');
  fila.className = 'mob-stories';
  fila.setAttribute('role', 'list');
  fila.innerHTML = itens;
  const cab = host.querySelector('.ins-painel-head');
  if (cab && cab.parentNode) cab.parentNode.insertBefore(fila, cab.nextSibling);
  else host.prepend(fila);
  if (_mobStoryAtual > -1) mobStoryAbrir(Math.min(_mobStoryAtual, lista.length - 1));
}

function mobStoryAbrir(i) {
  const lista = _mobInsights();
  const tela = document.getElementById('mobStory');
  if (!tela || !lista.length || typeof insightsUiCard !== 'function') return;
  i = Math.max(0, Math.min(lista.length - 1, Number(i) || 0));
  _mobStoryAtual = i;
  const ins = lista[i];
  const serie =
    typeof insightsUiSerie === 'function' && typeof transacoes !== 'undefined'
      ? insightsUiSerie(ins, transacoes)
      : null;
  const barras = lista
    .map(
      (_, k) =>
        '<span class="mob-story-prog' + (k < i ? ' visto' : k === i ? ' atual' : '') + '"></span>'
    )
    .join('');
  tela.innerHTML =
    '<div class="mob-story-topo"><div class="mob-story-progs">' +
    barras +
    '</div><div class="mob-story-cab"><span>O que notamos · ' +
    (i + 1) +
    ' de ' +
    lista.length +
    '</span><button type="button" class="mob-story-fechar" aria-label="Fechar" onclick="mobStoryFechar()"><i class="ph ph-x"></i></button></div></div>' +
    '<div class="mob-story-corpo" onclick="mobStoryToqueVazio(event)">' +
    insightsUiCard(ins, serie) +
    '</div>' +
    '<button type="button" class="mob-story-zona ant" aria-label="Anterior" onclick="mobStoryPassar(-1)"' +
    (i === 0 ? ' disabled' : '') +
    '></button>' +
    '<button type="button" class="mob-story-zona prox" aria-label="Próximo" onclick="mobStoryPassar(1)"></button>';
  tela.hidden = false;
  document.body.classList.add('mob-story-aberta');
}

// O corpo cobre as zonas de toque (para poder rolar); um toque no espaço
// vazio em volta do aviso continua passando para o anterior/próximo.
function mobStoryToqueVazio(ev) {
  if (!ev || ev.target !== ev.currentTarget) return;
  const x = ev.clientX / (window.innerWidth || 1);
  if (x < 0.35) {
    if (_mobStoryAtual > 0) mobStoryPassar(-1);
  } else if (x > 0.65) mobStoryPassar(1);
}

function mobStoryPassar(delta) {
  const n = _mobInsights().length;
  const prox = _mobStoryAtual + delta;
  if (prox >= n || prox < 0) mobStoryFechar();
  else mobStoryAbrir(prox);
}

function mobStoryFechar() {
  const tela = document.getElementById('mobStory');
  _mobStoryAtual = -1;
  if (tela) {
    tela.hidden = true;
    tela.innerHTML = '';
  }
  document.body.classList.remove('mob-story-aberta');
}

// Agir num aviso leva a outro lugar do Controle (extrato, vencimentos): a
// história fecha para mostrar o destino. Dispensar refaz a fileira, e a
// história segue para o próximo aviso.
document.addEventListener('click', function (e) {
  const tela = document.getElementById('mobStory');
  if (!tela || tela.hidden || !tela.contains(e.target)) return;
  if (e.target.closest('.ins-btn--primario')) setTimeout(mobStoryFechar, 0);
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && document.body.classList.contains('mob-story-aberta')) mobStoryFechar();
});

// ------------------------------------------------------------
// Folha que sobe de baixo
// ------------------------------------------------------------
// As confirmações do Início (ajustar o saldo que veio do mês anterior,
// baixar uma conta) abrem aqui, na zona do polegar, em vez do prompt() do
// navegador ou de um campo espremido dentro do cartão.

function mobFolhaAbrir(html, rotulo) {
  const f = document.getElementById('mobFolha');
  if (!f) return;
  f.innerHTML =
    '<button type="button" class="mob-folha-fundo" aria-label="Fechar" onclick="mobFolhaFechar()"></button>' +
    '<div class="mob-folha-painel" role="dialog" aria-modal="true" aria-label="' +
    _mobEsc(rotulo || '') +
    '"><span class="mob-folha-alca" aria-hidden="true"></span>' +
    html +
    '</div>';
  f.hidden = false;
  document.body.classList.add('mob-folha-aberta');
  const campo = f.querySelector('input');
  if (campo) setTimeout(() => campo.focus({ preventScroll: true }), 250);
}

function mobFolhaFechar() {
  const f = document.getElementById('mobFolha');
  if (f) {
    f.hidden = true;
    f.innerHTML = '';
  }
  document.body.classList.remove('mob-folha-aberta');
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && document.body.classList.contains('mob-folha-aberta')) mobFolhaFechar();
});

// ------------------------------------------------------------
// Saldo que veio do mês anterior
// ------------------------------------------------------------
var MOB_MESES_CURTOS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

function _mobLinhaCarregado(d) {
  const v = Number(d.carregado) || 0;
  if (Math.abs(v) < 0.005 && !d.carregadoManual) return '';
  const ant = MOB_MESES_CURTOS[(d.mes + 11) % 12];
  return (
    '<button type="button" class="mi-carregado" onclick="editarSaldoMesAnterior(' +
    d.mes +
    ',' +
    d.ano +
    ')"><i class="ph ph-arrow-elbow-down-right"></i><span>' +
    (d.carregadoManual
      ? 'Com o saldo de ' + ant + ' ajustado, acumulada '
      : 'Acumulada com o que sobrou até ' + ant + ': ') +
    '<b class="valor-mascarado' +
    ((Number(d.saldoLivre) || 0) < 0 ? ' neg' : '') +
    '">' +
    _mobEsc(_mobDreFmt(Number(d.saldoLivre) || 0)) +
    '</b></span>' +
    (d.carregadoManual
      ? '<span class="mi-carregado-tag">Manual</span>'
      : '<span class="mi-link">Ajustar</span>') +
    '</button>'
  );
}

/** Chamada por editarSaldoMesAnterior no celular. */
function mobAbrirSaldoAnterior(mes, ano) {
  if (typeof obterMapaSaldoCarregado !== 'function') return;
  const reg = obterMapaSaldoCarregado()[chaveMes(mes, ano)];
  const manual = !!(reg && reg.manual);
  // O automático é o fechamento do mês anterior, a mesma conta que
  // obterSaldoCarregadoParaMes faz quando não há ajuste.
  const auto = resultadoAcumuladoAteMes(mes === 0 ? 11 : mes - 1, mes === 0 ? ano - 1 : ano);
  const atual = obterSaldoCarregadoParaMes(mes, ano);
  const ant = MOB_MESES_CURTOS[(mes + 11) % 12];
  const html =
    '<div class="mf-cab"><p class="mf-sobre">Saldo de ' +
    ant +
    '</p><h3 class="mf-tit">O que sobrou em ' +
    ant +
    ' entra em ' +
    MOB_MESES_CURTOS[mes] +
    '</h3><p class="mf-txt">É automático. Se o valor real foi outro, por um gasto que ficou sem lançar, informe aqui.</p></div>' +
    '<div class="mf-opcoes" id="mobSaldoOpcoes" data-modo="' +
    (manual ? 'manual' : 'auto') +
    '">' +
    '<button type="button" class="mf-opcao" data-op="auto" onclick="mobSaldoModo(\'auto\')"><span class="mf-radio"></span><span class="mf-opcao-txt"><b>Fechamento de ' +
    ant +
    '</b><small>calculado pelos lançamentos</small></span><span class="mf-opcao-val valor-mascarado">' +
    _mobEsc(_mobDreFmt(auto)) +
    '</span></button>' +
    '<button type="button" class="mf-opcao" data-op="manual" onclick="mobSaldoModo(\'manual\')"><span class="mf-radio"></span><span class="mf-opcao-txt"><b>Outro valor</b><small>o que de fato sobrou</small></span></button>' +
    '<label class="mf-campo" for="mobSaldoValor">Valor que sobrou em ' +
    ant +
    '<span class="mf-campo-caixa"><span>R$</span><input type="text" inputmode="decimal" data-brl="1" id="mobSaldoValor" value="' +
    _mobEsc(typeof formatarBRLInput === 'function' ? formatarBRLInput(atual) : String(atual)) +
    '" oninput="aplicarMascaraBRL(this)"></span></label></div>' +
    '<button type="button" class="mf-btn1" onclick="mobSaldoSalvar(' +
    mes +
    ',' +
    ano +
    ')">Salvar</button>';
  mobFolhaAbrir(html, 'Saldo de ' + ant);
}

function mobSaldoModo(modo) {
  const op = document.getElementById('mobSaldoOpcoes');
  if (op) op.dataset.modo = modo === 'manual' ? 'manual' : 'auto';
  if (modo === 'manual') {
    const c = document.getElementById('mobSaldoValor');
    if (c) c.focus();
  }
}

/** Grava pelo mesmo mapa e pelas mesmas funções do desktop. */
function mobSaldoSalvar(mes, ano) {
  const op = document.getElementById('mobSaldoOpcoes');
  if (!op) return;
  const reg = obterMapaSaldoCarregado()[chaveMes(mes, ano)];
  if (op.dataset.modo !== 'manual') {
    mobFolhaFechar();
    if (reg && reg.manual) resetarSaldoMesAnterior(mes, ano);
    return;
  }
  const campo = document.getElementById('mobSaldoValor');
  const v = parseBRL(campo ? campo.value : '');
  if (!Number.isFinite(v)) {
    if (typeof mostrarToast === 'function') mostrarToast('Valor inválido.', 'erro');
    return;
  }
  const mapa = obterMapaSaldoCarregado();
  mapa[chaveMes(mes, ano)] = { valor: v, manual: true };
  salvarMapaSaldoCarregado(mapa);
  try {
    if (window.AppliqueiCloudSync && typeof AppliqueiCloudSync.forceFlush === 'function')
      AppliqueiCloudSync.forceFlush();
  } catch (_) {}
  mobFolhaFechar();
  if (typeof mostrarToast === 'function')
    mostrarToast('Saldo do mês anterior ajustado manualmente.', 'sucesso');
  atualizarTelaControle();
}

// ------------------------------------------------------------
// Para onde foi
// ------------------------------------------------------------
// As mesmas barras do gráfico de composição do desktop, como lista do
// maior para o menor. Tocar numa linha abre o extrato já filtrado.
var _mobCompTodas = false;
var MOB_COMP_LIMITE = 5;

function _mobComposicao(c) {
  if (!c || !Array.isArray(c.itens) || !c.itens.length) return '';
  const despesa = c.modo === 'despesa';
  const base = c.itens
    .filter((x) => x.label === 'Receita' || x.label === 'Resgate')
    .reduce((a, x) => a + (Number(x.valor) || 0), 0);
  const linhas = c.itens
    .filter((x) => x.label !== 'Receita' && x.label !== 'Resgate')
    .filter((x) => !(despesa && x.label === 'Sobra'))
    .filter((x) => Math.abs(Number(x.valor) || 0) > 0.005);
  const total = despesa ? linhas.reduce((a, x) => a + x.valor, 0) : base;
  const maior = Math.max(1, ...linhas.map((x) => Math.abs(x.valor)));
  const nomes = {
    Fixa: 'Fixas',
    'Var.': 'Variáveis',
    'Aportes Mês': 'Investido',
    Sobra: 'Sobrou',
  };
  const barra = linhas
    .filter((x) => x.valor > 0)
    .map(
      (x) =>
        '<span style="background:' +
        x.cor +
        ';width:' +
        ((x.valor / (total || 1)) * 100).toFixed(2) +
        '%"></span>'
    )
    .join('');
  const vis = _mobCompTodas ? linhas : linhas.slice(0, MOB_COMP_LIMITE);
  const rows = vis
    .map((x) => {
      const nome = nomes[x.label] || x.label;
      const pct = total ? Math.round((x.valor / total) * 100) + '%' : '';
      const alvo = despesa
        ? x.slug && x.slug !== '__sem_categoria__'
          ? x.slug
          : null
        : x.tipo || null;
      // Categoria com limite por mês: "de R$ 280 · 85%" / "passou R$ 40".
      const lim =
        despesa && x.slug && typeof obterLimiteCategoria === 'function'
          ? obterLimiteCategoria(x.slug)
          : 0;
      const limTxt =
        lim > 0
          ? '<small class="mc-lim' +
            (x.valor > lim ? ' passou' : x.valor >= lim * 0.8 ? ' perto' : '') +
            '">' +
            (x.valor > lim
              ? 'passou ' + _mobEsc(_mobDreFmt(x.valor - lim)) + ' do limite'
              : 'de ' +
                _mobEsc(_mobDreFmt(lim)) +
                ' · ' +
                Math.round((x.valor / lim) * 100) +
                '%') +
            '</small>'
          : '';
      const corpo =
        '<span class="mc-dot" style="background:' +
        x.cor +
        '"></span><span class="mc-meio"><span class="mc-lin"><span>' +
        _mobEsc(nome) +
        '</span><b class="valor-mascarado">' +
        _mobEsc(_mobDreFmt(x.valor)) +
        '</b></span><span class="mc-trilho"><span style="background:' +
        x.cor +
        ';width:' +
        Math.max(2, (Math.abs(x.valor) / maior) * 100).toFixed(1) +
        '%"></span></span>' +
        limTxt +
        '</span><span class="mc-pct">' +
        pct +
        '</span>';
      return alvo
        ? '<button type="button" class="mc-row" onclick="mobVerNoExtrato(' +
            (despesa ? "'todos','" + _mobEsc(alvo) + "'" : "'" + alvo + "',''") +
            ')" aria-label="' +
            _mobEsc(nome) +
            ', ver no extrato">' +
            corpo +
            '<i class="ph ph-caret-right mc-seta"></i></button>'
        : '<div class="mc-row">' + corpo + '<span class="mc-seta"></span></div>';
    })
    .join('');
  const mais =
    linhas.length > MOB_COMP_LIMITE
      ? '<button type="button" class="mc-mais" onclick="mobCompAlternarTodas()">' +
        (_mobCompTodas ? 'Mostrar menos' : 'Ver todas (' + linhas.length + ')') +
        '</button>'
      : '';
  return (
    '<section class="mi-card mc">' +
    '<div class="mi-tit-linha"><h2 class="mi-h2">Para onde foi</h2><span class="mc-total">' +
    (despesa ? 'gasto ' : 'entrou ') +
    '<b class="valor-mascarado">' +
    _mobEsc(_mobDreFmt(total)) +
    '</b></span></div>' +
    '<div class="mc-barra" aria-hidden="true">' +
    barra +
    '</div><div class="mc-lista">' +
    rows +
    '</div>' +
    mais +
    '</section>'
  );
}

function mobCompAlternarTodas() {
  _mobCompTodas = !_mobCompTodas;
  if (typeof atualizarTelaControle === 'function') atualizarTelaControle();
}

/** Abre o extrato filtrado pelo tipo e/ou pela categoria de despesa. */
function mobVerNoExtrato(tipo, slug) {
  const aba = Array.from(document.querySelectorAll('#controle .ext-tab')).find((b) =>
    (b.getAttribute('onclick') || '').includes("'" + (tipo || 'todos') + "'")
  );
  if (aba) aba.click();
  if (
    typeof filtrarExtratoPorCategoria === 'function' &&
    typeof extratoCategoriaAtiva !== 'undefined'
  ) {
    if ((slug || '') !== extratoCategoriaAtiva)
      filtrarExtratoPorCategoria(slug || extratoCategoriaAtiva);
  }
  mobSegControle('extrato');
}

// ------------------------------------------------------------
// Próximos dias
// ------------------------------------------------------------
// Os vencimentos do mês num carrossel, cada estado com a sua cara:
// atrasada, vence hoje, fatura do cartão (abre a fatura agrupada, a mesma
// janela do desktop) e as demais. "Baixar" abre uma folha com o valor
// editável; confirmar é o confirmarPagamento do desktop.

function _mobDiaVenc(data, hojeStr) {
  const [a, m, d] = data.split('-').map(Number);
  const dt = new Date(a, m - 1, d);
  if (data === hojeStr) return { rot: 'HOJE', estado: 'hoje' };
  if (data < hojeStr) {
    const [ha, hm, hd] = hojeStr.split('-').map(Number);
    const dias = Math.round((new Date(ha, hm - 1, hd) - dt) / 86400000);
    return { rot: 'ATRASOU ' + dias + (dias === 1 ? ' DIA' : ' DIAS'), estado: 'atraso' };
  }
  const sem = dt.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
  return { rot: sem + ' ' + d, estado: 'normal' };
}

function _mobProximos(itens, hojeStr) {
  if (!Array.isArray(itens) || !itens.length || !hojeStr) return '';
  let total = 0;
  const cards = itens
    .map((it) => {
      const dia = _mobDiaVenc(it.dataVencimento, hojeStr);
      const dd = it.dataVencimento.split('-').reverse().slice(0, 2).join('/');
      if (it.tipo === 'cartao') {
        const g = it.grupo;
        total += Number(g.total) || 0;
        const info = typeof obterCartao === 'function' ? obterCartao(g.cartaoId) : null;
        const nome = 'Fatura ' + (info ? info.nome : 'do cartão');
        const key = (g.cartaoId || 'sem') + '_' + g.dataVencimento;
        const n = g.itens.length;
        return (
          '<article class="mp-card fatura ' +
          dia.estado +
          '" role="button" tabindex="0" aria-label="Ver a fatura" onclick="abrirModalGrupoCartao(\'' +
          _mobEsc(key) +
          '\')"><div class="mp-topo"><span class="mp-dia">' +
          dia.rot +
          '</span><span class="mp-ic"><i class="ph ph-credit-card"></i></span></div><div class="mp-corpo"><b>' +
          _mobEsc(nome) +
          '</b><small>' +
          n +
          (n === 1 ? ' compra' : ' compras') +
          '</small><span class="mp-val valor-mascarado">' +
          _mobEsc(_mobDreFmt(g.total)) +
          '</span></div>' +
          // Pagar direto, como a conta comum tem "Baixar" (antes: Ver fatura →
          // Pagar → confirmar). Tocar no resto do card abre a fatura.
          '<button type="button" class="mp-btn" onclick="event.stopPropagation();baixarGrupoCartao(\'' +
          _mobEsc(key) +
          '\')">Pagar</button></article>'
        );
      }
      const t = it.conta;
      total += Number(t.valor) || 0;
      const meta =
        dia.estado === 'atraso'
          ? 'venceu ' + dd
          : t.obs
            ? t.obs
            : t.categoria === 'despesa_fixa'
              ? 'conta fixa'
              : 'vence ' + dd;
      return (
        '<article class="mp-card ' +
        dia.estado +
        '"><div class="mp-topo"><span class="mp-dia">' +
        dia.rot +
        '</span><span class="mp-ic"><i class="ph ph-receipt"></i></span></div><div class="mp-corpo"><b>' +
        _mobEsc(t.descricao || 'Conta') +
        '</b><small>' +
        _mobEsc(meta) +
        '</small><span class="mp-val valor-mascarado">' +
        _mobEsc(_mobDreFmt(t.valor)) +
        '</span></div><button type="button" class="mp-btn" onclick="mobBaixarConta(\'' +
        _mobEsc(String(t.id)) +
        '\')">Baixar</button></article>'
      );
    })
    .join('');
  return (
    // Lista vertical com os dois próximos (canvas); o resto atrás de "+ N".
    // O carrossel escondia do terceiro em diante.
    '<section class="mp"><div class="mi-tit-linha"><h2 class="mi-h2">Falta pagar</h2><span class="mc-total"><b class="valor-mascarado">' +
    _mobEsc(_mobDreFmt(total)) +
    '</b></span></div><div class="mi-card mp-fila mp-lista">' +
    cards +
    (itens.length > 2
      ? '<button type="button" class="mp-mais" onclick="this.parentNode.classList.add(\'todos\');this.remove()">+ ' +
        (itens.length - 2) +
        ' até o fim do mês</button>'
      : '') +
    '</div></section>'
  );
}

// ------------------------------------------------------------
// Folha do lançamento (toque numa linha do extrato)
// ------------------------------------------------------------
// Tudo o que se faz com UM lançamento num lugar só, na zona do polegar:
// marcar como pago hoje, "paguei outro valor" (só este mês muda), adiar para
// o mês seguinte, editar e excluir — esta perguntando "só este mês" ou "este e
// os próximos" quando é conta fixa ou parcelada. As ações são as do extrato
// (confirmarPagamento, adiarLancamentoUmMes, prepararEdicao, executarDelecao).

var _mobLancMeses = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

function _mobLancDdMm(ymd) {
  return ymd && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? ymd.slice(8, 10) + '/' + ymd.slice(5, 7) : '';
}

/** O selo do topo: "A pagar · vence 10/11", "Atrasado · venceu 05/11", "Pago em 03/11". */
function mobLancStatus(t, hojeYmd) {
  const hoje = hojeYmd || (typeof hojeYmdLocal === 'function' ? hojeYmdLocal() : '');
  if (t.categoria === 'receita' || t.categoria === 'dividendo')
    return {
      classe: 'ok',
      txt: 'Entrada' + (t.dataVencimento ? ' · ' + _mobLancDdMm(t.dataVencimento) : ''),
    };
  if (t.pago) {
    const dia = typeof appliqueiDiaDoPagamento === 'function' ? appliqueiDiaDoPagamento(t) : null;
    return { classe: 'ok', txt: 'Pago' + (dia ? ' em ' + _mobLancDdMm(dia) : '') };
  }
  if (t.dataVencimento && t.dataVencimento < hoje)
    return { classe: 'atraso', txt: 'Atrasado · venceu ' + _mobLancDdMm(t.dataVencimento) };
  if (t.dataVencimento === hoje) return { classe: 'atraso', txt: 'A pagar · vence hoje' };
  return {
    classe: 'pendente',
    txt: 'A pagar' + (t.dataVencimento ? ' · vence ' + _mobLancDdMm(t.dataVencimento) : ''),
  };
}

/** "Moradia · sai do Itaú · todo mês" */
function mobLancMeta(t) {
  const partes = [];
  if (t.categoriaDespesa && typeof rotuloCategoriaDespesa === 'function')
    partes.push(rotuloCategoriaDespesa(t.categoriaDespesa));
  const origem = typeof extratoOrigemDe === 'function' ? extratoOrigemDe(t) : null;
  if (origem && origem.chave !== 'sem') {
    const entrada = t.categoria === 'receita' || t.categoria === 'dividendo';
    partes.push(
      (entrada ? 'entra no ' : t.categoria === 'cartao_credito' ? 'no ' : 'sai do ') + origem.rotulo
    );
  }
  const p = String(t.descricao || '').match(/\((\d+)\/(\d+)\)\s*$/);
  if (p) partes.push('parcela ' + p[1] + ' de ' + p[2]);
  else if (t.groupId && t.categoria === 'despesa_fixa') partes.push('todo mês');
  return partes.join(' · ');
}

function _mobLancMesNome(t, mais) {
  const d = new Date(t.ano, t.mes + (mais || 0), 1);
  return _mobLancMeses[d.getMonth()];
}

/** Pode ir para o mês seguinte? Conta a pagar comum; cartão e sonho têm regra própria. */
function mobLancPodeAdiar(t) {
  return (
    !!t &&
    !t.pago &&
    (t.categoria === 'despesa_fixa' || t.categoria === 'despesa_variavel') &&
    !t.sonhoId &&
    !t.compromissoId
  );
}

function mobLancPodePagar(t) {
  return !!t && !t.pago && t.categoria !== 'receita' && t.categoria !== 'dividendo';
}

/** vista: '' (ações), 'valor', 'excluir', 'pago'. */
function mobLancFolha(id, vista) {
  if (typeof transacoes === 'undefined') return;
  const t = transacoes.find((x) => String(x.id) === String(id));
  if (!t) return mobFolhaFechar();
  const idEsc = _mobEsc(String(t.id));
  const st = mobLancStatus(t);
  const meta = mobLancMeta(t);
  const hoje = typeof hojeYmdLocal === 'function' ? hojeYmdLocal() : '';
  const fmt = (v) => (typeof formatarMoeda === 'function' ? formatarMoeda(v) : String(v));
  const mes = _mobLancMesNome(t, 0);
  const prox = _mobLancMesNome(t, 1);
  const serie = !!t.groupId;

  let html =
    '<div class="ml-cab"><div class="ml-cab-txt"><span class="ml-st ' +
    st.classe +
    '">' +
    _mobEsc(st.txt) +
    '</span><h3 class="mf-tit">' +
    _mobEsc(t.descricao || 'Lançamento') +
    '</h3>' +
    (meta ? '<span class="ml-meta">' + _mobEsc(meta) + '</span>' : '') +
    '</div><b class="ml-valor valor-mascarado">' +
    _mobEsc(fmt(t.valor)) +
    '</b></div>';

  const linha = (onclick, txt, extra) =>
    '<button type="button" class="ml-linha' +
    (extra || '') +
    '" onclick="' +
    onclick +
    '"><span>' +
    txt +
    '</span><i class="ph ph-caret-right" aria-hidden="true"></i></button>';

  if (vista === 'valor') {
    html +=
      '<label class="mf-campo" for="input-pago-' +
      idEsc +
      '">Quanto você pagou?<span class="mf-campo-caixa"><span>R$</span><input type="text" inputmode="decimal" id="input-pago-' +
      idEsc +
      '" value="' +
      _mobEsc(
        typeof formatarBRLInput === 'function' ? formatarBRLInput(t.valor) : String(t.valor)
      ) +
      '" oninput="aplicarMascaraBRL(this);mobLancValorAviso(\'' +
      idEsc +
      '\')"></span></label>' +
      '<label class="mf-campo" for="input-pago-dia-' +
      idEsc +
      '">Pago em<span class="mf-campo-caixa ml-dia"><input type="date" id="input-pago-dia-' +
      idEsc +
      '" value="' +
      _mobEsc(hoje) +
      '" max="' +
      _mobEsc(hoje) +
      '"></span></label>' +
      '<div class="mf-info" id="mlValorAviso"><i class="ph ph-info"></i><span>' +
      (serie
        ? 'Só ' +
          _mobEsc(mes) +
          ' muda. ' +
          _mobEsc(prox.charAt(0).toUpperCase() + prox.slice(1)) +
          ' em diante continua ' +
          _mobEsc(fmt(t.valor)) +
          '.'
        : 'O valor do lançamento passa a ser o que você pagou.') +
      '</span></div>' +
      '<button type="button" class="mf-btn1" onclick="mobLancPagar(\'' +
      idEsc +
      '\')">Marcar como pago</button>' +
      '<button type="button" class="mf-btn2" onclick="mobLancFolha(\'' +
      idEsc +
      '\')">Voltar</button>';
  } else if (vista === 'excluir') {
    html +=
      '<b class="ml-perg">Excluir ' +
      _mobEsc(String(t.descricao || 'o lançamento').replace(/\s*\(\d+\/\d+\)\s*$/, '')) +
      ' de quais meses?</b>' +
      '<button type="button" class="ml-escolha" onclick="mobLancExcluir(\'' +
      idEsc +
      "','unica')\"><b>Só " +
      _mobEsc(mes) +
      '</b><span>Some deste mês; ' +
      _mobEsc(prox) +
      ' em diante continua.</span></button>' +
      '<button type="button" class="ml-escolha perigo" onclick="mobLancExcluir(\'' +
      idEsc +
      "','todas')\"><b>" +
      _mobEsc(mes.charAt(0).toUpperCase() + mes.slice(1)) +
      ' e os próximos</b><span>Os meses anteriores ficam no histórico.</span></button>' +
      '<button type="button" class="mf-btn2" onclick="mobLancFolha(\'' +
      idEsc +
      '\')">Voltar</button>';
  } else if (vista === 'pago') {
    const origem = typeof extratoOrigemDe === 'function' ? extratoOrigemDe(t) : null;
    html +=
      '<div class="ml-feito" role="status"><i class="ph-bold ph-check" aria-hidden="true"></i><span>' +
      _mobEsc(String(t.descricao || 'Lançamento').replace(/\s*\(\d+\/\d+\)\s*$/, '')) +
      ' pago' +
      (origem && origem.chave !== 'sem' ? ' · saiu do ' + _mobEsc(origem.rotulo) : '') +
      '</span>' +
      (typeof controlePodeReverterPagamento === 'function' && controlePodeReverterPagamento(t)
        ? '<button type="button" onclick="mobLancDesfazer(\'' + idEsc + '\')">Desfazer</button>'
        : '') +
      '</div><button type="button" class="mf-btn2" onclick="mobFolhaFechar()">Fechar</button>';
  } else {
    if (mobLancPodePagar(t)) {
      // Campos escondidos: confirmarPagamento lê o valor e o dia pelo id.
      html +=
        '<input type="hidden" id="input-pago-' +
        idEsc +
        '" value="' +
        _mobEsc(
          typeof formatarBRLInput === 'function' ? formatarBRLInput(t.valor) : String(t.valor)
        ) +
        '"><input type="hidden" id="input-pago-dia-' +
        idEsc +
        '" value="' +
        _mobEsc(hoje) +
        '">' +
        '<button type="button" class="mf-btn1" onclick="mobLancPagar(\'' +
        idEsc +
        '\')">Marcar como pago hoje</button>';
    }
    html += '<div class="ml-linhas">';
    if (mobLancPodePagar(t))
      html += linha("mobLancFolha('" + idEsc + "','valor')", 'Paguei outro valor');
    if (typeof controlePodePularSonho === 'function' && controlePodePularSonho(t))
      html += linha(
        "mobFolhaFechar();pularParcelaSonho('" + idEsc + "')",
        'Não vou guardar este mês'
      );
    if (mobLancPodeAdiar(t))
      html += linha("mobLancAdiar('" + idEsc + "')", 'Adiar para ' + _mobEsc(prox));
    if (typeof controlePodeReverterPagamento === 'function' && controlePodeReverterPagamento(t))
      html += linha("mobLancDesfazer('" + idEsc + "')", 'Voltar para a pagar');
    html += linha("mobFolhaFechar();prepararEdicao('" + idEsc + "')", 'Editar');
    html += linha(
      serie
        ? "mobLancFolha('" + idEsc + "','excluir')"
        : "mobFolhaFechar();deletarTransacao('" + idEsc + "')",
      'Excluir',
      ' perigo'
    );
    html += '</div>';
  }
  mobFolhaAbrir(html, t.descricao || 'Lançamento');
  // A folha foca o primeiro campo; nas ações não há campo de verdade.
  if (vista !== 'valor') {
    const f = document.getElementById('mobFolha');
    const b = f && f.querySelector('.mf-btn1, .ml-linha');
    if (b) setTimeout(() => b.focus({ preventScroll: true }), 260);
  }
}

/** "Só novembro fica R$ 2.230. Dezembro em diante continua R$ 2.150." */
function mobLancValorAviso(id) {
  const t = transacoes.find((x) => String(x.id) === String(id));
  const el = document.querySelector('#mlValorAviso span');
  const campo = document.getElementById('input-pago-' + id);
  if (!t || !el || !campo || !t.groupId) return;
  const v = typeof parseBRL === 'function' ? parseBRL(campo.value) : NaN;
  if (!Number.isFinite(v)) return;
  const prox = _mobLancMesNome(t, 1);
  el.textContent =
    'Só ' +
    _mobLancMesNome(t, 0) +
    ' fica ' +
    formatarMoeda(v) +
    '. ' +
    prox.charAt(0).toUpperCase() +
    prox.slice(1) +
    ' em diante continua ' +
    formatarMoeda(t.valor) +
    '.';
}

function mobLancPagar(id) {
  const campo = document.getElementById('input-pago-' + id);
  const v = typeof parseBRL === 'function' && campo ? parseBRL(campo.value) : NaN;
  if (!Number.isFinite(v) || v < 0) {
    if (typeof mostrarToast === 'function')
      mostrarToast('Por favor, informe um valor válido.', 'erro');
    return;
  }
  const dia = document.getElementById('input-pago-dia-' + id);
  if (dia && dia.value && typeof hojeYmdLocal === 'function' && dia.value > hojeYmdLocal()) {
    if (typeof mostrarToast === 'function')
      mostrarToast('A data do pagamento não pode ser no futuro.', 'erro');
    return;
  }
  confirmarPagamento(id);
  const t = transacoes.find((x) => String(x.id) === String(id));
  // R$ 0 abre a pergunta "não pagou?" no modal: a folha sai da frente.
  if (t && t.pago) mobLancFolha(id, 'pago');
  else mobFolhaFechar();
}

function mobLancDesfazer(id) {
  mobFolhaFechar();
  if (typeof reverterPagamento === 'function') reverterPagamento(id);
}

function mobLancAdiar(id) {
  mobFolhaFechar();
  if (typeof adiarLancamentoUmMes === 'function') adiarLancamentoUmMes(id);
}

/** Excluir com a escolha já feita na folha — sem o segundo modal. */
function mobLancExcluir(id, modo) {
  const t = transacoes.find((x) => String(x.id) === String(id));
  mobFolhaFechar();
  if (!t) return;
  if (t.sonhoId || typeof executarDelecao !== 'function') return deletarTransacao(id);
  itemParaDeletar = t;
  executarDelecao(modo === 'todas' ? 'todas' : 'unica');
}

/** "Baixar": folha com o valor editável e de qual conta o dinheiro sai. */
function mobBaixarConta(id) {
  if (typeof transacoes === 'undefined') return;
  const t = transacoes.find((x) => String(x.id) === String(id));
  if (!t) return;
  const conta = t.contaId && typeof obterConta === 'function' ? obterConta(t.contaId) : null;
  const nomeConta = conta ? conta.nome : t.banco || '';
  const dd = (t.dataVencimento || '').split('-').reverse().slice(0, 2).join('/');
  const idEsc = _mobEsc(String(t.id));
  const hoje = typeof hojeYmdLocal === 'function' ? hojeYmdLocal() : '';
  const html =
    '<div class="mf-cab"><p class="mf-sobre">Vence ' +
    _mobEsc(dd) +
    '</p><h3 class="mf-tit">Baixar ' +
    _mobEsc(t.descricao || 'conta') +
    '</h3><p class="mf-txt">Pagou outro valor, com juros ou desconto? Corrija antes de confirmar.</p></div>' +
    '<label class="mf-campo" for="input-pago-' +
    idEsc +
    '">Valor pago<span class="mf-campo-caixa"><span>R$</span><input type="text" inputmode="decimal" id="input-pago-' +
    idEsc +
    '" value="' +
    _mobEsc(typeof formatarBRLInput === 'function' ? formatarBRLInput(t.valor) : String(t.valor)) +
    '" oninput="aplicarMascaraBRL(this)"></span></label>' +
    // O dia em que foi pago: é quando o dinheiro sai da conta. Hoje por padrão;
    // quem pagou ontem e lança hoje corrige aqui.
    '<label class="mf-campo" for="input-pago-dia-' +
    idEsc +
    '">Pago em<span class="mf-campo-caixa"><input type="date" id="input-pago-dia-' +
    idEsc +
    '" value="' +
    _mobEsc(hoje) +
    '" max="' +
    _mobEsc(hoje) +
    '"></span></label>' +
    (nomeConta
      ? '<div class="mf-info"><i class="ph ph-bank"></i><span>Sai de <b>' +
        _mobEsc(nomeConta) +
        '</b></span></div>'
      : '') +
    '<button type="button" class="mf-btn1" onclick="mobConfirmarBaixa(\'' +
    idEsc +
    '\')">Confirmar pagamento</button>' +
    // Parcela de sonho: não guardou este mês? Pula sem precisar baixar com R$ 0.
    (typeof controlePodePularSonho === 'function' && controlePodePularSonho(t)
      ? '<button type="button" class="mf-btn2" onclick="mobFolhaFechar();pularParcelaSonho(\'' +
        idEsc +
        '\')"><i class="ph ph-skip-forward"></i> Não vou guardar este mês</button>'
      : '') +
    '<button type="button" class="mf-btn2" onclick="mobFolhaFechar()">Cancelar</button>';
  mobFolhaAbrir(html, 'Baixar ' + (t.descricao || 'conta'));
}

function mobConfirmarBaixa(id) {
  const campo = document.getElementById('input-pago-' + id);
  const v = typeof parseBRL === 'function' && campo ? parseBRL(campo.value) : NaN;
  if (!Number.isFinite(v) || v < 0) {
    if (typeof mostrarToast === 'function')
      mostrarToast('Por favor, informe um valor válido.', 'erro');
    return;
  }
  const dia = document.getElementById('input-pago-dia-' + id);
  if (dia && dia.value && typeof hojeYmdLocal === 'function' && dia.value > hojeYmdLocal()) {
    if (typeof mostrarToast === 'function')
      mostrarToast('A data do pagamento não pode ser no futuro.', 'erro');
    return;
  }
  // confirmarPagamento lê os mesmos campos pelo id; a folha fecha depois.
  confirmarPagamento(id);
  mobFolhaFechar();
}

// ------------------------------------------------------------
// Meu patrimônio no celular
// ------------------------------------------------------------
// O total em letra grande, a linha do tempo que se percorre com o dedo, do
// que ele é feito e os cartões de cada banco ou corretora — como o app do
// banco mostra a conta. Os números chegam de renderMeuPatrimonio já
// calculados; a série mensal vem de mpSerieMensalPatrimonio. Os blocos de
// gestão (Minhas contas, Meus bens) seguem os do desktop, logo abaixo.

// liquido: null até o primeiro desenho — abre em Líquido quando há dívida.
var _mobPat = { dados: null, serie: null, liquido: null, periodo: 12, aberta: null };
var MOB_PAT_CORES = ['#047857', '#1d4ed8', '#6d28d9', '#b45309', '#0e7490', '#be185d'];
var MOB_PAT_PERIODOS = [
  [1, '1M'],
  [6, '6M'],
  [12, '1A'],
  [24, '2A'],
  [0, 'Tudo'],
];

function _mobPatFmt(v) {
  return _mobDreFmt(v);
}

function _mobPatSerieVisivel() {
  const s = _mobPat.serie || [];
  // N meses = N+1 pontos (o fim do mês de partida e os N seguintes), igual
  // ao web; com um ponto só o 1M não desenharia linha nenhuma.
  return _mobPat.periodo > 0 ? s.slice(-(_mobPat.periodo + 1)) : s;
}

function mobRenderPatrimonio(d) {
  const topo = document.getElementById('mpMob');
  if (!topo || !d || !d.kpis) return;
  _mobPat.dados = d;
  // A série percorre meses de lançamentos e operações: só no celular, que é
  // quem a desenha.
  _mobPat.serie = mobEhCelular() && typeof d.serie === 'function' ? d.serie() : [];
  _mobPatDesenharTopo();
  mobPatrimonioRedesenharCarteiras();
  _mobPatDesenharClasses();
  mobPatDesenharProventos();
}

/** Proventos previstos para 12 meses. Também chamada quando os dividendos chegam. */
function mobPatDesenharProventos() {
  const wrap = document.getElementById('mpMobProventos');
  if (!wrap) return;
  if (typeof projecaoProventos12m !== 'function' || typeof obterResumoCarteira !== 'function') {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = htmlProjecaoProventos(projecaoProventos12m(obterResumoCarteira()), {
    link: "mobIrPara('patrimonio');mudarSubAbaPatrimonio('dividendos');document.getElementById('subtabBtnDividendos').scrollIntoView({block:'start'})",
  });
}

/** Redesenha o topo da foto (chamada pelo seletor Mês/12M do "Por que mudou"). */
function mobPatRedesenharTopo() {
  if (_mobPat.dados) _mobPatDesenharTopo();
}

function mobPatAlternarLiquido(liq) {
  _mobPat.liquido = !!liq;
  _mobPatDesenharTopo();
}

function mobPatPeriodo(meses) {
  _mobPat.periodo = Number(meses) || 0;
  _mobPatDesenharTopo();
}

function _mobPatGrafico(serie) {
  const W = 358;
  const H = 150;
  if (serie.length < 2) return { svg: '', pts: [] };
  const vals = serie.map((p) => p.total);
  const mx = Math.max(...vals);
  const mn = Math.min(...vals);
  const rng = mx - mn || Math.abs(mx) || 1;
  // Folga nas pontas e em cima/embaixo: o ponto não corta na borda, e uma
  // variação pequena não parece um salto do chão ao teto.
  const pts = vals.map((v, i) => [
    10 + (i / (vals.length - 1)) * (W - 20),
    14 + (1 - (v - mn) / rng) * (H - 14 - 30),
  ]);
  const linha = pts
    .map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1))
    .join(' ');
  const area =
    linha +
    ' L' +
    pts[pts.length - 1][0].toFixed(1) +
    ' ' +
    H +
    ' L' +
    pts[0][0].toFixed(1) +
    ' ' +
    H +
    ' Z';
  const ult = pts[pts.length - 1];
  const svg =
    '<svg class="mpm-svg" viewBox="0 0 ' +
    W +
    ' ' +
    H +
    '" preserveAspectRatio="none" aria-hidden="true">' +
    '<defs><linearGradient id="mpmGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--cor-primaria)" stop-opacity=".28"></stop><stop offset="1" stop-color="var(--cor-primaria)" stop-opacity="0"></stop></linearGradient></defs>' +
    '<path d="' +
    area +
    '" fill="url(#mpmGrad)"></path><path d="' +
    linha +
    '" fill="none" stroke="var(--cor-primaria)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>' +
    '<line class="mpm-cursor" x1="' +
    ult[0] +
    '" x2="' +
    ult[0] +
    '" y1="0" y2="' +
    H +
    '" vector-effect="non-scaling-stroke"></line></svg>' +
    '<span class="mpm-ponto" style="left:' +
    ((ult[0] / W) * 100).toFixed(2) +
    '%;top:' +
    ((ult[1] / H) * 100).toFixed(2) +
    '%"></span>';
  return { svg, pts, W, H };
}

function _mobPatTitulo(valor, rotulo, delta) {
  const t = document.getElementById('mpmValor');
  const r = document.getElementById('mpmQuando');
  const dl = document.getElementById('mpmDelta');
  if (t) t.textContent = _mobPatFmt(valor);
  if (r) r.textContent = rotulo;
  if (dl) {
    dl.innerHTML = delta ? delta.html : '';
    dl.className = 'mpm-delta' + (delta ? ' ' + delta.cls : '');
  }
}

function _mobPatDelta(atual, base, desde) {
  if (base == null || !isFinite(base)) return null;
  const dif = atual - base;
  if (Math.abs(dif) < 0.005) return { cls: 'neu', html: 'igual a ' + _mobEsc(desde) };
  const pct = base !== 0 ? (dif / Math.abs(base)) * 100 : null;
  return {
    cls: dif > 0 ? 'pos' : 'neg',
    html:
      (dif > 0 ? '↑ ' : '↓ ') +
      '<b class="valor-mascarado">' +
      _mobEsc(_mobPatFmt(Math.abs(dif))) +
      '</b>' +
      (pct != null ? ' (' + _mobPct(Math.abs(pct)) + ')' : '') +
      ' desde ' +
      _mobEsc(desde),
  };
}

function _mobPatRotuloMes(p) {
  return MOB_MESES_CURTOS[p.mes] + '/' + String(p.ano).slice(2);
}

function _mobPatDesenharTopo() {
  const topo = document.getElementById('mpMob');
  const d = _mobPat.dados;
  if (!topo || !d) return;
  const k = d.kpis;
  const divida = Math.max(0, Number(d.divida) || 0);
  if (_mobPat.liquido === null) _mobPat.liquido = divida > 0;
  const liquido = _mobPat.liquido && divida > 0;
  const total = k.total - (liquido ? divida : 0);
  const serie = _mobPatSerieVisivel();
  const g = _mobPatGrafico(serie);
  const quando = 'Posição de ' + new Date(d.posicaoMs || Date.now()).toLocaleDateString('pt-BR');
  const base = serie.length > 1 ? serie[0] : null;
  // O gráfico é sempre o bruto: não há histórico do saldo devedor dos
  // financiamentos, e descontar a dívida de hoje do passado inventaria números.
  // Por isso, no Líquido, a variação diz que é a do que você TEM.
  const delta = base ? _mobPatDelta(k.total, base.total, _mobPatRotuloMes(base)) : null;
  if (delta && liquido) delta.html += ' no que você tem';

  const seg =
    divida > 0
      ? '<div class="mpm-seg" role="tablist" aria-label="Como somar">' +
        '<button type="button" role="tab" aria-selected="' +
        liquido +
        '" onclick="mobPatAlternarLiquido(true)">Líquido</button>' +
        '<button type="button" role="tab" aria-selected="' +
        !liquido +
        '" onclick="mobPatAlternarLiquido(false)">Bruto</button></div>'
      : '';
  const nota = liquido
    ? '<p class="mpm-nota">Você tem <b class="valor-mascarado">' +
      _mobEsc(_mobPatFmt(k.total)) +
      '</b> e deve <b class="valor-mascarado">' +
      _mobEsc(_mobPatFmt(divida)) +
      '</b> (financiamentos e faturas em aberto). O gráfico mostra o que você tem.</p>'
    : '';
  const periodos = MOB_PAT_PERIODOS.map(
    (p) =>
      '<button type="button" aria-pressed="' +
      (_mobPat.periodo === p[0]) +
      '" onclick="mobPatPeriodo(' +
      p[0] +
      ')">' +
      p[1] +
      '</button>'
  ).join('');

  // Do que ele é feito
  const partes = [
    ['Saldo em conta', k.saldo, 'var(--cor-primaria)', 'mpMobCarteiras'],
    ['Investimentos', k.investido, 'var(--cor-patrimonio)', 'mpMobClasses'],
    ['Imóveis', k.imoveis, 'var(--cor-cartao)', 'listaBens'],
    ['Veículos', k.veiculos, '#64748b', 'listaBens'],
  ].filter((p) => Math.abs(p[1]) > 0.005);
  // Dívida é linha da composição, em vermelho: fica à vista sem precisar
  // trocar para Líquido. Fora da barra (a barra é só o que você tem).
  const chipDivida =
    divida > 0
      ? '<button type="button" class="mpm-chip mpm-lin mpm-chip-divida" onclick="mobPatIrPara(\'mpMobBens\')"><span class="mpm-chip-dot" style="background:var(--cor-erro)"></span><span class="mpm-chip-txt"><small>Dívidas</small><b class="valor-mascarado">−' +
        _mobEsc(_mobPatFmt(divida)) +
        '</b></span><i class="ph ph-caret-right" aria-hidden="true"></i></button>'
      : '';
  const soma = partes.reduce((a, p) => a + Math.max(0, p[1]), 0);
  const barra = partes
    .filter((p) => p[1] > 0)
    .map(
      (p) =>
        '<span style="background:' +
        p[2] +
        ';width:' +
        ((p[1] / (soma || 1)) * 100).toFixed(2) +
        '%"></span>'
    )
    .join('');
  // Composição em lista, como o canvas: ponto, nome, valor e seta; a linha
  // de dívidas fecha a lista (chipDivida).
  const chips =
    partes
      .map(
        (p) =>
          '<button type="button" class="mpm-chip mpm-lin" onclick="mobPatIrPara(\'' +
          p[3] +
          '\')"><span class="mpm-chip-dot" style="background:' +
          p[2] +
          '"></span><span class="mpm-chip-txt"><small>' +
          p[0] +
          (soma > 0 ? ' · ' + Math.round((Math.max(0, p[1]) / soma) * 100) + '%' : '') +
          '</small><b class="valor-mascarado">' +
          _mobEsc(_mobPatFmt(p[1])) +
          '</b></span><i class="ph ph-caret-right" aria-hidden="true"></i></button>'
      )
      .join('') + chipDivida;

  topo.innerHTML =
    '<div class="mpm-cab"><p class="mpm-tit">Patrimônio ' +
    (liquido ? 'líquido' : 'total') +
    '</p><span class="mpm-cab-acoes">' +
    seg +
    '<button type="button" class="mpm-olho" onclick="toggleValoresOcultos()" aria-label="Esconder ou mostrar valores"><i class="ph ph-eye"></i></button></span>' +
    '</div>' +
    '<p class="mpm-valor valor-mascarado" id="mpmValor">' +
    _mobEsc(_mobPatFmt(total)) +
    '</p><p class="mpm-delta" id="mpmDelta"></p><p class="mpm-quando" id="mpmQuando">' +
    _mobEsc(quando) +
    '</p>' +
    nota +
    (g.svg
      ? '<div class="mpm-graf" id="mpmGraf" role="img" aria-label="Evolução do patrimônio: arraste para ver cada mês">' +
        g.svg +
        '</div><div class="mpm-periodos" role="group" aria-label="Período">' +
        periodos +
        '</div>'
      : '') +
    _mobPatMudouHtml() +
    (partes.length
      ? '<section class="mpm-comp"><h2 class="mi-h2">Do que ele é feito</h2><div class="mi-card mpm-comp-card"><div class="mc-barra" aria-hidden="true">' +
        barra +
        '</div><div class="mpm-chips mpm-lista">' +
        chips +
        '</div></div></section>'
      : '') +
    _mobPatFolegoHtml(d.folego);
  _mobPatTitulo(total, quando, delta);
  if (g.svg) _mobPatLigarScrub(serie, g, total, quando, delta);
}

/** Arrastar o dedo no gráfico mostra o patrimônio de cada mês no título. */
function _mobPatLigarScrub(serie, g, total, quando, delta) {
  const caixa = document.getElementById('mpmGraf');
  if (!caixa) return;
  const cursor = caixa.querySelector('.mpm-cursor');
  const ponto = caixa.querySelector('.mpm-ponto');
  const mover = (ev) => {
    const r = caixa.getBoundingClientRect();
    if (!r.width) return;
    const x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const i = Math.round(x * (serie.length - 1));
    const p = g.pts[i];
    caixa.classList.add('ativo');
    if (cursor) {
      cursor.setAttribute('x1', p[0]);
      cursor.setAttribute('x2', p[0]);
    }
    if (ponto) {
      ponto.style.left = ((p[0] / g.W) * 100).toFixed(2) + '%';
      ponto.style.top = ((p[1] / g.H) * 100).toFixed(2) + '%';
    }
    const ant = i > 0 ? serie[i - 1] : null;
    _mobPatTitulo(
      serie[i].total,
      'Fim de ' + _mobPatRotuloMes(serie[i]) + (i === serie.length - 1 ? ' (hoje)' : ''),
      ant ? _mobPatDelta(serie[i].total, ant.total, _mobPatRotuloMes(ant)) : null
    );
  };
  const soltar = () => {
    caixa.classList.remove('ativo');
    const p = g.pts[g.pts.length - 1];
    if (cursor) {
      cursor.setAttribute('x1', p[0]);
      cursor.setAttribute('x2', p[0]);
    }
    if (ponto) {
      ponto.style.left = ((p[0] / g.W) * 100).toFixed(2) + '%';
      ponto.style.top = ((p[1] / g.H) * 100).toFixed(2) + '%';
    }
    _mobPatTitulo(total, quando, delta);
  };
  caixa.addEventListener('pointerdown', (e) => {
    if (caixa.setPointerCapture) caixa.setPointerCapture(e.pointerId);
    mover(e);
  });
  caixa.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || caixa.classList.contains('ativo')) mover(e);
  });
  caixa.addEventListener('pointerup', soltar);
  caixa.addEventListener('pointercancel', soltar);
  caixa.addEventListener('pointerleave', soltar);
}

/** Por que mudou, em três linhas: contas, valorização e bens (mpMudancaDoMes). */
function _mobPatMudouHtml() {
  const meses = typeof mpWeb !== 'undefined' ? mpWeb.mudouMeses : 1;
  const m = typeof mpMudancaDoMes === 'function' ? mpMudancaDoMes(_mobPat.serie, meses) : null;
  if (!m) return '';
  const num = (v) =>
    '<b class="valor-mascarado ' +
    (Math.abs(v) < 0.005 ? 'neu' : v > 0 ? 'pos' : 'neg') +
    '">' +
    (v > 0.005 ? '+' : v < -0.005 ? '−' : '') +
    _mobEsc(_mobPatFmt(Math.abs(v))) +
    '</b>';
  const linhas = [
    ['Sobrou nas contas', m.contas],
    ['Valorização dos investimentos', m.valorizacao],
    ['Bens', m.bens],
  ].filter((l, i) => i === 0 || Math.abs(l[1]) > 0.005);
  return (
    '<section class="mpm-mudou"><div class="mi-tit-linha"><h2 class="mi-h2">Por que mudou</h2>' +
    (typeof mpdMudouSeletorHtml === 'function' ? mpdMudouSeletorHtml() : '') +
    '</div><div class="mpm-mudou-sub"><span class="mpm-mudou-tot">' +
    num(m.total) +
    ' desde ' +
    _mobEsc(_mobPatRotuloMes(m.de)) +
    '</span></div><div class="mi-card mpm-mudou-lista">' +
    linhas.map((l) => '<div><span>' + l[0] + '</span>' + num(l[1]) + '</div>').join('') +
    '</div></section>'
  );
}

/** Fôlego em faixa que desliza: liquidez, reserva em meses e proventos. */
function _mobPatFolegoHtml(f) {
  if (!f) return '';
  const cartoes = [
    [
      'Disponível em 1 dia',
      '<b class="valor-mascarado">' + _mobEsc(_mobPatFmt(f.disponivel)) + '</b>',
      f.pctDisponivel == null
        ? 'contas, ações e FIIs'
        : Math.round(f.pctDisponivel) + '% do que você tem',
    ],
  ];
  if (f.reservaMeses != null)
    cartoes.push([
      'Reserva cobre',
      '<b>' + f.reservaMeses.toFixed(1).replace('.', ',') + ' meses</b>',
      'do seu gasto médio',
    ]);
  if (f.proventos)
    cartoes.push([
      'Proventos 12 meses',
      '<b class="valor-mascarado">' + _mobEsc(_mobPatFmt(f.proventos.total)) + '</b>',
      'previstos',
    ]);
  return (
    '<section class="mpm-folego" aria-label="Fôlego">' +
    cartoes
      .map(
        (c) =>
          '<div class="mpm-fol"><small>' +
          c[0] +
          '</small>' +
          c[1] +
          '<span>' +
          c[2] +
          '</span></div>'
      )
      .join('') +
    '</section>'
  );
}

function mobPatIrPara(id) {
  const el = document.getElementById(id);
  if (el && typeof el.scrollIntoView === 'function')
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** "Caixa R$ X · Investido R$ Y" — o que antes só aparecia ao abrir o cartão. */
function _mobPatSubInst(x) {
  if (x.reconciliar) return 'sem instituição no lançamento';
  const p = [];
  if (Math.abs(x.caixa) > 0.01) p.push('Caixa ' + _mobPatFmt(x.caixa));
  if (Math.abs(x.investido) > 0.01) p.push('Investido ' + _mobPatFmt(x.investido));
  return p.join(' · ');
}

/** Lista de bancos/corretoras, uma linha cada. Também chamada por mpToggleExtrato. */
function mobPatrimonioRedesenharCarteiras() {
  const wrap = document.getElementById('mpMobCarteiras');
  const d = _mobPat.dados;
  if (!wrap || !d) return;
  const lista = (typeof mpEstado !== 'undefined' && mpEstado._instituicoes) || d.instituicoes || [];
  const cab =
    '<div class="mi-tit-linha"><h2 class="mi-h2">Onde está o dinheiro</h2><span class="mpl-botoes">' +
    '<button type="button" class="mi-link" onclick="abrirTransferenciaModal()"><i class="ph ph-arrows-left-right"></i> Transferir</button>' +
    '<button type="button" class="mi-link" onclick="abrirNovaContaForm()"><i class="ph ph-plus"></i> Conta</button></span></div>';
  if (!lista.length) {
    wrap.innerHTML =
      cab +
      '<p class="mi-vazio">Cadastre suas contas e registre movimentações para ver onde está cada real.</p>';
    return;
  }
  const cards = lista
    .map((x, i) => {
      const aberta = _mobPat.aberta === x.key;
      // Cor pela posição na pilha: cartões vizinhos nunca saem iguais. Tons
      // escuros o bastante para o texto branco.
      const cor = x.reconciliar ? 'var(--cor-erro)' : MOB_PAT_CORES[i % MOB_PAT_CORES.length];
      const conta = !x.reconciliar && typeof obterConta === 'function' ? obterConta(x.key) : null;
      const sigla =
        typeof mpIniciaisInstituicao === 'function' ? mpIniciaisInstituicao(x.nome) : '';
      let corpo = '';
      if (aberta) {
        const partes = [];
        if (Math.abs(x.caixa) > 0.01) partes.push(['Caixa', x.caixa]);
        Object.keys(x.classes || {}).forEach((cl) => {
          if (x.classes[cl] > 0.01)
            partes.push([(typeof MP_LABELS !== 'undefined' && MP_LABELS[cl]) || cl, x.classes[cl]]);
        });
        partes.sort((a, b) => b[1] - a[1]);
        const acoes = [
          ['abrirTransferenciaModal()', 'ph-arrows-left-right', 'Transferir'],
          // O extrato abre no painel da instituição (folha), com filtros e o
          // saldo de cada dia — o mesmo do web.
          ['mpAbrirPainelInst(' + i + ')', 'ph-receipt', 'Extrato'],
        ];
        if (conta)
          acoes.push(["conferirAbrir('" + _mobEsc(conta.id) + "')", 'ph-check-circle', 'Conferir']);
        if (conta)
          acoes.push([
            "editarContaForm('" + _mobEsc(conta.id) + "')",
            'ph-pencil-simple',
            'Editar',
          ]);
        corpo =
          '<div class="mpw-partes">' +
          partes
            .map(
              (p) =>
                '<span><span>' +
                _mobEsc(p[0]) +
                '</span><b class="valor-mascarado">' +
                _mobEsc(_mobPatFmt(p[1])) +
                '</b></span>'
            )
            .join('') +
          '</div><div class="mpw-acoes">' +
          acoes
            .map(
              (a) =>
                '<button type="button" onclick="' +
                a[0] +
                '"><span><i class="ph ' +
                a[1] +
                '"></i></span>' +
                a[2] +
                '</button>'
            )
            .join('') +
          '</div>' +
          (x.reconciliar
            ? '<p class="mpw-aviso">Movimentos sem instituição: informe o banco no lançamento.</p>'
            : '');
      }
      const extrato =
        aberta &&
        mpEstado.extratoAberto &&
        mpEstado.extratoAberto[x.key] &&
        typeof mpRenderExtratoHtml === 'function'
          ? '<div class="mpw-extrato">' +
            mpRenderExtratoHtml(mpExtratoInstituicao(x.key, Date.now())) +
            '</div>'
          : '';
      return (
        '<article class="mpw' +
        (aberta ? ' aberta' : '') +
        '" style="--mpw-cor:' +
        cor +
        '"><button type="button" class="mpw-cab" aria-expanded="' +
        aberta +
        '" onclick="mobPatAbrirCarteira(' +
        i +
        ')"><span class="mpw-logo">' +
        _mobEsc(sigla) +
        '</span><span class="mpw-nome">' +
        _mobEsc(x.nome) +
        '<small>' +
        _mobEsc(_mobPatSubInst(x)) +
        '</small></span><b class="mpw-total valor-mascarado">' +
        _mobEsc(_mobPatFmt(x.total)) +
        '</b></button>' +
        (conta && typeof conferirAvisoHtml === 'function'
          ? conferirAvisoHtml(conta.id, x.caixa)
          : '') +
        corpo +
        '</article>' +
        extrato
      );
    })
    .join('');
  wrap.innerHTML = cab + '<div class="mpw-pilha">' + cards + '</div>';
}

function mobPatAbrirCarteira(i) {
  const lista = (typeof mpEstado !== 'undefined' && mpEstado._instituicoes) || [];
  const x = lista[i];
  if (!x) return;
  _mobPat.aberta = _mobPat.aberta === x.key ? null : x.key;
  mobPatrimonioRedesenharCarteiras();
}

/** Investido por classe: barras simples no lugar do gráfico de canvas. */
function _mobPatDesenharClasses() {
  const wrap = document.getElementById('mpMobClasses');
  const d = _mobPat.dados;
  if (!wrap || !d) return;
  const itens = Object.keys(d.porClasse || {})
    .map((cat) => ({
      cat,
      atual: d.porClasse[cat].atual || 0,
      investido: d.porClasse[cat].investido || 0,
    }))
    .filter((x) => x.atual > 0.01)
    .sort((a, b) => b.atual - a.atual);
  if (!itens.length) {
    wrap.innerHTML = '';
    return;
  }
  const total = itens.reduce((a, x) => a + x.atual, 0);
  const maior = itens[0].atual;
  wrap.innerHTML =
    '<div class="mi-tit-linha"><h2 class="mi-h2">Investido por classe</h2><button type="button" class="mi-link" onclick="mobIrPara(\'patrimonio\')">Ver carteira <i class="ph ph-caret-right"></i></button></div><div class="mi-card mpc">' +
    itens
      .map((x) => {
        const cor =
          typeof mpCorCategoria === 'function' ? mpCorCategoria(x.cat) : 'var(--cor-patrimonio)';
        const rent = x.investido > 0 ? ((x.atual - x.investido) / x.investido) * 100 : null;
        return (
          '<div class="mpc-linha"><div class="mpc-topo"><span>' +
          _mobEsc((typeof MP_LABELS !== 'undefined' && MP_LABELS[x.cat]) || x.cat) +
          '</span><span><b class="valor-mascarado">' +
          _mobEsc(_mobPatFmt(x.atual)) +
          '</b> <small>' +
          Math.round((x.atual / total) * 100) +
          '%</small></span></div><div class="mpc-trilho"><span style="background:' +
          cor +
          ';width:' +
          Math.max(2, (x.atual / maior) * 100).toFixed(1) +
          '%"></span></div>' +
          // "↑ 0%" sem histórico de cotação parecia resultado: só com o que dizer.
          (rent != null && Math.abs(rent) >= 0.05
            ? '<small class="mpc-rent ' +
              (rent >= 0 ? 'pos' : 'neg') +
              '">' +
              (rent >= 0 ? '↑ ' : '↓ ') +
              _mobPct(Math.abs(rent)) +
              ' sobre o que foi aplicado</small>'
            : '') +
          '</div>'
        );
      })
      .join('') +
    '</div>';
}

// ------------------------------------------------------------
// Carteira no celular: o questionário em quatro telas
// ------------------------------------------------------------
// As mesmas perguntas e os mesmos botões do desktop (cartConcluirQuestionario
// lê o que estiver marcado); no celular aparece uma por vez, e tocar numa
// opção já leva à próxima.
var MOB_CART_PASSOS = 4;

function _mobCartPassoAtual() {
  const q = document.getElementById('cartQuestionnaire');
  return q ? Number(q.dataset.mobPassoAtivo) || 1 : 1;
}

function _mobCartRespondido(passo) {
  const q = { 1: 'tolerancia', 2: 'objetivo', 3: 'prazo' }[passo];
  return (
    !q || !!document.querySelector('#cartQuestionnaire .cart-q-opt[data-q="' + q + '"].selected')
  );
}

function mobCartIrPasso(n) {
  const q = document.getElementById('cartQuestionnaire');
  if (!q) return;
  const passo = Math.max(1, Math.min(MOB_CART_PASSOS, Number(n) || 1));
  q.dataset.mobPassoAtivo = String(passo);
  const rot = document.getElementById('mobWizPasso');
  if (rot) rot.textContent = 'Passo ' + passo + ' de ' + MOB_CART_PASSOS;
  const btn = document.getElementById('mobWizContinuar');
  if (btn) btn.disabled = !_mobCartRespondido(passo);
  _mobCartMarcarAporte();
  if (mobEhCelular()) {
    const rol = document.querySelector('.main-content');
    if (rol) rol.scrollTop = 0;
  }
}

function mobCartPasso(delta) {
  const atual = _mobCartPassoAtual();
  if (delta > 0 && !_mobCartRespondido(atual)) return;
  mobCartIrPasso(atual + delta);
}

function mobCartAporte(v) {
  const campo = document.getElementById('cartQCapital');
  if (!campo) return;
  campo.value = Number(v).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  _mobCartMarcarAporte();
}

function _mobCartMarcarAporte() {
  const campo = document.getElementById('cartQCapital');
  const v = campo && typeof parseBRL === 'function' ? parseBRL(campo.value) : NaN;
  document.querySelectorAll('#cartQuestionnaire .mob-wiz-valores button').forEach((b) => {
    const alvo = Number((b.getAttribute('onclick') || '').replace(/\D/g, ''));
    b.setAttribute('aria-pressed', v === alvo ? 'true' : 'false');
  });
}

// Tocar numa opção marca (o handler é o do desktop) e, no celular, avança.
document.addEventListener('click', function (e) {
  const opt = e.target.closest && e.target.closest('#cartQuestionnaire .cart-q-opt');
  if (!opt || !mobEhCelular()) return;
  const atual = _mobCartPassoAtual();
  setTimeout(() => {
    if (_mobCartPassoAtual() === atual && atual < MOB_CART_PASSOS) mobCartIrPasso(atual + 1);
  }, 220);
});
document.addEventListener('input', function (e) {
  if (e.target && e.target.id === 'cartQCapital') _mobCartMarcarAporte();
});

// ------------------------------------------------------------
// Meus sonhos no celular: o topo no padrão do app
// ------------------------------------------------------------
// O mesmo resumo da "Visão geral" (renderResumoSonhos), com o guardado em
// destaque como o total do Meu patrimônio. Os números saem das mesmas
// contas: soma das metas, do guardado e de calcSonhoMensal por sonho.
function mobRenderSonhos() {
  const el = document.getElementById('sonhosMob');
  if (!el) return;
  _mobSonhosSaudeResumo();
  const lista = typeof sonhos !== 'undefined' && Array.isArray(sonhos) ? sonhos : [];
  if (!lista.length) {
    el.innerHTML = '';
    return;
  }
  const meta = lista.reduce((a, s) => a + (Number(s.valorTotal) || 0), 0);
  const guardado = lista.reduce((a, s) => a + (Number(s.valorAtual) || 0), 0);
  const falta = Math.max(0, meta - guardado);
  const mensal = lista.reduce(
    (a, s) =>
      a +
      (typeof calcSonhoMensal === 'function'
        ? calcSonhoMensal(s.valorTotal, s.valorAtual, s.mesesRestantes) || 0
        : 0),
    0
  );
  const pct = meta > 0 ? Math.min(100, (guardado / meta) * 100) : 0;
  const conquistados = lista.filter((s) => s.valorAtual >= s.valorTotal).length;
  const agendados =
    typeof statusSonho === 'function'
      ? lista.filter((s) => statusSonho(s) === 'agendado').length
      : 0;
  const fmt = (v) => _mobEsc(_mobPatFmt(v));
  const extra =
    (conquistados ? ' · ' + conquistados + ' conquistado' + (conquistados === 1 ? '' : 's') : '') +
    (agendados ? ' · ' + agendados + ' agendado' + (agendados === 1 ? '' : 's') : '');
  el.innerHTML =
    '<div class="mpm-cab"><h2 class="mpm-tit">Guardado nos sonhos</h2></div>' +
    '<p class="mpm-valor valor-mascarado">' +
    fmt(guardado) +
    '</p>' +
    '<p class="msn-sub">de <b class="valor-mascarado">' +
    fmt(meta) +
    '</b> · ' +
    pct.toFixed(0) +
    '% do total' +
    extra +
    '</p>' +
    '<div class="msn-barra" role="progressbar" aria-label="Progresso geral" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
    pct.toFixed(0) +
    '"><span style="width:' +
    pct.toFixed(1) +
    '%"></span></div>' +
    '<div class="mpm-chips">' +
    '<div class="mpm-chip"><span class="mpm-chip-dot" style="background:var(--cor-erro)"></span><span class="mpm-chip-txt"><small>Falta</small><b class="valor-mascarado">' +
    fmt(falta) +
    '</b></span></div>' +
    '<div class="mpm-chip"><span class="mpm-chip-dot" style="background:#7c3aed"></span><span class="mpm-chip-txt"><small>Por mês, somando</small><b class="valor-mascarado">' +
    fmt(mensal) +
    '</b></span></div>' +
    '</div>' +
    '<button type="button" class="msn-novo" onclick="abrirCadastroSonho()"><i class="ph-bold ph-plus"></i> Novo sonho</button>';
}

/** A linha da saúde financeira: o nível de hoje e, tocada, o painel inteiro. */
function mobSonhosSaude() {
  const b = document.getElementById('mobSonhosSaude');
  if (!b) return;
  b.setAttribute('aria-expanded', b.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
}

function _mobSonhosSaudeResumo() {
  const txt = document.getElementById('mobSonhosSaudeResumo');
  const ic = document.getElementById('mobSonhosSaudeIc');
  if (!txt || typeof analisarSaudeFinanceiraSonhos !== 'function') return;
  let a = null;
  try {
    a = analisarSaudeFinanceiraSonhos();
  } catch (e) {
    a = null;
  }
  if (!a || a.semDados) {
    txt.textContent = 'Ainda sem dados do Controle para analisar';
    if (ic) ic.style.removeProperty('--msn-cor');
    return;
  }
  const nivel = { critico: 'Crítica', frágil: 'Frágil', estável: 'Estável', forte: 'Forte' }[
    a.nivel
  ];
  txt.textContent =
    (nivel || String(a.nivel || '')) +
    ' · recomendado ' +
    _mobPatFmt(a.recomendadoSonhos || 0) +
    '/mês para sonhos';
  if (ic && a.cor) ic.style.setProperty('--msn-cor', a.cor);
}

// ------------------------------------------------------------
// Sonhos no celular: o cadastro em quatro telas
// ------------------------------------------------------------
// Os mesmos campos do desktop, uma pergunta por tela: o sonho, quanto custa,
// para quando, de onde sai o dinheiro. A tela vive em data-sonho-etapa do
// modal; o CSS mostra só os campos dela. Quem valida o conjunto e monta a
// prévia continua sendo irParaPreviaSonho, como no desktop.
var MOB_SONHO_PASSOS = 4;

function _mobSonhoModal() {
  return document.getElementById('modalSonho');
}

function _mobSonhoEtapa() {
  const m = _mobSonhoModal();
  return m ? Number(m.dataset.sonhoEtapa) || 1 : 1;
}

/** O que falta na tela para seguir; null quando está tudo certo. */
function _mobSonhoFalta(passo) {
  const val = (id) => (document.getElementById(id) || {}).value || '';
  if (passo === 1 && !val('sonhoNome').trim()) return 'Dê um nome ao seu sonho!';
  if (passo === 2 && !(parseBRL(val('sonhoValorTotal')) > 0))
    return 'Informe o valor total da meta.';
  if (passo === 3 && !(Number(val('sonhoPrazo')) >= 1)) return 'Escolha um prazo.';
  return null;
}

/** Chamada também por sonhos.js: abrir/editar volta à 1; a prévia marca "previa". */
function mobSonhoIrPasso(n) {
  const m = _mobSonhoModal();
  if (!m) return;
  if (n === 'previa') {
    m.dataset.sonhoEtapa = 'previa';
    return;
  }
  const passo = Math.max(1, Math.min(MOB_SONHO_PASSOS, Number(n) || 1));
  m.dataset.sonhoEtapa = String(passo);
  const rot = document.getElementById('sonhoWizPasso');
  if (rot) rot.textContent = 'Passo ' + passo + ' de ' + MOB_SONHO_PASSOS;
  _mobSonhoDesenharCategorias();
  _mobSonhoMarcarPrazo();
  const card = m.firstElementChild;
  if (card) card.scrollTop = 0;
}

function mobSonhoPasso(delta) {
  const m = _mobSonhoModal();
  if (m && m.dataset.sonhoEtapa === 'previa') return;
  const atual = _mobSonhoEtapa();
  if (delta > 0) {
    const falta = _mobSonhoFalta(atual);
    if (falta) return mostrarToast(falta, 'erro');
  }
  mobSonhoIrPasso(atual + delta);
  if (delta > 0 && mobEhCelular()) {
    // Leva o teclado ao primeiro campo da tela nova, como um app faz.
    const alvo = { 2: 'sonhoValorTotal' }[_mobSonhoEtapa()];
    const el = alvo && document.getElementById(alvo);
    if (el && !el.value) setTimeout(() => el.focus(), 60);
  }
}

/** Categorias em blocos de tocar, montados do próprio select (fonte única). */
function _mobSonhoDesenharCategorias() {
  const box = document.getElementById('sonhoWizCats');
  const sel = document.getElementById('sonhoCategoria');
  if (!box || !sel) return;
  if (!box.childElementCount) {
    box.innerHTML = Array.from(sel.options)
      .map((o) => {
        const txt = o.textContent.trim();
        const i = txt.indexOf(' ');
        const emoji = i > 0 ? txt.slice(0, i) : '';
        const nome = i > 0 ? txt.slice(i + 1) : txt;
        return (
          '<button type="button" data-cat="' +
          o.value +
          '" onclick="mobSonhoCategoria(\'' +
          o.value +
          '\')"><span aria-hidden="true">' +
          emoji +
          '</span>' +
          nome +
          '</button>'
        );
      })
      .join('');
  }
  box.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.cat === sel.value ? 'true' : 'false');
  });
}

function mobSonhoCategoria(valor) {
  const sel = document.getElementById('sonhoCategoria');
  if (!sel) return;
  sel.value = valor;
  sel.dispatchEvent(new Event('change'));
  _mobSonhoDesenharCategorias();
}

/** Atalho de prazo: escreve no campo de sempre (sonhoPrazo + unidade). */
function mobSonhoPrazo(meses) {
  const prazo = document.getElementById('sonhoPrazo');
  const unidade = document.getElementById('sonhoPrazoUnidade');
  if (!prazo) return;
  const emAnos = meses >= 12 && meses % 12 === 0;
  prazo.value = String(emAnos ? meses / 12 : meses);
  if (unidade) unidade.value = emAnos ? 'anos' : 'meses';
  prazo.dispatchEvent(new Event('input'));
  _mobSonhoMarcarPrazo();
}

function _mobSonhoMarcarPrazo() {
  const prazo = document.getElementById('sonhoPrazo');
  const unidade = document.getElementById('sonhoPrazoUnidade');
  if (!prazo) return;
  const n = Number(prazo.value) || 0;
  const meses = unidade && unidade.value === 'anos' ? n * 12 : n;
  document.querySelectorAll('#sonhoWizPrazos button').forEach((b) => {
    b.setAttribute('aria-pressed', Number(b.dataset.meses) === meses ? 'true' : 'false');
  });
}

document.addEventListener('input', function (e) {
  if (e.target && e.target.id === 'sonhoPrazo') _mobSonhoMarcarPrazo();
});
document.addEventListener('change', function (e) {
  if (e.target && e.target.id === 'sonhoPrazoUnidade') _mobSonhoMarcarPrazo();
});

// ------------------------------------------------------------
// Carteira no celular: a lista de compras do mês
// ------------------------------------------------------------
// O plano do motor (o mesmo objeto que cartRenderizarMotorPlano desenha em
// colunas) vira uma lista: o que comprar, quanto, e o que já foi comprado.
// "Comprado" não é uma marca à parte: é a compra registrada de verdade neste
// mês (historicoCompras). "Registrar compra" abre o formulário de operação
// de sempre, já com o ativo e a quantidade sugerida, e quem confirma é a
// pessoa.
var _mobCart = { plano: null, aberto: null };

function _mobCartItens(plano) {
  const lista = [];
  (typeof MOTOR_CLASSES !== 'undefined' ? MOTOR_CLASSES : ['rf', 'acao', 'fii', 'cripto']).forEach(
    (classe) => {
      const c = plano.classes && plano.classes[classe];
      if (c && Array.isArray(c.itens)) c.itens.forEach((it) => lista.push(it));
    }
  );
  return lista;
}

/** Quanto deste ativo foi comprado (registrado) no mês corrente. */
function _mobCartCompradoNoMes(ticker) {
  if (typeof historicoCompras === 'undefined' || !Array.isArray(historicoCompras) || !ticker)
    return 0;
  const hoje = new Date();
  const alvo = String(ticker).toUpperCase();
  return historicoCompras.reduce((acc, op) => {
    if (!op || String(op.ticker || '').toUpperCase() !== alvo) return acc;
    if ((op.tipo || 'compra') !== 'compra' || !op.data_op) return acc;
    const d = new Date(op.data_op);
    if (d.getMonth() !== hoje.getMonth() || d.getFullYear() !== hoje.getFullYear()) return acc;
    return acc + (Number(op.quantidade) || 0) * (Number(op.preco_op || op.preco_pago) || 0);
  }, 0);
}

function mobRenderCarteiraPlano(plano) {
  const el = document.getElementById('cartMobPlano');
  if (!el || !plano) return;
  _mobCart.plano = plano;
  const itens = _mobCartItens(plano);
  const nomes = typeof CART_NOMES !== 'undefined' ? CART_NOMES : {};
  const icones = typeof CART_ICONS !== 'undefined' ? CART_ICONS : {};
  const cores = {
    rf: 'var(--cor-info)',
    acao: 'var(--cor-primaria)',
    fii: 'var(--cor-patrimonio)',
    cripto: 'var(--cor-cartao)',
  };
  const esc = typeof cartEsc === 'function' ? cartEsc : _mobEsc;
  const fmt = _mobDreFmt;
  const mes = new Date().toLocaleDateString('pt-BR', { month: 'long' });

  let comprado = 0;
  let qtdComprados = 0;
  const itensComprados = new Set();
  itens.forEach((it) => {
    const v = _mobCartCompradoNoMes(it.ticker);
    if (v > 0.009) {
      comprado += v;
      qtdComprados++;
      itensComprados.add(it.ticker);
    }
  });
  const aporte = Number(plano.aporte) || 0;
  const fracComprado = aporte > 0 ? Math.min(1, comprado / aporte) : 0;

  // Anel: a fatia de cada classe no aporte.
  const C = 2 * Math.PI * 48;
  let acc = 0;
  const arcos = Object.keys(cores)
    .map((k) => {
      const c = plano.classes && plano.classes[k];
      const pct = c ? Number(c.pct) || 0 : 0;
      if (pct <= 0) return '';
      const seg =
        '<circle cx="60" cy="60" r="48" fill="none" stroke="' +
        cores[k] +
        '" stroke-width="14" stroke-dasharray="' +
        ((C * pct) / 100).toFixed(1) +
        ' ' +
        C.toFixed(1) +
        '" stroke-dashoffset="' +
        (-(C * acc) / 100).toFixed(1) +
        '"></circle>';
      acc += pct;
      return seg;
    })
    .join('');

  const grupos = Object.keys(cores)
    .map((classe) => {
      const c = plano.classes && plano.classes[classe];
      if (!c) return '';
      const aguardando = c.modo === 'aguardando_dados';
      const lista = c.itens || [];
      const corpo = aguardando
        ? '<p class="mcp-vazio">Aguardando indicadores para selecionar os ativos.</p>'
        : !lista.length
          ? '<p class="mcp-vazio">' +
            esc(
              (typeof cartMotivoSemAlocacao === 'function' &&
                cartMotivoSemAlocacao(plano, classe)) ||
                'Sem alocação nesta classe.'
            ) +
            '</p>'
          : lista
              .map((it) => {
                const i = itens.indexOf(it);
                const aberto = _mobCart.aberto === i;
                const feito = itensComprados.has(it.ticker);
                const rot =
                  typeof cartRotuloAtivo === 'function'
                    ? cartRotuloAtivo(it)
                    : { codigo: it.ticker };
                const linha =
                  typeof cartLinhaSetor === 'function' ? cartLinhaSetor(it).texto : it.nome || '';
                const score =
                  it.score === null || it.score === undefined
                    ? '<span class="mcp-nota sem">—</span>'
                    : '<span class="mcp-nota" style="background:' +
                      (typeof cartCorScore === 'function'
                        ? cartCorScore(it.score)
                        : 'var(--cor-primaria)') +
                      '">' +
                      esc(it.score) +
                      '</span>';
                const qtd =
                  it.quantidade != null && it.unidade
                    ? '<small>' + esc(motorQtdRotulo(it)) + '</small>'
                    : '';
                const detalhe = aberto
                  ? '<div class="mcp-det"><p>' +
                    (it.justificativa
                      ? esc(it.justificativa)
                      : 'Selecionado entre os mais bem pontuados da classe.') +
                    (it.trocadoDe
                      ? ' <b>Trocado por você no lugar de ' + esc(it.trocadoDe) + '.</b>'
                      : '') +
                    '</p><div class="mcp-acoes"><button type="button" class="mcp-btn1" onclick="mobCartRegistrar(' +
                    i +
                    ')">' +
                    (feito ? 'Registrar outra compra' : 'Registrar compra') +
                    '</button><button type="button" class="mcp-btn2" onclick="cartAbrirTroca(\'' +
                    esc(it.ticker) +
                    "','" +
                    esc(it.classe) +
                    '\')">Trocar</button></div><button type="button" class="mi-link" onclick="mobCartVerRanking(\'' +
                    esc(it.classe) +
                    '\')">Ver o ranking da classe <i class="ph ph-caret-right"></i></button></div>'
                  : '';
                return (
                  '<article class="mcp-item' +
                  (feito ? ' feito' : '') +
                  (aberto ? ' aberto' : '') +
                  '"><span class="mcp-chk" role="img" aria-label="' +
                  (feito ? 'Compra registrada neste mês' : 'Ainda não comprado') +
                  '"><i class="ph-bold ph-check"></i></span><button type="button" class="mcp-abre" aria-expanded="' +
                  aberto +
                  '" onclick="mobCartAbrirItem(' +
                  i +
                  ')"><span class="mcp-meio"><span class="mcp-tk"><b>' +
                  esc(rot.codigo) +
                  '</b>' +
                  score +
                  '</span><small>' +
                  esc(linha) +
                  '</small></span><span class="mcp-val"><b class="valor-mascarado">' +
                  esc(fmt(it.valorInvestido)) +
                  '</b>' +
                  qtd +
                  '</span></button>' +
                  detalhe +
                  '</article>'
                );
              })
              .join('');
      return (
        '<section class="mcp-grupo' +
        ((Number(c.pct) || 0) === 0 ? ' apagado' : '') +
        '"><div class="mcp-grupo-cab"><span class="mcp-grupo-nome"><i class="ph ' +
        (icones[classe] || 'ph-circle') +
        '" style="color:' +
        cores[classe] +
        '"></i>' +
        esc(nomes[classe] || classe) +
        '</span><span class="mcp-grupo-meta"><b>' +
        (Number(c.pct) || 0) +
        '%</b> · <span class="valor-mascarado">' +
        esc(fmt(c.alvo)) +
        '</span></span></div>' +
        corpo +
        '</section>'
      );
    })
    .join('');

  const retido = Number(plano.retido) || 0;
  // Os avisos do motor (por que uma classe ficou retida) vão para "Sobre
  // estes dados": explicam a procedência, não são a lista de compras.
  const elAvisos = document.getElementById('cartMobAvisos');
  if (elAvisos)
    elAvisos.innerHTML = (plano.avisos || [])
      .map((a) => '<p><i class="ph ph-info"></i> ' + a + '</p>')
      .join('');
  const avisos = '';

  el.innerHTML =
    '<h2 class="mcp-tit">Compras de ' +
    esc(mes) +
    '</h2>' +
    '<div class="mi-card mcp-topo"><svg class="mcp-anel" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="48" fill="none" stroke="var(--cor-borda)" stroke-width="14"></circle>' +
    arcos +
    '</svg><div class="mcp-prog"><span class="mi-rot">Comprado até agora</span><b class="valor-mascarado">' +
    esc(fmt(comprado)) +
    '</b><small>de <span class="valor-mascarado">' +
    esc(fmt(aporte)) +
    '</span> · ' +
    qtdComprados +
    ' de ' +
    itens.length +
    ' ativos</small><span class="mcp-barra"><span style="width:' +
    (fracComprado * 100).toFixed(1) +
    '%"></span></span></div></div>' +
    '<div class="mcp-nums"><div><small>Aporte</small><b class="valor-mascarado">' +
    esc(fmt(aporte)) +
    '</b></div><div><small>Distribuído</small><b class="valor-mascarado">' +
    esc(fmt(plano.totalInvestido)) +
    '</b></div><div><small>' +
    (retido > 0.009 ? 'Retido' : 'Sobra') +
    '</small><b class="valor-mascarado">' +
    esc(fmt(retido > 0.009 ? retido : plano.sobra)) +
    '</b></div></div>' +
    grupos +
    avisos;
}

function mobCartAbrirItem(i) {
  _mobCart.aberto = _mobCart.aberto === i ? null : i;
  if (_mobCart.plano) mobRenderCarteiraPlano(_mobCart.plano);
}

function mobCartVerRanking(classe) {
  mobCartSecao('rank', true);
  if (typeof cartTrocarClasseRanking === 'function') cartTrocarClasseRanking(classe);
  const r = document.getElementById('cartMotorRanking');
  if (r && typeof r.scrollIntoView === 'function')
    r.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/**
 * Abre o "Registrar operação" de sempre com o ativo e, quando o plano tem,
 * a quantidade e o preço sugeridos. Nada é gravado aqui: quem confere e
 * salva é a pessoa, no formulário.
 */
function mobCartRegistrar(i) {
  const it = _mobCart.plano ? _mobCartItens(_mobCart.plano)[i] : null;
  if (!it || typeof abrirDrawerOperacao !== 'function') return;
  abrirDrawerOperacao({ semFoco: true });
  const pos = (id, v) => {
    const el = document.getElementById(id);
    if (!el || v == null || v === '') return;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  pos('compraTicker', it.ticker);
  if (typeof ajustarCamposPorCategoria === 'function') ajustarCamposPorCategoria();
  if (it.quantidade != null && it.preco) {
    pos('compraQtd', String(it.quantidade).replace('.', ','));
    pos(
      'compraPreco',
      typeof formatarBRLInput === 'function' ? formatarBRLInput(it.preco) : String(it.preco)
    );
  }
}

// Quando o formulário de operação fecha (salvou ou desistiu), a lista de
// compras relê o que foi registrado no mês.
document.addEventListener('DOMContentLoaded', function () {
  const drawer = document.getElementById('drawerOperacao');
  if (!drawer || typeof MutationObserver === 'undefined') return;
  let aberto = drawer.classList.contains('aberto');
  new MutationObserver(function () {
    const agora = drawer.classList.contains('aberto');
    if (aberto && !agora && _mobCart.plano) mobRenderCarteiraPlano(_mobCart.plano);
    aberto = agora;
  }).observe(drawer, { attributes: true, attributeFilter: ['class'] });
});

// ------------------------------------------------------------
// Meu patrimônio no celular: contas e bens como listas de app
// ------------------------------------------------------------
// Uma linha por conta ou bem, com o essencial à vista; tocar abre as ações
// logo abaixo (as mesmas funções do desktop). Chamadas pelo render original
// de cada lista, então seguem cada mudança.
var _mobListas = { conta: null, bem: null };

function mobListaAbrir(tipo, id) {
  _mobListas[tipo] = _mobListas[tipo] === id ? null : id;
  if (tipo === 'conta') mobRenderContas();
  else mobRenderBens();
}

/** `abrir` (opcional): o que o toque na linha faz no lugar de mostrar as ações
 *  — o bem abre o painel de detalhe, como no canvas. */
function _mobLinhaLista(tipo, id, icone, cor, nome, sub, valor, acoes, apagada, abrir) {
  const aberta = !abrir && _mobListas[tipo] === id;
  return (
    '<div class="mpl-item' +
    (aberta ? ' aberta' : '') +
    (apagada ? ' apagada' : '') +
    '"><button type="button" class="mpl-cab" aria-expanded="' +
    aberta +
    '" onclick="' +
    (abrir || "mobListaAbrir('" + tipo + "','" + _mobEsc(id) + "')") +
    '"><span class="mpl-ic" style="--mpl-cor:' +
    cor +
    '"><i class="ph ' +
    icone +
    '"></i></span><span class="mpl-txt"><b>' +
    _mobEsc(nome) +
    '</b><small>' +
    sub +
    '</small></span>' +
    (valor ? '<span class="mpl-val valor-mascarado">' + _mobEsc(valor) + '</span>' : '') +
    '<i class="ph ph-caret-down mpl-seta"></i></button>' +
    (aberta
      ? '<div class="mpl-acoes">' +
        acoes
          .map(
            (a) =>
              '<button type="button" class="' +
              (a[3] || '') +
              '" onclick="' +
              a[0] +
              '"><i class="ph ' +
              a[1] +
              '"></i>' +
              a[2] +
              '</button>'
          )
          .join('') +
        '</div>'
      : '') +
    '</div>'
  );
}

function mobRenderContas() {
  const el = document.getElementById('mpMobContas');
  if (!el || typeof contas === 'undefined') return;
  const ativas =
    typeof contasAtivas === 'function' ? contasAtivas() : contas.filter((c) => !c.arquivada);
  const ordem = ativas.concat(contas.filter((c) => c.arquivada));
  const tipos = {};
  (typeof CONTA_TIPOS !== 'undefined' ? CONTA_TIPOS : []).forEach((t) => {
    tipos[t.v] = t.label.replace(/^[^\wÀ-ú]+\s*/, '');
  });
  const icones = { banco: 'ph-bank', corretora: 'ph-chart-line-up', carteira: 'ph-wallet' };
  // As contas já aparecem uma a uma em "Onde está o dinheiro", com saldo e
  // ações. Aqui fica o cadastro (saldo de partida, fundir, arquivar,
  // restaurar), recolhido para não repetir a mesma lista logo abaixo.
  if (!ordem.length) {
    el.innerHTML =
      '<p class="mi-vazio">Nenhuma conta cadastrada. Não é preciso para lançar: o nome do banco no lançamento já basta. Cadastre para informar o saldo que já tem.</p>';
    return;
  }
  const aberto = el.querySelector && el.querySelector('details[open]') ? ' open' : '';
  el.innerHTML =
    '<details class="mpm-gerenciar"' +
    aberto +
    '><summary><i class="ph ph-gear-six"></i> Gerenciar contas (' +
    ordem.length +
    ')</summary>' +
    '<div class="mi-card mpl">' +
    ordem
      .map((c) => {
        const id = String(c.id);
        const saldo = Number(c.saldoInicial) || 0;
        const sub =
          _mobEsc(tipos[c.tipo] || c.tipo || 'Conta') +
          ' · ' +
          (c.arquivada
            ? 'arquivada'
            : c.conferidoEm
              ? 'conferido em ' +
                _mobEsc(new Date(c.conferidoEm).toLocaleDateString('pt-BR').slice(0, 5))
              : saldo
                ? 'saldo inicial ' + _mobEsc(_mobDreFmt(saldo))
                : 'sem saldo inicial');
        const idJs = "'" + _mobEsc(id) + "'";
        const acoes = c.arquivada
          ? [['restaurarContaUI(' + idJs + ')', 'ph-arrow-counter-clockwise', 'Restaurar']]
          : [
              ['editarContaForm(' + idJs + ')', 'ph-pencil-simple', 'Editar'],
              ['fundirContaPrompt(' + idJs + ')', 'ph-arrows-merge', 'Fundir'],
              ['arquivarContaUI(' + idJs + ')', 'ph-archive', 'Arquivar', 'perigo'],
            ];
        return _mobLinhaLista(
          'conta',
          id,
          icones[c.tipo] || 'ph-piggy-bank',
          'var(--cor-info)',
          c.nome,
          sub,
          '',
          acoes,
          c.arquivada
        );
      })
      .join('') +
    '</div></details>';
}

function mobRenderBens() {
  const el = document.getElementById('mpMobBens');
  if (!el || typeof bens === 'undefined') return;
  const ativos = typeof bensAtivos === 'function' ? bensAtivos() : bens.filter((b) => !b.arquivado);
  const todos = ativos.concat(bens.filter((b) => b.arquivado));
  const icones = {};
  (typeof BEM_TIPOS !== 'undefined' ? BEM_TIPOS : []).forEach((t) => {
    icones[t.v] = t.icon;
  });
  const cab =
    '<div class="mi-tit-linha"><h2 class="mi-h2">Bens e dívidas</h2><button type="button" class="mi-link" onclick="abrirNovoBemForm()"><i class="ph ph-plus"></i> Bem</button></div>';
  // Faturas em aberto entram aqui como dívida (as mesmas do balanço do web).
  const faturas =
    typeof mpDividaCartoes === 'function'
      ? mpDividaCartoes(new Date())
          .map(
            (f) =>
              '<button type="button" class="mpl-fatura" data-cartao="' +
              _mobEsc(String(f.cartaoId)) +
              '" onclick="abrirFaturas(this.dataset.cartao, \'atual\')"><span class="mpl-fatura-ic"><i class="ph ph-credit-card"></i></span><span><b>Fatura ' +
              _mobEsc(f.nome) +
              '</b><small>em aberto</small></span><b class="valor-mascarado neg">−' +
              _mobEsc(_mobDreFmt(f.valor)) +
              '</b></button>'
          )
          .join('')
      : '';
  if (!todos.length && !faturas) {
    el.innerHTML =
      cab +
      '<p class="mi-vazio">Nenhum bem cadastrado. Imóveis e veículos entram no seu patrimônio.</p>';
    return;
  }
  el.innerHTML =
    cab +
    '<div class="mi-card mpl">' +
    todos
      .map((b) => {
        const id = String(b.id);
        const idJs = "'" + _mobEsc(id) + "'";
        const fin = b.financiamento;
        const financiado = !b.arquivado && fin && fin.ativo && fin.saldoDevedor > 0;
        const partes = [];
        if (b.arquivado) partes.push('arquivado');
        if (financiado) partes.push('devendo ' + _mobEsc(_mobDreFmt(fin.saldoDevedor)));
        else if (b.tipo === 'imovel' || b.tipo === 'veiculo')
          partes.push(fin && fin.ativo ? 'financiado' : 'quitado');
        if (b.fipe && b.fipe.codigoFipe) partes.push('FIPE ' + _mobEsc(b.fipe.mesReferencia || ''));
        if (
          financiado &&
          typeof finConflitoNaoRevisado === 'function' &&
          finConflitoNaoRevisado(fin)
        )
          partes.push('<span class="mpl-alerta">confira a taxa</span>');
        const acoes = [];
        if (b.arquivado) {
          acoes.push([
            'editarBem(' + idJs + ',{arquivado:false});renderMeusBens();',
            'ph-arrow-counter-clockwise',
            'Restaurar',
          ]);
        } else {
          if (financiado) {
            acoes.push(['abrirModalAmortizacao(' + idJs + ')', 'ph-scissors', 'Antecipar']);
            acoes.push(['abrirAnaliseBem(' + idJs + ')', 'ph-receipt', 'Analisar']);
          }
          if (b.fipe && b.fipe.codigoFipe)
            acoes.push(['bemAtualizarFipe(' + idJs + ')', 'ph-arrows-clockwise', 'FIPE']);
          acoes.push(['editarBemForm(' + idJs + ')', 'ph-pencil-simple', 'Editar']);
          acoes.push(['confirmarExcluirBem(' + idJs + ')', 'ph-trash', 'Excluir', 'perigo']);
        }
        return _mobLinhaLista(
          'bem',
          id,
          icones[b.tipo] || 'ph-package',
          b.tipo === 'imovel' ? 'var(--cor-cartao)' : 'var(--cor-patrimonio)',
          b.nome,
          partes.join(' · ') || ' ',
          b.valorAtual ? _mobDreFmt(b.valorAtual) : '—',
          acoes,
          b.arquivado,
          b.arquivado || typeof bemPainelAbrir !== 'function' ? '' : 'bemPainelAbrir(' + idJs + ')'
        );
      })
      .join('') +
    faturas +
    '</div>';
}

// ------------------------------------------------------------
// Carteira no celular: cabeçalho e seções recolhidas
// ------------------------------------------------------------
// O perfil vira um chip que reabre o questionário; "Sobre o perfil" abre o
// texto ali mesmo; os atalhos são os do desktop (personalizar, voltar à
// recomendação, atualizar os dados). Ranking, simulação e critérios ficam
// atrás de uma linha cada: estão a um toque, mas não empurram a lista de
// compras para longe.
var _mobCartSobre = false;

function mobRenderCarteiraCab() {
  const el = document.getElementById('cartMobCab');
  if (!el || typeof cartEstado === 'undefined') return;
  const p = cartEstado.perfil;
  if (!p) {
    el.innerHTML = '';
    return;
  }
  const msg =
    (typeof CART_MENSAGENS !== 'undefined' && (CART_MENSAGENS[p] || CART_MENSAGENS.Moderado)) || {};
  const ligado = typeof cartCustomAtivo === 'function' && cartCustomAtivo();
  el.innerHTML =
    '<div class="mcc-topo"><span class="mcc-rot">Carteira sugerida</span>' +
    '<button type="button" class="mcc-chip" onclick="cartEditarPerfil()" aria-label="Editar perfil e aporte">' +
    _mobEsc(p) +
    ' · <span class="valor-mascarado">' +
    _mobEsc('R$ ' + Math.round(cartEstado.capital || 0).toLocaleString('pt-BR')) +
    '</span>/mês <i class="ph ph-pencil-simple"></i></button></div>' +
    (ligado
      ? '<p class="mcc-tag"><i class="ph ph-sliders-horizontal"></i> Personalizada por você</p>'
      : '') +
    '<button type="button" class="mcc-sobre" aria-expanded="' +
    _mobCartSobre +
    '" onclick="mobCartAlternarSobre()">Sobre o perfil ' +
    _mobEsc(p.toLowerCase()) +
    ' <i class="ph ph-caret-down"></i></button>' +
    (_mobCartSobre && msg.texto ? '<p class="mcc-msg">' + msg.texto + '</p>' : '') +
    '<div class="mcc-botoes"><button type="button" onclick="cartAbrirCustom()"><i class="ph ph-sliders-horizontal"></i> ' +
    (ligado ? 'Ajustar minha carteira' : 'Personalizar classes') +
    '</button>' +
    (ligado
      ? '<button type="button" onclick="cartRestaurarRecomendacao()" aria-label="Voltar à sugestão padrão"><i class="ph ph-arrow-counter-clockwise"></i></button>'
      : '') +
    '<button type="button" onclick="cartAtualizarMotor()" aria-label="Atualizar a sugestão"><i class="ph ph-arrows-clockwise"></i></button></div>';
}

function mobCartAlternarSobre() {
  _mobCartSobre = !_mobCartSobre;
  mobRenderCarteiraCab();
}

/** Abre ou fecha uma seção recolhida da Carteira (rank, sim, crit). */
function mobCartSecao(nome, abrir) {
  const sec = document.getElementById('carteira');
  if (!sec) return;
  const cls = 'mob-aberto-' + nome;
  const on = typeof abrir === 'boolean' ? abrir : !sec.classList.contains(cls);
  sec.classList.toggle(cls, on);
  const row = document.getElementById('mobCartRow' + nome.charAt(0).toUpperCase() + nome.slice(1));
  if (row) row.setAttribute('aria-expanded', on ? 'true' : 'false');
  // O gráfico da simulação é desenhado num canvas escondido: ao abrir, ele
  // precisa do tamanho real.
  if (on && nome === 'sim') window.dispatchEvent(new Event('resize'));
}

/** Resultado do simulador no celular: Investindo ou INSS, uma aba de cada vez. */
function mobSimComparar(lado) {
  const grade = document.getElementById('simCompGrade');
  if (!grade) return;
  const l = lado === 'inss' ? 'inss' : 'inv';
  grade.dataset.mobLado = l;
  document.querySelectorAll('#simulador .mob-sim-comp button').forEach((b) => {
    b.setAttribute('aria-selected', b.dataset.lado === l ? 'true' : 'false');
  });
}
