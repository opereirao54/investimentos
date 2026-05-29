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
  document.querySelectorAll('.section').forEach((sec) => sec.classList.remove('ativa'));
  document.querySelectorAll('.menu-btn').forEach((btn) => btn.classList.remove('ativo'));
  document.getElementById(idAba).classList.add('ativa');
  e.currentTarget.classList.add('ativo');

  // Marca body para que o FAB de "Novo lançamento" apareça só em #controle (mobile)
  document.body.classList.toggle('controle-ativo', idAba === 'controle');
  // Fecha o drawer "Novo lançamento" ao trocar de aba
  if (idAba !== 'controle' && typeof fecharPainelLancamento === 'function') {
    fecharPainelLancamento();
  }

  if (idAba === 'patrimonio') atualizarCarteiraAtivos();
  if (idAba === 'controle') atualizarTelaControle();
  if (idAba === 'simulador') {
    const emMeta = document.getElementById('simModoMeta') && document.getElementById('simModoMeta').style.display !== 'none';
    if (emMeta) calcularMeta(); else calcularSimulador();
  }
  if (idAba === 'carteira') carregarCarteiraCliente();
  if (idAba === 'meus_sonhos') renderizarSonhos();
  if (idAba === 'applicash') atualizarTelaApplicash();
  if (idAba === 'duvidas_sugestoes') {
    renderizarFaq();
    renderizarHistoricoSugestoes();
  }
  if (idAba === 'meu_patrimonio') renderMeuPatrimonio();
  if (idAba === 'aulas') renderizarJornada();
  if (idAba === 'relatorio_mensal') renderRelatorioMensal();
  if (callback) callback();
  if (typeof closeMobileNav === 'function') closeMobileNav();
}

// Sub-abas dentro de "Meus Investimentos"
var filtroOpsTimeline = 'todos';
function mudarSubAbaPatrimonio(qual) {
  const subs = {
    carteira: document.getElementById('subAbaCarteira'),
    operacoes: document.getElementById('subAbaOperacoes'),
    dividendos: document.getElementById('subAbaDividendos'),
  };
  const btns = {
    carteira: document.getElementById('subtabBtnCarteira'),
    operacoes: document.getElementById('subtabBtnOperacoes'),
    dividendos: document.getElementById('subtabBtnDividendos'),
  };
  const btnRefresh = document.getElementById('btnAtualizarDividendos');
  const filtros = document.getElementById('filtrosCategoria');
  Object.keys(subs).forEach((k) => {
    subs[k].style.display = k === qual ? 'block' : 'none';
    btns[k].classList.toggle('ativo', k === qual);
  });
  if (filtros) filtros.style.display = qual === 'carteira' ? 'flex' : 'none';
  const quadroCat = document.getElementById('quadroCategoriasInferior');
  if (quadroCat && qual !== 'carteira') quadroCat.style.display = 'none';
  btnRefresh.style.display = qual === 'dividendos' ? 'inline-flex' : 'none';
  // Ao mudar para dividendos, limpa o filtro de ativo e recarrega
  if (qual === 'dividendos') {
    dividendosFiltroAtivo = '';
    carregarDividendos();
  }
  if (qual === 'operacoes') renderizarOperacoes();
  // Voltar para carteira precisa re-renderizar a "Posição por categoria",
  // que foi escondida acima ao trocar de sub-aba.
  if (qual === 'carteira' && typeof atualizarCarteiraAtivos === 'function')
    atualizarCarteiraAtivos();
  atualizarMiniStats(qual);
}

