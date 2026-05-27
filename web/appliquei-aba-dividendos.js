/**
 * Appliquei — ABA Dividendos (sub-aba de Meus Investimentos).
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script, carregado
 * DEPOIS de app.js porque depende de state global (historicoCompras,
 * carteira) e helpers (formatarMoeda em app.js, formatarQtd em utils).
 *
 * Cache em memória para evitar chamadas repetidas BRAPI/YAHOO. Estados
 * top-level (cacheDividendos, cacheDividendosTTLms) viram globais — sem
 * impacto pelo prefixo único.
 */


// ============================================================
// === ABA DIVIDENDOS — BRAPI + YAHOO COM FALLBACK            ===
// ============================================================
// Cache em memória para evitar repetir chamadas no mesmo carregamento.
var cacheDividendos = {}; // { ticker: { fetchedAt, pagamentos: [{data, valor}] } }
var cacheDividendosTTLms = 30 * 60 * 1000; // 30 minutos

// Pagamentos já agregados por (ticker, mês) — alimentado por carregarDividendos.
// Cada item: { ticker, ano, mes, qtdMes, somaValorCota, total, eventos, tsMaisRecente }
var pagamentosMensaisAgregados = [];
// Filtro de ticker da tabela "Pagamentos recentes" (ativado ao clicar em "Por ativo")
var filtroPagamentosTicker = '';
// Filtro global para dividendos (gráficos e cards) - usado quando clica no ativo na carteira
var dividendosFiltroAtivo = '';

var MES_LABEL_CURTO = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

function filtrarDividendosPorAtivo(ticker) {
    dividendosFiltroAtivo = ticker || '';
    carregarDividendos();
}

function alternarFiltroPagamentosTicker(ticker) {
    filtroPagamentosTicker = (filtroPagamentosTicker === ticker) ? '' : (ticker || '');
    // Atualiza também o filtro principal para recalcular cards e gráficos
    dividendosFiltroAtivo = filtroPagamentosTicker;
    carregarDividendos();
    // Atualiza o chip de filtro ativo
    const chip = document.getElementById('chipFiltroPagamentos');
    const lbl = document.getElementById('filtroPagamentosLabel');
    if(chip && lbl) {
        if(filtroPagamentosTicker) {
            lbl.innerText = filtroPagamentosTicker;
            chip.style.display = 'inline-flex';
        } else {
            chip.style.display = 'none';
        }
    }
}

function renderizarTabelaPagamentos() {
    const tbody = document.getElementById('tabelaPagamentosCorpo');
    const msgVazia = document.getElementById('pagamentosVaziaMsg');
    if(!tbody) return;
    const linhas = filtroPagamentosTicker
        ? pagamentosMensaisAgregados.filter(l => l.ticker === filtroPagamentosTicker)
        : pagamentosMensaisAgregados;
    if(linhas.length === 0) {
        tbody.innerHTML = '';
        if(msgVazia) {
            msgVazia.style.display = 'block';
            const p = msgVazia.querySelector('p');
            if(p) p.innerText = filtroPagamentosTicker
                ? `Sem pagamentos registrados para ${filtroPagamentosTicker}.`
                : 'Nenhum pagamento encontrado no histórico.';
        }
        return;
    }
    if(msgVazia) msgVazia.style.display = 'none';
    tbody.innerHTML = linhas.slice(0, 100).map(l => {
        const labelMes = `${MES_LABEL_CURTO[l.mes]}/${l.ano}`;
        const sufixo = l.eventos > 1 ? ` <span style="font-size:10px;color:var(--cor-texto-mutado);font-weight:400;">(${l.eventos})</span>` : '';
        return `<tr>
            <td style="font-family:'DM Mono', monospace;">${labelMes}${sufixo}</td>
            <td style="font-weight: 600;">${l.ticker}</td>
            <td style="text-align: right; font-family:'DM Mono', monospace;">${formatarQtd(l.qtdMes)}</td>
            <td style="text-align: right; font-family:'DM Mono', monospace;">${formatarMoeda(l.somaValorCota)}</td>
            <td style="text-align: right; font-weight: 600; color: var(--cor-primaria); font-family:'DM Mono', monospace;">${formatarMoeda(l.total)}</td>
        </tr>`;
    }).join('');
}

