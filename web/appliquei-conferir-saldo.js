/**
 * Appliquei — "Conferir saldo": bater o saldo de uma conta com o banco.
 *
 * POR QUE EXISTE. O saldo de uma conta no Patrimônio é derivado: abertura +
 * entradas − saídas pagas, desde o primeiro lançamento. Um lançamento errado
 * (uma conta marcada paga sem querer, uma compra no crédito lançada como
 * Saída, a conta criada sem o dinheiro que já estava nela) deixa o número
 * errado para sempre — e o app mostrava -R$ 726,83 a quem tinha R$ 2.000 no
 * banco sem nenhum sinal de que algo não batia. Quem vê o saldo errado e não
 * acha o porquê deixa de confiar no app.
 *
 * O fluxo:
 *   1. AVISO no cartão da conta quando o saldo fica negativo, quando a conta
 *      nunca foi conferida (sem saldo de abertura) ou quando faz mais de 30
 *      dias da última conferência. Dispensável por 30 dias.
 *   2. A pessoa digita o saldo REAL; o app mostra a diferença e lista o que
 *      costuma explicá-la, com a correção ali mesmo ("Não paguei", "Já caiu").
 *   3. "Ajustar": grava na CONTA (conta.ajustes) a diferença, datada de agora.
 *      Não é transação — não entra em receita, despesa, Projeção, relatório
 *      nem insights; só no caixa da conta (mpSomaAjustesConta). Desfazível
 *      pela linha "Ajuste de saldo" do extrato.
 *
 * Funções puras (conferirAviso, conferirExplicacoes) não tocam DOM — testadas
 * em test/conferir-saldo.test.js.
 */

var CONFERIR_DIAS_AVISO = 30;
var conferirContaAberta = null;
// O que fazer com a diferença: 'lancar' (vira gasto ou entrada de hoje) ou
// 'ajuste' (só acerta o saldo, fora dos gastos do mês).
var conferirModo = 'lancar';

function _confEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _confFmt(v) {
  return typeof formatarMoeda === 'function'
    ? formatarMoeda(Number(v) || 0)
    : 'R$ ' + (Number(v) || 0).toFixed(2);
}

function _confDataCurta(ms) {
  if (!ms || !isFinite(ms)) return '';
  var d = new Date(ms);
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}

function _confConta(id) {
  if (typeof obterConta === 'function') return obterConta(id);
  return (typeof contas !== 'undefined' ? contas : []).find(function (c) {
    return c && c.id === id;
  });
}

/** Caixa da conta segundo o app, no instante `refMs`. */
function conferirSaldoApp(contaId, refMs) {
  if (typeof mpCalcularSaldoPorInstituicao !== 'function') return 0;
  var mapa = mpCalcularSaldoPorInstituicao(refMs != null ? refMs : Date.now()) || {};
  return mapa[contaId] ? Number(mapa[contaId].caixa) || 0 : 0;
}

function _confTemAbertura(c) {
  return !!(
    Number(c.saldoInicial) ||
    0 ||
    (Array.isArray(c.ajustes) && c.ajustes.length) ||
    c.conferidoEm
  );
}

/**
 * O aviso do cartão da conta, ou null. Puro.
 * @returns {{nivel:string,titulo:string,texto:string}|null}
 */
function conferirAviso(c, caixa, agoraMs) {
  if (!c || c.arquivada) return null;
  var agora = agoraMs != null ? agoraMs : Date.now();
  var janela = CONFERIR_DIAS_AVISO * 86400000;
  var dispensado = c.avisoSaldoDispensadoEm ? new Date(c.avisoSaldoDispensadoEm).getTime() : 0;
  if (dispensado && agora - dispensado < janela) return null;
  var conferido = c.conferidoEm ? new Date(c.conferidoEm).getTime() : 0;
  if (Number(caixa) < -0.005) {
    return {
      nivel: 'negativo',
      titulo: 'Saldo negativo no app',
      texto:
        'Isso bate com o que aparece no app do seu banco? Se não bater, leva 1 minuto para acertar.',
    };
  }
  if (c.tipo === 'corretora') return null;
  if (!_confTemAbertura(c)) {
    return {
      nivel: 'sem-abertura',
      titulo: 'Saldo ainda não conferido',
      texto:
        'O app não sabe quanto já tinha nesta conta antes de você começar. Confira com o banco para o número ficar certo.',
    };
  }
  if (conferido && agora - conferido > janela) {
    return {
      nivel: 'antigo',
      titulo: 'Faz mais de um mês que você não confere',
      texto: 'Um Pix ou uma tarifa esquecidos mudam o saldo. Compare com o banco.',
    };
  }
  return null;
}

