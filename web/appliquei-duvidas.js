/**
 * Appliquei — Dúvidas & Sugestões (FAQ + form de feedback).
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script.
 * window.onload em app.js chama renderizarFaq() e inicializarFormSugestao() —
 * funções aqui ficam globais por classic-script semantics.
 */

// ============================================================
// === DÚVIDAS & SUGESTÕES                                    ===
// ============================================================
var FAQ_DADOS = [
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

