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
  ativoTotal: { codigos: ['1'], termos: ['ativo total'], porDescricao: true },
  // `soPlanoPadrao`: conta que NÃO EXISTE fora do plano industrial. Num
  // balanço de banco não há circulante, e o código `1.01` aponta outra coisa
  // — devolver null ali é a resposta certa. Ver `planoDaEmpresa`.
  ativoCirculante: { codigos: ['1.01'], termos: ['ativo circulante'], soPlanoPadrao: true },
  caixa: { codigos: ['1.01.01'], termos: ['caixa e equivalentes de caixa'] },
  aplicacoesFinanceiras: { codigos: ['1.01.02'], termos: ['aplicacoes financeiras'] },
  passivoCirculante: {
    codigos: ['2.01'],
    termos: ['passivo circulante'],
    soPlanoPadrao: true,
  },
  dividaCurtoPrazo: {
    codigos: ['2.01.04'],
    termos: ['emprestimos e financiamentos'],
    soPlanoPadrao: true,
  },
  dividaLongoPrazo: {
    codigos: ['2.02.01'],
    termos: ['emprestimos e financiamentos'],
    soPlanoPadrao: true,
  },
  // `porDescricao` inverte a ordem de casamento: descrição primeiro, código
  // como reserva.
  //
  // MOTIVO CONCRETO. Banco, seguradora e empresa industrial não usam o mesmo
  // plano de contas na DFP. O código 2.03 é "Patrimônio Líquido" no plano
  // industrial e OUTRA conta no plano das instituições financeiras — então
  // casar por código devolvia um número real, da conta errada, sem erro
  // nenhum. Foi o que a execução real mostrou:
  //
  //   BBAS3  ROE 43,4%   (o ROE do Banco do Brasil é ~20%)
  //
  // O lucro estava certo e o patrimônio ~6x abaixo. A DESCRIÇÃO, essa, é
  // padronizada nos três planos — "Patrimônio Líquido Consolidado" é a mesma
  // frase no banco e na indústria.
  patrimonioLiquido: {
    codigos: ['2.03'],
    termos: ['patrimonio liquido consolidado', 'patrimonio liquido'],
    porDescricao: true,
  },
  receita: {
    codigos: ['3.01'],
    termos: ['receita de venda', 'receita liquida'],
    porDescricao: true,
  },
  // Para um banco, o resultado financeiro É a operação: não há "resultado
  // antes do resultado financeiro". Sem EBIT não há EBITDA nem ROIC — e é
  // isso mesmo.
  ebit: { codigos: ['3.05'], termos: ['antes do resultado financeiro'], soPlanoPadrao: true },
  resultadoAntesTributos: { codigos: ['3.07'], termos: ['antes dos tributos'] },
  tributos: { codigos: ['3.08'], termos: ['imposto de renda'] },
  lucroLiquido: {
    codigos: ['3.11', '3.09'],
    termos: ['lucro/prejuizo consolidado do periodo', 'lucro/prejuizo do periodo'],
    porDescricao: true,
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
function valorDaConta(linhas, cols, conta, opcoes) {
  const spec = CONTAS[conta];
  if (!spec) return null;
  // Conta exclusiva do plano padrão, lida fora dele: não existe. Devolver
  // null é a resposta, não uma falha.
  if (spec.soPlanoPadrao && opcoes && opcoes.plano === 'financeiro') return null;

  const porCodigo = () => {
    for (const codigo of spec.codigos) {
      for (const l of linhas) {
        if (String(l[cols.codigoConta] || '').trim() === codigo) {
          const v = valorNumericoCvm(l[cols.valorConta]);
          if (v === null) continue;
          return v * fatorEscala(cols.escalaMoeda ? l[cols.escalaMoeda] : null);
        }
      }
    }
    return null;
  };

  const porDescricao = () => {
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
  };

  // Ordem invertida para as contas marcadas: ver o comentário em CONTAS.
  const primeiro = spec.porDescricao ? porDescricao() : porCodigo();
  if (primeiro !== null) return primeiro;
  return spec.porDescricao ? porCodigo() : porDescricao();
}

/**
 * Qual plano de contas a companhia usou — e, por tabela, quais indicadores
 * fazem sentido para ela.
 *
 * O plano padrão separa o balanço em circulante e não circulante. Banco e
 * seguradora NÃO fazem essa separação: o balanço deles é outro, e os códigos
 * `1.01`, `2.01`, `2.03` apontam contas diferentes. Isto identifica o caso
 * pelo próprio arquivo, sem lista de setor escrita à mão — que envelheceria
 * como toda lista escrita à mão neste projeto.
 *
 * O efeito prático, medido: o Banco do Brasil aparecia com dívida
 * líquida/EBITDA de 12,49x. Um banco não tem "dívida líquida" nesse sentido
 * nem EBITDA — a intermediação financeira É a operação dele. O número saía
 * de contas que existem no código mas significam outra coisa, e um número
 * sem sentido no ranking é pior do que a ausência dele.
 */
function planoDaEmpresa(blocos, cols) {
  if (!cols.descricaoConta) return 'padrao';
  const descricoes = []
    .concat(blocos.bpa || [], blocos.bpp || [])
    .map((l) => normalizarTexto(l[cols.descricaoConta]));
  const temCirculante = descricoes.some(
    (ds) => ds.startsWith('ativo circulante') || ds.startsWith('passivo circulante')
  );
  if (temCirculante) return 'padrao';
  // EXIGE SINAL POSITIVO. Classificar como financeiro pela mera ausência da
  // linha de circulante transformaria qualquer balanço truncado em banco — e
  // ausência de evidência não é evidência. Estas contas só existem no plano
  // das instituições financeiras.
  const MARCAS_FINANCEIRO = [
    'interfinanceir',
    'operacoes de credito',
    'captacoes no mercado aberto',
    'recursos de aceites',
    'provisoes tecnicas',
    'depositos',
  ];
  const temMarca = descricoes.some((ds) => MARCAS_FINANCEIRO.some((m) => ds.includes(m)));
  return temMarca ? 'financeiro' : 'padrao';
}

/**
 * Lucro por ação básico, da DRE — e, por tabela, a contagem de ações.
 *
 * É o que destrava VALUATION inteiro sem depender de fonte paga: com LPA e
 * lucro, `acoes = lucro / LPA`; com ações e preço, sai o valor de mercado, e
 * dele P/L, P/VP e EV/EBITDA. Sem isto o pilar fica vazio para a bolsa toda,
 * porque o v8/chart do Yahoo devolve preço mas não valor de mercado.
 *
 * O diluído é ignorado de propósito: embute opções que ainda não foram
 * exercidas, e a contagem que interessa é a de ações que existem hoje.
 *
 * Empresa com ON e PN reporta um LPA por classe. Quando são iguais (o caso
 * normal), `lucro / LPA` dá o total de ações e está certo. Quando divergem,
 * não há como somar as classes a partir daqui — e aí devolve null, porque
 * um P/L errado é pior do que um P/L ausente.
 *
 * Devolve `linhas399` — o que existe no grupo, com código, descrição e valor.
 * O job imprime isso quando o LPA não sai: é o que separa "a companhia não
 * publica a conta" de "o nosso filtro não a reconhece".
 */
function lucroPorAcaoDetalhado(linhas, cols) {
  if (!linhas || !linhas.length) return { valor: null, linhas399: [] };
  const valores = [];
  const linhas399 = [];
  for (const l of linhas) {
    const cod = String(l[cols.codigoConta] || '').trim();
    const ds = cols.descricaoConta ? normalizarTexto(l[cols.descricaoConta]) : '';
    // No plano de contas da CVM, 3.99.01 é o lucro BÁSICO por ação e
    // 3.99.02 o diluído. As folhas trazem só a classe na descrição ("ON",
    // "PN") — quem separa básico de diluído é o código, não o texto. Filtrar
    // por "diluído" na descrição deixava passar o 3.99.02.01 inteiro.
    if (cod.startsWith('3.99')) {
      const v0 = valorNumericoCvm(l[cols.valorConta]);
      linhas399.push(`${cod}=${ds.slice(0, 24)}:${v0 === null ? '—' : v0}`);
    }
    const basicoPorCodigo = cod === '3.99.01' || cod.startsWith('3.99.01.');
    const diluidoPorCodigo = cod === '3.99.02' || cod.startsWith('3.99.02.');
    if (diluidoPorCodigo || ds.includes('diluid')) continue;
    const basicoPorTexto = ds.includes('por acao') || ds.includes('por acoes');
    if (!basicoPorCodigo && !basicoPorTexto) continue;
    const v = valorNumericoCvm(l[cols.valorConta]);
    if (v === null || v <= 0) continue;
    // A ESCALA DO ARQUIVO NÃO SE APLICA AQUI. A conta 3.99 é, por definição
    // do plano da CVM, "Lucro por Ação - (Reais / Ação)": a unidade vem do
    // plano de contas, não da escala monetária declarada no arquivo. Boa
    // parte dos emissores repete ESCALA_MOEDA=MIL nestas linhas por herança
    // do resto da DFP, e multiplicar por mil produzia exatamente o que a
    // primeira execução real mostrou:
    //
    //   ARML3  LPA 190,00   (era 0,19)
    //   ENGI11 LPA 950,00   (era 0,95)
    //   BBAS3  LPA —        (7,4 × 1000 = 7400, cortado pelo teto)
    //
    // Ou seja: valores errados nos que passavam e valuation apagada nos que
    // não passavam. O teto continua, agora como guarda de verdade.
    if (v < 0.0001 || v > 1000) continue;
    valores.push(v);
  }
  if (!valores.length) return { valor: null, linhas399 };
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  // Classes com LPA diferente: a contagem de ações não sai de uma divisão só.
  if (min <= 0 || max / min > 1.02) return { valor: null, linhas399 };
  return { valor: valores[0], linhas399 };
}

// Como a distribuição aos acionistas aparece na DFC. "jcp" e "juros sobre o
// capital" entram porque metade das companhias nomeia a linha só assim — e
// no Brasil JCP é dividendo com outro nome fiscal.
// "remuneracao ao(s) acionista(s)" entrou depois de o log mostrar, na
// Eletrobras, a linha `pagamento e remuneracao aos acionistas` — que É a
// distribuição, nomeada sem a palavra "dividendo". Sem o termo, o resultado
// era `div 0M` numa companhia que paga.
const TERMOS_DIVIDENDO = [
  'dividendo',
  'capital proprio',
  'jcp',
  'remuneracao ao acionista',
  'remuneracao aos acionistas',
];

/**
 * Dividendos e JCP pagos no exercício, do fluxo de financiamento da DFC.
 *
 * Só o grupo 6.03 (financiamento): "dividendos recebidos" mora no 6.01 e
 * somá-lo inverteria o sinal do indicador de uma holding.
 *
 * Quando o agregado E o detalhe aparecem, vale o AGREGADO. É o contrário do
 * que o instinto sugere, e por um motivo concreto: o filtro por descrição
 * reconhece "Dividendos Pagos" mas pode não reconhecer como a companhia
 * nomeou a linha vizinha. Somando folhas, o que o filtro não reconhecesse
 * sumia da conta e o payout saía menor do que é; ficando com o pai, o total
 * é o que a própria companhia declarou.
 *
 * Devolve também o RASTRO. `naoReconhecidas` lista as linhas do 6.03 que o
 * filtro não casou, e o job imprime-as quando não acha distribuição: é a
 * diferença entre "esta empresa não paga" e "esta empresa nomeia a linha de
 * um jeito que o filtro não conhece", que de fora são idênticas.
 */
function dividendosPagosDetalhado(linhas, cols) {
  const vazio = { valor: null, naoReconhecidas: [], motivo: 'sem_dfc' };
  if (!linhas || !linhas.length || !cols.descricaoConta) return vazio;
  const candidatos = [];
  const naoReconhecidas = [];
  // Filhas de primeiro nível (6.03.NN) e o total (6.03). Só quando as filhas
  // FECHAM com o total sabemos que a seção está inteira à nossa frente — e
  // só então a ausência de linha de dividendo significa que não houve.
  let total = null;
  const filhas = [];
  for (const l of linhas) {
    const cod = String(l[cols.codigoConta] || '').trim();
    if (!cod.startsWith('6.03')) continue;
    const escala = fatorEscala(cols.escalaMoeda ? l[cols.escalaMoeda] : null);
    const v = valorNumericoCvm(l[cols.valorConta]);
    if (cod === '6.03') {
      if (v !== null) total = v * escala;
      continue;
    }
    const primeiroNivel = /^6\.03\.\d+$/.test(cod);
    if (primeiroNivel && v !== null) filhas.push(v * escala);
    const ds = normalizarTexto(l[cols.descricaoConta]);
    if (!TERMOS_DIVIDENDO.some((t) => ds.includes(t))) {
      if (primeiroNivel && v !== null && v !== 0) naoReconhecidas.push(ds.slice(0, 60));
      continue;
    }
    if (v === null || v === 0) continue;
    candidatos.push({ cod, valor: Math.abs(v) * escala });
  }

  if (!candidatos.length) {
    // Zero só quando a seção fecha: as filhas de primeiro nível somam o
    // total declarado. Se sobra diferença, existe linha que não lemos — e
    // afirmar zero ali penalizaria quem paga. A primeira execução real
    // marcou 3 de 8 companhias com "div 0M", uma delas pagadora conhecida:
    // um zero falso é pior do que uma lacuna, porque afunda no ranking de
    // renda justamente quem deveria subir.
    const somaFilhas = filhas.reduce((a, b) => a + b, 0);
    const fecha =
      total !== null &&
      filhas.length > 0 &&
      Math.abs(somaFilhas - total) <= Math.max(1, Math.abs(total) * 0.01);
    return {
      valor: fecha ? 0 : null,
      naoReconhecidas,
      motivo: fecha ? 'nao_distribuiu' : 'secao_incompleta',
    };
  }
  // Conta só quem não está coberto por um ancestral já contado.
  const somado = candidatos
    .filter((c) => !candidatos.some((o) => o !== c && c.cod.startsWith(o.cod + '.')))
    .reduce((acc, c) => acc + c.valor, 0);
  return { valor: somado > 0 ? somado : null, naoReconhecidas, motivo: 'distribuiu' };
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
    // Indexa pelas DUAS identificações. O FCA junta por CNPJ, o cadastro
    // antigo junta por CD_CVM, e o mesmo índice tem de servir aos dois — sem
    // isto, "0 companhias com dados" era o resultado mesmo com o arquivo
    // certo aberto e as colunas todas resolvidas.
    const chaves = [];
    const cd = cols.cdCvm ? normalizarCdCvm(r[cols.cdCvm]) : null;
    const cnpj = cols.cnpj ? normalizarCnpj(r[cols.cnpj]) : null;
    if (cd) chaves.push('cd:' + cd);
    if (cnpj) chaves.push('cnpj:' + cnpj);
    if (!chaves.length) continue;
    const exercicio = String(
      (cols.dataFimExercicio && r[cols.dataFimExercicio]) || r[cols.dataReferencia] || ''
    ).trim();
    if (!exercicio) continue;
    for (const chave of chaves) {
      if (!porEmpresa.has(chave)) porEmpresa.set(chave, new Map());
      const porExercicio = porEmpresa.get(chave);
      if (!porExercicio.has(exercicio)) porExercicio.set(exercicio, []);
      porExercicio.get(exercicio).push(r);
    }
  }
  return porEmpresa;
}

