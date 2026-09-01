/**
 * Appliquei — valor de mercado da carteira numa data passada.
 *
 * A DRE do Controle Financeiro tinha a linha "Investimento acumulado", que é
 * CUSTO DE AQUISIÇÃO: quanto saiu do bolso, aporte menos resgate. Faltava a
 * outra metade da pergunta — quanto isso virou. Este arquivo responde essa
 * metade para QUALQUER data, que é o que a DRE precisa: ela mostra uma janela
 * de 12 a 48 meses, e o rendimento de cada coluna é o do fim daquele mês.
 *
 * Cada classe é valorada pela sua própria regra, e as três primeiras já
 * existiam — este arquivo só as reúne:
 *
 *   renda fixa e reserva  valorAtualRendaFixa(ticker, cat, refMs) — juros
 *                         compostos capitalizados dia a dia com CDI/Selic/IPCA.
 *                         Exato em qualquer data passada.
 *   previdência           calcularSaldoPrevidencia(ticker, refMs). Idem.
 *   renda variável        preço de fechamento da época, de /api/market?op=history.
 *                         SEM o histórico, cai para a cotação de hoje.
 *
 * O último caso é o que justifica este arquivo existir. Valorar a posição de
 * março com o preço de setembro não devolve o rendimento de março: devolve o
 * de hoje aplicado a uma posição antiga, e numa tabela contábil isso é um
 * número errado com cara de certo. O gráfico de evolução vivia com essa
 * limitação declarada em comentário; agora ele também usa o histórico.
 *
 * A busca é assíncrona e a tela NUNCA espera por ela: quem desenha chama
 * rendPrecoEm() e recebe o melhor preço disponível naquele instante, com
 * rendTemHistorico() dizendo se é o de época ou o de hoje — para a tela poder
 * dizer a verdade sobre o próprio número. Quando a série chega, o callback
 * registrado redesenha.
 *
 * Classic script: `var` no top-level, funções viram globais.
 */

// Fechamentos por ticker: { TICKER: [{ t, p }, ...] } ordenados por data.
var rendHistorico = {};
// Tickers já pedidos (com sucesso ou não) — não se pede duas vezes na sessão.
var rendPedidos = {};
var rendCarregando = false;
var _rendAoAtualizar = [];

// 3 anos cobre a janela máxima da DRE (48 meses pede 4, mas a série de 3 anos
// é a maior que o endpoint entrega com boa densidade; meses anteriores a ela
// caem para o preço de hoje, e a tela avisa).
var REND_RANGE = '3y';

/** Registra quem redesenhar quando o histórico chegar. */
function rendAoAtualizar(fn) {
  if (typeof fn === 'function' && _rendAoAtualizar.indexOf(fn) === -1) _rendAoAtualizar.push(fn);
}

function _rendAvisar() {
  _rendAoAtualizar.forEach(function (fn) {
    try {
      fn();
    } catch (_) {}
  });
}

/** Tickers de renda variável com posição em algum momento — são os que valem buscar. */
function rendTickersRV() {
  if (typeof historicoCompras === 'undefined' || !Array.isArray(historicoCompras)) return [];
  var vistos = {};
  historicoCompras.forEach(function (op) {
    if (!op || !op.ticker) return;
    var cat = op.categoria || 'renda_variavel';
    if (cat !== 'renda_variavel') return;
    vistos[String(op.ticker).toUpperCase()] = true;
  });
  return Object.keys(vistos);
}

/** Há série de época para este ticker? É o que a tela usa para não mentir. */
function rendTemHistorico(ticker) {
  var s = rendHistorico[String(ticker || '').toUpperCase()];
  return Array.isArray(s) && s.length > 0;
}

/**
 * Preço do ticker na data. Busca binária pelo último fechamento ATÉ refMs —
 * o fechamento seguinte ainda não tinha acontecido naquele dia.
 *
 * Sem série, ou com refMs anterior ao início dela, devolve a cotação de hoje.
 * É a mesma aproximação que o gráfico fazia sozinho antes; a diferença é que
 * agora ela é a exceção e fica declarada, em vez de ser a regra silenciosa.
 */
function rendPrecoEm(ticker, refMs, precoAtualFallback) {
  var t = String(ticker || '').toUpperCase();
  var serie = rendHistorico[t];
  var fallback = Number(precoAtualFallback) || 0;
  if (!Array.isArray(serie) || !serie.length) return fallback;
  if (refMs >= serie[serie.length - 1].t) {
    // Depois do fim da série: a cotação de hoje é mais fresca que o último
    // fechamento guardado.
    return fallback || serie[serie.length - 1].p;
  }
  if (refMs < serie[0].t) return fallback;
  var lo = 0;
  var hi = serie.length - 1;
  while (lo < hi) {
    var meio = Math.ceil((lo + hi) / 2);
    if (serie[meio].t <= refMs) lo = meio;
    else hi = meio - 1;
  }
  var p = Number(serie[lo] && serie[lo].p);
  return isFinite(p) && p > 0 ? p : fallback;
}

/**
 * Posição consolidada da carteira em refMs, por ticker.
 * Aporte com data futura não conta — mesma regra de obterResumoCarteira
 * ("programado, ainda não aconteceu").
 */
