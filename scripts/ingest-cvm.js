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
 */
async function baixarZipCsvs(url, prefixos) {
  const buf = await baixar(url);
  const entradas = lerZip(buf);
  const out = {};
  const nomes = entradas.map((e) => e.nome);
  for (const prefixo of prefixos) {
    const alvo = entradas.find((e) =>
      P.normalizarChave(e.nome).includes(P.normalizarChave(prefixo))
    );
    if (alvo) out[prefixo] = P.parseCsvCvm(alvo.dados.toString('latin1'));
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
  for (const ano of anos) {
    log(`\n· DFP ${ano}…`);
    let pacote;
    try {
      pacote = await baixarZipCsvs(`${BASE_CIA}/DOC/DFP/DADOS/dfp_cia_aberta_${ano}.zip`, [
        'BPA_con',
        'BPP_con',
        'DRE_con',
        'DFC_MI_con',
      ]);
    } catch (e) {
      log(`  ✗ ${e.message} — ano ignorado`);
      continue;
    }
    const achados = Object.keys(pacote.csvs);
    log(
      `  arquivos usados: ${achados.join(', ') || 'nenhum'} (de ${pacote.nomesNoZip.length} no ZIP)`
    );
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
    const r = P.calcularIndicadores(exercicios);
    const ind = r.indicadores;
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
    const comLpa = documentos.filter((d) => d.dados && d.dados.acoesEquivalentes).length;
    const comDiv = documentos.filter((d) => d.dados && d.dados.dividendosPagos).length;
    log(
      `\n  valuation possível em ${comLpa}/${documentos.length} (LPA na DRE) · ` +
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
      // Descoberto no índice do diretório, não adivinhado: os três nomes
      // conhecidos deram 404 na execução real, e a CVM renomeia arquivos.
      let cadFii = null;
      for (const dir of [`${BASE_FII}/CAD/DADOS/`, `${BASE_FII}/CAD/`]) {
        try {
          const achado = await acharNoDiretorio(dir, /^(cad_fii|registro_fundo).*\.csv$/i);
          log(`  cadastro: ${achado.nome}`);
          cadFii = await baixarCsv(achado.url);
          break;
        } catch (e) {
          log(`  ! ${dir} — ${e.message}`);
        }
      }
      if (!cadFii) {
        await diagnosticarArvore(`${BASE_FII}/CAD/DADOS/`);
        throw new Error('cadastro_fii_indisponivel');
      }
      const colNomeFii = P.acharColuna(cadFii.colunas, ['DENOM_SOCIAL', 'NM_FUNDO', 'DENOM_FUNDO']);
      const colCnpjFii = P.acharColuna(cadFii.colunas, ['CNPJ_FUNDO', 'CNPJ_Fundo', 'CNPJ']);
      if (!colNomeFii || !colCnpjFii) {
        log(`  ! cadastro de FII sem colunas esperadas: ${cadFii.colunas.slice(0, 10).join(', ')}`);
      } else {
        const casFii = casarCadastro(cadFii, mapaFiis, colNomeFii, colCnpjFii);
        for (const c of casFii) {
          const marca = c.status === 'ok' ? '  ' : c.status === 'ambiguo' ? ' ?' : ' ✗';
          log(`  ${marca} ${c.ticker.padEnd(8)} ${c.casouCom || '— ' + c.status}`);
        }
        // O arquivo do ano corrente só passa a existir depois do primeiro
        // informe do ano; em janeiro (e enquanto a CVM não publica) a URL
        // devolve 404. Cair para o ano anterior é a diferença entre um
        // informe velho de meses e nenhum informe — e o anterior serve.
        // O nome traz o ano; ordenar e pegar o último dá o informe mais
        // recente sem precisar saber que ano a CVM já publicou.
        const dirInf = `${BASE_FII}/DOC/INF_MENSAL/DADOS/`;
        let pacote = null;
        try {
          const achado = await acharNoDiretorio(dirInf, /^inf_mensal_fii_\d{4}\.zip$/i);
          log(`  informe: ${achado.nome}`);
          pacote = await baixarZipCsvs(achado.url, ['complemento', 'geral', 'ativo_passivo']);
        } catch (e) {
          log(`  ! informe indisponível em ${dirInf} — ${e.message}`);
        }
        const compl = pacote && (pacote.csvs.complemento || pacote.csvs.geral);
        if (!pacote) {
          log('  ✗ sem informe mensal de FII neste ciclo');
        } else if (!compl) {
          log(`  ! nenhum CSV de informe reconhecido. No ZIP: ${pacote.nomesNoZip.join(', ')}`);
        } else {
          const { porCnpj, faltando } = P.extrairInformeFii(compl.registros, compl.colunas);
          if (faltando.length) log(`  ! campos de FII não encontrados: ${faltando.join(', ')}`);
          for (const c of casFii) {
            if (c.status !== 'ok' || !c.chave) continue;
            const inf = porCnpj.get(String(c.chave).replace(/\D/g, ''));
            if (!inf) {
              log(`  ✗ ${c.ticker} sem informe no período`);
              continue;
            }
            const preenchidos = ['patrimonioLiquido', 'numeroCotistas', 'ocupacao'].filter(
              (k) => inf[k] !== null
            ).length;
            log(
              `    ${c.ticker.padEnd(8)} PL ${inf.patrimonioLiquido ?? '—'} · cotistas ${inf.numeroCotistas ?? '—'} · ocupação ${inf.ocupacao ?? '—'}`
            );
            if (!preenchidos) continue;
            documentos.push({
              ticker: c.ticker,
              dados: {
                patrimonioLiquido: inf.patrimonioLiquido,
                numeroCotistas: inf.numeroCotistas,
                numeroImoveis: inf.numeroImoveis,
                ocupacao: inf.ocupacao,
                classe: 'fii',
                fonte: 'cvm',
                fonteRotulo: `Informe Mensal · CVM`,
                dataReferencia: inf.dataReferencia,
              },
            });
          }
        }
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
        payload.cvm = doc.dados;
        payload.cvmFetchedAtMs = agora;
      }
      if (doc.yahoo) {
        payload.yahoo = doc.yahoo;
        payload.yahooFetchedAtMs = agora;
      }
      // Cotação vai para o ramo `mercado`, o mesmo que op=fundamentals usa.
      // Ele rebusca por cima quando o dado passa de 24h, então a tela vê
      // preço do dia e o ranking vê preço da semana — que é o suficiente
      // para peneirar.
      if (doc.mercado) {
        payload.mercado = doc.mercado;
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
};
