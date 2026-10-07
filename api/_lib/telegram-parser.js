'use strict';

// Interpreta a mensagem que o usuário manda ao bot do Telegram ("mercado 52,90",
// "nubank 300 tênis 3x", "+3500 salário") e devolve um lançamento estruturado.
//
// PURO: não lê banco, não chama rede, não depende do relógio (o `hoje` vem no
// contexto). O webhook carrega contas/cartões/categorias do usuário e chama
// `interpretar`; os testes chamam direto.
//
// O resultado NÃO é a transação gravada. É a intenção — tipo, valor, onde saiu
// o dinheiro, categoria — que o app depois transforma em transação pelo mesmo
// criarLancamentos() do formulário. Por isso aqui não existe id, competência
// nem `pago`: essas regras moram num lugar só, no app.
//
// Quando a mensagem é ambígua (dois valores, nenhum valor) a resposta é
// {ok:false} com o motivo — quem chama decide se tenta a IA de reserva ou
// devolve a dica de formato ao usuário. Chutar um valor em dinheiro é pior do
// que perguntar.

// Categorias padrão do app (web/appliquei-aba-controle-financeiro.js →
// CATEGORIAS_DESPESA_PADRAO). Os slugs são o contrato; se mudarem lá, mudam aqui.
const CATEGORIAS_PADRAO = [
  { v: 'moradia', label: '🏠 Moradia' },
  { v: 'alimentacao', label: '🛒 Alimentação' },
  { v: 'transporte', label: '🚗 Transporte' },
  { v: 'saude', label: '⚕️ Saúde' },
  { v: 'educacao', label: '📚 Educação' },
  { v: 'lazer', label: '🍿 Lazer e Assinaturas' },
  { v: 'cuidados_pessoais', label: '💆 Cuidados Pessoais' },
  { v: 'pets', label: '🐶 Pets' },
  { v: 'impostos_taxas', label: '🏦 Impostos e Taxas' },
];

