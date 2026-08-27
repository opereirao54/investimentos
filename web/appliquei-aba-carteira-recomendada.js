/**
 * Appliquei — ABA 4: Carteira Recomendada v2.
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script, carregado
 * DEPOIS de app.js porque consome dbCarteira (state global definida em
 * app.js), formatarMoeda (app.js) e parseBRL/mostrarToast (utils.js).
 *
 * Funções top-level são globais — chamadas por troca de aba e por
 * onclick handlers no HTML.
 */

// --- ABA 4: CARTEIRA RECOMENDADA v2 ---
// ============================================================

// ── Cores por classe ──
var CART_CORES = { rf: '#059669', acao: '#7c3aed', fii: '#d97706', cripto: '#f59e0b' };
var CART_ICONS = {
  rf: 'ph-shield-check',
  acao: 'ph-chart-line-up',
  fii: 'ph-buildings',
  cripto: 'ph-currency-bitcoin',
};
var CART_NOMES = { rf: 'Renda Fixa', acao: 'Ações', fii: 'FIIs', cripto: 'Criptos' };

// ── Textos educativos por classe ──
var CART_EDU = {
  rf: {
    titulo: 'Renda Fixa',
    icon: 'ph-shield-check',
    corpo:
      'A espinha dorsal da sua carteira. Inclui <strong>Tesouro Direto</strong>, CDBs e LCIs. Você empresta dinheiro ao governo ou bancos e recebe juros. No Brasil, a Selic (13,25% a.a.) torna esses ativos muito competitivos — ideal para preservar capital com liquidez.',
  },
  acao: {
    titulo: 'Ações',
    icon: 'ph-chart-line-up',
    corpo:
      'Ao comprar ações você vira <strong>sócio de uma empresa</strong>. No longo prazo, ações de qualidade tendem a superar a inflação e gerar dividendos. A volatilidade é maior, mas o potencial de crescimento patrimonial também.',
  },
  fii: {
    titulo: 'Fundos de Investimento Imobiliário (FIIs)',
    icon: 'ph-buildings',
    corpo:
      'Permite investir em <strong>imóveis sem comprar um apartamento</strong>. Shoppings, galpões logísticos e lajes corporativas geram aluguéis distribuídos mensalmente — <strong>isentos de IR para pessoa física</strong>. Ótimo para construir renda passiva recorrente.',
  },
  cripto: {
    titulo: 'Criptoativos',
    icon: 'ph-currency-bitcoin',
    corpo:
      '<strong>Alta volatilidade, alto potencial de retorno.</strong> Bitcoin e Ethereum são os ativos digitais mais consolidados. Uma pequena exposição (3–10%) pode diversificar a carteira com descorrelação dos mercados tradicionais. Indicado apenas para investidores que entendem e aceitam o risco.',
  },
};

// ── Mensagens por perfil ──
var CART_MENSAGENS = {
  Conservador: {
    emoji: '🛡️',
    texto:
      'Você valoriza tranquilidade e segurança acima de tudo. Prefere crescer de forma mais lenta, mas com menos sustos no caminho. Sua estratégia é construída para dar previsibilidade e proteger seu patrimônio.',
  },
  Moderado: {
    emoji: '⚖️',
    texto:
      'Você não quer apostar tudo… mas também não quer ficar parado. Sua estratégia é crescer com inteligência, equilibrando segurança e oportunidades. É o perfil de quem pensa no longo prazo e toma decisões com consciência.',
  },
  Arrojado: {
    emoji: '🚀',
    texto:
      'Você não está aqui para pouco. Seu foco é crescimento acelerado, mesmo que isso traga oscilações no caminho. Essa é a estratégia de quem entende que grandes resultados exigem coragem e visão de longo prazo.',
  },
};

// ── Alocações macro padrão por perfil ──
var CART_ALLOC_DEFAULT = {
  Conservador: { rf: 70, acao: 15, fii: 15, cripto: 0 },
  Moderado: { rf: 40, acao: 32, fii: 25, cripto: 3 },
  Arrojado: { rf: 15, acao: 50, fii: 25, cripto: 10 },
};

// ── Queda estimada num "ano ruim" por perfil (métrica de perdas — 4.4) ──
// Mais retorno esperado exige tolerar mais volatilidade no curto prazo.
var CART_QUEDA_ANO_RUIM = { Conservador: 5, Moderado: 15, Arrojado: 25 };

// ── Ativos pré-recomendados padrão por classe ──
var CART_ATIVOS_DEFAULT = {
  rf: [
    { ticker: 'TESOURO_SELIC_2027', nome: 'Tesouro Selic 2027', obs: 'Liquidez e segurança' },
    { ticker: 'TESOURO_IPCA_2035', nome: 'Tesouro IPCA+ 2035', obs: 'Proteção contra inflação' },
    { ticker: 'TESOURO_PREFIXADO_2027', nome: 'Tesouro Prefixado 2027', obs: 'Taxa garantida' },
  ],
  acao: [
    { ticker: 'EGIE3', nome: 'Engie Brasil', obs: 'Energia + dividendos' },
    { ticker: 'WEGE3', nome: 'WEG ON', obs: 'Expansão internacional' },
    { ticker: 'BBAS3', nome: 'Banco do Brasil', obs: 'Banco estatal sólido' },
    { ticker: 'BOVA11', nome: 'iShares Ibovespa ETF', obs: 'Exposição diversificada' },
  ],
  fii: [
    { ticker: 'MXRF11', nome: 'Maxi Renda', obs: 'Dividendos mensais' },
    { ticker: 'BTLG11', nome: 'BTLG Logística', obs: 'Logística premium' },
    { ticker: 'HGLG11', nome: 'CSHG Logística', obs: 'Gestão ativa' },
  ],
  cripto: [
    { ticker: 'BTC', nome: 'Bitcoin', obs: 'Reserva digital global' },
    { ticker: 'ETH', nome: 'Ethereum', obs: 'Smart contracts líder' },
  ],
};

// ── Estrutura do dbCarteira v2 ──
var cartDefaultV2 = {
  versao: 2,
  mesAno: 'Mai/2026',
  descricao: 'Alocação focada em geradores de caixa com diversificação tática.',
  alocacoes: JSON.parse(JSON.stringify(CART_ALLOC_DEFAULT)),
  ativos: JSON.parse(JSON.stringify(CART_ATIVOS_DEFAULT)),
};

function cartCarregarDB() {
  try {
    // Cache da carteira modelo central (chave não-sincronizada) tem prioridade.
    const central = JSON.parse(localStorage.getItem('appliquei_cloud_carteira_modelo'));
    if (central && central.alocacoes) return central;
    const raw = JSON.parse(localStorage.getItem('appliquei_carteira_v2'));
    if (raw && raw.versao === 2) return raw;
    // Migração do formato antigo
    const old = JSON.parse(localStorage.getItem('futurorico_carteira_admin'));
    if (old && old.mesAno) {
      const migrated = JSON.parse(JSON.stringify(cartDefaultV2));
      migrated.mesAno = old.mesAno;
      migrated.descricao = old.descricao || migrated.descricao;
      // Migra ativos antigos
      if (old.ativos) {
        ['rf', 'acao', 'fii', 'cripto'].forEach((c) => (migrated.ativos[c] = []));
        old.ativos.forEach((a) => {
          const c = a.classe || 'rf';
          const mc = c === 'etf' || c === 'bdr' ? 'acao' : c;
          if (!migrated.ativos[mc]) migrated.ativos[mc] = [];
          migrated.ativos[mc].push({ ticker: a.ticker, nome: a.nome, obs: a.obs || '' });
        });
      }
      return migrated;
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(cartDefaultV2));
}

var dbCarteira = cartCarregarDB();

// ── Estado da sessão ──
var cartEstado = {
  perfil: null, // 'Conservador' | 'Moderado' | 'Arrojado'
  capital: 10000, // aporte mensal
  objetivo: null, // 'preservar' | 'renda' | 'aposentadoria' | 'aumentar'
  prazoAnos: 10,
  // O universo vem SEMPRE do ranking. A carteira modelo continua a existir
  // como reserva declarada quando uma classe volta vazia — mas isso é
  // degradação, não uma opção que o cliente escolha.
  //
  // O par de botões saiu porque a diferença entre eles não é escolha de
  // gosto: um é o produto (dados públicos, auditáveis) e o outro é uma
  // lista escrita à mão. Oferecer os dois lado a lado sugeria que valem o
  // mesmo, e convidava a desligar exatamente o que se está a vender.
  // (antes: modoUniverso 'automatico' | 'consultor')
  patrimonio: null, // null = usar o patrimônio real da aba Meu Patrimônio
  lente: null, // null = derivada do objetivo
  simRange: '3y',
  // Carteira montada à mão pelo utilizador. Fica DESLIGADA por omissão: a
  // recomendação é o que a tela apresenta primeiro, sempre.
  custom: null,
};

// ── Estado do motor de recomendação ──
// Separado de cartEstado porque NÃO é preferência do utilizador: é cache de
// dados de mercado, e persistir isto no localStorage guardaria fundamentos
// vencidos que reapareceriam como se fossem de hoje.
var cartMotor = {
  carregando: false,
  fundamentos: {},
  titulosRf: [],
  ranking: [],
  plano: null,
  erro: null,
  buscadoEm: null,
  origemRf: null,
  indicadores: null,
  premissasDegradadas: false,
  base: null,
  // Resposta de op=ranking (objeto com universo/excluidos/classes). NÃO
  // confundir com `ranking`, que é a lista já pontuada pelo motor.
  rankingServidor: null,
  // Classes que o ranking não cobriu e caíram para a carteira modelo.
  fallback: [],
  // Configuração que falta do NOSSO lado (ex.: token de fonte de mercado).
  pendencias: [],
};

// ── Chart instances ──
var chartCartDonut = null;
var chartCartSim = null;

// ════════════════════════════════
// ENTRY POINT
// ════════════════════════════════
function carregarCarteiraCliente() {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem('appliquei_cart_estado'));
    } catch (e) {
      return null;
    }
  })();
  if (saved && saved.perfil) {
    cartEstado.perfil = saved.perfil;
    cartEstado.capital = saved.capital || 10000;
    cartEstado.objetivo = saved.objetivo || null;
    cartEstado.prazoAnos = saved.prazoAnos != null ? saved.prazoAnos : 10;
    cartEstado.patrimonio = saved.patrimonio != null ? saved.patrimonio : null;
    cartEstado.lente = saved.lente || null;
    cartEstado.custom = saved.custom || cartCustomVazio();
    cartRenderizarTela();
  } else {
    cartMostrarQuestionario();
  }
  // A carteira modelo é definida centralmente pelo consultor no painel admin
  // (config/carteiraModelo no Firestore). Busca a versão mais recente e
  // re-renderiza se o perfil já estiver definido.
  cartFetchCentral();
}

// Lê a carteira modelo publicada pelo consultor (Firestore: config/carteiraModelo).
// Mantém o localStorage como cache para abertura instantânea offline.
function cartFetchCentral() {
  try {
    var fb = window.AppliqueiFirebase;
    if (!fb || !fb.db) return;
    fb.db
      .collection('config')
      .doc('carteiraModelo')
      .get()
      .then(function (snap) {
        if (!snap || !snap.exists) return;
        var c = snap.data() || {};
        if (!c.alocacoes && !c.ativos) return;
        dbCarteira = {
          versao: 2,
          mesAno: c.mesAno || dbCarteira.mesAno,
          descricao: c.descricao || dbCarteira.descricao,
          alocacoes: c.alocacoes || dbCarteira.alocacoes,
          ativos: c.ativos || dbCarteira.ativos,
        };
        // Cache em chave NÃO-sincronizada (prefixo appliquei_cloud_ é
        // ignorado pelo cloud-sync) — a carteira modelo é global, não deve
        // entrar no doc de dados de cada utilizador.
        try {
          localStorage.setItem('appliquei_cloud_carteira_modelo', JSON.stringify(dbCarteira));
        } catch (e) {}
        if (cartEstado.perfil) cartRenderizarTela();
      })
      .catch(function () {});
  } catch (e) {}
}

function cartSalvarEstado() {
  localStorage.setItem(
    'appliquei_cart_estado',
    JSON.stringify({
      perfil: cartEstado.perfil,
      capital: cartEstado.capital,
      objetivo: cartEstado.objetivo,
      prazoAnos: cartEstado.prazoAnos,
      patrimonio: cartEstado.patrimonio,
      lente: cartEstado.lente,
      custom: cartEstado.custom || null,
    })
  );
}

// ════════════════════════════════
// QUESTIONNAIRE
// ════════════════════════════════
function cartMostrarQuestionario() {
  document.getElementById('cartQuestionnaire').style.display = 'block';
  document.getElementById('cartPerfilHeader').style.display = 'none';
  document.getElementById('cartHero').style.display = 'none';
  document.getElementById('cartCallout').style.display = 'none';
  document.getElementById('cartSimCard').style.display = 'none';
  const motorWrap = document.getElementById('cartMotorWrap');
  if (motorWrap) motorWrap.style.display = 'none';

  // Wire up option buttons
  document.querySelectorAll('.cart-q-opt').forEach((btn) => {
    btn.onclick = function () {
      const q = this.dataset.q;
      document
        .querySelectorAll(`.cart-q-opt[data-q="${q}"]`)
        .forEach((b) => b.classList.remove('selected'));
      this.classList.add('selected');
    };
  });

  // "Editar perfil" reabre este mesmo formulário. Repor as respostas
  // anteriores evita que mexer no aporte custe responder tudo de novo.
  cartPreencherQuestionario();
}