/** Contas absolutas de um exercício, a partir das quatro demonstrações. */
function extrairFinanceiro(blocos, cols) {
  const bpa = blocos.bpa || [];
  const bpp = blocos.bpp || [];
  const dre = blocos.dre || [];
  const dfc = blocos.dfc || [];

  // Banco e seguradora usam outro plano de contas: lá o código não serve de
  // reserva, porque aponta contas diferentes com o mesmo número.
  const plano = planoDaEmpresa(blocos, cols);
  const op = { plano };

  const patrimonioLiquido = valorDaConta(bpp, cols, 'patrimonioLiquido', op);
  const ativoTotal = valorDaConta(bpa, cols, 'ativoTotal', op);
  const ativoCirculante = valorDaConta(bpa, cols, 'ativoCirculante', op);
  const passivoCirculante = valorDaConta(bpp, cols, 'passivoCirculante', op);
  const caixa = valorDaConta(bpa, cols, 'caixa', op);
  const aplicacoes = valorDaConta(bpa, cols, 'aplicacoesFinanceiras', op);
  const dividaCp = valorDaConta(bpp, cols, 'dividaCurtoPrazo', op);
  const dividaLp = valorDaConta(bpp, cols, 'dividaLongoPrazo', op);
  const receita = valorDaConta(dre, cols, 'receita', op);
  const ebit = valorDaConta(dre, cols, 'ebit', op);
  const lucroLiquido = valorDaConta(dre, cols, 'lucroLiquido', op);
  const antesTributos = valorDaConta(dre, cols, 'resultadoAntesTributos', op);
  const tributos = valorDaConta(dre, cols, 'tributos', op);
  const depreciacao = depreciacaoDaDfc(dfc, cols);
  const lpa = lucroPorAcaoDetalhado(dre, cols);
  const lucroPorAcao = lpa.valor;
  const dividendos = dividendosPagosDetalhado(dfc, cols);
  const dividendosPagos = dividendos.valor;

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
    plano,
    lucroPorAcao,
    linhas399: lpa.linhas399,
    dividendosPagos,
    // Rastro para o log do job: sem isto, "não paga" e "nomeia diferente"
    // são indistinguíveis de fora.
    dividendosMotivo: dividendos.motivo,
    dividendosNaoReconhecidas: dividendos.naoReconhecidas,
    // Contagem de ações implícita. A faixa é larga de propósito — serve só
    // para barrar o absurdo (escala trocada por mil), não para julgar a
    // empresa.
    acoesEquivalentes:
      lucroLiquido !== null && lucroPorAcao !== null && lucroPorAcao > 0
        ? (() => {
            const n = lucroLiquido / lucroPorAcao;
            return n >= 1e5 && n <= 1e12 ? n : null;
          })()
        : null,
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
  crescimentoReceitaAno: [-100, 500],
  // Payout acima de 200% é distribuição de reserva ou linha somada duas
  // vezes; nos dois casos não descreve a política de dividendos.
  payout: [0, 200],
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
  const anterior = lista.length >= 2 ? lista[lista.length - 2] : null;

  // Anos seguidos pagando, contados do exercício mais recente para trás. A
  // sequência é o que o critério mede: dez anos com um buraco no meio não é
  // dez anos. Um exercício SEM informação interrompe a contagem em vez de
  // ser tratado como zero — não sabemos se pagou.
  let anosPagando = 0;
  for (let i = lista.length - 1; i >= 0; i--) {
    const d = lista[i].dividendosPagos;
    if (d === null || d === undefined) break; // sem informação: nada a afirmar
    if (!(d > 0)) break; // pagou zero: a sequência termina aqui
    anosPagando++;
  }
  // Zero só é resposta quando sabemos o do exercício mais recente; senão é
  // ausência de dado, e o motor tem de tratá-la como ausência.
  const ultimoConhecido = atual.dividendosPagos;
  if (!anosPagando && (ultimoConhecido === null || ultimoConhecido === undefined)) {
    anosPagando = null;
  }

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
    crescimentoReceitaAno: anterior ? cagr(anterior.receita, atual.receita, 1) : null,
    // Payout e anos pagando saem sem preço nenhum — são a parte do pilar de
    // dividendos que não depende de valor de mercado.
    payout: pct(atual.dividendosPagos, atual.lucroLiquido),
    anosPagandoDividendo: anosPagando,
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
      // Ações e dividendo por ação: com o preço, o servidor fecha P/L, P/VP,
      // EV/EBITDA e DY sem precisar de fonte paga.
      plano: atual.plano ?? null,
      linhas399: atual.linhas399 ?? null,
      acoesEquivalentes: atual.acoesEquivalentes ?? null,
      lucroPorAcao: atual.lucroPorAcao ?? null,
      dividendosPagos: atual.dividendosPagos ?? null,
      dividendosMotivo: atual.dividendosMotivo ?? null,
      dividendosNaoReconhecidas: atual.dividendosNaoReconhecidas ?? null,
      // Zero conhecido vira DY zero, não ausência: quem não distribuiu tem
      // de pontuar zero no pilar, e não ficar de fora dele.
      dividendoPorAcao:
        atual.dividendosPagos !== null &&
        atual.dividendosPagos !== undefined &&
        atual.acoesEquivalentes
          ? atual.dividendosPagos / atual.acoesEquivalentes
          : null,
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

// Nomes confirmados contra o arquivo real (`inf_mensal_fii_2026.zip`,
// membro `complemento`), depois de o log imprimir as colunas de verdade.
// Antes disto eram palpites, e quatro deles estavam errados.
const COLUNAS_FII = {
  cnpj: ['CNPJ_Fundo_Classe', 'CNPJ_Fundo', 'CNPJ_FUNDO', 'CNPJ'],
  dataReferencia: ['Data_Referencia', 'DT_COMPTC', 'DATA_REFERENCIA'],
  patrimonioLiquido: ['Patrimonio_Liquido', 'PATRIMONIO_LIQUIDO', 'Valor_Patrimonio_Liquido'],
  numeroCotistas: ['Total_Numero_Cotistas', 'Cotistas', 'Numero_Cotistas', 'Qtd_Cotistas'],
  valorPatrimonialCota: ['Valor_Patrimonial_Cotas', 'Valor_Patrimonial_Cota'],
  // O arquivo chama de "Cotas_Emitidas"; "Total_Numero_Cotas" era palpite.
  numeroCotas: ['Cotas_Emitidas', 'Total_Numero_Cotas', 'Numero_Cotas', 'Qtd_Cotas'],
  // A CVM publica o DY do MÊS já calculado. Não é preciso derivar nada: é o
  // indicador mais importante do pilar de dividendos de um FII, vindo da
  // fonte oficial.
  dividendYieldMes: ['Percentual_Dividend_Yield_Mes', 'Percentual_Dividend_Yield'],
  rentabilidadeMes: ['Percentual_Rentabilidade_Efetiva_Mes'],
  // Alavancagem. O pilar Endividamento do FII tem UM indicador — LTV — e
  // sem ele o pilar inteiro fica vazio, o que derruba a cobertura de toda a
  // classe. O informe publica as duas pontas: as obrigações e o ativo.
  //
  // Não se usa `Total_Passivo`: ali dentro estão rendimentos a distribuir e
  // taxa de administração a pagar, que não são dívida — um fundo sem
  // dívida nenhuma apareceria alavancado no mês em que declarou
  // rendimento. As obrigações por aquisição de imóveis e por securitização
  // de recebíveis são o que de facto financia a carteira.
  valorAtivo: ['Valor_Ativo', 'Total_Ativo'],
  obrigacoesAquisicaoImoveis: ['Obrigacoes_Aquisicao_Imoveis'],
  obrigacoesSecuritizacao: ['Obrigacoes_Securitizacao_Recebiveis'],
  // Rendimento a distribuir do mês. Dividido pelas cotas emitidas dá o
  // rendimento POR COTA — e a variação dele, ao longo de 24 meses, é o
  // crescimento do dividendo SEM preço na conta.
  //
  // É a diferença entre este número e o `Percentual_Dividend_Yield_Mes`:
  // o yield é rendimento ÷ PREÇO, e a variação dele confunde mudança de
  // rendimento com mudança de cotação. Um fundo que não mudou um centavo
  // de distribuição aparece "crescendo" só porque a cota caiu.
  rendimentosDistribuir: ['Rendimentos_Distribuir', 'Rendimentos_A_Distribuir'],
  // Composição da carteira — o que separa fundo de TIJOLO de fundo de
  // PAPEL. Cobrar ocupação e número de imóveis de um fundo de recebíveis é
  // o mesmo erro de cobrar EBITDA de banco: o indicador não está ausente,
  // ele não se aplica.
  //
  // `Direitos_Bens_Imoveis` é o agregado do bloco imobiliário (vem logo
  // depois de `Total_Investido` e antes das categorias específicas). As
  // folhas ficam como reserva — mesmo cuidado do 6.03, onde somar o pai
  // com as filhas contava tudo duas vezes.
  direitosBensImoveis: ['Direitos_Bens_Imoveis'],
  terrenos: ['Terrenos'],
  imoveisRendaAcabados: ['Imoveis_Renda_Acabados'],
  imoveisRendaConstrucao: ['Imoveis_Renda_Construcao'],
  imoveisVendaAcabados: ['Imoveis_Venda_Acabados'],
  imoveisVendaConstrucao: ['Imoveis_Venda_Construcao'],
  outrosDireitosReais: ['Outros_Direitos_Reais'],
  totalInvestido: ['Total_Investido'],
};

// Vacância e número de imóveis NÃO estão no `complemento` — moram noutro
// membro do ZIP, com os dados de ativo. Deixá-los aqui fazia o relatório
// acusar quatro campos "não encontrados" a cada execução, ruído que compete
// com falha de verdade. Ficam declarados à parte, para quando esse membro
// for lido.
const COLUNAS_FII_IMOVEIS = {
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
  const TODAS = { ...COLUNAS_FII, ...COLUNAS_FII_IMOVEIS };
  const acharFii = (campo) => acharColuna(colunas, TODAS[campo] || [campo]);
  const cols = {};
  for (const campo of Object.keys(TODAS)) cols[campo] = acharFii(campo);
  if (!cols.cnpj) return { porCnpj: new Map(), faltando: ['cnpj'], colunas: cols };

  // Só o que este membro deveria ter conta como ausência: os campos de
  // imóveis vivem noutro arquivo e acusá-los aqui é ruído.
  const faltando = Object.keys(COLUNAS_FII).filter((c) => !cols[c]);

  // `Percentual_Dividend_Yield_Mes` chama-se "percentual" e é RAZÃO. O
  // informe real desmentiu o nome:
  //
  //   MXRF11  0,00808   num mês em que rendeu ~0,8%
  //   HGLG11  0,007023  num mês em que rendeu ~0,7%
  //
  // Lido como percentagem, o DY anual de todo FII sairia ~0,1% e a classe
  // inteira afundaria no pilar de dividendos — número errado, não ausente,
  // que é sempre o pior dos dois.
  //
  // A escala é decidida UMA vez por arquivo, pela mediana dos valores
  // positivos, e não linha a linha: a convenção é propriedade do arquivo, e
  // a mediana não se deixa mover por um fundo atípico. Se a CVM trocar a
  // convenção, a mediana acompanha sem que ninguém precise reeditar código.
  const escalaDy = escalaDoDividendYield(registros, cols.dividendYieldMes);

  const porCnpj = new Map();
  // A SÉRIE, não só o último mês. O ZIP anual traz doze informes de cada
  // fundo e o job já os lê todos: descartá-los deixaria dois indicadores do
  // pilar de dividendos vazios por falta de dado que está na mão.
  const seriePorCnpj = new Map();
  for (const r of registros) {
    const cnpj = String(r[cols.cnpj] || '').replace(/\D/g, '');
    if (cnpj.length !== 14) continue;
    const data = cols.dataReferencia ? String(r[cols.dataReferencia] || '').trim() : '';
    const anterior = porCnpj.get(cnpj);
    const maisVelho = anterior && anterior.dataReferencia >= data;

    const num = (campo) => (cols[campo] ? valorNumericoCvm(r[cols[campo]]) : null);
    // Fora de [0; 5] não é DY de um mês: vira lacuna, nunca número.
    const dyBruto = num('dividendYieldMes');
    // Arredondado: multiplicar por 100 em ponto flutuante produz
    // `0.7023000000000001`, que polui log e documento sem acrescentar nada.
    const dyEscalado = dyBruto === null ? null : Math.round(dyBruto * escalaDy.fator * 1e6) / 1e6;
    const dyMesPct = dyEscalado !== null && dyEscalado >= 0 && dyEscalado <= 5 ? dyEscalado : null;
    const vacancia =
      num('vacanciaFinanceira') !== null ? num('vacanciaFinanceira') : num('vacanciaFisica');

    // O ponto da série carrega os campos MENSAIS de que a série precisa. O
    // rendimento a distribuir mora no `ativo_passivo` e as cotas emitidas
    // no `complemento`: são membros diferentes do mesmo ZIP, e só depois de
    // reunidos por mês é que o rendimento por cota existe. Por isso o ponto
    // é gravado mesmo sem DY — antes, `dyMes === null` descartava a linha
    // inteira e levava junto o que o outro membro traria.
    //
    // A lista é EXPLÍCITA de propósito, e cada campo aqui é consumido por
    // `indicadoresDaSerieFii`. O comentário antigo dizia "TODOS os campos
    // mensais" e o código gravava três: acrescentei um consumidor de
    // `valorPatrimonialCota` confiando na frase, e a medição saiu `0m` em
    // todos os nove fundos — um zero plausível, do mesmo tipo que este
    // projeto passou a semana a caçar. Comentário que promete mais do que o
    // código entrega é uma armadilha, não documentação.
    if (data) {
      const serie = seriePorCnpj.get(cnpj) || [];
      serie.push({
        dataReferencia: data,
        dyMes: dyMesPct,
        rendimentosDistribuir: num('rendimentosDistribuir'),
        numeroCotas: num('numeroCotas'),
        // Base do segundo caminho do crescimento: `DY × VPC` reconstrói o
        // rendimento por cota onde o saldo de balanço fecha em zero.
        valorPatrimonialCota: num('valorPatrimonialCota'),
      });
      seriePorCnpj.set(cnpj, serie);
    }
    // O mês mais recente descreve o fundo hoje; os anteriores só alimentam a
    // série. Sem esta guarda um reenvio antigo sobrescreveria o atual.
    if (maisVelho) continue;

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
      // DY do mês, oficial. O motor usa DY anual: doze meses do mesmo
      // patamar é a leitura honesta de um informe mensal — e o rótulo da
      // fonte diz de que mês veio.
      dy: dyMesPct === null ? null : dyMesPct * 12,
      dyMes: dyMesPct,
      valorAtivo: num('valorAtivo'),
      obrigacoesAquisicaoImoveis: num('obrigacoesAquisicaoImoveis'),
      obrigacoesSecuritizacao: num('obrigacoesSecuritizacao'),
      rendimentosDistribuir: num('rendimentosDistribuir'),
      direitosBensImoveis: num('direitosBensImoveis'),
      terrenos: num('terrenos'),
      imoveisRendaAcabados: num('imoveisRendaAcabados'),
      imoveisRendaConstrucao: num('imoveisRendaConstrucao'),
      imoveisVendaAcabados: num('imoveisVendaAcabados'),
      imoveisVendaConstrucao: num('imoveisVendaConstrucao'),
      outrosDireitosReais: num('outrosDireitosReais'),
      totalInvestido: num('totalInvestido'),
    });
  }
  return { porCnpj, seriePorCnpj, faltando, colunas: cols, escalaDy };
}