function filtrarOpsTimeline(tipo, btn) {
  filtroOpsTimeline = tipo;
  document.querySelectorAll('#opsToolbar .ops-chip').forEach((c) => c.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');
  renderizarOperacoes();
}

function atualizarMiniStats(aba) {
  const el = document.getElementById('subtabMiniStat');
  if (!el) return;
  const carteira = obterResumoCarteira();
  const totalAtivos = Object.keys(carteira).filter((t) => carteira[t].qtdTotal > 0).length;
  const totalOps = historicoCompras.length;

  if (aba === 'carteira') {
    let saldoTotal = 0;
    for (const t in carteira) {
      if (carteira[t].qtdTotal <= 0) continue;
      const am = mockAtivosMercado.find((a) => a.ticker === t);
      const p = am ? am.preco_atual : carteira[t].precoMedio;
      saldoTotal += carteira[t].qtdTotal * p;
    }
    el.innerHTML = `<i class="ph ph-briefcase" style="font-size:13px;"></i> ${totalAtivos} ativo${totalAtivos !== 1 ? 's' : ''} · <span class="valor-mascarado" style="font-family:'DM Mono',monospace;">${formatarMoeda(saldoTotal)}</span>`;
  } else if (aba === 'operacoes') {
    el.innerHTML = `<i class="ph ph-list-bullets" style="font-size:13px;"></i> ${totalOps} operaç${totalOps !== 1 ? 'ões' : 'ão'}`;
  } else if (aba === 'dividendos') {
    el.innerHTML = `<i class="ph ph-coins" style="font-size:13px;"></i> Proventos 12m`;
  }
}

function exportarOperacoesCSV() {
  if (historicoCompras.length === 0)
    return mostrarToast('Nenhuma operação para exportar.', 'aviso');
  const headers = ['Data', 'Tipo', 'Ticker', 'Categoria', 'Corretora', 'Qtd', 'Preço', 'Total'];
  const rows = historicoCompras.map((op) => {
    const total = (op.quantidade || 1) * (op.preco || 0);
    return [
      op.data_op || '',
      op.tipo || 'compra',
      op.ticker,
      op.categoria || '',
      op.corretora || '',
      op.quantidade || 1,
      op.preco || 0,
      total.toFixed(2),
    ];
  });
  let csv = headers.join(';') + '\n' + rows.map((r) => r.join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `operacoes_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  mostrarToast('Operações exportadas!', 'sucesso');
}

function toggleColunasExtras() {
  const tab = document.getElementById('tabelaCarteira');
  const lbl = document.getElementById('lblToggleColunas');
  if (!tab) return;
  const aberto = tab.classList.toggle('com-extras');
  if (lbl) lbl.innerText = aberto ? 'Menos colunas' : 'Mais colunas';
  try {
    localStorage.setItem('appliquei_carteira_extras', aberto ? '1' : '0');
  } catch (_) {}
}

// === DRAWER DE OPERAÇÃO ===
function abrirDrawerOperacao() {
  const drawer = document.getElementById('drawerOperacao');
  const overlay = document.getElementById('drawerOverlay');
  if (!drawer || !overlay) return;
  // Garante estado inicial limpo do form
  const elData = document.getElementById('compraData');
  if (elData && !elData.value) elData.value = new Date().toISOString().slice(0, 10);
  drawer.classList.add('aberto');
  overlay.classList.add('aberto');
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    document.getElementById('compraTicker')?.focus();
  }, 240);
}
function fecharDrawerOperacao() {
  const drawer = document.getElementById('drawerOperacao');
  const overlay = document.getElementById('drawerOverlay');
  if (!drawer || !overlay) return;
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
function abrirPainelLancamentoMobile() {
  abrirPainelLancamento();
}
function fecharPainelLancamentoMobile() {
  fecharPainelLancamento();
}

function toggleDarkMode() {
  document.body.classList.toggle('dark');
  const icon = document.getElementById('iconTheme');
  if (icon) icon.className = document.body.classList.contains('dark') ? 'ph ph-moon' : 'ph ph-sun';
  // Re-aplica tokens nos gráficos e força re-render
  if (typeof aplicarTemaChartJs === 'function') aplicarTemaChartJs();
  try {
    if (typeof renderizarGraficoEvolucao === 'function') renderizarGraficoEvolucao();
    if (
      typeof obterResumoCarteira === 'function' &&
      typeof renderizarGraficoDistribuicao === 'function'
    ) {
      renderizarGraficoDistribuicao(obterResumoCarteira());
    }
  } catch (_) {}
}

function aplicarEstadoValoresOcultos(oculto) {
  document.body.classList.toggle('valores-ocultos', oculto);
  document.querySelectorAll('.btn-eye').forEach((btn) => {
    btn.classList.toggle('ativo', oculto);
    btn.title = oculto ? 'Mostrar valores' : 'Ocultar valores';
    const icone = btn.querySelector('i');
    if (icone) icone.className = oculto ? 'ph ph-eye-slash' : 'ph ph-eye';
  });
}
function toggleValoresOcultos() {
  const oculto = !document.body.classList.contains('valores-ocultos');
  aplicarEstadoValoresOcultos(oculto);
  try {
    localStorage.setItem('appliquei_valores_ocultos', oculto ? '1' : '0');
  } catch (e) {}
}
(function inicializarValoresOcultos() {
  let salvo = '0';
  try {
    salvo = localStorage.getItem('appliquei_valores_ocultos') || '0';
  } catch (e) {}
  if (salvo === '1') aplicarEstadoValoresOcultos(true);
})();

// === CHIPS DE TIPO DE LANÇAMENTO ===
function selecionarChipTipo(tipo) {
  const chips = {
    entrada: document.getElementById('chipEntrada'),
    saida: document.getElementById('chipSaida'),
    cartao: document.getElementById('chipCartao'),
  };
  const estilosBase =
    "flex:1;padding:8px 4px;border-radius:8px;border:1.5px solid var(--cor-borda);background:var(--cor-superficie);color:var(--cor-texto-secundario);font-size:11.5px;font-weight:600;cursor:pointer;transition:.15s;font-family:'Figtree',sans-serif;display:flex;align-items:center;justify-content:center;gap:4px;";
  Object.values(chips).forEach((c) => (c.style.cssText = estilosBase));
  const sel = document.getElementById('categoriaTransacao');
  if (tipo === 'entrada') {
    chips.entrada.style.cssText =
      estilosBase +
      'background:var(--cor-bg-primaria);color:var(--cor-txt-primaria);border-color:var(--cor-borda-primaria);';
    sel.value = 'receita';
    verificarRegraCartao();
  } else if (tipo === 'saida') {
    chips.saida.style.cssText =
      estilosBase +
      'background:var(--cor-bg-erro);color:var(--cor-txt-erro);border-color:var(--cor-borda-erro);';
    sel.value = 'despesa_variavel';
    verificarRegraCartao();
  } else if (tipo === 'cartao') {
    chips.cartao.style.cssText =
      estilosBase +
      'background:var(--cor-bg-amber);color:var(--cor-txt-amber);border-color:var(--cor-borda-amber);';
    sel.value = 'cartao_credito';
    verificarRegraCartao();
  }
}

function filtrarExtrato(e, tipo) {
  document.querySelectorAll('.ext-tab').forEach((t) => t.classList.remove('on'));
  e.currentTarget.classList.add('on');
  const ids = ['extratoReceitas', 'extratoDespesas', 'extratoCartao', 'extratoInvestimentos'];
  const map = {
    todos: ids,
    receita: ['extratoReceitas'],
    despesa: ['extratoDespesas'],
    cartao: ['extratoCartao'],
    investimento: ['extratoInvestimentos'],
  };
  const show = map[tipo] || ids;
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = show.includes(id) ? 'flex' : 'none';
  });
}

function formatarMoeda(valor) {
  return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// --- GESTÃO DO MODAL DE CONFIGURAÇÕES ---
function abrirModalConfig() {
  renderizarListaCartoesConfig();
  document.getElementById('modalConfiguracoes').style.display = 'flex';
}
function fecharModalConfig() {
  document.getElementById('modalConfiguracoes').style.display = 'none';
}
function salvarEFecharConfig() {
  salvarMetasEAtualizar();
  fecharModalConfig();
  mostrarToast('Configurações atualizadas!', 'sucesso');
}

function salvarMetasEAtualizar() {
  localStorage.setItem(
    'futurorico_metaVerde',
    parseBRL(document.getElementById('metaVerde').value)
  );
  localStorage.setItem(
    'futurorico_metaVermelha',
    parseBRL(document.getElementById('metaVermelha').value)
  );
  atualizarTelaControle();
}

function carregarMetas() {
  const verde = localStorage.getItem('futurorico_metaVerde');
  const vermelha = localStorage.getItem('futurorico_metaVermelha');
  if (verde) setValorBRLInput(document.getElementById('metaVerde'), verde);
  if (vermelha) setValorBRLInput(document.getElementById('metaVermelha'), vermelha);
}

// --- GESTÃO DE CARTÕES ---
function renderizarListaCartoesConfig() {
  const container = document.getElementById('listaCartoesConfig');
  if (!container) return;
  if (cartoes.length === 0) {
    container.innerHTML =
      '<div style="font-size:12px;color:var(--cor-texto-mutado);font-style:italic;padding:8px;">Nenhum cartão cadastrado.</div>';
    return;
  }
  const ordenados = [...cartoes].sort((a, b) =>
    a.arquivado === b.arquivado ? 0 : a.arquivado ? 1 : -1
  );
  container.innerHTML = ordenados
    .map((c) => {
      const fech = c.diaFechamento ? `Fech. dia ${c.diaFechamento}` : 'Sem fechamento';
      const venc = c.diaVencimento ? `Venc. dia ${c.diaVencimento}` : 'Sem vencimento';
      const arq = c.arquivado;
      const acaoBtn = arq
        ? `<button class="btn-secundario" style="padding:4px 8px;font-size:11px;color:var(--cor-primaria);border-color:var(--cor-primaria);" onclick="restaurarCartaoConfig('${c.id}')" title="Restaurar"><i class="ph ph-arrow-counter-clockwise"></i></button>`
        : `<button class="btn-secundario" style="padding:4px 8px;font-size:11px;color:var(--cor-erro);border-color:var(--cor-erro);" onclick="arquivarCartaoConfig('${c.id}')" title="Arquivar (mantém histórico)"><i class="ph ph-archive"></i></button>`;
      const badge = arq
        ? `<span style="background:var(--cor-borda);color:var(--cor-texto-mutado);padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-left:6px;">Arquivado</span>`
        : '';
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
    })
    .join('');
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

  if (!nome) return mostrarToast('Informe o nome do cartão.', 'erro');
  if (!diaFech || diaFech < 1 || diaFech > 31)
    return mostrarToast('Informe o dia de fechamento (1 a 31).', 'erro');
  if (!diaVenc || diaVenc < 1 || diaVenc > 31)
    return mostrarToast('Informe o dia de vencimento (1 a 31).', 'erro');

  if (editandoId) {
    const c = cartoes.find((x) => x.id === editandoId);
    if (c) {
      c.nome = nome;
      c.limite = limite;
      c.diaFechamento = diaFech;
      c.diaVencimento = diaVenc;
    }
  } else {
    cartoes.push({
      id: 'card_' + Date.now(),
      nome,
      limite,
      diaFechamento: diaFech,
      diaVencimento: diaVenc,
    });
  }
  salvarCartoes();
  cancelarNovoCartaoConfig();
  renderizarListaCartoesConfig();
  atualizarSelectCartoesForm();
  atualizarTelaControle();
  mostrarToast(editandoId ? 'Cartão atualizado.' : 'Cartão adicionado.', 'sucesso');
}

function editarCartaoConfig(id) {
  const c = cartoes.find((x) => x.id === id);
  if (!c) return;
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
    return mostrarToast('Você precisa manter pelo menos um cartão ativo.', 'erro');
  }
  const c = cartoes.find((x) => x.id === id);
  if (!c) return;
  const usados = transacoes.some((t) => t.cartaoId === id);
  const msg = usados
    ? `Arquivar "${c.nome}"? O histórico de lançamentos será preservado e continuará vinculado a este cartão. O cartão deixa de aparecer no formulário de novas despesas, mas pode ser restaurado a qualquer momento.`
    : `Arquivar "${c.nome}"?`;
  if (!confirm(msg)) return;
  c.arquivado = true;
  salvarCartoes();
  renderizarListaCartoesConfig();
  atualizarSelectCartoesForm();
  atualizarTelaControle();
  mostrarToast('Cartão arquivado. Histórico preservado.', 'sucesso');
}

function restaurarCartaoConfig(id) {
  const c = cartoes.find((x) => x.id === id);
  if (!c) return;
  c.arquivado = false;
  salvarCartoes();
  renderizarListaCartoesConfig();
  atualizarSelectCartoesForm();
  atualizarTelaControle();
  mostrarToast('Cartão restaurado.', 'sucesso');
}

// --- ABA 1: MEUS INVESTIMENTOS ---
var historicoCompras = JSON.parse(localStorage.getItem('futurorico_compras')) || [];
var transacoes = JSON.parse(localStorage.getItem('futurorico_transacoes')) || [];
// Backfill: compromissos mensais de sonho criados antes da feature de "conta a vencer"
// não tinham dataVencimento. Preenche com dia 5 (default) para que apareçam no painel.
(function backfillVencimentoSonhoCompromisso() {
  let mudou = false;
  transacoes.forEach((t) => {
    if (
      t.categoria === 'sonho' &&
      !t.aporteExtra &&
      !t.pago &&
      !t.dataVencimento &&
      typeof t.mes === 'number' &&
      typeof t.ano === 'number'
    ) {
      const ultimoDia = new Date(t.ano, t.mes + 1, 0).getDate();
      const dia = Math.min(5, ultimoDia);
      t.dataVencimento = `${t.ano}-${String(t.mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      mudou = true;
    }
  });
  if (mudou) localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
})();

