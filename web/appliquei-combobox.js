'use strict';

/*
 * Appliquei — combobox mobile-friendly para os campos de INSTITUIÇÃO FINANCEIRA.
 *
 * Problema: os campos "Banco / Corretora", "Conta de onde sai o dinheiro" e
 * "Banco / instituição que recebe" usavam <input list="..."> + <datalist>. Em
 * boa parte dos navegadores MOBILE o dropdown nativo do datalist não abre ao
 * tocar (ou simplesmente não aparece) — foi a queixa "os dropdownlist de
 * instituição financeira não aparecem no mobile".
 *
 * Solução: mantemos o MESMO <input> (id, value, eventos `input`/`change` que o
 * resto do app escuta) e só trocamos o dropdown nativo por um painel custom,
 * alimentado AO VIVO pelo <datalist> associado (que segue sendo populado pelas
 * funções inicializarDatalist*). Funciona igual em desktop e mobile.
 *
 * Posicionamento: o painel é `position:absolute` dentro de um wrapper relativo,
 * logo acompanha o input mesmo dentro de drawers animados com `transform`
 * (onde `position:fixed` quebraria). Escopo restrito aos campos de instituição
 * para não interferir nos autocompletes de ticker/descrição.
 */
(function () {
  var ABERTO = null; // painel atualmente aberto (só um por vez)

  function fecharAberto() {
    if (ABERTO) {
      ABERTO.classList.remove('aberto');
      ABERTO = null;
    }
  }

  function opcoesDoDatalist(id) {
    var dl = id ? document.getElementById(id) : null;
    if (!dl) return [];
    var out = [];
    Array.prototype.forEach.call(dl.options, function (o) {
      if (o && o.value)
        out.push({ value: o.value, label: o.label && o.label !== o.value ? o.label : '' });
    });
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function enhance(input) {
    if (!input || input.dataset.comboEnhanced) return;
    var datalistId = input.getAttribute('list');
    if (!datalistId) return;
    input.dataset.comboEnhanced = '1';
    input.dataset.comboList = datalistId;
    input.setAttribute('autocomplete', 'off');
    // Remove o list nativo p/ não duplicar dropdown no desktop — comportamento
    // único em todas as plataformas.
    input.removeAttribute('list');
    input.classList.add('appq-combo-input');

    var wrap = document.createElement('div');
    wrap.className = 'appq-combo';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var panel = document.createElement('div');
    panel.className = 'appq-combo-panel';
    panel.setAttribute('role', 'listbox');
    wrap.appendChild(panel);

    var idxAtivo = -1;

    function render() {
      var termo = (input.value || '').trim().toLowerCase();
      var opts = opcoesDoDatalist(input.dataset.comboList);
      var filtradas = termo
        ? opts.filter(function (o) {
            return o.value.toLowerCase().indexOf(termo) !== -1;
          })
        : opts;
      idxAtivo = -1;
      if (!filtradas.length) {
        panel.innerHTML = input.value.trim()
          ? '<div class="appq-combo-empty appq-combo-usar"><i class="ph ph-plus-circle"></i> Usar “' +
            esc(input.value.trim()) +
            '”</div>'
          : '<div class="appq-combo-empty">Sem sugestões — digite o nome</div>';
        return;
      }
      panel.innerHTML = filtradas
        .slice(0, 60)
        .map(function (o, i) {
          return (
            '<div class="appq-combo-opt" role="option" data-i="' +
            i +
            '" data-val="' +
            esc(o.value) +
            '"><span class="appq-combo-opt-v">' +
            esc(o.value) +
            '</span>' +
            (o.label ? '<span class="appq-combo-opt-l">' + esc(o.label) + '</span>' : '') +
            '</div>'
          );
        })
        .join('');
    }

    function abrir() {
      if (ABERTO && ABERTO !== panel) fecharAberto();
      render();
      panel.classList.add('aberto');
      ABERTO = panel;
    }

    function selecionar(val) {
      input.value = val;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      fecharAberto();
      input.focus();
    }

    input.addEventListener('focus', abrir);
    input.addEventListener('click', abrir);
    input.addEventListener('input', abrir);
    input.addEventListener('keydown', function (e) {
      var opts = panel.querySelectorAll('.appq-combo-opt');
      if (e.key === 'Escape') {
        fecharAberto();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!panel.classList.contains('aberto')) {
          abrir();
          return;
        }
        e.preventDefault();
        if (!opts.length) return;
        idxAtivo += e.key === 'ArrowDown' ? 1 : -1;
        if (idxAtivo < 0) idxAtivo = opts.length - 1;
        if (idxAtivo >= opts.length) idxAtivo = 0;
        Array.prototype.forEach.call(opts, function (el, i) {
          el.classList.toggle('ativo', i === idxAtivo);
        });
        opts[idxAtivo].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (panel.classList.contains('aberto') && idxAtivo >= 0 && opts[idxAtivo]) {
          e.preventDefault();
          selecionar(opts[idxAtivo].getAttribute('data-val'));
        }
      }
    });
    input.addEventListener('blur', function () {
      // Atraso curto p/ o pointerdown da opção rodar antes de fechar.
      setTimeout(function () {
        if (ABERTO === panel) fecharAberto();
      }, 150);
    });
    // pointerdown cobre toque (mobile) e mouse, e roda antes do blur; o
    // preventDefault mantém o foco no input ao escolher uma opção.
    panel.addEventListener('pointerdown', function (e) {
      var opt = e.target.closest('.appq-combo-opt');
      if (opt) {
        e.preventDefault();
        selecionar(opt.getAttribute('data-val'));
        return;
      }
      if (e.target.closest('.appq-combo-usar')) {
        e.preventDefault();
        fecharAberto();
        input.focus();
      }
    });
  }

  // Escopo: só os campos de instituição financeira (os do problema relatado).
  function appliqueiInitComboboxes(root) {
    var sel = 'input[list="listaCorretoras"], input[list="listaBancosTransacao"]';
    (root || document).querySelectorAll(sel).forEach(enhance);
  }

  // Fecha ao tocar/clicar fora de qualquer combobox.
  document.addEventListener('pointerdown', function (e) {
    if (!ABERTO) return;
    if (!e.target.closest('.appq-combo')) fecharAberto();
  });

  window.appliqueiInitComboboxes = appliqueiInitComboboxes;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      appliqueiInitComboboxes(document);
    });
  } else {
    appliqueiInitComboboxes(document);
  }
})();
