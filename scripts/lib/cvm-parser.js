'use strict';

// Parser dos dados abertos da CVM — a fonte primária dos fundamentos.
//
// Por que a CVM e não uma API de mercado: os indicadores do motor deixam de
// depender do plano comercial de um terceiro e passam a depender do
// documento que a companhia é LEGALMENTE OBRIGADA a publicar. É gratuito,
// sem chave, sem cota — e auditável pelo cliente, que é o que sustenta a
// confiança num produto pago.
//
// Este arquivo é puro: recebe texto de CSV, devolve números. Download,
// descompactação e escrita no Firestore ficam em scripts/ingest-cvm.js, para
// tudo o que decide valor poder ser testado sem rede.
//
// PRINCÍPIO CENTRAL — nunca produzir número que não se sustenta. Coluna que
// não aparece, conta que não existe e resultado implausível viram `null` com
// motivo registado, jamais zero ou estimativa. Um zero fabricado aqui vira
// nota zero no score, e o cliente lê isso como veredito sobre a empresa.

// ── Layout dos arquivos ──
//
// Os nomes de coluna da CVM já mudaram de forma ao longo dos anos (acento,
// underscore, maiúsculas). Por isso nada é procurado por igualdade exata:
// cada campo tem lista de apelidos e a busca é sobre a chave normalizada.
const COLUNAS = {
  cdCvm: ['CD_CVM', 'CODIGO_CVM'],
  cnpj: ['CNPJ_CIA', 'CNPJ_FUNDO', 'CNPJ'],
  denominacao: ['DENOM_CIA', 'DENOM_SOCIAL', 'NM_FUNDO', 'DENOM_FUNDO'],
  dataReferencia: ['DT_REFER', 'DATA_REFERENCIA', 'DT_COMPTC'],
  dataFimExercicio: ['DT_FIM_EXERC', 'DT_FIM_EXERCICIO'],
  ordemExercicio: ['ORDEM_EXERC', 'ORDEM_EXERCICIO'],
  codigoConta: ['CD_CONTA', 'CODIGO_CONTA'],
  descricaoConta: ['DS_CONTA', 'DESCRICAO_CONTA'],
  valorConta: ['VL_CONTA', 'VALOR_CONTA'],
  escalaMoeda: ['ESCALA_MOEDA', 'ESCALA'],
  versao: ['VERSAO'],
};

// Plano de contas padrão da CVM. `termos` é rede de segurança: se o código
// mudar de numeração, a descrição ainda identifica a linha.
const CONTAS = {
  ativoTotal: { codigos: ['1'], termos: ['ativo total'] },
  ativoCirculante: { codigos: ['1.01'], termos: ['ativo circulante'] },
  caixa: { codigos: ['1.01.01'], termos: ['caixa e equivalentes de caixa'] },
  aplicacoesFinanceiras: { codigos: ['1.01.02'], termos: ['aplicacoes financeiras'] },
  passivoCirculante: { codigos: ['2.01'], termos: ['passivo circulante'] },
  dividaCurtoPrazo: { codigos: ['2.01.04'], termos: ['emprestimos e financiamentos'] },
  dividaLongoPrazo: { codigos: ['2.02.01'], termos: ['emprestimos e financiamentos'] },
  patrimonioLiquido: {
    codigos: ['2.03'],
    termos: ['patrimonio liquido consolidado', 'patrimonio liquido'],
  },
  receita: { codigos: ['3.01'], termos: ['receita de venda', 'receita liquida'] },
  ebit: { codigos: ['3.05'], termos: ['antes do resultado financeiro'] },
  resultadoAntesTributos: { codigos: ['3.07'], termos: ['antes dos tributos'] },
  tributos: { codigos: ['3.08'], termos: ['imposto de renda'] },
  lucroLiquido: {
    codigos: ['3.11', '3.09'],
    termos: ['lucro/prejuizo consolidado do periodo', 'lucro/prejuizo do periodo'],
  },
};

// Alíquota usada no ROIC quando a DRE não permite calcular a efetiva.
// 34% é a soma nominal de IRPJ (25%) e CSLL (9%) no Brasil.
const ALIQUOTA_NOMINAL = 0.34;

