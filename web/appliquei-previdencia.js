/**
 * Appliquei — Previdência (recorrência mensal + saldo composto) +
 * KPI Próximo evento + Modal Dividendos do Mês.
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script.
 *
 * Deps: transacoes, historicoCompras, formatarMoeda, parseBRL.
 * processarAportesRecorrentesPrevidencia é chamado pelo window.onload.
 */

// ============================================================
// === PREVIDÊNCIA — recorrência mensal + saldo composto      ===
// ============================================================
// Calcula o saldo de um plano de previdência aplicando juros compostos
// mensais a partir de cada aporte até a data informada (default: hoje).
function calcularSaldoPrevidencia(ticker, ts) {
  const refTs = ts || Date.now();
  const aportes = historicoCompras.filter(
    (op) => op.ticker === ticker && op.categoria === 'previdencia' && op.data_op
  );
  let saldo = 0;
  aportes.forEach((op) => {
    const dataAporte = new Date(op.data_op).getTime();
    if (dataAporte > refTs) return;
    // Precedência: texto de rentabilidade indexado (ex.: "100% CDI") sobre a
    // taxaMensal fixa do plano; default 0,8%/mês quando nada foi informado.
    const taxa =
      typeof taxaMensalOperacao === 'function'
        ? taxaMensalOperacao(op, 0.008)
        : op.taxaMensal != null
          ? op.taxaMensal
          : 0.008;
    const meses = Math.max(0, (refTs - dataAporte) / (30.4375 * 24 * 60 * 60 * 1000));
    const valor = op.preco_op || op.preco_pago || 0;
    const fator = Math.pow(1 + taxa, meses);
    if ((op.tipo || 'compra') === 'venda') saldo -= valor * fator;
    else saldo += valor * fator;
  });
  return Math.max(0, saldo);
}

// Acrescenta um mês ao Date `d` ajustando para o último dia do mês alvo
// se o `dia` original (ex: 31) não existir naquele mês.
function avancarMesParaDia(d, dia) {
  const proximo = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const ultDiaMes = new Date(proximo.getFullYear(), proximo.getMonth() + 1, 0).getDate();
  proximo.setDate(Math.min(dia, ultDiaMes));
  proximo.setHours(12, 0, 0, 0);
  return proximo;
}

// Gera retroativamente os aportes mensais que faltaram para cada plano de
// === COMPROMISSO RECORRENTE — Previdência e Reserva ==========
// Gera lançamentos mensais futuros no Controle Financeiro a partir
// do mês seguinte ao da operação, durante operacao.duracaoAnos anos.
// Esses valores comprometem a renda da pessoa de forma realista.
function gerarLancamentosFuturosCompromisso(operacao, valorMensal) {
  if (!operacao || valorMensal <= 0) return 0;
  const dur = parseInt(operacao.duracaoAnos, 10);
  if (!(dur > 0)) return 0;
  const totalMeses = Math.min(dur * 12, 480); // hardcap 40 anos
  const dia =
    operacao.diaRecorrencia >= 1 && operacao.diaRecorrencia <= 31
      ? operacao.diaRecorrencia
      : new Date(operacao.data_op).getDate();
  const groupId = 'compromisso_grp_' + operacao.id;
  const dataIni = new Date(operacao.data_op);
  const labelCat = operacao.categoria === 'previdencia' ? 'Previdência' : 'Reserva';
  const descricao = `${labelCat}: ${operacao.ticker || labelCat}`;
  let criados = 0;
  // Começa no mês SEGUINTE ao da operação (o mês corrente já foi lançado pela compra)
  for (let i = 1; i < totalMeses; i++) {
    const d = new Date(dataIni.getFullYear(), dataIni.getMonth() + i, 1);
    const m = d.getMonth();
    const a = d.getFullYear();
    const jaExiste = transacoes.some(
      (t) => t.compromissoId === operacao.id && t.mes === m && t.ano === a
    );
    if (jaExiste) continue;
    let dataVencFinal = null;
    const ultimoDiaMes = new Date(a, m + 1, 0).getDate();
    const diaEfetivo = Math.min(dia, ultimoDiaMes);
    dataVencFinal = `${a}-${String(m + 1).padStart(2, '0')}-${String(diaEfetivo).padStart(2, '0')}`;
    transacoes.push({
      id: 'tx_compromisso_' + operacao.id + '_' + i,
      groupId,
      compromissoId: operacao.id,
      compromissoCategoria: operacao.categoria,
      descricao,
      valor: valorMensal,
      categoria: 'investimento_fixo',
      // Fase 3B-2: a parcela debita a conta-origem do template (quando
      // definida). Recorrentes usam contaId direto no investimento_* (sem
      // perna separada) — o mesmo efeito de caixa, sem ciclo de pago duplo.
      contaId: operacao.contaOrigemId || undefined,
      obs: `Compromisso recorrente — ${labelCat.toLowerCase()} (${dur} ano${dur === 1 ? '' : 's'})`,
      mes: m,
      ano: a,
      data: d.toISOString(),
      dataVencimento: dataVencFinal,
      pago: false,
      gerado: true,
    });
    criados++;
  }
  return criados;
}

