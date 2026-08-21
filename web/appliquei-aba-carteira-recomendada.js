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
  patrimonio: null, // null = usar o patrimônio real da aba Meu Patrimônio
  lente: null, // null = derivada do objetivo
  selecionados: { rf: null, acao: null, fii: null, cripto: null }, // null = todos
  simRange: '3y',
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
    cartEstado.selecionados = saved.selecionados || {
      rf: null,
      acao: null,
      fii: null,
      cripto: null,
    };
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
      selecionados: cartEstado.selecionados,
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
  document.getElementById('cartSelecaoWrap').style.display = 'none';
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
  cartEstado.selecionados = { rf: null, acao: null, fii: null, cripto: null };
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
  document.getElementById('cartSelecaoWrap').style.display = 'block';
  document.getElementById('cartSimCard').style.display = 'block';

  cartRenderizarEdu();
  cartRenderizarDonut();
  cartRenderizarSelecaoGrid();
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
function cartRenderizarSelecaoGrid() {
  const alloc = cartAlocacaoAlvo();
  const capital = cartEstado.capital;
  const grid = document.getElementById('cartSelecaoGrid');
  grid.innerHTML = '';

  const classesVisiveis = ['rf', 'acao', 'fii', 'cripto'].filter(
    (c) => (alloc[c] || 0) > 0 || c !== 'cripto'
  );

  classesVisiveis.forEach((classe) => {
    const macropct = alloc[classe] || 0;
    const macroVlr = (capital * macropct) / 100;
    const ativos =
      (dbCarteira.ativos && dbCarteira.ativos[classe]) || CART_ATIVOS_DEFAULT[classe] || [];
    let selecionados = cartEstado.selecionados[classe];
    if (!selecionados) selecionados = ativos.map((a) => a.ticker);

    const n = selecionados.length || 1;
    const percPorAtivo = macropct > 0 ? +(macropct / n).toFixed(1) : 0;
    const vlrPorAtivo = macroVlr / n;

    const col = document.createElement('div');
    col.className = `cart-classe-col cart-classe-${classe}`;
    if (macropct === 0) col.classList.add('dimmed');

    const ativosHtml =
      ativos.length === 0
        ? `<div class="cart-classe-empty">Nenhum ativo cadastrado</div>`
        : ativos
            .map((a) => {
              const checked = selecionados.includes(a.ticker);
              const ativoN = checked ? n : 0;
              const vlrDisp = checked ? formatarMoeda(vlrPorAtivo) : 'R$ 0,00';
              const pctDisp = checked ? percPorAtivo.toFixed(1) + '%' : '—';
              return `<li class="cart-ativo-item${checked ? '' : ' unchecked'}"
                            onclick="cartToggleAtivo('${classe}','${a.ticker}')"
                            data-classe="${classe}" data-ticker="${a.ticker}">
                    <div class="cart-ativo-check">
                        ${checked ? '<i class="ph ph-check-bold"></i>' : ''}
                    </div>
                    <div class="cart-ativo-body">
                        <div class="cart-ativo-ticker">${a.ticker}</div>
                        <div class="cart-ativo-nome">${a.nome}</div>
                    </div>
                    <div class="cart-ativo-right">
                        <div class="cart-ativo-pct">${pctDisp}</div>
                        <div class="cart-ativo-vlr">${vlrDisp}</div>
                    </div>
                </li>`;
            })
            .join('');

    const totalSelecionadoVlr = selecionados.length > 0 ? formatarMoeda(macroVlr) : 'R$ 0,00';
    col.innerHTML = `
            <div class="cart-classe-col-header">
                <div class="cart-classe-col-name">
                    <i class="ph ${CART_ICONS[classe]}"></i> ${CART_NOMES[classe]}
                </div>
                <div class="cart-classe-col-meta">
                    <span class="cart-classe-col-pct">${macropct}%</span>
                    <span class="cart-classe-col-vlr">${formatarMoeda(macroVlr)}</span>
                </div>
            </div>
            <ul class="cart-classe-list">${ativosHtml}</ul>
            <div class="cart-classe-col-footer">
                <span class="lbl">Total alocado:</span>
                <span class="val">${totalSelecionadoVlr}</span>
            </div>`;
    grid.appendChild(col);
  });
}

