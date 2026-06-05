/**
 * Appliquei — Meu Patrimônio (a FOTO do patrimônio).
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script, carregado
 * DEPOIS de app.js. Consome transacoes, cartoes, historicoCompras (state
 * global em app.js) e o cadastro de Contas (appliquei-contas.js).
 *
 * Objetivo desta tela: uma FOTO de tudo o que a pessoa tem AGORA — saldo em
 * caixa + investido, consolidado e quebrado por instituição (banco/corretora),
 * como um extrato unificado de todos os bancos. Não há despesas nem navegação
 * por mês aqui (isso vive na aba Controle): a cada pagamento/aporte/resgate o
 * caixa da instituição certa é debitado/creditado e a foto se atualiza sozinha.
 */

// ============================================================
// === MEU PATRIMÔNIO — a foto do patrimônio                 ===
// ============================================================
// Estado e cache do módulo. `mes`/`ano` NÃO são mais navegáveis na UI (a foto é
// sempre "agora"); ficam no estado só como referência para o delta "vs mês
// passado" do saldo e para as funções de janela reaproveitadas pelos testes.
var mpEstado = {
  mes: new Date().getMonth(),
  ano: new Date().getFullYear(),
  modo: 'bruto',
  cotacoes: {},
  ultimaCotacao: null,
  donutChart: null,
  categoriaDestaque: null,
};

// Tabela regressiva IR para Renda Fixa/Tesouro
function mpAliquotaIRRendaFixa(diasDecorridos) {
  if (diasDecorridos <= 180) return 0.225;
  if (diasDecorridos <= 360) return 0.2;
  if (diasDecorridos <= 720) return 0.175;
  return 0.15;
}
// IR para Renda Variável por subcategoria (preço médio — estimativa)
function mpAliquotaIRRendaVariavel(subcat) {
  if (subcat === 'fiis') return 0.2;
  return 0.15; // ações, BDR, ETF, cripto na faixa simplificada
}

// Janela do MÊS selecionado (igual ao filtro da aba Controle — 4.9):
// {iniMs, fimMs, fimMesMs, anteriorIniMs, anteriorFimMs, label}.
// `fimMs` é limitado a "agora" para o SALDO não projetar caixa futuro.
// `fimMesMs` é o fim REAL do mês (sem corte) — usado nas DESPESAS, que devem
// somar o mês inteiro inclusive em meses futuros (planejados). Sem isso, ao
// navegar para um mês posterior a hoje, `fimMs` < `iniMs` e o KPI zerava.
function mpJanelaPeriodo() {
  const mes = typeof mpEstado.mes === 'number' ? mpEstado.mes : new Date().getMonth();
  const ano = typeof mpEstado.ano === 'number' ? mpEstado.ano : new Date().getFullYear();
  const iniMs = new Date(ano, mes, 1).getTime();
  const fimMesMs = new Date(ano, mes + 1, 0, 23, 59, 59, 999).getTime();
  const fimMs = Math.min(fimMesMs, Date.now());
  const anteriorIniMs = new Date(ano, mes - 1, 1).getTime();
  const anteriorFimMs = new Date(ano, mes, 1).getTime() - 1;
  return { iniMs, fimMs, fimMesMs, anteriorIniMs, anteriorFimMs, label: 'mês anterior' };
}

// Navegação de mês — espelha mudarMesVisao/selecionarMesVisao/irParaMesAtual.
function mpSincronizarInputMes() {
  const inp = document.getElementById('mpInputMesAno');
  if (inp) inp.value = `${mpEstado.ano}-${String(mpEstado.mes + 1).padStart(2, '0')}`;
}
function mpMudarMes(delta) {
  mpEstado.mes += delta;
  if (mpEstado.mes > 11) {
    mpEstado.mes = 0;
    mpEstado.ano++;
  }
  if (mpEstado.mes < 0) {
    mpEstado.mes = 11;
    mpEstado.ano--;
  }
  mpSincronizarInputMes();
  renderMeuPatrimonio(true);
}
function mpSelecionarMes() {
  const inp = document.getElementById('mpInputMesAno');
  if (!inp || !inp.value) return;
  const [a, m] = inp.value.split('-');
  mpEstado.ano = parseInt(a, 10);
  mpEstado.mes = parseInt(m, 10) - 1;
  renderMeuPatrimonio(true);
}
function mpIrMesAtual() {
  const hoje = new Date();
  mpEstado.mes = hoje.getMonth();
  mpEstado.ano = hoje.getFullYear();
  mpSincronizarInputMes();
  renderMeuPatrimonio(true);
}

