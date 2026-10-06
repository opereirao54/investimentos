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

var _mobDreTabela = false;

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
  const meses = d.meses;
  const fmt = _mobDreFmt;
  const resultados = meses.map((m) => m.saldoAcumulado || 0);
  const maxAbs = Math.max(1, ...resultados.map((v) => Math.abs(v)));
  const temNeg = resultados.some((v) => v < 0);
  const maxPos = Math.max(0, ...resultados);
  const maxNeg = Math.max(0, ...resultados.map((v) => -v));
  // Linha do zero proporcional ao que existe acima e abaixo dela.
  const fracPos = temNeg ? maxPos / (maxPos + maxNeg || 1) : 1;

  // Alerta: o primeiro mês do horizonte em que o resultado fica negativo.
  const iNeg = resultados.findIndex((v) => v < 0);
  let alerta = '';
  if (iNeg > -1) {
    alerta =
      '<button type="button" class="mdre-alerta" onclick="mobDreIrPara(' +
      iNeg +
      ')"><i class="ph-fill ph-warning-circle"></i><span>Em <strong>' +
      d.rotulos[iNeg] +
      '</strong> o caixa fica negativo: <strong>' +
      fmt(resultados[iNeg]) +
      '</strong></span><i class="ph ph-caret-right"></i></button>';
  } else {
    const iMin = resultados.indexOf(Math.min(...resultados));
    alerta =
      '<div class="mdre-alerta ok"><i class="ph-fill ph-check-circle"></i><span>Sem mês negativo no período. O menor resultado é <strong>' +
      fmt(resultados[iMin]) +
      '</strong>, em ' +
      d.rotulos[iMin] +
      '.</span></div>';
  }

  // Barras: uma por mês; rótulo a cada N para não encavalar.
  const passo = meses.length > 24 ? 6 : meses.length > 12 ? 3 : 1;
  const barras = meses
    .map((m, i) => {
      const v = resultados[i];
      const h = Math.max(2, Math.round((Math.abs(v) / maxAbs) * 100));
      const cls = _mobDreClasse(v, d);
      const rot = i % passo === 0 || i === d.indiceAtual ? d.rotulos[i].split('/')[0] : '';
      return (
        '<button type="button" class="mdre-barra ' +
        cls +
        (i === d.indiceAtual ? ' atual' : '') +
        '" data-i="' +
        i +
        '" onclick="mobDreIrPara(' +
        i +
        ')" aria-label="' +
        d.rotulos[i] +
        ': ' +
        fmt(v) +
        '"><span class="mdre-col"><span class="mdre-pos"' +
        (v >= 0 ? ' style="height:' + h + '%"' : '') +
        '></span><span class="mdre-neg"' +
        (v < 0 ? ' style="height:' + h + '%"' : '') +
        '></span></span><span class="mdre-rot">' +
        rot +
        '</span></button>'
      );
    })
    .join('');

  // Cartões: só as linhas com movimento naquele mês.
  const linha = (rot, v, cls, sinal) =>
    Math.abs(v) < 0.005
      ? ''
      : '<div class="mdre-linha"><span>' +
        rot +
        '</span><span class="mdre-v ' +
        cls +
        '">' +
        (sinal === '-' ? '−' : sinal === '+' ? '+' : '') +
        fmt(Math.abs(v)) +
        '</span></div>';
  const cartoes = meses
    .map((m, i) => {
      const v = resultados[i];
      const atual = i === d.indiceAtual;
      const inv = (m.invFixo || 0) + (m.invVar || 0);
      const acum = d.acumulado ? d.acumulado[i] : 0;
      const antes = i === 0 ? d.acumuladoInicial || 0 : d.acumulado[i - 1];
      const deltaAcum = acum - antes;
      const lapis = atual
        ? ' <button type="button" class="mdre-lapis" aria-label="Ajustar saldo trazido" onclick="editarSaldoMesAnterior(' +
          m.mes +
          ',' +
          m.ano +
          ')"><i class="ph ph-pencil-simple"></i></button>'
        : '';
      const herdado =
        Math.abs(m.saldoCarregado || 0) < 0.005
          ? ''
          : '<div class="mdre-linha herdado"><span>Saldo anterior' +
            lapis +
            '</span><span class="mdre-v ' +
            (m.saldoCarregado < 0 ? 'neg' : 'roxo') +
            '">' +
            fmt(m.saldoCarregado) +
            '</span></div>';
      const corpo =
        linha('Receita', m.receita, 'verde', '+') +
        linha('Resgates', m.resgate, 'verde', '+') +
        linha('Despesas', m.despesas, 'vermelho', '-') +
        linha('Investimentos', inv, 'azul', '-') +
        linha('Aporte externo', m.invExterno, 'mudo', '') +
        linha('Sonhos', m.sonho, 'roxo', '-') +
        herdado;
      return (
        '<article class="mdre-card' +
        (atual ? ' atual' : '') +
        '" id="mdreCard' +
        i +
        '" data-i="' +
        i +
        '"><header><span class="mdre-mes">' +
        d.rotulos[i] +
        '</span>' +
        (atual ? '<span class="mdre-tag">mês em foco</span>' : '') +
        '</header><div class="mdre-res-rot">Resultado do mês</div><div class="mdre-res ' +
        _mobDreClasse(v, d) +
        '">' +
        fmt(v) +
        '</div><div class="mdre-linhas">' +
        (corpo || '<div class="mdre-vazio">Sem movimentos neste mês.</div>') +
        '</div><footer><span>Investimento acumulado</span><span><strong>' +
        fmt(acum) +
        '</strong>' +
        (Math.abs(deltaAcum) < 0.005
          ? ''
          : ' <em class="' +
            (deltaAcum < 0 ? 'neg' : '') +
            '">' +
            (deltaAcum > 0 ? '+' : '−') +
            fmt(Math.abs(deltaAcum)).replace('R$', '').trim() +
            '</em>') +
        '</span></footer></article>'
      );
    })
    .join('');

  alvo.innerHTML =
    alerta +
    '<div class="mdre-grafico" style="--mdre-zero:' +
    (fracPos * 100).toFixed(1) +
    '%">' +
    barras +
    '</div><div class="mdre-cards" id="mdreCards">' +
    cartoes +
    '</div><button type="button" class="mdre-tabela-btn" onclick="mobDreAlternarTabela()" aria-expanded="' +
    (_mobDreTabela ? 'true' : 'false') +
    '"><i class="ph ph-table"></i> ' +
    (_mobDreTabela ? 'Esconder tabela completa' : 'Ver tabela completa') +
    '</button>';

  // Abre no mês em foco (sem animação) e acende a barra dele.
  const foco = Math.max(0, Math.min(meses.length - 1, d.indiceAtual));
  mobDreIrPara(foco, true);
  _mobDreLigarRolagem();
}

