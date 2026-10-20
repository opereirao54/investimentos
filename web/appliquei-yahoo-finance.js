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
  motivos: {}, // { TICKER: ['yahoo_chart_429', 'google_sem_preco'] } — do servidor
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

function tipoDoTickerCotado(t, nome) {
  // Com o nome da fonte, "KLABIN UNT" vira ação, não FII.
  var k = typeof classificarAtivoB3 === 'function' ? classificarAtivoB3(t, nome) : null;
  if (k) return k;
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
      tipo: tipoDoTickerCotado(t, q.shortName || q.nome),
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

/**
 * O porquê, em português, a partir do que o servidor relatou: o selo é o
 * único lugar onde a pessoa vê que algo falhou, e "atrasada" sem motivo não
 * ajuda ninguém a diagnosticar.
 */
function motivoCotacaoTexto(tickers) {
  var m = cotacoesEstado.motivos || {};
  var todos = [];
  (tickers || []).forEach(function (t) {
    (m[t] || []).forEach(function (x) {
      todos.push(x);
    });
  });
  if (!todos.length) return '';
  var limitado = todos.some(function (x) {
    return /429|403/.test(x);
  });
  var fora = todos.some(function (x) {
    return /5\d\d|abort|fetch failed|timeout/i.test(x);
  });
  var naoExiste = todos.some(function (x) {
    return /sem_resultado|sem_preco|404/.test(x);
  });
  var partes = [];
  if (limitado) partes.push('a fonte de cotações limitou os pedidos agora');
  if (fora) partes.push('a fonte de cotações não respondeu');
  if (naoExiste && !limitado && !fora) partes.push('a fonte não tem preço para esse código');
  return partes.length ? ' Motivo: ' + partes.join('; ') + '.' : '';
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
        '. Mostrando o último preço conhecido.' +
        motivoCotacaoTexto(e.semCotacao.concat(e.atrasadas));
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
    var motivos = {};
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
        if (data.erros && typeof data.erros === 'object')
          Object.keys(data.erros).forEach(function (t) {
            motivos[t] = data.erros[t];
          });
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
      cotacoesEstado.motivos = motivos;
      if (semCotacao.length || atrasadas.length)
        console.warn('[cotações] sem preço novo:', JSON.stringify(motivos));
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
            carregarCatalogoAtivos(false);
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

// ============================================================
// === CATÁLOGO DA B3 — achar qualquer ativo pelo código ou pelo nome ===
// ============================================================
//
// A busca do formulário só conhecia mockAtivosMercado (~45 ativos). O
// catálogo vem do servidor (op=catalogo: CVM, setores, cotações e BRAPI),
// fica no aparelho por um dia e é completado na hora:
//   - código digitado que o app não conhece → op=quote: se a fonte cota,
//     entra com nome, tipo e preço; se não, "não encontramos na B3";
//   - nome digitado ("klabin") sem resultado bom aqui → op=busca.
// Como as cotações, fica fora do prefixo appliquei_: não é dado da pessoa.
var CATALOGO_CACHE_KEY = 'apq-catalogo-v1';
var CATALOGO_TTL_MS = 24 * 60 * 60 * 1000;
var CATALOGO_SUGESTOES = 12;

var catalogoB3 = { porTicker: {}, atualizadoMs: 0 };
var _promessaCatalogo = null;
var _consultaAtivo = { timer: null, feitas: {}, naoEncontrados: {}, procurando: '' };

function _catalogoIncluirLocal(t, n, k) {
  t = normalizarTickerCotacao(t);
  if (!t || !k) return;
  var atual = catalogoB3.porTicker[t];
  catalogoB3.porTicker[t] = { t: t, n: (atual && atual.n) || n || '', k: k };
}

function restaurarCatalogoSalvo() {
  try {
    var salvo = JSON.parse(localStorage.getItem(CATALOGO_CACHE_KEY) || 'null');
    if (!salvo || !Array.isArray(salvo.ativos)) return;
    salvo.ativos.forEach(function (a) {
      _catalogoIncluirLocal(a[0], a[1], a[2]);
    });
    catalogoB3.atualizadoMs = Number(salvo.atualizadoMs) || 0;
  } catch (_) {}
}

function salvarCatalogoNoAparelho() {
  try {
    localStorage.setItem(
      CATALOGO_CACHE_KEY,
      JSON.stringify({
        atualizadoMs: catalogoB3.atualizadoMs,
        ativos: Object.keys(catalogoB3.porTicker).map(function (t) {
          var a = catalogoB3.porTicker[t];
          return [a.t, a.n, a.k];
        }),
      })
    );
  } catch (_) {}
}

async function _getMercado(op) {
  var fb = window.AppliqueiFirebase;
  var u = fb && fb.auth && fb.auth.currentUser;
  if (!u) return null;
  var token = await u.getIdToken();
  var res = await fetch('/api/market?' + op, { headers: { Authorization: 'Bearer ' + token } });
  var data = await res.json().catch(function () {
    return {};
  });
  if (!res.ok) throw new Error((data && data.error) || 'http_' + res.status);
  return data;
}

/** Baixa o catálogo (uma vez por dia). */
function carregarCatalogoAtivos(forcar) {
  if (_promessaCatalogo) return _promessaCatalogo;
  if (!forcar && Date.now() - catalogoB3.atualizadoMs < CATALOGO_TTL_MS)
    return Promise.resolve(false);
  _promessaCatalogo = (async function () {
    try {
      var data = await _getMercado('op=catalogo');
      if (!data || !Array.isArray(data.ativos)) return false;
      data.ativos.forEach(function (a) {
        _catalogoIncluirLocal(a[0], a[1], a[2]);
      });
      catalogoB3.atualizadoMs = Date.now();
      salvarCatalogoNoAparelho();
      return true;
    } catch (err) {
      console.warn('[catálogo] falha ao baixar:', err && err.message);
      return false;
    } finally {
      _promessaCatalogo = null;
    }
  })();
  return _promessaCatalogo;
}

/** O que se sabe do código: {t, n, k} (k = 'Ação', 'FII', 'ETF', 'BDR', 'Cripto'). */
function infoAtivoB3(ticker) {
  var t = normalizarTickerCotacao(ticker);
  if (!t) return null;
  var base = t.replace(/^([A-Z0-9]{4}\d{1,2})F$/, '$1');
  var m = mockAtivosMercado.find(function (a) {
    return a.ticker === t || a.ticker === base;
  });
  var c = catalogoB3.porTicker[t] || catalogoB3.porTicker[base];
  if (!m && !c) return null;
  var nome = (m && !m.dinamico && m.nome) || (c && c.n) || (m && m.nome) || '';
  // O tipo da lista fixa é curado; o resto é reclassificado com o nome, que
  // é o que separa unit (KLBN11) de FII.
  var tipo =
    m && !m.dinamico && m.tipo
      ? m.tipo
      : (typeof classificarAtivoB3 === 'function' && classificarAtivoB3(t, nome, c && c.k)) ||
        (c && c.k) ||
        (m && m.tipo) ||
        null;
  return { t: t, n: nome, k: tipo };
}

/** Lista para a busca: lista fixa (sem renda fixa) + catálogo. */
function _listaBuscaAtivos() {
  var vistos = {};
  var out = [];
  mockAtivosMercado.forEach(function (a) {
    if (a.tipo === 'Renda Fixa' || vistos[a.ticker]) return;
    vistos[a.ticker] = 1;
    out.push({ t: a.ticker, n: a.nome, k: a.tipo });
  });
  Object.keys(catalogoB3.porTicker).forEach(function (t) {
    if (vistos[t]) return;
    vistos[t] = 1;
    out.push(catalogoB3.porTicker[t]);
  });
  return out;
}

function buscarAtivosLocal(q, limite) {
  if (typeof buscarNoCatalogoB3 !== 'function') return [];
  return buscarNoCatalogoB3(_listaBuscaAtivos(), q, limite || CATALOGO_SUGESTOES);
}

/** Sugestões do campo de ticker: as melhores para o que está digitado. */
function atualizarSugestoesAtivos(texto) {
  var datalist = document.getElementById('listaAtivosMercado');
  if (!datalist || typeof datalist.appendChild !== 'function') return;
  var q = String(texto || '').trim();
  if (q.length < 2) {
    inicializarDatalistAtivos();
    return;
  }
  var achados = buscarAtivosLocal(q);
  datalist.innerHTML = '';
  achados.forEach(function (a) {
    var option = document.createElement('option');
    option.value = a.t;
    var info = infoAtivoB3(a.t) || a;
    var cot = cotacoesEstado.porTicker[a.t];
    option.text =
      (info.n || a.t) +
      (info.k ? ' (' + info.k + ')' : '') +
      (cot && cot.price ? ' - ' + formatarMoeda(cot.price) : '');
    datalist.appendChild(option);
  });
}

function _tickerDigitado(texto) {
  var t = normalizarTickerCotacao(texto);
  return /^[A-Z0-9]{4}\d{1,2}F?$/.test(t) ? t : '';
}

/** Estado da consulta de um código: 'procurando', 'nao_encontrado' ou ''. */
function estadoConsultaAtivo(ticker) {
  var t = normalizarTickerCotacao(ticker);
  if (_consultaAtivo.naoEncontrados[t]) return 'nao_encontrado';
  if (_consultaAtivo.procurando === t) return 'procurando';
  return '';
}

function _redesenharFormularioAtivo() {
  var el = document.getElementById('compraTicker');
  if (!el) return;
  if (typeof atualizarIdentidadeAtivo === 'function') {
    var sel = document.getElementById('compraCategoria');
    var cat = sel ? sel.value : 'renda_variavel';
    atualizarIdentidadeAtivo(el.value, cat !== 'renda_variavel');
  }
  var selSub = document.getElementById('compraSubcategoria');
  var sub =
    typeof subcategoriaInferidaDoTicker === 'function'
      ? subcategoriaInferidaDoTicker(el.value)
      : null;
  if (sub && selSub && !selSub.dataset.touched) selSub.value = sub;
  if (typeof preencherPrecoAutomatico === 'function') preencherPrecoAutomatico();
}

/** Cota um código avulso (que a pessoa ainda não tem). */
async function _consultarCodigo(t) {
  _consultaAtivo.procurando = t;
  _redesenharFormularioAtivo();
  try {
    var data = await _getMercado('op=quote&tickers=' + encodeURIComponent(t));
    if (!data) return;
    var q = data.quotes && data.quotes[t];
    if (q && typeof q.price === 'number' && q.price > 0) {
      aplicarCotacao(t, q);
      var k = typeof classificarAtivoB3 === 'function' ? classificarAtivoB3(t, q.shortName) : null;
      if (k && k !== 'Cripto') {
        _catalogoIncluirLocal(t, q.shortName || '', k);
        salvarCatalogoNoAparelho();
      }
    } else if (
      Array.isArray(data.semCotacao) &&
      data.semCotacao.indexOf(t) !== -1 &&
      !catalogoB3.porTicker[t]
    ) {
      // Só afirma que não existe quando o catálogo também não conhece.
      _consultaAtivo.naoEncontrados[t] = true;
    }
  } catch (err) {
    // Sem rede ou sem login: não afirma que o código não existe.
    delete _consultaAtivo.feitas[t];
    console.warn('[catálogo] consulta falhou:', err && err.message);
  } finally {
    if (_consultaAtivo.procurando === t) _consultaAtivo.procurando = '';
    _redesenharFormularioAtivo();
  }
}

/** Busca por nome na fonte quando o catálogo do aparelho não basta. */
async function _buscarNomeNaFonte(q) {
  try {
    var data = await _getMercado('op=busca&q=' + encodeURIComponent(q));
    if (!data || !Array.isArray(data.ativos)) return;
    data.ativos.forEach(function (a) {
      _catalogoIncluirLocal(a[0], a[1], a[2]);
    });
    if (data.ativos.length) salvarCatalogoNoAparelho();
    var el = document.getElementById('compraTicker');
    if (el && el.value.trim() === q) atualizarSugestoesAtivos(q);
  } catch (err) {
    delete _consultaAtivo.feitas['?' + q.toLowerCase()];
    console.warn('[catálogo] busca falhou:', err && err.message);
  }
}

/**
 * Chamada a cada tecla no campo de ticker (renda variável). Atualiza as
 * sugestões na hora e, depois de uma pausa, consulta o servidor se preciso.
 */
function consultarAtivoDigitado(texto) {
  var q = String(texto || '').trim();
  atualizarSugestoesAtivos(q);
  clearTimeout(_consultaAtivo.timer);
  if (q.length < 2) return;
  _consultaAtivo.timer = setTimeout(function () {
    var t = _tickerDigitado(q);
    if (t) {
      var base = t.replace(/F$/, '');
      var cotado = cotacoesEstado.porTicker[t] || cotacoesEstado.porTicker[base];
      if (cotado || _consultaAtivo.feitas[t]) return;
      _consultaAtivo.feitas[t] = true;
      _consultarCodigo(t);
      return;
    }
    if (q.length < 3 || buscarAtivosLocal(q, 5).length >= 5) return;
    var chave = '?' + q.toLowerCase();
    if (_consultaAtivo.feitas[chave]) return;
    _consultaAtivo.feitas[chave] = true;
    _buscarNomeNaFonte(q);
  }, 450);
}

// ── Títulos do Tesouro para o campo de renda fixa ──
// A lista vem de op=rendafixa (o job do Tesouro Transparente): são os
// títulos à venda, com taxa e vencimento de verdade. Escolher um preenche
// vencimento e rentabilidade — o valor aplicado continua com a pessoa.
var titulosTesouro = [];
var _promessaTesouro = null;

function carregarTitulosTesouro() {
  if (titulosTesouro.length || _promessaTesouro) return _promessaTesouro || Promise.resolve();
  _promessaTesouro = (async function () {
    try {
      var data = await _getMercado('op=rendafixa');
      titulosTesouro = ((data && data.titulos) || []).filter(function (x) {
        return x && x.nome;
      });
      var dl = document.getElementById('listaTitulosTesouro');
      if (dl) {
        dl.innerHTML = '';
        titulosTesouro.forEach(function (x) {
          var o = document.createElement('option');
          o.value = x.nome;
          o.text = rentabilidadeDoTitulo(x) || x.nome;
          dl.appendChild(o);
        });
      }
    } catch (err) {
      console.warn('[tesouro] lista indisponível:', err && err.message);
    } finally {
      _promessaTesouro = null;
    }
  })();
  return _promessaTesouro;
}

/** "IPCA+7,45%", "SELIC+0,05%", "13,20% a.a." — o formato que o formulário entende. */
function rentabilidadeDoTitulo(x) {
  if (!x || typeof x.taxaContratada !== 'number') return '';
  var taxa = x.taxaContratada.toFixed(2).replace('.', ',');
  if (x.tipo === 'ipca') return 'IPCA+' + taxa + '%';
  if (x.tipo === 'selic') return 'SELIC+' + taxa + '%';
  if (x.tipo === 'prefixado') return taxa + '% a.a.';
  return '';
}

/** Nome digitado igual a um título: preenche vencimento e taxa, se vazios. */
function preencherTituloTesouro(nome) {
  var n = String(nome || '')
    .trim()
    .toLowerCase();
  if (!n) return false;
  var x = titulosTesouro.find(function (t) {
    return t.nome.toLowerCase() === n;
  });
  if (!x) return false;
  var venc = document.getElementById('compraVencimento');
  var rent = document.getElementById('compraRentabilidade');
  var mudou = false;
  if (venc && !venc.value && x.vencimento) {
    venc.value = String(x.vencimento).slice(0, 10);
    mudou = true;
  }
  var r = rentabilidadeDoTitulo(x);
  if (rent && !rent.value.trim() && r) {
    rent.value = r;
    mudou = true;
  }
  if (mudou && typeof atualizarProjecaoForm === 'function') atualizarProjecaoForm();
  return mudou;
}

// ── Inicialização (window.onload em app.js) ──
function buscarCotacoesReais() {
  restaurarCotacoesSalvas();
  restaurarCatalogoSalvo();
  if (typeof restaurarDividendosSalvos === 'function') restaurarDividendosSalvos();
  inicializarDatalistAtivos();
  renderStatusCotacoes();
  iniciarAtualizacaoAutomaticaCotacoes();
  return atualizarCotacoes(true);
}

function inicializarDatalistAtivos() {
  const datalist = document.getElementById('listaAtivosMercado');
  if (!datalist || typeof datalist.appendChild !== 'function') return;
  datalist.innerHTML = '';
  mockAtivosMercado.forEach((ativo) => {
    // Renda fixa tem campo próprio (lista do Tesouro); e preço só aparece
    // quando é cotação de verdade, não o de semente da lista fixa.
    if (ativo.tipo === 'Renda Fixa') return;
    const info = infoAtivoB3(ativo.ticker) || {};
    const cot = cotacoesEstado.porTicker[ativo.ticker];
    const option = document.createElement('option');
    option.value = ativo.ticker;
    option.text =
      `${info.n || ativo.nome} (${info.k || ativo.tipo})` +
      (cot && cot.price ? ` - ${formatarMoeda(cot.price)}` : '');
    datalist.appendChild(option);
  });
}
