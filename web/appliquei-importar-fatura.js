/**
 * Appliquei — IMPORTAR FATURA DO CARTÃO (Nubank): o MOTOR, sem DOM.
 *
 * A tela (appliquei-importar-fatura-ui.js) só desenha o que este arquivo
 * devolve. A separação é a mesma de insights.js ↔ insights-ui.js: a regra
 * precisa rodar em `node --test` sem navegador. Análise completa dos casos e
 * riscos (os códigos A1, P3, D3... citados abaixo): docs/IMPORTAR-FATURA.md.
 *
 * CONTRATO — O MOTOR SUGERE, QUEM DECIDE É O USUÁRIO.
 * lerArquivo e planejar não escrevem nada. Só `aplicar` monta lançamentos, e
 * só a partir do plano que o usuário revisou e confirmou. Nada do arquivo vai
 * para o servidor: ele é lido no próprio aparelho.
 *
 * Como o arquivo do Nubank se comporta (OFX real, fatura 05/11/2026):
 *   - compra é TRNAMT negativo; "Pagamento recebido" é positivo;
 *   - a parcela vem no fim do título: "Loja - Parcela 3/10";
 *   - parcela antiga vem com a data do INÍCIO DO CICLO, não a da compra —
 *     por isso dataCompra só é gravada para compra à vista e parcela 1;
 *   - LEDGERBAL é o total da fatura (as compras somadas, sem o pagamento);
 *   - o nome do arquivo traz o vencimento: Nubank_AAAA-MM-DD.ofx.
 *
 * Top-level só com `var`/`function` (classic script); prefixo impfat.
 */

var IMPFAT_LIMITES = {
  bytes: 1024 * 1024, // A7: uma fatura não chega perto disto
  linhas: 600,
  maxParcelas: 48, // o mesmo teto do lançamento manual
  // "Valor igual" (P1): meio centavo só absorve erro de conta com decimais. Era
  // 0.01, e R$ 52,00 contava como igual a R$ 51,99 (caça de furos).
  centavos: 0.005,
  parcelaCentavos: 0.05, // arredondamento do banco na parcela (R3)
  parecidaAbs: 5, // P4: até R$ 5 ou 10% de diferença é "parecida"
  parecidaPct: 0.1,
  // Quem lança pelo Telegram arredonda ("padaria 20" contra R$ 20,03 no
  // banco) e não escreve o nome da loja: diferença de centavos é "parecida"
  // mesmo sem nome em comum.
  quaseIgualAbs: 0.5,
  quaseIgualPct: 0.01,
  similaridade: 0.5, // descrição "parecida" (tokens em comum)
};

var IMPFAT_MENSAGENS = {
  formato:
    'Este arquivo não parece a fatura do cartão Nubank. Envie o arquivo OFX ou CSV que o Nubank manda por e-mail.',
  pdf: 'Arquivo PDF ainda não é aceito. No app do Nubank, peça a fatura em OFX ou CSV.',
  extrato_conta:
    'Este é o extrato da conta, não a fatura do cartão. No app do Nubank: cartão → Resumo de faturas → escolha a fatura → enviar por e-mail.',
  grande:
    'Arquivo grande demais para uma fatura (até 1 MB e 600 linhas). Envie o arquivo de uma fatura só.',
  vazio: 'Nenhuma compra encontrada neste arquivo.',
  colunas: 'O arquivo não tem as colunas de data, descrição e valor.',
};

function impfatErro(codigo, detalhe) {
  var e = new Error(detalhe || IMPFAT_MENSAGENS[codigo] || codigo);
  e.codigo = codigo;
  return e;
}

// ════════════════════════════════════════════════════════════
// 1. TEXTO, DATA E NÚMERO
// ════════════════════════════════════════════════════════════

/** Minúsculas, sem acento, espaços colapsados. */
function impfatNorm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bytes do arquivo → texto. O OFX do Nubank declara CHARSET:1252; CSV salvo
 * no Excel costuma vir em Latin-1. Sem declaração, tenta UTF-8 estrito e cai
 * para windows-1252 se houver byte inválido (A3: "CafÃ©").
 */
function impfatDecodificar(bytes) {
  var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length > IMPFAT_LIMITES.bytes) throw impfatErro('grande');
  var cabeca = '';
  for (var i = 0; i < Math.min(b.length, 400); i++) cabeca += String.fromCharCode(b[i]);
  var texto = null;
  if (!/CHARSET:\s*1252/i.test(cabeca)) {
    try {
      texto = new TextDecoder('utf-8', { fatal: true }).decode(b);
    } catch (e) {
      texto = null;
    }
  }
  if (texto == null) texto = new TextDecoder('windows-1252').decode(b);
  return texto.replace(/^﻿/, '');
}

/** 'AAAA-MM-DD' válido, ou null. Aceita AAAA-MM-DD, AAAAMMDD e DD/MM/AAAA. */
function impfatData(s) {
  var t = String(s == null ? '' : s).trim();
  var m = t.match(/^(\d{4})-?(\d{2})-?(\d{2})/) || null;
  var a, me, d;
  if (m) {
    a = +m[1];
    me = +m[2];
    d = +m[3];
  } else {
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    d = +m[1];
    me = +m[2];
    a = +m[3];
  }
  if (me < 1 || me > 12 || d < 1 || d > 31 || a < 2000 || a > 2100) return null;
  var dt = new Date(a, me - 1, d);
  if (dt.getMonth() !== me - 1) return null; // 31/02
  return impfatYmd(dt);
}