/** Leva o carrossel ao cartão do mês i e acende a barra correspondente. */
function mobDreIrPara(i, instantaneo) {
  const trilho = document.getElementById('mdreCards');
  const card = document.getElementById('mdreCard' + i);
  if (trilho && card) {
    trilho.scrollTo({
      left: card.offsetLeft - trilho.offsetLeft - 16,
      behavior: instantaneo ? 'auto' : 'smooth',
    });
  }
  _mobDreAcender(i);
}

function _mobDreAcender(i) {
  document.querySelectorAll('#mobDRE .mdre-barra').forEach((b) => {
    b.classList.toggle('sel', Number(b.dataset.i) === i);
  });
}

// Deslizar os cartões também move o destaque nas barras.
function _mobDreLigarRolagem() {
  const trilho = document.getElementById('mdreCards');
  if (!trilho || trilho.dataset.ligado) return;
  trilho.dataset.ligado = '1';
  let t = null;
  trilho.addEventListener(
    'scroll',
    () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const cards = trilho.querySelectorAll('.mdre-card');
        let melhor = 0;
        let dist = Infinity;
        cards.forEach((c) => {
          const dd = Math.abs(c.offsetLeft - trilho.offsetLeft - 16 - trilho.scrollLeft);
          if (dd < dist) {
            dist = dd;
            melhor = Number(c.dataset.i);
          }
        });
        _mobDreAcender(melhor);
      }, 80);
    },
    { passive: true }
  );
}

