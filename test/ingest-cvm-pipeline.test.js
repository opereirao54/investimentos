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

function dfpCsv(qual, ano) {
  const empresas = [
    { cnpj: CNPJ_A, cd: '1023', mult: 1 },
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
      add('3.99.01.01', 'ON', ((21000 * m * 1000) / 2850000).toFixed(4), 'UNIDADE');
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
            ['BPA_con', 'BPP_con', 'DRE_con', 'DFC_MI_con'].map((q) => [
              `dfp_cia_aberta_${q}_${ano}.csv`,
              dfpCsv(q, ano),
            ])
          )
        );
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

test('DRY-RUN não grava, e diz isso', async () => {
  const { texto, pedidos } = await rodar(['--dry-run', '--anos=1'], {
    anoFca: ANO_BASE,
    anosDfp: [ANO_BASE],
  });
  assert.match(texto, /DRY-RUN: nada foi gravado/);
  assert.ok(!pedidos.some((u) => u.includes('firestore')), 'dry-run não pode tocar o Firestore');
});
