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
  cotacoes: {},
  ultimaCotacao: null,
  classesChart: null,
  // Quais instituições estão com o extrato expandido (mapa key→bool). Mantido no
  // estado para sobreviver a re-renders (atualização de cotação, por exemplo).
  extratoAberto: {},
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
  // Vírgula decimal: o app é em pt-BR e o valor ao lado ("R$ 24.000,00") já
  // usa a convenção brasileira — "+15.9%" ao lado dele destoava.
  return (v >= 0 ? '+' : '') + v.toFixed(casas).replace('.', ',') + '%';
}
// Percentual sem sinal (participação, fatia). Só para TEXTO: largura de barra
// em CSS continua com ponto, senão o style vira inválido e a barra some.
function mpPctBR(v, casas = 1) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return n.toFixed(casas).replace('.', ',') + '%';
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
  // Renda Fixa / Reserva: valoriza por juros compostos a partir do TEXTO de
  // rentabilidade ("110% CDI", "IPCA+6%"...) indexado ao BCB. A regra (somar todos
  // os aportes/resgates, capitalizar cada um por sua taxa mensal desde a data;
  // aportes sem data ou futuros entram pelo principal) vive em valorAtualRendaFixa,
  // compartilhada com a aba "Meus investimentos" para os dois números coincidirem.
  if (c.categoria === 'renda_fixa' || c.categoria === 'reserva_emergencia') {
    if (typeof valorAtualRendaFixa === 'function') return valorAtualRendaFixa(ticker, c.categoria);
    return c.valorTotalInvestido;
  }
  return c.valorTotalInvestido;
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
  // Sonho sai do caixa como uma despesa e não é uma: é dinheiro que a pessoa
  // guardou para si, com destino declarado. Contá-lo aqui fazia o indicador de
  // Despesa subir justamente no mês em que ela guardou mais — o mesmo erro que
  // as duas linhas acima já evitavam para o aporte. Quem debita o caixa é
  // mpTransacaoComputaCaixa, e lá o sonho continua debitando quando pago.
  if (categoria === 'sonho') return false;
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

// Data REAL de exibição de um lançamento no extrato (movimentações de caixa).
// Diferente de mpTimestampTransacao (que usa o 1º dia da competência para a
// inclusão/saldo): aqui queremos a data verdadeira do gasto, não "01/MM".
// Prioridade:
//   1) dataVencimento — a data informada pelo usuário; é incrementada por
//      parcela (dVenc.setMonth(+i)), logo é correta para recorrentes/parcelados.
//   2) data (instante de criação) SE cair no mesmo mês/ano da competência —
//      cobre o lançamento avulso feito no próprio mês (mostra o dia real).
//   3) 1º dia da competência (mes/ano) — fallback antigo (recorrentes sem
//      vencimento, cujo `data` é o instante de criação, igual p/ todas parcelas).
function mpDataMovimento(t) {
  if (t.dataVencimento) {
    const d = appliqueiParseData(t.dataVencimento);
    if (d && !isNaN(d.getTime())) return d.getTime();
  }
  if (t.data && typeof t.mes === 'number' && typeof t.ano === 'number') {
    const d = appliqueiParseData(t.data);
    if (d && !isNaN(d.getTime()) && d.getMonth() === t.mes && d.getFullYear() === t.ano)
      return d.getTime();
  }
  if (typeof t.mes === 'number' && typeof t.ano === 'number')
    return new Date(t.ano, t.mes, 1).getTime();
  if (t.data) {
    const d = appliqueiParseData(t.data);
    if (d && !isNaN(d.getTime())) return d.getTime();
  }
  return Date.now();
}

// Aporte externo (ver appliquei-utils.js). Fallback local para o caso de o
// módulo ser avaliado sozinho num sandbox de teste, sem utils carregado.
function mpEhAporteExterno(t) {
  if (typeof ehAporteExterno === 'function') return ehAporteExterno(t);
  return (
    !!t &&
    (t.categoria === 'investimento_fixo' || t.categoria === 'investimento_variavel') &&
    !!t.origemExterna
  );
}

