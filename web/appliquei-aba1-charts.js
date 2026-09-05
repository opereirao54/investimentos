/**
 * Appliquei — ABA 1 charts: Evolução Mensal + Tema + Distribuição +
 * Quadro Inferior.
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script, carregado
 * DEPOIS de app.js. Concentra todo o subsistema de gráficos da aba
 * "Meus Investimentos":
 *  - Evolução Mensal (séries históricas, ~320 linhas)
 *  - Tema dos Gráficos (defaults Chart.js + getToken + paleta, ~308 linhas)
 *  - Distribuição (pizza por subcategoria/categoria, ~158 linhas)
 *  - Quadro Inferior (categorias com variação no mês, ~244 linhas)
 *
 * Deps: carteira, historicoCompras (state em app.js), Chart (CDN),
 * formatarMoeda (app.js), parseBRL (utils.js).
 *
 * setPeriodoEvolucao e aplicarTemaChartJs são chamados de
 * `window.onload` em app.js — globais via classic-script semantics.
 *
 * IMPORTANTE: chart instance vars (chartEvolucaoCarteira,
 * chartDistribuicaoCarteira, etc.) são `let` no escopo deste arquivo
 * (script-scoped, NÃO no window). Nenhum código fora deste arquivo as
 * referencia diretamente — auditado.
 */

// ============================================================
// === EVOLUÇÃO MENSAL — calcula séries a partir do histórico ===
// ============================================================
// Período do gráfico: 3, 6, 12 meses ou 0 (todos)
var periodoEvolucao = 3;
var chartEvolucaoCarteira = null;
var chartDistribuicaoCarteira = null;

function setPeriodoEvolucao(meses) {
  periodoEvolucao = meses;
  document.querySelectorAll('.period-pill').forEach((b) => {
    const ativo = parseInt(b.dataset.periodo, 10) === meses;
    b.classList.toggle('ativo', ativo);
  });
  renderizarGraficoEvolucao();
  atualizarChipDividendosPeriodo();
  atualizarResumoBlocoEvolucao();
}

// Recolhido, o bloco "Evolução" precisa dizer o que está dentro — senão vira uma
// pílula muda. Mostra o período e o filtro ativos (H1: status sempre visível).
function atualizarResumoBlocoEvolucao() {
  const el = document.getElementById('resumoBlocoEvolucao');
  if (!el) return;
  const partes = [rotuloPeriodoEvolucao()];
  const selTipo = document.getElementById('filtroEvolucaoTipo');
  const selAtivo = document.getElementById('filtroEvolucaoAtivo');
  if (selAtivo && selAtivo.value) partes.push(selAtivo.value);
  else if (selTipo && selTipo.value && selTipo.value !== 'todos') {
    const opt = selTipo.options[selTipo.selectedIndex];
    if (opt) partes.push(opt.text);
  }
  el.innerText = partes.join(' · ');
}

function rotuloPeriodoEvolucao() {
  if (periodoEvolucao === 0) return 'tudo';
  return `${periodoEvolucao}M`;
}

function atualizarChipDividendosPeriodo() {
  const elDiv = document.getElementById('resumoDividendosAcum');
  const elPer = document.getElementById('resumoDividendosPeriodo');
  if (elPer) elPer.innerText = `(${rotuloPeriodoEvolucao()})`;
  if (!elDiv) return;
  // Soma os mesmos pagamentos exibidos na tabela "Pagamentos recentes",
  // recortados pelo período do gráfico (3M/6M/12M/Tudo) e pelos filtros
  // de tipo/ativo. Garante consistência entre o KPI, a tabela e o gráfico.
  let limiteIniMs = 0;
  if (periodoEvolucao > 0) {
    const hoje = new Date();
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - (periodoEvolucao - 1), 1);
    limiteIniMs = inicio.getTime();
  }
  const filtroTipo = document.getElementById('filtroEvolucaoTipo')?.value || 'todos';
  const filtroAtivo = document.getElementById('filtroEvolucaoAtivo')?.value || '';
  const carteiraConsolidada =
    typeof obterResumoCarteira === 'function' ? obterResumoCarteira() : {};
  const totalDiv = (pagamentosMensaisAgregados || [])
    .filter((p) => limiteIniMs === 0 || new Date(p.ano, p.mes, 1).getTime() >= limiteIniMs)
    .filter((p) => {
      const ativo = carteiraConsolidada[p.ticker];
      const am = mockAtivosMercado.find((a) => a.ticker === p.ticker);
      return ativoEntraNoFiltroEvolucao(p.ticker, ativo, am, filtroTipo, filtroAtivo);
    })
    .reduce((s, p) => s + (p.total || 0), 0);
  elDiv.innerText = formatarMoeda(totalDiv);
}

// Critério único de filtro do bloco "Evolução do Patrimônio" (tipo + ativo).
function ativoEntraNoFiltroEvolucao(ticker, ativo, ativoMercado, filtroTipo, filtroAtivo) {
  if (filtroAtivo && (ticker || '').toUpperCase() !== filtroAtivo.toUpperCase()) return false;
  if (!filtroTipo || filtroTipo === 'todos') return true;
  const cat =
    ativo?.categoria || (ativoMercado?.tipo === 'Renda Fixa' ? 'renda_fixa' : 'renda_variavel');
  if (filtroTipo === 'renda_fixa') return cat === 'renda_fixa';
  if (filtroTipo === 'previdencia') return cat === 'previdencia';
  if (filtroTipo === 'reserva_emergencia') return cat === 'reserva_emergencia';
  if (cat !== 'renda_variavel') return false;
  const sub =
    ativo?.subcategoria ||
    subcategoriaInferidaDoTicker(ticker) ||
    (ativoMercado ? tipoMercadoParaSubcategoria(ativoMercado.tipo) : null);
  return sub === filtroTipo;
}

// Início do período de evolução. Retorna null se "Tudo".
function dataInicioPeriodoEvolucao() {
  if (periodoEvolucao <= 0) return null;
  const hoje = new Date();
  return new Date(hoje.getFullYear(), hoje.getMonth() - (periodoEvolucao - 1), 1);
}

// Aportes líquidos (compras − vendas) dentro do período, respeitando filtros.
function aportesLiquidosNoPeriodo(carteiraConsolidada, dataInicio, filtroTipo, filtroAtivo) {
  const inicioMs = dataInicio ? dataInicio.getTime() : 0;
  const agora = Date.now();
  let aplicado = 0;
  historicoCompras.forEach((op) => {
    if (!op.data_op) return;
    const tsOp = new Date(op.data_op).getTime();
    if (inicioMs > 0 && tsOp < inicioMs) return;
    // Aporte programado (data futura, ainda não realizado) não conta como
    // capital aplicado — mesma regra de obterResumoCarteira para o valor de
    // hoje. Sem isso, ele inflava o "aplicado" e gerava um ganho negativo
    // fantasma (= ao valor do aporte futuro). saldoInicial conta sempre.
    if (!op.saldoInicial && isFinite(tsOp) && tsOp > agora) return;
    const ativoOp = carteiraConsolidada[op.ticker];
    const am = mockAtivosMercado.find((a) => a.ticker === op.ticker);
    const ativoFake = ativoOp || { categoria: op.categoria, subcategoria: op.subcategoria };
    if (!ativoEntraNoFiltroEvolucao(op.ticker, ativoFake, am, filtroTipo, filtroAtivo)) return;
    const tipo = op.tipo || 'compra';
    const preco = op.preco_op || op.preco_pago || 0;
    const valor = (op.quantidade || 1) * preco;
    if (tipo === 'compra') aplicado += valor;
    else if (tipo === 'venda') aplicado -= valor;
  });
  return aplicado;
}

// Patrimônio reconstruído numa data, respeitando filtros (preços usam o atual
// de mercado por limitação de séries históricas — assume preços estáveis).
function patrimonioNaData(dataLimite, filtroTipo, filtroAtivo) {
  const limiteMs = dataLimite ? dataLimite.getTime() : 0;
  if (limiteMs <= 0) return 0;
  const consolidado = consolidarCarteiraNaData(limiteMs);
  let patrim = 0;
  for (const ticker in consolidado) {
    const ativo = consolidado[ticker];
    if (ativo.qtdTotal <= 0) continue;
    const am = mockAtivosMercado.find((a) => a.ticker === ticker);
    if (!ativoEntraNoFiltroEvolucao(ticker, ativo, am, filtroTipo, filtroAtivo)) continue;
    if (ativo.categoria === 'previdencia') {
      patrim += calcularSaldoPrevidencia(ticker, limiteMs);
    } else if (
      (ativo.categoria === 'renda_fixa' || ativo.categoria === 'reserva_emergencia') &&
      typeof valorAtualRendaFixa === 'function'
    ) {
      // Rendimento de RF/Reserva acumulado até a data de referência (mesma base
      // do KPI de hoje), para o ganho do período medir só a variação real.
      patrim += valorAtualRendaFixa(ticker, ativo.categoria, limiteMs);
    } else {
      const precoAtual = am ? am.preco_atual : ativo.precoMedio;
      patrim += ativo.qtdTotal * precoAtual;
    }
  }
  return patrim;
}

