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
  // Saída paga: a data do dinheiro é a do PAGAMENTO, não a do vencimento —
  // conta paga adiantada ou atrasada aparece no extrato no dia em que saiu.
  if (!mpEhEntradaCaixa(t.categoria)) {
    const pagoEm = typeof appliqueiPagoEmMs === 'function' ? appliqueiPagoEmMs(t) : null;
    if (pagoEm != null) return pagoEm;
  }
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
    if (d && !isNaN(d.getTime())) {
      // Data sem hora ("2026-11-09") é lida ao meio-dia (appliqueiParseData);
      // para o caixa, a entrada do dia conta desde o começo dele. Sem isto,
      // "Já caiu" de manhã só mexia no saldo depois das 12h.
      if (
        typeof t.dataVencimento === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(t.dataVencimento.trim())
      )
        d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
  }
  return mpTimestampTransacao(t);
}

// Quando uma SAÍDA deixa o caixa. Paga com data de baixa (`pagoEm`): no dia do
// pagamento. Antes era sempre o 1º dia da competência, e quem pagava em 15/10
// a conta de novembro via o saldo do banco no app só cair em 1º/11 — dinheiro
// que já tinha saído aparecia como disponível. Sem `pagoEm` (lançamento antigo,
// ou despesa à vista que nasce paga), segue a competência, como sempre foi.
function mpQuandoSaiDoCaixa(t) {
  const pagoEm = typeof appliqueiPagoEmMs === 'function' ? appliqueiPagoEmMs(t) : null;
  return pagoEm != null ? pagoEm : mpTimestampTransacao(t);
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
// Saída é governada por `pago` e entra no caixa no dia da baixa
// (mpQuandoSaiDoCaixa); sem a data da baixa, pela competência.
function mpTransacaoComputaCaixa(t, refMs) {
  const ehEntrada = mpEhEntradaCaixa(t.categoria);
  const quando = ehEntrada ? mpQuandoEntraNoCaixa(t) : mpQuandoSaiDoCaixa(t);
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

// Ajustes de saldo de uma conta (fluxo "Conferir saldo"): a diferença entre o
// que o app calculava e o que a pessoa viu no app do banco, registrada no dia
// da conferência. Mora na CONTA, não em `transacoes`, de propósito: ajuste não
// é receita nem despesa — não pode entrar no resultado do mês, na Projeção, no
// relatório nem nos insights. Só o caixa da conta o enxerga. Valor com sinal.
function mpAjustesConta(c, refMs) {
  if (!c || !Array.isArray(c.ajustes)) return [];
  return c.ajustes.filter((a) => {
    if (!a || !isFinite(Number(a.valor)) || !Number(a.valor)) return false;
    const ts = a.data ? new Date(a.data).getTime() : 0;
    return !(isFinite(ts) && ts > refMs);
  });
}
function mpSomaAjustesConta(c, refMs) {
  return mpAjustesConta(c, refMs).reduce((s, a) => s + Number(a.valor), 0);
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
      saldo += mpSaldoInicialConta(c, refMs) + mpSomaAjustesConta(c, refMs);
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
      const sIni = mpSaldoInicialConta(c, refMs) + mpSomaAjustesConta(c, refMs);
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

// Cotações: a mesma fonte das outras telas (atualizarCotacoes, em
// appliquei-yahoo-finance.js), que cota TODOS os ativos de renda variável e
// preenche mpEstado.cotacoes. Antes esta tela tinha a própria busca, com
// outro filtro de ticker e um selo de horário apontando para um elemento
// que não existia na página.
async function mpFetchCotacoes() {
  if (typeof atualizarCotacoes !== 'function') return mpEstado.cotacoes || {};
  await atualizarCotacoes(false, { semRender: true });
  mpEstado.ultimaCotacao =
    typeof cotacoesEstado !== 'undefined' ? cotacoesEstado.atualizadoEm || null : null;
  return mpEstado.cotacoes || {};
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

  // Os quatro cards de componente e a fita da composição saíram da tela: o
  // balanço (mpRenderBalancoWeb) mostra as mesmas parcelas uma vez só, com as
  // dívidas. Aqui ficam só os números.
  const deltaSaldo =
    saldoAnterior !== 0 ? ((saldoTotal - saldoAnterior) / Math.abs(saldoAnterior)) * 100 : 0;
  const rentab =
    investidoAporteTotal > 0
      ? ((valorInvestido - investidoAporteTotal) / investidoAporteTotal) * 100
      : 0;
  // Os mesmos números, para quem desenha a foto em outro formato (celular).
  return {
    total: patrimonioTotal,
    saldo: saldoTotal,
    investido: valorInvestido,
    imoveis: totalImoveis,
    veiculos: totalVeiculos,
    qtdImoveis: qtdImoveis,
    qtdVeiculos: qtdVeiculos,
    rentab: rentab,
    deltaSaldo: deltaSaldo,
  };
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
      mpAjustesConta(c, refMs).forEach((a) => {
        const ts = a.data ? new Date(a.data).getTime() : 0;
        movs.push({
          ts: isFinite(ts) ? ts : 0,
          desc: a.descricao || 'Ajuste de saldo',
          categoria: 'ajuste_saldo',
          valor: Number(a.valor),
          ajusteId: a.id,
          contaId: c.id,
        });
      });
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
        // Conta a pagar marcada como paga: o extrato oferece "Não paguei" na
        // própria linha. Marcar pago por engano era invisível — o dinheiro
        // saía do saldo e a pessoa só via o número errado, sem saber de onde.
        txId:
          !entrada && (t.categoria === 'despesa_fixa' || t.categoria === 'cartao_credito')
            ? t.id
            : undefined,
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
    ajuste_saldo: { label: 'Ajuste', cls: 'ajuste' },
  };
  return mapa[categoria] || null;
}

// Ação de desfazer na linha do extrato: o ajuste de saldo e a baixa de conta a
// pagar. Ids vão em data-* (nunca interpolados no onclick).
function mpAcaoExtratoHtml(m) {
  const esc = (v) =>
    String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  if (m.categoria === 'ajuste_saldo' && m.ajusteId) {
    return `<button type="button" class="mp-extrato-acao" data-conta="${esc(m.contaId)}" data-ajuste="${esc(m.ajusteId)}" onclick="conferirDesfazerAjuste(this.dataset.conta, this.dataset.ajuste)">Desfazer</button>`;
  }
  if (m.txId) {
    return `<button type="button" class="mp-extrato-acao" data-tx="${esc(m.txId)}" onclick="conferirNaoPaguei(this.dataset.tx)" title="Volta para a pagar e devolve o valor ao saldo">Não paguei</button>`;
  }
  return '';
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
                    ${mpAcaoExtratoHtml(m)}
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
  // O extrato só é montado quando aberto (com muitas contas, montar todos a
  // cada render pesava); redesenha a lista para trazê-lo.
  const wrap = document.getElementById('mp-lista-inst');
  if (wrap && mpEstado._ultimoConsolidado) mpRenderInstituicoes(mpEstado._ultimoConsolidado);
  if (typeof mobPatrimonioRedesenharCarteiras === 'function') mobPatrimonioRedesenharCarteiras();
}

// "Onde está o seu dinheiro" — o resumo consolidado por instituição. É o coração
// da foto: cada banco/corretora com o que tem de CAIXA livre + INVESTIDO, como
// um extrato unificado de todos os bancos. A cada pagamento/aporte/resgate o
// caixa da instituição certa muda, então estes números são sempre o "agora".
function mpRenderInstituicoes(consolidado) {
  const wrap = document.getElementById('mp-lista-inst');
  if (!wrap) return;
  mpEstado._ultimoConsolidado = consolidado;
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
    mpEstado._instituicoes = [];
    wrap.innerHTML =
      '<div class="mp-empty"><i class="ph ph-bank"></i>Sem dados por instituição.<br><span style="font-size:11.5px;margin-top:4px;display:inline-block;">Cadastre suas contas abaixo e registre movimentações para ver a foto completa.</span></div>';
    return;
  }
  const totalGeral = arr.reduce((a, x) => a + x.total, 0);
  // Mapa índice→chave usado pelo toggle do extrato (evita escapar nomes no onclick).
  mpEstado._extratoKeys = arr.map((x) => x.key);
  // A lista pronta, na mesma ordem dos índices, para o celular.
  mpEstado._instituicoes = arr;
  const cab =
    '<div class="mpd-inst-cab" aria-hidden="true"><span></span><span>Instituição</span><span>Caixa</span><span>Investido</span><span>Total</span><span></span></div>';
  wrap.innerHTML =
    cab +
    arr
      .map((x, i) => {
        const pct = totalGeral !== 0 ? (x.total / totalGeral) * 100 : 0;
        const tipo = mpTipoInstituicao(x.key);
        const accent = mpCorInstituicao(x.key, x.reconciliar);
        // Linha do canvas: tipo, o que tem dentro (classes) e a fatia do total.
        const classes = Object.keys(x.classes || {})
          .filter((cl) => x.classes[cl] > 0.01)
          .sort((a, b) => x.classes[b] - x.classes[a])
          .map((cl) => (MP_LABELS[cl] || cl) + ' ' + mpFmtBRL(x.classes[cl]));
        const sub = x.reconciliar
          ? 'Movimentos sem instituição — informe o banco no lançamento'
          : [
              tipo ? tipo.label : null,
              classes.length ? classes.join(' · ') : mpPctBR(pct) + ' do total',
            ]
              .filter(Boolean)
              .join(' · ');
        const aberto = !!(mpEstado.extratoAberto && mpEstado.extratoAberto[x.key]);
        const menuAberto = mpEstado.menuAberto === x.key;
        const ehConta = !x.reconciliar && typeof obterConta === 'function' && !!obterConta(x.key);
        const avisoHtml =
          ehConta && typeof conferirAvisoHtml === 'function'
            ? conferirAvisoHtml(x.key, x.caixa)
            : '';
        const idEsc = mpEsc(x.key);
        // O ⋯ abre as ações da conta. Antes elas ficavam numa segunda lista
        // ("Minhas Contas") que repetia as mesmas instituições.
        const acoes = [
          `<button type="button" onclick="mpAbrirPainelInst(${i})"><i class="ph ph-receipt"></i> Ver extrato</button>`,
          `<button type="button" onclick="abrirTransferenciaModal()"><i class="ph ph-arrows-left-right"></i> Transferir</button>`,
        ];
        if (ehConta)
          acoes.push(
            `<button type="button" data-conta="${idEsc}" onclick="conferirAbrir(this.dataset.conta)"><i class="ph ph-check-circle"></i> Conferir saldo</button>`,
            `<button type="button" data-conta="${idEsc}" onclick="editarContaForm(this.dataset.conta)"><i class="ph ph-pencil-simple"></i> Editar</button>`,
            `<button type="button" data-conta="${idEsc}" onclick="fundirContaPrompt(this.dataset.conta)"><i class="ph ph-arrows-merge"></i> Fundir</button>`,
            `<button type="button" class="perigo" data-conta="${idEsc}" onclick="arquivarContaUI(this.dataset.conta)"><i class="ph ph-archive"></i> Arquivar</button>`
          );
        const extratoHtml = aberto
          ? mpRenderExtratoHtml(mpExtratoInstituicao(x.key, Date.now()))
          : '';
        const num = (v, mostrarZero) =>
          Math.abs(v) > 0.005 || mostrarZero
            ? `<span class="mpd-num mpd-oculta">${mpFmtBRL(v)}</span>`
            : '<span class="mpd-num mpd-traco">—</span>';
        return `
            <div class="mpd-inst${aberto ? ' aberto' : ''}">
                <div class="mpd-inst-lin" onclick="if (!event.target.closest('button')) mpAbrirPainelInst(${i})" title="Ver extrato e ações">
                    <span class="mpd-inst-av" style="background:${accent};">${x.reconciliar ? '<i class="ph ph-warning"></i>' : mpEsc(mpIniciaisInstituicao(x.nome))}</span>
                    <span class="mpd-inst-nome"><b>${mpEsc(x.nome)}</b><small>${mpEsc(sub)}</small><span class="mpd-inst-trilho"><span style="width:${Math.max(2, Math.min(100, pct)).toFixed(1)}%;background:${accent};"></span></span></span>
                    ${num(x.caixa, true)}
                    ${num(x.investido, false)}
                    <span class="mpd-num mpd-oculta mpd-inst-total">${mpFmtBRL(x.total)}</span>
                    <button type="button" class="mpd-mais" aria-label="Ações de ${mpEsc(x.nome)}" aria-expanded="${menuAberto}" onclick="mpdMenuInstituicao(${i})"><i class="ph ph-dots-three"></i></button>
                </div>
                ${avisoHtml}
                <div class="mpd-inst-menu"${menuAberto ? '' : ' hidden'}>${acoes.join('')}</div>
                <div class="mp-inst-extrato" id="mp-extrato-${i}" style="display:${aberto ? 'flex' : 'none'}">
                    <i class="ph ph-caret-right mp-inst-chevron${aberto ? ' aberto' : ''}" id="mp-chev-${i}" hidden></i>
                    ${extratoHtml}
                </div>
            </div>`;
      })
      .join('');
}

/** Abre ou fecha o menu ⋯ de uma instituição (um aberto por vez). */
function mpdMenuInstituicao(i) {
  const key = (mpEstado._extratoKeys || [])[i];
  if (key == null) return;
  mpEstado.menuAberto = mpEstado.menuAberto === key ? null : key;
  if (mpEstado._ultimoConsolidado) mpRenderInstituicoes(mpEstado._ultimoConsolidado);
}

// ============================================================
// === Painel da instituição: saldo, ações, gráfico e extrato ===
// ============================================================
// Abre ao clicar numa instituição. No web é um painel à direita (como o do
// Novo lançamento); no celular, a folha que sobe de baixo (mobFolhaAbrir).
// O conteúdo é o mesmo nos dois.

var mpPainel = { key: null, periodo: 'mes', tipo: 'todos', limite: 40 };

var MP_MESES_CURTOS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

function _mpPainelInst() {
  return (mpEstado._instituicoes || []).filter((x) => x.key === mpPainel.key)[0] || null;
}

/** Abre o painel da i-ésima instituição da lista. */
function mpAbrirPainelInst(i) {
  const x = (mpEstado._instituicoes || [])[i];
  if (!x) return;
  if (mpPainel.key !== x.key) {
    mpPainel.periodo = 'mes';
    mpPainel.tipo = 'todos';
    mpPainel.limite = 40;
  }
  mpPainel.key = x.key;
  mpEstado.menuAberto = null;
  mpDesenharPainelInst();
}

function mpFecharPainelInst() {
  mpPainel.key = null;
  const p = document.getElementById('mpdPainel');
  if (p) {
    p.hidden = true;
    p.innerHTML = '';
  }
  document.body.classList.remove('mpd-painel-aberto');
}

function mpPainelFiltro(campo, valor) {
  if (campo === 'periodo' || campo === 'tipo') mpPainel[campo] = valor;
  mpPainel.limite = 40;
  mpDesenharPainelInst();
}

function mpPainelMais() {
  mpPainel.limite += 60;
  mpDesenharPainelInst();
}

function mpDesenharPainelInst() {
  const x = _mpPainelInst();
  if (!x) return;
  const html = mpPainelInstHtml(x);
  // Um painel só: à direita no web, subindo de baixo no celular (CSS).
  const p = document.getElementById('mpdPainel');
  if (!p) return;
  p.innerHTML = '<div class="mpx">' + html + '</div>';
  p.hidden = false;
  document.body.classList.add('mpd-painel-aberto');
}

/** Caixa da instituição no fim de cada um dos últimos `n` meses. */
function mpCaixaFimDeMes(movs, n) {
  const hoje = new Date();
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const fim =
      k === 0
        ? Date.now()
        : new Date(hoje.getFullYear(), hoje.getMonth() - k + 1, 0, 23, 59, 59, 999).getTime();
    let saldo = 0;
    for (let j = 0; j < movs.length; j++) {
      if (movs[j].ts > fim) break;
      saldo = movs[j].saldoApos;
    }
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - k, 1);
    out.push({ rot: MP_MESES_CURTOS[d.getMonth()], valor: saldo, atual: k === 0 });
  }
  return out;
}

