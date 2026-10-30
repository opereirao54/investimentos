/**
 * Appliquei — "Novo lançamento": a camada de botões do formulário.
 *
 * Proposta de layout aprovada pelo fundador (27/10/2026): tipo em controle
 * segmentado, valor primeiro, categoria e conta em botões, Variável × Fixa em
 * dois botões, parcelas com − / +, e o Salvar sempre à vista com o resumo do
 * que vai ser salvo.
 *
 * NADA AQUI DECIDE REGRA. Cada botão preenche o campo que já existia
 * (categoriaTransacao, categoriaDespesa, bancoTransacao, selectCartao,
 * qtdParcelas, parcelaInicial) e chama a função de sempre; o salvamento lê os
 * mesmos campos de antes. lancUiSincronizar redesenha os botões a partir dos
 * campos — depois de qualquer mudança, venha de onde vier (clique, edição de
 * um lançamento, sugestão de categoria, reset depois de salvar).
 */

var LANC_UI_MAX_CHIPS = 3;
// Estado só da tela: o que a pessoa abriu e ainda não fechou.
var lancUiCatAberta = false;
var lancUiContaOutra = false;
var lancUiObsAberta = false;
var lancUiAgendado = false;

function _lancEl(id) {
  return document.getElementById(id);
}

function _lancEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 'entrada' | 'saida' | 'cartao' | '' a partir da categoria contábil. */
function lancUiTipo() {
  var cat = (_lancEl('categoriaTransacao') || {}).value || '';
  if (cat === 'receita') return 'entrada';
  if (cat === 'cartao_credito') return 'cartao';
  if (cat === 'despesa_fixa' || cat === 'despesa_variavel') return 'saida';
  return '';
}

/** Botão-pílula. O valor vai em data-v (nome com apóstrofo não quebra o clique). */
function _lancChip(rotulo, on, acao, valor, extra) {
  return (
    '<button type="button" class="lanc-chip' +
    (on ? ' on' : '') +
    (extra ? ' ' + extra : '') +
    '" aria-pressed="' +
    (on ? 'true' : 'false') +
    '" data-v="' +
    _lancEsc(valor == null ? '' : valor) +
    '" onclick="' +
    acao +
    '(this.dataset.v)">' +
    _lancEsc(rotulo) +
    '</button>'
  );
}

// ── Categoria da despesa ─────────────────────────────────────────────────

/**
 * As categorias que viram botão: a escolhida primeiro, depois as que a pessoa
 * mais usa, completando pela ordem da lista. O resto fica em "Todas".
 */
function lancUiCategoriasDestaque(opcoes, selecionada, lista) {
  var uso = {};
  (lista || []).forEach(function (t) {
    if (t && t.categoriaDespesa) uso[t.categoriaDespesa] = (uso[t.categoriaDespesa] || 0) + 1;
  });
  var ordem = opcoes.slice().sort(function (a, b) {
    return (uso[b.v] || 0) - (uso[a.v] || 0) || opcoes.indexOf(a) - opcoes.indexOf(b);
  });
  var escolhida = opcoes.filter(function (o) {
    return o.v === selecionada;
  });
  var resto = ordem.filter(function (o) {
    return o.v !== selecionada;
  });
  return escolhida.concat(resto).slice(0, LANC_UI_MAX_CHIPS);
}

function _lancRenderCategorias() {
  var host = _lancEl('lancCatChips');
  var sel = _lancEl('categoriaDespesa');
  if (!host || !sel) return;
  var opcoes = Array.prototype.filter
    .call(sel.options, function (o) {
      return o.value && o.value !== '__nova__';
    })
    .map(function (o) {
      return { v: o.value, label: o.textContent };
    });
  var destaque = lancUiCategoriasDestaque(
    opcoes,
    sel.value,
    typeof transacoes !== 'undefined' ? transacoes : []
  );
  host.innerHTML =
    destaque
      .map(function (o) {
        return _lancChip(o.label, o.v === sel.value, 'lancUiEscolherCategoria', o.v);
      })
      .join('') +
    '<button type="button" class="lanc-chip mais" aria-expanded="' +
    (lancUiCatAberta ? 'true' : 'false') +
    '" aria-controls="categoriaDespesa" onclick="lancUiTodasCategorias()">' +
    (lancUiCatAberta ? 'Fechar lista' : 'Todas ▾') +
    '</button>';
  sel.classList.toggle('aberta', lancUiCatAberta || sel.value === '__nova__');
}