// --- CARTÕES DE CRÉDITO ---
var cartoes = JSON.parse(localStorage.getItem('futurorico_cartoes')) || [];

// Migração: se não há cartões cadastrados, cria um padrão a partir do antigo limiteCartao
if (cartoes.length === 0) {
  const limiteAntigo = parseFloat(localStorage.getItem('futurorico_limiteCartao')) || 5000;
  cartoes.push({
    id: 'card_padrao',
    nome: 'Cartão principal',
    limite: limiteAntigo,
    diaVencimento: null,
  });
  localStorage.setItem('futurorico_cartoes', JSON.stringify(cartoes));
}

// Migração: garante que todo cartão tenha o campo `arquivado`
cartoes = cartoes.map((c) => ({ ...c, arquivado: c.arquivado === true }));
localStorage.setItem('futurorico_cartoes', JSON.stringify(cartoes));

function salvarCartoes() {
  localStorage.setItem('futurorico_cartoes', JSON.stringify(cartoes));
}

function obterCartao(id) {
  return cartoes.find((c) => c.id === id) || cartoes[0];
}

function cartoesAtivos() {
  return cartoes.filter((c) => !c.arquivado);
}

// Migração de transações antigas: cartão de crédito sem cartaoId vai pro primeiro cartão; sem obs vira ""
transacoes = transacoes.map((t) => {
  if (t.categoria === 'cartao_credito' && !t.cartaoId) t.cartaoId = cartoes[0].id;
  if (t.obs === undefined) t.obs = '';
  return t;
});