function impfatYmd(dt) {
  return (
    dt.getFullYear() +
    '-' +
    String(dt.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(dt.getDate()).padStart(2, '0')
  );
}

/**
 * Número de planilha → número. "1.234,56", "1234.56", "-12,50", "R$ 9,90",
 * "(12,50)" (negativo contábil). A4: o mesmo valor, salvo ou não no Excel.
 */
function impfatNumero(s) {
  var t = String(s == null ? '' : s)
    .replace(/R\$/gi, '')
    .replace(/\s/g, '');
  if (!t) return NaN;
  var neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (t[0] === '-') {
    neg = !neg;
    t = t.slice(1);
  } else if (t[0] === '+') t = t.slice(1);
  var virg = t.lastIndexOf(',');
  var ponto = t.lastIndexOf('.');
  if (virg !== -1 && ponto !== -1) {
    // O último separador é o decimal.
    if (virg > ponto) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (virg !== -1) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (ponto !== -1 && /^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, ''); // "1.500" é milhar
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  var n = Number(t);
  return neg ? -n : n;
}

function impfatArred(n) {
  return Math.round(n * 100) / 100;
}

/** Tokens úteis (sem números soltos nem palavras de 1-2 letras). */
function impfatTokens(s) {
  return impfatNorm(s)
    .replace(/\(\s*\d+\s*\/\s*\d+\s*\)/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(function (t) {
      return t.length > 2 && !/^\d+$/.test(t);
    });
}

/**
 * 0 a 1: fração de tokens do menor conjunto que aparece no outro. Um token
 * casa com outro igual ou com o começo de outro (3+ letras): "pet" casa com
 * "petshopamigofiel", o nome grudado que a maquininha manda (caça de furos).
 */
function impfatSimilaridade(a, b) {
  var ta = impfatTokens(a);
  var tb = impfatTokens(b);
  if (!ta.length || !tb.length) return 0;
  var menor = ta.length <= tb.length ? ta : tb;
  var maior = menor === ta ? tb : ta;
  var comuns = 0;
  menor.forEach(function (t) {
    if (
      maior.some(function (u) {
        return (
          u === t || (t.length >= 3 && u.indexOf(t) === 0) || (u.length >= 3 && t.indexOf(u) === 0)
        );
      })
    )
      comuns++;
  });
  return comuns / menor.length;
}

// ════════════════════════════════════════════════════════════
// 2. LER O ARQUIVO
// ════════════════════════════════════════════════════════════

/** Valor de uma tag OFX (SGML sem fechamento ou XML). */
function impfatTagOfx(bloco, nome) {
  var m = bloco.match(new RegExp('<' + nome + '>([^<\\r\\n]*)', 'i'));
  return m ? m[1].trim() : '';
}

function impfatEntidades(s) {
  return String(s)
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function impfatLerOfx(texto) {
  var temCartao = /<CREDITCARDMSGSRSV1>/i.test(texto);
  if (!temCartao && /<BANKMSGSRSV1>/i.test(texto)) throw impfatErro('extrato_conta');
  if (!temCartao) throw impfatErro('formato');
  var org = impfatTagOfx(texto, 'ORG');
  var fid = impfatTagOfx(texto, 'FID');
  var blocos = texto.split(/<STMTTRN>/i).slice(1);
  if (blocos.length > IMPFAT_LIMITES.linhas) throw impfatErro('grande');
  var linhas = blocos.map(function (bruto, i) {
    var bloco = bruto.split(/<\/STMTTRN>/i)[0];
    var valorBanco = impfatNumero(impfatTagOfx(bloco, 'TRNAMT'));
    return {
      ref: i,
      data: impfatData(impfatTagOfx(bloco, 'DTPOSTED')),
      titulo: impfatEntidades(impfatTagOfx(bloco, 'MEMO') || impfatTagOfx(bloco, 'NAME')),
      // OFX: compra (débito) é negativa. Aqui, compra fica POSITIVA.
      valor: Number.isFinite(valorBanco) ? impfatArred(-valorBanco) : NaN,
      fitid: impfatTagOfx(bloco, 'FITID') || null,
    };
  });
  var ledger = texto.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|$)/i);
  var saldo = ledger ? impfatNumero(impfatTagOfx(ledger[1], 'BALAMT')) : NaN;
  return {
    formato: 'ofx',
    banco: /nu pagamentos/i.test(org) || fid === '260' ? 'nubank' : 'outro',
    linhas: linhas,
    totalBanco: Number.isFinite(saldo) ? impfatArred(-saldo) : null,
  };
}

/** CSV com aspas, aspas escapadas e quebra de linha dentro de aspas (A5). */
function impfatCsvRegistros(texto) {
  var primeira = texto.split(/\r?\n/)[0] || '';
  var sep = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ';' : ',';
  var regs = [];
  var campo = '';
  var reg = [];
  var aspas = false;
  for (var i = 0; i < texto.length; i++) {
    var c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      reg.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      reg.push(campo);
      regs.push(reg);
      reg = [];
      campo = '';
    } else campo += c;
  }
  if (campo || reg.length) {
    reg.push(campo);
    regs.push(reg);
  }
  return regs.filter(function (r) {
    return r.some(function (x) {
      return String(x).trim();
    });
  });
}

var IMPFAT_COLUNAS = {
  data: ['date', 'data', 'data da compra', 'data compra', 'data de compra'],
  titulo: [
    'title',
    'titulo',
    'descricao',
    'description',
    'estabelecimento',
    'lancamento',
    'historico',
  ],
  valor: ['amount', 'valor', 'valor (r$)', 'valor r$', 'value'],
};
// Opcional: banco que põe a parcela numa coluna própria ("3/10", "3 de 10").
var IMPFAT_COLUNA_PARCELA = ['parcela', 'parcelas', 'parcelamento', 'prestacao', 'installment'];

function impfatLerCsv(texto) {
  var regs = impfatCsvRegistros(texto);
  if (!regs.length) throw impfatErro('vazio');
  var cab = regs[0].map(impfatNorm);
  var idx = {};
  Object.keys(IMPFAT_COLUNAS).forEach(function (k) {
    idx[k] = cab.findIndex(function (c) {
      return IMPFAT_COLUNAS[k].indexOf(c) !== -1;
    });
  });
  var faltam = Object.keys(idx).filter(function (k) {
    return idx[k] === -1;
  });
  if (faltam.length === 3) throw impfatErro('formato');
  if (faltam.length) {
    var nomes = { data: 'data', titulo: 'descrição', valor: 'valor' };
    throw impfatErro(
      'colunas',
      'Falta no arquivo a coluna de ' +
        faltam
          .map(function (k) {
            return nomes[k];
          })
          .join(' e ') +
        '. Envie o arquivo do Nubank sem editar.'
    );
  }
  var dados = regs.slice(1);
  if (dados.length > IMPFAT_LIMITES.linhas) throw impfatErro('grande');
  var colParcela = cab.findIndex(function (c) {
    return IMPFAT_COLUNA_PARCELA.indexOf(c) !== -1;
  });
  var linhas = dados.map(function (r, i) {
    var titulo = String(r[idx.titulo] == null ? '' : r[idx.titulo]).trim();
    var pc =
      colParcela !== -1
        ? String(r[colParcela] || '').match(/(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})/i)
        : null;
    // Parcela na coluna própria vira o mesmo sufixo do Nubank, e o resto do
    // motor não precisa saber de onde veio.
    if (pc && +pc[2] >= 2 && !impfatParcela(titulo)) titulo += ' - Parcela ' + pc[1] + '/' + pc[2];
    return {
      ref: i,
      data: impfatData(r[idx.data]),
      titulo: titulo,
      valor: impfatNumero(r[idx.valor]),
      fitid: null,
    };
  });
  // O sinal da compra no CSV não é padronizado. Quem diz é o pagamento da
  // fatura anterior, quando existe (é sempre o contrário da compra); senão,
  // a maioria das linhas — numa fatura, quase tudo é compra.
  var pag = linhas.find(function (l) {
    return /^pagamento\b/.test(impfatNorm(l.titulo)) && Number.isFinite(l.valor) && l.valor;
  });
  var positivas = linhas.filter(function (l) {
    return l.valor > 0;
  }).length;
  var negativas = linhas.filter(function (l) {
    return l.valor < 0;
  }).length;
  var compraNegativa = pag ? pag.valor > 0 : negativas > positivas;
  if (compraNegativa)
    linhas.forEach(function (l) {
      if (Number.isFinite(l.valor)) l.valor = impfatArred(-l.valor);
    });
  return { formato: 'csv', banco: 'nubank', linhas: linhas, totalBanco: null };
}

/**
 * Bytes (ou texto) do arquivo → { formato, banco, linhas, totalBanco,
 * vencimentoArquivo }. Em cada linha, compra é valor POSITIVO e crédito
 * (pagamento, estorno) é NEGATIVO. Lança erro com `codigo` (IMPFAT_MENSAGENS).
 */