function mobDreAlternarTabela() {
  _mobDreTabela = !_mobDreTabela;
  const sec = document.getElementById('controle');
  if (sec) sec.classList.toggle('mob-dre-tabela', _mobDreTabela);
  const btn = document.querySelector('#mobDRE .mdre-tabela-btn');
  if (btn) {
    btn.setAttribute('aria-expanded', _mobDreTabela ? 'true' : 'false');
    btn.innerHTML =
      '<i class="ph ph-table"></i> ' +
      (_mobDreTabela ? 'Esconder tabela completa' : 'Ver tabela completa');
  }
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

  // Toque simples na linha (fora dos botões) abre/fecha o painel: o deslize
  // não é descobrível por todo mundo.
  lista.addEventListener('click', (e) => {
    if (!mobEhCelular()) return;
    if (e.target.closest('button')) {
      _mobExtFecharTodos(null);
      return;
    }
    const item = e.target.closest('.extrato-item');
    if (!item) return;
    const abrir = !item.classList.contains('mob-acoes');
    _mobExtFecharTodos(item);
    item.classList.toggle('mob-acoes', abrir);
  });
}

document.addEventListener('DOMContentLoaded', _mobLigarExtrato);

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
// Início no celular: resposta primeiro, detalhe depois
// ------------------------------------------------------------
// O Resumo era o desktop em fila: dois cartões-herói, cinco indicadores,
// termômetro, composição — e a pergunta de quem abre o app ("quanto ainda
// posso gastar?") ficava diluída. No celular o topo vira um cartão só, com
// o livre para gastar, quanto isso dá por dia e três anéis (gastos,
// investido, sonhos). Logo abaixo, os atalhos do dia a dia. Os blocos
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
  const metas = Array.isArray(d.sonhos) ? d.sonhos.filter((s) => s && !s.arquivado) : [];
  const alvo = metas.reduce((a, s) => a + (Number(s.valorTotal) || 0), 0);
  const guardado = metas.reduce(
    (a, s) => a + Math.min(Number(s.valorAtual) || 0, Number(s.valorTotal) || 0),
    0
  );
  const pSonhos = alvo > 0 ? (guardado / alvo) * 100 : 0;
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
      frac: alvo > 0 ? guardado / alvo : 0,
      val: metas.length ? _mobPct(pSonhos) : '—',
      sub: metas.length
        ? 'guardado de ' + metas.length + (metas.length === 1 ? ' meta' : ' metas')
        : 'nenhum sonho cadastrado',
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

