/**
 * Appliquei — Relatório Mensal (BI consolidado, PDF export).
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script, carregado
 * DEPOIS de app.js porque consome historicoCompras (state global) e
 * usa formatarMoeda. O export do relatório usa o motor de impressão nativo
 * do navegador (janela dedicada + window.print → "Salvar como PDF").
 *
 * Inclui helpers visuais e 3 gráficos premium (fluxo, patrimônio, donut).
 */

// === RELATÓRIO MENSAL — BI consolidado                       ===
// ============================================================
var RM_NOMES_MESES_LONG = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];
var RM_NOMES_MESES_SHORT = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

function rmYyyymmToMesAno(yyyymm) {
  const [a, m] = (yyyymm || '').split('-').map(Number);
  return { mes: (m || 1) - 1, ano: a || 0 };
}
function rmMesAnoToYyyymm(mes, ano) {
  return ano + '-' + String(mes + 1).padStart(2, '0');
}
function rmFormatarMesLabel(yyyymm) {
  const { mes, ano } = rmYyyymmToMesAno(yyyymm);
  return RM_NOMES_MESES_LONG[mes] + '/' + ano;
}
function rmAddMonths(yyyymm, delta) {
  const { mes, ano } = rmYyyymmToMesAno(yyyymm);
  const d = new Date(ano, mes + delta, 1);
  return rmMesAnoToYyyymm(d.getMonth(), d.getFullYear());
}
function rmMesEhFuturo(yyyymm) {
  const hoje = new Date();
  const cur = rmMesAnoToYyyymm(hoje.getMonth(), hoje.getFullYear());
  return yyyymm > cur;
}

// Constrói o objeto bruto do mês a partir das fontes existentes
function buildMonthlyReport(yyyymm) {
  const { mes, ano } = rmYyyymmToMesAno(yyyymm);
  const r =
    typeof calcularResumoMes === 'function'
      ? calcularResumoMes(mes, ano)
      : {
          receita: 0,
          resgate: 0,
          despFixa: 0,
          despVar: 0,
          cartao: 0,
          invFixo: 0,
          invVar: 0,
          sonho: 0,
        };

  const entradas = (r.receita || 0) + (r.resgate || 0);
  const despesasContas = (r.despFixa || 0) + (r.despVar || 0) + (r.cartao || 0) + (r.sonho || 0);
  const investimentos = (r.invFixo || 0) + (r.invVar || 0);
  // `despesasContas` = gastos de consumo (usado nos cards/gráfico de "Despesa").
  // `despesasTotais` = todo o dinheiro que saiu do caixa (consumo + aportes),
  // usado apenas no saldo do mês — aportes NÃO devem aparecer como despesa.
  const despesasTotais = despesasContas + investimentos;
  const saldoFinal = entradas - despesasTotais;

  // Patrimônio (snapshot do mês)
  let patrimonioAplicado = 0,
    patrimonioMercado = 0;
  try {
    const snaps =
      typeof carregarSnapshotsCarteira === 'function' ? carregarSnapshotsCarteira() : {};
    const snap = snaps[yyyymm];
    if (snap) {
      patrimonioAplicado = snap.investidoTotal || 0;
      patrimonioMercado = snap.saldoTotal || 0;
    }
  } catch (_) {}

  // Dividendos do mês (usa cacheDividendos se disponível)
  let dividendos = 0;
  try {
    if (
      typeof cacheDividendos !== 'undefined' &&
      cacheDividendos &&
      typeof historicoCompras !== 'undefined'
    ) {
      const iniMs = new Date(ano, mes, 1).getTime();
      const fimMs = new Date(ano, mes + 1, 0, 23, 59, 59).getTime();
      const tickers = new Set(historicoCompras.map((o) => o.ticker).filter(Boolean));
      tickers.forEach((ticker) => {
        const cache = cacheDividendos[ticker];
        if (!cache || !cache.pagamentos) return;
        cache.pagamentos.forEach((p) => {
          if (!p.data) return;
          const ts = new Date(p.data.length === 10 ? p.data + 'T12:00:00' : p.data).getTime();
          if (ts < iniMs || ts > fimMs) return;
          // Quantidade na data do pagamento
          let qtd = 0;
          historicoCompras.forEach((op) => {
            if (op.ticker !== ticker || !op.data) return;
            const tsOp = new Date(op.data).getTime();
            if (tsOp > ts) return;
            if (op.tipo === 'compra') qtd += op.qtd || 0;
            else if (op.tipo === 'venda') qtd -= op.qtd || 0;
          });
          if (qtd > 0) dividendos += qtd * (p.valor || 0);
        });
      });
    }
  } catch (_) {}

  // Sonhos — progresso médio dos sonhos ativos
  let sonhosAtivos = 0,
    sonhosNoPrazo = 0,
    sonhosProgressoMedio = 0,
    sonhosLista = [];
  try {
    const lista = JSON.parse(localStorage.getItem('appliquei_sonhos') || '[]');
    lista.forEach((s) => {
      const valTot = s.valorTotal || 0;
      const valAtu = s.valorAtual || 0;
      if (valTot <= 0) return;
      const pct = Math.min(100, (valAtu / valTot) * 100);
      sonhosAtivos += 1;
      sonhosProgressoMedio += pct;
      // "No prazo" = pct atual >= % de tempo decorrido
      const prazo = s.prazoMeses || 12;
      const mesesPassados = Math.max(0, prazo - (s.mesesRestantes || 0));
      const pctTempo = (mesesPassados / prazo) * 100;
      if (pct >= pctTempo - 5) sonhosNoPrazo += 1; // 5% de tolerância
      sonhosLista.push({ nome: s.nome || 'Sonho', pct, prazo, mesesRestantes: s.mesesRestantes });
    });
    if (sonhosAtivos > 0) sonhosProgressoMedio = sonhosProgressoMedio / sonhosAtivos;
  } catch (_) {}

  // Jornada — módulos concluídos no mês
  const jornadaModulosMes = jornadaModulosConcluidosNoMes(yyyymm);

  // Applicash — indicações ativas + receita estimada
  let applicashIndicacoes = 0,
    applicashReceita = 0;
  try {
    const inds = JSON.parse(localStorage.getItem('appliquei_applicash_indicacoes') || '[]');
    const ativos = inds.filter((i) => i.status === 'ativo');
    applicashIndicacoes = ativos.length;
    applicashReceita = ativos.reduce((acc, i) => acc + (i.valorPago || 0) * 0.1, 0);
  } catch (_) {}

  return {
    yyyymm,
    mes,
    ano,
    label: rmFormatarMesLabel(yyyymm),
    entradas,
    receita: r.receita || 0,
    resgate: r.resgate || 0,
    despesasContas,
    despesasTotais,
    investimentos,
    saldoFinal,
    pctDespesas: entradas > 0 ? (despesasContas / entradas) * 100 : 0,
    pctInvestimentos: entradas > 0 ? (investimentos / entradas) * 100 : 0,
    patrimonioAplicado,
    patrimonioMercado,
    patrimonioGanho: patrimonioMercado - patrimonioAplicado,
    dividendos,
    sonhos: {
      ativos: sonhosAtivos,
      noPrazo: sonhosNoPrazo,
      progressoMedio: sonhosProgressoMedio,
      lista: sonhosLista,
    },
    jornadaModulosMes,
    applicash: { indicacoes: applicashIndicacoes, receita: applicashReceita },
    hasData:
      entradas +
        despesasTotais +
        patrimonioMercado +
        dividendos +
        sonhosAtivos +
        jornadaModulosMes +
        applicashIndicacoes >
      0,
  };
}