function lancUiEscolherCategoria(v) {
  var sel = _lancEl('categoriaDespesa');
  if (!sel) return;
  sel.value = v;
  if (typeof onChangeCategoriaDespesa === 'function') onChangeCategoriaDespesa();
  lancUiCatAberta = false;
  lancUiSincronizar();
}

function lancUiTodasCategorias() {
  lancUiCatAberta = !lancUiCatAberta;
  lancUiSincronizar();
  var sel = _lancEl('categoriaDespesa');
  if (lancUiCatAberta && sel) sel.focus();
}

// ── Conta (de onde sai / onde entra) ─────────────────────────────────────

function lancUiContasDestaque(tipo) {
  var nomes = [];
  if (tipo === 'saida' && typeof sugestoesContasDeSaida === 'function') {
    var ref = typeof dataLancamentoRefMs === 'function' ? dataLancamentoRefMs() : Date.now();
    nomes = sugestoesContasDeSaida(ref).map(function (x) {
      return x.nome;
    });
  } else if (typeof contasAtivas === 'function') {
    nomes = contasAtivas()
      .filter(function (c) {
        return c && c.tipo !== 'corretora';
      })
      .map(function (c) {
        return c.nome;
      });
  }
  return nomes.filter(Boolean).slice(0, LANC_UI_MAX_CHIPS);
}

function _lancRenderContas(tipo) {
  var host = _lancEl('lancContaChips');
  var inp = _lancEl('bancoTransacao');
  if (!host || !inp) return;
  var nomes = tipo === 'entrada' || tipo === 'saida' ? lancUiContasDestaque(tipo) : [];
  var valor = (inp.value || '').trim();
  var naLista = nomes.indexOf(valor) !== -1;
  // Sem conta cadastrada, ou um nome que não é botão: o campo de texto aparece.
  var digitar = !nomes.length || lancUiContaOutra || (valor && !naLista);
  host.innerHTML = nomes.length
    ? nomes
        .map(function (n) {
          return _lancChip(n, n === valor && !lancUiContaOutra, 'lancUiEscolherConta', n);
        })
        .join('') + _lancChip('Outra', !!digitar, 'lancUiOutraConta', '', 'mais')
    : '';
  host.hidden = !nomes.length;
  inp.classList.toggle('lanc-oculto', !digitar);
  var dica = _lancEl('dicaBancoTransacao');
  if (dica) dica.classList.toggle('lanc-oculto', !digitar);
}

function lancUiEscolherConta(nome) {
  var inp = _lancEl('bancoTransacao');
  if (!inp) return;
  inp.value = nome;
  lancUiContaOutra = false;
  var host = _lancEl('lancContaChips');
  if (host) host.classList.remove('lanc-falta');
  if (typeof avisarContaNovaTransacao === 'function') avisarContaNovaTransacao();
  lancUiSincronizar();
}

/**
 * Salvar sem conta: realça os botões de conta e põe o foco no primeiro.
 * Devolve false quando não há botões (o campo de texto está à vista).
 */
function lancUiPedirConta() {
  var host = _lancEl('lancContaChips');
  if (!host || host.hidden) return false;
  var primeiro = host.querySelector('.lanc-chip');
  if (!primeiro) return false;
  host.classList.add('lanc-falta');
  if (typeof primeiro.scrollIntoView === 'function') primeiro.scrollIntoView({ block: 'center' });
  primeiro.focus();
  return true;
}

function lancUiOutraConta() {
  lancUiContaOutra = true;
  lancUiSincronizar();
  var inp = _lancEl('bancoTransacao');
  if (inp) inp.focus();
}

// ── Cartão ───────────────────────────────────────────────────────────────