function tickerEhFII(ticker) { return /11$/.test(ticker || ''); }

function tickerElegivelDividendos(ticker, ativoMercado) {
    if(!ticker) return false;
    // Renda Fixa não paga dividendos (juros são tratados separadamente)
    if(ativoMercado && ativoMercado.tipo === 'Renda Fixa') return false;
    if(/^TESOURO_/.test(ticker)) return false;
    return true;
}

async function buscarDividendosBrapi(ticker) {
    try {
        const url = `https://brapi.dev/api/quote/${ticker}?modules=dividendsHistory&range=1y&interval=1mo`;
        const res = await fetchTimeout(url, 10000);
        if(!res.ok) return null;
        const json = await res.json();
        const result = json?.results?.[0];
        // Só dividendos em dinheiro (rate em R$/ação). stockDividends.factor é
        // multiplicador de bonificação em ações, não valor monetário.
        const cashDiv = result?.dividendsHistory?.cashDividends || [];
        const todos = cashDiv.map(d => ({
            data: d.paymentDate || d.lastDatePrior || d.approvedOn,
            valor: parseFloat(d.rate || 0)
        })).filter(d => d.data && d.valor > 0);
        return todos;
    } catch(err) {
        console.warn(`BRAPI falhou para ${ticker}:`, err.message);
        return null;
    }
}

