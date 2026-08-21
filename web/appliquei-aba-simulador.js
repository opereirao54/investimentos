/**
 * Appliquei — ABA 5: Simulador de investimentos.
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script, carregado
 * DEPOIS de app.js no HTML porque depende de formatarMoeda (em app.js)
 * e parseBRL (em utils.js).
 *
 * Funções top-level são globais (calcularSimulador, calcularSimuladorINSS,
 * calcularSimuladorAvancado, buscarInflacaoBCB) — referenciadas em
 * oninput= no HTML e por troca de aba em app.js. Sem persistência:
 * leitura -> cálculo -> render dos 3 charts.
 */

// --- ABA 5: SIMULADOR ---
var chartAdv = null,
  chartINSS = null,
  chartComparativo = null;
var chartMeta = null,
  chartMetaPizza = null;

async function buscarInflacaoBCB() {
  const lblBcb = document.getElementById('lblSimInflacaoBcb');
  try {
    const response = await fetch(
      'https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json'
    );
    const data = await response.json();
    if (data && data.length > 0) {
      const ipca = parseFloat(data[0].valor).toFixed(2);
      document.getElementById('simInflacao').value = ipca;
      const metaInf = document.getElementById('metaInflacao');
      if (metaInf) metaInf.value = ipca;
      if (lblBcb) {
        lblBcb.innerHTML = `<i class="ph-fill ph-check-circle" style="color:var(--cor-primaria);"></i> IPCA Oficial BCB (${data[0].data})`;
        lblBcb.style.color = 'var(--cor-primaria)';
      }
      calcularSimulador();
    }
  } catch (e) {
    if (lblBcb) {
      lblBcb.innerHTML = `<i class="ph ph-warning"></i> Estimativa manual`;
    }
    calcularSimulador();
  }
}

// --- Alterna entre os dois modos: "projetar" (forward) e "meta" (reverse) ---
function mudarModoSim(modo) {
  const ehProjetar = modo === 'projetar';
  document.getElementById('simModoProjetar').style.display = ehProjetar ? 'block' : 'none';
  document.getElementById('simModoMeta').style.display = ehProjetar ? 'none' : 'block';
  document.getElementById('simPillProjetar').classList.toggle('ativo', ehProjetar);
  document.getElementById('simPillMeta').classList.toggle('ativo', !ehProjetar);
  if (ehProjetar) calcularSimulador();
  else {
    atualizarCamposMeta();
    calcularMeta();
  }
}

// Mostra os campos relevantes conforme o tipo de objetivo escolhido
function atualizarCamposMeta() {
  const obj = document.getElementById('metaObjetivo').value;
  document.getElementById('metaCamposValor').style.display = obj === 'valor' ? 'grid' : 'none';
  document.getElementById('metaCamposAposentadoria').style.display =
    obj === 'aposentadoria' ? 'grid' : 'none';
}