/** Filtra o extrato pelo período e tipo do painel (pura, testável). */
function mpFiltrarExtratoPainel(movs, periodo, tipo, agoraMs) {
  const agora = new Date(agoraMs || Date.now());
  let ini = -Infinity;
  if (periodo === 'mes') ini = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
  else if (periodo === '3m') ini = new Date(agora.getFullYear(), agora.getMonth() - 2, 1).getTime();
  return movs.filter((m) => {
    if (m.abertura && periodo !== 'tudo') return false;
    if (m.ts < ini) return false;
    if (tipo === 'entradas') return m.valor > 0;
    if (tipo === 'saidas') return m.valor < 0;
    return true;
  });
}

function mpPainelInstHtml(x) {
  const e = mpEsc;
  const tipo = mpTipoInstituicao(x.key);
  const conta = !x.reconciliar && typeof obterConta === 'function' ? obterConta(x.key) : null;
  const totalGeral = (mpEstado._instituicoes || []).reduce((a, y) => a + y.total, 0);
  const pct = totalGeral ? (x.total / totalGeral) * 100 : 0;
  const movs = mpExtratoInstituicao(x.key, Date.now());
  const idEsc = e(x.key);

  // Cabeçalho e saldo
  let html =
    '<header class="mpx-cab"><span class="mpd-inst-av" style="background:' +
    mpCorInstituicao(x.key, x.reconciliar) +
    '">' +
    (x.reconciliar ? '<i class="ph ph-warning"></i>' : e(mpIniciaisInstituicao(x.nome))) +
    '</span><div class="mpx-tit"><h2>' +
    e(x.nome) +
    '</h2><small>' +
    e(
      [
        tipo ? tipo.label : null,
        conta && conta.dataSaldoInicial
          ? 'desde ' + new Date(conta.dataSaldoInicial + 'T12:00:00').toLocaleDateString('pt-BR')
          : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Instituição'
    ) +
    '</small></div><button type="button" class="mpx-fechar" aria-label="Fechar" onclick="mpFecharPainelInst()"><i class="ph ph-x"></i></button></header>' +
    '<section class="mpx-saldo"><span class="mpd-rotulo">Saldo hoje</span><div class="mpx-valor mpd-oculta">' +
    e(mpFmtBRL(x.total)) +
    '</div><span class="mpd-sub">Caixa <b class="mpd-oculta">' +
    e(mpFmtBRL(x.caixa)) +
    '</b> · Investido <b class="mpd-oculta">' +
    e(mpFmtBRL(x.investido)) +
    '</b> · ' +
    mpPctBR(pct) +
    ' do seu dinheiro</span></section>';

  // Ações
  const acoes = [['abrirTransferenciaModal()', 'ph-arrows-left-right', 'Transferir', '']];
  if (conta) {
    acoes.push(
      ['conferirAbrir(this.dataset.conta)', 'ph-check-circle', 'Conferir', ''],
      ['editarContaForm(this.dataset.conta)', 'ph-pencil-simple', 'Editar', ''],
      ['fundirContaPrompt(this.dataset.conta)', 'ph-arrows-merge', 'Fundir', ''],
      ['arquivarContaUI(this.dataset.conta)', 'ph-archive', 'Arquivar', ' perigo']
    );
  }
  html +=
    '<nav class="mpx-acoes" aria-label="Ações da conta">' +
    acoes
      .map(
        (a) =>
          '<button type="button" class="mpx-acao' +
          a[3] +
          '" data-conta="' +
          idEsc +
          '" onclick="' +
          a[0] +
          '"><span><i class="ph ' +
          a[1] +
          '"></i></span>' +
          a[2] +
          '</button>'
      )
      .join('') +
    '</nav>';
  if (conta && typeof conferirAvisoHtml === 'function') html += conferirAvisoHtml(x.key, x.caixa);

  // O que tem dentro (classes de investimento)
  const classes = Object.keys(x.classes || {})
    .filter((cl) => x.classes[cl] > 0.01)
    .sort((a, b) => x.classes[b] - x.classes[a]);
  if (classes.length)
    html +=
      '<div class="mpx-classes">' +
      classes
        .map(
          (cl) =>
            '<span><i style="background:' +
            mpCorCategoria(cl) +
            '"></i>' +
            e(MP_LABELS[cl] || cl) +
            ' <b class="mpd-oculta">' +
            e(mpFmtBRL(x.classes[cl])) +
            '</b></span>'
        )
        .join('') +
      '</div>';

  // Caixa no fim de cada mês
  if (movs.length) {
    const barras = mpCaixaFimDeMes(movs, 6);
    const max = Math.max(1, ...barras.map((b) => Math.abs(b.valor)));
    html +=
      '<section class="mpx-graf"><div class="mpd-topo"><b>Caixa no fim de cada mês</b><span class="mpd-sub">6 meses</span></div><div class="mpx-barras">' +
      barras
        .map(
          (b) =>
            '<div class="mpx-col' +
            (b.atual ? ' atual' : '') +
            (b.valor < 0 ? ' neg' : '') +
            '" title="' +
            e(b.rot + ': ' + mpFmtBRL(b.valor)) +
            '"><span style="height:' +
            Math.max(3, (Math.abs(b.valor) / max) * 70).toFixed(0) +
            'px"></span><small>' +
            b.rot +
            '</small></div>'
        )
        .join('') +
      '</div></section>';
  }

  // Extrato
  const filtrados = mpFiltrarExtratoPainel(movs, mpPainel.periodo, mpPainel.tipo);
  const entrou = filtrados
    .filter((m) => !m.abertura && m.valor > 0)
    .reduce((a, m) => a + m.valor, 0);
  const saiu = filtrados.filter((m) => m.valor < 0).reduce((a, m) => a - m.valor, 0);
  const chip = (campo, valor, rot) =>
    '<button type="button" aria-pressed="' +
    (mpPainel[campo] === valor) +
    '" onclick="mpPainelFiltro(\'' +
    campo +
    "','" +
    valor +
    '\')">' +
    rot +
    '</button>';
  html +=
    '<section class="mpx-extrato"><div class="mpd-topo"><h3>Extrato da conta</h3>' +
    (typeof ppNavegarPara === 'function'
      ? '<button type="button" class="mpd-link" onclick="mpFecharPainelInst();ppNavegarPara(\'controle\')">No Controle <i class="ph ph-arrow-right"></i></button>'
      : '') +
    '</div><div class="mpx-filtros"><div class="mpd-seg" role="group" aria-label="Período">' +
    chip('periodo', 'mes', 'Este mês') +
    chip('periodo', '3m', '3 meses') +
    chip('periodo', 'tudo', 'Tudo') +
    '</div><div class="mpd-seg" role="group" aria-label="Tipo">' +
    chip('tipo', 'todos', 'Todos') +
    chip('tipo', 'entradas', 'Entradas') +
    chip('tipo', 'saidas', 'Saídas') +
    '</div></div>' +
    '<div class="mpx-resumo"><span>Entrou <b class="mpd-oculta pos">+' +
    e(mpFmtBRL(entrou)) +
    '</b></span><span>Saiu <b class="mpd-oculta neg">−' +
    e(mpFmtBRL(saiu)) +
    '</b></span></div>';

  if (!filtrados.length) {
    html +=
      '<p class="mpd-vazio">' +
      (movs.length
        ? 'Nada neste período. Tente "Tudo".'
        : 'Sem movimentações de caixa nesta instituição.') +
      '</p></section>';
    return html;
  }
  const recentes = filtrados.slice().reverse();
  const visiveis = recentes.slice(0, mpPainel.limite);
  const hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  const mesmoDia = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const rotDia = (ts) => {
    if (!ts) return 'Sem data';
    const d = new Date(ts);
    const base =
      d.getDate() +
      ' ' +
      MP_MESES_CURTOS[d.getMonth()] +
      (d.getFullYear() !== hoje.getFullYear() ? ' ' + d.getFullYear() : '');
    if (mesmoDia(d, hoje)) return 'Hoje · ' + base;
    if (mesmoDia(d, ontem)) return 'Ontem · ' + base;
    return base;
  };
  let diaAtual = null;
  let corpo = '';
  visiveis.forEach((m) => {
    const dia = rotDia(m.ts);
    if (dia !== diaAtual) {
      diaAtual = dia;
      corpo +=
        '<div class="mpx-dia"><span>' +
        e(dia) +
        '</span><span>saldo <b class="mpd-oculta">' +
        e(mpFmtBRL(m.saldoApos)) +
        '</b></span></div>';
    }
    const ti = mpTipoMovInfo(m.categoria, m.abertura);
    const pos = m.valor >= 0;
    corpo +=
      '<div class="mpx-mov"><span class="mpx-mov-ic ' +
      (m.abertura ? 'neu' : pos ? 'pos' : 'neg') +
      '"><i class="ph ' +
      (m.abertura ? 'ph-flag' : pos ? 'ph-arrow-down-left' : 'ph-arrow-up-right') +
      '"></i></span><span class="mpx-mov-txt"><b>' +
      e(m.desc) +
      '</b><small>' +
      e(ti ? ti.label : m.abertura ? 'Abertura' : mpCategoriaLabelMov(m.categoria)) +
      '</small></span><span class="mpx-mov-val"><b class="mpd-oculta ' +
      (m.abertura ? '' : pos ? 'pos' : 'neg') +
      '">' +
      (m.abertura ? '' : pos ? '+' : '−') +
      e(mpFmtBRL(Math.abs(m.valor))) +
      '</b>' +
      mpAcaoExtratoHtml(m) +
      '</span></div>';
  });
  html += '<div class="mpx-lista">' + corpo + '</div>';
  if (recentes.length > visiveis.length)
    html +=
      '<button type="button" class="mpx-mais" onclick="mpPainelMais()">Mostrar mais ' +
      Math.min(60, recentes.length - visiveis.length) +
      ' de ' +
      (recentes.length - visiveis.length) +
      '</button>';
  html += '</section>';
  return html;
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

// ============================================================
// === Meu patrimônio · web: dívidas, herói, balanço, mudança ===
// ============================================================

var mpWeb = { liquido: null, periodo: 12, mudouMeses: 1 };
var MP_WEB_PERIODOS = [
  [1, '1M'],
  [6, '6M'],
  [12, '1A'],
  [24, '2A'],
  [0, 'Tudo'],
];

function mpEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Faturas de cartão que já são dívida: a aberta e as fechadas ainda não
 * pagas. Parcelas de faturas futuras ficam de fora — são compromisso, não
 * dívida de hoje. O caixa só desconta a fatura quando ela é paga, então até lá
 * esse dinheiro aparece no banco como se fosse livre.
 */
function mpDividaCartoes(hoje) {
  if (typeof faturasDoCartao !== 'function' || typeof faturasCartoesVisiveis !== 'function')
    return [];
  const lista = [];
  faturasCartoesVisiveis().forEach((c) => {
    let soma = 0;
    faturasDoCartao(c.id, hoje).forEach((f) => {
      if (f.status === 'aberta' || f.status === 'fechada' || f.status === 'vencida')
        soma += Number(f.aPagar) || 0;
    });
    if (soma > 0.005) lista.push({ nome: c.nome || 'Cartão', valor: soma, cartaoId: c.id });
  });
  return lista;
}

/** Tudo o que se deve hoje: financiamentos dos bens + faturas em aberto. */
function mpDividas(hoje) {
  const bens = [];
  if (typeof bensAtivos === 'function') {
    bensAtivos().forEach((b) => {
      const f = b.financiamento;
      const v = f && f.ativo ? Number(f.saldoDevedor) || 0 : 0;
      if (v > 0.005)
        bens.push({ nome: 'Financiamento · ' + (b.nome || 'bem'), valor: v, bemId: b.id });
    });
  }
  const cartoes = mpDividaCartoes(hoje);
  const total = bens.reduce((a, x) => a + x.valor, 0) + cartoes.reduce((a, x) => a + x.valor, 0);
  return { bens, cartoes, total };
}

/**
 * Por que o patrimônio mudou entre o fim do mês anterior e o ponto final da
 * série. Cada parcela vem da diferença de uma coluna da própria série, então a
 * soma fecha com a variação do gráfico ao centavo:
 *   - contas: o que entrou menos o que saiu do caixa, SEM contar o dinheiro
 *     que foi para os investimentos (aporte não é gasto nem ganho);
 *   - valorização: o que os investimentos ganharam ou perderam além do aporte;
 *   - bens: avaliação nova (FIPE, imóvel) ou bem que entrou/saiu.
 */
function mpMudancaDoMes(serie, meses) {
  if (!Array.isArray(serie) || serie.length < 2) return null;
  // `meses`: quantos meses para trás (1 = desde o fim do mês passado; 12 =
  // nos últimos 12 meses). Com histórico mais curto, compara com o início.
  const n = Math.max(1, Math.min(serie.length - 1, Number(meses) || 1));
  const a = serie[serie.length - 1 - n];
  const b = serie[serie.length - 1];
  const aportes = (Number(b.custo) || 0) - (Number(a.custo) || 0);
  const contas = b.caixa - a.caixa + aportes;
  const valorizacao = b.investido - a.investido - aportes;
  const bens = b.bens - a.bens;
  return {
    de: a,
    ate: b,
    contas,
    aportes,
    valorizacao,
    bens,
    total: b.total - a.total,
  };
}

/** Gasto médio por mês nos últimos 6 meses fechados que tiveram gasto. */
function mpCustoMedioMensal(hoje) {
  const h = hoje instanceof Date ? hoje : new Date();
  let soma = 0;
  let meses = 0;
  for (let k = 1; k <= 6; k++) {
    const ini = new Date(h.getFullYear(), h.getMonth() - k, 1).getTime();
    const fim = new Date(h.getFullYear(), h.getMonth() - k + 1, 0, 23, 59, 59, 999).getTime();
    const v = mpCalcularDespesasJanela(ini, fim);
    if (v > 0.005) {
      soma += v;
      meses++;
    }
  }
  return meses ? soma / meses : 0;
}

/**
 * Fôlego: quanto dá para usar em até um dia (caixa + renda variável + reserva
 * de emergência; renda fixa e previdência ficam de fora porque o prazo de
 * resgate varia), quantos meses o caixa cobre do gasto médio, e os proventos
 * previstos para 12 meses.
 */
function mpFolego(kpis, consolidado) {
  const cat = (consolidado && consolidado.porCategoria) || {};
  const liquidoInv =
    (cat.renda_variavel ? cat.renda_variavel.atual : 0) +
    (cat.reserva_emergencia ? cat.reserva_emergencia.atual : 0);
  const disponivel = Math.max(0, kpis.saldo) + liquidoInv;
  const custo = mpCustoMedioMensal(new Date());
  const reservaMeses = custo > 0 ? Math.max(0, kpis.saldo) / custo : null;
  let proventos = null;
  if (typeof projecaoProventos12m === 'function' && typeof obterResumoCarteira === 'function') {
    try {
      proventos = projecaoProventos12m(obterResumoCarteira());
    } catch (e) {
      proventos = null;
    }
  }
  return {
    disponivel,
    pctDisponivel: mpFatiaDoTotal(disponivel, kpis.total),
    custoMedio: custo,
    reservaMeses,
    proventos: proventos && proventos.total > 0 ? proventos : null,
  };
}

function _mpWebSerieVisivel(serie) {
  const s = serie || [];
  if (mpWeb.periodo > 0) return s.slice(-(mpWeb.periodo + 1));
  return s;
}

function _mpWebRotuloMes(p) {
  const m = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return m[p.mes] + '/' + String(p.ano).slice(2);
}

/** Eixo com números redondos: 3 marcas que cobrem a série inteira. */
function mpEixoRedondo(mn, mx) {
  if (!(mx > mn)) {
    const pad = Math.abs(mx) * 0.05 || 1000;
    mn -= pad;
    mx += pad;
  }
  const mag = Math.pow(10, Math.floor(Math.log10((mx - mn) / 2)));
  const fatores = [1, 2, 2.5, 5, 10, 20, 25, 50, 100];
  for (let k = 0; k < fatores.length; k++) {
    const passo = fatores[k] * mag;
    const ini = Math.floor(mn / passo) * passo;
    if (ini + 2 * passo >= mx) return [ini, ini + passo, ini + 2 * passo];
  }
  return [mn, (mn + mx) / 2, mx];
}

function mpFmtCompacto(v) {
  const a = Math.abs(v);
  const sinal = v < 0 ? '−' : '';
  if (a >= 1e6) return sinal + 'R$ ' + (a / 1e6).toFixed(1).replace('.', ',') + ' mi';
  if (a >= 1e3) return sinal + 'R$ ' + Math.round(a / 1e3) + ' mil';
  return sinal + 'R$ ' + Math.round(a);
}

/** SVG da evolução (o que você tem, mês a mês). */
function mpGraficoWebSvg(serie) {
  const W = 720;
  const H = 230;
  const pl = 62;
  const pr = 12;
  const pt = 12;
  const pb = 24;
  if (serie.length < 2) return null;
  const vals = serie.map((p) => p.total);
  const ticks = mpEixoRedondo(Math.min(...vals), Math.max(...vals));
  const mn = ticks[0];
  const mx = ticks[2];
  const x = (i) => pl + (i * (W - pl - pr)) / (serie.length - 1);
  const y = (v) => pt + (1 - (v - mn) / (mx - mn || 1)) * (H - pt - pb);
  const pts = serie.map((p, i) => [x(i), y(p.total)]);
  const linha = pts
    .map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1))
    .join(' ');
  const area =
    linha +
    ' L' +
    pts[pts.length - 1][0].toFixed(1) +
    ' ' +
    (H - pb) +
    ' L' +
    pl +
    ' ' +
    (H - pb) +
    ' Z';
  const passoRot = Math.max(1, Math.ceil(serie.length / 7));
  let svg =
    '<svg viewBox="0 0 ' +
    W +
    ' ' +
    H +
    '" role="img" aria-label="Evolução do que você tem, de ' +
    mpEsc(mpFmtBRL(vals[0])) +
    ' a ' +
    mpEsc(mpFmtBRL(vals[vals.length - 1])) +
    '">' +
    '<defs><linearGradient id="mpwGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--cor-primaria)" stop-opacity=".24"></stop><stop offset="1" stop-color="var(--cor-primaria)" stop-opacity="0"></stop></linearGradient></defs>';
  ticks.forEach((t) => {
    svg +=
      '<line class="mpd-grade" x1="' +
      pl +
      '" x2="' +
      (W - pr) +
      '" y1="' +
      y(t).toFixed(1) +
      '" y2="' +
      y(t).toFixed(1) +
      '"></line>' +
      '<text x="' +
      (pl - 8) +
      '" y="' +
      (y(t) + 3).toFixed(1) +
      '" text-anchor="end" class="mpd-oculta">' +
      mpEsc(mpFmtCompacto(t)) +
      '</text>';
  });
  svg +=
    '<path d="' +
    area +
    '" fill="url(#mpwGrad)"></path><path class="mpd-linha-g" d="' +
    linha +
    '"></path>';
  serie.forEach((p, i) => {
    if (i % passoRot && i !== serie.length - 1) return;
    const anc = i === 0 ? 'start' : i === serie.length - 1 ? 'end' : 'middle';
    svg +=
      '<text x="' +
      x(i).toFixed(1) +
      '" y="' +
      (H - 6) +
      '" text-anchor="' +
      anc +
      '">' +
      _mpWebRotuloMes(p) +
      '</text>';
  });
  const u = pts[pts.length - 1];
  svg +=
    '<line class="mpd-cursor" x1="' +
    u[0] +
    '" x2="' +
    u[0] +
    '" y1="' +
    pt +
    '" y2="' +
    (H - pb) +
    '"></line>' +
    '<circle class="mpd-ponto" cx="' +
    u[0].toFixed(1) +
    '" cy="' +
    u[1].toFixed(1) +
    '" r="5" fill="var(--cor-primaria)" stroke="var(--cor-branco)" stroke-width="2"></circle></svg>';
  return { svg, pts, W, H };
}

