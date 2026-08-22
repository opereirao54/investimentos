'use strict';

// Teste de fumaça do pipeline de ingestão, ponta a ponta, contra uma rede
// simulada.
//
// POR QUE ELE EXISTE
//   A primeira execução real devolveu universo vazio EM SILÊNCIO — "0 tickers",
//   "0 companhias com dados" — com o arquivo certo aberto, as colunas
//   resolvidas e o parse funcionando. A causa era a chave de junção: o FCA
//   identifica a companhia por CNPJ e o código procurava por CD_CVM.
//
//   Nenhum teste de unidade via isso, porque cada peça estava certa
//   isoladamente. O que faltava era exercitar o ENCADEAMENTO
//   (FCA → universo → DFP → indicadores → documentos) com dados no dialeto
//   real da CVM. É o que este arquivo faz, sem tocar a rede.
//
// A rede é substituída por um roteador de URL que devolve ZIPs e CSVs
// sintéticos montados aqui. O objetivo NÃO é validar o layout da CVM (isso só
// o dry-run no runner faz), e sim garantir que o pipeline não volte a
// atravessar inteiro produzindo zero.

const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');

const ingest = require('../scripts/ingest-cvm');

// ── ZIP mínimo, igual ao de cvm-parser.test.js ──
function zipar(arquivos) {
  const locais = [];
  const centrais = [];
  let offset = 0;
  for (const [nome, conteudo] of arquivos) {
    const cru = Buffer.from(conteudo, 'latin1');
    const comp = zlib.deflateRawSync(cru);
    const n = Buffer.from(nome, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(cru.length, 22);
    lh.writeUInt16LE(n.length, 26);
    locais.push(Buffer.concat([lh, n, comp]));
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(cru.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrais.push(Buffer.concat([ch, n]));
    offset += 30 + n.length + comp.length;
  }
  const central = Buffer.concat(centrais);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(arquivos.length, 8);
  eocd.writeUInt16LE(arquivos.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, central, eocd]);
}

// ── Fixtures no dialeto da CVM ──
//
// O detalhe que importa: o FCA traz CNPJ_Companhia e NÃO traz CD_CVM. É a
// forma real do arquivo, e a que fazia o pipeline devolver zero.
const CNPJ_A = '00.000.000/0001-91';
const CNPJ_B = '84.429.695/0001-11';

function fcaCsv() {
  return [
    'CNPJ_Companhia;Data_Referencia;Valor_Mobiliario;Codigo_Negociacao;Mercado;Sigla_Entidade_Administradora',
    `${CNPJ_A};2025-12-31;Ações Ordinárias;BBAS3;Bolsa;B3`,
    `${CNPJ_B};2025-12-31;Ações Ordinárias;WEGE3;Bolsa;B3`,
    // Debênture não é renda variável: tem de ficar de fora do universo.
    `${CNPJ_B};2025-12-31;Debêntures;WEGE12;Bolsa;B3`,
  ].join('\n');
}

const CAB_DFP =
  'CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA';

function linhaDfp(cnpj, cdCvm, ano, cod, ds, valor, escala) {
  return [
    cnpj,
    `${ano}-12-31`,
    '1',
    'COMPANHIA TESTE S.A.',
    cdCvm,
    'DF Consolidado',
    'REAL',
    escala || 'MIL',
    'ÚLTIMO',
    `${ano}-12-31`,
    cod,
    ds,
    String(valor),
  ].join(';');
}

function dfpCsv(qual, ano, opcoes) {
  const op = opcoes || {};
  // No cenário "absurdo" a companhia A tem patrimônio de dezenas de bilhões,
  // como a Eletrobras — é o contraste com a contagem minúscula que denuncia
  // o defeito. Com patrimônio pequeno, R$ 500 por ação passaria por normal.
  const empresas = [
    { cnpj: CNPJ_A, cd: '1023', mult: op.absurdo ? 1000 : 1 },
    { cnpj: CNPJ_B, cd: '5410', mult: 0.4 },
  ];
  const linhas = [CAB_DFP];
  for (const e of empresas) {
    const m = e.mult * (1 + (ano - 2021) * 0.1);
    const add = (cod, ds, v, esc) => linhas.push(linhaDfp(e.cnpj, e.cd, ano, cod, ds, v, esc));
    if (qual === 'BPA_con') {
      add('1', 'Ativo Total', Math.round(2000000 * m));
      add('1.01', 'Ativo Circulante', Math.round(900000 * m));
      add('1.01.01', 'Caixa e Equivalentes de Caixa', Math.round(50000 * m));
    } else if (qual === 'BPP_con') {
      add('2.01', 'Passivo Circulante', Math.round(700000 * m));
      add('2.01.04', 'Empréstimos e Financiamentos', Math.round(10000 * m));
      add('2.02.01', 'Empréstimos e Financiamentos', Math.round(20000 * m));
      add('2.03', 'Patrimônio Líquido Consolidado', Math.round(140000 * m));
    } else if (qual === 'DRE_con') {
      add('3.01', 'Receita de Venda de Bens e/ou Serviços', Math.round(150000 * m));
      add('3.05', 'Resultado Antes do Resultado Financeiro e dos Tributos', Math.round(38000 * m));
      add('3.07', 'Resultado Antes dos Tributos sobre o Lucro', Math.round(26000 * m));
      add('3.08', 'Imposto de Renda e Contribuição Social sobre o Lucro', Math.round(-5000 * m));
      add('3.11', 'Lucro/Prejuízo Consolidado do Período', Math.round(21000 * m));
      // Grupo 3.99: básico em 3.99.01, diluído em 3.99.02, classe na folha.
      add('3.99', 'Lucro por Ação - (Reais / Ação)', 0, 'UNIDADE');
      add('3.99.01', 'Lucro Básico por Ação', 0, 'UNIDADE');
      // O divisor acompanha a escala para o LPA continuar plausível mesmo no
      // cenário de patrimônio inflado — é o que permite testar a QUEDA para a
      // derivação depois de a contagem declarada ser recusada.
      const acoesFicticias = 2850000 * (op.absurdo ? 1000 : 1);
      add('3.99.01.01', 'ON', ((21000 * m * 1000) / acoesFicticias).toFixed(4), 'UNIDADE');
      add('3.99.02', 'Lucro Diluído por Ação', 0, 'UNIDADE');
      add('3.99.02.01', 'ON', ((21000 * m * 1000) / 3000000).toFixed(4), 'UNIDADE');
    } else if (qual === 'DFC_MI_con') {
      add('6.01', 'Caixa Líquido Atividades Operacionais', Math.round(30000 * m));
      add('6.01.01.02', 'Depreciação e Amortização', Math.round(2000 * m));
      add('6.03', 'Caixa Líquido Atividades de Financiamento', Math.round(-15000 * m));
      add('6.03.01', 'Captações de Empréstimos', Math.round(-7000 * m));
      add('6.03.04', 'Dividendos e Juros sobre Capital Próprio Pagos', Math.round(-8000 * m));
    }
  }
  return linhas.join('\n');
}

// A quantidade de ações vem declarada num quinto membro do ZIP. As duas
// companhias do fixture têm ON e PN — o caso em que `lucro ÷ LPA` NÃO
// resolve, e que na execução real deixava a valuation em 5 de 14.
const CAB_CAPITAL =
  'CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;DT_FIM_EXERC;ESCALA_QUANTIDADE;QT_ACAO_ORDIN_CAP_INTEGR;QT_ACAO_PREF_CAP_INTEGR;QT_ACAO_ORDIN_TESOURARIA;QT_ACAO_PREF_TESOURARIA';

function capitalCsv(ano, opcoes) {
  const op = opcoes || {};
  // As DUAS escalas no MESMO arquivo, como na CVM de verdade: a Eletrobras
  // declara em milhares (2.028.544 = 2,03 bi) e o Banco do Brasil em
  // unidades. Ignorar a escala fazia a primeira sair mil vezes menor, com
  // um número plausível e sem erro nenhum.
  //
  // No cenário "absurdo" a contagem é minúscula MESMO em unidades: é o que
  // a trava do patrimônio ainda tem de recusar depois da escala aplicada.
  const escalaA = op.absurdo ? 'UNIDADE' : 'MIL';
  const onA = op.absurdo ? '150000' : '2028544';
  const pnA = op.absurdo ? '0' : '886884';
  const tesA = op.absurdo ? '0;0' : '50000;10000';
  return [
    CAB_CAPITAL,
    `${CNPJ_A};${ano}-12-31;1;COMPANHIA TESTE S.A.;1023;${ano}-12-31;${escalaA};${onA};${pnA};${tesA}`,
    `${CNPJ_B};${ano}-12-31;1;COMPANHIA TESTE S.A.;5410;${ano}-12-31;UNIDADE;800000000;0;0;0`,
  ].join('\n');
}

// ── Informe mensal de FII ──
//
// O ZIP anual traz um arquivo POR MÊS. Pegar o primeiro que casava com o
// prefixo entregava janeiro em agosto, sem erro nenhum — por isso os
// fixtures têm dois meses, em ordem, e o teste cobra o mais recente.
//
// E o vínculo ticker↔fundo sai do `Codigo_ISIN`, não do nome: o casamento
// por nome foi desmentido pela execução real.
const CNPJ_MXRF = '97.521.225/0001-25';
const CNPJ_HGLG = '11.728.688/0001-47';

function dataDa(competencia) {
  return `${competencia.slice(0, 4)}-${competencia.slice(4)}-01`;
}

function informeGeral(competencia) {
  const recente = competencia === '202607';
  const data = dataDa(competencia);
  return [
    'CNPJ_Fundo;Data_Referencia;Nome_Fundo;Codigo_ISIN;Patrimonio_Liquido;Cotas_Emitidas;Total_Numero_Cotistas',
    `${CNPJ_MXRF};${data};MAXI RENDA FUNDO DE INVESTIMENTO IMOBILIARIO;BRMXRFCTF004;${recente ? '1600000000' : '1500000000'};${recente ? '160000000' : '150000000'};${recente ? '480000' : '450000'}`,
    `${CNPJ_HGLG};${data};CSHG LOGISTICA - FII;BRHGLGCTF003;4000000000;30000000;120000`,
  ].join('\n');
}

function informeComplemento(competencia) {
  // 2025 rendeu menos que 2026, e num mês o Maxi Renda não pagou: é o que
  // torna DY médio e consistência distinguíveis de "o último mês repetido".
  const ano = competencia.slice(0, 4);
  const mes = competencia.slice(4);
  const dyMxrf = ano === '2025' ? '0,0060' : mes === '07' ? '0,0085' : '0';
  const data = dataDa(competencia);
  return [
    'CNPJ_Fundo;Data_Referencia;Valor_Patrimonial_Cotas;Percentual_Dividend_Yield_Mes',
    `${CNPJ_MXRF};${data};10,00;${dyMxrf}`,
    `${CNPJ_HGLG};${data};133,33;0,0075`,
  ].join('\n');
}

function informeZip(ano) {
  const meses = ['01', '04', '07'];
  const membros = [];
  // Fora de ordem de propósito: quem escolhe o mês é a data de referência,
  // não a ordem do arquivo.
  for (const mes of meses.slice().reverse()) {
    membros.push([`inf_mensal_fii_geral_${ano}${mes}.csv`, informeGeral(`${ano}${mes}`)]);
  }
  for (const mes of meses) {
    membros.push([
      `inf_mensal_fii_complemento_${ano}${mes}.csv`,
      informeComplemento(`${ano}${mes}`),
    ]);
  }
  return zipar(membros);
}

// ── Rede simulada ──
function montarFetch(opcoes) {
  const op = opcoes || {};
  const pedidos = [];
  return {
    pedidos,
    fetch: async (url) => {
      const u = String(url);
      pedidos.push(u);
      const responder = (buf) => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
        json: async () => JSON.parse(buf.toString('utf8')),
      });
      const naoAchado = { ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) };

      if (u.includes('/FCA/DADOS/fca_cia_aberta_')) {
        if (op.semFca) return naoAchado;
        // Só o exercício mais recente existe, como na CVM.
        if (!u.includes(`_${op.anoFca}.zip`)) return naoAchado;
        return responder(zipar([[`fca_cia_aberta_valor_mobiliario_${op.anoFca}.csv`, fcaCsv()]]));
      }
      if (u.includes('/DFP/DADOS/dfp_cia_aberta_')) {
        const ano = parseInt(u.match(/_(\d{4})\.zip/)[1], 10);
        if (!op.anosDfp.includes(ano)) return naoAchado;
        return responder(
          zipar(
            ['BPA_con', 'BPP_con', 'DRE_con', 'DFC_MI_con']
              .map((q) => [
                `dfp_cia_aberta_${q}_${ano}.csv`,
                dfpCsv(q, ano, { absurdo: op.capitalAbsurdo }),
              ])
              .concat([
                [
                  `dfp_cia_aberta_composicao_capital_${ano}.csv`,
                  capitalCsv(ano, { absurdo: op.capitalAbsurdo }),
                ],
              ])
          )
        );
      }
      if (u.includes('/FII/DOC/INF_TRIMESTRAL/DADOS/inf_trimestral_fii_')) {
        if (!op.trimestralFii) return naoAchado;
        return responder(
          zipar([
            [
              'inf_trimestral_fii_imovel_202606.csv',
              [
                'CNPJ_Fundo_Classe;Data_Referencia;Area_Bruta_Locavel;Percentual_Vacancia',
                `${CNPJ_MXRF};2026-06-30;10000;0`,
                `${CNPJ_MXRF};2026-06-30;10000;20`,
                `${CNPJ_HGLG};2026-06-30;100000;0`,
              ].join('\n'),
            ],
          ])
        );
      }
      if (u.includes('/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_')) {
        if (!op.informeFii) return naoAchado;
        const ano = u.match(/inf_mensal_fii_(\d{4})\.zip/);
        if (!ano) return naoAchado;
        return responder(informeZip(ano[1]));
      }
      // Índice de diretório da CVM, como o portal serve: HTML com links.
      if (op.indice && u.endsWith('/')) {
        const itens = op.indice[u];
        if (!itens) return naoAchado;
        const html =
          '<html><body><pre><a href="../">Parent Directory</a>\n' +
          itens.map((n) => `<a href="${n}">${n}</a>`).join('\n') +
          '</pre></body></html>';
        return responder(Buffer.from(html, 'latin1'));
      }
      // FII e cotação não são o alvo deste teste: falham como falhariam sem
      // rede, e o pipeline tem de sobreviver a isso.
      if (u.includes('query1.finance.yahoo.com') || u.includes('brapi.dev')) return naoAchado;
      return naoAchado;
    },
  };
}