// Migração: cartao_credito deve ser atribuído ao mês/ano da fatura (dataVencimento),
// não ao mês da compra. Sem isto, despesas de cartão poluem o mês actual.
(function migrarCompetenciaCartao() {
  let mudou = false;
  transacoes.forEach((t) => {
    if (t.categoria !== 'cartao_credito' || !t.dataVencimento) return;
    const parts = t.dataVencimento.split('-');
    if (parts.length !== 3) return;
    const fAno = parseInt(parts[0], 10);
    const fMes = parseInt(parts[1], 10) - 1;
    if (isNaN(fAno) || isNaN(fMes)) return;
    if (t.mes !== fMes || t.ano !== fAno) {
      t.mes = fMes;
      t.ano = fAno;
      mudou = true;
    }
  });
  if (mudou) localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
})();
localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));

function preencherPrecoAutomatico() {
  const inputTicker = document.getElementById('compraTicker').value.toUpperCase();
  const ativoEncontrado = mockAtivosMercado.find((a) => a.ticker === inputTicker);
  if (ativoEncontrado) {
    setValorBRLInput(document.getElementById('compraPreco'), ativoEncontrado.preco_atual);
    calcularTotalCompra();
  }
}

function calcularTotalCompra() {
  const cat = document.getElementById('compraCategoria').value;
  const semQtd = cat === 'renda_fixa' || cat === 'reserva_emergencia' || cat === 'previdencia';
  const qtd = semQtd ? 1 : parseQtd(document.getElementById('compraQtd').value) || 0;
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

  inputTicker.value = '';
  document.getElementById('compraQtd').value = '';
  document.getElementById('compraPreco').value = '';
  document.getElementById('compraTotalOp').innerText = 'R$ 0,00';
  const elCorretora = document.getElementById('compraCorretora');
  if (elCorretora) elCorretora.value = '';
  const elVenc = document.getElementById('compraVencimento');
  if (elVenc) elVenc.value = '';
  const elRent = document.getElementById('compraRentabilidade');
  if (elRent) elRent.value = '';
  const elData = document.getElementById('compraData');
  if (elData) elData.value = new Date().toISOString().slice(0, 10);
  const elCat = document.getElementById('compraCategoria');
  if (elCat) {
    elCat.value = 'renda_variavel';
    delete elCat.dataset.touched;
  }
  const elSub = document.getElementById('compraSubcategoria');
  if (elSub) {
    elSub.value = 'acoes';
    delete elSub.dataset.touched;
  }
  ajustarCamposPorCategoria();

  if (tipo === 'compra') {
    btnCompra.classList.add('ativo-compra');
    btnVenda.classList.remove('ativo-venda');
    painelCard.style.background = 'var(--cor-bg-primaria)';
    painelCard.style.borderColor = '#a7f3d0';
    lblPreco.innerText = 'Preço Pago (R$)';
    btnConfirmar.innerHTML = '<i class="ph-bold ph-check"></i> Confirmar';
    btnConfirmar.style.backgroundColor = 'var(--cor-primaria)';
    iconePainel.className = 'ph-fill ph-plus-circle';
    iconePainel.style.color = 'var(--cor-primaria)';
    totalTexto.style.color = 'var(--cor-primaria)';
    inputTicker.setAttribute('list', 'listaAtivosMercado');
    inputTicker.placeholder = 'Ex: BTLG11 ou Tesouro';
    dicaTicker.innerText = 'Digite o ativo e preencheremos a cotação (você pode editar).';
  } else {
    btnVenda.classList.add('ativo-venda');
    btnCompra.classList.remove('ativo-compra');
    painelCard.style.background = 'var(--cor-bg-erro)';
    painelCard.style.borderColor = '#fecdd3';
    lblPreco.innerText = 'Preço de Venda (R$)';
    btnConfirmar.innerHTML = '<i class="ph-bold ph-trend-down"></i> Confirmar';
    btnConfirmar.style.backgroundColor = 'var(--cor-erro)';
    iconePainel.className = 'ph-fill ph-minus-circle';
    iconePainel.style.color = 'var(--cor-erro)';
    totalTexto.style.color = 'var(--cor-erro)';
    inputTicker.setAttribute('list', 'listaAtivosCarteira');
    inputTicker.placeholder = 'Selecione um ativo da sua carteira';
    dicaTicker.innerText = 'Apenas ativos que você possui estão listados aqui.';
  }
}