function mpWebAlternarLiquido(liq) {
  mpWeb.liquido = !!liq;
  if (mpEstado._web) mpRenderHeroiWeb(mpEstado._web);
}

function mpWebPeriodo(meses) {
  mpWeb.periodo = Number(meses) || 0;
  if (mpEstado._web) mpRenderHeroiWeb(mpEstado._web);
}

/** O número principal, a variação e a linha do tempo. */
function mpRenderHeroiWeb(d) {
  const el = document.getElementById('mpwHeroi');
  if (!el || !d) return;
  const k = d.kpis;
  const temDivida = d.dividas.total > 0.005;
  if (mpWeb.liquido === null) mpWeb.liquido = temDivida;
  const liquido = temDivida && mpWeb.liquido;
  const valor = k.total - (liquido ? d.dividas.total : 0);
  const serieTodo = d.serie || [];
  const serie = _mpWebSerieVisivel(serieTodo);
  const g = mpGraficoWebSvg(serie);
  const base = serie.length > 1 ? serie[0] : null;
  let delta = '';
  if (base) {
    const dif = k.total - base.total;
    const pct = base.total ? (dif / Math.abs(base.total)) * 100 : null;
    const cls = Math.abs(dif) < 0.005 ? 'neu' : dif > 0 ? 'pos' : 'neg';
    delta =
      '<span class="mpd-delta ' +
      cls +
      '">' +
      (cls === 'neu' ? '' : dif > 0 ? '↑ ' : '↓ ') +
      '<b class="mpd-oculta">' +
      mpEsc(mpFmtBRL(Math.abs(dif))) +
      '</b>' +
      (pct != null ? ' (' + mpPctBR(Math.abs(pct)) + ')' : '') +
      ' desde ' +
      _mpWebRotuloMes(base) +
      (liquido ? ' no que você tem' : '') +
      '</span>';
  }
  const seg = temDivida
    ? '<div class="mpd-seg" role="group" aria-label="Como somar">' +
      '<button type="button" aria-pressed="' +
      liquido +
      '" onclick="mpWebAlternarLiquido(true)">Líquido</button>' +
      '<button type="button" aria-pressed="' +
      !liquido +
      '" onclick="mpWebAlternarLiquido(false)">Bruto</button></div>'
    : '';
  const periodos = MP_WEB_PERIODOS.map(
    (p) =>
      '<button type="button" aria-pressed="' +
      (mpWeb.periodo === p[0]) +
      '" onclick="mpWebPeriodo(' +
      p[0] +
      ')">' +
      p[1] +
      '</button>'
  ).join('');
  const quando = 'Posição de ' + new Date(d.posicaoMs || Date.now()).toLocaleDateString('pt-BR');
  el.innerHTML =
    '<div class="mpd-topo"><span class="mpd-rotulo">' +
    (liquido ? 'Patrimônio líquido' : temDivida ? 'Patrimônio bruto' : 'Patrimônio total') +
    '</span>' +
    seg +
    '</div>' +
    '<div class="mpd-valor-heroi mpd-oculta">' +
    mpEsc(mpFmtBRL(valor)) +
    '</div>' +
    (liquido
      ? '<div class="mpd-sub">Você tem <b class="mpd-oculta">' +
        mpEsc(mpFmtBRL(k.total)) +
        '</b> e deve <b class="mpd-oculta">' +
        mpEsc(mpFmtBRL(d.dividas.total)) +
        '</b></div>'
      : '') +
    '<div class="mpd-topo" style="margin-top:6px"><div style="display:flex;flex-direction:column;gap:2px">' +
    delta +
    '<span class="mpd-sub">' +
    quando +
    '</span></div>' +
    (serieTodo.length > 1
      ? '<div class="mpd-periodos" role="group" aria-label="Período do gráfico">' +
        periodos +
        '</div>'
      : '') +
    '</div>' +
    (g
      ? '<div class="mpd-graf" id="mpwGraf">' +
        g.svg +
        '<div class="mpd-dica" id="mpwDica"></div></div>'
      : '<p class="mpd-vazio">A linha do tempo aparece a partir do segundo mês de uso.</p>');
  if (g) _mpWebLigarDica(serie, g);
}