function mpFmtBRL(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function mpFmtPct(v, casas = 1) {
  if (!isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(casas) + '%';
}

var MP_LABELS = {
  renda_fixa: 'Renda Fixa',
  renda_variavel: 'Renda Variável',
  previdencia: 'Previdência',
  reserva_emergencia: 'Reserva Emergência',
  caixa: 'Caixa / Saldo em Conta',
  // Subcategorias de Renda Variável (gráficos de divisão/rentabilidade).
  acoes: 'Ações',
  fiis: 'FIIs',
  bdrs: 'BDRs',
  etfs: 'ETFs',
  cripto: 'Cripto',
};
function mpCorCategoria(cat) {
  const p = typeof paletaCarteira === 'function' ? paletaCarteira() : {};
  if (cat === 'renda_fixa') return p.renda_fixa || '#60a5fa';
  if (cat === 'renda_variavel') return p.acoes || '#10b981';
  if (cat === 'acoes') return p.acoes || '#059669';
  if (cat === 'fiis') return p.fiis || '#10b981';
  if (cat === 'bdrs') return p.bdrs || '#047857';
  if (cat === 'etfs') return p.etfs || '#34d399';
  if (cat === 'cripto')
    return p.cripto || (typeof getToken === 'function' ? getToken('--cor-cartao') : '#f59e0b');
  if (cat === 'previdencia') return p.previdencia || '#7c3aed';
  if (cat === 'reserva_emergencia') return p.reserva_emergencia || '#6b7280';
  if (cat === 'caixa')
    return (typeof getToken === 'function' ? getToken('--cor-cartao') : '#f59e0b') || '#f59e0b';
  return '#9ca3af';
}

// Valor de mercado atual de um item consolidado (RV → cotação; RF → preço médio + juros simples;
// Previdência → calcularSaldoPrevidencia; Reserva → valor investido + juros se taxaMensal).
function mpValorAtualAtivo(ticker, c) {
  if (!c || !(c.qtdTotal > 0)) return 0;
  if (c.categoria === 'renda_variavel') {
    const cot = mpEstado.cotacoes[ticker];
    if (cot && typeof cot.price === 'number' && cot.price > 0) return c.qtdTotal * cot.price;
    // Fallback: mockAtivosMercado pode ter sido atualizado por buscarCotacoesReais
    const m =
      typeof mockAtivosMercado !== 'undefined'
        ? mockAtivosMercado.find((a) => a.ticker === ticker)
        : null;
    if (m && m.preco_atual) return c.qtdTotal * m.preco_atual;
    return c.valorTotalInvestido;
  }
  if (c.categoria === 'previdencia') {
    if (typeof calcularSaldoPrevidencia === 'function') {
      try {
        return calcularSaldoPrevidencia(ticker);
      } catch (_) {}
    }
    return c.valorTotalInvestido;
  }
  // Renda Fixa / Reserva: conta TODOS os aportes/resgates do ativo. Aplica
  // taxaMensal (juros compostos) só quando a data é válida e já passou; aportes
  // SEM data ou com data FUTURA entram pelo PRINCIPAL (fator 1) em vez de serem
  // descartados. Sem isso, um aporte com data ausente/futura zerava o ativo e o
  // investimento sumia de "Meu Patrimônio" — enquanto "Meus investimentos"
  // (que valoriza por preço médio, sem olhar a data) continuava mostrando.
  if (c.categoria === 'renda_fixa' || c.categoria === 'reserva_emergencia') {
    const aportes = (typeof historicoCompras !== 'undefined' ? historicoCompras : []).filter(
      (op) => op.ticker === ticker && op.categoria === c.categoria
    );
    let saldo = 0;
    const agora = Date.now();
    aportes.forEach((op) => {
      const valor = (op.preco_op || op.preco_pago || 0) * (op.quantidade || 1);
      const taxa = op.taxaMensal != null ? op.taxaMensal : 0;
      const ts = op.data_op ? new Date(op.data_op).getTime() : NaN;
      let fator = 1;
      if (isFinite(ts) && ts <= agora && taxa > 0) {
        const meses = Math.max(0, (agora - ts) / (30.4375 * 86400000));
        fator = Math.pow(1 + taxa, meses);
      }
      if ((op.tipo || 'compra') === 'venda') saldo -= valor * fator;
      else saldo += valor * fator;
    });
    return Math.max(0, saldo);
  }
  return c.valorTotalInvestido;
}

// Aplica IR sobre o LUCRO (não sobre o principal). Estimativa por preço médio.
function mpAplicarIR(c, valorAtual, valorInvestido) {
  const lucro = valorAtual - valorInvestido;
  if (lucro <= 0) return valorAtual; // Não há IR sobre prejuízo
  if (c.categoria === 'renda_fixa' || c.categoria === 'reserva_emergencia') {
    // Calcula dias decorridos médios ponderados pelos aportes
    const aportes = (typeof historicoCompras !== 'undefined' ? historicoCompras : []).filter(
      (op) =>
        op.ticker === c.__ticker &&
        op.categoria === c.categoria &&
        (op.tipo || 'compra') === 'compra' &&
        op.data_op
    );
    let somaPonderada = 0,
      somaPesos = 0;
    const agora = Date.now();
    aportes.forEach((op) => {
      const dataAporte = new Date(op.data_op).getTime();
      if (dataAporte > agora) return;
      const dias = Math.max(0, (agora - dataAporte) / 86400000);
      const peso = (op.preco_op || op.preco_pago || 0) * (op.quantidade || 1);
      somaPonderada += dias * peso;
      somaPesos += peso;
    });
    const diasMedios = somaPesos > 0 ? somaPonderada / somaPesos : 0;
    const aliquota = mpAliquotaIRRendaFixa(diasMedios);
    return valorAtual - lucro * aliquota;
  }
  if (c.categoria === 'renda_variavel') {
    const aliq = mpAliquotaIRRendaVariavel(c.subcategoria);
    return valorAtual - lucro * aliq;
  }
  // Previdência usa tabela regressiva também (12 anos→10%); aqui simplificamos com 15%.
  if (c.categoria === 'previdencia') return valorAtual - lucro * 0.15;
  return valorAtual;
}

// Categorias que CREDITAM o caixa (entradas): receita e resgates/vendas de
// investimento (inclui venda de renda variável) e transferências de entrada.
function mpEhEntradaCaixa(categoria) {
  return (
    categoria === 'receita' ||
    categoria === 'dividendo' ||
    categoria === 'resgate_investimento' ||
    categoria === 'transferencia_entrada'
  );
}

// Categorias que NÃO são gastos de consumo: entradas, aportes (renda fixa e
// variável) e transferências entre contas próprias. Tudo isto fica fora da
// "Despesa" para não inflar o indicador com investimentos.
function mpEhDespesaConsumo(categoria) {
  if (mpEhEntradaCaixa(categoria)) return false;
  if (categoria === 'investimento_fixo' || categoria === 'investimento_variavel') return false;
  if (categoria === 'transferencia_saida') return false;
  return true;
}

// Timestamp/competência padronizado de uma transação. Prioriza mes/ano —
// é a competência canônica usada no resto do app (calcularResumoMes) e a única
// confiável para lançamentos recorrentes/fixos, cujo `data` guarda o instante
// de criação (igual para os 60 meses gerados), não o mês de cada parcela.
// Cai para `data` (ISO/date-only, fuso-seguro) quando não há mes/ano.
function mpTimestampTransacao(t) {
  if (typeof t.mes === 'number' && typeof t.ano === 'number')
    return new Date(t.ano, t.mes, 1).getTime();
  if (t.data) return appliqueiParseData(t.data).getTime();
  return Date.now();
}

// Decide se uma transação já compõe o caixa/saldo em conta até `refMs`.
// Entradas (receita/salário, resgates, transferências de entrada) NÃO têm
// botão "pago" no Controle — são lançadas já recebidas, logo contam pela data.
// Saídas (despesas, aportes, transferências de saída) só abatem o caixa
// quando efetivamente pagas. Antes deste ajuste, o salário ficava `pago:false`
// para sempre e nunca aparecia no Patrimônio.
function mpTransacaoComputaCaixa(t, refMs) {
  if (mpTimestampTransacao(t) > refMs) return false;
  // Fase 3B: aporte cujo débito de caixa já é representado por uma perna de
  // transferência (transferencia_saida com contaId) NÃO conta aqui — senão
  // haveria duplo-débito. O `investimento_*` permanece só para a carteira/DRE.
  if (
    (t.categoria === 'investimento_fixo' || t.categoria === 'investimento_variavel') &&
    t.temLegCaixa
  )
    return false;
  if (mpEhEntradaCaixa(t.categoria)) return true;
  return !!t.pago;
}

// Normaliza nome de instituição para agrupamento: `key` sem acento, caixa ou
// espaços duplicados (une "Itaú"/"itau"/"Itau "); `label` preserva a grafia
// legível. Garante que "Por instituição" não fragmente o mesmo banco.
function mpNormalizarInstituicao(nome) {
  const orig = (nome || '').trim().replace(/\s+/g, ' ');
  if (!orig) return { key: '', label: '' };
  const key = orig
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return { key, label: orig };
}

// Saldo de abertura de uma conta entra no caixa se a data de referência já
// passou (ou se não há data — assume que sempre valeu). Fase 2.
function mpSaldoInicialConta(c, refMs) {
  const sIni = Number(c && c.saldoInicial) || 0;
  if (!sIni) return 0;
  if (c && c.dataSaldoInicial) {
    const tsIni = appliqueiParseData(c.dataSaldoInicial).getTime();
    if (isFinite(tsIni) && tsIni > refMs) return 0;
  }
  return sIni;
}

// Chave/label de agrupamento por instituição. Prioriza a CONTA resolvida
// (key = conta.id); cai para o nome em texto (key 'nome:<norm>'); e, quando não
// há instituição alguma, cai em 'a-reconciliar' (os antigos vazamentos "Sem
// banco", agora explícitos). Fase 2.
function mpChaveInstTransacao(t) {
  const conta = typeof resolverContaDeTransacao === 'function' ? resolverContaDeTransacao(t) : null;
  if (conta) return { key: conta.id, label: conta.nome };
  const norm = mpNormalizarInstituicao(t && t.banco);
  if (norm.key) return { key: 'nome:' + norm.key, label: norm.label };
  return { key: 'a-reconciliar', label: 'A reconciliar' };
}
function mpChaveInstOperacao(c) {
  const conta = typeof resolverContaDeOperacao === 'function' ? resolverContaDeOperacao(c) : null;
  if (conta) return { key: conta.id, label: conta.nome };
  const norm = mpNormalizarInstituicao(c && c.corretora);
  if (norm.key) return { key: 'nome:' + norm.key, label: norm.label };
  return { key: 'a-reconciliar', label: 'A reconciliar' };
}

// Soma saldo total: saldos de abertura + entradas - despesas - aportes (todas as
// transações pagas). Inclui aportes de investimento pois eles abatem o caixa;
// resgates/vendas devolvem dinheiro ao caixa (renda variável reflete aqui).
function mpCalcularSaldoTotal(refMs) {
  let saldo = 0;
  if (typeof contasAtivas === 'function') {
    contasAtivas().forEach((c) => {
      saldo += mpSaldoInicialConta(c, refMs);
    });
  }
  if (typeof transacoes !== 'undefined') {
    transacoes.forEach((t) => {
      if (!mpTransacaoComputaCaixa(t, refMs)) return;
      const valor = Number(t.valor) || 0;
      if (mpEhEntradaCaixa(t.categoria)) saldo += valor;
      else saldo -= valor;
    });
  }
  return saldo;
}

// Despesas de consumo na janela. Conta TODA despesa com competência no período,
// paga ou não — igual ao Controle (calcularResumoMes soma despFixa+despVar+cartão
// sem olhar `pago`). Antes exigia `t.pago`, mas como as transações nascem
// `pago:false` (e fatura de cartão fica em aberto), o KPic vinha zerado/baixo.
function mpCalcularDespesasJanela(iniMs, fimMs) {
  if (typeof transacoes === 'undefined') return 0;
  let total = 0;
  transacoes.forEach((t) => {
    if (!mpEhDespesaConsumo(t.categoria)) return;
    const tsTx = mpTimestampTransacao(t);
    if (tsTx < iniMs || tsTx > fimMs) return;
    total += Number(t.valor) || 0;
  });
  return total;
}

function mpCalcularSaldoPorInstituicao(refMs) {
  const mapa = {};
  const ensure = (key, label) => {
    if (!mapa[key])
      mapa[key] = { caixa: 0, investido: 0, label: label || 'A reconciliar', key: key };
    else if (label && mapa[key].label === 'A reconciliar') mapa[key].label = label;
    return mapa[key];
  };
  // Saldos de abertura das contas cadastradas entram no caixa.
  if (typeof contasAtivas === 'function') {
    contasAtivas().forEach((c) => {
      const sIni = mpSaldoInicialConta(c, refMs);
      if (sIni) ensure(c.id, c.nome).caixa += sIni;
    });
  }
  if (typeof transacoes !== 'undefined') {
    transacoes.forEach((t) => {
      if (!mpTransacaoComputaCaixa(t, refMs)) return;
      // Agrupa pela CONTA resolvida (contaId → nome/alias); sem instituição,
      // cai em "A reconciliar" em vez do antigo bucket silencioso "Sem banco".
      const ci = mpChaveInstTransacao(t);
      const b = ensure(ci.key, ci.label);
      const valor = Number(t.valor) || 0;
      if (mpEhEntradaCaixa(t.categoria)) b.caixa += valor;
      else b.caixa -= valor;
    });
  }
  return mapa;
}

// Coleta tickers únicos de RV referenciados em historicoCompras.
function mpTickersRVUnicos() {
  if (typeof historicoCompras === 'undefined') return [];
  const s = new Set();
  historicoCompras.forEach((op) => {
    if (op.categoria === 'renda_variavel' && op.ticker && /^[A-Z]{4}\d{1,2}$/.test(op.ticker)) {
      s.add(op.ticker);
    }
  });
  return Array.from(s);
}

async function mpFetchCotacoes() {
  const tickers = mpTickersRVUnicos();
  if (!tickers.length) {
    mpEstado.ultimaCotacao = null;
    mpAtualizarMetaCotacao();
    return {};
  }
  const meta = document.getElementById('mp-cotacao-meta');
  if (meta) meta.innerHTML = '<i class="ph ph-arrows-clockwise"></i>Atualizando cotações…';
  try {
    const token =
      typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser
        ? await firebase.auth().currentUser.getIdToken()
        : null;
    if (!token) throw new Error('sem_token');
    const url = '/api/market?op=quote&tickers=' + encodeURIComponent(tickers.join(','));
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'falha');
    mpEstado.cotacoes = data.quotes || {};
    mpEstado.ultimaCotacao = Date.now();
    mpAtualizarMetaCotacao(data);
    return mpEstado.cotacoes;
  } catch (err) {
    console.warn('[meu_patrimonio] cotações falharam:', err.message);
    if (meta)
      meta.innerHTML =
        '<i class="ph ph-warning" style="color:var(--cor-erro)"></i>Cotações indisponíveis — usando preço médio';
    return {};
  }
}

function mpAtualizarMetaCotacao(data) {
  const meta = document.getElementById('mp-cotacao-meta');
  if (!meta) return;
  if (!mpEstado.ultimaCotacao) {
    meta.innerHTML = '<i class="ph ph-info"></i>Sem ativos de Renda Variável';
    return;
  }
  const t = new Date(mpEstado.ultimaCotacao);
  const hh = String(t.getHours()).padStart(2, '0'),
    mm = String(t.getMinutes()).padStart(2, '0');
  const cache = data && data.fromCache ? ` · ${data.fromCache} em cache` : '';
  meta.innerHTML = `<i class="ph ph-check-circle" style="color:var(--cor-primaria)"></i>Cotações atualizadas ${hh}:${mm}${cache}`;
}

// Consolida tudo numa única passagem: { porCategoria:{cat:{investido, atual, atualLiq}}, porInstituicao, totalInvestido, totalAtual, totalAtualLiq }
function mpConsolidar() {
  const resumo = typeof obterResumoCarteira === 'function' ? obterResumoCarteira() : {};
  const acc = {
    porCategoria: {},
    // Como porCategoria, mas com a Renda Variável QUEBRADA por subcategoria
    // (Ações / FIIs / Cripto / BDRs / ETFs) — usado nos gráficos de divisão e
    // rentabilidade. porCategoria continua agregando RV num bloco só, para os
    // consumidores que dependem da categoria contábil (KPIs, totais).
    porCategoriaExibicao: {},
    porInstituicao: {},
    porTicker: [],
    totalInvestido: 0,
    totalAtual: 0,
    totalAtualLiq: 0,
  };
  Object.entries(resumo).forEach(([ticker, c]) => {
    if (!c || !(c.qtdTotal > 0)) return;
    c.__ticker = ticker;
    const cat = c.categoria || 'renda_variavel';
    const atual = mpValorAtualAtivo(ticker, c);
    const liquido = mpAplicarIR(c, atual, c.valorTotalInvestido);
    if (!acc.porCategoria[cat])
      acc.porCategoria[cat] = { investido: 0, atual: 0, atualLiq: 0, ativos: 0 };
    acc.porCategoria[cat].investido += c.valorTotalInvestido;
    acc.porCategoria[cat].atual += atual;
    acc.porCategoria[cat].atualLiq += liquido;
    acc.porCategoria[cat].ativos += 1;
    // Chave de exibição: RV vira a subcategoria efetiva; demais mantêm a categoria.
    let catExib = cat;
    if (cat === 'renda_variavel') {
      const ativoMercado =
        typeof mockAtivosMercado !== 'undefined'
          ? mockAtivosMercado.find((a) => a.ticker === ticker)
          : null;
      catExib =
        typeof subcategoriaEfetiva === 'function'
          ? subcategoriaEfetiva(ticker, c, ativoMercado)
          : c.subcategoria || 'acoes';
    }
    if (!acc.porCategoriaExibicao[catExib])
      acc.porCategoriaExibicao[catExib] = { investido: 0, atual: 0, atualLiq: 0, ativos: 0 };
    acc.porCategoriaExibicao[catExib].investido += c.valorTotalInvestido;
    acc.porCategoriaExibicao[catExib].atual += atual;
    acc.porCategoriaExibicao[catExib].atualLiq += liquido;
    acc.porCategoriaExibicao[catExib].ativos += 1;
    acc.totalInvestido += c.valorTotalInvestido;
    acc.totalAtual += atual;
    acc.totalAtualLiq += liquido;
    const ci = mpChaveInstOperacao(c);
    if (!acc.porInstituicao[ci.key])
      acc.porInstituicao[ci.key] = {
        caixa: 0,
        investido: 0,
        label: ci.label,
        key: ci.key,
        classes: {},
      };
    acc.porInstituicao[ci.key].investido += atual;
    // Quebra por classe DENTRO da instituição (catExib = RV já dividida em
    // Ações/FIIs/…), p/ o detalhe "o que tem em cada banco/corretora".
    acc.porInstituicao[ci.key].classes[catExib] =
      (acc.porInstituicao[ci.key].classes[catExib] || 0) + atual;
    acc.porTicker.push({ ticker, c, atual, liquido });
  });
  return acc;
}

// Fonte única de verdade do patrimônio investido. Soma TODAS as categorias
// (renda fixa + renda variável + previdência + reserva de emergência), para
// que o card "Total Investimento" nunca reflita apenas uma delas. Construída
// sobre mpConsolidar() para reaproveitar cotações/projeções e IR.
function calcularPatrimonioTotal() {
  const cons =
    typeof mpConsolidar === 'function'
      ? mpConsolidar()
      : { porCategoria: {}, totalInvestido: 0, totalAtual: 0, totalAtualLiq: 0 };
  const cat = cons.porCategoria || {};
  const atualDe = (c) => (cat[c] ? cat[c].atual : 0);
  const investDe = (c) => (cat[c] ? cat[c].investido : 0);
  const totalRendaVariavel = atualDe('renda_variavel');
  const totalRendaFixa = atualDe('renda_fixa');
  const totalPrevidencia = atualDe('previdencia');
  const totalReservaEmergencia = atualDe('reserva_emergencia');
  return {
    totalRendaFixa,
    totalRendaVariavel,
    totalPrevidencia,
    totalReservaEmergencia,
    investidoRendaFixa: investDe('renda_fixa'),
    investidoRendaVariavel: investDe('renda_variavel'),
    // Custo (aportes) e valor de mercado de TODAS as categorias.
    totalInvestido: cons.totalInvestido || 0,
    totalAtual: cons.totalAtual || 0,
    totalAtualLiq: cons.totalAtualLiq || 0,
    // Soma exata de todas as categorias = patrimônio investido total.
    totalPatrimonio: cons.totalAtual || 0,
    porCategoria: cat,
  };
}

// Mantido por compatibilidade com chamadas antigas; o filtro agora é por mês.
function mpAlterarPeriodo() {
  renderMeuPatrimonio(true);
}
function mpAlterarModo(m) {
  mpEstado.modo = m;
  document.querySelectorAll('#meu_patrimonio .mp-toggle-btn').forEach((b) => {
    b.classList.toggle('ativo', b.dataset.modo === m);
    b.setAttribute('aria-selected', b.dataset.modo === m ? 'true' : 'false');
  });
  document.getElementById('mp-kpis').classList.toggle('modo-liquido', m === 'liquido');
  renderMeuPatrimonio(true); // skipFetch — não precisa rebuscar cotação
}

function mpRenderKPIs(consolidado, janela) {
  // A foto = 3 KPIs: Patrimônio total (hero) · Saldo em caixa · Total investido.
  // "Total Investido" = soma de TODAS as categorias (RF + RV + prev + reserva),
  // via fonte única calcularPatrimonioTotal(). Sem KPI de despesas: a foto mostra
  // o que a pessoa TEM, não o que gasta.
  const patr =
    typeof calcularPatrimonioTotal === 'function' ? calcularPatrimonioTotal() : consolidado;
  const valorInvestido = mpEstado.modo === 'liquido' ? patr.totalAtualLiq : patr.totalAtual;
  const saldoTotal = mpCalcularSaldoTotal(janela.fimMs);
  const patrimonioTotal = saldoTotal + valorInvestido;
  const saldoAnterior = mpCalcularSaldoTotal(janela.anteriorFimMs);
  const investidoAporteTotal = patr.totalInvestido;

  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = mpFmtBRL(v);
  };
  setText('mp-kpi-patrimonio-valor', patrimonioTotal);
  setText('mp-kpi-saldo-valor', saldoTotal);
  setText('mp-kpi-investido-valor', valorInvestido);

  // Sub do Patrimônio total: legenda do que ele soma (caixa + investido). Sem
  // valores aqui — eles já estão nos dois KPIs ao lado e não devem vazar quando
  // "ocultar valores" está ligado.
  const subPatr = document.getElementById('mp-kpi-patrimonio-sub');
  if (subPatr) {
    subPatr.className = 'mp-kpi-sub';
    subPatr.innerHTML =
      '<i class="ph ph-wallet"></i> saldo em conta + <i class="ph ph-trend-up"></i> investimentos';
  }

  const deltaSaldo =
    saldoAnterior !== 0 ? ((saldoTotal - saldoAnterior) / Math.abs(saldoAnterior)) * 100 : 0;
  const rentab =
    investidoAporteTotal > 0
      ? ((valorInvestido - investidoAporteTotal) / investidoAporteTotal) * 100
      : 0;

  // Saldo: tendência automática vs o fim do mês passado (não é navegação de data,
  // é só um termômetro de "como o caixa evoluiu").
  const elSaldo = document.getElementById('mp-kpi-saldo-delta');
  if (elSaldo) {
    const cls = deltaSaldo > 0.05 ? 'pos' : deltaSaldo < -0.05 ? 'neg' : 'neu';
    const seta = deltaSaldo > 0.05 ? '↑' : deltaSaldo < -0.05 ? '↓' : '·';
    elSaldo.className = 'mp-kpi-delta ' + cls;
    elSaldo.innerHTML = `${seta} ${mpFmtPct(deltaSaldo)} <span style="color:var(--cor-texto-mutado);font-weight:500;margin-left:3px">vs mês passado</span>`;
  }
  // Investido: rentabilidade acumulada (valor de mercado vs aportes).
  const elInv = document.getElementById('mp-kpi-investido-delta');
  if (elInv) {
    const cls = rentab > 0.05 ? 'pos' : rentab < -0.05 ? 'neg' : 'neu';
    const seta = rentab > 0.05 ? '↑' : rentab < -0.05 ? '↓' : '·';
    elInv.className = 'mp-kpi-delta ' + cls;
    elInv.innerHTML = `${seta} ${mpFmtPct(rentab)} <span style="color:var(--cor-texto-mutado);font-weight:500;margin-left:3px">rentab. total</span>`;
  }
}

