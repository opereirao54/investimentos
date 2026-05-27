/**
 * Appliquei — Meu Patrimônio (visão consolidada).
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script, carregado
 * DEPOIS de app.js. Consome transacoes, cartoes, historicoCompras (state
 * global em app.js).
 */

// ============================================================
// === MEU PATRIMÔNIO — visão consolidada                    ===
// ============================================================
// Estado e cache do módulo
var mpEstado = { periodo: '12m', modo: 'bruto', cotacoes: {}, ultimaCotacao: null, donutChart: null, categoriaDestaque: null, instituicaoFiltro: null };

// Tabela regressiva IR para Renda Fixa/Tesouro
function mpAliquotaIRRendaFixa(diasDecorridos) {
    if(diasDecorridos <= 180) return 0.225;
    if(diasDecorridos <= 360) return 0.20;
    if(diasDecorridos <= 720) return 0.175;
    return 0.15;
}
// IR para Renda Variável por subcategoria (preço médio — estimativa)
function mpAliquotaIRRendaVariavel(subcat) {
    if(subcat === 'fiis') return 0.20;
    return 0.15; // ações, BDR, ETF, cripto na faixa simplificada
}

// Período → janela {iniMs, fimMs, anteriorIniMs, anteriorFimMs, label}
function mpJanelaPeriodo(p) {
    const agora = new Date();
    const fimMs = agora.getTime();
    let iniMs, anteriorIniMs, anteriorFimMs;
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    switch(p) {
        case 'mes': {
            const ini = new Date(agora.getFullYear(), agora.getMonth(), 1);
            iniMs = ini.getTime();
            anteriorFimMs = iniMs - 1;
            anteriorIniMs = new Date(agora.getFullYear(), agora.getMonth() - 1, 1).getTime();
            return { iniMs, fimMs, anteriorIniMs, anteriorFimMs, label: 'mês anterior' };
        }
        case '3m':
        case '6m':
        case '12m': {
            const meses = p === '3m' ? 3 : (p === '6m' ? 6 : 12);
            const ini = new Date(agora.getFullYear(), agora.getMonth() - meses, agora.getDate());
            iniMs = ini.getTime();
            const dur = fimMs - iniMs;
            anteriorFimMs = iniMs - 1;
            anteriorIniMs = iniMs - dur;
            return { iniMs, fimMs, anteriorIniMs, anteriorFimMs, label: 'período anterior' };
        }
        case 'ytd': {
            iniMs = new Date(agora.getFullYear(), 0, 1).getTime();
            anteriorFimMs = iniMs - 1;
            anteriorIniMs = new Date(agora.getFullYear() - 1, 0, 1).getTime();
            return { iniMs, fimMs, anteriorIniMs, anteriorFimMs, label: 'ano anterior' };
        }
        default: {
            iniMs = 0; anteriorFimMs = 0; anteriorIniMs = 0;
            return { iniMs, fimMs, anteriorIniMs, anteriorFimMs, label: '' };
        }
    }
}

function mpFmtBRL(v) {
    const n = Number(v) || 0;
    return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL', minimumFractionDigits:2, maximumFractionDigits:2 });
}
function mpFmtPct(v, casas=1) {
    if(!isFinite(v)) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(casas) + '%';
}

var MP_LABELS = {
    renda_fixa: 'Renda Fixa',
    renda_variavel: 'Renda Variável',
    previdencia: 'Previdência',
    reserva_emergencia: 'Reserva Emergência',
    caixa: 'Caixa / Saldo em Conta'
};
function mpCorCategoria(cat) {
    const p = (typeof paletaCarteira === 'function') ? paletaCarteira() : {};
    if(cat === 'renda_fixa') return p.renda_fixa || '#60a5fa';
    if(cat === 'renda_variavel') return p.acoes || '#10b981';
    if(cat === 'previdencia') return p.previdencia || '#7c3aed';
    if(cat === 'reserva_emergencia') return p.reserva_emergencia || '#6b7280';
    if(cat === 'caixa') return (typeof getToken === 'function' ? getToken('--cor-cartao') : '#f59e0b') || '#f59e0b';
    return '#9ca3af';
}

