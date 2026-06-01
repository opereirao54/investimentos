/**
 * Appliquei — MEUS SONHOS (Dream Planner Engine).
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script, carregado
 * DEPOIS de app.js. Inclui integração com Controle Financeiro (gera
 * lançamentos automáticos a partir dos sonhos) e histórico de aportes.
 *
 * Deps: transacoes, carteira (state global), formatarMoeda, mostrarToast,
 * parseBRL. window.onload em app.js chama renderizarSonhos().
 */

// === MEUS SONHOS — DREAM PLANNER ENGINE                    ===
// ============================================================
var sonhos = JSON.parse(localStorage.getItem('appliquei_sonhos')) || [];
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
var sonhoEditandoId = null;

var SONHO_TAXA_MENSAL = 0.008; // 0.8% ao mês
var SONHO_CATEGORIAS = {
    viagem:'✈️', veiculo:'🚗', imovel:'🏠', educacao:'📚',
    casamento:'💍', reserva:'🛡️', tech:'💻', saude:'❤️', outro:'🌟'
};
var SONHO_FRASES = [
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
                        <span class="valor-mascarado" style="font-family:'DM Mono',monospace;font-weight:600;" title="Meta total do sonho">🎯 ${s.valorTotal.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</span>
                        ${conquistado ? '' : `<span class="valor-mascarado" style="font-family:'DM Mono',monospace;font-weight:600;color:var(--cor-primaria);" title="Aporte mensal sugerido para bater a meta">💰 ${mensalFmtCol}/mês</span>`}
                        ${conquistado ? '' : `<span class="valor-mascarado" style="font-family:'DM Mono',monospace;font-weight:500;color:var(--cor-texto-mutado);" title="Quanto falta para atingir a meta">Falta ${faltaFmtCol}</span>`}
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
                    <span><strong>Dica:</strong> Abra uma caixinha no seu banco chamada "${s.nome}" e deposite <strong class="valor-mascarado">${mensal.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</strong> todo mês. A rentabilidade estimada é de 0,8% a.m. (a maioria dos bancos rende +1% a.m.).</span>
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
                            <span><strong class="valor-mascarado">${formatarMoeda(mensal)}</strong>/mês</span>
                            <span>Falta <strong class="valor-mascarado">${formatarMoeda(falta)}</strong></span>
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
var _sonhoEdicaoPendente = null;

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

    const valorAntigo = aporte.valor;
    const delta = novoValor - valorAntigo;
    aporte.valor = novoValor;
    if(novaData) aporte.data = novaData;
    s.valorAtual = Math.max(0, s.valorAtual + delta);

    // Migração: ajusta a venda na carteira proporcionalmente ao novo valor,
    // mantendo o abate do investimento coerente com o valor do aporte.
    if(aporte.vendaOpId && valorAntigo > 0 && typeof historicoCompras !== 'undefined') {
        const vop = historicoCompras.find(o => o.id === aporte.vendaOpId);
        if(vop) {
            vop.quantidade = (vop.quantidade || 0) * (novoValor / valorAntigo);
            localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));
            if(typeof atualizarCarteiraAtivos === 'function') atualizarCarteiraAtivos();
        }
    }

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

    // Reverte a venda gerada pela migração: devolve as cotas ao investimento.
    if(aporte.vendaOpId && typeof historicoCompras !== 'undefined') {
        const antes = historicoCompras.length;
        historicoCompras = historicoCompras.filter(o => o.id !== aporte.vendaOpId);
        if(historicoCompras.length !== antes) {
            localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));
            if(typeof atualizarCarteiraAtivos === 'function') atualizarCarteiraAtivos();
        }
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

            // Resgate REAL: abate a quantidade correspondente do investimento de
            // origem registrando uma operação de venda na carteira. Sem isto, o
            // dinheiro era "duplicado" — entrava no sonho mas o saldo do ativo
            // permanecia intacto. Operação atômica: persistimos a venda na
            // carteira (futurorico_compras) junto das transações e do sonho,
            // tudo na mesma chamada (cada chave é sincronizada como um todo).
            if(origemAtivo && typeof historicoCompras !== 'undefined' && typeof obterResumoCarteira === 'function') {
                const carteira = obterResumoCarteira();
                const ativo = carteira[origemAtivo];
                if(ativo && ativo.qtdTotal > 0) {
                    const am = (typeof mockAtivosMercado !== 'undefined') ? mockAtivosMercado.find(x => x.ticker === origemAtivo) : null;
                    const precoUnit = (am && am.preco_atual > 0) ? am.preco_atual : (ativo.precoMedio || 0);
                    // Cotas equivalentes ao valor resgatado, limitadas ao saldo.
                    let qtdVenda = precoUnit > 0 ? (valor / precoUnit) : ativo.qtdTotal;
                    if(qtdVenda > ativo.qtdTotal) qtdVenda = ativo.qtdTotal;
                    const vendaOp = {
                        id: Date.now() + Math.floor(Math.random() * 1000),
                        ticker: origemAtivo,
                        quantidade: qtdVenda,
                        preco_op: precoUnit > 0 ? precoUnit : (qtdVenda > 0 ? (valor / qtdVenda) : 0),
                        tipo: 'venda',
                        data_op: d.toISOString(),
                        categoria: ativo.categoria || null,
                        subcategoria: ativo.subcategoria || null,
                        corretora: ativo.corretora || null,
                        origemSonho: s.id
                    };
                    historicoCompras.push(vendaOp);
                    localStorage.setItem('futurorico_compras', JSON.stringify(historicoCompras));
                    s.aportes[s.aportes.length - 1].vendaOpId = vendaOp.id;
                    if(typeof atualizarCarteiraAtivos === 'function') atualizarCarteiraAtivos();
                }
            }
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

