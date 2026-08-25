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
const { casarCadastro, chavesDaEmpresa, exercicioDaEmpresa } = require('../scripts/ingest-cvm');

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
    o.cnpj || '00.000.000/0001-91',
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
  const exercicios = grupos.get('cd:1023');
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
  // Campo que ESTE membro deveria ter e não tem: reportado.
  assert.ok(faltando.includes('numeroCotas'), 'campo ausente tem de ser reportado');
  // Vacância e imóveis moram noutro membro do ZIP. Acusá-los aqui gerava
  // quatro "não encontrados" a cada execução — ruído que compete com falha
  // de verdade no mesmo relatório.
  assert.ok(!faltando.includes('numeroImoveis'), 'não é ausência: é outro arquivo');
  assert.ok(!faltando.includes('vacanciaFisica'));
});

// ════════════════════════════════════════════
// Composição do capital
// ════════════════════════════════════════════
//
// A quantidade de ações vem DECLARADA num arquivo do ZIP da DFP que o job
// baixava sem ler. Substitui `lucro ÷ LPA`, que não separa ON de PN quando
// as classes têm lucro por ação diferente — e era isso que deixava a
// valuation em 5 de 14 companhias na execução real.

const CAB_CAPITAL =
  'CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;DT_FIM_EXERC;QT_ACAO_ORDIN_CAP_INTEGR;QT_ACAO_PREF_CAP_INTEGR;QT_ACAO_ORDIN_TESOURARIA;QT_ACAO_PREF_TESOURARIA';

function capitalCsv(linhas) {
  return P.parseCsvCvm([CAB_CAPITAL, ...linhas].join('\n'));
}

test('ações em circulação: ON mais PN, menos tesouraria', () => {
  // Tesouraria descontada porque o valor de mercado é preço × o que está em
  // circulação. Ignorá-la infla o valor de mercado — e, com ele, o P/L e o
  // P/VP — de toda companhia que recompra ação.
  const { colunas, registros } = capitalCsv([
    '00.000.000/0001-91;2025-12-31;1;EMPRESA TESTE;1023;2025-12-31;2000000000;900000000;50000000;10000000',
  ]);
  const r = P.extrairComposicaoCapital(registros, colunas);
  const c = r.porChave.get('cnpj:00000000000191');
  assert.equal(c.acoesOrdinarias, 2000000000);
  assert.equal(c.acoesPreferenciais, 900000000);
  assert.equal(c.acoesTesouraria, 60000000);
  assert.equal(c.acoesEmCirculacao, 2840000000);
  // Indexada pelas duas identificações, como o resto do pipeline.
  assert.equal(r.porChave.get('cd:1023').acoesEmCirculacao, 2840000000);
});

test('sem preferenciais, o total é só o ordinário', () => {
  const { colunas, registros } = capitalCsv([
    '00.000.000/0001-91;2025-12-31;1;EMPRESA TESTE;1023;2025-12-31;500000000;;;',
  ]);
  const c = P.extrairComposicaoCapital(registros, colunas).porChave.get('cd:1023');
  assert.equal(c.acoesEmCirculacao, 500000000, 'coluna vazia é zero, não quebra a conta');
});

test('reenvio fora de ordem: vence a data, não a posição', () => {
  const { colunas, registros } = capitalCsv([
    '00.000.000/0001-91;2025-12-31;1;EMPRESA TESTE;1023;2025-12-31;2000000000;0;0;0',
    '00.000.000/0001-91;2024-12-31;1;EMPRESA TESTE;1023;2024-12-31;1000000000;0;0;0',
  ]);
  const c = P.extrairComposicaoCapital(registros, colunas).porChave.get('cd:1023');
  assert.equal(c.acoesEmCirculacao, 2000000000);
});

test('linha com contagem implausível é ignorada', () => {
  // Companhia aberta não tem trezentas ações. Linha assim é de outra
  // natureza — e viraria um valor de mercado absurdo.
  const { colunas, registros } = capitalCsv([
    '00.000.000/0001-91;2025-12-31;1;EMPRESA TESTE;1023;2025-12-31;300;0;0;0',
  ]);
  assert.equal(P.extrairComposicaoCapital(registros, colunas).porChave.size, 0);
});

test('colunas ausentes reportam o que havia no arquivo', () => {
  const { colunas, registros } = P.parseCsvCvm('OUTRA;COISA\n1;2');
  const r = P.extrairComposicaoCapital(registros, colunas);
  assert.equal(r.porChave.size, 0);
  assert.ok(r.faltando.includes('ordinarias'));
  assert.deepEqual(r.colunasReais, ['OUTRA', 'COISA']);
});

test('o DY do FII vem calculado pela CVM, não é derivado', () => {
  // `Percentual_Dividend_Yield_Mes` está no informe. É o indicador mais
  // importante do pilar de dividendos de um FII, e vem da fonte oficial —
  // não há o que derivar nem o que supor.
  const csv = [
    'CNPJ_Fundo_Classe;Data_Referencia;Patrimonio_Liquido;Cotas_Emitidas;Percentual_Dividend_Yield_Mes',
    '11.111.111/0001-11;2026-07-31;3200000000;30000000;0.85',
  ].join('\n');
  const { colunas, registros } = P.parseCsvCvm(csv);
  const fii = P.extrairInformeFii(registros, colunas).porCnpj.get('11111111000111');
  assert.equal(fii.dyMes, 0.85);
  assert.ok(Math.abs(fii.dy - 10.2) < 1e-9, 'doze meses do mesmo patamar');
  assert.equal(fii.numeroCotas, 30000000, 'o arquivo chama de Cotas_Emitidas');
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
  const ex = exercicioDaEmpresa(csvs, COLS_TESTE, 'cd:5410', 2025);
  assert.equal(ex.patrimonioLiquido, 25000000, 'não pode pegar a linha da outra empresa');
  assert.equal(ex.ano, 2025);
  assert.equal(exercicioDaEmpresa(csvs, COLS_TESTE, 'cd:0000', 2025), null);
});

// ════════════════════════════════════════════
// Junção por CNPJ
// ════════════════════════════════════════════
//
// A primeira execução real do pipeline devolveu "0 tickers" no FCA e
// "0 companhias com dados" na DFP — com o arquivo certo aberto e as
// colunas todas resolvidas. A causa: o FCA identifica a companhia por
// CNPJ_Companhia e nunca teve CD_CVM. Os testes abaixo existem para que
// esse silêncio não volte: cada um falha se a junção voltar a depender de
// uma identificação que o arquivo do outro lado não tem.

test('FCA sem CD_CVM ainda devolve o universo, pelo CNPJ', () => {
  const csv = [
    'CNPJ_Companhia;Codigo_Negociacao;Valor_Mobiliario;Mercado;Data_Referencia',
    '00.000.000/0001-91;BBAS3;Ações Ordinárias;Bolsa;2025-12-31',
  ].join('\n');
  const { colunas, registros } = P.parseCsvCvm(csv);
  const { porTicker, faltando } = P.extrairTickersFca(registros, colunas);
  assert.equal(porTicker.size, 1, 'exigir CD_CVM zerava o universo inteiro');
  assert.equal(porTicker.get('BBAS3').cnpj, '00000000000191');
  assert.equal(porTicker.get('BBAS3').cdCvm, null);
  assert.ok(faltando.includes('cdCvm'), 'a coluna ausente continua reportada');
});

test('CNPJ formatado e cru são a MESMA chave', () => {
  // O FCA traz com pontuação, a DFP às vezes sem. Comparar como texto
  // separaria a companhia dela mesma.
  assert.equal(P.normalizarCnpj('00.000.000/0001-91'), '00000000000191');
  assert.equal(P.normalizarCnpj('00000000000191'), '00000000000191');
  assert.equal(P.normalizarCnpj('123'), null, 'CNPJ truncado não vira chave');
  assert.equal(P.normalizarCnpj(''), null);
});

test('CD_CVM com e sem zeros à esquerda é a MESMA chave', () => {
  assert.equal(P.normalizarCdCvm('001023'), '1023');
  assert.equal(P.normalizarCdCvm('1023'), '1023');
  assert.equal(P.normalizarCdCvm('  01023 '), '1023');
  assert.equal(P.normalizarCdCvm(''), null);
});

