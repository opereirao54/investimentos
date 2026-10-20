/**
 * Appliquei — Yahoo Finance proxy + Base de Dados dos Ativos.
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script independente
 * de state da app. Multi-proxy com fallback automático para cotações
 * Yahoo (CORS workaround). Inclui base de dados estática de tickers.
 *
 * buscarCotacoesReais() é chamado pelo window.onload em app.js — global
 * via classic-script function declaration. As cotações vêm do servidor
 * (/api/market?op=quote), que escolhe a fonte: Yahoo, BRAPI ou CoinGecko.
 */

// --- BASE DE DADOS DOS ATIVOS ---
var mockAtivosMercado = [
  { ticker: 'PETR4', nome: 'Petrobras PN', tipo: 'Ação', preco_atual: 38.5 },
  { ticker: 'PETR3', nome: 'Petrobras ON', tipo: 'Ação', preco_atual: 39.1 },
  { ticker: 'VALE3', nome: 'Vale ON', tipo: 'Ação', preco_atual: 62.1 },
  { ticker: 'ITUB4', nome: 'Itaú Unibanco PN', tipo: 'Ação', preco_atual: 33.4 },
  { ticker: 'BBDC4', nome: 'Bradesco PN', tipo: 'Ação', preco_atual: 14.2 },
  { ticker: 'BBAS3', nome: 'Banco do Brasil ON', tipo: 'Ação', preco_atual: 55.8 },
  { ticker: 'WEGE3', nome: 'WEG ON', tipo: 'Ação', preco_atual: 38.9 },
  { ticker: 'EGIE3', nome: 'Engie Brasil ON', tipo: 'Ação', preco_atual: 41.2 },
  { ticker: 'TAEE11', nome: 'Taesa Unit', tipo: 'Ação', preco_atual: 35.6 },
  { ticker: 'ABEV3', nome: 'Ambev ON', tipo: 'Ação', preco_atual: 12.5 },
  { ticker: 'B3SA3', nome: 'B3 ON', tipo: 'Ação', preco_atual: 11.8 },
  { ticker: 'JBSS3', nome: 'JBS ON', tipo: 'Ação', preco_atual: 22.4 },
  { ticker: 'SUZB3', nome: 'Suzano ON', tipo: 'Ação', preco_atual: 52.3 },
  { ticker: 'RENT3', nome: 'Localiza ON', tipo: 'Ação', preco_atual: 51.2 },
  { ticker: 'RADL3', nome: 'RaiaDrogasil ON', tipo: 'Ação', preco_atual: 26.7 },
  { ticker: 'MXRF11', nome: 'Maxi Renda', tipo: 'FII', preco_atual: 10.35 },
  { ticker: 'BTLG11', nome: 'BTLG Logística', tipo: 'FII', preco_atual: 104.2 },
  { ticker: 'HGLG11', nome: 'CSHG Logística', tipo: 'FII', preco_atual: 162.8 },
  { ticker: 'KNRI11', nome: 'Kinea Renda', tipo: 'FII', preco_atual: 158.9 },
  { ticker: 'CPTS11', nome: 'Capitania Securities', tipo: 'FII', preco_atual: 8.5 },
  { ticker: 'VGHF11', nome: 'Valora Hedge', tipo: 'FII', preco_atual: 9.2 },
  { ticker: 'XPLG11', nome: 'XP Log', tipo: 'FII', preco_atual: 108.5 },
  { ticker: 'VISC11', nome: 'Vinci Fundo', tipo: 'FII', preco_atual: 11.8 },
  { ticker: 'IRDM11', nome: 'Iridium', tipo: 'FII', preco_atual: 78.4 },
  { ticker: 'ALZR11', nome: 'Alianza Trust', tipo: 'FII', preco_atual: 114.6 },
  { ticker: 'BOVA11', nome: 'iShares Ibovespa', tipo: 'ETF', preco_atual: 125.4 },
  { ticker: 'IVVB11', nome: 'iShares S&P 500', tipo: 'ETF', preco_atual: 295.1 },
  { ticker: 'SMAL11', nome: 'iShares Small Cap', tipo: 'ETF', preco_atual: 105.2 },
  { ticker: 'HASH11', nome: 'Hashdex Crypto', tipo: 'ETF', preco_atual: 45.3 },
  { ticker: 'AAPL34', nome: 'Apple', tipo: 'BDR', preco_atual: 42.1 },
  { ticker: 'MSFT34', nome: 'Microsoft', tipo: 'BDR', preco_atual: 58.2 },
  { ticker: 'AMZO34', nome: 'Amazon', tipo: 'BDR', preco_atual: 33.5 },
  {
    ticker: 'TESOURO_IPCA_2035',
    nome: 'Tesouro IPCA+ 2035',
    tipo: 'Renda Fixa',
    preco_atual: 2150.0,
  },
  {
    ticker: 'TESOURO_IPCA_2045',
    nome: 'Tesouro IPCA+ 2045',
    tipo: 'Renda Fixa',
    preco_atual: 1250.0,
  },
  {
    ticker: 'TESOURO_SELIC_2027',
    nome: 'Tesouro Selic 2027',
    tipo: 'Renda Fixa',
    preco_atual: 14850.0,
  },
  {
    ticker: 'TESOURO_SELIC_2029',
    nome: 'Tesouro Selic 2029',
    tipo: 'Renda Fixa',
    preco_atual: 14720.0,
  },
  {
    ticker: 'TESOURO_PREFIXADO_2027',
    nome: 'Tesouro Prefixado 2027',
    tipo: 'Renda Fixa',
    preco_atual: 780.0,
  },
  {
    ticker: 'TESOURO_PREFIXADO_2031',
    nome: 'Tesouro Prefixado 2031',
    tipo: 'Renda Fixa',
    preco_atual: 490.0,
  },
  { ticker: 'BTC', nome: 'Bitcoin', tipo: 'Cripto', preco_atual: 540000.0 },
  { ticker: 'ETH', nome: 'Ethereum', tipo: 'Cripto', preco_atual: 18500.0 },
  { ticker: 'SOL', nome: 'Solana', tipo: 'Cripto', preco_atual: 950.0 },
  { ticker: 'ADA', nome: 'Cardano', tipo: 'Cripto', preco_atual: 3.2 },
  { ticker: 'BNB', nome: 'BNB', tipo: 'Cripto', preco_atual: 3450.0 },
];

