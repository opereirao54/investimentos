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

  if (tipoOp === 'venda') {
    let carteiraAtual = obterResumoCarteira();
    let ativoNaCarteira = carteiraAtual[ticker];
    if (!ativoNaCarteira || ativoNaCarteira.qtdTotal < qtd)
      return mostrarToast(
        `Saldo insuficiente! Você possui apenas ${ativoNaCarteira ? ativoNaCarteira.qtdTotal : 0} unidades de ${ticker}.`,
        'erro'
      );
  }

  // Fase 3B: numa COMPRA com aporte, o dinheiro sai de uma CONTA cadastrada e
  // COM SALDO, escolhida pelo usuário (value = conta.id). O seletor só lista
  // contas com caixa > 0, e aqui revalidamos o saldo disponível: comprar acima
  // do que a conta tem deixaria o caixa negativo (dinheiro inventado no
  // sistema). Validado ANTES de qualquer push para não deixar a operação órfã.
  let bancoOrigemAporte = '';
  let contaOrigemIdSel; // conta resolvida (sempre uma cadastrada)
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
      return mostrarToast('Escolha a conta (com saldo) de onde o dinheiro sai.', 'erro');
    }
    const c = typeof obterConta === 'function' ? obterConta(origem) : null;
    if (!c) {
      return mostrarToast('Conta de origem inválida. Escolha uma conta com saldo.', 'erro');
    }
    contaOrigemIdSel = c.id;
    bancoOrigemAporte = c.nome;
    // Revalida o saldo disponível na conta escolhida (não deixa ficar negativo).
    const saldosInst =
      typeof mpCalcularSaldoPorInstituicao === 'function'
        ? mpCalcularSaldoPorInstituicao(Date.now())
        : {};
    const caixaDisp = saldosInst[c.id] ? saldosInst[c.id].caixa : 0;
    const custoAporte = qtd * preco;
    if (custoAporte > caixaDisp + 0.005) {
      if (elOrigemSel) {
        elOrigemSel.style.borderColor = 'var(--cor-erro)';
        elOrigemSel.focus();
        setTimeout(() => {
          elOrigemSel.style.borderColor = '';
        }, 2500);
      }
      return mostrarToast(
        `Saldo insuficiente em ${c.nome}: disponível ${formatarMoeda(caixaDisp)}, compra ${formatarMoeda(custoAporte)}.`,
        'erro'
      );
    }
  }

  const dataOp = dataInput ? new Date(dataInput + 'T12:00:00') : new Date();
  let valorTotal = 0;
  let lancamentosFuturos = 0;

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
    if (categoria === 'renda_fixa') {
      if (vencimento) operacao.vencimento = vencimento;
      if (rentabilidade) operacao.rentabilidade = rentabilidade;
    }
    if (categoria === 'reserva_emergencia') {
      if (rentabilidade) operacao.rentabilidade = rentabilidade;
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
        const taxaInp = parseBRL(document.getElementById('prevTaxaMensal').value);
        operacao.taxaMensal = taxaInp > 0 ? taxaInp / 100 : 0.008;
      }
    }
    historicoCompras.push(operacao);

    const descQtd = semQtd ? '' : `${formatarQtd(qtd)}x `;
    if (tipoOp === 'compra') {
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
      // Fase 5: a venda CREDITA o caixa da conta-corretora (o dinheiro do
      // resgate cai lá). O usuário pode depois transferir para outra conta.
      const contaDestinoId =
        typeof obterOuCriarContaPorNome === 'function'
          ? (obterOuCriarContaPorNome(corretora, 'corretora') || {}).id
          : undefined;
      transacoes.push({
        id: operacao.id.toString(),
        operacaoId: operacao.id,
        descricao: `Venda Resgate: ${descQtd}${ticker}`,
        valor: valorTotal,
        categoria: 'resgate_investimento',
        banco: corretora,
        contaId: contaDestinoId,
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
    const opSaldo = {
      id: Date.now() + 1,
      ticker: ticker,
      quantidade: 1,
      preco_op: saldoInicial,
      tipo: 'compra',
      data_op: dataOp.toISOString(),
      categoria: categoria || null,
      subcategoria: null,
      corretora: corretora || null,
      saldoInicial: true,
      recorrente: false,
    };
    if (categoria === 'previdencia') {
      const taxaInp = parseBRL(document.getElementById('prevTaxaMensal').value);
      opSaldo.taxaMensal = taxaInp > 0 ? taxaInp / 100 : 0.008;
    } else if (rentabilidade) {
      opSaldo.rentabilidade = rentabilidade;
    }
    historicoCompras.push(opSaldo);
    // Propositalmente sem push em `transacoes`: fora do fluxo de caixa.
  }

  localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));
  localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
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
  ajustarCamposPorCategoria();
  let msgBase;
  if (!temAporte && temSaldoInicial) {
    msgBase = `Saldo inicial de ${ticker} registrado no patrimônio (sem lançar no Controle).`;
  } else {
    msgBase =
      tipoOp === 'compra'
        ? `Compra de ${ticker} registrada com sucesso!`
        : `Venda de ${ticker} registrada com sucesso!`;
  }
  const msgExtra =
    lancamentosFuturos > 0
      ? ` ${lancamentosFuturos} lançamento${lancamentosFuturos === 1 ? '' : 's'} mensal${lancamentosFuturos === 1 ? '' : 'is'} criado${lancamentosFuturos === 1 ? '' : 's'} no Controle.`
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

    html += `<div class="timeline-item">
            <div class="timeline-accent ${tipo}"></div>
            <div class="timeline-icon ${tipo}"><i class="${tipoIcon}"></i></div>
            <div class="timeline-body">
                <div class="timeline-line1">
                    <span class="tl-tipo">${tipoWord}</span>
                    <span class="tl-ticker">${op.ticker}</span>
                    ${nomeAtivo ? `<span class="tl-nome">${nomeAtivo}</span>` : ''}
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
                <button class="rich-overflow" onclick="editarOperacao(${op.id})" title="Editar"><i class="ph ph-pencil-simple"></i></button>
                <button class="rich-overflow" onclick="excluirOperacao(${op.id})" title="Excluir" style="color:var(--cor-erro);"><i class="ph ph-trash"></i></button>
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

function editarOperacao(id) {
  const op = historicoCompras.find((o) => o.id === id);
  if (!op) return mostrarToast('Operação não encontrada.', 'erro');

  // Abre o drawer com os campos preenchidos
  abrirDrawerOperacao();
  alternarTipoOperacao(op.tipo || 'compra');
  document.getElementById('compraTicker').value = op.ticker || '';
  setValorQtdInput(document.getElementById('compraQtd'), op.quantidade || '');
  setValorBRLInput(document.getElementById('compraPreco'), op.preco_op || op.preco_pago || 0);
  document.getElementById('compraData').value =
    (op.data_op || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  document.getElementById('compraCorretora').value = op.corretora || '';
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
  document.getElementById('compraVencimento').value = op.vencimento || '';
  document.getElementById('compraRentabilidade').value = op.rentabilidade || '';
  // Previdência / Reserva
  const chkRec = document.getElementById('prevRecorrente');
  const inpDiaRec = document.getElementById('prevDiaRecorrencia');
  const inpTaxaMensal = document.getElementById('prevTaxaMensal');
  const inpDuracao = document.getElementById('prevDuracaoAnos');
  if (chkRec) chkRec.checked = op.recorrente !== false;
  if (inpDiaRec) inpDiaRec.value = op.diaRecorrencia || '';
  if (inpTaxaMensal)
    inpTaxaMensal.value =
      op.taxaMensal != null ? (op.taxaMensal * 100).toFixed(2).replace('.', ',') : '';
  if (inpDuracao) inpDuracao.value = op.duracaoAnos || '';
  // Saldo inicial: edita pelo campo próprio (sem virar aporte no Controle).
  const inpSaldoIniEdit = document.getElementById('prevSaldoInicial');
  if (inpSaldoIniEdit) {
    if (op.saldoInicial) {
      setValorBRLInput(inpSaldoIniEdit, op.preco_op || op.preco_pago || 0);
      document.getElementById('compraPreco').value = '';
    } else {
      inpSaldoIniEdit.value = '';
    }
  }
  // Antes de recriar, limpa lançamentos futuros do compromisso (serão regerados ao Confirmar)
  if ((op.categoria === 'previdencia' || op.categoria === 'reserva_emergencia') && op.recorrente) {
    removerLancamentosFuturosCompromisso(id);
  }
  ajustarCamposPorCategoria();
  calcularTotalCompra();
  atualizarProjecaoForm();

  // Remove a versão antiga; o "Confirmar" cria uma nova entrada
  historicoCompras = historicoCompras.filter((o) => o.id !== id);
  transacoes = transacoes.filter((t) => t.id !== id.toString());
  localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));
  localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
  atualizarCarteiraAtivos();
  renderizarOperacoes();

  mostrarToast('Edite os campos e clique em Confirmar.', 'info');
}

function excluirOperacao(id) {
  const op = historicoCompras.find((o) => o.id === id);
  if (!op) return mostrarToast('Operação não encontrada.', 'erro');

  const modal = document.getElementById('modalConfirmacao');
  document.getElementById('modalTitulo').innerHTML =
    `<i class="ph-fill ph-trash" style="color: var(--cor-erro);"></i> Excluir operação`;
  document.getElementById('modalMensagem').innerHTML =
    `Tem certeza que deseja excluir a operação:<br><strong>${(op.tipo || 'compra').toUpperCase()}</strong> de <strong>${op.quantidade}x ${op.ticker}</strong> em ${op.data_op ? new Date(op.data_op).toLocaleDateString('pt-BR') : '—'}?<br><br><span style="color: var(--cor-erro); font-weight: 600;">Esta ação não pode ser desfeita.</span>`;
  document.getElementById('modalAcoes').innerHTML =
    `<button class="btn-acao" style="background-color: var(--cor-erro);" onclick="confirmarExclusaoOperacao(${id})"><i class="ph ph-trash"></i> Sim, excluir</button>`;
  modal.style.display = 'flex';
}

function confirmarExclusaoOperacao(id) {
  const op = historicoCompras.find((o) => o.id === id);
  // Cascade: ao excluir o template recorrente de previdência, remove os aportes gerados também
  const idsParaRemover = new Set([id]);
  let cascade = 0;
  if (op && op.categoria === 'previdencia' && op.recorrente && !op.gerado) {
    historicoCompras.forEach((o) => {
      if (o.operacaoOrigem === id) {
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
  historicoCompras = historicoCompras.filter((o) => !idsParaRemover.has(o.id));
  transacoes = transacoes.filter((t) => {
    const tid = t.id;
    for (const remId of idsParaRemover) {
      if (tid === remId.toString() || tid === remId) return false;
    }
    return true;
  });
  localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));
  localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
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
  historicoCompras.forEach((op) => {
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
      ativo.qtdTotal -= op.quantidade;
      ativo.valorTotalInvestido -= op.quantidade * ativo.precoMedio;
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