function _mpWebLigarDica(serie, g) {
  const caixa = document.getElementById('mpwGraf');
  const dica = document.getElementById('mpwDica');
  if (!caixa || !dica) return;
  const cursor = caixa.querySelector('.mpd-cursor');
  const ponto = caixa.querySelector('.mpd-ponto');
  const fmt = (v) => mpEsc(mpFmtBRL(v));
  caixa.addEventListener('pointermove', (ev) => {
    const r = caixa.getBoundingClientRect();
    if (!r.width) return;
    const xr = ((ev.clientX - r.left) / r.width) * g.W;
    let i = 0;
    let melhor = Infinity;
    g.pts.forEach((p, k) => {
      const dd = Math.abs(p[0] - xr);
      if (dd < melhor) {
        melhor = dd;
        i = k;
      }
    });
    const p = g.pts[i];
    const s = serie[i];
    caixa.classList.add('ativo');
    if (cursor) {
      cursor.setAttribute('x1', p[0]);
      cursor.setAttribute('x2', p[0]);
    }
    if (ponto) {
      ponto.setAttribute('cx', p[0]);
      ponto.setAttribute('cy', p[1]);
    }
    dica.innerHTML =
      '<b>Fim de ' +
      _mpWebRotuloMes(s) +
      (i === serie.length - 1 ? ' (hoje)' : '') +
      '</b>' +
      '<span>Total <em class="mpd-oculta" style="font-style:normal">' +
      fmt(s.total) +
      '</em></span>' +
      '<span>Contas <em class="mpd-oculta" style="font-style:normal">' +
      fmt(s.caixa) +
      '</em></span>' +
      '<span>Investido <em class="mpd-oculta" style="font-style:normal">' +
      fmt(s.investido) +
      '</em></span>' +
      '<span>Bens <em class="mpd-oculta" style="font-style:normal">' +
      fmt(s.bens) +
      '</em></span>';
    const px = (p[0] / g.W) * r.width;
    dica.style.left = Math.min(Math.max(0, px + 12), r.width - 170) + 'px';
  });
  caixa.addEventListener('pointerleave', () => {
    caixa.classList.remove('ativo');
    const u = g.pts[g.pts.length - 1];
    if (ponto) {
      ponto.setAttribute('cx', u[0]);
      ponto.setAttribute('cy', u[1]);
    }
  });
}

