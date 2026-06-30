/**
 * Appliquei — ABA: Radar de Mercado.
 *
 * Classic script. Indicadores econômicos, cotações de ativos e notícias
 * financeiras. Usa mockAtivosMercado (yahoo-finance.js) + APIs públicas
 * (BCB, AwesomeAPI, Yahoo via CORS proxy, RSS via rss2json).
 */

var _imCarregado = false;
var _imFiltro = 'Todos';
var _imSubTab = 'cotacoes';
var _imNoticiasOk = false;
var _imDadosInd = {};

function carregarNoticias() {
  if (_imCarregado) return;
  _imCarregado = true;
  _carregarIndicadoresMercado();
  _renderFiltrosCotacoes();
  _renderCotacoes();
}

async function atualizarInfoMercado() {
  var btn = document.getElementById('im-btn-atualizar');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> Atualizando…';
  }
  _imDadosInd = {};
  _imNoticiasOk = false;
  await _carregarIndicadoresMercado();
  _renderCotacoes();
  if (_imSubTab === 'noticias') await _carregarNoticiasFeed();
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="ph ph-arrows-clockwise"></i> Atualizar';
  }
}

function mudarSubTabMercado(tab) {
  _imSubTab = tab;
  var tabs = document.querySelectorAll('#noticias .im-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('ativo', tabs[i].getAttribute('data-tab') === tab);
  }
  document.getElementById('im-painel-cotacoes').style.display = tab === 'cotacoes' ? '' : 'none';
  document.getElementById('im-painel-noticias').style.display = tab === 'noticias' ? '' : 'none';
  if (tab === 'noticias' && !_imNoticiasOk) _carregarNoticiasFeed();
}

function filtrarCotacoesMercado(tipo) {
  _imFiltro = tipo;
  var btns = document.querySelectorAll('#im-filtros .im-filtro-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('ativo', btns[i].getAttribute('data-tipo') === tipo);
  }
  _renderCotacoes();
}

function buscarCotacaoIM() {
  var q = (document.getElementById('im-busca').value || '').toUpperCase().trim();
  var rows = document.querySelectorAll('#im-tabela-body tr');
  for (var i = 0; i < rows.length; i++) {
    var txt = rows[i].textContent.toUpperCase();
    rows[i].style.display = !q || txt.indexOf(q) >= 0 ? '' : 'none';
  }
}

// ── Indicadores ──────────────────────────────────────────────

async function _carregarIndicadoresMercado() {
  var el = document.getElementById('im-indicadores');
  if (!el) return;
  _renderIndicadoresUI(el, true);

  var ibov = null,
    dolar = null,
    btcD = null,
    selicD = null;
  var ps = [];

  if (typeof fetchComFallback === 'function') {
    ps.push(
      fetchComFallback(
        'https://query1.finance.yahoo.com/v8/finance/chart/%5EBVSP?interval=2m&range=1d'
      )
        .then(function (j) {
          var m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
          if (m && m.regularMarketPrice) {
            var prev = m.previousClose || m.chartPreviousClose || m.regularMarketPrice;
            ibov = { v: m.regularMarketPrice, d: ((m.regularMarketPrice - prev) / prev) * 100 };
          }
        })
        .catch(function () {})
    );
  }

  ps.push(
    fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL')
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d && d.USDBRL)
          dolar = { v: parseFloat(d.USDBRL.bid), d: parseFloat(d.USDBRL.pctChange) };
      })
      .catch(function () {})
  );

  if (typeof mockAtivosMercado !== 'undefined') {
    var ba = mockAtivosMercado.find(function (a) {
      return a.ticker === 'BTC';
    });
    if (ba) btcD = { v: ba.preco_atual, d: null };
  }

  ps.push(
    fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json')
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d && d[0]) selicD = { v: parseFloat(d[0].valor), d: null };
      })
      .catch(function () {
        selicD = { v: 14.75, d: null };
      })
  );

  await Promise.all(ps);
  _imDadosInd = { ibov: ibov, dolar: dolar, btc: btcD, selic: selicD };
  _renderIndicadoresUI(el, false);
}

