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
// O FAQ acompanha o app — e o app mudou. As respostas abaixo foram revistas
// contra as telas de hoje: "Meu patrimônio" (contas, bens, instituições) não
// existia quando o texto foi escrito, "Visão geral do patrimônio" virou "Meus
// investimentos" com sub-abas, o cadastro retroativo e o aporte externo
// entraram, a Jornada virou sequencial com material de estudo. Ao mexer numa
// tela, revise a resposta correspondente aqui: um FAQ desatualizado gera mais
// suporte do que FAQ nenhum.
//
// `cat` tem de existir no <select id="faqCategoriaFiltro"> do HTML, senão o
// item some do filtro. Categorias: conta, patrimonio, controle, ferramentas,
// applicash, dados.
var FAQ_DADOS = [
  // === Conta & assinatura ===================================================
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
    r: 'Ao criar a conta você ganha <strong>7 dias gratuitos</strong> com acesso completo, sem cadastrar cartão. Um aviso no topo mostra quantos dias faltam. Terminado o prazo, é só assinar para continuar — seus dados continuam guardados.',
  },
  {
    cat: 'conta',
    catLbl: 'Conta',
    p: 'Quanto custa e quais as formas de pagamento?',
    r: 'O plano mensal é de <strong>R$ 15,00</strong>. Você escolhe entre <strong>cartão de crédito</strong> (renovação automática) ou <strong>Pix / boleto</strong>. Com um cupom de indicação, o preço cai <strong>10%</strong> em qualquer forma de pagamento.',
  },
  {
    cat: 'conta',
    catLbl: 'Conta',
    p: 'Como cancelar minha assinatura?',
    r: 'A qualquer momento, na tela de assinatura. Não há multa e o acesso continua até o fim do período que você já pagou — não perdemos nem apagamos nada nesse meio-tempo.',
  },
  {
    cat: 'conta',
    catLbl: 'Conta',
    p: 'Onde vejo minhas cobranças e trocas de cartão?',
    r: 'Na tela de assinatura, em <strong>Meus pagamentos</strong>: cada cobrança aparece com data, valor, forma de pagamento e situação. Boletos em aberto trazem o link para pagar, e quem usa cartão pode trocá-lo por ali.',
  },
  {
    cat: 'conta',
    catLbl: 'Conta',
    p: 'Não recebi o e-mail de verificação. E agora?',
    r: 'Confira a caixa de spam/promoções — o remetente é <code>noreply@appliquei-prod.firebaseapp.com</code>. Se não chegar, use <strong>reenviar verificação</strong> na tela de login. Sem o e-mail confirmado, seus dados ficam só neste navegador e a nuvem não é liberada.',
  },

  // === Meu patrimônio (contas, bens, consolidado) ===========================
  {
    cat: 'patrimonio',
    catLbl: 'Meu patrimônio',
    p: 'Qual a diferença entre "Meu patrimônio" e "Meus investimentos"?',
    r: '<strong>Meu patrimônio</strong> é a foto completa: saldo em conta + investimentos + imóveis e veículos, e o mapa de <em>onde está o seu dinheiro</em> em cada banco e corretora. <strong>Meus investimentos</strong> é a carteira em si — cada ativo, preço médio, rentabilidade, operações e dividendos.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Meu patrimônio',
    p: 'Acabei de entrar (ou apaguei tudo). Por onde começo?',
    r: 'Pelo <strong>guia de primeiros passos</strong>, que aparece sozinho com o app vazio e pode ser pulado a qualquer momento — ele fica guardado em <strong>&#9881; Configurações</strong> para voltar quando você quiser. A ordem sugerida é: <strong>1)</strong> cadastrar suas contas com o saldo de hoje, <strong>2)</strong> lançar sua receita e <strong>3)</strong> lançar uma despesa. Registrar os investimentos que você já tem é opcional e vem depois.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Meu patrimônio',
    p: 'Preciso cadastrar uma conta antes de lançar uma despesa ou uma receita?',
    r: '<strong>Não.</strong> No lançamento, o campo do banco é livre: digite <em>Nubank</em>, <em>Itaú</em> ou o nome que usar, e a Appliquei <strong>cria a conta na hora</strong>. O cadastro em <strong>Meu patrimônio → Minhas Contas</strong> serve para outra coisa — informar o <strong>saldo que você já tinha</strong> naquela conta. Sem esse saldo de partida, a primeira despesa paga deixa o caixa daquela instituição negativo, porque o app só conhece a saída e não a reserva que existia antes.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Meu patrimônio',
    p: 'Preciso cadastrar minhas contas e bancos?',
    r: 'Não é obrigatório para lançar — mas é muito recomendado. Em <strong>Meu patrimônio → Minhas Contas</strong> você cadastra cada banco e corretora com o saldo que tem hoje, e é esse ponto de partida que faz o dinheiro andar certo pelo app: cada gasto, aporte ou recebimento sai (ou entra) numa conta de verdade, com saldo real, e não num saldo genérico.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Meu patrimônio',
    p: 'O que é o "saldo inicial" de uma conta?',
    r: 'É quanto você tinha naquela conta no dia em que começou a usar a Appliquei. Ele é o ponto de partida do saldo — não lance ali a sua receita do mês (salário e afins vão em <strong>Controle financeiro → Receita</strong>), senão o dinheiro entra duas vezes.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Meu patrimônio',
    p: 'Posso cadastrar imóveis, veículos e financiamentos?',
    r: 'Pode. Em <strong>Meus Bens</strong> você cadastra imóveis, veículos e outros bens. Veículo pode buscar o valor direto na <strong>tabela FIPE</strong>. Se o bem for financiado, informe saldo devedor, parcela e sistema (Price ou SAC): o app calcula os juros que faltam, confere se a parcela bate com a taxa informada e mostra o patrimônio já líquido da dívida.',
  },

  // === Meus investimentos ===================================================
  {
    cat: 'patrimonio',
    catLbl: 'Investimentos',
    p: 'Como registro uma compra, um aporte ou um resgate?',
    r: 'Em <strong>Meus investimentos</strong>, use <strong>Registrar operação</strong> (ou o botão <strong>+</strong> flutuante). Informe o ativo, o valor (ou quantidade e preço), a data, a corretora e <em>de onde vem o dinheiro</em>. A operação entra na carteira, no preço médio e no histórico, e o Controle financeiro registra a saída de caixa correspondente.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Investimentos',
    p: 'Já tinha investimentos antes de usar a Appliquei. Como cadastro?',
    r: 'No campo <em>de onde vem o dinheiro</em>, escolha <strong>Investimento já existente — cadastro retroativo</strong>. Informe quanto você tem <strong>hoje</strong> naquela posição e a data em que começou: ele entra no seu patrimônio e <strong>não desconta de nenhuma conta</strong>, porque esse dinheiro saiu do seu bolso há muito tempo. A rentabilidade passa a correr a partir do cadastro, para não inventar rendimento retroativo.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Investimentos',
    p: 'O que é o "Aporte externo — dinheiro de fora do app"?',
    r: 'É o aporte que você faz <strong>hoje</strong> com dinheiro que nunca passou por uma conta cadastrada aqui (um extra, um dinheiro que estava fora). Ele soma no seu patrimônio e no capital aplicado como qualquer outro aporte, mas <strong>não é descontado do caixa</strong> — nem no ato, nem nas parcelas da recorrência que ele agenda. No Controle financeiro ele aparece em linha própria, <em>Aporte externo (fora do caixa)</em>, sem sinal de menos.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Investimentos',
    p: 'Quais tipos de investimento são suportados?',
    r: '<strong>Renda variável</strong> (ações, FIIs, BDRs, ETFs e criptomoedas), <strong>renda fixa</strong> (Tesouro, CDB, LCI/LCA), <strong>previdência</strong> e <strong>reserva de emergência</strong>. Renda fixa e reserva projetam o valor com CDI, Selic e IPCA atualizados pelo Banco Central; previdência aceita taxa fixa mensal/anual ou um indexador.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Investimentos',
    p: 'Como funciona o aporte mensal recorrente?',
    r: 'Ao cadastrar previdência ou reserva de emergência, marque <strong>aporte recorrente</strong>, escolha o dia do mês e por quantos anos. O app cria os lançamentos mensais no Controle financeiro — assim o compromisso aparece no seu orçamento antes de virar surpresa. Ao marcar cada parcela como paga, ela vira posição na carteira.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Investimentos',
    p: 'E quando eu resgato? O imposto entra na conta?',
    r: 'Sim. No resgate de renda fixa, reserva e previdência o IR é retido na fonte: o app credita o <strong>valor líquido</strong> na conta de destino que você escolher e mostra quanto foi de imposto. Em renda variável o crédito é o valor bruto — o imposto ali é apurado por você via DARF.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Investimentos',
    p: 'De onde vêm as cotações dos ativos?',
    r: 'De fontes públicas de mercado (Yahoo Finance e BRAPI), com cache no nosso servidor. Quando a fonte fica indisponível usamos a última cotação salva e avisamos na tela que os preços estão <em>estimados</em>.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Investimentos',
    p: 'Onde acompanho meus dividendos?',
    r: 'Na sub-aba <strong>Dividendos</strong>, dentro de Meus investimentos: total recebido, últimos 12 meses, média mensal e o <em>yield on cost</em> — quanto os proventos rendem sobre o que você de fato pagou pelos ativos.',
  },
  {
    cat: 'patrimonio',
    catLbl: 'Investimentos',
    p: 'Cadastrei uma operação errada. Dá para editar ou apagar?',
    r: 'Dá. Na sub-aba <strong>Operações</strong>, cada lançamento tem editar e excluir. O app desfaz junto tudo o que aquela operação gerou — o débito na conta, o lançamento no Controle e as parcelas recorrentes — para não sobrar meia operação no meio do caminho.',
  },

  // === Controle financeiro ==================================================
  {
    cat: 'controle',
    catLbl: 'Controle',
    p: 'Para que serve a aba Controle financeiro?',
    r: 'É o fluxo de caixa do mês: receitas, despesas fixas e variáveis, cartões, aportes e sonhos. Ela responde "quanto entrou, quanto saiu e quanto sobrou" — e é dela que sai o quanto você tem disponível para investir.',
  },
  {
    cat: 'controle',
    catLbl: 'Controle',
    p: 'Por que preciso dizer de qual conta saiu o gasto?',
    r: 'Porque é o que mantém os números honestos. Todo lançamento pago sai de uma instituição de verdade, então o saldo de cada banco no <strong>Meu patrimônio</strong> reflete o que você lançou aqui. Sem isso o dinheiro sumiria do total sem sair de lugar nenhum.',
  },
  {
    cat: 'controle',
    catLbl: 'Controle',
    p: 'Posso cadastrar mais de um cartão de crédito?',
    r: 'Sim, quantos quiser, cada um com dia de fechamento, vencimento e limite. As compras vão para a fatura do mês certo (inclusive parceladas), e o app avisa quando a fatura passa do limite dos cartões ativos.',
  },
  {
    cat: 'controle',
    catLbl: 'Controle',
    p: 'O que é a tabela "Demonstrativo contábil" (DRE)?',
    r: 'É o histórico mês a mês: receitas, resgates, investimentos, sonhos e despesas, com o <strong>Resultado do mês</strong> já somando o saldo que veio do mês anterior. A última linha, <em>Investimento acumulado</em>, é estoque e não fluxo: quanto de capital você já aplicou (aportes menos resgates) até o fim de cada mês.',
  },
  {
    cat: 'controle',
    catLbl: 'Controle',
    p: 'Como funcionam as metas e categorias de gasto?',
    r: 'Você define um valor-meta por categoria (mercado, transporte, lazer…). A barra mostra quanto já foi gasto no mês e a cor avisa quando você se aproxima ou passa do limite. O extrato também filtra por categoria, da maior despesa para a menor.',
  },
  {
    cat: 'controle',
    catLbl: 'Controle',
    p: 'O que é o Relatório mensal?',
    r: 'O fechamento do mês numa página: entradas e saídas, para onde o dinheiro foi, evolução do patrimônio, desempenho por classe de ativo, dividendos recebidos e as maiores movimentações. Serve para revisar o mês que passou e planejar o próximo.',
  },

  // === Ferramentas ==========================================================
  {
    cat: 'ferramentas',
    catLbl: 'Ferramentas',
    p: 'Como funciona a Carteira sugerida?',
    r: 'Você responde 2 perguntas rápidas (tolerância a perdas e objetivo) e informa quanto pretende aportar. Com isso a ferramenta define um perfil (Conservador, Moderado ou Arrojado) e sugere uma divisão entre renda fixa, ações, FIIs e cripto, explicando cada classe e mostrando o critério que pontuou cada ativo. É material informativo e educacional de apoio à sua decisão: o Appliquei não é consultoria nem análise de valores mobiliários e não faz recomendação individualizada de investimento. A decisão é sempre sua.',
  },
  {
    cat: 'ferramentas',
    catLbl: 'Ferramentas',
    p: 'De onde vêm os dados que pontuam cada ativo da carteira?',
    r: 'De fontes públicas de mercado e de dados de fundamentos, atualizados pelo nosso servidor. Cada ativo sugerido mostra a <strong>procedência</strong> dos números e a data da coleta; quando falta dado para pontuar com segurança, o app diz <em>dados insuficientes</em> em vez de chutar.',
  },
  {
    cat: 'ferramentas',
    catLbl: 'Ferramentas',
    p: 'A Carteira sugerida simula a rentabilidade?',
    r: 'Sim. Há um gráfico que mostra como aquela alocação teria performado em janelas de 1 a 5 anos (com dados históricos reais) e projeções de 10 a 50 anos por juros compostos sobre uma premissa de retorno de cada classe, sempre comparando com CDI e Ibovespa. São cenários ilustrativos, não previsão: rentabilidade passada não garante rentabilidade futura e nenhum resultado é garantido.',
  },
  {
    cat: 'ferramentas',
    catLbl: 'Ferramentas',
    p: 'Como uso o "Simule sua liberdade"?',
    r: 'O simulador tem dois modos: <strong>Projetar meu futuro</strong> (você informa capital inicial, aporte mensal, taxa e prazo e vê onde chega) e <strong>Planejar minha meta</strong> (você define o objetivo e ele calcula o caminho). Ele também compara o resultado com o que você teria contando apenas com o INSS.',
  },
  {
    cat: 'ferramentas',
    catLbl: 'Ferramentas',
    p: 'O que tem na Jornada Financeira?',
    r: 'Oito módulos, do mindset à aposentadoria, cada um com material de estudo, exemplos numéricos e o que fazer dentro do app. A trilha é <strong>sequencial</strong>: o módulo seguinte abre quando você conclui o anterior — a ordem é parte do método, não enfeite.',
  },
  {
    cat: 'ferramentas',
    catLbl: 'Ferramentas',
    p: 'Para que serve a aba Meus sonhos?',
    r: 'Para transformar objetivo em plano: você cria o sonho (viagem, imóvel, reserva) com valor-alvo e prazo, e o app calcula o aporte mensal necessário, lança as parcelas no Controle financeiro e acompanha o progresso. Um <strong>aporte extra</strong> a qualquer momento encurta o caminho e recalcula as parcelas que faltam.',
  },
  {
    cat: 'ferramentas',
    catLbl: 'Ferramentas',
    p: 'O que é a aba Info Mercado?',
    r: 'Um resumo do noticiário e dos indicadores do dia, filtrável por tema (economia, política, mercado, bancos, investimentos, empresas, cripto, Brasil), para contextualizar o cenário sem sair do app.',
  },

  // === Applicash $ ==========================================================
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

  // === Dados & segurança ====================================================
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
    r: 'Sim. Com o e-mail verificado e assinatura ou trial ativos, seus dados sincronizam automaticamente entre celular e computador. Ao abrir o app em outro aparelho, ele busca a versão mais recente da nuvem.',
  },
  {
    cat: 'dados',
    catLbl: 'Dados',
    p: 'Como funciona o backup? Posso exportar e excluir meus dados?',
    r: 'Você exporta tudo em JSON pelo botão <strong>Backup</strong> a qualquer momento e pode importar esse arquivo de volta. Também é possível <strong>recomeçar do zero</strong>, que apaga seus lançamentos e mantém a conta. Para excluir a conta e os dados de vez, peça pela aba <strong>Enviar sugestão</strong> — a equipe cuida disso.',
  },
  {
    cat: 'dados',
    catLbl: 'Dados',
    p: 'Como funciona o modo "Ocultar valores"?',
    r: 'Toque no ícone de olho na barra superior para mascarar valores e percentuais sensíveis na tela — útil em locais públicos. A preferência fica lembrada no seu dispositivo e é aplicada antes de a tela pintar, então os números não aparecem nem por um instante.',
  },
  {
    cat: 'dados',
    catLbl: 'Dados',
    p: 'Tem modo escuro?',
    r: 'Tem. O botão de sol/lua na barra superior alterna o tema, e a escolha fica gravada — ao reabrir o app ele já vem como você deixou.',
  },

  // === Dúvidas & Sugestões (sobre a própria aba) ============================
  {
    cat: 'conta',
    catLbl: 'Suporte',
    p: 'Como envio uma sugestão ou reporto um bug?',
    r: 'Nesta mesma página, abra <strong>Enviar sugestão</strong>, escolha a área relacionada, o tipo (melhoria, novo recurso ou bug) e descreva com pelo menos 10 caracteres. Se for um problema de tela, <strong>anexe uma imagem</strong>: o print explica em um segundo o que um parágrafo demora a descrever. A imagem é reduzida no seu aparelho antes de subir, e os dados de localização da foto não vão junto. É preciso estar conectado com o e-mail confirmado — a mensagem vai direto para a nossa equipe.',
  },
  {
    cat: 'conta',
    catLbl: 'Suporte',
    p: 'Recebo resposta das minhas sugestões?',
    r: 'Sim! Acompanhe o estado de cada sugestão (em análise, respondida ou resolvida) em <strong>Enviar sugestão → Suas sugestões enviadas</strong>. Quando a equipe responder, a resposta aparece ali mesmo, abaixo da sua mensagem.',
  },
  {
    cat: 'conta',
    catLbl: 'Suporte',
    p: 'Cliquei em enviar e não aconteceu nada. O que faço?',
    r: 'Logo abaixo do botão aparece sempre uma linha dizendo o que houve — campo faltando, e-mail ainda não confirmado ou falha de conexão. Se ela indicar problema de e-mail, confirme o endereço pelo link que enviamos; se falar de conexão, verifique a rede e tente de novo. A sugestão só é registrada quando a mensagem de sucesso aparece.',
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

// Três abas, não duas: o if/else binário virava um encadeado a cada aba nova
// e a terceira ficaria sem o estilo de "inativa" que só o ramo `else` aplicava.
// A tabela abaixo é a lista completa — acrescentar uma aba é acrescentar
// uma linha.
var DS_TABS = [
  { chave: 'faq', botao: 'tabFaq', conteudo: 'dsConteudoFaq' },
  { chave: 'sugestao', botao: 'tabSugestao', conteudo: 'dsConteudoSugestao' },
  { chave: 'regulamento', botao: 'tabRegulamento', conteudo: 'dsConteudoRegulamento' },
];

function trocarTabDuvidas(qual) {
  DS_TABS.forEach(function (tab) {
    const botao = document.getElementById(tab.botao);
    const conteudo = document.getElementById(tab.conteudo);
    const ativa = tab.chave === qual;
    if (botao) {
      botao.classList.toggle('ativo', ativa);
      botao.style.background = ativa ? 'var(--cor-branco)' : 'transparent';
      botao.style.color = ativa ? 'var(--cor-texto-principal)' : 'var(--cor-texto-mutado)';
      botao.style.boxShadow = ativa ? 'var(--shadow-suave)' : '';
    }
    if (conteudo) conteudo.style.display = ativa ? '' : 'none';
  });
  if (qual === 'sugestao') renderizarHistoricoSugestoes();
  else if (typeof sugStatus === 'function') sugStatus('');
}

var SUG_TIPOS = ['melhoria', 'novo', 'bug'];

// O estado do seletor de tipo é a classe `ativo` — e só ela. O visual dos
// botões mora no CSS (.sug-tipo-btn / .sug-tipo-btn.ativo). Enquanto o
// "Melhoria" carregava o estilo selecionado no atributo style, tirar a classe
// não desfazia nada: ele ficava aceso para sempre e escolher outro tipo
// mostrava dois selecionados ao mesmo tempo.
function selecionarTipoSugestao(tipo) {
  const escolhido = SUG_TIPOS.indexOf(tipo) === -1 ? 'melhoria' : tipo;
  const hidden = document.getElementById('sugTipo');
  if (hidden) hidden.value = escolhido;
  document.querySelectorAll('.sug-tipo-btn').forEach((b) => {
    const ativo = b.dataset.tipo === escolhido;
    b.classList.toggle('ativo', ativo);
    b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  });
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

// Só a sessão importa: o envio e a leitura vão por /api/feedback, então o
// Firestore do cliente não faz parte do caminho. Exigir `fb.db` aqui faria o
// app dizer "você não está conectado" só porque o compat do Firestore não
// carregou — um erro sobre a coisa errada.
function sugFirebaseUser() {
  var fb = window.AppliqueiFirebase;
  var u = fb && fb.auth && fb.auth.currentUser;
  return u ? { fb: fb, user: u } : null;
}

// Feedback que NÃO depende do toast: ele nasce no topo da página e some em
// 3,5s, e o botão "Enviar" fica no fim de um formulário longo. No celular, quem
// olha para o botão simplesmente não vê o aviso — o envio parecia não fazer
// nada. Esta linha fica na tela, ao lado do botão, até a próxima ação.
function sugStatus(msg, tipo) {
  const el = document.getElementById('sugStatus');
  if (!el) return;
  if (!msg) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const cores = {
    erro: ['var(--cor-bg-erro,#fef2f2)', 'var(--cor-txt-erro,#b91c1c)'],
    sucesso: ['var(--cor-bg-primaria,#ecfdf5)', 'var(--cor-txt-primaria,#065f46)'],
    info: ['var(--cor-bg-info,#eff6ff)', 'var(--cor-txt-info,#1d4ed8)'],
  };
  const par = cores[tipo] || cores.info;
  el.style.background = par[0];
  el.style.color = par[1];
  el.innerHTML = msg;
  el.style.display = 'block';
}

// Toast + linha fixa juntos: o toast dá o retorno imediato, a linha permanece.
function sugAvisar(msg, tipo) {
  if (typeof mostrarToast === 'function') mostrarToast(msg, tipo);
  sugStatus(msg, tipo);
}

// ─── ANEXO DE IMAGEM ────────────────────────────────────────────────────────
//
// O relato que motivou o campo é sempre o mesmo: descrever um defeito de tela
// em palavras é difícil, e um print resolve. O que sobe NÃO é o arquivo que a
// pessoa escolheu — é uma imagem redesenhada aqui num canvas. Isso resolve
// três problemas de uma vez:
//
//   · tamanho — foto de celular tem 4 a 12 MB; reduzida para 1600px de lado
//     maior, um print vira algo entre 60 e 300 KB, e o corpo do POST cabe
//     folgado no limite da função serverless;
//   · privacidade — a re-codificação não carrega o EXIF do original, então a
//     coordenada de GPS que a câmera gravou na foto não viaja junto;
//   · previsibilidade — o servidor sabe de antemão a ordem de grandeza do que
//     vai gravar, em vez de depender do que o cliente resolveu mandar.
//
// O teto do servidor (700 mil caracteres de base64) é quase o dobro do alvo
// daqui: se a compressão errar por pouco, quem recusa é este arquivo, com uma
// mensagem em português, e não um 400 vindo da API.
var SUG_ANEXO_ALVO_B64 = 480000;
var SUG_ANEXO_MAX_ARQUIVO = 25 * 1024 * 1024;
// Pares (lado maior, qualidade) tentados em ordem. O primeiro que couber no
// alvo vence. Um print de 1600px a 0,82 já costuma ficar em ~200 KB; os
// degraus seguintes existem para a foto de câmera de 12 megapixels.
var SUG_ANEXO_DEGRAUS = [
  [1600, 0.82],
  [1600, 0.7],
  [1280, 0.68],
  [1024, 0.6],
  [800, 0.5],
];
// A imagem escolhida, já comprimida: { mime, dados, largura, altura, bytes, nome }.
var sugAnexoAtual = null;

function sugAnexoAbrirSeletor() {
  const inp = document.getElementById('sugAnexoInput');
  if (inp) inp.click();
}

function sugFormatarBytes(n) {
  if (!(n > 0)) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
}

// Desenha `img` num canvas de `lado` no maior eixo e devolve o data URL.
function sugAnexoDesenhar(img, lado, mime, qualidade) {
  const escala = Math.min(1, lado / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.width * escala));
  cv.height = Math.max(1, Math.round(img.height * escala));
  const ctx = cv.getContext('2d');
  // PNG e WebP com transparência ficariam PRETOS ao virar JPEG, que não tem
  // canal alfa. Branco é o fundo que a pessoa estava vendo quando tirou o print.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return { url: cv.toDataURL(mime, qualidade), largura: cv.width, altura: cv.height };
}

function sugAnexoComprimir(file) {
  return new Promise(function (resolve, reject) {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(objectUrl);
      try {
        // WebP guarda texto de print muito melhor que JPEG no mesmo tamanho.
        // Navegador que não conhece o formato NÃO avisa: devolve um PNG e
        // segue em frente. Por isso o teste é o prefixo do que voltou, e não
        // uma lista de navegadores.
        let mime = 'image/webp';
        if (sugAnexoDesenhar(img, 8, mime, 0.8).url.indexOf('data:image/webp') !== 0) {
          mime = 'image/jpeg';
        }
        for (let i = 0; i < SUG_ANEXO_DEGRAUS.length; i++) {
          const r = sugAnexoDesenhar(img, SUG_ANEXO_DEGRAUS[i][0], mime, SUG_ANEXO_DEGRAUS[i][1]);
          const dados = r.url.slice(r.url.indexOf(',') + 1);
          if (dados.length <= SUG_ANEXO_ALVO_B64 || i === SUG_ANEXO_DEGRAUS.length - 1) {
            if (dados.length > SUG_ANEXO_ALVO_B64) return reject(new Error('anexo/grande'));
            return resolve({
              mime: mime,
              dados: dados,
              largura: r.largura,
              altura: r.altura,
              // 4 caracteres de base64 = 3 bytes. É o tamanho que o servidor
              // vai medir de verdade; aqui serve só para mostrar na tela.
              bytes: Math.round((dados.length * 3) / 4),
              nome: file.name || 'imagem',
            });
          }
        }
        reject(new Error('anexo/grande'));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('anexo/invalida'));
    };
    img.src = objectUrl;
  });
}