// Remove lançamentos futuros vinculados a um compromisso (preserva pagos/passados)
function removerLancamentosFuturosCompromisso(operacaoId) {
  const agora = new Date();
  const m0 = agora.getMonth(),
    a0 = agora.getFullYear();
  const antes = transacoes.length;
  transacoes = transacoes.filter((t) => {
    if (t.compromissoId !== operacaoId) return true;
    if (t.pago) return true;
    const futuroOuCorrente = t.ano > a0 || (t.ano === a0 && t.mes >= m0);
    return !futuroOuCorrente;
  });
  if (transacoes.length !== antes)
    localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
}
// ============================================================

// previdência marcado como recorrente. Roda no carregamento do app.
function processarAportesRecorrentesPrevidencia() {
  const hoje = new Date();
  const grupos = {};
  historicoCompras.forEach((op) => {
    if (op.categoria !== 'previdencia' || (op.tipo || 'compra') === 'venda') return;
    if (!grupos[op.ticker]) grupos[op.ticker] = [];
    grupos[op.ticker].push(op);
  });

  const novosAportes = [];
  const novasTransacoes = [];

  Object.entries(grupos).forEach(([ticker, ops]) => {
    // Template = aporte manual marcado como recorrente
    const templates = ops
      .filter((o) => !o.gerado && o.recorrente)
      .sort((a, b) => new Date(a.data_op) - new Date(b.data_op));
    if (templates.length === 0) return;
    const template = templates[0];
    const diaRec = template.diaRecorrencia || new Date(template.data_op).getDate();
    const valorAporte = template.preco_op || template.preco_pago || 0;
    if (valorAporte <= 0) return;
    const taxa = template.taxaMensal != null ? template.taxaMensal : 0.008;

    // Cursor = mês imediatamente após o último aporte existente para o ticker
    const todasOrdenadas = [...ops].sort((a, b) => new Date(a.data_op) - new Date(b.data_op));
    const ultimo = todasOrdenadas[todasOrdenadas.length - 1];
    let cursor = avancarMesParaDia(new Date(ultimo.data_op), diaRec);

    let safety = 0;
    while (cursor <= hoje && safety < 240) {
      safety++;
      const id = Date.now() + Math.floor(Math.random() * 100000) + safety;
      novosAportes.push({
        id,
        ticker,
        quantidade: 1,
        preco_op: valorAporte,
        tipo: 'compra',
        data_op: cursor.toISOString(),
        categoria: 'previdencia',
        subcategoria: null,
        corretora: template.corretora || null,
        contaOrigemId: template.contaOrigemId || null,
        contaOrigemNome: template.contaOrigemNome || null,
        recorrente: true,
        diaRecorrencia: diaRec,
        taxaMensal: taxa,
        // Herda o indexador do template (quando houver) para os aportes gerados
        // valorizarem pela mesma regra do aporte original.
        rentabilidade: template.rentabilidade || null,
        gerado: true,
        operacaoOrigem: template.id,
      });
      novasTransacoes.push({
        id: id.toString(),
        operacaoId: id,
        descricao: `Aporte previdência: ${ticker}`,
        valor: valorAporte,
        categoria: 'investimento_fixo',
        contaId: template.contaOrigemId || undefined,
        mes: cursor.getMonth(),
        ano: cursor.getFullYear(),
        data: cursor.toISOString(),
        pago: true,
        gerado: true,
      });
      cursor = avancarMesParaDia(cursor, diaRec);
    }
  });

  if (novosAportes.length > 0) {
    historicoCompras.push(...novosAportes);
    transacoes.push(...novasTransacoes);
    localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));
    localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
    if (typeof mostrarToast === 'function') {
      mostrarToast(
        `${novosAportes.length} aporte${novosAportes.length === 1 ? '' : 's'} de previdência lançado${novosAportes.length === 1 ? '' : 's'} retroativamente.`,
        'info'
      );
    }
  }
  return novosAportes.length;
}

var ROTULOS_CATEGORIA = {
  renda_variavel: 'Renda Variável',
  renda_fixa: 'Renda Fixa',
  previdencia: 'Previdência',
  reserva_emergencia: 'Reserva de Emergência',
};
var CORES_CATEGORIA = {
  renda_variavel: '#2563eb',
  renda_fixa: '#059669',
  previdencia: '#7c3aed',
  reserva_emergencia: '#d97706',
};