/** O balanço: o que você tem, o que você deve, e o líquido. */
function mpRenderBalancoWeb(d) {
  const el = document.getElementById('mpwBalanco');
  if (!el || !d) return;
  const k = d.kpis;
  const partes = [
    ['Saldo em conta', k.saldo, 'var(--cor-primaria)'],
    ['Investimentos', k.investido, 'var(--cor-patrimonio)'],
    ['Imóveis', k.imoveis, '#f59e0b'],
    ['Veículos e outros bens', k.veiculos, '#64748b'],
  ].filter((p) => Math.abs(p[1]) > 0.005);
  if (!partes.length && !(d.dividas.total > 0)) {
    el.innerHTML =
      '<h3 style="margin:0 0 6px;font-size:14px">Do que ele é feito</h3><p class="mpd-vazio">Cadastre uma conta, um investimento ou um bem para ver o balanço.</p>';
    return;
  }
  const positivo = partes.reduce((a, p) => a + Math.max(0, p[1]), 0);
  const barra = partes
    .filter((p) => p[1] > 0)
    .map(
      (p) =>
        // Largura em CSS com ponto: vírgula invalida o style e o segmento some.
        '<span style="width:' +
        ((p[1] / (positivo || 1)) * 100).toFixed(2) +
        '%;background:' +
        p[2] +
        '" title="' +
        mpEsc(p[0]) +
        '"></span>'
    )
    .join('');
  const linha = (nome, v, cor, pct, neg) =>
    '<div class="mpd-lin' +
    (pct == null ? ' sem-pct' : '') +
    (neg ? ' neg' : '') +
    '"><i style="background:' +
    cor +
    '"></i><span>' +
    mpEsc(nome) +
    '</span><span class="mpd-num mpd-oculta">' +
    (neg ? '−' : '') +
    mpEsc(mpFmtBRL(Math.abs(v))) +
    '</span>' +
    (pct == null ? '' : '<span class="mpd-pct">' + mpPctBR(pct) + '</span>') +
    '</div>';
  let html =
    '<h3 style="margin:0;font-size:14px">Do que ele é feito</h3><div class="mpd-barra" aria-hidden="true">' +
    barra +
    '</div>' +
    '<div class="mpd-grupo"><span>O que você tem</span><b class="mpd-oculta">' +
    mpEsc(mpFmtBRL(k.total)) +
    '</b></div>' +
    partes.map((p) => linha(p[0], p[1], p[2], mpFatiaDoTotal(p[1], k.total), false)).join('');
  if (d.dividas.total > 0.005) {
    html +=
      '<div class="mpd-grupo"><span>O que você deve</span><b class="mpd-oculta">' +
      mpEsc(mpFmtBRL(d.dividas.total)) +
      '</b></div>' +
      d.dividas.bens.map((x) => linha(x.nome, x.valor, 'var(--cor-erro)', null, true)).join('') +
      d.dividas.cartoes
        .map((x) => linha('Fatura · ' + x.nome, x.valor, 'var(--cor-erro)', null, true))
        .join('');
  }
  html +=
    '<div class="mpd-total"><span>' +
    (d.dividas.total > 0.005 ? 'Patrimônio líquido' : 'Total') +
    '</span><span class="mpd-num mpd-oculta">' +
    mpEsc(mpFmtBRL(k.total - d.dividas.total)) +
    '</span></div>';
  el.innerHTML = html;
}

