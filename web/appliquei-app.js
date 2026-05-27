/**
 * Appliquei — script principal da aplicação.
 *
 * Onda 3 — extraído inline (linhas 6718-15915 do antigo
 * Appliquei_v13.0.html) para um único arquivo classic. Mantém todas as
 * declarações de função no escopo global (script clássico), preservando
 * as referências em `onclick=` espalhadas pelo HTML.
 *
 * Por que classic e não module:
 *  - O HTML tem 100+ handlers `onclick="funcaoX()"` que dependem dos
 *    nomes globais. Converter para módulo exigiria expor cada função em
 *    `window.*` manualmente — 452 declarações; risco enorme. Conversão
 *    para módulo é trabalho separado e gradual (Onda 4+).
 *  - Vite copia este arquivo via copyWebDir() plugin sem transformação.
 *
 * Cache-busting: o arquivo não recebe content-hash automático (Vite só
 * hasheia módulos). Browser respeita ETag/Last-Modified do Vercel. Se
 * precisar forçar invalidação após deploy, bump no ?v=... na referência
 * em Appliquei_v13.0.html.
 */

        // --- REGISTRO DO PLUGIN DE RÓTULOS (DATALABELS) NO CHART.JS ---
        Chart.register(ChartDataLabels);

        // --- NAVEGAÇÃO GERAL ---
        function mudarAba(e, idAba, callback = null) {
            document.querySelectorAll('.section').forEach(sec => sec.classList.remove('ativa'));
            document.querySelectorAll('.menu-btn').forEach(btn => btn.classList.remove('ativo'));
            document.getElementById(idAba).classList.add('ativa');
            e.currentTarget.classList.add('ativo');

            // Marca body para que o FAB de "Novo lançamento" apareça só em #controle (mobile)
            document.body.classList.toggle('controle-ativo', idAba === 'controle');
            // Fecha o drawer "Novo lançamento" ao trocar de aba
            if (idAba !== 'controle' && typeof fecharPainelLancamento === 'function') {
                fecharPainelLancamento();
            }

            if(idAba === 'patrimonio') atualizarCarteiraAtivos();
            if(idAba === 'controle') atualizarTelaControle();
            if(idAba === 'simulador') calcularSimulador();
            if(idAba === 'carteira') carregarCarteiraCliente();
            if(idAba === 'meus_sonhos') renderizarSonhos();
            if(idAba === 'applicash') atualizarTelaApplicash();
            if(idAba === 'duvidas_sugestoes') { renderizarFaq(); renderizarHistoricoSugestoes(); }
            if(idAba === 'meu_patrimonio') renderMeuPatrimonio();
            if(idAba === 'aulas') renderizarJornada();
            if(idAba === 'relatorio_mensal') renderRelatorioMensal();
            if(callback) callback();
            if (typeof closeMobileNav === 'function') closeMobileNav();
        }

        // Sub-abas dentro de "Meus Investimentos"
        let filtroOpsTimeline = 'todos';
        function mudarSubAbaPatrimonio(qual) {
            const subs = {
                carteira: document.getElementById('subAbaCarteira'),
                operacoes: document.getElementById('subAbaOperacoes'),
                dividendos: document.getElementById('subAbaDividendos')
            };
            const btns = {
                carteira: document.getElementById('subtabBtnCarteira'),
                operacoes: document.getElementById('subtabBtnOperacoes'),
                dividendos: document.getElementById('subtabBtnDividendos')
            };
            const btnRefresh = document.getElementById('btnAtualizarDividendos');
            const filtros = document.getElementById('filtrosCategoria');
            Object.keys(subs).forEach(k => {
                subs[k].style.display = (k === qual) ? 'block' : 'none';
                btns[k].classList.toggle('ativo', k === qual);
            });
            if(filtros) filtros.style.display = (qual === 'carteira') ? 'flex' : 'none';
            const quadroCat = document.getElementById('quadroCategoriasInferior');
            if(quadroCat && qual !== 'carteira') quadroCat.style.display = 'none';
            btnRefresh.style.display = (qual === 'dividendos') ? 'inline-flex' : 'none';
            // Ao mudar para dividendos, limpa o filtro de ativo e recarrega
            if(qual === 'dividendos') {
                dividendosFiltroAtivo = '';
                carregarDividendos();
            }
            if(qual === 'operacoes') renderizarOperacoes();
            // Voltar para carteira precisa re-renderizar a "Posição por categoria",
            // que foi escondida acima ao trocar de sub-aba.
            if(qual === 'carteira' && typeof atualizarCarteiraAtivos === 'function') atualizarCarteiraAtivos();
            atualizarMiniStats(qual);
        }

        function filtrarOpsTimeline(tipo, btn) {
            filtroOpsTimeline = tipo;
            document.querySelectorAll('#opsToolbar .ops-chip').forEach(c => c.classList.remove('ativo'));
            if(btn) btn.classList.add('ativo');
            renderizarOperacoes();
        }

        function atualizarMiniStats(aba) {
            const el = document.getElementById('subtabMiniStat');
            if(!el) return;
            const carteira = obterResumoCarteira();
            const totalAtivos = Object.keys(carteira).filter(t => carteira[t].qtdTotal > 0).length;
            const totalOps = historicoCompras.length;

            if(aba === 'carteira') {
                let saldoTotal = 0;
                for(const t in carteira) {
                    if(carteira[t].qtdTotal <= 0) continue;
                    const am = mockAtivosMercado.find(a => a.ticker === t);
                    const p = am ? am.preco_atual : carteira[t].precoMedio;
                    saldoTotal += carteira[t].qtdTotal * p;
                }
                el.innerHTML = `<i class="ph ph-briefcase" style="font-size:13px;"></i> ${totalAtivos} ativo${totalAtivos !== 1 ? 's' : ''} · <span class="valor-mascarado" style="font-family:'DM Mono',monospace;">${formatarMoeda(saldoTotal)}</span>`;
            } else if(aba === 'operacoes') {
                el.innerHTML = `<i class="ph ph-list-bullets" style="font-size:13px;"></i> ${totalOps} operaç${totalOps !== 1 ? 'ões' : 'ão'}`;
            } else if(aba === 'dividendos') {
                el.innerHTML = `<i class="ph ph-coins" style="font-size:13px;"></i> Proventos 12m`;
            }
        }

        function exportarOperacoesCSV() {
            if(historicoCompras.length === 0) return mostrarToast('Nenhuma operação para exportar.', 'aviso');
            const headers = ['Data','Tipo','Ticker','Categoria','Corretora','Qtd','Preço','Total'];
            const rows = historicoCompras.map(op => {
                const total = (op.quantidade || 1) * (op.preco || 0);
                return [op.data_op || '', op.tipo || 'compra', op.ticker, op.categoria || '', op.corretora || '', op.quantidade || 1, op.preco || 0, total.toFixed(2)];
            });
            let csv = headers.join(';') + '\n' + rows.map(r => r.join(';')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `operacoes_${new Date().toISOString().slice(0,10)}.csv`; a.click();
            URL.revokeObjectURL(url);
            mostrarToast('Operações exportadas!', 'sucesso');
        }

        function toggleColunasExtras() {
            const tab = document.getElementById('tabelaCarteira');
            const lbl = document.getElementById('lblToggleColunas');
            if(!tab) return;
            const aberto = tab.classList.toggle('com-extras');
            if(lbl) lbl.innerText = aberto ? 'Menos colunas' : 'Mais colunas';
            try { localStorage.setItem('appliquei_carteira_extras', aberto ? '1' : '0'); } catch(_){}
        }

        // === DRAWER DE OPERAÇÃO ===
        function abrirDrawerOperacao() {
            const drawer = document.getElementById('drawerOperacao');
            const overlay = document.getElementById('drawerOverlay');
            if(!drawer || !overlay) return;
            // Garante estado inicial limpo do form
            const elData = document.getElementById('compraData');
            if(elData && !elData.value) elData.value = new Date().toISOString().slice(0,10);
            drawer.classList.add('aberto');
            overlay.classList.add('aberto');
            document.body.style.overflow = 'hidden';
            setTimeout(() => { document.getElementById('compraTicker')?.focus(); }, 240);
        }
        function fecharDrawerOperacao() {
            const drawer = document.getElementById('drawerOperacao');
            const overlay = document.getElementById('drawerOverlay');
            if(!drawer || !overlay) return;
            drawer.classList.remove('aberto');
            overlay.classList.remove('aberto');
            document.body.style.overflow = '';
        }

        // === DRAWER — Novo lançamento (Controle Financeiro) ===
        // Desktop: slide da direita (igual "Registrar operação")
        // Mobile: bottom-sheet (mesma classe .aberto, presentação muda via CSS)
        function abrirPainelLancamento() {
            const painel = document.getElementById('painelNovoLancamento');
            if (!painel) return;
            painel.classList.add('aberto');
            document.body.classList.add('painel-lancamento-aberto');
            setTimeout(() => {
                const descEl = document.getElementById('descTransacao');
                if (descEl) descEl.focus({ preventScroll: true });
            }, 240);
        }
        function fecharPainelLancamento() {
            const painel = document.getElementById('painelNovoLancamento');
            if (!painel) return;
            painel.classList.remove('aberto');
            document.body.classList.remove('painel-lancamento-aberto');
        }
        // Aliases legados — mantidos por segurança caso algum onclick antigo chame
        function abrirPainelLancamentoMobile() { abrirPainelLancamento(); }
        function fecharPainelLancamentoMobile() { fecharPainelLancamento(); }

        function toggleDarkMode() {
            document.body.classList.toggle('dark');
            const icon = document.getElementById('iconTheme');
            if(icon) icon.className = document.body.classList.contains('dark') ? 'ph ph-moon' : 'ph ph-sun';
            // Re-aplica tokens nos gráficos e força re-render
            if(typeof aplicarTemaChartJs === 'function') aplicarTemaChartJs();
            try {
                if(typeof renderizarGraficoEvolucao === 'function') renderizarGraficoEvolucao();
                if(typeof obterResumoCarteira === 'function' && typeof renderizarGraficoDistribuicao === 'function') {
                    renderizarGraficoDistribuicao(obterResumoCarteira());
                }
            } catch(_) {}
        }

        function aplicarEstadoValoresOcultos(oculto) {
            document.body.classList.toggle('valores-ocultos', oculto);
            document.querySelectorAll('.btn-eye').forEach(btn => {
                btn.classList.toggle('ativo', oculto);
                btn.title = oculto ? 'Mostrar valores' : 'Ocultar valores';
                const icone = btn.querySelector('i');
                if (icone) icone.className = oculto ? 'ph ph-eye-slash' : 'ph ph-eye';
            });
        }
        function toggleValoresOcultos() {
            const oculto = !document.body.classList.contains('valores-ocultos');
            aplicarEstadoValoresOcultos(oculto);
            try { localStorage.setItem('appliquei_valores_ocultos', oculto ? '1' : '0'); } catch(e) {}
        }
        (function inicializarValoresOcultos() {
            let salvo = '0';
            try { salvo = localStorage.getItem('appliquei_valores_ocultos') || '0'; } catch(e) {}
            if (salvo === '1') aplicarEstadoValoresOcultos(true);
        })();

        // === CHIPS DE TIPO DE LANÇAMENTO ===
        function selecionarChipTipo(tipo) {
            const chips = { entrada: document.getElementById('chipEntrada'), saida: document.getElementById('chipSaida'), cartao: document.getElementById('chipCartao') };
            const estilosBase = 'flex:1;padding:8px 4px;border-radius:8px;border:1.5px solid var(--cor-borda);background:var(--cor-superficie);color:var(--cor-texto-secundario);font-size:11.5px;font-weight:600;cursor:pointer;transition:.15s;font-family:\'Figtree\',sans-serif;display:flex;align-items:center;justify-content:center;gap:4px;';
            Object.values(chips).forEach(c => c.style.cssText = estilosBase);
            const sel = document.getElementById('categoriaTransacao');
            if(tipo === 'entrada') {
                chips.entrada.style.cssText = estilosBase + 'background:var(--cor-bg-primaria);color:var(--cor-txt-primaria);border-color:var(--cor-borda-primaria);';
                sel.value = 'receita';
                verificarRegraCartao();
            } else if(tipo === 'saida') {
                chips.saida.style.cssText = estilosBase + 'background:var(--cor-bg-erro);color:var(--cor-txt-erro);border-color:var(--cor-borda-erro);';
                sel.value = 'despesa_variavel';
                verificarRegraCartao();
            } else if(tipo === 'cartao') {
                chips.cartao.style.cssText = estilosBase + 'background:var(--cor-bg-amber);color:var(--cor-txt-amber);border-color:var(--cor-borda-amber);';
                sel.value = 'cartao_credito'; verificarRegraCartao();
            }
        }

        function filtrarExtrato(e, tipo) {
            document.querySelectorAll('.ext-tab').forEach(t => t.classList.remove('on'));
            e.currentTarget.classList.add('on');
            const ids = ['extratoReceitas','extratoDespesas','extratoCartao','extratoInvestimentos'];
            const map = { todos: ids, receita:['extratoReceitas'], despesa:['extratoDespesas'], cartao:['extratoCartao'], investimento:['extratoInvestimentos'] };
            const show = map[tipo] || ids;
            ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = show.includes(id) ? 'flex' : 'none'; });
        }

        function formatarMoeda(valor) { return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

        // --- GESTÃO DO MODAL DE CONFIGURAÇÕES ---
        function abrirModalConfig() {
            renderizarListaCartoesConfig();
            document.getElementById('modalConfiguracoes').style.display = 'flex';
        }
        function fecharModalConfig() { document.getElementById('modalConfiguracoes').style.display = 'none'; }
        function salvarEFecharConfig() { salvarMetasEAtualizar(); fecharModalConfig(); mostrarToast("Configurações atualizadas!", "sucesso"); }

        function salvarMetasEAtualizar() {
            localStorage.setItem('futurorico_metaVerde', parseBRL(document.getElementById('metaVerde').value));
            localStorage.setItem('futurorico_metaVermelha', parseBRL(document.getElementById('metaVermelha').value));
            atualizarTelaControle();
        }

        function carregarMetas() {
            const verde = localStorage.getItem('futurorico_metaVerde');
            const vermelha = localStorage.getItem('futurorico_metaVermelha');
            if(verde) setValorBRLInput(document.getElementById('metaVerde'), verde);
            if(vermelha) setValorBRLInput(document.getElementById('metaVermelha'), vermelha);
        }

        // --- GESTÃO DE CARTÕES ---
        function renderizarListaCartoesConfig() {
            const container = document.getElementById('listaCartoesConfig');
            if (!container) return;
            if (cartoes.length === 0) {
                container.innerHTML = '<div style="font-size:12px;color:var(--cor-texto-mutado);font-style:italic;padding:8px;">Nenhum cartão cadastrado.</div>';
                return;
            }
            const ordenados = [...cartoes].sort((a, b) => (a.arquivado === b.arquivado) ? 0 : (a.arquivado ? 1 : -1));
            container.innerHTML = ordenados.map(c => {
                const fech = c.diaFechamento ? `Fech. dia ${c.diaFechamento}` : 'Sem fechamento';
                const venc = c.diaVencimento ? `Venc. dia ${c.diaVencimento}` : 'Sem vencimento';
                const arq = c.arquivado;
                const acaoBtn = arq
                    ? `<button class="btn-secundario" style="padding:4px 8px;font-size:11px;color:var(--cor-primaria);border-color:var(--cor-primaria);" onclick="restaurarCartaoConfig('${c.id}')" title="Restaurar"><i class="ph ph-arrow-counter-clockwise"></i></button>`
                    : `<button class="btn-secundario" style="padding:4px 8px;font-size:11px;color:var(--cor-erro);border-color:var(--cor-erro);" onclick="arquivarCartaoConfig('${c.id}')" title="Arquivar (mantém histórico)"><i class="ph ph-archive"></i></button>`;
                const badge = arq ? `<span style="background:var(--cor-borda);color:var(--cor-texto-mutado);padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-left:6px;">Arquivado</span>` : '';
                return `
                    <div style="display:flex;align-items:center;gap:10px;background:var(--cor-superficie);border:1px solid var(--cor-borda);border-radius:9px;padding:10px 12px;${arq ? 'opacity:0.6;' : ''}">
                        <i class="ph ph-credit-card" style="color:var(--cor-cartao);font-size:18px;"></i>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:600;color:var(--cor-texto-principal);">${c.nome}${badge}</div>
                            <div style="font-size:11px;color:var(--cor-texto-mutado);">Limite ${formatarMoeda(c.limite || 0)} • ${fech} • ${venc}</div>
                        </div>
                        <button class="btn-secundario" style="padding:4px 8px;font-size:11px;color:var(--cor-info);border-color:var(--cor-info);" onclick="editarCartaoConfig('${c.id}')" title="Editar"><i class="ph ph-pencil-simple"></i></button>
                        ${acaoBtn}
                    </div>`;
            }).join('');
        }

        function abrirNovoCartaoConfig() {
            document.getElementById('formNovoCartaoConfig').style.display = 'block';
            document.getElementById('btnAbrirNovoCartao').style.display = 'none';
            document.getElementById('novoCartaoNome').value = '';
            document.getElementById('novoCartaoLimite').value = '';
            document.getElementById('novoCartaoDiaFech').value = '';
            document.getElementById('novoCartaoDiaVenc').value = '';
            document.getElementById('novoCartaoNome').dataset.editandoId = '';
            document.getElementById('novoCartaoNome').focus();
        }

        function cancelarNovoCartaoConfig() {
            document.getElementById('formNovoCartaoConfig').style.display = 'none';
            document.getElementById('btnAbrirNovoCartao').style.display = 'block';
        }

        function salvarNovoCartaoConfig() {
            const nome = document.getElementById('novoCartaoNome').value.trim();
            const limite = parseBRL(document.getElementById('novoCartaoLimite').value) || 0;
            const diaFech = parseInt(document.getElementById('novoCartaoDiaFech').value);
            const diaVenc = parseInt(document.getElementById('novoCartaoDiaVenc').value);
            const editandoId = document.getElementById('novoCartaoNome').dataset.editandoId;

            if (!nome) return mostrarToast("Informe o nome do cartão.", "erro");
            if (!diaFech || diaFech < 1 || diaFech > 31) return mostrarToast("Informe o dia de fechamento (1 a 31).", "erro");
            if (!diaVenc || diaVenc < 1 || diaVenc > 31) return mostrarToast("Informe o dia de vencimento (1 a 31).", "erro");

            if (editandoId) {
                const c = cartoes.find(x => x.id === editandoId);
                if (c) { c.nome = nome; c.limite = limite; c.diaFechamento = diaFech; c.diaVencimento = diaVenc; }
            } else {
                cartoes.push({ id: 'card_' + Date.now(), nome, limite, diaFechamento: diaFech, diaVencimento: diaVenc });
            }
            salvarCartoes();
            cancelarNovoCartaoConfig();
            renderizarListaCartoesConfig();
            atualizarSelectCartoesForm();
            atualizarTelaControle();
            mostrarToast(editandoId ? "Cartão atualizado." : "Cartão adicionado.", "sucesso");
        }

        function editarCartaoConfig(id) {
            const c = cartoes.find(x => x.id === id); if (!c) return;
            document.getElementById('formNovoCartaoConfig').style.display = 'block';
            document.getElementById('btnAbrirNovoCartao').style.display = 'none';
            document.getElementById('novoCartaoNome').value = c.nome;
            setValorBRLInput(document.getElementById('novoCartaoLimite'), c.limite || 0);
            document.getElementById('novoCartaoDiaFech').value = c.diaFechamento || '';
            document.getElementById('novoCartaoDiaVenc').value = c.diaVencimento || '';
            document.getElementById('novoCartaoNome').dataset.editandoId = id;
            document.getElementById('novoCartaoNome').focus();
        }

        function arquivarCartaoConfig(id) {
            const ativos = cartoesAtivos();
            if (ativos.length <= 1 && ativos[0]?.id === id) {
                return mostrarToast("Você precisa manter pelo menos um cartão ativo.", "erro");
            }
            const c = cartoes.find(x => x.id === id);
            if (!c) return;
            const usados = transacoes.some(t => t.cartaoId === id);
            const msg = usados
                ? `Arquivar "${c.nome}"? O histórico de lançamentos será preservado e continuará vinculado a este cartão. O cartão deixa de aparecer no formulário de novas despesas, mas pode ser restaurado a qualquer momento.`
                : `Arquivar "${c.nome}"?`;
            if (!confirm(msg)) return;
            c.arquivado = true;
            salvarCartoes();
            renderizarListaCartoesConfig();
            atualizarSelectCartoesForm();
            atualizarTelaControle();
            mostrarToast("Cartão arquivado. Histórico preservado.", "sucesso");
        }

        function restaurarCartaoConfig(id) {
            const c = cartoes.find(x => x.id === id);
            if (!c) return;
            c.arquivado = false;
            salvarCartoes();
            renderizarListaCartoesConfig();
            atualizarSelectCartoesForm();
            atualizarTelaControle();
            mostrarToast("Cartão restaurado.", "sucesso");
        }

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

        // --- ABA 1: MEUS INVESTIMENTOS ---
        let historicoCompras = JSON.parse(localStorage.getItem('futurorico_compras')) || [];
        let transacoes = JSON.parse(localStorage.getItem('futurorico_transacoes')) || [];
        // Backfill: compromissos mensais de sonho criados antes da feature de "conta a vencer"
        // não tinham dataVencimento. Preenche com dia 5 (default) para que apareçam no painel.
        (function backfillVencimentoSonhoCompromisso() {
            let mudou = false;
            transacoes.forEach(t => {
                if(t.categoria === 'sonho' && !t.aporteExtra && !t.pago && !t.dataVencimento && typeof t.mes === 'number' && typeof t.ano === 'number') {
                    const ultimoDia = new Date(t.ano, t.mes + 1, 0).getDate();
                    const dia = Math.min(5, ultimoDia);
                    t.dataVencimento = `${t.ano}-${String(t.mes+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
                    mudou = true;
                }
            });
            if(mudou) localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
        })();

        // --- CARTÕES DE CRÉDITO ---
        let cartoes = JSON.parse(localStorage.getItem('futurorico_cartoes')) || [];

        // Migração: se não há cartões cadastrados, cria um padrão a partir do antigo limiteCartao
        if (cartoes.length === 0) {
            const limiteAntigo = parseFloat(localStorage.getItem('futurorico_limiteCartao')) || 5000;
            cartoes.push({ id: 'card_padrao', nome: 'Cartão principal', limite: limiteAntigo, diaVencimento: null });
            localStorage.setItem('futurorico_cartoes', JSON.stringify(cartoes));
        }

        // Migração: garante que todo cartão tenha o campo `arquivado`
        cartoes = cartoes.map(c => ({ ...c, arquivado: c.arquivado === true }));
        localStorage.setItem('futurorico_cartoes', JSON.stringify(cartoes));

        function salvarCartoes() {
            localStorage.setItem('futurorico_cartoes', JSON.stringify(cartoes));
        }

        function obterCartao(id) {
            return cartoes.find(c => c.id === id) || cartoes[0];
        }

        function cartoesAtivos() {
            return cartoes.filter(c => !c.arquivado);
        }

        // Migração de transações antigas: cartão de crédito sem cartaoId vai pro primeiro cartão; sem obs vira ""
        transacoes = transacoes.map(t => {
            if (t.categoria === 'cartao_credito' && !t.cartaoId) t.cartaoId = cartoes[0].id;
            if (t.obs === undefined) t.obs = "";
            return t;
        });

        // Migração: cartao_credito deve ser atribuído ao mês/ano da fatura (dataVencimento),
        // não ao mês da compra. Sem isto, despesas de cartão poluem o mês actual.
        (function migrarCompetenciaCartao() {
            let mudou = false;
            transacoes.forEach(t => {
                if (t.categoria !== 'cartao_credito' || !t.dataVencimento) return;
                const parts = t.dataVencimento.split('-');
                if (parts.length !== 3) return;
                const fAno = parseInt(parts[0], 10);
                const fMes = parseInt(parts[1], 10) - 1;
                if (isNaN(fAno) || isNaN(fMes)) return;
                if (t.mes !== fMes || t.ano !== fAno) {
                    t.mes = fMes; t.ano = fAno; mudou = true;
                }
            });
            if (mudou) localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
        })();
        localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));

        function preencherPrecoAutomatico() {
            const inputTicker = document.getElementById('compraTicker').value.toUpperCase();
            const ativoEncontrado = mockAtivosMercado.find(a => a.ticker === inputTicker);
            if (ativoEncontrado) { setValorBRLInput(document.getElementById('compraPreco'), ativoEncontrado.preco_atual); calcularTotalCompra(); }
        }

        function calcularTotalCompra() {
            const cat = document.getElementById('compraCategoria').value;
            const semQtd = cat === 'renda_fixa' || cat === 'reserva_emergencia' || cat === 'previdencia';
            const qtd = semQtd ? 1 : (parseQtd(document.getElementById('compraQtd').value) || 0);
            const preco = parseBRL(document.getElementById('compraPreco').value) || 0;
            document.getElementById('compraTotalOp').innerText = formatarMoeda(qtd * preco);
        }

        function alternarTipoOperacao(tipo) {
            document.getElementById('tipoOperacao').value = tipo;
            const btnCompra = document.getElementById('btnTabCompra');
            const btnVenda = document.getElementById('btnTabVenda');
            const painelCard = document.getElementById('painelOperacaoCard');
            const lblPreco = document.getElementById('lblPrecoOp');
            const btnConfirmar = document.getElementById('btnConfirmarOp');
            const iconePainel = document.getElementById('iconePainelOp');
            const totalTexto = document.getElementById('compraTotalOp');
            const inputTicker = document.getElementById('compraTicker');
            const dicaTicker = document.getElementById('dicaTicker');

            inputTicker.value = ""; document.getElementById('compraQtd').value = ""; document.getElementById('compraPreco').value = ""; document.getElementById('compraTotalOp').innerText = "R$ 0,00";
            const elCorretora = document.getElementById('compraCorretora'); if(elCorretora) elCorretora.value = "";
            const elVenc = document.getElementById('compraVencimento'); if(elVenc) elVenc.value = "";
            const elRent = document.getElementById('compraRentabilidade'); if(elRent) elRent.value = "";
            const elData = document.getElementById('compraData'); if(elData) elData.value = new Date().toISOString().slice(0,10);
            const elCat = document.getElementById('compraCategoria'); if(elCat) { elCat.value = 'renda_variavel'; delete elCat.dataset.touched; }
            const elSub = document.getElementById('compraSubcategoria'); if(elSub) { elSub.value = 'acoes'; delete elSub.dataset.touched; }
            ajustarCamposPorCategoria();

            if(tipo === 'compra') {
                btnCompra.classList.add('ativo-compra'); btnVenda.classList.remove('ativo-venda');
                painelCard.style.background = 'var(--cor-bg-primaria)'; painelCard.style.borderColor = '#a7f3d0';
                lblPreco.innerText = 'Preço Pago (R$)'; btnConfirmar.innerHTML = '<i class="ph-bold ph-check"></i> Confirmar'; btnConfirmar.style.backgroundColor = 'var(--cor-primaria)';
                iconePainel.className = 'ph-fill ph-plus-circle'; iconePainel.style.color = 'var(--cor-primaria)'; totalTexto.style.color = 'var(--cor-primaria)';
                inputTicker.setAttribute('list', 'listaAtivosMercado'); inputTicker.placeholder = "Ex: BTLG11 ou Tesouro"; dicaTicker.innerText = "Digite o ativo e preencheremos a cotação (você pode editar).";
            } else {
                btnVenda.classList.add('ativo-venda'); btnCompra.classList.remove('ativo-compra');
                painelCard.style.background = 'var(--cor-bg-erro)'; painelCard.style.borderColor = '#fecdd3';
                lblPreco.innerText = 'Preço de Venda (R$)'; btnConfirmar.innerHTML = '<i class="ph-bold ph-trend-down"></i> Confirmar'; btnConfirmar.style.backgroundColor = 'var(--cor-erro)';
                iconePainel.className = 'ph-fill ph-minus-circle'; iconePainel.style.color = 'var(--cor-erro)'; totalTexto.style.color = 'var(--cor-erro)';
                inputTicker.setAttribute('list', 'listaAtivosCarteira'); inputTicker.placeholder = "Selecione um ativo da sua carteira"; dicaTicker.innerText = "Apenas ativos que você possui estão listados aqui.";
            }
        }

        // Lista padrão de bancos / corretoras brasileiras
        const LISTA_CORRETORAS = [
            'XP Investimentos', 'BTG Pactual', 'Rico', 'Clear Corretora', 'NuInvest',
            'Inter Invest', 'Itaú', 'Bradesco', 'Santander', 'Banco do Brasil',
            'Caixa Econômica', 'Sicredi', 'Sicoob', 'Modalmais', 'Avenue',
            'Genial Investimentos', 'C6 Bank', 'PicPay', 'Easynvest', 'Mirae Asset',
            'Toro Investimentos', 'Órama', 'Ágora Investimentos', 'Safra'
        ];

        function inicializarDatalistCorretoras() {
            const dl = document.getElementById('listaCorretoras');
            if(!dl) return;
            dl.innerHTML = "";
            // Junta as padrão com qualquer corretora que o usuário já tenha digitado
            const usadas = [...new Set(historicoCompras.map(op => op.corretora).filter(Boolean))];
            const todas = [...new Set([...LISTA_CORRETORAS, ...usadas])].sort((a,b) => a.localeCompare(b,'pt-BR'));
            todas.forEach(nome => {
                const opt = document.createElement('option');
                opt.value = nome;
                dl.appendChild(opt);
            });
        }

        function inicializarDatalistBancosTransacao() {
            const dl = document.getElementById('listaBancosTransacao');
            if(!dl) return;
            dl.innerHTML = "";
            const usadosCorretora = historicoCompras.map(op => op.corretora).filter(Boolean);
            const usadosBancoTx = (transacoes || []).map(t => t.banco).filter(Boolean);
            const todos = [...new Set([...LISTA_CORRETORAS, ...usadosCorretora, ...usadosBancoTx])].sort((a,b) => a.localeCompare(b,'pt-BR'));
            todos.forEach(nome => {
                const opt = document.createElement('option');
                opt.value = nome;
                dl.appendChild(opt);
            });
        }

        function categoriaInferidaDoMercado(ticker) {
            const ativo = mockAtivosMercado.find(a => a.ticker === (ticker || '').toUpperCase());
            if(!ativo) return null;
            return ativo.tipo === 'Renda Fixa' ? 'renda_fixa' : 'renda_variavel';
        }

        // Detecta a subcategoria de Renda Variável a partir do ticker.
        // - .SA / 4 letras + 1-2 dígitos = ações ou FII (FIIs terminam em 11)
        // - 4 letras + 34/35 = BDR
        // - termina em 11 e é ETF conhecido (BOVA11, IVVB11...) -> ETF
        // - prefixo cripto (BTC, ETH, SOL, ADA, etc. ou termina em -USD) -> cripto
        function subcategoriaInferidaDoTicker(ticker) {
            const t = (ticker || '').toUpperCase().trim();
            if(!t) return null;
            // Cripto
            if(/-USD$/.test(t) || /^(BTC|ETH|SOL|ADA|DOT|XRP|DOGE|BNB|MATIC|AVAX|LTC|LINK|UNI|USDT|USDC)/.test(t)) return 'cripto';
            // Mock conhecido
            const ativoMock = mockAtivosMercado.find(a => a.ticker === t);
            if(ativoMock) {
                if(ativoMock.tipo === 'FII') return 'fiis';
                if(ativoMock.tipo === 'BDR') return 'bdrs';
                if(ativoMock.tipo === 'ETF') return 'etfs';
                if(ativoMock.tipo === 'Ação') return 'acoes';
            }
            // BDR: 4 letras + 32, 33, 34, 35
            if(/^[A-Z]{4}3[2-5]$/.test(t)) return 'bdrs';
            // FIIs e alguns ETFs terminam em 11. ETFs comuns: BOVA, IVVB, SMAL, HASH, IMAB, FIND, SPXI, DIVO
            if(/11$/.test(t)) {
                if(/^(BOVA|IVVB|SMAL|HASH|IMAB|FIND|SPXI|DIVO|XINA|GOLD|FIXA|PIBB|ECOO|ESGB)/.test(t)) return 'etfs';
                return 'fiis';
            }
            // Ações brasileiras: 4 letras + 3 ou 4
            if(/^[A-Z]{4}[34]$/.test(t)) return 'acoes';
            return null;
        }

        function ajustarCamposPorCategoria() {
            const selCat = document.getElementById('compraCategoria');
            if(!selCat) return;
            const ticker = (document.getElementById('compraTicker').value || '').toUpperCase();
            const inferida = categoriaInferidaDoMercado(ticker) || (subcategoriaInferidaDoTicker(ticker) ? 'renda_variavel' : null);
            // Se o usuário não trocou manualmente e o ticker é conhecido, sincroniza
            if(inferida && !selCat.dataset.touched) selCat.value = inferida;
            const cat = selCat.value;
            const grupoRF = document.getElementById('grupoRendaFixa');
            const grupoVenc = document.getElementById('grupoVencimento');
            const grupoSubRV = document.getElementById('grupoSubcategoriaRV');
            const grupoQtd = document.getElementById('grupoQtd');
            const lblPreco = document.getElementById('lblPrecoOp');
            const lblTicker = document.getElementById('lblTickerOp');
            const inputTicker = document.getElementById('compraTicker');
            const dicaTicker = document.getElementById('dicaTicker');
            const ehRF = cat === 'renda_fixa';
            const ehReserva = cat === 'reserva_emergencia';
            const ehPrev = cat === 'previdencia';
            const ehRV = cat === 'renda_variavel';
            const semQtd = ehRF || ehReserva || ehPrev;

            if(grupoRF) grupoRF.style.display = (ehRF || ehReserva) ? 'block' : 'none';
            // Reserva NÃO tem vencimento — esconder
            if(grupoVenc) grupoVenc.style.display = ehReserva ? 'none' : 'block';
            if(grupoSubRV) grupoSubRV.style.display = ehRV ? 'block' : 'none';
            if(grupoQtd) grupoQtd.style.display = semQtd ? 'none' : 'block';
            const grupoPrev = document.getElementById('grupoPrevidencia');
            const grupoTaxaPrev = document.getElementById('grupoTaxaMensalPrev');
            const ehRecorrente = ehPrev || ehReserva;
            if(grupoPrev) grupoPrev.style.display = ehRecorrente ? 'block' : 'none';
            // Reserva: oculta campo de rentabilidade mensal (mantém só dia + duração)
            if(grupoTaxaPrev) grupoTaxaPrev.style.display = ehPrev ? 'block' : 'none';
            // Default do dia de recorrência: pega o dia da data da operação
            if(ehRecorrente) {
                const inpDia = document.getElementById('prevDiaRecorrencia');
                const inpTaxa = document.getElementById('prevTaxaMensal');
                const inpDuracao = document.getElementById('prevDuracaoAnos');
                if(inpDia && !inpDia.value) {
                    const d = document.getElementById('compraData').value;
                    inpDia.value = d ? new Date(d + 'T12:00:00').getDate() : new Date().getDate();
                }
                if(ehPrev && inpTaxa && !inpTaxa.value) inpTaxa.value = '0,80';
                if(inpDuracao && !inpDuracao.value) inpDuracao.value = ehPrev ? '10' : '5';
            }

            // Renomear "Preço pago" conforme categoria
            if(lblPreco) {
                const tipoOp = document.getElementById('tipoOperacao').value;
                if(tipoOp === 'venda') lblPreco.innerText = 'Preço de Venda (R$)';
                else if(ehRF) lblPreco.innerText = 'Valor aplicado (R$)';
                else if(ehReserva) lblPreco.innerText = 'Valor guardado (R$)';
                else if(ehPrev) lblPreco.innerText = 'Valor do aporte (R$)';
                else lblPreco.innerText = 'Preço Pago (R$)';
            }

            // Ticker: ações/FIIs/etc usam datalist; RF / Reserva / Previdência são texto livre
            if(inputTicker) {
                if(semQtd) {
                    inputTicker.removeAttribute('list');
                    if(lblTicker) lblTicker.innerText = ehPrev ? 'Nome do plano' : (ehReserva ? 'Onde está guardado (banco/aplicação)' : 'Nome do título');
                    if(dicaTicker) dicaTicker.innerText = ehPrev ? 'Ex: Brasilprev VGBL Conservador' : (ehReserva ? 'Ex: Poupança Itaú, CDB Nubank' : 'Ex: Tesouro IPCA+ 2035, CDB Nubank');
                } else {
                    inputTicker.setAttribute('list', document.getElementById('tipoOperacao').value === 'venda' ? 'listaAtivosCarteira' : 'listaAtivosMercado');
                    if(lblTicker) lblTicker.innerText = 'Buscar Ativo (Ticker ou Nome)';
                    if(dicaTicker) dicaTicker.innerText = 'Digite o ativo e preencheremos a cotação (você pode editar).';
                }
            }

            // Auto-detectar subcategoria de RV
            if(ehRV) {
                const selSub = document.getElementById('compraSubcategoria');
                const sub = subcategoriaInferidaDoTicker(ticker);
                if(sub && selSub && !selSub.dataset.touched) selSub.value = sub;
            }
            atualizarProjecaoForm();
        }

        // ============================================================
        // === RENDA FIXA — TAXAS DE MERCADO + PROJEÇÃO              ===
        // ============================================================
        // Taxas anuais (em fração decimal). Valores conservadores caso o BCB falhe.
        let taxasMercado = { cdi: 0.105, ipca: 0.045, selic: 0.105, atualizadoEm: null, fonte: 'estimativa' };

        async function buscarTaxasBCB() {
            // Selic meta (sgs.432) e IPCA 12m (sgs.13522). CDI ≈ Selic.
            const consultas = [
                { chave: 'selic', url: 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json' },
                { chave: 'ipca', url: 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json' }
            ];
            try {
                const resultados = await Promise.all(consultas.map(c => fetch(c.url).then(r => r.ok ? r.json() : null).catch(() => null)));
                const [selicData, ipcaData] = resultados;
                let mudou = false;
                if(selicData && selicData[0] && selicData[0].valor) {
                    const v = parseFloat(String(selicData[0].valor).replace(',', '.')) / 100;
                    if(!isNaN(v) && v > 0) { taxasMercado.selic = v; taxasMercado.cdi = v; mudou = true; }
                }
                if(ipcaData && ipcaData[0] && ipcaData[0].valor) {
                    const v = parseFloat(String(ipcaData[0].valor).replace(',', '.')) / 100;
                    if(!isNaN(v) && v > 0) { taxasMercado.ipca = v; mudou = true; }
                }
                if(mudou) { taxasMercado.fonte = 'BCB'; taxasMercado.atualizadoEm = new Date().toISOString(); }
            } catch(_) { /* mantém estimativas */ }
            atualizarProjecaoForm();
            atualizarCarteiraAtivos();
        }

        // Converte texto livre de rentabilidade em uma taxa anual (decimal).
        // Suporta: "110% CDI", "CDI + 2%", "IPCA+6%", "12% a.a.", "12,5%", "Selic+1"
        function parsearRentabilidade(texto) {
            if(!texto) return null;
            const t = String(texto).toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');
            const cdi = taxasMercado.cdi;
            const ipca = taxasMercado.ipca;
            const selic = taxasMercado.selic;
            // Padrões: <num>% <indexador>      ex: 110%cdi
            let m = t.match(/^(\d+(?:\.\d+)?)%(?:do)?(cdi|selic|ipca)$/);
            if(m) {
                const perc = parseFloat(m[1]) / 100;
                const idx = m[2] === 'ipca' ? ipca : (m[2] === 'selic' ? selic : cdi);
                return { taxa: perc * idx, descricao: `${(perc*100).toFixed(0)}% do ${m[2].toUpperCase()}`, indexador: m[2] };
            }
            // Padrões: <indexador>+<num>%      ex: ipca+6, cdi+2%
            m = t.match(/^(cdi|selic|ipca)\+(\d+(?:\.\d+)?)%?$/);
            if(m) {
                const idx = m[1] === 'ipca' ? ipca : (m[1] === 'selic' ? selic : cdi);
                const spread = parseFloat(m[2]) / 100;
                // Combinação multiplicativa (juros compostos sobre o indexador)
                const taxa = (1 + idx) * (1 + spread) - 1;
                return { taxa, descricao: `${m[1].toUpperCase()}+${(spread*100).toFixed(2)}%`, indexador: m[1] };
            }
            // Padrões prefixados: "12%", "12% a.a.", "12.5%aa"
            m = t.match(/^(\d+(?:\.\d+)?)%?(?:aa|a\.a\.?)?$/);
            if(m) {
                return { taxa: parseFloat(m[1]) / 100, descricao: `${parseFloat(m[1]).toFixed(2)}% a.a. (prefixado)`, indexador: 'pre' };
            }
            return null;
        }

        // Calcula valor projetado no vencimento (juros compostos anuais)
        function calcularProjecaoRF(valorInicial, dataInicio, dataVencimento, rentabilidadeTexto) {
            const parsed = parsearRentabilidade(rentabilidadeTexto);
            if(!parsed || !valorInicial || !dataInicio || !dataVencimento) return null;
            const inicio = new Date(dataInicio); const fim = new Date(dataVencimento);
            const diasMs = fim.getTime() - inicio.getTime();
            if(diasMs <= 0) return null;
            const anos = diasMs / (365.25 * 24 * 60 * 60 * 1000);
            const fator = Math.pow(1 + parsed.taxa, anos);
            const valorFinalBruto = valorInicial * fator;
            const rendimentoBruto = valorFinalBruto - valorInicial;
            // IR regressivo (renda fixa privada). Tesouro Selic/IPCA seguem mesma tabela. LCI/LCA são isentos — não diferenciamos aqui.
            const dias = diasMs / (24*60*60*1000);
            let aliquotaIR = 0.225;
            if(dias > 180) aliquotaIR = 0.20;
            if(dias > 360) aliquotaIR = 0.175;
            if(dias > 720) aliquotaIR = 0.15;
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
                aliquotaIR
            };
        }

        function atualizarProjecaoForm() {
            const preview = document.getElementById('projecaoRfPreview');
            if(!preview) return;
            const cat = document.getElementById('compraCategoria').value;
            const ehRF = cat === 'renda_fixa' || cat === 'reserva_emergencia';
            if(!ehRF) { preview.style.display = 'none'; return; }

            const rent = document.getElementById('compraRentabilidade').value.trim();
            // Validação inline da string de rentabilidade (mesmo sem todos os outros campos)
            if(rent) {
                const parsed = parsearRentabilidade(rent);
                const hint = document.getElementById('compraRentabilidade');
                if(parsed) hint.style.borderColor = '';
                else hint.style.borderColor = 'var(--cor-erro)';
            }

            const semQtd = cat === 'renda_fixa' || cat === 'reserva_emergencia' || cat === 'previdencia';
            const qtd = semQtd ? 1 : (parseQtd(document.getElementById('compraQtd').value) || 0);
            const preco = parseBRL(document.getElementById('compraPreco').value) || 0;
            const dataOp = document.getElementById('compraData').value;
            const venc = document.getElementById('compraVencimento').value;
            const valor = qtd * preco;
            if(!valor || !dataOp || !venc || !rent) { preview.style.display = 'none'; return; }
            const proj = calcularProjecaoRF(valor, dataOp, venc, rent);
            if(!proj) {
                preview.classList.add('warning');
                preview.style.display = 'block';
                preview.innerHTML = `<i class="ph ph-warning"></i> Não consegui interpretar a rentabilidade. Use formatos como <strong>110% CDI</strong>, <strong>IPCA+6%</strong>, <strong>12% a.a.</strong>`;
                return;
            }
            preview.classList.remove('warning');
            const fonte = taxasMercado.fonte === 'BCB' ? `CDI ${(taxasMercado.cdi*100).toFixed(2)}% · IPCA ${(taxasMercado.ipca*100).toFixed(2)}% (BCB)` : `taxas estimadas`;
            preview.style.display = 'block';
            preview.innerHTML = `
                <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                    <span><i class="ph-fill ph-trend-up"></i> <strong>${proj.descricaoTaxa}</strong> · ${proj.anos.toFixed(2)} anos</span>
                    <span style="font-weight:600;">Bruto no vencimento: ${formatarMoeda(proj.valorFinalBruto)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-top:4px;">
                    <span style="opacity:.85;">IR ${(proj.aliquotaIR*100).toFixed(1)}% · ${fonte}</span>
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
            const semQtd = categoria === 'renda_fixa' || categoria === 'reserva_emergencia' || categoria === 'previdencia';
            const qtd = semQtd ? 1 : parseQtd(document.getElementById('compraQtd').value);
            const preco = parseBRL(document.getElementById('compraPreco').value);
            const subcategoria = categoria === 'renda_variavel' ? (document.getElementById('compraSubcategoria').value || subcategoriaInferidaDoTicker(ticker) || 'acoes') : null;

            if (!ticker || isNaN(preco) || preco <= 0) return mostrarToast("Preencha Ticker e Valor corretamente.", "erro");
            if (!semQtd && (isNaN(qtd) || qtd <= 0)) return mostrarToast("Preencha a Quantidade corretamente.", "erro");
            if (!corretora) {
                const elCorr = document.getElementById('compraCorretora');
                if(elCorr) { elCorr.style.borderColor = 'var(--cor-erro)'; elCorr.focus(); setTimeout(() => { elCorr.style.borderColor = ''; }, 2500); }
                return mostrarToast("Informe o banco/corretora — campo obrigatório.", "erro");
            }

            if (tipoOp === 'venda') {
                let carteiraAtual = obterResumoCarteira();
                let ativoNaCarteira = carteiraAtual[ticker];
                if (!ativoNaCarteira || ativoNaCarteira.qtdTotal < qtd) return mostrarToast(`Saldo insuficiente! Você possui apenas ${ativoNaCarteira ? ativoNaCarteira.qtdTotal : 0} unidades de ${ticker}.`, "erro");
            }

            const valorTotal = qtd * preco;
            const dataOp = dataInput ? new Date(dataInput + 'T12:00:00') : new Date();
            const operacao = {
                id: Date.now(),
                ticker: ticker,
                quantidade: qtd,
                preco_op: preco,
                tipo: tipoOp,
                data_op: dataOp.toISOString(),
                categoria: categoria || null,
                subcategoria: subcategoria,
                corretora: corretora || null
            };
            if(categoria === 'renda_fixa') {
                if(vencimento) operacao.vencimento = vencimento;
                if(rentabilidade) operacao.rentabilidade = rentabilidade;
            }
            if(categoria === 'reserva_emergencia') {
                if(rentabilidade) operacao.rentabilidade = rentabilidade;
            }
            const ehRecorrenteCompra = (categoria === 'previdencia' || categoria === 'reserva_emergencia') && tipoOp === 'compra';
            if(ehRecorrenteCompra) {
                operacao.recorrente = !!document.getElementById('prevRecorrente').checked;
                const diaInp = parseInt(document.getElementById('prevDiaRecorrencia').value, 10);
                operacao.diaRecorrencia = (diaInp >= 1 && diaInp <= 31) ? diaInp : dataOp.getDate();
                const duracaoInp = parseInt(document.getElementById('prevDuracaoAnos').value, 10);
                operacao.duracaoAnos = (duracaoInp >= 1 && duracaoInp <= 40) ? duracaoInp : (categoria === 'previdencia' ? 10 : 5);
                if(categoria === 'previdencia') {
                    const taxaInp = parseBRL(document.getElementById('prevTaxaMensal').value);
                    operacao.taxaMensal = (taxaInp > 0) ? (taxaInp / 100) : 0.008;
                }
            }
            historicoCompras.push(operacao);
            localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));

            const descQtd = semQtd ? '' : `${formatarQtd(qtd)}x `;
            if (tipoOp === 'compra') {
                let tipoAtivoStr = semQtd ? 'investimento_fixo' : 'investimento_variavel';
                transacoes.push({ id: operacao.id.toString(), operacaoId: operacao.id, descricao: `Compra: ${descQtd}${ticker}`, valor: valorTotal, categoria: tipoAtivoStr, mes: dataOp.getMonth(), ano: dataOp.getFullYear(), data: dataOp.toISOString(), pago: true });

                // RN03: Origem do recurso. Quando o usuário declara que o aporte
                // sai do saldo de uma instituição, gera transação espelho de
                // transferência (abatendo o caixa). O abate aparece em
                // mpCalcularSaldoPorInstituicao (#meu_patrimonio).
                const elOrigemSel = document.getElementById('compraOrigemRecurso');
                const origem = elOrigemSel ? elOrigemSel.value : 'externo';
                if(origem === 'caixa_proprio' || origem === 'caixa_outra') {
                    const banco = origem === 'caixa_proprio'
                        ? corretora
                        : ((document.getElementById('compraOrigemBanco') || {}).value || '').trim();
                    if(banco) {
                        transacoes.push({
                            id: 'tx_origem_' + operacao.id,
                            operacaoId: operacao.id,
                            descricao: `Transferência → ${ticker} (${corretora})`,
                            valor: valorTotal,
                            categoria: 'transferencia_saida',
                            banco: banco,
                            mes: dataOp.getMonth(),
                            ano: dataOp.getFullYear(),
                            data: dataOp.toISOString(),
                            pago: true
                        });
                    }
                }
            } else {
                transacoes.push({ id: operacao.id.toString(), operacaoId: operacao.id, descricao: `Venda Resgate: ${descQtd}${ticker}`, valor: valorTotal, categoria: 'resgate_investimento', mes: dataOp.getMonth(), ano: dataOp.getFullYear(), data: dataOp.toISOString(), pago: true });
            }

            // === COMPROMISSO RECORRENTE: previdência e reserva geram lançamentos futuros no Controle
            let lancamentosFuturos = 0;
            if(ehRecorrenteCompra && operacao.recorrente && operacao.duracaoAnos > 0 && valorTotal > 0) {
                lancamentosFuturos = gerarLancamentosFuturosCompromisso(operacao, valorTotal);
            }

            localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
            document.getElementById('compraTicker').value = ""; document.getElementById('compraQtd').value = ""; document.getElementById('compraPreco').value = ""; document.getElementById('compraTotalOp').innerText = "R$ 0,00";
            document.getElementById('compraCorretora').value = ""; document.getElementById('compraVencimento').value = ""; document.getElementById('compraRentabilidade').value = "";
            document.getElementById('compraData').value = new Date().toISOString().slice(0,10);
            const elCat = document.getElementById('compraCategoria'); elCat.value = 'renda_variavel'; delete elCat.dataset.touched;
            const elSub = document.getElementById('compraSubcategoria'); if(elSub) { elSub.value = 'acoes'; delete elSub.dataset.touched; }
            const inpDiaPrev = document.getElementById('prevDiaRecorrencia'); if(inpDiaPrev) inpDiaPrev.value = '';
            const inpTaxaPrev = document.getElementById('prevTaxaMensal'); if(inpTaxaPrev) inpTaxaPrev.value = '';
            const inpDurPrev = document.getElementById('prevDuracaoAnos'); if(inpDurPrev) inpDurPrev.value = '';
            const chkRecPrev = document.getElementById('prevRecorrente'); if(chkRecPrev) chkRecPrev.checked = true;
            const elOrigem = document.getElementById('compraOrigemRecurso'); if(elOrigem) elOrigem.value = 'externo';
            const elOrigBanco = document.getElementById('compraOrigemBanco'); if(elOrigBanco) { elOrigBanco.value = ''; elOrigBanco.style.display = 'none'; }
            ajustarCamposPorCategoria();
            const msgBase = tipoOp === 'compra' ? `Compra de ${ticker} registrada com sucesso!` : `Venda de ${ticker} registrada com sucesso!`;
            const msgExtra = lancamentosFuturos > 0 ? ` ${lancamentosFuturos} lançamento${lancamentosFuturos===1?'':'s'} mensal${lancamentosFuturos===1?'':'is'} criado${lancamentosFuturos===1?'':'s'} no Controle.` : '';
            mostrarToast(msgBase + msgExtra, tipoOp === 'compra' ? 'sucesso' : 'aviso');
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
            if(!container) return;

            const filtroTicker = (document.getElementById('filtroOperacoesTicker')?.value || '').toUpperCase();

            const ops = [...historicoCompras]
                .filter(op => !filtroTicker || (op.ticker || '').includes(filtroTicker))
                .filter(op => {
                    if(filtroOpsTimeline === 'todos') return true;
                    return (op.tipo || 'compra') === filtroOpsTimeline;
                })
                .sort((a,b) => new Date(b.data_op || 0) - new Date(a.data_op || 0));

            if(ops.length === 0) {
                container.innerHTML = "";
                msgVazia.style.display = 'block';
                if(summaryEl) summaryEl.style.display = 'none';
                return;
            }
            msgVazia.style.display = 'none';

            // Summary stats
            const totalCompras = ops.filter(o => (o.tipo || 'compra') === 'compra').length;
            const totalVendas = ops.filter(o => o.tipo === 'venda').length;
            const valorCompras = ops.filter(o => (o.tipo || 'compra') === 'compra').reduce((s, o) => s + (o.quantidade || 1) * (o.preco_op || o.preco_pago || 0), 0);
            const valorVendas = ops.filter(o => o.tipo === 'venda').reduce((s, o) => s + (o.quantidade || 1) * (o.preco_op || o.preco_pago || 0), 0);
            if(summaryEl) {
                summaryEl.style.display = 'flex';
                summaryEl.innerHTML = `
                    <span><i class="ph-bold ph-trend-up" style="color:var(--cor-primaria);"></i> ${totalCompras} compra${totalCompras !== 1 ? 's' : ''} · <strong class="valor-mascarado">${formatarMoeda(valorCompras)}</strong></span>
                    ${totalVendas > 0 ? `<span><i class="ph-bold ph-trend-down" style="color:var(--cor-erro);"></i> ${totalVendas} venda${totalVendas !== 1 ? 's' : ''} · <strong class="valor-mascarado">${formatarMoeda(valorVendas)}</strong></span>` : ''}
                    <span style="margin-left:auto;color:var(--cor-texto-mutado);">${ops.length} operaç${ops.length !== 1 ? 'ões' : 'ão'}</span>`;
            }

            // Group by date label
            const hoje = new Date(); const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
            const hojeStr = hoje.toISOString().slice(0,10);
            const ontemStr = ontem.toISOString().slice(0,10);

            let html = '';
            let lastGroup = '';

            ops.forEach(op => {
                const tipo = op.tipo || 'compra';
                const dataStr = (op.data_op || '').slice(0,10);
                const dataObj = dataStr ? new Date(dataStr + 'T12:00:00') : null;

                // Date group header
                let groupLabel = '';
                if(dataStr === hojeStr) groupLabel = 'Hoje';
                else if(dataStr === ontemStr) groupLabel = 'Ontem';
                else if(dataObj) groupLabel = dataObj.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
                else groupLabel = 'Sem data';

                if(groupLabel !== lastGroup) {
                    html += `<div class="timeline-date-header">${groupLabel}</div>`;
                    lastGroup = groupLabel;
                }

                const ativoMercado = mockAtivosMercado.find(a => a.ticker === op.ticker);
                const nomeAtivo = ativoMercado ? ativoMercado.nome : '';
                const total = (op.quantidade || 1) * (op.preco_op || op.preco_pago || 0);
                const semQtd = op.categoria === 'renda_fixa' || op.categoria === 'reserva_emergencia' || op.categoria === 'previdencia';
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
            if(!el) return;
            el.classList.toggle('aberto');
        }

        function editarOperacao(id) {
            const op = historicoCompras.find(o => o.id === id);
            if(!op) return mostrarToast('Operação não encontrada.', 'erro');

            // Abre o drawer com os campos preenchidos
            abrirDrawerOperacao();
            alternarTipoOperacao(op.tipo || 'compra');
            document.getElementById('compraTicker').value = op.ticker || '';
            setValorQtdInput(document.getElementById('compraQtd'), op.quantidade || '');
            setValorBRLInput(document.getElementById('compraPreco'), op.preco_op || op.preco_pago || 0);
            document.getElementById('compraData').value = (op.data_op || '').slice(0,10) || new Date().toISOString().slice(0,10);
            document.getElementById('compraCorretora').value = op.corretora || '';
            const elCat = document.getElementById('compraCategoria');
            if(op.categoria) { elCat.value = op.categoria; elCat.dataset.touched = '1'; }
            const elSub = document.getElementById('compraSubcategoria');
            if(elSub && op.subcategoria) { elSub.value = op.subcategoria; elSub.dataset.touched = '1'; }
            document.getElementById('compraVencimento').value = op.vencimento || '';
            document.getElementById('compraRentabilidade').value = op.rentabilidade || '';
            // Previdência / Reserva
            const chkRec = document.getElementById('prevRecorrente');
            const inpDiaRec = document.getElementById('prevDiaRecorrencia');
            const inpTaxaMensal = document.getElementById('prevTaxaMensal');
            const inpDuracao = document.getElementById('prevDuracaoAnos');
            if(chkRec) chkRec.checked = op.recorrente !== false;
            if(inpDiaRec) inpDiaRec.value = op.diaRecorrencia || '';
            if(inpTaxaMensal) inpTaxaMensal.value = op.taxaMensal != null ? (op.taxaMensal * 100).toFixed(2).replace('.', ',') : '';
            if(inpDuracao) inpDuracao.value = op.duracaoAnos || '';
            // Antes de recriar, limpa lançamentos futuros do compromisso (serão regerados ao Confirmar)
            if((op.categoria === 'previdencia' || op.categoria === 'reserva_emergencia') && op.recorrente) {
                removerLancamentosFuturosCompromisso(id);
            }
            ajustarCamposPorCategoria();
            calcularTotalCompra();
            atualizarProjecaoForm();

            // Remove a versão antiga; o "Confirmar" cria uma nova entrada
            historicoCompras = historicoCompras.filter(o => o.id !== id);
            transacoes = transacoes.filter(t => t.id !== id.toString());
            localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));
            localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
            atualizarCarteiraAtivos();
            renderizarOperacoes();

            mostrarToast('Edite os campos e clique em Confirmar.', 'info');
        }

        function excluirOperacao(id) {
            const op = historicoCompras.find(o => o.id === id);
            if(!op) return mostrarToast('Operação não encontrada.', 'erro');

            const modal = document.getElementById('modalConfirmacao');
            document.getElementById('modalTitulo').innerHTML = `<i class="ph-fill ph-trash" style="color: var(--cor-erro);"></i> Excluir operação`;
            document.getElementById('modalMensagem').innerHTML = `Tem certeza que deseja excluir a operação:<br><strong>${(op.tipo || 'compra').toUpperCase()}</strong> de <strong>${op.quantidade}x ${op.ticker}</strong> em ${op.data_op ? new Date(op.data_op).toLocaleDateString('pt-BR') : '—'}?<br><br><span style="color: var(--cor-erro); font-weight: 600;">Esta ação não pode ser desfeita.</span>`;
            document.getElementById('modalAcoes').innerHTML = `<button class="btn-acao" style="background-color: var(--cor-erro);" onclick="confirmarExclusaoOperacao(${id})"><i class="ph ph-trash"></i> Sim, excluir</button>`;
            modal.style.display = 'flex';
        }

        function confirmarExclusaoOperacao(id) {
            const op = historicoCompras.find(o => o.id === id);
            // Cascade: ao excluir o template recorrente de previdência, remove os aportes gerados também
            const idsParaRemover = new Set([id]);
            let cascade = 0;
            if(op && op.categoria === 'previdencia' && op.recorrente && !op.gerado) {
                historicoCompras.forEach(o => {
                    if(o.operacaoOrigem === id) { idsParaRemover.add(o.id); cascade++; }
                });
            }
            // Cascade extra: remove lançamentos futuros do compromisso (previdência ou reserva)
            // — preserva os meses já pagos/passados conforme regra do produto.
            let lancFuturosRemovidos = 0;
            if(op && (op.categoria === 'previdencia' || op.categoria === 'reserva_emergencia') && op.recorrente && !op.gerado) {
                const antes = transacoes.length;
                removerLancamentosFuturosCompromisso(id);
                lancFuturosRemovidos = antes - transacoes.length;
            }
            historicoCompras = historicoCompras.filter(o => !idsParaRemover.has(o.id));
            transacoes = transacoes.filter(t => {
                const tid = t.id;
                for(const remId of idsParaRemover) {
                    if(tid === remId.toString() || tid === remId) return false;
                }
                return true;
            });
            localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));
            localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
            fecharModal();
            atualizarCarteiraAtivos();
            renderizarOperacoes();
            if(typeof atualizarTelaControle === 'function') atualizarTelaControle();
            const msgs = ['Operação excluída.'];
            if(cascade > 0) msgs.push(`${cascade} aporte${cascade===1?'':'s'} recorrente${cascade===1?'':'s'} cancelado${cascade===1?'':'s'}.`);
            if(lancFuturosRemovidos > 0) msgs.push(`${lancFuturosRemovidos} lançamento${lancFuturosRemovidos===1?'':'s'} futuro${lancFuturosRemovidos===1?'':'s'} removido${lancFuturosRemovidos===1?'':'s'} do Controle (passados preservados).`);
            mostrarToast(msgs.join(' '), 'sucesso');
        }

        function obterResumoCarteira() {
            let consolidado = {};
            historicoCompras.forEach(op => {
                if(!consolidado[op.ticker]) consolidado[op.ticker] = { qtdTotal: 0, valorTotalInvestido: 0, precoMedio: 0, categoria: null, subcategoria: null, corretora: null, vencimento: null, rentabilidade: null };
                let ativo = consolidado[op.ticker]; let tipo = op.tipo || 'compra'; let precoDaOp = op.preco_op || op.preco_pago;
                if (tipo === 'compra') {
                    ativo.qtdTotal += op.quantidade; ativo.valorTotalInvestido += (op.quantidade * precoDaOp); ativo.precoMedio = ativo.valorTotalInvestido / ativo.qtdTotal;
                    // Última compra define metadados exibidos
                    if(op.categoria) ativo.categoria = op.categoria;
                    if(op.subcategoria) ativo.subcategoria = op.subcategoria;
                    if(op.corretora) ativo.corretora = op.corretora;
                    if(op.vencimento) ativo.vencimento = op.vencimento;
                    if(op.rentabilidade) ativo.rentabilidade = op.rentabilidade;
                }
                else if (tipo === 'venda') { ativo.qtdTotal -= op.quantidade; ativo.valorTotalInvestido -= (op.quantidade * ativo.precoMedio); }
            });
            return consolidado;
        }

        // Mapeia tipo do mockAtivosMercado para subcategoria de RV
        function tipoMercadoParaSubcategoria(tipo) {
            if(tipo === 'FII') return 'fiis';
            if(tipo === 'BDR') return 'bdrs';
            if(tipo === 'ETF') return 'etfs';
            if(tipo === 'Ação') return 'acoes';
            return null;
        }

        // Subcategoria efetiva (operação > inferência mock > inferência ticker > fallback acoes)
        function subcategoriaEfetiva(ticker, ativoConsolidado, ativoMercado) {
            if(ativoConsolidado?.subcategoria) return ativoConsolidado.subcategoria;
            const m = ativoMercado ? tipoMercadoParaSubcategoria(ativoMercado.tipo) : null;
            if(m) return m;
            return subcategoriaInferidaDoTicker(ticker) || 'acoes';
        }

        // ============================================================
        // === PREVIDÊNCIA — recorrência mensal + saldo composto      ===
        // ============================================================
        // Calcula o saldo de um plano de previdência aplicando juros compostos
        // mensais a partir de cada aporte até a data informada (default: hoje).
        function calcularSaldoPrevidencia(ticker, ts) {
            const refTs = ts || Date.now();
            const aportes = historicoCompras.filter(op => op.ticker === ticker && op.categoria === 'previdencia' && op.data_op);
            let saldo = 0;
            aportes.forEach(op => {
                const dataAporte = new Date(op.data_op).getTime();
                if(dataAporte > refTs) return;
                const taxa = (op.taxaMensal != null) ? op.taxaMensal : 0.008;
                const meses = Math.max(0, (refTs - dataAporte) / (30.4375 * 24 * 60 * 60 * 1000));
                const valor = op.preco_op || op.preco_pago || 0;
                const fator = Math.pow(1 + taxa, meses);
                if((op.tipo || 'compra') === 'venda') saldo -= valor * fator;
                else saldo += valor * fator;
            });
            return Math.max(0, saldo);
        }

        // Acrescenta um mês ao Date `d` ajustando para o último dia do mês alvo
        // se o `dia` original (ex: 31) não existir naquele mês.
        function avancarMesParaDia(d, dia) {
            const proximo = new Date(d.getFullYear(), d.getMonth() + 1, 1);
            const ultDiaMes = new Date(proximo.getFullYear(), proximo.getMonth() + 1, 0).getDate();
            proximo.setDate(Math.min(dia, ultDiaMes));
            proximo.setHours(12, 0, 0, 0);
            return proximo;
        }

        // Gera retroativamente os aportes mensais que faltaram para cada plano de
        // === COMPROMISSO RECORRENTE — Previdência e Reserva ==========
        // Gera lançamentos mensais futuros no Controle Financeiro a partir
        // do mês seguinte ao da operação, durante operacao.duracaoAnos anos.
        // Esses valores comprometem a renda da pessoa de forma realista.
        function gerarLancamentosFuturosCompromisso(operacao, valorMensal) {
            if(!operacao || valorMensal <= 0) return 0;
            const dur = parseInt(operacao.duracaoAnos, 10);
            if(!(dur > 0)) return 0;
            const totalMeses = Math.min(dur * 12, 480); // hardcap 40 anos
            const dia = (operacao.diaRecorrencia >= 1 && operacao.diaRecorrencia <= 31) ? operacao.diaRecorrencia : new Date(operacao.data_op).getDate();
            const groupId = 'compromisso_grp_' + operacao.id;
            const dataIni = new Date(operacao.data_op);
            const labelCat = operacao.categoria === 'previdencia' ? 'Previdência' : 'Reserva';
            const descricao = `${labelCat}: ${operacao.ticker || labelCat}`;
            let criados = 0;
            // Começa no mês SEGUINTE ao da operação (o mês corrente já foi lançado pela compra)
            for(let i = 1; i < totalMeses; i++) {
                const d = new Date(dataIni.getFullYear(), dataIni.getMonth() + i, 1);
                const m = d.getMonth();
                const a = d.getFullYear();
                const jaExiste = transacoes.some(t => t.compromissoId === operacao.id && t.mes === m && t.ano === a);
                if(jaExiste) continue;
                let dataVencFinal = null;
                const ultimoDiaMes = new Date(a, m + 1, 0).getDate();
                const diaEfetivo = Math.min(dia, ultimoDiaMes);
                dataVencFinal = `${a}-${String(m+1).padStart(2,'0')}-${String(diaEfetivo).padStart(2,'0')}`;
                transacoes.push({
                    id: 'tx_compromisso_' + operacao.id + '_' + i,
                    groupId,
                    compromissoId: operacao.id,
                    compromissoCategoria: operacao.categoria,
                    descricao,
                    valor: valorMensal,
                    categoria: 'investimento_fixo',
                    obs: `Compromisso recorrente — ${labelCat.toLowerCase()} (${dur} ano${dur===1?'':'s'})`,
                    mes: m, ano: a,
                    data: d.toISOString(),
                    dataVencimento: dataVencFinal,
                    pago: false,
                    gerado: true
                });
                criados++;
            }
            return criados;
        }

        // Remove lançamentos futuros vinculados a um compromisso (preserva pagos/passados)
        function removerLancamentosFuturosCompromisso(operacaoId) {
            const agora = new Date();
            const m0 = agora.getMonth(), a0 = agora.getFullYear();
            const antes = transacoes.length;
            transacoes = transacoes.filter(t => {
                if(t.compromissoId !== operacaoId) return true;
                if(t.pago) return true;
                const futuroOuCorrente = (t.ano > a0) || (t.ano === a0 && t.mes >= m0);
                return !futuroOuCorrente;
            });
            if(transacoes.length !== antes) localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
        }
        // ============================================================

        // previdência marcado como recorrente. Roda no carregamento do app.
        function processarAportesRecorrentesPrevidencia() {
            const hoje = new Date();
            const grupos = {};
            historicoCompras.forEach(op => {
                if(op.categoria !== 'previdencia' || (op.tipo || 'compra') === 'venda') return;
                if(!grupos[op.ticker]) grupos[op.ticker] = [];
                grupos[op.ticker].push(op);
            });

            const novosAportes = [];
            const novasTransacoes = [];

            Object.entries(grupos).forEach(([ticker, ops]) => {
                // Template = aporte manual marcado como recorrente
                const templates = ops.filter(o => !o.gerado && o.recorrente).sort((a,b) => new Date(a.data_op) - new Date(b.data_op));
                if(templates.length === 0) return;
                const template = templates[0];
                const diaRec = template.diaRecorrencia || new Date(template.data_op).getDate();
                const valorAporte = template.preco_op || template.preco_pago || 0;
                if(valorAporte <= 0) return;
                const taxa = (template.taxaMensal != null) ? template.taxaMensal : 0.008;

                // Cursor = mês imediatamente após o último aporte existente para o ticker
                const todasOrdenadas = [...ops].sort((a,b) => new Date(a.data_op) - new Date(b.data_op));
                const ultimo = todasOrdenadas[todasOrdenadas.length - 1];
                let cursor = avancarMesParaDia(new Date(ultimo.data_op), diaRec);

                let safety = 0;
                while(cursor <= hoje && safety < 240) {
                    safety++;
                    const id = Date.now() + Math.floor(Math.random() * 100000) + safety;
                    novosAportes.push({
                        id,
                        ticker,
                        quantidade: 1,
                        preco_op: valorAporte,
                        tipo: 'compra',
                        data_op: cursor.toISOString(),
                        categoria: 'previdencia',
                        subcategoria: null,
                        corretora: template.corretora || null,
                        recorrente: true,
                        diaRecorrencia: diaRec,
                        taxaMensal: taxa,
                        gerado: true,
                        operacaoOrigem: template.id
                    });
                    novasTransacoes.push({
                        id: id.toString(),
                        operacaoId: id,
                        descricao: `Aporte previdência: ${ticker}`,
                        valor: valorAporte,
                        categoria: 'investimento_fixo',
                        mes: cursor.getMonth(),
                        ano: cursor.getFullYear(),
                        data: cursor.toISOString(),
                        pago: true,
                        gerado: true
                    });
                    cursor = avancarMesParaDia(cursor, diaRec);
                }
            });

            if(novosAportes.length > 0) {
                historicoCompras.push(...novosAportes);
                transacoes.push(...novasTransacoes);
                localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));
                localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
                if(typeof mostrarToast === 'function') {
                    mostrarToast(`${novosAportes.length} aporte${novosAportes.length === 1 ? '' : 's'} de previdência lançado${novosAportes.length === 1 ? '' : 's'} retroativamente.`, 'info');
                }
            }
            return novosAportes.length;
        }

        const ROTULOS_CATEGORIA = {
            renda_variavel: 'Renda Variável',
            renda_fixa: 'Renda Fixa',
            previdencia: 'Previdência',
            reserva_emergencia: 'Reserva de Emergência'
        };
        const CORES_CATEGORIA = {
            renda_variavel: '#2563eb',
            renda_fixa: '#059669',
            previdencia: '#7c3aed',
            reserva_emergencia: '#d97706'
        };

        // Filtro ativo de categoria na sub-aba Carteira
        let filtroCategoriaAtivo = '';

        function filtrarCarteiraPorCategoria(categoria) {
            filtroCategoriaAtivo = categoria || '';
            document.querySelectorAll('.chip-cat').forEach(c => c.classList.toggle('ativo', (c.dataset.cat || '') === filtroCategoriaAtivo));
            atualizarCarteiraAtivos();
        }

        // Inferi a categoria efetiva do ativo (operação > mock > fallback)
        function inferirCategoria(ticker, ativoConsolidado, ativoMercado) {
            if(ativoConsolidado?.categoria) return ativoConsolidado.categoria;
            if(ativoMercado?.tipo === 'Renda Fixa') return 'renda_fixa';
            return 'renda_variavel';
        }

        // ============================================================
        // === KPI: Próximo evento (foco em dividendos do mês corrente) ===
        // ============================================================
        // Cache global dos dividendos previstos do mês corrente, para abrir o modal detalhado.
        let dividendosPrevistosMes = [];

        function atualizarProximoEvento(carteiraConsolidada) {
            const valorEl = document.getElementById('resumoProximoEvento');
            const detEl = document.getElementById('resumoProximoEventoDetalhe');
            const titEl = document.getElementById('tituloProximoEvento');
            if(!valorEl) return;
            const hoje = new Date();
            const mesIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1).getTime();
            const mesFim = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0, 23, 59, 59).getTime();

            // Parser à prova de timezone para datas no formato YYYY-MM-DD
            const parsePagTs = s => new Date(s && s.length === 10 ? s + 'T12:00:00' : s).getTime();

            // Dividendos previstos no mês corrente — considera tanto pagamentos já registrados
            // no mês quanto a previsão (último pagamento + intervalo médio).
            const previstos = [];
            for(const ticker in carteiraConsolidada) {
                const ativo = carteiraConsolidada[ticker];
                if(ativo.qtdTotal <= 0) continue;
                const cache = cacheDividendos[ticker];
                if(!cache || !cache.pagamentos || cache.pagamentos.length === 0) continue;
                const datasOrd = cache.pagamentos.map(p => parsePagTs(p.data)).sort((a,b) => a - b);
                const ultimo = datasOrd[datasOrd.length - 1];
                if(!ultimo) continue;

                // Se o último pagamento já caiu no mês corrente, é o "evento" do mês.
                const ultimoPag = cache.pagamentos.find(p => parsePagTs(p.data) === ultimo);
                let proximoTs;
                let qtdEvento;
                if(ultimo >= mesIni && ultimo <= mesFim) {
                    proximoTs = ultimo;
                    // Já realizado: usa qty na DATA DO PAGAMENTO (e não a posição atual),
                    // para refletir o que de fato caiu/cai considerando compras posteriores.
                    qtdEvento = ultimoPag ? qtdNaData(ticker, ultimoPag.data) : ativo.qtdTotal;
                } else {
                    let intervaloDias = 30;
                    if(datasOrd.length >= 2) {
                        const diffs = [];
                        for(let i = 1; i < datasOrd.length; i++) diffs.push(datasOrd[i] - datasOrd[i-1]);
                        intervaloDias = Math.round((diffs.reduce((a,b)=>a+b,0)/diffs.length) / (24*60*60*1000));
                    }
                    if(!intervaloDias || intervaloDias < 1) intervaloDias = 30;
                    proximoTs = ultimo + intervaloDias * 24*60*60*1000;
                    let guarda = 0;
                    while(proximoTs < mesIni && guarda++ < 60) proximoTs += intervaloDias * 24*60*60*1000;
                    if(proximoTs > mesFim) continue;
                    // Previsão futura: posição atual é a melhor estimativa.
                    qtdEvento = ativo.qtdTotal;
                }
                if(qtdEvento <= 0) continue;
                const valorPorAcao = ultimoPag ? ultimoPag.valor : 0;
                const valorEstim = valorPorAcao * qtdEvento;
                previstos.push({ ticker, ts: proximoTs, valor: valorEstim, valorPorAcao, qtd: qtdEvento });
            }
            dividendosPrevistosMes = previstos.slice().sort((a,b) => a.ts - b.ts);

            // Vencimentos no mês
            const vencimentosMes = [];
            for(const ticker in carteiraConsolidada) {
                const ativo = carteiraConsolidada[ticker];
                if(ativo.qtdTotal <= 0 || !ativo.vencimento) continue;
                const tsVenc = new Date(ativo.vencimento + 'T12:00:00').getTime();
                if(tsVenc < mesIni || tsVenc > mesFim) continue;
                vencimentosMes.push({ ticker, ts: tsVenc });
            }

            const nomeMes = hoje.toLocaleDateString('pt-BR', { month: 'long' });
            const totalPrevisto = previstos.reduce((a,b)=>a+b.valor, 0);
            const card = document.getElementById('cardProximoEvento');
            const iconAbrir = document.getElementById('iconAbrirDividendosMes');
            if(previstos.length > 0) {
                titEl.innerHTML = '<i class="ph ph-coins"></i> Dividendos do mês';
                valorEl.innerText = formatarMoeda(totalPrevisto);
                const tickersResumo = previstos.map(p => p.ticker).slice(0,3).join(', ');
                const sufixo = previstos.length > 3 ? ` +${previstos.length - 3}` : '';
                detEl.innerText = `${previstos.length} ativo${previstos.length===1?'':'s'} previsto${previstos.length===1?'':'s'} em ${nomeMes} · ${tickersResumo}${sufixo} · clique para detalhar`;
                if(card) {
                    card.style.cursor = 'pointer';
                    card.onclick = abrirModalDividendosMes;
                    card.setAttribute('role', 'button');
                    card.setAttribute('tabindex', '0');
                    card.title = 'Ver tabela com os dividendos previstos do mês';
                }
                if(iconAbrir) iconAbrir.style.display = 'inline-block';
            } else if(vencimentosMes.length > 0) {
                titEl.innerHTML = '<i class="ph ph-calendar-check"></i> Vencimento RF';
                vencimentosMes.sort((a,b) => a.ts - b.ts);
                const prox = vencimentosMes[0];
                valorEl.innerText = prox.ticker;
                detEl.innerText = `Vence ${new Date(prox.ts).toLocaleDateString('pt-BR')} · ${vencimentosMes.length} no mês`;
                if(card) { card.style.cursor = ''; card.onclick = null; card.removeAttribute('role'); card.removeAttribute('tabindex'); card.title = ''; }
                if(iconAbrir) iconAbrir.style.display = 'none';
            } else {
                titEl.innerHTML = '<i class="ph ph-calendar-check"></i> Próximo evento';
                valorEl.innerText = '—';
                detEl.innerText = `Sem dividendos previstos em ${nomeMes}.`;
                if(card) { card.style.cursor = ''; card.onclick = null; card.removeAttribute('role'); card.removeAttribute('tabindex'); card.title = ''; }
                if(iconAbrir) iconAbrir.style.display = 'none';
            }
        }

        function abrirModalDividendosMes() {
            const modal = document.getElementById('modalDividendosMes');
            if(!modal) return;
            const corpo = document.getElementById('corpoModalDividendosMes');
            const rodape = document.getElementById('rodapeModalDividendosMes');
            const subtitulo = document.getElementById('subtituloModalDividendosMes');
            const msgVazia = document.getElementById('msgVaziaModalDividendosMes');
            const lista = (dividendosPrevistosMes || []).slice();
            const hoje = new Date();
            const nomeMes = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            if(subtitulo) subtitulo.innerText = `Estimativa baseada no último pagamento de cada ativo · ${nomeMes}`;
            if(lista.length === 0) {
                corpo.innerHTML = '';
                rodape.innerHTML = '';
                if(msgVazia) msgVazia.style.display = 'block';
            } else {
                if(msgVazia) msgVazia.style.display = 'none';
                corpo.innerHTML = lista.map(p => {
                    const dataLbl = new Date(p.ts).toLocaleDateString('pt-BR');
                    return `<tr>
                        <td>
                            <div style="font-weight:600;font-family:'DM Mono',monospace;">${p.ticker}</div>
                            <div style="font-size:11px;color:var(--cor-texto-mutado);">Pagamento previsto ${dataLbl}</div>
                        </td>
                        <td style="text-align:right;font-family:'DM Mono',monospace;">${formatarMoeda(p.valorPorAcao)}</td>
                        <td style="text-align:right;font-family:'DM Mono',monospace;">${formatarQtd(p.qtd)}</td>
                        <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--cor-primaria);" class="valor-mascarado">${formatarMoeda(p.valor)}</td>
                    </tr>`;
                }).join('');
                const total = lista.reduce((s,p) => s + p.valor, 0);
                rodape.innerHTML = `<tr>
                    <td colspan="3" style="text-align:right;font-weight:700;padding-top:10px;border-top:1px solid var(--cor-borda);">Total previsto</td>
                    <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:800;color:var(--cor-primaria);padding-top:10px;border-top:1px solid var(--cor-borda);" class="valor-mascarado">${formatarMoeda(total)}</td>
                </tr>`;
            }
            modal.style.display = 'flex';
        }

        function fecharModalDividendosMes() {
            const modal = document.getElementById('modalDividendosMes');
            if(modal) modal.style.display = 'none';
        }

        // ============================================================
        // === EVOLUÇÃO MENSAL — calcula séries a partir do histórico ===
        // ============================================================
        // Período do gráfico: 3, 6, 12 meses ou 0 (todos)
        let periodoEvolucao = 3;
        let chartEvolucaoCarteira = null;
        let chartDistribuicaoCarteira = null;

        function setPeriodoEvolucao(meses) {
            periodoEvolucao = meses;
            document.querySelectorAll('.period-pill').forEach(b => {
                const ativo = parseInt(b.dataset.periodo,10) === meses;
                b.classList.toggle('ativo', ativo);
            });
            renderizarGraficoEvolucao();
            atualizarChipDividendosPeriodo();
        }

        function rotuloPeriodoEvolucao() {
            if(periodoEvolucao === 0) return 'tudo';
            return `${periodoEvolucao}M`;
        }

        function atualizarChipDividendosPeriodo() {
            const elDiv = document.getElementById('resumoDividendosAcum');
            const elPer = document.getElementById('resumoDividendosPeriodo');
            if(elPer) elPer.innerText = `(${rotuloPeriodoEvolucao()})`;
            if(!elDiv) return;
            // Soma os mesmos pagamentos exibidos na tabela "Pagamentos recentes",
            // recortados pelo período do gráfico (3M/6M/12M/Tudo) e pelos filtros
            // de tipo/ativo. Garante consistência entre o KPI, a tabela e o gráfico.
            let limiteIniMs = 0;
            if(periodoEvolucao > 0) {
                const hoje = new Date();
                const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - (periodoEvolucao - 1), 1);
                limiteIniMs = inicio.getTime();
            }
            const filtroTipo = document.getElementById('filtroEvolucaoTipo')?.value || 'todos';
            const filtroAtivo = document.getElementById('filtroEvolucaoAtivo')?.value || '';
            const carteiraConsolidada = (typeof obterResumoCarteira === 'function') ? obterResumoCarteira() : {};
            const totalDiv = (pagamentosMensaisAgregados || [])
                .filter(p => limiteIniMs === 0 || new Date(p.ano, p.mes, 1).getTime() >= limiteIniMs)
                .filter(p => {
                    const ativo = carteiraConsolidada[p.ticker];
                    const am = mockAtivosMercado.find(a => a.ticker === p.ticker);
                    return ativoEntraNoFiltroEvolucao(p.ticker, ativo, am, filtroTipo, filtroAtivo);
                })
                .reduce((s, p) => s + (p.total || 0), 0);
            elDiv.innerText = formatarMoeda(totalDiv);
        }

        // Critério único de filtro do bloco "Evolução do Patrimônio" (tipo + ativo).
        function ativoEntraNoFiltroEvolucao(ticker, ativo, ativoMercado, filtroTipo, filtroAtivo) {
            if(filtroAtivo && (ticker || '').toUpperCase() !== filtroAtivo.toUpperCase()) return false;
            if(!filtroTipo || filtroTipo === 'todos') return true;
            const cat = ativo?.categoria || (ativoMercado?.tipo === 'Renda Fixa' ? 'renda_fixa' : 'renda_variavel');
            if(filtroTipo === 'renda_fixa') return cat === 'renda_fixa';
            if(filtroTipo === 'previdencia') return cat === 'previdencia';
            if(filtroTipo === 'reserva_emergencia') return cat === 'reserva_emergencia';
            if(cat !== 'renda_variavel') return false;
            const sub = ativo?.subcategoria || subcategoriaInferidaDoTicker(ticker) || (ativoMercado ? tipoMercadoParaSubcategoria(ativoMercado.tipo) : null);
            return sub === filtroTipo;
        }

        // Início do período de evolução. Retorna null se "Tudo".
        function dataInicioPeriodoEvolucao() {
            if(periodoEvolucao <= 0) return null;
            const hoje = new Date();
            return new Date(hoje.getFullYear(), hoje.getMonth() - (periodoEvolucao - 1), 1);
        }

        // Aportes líquidos (compras − vendas) dentro do período, respeitando filtros.
        function aportesLiquidosNoPeriodo(carteiraConsolidada, dataInicio, filtroTipo, filtroAtivo) {
            const inicioMs = dataInicio ? dataInicio.getTime() : 0;
            let aplicado = 0;
            historicoCompras.forEach(op => {
                if(!op.data_op) return;
                const tsOp = new Date(op.data_op).getTime();
                if(inicioMs > 0 && tsOp < inicioMs) return;
                const ativoOp = carteiraConsolidada[op.ticker];
                const am = mockAtivosMercado.find(a => a.ticker === op.ticker);
                const ativoFake = ativoOp || { categoria: op.categoria, subcategoria: op.subcategoria };
                if(!ativoEntraNoFiltroEvolucao(op.ticker, ativoFake, am, filtroTipo, filtroAtivo)) return;
                const tipo = op.tipo || 'compra';
                const preco = op.preco_op || op.preco_pago || 0;
                const valor = (op.quantidade || 1) * preco;
                if(tipo === 'compra') aplicado += valor;
                else if(tipo === 'venda') aplicado -= valor;
            });
            return aplicado;
        }

        // Patrimônio reconstruído numa data, respeitando filtros (preços usam o atual
        // de mercado por limitação de séries históricas — assume preços estáveis).
        function patrimonioNaData(dataLimite, filtroTipo, filtroAtivo) {
            const limiteMs = dataLimite ? dataLimite.getTime() : 0;
            if(limiteMs <= 0) return 0;
            const consolidado = consolidarCarteiraNaData(limiteMs);
            let patrim = 0;
            for(const ticker in consolidado) {
                const ativo = consolidado[ticker];
                if(ativo.qtdTotal <= 0) continue;
                const am = mockAtivosMercado.find(a => a.ticker === ticker);
                if(!ativoEntraNoFiltroEvolucao(ticker, ativo, am, filtroTipo, filtroAtivo)) continue;
                if(ativo.categoria === 'previdencia') {
                    patrim += calcularSaldoPrevidencia(ticker, limiteMs);
                } else {
                    const precoAtual = am ? am.preco_atual : ativo.precoMedio;
                    patrim += ativo.qtdTotal * precoAtual;
                }
            }
            return patrim;
        }

        // Atualiza os KPIs do hero (Patrimônio atual, Capital aplicado, Ganho capital,
        // chip de Dividendos, "desde X") com base nos filtros do bloco Evolução.
        function atualizarKPIsResumo(carteiraConsolidada) {
            if(!carteiraConsolidada) carteiraConsolidada = obterResumoCarteira();
            const filtroTipo = document.getElementById('filtroEvolucaoTipo')?.value || 'todos';
            const filtroAtivo = document.getElementById('filtroEvolucaoAtivo')?.value || '';

            let investTotal = 0, patrim = 0, totalAtivos = 0;
            for(const ticker in carteiraConsolidada) {
                const ativo = carteiraConsolidada[ticker];
                if(ativo.qtdTotal <= 0) continue;
                const ativoMercado = mockAtivosMercado.find(a => a.ticker === ticker);
                if(!ativoEntraNoFiltroEvolucao(ticker, ativo, ativoMercado, filtroTipo, filtroAtivo)) continue;
                totalAtivos++;
                investTotal += ativo.valorTotalInvestido;
                let saldo;
                if(ativo.categoria === 'previdencia') {
                    saldo = calcularSaldoPrevidencia(ticker);
                } else {
                    const precoAtual = ativoMercado ? ativoMercado.preco_atual : ativo.precoMedio;
                    saldo = ativo.qtdTotal * precoAtual;
                }
                patrim += saldo;
            }

            // === Cálculos sensíveis ao período ===========================
            // "Tudo" (periodoEvolucao = 0): comportamento original (visão lifetime).
            // Período definido (1M/3M/6M/12M): KPIs refletem só a janela.
            const dataIni = dataInicioPeriodoEvolucao();
            let aplicado, ganhoR$, baseRent;
            if(dataIni) {
                // Patrimônio no fim do dia anterior ao início do período
                const dataPreInicio = new Date(dataIni.getTime() - 1);
                const patrimInicio = patrimonioNaData(dataPreInicio, filtroTipo, filtroAtivo);
                aplicado = aportesLiquidosNoPeriodo(carteiraConsolidada, dataIni, filtroTipo, filtroAtivo);
                // Variação de valor das holdings no período, descontando dinheiro novo
                ganhoR$ = (patrim - patrimInicio) - aplicado;
                baseRent = patrimInicio + Math.max(0, aplicado);
            } else {
                aplicado = investTotal;
                ganhoR$ = patrim - investTotal;
                baseRent = investTotal;
            }
            const lucroPerc = baseRent > 0 ? (ganhoR$ / baseRent) * 100 : 0;
            // =============================================================

            const elPat = document.getElementById('resumoPatrimonio');
            if(elPat) elPat.innerText = formatarMoeda(patrim);
            const elInv = document.getElementById('resumoInvestido');
            if(elInv) elInv.innerText = formatarMoeda(aplicado);

            const cardRend = document.getElementById('resumoRendimento');
            const cardRent = document.getElementById('resumoRentabilidade');
            const titRend = document.getElementById('tituloRendimento');
            if(cardRend) {
                cardRend.innerText = `${ganhoR$ >= 0 ? '+' : ''}${formatarMoeda(ganhoR$)}`;
                cardRend.style.color = ganhoR$ < 0 ? 'var(--cor-erro)' : 'var(--cor-primaria)';
            }
            if(cardRent) cardRent.innerText = `${ganhoR$ >= 0 ? '+' : ''}${lucroPerc.toFixed(2)}%`;
            if(titRend) {
                titRend.style.color = '';
                titRend.innerText = dataIni ? `Ganho capital (${rotuloPeriodoEvolucao()})` : 'Ganho capital';
            }

            const badgeTend = document.getElementById('resumoRentabilidadeBadge');
            const iconTend = document.getElementById('iconResumoRent');
            if(badgeTend && iconTend) {
                badgeTend.classList.toggle('neg', ganhoR$ < 0);
                iconTend.className = ganhoR$ >= 0 ? 'ph-bold ph-arrow-up' : 'ph-bold ph-arrow-down';
            }

            // Detalhe "desde X" — quando há período, mostra a janela; senão, 1ª compra do filtro
            const elDesde = document.getElementById('kpiInvestidoDesde');
            if(elDesde) {
                if(dataIni) {
                    const lblIni = dataIni.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '');
                    elDesde.innerText = `aportes desde ${lblIni} (${rotuloPeriodoEvolucao()})`;
                } else {
                    const datasFiltradas = historicoCompras
                        .filter(o => o.tipo !== 'venda' && o.data_op)
                        .filter(o => {
                            const ativoOp = carteiraConsolidada[o.ticker];
                            const am = mockAtivosMercado.find(a => a.ticker === o.ticker);
                            const ativoFake = ativoOp || { categoria: o.categoria, subcategoria: o.subcategoria };
                            return ativoEntraNoFiltroEvolucao(o.ticker, ativoFake, am, filtroTipo, filtroAtivo);
                        })
                        .map(o => o.data_op).sort();
                    if(datasFiltradas.length) {
                        const d = new Date(datasFiltradas[0]);
                        if(!isNaN(d.getTime())) {
                            const lbl = d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '');
                            elDesde.innerText = `desde ${lbl}`;
                        } else {
                            elDesde.innerText = 'desde sua 1ª compra';
                        }
                    } else {
                        elDesde.innerText = 'Sem operações ainda';
                    }
                }
            }

            atualizarChipDividendosPeriodo();
        }

        // Acumula posição (qtd) por ticker até o final de cada mês
        function calcularSerieEvolucao(filtroTipo, filtroAtivo) {
            // Decide se uma operação entra no filtro escolhido
            function opEntraNoFiltro(op) {
                if(filtroAtivo && (op.ticker || '').toUpperCase() !== filtroAtivo.toUpperCase()) return false;
                if(!filtroTipo || filtroTipo === 'todos') return true;
                const cat = op.categoria || 'renda_variavel';
                if(filtroTipo === 'renda_fixa') return cat === 'renda_fixa';
                if(filtroTipo === 'previdencia') return cat === 'previdencia';
                if(filtroTipo === 'reserva_emergencia') return cat === 'reserva_emergencia';
                // Demais: subcategorias de RV
                if(cat !== 'renda_variavel') return false;
                const ativoMercado = mockAtivosMercado.find(a => a.ticker === op.ticker);
                const sub = op.subcategoria || subcategoriaInferidaDoTicker(op.ticker) || (ativoMercado ? tipoMercadoParaSubcategoria(ativoMercado.tipo) : null);
                return sub === filtroTipo;
            }
            const opsFiltradas = historicoCompras.filter(op => op.data_op && opEntraNoFiltro(op));
            if(opsFiltradas.length === 0) return { meses: [], investido: [], mercado: [], dividendos: [] };

            // Determina mês inicial e final
            const tsPrimeira = Math.min(...opsFiltradas.map(op => new Date(op.data_op).getTime()));
            const dPrimeira = new Date(tsPrimeira);
            let mesIni = new Date(dPrimeira.getFullYear(), dPrimeira.getMonth(), 1);
            const hoje = new Date();
            const mesFim = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

            // Limitar pelo período selecionado
            if(periodoEvolucao > 0) {
                const limite = new Date(hoje.getFullYear(), hoje.getMonth() - (periodoEvolucao - 1), 1);
                if(limite > mesIni) mesIni = limite;
            }

            const meses = [];
            const cursor = new Date(mesIni);
            while(cursor <= mesFim) {
                meses.push(new Date(cursor));
                cursor.setMonth(cursor.getMonth() + 1);
            }

            const investido = []; const mercado = []; const dividendos = [];
            meses.forEach(m => {
                const fimMes = new Date(m.getFullYear(), m.getMonth() + 1, 0, 23, 59, 59).getTime();
                // Posição cumulativa por ticker até o fim do mês
                const posicao = {}; let invest = 0;
                opsFiltradas.forEach(op => {
                    const tsOp = new Date(op.data_op).getTime();
                    if(tsOp > fimMes) return;
                    const tipo = op.tipo || 'compra';
                    const preco = op.preco_op || op.preco_pago || 0;
                    if(!posicao[op.ticker]) posicao[op.ticker] = { qtd: 0, custo: 0, pm: 0 };
                    const p = posicao[op.ticker];
                    if(tipo === 'compra') {
                        p.qtd += op.quantidade;
                        p.custo += op.quantidade * preco;
                        p.pm = p.qtd > 0 ? p.custo / p.qtd : 0;
                        invest += op.quantidade * preco;
                    } else if(tipo === 'venda') {
                        invest -= op.quantidade * p.pm;
                        p.qtd -= op.quantidade;
                        p.custo -= op.quantidade * p.pm;
                    }
                });
                // Valor de mercado — usa preço atual (limitação: sem histórico de preços)
                let valorMercado = 0;
                Object.entries(posicao).forEach(([ticker, p]) => {
                    if(p.qtd <= 0) return;
                    const opTicker = opsFiltradas.find(o => o.ticker === ticker);
                    const cat = opTicker?.categoria;
                    if(cat === 'previdencia') {
                        valorMercado += calcularSaldoPrevidencia(ticker, fimMes);
                    } else {
                        const ativoMercado = mockAtivosMercado.find(a => a.ticker === ticker);
                        const precoAtual = ativoMercado ? ativoMercado.preco_atual : p.pm;
                        valorMercado += p.qtd * precoAtual;
                    }
                });
                investido.push(Math.max(0, invest));
                mercado.push(Math.max(0, valorMercado));

                // Dividendos do mês: pagamentos do cacheDividendos onde data está no mês e o ticker está nas opsFiltradas.
                // Parser fixa hora 12:00 para evitar deslocamento de fuso (ex: 2026-04-01 caindo em março em GMT-3).
                // Usa qty na DATA DO PAGAMENTO (não no fim do mês) para não creditar dividendos
                // sobre cotas compradas após a data-com nem ignorar cotas vendidas após o pagamento.
                let div = 0;
                const tickersFiltrados = new Set(opsFiltradas.map(o => o.ticker));
                tickersFiltrados.forEach(ticker => {
                    const cache = cacheDividendos[ticker];
                    if(!cache || !cache.pagamentos) return;
                    cache.pagamentos.forEach(pag => {
                        if(!pag.data) return;
                        const tsPag = new Date(pag.data.length === 10 ? pag.data + 'T12:00:00' : pag.data).getTime();
                        const iniMes = new Date(m.getFullYear(), m.getMonth(), 1).getTime();
                        if(tsPag < iniMes || tsPag > fimMes) return;
                        const qtdNoPag = qtdNaData(ticker, pag.data);
                        if(qtdNoPag <= 0) return;
                        div += qtdNoPag * pag.valor;
                    });
                });
                dividendos.push(div);
            });

            return { meses, investido, mercado, dividendos };
        }

        // ============================================================
        // === TEMA DOS GRÁFICOS — alinhado ao design system          ===
        // ============================================================
        function getToken(nome) {
            return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
        }

        function aplicarTemaChartJs() {
            if(typeof Chart === 'undefined') return;
            Chart.defaults.font.family = "'Figtree', system-ui, -apple-system, sans-serif";
            Chart.defaults.font.size = 11;
            Chart.defaults.color = getToken('--cor-texto-secundario');
            Chart.defaults.borderColor = getToken('--cor-borda');
            Chart.defaults.plugins.tooltip.backgroundColor = getToken('--cor-texto-principal');
            Chart.defaults.plugins.tooltip.titleColor = getToken('--cor-branco');
            Chart.defaults.plugins.tooltip.bodyColor = getToken('--cor-branco');
            Chart.defaults.plugins.tooltip.titleFont = { family: "'Figtree', sans-serif", size: 12, weight: '600' };
            Chart.defaults.plugins.tooltip.bodyFont = { family: "'DM Mono', monospace", size: 11 };
            Chart.defaults.plugins.tooltip.padding = 10;
            Chart.defaults.plugins.tooltip.cornerRadius = 8;
            Chart.defaults.plugins.tooltip.boxPadding = 4;
            Chart.defaults.plugins.tooltip.displayColors = true;
        }

        // Paleta da carteira: verde monocromático para Renda Variável + acentos por classe
        function paletaCarteira() {
            const dark = document.body.classList.contains('dark');
            return {
                acoes:              dark ? '#34d399' : '#059669',
                fiis:               dark ? '#6ee7b7' : '#10b981',
                bdrs:               dark ? '#a7f3d0' : '#047857',
                etfs:               dark ? '#10b981' : '#34d399',
                cripto:             getToken('--cor-cartao'),
                renda_fixa:         getToken('--cor-info'),
                previdencia:        dark ? '#a78bfa' : '#7c3aed',
                reserva_emergencia: getToken('--cor-texto-mutado')
            };
        }

        function corComAlpha(hex, alpha) {
            const h = hex.replace('#','');
            if(h.length !== 6) return hex;
            const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
            return `rgba(${r},${g},${b},${alpha})`;
        }

        function renderLegendaChart(containerId, itens) {
            const c = document.getElementById(containerId);
            if(!c) return;
            c.innerHTML = itens.map(it =>
                `<span class="chip-legenda"><span class="dot" style="background:${it.cor}"></span>${it.label}</span>`
            ).join('');
        }

        // Tooltip HTML do gráfico de evolução
        function evolucaoHtmlTooltip(context) {
            const tooltipModel = context.tooltip;
            let el = document.getElementById('chart-tooltip-evolucao');
            if(!el) {
                el = document.createElement('div');
                el.id = 'chart-tooltip-evolucao';
                el.className = 'chart-tooltip-card';
                document.body.appendChild(el);
            }
            if(!tooltipModel || tooltipModel.opacity === 0) {
                el.style.opacity = 0;
                return;
            }
            const idx = tooltipModel.dataPoints?.[0]?.dataIndex;
            if(idx === undefined) { el.style.opacity = 0; return; }

            const ds = context.chart.data.datasets;
            const aplicado = ds[0].data[idx] || 0;
            const ganho    = ds[1].data[idx] || 0;
            const perda    = ds[2].data[idx] || 0; // negativo
            const div      = ds[3]?.data[idx]  || 0;
            const patrimonio = aplicado + ganho + perda;
            const variacaoR$ = ganho + perda;
            const variacaoPerc = aplicado > 0 ? (variacaoR$ / aplicado) * 100 : 0;
            const corVar = variacaoR$ >= 0 ? 'var(--cor-primaria)' : 'var(--cor-erro)';
            const sinal = variacaoR$ >= 0 ? '+' : '';

            const linhas = [];
            linhas.push(`<div class="ttip-row ttip-total"><span>Patrimônio</span><strong>${formatarMoeda(patrimonio)}</strong></div>`);
            linhas.push(`<div class="ttip-divider"></div>`);
            linhas.push(`<div class="ttip-row"><span><span class="ttip-dot" style="background:var(--cor-primaria)"></span>Capital aplicado</span><span>${formatarMoeda(aplicado)}</span></div>`);
            if(ganho > 0) linhas.push(`<div class="ttip-row"><span><span class="ttip-dot" style="background:var(--cor-primaria);opacity:0.4"></span>Ganho capital</span><span style="color:var(--cor-primaria)">+${formatarMoeda(ganho)}</span></div>`);
            if(perda < 0) linhas.push(`<div class="ttip-row"><span><span class="ttip-dot" style="background:var(--cor-erro)"></span>Perda capital</span><span style="color:var(--cor-erro)">${formatarMoeda(perda)}</span></div>`);
            if(div > 0)   linhas.push(`<div class="ttip-row"><span><span class="ttip-dot" style="background:var(--cor-info)"></span>Dividendos</span><span style="color:var(--cor-info)">+${formatarMoeda(div)}</span></div>`);
            linhas.push(`<div class="ttip-divider"></div>`);
            linhas.push(`<div class="ttip-row"><span>Variação no mês</span><strong style="color:${corVar}">${sinal}${variacaoPerc.toFixed(2)}%</strong></div>`);

            el.innerHTML = `<div class="ttip-titulo">${tooltipModel.title?.[0] || ''}</div>${linhas.join('')}`;

            const pos = context.chart.canvas.getBoundingClientRect();
            el.style.opacity = 1;
            el.style.left = (pos.left + window.pageXOffset + tooltipModel.caretX) + 'px';
            el.style.top  = (pos.top  + window.pageYOffset + tooltipModel.caretY) + 'px';
            el.style.transform = 'translate(-50%, calc(-100% - 12px))';
        }

        // Popula o dropdown "Filtrar por ativo" com os tickers já operados,
        // respeitando também o filtro de tipo selecionado.
        function atualizarOpcoesFiltroAtivoEvolucao() {
            const sel = document.getElementById('filtroEvolucaoAtivo');
            if(!sel) return;
            const filtroTipo = document.getElementById('filtroEvolucaoTipo')?.value || 'todos';
            const valorAtual = sel.value;
            // Reaproveita a mesma lógica de filtro de tipo
            function tickerEntraNoTipo(op) {
                if(!filtroTipo || filtroTipo === 'todos') return true;
                const cat = op.categoria || 'renda_variavel';
                if(filtroTipo === 'renda_fixa') return cat === 'renda_fixa';
                if(filtroTipo === 'previdencia') return cat === 'previdencia';
                if(filtroTipo === 'reserva_emergencia') return cat === 'reserva_emergencia';
                if(cat !== 'renda_variavel') return false;
                const am = mockAtivosMercado.find(a => a.ticker === op.ticker);
                const sub = op.subcategoria || subcategoriaInferidaDoTicker(op.ticker) || (am ? tipoMercadoParaSubcategoria(am.tipo) : null);
                return sub === filtroTipo;
            }
            const tickers = Array.from(new Set(
                historicoCompras.filter(o => o.ticker && tickerEntraNoTipo(o)).map(o => (o.ticker || '').toUpperCase())
            )).sort();
            sel.innerHTML = '<option value="">Todos os ativos</option>' +
                tickers.map(t => `<option value="${t}">${t}</option>`).join('');
            // Mantém seleção se ainda existir; caso contrário, volta a "todos"
            if(tickers.includes(valorAtual.toUpperCase())) sel.value = valorAtual.toUpperCase();
            else sel.value = '';
        }

        function renderizarGraficoEvolucao() {
            const canvas = document.getElementById('graficoEvolucaoCarteira');
            const msgVazia = document.getElementById('msgEvolucaoVazia');
            const legendaEl = document.getElementById('legendaEvolucao');
            if(!canvas) return;

            // Esconde o tooltip HTML quando o mouse sai do canvas
            if(!canvas.dataset.tooltipBound) {
                canvas.addEventListener('mouseleave', () => {
                    const tt = document.getElementById('chart-tooltip-evolucao');
                    if(tt) tt.style.opacity = 0;
                });
                canvas.dataset.tooltipBound = '1';
            }

            const filtro = document.getElementById('filtroEvolucaoTipo')?.value || 'todos';
            const filtroAtivo = document.getElementById('filtroEvolucaoAtivo')?.value || '';
            atualizarOpcoesFiltroAtivoEvolucao();
            // Filtros do gráfico também governam os KPIs do hero
            if(typeof atualizarKPIsResumo === 'function') atualizarKPIsResumo();
            const serie = calcularSerieEvolucao(filtro, filtroAtivo);

            if(serie.meses.length === 0) {
                if(chartEvolucaoCarteira) { chartEvolucaoCarteira.destroy(); chartEvolucaoCarteira = null; }
                canvas.style.display = 'none';
                if(legendaEl) legendaEl.innerHTML = '';
                if(msgVazia) msgVazia.style.display = 'block';
                return;
            }
            canvas.style.display = 'block';
            if(msgVazia) msgVazia.style.display = 'none';

            const labels = serie.meses.map(d => d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '').toUpperCase());
            const aplicado     = serie.investido.slice();
            const ganhoCapital = serie.mercado.map((v,i) => Math.max(0, v - serie.investido[i]));
            const perdaCapital = serie.mercado.map((v,i) => Math.min(0, v - serie.investido[i]));
            const dividendos   = serie.dividendos.slice();
            const temDividendos = dividendos.some(v => v > 0);
            const temPerdas     = perdaCapital.some(v => v < 0);

            const ctx = canvas.getContext('2d');
            const corPrimaria = getToken('--cor-primaria');
            const corErro     = getToken('--cor-erro');
            const corInfo     = getToken('--cor-info');
            const corGrid     = corComAlpha(getToken('--cor-borda'), 0.7);
            const altura = canvas.parentElement.clientHeight || 320;

            // Gradientes verticais para look "premium"
            const gradAplicado = ctx.createLinearGradient(0, 0, 0, altura);
            gradAplicado.addColorStop(0, corPrimaria);
            gradAplicado.addColorStop(1, corComAlpha(corPrimaria, 0.78));

            const gradGanho = ctx.createLinearGradient(0, 0, 0, altura);
            gradGanho.addColorStop(0, corComAlpha(corPrimaria, 0.55));
            gradGanho.addColorStop(1, corComAlpha(corPrimaria, 0.18));

            const gradPerda = ctx.createLinearGradient(0, 0, 0, altura);
            gradPerda.addColorStop(0, corComAlpha(corErro, 0.55));
            gradPerda.addColorStop(1, corComAlpha(corErro, 0.18));

            // Destaca o mês atual com leve borda na barra "Ganho capital"
            const hoje = new Date();
            const idxAtual = serie.meses.findIndex(d => d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth());
            const bordaTopoGanho = ganhoCapital.map((_, i) => i === idxAtual ? corPrimaria : 'transparent');
            const bordaTopoAplicado = aplicado.map((_, i) => (i === idxAtual && ganhoCapital[i] === 0) ? corPrimaria : 'transparent');

            if(chartEvolucaoCarteira) chartEvolucaoCarteira.destroy();
            chartEvolucaoCarteira = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Capital aplicado',
                            data: aplicado,
                            backgroundColor: gradAplicado,
                            borderColor: bordaTopoAplicado,
                            borderWidth: { top: 1.5, right: 0, bottom: 0, left: 0 },
                            borderRadius: ctxBar => {
                                const i = ctxBar.dataIndex;
                                if(ganhoCapital[i] > 0) return 0;
                                return { topLeft: 8, topRight: 8, bottomLeft: 0, bottomRight: 0 };
                            },
                            borderSkipped: false,
                            stack: 'patrimonio',
                            order: 3,
                            barPercentage: 0.78,
                            categoryPercentage: 0.85
                        },
                        {
                            label: 'Ganho capital',
                            data: ganhoCapital,
                            backgroundColor: gradGanho,
                            borderColor: bordaTopoGanho,
                            borderWidth: { top: 1.5, right: 0, bottom: 0, left: 0 },
                            borderRadius: { topLeft: 8, topRight: 8, bottomLeft: 0, bottomRight: 0 },
                            borderSkipped: false,
                            stack: 'patrimonio',
                            order: 2,
                            barPercentage: 0.78,
                            categoryPercentage: 0.85
                        },
                        {
                            label: 'Perda capital',
                            data: perdaCapital,
                            backgroundColor: gradPerda,
                            borderRadius: { bottomLeft: 8, bottomRight: 8, topLeft: 0, topRight: 0 },
                            borderSkipped: false,
                            stack: 'patrimonio',
                            order: 4,
                            barPercentage: 0.78,
                            categoryPercentage: 0.85
                        },
                        {
                            type: 'line',
                            label: 'Dividendos',
                            data: dividendos,
                            borderColor: corInfo,
                            backgroundColor: corComAlpha(corInfo, 0.08),
                            borderDash: [5, 4],
                            borderWidth: 2,
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            pointBackgroundColor: corInfo,
                            pointBorderColor: getToken('--cor-branco'),
                            pointBorderWidth: 1.5,
                            tension: 0.35,
                            yAxisID: 'yDividendos',
                            order: 0,
                            hidden: !temDividendos
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        datalabels: { display: false },
                        tooltip: { enabled: false, external: evolucaoHtmlTooltip }
                    },
                    scales: {
                        x: {
                            stacked: true,
                            grid: { display: false },
                            border: { display: false },
                            ticks: { font: { size: 10 }, color: getToken('--cor-texto-mutado') }
                        },
                        y: {
                            stacked: true,
                            ticks: {
                                callback: v => 'R$ ' + (Math.abs(v) >= 1000 ? (v/1000).toFixed(0) + 'k' : v.toFixed(0)),
                                font: { size: 10 },
                                color: getToken('--cor-texto-mutado')
                            },
                            grid: { color: corGrid, drawTicks: false },
                            border: { display: false }
                        },
                        yDividendos: {
                            display: false,
                            position: 'right',
                            beginAtZero: true,
                            grid: { display: false }
                        }
                    }
                }
            });

            const itensLegenda = [
                { label: 'Capital aplicado', cor: corPrimaria },
                { label: 'Ganho capital',    cor: corComAlpha(corPrimaria, 0.45) }
            ];
            if(temPerdas)     itensLegenda.push({ label: 'Perda capital', cor: corErro });
            if(temDividendos) itensLegenda.push({ label: 'Dividendos',    cor: corInfo });
            renderLegendaChart('legendaEvolucao', itensLegenda);
        }

        // ============================================================
        // === DISTRIBUIÇÃO — pizza por subcategoria/categoria        ===
        // ============================================================
        const ROTULOS_SUB = {
            acoes: 'Ações', fiis: 'FIIs', bdrs: 'BDRs', etfs: 'ETFs', cripto: 'Criptomoedas',
            renda_fixa: 'Renda Fixa', previdencia: 'Previdência', reserva_emergencia: 'Reserva de Emergência'
        };

        // Agrupa carteira em "categorias" finais (subcategorias de RV + RF/Prev/Reserva)
        function agruparCarteiraPorCategoria(carteiraConsolidada) {
            const grupos = {};
            for(const ticker in carteiraConsolidada) {
                const ativo = carteiraConsolidada[ticker];
                if(ativo.qtdTotal <= 0) continue;
                const ativoMercado = mockAtivosMercado.find(a => a.ticker === ticker);
                const cat = inferirCategoria(ticker, ativo, ativoMercado);
                let chave;
                if(cat === 'renda_variavel') chave = subcategoriaEfetiva(ticker, ativo, ativoMercado);
                else chave = cat;
                if(!grupos[chave]) grupos[chave] = { investido: 0, saldo: 0, ativos: [] };
                let saldo;
                if(cat === 'previdencia') {
                    saldo = calcularSaldoPrevidencia(ticker);
                } else {
                    const precoAtual = ativoMercado ? ativoMercado.preco_atual : ativo.precoMedio;
                    saldo = ativo.qtdTotal * precoAtual;
                }
                grupos[chave].investido += ativo.valorTotalInvestido;
                grupos[chave].saldo += saldo;
                grupos[chave].ativos.push(ticker);
            }
            return grupos;
        }

        // Reconstrói a carteira como ela estava no instante `dataLimiteMs`, considerando
        // apenas operações com `data_op` <= esse instante. Usado para variações por
        // categoria sem depender de snapshots persistidos (que ficam stale ao excluir ops).
        function consolidarCarteiraNaData(dataLimiteMs) {
            const consolidado = {};
            historicoCompras.forEach(op => {
                if(!op.data_op) return;
                if(new Date(op.data_op).getTime() > dataLimiteMs) return;
                if(!consolidado[op.ticker]) consolidado[op.ticker] = { qtdTotal: 0, valorTotalInvestido: 0, precoMedio: 0, categoria: null, subcategoria: null };
                const ativo = consolidado[op.ticker];
                const tipo = op.tipo || 'compra';
                const precoDaOp = op.preco_op || op.preco_pago || 0;
                if(tipo === 'compra') {
                    ativo.qtdTotal += op.quantidade;
                    ativo.valorTotalInvestido += op.quantidade * precoDaOp;
                    ativo.precoMedio = ativo.qtdTotal > 0 ? ativo.valorTotalInvestido / ativo.qtdTotal : 0;
                    if(op.categoria) ativo.categoria = op.categoria;
                    if(op.subcategoria) ativo.subcategoria = op.subcategoria;
                } else if(tipo === 'venda') {
                    ativo.qtdTotal -= op.quantidade;
                    ativo.valorTotalInvestido -= op.quantidade * ativo.precoMedio;
                }
            });
            return consolidado;
        }

        function agruparCategoriasNaData(dataLimiteMs) {
            const consolidado = consolidarCarteiraNaData(dataLimiteMs);
            const grupos = {};
            for(const ticker in consolidado) {
                const ativo = consolidado[ticker];
                if(ativo.qtdTotal <= 0) continue;
                const ativoMercado = mockAtivosMercado.find(a => a.ticker === ticker);
                const cat = inferirCategoria(ticker, ativo, ativoMercado);
                let chave;
                if(cat === 'renda_variavel') chave = subcategoriaEfetiva(ticker, ativo, ativoMercado);
                else chave = cat;
                if(!grupos[chave]) grupos[chave] = { investido: 0, saldo: 0, ativos: [] };
                let saldo;
                if(cat === 'previdencia') {
                    saldo = calcularSaldoPrevidencia(ticker, dataLimiteMs);
                } else {
                    const precoAtual = ativoMercado ? ativoMercado.preco_atual : ativo.precoMedio;
                    saldo = ativo.qtdTotal * precoAtual;
                }
                grupos[chave].investido += ativo.valorTotalInvestido;
                grupos[chave].saldo += saldo;
                grupos[chave].ativos.push(ticker);
            }
            return grupos;
        }

        function renderizarGraficoDistribuicao(carteiraConsolidada) {
            const canvas = document.getElementById('graficoDistribuicaoCarteira');
            const msgVazia = document.getElementById('msgDistribuicaoVazia');
            const donutCenter = document.getElementById('donutCenter');
            if(!canvas) return;
            const grupos = agruparCarteiraPorCategoria(carteiraConsolidada);
            const entries = Object.entries(grupos).filter(([,v]) => v.saldo > 0);
            if(entries.length === 0) {
                if(chartDistribuicaoCarteira) { chartDistribuicaoCarteira.destroy(); chartDistribuicaoCarteira = null; }
                canvas.style.display = 'none';
                if(donutCenter) donutCenter.style.display = 'none';
                if(msgVazia) msgVazia.style.display = 'block';
                return;
            }
            canvas.style.display = 'block';
            if(msgVazia) msgVazia.style.display = 'none';

            const paleta = paletaCarteira();
            const labels = entries.map(([k]) => ROTULOS_SUB[k] || k);
            const data = entries.map(([,v]) => v.saldo);
            const cores = entries.map(([k]) => paleta[k] || getToken('--cor-texto-mutado'));
            const total = data.reduce((a,b)=>a+b, 0);
            const corBorda = getToken('--cor-branco');

            if(chartDistribuicaoCarteira) chartDistribuicaoCarteira.destroy();
            chartDistribuicaoCarteira = new Chart(canvas.getContext('2d'), {
                type: 'doughnut',
                data: { labels, datasets: [{ data, backgroundColor: cores, borderWidth: 3, borderColor: corBorda, hoverOffset: 8 }] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        datalabels: {
                            color: '#fff',
                            font: { family: "'Figtree', sans-serif", weight: '700', size: 11 },
                            formatter: (v) => total > 0 ? `${(v/total*100).toFixed(1)}%` : '',
                            display: ctx => ctx.parsed > total * 0.06
                        },
                        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatarMoeda(ctx.parsed)} (${(ctx.parsed/total*100).toFixed(1)}%)` } }
                    },
                    cutout: '68%'
                }
            });

            renderLegendaChart('legendaDistribuicao',
                entries.map(([k]) => ({ label: ROTULOS_SUB[k] || k, cor: paleta[k] || getToken('--cor-texto-mutado') }))
            );

            // Insight no centro do donut: maior posição individual da carteira
            if(donutCenter) {
                let maiorTicker = null, maiorSaldo = 0;
                for(const ticker in carteiraConsolidada) {
                    const ativo = carteiraConsolidada[ticker];
                    if(ativo.qtdTotal <= 0) continue;
                    const ativoMercado = mockAtivosMercado.find(a => a.ticker === ticker);
                    const cat = inferirCategoria(ticker, ativo, ativoMercado);
                    let saldo;
                    if(cat === 'previdencia') saldo = calcularSaldoPrevidencia(ticker);
                    else saldo = ativo.qtdTotal * (ativoMercado ? ativoMercado.preco_atual : ativo.precoMedio);
                    if(saldo > maiorSaldo) { maiorSaldo = saldo; maiorTicker = ticker; }
                }
                if(maiorTicker && total > 0) {
                    const perc = (maiorSaldo / total) * 100;
                    document.getElementById('distMaiorPos').innerText = maiorTicker;
                    document.getElementById('distMaiorDetalhe').innerHTML = `${perc.toFixed(1)}% · <span class="valor-mascarado" style="font-family:'DM Mono',monospace;">${formatarMoeda(maiorSaldo)}</span>`;
                    donutCenter.style.display = 'block';
                } else {
                    donutCenter.style.display = 'none';
                }
            }
        }

        // ============================================================
        // === QUADRO INFERIOR — categorias com variação no mês       ===
        // ============================================================
        // Snapshot mensal: { "YYYY-MM": { saldoTotal, investidoTotal, porGrupo: { [chave]: saldo } } }
        function carregarSnapshotsCarteira() {
            try { return JSON.parse(localStorage.getItem('futurorico_carteira_snapshots') || '{}'); } catch { return {}; }
        }
        function salvarSnapshotsCarteira(snaps) {
            localStorage.setItem('futurorico_carteira_snapshots', JSON.stringify(snaps));
        }
        function chaveMesAtual() {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        }
        function atualizarSnapshotMesAtual(carteiraConsolidada) {
            const snaps = carregarSnapshotsCarteira();
            const chave = chaveMesAtual();
            const grupos = agruparCarteiraPorCategoria(carteiraConsolidada);
            const porGrupo = {}; let saldoTotal = 0; let investidoTotal = 0;
            Object.entries(grupos).forEach(([k,v]) => { porGrupo[k] = v.saldo; saldoTotal += v.saldo; investidoTotal += v.investido; });
            // Atualiza só o mês atual (preserva snapshots passados)
            snaps[chave] = { saldoTotal, investidoTotal, porGrupo, atualizadoEm: new Date().toISOString() };
            salvarSnapshotsCarteira(snaps);
        }

        function renderizarCardsCategoriaInferior(carteiraConsolidada) {
            const container = document.getElementById('cardsCategoriaInferior');
            const wrapper = document.getElementById('quadroCategoriasInferior');
            const lblMes = document.getElementById('lblMesQuadroCategorias');
            if(!container || !wrapper) return;
            const grupos = agruparCarteiraPorCategoria(carteiraConsolidada);
            const entries = Object.entries(grupos).filter(([,v]) => v.saldo > 0);
            if(entries.length === 0) { wrapper.style.display = 'none'; return; }
            wrapper.style.display = 'block';

            const hoje = new Date();
            const nomeMes = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            if(lblMes) lblMes.innerText = `· variação em ${nomeMes}`;

            // Saldo do mês anterior reconstruído sob demanda a partir de historicoCompras
            // (não usa snapshots persistidos — esses ficam stale quando o usuário exclui
            // uma operação, fazendo a variação parecer "venda").
            const fimMesPassadoMs = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23, 59, 59).getTime();
            const gruposAnteriores = agruparCategoriasNaData(fimMesPassadoMs);

            // Ordem fixa para apresentação consistente
            const ordem = ['acoes','fiis','bdrs','etfs','cripto','renda_fixa','previdencia','reserva_emergencia'];
            entries.sort((a,b) => ordem.indexOf(a[0]) - ordem.indexOf(b[0]));

            const paleta = paletaCarteira();
            container.innerHTML = entries.map(([k, v]) => {
                const cor = paleta[k] || getToken('--cor-texto-mutado');
                const rotulo = ROTULOS_SUB[k] || k;
                const saldoAnterior = gruposAnteriores[k]?.saldo || 0;
                let variacaoR$ = 0; let variacaoPerc = 0; let labelVariacao = 'Sem histórico';
                if(saldoAnterior > 0) {
                    variacaoR$ = v.saldo - saldoAnterior;
                    variacaoPerc = (variacaoR$ / saldoAnterior) * 100;
                    const sinal = variacaoR$ >= 0 ? '+' : '';
                    labelVariacao = `${sinal}${formatarMoeda(variacaoR$)} (${sinal}${variacaoPerc.toFixed(2)}%)`;
                }
                const corVariacao = variacaoR$ >= 0 ? 'var(--cor-primaria)' : 'var(--cor-erro)';
                const corLabel = saldoAnterior > 0 ? corVariacao : 'var(--cor-texto-mutado)';
                return `
                    <div class="card-container" style="padding: 14px 16px; border-left: 3px solid ${cor};">
                        <div style="font-size: 11px; font-weight:600; color: var(--cor-texto-mutado); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">${rotulo}</div>
                        <div style="font-size: 18px; font-weight:700; color: var(--cor-texto-principal); font-family: 'DM Mono', monospace;">${formatarMoeda(v.saldo)}</div>
                        <div style="font-size: 12px; font-weight:600; color: ${corLabel}; margin-top: 4px; font-family: 'DM Mono', monospace;">${labelVariacao}</div>
                        <div style="font-size: 10.5px; color: var(--cor-texto-mutado); margin-top: 4px;">${v.ativos.length} ativo${v.ativos.length===1?'':'s'} · invest. ${formatarMoeda(v.investido)}</div>
                    </div>`;
            }).join('');
        }

        // Mantida como ponto de entrada (chamado por atualizarCarteiraAtivos). Encaminha às novas funções.
        function atualizarBarraAlocacao(carteiraConsolidada) {
            atualizarSnapshotMesAtual(carteiraConsolidada);
            renderizarGraficoDistribuicao(carteiraConsolidada);
            renderizarCardsCategoriaInferior(carteiraConsolidada);
            renderizarGraficoEvolucao();
        }

        function atualizarCarteiraAtivos() {
            const tbody = document.getElementById('tabelaCarteiraCorpo'); const msgVazia = document.getElementById('carteiraVaziaMsg'); tbody.innerHTML = "";
            const richContainer = document.getElementById('richRowsContainer');
            const datalistCarteira = document.getElementById('listaAtivosCarteira'); datalistCarteira.innerHTML = "";
            let carteiraConsolidada = obterResumoCarteira(); let totalAtivosValidos = 0; let totalGeralInvestido = 0; let saldoGeralAtual = 0;

            // First pass: compute totals
            const ativos = [];
            for (let ticker in carteiraConsolidada) {
                let ativo = carteiraConsolidada[ticker]; if (ativo.qtdTotal <= 0) continue;
                totalAtivosValidos++;
                let precoMedio = ativo.precoMedio; let ativoMercado = mockAtivosMercado.find(a => a.ticker === ticker); let precoAtual = ativoMercado ? ativoMercado.preco_atual : precoMedio; let nomeAtivo = ativoMercado ? ativoMercado.nome : "Ativo Personalizado";
                const option = document.createElement('option'); option.value = ticker; option.text = `${nomeAtivo} - Saldo: ${formatarQtd(ativo.qtdTotal)} un.`; datalistCarteira.appendChild(option);
                let saldoAtualAtivo = ativo.qtdTotal * precoAtual;
                if(ativo.categoria === 'previdencia') {
                    saldoAtualAtivo = calcularSaldoPrevidencia(ticker);
                    precoAtual = ativo.qtdTotal > 0 ? saldoAtualAtivo / ativo.qtdTotal : precoMedio;
                }
                let lucroR$ = saldoAtualAtivo - ativo.valorTotalInvestido; let lucroPerc = ativo.valorTotalInvestido > 0 ? (lucroR$ / ativo.valorTotalInvestido) * 100 : 0;
                totalGeralInvestido += ativo.valorTotalInvestido; saldoGeralAtual += saldoAtualAtivo;
                const categoriaEfetiva = inferirCategoria(ticker, ativo, ativoMercado);
                ativos.push({ ticker, ativo, ativoMercado, precoMedio, precoAtual, nomeAtivo, saldoAtualAtivo, lucroR$, lucroPerc, categoriaEfetiva });
            }

            // Rich rows: group by category
            const paleta = paletaCarteira();
            const ORDEM_CAT = ['renda_variavel','renda_fixa','previdencia','reserva_emergencia'];
            const ROTULOS_CAT_INLINE = { renda_variavel: 'Renda Variável', renda_fixa: 'Renda Fixa', previdencia: 'Previdência', reserva_emergencia: 'Reserva de Emergência' };
            const CORES_CAT = { renda_variavel: '#10b981', renda_fixa: '#6366f1', previdencia: '#f59e0b', reserva_emergencia: '#3b82f6' };

            let richHTML = '';
            let linhasRenderizadas = 0;

            ORDEM_CAT.forEach(cat => {
                const grupo = ativos.filter(a => {
                    if(filtroCategoriaAtivo && a.categoriaEfetiva !== filtroCategoriaAtivo) return false;
                    return a.categoriaEfetiva === cat;
                });
                if(grupo.length === 0) return;

                const subtotal = grupo.reduce((s, a) => s + a.saldoAtualAtivo, 0);
                const subInvestido = grupo.reduce((s, a) => s + a.ativo.valorTotalInvestido, 0);
                const subLucro = subtotal - subInvestido;
                const corCat = CORES_CAT[cat] || '#64748b';
                const sinalSub = subLucro >= 0 ? '+' : '';
                const corSub = subLucro >= 0 ? 'var(--cor-primaria)' : 'var(--cor-erro)';

                richHTML += `<div class="rich-category-header">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div class="cat-accent" style="background:${corCat};"></div>
                        <span class="cat-label">${ROTULOS_CAT_INLINE[cat] || cat}</span>
                        <span style="font-size:11px;color:var(--cor-texto-mutado);font-weight:500;">${grupo.length} ativo${grupo.length!==1?'s':''}</span>
                    </div>
                    <div class="cat-stats">
                        <span class="valor-mascarado">${formatarMoeda(subtotal)}</span>
                        <span style="color:${corSub};">${sinalSub}${formatarMoeda(subLucro)}</span>
                    </div>
                </div>`;

                grupo.forEach(({ ticker, ativo, ativoMercado, precoMedio, precoAtual, nomeAtivo, saldoAtualAtivo, lucroR$, lucroPerc, categoriaEfetiva }) => {
                    linhasRenderizadas++;
                    const corLucro = lucroR$ >= 0 ? 'var(--cor-primaria)' : 'var(--cor-erro)';
                    const sinalLucro = lucroR$ >= 0 ? '+' : '';
                    const allocPerc = saldoGeralAtual > 0 ? (saldoAtualAtivo / saldoGeralAtual * 100) : 0;
                    const semQtdAtivo = ativo.categoria === 'renda_fixa' || ativo.categoria === 'reserva_emergencia' || ativo.categoria === 'previdencia';
                    const corretoraTag = ativo.corretora ? ` · ${ativo.corretora}` : '';
                    let categoriaLbl = ROTULOS_CATEGORIA[ativo.categoria] || (ativoMercado && ativoMercado.tipo === 'Renda Fixa' ? 'Renda Fixa' : 'Renda Variável');

                    // Determine avatar color from subcategory
                    const subcat = subcategoriaInferidaDoTicker(ticker);
                    const avatarColors = { acoes:'#10b981', fiis:'#059669', bdrs:'#14b8a6', etfs:'#0d9488', cripto:'#f59e0b' };
                    const avatarBg = avatarColors[subcat] || CORES_CAT[categoriaEfetiva] || '#64748b';
                    const initial = ticker.substring(0, 2);

                    // Extra info for RF
                    let metaExtra = '';
                    if(ativo.categoria === 'renda_fixa' || ativo.categoria === 'reserva_emergencia') {
                        const partes = [];
                        if(ativo.vencimento) partes.push(`Venc. ${new Date(ativo.vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}`);
                        if(ativo.rentabilidade) partes.push(ativo.rentabilidade);
                        if(partes.length) metaExtra = partes.join(' · ');
                    }

                    richHTML += `<div class="rich-row" onclick="toggleRichExpand('${ticker}')">
                        <div class="rich-avatar" style="background:${avatarBg};">${initial}</div>
                        <div class="rich-row-info">
                            <div class="rich-ticker">${ticker}</div>
                            <div class="rich-nome">${nomeAtivo}</div>
                            <div class="rich-meta">
                                ${!semQtdAtivo ? `<span>${formatarQtd(ativo.qtdTotal)} un</span>` : ''}
                                ${metaExtra ? `${!semQtdAtivo ? '· ' : ''}<span>${metaExtra}</span>` : ''}
                                <span class="rich-alloc-bar"><span class="rich-alloc-fill" style="width:${Math.min(allocPerc, 100)}%;background:${avatarBg};"></span></span>
                                <span>${allocPerc.toFixed(1)}%</span>
                            </div>
                        </div>
                        <div class="rich-pm">
                            <span class="rich-pm-label">Preço Médio</span>
                            <span class="rich-pm-valor valor-mascarado">${formatarMoeda(precoMedio)}</span>
                        </div>
                        <div class="rich-saldo"><span class="valor-mascarado">${formatarMoeda(saldoAtualAtivo)}</span></div>
                        <div class="rich-sparkline" id="spark_${ticker}"></div>
                        <div class="rich-lucro">
                            <span class="rich-lucro-rs" style="color:${corLucro};">${sinalLucro}${formatarMoeda(lucroR$)}</span>
                            <span class="rich-lucro-pct" style="color:${corLucro};">${sinalLucro}${lucroPerc.toFixed(2)}%</span>
                        </div>
                        <div style="display:flex;align-items:center;justify-content:flex-end;">
                            <button class="rich-overflow" onclick="event.stopPropagation();mudarSubAbaPatrimonio('operacoes');document.getElementById('filtroOperacoesTicker').value='${ticker}';renderizarOperacoes();" title="Ver operações">
                                <i class="ph ph-arrow-right"></i>
                            </button>
                        </div>
                    </div>
                    <div class="rich-expand" id="expand_${ticker}">
                        <div class="rich-expand-grid">
                            <div class="rich-expand-stat"><div class="re-label">Investido</div><div class="re-value valor-mascarado">${formatarMoeda(ativo.valorTotalInvestido)}</div></div>
                            <div class="rich-expand-stat"><div class="re-label">Preço Médio</div><div class="re-value">${formatarMoeda(precoMedio)}</div></div>
                            <div class="rich-expand-stat"><div class="re-label">Preço Atual</div><div class="re-value">${formatarMoeda(precoAtual)}</div></div>
                            <div class="rich-expand-stat"><div class="re-label">Saldo</div><div class="re-value valor-mascarado">${formatarMoeda(saldoAtualAtivo)}</div></div>
                            <div class="rich-expand-stat"><div class="re-label">Resultado</div><div class="re-value" style="color:${corLucro};">${sinalLucro}${formatarMoeda(lucroR$)} (${sinalLucro}${lucroPerc.toFixed(2)}%)</div></div>
                        </div>
                        <div class="rich-expand-actions">
                            <button class="btn-secundario" style="font-size:11px;padding:5px 12px;" onclick="event.stopPropagation();mudarSubAbaPatrimonio('operacoes');document.getElementById('filtroOperacoesTicker').value='${ticker}';renderizarOperacoes();"><i class="ph ph-list-bullets"></i> Operações</button>
                            <button class="btn-secundario" style="font-size:11px;padding:5px 12px;" onclick="event.stopPropagation();mudarSubAbaPatrimonio('dividendos');filtrarDividendosPorAtivo('${ticker}');"><i class="ph ph-coins"></i> Dividendos</button>
                        </div>
                    </div>`;

                    // Also populate hidden legacy table
                    const ativoCell = `<div style="font-weight:600;">${ticker}</div><div style="font-size:11px;color:var(--cor-texto-secundario);">${nomeAtivo}</div>`;
                    const qtdCell = semQtdAtivo ? '—' : formatarQtd(ativo.qtdTotal);
                    tbody.innerHTML += `<tr><td>${ativoCell}</td><td style="text-align:right;font-family:'DM Mono',monospace;">${qtdCell}</td><td class="col-extra" style="text-align:right;">${formatarMoeda(precoMedio)}</td><td class="col-extra" style="text-align:right;">${formatarMoeda(precoAtual)}</td><td style="text-align:right;">${formatarMoeda(saldoAtualAtivo)}</td><td class="col-extra" style="text-align:right;">—</td><td style="text-align:right;color:${corLucro};">${sinalLucro}${lucroPerc.toFixed(2)}%</td></tr>`;
                });
            });

            if(richContainer) richContainer.innerHTML = richHTML || '';
            atualizarMiniStats('carteira');

            if(totalAtivosValidos === 0) {
                msgVazia.style.display = "block";
                msgVazia.innerHTML = `<div class="empty-state">
                    <div class="empty-state-icon" style="background: #ecfdf5;"><i class="ph ph-wallet" style="font-size: 26px; color: var(--cor-primaria);"></i></div>
                    <div class="empty-state-titulo">Carteira ainda vazia</div>
                    <div class="empty-state-sub">Registre sua primeira compra de ativo acima<br>e acompanhe sua rentabilidade em tempo real.</div>
                </div>`;
                atualizarKPIsResumo(carteiraConsolidada);
                atualizarBarraAlocacao(carteiraConsolidada);
                return;
            }
            if(linhasRenderizadas === 0 && filtroCategoriaAtivo) {
                msgVazia.style.display = "block";
                msgVazia.innerHTML = `<div class="empty-state">
                    <div class="empty-state-icon" style="background: var(--cor-superficie);"><i class="ph ph-funnel" style="font-size: 26px; color: var(--cor-texto-secundario);"></i></div>
                    <div class="empty-state-titulo">Nenhum ativo nesta categoria</div>
                    <div class="empty-state-sub">Selecione "Tudo" ou outra categoria nos filtros acima.</div>
                </div>`;
            } else {
                msgVazia.style.display = "none";
            }

            // KPIs do hero — respeitam os filtros (tipo + ativo) do bloco Evolução.
            atualizarKPIsResumo(carteiraConsolidada);

            atualizarBarraAlocacao(carteiraConsolidada);
            atualizarProximoEvento(carteiraConsolidada);
        }
        // ============================================================
        // --- TECLADO E ARIA ---
        document.addEventListener('keydown', function(e) {
            if(e.key === 'Escape') {
                if (document.body.classList.contains('painel-lancamento-aberto')) { fecharPainelLancamento(); return; }
                const drawer = document.getElementById('drawerOperacao');
                if(drawer && drawer.classList.contains('aberto')) { fecharDrawerOperacao(); return; }
                const mc = document.getElementById('modalConfirmacao'), mconf = document.getElementById('modalConfiguracoes'), mgrp = document.getElementById('modalGrupoCartao');
                const mDivMes = document.getElementById('modalDividendosMes');
                if(mDivMes && mDivMes.style.display === 'flex') { fecharModalDividendosMes(); return; }
                if(mgrp && mgrp.style.display === 'flex') { fecharModalGrupoCartao(); return; }
                if(mc && mc.style.display === 'flex') fecharModal();
                if(mconf && mconf.style.display === 'flex') fecharModalConfig();
            }
            if(e.key === 'ArrowLeft' && document.getElementById('controle')?.classList.contains('ativa') && !e.target.matches('input,select,textarea')) mudarMesVisao(-1);
            if(e.key === 'ArrowRight' && document.getElementById('controle')?.classList.contains('ativa') && !e.target.matches('input,select,textarea')) mudarMesVisao(1);
        });

        document.getElementById('modalConfirmacao').addEventListener('click', function(e) { if(e.target === this) fecharModal(); });
        document.getElementById('modalConfiguracoes').addEventListener('click', function(e) { if(e.target === this) fecharModalConfig(); });

        // ============================================================
        // --- INICIALIZAÇÃO ---
        window.onload = function() {
            aplicarTemaChartJs();
            inicializarDatalistAtivos();
            inicializarDatalistCorretoras();
            carregarMetas();
            inicializarMascarasBRL();
            atualizarDatalistDescricoes();
            // Lança automaticamente os aportes mensais de previdência que ficaram pendentes
            processarAportesRecorrentesPrevidencia();
            atualizarTelaControle();
            atualizarCarteiraAtivos();
            carregarCarteiraCliente();
            buscarInflacaoBCB();
            buscarTaxasBCB(); // CDI/Selic/IPCA para projeção de Renda Fixa
            buscarCotacoesReais(); // Roda a nossa rotina paralela do Yahoo v8
            // Estado inicial do form de operação
            const elData = document.getElementById('compraData'); if(elData) elData.value = new Date().toISOString().slice(0,10);
            ajustarCamposPorCategoria();
            // Estado inicial do gráfico de evolução
            setPeriodoEvolucao(3);
            // Renderiza sonhos salvos
            renderizarSonhos();
            // Restaura preferência do usuário sobre colunas extras
            try {
                if(localStorage.getItem('appliquei_carteira_extras') === '1') {
                    document.getElementById('tabelaCarteira')?.classList.add('com-extras');
                    const lbl = document.getElementById('lblToggleColunas'); if(lbl) lbl.innerText = 'Menos colunas';
                }
            } catch(_){}
            // Applicash & Dúvidas/Sugestões
            renderizarFaq();
            inicializarFormSugestao();
        };

        // RN03: alterna o input de banco de origem quando origem != externo
        function ajustarOrigemRecursoCampos() {
            const sel = document.getElementById('compraOrigemRecurso');
            const inp = document.getElementById('compraOrigemBanco');
            if(!sel || !inp) return;
            inp.style.display = (sel.value === 'caixa_outra') ? 'block' : 'none';
            if(sel.value !== 'caixa_outra') inp.value = '';
        }

        // ============================================================

        // Inicialização defensiva: pré-renderiza a jornada para que o card chip apareça
        document.addEventListener('DOMContentLoaded', () => {
            try { renderizarJornada(); } catch(_) {}
        });
