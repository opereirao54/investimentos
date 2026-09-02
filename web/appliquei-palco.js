/**
 * Appliquei — o palco da landing page.
 *
 * A história do produto tem quatro atos (onde o seu dinheiro está → o que
 * entra e sai no mês → tudo somado → para onde vai o próximo aporte).
 * Empilhados, viram quatro seções de tela cheia: a pessoa rola sem saber
 * quanto falta e a página "não acaba". Este arquivo promove os quatro atos a
 * uma CENA ÚNICA — a moldura fica presa enquanto o texto ao lado corre, e o
 * print troca em fade cruzado.
 *
 * O princípio que manda aqui: o HTML nasce COMPLETO na versão empilhada.
 * Nada de texto ou de imagem é criado por este script — ele só MOVE as
 * <figure> que já existem para dentro da moldura e liga o observador. Se
 * falhar, se não houver JS, se a tela for estreita ou se o utilizador pedir
 * menos movimento, a página continua inteira e legível. É por isso que a
 * classe `palco--vivo` é adicionada aqui e não escrita no HTML.
 *
 * Também não há listener de scroll: quem decide o ato ativo é um
 * IntersectionObserver com uma faixa estreita no meio do ecrã. Um listener de
 * scroll a 60fps para trocar quatro opacidades seria trabalho a mais em cada
 * pixel de rolagem, e é o tipo de coisa que estraga a fluidez que o efeito
 * existe para criar.
 */

(function () {
  'use strict';

  // Abaixo disto o palco não vale a pena: a moldura presa e a coluna de texto
  // não cabem lado a lado, e um sticky de altura cheia no telemóvel é onde
  // este padrão costuma morrer (barra de endereço a redimensionar o viewport).
  // O telemóvel recebe os quatro cartões empilhados, que são mais curtos.
  var LARGURA_MINIMA = '(min-width: 980px)';
  var MENOS_MOVIMENTO = '(prefers-reduced-motion: reduce)';

  function combina(query) {
    try {
      return window.matchMedia && window.matchMedia(query).matches;
    } catch (_) {
      return false;
    }
  }

  function podeMontar() {
    if (!('IntersectionObserver' in window)) return false;
    if (combina(MENOS_MOVIMENTO)) return false;
    return combina(LARGURA_MINIMA);
  }

  // Guarda de onde cada figura saiu, para saber devolvê-la. Sem isto,
  // encolher a janela deixaria as quatro figuras dentro de uma moldura que a
  // media query acabou de esconder — a página perderia todos os prints.
  var montado = false;
  var origens = [];
  var observadorAtivo = null;

  function desmontar() {
    if (!montado) return;
    montado = false;
    origens.forEach(function (o) {
      o.fig.removeAttribute('data-ativo');
      // insertBefore com a legenda como referência devolve a figura à posição
      // exata que tinha no HTML; um appendChild a deixaria depois dela.
      o.ato.insertBefore(o.fig, o.antes);
    });
    origens = [];
    var secao = document.getElementById('historia');
    if (secao) secao.classList.remove('palco--vivo');
    document.querySelectorAll('#palcoAtos .ato').forEach(function (a) {
      a.removeAttribute('data-ativo');
    });
    if (observadorAtivo) {
      try {
        observadorAtivo.disconnect();
      } catch (_) {}
      observadorAtivo = null;
    }
  }

  function montar() {
    var secao = document.getElementById('historia');
    var moldura = document.getElementById('palcoMoldura');
    var trilho = document.getElementById('palcoTrilho');
    var atosWrap = document.getElementById('palcoAtos');
    if (!secao || !moldura || !trilho || !atosWrap) return;

    var atos = Array.prototype.slice.call(atosWrap.querySelectorAll('.ato'));
    if (atos.length < 2) return;

    // As figuras MUDAM de lugar, não são clonadas: duplicá-las deixaria dois
    // <img> do mesmo print no DOM e dois alt-texts a dizer a mesma coisa a um
    // leitor de ecrã. A moldura é aria-hidden justamente porque a descrição
    // acessível fica com o texto do ato, que é onde ela tem contexto.
    atos.forEach(function (ato, i) {
      var fig = ato.querySelector('.ato-fig');
      if (!fig) return;
      origens.push({ fig: fig, ato: ato, antes: fig.nextSibling });
      fig.setAttribute('data-ativo', i === 0 ? '1' : '0');
      moldura.appendChild(fig);
    });

    secao.classList.add('palco--vivo');
    montado = true;

    var itensTrilho = Array.prototype.slice.call(trilho.querySelectorAll('li'));
    var figuras = Array.prototype.slice.call(moldura.querySelectorAll('.ato-fig'));
    var atual = -1;

    function ativar(indice) {
      if (indice === atual || indice < 0 || indice >= atos.length) return;
      atual = indice;
      atos.forEach(function (a, i) {
        a.setAttribute('data-ativo', i === indice ? '1' : '0');
      });
      figuras.forEach(function (f, i) {
        f.setAttribute('data-ativo', i === indice ? '1' : '0');
      });
      itensTrilho.forEach(function (li, i) {
        if (i === indice) li.setAttribute('aria-current', 'step');
        else li.removeAttribute('aria-current');
      });
    }

    // A faixa de decisão é uma linha fina no meio da tela: `rootMargin`
    // encolhe a viewport para os 45%–55% centrais, e o ato que a cruzar passa
    // a ser o ativo. Sem isso, dois atos ficariam visíveis ao mesmo tempo no
    // meio da transição e o ativo piscaria entre eles.
    var observador = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (e) {
          if (!e.isIntersecting) return;
          var i = atos.indexOf(e.target);
          if (i !== -1) ativar(i);
        });
      },
      { rootMargin: '-45% 0px -55% 0px', threshold: 0 }
    );
    atos.forEach(function (a) {
      observador.observe(a);
    });
    observadorAtivo = observador;

    // O trilho não é só indicador: é atalho. Quem já entendeu a história e
    // quer ver a carteira sugerida salta direto para o ato 4 em vez de rolar
    // os três anteriores — e quem prefere rolar não perde nada.
    trilho.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('button[data-ir]') : null;
      if (!btn) return;
      var alvo = atos[parseInt(btn.getAttribute('data-ir'), 10) - 1];
      if (!alvo) return;
      try {
        alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (_) {
        alvo.scrollIntoView();
      }
    });

    ativar(0);
  }

  function sincronizar() {
    var deve = podeMontar();
    if (deve === montado) return;
    try {
      if (deve) montar();
      else desmontar();
    } catch (_) {
      // Um palco que não montou deixa a página como o HTML a entregou —
      // empilhada e completa. Nunca meio montada.
      try {
        desmontar();
      } catch (__) {}
    }
  }

  // Redimensionar a janela para baixo de 980px e mudar a preferência de
  // movimento são as duas maneiras de o palco deixar de ser adequado DEPOIS
  // de já estar montado. As duas devolvem a página empilhada.
  function vigiar(query) {
    try {
      var mq = window.matchMedia(query);
      if (mq.addEventListener) mq.addEventListener('change', sincronizar);
      else if (mq.addListener) mq.addListener(sincronizar);
    } catch (_) {}
  }

  function iniciar() {
    vigiar(LARGURA_MINIMA);
    vigiar(MENOS_MOVIMENTO);
    sincronizar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
