/**
 * Appliquei — Jornada Financeira (módulos com progresso).
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script.
 * window.onload em app.js chama renderizarSonhos() (em app.js); o
 * DOMContentLoaded handler residual em app.js também chama
 * renderizarJornada() (aqui). Order via load chain.
 */

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