// Valor de mercado atual de um item consolidado (RV → cotação; RF → preço médio + juros simples;
// Previdência → calcularSaldoPrevidencia; Reserva → valor investido + juros se taxaMensal).
function mpValorAtualAtivo(ticker, c) {
    if(!c || !(c.qtdTotal > 0)) return 0;
    if(c.categoria === 'renda_variavel') {
        const cot = mpEstado.cotacoes[ticker];
        if(cot && typeof cot.price === 'number' && cot.price > 0) return c.qtdTotal * cot.price;
        // Fallback: mockAtivosMercado pode ter sido atualizado por buscarCotacoesReais
        const m = (typeof mockAtivosMercado !== 'undefined') ? mockAtivosMercado.find(a => a.ticker === ticker) : null;
        if(m && m.preco_atual) return c.qtdTotal * m.preco_atual;
        return c.valorTotalInvestido;
    }
    if(c.categoria === 'previdencia') {
        if(typeof calcularSaldoPrevidencia === 'function') {
            try { return calcularSaldoPrevidencia(ticker); } catch(_){}
        }
        return c.valorTotalInvestido;
    }
    // Renda Fixa / Reserva: aplica taxaMensal sobre cada aporte até hoje.
    // Reaproveita a lógica do componente Previdência (juros compostos por aporte).
    if(c.categoria === 'renda_fixa' || c.categoria === 'reserva_emergencia') {
        const aportes = (typeof historicoCompras !== 'undefined' ? historicoCompras : []).filter(op =>
            op.ticker === ticker && op.categoria === c.categoria && op.data_op
        );
        let saldo = 0;
        const agora = Date.now();
        aportes.forEach(op => {
            const dataAporte = new Date(op.data_op).getTime();
            if(dataAporte > agora) return;
            const taxa = (op.taxaMensal != null) ? op.taxaMensal : 0;
            const meses = Math.max(0, (agora - dataAporte) / (30.4375 * 86400000));
            const valor = (op.preco_op || op.preco_pago || 0) * (op.quantidade || 1);
            const fator = taxa > 0 ? Math.pow(1 + taxa, meses) : 1;
            if((op.tipo || 'compra') === 'venda') saldo -= valor * fator;
            else saldo += valor * fator;
        });
        return Math.max(0, saldo);
    }
    return c.valorTotalInvestido;
}

// Aplica IR sobre o LUCRO (não sobre o principal). Estimativa por preço médio.
function mpAplicarIR(c, valorAtual, valorInvestido) {
    const lucro = valorAtual - valorInvestido;
    if(lucro <= 0) return valorAtual; // Não há IR sobre prejuízo
    if(c.categoria === 'renda_fixa' || c.categoria === 'reserva_emergencia') {
        // Calcula dias decorridos médios ponderados pelos aportes
        const aportes = (typeof historicoCompras !== 'undefined' ? historicoCompras : []).filter(op =>
            op.ticker === c.__ticker && op.categoria === c.categoria && (op.tipo || 'compra') === 'compra' && op.data_op
        );
        let somaPonderada = 0, somaPesos = 0;
        const agora = Date.now();
        aportes.forEach(op => {
            const dataAporte = new Date(op.data_op).getTime();
            if(dataAporte > agora) return;
            const dias = Math.max(0, (agora - dataAporte) / 86400000);
            const peso = (op.preco_op || op.preco_pago || 0) * (op.quantidade || 1);
            somaPonderada += dias * peso;
            somaPesos += peso;
        });
        const diasMedios = somaPesos > 0 ? somaPonderada / somaPesos : 0;
        const aliquota = mpAliquotaIRRendaFixa(diasMedios);
        return valorAtual - (lucro * aliquota);
    }
    if(c.categoria === 'renda_variavel') {
        const aliq = mpAliquotaIRRendaVariavel(c.subcategoria);
        return valorAtual - (lucro * aliq);
    }
    // Previdência usa tabela regressiva também (12 anos→10%); aqui simplificamos com 15%.
    if(c.categoria === 'previdencia') return valorAtual - (lucro * 0.15);
    return valorAtual;
}

// Soma saldo total: entradas - despesas - aportes (todas as transações pagas).
// Inclui aportes de investimento pois eles abatem o caixa.
function mpCalcularSaldoTotal(refMs) {
    if(typeof transacoes === 'undefined') return 0;
    let saldo = 0;
    transacoes.forEach(t => {
        if(!t.pago) return;
        const tsTx = t.data ? new Date(t.data).getTime() : new Date(t.ano, t.mes, 1).getTime();
        if(tsTx > refMs) return;
        const valor = Number(t.valor) || 0;
        if(t.categoria === 'receita') saldo += valor;
        else saldo -= valor;
    });
    return saldo;
}