function mpDestacar(cat) {
  mpEstado.categoriaDestaque = mpEstado.categoriaDestaque === cat ? null : cat;
  document.querySelectorAll('#mp-donut-legenda .mp-leg-item').forEach((el) => {
    el.classList.toggle(
      'dim',
      !!(mpEstado.categoriaDestaque && el.dataset.cat !== mpEstado.categoriaDestaque)
    );
  });
}

// Tipo (banco/corretora/carteira/outro) de uma instituição, a partir da CHAVE
// de agrupamento. Só resolve quando a chave é um conta.id cadastrado; para
// texto livre antigo ou "a-reconciliar" devolve null (sem badge de tipo).
function mpTipoInstituicao(key) {
  if (!key || key === 'a-reconciliar') return null;
  const c = typeof obterConta === 'function' ? obterConta(key) : null;
  if (!c || !c.tipo) return null;
  const mapa = {
    banco: { icon: 'ph-bank', label: 'Banco' },
    corretora: { icon: 'ph-chart-line-up', label: 'Corretora' },
    carteira: { icon: 'ph-wallet', label: 'Carteira' },
    outro: { icon: 'ph-bookmark-simple', label: 'Outro' },
  };
  return mapa[c.tipo] || { icon: 'ph-buildings', label: c.tipo };
}