// Termômetro — 5 critérios → score 0-100 + status por critério
function rmCalcularTermometro(rep) {
  const criterios = [];
  // 1. Despesas ≤ 60% (verde), 60-75% (amarelo), >75% (vermelho)
  const cDesp = rep.pctDespesas;
  let stDesp = 'verde';
  if (rep.entradas === 0) stDesp = 'cinza';
  else if (cDesp > 75) stDesp = 'vermelho';
  else if (cDesp > 60) stDesp = 'amarelo';
  criterios.push({
    label: 'Despesas ≤ 60% da entrada',
    valor: rep.entradas > 0 ? cDesp.toFixed(1) + '%' : '—',
    meta: '≤ 60%',
    status: stDesp,
    icone: 'ph-receipt',
  });
  // 2. Investimentos ≥ 30% (verde), 20-30% (amarelo), <20% (vermelho)
  const cInv = rep.pctInvestimentos;
  let stInv = 'verde';
  if (rep.entradas === 0) stInv = 'cinza';
  else if (cInv < 20) stInv = 'vermelho';
  else if (cInv < 30) stInv = 'amarelo';
  criterios.push({
    label: 'Investimentos ≥ 30% da entrada',
    valor: rep.entradas > 0 ? cInv.toFixed(1) + '%' : '—',
    meta: '≥ 30%',
    status: stInv,
    icone: 'ph-trending-up',
  });
  // 3. Sonhos no prazo: ≥80% no prazo (verde), 50-80% (amarelo), <50% (vermelho)
  let stSon = 'cinza';
  let pctSon = 0;
  if (rep.sonhos.ativos > 0) {
    pctSon = (rep.sonhos.noPrazo / rep.sonhos.ativos) * 100;
    if (pctSon < 50) stSon = 'vermelho';
    else if (pctSon < 80) stSon = 'amarelo';
    else stSon = 'verde';
  }
  criterios.push({
    label: 'Sonhos no prazo',
    valor: rep.sonhos.ativos > 0 ? rep.sonhos.noPrazo + '/' + rep.sonhos.ativos : 'Sem sonhos',
    meta: '≥ 80%',
    status: stSon,
    icone: 'ph-shooting-star',
  });
  // 4. Jornada: ≥1 módulo (verde) senão vermelho
  const stJor = rep.jornadaModulosMes >= 1 ? 'verde' : 'vermelho';
  criterios.push({
    label: 'Jornada Financeira',
    valor: rep.jornadaModulosMes + ' módulo(s)',
    meta: '≥ 1/mês',
    status: stJor,
    icone: 'ph-graduation-cap',
  });
  // 5. Applicash: ≥2 (verde), 1 (amarelo), 0 (vermelho)
  let stApp = 'vermelho';
  if (rep.applicash.indicacoes >= 2) stApp = 'verde';
  else if (rep.applicash.indicacoes === 1) stApp = 'amarelo';
  criterios.push({
    label: 'Applicash — indicações ativas',
    valor: rep.applicash.indicacoes + ' ativa(s)',
    meta: '≥ 2',
    status: stApp,
    icone: 'ph-currency-dollar',
  });

  // Score = média ponderada (cada critério vale 20 pontos; verde=100%, amarelo=50%, vermelho=0%, cinza=neutro)
  const pesos = { verde: 100, amarelo: 50, vermelho: 0, cinza: 50 };
  let score = 0,
    pontosVal = 0;
  criterios.forEach((c) => {
    score += pesos[c.status];
    pontosVal += 1;
  });
  const finalScore = pontosVal > 0 ? Math.round(score / pontosVal) : 0;
  let statusGeral = 'verde';
  if (finalScore < 40) statusGeral = 'vermelho';
  else if (finalScore < 70) statusGeral = 'amarelo';
  return { criterios, score: finalScore, statusGeral };
}

function rmCorStatus(s) {
  if (s === 'verde')
    return {
      bg: 'var(--cor-bg-primaria)',
      borda: 'var(--cor-borda-primaria)',
      txt: 'var(--cor-txt-primaria)',
      dot: '#10b981',
    };
  if (s === 'amarelo') return { bg: '#fffbeb', borda: '#fcd34d', txt: '#92400e', dot: '#f59e0b' };
  if (s === 'vermelho') return { bg: '#fef2f2', borda: '#fecaca', txt: '#991b1b', dot: '#ef4444' };
  return {
    bg: 'var(--cor-superficie)',
    borda: 'var(--cor-borda)',
    txt: 'var(--cor-texto-mutado)',
    dot: '#94a3b8',
  };
}