function mpCalcularDespesasJanela(iniMs, fimMs) {
    if(typeof transacoes === 'undefined') return 0;
    let total = 0;
    transacoes.forEach(t => {
        if(!t.pago) return;
        if(t.categoria === 'receita' || t.categoria === 'investimento_fixo') return;
        const tsTx = t.data ? new Date(t.data).getTime() : new Date(t.ano, t.mes, 1).getTime();
        if(tsTx < iniMs || tsTx > fimMs) return;
        total += Number(t.valor) || 0;
    });
    return total;
}

function mpCalcularSaldoPorInstituicao(refMs) {
    const mapa = {};
    if(typeof transacoes !== 'undefined') {
        transacoes.forEach(t => {
            if(!t.pago) return;
            const tsTx = t.data ? new Date(t.data).getTime() : new Date(t.ano, t.mes, 1).getTime();
            if(tsTx > refMs) return;
            const banco = (t.banco || '').trim() || 'Sem banco';
            if(!mapa[banco]) mapa[banco] = { caixa: 0, investido: 0 };
            const valor = Number(t.valor) || 0;
            if(t.categoria === 'receita') mapa[banco].caixa += valor;
            else mapa[banco].caixa -= valor;
        });
    }
    return mapa;
}

// Coleta tickers únicos de RV referenciados em historicoCompras.
function mpTickersRVUnicos() {
    if(typeof historicoCompras === 'undefined') return [];
    const s = new Set();
    historicoCompras.forEach(op => {
        if(op.categoria === 'renda_variavel' && op.ticker && /^[A-Z]{4}\d{1,2}$/.test(op.ticker)) {
            s.add(op.ticker);
        }
    });
    return Array.from(s);
}

async function mpFetchCotacoes() {
    const tickers = mpTickersRVUnicos();
    if(!tickers.length) {
        mpEstado.ultimaCotacao = null;
        mpAtualizarMetaCotacao();
        return {};
    }
    const meta = document.getElementById('mp-cotacao-meta');
    if(meta) meta.innerHTML = '<i class="ph ph-arrows-clockwise"></i>Atualizando cotações…';
    try {
        const token = (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser)
            ? await firebase.auth().currentUser.getIdToken() : null;
        if(!token) throw new Error('sem_token');
        const url = '/api/market?op=quote&tickers=' + encodeURIComponent(tickers.join(','));
        const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error || 'falha');
        mpEstado.cotacoes = data.quotes || {};
        mpEstado.ultimaCotacao = Date.now();
        mpAtualizarMetaCotacao(data);
        return mpEstado.cotacoes;
    } catch(err) {
        console.warn('[meu_patrimonio] cotações falharam:', err.message);
        if(meta) meta.innerHTML = '<i class="ph ph-warning" style="color:var(--cor-erro)"></i>Cotações indisponíveis — usando preço médio';
        return {};
    }
}

function mpAtualizarMetaCotacao(data) {
    const meta = document.getElementById('mp-cotacao-meta');
    if(!meta) return;
    if(!mpEstado.ultimaCotacao) { meta.innerHTML = '<i class="ph ph-info"></i>Sem ativos de Renda Variável'; return; }
    const t = new Date(mpEstado.ultimaCotacao);
    const hh = String(t.getHours()).padStart(2,'0'), mm = String(t.getMinutes()).padStart(2,'0');
    const cache = data && data.fromCache ? ` · ${data.fromCache} em cache` : '';
    meta.innerHTML = `<i class="ph ph-check-circle" style="color:var(--cor-primaria)"></i>Cotações atualizadas ${hh}:${mm}${cache}`;
}

