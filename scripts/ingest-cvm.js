'use strict';

// Ingestão dos dados abertos da CVM -> Firestore (marketFundamentals).
//
// POR QUE ISTO EXISTE
// Com o plano grátis da fonte de mercado, 13 dos 16 indicadores de ação
// chegam nulos e nenhum ativo é pontuado. Pagar resolve, mas amarra o
// produto ao plano comercial de um terceiro. A CVM publica de graça, sem
// chave e sem cota, o documento que a companhia é LEGALMENTE OBRIGADA a
// entregar — e é auditável pelo cliente, que é o que sustenta a confiança
// num produto pago.
//
// POR QUE É UM JOB E NÃO UM ENDPOINT
// As functions do Vercel neste projeto têm maxDuration 15s e 256 MB
// (vercel.json), e os arquivos da CVM são ZIPs de dezenas de MB. Além
// disso, os 2 crons do plano Hobby já estão ocupados. Então isto roda no
// GitHub Actions e escreve na MESMA coleção que api/market.js?op=fundamentals
// já lê — o cliente não muda em nada, só passa a receber dado melhor.
//
// GARANTIA CENTRAL: nunca escrever número que não se sustenta. Coluna que
// não aparece, conta que não existe e resultado fora da faixa plausível
// viram null com motivo registado. Uma empresa cujos indicadores não
// validam é PULADA e reportada, nunca gravada pela metade.
//
// USO
//   node scripts/ingest-cvm.js --dry-run            # não escreve; imprime o que achou
//   node scripts/ingest-cvm.js --dry-run --anos=1   # mais rápido, para conferir layout
//   FIREBASE_SERVICE_ACCOUNT_BASE64=... node scripts/ingest-cvm.js --gravar
//
// O --dry-run é o passo de validação: como os nomes de coluna e códigos de
// conta da CVM já mudaram de forma antes, a primeira execução deve ser
// conferida por um humano — ele imprime qual ticker casou com qual empresa
// e quais colunas não foram encontradas.

const path = require('node:path');
const { lerZip } = require('./lib/zip');
const P = require('./lib/cvm-parser');
const MAPA = require('./lib/mapa-cvm.json');

const BASE_CIA = 'https://dados.cvm.gov.br/dados/CIA_ABERTA';
const BASE_FII = 'https://dados.cvm.gov.br/dados/FII';
const COLECAO = 'marketFundamentals';
const TIMEOUT_MS = 120000;

function log(...a) {
  console.log(...a);
}

function argValor(args, nome, padrao) {
  const achado = args.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split('=')[1] : padrao;
}

async function baixar(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: '*/*' } });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/** Baixa um CSV solto da CVM (latin-1). */
async function baixarCsv(url) {
  const buf = await baixar(url);
  return P.parseCsvCvm(buf.toString('latin1'));
}

/**
 * Lista os arquivos de um diretório do portal de dados abertos da CVM.
 *
 * O portal serve um índice HTML por diretório. Ler o índice em vez de
 * adivinhar nomes é o que resolve, de uma vez, um problema que já custou
 * duas rodadas: a CVM renomeia e move arquivos, e uma lista de candidatos
 * escrita à mão envelhece em silêncio. Os três nomes conhecidos do cadastro
 * de FII devolveram 404 na execução real — todos.
 */
async function listarDiretorio(url, opcoes) {
  const incluirPastas = !!(opcoes && opcoes.incluirPastas);
  const buf = await baixar(url);
  const html = buf.toString('latin1');
  const nomes = new Set();
  const re = /href\s*=\s*["']([^"'?#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const bruto = m[1];
    const alvo = bruto.split('/').filter(Boolean).pop();
    if (!alvo) continue;
    if (/\.(csv|zip|txt)$/i.test(alvo)) {
      nomes.add(alvo);
      continue;
    }
    // Pasta: só interessa ao diagnóstico ("o que existe aqui, afinal?").
    // Entradas de navegação do índice não são pasta.
    if (incluirPastas && bruto.endsWith('/') && !/^[.?]/.test(bruto)) nomes.add(alvo + '/');
  }
  return Array.from(nomes);
}

/**
 * Sobe a árvore dizendo o que existe em cada nível.
 *
 * Chamado quando o diretório esperado some por completo — foi o caso do FII,
 * cujo `CAD/DADOS/` e `CAD/` deram 404 os dois. Sem isto, a próxima
 * investigação recomeça adivinhando; com isto, o log já traz a resposta.
 */
/**
 * Procura, no cadastro de fundos da CVM, um arquivo que traga o CÓDIGO DE
 * NEGOCIAÇÃO — o vínculo ticker ↔ fundo.
 *
 * POR QUE ISTO EXISTE. Para AÇÕES, o FCA declara o código de negociação e
 * por isso o universo vem do dado. Para FII, o job depende de uma lista de
 * dez nomes escrita à mão, que casa por denominação contra o `cad_fi.csv` —
 * e a execução real provou que ali não estão os fundos listados:
 *
 *     "MAXI"  aparece em: (nenhum dos 584)
 *     "CSHG"  aparece em: CSHG OCEANUS | CSHG RESIDENCIAL   (não o Logística)
 *
 * Ajustar o termo não resolveria: a informação não está naquele arquivo.
 * Esta varredura responde se ELA EXISTE em algum outro — e é a diferença
 * entre destravar a bolsa inteira de FIIs e continuar preso a dez nomes.
 */
async function procurarVinculoTickerFundo() {
  const dirs = [
    'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/',
    `${BASE_FII}/DOC/INF_MENSAL/DADOS/`,
  ];
  const RE_TICKER = /negocia|ticker|codigo_neg|cod_neg|sigla/i;
  for (const dir of dirs) {
    let nomes;
    try {
      nomes = await listarDiretorio(dir);
    } catch (e) {
      log(`    ${dir} — ${e.message}`);
      continue;
    }
    log(`    ${dir} contém: ${nomes.join(' ')}`);
    for (const nome of nomes.filter((n) => /\.csv$/i.test(n)).slice(0, 8)) {
      try {
        const csv = await baixarCsv(dir + nome);
        const candidatas = csv.colunas.filter((c) => RE_TICKER.test(c));
        if (candidatas.length) {
          log(`    ✓ ${nome} TEM coluna de negociação: ${candidatas.join(', ')}`);
        }
      } catch (e) {
        log(`    ${nome} — ${e.message}`);
      }
    }
  }
}

async function diagnosticarArvore(url) {
  const partes = url.replace(/\/+$/, '').split('/');
  for (let i = 0; i < 3 && partes.length > 4; i++) {
    partes.pop();
    const acima = partes.join('/') + '/';
    try {
      const itens = await listarDiretorio(acima, { incluirPastas: true });
      log(`      ${acima} contém: ${itens.slice(0, 15).join(' ') || '(vazio)'}`);
      return;
    } catch (e) {
      log(`      ${acima} — ${e.message}`);
    }
  }
}

/**
 * Acha, num diretório da CVM, o arquivo que casa com um padrão — o mais
 * recente quando há vários (o nome traz o ano).
 */
async function acharNoDiretorio(dirUrl, padrao) {
  const nomes = await listarDiretorio(dirUrl);
  const casam = nomes.filter((n) => padrao.test(n)).sort();
  if (!casam.length) {
    throw new Error(`nenhum arquivo casa ${padrao} em ${dirUrl} (${nomes.length} arquivos)`);
  }
  return { url: dirUrl + casam[casam.length - 1], nome: casam[casam.length - 1], nomes };
}

/**
 * Baixa um ZIP e devolve os CSVs que interessam, por sufixo do nome.
 * Ex.: prefixos ['BPA_con', 'BPP_con'] -> { BPA_con: {...}, BPP_con: {...} }
 *
 * TODOS os membros que casam, concatenados — não o primeiro. No ZIP anual do
 * informe de FII há um arquivo por MÊS (`inf_mensal_fii_geral_202601.csv`,
 * `..._202602.csv`, …); pegar o primeiro entregava janeiro em agosto, sem
 * erro nenhum, com números plausíveis. É o mesmo defeito da chave de junção
 * e da escala do LPA: a busca não falha, ela acha a coisa errada.
 *
 * Concatenar é seguro porque quem consome já desempata por data de
 * referência — e devolve o mês mais recente de cada fundo, inclusive dos
 * que não entregaram informe no último mês.
 */