/**
 * Indicadores que só a SÉRIE mensal responde.
 *
 * O motor pontua "DY médio (36 meses)" e "meses pagando (24m)" — duas
 * perguntas sobre consistência, que um informe isolado não responde e que
 * ficavam vazias enquanto o job lia um mês só.
 *
 * Ambos saem de dado publicado, sem estimar nada. O que NÃO sai daqui é o
 * crescimento do dividendo: o informe publica o yield (rendimento ÷ preço),
 * e a variação do yield confunde mudança de rendimento com mudança de
 * preço. Fica nulo — inventá-lo seria pior do que não tê-lo.
 *
 * A janela é a dos meses observados, e o número deles vai junto: "média de
 * 8 meses" e "média de 36" não merecem a mesma confiança, e quem lê precisa
 * poder distinguir.
 */
function indicadoresDaSerieFii(serie, opcoes) {
  const op = opcoes || {};
  const janelaDy = op.janelaDy || 36;
  const janelaConsistencia = op.janelaConsistencia || 24;
  // Piso de meses. Com dois informes, "DY médio" é o DY atual repetido, e
  // pontuá-lo como indicador SEPARADO faria o mesmo dado valer duas vezes
  // no pilar de dividendos. Meia dúzia de competências é o mínimo para a
  // média dizer algo que o último mês já não diga.
  const minimoMeses = op.minimoMeses || 6;
  const vazio = {
    dyMedio36m: null,
    consistenciaDividendos: null,
    crescimentoDividendo12m: null,
    crescimentoFonte: null,
    crescimentoSaldo: null,
    crescimentoMotivo: 'sem_serie',
    crescimentoBruto: null,
    mesesSaldoQuitado: 0,
    crescimentoPorDy: null,
    crescimentoPorDyMotivo: 'sem_serie',
    razaoSaldoDy: null,
    mesesComparados: 0,
    mesesComRendimento: 0,
    mesesObservados: 0,
  };
  if (!Array.isArray(serie) || !serie.length) return vazio;

  // Um mês pode ser reenviado, E vem repartido entre membros do ZIP: o DY
  // do `complemento`, o rendimento a distribuir do `ativo_passivo`. Reunir
  // por competência, completando campo a campo, é o que torna o rendimento
  // por cota calculável — nenhum membro sozinho tem as duas pontas.
  const porMes = new Map();
  for (const p of serie) {
    const mes = String(p.dataReferencia).slice(0, 7);
    const acum = porMes.get(mes) || {
      dyMes: null,
      rendimentosDistribuir: null,
      numeroCotas: null,
      valorPatrimonialCota: null,
    };
    for (const campo of ['dyMes', 'rendimentosDistribuir', 'numeroCotas', 'valorPatrimonialCota']) {
      if (p[campo] !== null && p[campo] !== undefined) acum[campo] = p[campo];
    }
    porMes.set(mes, acum);
  }
  const meses = Array.from(porMes.keys()).sort();

  const comDy = meses.filter((m) => porMes.get(m).dyMes !== null);
  const ultimosDy = comDy.slice(-janelaDy).map((m) => porMes.get(m).dyMes);
  const dyMedio36m = ultimosDy.length
    ? Math.round((ultimosDy.reduce((a, b) => a + b, 0) / ultimosDy.length) * 12 * 1e4) / 1e4
    : null;

  const ultimosCons = comDy.slice(-janelaConsistencia);
  const pagando = ultimosCons.filter((m) => porMes.get(m).dyMes > 0).length;
  const consistenciaDividendos = ultimosCons.length
    ? Math.round((pagando / ultimosCons.length) * 1000) / 10
    : null;

  if (comDy.length < minimoMeses) {
    return { ...vazio, crescimentoMotivo: 'poucos_meses', mesesObservados: comDy.length };
  }
  const cresc = crescimentoDividendoFii(porMes, meses);
  // O segundo caminho corre SEMPRE, mesmo quando o primeiro deu resultado —
  // é nos fundos onde os dois existem que a comparação vale alguma coisa.
  // Ainda não substitui o indicador: primeiro o log tem de mostrar que as
  // duas leituras concordam onde ambas são possíveis.
  const porDy = crescimentoPorDyFii(porMes, meses);

  // MEDIDO, não suposto. A rodada de validação comparou os dois caminhos em
  // seis fundos com 31 meses cada — HGLG11, KNRI11, VISC11, HGRU11, KNCR11 e
  // VGHF11 — e a razão entre eles deu 1 (1,01 num). Cento e oitenta e seis
  // comparações mensais concordando respondem à pergunta que o raciocínio
  // não respondia: o `Percentual_Dividend_Yield_Mes` da CVM é sobre o valor
  // PATRIMONIAL, não sobre o preço. `DY × VPC` reconstrói a mesma grandeza
  // que o saldo de balanço.
  //
  // O DY passa a ser o caminho principal por COBERTURA: o saldo fecha em
  // zero em fundos que liquidam dentro do mês (29 dos 31 meses no BTLG11), e
  // o DY existe em todo mês que teve rendimento. O saldo fica de reserva —
  // ele salva o GGRC11, que paga em 20,8% dos meses e dá base zero pelo DY.
  //
  // Um detalhe que reforça a escolha: o crescimento é a razão entre duas
  // janelas da MESMA série, então um erro uniforme de escala no DY (a
  // detecção razão-vs-percentagem) cancela-se por completo. Este caminho é
  // imune àquela heurística; o saldo não seria.
  const usouDy = porDy.valor !== null;
  const escolhido = usouDy ? porDy : cresc;
  return {
    dyMedio36m,
    consistenciaDividendos,
    crescimentoDividendo12m: escolhido.valor,
    crescimentoFonte: escolhido.valor === null ? null : usouDy ? 'dy_vpc' : 'saldo',
    crescimentoMotivo: escolhido.motivo,
    crescimentoBruto: escolhido.bruto,
    // O valor do caminho do SALDO, sempre, à parte do escolhido. Existe
    // porque o log rotulava `crescimentoBruto` como "reserva (saldo)" depois
    // de ele passar a carregar o caminho escolhido: em todo fundo os dois
    // números passaram a ser o mesmo, e a linha de comparação concordava
    // consigo própria. Rótulo que sai de quem foi CHAMADO em vez de quem
    // RESPONDEU é a proibição que este projeto já pagou uma vez, na
    // degradação de cotação que carimbava BRAPI no que vinha do Yahoo.
    crescimentoSaldo: cresc.valor,
    mesesSaldoQuitado: cresc.mesesSaldoQuitado,
    mesesComRendimento: cresc.mesesComRendimento,
    crescimentoPorDy: porDy.valor,
    crescimentoPorDyMotivo: porDy.motivo,
    razaoSaldoDy: cresc.razaoSaldoDy,
    mesesComparados: cresc.mesesComparados,
    mesesObservados: comDy.length,
  };
}

