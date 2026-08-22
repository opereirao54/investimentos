'use strict';

// Ingestão da CVM — leitura de ZIP, parse dos CSVs e cálculo dos indicadores.
//
// Esta é a camada que ESCREVE na base de produção a partir de arquivo de
// terceiro. Duas coisas podem correr mal em silêncio e as duas são cobertas
// aqui:
//
//   1. Layout mudar. Os nomes de coluna e códigos de conta da CVM já mudaram
//      de forma antes. Coluna não encontrada tem de ser reportada, nunca
//      resultar em coluna deslocada ou valor de outra conta.
//   2. Número implausível passar. Escala trocada (MIL vs unidade), conta
//      errada ou divisão por quase-zero produzem valores que parecem
//      válidos. Um ROE de 4000% gravado vira nota 10 no pilar Qualidade.
//
// Nenhum teste toca a rede: tudo opera sobre fixtures no formato documentado
// da CVM. A validação contra o arquivo REAL é o `--dry-run` do script.

const zlib = require('node:zlib');
const test = require('node:test');
const assert = require('node:assert/strict');

const { lerZip } = require('../scripts/lib/zip');
const P = require('../scripts/lib/cvm-parser');
const { casarCadastro, exercicioDaEmpresa } = require('../scripts/ingest-cvm');