// Atualiza os KPIs do hero (Patrimônio atual, Capital aplicado, Ganho capital,
// chip de Dividendos, "desde X") com base nos filtros do bloco Evolução.
function atualizarKPIsResumo(carteiraConsolidada) {
  if (!carteiraConsolidada) carteiraConsolidada = obterResumoCarteira();
  const filtroTipo = document.getElementById('filtroEvolucaoTipo')?.value || 'todos';
  const filtroAtivo = document.getElementById('filtroEvolucaoAtivo')?.value || '';

  let investTotal = 0,
    patrim = 0,
    totalAtivos = 0;
  for (const ticker in carteiraConsolidada) {
    const ativo = carteiraConsolidada[ticker];
    if (ativo.qtdTotal <= 0) continue;
    const ativoMercado = mockAtivosMercado.find((a) => a.ticker === ticker);
    if (!ativoEntraNoFiltroEvolucao(ticker, ativo, ativoMercado, filtroTipo, filtroAtivo)) continue;
    totalAtivos++;
    investTotal += ativo.valorTotalInvestido;
    let saldo;
    if (ativo.categoria === 'previdencia') {
      saldo = calcularSaldoPrevidencia(ticker);
    } else if (
      (ativo.categoria === 'renda_fixa' || ativo.categoria === 'reserva_emergencia') &&
      typeof valorAtualRendaFixa === 'function'
    ) {
      // RF/Reserva rendem por juros compostos (sem cotação de mercado). Usa o
      // mesmo cálculo da Carteira e do Meu Patrimônio para o "hoje" refletir o
      // rendimento — senão mostrava só o custo aplicado e o ganho zerava.
      saldo = valorAtualRendaFixa(ticker, ativo.categoria);
    } else {
      const precoAtual = ativoMercado ? ativoMercado.preco_atual : ativo.precoMedio;
      saldo = ativo.qtdTotal * precoAtual;
    }
    patrim += saldo;
  }

  // === Cálculos sensíveis ao período ===========================
  // "Tudo" (periodoEvolucao = 0): comportamento original (visão lifetime).
  // Período definido (1M/3M/6M/12M): KPIs refletem só a janela.
  const dataIni = dataInicioPeriodoEvolucao();
  let aplicado, ganhoR$, baseRent;
  if (dataIni) {
    // Patrimônio no fim do dia anterior ao início do período
    const dataPreInicio = new Date(dataIni.getTime() - 1);
    const patrimInicio = patrimonioNaData(dataPreInicio, filtroTipo, filtroAtivo);
    aplicado = aportesLiquidosNoPeriodo(carteiraConsolidada, dataIni, filtroTipo, filtroAtivo);
    // Variação de valor das holdings no período, descontando dinheiro novo
    ganhoR$ = patrim - patrimInicio - aplicado;
    baseRent = patrimInicio + Math.max(0, aplicado);
  } else {
    aplicado = investTotal;
    ganhoR$ = patrim - investTotal;
    baseRent = investTotal;
  }
  const lucroPerc = baseRent > 0 ? (ganhoR$ / baseRent) * 100 : 0;
  // =============================================================

  const elPat = document.getElementById('resumoPatrimonio');
  // O saldo é o único ponto focal da aba: "R$" e centavos entram rebaixados
  // para o olho cair na parte inteira. innerText perderia o markup.
  if (elPat) invAnimarValor(elPat, patrim, moedaComCentavosDiscretos);
  const elInv = document.getElementById('resumoInvestido');
  // O número muda de NATUREZA conforme o modo, e o rótulo tem de acompanhar:
  //   · "Tudo"   → ESTOQUE: custo de aquisição das posições. "Capital aplicado".
  //   · período  → FLUXO: compras − vendas na janela. Chamar isso de "capital
  //     aplicado" é o que fazia R$ 0,00 (não aportei nada em 3M) e valores
  //     NEGATIVOS (vendi mais do que comprei) lerem como bug. Rótulo de estoque
  //     com número de fluxo era a única coisa errada — a conta sempre esteve certa.
  const elRotInv = document.getElementById('rotuloAplicado');
  if (elInv) invAnimarValor(elInv, dataIni ? Math.abs(aplicado) : aplicado, formatarMoeda);
  if (elRotInv) {
    elRotInv.innerText = !dataIni
      ? 'Capital aplicado'
      : aplicado < 0
        ? 'Resgates líquidos'
        : 'Aportes no período';
  }

  const cardRend = document.getElementById('resumoRendimento');
  const cardRent = document.getElementById('resumoRentabilidade');
  const titRend = document.getElementById('tituloRendimento');
  if (cardRend) {
    invAnimarValor(cardRend, ganhoR$, (v) => `${v >= 0 ? '+' : ''}${formatarMoeda(v)}`);
    cardRend.style.color = ganhoR$ < 0 ? 'var(--cor-erro)' : 'var(--cor-txt-primaria)';
  }
  if (cardRent) invAnimarValor(cardRent, lucroPerc, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
  if (titRend) {
    titRend.style.color = '';
    titRend.innerText = dataIni ? `Ganho capital (${rotuloPeriodoEvolucao()})` : 'Ganho capital';
  }

  const badgeTend = document.getElementById('resumoRentabilidadeBadge');
  const iconTend = document.getElementById('iconResumoRent');
  if (badgeTend && iconTend) {
    badgeTend.classList.toggle('neg', ganhoR$ < 0);
    iconTend.className = ganhoR$ >= 0 ? 'ph-bold ph-arrow-up' : 'ph-bold ph-arrow-down';
  }

  // Curva e barra de alocação vivem do mesmo estado dos KPIs: redesenham junto
  // para que filtro, período e número nunca fiquem contando histórias
  // diferentes na mesma tela.
  renderizarSparkHero(filtroTipo, filtroAtivo);
  renderizarAlocacaoHero(carteiraConsolidada);

  // Detalhe "desde X" — quando há período, mostra a janela; senão, 1ª compra do filtro
  const elDesde = document.getElementById('kpiInvestidoDesde');
  if (elDesde) {
    if (dataIni) {
      const lblIni = dataIni
        .toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
        .replace('.', '');
      // "R$ 0,00" sob "Capital aplicado" lê como bug quando na verdade é
      // "você não aportou nada nesta janela". O rótulo diz qual dos dois é.
      elDesde.innerText =
        aplicado > 0
          ? `desde ${lblIni} · ${rotuloPeriodoEvolucao()}`
          : aplicado < 0
            ? `vendas superaram compras em ${rotuloPeriodoEvolucao()}`
            : `nenhum aporte em ${rotuloPeriodoEvolucao()}`;
    } else {
      const datasFiltradas = historicoCompras
        .filter((o) => o.tipo !== 'venda' && o.data_op)
        .filter((o) => {
          const ativoOp = carteiraConsolidada[o.ticker];
          const am = mockAtivosMercado.find((a) => a.ticker === o.ticker);
          const ativoFake = ativoOp || { categoria: o.categoria, subcategoria: o.subcategoria };
          return ativoEntraNoFiltroEvolucao(o.ticker, ativoFake, am, filtroTipo, filtroAtivo);
        })
        .map((o) => o.data_op)
        .sort();
      if (datasFiltradas.length) {
        const d = new Date(datasFiltradas[0]);
        if (!isNaN(d.getTime())) {
          const lbl = d
            .toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
            .replace('.', '');
          elDesde.innerText = `desde ${lbl}`;
        } else {
          elDesde.innerText = 'desde sua 1ª compra';
        }
      } else {
        elDesde.innerText = 'Sem operações ainda';
      }
    }
  }

  atualizarChipDividendosPeriodo();

  // A tira "sem mexer em nada, em 10 anos" vive do mesmo saldo que acabou de
  // ser pintado — atualiza junto para os dois números nunca discordarem.
  if (typeof projAtualizarTiraHero === 'function') {
    try {
      projAtualizarTiraHero(null);
    } catch (_) {
      /* a projeção nunca pode derrubar o hero */
    }
  }
}

// Timestamp da operação para a série de evolução. Prioriza data_op, mas cai
// para a data de cadastro (cadastradoEm) ou o id numérico (Date.now() de
// criação) quando não há data_op — caso típico de Renda Fixa/Reserva lançadas
// como "já guardado", que antes ficavam de fora e deixavam o gráfico vazio.
// Espelha a regra de valorAtualRendaFixa para que o gráfico inclua os mesmos
// aportes que compõem o saldo dos KPIs.
function tsOperacaoEvolucao(op) {
  if (!op) return null;
  if (op.data_op) {
    const t = new Date(op.data_op).getTime();
    if (isFinite(t)) return t;
  }
  if (op.cadastradoEm) {
    const t = new Date(op.cadastradoEm).getTime();
    if (isFinite(t)) return t;
  }
  if (typeof op.id === 'number' && op.id > 1e12) return op.id;
  if (typeof op.id === 'string' && /^\d{13,}$/.test(op.id)) return Number(op.id);
  return null;
}

// Acumula posição (qtd) por ticker até o final de cada mês
function calcularSerieEvolucao(filtroTipo, filtroAtivo) {
  // Decide se uma operação entra no filtro escolhido
  function opEntraNoFiltro(op) {
    if (filtroAtivo && (op.ticker || '').toUpperCase() !== filtroAtivo.toUpperCase()) return false;
    if (!filtroTipo || filtroTipo === 'todos') return true;
    const cat = op.categoria || 'renda_variavel';
    if (filtroTipo === 'renda_fixa') return cat === 'renda_fixa';
    if (filtroTipo === 'previdencia') return cat === 'previdencia';
    if (filtroTipo === 'reserva_emergencia') return cat === 'reserva_emergencia';
    // Demais: subcategorias de RV
    if (cat !== 'renda_variavel') return false;
    const ativoMercado = mockAtivosMercado.find((a) => a.ticker === op.ticker);
    const sub =
      op.subcategoria ||
      subcategoriaInferidaDoTicker(op.ticker) ||
      (ativoMercado ? tipoMercadoParaSubcategoria(ativoMercado.tipo) : null);
    return sub === filtroTipo;
  }
  const opsFiltradas = historicoCompras.filter(
    (op) => tsOperacaoEvolucao(op) != null && opEntraNoFiltro(op)
  );
  if (opsFiltradas.length === 0) return { meses: [], investido: [], mercado: [], dividendos: [] };

  // Determina mês inicial e final
  const tsPrimeira = Math.min(...opsFiltradas.map((op) => tsOperacaoEvolucao(op)));
  const dPrimeira = new Date(tsPrimeira);
  let mesIni = new Date(dPrimeira.getFullYear(), dPrimeira.getMonth(), 1);
  const hoje = new Date();
  const mesFim = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

  // Limitar pelo período selecionado
  if (periodoEvolucao > 0) {
    const limite = new Date(hoje.getFullYear(), hoje.getMonth() - (periodoEvolucao - 1), 1);
    if (limite > mesIni) mesIni = limite;
  }

  const meses = [];
  const cursor = new Date(mesIni);
  while (cursor <= mesFim) {
    meses.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const investido = [];
  const mercado = [];
  const dividendos = [];
  const agoraTs = Date.now();
  meses.forEach((m) => {
    const fimMes = new Date(m.getFullYear(), m.getMonth() + 1, 0, 23, 59, 59).getTime();
    // Nunca projeta além de "agora": no mês corrente o patrimônio é o de hoje
    // (assim a última barra bate com o KPI "Investimentos hoje").
    const refMs = Math.min(fimMes, agoraTs);
    // Posição cumulativa por ticker até refMs (guarda a categoria p/ valorar
    // cada classe pela sua própria regra: RV→cotação, RF/Reserva→juros, Prev→saldo)
    const posicao = {};
    let invest = 0;
    opsFiltradas.forEach((op) => {
      const tsOp = tsOperacaoEvolucao(op);
      if (tsOp == null || tsOp > refMs) return;
      const tipo = op.tipo || 'compra';
      const preco = op.preco_op || op.preco_pago || 0;
      if (!posicao[op.ticker])
        posicao[op.ticker] = { qtd: 0, custo: 0, pm: 0, categoria: op.categoria || null };
      const p = posicao[op.ticker];
      if (op.categoria && !p.categoria) p.categoria = op.categoria;
      if (tipo === 'compra') {
        p.qtd += op.quantidade;
        p.custo += op.quantidade * preco;
        p.pm = p.qtd > 0 ? p.custo / p.qtd : 0;
        invest += op.quantidade * preco;
      } else if (tipo === 'venda') {
        invest -= op.quantidade * p.pm;
        p.qtd -= op.quantidade;
        p.custo -= op.quantidade * p.pm;
      }
    });
    // Valor de mercado consolidado de TODAS as classes. RF/Reserva e
    // Previdência rendem por juros compostos (mesma função dos KPIs e do Meu
    // Patrimônio); RV usa o fechamento DA ÉPOCA, de appliquei-rendimento.js.
    //
    // Aqui havia uma limitação declarada em comentário — "RV usa a cotação
    // atual (sem histórico de preços)" —, que fazia a barra de março mostrar a
    // posição de março valorada em setembro: a linha de mercado já nascia com
    // todo o ganho do período aplicado ao passado. Sem o histórico à mão
    // (rede fora, sem sessão) o comportamento volta a ser esse, que é o
    // fallback de rendPrecoEm.
    let valorMercado = 0;
    Object.entries(posicao).forEach(([ticker, p]) => {
      if (p.qtd <= 0) return;
      const cat = p.categoria;
      if (cat === 'previdencia') {
        valorMercado +=
          typeof calcularSaldoPrevidencia === 'function'
            ? calcularSaldoPrevidencia(ticker, refMs)
            : p.qtd * p.pm;
      } else if (
        (cat === 'renda_fixa' || cat === 'reserva_emergencia') &&
        typeof valorAtualRendaFixa === 'function'
      ) {
        valorMercado += valorAtualRendaFixa(ticker, cat, refMs);
      } else {
        const ativoMercado = mockAtivosMercado.find((a) => a.ticker === ticker);
        const precoAtual = ativoMercado ? ativoMercado.preco_atual : p.pm;
        const preco =
          typeof rendPrecoEm === 'function' ? rendPrecoEm(ticker, refMs, precoAtual) : precoAtual;
        valorMercado += p.qtd * preco;
      }
    });
    investido.push(Math.max(0, invest));
    mercado.push(Math.max(0, valorMercado));

    // Dividendos do mês: pagamentos do cacheDividendos onde data está no mês e o ticker está nas opsFiltradas.
    // Parser fixa hora 12:00 para evitar deslocamento de fuso (ex: 2026-04-01 caindo em março em GMT-3).
    // Usa qty na DATA DO PAGAMENTO (não no fim do mês) para não creditar dividendos
    // sobre cotas compradas após a data-com nem ignorar cotas vendidas após o pagamento.
    let div = 0;
    const tickersFiltrados = new Set(opsFiltradas.map((o) => o.ticker));
    tickersFiltrados.forEach((ticker) => {
      const cache = cacheDividendos[ticker];
      if (!cache || !cache.pagamentos) return;
      cache.pagamentos.forEach((pag) => {
        if (!pag.data) return;
        const tsPag = new Date(
          pag.data.length === 10 ? pag.data + 'T12:00:00' : pag.data
        ).getTime();
        const iniMes = new Date(m.getFullYear(), m.getMonth(), 1).getTime();
        if (tsPag < iniMes || tsPag > fimMes) return;
        const qtdNoPag = qtdNaData(ticker, pag.data);
        if (qtdNoPag <= 0) return;
        div += qtdNoPag * pag.valor;
      });
    });
    dividendos.push(div);
  });

  return { meses, investido, mercado, dividendos };
}

// ============================================================
// === TEMA DOS GRÁFICOS — alinhado ao design system          ===
// ============================================================
function getToken(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
}

function aplicarTemaChartJs() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.font.family = "'Figtree', system-ui, -apple-system, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = getToken('--cor-texto-secundario');
  Chart.defaults.borderColor = getToken('--cor-borda');
  Chart.defaults.plugins.tooltip.backgroundColor = getToken('--cor-texto-principal');
  Chart.defaults.plugins.tooltip.titleColor = getToken('--cor-branco');
  Chart.defaults.plugins.tooltip.bodyColor = getToken('--cor-branco');
  Chart.defaults.plugins.tooltip.titleFont = {
    family: "'Figtree', sans-serif",
    size: 12,
    weight: '600',
  };
  Chart.defaults.plugins.tooltip.bodyFont = { family: "'DM Mono', monospace", size: 11 };
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.boxPadding = 4;
  Chart.defaults.plugins.tooltip.displayColors = true;
}

// Paleta da carteira: verde monocromático para Renda Variável + acentos por classe
function paletaCarteira() {
  const dark = document.body.classList.contains('dark');
  return {
    acoes: dark ? '#34d399' : '#059669',
    fiis: dark ? '#6ee7b7' : '#10b981',
    bdrs: dark ? '#a7f3d0' : '#047857',
    etfs: dark ? '#10b981' : '#34d399',
    cripto: getToken('--cor-cartao'),
    renda_fixa: getToken('--cor-info'),
    previdencia: dark ? '#a78bfa' : '#7c3aed',
    reserva_emergencia: getToken('--cor-texto-mutado'),
  };
}

function corComAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function renderLegendaChart(containerId, itens) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = itens
    .map(
      (it) =>
        `<span class="chip-legenda"><span class="dot" style="background:${it.cor}"></span>${it.label}</span>`
    )
    .join('');
}