// Quando o dinheiro de uma ENTRADA cai, para efeito de saldo.
//
// Só duas datas respondem isso: o vencimento informado pela pessoa e, na falta
// dele, a competência. O campo `data` NÃO entra, e essa distinção custou uma
// suíte vermelha para ficar clara — mpDataMovimento cai para ele quando não há
// vencimento, e ele é carimbo de escrituração, não data do dinheiro:
//
//   · criarTransferencia normaliza para MEIO-DIA (`+ 'T12:00:00'`, fuso-seguro).
//     Uma transferência feita de manhã nascia doze horas no futuro: a perna de
//     saída entrava no caixa pela competência e a de entrada não entrava por
//     nada, e o patrimônio encolhia pelo valor transferido numa operação que só
//     reorganiza dinheiro. O mesmo vale para o resgate que o aporte por migração
//     de um sonho gera.
//   · num lançamento recorrente, `data` é o instante em que as 60 parcelas foram
//     criadas — igual para todas, e sem relação com o mês de cada uma.
//
// Sem vencimento, a competência é a melhor informação que existe, e é o
// comportamento que o app sempre teve.
function mpQuandoEntraNoCaixa(t) {
  if (t && t.dataVencimento) {
    const d = appliqueiParseData(t.dataVencimento);
    if (d && !isNaN(d.getTime())) return d.getTime();
  }
  return mpTimestampTransacao(t);
}

// Decide se uma transação já compõe o caixa/saldo em conta até `refMs`.
// Entradas (receita/salário, resgates, transferências de entrada) NÃO têm
// botão "pago" no Controle — são lançadas já recebidas, logo contam pela data.
// Saídas (despesas, aportes, transferências de saída) só abatem o caixa
// quando efetivamente pagas. Antes deste ajuste, o salário ficava `pago:false`
// para sempre e nunca aparecia no Patrimônio.
//
// "PELA DATA" É A DATA DO DINHEIRO, NÃO A DA COMPETÊNCIA. É o que esta função
// dizia e não fazia: usava mpTimestampTransacao para todo mundo, e ela devolve
// sempre o 1º dia do mês da competência. Com isso, no dia 1º o salário que cai
// no dia 10 já estava no "Saldo em conta" do Meu Patrimônio — dinheiro que a
// pessoa ainda não tem, na dobra da tela que existe para responder quanto ela
// tem. Entrada passa a olhar o VENCIMENTO informado (mpQuandoEntraNoCaixa).
//
// Saída continua pela competência porque quem a governa é `pago`: ela só entra
// na conta depois de a pessoa dar baixa, e a baixa acontece no dia real.
function mpTransacaoComputaCaixa(t, refMs) {
  const ehEntrada = mpEhEntradaCaixa(t.categoria);
  const quando = ehEntrada ? mpQuandoEntraNoCaixa(t) : mpTimestampTransacao(t);
  if (quando > refMs) return false;
  // Fase 3B: aporte cujo débito de caixa já é representado por uma perna de
  // transferência (transferencia_saida com contaId) NÃO conta aqui — senão
  // haveria duplo-débito. O `investimento_*` permanece só para a carteira/DRE.
  if (
    (t.categoria === 'investimento_fixo' || t.categoria === 'investimento_variavel') &&
    t.temLegCaixa
  )
    return false;
  // Aporte externo: dinheiro que nunca passou por conta cadastrada. Não há
  // caixa a debitar — nem duplo, nem simples. É o padrão C-sem-perna (INV-03)
  // aplicado à parcela recorrente. Só para APORTE: uma despesa com a marca
  // saiu de algum lugar e tem de continuar debitando (mesma regra do INV-01).
  // O predicado é o de appliquei-utils.js — mesma regra usada pelo Controle
  // Financeiro e pelo saldo projetado das contas.
  if (mpEhAporteExterno(t)) return false;
  if (ehEntrada) return true;
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

// Consolida tudo numa única passagem: { porCategoria:{cat:{investido, atual}}, porInstituicao, totalInvestido, totalAtual }
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
  };
  Object.entries(resumo).forEach(([ticker, c]) => {
    if (!c || !(c.qtdTotal > 0)) return;
    c.__ticker = ticker;
    const cat = c.categoria || 'renda_variavel';
    const atual = mpValorAtualAtivo(ticker, c);
    // Posição sem cotação totalmente resgatada (valor ~0) não entra na foto.
    if (
      (cat === 'renda_fixa' || cat === 'reserva_emergencia' || cat === 'previdencia') &&
      atual < 0.01
    )
      return;
    if (!acc.porCategoria[cat]) acc.porCategoria[cat] = { investido: 0, atual: 0, ativos: 0 };
    acc.porCategoria[cat].investido += c.valorTotalInvestido;
    acc.porCategoria[cat].atual += atual;
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
      acc.porCategoriaExibicao[catExib] = { investido: 0, atual: 0, ativos: 0 };
    acc.porCategoriaExibicao[catExib].investido += c.valorTotalInvestido;
    acc.porCategoriaExibicao[catExib].atual += atual;
    acc.porCategoriaExibicao[catExib].ativos += 1;
    acc.totalInvestido += c.valorTotalInvestido;
    acc.totalAtual += atual;
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
    acc.porTicker.push({ ticker, c, atual });
  });
  return acc;
}