/** Por que mudou: a variação do último mês, parcela por parcela. */
function mpRenderMudouWeb(d) {
  const el = document.getElementById('mpwMudou');
  if (!el) return;
  const m = mpMudancaDoMes(d && d.serie, mpWeb.mudouMeses);
  if (!m) {
    el.innerHTML =
      '<h3 style="margin:0 0 6px;font-size:14px">Por que mudou</h3><p class="mpd-vazio">A partir do segundo mês, mostramos aqui quanto veio do que sobrou nas contas e quanto veio da valorização.</p>';
    return;
  }
  const num = (v) => {
    const cls = Math.abs(v) < 0.005 ? '' : v > 0 ? ' pos' : ' neg';
    return (
      '<span class="mpd-num mpd-oculta' +
      cls +
      '">' +
      (v > 0.005 ? '+' : v < -0.005 ? '−' : '') +
      mpEsc(mpFmtBRL(Math.abs(v))) +
      '</span>'
    );
  };
  const linhas = [
    [
      'Sobrou nas contas',
      'o que entrou menos o que saiu, sem contar o que foi investido',
      m.contas,
    ],
    [
      'Valorização dos investimentos',
      m.aportes > 0.005 ? 'além dos ' + mpFmtBRL(m.aportes) + ' aplicados' : 'sem contar aportes',
      m.valorizacao,
    ],
    ['Bens', 'nova avaliação, compra ou venda', m.bens],
  ];
  el.innerHTML =
    '<div class="mpd-topo"><h3 style="margin:0;font-size:14px">Por que mudou</h3>' +
    mpdMudouSeletorHtml() +
    '</div>' +
    '<span class="mpd-sub">De ' +
    _mpWebRotuloMes(m.de) +
    ' até hoje</span>' +
    linhas
      .map(
        (l) =>
          '<div class="mpd-mud"><span>' +
          l[0] +
          '</span>' +
          num(l[2]) +
          '<small>' +
          mpEsc(l[1]) +
          '</small></div>'
      )
      .join('') +
    '<div class="mpd-total"><span>Variação</span>' +
    num(m.total) +
    '</div>';
}