// "Onde está o seu dinheiro" — o resumo consolidado por instituição. É o coração
// da foto: cada banco/corretora com o que tem de CAIXA livre + INVESTIDO, como
// um extrato unificado de todos os bancos. A cada pagamento/aporte/resgate o
// caixa da instituição certa muda, então estes números são sempre o "agora".
function mpRenderInstituicoes(consolidado) {
  const wrap = document.getElementById('mp-lista-inst');
  if (!wrap) return;
  const saldos = mpCalcularSaldoPorInstituicao(Date.now());
  // Une corretoras (investido) e contas (caixa) pela MESMA CHAVE — conta.id
  // quando resolvida, senão 'nome:<norm>' ou 'a-reconciliar'. Assim "Itaú" da
  // corretora e o salário na conta Itaú caem na mesma linha, e o total por
  // instituição contempla 100% do patrimônio (caixa + investido).
  const mapa = {};
  const merge = (key, label, campo, valor, classes) => {
    const k = key || 'a-reconciliar';
    if (!mapa[k])
      mapa[k] = { caixa: 0, investido: 0, label: label || 'A reconciliar', key: k, classes: {} };
    else if (label && mapa[k].label === 'A reconciliar') mapa[k].label = label;
    mapa[k][campo] += valor;
    if (classes)
      Object.keys(classes).forEach((cl) => {
        mapa[k].classes[cl] = (mapa[k].classes[cl] || 0) + classes[cl];
      });
  };
  Object.keys(consolidado.porInstituicao).forEach((k) => {
    const v = consolidado.porInstituicao[k];
    merge(k, v.label, 'investido', v.investido, v.classes);
  });
  Object.keys(saldos).forEach((k) => {
    const v = saldos[k];
    merge(k, v.label, 'caixa', v.caixa);
  });
  const arr = Object.values(mapa)
    .map((v) => ({
      key: v.key,
      nome: v.label,
      reconciliar: v.key === 'a-reconciliar',
      caixa: v.caixa,
      investido: v.investido,
      classes: v.classes,
      total: v.caixa + v.investido,
    }))
    .filter((x) => Math.abs(x.total) > 0.01)
    .sort((a, b) => b.total - a.total);
  if (!arr.length) {
    wrap.innerHTML =
      '<div class="mp-empty" style="padding:18px"><i class="ph ph-bank"></i>Sem dados por instituição. Cadastre suas contas e registre suas movimentações para ver a foto.</div>';
    return;
  }
  const totalGeral = arr.reduce((a, x) => a + x.total, 0);
  wrap.innerHTML = arr
    .map((x) => {
      const pct = totalGeral !== 0 ? (x.total / totalGeral) * 100 : 0;
      const tipo = mpTipoInstituicao(x.key);
      const tipoBadge = tipo
        ? `<span class="mp-inst-tipo"><i class="ph ${tipo.icon}"></i>${tipo.label}</span>`
        : '';
      const recon = x.reconciliar
        ? ' <span class="mp-inst-badge" style="background:var(--cor-erro);color:#fff;">A RECONCILIAR</span>'
        : '';
      const sub = x.reconciliar
        ? 'Movimentos sem instituição — informe o banco no lançamento'
        : `Caixa ${mpFmtBRL(x.caixa)} · Investido ${mpFmtBRL(x.investido)}`;
      // Detalhe: caixa + cada classe de investimento que ESTÁ nesta instituição,
      // para a pessoa ver exatamente o que tem em cada banco/corretora.
      const detalhe = [];
      if (x.caixa > 0.01)
        detalhe.push({ label: 'Caixa', valor: x.caixa, cor: mpCorCategoria('caixa') });
      Object.keys(x.classes || {}).forEach((cl) => {
        if (x.classes[cl] > 0.01)
          detalhe.push({
            label: MP_LABELS[cl] || cl,
            valor: x.classes[cl],
            cor: mpCorCategoria(cl),
          });
      });
      detalhe.sort((a, b) => b.valor - a.valor);
      const detalheHtml = detalhe.length
        ? `<div class="mp-inst-detalhe">${detalhe
            .map(
              (d) =>
                `<span class="mp-inst-chip"><span class="mp-leg-dot" style="background:${d.cor};margin-top:0;width:8px;height:8px;"></span>${d.label} <strong>${mpFmtBRL(d.valor)}</strong></span>`
            )
            .join('')}</div>`
        : '';
      return `
            <div class="mp-inst-item" style="flex-direction:column;align-items:stretch;gap:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                    <div style="min-width:0;">
                        <span class="mp-inst-nome">${x.nome} ${tipoBadge}${recon}</span>
                        <span class="mp-inst-sub" style="text-align:left;">${sub}</span>
                    </div>
                    <div style="text-align:right;flex-shrink:0;">
                        <span class="mp-inst-valor">${mpFmtBRL(x.total)}</span>
                        <span class="mp-inst-sub">${pct.toFixed(1)}%</span>
                    </div>
                </div>
                ${detalheHtml}
            </div>`;
    })
    .join('');
}