function sugAnexoTrocou(input) {
  const file = input && input.files && input.files[0];
  // Limpa o valor logo: sem isso, escolher o MESMO arquivo depois de remover
  // não dispara `change` de novo e o botão parece morto.
  if (input) input.value = '';
  if (!file) return;
  if (!/^image\//.test(file.type || '')) {
    return sugAvisar('O anexo precisa ser uma imagem (print, foto da tela, PNG ou JPG).', 'erro');
  }
  if (file.size > SUG_ANEXO_MAX_ARQUIVO) {
    return sugAvisar(
      'Essa imagem tem ' +
        sugFormatarBytes(file.size) +
        ' — grande demais até para reduzir aqui. Tente um print em vez da foto original.',
      'erro'
    );
  }
  sugStatus('Preparando a imagem…', 'info');
  sugAnexoComprimir(file)
    .then(function (anexo) {
      sugAnexoAtual = anexo;
      sugAnexoPintar();
      sugStatus('');
    })
    .catch(function (err) {
      console.warn('[duvidas] anexo', err && err.message, err);
      sugAnexoAtual = null;
      sugAnexoPintar();
      sugAvisar(
        'Não conseguimos preparar essa imagem. Tente outra — um print da tela costuma funcionar.',
        'erro'
      );
    });
}