/** Chave comparável: sem acento, sem separador, maiúscula. */
function normalizarChave(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Texto comparável para busca por descrição: minúsculo, sem acento. */
function normalizarTexto(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * CSV da CVM: separador `;`, cabeçalho na primeira linha, aspas ocasionais.
 * O parse é manual porque o dialeto é fixo e conhecido — e porque uma
 * dependência de CSV num job com escrita em produção não se paga.
 */
function parseCsvCvm(texto, opcoes) {
  const op = opcoes || {};
  const sep = op.separador || ';';
  const bruto = String(texto || '').replace(/^﻿/, '');
  const linhas = bruto.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!linhas.length) return { colunas: [], registros: [] };

  const dividir = (linha) => {
    const out = [];
    let atual = '';
    let dentroAspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (c === '"') {
        if (dentroAspas && linha[i + 1] === '"') {
          atual += '"';
          i++;
        } else {
          dentroAspas = !dentroAspas;
        }
      } else if (c === sep && !dentroAspas) {
        out.push(atual);
        atual = '';
      } else {
        atual += c;
      }
    }
    out.push(atual);
    return out.map((v) => v.trim());
  };

  const colunas = dividir(linhas[0]);
  const registros = [];
  for (let i = 1; i < linhas.length; i++) {
    const campos = dividir(linhas[i]);
    // Linha com contagem de campos diferente do cabeçalho é linha corrompida.
    // Descartar uma é melhor do que deslocar todas as colunas em silêncio.
    if (campos.length !== colunas.length) continue;
    const reg = {};
    for (let c = 0; c < colunas.length; c++) reg[colunas[c]] = campos[c];
    registros.push(reg);
  }
  return { colunas, registros };
}

/** Nome real da coluna que corresponde a um dos apelidos, ou null. */
function acharColuna(colunas, apelidos) {
  const mapa = new Map();
  for (const c of colunas) mapa.set(normalizarChave(c), c);
  for (const a of apelidos) {
    const achou = mapa.get(normalizarChave(a));
    if (achou) return achou;
  }
  return null;
}

/**
 * Resolve todas as colunas de que o parse precisa e diz quais faltaram.
 *
 * Devolver o que faltou (em vez de lançar) é o que permite ao --dry-run
 * mostrar o layout real do arquivo quando a CVM mudar alguma coisa.
 */
function resolverColunas(colunas, obrigatorias) {
  const mapa = {};
  const faltando = [];
  for (const campo of obrigatorias) {
    const real = acharColuna(colunas, COLUNAS[campo] || [campo]);
    if (real) mapa[campo] = real;
    else faltando.push(campo);
  }
  return { mapa, faltando };
}

/**
 * VL_CONTA -> número.
 *
 * A CVM publica com ponto decimal e sem separador de milhar
 * (`-1234567.89`), mas já houve arquivo em formato pt-BR. Quando aparecem os
 * dois separadores, o último é o decimal — regra que resolve os dois casos
 * sem adivinhar.
 */
function valorNumericoCvm(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s || s === '-') return null;
  const temPonto = s.includes('.');
  const temVirgula = s.includes(',');
  if (temPonto && temVirgula) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (temVirgula) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** ESCALA_MOEDA da CVM: valores podem vir em milhares. */
function fatorEscala(escala) {
  const e = normalizarChave(escala);
  if (e === 'MIL' || e === 'MILHARES') return 1000;
  if (e === 'MILHAO' || e === 'MILHOES') return 1000000;
  return 1;
}

/**
 * Valor de uma conta dentro de um conjunto de linhas já filtrado por
 * empresa e exercício. Tenta o código; se não achar, cai na descrição.
 */
function valorDaConta(linhas, cols, conta) {
  const spec = CONTAS[conta];
  if (!spec) return null;
  for (const codigo of spec.codigos) {
    for (const l of linhas) {
      if (String(l[cols.codigoConta] || '').trim() === codigo) {
        const v = valorNumericoCvm(l[cols.valorConta]);
        if (v === null) continue;
        return v * fatorEscala(cols.escalaMoeda ? l[cols.escalaMoeda] : null);
      }
    }
  }
  if (!cols.descricaoConta) return null;
  for (const termo of spec.termos) {
    for (const l of linhas) {
      if (normalizarTexto(l[cols.descricaoConta]) === termo) {
        const v = valorNumericoCvm(l[cols.valorConta]);
        if (v === null) continue;
        return v * fatorEscala(cols.escalaMoeda ? l[cols.escalaMoeda] : null);
      }
    }
  }
  return null;
}