/** HTML do aviso (cartão do celular e linha do computador). '' sem aviso. */
function conferirAvisoHtml(contaId, caixa) {
  var c = _confConta(contaId);
  var av = conferirAviso(c, caixa);
  if (!av) return '';
  var id = _confEsc(contaId);
  return (
    '<div class="conf-aviso conf-aviso-' +
    av.nivel +
    '" role="status">' +
    '<i class="ph-bold ph-warning" aria-hidden="true"></i>' +
    '<div class="conf-aviso-txt"><strong>' +
    _confEsc(av.titulo) +
    '</strong><span>' +
    _confEsc(av.texto) +
    '</span>' +
    '<div class="conf-aviso-acoes">' +
    '<button type="button" class="conf-btn-pri" data-conta="' +
    id +
    '" onclick="event.stopPropagation();conferirAbrir(this.dataset.conta)">Conferir saldo</button>' +
    '<button type="button" class="conf-btn-link" data-conta="' +
    id +
    '" onclick="event.stopPropagation();conferirDispensarAviso(this.dataset.conta)">Agora não</button>' +
    '</div></div></div>'
  );
}

function conferirDispensarAviso(contaId) {
  var c = _confConta(contaId);
  if (!c) return;
  c.avisoSaldoDispensadoEm = new Date().toISOString();
  if (typeof salvarContas === 'function') salvarContas();
  conferirRerender();
}

function _confDaConta(t, contaId) {
  if (typeof mpChaveInstTransacao !== 'function') return t && t.contaId === contaId;
  return mpChaveInstTransacao(t).key === contaId;
}

/**
 * O que costuma explicar a diferença entre o saldo do app e o do banco.
 * `diferenca` = real − app (positivo: o app mostra MENOS do que há). Puro:
 * lê `transacoes` e a conta, não escreve nada.
 * @returns {Array<{id:string,titulo:string,texto:string,itens:Array}>}
 */