/** Mês / 12M do "Por que mudou" — o mesmo seletor no web e no celular. */
function mpdMudouSeletorHtml() {
  return (
    '<div class="mpd-periodos" role="group" aria-label="Período">' +
    [
      [1, 'Mês'],
      [12, '12M'],
    ]
      .map(
        (p) =>
          '<button type="button" aria-pressed="' +
          (mpWeb.mudouMeses === p[0]) +
          '" onclick="mpdMudouPeriodo(' +
          p[0] +
          ')">' +
          p[1] +
          '</button>'
      )
      .join('') +
    '</div>'
  );
}

function mpdMudouPeriodo(meses) {
  mpWeb.mudouMeses = Number(meses) === 12 ? 12 : 1;
  if (mpEstado._web) mpRenderMudouWeb(mpEstado._web);
  if (typeof mobPatRedesenharTopo === 'function') mobPatRedesenharTopo();
}

/** Investimentos por classe, em lista: valor, fatia e quanto rendeu. */
function mpRenderClassesWeb(consolidado) {
  const wrap = document.getElementById('mp-classes-lista');
  if (!wrap) return;
  const porCat = (consolidado && consolidado.porCategoriaExibicao) || {};
  const itens = Object.keys(porCat)
    .map((cat) => ({ cat, investido: porCat[cat].investido, atual: porCat[cat].atual }))
    .filter((it) => it.atual > 0.01)
    .sort((a, b) => b.atual - a.atual);
  if (!itens.length) {
    wrap.innerHTML =
      '<p class="mpd-vazio">Nenhum investimento ainda. Registre um aporte em Meus investimentos.</p>';
    return;
  }
  const total = itens.reduce((a, it) => a + it.atual, 0);
  wrap.innerHTML = itens
    .map((it) => {
      const pct = (it.atual / total) * 100;
      const r = it.investido > 0 ? ((it.atual - it.investido) / it.investido) * 100 : null;
      // Rendimento só aparece quando há o que dizer: "0,0%" sem histórico
      // parecia resultado.
      const rend =
        r != null && Math.abs(r) >= 0.05
          ? '<small class="' +
            (r > 0 ? 'pos' : 'neg') +
            '">' +
            mpFmtPct(r) +
            ' sobre o que foi aplicado</small>'
          : '';
      return (
        '<div class="mpd-classe"><div class="mpd-classe-topo"><span>' +
        mpEsc(MP_LABELS[it.cat] || it.cat) +
        ' <span class="mpd-sub">' +
        mpPctBR(pct) +
        '</span></span><span class="mpd-num mpd-oculta">' +
        mpEsc(mpFmtBRL(it.atual)) +
        '</span></div>' +
        '<div class="mpd-classe-trilho"><span style="width:' +
        pct.toFixed(1) +
        '%;background:' +
        mpCorCategoria(it.cat) +
        '"></span></div>' +
        rend +
        '</div>'
      );
    })
    .join('');
}

