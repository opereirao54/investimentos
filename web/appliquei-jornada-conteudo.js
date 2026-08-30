/**
 * Appliquei — material de estudo da Jornada Financeira.
 *
 * Cada módulo da trilha tinha título, uma frase de descrição e dois objetivos.
 * O modal terminava num aviso de "conteúdo em desenvolvimento": a pessoa
 * clicava para estudar e encontrava a promessa de que um dia haveria o que
 * estudar. Este arquivo é esse conteúdo.
 *
 * O conteúdo é DADO, não HTML. Cada bloco é um objeto com um tipo, e o
 * renderizador (appliquei-jornada.js) decide como desenhar. Três razões:
 *
 *  · identidade — o CSS de um `alerta` é o mesmo nos oito módulos, sempre,
 *    porque ninguém escreve estilo à mão aqui;
 *  · segurança — nada de HTML solto num arquivo que vai crescer a cada revisão
 *    de conteúdo; o texto é escapado antes de entrar na tela;
 *  · revisão — quem for corrigir um número não precisa entender de markup.
 *
 * A ênfase é `**assim**`. É a única marcação permitida dentro de um texto.
 *
 * TIPOS DE BLOCO
 *   { t:'h',       texto }                       título de seção
 *   { t:'p',       texto }                       parágrafo
 *   { t:'lista',   itens:[] }                    marcadores
 *   { t:'passos',  itens:[] }                    lista numerada (ordem importa)
 *   { t:'chave',   termo, texto }                definição destacada
 *   { t:'conta',   titulo, linhas:[[rot,val,destaque?]], nota }  exemplo numérico
 *                 destaque=1 marca a linha de RESULTADO (só uma por conta)
 *   { t:'alerta',  titulo, texto }               armadilha comum
 *   { t:'noapp',   aba, texto }                  o que fazer aqui dentro
 *   { t:'ideia',   texto }                       a frase que fica do módulo
 *
 * SOBRE NÚMEROS E REGRAS
 * Alíquotas, tetos e indexadores mudam por lei e por decisão do Copom. O
 * material explica a MECÂNICA (que é estável) e marca todo valor como exemplo.
 * Quando um número aparece, ele vem com "supondo" na frente. Ver
 * JORNADA_AVISO_REGRAS, exibido no rodapé de todo módulo.
 */

/** Rodapé de todo material — regra que muda não pode ser lida como promessa. */
var JORNADA_AVISO_REGRAS =
  'Alíquotas, limites e regras tributárias mudam por lei, e os juros mudam a ' +
  'cada reunião do Copom. Os números deste material são exemplos para você ' +
  'entender a mecânica — confirme as condições vigentes antes de decidir. ' +
  'Conteúdo educacional: não é recomendação de investimento.';