// Lista padrão de bancos / corretoras brasileiras
var LISTA_CORRETORAS = [
  'XP Investimentos',
  'BTG Pactual',
  'Rico',
  'Clear Corretora',
  'NuInvest',
  'Inter Invest',
  'Itaú',
  'Bradesco',
  'Santander',
  'Banco do Brasil',
  'Caixa Econômica',
  'Sicredi',
  'Sicoob',
  'Modalmais',
  'Avenue',
  'Genial Investimentos',
  'C6 Bank',
  'PicPay',
  'Easynvest',
  'Mirae Asset',
  'Toro Investimentos',
  'Órama',
  'Ágora Investimentos',
  'Safra',
];

function inicializarDatalistCorretoras() {
  const dl = document.getElementById('listaCorretoras');
  if (!dl) return;
  dl.innerHTML = '';
  // Junta as padrão com qualquer corretora que o usuário já tenha digitado
  const usadas = [...new Set(historicoCompras.map((op) => op.corretora).filter(Boolean))];
  const todas = [...new Set([...LISTA_CORRETORAS, ...usadas])].sort((a, b) =>
    a.localeCompare(b, 'pt-BR')
  );
  todas.forEach((nome) => {
    const opt = document.createElement('option');
    opt.value = nome;
    dl.appendChild(opt);
  });
}