// ====== Helpers visuais ======
function rmFormatarMoedaCompacta(v) {
  const abs = Math.abs(v || 0);
  if (abs >= 1e6) return 'R$ ' + (v / 1e6).toFixed(1).replace('.', ',') + 'M';
  if (abs >= 1e3) return 'R$ ' + (v / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace('.', ',') + 'k';
  return 'R$ ' + (v || 0).toFixed(0);
}

function rmSparklineSvg(values, opts) {
  opts = opts || {};
  const w = opts.width || 240;
  const h = opts.height || 56;
  const pad = 4;
  if (!values || values.length < 2) return '';
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const dx = (w - pad * 2) / (values.length - 1);
  const y = (v) => h - pad - ((v - min) / range) * (h - pad * 2);
  const pts = values.map((v, i) => [pad + i * dx, y(v)]);
  // Smooth path com curva quadrática
  let d = 'M ' + pts[0][0] + ' ' + pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1],
      p1 = pts[i];
    const mx = (p0[0] + p1[0]) / 2;
    d += ' Q ' + mx + ' ' + p0[1] + ' ' + mx + ' ' + (p0[1] + p1[1]) / 2;
    d += ' T ' + p1[0] + ' ' + p1[1];
  }
  const area = d + ' L ' + pts[pts.length - 1][0] + ' ' + h + ' L ' + pts[0][0] + ' ' + h + ' Z';
  const gradId = 'rmsg_' + Math.random().toString(36).slice(2, 8);
  return (
    '<svg viewBox="0 0 ' +
    w +
    ' ' +
    h +
    '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><linearGradient id="' +
    gradId +
    '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="var(--rm-kpi-fill-from)"/>' +
    '<stop offset="100%" stop-color="var(--rm-kpi-fill-to)"/>' +
    '</linearGradient></defs>' +
    '<path d="' +
    area +
    '" fill="url(#' +
    gradId +
    ')"/>' +
    '<path d="' +
    d +
    '" fill="none" stroke="var(--rm-kpi-stroke)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' +
    pts[pts.length - 1][0] +
    '" cy="' +
    pts[pts.length - 1][1] +
    '" r="3" fill="var(--rm-kpi-stroke)" stroke="#fff" stroke-width="1.5"/>' +
    '</svg>'
  );
}

function rmDeltaHtml(valorA, valorB, mesBLabel) {
  if (valorB === null || valorB === undefined) return '';
  const delta = valorA - valorB;
  const pct = valorB !== 0 ? (delta / Math.abs(valorB)) * 100 : delta !== 0 ? 100 : 0;
  const cls = Math.abs(pct) < 0.1 ? 'neu' : delta > 0 ? 'pos' : 'neg';
  const seta = Math.abs(pct) < 0.1 ? '·' : delta > 0 ? '▲' : '▼';
  const mesShort = (mesBLabel || '').split('/')[0];
  return (
    '<div class="rm-kpi-delta ' +
    cls +
    '">' +
    seta +
    ' ' +
    (pct >= 0 ? '+' : '') +
    pct.toFixed(1) +
    '% <span style="color:var(--cor-texto-mutado);font-weight:600;">vs ' +
    mesShort +
    '</span></div>'
  );
}

// SVG gauge — atualiza arc + pointer
function rmAtualizarGauge(score, statusGeral) {
  const path = document.getElementById('rmGaugePath');
  const pointer = document.getElementById('rmGaugePointer');
  if (path) {
    const pct = Math.max(0, Math.min(100, score)) / 100;
    const total = 283; // ~ length aprox do arco
    path.setAttribute('stroke-dashoffset', String(total - total * pct));
  }
  if (pointer) {
    const ang = -90 + (Math.max(0, Math.min(100, score)) / 100) * 180;
    pointer.setAttribute('transform', 'rotate(' + ang + ' 110 110)');
  }
  // Cor do score numérico
  const scoreEl = document.getElementById('rmTermometroScore');
  const statusEl = document.getElementById('rmTermometroStatus');
  const cores = rmCorStatus(statusGeral);
  if (scoreEl) scoreEl.style.color = cores.dot;
  if (statusEl) {
    statusEl.style.color = cores.dot;
    statusEl.innerText =
      statusGeral === 'verde'
        ? 'Saudável'
        : statusGeral === 'amarelo'
          ? 'Atenção'
          : statusGeral === 'vermelho'
            ? 'Crítico'
            : 'Aguardando';
  }
}

// Termômetro UI: hero + criterios strip
function rmRenderTermometro(rep, repB) {
  const t = rmCalcularTermometro(rep);
  const cores = rmCorStatus(t.statusGeral);

  const scoreEl = document.getElementById('rmTermometroScore');
  if (scoreEl) scoreEl.innerText = t.score;
  rmAtualizarGauge(t.score, t.statusGeral);

  const mesLbl = document.getElementById('rmHeroMesLabel');
  if (mesLbl) mesLbl.innerText = rep.label.toUpperCase();

  const resumo = document.getElementById('rmTermometroResumo');
  if (resumo) {
    let txt = '';
    if (t.statusGeral === 'verde')
      txt =
        '<strong>Saudável.</strong> Você está cumprindo a maior parte dos pilares deste mês. Mantenha o ritmo.';
    else if (t.statusGeral === 'amarelo')
      txt =
        '<strong>Atenção.</strong> Alguns critérios estão fora do alvo — ajuste antes que vire tendência.';
    else
      txt =
        '<strong>Crítico.</strong> Vários pilares fora do alvo. Foque em revisar despesas e retomar aportes.';
    resumo.innerHTML = txt + ' Score ponderado dos 5 critérios abaixo.';
  }

  // Saldo e patrimônio nos hero stats
  const saldoEl = document.getElementById('rmHeroSaldo');
  if (saldoEl) {
    saldoEl.innerText = formatarMoeda(rep.saldoFinal);
    saldoEl.style.color = rep.saldoFinal >= 0 ? 'var(--rm-verde)' : 'var(--rm-vermelho)';
  }
  const patEl = document.getElementById('rmHeroPatrimonio');
  if (patEl) patEl.innerText = formatarMoeda(rep.patrimonioMercado);

  const saldoDeltaEl = document.getElementById('rmHeroSaldoDelta');
  const patDeltaEl = document.getElementById('rmHeroPatrimonioDelta');
  if (saldoDeltaEl)
    saldoDeltaEl.innerHTML = repB
      ? rmDeltaHtml(rep.saldoFinal, repB.saldoFinal, repB.label).replace(
          'rm-kpi-delta',
          'rm-kpi-delta'
        )
      : '';
  if (patDeltaEl)
    patDeltaEl.innerHTML = repB
      ? rmDeltaHtml(rep.patrimonioMercado, repB.patrimonioMercado, repB.label).replace(
          'rm-kpi-delta',
          'rm-kpi-delta'
        )
      : '';

  // Strip de critérios
  const grid = document.getElementById('rmTermometroCriterios');
  if (grid) {
    const badgeTxt = (s) =>
      s === 'verde' ? 'OK' : s === 'amarelo' ? 'ATENÇÃO' : s === 'vermelho' ? 'FORA' : '—';
    grid.innerHTML = t.criterios
      .map(
        (c) =>
          '<div class="rm-criterio" data-status="' +
          c.status +
          '">' +
          '<div class="rm-criterio-top">' +
          '<div class="rm-criterio-icon"><i class="ph-fill ' +
          c.icone +
          '"></i></div>' +
          '<span class="rm-criterio-badge">' +
          badgeTxt(c.status) +
          '</span>' +
          '</div>' +
          '<div class="rm-criterio-label">' +
          c.label +
          '</div>' +
          '<div class="rm-criterio-valor">' +
          c.valor +
          '</div>' +
          '<div class="rm-criterio-meta">Meta: ' +
          c.meta +
          '</div>' +
          '</div>'
      )
      .join('');
  }
}

