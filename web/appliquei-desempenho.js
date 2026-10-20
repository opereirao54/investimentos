/**
 * Appliquei — a carteira contra o mercado: CDI, Ibovespa e inflação.
 *
 * A pergunta que o investidor faz e que o app não respondia: "rendi bem?".
 * Bem é relativo — 8% num ano em que o CDI pagou 11% é perder para a renda
 * fixa sem risco. Este card põe os quatro números lado a lado, no mesmo
 * período.
 *
 * COMO A CARTEIRA É MEDIDA
 * Rentabilidade não é (valor de hoje − aportes) ÷ aportes: quem aportou ontem
 * diluiria o resultado de quem aplicou há um ano. O método é o de Dietz
 * modificado, mês a mês, e os meses são encadeados (retorno ponderado pelo
 * tempo, o mesmo critério dos fundos):
 *
 *     r = (V_fim − V_início − aportes + proventos) ÷ (V_início + Σ aporte × peso)
 *
 * onde `peso` é a fração do mês em que o dinheiro do aporte ficou aplicado.
 * O valor de cada data vem de rendCarteiraEm (renda fixa e previdência pela
 * própria regra; renda variável pelo fechamento da época, de op=history).
 *
 * OS ÍNDICES vêm de op=history: CDI e IPCA do Banco Central, Ibovespa do
 * Yahoo. Se a fonte cair, o servidor devolve a premissa, marcada como
 * estimativa — e o card diz isso.
 *
 * Classic script: `var` no top-level, funções viram globais.
 */

var DESEMPENHO_INDICES = [
  { id: 'CDI', rotulo: 'CDI' },
  { id: 'IBOV', rotulo: 'Ibovespa' },
  { id: 'IPCA', rotulo: 'Inflação (IPCA)' },
];
var DESEMPENHO_RANGE = '3y';
var desempenhoIndices = {}; // { CDI: { serie: [{t,p}], fonte } }
var _desempenhoCarregando = null;
var DESEMPENHO_MESES = 12;

function _desempenhoToken() {
  var fb = window.AppliqueiFirebase;
  var u = fb && fb.auth && fb.auth.currentUser;
  return u ? u.getIdToken() : Promise.resolve(null);
}

/** Baixa as séries dos índices (uma vez por sessão). */
function desempenhoCarregarIndices() {
  if (_desempenhoCarregando) return _desempenhoCarregando;
  var faltam = DESEMPENHO_INDICES.filter(function (i) {
    return !desempenhoIndices[i.id];
  });
  if (!faltam.length) return Promise.resolve(false);
  _desempenhoCarregando = _desempenhoToken()
    .then(function (token) {
      if (!token) return false;
      return Promise.all(
        faltam.map(function (i) {
          return fetch('/api/market?op=history&ticker=' + i.id + '&range=' + DESEMPENHO_RANGE, {
            headers: { Authorization: 'Bearer ' + token },
          })
            .then(function (res) {
              return res.ok ? res.json() : null;
            })
            .then(function (data) {
              if (!data || !Array.isArray(data.series) || data.series.length < 2) return false;
              desempenhoIndices[i.id] = {
                serie: data.series
                  .filter(function (pt) {
                    return pt && isFinite(pt.t) && isFinite(pt.p) && pt.p > 0;
                  })
                  .sort(function (a, b) {
                    return a.t - b.t;
                  }),
                fonte: data.fonte || null,
              };
              return true;
            })
            .catch(function () {
              return false;
            });
        })
      ).then(function (r) {
        return r.some(Boolean);
      });
    })
    .catch(function () {
      return false;
    })
    .then(function (mudou) {
      _desempenhoCarregando = null;
      if (mudou) renderizarDesempenho();
      return mudou;
    });
  return _desempenhoCarregando;
}

/**
 * Nível do índice na data, interpolado entre os dois pontos vizinhos (em
 * log: juro composto é reta em escala log). Fora da série devolve null.
 */
function desempenhoNivelEm(serie, t) {
  if (!Array.isArray(serie) || serie.length < 2) return null;
  if (t < serie[0].t) return null;
  var ult = serie[serie.length - 1];
  if (t >= ult.t) return ult.p;
  for (var i = 1; i < serie.length; i++) {
    if (serie[i].t >= t) {
      var a = serie[i - 1];
      var b = serie[i];
      var f = (t - a.t) / (b.t - a.t || 1);
      return Math.exp(Math.log(a.p) + f * (Math.log(b.p) - Math.log(a.p)));
    }
  }
  return ult.p;
}

/** Variação do índice entre duas datas; `ateMs` diz até onde a série vai. */
function desempenhoIndiceNoPeriodo(id, iniMs, fimMs) {
  var ind = desempenhoIndices[id];
  if (!ind) return null;
  var a = desempenhoNivelEm(ind.serie, iniMs);
  var b = desempenhoNivelEm(ind.serie, fimMs);
  if (!(a > 0) || !(b > 0)) return null;
  var ateMs = Math.min(fimMs, ind.serie[ind.serie.length - 1].t);
  return { retorno: b / a - 1, ateMs: ateMs, estimado: ind.fonte === 'estimativa' };
}