/** Repõe no formulário as respostas já guardadas (quando existem). */
function cartPreencherQuestionario() {
  function marcar(q, val) {
    if (val == null) return;
    const alvo = document.querySelector(`.cart-q-opt[data-q="${q}"][data-val="${val}"]`);
    if (!alvo) return;
    document
      .querySelectorAll(`.cart-q-opt[data-q="${q}"]`)
      .forEach((b) => b.classList.remove('selected'));
    alvo.classList.add('selected');
  }
  marcar('objetivo', cartEstado.objetivo);
  marcar('prazo', cartEstado.prazoAnos);

  const capital = document.getElementById('cartQCapital');
  if (capital && cartEstado.capital > 0) {
    capital.value = cartEstado.capital.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  const patrimonio = document.getElementById('cartQPatrimonio');
  if (patrimonio && cartEstado.patrimonio != null) {
    patrimonio.value = cartEstado.patrimonio.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}

function cartConcluirQuestionario() {
  const tolerancia = document.querySelector('.cart-q-opt[data-q="tolerancia"].selected')?.dataset
    .val;
  const objetivo = document.querySelector('.cart-q-opt[data-q="objetivo"].selected')?.dataset.val;
  if (!tolerancia || !objetivo)
    return mostrarToast('Responda as 2 perguntas antes de continuar.', 'erro');

  // Calcular perfil
  let perfil;
  if (tolerancia === 'nao_aceito') {
    perfil = 'Conservador';
  } else if (tolerancia === 'ate_15') {
    perfil = 'Moderado';
  } else {
    perfil = objetivo === 'aumentar' ? 'Arrojado' : 'Moderado';
  }

  cartEstado.perfil = perfil;
  cartEstado.objetivo = objetivo;
  var prazoEl = document.querySelector('.cart-q-opt[data-q="prazo"].selected');
  cartEstado.prazoAnos = prazoEl ? parseFloat(prazoEl.dataset.val) : 10;
  cartEstado.capital = parseBRL(document.getElementById('cartQCapital').value) || 10000;
  var patrimonioEl = document.getElementById('cartQPatrimonio');
  var patrimonioDigitado = patrimonioEl ? parseBRL(patrimonioEl.value) : 0;
  // Campo em branco continua null (o motor usa o patrimônio real da aba Meu
  // Patrimônio); zero digitado é uma resposta legítima de quem está a começar.
  cartEstado.patrimonio =
    patrimonioEl && patrimonioEl.value.trim() !== '' ? patrimonioDigitado : null;
  cartEstado.lente = null;
  cartSalvarEstado();

  document.getElementById('cartQuestionnaire').style.display = 'none';
  cartRenderizarTela();
}

function cartEditarPerfil() {
  cartEstado.perfil = null;
  cartSalvarEstado();
  // Fundamentos continuam válidos: o que muda é o perfil, não o mercado.
  // Invalidar o cache aqui gastaria cota da API a cada ajuste de aporte.
  cartMostrarQuestionario();
}

// ════════════════════════════════
// MAIN RENDER
// ════════════════════════════════
function cartRenderizarTela() {
  const p = cartEstado.perfil;
  if (!p) return cartMostrarQuestionario();

  // Profile header
  const msg = CART_MENSAGENS[p] || CART_MENSAGENS.Moderado;
  const badge = document.getElementById('cartPerfilBadge');
  badge.className = `cart-perfil-badge cart-perfil-${p}`;
  badge.innerHTML = `<span class="emoji">${msg.emoji}</span> Perfil ${p}`;
  document.getElementById('cartPerfilMsg').innerHTML = msg.texto;
  document.getElementById('cartCapitalLabel').textContent =
    formatarMoeda(cartEstado.capital) + '/mês';
  document.getElementById('cartPerfilHeader').style.display = 'flex';
  document.getElementById('cartQuestionnaire').style.display = 'none';

  // Descricao
  document.getElementById('carteiraDescricao').textContent =
    `Referência: ${dbCarteira.mesAno} · ${dbCarteira.descricao}`;

  // Hero + callout
  document.getElementById('cartHero').style.display = 'grid';
  document.getElementById('cartCallout').style.display = 'flex';
  document.getElementById('cartSimCard').style.display = 'block';

  cartRenderizarEdu();
  cartRenderizarDonut();
  cartRenderizarMotor();
  cartIniciarSimulacao();
}

// ════════════════════════════════
// EDUCATIONAL PANEL
// ════════════════════════════════
function cartRenderizarEdu() {
  const alloc = cartAlocacaoAlvo();
  const list = document.getElementById('cartEduList');
  list.innerHTML = '';

  ['rf', 'acao', 'fii', 'cripto'].forEach((classe, idx) => {
    const pct = alloc[classe] || 0;
    if (pct === 0 && classe === 'cripto') return;
    const edu = CART_EDU[classe];
    const cor = CART_CORES[classe];
    const vlr = formatarMoeda((cartEstado.capital * pct) / 100);
    const div = document.createElement('div');
    div.className = 'cart-edu-item' + (idx === 0 ? ' expanded' : '');
    div.innerHTML = `
            <div class="cart-edu-item-head" onclick="this.parentElement.classList.toggle('expanded')">
                <div class="cart-edu-item-dot" style="background:${cor};"></div>
                <span class="cart-edu-item-name">${edu.titulo}</span>
                <span class="cart-edu-item-meta">${vlr}</span>
                <span class="cart-edu-item-pct">${pct}%</span>
            </div>
            <div class="cart-edu-item-body">${edu.corpo}</div>`;
    list.appendChild(div);
  });
}

// ════════════════════════════════
// DONUT CHART
// ════════════════════════════════
function cartRenderizarDonut() {
  const alloc = cartAlocacaoAlvo();
  const capital = cartEstado.capital;

  const classes = ['rf', 'acao', 'fii', 'cripto'].filter((c) => (alloc[c] || 0) > 0);
  const data = classes.map((c) => alloc[c]);
  const colors = classes.map((c) => CART_CORES[c]);
  const labels = classes.map((c) => CART_NOMES[c]);

  const ctx = document.getElementById('cartDonutChart');
  if (!ctx) return;
  if (chartCartDonut) chartCartDonut.destroy();

  chartCartDonut = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderWidth: 3,
          borderColor:
            getComputedStyle(document.documentElement).getPropertyValue('--cor-branco') || '#fff',
          hoverBorderWidth: 3,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pct = ctx.parsed;
              const vlr = formatarMoeda((capital * pct) / 100);
              return ` ${pct}% · ${vlr}`;
            },
          },
        },
        datalabels: { display: false },
      },
      onHover: (evt, items) => {
        if (items.length) {
          const classe = classes[items[0].index];
          document
            .querySelectorAll('.cart-edu-item')
            .forEach((el) => el.classList.remove('active'));
          const allEdu = document.querySelectorAll('.cart-edu-item');
          let i = 0;
          ['rf', 'acao', 'fii', 'cripto']
            .filter((c) => (alloc[c] || 0) > 0)
            .forEach((c, idx) => {
              if (c === classe && allEdu[idx]) allEdu[idx].classList.add('active');
            });
        }
      },
    },
  });

  // Center value
  document.getElementById('cartDonutCenterValue').textContent = cartFmtShort(capital);

  // Legend
  const legend = document.getElementById('cartDonutLegend');
  legend.innerHTML = classes
    .map((c, i) => {
      const pct = alloc[c];
      const vlr = formatarMoeda((capital * pct) / 100);
      return `<div class="cart-donut-legend-item">
            <div class="dot" style="background:${colors[i]};"></div>
            <div class="meta">
                <div class="name">${labels[i]}</div>
                <div class="val">${pct}% · ${vlr}</div>
            </div>
        </div>`;
    })
    .join('');
}

function cartFmtShort(v) {
  if (v >= 1e6) return 'R$ ' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return 'R$ ' + (v / 1e3).toFixed(0) + 'k';
  return formatarMoeda(v);
}

// ════════════════════════════════
// ASSET SELECTION GRID
// ════════════════════════════════
// ════════════════════════════════
// HISTORICAL SIMULATION
// ════════════════════════════════
var cartSimAbortController = null;

async function cartIniciarSimulacao() {
  // Wire range buttons
  document.querySelectorAll('.cart-sim-range-btn').forEach((btn) => {
    btn.onclick = function () {
      document.querySelectorAll('.cart-sim-range-btn').forEach((b) => b.classList.remove('active'));
      this.classList.add('active');
      cartEstado.simRange = this.dataset.range;
      cartCarregarSimulacao();
    };
  });
  await cartCarregarSimulacao();
}

async function cartCarregarSimulacao() {
  if (cartSimAbortController) cartSimAbortController.abort();
  cartSimAbortController = new AbortController();
  const signal = cartSimAbortController.signal;

  const loading = document.getElementById('cartSimLoading');
  const kpisEl = document.getElementById('cartSimKpis');
  if (loading) loading.style.display = 'flex';
  if (kpisEl) kpisEl.innerHTML = '';

  const range = cartEstado.simRange;
  const alloc = cartAlocacaoAlvo();

  // Tickers representativos por classe (proxy de retorno)
  const proxies = {
    rf: 'TESOURO_SELIC_2027',
    acao: 'IBOV',
    fii: 'IFIX',
    cripto: 'BTC',
  };

  let token = null;
  try {
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      token = await firebase.auth().currentUser.getIdToken();
    }
  } catch (e) {}

  // Busca CDI como benchmark sempre
  const tickersNecessarios = ['CDI'];
  Object.entries(alloc).forEach(([c, pct]) => {
    if (pct > 0) tickersNecessarios.push(proxies[c]);
  });
  const tickersUnicos = [...new Set(tickersNecessarios)];

  // Projeção (>5 anos): não existe histórico — projeta com retorno esperado.
  if (cartRangeEhProjecao(range)) {
    const seriesMap = {};
    tickersUnicos.forEach((t) => {
      seriesMap[t] = cartSeriesSintetica(t, range);
    });
    if (loading) loading.style.display = 'none';
    const blended = cartCalcularBlendedSeries(alloc, proxies, seriesMap);
    if (!blended || blended.length < 2) {
      if (kpisEl)
        kpisEl.innerHTML =
          '<div style="text-align:center;color:var(--cor-texto-mutado);padding:20px;font-size:13px;">Sem dados para projetar.</div>';
      return;
    }
    cartRenderizarSimChart(blended, seriesMap['CDI'], seriesMap['IBOV'], range);
    cartRenderizarSimKpis(blended, seriesMap['CDI']);
    return;
  }

  async function fetchSerie(ticker) {
    if (!token) return null;
    try {
      const url = `/api/market?op=history&ticker=${encodeURIComponent(ticker)}&range=${range}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (!res.ok) return null;
      const data = await res.json();
      return data.series || null;
    } catch (e) {
      if (e.name === 'AbortError') return null;
      // Fallback: série sintética determinística
      return cartSeriesSintetica(ticker, range);
    }
  }

  // Fetch em paralelo
  const resultados = await Promise.all(
    tickersUnicos.map(async (t) => ({ ticker: t, series: await fetchSerie(t) }))
  );
  if (signal.aborted) return;

  const seriesMap = {};
  resultados.forEach((r) => {
    if (r.series) seriesMap[r.ticker] = r.series;
  });

  // Sem token: usa séries sintéticas locais
  if (!token) {
    tickersUnicos.forEach((t) => {
      if (!seriesMap[t]) seriesMap[t] = cartSeriesSintetica(t, range);
    });
  }

  if (loading) loading.style.display = 'none';

  // Calcular série blended da carteira
  const blendedSeries = cartCalcularBlendedSeries(alloc, proxies, seriesMap);
  const cdiSeries = seriesMap['CDI'];
  const ibovSeries = seriesMap['IBOV'];

  if (!blendedSeries || blendedSeries.length < 2) {
    if (kpisEl)
      kpisEl.innerHTML =
        '<div style="text-align:center;color:var(--cor-texto-mutado);padding:20px;font-size:13px;">Dados históricos indisponíveis no momento.</div>';
    return;
  }

  cartRenderizarSimChart(blendedSeries, cdiSeries, ibovSeries, range);
  cartRenderizarSimKpis(blendedSeries, cdiSeries);
}

// Horizontes suportados. Até 5 anos há histórico real (API); acima disso é
// PROJEÇÃO por juros compostos sobre o retorno esperado de cada classe.
var CART_RANGE_MESES = {
  '1y': 12,
  '3y': 36,
  '5y': 60,
  '10y': 120,
  '20y': 240,
  '30y': 360,
  '50y': 600,
};
function cartRangeEhProjecao(range) {
  return (CART_RANGE_MESES[range] || 36) > 60;
}

function cartSeriesSintetica(ticker, range) {
  const meses = CART_RANGE_MESES[range] || 36;
  // Retornos ANUAIS esperados (CAGR) com prêmio de risco: renda variável e
  // cripto precisam render MAIS que a renda fixa no longo prazo, senão o
  // perfil arrojado projeta menos que o conservador (bug 4.4). Ordem:
  // RF < FII < Ações < Cripto.
  const yields = {
    CDI: 0.105,
    IBOV: 0.15,
    IFIX: 0.125,
    BTC: 0.22,
    TESOURO_SELIC_2027: 0.105,
    TESOURO_IPCA_2035: 0.12,
    TESOURO_PREFIXADO_2027: 0.115,
    TESOURO_SELIC_2029: 0.105,
  };
  const anual = yields[ticker] || 0.11;
  const mensal = Math.pow(1 + anual, 1 / 12) - 1;
  const start = Date.now() - meses * 30 * 86400000;
  const series = [];
  let p = 100;
  for (let i = 0; i <= meses; i++) {
    series.push({ t: start + i * 30 * 86400000, p: +p.toFixed(4) });
    p *= 1 + mensal;
  }
  return series;
}

function cartCalcularBlendedSeries(alloc, proxies, seriesMap) {
  const classes = Object.entries(alloc).filter(([c, pct]) => pct > 0 && seriesMap[proxies[c]]);
  if (!classes.length) return null;

  const totalPct = classes.reduce((s, [, pct]) => s + pct, 0);
  const weights = classes.map(([, pct]) => pct / totalPct);

  // Normaliza todas as séries para começar em 100
  const normalized = classes.map(([classe]) => {
    const s = seriesMap[proxies[classe]];
    const base = s[0].p;
    return s.map((pt) => ({ t: pt.t, p: (pt.p / base) * 100 }));
  });

  const minLen = Math.min(...normalized.map((s) => s.length));
  const blended = [];
  for (let i = 0; i < minLen; i++) {
    const t = normalized[0][i].t;
    const p = normalized.reduce((sum, s, wi) => sum + s[i].p * weights[wi], 0);
    blended.push({ t, p });
  }
  return blended;
}

function cartRenderizarSimChart(blended, cdi, ibov, range) {
  const ctx = document.getElementById('cartSimChart');
  if (!ctx) return;
  if (chartCartSim) chartCartSim.destroy();

  // Ajusta o texto conforme histórico (<=5 anos) ou projeção (>5 anos).
  const disc = document.getElementById('cartSimDisclaimer');
  if (disc) {
    disc.textContent = cartRangeEhProjecao(range)
      ? 'Projeção de longo prazo: juros compostos sobre o retorno anual esperado de cada classe (não é histórico). Rentabilidade futura não é garantida.'
      : 'Rentabilidade passada não garante rentabilidade futura. Tesouro/CDI são curvas indicativas baseadas em yield anual.';
  }

  const normalize = (series) => {
    if (!series || !series.length) return [];
    const base = series[0].p;
    return series.map((pt) => ({
      x: new Date(pt.t).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      y: +((pt.p / base - 1) * 100).toFixed(2),
    }));
  };

  const blendedData = normalize(blended);
  const labels = blendedData.map((d) => d.x);

  const datasets = [
    {
      label: 'Sua carteira',
      data: blendedData.map((d) => d.y),
      borderColor: '#059669',
      backgroundColor: 'rgba(5,150,105,0.08)',
      fill: true,
      tension: 0.3,
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 5,
    },
  ];
  if (cdi) {
    const d = normalize(cdi).slice(0, labels.length);
    datasets.push({
      label: 'CDI',
      data: d.map((p) => p.y),
      borderColor: '#64748b',
      borderDash: [5, 4],
      fill: false,
      tension: 0.3,
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 4,
    });
  }
  if (ibov) {
    const d = normalize(ibov).slice(0, labels.length);
    datasets.push({
      label: 'IBOV',
      data: d.map((p) => p.y),
      borderColor: '#2563eb',
      borderDash: [3, 3],
      fill: false,
      tension: 0.3,
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 4,
    });
  }

  chartCartSim = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            font: { size: 11, family: 'Figtree' },
            usePointStyle: true,
            padding: 14,
            boxWidth: 8,
          },
        },
        datalabels: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              ` ${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10, family: 'Figtree' }, maxTicksLimit: 8, maxRotation: 0 },
        },
        y: {
          grid: { color: 'rgba(0,0,0,0.04)' },
          border: { display: false },
          ticks: { font: { size: 10 }, callback: (v) => (v >= 0 ? '+' : '') + v + '%' },
        },
      },
    },
  });
}

/**
 * Resultado da simulação, com hierarquia.
 *
 * Antes eram OITO caixas do mesmo tamanho, o que é o mesmo que não ter
 * destaque nenhum: a pergunta do título ("como teria performado?") tem UMA
 * resposta — quanto o dinheiro teria virado — e ela competia em pé de
 * igualdade com o drawdown máximo. No telemóvel as oito viravam uma coluna
 * de oito caixas idênticas, e a resposta ficava na terceira.
 *
 * Três níveis agora:
 *   1. o número: patrimônio final, e quanto disso é ganho;
 *   2. os três que o sustentam: aportado, rentabilidade da carteira, ganho %;
 *   3. os de risco e comparação, numa faixa mais leve — importam, mas não
 *      são a resposta.
 */