// Cards KPI (4 secundários com sparkline)
function rmRenderKpis(rep, repB, serie12) {
  const grid = document.getElementById('rmKpisGrid');
  if (!grid) return;
  const items = [
    {
      tipo: 'entradas',
      label: 'Entradas',
      valor: rep.entradas,
      valorB: repB ? repB.entradas : null,
      icone: 'ph-arrow-down-left',
      spark: serie12.entradas,
    },
    {
      tipo: 'despesas',
      label: 'Despesas totais',
      valor: rep.despesasContas,
      valorB: repB ? repB.despesasContas : null,
      icone: 'ph-arrow-up-right',
      spark: serie12.despesas,
    },
    {
      tipo: 'investimentos',
      label: 'Investimentos',
      valor: rep.investimentos,
      valorB: repB ? repB.investimentos : null,
      icone: 'ph-trending-up',
      spark: serie12.investimentos,
    },
    {
      tipo: 'dividendos',
      label: 'Dividendos do mês',
      valor: rep.dividendos,
      valorB: repB ? repB.dividendos : null,
      icone: 'ph-coins',
      spark: serie12.dividendos,
    },
  ];
  grid.innerHTML = items
    .map(
      (it) =>
        '<div class="rm-kpi" data-tipo="' +
        it.tipo +
        '">' +
        '<div class="rm-kpi-top">' +
        '<span class="rm-kpi-label">' +
        it.label +
        '</span>' +
        '<div class="rm-kpi-icone"><i class="ph-fill ' +
        it.icone +
        '"></i></div>' +
        '</div>' +
        '<div class="rm-kpi-valor valor-mascarado">' +
        formatarMoeda(it.valor) +
        '</div>' +
        rmDeltaHtml(it.valor, it.valorB, repB ? repB.label : '') +
        '<div class="rm-kpi-spark">' +
        rmSparklineSvg(it.spark) +
        '</div>' +
        '</div>'
    )
    .join('');
}

