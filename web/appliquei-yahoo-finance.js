/**
 * Appliquei — Yahoo Finance proxy + Base de Dados dos Ativos.
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script independente
 * de state da app. Multi-proxy com fallback automático para cotações
 * Yahoo (CORS workaround). Inclui base de dados estática de tickers.
 *
 * buscarCotacoesReais() é chamado pelo window.onload em app.js — global
 * via classic-script function declaration.
 */

// --- BASE DE DADOS DOS ATIVOS ---
let mockAtivosMercado = [
    { ticker: 'PETR4', nome: 'Petrobras PN', tipo: 'Ação', preco_atual: 38.50 }, { ticker: 'PETR3', nome: 'Petrobras ON', tipo: 'Ação', preco_atual: 39.10 }, { ticker: 'VALE3', nome: 'Vale ON', tipo: 'Ação', preco_atual: 62.10 }, { ticker: 'ITUB4', nome: 'Itaú Unibanco PN', tipo: 'Ação', preco_atual: 33.40 }, { ticker: 'BBDC4', nome: 'Bradesco PN', tipo: 'Ação', preco_atual: 14.20 }, { ticker: 'BBAS3', nome: 'Banco do Brasil ON', tipo: 'Ação', preco_atual: 55.80 }, { ticker: 'WEGE3', nome: 'WEG ON', tipo: 'Ação', preco_atual: 38.90 }, { ticker: 'EGIE3', nome: 'Engie Brasil ON', tipo: 'Ação', preco_atual: 41.20 }, { ticker: 'TAEE11', nome: 'Taesa Unit', tipo: 'Ação', preco_atual: 35.60 }, { ticker: 'ABEV3', nome: 'Ambev ON', tipo: 'Ação', preco_atual: 12.50 }, { ticker: 'B3SA3', nome: 'B3 ON', tipo: 'Ação', preco_atual: 11.80 }, { ticker: 'JBSS3', nome: 'JBS ON', tipo: 'Ação', preco_atual: 22.40 }, { ticker: 'SUZB3', nome: 'Suzano ON', tipo: 'Ação', preco_atual: 52.30 }, { ticker: 'RENT3', nome: 'Localiza ON', tipo: 'Ação', preco_atual: 51.20 }, { ticker: 'RADL3', nome: 'RaiaDrogasil ON', tipo: 'Ação', preco_atual: 26.70 },
    { ticker: 'MXRF11', nome: 'Maxi Renda', tipo: 'FII', preco_atual: 10.35 }, { ticker: 'BTLG11', nome: 'BTLG Logística', tipo: 'FII', preco_atual: 104.20 }, { ticker: 'HGLG11', nome: 'CSHG Logística', tipo: 'FII', preco_atual: 162.80 }, { ticker: 'KNRI11', nome: 'Kinea Renda', tipo: 'FII', preco_atual: 158.90 }, { ticker: 'CPTS11', nome: 'Capitania Securities', tipo: 'FII', preco_atual: 8.50 }, { ticker: 'VGHF11', nome: 'Valora Hedge', tipo: 'FII', preco_atual: 9.20 }, { ticker: 'XPLG11', nome: 'XP Log', tipo: 'FII', preco_atual: 108.50 }, { ticker: 'VISC11', nome: 'Vinci Fundo', tipo: 'FII', preco_atual: 11.80 }, { ticker: 'IRDM11', nome: 'Iridium', tipo: 'FII', preco_atual: 78.40 }, { ticker: 'ALZR11', nome: 'Alianza Trust', tipo: 'FII', preco_atual: 114.60 },
    { ticker: 'BOVA11', nome: 'iShares Ibovespa', tipo: 'ETF', preco_atual: 125.40 }, { ticker: 'IVVB11', nome: 'iShares S&P 500', tipo: 'ETF', preco_atual: 295.10 }, { ticker: 'SMAL11', nome: 'iShares Small Cap', tipo: 'ETF', preco_atual: 105.20 }, { ticker: 'HASH11', nome: 'Hashdex Crypto', tipo: 'ETF', preco_atual: 45.30 }, { ticker: 'AAPL34', nome: 'Apple', tipo: 'BDR', preco_atual: 42.10 }, { ticker: 'MSFT34', nome: 'Microsoft', tipo: 'BDR', preco_atual: 58.20 }, { ticker: 'AMZO34', nome: 'Amazon', tipo: 'BDR', preco_atual: 33.50 },
    { ticker: 'TESOURO_IPCA_2035', nome: 'Tesouro IPCA+ 2035', tipo: 'Renda Fixa', preco_atual: 2150.00 }, { ticker: 'TESOURO_IPCA_2045', nome: 'Tesouro IPCA+ 2045', tipo: 'Renda Fixa', preco_atual: 1250.00 }, { ticker: 'TESOURO_SELIC_2027', nome: 'Tesouro Selic 2027', tipo: 'Renda Fixa', preco_atual: 14850.00 }, { ticker: 'TESOURO_SELIC_2029', nome: 'Tesouro Selic 2029', tipo: 'Renda Fixa', preco_atual: 14720.00 }, { ticker: 'TESOURO_PREFIXADO_2027', nome: 'Tesouro Prefixado 2027', tipo: 'Renda Fixa', preco_atual: 780.00 }, { ticker: 'TESOURO_PREFIXADO_2031', nome: 'Tesouro Prefixado 2031', tipo: 'Renda Fixa', preco_atual: 490.00 },
    { ticker: 'BTC', nome: 'Bitcoin', tipo: 'Cripto', preco_atual: 540000.00 }, { ticker: 'ETH', nome: 'Ethereum', tipo: 'Cripto', preco_atual: 18500.00 }, { ticker: 'SOL', nome: 'Solana', tipo: 'Cripto', preco_atual: 950.00 }, { ticker: 'ADA', nome: 'Cardano', tipo: 'Cripto', preco_atual: 3.20 }, { ticker: 'BNB', nome: 'BNB', tipo: 'Cripto', preco_atual: 3450.00 }
];

