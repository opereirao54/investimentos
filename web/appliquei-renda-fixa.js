/**
 * Appliquei — Renda Fixa: taxas de mercado + projeção + operações.
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script. Inclui:
 * - Parser e projeção de rentabilidade (CDI/Selic/IPCA)
 * - Registro e listagem de operações de ativos (sub-aba TIMELINE)
 * - Compromisso recorrente (previdência/reserva geram lançamentos futuros)
 *
 * Deps: transacoes, historicoCompras (state em app.js), mostrarToast,
 * formatarMoeda, parseBRL.
 */

// ============================================================
// === RENDA FIXA — TAXAS DE MERCADO + PROJEÇÃO              ===
// ============================================================
// Taxas anuais (em fração decimal). Valores conservadores caso o BCB falhe.
var taxasMercado = {
  cdi: 0.105,
  ipca: 0.045,
  selic: 0.105,
  atualizadoEm: null,
  fonte: 'estimativa',
};

async function buscarTaxasBCB() {
  // Selic meta (sgs.432) e IPCA 12m (sgs.13522). CDI ≈ Selic.
  const consultas = [
    {
      chave: 'selic',
      url: 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json',
    },
    {
      chave: 'ipca',
      url: 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json',
    },
  ];
  try {
    const resultados = await Promise.all(
      consultas.map((c) =>
        fetch(c.url)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    );
    const [selicData, ipcaData] = resultados;
    let mudou = false;
    if (selicData && selicData[0] && selicData[0].valor) {
      const v = parseFloat(String(selicData[0].valor).replace(',', '.')) / 100;
      if (!isNaN(v) && v > 0) {
        taxasMercado.selic = v;
        taxasMercado.cdi = v;
        mudou = true;
      }
    }
    if (ipcaData && ipcaData[0] && ipcaData[0].valor) {
      const v = parseFloat(String(ipcaData[0].valor).replace(',', '.')) / 100;
      if (!isNaN(v) && v > 0) {
        taxasMercado.ipca = v;
        mudou = true;
      }
    }
    if (mudou) {
      taxasMercado.fonte = 'BCB';
      taxasMercado.atualizadoEm = new Date().toISOString();
    }
  } catch (_) {
    /* mantém estimativas */
  }
  atualizarProjecaoForm();
  atualizarCarteiraAtivos();
  // Reflete as taxas reais (CDI/Selic/IPCA) na foto do patrimônio — RF/Reserva
  // indexados são valorizados a partir delas. Sem isto a 1ª foto fica nas estimativas.
  if (typeof renderMeuPatrimonio === 'function') {
    try {
      renderMeuPatrimonio(true);
    } catch (_) {
      /* aba pode não estar montada ainda */
    }
  }
}

// Converte texto livre de rentabilidade em uma taxa anual (decimal).
// Suporta: "110% CDI", "CDI + 2%", "IPCA+6%", "12% a.a.", "12,5%", "Selic+1"
function parsearRentabilidade(texto) {
  if (!texto) return null;
  const t = String(texto).toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');
  const cdi = taxasMercado.cdi;
  const ipca = taxasMercado.ipca;
  const selic = taxasMercado.selic;
  // Padrões: <num>% <indexador>      ex: 110%cdi
  let m = t.match(/^(\d+(?:\.\d+)?)%(?:do)?(cdi|selic|ipca)$/);
  if (m) {
    const perc = parseFloat(m[1]) / 100;
    const idx = m[2] === 'ipca' ? ipca : m[2] === 'selic' ? selic : cdi;
    return {
      taxa: perc * idx,
      descricao: `${(perc * 100).toFixed(0)}% do ${m[2].toUpperCase()}`,
      indexador: m[2],
    };
  }
  // Padrões: <indexador>+<num>%      ex: ipca+6, cdi+2%
  m = t.match(/^(cdi|selic|ipca)\+(\d+(?:\.\d+)?)%?$/);
  if (m) {
    const idx = m[1] === 'ipca' ? ipca : m[1] === 'selic' ? selic : cdi;
    const spread = parseFloat(m[2]) / 100;
    // Combinação multiplicativa (juros compostos sobre o indexador)
    const taxa = (1 + idx) * (1 + spread) - 1;
    return {
      taxa,
      descricao: `${m[1].toUpperCase()}+${(spread * 100).toFixed(2)}%`,
      indexador: m[1],
    };
  }
  // Padrões prefixados: "12%", "12% a.a.", "12.5%aa"
  m = t.match(/^(\d+(?:\.\d+)?)%?(?:aa|a\.a\.?)?$/);
  if (m) {
    return {
      taxa: parseFloat(m[1]) / 100,
      descricao: `${parseFloat(m[1]).toFixed(2)}% a.a. (prefixado)`,
      indexador: 'pre',
    };
  }
  return null;
}

// Calcula valor projetado no vencimento (juros compostos anuais)
function calcularProjecaoRF(valorInicial, dataInicio, dataVencimento, rentabilidadeTexto) {
  const parsed = parsearRentabilidade(rentabilidadeTexto);
  if (!parsed || !valorInicial || !dataInicio || !dataVencimento) return null;
  const inicio = new Date(dataInicio);
  const fim = new Date(dataVencimento);
  const diasMs = fim.getTime() - inicio.getTime();
  if (diasMs <= 0) return null;
  const anos = diasMs / (365.25 * 24 * 60 * 60 * 1000);
  const fator = Math.pow(1 + parsed.taxa, anos);
  const valorFinalBruto = valorInicial * fator;
  const rendimentoBruto = valorFinalBruto - valorInicial;
  // IR regressivo (renda fixa privada). Tesouro Selic/IPCA seguem mesma tabela. LCI/LCA são isentos — não diferenciamos aqui.
  const dias = diasMs / (24 * 60 * 60 * 1000);
  let aliquotaIR = 0.225;
  if (dias > 180) aliquotaIR = 0.2;
  if (dias > 360) aliquotaIR = 0.175;
  if (dias > 720) aliquotaIR = 0.15;
  const ir = rendimentoBruto * aliquotaIR;
  const valorFinalLiquido = valorFinalBruto - ir;
  return {
    taxaAnual: parsed.taxa,
    indexador: parsed.indexador,
    descricaoTaxa: parsed.descricao,
    anos,
    valorInicial,
    valorFinalBruto,
    valorFinalLiquido,
    rendimentoBruto,
    rendimentoLiquido: valorFinalLiquido - valorInicial,
    aliquotaIR,
  };
}

// ============================================================
// === Rentabilidade da previdência: unidade e sanidade       ===
// ============================================================
// O campo pedia "% ao mês", e ninguém conversa rendimento assim — fala-se em
// % ao ano. Quem digitava 8 pensando "8% ao ano" gravava 8% AO MÊS, que é
// 151,8% ao ano: R$ 10.000 viravam R$ 1.012.570 em cinco anos. A matemática
// estava certa o tempo todo; o que estava errado era a unidade que entrou.
//
// Estas três funções são a correção: a unidade é escolhida, a conversão
// aparece antes de gravar, e taxa impossível não passa.

/** Acima disto, ao mês, só pode ser número anual digitado no campo errado. */
var TAXA_MENSAL_ABSURDA = 0.03; // 3% a.m. ≈ 42,6% a.a.
/** Acima disto, é possível mas raro — vale um aviso, não um bloqueio. */
var TAXA_MENSAL_ALTA = 0.015; // 1,5% a.m. ≈ 19,6% a.a.

/** Taxa mensal ↔ anual, ambas efetivas (juros compostos). */
function taxaMensalParaAnual(tm) {
  return Math.pow(1 + tm, 12) - 1;
}
function taxaAnualParaMensal(ta) {
  return Math.pow(1 + ta, 1 / 12) - 1;
}

/**
 * Lê o campo de rentabilidade da previdência respeitando a unidade escolhida.
 * Devolve sempre a taxa MENSAL em fração — que é como o dado é gravado desde
 * sempre, então nada precisa ser migrado.
 */
function lerTaxaMensalPrevidencia() {
  const inp = document.getElementById('prevTaxaMensal');
  if (!inp) return null;
  const num = typeof parseBRL === 'function' ? parseBRL(inp.value) : parseFloat(inp.value);
  if (!(num > 0)) return null;
  const sel = document.getElementById('prevTaxaUnidade');
  const unidade = sel ? sel.value : 'mes';
  return unidade === 'ano' ? taxaAnualParaMensal(num / 100) : num / 100;
}

/**
 * Mostra a taxa na OUTRA unidade enquanto a pessoa digita.
 *
 * É a peça que resolve o problema: "8" com "% ao mês" selecionado passa a
 * dizer, na hora, que aquilo é 151,8% ao ano. Ninguém confirma isso achando
 * que é a rentabilidade de uma previdência.
 */
function atualizarEquivalenciaTaxaPrev() {
  const el = document.getElementById('prevTaxaEquivalente');
  if (!el) return;
  const tm = lerTaxaMensalPrevidencia();
  if (tm == null) {
    el.className = 'taxa-equivalente';
    el.innerHTML = '';
    return;
  }
  const ta = taxaMensalParaAnual(tm);
  const fmt = (v) => (v * 100).toFixed(2).replace('.', ',');
  let classe = 'taxa-equivalente mostrar';
  let extra = '';
  if (tm > TAXA_MENSAL_ABSURDA) {
    classe += ' absurda';
    // O número digitado continua o mesmo — o que muda é a unidade. Sugerir
    // um valor convertido aqui confundiria: quem digitou 8 queria 8% ao ano,
    // não 0,64% de coisa nenhuma.
    extra =
      ' — isso é muito acima de qualquer previdência. Se você quis dizer <strong>' +
      fmt(tm) +
      '% ao ano</strong>, troque a unidade ao lado.';
  } else if (tm > TAXA_MENSAL_ALTA) {
    classe += ' alta';
    extra = ' — possível, mas bem acima da média do mercado. Confirme com o seu plano.';
  }
  el.className = classe;
  el.innerHTML =
    '<strong>' +
    fmt(tm) +
    '% ao mês</strong> equivale a <strong>' +
    fmt(ta) +
    '% ao ano</strong>' +
    extra;
}

// Taxa MENSAL efetiva (juros compostos) de uma operação de Renda Fixa / Reserva /
// Previdência. Precedência: o TEXTO de rentabilidade ("110% CDI", "IPCA+6%",
// "12% a.a.") — indexado a CDI/Selic/IPCA ao vivo do BCB — vence a `taxaMensal`
// explícita. Converte a taxa ANUAL parseada para a mensal equivalente:
// (1+anual)^(1/12)-1. `padraoMensal` entra quando nada foi informado (ex.: 0,8%/mês
// default da previdência). Para IPCA+ o parser usa o IPCA atual — é uma ESTIMATIVA,
// não a inflação realizada no período.
function taxaMensalOperacao(op, padraoMensal = 0) {
  if (!op) return padraoMensal;
  if (op.rentabilidade && typeof parsearRentabilidade === 'function') {
    const parsed = parsearRentabilidade(op.rentabilidade);
    if (parsed && isFinite(parsed.taxa)) return Math.pow(1 + parsed.taxa, 1 / 12) - 1;
  }
  if (op.taxaMensal != null) return op.taxaMensal;
  return padraoMensal;
}

// Valor atual (juros compostos) de uma posição de Renda Fixa / Reserva: soma todos
// os aportes e resgates do ticker, capitalizando cada aporte pela sua taxa mensal
// (derivada do texto de rentabilidade) desde a data até `refTs`. Aportes SEM data
// ou com data FUTURA entram pelo principal (fator 1) em vez de zerar o ativo.
// Espelha exatamente a regra de Meu Patrimônio (mpValorAtualAtivo) para que a aba
// "Meus investimentos" e a foto do patrimônio mostrem o mesmo número.
function valorAtualRendaFixa(ticker, categoria, refTs) {
  const agora = refTs || Date.now();
  const lista = (typeof historicoCompras !== 'undefined' ? historicoCompras : []).filter(
    (op) => op.ticker === ticker && op.categoria === categoria
  );
  let saldo = 0;
  lista.forEach((op) => {
    let ts = op.data_op ? new Date(op.data_op).getTime() : NaN;
    if (op.saldoInicial) {
      // "Já guardado": conta sempre e rende desde o CADASTRO na ferramenta — não
      // desde uma data futura digitada. Usa cadastradoEm > id (timestamp de
      // criação) > data_op, limitado a no máximo agora.
      const cad = op.cadastradoEm
        ? new Date(op.cadastradoEm).getTime()
        : typeof op.id === 'number' && op.id > 1e12
          ? op.id
          : ts;
      if (isFinite(cad)) ts = Math.min(cad, agora);
    } else if (isFinite(ts) && ts > agora) {
      // Aporte PROGRAMADO (data futura) ainda não foi realizado — não entra na
      // foto de agora. Igual à previdência (calcularSaldoPrevidencia ignora futuro).
      return;
    }
    const valor = (op.preco_op || op.preco_pago || 0) * (op.quantidade || 1);
    const taxa = taxaMensalOperacao(op);
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

// ============================================================
// === VENDAS / RESGATES — saldo do dia, IR e taxa da posição  ===
// ============================================================
// Saldo RESGATÁVEL hoje (valor de mercado/atual) de um ativo, por categoria.
// É o teto de um resgate e a base do botão "Resgatar tudo".
function saldoResgatavelAtivo(ticker, categoria) {
  if (categoria === 'previdencia')
    return typeof calcularSaldoPrevidencia === 'function' ? calcularSaldoPrevidencia(ticker) : 0;
  if (categoria === 'renda_fixa' || categoria === 'reserva_emergencia')
    return valorAtualRendaFixa(ticker, categoria);
  // Renda variável: quantidade * cotação atual (cotação > mock > preço médio).
  const resumo = obterResumoCarteira();
  const ativo = resumo[ticker];
  if (!ativo || !(ativo.qtdTotal > 0)) return 0;
  let preco = ativo.precoMedio;
  const cot =
    typeof mpEstado !== 'undefined' && mpEstado.cotacoes ? mpEstado.cotacoes[ticker] : null;
  if (cot && cot.price > 0) preco = cot.price;
  else {
    const m =
      typeof mockAtivosMercado !== 'undefined'
        ? mockAtivosMercado.find((a) => a.ticker === ticker)
        : null;
    if (m && m.preco_atual) preco = m.preco_atual;
  }
  return ativo.qtdTotal * preco;
}

// Dias médios (ponderados pelo valor) das COMPRAS de uma posição — base do IR
// regressivo. Usa cadastradoEm (saldo inicial) > data_op.
function diasMediosPosicao(ticker, categoria) {
  const agora = Date.now();
  let somaPond = 0;
  let somaPeso = 0;
  (typeof historicoCompras !== 'undefined' ? historicoCompras : []).forEach((op) => {
    if (op.ticker !== ticker || op.categoria !== categoria) return;
    if ((op.tipo || 'compra') !== 'compra') return;
    const ref = op.cadastradoEm
      ? new Date(op.cadastradoEm).getTime()
      : op.data_op
        ? new Date(op.data_op).getTime()
        : NaN;
    if (!isFinite(ref) || ref > agora) return;
    const dias = Math.max(0, (agora - ref) / 86400000);
    const peso = (op.preco_op || op.preco_pago || 0) * (op.quantidade || 1);
    somaPond += dias * peso;
    somaPeso += peso;
  });
  return somaPeso > 0 ? somaPond / somaPeso : 0;
}

// IR regressivo de previdência (VGBL/PGBL): 35% (<2a) … 10% (>10a).
function aliquotaIRPrevidenciaRegressiva(anos) {
  if (anos <= 2) return 0.35;
  if (anos <= 4) return 0.3;
  if (anos <= 6) return 0.25;
  if (anos <= 8) return 0.2;
  if (anos <= 10) return 0.15;
  return 0.1;
}

// Estimativa de IR sobre um RESGATE de `valorResgate` (bruto). O imposto incide
// sobre o LUCRO proporcional ao que está sendo resgatado. RF/Reserva usam a
// tabela regressiva por dias; previdência por anos; RV pela subcategoria.
function irEstimadoResgate(ticker, categoria, valorResgate) {
  if (!(valorResgate > 0)) return { aliquota: 0, ir: 0, lucro: 0 };
  const total = saldoResgatavelAtivo(ticker, categoria);
  const resumo = obterResumoCarteira();
  const ativo = resumo[ticker];
  const investido = ativo ? ativo.valorTotalInvestido : 0;
  const lucroTotal = Math.max(0, total - investido);
  const fracao = total > 0 ? Math.min(1, valorResgate / total) : 0;
  const lucroResgate = lucroTotal * fracao;
  let aliquota = 0;
  if (categoria === 'renda_fixa' || categoria === 'reserva_emergencia') {
    aliquota =
      typeof mpAliquotaIRRendaFixa === 'function'
        ? mpAliquotaIRRendaFixa(diasMediosPosicao(ticker, categoria))
        : 0.15;
  } else if (categoria === 'previdencia') {
    aliquota = aliquotaIRPrevidenciaRegressiva(diasMediosPosicao(ticker, categoria) / 365.25);
  } else {
    aliquota =
      typeof mpAliquotaIRRendaVariavel === 'function'
        ? mpAliquotaIRRendaVariavel(ativo ? ativo.subcategoria : null)
        : 0.15;
  }
  return { aliquota, ir: lucroResgate * aliquota, lucro: lucroResgate };
}

// Taxa contratada (texto) da posição de RF/Reserva — carimbada na operação de
// resgate para que a parcela resgatada componha à MESMA taxa dos aportes; assim
// um resgate total zera a posição de forma permanente (ver valorAtualRendaFixa).
function taxaTextoResgate(ticker, categoria) {
  const resumo = obterResumoCarteira();
  const a = resumo[ticker];
  return a && a.rentabilidade ? a.rentabilidade : null;
}

// Abre o drawer já em modo VENDA/RESGATE, pré-preenchido com o ativo escolhido
// na Carteira (botão "Resgatar"/"Vender"). É o "lugar para resgatar um CDB".
function iniciarResgate(ticker) {
  const resumo = obterResumoCarteira();
  const ativo = resumo[ticker];
  if (!ativo) return mostrarToast('Ativo não encontrado na sua carteira.', 'erro');
  if (typeof abrirDrawerOperacao === 'function') abrirDrawerOperacao();
  if (typeof alternarTipoOperacao === 'function') alternarTipoOperacao('venda');
  const elTicker = document.getElementById('compraTicker');
  if (elTicker) elTicker.value = ticker;
  const elCat = document.getElementById('compraCategoria');
  if (elCat && ativo.categoria) {
    elCat.value = ativo.categoria;
    elCat.dataset.touched = '1';
  }
  const elSub = document.getElementById('compraSubcategoria');
  if (elSub && ativo.subcategoria) {
    elSub.value = ativo.subcategoria;
    elSub.dataset.touched = '1';
  }
  const elCorr = document.getElementById('compraCorretora');
  if (elCorr && ativo.corretora) elCorr.value = ativo.corretora;
  if (typeof ajustarCamposPorCategoria === 'function') ajustarCamposPorCategoria();
  atualizarInfoResgate();
}

// Resolve o ativo da carteira a partir do que está digitado no form de venda.
function ativoCarteiraDoForm() {
  const ticker = ((document.getElementById('compraTicker') || {}).value || '').trim();
  if (!ticker) return null;
  const resumo = obterResumoCarteira();
  return resumo[ticker] || resumo[ticker.toUpperCase()] || null;
}

// Caixa "Saldo disponível hoje" + IR estimado + botão Resgatar tudo. Só aparece em
// modo VENDA com um ativo da carteira selecionado. Chamado por ajustar/alternar e
// pelos oninput de ticker/preço.
function atualizarInfoResgate() {
  const box = document.getElementById('resgateInfoBox');
  if (!box) return;
  const tipo = (document.getElementById('tipoOperacao') || {}).value;
  const ativo = ativoCarteiraDoForm();
  if (tipo !== 'venda' || !ativo) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  const tk =
    ativo.__ticker || ((document.getElementById('compraTicker') || {}).value || '').toUpperCase();
  const categoria =
    ativo.categoria || (document.getElementById('compraCategoria') || {}).value || '';
  const saldo = saldoResgatavelAtivo(tk, categoria);
  const valorInformado =
    typeof parseBRL === 'function'
      ? parseBRL((document.getElementById('compraPreco') || {}).value)
      : 0;
  const semQtd =
    categoria === 'renda_fixa' || categoria === 'reserva_emergencia' || categoria === 'previdencia';
  // Em RV o campo é preço UNITÁRIO; o bruto resgatado = preço × qtd informada.
  let bruto = saldo;
  if (valorInformado > 0) {
    if (semQtd) bruto = Math.min(valorInformado, saldo);
    else {
      const q =
        typeof parseQtd === 'function'
          ? parseQtd((document.getElementById('compraQtd') || {}).value)
          : 0;
      bruto = Math.min(valorInformado * (q || 0), saldo);
    }
  }
  const est = irEstimadoResgate(tk, categoria, bruto);
  const retemIR = semQtd;
  const irMostrar = est.ir;
  const liquido = bruto - (retemIR ? est.ir : 0);
  const fmt =
    typeof formatarMoeda === 'function' ? formatarMoeda : (v) => 'R$ ' + Number(v).toFixed(2);
  const linhaIR =
    irMostrar > 0.005
      ? `<div style="font-size:11px;color:var(--cor-texto-mutado);margin-top:2px;">IR estimado ${fmt(est.ir)} (${(est.aliquota * 100).toFixed(1)}% sobre lucro) · ${retemIR ? 'líquido' : 'a recolher via DARF · você recebe'} ${fmt(liquido)}</div>`
      : '';
  box.style.display = 'block';
  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:var(--cor-bg-erro,#fff1f2);border:1px solid #fecdd3;border-radius:9px;">
      <div style="min-width:0;">
        <div style="font-size:10.5px;color:var(--cor-texto-mutado);text-transform:uppercase;letter-spacing:.04em;">Saldo disponível hoje${semQtd ? ' (com rendimento)' : ''}</div>
        <div style="font-weight:700;font-size:15px;color:var(--cor-texto-principal);" class="valor-mascarado">${fmt(saldo)}</div>
        ${linhaIR}
      </div>
      <button type="button" class="btn-secundario" style="font-size:12px;padding:7px 12px;white-space:nowrap;flex-shrink:0;" onclick="resgatarTudo()"><i class="ph ph-hand-coins"></i> Resgatar tudo</button>
    </div>`;
}

// Preenche o valor de resgate com o saldo total do ativo.
function resgatarTudo() {
  const ativo = ativoCarteiraDoForm();
  if (!ativo) return;
  const tk =
    ativo.__ticker || ((document.getElementById('compraTicker') || {}).value || '').toUpperCase();
  const categoria = ativo.categoria;
  const saldo = saldoResgatavelAtivo(tk, categoria);
  const semQtd =
    categoria === 'renda_fixa' || categoria === 'reserva_emergencia' || categoria === 'previdencia';
  const elPreco = document.getElementById('compraPreco');
  if (semQtd) {
    if (elPreco && typeof setValorBRLInput === 'function') setValorBRLInput(elPreco, saldo);
    else if (elPreco) elPreco.value = saldo.toFixed(2).replace('.', ',');
  } else {
    const precoUnit = ativo.qtdTotal > 0 ? saldo / ativo.qtdTotal : 0;
    const elQtd = document.getElementById('compraQtd');
    if (elPreco && typeof setValorBRLInput === 'function') setValorBRLInput(elPreco, precoUnit);
    else if (elPreco) elPreco.value = precoUnit.toFixed(2).replace('.', ',');
    if (elQtd && typeof setValorQtdInput === 'function') setValorQtdInput(elQtd, ativo.qtdTotal);
    else if (elQtd) elQtd.value = ativo.qtdTotal;
  }
  if (typeof calcularTotalCompra === 'function') calcularTotalCompra();
  atualizarInfoResgate();
}

// ============================================================
// === COMPLETAR RENTABILIDADE — Renda Fixa / Reserva legadas ===
// ============================================================
// Investimentos de RF/Reserva cadastrados SEM rentabilidade (ex.: antes do campo
// virar obrigatório) ficam parados no valor aportado, pois não há taxa para
// capitalizar. Detectamos esses casos e oferecemos completar de uma vez.
var pendenciasRentEditando = [];

// Agrupa por ticker+categoria os RF/Reserva que têm compra mas nenhuma taxa
// (sem rentabilidade e sem taxaMensal) — exatamente os que não rendem.
function pendenciasRentabilidadeRF() {
  const grupos = {};
  const agora = Date.now();
  (typeof historicoCompras !== 'undefined' ? historicoCompras : []).forEach((op) => {
    if (op.categoria !== 'renda_fixa' && op.categoria !== 'reserva_emergencia') return;
    // Só considera o que já aconteceu — aporte programado (futuro) não aparece na
    // posição ainda, então não deve gerar aviso de "sem rentabilidade".
    if (op.data_op) {
      const ts = new Date(op.data_op).getTime();
      if (isFinite(ts) && ts > agora) return;
    }
    const key = op.categoria + '|' + op.ticker;
    if (!grupos[key])
      grupos[key] = {
        ticker: op.ticker,
        categoria: op.categoria,
        totalInvestido: 0,
        temTaxa: false,
        temCompra: false,
      };
    const g = grupos[key];
    const valor = (op.preco_op || op.preco_pago || 0) * (op.quantidade || 1);
    if ((op.tipo || 'compra') === 'compra') {
      g.totalInvestido += valor;
      g.temCompra = true;
    }
    if (op.rentabilidade || op.taxaMensal > 0) g.temTaxa = true;
  });
  return Object.values(grupos).filter((g) => g.temCompra && !g.temTaxa && g.totalInvestido > 0);
}

// Banner na aba Carteira. Some sozinho quando não há pendências ou quando o
// usuário dispensa na sessão. Chamado por atualizarCarteiraAtivos().
function renderAvisoRentabilidadeRF() {
  const box = document.getElementById('avisoRentabilidadeRF');
  if (!box) return;
  let dispensado = false;
  try {
    dispensado = sessionStorage.getItem('appliquei_aviso_rent_rf') === '1';
  } catch (_) {}
  const pend = pendenciasRentabilidadeRF();
  if (pend.length === 0 || dispensado) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  const n = pend.length;
  box.style.display = 'block';
  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--cor-bg-amber);border:1px solid var(--cor-borda-amber);border-radius:10px;">
      <i class="ph-fill ph-warning-circle" style="font-size:22px;color:var(--tinta-ambar);flex-shrink:0;"></i>
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;font-size:13px;color:var(--cor-txt-amber);">${n} investimento${n === 1 ? '' : 's'} de renda fixa sem rentabilidade</div>
        <div style="font-size:12px;color:var(--cor-txt-amber);">Sem a taxa ${n === 1 ? 'ele não rende' : 'eles não rendem'} — fica${n === 1 ? '' : 'm'} no valor aportado. Informe para valorizar desde a data do aporte.</div>
      </div>
      <button onclick="abrirModalCompletarRentabilidade()" class="btn-acao" style="background:#d97706;flex-shrink:0;padding:8px 14px;font-size:12.5px;white-space:nowrap;"><i class="ph ph-pencil-simple"></i> Completar</button>
      <button onclick="dispensarAvisoRentabilidadeRF()" aria-label="Dispensar" title="Dispensar por agora" style="background:none;border:none;cursor:pointer;color:var(--cor-txt-amber);font-size:16px;flex-shrink:0;"><i class="ph ph-x"></i></button>
    </div>`;
}

function dispensarAvisoRentabilidadeRF() {
  try {
    sessionStorage.setItem('appliquei_aviso_rent_rf', '1');
  } catch (_) {}
  const box = document.getElementById('avisoRentabilidadeRF');
  if (box) {
    box.style.display = 'none';
    box.innerHTML = '';
  }
}

function abrirModalCompletarRentabilidade() {
  const modal = document.getElementById('modalCompletarRentabilidade');
  const corpo = document.getElementById('corpoModalCompletarRent');
  if (!modal || !corpo) return;
  pendenciasRentEditando = pendenciasRentabilidadeRF();
  if (pendenciasRentEditando.length === 0) {
    if (typeof mostrarToast === 'function')
      mostrarToast('Tudo certo — nenhuma rentabilidade pendente.', 'sucesso');
    return;
  }
  const ROT = { renda_fixa: 'Renda Fixa', reserva_emergencia: 'Reserva' };
  corpo.innerHTML = pendenciasRentEditando
    .map(
      (g, i) => `
    <div class="form-group" style="margin:0;">
      <label style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;">
        <span style="font-weight:600;color:var(--cor-texto-principal);">${g.ticker}</span>
        <span style="font-weight:400;color:var(--cor-texto-mutado);">${ROT[g.categoria] || g.categoria} · ${formatarMoeda(g.totalInvestido)}</span>
      </label>
      <input type="text" id="rentPend_${i}" placeholder="Ex: 110% CDI, IPCA+6%, 12% a.a." style="width:100%;" />
    </div>`
    )
    .join('');
  modal.style.display = 'flex';
}

function fecharModalCompletarRentabilidade() {
  const modal = document.getElementById('modalCompletarRentabilidade');
  if (modal) modal.style.display = 'none';
}

// Aplica a rentabilidade digitada a TODOS os aportes/resgates do ticker (mesma
// categoria). Linhas em branco continuam pendentes; linhas inválidas bloqueiam.
function salvarCompletarRentabilidade() {
  let invalidos = 0;
  const atualizacoes = [];
  pendenciasRentEditando.forEach((g, i) => {
    const el = document.getElementById('rentPend_' + i);
    const val = el ? el.value.trim() : '';
    if (!val) return;
    if (!parsearRentabilidade(val)) {
      invalidos++;
      if (el) el.style.borderColor = 'var(--cor-erro)';
      return;
    }
    if (el) el.style.borderColor = '';
    atualizacoes.push({ ticker: g.ticker, categoria: g.categoria, rentabilidade: val });
  });
  if (invalidos > 0) {
    if (typeof mostrarToast === 'function')
      mostrarToast(
        'Rentabilidade não reconhecida. Use formatos como 110% CDI, IPCA+6% ou 12% a.a.',
        'erro'
      );
    return;
  }
  if (atualizacoes.length === 0) {
    fecharModalCompletarRentabilidade();
    return;
  }
  atualizacoes.forEach((u) => {
    historicoCompras.forEach((op) => {
      if (op.ticker === u.ticker && op.categoria === u.categoria)
        op.rentabilidade = u.rentabilidade;
    });
  });
  localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));
  if (typeof atualizarCarteiraAtivos === 'function') atualizarCarteiraAtivos();
  if (typeof renderMeuPatrimonio === 'function') {
    try {
      renderMeuPatrimonio(true);
    } catch (_) {}
  }
  if (typeof renderizarOperacoes === 'function') renderizarOperacoes();
  if (typeof mostrarToast === 'function')
    mostrarToast(
      `Rentabilidade aplicada a ${atualizacoes.length} investimento${atualizacoes.length === 1 ? '' : 's'}. Agora rende${atualizacoes.length === 1 ? '' : 'm'} desde o aporte.`,
      'sucesso'
    );
  fecharModalCompletarRentabilidade();
}

function atualizarProjecaoForm() {
  const preview = document.getElementById('projecaoRfPreview');
  if (!preview) return;
  const cat = document.getElementById('compraCategoria').value;
  const ehRF = cat === 'renda_fixa' || cat === 'reserva_emergencia';
  if (!ehRF) {
    preview.style.display = 'none';
    return;
  }

  const rent = document.getElementById('compraRentabilidade').value.trim();
  // Validação inline da string de rentabilidade (mesmo sem todos os outros campos)
  if (rent) {
    const parsed = parsearRentabilidade(rent);
    const hint = document.getElementById('compraRentabilidade');
    if (parsed) hint.style.borderColor = '';
    else hint.style.borderColor = 'var(--cor-erro)';
  }

  const semQtd = cat === 'renda_fixa' || cat === 'reserva_emergencia' || cat === 'previdencia';
  const qtd = semQtd ? 1 : parseQtd(document.getElementById('compraQtd').value) || 0;
  const preco = parseBRL(document.getElementById('compraPreco').value) || 0;
  const dataOp = document.getElementById('compraData').value;
  const venc = document.getElementById('compraVencimento').value;
  const valor = qtd * preco;
  if (!valor || !dataOp || !venc || !rent) {
    preview.style.display = 'none';
    return;
  }
  const proj = calcularProjecaoRF(valor, dataOp, venc, rent);
  if (!proj) {
    preview.classList.add('warning');
    preview.style.display = 'block';
    preview.innerHTML = `<i class="ph ph-warning"></i> Não consegui interpretar a rentabilidade. Use formatos como <strong>110% CDI</strong>, <strong>IPCA+6%</strong>, <strong>12% a.a.</strong>`;
    return;
  }
  preview.classList.remove('warning');
  const fonte =
    taxasMercado.fonte === 'BCB'
      ? `CDI ${(taxasMercado.cdi * 100).toFixed(2)}% · IPCA ${(taxasMercado.ipca * 100).toFixed(2)}% (BCB)`
      : `taxas estimadas`;
  preview.style.display = 'block';
  preview.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <span><i class="ph-fill ph-trend-up"></i> <strong>${proj.descricaoTaxa}</strong> · ${proj.anos.toFixed(2)} anos</span>
            <span style="font-weight:600;">Bruto no vencimento: ${formatarMoeda(proj.valorFinalBruto)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-top:4px;">
            <span style="opacity:.85;">IR ${(proj.aliquotaIR * 100).toFixed(1)}% · ${fonte}</span>
            <span class="destaque-liquido">Líquido: ${formatarMoeda(proj.valorFinalLiquido)} (+${formatarMoeda(proj.rendimentoLiquido)})</span>
        </div>`;
}

// Localiza a operação pelo id tolerando string vs número. Depois de uma volta
// pela nuvem o id pode voltar como string, e o `===` do find falhava calado —
// era o "Operação não encontrada" ao clicar em editar.
function acharOperacao(id) {
  if (typeof historicoCompras === 'undefined') return null;
  return historicoCompras.find((o) => String(o.id) === String(id)) || null;
}

// Remove uma operação e TUDO que ela produziu: a perna do ativo, a perna de
// caixa (tx_origem_) e os lançamentos futuros do compromisso recorrente.
// A edição usava um filtro que só pegava a perna do ativo — a de caixa ficava
// órfã (INV-04) e o saldo seguia debitado por uma compra que já não existia.
function removerOperacaoEPernas(id) {
  const alvo = String(id);
  const op = acharOperacao(id);
  if (
    op &&
    (op.categoria === 'previdencia' || op.categoria === 'reserva_emergencia') &&
    op.recorrente &&
    !op.gerado &&
    typeof removerLancamentosFuturosCompromisso === 'function'
  ) {
    removerLancamentosFuturosCompromisso(op.id);
  }
  historicoCompras = historicoCompras.filter((o) => String(o.id) !== alvo);
  transacoes = transacoes.filter((t) => {
    if (String(t.id) === alvo) return false;
    if (String(t.id) === 'tx_origem_' + alvo) return false;
    if (t.operacaoId != null && String(t.operacaoId) === alvo) return false;
    return true;
  });
}

// Quanto do saldo da conta está preso na operação que está sendo editada. Esse
// valor volta ao caixa quando a edição é confirmada, então conta como disponível
// na validação de saldo.
function creditoDaEdicaoNaConta(contaId) {
  const edicaoId = typeof operacaoEmEdicaoId !== 'undefined' ? operacaoEmEdicaoId : null;
  if (edicaoId == null || !contaId) return 0;
  const alvo = 'tx_origem_' + String(edicaoId);
  const perna = transacoes.find((t) => String(t.id) === alvo && t.contaId === contaId);
  return perna ? Number(perna.valor) || 0 : 0;
}

function registrarOperacaoAtivo() {
  const ticker = document.getElementById('compraTicker').value.toUpperCase();
  const tipoOp = document.getElementById('tipoOperacao').value;
  const categoria = document.getElementById('compraCategoria').value;
  const corretora = document.getElementById('compraCorretora').value.trim();
  const dataInput = document.getElementById('compraData').value;
  const vencimento = document.getElementById('compraVencimento').value;
  const rentabilidade = document.getElementById('compraRentabilidade').value.trim();
  const semQtd =
    categoria === 'renda_fixa' || categoria === 'reserva_emergencia' || categoria === 'previdencia';
  const qtd = semQtd ? 1 : parseQtd(document.getElementById('compraQtd').value);
  const preco = parseBRL(document.getElementById('compraPreco').value);
  const subcategoria =
    categoria === 'renda_variavel'
      ? document.getElementById('compraSubcategoria').value ||
        subcategoriaInferidaDoTicker(ticker) ||
        'acoes'
      : null;

  // "Valor já guardado" (saldo inicial): só faz sentido em previdência /
  // reserva e numa COMPRA. É o que o usuário já tinha acumulado antes de
  // usar a Appliquei — entra no patrimônio, mas não toca o Controle.
  const ehPrevOuReserva = categoria === 'previdencia' || categoria === 'reserva_emergencia';
  const saldoInicial =
    ehPrevOuReserva && tipoOp === 'compra'
      ? parseBRL((document.getElementById('prevSaldoInicial') || {}).value) || 0
      : 0;
  const temSaldoInicial = saldoInicial > 0;
  const temAporte = !(isNaN(preco) || preco <= 0);

  if (!ticker) return mostrarToast('Preencha o Ticker/Nome corretamente.', 'erro');
  if (!temAporte && !temSaldoInicial) return mostrarToast('Preencha o Valor corretamente.', 'erro');
  // Taxa de previdência acima de 3% AO MÊS (42,6% ao ano) não existe — é
  // sempre um número anual digitado no campo mensal. Barrar aqui é o que
  // impede um dígito de virar patrimônio de mentira que só cresce com o
  // tempo, sem nada na tela denunciando a origem.
  if (categoria === 'previdencia') {
    const tmCheck =
      typeof lerTaxaMensalPrevidencia === 'function' ? lerTaxaMensalPrevidencia() : null;
    if (tmCheck != null && tmCheck > TAXA_MENSAL_ABSURDA) {
      const anual = (taxaMensalParaAnual(tmCheck) * 100).toFixed(0);
      const inpT = document.getElementById('prevTaxaMensal');
      if (inpT) {
        inpT.style.borderColor = 'var(--cor-erro)';
        inpT.focus();
        setTimeout(() => {
          inpT.style.borderColor = '';
        }, 3000);
      }
      return mostrarToast(
        `Rentabilidade de ${anual}% ao ano é impossível para uma previdência. ` +
          `Confira a unidade ao lado do campo — o padrão é % ao mês.`,
        'erro'
      );
    }
  }
  if (temAporte && !semQtd && (isNaN(qtd) || qtd <= 0))
    return mostrarToast('Preencha a Quantidade corretamente.', 'erro');
  if (!corretora) {
    const elCorr = document.getElementById('compraCorretora');
    if (elCorr) {
      elCorr.style.borderColor = 'var(--cor-erro)';
      elCorr.focus();
      setTimeout(() => {
        elCorr.style.borderColor = '';
      }, 2500);
    }
    return mostrarToast('Informe o banco/corretora — campo obrigatório.', 'erro');
  }

  // Rentabilidade: em Renda Fixa / Reserva é a ÚNICA fonte de valorização (não há
  // cotação de mercado), então é OBRIGATÓRIA numa compra e precisa ser interpretável.
  // Na Previdência é opcional (há a taxa mensal fixa), mas se informada deve ser válida.
  const ehRFouReserva = categoria === 'renda_fixa' || categoria === 'reserva_emergencia';
  const focarRentabilidade = () => {
    const elR = document.getElementById('compraRentabilidade');
    if (elR) {
      elR.style.borderColor = 'var(--cor-erro)';
      elR.focus();
      setTimeout(() => {
        elR.style.borderColor = '';
      }, 2500);
    }
  };
  if (ehRFouReserva && tipoOp === 'compra') {
    if (!rentabilidade) {
      focarRentabilidade();
      return mostrarToast('Informe a rentabilidade (ex: 110% CDI, IPCA+6%, 12% a.a.).', 'erro');
    }
    if (!parsearRentabilidade(rentabilidade)) {
      focarRentabilidade();
      return mostrarToast(
        'Rentabilidade não reconhecida. Use formatos como 110% CDI, IPCA+6% ou 12% a.a.',
        'erro'
      );
    }
  }
  if (categoria === 'previdencia' && rentabilidade && !parsearRentabilidade(rentabilidade)) {
    focarRentabilidade();
    return mostrarToast(
      'Rentabilidade não reconhecida. Use formatos como 100% CDI, IPCA+6% ou 8% a.a.',
      'erro'
    );
  }

  // IR estimado do resgate, calculado na validação ANTES de empilhar a venda
  // (senão o saldo já vem abatido e o lucro/IR zeram). Reusado no caixa.
  let resgateEstIR = null;
  if (tipoOp === 'venda') {
    const carteiraAtual = obterResumoCarteira();
    const ativoNaCarteira = carteiraAtual[ticker];
    if (semQtd) {
      // RF/Reserva/Previdência: resgate por VALOR — valida contra o saldo do dia.
      const saldoDisp =
        typeof saldoResgatavelAtivo === 'function' ? saldoResgatavelAtivo(ticker, categoria) : 0;
      if (saldoDisp <= 0.005)
        return mostrarToast(`Você não tem saldo resgatável em ${ticker}.`, 'erro');
      if (preco > saldoDisp + 0.01)
        return mostrarToast(
          `Resgate acima do saldo. Disponível hoje: ${formatarMoeda(saldoDisp)} em ${ticker}.`,
          'erro'
        );
      // IR estimado calculado AGORA (antes do push da venda).
      resgateEstIR =
        typeof irEstimadoResgate === 'function'
          ? irEstimadoResgate(ticker, categoria, preco)
          : { ir: 0 };
    } else if (!ativoNaCarteira || ativoNaCarteira.qtdTotal < qtd) {
      return mostrarToast(
        `Saldo insuficiente! Você possui apenas ${ativoNaCarteira ? ativoNaCarteira.qtdTotal : 0} unidades de ${ticker}.`,
        'erro'
      );
    }
  }

  // Fase 3B: numa COMPRA com aporte, o dinheiro sai de uma CONTA cadastrada e
  // COM SALDO, escolhida pelo usuário (value = conta.id). O seletor só lista
  // contas com caixa > 0, e aqui revalidamos o saldo disponível: comprar acima
  // do que a conta tem deixaria o caixa negativo (dinheiro inventado no
  // sistema). Validado ANTES de qualquer push para não deixar a operação órfã.
  //
  // Duas origens fogem dessa regra por definição, e são o ponto do cadastro
  // retroativo: RETROATIVO (posição que já existia antes do app) e EXTERNO
  // (dinheiro que nunca passou por conta cadastrada). Nenhuma das duas debita
  // caixa nem gera transação — só entram no patrimônio.
  let bancoOrigemAporte = '';
  let contaOrigemIdSel; // conta resolvida (sempre uma cadastrada)
  let origemRecursoSel = 'conta';
  if (tipoOp === 'compra' && temAporte) {
    const elOrigemSel = document.getElementById('compraOrigemRecurso');
    const origem = elOrigemSel ? elOrigemSel.value : '';
    if (!origem) {
      if (elOrigemSel) {
        elOrigemSel.style.borderColor = 'var(--cor-erro)';
        elOrigemSel.focus();
        setTimeout(() => {
          elOrigemSel.style.borderColor = '';
        }, 2500);
      }
      return mostrarToast(
        'Escolha de onde vem o dinheiro — uma conta com saldo, ou cadastro retroativo / aporte externo.',
        'erro'
      );
    }
    if (typeof origemNaoDebitaConta === 'function' && origemNaoDebitaConta(origem)) {
      origemRecursoSel = origem === ORIGEM_RETROATIVA ? 'retroativo' : 'externo';
    } else {
      const c = typeof obterConta === 'function' ? obterConta(origem) : null;
      if (!c) {
        return mostrarToast('Conta de origem inválida. Escolha uma conta com saldo.', 'erro');
      }
      contaOrigemIdSel = c.id;
      bancoOrigemAporte = c.nome;
      // Revalida o saldo disponível na conta escolhida (não deixa ficar negativo).
      // Numa operação AGENDADA a referência é a data dela: o que vale é o saldo
      // projetado para aquele dia, não o de hoje (saldoCaixaPorConta projeta).
      const refSaldo = typeof dataOperacaoRefMs === 'function' ? dataOperacaoRefMs() : Date.now();
      const saldos =
        typeof saldoCaixaPorConta === 'function'
          ? saldoCaixaPorConta(refSaldo)
          : typeof mpCalcularSaldoPorInstituicao === 'function'
            ? (() => {
                const m = mpCalcularSaldoPorInstituicao(Date.now());
                const out = {};
                Object.keys(m).forEach((k) => (out[k] = m[k].caixa));
                return out;
              })()
            : {};
      let caixaDisp = Number(saldos[c.id]) || 0;
      // Editando: o débito da versão ANTIGA ainda está no saldo e só será
      // desfeito ao confirmar. Sem devolvê-lo aqui, aumentar o valor de uma
      // compra já registrada seria barrado por um saldo que a própria operação
      // em edição consumiu.
      caixaDisp += creditoDaEdicaoNaConta(c.id);
      const custoAporte = qtd * preco;
      if (custoAporte > caixaDisp + 0.005) {
        if (elOrigemSel) {
          elOrigemSel.style.borderColor = 'var(--cor-erro)';
          elOrigemSel.focus();
          setTimeout(() => {
            elOrigemSel.style.borderColor = '';
          }, 2500);
        }
        const quando =
          refSaldo > Date.now() ? ` em ${new Date(refSaldo).toLocaleDateString('pt-BR')}` : '';
        return mostrarToast(
          `Saldo insuficiente em ${c.nome}${quando}: disponível ${formatarMoeda(caixaDisp)}, compra ${formatarMoeda(custoAporte)}.`,
          'erro'
        );
      }
    }
  }
  const semDebitoCaixa = origemRecursoSel !== 'conta';

  // Confirmada a validação, a versão antiga da operação em edição sai de cena —
  // com AS DUAS pernas e os compromissos que ela gerou. Feito aqui, e não ao
  // abrir o drawer, para que fechar sem confirmar não perca nada.
  const edicaoId = typeof operacaoEmEdicaoId !== 'undefined' ? operacaoEmEdicaoId : null;
  if (edicaoId != null) removerOperacaoEPernas(edicaoId);

  const dataOp = dataInput ? new Date(dataInput + 'T12:00:00') : new Date();
  let valorTotal = 0;
  let lancamentosFuturos = 0;
  let resgateIRInfo = null;

  // === APORTE / OPERAÇÃO NORMAL (afeta o Controle Financeiro) ===
  if (temAporte) {
    valorTotal = qtd * preco;
    const operacao = {
      id: Date.now(),
      ticker: ticker,
      quantidade: qtd,
      preco_op: preco,
      tipo: tipoOp,
      data_op: dataOp.toISOString(),
      categoria: categoria || null,
      subcategoria: subcategoria,
      corretora: corretora || null,
    };
    // De onde veio o dinheiro. 'conta' é o fluxo normal (debita caixa);
    // 'retroativo' e 'externo' não tocam em conta nenhuma — ver o bloco de
    // gravação de transações mais abaixo.
    if (tipoOp === 'compra') operacao.origemRecurso = origemRecursoSel;
    if (categoria === 'renda_fixa') {
      if (vencimento) operacao.vencimento = vencimento;
      if (rentabilidade) operacao.rentabilidade = rentabilidade;
    }
    if (categoria === 'reserva_emergencia') {
      if (rentabilidade) operacao.rentabilidade = rentabilidade;
    }
    // Previdência: indexador opcional (texto). Quando presente, valoriza pelo BCB e
    // tem precedência sobre a taxaMensal fixa (ver taxaMensalOperacao).
    if (categoria === 'previdencia') {
      if (rentabilidade) operacao.rentabilidade = rentabilidade;
    }
    // RESGATE de RF/Reserva/Previdência: herda a taxa da posição para que a
    // parcela resgatada componha igual aos aportes — assim um resgate TOTAL zera
    // a posição de forma permanente, e um parcial deixa o restante rendendo.
    if (tipoOp === 'venda') {
      if (categoria === 'renda_fixa' || categoria === 'reserva_emergencia') {
        const txt =
          typeof taxaTextoResgate === 'function' ? taxaTextoResgate(ticker, categoria) : null;
        if (txt) operacao.rentabilidade = txt;
      } else if (categoria === 'previdencia') {
        const comprasPrev = historicoCompras.filter(
          (o) =>
            o.ticker === ticker &&
            o.categoria === 'previdencia' &&
            (o.tipo || 'compra') === 'compra'
        );
        const ult = comprasPrev[comprasPrev.length - 1];
        if (ult) {
          if (ult.rentabilidade) operacao.rentabilidade = ult.rentabilidade;
          else operacao.taxaMensal = ult.taxaMensal != null ? ult.taxaMensal : 0.008;
        }
      }
    }
    const ehRecorrenteCompra = ehPrevOuReserva && tipoOp === 'compra';
    if (ehRecorrenteCompra) {
      operacao.recorrente = !!document.getElementById('prevRecorrente').checked;
      const diaInp = parseInt(document.getElementById('prevDiaRecorrencia').value, 10);
      operacao.diaRecorrencia = diaInp >= 1 && diaInp <= 31 ? diaInp : dataOp.getDate();
      const duracaoInp = parseInt(document.getElementById('prevDuracaoAnos').value, 10);
      operacao.duracaoAnos =
        duracaoInp >= 1 && duracaoInp <= 40 ? duracaoInp : categoria === 'previdencia' ? 10 : 5;
      if (categoria === 'previdencia') {
        const tm = lerTaxaMensalPrevidencia();
        operacao.taxaMensal = tm != null ? tm : 0.008;
      }
    }
    historicoCompras.push(operacao);

    const descQtd = semQtd ? '' : `${formatarQtd(qtd)}x `;
    if (tipoOp === 'compra' && semDebitoCaixa) {
      // RETROATIVO / EXTERNO: entra só na carteira (historicoCompras). Nenhuma
      // transação é gravada — nem a perna do ativo, nem a de caixa. É o mesmo
      // caminho que o "já guardado" (saldoInicial) usa desde sempre, e é o que
      // garante a regra do produto: operação retroativa não mexe no saldo atual
      // das contas nem vira despesa no Controle Financeiro.
      //
      // Um `investimento_*` avulso aqui não serviria: sem perna de caixa irmã
      // ele debitaria o bucket "A reconciliar" (INV-01) ou, com temLegCaixa,
      // acusaria perna faltando (INV-03).
      // Só o RETROATIVO ganha a marca de saldo inicial. A diferença entre as
      // duas origens está no que o valor informado SIGNIFICA:
      //
      //   · retroativo — o número é o saldo de HOJE de uma posição antiga.
      //     Capitalizar desde 2019 inflaria o patrimônio, então `saldoInicial`
      //     manda render a partir do cadastro (ver valorAtualRendaFixa);
      //     `data_op` fica no passado para o histórico e para a alíquota
      //     regressiva de IR do resgate (mpAliquotaIRRendaFixa).
      //
      //   · externo — o número é o valor APORTADO na data da operação, igual a
      //     qualquer outra compra. Rende desde data_op. Marcá-lo como saldo
      //     inicial fazia um aporte externo de seis meses atrás valer hoje
      //     exatamente o que valia no dia.
      const ehRetroativoOp = origemRecursoSel === 'retroativo';
      if (semQtd && ehRetroativoOp) {
        operacao.saldoInicial = true;
        operacao.cadastradoEm = new Date().toISOString();
      }
      // Recorrência: o retroativo não tem o que agendar (é saldo passado). O
      // aporte externo tem — as parcelas nascem sem conta e marcadas com
      // origemExterna, que é o que as isenta de debitar caixa (INV-01/INV-03).
      if (ehRetroativoOp) operacao.recorrente = false;
      else operacao.origemExterna = true;
    } else if (tipoOp === 'compra') {
      let tipoAtivoStr = semQtd ? 'investimento_fixo' : 'investimento_variavel';
      // Fase 3B: o débito de caixa do aporte é a PERNA DE TRANSFERÊNCIA
      // (transferencia_saida com contaId). A tx do ativo fica marcada com
      // temLegCaixa para NÃO contar no caixa (evita duplo-débito) — ela
      // serve só para a carteira/DRE.
      const contaOrigemId =
        contaOrigemIdSel != null
          ? contaOrigemIdSel
          : typeof obterOuCriarContaPorNome === 'function'
            ? (obterOuCriarContaPorNome(bancoOrigemAporte) || {}).id
            : undefined;
      // Guarda a conta-origem no template para as recorrências (Fase 3B-2)
      // propagarem a mesma perna de caixa.
      operacao.contaOrigemId = contaOrigemId;
      operacao.contaOrigemNome = bancoOrigemAporte;
      transacoes.push({
        id: operacao.id.toString(),
        operacaoId: operacao.id,
        descricao: `Compra: ${descQtd}${ticker}`,
        valor: valorTotal,
        categoria: tipoAtivoStr,
        mes: dataOp.getMonth(),
        ano: dataOp.getFullYear(),
        data: dataOp.toISOString(),
        pago: true,
        temLegCaixa: true,
      });
      transacoes.push({
        id: 'tx_origem_' + operacao.id,
        operacaoId: operacao.id,
        descricao: `Transferência → ${ticker} (${corretora})`,
        valor: valorTotal,
        categoria: 'transferencia_saida',
        banco: bancoOrigemAporte,
        contaId: contaOrigemId,
        mes: dataOp.getMonth(),
        ano: dataOp.getFullYear(),
        data: dataOp.toISOString(),
        pago: true,
      });
    } else {
      // A venda/resgate CREDITA o caixa da conta de DESTINO escolhida; na falta,
      // cai na conta da corretora. RF/Reserva/Previdência têm IR retido na fonte,
      // então credita o LÍQUIDO; Renda Variável credita o bruto (IR via DARF).
      let contaDestinoId;
      const elDest = document.getElementById('compraDestinoRecurso');
      const destSel = elDest ? elDest.value : '';
      if (destSel && typeof obterConta === 'function' && obterConta(destSel)) {
        contaDestinoId = destSel;
      } else if (typeof obterOuCriarContaPorNome === 'function') {
        contaDestinoId = (obterOuCriarContaPorNome(corretora, 'corretora') || {}).id;
      }
      const retemIR = semQtd; // RF / Reserva / Previdência: retido na fonte
      const est = resgateEstIR || { ir: 0 };
      const irRetido = retemIR ? Math.max(0, est.ir) : 0;
      const liquido = Math.max(0, valorTotal - irRetido);
      resgateIRInfo = { irRetido, liquido, bruto: valorTotal };
      transacoes.push({
        id: operacao.id.toString(),
        operacaoId: operacao.id,
        descricao: `Resgate: ${descQtd}${ticker}`,
        valor: liquido,
        categoria: 'resgate_investimento',
        banco: corretora,
        contaId: contaDestinoId,
        valorBruto: valorTotal,
        irRetido: irRetido || undefined,
        mes: dataOp.getMonth(),
        ano: dataOp.getFullYear(),
        data: dataOp.toISOString(),
        pago: true,
      });
    }

    // === COMPROMISSO RECORRENTE: previdência e reserva geram lançamentos futuros no Controle
    if (ehRecorrenteCompra && operacao.recorrente && operacao.duracaoAnos > 0 && valorTotal > 0) {
      lancamentosFuturos = gerarLancamentosFuturosCompromisso(operacao, valorTotal);
    }
  }

  // === SALDO INICIAL JÁ GUARDADO ===
  // Dinheiro que o usuário já tinha acumulado ANTES de usar a Appliquei.
  // Vira uma operação de compra (entra na carteira/patrimônio), mas NÃO
  // gera transação no Controle Financeiro e NÃO abate o caixa de nenhuma
  // instituição — porque esse valor já estava guardado, não é dinheiro novo.
  if (temSaldoInicial) {
    const agoraIso = new Date().toISOString();
    const opSaldo = {
      id: Date.now() + 1,
      ticker: ticker,
      quantidade: 1,
      preco_op: saldoInicial,
      tipo: 'compra',
      // "Já guardado" = valor que a pessoa JÁ tem hoje. Rende a partir do CADASTRO
      // na ferramenta (não da data digitada, que pode ser futura/planejada). Por
      // isso data_op e cadastradoEm ficam no momento do registro.
      data_op: agoraIso,
      cadastradoEm: agoraIso,
      categoria: categoria || null,
      subcategoria: null,
      corretora: corretora || null,
      saldoInicial: true,
      recorrente: false,
    };
    if (categoria === 'previdencia') {
      const tmSaldo = lerTaxaMensalPrevidencia();
      opSaldo.taxaMensal = tmSaldo != null ? tmSaldo : 0.008;
      // Indexador opcional também no saldo inicial (precede a taxa fixa no cálculo).
      if (rentabilidade) opSaldo.rentabilidade = rentabilidade;
    } else if (rentabilidade) {
      opSaldo.rentabilidade = rentabilidade;
    }
    historicoCompras.push(opSaldo);
    // Propositalmente sem push em `transacoes`: fora do fluxo de caixa.
  }

  localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));
  salvarTransacoes();
  document.getElementById('compraTicker').value = '';
  document.getElementById('compraQtd').value = '';
  document.getElementById('compraPreco').value = '';
  document.getElementById('compraTotalOp').innerText = 'R$ 0,00';
  document.getElementById('compraCorretora').value = '';
  document.getElementById('compraVencimento').value = '';
  document.getElementById('compraRentabilidade').value = '';
  document.getElementById('compraData').value = new Date().toISOString().slice(0, 10);
  const elCat = document.getElementById('compraCategoria');
  elCat.value = 'renda_variavel';
  delete elCat.dataset.touched;
  const elSub = document.getElementById('compraSubcategoria');
  if (elSub) {
    elSub.value = 'acoes';
    delete elSub.dataset.touched;
  }
  const inpDiaPrev = document.getElementById('prevDiaRecorrencia');
  if (inpDiaPrev) inpDiaPrev.value = '';
  const inpTaxaPrev = document.getElementById('prevTaxaMensal');
  if (inpTaxaPrev) inpTaxaPrev.value = '';
  // A unidade também volta ao padrão: deixá-la em "% ao ano" faria o próximo
  // cadastro herdar uma escolha invisível, e o prefill de 0,80 — que é mensal —
  // viraria 0,80% AO ANO sem ninguém pedir.
  const selUnPrev = document.getElementById('prevTaxaUnidade');
  if (selUnPrev) selUnPrev.value = 'mes';
  if (typeof atualizarEquivalenciaTaxaPrev === 'function') atualizarEquivalenciaTaxaPrev();
  const inpDurPrev = document.getElementById('prevDuracaoAnos');
  if (inpDurPrev) inpDurPrev.value = '';
  const chkRecPrev = document.getElementById('prevRecorrente');
  if (chkRecPrev) chkRecPrev.checked = true;
  const inpSaldoIni = document.getElementById('prevSaldoInicial');
  if (inpSaldoIni) inpSaldoIni.value = '';
  const elOrigem = document.getElementById('compraOrigemRecurso');
  if (elOrigem) elOrigem.value = '';
  const elOrigBanco = document.getElementById('compraOrigemBanco');
  if (elOrigBanco) {
    elOrigBanco.value = '';
    elOrigBanco.style.display = 'none';
  }
  const eraEdicao = edicaoId != null;
  if (typeof encerrarModoEdicaoOperacao === 'function') encerrarModoEdicaoOperacao();
  ajustarCamposPorCategoria();
  let msgBase;
  if (!temAporte && temSaldoInicial) {
    msgBase = `Saldo inicial de ${ticker} registrado no patrimônio (sem lançar no Controle).`;
  } else if (eraEdicao) {
    msgBase = `Operação de ${ticker} atualizada.`;
  } else if (origemRecursoSel === 'retroativo') {
    msgBase = `${ticker} cadastrado no seu patrimônio (retroativo) — nenhum saldo em conta foi debitado.`;
  } else if (origemRecursoSel === 'externo') {
    msgBase = `Aporte externo em ${ticker} registrado — nenhum saldo em conta foi debitado.`;
  } else {
    msgBase =
      tipoOp === 'compra'
        ? `Compra de ${ticker} registrada com sucesso!`
        : resgateIRInfo && resgateIRInfo.irRetido > 0
          ? `Resgate de ${ticker}: ${formatarMoeda(resgateIRInfo.liquido)} líquidos (IR retido ${formatarMoeda(resgateIRInfo.irRetido)}).`
          : `Resgate de ${ticker} registrado com sucesso!`;
  }
  const msgExtra =
    lancamentosFuturos > 0
      ? ` ${lancamentosFuturos} lançamento${lancamentosFuturos === 1 ? '' : 's'} ${lancamentosFuturos === 1 ? 'mensal' : 'mensais'} criado${lancamentosFuturos === 1 ? '' : 's'} no Controle.`
      : '';
  const msgSaldo =
    temAporte && temSaldoInicial
      ? ` Saldo inicial de ${formatarMoeda(saldoInicial)} somado ao patrimônio.`
      : '';
  mostrarToast(msgBase + msgExtra + msgSaldo, tipoOp === 'venda' ? 'aviso' : 'sucesso');
  atualizarCarteiraAtivos();
  atualizarDatalistDescricoes();
  inicializarDatalistCorretoras();
  renderizarOperacoes();
  fecharDrawerOperacao();
}

// --- LISTA DE OPERAÇÕES (sub-aba) — TIMELINE ---
function renderizarOperacoes() {
  const container = document.getElementById('timelineContainer');
  const msgVazia = document.getElementById('operacoesVaziaMsg');
  const summaryEl = document.getElementById('opsSummary');
  if (!container) return;

  const filtroTicker = (
    document.getElementById('filtroOperacoesTicker')?.value || ''
  ).toUpperCase();

  const ops = [...historicoCompras]
    .filter((op) => !filtroTicker || (op.ticker || '').includes(filtroTicker))
    .filter((op) => {
      if (filtroOpsTimeline === 'todos') return true;
      return (op.tipo || 'compra') === filtroOpsTimeline;
    })
    .sort((a, b) => new Date(b.data_op || 0) - new Date(a.data_op || 0));

  if (ops.length === 0) {
    container.innerHTML = '';
    msgVazia.style.display = 'block';
    if (summaryEl) summaryEl.style.display = 'none';
    return;
  }
  msgVazia.style.display = 'none';

  // Summary stats
  const totalCompras = ops.filter((o) => (o.tipo || 'compra') === 'compra').length;
  const totalVendas = ops.filter((o) => o.tipo === 'venda').length;
  const valorCompras = ops
    .filter((o) => (o.tipo || 'compra') === 'compra')
    .reduce((s, o) => s + (o.quantidade || 1) * (o.preco_op || o.preco_pago || 0), 0);
  const valorVendas = ops
    .filter((o) => o.tipo === 'venda')
    .reduce((s, o) => s + (o.quantidade || 1) * (o.preco_op || o.preco_pago || 0), 0);
  if (summaryEl) {
    summaryEl.style.display = 'flex';
    summaryEl.innerHTML = `
            <span><i class="ph-bold ph-trend-up" style="color:var(--cor-primaria);"></i> ${totalCompras} compra${totalCompras !== 1 ? 's' : ''} · <strong class="valor-mascarado">${formatarMoeda(valorCompras)}</strong></span>
            ${totalVendas > 0 ? `<span><i class="ph-bold ph-trend-down" style="color:var(--cor-erro);"></i> ${totalVendas} venda${totalVendas !== 1 ? 's' : ''} · <strong class="valor-mascarado">${formatarMoeda(valorVendas)}</strong></span>` : ''}
            <span style="margin-left:auto;color:var(--cor-texto-mutado);">${ops.length} operaç${ops.length !== 1 ? 'ões' : 'ão'}</span>`;
  }

  // Group by date label
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(ontem.getDate() - 1);
  const hojeStr = hoje.toISOString().slice(0, 10);
  const ontemStr = ontem.toISOString().slice(0, 10);

  let html = '';
  let lastGroup = '';

  ops.forEach((op) => {
    const tipo = op.tipo || 'compra';
    const dataStr = (op.data_op || '').slice(0, 10);
    const dataObj = dataStr ? new Date(dataStr + 'T12:00:00') : null;

    // Date group header
    let groupLabel = '';
    if (dataStr === hojeStr) groupLabel = 'Hoje';
    else if (dataStr === ontemStr) groupLabel = 'Ontem';
    else if (dataObj)
      groupLabel = dataObj.toLocaleDateString('pt-BR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    else groupLabel = 'Sem data';

    if (groupLabel !== lastGroup) {
      html += `<div class="timeline-date-header">${groupLabel}</div>`;
      lastGroup = groupLabel;
    }

    const ativoMercado = mockAtivosMercado.find((a) => a.ticker === op.ticker);
    const nomeAtivo = ativoMercado ? ativoMercado.nome : '';
    const total = (op.quantidade || 1) * (op.preco_op || op.preco_pago || 0);
    const semQtd =
      op.categoria === 'renda_fixa' ||
      op.categoria === 'reserva_emergencia' ||
      op.categoria === 'previdencia';
    const qtdLabel = semQtd ? '' : `${formatarQtd(op.quantidade)} un`;
    const precoLabel = formatarMoeda(op.preco_op || op.preco_pago || 0);
    const catLabel = ROTULOS_CATEGORIA[op.categoria] || '';
    const corretoraLabel = op.corretora ? `· ${op.corretora}` : '';
    const tipoIcon = tipo === 'venda' ? 'ph-bold ph-trend-down' : 'ph-bold ph-trend-up';
    const tipoWord = tipo === 'venda' ? 'Venda' : 'Compra';
    // Deixa visível na timeline o que NÃO passou pelo caixa — sem isso a pessoa
    // procura no extrato um débito que, por definição, não existe.
    const selo =
      op.origemRecurso === 'retroativo' || (op.saldoInicial && !op.contaOrigemId)
        ? '<span class="tl-selo retroativo" title="Posição que já existia antes do app — não debitou conta">Retroativo</span>'
        : op.origemRecurso === 'externo'
          ? '<span class="tl-selo externo" title="Dinheiro de fora do app — não debitou conta">Aporte externo</span>'
          : '';

    html += `<div class="timeline-item">
            <div class="timeline-accent ${tipo}"></div>
            <div class="timeline-icon ${tipo}"><i class="${tipoIcon}"></i></div>
            <div class="timeline-body">
                <div class="timeline-line1">
                    <span class="tl-tipo">${tipoWord}</span>
                    <span class="tl-ticker">${op.ticker}</span>
                    ${nomeAtivo ? `<span class="tl-nome">${nomeAtivo}</span>` : ''}
                    ${selo}
                </div>
                <div class="timeline-line2">
                    ${qtdLabel ? `<span>${qtdLabel} × ${precoLabel}</span>` : `<span>${precoLabel}</span>`}
                    ${catLabel ? `<span>${catLabel}</span>` : ''}
                    ${corretoraLabel ? `<span>${corretoraLabel}</span>` : ''}
                </div>
            </div>
            <div class="timeline-total">
                <span class="valor-mascarado">${formatarMoeda(total)}</span>
            </div>
            <div class="timeline-actions">
                <button class="rich-overflow" onclick="editarOperacao('${op.id}')" title="Editar"><i class="ph ph-pencil-simple"></i></button>
                <button class="rich-overflow" onclick="excluirOperacao('${op.id}')" title="Excluir" style="color:var(--cor-erro);"><i class="ph ph-trash"></i></button>
            </div>
        </div>`;
  });

  container.innerHTML = html;
}

function toggleRichExpand(ticker) {
  const el = document.getElementById('expand_' + ticker);
  if (!el) return;
  el.classList.toggle('aberto');
}

// Abre o drawer com os dados da operação para edição. NÃO apaga nada aqui: a
// versão antiga só é substituída quando o usuário confirma (ver
// registrarOperacaoAtivo). Antes a operação era removida ao ABRIR — fechar o
// drawer sem confirmar apagava a compra de vez, e a perna de caixa ficava para
// trás mantendo o saldo debitado.
function editarOperacao(id) {
  const op = acharOperacao(id);
  if (!op) return mostrarToast('Operação não encontrada.', 'erro');

  operacaoEmEdicaoId = op.id;
  // `semFoco`: o foco automático no ticker dispara o blur que preenchia o preço
  // com a cotação do dia, apagando o preço realmente pago.
  abrirDrawerOperacao({ semFoco: true });
  alternarTipoOperacao(op.tipo || 'compra', true);

  const titulo = document.getElementById('tituloPainelOp');
  if (titulo) titulo.innerText = 'Editar operação';
  const aviso = document.getElementById('avisoEdicaoOperacao');
  if (aviso) aviso.style.display = 'block';

  document.getElementById('compraTicker').value = op.ticker || '';
  const elCat = document.getElementById('compraCategoria');
  if (op.categoria) {
    elCat.value = op.categoria;
    elCat.dataset.touched = '1';
  }
  const elSub = document.getElementById('compraSubcategoria');
  if (elSub && op.subcategoria) {
    elSub.value = op.subcategoria;
    elSub.dataset.touched = '1';
  }
  setValorQtdInput(document.getElementById('compraQtd'), op.quantidade || '');
  setValorBRLInput(document.getElementById('compraPreco'), op.preco_op || op.preco_pago || 0);
  document.getElementById('compraData').value =
    (op.data_op || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  document.getElementById('compraCorretora').value = op.corretora || '';
  document.getElementById('compraVencimento').value = op.vencimento || '';
  document.getElementById('compraRentabilidade').value = op.rentabilidade || '';

  // Previdência / Reserva
  const chkRec = document.getElementById('prevRecorrente');
  const inpDiaRec = document.getElementById('prevDiaRecorrencia');
  const inpTaxaMensal = document.getElementById('prevTaxaMensal');
  const inpDuracao = document.getElementById('prevDuracaoAnos');
  if (chkRec) chkRec.checked = op.recorrente !== false;
  if (inpDiaRec) inpDiaRec.value = op.diaRecorrencia || '';
  if (inpTaxaMensal) {
    // O dado é gravado em taxa MENSAL; a edição repõe o campo nessa unidade e
    // deixa a equivalência anual à vista — é assim que quem cadastrou 8% ao
    // mês por engano descobre, ao reabrir, que a posição rende 151% ao ano.
    inpTaxaMensal.value =
      op.taxaMensal != null ? (op.taxaMensal * 100).toFixed(2).replace('.', ',') : '';
    const selUn = document.getElementById('prevTaxaUnidade');
    if (selUn) selUn.value = 'mes';
    if (typeof atualizarEquivalenciaTaxaPrev === 'function') atualizarEquivalenciaTaxaPrev();
  }
  if (inpDuracao) inpDuracao.value = op.duracaoAnos || '';
  if (typeof sincronizarRotuloDiaRecorrencia === 'function') sincronizarRotuloDiaRecorrencia();

  // Origem do recurso. A conta precisa voltar selecionada: sem isso o Confirmar
  // batia em "escolha a conta de onde o dinheiro sai" e a edição não salvava.
  // Repovoa antes de selecionar porque a lista depende da data da operação.
  if (typeof popularOrigemRecurso === 'function') popularOrigemRecurso();
  const elOrigem = document.getElementById('compraOrigemRecurso');
  if (elOrigem) {
    const origemGravada = op.origemRecurso;
    if (origemGravada === 'retroativo' || (op.saldoInicial && !op.contaOrigemId))
      elOrigem.value = ORIGEM_RETROATIVA;
    else if (origemGravada === 'externo') elOrigem.value = ORIGEM_EXTERNA;
    else if (op.contaOrigemId) {
      // A conta da compra original pode ter ficado sem saldo depois dela e sair
      // da lista — reinsere para que a edição não perca a origem.
      if (!Array.from(elOrigem.options).some((o) => o.value === op.contaOrigemId)) {
        const c = typeof obterConta === 'function' ? obterConta(op.contaOrigemId) : null;
        if (c) {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.text = c.nome;
          elOrigem.appendChild(opt);
        }
      }
      elOrigem.value = op.contaOrigemId;
    } else elOrigem.value = '';
  }
  // Conta de destino do resgate (só aparece em venda).
  if (op.tipo === 'venda') {
    if (typeof popularDestinoRecurso === 'function') popularDestinoRecurso();
    const txResgate = transacoes.find(
      (t) => String(t.operacaoId) === String(op.id) && t.categoria === 'resgate_investimento'
    );
    const elDest = document.getElementById('compraDestinoRecurso');
    if (elDest && txResgate && txResgate.contaId) elDest.value = txResgate.contaId;
  }

  // Saldo inicial legado ("já guardado"): edita pelo campo próprio, exceto
  // quando a origem retroativa já assumiu o valor no campo principal.
  const inpSaldoIniEdit = document.getElementById('prevSaldoInicial');
  if (inpSaldoIniEdit) inpSaldoIniEdit.value = '';

  ajustarCamposPorCategoria();
  calcularTotalCompra();
  atualizarProjecaoForm();

  mostrarToast('Edite os campos e clique em Confirmar para salvar.', 'info');
}

function excluirOperacao(id) {
  const op = acharOperacao(id);
  if (!op) return mostrarToast('Operação não encontrada.', 'erro');
  id = op.id;

  const modal = document.getElementById('modalConfirmacao');
  document.getElementById('modalTitulo').innerHTML =
    `<i class="ph-fill ph-trash" style="color: var(--cor-erro);"></i> Excluir operação`;
  document.getElementById('modalMensagem').innerHTML =
    `Tem certeza que deseja excluir a operação:<br><strong>${(op.tipo || 'compra').toUpperCase()}</strong> de <strong>${op.quantidade}x ${op.ticker}</strong> em ${op.data_op ? new Date(op.data_op).toLocaleDateString('pt-BR') : '—'}?<br><br><span style="color: var(--cor-erro); font-weight: 600;">Esta ação não pode ser desfeita.</span>`;
  document.getElementById('modalAcoes').innerHTML =
    `<button class="btn-acao" style="background-color: var(--cor-erro);" onclick="confirmarExclusaoOperacao('${id}')"><i class="ph ph-trash"></i> Sim, excluir</button>`;
  modal.style.display = 'flex';
}

function confirmarExclusaoOperacao(id) {
  const op = acharOperacao(id);
  if (op) id = op.id;
  // Cascade: ao excluir o template recorrente de previdência, remove os aportes gerados também
  const idsParaRemover = new Set([id]);
  let cascade = 0;
  if (op && op.categoria === 'previdencia' && op.recorrente && !op.gerado) {
    historicoCompras.forEach((o) => {
      if (String(o.operacaoOrigem) === String(id)) {
        idsParaRemover.add(o.id);
        cascade++;
      }
    });
  }
  // Cascade extra: remove lançamentos futuros do compromisso (previdência ou reserva)
  // — preserva os meses já pagos/passados conforme regra do produto.
  let lancFuturosRemovidos = 0;
  if (
    op &&
    (op.categoria === 'previdencia' || op.categoria === 'reserva_emergencia') &&
    op.recorrente &&
    !op.gerado
  ) {
    const antes = transacoes.length;
    removerLancamentosFuturosCompromisso(id);
    lancFuturosRemovidos = antes - transacoes.length;
  }
  const chavesRemover = new Set(Array.from(idsParaRemover, (x) => String(x)));
  historicoCompras = historicoCompras.filter((o) => !chavesRemover.has(String(o.id)));
  transacoes = transacoes.filter((t) => {
    const tid = String(t.id);
    for (const remId of chavesRemover) {
      if (tid === remId) return false;
      if (tid === 'tx_origem_' + remId) return false;
      if (t.operacaoId != null && String(t.operacaoId) === remId) return false;
    }
    return true;
  });
  if (
    typeof operacaoEmEdicaoId !== 'undefined' &&
    operacaoEmEdicaoId != null &&
    chavesRemover.has(String(operacaoEmEdicaoId)) &&
    typeof fecharDrawerOperacao === 'function'
  ) {
    fecharDrawerOperacao();
  }
  localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));
  salvarTransacoes();
  fecharModal();
  atualizarCarteiraAtivos();
  renderizarOperacoes();
  if (typeof atualizarTelaControle === 'function') atualizarTelaControle();
  const msgs = ['Operação excluída.'];
  if (cascade > 0)
    msgs.push(
      `${cascade} aporte${cascade === 1 ? '' : 's'} recorrente${cascade === 1 ? '' : 's'} cancelado${cascade === 1 ? '' : 's'}.`
    );
  if (lancFuturosRemovidos > 0)
    msgs.push(
      `${lancFuturosRemovidos} lançamento${lancFuturosRemovidos === 1 ? '' : 's'} futuro${lancFuturosRemovidos === 1 ? '' : 's'} removido${lancFuturosRemovidos === 1 ? '' : 's'} do Controle (passados preservados).`
    );
  mostrarToast(msgs.join(' '), 'sucesso');
}

function obterResumoCarteira() {
  let consolidado = {};
  const agora = Date.now();
  historicoCompras.forEach((op) => {
    // Posição de AGORA: ignora APORTE com data futura (programado, ainda não
    // realizado) — ele segue visível na timeline e entra quando for confirmado.
    // O "já guardado" (saldoInicial) é exceção: é dinheiro que a pessoa já tem,
    // então conta sempre. Operação sem data_op = legado, conta normalmente.
    if (!op.saldoInicial && op.data_op) {
      const ts = new Date(op.data_op).getTime();
      if (isFinite(ts) && ts > agora) return;
    }
    if (!consolidado[op.ticker])
      consolidado[op.ticker] = {
        qtdTotal: 0,
        valorTotalInvestido: 0,
        precoMedio: 0,
        categoria: null,
        subcategoria: null,
        corretora: null,
        vencimento: null,
        rentabilidade: null,
      };
    let ativo = consolidado[op.ticker];
    let tipo = op.tipo || 'compra';
    let precoDaOp = op.preco_op || op.preco_pago;
    if (tipo === 'compra') {
      ativo.qtdTotal += op.quantidade;
      ativo.valorTotalInvestido += op.quantidade * precoDaOp;
      ativo.precoMedio = ativo.valorTotalInvestido / ativo.qtdTotal;
      // Última compra define metadados exibidos
      if (op.categoria) ativo.categoria = op.categoria;
      if (op.subcategoria) ativo.subcategoria = op.subcategoria;
      if (op.corretora) ativo.corretora = op.corretora;
      if (op.vencimento) ativo.vencimento = op.vencimento;
      if (op.rentabilidade) ativo.rentabilidade = op.rentabilidade;
    } else if (tipo === 'venda') {
      if (op.categoria === 'renda_fixa' || op.categoria === 'reserva_emergencia') {
        // Resgate por VALOR: abate o investido pelo valor resgatado e NÃO mexe na
        // quantidade — a posição some quando o valor atual chega a ~0 (no display,
        // que usa valorAtualRendaFixa). Evita o bug de "1 unidade" da RF.
        ativo.valorTotalInvestido = Math.max(
          0,
          ativo.valorTotalInvestido - (precoDaOp || 0) * (op.quantidade || 1)
        );
      } else {
        ativo.qtdTotal -= op.quantidade;
        ativo.valorTotalInvestido -= op.quantidade * ativo.precoMedio;
      }
    }
  });
  return consolidado;
}

// Mapeia tipo do mockAtivosMercado para subcategoria de RV
function tipoMercadoParaSubcategoria(tipo) {
  if (tipo === 'FII') return 'fiis';
  if (tipo === 'BDR') return 'bdrs';
  if (tipo === 'ETF') return 'etfs';
  if (tipo === 'Ação') return 'acoes';
  return null;
}

// Subcategoria efetiva (operação > inferência mock > inferência ticker > fallback acoes)
function subcategoriaEfetiva(ticker, ativoConsolidado, ativoMercado) {
  if (ativoConsolidado?.subcategoria) return ativoConsolidado.subcategoria;
  const m = ativoMercado ? tipoMercadoParaSubcategoria(ativoMercado.tipo) : null;
  if (m) return m;
  return subcategoriaInferidaDoTicker(ticker) || 'acoes';
}