function sugAnexoRemover() {
  sugAnexoAtual = null;
  sugAnexoPintar();
  sugStatus('');
  const btn = document.getElementById('sugAnexoBtn');
  if (btn) btn.focus();
}

function sugAnexoPintar() {
  const box = document.getElementById('sugAnexoPreview');
  const btn = document.getElementById('sugAnexoBtn');
  const txt = document.getElementById('sugAnexoBtnTexto');
  if (!box) return;
  if (!sugAnexoAtual) {
    box.style.display = 'none';
    box.innerHTML = '';
    if (btn) btn.style.display = '';
    if (txt) txt.innerText = 'Anexar uma imagem';
    return;
  }
  // Com uma imagem escolhida o botão some: quem quiser trocar remove esta e
  // escolhe outra. Um "anexar" ainda visível sugeriria que dá para mandar
  // duas, e só uma sobe.
  if (btn) btn.style.display = 'none';
  const a = sugAnexoAtual;
  box.style.display = 'block';
  box.innerHTML =
    '<div class="sug-anexo-cartao">' +
    '<img alt="Pré-visualização da imagem anexada" src="data:' +
    a.mime +
    ';base64,' +
    a.dados +
    '">' +
    '<div class="sac-info">' +
    '<div class="sac-nome">' +
    escSug(a.nome) +
    '</div>' +
    '<div class="sac-meta">' +
    a.largura +
    '×' +
    a.altura +
    ' · ' +
    sugFormatarBytes(a.bytes) +
    '</div>' +
    '</div>' +
    '<button type="button" class="sac-remover" title="Remover imagem" aria-label="Remover imagem" onclick="sugAnexoRemover()">&times;</button>' +
    '</div>';
}