// ============================================================
// === YAHOO FINANCE — MULTI-PROXY COM FALLBACK AUTOMÁTICO ===
// ============================================================

// Utilitário para timeout no fetch
async function fetchTimeout(url, ms) {
  const controller = new AbortController();
  const promise = fetch(url, { signal: controller.signal });
  const timeout = setTimeout(() => controller.abort(), ms);
  return promise.finally(() => clearTimeout(timeout));
}

// Lista de proxies CORS gratuitos em ordem de preferência.
// Todos retornam o JSON do Yahoo diretamente (sem wrapper).
// Só os dividendos ainda passam por aqui; as cotações vêm do servidor.
var PROXIES_CORS = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

// Tenta buscar a URL alvo passando por cada proxy em sequência.
// Retorna o JSON parsed assim que um proxy funcionar, ou null se todos falharem.
async function fetchComFallback(urlAlvo, timeoutMs = 10000) {
  for (const construirProxy of PROXIES_CORS) {
    try {
      const urlProxy = construirProxy(urlAlvo);
      const res = await fetchTimeout(urlProxy, timeoutMs);
      if (!res.ok) {
        console.warn(`Proxy retornou status ${res.status} para ${urlAlvo}. Tentando próximo...`);
        continue;
      }
      const json = await res.json();
      return json; // sucesso — retorna direto sem wrapper
    } catch (err) {
      console.warn(`Proxy falhou (${err.message}). Tentando próximo...`);
      continue;
    }
  }
  return null; // todos os proxies falharam
}

// ============================================================
// === COTAÇÕES — UMA FONTE SÓ: o servidor (/api/market?op=quote) ===
// ============================================================
//
// Antes eram dois caminhos: o navegador buscava ~45 tickers fixos na Yahoo
// por proxies CORS gratuitos (instáveis, e que às vezes devolviam cópia
// velha), e o servidor completava só os ativos que estivessem na lista fixa.
// Ativo fora da lista ficava para sempre no preço médio.
//
// Agora o servidor cota TODOS os ativos de renda variável da pessoa — ele
// escolhe a fonte (Yahoo hoje; BRAPI quando BRAPI_TOKEN existir; CoinGecko
// para cripto) e guarda 15 min durante o pregão. O último preço fica salvo no
// aparelho, para o app abrir já com o valor real em vez do preço de semente.
//
// A chave fica FORA do prefixo appliquei_ de propósito: preço de mercado não
// é dado da pessoa e não deve subir para a nuvem nem viajar entre aparelhos.
var COTACOES_CACHE_KEY = 'apq-cotacoes-v1';
var COTACOES_INTERVALO_MS = 5 * 60 * 1000;
var COTACOES_INTERVALO_MIN_MS = 60 * 1000;
var COTACOES_POR_PEDIDO = 50;