async function baixarZipCsvs(url, prefixos) {
  const buf = await baixar(url);
  const entradas = lerZip(buf);
  const out = {};
  const nomes = entradas.map((e) => e.nome);
  for (const prefixo of prefixos) {
    const alvos = entradas
      .filter((e) => P.normalizarChave(e.nome).includes(P.normalizarChave(prefixo)))
      .sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
    if (!alvos.length) continue;
    const colunas = [];
    const registros = [];
    for (const alvo of alvos) {
      const csv = P.parseCsvCvm(alvo.dados.toString('latin1'));
      for (const c of csv.colunas || []) if (!colunas.includes(c)) colunas.push(c);
      for (const r of csv.registros || []) registros.push(r);
    }
    // Os registros são objetos com as colunas por nome: concatenar meses com
    // ordem de coluna diferente continua correto.
    out[prefixo] = { colunas, registros, membros: alvos.map((a) => a.nome) };
  }
  return { csvs: out, nomesNoZip: nomes };
}

/**
 * Casa cada ticker do mapa com uma linha do cadastro da CVM.
 *
 * Por nome e não por código: código decorado num arquivo envelhece e
 * ninguém confere. Ambiguidade (mais de uma empresa contendo o termo) é
 * REPORTADA e o ticker é pulado — casar com a empresa errada é o pior
 * resultado possível, pior do que não casar.
 */
function casarCadastro(cadastro, mapaTickers, colunaNome, colunaChave, colunaCnpj) {
  const resultados = [];
  const registros = cadastro.registros || [];
  for (const [ticker, info] of Object.entries(mapaTickers)) {
    const alvo = P.normalizarChave(info.denominacao);
    const candidatos = registros.filter((r) =>
      P.normalizarChave(r[colunaNome] || '').includes(alvo)
    );
    if (!candidatos.length) {
      resultados.push({ ticker, status: 'sem_correspondencia', denominacao: info.denominacao });
      continue;
    }
    // Preferência por correspondência exata; senão, o nome mais curto (o
    // mais curto que contém o termo costuma ser a holding, não a subsidiária
    // com sufixo).
    const exato = candidatos.find((r) => P.normalizarChave(r[colunaNome]) === alvo);
    const escolhido =
      exato ||
      candidatos
        .slice()
        .sort((a, b) => String(a[colunaNome]).length - String(b[colunaNome]).length)[0];
    resultados.push({
      ticker,
      status: candidatos.length > 1 && !exato ? 'ambiguo' : 'ok',
      denominacao: info.denominacao,
      casouCom: escolhido[colunaNome],
      chave: String(escolhido[colunaChave] || '').trim(),
      cnpj: colunaCnpj ? P.normalizarCnpj(escolhido[colunaCnpj]) : null,
      alternativas: candidatos.length > 1 ? candidatos.slice(0, 5).map((r) => r[colunaNome]) : null,
    });
  }
  return resultados;
}

/**
 * Um exercício de uma empresa, a partir dos índices já construídos.
 *
 * Recebe índices em vez de CSVs porque agrupar por empresa dentro do laço
 * seria O(n²): com o universo vindo do FCA são centenas de companhias contra
 * arquivos de centenas de milhares de linhas. O agrupamento acontece uma vez
 * por arquivo, em quem chama.
 */
function exercicioDaEmpresaIndexado(indices, cols, chaveEmpresa, ano) {
  // Aceita mais de uma chave porque nem todo arquivo traz as duas
  // identificações: o FCA junta por CNPJ, o cadastro antigo por CD_CVM, e a
  // DFP pode ter só uma delas. Tentar as duas é o que impede o
  // "0 companhias com dados" quando o universo e o arquivo usam chaves
  // diferentes para a MESMA companhia.
  const candidatas = Array.isArray(chaveEmpresa) ? chaveEmpresa : [chaveEmpresa];
  const pegar = (chave) => {
    const idx = indices[chave];
    if (!idx) return [];
    let daEmpresa = null;
    for (const c of candidatas) {
      if (!c) continue;
      daEmpresa = idx.get(c);
      if (daEmpresa) break;
    }
    if (!daEmpresa) return [];
    // Exercício mais recente dentro do arquivo do ano.
    const chaves = Array.from(daEmpresa.keys()).sort();
    return daEmpresa.get(chaves[chaves.length - 1]) || [];
  };
  const blocos = {
    bpa: pegar('BPA_con'),
    bpp: pegar('BPP_con'),
    dre: pegar('DRE_con'),
    dfc: pegar('DFC_MI_con'),
  };
  if (!blocos.bpp.length && !blocos.dre.length) return null;
  const fin = P.extrairFinanceiro(blocos, cols);
  return { ano, dataReferencia: `${ano}-12-31`, ...fin };
}

/** Mesma coisa a partir dos CSVs crus. Conveniência para uso pontual. */
function exercicioDaEmpresa(csvs, cols, chaveEmpresa, ano) {
  const indices = {};
  for (const chave of Object.keys(csvs)) {
    indices[chave] = P.agruparPorEmpresa(csvs[chave].registros, cols);
  }
  return exercicioDaEmpresaIndexado(indices, cols, chaveEmpresa, ano);
}

/**
 * A chave com que uma companhia é procurada dentro dos arquivos da CVM.
 *
 * CNPJ primeiro porque é a única identificação presente em TODOS os
 * arquivos (FCA, DFP e cadastro); CD_CVM entra como alternativa para o
 * caminho antigo, que só tinha ele.
 */
function chavesDaEmpresa(t) {
  const chaves = [];
  const cnpj = P.normalizarCnpj(t.cnpj);
  const cd = P.normalizarCdCvm(t.cdCvm);
  if (cnpj) chaves.push('cnpj:' + cnpj);
  if (cd) chaves.push('cd:' + cd);
  return chaves;
}

/**
 * Cotação, valor de mercado e volume do universo.
 *
 * Sem isto, o ranking do servidor pontua com o pilar de VALUATION vazio para
 * todo mundo — P/L e P/VP nascem do lucro e do patrimônio da CVM cruzados
 * com o valor de mercado. O efeito é pior do que parece: a lente "Valor"
 * escolheria a lista curta sem nenhuma informação de preço, que é
 * exatamente o pilar que ela mais pesa.
 *
 * Cabe aqui e não numa function porque são ~16 chamadas em série para a
 * bolsa inteira, contra o limite de 15s do Vercel. Uma vez por semana; o
 * op=fundamentals rebusca por cima para os poucos que a tela mostra.
 */