// Consolida tudo numa única passagem: { porCategoria:{cat:{investido, atual, atualLiq}}, porInstituicao, totalInvestido, totalAtual, totalAtualLiq }
function mpConsolidar() {
    const resumo = (typeof obterResumoCarteira === 'function') ? obterResumoCarteira() : {};
    const acc = {
        porCategoria: {},
        porInstituicao: {},
        porTicker: [],
        totalInvestido: 0,
        totalAtual: 0,
        totalAtualLiq: 0,
    };
    Object.entries(resumo).forEach(([ticker, c]) => {
        if(!c || !(c.qtdTotal > 0)) return;
        c.__ticker = ticker;
        const cat = c.categoria || 'renda_variavel';
        const atual = mpValorAtualAtivo(ticker, c);
        const liquido = mpAplicarIR(c, atual, c.valorTotalInvestido);
        if(!acc.porCategoria[cat]) acc.porCategoria[cat] = { investido: 0, atual: 0, atualLiq: 0, ativos: 0 };
        acc.porCategoria[cat].investido += c.valorTotalInvestido;
        acc.porCategoria[cat].atual    += atual;
        acc.porCategoria[cat].atualLiq += liquido;
        acc.porCategoria[cat].ativos   += 1;
        acc.totalInvestido += c.valorTotalInvestido;
        acc.totalAtual     += atual;
        acc.totalAtualLiq  += liquido;
        const inst = (c.corretora || 'Sem corretora').trim();
        if(!acc.porInstituicao[inst]) acc.porInstituicao[inst] = { caixa: 0, investido: 0 };
        acc.porInstituicao[inst].investido += atual;
        acc.porTicker.push({ ticker, c, atual, liquido });
    });
    return acc;
}

function mpAlterarPeriodo(p) {
    mpEstado.periodo = p;
    renderMeuPatrimonio();
}
function mpAlterarModo(m) {
    mpEstado.modo = m;
    document.querySelectorAll('#meu_patrimonio .mp-toggle-btn').forEach(b => {
        b.classList.toggle('ativo', b.dataset.modo === m);
        b.setAttribute('aria-selected', b.dataset.modo === m ? 'true' : 'false');
    });
    document.getElementById('mp-kpis').classList.toggle('modo-liquido', m === 'liquido');
    renderMeuPatrimonio(true); // skipFetch — não precisa rebuscar cotação
}

function mpRenderKPIs(consolidado, janela) {
    const valorInvestido = mpEstado.modo === 'liquido' ? consolidado.totalAtualLiq : consolidado.totalAtual;
    const saldoTotal = mpCalcularSaldoTotal(janela.fimMs);
    const despesas = mpCalcularDespesasJanela(janela.iniMs, janela.fimMs);
    const saldoAnterior = mpCalcularSaldoTotal(janela.anteriorFimMs);
    const despesasAnt  = mpCalcularDespesasJanela(janela.anteriorIniMs, janela.anteriorFimMs);
    const investidoAporteTotal = consolidado.totalInvestido;

    document.getElementById('mp-kpi-saldo-valor').textContent = mpFmtBRL(saldoTotal);
    document.getElementById('mp-kpi-despesas-valor').textContent = mpFmtBRL(despesas);
    document.getElementById('mp-kpi-investido-valor').textContent = mpFmtBRL(valorInvestido);

    const deltaSaldo = saldoAnterior !== 0 ? ((saldoTotal - saldoAnterior) / Math.abs(saldoAnterior)) * 100 : 0;
    const deltaDesp  = despesasAnt   !== 0 ? ((despesas - despesasAnt) / despesasAnt) * 100 : 0;
    const rentab = investidoAporteTotal > 0 ? ((valorInvestido - investidoAporteTotal) / investidoAporteTotal) * 100 : 0;

    const aplicarDelta = (id, valor, invertido) => {
        const el = document.getElementById(id);
        if(!el) return;
        const cls = valor > 0.05 ? (invertido ? 'neg' : 'pos') : valor < -0.05 ? (invertido ? 'pos' : 'neg') : 'neu';
        const seta = valor > 0.05 ? '↑' : valor < -0.05 ? '↓' : '·';
        el.className = 'mp-kpi-delta ' + cls;
        el.innerHTML = `${seta} ${mpFmtPct(valor)} <span style="color:var(--cor-texto-mutado);font-weight:500;margin-left:3px">vs ${janela.label || 'anterior'}</span>`;
    };
    aplicarDelta('mp-kpi-saldo-delta', deltaSaldo, false);
    aplicarDelta('mp-kpi-despesas-delta', deltaDesp, true);
    // Investido: mostra rentabilidade acumulada, não delta vs período
    const elInv = document.getElementById('mp-kpi-investido-delta');
    if(elInv) {
        const cls = rentab > 0.05 ? 'pos' : rentab < -0.05 ? 'neg' : 'neu';
        const seta = rentab > 0.05 ? '↑' : rentab < -0.05 ? '↓' : '·';
        elInv.className = 'mp-kpi-delta ' + cls;
        elInv.innerHTML = `${seta} ${mpFmtPct(rentab)} <span style="color:var(--cor-texto-mutado);font-weight:500;margin-left:3px">rentab. total</span>`;
    }
}