/**
 * Crescimento do dividendo em 12 meses, SEM preço na conta.
 *
 * `Rendimentos_Distribuir` ÷ `Cotas_Emitidas` é o rendimento por cota
 * declarado naquele mês. Somar doze e comparar com os doze anteriores
 * responde "o fundo está distribuindo mais por cota do que distribuía?" —
 * que é a pergunta do pilar de crescimento.
 *
 * O caminho pelo DY não responde isso: yield é rendimento ÷ PREÇO, e um
 * fundo que não mudou um centavo de distribuição aparece "crescendo" só
 * porque a cota caiu. Por isso este indicador ficou nulo até existir a
 * série do rendimento em si.
 *
 * Exige as duas janelas razoavelmente completas: com três meses de um lado
 * e doze do outro, a razão mede a lacuna, não o crescimento.
 */
/**
 * Duas janelas de doze meses comparadas, com as travas de sempre.
 *
 * Vive à parte porque há DOIS caminhos até o rendimento por cota — o saldo
 * do balanço e o yield sobre o valor patrimonial — e comparar os dois exige
 * que a janela, o mínimo por janela e a faixa de sanidade sejam idênticos.
 * Duplicar essa lógica faria a divergência entre os caminhos medir a
 * diferença entre duas implementações, não entre duas fontes.
 */
function compararJanelas(porCota) {
  const MIN_POR_JANELA = 9;
  const comDado = Array.from(porCota.keys()).sort();
  const d = { mesesComRendimento: comDado.length, valor: null, motivo: null, bruto: null };
  if (comDado.length < MIN_POR_JANELA * 2) {
    d.motivo = 'serie_curta';
    return d;
  }
  const recentes = comDado.slice(-12);
  const anteriores = comDado.slice(-24, -12);
  if (recentes.length < MIN_POR_JANELA || anteriores.length < MIN_POR_JANELA) {
    d.motivo = 'janela_incompleta';
    return d;
  }
  const soma = (lista) => lista.reduce((t, m) => t + porCota.get(m), 0);
  // Média por mês, não soma: as janelas podem ter contagens diferentes, e
  // comparar soma de 12 com soma de 10 inventaria uma queda de 17%.
  const mediaRecente = soma(recentes) / recentes.length;
  const mediaAnterior = soma(anteriores) / anteriores.length;
  if (!(mediaAnterior > 0)) {
    d.motivo = 'base_zero';
    return d;
  }
  const cresc = (mediaRecente / mediaAnterior - 1) * 100;
  d.bruto = Math.round(cresc * 10) / 10;
  // Fora desta faixa não é crescimento de distribuição: é mudança de
  // estrutura (emissão, incorporação) ou linha lida errado.
  if (!(cresc >= -95 && cresc <= 200)) {
    d.motivo = 'fora_de_faixa';
    return d;
  }
  d.valor = d.bruto;
  return d;
}

/**
 * O MESMO crescimento, pelo yield declarado sobre o valor patrimonial.
 *
 * Caminho independente do saldo de balanço, e existe porque o saldo não
 * serve para todo fundo: no BTLG11 ele fecha em zero em 29 dos 31 meses.
 *
 * O informe mensal NÃO tem coluna de preço nenhuma — a listagem real de
 * `complemento` traz `Valor_Patrimonial_Cotas` e nada de cotação. Uma
 * declaração que não registra o preço não pode calcular yield sobre ele, e
 * é isso que torna `DY × VPC` uma reconstrução do rendimento por cota, não
 * uma mistura de rendimento com variação de cotação.
 *
 * Continua a ser hipótese até o log a confrontar com o saldo nos fundos que
 * têm os dois. É para isso que os dois caminhos são calculados lado a lado.
 */
function crescimentoPorDyFii(porMes, meses) {
  const porCota = new Map();
  for (const mes of meses) {
    const p = porMes.get(mes);
    if (p.dyMes === null || p.valorPatrimonialCota === null) continue;
    if (!(p.valorPatrimonialCota > 0) || p.dyMes < 0) continue;
    porCota.set(mes, (p.dyMes / 100) * p.valorPatrimonialCota);
  }
  return compararJanelas(porCota);
}