// Tooltip HTML do gráfico de evolução
function evolucaoHtmlTooltip(context) {
  const tooltipModel = context.tooltip;
  let el = document.getElementById('chart-tooltip-evolucao');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chart-tooltip-evolucao';
    el.className = 'chart-tooltip-card';
    document.body.appendChild(el);
  }
  if (!tooltipModel || tooltipModel.opacity === 0) {
    el.style.opacity = 0;
    return;
  }
  const idx = tooltipModel.dataPoints?.[0]?.dataIndex;
  if (idx === undefined) {
    el.style.opacity = 0;
    return;
  }

  const ds = context.chart.data.datasets;
  const aplicado = ds[0].data[idx] || 0;
  const ganho = ds[1].data[idx] || 0;
  const perda = ds[2].data[idx] || 0; // negativo
  const div = ds[3]?.data[idx] || 0;
  const patrimonio = aplicado + ganho + perda;
  const variacaoR$ = ganho + perda;
  const variacaoPerc = aplicado > 0 ? (variacaoR$ / aplicado) * 100 : 0;
  const corVar = variacaoR$ >= 0 ? 'var(--cor-primaria)' : 'var(--cor-erro)';
  const sinal = variacaoR$ >= 0 ? '+' : '';

  const linhas = [];
  linhas.push(
    `<div class="ttip-row ttip-total"><span>Investimentos</span><strong>${formatarMoeda(patrimonio)}</strong></div>`
  );
  linhas.push(`<div class="ttip-divider"></div>`);
  linhas.push(
    `<div class="ttip-row"><span><span class="ttip-dot" style="background:var(--cor-primaria)"></span>Capital aplicado</span><span>${formatarMoeda(aplicado)}</span></div>`
  );
  if (ganho > 0)
    linhas.push(
      `<div class="ttip-row"><span><span class="ttip-dot" style="background:var(--cor-primaria);opacity:0.4"></span>Ganho capital</span><span style="color:var(--cor-primaria)">+${formatarMoeda(ganho)}</span></div>`
    );
  if (perda < 0)
    linhas.push(
      `<div class="ttip-row"><span><span class="ttip-dot" style="background:var(--cor-erro)"></span>Perda capital</span><span style="color:var(--cor-erro)">${formatarMoeda(perda)}</span></div>`
    );
  if (div > 0)
    linhas.push(
      `<div class="ttip-row"><span><span class="ttip-dot" style="background:var(--cor-info)"></span>Dividendos</span><span style="color:var(--cor-info)">+${formatarMoeda(div)}</span></div>`
    );
  linhas.push(`<div class="ttip-divider"></div>`);
  linhas.push(
    `<div class="ttip-row"><span>Variação no mês</span><strong style="color:${corVar}">${sinal}${variacaoPerc.toFixed(2)}%</strong></div>`
  );

  el.innerHTML = `<div class="ttip-titulo">${tooltipModel.title?.[0] || ''}</div>${linhas.join('')}`;

  const pos = context.chart.canvas.getBoundingClientRect();
  el.style.opacity = 1;
  el.style.left = pos.left + window.pageXOffset + tooltipModel.caretX + 'px';
  el.style.top = pos.top + window.pageYOffset + tooltipModel.caretY + 'px';
  el.style.transform = 'translate(-50%, calc(-100% - 12px))';
}