function conferirExplicacoes(contaId, diferenca, agoraMs) {
  var agora = agoraMs != null ? agoraMs : Date.now();
  var c = _confConta(contaId);
  var lista = typeof transacoes !== 'undefined' && Array.isArray(transacoes) ? transacoes : [];
  var dia = 86400000;
  var out = [];
  if (!c || Math.abs(diferenca) < 0.005) return out;
  var quandoSai = typeof mpQuandoSaiDoCaixa === 'function' ? mpQuandoSaiDoCaixa : null;
  var quandoEntra = typeof mpQuandoEntraNoCaixa === 'function' ? mpQuandoEntraNoCaixa : null;
  var computa =
    typeof mpTransacaoComputaCaixa === 'function'
      ? mpTransacaoComputaCaixa
      : function () {
          return false;
        };
  var item = function (t, ts, acao) {
    return {
      txId: t.id,
      desc: t.descricao || '',
      valor: Number(t.valor) || 0,
      // Data para MOSTRAR: a real do gasto (pagamento/vencimento), não o 1º
      // dia da competência que mpQuandoSaiDoCaixa usa sem pagoEm.
      data: _confDataCurta(typeof mpDataMovimento === 'function' ? mpDataMovimento(t) : ts),
      acao: acao || null,
    };
  };

  if (diferenca > 0) {
    if (!(Number(c.saldoInicial) || 0) && !(Array.isArray(c.ajustes) && c.ajustes.length)) {
      out.push({
        id: 'sem-abertura',
        titulo: 'Conta sem saldo inicial',
        texto:
          'O dinheiro que já estava aqui antes de você começar a usar o app não foi informado. O ajuste abaixo resolve.',
        itens: [],
      });
    }
    // Contas a pagar marcadas como pagas nos últimos 2 meses.
    var pagas = lista.filter(function (t) {
      if (!t || !t.pago) return false;
      if (t.categoria !== 'despesa_fixa' && t.categoria !== 'cartao_credito') return false;
      if (!computa(t, agora) || !_confDaConta(t, contaId)) return false;
      var ts = quandoSai ? quandoSai(t) : 0;
      return agora - ts <= 62 * dia;
    });
    if (pagas.length) {
      var totalPagas = pagas.reduce(function (s, t) {
        return s + (Number(t.valor) || 0);
      }, 0);
      out.push({
        id: 'pagas',
        titulo:
          pagas.length === 1
            ? '1 conta marcada como paga'
            : pagas.length + ' contas marcadas como pagas',
        texto:
          _confFmt(totalPagas) +
          ' saíram desta conta. Se alguma ainda não foi paga, toque em “Não paguei”.',
        itens: pagas.slice(0, 8).map(function (t) {
          return item(t, quandoSai ? quandoSai(t) : 0, 'nao-paguei');
        }),
      });
    }
    // Despesas variáveis do último mês: no crédito, não deveriam sair daqui.
    var variaveis = lista.filter(function (t) {
      if (!t || t.categoria !== 'despesa_variavel') return false;
      if (!computa(t, agora) || !_confDaConta(t, contaId)) return false;
      var ts = quandoSai ? quandoSai(t) : 0;
      return agora - ts <= 31 * dia;
    });
    if (variaveis.length) {
      var totalVar = variaveis.reduce(function (s, t) {
        return s + (Number(t.valor) || 0);
      }, 0);
      out.push({
        id: 'variaveis',
        titulo: 'Alguma compra foi no cartão de crédito?',
        texto:
          variaveis.length +
          (variaveis.length === 1 ? ' saída variável' : ' saídas variáveis') +
          ' (' +
          _confFmt(totalVar) +
          ') descontaram desta conta na hora. Compra no crédito só sai quando a fatura é paga: se foi no cartão, toque em “Foi no cartão”.',
        itens: variaveis.slice(0, 8).map(function (t) {
          return item(t, quandoSai ? quandoSai(t) : 0, 'foi-no-cartao');
        }),
      });
    }
    // Entradas deste mês com data futura (o salário que "cai dia 5").
    var hoje = new Date(agora);
    var futuras = lista.filter(function (t) {
      if (!t || (t.categoria !== 'receita' && t.categoria !== 'dividendo')) return false;
      if (t.mes !== hoje.getMonth() || t.ano !== hoje.getFullYear()) return false;
      if (!_confDaConta(t, contaId)) return false;
      var ts = quandoEntra ? quandoEntra(t) : 0;
      return ts > agora;
    });
    if (futuras.length) {
      out.push({
        id: 'futuras',
        titulo: 'Entrada prevista que ainda não conta',
        texto:
          'O app só soma a entrada no dia informado. Se o dinheiro já caiu, toque em “Já caiu”.',
        itens: futuras.slice(0, 5).map(function (t) {
          return item(t, quandoEntra ? quandoEntra(t) : 0, 'ja-caiu');
        }),
      });
    }
  } else {
    out.push({
      id: 'faltou-gasto',
      titulo: 'Algum gasto não foi lançado?',
      texto:
        'Um Pix, um saque, uma tarifa do banco ou um débito automático tiram dinheiro da conta sem passar pelo app.',
      itens: [],
    });
    var entradas = lista.filter(function (t) {
      if (!t || t.categoria !== 'receita') return false;
      if (!computa(t, agora) || !_confDaConta(t, contaId)) return false;
      var ts = quandoEntra ? quandoEntra(t) : 0;
      return agora - ts <= 31 * dia;
    });
    if (entradas.length) {
      out.push({
        id: 'entradas',
        titulo: 'Alguma entrada ainda não caiu?',
        texto: 'Estas entradas já somam no saldo. Se alguma não caiu, edite a data dela.',
        itens: entradas.slice(0, 5).map(function (t) {
          return item(t, quandoEntra ? quandoEntra(t) : 0, null);
        }),
      });
    }
  }
  return out;
}