function cartRenderizarSimKpis(blended, cdi) {
  const el = document.getElementById('cartSimKpis');
  if (!el || !blended || blended.length < 2) return;

  const base = blended[0].p;
  const end = blended[blended.length - 1].p;
  // Retorno do índice no período (rentabilidade da carteira, não do dinheiro).
  const retorno = +((end / base - 1) * 100).toFixed(1);
  const aporteMensal = cartEstado.capital;

  // Simulação de APORTE MENSAL recorrente: a cada ponto da série entra um novo
  // aporte, que cresce pela rentabilidade da carteira do mês do aporte até o
  // fim. Valor final = Σ aporte × (P_fim / P_i). Antes o valor era tratado como
  // um único aporte (lump-sum), subestimando o total investido e o montante.
  const totalAportado = aporteMensal * blended.length;
  let vlrFinal = 0;
  blended.forEach((pt) => {
    if (pt.p > 0) vlrFinal += aporteMensal * (end / pt.p);
  });
  const ganho = vlrFinal - totalAportado;
  const retornoSobreAporte = totalAportado > 0 ? (vlrFinal / totalAportado - 1) * 100 : 0;

  let maiorDrawdown = 0,
    peak = blended[0].p;
  blended.forEach((pt) => {
    if (pt.p > peak) peak = pt.p;
    const dd = ((peak - pt.p) / peak) * 100;
    if (dd > maiorDrawdown) maiorDrawdown = dd;
  });

  const months = blended.length - 1;
  const rentMensal = months > 0 ? +((Math.pow(end / base, 1 / months) - 1) * 100).toFixed(2) : 0;

  let rentCDI = null;
  if (cdi && cdi.length >= 2) {
    rentCDI = +((cdi[Math.min(cdi.length - 1, blended.length - 1)].p / cdi[0].p - 1) * 100).toFixed(
      1
    );
  }
  const alphaCDI = rentCDI !== null ? retorno - rentCDI : null;

  const sinal = (v) => (v >= 0 ? '+' : '');
  const classe = (v) => (v >= 0 ? 'pos' : 'neg');
  const anos = months / 12;
  const periodo =
    anos >= 1 ? Math.round(anos) + (Math.round(anos) === 1 ? ' ano' : ' anos') : months + ' meses';

  // A frase existe para quem não lê número: ela diz a mesma coisa que o hero,
  // em português, e é o que faz a secção informar em vez de exibir.
  const frase =
    'Aportando ' +
    formatarMoeda(aporteMensal) +
    ' por mês durante ' +
    periodo +
    ', você teria colocado ' +
    formatarMoeda(totalAportado) +
    ' do próprio bolso.';

  const secundarios = [
    {
      lbl: 'Retorno médio',
      val: sinal(rentMensal) + rentMensal + '%',
      sub: 'ao mês',
      cls: classe(rentMensal),
      dica: 'Rentabilidade média mensal composta da carteira no período.',
    },
    {
      lbl: 'Maior queda',
      val: '-' + maiorDrawdown.toFixed(1) + '%',
      sub: 'do topo ao fundo',
      cls: 'neg',
      dica: 'A pior queda entre um pico e o fundo seguinte dentro do período.',
    },
    {
      lbl: 'Ano ruim',
      val: '-' + (CART_QUEDA_ANO_RUIM[cartEstado.perfil] || 10) + '%',
      sub: 'esperado no perfil',
      cls: 'neg',
      dica: 'Queda que o perfil ' + (cartEstado.perfil || '') + ' deve tolerar sem vender.',
    },
  ];

  el.innerHTML = `
        <div class="cart-sim-hero">
            <div class="cart-sim-hero-main">
                <div class="cart-sim-hero-lbl">Patrimônio final estimado</div>
                <div class="cart-sim-hero-val">${formatarMoeda(vlrFinal)}</div>
                <div class="cart-sim-hero-frase">${frase}</div>
            </div>
            <div class="cart-sim-hero-delta ${classe(ganho)}">
                <span class="cart-sim-hero-delta-lbl">Ganho sobre o aportado</span>
                <span class="cart-sim-hero-delta-val">${sinal(ganho)}${formatarMoeda(ganho)}</span>
                <span class="cart-sim-hero-delta-pct">${sinal(retornoSobreAporte)}${retornoSobreAporte.toFixed(1)}%</span>
            </div>
        </div>
        <div class="cart-sim-principais">
            <div class="cart-sim-kpi">
                <div class="lbl">Total aportado</div>
                <div class="val">${formatarMoeda(totalAportado)}</div>
                <div class="sub">${blended.length} aportes de ${formatarMoeda(aporteMensal)}</div>
            </div>
            <div class="cart-sim-kpi">
                <div class="lbl">Rentabilidade da carteira</div>
                <div class="val ${classe(retorno)}">${sinal(retorno)}${retorno}%</div>
                <div class="sub">variação da cota no período</div>
            </div>
            ${
              rentCDI === null
                ? ''
                : `<div class="cart-sim-kpi">
                <div class="lbl">CDI no mesmo período</div>
                <div class="val">${sinal(rentCDI)}${rentCDI}%</div>
                <div class="sub">sua carteira: ${sinal(alphaCDI)}${alphaCDI.toFixed(1)}pp ${alphaCDI >= 0 ? 'acima' : 'abaixo'}</div>
            </div>`
            }
        </div>
        <div class="cart-sim-secundarios">
            ${secundarios
              .map(
                (k) => `<div class="cart-sim-mini" title="${cartEsc(k.dica)}">
                <span class="cart-sim-mini-lbl">${k.lbl}</span>
                <span class="cart-sim-mini-val ${k.cls}">${k.val}</span>
                <span class="cart-sim-mini-sub">${k.sub}</span>
            </div>`
              )
              .join('')}
        </div>`;
}
function calcularCarteiraRecomendada() {
  /* no-op — lógica migrada para cartRenderizarTela() */
}

// ════════════════════════════════
// COMPAT: inferirClasse (usada em outros módulos)
// ════════════════════════════════
function inferirClasse(ticker, nome) {
  const t = (ticker || '').toUpperCase();
  const n = (nome || '').toLowerCase();
  if (['BTC', 'ETH', 'SOL', 'ADA', 'BNB', 'XRP', 'DOT', 'AVAX', 'LINK', 'MATIC'].includes(t))
    return 'cripto';
  if (
    t.startsWith('TESOURO_') ||
    n.includes('tesouro') ||
    n.includes('renda fixa') ||
    n.includes('cdb') ||
    n.includes('lci') ||
    n.includes('lca')
  )
    return 'rf';
  if (
    t.endsWith('11') &&
    !t.endsWith('34') &&
    (n.includes('fii') ||
      n.includes('fundo imobiliário') ||
      n.includes('logística') ||
      n.includes('renda') ||
      t.startsWith('M') ||
      t.startsWith('B') ||
      t.startsWith('H') ||
      t.startsWith('K') ||
      t.startsWith('V') ||
      t.startsWith('I') ||
      t.startsWith('A'))
  )
    return 'fii';
  if (t.endsWith('34') || t.endsWith('32') || t.endsWith('33') || t.endsWith('35')) return 'bdr';
  if (n.includes('etf') || t === 'BOVA11' || t === 'IVVB11' || t === 'SMAL11' || t === 'HASH11')
    return 'etf';
  return 'acao';
}

// ════════════════════════════════════════════════════════════
// MOTOR DE RECOMENDAÇÃO
// ════════════════════════════════════════════════════════════
//
// Esta secção liga a tela ao web/appliquei-motor-carteira.js. A divisão de
// trabalho é: o motor decide, aqui só se busca dado e se desenha resultado.
//
// A alocação macro deixou de sair direto de dbCarteira.alocacoes[perfil]:
// passa por cartAlocacaoAlvo(), que aplica objetivo e prazo por cima da
// carteira modelo publicada. Sem isso, responder "renda passiva em 20 anos"
// ou "preservar capital em 1 ano" dava exatamente a mesma tela.

/** Alocação-alvo por classe, já ajustada por objetivo e prazo. */
// ════════════════════════════════════════════════════════════
// MODO PERSONALIZADO
// ════════════════════════════════════════════════════════════
//
// A recomendação é o que a tela apresenta primeiro, sempre, e é o que um
// utilizador que não entende de investimento recebe sem ter de decidir nada.
// Esta secção existe para o outro caso: quem já tem estratégia própria e quer
// a mesma máquina a executar a carteira DELE.
//
// A ordem não é detalhe de layout, é o produto: abrir com um formulário em
// branco transferiria para o utilizador uma decisão que ele veio aqui buscar.
// Por isso o personalizado é opt-in explícito, mora DEPOIS do plano, e volta
// atrás num clique.
//
// Três níveis, do mais grosso ao mais fino, porque é a ordem em que a decisão
// se toma e a ordem em que ela importa para o resultado:
//   1. quanto vai para cada CLASSE  (o que mais move risco e retorno);
//   2. quanto vai para cada SETOR dentro da classe;
//   3. QUAIS ativos podem ser escolhidos.
// Nenhum nível é obrigatório: mexer só no primeiro deixa os outros dois na
// recomendação.

var cartCustomVazio = function () {
  return { ativo: false, alloc: null, setores: null, ativos: null };
};

/** O custom em uso, sempre um objeto — nunca null, para a tela não ramificar. */
function cartCustom() {
  if (!cartEstado.custom) cartEstado.custom = cartCustomVazio();
  return cartEstado.custom;
}

/** Está personalizando de facto? Ligado sem nenhuma escolha continua sendo a recomendação. */
function cartCustomAtivo() {
  var c = cartCustom();
  return !!(c.ativo && (c.alloc || c.setores || c.ativos));
}

/**
 * Reescala um conjunto de pesos para somar 100.
 *
 * Existe para o painel não obrigar o utilizador a fechar a conta na unha. Ele
 * mexe nos números que lhe interessam, a tela mostra o total ao vivo, e a
 * aplicação normaliza — DECLARANDO que normalizou. Bloquear em "tem de dar
 * exatamente 100" transforma um ajuste de dez segundos numa aritmética
 * chata, e recusar em silêncio seria pior.
 */
function cartNormalizar100(pesos) {
  var chaves = Object.keys(pesos || {});
  var soma = 0;
  chaves.forEach(function (k) {
    var v = Number(pesos[k]);
    if (isFinite(v) && v > 0) soma += v;
  });
  var out = {};
  if (soma <= 0) return null;
  var acumulado = 0;
  chaves.forEach(function (k, i) {
    var v = Number(pesos[k]);
    v = isFinite(v) && v > 0 ? v : 0;
    if (i === chaves.length - 1) {
      // O resto vai para o último: arredondar cada um por si deixaria o total
      // em 99 ou 101, e a tela mostraria uma alocação que não fecha.
      out[k] = Math.max(0, motorArred(100 - acumulado, 1));
    } else {
      out[k] = motorArred((v / soma) * 100, 1);
      acumulado += out[k];
    }
  });
  return out;
}

/**
 * Política de setores da classe, na régua do motor.
 *
 * Devolve `undefined` quando o utilizador não mexeu — e `undefined` é o que
 * faz motorPlanoClasse cair na política padrão. Um objeto vazio significaria
 * "sem política nenhuma", que é outra coisa.
 *
 * Setor com peso zero SAI da lista em vez de ficar com alvo 0: é isso que o
 * utilizador quis dizer ao zerá-lo, e um balde de alvo zero continuaria a
 * ganhar vaga na repartição por maior média.
 */
function cartSetoresCustom(classe) {
  if (!cartCustomAtivo()) return undefined;
  var pesos = cartCustom().setores && cartCustom().setores[classe];
  if (!pesos) return undefined;
  var base = (typeof MOTOR_SETORES_ALVO !== 'undefined' && MOTOR_SETORES_ALVO[classe]) || null;
  if (!base) return undefined;
  var lista = base
    .map(function (b) {
      var v = Number(pesos[b.chave]);
      return Object.assign({}, b, { alvo: isFinite(v) && v > 0 ? v : 0 });
    })
    .filter(function (b) {
      return b.alvo > 0;
    });
  // Zerar tudo não pode significar "classe sem política": significaria classe
  // sem seleção nenhuma. Aí a recomendação volta a valer.
  return lista.length ? lista : undefined;
}

/** Ativos que o utilizador liberou nesta classe, ou null quando não escolheu. */
function cartAtivosCustom(classe) {
  if (!cartCustomAtivo()) return null;
  var escolha = cartCustom().ativos && cartCustom().ativos[classe];
  if (!escolha || !escolha.length) return null;
  return escolha;
}

/**
 * Ranking filtrado pelos ativos escolhidos, para o PLANO.
 *
 * A lista da tela continua completa de propósito: esconder o que ficou de
 * fora tiraria do utilizador a única forma de rever a própria escolha. O que
 * muda é só quem pode receber aporte.
 */
function cartRankingParaPlano(ranking) {
  if (!cartCustomAtivo()) return ranking;
  var algum = false;
  MOTOR_CLASSES.forEach(function (c) {
    if (cartAtivosCustom(c)) algum = true;
  });
  if (!algum) return ranking;
  return (ranking || []).filter(function (a) {
    var permitidos = cartAtivosCustom(a.classe);
    if (!permitidos) return true; // classe sem escolha: universo inteiro
    return permitidos.indexOf(a.ticker) !== -1;
  });
}

/** Overrides por classe para motorPlanoAporte. */
function cartPorClasseCustom() {
  var out = {};
  var tem = false;
  MOTOR_CLASSES.forEach(function (c) {
    var setores = cartSetoresCustom(c);
    if (setores !== undefined) {
      out[c] = { setores: setores };
      tem = true;
    }
  });
  return tem ? out : undefined;
}

function cartAlocacaoAlvo() {
  // Distribuição escolhida à mão vence perfil, objetivo e prazo. É o ponto do
  // modo personalizado: quem já sabe o que quer não devia ter o próprio
  // número reescrito por um questionário.
  if (cartCustomAtivo() && cartCustom().alloc) return cartCustom().alloc;
  var p = cartEstado.perfil || 'Moderado';
  var base =
    (dbCarteira.alocacoes && dbCarteira.alocacoes[p]) ||
    CART_ALLOC_DEFAULT[p] ||
    CART_ALLOC_DEFAULT.Moderado;
  if (typeof motorDistribuicaoClasses !== 'function') return base;
  try {
    return motorDistribuicaoClasses({
      perfil: p,
      objetivo: cartEstado.objetivo,
      prazoAnos: cartEstado.prazoAnos,
      base: base,
    }).alocacao;
  } catch (e) {
    console.warn('[carteira] alocação-alvo falhou, usando base:', e.message);
    return base;
  }
}

/** Lente ativa: escolha explícita do utilizador, senão a derivada do objetivo. */
function cartLenteAtiva() {
  if (cartEstado.lente && MOTOR_LENTES[cartEstado.lente]) return cartEstado.lente;
  return MOTOR_LENTE_POR_OBJETIVO[cartEstado.objetivo] || 'equilibrio';
}

async function cartTokenFirebase() {
  if (typeof firebase === 'undefined' || !firebase.auth || !firebase.auth().currentUser)
    return null;
  return firebase.auth().currentUser.getIdToken();
}

/**
 * Patrimônio já investido, por classe do motor.
 *
 * Vem da aba Meu Patrimônio quando ela tem dados — é o número real, e é o
 * que faz o motor mandar o aporte para a classe que está atrasada em vez de
 * repetir a proporção-alvo todo mês. O campo do questionário só entra como
 * substituto quando não há carteira registada.
 */