// --- SIMULAÇÃO 2: dado um objetivo, calcula o aporte mensal necessário ---
function calcularMeta() {
  const objetivo = document.getElementById('metaObjetivo').value;
  const capital = parseBRL(document.getElementById('metaCapital').value) || 0;
  const taxa = parseFloat(document.getElementById('metaTaxa').value) || 0;
  const tipoTaxa = document.getElementById('metaTipoTaxa').value;
  const inflacaoAnual = parseFloat(document.getElementById('metaInflacao').value) || 0;
  const taxaMensal = tipoTaxa === 'ano' ? Math.pow(1 + taxa / 100, 1 / 12) - 1 : taxa / 100;

  // Define a meta de patrimônio e o prazo conforme o objetivo
  let meta = 0,
    meses = 0,
    rendaDesejada = 0;
  if (objetivo === 'aposentadoria') {
    rendaDesejada = parseBRL(document.getElementById('metaRenda').value) || 0;
    meta = rendaDesejada > 0 ? rendaDesejada / 0.008 : 0; // regra de 0,8% a.m.
    const idadeAtual = parseInt(document.getElementById('metaIdadeAtual').value) || 0;
    const idadeApos = parseInt(document.getElementById('metaIdadeAposentar').value) || 0;
    meses = Math.max(0, idadeApos - idadeAtual) * 12;
    const hint = document.getElementById('metaRendaHint');
    if (hint)
      hint.innerHTML = `Patrimônio necessário: <strong>${formatarMoeda(meta)}</strong> <span style="opacity:.8;">(regra de 0,8% a.m.)</span>`;
  } else {
    meta = parseBRL(document.getElementById('metaValor').value) || 0;
    const prazo = parseInt(document.getElementById('metaPrazo').value) || 0;
    meses = document.getElementById('metaTipoPrazo').value === 'ano' ? prazo * 12 : prazo;
  }
  const anos = meses / 12;
  const anosInt = Math.floor(anos);
  const mesesResto = meses % 12;
  const prazoTxt =
    meses <= 0
      ? '—'
      : anosInt >= 1
        ? `${anosInt} ano${anosInt > 1 ? 's' : ''}${mesesResto > 0 ? ` e ${mesesResto} ${mesesResto > 1 ? 'meses' : 'mês'}` : ''}`
        : `${meses} ${meses > 1 ? 'meses' : 'mês'}`;

  // Resolve o aporte mensal (valor futuro de uma anuidade ordinária):
  // FV = PV*(1+i)^n + PMT*((1+i)^n - 1)/i  ->  PMT = (FV - PV*(1+i)^n) / (((1+i)^n - 1)/i)
  const fator = Math.pow(1 + taxaMensal, meses);
  const fvCapital = capital * fator;
  let aporte;
  if (meses <= 0) aporte = 0;
  else if (Math.abs(taxaMensal) < 1e-9) aporte = (meta - capital) / meses;
  else aporte = (meta - fvCapital) / ((fator - 1) / taxaMensal);
  const jaAtinge = aporte <= 0 && meses > 0 && meta > 0;
  const aporteNec = Math.max(0, aporte);

  // Reconstrói a evolução mês a mês com o aporte calculado (para o gráfico)
  let montante = capital,
    totalAportado = capital,
    labels = [],
    dataMont = [],
    dataMeta = [];
  for (let i = 1; i <= meses; i++) {
    montante = montante + montante * taxaMensal + aporteNec;
    totalAportado += aporteNec;
    if (i % 12 === 0 || i === meses) {
      labels.push(`${Math.floor(i / 12)}a${i % 12 > 0 ? ' ' + (i % 12) + 'm' : ''}`);
      dataMont.push(+montante.toFixed(2));
      dataMeta.push(+meta.toFixed(2));
    }
  }
  if (meses <= 0) {
    montante = capital;
    totalAportado = capital;
  }
  const jurosTotais = Math.max(0, montante - totalAportado);
  const pctJuros = montante > 0 ? (jurosTotais / montante) * 100 : 0;
  const pctAporte = montante > 0 ? (totalAportado / montante) * 100 : 0;
  const poderReal = anos > 0 ? montante / Math.pow(1 + inflacaoAnual / 100, anos) : montante;

  // --- HERO ---
  document.getElementById('metaAporteMensal').innerText =
    formatarMoeda(aporteNec) + (aporteNec > 0 ? '/mês' : '');
  document.getElementById('metaAlvo').innerText = formatarMoeda(meta);
  document.getElementById('metaPrazoTxt').innerText = prazoTxt;
  const heroSub = document.getElementById('metaHeroSub');
  if (meses <= 0) {
    heroSub.innerText =
      'Ajuste o prazo (ou as idades) para um valor maior que zero para montar o plano.';
  } else if (jaAtinge) {
    heroSub.innerText = `Seu capital inicial já cresce sozinho até a meta — sem precisar de novos aportes.`;
  } else {
    heroSub.innerHTML = `Investindo esse valor todo mês a uma taxa de <strong style="color:#fff;">${taxa}% ${tipoTaxa === 'ano' ? 'a.a.' : 'a.m.'}</strong>, você chega lá em ${prazoTxt}.`;
  }

  // --- Banner "já atinge" ---
  const bannerOk = document.getElementById('metaBannerOk');
  bannerOk.style.display = jaAtinge ? 'block' : 'none';

  // --- Composição ---
  document.getElementById('metaOutAportado').innerText = formatarMoeda(totalAportado);
  document.getElementById('metaOutJuros').innerText = formatarMoeda(jurosTotais);
  document.getElementById('metaOutFinal').innerText = formatarMoeda(montante);
  document.getElementById('metaLegAportado').innerText =
    `${formatarMoeda(totalAportado)} (${pctAporte.toFixed(0)}%)`;
  document.getElementById('metaLegJuros').innerText =
    `${formatarMoeda(jurosTotais)} (${pctJuros.toFixed(0)}%)`;
  document.getElementById('metaReal').innerText = formatarMoeda(poderReal);

  // --- Plano passo a passo ---
  const passos = [];
  if (capital > 0)
    passos.push(`Comece com seu capital inicial de <strong>${formatarMoeda(capital)}</strong>.`);
  if (jaAtinge) {
    passos.push(
      `Sem novos aportes, seu capital cresce até <strong>${formatarMoeda(montante)}</strong> no prazo definido.`
    );
  } else if (meses > 0) {
    passos.push(
      `Invista <strong>${formatarMoeda(aporteNec)}</strong> todo mês durante <strong>${prazoTxt}</strong>.`
    );
  }
  passos.push(
    `Mantenha uma rentabilidade média de <strong>${taxa}% ${tipoTaxa === 'ano' ? 'ao ano' : 'ao mês'}</strong>.`
  );
  if (meses > 0)
    passos.push(
      `Os juros compostos somam <strong>${formatarMoeda(jurosTotais)}</strong> (${pctJuros.toFixed(0)}% do total) — o mercado trabalha por você.`
    );
  if (objetivo === 'aposentadoria' && rendaDesejada > 0) {
    passos.push(
      `Resultado: <strong>${formatarMoeda(meta)}</strong>, que rendem cerca de <strong>${formatarMoeda(rendaDesejada)}/mês</strong> de renda passiva.`
    );
  } else {
    passos.push(`Resultado: você atinge sua meta de <strong>${formatarMoeda(meta)}</strong>.`);
  }
  document.getElementById('metaPlanoPassos').innerHTML = passos
    .map(
      (p, idx) => `
        <li style="display:flex;align-items:flex-start;gap:10px;font-size:12.5px;color:var(--cor-texto-secundario);line-height:1.45;">
            <span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:var(--cor-bg-primaria);color:var(--cor-primaria);font-family:'DM Mono',monospace;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:1px solid var(--cor-borda-primaria);">${idx + 1}</span>
            <span>${p}</span>
        </li>`
    )
    .join('');

  // --- Doughnut: aportes vs. juros ---
  if (chartMetaPizza) chartMetaPizza.destroy();
  chartMetaPizza = new Chart(document.getElementById('graficoMetaPizza').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Seus aportes', 'Juros'],
      datasets: [
        {
          data: [totalAportado, jurosTotais],
          backgroundColor: ['#2563eb', '#047857'],
          borderWidth: 2,
          borderColor: 'var(--cor-branco)',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: { legend: { display: false }, datalabels: { display: false } },
    },
  });

  // --- Linha: evolução até a meta ---
  if (chartMeta) chartMeta.destroy();
  chartMeta = new Chart(document.getElementById('graficoMeta').getContext('2d'), {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Patrimônio',
          data: dataMont,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37,99,235,0.07)',
          fill: true,
          tension: 0.2,
          borderWidth: 2.5,
          pointRadius: 2,
        },
        {
          label: 'Meta',
          data: dataMeta,
          borderColor: '#047857',
          borderDash: [6, 4],
          backgroundColor: 'transparent',
          fill: false,
          tension: 0,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        datalabels: { display: false },
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatarMoeda(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: {
          border: { display: false },
          ticks: {
            font: { size: 11 },
            callback: (v) =>
              'R$ ' +
              (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v),
          },
        },
      },
    },
  });
}