/** Depreciação e amortização da DFC, para reconstruir o EBITDA. */
function depreciacaoDaDfc(linhas, cols) {
  if (!linhas || !linhas.length || !cols.descricaoConta) return null;
  let total = 0;
  let achou = false;
  for (const l of linhas) {
    const ds = normalizarTexto(l[cols.descricaoConta]);
    if (!ds.includes('deprecia') && !ds.includes('amortiza')) continue;
    const v = valorNumericoCvm(l[cols.valorConta]);
    if (v === null) continue;
    // Na DFC a depreciação entra somada de volta ao lucro, com sinal
    // positivo. Tomamos o módulo para não depender da convenção do emissor.
    total += Math.abs(v) * fatorEscala(cols.escalaMoeda ? l[cols.escalaMoeda] : null);
    achou = true;
  }
  return achou ? total : null;
}

module.exports = {
  COLUNAS,
  CONTAS,
  ALIQUOTA_NOMINAL,
  normalizarChave,
  normalizarTexto,
  parseCsvCvm,
  acharColuna,
  resolverColunas,
  valorNumericoCvm,
  fatorEscala,
  valorDaConta,
  depreciacaoDaDfc,
};

// ════════════════════════════════════════════════════════════
// Agrupamento e cálculo dos indicadores
// ════════════════════════════════════════════════════════════

/**
 * Agrupa as linhas por empresa e exercício.
 *
 * Só entra `ORDEM_EXERC = ÚLTIMO`: cada arquivo traz o exercício corrente e
 * o anterior, e misturar os dois duplicaria empresas com dois valores
 * diferentes para a mesma conta.
 */
function agruparPorEmpresa(registros, cols) {
  const porEmpresa = new Map();
  for (const r of registros) {
    if (cols.ordemExercicio) {
      const ordem = normalizarChave(r[cols.ordemExercicio]);
      if (ordem && ordem !== 'ULTIMO') continue;
    }
    const chave = String(r[cols.cdCvm] || '').trim();
    if (!chave) continue;
    const exercicio = String(
      (cols.dataFimExercicio && r[cols.dataFimExercicio]) || r[cols.dataReferencia] || ''
    ).trim();
    if (!exercicio) continue;
    if (!porEmpresa.has(chave)) porEmpresa.set(chave, new Map());
    const porExercicio = porEmpresa.get(chave);
    if (!porExercicio.has(exercicio)) porExercicio.set(exercicio, []);
    porExercicio.get(exercicio).push(r);
  }
  return porEmpresa;
}

/** Contas absolutas de um exercício, a partir das quatro demonstrações. */
function extrairFinanceiro(blocos, cols) {
  const bpa = blocos.bpa || [];
  const bpp = blocos.bpp || [];
  const dre = blocos.dre || [];
  const dfc = blocos.dfc || [];

  const patrimonioLiquido = valorDaConta(bpp, cols, 'patrimonioLiquido');
  const ativoTotal = valorDaConta(bpa, cols, 'ativoTotal');
  const ativoCirculante = valorDaConta(bpa, cols, 'ativoCirculante');
  const passivoCirculante = valorDaConta(bpp, cols, 'passivoCirculante');
  const caixa = valorDaConta(bpa, cols, 'caixa');
  const aplicacoes = valorDaConta(bpa, cols, 'aplicacoesFinanceiras');
  const dividaCp = valorDaConta(bpp, cols, 'dividaCurtoPrazo');
  const dividaLp = valorDaConta(bpp, cols, 'dividaLongoPrazo');
  const receita = valorDaConta(dre, cols, 'receita');
  const ebit = valorDaConta(dre, cols, 'ebit');
  const lucroLiquido = valorDaConta(dre, cols, 'lucroLiquido');
  const antesTributos = valorDaConta(dre, cols, 'resultadoAntesTributos');
  const tributos = valorDaConta(dre, cols, 'tributos');
  const depreciacao = depreciacaoDaDfc(dfc, cols);

  // Só há dívida se alguma das pontas existir. Somar dois nulls como zero
  // faria um banco alavancado parecer uma empresa sem dívida.
  const temDivida = dividaCp !== null || dividaLp !== null;
  const dividaBruta = temDivida ? (dividaCp || 0) + (dividaLp || 0) : null;
  const temCaixa = caixa !== null || aplicacoes !== null;
  const caixaTotal = temCaixa ? (caixa || 0) + (aplicacoes || 0) : null;
  const dividaLiquida = dividaBruta !== null ? dividaBruta - (caixaTotal || 0) : null;
  const ebitda = ebit !== null && depreciacao !== null ? ebit + depreciacao : null;

  return {
    patrimonioLiquido,
    ativoTotal,
    ativoCirculante,
    passivoCirculante,
    caixaTotal,
    dividaBruta,
    dividaLiquida,
    receita,
    ebit,
    ebitda,
    depreciacao,
    lucroLiquido,
    antesTributos,
    tributos,
  };
}