function _renderIndicadoresUI(el, loading) {
  var defs = [
    { k: 'ibov', l: 'Ibovespa', ic: 'ph-chart-line-up', c: 'ibov', fmt: 'pts' },
    { k: 'dolar', l: 'Dólar', ic: 'ph-currency-dollar', c: 'dolar', fmt: 'brl' },
    { k: 'btc', l: 'Bitcoin', ic: 'ph-coin', c: 'btc', fmt: 'brl' },
    { k: 'selic', l: 'Taxa Selic', ic: 'ph-trend-up', c: 'selic', fmt: 'pct' },
  ];
  var h = '';
  defs.forEach(function (d) {
    var dado = _imDadosInd[d.k];
    var vStr = '—',
      delta = '';
    if (!loading && dado) {
      if (d.fmt === 'pts') vStr = dado.v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
      else if (d.fmt === 'brl')
        vStr =
          'R$ ' +
          dado.v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      else if (d.fmt === 'pct')
        vStr = dado.v.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + '%';
      if (dado.d !== null && dado.d !== undefined) {
        var cl = dado.d > 0 ? 'pos' : dado.d < 0 ? 'neg' : 'neu';
        var ar = dado.d > 0 ? '↑' : dado.d < 0 ? '↓' : '';
        var sg = dado.d > 0 ? '+' : '';
        delta =
          '<span class="im-delta ' + cl + '">' + ar + ' ' + sg + dado.d.toFixed(2) + '%</span>';
      } else if (d.fmt === 'pct') {
        delta = '<span class="im-delta neu">meta vigente</span>';
      }
    }
    if (loading) vStr = '<span class="im-skel"></span>';
    h +=
      '<div class="im-indicador im-ind-' +
      d.c +
      '">' +
      '<div class="im-ind-header"><div class="im-ind-icon"><i class="ph ' +
      d.ic +
      '"></i></div>' +
      (loading ? '<span class="im-dot-pulse"></span>' : '') +
      '</div>' +
      '<span class="im-ind-label">' +
      d.l +
      '</span>' +
      '<div class="im-ind-valor">' +
      vStr +
      '</div>' +
      delta +
      '</div>';
  });
  el.innerHTML = h;
}

// ── Cotações ─────────────────────────────────────────────────

var _imTipos = ['Todos', 'Ação', 'FII', 'ETF', 'BDR', 'Renda Fixa', 'Cripto'];

function _renderFiltrosCotacoes() {
  var el = document.getElementById('im-filtros');
  if (!el) return;
  var h = '';
  _imTipos.forEach(function (t) {
    h +=
      '<button class="im-filtro-btn' +
      (t === _imFiltro ? ' ativo' : '') +
      '" data-tipo="' +
      t +
      '" onclick="filtrarCotacoesMercado(\'' +
      t +
      '\')">' +
      t +
      '</button>';
  });
  el.innerHTML = h;
}

function _tipoIcone(tipo) {
  var map = {
    Ação: 'ph-chart-line',
    FII: 'ph-buildings',
    ETF: 'ph-stack',
    BDR: 'ph-globe-hemisphere-west',
    'Renda Fixa': 'ph-shield-check',
    Cripto: 'ph-coin',
  };
  return map[tipo] || 'ph-circle';
}

function _tipoCor(tipo) {
  var map = {
    Ação: { bg: 'rgba(37,99,235,0.08)', c: '#2563eb' },
    FII: { bg: 'rgba(124,58,237,0.08)', c: '#7c3aed' },
    ETF: { bg: 'rgba(217,119,6,0.08)', c: '#d97706' },
    BDR: { bg: 'rgba(13,148,136,0.08)', c: '#0d9488' },
    'Renda Fixa': { bg: 'rgba(5,150,105,0.08)', c: '#059669' },
    Cripto: { bg: 'rgba(234,179,8,0.08)', c: '#ca8a04' },
  };
  return map[tipo] || { bg: 'var(--cor-superficie)', c: 'var(--cor-texto-mutado)' };
}