function _opTs(op) {
  var t = op && op.data_op ? new Date(op.data_op).getTime() : NaN;
  return isFinite(t) ? t : null;
}

/** Proventos que caíram em [a, b): quantidade com direito × valor líquido. */
function _desempenhoProventos(a, b) {
  if (typeof cacheDividendos === 'undefined' || typeof qtdNoProvento !== 'function') return 0;
  var total = 0;
  Object.keys(cacheDividendos).forEach(function (t) {
    var c = cacheDividendos[t];
    if (!c || !Array.isArray(c.pagamentos)) return;
    c.pagamentos.forEach(function (p) {
      var ts = new Date(p.data && p.data.length === 10 ? p.data + 'T12:00:00' : p.data).getTime();
      if (!(ts >= a && ts < b)) return;
      var q = qtdNoProvento(t, p);
      if (q > 0)
        total += q * (typeof valorCotaLiquido === 'function' ? valorCotaLiquido(p) : p.valor);
    });
  });
  return total;
}

/**
 * Retorno da carteira entre iniMs e fimMs (Dietz modificado por mês,
 * encadeado). Devolve null quando não há dinheiro aplicado no período.
 */
function desempenhoRetornoCarteira(iniMs, fimMs) {
  if (typeof rendCarteiraEm !== 'function' || typeof historicoCompras === 'undefined') return null;
  var ops = (historicoCompras || []).filter(function (op) {
    var ts = _opTs(op);
    return op && op.ticker && ts != null && ts > iniMs && ts <= fimMs;
  });
  // Fronteiras: o início, cada virada de mês e o fim.
  var cortes = [iniMs];
  var d = new Date(iniMs);
  var prox = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  while (prox < fimMs) {
    cortes.push(prox);
    var dp = new Date(prox);
    prox = new Date(dp.getFullYear(), dp.getMonth() + 1, 1).getTime();
  }
  cortes.push(fimMs);

  var fator = 1;
  var algum = false;
  var estimado = false;
  var vIni = rendCarteiraEm(iniMs);
  for (var i = 1; i < cortes.length; i++) {
    var a = cortes[i - 1];
    var b = cortes[i];
    var vFim = rendCarteiraEm(b);
    if (vFim.estimado) estimado = true;
    var fluxo = 0;
    var fluxoPeso = 0;
    ops.forEach(function (op) {
      var ts = _opTs(op);
      if (!(ts > a && ts <= b)) return;
      var valor = (Number(op.quantidade) || 0) * (Number(op.preco_op || op.preco_pago) || 0);
      var f = (op.tipo || 'compra') === 'venda' ? -valor : valor;
      fluxo += f;
      fluxoPeso += f * ((b - ts) / (b - a || 1));
    });
    var base = vIni.mercado + fluxoPeso;
    if (base > 0.01) {
      var r = (vFim.mercado - vIni.mercado - fluxo + _desempenhoProventos(a, b)) / base;
      // Um mês de −100% ou pior é erro de dado (preço zerado), não mercado.
      if (isFinite(r) && r > -0.95) {
        fator *= 1 + r;
        algum = true;
      }
    }
    vIni = vFim;
  }
  return algum ? { retorno: fator - 1, estimado: estimado } : null;
}

/** Os quatro números do card, para os últimos `meses` (ou desde a 1ª operação). */
function desempenhoComparativo(meses) {
  var fim = Date.now();
  var d = new Date(fim);
  var ini = new Date(
    d.getFullYear(),
    d.getMonth() - (meses || DESEMPENHO_MESES),
    d.getDate()
  ).getTime();
  var primeira = null;
  (typeof historicoCompras !== 'undefined' ? historicoCompras : []).forEach(function (op) {
    var ts = _opTs(op);
    if (ts != null && (primeira == null || ts < primeira)) primeira = ts;
  });
  if (primeira == null) return null;
  var desdeInicio = primeira > ini;
  if (desdeInicio) ini = primeira;
  // Menos de um mês aplicado: não há o que comparar ainda.
  if (fim - ini < 28 * 24 * 3600 * 1000) return { curto: true, iniMs: ini };
  var carteira = desempenhoRetornoCarteira(ini, fim);
  var out = { iniMs: ini, fimMs: fim, desdeInicio: desdeInicio, carteira: carteira, indices: {} };
  DESEMPENHO_INDICES.forEach(function (i) {
    out.indices[i.id] = desempenhoIndiceNoPeriodo(i.id, ini, fim);
  });
  return out;
}

function _pct(v) {
  if (v == null || !isFinite(v)) return '—';
  var s = (v * 100).toFixed(1).replace('.', ',');
  return (v > 0 ? '+' : '') + s + '%';
}

function _mesAno(ms) {
  var nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var d = new Date(ms);
  return nomes[d.getMonth()] + '/' + String(d.getFullYear()).slice(2);
}