function cartPatrimonioPorClasse() {
  var out = { rf: 0, acao: 0, fii: 0, cripto: 0 };
  var temDados = false;
  try {
    if (typeof mpConsolidar === 'function') {
      var cons = mpConsolidar() || {};
      var exib = cons.porCategoriaExibicao || {};
      var mapa = {
        renda_fixa: 'rf',
        reserva_emergencia: 'rf',
        previdencia: 'rf',
        acoes: 'acao',
        bdrs: 'acao',
        etfs: 'acao',
        fiis: 'fii',
        cripto: 'cripto',
      };
      Object.keys(exib).forEach(function (k) {
        var destino = mapa[k];
        var valor = exib[k] && exib[k].atual;
        if (!destino || !(valor > 0)) return;
        out[destino] += valor;
        temDados = true;
      });
    }
  } catch (e) {
    console.warn('[carteira] patrimônio por classe indisponível:', e.message);
  }
  if (temDados) return { valores: out, origem: 'carteira' };

  // Sem carteira registada: distribui o valor informado pela alocação-alvo.
  // Assim o rebalanceamento não inventa um desvio que não se sabe existir.
  var informado = cartEstado.patrimonio;
  if (!(informado > 0)) return { valores: null, origem: 'nenhum' };
  var alvo = cartAlocacaoAlvo();
  var proporcional = { rf: 0, acao: 0, fii: 0, cripto: 0 };
  MOTOR_CLASSES.forEach(function (c) {
    proporcional[c] = (informado * (alvo[c] || 0)) / 100;
  });
  return { valores: proporcional, origem: 'informado' };
}

/** Ativos publicados na carteira modelo. */
function cartUniversoBase() {
  var out = [];
  MOTOR_CLASSES.forEach(function (classe) {
    var ativos =
      (dbCarteira.ativos && dbCarteira.ativos[classe]) || CART_ATIVOS_DEFAULT[classe] || [];
    ativos.forEach(function (a) {
      if (!a || !a.ticker) return;
      out.push({ ticker: a.ticker, nome: a.nome || a.ticker, obs: a.obs || '', classe: classe });
    });
  });
  return out;
}