function inicializarDatalistBancosTransacao(cat) {
  const dl = document.getElementById('listaBancosTransacao');
  if (!dl) return;
  dl.innerHTML = '';

  // 4.8 — Despesa = dinheiro SAINDO: sugere só instituições que já têm
  // saldo, da maior pra menor (preenchimento rápido). Se houver uma só,
  // preenche automaticamente (menos cliques). Receita/resgate: lista
  // completa, pois o dinheiro pode entrar num banco ainda sem saldo.
  const ehSaida = cat === 'despesa_fixa' || cat === 'despesa_variavel';
  if (ehSaida && typeof mpCalcularSaldoPorInstituicao === 'function') {
    const saldos = mpCalcularSaldoPorInstituicao(Date.now());
    const comSaldo = Object.values(saldos)
      .filter((v) => (v.caixa || 0) > 0.005)
      .sort((a, b) => b.caixa - a.caixa);
    comSaldo.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.label;
      opt.label = typeof formatarMoeda === 'function' ? `${formatarMoeda(v.caixa)} disponível` : '';
      dl.appendChild(opt);
    });
    const inp = document.getElementById('bancoTransacao');
    if (inp && !inp.value && comSaldo.length === 1) inp.value = comSaldo[0].label;
    return;
  }

  const usadosCorretora = historicoCompras.map((op) => op.corretora).filter(Boolean);
  const usadosBancoTx = (transacoes || []).map((t) => t.banco).filter(Boolean);
  const todos = [...new Set([...LISTA_CORRETORAS, ...usadosCorretora, ...usadosBancoTx])].sort(
    (a, b) => a.localeCompare(b, 'pt-BR')
  );
  todos.forEach((nome) => {
    const opt = document.createElement('option');
    opt.value = nome;
    dl.appendChild(opt);
  });
}

function categoriaInferidaDoMercado(ticker) {
  const ativo = mockAtivosMercado.find((a) => a.ticker === (ticker || '').toUpperCase());
  if (!ativo) return null;
  return ativo.tipo === 'Renda Fixa' ? 'renda_fixa' : 'renda_variavel';
}