function impfatLerArquivo(entrada, nomeArquivo) {
  var texto = typeof entrada === 'string' ? entrada : impfatDecodificar(entrada);
  if (texto.length > IMPFAT_LIMITES.bytes) throw impfatErro('grande');
  if (/^%PDF/.test(texto)) throw impfatErro('pdf');
  var r = /OFXHEADER|<OFX>/i.test(texto.slice(0, 2000)) ? impfatLerOfx(texto) : impfatLerCsv(texto);
  var semCompra = !r.linhas.some(function (l) {
    return Number.isFinite(l.valor) && l.valor !== 0;
  });
  if (!r.linhas.length || semCompra) throw impfatErro('vazio');
  r.vencimentoArquivo = impfatVencimentoDoNome(nomeArquivo);
  return r;
}

/** "Nubank_2026-11-05.ofx" → '2026-11-05' (o vencimento). */
function impfatVencimentoDoNome(nome) {
  var m = String(nome || '').match(/(\d{4}-\d{2}-\d{2})/);
  return m ? impfatData(m[1]) : null;
}

/**
 * Sem vencimento no nome: o próximo dia `diaVencimento` do cartão depois da
 * compra mais recente. Sem o dia no cadastro, null — a tela pede a data.
 */
function impfatAdivinharVencimento(linhas, diaVencimento) {
  var dia = parseInt(diaVencimento, 10);
  if (!dia || dia < 1 || dia > 31) return null;
  var datas = (linhas || [])
    .map(function (l) {
      return l.data;
    })
    .filter(Boolean)
    .sort();
  if (!datas.length) return null;
  var p = datas[datas.length - 1].split('-').map(Number);
  var a = p[0];
  var m = p[1] - 1;
  if (p[2] >= dia) m++;
  var dt = new Date(a, m, 1);
  var ultimo = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  dt.setDate(Math.min(dia, ultimo));
  return impfatYmd(dt);
}

// ════════════════════════════════════════════════════════════
// 3. ENTENDER CADA LINHA
// ════════════════════════════════════════════════════════════

/**
 * compra · encargo (IOF, juros, multa, anuidade) · pagamento (da fatura
 * anterior) · saldo_anterior (rotativo que já está na fatura passada) ·
 * credito (estorno, crédito, ajuste).
 */
function impfatTipo(titulo, valor) {
  var n = impfatNorm(titulo);
  if (valor < 0 && /^pagamento\b|pagamento recebido|pagamento em /.test(n)) return 'pagamento';
  if (/^saldo (em atraso|anterior|restante)|saldo da fatura anterior/.test(n))
    return 'saldo_anterior';
  if (valor < 0) return 'credito';
  if (/^iof\b|\bjuros\b|\bmulta\b|\bencargos?\b|\banuidade\b|\btarifa\b/.test(n)) return 'encargo';
  return 'compra';
}

/** "Loja - Parcela 3/10" → { base: 'Loja', n: 3, m: 10 }. R1: só no fim. */
function impfatParcela(titulo) {
  var t = String(titulo || '');
  var m = t.match(/\s*[-–]\s*parcela\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i);
  if (!m) return null;
  var n = +m[1];
  var tot = +m[2];
  if (tot < 2 || n < 1 || n > tot || tot > IMPFAT_LIMITES.maxParcelas) return null;
  return { base: t.slice(0, m.index).trim(), n: n, m: tot };
}

// Intermediadores de pagamento: o nome útil vem DEPOIS do "*".
var IMPFAT_PROCESSADORES = [
  'mp',
  'mercpago',
  'mercadopago',
  'pag',
  'pagseguro',
  'pg',
  'ifd',
  'ec',
  'asa',
  'sumup',
  'ton',
  'stone',
  'pp',
  'picpay',
  'ebanx',
  'dl',
  'zp',
  'sp',
  'cielo',
  'getnet',
  'ame',
  'paypal',
];

// Prefixos de loja grande que escondem o nome comercial.
var IMPFAT_APELIDOS = {
  amazonmktplc: 'Amazon',
  amazonbr: 'Amazon',
  amazon: 'Amazon',
  mercadolivre: 'Mercado Livre',
  mercadolivre1: 'Mercado Livre',
  uber: 'Uber',
  ubertrip: 'Uber',
  rappi: 'Rappi',
  google: 'Google',
  apple: 'Apple',
  applecombill: 'Apple',
  netflix: 'Netflix',
  spotify: 'Spotify',
};

/** Título cru do Nubank → nome que a pessoa reconhece (C3). */
function impfatLimparDescricao(titulo) {
  var parc = impfatParcela(titulo);
  var s = String(parc ? parc.base : titulo || '')
    .replace(/\s+/g, ' ')
    .trim();
  var original = s;
  s = s.replace(/\s*-\s*nupay$/i, '').trim();
  var ast = s.indexOf('*');
  if (ast !== -1) {
    var antes = s.slice(0, ast).trim();
    var depois = s.slice(ast + 1).trim();
    var chave = impfatNorm(antes).replace(/[^a-z0-9]/g, '');
    if (IMPFAT_PROCESSADORES.indexOf(chave) !== -1) s = depois || antes;
    else if (IMPFAT_APELIDOS[chave]) s = IMPFAT_APELIDOS[chave];
    else s = antes || depois;
  }
  // TUDO EM MAIÚSCULAS vira "Tudo Em Maiúsculas"; o resto fica como veio.
  if (/[A-ZÀ-Ý]{3}/.test(s) && s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s-])(\S)/g, function (_, a, b) {
      return a + b.toUpperCase();
    });
  }
  return s || original || 'Compra no cartão';
}

/**
 * Categoria sugerida (C1, C2, C4). Ordem: encargo → o histórico do próprio
 * usuário (motor de insights; basta uma correção para aprender) → o
 * dicionário de palavras compartilhado com o bot. Só devolve categoria que
 * existe e está visível para o usuário.
 */
function impfatSugerirCategoria(desc, titulo, tipo, ctx) {
  var validas = ctx.categoriasValidas || {};
  if (tipo === 'encargo') {
    return validas.impostos_taxas
      ? { v: 'impostos_taxas', origem: 'regra' }
      : { v: null, origem: null };
  }
  if (ctx.insights && ctx.mapaInsights) {
    var s = ctx.insights.sugerirCategoria(desc, ctx.transacoes, {
      mapa: ctx.mapaInsights,
      minOcorrenciasCategoria: 1,
    });
    if (s && s.categoriaDespesa && validas[s.categoriaDespesa]) {
      return { v: s.categoriaDespesa, origem: 'historico' };
    }
  }
  if (ctx.palavras) {
    var v = ctx.palavras.sugerir(ctx.palavras.normalizar(desc + ' ' + titulo));
    if (v && validas[v]) return { v: v, origem: 'palavra' };
  }
  return { v: null, origem: null };
}

// ════════════════════════════════════════════════════════════
// 4. PLANEJAR: casar com o que já está no app
// ════════════════════════════════════════════════════════════

function impfatSomarMeses(ymd, k) {
  // Mesma aritmética de criarLancamentos (setMonth), para a parcela importada
  // cair no mesmo dia que a lançada à mão cairia.
  var p = ymd.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2]);
  d.setMonth(d.getMonth() + k);
  return impfatYmd(d);
}