function rendPosicaoEm(refMs) {
  var posicao = {};
  var investido = 0;
  if (typeof historicoCompras === 'undefined' || !Array.isArray(historicoCompras)) {
    return { posicao: posicao, investido: 0 };
  }
  var ordenadas = historicoCompras
    .filter(function (op) {
      if (!op || !op.ticker) return false;
      var ts = op.data_op ? new Date(op.data_op).getTime() : null;
      if (ts != null && isFinite(ts) && ts > refMs) return false;
      return true;
    })
    .sort(function (a, b) {
      var ta = a.data_op ? new Date(a.data_op).getTime() : 0;
      var tb = b.data_op ? new Date(b.data_op).getTime() : 0;
      return ta - tb;
    });

  ordenadas.forEach(function (op) {
    var t = String(op.ticker).toUpperCase();
    var preco = Number(op.preco_op || op.preco_pago) || 0;
    var qtd = Number(op.quantidade) || 0;
    if (!posicao[t]) {
      posicao[t] = { qtd: 0, custo: 0, pm: 0, categoria: op.categoria || 'renda_variavel' };
    }
    var p = posicao[t];
    if (op.categoria && p.categoria == null) p.categoria = op.categoria;
    if ((op.tipo || 'compra') === 'venda') {
      // Venda sai pelo preço médio: o que ela reduz é CUSTO, não valor de
      // mercado. Usar o preço da venda aqui misturaria resultado com aporte.
      investido -= qtd * p.pm;
      p.qtd -= qtd;
      p.custo -= qtd * p.pm;
    } else {
      p.qtd += qtd;
      p.custo += qtd * preco;
      p.pm = p.qtd > 0 ? p.custo / p.qtd : 0;
      investido += qtd * preco;
    }
  });
  return { posicao: posicao, investido: Math.max(0, investido) };
}

/**
 * { investido, mercado, rendimento, estimado } da carteira inteira em refMs.
 *
 * `estimado` é true quando alguma posição de renda variável foi valorada pela
 * cotação de hoje por falta de histórico — a tela usa isso para marcar o
 * número em vez de o apresentar como exato.
 */
function rendCarteiraEm(refMs) {
  var r = rendPosicaoEm(refMs);
  var mercado = 0;
  var estimado = false;
  Object.keys(r.posicao).forEach(function (ticker) {
    var p = r.posicao[ticker];
    if (p.qtd <= 0) return;
    var cat = p.categoria;
    if (cat === 'previdencia' && typeof calcularSaldoPrevidencia === 'function') {
      mercado += calcularSaldoPrevidencia(ticker, refMs);
      return;
    }
    if (
      (cat === 'renda_fixa' || cat === 'reserva_emergencia') &&
      typeof valorAtualRendaFixa === 'function'
    ) {
      mercado += valorAtualRendaFixa(ticker, cat, refMs);
      return;
    }
    var ativoMercado =
      typeof mockAtivosMercado !== 'undefined'
        ? mockAtivosMercado.find(function (a) {
            return a.ticker === ticker;
          })
        : null;
    var precoHoje = ativoMercado ? ativoMercado.preco_atual : p.pm;
    if (!rendTemHistorico(ticker)) estimado = true;
    mercado += p.qtd * rendPrecoEm(ticker, refMs, precoHoje);
  });
  return {
    investido: r.investido,
    mercado: mercado,
    rendimento: mercado - r.investido,
    estimado: estimado,
  };
}

/**
 * Busca as séries de fechamento dos tickers de renda variável da carteira.
 *
 * Idempotente e silenciosa: sem sessão do Firebase (o endpoint exige usuário)
 * ou com a rede fora, não faz barulho — quem desenha continua recebendo o
 * preço de hoje e a tela continua dizendo que o número é estimado.
 */
function rendCarregarHistorico() {
  if (rendCarregando) return;
  var tickers = rendTickersRV().filter(function (t) {
    return !rendPedidos[t];
  });
  if (!tickers.length) return;
  rendCarregando = true;

  var token = null;
  var obterToken =
    typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser
      ? firebase.auth().currentUser.getIdToken()
      : Promise.resolve(null);

  obterToken
    .then(function (tk) {
      token = tk;
      if (!token) return [];
      return Promise.all(
        tickers.map(function (t) {
          rendPedidos[t] = true;
          var url =
            '/api/market?op=history&ticker=' + encodeURIComponent(t) + '&range=' + REND_RANGE;
          return fetch(url, { headers: { Authorization: 'Bearer ' + token } })
            .then(function (res) {
              return res.ok ? res.json() : null;
            })
            .then(function (data) {
              if (!data || !Array.isArray(data.series) || !data.series.length) return null;
              var serie = data.series
                .filter(function (pt) {
                  return pt && isFinite(pt.t) && isFinite(pt.p) && pt.p > 0;
                })
                .sort(function (a, b) {
                  return a.t - b.t;
                });
              if (serie.length) rendHistorico[t] = serie;
              return serie.length || null;
            })
            .catch(function () {
              return null;
            });
        })
      );
    })
    .then(function (res) {
      rendCarregando = false;
      if (Array.isArray(res) && res.some(Boolean)) _rendAvisar();
    })
    .catch(function () {
      rendCarregando = false;
    });
}