// Cards secundários (Sonhos, Jornada, Applicash) — premium
function rmRenderSecundarios(rep) {
  const grid = document.getElementById('rmSecundariosGrid');
  if (!grid) return;

  // === Sonhos ===
  const sonhosBody =
    rep.sonhos.ativos === 0
      ? '<div style="text-align:center;padding:8px 0;font-size:13px;color:var(--cor-texto-mutado);"><i class="ph ph-shooting-star" style="font-size:28px;display:block;margin:0 auto 8px;opacity:0.4;"></i>Nenhum sonho cadastrado.</div>'
      : '<div class="rm-sec-kpi-row">' +
        '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num">' +
        rep.sonhos.ativos +
        '</div><div class="rm-sec-kpi-label">Ativos</div></div>' +
        '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num" style="color:var(--rm-verde);">' +
        rep.sonhos.noPrazo +
        '</div><div class="rm-sec-kpi-label">No prazo</div></div>' +
        '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num" style="color:var(--rm-roxo);">' +
        rep.sonhos.progressoMedio.toFixed(0) +
        '%</div><div class="rm-sec-kpi-label">Progresso</div></div>' +
        '</div>' +
        rep.sonhos.lista
          .slice(0, 3)
          .map(
            (s) =>
              '<div style="margin-bottom:10px;">' +
              '<div class="rm-sec-meta-row"><span style="color:var(--cor-texto-principal);font-weight:600;">' +
              (s.nome || 'Sonho') +
              '</span><span style="font-family:\'DM Mono\',monospace;color:var(--cor-texto-mutado);font-size:11.5px;">' +
              s.pct.toFixed(0) +
              '%</span></div>' +
              '<div class="rm-sec-bar"><div class="rm-sec-bar-fill" style="width:' +
              Math.min(100, s.pct) +
              '%;background:linear-gradient(90deg,var(--rm-verde),#34d399);"></div></div>' +
              '</div>'
          )
          .join('') +
        (rep.sonhos.lista.length > 3
          ? '<div style="font-size:11px;color:var(--cor-texto-mutado);text-align:center;margin-top:6px;">+ ' +
            (rep.sonhos.lista.length - 3) +
            ' sonho(s)</div>'
          : '');
  const sonhosHtml =
    '<div class="rm-sec-card" data-tipo="sonhos">' +
    '<div class="rm-sec-header"><div class="rm-sec-header-row">' +
    '<div class="rm-sec-header-icon"><i class="ph-fill ph-shooting-star"></i></div>' +
    '<div><div class="rm-sec-header-title">Meus sonhos</div><div class="rm-sec-header-sub">Metas em andamento</div></div>' +
    '</div></div>' +
    '<div class="rm-sec-body">' +
    sonhosBody +
    '</div></div>';

  // === Jornada ===
  const totalMods = JORNADA_MODULOS.length;
  const prog = carregarJornadaProgresso();
  const concluidosTotal = JORNADA_MODULOS.filter(
    (m) => prog[m.id] && prog[m.id].concluidoEm
  ).length;
  const pctTrilha = totalMods ? (concluidosTotal / totalMods) * 100 : 0;
  const tagJornada =
    rep.jornadaModulosMes >= 1
      ? '<span class="rm-sec-tag ok"><i class="ph-bold ph-check-circle"></i> Meta do mês atingida</span>'
      : '<span class="rm-sec-tag bad"><i class="ph-bold ph-warning"></i> Sem módulo no mês</span>';
  const jornadaHtml =
    '<div class="rm-sec-card" data-tipo="jornada">' +
    '<div class="rm-sec-header"><div class="rm-sec-header-row">' +
    '<div class="rm-sec-header-icon"><i class="ph-fill ph-graduation-cap"></i></div>' +
    '<div><div class="rm-sec-header-title">Jornada Financeira</div><div class="rm-sec-header-sub">Capacitação prática</div></div>' +
    '</div></div>' +
    '<div class="rm-sec-body">' +
    '<div class="rm-sec-kpi-row">' +
    '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num" style="color:var(--rm-roxo);">' +
    rep.jornadaModulosMes +
    '</div><div class="rm-sec-kpi-label">No mês</div></div>' +
    '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num">' +
    concluidosTotal +
    '/' +
    totalMods +
    '</div><div class="rm-sec-kpi-label">Trilha geral</div></div>' +
    '</div>' +
    '<div class="rm-sec-meta-row"><span style="color:var(--cor-texto-mutado);">Progresso da trilha</span><span style="font-family:\'DM Mono\',monospace;color:var(--rm-roxo);font-weight:700;font-size:11.5px;">' +
    pctTrilha.toFixed(0) +
    '%</span></div>' +
    '<div class="rm-sec-bar" style="margin-bottom:12px;"><div class="rm-sec-bar-fill" style="width:' +
    pctTrilha +
    '%;background:linear-gradient(90deg,var(--rm-roxo),#a78bfa);"></div></div>' +
    tagJornada +
    '</div></div>';

  // === Applicash ===
  const tagApp =
    rep.applicash.indicacoes >= 2
      ? '<span class="rm-sec-tag ok"><i class="ph-bold ph-check-circle"></i> Meta atingida (≥2)</span>'
      : rep.applicash.indicacoes === 1
        ? '<span class="rm-sec-tag warn"><i class="ph-bold ph-arrow-up"></i> Quase lá</span>'
        : '<span class="rm-sec-tag bad"><i class="ph-bold ph-warning"></i> Sem indicações ativas</span>';
  const appHtml =
    '<div class="rm-sec-card" data-tipo="applicash">' +
    '<div class="rm-sec-header"><div class="rm-sec-header-row">' +
    '<div class="rm-sec-header-icon"><i class="ph-fill ph-currency-dollar"></i></div>' +
    '<div><div class="rm-sec-header-title">Applicash $</div><div class="rm-sec-header-sub">Programa de indicações</div></div>' +
    '</div></div>' +
    '<div class="rm-sec-body">' +
    '<div class="rm-sec-kpi-row">' +
    '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num" style="color:var(--rm-azul);">' +
    rep.applicash.indicacoes +
    '</div><div class="rm-sec-kpi-label">Ativas</div></div>' +
    '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num valor-mascarado" style="font-size:18px;color:var(--rm-azul);">' +
    formatarMoeda(rep.applicash.receita) +
    '</div><div class="rm-sec-kpi-label">Cashback</div></div>' +
    '</div>' +
    tagApp +
    '</div></div>';

  grid.innerHTML = sonhosHtml + jornadaHtml + appHtml;
}

// ====== Gráficos premium ======
var rmChartSerieInst = null;
var rmChartPatrimonioInst = null;
var rmChartDonutInst = null;

function rmGradient(ctx, area, hexFrom, hexTo) {
  if (!ctx || !area) return hexFrom;
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, hexFrom);
  g.addColorStop(1, hexTo);
  return g;
}

