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
var chartAdv = null, chartINSS = null, chartComparativo = null;

async function buscarInflacaoBCB() {
    const lblBcb = document.getElementById('lblSimInflacaoBcb');
    try {
        const response = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json');
        const data = await response.json();
        if(data && data.length > 0) {
            const ipca = parseFloat(data[0].valor).toFixed(2);
            document.getElementById('simInflacao').value = ipca;
            if(lblBcb) { lblBcb.innerHTML = `<i class="ph-fill ph-check-circle" style="color:var(--cor-primaria);"></i> IPCA Oficial BCB (${data[0].data})`; lblBcb.style.color = 'var(--cor-primaria)'; }
            calcularSimulador();
        }
    } catch (e) {
        if(lblBcb) { lblBcb.innerHTML = `<i class="ph ph-warning"></i> Estimativa manual`; }
        calcularSimulador();
    }
}

function sincronizarInflacao(origem) { calcularSimulador(); }

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
    const aporte  = parseBRL(document.getElementById('simAporte').value) || 0;
    let taxa      = parseFloat(document.getElementById('simTaxa').value) || 0;
    const inflacaoAnual = parseFloat(document.getElementById('simInflacao').value) || 0;
    const tipoTaxa  = document.getElementById('simTipoTaxa').value;
    const tempo     = parseInt(document.getElementById('simTempo').value) || 0;
    const tipoTempo = document.getElementById('simTipoTempo').value;

    const meses = tipoTempo === 'ano' ? tempo * 12 : tempo;
    const anos  = meses / 12;
    const taxaMensal = tipoTaxa === 'ano' ? (Math.pow(1 + taxa/100, 1/12) - 1) : (taxa/100);
    const taxaInssMensal = Math.pow(1 + 3/100, 1/12) - 1;
    const inflacaoFator = Math.pow(1 + inflacaoAnual/100, anos);

    // === INVESTINDO ===
    let montante = capital, investidoTotal = capital, labelsComp = [], dataPatr = [], dataINSS = [], htmlTabela = '';
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
            labelsComp.push(`${Math.floor(i/12)}a${i%12>0?' '+i%12+'m':''}`);
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
    document.getElementById('iconInflacaoInfo').title = `Poder de compra real: considera inflação média de ${inflacaoAnual.toFixed(2)}% a.a. no período`;

    document.getElementById('outValorFinal').innerText = formatarMoeda(montante);
    document.getElementById('outValorReal').innerText = formatarMoeda(poderRealInvest);
    document.getElementById('outTotalInvestido').innerText = formatarMoeda(investidoTotal);
    document.getElementById('outLucro').innerText = formatarMoeda(jurosGerados);
    document.getElementById('outRentab').innerText = `+${rentab}%`;
    const rendaPassivaMensal = montante * 0.008;
    const rendaPassivaRealMensal = poderRealInvest * 0.008;
    document.getElementById('outRendaPassiva').innerText = formatarMoeda(rendaPassivaMensal) + '/mês';
    const iconRendaPassivaReal = document.getElementById('iconRendaPassivaReal');
    if(iconRendaPassivaReal) {
        iconRendaPassivaReal.setAttribute('data-custom-tooltip', `Você terá o poder de compra de ${formatarMoeda(rendaPassivaRealMensal)}, baseado no patrimônio corrigido`);
    }
    document.getElementById('legPizzaInvestido').innerText = `${formatarMoeda(investidoTotal)} (${(investidoTotal/montante*100).toFixed(0)}%)`;
    document.getElementById('legPizzaJuros').innerText = `${formatarMoeda(jurosGerados)} (${(jurosGerados/montante*100).toFixed(0)}%)`;
    document.getElementById('tabelaSimuladorCorpo').innerHTML = htmlTabela;

    if (chartAdv) chartAdv.destroy();
    chartAdv = new Chart(document.getElementById('graficoPizzaPatrimonio').getContext('2d'), {
        type: 'doughnut',
        data: { labels: ['Valor Investido','Juros'], datasets: [{ data: [investidoTotal, Math.max(0, jurosGerados)], backgroundColor: ['#2563eb','#047857'], borderWidth: 2, borderColor: 'var(--cor-branco)' }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false }, datalabels: { display: false } } }
    });

    // === INSS ===
    let montInss = capital, contribTotal = capital;
    for (let i = 1; i <= meses; i++) {
        montInss = montInss + montInss * taxaInssMensal + aporte;
        contribTotal += aporte;
        if (i % 12 === 0 || i === meses) dataINSS.push(+montInss.toFixed(2));
    }
    const correcao = montInss - contribTotal;
    const poderRealInss = montInss / inflacaoFator;
    const rendReal = (((poderRealInss / contribTotal) - 1) * 100).toFixed(1);

    document.getElementById('inssOutMontante').innerText = formatarMoeda(montInss);
    document.getElementById('inssOutReal').innerText = formatarMoeda(poderRealInss);
    document.getElementById('inssOutInvestido').innerText = formatarMoeda(contribTotal);
    document.getElementById('inssOutJuros').innerText = formatarMoeda(correcao);
    document.getElementById('inssRentabReal').innerText = (rendReal >= 0 ? '+' : '') + rendReal + '%';
    document.getElementById('legINSSInvestido').innerText = `${formatarMoeda(contribTotal)} (${(contribTotal/montInss*100).toFixed(0)}%)`;
    document.getElementById('legINSSJuros').innerText = `${formatarMoeda(correcao)} (${(correcao/montInss*100).toFixed(0)}%)`;

    if (chartINSS) chartINSS.destroy();
    chartINSS = new Chart(document.getElementById('graficoPizzaINSS').getContext('2d'), {
        type: 'doughnut',
        data: { labels: ['Total Contribuído','Correção'], datasets: [{ data: [contribTotal, Math.max(0, correcao)], backgroundColor: ['#64748b','#94a3b8'], borderWidth: 2, borderColor: 'var(--cor-branco)' }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false }, datalabels: { display: false } } }
    });

    // === HERO ===
    const diff = montante - montInss;
    const multiplo = montInss > 0 ? (montante / montInss).toFixed(1) : '—';
    const rendaMensal = montante * 0.008;
    document.getElementById('heroDiff').innerText = (diff >= 0 ? '+' : '') + formatarMoeda(diff);
    document.getElementById('heroSub').innerText = `Investir com consciência trará um patrimônio ${multiplo}x maior do que depender do INSS.`;
    document.getElementById('heroMultiplo').innerHTML = `Em <strong style="color:#fff;font-weight:700;">${Math.round(anos)}</strong> anos você terá uma renda passiva estimada em
            <div style="font-size:26px;font-weight:700;color:#fff;font-family:'DM Mono',monospace;letter-spacing:-0.5px;margin:6px 0 4px;line-height:1.1;"><span id="heroRendaMensal">${formatarMoeda(rendaMensal)}</span> <span style="font-size:14px;font-weight:500;opacity:.75;">/mês</span></div>
            <span style="font-size:11px;color:rgba(255,255,255,.55);">Regra de 0,8% a.m.</span>`;

    // === GRÁFICO ===
    if (chartComparativo) chartComparativo.destroy();
    chartComparativo = new Chart(document.getElementById('graficoComparativo').getContext('2d'), {
        type: 'line',
        data: { labels: labelsComp, datasets: [
            { label: 'Patrimônio', data: dataPatr, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.07)', fill: true, tension: 0.2, borderWidth: 2.5, pointRadius: 2 },
            { label: 'INSS', data: dataINSS, borderColor: '#94a3b8', borderDash: [6,4], backgroundColor: 'transparent', fill: false, tension: 0.2, borderWidth: 2, pointRadius: 1 }
        ]},
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { datalabels: { display: false }, legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatarMoeda(ctx.parsed.y)}` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 11 } } }, y: { border: { display: false }, ticks: { font: { size: 11 }, callback: v => 'R$ ' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'k' : v) } } } }
    });
}

function calcularSimuladorAvancado() { calcularSimulador(); }
function calcularSimuladorINSS() { calcularSimulador(); }