function _mobDiasRestantes(mes, ano) {
  const hoje = new Date();
  if (hoje.getMonth() !== mes || hoje.getFullYear() !== ano) return 0;
  return new Date(ano, mes + 1, 0).getDate() - hoje.getDate() + 1;
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
  return (
    '<li class="mi-mov"><span class="mi-mov-ic' +
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

  const livre = Number(d.saldoLivre) || 0;
  const dias = _mobDiasRestantes(d.mes, d.ano);
  const fimMes = new Date(d.ano, d.mes + 1, 0).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
  const porDia =
    dias > 0 && livre > 0
      ? '≈ <b class="valor-mascarado">' +
        _mobEsc(_mobDreFmt(livre / dias)) +
        '</b> por dia até ' +
        fimMes
      : livre < 0
        ? 'O mês fechou no vermelho: saiu mais do que entrou.'
        : noMes
          ? 'Tudo o que entrou já tem destino.'
          : 'o que sobrou de tudo o que entrou no mês';

  const scoreEl = document.getElementById('termChipScore');
  const rotEl = document.getElementById('termChipRotulo');
  const score = scoreEl ? (scoreEl.textContent || '').trim() : '';
  const rot = rotEl ? (rotEl.textContent || '').trim() : '';
  const termo =
    '<button type="button" class="mi-termo" onclick="abrirRelatorioDoMesVisao()">' +
    '<span class="mi-termo-chip"><i class="ph ph-thermometer"></i> ' +
    _mobEsc(score && score !== '—' ? score + ' · ' + rot : rot || '—') +
    '</span><span class="mi-termo-txt">Relatório do mês</span><i class="ph ph-caret-right"></i></button>';

  const a = _mobAneis(d);
  const leg = MOB_ANEIS.map(
    (x) =>
      '<button type="button" class="mi-leg" data-anel="' +
      x.k +
      '" aria-pressed="' +
      (_mobAnelRealce === x.k ? 'true' : 'false') +
      '" onclick="mobAnelRealcar(\'' +
      x.k +
      '\')"><span class="mi-leg-dot" style="background:' +
      (x.k === 'gastos' && a.gastos.alerta ? 'var(--cor-erro)' : x.cor) +
      '"></span><span class="mi-leg-txt"><b>' +
      x.nome +
      '</b><small>' +
      _mobEsc(a[x.k].sub) +
      '</small></span><span class="mi-leg-val">' +
      _mobEsc(a[x.k].val) +
      '</span></button>'
  ).join('');

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
    (noMes ? 'Livre para gastar' : 'Saldo livre do mês') +
    '</span><span class="mi-livre valor-mascarado' +
    (livre < 0 ? ' neg' : '') +
    (_mobDreFmt(livre).length > 10 ? ' longo' : '') +
    '">' +
    _mobEsc(_mobDreFmt(livre)) +
    '</span><span class="mi-dia">' +
    porDia +
    '</span></div>' +
    _mobSvgAneis(a) +
    '</div>' +
    _mobLinhaCarregado(d) +
    conta +
    '<div class="mi-legs">' +
    leg +
    '</div></section>' +
    '<nav class="mi-atalhos" aria-label="Atalhos">' +
    atalhos +
    '</nav>';

  const comp = document.getElementById('mobComposicao');
  if (comp) comp.innerHTML = _mobComposicao(d.composicao);
  const prox = document.getElementById('mobProximos');
  if (prox) prox.innerHTML = _mobProximos(d.vencimentos, d.hojeStr);

  const movs = _mobMovimentos(d.mes, d.ano);
  fim.innerHTML =
    _mobCartaoProjecao() +
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
    '<div class="mob-story-corpo">' +
    insightsUiCard(ins, serie) +
    '</div>' +
    '<button type="button" class="mob-story-zona ant" aria-label="Anterior" onclick="mobStoryPassar(-1)"' +
    (i === 0 ? ' disabled' : '') +
    '></button>' +
    '<button type="button" class="mob-story-zona prox" aria-label="Próximo" onclick="mobStoryPassar(1)"></button>';
  tela.hidden = false;
  document.body.classList.add('mob-story-aberta');
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
      ? 'Saldo de ' + ant + ' ajustado para '
      : 'Inclui o que sobrou de ' + ant + ': ') +
    '<b class="valor-mascarado' +
    (v < 0 ? ' neg' : '') +
    '">' +
    _mobEsc(_mobDreFmt(v)) +
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
        '%"></span></span></span><span class="mc-pct">' +
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
    '<div class="mc-seg" role="tablist" aria-label="Agrupar">' +
    '<button type="button" role="tab" aria-selected="' +
    !despesa +
    '" onclick="setAgrupamentoComposicao(\'contabil\')">Destino do dinheiro</button>' +
    '<button type="button" role="tab" aria-selected="' +
    despesa +
    '" onclick="setAgrupamentoComposicao(\'despesa\')">Tipo de gasto</button></div>' +
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
          '"><div class="mp-topo"><span class="mp-dia">' +
          dia.rot +
          '</span><span class="mp-ic"><i class="ph ph-credit-card"></i></span></div><div class="mp-corpo"><b>' +
          _mobEsc(nome) +
          '</b><small>' +
          n +
          (n === 1 ? ' compra' : ' compras') +
          '</small><span class="mp-val valor-mascarado">' +
          _mobEsc(_mobDreFmt(g.total)) +
          '</span></div><button type="button" class="mp-btn" onclick="abrirModalGrupoCartao(\'' +
          _mobEsc(key) +
          '\')">Ver fatura</button></article>'
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
    '<section class="mp"><div class="mi-tit-linha"><h2 class="mi-h2">Próximos dias</h2><span class="mc-total"><b class="valor-mascarado">' +
    _mobEsc(_mobDreFmt(total)) +
    '</b> a pagar</span></div><div class="mp-fila">' +
    cards +
    '</div></section>'
  );
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
    (nomeConta
      ? '<div class="mf-info"><i class="ph ph-bank"></i><span>Sai de <b>' +
        _mobEsc(nomeConta) +
        '</b></span></div>'
      : '') +
    '<button type="button" class="mf-btn1" onclick="mobConfirmarBaixa(\'' +
    idEsc +
    '\')">Confirmar pagamento</button>' +
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
  // confirmarPagamento lê o mesmo campo pelo id; a folha fecha depois.
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