async function rodar(argv, opcoes) {
  const fetchOriginal = globalThis.fetch;
  const logOriginal = console.log;
  const argvOriginal = process.argv;
  const saida = [];
  const rede = montarFetch(opcoes);
  globalThis.fetch = rede.fetch;
  console.log = (...a) => saida.push(a.map(String).join(' '));
  process.argv = ['node', 'ingest-cvm.js', ...argv];
  try {
    await ingest.main();
  } finally {
    globalThis.fetch = fetchOriginal;
    console.log = logOriginal;
    process.argv = argvOriginal;
    process.exitCode = 0;
  }
  return { texto: saida.join('\n'), pedidos: rede.pedidos };
}

// O ano-base do script é o anterior ao corrente (a DFP do ano só sai depois
// do fechamento). Os fixtures acompanham, para o teste não quebrar em janeiro.
const ANO_BASE = new Date().getUTCFullYear() - 1;

test('o pipeline atravessa inteiro e produz documentos — não zero', async () => {
  const { texto } = await rodar(['--dry-run', '--anos=3'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE, ANO_BASE - 1, ANO_BASE - 2],
  });

  // O sintoma que este teste existe para impedir, na forma exata em que
  // apareceu no log da primeira execução real.
  assert.ok(!/FCA \d+: 0 tickers/.test(texto), `universo vazio:\n${texto}`);
  assert.ok(
    !/0 companhias com dados neste exercício/.test(texto),
    `junção não casou nada:\n${texto}`
  );
  // Coluna essencial ausente é falha; opcional ausente é nota de rodapé, e
  // as duas não podem sair com a mesma cara no log.
  assert.ok(!/FCA sem coluna essencial/.test(texto), `coluna essencial:\n${texto}`);
  assert.match(texto, /colunas opcionais ausentes, sem impacto no universo: cdCvm/);

  assert.match(texto, /2 tickers em 2 companhias/);
  assert.match(texto, /BBAS3 WEGE3/);
  assert.ok(!texto.includes('WEGE12'), 'debênture não é ação e não entra no universo');
  assert.match(texto, /=== 2 documentos prontos ===/);
});