function impfatMesVizinho(ymd, k) {
  var p = ymd.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1 + k, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function impfatRotuloMes(ymd) {
  var p = String(ymd).split('-');
  return p[1] + '/' + p[0];
}

function impfatRotuloDia(ymd) {
  var p = String(ymd).split('-');
  return p[2] + '/' + p[1];
}

function impfatValorParecido(a, b) {
  var dif = Math.abs(a - b);
  return dif <= Math.max(IMPFAT_LIMITES.parecidaAbs, Math.max(a, b) * IMPFAT_LIMITES.parecidaPct);
}

/**
 * O plano da importação. Não escreve nada.
 *
 * opts: { arquivo (de lerArquivo), vencimento 'AAAA-MM-DD', cartaoId,
 *         transacoes, categorias [{v,label}], insights, palavras,
 *         faturasImportadas ['AAAA-MM-DD' dos vencimentos deste cartão já importados] }
 *
 * Cada item: { ref, data, titulo, descricao, valor, fitid, tipo, parcela,
 *   categoriaDespesa, origemCategoria, status, motivo, marcado, casadoCom,
 *   valorApp, aviso }
 *
 * status:
 * Cada item que pede decisão traz `escolha` (a tela mostra as duas opções
 * por extenso; o padrão é o mais provável):
 *   parecida      'mesma' (corrige o valor do app para o do banco) | 'diferente'
 *   conflito      'manter' | 'diferente'
 *   outra_fatura  'mover' | 'diferente'
 *   reajuste      'atualizar' | 'manter'
 *   anulada c/ lançamento no app  'apagar' | 'manter'
 * 'diferente' = importar esta linha como compra nova, além da do app.
 *
 *   nova         entra (marcado)
 *   ja_lancada   já está no app, nesta fatura (P1, P2, P6)
 *   parecida     valor ou nome perto de um lançamento do app (P4) — só
 *                entra se o usuário marcar
 *   conflito     parcela com contagem diferente no app (P7) — idem
 *   outra_fatura está lançada na fatura vizinha (P5); marcado = mover
 *   reajuste     assinatura fixa com preço novo (U6/D2); marcado = atualizar
 *   anulada      compra e estorno na mesma fatura se anulam (D3a)
 *   credito_fora estorno de compra de outra fatura (D3b)
 *   ignorada     pagamento da fatura anterior, saldo anterior
 *   erro         linha sem valor legível
 */
function impfatPlanejar(opts) {
  var o = opts || {};
  var venc = o.vencimento;
  var cartaoId = o.cartaoId;
  var transacoes = o.transacoes || [];
  var validas = {};
  (o.categorias || []).forEach(function (c) {
    validas[c.v] = true;
  });
  var ctxCat = {
    categoriasValidas: validas,
    insights: o.insights || null,
    mapaInsights: o.insights ? o.insights.mapaCategorias(transacoes) : null,
    palavras: o.palavras || null,
    transacoes: transacoes,
  };

  var itens = (o.arquivo.linhas || []).map(function (l) {
    var valorOk = Number.isFinite(l.valor) && l.valor !== 0;
    var tipo = valorOk ? impfatTipo(l.titulo, l.valor) : 'erro';
    var desc = impfatLimparDescricao(l.titulo);
    var cat =
      tipo === 'compra' || tipo === 'encargo'
        ? impfatSugerirCategoria(desc, l.titulo, tipo, ctxCat)
        : { v: null, origem: null };
    return {
      ref: l.ref,
      data: l.data,
      titulo: l.titulo,
      descricao: desc,
      valor: valorOk ? l.valor : 0,
      fitid: l.fitid,
      tipo: tipo,
      parcela: tipo === 'compra' ? impfatParcela(l.titulo) : null,
      categoriaDespesa: cat.v,
      origemCategoria: cat.origem,
      status: null,
      motivo: '',
      marcado: false,
      casadoCom: null,
      valorApp: null,
      aviso: '',
    };
  });

  // Linhas que não viram lançamento.
  itens.forEach(function (it) {
    if (it.tipo === 'erro') {
      it.status = 'erro';
      it.motivo = 'Valor ilegível nesta linha — não entra.';
    } else if (it.tipo === 'pagamento') {
      it.status = 'ignorada';
      it.motivo = 'Pagamento da fatura anterior — no app, o pagamento é o "Marcar como paga".';
    } else if (it.tipo === 'saldo_anterior') {
      it.status = 'ignorada';
      it.motivo = 'Saldo da fatura anterior — já está na fatura passada.';
    }
  });

  // D3a: estorno de compra da MESMA fatura anula a compra. Exige valor igual
  // E nome parecido — só o valor juntaria um estorno a outra compra qualquer.
  itens
    .filter(function (it) {
      return it.tipo === 'credito';
    })
    .forEach(function (cr) {
      var alvo = itens.find(function (it) {
        return (
          !it.status &&
          (it.tipo === 'compra' || it.tipo === 'encargo') &&
          Math.abs(it.valor + cr.valor) <= IMPFAT_LIMITES.centavos &&
          (impfatSimilaridade(it.descricao, cr.titulo) >= IMPFAT_LIMITES.similaridade ||
            impfatNorm(cr.titulo).indexOf(impfatNorm(it.descricao)) !== -1)
        );
      });
      if (alvo) {
        alvo.status = 'anulada';
        alvo.motivo = 'Estornada nesta mesma fatura — a compra e o estorno se anulam.';
        cr.status = 'anulada';
        cr.motivo = 'Estorno de "' + alvo.descricao + '", nesta mesma fatura.';
      } else {
        cr.status = 'credito_fora';
        cr.motivo =
          'Crédito ou estorno de uma compra de outra fatura. O app não importa crédito: edite ou apague a compra original.';
      }
    });

  var daFatura = transacoes.filter(function (t) {
    return t.categoria === 'cartao_credito' && t.cartaoId === cartaoId && t.dataVencimento === venc;
  });
  var usados = {};
  function livre(t) {
    return !usados[t.id];
  }
  function usar(it, t, status, motivo) {
    usados[t.id] = true;
    it.casadoCom = t.id;
    it.valorApp = Number(t.valor) || 0;
    it.status = status;
    it.motivo = motivo;
  }
  function melhor(cands, it) {
    var m = null;
    var mSim = -1;
    cands.forEach(function (t) {
      var sim = impfatSimilaridade(t.descricao, it.descricao);
      if (sim > mSim) {
        mSim = sim;
        m = t;
      }
    });
    return m;
  }
  var reParcela = /\((\d+)\/(\d+)\)\s*$/;
  // Casamento pelo MELHOR PAR do conjunto, não pela ordem das linhas: nome
  // mais parecido primeiro, depois o valor mais perto. Achado pela caça de
  // furos: "Juros R$ 13,60" vinha antes na fatura e levava o "ótica 14" do
  // Telegram, e a ótica de verdade (R$ 13,92) entrava como nova.
  function casarMelhoresPares(lista, aceita, status, motivoDe) {
    var pares = [];
    lista.forEach(function (it) {
      daFatura.forEach(function (t) {
        if (!livre(t) || !aceita(it, t)) return;
        pares.push({
          it: it,
          t: t,
          sim: impfatSimilaridade(t.descricao, it.descricao),
          dif: Math.abs((Number(t.valor) || 0) - it.valor),
        });
      });
    });
    pares.sort(function (a, b) {
      return b.sim - a.sim || a.dif - b.dif || a.it.ref - b.it.ref;
    });
    pares.forEach(function (par) {
      if (par.it.status || !livre(par.t)) return;
      usar(par.it, par.t, status, motivoDe(par.t));
    });
  }
  // Lançamento sem "(N/M)" é compra à vista: nunca é a parcela de outra
  // compra, e vice-versa.
  function mesmaForma(it, t) {
    return !!it.parcela === reParcela.test(String(t.descricao || ''));
  }
  var pendentes = function () {
    return itens.filter(function (it) {
      return !it.status && (it.tipo === 'compra' || it.tipo === 'encargo');
    });
  };

  // (a) P6: a mesma linha, importada antes (FITID do OFX).
  pendentes().forEach(function (it) {
    if (!it.fitid) return;
    var t = daFatura.find(function (x) {
      return livre(x) && x.importacao && x.importacao.fitid === it.fitid;
    });
    if (t) usar(it, t, 'ja_lancada', 'Já importada antes.');
  });

  // (b) P2: parcela N/M casa com o lançamento "(N/M)" desta fatura. TODAS as
  // parcelas exatas casam antes de se procurar conflito (P7) — achado pela
  // caça de furos: "Cinema 1/10" (compra nova) pegava como conflito o "(3/12)"
  // de outra compra no mesmo cinema, e a linha 3/12 ficava sem par e era
  // criada de novo.
  pendentes().forEach(function (it) {
    if (!it.parcela) return;
    var p = it.parcela;
    var mesma = daFatura.filter(function (t) {
      var m = String(t.descricao || '').match(reParcela);
      return (
        livre(t) &&
        m &&
        +m[1] === p.n &&
        +m[2] === p.m &&
        Math.abs((Number(t.valor) || 0) - it.valor) <= IMPFAT_LIMITES.parcelaCentavos
      );
    });
    var t = melhor(mesma, it);
    if (t) usar(it, t, 'ja_lancada', 'Parcela ' + p.n + '/' + p.m + ' já está no app.');
  });

  // P7: lançado à mão (ou pelo Telegram) com outro número de parcelas — a
  // mesma parcela N, o mesmo nome, M diferente. O que a importação criou está
  // ancorado no banco e nunca é "conflito".
  pendentes().forEach(function (it) {
    if (!it.parcela) return;
    var p = it.parcela;
    var outra = daFatura.filter(function (t) {
      var m = String(t.descricao || '').match(reParcela);
      return (
        livre(t) &&
        !t.importacao &&
        m &&
        +m[1] === p.n &&
        +m[2] !== p.m &&
        impfatSimilaridade(t.descricao, it.descricao) >= IMPFAT_LIMITES.similaridade
      );
    });
    var t = melhor(outra, it);
    if (t) {
      usar(
        it,
        t,
        'conflito',
        'No app esta compra está como "' +
          t.descricao +
          '"; no banco é a parcela ' +
          p.n +
          '/' +
          p.m +
          '. Confira antes de importar.'
      );
    }
  });

  // (c) P1/P3: valor igual na mesma fatura, um para um. O nome parecido só
  // desempata — quem lança "mercado" pelo Telegram não escreve o CNPJ da loja.
  // NOME EM COMUM E VALOR IGUAL OU QUASE IGUAL (lançada pelo Telegram com o
  // valor arredondado) — a evidência mais forte depois do FITID e da parcela,
  // por isso vem antes do casamento só pelo valor. Entram na MESMA disputa as
  // compras estornadas nesta fatura (aviso: "apague") e as que seguem valendo:
  // cada lançamento do app vai para a linha mais parecida, e entre iguais para
  // o valor mais perto. A caça de furos achou os dois lados: o aviso mandava
  // apagar o "açougue 31" de uma compra legítima de R$ 31,14 por causa de uma
  // estornada de R$ 31,48; e o "livraria 124" estornado casava, só pelo valor,
  // com uma compra de R$ 124,00 em outra loja.
  (function () {
    var limite = function (v) {
      return Math.max(IMPFAT_LIMITES.quaseIgualAbs, v * IMPFAT_LIMITES.quaseIgualPct);
    };
    var alvos = itens.filter(function (it) {
      return (
        (!it.status && (it.tipo === 'compra' || it.tipo === 'encargo')) ||
        (it.status === 'anulada' && it.valor > 0)
      );
    });
    var pares = [];
    alvos.forEach(function (it) {
      daFatura.forEach(function (t) {
        if (!livre(t) || !mesmaForma(it, t) || t.cartaoFixoMensal) return;
        var dif = Math.abs((Number(t.valor) || 0) - it.valor);
        if (dif > limite(it.valor)) return;
        var sim = impfatSimilaridade(t.descricao, it.descricao);
        if (sim < IMPFAT_LIMITES.similaridade) return;
        pares.push({ it: it, t: t, sim: sim, dif: dif });
      });
    });
    pares.sort(function (a, b) {
      return b.sim - a.sim || a.dif - b.dif || a.it.ref - b.it.ref;
    });
    var feitos = {};
    pares.forEach(function (par) {
      var it = par.it;
      var t = par.t;
      if (feitos[it.ref] || !livre(t)) return;
      feitos[it.ref] = true;
      if (it.status === 'anulada') {
        usados[t.id] = true;
        it.casadoCom = t.id;
        it.valorApp = Number(t.valor) || 0;
        it.aviso = 'Está lançada no app como "' + t.descricao + '": apague, porque foi estornada.';
      } else if (par.dif <= IMPFAT_LIMITES.centavos) {
        usar(it, t, 'ja_lancada', 'Já lançada no app como "' + t.descricao + '".');
      } else {
        usar(
          it,
          t,
          'parecida',
          'Parecida com "' +
            t.descricao +
            '" (' +
            impfatMoeda(Number(t.valor) || 0) +
            '), já no app. Se for a mesma compra, deixe desmarcada.'
        );
        it.marcado = false;
      }
    });
  })();

  // Parcela só casa com lançamento parcelado, e à vista só com à vista
  // (mesmaForma): o "doceria 33" do Telegram casava pelo valor com a "Auto
  // Peças 4/7 R$ 33,00", e a importação do mês da compra criava a 4/7 de novo
  // (caça de furos).
  casarMelhoresPares(
    pendentes(),
    function (it, t) {
      return (
        mesmaForma(it, t) && Math.abs((Number(t.valor) || 0) - it.valor) <= IMPFAT_LIMITES.centavos
      );
    },
    'ja_lancada',
    function (t) {
      return 'Já lançada no app como "' + t.descricao + '".';
    }
  );

  // (d) U6/D2: assinatura fixa no cartão com preço novo.
  pendentes().forEach(function (it) {
    var cands = daFatura.filter(function (t) {
      return (
        livre(t) &&
        t.cartaoFixoMensal &&
        impfatSimilaridade(t.descricao, it.descricao) >= IMPFAT_LIMITES.similaridade
      );
    });
    var t = melhor(cands, it);
    if (t) {
      usar(
        it,
        t,
        'reajuste',
        'Assinatura "' +
          t.descricao +
          '" está no app por ' +
          impfatMoeda(Number(t.valor) || 0) +
          '. Atualizar para ' +
          impfatMoeda(it.valor) +
          ' a partir desta fatura?'
      );
      it.marcado = true;
    }
  });

  // (e) P5: lançada na fatura vizinha (mês antes ou depois), ainda não paga.
  var vizinhos = [impfatMesVizinho(venc, -1), impfatMesVizinho(venc, 1)];
  var daVizinha = transacoes.filter(function (t) {
    return (
      t.categoria === 'cartao_credito' &&
      t.cartaoId === cartaoId &&
      !t.pago &&
      !t.cartaoFixoMensal &&
      t.dataVencimento &&
      vizinhos.indexOf(String(t.dataVencimento).slice(0, 7)) !== -1 &&
      // Achado pela caça de furos: a parcela 2/12 de dezembro tem o mesmo nome
      // e valor da 1/12 de novembro e era "movida" — a fatura de dezembro
      // perdia a parcela. Parcela e o que a importação criou estão na fatura
      // certa por definição; mover é só para a compra à vista lançada à mão.
      !t.importacao &&
      !/\(\d+\/\d+\)\s*$/.test(String(t.descricao || '')) &&
      // Fatura vizinha que JÁ foi importada foi conferida com o banco: o que
      // está lá é dela. Mover de lá fazia uma compra sumir (caça de furos).
      (o.faturasImportadas || []).indexOf(t.dataVencimento) === -1
    );
  });
  pendentes().forEach(function (it) {
    if (it.parcela) return;
    var cands = daVizinha.filter(function (t) {
      return (
        livre(t) &&
        Math.abs((Number(t.valor) || 0) - it.valor) <= IMPFAT_LIMITES.centavos &&
        impfatSimilaridade(t.descricao, it.descricao) >= IMPFAT_LIMITES.similaridade
      );
    });
    var t = melhor(cands, it);
    if (t) {
      usar(
        it,
        t,
        'outra_fatura',
        'Está lançada no app na fatura de ' +
          impfatRotuloMes(t.dataVencimento) +
          '. Mover para esta fatura?'
      );
      it.marcado = true;
    }
  });

  // (f) P4: parecida — nome em comum e valor perto, ou valor quase igual
  // mesmo com outro nome (só para compra: juros e IOF não se lançam pelo
  // Telegram com outro nome). Não entra sozinha.
  casarMelhoresPares(
    pendentes(),
    function (it, t) {
      var v = Number(t.valor) || 0;
      var quaseIgual =
        it.tipo === 'compra' &&
        Math.abs(v - it.valor) <=
          Math.max(IMPFAT_LIMITES.quaseIgualAbs, it.valor * IMPFAT_LIMITES.quaseIgualPct);
      return (
        !t.cartaoFixoMensal &&
        mesmaForma(it, t) &&
        (quaseIgual ||
          (impfatValorParecido(v, it.valor) &&
            impfatSimilaridade(t.descricao, it.descricao) >= IMPFAT_LIMITES.similaridade))
      );
    },
    'parecida',
    function (t) {
      return (
        'Parecida com "' +
        t.descricao +
        '" (' +
        impfatMoeda(Number(t.valor) || 0) +
        '), já no app. Se for a mesma compra, deixe desmarcada.'
      );
    }
  );
  itens.forEach(function (it) {
    if (it.status === 'parecida') it.marcado = false;
  });

  // O resto é novo.
  pendentes().forEach(function (it) {
    it.status = 'nova';
    it.marcado = true;
    if (it.parcela && it.parcela.n > 1) {
      it.motivo =
        'Entram as parcelas ' +
        it.parcela.n +
        ' a ' +
        it.parcela.m +
        ' (as anteriores são de faturas passadas).';
    } else if (it.parcela) {
      it.motivo = 'Entram as ' + it.parcela.m + ' parcelas, uma por fatura.';
    }
  });

  // Padrão de cada decisão: o mais provável, e o que deixa a fatura do app
  // igual à do banco.
  itens.forEach(function (it) {
    if (it.status === 'parecida') it.escolha = 'mesma';
    else if (it.status === 'conflito') it.escolha = 'manter';
    else if (it.status === 'outra_fatura') it.escolha = 'mover';
    else if (it.status === 'reajuste') it.escolha = 'atualizar';
    else if (it.status === 'anulada' && it.casadoCom) it.escolha = 'apagar';
    if (it.escolha) it.marcado = false;
  });

  // Parcelas FUTURAS que já estão no app não são criadas de novo. Achado pela
  // caça de furos: importar novembro e depois outubro criava duas vezes as
  // parcelas de novembro em diante (uma por importação). Casa como a parcela
  // desta fatura (b): mesmo N/M e valor, um para um.
  var futurasUsadas = {};
  itens.forEach(function (it) {
    if (['nova', 'parecida', 'conflito', 'outra_fatura'].indexOf(it.status) === -1) return;
    var p = it.parcela;
    if (!p) return;
    it.criar = [];
    for (var k = p.n; k <= p.m; k++) {
      if (k === p.n) {
        it.criar.push(k);
        continue;
      }
      var vk = impfatSomarMeses(venc, k - p.n);
      var ja = transacoes.find(function (t) {
        var mm = String(t.descricao || '').match(/\((\d+)\/(\d+)\)\s*$/);
        return (
          !futurasUsadas[t.id] &&
          t.categoria === 'cartao_credito' &&
          t.cartaoId === cartaoId &&
          t.dataVencimento === vk &&
          mm &&
          +mm[1] === k &&
          +mm[2] === p.m &&
          Math.abs((Number(t.valor) || 0) - it.valor) <= IMPFAT_LIMITES.parcelaCentavos
        );
      });
      if (ja) futurasUsadas[ja.id] = true;
      else it.criar.push(k);
    }
    if (it.status === 'nova' && it.criar.length < p.m - p.n + 1) {
      it.motivo =
        'Entra esta parcela' +
        (it.criar.length > 1 ? ' e mais ' + (it.criar.length - 1) : '') +
        '; ' +
        (p.m - p.n + 1 - it.criar.length) +
        ' parcela(s) seguinte(s) já estão no app.';
    }
  });

  // Lançado no app nesta fatura e ausente do arquivo: explica total diferente.
  var soNoApp = daFatura.filter(livre).map(function (t) {
    return { id: t.id, descricao: t.descricao, valor: Number(t.valor) || 0 };
  });

  return {
    vencimento: venc,
    cartaoId: cartaoId,
    banco: o.arquivo.banco,
    formato: o.arquivo.formato,
    totalBanco: o.arquivo.totalBanco,
    itens: itens,
    soNoApp: soNoApp,
    appAntes: impfatArred(
      daFatura.reduce(function (s, t) {
        return s + (Number(t.valor) || 0);
      }, 0)
    ),
  };
}

function impfatMoeda(v) {
  return (
    'R$ ' +
    (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** Itens que viram lançamento novo com as escolhas atuais. */
function impfatEntra(it) {
  if (it.status === 'nova') return !!it.marcado;
  return (
    it.escolha === 'diferente' &&
    (it.status === 'parecida' || it.status === 'conflito' || it.status === 'outra_fatura')
  );
}

/** Quanto cada item tira ou põe na fatura do app, além das compras novas. */
function impfatAjusteNoApp(it) {
  if (it.status === 'outra_fatura' && it.escolha === 'mover') return it.valorApp;
  if (it.status === 'reajuste' && it.escolha === 'atualizar') return it.valor - it.valorApp;
  if (it.status === 'parecida' && it.escolha === 'mesma') return it.valor - it.valorApp;
  if (it.status === 'anulada' && it.escolha === 'apagar') return -it.valorApp;
  return 0;
}

// Por que o total do app (depois de importar) pode diferir do total do banco.
// A soma destes motivos fecha a diferença EXATAMENTE — os testes conferem
// isso em toda fatura sintética (test/importar-fatura-dialetos.test.js).
var IMPFAT_MOTIVOS = {
  so_no_app: 'lançado(s) no app que não estão no arquivo',
  desmarcadas: 'compra(s) desmarcada(s)',
  parecidas_mantidas: 'parecida(s) mantida(s) com o valor do app',
  parecidas_importadas: 'parecida(s) importada(s) além da que já estava no app',
  reajuste_mantido: 'assinatura mantida no preço antigo',
  estornada_no_app: 'compra estornada que continua no app (apague)',
  creditos: 'crédito(s) de compra de outra fatura (o app não importa crédito)',
  saldo_anterior: 'saldo da fatura anterior (já está na fatura passada)',
  centavos: 'diferença de centavos em compras que já estavam no app',
};

/**
 * Totais para o rodapé (E3): o que o banco cobra, o que o app vai ter nesta
 * fatura depois de importar, e o PORQUÊ da diferença, motivo a motivo.
 *
 * Sem total no arquivo (CSV), o "total do banco" é a soma das compras e
 * encargos com os estornos anulados — crédito de outra fatura e saldo
 * anterior ficam fora dos dois lados.
 */
function impfatResumo(plano) {
  var temLedger = plano.totalBanco != null;
  var novas = 0;
  var qtdNovas = 0;
  var lancamentosCriados = 0;
  var ateVencimento = null;
  var depois = plano.appAntes;
  var motivos = {};
  function motivo(chave, valor) {
    if (!motivos[chave])
      motivos[chave] = { chave: chave, rotulo: IMPFAT_MOTIVOS[chave], qtd: 0, valor: 0 };
    motivos[chave].qtd++;
    motivos[chave].valor += valor;
  }
  var calculado = 0;
  plano.itens.forEach(function (it) {
    if (it.tipo === 'compra' || it.tipo === 'encargo') calculado += it.valor;
    else if (it.tipo === 'credito' && it.status === 'anulada') calculado += it.valor;

    if (impfatEntra(it)) {
      novas += it.valor;
      qtdNovas++;
      depois += it.valor;
      lancamentosCriados += it.criar ? it.criar.length : 1;
    }
    depois += impfatAjusteNoApp(it);
    if (impfatEntra(it) && it.criar) {
      var ultimoK = it.criar[it.criar.length - 1];
      var vUlt = impfatSomarMeses(plano.vencimento, ultimoK - it.parcela.n);
      if (!ateVencimento || vUlt > ateVencimento) ateVencimento = vUlt;
    }

    var st = it.status;
    if (st === 'nova' && !it.marcado) motivo('desmarcadas', -it.valor);
    else if (st === 'parecida' || st === 'conflito') {
      if (it.escolha === 'diferente') motivo('parecidas_importadas', it.valorApp);
      else if (it.escolha !== 'mesma') motivo('parecidas_mantidas', it.valorApp - it.valor);
    } else if (st === 'ja_lancada') {
      if (Math.abs(it.valorApp - it.valor) >= 0.005) motivo('centavos', it.valorApp - it.valor);
    } else if (st === 'outra_fatura') {
      if (it.escolha === 'mover' && Math.abs(it.valorApp - it.valor) >= 0.005)
        motivo('centavos', it.valorApp - it.valor);
    } else if (st === 'reajuste' && it.escolha === 'manter')
      motivo('reajuste_mantido', it.valorApp - it.valor);
    else if (st === 'anulada' && it.valor > 0 && it.valorApp != null && it.escolha !== 'apagar')
      motivo('estornada_no_app', it.valorApp);
    else if (st === 'credito_fora' && temLedger) motivo('creditos', -it.valor);
    else if (st === 'ignorada' && it.tipo === 'saldo_anterior' && temLedger)
      motivo('saldo_anterior', -it.valor);
  });
  (plano.soNoApp || []).forEach(function (x) {
    motivo('so_no_app', x.valor);
  });
  var totalBanco = temLedger ? plano.totalBanco : impfatArred(calculado);
  depois = impfatArred(depois);
  var porque = Object.keys(motivos)
    .map(function (k) {
      motivos[k].valor = impfatArred(motivos[k].valor);
      return motivos[k];
    })
    .filter(function (m) {
      return Math.abs(m.valor) >= 0.005;
    });
  return {
    totalBanco: totalBanco,
    appAntes: plano.appAntes,
    appDepois: depois,
    diferenca: impfatArred(depois - totalBanco),
    porque: porque,
    qtdNovas: qtdNovas,
    valorNovas: impfatArred(novas),
    lancamentosCriados: lancamentosCriados,
    // Parcelas que entram nas PRÓXIMAS faturas (a tela diz antes de importar).
    parcelasFuturas: lancamentosCriados - qtdNovas,
    ateVencimento: ateVencimento,
    qtdJaLancadas: plano.itens.filter(function (it) {
      return it.status === 'ja_lancada';
    }).length,
    qtdNaoEntram: plano.itens.filter(function (it) {
      return ['ignorada', 'anulada', 'credito_fora', 'erro'].indexOf(it.status) !== -1;
    }).length,
    soNoApp: plano.soNoApp,
  };
}

// ════════════════════════════════════════════════════════════
// 5. APLICAR E DESFAZER
// ════════════════════════════════════════════════════════════

/**
 * Monta o que muda, a partir do plano revisado. Não grava: quem chama põe os
 * `novos` em `transacoes`, aplica as `alteracoes` e salva uma vez só (G1).
 *
 * ctx: { transacoes, agora (Date), idBase (string), importacaoId, arquivo }
 * → { novos, alteracoes [{ id, antes, depois }], registro }
 */
function impfatAplicar(plano, ctx) {
  var agora = ctx.agora instanceof Date ? ctx.agora : new Date();
  var idBase = ctx.idBase != null ? String(ctx.idBase) : String(agora.getTime());
  var impId = ctx.importacaoId || 'imp' + idBase;
  var porId = {};
  (ctx.transacoes || []).forEach(function (t) {
    porId[t.id] = t;
  });
  var novos = [];
  var alteracoes = [];
  var removidos = [];
  var seq = 0;

  plano.itens.forEach(function (it) {
    if (impfatEntra(it)) {
      var grupo = impId + 'g' + it.ref;
      var p = it.parcela;
      var de = p ? p.n : 1;
      var ks = it.criar || [de];
      ks.forEach(function (k) {
        var venc = impfatSomarMeses(plano.vencimento, k - de);
        var vp = venc.split('-').map(Number);
        novos.push({
          // Prefixo próprio: o id manual é Date.now()+i e poderia colidir.
          id: impId + '_' + seq++,
          groupId: grupo,
          descricao: p ? it.descricao + ' (' + k + '/' + p.m + ')' : it.descricao,
          valor: it.valor,
          categoria: 'cartao_credito',
          cartaoId: plano.cartaoId,
          cartaoFixoMensal: undefined,
          banco: undefined,
          contaId: undefined,
          categoriaDespesa: it.categoriaDespesa || undefined,
          obs: it.titulo && it.titulo !== it.descricao ? it.titulo : '',
          mes: vp[1] - 1, // INV-08: competência = mês do vencimento
          ano: vp[0],
          data: agora.toISOString(),
          dataVencimento: venc,
          pago: false,
          // D4: só é a data da compra na compra à vista e na parcela 1 — a
          // parcela antiga vem com a data do início do ciclo.
          dataCompra: !p || p.n === 1 ? it.data || undefined : undefined,
          importacao: {
            id: impId,
            banco: plano.banco || 'nubank',
            fitid: k === de ? it.fitid || undefined : undefined,
          },
        });
      });
    } else if (it.status === 'outra_fatura' && it.escolha === 'mover' && porId[it.casadoCom]) {
      var t = porId[it.casadoCom];
      var p2 = plano.vencimento.split('-').map(Number);
      alteracoes.push({
        id: t.id,
        antes: { dataVencimento: t.dataVencimento, mes: t.mes, ano: t.ano },
        depois: { dataVencimento: plano.vencimento, mes: p2[1] - 1, ano: p2[0] },
      });
    } else if (it.status === 'parecida' && it.escolha === 'mesma' && porId[it.casadoCom]) {
      // "Mesma compra": o valor do app vira o do banco (lançada arredondada).
      var par = porId[it.casadoCom];
      if (Math.abs((Number(par.valor) || 0) - it.valor) >= 0.005) {
        alteracoes.push({ id: par.id, antes: { valor: par.valor }, depois: { valor: it.valor } });
      }
    } else if (it.status === 'anulada' && it.escolha === 'apagar' && porId[it.casadoCom]) {
      // Estornada no banco: sai do app junto (o Desfazer devolve no lugar).
      var est = porId[it.casadoCom];
      removidos.push({
        indice: (ctx.transacoes || []).indexOf(est),
        t: JSON.parse(JSON.stringify(est)),
      });
    } else if (it.status === 'reajuste' && it.escolha === 'atualizar' && porId[it.casadoCom]) {
      var fixo = porId[it.casadoCom];
      // Esta e as próximas, ainda não pagas, da mesma assinatura.
      (ctx.transacoes || []).forEach(function (x) {
        if (
          x.cartaoFixoMensal &&
          !x.pago &&
          (x === fixo ||
            (fixo.groupId && x.groupId === fixo.groupId && x.dataVencimento >= plano.vencimento))
        ) {
          alteracoes.push({ id: x.id, antes: { valor: x.valor }, depois: { valor: it.valor } });
        }
      });
    }
  });

  removidos.sort(function (a, b) {
    return a.indice - b.indice;
  });
  return {
    novos: novos,
    alteracoes: alteracoes,
    removidos: removidos,
    registro: {
      id: impId,
      cartaoId: plano.cartaoId,
      vencimento: plano.vencimento,
      arquivo: ctx.arquivo || '',
      em: agora.toISOString(),
      criados: novos.length,
      totalBanco: plano.totalBanco,
      alteracoes: alteracoes,
      removidos: removidos,
    },
  };
}

/** Aplica as alteracoes de `aplicar` sobre `transacoes` (in place). */
function impfatAplicarAlteracoes(transacoes, alteracoes, lado) {
  var porId = {};
  transacoes.forEach(function (t) {
    porId[t.id] = t;
  });
  (alteracoes || []).forEach(function (a) {
    var t = porId[a.id];
    if (t) Object.assign(t, a[lado || 'depois']);
  });
}

/**
 * Desfaz uma importação (G4): tira só o que ELA criou e ainda não foi pago, e
 * devolve as mudanças (mover, reajuste) dos lançamentos ainda não pagos.
 * Devolve a nova lista e quantos ficaram por já estarem pagos.
 */
function impfatDesfazer(transacoes, registro) {
  var mantidos = 0;
  var removidos = 0;
  var lista = transacoes.filter(function (t) {
    if (!t.importacao || t.importacao.id !== registro.id) return true;
    if (t.pago) {
      mantidos++;
      return true;
    }
    removidos++;
    return false;
  });
  var naoPagas = (registro.alteracoes || []).filter(function (a) {
    var t = lista.find(function (x) {
      return x.id === a.id;
    });
    return t && !t.pago;
  });
  impfatAplicarAlteracoes(lista, naoPagas, 'antes');
  // O que a importação apagou (compra estornada) volta no mesmo lugar.
  var devolvidos = 0;
  (registro.removidos || []).forEach(function (x) {
    if (
      lista.some(function (t) {
        return t.id === x.t.id;
      })
    )
      return;
    var copia = JSON.parse(JSON.stringify(x.t));
    if (x.indice >= 0 && x.indice <= lista.length) lista.splice(x.indice, 0, copia);
    else lista.push(copia);
    devolvidos++;
  });
  return {
    devolvidos: devolvidos,
    transacoes: lista,
    removidos: removidos,
    mantidosPagos: mantidos,
    restaurados: naoPagas.length,
  };
}

/**
 * Confirma a importação sobre a lista `transacoes` (in place): aplica as
 * alterações e acrescenta os novos. É o MESMO caminho da tela e da caça de
 * furos (test/_sequencias-importacao.js) — sem cópia que possa divergir.
 * Devolve o resultado de `aplicar` (novos, alteracoes, registro).
 */
function impfatConfirmar(transacoes, plano, ctx) {
  var r = impfatAplicar(plano, Object.assign({}, ctx, { transacoes: transacoes }));
  impfatAplicarAlteracoes(transacoes, r.alteracoes, 'depois');
  var fora = {};
  r.removidos.forEach(function (x) {
    fora[x.t.id] = true;
  });
  for (var i = transacoes.length - 1; i >= 0; i--) {
    if (fora[transacoes[i].id]) transacoes.splice(i, 1);
  }
  r.novos.forEach(function (t) {
    transacoes.push(t);
  });
  return r;
}

/** A mesma fatura (cartão + vencimento) já importada antes? (U15) */
function impfatJaImportada(registros, cartaoId, vencimento) {
  return (
    (registros || [])
      .filter(function (r) {
        return r && r.cartaoId === cartaoId && r.vencimento === vencimento;
      })
      .sort(function (a, b) {
        return String(b.em).localeCompare(String(a.em));
      })[0] || null
  );
}

var AppliqueiImportarFatura = {
  LIMITES: IMPFAT_LIMITES,
  MENSAGENS: IMPFAT_MENSAGENS,
  decodificar: impfatDecodificar,
  lerArquivo: impfatLerArquivo,
  vencimentoDoNome: impfatVencimentoDoNome,
  adivinharVencimento: impfatAdivinharVencimento,
  tipo: impfatTipo,
  parcela: impfatParcela,
  limparDescricao: impfatLimparDescricao,
  numero: impfatNumero,
  data: impfatData,
  similaridade: impfatSimilaridade,
  planejar: impfatPlanejar,
  resumo: impfatResumo,
  entra: impfatEntra,
  aplicar: impfatAplicar,
  aplicarAlteracoes: impfatAplicarAlteracoes,
  confirmar: impfatConfirmar,
  desfazer: impfatDesfazer,
  jaImportada: impfatJaImportada,
  rotuloDia: impfatRotuloDia,
  rotuloMes: impfatRotuloMes,
  moeda: impfatMoeda,
};
if (typeof window !== 'undefined') window.AppliqueiImportarFatura = AppliqueiImportarFatura;
if (typeof module !== 'undefined' && module.exports) module.exports = AppliqueiImportarFatura;