test('o índice da DFP responde pelas DUAS identificações', () => {
  const csv = [CABECALHO, linha('1023', '2.03', 'Patrimônio Líquido Consolidado', '180000')].join(
    '\n'
  );
  const { colunas, registros } = P.parseCsvCvm(csv);
  const { mapa } = P.resolverColunas(colunas, [
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
  const grupos = P.agruparPorEmpresa(registros, mapa);
  assert.ok(grupos.get('cd:1023'), 'quem só tem CD_CVM continua achando');
  assert.ok(grupos.get('cnpj:00000000000191'), 'quem vem do FCA acha pelo CNPJ');
  assert.equal(
    grupos.get('cd:1023').get('2025-12-31').length,
    grupos.get('cnpj:00000000000191').get('2025-12-31').length,
    'as duas chaves têm de apontar para as mesmas linhas'
  );
});

test('universo vindo do FCA (só CNPJ) casa com a DFP (que tem as duas)', () => {
  // Esta é a junção inteira, ponta a ponta: é o teste que falharia se o
  // pipeline voltasse a procurar a companhia por uma chave que o universo
  // não conhece.
  const csvs = {
    BPP_con: P.parseCsvCvm(
      [
        CABECALHO,
        linha('1023', '2.03', 'Patrimônio Líquido Consolidado', '180000'),
        linha('5410', '2.03', 'Patrimônio Líquido Consolidado', '25000', {
          cnpj: '84.429.695/0001-11',
        }),
      ].join('\n')
    ),
  };
  const cols = { ...COLS_TESTE, cnpj: 'CNPJ_CIA' };
  const doFca = { ticker: 'WEGE3', cnpj: '84429695000111', cdCvm: null };
  const ex = exercicioDaEmpresa(csvs, cols, chavesDaEmpresa(doFca), 2025);
  assert.ok(ex, 'ticker descoberto pelo FCA precisa achar a demonstração');
  assert.equal(ex.patrimonioLiquido, 25000000, 'não pode pegar a linha da outra empresa');
});

test('chavesDaEmpresa prefere o CNPJ e mantém o CD_CVM como alternativa', () => {
  assert.deepEqual(chavesDaEmpresa({ cnpj: '00000000000191', cdCvm: '001023' }), [
    'cnpj:00000000000191',
    'cd:1023',
  ]);
  assert.deepEqual(chavesDaEmpresa({ cdCvm: '1023' }), ['cd:1023']);
  assert.deepEqual(chavesDaEmpresa({}), [], 'sem identificação nenhuma, não há o que procurar');
});

// ════════════════════════════════════════════
// Lucro por ação e dividendos
// ════════════════════════════════════════════
//
// São o que destrava VALUATION e DIVIDENDOS sem fonte paga: o v8/chart do
// Yahoo devolve preço mas não valor de mercado, e sem contagem de ações não
// há P/L nem P/VP. A contagem sai de `lucro / LPA` — uma divisão que erra
// silenciosamente se a linha errada for lida. Daí o peso destes testes.

// A DRE real da CVM: o grupo 3.99 tem 3.99.01 (básico) e 3.99.02 (diluído),
// e as FOLHAS trazem só a classe na descrição — "ON", "PN". Quem separa
// básico de diluído é o código.
function dreLpa(linhas) {
  return P.parseCsvCvm([CABECALHO, ...linhas].join('\n')).registros;
}
const COLS_LPA = { ...COLS_TESTE };

test('LPA sai do grupo básico, com a classe na descrição', () => {
  const dre = dreLpa([
    linha('1023', '3.11', 'Lucro/Prejuízo Consolidado do Período', '21000000'),
    linha('1023', '3.99', 'Lucro por Ação - (Reais / Ação)', '0', { escala: 'UNIDADE' }),
    linha('1023', '3.99.01', 'Lucro Básico por Ação', '0', { escala: 'UNIDADE' }),
    linha('1023', '3.99.01.01', 'ON', '7.37', { escala: 'UNIDADE' }),
  ]);
  const fin = P.extrairFinanceiro({ dre }, COLS_LPA);
  assert.equal(fin.lucroPorAcao, 7.37);
  // 21 bilhões (21.000.000 em MIL) sobre 7,37 por ação.
  assert.ok(Math.abs(fin.acoesEquivalentes - 21e9 / 7.37) < 1);
});

test('o LPA diluído NÃO entra — o código é que o identifica', () => {
  // A descrição da folha diluída é "ON", igual à básica. Filtrar por texto
  // deixava o diluído passar e a contagem de ações saía menor do que é.
  const dre = dreLpa([
    linha('1023', '3.11', 'Lucro/Prejuízo Consolidado do Período', '21000000'),
    linha('1023', '3.99.01', 'Lucro Básico por Ação', '0', { escala: 'UNIDADE' }),
    linha('1023', '3.99.01.01', 'ON', '7.37', { escala: 'UNIDADE' }),
    linha('1023', '3.99.02', 'Lucro Diluído por Ação', '0', { escala: 'UNIDADE' }),
    linha('1023', '3.99.02.01', 'ON', '6.10', { escala: 'UNIDADE' }),
  ]);
  assert.equal(P.extrairFinanceiro({ dre }, COLS_LPA).lucroPorAcao, 7.37);
});

test('ON e PN com LPA diferente não viram contagem de ações', () => {
  // Uma divisão só não soma duas classes com lucros por ação distintos.
  // Sem P/L é melhor do que com P/L errado.
  const dre = dreLpa([
    linha('1023', '3.11', 'Lucro/Prejuízo Consolidado do Período', '21000000'),
    linha('1023', '3.99.01.01', 'ON', '7.37', { escala: 'UNIDADE' }),
    linha('1023', '3.99.01.02', 'PN', '8.11', { escala: 'UNIDADE' }),
  ]);
  const fin = P.extrairFinanceiro({ dre }, COLS_LPA);
  assert.equal(fin.lucroPorAcao, null);
  assert.equal(fin.acoesEquivalentes, null);
});

test('banco é identificado pelo próprio balanço, sem lista de setor', () => {
  // O plano padrão separa circulante de não circulante. Banco e seguradora
  // não fazem essa separação — e é isso que os identifica. Nenhuma lista de
  // setor escrita à mão, que envelheceria como toda lista escrita à mão.
  const bancoBpp = bloco([
    linha('1023', '2.01', 'Depósitos', '900000000'),
    linha('1023', '2.02', 'Captações no Mercado Aberto', '400000000'),
    linha('1023', '2.08', 'Patrimônio Líquido Consolidado', '180000000'),
  ]);
  assert.equal(P.planoDaEmpresa({ bpp: bancoBpp }, COLS_TESTE), 'financeiro');

  const industriaBpp = bloco([
    linha('1023', '2.01', 'Passivo Circulante', '700000'),
    linha('1023', '2.03', 'Patrimônio Líquido Consolidado', '180000'),
  ]);
  assert.equal(P.planoDaEmpresa({ bpp: industriaBpp }, COLS_TESTE), 'padrao');
});

test('balanço truncado NÃO vira banco — ausência de prova não é prova', () => {
  // Sem a linha de circulante E sem nenhuma marca do plano financeiro, o
  // seguro é assumir o plano padrão: classificar errado como financeiro
  // apagaria indicadores válidos de uma empresa comum.
  const truncado = bloco([linha('1023', '2.03', 'Patrimônio Líquido Consolidado', '180000')]);
  assert.equal(P.planoDaEmpresa({ bpp: truncado }, COLS_TESTE), 'padrao');
});

test('em banco, dívida líquida e EBITDA não existem — e não são inventados', () => {
  // Achado da execução real: BBAS3 saía com dívida líquida/EBITDA de 12,49x.
  // Um banco não tem "dívida líquida" nesse sentido nem EBITDA: a
  // intermediação financeira É a operação dele. O número vinha de contas que
  // existem no código mas significam outra coisa.
  const blocos = {
    bpa: bloco([
      linha('1023', '1', 'Ativo Total', '2000000000'),
      linha('1023', '1.01', 'Caixa e Equivalentes de Caixa', '50000000'),
      linha('1023', '1.02', 'Aplicações Interfinanceiras de Liquidez', '300000000'),
    ]),
    bpp: bloco([
      linha('1023', '2.01', 'Depósitos', '900000000'),
      linha('1023', '2.01.04', 'Recursos de Aceites e Emissão de Títulos', '80000000'),
      linha('1023', '2.08', 'Patrimônio Líquido Consolidado', '180000000'),
    ]),
    // Descrição do lucro fora dos nossos termos, de propósito: no banco ela
    // varia, e o código do grupo 3 é compartilhado entre os planos.
    dre: bloco([linha('1023', '3.11', 'Resultado Líquido do Semestre/Exercício', '13700000')]),
  };
  const fin = P.extrairFinanceiro(blocos, COLS_TESTE);
  assert.equal(fin.plano, 'financeiro');
  assert.equal(fin.patrimonioLiquido, 180000000000, 'o patrimônio, esse, é confiável');
  assert.equal(fin.ativoCirculante, null, 'banco não tem ativo circulante');
  assert.equal(fin.dividaBruta, null, 'o 2.01.04 do banco não é empréstimo tomado');
  assert.equal(fin.ebit, null);
  assert.equal(fin.ebitda, null);

  // MAS o lucro tem de sobreviver. A primeira tentativa desta correção
  // desligou o código para TODAS as contas e o BBAS3 caiu de 9/12 para 1/12,
  // sem ROE — trocando um número sem sentido por nenhum número. Só o BALANÇO
  // diverge entre os planos; o grupo 3 da DRE é compartilhado.
  assert.equal(fin.lucroLiquido, 13700000000, 'sem lucro não há ROE, e o banco tem ROE');

  const r = P.calcularIndicadores([{ ano: 2025, dataReferencia: '2025-12-31', ...fin }]);
  assert.equal(r.indicadores.dividaLiquidaEbitda, null, 'banco não tem dívida/EBITDA');
  assert.equal(r.indicadores.liquidezCorrente, null, 'nem liquidez corrente');
  assert.ok(r.indicadores.roe !== null, 'ROE continua saindo — esse faz sentido para banco');
  assert.equal(Math.round(r.indicadores.roe * 10) / 10, 7.6);
});

test('em banco, o patrimônio sai da DESCRIÇÃO — o código 2.03 é outra conta', () => {
  // Achado da execução real: BBAS3 saiu com ROE 43,4% (o do Banco do Brasil
  // é ~20%). O lucro estava certo e o patrimônio ~6x abaixo — porque banco,
  // seguradora e indústria não usam o mesmo plano de contas na DFP, e casar
  // por código devolvia um número REAL da conta ERRADA, sem erro nenhum.
  //
  // A descrição, essa, é padronizada nos três planos.
  const bpp = bloco([
    linha('1023', '2.03', 'Relações Interfinanceiras', '30000000'),
    linha('1023', '2.08', 'Patrimônio Líquido Consolidado', '180000000'),
  ]);
  assert.equal(
    P.valorDaConta(bpp, COLS_TESTE, 'patrimonioLiquido'),
    180000000000,
    'a conta certa é a que se chama patrimônio líquido, não a que calha no 2.03'
  );
});

test('no plano industrial nada muda: código e descrição apontam a mesma linha', () => {
  const bpp = bloco([linha('1023', '2.03', 'Patrimônio Líquido Consolidado', '180000')]);
  assert.equal(P.valorDaConta(bpp, COLS_TESTE, 'patrimonioLiquido'), 180000000);
});

test('sem descrição no arquivo, o código continua servindo', () => {
  // A reserva importa: arquivo antigo sem DS_CONTA não pode ficar sem valor.
  const bpp = bloco([linha('1023', '2.03', '', '180000')]);
  assert.equal(P.valorDaConta(bpp, COLS_TESTE, 'patrimonioLiquido'), 180000000);
});

test('distribuição nomeada sem a palavra "dividendo" continua sendo distribuição', () => {
  // A Eletrobras nomeia a linha `Pagamento e Remuneração aos Acionistas`. Sem
  // o termo, o resultado era `div 0M` numa companhia que paga — e o log foi
  // quem entregou o nome, ao imprimir as linhas do 6.03 não reconhecidas.
  const dfc = dreLpa([
    linha('1023', '6.03', 'Caixa Líquido Atividades de Financiamento', '-15000000'),
    linha('1023', '6.03.05', 'Pagamento e Remuneração aos Acionistas', '-8000000'),
  ]);
  assert.equal(P.extrairFinanceiro({ dfc }, COLS_LPA).dividendosPagos, 8e9);
});

test('a escala do arquivo NÃO se aplica à conta por ação', () => {
  // Achado da primeira execução real contra a CVM: boa parte dos emissores
  // repete ESCALA_MOEDA=MIL nas linhas do grupo 3.99, por herança do resto
  // da DFP. A conta 3.99 é, por definição do plano, "Reais / Ação" — a
  // unidade vem do plano de contas, não da escala declarada no arquivo.
  //
  // Aplicando a escala, o log saiu assim:
  //   ARML3  LPA 190,00  (era 0,19)   ← valor errado, e passou
  //   ENGI11 LPA 950,00  (era 0,95)   ← valor errado, e passou
  //   BBAS3  LPA —       (7,4 × 1000 = 7400, cortado pelo teto)
  const comMil = dreLpa([
    linha('1023', '3.11', 'Lucro/Prejuízo Consolidado do Período', '21000000'),
    linha('1023', '3.99.01.01', 'ON', '7.37', { escala: 'MIL' }),
  ]);
  assert.equal(P.extrairFinanceiro({ dre: comMil }, COLS_LPA).lucroPorAcao, 7.37);

  const comUnidade = dreLpa([
    linha('1023', '3.11', 'Lucro/Prejuízo Consolidado do Período', '21000000'),
    linha('1023', '3.99.01.01', 'ON', '7.37', { escala: 'UNIDADE' }),
  ]);
  assert.equal(
    P.extrairFinanceiro({ dre: comUnidade }, COLS_LPA).lucroPorAcao,
    7.37,
    'as duas escalas têm de dar o MESMO LPA'
  );
});

test('LPA absurdo continua recusado — o teto é guarda de verdade', () => {
  // R$ 7.370 por ação não existe na B3. Passaria a contagem de ações direto
  // se ninguém olhasse.
  const dre = dreLpa([
    linha('1023', '3.11', 'Lucro/Prejuízo Consolidado do Período', '21000000'),
    linha('1023', '3.99.01.01', 'ON', '7370', { escala: 'UNIDADE' }),
  ]);
  assert.equal(P.extrairFinanceiro({ dre }, COLS_LPA).lucroPorAcao, null);
});

test('contagem de ações fora de ordem de grandeza plausível é descartada', () => {
  const dre = dreLpa([
    linha('1023', '3.11', 'Lucro/Prejuízo Consolidado do Período', '1', { escala: 'UNIDADE' }),
    linha('1023', '3.99.01.01', 'ON', '0.5', { escala: 'UNIDADE' }),
  ]);
  const fin = P.extrairFinanceiro({ dre }, COLS_LPA);
  assert.equal(fin.lucroPorAcao, 0.5);
  assert.equal(fin.acoesEquivalentes, null, '2 ações não é uma companhia aberta');
});

test('dividendos pagos saem do financiamento, não do que a empresa recebeu', () => {
  // "Dividendos recebidos" mora no 6.01 (operacional). Somá-lo inverteria o
  // sinal do payout de uma holding.
  const dfc = dreLpa([
    linha('1023', '6.01.02', 'Dividendos Recebidos', '3000000'),
    linha('1023', '6.03', 'Caixa Líquido Atividades de Financiamento', '-15000000'),
    linha('1023', '6.03.04', 'Dividendos e JCP Pagos', '-8000000'),
  ]);
  assert.equal(P.extrairFinanceiro({ dfc }, COLS_LPA).dividendosPagos, 8e9);
});

test('linha-pai não soma junto com as filhas', () => {
  // A CVM publica o agregado E o detalhe. Contar os dois dobrava o payout.
  const dfc = dreLpa([
    linha('1023', '6.03.04', 'Dividendos e JCP Pagos', '-8000000'),
    linha('1023', '6.03.04.01', 'Dividendos Pagos', '-5000000'),
    linha('1023', '6.03.04.02', 'JCP Pago', '-3000000'),
  ]);
  assert.equal(P.extrairFinanceiro({ dfc }, COLS_LPA).dividendosPagos, 8e9);
});

test('só as filhas, sem agregado, somam entre si', () => {
  const dfc = dreLpa([
    linha('1023', '6.03', 'Caixa Líquido Atividades de Financiamento', '-15000000'),
    linha('1023', '6.03.04', 'Dividendos Pagos', '-5000000'),
    linha('1023', '6.03.05', 'Juros sobre o Capital Próprio Pagos', '-3000000'),
  ]);
  assert.equal(P.extrairFinanceiro({ dfc }, COLS_LPA).dividendosPagos, 8e9);
});

test('JCP conta como distribuição mesmo quando a linha não diz "dividendo"', () => {
  // Metade das companhias nomeia a linha só como JCP. Ignorá-la zerava o
  // payout de empresa que distribui todo ano.
  const dfc = dreLpa([linha('1023', '6.03.04', 'JCP Pago', '-8000000')]);
  assert.equal(P.extrairFinanceiro({ dfc }, COLS_LPA).dividendosPagos, 8e9);
});

test('"não distribuiu" e "não consegui ler" não são o mesmo null', () => {
  // Distinção que decide ranking: sem ela, quem não paga dividendo nenhum
  // ficava FORA do pilar de dividendos em vez de pontuar zero nele — e
  // podia liderar a lente de renda por ausência de dado.
  const comFinanciamento = dreLpa([
    linha('1023', '6.03', 'Caixa Líquido Atividades de Financiamento', '-15000000'),
    linha('1023', '6.03.01', 'Captações de Empréstimos', '-15000000'),
  ]);
  assert.equal(
    P.extrairFinanceiro({ dfc: comFinanciamento }, COLS_LPA).dividendosPagos,
    0,
    'seção FECHADA e sem linha de distribuição = pagou zero'
  );

  // Seção que não fecha: sobra diferença entre o total e as filhas, logo
  // existe linha que não lemos. Achado da execução real — 3 de 8 companhias
  // saíram com "div 0M", uma delas pagadora conhecida. Um zero falso afunda
  // no ranking de renda justamente quem deveria subir; a lacuna não.
  const naoFecha = dreLpa([
    linha('1023', '6.03', 'Caixa Líquido Atividades de Financiamento', '-15000000'),
    linha('1023', '6.03.01', 'Captações de Empréstimos', '-7000000'),
  ]);
  assert.equal(
    P.extrairFinanceiro({ dfc: naoFecha }, COLS_LPA).dividendosPagos,
    null,
    'sobrou diferença: há linha não lida, e zero ali seria mentira'
  );

  const semFinanciamento = dreLpa([
    linha('1023', '6.01', 'Caixa Líquido Atividades Operacionais', '30000000'),
  ]);
  assert.equal(
    P.extrairFinanceiro({ dfc: semFinanciamento }, COLS_LPA).dividendosPagos,
    null,
    'sem a seção de financiamento não se afirma nada'
  );

  // Só o total, sem detalhe: o dividendo pode estar embutido nele.
  const soOTotal = dreLpa([
    linha('1023', '6.03', 'Caixa Líquido Atividades de Financiamento', '-15000000'),
  ]);
  assert.equal(
    P.extrairFinanceiro({ dfc: soOTotal }, COLS_LPA).dividendosPagos,
    null,
    'agregado sem detalhe não autoriza afirmar zero'
  );
});

test('quem não distribuiu pontua zero no pilar, não fica fora dele', () => {
  const r = P.calcularIndicadores([
    {
      ano: 2025,
      dataReferencia: '2025-12-31',
      lucroLiquido: 20e9,
      patrimonioLiquido: 100e9,
      receita: 100e9,
      dividendosPagos: 0,
      acoesEquivalentes: 2.85e9,
    },
  ]);
  assert.equal(r.indicadores.payout, 0);
  assert.equal(r.indicadores.anosPagandoDividendo, 0);
  assert.equal(r.absolutos.dividendoPorAcao, 0, 'DY zero é um número, não uma lacuna');
});

test('payout e anos pagando saem sem preço nenhum', () => {
  const exercicios = [2022, 2023, 2024, 2025].map((ano) => ({
    ano,
    dataReferencia: `${ano}-12-31`,
    lucroLiquido: 20e9,
    patrimonioLiquido: 100e9,
    receita: 100e9,
    dividendosPagos: 8e9,
    acoesEquivalentes: 2.85e9,
  }));
  const r = P.calcularIndicadores(exercicios);
  assert.equal(Math.round(r.indicadores.payout), 40);
  assert.equal(r.indicadores.anosPagandoDividendo, 4);
  assert.ok(Math.abs(r.absolutos.dividendoPorAcao - 8e9 / 2.85e9) < 1e-9);
});

test('um ano sem pagar interrompe a sequência, e um ano sem dado também', () => {
  const base = (ano, div) => ({
    ano,
    dataReferencia: `${ano}-12-31`,
    lucroLiquido: 20e9,
    patrimonioLiquido: 100e9,
    receita: 100e9,
    dividendosPagos: div,
  });
  // Pagou, parou, voltou: são 2 anos seguidos, não 3.
  assert.equal(
    P.calcularIndicadores([base(2023, 8e9), base(2024, 0), base(2025, 8e9)]).indicadores
      .anosPagandoDividendo,
    1
  );
  // Exercício sem informação não conta como "não pagou" nem como "pagou".
  assert.equal(
    P.calcularIndicadores([base(2023, 8e9), base(2024, null), base(2025, 8e9)]).indicadores
      .anosPagandoDividendo,
    1
  );
  // Sem dado no ano mais recente, não há sequência a declarar.
  assert.equal(
    P.calcularIndicadores([base(2024, 8e9), base(2025, null)]).indicadores.anosPagandoDividendo,
    null
  );
});

test('payout acima de 200% é descartado', () => {
  const r = P.calcularIndicadores([
    {
      ano: 2025,
      dataReferencia: '2025-12-31',
      lucroLiquido: 1e9,
      patrimonioLiquido: 100e9,
      receita: 10e9,
      dividendosPagos: 9e9,
    },
  ]);
  assert.equal(r.indicadores.payout, null, 'distribuição de reserva não descreve política');
  assert.ok(r.descartados.some((d) => d.campo === 'payout'));
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

// ════════════════════════════════════════════
// Vínculo ticker ↔ FII
// ════════════════════════════════════════════
//
// A execução real desmentiu o casamento por nome: dos 584 fundos
// imobiliários do `cad_fi.csv`, "MAXI" não aparece em nenhum. A fonte não
// cobre os fundos listados, e nenhum ajuste de string conserta isso. O
// vínculo passou a sair de um CÓDIGO publicado — coluna de negociação
// quando existe, senão a raiz do ISIN da cota.

test('ISIN de cota de fundo entrega a raiz do ticker', () => {
  assert.equal(P.raizDoIsin('BRMXRFCTF004'), 'MXRF');
  assert.equal(P.raizDoIsin('brhglgctf003'), 'HGLG', 'minúsculas e espaços não podem derrubar');
  assert.equal(P.raizDoIsin('  BRKNRICTF000 '), 'KNRI');
  // ACNOR é ação, não cota: casar a raiz aqui ligaria um FII a uma empresa.
  assert.equal(P.raizDoIsin('BRPETRACNOR9'), null);
  assert.equal(P.raizDoIsin(''), null);
  assert.equal(P.raizDoIsin(null), null);
});

test('o informe liga ticker a CNPJ pelo ISIN, sem tabela escrita à mão', () => {
  const csv = [
    'CNPJ_Fundo;Data_Referencia;Nome_Fundo;Codigo_ISIN;Patrimonio_Liquido',
    '97.521.225/0001-25;2026-06-30;MAXI RENDA FUNDO DE INVESTIMENTO IMOBILIARIO;BRMXRFCTF004;1500000000',
    '11.728.688/0001-47;2026-06-30;CSHG LOGISTICA - FII;BRHGLGCTF003;4000000000',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const v = P.vincularFiiPorCodigo(parsed.registros, parsed.colunas);

  assert.equal(v.via, 'isin');
  assert.equal(v.total, 2);
  const mxrf = P.fundoDoTicker(v, 'MXRF11');
  assert.ok(mxrf, 'MXRF11 tem de casar pela raiz MXRF do ISIN');
  assert.equal(mxrf.cnpj, '97521225000125');
  assert.equal(mxrf.via, 'isin');
  assert.match(mxrf.nome, /MAXI RENDA/);
  assert.equal(P.fundoDoTicker(v, 'HGLG11').cnpj, '11728688000147');
  // Um ticker que não está no índice não pode virar casamento aproximado.
  assert.equal(P.fundoDoTicker(v, 'KNRI11'), null);
});

test('coluna de código de negociação, quando existe, tem precedência sobre o ISIN', () => {
  const csv = [
    'CNPJ_Fundo;Data_Referencia;Codigo_Negociacao;Codigo_ISIN',
    '97.521.225/0001-25;2026-06-30;MXRF11;BRMXRFCTF004',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const v = P.vincularFiiPorCodigo(parsed.registros, parsed.colunas);
  assert.equal(v.via, 'codigo_negociacao');
  const f = P.fundoDoTicker(v, 'MXRF11');
  assert.equal(f.codigo, 'MXRF11', 'o código publicado é mais específico que a raiz');
  assert.equal(f.cnpj, '97521225000125');
});

test('informe mais recente vence quando o mesmo fundo aparece em vários meses', () => {
  const csv = [
    'CNPJ_Fundo;Data_Referencia;Nome_Fundo;Codigo_ISIN',
    '97.521.225/0001-25;2026-01-31;MAXI RENDA FII;BRMXRFCTF004',
    '97.521.225/0001-25;2026-07-31;MAXI RENDA FII (NOVO NOME);BRMXRFCTF004',
    '97.521.225/0001-25;2026-04-30;MAXI RENDA FII;BRMXRFCTF004',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const v = P.vincularFiiPorCodigo(parsed.registros, parsed.colunas);
  const f = P.fundoDoTicker(v, 'MXRF11');
  assert.equal(f.dataReferencia, '2026-07-31', 'a ordem do arquivo não decide qual mês é o último');
  assert.equal(f.ambiguo, false, 'o mesmo CNPJ repetido não é ambiguidade');
});

test('o mesmo código com dois CNPJs é marcado, não escondido', () => {
  const csv = [
    'CNPJ_Fundo;Data_Referencia;Codigo_ISIN',
    '97.521.225/0001-25;2026-01-31;BRMXRFCTF004',
    '11.111.111/0001-11;2026-07-31;BRMXRFCTF004',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const v = P.vincularFiiPorCodigo(parsed.registros, parsed.colunas);
  const f = P.fundoDoTicker(v, 'MXRF11');
  assert.equal(f.ambiguo, true, 'sucessão de fundo não pode passar como sinônimo');
});

test('sem coluna de código nem de ISIN, o vínculo não inventa nada', () => {
  const csv = ['CNPJ_Fundo;Data_Referencia;Nome_Fundo', '97.521.225/0001-25;2026-06-30;MAXI'].join(
    '\n'
  );
  const parsed = P.parseCsvCvm(csv);
  const v = P.vincularFiiPorCodigo(parsed.registros, parsed.colunas);
  assert.equal(v.via, null);
  assert.equal(v.total, 0);
  assert.equal(P.fundoDoTicker(v, 'MXRF11'), null);
});

test('a composição do capital guarda as linhas descartadas, com o motivo', () => {
  const csv = [
    'CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;DT_FIM_EXERC;QT_ACAO_ORDIN_CAP_INTEGR;QT_ACAO_PREF_CAP_INTEGR;QT_ACAO_ORDIN_TESOURARIA;QT_ACAO_PREF_TESOURARIA',
    // Linha boa.
    '00.000.000/0001-91;2025-12-31;1;X S.A.;1023;2025-12-31;2000000000;0;0;0',
    // Abaixo do piso: descartada, mas registrada — pode ser ela a linha
    // certa e o piso o defeito.
    '00.000.000/0001-91;2025-12-31;1;X S.A.;1023;2025-12-31;40000;0;0;0',
    // Sem quantidade: registrada com o motivo.
    '00.000.000/0001-91;2025-12-31;1;X S.A.;1023;2025-12-31;;;;',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const cap = P.extrairComposicaoCapital(parsed.registros, parsed.colunas);

  assert.equal(cap.porChave.get('cnpj:00000000000191').acoesEmCirculacao, 2000000000);
  const linhas = cap.linhasPorChave.get('cnpj:00000000000191');
  assert.equal(linhas.length, 3, 'as três linhas têm de ficar registadas');
  assert.equal(linhas[1].circulacao, 40000);
  assert.equal(linhas[2].motivo, 'sem_quantidade_ordinaria');
});

test('o DY do mês é razão apesar do nome, e a escala sai da mediana do arquivo', () => {
  // Valores do informe real: MXRF11 saiu 0,00808 num mês em que rendeu
  // ~0,8%. O campo chama-se "Percentual_" e não é percentagem.
  const csv = [
    'CNPJ_Fundo;Data_Referencia;Percentual_Dividend_Yield_Mes',
    '97.521.225/0001-25;2026-07-31;0,00808',
    '11.728.688/0001-47;2026-07-31;0,007023',
    '00.000.000/0001-91;2026-07-31;0,012197',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const r = P.extrairInformeFii(parsed.registros, parsed.colunas);

  assert.equal(r.escalaDy.fator, 100, 'a mediana 0,008 só pode ser razão');
  const mxrf = r.porCnpj.get('97521225000125');
  assert.equal(mxrf.dyMes, 0.808, 'DY do mês em percentagem');
  assert.ok(
    Math.abs(mxrf.dy - 9.696) < 1e-9,
    `DY anual devia ser ~9,7%, veio ${mxrf.dy} — lido como percentagem daria 0,1%`
  );
});

test('arquivo já em percentagem não é multiplicado de novo', () => {
  const csv = [
    'CNPJ_Fundo;Data_Referencia;Percentual_Dividend_Yield_Mes',
    '97.521.225/0001-25;2026-07-31;0,81',
    '11.728.688/0001-47;2026-07-31;0,70',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const r = P.extrairInformeFii(parsed.registros, parsed.colunas);
  assert.equal(r.escalaDy.fator, 1);
  assert.equal(r.porCnpj.get('97521225000125').dyMes, 0.81);
});

test('DY de um mês fora de faixa vira lacuna, não número', () => {
  const csv = [
    'CNPJ_Fundo;Data_Referencia;Percentual_Dividend_Yield_Mes',
    // Mediana em percentagem; a primeira linha é impossível para um mês.
    '97.521.225/0001-25;2026-07-31;90',
    '11.728.688/0001-47;2026-07-31;0,70',
    '00.000.000/0001-91;2026-07-31;0,80',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const r = P.extrairInformeFii(parsed.registros, parsed.colunas);
  assert.equal(r.porCnpj.get('97521225000125').dyMes, null, '90% num mês não é DY');
  assert.equal(r.porCnpj.get('97521225000125').dy, null);
  assert.equal(r.porCnpj.get('11728688000147').dyMes, 0.7, 'o resto do arquivo não é afetado');
});

// ════════════════════════════════════════════
// Série mensal do FII
// ════════════════════════════════════════════
//
// O ZIP anual traz doze informes de cada fundo. Ler só o último deixava dois
// indicadores do pilar de dividendos vazios — por falta de dado que já
// estava na mão.

test('a série mensal responde DY médio e consistência', () => {
  const serie = [];
  // 24 meses pagando 0,8% e mais 12 pagando 0,6%: média 12×((0,8×24+0,6×12)/36).
  for (let i = 0; i < 12; i++) serie.push({ dataReferencia: `2024-${pad(i + 1)}-01`, dyMes: 0.6 });
  for (let i = 0; i < 12; i++) serie.push({ dataReferencia: `2025-${pad(i + 1)}-01`, dyMes: 0.8 });
  for (let i = 0; i < 12; i++) serie.push({ dataReferencia: `2026-${pad(i + 1)}-01`, dyMes: 0.8 });
  const r = P.indicadoresDaSerieFii(serie);
  assert.equal(r.mesesObservados, 36);
  assert.ok(Math.abs(r.dyMedio36m - 8.8) < 1e-6, `DY médio anualizado veio ${r.dyMedio36m}`);
  assert.equal(r.consistenciaDividendos, 100);
});

test('mês sem rendimento derruba a consistência, não o DY médio', () => {
  const serie = [];
  for (let i = 0; i < 24; i++) {
    serie.push({ dataReferencia: `2025-${pad((i % 12) + 1)}-01`, dyMes: 0 });
  }
  // A janela de consistência é 24 meses: seis pagando em doze competências
  // distintas dá 50%.
  const s2 = [];
  for (let i = 0; i < 12; i++) {
    s2.push({ dataReferencia: `2026-${pad(i + 1)}-01`, dyMes: i % 2 === 0 ? 0.9 : 0 });
  }
  const r = P.indicadoresDaSerieFii(s2);
  assert.equal(r.consistenciaDividendos, 50);
  assert.ok(Math.abs(r.dyMedio36m - 5.4) < 1e-6, `veio ${r.dyMedio36m}`);
});

test('reenvio do mesmo mês conta uma vez só', () => {
  // Piso de meses baixado de propósito: aqui o alvo é a deduplicação, não
  // a janela mínima.
  const r = P.indicadoresDaSerieFii(
    [
      { dataReferencia: '2026-01-01', dyMes: 0.5 },
      { dataReferencia: '2026-01-31', dyMes: 0.9 },
      { dataReferencia: '2026-02-01', dyMes: 0.9 },
    ],
    { minimoMeses: 1 }
  );
  assert.equal(r.mesesObservados, 2, 'janeiro reenviado é um mês, não dois');
  assert.ok(Math.abs(r.dyMedio36m - 10.8) < 1e-6, 'vale o último informe da competência');
});

test('série vazia não inventa média', () => {
  const r = P.indicadoresDaSerieFii([]);
  assert.equal(r.dyMedio36m, null);
  assert.equal(r.consistenciaDividendos, null);
  assert.equal(r.mesesObservados, 0);
});

function pad(n) {
  return String(n).padStart(2, '0');
}

test('a escala declarada é aplicada à quantidade de ações', () => {
  const cab =
    'CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;DT_FIM_EXERC;ESCALA_QUANTIDADE;QT_ACAO_ORDIN_CAP_INTEGR;QT_ACAO_PREF_CAP_INTEGR;QT_ACAO_ORDIN_TESOURARIA;QT_ACAO_PREF_TESOURARIA';
  const csv = [
    cab,
    // Eletrobras, como está no arquivo: 2.028.544 em MILHARES.
    `00.000.000/0001-91;2025-12-31;1;ELETROBRAS;2437;2025-12-31;MIL;2028544;886884;0;0`,
    // Banco do Brasil, no mesmo arquivo, em UNIDADES.
    `00.000.000/0001-92;2025-12-31;1;BANCO DO BRASIL;1023;2025-12-31;UNIDADE;5730000000;0;0;0`,
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const cap = P.extrairComposicaoCapital(parsed.registros, parsed.colunas);

  const elet = cap.porChave.get('cnpj:00000000000191');
  assert.equal(elet.acoesEmCirculacao, 2915428000, 'milhares: 2.028.544 mil = 2,03 bi de ON');
  assert.equal(elet.escalaAplicada, 1000);
  const bbas = cap.porChave.get('cnpj:00000000000192');
  assert.equal(bbas.acoesEmCirculacao, 5730000000, 'unidades ficam como estão');
  assert.equal(bbas.escalaAplicada, 1);
});

test('sem coluna de escala, a contagem fica como está — e o fato é observável', () => {
  const csv = [
    'CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;DT_FIM_EXERC;QT_ACAO_ORDIN_CAP_INTEGR;QT_ACAO_PREF_CAP_INTEGR;QT_ACAO_ORDIN_TESOURARIA;QT_ACAO_PREF_TESOURARIA',
    '00.000.000/0001-91;2025-12-31;1;X;1023;2025-12-31;2000000000;0;0;0',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const cap = P.extrairComposicaoCapital(parsed.registros, parsed.colunas);
  assert.equal(cap.porChave.get('cnpj:00000000000191').acoesEmCirculacao, 2000000000);
  assert.ok(
    cap.faltando.includes('escalaQuantidade'),
    'a ausência da coluna precisa ser reportável — é ela que denuncia 1000×'
  );
});

test('classe negociada em bolsa desempata a raiz partilhada', () => {
  // Achado da execução real: XPML11 casou com dois CNPJs e o vencedor foi
  // decidido pela ordem do arquivo — que não é critério nenhum. O ticker
  // designa a classe NEGOCIADA, e a fonte diz qual é.
  const csv = [
    'CNPJ_Fundo;Data_Referencia;Nome_Fundo;Codigo_ISIN;Mercado_Negociacao_Bolsa',
    '11.111.111/0001-11;2026-07-01;CLASSE NAO NEGOCIADA;BRXPMLCTF001;N',
    '22.222.222/0001-22;2026-07-01;XP MALLS FII;BRXPMLCTF001;S',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const v = P.vincularFiiPorCodigo(parsed.registros, parsed.colunas);
  const f = P.fundoDoTicker(v, 'XPML11');
  assert.equal(f.cnpj, '22222222000122', 'a classe em bolsa é a do ticker');
  assert.equal(f.ambiguo, false);
  assert.equal(f.desempate, 'bolsa');
});

test('sem critério de desempate a ambiguidade fica, com os candidatos à vista', () => {
  const csv = [
    'CNPJ_Fundo;Data_Referencia;Nome_Fundo;Codigo_ISIN;Mercado_Negociacao_Bolsa',
    '11.111.111/0001-11;2026-07-01;UM;BRXPMLCTF001;S',
    '22.222.222/0001-22;2026-07-01;OUTRO;BRXPMLCTF001;S',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const v = P.vincularFiiPorCodigo(parsed.registros, parsed.colunas);
  const f = P.fundoDoTicker(v, 'XPML11');
  assert.equal(f.ambiguo, true, 'duas em bolsa: não há como escolher');
  assert.equal(f.candidatos.length, 2, 'os dois lados têm de ficar visíveis');
  assert.deepEqual(f.candidatos.map((c) => c.nome).sort(), ['OUTRO', 'UM']);
});

// ════════════════════════════════════════════
// Ocupação e imóveis (informe trimestral)
// ════════════════════════════════════════════
//
// O informe mensal não publica vacância — as colunas dos três membros foram
// impressas na execução real e ali há só rubricas de balanço. Quem publica é
// o trimestral, com uma linha por imóvel.

test('ocupação vem de Percentual_Locado, ponderada pela área', () => {
  // Um galpão vago de 50 mil m² não pesa o mesmo que uma loja vaga de 200:
  // a média simples trataria os dois como iguais e a ocupação sairia errada
  // justamente nos fundos de logística.
  const csv = [
    'CNPJ_Fundo_Classe;Data_Referencia;Area;Percentual_Locado',
    '11.728.688/0001-47;2026-06-30;50000;0',
    '11.728.688/0001-47;2026-06-30;150000;100',
    '11.728.688/0001-47;2026-06-30;200;0',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const r = P.extrairImoveisFii(parsed.registros, parsed.colunas);
  const f = r.porCnpj.get('11728688000147');
  assert.equal(f.numeroImoveis, 3, 'a contagem é de linhas, não de coluna');
  // 150.000 de 200.200 m² ocupados = 74,9%.
  assert.equal(f.ocupacao, 74.9);
  assert.equal(f.vacancia, 25.1);
  assert.equal(f.imoveisComVago, 2);
});

test('Percentual_Locado em razão é reconhecido pela mediana', () => {
  // Mesmo problema do `Percentual_Dividend_Yield_Mes`: chama-se "percentual"
  // e vem como razão. Imóvel cheio vale 1 como razão e 100 como
  // percentagem — a mediana separa as duas sem ambiguidade.
  const csv = [
    'CNPJ_Fundo_Classe;Data_Referencia;Area;Percentual_Locado',
    '11.728.688/0001-47;2026-06-30;1000;1,00',
    '11.728.688/0001-47;2026-06-30;1000;1,00',
    '11.728.688/0001-47;2026-06-30;1000;0,70',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const r = P.extrairImoveisFii(parsed.registros, parsed.colunas);
  assert.equal(r.escalaLocado.fator, 100, 'mediana 1 só pode ser razão');
  assert.equal(r.porCnpj.get('11728688000147').ocupacao, 90);
});

test('sem Percentual_Locado, a vacância publicada vira ocupação', () => {
  const csv = [
    'CNPJ_Fundo_Classe;Data_Referencia;Area;Percentual_Vacancia',
    '11.728.688/0001-47;2026-06-30;1000;20',
    '11.728.688/0001-47;2026-06-30;1000;0',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const r = P.extrairImoveisFii(parsed.registros, parsed.colunas);
  assert.equal(r.porCnpj.get('11728688000147').ocupacao, 90);
});

test('versão mais alta do trimestre vence — correção não duplica a carteira', () => {
  const csv = [
    'CNPJ_Fundo_Classe;Data_Referencia;Versao;Area;Percentual_Locado',
    '11.728.688/0001-47;2026-03-31;1;1000;100',
    '11.728.688/0001-47;2026-06-30;1;1000;100',
    '11.728.688/0001-47;2026-06-30;1;1000;100',
    '11.728.688/0001-47;2026-06-30;2;1000;100',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const f = P.extrairImoveisFii(parsed.registros, parsed.colunas).porCnpj.get('11728688000147');
  assert.equal(f.numeroImoveis, 1, 'só a versão 2 do trimestre mais recente');
  assert.equal(f.dataReferencia, '2026-06-30');
});

test('sem coluna de ocupação os imóveis ainda são contados', () => {
  const csv = [
    'CNPJ_Fundo_Classe;Data_Referencia;Nome_Imovel',
    '11.728.688/0001-47;2026-06-30;GALPÃO A',
    '11.728.688/0001-47;2026-06-30;GALPÃO B',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const r = P.extrairImoveisFii(parsed.registros, parsed.colunas);
  const f = r.porCnpj.get('11728688000147');
  assert.equal(f.numeroImoveis, 2);
  assert.equal(f.ocupacao, null, 'sem o dado, lacuna — nunca 100%');
  assert.equal(f.coberturaOcupacao, 0);
});

test('LTV do FII não conta rendimento a distribuir como dívida', () => {
  // `Total_Passivo` inclui rendimentos a distribuir e taxa de administração
  // a pagar. Usá-lo faria um fundo sem dívida nenhuma aparecer alavancado
  // no mês em que declarou rendimento.
  assert.equal(
    P.alavancagemFii({
      valorAtivo: 1000,
      obrigacoesAquisicaoImoveis: 0,
      obrigacoesSecuritizacao: 0,
    }),
    0
  );
  assert.equal(
    P.alavancagemFii({
      valorAtivo: 2000000000,
      obrigacoesAquisicaoImoveis: 200000000,
      obrigacoesSecuritizacao: 100000000,
    }),
    15
  );
});

test('LTV sem ativo, sem obrigação declarada ou fora de faixa é lacuna', () => {
  assert.equal(P.alavancagemFii({ valorAtivo: 0, obrigacoesAquisicaoImoveis: 10 }), null);
  assert.equal(
    P.alavancagemFii({
      valorAtivo: 1000,
      obrigacoesAquisicaoImoveis: null,
      obrigacoesSecuritizacao: null,
    }),
    null,
    'nenhuma das duas rubricas publicada não é o mesmo que zero dívida'
  );
  assert.equal(
    P.alavancagemFii({ valorAtivo: 1000, obrigacoesAquisicaoImoveis: 5000 }),
    null,
    '500% do ativo não é LTV, é linha lida errado'
  );
  assert.equal(P.alavancagemFii(null), null);
});

test('ocupação de poucos imóveis não descreve a carteira — vira lacuna', () => {
  // Achado da execução real: `Percentual_Locado` vem VAZIO na maioria das
  // linhas. Com quatro imóveis de duzentos e vinte e oito reportando, a
  // média saiu 0% de ocupação num fundo cheio — porque quem preenche o
  // campo costuma ser justamente quem tem algo a declarar.
  const linhas = ['CNPJ_Fundo_Classe;Data_Referencia;Area;Percentual_Locado'];
  for (let i = 0; i < 4; i++) linhas.push('11.728.688/0001-47;2026-06-30;1000;0,20');
  for (let i = 0; i < 20; i++) linhas.push('11.728.688/0001-47;2026-06-30;1000;');
  const parsed = P.parseCsvCvm(linhas.join('\n'));
  const f = P.extrairImoveisFii(parsed.registros, parsed.colunas).porCnpj.get('11728688000147');
  assert.equal(f.numeroImoveis, 24, 'os imóveis continuam contados');
  assert.equal(f.ocupacao, null, '4 de 24 não é a carteira');
  assert.ok(f.coberturaOcupacao < 0.6);
});

test('a coluna densa cobre a esparsa, linha a linha', () => {
  // `Percentual_Locado` é o número direto mas esparso; a vacância é densa.
  // Escolher UMA para o arquivo inteiro perde a carteira toda; escolher por
  // linha usa o melhor de cada uma.
  const csv = [
    'CNPJ_Fundo_Classe;Data_Referencia;Area;Percentual_Locado;Percentual_Vacancia',
    '11.728.688/0001-47;2026-06-30;1000;0,50;',
    '11.728.688/0001-47;2026-06-30;1000;;0,10',
    '11.728.688/0001-47;2026-06-30;1000;;0',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const r = P.extrairImoveisFii(parsed.registros, parsed.colunas);
  const f = r.porCnpj.get('11728688000147');
  // 50% + 90% + 100% em áreas iguais = 80%.
  assert.equal(f.ocupacao, 80);
  assert.equal(f.coberturaOcupacao, 1);
  assert.equal(f.imoveisComVago, 2);
});

test('cobertura é por ÁREA, não por contagem de imóvel', () => {
  // O cenário real que motivou a troca: poucos imóveis GRANDES bem
  // cobertos, muitos PEQUENOS sem dado. Por contagem isso reprova (2 de 22
  // = 9%); por área, os dois grandes são a maior parte do patrimônio.
  const linhas = ['CNPJ_Fundo_Classe;Data_Referencia;Area;Percentual_Locado'];
  // Dois imóveis grandes, 100.000 m² cada, ambos reportando 90% locado.
  linhas.push('11.728.688/0001-47;2026-06-30;100000;0,90');
  linhas.push('11.728.688/0001-47;2026-06-30;100000;0,90');
  // Vinte imóveis pequenos, 100 m² cada, nenhum reportando.
  for (let i = 0; i < 20; i++) linhas.push('11.728.688/0001-47;2026-06-30;100;');
  const parsed = P.parseCsvCvm(linhas.join('\n'));
  const f = P.extrairImoveisFii(parsed.registros, parsed.colunas).porCnpj.get('11728688000147');

  assert.equal(f.numeroImoveis, 22);
  // Por contagem: 2 de 22 = 9%, bem abaixo do piso.
  assert.ok(f.coberturaContagem < 0.1, `contagem devia ser baixa, veio ${f.coberturaContagem}`);
  // Por área: 200.000 de 202.000 m² = 99%, muito acima do piso.
  assert.ok(f.coberturaArea > 0.98, `área devia ser alta, veio ${f.coberturaArea}`);
  // A decisão segue a área, não a contagem — por isso o fundo pontua.
  assert.equal(f.ocupacao, 90, 'a cobertura por área devia liberar a ocupação');
});

test('o inverso também vale: muitos imóveis pequenos cobertos não escondem o resto do patrimônio', () => {
  const linhas = ['CNPJ_Fundo_Classe;Data_Referencia;Area;Percentual_Locado'];
  // Vinte imóveis pequenos, todos reportando 100%.
  for (let i = 0; i < 20; i++) linhas.push('11.728.688/0001-47;2026-06-30;100;1,00');
  // Um imóvel gigante, sem dado — é a maior parte da área e ninguém sabe a
  // ocupação dele.
  linhas.push('11.728.688/0001-47;2026-06-30;100000;');
  const parsed = P.parseCsvCvm(linhas.join('\n'));
  const f = P.extrairImoveisFii(parsed.registros, parsed.colunas).porCnpj.get('11728688000147');

  // Por contagem: 20 de 21 = 95%, passaria fácil.
  assert.ok(f.coberturaContagem > 0.9, `contagem devia ser alta, veio ${f.coberturaContagem}`);
  // Por área: 2.000 de 102.000 m² = 2%, quase nada do patrimônio explicado.
  assert.ok(f.coberturaArea < 0.05, `área devia ser baixa, veio ${f.coberturaArea}`);
  assert.equal(
    f.ocupacao,
    null,
    'a maior parte do patrimônio segue sem dado — não é hora de opinar'
  );
});

test('sem coluna de área nenhuma, a cobertura cai para contagem — pior que nada, melhor que sem piso', () => {
  const csv = [
    'CNPJ_Fundo_Classe;Data_Referencia;Percentual_Locado',
    '11.728.688/0001-47;2026-06-30;1,00',
    '11.728.688/0001-47;2026-06-30;1,00',
    '11.728.688/0001-47;2026-06-30;',
    '11.728.688/0001-47;2026-06-30;',
    '11.728.688/0001-47;2026-06-30;',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const f = P.extrairImoveisFii(parsed.registros, parsed.colunas).porCnpj.get('11728688000147');
  assert.equal(f.coberturaArea, null, 'sem área nenhuma, não há o que pesar');
  assert.equal(f.coberturaOcupacao, f.coberturaContagem, 'cai para a contagem');
  assert.equal(f.ocupacao, null, '2 de 5 fica abaixo do piso de qualquer forma');
});

// ════════════════════════════════════════════
// Crescimento do dividendo do FII
// ════════════════════════════════════════════
//
// O informe publica o YIELD (rendimento ÷ preço). A variação dele confunde
// mudança de distribuição com mudança de cotação — por isso o indicador
// ficou nulo até existir a série do rendimento POR COTA.

function serieFii(pontos) {
  return pontos.map(function (p) {
    return {
      dataReferencia: p[0] + '-01',
      dyMes: p[1] === undefined ? 0.8 : p[1],
      rendimentosDistribuir: p[2] === undefined ? null : p[2],
      numeroCotas: p[3] === undefined ? null : p[3],
      // O valor patrimonial da cota: quinta posição, porque o segundo
      // caminho do crescimento (DY × VPC) precisa dele.
      valorPatrimonialCota: p[4] === undefined ? null : p[4],
    };
  });
}

test('crescimento do dividendo sai do rendimento por cota, não do yield', () => {
  const pontos = [];
  // 12 meses antigos: R$ 1.000.000 para 1.000.000 de cotas = R$ 0,10/cota.
  for (let i = 1; i <= 12; i++) {
    pontos.push([`2024-${String(i).padStart(2, '0')}`, 0.8, 1000000, 1000000]);
  }
  // 12 meses recentes: R$ 1.200.000 para as mesmas cotas = R$ 0,12/cota.
  for (let i = 1; i <= 12; i++) {
    pontos.push([`2025-${String(i).padStart(2, '0')}`, 0.8, 1200000, 1000000]);
  }
  const r = P.indicadoresDaSerieFii(serieFii(pontos));
  assert.equal(r.crescimentoDividendo12m, 20, '0,10 → 0,12 por cota é +20%');
});

test('emissão de cotas dilui o rendimento por cota, e isso aparece', () => {
  const pontos = [];
  for (let i = 1; i <= 12; i++) {
    pontos.push([`2024-${String(i).padStart(2, '0')}`, 0.8, 1000000, 1000000]);
  }
  // Distribui o DOBRO em reais, mas com o quádruplo de cotas: por cota
  // caiu pela metade. É o número que interessa ao cotista.
  for (let i = 1; i <= 12; i++) {
    pontos.push([`2025-${String(i).padStart(2, '0')}`, 0.8, 2000000, 4000000]);
  }
  const r = P.indicadoresDaSerieFii(serieFii(pontos));
  assert.equal(r.crescimentoDividendo12m, -50, 'o total dobrou, por cota caiu 50%');
});

test('série curta não vira crescimento — a razão mediria a lacuna', () => {
  const pontos = [];
  for (let i = 1; i <= 12; i++) {
    pontos.push([`2025-${String(i).padStart(2, '0')}`, 0.8, 1000000, 1000000]);
  }
  // Só uma janela de 12 meses: não há com o que comparar.
  const r = P.indicadoresDaSerieFii(serieFii(pontos));
  assert.equal(r.crescimentoDividendo12m, null);
  // Mas os outros indicadores da série continuam saindo.
  assert.ok(r.dyMedio36m !== null, 'DY médio não depende do rendimento por cota');
});

test('sem rendimento a distribuir publicado, o crescimento é lacuna e o resto sobrevive', () => {
  const pontos = [];
  for (let i = 1; i <= 24; i++) {
    const ano = i <= 12 ? '2024' : '2025';
    const mes = String(((i - 1) % 12) + 1).padStart(2, '0');
    pontos.push([`${ano}-${mes}`, 0.8]); // sem rendimentos nem cotas
  }
  const r = P.indicadoresDaSerieFii(serieFii(pontos));
  assert.equal(r.crescimentoDividendo12m, null);
  assert.equal(r.mesesObservados, 24);
  assert.ok(r.dyMedio36m !== null);
  assert.equal(r.consistenciaDividendos, 100);
});

test('variação absurda é recusada — é mudança de estrutura, não distribuição', () => {
  const pontos = [];
  for (let i = 1; i <= 12; i++) {
    pontos.push([`2024-${String(i).padStart(2, '0')}`, 0.8, 1000, 1000000]);
  }
  // Mil vezes mais por cota: incorporação, não crescimento de aluguel.
  for (let i = 1; i <= 12; i++) {
    pontos.push([`2025-${String(i).padStart(2, '0')}`, 0.8, 1000000, 1000000]);
  }
  const r = P.indicadoresDaSerieFii(serieFii(pontos));
  assert.equal(r.crescimentoDividendo12m, null, 'fora da faixa vira lacuna, não número');
  // A trava tem de dizer o que recusou. O BTLG11 saiu com travessão tendo 31
  // meses de rendimento na execução real, e o log não distinguia "série
  // curta" de "número absurdo" — que pedem correções opostas: uma é alargar
  // a janela, a outra é procurar a coluna noutro lugar.
  assert.equal(r.crescimentoMotivo, 'fora_de_faixa');
  assert.ok(r.crescimentoBruto > 200, `o valor recusado tem de ir junto: ${r.crescimentoBruto}`);
});

test('saldo zerado num mês que rendeu é lacuna, não distribuição nula', () => {
  // `Rendimentos_Distribuir` é saldo de balanço. Num fundo que liquida
  // dentro do mês, ele fecha em zero mesmo tendo pago tudo — e foi assim que
  // o BTLG11 produziu −100% de crescimento pagando em 100% dos meses.
  const pontos = [];
  for (let i = 1; i <= 12; i++) pontos.push([`2024-${String(i).padStart(2, '0')}`, 0.8, 1000, 1e6]);
  // Doze meses com yield positivo E saldo zero: o fundo pagou, o saldo é que
  // não descreve o pagamento.
  for (let i = 1; i <= 12; i++) pontos.push([`2025-${String(i).padStart(2, '0')}`, 0.8, 0, 1e6]);
  const r = P.indicadoresDaSerieFii(serieFii(pontos));
  assert.equal(r.mesesSaldoQuitado, 12, 'os meses de saldo quitado têm de ser contados');
  assert.equal(
    r.crescimentoDividendo12m,
    null,
    'sem a janela recente não se inventa crescimento — mas também não se inventa queda'
  );
  assert.notEqual(r.crescimentoBruto, -100, 'o −100% falso não pode voltar a ser calculado');
  // E o log tem de dizer que a janela recente ficou vazia — é isso que
  // aponta para a coluna, não para o fundo.
  assert.equal(r.crescimentoMotivo, 'serie_curta');

  // Saldo zero com yield zero continua a ser um zero de verdade: o fundo
  // não distribuiu, e isso é dado, não contradição.
  const semPagar = [];
  for (let i = 1; i <= 24; i++) {
    semPagar.push([
      `202${i <= 12 ? 4 : 5}-${String(((i - 1) % 12) + 1).padStart(2, '0')}`,
      0,
      0,
      1e6,
    ]);
  }
  assert.equal(P.indicadoresDaSerieFii(serieFii(semPagar)).mesesSaldoQuitado, 0);
});

test('o segundo caminho recupera o fundo que liquida dentro do mês', () => {
  // O BTLG11 tem saldo zero em 29 dos 31 meses. Pelo saldo não há
  // crescimento a calcular; pelo yield sobre o valor patrimonial há, e é a
  // mesma grandeza — rendimento por cota — reconstruída de outra coluna.
  const pontos = [];
  // dyMes em %, VPC constante: 0,80% de 100 = R$ 0,80/cota; depois 0,88.
  for (let i = 1; i <= 12; i++) {
    pontos.push([`2024-${String(i).padStart(2, '0')}`, 0.8, 0, 1e6, 100]);
  }
  for (let i = 1; i <= 12; i++) {
    pontos.push([`2025-${String(i).padStart(2, '0')}`, 0.88, 0, 1e6, 100]);
  }
  const r = P.indicadoresDaSerieFii(serieFii(pontos));
  assert.equal(r.crescimentoDividendo12m, null, 'pelo saldo não dá — e não deve dar');
  assert.equal(r.mesesSaldoQuitado, 24);
  assert.ok(
    Math.abs(r.crescimentoPorDy - 10) < 0.05,
    `esperado ~+10% pelo DY×VPC, veio ${r.crescimentoPorDy}`
  );
});

test('a razão entre os dois caminhos é medida, não suposta', () => {
  // Onde os dois existem, a razão diz sobre que base a CVM calcula o yield.
  // Com o saldo montado para bater exatamente com DY × VPC, ela tem de dar 1
  // — é este número que, no dado real, confirma ou desmente a hipótese.
  const pontos = [];
  for (let i = 1; i <= 24; i++) {
    const mes = `202${i <= 12 ? 4 : 5}-${String(((i - 1) % 12) + 1).padStart(2, '0')}`;
    // 0,80% de VPC 100 = 0,80/cota; com 1e6 cotas, saldo de 800000.
    pontos.push([mes, 0.8, 800000, 1e6, 100]);
  }
  const r = P.indicadoresDaSerieFii(serieFii(pontos));
  assert.equal(r.razaoSaldoDy, 1, 'as duas leituras descrevem a mesma grandeza');
  assert.equal(r.mesesComparados, 24);
});

test('cada porta de saída do crescimento tem um motivo próprio', () => {
  // Recusar protege o ranking; só o motivo explica a fonte.
  const curta = [];
  for (let i = 1; i <= 10; i++) curta.push([`2025-${String(i).padStart(2, '0')}`, 0.8, 1000, 1e6]);
  assert.equal(P.indicadoresDaSerieFii(serieFii(curta)).crescimentoMotivo, 'serie_curta');

  const semDy = [];
  for (let i = 1; i <= 3; i++) semDy.push([`2025-0${i}`, 0.8, 1000, 1e6]);
  assert.equal(P.indicadoresDaSerieFii(serieFii(semDy)).crescimentoMotivo, 'poucos_meses');

  assert.equal(P.indicadoresDaSerieFii([]).crescimentoMotivo, 'sem_serie');

  // E quando dá certo, não há motivo nenhum a reportar.
  const boa = [];
  for (let i = 1; i <= 12; i++) boa.push([`2024-${String(i).padStart(2, '0')}`, 0.8, 1000, 1e6]);
  for (let i = 1; i <= 12; i++) boa.push([`2025-${String(i).padStart(2, '0')}`, 0.8, 1200, 1e6]);
  const ok = P.indicadoresDaSerieFii(serieFii(boa));
  assert.equal(ok.crescimentoMotivo, null);
  assert.equal(ok.crescimentoDividendo12m, 20);
});

test('as duas pontas vêm de membros diferentes do ZIP e são reunidas por mês', () => {
  // O `ativo_passivo` traz o rendimento; o `complemento` traz as cotas.
  // Nenhum dos dois sozinho permite a conta.
  const serie = [];
  for (let i = 1; i <= 12; i++) {
    const mes = `2024-${String(i).padStart(2, '0')}-01`;
    serie.push({ dataReferencia: mes, dyMes: 0.8, rendimentosDistribuir: null, numeroCotas: 1e6 });
    serie.push({ dataReferencia: mes, dyMes: null, rendimentosDistribuir: 1e5, numeroCotas: null });
  }
  for (let i = 1; i <= 12; i++) {
    const mes = `2025-${String(i).padStart(2, '0')}-01`;
    serie.push({ dataReferencia: mes, dyMes: 0.8, rendimentosDistribuir: null, numeroCotas: 1e6 });
    serie.push({
      dataReferencia: mes,
      dyMes: null,
      rendimentosDistribuir: 1.1e5,
      numeroCotas: null,
    });
  }
  const r = P.indicadoresDaSerieFii(serie);
  assert.ok(
    Math.abs(r.crescimentoDividendo12m - 10) < 0.05,
    `esperado ~+10%, veio ${r.crescimentoDividendo12m}`
  );
  assert.equal(r.mesesObservados, 24, 'o mês repartido entre membros conta uma vez');
});

test('travessão de série curta e travessão de coluna vazia são distinguíveis', () => {
  // As duas situações produzem `crescimentoDividendo12m: null` e pedem
  // correções OPOSTAS — uma é aumentar a janela, a outra é procurar a
  // coluna noutro lugar. Sem a contagem, o log não separa as duas.
  const curta = [];
  for (let i = 1; i <= 7; i++) {
    curta.push({
      dataReferencia: `2026-${String(i).padStart(2, '0')}-01`,
      dyMes: 0.8,
      rendimentosDistribuir: 1e5,
      numeroCotas: 1e6,
    });
  }
  const rCurta = P.indicadoresDaSerieFii(curta);
  assert.equal(rCurta.crescimentoDividendo12m, null);
  assert.equal(rCurta.mesesComRendimento, 7, 'série curta: o dado existe, faltam meses');

  const semColuna = [];
  for (let i = 1; i <= 24; i++) {
    const ano = i <= 12 ? '2024' : '2025';
    semColuna.push({
      dataReferencia: `${ano}-${String(((i - 1) % 12) + 1).padStart(2, '0')}-01`,
      dyMes: 0.8,
      rendimentosDistribuir: null,
      numeroCotas: 1e6,
    });
  }
  const rSem = P.indicadoresDaSerieFii(semColuna);
  assert.equal(rSem.crescimentoDividendo12m, null);
  assert.equal(rSem.mesesComRendimento, 0, 'coluna vazia: meses de sobra, dado nenhum');
});

// ════════════════════════════════════════════
// Tijolo ou papel
// ════════════════════════════════════════════
//
// Cobrar ocupação e contagem de imóveis de um fundo de recebíveis é o mesmo
// erro que cobrar EBITDA de um banco: o indicador não está ausente, ele não
// se aplica — e tratá-lo como ausente derruba a cobertura contra um fundo
// sem defeito nenhum.

test('carteira com imóvel é tijolo; sem imóvel e com carteira declarada é papel', () => {
  assert.equal(
    P.tipoCarteiraFii({ direitosBensImoveis: 5e8, totalInvestido: 7e8 }),
    'tijolo',
    'tem imóvel na carteira'
  );
  assert.equal(
    P.tipoCarteiraFii({ direitosBensImoveis: 0, totalInvestido: 1e9 }),
    'papel',
    'zero de imóvel COM carteira declarada'
  );
});

test('o que decide é a FATIA da carteira, não a presença de imóvel', () => {
  // "Tem algum imóvel → tijolo" classificou o MXRF11 como fundo de tijolo na
  // execução real: um fundo de recebíveis com dois imóveis marginais numa
  // carteira de 5,25 bi. Ele passava a ser cobrado por uma ocupação que não
  // descreve a receita dele, perdia cobertura, e o encolhimento do score o
  // punia por um defeito que não tem.
  assert.equal(
    P.tipoCarteiraFii({ direitosBensImoveis: 2e8, totalInvestido: 1e9 }),
    'papel',
    '20% da carteira em imóvel não faz um fundo de tijolo'
  );
  assert.equal(P.tipoCarteiraFii({ direitosBensImoveis: 8e8, totalInvestido: 1e9 }), 'tijolo');
  // Na fronteira, a maioria decide.
  assert.equal(P.tipoCarteiraFii({ direitosBensImoveis: 5e8, totalInvestido: 1e9 }), 'tijolo');
});

test('a fatia acompanha o tipo, para o log poder mostrar por que decidiu', () => {
  // Sem ela, "tijolo" num fundo de recebíveis com dois imóveis é
  // indistinguível de "tijolo" num galpão logístico — e foi assim que a
  // classificação errada passou uma rodada inteira sem ser notada.
  const c = P.carteiraFii({ direitosBensImoveis: 2e8, totalInvestido: 1e9 });
  assert.equal(c.tipo, 'papel');
  assert.equal(c.fracaoImoveis, 20);
  assert.equal(P.carteiraFii({}).fracaoImoveis, null);
});

test('ausência de dado não classifica — evidência positiva ou nada', () => {
  // Um fundo fora do informe pode ser de papel, mas também pode ser um que
  // simplesmente não entregou. Chutar "papel" apagaria indicadores válidos.
  assert.equal(P.tipoCarteiraFii({}), null, 'sem a rubrica imobiliária, não se decide');
  assert.equal(
    P.tipoCarteiraFii({ direitosBensImoveis: 0, totalInvestido: 0 }),
    null,
    'zero em tudo é fundo que não preencheu, não fundo de papel'
  );
  assert.equal(P.tipoCarteiraFii(null), null);
});

test('sem o agregado, as folhas do bloco imobiliário decidem', () => {
  assert.equal(
    P.tipoCarteiraFii({ terrenos: 1e7, imoveisRendaAcabados: 3e8, totalInvestido: 5e8 }),
    'tijolo'
  );
  assert.equal(
    P.tipoCarteiraFii({ terrenos: 0, imoveisRendaAcabados: 0, totalInvestido: 5e8 }),
    'papel'
  );
});

test('as colunas de carteira são de facto encontradas no cabeçalho real da CVM', () => {
  // Este teste existe porque o bug aconteceu: os campos foram acrescentados
  // ao objeto do registro mas NUNCA ao mapa de colunas. Resultado —
  // `acharColuna` devolvia undefined, todo fundo saía sem tipo, e nada
  // reclamou. Testar a extração com dado sintético em objeto não pegaria:
  // só o cabeçalho REAL, atravessando o parse, pega.
  const cab =
    'CNPJ_Fundo_Classe;Data_Referencia;Versao;Total_Necessidades_Liquidez;Disponibilidades;' +
    'Titulos_Publicos;Titulos_Privados;Fundos_Renda_Fixa;Total_Investido;Direitos_Bens_Imoveis;' +
    'Terrenos;Imoveis_Renda_Acabados;Imoveis_Renda_Construcao;Imoveis_Venda_Acabados;' +
    'Imoveis_Venda_Construcao;Outros_Direitos_Reais;Acoes;Debentures;CRI;LCI;' +
    'Rendimentos_Distribuir;Obrigacoes_Aquisicao_Imoveis;Obrigacoes_Securitizacao_Recebiveis;Total_Passivo';
  const csv = [
    cab,
    '11.728.688/0001-47;2026-07-01;1;0;0;0;0;0;7000000000;6500000000;100000000;6000000000;0;0;0;400000000;0;0;0;0;50000000;0;0;50000000',
    '16.706.958/0001-32;2026-07-01;1;0;0;0;0;0;10000000000;0;0;0;0;0;0;0;0;0;9000000000;1000000000;60000000;0;0;60000000',
  ].join('\n');
  const parsed = P.parseCsvCvm(csv);
  const r = P.extrairInformeFii(parsed.registros, parsed.colunas);

  assert.equal(r.colunas.direitosBensImoveis, 'Direitos_Bens_Imoveis', 'a coluna tem de resolver');
  assert.equal(r.colunas.totalInvestido, 'Total_Investido');
  assert.equal(P.tipoCarteiraFii(r.porCnpj.get('11728688000147')), 'tijolo');
  assert.equal(P.tipoCarteiraFii(r.porCnpj.get('16706958000132')), 'papel');
});