function cartNormalizarNome(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

/** Casa um item de renda fixa da carteira modelo com o título do Tesouro. */
function cartCasarTesouro(ativo, titulos) {
  var alvoTicker = cartNormalizarNome(ativo.ticker);
  var alvoNome = cartNormalizarNome(ativo.nome);
  for (var i = 0; i < titulos.length; i++) {
    var t = titulos[i];
    var tk = cartNormalizarNome(t.ticker);
    var nm = cartNormalizarNome(t.nome);
    if (tk === alvoTicker || nm === alvoNome || nm === alvoTicker || tk === alvoNome) return t;
  }
  return null;
}

// Criptos que a fonte de mercado cobre. Lista fixa porque o universo REAL é
// fixo: o servidor só sabe converter estes símbolos. Não é curadoria — é o
// alcance da integração.
var CART_CRIPTO_UNIVERSO = ['BTC', 'ETH', 'SOL', 'ADA', 'BNB', 'XRP'];

// Quantos candidatos pedir por classe ao ranking. O motor escolhe no máximo
// 6 ações e 5 FIIs; pedir 15 dá folga para o corte por liquidez e para o
// utilizador desmarcar alguns sem esvaziar a classe. Pedir a bolsa inteira
// gastaria uma chamada de cotação por ativo sem mudar o resultado.
var CART_CANDIDATOS_POR_CLASSE = 15;

/** Ranking do universo, já pontuado e cortado no servidor. */
async function cartBuscarRanking(token, lente) {
  var url =
    '/api/market?op=ranking&lente=' +
    encodeURIComponent(lente) +
    '&top=' +
    CART_CANDIDATOS_POR_CLASSE;
  var res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  var data = await res.json();
  if (!res.ok) throw new Error(data.error || 'ranking_indisponivel');
  return data;
}

/**
 * Universo de candidatos.
 *
 * No modo automático NADA vem de lista escrita à mão: ações e FIIs saem do
 * ranking, renda fixa sai da oferta corrente do Tesouro e cripto sai do
 * alcance da integração. É isto que impede a carteira de envelhecer — antes,
 * um título com vencimento em 2027 continuava na lista depois de vencer, e a
 * classe inteira zerava sem ninguém perceber.
 */
function cartUniversoAutomatico(ranking, titulosRf) {
  var out = [];
  var fallback = [];
  var modelo = null;

  // Classe sem candidatos no ranking cai para a carteira modelo.
  //
  // Sem isto, a classe SOME da tela — e o aporte dela vira sobra de caixa em
  // silêncio. É o estado de hoje, antes de a ingestão da CVM rodar pela
  // primeira vez: R$ 1.460 de um aporte de R$ 2.000 ficavam sem destino
  // porque ações e FIIs não existiam no ranking. Mostrar a carteira modelo
  // sem score é pior do que mostrar o ranking, mas é muito melhor do que
  // não mostrar nada e não dizer nada.
  function daCarteiraModelo(classe) {
    if (!modelo) modelo = cartUniversoBase();
    return modelo.filter(function (a) {
      return a.classe === classe;
    });
  }

  function preencher(classe, doRanking) {
    if (doRanking.length) {
      doRanking.forEach(function (item) {
        out.push({
          ticker: item.ticker,
          nome: item.nome || item.ticker,
          classe: classe,
          // O SETOR VEM DAQUI. O ranking do servidor é a única passagem que o
          // traz de graça — a segunda busca do cliente é de cotação e, quando
          // a fonte degrada, devolve setor nulo. Descartá-lo aqui, como se
          // fazia, deixava a política de diversificação sem o campo que ela
          // decide, e a seleção caía para score puro sem ninguém perceber.
          setor: item.setor || null,
          tipoFii: item.tipoFii || null,
          segmentoFii: item.segmentoFii || null,
        });
      });
      return;
    }
    var reserva = daCarteiraModelo(classe);
    if (!reserva.length) return;
    fallback.push(classe);
    reserva.forEach(function (a) {
      out.push({ ticker: a.ticker, nome: a.nome, classe: classe });
    });
  }

  ['acao', 'fii'].forEach(function (classe) {
    var bloco = ranking && ranking.classes && ranking.classes[classe];
    preencher(classe, (bloco && bloco.itens) || []);
  });

  preencher(
    'rf',
    (titulosRf || []).map(function (t) {
      return { ticker: t.ticker, nome: t.nome };
    })
  );

  CART_CRIPTO_UNIVERSO.forEach(function (t) {
    out.push({ ticker: t, nome: t, classe: 'cripto' });
  });

  // A desmarcação manual saiu junto com a grade que a operava. Um filtro
  // gravado sem tela que o mostre encolheria o universo em silêncio, e
  // ninguém conseguiria descobrir por quê olhando o produto.
  return { itens: out, fallback: fallback };
}

async function cartBuscarRendaFixa(token) {
  try {
    var res = await fetch('/api/market?op=rendafixa', {
      headers: { Authorization: 'Bearer ' + token },
    });
    var data = await res.json();
    // `fetch` só rejeita por falha de REDE — um 502 do endpoint ainda é
    // `.json()` válido, e caía direto no `data.titulos ? ... : []` de
    // antes sem passar pelo catch. O console ficava mudo: nenhum warning,
    // nenhuma pista, só a classe RF vazia na tela — indistinguível de
    // "o Tesouro não tem título nenhum hoje".
    if (!res.ok || !data || data.error) {
      console.warn(
        '[carteira/motor] renda fixa indisponível:',
        (data && (data.error || data.detail)) || 'HTTP ' + res.status
      );
      return [];
    }
    return data.titulos || [];
  } catch (e) {
    // Tesouro fora do ar não pode derrubar as outras classes: a RF cai para
    // score neutro e o rodapé diz por quê.
    console.warn('[carteira/motor] renda fixa indisponível:', e.message);
    return [];
  }
}

async function cartBuscarIndicadoresBcb(token) {
  try {
    var res = await fetch('/api/market?op=indicadores', {
      headers: { Authorization: 'Bearer ' + token },
    });
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function cartBuscarFundamentos(token, tickers) {
  var fundamentos = {};
  var lotes = [];
  for (var i = 0; i < tickers.length; i += 50) lotes.push(tickers.slice(i, i + 50));
  var respostas = await Promise.all(
    lotes.map(function (lote) {
      return fetch('/api/market?op=fundamentals&tickers=' + encodeURIComponent(lote.join(',')), {
        headers: { Authorization: 'Bearer ' + token },
      }).then(function (r) {
        return r.json();
      });
    })
  );
  var pendencias = [];
  respostas.forEach(function (r) {
    if (r && r.fundamentos) Object.assign(fundamentos, r.fundamentos);
    if (r && r.configuracaoPendente) pendencias = pendencias.concat(r.configuracaoPendente);
  });
  // Anexado ao retorno em vez de um segundo valor: o chamador já desestrutura
  // um objeto de fundamentos e a pendência é metadado dele.
  fundamentos.__pendencias = pendencias;
  return fundamentos;
}

/**
 * Monta o universo e busca os dados de que ele precisa.
 *
 * São duas passagens de pontuação por desenho: o servidor peneira o universo
 * inteiro com os indicadores da CVM, e aqui buscamos cotação só dos poucos
 * selecionados, para o motor re-pontuar com P/L, P/VP e proventos — que
 * dependem de preço. Fazer tudo no servidor exigiria cotação de centenas de
 * tickers a cada cálculo; fazer tudo aqui exigiria baixar o universo inteiro
 * para o browser.
 */
async function cartBuscarDadosMotor() {
  var token = await cartTokenFirebase();
  if (!token) throw new Error('Sessão expirada — entre novamente para o motor buscar os dados.');

  var titulosRf = await cartBuscarRendaFixa(token);
  var ranking = await cartBuscarRanking(token, cartLenteAtiva());
  var auto = cartUniversoAutomatico(ranking, titulosRf);
  var base = auto.itens;
  var fallback = auto.fallback;

  var tickers = base
    .filter(function (a) {
      return a.classe !== 'rf';
    })
    .map(function (a) {
      return a.ticker;
    });

  var resultados = await Promise.all([
    tickers.length ? cartBuscarFundamentos(token, tickers) : Promise.resolve({}),
    cartBuscarIndicadoresBcb(token),
  ]);

  var fundamentos = resultados[0] || {};
  var pendencias = fundamentos.__pendencias || [];
  delete fundamentos.__pendencias;

  return {
    base: base,
    fundamentos: fundamentos,
    pendencias: pendencias,
    titulosRf: titulosRf,
    indicadores: resultados[1] ? resultados[1].indicadores : null,
    premissasDegradadas: !!(resultados[1] && resultados[1].degradado),
    ranking: ranking,
    fallback: fallback,
  };
}

/** Junta carteira modelo + fundamentos num universo pronto para pontuar. */
function cartMontarUniverso(base, fundamentos, titulosRf) {
  return base.map(function (a) {
    var dados = { ticker: a.ticker, nome: a.nome, classe: a.classe, obs: a.obs };
    if (a.classe === 'rf') {
      var t = cartCasarTesouro(a, titulosRf || []);
      if (t) Object.assign(dados, t, { ticker: a.ticker, nome: a.nome, classe: 'rf' });
    } else {
      dados.setor = a.setor || null;
      dados.tipoFii = a.tipoFii || null;
      var f = fundamentos[a.ticker];
      if (f) {
        Object.assign(dados, f, {
          ticker: a.ticker,
          // Nome da carteira modelo vence o da BRAPI: é o que o consultor
          // escreveu e o que o utilizador reconhece na tela.
          nome: a.nome,
          classe: a.classe,
          // Nulo de uma fonte não apaga o dado de outra — a mesma regra que
          // comporFundamentos aplica no servidor. A cotação simples devolve
          // `setor: null`, e o Object.assign cru apagava com ele o setor que
          // o ranking tinha trazido, levando a classe inteira para fora da
          // política de diversificação.
          setor: f.setor || a.setor || null,
          tipoFii: f.tipoFii || a.tipoFii || null,
        });
      }
    }
    return dados;
  });
}

// ── Render ──

function cartCorScore(score) {
  if (score >= 80) return '#059669';
  if (score >= 65) return '#0891b2';
  if (score >= 50) return '#d97706';
  return '#dc2626';
}

/**
 * Linha de procedência do card: de onde veio o indicador, de que exercício
 * e quando foi lido.
 *
 * Existe porque número sem origem é opinião. "ROE 20,4%" o cliente tem de
 * aceitar; "ROE 20,4% · DFP 2025 · CVM · lido em 14/ago" ele pode conferir —
 * e é a conferência que sustenta a confiança num produto pago.
 */
function cartProcedencia(a) {
  if (!a.fonteRotulo && !a.atualizadoEm) return '';
  var partes = [];
  if (a.fonteRotulo) partes.push(a.fonteRotulo);
  if (a.dataReferencia) partes.push('ref. ' + cartFmtData(a.dataReferencia));

  var vencido = false;
  if (a.atualizadoEm) {
    var dias = Math.floor((Date.now() - a.atualizadoEm) / 86400000);
    vencido = dias > CART_VALIDADE_DIAS;
    partes.push(dias <= 0 ? 'lido hoje' : 'lido há ' + dias + (dias === 1 ? ' dia' : ' dias'));
  }
  return (
    '<div class="cart-score-fonte' +
    (vencido ? ' vencido' : '') +
    '"><i class="ph ' +
    (vencido ? 'ph-clock-countdown' : 'ph-seal-check') +
    '"></i> ' +
    partes.join(' · ') +
    (vencido ? ' — dado vencido, atualize antes de decidir' : '') +
    '</div>'
  );
}

// A partir de quantos dias um fundamento passa a ser sinalizado como velho.
// Balanço não muda todo dia, mas o utilizador tem de saber que está a olhar
// para um número de meses atrás antes de mandar dinheiro em cima dele.
var CART_VALIDADE_DIAS = 45;

function cartFmtData(v) {
  var d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function cartFmtNota(n) {
  if (n === null || n === undefined) return '—';
  return n.toFixed(1).replace('.', ',');
}

// Contador de execução: trocar de lente ou desmarcar ativo dispara um novo
// render enquanto o anterior ainda está no ar. Sem isto, a resposta lenta da
// primeira chamada sobrescreve o resultado da segunda.
var cartMotorSeq = 0;

function cartRenderizarMotorLentes() {
  var wrap = document.getElementById('cartMotorLentes');
  if (!wrap) return;
  var ativa = cartLenteAtiva();
  wrap.innerHTML = Object.keys(MOTOR_LENTES)
    .map(function (id) {
      var l = MOTOR_LENTES[id];
      return (
        '<button type="button" class="cart-motor-lente-btn' +
        (id === ativa ? ' active' : '') +
        '" data-lente="' +
        id +
        '" onclick="cartTrocarLente(\'' +
        id +
        '\')" title="' +
        l.resumo.replace(/"/g, '&quot;') +
        '">' +
        l.nome +
        '</button>'
      );
    })
    .join('');
}

/**
 * Botões de modo do universo.
 *
 * O padrão é "todo o mercado": quem escolhe os candidatos é o dado. A
 * carteira do consultor continua disponível porque há contexto em que um
 * humano no circuito é desejável — mas deixou de ser o único caminho.
 */
function cartTrocarLente(id) {
  if (!MOTOR_LENTES[id]) return;
  cartEstado.lente = id;
  cartSalvarEstado();
  cartRenderizarMotorLentes();
  // A lente decide QUAIS ativos entram na lista curta, não só o peso dos
  // pilares — então o universo tem de ser rebuscado, não só repontuado.
  cartRenderizarMotor(true);
}

/** Recalcula ranking e plano com os fundamentos já em memória (sem rede). */
function cartRecalcularMotor() {
  if (!cartMotor.buscadoEm) return;
  // O universo é o que a busca montou. Remontá-lo aqui a partir da carteira
  // modelo desfaria a descoberta automática a cada troca de lente.
  var base = cartMotor.base || cartUniversoBase();
  var universo = cartMontarUniverso(base, cartMotor.fundamentos, cartMotor.titulosRf);
  cartMotor.ranking = motorRanquear(universo, { lente: cartLenteAtiva() });
  var patr = cartPatrimonioPorClasse();
  cartMotor.origemPatrimonio = patr.origem;
  cartMotor.plano = motorPlanoAporte({
    aporteMensal: cartEstado.capital,
    alocacaoAlvo: cartAlocacaoAlvo(),
    // A LISTA continua completa; só o PLANO respeita a escolha de ativos.
    // Filtrar os dois esconderia do utilizador o que ele deixou de fora.
    ranking: cartRankingParaPlano(cartMotor.ranking),
    patrimonioAtual: patr.valores,
    porClasse: cartPorClasseCustom(),
  });
  cartRenderizarMotorStatus();
  cartRenderizarMotorPlano(cartMotor.plano);
  cartRenderizarMotorRanking(cartMotor.ranking);
  cartRenderizarCustom();
  // Junto com o ranking porque descreve os pesos da lente ATIVA: trocar de
  // lente sem redesenhar isto deixaria a explicação a descrever o cálculo
  // anterior.
  cartRenderizarCriterios();
}

async function cartRenderizarMotor(forcar) {
  var wrap = document.getElementById('cartMotorWrap');
  if (!wrap) return;
  // O motor vem de outro <script>. Se ele falhar ao carregar, o resto da
  // aba (educação, donut, simulação) continua a funcionar sem esta secção —
  // melhor do que uma exceção a cada abertura da aba.
  if (typeof motorRanquear !== 'function') {
    wrap.style.display = 'none';
    console.warn('[carteira] motor não carregado — secção de recomendação escondida.');
    return;
  }
  wrap.style.display = 'block';
  cartRenderizarMotorLentes();

  // Já há fundamentos em memória: refaz as contas sem gastar cota da API.
  if (cartMotor.buscadoEm && !forcar) return cartRecalcularMotor();
  if (cartMotor.carregando) return;

  var seq = ++cartMotorSeq;
  cartMotor.carregando = true;
  cartMotor.erro = null;
  var status = document.getElementById('cartMotorStatus');
  if (status)
    status.innerHTML =
      '<i class="ph ph-circle-notch ph-spin"></i> Buscando indicadores de mercado…';

  try {
    var dados = await cartBuscarDadosMotor();
    if (seq !== cartMotorSeq) return;
    cartMotor.base = dados.base;
    cartMotor.fundamentos = dados.fundamentos;
    cartMotor.titulosRf = dados.titulosRf;
    cartMotor.indicadores = dados.indicadores;
    cartMotor.premissasDegradadas = dados.premissasDegradadas;
    cartMotor.rankingServidor = dados.ranking;
    cartMotor.fallback = dados.fallback || [];
    cartMotor.pendencias = dados.pendencias || [];
    cartMotor.buscadoEm = Date.now();
    cartMotor.carregando = false;
    cartRecalcularMotor();
  } catch (e) {
    if (seq !== cartMotorSeq) return;
    cartMotor.carregando = false;
    cartMotor.erro = e.message;
    console.warn('[carteira/motor] falhou:', e.message);
    // Sem dado de mercado o motor ainda ordena e distribui — só que com
    // score neutro. Mostrar a carteira com aviso é melhor do que uma aba
    // vazia, desde que fique explícito que a nota não vale nada aqui.
    cartMotor.buscadoEm = Date.now();
    cartMotor.fundamentos = {};
    cartMotor.titulosRf = [];
    // Sem rede não há universo descoberto; a carteira modelo é o que resta
    // para a tela ter o que mostrar — sem score, como manda a regra.
    cartMotor.base = cartUniversoBase();
    cartRecalcularMotor();
  }
}

function cartAtualizarMotor() {
  cartMotor.buscadoEm = null;
  cartRenderizarMotor(true);
}

function cartRenderizarMotorStatus() {
  var el = document.getElementById('cartMotorStatus');
  if (!el) return;
  var ranking = cartMotor.ranking || [];
  // A métrica honesta é quantos ativos foram PONTUADOS, não quantos têm
  // algum dado solto: um ativo com um indicador de dezesseis não entra no
  // ranking, e contá-lo como "com dados" inflaria a percepção de cobertura.
  var pontuados = ranking.filter(function (a) {
    return a.score !== null;
  }).length;
  var coberturaMedia = ranking.length
    ? ranking.reduce(function (s, a) {
        return s + a.cobertura;
      }, 0) / ranking.length
    : 0;

  var partes = [];
  var lente = MOTOR_LENTES[cartLenteAtiva()];
  partes.push(
    '<span class="cart-motor-status-item"><i class="ph ph-funnel"></i> Lente <strong>' +
      lente.nome +
      '</strong></span>'
  );
  partes.push(
    '<span class="cart-motor-status-item"><i class="ph ph-database"></i> ' +
      pontuados +
      ' de ' +
      ranking.length +
      ' ativos pontuados (' +
      Math.round(coberturaMedia * 100) +
      '% de cobertura média)</span>'
  );
  if (cartMotor.rankingServidor) {
    var r = cartMotor.rankingServidor;
    var cortados = Object.values(r.excluidos || {}).reduce(function (s2, v) {
      return s2 + v;
    }, 0);
    partes.push(
      '<span class="cart-motor-status-item"><i class="ph ph-globe-hemisphere-west"></i> ' +
        'Universo: ' +
        (r.universo || 0) +
        ' ativos analisados' +
        (cortados ? ', ' + cortados + ' fora do corte de porte e liquidez' : '') +
        '</span>'
    );
  }
  if (cartMotor.origemPatrimonio === 'carteira')
    partes.push(
      '<span class="cart-motor-status-item"><i class="ph ph-scales"></i> Rebalanceando com base na sua carteira atual</span>'
    );
  else if (cartMotor.origemPatrimonio === 'informado')
    partes.push(
      '<span class="cart-motor-status-item"><i class="ph ph-scales"></i> Patrimônio informado no questionário</span>'
    );

  // Pendência de configuração vive em variável PRÓPRIA: a cadeia de else-if
  // abaixo termina num ramo genérico que a sobrescrevia, e o operador voltava
  // a ver "nenhum ativo pôde ser pontuado" em vez da variável que falta.
  var alerta = '';
  var pend = cartMotor.pendencias || [];
  var alertaPendencia = '';
  if (pend.length) {
    alertaPendencia = pend
      .map(function (p) {
        // Só bloqueio pinta de erro. Marcar uma melhoria opcional de vermelho
        // treina o operador a ignorar o vermelho.
        var bloqueio = p.severidade === 'bloqueio';
        return (
          '<div class="cart-motor-alerta ' +
          (bloqueio ? 'erro' : '') +
          '"><i class="ph ph-' +
          (bloqueio ? 'warning-circle' : p.chave ? 'lightning' : 'hourglass-medium') +
          '"></i><span><strong>' +
          p.fonte +
          ':</strong> ' +
          p.diagnostico +
          '<br><strong>' +
          (p.severidade === 'melhoria' ? 'Opcional' : 'O que fazer') +
          ':</strong> ' +
          p.acao +
          (p.alcance ? '<br><em>' + p.alcance + '</em>' : '') +
          '</span></div>'
        );
      })
      .join('');
  }
  if (cartMotor.erro) {
    alerta =
      '<div class="cart-motor-alerta erro"><i class="ph ph-warning-circle"></i> ' +
      'Não foi possível buscar os indicadores (' +
      cartMotor.erro +
      '). Os scores abaixo estão neutros — a divisão por classe continua válida.</div>';
  } else if (!pend.length && ranking.length && pontuados === 0) {
    // Estado que o plano grátis da fonte de mercado produz. Antes ele passava
    // despercebido atrás de uma parede de scores baixos; agora é a primeira
    // coisa que a tela diz, porque muda o que o plano abaixo significa.
    alerta =
      '<div class="cart-motor-alerta erro"><i class="ph ph-warning-circle"></i> ' +
      '<span><strong>Nenhum ativo pôde ser pontuado.</strong> Os indicadores fundamentalistas não ' +
      'chegaram da fonte de mercado, então não há score e a divisão dentro de cada classe saiu igual — ' +
      'não é resultado de análise. Cada card abaixo lista o que está em falta.</span></div>';
  } else if (pend.length) {
    // Com a causa nomeada, os avisos genéricos abaixo só mandariam procurar
    // no lugar errado.
    alerta = '';
  } else if ((cartMotor.fallback || []).length) {
    // Estado esperado antes de a ingestão da CVM rodar pela primeira vez.
    // Precisa ser dito, senão o utilizador acha que aquela é a seleção do
    // motor quando na verdade é a lista do painel, sem análise por trás.
    var nomes = cartMotor.fallback.map(function (c) {
      return CART_NOMES[c] || c;
    });
    alerta =
      '<div class="cart-motor-alerta"><i class="ph ph-info"></i> ' +
      '<span><strong>' +
      nomes.join(' e ') +
      ':</strong> nenhum ativo passou pelo ranking de mercado, então a classe está a usar a ' +
      'carteira do consultor como reserva. Isso acontece enquanto a ingestão de dados da CVM ' +
      'não tiver rodado — assim que rodar, os candidatos passam a sair do mercado inteiro.</span></div>';
  } else if (pontuados < ranking.length) {
    alerta =
      '<div class="cart-motor-alerta"><i class="ph ph-info"></i> ' +
      '<span>' +
      (ranking.length - pontuados) +
      ' ativo(s) sem indicadores suficientes ficaram fora do ranking e não recebem aporte enquanto ' +
      'o dado não chegar. Os cards no fim da lista dizem o que falta em cada um.</span></div>';
  }

  el.innerHTML =
    '<div class="cart-motor-status-linha">' +
    partes.join('') +
    '<button type="button" class="cart-btn-mini" onclick="cartAtualizarMotor()">' +
    '<i class="ph ph-arrows-clockwise"></i> Atualizar dados</button></div>' +
    cartRenderizarIndicadores() +
    alertaPendencia +
    alerta;
}

/**
 * Faixa com Selic, CDI e inflação esperada, cada um com a sua fonte.
 *
 * São os números que sustentam toda a renda fixa da tela. Enquanto eram
 * constantes no código, ninguém — nem nós — sabia olhando a tela se estavam
 * certos. Agora ou dizem de onde vieram, ou dizem que são premissa de
 * reserva.
 */
function cartRenderizarIndicadores() {
  var ind = cartMotor.indicadores;
  if (!ind) return '';
  var itens = [
    { chave: 'selic', rotulo: 'Selic' },
    { chave: 'cdi', rotulo: 'CDI' },
    { chave: 'ipcaEsperado', rotulo: 'IPCA esperado' },
    { chave: 'ipca12m', rotulo: 'IPCA 12m' },
  ];
  var html = itens
    .filter(function (i) {
      // IPCA passado só aparece se a expectativa não veio: são respostas a
      // perguntas diferentes e mostrar as duas confunde mais do que informa.
      if (i.chave === 'ipca12m' && ind.ipcaEsperado) return false;
      return ind[i.chave] && typeof ind[i.chave].valor === 'number';
    })
    .map(function (i) {
      var d = ind[i.chave];
      return (
        '<span class="cart-indicador" title="' +
        (d.fonte || '').replace(/"/g, '&quot;') +
        (d.data ? ' · ' + cartFmtData(d.data) : '') +
        '">' +
        '<span class="cart-indicador-rotulo">' +
        i.rotulo +
        '</span>' +
        '<span class="cart-indicador-valor">' +
        d.valor.toFixed(2).replace('.', ',') +
        '%</span>' +
        '</span>'
      );
    })
    .join('');
  if (!html) return '';
  return (
    '<div class="cart-indicadores">' +
    html +
    '<span class="cart-indicadores-fonte">' +
    (cartMotor.premissasDegradadas
      ? '<i class="ph ph-warning"></i> parte destes valores é premissa de reserva, não taxa do dia'
      : '<i class="ph ph-seal-check"></i> Banco Central') +
    '</span></div>'
  );
}

/**
 * Faixa de diversificação setorial da classe.
 *
 * É a metade visível da política: sem ela, uma seleção diversificada e uma
 * seleção por score puro desenham a mesma lista de ativos, e não há como
 * saber pela tela qual das duas rodou. A faixa diz o alvo de cada setor, o
 * que ele levou de facto, e nomeia o setor que ficou de fora — que é a
 * informação mais acionável das três, porque explica por que o dinheiro dele
 * foi parar noutro lugar.
 */
function cartRenderizarSetoresClasse(c) {
  if (!c || c.selecao !== 'setor' || !(c.setores || []).length) return '';
  var chips = c.setores
    .map(function (s) {
      // Quais ativos caíram neste bloco. É o que liga a faixa à lista abaixo:
      // sem os tickers, ler 'Consumo/Commodities 20%' e ver 'Vale · Mineração
      // e Siderurgia' na linha seguinte não fecha — e a Vale está mesmo no
      // bloco de commodities.
      var dentro = (c.itens || [])
        .filter(function (it) {
          return it.setorChave === s.chave;
        })
        .map(function (it) {
          return it.ticker;
        });
      // Alvo e aplicado divergem quando o teto por ativo morde. Dizer só o
      // aplicado faria a política parecer ignorada; dizer só o alvo esconderia
      // que ela cedeu.
      var cedeu = s.alvoPct != null && Math.abs(s.alvoPct - s.peso) > 0.01;
      return (
        '<span class="cart-setor-chip' +
        (cedeu ? ' cedeu' : '') +
        '" title="' +
        cartEsc(
          s.nome +
            ' — ' +
            (cedeu
              ? 'alvo ' +
                Math.round(s.alvoPct * 100) +
                '% da classe, aplicado ' +
                Math.round(s.peso * 100) +
                '% (teto de concentração por ativo, com ' +
                s.nomes +
                (s.nomes === 1 ? ' nome' : ' nomes') +
                ' no setor)'
              : Math.round(s.peso * 100) + '% da classe') +
            (dentro.length ? ': ' + dentro.join(', ') : '') +
            ' · ' +
            s.candidatos +
            (s.candidatos === 1 ? ' candidato pontuado' : ' candidatos pontuados') +
            ' no setor'
        ) +
        '">' +
        '<span class="cart-setor-nome">' +
        cartEsc(s.nome) +
        '</span>' +
        '<span class="cart-setor-pct">' +
        Math.round(s.peso * 100) +
        '%</span></span>'
      );
    })
    .join('');

  var vazios = (c.setoresVazios || []).filter(function (v) {
    return !v.candidatos;
  });
  var nota = vazios.length
    ? '<div class="cart-setores-nota"><i class="ph ph-info"></i> ' +
      vazios
        .map(function (v) {
          return cartEsc(v.nome);
        })
        .join(', ') +
      (vazios.length === 1 ? ' ficou' : ' ficaram') +
      ' sem candidato pontuado neste ciclo — o alvo foi redistribuído entre os setores acima.' +
      '</div>'
    : '';

  // Ativo sem setor NÃO entra na política — não há bloco onde o colocar. Ele
  // continua no ranking, com nota, e nunca recebe aporte. Sem esta linha isso
  // acontece em silêncio: o utilizador vê o ativo bem pontuado na lista, não o
  // vê no plano, e não há nada na tela que ligue as duas coisas.
  var semSetor = c.semSetor
    ? '<div class="cart-setores-nota"><i class="ph ph-warning"></i> ' +
      c.semSetor +
      (c.semSetor === 1
        ? ' ativo pontuado ficou fora do plano por não ter setor'
        : ' ativos pontuados ficaram fora do plano por não terem setor') +
      ' — a política aloca por setor, e sem ele não há bloco onde os pôr.</div>'
    : '';

  return (
    '<div class="cart-setores">' +
    '<div class="cart-setores-titulo"><i class="ph ph-squares-four"></i> Diversificação por setor</div>' +
    '<div class="cart-setores-lista">' +
    chips +
    '</div>' +
    nota +
    semSetor +
    '</div>'
  );
}

function cartRenderizarMotorPlano(plano) {
  var el = document.getElementById('cartMotorPlano');
  if (!el || !plano) return;

  var colunas = MOTOR_CLASSES.map(function (classe) {
    var c = plano.classes[classe];
    if (!c) return '';
    var pct = c.pct || 0;
    var itens = c.itens || [];
    var aguardando = c.modo === 'aguardando_dados';
    var linhas = aguardando
      ? '<li class="cart-classe-empty">Aguardando indicadores para selecionar os ativos. ' +
        'A recomendação sai dos mais bem pontuados — sem score não há seleção a fazer.</li>'
      : itens.length
        ? itens
            .map(function (it) {
              var qtd =
                it.quantidade != null && it.unidade
                  ? '<span class="cart-plano-qtd">' +
                    (it.classe === 'cripto' ? it.quantidade : it.quantidade + ' ' + it.unidade) +
                    '</span>'
                  : '';
              var chip =
                it.score === null
                  ? '<span class="cart-plano-score sem-dado" title="Sem indicadores para pontuar">—</span>'
                  : '<span class="cart-plano-score" style="background:' +
                    cartCorScore(it.score) +
                    ';">' +
                    it.score +
                    '</span>';
              var rot = cartRotuloAtivo(it);
              // Nome longo do Tesouro entrava aqui inteiro, em monoespaçada e
              // sem corte — era ele que esticava a coluna e empurrava a
              // página para o lado no telemóvel.
              // Mesma régua da lista: o que aparece é o setor A QUE O ATIVO
              // PERTENCE. O bloco da política (`it.setorNome`) fica no title e
              // na faixa acima — ele explica a alocação, não identifica o ativo.
              var linhaIt = cartLinhaSetor(it);
              var segunda = linhaIt.texto;
              var tituloIt =
                segunda +
                (it.setorNome && it.setorNome !== linhaIt.rotulo
                  ? ' — bloco ' + it.setorNome + ' da política'
                  : '');
              return (
                '<li class="cart-plano-item">' +
                chip +
                '<span class="cart-plano-body">' +
                '<span class="cart-plano-ticker">' +
                cartEsc(rot.codigo) +
                '</span>' +
                '<span class="cart-plano-nome" title="' +
                cartEsc(tituloIt) +
                '">' +
                cartEsc(segunda) +
                '</span>' +
                '</span>' +
                '<span class="cart-plano-right">' +
                '<span class="cart-plano-vlr">' +
                formatarMoeda(it.valorInvestido) +
                '</span>' +
                qtd +
                '</span>' +
                '</li>'
              );
            })
            .join('')
        : '<li class="cart-classe-empty">Sem alocação nesta classe</li>';

    return (
      '<div class="cart-classe-col cart-classe-' +
      classe +
      (pct === 0 ? ' dimmed' : '') +
      '">' +
      '<div class="cart-classe-col-header">' +
      '<div class="cart-classe-col-name"><i class="ph ' +
      CART_ICONS[classe] +
      '"></i> ' +
      CART_NOMES[classe] +
      '</div>' +
      '<div class="cart-classe-col-meta">' +
      '<span class="cart-classe-col-pct">' +
      pct +
      '%</span>' +
      '<span class="cart-classe-col-vlr">' +
      formatarMoeda(c.alvo) +
      '</span>' +
      '</div></div>' +
      cartRenderizarSetoresClasse(c) +
      '<ul class="cart-classe-list">' +
      linhas +
      '</ul>' +
      '<div class="cart-classe-col-footer">' +
      '<span class="lbl">' +
      (aguardando ? 'Retido:' : c.sobra > 0.009 ? 'Sobra de caixa:' : 'Total alocado:') +
      '</span>' +
      '<span class="val">' +
      formatarMoeda(aguardando ? c.retido : c.sobra > 0.009 ? c.sobra : c.investido) +
      '</span></div>' +
      '</div>'
    );
  }).join('');

  var avisos = (plano.avisos || []).length
    ? '<div class="cart-motor-avisos">' +
      plano.avisos
        .map(function (a) {
          return '<div><i class="ph ph-info"></i> ' + a + '</div>';
        })
        .join('') +
      '</div>'
    : '';

  el.innerHTML =
    '<div class="cart-plano-resumo">' +
    '<div><span class="lbl">Aporte do mês</span><span class="val">' +
    formatarMoeda(plano.aporte) +
    '</span></div>' +
    '<div><span class="lbl">Distribuído</span><span class="val">' +
    formatarMoeda(plano.totalInvestido) +
    '</span></div>' +
    '<div><span class="lbl">' +
    (plano.retido > 0.009 ? 'Retido por falta de dados' : 'Sobra para o próximo aporte') +
    '</span><span class="val">' +
    formatarMoeda(plano.retido > 0.009 ? plano.retido : plano.sobra) +
    '</span></div>' +
    '</div>' +
    '<div class="cart-selecao-grid">' +
    colunas +
    '</div>' +
    avisos;
}

// ════════════════════════════════════════════════════════════
// LISTA DE ATIVOS — nome curto, separação por classe e busca
// ════════════════════════════════════════════════════════════
//
// O problema que esta secção resolve não é de estilo, é de leitura. A lista
// era um bloco único de quarenta e tal cards abertos: no telemóvel dava mais
// de dez mil pixels de rolagem, e o utilizador tinha de percorrer FIIs e
// cripto para chegar às ações. Ver tudo continua a ser possível — deixou é de
// ser obrigatório para ver qualquer coisa.
//
// Três decisões, nesta ordem de importância:
//   1. Um nível de cada vez (classe ativa), porque comparar ativos só faz
//      sentido dentro da classe — não se escolhe entre um FII e um título do
//      Tesouro pela mesma régua, e o motor nem os pontua pela mesma tabela.
//   2. Card fechado por omissão, com o cabeçalho e os cinco pilares à vista.
//      O que fica escondido é o texto (justificativa, lacunas, procedência),
//      que é o que faz o card ter 300px — e é também o que só se lê depois de
//      o ativo interessar.
//   3. Página de 8 com "ver mais" em vez de rolagem infinita: o utilizador
//      sabe quanto falta e o fim da lista existe.

/** Quantos ativos a classe mostra antes do "ver mais". */
var CART_RANK_PAGINA = 8;

// Estado da lista. Vive fora do render porque sobrevive a ele: trocar de
// lente redesenha os cards e não pode perder a classe aberta nem a busca.
var cartRank = { classe: null, busca: '', limite: {} };

function cartEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Tipo do título do Tesouro -> etiqueta curta. O nome publicado é a frase
// inteira ("Tesouro IPCA+ com Juros Semestrais 2055"); o que identifica o
// papel são três coisas: indexador, ano e se paga cupom.
var CART_RF_TIPOS = [
  { re: /renda\s*\+/i, curto: 'Renda+' },
  { re: /educa\s*\+/i, curto: 'Educa+' },
  { re: /ipca/i, curto: 'IPCA+' },
  { re: /selic/i, curto: 'Selic' },
  { re: /prefixado/i, curto: 'Prefixado' },
  { re: /igpm|igp-m/i, curto: 'IGP-M' },
];

/**
 * Rótulo de um ativo: o código curto que identifica, e o nome completo.
 *
 * Existe por causa da renda fixa. O "ticker" de um título do Tesouro é o nome
 * inteiro maiúsculo com underscores — TESOURO_IPCA_COM_JUROS_SEMESTRAIS_2055,
 * 44 caracteres em fonte monoespaçada dentro de um card de 310px. Não havia
 * corte nenhum aplicado a ele: o card esticava, a grelha empurrava a página e
 * o telemóvel ganhava rolagem horizontal — que era o sintoma relatado.
 *
 * O nome completo NÃO desaparece: fica na segunda linha, cortada com
 * reticências, e no `title` do elemento. Encurtar o código e esconder o resto
 * seria trocar um defeito por outro.
 */
function cartRotuloAtivo(a) {
  var ticker = String((a && a.ticker) || '');
  var nome = String((a && a.nome) || ticker || '');
  if (!a || a.classe !== 'rf') {
    return { codigo: ticker || nome, nome: nome, cupom: false };
  }
  var base = nome || ticker.replace(/_/g, ' ');
  var curto = '';
  for (var i = 0; i < CART_RF_TIPOS.length; i++) {
    if (CART_RF_TIPOS[i].re.test(base)) {
      curto = CART_RF_TIPOS[i].curto;
      break;
    }
  }
  var ano = (base.match(/(20\d\d)/) || [])[1] || '';
  var cupom = /juros\s*semestrais|renda\s*\+|educa\s*\+/i.test(base);
  // Sem indexador reconhecido o código curto seria uma invenção: fica o nome
  // como está, e quem corta é o CSS.
  if (!curto) return { codigo: nome || ticker, nome: nome, cupom: cupom };
  return { codigo: (curto + (ano ? ' ' + ano : '')).trim(), nome: nome, cupom: cupom };
}

/**
 * Identidade setorial de um ativo, nas duas réguas que a tela usa.
 *
 * `nome` é o SETOR A QUE O ATIVO PERTENCE — 'Mineração e Siderurgia' para a
 * Vale, 'Logística' para o BTLG11. É o que identifica o ativo, e é o que a
 * lista mostra ao lado do nome.
 *
 * `bucket` é o BLOCO DA POLÍTICA que vai decidir quanto ele recebe. Nos FIIs
 * os dois coincidem, porque a política é feita sobre os segmentos do fundo.
 * Nas ações NÃO coincidem, e era daí que vinha o rótulo errado: a Vale
 * aparecia como 'Consumo/Commodities' — que é onde ela entra na alocação, não
 * o que ela é. O bloco continua visível, mas na faixa de diversificação do
 * plano, que é onde ele explica alguma coisa.
 *
 * Setor ausente devolve `nome: null`, e quem desenha diz que não foi
 * informado. Preencher com o nome da classe faria 'Ações' parecer um setor.
 */
function cartSetorDoAtivo(a) {
  if (!a) return null;
  var buckets =
    typeof MOTOR_SETORES_ALVO !== 'undefined' ? MOTOR_SETORES_ALVO[a.classe] || null : null;
  var bucket = null;
  if (buckets && typeof motorBucketSetor === 'function') {
    var chaveBucket = motorBucketSetor(a, buckets);
    for (var i = 0; chaveBucket && i < buckets.length; i++) {
      if (buckets[i].chave === chaveBucket) bucket = buckets[i].nome;
    }
  }

  if (a.classe === 'fii') {
    var seg =
      a.segmentoFii || (typeof motorSegmentoFii === 'function' ? motorSegmentoFii(a) : null);
    return { chave: seg, nome: (seg && MOTOR_FII_SEGMENTO_NOMES[seg]) || bucket, bucket: bucket };
  }

  var canon = a.setorCanon || motorNormalizarSetor(a.setor);
  if (!canon) return { chave: null, nome: null, bucket: bucket };
  // 'outros' é setor que EXISTE e não está no mapa. Aí o rótulo do provedor
  // informa mais do que um genérico nosso — 'Aeroespacial' vale mais que
  // 'Outros setores'.
  var nome = canon === 'outros' ? a.setor : MOTOR_SETOR_NOMES[canon] || a.setor;
  return { chave: canon, nome: nome || null, bucket: bucket };
}

/**
 * Segunda linha do ativo: nome da empresa e o setor a que ela pertence.
 *
 * Renda fixa e cripto não têm setor — e nem faz sentido terem: um título do
 * Tesouro não pertence a um ramo da economia. Nessas duas a linha fica com o
 * nome da classe, que é a informação disponível.
 */
function cartLinhaSetor(a) {
  var setor = cartSetorDoAtivo(a);
  var rotulo;
  if (setor && setor.nome) rotulo = setor.nome;
  else if (a.classe === 'acao' || a.classe === 'fii') rotulo = 'setor não informado';
  else rotulo = CART_NOMES[a.classe];
  return {
    texto: [a.nome || '', rotulo]
      .filter(function (v) {
        return v;
      })
      .join(' · '),
    setor: setor,
    rotulo: rotulo,
  };
}

/** Um card do ranking. `posicao` é a colocação DENTRO da classe. */
function cartCardAtivo(a, posicao) {
  var rotulo = cartRotuloAtivo(a);
  var linha = cartLinhaSetor(a);
  var setor = linha.setor;

  var barras = MOTOR_PILARES.map(function (chave) {
    var p = a.pilares[chave];
    var nota = p && p.nota;
    var altura = nota != null ? Math.max(4, (nota / 10) * 100) : 0;

    // Pilar calculado sobre menos de metade dos seus indicadores desenha
    // uma barra cheia igual à de um pilar completo. Um 10,0 de Qualidade
    // apoiado só na liquidez diária, com ROE, ROIC e margem ausentes,
    // lê-se como veredito — o mesmo erro que já corrigimos no score
    // global, repetido dentro do pilar.
    var comDado = p
      ? p.metricas.filter(function (m) {
          return m.nota !== null;
        }).length
      : 0;
    var total = p ? p.metricas.length : 0;
    var parcial = nota != null && total > 0 && comDado / total < 0.5;

    var titulo =
      p.nome +
      ': ' +
      cartFmtNota(nota) +
      '/10' +
      (total ? ' · ' + comDado + ' de ' + total + ' indicadores' : '');

    return (
      '<div class="cart-pilar" title="' +
      titulo +
      '">' +
      '<div class="cart-pilar-trilho"><div class="cart-pilar-barra' +
      (nota == null ? ' vazio' : parcial ? ' parcial' : '') +
      '" style="height:' +
      altura +
      '%;background:' +
      (nota == null ? 'var(--cor-borda2)' : cartCorScore(nota * 10)) +
      ';"></div></div>' +
      '<div class="cart-pilar-nota' +
      (parcial ? ' parcial' : '') +
      '">' +
      cartFmtNota(nota) +
      (parcial ? '<span class="cart-pilar-fracao">' + comDado + '/' + total + '</span>' : '') +
      '</div>' +
      '<div class="cart-pilar-nome">' +
      '<span class="cart-pilar-longo">' +
      p.nome +
      '</span><span class="cart-pilar-curto">' +
      (MOTOR_PILAR_NOMES_CURTOS[chave] || p.nome) +
      '</span></div>' +
      '</div>'
    );
  }).join('');

  var alertas = (a.alertas || []).length
    ? '<ul class="cart-score-alertas">' +
      a.alertas
        .map(function (t) {
          return '<li><i class="ph ph-warning"></i> ' + t + '</li>';
        })
        .join('') +
      '</ul>'
    : '';

  // Sem lastro o selo NÃO é um número: é a ausência dele. Pintar "25" de
  // cinzento continuaria a ser lido como nota. O card passa a mostrar o
  // que falta, que é a única informação verdadeira que temos do ativo.
  var selo =
    a.score === null
      ? '<span class="cart-score-badge sem-dado" title="Indicadores insuficientes">' +
        '<i class="ph ph-minus-circle"></i></span>'
      : '<span class="cart-score-badge" style="background:' +
        cartCorScore(a.score) +
        ';">' +
        a.score +
        '<small>/100</small></span>';

  // Fonte que não respondeu tem conserto diferente de fonte que
  // respondeu incompleta. Dizer "faltam indicadores" nos dois casos
  // manda o utilizador (e quem for depurar) na direção errada.
  var indisponivel = a.indisponivel
    ? '<div class="cart-score-faltando">' +
      '<div class="cart-score-faltando-titulo">' +
      '<i class="ph ph-plugs"></i> Nenhuma fonte de mercado respondeu' +
      '</div>' +
      '<div class="cart-score-faltando-linha">' +
      (a.motivoIndisponivel || 'Sem detalhe da fonte.') +
      '</div></div>'
    : '';

  // Mostra o que faltou MESMO quando o ativo pontua. Antes só aparecia
  // com score nulo, e o resultado era a pergunta que ninguém conseguia
  // responder pela tela: "por que este FII não tem Crescimento e aquele
  // tem?". O ativo pontuado é justamente o caso em que a lacuna passa
  // despercebida — o número parece completo.
  //
  // O título muda conforme o papel da lacuna: com score nulo ela é o
  // motivo de não haver nota; com score, é a ressalva de leitura.
  var faltando =
    !a.indisponivel && (a.faltando || []).length
      ? '<div class="cart-score-faltando' +
        (a.score === null ? '' : ' informativo') +
        '">' +
        '<div class="cart-score-faltando-titulo">' +
        (a.score === null
          ? '<i class="ph ph-database"></i> Faltam indicadores para pontuar'
          : '<i class="ph ph-info"></i> Indicadores sem dado (não derrubam a nota, reduzem a cobertura)') +
        '</div>' +
        a.faltando
          .map(function (f) {
            return (
              '<div class="cart-score-faltando-linha"><strong>' +
              f.pilar +
              ':</strong> ' +
              f.metricas.join(', ') +
              '</div>'
            );
          })
          .join('') +
        '</div>'
      : '';

  // Chave de busca: código, nome e setor já sem acento nem pontuação, para o
  // filtro comparar substring sem repetir a normalização a cada tecla.
  // Busca pelas TRÊS formas de nomear o setor: o rótulo da tela, o bloco da
  // política e o texto cru do provedor. Quem digita 'consumo' procura o bloco;
  // quem digita 'mineração' procura o setor; quem digita 'basic materials'
  // está a repetir o que viu noutro lugar. Os três têm de achar a Vale.
  var chaveBusca = cartNormalizarNome(
    [
      a.ticker,
      rotulo.codigo,
      a.nome,
      linha.rotulo,
      setor && setor.bucket ? setor.bucket : '',
      a.setor || '',
    ].join(' ')
  );

  var linhaNome = linha.texto;
  // O bloco da política fica no title: na lista ele não identifica o ativo, e
  // no plano ele já tem faixa própria.
  var tituloNome =
    linhaNome +
    (setor && setor.bucket && setor.bucket !== linha.rotulo
      ? ' — no plano entra no bloco ' + setor.bucket
      : '');

  return (
    '<article class="cart-score-card' +
    (a.score === null ? ' sem-dado' : '') +
    '" data-classe="' +
    a.classe +
    '" data-busca="' +
    cartEsc(chaveBusca) +
    '">' +
    '<button type="button" class="cart-score-head" aria-expanded="false" ' +
    'onclick="cartAlternarCard(this)">' +
    '<span class="cart-score-pos">' +
    (posicao == null ? '—' : '#' + posicao) +
    '</span>' +
    '<span class="cart-score-id">' +
    '<span class="cart-score-ticker">' +
    cartEsc(rotulo.codigo) +
    (rotulo.cupom ? '<span class="cart-score-tag">juros semestrais</span>' : '') +
    '</span>' +
    '<span class="cart-score-nome" title="' +
    cartEsc(tituloNome) +
    '">' +
    cartEsc(linhaNome) +
    '</span>' +
    '</span>' +
    selo +
    '<i class="ph ph-caret-down cart-score-caret" aria-hidden="true"></i>' +
    '</button>' +
    '<div class="cart-pilares">' +
    barras +
    '</div>' +
    '<div class="cart-score-detalhe">' +
    '<div class="cart-score-just">' +
    motorJustificativa(a) +
    ' <span class="cart-score-conf conf-' +
    a.confianca +
    '">' +
    (a.confianca === 'insuficiente' ? 'dados insuficientes' : 'confiança ' + a.confianca) +
    '</span></div>' +
    indisponivel +
    faltando +
    cartProcedencia(a) +
    alertas +
    '</div>' +
    '</article>'
  );
}

function cartRenderizarMotorRanking(ranking) {
  var el = document.getElementById('cartMotorRanking');
  if (!el) return;
  if (!ranking || !ranking.length) {
    el.innerHTML =
      '<div class="cart-classe-empty">Nenhum ativo no universo da carteira modelo.</div>';
    return;
  }

  var porClasse = {};
  MOTOR_CLASSES.forEach(function (c) {
    porClasse[c] = [];
  });
  ranking.forEach(function (a) {
    (porClasse[a.classe] || (porClasse[a.classe] = [])).push(a);
  });

  var comAtivos = Object.keys(porClasse).filter(function (c) {
    return porClasse[c].length;
  });
  // Classe gravada que deixou de existir no universo não pode deixar a tela
  // vazia com a lista cheia por baixo.
  if (comAtivos.indexOf(cartRank.classe) === -1) cartRank.classe = comAtivos[0] || null;

  var tabs = comAtivos
    .map(function (classe) {
      var pontuados = porClasse[classe].filter(function (a) {
        return a.score !== null;
      }).length;
      return (
        '<button type="button" role="tab" class="cart-rank-tab cart-rank-tab-' +
        classe +
        (classe === cartRank.classe ? ' active' : '') +
        '" data-classe="' +
        classe +
        '" aria-selected="' +
        (classe === cartRank.classe ? 'true' : 'false') +
        '" title="' +
        pontuados +
        ' de ' +
        porClasse[classe].length +
        ' pontuados" onclick="cartTrocarClasseRanking(\'' +
        classe +
        '\')">' +
        '<i class="ph ' +
        CART_ICONS[classe] +
        '"></i><span>' +
        (CART_NOMES[classe] || classe) +
        '</span>' +
        '<span class="cart-rank-tab-n">' +
        porClasse[classe].length +
        '</span></button>'
      );
    })
    .join('');

  var grupos = comAtivos
    .map(function (classe) {
      var lista = porClasse[classe];
      var pos = 0;
      var cards = lista
        .map(function (a) {
          // Ativo sem score não ocupa colocação: entra na lista, fora do
          // ranking. Numerá-lo diria que ele perdeu para os de cima, quando
          // na verdade ele nem foi medido.
          return cartCardAtivo(a, a.score === null ? null : ++pos);
        })
        .join('');
      return (
        '<section class="cart-rank-grupo" data-classe="' +
        classe +
        '">' +
        '<div class="cart-rank-grupo-head"><i class="ph ' +
        CART_ICONS[classe] +
        '"></i> ' +
        (CART_NOMES[classe] || classe) +
        '</div>' +
        '<div class="cart-rank-cards">' +
        cards +
        '</div>' +
        '<button type="button" class="cart-rank-mais" data-classe="' +
        classe +
        '" onclick="cartVerMaisRanking(\'' +
        classe +
        '\')" hidden></button>' +
        '</section>'
      );
    })
    .join('');

  el.innerHTML =
    '<div class="cart-rank-toolbar">' +
    '<div class="cart-rank-busca">' +
    '<i class="ph ph-magnifying-glass"></i>' +
    '<input type="search" id="cartRankBusca" class="cart-rank-input" autocomplete="off" ' +
    'placeholder="Buscar por código, nome ou setor" aria-label="Buscar ativo" value="' +
    cartEsc(cartRank.busca) +
    '" oninput="cartFiltrarRanking()">' +
    '<button type="button" class="cart-rank-limpar" id="cartRankLimpar" ' +
    'aria-label="Limpar busca" onclick="cartLimparBuscaRanking()"' +
    (cartRank.busca ? '' : ' hidden') +
    '><i class="ph ph-x"></i></button>' +
    '</div>' +
    '<div class="cart-rank-tabs" role="tablist">' +
    tabs +
    '</div>' +
    '</div>' +
    '<div class="cart-rank-status" id="cartRankStatus"></div>' +
    grupos;

  cartAplicarFiltroRanking();
}

/**
 * Aplica classe ativa, busca e paginação sobre os cards JÁ desenhados.
 *
 * Filtra por atributo em vez de redesenhar: redesenhar a cada tecla tira o
 * foco do campo de busca no telemóvel — o teclado fecha e a pessoa perde o
 * que estava a escrever. Todos os cards ficam no DOM; o que muda é quem está
 * visível.
 */
function cartAplicarFiltroRanking() {
  var wrap = document.getElementById('cartMotorRanking');
  if (!wrap || typeof wrap.querySelectorAll !== 'function') return;
  var termo = cartNormalizarNome(cartRank.busca);
  var buscando = termo.length > 0;
  // A busca atravessa as classes: quem procura 'BBAS' não devia ter de
  // adivinhar em que aba o ativo está. Com o resultado espalhado por várias
  // classes, o cabeçalho de cada grupo passa a ser necessário — daí a classe
  // no contentor, que é quem o liga no CSS.
  if (wrap.classList && wrap.classList.toggle) wrap.classList.toggle('buscando', buscando);
  var grupos = wrap.querySelectorAll('.cart-rank-grupo');
  var achados = 0;
  var totalClasses = 0;

  // Classe ativa que não existe entre os grupos deixaria a lista inteira
  // escondida com os cards todos no DOM — o pior estado possível, porque
  // parece "sem ativos" e não é. Cai para o primeiro grupo.
  var classes = Array.prototype.map.call(grupos, function (g) {
    return g.getAttribute('data-classe');
  });
  if (classes.length && classes.indexOf(cartRank.classe) === -1) cartRank.classe = classes[0];

  Array.prototype.forEach.call(grupos, function (grupo) {
    var classe = grupo.getAttribute('data-classe');
    var cards = grupo.querySelectorAll('.cart-score-card');
    var casaram = [];
    Array.prototype.forEach.call(cards, function (card) {
      var chave = card.getAttribute('data-busca') || '';
      if (!buscando || chave.indexOf(termo) !== -1) casaram.push(card);
      else card.hidden = true;
    });

    // Durante a busca não há paginação: quem procurou um ativo pelo nome quer
    // vê-lo, não descobrir que ele estava atrás de um "ver mais".
    var limite = buscando ? casaram.length : cartRank.limite[classe] || CART_RANK_PAGINA;
    casaram.forEach(function (card, i) {
      card.hidden = i >= limite;
    });

    var visivel = buscando ? casaram.length > 0 : classe === cartRank.classe;
    grupo.hidden = !visivel;
    if (visivel) totalClasses++;
    achados += casaram.length;

    var mais = grupo.querySelector('.cart-rank-mais');
    if (mais) {
      var restam = casaram.length - limite;
      mais.hidden = buscando || restam <= 0;
      if (!mais.hidden)
        mais.innerHTML =
          '<i class="ph ph-caret-down"></i> Ver mais ' +
          Math.min(restam, CART_RANK_PAGINA) +
          ' de ' +
          restam;
    }
  });

  var limpar = document.getElementById('cartRankLimpar');
  if (limpar) limpar.hidden = !buscando;

  var status = document.getElementById('cartRankStatus');
  if (!status) return;
  if (buscando) {
    status.innerHTML = achados
      ? '<i class="ph ph-magnifying-glass"></i> ' +
        achados +
        (achados === 1 ? ' ativo encontrado' : ' ativos encontrados') +
        ' em ' +
        totalClasses +
        (totalClasses === 1 ? ' classe' : ' classes') +
        ' · <button type="button" class="cart-rank-link" onclick="cartLimparBuscaRanking()">limpar busca</button>'
      : '<i class="ph ph-magnifying-glass"></i> Nenhum ativo com <strong>' +
        cartEsc(cartRank.busca) +
        '</strong> no código, no nome ou no setor. ' +
        '<button type="button" class="cart-rank-link" onclick="cartLimparBuscaRanking()">limpar busca</button>';
  } else {
    status.innerHTML = '';
  }
}

function cartTrocarClasseRanking(classe) {
  cartRank.classe = classe;
  var wrap = document.getElementById('cartMotorRanking');
  if (wrap && typeof wrap.querySelectorAll === 'function') {
    Array.prototype.forEach.call(wrap.querySelectorAll('.cart-rank-tab'), function (b) {
      var ativa = b.getAttribute('data-classe') === classe;
      b.classList.toggle('active', ativa);
      b.setAttribute('aria-selected', ativa ? 'true' : 'false');
    });
  }
  cartAplicarFiltroRanking();
}

function cartVerMaisRanking(classe) {
  cartRank.limite[classe] = (cartRank.limite[classe] || CART_RANK_PAGINA) + CART_RANK_PAGINA;
  cartAplicarFiltroRanking();
}

function cartFiltrarRanking() {
  var input = document.getElementById('cartRankBusca');
  cartRank.busca = input && input.value != null ? String(input.value) : '';
  cartAplicarFiltroRanking();
}

function cartLimparBuscaRanking() {
  cartRank.busca = '';
  var input = document.getElementById('cartRankBusca');
  if (input) {
    input.value = '';
    if (typeof input.focus === 'function') input.focus();
  }
  cartAplicarFiltroRanking();
}

/** Abre/fecha o detalhe de um card. */
function cartAlternarCard(botao) {
  if (!botao || typeof botao.closest !== 'function') return;
  var card = botao.closest('.cart-score-card');
  if (!card) return;
  var aberto = card.classList.toggle('aberto');
  botao.setAttribute('aria-expanded', aberto ? 'true' : 'false');
}

// ── Painel de personalização ──

/** Uma linha de peso: nome, controle e percentagem. */
function cartCustomLinha(grupo, chave, nome, valor, icone) {
  return (
    '<label class="cart-custom-linha">' +
    '<span class="cart-custom-linha-nome">' +
    (icone ? '<i class="ph ' + icone + '"></i>' : '') +
    cartEsc(nome) +
    '</span>' +
    '<input type="range" min="0" max="100" step="1" value="' +
    Math.round(valor) +
    '" class="cart-custom-range" data-grupo="' +
    grupo +
    '" data-chave="' +
    chave +
    '" oninput="cartCustomMudou(this)" aria-label="' +
    cartEsc(nome) +
    '">' +
    '<output class="cart-custom-linha-pct">' +
    Math.round(valor) +
    '%</output>' +
    '</label>'
  );
}

/** Lista de ativos de uma classe, com marcação. */
function cartCustomAtivosClasse(classe, ranking) {
  var lista = (ranking || []).filter(function (a) {
    return a.classe === classe;
  });
  if (!lista.length) return '';
  var escolha = cartCustom().ativos && cartCustom().ativos[classe];
  var itens = lista
    .map(function (a) {
      // Sem escolha gravada, tudo entra — é o estado "a recomendação decide".
      var marcado = !escolha || !escolha.length || escolha.indexOf(a.ticker) !== -1;
      var rot = cartRotuloAtivo(a);
      return (
        '<label class="cart-custom-ativo' +
        (marcado ? '' : ' fora') +
        '">' +
        '<input type="checkbox" data-grupo="ativo" data-classe="' +
        classe +
        '" value="' +
        cartEsc(a.ticker) +
        '"' +
        (marcado ? ' checked' : '') +
        ' onchange="cartCustomMudouAtivo(this)">' +
        '<span class="cart-custom-ativo-cod">' +
        cartEsc(rot.codigo) +
        '</span>' +
        '<span class="cart-custom-ativo-score">' +
        (a.score == null ? '—' : a.score) +
        '</span>' +
        '</label>'
      );
    })
    .join('');

  return (
    '<div class="cart-custom-ativos-grupo" data-classe="' +
    classe +
    '">' +
    '<div class="cart-custom-ativos-head">' +
    '<span><i class="ph ' +
    CART_ICONS[classe] +
    '"></i> ' +
    (CART_NOMES[classe] || classe) +
    '</span>' +
    '<span class="cart-custom-conta" data-classe="' +
    classe +
    '"></span>' +
    '<button type="button" class="cart-custom-todos" onclick="cartCustomTodos(\'' +
    classe +
    '\')">todos</button>' +
    '<button type="button" class="cart-custom-todos" onclick="cartCustomNenhum(\'' +
    classe +
    '\')">nenhum</button>' +
    '</div>' +
    '<div class="cart-custom-ativos-lista">' +
    itens +
    '</div></div>'
  );
}

/**
 * Desenha o painel inteiro a partir do estado atual.
 *
 * Os valores de partida são SEMPRE os da recomendação quando o utilizador
 * ainda não mexeu. Abrir com tudo em zero obrigaria a montar do nada; abrir
 * com a nossa proposta transforma o painel num ajuste em cima de algo que já
 * faz sentido — que é a diferença entre uma ferramenta e um formulário.
 */
function cartRenderizarCustom() {
  var el = document.getElementById('cartCustomWrap');
  if (!el) return;
  var ranking = cartMotor.ranking || [];
  var c = cartCustom();
  var alocRecomendada = (function () {
    var antes = c.ativo;
    c.ativo = false;
    var a = cartAlocacaoAlvo();
    c.ativo = antes;
    return a;
  })();
  var aloc = c.alloc || alocRecomendada;

  var linhasClasse = MOTOR_CLASSES.map(function (classe) {
    return cartCustomLinha(
      'classe',
      classe,
      CART_NOMES[classe] || classe,
      Number(aloc[classe]) || 0,
      CART_ICONS[classe]
    );
  }).join('');

  var blocosSetor = ['acao', 'fii']
    .map(function (classe) {
      var buckets = (typeof MOTOR_SETORES_ALVO !== 'undefined' && MOTOR_SETORES_ALVO[classe]) || [];
      if (!buckets.length) return '';
      var somaBase = buckets.reduce(function (s, b) {
        return s + b.alvo;
      }, 0);
      var pesos = (c.setores && c.setores[classe]) || null;
      var linhas = buckets
        .map(function (b) {
          // Sem escolha, o valor de partida é o alvo da política já
          // normalizado para a classe — o mesmo número que a faixa do plano
          // mostra, para o painel e o resultado não discordarem.
          var v = pesos ? Number(pesos[b.chave]) || 0 : (b.alvo / somaBase) * 100;
          return cartCustomLinha('setor:' + classe, b.chave, b.nome, v, null);
        })
        .join('');
      return (
        '<div class="cart-custom-setor-bloco">' +
        '<div class="cart-custom-setor-titulo"><i class="ph ' +
        CART_ICONS[classe] +
        '"></i> ' +
        (CART_NOMES[classe] || classe) +
        '<span class="cart-custom-total" data-grupo="setor:' +
        classe +
        '"></span></div>' +
        linhas +
        '</div>'
      );
    })
    .join('');

  var blocosAtivos = MOTOR_CLASSES.map(function (classe) {
    return cartCustomAtivosClasse(classe, ranking);
  }).join('');

  var ligado = cartCustomAtivo();

  el.innerHTML =
    '<div class="cart-custom-cta' +
    (ligado ? ' ligado' : '') +
    '">' +
    '<i class="ph ' +
    (ligado ? 'ph-sliders-horizontal' : 'ph-seal-check') +
    '"></i>' +
    '<div class="cart-custom-cta-txt"><strong>' +
    (ligado ? 'Carteira personalizada por você' : 'Esta é a nossa recomendação') +
    '</strong><span>' +
    (ligado
      ? 'A divisão, os setores e os ativos acima seguem o que você definiu. ' +
        'A recomendação continua a um clique de distância.'
      : 'Perfil, objetivo e prazo definiram a divisão entre classes; a política de setores ' +
        'decidiu quanto vai para cada setor; e o score escolheu os ativos dentro de cada um.') +
    '</span></div>' +
    '<button type="button" class="cart-custom-abrir" onclick="cartAbrirCustom()">' +
    '<i class="ph ph-sliders-horizontal"></i> ' +
    (ligado ? 'Ajustar' : 'Montar do meu jeito') +
    '</button>' +
    (ligado
      ? '<button type="button" class="cart-custom-voltar" onclick="cartRestaurarRecomendacao()">' +
        '<i class="ph ph-arrow-counter-clockwise"></i> Voltar à recomendação</button>'
      : '') +
    '</div>' +
    '<div class="cart-custom-painel" id="cartCustomPainel" hidden>' +
    '<div class="cart-custom-head">' +
    '<span><i class="ph ph-sliders-horizontal"></i> Montar do meu jeito</span>' +
    '<button type="button" class="cart-custom-fechar" onclick="cartFecharCustom()" ' +
    'aria-label="Fechar"><i class="ph ph-x"></i></button>' +
    '</div>' +
    '<div class="cart-custom-aviso"><i class="ph ph-info"></i> ' +
    'A partir daqui a decisão é sua: o motor passa a executar a SUA carteira, e continua ' +
    'a pontuar os ativos e a distribuir o aporte — só deixa de escolher a divisão. ' +
    'Deixar um passo como está mantém a recomendação naquele passo.</div>' +
    // Passo 1
    '<section class="cart-custom-passo">' +
    '<div class="cart-custom-passo-head"><span class="cart-custom-n">1</span>' +
    'Divisão entre as classes' +
    '<span class="cart-custom-total" data-grupo="classe"></span></div>' +
    linhasClasse +
    '</section>' +
    // Passo 2
    '<section class="cart-custom-passo">' +
    '<div class="cart-custom-passo-head"><span class="cart-custom-n">2</span>' +
    'Setores dentro de cada classe' +
    '<span class="cart-custom-passo-nota">zerar um setor tira-o da carteira</span></div>' +
    blocosSetor +
    '</section>' +
    // Passo 3
    '<section class="cart-custom-passo">' +
    '<div class="cart-custom-passo-head"><span class="cart-custom-n">3</span>' +
    'Ativos que podem entrar' +
    '<span class="cart-custom-passo-nota">desmarcados continuam na lista, fora do plano</span>' +
    '</div>' +
    blocosAtivos +
    '</section>' +
    '<div class="cart-custom-rodape">' +
    '<button type="button" class="cart-custom-restaurar" onclick="cartRestaurarRecomendacao()">' +
    'Voltar à recomendação</button>' +
    '<button type="button" class="cart-custom-aplicar" onclick="cartAplicarCustom()">' +
    '<i class="ph ph-check"></i> Aplicar minha carteira</button>' +
    '</div></div>';

  cartCustomAtualizarTotais();
}

/** Soma de um grupo de controles, para o rodapé do passo. */
function cartCustomAtualizarTotais() {
  var wrap = document.getElementById('cartCustomWrap');
  if (!wrap || typeof wrap.querySelectorAll !== 'function') return;
  var somas = {};
  Array.prototype.forEach.call(wrap.querySelectorAll('.cart-custom-range'), function (r) {
    var g = r.getAttribute('data-grupo');
    somas[g] = (somas[g] || 0) + (Number(r.value) || 0);
  });
  Array.prototype.forEach.call(wrap.querySelectorAll('.cart-custom-total'), function (t) {
    var g = t.getAttribute('data-grupo');
    var soma = Math.round(somas[g] || 0);
    t.textContent = soma + '%';
    // 100 é o alvo, mas não é obrigação: o "Aplicar" normaliza. A cor diz que
    // ainda não fecha, sem impedir de continuar.
    t.className = 'cart-custom-total' + (soma === 100 ? ' ok' : '');
    t.title =
      soma === 100
        ? 'Fecha em 100%'
        : 'Soma ' + soma + '% — ao aplicar, os pesos são reescalados para 100%';
  });
  Array.prototype.forEach.call(wrap.querySelectorAll('.cart-custom-conta'), function (c) {
    var classe = c.getAttribute('data-classe');
    var caixas = wrap.querySelectorAll('.cart-custom-ativo input[data-classe="' + classe + '"]');
    var marcados = 0;
    Array.prototype.forEach.call(caixas, function (x) {
      if (x.checked) marcados++;
    });
    c.textContent = marcados + ' de ' + caixas.length;
  });
}

function cartCustomMudou(input) {
  if (!input) return;
  var out = input.parentElement && input.parentElement.querySelector('.cart-custom-linha-pct');
  if (out) out.textContent = Math.round(Number(input.value) || 0) + '%';
  cartCustomAtualizarTotais();
}

function cartCustomMudouAtivo(input) {
  if (input && input.parentElement && input.parentElement.classList)
    input.parentElement.classList.toggle('fora', !input.checked);
  cartCustomAtualizarTotais();
}

function cartCustomMarcar(classe, valor) {
  var wrap = document.getElementById('cartCustomWrap');
  if (!wrap || typeof wrap.querySelectorAll !== 'function') return;
  Array.prototype.forEach.call(
    wrap.querySelectorAll('.cart-custom-ativo input[data-classe="' + classe + '"]'),
    function (x) {
      x.checked = valor;
      if (x.parentElement && x.parentElement.classList)
        x.parentElement.classList.toggle('fora', !valor);
    }
  );
  cartCustomAtualizarTotais();
}
function cartCustomTodos(classe) {
  cartCustomMarcar(classe, true);
}
function cartCustomNenhum(classe) {
  cartCustomMarcar(classe, false);
}

function cartAbrirCustom() {
  var p = document.getElementById('cartCustomPainel');
  if (!p) return;
  p.hidden = false;
  if (typeof p.scrollIntoView === 'function')
    p.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cartFecharCustom() {
  var p = document.getElementById('cartCustomPainel');
  if (p) p.hidden = true;
}

/** Lê o painel, normaliza e recalcula o plano. */
function cartAplicarCustom() {
  var wrap = document.getElementById('cartCustomWrap');
  if (!wrap || typeof wrap.querySelectorAll !== 'function') return;

  var brutos = {};
  Array.prototype.forEach.call(wrap.querySelectorAll('.cart-custom-range'), function (r) {
    var g = r.getAttribute('data-grupo');
    (brutos[g] || (brutos[g] = {}))[r.getAttribute('data-chave')] = Number(r.value) || 0;
  });

  var c = cartCustom();
  c.alloc = cartNormalizar100(brutos.classe || {});
  c.setores = {};
  ['acao', 'fii'].forEach(function (classe) {
    var g = brutos['setor:' + classe];
    var n = g ? cartNormalizar100(g) : null;
    if (n) c.setores[classe] = n;
  });
  if (!Object.keys(c.setores).length) c.setores = null;

  c.ativos = {};
  MOTOR_CLASSES.forEach(function (classe) {
    var caixas = wrap.querySelectorAll('.cart-custom-ativo input[data-classe="' + classe + '"]');
    if (!caixas.length) return;
    var marcados = [];
    Array.prototype.forEach.call(caixas, function (x) {
      if (x.checked) marcados.push(x.value);
    });
    // Tudo marcado é o mesmo que não restringir. Gravar a lista inteira
    // congelaria o universo de hoje e faria o ativo novo de amanhã nascer
    // excluído, sem ninguém perceber.
    if (marcados.length && marcados.length < caixas.length) c.ativos[classe] = marcados;
  });
  if (!Object.keys(c.ativos).length) c.ativos = null;

  c.ativo = true;
  cartSalvarEstado();
  cartFecharCustom();
  cartRecalcularMotor();
  // A tela do painel não pode depender de haver dado do motor.
  // `cartRecalcularMotor` desiste cedo enquanto a busca não aconteceu, e sem
  // esta linha o utilizador clicava em Aplicar, o painel fechava, e a barra
  // continuava a dizer "Esta é a nossa recomendação" — que a essa altura já
  // era mentira, e sem nenhum caminho de volta à vista.
  if (!cartMotor.buscadoEm) cartRenderizarCustom();
  if (typeof mostrarToast === 'function') mostrarToast('Carteira personalizada aplicada.');
}

/** Desliga o modo personalizado e apaga as escolhas. */
function cartRestaurarRecomendacao() {
  cartEstado.custom = cartCustomVazio();
  cartSalvarEstado();
  cartFecharCustom();
  cartRecalcularMotor();
  if (!cartMotor.buscadoEm) cartRenderizarCustom();
  if (typeof mostrarToast === 'function') mostrarToast('De volta à carteira recomendada.');
}

// ════════════════════════════════
// CRITÉRIOS DE ANÁLISE E PONTUAÇÃO
// ════════════════════════════════
//
// Lê o MOTOR_CRITERIOS em vez de descrever à mão o que ele faz. Uma lista
// estática divergiria do motor no primeiro ajuste de peso — e a tela passaria
// a explicar um cálculo que o produto já não executa, que é pior do que não
// explicar nada. Se um pilar deixar de existir, esta secção deixa de o
// mostrar sozinha.

var CART_CRITERIOS_CLASSES = [
  { chave: 'acao', nome: 'Ações' },
  { chave: 'fii', nome: 'FIIs de tijolo' },
  { chave: 'fiiPapel', nome: 'FIIs de papel' },
  { chave: 'rf', nome: 'Renda Fixa' },
  { chave: 'cripto', nome: 'Criptos' },
];

function cartRenderizarCriterios() {
  var el = document.getElementById('cartCriterios');
  if (!el || typeof MOTOR_CRITERIOS === 'undefined') return;

  // `cartLenteAtiva()` devolve o ID, não o objeto — resolver aqui, com
  // queda para `equilibrio`, evita depender de um id gravado que já não
  // exista.
  var lente = MOTOR_LENTES[cartLenteAtiva()] || MOTOR_LENTES.equilibrio;

  var grupos = CART_CRITERIOS_CLASSES.map(function (c) {
    var criterios = MOTOR_CRITERIOS[c.chave];
    if (!criterios) return '';

    var total = 0;
    var pilares = MOTOR_PILARES.map(function (pilar) {
      var metricas = criterios[pilar] || [];
      if (!metricas.length) return '';
      total += metricas.length;
      var chips = metricas
        .map(function (m) {
          // O peso vai junto porque é o que distingue "entra na conta" de
          // "decide a conta": P/L com peso 3 e EV/EBITDA com peso 2 não são
          // o mesmo critério, e sem o número a lista sugere que são.
          return (
            '<span class="cart-criterios-metrica">' +
            m.nome +
            '<span class="cart-criterios-peso">peso ' +
            m.peso +
            '</span></span>'
          );
        })
        .join('');
      return (
        '<div class="cart-criterios-pilar">' +
        '<div class="cart-criterios-pilar-nome">' +
        MOTOR_PILAR_NOMES[pilar] +
        '</div>' +
        '<div class="cart-criterios-lista">' +
        chips +
        '</div></div>'
      );
    }).join('');

    return (
      '<div class="cart-criterios-grupo">' +
      '<div class="cart-criterios-head" onclick="this.parentElement.classList.toggle(\'aberto\')">' +
      '<i class="ph ph-caret-right"></i>' +
      '<span class="cart-criterios-nome">' +
      c.nome +
      '</span>' +
      '<span class="cart-criterios-conta">' +
      total +
      ' indicadores</span>' +
      '</div>' +
      '<div class="cart-criterios-body">' +
      pilares +
      '</div></div>'
    );
  }).join('');

  // A lente ativa muda o PESO de cada pilar no score final. Sem ela, a lista
  // acima explicaria os indicadores e esconderia o que faz a mesma carteira
  // ordenar diferente ao trocar de lente.
  var pesos = MOTOR_PILARES.map(function (pilar) {
    var peso = lente.pesos[pilar] != null ? lente.pesos[pilar] : 1;
    return (
      '<span class="cart-criterios-metrica">' +
      MOTOR_PILAR_NOMES[pilar] +
      '<span class="cart-criterios-peso">×' +
      peso +
      '</span></span>'
    );
  }).join('');

  var principios = (lente.principios || [])
    .map(function (t) {
      return '<li>' + t + '</li>';
    })
    .join('');

  el.innerHTML =
    '<div class="cart-motor-sub"><i class="ph ph-list-magnifying-glass"></i> ' +
    'Critérios de análise e pontuação' +
    '<span class="cart-motor-sub-nota">Cada indicador recebe nota de 0 a 10 por faixas fixas; ' +
    'o pilar é a média ponderada dos seus indicadores, e o score é a média dos pilares pela lente ativa.</span>' +
    '</div>' +
    '<div class="cart-criterios-intro">' +
    'Indicador sem dado não vira nota zero — ele sai da conta e reduz a cobertura do ativo. ' +
    'Abaixo de ' +
    Math.round(MOTOR_COBERTURA_MINIMA * 100) +
    '% de cobertura o ativo deixa de ser pontuado, em vez de receber uma nota sem lastro.' +
    '</div>' +
    grupos +
    '<div class="cart-criterios-lente">' +
    '<strong>Lente ativa: ' +
    lente.nome +
    '</strong> — ' +
    lente.resumo +
    '<div class="cart-criterios-lista" style="margin-top:8px;">' +
    pesos +
    '</div>' +
    (principios ? '<ul>' + principios + '</ul>' : '') +
    '</div>';
}