// "Total investido por classe" — a somatória GLOBAL de cada tipo de investimento
// (Renda Fixa, Ações, FIIs, BDRs, ETFs, Cripto, Previdência, Reserva). A soma
// destas linhas é exatamente o KPI "Total investido". Respeita o modo bruto/líquido.
function mpRenderClasses(consolidado) {
  const wrap = document.getElementById('mp-classes-lista');
  if (!wrap) return;
  const usarLiq = mpEstado.modo === 'liquido';
  const porCat = consolidado.porCategoriaExibicao || {};
  const itens = Object.keys(porCat)
    .map((cat) => ({
      cat,
      investido: porCat[cat].investido,
      atual: usarLiq ? porCat[cat].atualLiq : porCat[cat].atual,
    }))
    .filter((it) => it.atual > 0.01)
    .sort((a, b) => b.atual - a.atual);
  if (!itens.length) {
    wrap.innerHTML =
      '<div class="mp-empty" style="padding:18px"><i class="ph ph-chart-bar"></i>Nenhum investimento ainda. Registre um aporte em "Meus investimentos".</div>';
    return;
  }
  const total = itens.reduce((a, it) => a + it.atual, 0);
  wrap.innerHTML =
    itens
      .map((it) => {
        const lucro = it.atual - it.investido;
        const pct = it.investido > 0 ? (lucro / it.investido) * 100 : 0;
        const cls = pct > 0.05 ? 'pos' : pct < -0.05 ? 'neg' : 'neu';
        const share = total > 0 ? (it.atual / total) * 100 : 0;
        const cor = mpCorCategoria(it.cat);
        const seta = pct >= 0 ? 'trend-up' : 'trend-down';
        return `
            <div class="mp-inst-item">
                <div style="min-width:0;display:flex;align-items:center;gap:9px;">
                    <span class="mp-leg-dot" style="background:${cor};margin-top:0;"></span>
                    <div style="min-width:0;">
                        <span class="mp-inst-nome">${MP_LABELS[it.cat] || it.cat}</span>
                        <span class="mp-inst-sub" style="text-align:left;">${share.toFixed(1)}% do investido · <span class="mp-leg-pct ${cls}"><i class="ph-bold ph-${seta}"></i>${mpFmtPct(pct)}</span></span>
                    </div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                    <span class="mp-inst-valor">${mpFmtBRL(it.atual)}</span>
                </div>
            </div>`;
      })
      .join('') +
    `<div class="mp-classes-total"><span>Total investido</span><span class="mp-inst-valor">${mpFmtBRL(total)}</span></div>`;
}