// Mini sparkline SVG por categoria — usa série mensal sintética baseada em historicoCompras + cotação atual.
// Implementação leve: 6 pontos mostrando evolução do investido acumulado nessa categoria.
function mpSparklineSvg(serie, cor) {
    if(!serie.length) return '';
    const max = Math.max(...serie), min = Math.min(...serie);
    const range = (max - min) || 1;
    const w = 60, h = 14;
    const pts = serie.map((v, i) => {
        const x = (i / (serie.length - 1 || 1)) * w;
        const y = h - ((v - min) / range) * h;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg class="mp-barra-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${cor}" stroke-width="1.5" points="${pts}"/></svg>`;
}

function mpSerieInvestidoMensal(cat, meses=6) {
    if(typeof historicoCompras === 'undefined') return [];
    const agora = new Date();
    const serie = [];
    for(let i = meses - 1; i >= 0; i--) {
        const ref = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
        const fim = new Date(agora.getFullYear(), agora.getMonth() - i + 1, 1).getTime() - 1;
        let total = 0;
        historicoCompras.forEach(op => {
            if(op.categoria !== cat) return;
            if(!op.data_op) return;
            if(new Date(op.data_op).getTime() > fim) return;
            const v = (op.preco_op || op.preco_pago || 0) * (op.quantidade || 1);
            if((op.tipo || 'compra') === 'compra') total += v; else total -= v;
        });
        serie.push(Math.max(0, total));
    }
    return serie;
}

function mpRenderBarras(consolidado) {
    const wrap = document.getElementById('mp-barras');
    if(!wrap) return;
    // Adiciona pseudo-categoria "caixa": somatório de saldos positivos por instituição (caixa livre)
    const saldoInst = mpCalcularSaldoPorInstituicao(Date.now());
    let caixaTotal = 0;
    Object.values(saldoInst).forEach(s => { if(s.caixa > 0) caixaTotal += s.caixa; });
    const categorias = ['renda_fixa', 'renda_variavel', 'previdencia', 'reserva_emergencia', 'caixa'];
    const dados = categorias.map(cat => {
        if(cat === 'caixa') {
            return { cat, investido: caixaTotal, atual: caixaTotal, atualLiq: caixaTotal };
        }
        const c = consolidado.porCategoria[cat];
        return { cat, investido: c ? c.investido : 0, atual: c ? c.atual : 0, atualLiq: c ? c.atualLiq : 0 };
    }).filter(d => d.atual > 0 || d.cat === 'caixa');
    if(!dados.length) {
        wrap.innerHTML = '<div class="mp-empty"><i class="ph ph-chart-bar"></i>Sem investimentos cadastrados. Adicione operações em "Meus Investimentos".</div>';
        return;
    }
    const valorMax = Math.max(...dados.map(d => mpEstado.modo === 'liquido' ? d.atualLiq : d.atual));
    const totalGeral = dados.reduce((acc, d) => acc + (mpEstado.modo === 'liquido' ? d.atualLiq : d.atual), 0);
    wrap.innerHTML = dados.map(d => {
        const valor = mpEstado.modo === 'liquido' ? d.atualLiq : d.atual;
        const pctMax = valorMax > 0 ? (valor / valorMax) * 100 : 0;
        const pctTot = totalGeral > 0 ? (valor / totalGeral) * 100 : 0;
        const cor = mpCorCategoria(d.cat);
        const serie = d.cat === 'caixa' ? [] : mpSerieInvestidoMensal(d.cat);
        const dim = mpEstado.categoriaDestaque && mpEstado.categoriaDestaque !== d.cat ? 'dim' : '';
        return `
            <div class="mp-barra-item ${dim}" data-cat="${d.cat}" onclick="mpDestacar('${d.cat}')">
                <span class="mp-barra-label"><span class="mp-dot" style="background:${cor}"></span>${MP_LABELS[d.cat]}</span>
                <div class="mp-barra-track">
                    <div class="mp-barra-fill" style="width:${pctMax.toFixed(1)}%; background:${cor};">${pctTot >= 8 ? pctTot.toFixed(0)+'%' : ''}</div>
                    ${mpSparklineSvg(serie, cor)}
                </div>
                <span class="mp-barra-valor">${mpFmtBRL(valor)}<span class="mp-barra-pct">${pctTot.toFixed(1)}%</span></span>
            </div>`;
    }).join('');
}

function mpDestacar(cat) {
    mpEstado.categoriaDestaque = mpEstado.categoriaDestaque === cat ? null : cat;
    document.querySelectorAll('#mp-barras .mp-barra-item').forEach(el => {
        el.classList.toggle('dim', !!(mpEstado.categoriaDestaque && el.dataset.cat !== mpEstado.categoriaDestaque));
    });
    document.querySelectorAll('#mp-donut-legenda .mp-leg-item').forEach(el => {
        el.classList.toggle('dim', !!(mpEstado.categoriaDestaque && el.dataset.cat !== mpEstado.categoriaDestaque));
    });
}

function mpRenderInstituicoes(consolidado) {
    const wrap = document.getElementById('mp-lista-inst');
    if(!wrap) return;
    const saldos = mpCalcularSaldoPorInstituicao(Date.now());
    // Une corretoras (investido) com bancos (caixa). Heurística: nome igual ou alias comum
    // (Itaú/Itau, Mercado Pago/MP). Mantém todos os nomes únicos.
    const mapa = {};
    Object.entries(consolidado.porInstituicao).forEach(([nome, v]) => {
        if(!mapa[nome]) mapa[nome] = { caixa:0, investido:0 };
        mapa[nome].investido += v.investido;
    });
    Object.entries(saldos).forEach(([nome, v]) => {
        if(!mapa[nome]) mapa[nome] = { caixa:0, investido:0 };
        mapa[nome].caixa += v.caixa;
    });
    const arr = Object.entries(mapa)
        .map(([nome, v]) => ({ nome, ...v, total: v.caixa + v.investido }))
        .filter(x => Math.abs(x.total) > 0.01)
        .sort((a, b) => b.total - a.total);
    if(!arr.length) {
        wrap.innerHTML = '<div class="mp-empty" style="padding:18px"><i class="ph ph-bank"></i>Sem dados por instituição</div>';
        return;
    }
    const totalGeral = arr.reduce((a, x) => a + x.total, 0);
    wrap.innerHTML = arr.map(x => {
        const pct = totalGeral !== 0 ? (x.total / totalGeral) * 100 : 0;
        const badge = x.investido > 0 ? '<span class="mp-inst-badge">INV</span>' : '';
        return `
            <div class="mp-inst-item" onclick="mpFiltrarInstituicao('${x.nome.replace(/'/g,"\\'")}')">
                <div>
                    <span class="mp-inst-nome">${x.nome} ${badge}</span>
                    <span class="mp-inst-sub">Caixa ${mpFmtBRL(x.caixa)} · Inv. ${mpFmtBRL(x.investido)}</span>
                </div>
                <div style="text-align:right;">
                    <span class="mp-inst-valor">${mpFmtBRL(x.total)}</span>
                    <span class="mp-inst-sub">${pct.toFixed(1)}%</span>
                </div>
            </div>`;
    }).join('');
}

function mpFiltrarInstituicao(nome) {
    // Stub para drill-down futuro; por ora, apenas toggle visual.
    mpEstado.instituicaoFiltro = mpEstado.instituicaoFiltro === nome ? null : nome;
    document.querySelectorAll('#mp-lista-inst .mp-inst-item').forEach((el, i) => {
        el.classList.toggle('ativo', el.querySelector('.mp-inst-nome').textContent.trim().startsWith(mpEstado.instituicaoFiltro || '__none__'));
    });
}

function mpRenderDonut(consolidado) {
    const canvas = document.getElementById('mp-grafico-donut');
    const leg = document.getElementById('mp-donut-legenda');
    if(!canvas || !leg) return;
    if(typeof Chart === 'undefined') { leg.innerHTML = '<div class="mp-empty">Chart.js indisponível</div>'; return; }
    const cats = Object.keys(consolidado.porCategoria).filter(c => consolidado.porCategoria[c].atual > 0);
    if(!cats.length) {
        leg.innerHTML = '<div class="mp-empty"><i class="ph ph-chart-pie"></i>Sem dados</div>';
        if(mpEstado.donutChart) { mpEstado.donutChart.destroy(); mpEstado.donutChart = null; }
        return;
    }
    const usarLiq = mpEstado.modo === 'liquido';
    const labels = cats.map(c => MP_LABELS[c]);
    const valores = cats.map(c => usarLiq ? consolidado.porCategoria[c].atualLiq : consolidado.porCategoria[c].atual);
    const cores = cats.map(mpCorCategoria);

    if(mpEstado.donutChart) mpEstado.donutChart.destroy();
    mpEstado.donutChart = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: { labels, datasets: [{ data: valores, backgroundColor: cores, borderWidth: 2, borderColor: getToken('--cor-fundo-card') }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${mpFmtBRL(ctx.parsed)}`
                    }
                }
            },
            onClick: (evt, els) => {
                if(!els.length) { mpEstado.categoriaDestaque = null; mpDestacar(null); return; }
                const i = els[0].index;
                mpDestacar(cats[i]);
            }
        }
    });
    leg.innerHTML = cats.map((c, i) => {
        const d = consolidado.porCategoria[c];
        const valor = usarLiq ? d.atualLiq : d.atual;
        const lucro = valor - d.investido;
        const pct = d.investido > 0 ? (lucro / d.investido) * 100 : 0;
        const cls = pct > 0.05 ? 'pos' : pct < -0.05 ? 'neg' : 'neu';
        return `
            <div class="mp-leg-item" data-cat="${c}" onclick="mpDestacar('${c}')">
                <span class="mp-leg-dot" style="background:${cores[i]}"></span>
                <span class="mp-leg-nome">${MP_LABELS[c]}</span>
                <span class="mp-leg-rs">${mpFmtBRL(valor)}</span>
                <span class="mp-leg-pct ${cls}">${mpFmtPct(pct)}</span>
            </div>`;
    }).join('');
}