function crescimentoDividendoFii(porMes, meses) {
  const porCota = new Map();
  let saldoQuitado = 0;
  const razoes = [];
  for (const mes of meses) {
    const p = porMes.get(mes);
    if (p.rendimentosDistribuir === null || p.numeroCotas === null) continue;
    if (!(p.numeroCotas > 0) || p.rendimentosDistribuir < 0) continue;
    // `Rendimentos_Distribuir` é SALDO de balanço — o que foi declarado e
    // ainda não saiu do caixa — não o que foi distribuído no mês. Num fundo
    // que liquida dentro do próprio mês, o saldo fecha em zero mesmo tendo
    // pago tudo. Contar esse zero como "distribuiu nada" produziu, no
    // BTLG11, um crescimento de exatamente −100% num fundo que paga em 100%
    // dos meses; a trava de faixa recusou, e o indicador ficou vazio.
    //
    // Mês com yield positivo e saldo zero é CONTRADIÇÃO, não zero: o fundo
    // pagou, o saldo é que não descreve o pagamento. Contradição é lacuna.
    if (p.rendimentosDistribuir === 0 && p.dyMes > 0) {
      saldoQuitado++;
      continue;
    }
    const valor = p.rendimentosDistribuir / p.numeroCotas;
    porCota.set(mes, valor);
    // A razão entre os dois caminhos, mês a mês, é a evidência que decide
    // sobre que base a CVM calcula o `Percentual_Dividend_Yield_Mes`. Perto
    // de 1 significa que o yield é sobre o valor patrimonial, e aí `DY × VPC`
    // reconstrói o rendimento por cota nos fundos onde o saldo não serve.
    // Sistematicamente longe de 1 desmente a hipótese, e é melhor sabê-lo
    // pelo log do que descobri-lo num ranking publicado.
    if (p.dyMes > 0 && p.valorPatrimonialCota > 0 && valor > 0) {
      razoes.push(valor / ((p.dyMes / 100) * p.valorPatrimonialCota));
    }
  }
  const d = compararJanelas(porCota);
  // Quantos meses foram descartados por saldo quitado. Vai ao log porque é
  // a diferença entre "o fundo não distribui" e "a coluna não descreve a
  // distribuição deste fundo" — hipóteses opostas com o mesmo travessão.
  d.mesesSaldoQuitado = saldoQuitado;
  razoes.sort((a, b) => a - b);
  d.razaoSaldoDy = razoes.length
    ? Math.round(razoes[Math.floor(razoes.length / 2)] * 100) / 100
    : null;
  d.mesesComparados = razoes.length;
  return d;
}
module.exports.indicadoresDaSerieFii = indicadoresDaSerieFii;

/**
 * Razão ou percentagem? Decidido pela mediana dos valores positivos do
 * arquivo.
 *
 * DY mensal real de FII vive entre 0,3% e 2%. Como razão isso é 0,003 a
 * 0,02 — trinta vezes abaixo. Não há sobreposição entre as duas leituras
 * para fundo nenhum, e é por isso que a mediana decide sem ambiguidade.
 */
function escalaDoDividendYield(registros, coluna) {
  if (!coluna) return { fator: 1, mediana: null, amostra: 0 };
  const vals = [];
  for (const r of registros || []) {
    const v = valorNumericoCvm(r[coluna]);
    if (v !== null && v > 0) vals.push(v);
  }
  if (!vals.length) return { fator: 1, mediana: null, amostra: 0 };
  vals.sort((a, b) => a - b);
  const mediana = vals[Math.floor(vals.length / 2)];
  return { fator: mediana < 0.1 ? 100 : 1, mediana, amostra: vals.length };
}

module.exports.FAIXAS = FAIXAS;
module.exports.COLUNAS_FII = COLUNAS_FII;
module.exports.COLUNAS_FII_IMOVEIS = COLUNAS_FII_IMOVEIS;
module.exports.agruparPorEmpresa = agruparPorEmpresa;
module.exports.extrairFinanceiro = extrairFinanceiro;
module.exports.planoDaEmpresa = planoDaEmpresa;
module.exports.dividendosPagosDetalhado = dividendosPagosDetalhado;
module.exports.calcularIndicadores = calcularIndicadores;
module.exports.aliquotaEfetiva = aliquotaEfetiva;
module.exports.cagr = cagr;
module.exports.extrairInformeFii = extrairInformeFii;

// ════════════════════════════════════════════════════════════
// Vínculo ticker ↔ fundo
// ════════════════════════════════════════════════════════════
//
// O casamento por NOME contra o `cad_fi.csv` não funciona, e a execução real
// mostrou por quê: dos 584 fundos imobiliários daquele cadastro, "MAXI" não
// aparece em nenhum. Não é o nome que mudou — a fonte não cobre os fundos
// listados em bolsa. Nenhum ajuste de string conserta isso.
//
// O vínculo tem de vir de um CÓDIGO publicado, não de um nome. Duas fontes,
// nesta ordem:
//
//  1. Uma coluna de código de negociação, se a CVM publicar uma. Direta.
//  2. O `Codigo_ISIN` do próprio informe. O ISIN de cota de fundo brasileiro
//     tem forma `BR` + RAIZ + `CTF` + 3 dígitos, e a RAIZ é exatamente a raiz
//     do ticker: MXRF11 ↔ BRMXRFCTF004, HGLG11 ↔ BRHGLGCTF003. A B3 é a
//     agência nacional de numeração; a raiz não é convenção nossa, é o
//     código que ela atribuiu.
//
// Nos dois casos o vínculo sai de um campo publicado. Não há tabela escrita
// à mão para envelhecer, e um FII novo entra sozinho.
const COLUNAS_VINCULO_FII = {
  cnpj: ['CNPJ_Fundo_Classe', 'CNPJ_Fundo', 'CNPJ_FUNDO', 'CNPJ'],
  dataReferencia: ['Data_Referencia', 'DT_COMPTC', 'DATA_REFERENCIA'],
  nome: ['Nome_Fundo_Classe', 'Nome_Fundo', 'NOME_FUNDO', 'DENOM_SOCIAL', 'NM_FUNDO'],
  codigoNegociacao: [
    'Codigo_Negociacao',
    'CODIGO_NEGOCIACAO',
    'Cod_Negociacao',
    'COD_NEGOCIACAO',
    'Codigo_Negociacao_Cota',
    'Ticker',
  ],
  isin: ['Codigo_ISIN', 'CODIGO_ISIN', 'Codigo_Isin', 'ISIN'],
  // Desempate: sob a RCVM 175 um fundo tem classes, e mais de uma pode
  // carregar a mesma raiz de ISIN. Só uma é negociada em bolsa, e é essa
  // que o ticker designa. A execução real mostrou o risco: XPML11 casou com
  // dois CNPJs e o vencedor foi decidido pela ordem do arquivo.
  negociaBolsa: ['Mercado_Negociacao_Bolsa', 'MERCADO_NEGOCIACAO_BOLSA'],
};

// `CTF` = cota de fundo. Restringir ao tipo evita casar a raiz de um ISIN de
// outra espécie que por acaso tenha as mesmas quatro letras.
const ISIN_COTA_FUNDO = /^BR([A-Z0-9]{4})CTF\d{3}$/;

/** Raiz do ticker embutida no ISIN de cota de fundo, ou null. */
function raizDoIsin(isin) {
  const m = ISIN_COTA_FUNDO.exec(
    String(isin === null || isin === undefined ? '' : isin)
      .trim()
      .toUpperCase()
  );
  return m ? m[1] : null;
}

/**
 * Índice código de negociação → fundo, tirado do próprio informe.
 *
 * Quando o mesmo código aparece com CNPJs diferentes (fusão, sucessão), o
 * informe mais recente vence e a entrada fica marcada — casar com o fundo
 * errado é pior do que não casar, e quem chama precisa poder mostrar isso.
 */
function vincularFiiPorCodigo(registros, colunas) {
  const cols = {};
  for (const campo of Object.keys(COLUNAS_VINCULO_FII)) {
    cols[campo] = acharColuna(colunas, COLUNAS_VINCULO_FII[campo]);
  }
  const vazio = { via: null, coluna: null, porCodigo: new Map(), total: 0, colunas: cols };
  if (!cols.cnpj) return vazio;

  const usarCodigo = !!cols.codigoNegociacao;
  if (!usarCodigo && !cols.isin) return vazio;

  // Um código pode ter vários candidatos (classes do mesmo fundo, sucessão).
  // Reunir TODOS antes de escolher é o que permite desempatar por critério
  // em vez de por ordem do arquivo — que não é critério nenhum.
  const candidatosPorCodigo = new Map();
  let total = 0;
  for (const r of registros || []) {
    const cnpj = String(r[cols.cnpj] || '').replace(/\D/g, '');
    if (cnpj.length !== 14) continue;

    // A coluna direta, quando existe, pode vir vazia em parte das linhas;
    // o ISIN cobre o resto sem que a fonte precise ser escolhida de véspera.
    const bruto = usarCodigo ? String(r[cols.codigoNegociacao] || '').trim() : '';
    const direto = bruto.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const isin = cols.isin ? String(r[cols.isin] || '').trim() : '';
    const raiz = raizDoIsin(isin);
    const codigo = direto.length >= 4 ? direto : raiz;
    if (!codigo) continue;

    total += 1;
    const data = cols.dataReferencia ? String(r[cols.dataReferencia] || '').trim() : '';
    const bolsa = cols.negociaBolsa
      ? normalizarChave(r[cols.negociaBolsa]) === 'S' ||
        normalizarChave(r[cols.negociaBolsa]) === 'SIM'
      : null;
    const porCnpj = candidatosPorCodigo.get(codigo) || new Map();
    const anterior = porCnpj.get(cnpj);
    if (!anterior || !anterior.dataReferencia || anterior.dataReferencia < data) {
      porCnpj.set(cnpj, {
        codigo,
        cnpj,
        isin: isin || null,
        nome: cols.nome ? String(r[cols.nome] || '').trim() || null : null,
        dataReferencia: data || null,
        bolsa,
        via: direto.length >= 4 ? 'codigo_negociacao' : 'isin',
      });
    }
    candidatosPorCodigo.set(codigo, porCnpj);
  }

  const porCodigo = new Map();
  for (const [codigo, porCnpj] of candidatosPorCodigo) {
    const candidatos = Array.from(porCnpj.values());
    let escolhidos = candidatos;
    let desempate = null;
    if (candidatos.length > 1) {
      // O ticker designa a classe NEGOCIADA. Quando a fonte diz quais são,
      // isso resolve sozinho. Quando as duas se declaram em bolsa — visto na
      // execução real do XPML11 —, fundoDoTicker tenta um segundo critério
      // pelo nome curado em mapa-cvm.json; só este aqui é nativo da CVM.
      const emBolsa = candidatos.filter((c) => c.bolsa === true);
      if (emBolsa.length === 1) {
        escolhidos = emBolsa;
        desempate = 'bolsa';
      }
    }
    const vencedor = escolhidos
      .slice()
      .sort((a, b) =>
        String(b.dataReferencia || '').localeCompare(String(a.dataReferencia || ''))
      )[0];
    porCodigo.set(codigo, {
      ...vencedor,
      ambiguo: escolhidos.length > 1,
      desempate,
      // Objetos completos, não só {cnpj, nome, bolsa}: fundoDoTicker precisa
      // de isin/dataReferencia/via para reconstruir um vencedor se resolver
      // pelo nome depois daqui.
      candidatos: candidatos.slice(),
    });
  }

  const via = usarCodigo && total ? 'codigo_negociacao' : total ? 'isin' : null;
  return {
    via,
    coluna: usarCodigo ? cols.codigoNegociacao : cols.isin,
    porCodigo,
    total,
    colunas: cols,
  };
}

