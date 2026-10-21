/**
 * Appliquei Admin — casca do celular.
 *
 * Mesma ideia do app (web/appliquei-mobile.js): no celular a sidebar some e a
 * navegação vira uma barra inferior com os quatro destinos do dia a dia
 * (Painel, Usuários, Testadores, Sugestões) e um "Mais" com o resto. As
 * tabelas viram cartões — cada célula ganha o rótulo da sua coluna em
 * `data-label`, que o CSS mostra no lugar do cabeçalho.
 *
 * Nada é exclusivo do computador: toda aba da sidebar tem botão aqui, e as
 * ações (Exportar CSV, tema, sair) estão no "Mais". A trava está em
 * test/admin-mobile.test.js.
 *
 * Classic script: `var` no top-level, funções globais (o HTML chama
 * admIr() e companhia por onclick). Depende de appliquei-admin.js (mudarAba).
 */

var ADM_CELULAR_MQ = '(max-width: 768px)';
var ADM_ABAS_BARRA = ['dashboard', 'users', 'convites', 'feedback'];

function admEhCelular() {
  return !!(window.matchMedia && window.matchMedia(ADM_CELULAR_MQ).matches);
}

/** Vai para uma aba pela barra ou pelo "Mais". */
function admIr(tab) {
  admFecharMais();
  if (typeof mudarAba === 'function') mudarAba(null, tab);
  admSincronizar(tab);
  try {
    window.scrollTo(0, 0);
    var main = document.getElementById('main-content');
    if (main) main.scrollTop = 0;
  } catch (_) {}
}

/** Acende o botão certo da barra. Abas do "Mais" acendem o próprio "Mais". */
function admSincronizar(tab) {
  var alvo = ADM_ABAS_BARRA.indexOf(tab) > -1 ? tab : 'mais';
  document.querySelectorAll('#admTabbar .adm-tab').forEach(function (b) {
    var on = b.dataset.tab === alvo;
    b.classList.toggle('ativo', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('#admMais .adm-mais-item[data-tab]').forEach(function (b) {
    b.classList.toggle('ativo', b.dataset.tab === tab);
  });
}

function admAbrirMais() {
  var folha = document.getElementById('admMais');
  var fundo = document.getElementById('admMaisFundo');
  if (!folha) return;
  folha.hidden = false;
  if (fundo) fundo.hidden = false;
  document.body.classList.add('adm-mais-aberto');
}

function admFecharMais() {
  var folha = document.getElementById('admMais');
  var fundo = document.getElementById('admMaisFundo');
  if (folha) folha.hidden = true;
  if (fundo) fundo.hidden = true;
  document.body.classList.remove('adm-mais-aberto');
}

// ─── Tabelas → cartões ──────────────────────────────────────────────────────
// Cada <td> recebe o texto do <th> da mesma coluna em data-label. Roda a cada
// mudança nas tabelas (elas são redesenhadas pelo appliquei-admin.js).

function admRotularTabela(tbl) {
  var ths = tbl.querySelectorAll('thead th');
  if (!ths.length) return;
  var rotulos = Array.prototype.map.call(ths, function (th) {
    return (th.textContent || '').replace(/[↕↑↓]/g, '').trim();
  });
  tbl.querySelectorAll('tbody tr').forEach(function (tr) {
    var col = 0;
    Array.prototype.forEach.call(tr.children, function (td) {
      if (td.classList.contains('tbl-empty') || td.colSpan > 1) {
        col += td.colSpan || 1;
        return;
      }
      // Célula só de botões (ações) não leva título no cartão.
      var soBotoes = !!td.querySelector('button') && !(td.textContent || '').trim();
      var r = soBotoes ? '' : rotulos[col] || '';
      if (td.getAttribute('data-label') !== r) td.setAttribute('data-label', r);
      col += 1;
    });
  });
}

function admRotularTudo() {
  document.querySelectorAll('table.tbl').forEach(admRotularTabela);
}

var _admRotularAgendado = false;
function admAgendarRotulos() {
  if (_admRotularAgendado) return;
  _admRotularAgendado = true;
  (window.requestAnimationFrame || setTimeout)(function () {
    _admRotularAgendado = false;
    admRotularTudo();
  });
}

// ─── Selo de sugestões novas na barra ───────────────────────────────────────
// O contador da sidebar (#sb-feedback-count) é a fonte; a barra só espelha.

function admEspelharSelo() {
  var fonte = document.getElementById('sb-feedback-count');
  var selo = document.getElementById('admTabFeedback');
  if (!fonte || !selo) return;
  var n = parseInt(fonte.textContent, 10) || 0;
  selo.textContent = n > 99 ? '99+' : String(n);
  selo.hidden = n <= 0;
}

(function admIniciar() {
  try {
    if (typeof MutationObserver === 'function') {
      var main = document.getElementById('main-content');
      if (main) {
        new MutationObserver(admAgendarRotulos).observe(main, { childList: true, subtree: true });
      }
      var fonte = document.getElementById('sb-feedback-count');
      if (fonte) {
        new MutationObserver(admEspelharSelo).observe(fonte, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
    }
    admRotularTudo();
    admEspelharSelo();
    var ativa = document.querySelector('.section.ativa');
    if (ativa && ativa.id) admSincronizar(ativa.id.replace(/^sec-/, ''));
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') admFecharMais();
    });
  } catch (_) {}
})();
