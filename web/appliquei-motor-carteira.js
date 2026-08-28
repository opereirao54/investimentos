/**
 * Appliquei — MOTOR DA CARTEIRA RECOMENDADA.
 *
 * Classic script SEM DOM: só matemática e tabelas de critério. Carregado
 * ANTES de appliquei-aba-carteira-recomendada.js, que é quem desenha a tela
 * e chama estas funções. A separação é de propósito — o motor precisa rodar
 * em `node --test` sem browser (ver test/motor-carteira.test.js), e cálculo
 * de score misturado com innerHTML não dá para testar.
 *
 * O que este arquivo resolve, na ordem em que a tela usa:
 *   1. motorScoreAtivo()          — nota 0-100 de UM ativo, por pilar.
 *   2. motorRanquear()            — ordena um universo de ativos.
 *   3. motorDistribuicaoClasses() — quanto vai para RF/ações/FIIs/cripto.
 *   4. motorPlanoAporte()         — quais ativos comprar e quantas cotas.
 *
 * Sobre as "lentes" (MOTOR_LENTES): são vetores de peso sobre os cinco
 * pilares, não carteiras de terceiros. A ideia é traduzir princípios de
 * análise que circulam publicamente (priorizar dividendos e setores
 * perenes; priorizar qualidade e crescimento; priorizar preço de entrada)
 * em números auditáveis. Nenhuma lente reproduz recomendação de casa de
 * análise nem tem endosso de quem quer que seja — quem escolhe os ativos do
 * universo continua sendo a carteira modelo publicada no painel.
 *
 * Top-level só com `var`/`function`: classic script compartilha estado via
 * window (ver test/classic-scripts-globals.test.js).
 */

// ════════════════════════════════════════════════════════════
// 1. NORMALIZAÇÃO — de indicador bruto para nota 0-10
// ════════════════════════════════════════════════════════════

/**
 * Interpola o valor numa curva de pontos [[valor, nota], ...] ordenada por
 * valor crescente. Satura nas pontas.
 *
 * Uma curva só cobre os três formatos de que precisamos:
 *   - "menor é melhor"  → notas decrescentes (P/L, dívida)
 *   - "maior é melhor"  → notas crescentes  (ROE, liquidez)
 *   - "faixa ideal"     → sobe e depois desce (payout, DY)
 *
 * O terceiro caso é o motivo de não usar min/max simples: DY de 25% quase
 * nunca é bom sinal — costuma ser dividendo extraordinário ou preço em
 * queda livre —, e uma régua monotônica premiaria justamente esse ativo.
 */
function motorInterpolar(valor, pontos) {
  if (!Array.isArray(pontos) || pontos.length === 0) return null;
  if (typeof valor !== 'number' || !isFinite(valor)) return null;
  if (valor <= pontos[0][0]) return pontos[0][1];
  var ultimo = pontos[pontos.length - 1];
  if (valor >= ultimo[0]) return ultimo[1];
  for (var i = 1; i < pontos.length; i++) {
    var a = pontos[i - 1];
    var b = pontos[i];
    if (valor <= b[0]) {
      var span = b[0] - a[0];
      if (span === 0) return b[1];
      return a[1] + ((valor - a[0]) / span) * (b[1] - a[1]);
    }
  }
  return ultimo[1];
}