function cartToggleAtivo(classe, ticker) {
  const ativos =
    (dbCarteira.ativos && dbCarteira.ativos[classe]) || CART_ATIVOS_DEFAULT[classe] || [];
  let sel = cartEstado.selecionados[classe];
  if (!sel) sel = ativos.map((a) => a.ticker);

  if (sel.includes(ticker)) {
    if (sel.length <= 1)
      return mostrarToast('Pelo menos um ativo deve estar selecionado por classe.', 'info');
    cartEstado.selecionados[classe] = sel.filter((t) => t !== ticker);
  } else {
    cartEstado.selecionados[classe] = [...sel, ticker];
  }
  cartSalvarEstado();
  cartRenderizarSelecaoGrid();
  cartRenderizarDonut();
  cartRecalcularMotor();
}

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

  el.innerHTML = `
        <div class="cart-sim-kpi">
            <div class="lbl">Rentabilidade no período</div>
            <div class="val ${retorno >= 0 ? 'pos' : 'neg'}">${retorno >= 0 ? '+' : ''}${retorno}%</div>
        </div>
        <div class="cart-sim-kpi">
            <div class="lbl">Total aportado (${blended.length}× ${formatarMoeda(aporteMensal)})</div>
            <div class="val">${formatarMoeda(totalAportado)}</div>
        </div>
        <div class="cart-sim-kpi">
            <div class="lbl">Patrimônio final estimado</div>
            <div class="val">${formatarMoeda(vlrFinal)}</div>
        </div>
        <div class="cart-sim-kpi">
            <div class="lbl">Ganho sobre o aportado</div>
            <div class="val ${retornoSobreAporte >= 0 ? 'pos' : 'neg'}">${retornoSobreAporte >= 0 ? '+' : ''}${retornoSobreAporte.toFixed(1)}%</div>
        </div>
        <div class="cart-sim-kpi">
            <div class="lbl">Retorno médio mensal</div>
            <div class="val ${rentMensal >= 0 ? 'pos' : 'neg'}">${rentMensal >= 0 ? '+' : ''}${rentMensal}%/mês</div>
        </div>
        <div class="cart-sim-kpi">
            <div class="lbl">Drawdown máximo</div>
            <div class="val neg">-${maiorDrawdown.toFixed(1)}%</div>
        </div>
        <div class="cart-sim-kpi">
            <div class="lbl">Queda esperada (ano ruim)</div>
            <div class="val neg">-${CART_QUEDA_ANO_RUIM[cartEstado.perfil] || 10}%</div>
        </div>
        ${
          alphaCDI !== null
            ? `<div class="cart-sim-kpi">
            <div class="lbl">Alpha vs CDI</div>
            <div class="val ${alphaCDI >= 0 ? 'pos' : 'neg'}">${alphaCDI >= 0 ? '+' : ''}${alphaCDI.toFixed(1)}%</div>
        </div>`
            : ''
        }`;
}