function mpRenderDonut(consolidado) {
  const canvas = document.getElementById('mp-grafico-donut');
  const leg = document.getElementById('mp-donut-legenda');
  if (!canvas || !leg) return;
  if (typeof Chart === 'undefined') {
    leg.innerHTML = '<div class="mp-empty">Chart.js indisponível</div>';
    return;
  }
  const usarLiq = mpEstado.modo === 'liquido';
  // Itens = categorias investidas + Caixa (saldo em conta/salário). Incluir o
  // caixa faz o donut "Por categoria" representar 100% do patrimônio, igual às
  // barras — antes o dinheiro em conta ficava de fora da divisão.
  // Divisão por categoria com a Renda Variável quebrada (Ações/FIIs/Cripto...).
  const porCat = consolidado.porCategoriaExibicao || consolidado.porCategoria;
  const itens = Object.keys(porCat)
    .map((c) => ({
      cat: c,
      valor: usarLiq ? porCat[c].atualLiq : porCat[c].atual,
      investido: porCat[c].investido,
    }))
    .filter((it) => it.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  const saldoInst = mpCalcularSaldoPorInstituicao(Date.now());
  let caixaTotal = 0;
  Object.values(saldoInst).forEach((s) => {
    if (s.caixa > 0) caixaTotal += s.caixa;
  });
  if (caixaTotal > 0) itens.push({ cat: 'caixa', valor: caixaTotal, investido: caixaTotal });

  if (!itens.length) {
    leg.innerHTML = '<div class="mp-empty"><i class="ph ph-chart-pie"></i>Sem dados</div>';
    if (mpEstado.donutChart) {
      mpEstado.donutChart.destroy();
      mpEstado.donutChart = null;
    }
    return;
  }
  const labels = itens.map((it) => MP_LABELS[it.cat] || it.cat);
  const valores = itens.map((it) => it.valor);
  const cores = itens.map((it) => mpCorCategoria(it.cat));

  if (mpEstado.donutChart) mpEstado.donutChart.destroy();
  const totalDonut = valores.reduce((a, b) => a + b, 0);
  // Plugin local: escreve o total no furo central do donut (padrão premium).
  const centroTotalPlugin = {
    id: 'mpCentroTotal',
    afterDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = getToken('--cor-texto-mutado');
      ctx.font = "600 11px 'Figtree', sans-serif";
      ctx.fillText('TOTAL', cx, cy - 14);
      ctx.fillStyle = getToken('--cor-texto-principal');
      ctx.font = "700 18px 'DM Mono', monospace";
      ctx.fillText(mpFmtBRL(totalDonut), cx, cy + 6);
      ctx.restore();
    },
  };
  mpEstado.donutChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    plugins: [centroTotalPlugin],
    data: {
      labels,
      datasets: [
        {
          data: valores,
          backgroundColor: cores,
          // 4.7 — donut mais premium: segmentos arredondados, espaçados,
          // e um leve destaque ao passar o mouse.
          borderWidth: 3,
          borderColor: getToken('--cor-fundo-card'),
          borderRadius: 6,
          spacing: 2,
          hoverOffset: 10,
          hoverBorderColor: getToken('--cor-fundo-card'),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: { animateRotate: true, animateScale: true, duration: 600 },
      plugins: {
        legend: { display: false },
        // Desliga os rótulos crus do plugin global de datalabels que vazavam
        // sobre as fatias (ex.: "21.5000000006"). O total fica no centro.
        datalabels: { display: false },
        tooltip: {
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => {
              const share = totalDonut > 0 ? (ctx.parsed / totalDonut) * 100 : 0;
              return `${ctx.label}: ${mpFmtBRL(ctx.parsed)} (${share.toFixed(1)}%)`;
            },
          },
        },
      },
      onClick: (evt, els) => {
        if (!els.length) {
          mpEstado.categoriaDestaque = null;
          mpDestacar(null);
          return;
        }
        const i = els[0].index;
        mpDestacar(itens[i].cat);
      },
    },
  });
  // Gráfico único: a PIZZA mostra a divisão; cada linha da legenda (as
  // "barrinhas") traz o VALOR + a RENTABILIDADE da classe. Sem gráfico de
  // barras separado — toda a informação fica concentrada aqui.
  leg.innerHTML = itens
    .map((it, i) => {
      const ehCaixa = it.cat === 'caixa';
      const lucro = it.valor - it.investido;
      const pct = it.investido > 0 ? (lucro / it.investido) * 100 : 0;
      const cls = ehCaixa ? 'neu' : pct > 0.05 ? 'pos' : pct < -0.05 ? 'neg' : 'neu';
      const share = totalDonut > 0 ? (it.valor / totalDonut) * 100 : 0;
      const rentLabel = ehCaixa
        ? '<span class="mp-leg-pct neu">—</span>'
        : `<span class="mp-leg-pct ${cls}"><i class="ph-bold ph-${pct >= 0 ? 'trend-up' : 'trend-down'}"></i>${mpFmtPct(pct)}</span>`;
      return `
            <div class="mp-leg-item" data-cat="${it.cat}" onclick="mpDestacar('${it.cat}')">
                <span class="mp-leg-dot" style="background:${cores[i]}"></span>
                <div class="mp-leg-main">
                    <div class="mp-leg-top">
                        <span class="mp-leg-nome">${MP_LABELS[it.cat] || it.cat}</span>
                        <span class="mp-leg-rs">${mpFmtBRL(it.valor)}</span>
                    </div>
                    <div class="mp-leg-bottom">
                        <span class="mp-leg-bar"><span class="mp-leg-bar-fill" style="width:${Math.max(share, 2).toFixed(1)}%;background:${cores[i]}"></span></span>
                        <span class="mp-leg-share">${share.toFixed(1)}%</span>
                        ${rentLabel}
                    </div>
                </div>
            </div>`;
    })
    .join('');
}

// Função pública: orquestra render completo (ou skipFetch quando só muda modo).
// A foto monta de cima p/ baixo: KPIs → "Onde está o dinheiro" (por instituição)
// → divisão por categoria → Minhas Contas. Sem snapshot de fatura nem despesas
// (isso vive na aba Controle).
async function renderMeuPatrimonio(skipFetch) {
  // Aplica tema Chart.js se ainda não aplicado
  if (typeof aplicarTemaChartJs === 'function') aplicarTemaChartJs();
  if (!skipFetch) await mpFetchCotacoes();
  const janela = mpJanelaPeriodo();
  const consolidado = mpConsolidar();
  mpRenderKPIs(consolidado, janela);
  // Resumo consolidado por instituição (banco/corretora), com o detalhe das
  // classes que cada uma guarda — o coração da foto.
  mpRenderInstituicoes(consolidado);
  // Somatória de cada tipo de investimento (= KPI Total investido).
  mpRenderClasses(consolidado);
  // Gráfico único: o donut (pizza) traz a divisão e a legenda traz valor +
  // rentabilidade. O antigo gráfico de barras foi removido.
  mpRenderDonut(consolidado);
  if (typeof renderMinhasContas === 'function') renderMinhasContas();
}