function _lancRenderCartoes() {
  var host = _lancEl('lancCartaoChips');
  var sel = _lancEl('selectCartao');
  if (!host || !sel) return;
  var lista = typeof cartoesAtivos === 'function' ? cartoesAtivos() : [];
  host.innerHTML =
    lista
      .map(function (c) {
        return _lancChip(c.nome, c.id === sel.value, 'lancUiEscolherCartao', c.id);
      })
      .join('') +
    _lancChip('+ Novo', sel.value === '__novo__', 'lancUiEscolherCartao', '__novo__', 'mais');
}

function lancUiEscolherCartao(id) {
  var sel = _lancEl('selectCartao');
  if (!sel) return;
  sel.value = id;
  if (typeof onChangeSelectCartao === 'function') onChangeSelectCartao();
  lancUiSincronizar();
}

// ── Tipo de gasto, parcelas, observação ──────────────────────────────────

function lancUiTipoGasto(cat) {
  var sel = _lancEl('categoriaTransacao');
  if (!sel || sel.value === cat) return;
  sel.value = cat;
  if (typeof verificarRegraCartao === 'function') verificarRegraCartao();
  lancUiSincronizar();
}

/** − / + de um campo numérico: respeita min/max e avisa quem escuta o campo. */
function lancUiPasso(id, delta) {
  var inp = _lancEl(id);
  if (!inp) return;
  var min = parseInt(inp.min, 10) || 1;
  var max = parseInt(inp.max, 10) || 48;
  var v = (parseInt(inp.value, 10) || min) + delta;
  inp.value = Math.max(min, Math.min(max, v));
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}