// Filtro ativo de categoria na sub-aba Carteira
var filtroCategoriaAtivo = '';

function filtrarCarteiraPorCategoria(categoria) {
  filtroCategoriaAtivo = categoria || '';
  document
    .querySelectorAll('.chip-cat')
    .forEach((c) => c.classList.toggle('ativo', (c.dataset.cat || '') === filtroCategoriaAtivo));
  atualizarCarteiraAtivos();
}

// Inferi a categoria efetiva do ativo (operação > mock > fallback)
function inferirCategoria(ticker, ativoConsolidado, ativoMercado) {
  if (ativoConsolidado?.categoria) return ativoConsolidado.categoria;
  if (ativoMercado?.tipo === 'Renda Fixa') return 'renda_fixa';
  return 'renda_variavel';
}

// ============================================================
// === KPI: Próximo evento (foco em dividendos do mês corrente) ===
// ============================================================
// Cache global dos dividendos previstos do mês corrente, para abrir o modal detalhado.
var dividendosPrevistosMes = [];

function atualizarProximoEvento(carteiraConsolidada) {
  const valorEl = document.getElementById('resumoProximoEvento');
  const detEl = document.getElementById('resumoProximoEventoDetalhe');
  const titEl = document.getElementById('tituloProximoEvento');
  if (!valorEl) return;
  const hoje = new Date();
  const mesIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1).getTime();
  const mesFim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59).getTime();

  // Parser à prova de timezone para datas no formato YYYY-MM-DD
  const parsePagTs = (s) => new Date(s && s.length === 10 ? s + 'T12:00:00' : s).getTime();

  // Dividendos previstos no mês corrente — considera tanto pagamentos já registrados
  // no mês quanto a previsão (último pagamento + intervalo médio).
  const previstos = [];
  for (const ticker in carteiraConsolidada) {
    const ativo = carteiraConsolidada[ticker];
    if (ativo.qtdTotal <= 0) continue;
    const cache = cacheDividendos[ticker];
    if (!cache || !cache.pagamentos || cache.pagamentos.length === 0) continue;
    const datasOrd = cache.pagamentos.map((p) => parsePagTs(p.data)).sort((a, b) => a - b);
    const ultimo = datasOrd[datasOrd.length - 1];
    if (!ultimo) continue;

    // Se o último pagamento já caiu no mês corrente, é o "evento" do mês.
    const ultimoPag = cache.pagamentos.find((p) => parsePagTs(p.data) === ultimo);
    let proximoTs;
    let qtdEvento;
    if (ultimo >= mesIni && ultimo <= mesFim) {
      proximoTs = ultimo;
      // Já realizado: usa qty na DATA DO PAGAMENTO (e não a posição atual),
      // para refletir o que de fato caiu/cai considerando compras posteriores.
      qtdEvento = ultimoPag ? qtdNaData(ticker, ultimoPag.data) : ativo.qtdTotal;
    } else {
      let intervaloDias = 30;
      if (datasOrd.length >= 2) {
        const diffs = [];
        for (let i = 1; i < datasOrd.length; i++) diffs.push(datasOrd[i] - datasOrd[i - 1]);
        intervaloDias = Math.round(
          diffs.reduce((a, b) => a + b, 0) / diffs.length / (24 * 60 * 60 * 1000)
        );
      }
      if (!intervaloDias || intervaloDias < 1) intervaloDias = 30;
      proximoTs = ultimo + intervaloDias * 24 * 60 * 60 * 1000;
      let guarda = 0;
      while (proximoTs < mesIni && guarda++ < 60) proximoTs += intervaloDias * 24 * 60 * 60 * 1000;
      if (proximoTs > mesFim) continue;
      // Previsão futura: posição atual é a melhor estimativa.
      qtdEvento = ativo.qtdTotal;
    }
    if (qtdEvento <= 0) continue;
    const valorPorAcao = ultimoPag ? ultimoPag.valor : 0;
    const valorEstim = valorPorAcao * qtdEvento;
    previstos.push({ ticker, ts: proximoTs, valor: valorEstim, valorPorAcao, qtd: qtdEvento });
  }
  dividendosPrevistosMes = previstos.slice().sort((a, b) => a.ts - b.ts);

  // Vencimentos no mês
  const vencimentosMes = [];
  for (const ticker in carteiraConsolidada) {
    const ativo = carteiraConsolidada[ticker];
    if (ativo.qtdTotal <= 0 || !ativo.vencimento) continue;
    const tsVenc = new Date(ativo.vencimento + 'T12:00:00').getTime();
    if (tsVenc < mesIni || tsVenc > mesFim) continue;
    vencimentosMes.push({ ticker, ts: tsVenc });
  }

  const nomeMes = hoje.toLocaleDateString('pt-BR', { month: 'long' });
  const totalPrevisto = previstos.reduce((a, b) => a + b.valor, 0);
  const card = document.getElementById('cardProximoEvento');
  const iconAbrir = document.getElementById('iconAbrirDividendosMes');
  if (previstos.length > 0) {
    titEl.innerHTML = '<i class="ph ph-coins"></i> Dividendos do mês';
    valorEl.innerText = formatarMoeda(totalPrevisto);
    const tickersResumo = previstos
      .map((p) => p.ticker)
      .slice(0, 3)
      .join(', ');
    const sufixo = previstos.length > 3 ? ` +${previstos.length - 3}` : '';
    detEl.innerText = `${previstos.length} ativo${previstos.length === 1 ? '' : 's'} previsto${previstos.length === 1 ? '' : 's'} em ${nomeMes} · ${tickersResumo}${sufixo} · clique para detalhar`;
    if (card) {
      card.style.cursor = 'pointer';
      card.onclick = abrirModalDividendosMes;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.title = 'Ver tabela com os dividendos previstos do mês';
    }
    if (iconAbrir) iconAbrir.style.display = 'inline-block';
  } else if (vencimentosMes.length > 0) {
    titEl.innerHTML = '<i class="ph ph-calendar-check"></i> Vencimento RF';
    vencimentosMes.sort((a, b) => a.ts - b.ts);
    const prox = vencimentosMes[0];
    valorEl.innerText = prox.ticker;
    detEl.innerText = `Vence ${new Date(prox.ts).toLocaleDateString('pt-BR')} · ${vencimentosMes.length} no mês`;
    if (card) {
      card.style.cursor = '';
      card.onclick = null;
      card.removeAttribute('role');
      card.removeAttribute('tabindex');
      card.title = '';
    }
    if (iconAbrir) iconAbrir.style.display = 'none';
  } else {
    titEl.innerHTML = '<i class="ph ph-calendar-check"></i> Próximo evento';
    valorEl.innerText = '—';
    detEl.innerText = `Sem dividendos previstos em ${nomeMes}.`;
    if (card) {
      card.style.cursor = '';
      card.onclick = null;
      card.removeAttribute('role');
      card.removeAttribute('tabindex');
      card.title = '';
    }
    if (iconAbrir) iconAbrir.style.display = 'none';
  }
}