// Fonte única de verdade do patrimônio investido. Soma TODAS as categorias
// (renda fixa + renda variável + previdência + reserva de emergência), para
// que o card "Total Investimento" nunca reflita apenas uma delas. Construída
// sobre mpConsolidar() para reaproveitar cotações/projeções.
function calcularPatrimonioTotal() {
  const cons =
    typeof mpConsolidar === 'function'
      ? mpConsolidar()
      : { porCategoria: {}, totalInvestido: 0, totalAtual: 0 };
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
    totalPatrimonio: cons.totalAtual || 0,
    totalBens: typeof totalBensAtual === 'function' ? totalBensAtual() : 0,
    porCategoria: cat,
  };
}

// Mantido por compatibilidade com chamadas antigas; o filtro agora é por mês.
function mpAlterarPeriodo() {
  renderMeuPatrimonio(true);
}
// Quanto uma parcela representa do patrimônio, em 0-100. Devolve `null`
// quando não há total: sem base, "0,0%" sugeriria fatia nula quando o que não
// existe é o bolo. Presa em 0-100 porque o saldo em conta pode ficar negativo
// de verdade (conta no vermelho) e o valor de um bem pode vir digitado errado
// — nem um nem outro deve puxar a barrinha para fora do trilho.
function mpFatiaDoTotal(valor, total) {
  const t = Number(total) || 0;
  if (!(t > 0)) return null;
  const v = Number(valor) || 0;
  return Math.max(0, Math.min(100, (v / t) * 100));
}

// Pinta, dentro do card de um componente, a fatia que ele ocupa do total: a
// barrinha e o "x% do total".
function mpPintarFatia(chave, valor, total) {
  const fill = document.getElementById('mp-kpi-' + chave + '-fatia-fill');
  const rotulo = document.getElementById('mp-kpi-' + chave + '-fatia');
  const pct = mpFatiaDoTotal(valor, total);
  if (fill) fill.style.width = (pct === null ? 0 : pct).toFixed(1) + '%';
  if (rotulo) {
    rotulo.textContent = pct === null ? '—' : mpPctBR(pct) + ' do total';
  }
}