/** HTML do card. '' quando não há operação nenhuma. */
function htmlDesempenho(c) {
  if (!c) return '';
  var titulo =
    '<div class="dsp-cab"><span class="dsp-rot"><i class="ph ph-chart-line-up"></i> Sua carteira x mercado</span>' +
    '<span class="dsp-periodo">' +
    (c.desdeInicio || c.curto ? 'desde ' + _mesAno(c.iniMs) : 'últimos 12 meses') +
    '</span></div>';
  if (c.curto) {
    return (
      '<div class="dsp-card">' +
      titulo +
      '<p class="dsp-nota">Com um mês de carteira dá para comparar com o CDI e o Ibovespa. Volte em breve.</p></div>'
    );
  }
  var linhas = [{ rot: 'Sua carteira', v: c.carteira && c.carteira.retorno, destaque: true }];
  DESEMPENHO_INDICES.forEach(function (i) {
    var x = c.indices[i.id];
    linhas.push({ rot: i.rotulo, v: x ? x.retorno : null, ateMs: x && x.ateMs, id: i.id });
  });
  var max = linhas.reduce(function (m, l) {
    return l.v != null ? Math.max(m, Math.abs(l.v)) : m;
  }, 0.0001);
  var barras = linhas
    .map(function (l) {
      var w = l.v != null ? Math.max(2, Math.round((Math.abs(l.v) / max) * 100)) : 0;
      var atraso =
        l.ateMs && c.fimMs - l.ateMs > 20 * 24 * 3600 * 1000
          ? ' <small>até ' + _mesAno(l.ateMs) + '</small>'
          : '';
      return (
        '<div class="dsp-linha' +
        (l.destaque ? ' dsp-eu' : '') +
        '"><span class="dsp-nome">' +
        l.rot +
        atraso +
        '</span><span class="dsp-trilho"><span class="dsp-barra' +
        (l.v != null && l.v < 0 ? ' dsp-neg' : '') +
        '" style="width:' +
        w +
        '%"></span></span><b class="dsp-val">' +
        _pct(l.v) +
        '</b></div>'
      );
    })
    .join('');

  var frases = [];
  var cart = c.carteira && c.carteira.retorno;
  var cdi = c.indices.CDI && c.indices.CDI.retorno;
  var ipca = c.indices.IPCA && c.indices.IPCA.retorno;
  if (cart != null && cdi != null && cdi > 0) {
    var rel = Math.round((cart / cdi) * 100);
    frases.push(
      rel >= 100
        ? 'Sua carteira rendeu <b>' + rel + '% do CDI</b> no período.'
        : 'Sua carteira rendeu <b>' +
            Math.max(rel, 0) +
            '% do CDI</b> no período — abaixo da renda fixa sem risco.'
    );
  }
  if (cart != null && ipca != null) {
    var real = (1 + cart) / (1 + ipca) - 1;
    frases.push('Ganho acima da inflação: <b>' + _pct(real) + '</b>.');
  }
  if (cart == null)
    frases.push('Ainda não há valor de mercado suficiente para medir a sua carteira no período.');

  var avisos = [];
  if (c.carteira && c.carteira.estimado)
    avisos.push('alguns ativos sem histórico de preço foram valorados pela cotação de hoje');
  if (
    DESEMPENHO_INDICES.some(function (i) {
      return c.indices[i.id] && c.indices[i.id].estimado;
    })
  )
    avisos.push('fonte dos índices fora do ar: usando estimativa');
  if (
    DESEMPENHO_INDICES.some(function (i) {
      return !c.indices[i.id];
    })
  )
    avisos.push('índices ainda carregando');

  return (
    '<div class="dsp-card">' +
    titulo +
    '<div class="dsp-linhas">' +
    barras +
    '</div>' +
    (frases.length ? '<p class="dsp-resumo">' + frases.join(' ') + '</p>' : '') +
    '<p class="dsp-nota">Rentabilidade com proventos, descontando aportes e resgates (método de Dietz, mês a mês)' +
    (avisos.length ? '; ' + avisos.join('; ') : '') +
    '. Rentabilidade passada não garante resultado futuro.</p></div>'
  );
}

/** Desenha o card na sub-aba Carteira de Meus investimentos. */
function renderizarDesempenho() {
  var el = document.getElementById('cardDesempenho');
  if (!el) return;
  var c = null;
  try {
    c = desempenhoComparativo(DESEMPENHO_MESES);
  } catch (e) {
    console.warn('[desempenho] falha no cálculo:', e && e.message);
  }
  var html = htmlDesempenho(c);
  el.innerHTML = html;
  el.style.display = html ? '' : 'none';
  if (html) {
    desempenhoCarregarIndices();
    if (typeof rendCarregarHistorico === 'function') rendCarregarHistorico();
  }
}

if (typeof rendAoAtualizar === 'function') rendAoAtualizar(renderizarDesempenho);