// Popula o dropdown "Filtrar por ativo" com os tickers já operados,
// respeitando também o filtro de tipo selecionado.
function atualizarOpcoesFiltroAtivoEvolucao() {
  const sel = document.getElementById('filtroEvolucaoAtivo');
  if (!sel) return;
  const filtroTipo = document.getElementById('filtroEvolucaoTipo')?.value || 'todos';
  const valorAtual = sel.value;
  // Reaproveita a mesma lógica de filtro de tipo
  function tickerEntraNoTipo(op) {
    if (!filtroTipo || filtroTipo === 'todos') return true;
    const cat = op.categoria || 'renda_variavel';
    if (filtroTipo === 'renda_fixa') return cat === 'renda_fixa';
    if (filtroTipo === 'previdencia') return cat === 'previdencia';
    if (filtroTipo === 'reserva_emergencia') return cat === 'reserva_emergencia';
    if (cat !== 'renda_variavel') return false;
    const am = mockAtivosMercado.find((a) => a.ticker === op.ticker);
    const sub =
      op.subcategoria ||
      subcategoriaInferidaDoTicker(op.ticker) ||
      (am ? tipoMercadoParaSubcategoria(am.tipo) : null);
    return sub === filtroTipo;
  }
  const tickers = Array.from(
    new Set(
      historicoCompras
        .filter((o) => o.ticker && tickerEntraNoTipo(o))
        .map((o) => (o.ticker || '').toUpperCase())
    )
  ).sort();
  sel.innerHTML =
    '<option value="">Todos os ativos</option>' +
    tickers.map((t) => `<option value="${t}">${t}</option>`).join('');
  // Mantém seleção se ainda existir; caso contrário, volta a "todos"
  if (tickers.includes(valorAtual.toUpperCase())) sel.value = valorAtual.toUpperCase();
  else sel.value = '';
}

function renderizarGraficoEvolucao() {
  const canvas = document.getElementById('graficoEvolucaoCarteira');
  const msgVazia = document.getElementById('msgEvolucaoVazia');
  const legendaEl = document.getElementById('legendaEvolucao');
  if (!canvas) return;

  // Esconde o tooltip HTML quando o mouse sai do canvas
  if (!canvas.dataset.tooltipBound) {
    canvas.addEventListener('mouseleave', () => {
      const tt = document.getElementById('chart-tooltip-evolucao');
      if (tt) tt.style.opacity = 0;
    });
    canvas.dataset.tooltipBound = '1';
  }

  const filtro = document.getElementById('filtroEvolucaoTipo')?.value || 'todos';
  const filtroAtivo = document.getElementById('filtroEvolucaoAtivo')?.value || '';
  atualizarOpcoesFiltroAtivoEvolucao();
  // Filtros do gráfico também governam os KPIs do hero
  if (typeof atualizarKPIsResumo === 'function') atualizarKPIsResumo();
  const serie = calcularSerieEvolucao(filtro, filtroAtivo);

  if (serie.meses.length === 0) {
    if (chartEvolucaoCarteira) {
      chartEvolucaoCarteira.destroy();
      chartEvolucaoCarteira = null;
    }
    canvas.style.display = 'none';
    if (legendaEl) legendaEl.innerHTML = '';
    if (msgVazia) msgVazia.style.display = 'block';
    return;
  }
  canvas.style.display = 'block';
  if (msgVazia) msgVazia.style.display = 'none';

  const labels = serie.meses.map((d) =>
    d
      .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
      .replace('.', '')
      .toUpperCase()
  );
  const aplicado = serie.investido.slice();
  const ganhoCapital = serie.mercado.map((v, i) => Math.max(0, v - serie.investido[i]));
  const perdaCapital = serie.mercado.map((v, i) => Math.min(0, v - serie.investido[i]));
  const dividendos = serie.dividendos.slice();
  const temDividendos = dividendos.some((v) => v > 0);
  const temPerdas = perdaCapital.some((v) => v < 0);

  const ctx = canvas.getContext('2d');
  const corPrimaria = getToken('--cor-primaria');
  const corErro = getToken('--cor-erro');
  const corInfo = getToken('--cor-info');
  const corGrid = corComAlpha(getToken('--cor-borda'), 0.7);
  const altura = canvas.parentElement.clientHeight || 320;

  // Gradientes verticais para look "premium"
  const gradAplicado = ctx.createLinearGradient(0, 0, 0, altura);
  gradAplicado.addColorStop(0, corPrimaria);
  gradAplicado.addColorStop(1, corComAlpha(corPrimaria, 0.78));

  const gradGanho = ctx.createLinearGradient(0, 0, 0, altura);
  gradGanho.addColorStop(0, corComAlpha(corPrimaria, 0.55));
  gradGanho.addColorStop(1, corComAlpha(corPrimaria, 0.18));

  const gradPerda = ctx.createLinearGradient(0, 0, 0, altura);
  gradPerda.addColorStop(0, corComAlpha(corErro, 0.55));
  gradPerda.addColorStop(1, corComAlpha(corErro, 0.18));

  // Destaca o mês atual com leve borda na barra "Ganho capital"
  const hoje = new Date();
  const idxAtual = serie.meses.findIndex(
    (d) => d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth()
  );
  const bordaTopoGanho = ganhoCapital.map((_, i) => (i === idxAtual ? corPrimaria : 'transparent'));
  const bordaTopoAplicado = aplicado.map((_, i) =>
    i === idxAtual && ganhoCapital[i] === 0 ? corPrimaria : 'transparent'
  );

  if (chartEvolucaoCarteira) chartEvolucaoCarteira.destroy();
  chartEvolucaoCarteira = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Capital aplicado',
          data: aplicado,
          backgroundColor: gradAplicado,
          borderColor: bordaTopoAplicado,
          borderWidth: { top: 1.5, right: 0, bottom: 0, left: 0 },
          borderRadius: (ctxBar) => {
            const i = ctxBar.dataIndex;
            if (ganhoCapital[i] > 0) return 0;
            return { topLeft: 8, topRight: 8, bottomLeft: 0, bottomRight: 0 };
          },
          borderSkipped: false,
          stack: 'patrimonio',
          order: 3,
          barPercentage: 0.78,
          categoryPercentage: 0.85,
        },
        {
          label: 'Ganho capital',
          data: ganhoCapital,
          backgroundColor: gradGanho,
          borderColor: bordaTopoGanho,
          borderWidth: { top: 1.5, right: 0, bottom: 0, left: 0 },
          borderRadius: { topLeft: 8, topRight: 8, bottomLeft: 0, bottomRight: 0 },
          borderSkipped: false,
          stack: 'patrimonio',
          order: 2,
          barPercentage: 0.78,
          categoryPercentage: 0.85,
        },
        {
          label: 'Perda capital',
          data: perdaCapital,
          backgroundColor: gradPerda,
          borderRadius: { bottomLeft: 8, bottomRight: 8, topLeft: 0, topRight: 0 },
          borderSkipped: false,
          stack: 'patrimonio',
          order: 4,
          barPercentage: 0.78,
          categoryPercentage: 0.85,
        },
        {
          type: 'line',
          label: 'Dividendos',
          data: dividendos,
          borderColor: corInfo,
          backgroundColor: corComAlpha(corInfo, 0.08),
          borderDash: [5, 4],
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: corInfo,
          pointBorderColor: getToken('--cor-branco'),
          pointBorderWidth: 1.5,
          tension: 0.35,
          yAxisID: 'yDividendos',
          order: 0,
          hidden: !temDividendos,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: { enabled: false, external: evolucaoHtmlTooltip },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          border: { display: false },
          ticks: { font: { size: 10 }, color: getToken('--cor-texto-mutado') },
        },
        y: {
          stacked: true,
          ticks: {
            callback: (v) =>
              'R$ ' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0)),
            font: { size: 10 },
            color: getToken('--cor-texto-mutado'),
          },
          grid: { color: corGrid, drawTicks: false },
          border: { display: false },
        },
        yDividendos: {
          display: false,
          position: 'right',
          beginAtZero: true,
          grid: { display: false },
        },
      },
    },
  });

  const itensLegenda = [
    { label: 'Capital aplicado', cor: corPrimaria },
    { label: 'Ganho capital', cor: corComAlpha(corPrimaria, 0.45) },
  ];
  if (temPerdas) itensLegenda.push({ label: 'Perda capital', cor: corErro });
  if (temDividendos) itensLegenda.push({ label: 'Dividendos', cor: corInfo });
  renderLegendaChart('legendaEvolucao', itensLegenda);
}