function mpRenderKPIs(consolidado, janela) {
  const patr =
    typeof calcularPatrimonioTotal === 'function' ? calcularPatrimonioTotal() : consolidado;
  const valorInvestido = patr.totalAtual;
  const saldoTotal = mpCalcularSaldoTotal(janela.fimMs);

  var totalImoveis = 0;
  var totalVeiculos = 0;
  var qtdImoveis = 0;
  var qtdVeiculos = 0;
  if (typeof bensAtivos === 'function') {
    bensAtivos().forEach(function (b) {
      if (b.tipo === 'imovel') {
        totalImoveis += b.valorAtual || 0;
        qtdImoveis++;
      } else if (b.tipo === 'veiculo') {
        totalVeiculos += b.valorAtual || 0;
        qtdVeiculos++;
      } else {
        totalVeiculos += b.valorAtual || 0;
        qtdVeiculos++;
      }
    });
  }
  const valorBens = totalImoveis + totalVeiculos;
  const patrimonioTotal = saldoTotal + valorInvestido + valorBens;
  const saldoAnterior = mpCalcularSaldoTotal(janela.anteriorFimMs);
  const investidoAporteTotal = patr.totalInvestido;

  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = mpFmtBRL(v);
  };
  setText('mp-kpi-patrimonio-valor', patrimonioTotal);
  setText('mp-kpi-saldo-valor', saldoTotal);
  setText('mp-kpi-investido-valor', valorInvestido);
  setText('mp-kpi-imoveis-valor', totalImoveis);
  setText('mp-kpi-veiculos-valor', totalVeiculos);

  const subPatr = document.getElementById('mp-kpi-patrimonio-sub');
  if (subPatr) {
    subPatr.className = 'mp-kpi-sub';
    // A linha listava "saldo + investimentos + imóveis + veículos" — exatamente
    // o que a legenda da composição, agora ao lado, já diz com nome, valor e
    // porcentagem. No lugar dela vai a data da posição: o total usa cotação de
    // mercado, então "de quando é este número" não era dito em lugar nenhum.
    const refMs = janela && isFinite(janela.fimMs) ? janela.fimMs : Date.now();
    subPatr.innerHTML =
      '<i class="ph ph-clock-counter-clockwise"></i> Posição de ' +
      new Date(refMs).toLocaleDateString('pt-BR');
  }

  var compBar = document.getElementById('mp-composition-bar');
  if (compBar && patrimonioTotal > 0) {
    var segs = [];
    if (saldoTotal > 0)
      segs.push({ label: 'Saldo em conta', valor: saldoTotal, cor: 'var(--cor-primaria)' });
    if (valorInvestido > 0)
      segs.push({ label: 'Investimentos', valor: valorInvestido, cor: 'var(--cor-patrimonio)' });
    if (totalImoveis > 0) segs.push({ label: 'Imóveis', valor: totalImoveis, cor: '#f59e0b' });
    if (totalVeiculos > 0) segs.push({ label: 'Veículos', valor: totalVeiculos, cor: '#64748b' });
    var barHtml = '<div class="mp-composition-bar">';
    segs.forEach(function (s) {
      var pct = (s.valor / patrimonioTotal) * 100;
      barHtml +=
        // A largura vai em CSS: ponto decimal, senão o style é inválido e o
        // segmento some. Só o texto do title é que fica em pt-BR.
        '<div class="mp-composition-seg" style="width:' +
        pct.toFixed(1) +
        '%;background:' +
        s.cor +
        ';" title="' +
        s.label +
        ': ' +
        mpFmtBRL(s.valor) +
        ' (' +
        mpPctBR(pct) +
        ')"></div>';
    });
    barHtml += '</div>';
    // Legenda em 3 colunas: fatia, quanto é em R$, quanto é do total. A
    // porcentagem sozinha não responde "de quanto estamos falando".
    barHtml += '<div class="mp-composition-legend">';
    segs.forEach(function (s) {
      var pct = (s.valor / patrimonioTotal) * 100;
      barHtml +=
        '<span class="mp-composition-legend-item"><span class="mp-leg-dot" style="background:' +
        s.cor +
        ';"></span>' +
        s.label +
        '</span>' +
        '<span class="mp-leg-valor">' +
        mpFmtBRL(s.valor) +
        '</span>' +
        '<span class="mp-leg-share">' +
        mpPctBR(pct) +
        '</span>';
    });
    barHtml += '</div>';
    compBar.innerHTML = barHtml;
  } else if (compBar) {
    compBar.innerHTML = '';
  }

  // Fatia de cada componente no total, repetida dentro do próprio card.
  mpPintarFatia('saldo', saldoTotal, patrimonioTotal);
  mpPintarFatia('investido', valorInvestido, patrimonioTotal);
  mpPintarFatia('imoveis', totalImoveis, patrimonioTotal);
  mpPintarFatia('veiculos', totalVeiculos, patrimonioTotal);

  const deltaSaldo =
    saldoAnterior !== 0 ? ((saldoTotal - saldoAnterior) / Math.abs(saldoAnterior)) * 100 : 0;
  const rentab =
    investidoAporteTotal > 0
      ? ((valorInvestido - investidoAporteTotal) / investidoAporteTotal) * 100
      : 0;

  const elSaldo = document.getElementById('mp-kpi-saldo-delta');
  if (elSaldo) {
    const cls = deltaSaldo > 0.05 ? 'pos' : deltaSaldo < -0.05 ? 'neg' : 'neu';
    const seta = deltaSaldo > 0.05 ? '↑' : deltaSaldo < -0.05 ? '↓' : '·';
    elSaldo.className = 'mp-kpi-delta ' + cls;
    elSaldo.innerHTML = `${seta} ${mpFmtPct(deltaSaldo)} <span style="color:var(--cor-texto-secundario);font-weight:500;margin-left:3px">vs mês passado</span>`;
  }
  const elInv = document.getElementById('mp-kpi-investido-delta');
  if (elInv) {
    const cls = rentab > 0.05 ? 'pos' : rentab < -0.05 ? 'neg' : 'neu';
    const seta = rentab > 0.05 ? '↑' : rentab < -0.05 ? '↓' : '·';
    elInv.className = 'mp-kpi-delta ' + cls;
    elInv.innerHTML = `${seta} ${mpFmtPct(rentab)} <span style="color:var(--cor-texto-secundario);font-weight:500;margin-left:3px">rentab. total</span>`;
  }
  const elImov = document.getElementById('mp-kpi-imoveis-qtd');
  if (elImov) {
    elImov.className = 'mp-kpi-delta neu';
    elImov.textContent = qtdImoveis + ' imóve' + (qtdImoveis === 1 ? 'l' : 'is');
  }
  const elVeic = document.getElementById('mp-kpi-veiculos-qtd');
  if (elVeic) {
    elVeic.className = 'mp-kpi-delta neu';
    elVeic.textContent = qtdVeiculos + ' veículo' + (qtdVeiculos === 1 ? '' : 's');
  }
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

