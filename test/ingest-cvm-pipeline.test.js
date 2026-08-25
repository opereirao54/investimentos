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

// O cabeçalho REAL, copiado do log da execução contra a CVM. Ele não tem
// escala, não tem CD_CVM, e a tesouraria chama-se TESOURO — não TESOURARIA.
// O fixture acima inventava um arquivo mais generoso do que o publicado, e é
// por isso que a suíte passava enquanto a Eletrobras saía sem contagem: um
// fixture mais fácil que a realidade não testa a realidade.
const CAB_CAPITAL_REAL =
  'CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;QT_ACAO_ORDIN_CAP_INTEGR;QT_ACAO_PREF_CAP_INTEGR;QT_ACAO_TOTAL_CAP_INTEGR;QT_ACAO_ORDIN_TESOURO;QT_ACAO_PREF_TESOURO;QT_ACAO_TOTAL_TESOURO';

function capitalCsv(ano, opcoes) {
  const op = opcoes || {};
  // As DUAS escalas no MESMO arquivo, como na CVM de verdade: a Eletrobras
  // declara em milhares (2.028.544 = 2,03 bi) e o Banco do Brasil em
  // unidades. Ignorar a escala fazia a primeira sair mil vezes menor, com
  // um número plausível e sem erro nenhum.
  //
  // O cenário "real" reproduz o arquivo publicado: SEM coluna de escala, com
  // os números da Eletrobras em milhares (2.027.011 ON + 280.088 PN = 2,31 bi
  // de ações de facto). Lido em unidades dá 2,31 M para um patrimônio de
  // bilhões — R$ 51 mil por ação. É o defeito que a execução real expôs, e
  // quem tem de desfazê-lo é a conferência contra o patrimônio.
  if (op.semEscala) {
    return [
      CAB_CAPITAL_REAL,
      `${CNPJ_A};${ano}-12-31;1;COMPANHIA TESTE S.A.;2027011;280088;2307099;0;0;0`,
      `${CNPJ_B};${ano}-12-31;1;COMPANHIA TESTE S.A.;800000000;0;800000000;0;0;0`,
    ].join('\n');
  }
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

function informeGeral(competencia, opcoes) {
  const op = opcoes || {};
  const recente = competencia === '202607';
  const data = dataDa(competencia);
  return [
    'CNPJ_Fundo;Data_Referencia;Nome_Fundo;Codigo_ISIN;Patrimonio_Liquido;Cotas_Emitidas;Total_Numero_Cotistas',
    `${CNPJ_MXRF};${data};MAXI RENDA FUNDO DE INVESTIMENTO IMOBILIARIO;BRMXRFCTF004;${recente ? '1600000000' : '1500000000'};${recente ? '160000000' : '150000000'};${recente ? '480000' : '450000'}`,
    `${CNPJ_HGLG};${data};CSHG LOGISTICA - FII;BRHGLGCTF003;4000000000;30000000;120000`,
    // DOIS fundos com a mesma raiz de ISIN, como o Peninsula e o XP Malls
    // partilham a raiz XPML no arquivo real. Fica atrás de uma opção para não
    // tornar ambíguo um ticker que os outros testes usam: casar com o errado
    // publicaria os indicadores de um fundo sob o ticker de outro, e é esse
    // o caso que precisa de garantia própria.
    ...(op.fiiAmbiguo
      ? [
          `33.333.333/0001-33;${data};XP MALLS FII;BRXPMLCTF001;3000000000;25000000;300000`,
          `44.444.444/0001-44;${data};PENINSULA FII RL;BRXPMLCTF999;90000000;900000;900`,
        ]
      : []),
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
    'CNPJ_Fundo;Data_Referencia;Valor_Patrimonial_Cotas;Percentual_Dividend_Yield_Mes;Valor_Ativo',
    `${CNPJ_MXRF};${data};10,00;${dyMxrf};2000000000`,
    `${CNPJ_HGLG};${data};133,33;0,0075;4200000000`,
  ].join('\n');
}

function informeZip(ano, opcoes) {
  const op = opcoes || {};
  const meses = ['01', '04', '07'];
  const membros = [];
  // Fora de ordem de propósito: quem escolhe o mês é a data de referência,
  // não a ordem do arquivo.
  for (const mes of meses.slice().reverse()) {
    membros.push([`inf_mensal_fii_geral_${ano}${mes}.csv`, informeGeral(`${ano}${mes}`, op)]);
  }
  for (const mes of meses) {
    membros.push([
      `inf_mensal_fii_complemento_${ano}${mes}.csv`,
      informeComplemento(`${ano}${mes}`),
    ]);
    // As obrigações moram noutro membro que não o do ativo: é a junção
    // deles que dá o LTV.
    membros.push([
      `inf_mensal_fii_ativo_passivo_${ano}${mes}.csv`,
      [
        'CNPJ_Fundo_Classe;Data_Referencia;Obrigacoes_Aquisicao_Imoveis;Obrigacoes_Securitizacao_Recebiveis;Rendimentos_Distribuir;Total_Passivo',
        `${CNPJ_MXRF};${dataDa(`${ano}${mes}`)};200000000;100000000;15000000;315000000`,
        `${CNPJ_HGLG};${dataDa(`${ano}${mes}`)};0;0;40000000;40000000`,
      ].join('\n'),
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
                // Os dois cenários precisam da companhia GRANDE: é o
                // patrimônio de dezenas de bilhões que torna a contagem
                // minúscula detectável. Com 0,2 bi de patrimônio, 2,3 M de
                // ações dá R$ 87 por ação — plausível, e nada a denunciaria.
                dfpCsv(q, ano, { absurdo: op.capitalAbsurdo || op.capitalSemEscala }),
              ])
              .concat([
                [
                  `dfp_cia_aberta_composicao_capital_${ano}.csv`,
                  capitalCsv(ano, { absurdo: op.capitalAbsurdo, semEscala: op.capitalSemEscala }),
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
                'CNPJ_Fundo_Classe;Data_Referencia;Versao;Area;Percentual_Locado',
                // Razão, como os outros campos "Percentual_" da CVM. E a
                // versão 1 do mesmo trimestre não pode somar com a 2.
                `${CNPJ_MXRF};2026-06-30;2;10000;1,00`,
                `${CNPJ_MXRF};2026-06-30;2;10000;0,80`,
                `${CNPJ_MXRF};2026-06-30;1;10000;0,10`,
                `${CNPJ_HGLG};2026-06-30;1;100000;1,00`,
              ].join('\n'),
            ],
          ])
        );
      }
      if (u.includes('/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_')) {
        if (!op.informeFii) return naoAchado;
        const ano = u.match(/inf_mensal_fii_(\d{4})\.zip/);
        if (!ano) return naoAchado;
        return responder(informeZip(ano[1], { fiiAmbiguo: op.fiiAmbiguo }));
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

test('a conferência pelo patrimônio decide a unidade da contagem', () => {
  // O patrimônio NÃO passou pela contagem de ações, e é por isso que pode
  // arbitrá-la. Os quatro casos que importam, com os números que a execução
  // real produziu.
  const P = require('../scripts/lib/cvm-parser.js');

  // Banco do Brasil: 2,87 bi de ações para 193,6 bi de patrimônio, em
  // unidades. R$ 67 por ação — não se mexe.
  const bb = P.conciliarContagemComPatrimonio(2.87e9, 193.6e9);
  assert.equal(bb.fator, 1);
  assert.equal(bb.acoes, 2.87e9);

  // Eletrobras: 2.307.099 declarados para 118,5 bi. Em unidades dá R$ 51.364
  // por ação, que não existe na B3; em milhares dá R$ 51,4, que é o valor
  // real. Só uma das leituras sobrevive.
  const elet = P.conciliarContagemComPatrimonio(2307099, 118.5e9);
  assert.equal(elet.fator, 1000);
  assert.equal(elet.acoes, 2307099000);
  assert.ok(elet.vpa > 40 && elet.vpa < 60, `VPA fora do esperado: ${elet.vpa}`);

  // Companhia diluída, VPA de centavos: existe de verdade, e NÃO se corrige.
  // Multiplicar aqui inventaria mil vezes menos ações numa empresa que já
  // está mal — o erro que a correção de mão única existe para não cometer.
  const diluida = P.conciliarContagemComPatrimonio(5e9, 1.5e8);
  assert.equal(diluida.fator, 1);
  assert.equal(diluida.acoes, 5e9);

  // Nem uma leitura nem outra: recusa, e a derivação por LPA assume.
  const impossivel = P.conciliarContagemComPatrimonio(150000, 196e12);
  assert.equal(impossivel.acoes, null);
  assert.equal(impossivel.motivo, 'fora_de_faixa');
});

test('contagem em milhares é reconhecida pelo patrimônio, não recusada', async () => {
  // O arquivo real da CVM não declara escala nenhuma, e as companhias não
  // usam a mesma: a Eletrobras publica 2.027.011 ON querendo dizer 2,03 bi.
  // Lido em unidades isso dá R$ 51 mil por ação — impossível na B3 — e a
  // execução real recusava a contagem e perdia a valuation da companhia.
  //
  // Recusar era melhor do que publicar o número errado, mas continua sendo
  // uma lacuna. O patrimônio, que não passou pela contagem, diz qual das
  // duas leituras existe no mundo real, e só uma delas existe.
  const { texto } = await rodar(['--dry-run', '--anos=1'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE],
    capitalSemEscala: true,
  });
  assert.match(texto, /contagem declarada em milhares/, `não reconheceu a escala:\n${texto}`);
  assert.match(texto, /ações 2\.31bi cap/, `contagem corrigida ausente:\n${texto}`);
  // A correção não pode passar calada: o log mostra as duas leituras lado a
  // lado, para que quem confere veja POR QUE uma foi escolhida.
  assert.match(texto, /a 1× daria R\$ \d{4,}/, `o log não mostra a leitura descartada:\n${texto}`);
  assert.ok(!/contagem declarada recusada/.test(texto), `recusou uma corrigível:\n${texto}`);
});