// ============================================================
// === DISTRIBUIÇÃO — pizza por subcategoria/categoria        ===
// ============================================================
var ROTULOS_SUB = {
  acoes: 'Ações',
  fiis: 'FIIs',
  bdrs: 'BDRs',
  etfs: 'ETFs',
  cripto: 'Criptomoedas',
  renda_fixa: 'Renda Fixa',
  previdencia: 'Previdência',
  reserva_emergencia: 'Reserva de Emergência',
};

// Agrupa carteira em "categorias" finais (subcategorias de RV + RF/Prev/Reserva)
function agruparCarteiraPorCategoria(carteiraConsolidada) {
  const grupos = {};
  for (const ticker in carteiraConsolidada) {
    const ativo = carteiraConsolidada[ticker];
    if (ativo.qtdTotal <= 0) continue;
    const ativoMercado = mockAtivosMercado.find((a) => a.ticker === ticker);
    const cat = inferirCategoria(ticker, ativo, ativoMercado);
    let chave;
    if (cat === 'renda_variavel') chave = subcategoriaEfetiva(ticker, ativo, ativoMercado);
    else chave = cat;
    if (!grupos[chave]) grupos[chave] = { investido: 0, saldo: 0, ativos: [] };
    let saldo;
    if (cat === 'previdencia') {
      saldo = calcularSaldoPrevidencia(ticker);
    } else {
      const precoAtual = ativoMercado ? ativoMercado.preco_atual : ativo.precoMedio;
      saldo = ativo.qtdTotal * precoAtual;
    }
    grupos[chave].investido += ativo.valorTotalInvestido;
    grupos[chave].saldo += saldo;
    grupos[chave].ativos.push(ticker);
  }
  return grupos;
}

// Reconstrói a carteira como ela estava no instante `dataLimiteMs`, considerando
// apenas operações com `data_op` <= esse instante. Usado para variações por
// categoria sem depender de snapshots persistidos (que ficam stale ao excluir ops).
function consolidarCarteiraNaData(dataLimiteMs) {
  const consolidado = {};
  historicoCompras.forEach((op) => {
    if (!op.data_op) return;
    if (new Date(op.data_op).getTime() > dataLimiteMs) return;
    if (!consolidado[op.ticker])
      consolidado[op.ticker] = {
        qtdTotal: 0,
        valorTotalInvestido: 0,
        precoMedio: 0,
        categoria: null,
        subcategoria: null,
      };
    const ativo = consolidado[op.ticker];
    const tipo = op.tipo || 'compra';
    const precoDaOp = op.preco_op || op.preco_pago || 0;
    if (tipo === 'compra') {
      ativo.qtdTotal += op.quantidade;
      ativo.valorTotalInvestido += op.quantidade * precoDaOp;
      ativo.precoMedio = ativo.qtdTotal > 0 ? ativo.valorTotalInvestido / ativo.qtdTotal : 0;
      if (op.categoria) ativo.categoria = op.categoria;
      if (op.subcategoria) ativo.subcategoria = op.subcategoria;
    } else if (tipo === 'venda') {
      ativo.qtdTotal -= op.quantidade;
      ativo.valorTotalInvestido -= op.quantidade * ativo.precoMedio;
    }
  });
  return consolidado;
}