var cotacoesEstado = {
  porTicker: {}, // { PETR4: { price, changePct, asOfMs, stale, nome } }
  atualizadoEm: 0,
  falhou: false,
  semCotacao: [],
  atrasadas: [],
};
var _promessaCotacoes = null;
var _cotacoesTimer = null;

/** "petr4.sa " → "PETR4". */
function normalizarTickerCotacao(t) {
  return String(t || '')
    .trim()
    .toUpperCase()
    .replace(/\.SA$/, '')
    .replace(/\s+/g, '');
}

/** Renda variável cotável: ações, FIIs, ETFs, BDRs, units, fracionário e cripto. */
function tickerTemCotacao(t) {
  return /^[A-Z0-9]{3,10}$/.test(t) && !/^TESOURO/.test(t);
}

function tickersParaCotar() {
  if (typeof historicoCompras === 'undefined' || !Array.isArray(historicoCompras)) return [];
  var s = new Set();
  historicoCompras.forEach(function (op) {
    if (!op || !op.ticker) return;
    if (op.categoria && op.categoria !== 'renda_variavel') return;
    var t = normalizarTickerCotacao(op.ticker);
    if (tickerTemCotacao(t)) s.add(t);
  });
  return Array.from(s);
}

function tipoDoTickerCotado(t) {
  var sub =
    typeof subcategoriaInferidaDoTicker === 'function' ? subcategoriaInferidaDoTicker(t) : null;
  return { cripto: 'Cripto', fiis: 'FII', bdrs: 'BDR', etfs: 'ETF', acoes: 'Ação' }[sub] || 'Ação';
}

/**
 * Leva um preço para todas as telas. Elas leem mockAtivosMercado (lista,
 * patrimônio do topo, projeções, sonhos) e mpEstado.cotacoes (Meu
 * patrimônio, renda fixa): os dois recebem o mesmo número.
 */
function aplicarCotacao(t, q) {
  if (!q || typeof q.price !== 'number' || !(q.price > 0)) return false;
  var ativo = mockAtivosMercado.find(function (a) {
    return a.ticker === t;
  });
  var mudou = !ativo || ativo.preco_atual !== q.price;
  if (!ativo) {
    // Ativo fora da lista inicial: entra com o nome que a fonte devolveu.
    ativo = {
      ticker: t,
      nome: q.shortName || q.nome || t,
      tipo: tipoDoTickerCotado(t),
      dinamico: true,
    };
    mockAtivosMercado.push(ativo);
  }
  ativo.preco_atual = q.price;
  cotacoesEstado.porTicker[t] = {
    price: q.price,
    changePct: typeof q.changePct === 'number' ? q.changePct : null,
    asOfMs: q.asOfMs || Date.now(),
    stale: !!q.stale,
    nome: ativo.nome,
  };
  if (typeof mpEstado !== 'undefined' && mpEstado) {
    mpEstado.cotacoes = mpEstado.cotacoes || {};
    mpEstado.cotacoes[t] = { ticker: t, price: q.price, stale: !!q.stale, asOfMs: q.asOfMs };
  }
  return mudou;
}

function salvarCotacoesNoAparelho() {
  try {
    localStorage.setItem(
      COTACOES_CACHE_KEY,
      JSON.stringify({
        porTicker: cotacoesEstado.porTicker,
        atualizadoEm: cotacoesEstado.atualizadoEm,
      })
    );
  } catch (_) {}
}

/** Abre o app com o último preço real conhecido, não o de semente. */
function restaurarCotacoesSalvas() {
  try {
    var bruto = JSON.parse(localStorage.getItem(COTACOES_CACHE_KEY) || 'null');
    if (!bruto || !bruto.porTicker) return;
    Object.keys(bruto.porTicker).forEach(function (t) {
      var q = bruto.porTicker[t];
      aplicarCotacao(t, {
        price: q.price,
        changePct: q.changePct,
        asOfMs: q.asOfMs,
        stale: true,
        shortName: q.nome,
      });
    });
    cotacoesEstado.atualizadoEm = Number(bruto.atualizadoEm) || 0;
  } catch (_) {}
}