async function buscarDividendosYahoo(ticker) {
    try {
        const inicio = Math.floor((Date.now() - 365*24*60*60*1000) / 1000);
        const fim = Math.floor(Date.now() / 1000);
        const urlYahoo = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SA?period1=${inicio}&period2=${fim}&interval=1mo&events=div`;
        const json = await fetchComFallback(urlYahoo);
        if(!json) return null;
        const eventos = json?.chart?.result?.[0]?.events?.dividends || {};
        // Formata a data no fuso da B3 (São Paulo) — toISOString() jogava
        // pagamentos do início do dia BRT (ex: 01/04 00:00 BRT = 31/03 21:00 UTC)
        // para o mês anterior, sumindo do bucket correto.
        const fmtSP = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric', month: '2-digit', day: '2-digit'
        });
        const lista = Object.values(eventos).map(d => ({
            data: fmtSP.format(new Date(d.date * 1000)),
            valor: d.amount
        })).filter(d => d.valor > 0);
        return lista;
    } catch(err) {
        console.warn(`Yahoo dividendos falhou para ${ticker}:`, err.message);
        return null;
    }
}

async function obterDividendosDoAtivo(ticker, forcar = false) {
    const agora = Date.now();
    if(!forcar && cacheDividendos[ticker] && (agora - cacheDividendos[ticker].fetchedAt) < cacheDividendosTTLms) {
        return cacheDividendos[ticker].pagamentos;
    }
    // Tenta BRAPI primeiro (mais consistente para BR), Yahoo como fallback
    let pagamentos = await buscarDividendosBrapi(ticker);
    if(!pagamentos || pagamentos.length === 0) {
        pagamentos = await buscarDividendosYahoo(ticker);
    }
    pagamentos = pagamentos || [];
    cacheDividendos[ticker] = { fetchedAt: agora, pagamentos };
    return pagamentos;
}

function inferirFrequencia(pagamentos) {
    if(!pagamentos || pagamentos.length < 2) return pagamentos?.length === 1 ? 'Único' : '—';
    const datasOrd = pagamentos.map(p => new Date(p.data).getTime()).sort((a,b) => a - b);
    const intervalos = [];
    for(let i = 1; i < datasOrd.length; i++) intervalos.push(datasOrd[i] - datasOrd[i-1]);
    const mediaDias = (intervalos.reduce((a,b)=>a+b,0) / intervalos.length) / (24*60*60*1000);
    if(mediaDias <= 45) return 'Mensal';
    if(mediaDias <= 100) return 'Trimestral';
    if(mediaDias <= 200) return 'Semestral';
    return 'Anual';
}

// Quantos ativos o usuário tinha numa data específica.
// dataIso pode ser 'YYYY-MM-DD' ou ISO completo. Compara com data_op das operações.
function qtdNaData(ticker, dataIso) {
    const limite = new Date(dataIso).getTime();
    let qtd = 0;
    historicoCompras.forEach(op => {
        if(op.ticker !== ticker) return;
        if(!op.data_op) return;
        if(new Date(op.data_op).getTime() > limite) return;
        if(op.tipo === 'venda') qtd -= op.quantidade;
        else qtd += op.quantidade;
    });
    return qtd;
}

// Data da primeira compra de um ticker (ISO 'YYYY-MM-DD'); null se nunca comprou.
function dataPrimeiraCompra(ticker) {
    const compras = historicoCompras.filter(op => op.ticker === ticker && op.tipo !== 'venda' && op.data_op);
    if(!compras.length) return null;
    return compras.reduce((min, op) => op.data_op < min ? op.data_op : min, compras[0].data_op).slice(0,10);
}

async function carregarDividendos(forcar = false) {
    const tbodyAtivos = document.getElementById('tabelaDividendosCorpo');
    const tbodyPagamentos = document.getElementById('tabelaPagamentosCorpo');
    const msgVaziaAtivos = document.getElementById('dividendosVaziaMsg');
    const msgVaziaPag = document.getElementById('pagamentosVaziaMsg');
    const banner = document.getElementById('bannerDividendosAviso');
    const cardTotal = document.getElementById('dividendosTotal');
    const card12m = document.getElementById('dividendos12m');
    const cardYOC = document.getElementById('dividendosYOC');
    const cardMedia = document.getElementById('dividendosMedia');
    const incluirEncerradas = document.getElementById('chkIncluirEncerradas')?.checked || false;
    if(!tbodyAtivos) return;

    tbodyAtivos.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--cor-texto-secundario);"><i class="ph ph-circle-notch ph-spin" style="font-size:20px;"></i> Carregando proventos...</td></tr>`;
    tbodyPagamentos.innerHTML = "";
    banner.style.display = 'none';

    const carteira = obterResumoCarteira();
    // Lista de tickers candidatos: todos que aparecem no histórico (mesmo se posição zerada),
    // filtrando por elegibilidade (não Renda Fixa) e pela opção do usuário.
    const tickersHistorico = [...new Set(historicoCompras.map(op => op.ticker))];
    const tickers = tickersHistorico.filter(t => {
        const ativoMercado = mockAtivosMercado.find(a => a.ticker === t);
        if(!tickerElegivelDividendos(t, ativoMercado)) return false;
        const qtdAtual = carteira[t]?.qtdTotal || 0;
        if(!incluirEncerradas && qtdAtual <= 0) return false;
        return true;
    });

    if(tickers.length === 0) {
        tbodyAtivos.innerHTML = "";
        msgVaziaAtivos.style.display = 'block';
        msgVaziaPag.style.display = 'block';
        cardTotal.innerText = "R$ 0,00"; card12m.innerText = "R$ 0,00"; cardYOC.innerText = "0,00%"; cardMedia.innerText = "R$ 0,00";
        pagamentosMensaisAgregados = [];
        filtroPagamentosTicker = '';
        const chip = document.getElementById('chipFiltroPagamentos');
        if(chip) chip.style.display = 'none';
        return;
    }
    msgVaziaAtivos.style.display = 'none';
    msgVaziaPag.style.display = 'none';

    // Busca em paralelo
    const resultados = await Promise.all(tickers.map(async t => {
        const pagamentos = await obterDividendosDoAtivo(t, forcar);
        return { ticker: t, pagamentos };
    }));

    const houveFalha = resultados.some(r => r.pagamentos.length === 0);
    if(houveFalha) banner.style.display = 'flex';

    const agora = Date.now();
    const limite12m = agora - 365*24*60*60*1000;
    let totalGeral = 0;        // Visão A: tudo desde a 1ª compra
    let total12m = 0;          // Visão B: últimos 12m
    let totalInvestidoYOC = 0; // Total investido líquido das posições contabilizadas (para YOC)
    const linhasAtivos = [];
    const todosPagamentos = [];

    resultados.forEach(({ ticker, pagamentos }) => {
        const ativo = carteira[ticker] || { qtdTotal: 0, valorTotalInvestido: 0 };
        const ativoMercado = mockAtivosMercado.find(a => a.ticker === ticker);
        const nomeAtivo = ativoMercado ? ativoMercado.nome : "Ativo";
        const primeiraCompra = dataPrimeiraCompra(ticker);
        if(!primeiraCompra) return;
        const limitePrimeiraCompraMs = new Date(primeiraCompra).getTime();

        let recebidoTotal = 0;
        let recebido12m = 0;

        // Para cada pagamento, conta apenas as cotas que o usuário possuía na data.
        pagamentos.forEach(p => {
            if(!p.data) return;
            const dataMs = new Date(p.data).getTime();
            if(dataMs < limitePrimeiraCompraMs) return; // antes da 1ª compra → não recebeu
            const qtd = qtdNaData(ticker, p.data);
            if(qtd <= 0) return;
            const totalPag = qtd * p.valor;
            recebidoTotal += totalPag;
            if(dataMs >= limite12m) recebido12m += totalPag;
            todosPagamentos.push({ data: p.data, ticker, qtd, valorCota: p.valor, total: totalPag });
        });

        if(recebidoTotal === 0 && pagamentos.length === 0) return; // sem dados nem provento

        totalGeral += recebidoTotal;
        total12m += recebido12m;
        totalInvestidoYOC += Math.max(ativo.valorTotalInvestido, 0);

        linhasAtivos.push({
            ticker, nomeAtivo,
            qtdAtual: ativo.qtdTotal,
            encerrada: ativo.qtdTotal <= 0,
            investido: ativo.valorTotalInvestido,
            recebidoTotal, recebido12m
        });
    });

    // Ordena por recebido total desc
    linhasAtivos.sort((a,b) => b.recebidoTotal - a.recebidoTotal);

    if(linhasAtivos.length === 0) {
        tbodyAtivos.innerHTML = "";
        msgVaziaAtivos.style.display = 'block';
    } else {
        tbodyAtivos.innerHTML = linhasAtivos.map(l => {
            const yocAtivo = l.investido > 0 ? (l.recebidoTotal / l.investido * 100) : 0;
            const tagEncerrada = l.encerrada ? `<span style="display:inline-block; padding:1px 6px; border-radius:99px; font-size:10px; font-weight:600; background: var(--cor-bg-erro); color: var(--cor-txt-erro); border:1px solid var(--cor-borda-erro); margin-left:4px;">encerrada</span>` : '';
            const selecionado = filtroPagamentosTicker === l.ticker;
            const bg = selecionado ? 'var(--cor-bg-primaria)' : '';
            return `<tr data-ticker="${l.ticker}" onclick="alternarFiltroPagamentosTicker('${l.ticker}')" style="cursor:pointer; background:${bg};" title="Clique para filtrar pagamentos por ${l.ticker}">
                <td style="font-weight: 600;">${l.ticker}${tagEncerrada} <span style="display:block; font-weight: 400; font-size: 11px; color: var(--cor-texto-secundario);">${l.nomeAtivo}</span></td>
                <td style="text-align: right; font-family:'DM Mono', monospace;">${formatarQtd(l.qtdAtual)}</td>
                <td style="text-align: right; font-weight: 600; color: var(--cor-primaria); font-family:'DM Mono', monospace;">${formatarMoeda(l.recebidoTotal)}</td>
                <td style="text-align: right; font-family:'DM Mono', monospace;">${formatarMoeda(l.recebido12m)}</td>
                <td style="text-align: right; font-family:'DM Mono', monospace;">${yocAtivo.toFixed(2)}%</td>
            </tr>`;
        }).join('');
    }

    // Filtra por ativo se houver um selecionado (via clicar no ativo na carteira)
    const todosPagamentosFiltrados = dividendosFiltroAtivo 
        ? todosPagamentos.filter(p => p.ticker === dividendosFiltroAtivo)
        : todosPagamentos;
    const linhasAtivosFiltradas = dividendosFiltroAtivo
        ? linhasAtivos.filter(l => l.ticker === dividendosFiltroAtivo)
        : linhasAtivos;

    // Recalcula totais com o filtro aplicado
    let totalGeralFiltrado = 0;
    let total12mFiltrado = 0;
    let totalInvestidoYOCFiltrado = 0;
    if(dividendosFiltroAtivo) {
        linhasAtivosFiltradas.forEach(l => {
            totalGeralFiltrado += l.recebidoTotal;
            total12mFiltrado += l.recebido12m;
            totalInvestidoYOCFiltrado += Math.max(l.investido, 0);
        });
    }

    // Agrega pagamentos por (ticker, ano-mês). JCP mensal + dividendos extras
    // do mesmo mês viram uma única linha — somando o total e o R$/cota.
    const agregadoMap = new Map();
    todosPagamentosFiltrados.forEach(p => {
        if(!p.data) return;
        const d = new Date(p.data + (p.data.length === 10 ? 'T12:00:00' : ''));
        const chave = `${p.ticker}|${d.getFullYear()}-${d.getMonth()}`;
        if(!agregadoMap.has(chave)) {
            agregadoMap.set(chave, {
                ticker: p.ticker, ano: d.getFullYear(), mes: d.getMonth(),
                qtdMes: p.qtd, tsMaisRecente: d.getTime(),
                somaValorCota: 0, total: 0, eventos: 0
            });
        }
        const acc = agregadoMap.get(chave);
        if(d.getTime() > acc.tsMaisRecente) {
            acc.tsMaisRecente = d.getTime();
            acc.qtdMes = p.qtd;
        }
        acc.somaValorCota += p.valorCota;
        acc.total += p.total;
        acc.eventos += 1;
    });
    pagamentosMensaisAgregados = [...agregadoMap.values()].sort((a,b) => b.tsMaisRecente - a.tsMaisRecente);

    // Limpa filtro caso o ticker filtrado tenha sumido (encerrada removida etc.)
    if(filtroPagamentosTicker && !pagamentosMensaisAgregados.some(p => p.ticker === filtroPagamentosTicker)) {
        filtroPagamentosTicker = '';
        const chip = document.getElementById('chipFiltroPagamentos');
        if(chip) chip.style.display = 'none';
    }
    renderizarTabelaPagamentos();

    // Usa valores filtrados ou globais
    const displayTotalGeral = dividendosFiltroAtivo ? totalGeralFiltrado : totalGeral;
    const displayTotal12m = dividendosFiltroAtivo ? total12mFiltrado : total12m;
    const displayTotalInvestidoYOC = dividendosFiltroAtivo ? totalInvestidoYOCFiltrado : totalInvestidoYOC;

    cardTotal.innerText = formatarMoeda(displayTotalGeral);
    card12m.innerText = formatarMoeda(displayTotal12m);
    cardYOC.innerText = displayTotalInvestidoYOC > 0 ? `${(displayTotalGeral / displayTotalInvestidoYOC * 100).toFixed(2)}%` : '0,00%';
    // Média mensal: divide pelos meses efetivos de carteira (1ª compra → hoje), capado a 12.
    // Antes dividia sempre por 12, subdimensionando a média de quem investe há menos de um ano.
    const linhasParaMedia = dividendosFiltroAtivo ? linhasAtivosFiltradas : linhasAtivos;
    const primeirasMs = linhasParaMedia
        .map(l => dataPrimeiraCompra(l.ticker))
        .filter(Boolean)
        .map(d => new Date(d + 'T12:00:00').getTime());
    let mesesParaMedia = 12;
    if(primeirasMs.length) {
        const dPrim = new Date(Math.min(...primeirasMs));
        const hojeMed = new Date();
        const decorridos = (hojeMed.getFullYear() - dPrim.getFullYear()) * 12
            + (hojeMed.getMonth() - dPrim.getMonth()) + 1;
        mesesParaMedia = Math.min(12, Math.max(1, decorridos));
    }
    cardMedia.innerText = formatarMoeda(displayTotal12m / mesesParaMedia);

    // Atualiza gráfico de evolução e KPI "próximo evento" agora que temos cacheDividendos preenchido
    renderizarGraficoEvolucao();
    atualizarProximoEvento(carteira);
    // O chip "Dividendos" no KPI usa pagamentosMensaisAgregados — refresha agora.
    atualizarChipDividendosPeriodo();
    // New: render bar chart and ranking
    renderizarDividendosMensal(todosPagamentosFiltrados);
    renderizarRankingDividendos(linhasAtivosFiltradas);
}

var chartDivMensal = null;
function renderizarDividendosMensal(todosPagamentos) {
    const canvas = document.getElementById('graficoDividendosMensal');
    const msgVazio = document.getElementById('msgDivChartVazio');
    if(!canvas) return;

    // Parse YYYY-MM-DD com hora fixa (12:00) para evitar drift de timezone
    // que jogava pagamentos de abril (ex: 2026-04-01 UTC) para março em GMT-3.
    const parseDataPag = s => new Date(s && s.length === 10 ? s + 'T12:00:00' : s);

    // Janela alinhada aos 12 buckets de calendário (não 365 dias contínuos),
    // evitando que pagamentos no mês mais antigo "passem" o filtro mas caiam fora dos buckets.
    const agora = new Date();
    const inicioJanela = new Date(agora.getFullYear(), agora.getMonth() - 11, 1).getTime();
    const fimJanela = new Date(agora.getFullYear(), agora.getMonth() + 1, 1).getTime() - 1;

    const pag12m = todosPagamentos.filter(p => {
        if(!p.data) return false;
        const ms = parseDataPag(p.data).getTime();
        return ms >= inicioJanela && ms <= fimJanela;
    });

    if(pag12m.length === 0) {
        if(chartDivMensal) { chartDivMensal.destroy(); chartDivMensal = null; }
        canvas.style.display = 'none';
        if(msgVazio) msgVazio.style.display = 'block';
        return;
    }
    canvas.style.display = 'block';
    if(msgVazio) msgVazio.style.display = 'none';

    // Aggregate by month — usa o YYYY-MM literal quando disponível
    const meses = {};
    pag12m.forEach(p => {
        const chave = (typeof p.data === 'string' && p.data.length >= 7)
            ? p.data.slice(0, 7)
            : (() => { const d = parseDataPag(p.data); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })();
        if(!meses[chave]) meses[chave] = 0;
        meses[chave] += p.total;
    });

    // Last 12 months labels — reaproveita 'agora' definido acima.
    const labels = [];
    const data = [];
    for(let i = 11; i >= 0; i--) {
        const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
        const chave = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        labels.push(d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.',''));
        data.push(meses[chave] || 0);
    }

    const corPrimaria = getToken('--cor-primaria');
    if(chartDivMensal) chartDivMensal.destroy();
    chartDivMensal = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: data.map(v => v > 0 ? corPrimaria : 'transparent'),
                borderRadius: 6,
                borderSkipped: false,
                barPercentage: 0.65,
                categoryPercentage: 0.7
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                datalabels: { display: false },
                tooltip: { callbacks: { label: ctx => formatarMoeda(ctx.parsed.y) } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10, family: "'Figtree', sans-serif" } } },
                y: { border: { display: false }, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 10 }, callback: v => 'R$ ' + (v >= 1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(0)) } }
            }
        }
    });
}

function renderizarRankingDividendos(linhasAtivos) {
    const container = document.getElementById('divRanking');
    if(!container) return;
    const top = linhasAtivos.filter(l => l.recebido12m > 0).sort((a,b) => b.recebido12m - a.recebido12m).slice(0, 6);
    if(top.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--cor-texto-mutado);font-size:12px;">Sem dados de proventos nos últimos 12 meses</div>';
        return;
    }
    const medalhas = ['🥇','🥈','🥉'];
    container.innerHTML = top.map((l, i) => `
        <div class="div-rank-item">
            <span class="div-rank-pos">${medalhas[i] || (i+1)}</span>
            <div style="flex:1;min-width:0;">
                <span class="div-rank-ticker">${l.ticker}</span>
                <div style="font-size:10.5px;color:var(--cor-texto-mutado);margin-top:1px;">${l.nomeAtivo}</div>
            </div>
            <span class="div-rank-valor valor-mascarado">${formatarMoeda(l.recebido12m)}</span>
        </div>`).join('');
}