function razao(a, b) {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0)
    return null;
  return a / b;
}

function pct(a, b) {
  const r = razao(a, b);
  return r === null ? null : r * 100;
}

/** Alíquota efetiva da DRE; cai para a nominal quando não dá para apurar. */
function aliquotaEfetiva(fin) {
  const r = razao(fin.tributos, fin.antesTributos);
  if (r === null) return ALIQUOTA_NOMINAL;
  // Tributos vêm negativos na DRE. Fora de [0, 45%] é distorção de
  // benefício fiscal ou prejuízo — a nominal é a hipótese mais segura.
  const efetiva = Math.abs(r);
  if (!(efetiva >= 0 && efetiva <= 0.45)) return ALIQUOTA_NOMINAL;
  return efetiva;
}

// Faixas de sanidade. Valor fora daqui é sintoma de conta trocada ou escala
// errada, não de empresa excepcional — e propagar isso para o score seria
// pior do que não ter o indicador.
const FAIXAS = {
  roe: [-300, 300],
  roic: [-200, 200],
  margemLiquida: [-1000, 100],
  margemEbitda: [-1000, 100],
  liquidezCorrente: [0, 50],
  dividaLiquidaEbitda: [-50, 100],
  dividaLiquidaPl: [-20, 50],
  cagrReceita5a: [-100, 300],
  cagrLucro5a: [-100, 300],
};

function cagr(inicial, final, anos) {
  if (inicial === null || final === null || inicial <= 0 || final <= 0 || !(anos > 0)) return null;
  return (Math.pow(final / inicial, 1 / anos) - 1) * 100;
}

/**
 * Indicadores do motor a partir dos exercícios já extraídos.
 * @param {Array} exercicios [{ ano, dataReferencia, ...contas }] em ordem crescente
 */
function calcularIndicadores(exercicios) {
  const lista = (exercicios || []).slice().sort((a, b) => a.ano - b.ano);
  if (!lista.length) return { indicadores: {}, descartados: [], exerciciosUsados: 0 };
  const atual = lista[lista.length - 1];
  const primeiro = lista[0];
  const anos = atual.ano - primeiro.ano;

  const aliq = aliquotaEfetiva(atual);
  const capitalInvestido =
    atual.patrimonioLiquido !== null && atual.dividaLiquida !== null
      ? atual.patrimonioLiquido + Math.max(0, atual.dividaLiquida)
      : null;
  const nopat = atual.ebit !== null ? atual.ebit * (1 - aliq) : null;

  const brutos = {
    roe: pct(atual.lucroLiquido, atual.patrimonioLiquido),
    roic: pct(nopat, capitalInvestido),
    margemLiquida: pct(atual.lucroLiquido, atual.receita),
    margemEbitda: pct(atual.ebitda, atual.receita),
    liquidezCorrente: razao(atual.ativoCirculante, atual.passivoCirculante),
    dividaLiquidaEbitda: razao(atual.dividaLiquida, atual.ebitda),
    dividaLiquidaPl: razao(atual.dividaLiquida, atual.patrimonioLiquido),
    cagrReceita5a: anos >= 1 ? cagr(primeiro.receita, atual.receita, anos) : null,
    cagrLucro5a: anos >= 1 ? cagr(primeiro.lucroLiquido, atual.lucroLiquido, anos) : null,
  };

  const indicadores = {};
  const descartados = [];
  for (const [campo, valor] of Object.entries(brutos)) {
    if (valor === null || !Number.isFinite(valor)) {
      indicadores[campo] = null;
      continue;
    }
    const faixa = FAIXAS[campo];
    if (faixa && (valor < faixa[0] || valor > faixa[1])) {
      indicadores[campo] = null;
      descartados.push({ campo, valor, motivo: `fora_da_faixa_${faixa[0]}_${faixa[1]}` });
      continue;
    }
    indicadores[campo] = Math.round(valor * 10000) / 10000;
  }

  return {
    indicadores,
    descartados,
    exerciciosUsados: lista.length,
    anosSpan: anos,
    aliquotaUsada: aliq,
    // Absolutos: o motor não os usa direto, mas P/L e P/VP saem deles no
    // servidor, cruzando com o valor de mercado da cotação.
    absolutos: {
      patrimonioLiquido: atual.patrimonioLiquido,
      lucroLiquido: atual.lucroLiquido,
      receita: atual.receita,
      ebitda: atual.ebitda,
      dividaLiquida: atual.dividaLiquida,
      ativoTotal: atual.ativoTotal,
    },
    dataReferencia: atual.dataReferencia || null,
    ano: atual.ano,
  };
}