function abrirModalDividendosMes() {
  const modal = document.getElementById('modalDividendosMes');
  if (!modal) return;
  const corpo = document.getElementById('corpoModalDividendosMes');
  const rodape = document.getElementById('rodapeModalDividendosMes');
  const subtitulo = document.getElementById('subtituloModalDividendosMes');
  const msgVazia = document.getElementById('msgVaziaModalDividendosMes');
  const lista = (dividendosPrevistosMes || []).slice();
  const hoje = new Date();
  const nomeMes = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  if (subtitulo)
    subtitulo.innerText = `Estimativa baseada no último pagamento de cada ativo · ${nomeMes}`;
  if (lista.length === 0) {
    corpo.innerHTML = '';
    rodape.innerHTML = '';
    if (msgVazia) msgVazia.style.display = 'block';
  } else {
    if (msgVazia) msgVazia.style.display = 'none';
    corpo.innerHTML = lista
      .map((p) => {
        const dataLbl = new Date(p.ts).toLocaleDateString('pt-BR');
        return `<tr>
                <td>
                    <div style="font-weight:600;font-family:'DM Mono',monospace;">${p.ticker}</div>
                    <div style="font-size:11px;color:var(--cor-texto-mutado);">Pagamento previsto ${dataLbl}</div>
                </td>
                <td style="text-align:right;font-family:'DM Mono',monospace;">${formatarMoeda(p.valorPorAcao)}</td>
                <td style="text-align:right;font-family:'DM Mono',monospace;">${formatarQtd(p.qtd)}</td>
                <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--cor-primaria);" class="valor-mascarado">${formatarMoeda(p.valor)}</td>
            </tr>`;
      })
      .join('');
    const total = lista.reduce((s, p) => s + p.valor, 0);
    rodape.innerHTML = `<tr>
            <td colspan="3" style="text-align:right;font-weight:700;padding-top:10px;border-top:1px solid var(--cor-borda);">Total previsto</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:800;color:var(--cor-primaria);padding-top:10px;border-top:1px solid var(--cor-borda);" class="valor-mascarado">${formatarMoeda(total)}</td>
        </tr>`;
  }
  modal.style.display = 'flex';
}

function fecharModalDividendosMes() {
  const modal = document.getElementById('modalDividendosMes');
  if (modal) modal.style.display = 'none';
}