// ── Construtor de ZIP para os testes ──
function zipar(arquivos, opcoes) {
  const op = opcoes || {};
  const locais = [];
  const centrais = [];
  let offset = 0;
  for (const [nome, conteudo, metodo] of arquivos) {
    const cru = Buffer.from(conteudo, 'latin1');
    const m = metodo === undefined ? 8 : metodo;
    const comp = m === 8 ? zlib.deflateRawSync(cru) : cru;
    const n = Buffer.from(nome, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(op.cifrado ? 0x1 : 0, 6);
    lh.writeUInt16LE(m, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(cru.length, 22);
    lh.writeUInt16LE(n.length, 26);
    locais.push(Buffer.concat([lh, n, comp]));
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(op.cifrado ? 0x1 : 0, 8);
    ch.writeUInt16LE(m, 10);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(op.tamanhoMentiroso ? cru.length + 99 : cru.length, 24);
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

// ════════════════════════════════════════════
// ZIP
// ════════════════════════════════════════════

test('lê entradas deflate e stored, preservando bytes latin-1', () => {
  const z = zipar([
    ['dfp_cia_aberta_BPA_con_2025.csv', 'CD_CVM;VL_CONTA\n1023;123456.00', 8],
    ['solto.txt', 'ação e çedilha', 0],
  ]);
  const e = lerZip(z);
  assert.equal(e.length, 2);
  assert.ok(e[0].dados.toString('latin1').includes('123456.00'));
  assert.equal(e[1].dados.toString('latin1'), 'ação e çedilha');
});

test('ZIP cifrado é recusado em vez de virar CSV de zero linhas', () => {
  // Bytes cifrados parseados como CSV dão "sucesso" com nenhum registro —
  // a ingestão acharia que a CVM não publicou nada naquele ano.
  const z = zipar([['x.csv', 'CD_CVM;VL_CONTA']], { cifrado: true });
  assert.throws(() => lerZip(z), /zip_entrada_cifrada/);
});

test('entrada truncada é recusada: CSV cortado perde empresas em silêncio', () => {
  const z = zipar([['x.csv', 'CD_CVM;VL_CONTA\n1023;1']], { tamanhoMentiroso: true });
  assert.throws(() => lerZip(z), /zip_tamanho_inesperado/);
});

test('buffer que não é ZIP falha alto', () => {
  // Precisa de 22+ bytes para passar do guard de tamanho e exercitar mesmo a
  // busca pelo diretório central — um HTML de erro do servidor cai aqui.
  assert.throws(
    () => lerZip(Buffer.from('<!doctype html><html><body>503 Service Unavailable</body></html>')),
    /zip_sem_diretorio_central/
  );
  assert.throws(() => lerZip(Buffer.alloc(0)), /zip_vazio_ou_invalido/);
  assert.throws(() => lerZip('não é buffer'), /zip_vazio_ou_invalido/);
});

// ════════════════════════════════════════════
// CSV
// ════════════════════════════════════════════

const CABECALHO =
  'CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA';

function linha(cdCvm, conta, descricao, valor, opts) {
  const o = opts || {};
  return [
    '00.000.000/0001-91',
    o.dtRefer || '2025-12-31',
    '1',
    o.denom || 'EMPRESA TESTE S.A.',
    cdCvm,
    'DF Consolidado',
    'REAL',
    o.escala || 'MIL',
    o.ordem || 'ÚLTIMO',
    o.fim || '2025-12-31',
    conta,
    descricao,
    String(valor),
  ].join(';');
}

test('parse do CSV respeita separador, aspas e BOM', () => {
  const csv = '﻿A;B;C\n1;"tem ; dentro";3\n"aspas ""duplas""";x;y';
  const r = P.parseCsvCvm(csv);
  assert.deepEqual(r.colunas, ['A', 'B', 'C']);
  assert.equal(r.registros[0].B, 'tem ; dentro');
  assert.equal(r.registros[1].A, 'aspas "duplas"');
});

test('linha com número de campos diferente do cabeçalho é descartada', () => {
  // Aceitar deslocaria TODAS as colunas seguintes — VL_CONTA passaria a ler
  // DS_CONTA e o valor viraria NaN ou, pior, outro número.
  const r = P.parseCsvCvm('A;B;C\n1;2;3\n1;2\n4;5;6');
  assert.equal(r.registros.length, 2);
  assert.deepEqual(
    r.registros.map((x) => x.A),
    ['1', '4']
  );
});

test('colunas são achadas por apelido, e o que falta é reportado', () => {
  const { mapa, faltando } = P.resolverColunas(
    ['CNPJ_CIA', 'Codigo_CVM', 'CD_CONTA', 'VL_CONTA'],
    ['cnpj', 'cdCvm', 'codigoConta', 'valorConta', 'escalaMoeda']
  );
  assert.equal(mapa.cdCvm, 'Codigo_CVM', 'apelido com grafia diferente tem de resolver');
  assert.deepEqual(faltando, ['escalaMoeda'], 'o que falta tem de ser nomeado, não ignorado');
});

test('conversão numérica cobre os formatos que a CVM já usou', () => {
  assert.equal(P.valorNumericoCvm('-1234567.89'), -1234567.89);
  assert.equal(P.valorNumericoCvm('1.234.567,89'), 1234567.89, 'formato pt-BR');
  assert.equal(P.valorNumericoCvm('1,234'), 1.234);
  assert.equal(P.valorNumericoCvm(''), null);
  assert.equal(P.valorNumericoCvm('-'), null);
  assert.equal(P.valorNumericoCvm('n/a'), null, 'texto não vira zero');
});

test('escala MIL é aplicada — trocar isto erra tudo por mil vezes', () => {
  const csv = `${CABECALHO}\n${linha('1023', '2.03', 'Patrimônio Líquido Consolidado', '180000.00')}`;
  const { colunas, registros } = P.parseCsvCvm(csv);
  const { mapa } = P.resolverColunas(colunas, [
    'cdCvm',
    'codigoConta',
    'descricaoConta',
    'valorConta',
    'escalaMoeda',
  ]);
  assert.equal(P.valorDaConta(registros, mapa, 'patrimonioLiquido'), 180000000);
});

test('conta é achada pela descrição quando o código não bate', () => {
  const csv = `${CABECALHO}\n${linha('1023', '9.99', 'Patrimônio Líquido Consolidado', '5000', { escala: 'UNIDADE' })}`;
  const { colunas, registros } = P.parseCsvCvm(csv);
  const { mapa } = P.resolverColunas(colunas, [
    'cdCvm',
    'codigoConta',
    'descricaoConta',
    'valorConta',
    'escalaMoeda',
  ]);
  assert.equal(
    P.valorDaConta(registros, mapa, 'patrimonioLiquido'),
    5000,
    'renumeração do plano de contas não pode zerar o indicador'
  );
});

test('exercício anterior do mesmo arquivo é ignorado', () => {
  // Cada arquivo traz ÚLTIMO e PENÚLTIMO. Misturar daria dois valores
  // diferentes para a mesma conta da mesma empresa.
  const csv = [
    CABECALHO,
    linha('1023', '2.03', 'Patrimônio Líquido Consolidado', '180000'),
    linha('1023', '2.03', 'Patrimônio Líquido Consolidado', '150000', {
      ordem: 'PENÚLTIMO',
      fim: '2024-12-31',
    }),
  ].join('\n');
  const { colunas, registros } = P.parseCsvCvm(csv);
  const { mapa } = P.resolverColunas(colunas, [
    'cdCvm',
    'dataReferencia',
    'dataFimExercicio',
    'ordemExercicio',
    'codigoConta',
    'descricaoConta',
    'valorConta',
    'escalaMoeda',
  ]);
  const grupos = P.agruparPorEmpresa(registros, mapa);
  const exercicios = grupos.get('1023');
  assert.equal(exercicios.size, 1);
  assert.equal(P.valorDaConta(exercicios.get('2025-12-31'), mapa, 'patrimonioLiquido'), 180000000);
});

// ════════════════════════════════════════════
// Extração financeira
// ════════════════════════════════════════════

const COLS_TESTE = {
  cdCvm: 'CD_CVM',
  codigoConta: 'CD_CONTA',
  descricaoConta: 'DS_CONTA',
  valorConta: 'VL_CONTA',
  escalaMoeda: 'ESCALA_MOEDA',
  ordemExercicio: 'ORDEM_EXERC',
  dataFimExercicio: 'DT_FIM_EXERC',
  dataReferencia: 'DT_REFER',
};

function bloco(linhas) {
  const csv = [CABECALHO, ...linhas].join('\n');
  return P.parseCsvCvm(csv).registros;
}

test('dívida líquida só existe se houver conta de dívida', () => {
  // Somar dois nulls como zero faria um banco alavancado aparecer como
  // empresa sem dívida — e ganhar nota 10 no pilar Endividamento.
  const semDivida = P.extrairFinanceiro(
    {
      bpp: bloco([
        linha('1', '2.03', 'Patrimônio Líquido Consolidado', '1000', { escala: 'UNIDADE' }),
      ]),
    },
    COLS_TESTE
  );
  assert.equal(semDivida.dividaBruta, null);
  assert.equal(semDivida.dividaLiquida, null, 'ausência de dado não pode virar dívida zero');

  const comDivida = P.extrairFinanceiro(
    {
      bpa: bloco([
        linha('1', '1.01.01', 'Caixa e Equivalentes de Caixa', '200', { escala: 'UNIDADE' }),
      ]),
      bpp: bloco([
        linha('1', '2.01.04', 'Empréstimos e Financiamentos', '300', { escala: 'UNIDADE' }),
        linha('1', '2.02.01', 'Empréstimos e Financiamentos', '500', { escala: 'UNIDADE' }),
      ]),
    },
    COLS_TESTE
  );
  assert.equal(comDivida.dividaBruta, 800);
  assert.equal(comDivida.dividaLiquida, 600);
});

test('EBITDA só é reconstruído quando há depreciação na DFC', () => {
  const cols = COLS_TESTE;
  const semDfc = P.extrairFinanceiro(
    {
      dre: bloco([
        linha('1', '3.05', 'Resultado Antes do Resultado Financeiro', '1000', {
          escala: 'UNIDADE',
        }),
      ]),
    },
    cols
  );
  assert.equal(semDfc.ebit, 1000);
  assert.equal(semDfc.ebitda, null, 'EBIT não é EBITDA — não pode ser servido como se fosse');

  const comDfc = P.extrairFinanceiro(
    {
      dre: bloco([
        linha('1', '3.05', 'Resultado Antes do Resultado Financeiro', '1000', {
          escala: 'UNIDADE',
        }),
      ]),
      dfc: bloco([
        linha('1', '6.01.01.02', 'Depreciação e Amortização', '-250', { escala: 'UNIDADE' }),
      ]),
    },
    cols
  );
  assert.equal(comDfc.ebitda, 1250, 'sinal da depreciação varia por emissor: usa-se o módulo');
});

// ════════════════════════════════════════════
// Indicadores
// ════════════════════════════════════════════

function exercicio(ano, over) {
  return Object.assign(
    {
      ano,
      dataReferencia: `${ano}-12-31`,
      receita: 1000,
      lucroLiquido: 100,
      patrimonioLiquido: 800,
      ativoCirculante: 500,
      passivoCirculante: 250,
      caixaTotal: 100,
      dividaBruta: 400,
      dividaLiquida: 300,
      ebit: 180,
      ebitda: 220,
      depreciacao: 40,
      ativoTotal: 2000,
      antesTributos: 150,
      tributos: -50,
    },
    over || {}
  );
}

test('indicadores básicos batem com a conta feita à mão', () => {
  const r = P.calcularIndicadores([exercicio(2025)]);
  assert.ok(Math.abs(r.indicadores.roe - 12.5) < 0.01, `ROE ${r.indicadores.roe}`);
  assert.ok(Math.abs(r.indicadores.margemLiquida - 10) < 0.01);
  assert.equal(r.indicadores.liquidezCorrente, 2);
  assert.ok(Math.abs(r.indicadores.dividaLiquidaEbitda - 1.3636) < 0.001);
  assert.ok(Math.abs(r.indicadores.dividaLiquidaPl - 0.375) < 0.001);
});

test('ROIC usa a alíquota EFETIVA da DRE quando ela é plausível', () => {
  // Tributos 50 sobre resultado 150 = 33,3%. NOPAT = 180 x (1-0,333) = 120.
  // Capital investido = 800 + 300 = 1100 -> ROIC 10,9%.
  const r = P.calcularIndicadores([exercicio(2025)]);
  assert.ok(Math.abs(r.aliquotaUsada - 0.3333) < 0.001, `alíquota ${r.aliquotaUsada}`);
  assert.ok(Math.abs(r.indicadores.roic - 10.9) < 0.1, `ROIC ${r.indicadores.roic}`);
});

test('alíquota absurda cai para a nominal em vez de distorcer o ROIC', () => {
  const r = P.calcularIndicadores([exercicio(2025, { tributos: -900, antesTributos: 150 })]);
  assert.equal(r.aliquotaUsada, P.ALIQUOTA_NOMINAL);
});

test('CAGR sai do primeiro ao último exercício', () => {
  const r = P.calcularIndicadores([
    exercicio(2021, { receita: 1000, lucroLiquido: 50 }),
    exercicio(2023, { receita: 1400, lucroLiquido: 80 }),
    exercicio(2025, { receita: 2000, lucroLiquido: 150 }),
  ]);
  // 1000 -> 2000 em 4 anos ≈ 18,92%
  assert.ok(Math.abs(r.indicadores.cagrReceita5a - 18.92) < 0.05);
  assert.equal(r.exerciciosUsados, 3);
  assert.equal(r.anosSpan, 4);
});

test('prejuízo não vira CAGR', () => {
  const r = P.calcularIndicadores([
    exercicio(2021, { lucroLiquido: -50 }),
    exercicio(2025, { lucroLiquido: 150 }),
  ]);
  assert.equal(r.indicadores.cagrLucro5a, null, 'sair do prejuízo não é taxa de crescimento');
  assert.ok(r.indicadores.cagrReceita5a !== null);
});

test('valor fora da faixa plausível é DESCARTADO com motivo', () => {
  // Sintoma típico de escala trocada: PL lido em unidade e lucro em milhares.
  const r = P.calcularIndicadores([exercicio(2025, { patrimonioLiquido: 1, lucroLiquido: 100 })]);
  assert.equal(r.indicadores.roe, null, 'ROE de 10.000% não pode ser gravado');
  assert.ok(
    r.descartados.some((d) => d.campo === 'roe' && d.motivo.includes('fora_da_faixa')),
    `descartados: ${JSON.stringify(r.descartados)}`
  );
});

test('exercício único não inventa crescimento, mas calcula o resto', () => {
  const r = P.calcularIndicadores([exercicio(2025)]);
  assert.equal(r.indicadores.cagrReceita5a, null);
  assert.ok(r.indicadores.roe !== null);
});

test('contas ausentes viram null, e os absolutos seguem para o servidor', () => {
  const r = P.calcularIndicadores([
    exercicio(2025, { ebitda: null, ativoCirculante: null, passivoCirculante: null }),
  ]);
  assert.equal(r.indicadores.dividaLiquidaEbitda, null);
  assert.equal(r.indicadores.liquidezCorrente, null, 'banco não tem circulante — e isso é correto');
  assert.equal(r.absolutos.patrimonioLiquido, 800, 'P/L e P/VP saem daqui, cruzados com a cotação');
  assert.equal(r.absolutos.lucroLiquido, 100);
});

// ════════════════════════════════════════════
// Informe de FII
// ════════════════════════════════════════════

test('informe de FII: vacância vira ocupação e o mais recente vence', () => {
  const csv = [
    'CNPJ_Fundo;Data_Referencia;Patrimonio_Liquido;Total_Numero_Cotistas;Percentual_Vacancia_Financeira',
    '11.111.111/0001-11;2026-06-30;3000000000;250000;12.0',
    '11.111.111/0001-11;2026-07-31;3200000000;300000;4.0',
    // Reenvio fora de ordem: a ordem do arquivo não decide qual é o último.
    '11.111.111/0001-11;2026-05-31;2900000000;240000;15.0',
  ].join('\n');
  const { colunas, registros } = P.parseCsvCvm(csv);
  const { porCnpj, faltando } = P.extrairInformeFii(registros, colunas);
  const fii = porCnpj.get('11111111000111');
  assert.equal(fii.dataReferencia, '2026-07-31', 'vence a data, não a posição no arquivo');
  assert.equal(fii.numeroCotistas, 300000);
  assert.equal(fii.ocupacao, 96, 'o motor pontua ocupação; a CVM publica vacância');
  assert.equal(fii.vacancia, 4);
  assert.ok(faltando.includes('numeroImoveis'), 'campo ausente tem de ser reportado');
});

test('informe de FII sem coluna de CNPJ não devolve dado nenhum', () => {
  const { colunas, registros } = P.parseCsvCvm('A;B\n1;2');
  const r = P.extrairInformeFii(registros, colunas);
  assert.equal(r.porCnpj.size, 0);
  assert.deepEqual(r.faltando, ['cnpj']);
});

test('CNPJ malformado é ignorado em vez de virar chave inválida', () => {
  const csv =
    'CNPJ_Fundo;Data_Referencia;Patrimonio_Liquido\n123;2026-07-31;100\n11.111.111/0001-11;2026-07-31;200';
  const { colunas, registros } = P.parseCsvCvm(csv);
  const { porCnpj } = P.extrairInformeFii(registros, colunas);
  assert.equal(porCnpj.size, 1);
  assert.ok(porCnpj.has('11111111000111'));
});

// ════════════════════════════════════════════
// Casamento ticker -> empresa
// ════════════════════════════════════════════

const CADASTRO = P.parseCsvCvm(
  [
    'CD_CVM;DENOM_SOCIAL',
    '1023;BANCO DO BRASIL SA',
    '9999;BANCO DO BRASIL SEGURIDADE PARTICIPACOES SA',
    '5410;WEG SA',
    '4170;VALE SA',
  ].join('\n')
);

test('correspondência exata vence a parcial mais longa', () => {
  const r = casarCadastro(CADASTRO, { WEGE3: { denominacao: 'WEG SA' } }, 'DENOM_SOCIAL', 'CD_CVM');
  assert.equal(r[0].status, 'ok');
  assert.equal(r[0].chave, '5410');
});

test('mais de um candidato sem correspondência exata é marcado como ambíguo', () => {
  // Casar com a empresa errada é o pior resultado possível: os indicadores
  // ficam plausíveis e apontam para outra companhia. Melhor pular e reportar.
  const r = casarCadastro(
    CADASTRO,
    { BBAS3: { denominacao: 'BANCO DO BRASIL' } },
    'DENOM_SOCIAL',
    'CD_CVM'
  );
  assert.equal(r[0].status, 'ambiguo');
  assert.equal(r[0].alternativas.length, 2, 'as alternativas têm de aparecer para revisão humana');
});

test('ticker sem correspondência é reportado, não silenciado', () => {
  const r = casarCadastro(
    CADASTRO,
    { XPTO3: { denominacao: 'EMPRESA INEXISTENTE' } },
    'DENOM_SOCIAL',
    'CD_CVM'
  );
  assert.equal(r[0].status, 'sem_correspondencia');
  assert.equal(r[0].chave, undefined);
});

test('exercicioDaEmpresa isola a empresa certa dentro do arquivo do ano', () => {
  const csvs = {
    BPP_con: P.parseCsvCvm(
      [
        CABECALHO,
        linha('1023', '2.03', 'Patrimônio Líquido Consolidado', '180000'),
        linha('5410', '2.03', 'Patrimônio Líquido Consolidado', '25000'),
      ].join('\n')
    ),
  };
  const ex = exercicioDaEmpresa(csvs, COLS_TESTE, '5410', 2025);
  assert.equal(ex.patrimonioLiquido, 25000000, 'não pode pegar a linha da outra empresa');
  assert.equal(ex.ano, 2025);
  assert.equal(exercicioDaEmpresa(csvs, COLS_TESTE, '0000', 2025), null);
});

test('o mapa de tickers cobre o universo padrão da carteira modelo', () => {
  const mapa = require('../scripts/lib/mapa-cvm.json');
  for (const t of ['BBAS3', 'WEGE3', 'EGIE3']) {
    assert.ok(mapa.acoes[t], `${t} está na carteira modelo padrão e precisa estar no mapa`);
  }
  for (const t of ['MXRF11', 'BTLG11', 'HGLG11']) {
    assert.ok(mapa.fiis[t], `${t} está na carteira modelo padrão e precisa estar no mapa`);
  }
  // ETF e cripto não têm demonstração na CVM: têm de estar marcados, para
  // não aparecerem como "falha de casamento" a cada execução.
  assert.ok(mapa.semFonteCvm.tickers.includes('BOVA11'));
  assert.ok(mapa.semFonteCvm.tickers.includes('BTC'));
});

// ════════════════════════════════════════════
// Descoberta do universo pelo FCA
// ════════════════════════════════════════════
//
// É o que substitui a lista escrita à mão. Duas coisas têm de estar certas:
// o vínculo ticker ↔ CD_CVM (errado, os indicadores de uma empresa acabam
// noutra) e o que NÃO é ação ficar de fora (debênture pontuada com critérios
// de renda variável seria absurdo).

test('FCA devolve o vínculo oficial ticker → CD_CVM', () => {
  const csv = [
    'CD_CVM;Codigo_Negociacao;Valor_Mobiliario;Mercado;Data_Referencia',
    '1023;BBAS3;Ações Ordinárias;Bolsa;2025-12-31',
    '5410;WEGE3;Ações Ordinárias;Bolsa;2025-12-31',
  ].join('\n');
  const { colunas, registros } = P.parseCsvCvm(csv);
  const { porTicker, faltando } = P.extrairTickersFca(registros, colunas);
  assert.equal(porTicker.get('BBAS3').cdCvm, '1023');
  assert.equal(porTicker.get('WEGE3').cdCvm, '5410');
  assert.ok(!faltando.includes('cdCvm'));
});

test('uma companhia com vários tickers gera todos', () => {
  // ON e PN da mesma empresa dividem a mesma demonstração.
  const csv = [
    'CD_CVM;Codigo_Negociacao;Valor_Mobiliario',
    '9512;PETR3, PETR4;Ações Ordinárias',
  ].join('\n');
  const { colunas, registros } = P.parseCsvCvm(csv);
  const { porTicker } = P.extrairTickersFca(registros, colunas);
  assert.equal(porTicker.get('PETR3').cdCvm, '9512');
  assert.equal(porTicker.get('PETR4').cdCvm, '9512');
});

test('debênture, bônus e opção ficam fora do universo de ações', () => {
  const csv = [
    'CD_CVM;Codigo_Negociacao;Valor_Mobiliario',
    '1111;AAAA1;Debêntures',
    '2222;BBBB2;Bônus de Subscrição',
    '3333;CCCC3;Ações Ordinárias',
  ].join('\n');
  const { colunas, registros } = P.parseCsvCvm(csv);
  const { porTicker } = P.extrairTickersFca(registros, colunas);
  assert.deepEqual(Array.from(porTicker.keys()), ['CCCC3']);
});

test('espécie desconhecida passa: o filtro exclui, não exige vocabulário', () => {
  // A CVM pode renomear "Unit" para outra coisa; recusar o que não está numa
  // lista fechada apagaria ativos válidos a cada mudança de nomenclatura.
  const csv = 'CD_CVM;Codigo_Negociacao;Valor_Mobiliario\n4444;DDDD4;Categoria Nova Qualquer';
  const { colunas, registros } = P.parseCsvCvm(csv);
  const { porTicker } = P.extrairTickersFca(registros, colunas);
  assert.ok(porTicker.has('DDDD4'));
});

test('código que não tem forma de ticker da B3 é ignorado', () => {
  const csv = [
    'CD_CVM;Codigo_Negociacao;Valor_Mobiliario',
    '1;lixo;Ações Ordinárias',
    '2;TOOLONG123;Ações Ordinárias',
    '3;AB1;Ações Ordinárias',
    '4;VALE3;Ações Ordinárias',
  ].join('\n');
  const { colunas, registros } = P.parseCsvCvm(csv);
  const { porTicker } = P.extrairTickersFca(registros, colunas);
  assert.deepEqual(Array.from(porTicker.keys()), ['VALE3']);
});

test('sem a coluna de código de negociação, o FCA não devolve nada', () => {
  // Melhor universo vazio (que faz o script cair para o mapa manual) do que
  // universo montado a partir de uma coluna que não é o ticker.
  const { colunas, registros } = P.parseCsvCvm('CD_CVM;Outra\n1;X');
  const r = P.extrairTickersFca(registros, colunas);
  assert.equal(r.porTicker.size, 0);
  assert.ok(r.faltando.includes('codigoNegociacao'));
});

test('exercício mais recente do FCA vence quando o ticker se repete', () => {
  const csv = [
    'CD_CVM;Codigo_Negociacao;Valor_Mobiliario;Data_Referencia',
    '111;ABCD3;Ações Ordinárias;2023-12-31',
    '222;ABCD3;Ações Ordinárias;2025-12-31',
  ].join('\n');
  const { colunas, registros } = P.parseCsvCvm(csv);
  const { porTicker } = P.extrairTickersFca(registros, colunas);
  assert.equal(porTicker.get('ABCD3').cdCvm, '222', 'empresa que hoje usa o código é a que vale');
});

test('cotação do universo pela BRAPI, quando há token', async () => {
  const { baixarCotacoes } = require('../scripts/ingest-cvm');
  const original = globalThis.fetch;
  const tokenAntes = process.env.BRAPI_TOKEN;
  process.env.BRAPI_TOKEN = 'token-de-teste';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      results: [
        {
          symbol: 'bbas3',
          longName: 'Banco do Brasil S.A.',
          regularMarketPrice: 28.5,
          regularMarketVolume: 2000000,
          marketCap: 160e9,
        },
        { symbol: 'SEMPRECO3', longName: 'Sem preço', marketCap: 1e9 },
      ],
    }),
  });
  try {
    const r = await baixarCotacoes(['BBAS3', 'SEMPRECO3']);
    assert.equal(r.BBAS3.liquidezDiaria, 2000000 * 28.5, 'liquidez é volume x preço, não volume');
    assert.equal(r.BBAS3.marketCap, 160e9, 'valor de mercado é o que permite P/L e P/VP');
    assert.equal(r.BBAS3.ticker, 'BBAS3');
    assert.equal(r.SEMPRECO3.liquidezDiaria, null, 'sem preço não há liquidez calculável');
  } finally {
    globalThis.fetch = original;
    if (tokenAntes === undefined) delete process.env.BRAPI_TOKEN;
    else process.env.BRAPI_TOKEN = tokenAntes;
  }
});