/** Grava a diferença como ajuste da conta. Devolve o ajuste, ou null. */
function conferirAjustar(contaId, saldoReal) {
  var c = _confConta(contaId);
  if (!c || !isFinite(Number(saldoReal))) return null;
  var agora = Date.now();
  var app = conferirSaldoApp(contaId, agora);
  var dif = Math.round((Number(saldoReal) - app) * 100) / 100;
  c.conferidoEm = new Date(agora).toISOString();
  delete c.avisoSaldoDispensadoEm;
  var aj = null;
  if (Math.abs(dif) >= 0.01) {
    aj = {
      id: 'aj_' + agora + '_' + Math.random().toString(36).slice(2, 6),
      valor: dif,
      data: new Date(agora).toISOString(),
      saldoInformado: Number(saldoReal),
      saldoApp: Math.round(app * 100) / 100,
    };
    if (!Array.isArray(c.ajustes)) c.ajustes = [];
    c.ajustes.push(aj);
  }
  if (typeof salvarContas === 'function') salvarContas();
  return aj;
}

function conferirDesfazerAjuste(contaId, ajusteId) {
  var c = _confConta(contaId);
  if (!c || !Array.isArray(c.ajustes)) return false;
  var antes = c.ajustes.length;
  c.ajustes = c.ajustes.filter(function (a) {
    return a && a.id !== ajusteId;
  });
  if (c.ajustes.length === antes) return false;
  if (typeof salvarContas === 'function') salvarContas();
  if (typeof mostrarToast === 'function') mostrarToast('Ajuste desfeito.', 'sucesso');
  conferirRerender();
  return true;
}

function _confSalvarTransacoes() {
  if (typeof salvarTransacoes === 'function') salvarTransacoes({ flush: true });
}

/** "Não paguei": volta a conta para a pagar (mesma regra do Controle). */
function conferirNaoPaguei(txId) {
  if (typeof reverterPagamento === 'function') {
    reverterPagamento(txId);
  } else if (typeof transacoes !== 'undefined') {
    var t = transacoes.find(function (x) {
      return x.id === txId;
    });
    if (!t || !t.pago) return;
    t.pago = false;
    delete t.pagoEm;
    delete t.pagoVia;
    _confSalvarTransacoes();
  }
  conferirRerender();
}

/** "Já caiu": a entrada prevista passa a valer hoje. */
function conferirJaCaiu(txId) {
  if (typeof transacoes === 'undefined') return;
  var t = transacoes.find(function (x) {
    return x.id === txId;
  });
  if (!t) return;
  var d = new Date();
  t.dataVencimento =
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0');
  _confSalvarTransacoes();
  if (typeof mostrarToast === 'function')
    mostrarToast('Entrada considerada a partir de hoje.', 'sucesso');
  conferirRerender();
}

/**
 * "Foi no cartão": a saída variável vira compra à vista no cartão escolhido.
 * Sai do caixa agora (pago:false) e entra na fatura aberta desse cartão.
 */