async function baixarCotacoes(tickers) {
  const token = process.env.BRAPI_TOKEN;
  // Sem token, a BRAPI devolve 401 até na chamada simples. O Yahoo v8/chart
  // não pede autenticação e o runner não sofre o limite de IP que a Vercel
  // sofre — aqui dá para percorrer o universo inteiro.
  if (!token) {
    log('  (sem BRAPI_TOKEN — usando o Yahoo, um pedido por ativo)');
    const { fetchYahooCotacoes } = require(path.join(__dirname, '..', 'api', 'market.js')).fontes;
    const erros = [];
    const cot = await fetchYahooCotacoes(tickers, erros, 10 * 60 * 1000);
    if (erros.length) {
      const amostra = Array.from(new Set(erros.map((e) => e.erro))).slice(0, 3);
      log(`  ${erros.length} falha(s) de cotação: ${amostra.join(' · ')}`);
    }
    const out = {};
    for (const t of Object.keys(cot)) {
      const q = cot[t];
      out[t] = {
        ticker: t,
        nome: q.shortName || null,
        preco: q.price,
        marketCap: q.marketCap,
        liquidezDiaria: q.price !== null && q.volume !== null ? q.volume * q.price : null,
        fonte: 'yahoo',
        fonteRotulo: 'Cotação · Yahoo Finance',
      };
    }
    return out;
  }

  const out = {};
  for (let i = 0; i < tickers.length; i += 20) {
    const lote = tickers.slice(i, i + 20);
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(lote.join(','))}`;
    const headers = { Accept: 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      let json;
      try {
        const res = await fetch(url, { headers, signal: ctrl.signal });
        if (!res.ok) throw new Error(`http_${res.status}`);
        json = await res.json();
      } finally {
        clearTimeout(timer);
      }
      for (const r of (json && json.results) || []) {
        if (!r || !r.symbol) continue;
        const preco = typeof r.regularMarketPrice === 'number' ? r.regularMarketPrice : null;
        const volume = typeof r.regularMarketVolume === 'number' ? r.regularMarketVolume : null;
        out[String(r.symbol).toUpperCase()] = {
          ticker: String(r.symbol).toUpperCase(),
          nome: r.longName || r.shortName || null,
          preco,
          marketCap: typeof r.marketCap === 'number' ? r.marketCap : null,
          liquidezDiaria: preco !== null && volume !== null ? volume * preco : null,
          fonte: 'brapi',
          fonteRotulo: 'Cotação · BRAPI',
        };
      }
    } catch (e) {
      log(`  ! cotação do lote ${i / 20 + 1} falhou (${e.message})`);
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const gravar = args.includes('--gravar') || args.includes('--send');
  const anosAtras = Math.max(1, Math.min(6, parseInt(argValor(args, 'anos', '5'), 10) || 5));
  const soTickers = argValor(args, 'only', '')
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  // Teto do universo. Serve para provar o pipeline ponta a ponta sem esperar
  // a bolsa inteira na primeira execução.
  const limite = Math.max(0, parseInt(argValor(args, 'limite', '0'), 10) || 0);

  log(`\n=== Ingestão CVM — ${gravar ? 'GRAVANDO' : 'DRY-RUN (não escreve)'} ===`);
  log(
    `Anos: ${anosAtras} · Tickers: ${soTickers.length ? soTickers.join(',') : 'universo automático (FCA)'}` +
      `${limite ? ` · limite ${limite}` : ''}\n`
  );

  const anoBase = new Date().getUTCFullYear() - 1; // DFP do ano corrente só sai depois do fechamento
  const anos = [];
  for (let i = 0; i < anosAtras; i++) anos.push(anoBase - i);

  // ── 1. Universo de ações: descoberto no FCA, não escrito à mão ──
  //
  // O FCA declara o código de negociação de cada valor mobiliário. É o
  // vínculo oficial ticker ↔ CD_CVM, e é o que permite considerar a bolsa
  // inteira. O mapa em lib/mapa-cvm.json fica só como rede: entra para o
  // que o FCA não cobrir naquele ano.
  log('· Universo de ações (FCA da CVM)…');
  const porTicker = new Map();
  for (const ano of [anoBase, anoBase - 1]) {
    try {
      const pacote = await baixarZipCsvs(`${BASE_CIA}/DOC/FCA/DADOS/fca_cia_aberta_${ano}.zip`, [
        'valor_mobiliario',
      ]);
      const csv = pacote.csvs.valor_mobiliario;
      if (!csv) {
        log(
          `  ! FCA ${ano} sem CSV de valor mobiliário. No ZIP: ${pacote.nomesNoZip.slice(0, 6).join(', ')}`
        );
        continue;
      }
      const r = P.extrairTickersFca(csv.registros, csv.colunas);
      // Essencial e opcional NÃO podem sair com a mesma cara. A ausência de
      // CD_CVM no FCA é normal (o arquivo nunca o teve) e passou quatro
      // rodadas parecendo a causa da falha.
      if (r.faltandoEssencial && r.faltandoEssencial.length) {
        log(`  ✗ FCA sem coluna essencial: ${r.faltandoEssencial.join(', ')}`);
        log(`    colunas reais do arquivo: ${(r.colunasReais || csv.colunas).join(', ')}`);
      } else if (r.faltando.length) {
        log(`  (colunas opcionais ausentes, sem impacto no universo: ${r.faltando.join(', ')})`);
      }
      if (!r.porTicker.size && !(r.faltandoEssencial && r.faltandoEssencial.length))
        log(`    colunas reais do arquivo: ${(r.colunasReais || csv.colunas).join(', ')}`);
      for (const [ticker, info] of r.porTicker)
        if (!porTicker.has(ticker)) porTicker.set(ticker, info);
      log(`  FCA ${ano}: ${r.porTicker.size} tickers`);
      if (porTicker.size) break; // o exercício mais recente que funcionar basta
    } catch (e) {
      log(`  ! FCA ${ano} indisponível (${e.message})`);
    }
  }

  // Rede de segurança: sem FCA, cai para o mapa manual casado por nome.
  let cadastro = null;
  let colNome = null;
  let colCd = null;
  if (!porTicker.size) {
    log('  ! FCA indisponível — caindo para o mapa manual (universo reduzido)');
    // O download do cadastro fica dentro do try porque a rede de segurança
    // não pode derrubar o que ela existe para salvar: sem isto, a CVM fora
    // do ar levava o job inteiro por exceção e o ÚLTIMO recurso logo abaixo
    // — o mapa sozinho, que ainda serve ao Yahoo — nunca era alcançado.
    try {
      cadastro = await baixarCsv(`${BASE_CIA}/CAD/DADOS/cad_cia_aberta.csv`);
      colNome = P.acharColuna(cadastro.colunas, P.COLUNAS.denominacao);
      colCd = P.acharColuna(cadastro.colunas, P.COLUNAS.cdCvm);
      const colCnpjCad = P.acharColuna(cadastro.colunas, P.COLUNAS.cnpj);
      if (!colNome || (!colCd && !colCnpjCad)) {
        log(`  ✗ cadastro sem colunas esperadas: ${cadastro.colunas.join(', ')}`);
      } else {
        for (const c of casarCadastro(cadastro, MAPA.acoes, colNome, colCd, colCnpjCad)) {
          if (c.status === 'ok' && (c.chave || c.cnpj))
            porTicker.set(c.ticker, {
              ticker: c.ticker,
              cdCvm: c.chave || null,
              cnpj: c.cnpj || null,
            });
        }
      }
    } catch (e) {
      log(`  ! cadastro da CVM indisponível (${e.message})`);
    }
  }

  // Último recurso: o mapa sozinho, sem CD_CVM. Não dá para ler demonstração
  // da CVM assim, mas dá para buscar fundamentos no Yahoo — que só precisa do
  // ticker. É o que mantém o produto de pé quando CVM e BRAPI estão ambas
  // indisponíveis.
  if (!porTicker.size) {
    log('  ! sem cadastro da CVM — universo reduzido ao mapa, só para o Yahoo');
    for (const t of Object.keys(MAPA.acoes))
      porTicker.set(t, { ticker: t, cdCvm: null, cnpj: null });
    for (const t of Object.keys(MAPA.fiis))
      porTicker.set(t, { ticker: t, cdCvm: null, cnpj: null });
  }

  // Filtros do operador.
  const semFonte = new Set(MAPA.semFonteCvm.tickers);
  let universo = Array.from(porTicker.values()).filter((t) => !semFonte.has(t.ticker));
  if (soTickers.length) universo = universo.filter((t) => soTickers.includes(t.ticker));
  if (limite > 0) universo = universo.slice(0, limite);

  // Uma companhia tem vários tickers (ON, PN, unit) e UMA demonstração. Os
  // indicadores são calculados por empresa e replicados para cada ticker.
  const empresas = new Map();
  for (const t of universo) {
    const chaves = chavesDaEmpresa(t);
    if (!chaves.length) continue; // sem identificação não há demonstração a ler
    const chave = chaves[0];
    if (!empresas.has(chave))
      empresas.set(chave, {
        chave,
        chaves,
        cdCvm: t.cdCvm || null,
        cnpj: t.cnpj || null,
        tickers: [],
      });
    empresas.get(chave).tickers.push(t.ticker);
  }
  log(`\n  ${universo.length} tickers em ${empresas.size} companhias.`);
  if (universo.length <= 40) {
    log(`  ${universo.map((t) => t.ticker).join(' ')}`);
  } else {
    log(
      `  amostra: ${universo
        .slice(0, 20)
        .map((t) => t.ticker)
        .join(' ')} …`
    );
  }

  // ── 2. DFP por ano ──
  const porEmpresa = new Map();
  let colsResolvidas = null;
  // Preenchido pelo exercício mais recente que trouxer o arquivo.
  let capitalPorChave = new Map();
  // As linhas cruas de cada companhia, para explicar uma contagem recusada.
  let capitalLinhasPorChave = new Map();
  for (const ano of anos) {
    log(`\n· DFP ${ano}…`);
    let pacote;
    try {
      pacote = await baixarZipCsvs(`${BASE_CIA}/DOC/DFP/DADOS/dfp_cia_aberta_${ano}.zip`, [
        'BPA_con',
        'BPP_con',
        'DRE_con',
        'DFC_MI_con',
        // A quantidade de ações vem DECLARADA aqui. Substitui a derivação
        // `lucro ÷ LPA`, que não separa ON de PN quando as duas classes têm
        // lucro por ação diferente — e era isso que deixava a valuation em
        // 5 de 14 companhias.
        'composicao_capital',
      ]);
    } catch (e) {
      log(`  ✗ ${e.message} — ano ignorado`);
      continue;
    }
    const achados = Object.keys(pacote.csvs);
    log(
      `  arquivos usados: ${achados.join(', ') || 'nenhum'} (de ${pacote.nomesNoZip.length} no ZIP)`
    );
    // O ZIP tem 19 arquivos e lemos 4. Saber o que há nos outros 15 é o que
    // decide se a contagem de ações pode vir declarada em vez de derivada —
    // e a derivação por `lucro ÷ LPA` não funciona quando ON e PN têm LPA
    // diferente, que é o caso comum na B3.
    log(`    todos no ZIP: ${pacote.nomesNoZip.join(' ')}`);
    if (!achados.length) {
      log(`  ✗ nenhum CSV reconhecido. Nomes no ZIP: ${pacote.nomesNoZip.slice(0, 8).join(', ')}`);
      continue;
    }

    const qualquer = pacote.csvs[achados[0]];
    const { mapa: cols, faltando } = P.resolverColunas(qualquer.colunas, [
      'cdCvm',
      'cnpj',
      'dataReferencia',
      'dataFimExercicio',
      'ordemExercicio',
      'codigoConta',
      'descricaoConta',
      'valorConta',
      'escalaMoeda',
    ]);
    if (faltando.length) {
      log(`  ! colunas não encontradas: ${faltando.join(', ')}`);
      log(`    colunas reais do arquivo: ${qualquer.colunas.join(', ')}`);
    }
    // Uma das duas identificações basta: exigir CD_CVM descartava o arquivo
    // inteiro num ano em que a CVM só publicou CNPJ.
    if ((!cols.cdCvm && !cols.cnpj) || !cols.codigoConta || !cols.valorConta) {
      log('  ✗ colunas essenciais ausentes — ano ignorado (nada será gravado a partir dele)');
      continue;
    }
    colsResolvidas = cols;

    // Contagem de ações declarada, do mesmo ZIP. Sem ela o pipeline segue
    // como antes (derivando por LPA); com ela, a valuation deixa de depender
    // de a companhia ter uma classe só.
    if (pacote.csvs.composicao_capital) {
      const cap = P.extrairComposicaoCapital(
        pacote.csvs.composicao_capital.registros,
        pacote.csvs.composicao_capital.colunas
      );
      if (!cap.porChave.size) {
        log(`  ! composição do capital não lida (faltando: ${cap.faltando.join(', ')})`);
        log(`    colunas reais: ${pacote.csvs.composicao_capital.colunas.join(', ')}`);
      } else {
        // Conta COMPANHIAS, não chaves: cada uma é indexada por CNPJ e por
        // CD_CVM, e o mapa tem o dobro de entradas. Um log que diz 4 onde há
        // 2 é a mesma família de erro que este PR passou o dia corrigindo.
        log(`  composição do capital: ${new Set(cap.porChave.values()).size} companhias`);
        // Sem a coluna de escala, TODA companhia que declara em milhares sai
        // mil vezes menor — silenciosamente, com um número plausível. É o
        // defeito que a Eletrobras expôs, e ele volta se a CVM renomear a
        // coluna. Nomear as colunas reais é o que permite corrigir numa
        // linha em vez de reabrir a investigação.
        // TODA coluna que não resolveu, não só a escala. A de tesouraria
        // faltava calada — o mapa procurava `TESOURARIA` e o arquivo traz
        // `TESOURO` — e o resultado era `tes 0` em toda companhia, que é
        // exatamente o que uma empresa sem tesouraria também imprime. Coluna
        // ausente e valor zero têm de ser distinguíveis no log.
        const faltando = cap.faltando || [];
        if (faltando.length) {
          log(`  ! composição do capital sem as colunas: ${faltando.join(', ')}`);
          log(`    colunas reais: ${pacote.csvs.composicao_capital.colunas.join(', ')}`);
        }
        capitalPorChave = cap.porChave;
        capitalLinhasPorChave = cap.linhasPorChave || new Map();
      }
    }

    // Agrupa UMA vez por arquivo, não uma vez por empresa: com centenas de
    // companhias, reagrupar por empresa transformaria isto em O(n²) sobre
    // arquivos de centenas de milhares de linhas.
    const indices = {};
    for (const chave of achados)
      indices[chave] = P.agruparPorEmpresa(pacote.csvs[chave].registros, cols);

    let comDados = 0;
    for (const emp of empresas.values()) {
      const ex = exercicioDaEmpresaIndexado(indices, cols, emp.chaves, ano);
      if (!ex) continue;
      if (!porEmpresa.has(emp.chave)) porEmpresa.set(emp.chave, []);
      porEmpresa.get(emp.chave).push(ex);
      comDados++;
    }
    log(`  ${comDados} companhias com dados neste exercício`);
    // Diagnóstico: casar zero companhias com o arquivo aberto e as colunas
    // resolvidas é o sintoma de chave errada, não de arquivo vazio.
    if (!comDados && empresas.size) {
      const amostra = Array.from(indices[achados[0]].keys()).slice(0, 4);
      log(
        `    nenhuma casou. procurando por: ${empresas.values().next().value.chaves.join(' ou ')}`
      );
      log(`    chaves no arquivo (amostra): ${amostra.join(', ')}`);
    }
  }

  if (!colsResolvidas) {
    log('\n! Nenhum exercício da CVM utilizável — seguindo só com o Yahoo.');
  }

  // ── 3. Indicadores ──
  log('\n· Indicadores calculados:\n');
  const documentos = [];
  let semNada = 0;
  for (const emp of empresas.values()) {
    const exercicios = porEmpresa.get(emp.chave);
    if (!exercicios || !exercicios.length) continue;
    let capitalDaEmpresa = emp.chaves.map((k) => capitalPorChave.get(k)).find(Boolean);
    const r = P.calcularIndicadores(exercicios);
    const ind = r.indicadores;

    // A contagem declarada é conferida contra o PATRIMÔNIO, que não passou
    // por ela — e o mesmo cálculo decide a UNIDADE, porque o arquivo da CVM
    // não declara escala nenhuma e as companhias não usam a mesma:
    //
    //   BBAS3  2.865.417.020 → unidades  → VPA R$ 67,5
    //   ELET3      2.307.099 → milhares  → VPA R$ 51,4  (a 1× dava R$ 51.364)
    //
    // Lidas isoladamente as duas são plausíveis; só o valor patrimonial por
    // ação separa. Quando nenhuma das leituras cabe na faixa, a contagem é
    // recusada e a derivação cai para o LPA — melhor um travessão do que a
    // Eletrobras com valor de mercado mil vezes menor liderando a lente
    // "Valor".
    if (capitalDaEmpresa) {
      const pl = r.absolutos.patrimonioLiquido;
      const conc = P.conciliarContagemComPatrimonio(capitalDaEmpresa.acoesEmCirculacao, pl);
      if (conc.acoes && conc.fator !== 1) {
        log(
          `  · ${emp.tickers[0]}: contagem declarada em milhares — ` +
            `${capitalDaEmpresa.acoesEmCirculacao.toLocaleString('pt-BR')} → ` +
            `${(conc.acoes / 1e9).toFixed(2)}bi ações, VPA R$ ${conc.vpa.toFixed(2)}` +
            ` (a 1× daria R$ ${(pl / capitalDaEmpresa.acoesEmCirculacao).toFixed(0)})`
        );
        capitalDaEmpresa = {
          ...capitalDaEmpresa,
          acoesEmCirculacao: conc.acoes,
          escalaAplicada: conc.fator,
        };
      } else if (!conc.acoes && conc.motivo !== 'sem_patrimonio') {
        log(
          `  ! ${emp.tickers[0]}: contagem declarada recusada (${conc.motivo}) — ` +
            `${(capitalDaEmpresa.acoesEmCirculacao / 1e6).toFixed(2)}M ações ` +
            `(escala ${capitalDaEmpresa.escalaAplicada}×) para ` +
            `PL de ${pl === null ? '—' : (pl / 1e9).toFixed(1) + 'bi'} dá R$ ${conc.vpa === null ? '—' : conc.vpa.toFixed(0)} por ação`
        );
        // A recusa protege o ranking, mas não explica o arquivo. Estas são
        // TODAS as linhas daquela companhia, inclusive as que o filtro
        // descartou: se a linha certa estiver entre as descartadas, o
        // problema é o filtro; se não estiver, é a estrutura do arquivo.
        // São hipóteses opostas, e só o dado cru as separa.
        const cruas = emp.chaves.map((k) => capitalLinhasPorChave.get(k)).find(Boolean) || [];
        for (const l of cruas) {
          log(
            `      ${l.data || '—'} · ` +
              (l.motivo
                ? l.motivo
                : `ON ${l.on} · PN ${l.pn} · tes ${l.onTes + l.pnTes} → ${l.circulacao}` +
                  ` (escala ${l.escala}×)` +
                  (l.circulacao >= 1e5 ? '' : ' (descartada: abaixo de 100 mil)'))
          );
        }
        capitalDaEmpresa = null;
      }
    }
    const preenchidos = Object.values(ind).filter((v) => v !== null).length;
    const total = Object.keys(ind).length;

    // Empresa sem nenhum indicador não vai para a base: gravar um documento
    // vazio faria a API servir "dado da CVM" que não tem dado nenhum.
    if (!preenchidos) {
      semNada++;
      continue;
    }
    if (documentos.length < 40 || soTickers.length) {
      log(
        `  ${emp.tickers.join('/').padEnd(14)} ${String(preenchidos).padStart(2)}/${total} · ` +
          // Plano financeiro no log porque explica, sozinho, por que aquela
          // companhia tem menos indicadores: banco não tem EBITDA nem dívida
          // líquida, e o travessão ali é a resposta certa, não uma falha.
          `${r.absolutos.plano === 'financeiro' ? '[banco] ' : ''}` +
          `${r.exerciciosUsados} exerc. · ROE ${ind.roe === null ? '—' : ind.roe.toFixed(1) + '%'} · ` +
          `dívLíq/EBITDA ${ind.dividaLiquidaEbitda === null ? '—' : ind.dividaLiquidaEbitda.toFixed(2) + 'x'} · ` +
          // LPA e dividendos aparecem aqui porque são o que destrava
          // VALUATION e DIVIDENDOS. Se a CVM mudar o plano de contas, é
          // nesta coluna que o travessão aparece — e é o que se confere
          // antes de acreditar num ranking.
          `PL ${r.absolutos.patrimonioLiquido === null ? '—' : (r.absolutos.patrimonioLiquido / 1e9).toFixed(1) + 'bi'} · ` +
          `LPA ${r.absolutos.lucroPorAcao === null ? '—' : r.absolutos.lucroPorAcao.toFixed(2)} · ` +
          // De onde veio a contagem de ações importa tanto quanto o número:
          // "cap" é declarada pela companhia, "lpa" é inferida por divisão.
          `ações ${
            capitalDaEmpresa
              ? (capitalDaEmpresa.acoesEmCirculacao / 1e9).toFixed(2) + 'bi cap'
              : r.absolutos.acoesEquivalentes
                ? (r.absolutos.acoesEquivalentes / 1e9).toFixed(2) + 'bi lpa'
                : '—'
          } · ` +
          `div ${r.absolutos.dividendosPagos === null ? '—' : (r.absolutos.dividendosPagos / 1e6).toFixed(0) + 'M'}` +
          (r.descartados.length ? ` · ${r.descartados.length} descartado(s)` : '')
      );
      // "Não paga" e "nomeia a linha de um jeito que o filtro não conhece"
      // são idênticos de fora. Quando não achamos distribuição, o log mostra
      // as linhas do 6.03 que ficaram de fora — é com isso que se decide se
      // o termo tem de entrar no filtro ou se a empresa não distribui mesmo.
      // Valuation vazia é o pilar mais frágil hoje (LPA em 5 de 14). Quando
      // o LPA não sai, o log mostra o que existe no grupo 3.99 daquela
      // companhia — é o que diz se falta a conta ou falta o nosso filtro.
      if (
        r.absolutos.lucroPorAcao === null &&
        r.absolutos.linhas399 &&
        r.absolutos.linhas399.length
      ) {
        log(`      3.99 presentes: ${r.absolutos.linhas399.slice(0, 4).join(' | ')}`);
      }
      const naoLidas = r.absolutos.dividendosNaoReconhecidas;
      if (!r.absolutos.dividendosPagos && naoLidas && naoLidas.length) {
        log(`      6.03 não reconhecidas: ${naoLidas.slice(0, 4).join(' | ')}`);
      }
    }
    // Rastro de diagnóstico é do LOG, não do banco: gravar as descrições
    // não reconhecidas encheria o documento de texto que ninguém lê e que
    // conta contra o teto de tamanho do Firestore.
    const { dividendosMotivo, dividendosNaoReconhecidas, linhas399, ...absolutos } = r.absolutos;

    // Declarada vence derivada. `lucro ÷ LPA` é uma inferência que falha em
    // companhia com duas classes; a composição do capital é o número que a
    // própria companhia informou.
    const capital = capitalDaEmpresa;
    if (capital) {
      absolutos.acoesEquivalentes = capital.acoesEmCirculacao;
      absolutos.acoesOrigem = 'composicao_capital';
      absolutos.acoesTesouraria = capital.acoesTesouraria;
      // O dividendo por ação segue a mesma contagem, senão o DY sairia
      // calculado sobre uma base e o P/L sobre outra.
      absolutos.dividendoPorAcao =
        absolutos.dividendosPagos !== null && absolutos.dividendosPagos !== undefined
          ? absolutos.dividendosPagos / capital.acoesEmCirculacao
          : null;
    } else if (absolutos.acoesEquivalentes) {
      absolutos.acoesOrigem = 'lucro_por_acao';
    }
    void dividendosMotivo;
    void dividendosNaoReconhecidas;
    void linhas399;
    for (const ticker of emp.tickers) {
      documentos.push({
        ticker,
        dados: {
          ...ind,
          ...absolutos,
          classe: 'acao',
          cdCvm: emp.cdCvm,
          cnpj: emp.cnpj,
          fonte: 'cvm',
          fonteRotulo: `DFP ${r.ano} · CVM`,
          dataReferencia: r.dataReferencia,
          exerciciosUsados: r.exerciciosUsados,
          indicadoresPreenchidos: preenchidos,
        },
      });
    }
  }
  if (documentos.length >= 40 && !soTickers.length)
    log(`  … e mais ${documentos.length - 40} tickers`);
  if (semNada) log(`  ${semNada} companhias sem indicador aproveitável — não serão gravadas`);
  // Cobertura das duas extrações novas, agregada. Zero aqui significa pilar
  // VALUATION ou DIVIDENDOS vazio para a bolsa inteira — é um número que
  // tem de saltar aos olhos no log, não algo a descobrir pela tela.
  if (documentos.length) {
    const comCap = documentos.filter(
      (d) => d.dados && d.dados.acoesOrigem === 'composicao_capital'
    ).length;
    const comLpa = documentos.filter((d) => d.dados && d.dados.acoesEquivalentes).length;
    const comDiv = documentos.filter((d) => d.dados && d.dados.dividendosPagos).length;
    log(
      `\n  valuation possível em ${comLpa}/${documentos.length} ` +
        `(${comCap} pela composição do capital, ${comLpa - comCap} pelo LPA) · ` +
        `dividendos em ${comDiv}/${documentos.length} (DFC 6.03)`
    );
  }

  // ── 4. Informe mensal de FII ──
  const mapaFiis = soTickers.length
    ? Object.fromEntries(Object.entries(MAPA.fiis).filter(([t]) => soTickers.includes(t)))
    : MAPA.fiis;
  if (Object.keys(mapaFiis).length) {
    log('\n· Informe mensal de FII…');
    try {
      // O informe é a FONTE, não apenas os números: é dele que sai o código
      // que liga ticker a fundo. O casamento por nome contra o `cad_fi.csv`
      // saiu daqui porque a execução real o desmentiu — "MAXI" não aparece
      // em nenhum dos 584 fundos imobiliários daquele cadastro. Nenhum
      // ajuste de string conserta uma fonte que não cobre os fundos
      // listados; manter o caminho seria manter um passo que já provou não
      // entregar nada, e uma leitura de 46 mil linhas por execução.
      const dirInf = `${BASE_FII}/DOC/INF_MENSAL/DADOS/`;
      // Vários ANOS, não só o corrente. O motor pontua "DY médio (36 meses)"
      // e "meses pagando (24m)" — duas perguntas sobre consistência que um
      // ano isolado não responde, e que ficavam vazias por falta de um dado
      // publicado ao lado do que já era lido.
      const pacotes = [];
      try {
        const achado = await acharNoDiretorio(dirInf, /^inf_mensal_fii_\d{4}\.zip$/i);
        const anosInforme = achado.nomes
          .filter((nome) => /^inf_mensal_fii_\d{4}\.zip$/i.test(nome))
          .sort()
          .slice(-anosAtras);
        log(`  informe: ${anosInforme.join(', ')}`);
        for (const nome of anosInforme) {
          try {
            pacotes.push(
              await baixarZipCsvs(dirInf + nome, ['geral', 'complemento', 'ativo_passivo'])
            );
          } catch (e) {
            // Um ano indisponível encurta a janela, não derruba o resto.
            log(`  ! ${nome} — ${e.message}`);
          }
        }
      } catch (e) {
        log(`  ! informe indisponível em ${dirInf} — ${e.message}`);
        // Diretório mudou de lugar é falha diferente de arquivo ausente, e
        // exige correção diferente. Subir a árvore diz qual das duas é.
        await diagnosticarArvore(dirInf);
      }
      if (!pacotes.length) throw new Error('sem_informe_mensal');

      // O ano corrente descreve o fundo hoje; os anteriores só alimentam a
      // série. Vem por último na lista ordenada.
      const pacote = pacotes[pacotes.length - 1];
      const membros = ['geral', 'complemento', 'ativo_passivo']
        .map((chave) => [chave, pacote.csvs[chave]])
        .filter((par) => par[1] && par[1].registros && par[1].registros.length);
      if (!membros.length) {
        log(`  ! nenhum CSV de informe reconhecido. No ZIP: ${pacote.nomesNoZip.join(', ')}`);
        throw new Error('informe_sem_csv');
      }
      for (const [nome, csv] of membros) {
        log(`    ${nome}: ${csv.registros.length} linhas · ${(csv.membros || []).length} mês(es)`);
        // As colunas REAIS de cada membro. Não é ruído: o crescimento do
        // dividendo sai de `Rendimentos_Distribuir`, que é saldo de balanço —
        // e no BTLG11 esse saldo fecha em zero em 29 dos 31 meses, num fundo
        // que paga todos eles. A derivação está correta e a fonte é que não
        // serve para essa classe de fundo. Só a lista do que o arquivo
        // realmente traz permite escolher outra coluna sem adivinhar.
        log(`      colunas: ${csv.colunas.join(', ')}`);
      }

      // ── o vínculo ticker ↔ fundo ──
      let vinculo = null;
      for (const [nome, csv] of membros) {
        const v = P.vincularFiiPorCodigo(csv.registros, csv.colunas);
        if (!v.total) continue;
        vinculo = v;
        log(`  vínculo por ${v.via} (coluna ${v.coluna} de "${nome}"): ${v.porCodigo.size} fundos`);
        break;
      }
      if (!vinculo) {
        // Sem o vínculo nada mais adianta, e a próxima investigação precisa
        // começar sabendo o que o arquivo tem — mesmo padrão do FCA e do
        // 6.03: mostrar os dois lados em vez de pedir mais uma rodada.
        log('  ! nenhum membro do informe traz código de negociação nem ISIN');
        for (const [nome, csv] of membros) {
          log(`    colunas de ${nome}: ${csv.colunas.join(', ')}`);
        }
        log('  · procurando o vínculo oficial ticker↔fundo…');
        await procurarVinculoTickerFundo();
        throw new Error('sem_vinculo_ticker_fundo');
      }

      const casFii = Object.entries(mapaFiis).map(([ticker, info]) => {
        const achado = P.fundoDoTicker(vinculo, ticker);
        if (!achado) {
          return { ticker, status: 'sem_correspondencia', denominacao: info.denominacao };
        }
        return {
          ticker,
          // Um código com dois CNPJs é sucessão de fundo, não sinônimo:
          // casar com o errado é pior do que não casar.
          status: achado.ambiguo ? 'ambiguo' : 'ok',
          chave: achado.cnpj,
          casouCom: achado.nome || achado.isin || achado.cnpj,
          via: achado.via,
          desempate: achado.desempate,
          candidatos: achado.candidatos,
          denominacao: info.denominacao,
        };
      });
      for (const c of casFii) {
        const marca = c.status === 'ok' ? '  ' : c.status === 'ambiguo' ? ' ?' : ' ✗';
        log(
          `  ${marca} ${c.ticker.padEnd(8)} ${c.casouCom || '— ' + c.status}` +
            (c.desempate ? ` (desempatado por ${c.desempate})` : '')
        );
        // Ambiguidade pula o ticker — e sem ver os candidatos ninguém sabe
        // se falta um critério de desempate ou se a raiz está sendo
        // partilhada por engano.
        if (c.status === 'ambiguo' && c.candidatos) {
          for (const cand of c.candidatos) {
            log(`       candidato ${cand.cnpj} · bolsa ${cand.bolsa} · ${cand.nome || '—'}`);
          }
        }
      }
      if (!casFii.some((c) => c.status === 'ok')) {
        // O índice existe e nenhum ticker está nele: ou o padrão do código
        // publicado não é o que supomos, ou estes fundos não entregam
        // informe. Uma amostra do índice separa as duas — sem ela, a
        // correção vira palpite.
        const amostra = Array.from(vinculo.porCodigo.values())
          .slice(0, 6)
          .map((f) => `${f.codigo}=${f.isin || '—'}`);
        log(`  ✗ nenhum ticker no índice. amostra: ${amostra.join(' | ')}`);
      }

      // ── os números ──
      //
      // Cada membro do ZIP traz um pedaço: patrimônio e cotistas num,
      // dividend yield noutro, vacância no de ativos. Ler todos e completar
      // campo a campo evita escolher de véspera qual arquivo tem o quê —
      // escolha que já errou uma vez, quando vacância foi procurada no
      // membro errado e o relatório acusou quatro campos ausentes por
      // execução.
      const porCnpj = new Map();
      const achadas = new Set();
      // A série atravessa ANOS e MEMBROS: cada ZIP traz doze meses, e o
      // dividend yield mora só no `complemento`. Acumular tudo antes de
      // calcular é o que torna a janela de 36 meses possível.
      const seriePorCnpj = new Map();
      const empilharSerie = (parcial) => {
        for (const [cnpj, pontos] of parcial.seriePorCnpj || new Map()) {
          const acum = seriePorCnpj.get(cnpj) || [];
          for (const ponto of pontos) acum.push(ponto);
          seriePorCnpj.set(cnpj, acum);
        }
      };
      for (const pct of pacotes) {
        if (pct === pacote) continue;
        for (const chave of ['geral', 'complemento', 'ativo_passivo']) {
          const csv = pct.csvs[chave];
          if (!csv || !csv.registros || !csv.registros.length) continue;
          empilharSerie(P.extrairInformeFii(csv.registros, csv.colunas));
        }
      }
      for (const [nome, csv] of membros) {
        const parcial = P.extrairInformeFii(csv.registros, csv.colunas);
        for (const campo of Object.keys(parcial.colunas || {})) {
          if (parcial.colunas[campo]) achadas.add(campo);
        }
        // A convenção de unidade do DY é decidida pelo arquivo; dizer qual
        // saiu é o que permite conferir sem abrir o CSV. `Percentual_…` que
        // é razão já custou uma rodada.
        const esc = parcial.escalaDy;
        if (esc && esc.amostra) {
          log(
            `    DY do mês em "${nome}": mediana ${esc.mediana} em ${esc.amostra} fundos → ` +
              (esc.fator === 100 ? 'razão, convertido para %' : 'já em %')
          );
        }
        empilharSerie(parcial);
        for (const [cnpj, inf] of parcial.porCnpj) {
          const acum = porCnpj.get(cnpj);
          if (!acum) {
            porCnpj.set(cnpj, { ...inf });
            continue;
          }
          for (const campo of Object.keys(inf)) {
            if (acum[campo] === null || acum[campo] === undefined) acum[campo] = inf[campo];
          }
        }
      }
      // ── vacância e imóveis: informe TRIMESTRAL ──
      //
      // O mensal não os publica. Não é suposição: a execução real imprimiu
      // as colunas dos três membros e ali só há rubricas de balanço.
      let imoveisPorCnpj = new Map();
      try {
        const dirTri = `${BASE_FII}/DOC/INF_TRIMESTRAL/DADOS/`;
        const achadoTri = await acharNoDiretorio(dirTri, /^inf_trimestral_fii_\d{4}\.zip$/i);
        const pacoteTri = await baixarZipCsvs(achadoTri.url, ['imovel', 'ativo', 'geral']);
        const nomeMembroTri = pacoteTri.csvs.imovel
          ? 'imovel'
          : pacoteTri.csvs.ativo
            ? 'ativo'
            : 'geral';
        const membroTri = pacoteTri.csvs[nomeMembroTri];
        if (!membroTri) {
          log(`  ! trimestral sem membro reconhecido. No ZIP: ${pacoteTri.nomesNoZip.join(', ')}`);
        } else {
          const im = P.extrairImoveisFii(membroTri.registros, membroTri.colunas);
          imoveisPorCnpj = im.porCnpj;
          log(`  trimestral ${achadoTri.nome}: ${imoveisPorCnpj.size} fundos com imóveis`);
          // QUAL coluna virou vacância e QUAL virou área — sempre, não só
          // quando falta. "Ocupação 100%" em toda a carteira pode ser
          // verdade ou pode ser a coluna errada, e o nome dela é o que
          // separa as duas. Uma granularidade diferente da esperada (uma
          // linha por unidade, não por imóvel) também aparece aqui.
          const escalaDita = (nome, esc) =>
            `${nome} ${esc && esc.amostra ? `${esc.amostra} val., mediana ${esc.mediana} → ${esc.fator === 100 ? 'razão ×100' : 'já em %'}` : 'ausente'}`;
          log(
            `    membro "${nomeMembroTri}" (${(membroTri.membros || []).length} arquivos, ` +
              `${membroTri.registros.length} linhas) · ` +
              escalaDita('locado', im.escalaLocado) +
              ' · ' +
              escalaDita('vacância', im.escalaVacancia) +
              ` · área ← ${im.colunas.area || '—'}`
          );
          log(`    colunas reais: ${membroTri.colunas.slice(0, 24).join(', ')}`);
          if (im.faltando.length) {
            log(`  ! trimestral sem colunas: ${im.faltando.join(', ')}`);
            log(`    membros no ZIP: ${pacoteTri.nomesNoZip.join(', ')}`);
          }
        }
      } catch (e) {
        // Sem o trimestral o fundo perde ocupação e contagem de imóveis, e
        // segue com patrimônio, cotistas, P/VP e dividendos. Lacuna, não
        // falha — mas dita, para não virar mistério.
        log(`  ! informe trimestral indisponível — ${e.message}`);
      }

      const faltando = Object.keys(P.COLUNAS_FII).filter((campo) => !achadas.has(campo));
      // Vacância e número de imóveis moram noutro membro e não entram em
      // `faltando` — mas se nenhum dos três arquivos os traz, o pilar de
      // crescimento do FII fica sem a taxa de ocupação e ninguém fica
      // sabendo por quê. Nomear as colunas reais é o que responde isso.
      // O informe mensal não publica vacância — isso já está estabelecido, e
      // repeti-lo a cada execução é ruído que compete com falha de verdade.
      // Só vira aviso se o TRIMESTRAL também não tiver entregado nada.
      const semImoveis =
        !imoveisPorCnpj.size &&
        Object.keys(P.COLUNAS_FII_IMOVEIS).every((campo) => !achadas.has(campo));
      if (semImoveis) {
        log('  ! vacância e número de imóveis não estão em nenhum membro lido');
        for (const [nome, csv] of membros) {
          log(`    colunas de ${nome}: ${csv.colunas.join(', ')}`);
        }
      }
      if (faltando.length) {
        log(`  ! campos de FII em nenhum membro: ${faltando.join(', ')}`);
        for (const [nome, csv] of membros) {
          log(`    colunas de ${nome}: ${csv.colunas.join(', ')}`);
        }
      }

      for (const c of casFii) {
        if (c.status !== 'ok' || !c.chave) continue;
        const inf = porCnpj.get(String(c.chave).replace(/\D/g, ''));
        if (!inf) {
          log(`  ✗ ${c.ticker} sem informe no período`);
          continue;
        }
        const preenchidos = [
          'patrimonioLiquido',
          'numeroCotistas',
          'ocupacao',
          'valorPatrimonialCota',
          'dy',
        ].filter((k) => inf[k] !== null && inf[k] !== undefined).length;
        const imoveis = imoveisPorCnpj.get(String(c.chave).replace(/\D/g, '')) || null;
        // Depois da junção dos membros: o ativo vem do `complemento` e as
        // obrigações do `ativo_passivo`.
        const alavancagem = P.alavancagemFii(inf);
        // Tijolo ou papel, pela carteira publicada. Decide QUAIS indicadores
        // se aplicam ao fundo — não a classe dele na alocação.
        const carteira = P.carteiraFii(inf);
        const tipoFii = carteira.tipo;
        const serie = P.indicadoresDaSerieFii(seriePorCnpj.get(String(c.chave).replace(/\D/g, '')));
        const bi = (v) => (v === null || v === undefined ? '—' : (v / 1e9).toFixed(2) + 'bi');
        log(
          `    ${c.ticker.padEnd(8)} ${inf.dataReferencia || '—'} · PL ${bi(inf.patrimonioLiquido)}` +
            ` · VPC ${inf.valorPatrimonialCota ?? '—'} · DY ${inf.dyMes ?? '—'}%/mês` +
            ` · cotistas ${inf.numeroCotistas ?? '—'}` +
            ` · imóveis ${imoveis ? imoveis.numeroImoveis : '—'}` +
            `${
              imoveis
                ? ` (${imoveis.imoveisComVago} com vago · cobertura área ${
                    imoveis.coberturaArea === null
                      ? '—'
                      : Math.round(imoveis.coberturaArea * 100) + '%'
                  } · contagem ${Math.round(imoveis.coberturaContagem * 100)}%)`
                : ''
            }` +
            ` · ocupação ${imoveis && imoveis.ocupacao !== null ? imoveis.ocupacao : (inf.ocupacao ?? '—')}`
        );
        log(
          `             série ${serie.mesesObservados} meses · DY médio ${serie.dyMedio36m ?? '—'}%` +
            ` · pagando ${serie.consistenciaDividendos ?? '—'}% dos meses` +
            // A fatia vai junto com o rótulo porque é ela que o decide: sem
            // ela, "tijolo" num fundo de recebíveis com dois imóveis é
            // indistinguível de "tijolo" num galpão logístico.
            ` · ${tipoFii || 'tipo?'}${carteira.fracaoImoveis === null ? '' : ` (${carteira.fracaoImoveis}% imóvel)`}` +
            // O motivo da recusa, não só o travessão: 31 meses de rendimento
            // com nota vazia pediu uma rodada inteira só para descobrir qual
            // das quatro portas de saída tinha sido usada.
            ` · cresc.div ${
              serie.crescimentoDividendo12m === null
                ? `— (${serie.crescimentoMotivo}, ${serie.mesesComRendimento}m c/ rend.${
                    serie.crescimentoBruto === null ? '' : `, recusou ${serie.crescimentoBruto}%`
                  }${serie.mesesSaldoQuitado ? `, ${serie.mesesSaldoQuitado}m saldo quitado` : ''})`
                : `${serie.crescimentoDividendo12m}% (${serie.crescimentoFonte})`
            }` +
            ` · LTV ${alavancagem === null ? '—' : alavancagem + '%'}`
        );
        // Os dois caminhos lado a lado. `razão` é a evidência: o rendimento
        // por cota tirado do saldo dividido pelo tirado de `DY × VPC`, na
        // mediana dos meses em que os dois existem. Perto de 1 confirma que o
        // yield da CVM é sobre o valor patrimonial — e aí o segundo caminho
        // pode assumir nos fundos onde o saldo fecha em zero. Longe de 1
        // desmente, e é melhor sabê-lo aqui do que num ranking publicado.
        log(
          `             pelo saldo ${
            serie.crescimentoSaldo === null ? '—' : serie.crescimentoSaldo + '%'
          } · pelo DY×VPC ${
            serie.crescimentoPorDy === null
              ? `— (${serie.crescimentoPorDyMotivo})`
              : serie.crescimentoPorDy + '%'
          }` +
            ` · razão saldo/DY ${serie.razaoSaldoDy === null ? '—' : serie.razaoSaldoDy}` +
            ` em ${serie.mesesComparados}m`
        );
        if (!preenchidos) continue;
        documentos.push({
          ticker: c.ticker,
          dados: {
            patrimonioLiquido: inf.patrimonioLiquido,
            numeroCotistas: inf.numeroCotistas,
            // Do trimestral, que é quem os publica; o mensal fica de
            // reserva para o caso de a CVM passar a trazê-los lá.
            numeroImoveis: imoveis ? imoveis.numeroImoveis : inf.numeroImoveis,
            ocupacao: imoveis && imoveis.ocupacao !== null ? imoveis.ocupacao : inf.ocupacao,
            // O valor patrimonial da COTA dá P/VP sem passar por valor de
            // mercado: preço ÷ VPC, dois números publicados, nenhuma
            // contagem de cotas no meio para errar de escala.
            valorPatrimonialCota: inf.valorPatrimonialCota,
            numeroCotas: inf.numeroCotas,
            dy: inf.dy,
            dyMes: inf.dyMes,
            // Da série mensal, não de um informe isolado: são as duas
            // perguntas de consistência que o pilar de dividendos faz.
            dyMedio36m: serie.dyMedio36m,
            consistenciaDividendos: serie.consistenciaDividendos,
            // Do rendimento POR COTA da série. A objeção original a usar o
            // yield era que yield é rendimento ÷ PREÇO, e a variação dele
            // confundiria mudança de distribuição com mudança de cotação.
            // A execução real desmentiu a premissa: o informe da CVM não tem
            // coluna de preço nenhuma, e o `Percentual_Dividend_Yield_Mes` é
            // sobre o valor patrimonial. Medido em seis fundos com 31 meses
            // cada, `DY × VPC` e `saldo ÷ cotas` deram a MESMA grandeza —
            // razão 1 em 186 comparações mensais.
            crescimentoDividendo12m: serie.crescimentoDividendo12m,
            // Qual dos dois caminhos produziu o número. Vai para a base pelo
            // mesmo motivo que a fonte de qualquer indicador: dois caminhos
            // com coberturas diferentes não são intercambiáveis para quem
            // audita, mesmo dando o mesmo resultado onde ambos existem.
            crescimentoFonte: serie.crescimentoFonte,
            // Único indicador do pilar Endividamento do FII: sem ele o
            // pilar inteiro fica vazio e a cobertura da classe desaba.
            alavancagem,
            mesesObservados: serie.mesesObservados,
            classe: 'fii',
            tipoFii,
            fonte: 'cvm',
            fonteRotulo: `Informe Mensal · CVM${inf.dataReferencia ? ` (${inf.dataReferencia})` : ''}`,
            dataReferencia: inf.dataReferencia,
          },
        });
      }
    } catch (e) {
      log(`  ✗ informe de FII falhou: ${e.message}`);
    }
  }

  // ── 4.5. Fundamentos do Yahoo ──
  //
  // Roda AQUI e não no endpoint por uma razão medida: a Vercel recebeu 429
  // em sete tentativas seguidas (IP de saída partilhado e limitado). O
  // runner do GitHub Actions não sofre isso, e não tem o limite de 15s — dá
  // para percorrer o universo inteiro em série, com calma.
  //
  // É também o caminho que mantém o produto funcionando SEM token de
  // cotação e SEM a CVM: o Yahoo só precisa do ticker.
  const jaTemCvm = new Set(documentos.map((d) => d.ticker));
  const paraYahoo = universo.map((t) => t.ticker).filter((t) => !jaTemCvm.has(t));
  const docsYahoo = [];
  if (paraYahoo.length) {
    log(`\n· Fundamentos do Yahoo para ${paraYahoo.length} tickers…`);
    const errosYahoo = [];
    const { fetchYahooFundamentals } = require(
      path.join(__dirname, '..', 'api', 'market.js')
    ).fontes;
    // Orçamento de 10 minutos e sem teto de tickers: o job pode demorar.
    const res = await fetchYahooFundamentals(
      paraYahoo,
      errosYahoo,
      10 * 60 * 1000,
      paraYahoo.length
    );
    for (const ticker of Object.keys(res)) {
      docsYahoo.push({ ticker, yahoo: res[ticker] });
    }
    log(`  ${docsYahoo.length} com fundamentos · ${errosYahoo.length} falha(s)`);
    const amostraErros = Array.from(new Set(errosYahoo.map((e) => e.erro))).slice(0, 3);
    if (amostraErros.length) log(`  erros: ${amostraErros.join(' · ')}`);
    for (const d of docsYahoo.slice(0, 15)) {
      log(
        `    ${d.ticker.padEnd(8)} cobertura ${Math.round((d.yahoo.cobertura || 0) * 100)}% · ` +
          `ROE ${d.yahoo.roe === null ? '—' : d.yahoo.roe.toFixed(1) + '%'} · ` +
          `P/L ${d.yahoo.pl === null ? '—' : d.yahoo.pl.toFixed(1)}`
      );
    }
  }

  // ── 5. Cotações do universo ──
  //
  // O ranking do servidor precisa de valor de mercado para calcular P/L e
  // P/VP. Buscar aqui, uma vez por semana, é o que evita que a lista curta
  // seja escolhida com o pilar de valuation cego.
  const tickersRv = universo.map((t) => t.ticker);
  if (tickersRv.length) {
    log(`\n· Cotação de ${tickersRv.length} tickers…`);
    const cotacoes = await baixarCotacoes(tickersRv);
    const achadas = Object.keys(cotacoes).length;
    log(
      `  ${achadas} cotações obtidas${achadas < tickersRv.length ? ` (${tickersRv.length - achadas} sem cotação)` : ''}`
    );
    for (const ticker of Object.keys(cotacoes)) {
      const existente = documentos.find((d) => d.ticker === ticker);
      if (existente) existente.mercado = cotacoes[ticker];
      else documentos.push({ ticker, dados: null, mercado: cotacoes[ticker] });
    }
  }

  // ── 6. Gravação ──
  // Junta os que só têm Yahoo aos que têm CVM.
  for (const dy of docsYahoo) {
    const existente = documentos.find((d) => d.ticker === dy.ticker);
    if (existente) existente.yahoo = dy.yahoo;
    else documentos.push({ ticker: dy.ticker, dados: null, yahoo: dy.yahoo });
  }

  log(`\n=== ${documentos.length} documentos prontos ===`);
  if (!gravar) {
    log('DRY-RUN: nada foi gravado. Confira os casamentos acima e rode com --gravar.\n');
    return;
  }
  if (!documentos.length) {
    log('Nada a gravar.\n');
    process.exitCode = 1;
    return;
  }

  const { db, timestamp } = require(path.join(__dirname, '..', 'api', '_lib', 'firebase-admin'));
  const database = db();
  const agora = Date.now();
  let gravados = 0;
  for (let i = 0; i < documentos.length; i += 400) {
    const lote = documentos.slice(i, i + 400);
    const batch = database.batch();
    for (const doc of lote) {
      // Ramo `cvm` separado do ramo `mercado`: a API compõe os dois na
      // leitura. Gravar plano faria a próxima resposta da fonte de cotação,
      // cheia de nulls, apagar tudo o que este job acabou de calcular.
      const payload = { updatedAt: timestamp().now() };
      if (doc.dados) {
        payload.cvm = semUndefined(doc.dados);
        payload.cvmFetchedAtMs = agora;
      }
      if (doc.yahoo) {
        payload.yahoo = semUndefined(doc.yahoo);
        payload.yahooFetchedAtMs = agora;
      }
      // Cotação vai para o ramo `mercado`, o mesmo que op=fundamentals usa.
      // Ele rebusca por cima quando o dado passa de 24h, então a tela vê
      // preço do dia e o ranking vê preço da semana — que é o suficiente
      // para peneirar.
      if (doc.mercado) {
        payload.mercado = semUndefined(doc.mercado);
        payload.mercadoFetchedAtMs = agora;
      }
      if (!payload.cvm && !payload.yahoo && !payload.mercado) continue;
      batch.set(database.collection(COLECAO).doc(doc.ticker), payload, { merge: true });
      gravados++;
    }
    await batch.commit();
  }
  log(`Gravados ${gravados} documentos em ${COLECAO}.\n`);
}

/**
 * Campos `undefined` viram ausência, não erro.
 *
 * O Firestore RECUSA `undefined` e derruba o lote inteiro — um campo novo
 * que uma fonte não preencheu perderia a gravação das dezenas de
 * documentos que estavam certos. Ausente é `null`: o motor já sabe ler
 * lacuna, e é a diferença entre um indicador vazio e nenhum dado gravado.
 */
function semUndefined(obj) {
  const out = {};
  for (const [chave, valor] of Object.entries(obj || {})) {
    out[chave] = valor === undefined ? null : valor;
  }
  return out;
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\n✗ Falhou:', e.message);
    process.exitCode = 1;
  });
}

module.exports = {
  listarDiretorio,
  acharNoDiretorio,
  // `main` é exportada para o teste de fumaça poder rodar o pipeline inteiro
  // contra uma rede simulada. É o único lugar onde o encadeamento
  // FCA → universo → DFP → indicadores → documentos é exercitado junto — e
  // foi exatamente aí que a falha silenciosa (chave de junção errada) morou,
  // sem que nenhum teste de unidade a visse.
  main,
  casarCadastro,
  chavesDaEmpresa,
  exercicioDaEmpresa,
  exercicioDaEmpresaIndexado,
  baixarCotacoes,
  semUndefined,
};