// Rótulo legível de uma categoria de transação, usado como fallback no extrato
// quando a transação não tem `descricao`.
function mpCategoriaLabelMov(cat) {
  const m = {
    receita: 'Receita',
    dividendo: 'Dividendo',
    resgate_investimento: 'Resgate de investimento',
    transferencia_entrada: 'Transferência recebida',
    transferencia_saida: 'Transferência enviada',
    despesa_fixa: 'Despesa fixa',
    despesa_variavel: 'Despesa',
    cartao_credito: 'Cartão de crédito',
    investimento_fixo: 'Aporte',
    investimento_variavel: 'Aporte',
    sonho: 'Sonho',
    previdencia: 'Previdência',
  };
  return m[cat] || 'Movimentação';
}

// Extrato de CAIXA de uma instituição (mesma chave de agrupamento do "Onde está
// o dinheiro"): saldo de abertura + cada movimento que compõe o caixa, em ordem
// cronológica, com o saldo corrente após cada lançamento. É o mesmo universo que
// mpCalcularSaldoPorInstituicao soma — aqui detalhado linha a linha.
function mpExtratoInstituicao(key, refMs) {
  const movs = [];
  if (typeof contasAtivas === 'function') {
    contasAtivas().forEach((c) => {
      if (c.id !== key) return;
      const sIni = mpSaldoInicialConta(c, refMs);
      if (sIni) {
        const ts = c.dataSaldoInicial ? appliqueiParseData(c.dataSaldoInicial).getTime() : 0;
        movs.push({
          ts: isFinite(ts) ? ts : 0,
          desc: 'Saldo inicial',
          valor: sIni,
          abertura: true,
        });
      }
    });
  }
  if (typeof transacoes !== 'undefined') {
    transacoes.forEach((t) => {
      if (!mpTransacaoComputaCaixa(t, refMs)) return;
      if (mpChaveInstTransacao(t).key !== key) return;
      const valor = Number(t.valor) || 0;
      const entrada = mpEhEntradaCaixa(t.categoria);
      movs.push({
        ts: mpDataMovimento(t),
        desc: t.descricao || mpCategoriaLabelMov(t.categoria),
        categoria: t.categoria,
        valor: entrada ? valor : -valor,
      });
    });
  }
  movs.sort((a, b) => a.ts - b.ts);
  let saldo = 0;
  movs.forEach((m) => {
    saldo += m.valor;
    m.saldoApos = saldo;
  });
  return movs;
}

// Rótulo/cor do TIPO de uma movimentação do extrato (cartão, variável, fixo,
// receita, aporte...). Alimenta o badge de cada linha e o resumo "quitado".
function mpTipoMovInfo(categoria, abertura) {
  if (abertura) return null;
  const mapa = {
    cartao_credito: { label: 'Cartão', cls: 'cartao' },
    despesa_variavel: { label: 'Variável', cls: 'variavel' },
    despesa_fixa: { label: 'Fixo', cls: 'fixo' },
    receita: { label: 'Receita', cls: 'receita' },
    dividendo: { label: 'Dividendo', cls: 'receita' },
    resgate_investimento: { label: 'Resgate', cls: 'receita' },
    transferencia_entrada: { label: 'Transferência', cls: 'transf' },
    transferencia_saida: { label: 'Transferência', cls: 'transf' },
    investimento_fixo: { label: 'Aporte', cls: 'aporte' },
    investimento_variavel: { label: 'Aporte', cls: 'aporte' },
    previdencia: { label: 'Previdência', cls: 'aporte' },
    sonho: { label: 'Sonho', cls: 'aporte' },
  };
  return mapa[categoria] || null;
}