// Detecta a subcategoria de Renda Variável a partir do ticker.
// - .SA / 4 letras + 1-2 dígitos = ações ou FII (FIIs terminam em 11)
// - 4 letras + 34/35 = BDR
// - termina em 11 e é ETF conhecido (BOVA11, IVVB11...) -> ETF
// - prefixo cripto (BTC, ETH, SOL, ADA, etc. ou termina em -USD) -> cripto
function subcategoriaInferidaDoTicker(ticker) {
  const t = (ticker || '').toUpperCase().trim();
  if (!t) return null;
  // Cripto
  if (
    /-USD$/.test(t) ||
    /^(BTC|ETH|SOL|ADA|DOT|XRP|DOGE|BNB|MATIC|AVAX|LTC|LINK|UNI|USDT|USDC)/.test(t)
  )
    return 'cripto';
  // Mock conhecido
  const ativoMock = mockAtivosMercado.find((a) => a.ticker === t);
  if (ativoMock) {
    if (ativoMock.tipo === 'FII') return 'fiis';
    if (ativoMock.tipo === 'BDR') return 'bdrs';
    if (ativoMock.tipo === 'ETF') return 'etfs';
    if (ativoMock.tipo === 'Ação') return 'acoes';
  }
  // BDR: 4 letras + 32, 33, 34, 35
  if (/^[A-Z]{4}3[2-5]$/.test(t)) return 'bdrs';
  // FIIs e alguns ETFs terminam em 11. ETFs comuns: BOVA, IVVB, SMAL, HASH, IMAB, FIND, SPXI, DIVO
  if (/11$/.test(t)) {
    if (/^(BOVA|IVVB|SMAL|HASH|IMAB|FIND|SPXI|DIVO|XINA|GOLD|FIXA|PIBB|ECOO|ESGB)/.test(t))
      return 'etfs';
    return 'fiis';
  }
  // Ações brasileiras: 4 letras + 3 ou 4
  if (/^[A-Z]{4}[34]$/.test(t)) return 'acoes';
  return null;
}

function ajustarCamposPorCategoria() {
  const selCat = document.getElementById('compraCategoria');
  if (!selCat) return;
  const ticker = (document.getElementById('compraTicker').value || '').toUpperCase();
  const inferida =
    categoriaInferidaDoMercado(ticker) ||
    (subcategoriaInferidaDoTicker(ticker) ? 'renda_variavel' : null);
  // Se o usuário não trocou manualmente e o ticker é conhecido, sincroniza
  if (inferida && !selCat.dataset.touched) selCat.value = inferida;
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

  if (grupoRF) grupoRF.style.display = ehRF || ehReserva ? 'block' : 'none';
  // Reserva NÃO tem vencimento — esconder
  if (grupoVenc) grupoVenc.style.display = ehReserva ? 'none' : 'block';
  if (grupoSubRV) grupoSubRV.style.display = ehRV ? 'block' : 'none';
  if (grupoQtd) grupoQtd.style.display = semQtd ? 'none' : 'block';
  const grupoPrev = document.getElementById('grupoPrevidencia');
  const grupoTaxaPrev = document.getElementById('grupoTaxaMensalPrev');
  const ehRecorrente = ehPrev || ehReserva;
  if (grupoPrev) grupoPrev.style.display = ehRecorrente ? 'block' : 'none';
  // Reserva: oculta campo de rentabilidade mensal (mantém só dia + duração)
  if (grupoTaxaPrev) grupoTaxaPrev.style.display = ehPrev ? 'block' : 'none';
  // Default do dia de recorrência: pega o dia da data da operação
  if (ehRecorrente) {
    const inpDia = document.getElementById('prevDiaRecorrencia');
    const inpTaxa = document.getElementById('prevTaxaMensal');
    const inpDuracao = document.getElementById('prevDuracaoAnos');
    if (inpDia && !inpDia.value) {
      const d = document.getElementById('compraData').value;
      inpDia.value = d ? new Date(d + 'T12:00:00').getDate() : new Date().getDate();
    }
    if (ehPrev && inpTaxa && !inpTaxa.value) inpTaxa.value = '0,80';
    if (inpDuracao && !inpDuracao.value) inpDuracao.value = ehPrev ? '10' : '5';
  }

  // Renomear "Preço pago" conforme categoria
  if (lblPreco) {
    const tipoOp = document.getElementById('tipoOperacao').value;
    if (tipoOp === 'venda') lblPreco.innerText = 'Preço de Venda (R$)';
    else if (ehRF) lblPreco.innerText = 'Valor aplicado (R$)';
    else if (ehReserva) lblPreco.innerText = 'Valor guardado (R$)';
    else if (ehPrev) lblPreco.innerText = 'Valor do aporte (R$)';
    else lblPreco.innerText = 'Preço Pago (R$)';
  }

  // Ticker: ações/FIIs/etc usam datalist; RF / Reserva / Previdência são texto livre
  if (inputTicker) {
    if (semQtd) {
      inputTicker.removeAttribute('list');
      if (lblTicker)
        lblTicker.innerText = ehPrev
          ? 'Nome do plano'
          : ehReserva
            ? 'Onde está guardado (banco/aplicação)'
            : 'Nome do título';
      if (dicaTicker)
        dicaTicker.innerText = ehPrev
          ? 'Ex: Brasilprev VGBL Conservador'
          : ehReserva
            ? 'Ex: Poupança Itaú, CDB Nubank'
            : 'Ex: Tesouro IPCA+ 2035, CDB Nubank';
    } else {
      inputTicker.setAttribute(
        'list',
        document.getElementById('tipoOperacao').value === 'venda'
          ? 'listaAtivosCarteira'
          : 'listaAtivosMercado'
      );
      if (lblTicker) lblTicker.innerText = 'Buscar Ativo (Ticker ou Nome)';
      if (dicaTicker)
        dicaTicker.innerText = 'Digite o ativo e preencheremos a cotação (você pode editar).';
    }
  }

  // Auto-detectar subcategoria de RV
  if (ehRV) {
    const selSub = document.getElementById('compraSubcategoria');
    const sub = subcategoriaInferidaDoTicker(ticker);
    if (sub && selSub && !selSub.dataset.touched) selSub.value = sub;
  }
  atualizarProjecaoForm();
}

