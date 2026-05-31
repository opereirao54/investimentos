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
  {
    cat: 'conta',
    catLbl: 'Conta',
    p: 'Como faço para criar minha conta na Appliquei?',
    r: 'Na página inicial, clique em <strong>Criar conta</strong>. Você pode entrar com e-mail e senha ou com o Google. Contas por e-mail precisam confirmar o endereço pelo link enviado — só depois disso a sincronização na nuvem é liberada.',
  },
  {
    cat: 'conta',
    catLbl: 'Conta',
    p: 'Como funciona o período de teste (trial)?',
    r: 'Ao se cadastrar você ganha um período de teste gratuito com acesso completo. Ao final, basta assinar para continuar usando. Você acompanha quantos dias restam no próprio app e recebe avisos quando o trial estiver perto de expirar.',
  },
  {
    cat: 'conta',
    catLbl: 'Conta',
    p: 'Quanto custa e quais as formas de pagamento?',
    r: 'O plano mensal é de <strong>R$ 15,00</strong>. Aceitamos cartão de crédito, Pix e boleto. Com um cupom de indicação você ganha <strong>10% de desconto</strong> em qualquer forma de pagamento.',
  },
  {
    cat: 'conta',
    catLbl: 'Conta',
    p: 'Como cancelar minha assinatura?',
    r: 'Você pode cancelar a qualquer momento nas configurações de assinatura. O cancelamento não tem multa e seu acesso permanece ativo até o fim do período já pago.',
  },
  {
    cat: 'conta',
    catLbl: 'Conta',
    p: 'Não recebi o e-mail de verificação. E agora?',
    r: 'Confira a caixa de spam/promoções. Se ainda assim não chegar, use a opção de <strong>reenviar verificação</strong> na tela de login. Sem o e-mail confirmado, seus dados ficam salvos só neste dispositivo e não sincronizam na nuvem.',
  },

  // Patrimônio & ativos
  {
    cat: 'patrimonio',
    catLbl: 'Patrimônio',
    p: 'Como registro uma compra ou venda de ativo?',
    r: 'Na aba <strong>Visão geral do patrimônio</strong>, use <strong>Registrar operação</strong>. Informe o ativo, quantidade, preço, data e corretora. A operação entra automaticamente na sua carteira, no preço médio e no histórico.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Patrimônio',
    p: 'Quais tipos de investimento são suportados?',
    r: 'Ações, FIIs, ETFs, BDRs, criptoativos, renda fixa (Tesouro, CDB, LCI/LCA) e previdência. A renda fixa tem projeção com CDI/Selic/IPCA atualizados pelo Banco Central, e a previdência calcula o saldo com aportes recorrentes.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Patrimônio',
    p: 'De onde vêm as cotações dos ativos?',
    r: 'As cotações vêm do Yahoo Finance em tempo quase real, com cache no servidor. Quando a fonte fica indisponível usamos a última cotação salva e mostramos um aviso de <em>preços estimados</em>.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Patrimônio',
    p: 'Onde acompanho meus dividendos?',
    r: 'A aba de <strong>Dividendos</strong> consolida os proventos dos seus ativos, mostrando o histórico recebido e a projeção de renda passiva mensal com base na sua carteira atual.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Patrimônio',
    p: 'Meus dados ficam salvos? Como funciona o backup?',
    r: 'Quando você está conectado com e-mail verificado, seus dados são salvos automaticamente na nuvem e ficam disponíveis em qualquer dispositivo — sem precisar exportar nada manualmente. Sem login, ficam guardados apenas neste navegador.',
  },

  // Controle financeiro
  {
    cat: 'controle',
    catLbl: 'Controle',
    p: 'Para que serve a aba Controle financeiro?',
    r: 'É onde você lança receitas, despesas e cartões e acompanha o fluxo de caixa do mês. Ela calcula automaticamente quanto sobra para investir e ajuda a manter o orçamento sob controle.',
  },
  {
    cat: 'controle',
    catLbl: 'Controle',
    p: 'Posso cadastrar mais de um cartão de crédito?',
    r: 'Sim. Cadastre quantos cartões quiser, com dia de fechamento e vencimento de cada um. As faturas são agrupadas por cartão e por mês.',
  },
  {
    cat: 'controle',
    catLbl: 'Controle',
    p: 'Como funcionam as metas e categorias de gasto?',
    r: 'Você define um valor-meta por categoria (ex.: mercado, transporte). A barra de progresso mostra o quanto já foi gasto no mês e as cores avisam quando você se aproxima ou ultrapassa o limite.',
  },
  {
    cat: 'controle',
    catLbl: 'Controle',
    p: 'O que é o Relatório mensal?',
    r: 'É um resumo do seu mês: evolução do patrimônio, entradas e saídas, desempenho por classe de ativo e principais movimentações — tudo numa visão única para você revisar e planejar o próximo mês.',
  },

  // Ferramentas
  {
    cat: 'ferramentas',
    catLbl: 'Ferramentas',
    p: 'Como funciona a Carteira recomendada?',
    r: 'Você responde 2 perguntas rápidas (tolerância a perdas e objetivo) e informa um capital de simulação. Com isso definimos seu perfil (Conservador, Moderado ou Arrojado) e mostramos a alocação ideal entre renda fixa, ações, FIIs e cripto, com explicação de cada classe e seleção de ativos. A carteira modelo é definida e revisada pela nossa equipe de consultoria.',
  },
  {
    cat: 'ferramentas',
    catLbl: 'Ferramentas',
    p: 'A Carteira recomendada simula a rentabilidade?',
    r: 'Sim. Há um gráfico que mostra como aquela alocação teria performado em janelas de 1 a 5 anos (com dados históricos reais) e projeções de 10 a 50 anos por juros compostos sobre o retorno esperado de cada classe, sempre comparando com CDI e Ibovespa. Rentabilidade passada não garante resultados futuros.',
  },
  {
    cat: 'ferramentas',
    catLbl: 'Ferramentas',
    p: 'Como uso o "Simule sua liberdade"?',
    r: 'O simulador tem dois modos: <strong>Projetar meu futuro</strong> (você informa capital inicial, aporte mensal, taxa e prazo e vê onde chega) e <strong>Planejar minha meta</strong> (você define o objetivo e ele calcula o caminho). Ele também compara o resultado com o que você teria apenas no INSS.',
  },
  {
    cat: 'ferramentas',
    catLbl: 'Ferramentas',
    p: 'O que tem na Jornada Financeira?',
    r: 'Conteúdos curtos e práticos organizados em trilhas, do iniciante ao avançado, para você evoluir seu conhecimento e aplicar direto na plataforma.',
  },
  {
    cat: 'ferramentas',
    catLbl: 'Ferramentas',
    p: 'Para que serve a aba Meus sonhos?',
    r: 'É onde você cria objetivos financeiros (viagem, imóvel, reserva) com valor-alvo e prazo. A plataforma mostra o quanto falta, o aporte mensal necessário e o progresso de cada sonho.',
  },
  {
    cat: 'ferramentas',
    catLbl: 'Ferramentas',
    p: 'O que é a aba Info Mercado?',
    r: 'Um resumo de indicadores e informações de mercado úteis para acompanhar o cenário e contextualizar suas decisões de investimento.',
  },

  // Applicash
  {
    cat: 'applicash',
    catLbl: 'Applicash $',
    p: 'Como funciona o Applicash $?',
    r: 'É o nosso programa de indicações. Seu cupom dá <strong>10% de desconto</strong> a quem assina. A partir de uma indicação efetiva (assinante ativo) você passa a receber <strong>10% do valor pago</strong> por ele enquanto permanecer na plataforma.',
  },
  {
    cat: 'applicash',
    catLbl: 'Applicash $',
    p: 'O que é uma indicação efetiva?',
    r: 'É alguém que se cadastrou usando o seu cupom e pagou pelo menos a primeira mensalidade. Cadastros que cancelam antes da primeira cobrança não geram comissão.',
  },
  {
    cat: 'applicash',
    catLbl: 'Applicash $',
    p: 'Quanto e quando eu recebo?',
    r: 'No plano mensal de R$ 15,00 (com -10%), você recebe cerca de <strong>R$ 1,35/mês por indicação ativa</strong>. O crédito acompanha o ciclo de pagamento do indicado. Acompanhe tudo em <strong>Applicash $ → Minhas indicações</strong>.',
  },
  {
    cat: 'applicash',
    catLbl: 'Applicash $',
    p: 'Existe limite de indicações?',
    r: 'Não há limite — quanto mais pessoas usarem seu cupom, maior a sua receita. Há ainda marcos com recompensas extras conforme você acumula indicações.',
  },

  // Dados & segurança
  {
    cat: 'dados',
    catLbl: 'Dados',
    p: 'Meus dados financeiros ficam seguros?',
    r: 'Seus dados ficam no seu navegador e são sincronizados de forma segura na nuvem (Firebase), trafegando sempre por HTTPS criptografado. Cada usuário só acessa os próprios dados, e nada é compartilhado com terceiros.',
  },
  {
    cat: 'dados',
    catLbl: 'Dados',
    p: 'Uso em mais de um dispositivo — meus dados sincronizam?',
    r: 'Sim. Com o e-mail verificado e assinatura/trial ativos, seus dados sincronizam automaticamente entre celular e computador. Ao abrir o app em outro aparelho, ele busca a versão mais recente da nuvem.',
  },
  {
    cat: 'dados',
    catLbl: 'Dados',
    p: 'Como funciona o modo "Ocultar valores"?',
    r: 'Toque no ícone de olho na barra superior para mascarar valores e percentuais sensíveis na tela — útil em locais públicos. A preferência fica lembrada no seu dispositivo.',
  },
  {
    cat: 'dados',
    catLbl: 'Dados',
    p: 'Posso exportar e excluir meus dados?',
    r: 'Sim. Você pode exportar tudo em JSON pelo botão <strong>Backup</strong> a qualquer momento e solicitar a exclusão da conta, que remove seus dados da plataforma.',
  },

  // Dúvidas & Sugestões (sobre a própria aba)
  {
    cat: 'conta',
    catLbl: 'Suporte',
    p: 'Como envio uma sugestão ou reporto um bug?',
    r: 'Nesta mesma página, abra a aba <strong>Enviar sugestão</strong>, escolha a área relacionada, o tipo (melhoria, novo recurso ou bug) e descreva. Sua mensagem vai direto para a nossa equipe.',
  },
  {
    cat: 'conta',
    catLbl: 'Suporte',
    p: 'Recebo resposta das minhas sugestões?',
    r: 'Sim! Acompanhe o estado de cada sugestão (em análise, respondida ou resolvida) em <strong>Enviar sugestão → Suas sugestões enviadas</strong>. Quando a equipe responder, a resposta aparece ali mesmo, abaixo da sua mensagem.',
  },
];

