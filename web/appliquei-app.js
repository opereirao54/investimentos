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
        // === MEUS SONHOS — DREAM PLANNER ENGINE                    ===
        // ============================================================
        let sonhos = JSON.parse(localStorage.getItem('appliquei_sonhos')) || [];
        // Backfill: sonhos antigos sem dataInicio assumem início = dataCriacao (ou dataFim - prazoMeses)
        sonhos.forEach(s => {
            if(!s.dataInicio) {
                if(s.dataCriacao) {
                    const d = new Date(s.dataCriacao);
                    s.dataInicio = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
                } else if(s.dataFim && s.prazoMeses) {
                    const dFim = new Date(s.dataFim);
                    s.dataInicio = new Date(dFim.getFullYear(), dFim.getMonth() - s.prazoMeses + 1, 1).toISOString();
                } else {
                    const hoje = new Date();
                    s.dataInicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
                }
            }
        });
        let sonhoEditandoId = null;

        const SONHO_TAXA_MENSAL = 0.008; // 0.8% ao mês
        const SONHO_CATEGORIAS = {
            viagem:'✈️', veiculo:'🚗', imovel:'🏠', educacao:'📚',
            casamento:'💍', reserva:'🛡️', tech:'💻', saude:'❤️', outro:'🌟'
        };
        const SONHO_FRASES = [
            {txt:'"O segredo de ir em frente é começar."', autor:'Mark Twain'},
            {txt:'"Grandes conquistas são feitas de pequenos passos diários."', autor:'Provérbio'},
            {txt:'"A disciplina é a ponte entre metas e conquistas."', autor:'Jim Rohn'},
            {txt:'"Não espere por oportunidades. Crie-as."', autor:'George Bernard Shaw'},
            {txt:'"O futuro pertence a quem se prepara hoje."', autor:'Malcolm X'},
            {txt:'"Cada centavo guardado é um passo mais perto do seu sonho."', autor:'Appliquei'},
            {txt:'"A paciência é amarga, mas seu fruto é doce."', autor:'Jean-Jacques Rousseau'},
            {txt:'"Invista no seu futuro. Ninguém mais fará isso por você."', autor:'Appliquei'},
        ];

        function salvarSonhos() {
            localStorage.setItem('appliquei_sonhos', JSON.stringify(sonhos));
        }

        // === Integração Sonho ↔ Controle Financeiro ==================
        function gerarLancamentosMensaisSonho(sonho, valorMensal, mesesGerar) {
            // Cria recorrência de transações com categoria 'sonho' a partir do mês de início do sonho
            // (ou do mês atual, se já tiver iniciado).
            if(!sonho || valorMensal <= 0 || mesesGerar <= 0) return 0;
            const groupId = sonho.groupIdControle || ('sonho_grp_' + sonho.id);
            sonho.groupIdControle = groupId;
            const agora = new Date();
            const dIni = sonho.dataInicio ? new Date(sonho.dataInicio) : agora;
            // Começa pelo maior entre mês corrente e mês de início do sonho
            const baseTs = Math.max(
                new Date(agora.getFullYear(), agora.getMonth(), 1).getTime(),
                new Date(dIni.getFullYear(), dIni.getMonth(), 1).getTime()
            );
            const base = new Date(baseTs);
            // Dia de vencimento: hoje se o plano começa este mês; senão, dia 1 do início.
            // Usuário pode editar depois pelo extrato. Nunca passa do último dia do mês.
            const diaVencBase = (sonho.diaVencimento && sonho.diaVencimento >= 1 && sonho.diaVencimento <= 31)
                ? sonho.diaVencimento
                : agora.getDate();
            let criados = 0;
            for(let i = 0; i < mesesGerar; i++) {
                let m = base.getMonth() + i;
                let a = base.getFullYear();
                while(m > 11) { m -= 12; a++; }
                const jaExiste = transacoes.some(t => t.categoria === 'sonho' && t.sonhoId === sonho.id && t.mes === m && t.ano === a && !t.aporteExtra);
                if(jaExiste) continue;
                const ultimoDiaMes = new Date(a, m + 1, 0).getDate();
                const diaVenc = Math.min(diaVencBase, ultimoDiaMes);
                const dataVenc = `${a}-${String(m+1).padStart(2,'0')}-${String(diaVenc).padStart(2,'0')}`;
                transacoes.push({
                    id: 'tx_' + Date.now() + '_' + i,
                    groupId,
                    sonhoId: sonho.id,
                    descricao: `Sonho: ${sonho.nome}`,
                    valor: Math.round(valorMensal * 100) / 100,
                    categoria: 'sonho',
                    obs: 'Compromisso mensal do sonho',
                    mes: m, ano: a,
                    data: new Date().toISOString(),
                    dataVencimento: dataVenc,
                    pago: false
                });
                criados++;
            }
            if(criados > 0) localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
            return criados;
        }

        function removerLancamentosFuturosSonho(sonhoId) {
            const agora = new Date();
            const m0 = agora.getMonth(), a0 = agora.getFullYear();
            const antes = transacoes.length;
            transacoes = transacoes.filter(t => {
                if(t.categoria !== 'sonho' || t.sonhoId !== sonhoId || t.aporteExtra) return true;
                const futuro = (t.ano > a0) || (t.ano === a0 && t.mes > m0);
                if(futuro && !t.pago) return false; // remove apenas mês corrente em diante e não pagos
                return true;
            });
            if(transacoes.length !== antes) localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
        }

        function pedirConfirmacaoPlanoSonho(sonho) {
            const mensal = calcSonhoMensal(sonho.valorTotal, sonho.valorAtual, sonho.mesesRestantes);
            if(mensal <= 0) return;
            const mesesGerar = Math.min(60, sonho.mesesRestantes || sonho.prazoMeses);
            const fmt = formatarMoeda(mensal);
            const modal = document.getElementById('modalConfirmacao');
            document.getElementById('modalTitulo').innerHTML = `<i class="ph-fill ph-shooting-star" style="color:var(--cor-primaria);"></i> Vincular sonho ao Controle?`;
            document.getElementById('modalMensagem').innerHTML = `
                Para conquistar <strong>${sonho.nome}</strong> em ${sonho.prazoMeses} meses, você precisa separar
                <strong style="color:var(--cor-primaria);font-family:'DM Mono',monospace;">${fmt}/mês</strong>.<br><br>
                Quer que a Appliquei crie automaticamente esse compromisso fixo no seu Controle Financeiro
                (categoria <strong style="color:#7c3aed;">⭐ Sonho</strong>)? Você poderá pagar/quitar mês a mês como qualquer outra conta.
            `;
            document.getElementById('modalAcoes').innerHTML = `
                <button class="btn-acao" style="background:var(--cor-primaria);" onclick="confirmarPlanoSonho('${sonho.id}')"><i class="ph-bold ph-check-circle"></i> Sim, criar compromisso</button>
                <button class="btn-secundario" onclick="fecharModal()">Agora não</button>
            `;
            modal.style.display = 'flex';
        }

        function confirmarPlanoSonho(sonhoId) {
            const s = sonhos.find(x => x.id === sonhoId);
            if(!s) { fecharModal(); return; }
            const mensal = calcSonhoMensal(s.valorTotal, s.valorAtual, s.mesesRestantes);
            const mesesGerar = Math.min(60, s.mesesRestantes || s.prazoMeses);
            const criados = gerarLancamentosMensaisSonho(s, mensal, mesesGerar);
            s.planoVinculado = true;
            s.aporteMensalPlano = mensal;
            salvarSonhos();
            fecharModal();
            renderizarSonhos();
            mostrarToast(`Compromisso criado: ${criados} ${criados===1?'lançamento mensal':'lançamentos mensais'} no Controle.`, 'sucesso');
        }
        // ============================================================

        function analisarSaudeFinanceiraSonhos() {
            // Analisa os últimos 3 meses fechados + mês corrente para inferir saúde financeira
            const hoje = new Date();
            let receita = 0, despesa = 0, invest = 0, mesesComDados = 0;
            for(let i = 0; i < 4; i++) {
                const ref = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
                const r = calcularResumoMes(ref.getMonth(), ref.getFullYear());
                const totalMov = r.receita + r.despFixa + r.despVar + r.cartao + r.invFixo + r.invVar + r.resgate + r.sonho;
                if(totalMov > 0) {
                    receita += r.receita + r.resgate;
                    despesa += r.despFixa + r.despVar + r.cartao;
                    invest  += r.invFixo + r.invVar + r.sonho;
                    mesesComDados++;
                }
            }
            if(mesesComDados === 0) {
                return { semDados: true };
            }
            const receitaMedia = receita / mesesComDados;
            const despesaMedia = despesa / mesesComDados;
            const investMedio  = invest  / mesesComDados;
            const sobraMedia   = receitaMedia - despesaMedia - investMedio;
            const taxaPoupanca = receitaMedia > 0 ? (sobraMedia / receitaMedia) * 100 : 0;
            const compromissoSonhos = sonhos.reduce((acc,s) => {
                if(s.valorAtual >= s.valorTotal || s.mesesRestantes <= 0) return acc;
                return acc + calcSonhoMensal(s.valorTotal, s.valorAtual, s.mesesRestantes);
            }, 0);

            // Reserva ~30% da sobra como folga; recomenda até 70% para sonhos
            const recomendadoSonhos = Math.max(0, sobraMedia * 0.7);

            let nivel, cor, titulo, diagnostico;
            if(sobraMedia <= 0) {
                nivel = 'critico'; cor = '#ef4444';
                titulo = 'Atenção: suas despesas estão consumindo toda a renda';
                diagnostico = 'Antes de acelerar os sonhos, é preciso equilibrar o fluxo do mês. Reveja despesas variáveis e renegocie contas fixas.';
            } else if(taxaPoupanca < 10) {
                nivel = 'frágil'; cor = '#f59e0b';
                titulo = 'Saúde financeira frágil — poupança abaixo de 10%';
                diagnostico = 'Há sobra, mas pequena. Comece com sonhos de prazo mais longo e foco em construir reserva antes de alvos ousados.';
            } else if(taxaPoupanca < 25) {
                nivel = 'estável'; cor = '#0ea5e9';
                titulo = 'Saúde financeira estável — taxa de poupança saudável';
                diagnostico = 'Você tem espaço para um plano consistente. Distribua a sobra entre 1-2 sonhos prioritários.';
            } else {
                nivel = 'forte'; cor = '#10b981';
                titulo = 'Saúde financeira forte — alta capacidade de investimento';
                diagnostico = 'Excelente folga mensal. Pode mirar sonhos maiores ou acelerar prazos com aportes mais agressivos.';
            }

            return {
                semDados: false,
                mesesComDados, receitaMedia, despesaMedia, investMedio, sobraMedia,
                taxaPoupanca, compromissoSonhos, recomendadoSonhos,
                nivel, cor, titulo, diagnostico
            };
        }

        function gerarPlanoSugerido(saude) {
            if(saude.semDados) {
                return [
                    'Cadastre suas receitas e despesas na aba <strong>Controle de Caixa</strong> para que o app gere um plano sob medida para você.',
                    'Sem dados de fluxo de caixa, a sugestão padrão é: separar até <strong>20% da renda líquida</strong> para sonhos e <strong>10%</strong> para reserva de emergência.'
                ];
            }
            const passos = [];
            const fmt = v => formatarMoeda(v);
            if(saude.sobraMedia <= 0) {
                passos.push(`Sua despesa média (${fmt(saude.despesaMedia)}) está acima da sua receita média (${fmt(saude.receitaMedia)}). <strong>Primeiro passo: reequilibrar o mês.</strong>`);
                passos.push('Liste despesas variáveis que podem ser cortadas em até 30 dias e renegocie pelo menos 1 conta fixa (internet, plano, assinaturas).');
                passos.push('Quando a sobra mensal for positiva, reserve 70% dela para os sonhos e 30% como folga.');
                return passos;
            }
            passos.push(`Sua sobra média é de <strong>${fmt(saude.sobraMedia)}/mês</strong> (taxa de poupança de ${saude.taxaPoupanca.toFixed(1)}%).`);
            passos.push(`Sugerimos destinar até <strong>${fmt(saude.recomendadoSonhos)}/mês</strong> aos seus sonhos (70% da sobra), mantendo ${fmt(saude.sobraMedia - saude.recomendadoSonhos)} como folga e reserva.`);
            if(saude.compromissoSonhos > 0) {
                if(saude.compromissoSonhos > saude.recomendadoSonhos) {
                    passos.push(`<strong>Alerta:</strong> a soma dos aportes mensais necessários para seus sonhos (${fmt(saude.compromissoSonhos)}) ultrapassa o recomendado. Considere estender prazos ou priorizar 1-2 sonhos.`);
                } else {
                    passos.push(`Você está comprometendo <strong>${fmt(saude.compromissoSonhos)}/mês</strong> com seus sonhos atuais — dentro da sua capacidade.`);
                }
            }
            if(saude.taxaPoupanca >= 25) {
                passos.push('Com sobra robusta, vale aplicar parte em renda fixa (CDB/Tesouro) e ações/FIIs para acelerar a meta.');
            } else if(saude.taxaPoupanca >= 10) {
                passos.push('Mantenha a reserva de emergência completa (3-6× despesas) antes de acelerar sonhos com prazo longo.');
            } else {
                passos.push('Foque em <strong>aumentar a renda</strong> ou cortar despesas para elevar a taxa de poupança acima de 10% — base para qualquer plano.');
            }
            return passos;
        }

        function renderPainelSaudeSonhos() {
            const el = document.getElementById('painelSaudeSonhos');
            if(!el) return;
            const saude = analisarSaudeFinanceiraSonhos();
            const passos = gerarPlanoSugerido(saude);

            if(saude.semDados) {
                el.innerHTML = `<div class="card-container" style="margin-bottom:18px;border-left:4px solid #6366f1;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                        <i class="ph-fill ph-lightbulb" style="font-size:20px;color:#6366f1;"></i>
                        <h3 style="font-size:14px;font-weight:700;color:var(--cor-texto-principal);margin:0;">Plano sugerido pela Appliquei</h3>
                    </div>
                    <ul style="margin:8px 0 0 18px;padding:0;color:var(--cor-texto-mutado);font-size:13px;line-height:1.65;">
                        ${passos.map(p => `<li style="margin-bottom:4px;">${p}</li>`).join('')}
                    </ul>
                </div>`;
                return;
            }

            const fmt = v => formatarMoeda(v);
            const corBg = saude.nivel === 'crítico' ? 'rgba(239,68,68,0.08)' :
                          saude.nivel === 'frágil'  ? 'rgba(245,158,11,0.08)' :
                          saude.nivel === 'estável' ? 'rgba(14,165,233,0.08)' :
                                                      'rgba(16,185,129,0.08)';

            el.innerHTML = `<div class="card-container" style="margin-bottom:18px;border-left:4px solid ${saude.cor};">
                <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;justify-content:space-between;margin-bottom:14px;">
                    <div style="flex:1;min-width:240px;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                            <i class="ph-fill ph-heartbeat" style="font-size:20px;color:${saude.cor};"></i>
                            <h3 style="font-size:14px;font-weight:700;color:var(--cor-texto-principal);margin:0;">Análise da sua saúde financeira</h3>
                            <span style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;padding:3px 8px;border-radius:999px;background:${corBg};color:${saude.cor};">${saude.nivel}</span>
                        </div>
                        <div style="font-size:13px;font-weight:600;color:var(--cor-texto-principal);margin-bottom:4px;">${saude.titulo}</div>
                        <div style="font-size:12.5px;color:var(--cor-texto-mutado);line-height:1.5;">${saude.diagnostico}</div>
                        <div style="font-size:11px;color:var(--cor-texto-mutado);margin-top:6px;">Baseado em ${saude.mesesComDados} ${saude.mesesComDados === 1 ? 'mês' : 'meses'} de dados do Controle de Caixa.</div>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px;">
                    <div style="padding:10px 12px;border:1px solid var(--cor-borda);border-radius:9px;background:var(--cor-superficie);">
                        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--cor-texto-mutado);">Receita média</div>
                        <div style="font-size:15px;font-weight:700;font-family:'DM Mono',monospace;color:#10b981;margin-top:2px;">${fmt(saude.receitaMedia)}</div>
                    </div>
                    <div style="padding:10px 12px;border:1px solid var(--cor-borda);border-radius:9px;background:var(--cor-superficie);">
                        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--cor-texto-mutado);">Despesa média</div>
                        <div style="font-size:15px;font-weight:700;font-family:'DM Mono',monospace;color:#ef4444;margin-top:2px;">${fmt(saude.despesaMedia)}</div>
                    </div>
                    <div style="padding:10px 12px;border:1px solid var(--cor-borda);border-radius:9px;background:var(--cor-superficie);">
                        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--cor-texto-mutado);">Sobra média</div>
                        <div style="font-size:15px;font-weight:700;font-family:'DM Mono',monospace;color:${saude.sobraMedia >= 0 ? 'var(--cor-primaria)' : '#ef4444'};margin-top:2px;">${fmt(saude.sobraMedia)}</div>
                    </div>
                    <div style="padding:10px 12px;border:1px solid var(--cor-borda);border-radius:9px;background:var(--cor-superficie);">
                        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--cor-texto-mutado);">Taxa de poupança</div>
                        <div style="font-size:15px;font-weight:700;font-family:'DM Mono',monospace;color:${saude.cor};margin-top:2px;">${saude.taxaPoupanca.toFixed(1)}%</div>
                    </div>
                    <div style="padding:10px 12px;border:1px solid var(--cor-borda);border-radius:9px;background:${corBg};">
                        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--cor-texto-mutado);">Recomendado p/ sonhos</div>
                        <div style="font-size:15px;font-weight:700;font-family:'DM Mono',monospace;color:${saude.cor};margin-top:2px;">${fmt(saude.recomendadoSonhos)}</div>
                    </div>
                </div>

                <div style="padding:14px;border-radius:10px;background:${corBg};border:1px solid ${saude.cor}33;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                        <i class="ph-fill ph-lightbulb" style="font-size:16px;color:${saude.cor};"></i>
                        <strong style="font-size:12.5px;color:var(--cor-texto-principal);">Plano sugerido para você</strong>
                    </div>
                    <ul style="margin:0 0 0 18px;padding:0;color:var(--cor-texto-mutado);font-size:12.5px;line-height:1.65;">
                        ${passos.map(p => `<li style="margin-bottom:4px;">${p}</li>`).join('')}
                    </ul>
                </div>
            </div>`;
        }

        // Status do sonho: 'agendado' (ainda não começou), 'ativo', 'conquistado', 'vencido'
        function statusSonho(s) {
            if(!s) return 'ativo';
            const conquistado = (s.valorAtual || 0) >= (s.valorTotal || 0);
            if(conquistado) return 'conquistado';
            const hoje = new Date();
            const hojeMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).getTime();
            if(s.dataInicio) {
                const dIni = new Date(s.dataInicio);
                const iniMes = new Date(dIni.getFullYear(), dIni.getMonth(), 1).getTime();
                if(hojeMes < iniMes) return 'agendado';
            }
            if(s.dataFim) {
                const dFim = new Date(s.dataFim);
                if(hoje > dFim) return 'vencido';
            }
            return 'ativo';
        }

        function diasAteInicioSonho(s) {
            if(!s || !s.dataInicio) return 0;
            const hoje = new Date();
            const dIni = new Date(s.dataInicio);
            const diff = Math.ceil((dIni.getTime() - hoje.getTime()) / (24*60*60*1000));
            return Math.max(0, diff);
        }

        function calcSonhoMensal(valorTotal, valorAtual, mesesRestantes) {
            if(mesesRestantes <= 0) return 0;
            const falta = valorTotal - valorAtual;
            if(falta <= 0) return 0;
            const r = SONHO_TAXA_MENSAL;
            // PMT para atingir 'falta' com juros compostos
            const pmt = falta * r / (Math.pow(1+r, mesesRestantes) - 1);
            return Math.max(0, pmt);
        }

        function calcSonhoProjecao(valorAtual, aporteMensal, meses) {
            let saldo = valorAtual;
            for(let i=0; i<meses; i++) { saldo = saldo * (1+SONHO_TAXA_MENSAL) + aporteMensal; }
            return saldo;
        }

        function mesesEntre(dataIni, dataFim) {
            const d1 = new Date(dataIni), d2 = new Date(dataFim);
            return (d2.getFullYear()-d1.getFullYear())*12 + (d2.getMonth()-d1.getMonth());
        }

        function gerarPassosSonho(sonho) {
            const pct = Math.min(100, (sonho.valorAtual / sonho.valorTotal)*100);
            const mensal = calcSonhoMensal(sonho.valorTotal, sonho.valorAtual, sonho.mesesRestantes);
            const mensalFmt = mensal.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
            const esforco = sonho.esforco || 'medio';
            const passos = [];

            passos.push({
                label: 'Defina o sonho e o prazo',
                desc: `Você definiu: "${sonho.nome}" com meta de ${sonho.valorTotal.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} em ${sonho.prazoMeses} meses.`,
                done: true
            });

            passos.push({
                label: 'Abra uma caixinha no seu banco',
                desc: `Crie uma caixinha/cofre nomeada "${sonho.nome}" para separar esse dinheiro e ganhar rendimento automático.`,
                done: pct > 0
            });

            if(esforco === 'baixo') {
                passos.push({
                    label: `Guarde ${mensalFmt}/mês de forma tranquila`,
                    desc: 'No início do mês, separe esse valor antes de qualquer gasto. Sem pressão — é um ritmo sustentável.',
                    done: pct >= 25
                });
                passos.push({
                    label: 'Revise seu progresso a cada 3 meses',
                    desc: 'Confira se está no caminho certo. Pequenos ajustes são normais.',
                    done: pct >= 50
                });
            } else if(esforco === 'medio') {
                passos.push({
                    label: `Guarde ${mensalFmt}/mês com disciplina`,
                    desc: 'Defina um débito automático ou lembrete. Corte 1-2 gastos supérfluos para garantir o aporte.',
                    done: pct >= 15
                });
                passos.push({
                    label: 'Busque uma renda extra pontual',
                    desc: 'Venda itens que não usa, faça um freelance ou monetize uma habilidade para acelerar.',
                    done: pct >= 40
                });
                passos.push({
                    label: 'Revise e ajuste mensalmente',
                    desc: 'Acompanhe seu progresso todo mês. Redirecione sobras para a caixinha.',
                    done: pct >= 60
                });
            } else {
                passos.push({
                    label: `Guarde ${mensalFmt}/mês com foco total`,
                    desc: 'Trate esse aporte como uma conta fixa. Elimine gastos desnecessários imediatamente.',
                    done: pct >= 10
                });
                passos.push({
                    label: 'Corte gastos não essenciais',
                    desc: 'Cancele assinaturas, reduza delivery, negocie contas. Cada real importa nessa meta.',
                    done: pct >= 25
                });
                passos.push({
                    label: 'Gere renda extra consistente',
                    desc: 'Freelance, trabalho extra, venda de itens — direcione 100% para o sonho.',
                    done: pct >= 45
                });
                passos.push({
                    label: 'Revise semanalmente',
                    desc: 'Com meta agressiva, acompanhe toda semana para garantir que está no ritmo.',
                    done: pct >= 65
                });
            }

            passos.push({
                label: '🎉 Conquiste seu sonho!',
                desc: pct >= 100 ? 'Parabéns! Você conquistou esse objetivo!' : `Faltam ${(100-pct).toFixed(0)}% para chegar lá. Continue firme!`,
                done: pct >= 100
            });

            return passos;
        }

        function gerarAlertaSonho(sonho) {
            const pct = (sonho.valorAtual / sonho.valorTotal)*100;
            if(pct >= 100) return {tipo:'ok', msg:'🎉 Parabéns! Você atingiu a meta deste sonho!'};
            if(sonho.mesesRestantes <= 0) return {tipo:'danger', msg:'⏰ O prazo original já expirou! Considere estender o prazo ou aumentar os aportes.'};

            const mesesPassados = sonho.prazoMeses - sonho.mesesRestantes;
            if(mesesPassados <= 0) return null;
            const pctTempo = (mesesPassados / sonho.prazoMeses)*100;
            if(pct < pctTempo * 0.6) return {tipo:'danger', msg:`⚠️ Atenção: você está com ${pct.toFixed(0)}% guardado, mas já se passaram ${pctTempo.toFixed(0)}% do tempo. O plano precisa de ajustes urgentes!`};
            if(pct < pctTempo * 0.85) return {tipo:'warn', msg:`📊 Seu progresso está um pouco abaixo do esperado. Considere aumentar os aportes ou cortar algum gasto extra.`};
            return null;
        }

        function renderSonhoRing(pct) {
            const r = 58, circ = 2*Math.PI*r;
            const offset = circ - (Math.min(pct,100)/100)*circ;
            let cor = '#059669';
            if(pct >= 100) cor = '#10b981';
            else if(pct >= 60) cor = '#059669';
            else if(pct >= 30) cor = '#d97706';
            else cor = '#ef4444';
            return `<div class="sonho-ring-wrap">
                <svg class="sonho-ring-svg" viewBox="0 0 140 140">
                    <circle class="sonho-ring-bg" cx="70" cy="70" r="${r}"/>
                    <circle class="sonho-ring-fill" cx="70" cy="70" r="${r}"
                        stroke="${cor}" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
                </svg>
                <div class="sonho-ring-center">
                    <div class="sonho-ring-pct">${Math.min(pct,100).toFixed(0)}%</div>
                    <div class="sonho-ring-label">concluído</div>
                </div>
            </div>`;
        }

        function renderizarSonhos() {
            const container = document.getElementById('sonhosListaContainer');
            const empty = document.getElementById('sonhosEmptyState');
            const resumoContainer = document.getElementById('sonhosResumoContainer');
            if(!container) return;

            // Atualizar meses restantes — desconta meses pulados (s.mesesPulados é cumulativo
            // e persiste a decisão de "Pular este mês"; sem isso, o render sobrescrevia o efeito).
            const agora = new Date();
            sonhos.forEach(s => {
                const fim = new Date(s.dataFim);
                const calendarRestantes = Math.max(0, mesesEntre(agora, fim));
                const pulados = Math.max(0, s.mesesPulados || 0);
                s.mesesRestantes = Math.max(0, calendarRestantes - pulados);
            });

            renderPainelSaudeSonhos();
            renderResumoSonhos();

            const toolbar = document.getElementById('sonhosToolbar');
            const toolbarLabel = document.getElementById('sonhosToolbarLabel');

            if(sonhos.length === 0) {
                container.innerHTML = '';
                empty.style.display = 'block';
                if(toolbar) toolbar.style.display = 'none';
                return;
            }
            empty.style.display = 'none';
            if(toolbar) {
                toolbar.style.display = 'flex';
                if(toolbarLabel) toolbarLabel.textContent = `${sonhos.length} ${sonhos.length === 1 ? 'sonho cadastrado' : 'sonhos cadastrados'}`;
            }

            container.innerHTML = sonhos.map((s,idx) => {
                const pct = Math.min(100, (s.valorAtual / s.valorTotal)*100);
                const mensal = calcSonhoMensal(s.valorTotal, s.valorAtual, s.mesesRestantes);
                const passos = gerarPassosSonho(s);
                const alerta = gerarAlertaSonho(s);
                const frase = SONHO_FRASES[idx % SONHO_FRASES.length];
                const emoji = SONHO_CATEGORIAS[s.categoria] || '🌟';
                const esforcoLbl = {baixo:'🌱 Leve',medio:'⚡ Moderado',alto:'🔥 Intenso'}[s.esforco||'medio'];
                const esforcoClass = 'esforco-'+(s.esforco||'medio');
                const conquistado = pct >= 100;
                const status = statusSonho(s);
                const falta = Math.max(0, s.valorTotal - s.valorAtual);
                const barColor = pct >= 100 ? '#10b981' : pct >= 60 ? '#059669' : pct >= 30 ? '#d97706' : '#ef4444';

                const mensalFmtCol = mensal.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
                const faltaFmtCol  = falta.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
                let tempoLbl;
                if(conquistado) tempoLbl = '🏆 Conquistado';
                else if(status === 'agendado') {
                    const d = diasAteInicioSonho(s);
                    const dIni = new Date(s.dataInicio);
                    const mesIniLabel = dIni.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}).replace('.','');
                    tempoLbl = `🕒 Inicia em ${mesIniLabel}${d > 0 ? ` (${d}d)` : ''}`;
                }
                else if(status === 'vencido') tempoLbl = '⏰ Prazo encerrado';
                else tempoLbl = s.mesesRestantes > 0 ? `⏱ ${s.mesesRestantes} ${s.mesesRestantes===1?'mês restante':'meses restantes'}` : '⏰ Prazo encerrado';

                let statusBadge = '';
                if(status === 'agendado') statusBadge = `<span class="sonho-status-badge st-agendado"><i class="ph-fill ph-clock-clockwise"></i> Agendado</span>`;
                else if(status === 'conquistado') statusBadge = `<span class="sonho-status-badge st-conquistado"><i class="ph-fill ph-trophy"></i> Conquistado</span>`;
                else if(status === 'vencido') statusBadge = `<span class="sonho-status-badge st-vencido"><i class="ph-fill ph-warning-circle"></i> Vencido</span>`;

                let agendadoBanner = '';
                if(status === 'agendado') {
                    const d = diasAteInicioSonho(s);
                    const dIni = new Date(s.dataInicio);
                    const mesIniFmt = dIni.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
                    agendadoBanner = `<div class="sonho-agendado-banner">
                        <i class="ph-fill ph-clock-clockwise"></i>
                        <span>Este sonho está <strong>agendado para ${mesIniFmt}</strong>${d > 0 ? ` — faltam <strong>${d} dia${d===1?'':'s'}</strong> para começar` : ' — começa hoje!'}.</span>
                    </div>`;
                }

                return `<div class="sonho-card ${conquistado?'sonho-conquistado':''}" id="card_${s.id}" onclick="toggleSonhoCard('${s.id}')">
                    <div class="sonho-card-collapsed cat-${s.categoria}">
                        <div class="sonho-collapsed-avatar">${emoji}</div>
                        <div class="sonho-collapsed-info">
                            <div class="sonho-collapsed-nome">${s.nome}${statusBadge}</div>
                            <div class="sonho-collapsed-meta">
                                <span class="sonho-esforco-badge ${esforcoClass}">${esforcoLbl}</span>
                                <span>${tempoLbl}</span>
                                <span style="font-family:'DM Mono',monospace;font-weight:600;" title="Meta total do sonho">🎯 ${s.valorTotal.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</span>
                                ${conquistado ? '' : `<span style="font-family:'DM Mono',monospace;font-weight:600;color:var(--cor-primaria);" title="Aporte mensal sugerido para bater a meta">💰 ${mensalFmtCol}/mês</span>`}
                                ${conquistado ? '' : `<span style="font-family:'DM Mono',monospace;font-weight:500;color:var(--cor-texto-mutado);" title="Quanto falta para atingir a meta">Falta ${faltaFmtCol}</span>`}
                            </div>
                        </div>
                        <div class="sonho-collapsed-progress">
                            <div class="sonho-collapsed-bar">
                                <div class="sonho-collapsed-bar-fill" style="width:${pct}%;background:${barColor};"></div>
                            </div>
                            <div class="sonho-collapsed-pct">${pct.toFixed(0)}%</div>
                        </div>
                        <button class="sonho-collapsed-expand" onclick="event.stopPropagation();toggleSonhoCard('${s.id}')" title="Ver detalhes">
                            <i class="ph-bold ph-caret-down"></i>
                        </button>
                    </div>
                    <div class="sonho-card-details">
                        ${agendadoBanner}
                        <div class="sonho-body">
                            <div class="sonho-passos">
                                <div class="sonho-passos-title"><i class="ph ph-list-checks"></i> Passos para conquistar</div>
                                ${passos.map((p,i) => `<div class="sonho-step ${p.done?'done':''}">
                                    <div class="sonho-step-num">${p.done?'<i class="ph-bold ph-check" style="font-size:12px;"></i>':(i+1)}</div>
                                    <div class="sonho-step-content">
                                        <div class="sonho-step-label">${p.label}</div>
                                        <div class="sonho-step-desc">${p.desc}</div>
                                    </div>
                                </div>`).join('')}
                                ${!conquistado ? `<div style="margin-top:12px;"><button class="sonho-btn-aporte" onclick="abrirAporteSonho('${s.id}')"><i class="ph-bold ph-plus"></i> Registrar aporte</button></div>` : ''}
                            </div>
                            <div class="sonho-right">
                                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:var(--cor-texto-mutado);margin-bottom:2px;">A caminho do meu sonho</div>
                                ${renderSonhoRing(pct)}
                                <div class="sonho-stats-mini">
                                    <div class="sonho-stat-mini">
                                        <div class="sonho-stat-mini-lbl">Guardado</div>
                                        <div class="sonho-stat-mini-val">${s.valorAtual.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</div>
                                    </div>
                                    <div class="sonho-stat-mini">
                                        <div class="sonho-stat-mini-lbl">Mensal</div>
                                        <div class="sonho-stat-mini-val">${mensal.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</div>
                                    </div>
                                    <div class="sonho-stat-mini">
                                        <div class="sonho-stat-mini-lbl">Falta</div>
                                        <div class="sonho-stat-mini-val">${falta.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</div>
                                    </div>
                                    <div class="sonho-stat-mini">
                                        <div class="sonho-stat-mini-lbl">Rendim. est.</div>
                                        <div class="sonho-stat-mini-val" style="color:var(--cor-primaria);">+${(calcSonhoProjecao(s.valorAtual,mensal,s.mesesRestantes)-s.valorAtual-(mensal*s.mesesRestantes)).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</div>
                                    </div>
                                </div>
                                <div class="sonho-motivacao">
                                    <div class="sonho-motivacao-txt">${frase.txt}</div>
                                    <div class="sonho-motivacao-autor">— ${frase.autor}</div>
                                </div>
                            </div>
                        </div>
                        <div class="sonho-caixinha-tip">
                            <i class="ph-fill ph-info"></i>
                            <span><strong>Dica:</strong> Abra uma caixinha no seu banco chamada "${s.nome}" e deposite <strong>${mensal.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</strong> todo mês. A rentabilidade estimada é de 0,8% a.m. (a maioria dos bancos rende +1% a.m.).</span>
                        </div>
                        ${renderHistoricoAportesSonho(s)}
                        ${alerta ? `<div class="sonho-alerta-bar alerta-${alerta.tipo}"><i class="ph-fill ph-${alerta.tipo==='ok'?'check-circle':alerta.tipo==='warn'?'warning':'warning-circle'}"></i> ${alerta.msg}</div>` : ''}
                        <div style="padding:12px 20px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--cor-borda);background:var(--cor-superficie);flex-wrap:wrap;">
                            ${conquistado ? '' : (s.planoVinculado
                                ? `<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#7c3aed;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.3);padding:6px 10px;border-radius:99px;align-self:center;margin-right:auto;" title="Compromisso lançado no Controle Financeiro"><i class="ph-fill ph-link-simple"></i> Vinculado ao Controle</span>`
                                : `<button onclick="event.stopPropagation();pedirConfirmacaoPlanoSonho(sonhos.find(x=>x.id==='${s.id}'))" class="btn-acao" style="background:#7c3aed;font-size:12px;padding:8px 14px;margin-right:auto;"><i class="ph-bold ph-link-simple"></i> Vincular ao Controle</button>`)}
                            ${conquistado || !s.planoVinculado || status === 'agendado' ? '' : `<button onclick="event.stopPropagation();pularMesSonho('${s.id}')" class="btn-acao" style="background:#f59e0b;font-size:12px;padding:8px 14px;" title="Não consegue separar este mês? Redistribui a falta nos meses restantes."><i class="ph-bold ph-skip-forward"></i> Pular este mês</button>`}
                            <button onclick="event.stopPropagation();abrirAporteSonho('${s.id}')" class="btn-acao" style="background:var(--cor-primaria);font-size:12px;padding:8px 14px;"><i class="ph-bold ph-piggy-bank"></i> Registrar aporte</button>
                            <button onclick="event.stopPropagation();editarSonho('${s.id}')" class="btn-acao" style="font-size:12px;padding:8px 14px;"><i class="ph-bold ph-pencil-simple"></i> Editar</button>
                            <button onclick="event.stopPropagation();excluirSonho('${s.id}')" class="btn-acao" style="background:var(--cor-bg-erro);color:var(--cor-txt-erro);font-size:12px;padding:8px 14px;"><i class="ph-bold ph-trash"></i> Excluir</button>
                        </div>
                    </div>
                </div>`;
            }).join('');
        }

        // Formata um prazo em meses para "8 meses" / "1 ano" / "1a 6m" / "2 anos"
        function formatarPrazoMeses(m) {
            if(m <= 0) return '—';
            if(m < 12) return `${m} ${m === 1 ? 'mês' : 'meses'}`;
            const anos = Math.floor(m / 12);
            const resto = m % 12;
            if(resto === 0) return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
            return `${anos}a ${resto}m`;
        }

        function corUrgenciaPorMeses(m) {
            if(m <= 0) return 'urg-conquistado';
            if(m <= 6) return 'urg-alta';
            if(m <= 12) return 'urg-media';
            return 'urg-baixa';
        }

        function renderResumoSonhos() {
            const container = document.getElementById('sonhosResumoContainer');
            if(!container) return;

            if(sonhos.length === 0) {
                container.innerHTML = '';
                return;
            }

            const totalMeta = sonhos.reduce((acc, s) => acc + s.valorTotal, 0);
            const totalGuardado = sonhos.reduce((acc, s) => acc + s.valorAtual, 0);
            const totalFalta = Math.max(0, totalMeta - totalGuardado);
            const totalMensal = sonhos.reduce((acc, s) => acc + calcSonhoMensal(s.valorTotal, s.valorAtual, s.mesesRestantes), 0);
            const conquistados = sonhos.filter(s => s.valorAtual >= s.valorTotal).length;
            const agendados = sonhos.filter(s => statusSonho(s) === 'agendado').length;

            // Lista por sonho NÃO conquistado, ordenado por urgência (menos meses primeiro,
            // mas com agendados ao final pois ainda não começaram)
            const naoConquistados = sonhos
                .filter(s => (s.valorAtual / s.valorTotal) < 1)
                .sort((a,b) => {
                    const sa = statusSonho(a), sb = statusSonho(b);
                    if(sa === 'agendado' && sb !== 'agendado') return 1;
                    if(sb === 'agendado' && sa !== 'agendado') return -1;
                    return (a.mesesRestantes || 0) - (b.mesesRestantes || 0);
                });

            const pctGeral = totalMeta > 0 ? (totalGuardado / totalMeta) * 100 : 0;
            const SONHO_CATS = (typeof SONHO_CATEGORIAS !== 'undefined') ? SONHO_CATEGORIAS : {};

            container.innerHTML = `
            <div class="sonhos-overview">
                <div class="sonhos-overview-head">
                    <div class="sonhos-overview-icon"><i class="ph-fill ph-chart-pie-slice"></i></div>
                    <div>
                        <h3 class="sonhos-overview-title">Visão geral dos seus sonhos</h3>
                        <p class="sonhos-overview-sub">${sonhos.length} ${sonhos.length === 1 ? 'sonho' : 'sonhos'} cadastrado${sonhos.length === 1 ? '' : 's'}${conquistados > 0 ? ` · ${conquistados} já conquistado${conquistados === 1 ? '' : 's'}` : ''}${agendados > 0 ? ` · ${agendados} agendado${agendados === 1 ? '' : 's'}` : ''}</p>
                    </div>
                </div>

                <div class="sonhos-kpi-grid">
                    <div class="sonhos-kpi" style="--kpi-accent: #6366f1;">
                        <div class="sonhos-kpi-lbl"><i class="ph-fill ph-target"></i> Meta total</div>
                        <div class="sonhos-kpi-val">${formatarMoeda(totalMeta)}</div>
                    </div>
                    <div class="sonhos-kpi" style="--kpi-accent: #10b981;">
                        <div class="sonhos-kpi-lbl"><i class="ph-fill ph-piggy-bank"></i> Já guardado</div>
                        <div class="sonhos-kpi-val" style="color:#10b981;">${formatarMoeda(totalGuardado)}</div>
                        <div class="sonhos-kpi-sub">${pctGeral.toFixed(0)}% do total</div>
                    </div>
                    <div class="sonhos-kpi" style="--kpi-accent: #ef4444;">
                        <div class="sonhos-kpi-lbl"><i class="ph-fill ph-flag"></i> Falta alcançar</div>
                        <div class="sonhos-kpi-val" style="color:#ef4444;">${formatarMoeda(totalFalta)}</div>
                    </div>
                    <div class="sonhos-kpi" style="--kpi-accent: #7c3aed;">
                        <div class="sonhos-kpi-lbl"><i class="ph-fill ph-calendar-blank"></i> Aporte/mês total</div>
                        <div class="sonhos-kpi-val" style="color:#7c3aed;">${formatarMoeda(totalMensal)}</div>
                        <div class="sonhos-kpi-sub">somando todos os planos</div>
                    </div>
                </div>

                <div class="sonhos-progresso-geral">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                        <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--cor-texto-mutado);"><i class="ph ph-trending-up"></i> Progresso geral</span>
                        <span style="font-size:14px;font-weight:800;font-family:'DM Mono',monospace;color:var(--cor-texto-principal);">${pctGeral.toFixed(1)}%</span>
                    </div>
                    <div class="sonhos-progresso-bar">
                        <div class="sonhos-progresso-fill" style="width:${Math.min(100,pctGeral)}%;"></div>
                    </div>
                </div>

                ${naoConquistados.length > 0 ? `
                <div class="tempo-conquistar-section">
                    <div class="tempo-conquistar-title">
                        <i class="ph-fill ph-hourglass-medium" style="color:#7c3aed;"></i> Tempo para conquistar cada sonho
                    </div>
                    <div class="tempo-conquistar-grid">
                        ${naoConquistados.map(s => {
                            const pctIndiv = Math.min(100, (s.valorAtual/s.valorTotal)*100);
                            const status = statusSonho(s);
                            const statusLbl = status === 'agendado' ? 'Agendado' : status === 'vencido' ? 'Vencido' : 'Em andamento';
                            const mensal = calcSonhoMensal(s.valorTotal, s.valorAtual, s.mesesRestantes);
                            const falta = Math.max(0, s.valorTotal - s.valorAtual);
                            const emoji = SONHO_CATS[s.categoria] || '🌟';
                            const corBar = pctIndiv >= 60 ? 'linear-gradient(90deg,#10b981,#059669)' : pctIndiv >= 30 ? 'linear-gradient(90deg,#f59e0b,#d97706)' : 'linear-gradient(90deg,#ef4444,#dc2626)';
                            const urgClass = corUrgenciaPorMeses(s.mesesRestantes);
                            let prazoTxt;
                            if(status === 'agendado') {
                                const d = diasAteInicioSonho(s);
                                prazoTxt = d > 30 ? formatarPrazoMeses(Math.ceil(d/30)) : `em ${d}d`;
                            } else {
                                prazoTxt = formatarPrazoMeses(s.mesesRestantes);
                            }
                            return `
                            <div class="tempo-card" onclick="document.getElementById('card_${s.id}')?.scrollIntoView({behavior:'smooth',block:'center'});if(!document.getElementById('card_${s.id}')?.classList.contains('expanded'))toggleSonhoCard('${s.id}');">
                                <div class="tempo-card-head">
                                    <div class="tempo-card-icon cat-${s.categoria}">${emoji}</div>
                                    <div class="tempo-card-info">
                                        <div class="tempo-card-nome">${s.nome}</div>
                                        <span class="tempo-card-status st-${status}">${statusLbl}</span>
                                    </div>
                                    <div>
                                        <div class="tempo-card-prazo-lbl" style="text-align:right;">${status === 'agendado' ? 'Inicia' : 'Falta'}</div>
                                        <div class="tempo-card-prazo ${urgClass}">${prazoTxt}</div>
                                    </div>
                                </div>
                                <div class="tempo-card-bar">
                                    <div class="tempo-card-bar-fill" style="width:${pctIndiv}%;background:${corBar};"></div>
                                </div>
                                <div class="tempo-card-meta">
                                    <span><strong>${formatarMoeda(mensal)}</strong>/mês</span>
                                    <span>Falta <strong>${formatarMoeda(falta)}</strong></span>
                                    <span>${pctIndiv.toFixed(0)}%</span>
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                </div>` : ''}
            </div>`;
        }

        function toggleSonhoCard(id) {
            const card = document.getElementById(`card_${id}`);
            if(card) {
                card.classList.toggle('expanded');
                // Scroll suave até o plano quando expandir
                setTimeout(() => {
                    if(card.classList.contains('expanded')) {
                        card.scrollIntoView({behavior: 'smooth', block: 'center'});
                    }
                }, 100);
            }
        }

        function pularMesSonho(id) {
            const s = sonhos.find(x => x.id === id);
            if(!s) return;
            const mesesParaDistribuir = Math.max(1, (s.mesesRestantes || s.prazoMeses) - 1);
            const novaParcelaPrevia = calcSonhoMensal(s.valorTotal, s.valorAtual, mesesParaDistribuir);
            const modal = document.getElementById('modalConfirmacao');
            document.getElementById('modalTitulo').innerHTML = `<i class="ph-fill ph-skip-forward" style="color:#f59e0b;"></i> Não vai conseguir separar este mês?`;
            document.getElementById('modalMensagem').innerHTML = `
                Sem problema — vamos recalcular o plano do sonho <strong>${s.nome}</strong>.<br><br>
                O lançamento deste mês será removido e o valor que faltava será <strong>redistribuído nos meses restantes</strong> (o prazo final continua o mesmo).<br><br>
                <em style="color:var(--cor-texto-mutado);">Próxima parcela estimada: <strong>${formatarMoeda(novaParcelaPrevia)}/mês</strong>.</em>
            `;
            document.getElementById('modalAcoes').innerHTML = `
                <button class="btn-acao" style="background:#f59e0b;" onclick="confirmarPularMes('${s.id}')"><i class="ph-bold ph-check"></i> Sim, pular e recalcular</button>
                <button class="btn-secundario" onclick="fecharModal()">Cancelar</button>
            `;
            modal.style.display = 'flex';
        }

        function confirmarPularMes(id) {
            const s = sonhos.find(x => x.id === id);
            if(!s) { fecharModal(); return; }
            // Remove transação do mês corrente (não paga). Mantém a data final do sonho:
            // como o usuário não pagou este mês, a falta é redistribuída nos meses restantes,
            // o que aumenta a próxima parcela.
            const agora = new Date();
            const m0 = agora.getMonth(), a0 = agora.getFullYear();
            transacoes = transacoes.filter(t => !(t.categoria === 'sonho' && t.sonhoId === s.id && !t.aporteExtra && !t.pago && t.mes === m0 && t.ano === a0));
            localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
            // Persiste o "mês pulado" — o render desconta esse contador de mesesEntre(agora, fim),
            // garantindo que a parcela continue maior nos próximos renders.
            s.mesesPulados = (s.mesesPulados || 0) + 1;
            const mesesParaDistribuir = Math.max(1, (s.mesesRestantes || s.prazoMeses) - 1);
            removerLancamentosFuturosSonho(s.id);
            const mensal = calcSonhoMensal(s.valorTotal, s.valorAtual, mesesParaDistribuir);
            s.aporteMensalPlano = mensal;
            s.mesesRestantes = mesesParaDistribuir;
            const mesesGerar = Math.min(60, mesesParaDistribuir);
            for(let i = 1; i <= mesesGerar; i++) {
                let m = m0 + i, a = a0;
                while(m > 11) { m -= 12; a++; }
                transacoes.push({
                    id: 'tx_' + Date.now() + '_' + i,
                    groupId: s.groupIdControle || ('sonho_grp_' + s.id),
                    sonhoId: s.id,
                    descricao: `Sonho: ${s.nome}`,
                    valor: Math.round(mensal * 100) / 100,
                    categoria: 'sonho',
                    obs: 'Compromisso mensal do sonho (recalculado)',
                    mes: m, ano: a,
                    data: new Date().toISOString(),
                    pago: false
                });
            }
            localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
            salvarSonhos();
            fecharModal();
            renderizarSonhos();
            if(typeof atualizarTelaControle === 'function') atualizarTelaControle();
            mostrarToast(`Plano ajustado: próxima parcela ${formatarMoeda(mensal)}/mês.`,'sucesso');
        }

        function toggleAllSonhos(expandir) {
            const cards = document.querySelectorAll('#sonhosListaContainer .sonho-card');
            if(cards.length === 0) return;
            cards.forEach(card => {
                if(expandir) card.classList.add('expanded');
                else card.classList.remove('expanded');
            });
            mostrarToast(expandir ? 'Todos os sonhos expandidos' : 'Todos os sonhos recolhidos','sucesso');
        }

        function selecionarEsforcoSonho(nivel) {
            document.getElementById('sonhoEsforco').value = nivel;
            document.querySelectorAll('.sonho-esforco-btn').forEach(b => {
                const n = b.getAttribute('data-nivel');
                const ativo = n === nivel;
                b.style.borderColor = ativo ? (n==='baixo'?'var(--cor-borda-primaria)':n==='medio'?'var(--cor-borda-amber)':'var(--cor-borda-erro)') : 'var(--cor-borda)';
                b.style.background = ativo ? (n==='baixo'?'var(--cor-bg-primaria)':n==='medio'?'var(--cor-bg-amber)':'var(--cor-bg-erro)') : 'var(--cor-superficie)';
            });
        }

        function abrirCadastroSonho() {
            sonhoEditandoId = null;
            document.getElementById('tituloModalSonho').querySelector('span').textContent = 'Cadastrar novo sonho';
            document.getElementById('sonhoNome').value = '';
            document.getElementById('sonhoDescricao').value = '';
            document.getElementById('sonhoValorTotal').value = '';
            document.getElementById('sonhoPrazo').value = '12';
            const unidadeNovo = document.getElementById('sonhoPrazoUnidade');
            if(unidadeNovo) unidadeNovo.value = 'meses';
            const mesIniNovo = document.getElementById('sonhoMesInicio');
            if(mesIniNovo) {
                const hoje = new Date();
                mesIniNovo.value = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;
                mesIniNovo.min = mesIniNovo.value;
            }
            document.getElementById('sonhoValorInicial').value = '';
            document.getElementById('sonhoCategoria').value = 'viagem';
            document.getElementById('sonhoEsforco').value = 'medio';
            selecionarEsforcoSonho('medio');
            document.getElementById('modalSonho').style.display = 'flex';
        }

        function fecharModalSonho() { document.getElementById('modalSonho').style.display = 'none'; }

        // Snapshot da edição em curso quando precisamos perguntar ao usuário
        // (manter aportes posteriores ou sobrescrever). Preenchido em salvarSonho()
        // e consumido em aplicarEdicaoSonhoComModo().
        let _sonhoEdicaoPendente = null;

        function abrirConfirmacaoEdicaoSonho() {
            const p = _sonhoEdicaoPendente;
            if(!p) return;
            const sAtual = sonhos[p.idx];
            const totalManter = (p.valorInicial || 0) + p.somaExtras;
            const totalSobrescrever = p.valorInicial || 0;
            const modal = document.getElementById('modalConfirmacao');
            document.getElementById('modalTitulo').innerHTML = `<i class="ph ph-question" style="color:var(--cor-info);"></i> Manter aportes posteriores?`;
            document.getElementById('modalMensagem').innerHTML = `
                Você editou o "valor já guardado" do sonho <strong>${sAtual.nome}</strong>.
                Esse sonho tem <strong>${p.qtdExtras} ${p.qtdExtras === 1 ? 'aporte posterior' : 'aportes posteriores'}</strong>
                somando <strong>${formatarMoeda(p.somaExtras)}</strong>.<br><br>
                Como quer prosseguir?
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;font-size:12.5px;">
                    <div style="padding:10px 12px;border:1px solid var(--cor-borda);border-radius:9px;background:var(--cor-superficie);">
                        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--cor-texto-mutado);margin-bottom:4px;">Manter aportes</div>
                        <div>Total = <strong style="font-family:'DM Mono',monospace;">${formatarMoeda(totalManter)}</strong></div>
                    </div>
                    <div style="padding:10px 12px;border:1px solid var(--cor-borda);border-radius:9px;background:var(--cor-branco);">
                        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--cor-texto-mutado);margin-bottom:4px;">Sobrescrever</div>
                        <div>Total = <strong style="font-family:'DM Mono',monospace;">${formatarMoeda(totalSobrescrever)}</strong> · aportes arquivados</div>
                    </div>
                </div>
            `;
            document.getElementById('modalAcoes').innerHTML = `
                <button class="btn-acao" style="background:var(--cor-info);" onclick="aplicarEdicaoSonhoComModo('manter')"><i class="ph-bold ph-stack"></i> Manter aportes</button>
                <button class="btn-acao" style="background:var(--cor-erro);" onclick="aplicarEdicaoSonhoComModo('sobrescrever')"><i class="ph-bold ph-arrow-counter-clockwise"></i> Sobrescrever</button>
                <button class="btn-secundario" onclick="cancelarEdicaoSonhoPendente()">Cancelar</button>
            `;
            modal.style.display = 'flex';
        }

        function cancelarEdicaoSonhoPendente() {
            _sonhoEdicaoPendente = null;
            fecharModal();
        }

        function aplicarEdicaoSonhoComModo(modo) {
            const p = _sonhoEdicaoPendente;
            if(!p) { fecharModal(); return; }
            const idx = p.idx;
            const sonho = sonhos[idx];
            if(!sonho) { _sonhoEdicaoPendente = null; fecharModal(); return; }

            const antes = {
                v: sonho.valorTotal,
                p: sonho.prazoMeses,
                di: sonho.dataInicio || null,
                vi: (sonho.aportes||[]).filter(a=>a.tipo==='inicial').reduce((s,a)=>s+(a.valor||0),0)
            };
            sonho.nome = p.nome;
            sonho.descricao = p.descricao;
            sonho.valorTotal = p.valorTotal;
            sonho.prazoMeses = p.prazo;
            sonho.categoria = p.categoria;
            sonho.esforco = p.esforco;
            sonho.dataInicio = p.dataInicioIso;
            sonho.dataFim = p.dataFimIso;
            sonho.mesesRestantes = p.mesesAteFim;
            sonho.mesesPulados = 0;

            const aportesNaoIniciais = (sonho.aportes || []).filter(a => a.tipo !== 'inicial');
            const valorInicial = p.valorInicial || 0;
            const dataInicialOriginal = ((sonho.aportes || []).find(a => a.tipo === 'inicial') || {}).data
                || (sonho.dataCriacao ? new Date(sonho.dataCriacao).toISOString().slice(0,10) : p.agoraIso.slice(0,10));

            if(modo === 'sobrescrever') {
                // Arquiva aportes posteriores (preserva rastreabilidade) e zera o histórico ativo.
                if(aportesNaoIniciais.length > 0) {
                    sonho.aportesArquivados = (sonho.aportesArquivados || []).concat(
                        aportesNaoIniciais.map(a => ({ ...a, arquivadoEm: p.agoraIso, motivo: 'edicao_valor' }))
                    );
                }
                sonho.valorAtual = valorInicial;
                sonho.aportes = valorInicial > 0
                    ? [{ valor: valorInicial, data: dataInicialOriginal, tipo: 'inicial' }]
                    : [];
            } else {
                // 'manter' — comportamento legado: soma extras em cima do novo valorInicial.
                const somaExtras = aportesNaoIniciais.reduce((s,a) => s + (a.valor || 0), 0);
                sonho.valorAtual = valorInicial + somaExtras;
                const aportesAtualizados = [...aportesNaoIniciais];
                if(valorInicial > 0) {
                    aportesAtualizados.unshift({ valor: valorInicial, data: dataInicialOriginal, tipo: 'inicial' });
                }
                sonho.aportes = aportesAtualizados;
            }

            const edicaoComMudancaDePlano = sonho.planoVinculado && (
                antes.v !== p.valorTotal || antes.p !== p.prazo || antes.vi !== valorInicial ||
                antes.di !== p.dataInicioIso
            );

            salvarSonhos();
            renderizarSonhos();
            fecharModalSonho();
            sonhoEditandoId = null;
            _sonhoEdicaoPendente = null;
            fecharModal();

            if(edicaoComMudancaDePlano) {
                mostrarToast(modo === 'sobrescrever' ? 'Aportes arquivados, plano recalculado.' : 'Sonho atualizado!', 'sucesso');
                removerLancamentosFuturosSonho(sonho.id);
                const mensal = calcSonhoMensal(sonho.valorTotal, sonho.valorAtual, sonho.mesesRestantes);
                const mesesGerar = Math.min(60, sonho.mesesRestantes || sonho.prazoMeses);
                const criados = gerarLancamentosMensaisSonho(sonho, mensal, mesesGerar);
                sonho.aporteMensalPlano = mensal;
                salvarSonhos();
                if(criados > 0) mostrarToast(`Plano recalculado: ${criados} lançamentos atualizados no Controle.`, 'sucesso');
                if(typeof atualizarTelaControle === 'function') atualizarTelaControle();
            } else {
                mostrarToast(modo === 'sobrescrever' ? 'Aportes arquivados.' : 'Sonho atualizado!', 'sucesso');
            }
        }

        function salvarSonho() {
            const nome = document.getElementById('sonhoNome').value.trim();
            const valorTotal = parseBRL(document.getElementById('sonhoValorTotal').value);
            const prazoBruto = parseInt(document.getElementById('sonhoPrazo').value);
            const unidadePrazo = document.getElementById('sonhoPrazoUnidade')?.value || 'meses';
            const prazo = (unidadePrazo === 'anos') ? Math.max(1, prazoBruto) * 12 : Math.max(1, prazoBruto);
            const valorInicial = parseBRL(document.getElementById('sonhoValorInicial').value);
            const categoria = document.getElementById('sonhoCategoria').value;
            const esforco = document.getElementById('sonhoEsforco').value;
            const descricao = document.getElementById('sonhoDescricao').value.trim();
            const mesInicioRaw = document.getElementById('sonhoMesInicio')?.value;

            if(!nome) { mostrarToast('Dê um nome ao seu sonho!','erro'); return; }
            if(valorTotal <= 0) { mostrarToast('Informe o valor total da meta.','erro'); return; }

            const agora = new Date();
            // dataInicio: dia 1 do mês escolhido, default = mês corrente. Não pode ser anterior ao mês corrente.
            const mesAtual = `${agora.getFullYear()}-${String(agora.getMonth()+1).padStart(2,'0')}`;
            const mesInicio = (mesInicioRaw && mesInicioRaw >= mesAtual) ? mesInicioRaw : mesAtual;
            const [iniAno, iniMes] = mesInicio.split('-').map(Number);
            const dataInicio = new Date(iniAno, iniMes - 1, 1);
            const dataFim = new Date(iniAno, iniMes - 1 + prazo, 0); // último dia do último mês do plano
            const mesesAteFim = Math.max(0, mesesEntre(agora, dataFim));

            let sonhoCriado = null;
            let edicaoComMudancaDePlano = false;
            if(sonhoEditandoId) {
                const idx = sonhos.findIndex(s => s.id === sonhoEditandoId);
                if(idx>=0) {
                    // Quando há aportes posteriores E o usuário mudou o "valor já guardado",
                    // pergunta se quer manter os aportes (somando) ou sobrescrever (arquivando-os).
                    const aportesNaoIniciaisPreview = (sonhos[idx].aportes || []).filter(a => a.tipo !== 'inicial');
                    const somaExtrasPreview = aportesNaoIniciaisPreview.reduce((s,a) => s + (a.valor || 0), 0);
                    const valorAtualAntes = sonhos[idx].valorAtual || 0;
                    const mudouValor = Math.abs((valorInicial || 0) - valorAtualAntes) > 0.01;
                    if(somaExtrasPreview > 0 && mudouValor) {
                        // Captura o snapshot e abre confirmação. O fluxo será retomado em
                        // aplicarEdicaoSonhoComModo(modo) com 'manter' ou 'sobrescrever'.
                        _sonhoEdicaoPendente = {
                            idx, nome, descricao, valorTotal, prazo, valorInicial, categoria, esforco,
                            dataInicioIso: dataInicio.toISOString(), dataFimIso: dataFim.toISOString(),
                            mesesAteFim, somaExtras: somaExtrasPreview,
                            qtdExtras: aportesNaoIniciaisPreview.length,
                            agoraIso: agora.toISOString()
                        };
                        abrirConfirmacaoEdicaoSonho();
                        return;
                    }
                    const antes = {
                        v: sonhos[idx].valorTotal,
                        p: sonhos[idx].prazoMeses,
                        di: sonhos[idx].dataInicio || null,
                        vi: (sonhos[idx].aportes||[]).filter(a=>a.tipo==='inicial').reduce((s,a)=>s+(a.valor||0),0)
                    };
                    sonhos[idx].nome = nome;
                    sonhos[idx].descricao = descricao;
                    sonhos[idx].valorTotal = valorTotal;
                    sonhos[idx].prazoMeses = prazo;
                    sonhos[idx].categoria = categoria;
                    sonhos[idx].esforco = esforco;
                    sonhos[idx].dataInicio = dataInicio.toISOString();
                    sonhos[idx].dataFim = dataFim.toISOString();
                    sonhos[idx].mesesRestantes = mesesAteFim;
                    // Plano novo = contador de meses pulados começa do zero.
                    sonhos[idx].mesesPulados = 0;
                    // Atualiza o "valor já guardado" (aporte inicial), preservando aportes posteriores
                    const aportesNaoIniciais = (sonhos[idx].aportes || []).filter(a => a.tipo !== 'inicial');
                    const somaAportesExtras = aportesNaoIniciais.reduce((s,a) => s + (a.valor || 0), 0);
                    sonhos[idx].valorAtual = (valorInicial || 0) + somaAportesExtras;
                    const aportesAtualizados = [...aportesNaoIniciais];
                    if(valorInicial > 0) {
                        const dataInicialOriginal = ((sonhos[idx].aportes || []).find(a => a.tipo === 'inicial') || {}).data
                            || (sonhos[idx].dataCriacao ? new Date(sonhos[idx].dataCriacao).toISOString().slice(0,10) : agora.toISOString().slice(0,10));
                        aportesAtualizados.unshift({ valor: valorInicial, data: dataInicialOriginal, tipo: 'inicial' });
                    }
                    sonhos[idx].aportes = aportesAtualizados;
                    edicaoComMudancaDePlano = sonhos[idx].planoVinculado && (
                        antes.v !== valorTotal || antes.p !== prazo || antes.vi !== valorInicial ||
                        antes.di !== dataInicio.toISOString()
                    );
                    sonhoCriado = sonhos[idx];
                }
            } else {
                sonhoCriado = {
                    id: 'sonho_' + Date.now(),
                    nome, descricao, valorTotal, prazoMeses: prazo,
                    valorAtual: valorInicial || 0,
                    categoria, esforco,
                    dataCriacao: agora.toISOString(),
                    dataInicio: dataInicio.toISOString(),
                    dataFim: dataFim.toISOString(),
                    mesesRestantes: mesesAteFim,
                    planoVinculado: false,
                    aportes: valorInicial > 0 ? [{valor: valorInicial, data: agora.toISOString().slice(0,10), tipo:'inicial'}] : []
                };
                sonhos.push(sonhoCriado);
            }
            salvarSonhos();
            renderizarSonhos();
            fecharModalSonho();
            const idEditado = sonhoEditandoId;
            sonhoEditandoId = null;

            if(!idEditado && sonhoCriado) {
                mostrarToast('Sonho cadastrado! 🚀','sucesso');
                setTimeout(() => pedirConfirmacaoPlanoSonho(sonhoCriado), 250);
            } else if(edicaoComMudancaDePlano && sonhoCriado) {
                mostrarToast('Sonho atualizado!','sucesso');
                removerLancamentosFuturosSonho(sonhoCriado.id);
                const mensal = calcSonhoMensal(sonhoCriado.valorTotal, sonhoCriado.valorAtual, sonhoCriado.mesesRestantes);
                const mesesGerar = Math.min(60, sonhoCriado.mesesRestantes || sonhoCriado.prazoMeses);
                const criados = gerarLancamentosMensaisSonho(sonhoCriado, mensal, mesesGerar);
                sonhoCriado.aporteMensalPlano = mensal;
                salvarSonhos();
                if(criados > 0) mostrarToast(`Plano recalculado: ${criados} lançamentos atualizados no Controle.`,'sucesso');
                if(typeof atualizarTelaControle === 'function') atualizarTelaControle();
            } else {
                mostrarToast('Sonho atualizado!','sucesso');
            }
        }

        function editarSonho(id) {
            const s = sonhos.find(x => x.id === id);
            if(!s) return;
            sonhoEditandoId = id;
            document.getElementById('tituloModalSonho').querySelector('span').textContent = 'Editar sonho';
            const unidadeEdit = document.getElementById('sonhoPrazoUnidade');
            if(unidadeEdit) {
                // Mostra em anos se o prazo é múltiplo exato de 12 e >= 12; senão em meses
                if(s.prazoMeses && s.prazoMeses >= 12 && s.prazoMeses % 12 === 0) {
                    unidadeEdit.value = 'anos';
                    document.getElementById('sonhoPrazo').value = s.prazoMeses / 12;
                } else {
                    unidadeEdit.value = 'meses';
                    document.getElementById('sonhoPrazo').value = s.prazoMeses;
                }
            }
            document.getElementById('sonhoNome').value = s.nome;
            document.getElementById('sonhoDescricao').value = s.descricao || '';
            setValorBRLInput(document.getElementById('sonhoValorTotal'), s.valorTotal);
            // Mês de início — se o sonho ainda não começou, permite escolher mês futuro;
            // se já iniciou, fixa no mês original (não permite voltar pro passado).
            const mesIniEdit = document.getElementById('sonhoMesInicio');
            if(mesIniEdit) {
                const hoje = new Date();
                const mesAtualStr = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;
                if(s.dataInicio) {
                    const dIni = new Date(s.dataInicio);
                    const mesIniSonho = `${dIni.getFullYear()}-${String(dIni.getMonth()+1).padStart(2,'0')}`;
                    mesIniEdit.value = mesIniSonho;
                    // Se o sonho já iniciou, não permite mover para o passado (data fixa); senão, mín = mês atual
                    mesIniEdit.min = (mesIniSonho < mesAtualStr) ? mesIniSonho : mesAtualStr;
                } else {
                    mesIniEdit.value = mesAtualStr;
                    mesIniEdit.min = mesAtualStr;
                }
            }
            // Prazo já foi preenchido acima respeitando a unidade selecionada
            setValorBRLInput(document.getElementById('sonhoValorInicial'), s.valorAtual);
            document.getElementById('sonhoCategoria').value = s.categoria;
            selecionarEsforcoSonho(s.esforco || 'medio');
            document.getElementById('modalSonho').style.display = 'flex';
        }

        function excluirSonho(id) {
            const s = sonhos.find(x => x.id === id);
            if(!s) return;
            const aportesCount = (s.aportes || []).length;
            const pct = s.valorTotal > 0 ? Math.min(100, (s.valorAtual / s.valorTotal) * 100) : 0;
            // Conta quantas tx no Controle estão vinculadas (parcelas + aportes extras + resgates)
            const txsVinculadas = transacoes.filter(t => t.sonhoId === id);
            const totalTxs = txsVinculadas.length;
            const txsPagas = txsVinculadas.filter(t => t.pago).length;
            const totalMovido = txsVinculadas.filter(t => t.pago && t.categoria === 'sonho').reduce((acc,t) => acc + (t.valor || 0), 0);

            const modal = document.getElementById('modalConfirmacao');
            document.getElementById('modalTitulo').innerHTML = `<i class="ph-fill ph-trash" style="color:var(--cor-erro);"></i> Excluir o sonho "${s.nome}"?`;
            document.getElementById('modalMensagem').innerHTML = `
                <div style="display:flex;flex-direction:column;gap:12px;">
                    <p style="margin:0;">Confira o resumo do sonho antes de decidir:</p>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 12px;border:1px solid var(--cor-borda);border-radius:9px;background:var(--cor-superficie);font-size:12.5px;">
                        <div><span style="color:var(--cor-texto-mutado);">Meta:</span> <strong style="font-family:'DM Mono',monospace;">${formatarMoeda(s.valorTotal)}</strong></div>
                        <div><span style="color:var(--cor-texto-mutado);">Guardado:</span> <strong style="font-family:'DM Mono',monospace;color:#10b981;">${formatarMoeda(s.valorAtual)}</strong></div>
                        <div><span style="color:var(--cor-texto-mutado);">Progresso:</span> <strong>${pct.toFixed(0)}%</strong></div>
                        <div><span style="color:var(--cor-texto-mutado);">Aportes:</span> <strong>${aportesCount}</strong></div>
                    </div>
                    ${totalTxs > 0 ? `<div style="padding:10px 12px;border:1px solid var(--cor-borda);border-radius:9px;background:var(--cor-branco);font-size:12.5px;">
                        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--cor-texto-mutado);margin-bottom:4px;">Lançamentos vinculados no Controle</div>
                        <div>${totalTxs} ${totalTxs === 1 ? 'lançamento' : 'lançamentos'} no total — <strong>${txsPagas}</strong> pago${txsPagas === 1 ? '' : 's'} (${formatarMoeda(totalMovido)}) e <strong>${totalTxs - txsPagas}</strong> pendente${totalTxs - txsPagas === 1 ? '' : 's'}.</div>
                    </div>` : ''}
                    <p style="margin:0;font-size:12.5px;color:var(--cor-texto-mutado);">Como você quer prosseguir?</p>
                </div>
            `;
            document.getElementById('modalAcoes').innerHTML = `
                <button class="btn-acao" style="background:var(--cor-erro);" onclick="confirmarExcluirSonhoCompleto('${id}')" title="Apaga o sonho e todas as transações vinculadas no Controle (incluindo as já pagas).">
                    <i class="ph-bold ph-trash"></i> Excluir tudo (sonho + Controle)
                </button>
                <button class="btn-acao" style="background:var(--cor-info);" onclick="confirmarExcluirSonho('${id}')" title="Mantém o histórico de pagamentos no Controle. Só remove o sonho e seus compromissos futuros.">
                    <i class="ph ph-archive-tray"></i> Só o sonho (mantém histórico)
                </button>
                <button class="btn-secundario" onclick="fecharModal()">Cancelar</button>
            `;
            modal.style.display = 'flex';
        }

        function confirmarExcluirSonho(id) {
            removerLancamentosFuturosSonho(id);
            sonhos = sonhos.filter(s => s.id !== id);
            salvarSonhos();
            fecharModal();
            renderizarSonhos();
            if(typeof atualizarTelaControle === 'function') atualizarTelaControle();
            mostrarToast('Sonho removido. Histórico mantido.','aviso');
        }

        function confirmarExcluirSonhoCompleto(id) {
            // Remove tudo: o sonho, suas tx vinculadas no Controle (pagas ou não, em qualquer mês),
            // incluindo aportes extras e resgates de migração que referenciam este sonho.
            const txsAntes = transacoes.length;
            transacoes = transacoes.filter(t => t.sonhoId !== id);
            const removidas = txsAntes - transacoes.length;
            if(removidas > 0) localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
            sonhos = sonhos.filter(s => s.id !== id);
            salvarSonhos();
            fecharModal();
            renderizarSonhos();
            if(typeof atualizarTelaControle === 'function') atualizarTelaControle();
            mostrarToast(`Sonho e ${removidas} ${removidas === 1 ? 'lançamento removido' : 'lançamentos removidos'} do Controle.`,'aviso');
        }

        // ============================================================
        // === Histórico de aportes do sonho (editar/excluir) ========
        // ============================================================
        function renderHistoricoAportesSonho(s) {
            const aportes = (s.aportes || []).slice();
            if(aportes.length === 0) return '';
            // Garante id estável para aportes legados (sem id) — útil para edit/exclude
            let mudou = false;
            aportes.forEach((a, i) => {
                if(!a.id) { a.id = 'aporte_legacy_' + s.id + '_' + i; mudou = true; }
            });
            if(mudou) { s.aportes = aportes; salvarSonhos(); }

            const tipoMeta = (a) => {
                if(a.tipo === 'inicial') return { cls: 'tipo-inicial', tag: 't-inicial', label: 'Inicial', icon: 'ph-piggy-bank' };
                if(a.tipo === 'mensal_pago' || a.origem === 'compromisso') return { cls: 'tipo-mensal', tag: 't-mensal', label: 'Mensal pago', icon: 'ph-calendar-check' };
                if(a.origem === 'migracao') return { cls: 'tipo-migracao', tag: 't-migracao', label: 'Migração', icon: 'ph-arrows-left-right' };
                if(a.origem === 'esporadico') return { cls: 'tipo-esporadico', tag: 't-esporadico', label: 'Esporádico', icon: 'ph-coin' };
                return { cls: 'tipo-aporte', tag: 't-aporte', label: 'Aporte', icon: 'ph-plus-circle' };
            };

            const total = aportes.reduce((acc,a) => acc + (a.valor || 0), 0);
            const linhas = aportes.slice().sort((a,b) => (b.data || '').localeCompare(a.data || '')).map(a => {
                const meta = tipoMeta(a);
                const dataFmt = a.data ? new Date(a.data + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
                const detalhe = a.origemAtivo ? ` · de ${a.origemAtivo}` : (a.origemDesc ? ` · ${a.origemDesc}` : '');
                return `<div class="aporte-item">
                    <div class="aporte-marker ${meta.cls}" title="${meta.label}"><i class="ph-fill ${meta.icon}"></i></div>
                    <div class="aporte-info">
                        <div class="aporte-titulo-row">
                            <span class="aporte-valor">${formatarMoeda(a.valor)}</span>
                            <span class="aporte-tipo-tag ${meta.tag}">${meta.label}</span>
                        </div>
                        <div class="aporte-meta">${dataFmt}${detalhe}</div>
                    </div>
                    <div class="aporte-acoes">
                        <button class="aporte-btn info" onclick="event.stopPropagation();editarAporteSonho('${s.id}','${a.id}')" title="Editar"><i class="ph ph-pencil-simple"></i></button>
                        <button class="aporte-btn danger" onclick="event.stopPropagation();excluirAporteSonho('${s.id}','${a.id}')" title="Excluir"><i class="ph ph-trash"></i></button>
                    </div>
                </div>`;
            }).join('');
            return `<div class="aportes-timeline">
                <div class="aportes-timeline-head">
                    <span><i class="ph-fill ph-clock-counter-clockwise"></i> Histórico de aportes (${aportes.length})</span>
                    <span style="font-family:'DM Mono',monospace;color:var(--cor-texto-principal);font-weight:700;">${formatarMoeda(total)}</span>
                </div>
                <div class="aportes-timeline-list">${linhas}</div>
            </div>`;
        }

        function editarAporteSonho(sonhoId, aporteId) {
            const s = sonhos.find(x => x.id === sonhoId);
            if(!s) return;
            const aporte = (s.aportes || []).find(a => a.id === aporteId);
            if(!aporte) return mostrarToast('Aporte não encontrado.','erro');

            const modal = document.getElementById('modalConfirmacao');
            const tipoTxt = aporte.tipo === 'inicial' ? 'aporte inicial' : 'aporte';
            document.getElementById('modalTitulo').innerHTML = `<i class="ph ph-pencil-simple" style="color:var(--cor-info);"></i> Editar ${tipoTxt}`;
            document.getElementById('modalMensagem').innerHTML = `
                <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--cor-texto-mutado);">Valor (R$)</label>
                <span class="input-brl-wrap" style="margin-bottom:10px;display:block;">
                    <input id="editAporteValor" type="text" inputmode="decimal" data-brl="1" oninput="aplicarMascaraBRL(this)" value="${formatarBRLInput(aporte.valor)}" style="width:100%;padding:10px 13px;border:1.5px solid var(--cor-borda);border-radius:9px;font-size:13px;background:var(--cor-superficie);color:var(--cor-texto-principal);font-family:'Figtree',sans-serif;">
                </span>
                <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--cor-texto-mutado);">Data</label>
                <input id="editAporteData" type="date" value="${aporte.data || new Date().toISOString().slice(0,10)}" style="width:100%;padding:10px 13px;border:1.5px solid var(--cor-borda);border-radius:9px;font-size:13px;background:var(--cor-superficie);color:var(--cor-texto-principal);font-family:'Figtree',sans-serif;">
            `;
            document.getElementById('modalAcoes').innerHTML = `
                <button class="btn-acao" style="background:var(--cor-info);" onclick="salvarEdicaoAporteSonho('${sonhoId}','${aporteId}')"><i class="ph-bold ph-check"></i> Salvar</button>
                <button class="btn-secundario" onclick="fecharModal()">Cancelar</button>
            `;
            modal.style.display = 'flex';
        }

        function salvarEdicaoAporteSonho(sonhoId, aporteId) {
            const s = sonhos.find(x => x.id === sonhoId);
            if(!s) { fecharModal(); return; }
            const aporte = (s.aportes || []).find(a => a.id === aporteId);
            if(!aporte) { fecharModal(); return; }

            const novoValor = parseBRL(document.getElementById('editAporteValor').value);
            const novaData = document.getElementById('editAporteData').value;
            if(novoValor <= 0) { mostrarToast('Informe um valor maior que zero.','erro'); return; }

            const delta = novoValor - aporte.valor;
            aporte.valor = novoValor;
            if(novaData) aporte.data = novaData;
            s.valorAtual = Math.max(0, s.valorAtual + delta);

            // Espelha alteração na transação vinculada (se houver)
            if(aporte.txId) {
                const tx = transacoes.find(t => t.id === aporte.txId);
                if(tx) tx.valor = novoValor;
            }
            if(aporte.txResgateId) {
                const txr = transacoes.find(t => t.id === aporte.txResgateId);
                if(txr) txr.valor = novoValor;
            }
            localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));

            // Recalcula plano (se vinculado)
            if(s.planoVinculado && s.valorAtual < s.valorTotal) {
                const novoMensal = calcSonhoMensal(s.valorTotal, s.valorAtual, s.mesesRestantes || s.prazoMeses);
                removerLancamentosFuturosSonho(s.id);
                gerarLancamentosMensaisSonho(s, novoMensal, Math.min(60, s.mesesRestantes || s.prazoMeses));
                s.aporteMensalPlano = novoMensal;
            }

            salvarSonhos();
            fecharModal();
            renderizarSonhos();
            if(typeof atualizarTelaControle === 'function') atualizarTelaControle();
            mostrarToast('Aporte atualizado.','sucesso');
        }

        function excluirAporteSonho(sonhoId, aporteId) {
            const s = sonhos.find(x => x.id === sonhoId);
            if(!s) return;
            const aporte = (s.aportes || []).find(a => a.id === aporteId);
            if(!aporte) return;

            const tipoTxt = aporte.tipo === 'inicial' ? 'aporte inicial' : 'aporte';
            const modal = document.getElementById('modalConfirmacao');
            document.getElementById('modalTitulo').innerHTML = `<i class="ph ph-trash" style="color:var(--cor-erro);"></i> Excluir ${tipoTxt}?`;
            document.getElementById('modalMensagem').innerHTML = `
                Esta ação vai <strong>remover ${formatarMoeda(aporte.valor)}</strong> do total guardado do sonho <strong>${s.nome}</strong>${aporte.txId ? ', e também os lançamentos vinculados no Controle Financeiro' : ''}.<br><br>
                <em style="color:var(--cor-texto-mutado);">A próxima parcela mensal será recalculada automaticamente.</em>
            `;
            document.getElementById('modalAcoes').innerHTML = `
                <button class="btn-acao" style="background:var(--cor-erro);" onclick="confirmarExcluirAporteSonho('${sonhoId}','${aporteId}')"><i class="ph-bold ph-trash"></i> Sim, excluir</button>
                <button class="btn-secundario" onclick="fecharModal()">Cancelar</button>
            `;
            modal.style.display = 'flex';
        }

        function confirmarExcluirAporteSonho(sonhoId, aporteId) {
            const s = sonhos.find(x => x.id === sonhoId);
            if(!s) { fecharModal(); return; }
            const aporte = (s.aportes || []).find(a => a.id === aporteId);
            if(!aporte) { fecharModal(); return; }

            // Remove transações vinculadas
            const idsParaRemover = [];
            if(aporte.txId) idsParaRemover.push(aporte.txId);
            if(aporte.txResgateId) idsParaRemover.push(aporte.txResgateId);
            if(idsParaRemover.length > 0) {
                transacoes = transacoes.filter(t => !idsParaRemover.includes(t.id));
                localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
            }

            // Reverte o valor
            s.valorAtual = Math.max(0, s.valorAtual - aporte.valor);
            s.aportes = (s.aportes || []).filter(a => a.id !== aporteId);

            // Recalcula plano
            if(s.planoVinculado && s.valorAtual < s.valorTotal) {
                const novoMensal = calcSonhoMensal(s.valorTotal, s.valorAtual, s.mesesRestantes || s.prazoMeses);
                removerLancamentosFuturosSonho(s.id);
                gerarLancamentosMensaisSonho(s, novoMensal, Math.min(60, s.mesesRestantes || s.prazoMeses));
                s.aporteMensalPlano = novoMensal;
            }

            salvarSonhos();
            fecharModal();
            renderizarSonhos();
            if(typeof atualizarTelaControle === 'function') atualizarTelaControle();
            mostrarToast('Aporte removido.','aviso');
        }

        function abrirAporteSonho(id) {
            document.getElementById('aportesonhoId').value = id;
            document.getElementById('aportesonhoValor').value = '';
            document.getElementById('aportesonhoData').value = new Date().toISOString().slice(0,10);
            document.getElementById('modalAporteSonho').style.display = 'flex';
        }
        function fecharModalAporteSonho() { document.getElementById('modalAporteSonho').style.display = 'none'; }

        function registrarAporteSonho() {
            const id = document.getElementById('aportesonhoId').value;
            const valor = parseBRL(document.getElementById('aportesonhoValor').value);
            const data = document.getElementById('aportesonhoData').value;
            if(valor <= 0) { mostrarToast('Informe o valor do aporte.','erro'); return; }
            const s = sonhos.find(x => x.id === id);
            if(!s) return;
            // Antes de gravar, perguntar origem do aporte para vincular ao Controle
            fecharModalAporteSonho();
            perguntarOrigemAporteSonho(s, valor, data);
        }

        function perguntarOrigemAporteSonho(sonho, valor, dataStr) {
            const modal = document.getElementById('modalConfirmacao');
            document.getElementById('modalTitulo').innerHTML = `<i class="ph-fill ph-piggy-bank" style="color:var(--cor-primaria);"></i> De onde vem este aporte?`;
            document.getElementById('modalMensagem').innerHTML = `
                Aporte de <strong style="font-family:'DM Mono',monospace;color:var(--cor-primaria);">${formatarMoeda(valor)}</strong>
                para o sonho <strong>${sonho.nome}</strong>.<br><br>
                Para refletir corretamente no seu Controle Financeiro, escolha a origem do dinheiro:
            `;
            document.getElementById('modalAcoes').innerHTML = `
                <button class="btn-acao" style="background:var(--cor-primaria);" onclick="finalizarAporteSonho('${sonho.id}',${valor},'${dataStr}','esporadico')"><i class="ph ph-coin"></i> Esporádico (sobra do mês)</button>
                <button class="btn-acao" style="background:#0ea5e9;" onclick="abrirEscolhaAtivoMigracao('${sonho.id}',${valor},'${dataStr}')"><i class="ph ph-arrows-left-right"></i> Migração de investimento</button>
                <button class="btn-secundario" onclick="finalizarAporteSonho('${sonho.id}',${valor},'${dataStr}','sem_lancar')">Não lançar no Controle</button>
            `;
            modal.style.display = 'flex';
        }

        function abrirEscolhaAtivoMigracao(sonhoId, valor, dataStr) {
            const sonho = sonhos.find(x => x.id === sonhoId);
            if(!sonho) return;
            const carteira = (typeof obterResumoCarteira === 'function') ? obterResumoCarteira() : {};
            const tickers = Object.keys(carteira)
                .filter(t => carteira[t].qtdTotal > 0)
                .sort((a,b) => a.localeCompare(b));

            const opcoesAtivos = tickers.map(t => {
                const a = carteira[t];
                const am = (typeof mockAtivosMercado !== 'undefined') ? mockAtivosMercado.find(x => x.ticker === t) : null;
                const preco = am ? am.preco_atual : a.precoMedio;
                const saldo = a.qtdTotal * preco;
                return `<option value="${t}">${t} — ${formatarMoeda(saldo)} (${a.qtdTotal} cotas)</option>`;
            }).join('');

            const modal = document.getElementById('modalConfirmacao');
            document.getElementById('modalTitulo').innerHTML = `<i class="ph ph-arrows-left-right" style="color:#0ea5e9;"></i> De qual investimento veio?`;
            document.getElementById('modalMensagem').innerHTML = `
                <p style="margin-bottom:10px;">Indique de onde saiu o dinheiro de <strong style="font-family:'DM Mono',monospace;color:#0ea5e9;">${formatarMoeda(valor)}</strong>:</p>
                ${tickers.length > 0 ? `
                    <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--cor-texto-mutado);">Ativo</label>
                    <select id="selOrigemMigracao" style="width:100%;padding:10px 13px;border:1.5px solid var(--cor-borda);border-radius:9px;font-size:13px;background:var(--cor-superficie);color:var(--cor-texto-principal);font-family:'Figtree',sans-serif;margin-bottom:10px;">
                        ${opcoesAtivos}
                        <option value="__outro__">Outro / não está na carteira</option>
                    </select>
                ` : `<p style="color:var(--cor-texto-mutado);font-size:12px;margin-bottom:8px;"><em>Sua carteira está vazia. Descreva manualmente abaixo.</em></p>`}
                <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--cor-texto-mutado);">Descrição (opcional)</label>
                <input id="inputDescOrigemMigracao" type="text" placeholder="Ex: Vendi ações do Bradesco" style="width:100%;padding:10px 13px;border:1.5px solid var(--cor-borda);border-radius:9px;font-size:13px;background:var(--cor-superficie);color:var(--cor-texto-principal);font-family:'Figtree',sans-serif;">
            `;
            document.getElementById('modalAcoes').innerHTML = `
                <button class="btn-acao" style="background:#0ea5e9;" onclick="confirmarOrigemMigracao('${sonhoId}',${valor},'${dataStr}')"><i class="ph-bold ph-check"></i> Confirmar migração</button>
                <button class="btn-secundario" onclick="fecharModal()">Cancelar</button>
            `;
            modal.style.display = 'flex';
        }

        function confirmarOrigemMigracao(sonhoId, valor, dataStr) {
            const sel = document.getElementById('selOrigemMigracao');
            const descIn = document.getElementById('inputDescOrigemMigracao');
            const ticker = sel ? sel.value : '__outro__';
            const descLivre = (descIn?.value || '').trim();
            const origemAtivo = (ticker && ticker !== '__outro__') ? ticker : null;
            const origemDesc = descLivre || (origemAtivo ? `Resgate de ${origemAtivo}` : 'Resgate (origem não especificada)');
            finalizarAporteSonho(sonhoId, valor, dataStr, 'migracao', { origemAtivo, origemDesc });
        }

        function finalizarAporteSonho(sonhoId, valor, dataStr, origem, detalhes) {
            const s = sonhos.find(x => x.id === sonhoId);
            if(!s) { fecharModal(); return; }
            const origemAtivo = detalhes?.origemAtivo || null;
            const origemDesc = detalhes?.origemDesc || null;
            s.valorAtual += valor;
            if(!s.aportes) s.aportes = [];
            s.aportes.push({valor, data: dataStr, tipo:'aporte', origem, origemAtivo, origemDesc, id: 'aporte_' + Date.now()});

            if(origem !== 'sem_lancar') {
                const d = dataStr ? new Date(dataStr+'T12:00:00') : new Date();
                const obs = origem === 'migracao'
                    ? `Aporte extra (migração${origemAtivo ? ' de ' + origemAtivo : ''}) — ${s.nome}`
                    : `Aporte extra (esporádico) — ${s.nome}`;
                const txId = 'tx_' + Date.now();
                transacoes.push({
                    id: txId,
                    sonhoId: s.id,
                    aporteExtra: true,
                    descricao: `Sonho: ${s.nome} — aporte extra`,
                    valor: valor,
                    categoria: 'sonho',
                    obs,
                    mes: d.getMonth(), ano: d.getFullYear(),
                    data: d.toISOString(),
                    pago: true
                });
                // Anota o id da transação no aporte para permitir exclusão coordenada
                s.aportes[s.aportes.length - 1].txId = txId;
                // Se for migração, registra também o resgate para não duplicar impacto no orçamento
                if(origem === 'migracao') {
                    const txResId = 'tx_' + Date.now() + '_r';
                    transacoes.push({
                        id: txResId,
                        sonhoId: s.id,
                        descricao: origemDesc || `Resgate p/ sonho: ${s.nome}`,
                        valor: valor,
                        categoria: 'resgate_investimento',
                        obs: origemAtivo
                            ? `Resgate de ${origemAtivo} — destino: sonho ${s.nome}`
                            : `Compensação do aporte extra do sonho ${s.nome}`,
                        mes: d.getMonth(), ano: d.getFullYear(),
                        data: d.toISOString(),
                        pago: true,
                        ativoOrigem: origemAtivo || undefined
                    });
                    s.aportes[s.aportes.length - 1].txResgateId = txResId;
                }
                localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
                if(typeof atualizarTelaControle === 'function') atualizarTelaControle();
            }

            // Aporte extra reduz a falta — recalcula a parcela mensal e regenera
            // os lançamentos futuros, para refletir a nova realidade do plano.
            let novoMensal = 0;
            if(s.planoVinculado && s.valorAtual < s.valorTotal) {
                const mesesGerar = Math.min(60, s.mesesRestantes || s.prazoMeses);
                novoMensal = calcSonhoMensal(s.valorTotal, s.valorAtual, s.mesesRestantes || s.prazoMeses);
                removerLancamentosFuturosSonho(s.id);
                gerarLancamentosMensaisSonho(s, novoMensal, mesesGerar);
                s.aporteMensalPlano = novoMensal;
                if(typeof atualizarTelaControle === 'function') atualizarTelaControle();
            }

            salvarSonhos();
            renderizarSonhos();
            fecharModal();
            const pct = (s.valorAtual/s.valorTotal)*100;
            if(pct >= 100) mostrarToast('🎉 Parabéns! Você conquistou seu sonho!','sucesso',5000);
            else if(novoMensal > 0) mostrarToast(`Aporte registrado! Próxima parcela: ${formatarMoeda(novoMensal)}/mês (${pct.toFixed(0)}% concluído).`,'sucesso');
            else mostrarToast(`Aporte de ${formatarMoeda(valor)} registrado! Agora ${pct.toFixed(0)}% concluído.`,'sucesso');
        }

        // ============================================================
        // === APPLICASH $ — programa de indicações                   ===
        // ============================================================
        const APPLICASH_CONFIG = {
            cupomKey: 'appliquei_cupom_codigo',
            indicacoesKey: 'appliquei_applicash_indicacoes',
            assinaturaKey: 'appliquei_applicash_assinatura',
            comissaoPct: 0.10,        // 10% do valor pago
            descontoCupomPct: 0.10    // 10% de desconto p/ o assinante
        };
        const APPLICASH_METAS = [
            { qtd: 1,  desc: 9,   recompensa: 'Cashback ativado · economia garantida todo mês' },
            { qtd: 5,  desc: 45,  recompensa: 'Quase metade da mensalidade paga por amigos' },
            { qtd: 10, desc: 90,  recompensa: 'A 1 amigo da sua mensalidade zerar' },
            { qtd: 12, desc: 100, recompensa: '🏆 Assinatura ZERADA · Appliquei grátis para sempre' },
            { qtd: 30, desc: 100, recompensa: '🌟 Status Embaixador · brindes + destaque na comunidade' }
        ];

        function gerarCupomPadrao() {
            // Cria um cupom estável a partir de um id local persistente
            let id = localStorage.getItem('appliquei_user_id');
            if(!id) {
                id = Math.random().toString(36).slice(2, 8).toUpperCase();
                localStorage.setItem('appliquei_user_id', id);
            }
            return `APP-${id}`;
        }
        function obterCupomApplicash() {
            const cupom = localStorage.getItem(APPLICASH_CONFIG.cupomKey);
            if (cupom && /^APP-[A-Z0-9]{6}$/.test(cupom)) return cupom;
            const fb = window.AppliqueiFirebase;
            const logged = fb && fb.ready && fb.auth && fb.auth.currentUser;
            return logged ? 'A carregar…' : 'Entre na sua conta';
        }
        function obterAssinaturaApplicash() {
            try {
                const raw = localStorage.getItem(APPLICASH_CONFIG.assinaturaKey);
                if(raw) return JSON.parse(raw);
            } catch(_) {}
            // Default: plano mensal R$ 15,00
            return { plano: 'Mensal', valorMensal: 15.00 };
        }
        function carregarIndicacoesApplicash() {
            try {
                const raw = localStorage.getItem(APPLICASH_CONFIG.indicacoesKey);
                if(raw) return JSON.parse(raw);
            } catch(_) {}
            // Mock inicial vazio — em produção viria do backend
            return [];
        }
        function mascararNome(nome) {
            if(!nome) return '—';
            const partes = nome.trim().split(/\s+/);
            return partes.map((p, i) => {
                if(p.length <= 2) return p;
                if(i === 0) return p[0].toUpperCase() + '*'.repeat(Math.max(1, p.length - 2)) + p.slice(-1);
                return p[0].toUpperCase() + '.';
            }).join(' ');
        }

        let chartApplicash = null;
        async function atualizarTelaApplicash() {
            try {
                if (window.AppliqueiBilling && typeof AppliqueiBilling.syncApplicash === 'function') {
                    await AppliqueiBilling.syncApplicash();
                }
            } catch (_) {}
            const cupom = obterCupomApplicash();
            const assinatura = obterAssinaturaApplicash();
            const indicacoes = carregarIndicacoesApplicash();

            // KPIs
            const elCupom = document.getElementById('apcCupomCodigo');
            if(elCupom) elCupom.innerText = cupom;

            // Hero — preenche pill do link
            const elHeroLink = document.getElementById('apcHeroLinkUrl');
            const elHeroPill = document.getElementById('apcHeroLinkPill');
            if (elHeroLink && cupomValido(cupom)) {
                const link = gerarLinkApplicash(cupom);
                const displayUrl = link.replace(/^https?:\/\//, '');
                elHeroLink.innerText = displayUrl;
                if (elHeroPill) elHeroPill.title = link;
            } else if (elHeroLink) {
                elHeroLink.innerText = 'Entre na sua conta para gerar o link';
                if (elHeroPill) elHeroPill.title = '';
            }

            // Banner resumo do servidor (desconto pendente / próxima cobrança)
            try {
                const resumoRaw = localStorage.getItem('appliquei_applicash_resumo');
                const resumo = resumoRaw ? JSON.parse(resumoRaw) : null;
                const banner = document.getElementById('apcResumoServidor');
                if (banner && resumo) {
                    const pend = (resumo.pendingDiscountCents || 0) / 100;
                    const prox = (resumo.projectedNextBillCents || 0) / 100;
                    if (pend > 0) {
                        document.getElementById('apcResumoTexto').innerText = `Sua próxima mensalidade já tem ${formatarMoeda(pend)} de abatimento.`;
                        document.getElementById('apcResumoDetalhe').innerText = `Próxima cobrança estimada: ${formatarMoeda(prox)} · ${resumo.activeReferrals || 0} indicado(s) ativo(s).`;
                        banner.style.display = '';
                    } else {
                        banner.style.display = 'none';
                    }
                }
            } catch(_) {}

            const ativos = indicacoes.filter(i => i.status === 'ativo');
            const efetivas = ativos.length;
            document.getElementById('apcIndicacoesEfetivas').innerText = efetivas;

            // Indicações no mês corrente
            const hoje = new Date();
            const noMes = indicacoes.filter(i => {
                if(!i.dataAdesao) return false;
                const d = new Date(i.dataAdesao);
                return d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth();
            }).length;
            document.getElementById('apcIndicacoesNoMes').innerText = noMes;

            const valorPaga = assinatura.valorMensal || 0;
            // Recebe = 10% sobre o valor pago por cada indicação ativa (mensal equivalente)
            const valorRecebe = ativos.reduce((acc, i) => acc + (Number(i.valorPago || 0) * APPLICASH_CONFIG.comissaoPct), 0);

            document.getElementById('apcVocePaga').innerText = formatarMoeda(valorPaga);
            document.getElementById('apcVoceRecebe').innerText = formatarMoeda(valorRecebe);
            document.getElementById('apcLegendaPaga').innerText = formatarMoeda(valorPaga);
            document.getElementById('apcLegendaRecebe').innerText = formatarMoeda(valorRecebe);
            document.getElementById('apcTotalReceberMes').innerText = formatarMoeda(valorRecebe);

            // Frase condicionada ao cenário
            const frase = document.getElementById('apcFraseCenario');
            if(frase) {
                if(efetivas === 0) {
                    frase.innerHTML = `Você ainda não tem indicações ativas. Compartilhe seu cupom <strong>${cupom}</strong> e comece a receber 10% do valor pago por cada amigo que assinar a Appliquei.`;
                    frase.style.background = 'var(--cor-bg-info)';
                    frase.style.borderColor = 'var(--cor-borda-info)';
                    frase.style.color = 'var(--cor-txt-info)';
                } else if(valorRecebe < valorPaga) {
                    const falta = valorPaga - valorRecebe;
                    frase.innerHTML = `Faltam <strong>${formatarMoeda(falta)}/mês</strong> para sua assinatura ficar de graça. Continue indicando!`;
                    frase.style.background = 'var(--cor-bg-amber)';
                    frase.style.borderColor = 'var(--cor-borda-amber)';
                    frase.style.color = 'var(--cor-txt-amber)';
                } else if(Math.abs(valorRecebe - valorPaga) < 0.01) {
                    frase.innerHTML = `🎯 Sua assinatura está paga! Você recebe exatamente o que paga. A próxima indicação vira lucro líquido.`;
                    frase.style.background = 'var(--cor-bg-primaria)';
                    frase.style.borderColor = 'var(--cor-borda-primaria)';
                    frase.style.color = 'var(--cor-txt-primaria)';
                } else {
                    const lucro = valorRecebe - valorPaga;
                    frase.innerHTML = `🎉 O seu plano está de graça e você ainda lucra <strong>${formatarMoeda(lucro)}/mês</strong>. Continue indicando para multiplicar seus ganhos.`;
                    frase.style.background = 'var(--cor-bg-primaria)';
                    frase.style.borderColor = 'var(--cor-borda-primaria)';
                    frase.style.color = 'var(--cor-txt-primaria)';
                }
            }

            // Empty state da pizza: quando 0 indicações efetivas, troca o gráfico por um CTA grande
            const pizzaContent = document.getElementById('apcPizzaContent');
            const pizzaEmpty = document.getElementById('apcEmptyCta');
            if (pizzaContent && pizzaEmpty) {
                if (efetivas === 0) {
                    pizzaContent.style.display = 'none';
                    pizzaEmpty.style.display = 'block';
                } else {
                    pizzaContent.style.display = 'flex';
                    pizzaEmpty.style.display = 'none';
                }
            }

            // Gráfico pizza
            const canvas = document.getElementById('chartApplicash');
            if (efetivas === 0 && chartApplicash) { chartApplicash.destroy(); chartApplicash = null; }
            if(canvas && efetivas > 0) {
                if(chartApplicash) chartApplicash.destroy();
                const ctx = canvas.getContext('2d');
                const dadosPizza = (valorPaga + valorRecebe) > 0
                    ? [valorRecebe, valorPaga]
                    : [0.5, 0.5];
                const corBorda = getToken('--cor-branco');
                const corPaga = getToken('--cor-erro');
                const corRecebe = getToken('--cor-primaria');
                chartApplicash = new Chart(ctx, {
                    type: 'pie',
                    data: {
                        labels: ['Você recebe', 'Você paga'],
                        datasets: [{
                            data: dadosPizza,
                            backgroundColor: [corRecebe, corPaga],
                            borderWidth: 3,
                            borderColor: corBorda,
                            hoverOffset: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            datalabels: {
                                color: '#fff',
                                font: { family: "'Figtree', sans-serif", weight: '700', size: 12 },
                                formatter: (v) => {
                                    const total = valorPaga + valorRecebe;
                                    if(total <= 0) return '';
                                    return `${(v/total*100).toFixed(0)}%`;
                                },
                                display: () => (valorPaga + valorRecebe) > 0
                            },
                            tooltip: {
                                callbacks: {
                                    label: (c) => `${c.label}: ${formatarMoeda(c.parsed)}`
                                }
                            }
                        }
                    }
                });
            }

            // Meta — primeira meta acima do número atual de indicações efetivas
            const metaAtual = APPLICASH_METAS.find(m => m.qtd > efetivas) || APPLICASH_METAS[APPLICASH_METAS.length - 1];
            const metaConcluida = efetivas >= metaAtual.qtd;
            const progresso = Math.min(100, (efetivas / metaAtual.qtd) * 100);
            const restantes = Math.max(0, metaAtual.qtd - efetivas);
            document.getElementById('apcMetaTitulo').innerText = `Indique ${metaAtual.qtd} ${metaAtual.qtd === 1 ? 'pessoa' : 'pessoas'}`;
            document.getElementById('apcMetaRecompensa').innerText = `${metaAtual.desc || 0}% de desconto`;
            const subT = document.getElementById('apcMetaSubtitulo');
            if (subT) subT.innerText = metaAtual.recompensa || '';
            document.getElementById('apcMetaProgressoBar').style.width = progresso + '%';
            document.getElementById('apcMetaAtual').innerText = efetivas;
            document.getElementById('apcMetaAlvo').innerText = metaAtual.qtd;
            document.getElementById('apcMetaRestante').innerText = restantes;

            // Lista de marcos
            const elLista = document.getElementById('apcMetasLista');
            if(elLista) {
                elLista.innerHTML = APPLICASH_METAS.map(m => {
                    const conquistada = efetivas >= m.qtd;
                    const cor = conquistada ? 'var(--cor-primaria)' : 'var(--cor-texto-mutado)';
                    const bg = conquistada ? 'var(--cor-bg-primaria)' : 'var(--cor-superficie)';
                    const borda = conquistada ? 'var(--cor-borda-primaria)' : 'var(--cor-borda)';
                    const icone = conquistada ? 'ph-fill ph-check-circle' : 'ph ph-circle';
                    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:${bg};border:1px solid ${borda};border-radius:9px;font-size:12.5px;">
                        <i class="${icone}" style="color:${cor};font-size:20px;flex-shrink:0;"></i>
                        <div style="flex:1;min-width:0;">
                            <div style="color:var(--cor-texto-principal);font-weight:700;text-transform:uppercase;letter-spacing:0.4px;font-size:12px;">${m.qtd} INDICA${m.qtd === 1 ? 'ÇÃO' : 'ÇÕES'} — ${m.desc || 0}% DE DESCONTO</div>
                            <div style="color:var(--cor-texto-secundario);font-size:11.5px;margin-top:2px;">${m.recompensa}</div>
                        </div>
                    </div>`;
                }).join('');
            }

            // Tabela de indicações
            const corpo = document.getElementById('apcTabelaIndicacoesCorpo');
            const vazia = document.getElementById('apcTabelaVazia');
            const tabela = document.getElementById('apcTabelaIndicacoes');
            if(corpo) {
                if(indicacoes.length === 0) {
                    corpo.innerHTML = '';
                    if(tabela) tabela.style.display = 'none';
                    if(vazia) vazia.style.display = 'block';
                } else {
                    if(tabela) tabela.style.display = '';
                    if(vazia) vazia.style.display = 'none';
                    corpo.innerHTML = indicacoes.map(i => {
                        const lucro = (Number(i.valorPago || 0) * APPLICASH_CONFIG.comissaoPct);
                        const ativo = i.status === 'ativo';
                        const tagCor = ativo ? 'var(--cor-txt-primaria)' : 'var(--cor-texto-mutado)';
                        const tagBg = ativo ? 'var(--cor-bg-primaria)' : 'var(--cor-superficie)';
                        const tagBorda = ativo ? 'var(--cor-borda-primaria)' : 'var(--cor-borda)';
                        const periodicidade = (i.periodicidade || 'mensal').toLowerCase();
                        const periodLbl = periodicidade.charAt(0).toUpperCase() + periodicidade.slice(1);
                        return `<tr>
                            <td><strong>${mascararNome(i.nome)}</strong></td>
                            <td>${i.plano || '—'}</td>
                            <td style="text-align:right;font-family:'DM Mono',monospace;" class="valor-mascarado">${formatarMoeda(i.valorPago || 0)}</td>
                            <td>${periodLbl}</td>
                            <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--cor-primaria);" class="valor-mascarado">${formatarMoeda(lucro)}</td>
                            <td style="text-align:center;"><span style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:3px 10px;border-radius:99px;background:${tagBg};color:${tagCor};border:1px solid ${tagBorda};">${ativo ? 'Ativo' : 'Inativo'}</span></td>
                        </tr>`;
                    }).join('');
                }
            }
        }

        function cupomValido(c) { return /^APP-[A-Z0-9]{6}$/.test(c || ''); }

        // Captura ?ref= da URL no carregamento e guarda em sessionStorage
        // para que appliquei-billing.js o envie ao /init no momento do signup.
        // Aceita aliases comuns (?cupom=, ?coupon=). Remove o param da URL depois.
        (function capturarRefDaUrl() {
            try {
                var p = new URLSearchParams(window.location.search);
                var raw = p.get('ref') || p.get('cupom') || p.get('coupon') || '';
                if (!raw) return;
                var c = String(raw).trim().toUpperCase();
                if (!/^APP-[A-Z0-9]{6}$/.test(c)) return;
                sessionStorage.setItem('appliquei_pending_referral', c);
                p.delete('ref'); p.delete('cupom'); p.delete('coupon');
                var qs = p.toString();
                var url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
                window.history.replaceState({}, '', url);
            } catch (_) {}
        })();

        function gerarLinkApplicash(cupom) {
            var origin = window.location.origin || '';
            var path = window.location.pathname || '/';
            return origin + path + (path.indexOf('?') === -1 ? '?' : '&') + 'ref=' + encodeURIComponent(cupom);
        }

        function copiarLinkApplicash() {
            var cupom = obterCupomApplicash();
            if (!cupomValido(cupom)) { mostrarToast('Entre na sua conta para gerar o cupom.', 'aviso'); return; }
            var link = gerarLinkApplicash(cupom);
            var lbl = document.getElementById('lblLinkBtn');
            var fallback = function () {
                var ta = document.createElement('textarea');
                ta.value = link; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                try { document.execCommand('copy'); } catch (_) {}
                document.body.removeChild(ta);
            };
            var onOk = function () {
                if (lbl) { lbl.innerText = 'Copiado!'; setTimeout(function () { lbl.innerText = 'Copiar link'; }, 1800); }
                mostrarToast('Link copiado!', 'sucesso');
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(link).then(onOk).catch(function () { fallback(); onOk(); });
            } else {
                fallback(); onOk();
            }
        }

        function copiarCupomApplicash() {
            const cupom = obterCupomApplicash();
            if(!cupomValido(cupom)) { mostrarToast('Entre na sua conta para gerar o cupom.', 'aviso'); return; }
            const lbl = document.getElementById('lblCupomBtn');
            const fallback = () => {
                const ta = document.createElement('textarea');
                ta.value = cupom; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                try { document.execCommand('copy'); } catch(_) {}
                document.body.removeChild(ta);
            };
            const onOk = () => {
                if(lbl) { lbl.innerText = 'Copiado!'; setTimeout(() => lbl.innerText = 'Copiar cupom', 1800); }
                mostrarToast(`Cupom ${cupom} copiado!`, 'sucesso');
            };
            if(navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(cupom).then(onOk).catch(() => { fallback(); onOk(); });
            } else {
                fallback(); onOk();
            }
        }
        function compartilharCupomApplicash() {
            const cupom = obterCupomApplicash();
            if(!cupomValido(cupom)) { mostrarToast('Entre na sua conta para gerar o cupom.', 'aviso'); return; }
            const link = gerarLinkApplicash(cupom);
            // Texto SEM o link: o navigator.share usa o campo url separadamente, e apps
            // (WhatsApp, iMessage) acrescentam o link automaticamente — incluí-lo no texto
            // resultaria em duplicação.
            const textoCurto = `Use meu cupom ${cupom} na Appliquei e ganhe 10% de desconto! 💚`;
            if(navigator.share) {
                navigator.share({ title: 'Appliquei', text: textoCurto, url: link }).catch(() => {});
            } else {
                // Fallback (desktop sem Web Share API): copia texto + link, uma vez só.
                const textoCompleto = `${textoCurto}\n${link}`;
                if(navigator.clipboard) navigator.clipboard.writeText(textoCompleto).catch(() => {});
                mostrarToast('Texto + link copiados para compartilhar!', 'sucesso');
            }
        }

        // ============================================================
        // === DÚVIDAS & SUGESTÕES                                    ===
        // ============================================================
        const FAQ_DADOS = [
            // Conta & assinatura
            { cat: 'conta', catLbl: 'Conta', p: 'Como faço para criar minha conta na Appliquei?', r: 'Acesse a página inicial, clique em <strong>Cadastrar</strong> e preencha seus dados básicos. Em seguida, escolha um plano (mensal, semestral ou anual) e finalize. Assim que o cadastro for concluído, você já poderá usar todas as ferramentas disponíveis para o seu plano.' },
            { cat: 'conta', catLbl: 'Conta', p: 'Como cancelar minha assinatura?', r: 'Você pode cancelar a qualquer momento na aba <strong>Configurações → Assinatura</strong>. O cancelamento é imediato e seu acesso permanece ativo até o fim do período já pago. Não há multa.' },
            { cat: 'conta', catLbl: 'Conta', p: 'Posso mudar de plano depois?', r: 'Sim. Em <strong>Configurações → Assinatura</strong> você pode trocar para qualquer outro plano. Em upgrades, a diferença é cobrada proporcional aos dias restantes. Em downgrades, a alteração passa a valer no próximo ciclo.' },
            { cat: 'conta', catLbl: 'Conta', p: 'Quais formas de pagamento são aceitas?', r: 'Aceitamos cartão de crédito (parcelamento conforme o plano), Pix e boleto bancário. O cupom de 10% é aplicado em qualquer forma de pagamento.' },

            // Patrimônio & ativos
            { cat: 'patrimonio', catLbl: 'Patrimônio', p: 'Como cadastrar uma operação de compra ou venda?', r: 'Na aba <strong>Visão geral do patrimônio</strong>, clique em <strong>Registrar operação</strong>. Selecione o ativo, informe quantidade, preço, data, corretora e demais campos. A operação aparece automaticamente na sua carteira e no histórico.' },
            { cat: 'patrimonio', catLbl: 'Patrimônio', p: 'De onde vêm as cotações dos ativos?', r: 'As cotações são consultadas no Yahoo Finance em tempo quase real. Quando a fonte não responde, usamos a última cotação salva e exibimos o aviso <em>"Preços estimados"</em> no topo da página.' },
            { cat: 'patrimonio', catLbl: 'Patrimônio', p: 'A plataforma suporta renda fixa, FIIs, ações, ETFs, BDRs e previdência?', r: 'Sim, todos esses tipos são suportados. Para previdência, há cálculo de saldo com aportes recorrentes; para renda fixa, projeção com CDI/Selic/IPCA atualizados pelo Banco Central.' },
            { cat: 'patrimonio', catLbl: 'Patrimônio', p: 'Como faço backup dos meus dados?', r: 'Clique em <strong>Backup</strong> no canto superior direito da Visão geral. Será baixado um arquivo JSON com todas as suas operações, sonhos, metas e configurações. Guarde-o em local seguro.' },

            // Controle financeiro
            { cat: 'controle', catLbl: 'Controle', p: 'Para que serve a aba Controle financeiro?', r: 'É onde você acompanha receitas, despesas, cartões de crédito e o fluxo de caixa mensal. Ela alimenta automaticamente o cálculo de quanto sobra para investir e dispara alertas quando o orçamento estoura.' },
            { cat: 'controle', catLbl: 'Controle', p: 'Posso cadastrar mais de um cartão de crédito?', r: 'Sim, você pode cadastrar quantos cartões quiser, definindo dia de fechamento e dia de vencimento de cada um. As faturas são agrupadas e exibidas em modo separado.' },
            { cat: 'controle', catLbl: 'Controle', p: 'Como funcionam as metas mensais?', r: 'Você define um valor-meta para cada categoria (ex.: R$ 1.500 em mercado). A barra de progresso mostra quanto já foi gasto no mês e o valor restante. Cores indicam quando você está se aproximando ou ultrapassou a meta.' },

            // Ferramentas
            { cat: 'ferramentas', catLbl: 'Ferramentas', p: 'Como funciona o Simulador de liberdade financeira?', r: 'Você informa quanto pode investir por mês, sua expectativa de rentabilidade e seu objetivo (renda passiva mensal ou patrimônio total). O simulador projeta a evolução até a sua independência considerando aportes, juros compostos e inflação.' },
            { cat: 'ferramentas', catLbl: 'Ferramentas', p: 'O que é a Carteira recomendada?', r: 'É uma sugestão personalizada de alocação entre renda fixa, FIIs, ações, ETFs, BDRs e previdência baseada no seu perfil de investidor e nos seus objetivos. As recomendações são revisadas mensalmente.' },
            { cat: 'ferramentas', catLbl: 'Ferramentas', p: 'O que tem na Jornada Financeira?', r: 'É um conjunto de aulas curtas e práticas, organizadas em trilhas (iniciante → avançado). Cada aula tem vídeo, resumo escrito e um exercício rápido para fixar o conteúdo.' },

            // Applicash
            { cat: 'applicash', catLbl: 'Applicash $', p: 'Como funciona o Applicash $?', r: 'É o nosso programa de indicações. Seu cupom dá <strong>10% de desconto</strong> ao novo assinante. A partir de uma indicação efetiva (assinante ativo), você passa a receber <strong>10% do valor pago</strong> enquanto ele permanecer na plataforma.' },
            { cat: 'applicash', catLbl: 'Applicash $', p: 'O que é uma indicação efetiva?', r: 'É um usuário que se cadastrou usando o seu cupom e pagou pelo menos a primeira mensalidade. Cadastros que cancelam antes da primeira cobrança não geram comissão.' },
            { cat: 'applicash', catLbl: 'Applicash $', p: 'Quando recebo o valor das minhas indicações?', r: 'O valor é creditado mensalmente, junto da fatura do indicado. Você pode acompanhar o total previsto e o histórico em <strong>Applicash $ → Minhas indicações</strong>.' },
            { cat: 'applicash', catLbl: 'Applicash $', p: 'Existe limite de indicações?', r: 'Não há limite. Quanto mais pessoas usarem seu cupom, maior a sua receita. Existem ainda metas com recompensas extras a cada marco atingido (5, 10, 30, 50 e 100 indicações).' },

            // Dados & segurança
            { cat: 'dados', catLbl: 'Dados', p: 'Meus dados financeiros ficam seguros?', r: 'Seus dados são armazenados localmente no seu navegador (localStorage) e, quando sincronizados, trafegam por HTTPS criptografado. Não compartilhamos informações pessoais com terceiros.' },
            { cat: 'dados', catLbl: 'Dados', p: 'Posso exportar e excluir meus dados?', r: 'Sim. A qualquer momento você pode exportar tudo em JSON pelo botão <strong>Backup</strong>, ou solicitar a exclusão total da conta em <strong>Configurações → Privacidade</strong>.' },
            { cat: 'dados', catLbl: 'Dados', p: 'Como funciona o modo "Ocultar valores"?', r: 'Clique no ícone do olho na barra superior. Os valores monetários e percentuais sensíveis ficam mascarados na tela, útil para usar a plataforma em locais públicos. A preferência é lembrada no seu navegador.' }
        ];

        function abrirFaqItem(idx) {
            const item = document.querySelector(`.faq-item[data-idx="${idx}"]`);
            if(!item) return;
            item.classList.toggle('aberto');
        }

        function renderizarFaq() {
            const lista = document.getElementById('faqLista');
            if(!lista) return;
            const termo = (document.getElementById('faqBuscaInput')?.value || '').toLowerCase().trim();
            const cat = document.getElementById('faqCategoriaFiltro')?.value || '';
            const filtrados = FAQ_DADOS
                .map((item, idx) => ({ ...item, idx }))
                .filter(item => {
                    if(cat && item.cat !== cat) return false;
                    if(!termo) return true;
                    return item.p.toLowerCase().includes(termo) || item.r.toLowerCase().includes(termo);
                });

            const vazio = document.getElementById('faqVazio');
            if(filtrados.length === 0) {
                lista.innerHTML = '';
                if(vazio) vazio.style.display = 'block';
                return;
            }
            if(vazio) vazio.style.display = 'none';

            lista.innerHTML = filtrados.map(item => `
                <div class="faq-item" data-idx="${item.idx}">
                    <div class="faq-item-cabecalho" onclick="abrirFaqItem(${item.idx})">
                        <div class="faq-titulo-wrap">
                            <span class="faq-titulo-texto">${item.p}</span>
                            <span class="faq-categoria">${item.catLbl}</span>
                        </div>
                        <i class="ph-bold ph-caret-down faq-chevron"></i>
                    </div>
                    <div class="faq-item-resposta">${item.r}</div>
                </div>
            `).join('');
        }

        function filtrarFaq() {
            renderizarFaq();
        }

        function trocarTabDuvidas(qual) {
            const tabFaq = document.getElementById('tabFaq');
            const tabSug = document.getElementById('tabSugestao');
            const conteudoFaq = document.getElementById('dsConteudoFaq');
            const conteudoSug = document.getElementById('dsConteudoSugestao');
            if(qual === 'faq') {
                tabFaq.classList.add('ativo');
                tabSug.classList.remove('ativo');
                tabFaq.style.background = 'var(--cor-branco)';
                tabFaq.style.color = 'var(--cor-texto-principal)';
                tabSug.style.background = 'transparent';
                tabSug.style.color = 'var(--cor-texto-mutado)';
                conteudoFaq.style.display = '';
                conteudoSug.style.display = 'none';
            } else {
                tabSug.classList.add('ativo');
                tabFaq.classList.remove('ativo');
                tabSug.style.background = 'var(--cor-branco)';
                tabSug.style.color = 'var(--cor-texto-principal)';
                tabFaq.style.background = 'transparent';
                tabFaq.style.color = 'var(--cor-texto-mutado)';
                conteudoSug.style.display = '';
                conteudoFaq.style.display = 'none';
                renderizarHistoricoSugestoes();
            }
        }

        function selecionarTipoSugestao(tipo) {
            document.getElementById('sugTipo').value = tipo;
            document.querySelectorAll('.sug-tipo-btn').forEach(b => b.classList.remove('ativo'));
            const btn = document.querySelector(`.sug-tipo-btn[data-tipo="${tipo}"]`);
            if(btn) btn.classList.add('ativo');
        }

        function carregarSugestoes() {
            try { return JSON.parse(localStorage.getItem('appliquei_sugestoes') || '[]'); } catch { return []; }
        }
        function salvarSugestoes(arr) {
            localStorage.setItem('appliquei_sugestoes', JSON.stringify(arr));
        }

        function enviarSugestao() {
            const aba = document.getElementById('sugAba').value;
            const outroTema = document.getElementById('sugOutroTema').value.trim();
            const tipo = document.getElementById('sugTipo').value;
            const texto = document.getElementById('sugTexto').value.trim();

            if(!aba) return mostrarToast('Selecione a aba relacionada à sua sugestão.', 'erro');
            if(aba === 'outro' && !outroTema) return mostrarToast('Diga sobre o que é a sua sugestão.', 'erro');
            if(texto.length < 10) return mostrarToast('Descreva sua sugestão com pelo menos 10 caracteres.', 'erro');

            const sugestoes = carregarSugestoes();
            sugestoes.unshift({
                id: Date.now(),
                aba,
                outroTema: aba === 'outro' ? outroTema : '',
                tipo,
                texto,
                data: new Date().toISOString()
            });
            salvarSugestoes(sugestoes);

            // Limpar form
            document.getElementById('sugAba').value = '';
            document.getElementById('sugOutroTema').value = '';
            document.getElementById('sugOutroWrapper').style.display = 'none';
            document.getElementById('sugTexto').value = '';
            document.getElementById('sugContador').innerText = '0';
            selecionarTipoSugestao('melhoria');

            mostrarToast('Sugestão enviada! Obrigado por contribuir 💚', 'sucesso');
            renderizarHistoricoSugestoes();
        }

        function renderizarHistoricoSugestoes() {
            const lista = document.getElementById('sugHistoricoLista');
            const vazio = document.getElementById('sugHistoricoVazio');
            const total = document.getElementById('sugTotalEnviadas');
            if(!lista) return;
            const sugestoes = carregarSugestoes();
            if(total) total.innerText = sugestoes.length;
            if(sugestoes.length === 0) {
                lista.innerHTML = '';
                if(vazio) vazio.style.display = 'block';
                return;
            }
            if(vazio) vazio.style.display = 'none';

            const labelsAba = {
                patrimonio: 'Patrimônio',
                controle: 'Controle financeiro',
                carteira: 'Carteira recomendada',
                relatorio_mensal: 'Relatório mensal',
                simulador: 'Simulador',
                meus_sonhos: 'Meus sonhos',
                aulas: 'Jornada',
                noticias: 'Info Mercado',
                applicash: 'Applicash $',
                duvidas_sugestoes: 'Dúvidas & Sugestões',
                outro: 'Outro'
            };
            const labelsTipo = { melhoria: '✨ Melhoria', novo: '🚀 Novo recurso', bug: '🐛 Bug' };

            lista.innerHTML = sugestoes.map(s => {
                const dt = new Date(s.data);
                const dataFmt = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) + ' • ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                const aba = labelsAba[s.aba] || s.aba;
                const tema = s.outroTema ? ` · ${s.outroTema}` : '';
                return `<div class="sug-historico-item">
                    <div class="sh-cabecalho">
                        <span class="sh-tag">${labelsTipo[s.tipo] || s.tipo} · ${aba}${tema}</span>
                        <span class="sh-data">${dataFmt}</span>
                    </div>
                    <div class="sh-texto">${(s.texto || '').replace(/</g, '&lt;')}</div>
                </div>`;
            }).join('');
        }

        function inicializarFormSugestao() {
            const sel = document.getElementById('sugAba');
            const wrap = document.getElementById('sugOutroWrapper');
            if(sel) sel.addEventListener('change', () => {
                if(wrap) wrap.style.display = sel.value === 'outro' ? '' : 'none';
            });
            const ta = document.getElementById('sugTexto');
            const cont = document.getElementById('sugContador');
            if(ta && cont) ta.addEventListener('input', () => { cont.innerText = ta.value.length; });
        }

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
        // === MEU PATRIMÔNIO — visão consolidada                    ===
        // ============================================================
        // Estado e cache do módulo
        const mpEstado = { periodo: '12m', modo: 'bruto', cotacoes: {}, ultimaCotacao: null, donutChart: null, categoriaDestaque: null, instituicaoFiltro: null };

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

        const MP_LABELS = {
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

        // ============================================================
        // === JORNADA FINANCEIRA — módulos com progresso             ===
        // ============================================================
        const JORNADA_MODULOS = [
            { id: 'm1', titulo: '1. Alinhamento de mindset',      icone: 'ph-brain',          descricao: 'Conceitos base sobre finanças comportamentais e tese de longo prazo. Entenda por que disciplina vale mais que retorno.', objetivos: ['Identificar 3 gatilhos pessoais de gasto impulsivo','Definir sua tese de investimento em 1 frase'] },
            { id: 'm2', titulo: '2. Otimização de caixa',         icone: 'ph-piggy-bank',     descricao: 'Técnicas de engenharia financeira pessoal para provisionar aportes mensais consistentes.',                                    objetivos: ['Mapear receitas e despesas fixas','Definir % de aporte alvo (mín. 10% da receita)'] },
            { id: 'm3', titulo: '3. Colchão de liquidez',         icone: 'ph-shield-check',   descricao: 'Estruturação da reserva de emergência: quanto, onde e como alocar para acesso rápido sem perder rentabilidade.',          objetivos: ['Calcular 6× despesas fixas mensais','Alocar em Tesouro Selic ou CDB de liquidez diária'] },
            { id: 'm4', titulo: '4. Execução no broker',          icone: 'ph-storefront',     descricao: 'Tutorial técnico de compra de ativos reais passo a passo. Da escolha da corretora até o primeiro boletim de compra.',     objetivos: ['Abrir conta em corretora','Executar primeira compra de ativo'] },
            { id: 'm5', titulo: '5. Renda fixa avançada',         icone: 'ph-bank',           descricao: 'CDB, LCI, LCA, debêntures, Tesouro Direto: como comparar, indexadores e armadilhas comuns.',                                  objetivos: ['Comparar CDI vs IPCA+ vs prefixado','Montar uma escada de vencimentos'] },
            { id: 'm6', titulo: '6. Renda variável & dividendos', icone: 'ph-chart-line-up',  descricao: 'Ações brasileiras, FIIs, dividend yield, payout. Como avaliar uma empresa antes de comprar.',                                objetivos: ['Selecionar 5 ativos pagadores consistentes','Calcular dividend yield ponderado da carteira'] },
            { id: 'm7', titulo: '7. Diversificação internacional',icone: 'ph-globe-hemisphere-west', descricao: 'BDRs, ETFs internacionais, exposição cambial. Por que e quanto alocar fora do real.',                          objetivos: ['Definir % alvo de exposição internacional','Escolher veículo (BDR vs ETF vs conta global)'] },
            { id: 'm8', titulo: '8. Aposentadoria & longo prazo', icone: 'ph-tree-palm',      descricao: 'Previdência privada, regime de tributação, planejamento sucessório e o cálculo da sua liberdade financeira.',                  objetivos: ['Simular patrimônio-alvo para liberdade','Comparar PGBL vs VGBL pro seu caso'] },
        ];
        const JORNADA_STORAGE_KEY = 'appliquei_jornada_progresso';

        function carregarJornadaProgresso() {
            try { return JSON.parse(localStorage.getItem(JORNADA_STORAGE_KEY) || '{}'); }
            catch(_) { return {}; }
        }
        function salvarJornadaProgresso(p) {
            localStorage.setItem(JORNADA_STORAGE_KEY, JSON.stringify(p || {}));
        }

        function jornadaModulosConcluidosNoMes(yyyymm) {
            // yyyymm = "YYYY-MM"; conta módulos cujo concluidoEm cai dentro desse mês
            const prog = carregarJornadaProgresso();
            return Object.values(prog).filter(p => {
                if(!p || !p.concluidoEm) return false;
                return p.concluidoEm.slice(0, 7) === yyyymm;
            }).length;
        }

        let jornadaModuloAberto = null;
        function abrirModalJornada(id) {
            const mod = JORNADA_MODULOS.find(m => m.id === id);
            if(!mod) return;
            jornadaModuloAberto = id;
            const modal = document.getElementById('modalJornadaModulo');
            modal.querySelector('#jornadaModalTitulo span').innerText = mod.titulo;
            document.getElementById('jornadaModalDescricao').innerText = mod.descricao;
            const objetivos = document.getElementById('jornadaModalObjetivos');
            objetivos.innerHTML = '<strong style="font-size:12px;color:var(--cor-texto-mutado);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:8px;">Ao concluir este módulo, você terá:</strong>' +
                '<ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.7;color:var(--cor-texto-principal);">' +
                mod.objetivos.map(o => '<li>' + o + '</li>').join('') + '</ul>';
            const prog = carregarJornadaProgresso();
            const btn = document.getElementById('jornadaModalBtnConcluir');
            const concluido = !!(prog[id] && prog[id].concluidoEm);
            if(concluido) {
                btn.innerHTML = '<i class="ph-bold ph-arrow-counter-clockwise"></i> <span>Desmarcar conclusão</span>';
                btn.style.background = 'var(--cor-texto-mutado)';
            } else {
                btn.innerHTML = '<i class="ph-bold ph-check-circle"></i> <span>Marcar como concluído</span>';
                btn.style.background = 'var(--cor-primaria)';
            }
            btn.onclick = () => toggleJornadaModulo(id);
            modal.style.display = 'flex';
        }
        function fecharModalJornada() {
            document.getElementById('modalJornadaModulo').style.display = 'none';
            jornadaModuloAberto = null;
        }
        function toggleJornadaModulo(id) {
            const prog = carregarJornadaProgresso();
            if(prog[id] && prog[id].concluidoEm) {
                delete prog[id];
                mostrarToast('Módulo desmarcado.', 'aviso');
            } else {
                prog[id] = { concluidoEm: new Date().toISOString() };
                mostrarToast('Módulo concluído! 🎓', 'sucesso');
            }
            salvarJornadaProgresso(prog);
            fecharModalJornada();
            renderizarJornada();
        }

        function renderizarJornada() {
            const grid = document.getElementById('jornadaModulosGrid');
            if(!grid) return;
            const prog = carregarJornadaProgresso();
            const total = JORNADA_MODULOS.length;
            const concluidos = JORNADA_MODULOS.filter(m => prog[m.id] && prog[m.id].concluidoEm).length;
            const pct = total ? Math.round((concluidos / total) * 100) : 0;

            // Cards
            grid.innerHTML = JORNADA_MODULOS.map(m => {
                const ok = !!(prog[m.id] && prog[m.id].concluidoEm);
                const corBorda = ok ? 'var(--cor-primaria)' : 'var(--cor-texto-mutado)';
                const badge = ok
                    ? '<span class="badge" style="background:var(--cor-primaria);color:var(--cor-branco);width:fit-content;margin-bottom:10px;"><i class="ph-fill ph-check-circle"></i> Concluído</span>'
                    : '<span class="badge" style="background:var(--cor-bg-info);color:var(--cor-texto-secundario);border:1px solid var(--cor-borda);width:fit-content;margin-bottom:10px;"><i class="ph ph-circle"></i> Não iniciado</span>';
                const dataLbl = ok ? '<div style="font-size:11px;color:var(--cor-texto-mutado);margin-bottom:8px;">Concluído em ' + new Date(prog[m.id].concluidoEm).toLocaleDateString('pt-BR') + '</div>' : '';
                const corIcone = ok ? 'var(--cor-primaria)' : 'var(--cor-texto-secundario)';
                return '<div class="card-container" style="display:flex;flex-direction:column;border-top:4px solid ' + corBorda + ';cursor:pointer;transition:transform 0.15s ease,box-shadow 0.15s ease;" onmouseover="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 4px 14px rgba(0,0,0,0.06)\';" onmouseout="this.style.transform=\'\';this.style.boxShadow=\'\';" onclick="abrirModalJornada(\'' + m.id + '\')">'
                    + badge
                    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;"><i class="ph-duotone ' + m.icone + '" style="font-size:28px;color:' + corIcone + ';"></i><h3 style="font-size:15px;font-weight:700;margin:0;line-height:1.3;">' + m.titulo + '</h3></div>'
                    + '<p style="font-size:13px;margin-bottom:12px;color:var(--cor-texto-secundario);flex:1;line-height:1.5;">' + m.descricao + '</p>'
                    + dataLbl
                    + '<button class="' + (ok ? 'btn-secundario' : 'btn-acao') + '" style="width:100%;" onclick="event.stopPropagation();abrirModalJornada(\'' + m.id + '\')">'
                    + (ok ? '<i class="ph ph-eye"></i> Ver detalhes' : '<i class="ph-bold ph-arrow-right"></i> Iniciar módulo')
                    + '</button></div>';
            }).join('');

            // Barra de progresso
            const bar = document.getElementById('jornadaProgressoBar');
            const pctTxt = document.getElementById('jornadaPctTexto');
            const resumo = document.getElementById('jornadaResumoTexto');
            const chip = document.getElementById('jornadaResumoChip');
            const msg = document.getElementById('jornadaMensagem');
            if(bar) bar.style.width = pct + '%';
            if(pctTxt) pctTxt.innerText = pct + '%';
            if(resumo) resumo.innerText = concluidos + ' de ' + total + ' módulos';
            if(chip) chip.style.display = '';
            if(msg) {
                if(concluidos === 0) msg.innerHTML = 'Comece pelo primeiro módulo e vá no seu ritmo. A meta sugerida é concluir <strong>1 módulo por mês</strong> — vira critério verde no Relatório mensal.';
                else if(concluidos === total) msg.innerHTML = '🎉 <strong>Trilha completa.</strong> Releia os módulos sempre que precisar revisar um conceito.';
                else msg.innerHTML = '<strong>' + concluidos + ' módulo(s) concluído(s).</strong> Faltam ' + (total - concluidos) + ' para completar a trilha. Lembre-se: o critério "verde" no termômetro mensal é <strong>≥ 1 módulo no mês</strong>.';
            }

            // Módulos concluídos no mês corrente
            const hoje = new Date();
            const yyyymm = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
            const noMes = jornadaModulosConcluidosNoMes(yyyymm);
            const elMes = document.getElementById('jornadaModulosMes');
            if(elMes) elMes.innerText = noMes;
        }

        // ============================================================
        // === RELATÓRIO MENSAL — BI consolidado                       ===
        // ============================================================
        const RM_NOMES_MESES_LONG = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        const RM_NOMES_MESES_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const RM_HTML2PDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.3/html2pdf.bundle.min.js';

        function rmYyyymmToMesAno(yyyymm) {
            const [a, m] = (yyyymm || '').split('-').map(Number);
            return { mes: (m || 1) - 1, ano: a || 0 };
        }
        function rmMesAnoToYyyymm(mes, ano) {
            return ano + '-' + String(mes + 1).padStart(2, '0');
        }
        function rmFormatarMesLabel(yyyymm) {
            const { mes, ano } = rmYyyymmToMesAno(yyyymm);
            return RM_NOMES_MESES_LONG[mes] + '/' + ano;
        }
        function rmAddMonths(yyyymm, delta) {
            const { mes, ano } = rmYyyymmToMesAno(yyyymm);
            const d = new Date(ano, mes + delta, 1);
            return rmMesAnoToYyyymm(d.getMonth(), d.getFullYear());
        }
        function rmMesEhFuturo(yyyymm) {
            const hoje = new Date();
            const cur = rmMesAnoToYyyymm(hoje.getMonth(), hoje.getFullYear());
            return yyyymm > cur;
        }

        // Constrói o objeto bruto do mês a partir das fontes existentes
        function buildMonthlyReport(yyyymm) {
            const { mes, ano } = rmYyyymmToMesAno(yyyymm);
            const r = (typeof calcularResumoMes === 'function') ? calcularResumoMes(mes, ano) : { receita:0, resgate:0, despFixa:0, despVar:0, cartao:0, invFixo:0, invVar:0, sonho:0 };

            const entradas = (r.receita || 0) + (r.resgate || 0);
            const despesasContas = (r.despFixa || 0) + (r.despVar || 0) + (r.cartao || 0) + (r.sonho || 0);
            const investimentos = (r.invFixo || 0) + (r.invVar || 0);
            const despesasTotais = despesasContas + investimentos;
            const saldoFinal = entradas - despesasTotais;

            // Patrimônio (snapshot do mês)
            let patrimonioAplicado = 0, patrimonioMercado = 0;
            try {
                const snaps = (typeof carregarSnapshotsCarteira === 'function') ? carregarSnapshotsCarteira() : {};
                const snap = snaps[yyyymm];
                if(snap) {
                    patrimonioAplicado = snap.investidoTotal || 0;
                    patrimonioMercado = snap.saldoTotal || 0;
                }
            } catch(_) {}

            // Dividendos do mês (usa cacheDividendos se disponível)
            let dividendos = 0;
            try {
                if(typeof cacheDividendos !== 'undefined' && cacheDividendos && typeof historicoCompras !== 'undefined') {
                    const iniMs = new Date(ano, mes, 1).getTime();
                    const fimMs = new Date(ano, mes + 1, 0, 23, 59, 59).getTime();
                    const tickers = new Set(historicoCompras.map(o => o.ticker).filter(Boolean));
                    tickers.forEach(ticker => {
                        const cache = cacheDividendos[ticker];
                        if(!cache || !cache.pagamentos) return;
                        cache.pagamentos.forEach(p => {
                            if(!p.data) return;
                            const ts = new Date(p.data.length === 10 ? p.data + 'T12:00:00' : p.data).getTime();
                            if(ts < iniMs || ts > fimMs) return;
                            // Quantidade na data do pagamento
                            let qtd = 0;
                            historicoCompras.forEach(op => {
                                if(op.ticker !== ticker || !op.data) return;
                                const tsOp = new Date(op.data).getTime();
                                if(tsOp > ts) return;
                                if(op.tipo === 'compra') qtd += (op.qtd || 0);
                                else if(op.tipo === 'venda') qtd -= (op.qtd || 0);
                            });
                            if(qtd > 0) dividendos += qtd * (p.valor || 0);
                        });
                    });
                }
            } catch(_) {}

            // Sonhos — progresso médio dos sonhos ativos
            let sonhosAtivos = 0, sonhosNoPrazo = 0, sonhosProgressoMedio = 0, sonhosLista = [];
            try {
                const lista = JSON.parse(localStorage.getItem('appliquei_sonhos') || '[]');
                lista.forEach(s => {
                    const valTot = s.valorTotal || 0;
                    const valAtu = s.valorAtual || 0;
                    if(valTot <= 0) return;
                    const pct = Math.min(100, (valAtu / valTot) * 100);
                    sonhosAtivos += 1;
                    sonhosProgressoMedio += pct;
                    // "No prazo" = pct atual >= % de tempo decorrido
                    const prazo = s.prazoMeses || 12;
                    const mesesPassados = Math.max(0, prazo - (s.mesesRestantes || 0));
                    const pctTempo = (mesesPassados / prazo) * 100;
                    if(pct >= pctTempo - 5) sonhosNoPrazo += 1; // 5% de tolerância
                    sonhosLista.push({ nome: s.nome || 'Sonho', pct, prazo, mesesRestantes: s.mesesRestantes });
                });
                if(sonhosAtivos > 0) sonhosProgressoMedio = sonhosProgressoMedio / sonhosAtivos;
            } catch(_) {}

            // Jornada — módulos concluídos no mês
            const jornadaModulosMes = jornadaModulosConcluidosNoMes(yyyymm);

            // Applicash — indicações ativas + receita estimada
            let applicashIndicacoes = 0, applicashReceita = 0;
            try {
                const inds = JSON.parse(localStorage.getItem('appliquei_applicash_indicacoes') || '[]');
                const ativos = inds.filter(i => i.status === 'ativo');
                applicashIndicacoes = ativos.length;
                applicashReceita = ativos.reduce((acc, i) => acc + ((i.valorPago || 0) * 0.10), 0);
            } catch(_) {}

            return {
                yyyymm,
                mes, ano,
                label: rmFormatarMesLabel(yyyymm),
                entradas,
                receita: r.receita || 0,
                resgate: r.resgate || 0,
                despesasContas,
                despesasTotais,
                investimentos,
                saldoFinal,
                pctDespesas: entradas > 0 ? (despesasContas / entradas) * 100 : 0,
                pctInvestimentos: entradas > 0 ? (investimentos / entradas) * 100 : 0,
                patrimonioAplicado,
                patrimonioMercado,
                patrimonioGanho: patrimonioMercado - patrimonioAplicado,
                dividendos,
                sonhos: { ativos: sonhosAtivos, noPrazo: sonhosNoPrazo, progressoMedio: sonhosProgressoMedio, lista: sonhosLista },
                jornadaModulosMes,
                applicash: { indicacoes: applicashIndicacoes, receita: applicashReceita },
                hasData: (entradas + despesasTotais + patrimonioMercado + dividendos + sonhosAtivos + jornadaModulosMes + applicashIndicacoes) > 0
            };
        }

        // Termômetro — 5 critérios → score 0-100 + status por critério
        function rmCalcularTermometro(rep) {
            const criterios = [];
            // 1. Despesas ≤ 60% (verde), 60-75% (amarelo), >75% (vermelho)
            const cDesp = rep.pctDespesas;
            let stDesp = 'verde';
            if(rep.entradas === 0) stDesp = 'cinza';
            else if(cDesp > 75) stDesp = 'vermelho';
            else if(cDesp > 60) stDesp = 'amarelo';
            criterios.push({ label: 'Despesas ≤ 60% da entrada', valor: rep.entradas > 0 ? cDesp.toFixed(1) + '%' : '—', meta: '≤ 60%', status: stDesp, icone: 'ph-receipt' });
            // 2. Investimentos ≥ 30% (verde), 20-30% (amarelo), <20% (vermelho)
            const cInv = rep.pctInvestimentos;
            let stInv = 'verde';
            if(rep.entradas === 0) stInv = 'cinza';
            else if(cInv < 20) stInv = 'vermelho';
            else if(cInv < 30) stInv = 'amarelo';
            criterios.push({ label: 'Investimentos ≥ 30% da entrada', valor: rep.entradas > 0 ? cInv.toFixed(1) + '%' : '—', meta: '≥ 30%', status: stInv, icone: 'ph-trending-up' });
            // 3. Sonhos no prazo: ≥80% no prazo (verde), 50-80% (amarelo), <50% (vermelho)
            let stSon = 'cinza';
            let pctSon = 0;
            if(rep.sonhos.ativos > 0) {
                pctSon = (rep.sonhos.noPrazo / rep.sonhos.ativos) * 100;
                if(pctSon < 50) stSon = 'vermelho';
                else if(pctSon < 80) stSon = 'amarelo';
                else stSon = 'verde';
            }
            criterios.push({ label: 'Sonhos no prazo', valor: rep.sonhos.ativos > 0 ? rep.sonhos.noPrazo + '/' + rep.sonhos.ativos : 'Sem sonhos', meta: '≥ 80%', status: stSon, icone: 'ph-shooting-star' });
            // 4. Jornada: ≥1 módulo (verde) senão vermelho
            const stJor = rep.jornadaModulosMes >= 1 ? 'verde' : 'vermelho';
            criterios.push({ label: 'Jornada Financeira', valor: rep.jornadaModulosMes + ' módulo(s)', meta: '≥ 1/mês', status: stJor, icone: 'ph-graduation-cap' });
            // 5. Applicash: ≥2 (verde), 1 (amarelo), 0 (vermelho)
            let stApp = 'vermelho';
            if(rep.applicash.indicacoes >= 2) stApp = 'verde';
            else if(rep.applicash.indicacoes === 1) stApp = 'amarelo';
            criterios.push({ label: 'Applicash — indicações ativas', valor: rep.applicash.indicacoes + ' ativa(s)', meta: '≥ 2', status: stApp, icone: 'ph-currency-dollar' });

            // Score = média ponderada (cada critério vale 20 pontos; verde=100%, amarelo=50%, vermelho=0%, cinza=neutro)
            const pesos = { verde: 100, amarelo: 50, vermelho: 0, cinza: 50 };
            let score = 0, pontosVal = 0;
            criterios.forEach(c => { score += pesos[c.status]; pontosVal += 1; });
            const finalScore = pontosVal > 0 ? Math.round(score / pontosVal) : 0;
            let statusGeral = 'verde';
            if(finalScore < 40) statusGeral = 'vermelho';
            else if(finalScore < 70) statusGeral = 'amarelo';
            return { criterios, score: finalScore, statusGeral };
        }

        function rmCorStatus(s) {
            if(s === 'verde') return { bg: 'var(--cor-bg-primaria)', borda: 'var(--cor-borda-primaria)', txt: 'var(--cor-txt-primaria)', dot: '#10b981' };
            if(s === 'amarelo') return { bg: '#fffbeb', borda: '#fcd34d', txt: '#92400e', dot: '#f59e0b' };
            if(s === 'vermelho') return { bg: '#fef2f2', borda: '#fecaca', txt: '#991b1b', dot: '#ef4444' };
            return { bg: 'var(--cor-superficie)', borda: 'var(--cor-borda)', txt: 'var(--cor-texto-mutado)', dot: '#94a3b8' };
        }

        // ====== Helpers visuais ======
        function rmFormatarMoedaCompacta(v) {
            const abs = Math.abs(v || 0);
            if(abs >= 1e6) return 'R$ ' + (v / 1e6).toFixed(1).replace('.', ',') + 'M';
            if(abs >= 1e3) return 'R$ ' + (v / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace('.', ',') + 'k';
            return 'R$ ' + (v || 0).toFixed(0);
        }

        function rmSparklineSvg(values, opts) {
            opts = opts || {};
            const w = opts.width || 240;
            const h = opts.height || 56;
            const pad = 4;
            if(!values || values.length < 2) return '';
            const max = Math.max(...values, 0);
            const min = Math.min(...values, 0);
            const range = max - min || 1;
            const dx = (w - pad * 2) / (values.length - 1);
            const y = v => h - pad - ((v - min) / range) * (h - pad * 2);
            const pts = values.map((v, i) => [pad + i * dx, y(v)]);
            // Smooth path com curva quadrática
            let d = 'M ' + pts[0][0] + ' ' + pts[0][1];
            for(let i = 1; i < pts.length; i++) {
                const p0 = pts[i-1], p1 = pts[i];
                const mx = (p0[0] + p1[0]) / 2;
                d += ' Q ' + mx + ' ' + p0[1] + ' ' + mx + ' ' + ((p0[1]+p1[1])/2);
                d += ' T ' + p1[0] + ' ' + p1[1];
            }
            const area = d + ' L ' + pts[pts.length-1][0] + ' ' + h + ' L ' + pts[0][0] + ' ' + h + ' Z';
            const gradId = 'rmsg_' + Math.random().toString(36).slice(2,8);
            return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">'
                + '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">'
                + '<stop offset="0%" stop-color="var(--rm-kpi-fill-from)"/>'
                + '<stop offset="100%" stop-color="var(--rm-kpi-fill-to)"/>'
                + '</linearGradient></defs>'
                + '<path d="' + area + '" fill="url(#' + gradId + ')"/>'
                + '<path d="' + d + '" fill="none" stroke="var(--rm-kpi-stroke)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
                + '<circle cx="' + pts[pts.length-1][0] + '" cy="' + pts[pts.length-1][1] + '" r="3" fill="var(--rm-kpi-stroke)" stroke="#fff" stroke-width="1.5"/>'
                + '</svg>';
        }

        function rmDeltaHtml(valorA, valorB, mesBLabel) {
            if(valorB === null || valorB === undefined) return '';
            const delta = valorA - valorB;
            const pct = valorB !== 0 ? (delta / Math.abs(valorB)) * 100 : (delta !== 0 ? 100 : 0);
            const cls = Math.abs(pct) < 0.1 ? 'neu' : (delta > 0 ? 'pos' : 'neg');
            const seta = Math.abs(pct) < 0.1 ? '·' : (delta > 0 ? '▲' : '▼');
            const mesShort = (mesBLabel || '').split('/')[0];
            return '<div class="rm-kpi-delta ' + cls + '">' + seta + ' ' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '% <span style="color:var(--cor-texto-mutado);font-weight:600;">vs ' + mesShort + '</span></div>';
        }

        // SVG gauge — atualiza arc + pointer
        function rmAtualizarGauge(score, statusGeral) {
            const path = document.getElementById('rmGaugePath');
            const pointer = document.getElementById('rmGaugePointer');
            if(path) {
                const pct = Math.max(0, Math.min(100, score)) / 100;
                const total = 283; // ~ length aprox do arco
                path.setAttribute('stroke-dashoffset', String(total - total * pct));
            }
            if(pointer) {
                const ang = -90 + (Math.max(0, Math.min(100, score)) / 100) * 180;
                pointer.setAttribute('transform', 'rotate(' + ang + ' 110 110)');
            }
            // Cor do score numérico
            const scoreEl = document.getElementById('rmTermometroScore');
            const statusEl = document.getElementById('rmTermometroStatus');
            const cores = rmCorStatus(statusGeral);
            if(scoreEl) scoreEl.style.color = cores.dot;
            if(statusEl) {
                statusEl.style.color = cores.dot;
                statusEl.innerText = statusGeral === 'verde' ? 'Saudável' : statusGeral === 'amarelo' ? 'Atenção' : statusGeral === 'vermelho' ? 'Crítico' : 'Aguardando';
            }
        }

        // Termômetro UI: hero + criterios strip
        function rmRenderTermometro(rep, repB) {
            const t = rmCalcularTermometro(rep);
            const cores = rmCorStatus(t.statusGeral);

            const scoreEl = document.getElementById('rmTermometroScore');
            if(scoreEl) scoreEl.innerText = t.score;
            rmAtualizarGauge(t.score, t.statusGeral);

            const mesLbl = document.getElementById('rmHeroMesLabel');
            if(mesLbl) mesLbl.innerText = rep.label.toUpperCase();

            const resumo = document.getElementById('rmTermometroResumo');
            if(resumo) {
                let txt = '';
                if(t.statusGeral === 'verde') txt = '<strong>Saudável.</strong> Você está cumprindo a maior parte dos pilares deste mês. Mantenha o ritmo.';
                else if(t.statusGeral === 'amarelo') txt = '<strong>Atenção.</strong> Alguns critérios estão fora do alvo — ajuste antes que vire tendência.';
                else txt = '<strong>Crítico.</strong> Vários pilares fora do alvo. Foque em revisar despesas e retomar aportes.';
                resumo.innerHTML = txt + ' Score ponderado dos 5 critérios abaixo.';
            }

            // Saldo e patrimônio nos hero stats
            const saldoEl = document.getElementById('rmHeroSaldo');
            if(saldoEl) {
                saldoEl.innerText = formatarMoeda(rep.saldoFinal);
                saldoEl.style.color = rep.saldoFinal >= 0 ? 'var(--rm-verde)' : 'var(--rm-vermelho)';
            }
            const patEl = document.getElementById('rmHeroPatrimonio');
            if(patEl) patEl.innerText = formatarMoeda(rep.patrimonioMercado);

            const saldoDeltaEl = document.getElementById('rmHeroSaldoDelta');
            const patDeltaEl = document.getElementById('rmHeroPatrimonioDelta');
            if(saldoDeltaEl) saldoDeltaEl.innerHTML = repB ? rmDeltaHtml(rep.saldoFinal, repB.saldoFinal, repB.label).replace('rm-kpi-delta', 'rm-kpi-delta') : '';
            if(patDeltaEl) patDeltaEl.innerHTML = repB ? rmDeltaHtml(rep.patrimonioMercado, repB.patrimonioMercado, repB.label).replace('rm-kpi-delta', 'rm-kpi-delta') : '';

            // Strip de critérios
            const grid = document.getElementById('rmTermometroCriterios');
            if(grid) {
                const badgeTxt = s => s === 'verde' ? 'OK' : s === 'amarelo' ? 'ATENÇÃO' : s === 'vermelho' ? 'FORA' : '—';
                grid.innerHTML = t.criterios.map(c =>
                    '<div class="rm-criterio" data-status="' + c.status + '">'
                    + '<div class="rm-criterio-top">'
                    + '<div class="rm-criterio-icon"><i class="ph-fill ' + c.icone + '"></i></div>'
                    + '<span class="rm-criterio-badge">' + badgeTxt(c.status) + '</span>'
                    + '</div>'
                    + '<div class="rm-criterio-label">' + c.label + '</div>'
                    + '<div class="rm-criterio-valor">' + c.valor + '</div>'
                    + '<div class="rm-criterio-meta">Meta: ' + c.meta + '</div>'
                    + '</div>'
                ).join('');
            }
        }

        // Cards KPI (4 secundários com sparkline)
        function rmRenderKpis(rep, repB, serie12) {
            const grid = document.getElementById('rmKpisGrid');
            if(!grid) return;
            const items = [
                { tipo: 'entradas',      label: 'Entradas',          valor: rep.entradas,      valorB: repB ? repB.entradas : null,      icone: 'ph-arrow-down-left',  spark: serie12.entradas },
                { tipo: 'despesas',      label: 'Despesas totais',   valor: rep.despesasTotais,valorB: repB ? repB.despesasTotais : null,icone: 'ph-arrow-up-right',   spark: serie12.despesas },
                { tipo: 'investimentos', label: 'Investimentos',     valor: rep.investimentos, valorB: repB ? repB.investimentos : null, icone: 'ph-trending-up',      spark: serie12.investimentos },
                { tipo: 'dividendos',    label: 'Dividendos do mês', valor: rep.dividendos,    valorB: repB ? repB.dividendos : null,    icone: 'ph-coins',            spark: serie12.dividendos }
            ];
            grid.innerHTML = items.map(it =>
                '<div class="rm-kpi" data-tipo="' + it.tipo + '">'
                + '<div class="rm-kpi-top">'
                + '<span class="rm-kpi-label">' + it.label + '</span>'
                + '<div class="rm-kpi-icone"><i class="ph-fill ' + it.icone + '"></i></div>'
                + '</div>'
                + '<div class="rm-kpi-valor valor-mascarado">' + formatarMoeda(it.valor) + '</div>'
                + rmDeltaHtml(it.valor, it.valorB, repB ? repB.label : '')
                + '<div class="rm-kpi-spark">' + rmSparklineSvg(it.spark) + '</div>'
                + '</div>'
            ).join('');
        }

        // Cards secundários (Sonhos, Jornada, Applicash) — premium
        function rmRenderSecundarios(rep) {
            const grid = document.getElementById('rmSecundariosGrid');
            if(!grid) return;

            // === Sonhos ===
            const sonhosBody = (rep.sonhos.ativos === 0)
                ? '<div style="text-align:center;padding:8px 0;font-size:13px;color:var(--cor-texto-mutado);"><i class="ph ph-shooting-star" style="font-size:28px;display:block;margin:0 auto 8px;opacity:0.4;"></i>Nenhum sonho cadastrado.</div>'
                : (
                    '<div class="rm-sec-kpi-row">'
                    + '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num">' + rep.sonhos.ativos + '</div><div class="rm-sec-kpi-label">Ativos</div></div>'
                    + '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num" style="color:var(--rm-verde);">' + rep.sonhos.noPrazo + '</div><div class="rm-sec-kpi-label">No prazo</div></div>'
                    + '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num" style="color:var(--rm-roxo);">' + rep.sonhos.progressoMedio.toFixed(0) + '%</div><div class="rm-sec-kpi-label">Progresso</div></div>'
                    + '</div>'
                    + rep.sonhos.lista.slice(0, 3).map(s =>
                        '<div style="margin-bottom:10px;">'
                        + '<div class="rm-sec-meta-row"><span style="color:var(--cor-texto-principal);font-weight:600;">' + (s.nome || 'Sonho') + '</span><span style="font-family:\'DM Mono\',monospace;color:var(--cor-texto-mutado);font-size:11.5px;">' + s.pct.toFixed(0) + '%</span></div>'
                        + '<div class="rm-sec-bar"><div class="rm-sec-bar-fill" style="width:' + Math.min(100, s.pct) + '%;background:linear-gradient(90deg,var(--rm-verde),#34d399);"></div></div>'
                        + '</div>'
                    ).join('')
                    + (rep.sonhos.lista.length > 3 ? '<div style="font-size:11px;color:var(--cor-texto-mutado);text-align:center;margin-top:6px;">+ ' + (rep.sonhos.lista.length - 3) + ' sonho(s)</div>' : '')
                );
            const sonhosHtml = '<div class="rm-sec-card" data-tipo="sonhos">'
                + '<div class="rm-sec-header"><div class="rm-sec-header-row">'
                + '<div class="rm-sec-header-icon"><i class="ph-fill ph-shooting-star"></i></div>'
                + '<div><div class="rm-sec-header-title">Meus sonhos</div><div class="rm-sec-header-sub">Metas em andamento</div></div>'
                + '</div></div>'
                + '<div class="rm-sec-body">' + sonhosBody + '</div></div>';

            // === Jornada ===
            const totalMods = JORNADA_MODULOS.length;
            const prog = carregarJornadaProgresso();
            const concluidosTotal = JORNADA_MODULOS.filter(m => prog[m.id] && prog[m.id].concluidoEm).length;
            const pctTrilha = totalMods ? (concluidosTotal / totalMods) * 100 : 0;
            const tagJornada = rep.jornadaModulosMes >= 1
                ? '<span class="rm-sec-tag ok"><i class="ph-bold ph-check-circle"></i> Meta do mês atingida</span>'
                : '<span class="rm-sec-tag bad"><i class="ph-bold ph-warning"></i> Sem módulo no mês</span>';
            const jornadaHtml = '<div class="rm-sec-card" data-tipo="jornada">'
                + '<div class="rm-sec-header"><div class="rm-sec-header-row">'
                + '<div class="rm-sec-header-icon"><i class="ph-fill ph-graduation-cap"></i></div>'
                + '<div><div class="rm-sec-header-title">Jornada Financeira</div><div class="rm-sec-header-sub">Capacitação prática</div></div>'
                + '</div></div>'
                + '<div class="rm-sec-body">'
                + '<div class="rm-sec-kpi-row">'
                + '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num" style="color:var(--rm-roxo);">' + rep.jornadaModulosMes + '</div><div class="rm-sec-kpi-label">No mês</div></div>'
                + '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num">' + concluidosTotal + '/' + totalMods + '</div><div class="rm-sec-kpi-label">Trilha geral</div></div>'
                + '</div>'
                + '<div class="rm-sec-meta-row"><span style="color:var(--cor-texto-mutado);">Progresso da trilha</span><span style="font-family:\'DM Mono\',monospace;color:var(--rm-roxo);font-weight:700;font-size:11.5px;">' + pctTrilha.toFixed(0) + '%</span></div>'
                + '<div class="rm-sec-bar" style="margin-bottom:12px;"><div class="rm-sec-bar-fill" style="width:' + pctTrilha + '%;background:linear-gradient(90deg,var(--rm-roxo),#a78bfa);"></div></div>'
                + tagJornada
                + '</div></div>';

            // === Applicash ===
            const tagApp = rep.applicash.indicacoes >= 2
                ? '<span class="rm-sec-tag ok"><i class="ph-bold ph-check-circle"></i> Meta atingida (≥2)</span>'
                : rep.applicash.indicacoes === 1
                    ? '<span class="rm-sec-tag warn"><i class="ph-bold ph-arrow-up"></i> Quase lá</span>'
                    : '<span class="rm-sec-tag bad"><i class="ph-bold ph-warning"></i> Sem indicações ativas</span>';
            const appHtml = '<div class="rm-sec-card" data-tipo="applicash">'
                + '<div class="rm-sec-header"><div class="rm-sec-header-row">'
                + '<div class="rm-sec-header-icon"><i class="ph-fill ph-currency-dollar"></i></div>'
                + '<div><div class="rm-sec-header-title">Applicash $</div><div class="rm-sec-header-sub">Programa de indicações</div></div>'
                + '</div></div>'
                + '<div class="rm-sec-body">'
                + '<div class="rm-sec-kpi-row">'
                + '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num" style="color:var(--rm-azul);">' + rep.applicash.indicacoes + '</div><div class="rm-sec-kpi-label">Ativas</div></div>'
                + '<div class="rm-sec-kpi"><div class="rm-sec-kpi-num valor-mascarado" style="font-size:18px;color:var(--rm-azul);">' + formatarMoeda(rep.applicash.receita) + '</div><div class="rm-sec-kpi-label">Cashback</div></div>'
                + '</div>'
                + tagApp
                + '</div></div>';

            grid.innerHTML = sonhosHtml + jornadaHtml + appHtml;
        }

        // ====== Gráficos premium ======
        let rmChartSerieInst = null;
        let rmChartPatrimonioInst = null;
        let rmChartDonutInst = null;

        function rmGradient(ctx, area, hexFrom, hexTo) {
            if(!ctx || !area) return hexFrom;
            const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
            g.addColorStop(0, hexFrom);
            g.addColorStop(1, hexTo);
            return g;
        }

        function rmRenderGraficos(yyyymmAtual, rep) {
            // Coleta série de 12 meses
            const labels = [];
            const arrEntr = [], arrDesp = [], arrInv = [], arrDiv = [], arrAplic = [], arrMerc = [];
            for(let i = 11; i >= 0; i--) {
                const ym = rmAddMonths(yyyymmAtual, -i);
                const { mes, ano } = rmYyyymmToMesAno(ym);
                labels.push(RM_NOMES_MESES_SHORT[mes] + '/' + String(ano).slice(2));
                const r = buildMonthlyReport(ym);
                arrEntr.push(r.entradas);
                arrDesp.push(r.despesasTotais);
                arrInv.push(r.investimentos);
                arrDiv.push(r.dividendos);
                arrAplic.push(r.patrimonioAplicado);
                arrMerc.push(r.patrimonioMercado);
            }
            const serie12 = { entradas: arrEntr, despesas: arrDesp, investimentos: arrInv, dividendos: arrDiv, aplicado: arrAplic, mercado: arrMerc };

            // Legenda do fluxo (HTML)
            const leg = document.getElementById('rmFluxoLegenda');
            if(leg) leg.innerHTML = [
                { lbl: 'Entradas', cor: '#10b981' },
                { lbl: 'Despesas', cor: '#ef4444' },
                { lbl: 'Investimentos', cor: '#7c3aed' }
            ].map(l => '<div class="rm-chart-legend-item"><span class="rm-chart-legend-dot" style="--dot-cor:' + l.cor + ';"></span>' + l.lbl + '</div>').join('');

            // ===== Fluxo (linhas com gradient area) =====
            const ctx1 = document.getElementById('rmChartSerie');
            if(ctx1 && window.Chart) {
                if(rmChartSerieInst) try { rmChartSerieInst.destroy(); } catch(_) {}
                rmChartSerieInst = new Chart(ctx1.getContext('2d'), {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [
                            {
                                label: 'Entradas', data: arrEntr,
                                borderColor: '#10b981', backgroundColor: ctx => rmGradient(ctx.chart.ctx, ctx.chart.chartArea, 'rgba(16,185,129,0.30)', 'rgba(16,185,129,0)'),
                                fill: true, tension: 0.4, borderWidth: 2.5,
                                pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: '#10b981', pointBorderColor: '#fff', pointBorderWidth: 2
                            },
                            {
                                label: 'Despesas', data: arrDesp,
                                borderColor: '#ef4444', backgroundColor: ctx => rmGradient(ctx.chart.ctx, ctx.chart.chartArea, 'rgba(239,68,68,0.22)', 'rgba(239,68,68,0)'),
                                fill: true, tension: 0.4, borderWidth: 2.5,
                                pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: '#ef4444', pointBorderColor: '#fff', pointBorderWidth: 2
                            },
                            {
                                label: 'Investimentos', data: arrInv,
                                borderColor: '#7c3aed', backgroundColor: ctx => rmGradient(ctx.chart.ctx, ctx.chart.chartArea, 'rgba(124,58,237,0.22)', 'rgba(124,58,237,0)'),
                                fill: true, tension: 0.4, borderWidth: 2.5,
                                pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: '#7c3aed', pointBorderColor: '#fff', pointBorderWidth: 2
                            }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: { display: false },
                            datalabels: { display: false },
                            tooltip: {
                                backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#fff', bodyColor: '#e2e8f0',
                                padding: 12, cornerRadius: 10, displayColors: true, boxPadding: 4,
                                titleFont: { size: 12, weight: 'bold' }, bodyFont: { size: 12 },
                                callbacks: { label: c => '  ' + c.dataset.label + ': ' + formatarMoeda(c.parsed.y) }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                grid: { color: 'rgba(148,163,184,0.15)', drawBorder: false },
                                ticks: { callback: v => rmFormatarMoedaCompacta(v), font: { size: 10.5 }, color: '#94a3b8', padding: 8 }
                            },
                            x: {
                                grid: { display: false },
                                ticks: { font: { size: 10.5, weight: '600' }, color: '#64748b' }
                            }
                        }
                    }
                });
            }

            // ===== Patrimônio (área aplicado + área mercado por cima) =====
            const ctx2 = document.getElementById('rmChartPatrimonio');
            if(ctx2 && window.Chart) {
                if(rmChartPatrimonioInst) try { rmChartPatrimonioInst.destroy(); } catch(_) {}
                rmChartPatrimonioInst = new Chart(ctx2.getContext('2d'), {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [
                            {
                                label: 'Valor de mercado', data: arrMerc,
                                borderColor: '#10b981',
                                backgroundColor: ctx => rmGradient(ctx.chart.ctx, ctx.chart.chartArea, 'rgba(16,185,129,0.30)', 'rgba(16,185,129,0)'),
                                fill: true, tension: 0.4, borderWidth: 2.5,
                                pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: '#10b981', pointBorderColor: '#fff', pointBorderWidth: 2
                            },
                            {
                                label: 'Valor aplicado', data: arrAplic,
                                borderColor: '#7c3aed', borderDash: [4, 4],
                                backgroundColor: 'transparent',
                                fill: false, tension: 0.4, borderWidth: 2,
                                pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: '#7c3aed', pointBorderColor: '#fff', pointBorderWidth: 2
                            }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11, weight: '600' }, color: '#64748b', usePointStyle: true, pointStyle: 'circle', padding: 14 } },
                            datalabels: { display: false },
                            tooltip: {
                                backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#fff', bodyColor: '#e2e8f0',
                                padding: 12, cornerRadius: 10, displayColors: true, boxPadding: 4,
                                callbacks: { label: c => '  ' + c.dataset.label + ': ' + formatarMoeda(c.parsed.y) }
                            }
                        },
                        scales: {
                            y: { beginAtZero: false, grid: { color: 'rgba(148,163,184,0.15)' }, ticks: { callback: v => rmFormatarMoedaCompacta(v), font: { size: 10.5 }, color: '#94a3b8', padding: 8 } },
                            x: { grid: { display: false }, ticks: { font: { size: 10.5, weight: '600' }, color: '#64748b' } }
                        }
                    }
                });
            }
            // Pill de variação no header do gráfico de patrimônio
            const pill = document.getElementById('rmPatrimonioVariacao');
            if(pill) {
                const ganho = (rep.patrimonioMercado || 0) - (rep.patrimonioAplicado || 0);
                if(rep.patrimonioAplicado > 0) {
                    const pct = (ganho / rep.patrimonioAplicado) * 100;
                    pill.className = 'rm-chart-pill ' + (ganho < 0 ? 'neg' : '');
                    pill.innerHTML = (ganho >= 0 ? '▲ +' : '▼ ') + pct.toFixed(1) + '%';
                    pill.style.display = '';
                } else { pill.style.display = 'none'; }
            }

            // ===== Donut: para onde foi o dinheiro =====
            rmRenderDonut(rep);

            return serie12;
        }

        function rmRenderDonut(rep) {
            const ctx = document.getElementById('rmChartDonut');
            if(!ctx) return;
            // Reconstrói categorias a partir de transações do mês
            const slices = [];
            try {
                const r = (typeof calcularResumoMes === 'function') ? calcularResumoMes(rep.mes, rep.ano) : { despFixa:0, despVar:0, cartao:0, sonho:0, invFixo:0, invVar:0 };
                slices.push({ lbl: 'Despesas fixas',    val: r.despFixa || 0, cor: '#ef4444' });
                slices.push({ lbl: 'Despesas variáveis',val: r.despVar  || 0, cor: '#f97316' });
                slices.push({ lbl: 'Cartão de crédito', val: r.cartao   || 0, cor: '#f59e0b' });
                slices.push({ lbl: 'Sonhos',            val: r.sonho    || 0, cor: '#ec4899' });
                slices.push({ lbl: 'Investimentos',     val: (r.invFixo||0)+(r.invVar||0), cor: '#7c3aed' });
            } catch(_) {}
            const filtrados = slices.filter(s => s.val > 0);
            const totalSaidas = filtrados.reduce((a, b) => a + b.val, 0);

            const legenda = document.getElementById('rmDonutLegenda');
            const totalEl = document.getElementById('rmDonutTotal');
            if(totalEl) totalEl.innerText = formatarMoeda(totalSaidas);
            if(filtrados.length === 0) {
                if(rmChartDonutInst) try { rmChartDonutInst.destroy(); } catch(_) {}
                if(legenda) legenda.innerHTML = '<div style="font-size:13px;color:var(--cor-texto-mutado);text-align:center;padding:30px 0;"><i class="ph ph-chart-donut" style="font-size:30px;display:block;margin:0 auto 8px;opacity:0.4;"></i>Sem saídas neste mês</div>';
                if(ctx) ctx.style.opacity = '0.3';
                if(totalEl) totalEl.innerText = '—';
                return;
            }
            if(ctx) ctx.style.opacity = '1';

            if(window.Chart) {
                if(rmChartDonutInst) try { rmChartDonutInst.destroy(); } catch(_) {}
                rmChartDonutInst = new Chart(ctx.getContext('2d'), {
                    type: 'doughnut',
                    data: {
                        labels: filtrados.map(s => s.lbl),
                        datasets: [{
                            data: filtrados.map(s => s.val),
                            backgroundColor: filtrados.map(s => s.cor),
                            borderColor: '#fff', borderWidth: 3,
                            hoverOffset: 8, hoverBorderColor: '#fff'
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        cutout: '68%',
                        plugins: {
                            legend: { display: false },
                            datalabels: { display: false },
                            tooltip: {
                                backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#fff', bodyColor: '#e2e8f0',
                                padding: 12, cornerRadius: 10,
                                callbacks: {
                                    label: c => '  ' + c.label + ': ' + formatarMoeda(c.parsed) + ' (' + (c.parsed / totalSaidas * 100).toFixed(1) + '%)'
                                }
                            }
                        }
                    }
                });
            }
            if(legenda) {
                legenda.innerHTML = filtrados.map(s =>
                    '<div class="rm-donut-leg-item">'
                    + '<span class="rm-donut-leg-dot" style="background:' + s.cor + ';"></span>'
                    + '<span class="rm-donut-leg-label">' + s.lbl + '</span>'
                    + '<span class="rm-donut-leg-valor valor-mascarado">' + formatarMoeda(s.val) + '</span>'
                    + '<span class="rm-donut-leg-pct">' + (s.val / totalSaidas * 100).toFixed(0) + '%</span>'
                    + '</div>'
                ).join('');
            }
        }

        // Comparação on/off
        let rmModoComparacao = false;
        function rmToggleComparacao() {
            rmModoComparacao = !rmModoComparacao;
            const bar = document.getElementById('rmComparacaoBar');
            const lbl = document.getElementById('rmBtnCompararLabel');
            if(bar) bar.style.display = rmModoComparacao ? 'flex' : 'none';
            if(lbl) lbl.innerText = rmModoComparacao ? 'Sair da comparação' : 'Comparar com…';
            // Default mês B = mês anterior ao atual
            if(rmModoComparacao) {
                const seletor = document.getElementById('rmSeletorMes');
                const selB = document.getElementById('rmSeletorMesB');
                if(selB && !selB.value && seletor.value) selB.value = rmAddMonths(seletor.value, -1);
            }
            renderRelatorioMensal();
        }

        // Render principal
        function renderRelatorioMensal() {
            const seletor = document.getElementById('rmSeletorMes');
            if(!seletor) return;
            if(!seletor.value) {
                const hoje = new Date();
                seletor.value = rmMesAnoToYyyymm(hoje.getMonth(), hoje.getFullYear());
            }
            const yyyymm = seletor.value;
            const rep = buildMonthlyReport(yyyymm);

            let repB = null;
            if(rmModoComparacao) {
                const yyyymmB = document.getElementById('rmSeletorMesB').value;
                if(yyyymmB) repB = buildMonthlyReport(yyyymmB);
            }

            // Empty state
            const empty = document.getElementById('rmEmptyState');
            const isFuturo = rmMesEhFuturo(yyyymm);
            if(!rep.hasData && isFuturo) {
                if(empty) {
                    empty.style.display = '';
                    empty.querySelector('h3').innerText = 'Mês futuro';
                    empty.querySelector('p').innerText = 'Este mês ainda não chegou. Selecione um mês atual ou passado.';
                }
            } else if(empty) {
                empty.style.display = 'none';
            }

            rmRenderTermometro(rep, repB);
            const serie12 = rmRenderGraficos(yyyymm, rep) || { entradas:[], despesas:[], investimentos:[], dividendos:[] };
            rmRenderKpis(rep, repB, serie12);
            rmRenderSecundarios(rep);
        }

        // PDF — carrega html2pdf sob demanda
        function rmCarregarHtml2pdf() {
            return new Promise((resolve, reject) => {
                if(window.html2pdf) return resolve(window.html2pdf);
                const s = document.createElement('script');
                s.src = RM_HTML2PDF_CDN;
                s.onload = () => resolve(window.html2pdf);
                s.onerror = () => reject(new Error('Falha ao carregar html2pdf'));
                document.head.appendChild(s);
            });
        }
        async function rmExportarPDF() {
            const btnLabel = 'Exportar PDF';
            try {
                if(typeof mostrarToast === 'function') mostrarToast('Gerando PDF…', 'info');
                const html2pdf = await rmCarregarHtml2pdf();
                const seletor = document.getElementById('rmSeletorMes');
                const ym = seletor ? seletor.value : 'mes';
                const conteudo = document.getElementById('rmConteudo');
                if(!conteudo) return;
                const filename = 'relatorio-mensal-' + ym + '.pdf';
                await html2pdf().set({
                    margin: [10, 10, 10, 10],
                    filename,
                    image: { type: 'jpeg', quality: 0.95 },
                    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
                }).from(conteudo).save();
                if(typeof mostrarToast === 'function') mostrarToast('PDF gerado com sucesso.', 'sucesso');
            } catch(err) {
                console.error('[rmExportarPDF]', err);
                if(typeof mostrarToast === 'function') mostrarToast('Não foi possível gerar o PDF.', 'erro');
            }
        }

        // Inicialização defensiva: pré-renderiza a jornada para que o card chip apareça
        document.addEventListener('DOMContentLoaded', () => {
            try { renderizarJornada(); } catch(_) {}
        });