function sugFocar(id) {
  const el = document.getElementById(id);
  if (!el) return;
  try {
    el.focus({ preventScroll: false });
    if (typeof el.scrollIntoView === 'function')
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch (_) {
    try {
      el.focus();
    } catch (_e) {}
  }
}

// Sem teto de tempo, uma conexão ruim deixa o botão desabilitado e a tela muda
// para sempre — o sintoma exato de "cliquei e não aconteceu nada". 25s e
// devolvemos o controle com uma explicação.
var SUG_TIMEOUT_MS = 25000;
function sugComTeto(promessa) {
  return new Promise(function (resolve, reject) {
    let terminou = false;
    const t = setTimeout(function () {
      if (terminou) return;
      terminou = true;
      const erro = new Error('timeout');
      erro.code = 'app/timeout';
      reject(erro);
    }, SUG_TIMEOUT_MS);
    promessa.then(
      function (v) {
        if (terminou) return;
        terminou = true;
        clearTimeout(t);
        resolve(v);
      },
      function (e) {
        if (terminou) return;
        terminou = true;
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

// Chamada autenticada a /api/user?op=feedback. O envio (e a leitura) da sugestão
// deixou de passar pelo SDK do cliente: a coleção `feedback` depende de uma
// Security Rule publicada à mão no projeto, e enquanto ela não estiver lá o
// Firestore devolve `permission-denied` em TODA tentativa — com o e-mail
// verificado e tudo. O servidor usa o Admin SDK, que não passa por rules.
function sugApiFetch(caminho, opcoes) {
  const ctx = sugFirebaseUser();
  if (!ctx) return Promise.reject(Object.assign(new Error('sem sessão'), { code: 'app/no-auth' }));
  // Token novo a cada chamada: depois de confirmar o e-mail, o que está em
  // cache ainda pode trazer email_verified=false e o servidor recusa com 403.
  return ctx.user
    .reload()
    .then(function () {
      return ctx.user.getIdToken(true);
    })
    .then(function (token) {
      const o = opcoes || {};
      return fetch(caminho, {
        method: o.method || 'GET',
        headers: Object.assign(
          { Authorization: 'Bearer ' + token },
          o.body ? { 'Content-Type': 'application/json' } : {}
        ),
        body: o.body ? JSON.stringify(o.body) : undefined,
        credentials: 'same-origin',
      });
    })
    .then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (j) {
          if (r.ok) return j;
          const erro = new Error(j.error || 'http_' + r.status);
          erro.code = 'api/' + (j.error || r.status);
          erro.status = r.status;
          erro.issues = j.issues || null;
          throw erro;
        });
    });
}

function enviarSugestao() {
  const aba = document.getElementById('sugAba').value;
  const outroTema = document.getElementById('sugOutroTema').value.trim();
  const tipo = document.getElementById('sugTipo').value || 'melhoria';
  const texto = document.getElementById('sugTexto').value.trim();

  // Validação: além do aviso, leva o cursor até o campo que falta. Um toast
  // sozinho não diz ONDE está o problema num formulário com quatro campos.
  if (!aba) {
    sugFocar('sugAba');
    return sugAvisar('Selecione a aba relacionada à sua sugestão.', 'erro');
  }
  if (aba === 'outro' && !outroTema) {
    sugFocar('sugOutroTema');
    return sugAvisar('Diga sobre o que é a sua sugestão.', 'erro');
  }
  if (texto.length < 10) {
    sugFocar('sugTexto');
    return sugAvisar(
      `Descreva sua sugestão com pelo menos 10 caracteres (você escreveu ${texto.length}).`,
      'erro'
    );
  }
  if (texto.length > 1000) {
    sugFocar('sugTexto');
    return sugAvisar('Sua sugestão é muito longa (máximo de 1000 caracteres).', 'erro');
  }

  const ctx = sugFirebaseUser();
  if (!ctx) {
    return sugAvisar(
      'Não conseguimos falar com o servidor agora. Confirme que você está conectado à sua ' +
        'conta e recarregue a página antes de tentar de novo.',
      'erro'
    );
  }
  const btn = document.getElementById('sugBtnEnviar');
  if (btn) btn.disabled = true;
  sugStatus('Enviando sua sugestão…', 'info');

  // Atualiza usuário + token ANTES de gravar. Depois de confirmar o e-mail, o
  // token em cache ainda pode trazer email_verified=false (só muda ao renovar)
  // e a regra do Firestore rejeita a escrita com permission-denied — mesmo com
  // a conta já verificada. reload() sincroniza o estado; getIdToken(true) força
  // um token novo com o claim atualizado.
  sugComTeto(
    ctx.user.reload().then(function () {
      if (ctx.user.emailVerified === false) {
        try {
          if (typeof ctx.user.sendEmailVerification === 'function')
            ctx.user.sendEmailVerification();
        } catch (e) {}
        const erro = new Error('email-nao-verificado');
        erro.code = 'app/email-not-verified';
        throw erro;
      }
      return sugApiFetch('/api/user?op=feedback', {
        method: 'POST',
        body: {
          aba: aba,
          outroTema: aba === 'outro' ? outroTema : '',
          tipo: tipo,
          texto: texto,
          // Só os quatro campos que o schema conhece — `nome` e `bytes` são
          // de uso local (aparecem no cartão de pré-visualização) e o corpo é
          // `strict()`: um campo a mais derrubaria o envio inteiro com 400.
          anexo: sugAnexoAtual
            ? {
                mime: sugAnexoAtual.mime,
                dados: sugAnexoAtual.dados,
                largura: sugAnexoAtual.largura,
                altura: sugAnexoAtual.altura,
              }
            : null,
        },
      });
    })
  )
    .then(function () {
      // Limpar form
      document.getElementById('sugAba').value = '';
      document.getElementById('sugOutroTema').value = '';
      document.getElementById('sugOutroWrapper').style.display = 'none';
      document.getElementById('sugTexto').value = '';
      document.getElementById('sugContador').innerText = '0';
      sugAnexoAtual = null;
      sugAnexoPintar();
      selecionarTipoSugestao('melhoria');
      sugAvisar('Sugestão enviada! O time vai responder por aqui 💚', 'sucesso');
      renderizarHistoricoSugestoes();
    })
    .catch(function (err) {
      console.warn('[duvidas] enviarSugestao', err && err.code, err);
      const code = err && err.code ? String(err.code) : '';
      if (code === 'app/email-not-verified') {
        sugAvisar(
          'Confirme seu e-mail para enviar sugestões. Reenviamos o link — confira sua caixa de entrada (e o spam).',
          'erro'
        );
      } else if (code === 'app/timeout' || code.indexOf('unavailable') !== -1) {
        sugAvisar(
          'O servidor não respondeu a tempo. Sua sugestão <strong>não</strong> foi enviada — ' +
            'verifique a conexão e tente de novo.',
          'erro'
        );
      } else if (code === 'api/email_not_verified') {
        sugAvisar(
          'Confirme seu e-mail para enviar sugestões — o link foi enviado para a sua caixa de entrada.',
          'erro'
        );
      } else if (err && err.status === 413) {
        // O limite de corpo é da plataforma, não do nosso schema: quando ele
        // estoura, nem chegamos ao handler. Sem esta linha o usuário levaria a
        // mensagem genérica de conexão e tentaria de novo para sempre.
        sugAvisar(
          'A imagem anexada ficou pesada demais para o envio. Remova o anexo ou escolha um print ' +
            'menor e tente de novo — o texto continua aqui.',
          'erro'
        );
      } else if (code === 'api/rate_limited') {
        sugAvisar(
          'Você enviou muitas sugestões seguidas. Tente de novo daqui a pouco — as anteriores já chegaram.',
          'erro'
        );
      } else if (code === 'api/invalid_body') {
        // O servidor valida os mesmos limites do formulário. Mostra o que ele
        // apontou em vez de um "não foi possível" genérico.
        const det = (err.issues || []).map((i) => escSug(i.msg)).join(' · ');
        sugAvisar('Revise o formulário' + (det ? ': ' + det : '.'), 'erro');
      } else if (
        code === 'api/missing_token' ||
        code === 'api/invalid_token' ||
        code === 'app/no-auth'
      ) {
        sugAvisar(
          'Sua sessão expirou. Saia e entre de novo na conta para enviar a sugestão.',
          'erro'
        );
      } else if (code.indexOf('permission-denied') !== -1) {
        sugAvisar(
          'Não foi possível enviar. Se você acabou de verificar o e-mail, saia e entre de novo na conta.',
          'erro'
        );
      } else {
        sugAvisar(
          'Não foi possível enviar agora. Verifique sua conexão e tente novamente.' +
            (code ? ` <span style="opacity:.75">(${escSug(code)})</span>` : ''),
          'erro'
        );
      }
    })
    .finally(function () {
      if (btn) btn.disabled = false;
    });
}

var SUG_LABELS_ABA = {
  meu_patrimonio: 'Meu patrimônio',
  controle: 'Controle financeiro',
  patrimonio: 'Meus investimentos',
  carteira: 'Carteira sugerida',
  relatorio_mensal: 'Relatório mensal',
  simulador: 'Simule sua liberdade',
  meus_sonhos: 'Meus sonhos',
  aulas: 'Jornada Financeira',
  noticias: 'Info Mercado',
  applicash: 'Applicash $',
  conta: 'Conta e assinatura',
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

// Histórico das sugestões do usuário. Pinta o cache local na hora e busca o
// estado fresco em /api/feedback — mesmo motivo do envio: a leitura direta da
// coleção `feedback` pelo SDK depende da Security Rule estar publicada, e sem
// ela o `.get()` falha calado e a lista fica em "0 total" para sempre.
function renderizarHistoricoSugestoes() {
  const lista = document.getElementById('sugHistoricoLista');
  if (!lista) return;
  desenharHistoricoSugestoes(carregarSugestoes());
  if (!sugFirebaseUser()) return;

  sugApiFetch('/api/user?op=feedback')
    .then(function (resp) {
      const items = (resp && resp.items ? resp.items : []).map(function (x) {
        return {
          id: x.id,
          aba: x.aba,
          outroTema: x.outroTema,
          tipo: x.tipo,
          texto: x.texto,
          status: x.status || 'aberto',
          reply: x.reply || null,
          // Só o RESUMO ({mime, bytes, largura, altura}) — os bytes da imagem
          // não vêm na listagem e são buscados um a um em sugVerAnexo().
          anexo: x.anexo || null,
          data: x.createdAtMs ? new Date(x.createdAtMs).toISOString() : new Date().toISOString(),
          _ms: x.createdAtMs || 0,
        };
      });
      salvarSugestoes(items);
      desenharHistoricoSugestoes(items);
    })
    .catch(function (err) {
      // Falha de rede não pode apagar o que já está na tela: o cache local
      // continua valendo. Só registra para diagnóstico.
      console.warn('[duvidas] historico', err && err.code, err);
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
      // A imagem não vem na listagem — só a marca de que existe. O botão a
      // busca quando alguém quiser vê-la, e não em toda abertura da aba.
      //
      // O id entra num atributo onclick, e escSug() escapa só `<`. Em vez de
      // inventar um segundo escapador, exigimos o formato que um id de
      // documento do Firestore tem de fato — o que não passa nele não vira
      // botão, e nada de estranho chega ao atributo.
      const idOk = /^[A-Za-z0-9_-]{1,64}$/.test(String(s.id || ''));
      const anexoHtml =
        s.anexo && idOk
          ? `<div id="sh-anexo-${s.id}"><button type="button" class="sh-anexo-abrir" onclick="sugVerAnexo('${s.id}')"><i class="ph ph-image"></i> Ver imagem enviada</button></div>`
          : '';
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
            ${anexoHtml}
            <div style="margin-top:6px;font-size:11px;font-weight:700;color:${st.cor};">${st.lbl}</div>
            ${respostaHtml}
        </div>`;
    })
    .join('');
}

// Busca e mostra a imagem de UMA sugestão. Fica fora do desenho da lista de
// propósito: são até dezenas de itens no histórico e cada imagem tem centenas
// de KB — carregar todas para mostrar duas seria pagar caro por nada,
// principalmente no celular.
function sugVerAnexo(id) {
  const box = document.getElementById('sh-anexo-' + id);
  if (!box) return;
  const btn = box.querySelector('button');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner"></i> Carregando…';
  }
  sugApiFetch('/api/user?op=feedback-anexo&id=' + encodeURIComponent(id))
    .then(function (r) {
      if (!r || !r.dados) throw new Error('vazio');
      const img = document.createElement('img');
      img.className = 'sh-anexo-img';
      img.alt = 'Imagem que você anexou a esta sugestão';
      img.src = 'data:' + (r.mime || 'image/jpeg') + ';base64,' + r.dados;
      box.innerHTML = '';
      box.appendChild(img);
    })
    .catch(function (err) {
      console.warn('[duvidas] anexo historico', err && err.code, err);
      box.innerHTML =
        '<div style="margin-top:8px;font-size:11.5px;color:var(--cor-texto-mutado);">Não foi possível carregar a imagem agora.</div>';
    });
}

// Idempotente de propósito. Antes ela era chamada UMA vez, no fim do
// window.onload de app.js — depois de dezenas de outras inicializações. Se
// qualquer uma delas estourasse (um script externo que não carregou, por
// exemplo), o onload morria antes daqui e o formulário ficava sem os seus
// listeners: o contador travado em 0 e o campo "sobre o que é" nunca aparecia.
// Agora `mudarAba` também chama, e a flag impede listener duplicado.
var sugFormPronto = false;
function inicializarFormSugestao() {
  if (sugFormPronto) return;
  sugFormPronto = true;
  const sel = document.getElementById('sugAba');
  const wrap = document.getElementById('sugOutroWrapper');
  if (sel)
    sel.addEventListener('change', () => {
      if (wrap) wrap.style.display = sel.value === 'outro' ? '' : 'none';
      sugStatus('');
    });
  const ta = document.getElementById('sugTexto');
  const cont = document.getElementById('sugContador');
  if (ta && cont)
    ta.addEventListener('input', () => {
      cont.innerText = ta.value.length;
      sugStatus('');
    });
  // O hidden nasce com 'melhoria'; sincroniza classe e aria-pressed a partir
  // dele para o botão aceso ser sempre o mesmo que será enviado.
  const hidden = document.getElementById('sugTipo');
  selecionarTipoSugestao(hidden ? hidden.value : 'melhoria');
  // Reabrir a aba não pode ressuscitar um anexo de outra sessão de digitação:
  // pinta a partir do estado, que nasce vazio.
  sugAnexoPintar();
}