function rmRenderGraficos(yyyymmAtual, rep) {
  // Coleta série de 12 meses
  const labels = [];
  const arrEntr = [],
    arrDesp = [],
    arrInv = [],
    arrDiv = [],
    arrAplic = [],
    arrMerc = [];
  for (let i = 11; i >= 0; i--) {
    const ym = rmAddMonths(yyyymmAtual, -i);
    const { mes, ano } = rmYyyymmToMesAno(ym);
    labels.push(RM_NOMES_MESES_SHORT[mes] + '/' + String(ano).slice(2));
    const r = buildMonthlyReport(ym);
    arrEntr.push(r.entradas);
    arrDesp.push(r.despesasContas);
    arrInv.push(r.investimentos);
    arrDiv.push(r.dividendos);
    arrAplic.push(r.patrimonioAplicado);
    arrMerc.push(r.patrimonioMercado);
  }
  const serie12 = {
    entradas: arrEntr,
    despesas: arrDesp,
    investimentos: arrInv,
    dividendos: arrDiv,
    aplicado: arrAplic,
    mercado: arrMerc,
  };

  // Legenda do fluxo (HTML)
  const leg = document.getElementById('rmFluxoLegenda');
  if (leg)
    leg.innerHTML = [
      { lbl: 'Entradas', cor: '#10b981' },
      { lbl: 'Despesas', cor: '#ef4444' },
      { lbl: 'Investimentos', cor: '#7c3aed' },
    ]
      .map(
        (l) =>
          '<div class="rm-chart-legend-item"><span class="rm-chart-legend-dot" style="--dot-cor:' +
          l.cor +
          ';"></span>' +
          l.lbl +
          '</div>'
      )
      .join('');

  // ===== Fluxo (linhas com gradient area) =====
  const ctx1 = document.getElementById('rmChartSerie');
  if (ctx1 && window.Chart) {
    if (rmChartSerieInst)
      try {
        rmChartSerieInst.destroy();
      } catch (_) {}
    rmChartSerieInst = new Chart(ctx1.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Entradas',
            data: arrEntr,
            borderColor: '#10b981',
            backgroundColor: (ctx) =>
              rmGradient(
                ctx.chart.ctx,
                ctx.chart.chartArea,
                'rgba(16,185,129,0.30)',
                'rgba(16,185,129,0)'
              ),
            fill: true,
            tension: 0.4,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: '#10b981',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
          },
          {
            label: 'Despesas',
            data: arrDesp,
            borderColor: '#ef4444',
            backgroundColor: (ctx) =>
              rmGradient(
                ctx.chart.ctx,
                ctx.chart.chartArea,
                'rgba(239,68,68,0.22)',
                'rgba(239,68,68,0)'
              ),
            fill: true,
            tension: 0.4,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: '#ef4444',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
          },
          {
            label: 'Investimentos',
            data: arrInv,
            borderColor: '#7c3aed',
            backgroundColor: (ctx) =>
              rmGradient(
                ctx.chart.ctx,
                ctx.chart.chartArea,
                'rgba(124,58,237,0.22)',
                'rgba(124,58,237,0)'
              ),
            fill: true,
            tension: 0.4,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: '#7c3aed',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
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
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.95)',
            titleColor: '#fff',
            bodyColor: '#e2e8f0',
            padding: 12,
            cornerRadius: 10,
            displayColors: true,
            boxPadding: 4,
            titleFont: { size: 12, weight: 'bold' },
            bodyFont: { size: 12 },
            callbacks: { label: (c) => '  ' + c.dataset.label + ': ' + formatarMoeda(c.parsed.y) },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(148,163,184,0.15)', drawBorder: false },
            ticks: {
              callback: (v) => rmFormatarMoedaCompacta(v),
              font: { size: 10.5 },
              color: '#94a3b8',
              padding: 8,
            },
          },
          x: {
            grid: { display: false },
            ticks: { font: { size: 10.5, weight: '600' }, color: '#64748b' },
          },
        },
      },
    });
  }

  // ===== Patrimônio (área aplicado + área mercado por cima) =====
  const ctx2 = document.getElementById('rmChartPatrimonio');
  if (ctx2 && window.Chart) {
    if (rmChartPatrimonioInst)
      try {
        rmChartPatrimonioInst.destroy();
      } catch (_) {}
    rmChartPatrimonioInst = new Chart(ctx2.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Valor de mercado',
            data: arrMerc,
            borderColor: '#10b981',
            backgroundColor: (ctx) =>
              rmGradient(
                ctx.chart.ctx,
                ctx.chart.chartArea,
                'rgba(16,185,129,0.30)',
                'rgba(16,185,129,0)'
              ),
            fill: true,
            tension: 0.4,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: '#10b981',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
          },
          {
            label: 'Valor aplicado',
            data: arrAplic,
            borderColor: '#7c3aed',
            borderDash: [4, 4],
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: '#7c3aed',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              font: { size: 11, weight: '600' },
              color: '#64748b',
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 14,
            },
          },
          datalabels: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.95)',
            titleColor: '#fff',
            bodyColor: '#e2e8f0',
            padding: 12,
            cornerRadius: 10,
            displayColors: true,
            boxPadding: 4,
            callbacks: { label: (c) => '  ' + c.dataset.label + ': ' + formatarMoeda(c.parsed.y) },
          },
        },
        scales: {
          y: {
            beginAtZero: false,
            grid: { color: 'rgba(148,163,184,0.15)' },
            ticks: {
              callback: (v) => rmFormatarMoedaCompacta(v),
              font: { size: 10.5 },
              color: '#94a3b8',
              padding: 8,
            },
          },
          x: {
            grid: { display: false },
            ticks: { font: { size: 10.5, weight: '600' }, color: '#64748b' },
          },
        },
      },
    });
  }
  // Pill de variação no header do gráfico de patrimônio
  const pill = document.getElementById('rmPatrimonioVariacao');
  if (pill) {
    const ganho = (rep.patrimonioMercado || 0) - (rep.patrimonioAplicado || 0);
    if (rep.patrimonioAplicado > 0) {
      const pct = (ganho / rep.patrimonioAplicado) * 100;
      pill.className = 'rm-chart-pill ' + (ganho < 0 ? 'neg' : '');
      pill.innerHTML = (ganho >= 0 ? '▲ +' : '▼ ') + pct.toFixed(1) + '%';
      pill.style.display = '';
    } else {
      pill.style.display = 'none';
    }
  }

  // ===== Donut: para onde foi o dinheiro =====
  rmRenderDonut(rep);

  return serie12;
}

function rmRenderDonut(rep) {
  const ctx = document.getElementById('rmChartDonut');
  if (!ctx) return;
  // Reconstrói categorias a partir de transações do mês
  const slices = [];
  try {
    const r =
      typeof calcularResumoMes === 'function'
        ? calcularResumoMes(rep.mes, rep.ano)
        : { despFixa: 0, despVar: 0, cartao: 0, sonho: 0, invFixo: 0, invVar: 0 };
    slices.push({ lbl: 'Despesas fixas', val: r.despFixa || 0, cor: '#ef4444' });
    slices.push({ lbl: 'Despesas variáveis', val: r.despVar || 0, cor: '#f97316' });
    slices.push({ lbl: 'Cartão de crédito', val: r.cartao || 0, cor: '#f59e0b' });
    slices.push({ lbl: 'Sonhos', val: r.sonho || 0, cor: '#ec4899' });
    slices.push({ lbl: 'Investimentos', val: (r.invFixo || 0) + (r.invVar || 0), cor: '#7c3aed' });
  } catch (_) {}
  const filtrados = slices.filter((s) => s.val > 0);
  const totalSaidas = filtrados.reduce((a, b) => a + b.val, 0);

  const legenda = document.getElementById('rmDonutLegenda');
  const totalEl = document.getElementById('rmDonutTotal');
  if (totalEl) totalEl.innerText = formatarMoeda(totalSaidas);
  if (filtrados.length === 0) {
    if (rmChartDonutInst)
      try {
        rmChartDonutInst.destroy();
      } catch (_) {}
    if (legenda)
      legenda.innerHTML =
        '<div style="font-size:13px;color:var(--cor-texto-mutado);text-align:center;padding:30px 0;"><i class="ph ph-chart-donut" style="font-size:30px;display:block;margin:0 auto 8px;opacity:0.4;"></i>Sem saídas neste mês</div>';
    if (ctx) ctx.style.opacity = '0.3';
    if (totalEl) totalEl.innerText = '—';
    return;
  }
  if (ctx) ctx.style.opacity = '1';

  if (window.Chart) {
    if (rmChartDonutInst)
      try {
        rmChartDonutInst.destroy();
      } catch (_) {}
    rmChartDonutInst = new Chart(ctx.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: filtrados.map((s) => s.lbl),
        datasets: [
          {
            data: filtrados.map((s) => s.val),
            backgroundColor: filtrados.map((s) => s.cor),
            borderColor: '#fff',
            borderWidth: 3,
            hoverOffset: 8,
            hoverBorderColor: '#fff',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { display: false },
          datalabels: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.95)',
            titleColor: '#fff',
            bodyColor: '#e2e8f0',
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (c) =>
                '  ' +
                c.label +
                ': ' +
                formatarMoeda(c.parsed) +
                ' (' +
                ((c.parsed / totalSaidas) * 100).toFixed(1) +
                '%)',
            },
          },
        },
      },
    });
  }
  if (legenda) {
    legenda.innerHTML = filtrados
      .map(
        (s) =>
          '<div class="rm-donut-leg-item">' +
          '<span class="rm-donut-leg-dot" style="background:' +
          s.cor +
          ';"></span>' +
          '<span class="rm-donut-leg-label">' +
          s.lbl +
          '</span>' +
          '<span class="rm-donut-leg-valor valor-mascarado">' +
          formatarMoeda(s.val) +
          '</span>' +
          '<span class="rm-donut-leg-pct">' +
          ((s.val / totalSaidas) * 100).toFixed(0) +
          '%</span>' +
          '</div>'
      )
      .join('');
  }
}

