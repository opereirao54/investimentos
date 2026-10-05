// ============================================================
// --- App mobile: barra inferior, tela "Mais" e voltar ---
// ============================================================
// No celular o app era o site de desktop espremido: o menu morava atrás de
// um ☰ no canto, cada troca de tela custava dois toques e nada dizia onde a
// pessoa estava. Aqui fica a casca de app que vale só até 768px:
//
//   - uma barra fixa embaixo, na zona do polegar, com as três telas de uso
//     diário, o "+" de cadastro no centro e o "Mais";
//   - a tela "Mais", que reúne as demais seções e as preferências que antes
//     viviam no rodapé da sidebar;
//   - um "‹ Mais" no topo das telas que se abre a partir dela.
//
// A casca NÃO duplica lógica: navegar é clicar no botão da sidebar (que já
// chama mudarAba com o callback certo — Info Mercado carrega notícias, por
// exemplo), e o "+" reaproveita o menu de cadastro global. No desktop nada
// disto aparece; o CSS esconde a barra e a seção "Mais" acima de 768px.

var MOB_ABAS_BARRA = ['controle', 'meu_patrimonio', 'patrimonio'];
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
