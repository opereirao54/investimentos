/**
 * Appliquei — APPLICASH $ (programa de indicações).
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script, carregado
 * DEPOIS de app.js. Inclui IIFE de parse-time (capturarRefDaUrl) que
 * captura ?ref= da URL e guarda em sessionStorage para o billing/auth-gate
 * lerem nos módulos deferred. Order preservado pelo posicionamento.
 *
 * Deps: AppliqueiFirebase, AppliqueiBilling (window globals dos módulos
 * ES deferred — disponíveis no momento em que as funções daqui são
 * chamadas por user action).
 */

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

