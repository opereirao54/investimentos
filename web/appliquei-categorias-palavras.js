// Palavra → categoria de despesa. Uma tabela só para dois usuários:
//   - o bot do Telegram (api/_lib/telegram-parser.js, via require);
//   - a importação de fatura (web/appliquei-importar-fatura.js, no navegador).
// Mexeu aqui, mudou nos dois. Sem DOM e sem estado: roda em `node --test`.
//
// Palavra (já normalizada: minúscula, sem acento) → slug de categoria.
// Prefixos terminados em '*' casam o começo da palavra ("farmac*" pega
// farmácia e farmacinha).
//
// Top-level só com `var`/`function` (classic script, ver
// test/classic-scripts-globals.test.js); os nomes levam o prefixo catp para
// não colidir com os globais dos outros scripts.

var CATP_PALAVRAS = {
  moradia: [
    'aluguel',
    'condominio',
    'luz',
    'energia',
    'agua',
    'gas',
    'internet',
    'iptu',
    'casa',
    'apartamento',
    'apto',
    'reforma',
    'moveis',
    'movel',
    'diarista',
    'faxina',
    'enel',
    'sabesp',
    'cemig',
    'copel',
    'claro',
    'vivo',
    'tim',
  ],
  alimentacao: [
    'mercado',
    'supermercado',
    'feira',
    'padaria',
    'pao',
    'acougue',
    'hortifruti',
    'ifood',
    'rappi',
    'restaurante',
    'almoco',
    'jantar',
    'cafe',
    'lanche',
    'lanchonete',
    'pizza',
    'hamburguer',
    'burger',
    'sushi',
    'comida',
    'marmita',
    'sorvete',
    'acai',
    'bar',
    'cerveja',
    'bebida',
    'atacadao',
    'assai',
    'carrefour',
    'pao de acucar',
    'mcdonalds',
    'burger king',
    'subway',
    'doce*',
    'salgado*',
  ],
  transporte: [
    'uber',
    '99pop',
    '99 taxi',
    'taxi',
    'onibus',
    'metro',
    'trem',
    'gasolina',
    'combustivel',
    'etanol',
    'alcool',
    'diesel',
    'posto',
    'estacionamento',
    'pedagio',
    'ipva',
    'oficina',
    'mecanico',
    'pneu',
    'auto pecas',
    'autopecas',
    'carro',
    'moto',
    'passagem',
    'bilhete',
    'sem parar',
    'zona azul',
    'lavagem',
    'lava jato',
    'cabify',
    'indriver',
    'brt',
    'bicicleta',
  ],
  saude: [
    'farmac*',
    'remedio*',
    'drogaria',
    'droga raia',
    'drogasil',
    'pacheco',
    'medico',
    'consulta',
    'exame*',
    'dentista',
    'hospital',
    'plano de saude',
    'unimed',
    'amil',
    'psicolog*',
    'terapia',
    'fisioterap*',
    'academia',
    'vacina',
    'otica',
    'oculos',
    'laboratorio',
    'nutricionista',
    'suplemento*',
    'whey',
  ],
  educacao: [
    'escola',
    'faculdade',
    'curso',
    'livro*',
    'mensalidade escolar',
    'material escolar',
    'udemy',
    'alura',
    'ingles',
    'apostila',
    'matricula',
    'creche',
    'uniforme',
    'pos graduacao',
    'mba',
    'papelaria',
  ],
  lazer: [
    'netflix',
    'spotify',
    'amazon prime',
    'prime video',
    'disney',
    'hbo',
    'globoplay',
    'youtube',
    'deezer',
    'cinema',
    'teatro',
    'show',
    'ingresso*',
    'viagem',
    'hotel',
    'pousada',
    'airbnb',
    'passeio',
    'jogo*',
    'steam',
    'playstation',
    'xbox',
    'festa',
    'balada',
    'assinatura',
    'streaming',
    'apple',
    'icloud',
    'chatgpt',
    'esporte*',
  ],
  cuidados_pessoais: [
    'cabelo',
    'cabeleireiro',
    'barbeiro',
    'barbearia',
    'salao',
    'manicure',
    'unha*',
    'depilacao',
    'estetica',
    'maquiagem',
    'perfume',
    'cosmetico*',
    'roupa*',
    'sapato*',
    'tenis',
    'camisa',
    'calca',
    'vestido',
    'shopping',
    'renner',
    'riachuelo',
    'cea',
    'zara',
    'shein',
    'boticario',
    'natura',
    'sabonete',
    'shampoo',
  ],
  pets: [
    'pet',
    'petshop',
    'pet shop',
    'racao',
    'veterinario',
    'vet',
    'banho e tosa',
    'tosa',
    'cachorro',
    'gato',
    'petz',
    'cobasi',
  ],
  impostos_taxas: [
    'imposto*',
    'taxa*',
    'tarifa*',
    'iof',
    'irpf',
    'darf',
    'multa*',
    'juros',
    'anuidade',
    'cartorio',
    'licenciamento',
    'inss',
    'boleto bancario',
  ],
};

/** Minúsculas, sem acento, espaços colapsados — o mesmo do bot. */
function catpNormalizar(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

function catpEscaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Casa uma expressão (uma ou mais palavras) como palavra inteira no texto
// normalizado. Expressão terminada em '*' casa prefixo.
function catpRegexExpressao(expr) {
  var prefixo = expr.slice(-1) === '*';
  var base = catpEscaparRegex(prefixo ? expr.slice(0, -1) : expr).replace(/ /g, '\\s+');
  return new RegExp('(?<![\\p{L}\\p{N}])' + base + (prefixo ? '' : '(?![\\p{L}\\p{N}])'), 'u');
}

/** Slug da primeira categoria cujo dicionário aparece no texto, ou null. */
function catpSugerir(textoNorm) {
  if (!textoNorm) return null;
  var chaves = Object.keys(CATP_PALAVRAS);
  for (var i = 0; i < chaves.length; i++) {
    var lista = CATP_PALAVRAS[chaves[i]];
    for (var j = 0; j < lista.length; j++) {
      if (catpRegexExpressao(lista[j]).test(textoNorm)) return chaves[i];
    }
  }
  return null;
}

var AppliqueiCategoriasPalavras = {
  PALAVRAS_CATEGORIA: CATP_PALAVRAS,
  normalizar: catpNormalizar,
  sugerir: catpSugerir,
};
if (typeof window !== 'undefined') window.AppliqueiCategoriasPalavras = AppliqueiCategoriasPalavras;
if (typeof module !== 'undefined' && module.exports) module.exports = AppliqueiCategoriasPalavras;