/** Mesmo relógio do servidor: dia útil, 10:00–18:10 de Brasília. */
function pregaoAbertoAgora() {
  var d = new Date(Date.now() - 3 * 3600 * 1000);
  var dia = d.getUTCDay();
  var min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return dia >= 1 && dia <= 5 && min >= 600 && min < 1090;
}

function _horaCurta(ms) {
  var t = new Date(ms);
  return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
}

/** Selo "Cotações de 14:32 ↻" no topo de Meus investimentos e de Meu patrimônio. */
function renderStatusCotacoes() {
  var alvos = document.querySelectorAll('.cotacoes-status');
  if (!alvos || !alvos.length) return;
  var e = cotacoesEstado;
  var html = '';
  var titulo = '';
  if (_promessaCotacoes) {
    html = '<i class="ph ph-arrows-clockwise ph-spin"></i> Atualizando cotações…';
  } else if (!tickersParaCotar().length) {
    html = '';
  } else if (e.falhou && e.atualizadoEm) {
    html =
      '<i class="ph-fill ph-warning"></i> Sem conexão — cotações de ' + _horaCurta(e.atualizadoEm);
    titulo = 'Não foi possível atualizar agora. Toque para tentar de novo.';
  } else if (!e.atualizadoEm && !e.falhou) {
    // Ainda não houve busca (ex.: o login não terminou): nada a dizer.
    html = '';
  } else if (e.falhou || !e.atualizadoEm) {
    html = '<i class="ph-fill ph-warning"></i> Cotações indisponíveis';
    titulo = 'Mostrando o preço médio pago. Toque para tentar de novo.';
  } else {
    html = '<i class="ph ph-clock"></i> Cotações de ' + _horaCurta(e.atualizadoEm);
    var falta = e.semCotacao.length + e.atrasadas.length;
    if (falta) {
      html += ' · ' + falta + (falta === 1 ? ' atrasada' : ' atrasadas');
      titulo =
        'Sem preço novo agora para: ' +
        e.semCotacao.concat(e.atrasadas).join(', ') +
        '. Mostrando o último preço conhecido.';
    } else {
      titulo = pregaoAbertoAgora()
        ? 'Atualiza sozinho a cada 5 minutos durante o pregão. Toque para atualizar agora.'
        : 'Pregão fechado: este é o preço de fechamento. Toque para atualizar.';
    }
  }
  alvos.forEach(function (el) {
    el.innerHTML = html;
    el.title = titulo;
    el.style.display = html ? '' : 'none';
    el.classList.toggle(
      'cotacoes-alerta',
      !!(e.falhou || e.semCotacao.length || e.atrasadas.length)
    );
  });
}

function _rerenderTelasComPreco() {
  if (typeof inicializarDatalistAtivos === 'function') inicializarDatalistAtivos();
  var ativa = document.querySelector('.section.ativa');
  var id = ativa ? ativa.id : '';
  if (id === 'patrimonio' && typeof atualizarCarteiraAtivos === 'function')
    atualizarCarteiraAtivos();
  if (id === 'meu_patrimonio' && typeof renderMeuPatrimonio === 'function')
    renderMeuPatrimonio(true);
  try {
    window.dispatchEvent(new CustomEvent('appliquei:cotacoes'));
  } catch (_) {}
}

/**
 * Busca as cotações de todos os ativos da pessoa. Devolve a mesma promessa
 * para quem chamar enquanto uma busca está no ar.
 * opcoes.semRender: quem chamou vai desenhar a tela em seguida.
 */