// Comparação on/off
var rmModoComparacao = false;
function rmToggleComparacao() {
  rmModoComparacao = !rmModoComparacao;
  const bar = document.getElementById('rmComparacaoBar');
  const lbl = document.getElementById('rmBtnCompararLabel');
  if (bar) bar.style.display = rmModoComparacao ? 'flex' : 'none';
  if (lbl) lbl.innerText = rmModoComparacao ? 'Sair da comparação' : 'Comparar com…';
  // Default mês B = mês anterior ao atual
  if (rmModoComparacao) {
    const seletor = document.getElementById('rmSeletorMes');
    const selB = document.getElementById('rmSeletorMesB');
    if (selB && !selB.value && seletor.value) selB.value = rmAddMonths(seletor.value, -1);
  }
  renderRelatorioMensal();
}

// Render principal
function renderRelatorioMensal() {
  const seletor = document.getElementById('rmSeletorMes');
  if (!seletor) return;
  if (!seletor.value) {
    const hoje = new Date();
    seletor.value = rmMesAnoToYyyymm(hoje.getMonth(), hoje.getFullYear());
  }
  const yyyymm = seletor.value;
  const rep = buildMonthlyReport(yyyymm);

  let repB = null;
  if (rmModoComparacao) {
    const yyyymmB = document.getElementById('rmSeletorMesB').value;
    if (yyyymmB) repB = buildMonthlyReport(yyyymmB);
  }

  // Empty state
  const empty = document.getElementById('rmEmptyState');
  const isFuturo = rmMesEhFuturo(yyyymm);
  if (!rep.hasData && isFuturo) {
    if (empty) {
      empty.style.display = '';
      empty.querySelector('h3').innerText = 'Mês futuro';
      empty.querySelector('p').innerText =
        'Este mês ainda não chegou. Selecione um mês atual ou passado.';
    }
  } else if (empty) {
    empty.style.display = 'none';
  }

  rmRenderTermometro(rep, repB);
  const serie12 = rmRenderGraficos(yyyymm, rep) || {
    entradas: [],
    despesas: [],
    investimentos: [],
    dividendos: [],
  };
  rmRenderKpis(rep, repB, serie12);
  rmRenderSecundarios(rep);
}