var _mobPat = { dados: null, serie: null, liquido: false, periodo: 12, aberta: null };
var MOB_PAT_CORES = ['#047857', '#1d4ed8', '#6d28d9', '#b45309', '#0e7490', '#be185d'];
var MOB_PAT_PERIODOS = [
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
  return _mobPat.periodo > 0 ? s.slice(-_mobPat.periodo) : s;
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
  const liquido = _mobPat.liquido && divida > 0;
  const total = k.total - (liquido ? divida : 0);
  const serie = _mobPatSerieVisivel();
  const g = _mobPatGrafico(serie);
  const quando = 'Posição de ' + new Date(d.posicaoMs || Date.now()).toLocaleDateString('pt-BR');
  const base = serie.length > 1 ? serie[0] : null;
  // O gráfico é sempre o bruto: não há histórico do saldo devedor dos
  // financiamentos, e descontar a dívida de hoje do passado inventaria números.
  const delta = base && !liquido ? _mobPatDelta(k.total, base.total, _mobPatRotuloMes(base)) : null;

  const seg =
    divida > 0
      ? '<div class="mpm-seg" role="tablist" aria-label="Como somar">' +
        '<button type="button" role="tab" aria-selected="' +
        !liquido +
        '" onclick="mobPatAlternarLiquido(false)">Bruto</button>' +
        '<button type="button" role="tab" aria-selected="' +
        liquido +
        '" onclick="mobPatAlternarLiquido(true)">Líquido</button></div>'
      : '';
  const nota = liquido
    ? '<p class="mpm-nota">Descontados <b class="valor-mascarado">' +
      _mobEsc(_mobPatFmt(divida)) +
      '</b> de financiamentos. O gráfico mostra o bruto.</p>'
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
  const chips = partes
    .map(
      (p) =>
        '<button type="button" class="mpm-chip" onclick="mobPatIrPara(\'' +
        p[3] +
        '\')"><span class="mpm-chip-dot" style="background:' +
        p[2] +
        '"></span><span class="mpm-chip-txt"><small>' +
        p[0] +
        (soma > 0 ? ' · ' + Math.round((Math.max(0, p[1]) / soma) * 100) + '%' : '') +
        '</small><b class="valor-mascarado">' +
        _mobEsc(_mobPatFmt(p[1])) +
        '</b></span></button>'
    )
    .join('');

  topo.innerHTML =
    '<div class="mpm-cab"><p class="mpm-tit">Patrimônio ' +
    (liquido ? 'líquido' : 'total') +
    '</p>' +
    seg +
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
    (partes.length
      ? '<section class="mpm-comp"><h2 class="mi-h2">Do que ele é feito</h2><div class="mc-barra" aria-hidden="true">' +
        barra +
        '</div><div class="mpm-chips">' +
        chips +
        '</div></section>'
      : '');
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

function mobPatIrPara(id) {
  const el = document.getElementById(id);
  if (el && typeof el.scrollIntoView === 'function')
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** Cartões de banco/corretora. Também chamada por mpToggleExtrato. */
function mobPatrimonioRedesenharCarteiras() {
  const wrap = document.getElementById('mpMobCarteiras');
  const d = _mobPat.dados;
  if (!wrap || !d) return;
  const lista = (typeof mpEstado !== 'undefined' && mpEstado._instituicoes) || d.instituicoes || [];
  const cab =
    '<div class="mi-tit-linha"><h2 class="mi-h2">Onde está o dinheiro</h2>' +
    '<button type="button" class="mi-link" onclick="abrirNovaContaForm()"><i class="ph ph-plus"></i> Conta</button></div>';
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
        const extratoAberto = !!(mpEstado.extratoAberto && mpEstado.extratoAberto[x.key]);
        const acoes = [
          ['abrirTransferenciaModal()', 'ph-arrows-left-right', 'Transferir'],
          [
            'mpToggleExtrato(' + i + ')',
            'ph-receipt',
            extratoAberto ? 'Fechar extrato' : 'Extrato',
          ],
        ];
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
        '</span><b class="mpw-total valor-mascarado">' +
        _mobEsc(_mobPatFmt(x.total)) +
        '</b></button>' +
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
    '<div class="mi-tit-linha"><h2 class="mi-h2">Investido por classe</h2><span class="mc-total"><b class="valor-mascarado">' +
    _mobEsc(_mobPatFmt(total)) +
    '</b></span></div><div class="mi-card mpc">' +
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
          (rent != null
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