test('a coluna de tesouraria do arquivo real chama-se TESOURO, e é lida', async () => {
  // O mapa só conhecia `TESOURARIA`, que a CVM não usa. Toda companhia saía
  // com tesouraria zero — indistinguível de quem de facto não tem nenhuma —
  // e as ações em circulação vinham infladas, com elas o valor de mercado.
  const P = require('../scripts/lib/cvm-parser.js');
  const csv = P.parseCsvCvm(
    [
      CAB_CAPITAL_REAL,
      `${CNPJ_A};${ANO_BASE}-12-31;1;COMPANHIA TESTE S.A.;1000000000;0;1000000000;40000000;0;40000000`,
    ].join('\n')
  );
  const cap = P.extrairComposicaoCapital(csv.registros, csv.colunas);
  assert.ok(
    !cap.faltando.includes('ordinariasTesouraria'),
    `coluna de tesouraria não resolvida: ${cap.faltando.join(', ')}`
  );
  const reg = cap.porChave.get('cnpj:' + CNPJ_A.replace(/\D/g, ''));
  assert.equal(reg.acoesTesouraria, 40000000);
  assert.equal(reg.acoesEmCirculacao, 960000000, 'a tesouraria tem de sair da circulação');
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
    /MXRF11.*imóveis 2 \(1 com vago · cobertura área 100% · contagem 100%\) · ocupação 90/,
    `ocupação errada:\n${texto}`
  );
  assert.match(
    texto,
    /HGLG11.*imóveis 1 \(0 com vago · cobertura área 100% · contagem 100%\) · ocupação 100/,
    texto
  );
  // Qual coluna virou ocupação, e em que escala, tem de estar no log:
  // "ocupação 100%" na carteira toda pode ser verdade ou pode ser a coluna
  // errada, e o resultado final não separa as duas.
  assert.match(texto, /locado 4 val\., mediana 1 → razão ×100/, texto);
  // A versão 1 do mesmo trimestre existe no fixture e não pode entrar: três
  // imóveis em vez de dois seria a carteira duplicada pela correção.
  assert.ok(!/MXRF11.*imóveis 3/.test(texto), `versão antiga somou:\n${texto}`);
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

test('ticker ambíguo não recebe os indicadores do fundo errado', async () => {
  // O XPML11 partilha a raiz de ISIN com o Peninsula FII, e os dois declaram
  // negociação em bolsa: o desempate atual não os separa. A garantia que
  // importa comercialmente não é acertar o desempate — é NUNCA publicar os
  // indicadores de um fundo sob o ticker de outro.
  const { texto, documentos } = await rodar(['--dry-run', '--anos=1'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE],
    informeFii: true,
    fiiAmbiguo: true,
    indice: {
      'https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/': ['inf_mensal_fii_2026.zip'],
    },
  });
  const xpml = (documentos || []).find((d) => d.ticker === 'XPML11');
  assert.equal(xpml, undefined, `XPML11 não podia ter documento:\n${texto}`);
  // E o log tem de descrever a DECISÃO, não o candidato que venceu a
  // ordenação interna: "? XPML11 PENINSULA FII RL" lê-se como "casou com o
  // Peninsula", quando o que aconteceu foi "recusou casar".
  assert.match(texto, /XPML11\s+— não casado/, `o log não diz que recusou:\n${texto}`);
  assert.ok(
    !/XPML11\s+PENINSULA/.test(texto),
    `o log ainda sugere que o XPML11 casou com o Peninsula:\n${texto}`
  );
  // Os dois candidatos continuam impressos: sem eles ninguém sabe se falta
  // critério de desempate ou se a raiz está partilhada por engano.
  assert.match(texto, /candidato 33333333000133/, `candidatos ausentes:\n${texto}`);
  assert.match(texto, /candidato 44444444000144/, `candidatos ausentes:\n${texto}`);
});