var JORNADA_CONTEUDO = {
  // ══════════════════════════════════════════════════════════════════
  m1: {
    tempo: 7,
    resumo:
      'Quem investe bem não é quem escolhe o melhor ativo — é quem não desfaz a escolha na primeira queda.',
    blocos: [
      {
        t: 'ideia',
        texto:
          'Disciplina rende mais que acerto. Dois pontos percentuais a mais de retorno num ano não compensam um ano inteiro sem aportar.',
      },
      { t: 'h', texto: 'Por que começar pela cabeça' },
      {
        t: 'p',
        texto:
          'A pergunta que quase todo mundo faz primeiro é "onde eu invisto?". É a pergunta errada para começar. O que separa quem constrói patrimônio de quem não constrói quase nunca é a escolha do ativo — é **quanto** se aporta, **por quanto tempo**, e se a pessoa aguenta ficar parada quando a tela fica vermelha.',
      },
      {
        t: 'conta',
        titulo: 'Duas pessoas, vinte anos (supondo 8% ao ano nos dois casos)',
        linhas: [
          ['Ana aporta R$ 500/mês, sem falhar', 'R$ 294.510'],
          ['Bruno aporta R$ 500/mês, mas para 4 anos no meio', 'R$ 218.630'],
          ['Diferença', 'R$ 75.880', 1],
        ],
        nota: 'Bruno deixou de aportar R$ 24.000. A diferença final foi três vezes isso — o que faltou não foi o dinheiro, foi o tempo que ele teria rendido.',
      },
      { t: 'h', texto: 'Os três gatilhos que fazem parar' },
      {
        t: 'p',
        texto:
          'Ninguém acorda decidido a abandonar o plano. A saída acontece por um destes caminhos, e reconhecê-los é metade do trabalho:',
      },
      {
        t: 'lista',
        itens: [
          '**Aversão à perda.** Perder R$ 1.000 dói mais do que ganhar R$ 1.000 alegra. Por isso a queda de 15% assusta mais do que a alta de 15% anima — e vender no vermelho parece "parar o sangramento" quando é só realizar o prejuízo.',
          '**Viés do recente.** O que subiu nos últimos meses parece seguro; o que caiu parece furado. É o mecanismo que faz comprar caro e vender barato, com a sensação de estar sendo prudente.',
          '**Comparação.** O retorno do vizinho, do grupo de WhatsApp, do influenciador. Ele nunca conta as perdas, e o seu plano não foi feito para o objetivo dele.',
        ],
      },
      {
        t: 'alerta',
        titulo: 'O custo de "esperar melhorar"',
        texto:
          'Sair da posição para voltar "quando estabilizar" custa caro porque a recuperação é concentrada em poucos dias. Quem fica de fora dos dez melhores dias de uma década costuma terminar com metade do resultado de quem simplesmente não saiu. Você não sabe quais serão esses dias — ninguém sabe.',
      },
      { t: 'h', texto: 'A tese em uma frase' },
      {
        t: 'p',
        texto:
          'Sua tese é a resposta curta para "por que estou investindo e por quanto tempo". Ela existe para ser lida no dia em que a carteira cair 20% — é nesse dia que ela vale alguma coisa. Boas teses são chatas e específicas:',
      },
      {
        t: 'lista',
        itens: [
          '"Estou construindo renda passiva para poder trabalhar menos aos 55; horizonte de 22 anos; oscilação no meio do caminho não muda nada."',
          '"Quero a entrada de um imóvel em 4 anos; não posso perder capital; retorno importa menos que previsibilidade."',
        ],
      },
      {
        t: 'p',
        texto:
          'Repare que as duas frases já decidem a carteira. A primeira aceita renda variável; a segunda, quase não. **A tese vem antes do ativo** — e é por isso que este módulo vem antes de todos os outros.',
      },
      {
        t: 'noapp',
        aba: 'Meus sonhos',
        texto:
          'Escreva cada objetivo com prazo e valor. Um objetivo com data deixa de ser desejo e vira uma linha no seu orçamento — e é o prazo que decide onde o dinheiro pode ficar.',
      },
      {
        t: 'noapp',
        aba: 'Carteira sugerida',
        texto:
          'O questionário de perfil pergunta tolerância a perda, objetivo e prazo. Responda pensando no dia ruim, não no dia bom: perfil declarado em mês de alta costuma ser mais arrojado do que a pessoa aguenta.',
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  m2: {
    tempo: 9,
    resumo:
      'Aporte não é o que sobra no fim do mês. É a primeira despesa da lista — e o resto se organiza depois dela.',
    blocos: [
      {
        t: 'ideia',
        texto:
          'Quem aporta o que sobra aporta zero, porque nunca sobra. Inverta a ordem: separe primeiro, gaste o que ficou.',
      },
      { t: 'h', texto: 'Pague-se primeiro' },
      {
        t: 'p',
        texto:
          'A maior parte das pessoas segue a ordem: recebe, paga contas, gasta, e investe o que sobrou. O problema é que o gasto se expande até ocupar tudo que existe — não por descontrole, mas porque a decisão de gastar é tomada com o dinheiro na conta. Inverter é a única mudança estrutural que dispensa força de vontade: **no dia do salário, o aporte sai antes de qualquer outra coisa.**',
      },
      { t: 'h', texto: 'Onde o dinheiro vai: os três tipos de saída' },
      {
        t: 'lista',
        itens: [
          '**Fixas** — aluguel, escola, plano de saúde, assinaturas. Valor previsível, difíceis de cortar no curto prazo, e é onde mora a economia grande: R$ 200 a menos numa fixa são R$ 2.400 por ano, todo ano.',
          '**Variáveis** — mercado, transporte, lazer. Valor muda todo mês. É onde a maioria tenta cortar primeiro, e é onde o corte tem menos efeito e mais desgaste.',
          '**Sazonais** — IPVA, IPTU, seguro, material escolar, presentes. Somem do orçamento mensal e reaparecem como "imprevisto" — que não é imprevisto nenhum, é só falta de provisão.',
        ],
      },
      {
        t: 'alerta',
        titulo: 'A despesa sazonal que vira dívida',
        texto:
          'IPVA de R$ 2.400 em janeiro não é emergência: é R$ 200 por mês que você já sabia desde o ano passado. Quem não provisiona paga parcelado com juros ou tira da reserva. Some as sazonais do ano, divida por 12, e trate esse valor como conta fixa.',
      },
      { t: 'h', texto: 'Quanto aportar' },
      {
        t: 'p',
        texto:
          'A referência mais usada é **10% da receita líquida** como piso, e 20% ou mais quando dá. Mas a referência serve só para começar: o número que importa é o que você consegue repetir todo mês sem precisar sacar de volta. Um aporte de 8% que sobrevive doze meses vale mais que um de 25% que quebra no terceiro.',
      },
      {
        t: 'conta',
        titulo: 'Achando o seu piso',
        linhas: [
          ['Receita líquida mensal', 'R$ 6.000'],
          ['− Despesas fixas', 'R$ 2.900'],
          ['− Média das variáveis (3 meses)', 'R$ 1.600'],
          ['− Provisão das sazonais (anual ÷ 12)', 'R$ 400'],
          ['= Sobra estrutural', 'R$ 1.100'],
          ['Aporte inicial sugerido (70% da sobra)', 'R$ 770', 1],
        ],
        nota: 'Deixar 30% da sobra livre não é desperdício — é o que evita sacar o aporte no primeiro mês fora da curva.',
      },
      { t: 'h', texto: 'Três alavancas, em ordem de eficiência' },
      {
        t: 'passos',
        itens: [
          '**Renegociar fixas.** Plano de celular, internet, seguro, academia, assinaturas esquecidas. Uma tarde de trabalho, efeito todo mês, sem mudar seu padrão de vida.',
          '**Cortar o vazamento invisível.** Não é o café: é a assinatura que você não usa, a tarifa de conta, o parcelamento que você já esqueceu que existe. Só aparece quando se olha o extrato inteiro de um mês.',
          '**Aumentar a receita.** É a de maior efeito e a mais lenta. Vale começar, mas não vale esperar por ela para começar a aportar.',
        ],
      },
      {
        t: 'alerta',
        titulo: 'Cartão de crédito não é renda',
        texto:
          'A fatura do cartão é gasto do mês em que a compra aconteceu, não do mês em que ela vence. Quem enxerga o cartão como um mês de prazo passa a viver de um salário adiantado — e uma queda de receita transforma isso em dívida rotativa, que é a mais cara do mercado.',
      },
      {
        t: 'noapp',
        aba: 'Controle financeiro',
        texto:
          'Lance três meses de despesas com categoria. É o mínimo para a média das variáveis parar de mentir. O extrato já vem do maior para o menor: os primeiros cinco itens da lista costumam responder mais de 70% do mês.',
      },
      {
        t: 'noapp',
        aba: 'Controle financeiro → DRE',
        texto:
          'A linha **Investimento acumulado** mostra quanto do seu dinheiro já virou capital aplicado. É o placar deste módulo: se ela não sobe mês a mês, a otimização de caixa ainda não aconteceu.',
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  m3: {
    tempo: 8,
    resumo:
      'A reserva não existe para render. Existe para você nunca precisar vender um investimento na pior hora possível.',
    blocos: [
      {
        t: 'ideia',
        texto:
          'A reserva de emergência é o que permite que todo o resto da carteira seja de longo prazo de verdade.',
      },
      { t: 'h', texto: 'O que ela protege' },
      {
        t: 'p',
        texto:
          'Sem reserva, qualquer imprevisto — desemprego, saúde, um conserto grande — obriga a vender algum investimento. E o imprevisto raramente escolhe um bom momento de mercado: crises pessoais e crises de mercado gostam de andar juntas. Vender uma posição de longo prazo numa queda transforma uma oscilação temporária em prejuízo definitivo. **A reserva é o que impede que isso aconteça.**',
      },
      { t: 'h', texto: 'Quanto' },
      {
        t: 'p',
        texto:
          'A conta parte do seu **custo de vida mensal** — não da sua receita. O multiplicador depende de quão previsível é a sua renda:',
      },
      {
        t: 'lista',
        itens: [
          '**3 a 4 meses** — servidor público, estabilidade alta, sem dependentes.',
          '**6 meses** — CLT no setor privado. É a referência mais comum.',
          '**9 a 12 meses** — autônomo, PJ, comissionado, renda irregular, ou quem sustenta outras pessoas.',
        ],
      },
      {
        t: 'conta',
        titulo: 'Dimensionando',
        linhas: [
          ['Custo de vida mensal (fixas + variáveis + provisão)', 'R$ 4.900'],
          ['Perfil: CLT, sem dependentes → 6 meses', '× 6'],
          ['Reserva alvo', 'R$ 29.400', 1],
          ['Aportando R$ 900/mês, tempo até completar', '~30 meses'],
        ],
        nota: 'Trinta meses parece muito. É — e é por isso que a reserva vem antes: começar por ela é o que evita ter de desmontar a carteira lá na frente.',
      },
      { t: 'h', texto: 'Onde' },
      {
        t: 'p',
        texto:
          'Reserva tem três exigências, nesta ordem: **liquidez** (sacar rápido), **baixa oscilação** (não pode valer menos justo no dia do saque) e só então **rendimento**. Quem inverte a ordem e busca rendimento primeiro descobre no pior dia que o dinheiro não estava disponível.',
      },
      {
        t: 'chave',
        termo: 'Liquidez diária',
        texto:
          'O dinheiro volta para a conta no mesmo dia ou no dia útil seguinte. É a característica que define se um ativo pode ser reserva — todo o resto é secundário.',
      },
      {
        t: 'lista',
        itens: [
          '**Tesouro Selic** — o título público de menor oscilação. Acompanha a taxa básica, liquidez em D+1. É o padrão de referência para reserva.',
          '**CDB de liquidez diária** — pagam um percentual do CDI e podem resgatar a qualquer momento. Cobertos pelo FGC dentro dos limites da garantia.',
          '**Fundo DI simples** — funciona, mas confira a taxa de administração: acima de 0,3% ao ano ela come boa parte do rendimento de um ativo que já rende pouco.',
        ],
      },
      {
        t: 'chave',
        termo: 'FGC',
        texto:
          'O Fundo Garantidor de Créditos devolve o seu dinheiro se o banco quebrar, dentro de um limite por CPF e por instituição, com um teto global a cada período. Serve para CDB, LCI, LCA e poupança — **não** cobre Tesouro Direto (que não precisa: o risco ali é do governo) nem fundos de investimento.',
      },
      {
        t: 'alerta',
        titulo: 'O que a reserva não pode ser',
        texto:
          'Ações, fundos imobiliários, cripto, CDB com carência de dois anos, previdência. Todos podem ser bons investimentos — nenhum é reserva. Um ativo que oscila ou que trava o resgate falha exatamente no dia em que você precisa dele.',
      },
      {
        t: 'alerta',
        titulo: 'Poupança: o custo do automático',
        texto:
          'A poupança tem liquidez e é isenta de IR, o que a faz parecer resolver. O problema é o rendimento: a regra dela paga bem menos que a taxa básica quando os juros estão altos, e ainda perde no aniversário — sacar um dia antes da data faz o mês inteiro render zero. Para o mesmo risco e a mesma liquidez, existe coisa melhor.',
      },
      {
        t: 'noapp',
        aba: 'Meus investimentos',
        texto:
          'Cadastre a reserva na categoria **Reserva de emergência**. Ela entra no seu patrimônio, mas fica separada do resto — é assim que você enxerga de longe se já está completa ou se ainda está sendo construída.',
      },
      {
        t: 'noapp',
        aba: 'Relatório mensal',
        texto:
          'A reserva é um dos cinco critérios do termômetro. Enquanto ela não fecha, o score fica limitado por baixo — de propósito.',
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  m4: {
    tempo: 8,
    resumo:
      'A parte técnica é a mais simples da jornada. O que trava não é a plataforma — é a primeira ordem.',
    blocos: [
      {
        t: 'ideia',
        texto:
          'Abrir conta leva quinze minutos. O que leva meses é decidir começar — e a decisão já foi tomada nos módulos anteriores.',
      },
      { t: 'h', texto: 'Escolhendo a corretora' },
      {
        t: 'p',
        texto:
          'Para quem está começando, a diferença entre as grandes corretoras é menor do que a propaganda sugere. Quatro critérios resolvem:',
      },
      {
        t: 'lista',
        itens: [
          '**Custo** — corretagem em ações e FIIs, taxa de custódia, e o spread na renda fixa. Corretagem zero é comum hoje; o custo escondido costuma estar na renda fixa e no câmbio.',
          '**Catálogo** — se você vai querer Tesouro Direto, CDB de vários emissores, FIIs e ETFs, confira se tudo está no mesmo lugar. Espalhar em três corretoras multiplica o trabalho de acompanhar.',
          '**Usabilidade** — você vai usar isso todo mês por anos. Um app confuso é um custo real, medido em aportes que não aconteceram.',
          '**Solidez** — corretora não custodia seu dinheiro no sentido em que se imagina: as ações ficam na B3 no seu CPF, e o Tesouro na sua conta do Tesouro Direto. Ainda assim, prefira instituições estabelecidas.',
        ],
      },
      { t: 'h', texto: 'Da abertura ao primeiro ativo' },
      {
        t: 'passos',
        itens: [
          '**Abra a conta.** CPF, documento com foto, comprovante de residência, selfie. Aprovação costuma sair no mesmo dia.',
          '**Responda o suitability.** É o questionário de perfil obrigatório. Responda com honestidade: ele existe para impedir que te vendam o que você não aguenta carregar.',
          '**Transfira via PIX ou TED** da sua conta, no seu CPF. Corretora não aceita depósito de terceiros.',
          '**Encontre o ativo.** Renda fixa e Tesouro ficam em vitrines próprias, com o valor mínimo e o vencimento na tela. Ações e FIIs se compram pelo código (o ticker) no book ou no boleto simplificado.',
          '**Envie a ordem.** Em renda fixa você informa o valor em reais. Em ações e FIIs você informa a **quantidade**, e o mínimo é uma unidade no mercado fracionário.',
          '**Confira a nota.** No fim do dia sai a nota de corretagem (ações e FIIs) ou o comprovante de aplicação (renda fixa). Guarde: é o documento do preço que você pagou, e você vai precisar dele na declaração.',
        ],
      },
      {
        t: 'chave',
        termo: 'Ticker',
        texto:
          'O código do ativo na bolsa: quatro letras e um número em ações (o 3 costuma indicar ação ordinária, o 4 preferencial), e onze caracteres terminados em 11 nos fundos imobiliários e ETFs.',
      },
      {
        t: 'chave',
        termo: 'Mercado fracionário',
        texto:
          'Permite comprar de 1 a 99 ações, em vez do lote padrão de 100. O código ganha um F no fim. O preço é praticamente o mesmo — é o que torna possível começar com pouco.',
      },
      {
        t: 'alerta',
        titulo: 'Ordem a mercado x ordem limitada',
        texto:
          'A ordem **a mercado** executa na hora, pelo preço que estiver disponível — e em ativos de pouca negociação esse preço pode ser bem pior do que o da tela. A ordem **limitada** define o preço máximo que você aceita pagar: pode não executar, mas nunca te surpreende. Para quem está começando, limitada é o padrão seguro.',
      },
      {
        t: 'alerta',
        titulo: 'O primeiro aporte não precisa ser o certo',
        texto:
          'Muita gente trava meses buscando o melhor ativo para começar. O efeito de escolher o segundo melhor ativo é pequeno; o efeito de perder seis meses é grande. Comece com o mais simples que você entende — Tesouro Selic serve — e refine depois.',
      },
      {
        t: 'noapp',
        aba: 'Meus investimentos',
        texto:
          'Depois de comprar, registre a operação. Informe a conta de onde o dinheiro saiu e a Appliquei desconta o saldo automaticamente — a compra fica ligada ao seu caixa, não solta.',
      },
      {
        t: 'noapp',
        aba: 'Meus investimentos → cadastro retroativo',
        texto:
          'Se você já tinha investimentos antes de chegar aqui, cadastre pela opção **Investimento já existente**: você informa quanto tem e desde quando, e nada é debitado das suas contas — esse dinheiro saiu do caixa lá atrás.',
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  m5: {
    tempo: 11,
    resumo:
      'Renda fixa não é "sem risco" — é risco conhecido. O trabalho é comparar coisas comparáveis antes de escolher.',
    blocos: [
      {
        t: 'ideia',
        texto:
          'Em renda fixa você empresta dinheiro. As três perguntas são sempre as mesmas: para quem, por quanto tempo, corrigido por quê.',
      },
      { t: 'h', texto: 'Os três indexadores' },
      {
        t: 'p',
        texto:
          'Tudo em renda fixa se encaixa em uma destas três formas de correção. Escolher entre elas é escolher que tipo de incerteza você aceita:',
      },
      {
        t: 'lista',
        itens: [
          '**Pós-fixado (CDI ou Selic).** Rende o que a taxa básica render, dia a dia. Você não sabe quanto vai render, mas o valor **nunca cai**. É o que se usa para reserva e para dinheiro de prazo curto.',
          '**Prefixado.** A taxa é combinada na compra: 12% ao ano são 12% ao ano até o vencimento, aconteça o que acontecer. Trava um bom retorno quando os juros estão altos — e trava um retorno ruim se você errar a leitura.',
          '**Híbrido (IPCA+).** Paga a inflação mais uma taxa real. É o único que garante ganho **acima da inflação**, e por isso é o indexado natural de objetivo longo, como aposentadoria.',
        ],
      },
      {
        t: 'conta',
        titulo: 'O mesmo dinheiro, três caminhos (exemplo, 5 anos, R$ 10.000)',
        linhas: [
          ['Pós-fixado, supondo CDI médio de 10% a.a.', '~R$ 16.100'],
          ['Prefixado travado a 12% a.a.', '~R$ 17.600'],
          ['IPCA + 6%, supondo inflação média de 4,5%', '~R$ 16.900'],
        ],
        nota: 'O prefixado ganha SE os juros caírem como se supôs. Se subirem, ele vira o pior dos três. Não existe o melhor indexador — existe o mais adequado ao seu prazo e ao seu objetivo.',
      },
      { t: 'h', texto: 'Marcação a mercado: por que o título "cai"' },
      {
        t: 'p',
        texto:
          'Prefixados e IPCA+ oscilam antes do vencimento. Quando os juros do mercado sobem, títulos antigos pagando menos ficam menos atraentes, e o preço deles cai para compensar. É por isso que um Tesouro IPCA+ pode aparecer com prejuízo no extrato.',
      },
      {
        t: 'chave',
        termo: 'Levar ao vencimento',
        texto:
          'A oscilação só vira perda se você vender antes. Segurando até o vencimento, você recebe exatamente a taxa combinada na compra — o preço no meio do caminho não te afeta.',
      },
      {
        t: 'alerta',
        titulo: 'A armadilha do prazo',
        texto:
          'Um IPCA+ 2045 é excelente para aposentadoria e péssimo para a entrada de um carro em três anos. Não é o título que é bom ou ruim: é a distância entre o vencimento dele e a data em que você vai precisar do dinheiro.',
      },
      { t: 'h', texto: 'Imposto: onde o retorno some' },
      {
        t: 'p',
        texto:
          'Na maioria dos títulos de renda fixa o IR incide **só sobre o rendimento**, na fonte, no resgate, e a alíquota cai conforme o tempo — quanto mais tempo aplicado, menos imposto. A faixa mais alta fica nos primeiros meses e a mais baixa depois de cerca de dois anos.',
      },
      {
        t: 'lista',
        itens: [
          '**CDB, Tesouro, debênture comum** — seguem essa tabela regressiva.',
          '**LCI e LCA** — historicamente isentas de IR para pessoa física, o que faz uma taxa nominal menor render mais na mão. Em compensação costumam ter carência.',
          '**Debênture incentivada** — também com tratamento tributário favorecido, ligada a projetos de infraestrutura, e sem cobertura do FGC.',
        ],
      },
      {
        t: 'conta',
        titulo: 'Comparando o que não é comparável (exemplo)',
        linhas: [
          ['CDB a 110% do CDI, resgate em 1 ano', 'tributado'],
          ['LCI a 95% do CDI, mesmo prazo', 'isenta'],
          ['Supondo CDI a 10%: CDB rende 11% bruto', '~8,8% líquido'],
          ['LCI rende 9,5%', '9,5% líquido'],
        ],
        nota: 'A LCI de taxa "menor" entrega mais. Comparar renda fixa pela taxa de vitrine, sem trazer tudo para líquido, é o erro mais caro e mais comum deste módulo.',
      },
      { t: 'h', texto: 'Escada de vencimentos' },
      {
        t: 'p',
        texto:
          'Em vez de colocar tudo num título só, você distribui em vencimentos escalonados — parte vencendo em 1 ano, parte em 2, parte em 3. A cada vencimento você decide: usar o dinheiro ou reinvestir na ponta longa.',
      },
      {
        t: 'lista',
        itens: [
          'Reduz o risco de travar tudo numa taxa ruim.',
          'Cria liquidez natural sem precisar vender nada no meio.',
          'Aproveita juros altos e baixos ao longo do tempo, sem exigir que você acerte o momento.',
        ],
      },
      {
        t: 'noapp',
        aba: 'Meus investimentos',
        texto:
          'Ao cadastrar renda fixa, informe **vencimento** e **rentabilidade**. Sem a taxa, a Appliquei não tem como valorizar o título e ele fica parado no valor aportado — o aviso na aba existe justamente para lembrar disso.',
      },
      {
        t: 'noapp',
        aba: 'Simule sua liberdade',
        texto:
          'Compare cenários de taxa antes de travar um prefixado longo. Ver a diferença de patrimônio em vinte anos costuma mudar a decisão.',
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  m6: {
    tempo: 12,
    resumo:
      'Comprar ação é virar sócio de uma empresa. Se você não sabe dizer como ela ganha dinheiro, ainda não é hora de comprar.',
    blocos: [
      {
        t: 'ideia',
        texto:
          'Preço é o que você paga; valor é o que você leva. A cotação muda todo dia, o negócio por trás dela não.',
      },
      { t: 'h', texto: 'Ações e FIIs: dois jeitos de ser sócio' },
      {
        t: 'lista',
        itens: [
          '**Ação** — uma fatia de uma empresa. Você ganha quando ela distribui lucro (dividendos e juros sobre capital próprio) e quando o mercado passa a valer mais o negócio.',
          '**Fundo imobiliário (FII)** — uma fatia de uma carteira de imóveis ou de papéis imobiliários. Distribui o resultado quase todo mês, e é por isso que virou o caminho mais comum para quem busca renda.',
        ],
      },
      { t: 'h', texto: 'Os números que dizem alguma coisa' },
      {
        t: 'chave',
        termo: 'Dividend yield (DY)',
        texto:
          'Quanto a empresa distribuiu nos últimos doze meses dividido pelo preço da ação. Um DY de 8% significa R$ 8 de proventos para cada R$ 100 investidos — no passado, e sem garantia de repetição.',
      },
      {
        t: 'chave',
        termo: 'Payout',
        texto:
          'Que fatia do lucro virou dividendo. Payout de 90% sobra pouco para reinvestir e crescer; payout de 20% guarda caixa mas paga pouco hoje. Nenhum dos dois é errado — depende do que você quer daquela posição.',
      },
      {
        t: 'chave',
        termo: 'P/L',
        texto:
          'Preço dividido pelo lucro por ação: quantos anos de lucro atual você está pagando. Só faz sentido comparado com o próprio histórico da empresa e com as concorrentes — P/L de setor diferente não se compara.',
      },
      {
        t: 'chave',
        termo: 'Dívida líquida / EBITDA',
        texto:
          'Quantos anos de geração de caixa a empresa levaria para quitar o que deve. Acima de 3 costuma acender alerta; em setores de infraestrutura, com receita previsível, tolera-se mais.',
      },
      {
        t: 'alerta',
        titulo: 'A armadilha do dividend yield alto',
        texto:
          'DY é uma divisão, e o preço está embaixo. Quando a ação despenca porque a empresa está em apuros, o DY **sobe** — ficando atraente exatamente quando o negócio piorou. Sempre confira se o dividendo veio de lucro recorrente ou de um evento único, como a venda de um ativo.',
      },
      {
        t: 'conta',
        titulo: 'O mesmo DY, duas histórias (exemplo)',
        linhas: [
          ['Empresa A: paga R$ 8, ação a R$ 100', 'DY 8%'],
          ['Empresa B: paga R$ 8, ação caiu de R$ 200 para R$ 100', 'DY 8%'],
          ['A pergunta que separa as duas', 'por que caiu?'],
        ],
        nota: 'Se a queda foi humor de mercado, B pode ser oportunidade. Se foi perda de contrato, o dividendo do ano que vem não existe — e o DY que te atraiu era um retrovisor.',
      },
      { t: 'h', texto: 'FIIs: os dois grupos' },
      {
        t: 'lista',
        itens: [
          '**Tijolo** — donos de imóveis físicos: galpões logísticos, lajes corporativas, shoppings. A renda vem de aluguel, e o risco é vacância e inadimplência.',
          '**Papel** — carteiras de recebíveis imobiliários (CRI). A renda vem de juros indexados ao CDI ou ao IPCA, e o risco é crédito, não vacância.',
        ],
      },
      {
        t: 'chave',
        termo: 'P/VP',
        texto:
          'Preço da cota dividido pelo valor patrimonial. Abaixo de 1 significa que o mercado paga menos do que o fundo diz valer — pode ser desconto ou pode ser desconfiança sobre a avaliação dos imóveis. Nunca é resposta sozinho.',
      },
      { t: 'h', texto: 'Diversificação: quanto é suficiente' },
      {
        t: 'p',
        texto:
          'Concentrar em duas ou três posições aumenta muito o efeito de um erro individual. Espalhar em quarenta transforma a carteira num índice caro, que você não consegue acompanhar. Para carteira pessoal, algo entre **8 e 15 posições** costuma equilibrar — desde que sejam de setores diferentes: cinco bancos não são cinco posições, são uma aposta em bancos.',
      },
      {
        t: 'alerta',
        titulo: 'Imposto de renda variável é responsabilidade sua',
        texto:
          'Diferente da renda fixa, aqui o imposto sobre ganho de capital não é retido integralmente na fonte: o cálculo e o recolhimento por DARF são do investidor, mês a mês. Existem isenções e regras específicas por tipo de ativo — confirme as vigentes e mantenha as notas de corretagem organizadas desde a primeira compra.',
      },
      {
        t: 'noapp',
        aba: 'Carteira sugerida',
        texto:
          'O motor pontua os ativos por cinco pilares e distribui o aporte do mês entre as classes. Cada card mostra a justificativa e de onde veio o dado — a nota não é para você aceitar, é para você conferir.',
      },
      {
        t: 'noapp',
        aba: 'Meus investimentos → Dividendos',
        texto:
          'Acompanhe o que foi efetivamente pago e o yield on cost — o rendimento sobre o que **você** pagou, não sobre a cotação de hoje. É o número que mostra se a tese de renda está funcionando.',
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  m7: {
    tempo: 9,
    resumo:
      'Investir fora não é apostar contra o Brasil. É deixar de depender de uma única economia e de uma única moeda.',
    blocos: [
      {
        t: 'ideia',
        texto:
          'A bolsa brasileira é cerca de 1% do valor de mercado global. Investir só aqui é uma aposta concentrada — mesmo que pareça o padrão.',
      },
      { t: 'h', texto: 'Duas exposições em uma' },
      {
        t: 'p',
        texto:
          'Quando você investe fora, recebe dois efeitos ao mesmo tempo, e é importante separá-los na cabeça:',
      },
      {
        t: 'lista',
        itens: [
          '**Exposição a empresas** que não existem por aqui — semicondutores, software global, farmacêuticas de pesquisa.',
          '**Exposição cambial**: seu patrimônio deixa de estar 100% em reais. Quando o real se desvaloriza, essa parte da carteira sobe medida em reais — é uma proteção natural, e a razão mais forte para ter alguma exposição mesmo sem opinião sobre ações estrangeiras.',
        ],
      },
      { t: 'h', texto: 'Os três caminhos' },
      {
        t: 'lista',
        itens: [
          '**ETF internacional na B3** — cotas negociadas em reais, na bolsa brasileira, que acompanham índices lá fora. É o caminho mais simples: mesma corretora, mesmo login, sem remessa e sem declaração de bens no exterior.',
          '**BDR** — recibo que representa a ação de uma empresa estrangeira, negociado aqui. Permite comprar uma empresa específica. Atenção ao tratamento tributário dos proventos, que difere do de uma ação brasileira.',
          '**Conta em corretora no exterior** — compra direta em dólar. Dá acesso ao catálogo completo e custo baixo, ao preço de câmbio, remessa, declaração de bens no exterior e regras próprias de imposto e de herança.',
        ],
      },
      {
        t: 'conta',
        titulo: 'Complexidade x acesso',
        linhas: [
          ['ETF na B3', 'simples · catálogo limitado'],
          ['BDR', 'simples · empresa específica'],
          ['Conta lá fora', 'complexo · catálogo completo'],
        ],
        nota: 'Para a maioria, começar pelo ETF na B3 resolve o essencial. A conta no exterior faz sentido quando o valor justifica o trabalho de manter — não antes.',
      },
      { t: 'h', texto: 'Quanto alocar' },
      {
        t: 'p',
        texto:
          'Não existe número certo. As referências que circulam vão de 10% a 30% da carteira de renda variável, e a decisão depende de duas coisas concretas: **em que moeda estão seus objetivos** e **quanto de oscilação cambial você aguenta**.',
      },
      {
        t: 'lista',
        itens: [
          'Quem pretende estudar ou morar fora tem despesas futuras em moeda forte — a exposição deixa de ser diversificação e vira casamento de moeda com a despesa.',
          'Quem tem todos os objetivos em reais usa a exposição só como proteção, e um percentual menor cumpre o papel.',
        ],
      },
      {
        t: 'alerta',
        titulo: 'Câmbio corta nos dois sentidos',
        texto:
          'A mesma alta do dólar que salva sua carteira num ano ruim vira prejuízo relativo quando o real se valoriza. Se você entrar na posição em busca do ganho cambial, vai sair dela na primeira valorização do real — e aí a proteção não existiu. A alocação internacional é estrutural, não é um trade.',
      },
      {
        t: 'alerta',
        titulo: 'Hedge cambial faz o oposto do que muita gente quer',
        texto:
          'Alguns ETFs têm versão "com hedge", que anula o efeito do câmbio. Isso é útil para quem quer só a exposição às empresas. Mas se o seu objetivo era proteger o patrimônio contra a desvalorização do real, o hedge remove exatamente a parte que você foi buscar. Leia o nome do produto com atenção.',
      },
      {
        t: 'noapp',
        aba: 'Meus investimentos',
        texto:
          'Cadastre ETFs e BDRs normalmente em renda variável. Eles entram no patrimônio e na distribuição da carteira como qualquer outro ativo.',
      },
      {
        t: 'noapp',
        aba: 'Meu patrimônio',
        texto:
          'Com a posição internacional registrada, a visão consolidada mostra quanto do seu patrimônio depende de uma moeda só. É a resposta visual para "estou concentrado demais no Brasil?".',
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  m8: {
    tempo: 12,
    resumo:
      'Liberdade financeira é um número, não uma sensação. E o número é mais alcançável do que parece quando você o calcula.',
    blocos: [
      {
        t: 'ideia',
        texto:
          'Você não precisa de dinheiro para sempre. Precisa de um patrimônio que gere sua renda sem ser consumido.',
      },
      { t: 'h', texto: 'O número' },
      {
        t: 'p',
        texto:
          'A referência mais conhecida é a **regra dos 4%**: um patrimônio bem diversificado suporta retiradas anuais de cerca de 4% do valor inicial, corrigidas pela inflação, sem acabar ao longo de décadas. A conta inversa é o que interessa: **seu custo anual dividido por 0,04**, ou o custo mensal vezes 300.',
      },
      {
        t: 'conta',
        titulo: 'Do custo de vida ao patrimônio-alvo (supondo 8% a.a. acima da inflação)',
        linhas: [
          ['Custo de vida mensal desejado', 'R$ 8.000'],
          ['× 12 = custo anual', 'R$ 96.000'],
          ['÷ 0,04 = patrimônio-alvo', 'R$ 2.400.000', 1],
          ['Aportando R$ 2.500/mês', '~26 anos'],
          ['Aportando R$ 4.000/mês', '~21 anos'],
        ],
        nota: 'A regra nasceu do mercado americano e assume uma carteira diversificada e décadas de horizonte. Trate-a como ordem de grandeza, não como garantia — e refaça a conta a cada mudança grande de vida.',
      },
      {
        t: 'p',
        texto:
          'Repare no que a tabela mostra: aumentar o aporte em 60% encurtou o caminho em cinco anos, não em metade. **Cortar o custo de vida alvo tem efeito maior que aumentar o aporte**, porque mexe no numerador e no denominador ao mesmo tempo — reduz o alvo e sobra mais para aportar.',
      },
      { t: 'h', texto: 'Previdência privada: PGBL ou VGBL' },
      {
        t: 'p',
        texto:
          'A escolha entre os dois não é sobre rentabilidade — os dois investem em fundos parecidos. É sobre **onde o imposto incide**:',
      },
      {
        t: 'lista',
        itens: [
          '**PGBL** — permite abater as contribuições da base do IR, até um limite percentual da renda bruta tributável, e só faz sentido para quem **declara no modelo completo** e tem renda tributável. Em compensação, no resgate o imposto incide sobre o **valor total**, não só sobre o rendimento.',
          '**VGBL** — sem dedução na declaração, mas no resgate o imposto incide **apenas sobre o rendimento**. É o indicado para quem declara no simplificado, é isento, ou já usou todo o limite de dedução no PGBL.',
        ],
      },
      {
        t: 'alerta',
        titulo: 'PGBL para quem declara no simplificado é prejuízo',
        texto:
          'Sem a dedução, você fica só com a desvantagem: imposto sobre o valor total no resgate, em vez de só sobre o ganho. É um dos erros de produto mais caros e mais frequentes — e costuma ser vendido exatamente para quem não deveria ter.',
      },
      {
        t: 'chave',
        termo: 'Tabela regressiva x progressiva',
        texto:
          'Na regressiva, a alíquota cai conforme o tempo de cada aporte, chegando à faixa mais baixa depois de cerca de dez anos — é a escolha natural de quem vai carregar por décadas. Na progressiva, o resgate entra na tabela normal do IR. Para acumulação longa, a regressiva costuma vencer.',
      },
      {
        t: 'chave',
        termo: 'Come-cotas',
        texto:
          'Antecipação semestral de imposto que reduz a quantidade de cotas em muitos fundos abertos. Planos de previdência **não** têm come-cotas, e é uma das vantagens reais do produto: o imposto só aparece no resgate, então o valor cheio continua rendendo o tempo todo.',
      },
      { t: 'h', texto: 'A fase de retirada' },
      {
        t: 'p',
        texto:
          'Acumular e viver de renda pedem carteiras diferentes. Na acumulação, oscilação é aceitável porque o tempo conserta. Na retirada, ela é perigosa: sacar durante uma queda vende mais cotas pelo mesmo dinheiro e reduz o patrimônio que sustenta os anos seguintes.',
      },
      {
        t: 'lista',
        itens: [
          'Chegue perto do objetivo com mais renda fixa do que você teve na acumulação.',
          'Mantenha de dois a três anos de despesas em ativos de baixa oscilação — é a mesma lógica da reserva de emergência, agora aplicada à aposentadoria.',
          'Sistematize a retirada: um percentual fixo revisado uma vez por ano é melhor que sacar por impulso quando a conta aperta.',
        ],
      },
      {
        t: 'alerta',
        titulo: 'A sucessão é parte do plano',
        texto:
          'Previdência costuma ter regras próprias de transmissão, diferentes das de uma carteira comum, e definir beneficiários é parte de montar o produto — não um detalhe para depois. Vale conversar com um profissional quando o patrimônio começa a ficar relevante.',
      },
      {
        t: 'noapp',
        aba: 'Simule sua liberdade',
        texto:
          'Coloque seu custo de vida alvo e o aporte mensal. A simulação mostra o patrimônio ao longo do tempo e a renda passiva que ele gera — e deixa claro qual variável, no seu caso, encurta mais o caminho.',
      },
      {
        t: 'noapp',
        aba: 'Meus investimentos → Previdência',
        texto:
          'Cadastre o plano com a taxa mensal para acompanhar o saldo evoluindo junto do resto do patrimônio. Previdência esquecida numa seguradora rende mal por anos sem ninguém perceber.',
      },
    ],
  },
};