function lancUiAbrirParcelaInicial() {
  var grupo = _lancEl('grupoParcelaInicial');
  if (!grupo) return;
  grupo.dataset.aberto = '1';
  if (typeof atualizarParcelaInicialUI === 'function') atualizarParcelaInicialUI();
  var inp = _lancEl('parcelaInicial');
  if (inp) {
    // Quem abriu a pergunta já está, no mínimo, na 2ª parcela.
    if ((parseInt(inp.value, 10) || 1) < 2) {
      inp.value = 2;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    inp.focus();
  }
}

function lancUiAbrirObs() {
  lancUiObsAberta = true;
  lancUiSincronizar();
  var t = _lancEl('obsTransacao');
  if (t) t.focus();
}

// ── Resumo do rodapé ─────────────────────────────────────────────────────

/** A linha acima do Salvar: o que vai ser salvo, em palavras. '' sem valor. */
function lancUiResumo() {
  var valor =
    typeof parseBRL === 'function' ? Number(parseBRL((_lancEl('valorTransacao') || {}).value)) : 0;
  if (!(valor > 0)) return '';
  var moeda = function (v) {
    return '<b>' + _lancEsc(typeof formatarMoeda === 'function' ? formatarMoeda(v) : v) + '</b>';
  };
  var tipo = lancUiTipo();
  var repetir = !!(_lancEl('transacaoFixa') || {}).checked;
  var banco = ((_lancEl('bancoTransacao') || {}).value || '').trim();
  if (tipo === 'entrada') {
    return (
      'Entrada de ' +
      moeda(valor) +
      (banco ? ' em <b>' + _lancEsc(banco) + '</b>' : '') +
      (repetir ? ' · todo mês' : '')
    );
  }
  if (tipo === 'saida') {
    var selD = _lancEl('categoriaDespesa');
    var opt =
      selD && selD.value && selD.value !== '__nova__' ? selD.options[selD.selectedIndex] : null;
    return (
      'Saída de ' +
      moeda(valor) +
      (banco ? ' de <b>' + _lancEsc(banco) + '</b>' : '') +
      (opt ? ' · ' + _lancEsc(opt.textContent) : '') +
      (repetir ? ' · todo mês' : '')
    );
  }
  if (tipo === 'cartao') {
    var selC = _lancEl('selectCartao');
    var nome =
      selC && selC.value && selC.value !== '__novo__' && selC.selectedIndex >= 0
        ? selC.options[selC.selectedIndex].textContent
        : '';
    var noCartao = nome ? ' no <b>' + _lancEsc(nome) + '</b>' : '';
    if ((_lancEl('tipoCartaoSelecionado') || {}).value === 'fixo') {
      return moeda(valor) + ' por mês' + noCartao;
    }
    var n = parseInt((_lancEl('qtdParcelas') || {}).value, 10) || 1;
    if (n <= 1) return moeda(valor) + ' à vista' + noCartao;
    var ini = Math.min(Math.max(parseInt((_lancEl('parcelaInicial') || {}).value, 10) || 1, 1), n);
    var parcela = Math.round((valor / n) * 100) / 100;
    return (
      '<b>' +
      (n - ini + 1) +
      '×</b> de ' +
      moeda(parcela) +
      noCartao +
      ' · parcelas ' +
      ini +
      ' a ' +
      n
    );
  }
  return '';
}

// ── Sincronizar ──────────────────────────────────────────────────────────

/** Redesenha os botões a partir dos campos. Barato; pode rodar à vontade. */
function lancUiSincronizar() {
  lancUiAgendado = false;
  var painel = _lancEl('painelNovoLancamento');
  if (!painel) return;
  var tipo = lancUiTipo();
  var cat = (_lancEl('categoriaTransacao') || {}).value || '';

  // Tipo: o segmento ligado é o da categoria (também na edição).
  [
    ['chipEntrada', 'entrada'],
    ['chipSaida', 'saida'],
    ['chipCartao', 'cartao'],
  ].forEach(function (p) {
    var b = _lancEl(p[0]);
    if (!b) return;
    b.classList.toggle('on', tipo === p[1]);
    b.setAttribute('aria-pressed', tipo === p[1] ? 'true' : 'false');
  });

  var importar = _lancEl('lancImportarTopo');
  if (importar) importar.hidden = tipo !== 'cartao';

  var tipoGasto = _lancEl('lancTipoGasto');
  if (tipoGasto) {
    tipoGasto.hidden = tipo !== 'saida';
    tipoGasto.querySelectorAll('button[data-cat]').forEach(function (b) {
      var on = b.getAttribute('data-cat') === cat;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // O bloco de data/conta/repetir não tem nada a mostrar no cartão (a data é
  // a fatura, que fica no bloco do cartão).
  var bloco = _lancEl('lancBloco');
  if (bloco) bloco.hidden = tipo === 'cartao' || painel.classList.contains('modo-sonho');

  _lancRenderCategorias();
  _lancRenderContas(tipo);
  if (tipo === 'cartao') _lancRenderCartoes();

  var obs = _lancEl('obsTransacao');
  var grupoObs = _lancEl('grupoObs');
  var abrirObs = _lancEl('lancObsAbrir');
  var mostrarObs = lancUiObsAberta || !!(obs && obs.value);
  if (grupoObs) grupoObs.style.display = mostrarObs ? '' : 'none';
  if (abrirObs) abrirObs.hidden = mostrarObs;

  var resumo = _lancEl('lancResumo');
  if (resumo) {
    var txt = lancUiResumo();
    resumo.innerHTML = txt;
    resumo.hidden = !txt;
  }
}

/** Depois de um clique/tecla no painel: redesenha quando os handlers terminarem. */
function lancUiAgendar() {
  if (lancUiAgendado) return;
  lancUiAgendado = true;
  (window.requestAnimationFrame || setTimeout)(lancUiSincronizar);
}

/** Formulário limpo (novo lançamento, depois de salvar ou cancelar). */
function lancUiReiniciar() {
  lancUiCatAberta = false;
  lancUiContaOutra = false;
  lancUiObsAberta = false;
  var grupo = _lancEl('grupoParcelaInicial');
  if (grupo) grupo.dataset.aberto = '';
  lancUiSincronizar();
}

function lancUiLigar() {
  var painel = _lancEl('painelNovoLancamento');
  if (!painel || painel.dataset.lancUi) return;
  painel.dataset.lancUi = '1';
  ['click', 'input', 'change'].forEach(function (ev) {
    painel.addEventListener(ev, lancUiAgendar);
  });
  lancUiSincronizar();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lancUiLigar);
  else lancUiLigar();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    lancUiCategoriasDestaque: lancUiCategoriasDestaque,
    lancUiResumo: lancUiResumo,
  };
}