// ============================================================
// --- TECLADO E ARIA ---
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if (document.body.classList.contains('painel-lancamento-aberto')) {
      fecharPainelLancamento();
      return;
    }
    const drawer = document.getElementById('drawerOperacao');
    if (drawer && drawer.classList.contains('aberto')) {
      fecharDrawerOperacao();
      return;
    }
    const mc = document.getElementById('modalConfirmacao'),
      mconf = document.getElementById('modalConfiguracoes'),
      mgrp = document.getElementById('modalGrupoCartao');
    const mDivMes = document.getElementById('modalDividendosMes');
    if (mDivMes && mDivMes.style.display === 'flex') {
      fecharModalDividendosMes();
      return;
    }
    if (mgrp && mgrp.style.display === 'flex') {
      fecharModalGrupoCartao();
      return;
    }
    if (mc && mc.style.display === 'flex') fecharModal();
    if (mconf && mconf.style.display === 'flex') fecharModalConfig();
  }
  if (
    e.key === 'ArrowLeft' &&
    document.getElementById('controle')?.classList.contains('ativa') &&
    !e.target.matches('input,select,textarea')
  )
    mudarMesVisao(-1);
  if (
    e.key === 'ArrowRight' &&
    document.getElementById('controle')?.classList.contains('ativa') &&
    !e.target.matches('input,select,textarea')
  )
    mudarMesVisao(1);
});

document.getElementById('modalConfirmacao').addEventListener('click', function (e) {
  if (e.target === this) fecharModal();
});
document.getElementById('modalConfiguracoes').addEventListener('click', function (e) {
  if (e.target === this) fecharModalConfig();
});

// ============================================================
// --- INICIALIZAÇÃO ---
window.onload = function () {
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
  const elData = document.getElementById('compraData');
  if (elData) elData.value = new Date().toISOString().slice(0, 10);
  ajustarCamposPorCategoria();
  // Estado inicial do gráfico de evolução
  setPeriodoEvolucao(3);
  // Renderiza sonhos salvos
  renderizarSonhos();
  // Restaura preferência do usuário sobre colunas extras
  try {
    if (localStorage.getItem('appliquei_carteira_extras') === '1') {
      document.getElementById('tabelaCarteira')?.classList.add('com-extras');
      const lbl = document.getElementById('lblToggleColunas');
      if (lbl) lbl.innerText = 'Menos colunas';
    }
  } catch (_) {}
  // Applicash & Dúvidas/Sugestões
  renderizarFaq();
  inicializarFormSugestao();
};

// RN03: alterna o input de banco de origem quando origem != externo
function ajustarOrigemRecursoCampos() {
  const sel = document.getElementById('compraOrigemRecurso');
  const inp = document.getElementById('compraOrigemBanco');
  if (!sel || !inp) return;
  inp.style.display = sel.value === 'caixa_outra' ? 'block' : 'none';
  if (sel.value !== 'caixa_outra') inp.value = '';
}

// ============================================================

// Inicialização defensiva: pré-renderiza a jornada para que o card chip apareça
document.addEventListener('DOMContentLoaded', () => {
  try {
    renderizarJornada();
  } catch (_) {}
});
