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
module.exports.planoDaEmpresa = planoDaEmpresa;
module.exports.dividendosPagosDetalhado = dividendosPagosDetalhado;
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