test('o universo sai do FCA pelo CNPJ, sem cair para o mapa manual', async () => {
  const { texto } = await rodar(['--dry-run', '--anos=1'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE],
  });
  assert.ok(
    !texto.includes('caindo para o mapa manual'),
    `o FCA funcionou e mesmo assim caiu para a rede de segurança:\n${texto}`
  );
});

test('LPA e dividendos chegam ao relatório — os dois pilares novos', async () => {
  const { texto } = await rodar(['--dry-run', '--anos=3'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE, ANO_BASE - 1, ANO_BASE - 2],
  });
  // Travessão nestas colunas = pilar vazio para a bolsa toda.
  assert.ok(!/LPA — /.test(texto), `LPA não extraído:\n${texto}`);
  assert.ok(!/div — /.test(texto), `dividendos não extraídos:\n${texto}`);
  assert.match(texto, /valuation possível em 2\/2/);
  assert.match(texto, /dividendos em 2\/2/);
});

test('a contagem de ações DECLARADA vence a derivada por LPA', async () => {
  // `lucro ÷ LPA` é uma inferência que falha em companhia com duas classes.
  // A composição do capital é o número que a própria companhia informou —
  // e é o que destrava P/L e P/VP para a bolsa toda, não só para quem tem
  // classe única.
  const { texto } = await rodar(['--dry-run', '--anos=1'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE],
  });
  assert.match(texto, /composição do capital: 2 companhias/);
  // Em MILHARES, como a Eletrobras declara: 2.028.544 ON + 886.884 PN −
  // 60.000 em tesouraria, tudo ×1000 → 2,86 bi. Sem aplicar a escala daria
  // 2,86 M — mil vezes menos, e plausível o bastante para ninguém olhar.
  assert.match(texto, /ações 2\.86bi cap/, 'a escala declarada não foi aplicada');
  assert.ok(!/ações .*bi lpa/.test(texto), 'com a declarada em mãos, ninguém deriva');
  assert.match(texto, /2 pela composição do capital, 0 pelo LPA/);
});