function atualizarCotacoes(forcar, opcoes) {
  if (_promessaCotacoes) return _promessaCotacoes;
  var tickers = tickersParaCotar();
  if (!tickers.length) {
    renderStatusCotacoes();
    return Promise.resolve(cotacoesEstado);
  }
  if (
    !forcar &&
    Date.now() - cotacoesEstado.atualizadoEm < COTACOES_INTERVALO_MIN_MS &&
    !cotacoesEstado.falhou
  ) {
    return Promise.resolve(cotacoesEstado);
  }
  var fb = window.AppliqueiFirebase;
  var u = fb && fb.auth && fb.auth.currentUser;
  if (!u) return Promise.resolve(cotacoesEstado); // endpoint exige login

  var semRender = !!(opcoes && opcoes.semRender);
  _promessaCotacoes = (async function () {
    renderStatusCotacoes();
    var mudou = false;
    var semCotacao = [];
    var atrasadas = [];
    try {
      var token = await u.getIdToken();
      for (var i = 0; i < tickers.length; i += COTACOES_POR_PEDIDO) {
        var lote = tickers.slice(i, i + COTACOES_POR_PEDIDO);
        var res = await fetch(
          '/api/market?op=quote&tickers=' + encodeURIComponent(lote.join(',')),
          {
            headers: { Authorization: 'Bearer ' + token },
          }
        );
        var data = await res.json().catch(function () {
          return {};
        });
        if (!res.ok || !data || !data.quotes)
          throw new Error((data && data.error) || 'http_' + res.status);
        lote.forEach(function (t) {
          var q = data.quotes[t];
          if (q && typeof q.price === 'number') {
            if (aplicarCotacao(t, q)) mudou = true;
            if (q.stale) atrasadas.push(t);
          } else {
            semCotacao.push(t);
          }
        });
      }
      cotacoesEstado.atualizadoEm = Date.now();
      cotacoesEstado.falhou = false;
      cotacoesEstado.semCotacao = semCotacao;
      cotacoesEstado.atrasadas = atrasadas;
      salvarCotacoesNoAparelho();
      atualizarBadgeEstimados(semCotacao);
    } catch (err) {
      console.warn('[cotações] falha ao atualizar:', err && err.message);
      cotacoesEstado.falhou = true;
    } finally {
      _promessaCotacoes = null;
      renderStatusCotacoes();
      if (typeof invSetCarregando === 'function') invSetCarregando(false);
    }
    if (mudou && !semRender) _rerenderTelasComPreco();
    return cotacoesEstado;
  })();
  return _promessaCotacoes;
}

// Nome antigo: as abas ainda chamam por ele.
function atualizarCotacoesPossuidas(forcar) {
  return atualizarCotacoes(forcar);
}

// Mostra/esconde o selo "Preços estimados" conforme os ativos do usuário que
// ficaram SEM cotação nenhuma (nem nova, nem guardada).
function atualizarBadgeEstimados(semPreco) {
  var badge = document.getElementById('badgePrecosEstimados');
  if (!badge) return;
  badge.style.display = semPreco && semPreco.length ? 'inline-flex' : 'none';
}

/** Durante o pregão, a cada 5 min com o app na tela; e ao voltar para o app. */
function iniciarAtualizacaoAutomaticaCotacoes() {
  if (_cotacoesTimer) return;
  _cotacoesTimer = setInterval(function () {
    if (document.visibilityState === 'visible' && pregaoAbertoAgora()) atualizarCotacoes(true);
  }, COTACOES_INTERVALO_MS);
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') atualizarCotacoes(false);
    });
  } catch (_) {}
  // O login chega depois do onload: a primeira busca espera a sessão.
  var tentativas = 0;
  (function esperarLogin() {
    var fb = window.AppliqueiFirebase;
    if (fb && fb.auth && typeof fb.auth.onAuthStateChanged === 'function') {
      fb.auth.onAuthStateChanged(function (u) {
        if (u)
          setTimeout(function () {
            atualizarCotacoes(true);
            // Os proventos não dependem da cotação: projeção e "Dividendos do
            // mês" saem da quantidade de cotas.
            if (typeof prepararDividendos === 'function') prepararDividendos();
          }, 1200);
      });
      return;
    }
    if (++tentativas < 40) setTimeout(esperarLogin, 500);
  })();
}

// ── Inicialização (window.onload em app.js) ──
function buscarCotacoesReais() {
  restaurarCotacoesSalvas();
  if (typeof restaurarDividendosSalvos === 'function') restaurarDividendosSalvos();
  inicializarDatalistAtivos();
  renderStatusCotacoes();
  iniciarAtualizacaoAutomaticaCotacoes();
  return atualizarCotacoes(true);
}

function inicializarDatalistAtivos() {
  const datalist = document.getElementById('listaAtivosMercado');
  datalist.innerHTML = '';
  mockAtivosMercado.forEach((ativo) => {
    const option = document.createElement('option');
    option.value = ativo.ticker;
    option.text = `${ativo.nome} (${ativo.tipo}) - ${formatarMoeda(ativo.preco_atual)}`;
    datalist.appendChild(option);
  });
}