// HTML do extrato (mais recente primeiro). Limita o número de linhas no DOM.
function mpRenderExtratoHtml(movs) {
  const fmtData = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    return (
      String(d.getDate()).padStart(2, '0') +
      '/' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '/' +
      d.getFullYear()
    );
  };
  // Badge do tipo (Cartão/Variável/Fixo/Receita/Aporte...) ao lado da data.
  const badge = (m) => {
    const ti = mpTipoMovInfo(m.categoria, m.abertura);
    return ti ? ` <span class="mp-mov-tipo ${ti.cls}">${ti.label}</span>` : '';
  };
  const linhaInfo = (m) =>
    `<div class="mp-extrato-info"><span class="mp-extrato-desc">${m.desc}</span><span class="mp-extrato-meta"><span class="mp-extrato-data">${fmtData(m.ts)}</span>${badge(m)}</span></div>`;

  if (!movs.length) {
    return '<div class="mp-extrato-vazio"><i class="ph ph-receipt"></i> Sem movimentações de caixa nesta instituição.</div>';
  }

  // "Observação": o que foi QUITADO (GASTO) por esta conta, separado por tipo
  // (Fixo / Variável / Cartão). Só despesas de consumo entram — transferências
  // entre contas próprias e aportes de investimento NÃO são gasto quitado
  // (apenas movem/aplicam dinheiro), então ficam fora deste resumo.
  const quit = { fixo: 0, variavel: 0, cartao: 0 };
  movs.forEach((m) => {
    if (m.abertura || m.valor >= 0) return; // só saídas
    const v = -m.valor;
    if (m.categoria === 'cartao_credito') quit.cartao += v;
    else if (m.categoria === 'despesa_variavel') quit.variavel += v;
    else if (m.categoria === 'despesa_fixa') quit.fixo += v;
  });
  const chip = (cls, label, val) =>
    val > 0.005
      ? `<span class="mp-quit-chip ${cls}">${label} <strong>${mpFmtBRL(val)}</strong></span>`
      : '';
  const chips = [
    chip('fixo', 'Fixo', quit.fixo),
    chip('variavel', 'Variável', quit.variavel),
    chip('cartao', 'Cartão', quit.cartao),
  ].join('');
  const totalQuit = quit.fixo + quit.variavel + quit.cartao;
  const resumoHtml = chips
    ? `<div class="mp-extrato-resumo"><span class="mp-extrato-resumo-tit"><i class="ph ph-list-checks"></i> Quitado por esta conta · <strong>${mpFmtBRL(totalQuit)}</strong></span><div class="mp-extrato-resumo-chips">${chips}</div></div>`
    : '';

  const MAX = 200;
  const linhas = movs.slice().reverse(); // mais recente primeiro
  const visiveis = linhas.slice(0, MAX);
  let html = visiveis
    .map((m) => {
      const pos = m.valor >= 0;
      const cls = m.abertura ? 'neu' : pos ? 'pos' : 'neg';
      const sinal = m.abertura ? '' : pos ? '+ ' : '− ';
      return `<div class="mp-extrato-linha">
                ${linhaInfo(m)}
                <div class="mp-extrato-vals">
                    <span class="mp-extrato-valor ${cls}">${sinal}${mpFmtBRL(Math.abs(m.valor))}</span>
                    <span class="mp-extrato-saldo">saldo ${mpFmtBRL(m.saldoApos)}</span>
                </div>
            </div>`;
    })
    .join('');
  if (linhas.length > MAX) {
    html += `<div class="mp-extrato-vazio">+ ${linhas.length - MAX} movimentações anteriores</div>`;
  }
  return resumoHtml + html;
}