// ============================================================
// === YAHOO FINANCE — MULTI-PROXY COM FALLBACK AUTOMÁTICO ===
// ============================================================

// Utilitário para timeout no fetch
async function fetchTimeout(url, ms) {
    const controller = new AbortController();
    const promise = fetch(url, { signal: controller.signal });
    const timeout = setTimeout(() => controller.abort(), ms);
    return promise.finally(() => clearTimeout(timeout));
}

// Lista de proxies CORS gratuitos em ordem de preferência.
// Todos retornam o JSON do Yahoo diretamente (sem wrapper).
const PROXIES_CORS = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

// Tenta buscar a URL alvo passando por cada proxy em sequência.
// Retorna o JSON parsed assim que um proxy funcionar, ou null se todos falharem.
async function fetchComFallback(urlAlvo, timeoutMs = 10000) {
    for (const construirProxy of PROXIES_CORS) {
        try {
            const urlProxy = construirProxy(urlAlvo);
            const res = await fetchTimeout(urlProxy, timeoutMs);
            if (!res.ok) {
                console.warn(`Proxy retornou status ${res.status} para ${urlAlvo}. Tentando próximo...`);
                continue;
            }
            const json = await res.json();
            return json; // sucesso — retorna direto sem wrapper
        } catch (err) {
            console.warn(`Proxy falhou (${err.message}). Tentando próximo...`);
            continue;
        }
    }
    return null; // todos os proxies falharam
}

// ── Busca de ativos via Yahoo Finance (v8) com fallback de proxies ──
async function buscarLoteYahoo(tickers) {
    const promessas = tickers.map(async (ticker) => {
        try {
            // Rota v8 do Yahoo (usada para gráficos, muito menos restrita)
            const urlYahoo = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SA?interval=2m&range=1d`;

            const json = await fetchComFallback(urlYahoo);
            if (!json) return null;

            const meta = json?.chart?.result?.[0]?.meta;

            if (meta && meta.regularMarketPrice) {
                return {
                    symbol: ticker,
                    regularMarketPrice: meta.regularMarketPrice
                };
            }
            return null;
        } catch (err) {
            console.warn(`Aviso: Não foi possível buscar o ativo ${ticker}.`, err);
            return null;
        }
    });

    // Dispara todos os pedidos ao mesmo tempo e espera os resultados
    const resultados = await Promise.all(promessas);

    // Remove os que falharam (null) e devolve só os que tiveram sucesso
    return resultados.filter(r => r !== null);
}

// ── Atualização na inicialização ──
async function buscarCotacoesReais() {
    try {
        // Pegamos todos os ativos do teu mock (Ações, FIIs, ETFs, BDRs), exceto Renda Fixa
        const tickersYahoo = mockAtivosMercado
            .filter(a => a.tipo !== 'Renda Fixa')
            .map(a => a.ticker);

        // Dá um feedback visual na tabela que está a carregar
        const badgeRealTime = document.getElementById('badgeRealTime');
        if(badgeRealTime) {
            badgeRealTime.style.background = '#e0f2fe';
            badgeRealTime.style.color = '#0369a1';
            badgeRealTime.style.borderColor = '#bae6fd';
            badgeRealTime.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> Consultando Yahoo...';
            badgeRealTime.style.display = 'inline-flex';
        }

        // Busca as cotações
        const resultados = await buscarLoteYahoo(tickersYahoo);
        
        if (resultados.length > 0) {
            // Atualiza a base de dados local com os preços fresquinhos
            resultados.forEach(dado => {
                let ativo = mockAtivosMercado.find(a => a.ticker === dado.symbol);
                if(ativo && dado.regularMarketPrice) {
                    ativo.preco_atual = dado.regularMarketPrice;
                }
            });

            // Recarrega o menu de seleção e a tabela
            inicializarDatalistAtivos();
            if (document.getElementById('patrimonio').classList.contains('ativa')) {
                atualizarCarteiraAtivos();
            }

            // Mensagem de sucesso
            if(badgeRealTime) {
                badgeRealTime.style.background = '#dcfce7'; 
                badgeRealTime.style.color = '#166534';
                badgeRealTime.style.borderColor = '#bbf7d0';
                badgeRealTime.innerHTML = '<i class="ph-fill ph-check-circle"></i> Yahoo atualizado';
                setTimeout(() => { badgeRealTime.style.display = 'none'; }, 4000);
            }
        } else {
            throw new Error("Nenhum dado retornou da API.");
        }

    } catch(erroGeral) {
        console.error("Erro ao atualizar cotações:", erroGeral);
        document.getElementById('badgePrecosEstimados').style.display = 'inline-flex';
        const badgeRealTime = document.getElementById('badgeRealTime');
        if(badgeRealTime) {
            badgeRealTime.style.background = '#fef3c7'; 
            badgeRealTime.style.color = '#92400e';
            badgeRealTime.style.borderColor = '#fde68a';
            badgeRealTime.innerHTML = '<i class="ph-fill ph-warning"></i> Preços estimados';
        }
    }
}


function inicializarDatalistAtivos() {
    const datalist = document.getElementById('listaAtivosMercado'); datalist.innerHTML = "";
    mockAtivosMercado.forEach(ativo => {
        const option = document.createElement('option'); option.value = ativo.ticker; option.text = `${ativo.nome} (${ativo.tipo}) - ${formatarMoeda(ativo.preco_atual)}`; datalist.appendChild(option);
    });
}