function renderizarGraficoDistribuicao(carteiraConsolidada) {
  const canvas = document.getElementById('graficoDistribuicaoCarteira');
  const msgVazia = document.getElementById('msgDistribuicaoVazia');
  const donutCenter = document.getElementById('donutCenter');
  if (!canvas) return;
  const grupos = agruparCarteiraPorCategoria(carteiraConsolidada);
  const entries = Object.entries(grupos).filter(([, v]) => v.saldo > 0);
  if (entries.length === 0) {
    if (chartDistribuicaoCarteira) {
      chartDistribuicaoCarteira.destroy();
      chartDistribuicaoCarteira = null;
    }
    canvas.style.display = 'none';
    if (donutCenter) donutCenter.style.display = 'none';
    if (msgVazia) msgVazia.style.display = 'block';
    return;
  }
  canvas.style.display = 'block';
  if (msgVazia) msgVazia.style.display = 'none';

  const paleta = paletaCarteira();
  const labels = entries.map(([k]) => ROTULOS_SUB[k] || k);
  const data = entries.map(([, v]) => v.saldo);
  const cores = entries.map(([k]) => paleta[k] || getToken('--cor-texto-mutado'));
  const total = data.reduce((a, b) => a + b, 0);
  const corBorda = getToken('--cor-branco');

  if (chartDistribuicaoCarteira) chartDistribuicaoCarteira.destroy();
  chartDistribuicaoCarteira = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        { data, backgroundColor: cores, borderWidth: 3, borderColor: corBorda, hoverOffset: 8 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          color: '#fff',
          font: { family: "'Figtree', sans-serif", weight: '700', size: 11 },
          formatter: (v) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : ''),
          display: (ctx) => ctx.parsed > total * 0.06,
        },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.label}: ${formatarMoeda(ctx.parsed)} (${((ctx.parsed / total) * 100).toFixed(1)}%)`,
          },
        },
      },
      cutout: '68%',
    },
  });

  renderLegendaChart(
    'legendaDistribuicao',
    entries.map(([k]) => ({
      label: ROTULOS_SUB[k] || k,
      cor: paleta[k] || getToken('--cor-texto-mutado'),
    }))
  );

  // Insight no centro do donut: maior posição individual da carteira
  if (donutCenter) {
    let maiorTicker = null,
      maiorSaldo = 0;
    for (const ticker in carteiraConsolidada) {
      const ativo = carteiraConsolidada[ticker];
      if (ativo.qtdTotal <= 0) continue;
      const ativoMercado = mockAtivosMercado.find((a) => a.ticker === ticker);
      const cat = inferirCategoria(ticker, ativo, ativoMercado);
      let saldo;
      if (cat === 'previdencia') saldo = calcularSaldoPrevidencia(ticker);
      else saldo = ativo.qtdTotal * (ativoMercado ? ativoMercado.preco_atual : ativo.precoMedio);
      if (saldo > maiorSaldo) {
        maiorSaldo = saldo;
        maiorTicker = ticker;
      }
    }
    if (maiorTicker && total > 0) {
      const perc = (maiorSaldo / total) * 100;
      document.getElementById('distMaiorPos').innerText = maiorTicker;
      document.getElementById('distMaiorDetalhe').innerHTML =
        `${perc.toFixed(1)}% · <span class="valor-mascarado" style="font-family:'DM Mono',monospace;">${formatarMoeda(maiorSaldo)}</span>`;
      donutCenter.style.display = 'block';
    } else {
      donutCenter.style.display = 'none';
    }
  }
}

// ============================================================
// === QUADRO INFERIOR — categorias com variação no mês       ===
// ============================================================
// Snapshot mensal: { "YYYY-MM": { saldoTotal, investidoTotal, porGrupo: { [chave]: saldo } } }
function carregarSnapshotsCarteira() {
  try {
    return JSON.parse(localStorage.getItem('futurorico_carteira_snapshots') || '{}');
  } catch {
    return {};
  }
}
function salvarSnapshotsCarteira(snaps) {
  localStorage.setItem('futurorico_carteira_snapshots', JSON.stringify(snaps));
}
function chaveMesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function atualizarSnapshotMesAtual(carteiraConsolidada) {
  const snaps = carregarSnapshotsCarteira();
  const chave = chaveMesAtual();
  const grupos = agruparCarteiraPorCategoria(carteiraConsolidada);
  const porGrupo = {};
  let saldoTotal = 0;
  let investidoTotal = 0;
  Object.entries(grupos).forEach(([k, v]) => {
    porGrupo[k] = v.saldo;
    saldoTotal += v.saldo;
    investidoTotal += v.investido;
  });
  // Atualiza só o mês atual (preserva snapshots passados)
  snaps[chave] = { saldoTotal, investidoTotal, porGrupo, atualizadoEm: new Date().toISOString() };
  salvarSnapshotsCarteira(snaps);
}

// Mantida como ponto de entrada (chamado por atualizarCarteiraAtivos). Encaminha às novas funções.
function atualizarBarraAlocacao(carteiraConsolidada) {
  atualizarSnapshotMesAtual(carteiraConsolidada);
  renderizarGraficoDistribuicao(carteiraConsolidada);
  renderizarGraficoEvolucao();
}

// ============================================================
// === CAMADA PREMIUM DO HERO — curva, alocação e contagem   ===
// ============================================================
// Três coisas que o card de saldo ganha, e o problema que cada uma resolve:
//   · sparkline  → o número sozinho não diz se subiu; a forma diz, sem toque;
//   · alocação   → saber a composição exigia abrir o donut (220px + 1 toque);
//   · contagem   → a tela abria em R$ 0,00 e pulava para o valor; agora conta.
// Nada usa biblioteca: SVG montado à mão e requestAnimationFrame. Tudo respeita
// prefers-reduced-motion — com movimento reduzido o estado final aparece direto.

var INV_SEM_MOVIMENTO =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- Contagem animada -------------------------------------------------------
// Guarda o último valor por elemento para animar DE onde estava, não do zero:
// re-render por troca de filtro não deve fazer o número despencar e subir.
var invUltimoValor = {};
function invAnimarValor(el, destino, formatar) {
  if (!el) return;
  const chave = el.id || '';
  const de = chave in invUltimoValor ? invUltimoValor[chave] : 0;
  if (chave) invUltimoValor[chave] = destino;
  if (INV_SEM_MOVIMENTO || !isFinite(de) || Math.abs(destino - de) < 0.01) {
    el.innerHTML = formatar(destino);
    return;
  }
  if (el.__invRaf) cancelAnimationFrame(el.__invRaf);
  const inicio = performance.now();
  const dur = 620;
  const passo = (agora) => {
    const t = Math.min(1, (agora - inicio) / dur);
    // easeOutExpo: quase todo o percurso no começo — parece rápido sem cortar.
    const e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    el.innerHTML = formatar(de + (destino - de) * e);
    if (t < 1) el.__invRaf = requestAnimationFrame(passo);
    else el.__invRaf = null;
  };
  el.__invRaf = requestAnimationFrame(passo);
}

// --- Skeleton ---------------------------------------------------------------
// Ligado enquanto as cotações não chegaram. Sem isto o hero abre com R$ 0,00 e
// salta para o valor real — o "pisca" é o que mais faz a tela parecer barata.
function invSetCarregando(ligado) {
  const hero = document.querySelector('#patrimonio .inv-hero');
  if (!hero) return;
  if (ligado) hero.setAttribute('data-carregando', '1');
  else hero.removeAttribute('data-carregando');
}

// --- Sparkline --------------------------------------------------------------
// Consome a MESMA série do gráfico de evolução (calcularSerieEvolucao), então
// curva e gráfico nunca discordam. Desenha só o valor de mercado.
function renderizarSparkHero(filtroTipo, filtroAtivo) {
  const alvo = document.getElementById('sparkHero');
  if (!alvo || typeof calcularSerieEvolucao !== 'function') return;

  let serie;
  try {
    serie = calcularSerieEvolucao(filtroTipo, filtroAtivo);
  } catch (_) {
    alvo.innerHTML = '';
    return;
  }
  const pontos = (serie && serie.mercado ? serie.mercado : []).map((v) => Number(v) || 0);
  // Uma linha reta entre dois pontos iguais não informa nada; abaixo de 2 meses
  // o espaço vira convite para registrar a primeira operação.
  if (pontos.length < 2) {
    alvo.innerHTML =
      '<div class="inv-spark-vazia">A curva do seu patrimônio aparece aqui a partir do segundo mês.</div>';
    return;
  }

  const L = 300;
  const A = 60;
  // O último ponto recua 5 unidades: com a curva sangrando até a borda do card,
  // o marcador final ficava metade para fora e lia como defeito.
  const fim = L - 5;
  // Respiro em cima e embaixo: sem ele o mês de menor valor cola na borda e a
  // curva parece cortada, não desenhada.
  const pad = 11;
  const min = Math.min.apply(null, pontos);
  const max = Math.max.apply(null, pontos);
  const amp = max - min || Math.abs(max) || 1;
  const x = (i) => (i / (pontos.length - 1)) * fim;
  const y = (v) => A - pad - ((v - min) / amp) * (A - pad * 2);

  // Suaviza com bézier cúbica de tangente amortecida. Com 3 ou 4 meses uma
  // polilinha vira régua e parece um gráfico quebrado; a curva mostra a MESMA
  // série, só sem os cantos. O fator 0.22 (contra o 1/3 canônico) segura o
  // overshoot: numa série financeira uma barriga inventada abaixo do mínimo
  // desenharia uma queda que não existiu.
  const px = pontos.map((_, i) => x(i));
  const py = pontos.map((v) => y(v));
  let d = `M ${px[0].toFixed(2)} ${py[0].toFixed(2)}`;
  for (let i = 0; i < pontos.length - 1; i++) {
    const dx = (px[i + 1] - px[i]) * 0.22;
    const mAnt =
      i > 0 ? (py[i + 1] - py[i - 1]) / (px[i + 1] - px[i - 1]) : (py[1] - py[0]) / (px[1] - px[0]);
    const mProx =
      i + 2 < pontos.length
        ? (py[i + 2] - py[i]) / (px[i + 2] - px[i])
        : (py[i + 1] - py[i]) / (px[i + 1] - px[i]);
    const c1x = px[i] + dx;
    const c1y = py[i] + mAnt * dx;
    const c2x = px[i + 1] - dx;
    const c2y = py[i + 1] - mProx * dx;
    d +=
      ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)},` +
      ` ${px[i + 1].toFixed(2)} ${py[i + 1].toFixed(2)}`;
  }
  const area = d + ` L ${fim} ${A} L 0 ${A} Z`;
  const fx = x(pontos.length - 1);
  const fy = y(pontos[pontos.length - 1]);
  // Comprimento aproximado do traço, para o dash da animação de desenho.
  // Comprimento aproximado (polilinha × folga) para o dash da animação de
  // desenho. Subestimar deixaria o fim do traço já visível ao iniciar.
  let comp = 0;
  for (let i = 1; i < pontos.length; i++) {
    comp += Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]);
  }
  comp = Math.ceil(comp * 1.25);
  const uid = 'sk' + Date.now().toString(36);

  alvo.innerHTML =
    `<svg class="inv-spark" viewBox="0 0 ${L} ${A}" preserveAspectRatio="none" aria-hidden="true" focusable="false">` +
    `<defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="var(--cor-primaria)" stop-opacity="0.30"/>` +
    `<stop offset="70%" stop-color="var(--cor-primaria)" stop-opacity="0.06"/>` +
    `<stop offset="100%" stop-color="var(--cor-primaria)" stop-opacity="0"/>` +
    `</linearGradient></defs>` +
    `<path d="${area}" fill="url(#${uid})"/>` +
    `<path class="inv-spark-linha" d="${d}" style="--traco:${comp.toFixed(0)}"/>` +
    `</svg>` +
    // O marcador final é HTML, não <circle>. Dentro do SVG ele herdaria o
    // preserveAspectRatio="none" — que a CURVA precisa para esticar — e viraria
    // um risco vertical, porque a contra-escala teria de mudar a cada largura de
    // tela. Em porcentagem do wrapper ele fica redondo em qualquer viewport.
    `<span class="inv-spark-ponto" style="left:${((fx / L) * 100).toFixed(2)}%;top:${((fy / A) * 100).toFixed(2)}%"></span>`;
}