// Palavra (já normalizada: minúscula, sem acento) → slug de categoria.
// Prefixos terminados em '*' casam o começo da palavra ("farmac*" pega
// farmácia e farmacinha).
const PALAVRAS_CATEGORIA = {
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

const PALAVRAS_RECEITA = [
  'recebi',
  'recebido',
  'recebimento',
  'salario',
  'receita',
  'entrada',
  'renda',
  'freela',
  'freelance',
  'reembolso',
  'vendi',
  'venda',
  'bonus',
  'comissao',
  'decimo terceiro',
  '13o',
  'ferias',
  'restituicao',
  'pix recebido',
  'ganhei',
  'pagamento recebido',
  'pro labore',
  'prolabore',
  'aluguel recebido',
  'mesada',
];

const PALAVRAS_CREDITO = ['credito', 'cartao', 'no cartao', 'no credito', 'fatura'];
const PALAVRAS_DEBITO = ['debito', 'no debito', 'pix', 'dinheiro', 'em especie', 'na conta'];
const PALAVRAS_FIXA = ['fixa', 'fixo', 'todo mes', 'mensal', 'mensalmente', 'recorrente'];

// Palavras que não identificam conta nem cartão ("Cartão principal", "Conta
// corrente"): casá-las faria "cartão 50 farmácia" escolher um cartão chamado
// "Cartão principal" por acaso, em vez de pela regra de cartão único.
const PALAVRAS_GENERICAS_NOME = new Set([
  'cartao',
  'credito',
  'debito',
  'conta',
  'corrente',
  'banco',
  'principal',
  'carteira',
  'digital',
  'poupanca',
  'pagamento',
  'pagamentos',
  'black',
  'gold',
  'platinum',
  'internacional',
  'visa',
  'master',
  'mastercard',
  'elo',
  'virtual',
  'fisico',
  'meu',
  'minha',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'e',
  'outro',
]);

// Conectivos que sobram na descrição depois de tirar valor, data e conta
// ("mercado no nubank" → "mercado").
const CONECTIVOS = new Set([
  'no',
  'na',
  'nos',
  'nas',
  'em',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'com',
  'pelo',
  'pela',
  'pro',
  'pra',
  'para',
  'por',
  'via',
  'r',
  'reais',
  'real',
  'gastei',
  'paguei',
  'gasto',
  'compra',
  'comprei',
  'a',
  'o',
  'e',
]);

const MAX_VALOR = 10000000;
const MAX_PARCELAS = 48;

function normalizar(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ymd(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Casa uma expressão (uma ou mais palavras) como palavra inteira no texto
// normalizado. Expressão terminada em '*' casa prefixo.
function regexExpressao(expr) {
  const prefixo = expr.endsWith('*');
  const base = escaparRegex(prefixo ? expr.slice(0, -1) : expr).replace(/ /g, '\\s+');
  return new RegExp('(?<![\\p{L}\\p{N}])' + base + (prefixo ? '' : '(?![\\p{L}\\p{N}])'), 'u');
}

function contem(textoNorm, expressoes) {
  return expressoes.some((e) => regexExpressao(e).test(textoNorm));
}

// "1.234,56" → 1234.56 · "52,9" → 52.9 · "1500" → 1500 · "12.50" → 12.5
// "1.500" → 1500 (ponto seguido de 3 dígitos é milhar no Brasil).
function lerNumeroBR(bruto) {
  let s = bruto;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function arred2(n) {
  return Math.round(n * 100) / 100;
}

// Palavras que identificam uma conta/cartão pelo nome: "Nubank Ultravioleta" →
// ['nubank', 'ultravioleta', 'nubank ultravioleta'].
function chavesDoNome(nome) {
  const norm = normalizar(nome);
  if (!norm) return [];
  const palavras = norm
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 2 && !PALAVRAS_GENERICAS_NOME.has(p));
  const chaves = new Set(palavras.filter((p) => p.length >= 3 || /\d/.test(p)));
  if (palavras.length > 1) chaves.add(palavras.join(' '));
  return Array.from(chaves);
}

// Procura no texto qual item (conta ou cartão) foi citado. Devolve o item e as
// expressões encontradas (para tirá-las da descrição), ou null. Se dois itens
// casam com a mesma força, ninguém ganha: é ambíguo, e melhor cair no padrão.
function acharCitado(textoNorm, itens) {
  let melhor = null;
  let empate = false;
  itens.forEach((item) => {
    const achadas = chavesDoNome(item.nome).filter((c) => regexExpressao(c).test(textoNorm));
    if (!achadas.length) return;
    const forca = Math.max(...achadas.map((c) => c.length));
    if (!melhor || forca > melhor.forca) {
      melhor = { item, achadas, forca };
      empate = false;
    } else if (forca === melhor.forca) {
      empate = true;
    }
  });
  return melhor && !empate ? melhor : null;
}

function removerExpr(texto, expr) {
  const prefixo = expr.endsWith('*');
  const base = escaparRegex(prefixo ? expr.slice(0, -1) : expr).replace(/ /g, '\\s+');
  const re = new RegExp(
    '(?<![\\p{L}\\p{N}])' + base + (prefixo ? '[\\p{L}]*' : '') + '(?![\\p{L}\\p{N}])',
    'giu'
  );
  return texto.replace(re, ' ');
}

// Mesma remoção, mas no texto ORIGINAL (com acento e maiúsculas), para a
// descrição sair como o usuário escreveu. Casa ignorando acento comparando
// palavra a palavra.
function removerDoOriginal(original, exprsNorm) {
  const palavras = original.split(/\s+/).filter(Boolean);
  exprsNorm.forEach((expr) => {
    const alvo = expr
      .replace(/\*$/, '')
      .split(' ')
      .map((a) => a.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter(Boolean);
    if (!alvo.length) return;
    const prefixo = expr.endsWith('*');
    for (let i = 0; i + alvo.length <= palavras.length; i++) {
      const ok = alvo.every((a, j) => {
        const p = normalizar(palavras[i + j]).replace(/[^\p{L}\p{N}]/gu, '');
        return prefixo && j === alvo.length - 1 ? p.startsWith(a) : p === a;
      });
      if (ok) {
        palavras.splice(i, alvo.length);
        i--;
      }
    }
  });
  return palavras.join(' ');
}

function categoriaPorPalavras(descNorm, aprendidas, customizadas) {
  if (!descNorm) return null;
  const tokens = descNorm.split(/[^a-z0-9]+/).filter(Boolean);
  // 1) o que o próprio usuário já corrigiu pelo botão "Mudar categoria"
  if (aprendidas) {
    if (aprendidas[descNorm]) return { v: aprendidas[descNorm], origem: 'aprendida' };
    for (const t of tokens) if (aprendidas[t]) return { v: aprendidas[t], origem: 'aprendida' };
  }
  // 2) categorias criadas pelo usuário: o nome dela citado na mensagem
  for (const c of customizadas || []) {
    const chaves = chavesDoNome(String(c.label || '').replace(/^[^\p{L}\p{N}]+/u, ''));
    if (chaves.some((k) => regexExpressao(k).test(descNorm))) return { v: c.v, origem: 'palavra' };
  }
  // 3) dicionário padrão
  for (const v of Object.keys(PALAVRAS_CATEGORIA)) {
    if (contem(descNorm, PALAVRAS_CATEGORIA[v])) return { v, origem: 'palavra' };
  }
  return null;
}

/**
 * @param {string} texto
 * @param {object} ctx
 * @param {Date}   ctx.hoje
 * @param {Array}  [ctx.contas]      [{id, nome, tipo, arquivada}]
 * @param {Array}  [ctx.cartoes]     [{id, nome, arquivado}]
 * @param {Array}  [ctx.categorias]  categorias do usuário [{v, label}] (sem as ocultas)
 * @param {object} [ctx.aprendidas]  {palavra: slug}
 */
function interpretar(texto, ctx) {
  const c = ctx || {};
  const hoje = c.hoje instanceof Date ? c.hoje : new Date();
  const original = String(texto == null ? '' : texto)
    .replace(/\s+/g, ' ')
    .trim();
  if (!original) return { ok: false, motivo: 'vazio' };
  if (original.length > 300) return { ok: false, motivo: 'longo_demais' };

  let t = normalizar(original);
  const removidos = []; // expressões a tirar da descrição original

  // ---- sinal explícito: "+3500 salário" é receita, "-50 mercado" despesa ----
  let sinal = null;
  const mSinal = t.match(/(?:^|\s)([+-])\s*(?:r\$\s*)?\d/);
  if (mSinal) sinal = mSinal[1];

  // ---- parcelas: "3x", "em 3 vezes", "3 parcelas" ----
  let parcelas = 1;
  const mParc =
    t.match(/(?<![\p{L}\p{N}])(\d{1,2})\s*x(?![\p{L}\p{N}])/u) ||
    t.match(/(?:em\s+)?(\d{1,2})\s*(?:vezes|parcelas)(?![\p{L}\p{N}])/u);
  if (mParc) {
    parcelas = parseInt(mParc[1], 10);
    t = t.replace(mParc[0], ' ');
    removidos.push(...normalizar(mParc[0]).split(' '));
  }
  if (!(parcelas >= 1 && parcelas <= MAX_PARCELAS)) return { ok: false, motivo: 'parcelas' };

  // ---- dia de vencimento: "dia 10" ----
  let diaVencimento = null;
  const mDia = t.match(/(?<![\p{L}\p{N}])dia\s+(\d{1,2})(?![\p{L}\p{N}])/u);
  if (mDia) {
    const d = parseInt(mDia[1], 10);
    if (d >= 1 && d <= 31) diaVencimento = d;
    t = t.replace(mDia[0], ' ');
    removidos.push('dia', mDia[1]);
  }

  // ---- data da compra: ontem, anteontem, hoje, dd/mm[/aaaa] ----
  let data = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const mData = t.match(
    /(?<![\p{L}\p{N}])(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?![\p{L}\p{N}])/u
  );
  if (/(?<![\p{L}])anteontem(?![\p{L}])/u.test(t)) {
    data.setDate(data.getDate() - 2);
    t = removerExpr(t, 'anteontem');
    removidos.push('anteontem');
  } else if (/(?<![\p{L}])ontem(?![\p{L}])/u.test(t)) {
    data.setDate(data.getDate() - 1);
    t = removerExpr(t, 'ontem');
    removidos.push('ontem');
  } else if (mData) {
    const dia = parseInt(mData[1], 10);
    const mes = parseInt(mData[2], 10);
    let ano = mData[3] ? parseInt(mData[3], 10) : hoje.getFullYear();
    if (ano < 100) ano += 2000;
    const cand = new Date(ano, mes - 1, dia);
    if (cand.getMonth() !== mes - 1 || cand.getDate() !== dia) {
      return { ok: false, motivo: 'data_invalida' };
    }
    // "28/12" digitado em janeiro é do ano passado, não de daqui a 11 meses.
    if (!mData[3] && cand > hoje && cand - hoje > 31 * 86400000) cand.setFullYear(ano - 1);
    data = cand;
    t = t.replace(mData[0], ' ');
    removidos.push(mData[0]);
  }
  if (/(?<![\p{L}])hoje(?![\p{L}])/u.test(t)) {
    t = removerExpr(t, 'hoje');
    removidos.push('hoje');
  }

  // ---- valor ----
  const reValor =
    /(?<![\p{L}\p{N}.,])(r\$\s*)?([+-]\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\p{L}\p{N}]|[.,]\d)/gu;
  const candidatos = [];
  let m;
  while ((m = reValor.exec(t))) {
    candidatos.push({
      bruto: m[0],
      numero: m[3],
      comRS: !!m[1],
      decimal: /[.,]\d{1,2}$/.test(m[3]),
    });
  }
  if (!candidatos.length) return { ok: false, motivo: 'sem_valor' };
  let escolhido = null;
  if (candidatos.length === 1) escolhido = candidatos[0];
  else {
    // Mais de um número: só decide se UM deles se destaca (tem R$ ou centavos).
    const comRS = candidatos.filter((x) => x.comRS);
    const comDec = candidatos.filter((x) => x.decimal);
    if (comRS.length === 1) escolhido = comRS[0];
    else if (comDec.length === 1) escolhido = comDec[0];
  }
  if (!escolhido) return { ok: false, motivo: 'varios_valores' };
  const valor = arred2(lerNumeroBR(escolhido.numero));
  if (!(valor > 0)) return { ok: false, motivo: 'sem_valor' };
  if (valor > MAX_VALOR) return { ok: false, motivo: 'valor_alto' };
  t = t.replace(escolhido.bruto, ' ');
  removidos.push(
    ...normalizar(escolhido.bruto).replace(/r\$/g, ' ').replace(/[+-]/g, ' ').split(' ')
  );
  removidos.push('r$', 'r');

  // ---- tipo ----
  const ehReceita = sinal === '+' || (sinal !== '-' && contem(t, PALAVRAS_RECEITA));
  const ehFixa = contem(t, PALAVRAS_FIXA);
  if (ehFixa) {
    PALAVRAS_FIXA.forEach((p) => {
      if (contem(t, [p])) {
        t = removerExpr(t, p);
        removidos.push(p);
      }
    });
  }

  // ---- onde: conta ou cartão ----
  const contas = (c.contas || []).filter((x) => x && !x.arquivada && x.tipo !== 'corretora');
  const cartoes = (c.cartoes || []).filter((x) => x && !x.arquivado);
  const falouCredito = contem(t, PALAVRAS_CREDITO);
  const falouDebito = contem(t, PALAVRAS_DEBITO);
  const cartaoCitado = acharCitado(t, cartoes);
  const contaCitada = acharCitado(t, contas);

  let destino = 'conta';
  if (!ehReceita) {
    if (falouCredito || parcelas > 1) destino = 'cartao';
    else if (falouDebito) destino = 'conta';
    else if (cartaoCitado && !contaCitada) destino = 'cartao';
    // Mesmo nome em conta E cartão ("Nubank" é os dois) e nenhuma pista: o
    // cartão é o uso mais comum para compra. A resposta do bot diz onde caiu e
    // tem Desfazer — errar aqui é barato de corrigir.
    else if (cartaoCitado && contaCitada) destino = 'cartao';
  }

  let cartaoId = null;
  let contaId = null;
  let cartaoOpcoes = null;
  if (destino === 'cartao') {
    if (cartaoCitado) cartaoId = cartaoCitado.item.id;
    else if (cartoes.length === 1) cartaoId = cartoes[0].id;
    else if (cartoes.length === 0) return { ok: false, motivo: 'sem_cartao' };
    else cartaoOpcoes = cartoes.map((x) => ({ id: x.id, nome: x.nome }));
    if (cartaoCitado) removidos.push(...cartaoCitado.achadas);
    if (contaCitada) removidos.push(...contaCitada.achadas);
  } else if (contaCitada) {
    contaId = contaCitada.item.id;
    removidos.push(...contaCitada.achadas);
  }
  [PALAVRAS_CREDITO, PALAVRAS_DEBITO].forEach((lista) =>
    lista.forEach((p) => {
      if (contem(t, [p])) removidos.push(p);
    })
  );

  // ---- descrição: o que sobrou, como o usuário escreveu ----
  let descricao = removerDoOriginal(original, removidos.filter(Boolean))
    .replace(/(^|\s)[+-](?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // conectivos soltos nas pontas ("mercado no" → "mercado")
  const palavras = descricao.split(' ').filter(Boolean);
  while (palavras.length && CONECTIVOS.has(normalizar(palavras[0]).replace(/[^a-z0-9]/g, '')))
    palavras.shift();
  while (
    palavras.length &&
    CONECTIVOS.has(normalizar(palavras[palavras.length - 1]).replace(/[^a-z0-9]/g, ''))
  )
    palavras.pop();
  descricao = palavras.join(' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})]+$/gu, '');
  if (descricao.length > 80) descricao = descricao.slice(0, 80).trim();

  // ---- categoria (só despesa) ----
  let categoriaDespesa = null;
  let origemCategoria = null;
  if (!ehReceita) {
    const cat = categoriaPorPalavras(normalizar(descricao), c.aprendidas, c.categorias);
    if (cat) {
      categoriaDespesa = cat.v;
      origemCategoria = cat.origem;
    }
  }

  if (!descricao) descricao = ehReceita ? 'Receita' : 'Despesa';
  descricao = descricao.charAt(0).toUpperCase() + descricao.slice(1);

  let categoria;
  if (ehReceita) categoria = 'receita';
  else if (destino === 'cartao') categoria = 'cartao_credito';
  else if (ehFixa) categoria = 'despesa_fixa';
  else categoria = 'despesa_variavel';

  const lanc = {
    categoria,
    valor,
    descricao,
    dataCompra: ymd(data),
    parcelas: categoria === 'cartao_credito' ? parcelas : 1,
    // Cartão + "fixa" = assinatura no cartão (Netflix todo mês na fatura).
    tipoCartao: categoria === 'cartao_credito' ? (ehFixa ? 'fixo' : 'parcelado') : undefined,
    fixo: categoria === 'despesa_fixa',
    diaVencimento: categoria === 'cartao_credito' ? null : diaVencimento,
    contaId,
    cartaoId,
    categoriaDespesa,
    origemCategoria,
  };
  if (cartaoOpcoes) return { ok: false, motivo: 'cartao_ambiguo', opcoes: cartaoOpcoes, lanc };
  return { ok: true, lanc };
}

module.exports = {
  interpretar,
  normalizar,
  lerNumeroBR,
  chavesDoNome,
  CATEGORIAS_PADRAO,
  PALAVRAS_CATEGORIA,
};