function conferirFoiNoCartao(txId, cartaoId) {
  if (typeof transacoes === 'undefined') return false;
  var t = transacoes.find(function (x) {
    return x.id === txId;
  });
  var card = typeof obterCartao === 'function' ? obterCartao(cartaoId) : null;
  // obterCartao cai no primeiro cartão quando o id não existe: confere o id.
  if (!t || !card || card.id !== cartaoId || t.categoria !== 'despesa_variavel') return false;
  var compra =
    t.dataVencimento && typeof appliqueiParseData === 'function'
      ? appliqueiParseData(t.dataVencimento)
      : new Date(t.data || Date.now());
  var venc = null;
  if (typeof cartaoCalcularVencimento === 'function')
    venc = cartaoCalcularVencimento(compra, card.diaFechamento, card.diaVencimento);
  t.categoria = 'cartao_credito';
  t.cartaoId = card.id;
  t.pago = false;
  delete t.pagoEm;
  delete t.pagoVia;
  delete t.contaId;
  delete t.banco;
  if (venc && !isNaN(venc.getTime())) {
    t.dataVencimento =
      venc.getFullYear() +
      '-' +
      String(venc.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(venc.getDate()).padStart(2, '0');
    // Cartão amarra a competência ao mês da fatura (como no lançamento).
    t.mes = venc.getMonth();
    t.ano = venc.getFullYear();
  }
  _confSalvarTransacoes();
  if (typeof mostrarToast === 'function')
    mostrarToast('Movida para o cartão ' + card.nome + '.', 'sucesso');
  conferirRerender();
  return true;
}

// ── Tela ─────────────────────────────────────────────────────────────────

function conferirRerender() {
  try {
    if (typeof renderMeuPatrimonio === 'function') renderMeuPatrimonio(true);
    else if (typeof mobPatrimonioRedesenharCarteiras === 'function')
      mobPatrimonioRedesenharCarteiras();
    if (typeof atualizarTelaControle === 'function') atualizarTelaControle();
  } catch (e) {}
  if (conferirContaAberta) _confRenderCorpo();
}

function conferirAbrir(contaId) {
  var c = _confConta(contaId);
  if (!c) return;
  conferirContaAberta = contaId;
  conferirModo = 'lancar';
  var ov = document.getElementById('confSaldoOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'confSaldoOverlay';
    ov.className = 'conf-ov';
    ov.addEventListener('click', function (e) {
      if (e.target === ov) conferirFechar();
    });
    ov.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') conferirFechar();
    });
    document.body.appendChild(ov);
  }
  ov.innerHTML =
    '<div class="conf-modal" role="dialog" aria-modal="true" aria-labelledby="confTitulo">' +
    '<div class="conf-cab"><h2 id="confTitulo">Conferir saldo · ' +
    _confEsc(c.nome) +
    '</h2><button type="button" class="conf-fechar" aria-label="Fechar" onclick="conferirFechar()"><i class="ph ph-x" aria-hidden="true"></i></button></div>' +
    '<label for="confSaldoReal" class="conf-rot">Quanto aparece hoje no app do ' +
    _confEsc(c.nome) +
    '?</label>' +
    '<span class="input-brl-wrap"><input type="text" inputmode="decimal" data-brl="1" id="confSaldoReal" placeholder="0,00" autocomplete="off" oninput="aplicarMascaraBRL(this);_confRenderCorpo()"></span>' +
    '<div id="confCorpo"></div></div>';
  ov.style.display = 'flex';
  _confRenderCorpo();
  var inp = document.getElementById('confSaldoReal');
  if (inp) inp.focus();
}

function conferirFechar() {
  conferirContaAberta = null;
  var ov = document.getElementById('confSaldoOverlay');
  if (ov) ov.style.display = 'none';
}

function _confValorDigitado() {
  var inp = document.getElementById('confSaldoReal');
  var txt = inp ? String(inp.value || '').trim() : '';
  if (!txt) return null;
  var negativo = /^-|^−/.test(txt);
  var v = typeof parseBRL === 'function' ? Number(parseBRL(txt)) : Number(txt);
  if (!isFinite(v)) return null;
  return negativo && v > 0 ? -v : v;
}