// 4.5 — Em vez de "fotografar" a UI escura (que saía ilegível), montamos um
// documento limpo, branco e tipográfico a partir dos DADOS do mês. Gráficos
// viram barras em HTML (sem <canvas>), o que imprime nítido em qualquer escala.
function rmConstruirRelatorioImprimivel(yyyymm) {
  const rep = buildMonthlyReport(yyyymm);
  const r = typeof calcularResumoMes === 'function' ? calcularResumoMes(rep.mes, rep.ano) : {};
  const term = typeof rmCalcularTermometro === 'function' ? rmCalcularTermometro(rep) : null;
  const f = (v) =>
    typeof formatarMoeda === 'function' ? formatarMoeda(v || 0) : 'R$ ' + (v || 0).toFixed(2);
  const corStatus = { verde: '#059669', amarelo: '#d97706', vermelho: '#dc2626', cinza: '#6b7280' };
  const scoreCor = term ? corStatus[term.statusGeral] || '#059669' : '#059669';

  const kpi = (label, val, cor) =>
    `<div class="rm-print-kpi"><div class="k-lbl">${label}</div><div class="k-val" style="color:${cor || '#0f172a'}">${val}</div></div>`;

  const distItens = [
    { l: 'Despesas fixas', v: r.despFixa || 0, c: '#ef4444' },
    { l: 'Despesas variáveis', v: r.despVar || 0, c: '#f97316' },
    { l: 'Cartão de crédito', v: r.cartao || 0, c: '#f59e0b' },
    { l: 'Sonhos', v: r.sonho || 0, c: '#ec4899' },
    { l: 'Investimentos (aportes)', v: (r.invFixo || 0) + (r.invVar || 0), c: '#7c3aed' },
  ].filter((x) => x.v > 0);
  const maxDist = Math.max(1, ...distItens.map((x) => x.v));
  const distHtml =
    distItens
      .map(
        (x) => `
        <div class="rm-print-bar-row">
          <div class="rm-print-bar-head"><span>${x.l}</span><span class="mono">${f(x.v)}</span></div>
          <div class="rm-print-bar-track"><div class="rm-print-bar-fill" style="width:${((x.v / maxDist) * 100).toFixed(1)}%;background:${x.c}"></div></div>
        </div>`
      )
      .join('') || '<div class="rm-print-muted">Sem saídas registradas neste mês.</div>';

  const critHtml = term
    ? term.criterios
        .map(
          (c) => `
        <tr>
          <td>${c.label}</td>
          <td class="mono" style="text-align:right">${c.valor}</td>
          <td style="text-align:right;color:${corStatus[c.status] || '#6b7280'};font-weight:700">${c.meta || ''}</td>
        </tr>`
        )
        .join('')
    : '';

  return `
  <div class="rm-print" style="width:100%;box-sizing:border-box;font-family:'Figtree',Arial,sans-serif;color:#0f172a;">
    <style>
      .rm-print * { box-sizing:border-box; }
      .rm-print .rm-print-header { display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #059669;padding-bottom:10px;margin-bottom:18px; }
      .rm-print h1 { font-size:22px;margin:0;color:#0f172a; }
      .rm-print .rm-print-sub { color:#64748b;font-size:12px;margin-top:2px; }
      .rm-print .rm-print-score { text-align:center;min-width:96px; }
      .rm-print .rm-print-score .s { font-size:30px;font-weight:800;line-height:1; }
      .rm-print .rm-print-score .l { font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-top:3px; }
      .rm-print .rm-print-card { border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:16px;page-break-inside:avoid;background:#fff; }
      .rm-print .rm-print-card h2 { font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 12px; }
      .rm-print .rm-print-kpis { display:grid;grid-template-columns:repeat(3,1fr);gap:10px; }
      .rm-print .rm-print-kpi { border:1px solid #eef2f6;border-radius:10px;padding:10px 12px;background:#f8fafc; }
      .rm-print .rm-print-kpi .k-lbl { font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:#64748b; }
      .rm-print .rm-print-kpi .k-val { font-size:17px;font-weight:800;font-family:'DM Mono',monospace;margin-top:3px; }
      .rm-print .mono { font-family:'DM Mono',monospace; }
      .rm-print .rm-print-bar-row { margin-bottom:9px; }
      .rm-print .rm-print-bar-head { display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;color:#334155; }
      .rm-print .rm-print-bar-track { height:10px;background:#f1f5f9;border-radius:6px;overflow:hidden; }
      .rm-print .rm-print-bar-fill { height:100%;border-radius:6px; }
      .rm-print table { width:100%;border-collapse:collapse;font-size:12px; }
      .rm-print td { padding:7px 4px;border-bottom:1px solid #eef2f6;color:#334155; }
      .rm-print .rm-print-muted { color:#94a3b8;font-size:12px; }
      .rm-print .rm-print-foot { text-align:center;color:#94a3b8;font-size:10.5px;margin-top:14px; }
    </style>

    <div class="rm-print-header">
      <div>
        <h1>Relatório Mensal</h1>
        <div class="rm-print-sub">${rep.label} · gerado em ${new Date().toLocaleDateString('pt-BR')}</div>
      </div>
      <div class="rm-print-score">
        <div class="s" style="color:${scoreCor}">${term ? Math.round(term.score) : '—'}</div>
        <div class="l">${term ? term.statusGeral : 'Termômetro'}</div>
      </div>
    </div>

    <div class="rm-print-card">
      <h2>Resumo do mês</h2>
      <div class="rm-print-kpis">
        ${kpi('Entradas', f(rep.entradas), '#059669')}
        ${kpi('Despesas de consumo', f(rep.despesasContas), '#dc2626')}
        ${kpi('Investimentos', f(rep.investimentos), '#7c3aed')}
        ${kpi('Saldo do mês', f(rep.saldoFinal), rep.saldoFinal >= 0 ? '#059669' : '#dc2626')}
        ${kpi('Dividendos', f(rep.dividendos), '#0ea5e9')}
        ${kpi('Patrimônio (mercado)', f(rep.patrimonioMercado), '#0f172a')}
      </div>
    </div>

    <div class="rm-print-card">
      <h2>Para onde foi o dinheiro</h2>
      ${distHtml}
    </div>

    ${
      critHtml
        ? `<div class="rm-print-card">
      <h2>Termômetro financeiro</h2>
      <table><tbody>${critHtml}</tbody></table>
    </div>`
        : ''
    }

    <div class="rm-print-foot">Appliquei — relatório gerado automaticamente. Valores estimados.</div>
  </div>`;
}

async function rmExportarPDF() {
  try {
    const seletor = document.getElementById('rmSeletorMes');
    const ym =
      seletor && seletor.value
        ? seletor.value
        : rmMesAnoToYyyymm(new Date().getMonth(), new Date().getFullYear());

    // Conteúdo do relatório (HTML limpo, branco e tipográfico, montado a
    // partir dos DADOS do mês — sem depender da UI escura da tela).
    const inner = rmConstruirRelatorioImprimivel(ym);

    // ── Por que NÃO usamos mais html2canvas/html2pdf ──
    // A abordagem anterior "fotografava" um elemento offscreen com html2canvas
    // e o PDF saía TODO BRANCO (o html2canvas falha silenciosamente em vários
    // cenários: elemento fora da viewport, fontes/recursos pendentes, CDN
    // bloqueada, etc.). Agora delegamos pro motor de impressão NATIVO do
    // navegador: renderizamos o HTML numa janela dedicada e chamamos print().
    // O usuário escolhe "Salvar como PDF" — é nítido, paginado e nunca branco.
    const docHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>relatorio-mensal-${ym}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm 12mm; }
    html, body {
      margin: 0; padding: 0; background: #fff; color: #0f172a;
      /* Garante que cores de fundo (barras, KPIs) sejam impressas. */
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    body { padding: 8px; }
  </style>
</head>
<body>
  ${inner}
  <script>
    window.addEventListener('load', function () {
      // Pequeno respiro pro layout assentar antes do diálogo de impressão.
      setTimeout(function () {
        try { window.focus(); } catch (e) {}
        window.print();
      }, 300);
    });
    // Fecha a aba auxiliar depois que o usuário sai do diálogo de impressão.
    window.addEventListener('afterprint', function () {
      setTimeout(function () { try { window.close(); } catch (e) {} }, 100);
    });
  <\/script>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (!win) {
      if (typeof mostrarToast === 'function')
        mostrarToast('Permita pop-ups neste site para exportar o relatório.', 'erro');
      return;
    }
    win.document.open();
    win.document.write(docHtml);
    win.document.close();

    if (typeof mostrarToast === 'function')
      mostrarToast('Abrindo impressão — escolha "Salvar como PDF".', 'info');
  } catch (err) {
    console.error('[rmExportarPDF]', err);
    if (typeof mostrarToast === 'function')
      mostrarToast('Não foi possível gerar o relatório.', 'erro');
  }
}