// --- Barra de alocação ------------------------------------------------------
// Mesma fonte do donut (agruparCarteiraPorCategoria + paletaCarteira), então as
// cores da barra, do donut e do avatar de cada ativo são a mesma linguagem.
function renderizarAlocacaoHero(carteiraConsolidada) {
  const barra = document.getElementById('barraAlocacao');
  const leg = document.getElementById('legendaAlocacao');
  if (!barra || typeof agruparCarteiraPorCategoria !== 'function') return;

  const grupos = agruparCarteiraPorCategoria(carteiraConsolidada || obterResumoCarteira());
  const itens = Object.entries(grupos)
    .filter(([, v]) => v.saldo > 0)
    .sort((a, b) => b[1].saldo - a[1].saldo);
  const total = itens.reduce((s, [, v]) => s + v.saldo, 0);
  if (!itens.length || total <= 0) {
    barra.innerHTML = '';
    if (leg) leg.innerHTML = '';
    return;
  }

  const paleta = typeof paletaCarteira === 'function' ? paletaCarteira() : {};
  const rotulo = (k) => (typeof ROTULOS_SUB !== 'undefined' && ROTULOS_SUB[k]) || k;
  barra.innerHTML = itens
    .map(([k, v], i) => {
      const perc = (v.saldo / total) * 100;
      const cor = paleta[k] || 'var(--cor-texto-mutado)';
      return (
        `<span class="inv-aloc-seg" style="width:${perc.toFixed(2)}%;background:${cor};` +
        `animation-delay:${i * 60}ms" title="${rotulo(k)} — ${perc.toFixed(1)}%"></span>`
      );
    })
    .join('');
  // Legenda só das três maiores: quatro linhas de legenda ocupam mais que o
  // próprio gráfico. O resto vira "+N".
  if (leg) {
    const topo = itens.slice(0, 3);
    let html = topo
      .map(([k, v]) => {
        const perc = (v.saldo / total) * 100;
        return (
          `<span><i style="background:${paleta[k] || 'var(--cor-texto-mutado)'}"></i>` +
          `${rotulo(k)} <b>${perc.toFixed(0)}%</b></span>`
        );
      })
      .join('');
    if (itens.length > topo.length)
      html += `<span style="opacity:.75">+${itens.length - topo.length}</span>`;
    leg.innerHTML = html;
  }
}

// Formata um valor para o display grande do saldo, com "R$" e os centavos
// tipograficamente rebaixados (ver .inv-moeda/.inv-cents). Escapa nada porque
// a entrada é numérica — o texto sai todo de formatarMoeda.
function moedaComCentavosDiscretos(valor) {
  const txt = formatarMoeda(valor);
  const m = txt.match(/^(R\$)\s*(.*?)([.,]\d{2})$/);
  if (!m) return txt;
  return (
    '<span class="inv-moeda">' +
    m[1] +
    '</span>' +
    m[2] +
    '<span class="inv-cents">' +
    m[3] +
    '</span>'
  );
}