// Recolhe/expande o extrato de uma instituição. Usa o índice renderizado para
// achar a chave (evita escapar nomes com espaço/acento no onclick) e guarda o
// estado em mpEstado.extratoAberto para sobreviver a re-renders.
function mpToggleExtrato(i) {
  const key = (mpEstado._extratoKeys || [])[i];
  if (key == null) return;
  if (!mpEstado.extratoAberto) mpEstado.extratoAberto = {};
  const aberto = !mpEstado.extratoAberto[key];
  mpEstado.extratoAberto[key] = aberto;
  const body = document.getElementById('mp-extrato-' + i);
  const chev = document.getElementById('mp-chev-' + i);
  if (body) body.style.display = aberto ? 'flex' : 'none';
  if (chev) chev.classList.toggle('aberto', aberto);
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
      '<div class="mp-empty"><i class="ph ph-bank"></i>Sem dados por instituição.<br><span style="font-size:11.5px;margin-top:4px;display:inline-block;">Cadastre suas contas abaixo e registre movimentações para ver a foto completa.</span></div>';
    return;
  }
  const totalGeral = arr.reduce((a, x) => a + x.total, 0);
  // Mapa índice→chave usado pelo toggle do extrato (evita escapar nomes no onclick).
  mpEstado._extratoKeys = arr.map((x) => x.key);
  wrap.innerHTML = arr
    .map((x, i) => {
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
      // Avatar premium: ícone do tipo (banco/corretora/...) ou a inicial do nome,
      // numa cor estável derivada da chave da instituição.
      const accent = mpCorInstituicao(x.key, x.reconciliar);
      const avatarInner = tipo
        ? `<i class="ph ${tipo.icon}"></i>`
        : x.reconciliar
          ? '<i class="ph ph-warning"></i>'
          : mpIniciaisInstituicao(x.nome);
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
      // Extrato (movimentações de caixa) recolhível por instituição.
      const aberto = !!(mpEstado.extratoAberto && mpEstado.extratoAberto[x.key]);
      const extratoHtml = mpRenderExtratoHtml(mpExtratoInstituicao(x.key, Date.now()));
      const tituloExtrato = '<i class="ph ph-receipt"></i> Extrato — movimentações de caixa';
      return `
            <div class="mp-inst-item mp-inst-collapsible">
                <div class="mp-inst-head" onclick="mpToggleExtrato(${i})" title="Ver extrato">
                    <div class="mp-inst-head-left">
                        <i class="ph ph-caret-right mp-inst-chevron${aberto ? ' aberto' : ''}" id="mp-chev-${i}"></i>
                        <span class="mp-inst-avatar" style="--mp-accent:${accent};">${avatarInner}</span>
                        <div class="mp-inst-meta">
                            <span class="mp-inst-nome">${x.nome} ${tipoBadge}${recon}</span>
                            <span class="mp-inst-sub" style="text-align:left;">${sub}</span>
                            <span class="mp-inst-share" title="${mpPctBR(pct)} do patrimônio"><span class="mp-inst-share-fill" style="width:${Math.max(2, Math.min(100, pct)).toFixed(1)}%;background:${accent};"></span></span>
                        </div>
                    </div>
                    <div class="mp-inst-head-right">
                        <span class="mp-inst-valor">${mpFmtBRL(x.total)}</span>
                        <span class="mp-inst-sub">${mpPctBR(pct)}</span>
                    </div>
                </div>
                ${detalheHtml}
                <div class="mp-inst-extrato" id="mp-extrato-${i}" style="display:${aberto ? 'flex' : 'none'}">
                    <div class="mp-extrato-titulo">${tituloExtrato}</div>
                    ${extratoHtml}
                </div>
            </div>`;
    })
    .join('');
}

// Cor estável (determinística) para o avatar de uma instituição, derivada da
// chave — mesma instituição mantém sempre a mesma cor entre renders.
function mpCorInstituicao(key, reconciliar) {
  if (reconciliar) return 'var(--cor-erro)';
  const paleta = [
    '#059669',
    '#2563eb',
    '#7c3aed',
    '#d97706',
    '#0891b2',
    '#db2777',
    '#65a30d',
    '#dc2626',
  ];
  let h = 0;
  const s = String(key || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return paleta[h % paleta.length];
}

// Iniciais do nome da instituição para o avatar (quando não há ícone de tipo).
function mpIniciaisInstituicao(nome) {
  const palavras = String(nome || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!palavras.length) return '?';
  if (palavras.length === 1) return palavras[0].slice(0, 2).toUpperCase();
  return (palavras[0][0] + palavras[1][0]).toUpperCase();
}

function mpRenderClasses(consolidado) {
  var canvas = document.getElementById('mp-grafico-classes');
  var wrap = document.getElementById('mp-classes-lista');
  if (!canvas) return;
  var porCat = consolidado.porCategoriaExibicao || {};
  var itens = Object.keys(porCat)
    .map(function (cat) {
      return {
        cat: cat,
        investido: porCat[cat].investido,
        atual: porCat[cat].atual,
      };
    })
    .filter(function (it) {
      return it.atual > 0.01;
    })
    .sort(function (a, b) {
      return b.atual - a.atual;
    });

  if (!itens.length) {
    canvas.style.display = 'none';
    if (wrap)
      wrap.innerHTML =
        '<div class="mp-empty" style="padding:18px"><i class="ph ph-chart-bar"></i>Nenhum investimento ainda. Registre um aporte em "Meus investimentos".</div>';
    return;
  }
  canvas.style.display = '';
  if (wrap) wrap.innerHTML = '';

  var total = itens.reduce(function (a, it) {
    return a + it.atual;
  }, 0);
  var labels = itens.map(function (it) {
    return MP_LABELS[it.cat] || it.cat;
  });
  var valores = itens.map(function (it) {
    return it.atual;
  });
  var cores = itens.map(function (it) {
    return mpCorCategoria(it.cat);
  });

  if (typeof Chart === 'undefined') {
    if (wrap) wrap.innerHTML = '<div class="mp-empty">Chart.js indisponível</div>';
    return;
  }

  if (mpEstado.classesChart) mpEstado.classesChart.destroy();

  var barHeight = 38;
  canvas.parentElement.style.height = Math.max(180, itens.length * barHeight + 50) + 'px';

  mpEstado.classesChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          data: valores,
          backgroundColor: cores,
          borderRadius: 6,
          borderSkipped: false,
          barThickness: 22,
          maxBarThickness: 28,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      layout: { padding: { right: 150 } },
      scales: {
        x: {
          display: false,
          grid: { display: false },
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            font: { family: "'Figtree', sans-serif", size: 12, weight: '600' },
            color: typeof getToken === 'function' ? getToken('--cor-texto-principal') : '#1e293b',
          },
        },
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: 'end',
          align: 'right',
          clip: false,
          offset: 6,
          font: { family: "'DM Mono', monospace", size: 11, weight: '700' },
          color: typeof getToken === 'function' ? getToken('--cor-texto-principal') : '#1e293b',
          formatter: function (value) {
            var share = total > 0 ? (value / total) * 100 : 0;
            return mpFmtBRL(value) + '  ' + mpPctBR(share);
          },
        },
        tooltip: {
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: function (ctx) {
              var it = itens[ctx.dataIndex];
              var lucro = it.atual - it.investido;
              var pct = it.investido > 0 ? (lucro / it.investido) * 100 : 0;
              var share = total > 0 ? (it.atual / total) * 100 : 0;
              return mpFmtBRL(it.atual) + ' (' + share.toFixed(1) + '%) · rent. ' + mpFmtPct(pct);
            },
          },
        },
      },
    },
  });

  if (wrap) {
    wrap.innerHTML =
      '<div class="mp-classes-total"><span>Total investido</span><span class="mp-inst-valor">' +
      mpFmtBRL(total) +
      '</span></div>';
  }
}