function mpRenderCartaoSnap() {
    const wrap = document.getElementById('mp-cartao-snap');
    const info = document.getElementById('mp-cartao-info');
    if(!wrap || !info) return;
    if(typeof cartoes === 'undefined' || !cartoes.length) { wrap.style.display = 'none'; return; }
    const ativos = cartoes.filter(c => !c.arquivado);
    if(!ativos.length) { wrap.style.display = 'none'; return; }
    // Foto: soma faturas em aberto (não pagas) para o mês corrente + limite total
    const agora = new Date(), m = agora.getMonth(), a = agora.getFullYear();
    let faturaAberta = 0, limiteTotal = 0;
    ativos.forEach(c => {
        limiteTotal += Number(c.limite) || 0;
        (typeof transacoes !== 'undefined' ? transacoes : []).forEach(t => {
            if(t.cartaoId !== c.id) return;
            if(t.categoria !== 'cartao_credito') return;
            if(t.pago) return;
            if(t.mes === m && t.ano === a) faturaAberta += Number(t.valor) || 0;
        });
    });
    wrap.style.display = '';
    info.innerHTML = `${ativos.length} cartão(ões) · Fatura atual em aberto: <strong>${mpFmtBRL(faturaAberta)}</strong> · Limite total: <strong>${mpFmtBRL(limiteTotal)}</strong>`;
}

// Função pública: orquestra render completo (ou skipFetch quando só muda modo)
async function renderMeuPatrimonio(skipFetch) {
    // Aplica tema Chart.js se ainda não aplicado
    if(typeof aplicarTemaChartJs === 'function') aplicarTemaChartJs();
    if(!skipFetch) await mpFetchCotacoes();
    const janela = mpJanelaPeriodo(mpEstado.periodo);
    const consolidado = mpConsolidar();
    mpRenderKPIs(consolidado, janela);
    mpRenderBarras(consolidado);
    mpRenderInstituicoes(consolidado);
    mpRenderDonut(consolidado);
    mpRenderCartaoSnap();
}