function atualizarCarteiraAtivos() {
  const tbody = document.getElementById('tabelaCarteiraCorpo');
  const msgVazia = document.getElementById('carteiraVaziaMsg');
  tbody.innerHTML = '';
  const richContainer = document.getElementById('richRowsContainer');
  const datalistCarteira = document.getElementById('listaAtivosCarteira');
  datalistCarteira.innerHTML = '';
  let carteiraConsolidada = obterResumoCarteira();
  let totalAtivosValidos = 0;
  let totalGeralInvestido = 0;
  let saldoGeralAtual = 0;

  // First pass: compute totals
  const ativos = [];
  for (let ticker in carteiraConsolidada) {
    let ativo = carteiraConsolidada[ticker];
    if (ativo.qtdTotal <= 0) continue;
    let precoMedio = ativo.precoMedio;
    let ativoMercado = mockAtivosMercado.find((a) => a.ticker === ticker);
    let precoAtual = ativoMercado ? ativoMercado.preco_atual : precoMedio;
    let nomeAtivo = ativoMercado ? ativoMercado.nome : 'Ativo Personalizado';
    let saldoAtualAtivo = ativo.qtdTotal * precoAtual;
    if (ativo.categoria === 'previdencia') {
      saldoAtualAtivo = calcularSaldoPrevidencia(ticker);
      precoAtual = ativo.qtdTotal > 0 ? saldoAtualAtivo / ativo.qtdTotal : precoMedio;
    } else if (
      (ativo.categoria === 'renda_fixa' || ativo.categoria === 'reserva_emergencia') &&
      typeof valorAtualRendaFixa === 'function'
    ) {
      // Sem cotação de mercado: valoriza por juros compostos a partir da
      // rentabilidade contratada (110% CDI, IPCA+6%...). Mesmo cálculo do
      // Meu Patrimônio, para os dois números coincidirem.
      saldoAtualAtivo = valorAtualRendaFixa(ticker, ativo.categoria);
      precoAtual = ativo.qtdTotal > 0 ? saldoAtualAtivo / ativo.qtdTotal : precoMedio;
    }
    // Posição sem cotação totalmente resgatada (valor ~0) some da carteira.
    const semCotacao =
      ativo.categoria === 'renda_fixa' ||
      ativo.categoria === 'reserva_emergencia' ||
      ativo.categoria === 'previdencia';
    if (semCotacao && saldoAtualAtivo < 0.01) continue;
    totalAtivosValidos++;
    const option = document.createElement('option');
    option.value = ticker;
    option.text = `${nomeAtivo} - Saldo: ${formatarQtd(ativo.qtdTotal)} un.`;
    datalistCarteira.appendChild(option);
    let lucroR$ = saldoAtualAtivo - ativo.valorTotalInvestido;
    let lucroPerc = ativo.valorTotalInvestido > 0 ? (lucroR$ / ativo.valorTotalInvestido) * 100 : 0;
    totalGeralInvestido += ativo.valorTotalInvestido;
    saldoGeralAtual += saldoAtualAtivo;
    const categoriaEfetiva = inferirCategoria(ticker, ativo, ativoMercado);
    ativos.push({
      ticker,
      ativo,
      ativoMercado,
      precoMedio,
      precoAtual,
      nomeAtivo,
      saldoAtualAtivo,
      lucroR$,
      lucroPerc,
      categoriaEfetiva,
    });
  }

  // Rich rows: group by category
  const paleta = paletaCarteira();
  const ORDEM_CAT = ['renda_variavel', 'renda_fixa', 'previdencia', 'reserva_emergencia'];
  const ROTULOS_CAT_INLINE = {
    renda_variavel: 'Renda Variável',
    renda_fixa: 'Renda Fixa',
    previdencia: 'Previdência',
    reserva_emergencia: 'Reserva de Emergência',
  };
  const CORES_CAT = {
    renda_variavel: '#10b981',
    renda_fixa: '#6366f1',
    previdencia: '#f59e0b',
    reserva_emergencia: '#3b82f6',
  };

  let richHTML = '';
  let linhasRenderizadas = 0;

  ORDEM_CAT.forEach((cat) => {
    const grupo = ativos.filter((a) => {
      if (filtroCategoriaAtivo && a.categoriaEfetiva !== filtroCategoriaAtivo) return false;
      return a.categoriaEfetiva === cat;
    });
    if (grupo.length === 0) return;

    const subtotal = grupo.reduce((s, a) => s + a.saldoAtualAtivo, 0);
    const subInvestido = grupo.reduce((s, a) => s + a.ativo.valorTotalInvestido, 0);
    const subLucro = subtotal - subInvestido;
    const corCat = CORES_CAT[cat] || '#64748b';
    const sinalSub = subLucro >= 0 ? '+' : '';
    const corSub = subLucro >= 0 ? 'var(--cor-primaria)' : 'var(--cor-erro)';

    richHTML += `<div class="rich-category-header">
            <div style="display:flex;align-items:center;gap:10px;">
                <div class="cat-accent" style="background:${corCat};"></div>
                <span class="cat-label">${ROTULOS_CAT_INLINE[cat] || cat}</span>
                <span style="font-size:11px;color:var(--cor-texto-mutado);font-weight:500;">${grupo.length} ativo${grupo.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="cat-stats">
                <span class="valor-mascarado">${formatarMoeda(subtotal)}</span>
                <span style="color:${corSub};">${sinalSub}${formatarMoeda(subLucro)}</span>
            </div>
        </div>`;

    grupo.forEach(
      ({
        ticker,
        ativo,
        ativoMercado,
        precoMedio,
        precoAtual,
        nomeAtivo,
        saldoAtualAtivo,
        lucroR$,
        lucroPerc,
        categoriaEfetiva,
      }) => {
        linhasRenderizadas++;
        const corLucro = lucroR$ >= 0 ? 'var(--cor-primaria)' : 'var(--cor-erro)';
        const sinalLucro = lucroR$ >= 0 ? '+' : '';
        const allocPerc = saldoGeralAtual > 0 ? (saldoAtualAtivo / saldoGeralAtual) * 100 : 0;
        const semQtdAtivo =
          ativo.categoria === 'renda_fixa' ||
          ativo.categoria === 'reserva_emergencia' ||
          ativo.categoria === 'previdencia';
        const corretoraTag = ativo.corretora ? ` · ${ativo.corretora}` : '';
        let categoriaLbl =
          ROTULOS_CATEGORIA[ativo.categoria] ||
          (ativoMercado && ativoMercado.tipo === 'Renda Fixa' ? 'Renda Fixa' : 'Renda Variável');

        // Determine avatar color from subcategory
        const subcat = subcategoriaInferidaDoTicker(ticker);
        const avatarColors = {
          acoes: '#10b981',
          fiis: '#059669',
          bdrs: '#14b8a6',
          etfs: '#0d9488',
          cripto: '#f59e0b',
        };
        const avatarBg = avatarColors[subcat] || CORES_CAT[categoriaEfetiva] || '#64748b';
        const initial = ticker.substring(0, 2);

        // Extra info for RF
        let metaExtra = '';
        if (ativo.categoria === 'renda_fixa' || ativo.categoria === 'reserva_emergencia') {
          const partes = [];
          if (ativo.vencimento)
            partes.push(
              `Venc. ${new Date(ativo.vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}`
            );
          if (ativo.rentabilidade) partes.push(ativo.rentabilidade);
          if (partes.length) metaExtra = partes.join(' · ');
        }

        // A faixa de 3px à esquerda amarra carteira, timeline e dividendos numa
        // família visual só — e diz a classe do ativo sem gastar um rótulo.
        richHTML += `<div class="rich-row" style="--cor-acento-linha:${avatarBg};" onclick="toggleRichExpand('${ticker}')">
                <div class="rich-avatar" style="background:${avatarBg};color:${tintaSobre(avatarBg)};">${initial}</div>
                <div class="rich-row-info">
                    <div class="rich-ticker">${ticker}</div>
                    <div class="rich-nome">${nomeAtivo}</div>
                    <div class="rich-meta">
                        ${!semQtdAtivo ? `<span class="valor-mascarado">${formatarQtd(ativo.qtdTotal)} un</span>` : ''}
                        ${metaExtra ? `${!semQtdAtivo ? '· ' : ''}<span>${metaExtra}</span>` : ''}
                        <span class="rich-alloc-bar"><span class="rich-alloc-fill" style="width:${Math.min(allocPerc, 100)}%;background:${avatarBg};"></span></span>
                        <span>${allocPerc.toFixed(1)}%</span>
                    </div>
                </div>
                <div class="rich-pm">
                    <span class="rich-pm-label">Preço Médio</span>
                    <span class="rich-pm-valor">${formatarMoeda(precoMedio)}</span>
                </div>
                <div class="rich-saldo"><span class="valor-mascarado">${formatarMoeda(saldoAtualAtivo)}</span></div>
                <div class="rich-sparkline" id="spark_${ticker}"></div>
                <div class="rich-lucro">
                    <span class="rich-lucro-rs" style="color:${corLucro};">${sinalLucro}${formatarMoeda(lucroR$)}</span>
                    <span class="rich-lucro-pct" style="color:${corLucro};">${sinalLucro}${lucroPerc.toFixed(2)}%</span>
                </div>
                <div class="rich-acao">
                    <button class="rich-overflow" onclick="event.stopPropagation();mudarSubAbaPatrimonio('operacoes');document.getElementById('filtroOperacoesTicker').value='${ticker}';renderizarOperacoes();" title="Ver operações">
                        <i class="ph ph-arrow-right"></i>
                    </button>
                </div>
            </div>
            <div class="rich-expand" id="expand_${ticker}">
                <div class="rich-expand-grid">
                    <div class="rich-expand-stat"><div class="re-label">Investido</div><div class="re-value valor-mascarado">${formatarMoeda(ativo.valorTotalInvestido)}</div></div>
                    <div class="rich-expand-stat"><div class="re-label">Preço Médio</div><div class="re-value">${formatarMoeda(precoMedio)}</div></div>
                    <div class="rich-expand-stat"><div class="re-label">Preço Atual</div><div class="re-value">${formatarMoeda(precoAtual)}</div></div>
                    <div class="rich-expand-stat"><div class="re-label">Saldo</div><div class="re-value valor-mascarado">${formatarMoeda(saldoAtualAtivo)}</div></div>
                    <div class="rich-expand-stat"><div class="re-label">Resultado</div><div class="re-value" style="color:${corLucro};">${sinalLucro}${formatarMoeda(lucroR$)} (${sinalLucro}${lucroPerc.toFixed(2)}%)</div></div>
                </div>
                <div class="rich-expand-actions">
                    <button class="btn-secundario" style="font-size:11px;padding:5px 12px;color:var(--cor-erro);border-color:var(--cor-erro);" onclick="event.stopPropagation();iniciarResgate('${ticker}');"><i class="ph ph-hand-coins"></i> ${semQtdAtivo ? 'Resgatar' : 'Vender'}</button>
                    <button class="btn-secundario" style="font-size:11px;padding:5px 12px;" onclick="event.stopPropagation();mudarSubAbaPatrimonio('operacoes');document.getElementById('filtroOperacoesTicker').value='${ticker}';renderizarOperacoes();"><i class="ph ph-list-bullets"></i> Operações</button>
                    <button class="btn-secundario" style="font-size:11px;padding:5px 12px;" onclick="event.stopPropagation();mudarSubAbaPatrimonio('dividendos');filtrarDividendosPorAtivo('${ticker}');"><i class="ph ph-coins"></i> Dividendos</button>
                </div>
            </div>`;

        // Also populate hidden legacy table
        const ativoCell = `<div style="font-weight:600;">${ticker}</div><div style="font-size:11px;color:var(--cor-texto-secundario);">${nomeAtivo}</div>`;
        const qtdCell = semQtdAtivo ? '—' : formatarQtd(ativo.qtdTotal);
        tbody.innerHTML += `<tr><td>${ativoCell}</td><td style="text-align:right;font-family:'DM Mono',monospace;">${qtdCell}</td><td class="col-extra" style="text-align:right;">${formatarMoeda(precoMedio)}</td><td class="col-extra" style="text-align:right;">${formatarMoeda(precoAtual)}</td><td style="text-align:right;">${formatarMoeda(saldoAtualAtivo)}</td><td class="col-extra" style="text-align:right;">—</td><td style="text-align:right;color:${corLucro};">${sinalLucro}${lucroPerc.toFixed(2)}%</td></tr>`;
      }
    );
  });

  if (richContainer) richContainer.innerHTML = richHTML || '';
  // A mini-estatística é do que está NA TELA. Cravar 'carteira' aqui fazia com
  // que a chegada assíncrona das cotações reescrevesse a linha de quem estava
  // em Operações, Dividendos ou Futuro.
  atualizarMiniStats(
    typeof subAbaPatrimonioAtiva !== 'undefined' ? subAbaPatrimonioAtiva : 'carteira'
  );
  // Aviso de RF/Reserva sem rentabilidade (que não estão rendendo).
  if (typeof renderAvisoRentabilidadeRF === 'function') renderAvisoRentabilidadeRF();

  if (totalAtivosValidos === 0) {
    msgVazia.style.display = 'block';
    msgVazia.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon" style="background: #ecfdf5;"><i class="ph ph-wallet" style="font-size: 26px; color: var(--cor-primaria);"></i></div>
            <div class="empty-state-titulo">Carteira ainda vazia</div>
            <div class="empty-state-sub">Registre sua primeira compra de ativo acima<br>e acompanhe sua rentabilidade em tempo real.</div>
        </div>`;
    atualizarKPIsResumo(carteiraConsolidada);
    atualizarBarraAlocacao(carteiraConsolidada);
    return;
  }
  if (linhasRenderizadas === 0 && filtroCategoriaAtivo) {
    msgVazia.style.display = 'block';
    msgVazia.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon" style="background: var(--cor-superficie);"><i class="ph ph-funnel" style="font-size: 26px; color: var(--cor-texto-secundario);"></i></div>
            <div class="empty-state-titulo">Nenhum ativo nesta categoria</div>
            <div class="empty-state-sub">Selecione "Tudo" ou outra categoria nos filtros acima.</div>
        </div>`;
  } else {
    msgVazia.style.display = 'none';
  }

  // KPIs do hero — respeitam os filtros (tipo + ativo) do bloco Evolução.
  atualizarKPIsResumo(carteiraConsolidada);

  atualizarBarraAlocacao(carteiraConsolidada);
  atualizarProximoEvento(carteiraConsolidada);
}