test('contagem declarada implausível é recusada, conferida pelo patrimônio', async () => {
  // O patrimônio NÃO passou pela contagem de ações, e por isso a denuncia.
  // Achado da execução real: a Eletrobras saiu com 0,00 bi de ações para um
  // patrimônio de 118,5 bi — R$ 118 mil por ação. Com esse número o valor de
  // mercado sairia mil vezes menor e ela lideraria a lente "Valor".
  const { texto } = await rodar(['--dry-run', '--anos=1'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE],
    capitalAbsurdo: true,
  });
  assert.match(texto, /contagem declarada recusada/);
  assert.match(texto, /por ação/, 'a mensagem mostra a conta que denuncia');
  // Recusada a declarada, a derivação por LPA assume — não fica sem nada.
  assert.match(texto, /ações .*bi lpa/);
  // E a recusa vem acompanhada das linhas cruas: sem elas o log diz que o
  // número está errado sem dizer o que o arquivo tem, e a próxima
  // investigação recomeça no escuro.
  assert.match(texto, /ON 150000 · PN 0 · tes 0 → 150000/, `linhas cruas ausentes:\n${texto}`);
});

test('sem FCA o pipeline não morre: cai para o mapa e diz que caiu', async () => {
  const { texto } = await rodar(['--dry-run', '--anos=1', '--limite=3'], {
    semFca: true,
    anosDfp: [ANO_BASE],
  });
  assert.match(texto, /caindo para o mapa manual|sem cadastro da CVM/);
  // Degradar não é falhar: o script tem de chegar ao fim.
  assert.match(texto, /documentos prontos|Nenhum documento/);
});