test('LTV do FII junta o ativo de um membro com as obrigações de outro', async () => {
  // O pilar Endividamento do FII tem UM indicador. Vazio, o pilar inteiro
  // some e a cobertura da classe cai abaixo do piso de score.
  const { texto } = await rodar(['--dry-run', '--anos=1'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE],
    informeFii: true,
    indice: {
      'https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/': ['inf_mensal_fii_2026.zip'],
    },
  });
  // Ancorado na DATA, não só no ticker: o ticker também aparece na lista de
  // vínculos acima, e uma janela larga o bastante para o bloco de
  // indicadores deixaria a asserção casar a partir da linha errada.
  // (200M aquisição + 100M securitização) / 2.000M de ativo = 15%.
  assert.match(texto, /MXRF11\s+2026-07-01[\s\S]{0,300}?LTV 15%/, `LTV errado:\n${texto}`);
  // Sem obrigação declarada é 0%, não lacuna: o fundo não tem essa dívida,
  // e tratá-lo como "não sei" penalizaria justamente quem não se alavanca.
  // Rendimentos a distribuir estão no passivo e NÃO entram na conta.
  assert.match(
    texto,
    /HGLG11\s+2026-07-01[\s\S]{0,300}?LTV 0%/,
    `LTV do fundo sem dívida:\n${texto}`
  );
});