function _renderCotacoes() {
  if (typeof mockAtivosMercado === 'undefined') return;
  var body = document.getElementById('im-tabela-body');
  if (!body) return;
  var q = (document.getElementById('im-busca') || {}).value || '';
  q = q.toUpperCase().trim();

  var ativos = mockAtivosMercado.filter(function (a) {
    if (_imFiltro !== 'Todos' && a.tipo !== _imFiltro) return false;
    if (q && (a.ticker + ' ' + a.nome).toUpperCase().indexOf(q) < 0) return false;
    return true;
  });

  if (!ativos.length) {
    body.innerHTML =
      '<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--cor-texto-mutado);font-size:13px;"><i class="ph ph-magnifying-glass" style="font-size:20px;display:block;margin-bottom:6px;"></i>Nenhum ativo encontrado</td></tr>';
    return;
  }

  var h = '';
  ativos.forEach(function (a) {
    var cor = _tipoCor(a.tipo);
    var preco = a.preco_atual;
    var precoStr;
    if (a.tipo === 'Cripto' && preco >= 1000) {
      precoStr =
        'R$ ' +
        preco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else if (a.tipo === 'Renda Fixa') {
      precoStr =
        'R$ ' +
        preco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      precoStr =
        'R$ ' +
        preco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    h +=
      '<tr>' +
      '<td><span class="im-ticker">' +
      a.ticker +
      '</span></td>' +
      '<td class="im-nome-cell">' +
      a.nome +
      '</td>' +
      '<td><span class="im-tipo-badge" style="background:' +
      cor.bg +
      ';color:' +
      cor.c +
      ';"><i class="ph ' +
      _tipoIcone(a.tipo) +
      '" style="font-size:11px;"></i> ' +
      a.tipo +
      '</span></td>' +
      '<td style="text-align:right;"><span class="im-preco">' +
      precoStr +
      '</span></td>' +
      '</tr>';
  });
  body.innerHTML = h;

  var cnt = document.getElementById('im-contagem');
  if (cnt) cnt.textContent = ativos.length + ' ativo' + (ativos.length !== 1 ? 's' : '');
}

// ── Notícias ─────────────────────────────────────────────────

async function _carregarNoticiasFeed() {
  var loader = document.getElementById('im-loader-noticias');
  var grid = document.getElementById('im-noticias-grid');
  if (!grid) return;
  if (loader) loader.style.display = '';
  grid.style.display = 'none';

  var feeds = [
    { url: 'https://www.infomoney.com.br/feed/', fonte: 'InfoMoney' },
    { url: 'https://valorinveste.globo.com/feed/rss/home.xml', fonte: 'Valor Investe' },
  ];

  var todasNoticias = [];
  var ps = feeds.map(function (f) {
    return fetch('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(f.url))
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data.status === 'ok' && data.items) {
          data.items.forEach(function (item) {
            todasNoticias.push({
              titulo: item.title,
              link: item.link,
              data: item.pubDate,
              fonte: f.fonte,
              thumb: item.thumbnail || (item.enclosure && item.enclosure.link) || '',
            });
          });
        }
      })
      .catch(function () {});
  });

  await Promise.all(ps);
  _imNoticiasOk = true;

  todasNoticias.sort(function (a, b) {
    return new Date(b.data) - new Date(a.data);
  });
  var items = todasNoticias.slice(0, 12);

  if (!items.length) {
    if (loader) loader.style.display = 'none';
    grid.style.display = '';
    grid.innerHTML =
      '<div class="card-container" style="text-align:center;padding:40px 20px;grid-column:1/-1;">' +
      '<i class="ph ph-wifi-slash" style="font-size:28px;color:var(--cor-texto-mutado);display:block;margin-bottom:8px;"></i>' +
      '<p style="color:var(--cor-texto-mutado);font-size:13px;">Não foi possível carregar as notícias.</p></div>';
    return;
  }

  var h = '';
  items.forEach(function (n, idx) {
    var atrás = _tempoAtras(n.data);
    var fonteCor = n.fonte === 'InfoMoney' ? 'var(--cor-info)' : 'var(--cor-primaria)';
    var delay = (idx * 0.04).toFixed(2);
    h +=
      '<article class="im-noticia" style="animation-delay:' +
      delay +
      's;">' +
      '<div class="im-noticia-header">' +
      '<span class="im-noticia-fonte" style="color:' +
      fonteCor +
      ';">' +
      '<i class="ph ph-broadcast"></i> ' +
      n.fonte +
      '</span>' +
      '<span class="im-noticia-tempo"><i class="ph ph-clock"></i> ' +
      atrás +
      '</span>' +
      '</div>' +
      '<h3 class="im-noticia-titulo">' +
      n.titulo +
      '</h3>' +
      '<a href="' +
      n.link +
      '" target="_blank" rel="noopener" class="im-noticia-link">' +
      'Ler matéria <i class="ph ph-arrow-up-right"></i></a>' +
      '</article>';
  });

  if (loader) loader.style.display = 'none';
  grid.innerHTML = h;
  grid.style.display = '';
}

function _tempoAtras(dateStr) {
  var agora = Date.now();
  var pub = new Date(dateStr).getTime();
  var diff = agora - pub;
  var min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return min + ' min';
  var hrs = Math.floor(min / 60);
  if (hrs < 24) return hrs + 'h atrás';
  var dias = Math.floor(hrs / 24);
  if (dias === 1) return 'ontem';
  if (dias < 30) return dias + 'd atrás';
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