// Remove transações 'tx_origem_*' cujo aporte correspondente já não existe.
// Corrige saldo para quem excluiu investimento antes do fix na exclusão.
function mpLimparTxOrigemOrfas() {
  if (typeof transacoes === 'undefined' || typeof historicoCompras === 'undefined') return;
  var idsCompras = new Set();
  historicoCompras.forEach(function (op) {
    idsCompras.add(String(op.id));
  });
  var antes = transacoes.length;
  transacoes = transacoes.filter(function (t) {
    // Perna de caixa órfã.
    if (typeof t.id === 'string' && t.id.indexOf('tx_origem_') === 0) {
      return idsCompras.has(t.id.replace('tx_origem_', ''));
    }
    // Perna do ATIVO órfã. A exclusão de operação já remove as duas pernas
    // (renda-fixa.js:confirmarExclusaoOperacao); esta rede só existe para dado
    // que chegou torto por outro caminho. Limpar só a perna de caixa deixava a
    // do ativo de pé com temLegCaixa — que manda o patrimônio ignorá-la no
    // caixa — e a compra ficava sem debitar nada (INV-03).
    if (t.operacaoId != null && !idsCompras.has(String(t.operacaoId))) return false;
    return true;
  });
  if (transacoes.length < antes) {
    // salvarNaNuvem() era chamada aqui e NÃO EXISTE em lugar nenhum do bundle —
    // o guard `typeof === 'function'` a transformava num no-op silencioso. A
    // sincronização vem do interceptador de setItem; não se acrescenta flush
    // porque esta limpeza roda a cada render do Meu Patrimônio.
    salvarTransacoes();
  }
}

async function renderMeuPatrimonio(skipFetch) {
  if (typeof aplicarTemaChartJs === 'function') aplicarTemaChartJs();
  if (typeof normalizarDespesasProgramadas === 'function') normalizarDespesasProgramadas();
  mpLimparTxOrigemOrfas();
  if (!skipFetch) await mpFetchCotacoes();
  const janela = mpJanelaPeriodo();
  const consolidado = mpConsolidar();
  mpRenderKPIs(consolidado, janela);
  // Resumo consolidado por instituição (banco/corretora), com o detalhe das
  // classes que cada uma guarda — o coração da foto.
  mpRenderInstituicoes(consolidado);
  // Somatória de cada tipo de investimento (= KPI Total investido) — gráfico de barras.
  mpRenderClasses(consolidado);
  if (typeof renderMinhasContas === 'function') renderMinhasContas();
  if (typeof renderMeusBens === 'function') renderMeusBens();
  if (!skipFetch && typeof bemAtualizarFipeAuto === 'function') bemAtualizarFipeAuto();
}