test('exercício indisponível é ignorado sem derrubar os outros', async () => {
  // Só o ano do meio existe. O pipeline tem de usar o que há.
  const { texto } = await rodar(['--dry-run', '--anos=3'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE - 1],
  });
  assert.match(texto, /ano ignorado|http_404/);
  assert.match(texto, /=== 2 documentos prontos ===/);
});

// ── Descoberta de arquivo pelo índice do diretório ──
//
// Existe porque os três nomes conhecidos do cadastro de FII deram 404 na
// execução real. Adivinhar nome de arquivo de um publicador que renomeia é
// uma dívida que vence sozinha; ler o índice, não.

test('o índice do diretório entrega os arquivos, ignorando navegação', async () => {
  const fetchOriginal = globalThis.fetch;
  const dir = 'https://dados.cvm.gov.br/dados/FII/CAD/DADOS/';
  globalThis.fetch = montarFetch({
    indice: { [dir]: ['cad_fii.csv', 'cad_fii_hist.csv', 'leiame.txt'] },
  }).fetch;
  try {
    const nomes = await ingest.listarDiretorio(dir);
    assert.deepEqual(nomes.sort(), ['cad_fii.csv', 'cad_fii_hist.csv', 'leiame.txt']);
    assert.ok(!nomes.includes('../'), 'link de navegação não é arquivo');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('entre vários anos, vale o mais recente — sem saber qual é de antemão', async () => {
  const fetchOriginal = globalThis.fetch;
  const dir = 'https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/';
  globalThis.fetch = montarFetch({
    indice: {
      [dir]: ['inf_mensal_fii_2023.zip', 'inf_mensal_fii_2025.zip', 'inf_mensal_fii_2024.zip'],
    },
  }).fetch;
  try {
    const r = await ingest.acharNoDiretorio(dir, /^inf_mensal_fii_\d{4}\.zip$/i);
    assert.equal(r.nome, 'inf_mensal_fii_2025.zip');
    assert.equal(r.url, dir + 'inf_mensal_fii_2025.zip');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('diretório sem nada que case falha dizendo o que havia lá', async () => {
  const fetchOriginal = globalThis.fetch;
  const dir = 'https://dados.cvm.gov.br/dados/FII/CAD/DADOS/';
  globalThis.fetch = montarFetch({ indice: { [dir]: ['outra_coisa.csv'] } }).fetch;
  try {
    await assert.rejects(
      () => ingest.acharNoDiretorio(dir, /^cad_fii.*\.csv$/i),
      /nenhum arquivo casa/,
      'a mensagem tem de dizer onde procurou e quantos arquivos viu'
    );
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('DRY-RUN não grava, e diz isso', async () => {
  const { texto, pedidos } = await rodar(['--dry-run', '--anos=1'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE],
  });
  assert.match(texto, /DRY-RUN: nada foi gravado/);
  assert.ok(!pedidos.some((u) => u.includes('firestore')), 'dry-run não pode tocar o Firestore');
});

// ════════════════════════════════════════════
// FII: o vínculo e o mês
// ════════════════════════════════════════════
//
// Dois defeitos da mesma família — a busca não falha, ela acha a coisa
// errada — cabem aqui: casar o fundo pelo nome contra um cadastro que não
// o contém (zero fundos, em silêncio) e ler o primeiro mês do ZIP anual
// achando que é o último (números plausíveis, seis meses velhos).

test('FII casa pelo ISIN publicado e traz o mês mais recente do ZIP', async () => {
  const { texto } = await rodar(['--dry-run', '--anos=1'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE],
    informeFii: true,
    indice: {
      'https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/': [
        'inf_mensal_fii_2025.zip',
        'inf_mensal_fii_2026.zip',
      ],
    },
  });

  assert.match(texto, /vínculo por isin/, `sem vínculo:\n${texto}`);
  assert.match(texto, /MXRF11\s+MAXI RENDA/, `MXRF11 não casou:\n${texto}`);
  assert.match(texto, /HGLG11\s+CSHG LOGISTICA/, `HGLG11 não casou:\n${texto}`);
  // O mês: janeiro está no ZIP e não pode ser o escolhido.
  assert.match(texto, /MXRF11\s+2026-07-01/, `mês errado:\n${texto}`);
  assert.ok(!/MXRF11\s+2026-01-01/.test(texto), `pegou janeiro:\n${texto}`);
  // Patrimônio e DY do mês certo, e de MEMBROS DIFERENTES do ZIP: o
  // patrimônio vem do `geral`, o DY do `complemento`. Ler um só arquivo
  // deixaria metade dos campos vazia.
  assert.match(texto, /MXRF11.*PL 1\.60bi/, `patrimônio do mês errado:\n${texto}`);
  assert.match(texto, /MXRF11.*DY 0\.85%\/mês/, `DY não veio do complemento:\n${texto}`);
  // `Percentual_Dividend_Yield_Mes` é RAZÃO, apesar do nome: 0,0085 é
  // 0,85% no mês. Lido como percentagem, o DY anual de todo FII sairia
  // ~0,1% e a classe inteira afundaria no pilar de dividendos.
  assert.match(texto, /razão, convertido para %/, `escala do DY não detetada:\n${texto}`);
  assert.match(texto, /MXRF11.*VPC 10/, `valor patrimonial da cota ausente:\n${texto}`);
  // Um FII fora do informe não pode virar casamento aproximado.
  assert.match(texto, /✗ KNRI11/, `KNRI11 devia ficar sem correspondência:\n${texto}`);
});

test('sem informe de FII o pipeline segue e diz o que faltou', async () => {
  const { texto } = await rodar(['--dry-run', '--anos=1'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE],
    informeFii: false,
  });
  assert.match(texto, /informe indisponível|informe de FII falhou/, texto);
  // As ações não podem cair junto: são pipelines independentes.
  assert.match(texto, /documentos prontos/, `o pipeline parou no FII:\n${texto}`);
});

test('a série mensal atravessa anos e alimenta DY médio e consistência', async () => {
  // Dois anos de informe, dois meses cada. O Maxi Renda pagou em três das
  // quatro competências: é o que separa "consistência" de "o último mês
  // repetido quatro vezes".
  const { texto } = await rodar(['--dry-run', '--anos=2'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE, ANO_BASE - 1],
    informeFii: true,
    indice: {
      'https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/': [
        'inf_mensal_fii_2024.zip',
        'inf_mensal_fii_2025.zip',
        'inf_mensal_fii_2026.zip',
      ],
    },
  });

  // Só os dois anos mais recentes são baixados — a janela segue `--anos`.
  assert.match(texto, /informe: inf_mensal_fii_2025\.zip, inf_mensal_fii_2026\.zip/, texto);
  // Quatro competências observadas, três pagando: 75%.
  assert.match(texto, /MXRF11[\s\S]{0,200}?série 6 meses/, `série não acumulou:\n${texto}`);
  // Quatro competências com rendimento em seis observadas.
  assert.match(texto, /pagando 66\.7% dos meses/, `consistência errada:\n${texto}`);
  // DY médio: (0,60×3 + 0 + 0 + 0,85) / 6 × 12 = 5,3% ao ano. Sem a série,
  // este indicador ficava vazio e o pilar de dividendos do FII com um
  // indicador só.
  assert.match(texto, /DY médio 5\.3%/, `DY médio errado:\n${texto}`);
  // O último mês continua descrevendo o fundo hoje — a série não o move.
  assert.match(texto, /MXRF11\s+2026-07-01/, texto);
});

test('escalas diferentes no mesmo arquivo, cada companhia com a sua', async () => {
  // O achado da execução real: a Eletrobras declara a quantidade em
  // milhares e o Banco do Brasil em unidades, no MESMO arquivo. Supor uma
  // das duas erra a outra por mil — e o erro é silencioso, com número
  // plausível. A escala tem de ser lida linha a linha.
  const { texto } = await rodar(['--dry-run', '--anos=1'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE],
  });
  assert.match(texto, /ações 2\.86bi cap/, 'a companhia em MILHARES');
  assert.match(texto, /ações 0\.80bi cap/, 'a companhia em UNIDADES, na mesma execução');
  // Com a escala aplicada, nenhuma das duas é recusada pela trava.
  assert.ok(!/contagem declarada recusada/.test(texto), `recusou uma boa:\n${texto}`);
});

test('ocupação e imóveis vêm do informe trimestral, que é quem os publica', async () => {
  // Os três membros do informe MENSAL não trazem vacância — a execução real
  // imprimiu as colunas e ali só há rubricas de balanço. Procurá-la lá
  // deixava o pilar de crescimento do FII com um indicador só.
  const { texto } = await rodar(['--dry-run', '--anos=1'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE],
    informeFii: true,
    trimestralFii: true,
    indice: {
      'https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/': ['inf_mensal_fii_2026.zip'],
      'https://dados.cvm.gov.br/dados/FII/DOC/INF_TRIMESTRAL/DADOS/': [
        'inf_trimestral_fii_2026.zip',
      ],
    },
  });
  assert.match(texto, /trimestral inf_trimestral_fii_2026\.zip: 2 fundos com imóveis/, texto);
  // 20% vago em metade da área = 10% de vacância, 90% de ocupação.
  assert.match(
    texto,
    /MXRF11.*imóveis 2 \(1 com vago\) · ocupação 90/,
    `ocupação errada:\n${texto}`
  );
  assert.match(texto, /HGLG11.*imóveis 1 \(0 com vago\) · ocupação 100/, texto);
  // Qual coluna virou vacância tem de estar no log: "ocupação 100%" na
  // carteira toda pode ser verdade ou pode ser a coluna errada.
  assert.match(texto, /vacância ← Percentual_Vacancia · área ← Area_Bruta_Locavel/, texto);
});

test('sem o trimestral o FII não morre: perde ocupação e mantém o resto', async () => {
  const { texto } = await rodar(['--dry-run', '--anos=1'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE],
    informeFii: true,
    trimestralFii: false,
    indice: {
      'https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/': ['inf_mensal_fii_2026.zip'],
    },
  });
  assert.match(texto, /informe trimestral indisponível/, texto);
  assert.match(texto, /MXRF11.*PL 1\.60bi/, `o mensal caiu junto:\n${texto}`);
  assert.match(texto, /documentos prontos/, texto);
});

test('undefined vira null antes da gravação, em vez de derrubar o lote', () => {
  // O Firestore RECUSA `undefined` e aborta o batch inteiro: um campo novo
  // que uma fonte não preencheu perderia a gravação das dezenas de
  // documentos que estavam certos. Ausente é `null` — o motor já sabe ler
  // lacuna.
  const limpo = ingest.semUndefined({
    patrimonioLiquido: 5e9,
    ocupacao: undefined,
    dyMedio36m: null,
    classe: 'fii',
  });
  assert.equal(limpo.ocupacao, null);
  assert.equal(limpo.dyMedio36m, null);
  assert.equal(limpo.patrimonioLiquido, 5e9);
  assert.equal(limpo.classe, 'fii');
  assert.ok(!Object.values(limpo).includes(undefined));
});