// ════════════════════════════════════════════════════════════
// Informe Mensal de FII
// ════════════════════════════════════════════════════════════
//
// É o dado que nenhuma API de mercado gratuita entrega: patrimônio,
// cotistas e vacância. Sem ele, FII é pontuado só por P/VP e DY — que é
// exatamente a leitura ingênua que faz um fundo com 40% de vacância parecer
// uma boa oportunidade por causa do yield alto.

const COLUNAS_FII = {
  cnpj: ['CNPJ_Fundo', 'CNPJ_FUNDO', 'CNPJ_Fundo_Classe', 'CNPJ'],
  dataReferencia: ['Data_Referencia', 'DT_COMPTC', 'DATA_REFERENCIA'],
  patrimonioLiquido: ['Patrimonio_Liquido', 'PATRIMONIO_LIQUIDO', 'Valor_Patrimonio_Liquido'],
  numeroCotistas: ['Total_Numero_Cotistas', 'Cotistas', 'Numero_Cotistas', 'Qtd_Cotistas'],
  valorPatrimonialCota: ['Valor_Patrimonial_Cotas', 'Valor_Patrimonial_Cota'],
  numeroCotas: ['Total_Numero_Cotas', 'Numero_Cotas', 'Qtd_Cotas'],
  vacanciaFinanceira: ['Percentual_Vacancia_Financeira', 'Vacancia_Financeira'],
  vacanciaFisica: ['Percentual_Vacancia_Fisica', 'Vacancia_Fisica'],
  numeroImoveis: ['Quantidade_Imoveis', 'Total_Imoveis', 'Numero_Imoveis'],
};

/**
 * Último informe de cada fundo, indexado por CNPJ só com dígitos.
 *
 * "Último" é por data de referência, não pela ordem do arquivo: o informe de
 * um mês pode ser reenviado depois do mês seguinte, e a ordem do CSV não
 * garante nada.
 */
function extrairInformeFii(registros, colunas) {
  const acharFii = (campo) => acharColuna(colunas, COLUNAS_FII[campo] || [campo]);
  const cols = {};
  for (const campo of Object.keys(COLUNAS_FII)) cols[campo] = acharFii(campo);
  if (!cols.cnpj) return { porCnpj: new Map(), faltando: ['cnpj'], colunas: cols };

  const faltando = Object.keys(COLUNAS_FII).filter((c) => !cols[c]);
  const porCnpj = new Map();
  for (const r of registros) {
    const cnpj = String(r[cols.cnpj] || '').replace(/\D/g, '');
    if (cnpj.length !== 14) continue;
    const data = cols.dataReferencia ? String(r[cols.dataReferencia] || '').trim() : '';
    const anterior = porCnpj.get(cnpj);
    if (anterior && anterior.dataReferencia >= data) continue;

    const num = (campo) => (cols[campo] ? valorNumericoCvm(r[cols[campo]]) : null);
    const vacancia =
      num('vacanciaFinanceira') !== null ? num('vacanciaFinanceira') : num('vacanciaFisica');
    porCnpj.set(cnpj, {
      cnpj,
      dataReferencia: data || null,
      patrimonioLiquido: num('patrimonioLiquido'),
      numeroCotistas: num('numeroCotistas'),
      valorPatrimonialCota: num('valorPatrimonialCota'),
      numeroCotas: num('numeroCotas'),
      // O motor pontua OCUPAÇÃO; a CVM publica vacância.
      ocupacao: vacancia === null ? null : Math.max(0, Math.min(100, 100 - vacancia)),
      vacancia,
      numeroImoveis: num('numeroImoveis'),
    });
  }
  return { porCnpj, faltando, colunas: cols };
}

module.exports.FAIXAS = FAIXAS;
module.exports.COLUNAS_FII = COLUNAS_FII;
module.exports.agruparPorEmpresa = agruparPorEmpresa;
module.exports.extrairFinanceiro = extrairFinanceiro;
module.exports.calcularIndicadores = calcularIndicadores;
module.exports.aliquotaEfetiva = aliquotaEfetiva;
module.exports.cagr = cagr;
module.exports.extrairInformeFii = extrairInformeFii;