test('sem token, o job cota pelo Yahoo em vez de desistir', async () => {
  // O dono não quer registar-se na BRAPI. O v8/chart não pede autenticação
  // nenhuma, e o runner do GitHub não sofre o limite de IP da Vercel.
  const { baixarCotacoes } = require('../scripts/ingest-cvm');
  const original = globalThis.fetch;
  const tokenAntes = process.env.BRAPI_TOKEN;
  delete process.env.BRAPI_TOKEN;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('finance/chart'), 'sem token tem de ir para o Yahoo');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        chart: {
          result: [
            {
              meta: { regularMarketPrice: 28.5, chartPreviousClose: 28, currency: 'BRL' },
              indicators: { quote: [{ volume: [1000, 2000000] }] },
            },
          ],
        },
      }),
    };
  };
  try {
    const r = await baixarCotacoes(['BBAS3']);
    assert.equal(r.BBAS3.preco, 28.5);
    assert.equal(
      r.BBAS3.liquidezDiaria,
      2000000 * 28.5,
      'volume vem da série quando falta no meta'
    );
    assert.ok(r.BBAS3.fonteRotulo.includes('Yahoo'), 'a procedência tem de dizer a fonte real');
  } finally {
    globalThis.fetch = original;
    if (tokenAntes !== undefined) process.env.BRAPI_TOKEN = tokenAntes;
  }
});

test('lote de cotação que falha não derruba os outros', async () => {
  const { baixarCotacoes } = require('../scripts/ingest-cvm');
  const original = globalThis.fetch;
  const tokenAntes = process.env.BRAPI_TOKEN;
  process.env.BRAPI_TOKEN = 'token-de-teste';
  let chamada = 0;
  globalThis.fetch = async () => {
    chamada++;
    if (chamada === 1) throw new Error('rede');
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: [{ symbol: 'OK3', regularMarketPrice: 10 }] }),
    };
  };
  try {
    const tickers = [];
    for (let i = 0; i < 25; i++) tickers.push(`T${i}`);
    const r = await baixarCotacoes(tickers);
    assert.ok(r.OK3, 'o segundo lote tem de ser aproveitado mesmo com o primeiro falhando');
  } finally {
    globalThis.fetch = original;
    if (tokenAntes === undefined) delete process.env.BRAPI_TOKEN;
    else process.env.BRAPI_TOKEN = tokenAntes;
  }
});