/**
 * Fundo de um ticker, pelo índice acima.
 *
 * Tenta o ticker inteiro (quando a fonte publica o código de negociação) e
 * depois a raiz de quatro caracteres (quando veio do ISIN). Não inventa
 * ticker a partir de raiz: a raiz procurada é sempre a do ticker pedido.
 *
 * `nomeEsperado` (a denominação curada em mapa-cvm.json, a mesma que já casa
 * as ações em casarCadastro) é o critério de desempate SEGUINTE ao de bolsa.
 * A execução real mostrou os dois candidatos do XPML11 declarando negociação
 * em bolsa — o desempate nativo da CVM não os separa. Só resolve quando
 * exatamente um candidato contém o termo: nenhum batendo ou os dois batendo
 * deixa a ambiguidade como estava, porque casar pelo candidato mais parecido
 * é o mesmo erro que já juntou o MXRF11 a um fundo de renda fixa homônimo.
 */
function fundoDoTicker(vinculo, ticker, nomeEsperado) {
  if (!vinculo || !vinculo.porCodigo) return null;
  const limpo = String(ticker || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  if (limpo.length < 4) return null;
  const achado = vinculo.porCodigo.get(limpo) || vinculo.porCodigo.get(limpo.slice(0, 4)) || null;
  if (!achado || !achado.ambiguo || !nomeEsperado) return achado;

  const alvo = normalizarChave(nomeEsperado);
  if (!alvo) return achado;
  const porNome = (achado.candidatos || []).filter((c) => normalizarChave(c.nome).includes(alvo));
  if (porNome.length !== 1) return achado;
  return {
    ...porNome[0],
    ambiguo: false,
    desempate: 'nome',
    candidatos: achado.candidatos,
  };
}

// ════════════════════════════════════════════════════════════
// Vacância e imóveis — informe TRIMESTRAL
// ════════════════════════════════════════════════════════════
//
// O informe MENSAL não publica vacância nem contagem de imóveis. Isso não é
// suposição: a execução real imprimiu as colunas dos três membros e ali há
// só rubricas de balanço (`Imoveis_Renda_Acabados`, `Terrenos`, …), valores
// em reais, nenhuma taxa de ocupação.
//
// Quem as publica é o informe trimestral, com uma linha POR IMÓVEL. Daí
// vêm duas coisas que o motor pontua e que estavam vazias: quantos imóveis
// o fundo tem (é a contagem de linhas, não uma coluna) e quanto deles está
// vago.
//
// A vacância é ponderada pela área quando a área existe: um galpão vago de
// 50 mil m² não pesa o mesmo que uma loja vaga de 200 m², e a média simples
// trataria os dois como iguais.
const COLUNAS_FII_TRIMESTRAL = {
  cnpj: ['CNPJ_Fundo_Classe', 'CNPJ_Fundo', 'CNPJ_FUNDO', 'CNPJ'],
  dataReferencia: ['Data_Referencia', 'DT_COMPTC'],
  versao: ['Versao', 'VERSAO'],
  // `Percentual_Locado` é a OCUPAÇÃO publicada — o que o motor pontua, sem
  // subtração no meio. Prefere-se à vacância por dois motivos: é o número
  // direto, e a sua escala é decidível sem ambiguidade (a mediana de um
  // arquivo de imóveis locados fica em 1 se for razão e em 100 se for
  // percentagem). A vacância tem mediana ZERO — a maioria dos imóveis está
  // cheia —, e mediana zero não decide escala nenhuma.
  locado: ['Percentual_Locado', 'Percentual_Ocupacao'],
  vacancia: [
    'Percentual_Vacancia',
    'Percentual_Vacancia_Fisica',
    'Percentual_Vacancia_Financeira',
    'Vacancia',
    'Percentual_Area_Vacante',
  ],
  area: ['Area_Bruta_Locavel', 'Area_Locavel', 'Area_Total', 'Area', 'Area_M2'],
};

/**
 * Razão ou percentagem, decidido pela mediana dos valores positivos.
 *
 * Mesmo problema do `Percentual_Dividend_Yield_Mes`, que se chama
 * "percentual" e é razão. Aqui o divisor é o valor típico de um imóvel
 * cheio: 1 como razão, 100 como percentagem.
 */
function escalaPercentual(registros, coluna, limiar) {
  if (!coluna) return { fator: 1, mediana: null, amostra: 0 };
  const vals = [];
  for (const r of registros || []) {
    const v = valorNumericoCvm(r[coluna]);
    if (v !== null && v > 0) vals.push(v);
  }
  if (!vals.length) return { fator: 1, mediana: null, amostra: 0 };
  vals.sort((a, b) => a - b);
  const mediana = vals[Math.floor(vals.length / 2)];
  return { fator: mediana <= limiar ? 100 : 1, mediana, amostra: vals.length };
}

/**
 * Imóveis e vacância por fundo, do informe trimestral.
 *
 * Só o trimestre mais recente conta: um fundo que vendeu metade da carteira
 * ficaria com o dobro dos imóveis se todos os trimestres fossem somados.
 */
function extrairImoveisFii(registros, colunas) {
  const cols = {};
  for (const campo of Object.keys(COLUNAS_FII_TRIMESTRAL)) {
    cols[campo] = acharColuna(colunas, COLUNAS_FII_TRIMESTRAL[campo]);
  }
  const faltando = Object.keys(COLUNAS_FII_TRIMESTRAL).filter((c) => !cols[c]);
  const porCnpj = new Map();
  const vazio = { porCnpj, faltando, colunas: cols, escalaLocado: null, escalaVacancia: null };
  if (!cols.cnpj) return vazio;

  // As DUAS colunas, linha a linha — não uma escolhida para o arquivo
  // inteiro. `Percentual_Locado` é o número direto, mas vem VAZIO na maioria
  // das linhas: preferi-lo para o arquivo todo fez a ocupação sair de uma
  // amostra de quatro imóveis em duzentos e vinte e oito, e as linhas que
  // reportam são justamente as excepcionais. `Percentual_Vacancia` é a densa.
  //
  // Cada coluna tem a sua escala, porque cada uma tem um valor típico
  // diferente: imóvel cheio é 1 (razão) ou 100 (percentagem) em "locado"; em
  // "vacância" o valor típico NÃO nulo fica abaixo de 1 como razão e acima
  // como percentagem.
  const escalaLocado = escalaPercentual(registros, cols.locado, 1.5);
  const escalaVacancia = escalaPercentual(registros, cols.vacancia, 1);

  // Reenvio do mesmo trimestre: vale a VERSÃO mais alta. Somar as duas
  // duplicaria a carteira inteira do fundo que corrigiu um informe.
  const melhor = new Map();
  for (const r of registros || []) {
    const cnpj = String(r[cols.cnpj] || '').replace(/\D/g, '');
    if (cnpj.length !== 14) continue;
    const data = cols.dataReferencia ? String(r[cols.dataReferencia] || '').trim() : '';
    const versao = cols.versao ? valorNumericoCvm(r[cols.versao]) || 0 : 0;
    const atual = melhor.get(cnpj);
    if (!atual || data > atual.data || (data === atual.data && versao > atual.versao)) {
      melhor.set(cnpj, { data, versao });
    }
  }

  for (const r of registros || []) {
    const cnpj = String(r[cols.cnpj] || '').replace(/\D/g, '');
    if (cnpj.length !== 14) continue;
    const data = cols.dataReferencia ? String(r[cols.dataReferencia] || '').trim() : '';
    const versao = cols.versao ? valorNumericoCvm(r[cols.versao]) || 0 : 0;
    const alvo = melhor.get(cnpj);
    if (data !== alvo.data || versao !== alvo.versao) continue;

    const acum = porCnpj.get(cnpj) || {
      cnpj,
      dataReferencia: data || null,
      numeroImoveis: 0,
      // As DUAS áreas: a do portfólio inteiro e a que de facto tem taxa
      // publicada. É a razão entre as duas que decide se o dado presta —
      // ver a nota abaixo sobre por que CONTAGEM de imóvel é a métrica
      // errada para isso.
      areaTotalGeral: 0,
      areaTotal: 0,
      ocupadoPonderado: 0,
      somaOcupacao: 0,
      comTaxa: 0,
      imoveisComVago: 0,
    };
    acum.numeroImoveis += 1;

    const locado = cols.locado ? valorNumericoCvm(r[cols.locado]) : null;
    const vago = cols.vacancia ? valorNumericoCvm(r[cols.vacancia]) : null;
    // Ocupação, sempre — mesmo quando a linha só publica vacância.
    const ocupado =
      locado !== null
        ? locado * escalaLocado.fator
        : vago !== null
          ? 100 - vago * escalaVacancia.fator
          : null;
    const area = cols.area ? valorNumericoCvm(r[cols.area]) : null;
    if (area !== null && area > 0) acum.areaTotalGeral += area;
    if (ocupado !== null && ocupado >= 0 && ocupado <= 100) {
      acum.somaOcupacao += ocupado;
      acum.comTaxa += 1;
      if (ocupado < 100) acum.imoveisComVago += 1;
      if (area !== null && area > 0) {
        acum.areaTotal += area;
        acum.ocupadoPonderado += (ocupado / 100) * area;
      }
    }
    porCnpj.set(cnpj, acum);
  }

  // Abaixo desta fração do PORTFÓLIO com o dado, a média descreve a amostra
  // e não a carteira — e a amostra que reporta é enviesada, porque quem
  // preenche o campo costuma ser justamente quem tem o que declarar.
  //
  // A fração é por ÁREA, não por contagem de imóvel. Achado real: com a
  // cobertura por CONTAGEM, oito dos nove FIIs ficaram nulos — inclusive
  // HGLG11 (157 imóveis, só 7 reportando = 24%) e BTLG11 (121 imóveis, 4
  // reportando = 25%), fundos de logística consolidados, não sem dado. A
  // hipótese: o informe mistura linhas de natureza diferente — a coluna
  // real traz `Percentual_Vendido` e `Percentual_Conclusao_Obras`, sinal de
  // imóvel em obras ou à venda, sem ocupação para reportar por definição —
  // e um fundo com poucos imóveis GRANDES bem cobertos reprova no piso por
  // CONTAGEM mesmo cobrindo a maior parte do patrimônio. Pesar por área é
  // consistente com o que a própria média já faz (ponderação por área) e
  // não depende de adivinhar o que `Categoria`/`Classe` significam.
  //
  // Isto ainda não foi conferido contra o resultado real — o log abaixo
  // imprime as duas coberturas lado a lado para a próxima execução provar
  // ou desmentir a hipótese, não para escondê-la atrás de um número só.
  const COBERTURA_MINIMA = 0.6;
  for (const acum of porCnpj.values()) {
    const coberturaContagem = acum.numeroImoveis ? acum.comTaxa / acum.numeroImoveis : 0;
    const coberturaArea = acum.areaTotalGeral > 0 ? acum.areaTotal / acum.areaTotalGeral : null;
    // Sem área nenhuma reportada (fundo que não publica a coluna), cai para
    // a contagem — pior do que nada, melhor do que não ter piso algum.
    acum.coberturaOcupacao = coberturaArea === null ? coberturaContagem : coberturaArea;
    acum.coberturaContagem = coberturaContagem;
    acum.coberturaArea = coberturaArea;
    const media =
      acum.areaTotal > 0
        ? Math.round((acum.ocupadoPonderado / acum.areaTotal) * 1000) / 10
        : acum.comTaxa
          ? Math.round((acum.somaOcupacao / acum.comTaxa) * 10) / 10
          : null;
    acum.ocupacao = acum.coberturaOcupacao >= COBERTURA_MINIMA ? media : null;
    acum.vacancia = acum.ocupacao === null ? null : Math.round((100 - acum.ocupacao) * 10) / 10;
  }
  return { porCnpj, faltando, colunas: cols, escalaLocado, escalaVacancia };
}

/**
 * LTV do fundo: obrigações que financiam a carteira sobre o ativo.
 *
 * As duas pontas vêm de MEMBROS DIFERENTES do ZIP — o ativo do
 * `complemento`, as obrigações do `ativo_passivo` —, e por isso o cálculo
 * mora aqui, depois de os membros terem sido reunidos.
 *
 * Sem obrigação declarada o resultado é 0%, não lacuna: um FII que não
 * publica nenhuma das duas rubricas não tem essa dívida, e tratá-lo como
 * "não sei" penalizaria justamente o fundo sem alavancagem.
 */
function alavancagemFii(inf) {
  if (!inf) return null;
  const ativo = inf.valorAtivo;
  if (ativo === null || ativo === undefined || !(ativo > 0)) return null;
  const aquisicao = inf.obrigacoesAquisicaoImoveis;
  const securitizacao = inf.obrigacoesSecuritizacao;
  if (
    (aquisicao === null || aquisicao === undefined) &&
    (securitizacao === null || securitizacao === undefined)
  ) {
    return null;
  }
  const divida = (aquisicao || 0) + (securitizacao || 0);
  const ltv = (divida / ativo) * 100;
  // Acima de 100% do ativo não é LTV: é linha lida errado.
  if (!(ltv >= 0 && ltv <= 100)) return null;
  return Math.round(ltv * 10) / 10;
}

/** A maioria da carteira em imóvel é o que faz o fundo ser de tijolo. */
const FRACAO_TIJOLO = 0.5;

/**
 * Fundo de TIJOLO ou de PAPEL, decidido pela carteira publicada.
 *
 * Cobrar taxa de ocupação e número de imóveis de um fundo de recebíveis é o
 * mesmo erro que cobrar EBITDA de um banco: o indicador não está ausente,
 * ele **não se aplica**. E o efeito é o mesmo — cobertura artificialmente
 * baixa, que aciona o encolhimento do score contra um fundo que não tem
 * defeito nenhum.
 *
 * A classificação exige EVIDÊNCIA POSITIVA, nunca a mera ausência: um fundo
 * fora do informe trimestral pode ser de papel, mas também pode ser um que
 * não entregou. Só a rubrica imobiliária do balanço decide.
 *
 * A decisão é pela FATIA da carteira, não pela presença. "Tem algum imóvel"
 * classificou o MXRF11 como tijolo na execução real — um fundo de recebíveis
 * com dois imóveis marginais numa carteira de 5,25 bi. E o efeito apareceu na
 * mesma linha do log: `imóveis 2 · cobertura área 0% · ocupação —`. Ele era
 * cobrado por uma ocupação que não descreve a receita dele, perdia cobertura
 * e levava o encolhimento do score por um defeito que não tem.
 *
 * O critério é a maioria da carteira, porque é isso que a pergunta significa:
 * a ocupação dos imóveis só caracteriza o fundo se o aluguel for o que paga o
 * rendimento. Numa fatia minoritária, ela descreve um canto da carteira.
 *
 *   imóveis ≥ 50% do investido  → tijolo
 *   imóveis <  50% do investido → papel
 *   sem a rubrica ou sem total  → null, e aí valem os critérios de sempre
 */
function carteiraFii(inf) {
  const nada = { tipo: null, fracaoImoveis: null, imoveis: null, total: null };
  if (!inf) return nada;
  const agregado = inf.direitosBensImoveis;
  // As folhas servem de reserva quando o agregado não vem, e de conferência
  // quando vem — mesmo cuidado do 6.03, onde somar pai e filhas contava
  // tudo duas vezes.
  const folhas = [
    'terrenos',
    'imoveisRendaAcabados',
    'imoveisRendaConstrucao',
    'imoveisVendaAcabados',
    'imoveisVendaConstrucao',
    'outrosDireitosReais',
  ];
  let somaFolhas = null;
  for (const campo of folhas) {
    const v = inf[campo];
    if (v === null || v === undefined) continue;
    somaFolhas = (somaFolhas || 0) + v;
  }
  const imoveis = agregado !== null && agregado !== undefined ? agregado : somaFolhas;
  if (imoveis === null || imoveis === undefined) return nada;
  // A fatia exige as duas pontas. Sem o total declarado não há denominador, e
  // "tem imóvel" sozinho não distingue o fundo de tijolo do de papel que
  // carrega dois — foi exatamente essa a confusão. Zero em tudo é fundo que
  // não preencheu, não fundo vazio.
  const total = inf.totalInvestido;
  if (total === null || total === undefined || !(total > 0)) return nada;
  const fracao = imoveis / total;
  return {
    tipo: fracao >= FRACAO_TIJOLO ? 'tijolo' : 'papel',
    fracaoImoveis: Math.round(fracao * 1000) / 10,
    imoveis,
    total,
  };
}

function tipoCarteiraFii(inf) {
  return carteiraFii(inf).tipo;
}

module.exports.tipoCarteiraFii = tipoCarteiraFii;
module.exports.carteiraFii = carteiraFii;
module.exports.FRACAO_TIJOLO = FRACAO_TIJOLO;

module.exports.alavancagemFii = alavancagemFii;

module.exports.COLUNAS_FII_TRIMESTRAL = COLUNAS_FII_TRIMESTRAL;
module.exports.extrairImoveisFii = extrairImoveisFii;

module.exports.COLUNAS_VINCULO_FII = COLUNAS_VINCULO_FII;
module.exports.raizDoIsin = raizDoIsin;
module.exports.vincularFiiPorCodigo = vincularFiiPorCodigo;
module.exports.fundoDoTicker = fundoDoTicker;

// ════════════════════════════════════════════════════════════
// Composição do capital
// ════════════════════════════════════════════════════════════
//
// A DFP publica a QUANTIDADE DE AÇÕES da companhia, num arquivo que o job
// baixava sem ler (`dfp_cia_aberta_composicao_capital_AAAA.csv`, um dos 19
// do ZIP). Isto substitui a derivação `lucro ÷ LPA`, que só funcionava para
// companhia de classe única — quando ON e PN têm lucro por ação diferente,
// uma divisão não separa as duas classes, e a valuation saía em 5 de 14.
//
// Aqui a contagem é DECLARADA. Não há o que derivar nem faixa de sanidade a
// arbitrar: o número é o que a companhia informou.

const COLUNAS_CAPITAL = {
  cnpj: ['CNPJ_CIA', 'CNPJ_Companhia', 'CNPJ'],
  cdCvm: ['CD_CVM', 'CODIGO_CVM'],
  dataReferencia: ['DT_FIM_EXERC', 'DT_REFER', 'Data_Referencia'],
  ordinarias: [
    'QT_ACAO_ORDIN_CAP_INTEGR',
    'Quantidade_Acao_Ordinaria_Capital_Integralizado',
    'QT_ACAO_ORDIN',
  ],
  preferenciais: [
    'QT_ACAO_PREF_CAP_INTEGR',
    'Quantidade_Acao_Preferencial_Capital_Integralizado',
    'QT_ACAO_PREF',
  ],
  // `TESOURO` vem primeiro porque é o nome do arquivo REAL. O mapa só
  // conhecia `TESOURARIA`, que a CVM não usa: as ações em tesouraria eram
  // lidas como zero em toda companhia, sem aviso nenhum, e o log dizia
  // `tes 0` — indistinguível de uma companhia que de facto não tem nenhuma.
  // Contar a tesouraria como zero infla as ações em circulação, e com elas o
  // valor de mercado e o P/L.
  ordinariasTesouraria: [
    'QT_ACAO_ORDIN_TESOURO',
    'QT_ACAO_ORDIN_TESOURARIA',
    'Quantidade_Acao_Ordinaria_Tesouraria',
  ],
  preferenciaisTesouraria: [
    'QT_ACAO_PREF_TESOURO',
    'QT_ACAO_PREF_TESOURARIA',
    'Quantidade_Acao_Preferencial_Tesouraria',
  ],
  // A ESCALA da quantidade, quando declarada. O arquivo real da CVM NÃO a
  // declara — a execução real listou as dez colunas de
  // `dfp_cia_aberta_composicao_capital` e nenhuma delas é escala. Fica no
  // mapa porque outros arquivos da CVM a trazem, mas quem decide a unidade
  // na prática é `conciliarContagemComPatrimonio`, pelo patrimônio.
  escalaQuantidade: ['ESCALA_QUANTIDADE', 'ESCALA_MOEDA', 'ESCALA'],
};

/**
 * Ações em circulação por companhia, do arquivo de composição do capital.
 *
 * Ações em tesouraria são DESCONTADAS: o valor de mercado é preço vezes o
 * que está em circulação, e cota recomprada não está. Ignorá-las inflaria o
 * valor de mercado e, com ele, o P/L e o P/VP de toda companhia que recompra.
 *
 * Indexa pelas duas identificações, com prefixo, igual a `agruparPorEmpresa`
 * — para a busca poder usar a mesma chave.
 */
function extrairComposicaoCapital(registros, colunas) {
  const cols = {};
  for (const campo of Object.keys(COLUNAS_CAPITAL)) {
    cols[campo] = acharColuna(colunas, COLUNAS_CAPITAL[campo]);
  }
  const faltando = Object.keys(COLUNAS_CAPITAL).filter((c) => !cols[c]);
  const porChave = new Map();
  if (!cols.ordinarias || (!cols.cnpj && !cols.cdCvm)) {
    return { porChave, faltando, colunas: cols, colunasReais: colunas };
  }

  const num = (r, campo) => (cols[campo] ? valorNumericoCvm(r[cols[campo]]) : null);
  // Todas as linhas de cada companhia, inclusive as DESCARTADAS e com o
  // motivo do descarte. Duas companhias saíram da execução real com
  // contagem impossível (ELET3 e AESO3, 0,00 bi de ações para dezenas de
  // bilhões de patrimônio) e nenhuma inspeção do resultado final explica
  // isso: a linha que venceu pode ser a errada, ou a certa pode ter sido
  // filtrada aqui. Só as linhas cruas separam as duas hipóteses — é o
  // mesmo movimento que resolveu o 6.03 e as colunas do informe.
  const LINHAS_POR_EMPRESA = 8;
  const linhasPorChave = new Map();
  const anotar = (chaves, linha) => {
    for (const chave of chaves) {
      const lista = linhasPorChave.get(chave) || [];
      if (lista.length < LINHAS_POR_EMPRESA) lista.push(linha);
      linhasPorChave.set(chave, lista);
    }
  };
  const chavesDaLinha = (r) => {
    const chaves = [];
    const cnpj = cols.cnpj ? normalizarCnpj(r[cols.cnpj]) : null;
    const cd = cols.cdCvm ? normalizarCdCvm(r[cols.cdCvm]) : null;
    if (cnpj) chaves.push('cnpj:' + cnpj);
    if (cd) chaves.push('cd:' + cd);
    return chaves;
  };

  for (const r of registros || []) {
    const chaves = chavesDaLinha(r);
    const data = cols.dataReferencia ? String(r[cols.dataReferencia] || '').trim() : '';
    const bruto = num(r, 'ordinarias');
    if (bruto === null) {
      anotar(chaves, { data: data || null, motivo: 'sem_quantidade_ordinaria' });
      continue;
    }
    const escala = cols.escalaQuantidade ? fatorEscala(r[cols.escalaQuantidade]) : 1;
    const on = bruto * escala;
    const pn = (num(r, 'preferenciais') || 0) * escala;
    const onTes = (num(r, 'ordinariasTesouraria') || 0) * escala;
    const pnTes = (num(r, 'preferenciaisTesouraria') || 0) * escala;
    const circulacao = on + pn - onTes - pnTes;
    anotar(chaves, { data: data || null, on, pn, onTes, pnTes, circulacao, escala });
    // Uma companhia aberta tem mais do que cem mil ações. Abaixo disso é
    // linha de outra natureza, não a composição do capital.
    if (!(circulacao >= 1e5)) continue;

    const registro = {
      acoesOrdinarias: on,
      acoesPreferenciais: pn,
      acoesTesouraria: onTes + pnTes,
      acoesEmCirculacao: circulacao,
      escalaAplicada: escala,
      dataReferencia: data || null,
    };
    for (const chave of chaves) {
      // Reenvio: vence a data de referência, não a ordem do arquivo.
      const anterior = porChave.get(chave);
      if (anterior && anterior.dataReferencia >= registro.dataReferencia) continue;
      porChave.set(chave, registro);
    }
  }
  return { porChave, linhasPorChave, faltando, colunas: cols, colunasReais: colunas };
}

/**
 * Em que unidade a companhia declarou a contagem de ações — decidido pelo
 * PATRIMÔNIO, porque o arquivo não diz.
 *
 * `dfp_cia_aberta_composicao_capital` não tem coluna de escala nenhuma (o log
 * da execução real lista as dez colunas: nenhuma delas é escala), e as
 * companhias não seguem a mesma convenção:
 *
 *   BBAS3  2.865.417.020  → unidades
 *   ELET3  2.307.099      → milhares (2,31 bi de ações de facto)
 *
 * Sem escala declarada, os dois números são igualmente plausíveis lidos
 * isoladamente — e foi assim que a Eletrobras saiu com 2,31 M de ações para
 * 118,5 bi de patrimônio. O desempate vem de uma grandeza que NÃO passou pela
 * contagem: o valor patrimonial por ação.
 *
 *   ELET3 a 1×     → R$ 51.364 por ação   (não existe na B3)
 *   ELET3 a 1000×  → R$ 51,4 por ação     (é o valor real)
 *   BBAS3 a 1×     → R$ 67,5 por ação     (plausível)
 *   BBAS3 a 1000×  → R$ 0,067 por ação    (não existe)
 *
 * A correção é de mão única, e isso é deliberado: só se tenta o ×1000 quando
 * a leitura em unidades dá um VPA IMPOSSÍVEL para cima. Para baixo não se
 * mexe, porque VPA de centavos existe de verdade — companhia em recuperação,
 * capital diluído — e "corrigir" esse caso inventaria mil vezes menos ações
 * numa empresa que já está mal. O teto é a única ponta da faixa em que a
 * absurdez é certa: não há papel na B3 com patrimônio de dez mil reais por
 * ação.
 *
 * Como só se entra pela ponta de cima, as duas leituras nunca cabem ao mesmo
 * tempo — o ×1000 de um número acima do teto cai, no máximo, logo abaixo
 * dele. Não há empate a desfazer.
 */
const VPA_MIN = 0.01;
const VPA_MAX = 10000;

function conciliarContagemComPatrimonio(circulacao, patrimonioLiquido) {
  if (!(circulacao > 0)) return { acoes: null, fator: null, vpa: null, motivo: 'sem_contagem' };
  // Sem patrimônio não há conferência possível. Recusar aqui seria descartar
  // contagem boa por falta do aferidor, não por defeito dela.
  if (!(patrimonioLiquido > 0)) {
    return { acoes: circulacao, fator: 1, vpa: null, motivo: 'sem_patrimonio' };
  }
  const cabe = (vpa) => vpa >= VPA_MIN && vpa <= VPA_MAX;
  const vpaUnidades = patrimonioLiquido / circulacao;
  if (cabe(vpaUnidades)) {
    return { acoes: circulacao, fator: 1, vpa: vpaUnidades, motivo: 'unidades' };
  }
  if (vpaUnidades > VPA_MAX && cabe(vpaUnidades / 1000)) {
    return {
      acoes: circulacao * 1000,
      fator: 1000,
      vpa: vpaUnidades / 1000,
      motivo: 'milhares',
    };
  }
  return { acoes: null, fator: null, vpa: vpaUnidades, motivo: 'fora_de_faixa' };
}

module.exports.COLUNAS_CAPITAL = COLUNAS_CAPITAL;
module.exports.extrairComposicaoCapital = extrairComposicaoCapital;
module.exports.conciliarContagemComPatrimonio = conciliarContagemComPatrimonio;
module.exports.VPA_MIN = VPA_MIN;
module.exports.VPA_MAX = VPA_MAX;

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

// O FCA identifica a companhia pelo CNPJ, NÃO por CD_CVM — foi o que fez a
// primeira execução real devolver "colunas do FCA não encontradas: cdCvm" e
// zero tickers. O CNPJ é a única chave presente nos dois arquivos (FCA e
// DFP), e por isso é ele que junta os dois.
const COLUNAS_FCA = {
  cnpj: ['CNPJ_Companhia', 'CNPJ_CIA', 'CNPJ'],
  cdCvm: ['CD_CVM', 'CODIGO_CVM', 'Codigo_CVM'],
  codigoNegociacao: ['Codigo_Negociacao', 'CODIGO_NEGOCIACAO', 'CD_NEGOCIACAO'],
  valorMobiliario: ['Valor_Mobiliario', 'VALOR_MOBILIARIO', 'DS_VALOR_MOBILIARIO'],
  dataReferencia: ['Data_Referencia', 'DT_REFER'],
};

// Sem estas não há universo. As outras refinam o filtro; a ausência delas
// muda a qualidade do resultado, não a existência dele — e reportar as duas
// coisas com a mesma cara foi o que mandou a investigação para o lado errado
// durante quatro rodadas: "colunas do FCA não encontradas: cdCvm" parecia a
// causa da falha e era uma nota de rodapé.
const COLUNAS_FCA_ESSENCIAIS = ['codigoNegociacao'];

/** CNPJ comparável: só dígitos. Os arquivos alternam entre formatado e cru. */
function normalizarCnpj(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 14 ? d : null;
}

/** CD_CVM comparável: o cadastro traz com zeros à esquerda, a DFP sem. */
function normalizarCdCvm(v) {
  const d = String(v || '')
    .trim()
    .replace(/^0+/, '');
  return d || null;
}

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
  // Basta o código de negociação e UMA das duas identificações da companhia.
  // Exigir CD_CVM zerava o universo inteiro num arquivo que nunca o teve.
  const faltandoEssencial = COLUNAS_FCA_ESSENCIAIS.filter((c) => !cols[c]);
  if (!cols.cnpj && !cols.cdCvm) faltandoEssencial.push('cnpj ou cdCvm');
  if (faltandoEssencial.length) {
    return {
      porTicker: new Map(),
      faltando,
      faltandoEssencial,
      colunas: cols,
      colunasReais: colunas,
    };
  }

  const porTicker = new Map();
  for (const r of registros) {
    const cdCvm = cols.cdCvm ? normalizarCdCvm(r[cols.cdCvm]) : null;
    const cnpj = cols.cnpj ? normalizarCnpj(r[cols.cnpj]) : null;
    const bruto = String(r[cols.codigoNegociacao] || '')
      .trim()
      .toUpperCase();
    if ((!cdCvm && !cnpj) || !bruto) continue;

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
      porTicker.set(ticker, { ticker, cdCvm, cnpj, dataReferencia: data || null });
    }
  }
  return { porTicker, faltando, faltandoEssencial, colunas: cols, colunasReais: colunas };
}

module.exports.COLUNAS_FCA = COLUNAS_FCA;
module.exports.COLUNAS_FCA_ESSENCIAIS = COLUNAS_FCA_ESSENCIAIS;
module.exports.normalizarCnpj = normalizarCnpj;
module.exports.normalizarCdCvm = normalizarCdCvm;
module.exports.ESPECIES_ACAO = ESPECIES_ACAO;
module.exports.extrairTickersFca = extrairTickersFca;