function _confItemHtml(it) {
  var acao = '';
  if (it.acao === 'nao-paguei') {
    acao =
      '<button type="button" class="conf-btn-link" data-tx="' +
      _confEsc(it.txId) +
      '" onclick="conferirNaoPaguei(this.dataset.tx)">Não paguei</button>';
  } else if (it.acao === 'ja-caiu') {
    acao =
      '<button type="button" class="conf-btn-link" data-tx="' +
      _confEsc(it.txId) +
      '" onclick="conferirJaCaiu(this.dataset.tx)">Já caiu</button>';
  } else if (it.acao === 'foi-no-cartao') {
    var cards = typeof cartoesAtivos === 'function' ? cartoesAtivos() : [];
    acao = cards
      .slice(0, 3)
      .map(function (cd) {
        return (
          '<button type="button" class="conf-btn-link" data-tx="' +
          _confEsc(it.txId) +
          '" data-cartao="' +
          _confEsc(cd.id) +
          '" onclick="conferirFoiNoCartao(this.dataset.tx, this.dataset.cartao)">Foi no ' +
          _confEsc(/cart[aã]o/i.test(cd.nome || '') ? cd.nome : 'cartão ' + cd.nome) +
          '</button>'
        );
      })
      .join('');
  }
  return (
    '<li><span class="conf-it-desc">' +
    _confEsc(it.desc || '—') +
    '<small>' +
    _confEsc(it.data) +
    '</small></span><span class="conf-it-val">' +
    _confEsc(_confFmt(it.valor)) +
    '</span>' +
    (acao ? '<span class="conf-it-acoes">' + acao + '</span>' : '') +
    '</li>'
  );
}

function _confRenderCorpo() {
  var corpo = document.getElementById('confCorpo');
  var contaId = conferirContaAberta;
  if (!corpo || !contaId) return;
  var app = conferirSaldoApp(contaId, Date.now());
  var real = _confValorDigitado();
  var html =
    '<div class="conf-comp"><div><span>No Appliquei</span><b class="' +
    (app < 0 ? 'neg' : '') +
    '">' +
    _confEsc(_confFmt(app)) +
    '</b></div>';
  if (real == null) {
    corpo.innerHTML =
      html +
      '</div><p class="conf-dica">Digite o saldo que aparece agora no app do banco. Use o sinal de menos se estiver no cheque especial.</p>';
    return;
  }
  var dif = Math.round((real - app) * 100) / 100;
  if (Math.abs(dif) < 0.01) {
    corpo.innerHTML =
      html +
      '<div class="ok"><span>Diferença</span><b>Nenhuma</b></div></div>' +
      '<p class="conf-dica">Bate certinho com o banco.</p>' +
      '<button type="button" class="conf-btn-pri conf-btn-largo" onclick="conferirConfirmar()">Marcar como conferido</button>';
    return;
  }
  html +=
    '<div><span>No banco</span><b class="' +
    (real < 0 ? 'neg' : '') +
    '">' +
    _confEsc(_confFmt(real)) +
    '</b></div>' +
    '<div class="dif"><span>' +
    (dif < 0 ? 'Faltam no Appliquei' : 'Sobram no banco') +
    '</span><b>' +
    _confEsc(_confFmt(Math.abs(dif))) +
    (dif < 0 ? ' de saída' : ' de entrada') +
    '</b></div></div>';
  var lancarTit = dif < 0 ? 'Lançar como gasto' : 'Lançar como entrada';
  var lancarTxt =
    dif < 0
      ? 'Entra hoje em “Outros”, saindo desta conta; você pode mudar a categoria depois.'
      : 'Entra hoje como receita nesta conta; você pode editar depois.';
  html +=
    '<fieldset class="conf-modo"><legend>O que fazer com a diferença?</legend>' +
    '<label><input type="radio" name="confModo" value="lancar"' +
    (conferirModo === 'lancar' ? ' checked' : '') +
    ' onchange="conferirEscolherModo(this.value)"><span><b>' +
    lancarTit +
    '</b><small>' +
    lancarTxt +
    '</small></span></label>' +
    '<label><input type="radio" name="confModo" value="ajuste"' +
    (conferirModo === 'ajuste' ? ' checked' : '') +
    ' onchange="conferirEscolherModo(this.value)"><span><b>Só acertar o saldo</b><small>Ajuste sem categoria; não aparece nos gastos do mês e dá para desfazer.</small></span></label>' +
    '</fieldset>';
  var exp = conferirExplicacoes(contaId, dif);
  if (exp.length) {
    html +=
      '<details class="conf-procurar"><summary>Procurar o que faltou</summary>' +
      exp
        .map(function (e) {
          return (
            '<div class="conf-exp"><strong>' +
            _confEsc(e.titulo) +
            '</strong><p>' +
            _confEsc(e.texto) +
            '</p>' +
            (e.itens.length ? '<ul>' + e.itens.map(_confItemHtml).join('') + '</ul>' : '') +
            '</div>'
          );
        })
        .join('') +
      '</details>';
  }
  html +=
    '<button type="button" class="conf-btn-pri conf-btn-largo" onclick="conferirConfirmar()">' +
    (conferirModo === 'lancar'
      ? 'Lançar ' + _confEsc(_confFmt(Math.abs(dif))) + ' e fechar'
      : 'Ajustar para ' + _confEsc(_confFmt(real))) +
    '</button>';
  corpo.innerHTML = html;
}