// ════════════════════════════════════════════════════════════
// Descoberta do universo — ticker ↔ empresa, pela própria CVM
// ════════════════════════════════════════════════════════════
//
// O FCA (Formulário Cadastral) declara os valores mobiliários de cada
// companhia, com o CÓDIGO DE NEGOCIAÇÃO. É o vínculo oficial entre ticker e
// CD_CVM — publicado pela CVM, não inferido por semelhança de nome.
//
// Isto é o que permite ao motor considerar a bolsa inteira em vez de uma
// lista escrita à mão. Lista curada por humano tem dois defeitos que não se
// resolvem com disciplina: envelhece sem avisar (título vencido, empresa que
// saiu da bolsa) e limita o universo ao que quem escreveu já conhecia.

const COLUNAS_FCA = {
  cdCvm: ['CD_CVM', 'CODIGO_CVM'],
  codigoNegociacao: ['Codigo_Negociacao', 'CODIGO_NEGOCIACAO', 'CD_NEGOCIACAO'],
  valorMobiliario: ['Valor_Mobiliario', 'VALOR_MOBILIARIO', 'DS_VALOR_MOBILIARIO'],
  mercado: ['Mercado', 'MERCADO', 'DS_MERCADO'],
  siglaBolsa: ['Sigla_Bolsa', 'SIGLA_BOLSA', 'Entidade_Administradora'],
  dataReferencia: ['Data_Referencia', 'DT_REFER'],
};

// Espécies que o motor pontua como ação. Recibo (units) entra; debênture,
// bônus de subscrição e nota promissória não são renda variável negociável
// da forma que o motor assume.
const ESPECIES_ACAO = ['acao ordinaria', 'acao preferencial', 'unit', 'certificado de deposito'];

/**
 * Ticker -> CD_CVM a partir do FCA.
 *
 * Um CD_CVM tem vários tickers (ON, PN, unit) e o mesmo ticker pode aparecer
 * repetido em exercícios diferentes; o índice é ticker -> empresa, que é a
 * direção que a ingestão consulta.
 */
function extrairTickersFca(registros, colunas) {
  const cols = {};
  for (const campo of Object.keys(COLUNAS_FCA)) {
    cols[campo] = acharColuna(colunas, COLUNAS_FCA[campo]);
  }
  const faltando = Object.keys(COLUNAS_FCA).filter((c) => !cols[c]);
  if (!cols.cdCvm || !cols.codigoNegociacao) {
    return { porTicker: new Map(), faltando, colunas: cols };
  }

  const porTicker = new Map();
  for (const r of registros) {
    const cdCvm = String(r[cols.cdCvm] || '').trim();
    const bruto = String(r[cols.codigoNegociacao] || '')
      .trim()
      .toUpperCase();
    if (!cdCvm || !bruto) continue;

    // O campo às vezes traz mais de um código separado por vírgula ou barra.
    for (const parte of bruto.split(/[,;/]+/)) {
      const ticker = parte.trim().replace(/[^A-Z0-9]/g, '');
      // Ticker da B3: 4 letras + 1 ou 2 dígitos.
      if (!/^[A-Z]{4}\d{1,2}$/.test(ticker)) continue;

      if (cols.valorMobiliario) {
        const especie = normalizarTexto(r[cols.valorMobiliario]);
        const aceita = ESPECIES_ACAO.some((e) => especie.includes(e));
        // Espécie desconhecida passa: o filtro existe para excluir debênture
        // e bônus de subscrição, não para exigir um vocabulário fechado que
        // a CVM pode mudar.
        if (especie && !aceita && /debentur|bonus|promissoria|opcao/.test(especie)) continue;
      }

      const anterior = porTicker.get(ticker);
      const data = cols.dataReferencia ? String(r[cols.dataReferencia] || '') : '';
      if (anterior && anterior.dataReferencia >= data) continue;
      porTicker.set(ticker, { ticker, cdCvm, dataReferencia: data || null });
    }
  }
  return { porTicker, faltando, colunas: cols };
}

module.exports.COLUNAS_FCA = COLUNAS_FCA;
module.exports.ESPECIES_ACAO = ESPECIES_ACAO;
module.exports.extrairTickersFca = extrairTickersFca;