function abrirFaqItem(idx) {
  const item = document.querySelector(`.faq-item[data-idx="${idx}"]`);
  if (!item) return;
  item.classList.toggle('aberto');
}

function renderizarFaq() {
  const lista = document.getElementById('faqLista');
  if (!lista) return;
  const termo = (document.getElementById('faqBuscaInput')?.value || '').toLowerCase().trim();
  const cat = document.getElementById('faqCategoriaFiltro')?.value || '';
  const filtrados = FAQ_DADOS.map((item, idx) => ({ ...item, idx })).filter((item) => {
    if (cat && item.cat !== cat) return false;
    if (!termo) return true;
    return item.p.toLowerCase().includes(termo) || item.r.toLowerCase().includes(termo);
  });

  const vazio = document.getElementById('faqVazio');
  if (filtrados.length === 0) {
    lista.innerHTML = '';
    if (vazio) vazio.style.display = 'block';
    return;
  }
  if (vazio) vazio.style.display = 'none';

  lista.innerHTML = filtrados
    .map(
      (item) => `
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
    `
    )
    .join('');
}

function filtrarFaq() {
  renderizarFaq();
}

function trocarTabDuvidas(qual) {
  const tabFaq = document.getElementById('tabFaq');
  const tabSug = document.getElementById('tabSugestao');
  const conteudoFaq = document.getElementById('dsConteudoFaq');
  const conteudoSug = document.getElementById('dsConteudoSugestao');
  if (qual === 'faq') {
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
  document.querySelectorAll('.sug-tipo-btn').forEach((b) => b.classList.remove('ativo'));
  const btn = document.querySelector(`.sug-tipo-btn[data-tipo="${tipo}"]`);
  if (btn) btn.classList.add('ativo');
}

// Cache local (chave NÃO-sincronizada) das sugestões enviadas + respostas
// do consultor, para abertura instantânea. A fonte de verdade é o Firestore
// (coleção `feedback`), de onde o painel admin recebe e responde.
var SUG_CACHE_KEY = 'appliquei_cloud_sugestoes_cache';
function carregarSugestoes() {
  try {
    return JSON.parse(localStorage.getItem(SUG_CACHE_KEY) || '[]');
  } catch {
    return [];
  }
}
function salvarSugestoes(arr) {
  try {
    localStorage.setItem(SUG_CACHE_KEY, JSON.stringify(arr || []));
  } catch (e) {}
}

function sugFirebaseUser() {
  var fb = window.AppliqueiFirebase;
  var u = fb && fb.auth && fb.auth.currentUser;
  return fb && fb.db && u ? { fb: fb, user: u } : null;
}

function enviarSugestao() {
  const aba = document.getElementById('sugAba').value;
  const outroTema = document.getElementById('sugOutroTema').value.trim();
  const tipo = document.getElementById('sugTipo').value;
  const texto = document.getElementById('sugTexto').value.trim();

  if (!aba) return mostrarToast('Selecione a aba relacionada à sua sugestão.', 'erro');
  if (aba === 'outro' && !outroTema)
    return mostrarToast('Diga sobre o que é a sua sugestão.', 'erro');
  if (texto.length < 10)
    return mostrarToast('Descreva sua sugestão com pelo menos 10 caracteres.', 'erro');
  if (texto.length > 1000)
    return mostrarToast('Sua sugestão é muito longa (máximo de 1000 caracteres).', 'erro');

  const ctx = sugFirebaseUser();
  if (!ctx) {
    return mostrarToast(
      'Você precisa estar conectado para enviar uma sugestão. Faça login e tente novamente.',
      'erro'
    );
  }
  // Firestore exige e-mail verificado para gravar feedback (firestore.rules).
  // Sem este aviso, a escrita falha e o usuário via apenas "erro de conexão".
  if (ctx.user.emailVerified === false) {
    try {
      if (typeof ctx.user.sendEmailVerification === 'function') ctx.user.sendEmailVerification();
    } catch (e) {}
    return mostrarToast(
      'Confirme seu e-mail para enviar sugestões. Reenviamos o link de verificação — confira sua caixa de entrada.',
      'erro'
    );
  }

  const btn = document.querySelector('#dsConteudoSugestao .btn-acao');
  if (btn) {
    btn.disabled = true;
  }

  ctx.fb.db
    .collection('feedback')
    .add({
      uid: ctx.user.uid,
      email: ctx.user.email || '',
      aba: aba,
      outroTema: aba === 'outro' ? outroTema : '',
      tipo: tipo,
      texto: texto,
      status: 'aberto',
      reply: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    })
    .then(function () {
      // Limpar form
      document.getElementById('sugAba').value = '';
      document.getElementById('sugOutroTema').value = '';
      document.getElementById('sugOutroWrapper').style.display = 'none';
      document.getElementById('sugTexto').value = '';
      document.getElementById('sugContador').innerText = '0';
      selecionarTipoSugestao('melhoria');
      mostrarToast('Sugestão enviada! O time vai responder por aqui 💚', 'sucesso');
      renderizarHistoricoSugestoes();
    })
    .catch(function (err) {
      console.warn('[duvidas] enviarSugestao', err);
      const code = err && err.code ? String(err.code) : '';
      if (code.indexOf('permission-denied') !== -1) {
        mostrarToast('Não foi possível enviar: confirme seu e-mail e tente novamente.', 'erro');
      } else {
        mostrarToast(
          'Não foi possível enviar agora. Verifique sua conexão e tente novamente.',
          'erro'
        );
      }
    })
    .finally(function () {
      if (btn) btn.disabled = false;
    });
}

var SUG_LABELS_ABA = {
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
  outro: 'Outro',
};
var SUG_LABELS_TIPO = { melhoria: '✨ Melhoria', novo: '🚀 Novo recurso', bug: '🐛 Bug' };
var SUG_LABELS_STATUS = {
  aberto: { lbl: '🟡 Em análise', cor: 'var(--cor-txt-amber,#b45309)' },
  respondido: { lbl: '💬 Respondida', cor: 'var(--cor-txt-info,#2563eb)' },
  resolvido: { lbl: '✅ Resolvida', cor: 'var(--cor-primaria,#059669)' },
};

function escSug(s) {
  return String(s == null ? '' : s).replace(/</g, '&lt;');
}

function renderizarHistoricoSugestoes() {
  const lista = document.getElementById('sugHistoricoLista');
  if (!lista) return;
  // Pinta o cache imediatamente; busca o estado fresco do Firestore depois.
  desenharHistoricoSugestoes(carregarSugestoes());

  const ctx = sugFirebaseUser();
  if (!ctx) return;
  ctx.fb.db
    .collection('feedback')
    .where('uid', '==', ctx.user.uid)
    .get()
    .then(function (snap) {
      const items = [];
      snap.forEach(function (d) {
        const x = d.data() || {};
        const ms =
          x.createdAt && typeof x.createdAt.toMillis === 'function' ? x.createdAt.toMillis() : 0;
        items.push({
          id: d.id,
          aba: x.aba,
          outroTema: x.outroTema,
          tipo: x.tipo,
          texto: x.texto,
          status: x.status || 'aberto',
          reply: x.reply || null,
          data: ms ? new Date(ms).toISOString() : new Date().toISOString(),
          _ms: ms,
        });
      });
      items.sort(function (a, b) {
        return b._ms - a._ms;
      });
      salvarSugestoes(items);
      desenharHistoricoSugestoes(items);
    })
    .catch(function (err) {
      console.warn('[duvidas] historico', err);
    });
}

function desenharHistoricoSugestoes(sugestoes) {
  const lista = document.getElementById('sugHistoricoLista');
  const vazio = document.getElementById('sugHistoricoVazio');
  const total = document.getElementById('sugTotalEnviadas');
  if (!lista) return;
  if (total) total.innerText = sugestoes.length;
  if (sugestoes.length === 0) {
    lista.innerHTML = '';
    if (vazio) vazio.style.display = 'block';
    return;
  }
  if (vazio) vazio.style.display = 'none';

  lista.innerHTML = sugestoes
    .map((s) => {
      const dt = new Date(s.data);
      const dataFmt =
        dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' • ' +
        dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const aba = SUG_LABELS_ABA[s.aba] || s.aba;
      const tema = s.outroTema ? ` · ${escSug(s.outroTema)}` : '';
      const st = SUG_LABELS_STATUS[s.status] || SUG_LABELS_STATUS.aberto;
      const respostaHtml = s.reply
        ? `<div class="sh-resposta" style="margin-top:8px;padding:10px 12px;background:var(--cor-bg-primaria,rgba(5,150,105,.08));border-left:3px solid var(--cor-primaria);border-radius:8px;">
                    <div style="font-size:11px;font-weight:700;color:var(--cor-primaria);margin-bottom:3px;"><i class="ph-fill ph-chat-teardrop-text"></i> Resposta da equipe</div>
                    <div style="font-size:13px;line-height:1.5;color:var(--cor-texto-principal);">${escSug(s.reply)}</div>
               </div>`
        : '';
      return `<div class="sug-historico-item">
            <div class="sh-cabecalho">
                <span class="sh-tag">${SUG_LABELS_TIPO[s.tipo] || s.tipo} · ${aba}${tema}</span>
                <span class="sh-data">${dataFmt}</span>
            </div>
            <div class="sh-texto">${escSug(s.texto)}</div>
            <div style="margin-top:6px;font-size:11px;font-weight:700;color:${st.cor};">${st.lbl}</div>
            ${respostaHtml}
        </div>`;
    })
    .join('');
}

function inicializarFormSugestao() {
  const sel = document.getElementById('sugAba');
  const wrap = document.getElementById('sugOutroWrapper');
  if (sel)
    sel.addEventListener('change', () => {
      if (wrap) wrap.style.display = sel.value === 'outro' ? '' : 'none';
    });
  const ta = document.getElementById('sugTexto');
  const cont = document.getElementById('sugContador');
  if (ta && cont)
    ta.addEventListener('input', () => {
      cont.innerText = ta.value.length;
    });
}