function conferirEscolherModo(m) {
  conferirModo = m === 'ajuste' ? 'ajuste' : 'lancar';
  _confRenderCorpo();
}

/**
 * "Lançar como gasto/entrada": a diferença vira um lançamento de hoje nesta
 * conta, já pago — despesa variável em "Outros" (sem categoria) quando falta
 * dinheiro no banco, receita quando sobra. Depois a conta bate e é marcada
 * como conferida, sem ajuste. Devolve o lançamento criado (ou null).
 */
function conferirLancarDiferenca(contaId, saldoReal, agoraMs) {
  var c = _confConta(contaId);
  if (!c || !isFinite(Number(saldoReal)) || typeof criarLancamentos !== 'function') return null;
  var agora = new Date(agoraMs || Date.now());
  var app = conferirSaldoApp(contaId, agora.getTime());
  var dif = Math.round((Number(saldoReal) - app) * 100) / 100;
  if (Math.abs(dif) < 0.01) return null;
  var novos = criarLancamentos({
    descricao: dif < 0 ? 'Diferença no ' + c.nome : 'Entrada no ' + c.nome,
    valor: Math.abs(dif),
    categoria: dif < 0 ? 'despesa_variavel' : 'receita',
    fixo: false,
    parcelas: 1,
    banco: c.nome,
    obs: 'Conferência de saldo',
    dataVencimento: '',
    mesBase: agora.getMonth(),
    anoBase: agora.getFullYear(),
    agora: agora,
  });
  var t = novos && novos[0];
  if (!t) return null;
  t.contaId = c.id;
  t.banco = c.nome;
  t.pago = true;
  t.pagoEm = agora.toISOString();
  transacoes.push(t);
  _confSalvarTransacoes();
  c.conferidoEm = agora.toISOString();
  delete c.avisoSaldoDispensadoEm;
  if (typeof salvarContas === 'function') salvarContas();
  return t;
}

function conferirConfirmar() {
  var contaId = conferirContaAberta;
  var real = _confValorDigitado();
  if (!contaId || real == null) return;
  var app = conferirSaldoApp(contaId, Date.now());
  var lancou = null;
  if (conferirModo === 'lancar' && Math.abs(real - app) >= 0.01) {
    lancou = conferirLancarDiferenca(contaId, real);
  }
  var aj = lancou ? null : conferirAjustar(contaId, real);
  conferirFechar();
  if (typeof mostrarToast === 'function')
    mostrarToast(
      lancou
        ? (lancou.categoria === 'receita' ? 'Entrada lançada' : 'Gasto lançado em “Outros”') +
            ' — a conta bate com o banco.'
        : aj
          ? 'Saldo acertado. O ajuste está no extrato, com Desfazer.'
          : 'Conta conferida.',
      'sucesso'
    );
  conferirRerender();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    conferirAviso: conferirAviso,
    conferirExplicacoes: conferirExplicacoes,
    conferirAjustar: conferirAjustar,
    conferirLancarDiferenca: conferirLancarDiferenca,
  };
}