function sincronizarInflacao(origem) {
  calcularSimulador();
}

function toggleTabelaSim() {
  const body = document.getElementById('tabelaSimBody');
  const btn = document.getElementById('btnToggleTabela');
  const txtSpan = document.getElementById('txtBtnTabela');
  const iconCare = document.getElementById('iconBtnTabela');
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  txtSpan.textContent = open ? 'Ocultar tabela' : 'Mostrar tabela';
  iconCare.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';

  // Mostrar/ocultar banner do ponto de inflexão quando abrir a tabela
  if (open) {
    calcularSimulador();
  }
}

function calcularSimulador() {
  const capital = parseBRL(document.getElementById('simCapital').value) || 0;
  const aporte = parseBRL(document.getElementById('simAporte').value) || 0;
  let taxa = parseFloat(document.getElementById('simTaxa').value) || 0;
  const inflacaoAnual = parseFloat(document.getElementById('simInflacao').value) || 0;
  const tipoTaxa = document.getElementById('simTipoTaxa').value;
  const tempo = parseInt(document.getElementById('simTempo').value) || 0;
  const tipoTempo = document.getElementById('simTipoTempo').value;

  const meses = tipoTempo === 'ano' ? tempo * 12 : tempo;
  const anos = meses / 12;
  const taxaMensal = tipoTaxa === 'ano' ? Math.pow(1 + taxa / 100, 1 / 12) - 1 : taxa / 100;
  const inflacaoFator = Math.pow(1 + inflacaoAnual / 100, anos);

  // === INVESTINDO ===
  let montante = capital,
    investidoTotal = capital,
    labelsComp = [],
    dataPatr = [],
    dataINSS = [],
    htmlTabela = '';

  // Lado INSS: contribuição calculada sobre a RENDA (com teto), projetada no
  // MESMO período. Nada aqui usa o aporte — era esse o erro da versão antiga.
  const selVinculo = document.getElementById('simVinculo');
  if (selVinculo && !selVinculo.options.length) {
    selVinculo.innerHTML = INSS_VINCULOS.map(
      (v) => `<option value="${v.v}">${v.label}</option>`
    ).join('');
  }
  const inss = inssProjecao({
    renda: parseBRL(document.getElementById('simRenda').value) || 0,
    vinculo: (selVinculo || {}).value || 'clt',
    sexo: document.getElementById('simSexo').value || 'mulher',
    anosJaContribuidos: parseInt(document.getElementById('simAnosContrib').value, 10) || 0,
    meses,
  });
  let mesJurosMaiorQueAporte = null;
  for (let i = 1; i <= meses; i++) {
    const jurosMes = montante * taxaMensal;
    montante = montante + jurosMes + aporte;
    investidoTotal += aporte;
    const jurosAcum = montante - investidoTotal;
    if (!mesJurosMaiorQueAporte && jurosMes > aporte) {
      mesJurosMaiorQueAporte = i;
    }
    if (i % 12 === 0 || i === meses) {
      labelsComp.push(`${Math.floor(i / 12)}a${i % 12 > 0 ? ' ' + (i % 12) + 'm' : ''}`);
      dataPatr.push(+montante.toFixed(2));
    }

    // Determinar classes e estilos para destaque visual
    let rowClass = '';
    let rowStyle = '';
    let isLinhaInflexao = false;

    if (mesJurosMaiorQueAporte && i >= mesJurosMaiorQueAporte) {
      rowClass = 'classe-destaque-juros';
    }
    if (mesJurosMaiorQueAporte && i === mesJurosMaiorQueAporte) {
      isLinhaInflexao = true;
      rowClass = 'linha-inflexao';
    }

    // Formatar valores com fonte monoespaçada
    const fmtInvestido = formatarMoeda(investidoTotal);
    const fmtJurosMes = formatarMoeda(jurosMes);
    const fmtJurosAcum = formatarMoeda(jurosAcum);
    const fmtPatrimonio = formatarMoeda(montante);

    htmlTabela += `<tr class="${rowClass}" ${rowStyle}>`;
    htmlTabela += `<td style="text-align:center;font-family:'DM Mono',monospace;font-size:12.5px;font-weight:600;">${i}</td>`;
    htmlTabela += `<td style="text-align:right;font-family:'DM Mono',monospace;font-size:12.5px;">${fmtInvestido}</td>`;
    htmlTabela += `<td style="text-align:right;font-family:'DM Mono',monospace;font-size:12.5px;font-weight:700;color:var(--cor-primaria);">${fmtJurosMes}</td>`;
    htmlTabela += `<td style="text-align:right;font-family:'DM Mono',monospace;font-size:12.5px;font-weight:700;color:var(--cor-primaria);background:linear-gradient(90deg,var(--cor-bg-primaria) 0%,transparent 100%);">${fmtJurosAcum}</td>`;
    htmlTabela += `<td style="text-align:right;font-family:'DM Mono',monospace;font-size:13px;font-weight:800;color:var(--cor-texto-principal);">${fmtPatrimonio}</td>`;
    htmlTabela += `</tr>`;

    // Adicionar linha especial de inflexão com ícone
    if (isLinhaInflexao) {
      htmlTabela += `<tr class="linha-inflexao-banner"><td colspan="5" style="padding:0;border:none;">`;
      htmlTabela += `<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:linear-gradient(90deg,rgba(16,185,129,0.08) 0%,transparent 100%);border-left:4px solid var(--cor-primaria);">`;
      htmlTabela += `<i class="ph ph-sparkle" style="color:var(--cor-primaria);font-size:16px;"></i>`;
      htmlTabela += `<span style="font-size:11.5px;font-weight:700;color:var(--cor-txt-primaria);">✦ Ponto de Inflexão: neste mês, seus juros mensais (${fmtJurosMes}) superaram seu aporte (${formatarMoeda(aporte)})!</span>`;
      htmlTabela += `</div></td></tr>`;
    }
  }
  const jurosGerados = montante - investidoTotal;
  const poderRealInvest = montante / inflacaoFator;
  const rentab = investidoTotal > 0 ? ((jurosGerados / investidoTotal) * 100).toFixed(1) : 0;

  // Atualiza banner do ponto de inflexão
  const bannerInflexao = document.getElementById('bannerPontoInflexao');
  const mesInflexaoEl = document.getElementById('mesInflexao');
  if (mesJurosMaiorQueAporte) {
    bannerInflexao.style.display = 'block';
    mesInflexaoEl.textContent = mesJurosMaiorQueAporte;
  } else {
    bannerInflexao.style.display = 'none';
  }

  // Atualiza label de inflação e tooltip
  document.getElementById('lblInflacaoMedia').innerText = inflacaoAnual.toFixed(2);
  document.getElementById('iconInflacaoInfo').title =
    `Poder de compra real: considera inflação média de ${inflacaoAnual.toFixed(2)}% a.a. no período`;

  document.getElementById('outValorFinal').innerText = formatarMoeda(montante);
  document.getElementById('outValorReal').innerText = formatarMoeda(poderRealInvest);
  document.getElementById('outTotalInvestido').innerText = formatarMoeda(investidoTotal);
  document.getElementById('outLucro').innerText = formatarMoeda(jurosGerados);
  document.getElementById('outRentab').innerText = `+${rentab}%`;
  const rendaPassivaMensal = montante * 0.008;
  const rendaPassivaRealMensal = poderRealInvest * 0.008;
  document.getElementById('outRendaPassiva').innerText = formatarMoeda(rendaPassivaMensal) + '/mês';
  const iconRendaPassivaReal = document.getElementById('iconRendaPassivaReal');
  if (iconRendaPassivaReal) {
    iconRendaPassivaReal.setAttribute(
      'data-custom-tooltip',
      `Você terá o poder de compra de ${formatarMoeda(rendaPassivaRealMensal)}, baseado no patrimônio corrigido`
    );
  }
  document.getElementById('legPizzaInvestido').innerText =
    `${formatarMoeda(investidoTotal)} (${((investidoTotal / montante) * 100).toFixed(0)}%)`;
  document.getElementById('legPizzaJuros').innerText =
    `${formatarMoeda(jurosGerados)} (${((jurosGerados / montante) * 100).toFixed(0)}%)`;
  document.getElementById('tabelaSimuladorCorpo').innerHTML = htmlTabela;

  if (chartAdv) chartAdv.destroy();
  chartAdv = new Chart(document.getElementById('graficoPizzaPatrimonio').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Valor Investido', 'Juros'],
      datasets: [
        {
          data: [investidoTotal, Math.max(0, jurosGerados)],
          backgroundColor: ['#2563eb', '#047857'],
          borderWidth: 2,
          borderColor: 'var(--cor-branco)',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: { legend: { display: false }, datalabels: { display: false } },
    },
  });

  // === INSS ===
  // A linha do INSS no gráfico é o dinheiro que SAIU do bolso — não existe
  // saldo acumulado a projetar: o INSS é repartição, não poupança.
  for (let i = 1; i <= meses; i++) {
    if (i % 12 === 0 || i === meses) dataINSS.push(+(inss.contribuicaoMensal * i).toFixed(2));
  }

  const ben = inss.beneficio;
  const beneficioReal = ben.beneficio / inflacaoFator;
  document.getElementById('inssOutBeneficio').innerText = ben.qualifica
    ? formatarMoeda(ben.beneficio) + '/mês'
    : '—';
  document.getElementById('inssOutReal').innerText = ben.qualifica
    ? formatarMoeda(beneficioReal) + '/mês'
    : '—';
  document.getElementById('inssLinhaReal').style.display = ben.qualifica ? 'flex' : 'none';
  document.getElementById('inssOutContribuicao').innerText =
    formatarMoeda(inss.contribuicaoMensal) + '/mês';
  document.getElementById('inssOutTotalPago').innerText = formatarMoeda(inss.totalPago);
  document.getElementById('inssOutTempo').innerText =
    `${inss.anosTotais} anos` +
    (inss.anosJaContribuidos > 0
      ? ` (${inss.anosJaContribuidos} já + ${Math.floor(meses / 12)})`
      : '');
  document.getElementById('inssOutCoeficiente').innerText = ben.qualifica
    ? `${(ben.coeficiente * 100).toFixed(0)}% da média`
    : '—';
  document.getElementById('inssBadgeVinculo').innerText =
    (INSS_VINCULOS.filter((v) => v.v === inss.vinculo)[0] || {}).label || 'CLT';
  document.getElementById('lblTetoInss').innerText = formatarMoeda(inss.tabela.teto);
  document.getElementById('lblTabelaInss').innerText = `Tabela ${inss.tabela.ano}.`;

  // O aviso que explica o número — ou a falta dele.
  const avisoEl = document.getElementById('inssAvisoTempo');
  let avisoInss = '';
  if (inss.renda <= 0) {
    avisoInss = `<i class="ph-fill ph-info"></i> Informe a sua <strong>renda mensal</strong> acima: é dela que sai a contribuição ao INSS, não do quanto você investe.`;
  } else if (!ben.qualifica) {
    avisoInss = `<strong><i class="ph-fill ph-warning"></i> Nesse prazo você não se aposenta.</strong> A aposentadoria por idade exige <strong>${ben.anosMinimos} anos</strong> de contribuição (e ${ben.idadeMinima} de idade). Somando o que você já contribuiu aos ${Math.floor(meses / 12)} anos simulados dá <strong>${inss.anosTotais}</strong> — faltam ${ben.anosFaltando}. Os ${formatarMoeda(inss.totalPago)} pagos no período não voltam como saldo.`;
  } else if (ben.limitadoAoMinimo) {
    avisoInss = `<i class="ph-fill ph-info"></i> A conta daria <strong>${formatarMoeda(ben.media * ben.coeficiente)}</strong>, mas nenhum benefício fica abaixo de um salário mínimo — então sobe para <strong>${formatarMoeda(inss.tabela.salarioMinimo)}</strong>.`;
  } else if (inss.rendaAcimaDoTeto > 0) {
    avisoInss = `<i class="ph-fill ph-info"></i> Você ganha <strong>${formatarMoeda(inss.rendaAcimaDoTeto)}</strong> a mais que o teto. Sobre essa parte você não contribui — e também não recebe: o benefício para em <strong>${formatarMoeda(inss.tabela.teto)}</strong>.`;
  }
  avisoEl.innerHTML = avisoInss;
  avisoEl.style.display = avisoInss ? 'block' : 'none';

  // A rosquinha vira taxa de reposição: quanto da renda de hoje o benefício
  // cobre. É a pergunta que a pessoa realmente faz.
  const reposto = Math.min(inss.renda, ben.beneficio);
  const lacuna = Math.max(0, inss.renda - reposto);
  const pctReposto = inss.renda > 0 ? (reposto / inss.renda) * 100 : 0;
  document.getElementById('legINSSReposicao').innerText =
    `${formatarMoeda(reposto)} (${pctReposto.toFixed(0)}%)`;
  document.getElementById('legINSSLacuna').innerText =
    `${formatarMoeda(lacuna)} (${(100 - pctReposto).toFixed(0)}%)`;

  if (chartINSS) chartINSS.destroy();
  chartINSS = new Chart(document.getElementById('graficoPizzaINSS').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Reposto pelo INSS', 'Lacuna'],
      datasets: [
        {
          data: [reposto, lacuna],
          backgroundColor: ['#64748b', '#e2e8f0'],
          borderWidth: 2,
          borderColor: 'var(--cor-branco)',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: { legend: { display: false }, datalabels: { display: false } },
    },
  });

  // === HERO ===
  // A comparação honesta é renda contra renda: o INSS não devolve um saldo,
  // paga um benefício mensal. Comparar patrimônio com "montante do INSS" era
  // colocar lado a lado uma coisa que existe e outra que não.
  const rendaMensal = montante * 0.008;
  const diff = rendaMensal - ben.beneficio;
  document.getElementById('heroDiff').innerText =
    (diff >= 0 ? '+' : '') + formatarMoeda(diff) + '/mês';
  if (inss.renda <= 0) {
    document.getElementById('heroSub').innerText =
      'Informe a sua renda mensal para comparar com o INSS.';
  } else if (!ben.qualifica) {
    document.getElementById('heroSub').innerText =
      `Investindo, ${formatarMoeda(rendaMensal)} por mês — e o patrimônio continua seu. Pelo INSS, nada: ${inss.anosTotais} anos de contribuição não chegam aos ${ben.anosMinimos} exigidos.`;
  } else {
    const multiplo = ben.beneficio > 0 ? (rendaMensal / ben.beneficio).toFixed(1) : '—';
    document.getElementById('heroSub').innerText =
      `Investindo, ${formatarMoeda(rendaMensal)} por mês — ${multiplo}x o benefício de ${formatarMoeda(ben.beneficio)} do INSS. E o patrimônio de ${formatarMoeda(montante)} continua seu; o benefício acaba com você.`;
  }
  document.getElementById('heroMultiplo').innerHTML =
    `Em <strong style="color:#fff;font-weight:700;">${Math.round(anos)}</strong> anos você terá uma renda passiva estimada em
            <div style="font-size:26px;font-weight:700;color:#fff;font-family:'DM Mono',monospace;letter-spacing:-0.5px;margin:6px 0 4px;line-height:1.1;"><span id="heroRendaMensal">${formatarMoeda(rendaMensal)}</span> <span style="font-size:14px;font-weight:500;opacity:.75;">/mês</span></div>
            <span style="font-size:11px;color:rgba(255,255,255,.55);">Regra de 0,8% a.m.</span>`;

  // === GRÁFICO ===
  if (chartComparativo) chartComparativo.destroy();
  chartComparativo = new Chart(document.getElementById('graficoComparativo').getContext('2d'), {
    type: 'line',
    data: {
      labels: labelsComp,
      datasets: [
        {
          label: 'Patrimônio',
          data: dataPatr,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37,99,235,0.07)',
          fill: true,
          tension: 0.2,
          borderWidth: 2.5,
          pointRadius: 2,
        },
        {
          label: 'Pago ao INSS',
          data: dataINSS,
          borderColor: '#94a3b8',
          borderDash: [6, 4],
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.2,
          borderWidth: 2,
          pointRadius: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        datalabels: { display: false },
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatarMoeda(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: {
          border: { display: false },
          ticks: {
            font: { size: 11 },
            callback: (v) =>
              'R$ ' +
              (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v),
          },
        },
      },
    },
  });
}

function calcularSimuladorAvancado() {
  calcularSimulador();
}
function calcularSimuladorINSS() {
  calcularSimulador();
}
