'use strict';

/**
 * Importar fatura do cartão (Nubank). Cada teste trava um risco da análise
 * em docs/IMPORTAR-FATURA.md — o código entre parênteses (A1, P3, D3...) é o
 * da tabela de lá.
 *
 * O arquivo de teste é uma fatura REAL do Nubank (OFX, vencimento 05/11/2026),
 * com nomes de pessoas e o número da conta trocados.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const F = require('../web/appliquei-importar-fatura.js');
const Insights = require('../web/appliquei-insights.js');
const Palavras = require('../web/appliquei-categorias-palavras.js');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado, formatar } = require('../scripts/lib/invariantes.js');

const OFX_NOME = 'Nubank_2026-11-05.ofx';
const OFX = fs.readFileSync(path.join(__dirname, 'fixtures', 'nubank', OFX_NOME));
const VENC = '2026-11-05';
const CARTAO = 'card_nu';
const CATEGORIAS = [
  'moradia',
  'alimentacao',
  'transporte',
  'saude',
  'educacao',
  'lazer',
  'cuidados_pessoais',
  'pets',
  'impostos_taxas',
].map((v) => ({ v, label: v }));

function compra(desc, valor, extra) {
  return Object.assign(
    {
      id: 'tx_' + desc.replace(/\W/g, '') + '_' + valor,
      descricao: desc,
      valor,
      categoria: 'cartao_credito',
      cartaoId: CARTAO,
      dataVencimento: VENC,
      mes: 10,
      ano: 2026,
      pago: false,
      data: '2026-10-10T12:00:00.000Z',
      obs: '',
    },
    extra || {}
  );
}

function plano(transacoes, arquivo, venc) {
  return F.planejar({
    arquivo: arquivo || F.lerArquivo(OFX, OFX_NOME),
    vencimento: venc || VENC,
    cartaoId: CARTAO,
    transacoes: transacoes || [],
    categorias: CATEGORIAS,
    insights: Insights,
    palavras: Palavras,
  });
}

function item(p, trecho) {
  const it = p.itens.find((x) => x.titulo.indexOf(trecho) !== -1);
  assert.ok(it, 'item não encontrado: ' + trecho);
  return it;
}

const AGORA = new Date(2026, 9, 27, 12, 0, 0);

function aplicar(p, transacoes) {
  return F.aplicar(p, { transacoes: transacoes || [], agora: AGORA, idBase: '1761570000000' });
}

// ── Leitura do arquivo ─────────────────────────────────────────────────────

test('OFX real do Nubank: 14 linhas, total da fatura e vencimento do nome', () => {
  const a = F.lerArquivo(OFX, OFX_NOME);
  assert.equal(a.formato, 'ofx');
  assert.equal(a.banco, 'nubank');
  assert.equal(a.linhas.length, 14);
  assert.equal(a.totalBanco, 725.11);
  assert.equal(a.vencimentoArquivo, VENC);
  const pag = a.linhas.find((l) => /Pagamento recebido/.test(l.titulo));
  assert.equal(pag.valor, -1450, 'crédito fica negativo');
  const rappi = a.linhas.find((l) => /Rappi/.test(l.titulo));
  assert.equal(rappi.valor, 27.45, 'compra fica positiva');
  assert.equal(rappi.data, '2026-10-24');
  assert.ok(rappi.fitid);
});

// Formato do CSV que o Nubank manda por e-mail: valor brasileiro entre aspas,
// compra positiva e o pagamento com espaço depois do sinal ("- 1.234,56").
// Lojas e valores inventados.
const CSV_NUBANK =
  'date,title,amount\n' +
  '2026-10-25,Padaria Exemplo,"18,40"\n' +
  '2026-10-24,Rappi*Rappi Brasil Int,"31,15"\n' +
  '2026-10-18,Loja Exemplo - Parcela 1/3,"27,30"\n' +
  '2026-10-01,Pagamento recebido,"- 2.450,75"\n' +
  '2026-09-28,Outra Loja - Parcela 6/10,"48,90"\n';

test('CSV no formato do Nubank: "18,40" entre aspas e pagamento "- 2.450,75"', () => {
  const a = F.lerArquivo(Buffer.from(CSV_NUBANK, 'utf8'), 'Nubank_2026-11-05.csv');
  assert.equal(a.formato, 'csv');
  assert.equal(a.vencimentoArquivo, VENC);
  assert.equal(a.totalBanco, null, 'o CSV não traz o total');
  assert.deepEqual(
    a.linhas.map((l) => l.valor),
    [18.4, 31.15, 27.3, -2450.75, 48.9]
  );
  const p = plano([], a);
  assert.equal(item(p, 'Pagamento').status, 'ignorada');
  assert.equal(F.resumo(p).totalBanco, 125.75, 'sem total no arquivo: a soma das compras');
});

test('(P6) CSV não tem FITID: reimportar o mesmo arquivo não duplica', () => {
  const a = F.lerArquivo(CSV_NUBANK, 'Nubank_2026-11-05.csv');
  const r1 = aplicar(plano([], a), []);
  assert.equal(r1.novos.length, 1 + 1 + 3 + 5);
  const p2 = plano(r1.novos, a);
  assert.equal(F.resumo(p2).qtdNovas, 0);
  assert.equal(F.resumo(p2).appDepois, 125.75);
});

test('(A3) acento: CSV salvo em Latin-1 e em UTF-8 leem igual', () => {
  const csv = 'date,title,amount\n2026-10-02,Café da Esquina,12.50\n';
  const latin = Buffer.from(csv, 'latin1');
  const utf = Buffer.from(csv, 'utf8');
  assert.equal(F.lerArquivo(latin, 'x.csv').linhas[0].titulo, 'Café da Esquina');
  assert.equal(F.lerArquivo(utf, 'x.csv').linhas[0].titulo, 'Café da Esquina');
});

test('(A5) CSV do Nubank: aspas com vírgula dentro e pagamento negativo', () => {
  const csv =
    'date,title,amount\r\n' +
    '2026-10-02,"Loja, filial 2",30.00\r\n' +
    '2026-10-03,"Bar ""do Zé""",15.5\r\n' +
    '2026-10-01,Pagamento recebido,-500.00\r\n';
  const a = F.lerArquivo(csv, 'Nubank_2026-11-05.csv');
  assert.equal(a.formato, 'csv');
  assert.deepEqual(
    a.linhas.map((l) => [l.titulo, l.valor]),
    [
      ['Loja, filial 2', 30],
      ['Bar "do Zé"', 15.5],
      ['Pagamento recebido', -500],
    ]
  );
  assert.equal(a.vencimentoArquivo, '2026-11-05');
});

test('(A4/A8) CSV aberto no Excel: ponto e vírgula, 1.234,56 e DD/MM/AAAA', () => {
  const csv = 'Data;Descrição;Valor\n02/10/2026;Geladeira;1.234,56\n03/10/2026;Pão;9,90\n';
  const a = F.lerArquivo(csv, 'fatura.csv');
  assert.deepEqual(
    a.linhas.map((l) => [l.data, l.valor]),
    [
      ['2026-10-02', 1234.56],
      ['2026-10-03', 9.9],
    ]
  );
});

test('CSV com a compra NEGATIVA: o pagamento (ou a maioria) decide o sinal', () => {
  const comPag = 'date,title,amount\n2026-10-02,Loja,-30\n2026-10-01,Pagamento recebido,200\n';
  assert.equal(F.lerArquivo(comPag, 'a.csv').linhas[0].valor, 30);
  const semPag =
    'date,title,amount\n2026-10-02,Loja,-30\n2026-10-03,Bar,-10\n2026-10-04,Estorno,5\n';
  const l = F.lerArquivo(semPag, 'a.csv').linhas;
  assert.deepEqual(
    l.map((x) => x.valor),
    [30, 10, -5]
  );
});

test('(A1/A6/A7) arquivos errados dão mensagem clara', () => {
  const erro = (entrada, nome) => {
    try {
      F.lerArquivo(entrada, nome || 'x');
      return null;
    } catch (e) {
      return e.codigo;
    }
  };
  assert.equal(erro('%PDF-1.4 ...'), 'pdf');
  assert.equal(
    erro(
      'OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRN><TRNAMT>-1</TRNAMT></STMTTRN></BANKMSGSRSV1></OFX>'
    ),
    'extrato_conta'
  );
  assert.equal(erro('nome,idade\nana,30\n'), 'formato');
  assert.equal(erro('date,title\n2026-10-01,Loja\n'), 'colunas');
  assert.equal(erro('date,title,amount\n'), 'vazio');
  assert.equal(erro(new Uint8Array(F.LIMITES.bytes + 1)), 'grande');
  const muitas = 'date,title,amount\n' + '2026-10-01,Loja,1\n'.repeat(F.LIMITES.linhas + 1);
  assert.equal(erro(muitas), 'grande');
});

test('(A4) número: formatos brasileiro, americano, R$ e negativo contábil', () => {
  assert.equal(F.numero('1.234,56'), 1234.56);
  assert.equal(F.numero('1234.56'), 1234.56);
  assert.equal(F.numero('1,234.56'), 1234.56);
  assert.equal(F.numero('R$ 9,90'), 9.9);
  assert.equal(F.numero('-12,50'), -12.5);
  assert.equal(F.numero('(12,50)'), -12.5);
  assert.equal(F.numero('1.500'), 1500);
  assert.ok(Number.isNaN(F.numero('abc')));
  assert.ok(Number.isNaN(F.numero('')));
});

test('(R1) parcela só no fim do título, dentro do limite do app', () => {
  assert.deepEqual(F.parcela('Otica Visao - Parcela 6/10'), {
    base: 'Otica Visao',
    n: 6,
    m: 10,
  });
  assert.equal(F.parcela('Loja 3/10'), null, 'sem a palavra Parcela não é parcela');
  assert.equal(F.parcela('Parcela 3/10 Loja'), null, 'no meio do título não');
  assert.equal(F.parcela('Loja - Parcela 0/3'), null);
  assert.equal(F.parcela('Loja - Parcela 5/3'), null);
  assert.equal(F.parcela('Loja - Parcela 3/60'), null, 'acima de 48');
  assert.equal(F.parcela('Loja - Parcela 1/1'), null);
});

test('(C3) descrição limpa: intermediador, apelido e MAIÚSCULAS', () => {
  assert.equal(F.limparDescricao('Rappi*Rappi Brasil Int'), 'Rappi');
  assert.equal(F.limparDescricao('Asa*Fulano de Tal Silva'), 'Fulano de Tal Silva');
  assert.equal(F.limparDescricao('Amazonmktplc*Lojaexemplo - Parcela 3/8'), 'Amazon');
  assert.equal(F.limparDescricao('Amazon Br *Amazon - Parcela 1/6'), 'Amazon');
  assert.equal(F.limparDescricao('Lanchonete Boa - NuPay'), 'Lanchonete Boa');
  assert.equal(F.limparDescricao('MP*LOJADOZE'), 'Lojadoze');
  assert.equal(F.limparDescricao('POSTO SHELL CENTRO'), 'Posto Shell Centro');
  assert.equal(F.limparDescricao('Posto Estrela'), 'Posto Estrela');
});

test('tipos: compra, encargo, pagamento, crédito, saldo anterior', () => {
  assert.equal(F.tipo('Posto Estrela', 120), 'compra');
  assert.equal(F.tipo('IOF de "Netflix"', 1.5), 'encargo');
  assert.equal(F.tipo('Juros de dívida encerrada', 12), 'encargo');
  assert.equal(F.tipo('Pagamento recebido', -100), 'pagamento');
  assert.equal(F.tipo('Estorno de "Loja"', -30), 'credito');
  assert.equal(F.tipo('Saldo em atraso', 200), 'saldo_anterior');
});

test('vencimento sem nome de arquivo: o próximo dia de vencimento do cartão', () => {
  const linhas = [{ data: '2026-10-20' }, { data: '2026-10-25' }];
  assert.equal(F.adivinharVencimento(linhas, 5), '2026-11-05');
  assert.equal(F.adivinharVencimento(linhas, 28), '2026-10-28');
  assert.equal(F.adivinharVencimento([{ data: '2027-01-31' }], 31), '2027-02-28');
  assert.equal(F.adivinharVencimento(linhas, null), null, 'sem o dia, a tela pede');
});

// ── Plano: casar com o que já está no app ──────────────────────────────────

test('fatura real num app vazio: 13 compras novas, pagamento fora, total bate', () => {
  const p = plano([]);
  const st = (s) => p.itens.filter((it) => it.status === s).length;
  assert.equal(st('nova'), 13);
  assert.equal(st('ignorada'), 1);
  const r = F.resumo(p);
  assert.equal(r.totalBanco, 725.11);
  assert.equal(r.appDepois, 725.11);
  assert.equal(r.diferenca, 0);
  // 13 compras: 6 à vista + parcelas 1/3(3) 1/6(6) 6/10(5) 2/3(2) 3/6(4) 3/10(8) 3/8(6)
  assert.equal(r.lancamentosCriados, 6 + 3 + 6 + 5 + 2 + 4 + 8 + 6);
});

test('(P1) compra lançada pelo Telegram com outro nome: já lançada, desmarcada', () => {
  const tx = [compra('mercado', 120, { idTelegram: 'tg1' })];
  const p = plano(tx);
  const it = item(p, 'Posto Estrela');
  assert.equal(it.status, 'ja_lancada');
  assert.equal(it.marcado, false);
  assert.equal(it.casadoCom, tx[0].id);
  assert.equal(F.resumo(p).appDepois, 725.11, 'não conta duas vezes');
});

test('(P3) duas compras iguais no arquivo e uma no app: uma já lançada, uma nova', () => {
  const csv = 'date,title,amount\n2026-10-02,Cafe Central,6.00\n2026-10-02,Cafe Central,6.00\n';
  const p = plano([compra('café', 6)], F.lerArquivo(csv, 'Nubank_2026-11-05.csv'));
  assert.deepEqual(p.itens.map((it) => it.status).sort(), ['ja_lancada', 'nova']);
});

test('(P4) valor parecido (50 × 49,90): "mesma compra" corrige o valor; "diferentes" importa', () => {
  const csv = 'date,title,amount\n2026-10-02,Padaria Bom Pao,49.90\n';
  const tx = [compra('padaria bom pão', 50)];
  const p = plano(tx, F.lerArquivo(csv, 'Nubank_2026-11-05.csv'));
  const it = p.itens[0];
  assert.equal(it.status, 'parecida');
  assert.equal(it.escolha, 'mesma', 'o padrão é a mesma compra');
  let r = aplicar(p, tx);
  assert.equal(r.novos.length, 0);
  assert.deepEqual(r.alteracoes, [{ id: tx[0].id, antes: { valor: 50 }, depois: { valor: 49.9 } }]);
  assert.equal(F.resumo(p).diferenca, 0, 'a fatura fecha com o banco');
  it.escolha = 'diferente'; // o usuário diz que são duas compras
  r = aplicar(p, tx);
  assert.equal(r.novos.length, 1);
  assert.equal(r.alteracoes.length, 0);
});

test('(P4) lançou "pão doce 18" pelo Telegram, o banco cobrou R$ 18,37: parecida', () => {
  // Achado na tela com a primeira fatura real: nome sem nada em comum e
  // centavos de diferença entravam como compra nova — a padaria ficava duas
  // vezes.
  const tx = [compra('pão doce', 18)];
  const p = plano(tx);
  const it = item(p, 'Padaria Sol Nascente');
  assert.equal(it.status, 'parecida');
  assert.equal(it.escolha, 'mesma');
  assert.equal(F.resumo(p).appDepois, 725.11, 'o "pão doce" vira R$ 18,37 e a fatura fecha');
  // Valor longe (R$ 30 × R$ 18,37) e nome diferente: são compras diferentes.
  assert.equal(item(plano([compra('pão doce', 30)]), 'Padaria Sol').status, 'nova');
});

test('(P5) lançada na fatura do mês seguinte: oferece mover; paga, não', () => {
  const csv = 'date,title,amount\n2026-10-28,Decathlon Morumbi,199.90\n';
  const arq = F.lerArquivo(csv, 'Nubank_2026-11-05.csv');
  const errada = compra('Decathlon', 199.9, {
    id: 'tx_dez',
    dataVencimento: '2026-12-05',
    mes: 11,
  });
  const p = plano([errada], arq);
  assert.equal(p.itens[0].status, 'outra_fatura');
  assert.equal(p.itens[0].escolha, 'mover');
  const r = aplicar(p, [errada]);
  assert.equal(r.novos.length, 0);
  assert.deepEqual(r.alteracoes, [
    {
      id: 'tx_dez',
      antes: { dataVencimento: '2026-12-05', mes: 11, ano: 2026 },
      depois: { dataVencimento: VENC, mes: 10, ano: 2026 },
    },
  ]);
  const paga = Object.assign({}, errada, { pago: true });
  assert.equal(plano([paga], arq).itens[0].status, 'nova', 'fatura paga não se mexe');
});

test('(P6/U15) importar a mesma fatura de novo: nada entra duas vezes', () => {
  const p1 = plano([]);
  const r1 = aplicar(p1, []);
  const tx = r1.novos;
  const p2 = plano(tx);
  assert.equal(p2.itens.filter((it) => it.status === 'nova').length, 0);
  assert.equal(aplicar(p2, tx).novos.length, 0);
  assert.equal(F.resumo(p2).appDepois, 725.11);
  assert.equal(F.jaImportada([r1.registro], CARTAO, VENC).id, r1.registro.id);
  assert.equal(F.jaImportada([r1.registro], CARTAO, '2026-12-05'), null);
});

test('(P2/D1) a fatura seguinte reconhece as parcelas que a importação criou', () => {
  const r1 = aplicar(plano([]), []);
  const dez =
    'date,title,amount\n' +
    '2026-11-28,Otica Visao - Parcela 7/10,58.70\n' +
    '2026-11-28,Esportes Total - Parcela 4/6,79.99\n' +
    '2026-11-20,Livraria Nova,40.00\n';
  const p = plano(r1.novos, F.lerArquivo(dez, 'Nubank_2026-12-05.csv'), '2026-12-05');
  assert.equal(item(p, 'Otica').status, 'ja_lancada');
  assert.equal(item(p, 'Esportes Total').status, 'ja_lancada');
  assert.equal(item(p, 'Livraria').status, 'nova');
});

test('(P7) parcela com contagem diferente no app: confere, não importa sozinho', () => {
  const tx = [compra('Esportes Total (3/5)', 79.99)];
  const p = plano(tx);
  const it = item(p, 'Esportes Total');
  assert.equal(it.status, 'conflito');
  assert.equal(it.marcado, false);
});

test('(D3a) estorno da mesma fatura anula a compra; lançada no app, avisa', () => {
  const csv =
    'date,title,amount\n' +
    '2026-10-02,Loja Esporte,120.00\n' +
    '2026-10-05,"Estorno de ""Loja Esporte""",-120.00\n' +
    '2026-10-06,Padaria,10.00\n';
  const arq = F.lerArquivo(csv, 'Nubank_2026-11-05.csv');
  const p = plano([], arq);
  assert.equal(item(p, 'Loja Esporte').status, 'anulada');
  assert.equal(item(p, 'Estorno').status, 'anulada');
  assert.equal(aplicar(p).novos.length, 1, 'só a padaria');

  const lancada = compra('tênis loja esporte', 120);
  const p2 = plano([lancada], arq);
  assert.match(item(p2, 'Loja Esporte').aviso, /apague/);
});

test('(D3b) estorno de compra de outra fatura: não entra, explica', () => {
  const csv = 'date,title,amount\n2026-10-05,Estorno de "Cinema",-30.00\n2026-10-06,Padaria,10\n';
  const p = plano([], F.lerArquivo(csv, 'Nubank_2026-11-05.csv'));
  const it = item(p, 'Cinema');
  assert.equal(it.status, 'credito_fora');
  assert.match(it.motivo, /compra original/);
  assert.equal(aplicar(p).novos.length, 1);
});

test('(U6/D2) assinatura fixa com preço novo: atualiza esta e as próximas não pagas', () => {
  const g = 'netflix_g';
  const tx = [
    compra('Netflix', 39.9, {
      id: 'nf_out',
      cartaoFixoMensal: true,
      groupId: g,
      dataVencimento: '2026-10-05',
      mes: 9,
      pago: true,
    }),
    compra('Netflix', 39.9, { id: 'nf_nov', cartaoFixoMensal: true, groupId: g }),
    compra('Netflix', 39.9, {
      id: 'nf_dez',
      cartaoFixoMensal: true,
      groupId: g,
      dataVencimento: '2026-12-05',
      mes: 11,
    }),
  ];
  const csv = 'date,title,amount\n2026-10-15,Netflix.Com,44.90\n';
  const p = plano(tx, F.lerArquivo(csv, 'Nubank_2026-11-05.csv'));
  const it = p.itens[0];
  assert.equal(it.status, 'reajuste');
  assert.equal(it.escolha, 'atualizar');
  const r = aplicar(p, tx);
  assert.equal(r.novos.length, 0);
  assert.deepEqual(
    r.alteracoes.map((a) => [a.id, a.depois.valor]),
    [
      ['nf_nov', 44.9],
      ['nf_dez', 44.9],
    ],
    'a de outubro já paga não muda'
  );
  assert.equal(F.resumo(p).appDepois, 44.9);
});

test('(D1/D4/INV-08) parcelas criadas: da atual até a última, no mês certo', () => {
  const r = aplicar(plano([]), []);
  const lav = r.novos.filter((t) => t.descricao.indexOf('Otica Visao') === 0);
  assert.deepEqual(
    lav.map((t) => [t.descricao, t.dataVencimento, t.mes, t.ano]),
    [
      ['Otica Visao (6/10)', '2026-11-05', 10, 2026],
      ['Otica Visao (7/10)', '2026-12-05', 11, 2026],
      ['Otica Visao (8/10)', '2027-01-05', 0, 2027],
      ['Otica Visao (9/10)', '2027-02-05', 1, 2027],
      ['Otica Visao (10/10)', '2027-03-05', 2, 2027],
    ]
  );
  assert.ok(lav.every((t) => t.valor === 58.7 && t.pago === false && t.cartaoId === CARTAO));
  assert.ok(
    lav.every((t) => t.groupId === lav[0].groupId),
    'mesmo grupo'
  );
  // D4: parcela antiga vem com a data do início do ciclo — não é a da compra.
  assert.ok(lav.every((t) => t.dataCompra === undefined));
  const merc = r.novos.filter((t) => t.descricao.indexOf('Auto Pecas Centro') === 0);
  assert.equal(merc.length, 3);
  assert.ok(
    merc.every((t) => t.dataCompra === '2026-10-17'),
    'parcela 1: data real'
  );
  const rappi = r.novos.find((t) => t.descricao === 'Rappi');
  assert.equal(rappi.dataCompra, '2026-10-24');
  assert.equal(rappi.obs, 'Rappi*Rappi Brasil Int', 'o título original fica guardado');
  const ids = r.novos.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'ids únicos');
  assert.ok(
    ids.every((id) => /^imp/.test(id)),
    'prefixo próprio, não colide com o manual'
  );
  assert.ok(r.novos.every((t) => t.importacao.id === r.registro.id));
});

test('(C1/C4) categoria: encargo, histórico do usuário antes das palavras, só visível', () => {
  const csv = 'date,title,amount\n2026-10-04,Posto Estrela,120\n2026-10-05,IOF de "Spotify",1.20\n';
  const arq = F.lerArquivo(csv, 'Nubank_2026-11-05.csv');
  assert.equal(item(plano([], arq), 'Posto').categoriaDespesa, 'transporte', 'palavra "posto"');
  assert.equal(item(plano([], arq), 'IOF').categoriaDespesa, 'impostos_taxas');
  // Uma correção basta para o histórico vencer a palavra.
  const corrigida = compra('Posto Estrela', 80, {
    id: 'old',
    dataVencimento: '2026-09-05',
    mes: 8,
    categoriaDespesa: 'lazer',
  });
  assert.equal(item(plano([corrigida], arq), 'Posto').categoriaDespesa, 'lazer');
  // Categoria escondida pelo usuário não é sugerida.
  const p = F.planejar({
    arquivo: arq,
    vencimento: VENC,
    cartaoId: CARTAO,
    transacoes: [],
    categorias: CATEGORIAS.filter((c) => c.v !== 'transporte'),
    insights: Insights,
    palavras: Palavras,
  });
  assert.equal(item(p, 'Posto').categoriaDespesa, null);
});

test('(G4) desfazer: tira só o que a importação criou e não foi pago', () => {
  const errada = compra('Decathlon', 199.9, {
    id: 'tx_dez',
    dataVencimento: '2026-12-05',
    mes: 11,
  });
  const manual = compra('manual', 7, { id: 'tx_manual' });
  const csv = 'date,title,amount\n2026-10-28,Decathlon,199.90\n2026-10-29,Livraria,40\n';
  const tx = [errada, manual];
  const p = plano(tx, F.lerArquivo(csv, 'Nubank_2026-11-05.csv'));
  const r = aplicar(p, tx);
  const depois = tx
    .map((t) => Object.assign({}, t))
    .concat(r.novos.map((t) => Object.assign({}, t)));
  F.aplicarAlteracoes(depois, r.alteracoes, 'depois');
  assert.equal(depois.find((t) => t.id === 'tx_dez').dataVencimento, VENC);
  const d = F.desfazer(depois, r.registro);
  assert.equal(d.removidos, 1);
  assert.equal(d.restaurados, 1);
  assert.deepEqual(
    d.transacoes.map((t) => [t.id, t.dataVencimento]),
    [
      ['tx_dez', '2026-12-05'],
      ['tx_manual', VENC],
    ]
  );
  // Já paga: fica, e o desfazer diz quantas ficaram.
  const comPaga = depois.map((t) => (t.importacao ? Object.assign({}, t, { pago: true }) : t));
  assert.equal(F.desfazer(comPaga, r.registro).mantidosPagos, 1);
});

// ── O fluxo inteiro na sandbox do app ─────────────────────────────────────

const ORDEM_IMPORTAR = ORDEM_CONTROLE.concat([
  'web/appliquei-insights.js',
  'web/appliquei-faturas.js',
  'web/appliquei-categorias-palavras.js',
  'web/appliquei-importar-fatura.js',
  'web/appliquei-importar-fatura-ui.js',
]);

function sandbox() {
  const win = carregarApp({}, ORDEM_IMPORTAR);
  win.contas = [{ id: 'conta_nu', nome: 'Nubank', tipo: 'corrente', saldoInicial: 0 }];
  win.cartoes = [
    { id: CARTAO, nome: 'Nubank', diaVencimento: 5, contaPagadoraId: 'conta_nu', arquivado: false },
  ];
  win.transacoes.length = 0;
  return win;
}

function importarNaSandbox(win) {
  win.impfatUi.cartaoId = CARTAO;
  win.impfatUi.arquivo = F.lerArquivo(OFX, OFX_NOME);
  win.impfatUi.arquivoNome = OFX_NOME;
  win.impfatUi.vencimento = VENC;
  win.impfatUi.passo = 'revisao';
  win.impfatUiReplanejar();
  win.impfatUiConfirmar();
}

test('fluxo no app: importa, a fatura bate com o Nubank e nenhuma invariante quebra', () => {
  const win = sandbox();
  win.transacoes.push(compra('mercado', 120, { id: 'tg_1', idTelegram: 'tg_1' }));
  importarNaSandbox(win);

  assert.equal(win.impfatUi.passo, 'feito');
  const fatura = win
    .faturasDoCartao(CARTAO, new Date(2026, 9, 27))
    .find((c) => c.vencimento === VENC);
  assert.equal(Math.round(fatura.total * 100) / 100, 725.11, 'fatura no app = fatura do Nubank');
  assert.equal(
    win.transacoes.filter((t) => t.descricao === 'Posto Estrela').length,
    0,
    'não duplicou'
  );

  const salvo = JSON.parse(win.localStorage.getItem('futurorico_transacoes'));
  assert.equal(salvo.length, win.transacoes.length, 'gravou tudo de uma vez');
  const regs = JSON.parse(win.localStorage.getItem('appliquei_importacoes_fatura'));
  assert.equal(regs.length, 1);

  const v = validarEstado(estadoDe(win), { apenas: ['INV-05', 'INV-08', 'INV-17', 'INV-20'] });
  assert.equal(v.length, 0, formatar(v));
});

test('fluxo no app: o mesmo arquivo de novo não cria nada; desfazer volta ao início', () => {
  const win = sandbox();
  importarNaSandbox(win);
  const depoisDaPrimeira = win.transacoes.length;
  assert.equal(depoisDaPrimeira, 40);

  win.impfatUi.passo = 'revisao';
  win.impfatUiReplanejar();
  assert.equal(win.AppliqueiImportarFatura.resumo(win.impfatUi.plano).qtdNovas, 0);

  win.impfatUi.passo = 'feito';
  win.impfatUi.registro = JSON.parse(win.localStorage.getItem('appliquei_importacoes_fatura'))[0];
  win.impfatUiDesfazer();
  assert.equal(win.transacoes.length, 0);
  assert.equal(JSON.parse(win.localStorage.getItem('futurorico_transacoes')).length, 0);
  assert.equal(JSON.parse(win.localStorage.getItem('appliquei_importacoes_fatura')).length, 0);
});

test('o lançamento importado tem os mesmos campos do lançado à mão no cartão', () => {
  const win = sandbox();
  const manual = win.criarLancamentos({
    descricao: 'Tênis',
    valor: 300,
    categoria: 'cartao_credito',
    cartaoId: CARTAO,
    tipoCartao: 'parcelado',
    parcelas: 3,
    dataVencimento: VENC,
    mesBase: 10,
    anoBase: 2026,
    agora: AGORA,
    idBase: '1',
  })[0];
  const importado = aplicar(plano([]), []).novos[0];
  const faltam = Object.keys(manual).filter((k) => !(k in importado));
  assert.deepEqual(faltam, [], 'campos do manual que o importado não tem');
  const extras = Object.keys(importado).filter((k) => !(k in manual));
  assert.deepEqual(extras.sort(), ['dataCompra', 'importacao'], 'só os dois campos novos');
});