/** Fôlego: liquidez, reserva em meses e proventos previstos. */
function mpRenderFolegoWeb(d) {
  const el = document.getElementById('mpwFolego');
  if (!el || !d) return;
  const f = d.folego;
  const blocos = [];
  blocos.push(
    '<div class="mpd-fol"><div class="mpd-fol-topo"><b>Disponível em até 1 dia</b><span class="mpd-num mpd-oculta">' +
      mpEsc(mpFmtBRL(f.disponivel)) +
      '</span></div>' +
      '<div class="mpd-classe-trilho"><span style="width:' +
      (f.pctDisponivel || 0).toFixed(1) +
      '%;background:var(--cor-primaria)"></span></div>' +
      '<small>' +
      (f.pctDisponivel == null
        ? 'Saldo em conta, ações, FIIs e reserva de emergência.'
        : mpPctBR(f.pctDisponivel) +
          ' do que você tem: saldo em conta, ações, FIIs e reserva. Renda fixa e previdência dependem do prazo de resgate.') +
      '</small></div>'
  );
  blocos.push(
    '<div class="mpd-fol"><div class="mpd-fol-topo"><b>Reserva cobre</b><span class="mpd-num">' +
      (f.reservaMeses == null ? '—' : f.reservaMeses.toFixed(1).replace('.', ',') + ' meses') +
      '</span></div>' +
      '<small>' +
      (f.reservaMeses == null
        ? 'Lance seus gastos no Controle para calcularmos quantos meses o saldo em conta cobre.'
        : 'o saldo em conta dividido pelo seu gasto médio de <span class="mpd-oculta">' +
          mpEsc(mpFmtBRL(f.custoMedio)) +
          '</span> por mês') +
      '</small></div>'
  );
  if (f.proventos)
    blocos.push(
      '<div class="mpd-fol"><div class="mpd-fol-topo"><b>Proventos previstos 12 meses</b><span class="mpd-num mpd-oculta">' +
        mpEsc(mpFmtBRL(f.proventos.total)) +
        '</span></div>' +
        '<small>em média <span class="mpd-oculta">' +
        mpEsc(mpFmtBRL(f.proventos.mediaMensal)) +
        '</span> por mês, pelo que os seus ativos pagaram nos últimos 12 meses</small></div>'
    );
  el.innerHTML = '<h3 style="margin:0 0 2px;font-size:14px">Fôlego</h3>' + blocos.join('');
}

async function renderMeuPatrimonio(skipFetch) {
  if (typeof aplicarTemaChartJs === 'function') aplicarTemaChartJs();
  if (typeof normalizarDespesasProgramadas === 'function') normalizarDespesasProgramadas();
  mpLimparTxOrigemOrfas();
  if (!skipFetch) await mpFetchCotacoes();
  const janela = mpJanelaPeriodo();
  const consolidado = mpConsolidar();
  const kpis = mpRenderKPIs(consolidado, janela);
  // Resumo consolidado por instituição (banco/corretora), com o detalhe das
  // classes que cada uma guarda — o coração da foto.
  mpRenderInstituicoes(consolidado);
  // Somatória de cada tipo de investimento (= KPI Total investido), em lista.
  mpRenderClassesWeb(consolidado);
  if (typeof renderMinhasContas === 'function') renderMinhasContas();
  if (typeof renderMeusBens === 'function') renderMeusBens();
  if (!skipFetch && typeof bemAtualizarFipeAuto === 'function') bemAtualizarFipeAuto();
  const dividas = mpDividas(new Date());
  // A série percorre meses de lançamentos e operações; calculada uma vez e
  // usada pelo web e pelo celular.
  let serie = [];
  try {
    serie = mpSerieMensalPatrimonio();
  } catch (e) {
    serie = [];
  }
  const web = {
    kpis: kpis,
    dividas: dividas,
    serie: serie,
    posicaoMs: janela.fimMs,
    folego: mpFolego(kpis, consolidado),
  };
  mpEstado._web = web;
  // Painel da instituição aberto: redesenha com os números novos (um
  // lançamento, uma conferência ou um arquivamento feitos a partir dele).
  const painelWeb = document.getElementById('mpdPainel');
  if (mpPainel.key && painelWeb && !painelWeb.hidden) {
    if (_mpPainelInst()) mpDesenharPainelInst();
    else mpFecharPainelInst();
  }
  mpRenderHeroiWeb(web);
  mpRenderBalancoWeb(web);
  mpRenderMudouWeb(web);
  mpRenderFolegoWeb(web);
  // No celular a foto tem formato próprio (appliquei-mobile.js), com os
  // números que os blocos acima acabaram de calcular.
  if (typeof mobRenderPatrimonio === 'function')
    mobRenderPatrimonio({
      kpis: kpis,
      instituicoes: mpEstado._instituicoes || [],
      porClasse: consolidado.porCategoriaExibicao || {},
      divida: dividas.total,
      dividas: dividas,
      folego: web.folego,
      posicaoMs: janela.fimMs,
      serie: function () {
        return serie;
      },
    });
}

/**
 * O patrimônio no fim de cada mês: caixa + investimentos a mercado + bens.
 *
 * Nada é estimado aqui: cada parcela vem da função que já responde por ela
 * em outro lugar do app — o caixa de mpCalcularSaldoTotal (a mesma do KPI
 * "Saldo em conta"), os investimentos da série de evolução da carteira
 * (cotação DA ÉPOCA, juros da RF), e os bens de rmBensAteFimDoMes (o bem só
 * entra a partir de quando era seu, pelo valor atual — não há histórico de
 * avaliação). O último ponto é "agora", o mesmo instante do KPI do total.
 */
function mpSerieMensalPatrimonio() {
  const hoje = new Date();
  const agora = Date.now();
  let inv = { meses: [], mercado: [] };
  const periodoAntes = typeof periodoEvolucao !== 'undefined' ? periodoEvolucao : null;
  try {
    if (periodoAntes !== null) periodoEvolucao = 0;
    if (typeof calcularSerieEvolucao === 'function') inv = calcularSerieEvolucao('todos', '');
  } catch (e) {
    inv = { meses: [], mercado: [] };
  } finally {
    if (periodoAntes !== null) periodoEvolucao = periodoAntes;
  }
  const mercadoPorMes = {};
  const custoPorMes = {};
  (inv.meses || []).forEach((d, i) => {
    mercadoPorMes[d.getFullYear() + '-' + d.getMonth()] = inv.mercado[i] || 0;
    custoPorMes[d.getFullYear() + '-' + d.getMonth()] = (inv.investido || [])[i] || 0;
  });

  // Começo: o mais antigo entre o primeiro investimento, o primeiro
  // lançamento e o saldo inicial das contas — no máximo 5 anos para trás.
  let ini = new Date(hoje.getFullYear(), hoje.getMonth() - 59, 1).getTime();
  let primeiro = agora;
  if (inv.meses && inv.meses.length) primeiro = Math.min(primeiro, inv.meses[0].getTime());
  if (typeof transacoes !== 'undefined')
    transacoes.forEach((t) => {
      const ts = mpTimestampTransacao(t);
      if (isFinite(ts) && ts < primeiro) primeiro = ts;
    });
  if (typeof contas !== 'undefined')
    contas.forEach((c) => {
      const ts =
        c && c.dataSaldoInicial ? new Date(c.dataSaldoInicial + 'T12:00:00').getTime() : NaN;
      if (isFinite(ts) && ts < primeiro) primeiro = ts;
    });
  const dP = new Date(primeiro);
  ini = Math.max(ini, new Date(dP.getFullYear(), dP.getMonth(), 1).getTime());

  const pontos = [];
  for (let d = new Date(ini); d <= hoje; d.setMonth(d.getMonth() + 1)) {
    const mes = d.getMonth();
    const ano = d.getFullYear();
    const fim = Math.min(new Date(ano, mes + 1, 0, 23, 59, 59, 999).getTime(), agora);
    const caixa = mpCalcularSaldoTotal(fim);
    const investido = mercadoPorMes[ano + '-' + mes] || 0;
    // Quanto foi aplicado até o fim do mês (custo). A diferença entre dois
    // meses é o aporte líquido — o que separa aporte de valorização.
    const custo = custoPorMes[ano + '-' + mes] || 0;
    const bens =
      typeof rmBensAteFimDoMes === 'function' ? rmBensAteFimDoMes(mes, ano).total || 0 : 0;
    pontos.push({
      mes: mes,
      ano: ano,
      ms: fim,
      caixa,
      investido,
      custo,
      bens,
      total: caixa + investido + bens,
    });
  }
  return pontos;
}