function motorClamp(v, min, max) {
  if (typeof v !== 'number' || !isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function motorArred(v, casas) {
  var f = Math.pow(10, casas || 0);
  return Math.round(v * f) / f;
}

/** Nota de uma métrica isolada. Devolve null quando não há dado. */
function motorNotaMetrica(metrica, valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  var num = typeof valor === 'number' ? valor : parseFloat(valor);
  if (!isFinite(num)) return null;
  // Indicador que só faz sentido positivo (P/L, P/VP): valor <= 0 significa
  // prejuízo ou PL negativo. Interpolar aqui daria nota alta ao pior caso.
  if (metrica.exigePositivo && num <= 0) {
    return { nota: metrica.notaSeNegativo != null ? metrica.notaSeNegativo : 1, invalido: true };
  }
  var nota = motorInterpolar(num, metrica.pontos);
  if (nota === null) return null;
  return { nota: motorClamp(nota, 0, 10), invalido: false };
}

// ════════════════════════════════════════════════════════════
// 2. CRITÉRIOS OBJETIVOS POR CLASSE
// ════════════════════════════════════════════════════════════
//
// Cada métrica tem `id` (a chave esperada no objeto de fundamentos), `peso`
// dentro do pilar e a curva `pontos`. As faixas são calibradas para o
// mercado brasileiro — P/L 10 é barato aqui e caro em bolsa madura, DY de
// 8% é normal na B3 e seria anomalia lá fora.

var MOTOR_PILARES = ['valuation', 'dividendos', 'crescimento', 'endividamento', 'qualidade'];

// Abaixo desta cobertura o motor NÃO devolve score.
//
// Não é preciosismo: com os indicadores em falta, o score de todo o universo
// converge para o mesmo número e o ranking passa a ser decidido pelo
// desempate alfabético do ticker. Exibir "25/100" nesse estado é pior do que
// não exibir nada — na tela, 25 lê-se como veredito sobre o ativo, quando na
// verdade é um veredito sobre os nossos dados. Sem lastro, a resposta certa
// é dizer o que falta.
var MOTOR_COBERTURA_MINIMA = 0.3;

var MOTOR_PILAR_NOMES = {
  valuation: 'Valuation',
  dividendos: 'Dividendos',
  crescimento: 'Crescimento',
  endividamento: 'Endividamento',
  qualidade: 'Qualidade',
};

// Mesmos pilares, rótulo curto. Existe para a barra de cinco colunas do card:
// num ecrã de 360px cada coluna tem ~55px, e 'Endividamento' mede 75 — era ele
// que impedia o card de encolher e punha a página a rolar para o lado. O nome
// completo continua no `title` de cada pilar e na secção de critérios.
var MOTOR_PILAR_NOMES_CURTOS = {
  valuation: 'Valuation',
  dividendos: 'Dividendo',
  crescimento: 'Cresc.',
  endividamento: 'Dívida',
  qualidade: 'Qualidade',
};

var MOTOR_CRITERIOS = {
  acao: {
    valuation: [
      {
        id: 'pl',
        nome: 'P/L',
        peso: 3,
        unidade: 'x',
        exigePositivo: true,
        notaSeNegativo: 1,
        pontos: [
          [3, 10],
          [6, 9.5],
          [10, 8],
          [15, 6],
          [20, 4.5],
          [30, 2.5],
          [50, 1],
        ],
      },
      {
        id: 'pvp',
        nome: 'P/VP',
        peso: 2,
        unidade: 'x',
        exigePositivo: true,
        notaSeNegativo: 0.5,
        pontos: [
          [0.5, 10],
          [1, 8.5],
          [1.5, 7],
          [2.5, 5],
          [4, 3],
          [8, 1],
        ],
      },
      {
        id: 'evEbitda',
        nome: 'EV/EBITDA',
        peso: 2,
        unidade: 'x',
        exigePositivo: true,
        notaSeNegativo: 1,
        pontos: [
          [3, 10],
          [6, 8.5],
          [9, 7],
          [12, 5],
          [18, 3],
          [25, 1],
        ],
      },
    ],
    dividendos: [
      {
        id: 'dy',
        nome: 'Dividend Yield (12m)',
        peso: 3,
        unidade: '%',
        pontos: [
          [0, 0],
          [2, 3],
          [4, 5.5],
          [6, 7.5],
          [8, 9],
          [12, 10],
          [18, 7],
          [30, 4],
        ],
      },
      {
        id: 'dyMedio5a',
        nome: 'DY médio (5 anos)',
        peso: 3,
        unidade: '%',
        pontos: [
          [0, 0],
          [2, 3],
          [4, 6],
          [6, 8],
          [9, 10],
          [14, 8],
        ],
      },
      {
        id: 'payout',
        nome: 'Payout',
        peso: 2,
        unidade: '%',
        pontos: [
          [0, 2],
          [20, 6],
          [35, 9],
          [60, 10],
          [80, 7],
          [100, 4],
          [130, 1],
        ],
      },
      {
        id: 'anosPagandoDividendo',
        nome: 'Anos pagando sem interromper',
        peso: 2,
        unidade: 'anos',
        pontos: [
          [0, 0],
          [2, 3],
          [5, 6],
          [10, 8.5],
          [20, 10],
        ],
      },
    ],
    crescimento: [
      {
        id: 'cagrReceita5a',
        nome: 'CAGR da receita (5 anos)',
        peso: 3,
        unidade: '%',
        pontos: [
          [-10, 0],
          [0, 3],
          [5, 5.5],
          [10, 7.5],
          [15, 9],
          [25, 10],
        ],
      },
      {
        id: 'cagrLucro5a',
        nome: 'CAGR do lucro (5 anos)',
        peso: 3,
        unidade: '%',
        pontos: [
          [-15, 0],
          [0, 3],
          [8, 6],
          [15, 8],
          [25, 10],
        ],
      },
      {
        id: 'crescimentoReceitaAno',
        nome: 'Crescimento da receita (12m)',
        peso: 1,
        unidade: '%',
        pontos: [
          [-15, 0],
          [0, 4],
          [8, 6.5],
          [18, 9],
          [30, 10],
        ],
      },
    ],
    endividamento: [
      {
        id: 'dividaLiquidaEbitda',
        nome: 'Dívida líquida / EBITDA',
        peso: 3,
        unidade: 'x',
        pontos: [
          [-1, 10],
          [0, 9.5],
          [1, 8.5],
          [2, 7],
          [3, 5],
          [4, 3],
          [6, 1],
        ],
      },
      {
        id: 'dividaLiquidaPl',
        nome: 'Dívida líquida / Patrimônio',
        peso: 2,
        unidade: 'x',
        pontos: [
          [-0.5, 10],
          [0, 9],
          [0.5, 7.5],
          [1, 6],
          [2, 3.5],
          [3, 1.5],
        ],
      },
      {
        id: 'liquidezCorrente',
        nome: 'Liquidez corrente',
        peso: 2,
        unidade: 'x',
        pontos: [
          [0.5, 1],
          [1, 4],
          [1.5, 7],
          [2, 9],
          [3, 10],
        ],
      },
    ],
    qualidade: [
      {
        id: 'roe',
        nome: 'ROE',
        peso: 3,
        unidade: '%',
        pontos: [
          [-5, 0],
          [0, 1],
          [8, 4],
          [12, 6],
          [18, 8],
          [25, 10],
          [60, 8],
        ],
      },
      {
        id: 'roic',
        nome: 'ROIC',
        peso: 2,
        unidade: '%',
        pontos: [
          [-5, 0],
          [0, 1],
          [6, 4],
          [10, 6.5],
          [15, 8.5],
          [22, 10],
        ],
      },
      {
        id: 'margemLiquida',
        nome: 'Margem líquida',
        peso: 2,
        unidade: '%',
        pontos: [
          [-10, 0],
          [0, 1],
          [5, 4],
          [10, 6],
          [18, 8],
          [30, 10],
        ],
      },
      {
        id: 'liquidezDiaria',
        nome: 'Liquidez diária',
        peso: 2,
        unidade: 'R$',
        pontos: [
          [0, 0],
          [500000, 3],
          [2000000, 6],
          [10000000, 8.5],
          [50000000, 10],
        ],
      },
    ],
  },

  fii: {
    valuation: [
      {
        id: 'pvp',
        nome: 'P/VP',
        peso: 4,
        unidade: 'x',
        exigePositivo: true,
        notaSeNegativo: 0.5,
        pontos: [
          [0.6, 10],
          [0.8, 9],
          [0.95, 8],
          [1.05, 6.5],
          [1.2, 4.5],
          [1.5, 2],
          [2, 0.5],
        ],
      },
    ],
    dividendos: [
      {
        id: 'dy',
        nome: 'Dividend Yield (12m)',
        peso: 3,
        unidade: '%',
        pontos: [
          [0, 0],
          [4, 3],
          [7, 6],
          [9, 8],
          [11, 9.5],
          [14, 10],
          [20, 6],
        ],
      },
      {
        id: 'dyMedio36m',
        nome: 'DY médio (36 meses)',
        peso: 3,
        unidade: '%',
        pontos: [
          [0, 0],
          [4, 3],
          [7, 6.5],
          [9.5, 9],
          [12, 10],
          [18, 7],
        ],
      },
      {
        id: 'consistenciaDividendos',
        nome: 'Meses pagando (24m)',
        peso: 2,
        unidade: '%',
        pontos: [
          [0, 0],
          [50, 3],
          [80, 7],
          [95, 9.5],
          [100, 10],
        ],
      },
    ],
    crescimento: [
      {
        id: 'crescimentoDividendo12m',
        nome: 'Crescimento do dividendo (12m)',
        peso: 3,
        unidade: '%',
        pontos: [
          [-20, 0],
          [-5, 3],
          [0, 5],
          [5, 7.5],
          [12, 9.5],
          [25, 10],
        ],
      },
      {
        id: 'ocupacao',
        nome: 'Taxa de ocupação',
        peso: 2,
        unidade: '%',
        pontos: [
          [70, 1],
          [85, 5],
          [92, 7.5],
          [96, 9],
          [99, 10],
        ],
      },
    ],
    endividamento: [
      {
        id: 'alavancagem',
        nome: 'Alavancagem / LTV',
        peso: 4,
        unidade: '%',
        pontos: [
          [0, 10],
          [10, 9],
          [20, 7.5],
          [30, 6],
          [45, 3.5],
          [60, 1],
        ],
      },
    ],
    qualidade: [
      {
        id: 'liquidezDiaria',
        nome: 'Liquidez diária',
        peso: 3,
        unidade: 'R$',
        pontos: [
          [0, 0],
          [200000, 3],
          [1000000, 6.5],
          [5000000, 9],
          [20000000, 10],
        ],
      },
      {
        id: 'patrimonioLiquido',
        nome: 'Patrimônio líquido',
        peso: 2,
        unidade: 'R$',
        pontos: [
          [0, 0],
          [100000000, 3],
          [500000000, 6.5],
          [2000000000, 9],
          [8000000000, 10],
        ],
      },
      {
        id: 'numeroCotistas',
        nome: 'Número de cotistas',
        peso: 2,
        unidade: '',
        pontos: [
          [0, 0],
          [5000, 3],
          [30000, 6.5],
          [100000, 9],
          [400000, 10],
        ],
      },
      {
        id: 'numeroImoveis',
        nome: 'Imóveis na carteira',
        peso: 2,
        unidade: '',
        pontos: [
          [1, 2],
          [3, 5],
          [6, 7],
          [12, 9],
          [25, 10],
        ],
      },
    ],
  },

  // Fundo de PAPEL (CRI, recebíveis). Não é uma classe à parte para efeito
  // de alocação — continua sendo FII na carteira —, mas os critérios são
  // outros: cobrar taxa de ocupação e número de imóveis de quem não tem
  // imóvel é o mesmo erro que cobrar EBITDA de banco. O indicador não está
  // ausente, ele não se aplica, e tratá-lo como ausente derruba a cobertura
  // e aciona o encolhimento do score contra um fundo sem defeito nenhum.
  //
  // O que muda em relação ao tijolo é SÓ a remoção do que não se aplica.
  // Valuation, dividendos e o crescimento do dividendo são os mesmos — um
  // fundo de papel distribui rendimento como qualquer outro, e é isso que
  // o cotista recebe.
  fiiPapel: {
    valuation: [
      {
        id: 'pvp',
        nome: 'P/VP',
        peso: 4,
        unidade: 'x',
        exigePositivo: true,
        notaSeNegativo: 0.5,
        pontos: [
          [0.6, 10],
          [0.8, 9],
          [0.95, 8],
          [1.05, 6.5],
          [1.2, 4.5],
          [1.5, 2],
          [2, 0.5],
        ],
      },
    ],
    dividendos: [
      {
        id: 'dy',
        nome: 'Dividend Yield (12m)',
        peso: 3,
        unidade: '%',
        pontos: [
          [0, 0],
          [4, 3],
          [7, 6],
          [9, 8],
          [11, 9.5],
          [14, 10],
          [20, 6],
        ],
      },
      {
        id: 'dyMedio36m',
        nome: 'DY médio (36 meses)',
        peso: 3,
        unidade: '%',
        pontos: [
          [0, 0],
          [4, 3],
          [7, 6.5],
          [9.5, 9],
          [12, 10],
          [18, 7],
        ],
      },
      {
        id: 'consistenciaDividendos',
        nome: 'Meses pagando (24m)',
        peso: 2,
        unidade: '%',
        pontos: [
          [0, 0],
          [50, 3],
          [80, 7],
          [95, 9.5],
          [100, 10],
        ],
      },
    ],
    // Sem taxa de ocupação: não há imóvel para ocupar. O crescimento do
    // dividendo carrega o pilar sozinho, e é o indicador certo — mede se o
    // fundo está distribuindo mais por cota do que distribuía.
    crescimento: [
      {
        id: 'crescimentoDividendo12m',
        nome: 'Crescimento do dividendo (12m)',
        peso: 3,
        unidade: '%',
        pontos: [
          [-20, 0],
          [-5, 3],
          [0, 5],
          [5, 7.5],
          [12, 9.5],
          [25, 10],
        ],
      },
    ],
    endividamento: [
      {
        id: 'alavancagem',
        nome: 'Alavancagem / LTV',
        peso: 4,
        unidade: '%',
        pontos: [
          [0, 10],
          [10, 9],
          [20, 7.5],
          [30, 6],
          [45, 3.5],
          [60, 1],
        ],
      },
    ],
    // Sem contagem de imóveis, pelo mesmo motivo.
    qualidade: [
      {
        id: 'liquidezDiaria',
        nome: 'Liquidez diária',
        peso: 3,
        unidade: 'R$',
        pontos: [
          [0, 0],
          [200000, 3],
          [1000000, 6.5],
          [5000000, 9],
          [20000000, 10],
        ],
      },
      {
        id: 'patrimonioLiquido',
        nome: 'Patrimônio líquido',
        peso: 2,
        unidade: 'R$',
        pontos: [
          [0, 0],
          [100000000, 3],
          [500000000, 6.5],
          [2000000000, 9],
          [8000000000, 10],
        ],
      },
      {
        id: 'numeroCotistas',
        nome: 'Número de cotistas',
        peso: 2,
        unidade: '',
        pontos: [
          [0, 0],
          [5000, 3],
          [30000, 6.5],
          [100000, 9],
          [400000, 10],
        ],
      },
    ],
  },

  cripto: {
    // Valuation e dividendos não existem aqui: não há lucro nem distribuição.
    // Os pilares ficam vazios de propósito — motorScoreAtivo redistribui o
    // peso deles entre os que têm dado, em vez de fingir uma nota 5.
    valuation: [],
    dividendos: [],
    crescimento: [
      {
        id: 'retorno12m',
        nome: 'Retorno (12 meses)',
        peso: 3,
        unidade: '%',
        pontos: [
          [-70, 0],
          [-30, 2],
          [0, 5],
          [30, 7],
          [80, 9],
          [200, 10],
        ],
      },
    ],
    endividamento: [],
    qualidade: [
      {
        id: 'marketCap',
        nome: 'Capitalização de mercado',
        peso: 4,
        unidade: 'US$',
        pontos: [
          [100000000, 0],
          [1000000000, 3],
          [10000000000, 6],
          [100000000000, 8.5],
          [500000000000, 10],
        ],
      },
      {
        id: 'volume24h',
        nome: 'Volume 24h',
        peso: 2,
        unidade: 'US$',
        pontos: [
          [1000000, 0],
          [50000000, 4],
          [500000000, 7],
          [5000000000, 10],
        ],
      },
      {
        id: 'anosExistencia',
        nome: 'Anos de existência',
        peso: 3,
        unidade: 'anos',
        pontos: [
          [0, 0],
          [2, 4],
          [5, 7],
          [10, 9.5],
          [15, 10],
        ],
      },
      {
        id: 'volatilidade30d',
        nome: 'Volatilidade (30d)',
        peso: 2,
        unidade: '%',
        pontos: [
          [20, 10],
          [40, 7.5],
          [60, 5],
          [90, 2.5],
          [150, 0],
        ],
      },
    ],
  },

  rf: {
    // Em renda fixa os pilares mudam de significado: "valuation" é o prêmio
    // da taxa contratada, "endividamento" é o risco do emissor. Mantidos com
    // os mesmos cinco nomes para a tela desenhar um card só.
    valuation: [
      {
        id: 'taxaRealAnual',
        nome: 'Taxa real (acima da inflação)',
        peso: 3,
        unidade: '% a.a.',
        pontos: [
          [-2, 0],
          [0, 2],
          [2, 4.5],
          [4, 6.5],
          [6, 8.5],
          [9, 10],
        ],
      },
      {
        id: 'premioSobreCdi',
        nome: 'Prêmio sobre o CDI',
        peso: 2,
        unidade: '% do CDI',
        pontos: [
          [80, 0],
          [95, 4],
          [100, 5.5],
          [110, 8],
          [125, 10],
        ],
      },
    ],
    dividendos: [
      {
        id: 'geraRendaPeriodica',
        nome: 'Paga cupom periódico',
        peso: 2,
        unidade: '',
        pontos: [
          [0, 4],
          [1, 10],
        ],
      },
    ],
    crescimento: [],
    endividamento: [
      {
        id: 'riscoEmissor',
        nome: 'Solidez do emissor',
        peso: 4,
        unidade: '/10',
        pontos: [
          [0, 0],
          [10, 10],
        ],
      },
    ],
    qualidade: [
      {
        id: 'liquidezDias',
        nome: 'Prazo para resgate',
        peso: 3,
        unidade: 'dias',
        pontos: [
          [0, 10],
          [1, 9],
          [30, 7],
          [180, 5],
          [720, 2.5],
          [1800, 1],
        ],
      },
      {
        id: 'isentoIR',
        nome: 'Isenção de IR',
        peso: 2,
        unidade: '',
        pontos: [
          [0, 6],
          [1, 10],
        ],
      },
    ],
  },
};

// ════════════════════════════════════════════════════════════
// 3. LENTES DE ESTRATÉGIA
// ════════════════════════════════════════════════════════════
//
// Peso relativo de cada pilar. A soma não precisa dar 1 — o score normaliza
// pelos pilares que tiveram dado.
//
// `filtros` NÃO excluem o ativo: viram alerta na tela e marcam `elegivel`
// como false, e só o plano de aporte decide se respeita isso. Excluir em
// silêncio esconderia do utilizador que o ativo saiu e por quê.

var MOTOR_LENTES = {
  equilibrio: {
    id: 'equilibrio',
    nome: 'Equilíbrio',
    resumo: 'Pesa os cinco pilares de forma parelha. Serve como referência neutra.',
    principios: [
      'Nenhum pilar decide sozinho.',
      'Bom preço não compensa balanço ruim, e vice-versa.',
    ],
    pesos: { valuation: 1, dividendos: 1, crescimento: 1, endividamento: 1, qualidade: 1 },
    filtros: {},
  },
  renda: {
    id: 'renda',
    nome: 'Renda & Perenidade',
    resumo:
      'Prioriza quem distribui caixa há muito tempo, em setores que sobrevivem a crise, com dívida sob controle.',
    principios: [
      'Dividendo pago com regularidade vale mais que dividendo alto de um ano só.',
      'Setor perene (banco, energia, saneamento, seguro, telecom) reduz o risco de a renda secar.',
      'Payout acima de 100% é dividendo tirado do caixa, não do lucro.',
      'Preço importa, mas menos que a durabilidade do fluxo.',
    ],
    pesos: {
      valuation: 0.8,
      dividendos: 2.2,
      crescimento: 0.5,
      endividamento: 1.5,
      qualidade: 1.3,
    },
    setoresPreferidos: ['banco', 'energia', 'saneamento', 'seguro', 'telecom'],
    bonusSetor: 4,
    filtros: { dyMinimo: 4 },
  },
  qualidade: {
    id: 'qualidade',
    nome: 'Qualidade & Crescimento',
    resumo:
      'Prioriza empresa que cresce com retorno alto sobre o capital e não depende de dívida para isso.',
    principios: [
      'ROE e ROIC altos e constantes indicam vantagem competitiva real.',
      'Crescimento de receita sem crescimento de lucro é volume, não valor.',
      'Empresa boa raramente fica barata — valuation entra como filtro, não como objetivo.',
    ],
    pesos: { valuation: 0.9, dividendos: 0.7, crescimento: 1.8, endividamento: 1.2, qualidade: 2 },
    filtros: { roeMinimo: 10 },
  },
  valor: {
    id: 'valor',
    nome: 'Valor & Margem de Segurança',
    resumo: 'Prioriza preço de entrada baixo com balanço que aguente o tranco.',
    principios: [
      'O retorno começa a ser definido no preço de compra.',
      'Desconto só é oportunidade se a dívida não consumir a empresa antes da reprecificação.',
      'Múltiplo baixo com prejuízo não é barato — é armadilha.',
    ],
    pesos: { valuation: 2.2, dividendos: 1, crescimento: 0.6, endividamento: 1.6, qualidade: 1 },
    filtros: {},
  },
};

// Objetivo declarado no questionário → lente aplicada por padrão.
var MOTOR_LENTE_POR_OBJETIVO = {
  preservar: 'valor',
  renda: 'renda',
  aposentadoria: 'equilibrio',
  aumentar: 'qualidade',
};

// Setores canônicos — a fonte de mercado devolve o nome em inglês ou em
// português conforme o ativo, então normalizamos por palavra-chave em vez de
// igualdade exata.
//
// A ORDEM É SIGNIFICATIVA: ganha o primeiro que casar. Os canons mais
// específicos vêm primeiro porque os genéricos os engoliriam — 'utilit' de
// energia casa com a Utilities de uma empresa de água antes de 'sanea'
// chegar a ser testado.
//
// 'energy' fica em petróleo e 'energia' fica em energia elétrica de
// propósito: são taxonomias diferentes a usar a mesma raiz. Na régua do
// provedor em inglês, Energy é óleo e gás e a elétrica é Utilities; no rótulo
// em português, energia é elétrica. Juntar as duas colocava a Petrobras no
// balde da distribuidora de luz — e, na lente Renda, dava-lhe o bônus de
// setor perene que só as reguladas deviam receber.
var MOTOR_SETOR_MAPA = [
  { canon: 'banco', termos: ['banco', 'bank', 'financ', 'credit'] },
  { canon: 'seguro', termos: ['seguro', 'insur', 'previd'] },
  { canon: 'saneamento', termos: ['saneamento', 'water', 'agua', 'sanea'] },
  { canon: 'petroleo', termos: ['petrol', 'oil', 'gas', 'combustiv', 'energy'] },
  { canon: 'energia', termos: ['energia', 'eletric', 'electric', 'utilit', 'power'] },
  { canon: 'telecom', termos: ['telecom', 'telefon', 'communication'] },
  { canon: 'mineracao', termos: ['miner', 'metal', 'siderurg', 'steel', 'material'] },
  { canon: 'papel', termos: ['papel', 'celulose', 'paper', 'pulp'] },
  { canon: 'quimica', termos: ['quimic', 'chemical', 'petroquim', 'fertiliz'] },
  { canon: 'saude', termos: ['saude', 'health', 'farmac', 'pharma', 'hospital'] },
  { canon: 'construcao', termos: ['constru', 'imobili', 'real estate', 'incorpora'] },
  { canon: 'alimentos', termos: ['aliment', 'food', 'bebida', 'beverage', 'agro'] },
  { canon: 'varejo', termos: ['varej', 'retail', 'consumer', 'comerc', 'consumo'] },
  { canon: 'tecnologia', termos: ['tecnolog', 'technolog', 'software', 'internet'] },
  { canon: 'transporte', termos: ['transport', 'logist', 'aeropor', 'rodovi', 'airline'] },
  { canon: 'educacao', termos: ['educa', 'education', 'ensino'] },
  { canon: 'industria', termos: ['industr', 'machin', 'bens de capital', 'manufact'] },
];

// Canon -> rótulo de tela, em português.
//
// O canon é chave interna ('mineracao'), e o rótulo do provedor é imprestável
// para mostrar: vem 'Basic Materials' num ativo e 'Comércio Varejista' no
// outro, misturando idioma e granularidade na mesma lista. A tela precisa de
// um nome por setor, sempre o mesmo, sempre em português.
//
// Existe porque a ação passou a mostrar o setor a que pertence, como o FII já
// mostrava o seu segmento. Antes ela exibia o BALDE da política, e o balde
// descreve mal o ativo: a Vale aparecia como 'Consumo/Commodities', que é o
// bloco de alocação dela, não o setor dela.
var MOTOR_SETOR_NOMES = {
  banco: 'Bancos e Financeiro',
  seguro: 'Seguros e Previdência',
  saneamento: 'Saneamento',
  petroleo: 'Petróleo e Gás',
  energia: 'Energia Elétrica',
  telecom: 'Telecomunicações',
  mineracao: 'Mineração e Siderurgia',
  papel: 'Papel e Celulose',
  quimica: 'Química e Petroquímica',
  saude: 'Saúde',
  construcao: 'Construção e Imobiliário',
  alimentos: 'Alimentos e Bebidas',
  varejo: 'Varejo e Consumo',
  tecnologia: 'Tecnologia',
  transporte: 'Transporte e Logística',
  educacao: 'Educação',
  industria: 'Indústria',
};

// Segmento do FII -> rótulo de tela. Mesma régua dos setores de ação.
var MOTOR_FII_SEGMENTO_NOMES = {
  papel: 'Papel (recebíveis)',
  logistica: 'Logística',
  shoppings: 'Shoppings',
  imoveis: 'Imóveis (tijolo)',
};

/**
 * Rótulo de setor -> canon do motor.
 *
 * Compara SEM ACENTO. O provedor devolve 'Comércio Varejista' e 'Saúde', e a
 * comparação literal contra 'comerc' e 'saude' falhava nos dois — o ativo caía
 * em 'outros' e, agora que o setor decide alocação, saía inteiro da política
 * de diversificação sem nada na tela a dizer por quê.
 */
function motorNormalizarSetor(setor) {
  if (!setor || typeof setor !== 'string') return null;
  var s = setor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  for (var i = 0; i < MOTOR_SETOR_MAPA.length; i++) {
    var m = MOTOR_SETOR_MAPA[i];
    for (var j = 0; j < m.termos.length; j++) {
      if (s.indexOf(m.termos[j]) !== -1) return m.canon;
    }
  }
  return 'outros';
}

// ════════════════════════════════════════════════════════════
// 3.1 POLÍTICA DE DIVERSIFICAÇÃO SETORIAL
// ════════════════════════════════════════════════════════════
//
// O ranking sozinho concentra. Se as cinco ações mais bem pontuadas do mês
// forem construtoras, o plano compra cinco construtoras — cada uma com nota
// alta e a carteira inteira apostada num único ciclo de crédito e juros. O
// score mede o ATIVO; ele não tem como medir o que a carteira já tem.
//
// Por isso a seleção passa a ter duas perguntas em vez de uma:
//   1. QUANTO vai para cada setor  → esta tabela (política declarada);
//   2. QUEM leva dentro do setor   → o score, como sempre.
//
// `alvo` é a fatia do bloco de renda variável (ações + FIIs) que a política
// reserva ao setor. Os alvos de uma classe são NORMALIZADOS entre si na hora
// de aplicar — a divisão macro entre RF/ações/FIIs/cripto continua saindo do
// perfil, do objetivo e do prazo, e não é esta tabela que a decide. Ou seja:
// dentro de ações, os 20 de Bancos valem 20/50 = 40% do que a classe receber.
//
// Setor sem candidato elegível não trava a classe: o alvo dele é redistribuído
// entre os que têm, e o plano DECLARA que redistribuiu. Silenciar isso faria a
// tela mostrar uma diversificação que não aconteceu.
var MOTOR_SETORES_ALVO = {
  acao: [
    { chave: 'financeiro', nome: 'Bancos/Financeiro', alvo: 20, setores: ['banco', 'seguro'] },
    { chave: 'energia', nome: 'Energia elétrica', alvo: 5, setores: ['energia'] },
    { chave: 'saneamento', nome: 'Saneamento', alvo: 5, setores: ['saneamento'] },
    {
      chave: 'tecindustria',
      nome: 'Tecnologia/Indústria',
      alvo: 10,
      setores: ['tecnologia', 'industria', 'telecom', 'transporte', 'construcao'],
    },
    {
      chave: 'consumo',
      nome: 'Consumo/Commodities',
      alvo: 10,
      setores: [
        'varejo',
        'alimentos',
        'saude',
        'educacao',
        'petroleo',
        'mineracao',
        'papel',
        'quimica',
      ],
    },
    // Balde de quem não cai em nenhum dos declarados: setor que existe e não
    // está no mapa (aeroespacial, hotelaria) ou setor que a fonte não
    // informou. Sem ele esses ativos ficavam FORA do plano — apareciam
    // pontuados na lista e nunca recebiam aporte.
    //
    // O alvo é pequeno e cede o lugar sozinho: setor sem candidato tem o alvo
    // redistribuído entre os outros, então numa carteira em que todo ativo tem
    // setor conhecido este balde não existe e as proporções declaradas saem
    // exatas. Ele só dilui quando há mesmo alguém para pôr nele — que é
    // precisamente quando se quer que ele exista.
    { chave: 'outros', nome: 'Outros setores', alvo: 5, setores: ['*'] },
  ],
  fii: [
    { chave: 'papel', nome: 'Papel', alvo: 10, segmentos: ['papel'] },
    { chave: 'logistica', nome: 'Logística', alvo: 10, segmentos: ['logistica'] },
    { chave: 'shoppings', nome: 'Shoppings', alvo: 10, segmentos: ['shoppings'] },
    { chave: 'imoveis', nome: 'Imóveis', alvo: 20, segmentos: ['imoveis'] },
    { chave: 'outros', nome: 'Outros segmentos', alvo: 5, segmentos: ['*'] },
  ],
};

// Segmento do FII por palavra no nome. É reserva, não a fonte principal: a
// CVM publica a carteira do fundo e é ela que separa papel de tijolo
// (`tipoFii`, ver scripts/lib/cvm-parser.js). O nome só entra depois, e só
// para dividir o tijolo entre logística, shopping e o resto — essa quebra
// não existe em nenhum campo do informe.
var MOTOR_FII_SEGMENTO_MAPA = [
  { canon: 'logistica', re: /logist|galp|industrial|\blog\b/ },
  { canon: 'shoppings', re: /shopping|mall|outlet/ },
  { canon: 'papel', re: /papel|recebiv|credito|high grade|\bcri\b/ },
];

/**
 * Segmento de um FII: papel, logística, shoppings ou imóveis.
 *
 * A ordem das provas é deliberada. `tipoFii` vem do balanço publicado — a
 * fatia da carteira em imóvel — e por isso decide primeiro: um fundo de
 * recebíveis chamado "Renda Logística" continua sendo de papel. O nome só
 * fala depois, e apenas sobre o tijolo, onde não há campo nenhum a
 * consultar.
 *
 * `imoveis` é o destino do tijolo que o nome não classifica (laje
 * corporativa, agência bancária, híbrido) — não é um balde de sobras: é o
 * segmento mais genérico e o de maior alvo, justamente por isso.
 */
function motorSegmentoFii(dados) {
  var d = dados || {};
  if (d.tipoFii === 'papel') return 'papel';
  var n = String(d.nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  for (var i = 0; i < MOTOR_FII_SEGMENTO_MAPA.length; i++) {
    var m = MOTOR_FII_SEGMENTO_MAPA[i];
    if (!m.re.test(n)) continue;
    // Fundo declarado de tijolo pela CVM não vira papel por causa do nome:
    // aí a evidência do balanço vence a palavra.
    if (m.canon === 'papel' && d.tipoFii === 'tijolo') continue;
    return m.canon;
  }
  if (d.tipoFii === 'tijolo') return 'imoveis';
  // Sem informe e sem palavra no nome, o fundo continua sendo um fundo de
  // imóveis — é o que a classe é. Devolver null aqui mandaria para fora da
  // política todo FII que a ingestão ainda não alcançou.
  return 'imoveis';
}

/**
 * Balde da política a que um ativo pertence, ou null quando não há como
 * dizer.
 *
 * Null NÃO é "outros": é a ausência da informação. Ação sem setor acontece
 * quando a fonte de mercado degrada para cotação simples, e nesse estado a
 * política inteira não pode ser aplicada — quem trata isso é
 * motorPesosPorSetor, caindo de volta para a seleção por score e dizendo
 * que caiu.
 */
function motorBucketSetor(ativo, buckets) {
  if (!ativo || !buckets || !buckets.length) return null;
  var classe = ativo.classe;
  var i, j;
  // '*' é o balde curinga: recebe quem não casou com nenhum declarado. Ele é
  // procurado DEPOIS de todos, e só uma vez, para não engolir um ativo que
  // tinha balde próprio.
  function curinga() {
    for (var k = 0; k < buckets.length; k++) {
      var campo = classe === 'fii' ? buckets[k].segmentos : buckets[k].setores;
      if (campo && campo.indexOf('*') !== -1) return buckets[k].chave;
    }
    return null;
  }

  if (classe === 'fii') {
    var seg = ativo.segmentoFii || motorSegmentoFii(ativo);
    for (i = 0; i < buckets.length; i++) {
      var segs = buckets[i].segmentos || [];
      for (j = 0; j < segs.length; j++)
        if (segs[j] === seg && segs[j] !== '*') return buckets[i].chave;
    }
    return curinga();
  }
  var canon = ativo.setorCanon || motorNormalizarSetor(ativo.setor);
  // 'outros' é o que motorNormalizarSetor devolve para um setor que EXISTE e
  // não está no mapa; null é setor que a fonte não informou. Nos dois casos
  // não dá para escolher um balde declarado sem inventar — e colocá-lo no
  // maior deles distorceria justamente o mais pesado. Vão para o curinga.
  if (!canon || canon === 'outros') return curinga();
  for (i = 0; i < buckets.length; i++) {
    var lista = buckets[i].setores || [];
    for (j = 0; j < lista.length; j++)
      if (lista[j] === canon && lista[j] !== '*') return buckets[i].chave;
  }
  return curinga();
}

// ════════════════════════════════════════════════════════════
// 4. SCORE DE UM ATIVO
// ════════════════════════════════════════════════════════════

/** Classe macro do motor: só existem rf, acao, fii e cripto. ETF e BDR entram como ação. */
/**
 * Critérios a aplicar — a classe decide, e dentro do FII o TIPO de carteira
 * decide de novo.
 *
 * Fundo de papel não tem imóvel: taxa de ocupação e contagem de imóveis não
 * estão ausentes nele, elas não se aplicam. Cobrá-las derruba a cobertura e
 * aciona o encolhimento do score contra um fundo sem defeito nenhum — o
 * mesmo erro que cobrar EBITDA de um banco.
 *
 * A alocação continua vendo uma classe só: o fundo de papel é FII na
 * carteira. O que muda é apenas a régua com que ele é medido.
 */
function motorCriteriosDe(classe, dados) {
  if (classe === 'fii' && dados && dados.tipoFii === 'papel') {
    return MOTOR_CRITERIOS.fiiPapel;
  }
  return MOTOR_CRITERIOS[classe] || MOTOR_CRITERIOS.acao;
}

function motorInferirClasse(ticker, nome, dica) {
  if (dica === 'etf' || dica === 'bdr') return 'acao';
  // `fiiPapel` é um conjunto de CRITÉRIOS, não uma classe de alocação: o
  // fundo de papel continua sendo FII na carteira. Sem esta guarda ele
  // viraria uma quinta classe e sumiria da distribuição do aporte, que
  // percorre MOTOR_CLASSES.
  if (dica === 'fiiPapel') return 'fii';
  if (dica && MOTOR_CLASSES.indexOf(dica) !== -1) return dica;
  var t = String(ticker || '').toUpperCase();
  var n = String(nome || '').toLowerCase();
  if (['BTC', 'ETH', 'SOL', 'ADA', 'BNB', 'XRP', 'DOT', 'AVAX', 'LINK', 'MATIC'].indexOf(t) !== -1)
    return 'cripto';
  if (
    t.indexOf('TESOURO') === 0 ||
    n.indexOf('tesouro') !== -1 ||
    n.indexOf('cdb') !== -1 ||
    n.indexOf('lci') !== -1 ||
    n.indexOf('lca') !== -1 ||
    n.indexOf('debentur') !== -1 ||
    n.indexOf('renda fixa') !== -1
  )
    return 'rf';
  // FII na B3 termina em 11 — mas 11 também é sufixo de UNIT (SANB11, TAEE11,
  // ENGI11, KLBN11, BPAC11, ALUP11, SAPR11, IGTI11) e de ETF (BOVA11). O nome
  // desempata; sem nome, o sufixo decide.
  //
  // A ordem é o conserto: evidência POSITIVA de fundo primeiro, unit depois,
  // e só então o sufixo. E o teste de unit procurava 'unit' — a B3 escreve
  // **UNT**. Nenhuma unit casava, TODAS entravam como FII, e o efeito medido
  // na tela foi a aba de FIIs com um item só: o SANB11, com critérios de
  // fundo imobiliário aplicados a um banco. Pior, ocupar a classe impedia o
  // resgate para a carteira modelo, que teria trazido os FIIs de verdade.
  if (/^[A-Z]{4}11$/.test(t)) {
    if (n.indexOf('etf') !== -1 || n.indexOf('index') !== -1 || n.indexOf('ishares') !== -1)
      return 'acao';
    // Fundo que se declara fundo vence qualquer outra pista.
    if (/fii|imobiliar|fdo\s*inv|fundo de investimento/.test(n)) return 'fii';
    if (/unt\b/.test(n) || n.indexOf('unit') !== -1) return 'acao';
    return 'fii';
  }
  return 'acao';
}

/** Nota agregada de um pilar. `null` quando nenhuma métrica tinha dado. */
function motorNotaPilar(metricas, dados) {
  var somaNota = 0;
  var pesoComDado = 0;
  var pesoTotal = 0;
  var detalhes = [];
  for (var i = 0; i < metricas.length; i++) {
    var m = metricas[i];
    pesoTotal += m.peso;
    var r = motorNotaMetrica(m, dados[m.id]);
    var valor = dados[m.id];
    if (r === null) {
      detalhes.push({
        id: m.id,
        nome: m.nome,
        unidade: m.unidade || '',
        valor: null,
        nota: null,
        peso: m.peso,
      });
      continue;
    }
    somaNota += r.nota * m.peso;
    pesoComDado += m.peso;
    detalhes.push({
      id: m.id,
      nome: m.nome,
      unidade: m.unidade || '',
      valor: typeof valor === 'number' ? valor : parseFloat(valor),
      nota: motorArred(r.nota, 2),
      peso: m.peso,
      invalido: !!r.invalido,
    });
  }
  return {
    nota: pesoComDado > 0 ? somaNota / pesoComDado : null,
    cobertura: pesoTotal > 0 ? pesoComDado / pesoTotal : 0,
    aplicavel: pesoTotal > 0,
    metricas: detalhes,
  };
}

/**
 * Alertas de leitura — o que um humano diria olhando os números. Ficam
 * visíveis na tela junto do score porque um 82 com "payout acima de 100%"
 * merece uma segunda olhada, e a nota sozinha não conta isso.
 */
function motorAlertas(classe, dados) {
  var out = [];
  if (classe === 'acao') {
    if (typeof dados.payout === 'number' && dados.payout > 100)
      out.push('Payout acima de 100%: distribuiu mais do que lucrou no período.');
    if (typeof dados.dividaLiquidaEbitda === 'number' && dados.dividaLiquidaEbitda > 3.5)
      out.push('Dívida líquida acima de 3,5× o EBITDA.');
    if (typeof dados.pl === 'number' && dados.pl <= 0)
      out.push('Resultado negativo no período — múltiplo de lucro não se aplica.');
    if (typeof dados.roe === 'number' && dados.roe < 0) out.push('ROE negativo.');
    if (typeof dados.liquidezDiaria === 'number' && dados.liquidezDiaria < 500000)
      out.push('Liquidez diária baixa: pode ser difícil sair da posição.');
  } else if (classe === 'fii') {
    if (typeof dados.alavancagem === 'number' && dados.alavancagem > 40)
      out.push('Alavancagem acima de 40% do patrimônio.');
    if (typeof dados.ocupacao === 'number' && dados.ocupacao < 85)
      out.push('Vacância acima de 15%.');
    if (typeof dados.pvp === 'number' && dados.pvp > 1.3)
      out.push('Negociando com ágio relevante sobre o patrimônio.');
  } else if (classe === 'cripto') {
    if (typeof dados.volatilidade30d === 'number' && dados.volatilidade30d > 100)
      out.push('Volatilidade extrema nos últimos 30 dias.');
  } else if (classe === 'rf') {
    if (typeof dados.taxaRealAnual === 'number' && dados.taxaRealAnual < 0)
      out.push('Taxa contratada abaixo da inflação esperada — perde poder de compra.');
    if (typeof dados.riscoEmissor === 'number' && dados.riscoEmissor < 5)
      out.push('Emissor de risco elevado — confira cobertura do FGC.');
  }
  return out;
}

/**
 * Score 0-100 de um ativo sob uma lente.
 *
 * @param {object} dados   ticker, nome, classe, setor + as métricas de MOTOR_CRITERIOS
 * @param {object} opcoes  { lente: 'renda' | objeto de lente }
 */
function motorScoreAtivo(dados, opcoes) {
  var op = opcoes || {};
  var d = dados || {};
  var lente =
    typeof op.lente === 'object' && op.lente
      ? op.lente
      : MOTOR_LENTES[op.lente] || MOTOR_LENTES.equilibrio;
  var classe = motorInferirClasse(d.ticker, d.nome, d.classe);
  var criterios = motorCriteriosDe(classe, d);

  var pilares = {};
  var somaPonderada = 0;
  var somaPesos = 0;
  var covNum = 0;
  var covDen = 0;

  for (var i = 0; i < MOTOR_PILARES.length; i++) {
    var nomePilar = MOTOR_PILARES[i];
    var peso = lente.pesos[nomePilar] != null ? lente.pesos[nomePilar] : 1;
    var res = motorNotaPilar(criterios[nomePilar] || [], d);
    pilares[nomePilar] = {
      chave: nomePilar,
      nome: MOTOR_PILAR_NOMES[nomePilar],
      nota: res.nota === null ? null : motorArred(res.nota, 1),
      peso: peso,
      cobertura: motorArred(res.cobertura, 2),
      aplicavel: res.aplicavel,
      metricas: res.metricas,
    };
    if (res.nota !== null) {
      somaPonderada += res.nota * peso;
      somaPesos += peso;
    }
    // Pilar que não se aplica à classe (dividendo de cripto) não entra na
    // cobertura: faltar dado é diferente de não existir dado.
    if (res.aplicavel) {
      covNum += res.cobertura * peso;
      covDen += peso;
    }
  }

  var cobertura = covDen > 0 ? covNum / covDen : 0;
  var temLastro = somaPesos > 0 && cobertura >= MOTOR_COBERTURA_MINIMA;
  var scoreBruto = somaPesos > 0 ? (somaPonderada / somaPesos) * 10 : null;

  // Encolhimento para a média: um ativo avaliado por duas métricas não pode
  // liderar o ranking em cima de um avaliado por quinze. Puxa o score na
  // direção de 50 conforme a cobertura cai abaixo de 60%. Só se aplica na
  // faixa em que HÁ dado, ainda que parcial — abaixo do mínimo não há score
  // nenhum para encolher.
  var score = null;
  if (temLastro) {
    var penal = motorClamp((0.6 - cobertura) / 0.6, 0, 0.5);
    score = scoreBruto + (50 - scoreBruto) * penal;
  }

  // Bônus setorial: só existe em lente que declara setores preferidos.
  var setorCanon = motorNormalizarSetor(d.setor);
  // Segmento do FII sai aqui, uma vez, e viaja com o ativo: a tela, o plano e
  // a política de setores têm de concordar sobre o que é um fundo de papel.
  //
  // Precedência, e ela importa: o INFORME decide papel × tijolo, porque mede a
  // fatia da carteira em imóvel; um segmento que já venha resolvido (a lista
  // curada do servidor) decide a quebra do tijolo, que o informe não tem; e o
  // nome do fundo é o último recurso. Recalcular sempre pelo nome — que era o
  // que esta linha fazia — deitava fora o segmento curado e punha todo FII sem
  // informe no mesmo balde 'imoveis', apagando a diversificação da classe.
  var segmentoFii = null;
  if (classe === 'fii') {
    segmentoFii = d.tipoFii === 'papel' ? 'papel' : d.segmentoFii || motorSegmentoFii(d);
  }
  var bonus = 0;
  if (
    lente.setoresPreferidos &&
    setorCanon &&
    lente.setoresPreferidos.indexOf(setorCanon) !== -1 &&
    (classe === 'acao' || classe === 'fii')
  ) {
    bonus = lente.bonusSetor || 0;
  }
  if (score !== null) score = motorClamp(score + bonus, 0, 100);

  var alertas = motorAlertas(classe, d);
  var elegivel = true;
  var filtros = lente.filtros || {};
  if (filtros.dyMinimo != null && (classe === 'acao' || classe === 'fii')) {
    if (typeof d.dy === 'number' && d.dy < filtros.dyMinimo) {
      elegivel = false;
      alertas.push(
        'Abaixo do DY mínimo de ' + filtros.dyMinimo + '% exigido pela lente ' + lente.nome + '.'
      );
    }
  }
  if (filtros.roeMinimo != null && classe === 'acao') {
    if (typeof d.roe === 'number' && d.roe < filtros.roeMinimo) {
      elegivel = false;
      alertas.push(
        'ROE abaixo do mínimo de ' + filtros.roeMinimo + '% exigido pela lente ' + lente.nome + '.'
      );
    }
  }

  // Lista, por pilar, os indicadores que faltaram. É o que a tela mostra no
  // lugar do score quando não há lastro: "faltam ROE, dívida e CAGR" é uma
  // resposta acionável; um número baixo não é.
  var faltando = [];
  for (var k = 0; k < MOTOR_PILARES.length; k++) {
    var pil = pilares[MOTOR_PILARES[k]];
    if (!pil.aplicavel) continue;
    var ausentes = pil.metricas
      .filter(function (m) {
        return m.nota === null;
      })
      .map(function (m) {
        return m.nome;
      });
    if (ausentes.length) faltando.push({ pilar: pil.nome, metricas: ausentes });
  }

  var confianca = !temLastro ? 'insuficiente' : cobertura >= 0.6 ? 'alta' : 'media';
  if (confianca === 'insuficiente') {
    alertas.push(
      'Indicadores insuficientes para pontuar este ativo — nenhum score é exibido enquanto o dado não chegar.'
    );
  } else if (confianca === 'media') {
    alertas.push('Score calculado sobre parte dos indicadores — leia junto com a cobertura.');
  }

  return {
    ticker: d.ticker || null,
    nome: d.nome || d.ticker || null,
    classe: classe,
    setor: d.setor || null,
    setorCanon: setorCanon,
    tipoFii: d.tipoFii || null,
    segmentoFii: segmentoFii,
    preco: typeof d.preco === 'number' ? d.preco : null,
    // Procedência: indicador sem fonte e data é opinião. O motor transporta,
    // não interpreta — quem rotula é a fonte, quem desenha é a tela.
    fonte: d.fonte || null,
    fonteRotulo: d.fonteRotulo || null,
    // "Nenhuma fonte respondeu" e "a fonte respondeu sem os campos" produzem
    // a mesma tela sem isto, e têm consertos opostos.
    indisponivel: d.indisponivel === true,
    motivoIndisponivel: d.motivo || null,
    dataReferencia: d.dataReferencia || null,
    atualizadoEm: d.fetchedAtMs || d.atualizadoEm || null,
    score: score === null ? null : motorArred(score, 0),
    scoreExato: score === null ? null : motorArred(score, 2),
    scoreBruto: scoreBruto === null ? null : motorArred(scoreBruto, 2),
    temLastro: temLastro,
    faltando: faltando,
    bonusSetor: bonus,
    pilares: pilares,
    cobertura: motorArred(cobertura, 2),
    confianca: confianca,
    alertas: alertas,
    elegivel: elegivel,
    lente: lente.id || 'custom',
  };
}

/**
 * Aplica motorScoreAtivo a um universo e devolve ordenado por score.
 * Empate cai no ticker para a ordem ser estável entre renders.
 */
function motorRanquear(universo, opcoes) {
  var lista = (universo || []).map(function (a) {
    return motorScoreAtivo(a, opcoes);
  });
  lista.sort(function (a, b) {
    // Ativo sem lastro não compete por posição: vai para o fim em bloco.
    // Subtrair null daria NaN e o sort silenciosamente devolveria a ordem
    // de entrada, que é a pior falha possível num ranking.
    var temA = a.scoreExato !== null;
    var temB = b.scoreExato !== null;
    if (temA !== temB) return temA ? -1 : 1;
    if (temA && b.scoreExato !== a.scoreExato) return b.scoreExato - a.scoreExato;
    return String(a.ticker).localeCompare(String(b.ticker));
  });
  return lista.map(function (item, i) {
    item.posicao = i + 1;
    return item;
  });
}

// ════════════════════════════════════════════════════════════
// 5. DISTRIBUIÇÃO POR CLASSE
// ════════════════════════════════════════════════════════════
//
// A alocação macro sai do perfil, mas perfil sozinho não basta: quem quer
// renda passiva e quem quer crescimento aceitam a mesma volatilidade e
// precisam de carteiras diferentes. Objetivo e prazo entram como ajuste
// (tilt) em cima da base, e os limites do perfil funcionam como cerca — um
// Conservador com prazo de 30 anos ainda não vai para 60% em ações.

var MOTOR_CLASSES = ['rf', 'acao', 'fii', 'cripto'];

var MOTOR_CLASSE_NOMES = { rf: 'Renda Fixa', acao: 'Ações', fii: 'FIIs', cripto: 'Criptos' };

var MOTOR_ALLOC_BASE = {
  Conservador: { rf: 70, acao: 15, fii: 15, cripto: 0 },
  Moderado: { rf: 40, acao: 32, fii: 25, cripto: 3 },
  Arrojado: { rf: 15, acao: 50, fii: 25, cripto: 10 },
};

// Cerca por perfil: [mínimo, máximo] em pontos percentuais.
var MOTOR_LIMITES_PERFIL = {
  Conservador: { rf: [50, 100], acao: [0, 25], fii: [0, 25], cripto: [0, 0] },
  Moderado: { rf: [25, 75], acao: [10, 45], fii: [5, 35], cripto: [0, 5] },
  Arrojado: { rf: [10, 50], acao: [20, 65], fii: [5, 35], cripto: [0, 12] },
};

var MOTOR_TILT_OBJETIVO = {
  preservar: { rf: 10, acao: -5, fii: 0, cripto: -5 },
  renda: { rf: -5, acao: 0, fii: 8, cripto: -3 },
  aposentadoria: { rf: -5, acao: 5, fii: 2, cripto: -2 },
  aumentar: { rf: -10, acao: 7, fii: 0, cripto: 3 },
};

// Prazo manda mais que perfil no curto: dinheiro que vai ser usado em 18
// meses não pode estar em bolsa, por mais arrojado que seja o investidor.
var MOTOR_FAIXAS_PRAZO = [
  {
    id: 'curto',
    nome: 'Até 2 anos',
    ateAnos: 2,
    tilt: { rf: 25, acao: -12, fii: -8, cripto: -5 },
    pisoRf: 60,
  },
  {
    id: 'medio',
    nome: '3 a 5 anos',
    ateAnos: 5,
    tilt: { rf: 8, acao: -4, fii: -2, cripto: -2 },
    pisoRf: 30,
  },
  {
    id: 'longo',
    nome: '6 a 10 anos',
    ateAnos: 10,
    tilt: { rf: 0, acao: 0, fii: 0, cripto: 0 },
    pisoRf: 0,
  },
  {
    id: 'muito_longo',
    nome: 'Mais de 10 anos',
    ateAnos: Infinity,
    tilt: { rf: -8, acao: 6, fii: 2, cripto: 0 },
    pisoRf: 0,
  },
];

function motorFaixaPrazo(anos) {
  var n = typeof anos === 'number' && isFinite(anos) ? anos : 10;
  for (var i = 0; i < MOTOR_FAIXAS_PRAZO.length; i++) {
    if (n <= MOTOR_FAIXAS_PRAZO[i].ateAnos) return MOTOR_FAIXAS_PRAZO[i];
  }
  return MOTOR_FAIXAS_PRAZO[MOTOR_FAIXAS_PRAZO.length - 1];
}

/**
 * Reescala para somar 100 respeitando [min, max] de cada classe.
 *
 * Normalizar e depois cortar volta a quebrar a soma; cortar e depois
 * normalizar volta a estourar o limite. Então itera: reescala, corta, e
 * devolve a sobra só para quem ainda tem folga na direção certa.
 */
function motorNormalizarComLimites(alloc, limites) {
  var out = {};
  var c, i;
  for (i = 0; i < MOTOR_CLASSES.length; i++) {
    c = MOTOR_CLASSES[i];
    out[c] = Math.max(0, Number(alloc[c]) || 0);
  }
  var lim = limites || {};
  function limiteDe(cl) {
    var l = lim[cl] || [0, 100];
    return { min: l[0], max: l[1] };
  }
  // Cerca impossível (soma dos mínimos > 100) não deveria existir nas
  // tabelas, mas se alguém editar uma delas o motor não pode travar.
  var somaMin = 0;
  for (i = 0; i < MOTOR_CLASSES.length; i++) somaMin += limiteDe(MOTOR_CLASSES[i]).min;
  if (somaMin > 100) return out;

  for (var iter = 0; iter < 12; iter++) {
    var soma = 0;
    for (i = 0; i < MOTOR_CLASSES.length; i++) soma += out[MOTOR_CLASSES[i]];
    if (soma <= 0) {
      for (i = 0; i < MOTOR_CLASSES.length; i++) out[MOTOR_CLASSES[i]] = 100 / MOTOR_CLASSES.length;
      soma = 100;
    }
    var fator = 100 / soma;
    for (i = 0; i < MOTOR_CLASSES.length; i++) {
      c = MOTOR_CLASSES[i];
      var l = limiteDe(c);
      out[c] = motorClamp(out[c] * fator, l.min, l.max);
    }
    var novaSoma = 0;
    for (i = 0; i < MOTOR_CLASSES.length; i++) novaSoma += out[MOTOR_CLASSES[i]];
    var delta = 100 - novaSoma;
    if (Math.abs(delta) < 0.001) break;
    // Folga disponível na direção do ajuste.
    var folgas = [];
    var somaFolga = 0;
    for (i = 0; i < MOTOR_CLASSES.length; i++) {
      c = MOTOR_CLASSES[i];
      var lc = limiteDe(c);
      var folga = delta > 0 ? lc.max - out[c] : out[c] - lc.min;
      folga = Math.max(0, folga);
      folgas.push({ classe: c, folga: folga });
      somaFolga += folga;
    }
    if (somaFolga < 0.001) break;
    for (i = 0; i < folgas.length; i++) {
      out[folgas[i].classe] += delta * (folgas[i].folga / somaFolga);
    }
  }
  return out;
}

/** Arredonda para inteiros mantendo a soma em 100 (maior resto). */
function motorArredondarAlocacao(alloc) {
  var pisos = {};
  var restos = [];
  var soma = 0;
  var i, c;
  for (i = 0; i < MOTOR_CLASSES.length; i++) {
    c = MOTOR_CLASSES[i];
    var v = Math.max(0, Number(alloc[c]) || 0);
    pisos[c] = Math.floor(v);
    soma += pisos[c];
    restos.push({ classe: c, resto: v - Math.floor(v) });
  }
  var faltam = 100 - soma;
  restos.sort(function (a, b) {
    return b.resto - a.resto;
  });
  for (i = 0; i < faltam && i < restos.length; i++) pisos[restos[i].classe] += 1;
  // Sobra maior que o número de classes (alocação somava < 96): joga o resto
  // na classe de maior peso para não devolver algo que não fecha em 100.
  var checagem = 0;
  for (i = 0; i < MOTOR_CLASSES.length; i++) checagem += pisos[MOTOR_CLASSES[i]];
  if (checagem !== 100 && restos.length) pisos[restos[0].classe] += 100 - checagem;
  return pisos;
}

/**
 * Alocação-alvo por classe a partir do perfil + objetivo + prazo.
 *
 * @param {object} opcoes { perfil, objetivo, prazoAnos, base }
 *   `base` permite partir da carteira modelo publicada no painel em vez da
 *   tabela interna — assim o consultor continua no controle da referência.
 */
function motorDistribuicaoClasses(opcoes) {
  var op = opcoes || {};
  var perfil = MOTOR_ALLOC_BASE[op.perfil] ? op.perfil : 'Moderado';
  var base = op.base && typeof op.base === 'object' ? op.base : MOTOR_ALLOC_BASE[perfil];
  var faixa = motorFaixaPrazo(op.prazoAnos);
  var tiltObj = MOTOR_TILT_OBJETIVO[op.objetivo] || null;
  var limitesBase = MOTOR_LIMITES_PERFIL[perfil] || MOTOR_LIMITES_PERFIL.Moderado;

  var alloc = {};
  var i, c;
  for (i = 0; i < MOTOR_CLASSES.length; i++) {
    c = MOTOR_CLASSES[i];
    var v = Number(base[c]) || 0;
    if (tiltObj) v += tiltObj[c] || 0;
    v += faixa.tilt[c] || 0;
    alloc[c] = Math.max(0, v);
  }

  // Piso de renda fixa do prazo curto entra como limite, não como soma: tem
  // de sobreviver à normalização.
  var limites = {};
  for (i = 0; i < MOTOR_CLASSES.length; i++) {
    c = MOTOR_CLASSES[i];
    var l = limitesBase[c] || [0, 100];
    limites[c] = [l[0], l[1]];
  }
  if (faixa.pisoRf > 0) {
    limites.rf = [Math.max(limites.rf[0], faixa.pisoRf), Math.max(limites.rf[1], faixa.pisoRf)];
    // Abrir espaço para o piso: o teto das demais cai proporcionalmente.
    var tetoRestante = 100 - limites.rf[0];
    var somaTetos = limites.acao[1] + limites.fii[1] + limites.cripto[1];
    if (somaTetos > tetoRestante && somaTetos > 0) {
      var fator = tetoRestante / somaTetos;
      limites.acao = [Math.min(limites.acao[0], limites.acao[1] * fator), limites.acao[1] * fator];
      limites.fii = [Math.min(limites.fii[0], limites.fii[1] * fator), limites.fii[1] * fator];
      limites.cripto = [
        Math.min(limites.cripto[0], limites.cripto[1] * fator),
        limites.cripto[1] * fator,
      ];
    }
  }

  var normalizada = motorNormalizarComLimites(alloc, limites);
  var inteira = motorArredondarAlocacao(normalizada);
  return {
    alocacao: inteira,
    exata: normalizada,
    perfil: perfil,
    objetivo: op.objetivo || null,
    prazo: { id: faixa.id, nome: faixa.nome, anos: op.prazoAnos != null ? op.prazoAnos : null },
    limites: limites,
  };
}

// ════════════════════════════════════════════════════════════
// 6. PESOS DENTRO DA CLASSE
// ════════════════════════════════════════════════════════════

/** Redistribui o que passou do teto entre quem ainda tem espaço. */
function motorAplicarTeto(pesos, maxPct) {
  var p = pesos.slice();
  if (!(maxPct > 0) || maxPct >= 1) return p;
  // Teto baixo demais para o número de ativos: só o peso igual fecha em 1.
  if (maxPct * p.length <= 1.0000001) {
    return p.map(function () {
      return 1 / p.length;
    });
  }
  for (var iter = 0; iter < 25; iter++) {
    var excesso = 0;
    var livres = [];
    for (var i = 0; i < p.length; i++) {
      if (p[i] > maxPct + 1e-9) {
        excesso += p[i] - maxPct;
        p[i] = maxPct;
      } else if (p[i] < maxPct - 1e-9) {
        livres.push(i);
      }
    }
    if (excesso <= 1e-9 || !livres.length) break;
    var somaLivres = 0;
    for (var j = 0; j < livres.length; j++) somaLivres += p[livres[j]];
    for (var k = 0; k < livres.length; k++) {
      var idx = livres[k];
      var quota = somaLivres > 1e-9 ? p[idx] / somaLivres : 1 / livres.length;
      p[idx] += excesso * quota;
    }
  }
  return p;
}

/**
 * Peso de cada ativo dentro da classe, proporcional ao score.
 *
 * Não é proporcional ao score cru: entre 80 e 60 a diferença real de
 * convicção é maior do que 80/60 sugere, porque a escala não começa em
 * zero — score 40 é "não compraria". Por isso desconta o piso antes de
 * elevar ao expoente.
 */
function motorPesosPorScore(itens, opcoes) {
  var op = opcoes || {};
  var expoente = op.expoente != null ? op.expoente : 1.5;
  var pisoScore = op.pisoScore != null ? op.pisoScore : 40;
  var maxPct = op.maxPct != null ? op.maxPct : 0.35;
  var minPct = op.minPct != null ? op.minPct : 0.05;
  var topN = op.topN != null ? op.topN : 8;
  var scoreMinimo = op.scoreMinimo != null ? op.scoreMinimo : 0;
  var tetoRelativo = op.tetoRelativo != null ? op.tetoRelativo : 1.6;

  var lista = (itens || []).slice().filter(function (a) {
    return a && a.ticker;
  });
  if (!lista.length) return [];

  if (op.somenteElegiveis) {
    var elegiveis = lista.filter(function (a) {
      return a.elegivel !== false;
    });
    if (elegiveis.length) lista = elegiveis;
  }

  // Havendo ativos pontuados na classe, os sem lastro saem: recomendar o que
  // não se conseguiu avaliar, tendo alternativa avaliada, é escolher no
  // escuro com a luz acesa ao lado. Se NENHUM tem score, todos ficam e o
  // peso sai igual — quem rotula esse estado na tela é motorPlanoClasse.
  var pontuados = lista.filter(function (a) {
    return (a.scoreExato != null ? a.scoreExato : a.score) != null;
  });
  if (pontuados.length) lista = pontuados;

  lista.sort(function (a, b) {
    var sa = a.scoreExato != null ? a.scoreExato : a.score;
    var sb = b.scoreExato != null ? b.scoreExato : b.score;
    if (sa == null && sb == null) return String(a.ticker).localeCompare(String(b.ticker));
    if (sa == null) return 1;
    if (sb == null) return -1;
    if (sb !== sa) return sb - sa;
    return String(a.ticker).localeCompare(String(b.ticker));
  });

  var acimaDoCorte = lista.filter(function (a) {
    var s = a.scoreExato != null ? a.scoreExato : a.score;
    // Corte por score não julga quem não tem score: esse caso já foi
    // decidido acima (ou saiu, ou é a classe inteira).
    return s == null || s >= scoreMinimo;
  });
  // Corte que zeraria a classe inteira mantém pelo menos o melhor ativo: a
  // alternativa é devolver a classe sem nenhum destino para o dinheiro.
  if (acimaDoCorte.length) lista = acimaDoCorte;
  else lista = lista.slice(0, 1);

  lista = lista.slice(0, Math.max(1, topN));

  var pesos = lista.map(function (a) {
    var s = a.scoreExato != null ? a.scoreExato : a.score;
    if (s == null) return 1; // sem score: entra no piso, resultando em peso igual
    return Math.pow(Math.max(s - pisoScore, 1), expoente);
  });
  var soma = pesos.reduce(function (s, v) {
    return s + v;
  }, 0);
  pesos = pesos.map(function (v) {
    return soma > 0 ? v / soma : 1 / pesos.length;
  });
  // Teto de concentração precisa ser factível: com 3 ativos e teto de 30%,
  // nenhuma combinação soma 100% e o resultado degenera para peso igual —
  // exatamente o que o score existe para evitar. O piso `tetoRelativo / n`
  // deixa o primeiro colocado ficar até 60% acima do peso igual quando a
  // classe tem poucos nomes, e o teto nominal volta a valer quando há
  // ativos suficientes para ele fazer sentido.
  var maxEfetivo = Math.max(maxPct, tetoRelativo / lista.length);
  pesos = motorAplicarTeto(pesos, maxEfetivo);

  // Fatia irrelevante vira custo de corretagem sem efeito na carteira:
  // corta quem ficou abaixo do piso e redistribui, até estabilizar.
  for (var passo = 0; passo < 5; passo++) {
    if (lista.length <= 1) break;
    var menor = Math.min.apply(null, pesos);
    if (menor >= minPct - 1e-9) break;
    var manter = [];
    for (var i = 0; i < lista.length; i++) if (pesos[i] >= minPct - 1e-9) manter.push(i);
    if (!manter.length) break;
    lista = manter.map(function (i) {
      return lista[i];
    });
    pesos = manter.map(function (i) {
      return pesos[i];
    });
    var s2 = pesos.reduce(function (s, v) {
      return s + v;
    }, 0);
    pesos = pesos.map(function (v) {
      return s2 > 0 ? v / s2 : 1 / pesos.length;
    });
    pesos = motorAplicarTeto(pesos, Math.max(maxPct, tetoRelativo / lista.length));
  }

  return lista.map(function (a, i) {
    return { ativo: a, peso: pesos[i] };
  });
}

/**
 * Seleção com diversificação setorial: o alvo do setor decide QUANTO, e o
 * score decide QUEM leva dentro dele.
 *
 * O caminho por score puro (motorPesosPorScore) responde "quais são os
 * melhores ativos". Esta função responde outra pergunta — "qual é a melhor
 * carteira" — e as duas respostas divergem exatamente quando o mês favorece
 * um setor inteiro: seis construtoras bem pontuadas produzem seis notas altas
 * e uma carteira com um risco só.
 *
 * As vagas são repartidas por método de maior média (D'Hondt), com uma vaga
 * garantida a cada setor presente antes de a proporcionalidade valer. A
 * garantia é o que faz Saneamento (alvo 5) aparecer numa seleção de seis
 * nomes — pela proporção pura ele nunca chegaria à primeira vaga, e a
 * política existe justamente para ele estar lá.
 *
 * Devolve `null` quando a política NÃO PÔDE ser aplicada — nenhum candidato
 * com setor conhecido. Null é uma resposta, não uma falha: quem chama cai
 * para a seleção por score e declara o motivo na tela. Fabricar baldes a
 * partir de setor desconhecido produziria uma diversificação de mentira.
 */
function motorPesosPorSetor(itens, opcoes) {
  var op = opcoes || {};
  var buckets = op.buckets || [];
  var i;

  var lista = (itens || []).filter(function (a) {
    return a && a.ticker;
  });
  if (!lista.length || !buckets.length) return null;

  if (op.somenteElegiveis) {
    var elegiveis = lista.filter(function (a) {
      return a.elegivel !== false;
    });
    if (elegiveis.length) lista = elegiveis;
  }

  // Mesma regra do caminho por score: havendo pontuados, os sem lastro saem.
  var pontuados = lista.filter(function (a) {
    return (a.scoreExato != null ? a.scoreExato : a.score) != null;
  });
  if (!pontuados.length) return null;
  lista = pontuados;

  // Agrupa por balde, cada um já ordenado por score.
  var porBucket = {};
  var semSetor = [];
  lista.forEach(function (a) {
    var chave = motorBucketSetor(a, buckets);
    if (!chave) {
      semSetor.push(a);
      return;
    }
    (porBucket[chave] || (porBucket[chave] = [])).push(a);
  });

  var presentes = buckets.filter(function (b) {
    return porBucket[b.chave] && porBucket[b.chave].length;
  });
  if (!presentes.length) return null;

  // SÓ o curinga com candidatos é a ausência de dado vestida de política:
  // "Outros setores 100%" na tela pareceria uma decisão de diversificação
  // quando na verdade nenhum ativo tem setor conhecido. Esse estado tem
  // conserto (a fonte de setor) e precisa continuar a ser declarado como o que
  // é — daí voltar para a seleção por score, com o motivo dito.
  var soCuringa = presentes.every(function (b) {
    var campo = b.segmentos || b.setores || [];
    return campo.indexOf('*') !== -1;
  });
  if (soCuringa) return null;

  presentes.forEach(function (b) {
    porBucket[b.chave].sort(function (x, y) {
      var sx = x.scoreExato != null ? x.scoreExato : x.score;
      var sy = y.scoreExato != null ? y.scoreExato : y.score;
      if (sy !== sx) return sy - sx;
      return String(x.ticker).localeCompare(String(y.ticker));
    });
  });

  var topN = Math.max(1, op.topN != null ? op.topN : 6);

  // ── Vagas: uma garantida por setor presente, o resto por maior média ──
  var vagas = {};
  presentes.forEach(function (b) {
    vagas[b.chave] = 0;
  });
  var ordemAlvo = presentes.slice().sort(function (x, y) {
    if (y.alvo !== x.alvo) return y.alvo - x.alvo;
    return String(x.chave).localeCompare(String(y.chave));
  });
  var usadas = 0;
  for (i = 0; i < ordemAlvo.length && usadas < topN; i++) {
    vagas[ordemAlvo[i].chave] = 1;
    usadas++;
  }
  while (usadas < topN) {
    var melhor = null;
    var melhorQuociente = -1;
    for (i = 0; i < presentes.length; i++) {
      var b = presentes[i];
      if (porBucket[b.chave].length <= vagas[b.chave]) continue; // sem candidato de sobra
      var q = b.alvo / (vagas[b.chave] + 1);
      if (q > melhorQuociente + 1e-9) {
        melhorQuociente = q;
        melhor = b;
      }
    }
    if (!melhor) break;
    vagas[melhor.chave]++;
    usadas++;
  }

  // Setor sem vaga não entra na normalização: o alvo dele volta para os
  // outros, senão sobraria peso sem dono e a classe não fecharia em 100%.
  var comVaga = presentes.filter(function (b) {
    return vagas[b.chave] > 0;
  });
  var somaAlvo = comVaga.reduce(function (s, b) {
    return s + (b.alvo > 0 ? b.alvo : 0);
  }, 0);

  var selecao = [];
  comVaga.forEach(function (b) {
    var pesoBucket = somaAlvo > 0 ? (b.alvo > 0 ? b.alvo : 0) / somaAlvo : 1 / comVaga.length;
    // Dentro do balde é o score que manda, sem teto nem piso próprios: o
    // teto do balde já é o alvo dele, e um piso aqui cortaria o segundo
    // nome de um setor que só tem duas vagas.
    var dentro = motorPesosPorScore(porBucket[b.chave], {
      topN: vagas[b.chave],
      maxPct: 1,
      minPct: 0,
      expoente: op.expoente,
      pisoScore: op.pisoScore,
      scoreMinimo: 0,
    });
    dentro.forEach(function (d) {
      selecao.push({
        ativo: d.ativo,
        peso: pesoBucket * d.peso,
        setorChave: b.chave,
        setorNome: b.nome,
        setorAlvo: b.alvo,
      });
    });
  });
  if (!selecao.length) return null;

  selecao.sort(function (a, b2) {
    if (b2.peso !== a.peso) return b2.peso - a.peso;
    return String(a.ativo.ticker).localeCompare(String(b2.ativo.ticker));
  });

  // Teto por ativo continua valendo como cerca de risco. Quando um setor de
  // alvo grande tem um nome só, o teto morde e a diferença volta para os
  // outros setores — a política cede ao limite de concentração, não o
  // contrário. `tetoRelativo / n` mantém o teto factível com poucos nomes,
  // pela mesma razão que em motorPesosPorScore.
  var maxPct = op.maxPct != null ? op.maxPct : 0.35;
  var tetoRelativo = op.tetoRelativo != null ? op.tetoRelativo : 1.6;
  var pesos = motorAplicarTeto(
    selecao.map(function (s) {
      return s.peso;
    }),
    Math.max(maxPct, tetoRelativo / selecao.length)
  );
  for (i = 0; i < selecao.length; i++) selecao[i].peso = pesos[i];

  var vazios = buckets.filter(function (b) {
    return !porBucket[b.chave] || !porBucket[b.chave].length;
  });
  var semVaga = presentes.filter(function (b) {
    return vagas[b.chave] === 0;
  });

  var setores = comVaga.map(function (b) {
    var peso = 0;
    selecao.forEach(function (s) {
      if (s.setorChave === b.chave) peso += s.peso;
    });
    return {
      chave: b.chave,
      nome: b.nome,
      alvo: b.alvo,
      // O alvo depois de normalizado entre os setores presentes, ao lado do
      // peso que de facto saiu. Os dois divergem quando o teto por ativo
      // morde — um setor de alvo grande com um único nome elegível — e a
      // tela precisa dos dois números para dizer que cedeu, e por quê.
      alvoPct: somaAlvo > 0 ? motorArred((b.alvo > 0 ? b.alvo : 0) / somaAlvo, 4) : null,
      nomes: vagas[b.chave],
      candidatos: porBucket[b.chave].length,
      peso: motorArred(peso, 4),
    };
  });
  var setoresVazios = vazios.concat(semVaga).map(function (b) {
    return {
      chave: b.chave,
      nome: b.nome,
      alvo: b.alvo,
      candidatos: (porBucket[b.chave] || []).length,
    };
  });
  return {
    itens: selecao,
    setores: setores,
    setoresVazios: setoresVazios,
    semSetor: semSetor.length,
  };
}

// ════════════════════════════════════════════════════════════
// 7. PLANO DE APORTE
// ════════════════════════════════════════════════════════════

// Quantos ativos e que concentração cada classe suporta. Renda fixa aceita
// concentração alta (Tesouro não tem risco idiossincrático relevante);
// ações precisam de mais nomes; cripto é o oposto — pulverizar em altcoin
// para "diversificar" só multiplica o risco.
var MOTOR_OPCOES_CLASSE = {
  rf: { topN: 3, maxPct: 0.5, minPct: 0.1, expoente: 1.2, ticketMinimo: 30 },
  acao: { topN: 6, maxPct: 0.3, minPct: 0.06, expoente: 1.6, ticketMinimo: 100 },
  fii: { topN: 5, maxPct: 0.32, minPct: 0.08, expoente: 1.5, ticketMinimo: 100 },
  cripto: { topN: 2, maxPct: 0.7, minPct: 0.15, expoente: 1.3, ticketMinimo: 50 },
};

var MOTOR_UNIDADE_CLASSE = { acao: 'ações', fii: 'cotas', cripto: 'unidades', rf: null };

/**
 * Divide o aporte do mês entre as classes.
 *
 * Com patrimônio informado NÃO usa a proporção-alvo direto: calcula quanto
 * falta em cada classe para o total (patrimônio + aporte) bater no alvo e
 * manda o dinheiro para os buracos. É o rebalanceamento por aporte — chega
 * no alvo sem vender nada, e sem gerar imposto.
 */
function motorDistribuirAporte(alocacaoAlvo, aporte, patrimonioAtual) {
  var out = {};
  var i, c;
  var valor = Number(aporte) || 0;
  for (i = 0; i < MOTOR_CLASSES.length; i++) out[MOTOR_CLASSES[i]] = 0;
  if (valor <= 0) return { valores: out, modo: 'vazio', deficits: null };

  var alvo = alocacaoAlvo || {};
  function pct(cl) {
    return Math.max(0, Number(alvo[cl]) || 0) / 100;
  }

  var atual = patrimonioAtual || {};
  var totalAtual = 0;
  for (i = 0; i < MOTOR_CLASSES.length; i++)
    totalAtual += Math.max(0, Number(atual[MOTOR_CLASSES[i]]) || 0);

  if (totalAtual <= 0) {
    for (i = 0; i < MOTOR_CLASSES.length; i++) {
      c = MOTOR_CLASSES[i];
      out[c] = valor * pct(c);
    }
    return { valores: out, modo: 'proporcional', deficits: null };
  }

  var futuro = totalAtual + valor;
  var deficits = {};
  var somaDef = 0;
  for (i = 0; i < MOTOR_CLASSES.length; i++) {
    c = MOTOR_CLASSES[i];
    var d = pct(c) * futuro - Math.max(0, Number(atual[c]) || 0);
    deficits[c] = Math.max(0, d);
    somaDef += deficits[c];
  }

  if (somaDef <= 0) {
    for (i = 0; i < MOTOR_CLASSES.length; i++) {
      c = MOTOR_CLASSES[i];
      out[c] = valor * pct(c);
    }
    return { valores: out, modo: 'proporcional', deficits: deficits };
  }

  if (somaDef <= valor) {
    // Cobre todos os buracos e o que sobrar segue a proporção-alvo.
    var resto = valor - somaDef;
    for (i = 0; i < MOTOR_CLASSES.length; i++) {
      c = MOTOR_CLASSES[i];
      out[c] = deficits[c] + resto * pct(c);
    }
    return { valores: out, modo: 'rebalanceia_e_sobra', deficits: deficits };
  }

  for (i = 0; i < MOTOR_CLASSES.length; i++) {
    c = MOTOR_CLASSES[i];
    out[c] = valor * (deficits[c] / somaDef);
  }
  return { valores: out, modo: 'rebalanceia', deficits: deficits };
}

/** Frase curta explicando por que o ativo entrou — os dois pilares mais fortes. */
function motorJustificativa(ativo) {
  var pilares = [];
  for (var i = 0; i < MOTOR_PILARES.length; i++) {
    var p = ativo.pilares && ativo.pilares[MOTOR_PILARES[i]];
    if (p && p.nota != null) pilares.push(p);
  }
  pilares.sort(function (a, b) {
    return b.nota - a.nota;
  });
  if (!pilares.length || ativo.temLastro === false) {
    var faltando = ativo.faltando || [];
    if (!faltando.length) return 'Sem indicadores disponíveis para este ativo.';
    var nomes = [];
    for (var f = 0; f < faltando.length && nomes.length < 3; f++) nomes.push(faltando[f].pilar);
    return 'Sem dados de ' + nomes.join(', ').toLowerCase() + ' — ativo não pontuado.';
  }
  function rotular(p) {
    return p.nome + ' ' + motorArred(p.nota, 1).toString().replace('.', ',') + '/10';
  }

  // "Destaque em Crescimento 0/10" é o oposto do que a frase diz. Só é
  // destaque o pilar que sustenta a tese; abaixo disso a frase honesta é
  // dizer qual é o melhor e admitir que nenhum é bom.
  var fortes = pilares.filter(function (p) {
    return p.nota >= 6;
  });
  if (!fortes.length) {
    return 'Nenhum pilar acima de 6/10 — o melhor é ' + rotular(pilares[0]) + '.';
  }
  var frase = 'Destaque em ' + fortes.slice(0, 2).map(rotular).join(' e ') + '.';
  // Pilar muito fraco ao lado de um forte costuma ser o que decide a compra,
  // e some se a frase só falar dos pontos altos.
  var pior = pilares[pilares.length - 1];
  if (pior.nota <= 3 && fortes.indexOf(pior) === -1) {
    frase += ' Ponto fraco: ' + rotular(pior) + '.';
  }
  return frase;
}

/**
 * Converte o valor de uma classe em ordens concretas.
 *
 * Ação e FII são negociados em unidade inteira: o alvo em reais quase nunca
 * fecha certo, então arredonda para baixo e o que sobra é redistribuído numa
 * passada gulosa — sempre para o ativo com o maior buraco em relação ao seu
 * alvo, para o resultado convergir aos pesos em vez de empilhar no primeiro.
 */
function motorPlanoClasse(classe, valorClasse, ranking, opcoes) {
  var op = Object.assign({}, MOTOR_OPCOES_CLASSE[classe] || MOTOR_OPCOES_CLASSE.acao, opcoes || {});
  var valor = Math.max(0, Number(valorClasse) || 0);
  var candidatos = (ranking || []).filter(function (a) {
    return a && a.classe === classe;
  });
  if (!candidatos.length || valor <= 0) {
    return { classe: classe, alvo: valor, investido: 0, sobra: valor, itens: [], aviso: null };
  }

  // Aporte pequeno não comporta a diversificação nominal da classe: com
  // R$ 200 em ações, dividir em 6 nomes dá R$ 33 cada e não compra nada.
  var cabem = Math.max(1, Math.floor(valor / (op.ticketMinimo || 100)));
  var topN = Math.min(op.topN, cabem);

  // Diversificação setorial primeiro, score puro como reserva.
  //
  // A ordem importa e é o núcleo do pedido: sem ela, um mês em que as seis
  // ações mais bem pontuadas são construtoras produz uma carteira de seis
  // construtoras. A política responde "quanto vai para cada setor"; o score
  // continua respondendo "quem leva dentro do setor".
  //
  // A reserva é obrigatória, não um luxo: quando a fonte de mercado degrada
  // para cotação simples, NENHUM ativo traz setor, e aí não há política a
  // aplicar. Preferimos a seleção por score com o motivo declarado a uma
  // diversificação inventada em cima de setor desconhecido.
  var politica = op.setores !== undefined ? op.setores : MOTOR_SETORES_ALVO[classe];
  var porSetor = null;
  if (politica && politica.length) {
    porSetor = motorPesosPorSetor(candidatos, {
      buckets: politica,
      topN: topN,
      maxPct: op.maxPct,
      expoente: op.expoente,
      pisoScore: op.pisoScore,
      somenteElegiveis: op.somenteElegiveis,
    });
  }

  var selecao = porSetor
    ? porSetor.itens
    : motorPesosPorScore(candidatos, {
        topN: topN,
        maxPct: op.maxPct,
        minPct: op.minPct,
        expoente: op.expoente,
        pisoScore: op.pisoScore,
        scoreMinimo: op.scoreMinimo,
        somenteElegiveis: op.somenteElegiveis,
      });

  var itens = selecao.map(function (s) {
    var precoRaw =
      op.precos && op.precos[s.ativo.ticker] != null ? op.precos[s.ativo.ticker] : s.ativo.preco;
    var preco =
      typeof precoRaw === 'number' && isFinite(precoRaw) && precoRaw > 0 ? precoRaw : null;
    return {
      ticker: s.ativo.ticker,
      nome: s.ativo.nome,
      classe: classe,
      score: s.ativo.score,
      confianca: s.ativo.confianca,
      alertas: s.ativo.alertas || [],
      peso: s.peso,
      valorAlvo: valor * s.peso,
      preco: preco,
      quantidade: null,
      valorInvestido: 0,
      unidade: MOTOR_UNIDADE_CLASSE[classe],
      justificativa: motorJustificativa(s.ativo),
      // O setor viaja com o item porque é ele que explica por que ESTE ativo
      // entrou: sem o rótulo na tela, uma seleção diversificada é
      // indistinguível de uma seleção por score que por acaso variou.
      setorChave: s.setorChave || null,
      setorNome: s.setorNome || null,
      setor: s.ativo.setor || null,
      setorCanon: s.ativo.setorCanon || null,
      segmentoFii: s.ativo.segmentoFii || null,
      semPreco: false,
    };
  });

  var i;
  if (classe === 'rf') {
    // Renda fixa aceita fração de real: o alvo é a ordem.
    for (i = 0; i < itens.length; i++) {
      itens[i].valorInvestido = motorArred(itens[i].valorAlvo, 2);
    }
  } else if (classe === 'cripto') {
    for (i = 0; i < itens.length; i++) {
      if (itens[i].preco) {
        itens[i].quantidade = motorArred(itens[i].valorAlvo / itens[i].preco, 8);
        itens[i].valorInvestido = motorArred(itens[i].valorAlvo, 2);
      } else {
        itens[i].semPreco = true;
        itens[i].valorInvestido = motorArred(itens[i].valorAlvo, 2);
      }
    }
  } else {
    for (i = 0; i < itens.length; i++) {
      if (!itens[i].preco) {
        itens[i].semPreco = true;
        itens[i].valorInvestido = motorArred(itens[i].valorAlvo, 2);
        continue;
      }
      itens[i].quantidade = Math.floor(itens[i].valorAlvo / itens[i].preco);
      itens[i].valorInvestido = motorArred(itens[i].quantidade * itens[i].preco, 2);
    }
    // Passada gulosa com o troco.
    var sobra = valor;
    for (i = 0; i < itens.length; i++) sobra -= itens[i].valorInvestido;
    for (var passo = 0; passo < 500; passo++) {
      var melhor = -1;
      var maiorBuraco = 0;
      // 1ª preferência: quem ainda está abaixo do próprio alvo, começando
      // pelo maior buraco — é o que faz o resultado convergir para os pesos.
      for (i = 0; i < itens.length; i++) {
        if (!itens[i].preco || itens[i].semPreco) continue;
        if (itens[i].preco > sobra + 1e-9) continue;
        var buraco = itens[i].valorAlvo - itens[i].valorInvestido;
        if (buraco > maiorBuraco + 1e-9) {
          maiorBuraco = buraco;
          melhor = i;
        }
      }
      // 2ª preferência: todos já bateram o alvo, mas ainda dá para comprar.
      // Acontece quando o que falta cabe num ativo barato e não no caro que
      // tinha o buraco. `itens` está ordenado por score, então o primeiro
      // que couber é o melhor colocado — troco vira posição, não caixa morto.
      if (melhor < 0) {
        for (i = 0; i < itens.length; i++) {
          if (!itens[i].preco || itens[i].semPreco) continue;
          if (itens[i].preco > sobra + 1e-9) continue;
          melhor = i;
          break;
        }
      }
      if (melhor < 0) break;
      itens[melhor].quantidade += 1;
      itens[melhor].valorInvestido = motorArred(itens[melhor].quantidade * itens[melhor].preco, 2);
      sobra = motorArred(sobra - itens[melhor].preco, 2);
    }
  }

  var investido = 0;
  for (i = 0; i < itens.length; i++) investido += itens[i].valorInvestido;
  investido = motorArred(investido, 2);

  // A recomendação sai dos ativos mais bem pontuados — é o produto inteiro.
  // Sem NENHUM ativo pontuado na classe, dividir igual seria fabricar uma
  // seleção que análise nenhuma sustenta, e o utilizador não teria como
  // distinguir isso de uma recomendação de verdade.
  //
  // Então a classe não recomenda. O valor dela fica RETIDO, com o motivo
  // declarado — retido é diferente de sobra de caixa: sobra é troco de lote,
  // retido é dinheiro que aguarda dado para ser alocado.
  var algumPontuado = candidatos.some(function (c) {
    return c.score != null;
  });
  if (!algumPontuado) {
    return {
      classe: classe,
      alvo: motorArred(valor, 2),
      investido: 0,
      sobra: 0,
      retido: motorArred(valor, 2),
      itens: [],
      modo: 'aguardando_dados',
      aviso:
        'Nenhum ativo desta classe tem indicadores suficientes para pontuar. ' +
        'A recomendação sai dos ativos mais bem pontuados, então não há seleção a fazer ' +
        'enquanto o dado não chegar — o valor da classe fica retido.',
    };
  }
  var modo = 'score';

  var avisos = [];
  var semPreco = itens.filter(function (it) {
    return it.semPreco;
  });
  if (semPreco.length)
    avisos.push(
      'Sem cotação para ' +
        semPreco
          .map(function (it) {
            return it.ticker;
          })
          .join(', ') +
        ' — valor sugerido sem conversão em quantidade.'
    );
  else if (topN < op.topN)
    avisos.push(
      'Aporte da classe comporta ' +
        topN +
        (topN === 1 ? ' ativo' : ' ativos') +
        ' sem virar troco. Aumentando o aporte, o motor abre mais posições.'
    );

  // Política pedida e não aplicada tem de ser dita. Sem esta linha, a tela
  // mostraria uma seleção por score com a mesma cara de uma seleção
  // diversificada, e ninguém saberia que a diversificação não aconteceu.
  if (politica && politica.length && !porSetor)
    avisos.push(
      'Sem o setor dos ativos, a diversificação setorial não pôde ser aplicada — ' +
        'a seleção saiu por score. Assim que a fonte de mercado devolver o setor, ' +
        'o alvo de cada setor volta a valer.'
    );
  var aviso = avisos.length ? avisos.join(' ') : null;

  return {
    classe: classe,
    alvo: motorArred(valor, 2),
    investido: investido,
    sobra: motorArred(valor - investido, 2),
    retido: 0,
    itens: itens,
    modo: modo,
    // Como a seleção foi feita, e o que a política não conseguiu cobrir.
    // 'setor' e 'score' produzem carteiras diferentes a partir do mesmo
    // ranking — esconder qual dos dois rodou tornaria a tela impossível de
    // auditar.
    selecao: porSetor ? 'setor' : 'score',
    setores: porSetor ? porSetor.setores : null,
    setoresVazios: porSetor ? porSetor.setoresVazios : null,
    semSetor: porSetor ? porSetor.semSetor : null,
    aviso: aviso,
  };
}

/**
 * Recalcula quantidade e valor de um item cujo TICKER mudou.
 *
 * Vive aqui, ao lado de motorPlanoClasse, porque a regra de arredondamento é
 * a mesma e uma cópia dela no cliente divergiria no primeiro ajuste — ação e
 * FII compram lote inteiro, cripto aceita fração, renda fixa aceita centavo.
 *
 * A troca preserva o VALOR DO LUGAR, não o ativo: o motor decidiu que aquele
 * slot vale R$ 320, e trocar o ticker não muda essa decisão. É o que faz a
 * troca ser previsível — trocar um banco por outro não pode reordenar a
 * carteira inteira.
 *
 * O troco da passada gulosa não é refeito: o item trocado fica no lote inteiro
 * que cabe no alvo dele, e a diferença cai na sobra da classe. Refazer a
 * passada mexeria nas quantidades dos OUTROS ativos, que o utilizador não
 * pediu para mexer.
 */
function motorRecalcularItemTrocado(item, classe) {
  if (!item) return item;
  var preco =
    typeof item.preco === 'number' && isFinite(item.preco) && item.preco > 0 ? item.preco : null;
  item.semPreco = !preco && classe !== 'rf';
  if (classe === 'rf') {
    item.quantidade = null;
    item.valorInvestido = motorArred(item.valorAlvo, 2);
  } else if (!preco) {
    item.quantidade = null;
    item.valorInvestido = motorArred(item.valorAlvo, 2);
  } else if (classe === 'cripto') {
    item.quantidade = motorArred(item.valorAlvo / preco, 8);
    item.valorInvestido = motorArred(item.valorAlvo, 2);
  } else {
    item.quantidade = Math.floor(item.valorAlvo / preco);
    item.valorInvestido = motorArred(item.quantidade * preco, 2);
  }
  return item;
}

/**
 * Plano completo do mês: quanto vai para cada classe, quais ativos e quanto
 * de cada um. É a função que a aba chama.
 *
 * @param {object} opcoes
 *   aporteMensal    R$ do mês
 *   alocacaoAlvo    { rf, acao, fii, cripto } em %
 *   ranking         saída de motorRanquear (todas as classes)
 *   patrimonioAtual { rf, acao, fii, cripto } em R$ (opcional — liga o rebalanceamento)
 *   precos          { TICKER: preço } (opcional — sobrepõe ativo.preco)
 *   porClasse       overrides de MOTOR_OPCOES_CLASSE por classe
 */
function motorPlanoAporte(opcoes) {
  var op = opcoes || {};
  var aporte = Math.max(0, Number(op.aporteMensal) || 0);
  var alvo = op.alocacaoAlvo || MOTOR_ALLOC_BASE.Moderado;
  var ranking = op.ranking || [];
  var dist = motorDistribuirAporte(alvo, aporte, op.patrimonioAtual);

  var classes = {};
  var itens = [];
  var totalInvestido = 0;
  var totalRetido = 0;
  var avisos = [];
  for (var i = 0; i < MOTOR_CLASSES.length; i++) {
    var c = MOTOR_CLASSES[i];
    var overrides = Object.assign({}, (op.porClasse && op.porClasse[c]) || {});
    if (op.precos) overrides.precos = op.precos;
    if (op.somenteElegiveis != null) overrides.somenteElegiveis = op.somenteElegiveis;
    var plano = motorPlanoClasse(c, dist.valores[c], ranking, overrides);
    plano.pct = Math.max(0, Number(alvo[c]) || 0);
    classes[c] = plano;
    totalInvestido += plano.investido;
    totalRetido += plano.retido || 0;
    if (plano.aviso) avisos.push(MOTOR_CLASSE_NOMES[c] + ': ' + plano.aviso);
    for (var j = 0; j < plano.itens.length; j++) {
      var it = plano.itens[j];
      it.pctAporte = aporte > 0 ? motorArred((it.valorInvestido / aporte) * 100, 1) : 0;
      itens.push(it);
    }
  }

  totalInvestido = motorArred(totalInvestido, 2);
  return {
    aporte: aporte,
    modo: dist.modo,
    rebalanceando: dist.modo === 'rebalanceia' || dist.modo === 'rebalanceia_e_sobra',
    deficits: dist.deficits,
    alocacaoAlvo: alvo,
    classes: classes,
    itens: itens,
    totalInvestido: totalInvestido,
    // Retido: dinheiro de classe que não pôde ser recomendada por falta de
    // dado. Separado da sobra de propósito — sobra é troco de lote inteiro,
    // retido é decisão adiada.
    retido: motorArred(totalRetido, 2),
    sobra: motorArred(aporte - totalInvestido - totalRetido, 2),
    aguardandoDados: MOTOR_CLASSES.filter(function (c) {
      return classes[c] && classes[c].modo === 'aguardando_dados' && classes[c].alvo > 0;
    }),
    avisos: avisos,
  };
}

// ── Exportação ──
// Browser: funções top-level já são globais (classic script) — o namespace
// abaixo existe só para quem prefere chamada qualificada.
// Node (testes): module.exports, sem tocar em window.
var MotorCarteira = {
  interpolar: motorInterpolar,
  notaMetrica: motorNotaMetrica,
  notaPilar: motorNotaPilar,
  inferirClasse: motorInferirClasse,
  normalizarSetor: motorNormalizarSetor,
  scoreAtivo: motorScoreAtivo,
  ranquear: motorRanquear,
  faixaPrazo: motorFaixaPrazo,
  distribuicaoClasses: motorDistribuicaoClasses,
  normalizarComLimites: motorNormalizarComLimites,
  pesosPorScore: motorPesosPorScore,
  pesosPorSetor: motorPesosPorSetor,
  segmentoFii: motorSegmentoFii,
  bucketSetor: motorBucketSetor,
  aplicarTeto: motorAplicarTeto,
  distribuirAporte: motorDistribuirAporte,
  planoClasse: motorPlanoClasse,
  recalcularItemTrocado: motorRecalcularItemTrocado,
  planoAporte: motorPlanoAporte,
  COBERTURA_MINIMA: MOTOR_COBERTURA_MINIMA,
  CRITERIOS: MOTOR_CRITERIOS,
  criteriosDe: motorCriteriosDe,
  LENTES: MOTOR_LENTES,
  PILARES: MOTOR_PILARES,
  PILAR_NOMES: MOTOR_PILAR_NOMES,
  PILAR_NOMES_CURTOS: MOTOR_PILAR_NOMES_CURTOS,
  CLASSES: MOTOR_CLASSES,
  ALLOC_BASE: MOTOR_ALLOC_BASE,
  LIMITES_PERFIL: MOTOR_LIMITES_PERFIL,
  OPCOES_CLASSE: MOTOR_OPCOES_CLASSE,
  SETORES_ALVO: MOTOR_SETORES_ALVO,
  SETOR_MAPA: MOTOR_SETOR_MAPA,
  SETOR_NOMES: MOTOR_SETOR_NOMES,
  FII_SEGMENTO_NOMES: MOTOR_FII_SEGMENTO_NOMES,
  LENTE_POR_OBJETIVO: MOTOR_LENTE_POR_OBJETIVO,
};
if (typeof window !== 'undefined') window.MotorCarteira = MotorCarteira;
if (typeof module !== 'undefined' && module.exports) module.exports = MotorCarteira;