// Legacy shim — necessário para calls que ainda referenciam calcularCarteiraRecomendada
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
function cartAlocacaoAlvo() {
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

/** Ativos publicados na carteira modelo que o utilizador não desmarcou. */
function cartUniversoBase() {
  var out = [];
  MOTOR_CLASSES.forEach(function (classe) {
    var ativos =
      (dbCarteira.ativos && dbCarteira.ativos[classe]) || CART_ATIVOS_DEFAULT[classe] || [];
    var sel = cartEstado.selecionados[classe];
    ativos.forEach(function (a) {
      if (!a || !a.ticker) return;
      if (sel && sel.indexOf(a.ticker) === -1) return;
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

/** Busca fundamentos (BRAPI/CoinGecko) e taxas do Tesouro para o universo. */
async function cartBuscarDadosMotor(universo) {
  var token = await cartTokenFirebase();
  if (!token) throw new Error('Sessão expirada — entre novamente para o motor buscar os dados.');

  var tickers = universo
    .filter(function (a) {
      return a.classe !== 'rf';
    })
    .map(function (a) {
      return a.ticker;
    });

  var fundamentos = {};
  var lotes = [];
  for (var i = 0; i < tickers.length; i += 50) lotes.push(tickers.slice(i, i + 50));

  var precisaRf = universo.some(function (a) {
    return a.classe === 'rf';
  });

  var respostas = await Promise.all(
    lotes
      .map(function (lote) {
        return fetch('/api/market?op=fundamentals&tickers=' + encodeURIComponent(lote.join(',')), {
          headers: { Authorization: 'Bearer ' + token },
        }).then(function (r) {
          return r.json();
        });
      })
      .concat(
        precisaRf
          ? [
              fetch('/api/market?op=rendafixa', {
                headers: { Authorization: 'Bearer ' + token },
              })
                .then(function (r) {
                  return r.json();
                })
                // Tesouro fora do ar não pode derrubar o motor inteiro: as
                // outras classes continuam com dado e a RF cai para score
                // neutro, sinalizado no rodapé.
                .catch(function () {
                  return { titulos: [], erroRf: true };
                }),
            ]
          : []
      )
  );

  var titulosRf = [];
  respostas.forEach(function (r) {
    if (!r) return;
    if (r.fundamentos) Object.assign(fundamentos, r.fundamentos);
    if (r.titulos) titulosRf = r.titulos;
  });

  return { fundamentos: fundamentos, titulosRf: titulosRf };
}

/** Junta carteira modelo + fundamentos num universo pronto para pontuar. */
function cartMontarUniverso(base, fundamentos, titulosRf) {
  return base.map(function (a) {
    var dados = { ticker: a.ticker, nome: a.nome, classe: a.classe, obs: a.obs };
    if (a.classe === 'rf') {
      var t = cartCasarTesouro(a, titulosRf || []);
      if (t) Object.assign(dados, t, { ticker: a.ticker, nome: a.nome, classe: 'rf' });
    } else {
      var f = fundamentos[a.ticker];
      if (f) {
        Object.assign(dados, f, {
          ticker: a.ticker,
          // Nome da carteira modelo vence o da BRAPI: é o que o consultor
          // escreveu e o que o utilizador reconhece na tela.
          nome: a.nome,
          classe: a.classe,
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

function cartTrocarLente(id) {
  if (!MOTOR_LENTES[id]) return;
  cartEstado.lente = id;
  cartSalvarEstado();
  cartRenderizarMotorLentes();
  cartRecalcularMotor();
}

/** Recalcula ranking e plano com os fundamentos já em memória (sem rede). */
function cartRecalcularMotor() {
  if (!cartMotor.buscadoEm) return;
  var base = cartUniversoBase();
  var universo = cartMontarUniverso(base, cartMotor.fundamentos, cartMotor.titulosRf);
  cartMotor.ranking = motorRanquear(universo, { lente: cartLenteAtiva() });
  var patr = cartPatrimonioPorClasse();
  cartMotor.origemPatrimonio = patr.origem;
  cartMotor.plano = motorPlanoAporte({
    aporteMensal: cartEstado.capital,
    alocacaoAlvo: cartAlocacaoAlvo(),
    ranking: cartMotor.ranking,
    patrimonioAtual: patr.valores,
  });
  cartRenderizarMotorStatus();
  cartRenderizarMotorPlano(cartMotor.plano);
  cartRenderizarMotorRanking(cartMotor.ranking);
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
    var base = cartUniversoBase();
    var dados = await cartBuscarDadosMotor(base);
    if (seq !== cartMotorSeq) return;
    cartMotor.fundamentos = dados.fundamentos;
    cartMotor.titulosRf = dados.titulosRf;
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
  var comDado = ranking.filter(function (a) {
    return a.cobertura > 0;
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
      comDado +
      ' de ' +
      ranking.length +
      ' ativos com indicadores (' +
      Math.round(coberturaMedia * 100) +
      '% de cobertura média)</span>'
  );
  if (cartMotor.origemPatrimonio === 'carteira')
    partes.push(
      '<span class="cart-motor-status-item"><i class="ph ph-scales"></i> Rebalanceando com base na sua carteira atual</span>'
    );
  else if (cartMotor.origemPatrimonio === 'informado')
    partes.push(
      '<span class="cart-motor-status-item"><i class="ph ph-scales"></i> Patrimônio informado no questionário</span>'
    );

  var alerta = '';
  if (cartMotor.erro) {
    alerta =
      '<div class="cart-motor-alerta erro"><i class="ph ph-warning-circle"></i> ' +
      'Não foi possível buscar os indicadores (' +
      cartMotor.erro +
      '). Os scores abaixo estão neutros — a divisão por classe continua válida.</div>';
  } else if (coberturaMedia < 0.25) {
    alerta =
      '<div class="cart-motor-alerta"><i class="ph ph-info"></i> ' +
      'Cobertura de indicadores baixa. Os scores foram puxados para a média por precaução — ' +
      'com um plano de dados fundamentalistas na fonte de mercado, a diferenciação entre ativos aumenta.</div>';
  }

  el.innerHTML =
    '<div class="cart-motor-status-linha">' +
    partes.join('') +
    '<button type="button" class="cart-btn-mini" onclick="cartAtualizarMotor()">' +
    '<i class="ph ph-arrows-clockwise"></i> Atualizar dados</button></div>' +
    alerta;
}

function cartRenderizarMotorPlano(plano) {
  var el = document.getElementById('cartMotorPlano');
  if (!el || !plano) return;

  var colunas = MOTOR_CLASSES.map(function (classe) {
    var c = plano.classes[classe];
    if (!c) return '';
    var pct = c.pct || 0;
    var itens = c.itens || [];
    var linhas = itens.length
      ? itens
          .map(function (it) {
            var qtd =
              it.quantidade != null && it.unidade
                ? '<span class="cart-plano-qtd">' +
                  (it.classe === 'cripto' ? it.quantidade : it.quantidade + ' ' + it.unidade) +
                  '</span>'
                : '';
            return (
              '<li class="cart-plano-item">' +
              '<span class="cart-plano-score" style="background:' +
              cartCorScore(it.score) +
              ';">' +
              it.score +
              '</span>' +
              '<span class="cart-plano-body">' +
              '<span class="cart-plano-ticker">' +
              it.ticker +
              '</span>' +
              '<span class="cart-plano-nome">' +
              (it.nome || '') +
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
      '<ul class="cart-classe-list">' +
      linhas +
      '</ul>' +
      '<div class="cart-classe-col-footer">' +
      '<span class="lbl">' +
      (c.sobra > 0.009 ? 'Sobra de caixa:' : 'Total alocado:') +
      '</span>' +
      '<span class="val">' +
      formatarMoeda(c.sobra > 0.009 ? c.sobra : c.investido) +
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
    '<div><span class="lbl">Sobra para o próximo aporte</span><span class="val">' +
    formatarMoeda(plano.sobra) +
    '</span></div>' +
    '</div>' +
    '<div class="cart-selecao-grid">' +
    colunas +
    '</div>' +
    avisos;
}

function cartRenderizarMotorRanking(ranking) {
  var el = document.getElementById('cartMotorRanking');
  if (!el) return;
  if (!ranking || !ranking.length) {
    el.innerHTML =
      '<div class="cart-classe-empty">Nenhum ativo no universo da carteira modelo.</div>';
    return;
  }

  el.innerHTML = ranking
    .map(function (a) {
      var barras = MOTOR_PILARES.map(function (chave) {
        var p = a.pilares[chave];
        var nota = p && p.nota;
        var altura = nota != null ? Math.max(4, (nota / 10) * 100) : 0;
        return (
          '<div class="cart-pilar" title="' +
          p.nome +
          ': ' +
          cartFmtNota(nota) +
          '/10">' +
          '<div class="cart-pilar-trilho"><div class="cart-pilar-barra' +
          (nota == null ? ' vazio' : '') +
          '" style="height:' +
          altura +
          '%;background:' +
          (nota == null ? 'var(--cor-borda2)' : cartCorScore(nota * 10)) +
          ';"></div></div>' +
          '<div class="cart-pilar-nota">' +
          cartFmtNota(nota) +
          '</div>' +
          '<div class="cart-pilar-nome">' +
          p.nome +
          '</div>' +
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

      return (
        '<div class="cart-score-card">' +
        '<div class="cart-score-head">' +
        '<span class="cart-score-pos">#' +
        a.posicao +
        '</span>' +
        '<span class="cart-score-id">' +
        '<span class="cart-score-ticker">' +
        a.ticker +
        '</span>' +
        '<span class="cart-score-nome">' +
        (a.nome || '') +
        ' · ' +
        CART_NOMES[a.classe] +
        '</span>' +
        '</span>' +
        '<span class="cart-score-badge" style="background:' +
        cartCorScore(a.score) +
        ';">' +
        a.score +
        '<small>/100</small></span>' +
        '</div>' +
        '<div class="cart-pilares">' +
        barras +
        '</div>' +
        '<div class="cart-score-just">' +
        motorJustificativa(a) +
        ' <span class="cart-score-conf conf-' +
        a.confianca +
        '">confiança ' +
        a.confianca +
        '</span></div>' +
        alertas +
        '</div>'
      );
    })
    .join('');
}
