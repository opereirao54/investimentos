'use strict';

// Proventos direto da B3 (api/market.js → mapB3Proventos, fetchB3Proventos).
//
// O Yahoo responde 429 aos servidores (Vercel e GitHub) e a GOOGLEFINANCE não
// traz proventos: sem outra fonte, a previsão de 12 meses, "Dividendos do
// mês" e o histórico ficavam vazios. A B3 publica os proventos por emissor;
// a classe (ON, PN, unit, FII) é separada pelo ISIN.

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const market = require(path.resolve(__dirname, '..', 'api', 'market.js'));
const { mapB3Proventos, fetchB3Proventos, classeIsinB3, b3Data, b3Num } = market.proventosB3;

const RESPOSTA_PETR = [
  {
    code: 'PETR',
    cashDividends: [
      {
        isinCode: 'BRPETRACNPR6',
        label: 'DIVIDENDO',
        rate: '0,45',
        lastDatePrior: '02/06/2026',
        paymentDate: '20/08/2026',
        approvedOn: '15/05/2026',
      },
      {
        isinCode: 'BRPETRACNOR9',
        label: 'DIVIDENDO',
        rate: '0,45',
        lastDatePrior: '02/06/2026',
        paymentDate: '20/08/2026',
      },
      {
        isinCode: 'BRPETRACNPR6',
        label: 'JRS CAP PROPRIO',
        rate: '0,3012',
        lastDatePrior: '21/08/2026',
        paymentDate: '',
      },
    ],
  },
];

test('B3: datas dd/mm/aaaa, valor com vírgula e tipo pelo rótulo', () => {
  assert.equal(b3Data('20/08/2026'), '2026-08-20');
  assert.equal(b3Num('0,45'), 0.45);
  assert.equal(b3Num('1.234,5'), 1234.5);
  assert.equal(b3Num(0.3), 0.3);
  const out = mapB3Proventos(RESPOSTA_PETR, 'PETR4');
  assert.deepEqual(
    out.map((p) => [p.data, p.dataCom, p.valor, p.tipo]),
    [
      ['2026-08-20', '2026-06-02', 0.45, 'DIVIDENDO'],
      // Sem data de pagamento, a data-com é a melhor aproximação.
      ['2026-08-21', '2026-08-21', 0.3012, 'JCP'],
    ]
  );
  assert.ok(out.every((p) => p.fonte === 'b3'));
});

test('B3: a classe vem do ISIN (PN não recebe o provento da ON, e vice-versa)', () => {
  assert.deepEqual(classeIsinB3('PETR4'), ['ACNPR']);
  assert.deepEqual(classeIsinB3('PETR3'), ['ACNOR']);
  assert.deepEqual(classeIsinB3('KLBN11'), ['CDAM', 'CTF', 'UNT']);
  const on = mapB3Proventos(RESPOSTA_PETR, 'PETR3');
  assert.equal(on.length, 1);
  assert.equal(on[0].valor, 0.45);
});

test('B3: FII sem nada como companhia é buscado no proxy de fundos', async () => {
  const pedidos = [];
  const f = async (url) => {
    pedidos.push(String(url));
    const corpo = /fundsProxy/.test(url)
      ? {
          cashDividends: [
            {
              isinCode: 'BRMXRFCTF008',
              label: 'RENDIMENTO',
              rate: '0,10',
              lastDatePrior: '30/09/2026',
              paymentDate: '14/10/2026',
            },
          ],
        }
      : [];
    return { ok: true, status: 200, text: async () => JSON.stringify(corpo) };
  };
  const out = await fetchB3Proventos('MXRF11', f);
  assert.equal(pedidos.length, 2);
  assert.match(pedidos[1], /GetListedSupplementFunds\//);
  const param = JSON.parse(Buffer.from(pedidos[1].split('/').pop(), 'base64').toString());
  assert.deepEqual(param, { cnpj: '0', identifierFund: 'MXRF', typeFund: 7 });
  assert.deepEqual(out, [
    {
      data: '2026-10-14',
      dataCom: '2026-09-30',
      dataPagamento: '2026-10-14',
      valor: 0.1,
      tipo: 'RENDIMENTO',
      fonte: 'b3',
    },
  ]);
});

test('B3: o pedido é por emissor, em base64, e a ação não cai no proxy de fundos', async () => {
  const pedidos = [];
  const f = async (url) => {
    pedidos.push(String(url));
    return { ok: true, status: 200, text: async () => JSON.stringify(RESPOSTA_PETR) };
  };
  await fetchB3Proventos('PETR4', f);
  assert.equal(pedidos.length, 1);
  const param = JSON.parse(Buffer.from(pedidos[0].split('/').pop(), 'base64').toString());
  assert.deepEqual(param, { issuingCompany: 'PETR', language: 'pt-br' });
});

test('proventos: B3 antes do Yahoo; se a B3 falhar, o motivo fica e o Yahoo tenta', async () => {
  const antes = process.env.BRAPI_TOKEN;
  delete process.env.BRAPI_TOKEN;
  try {
    const ok = async (url) =>
      /b3\.com\.br/.test(url)
        ? { ok: true, status: 200, text: async () => JSON.stringify(RESPOSTA_PETR) }
        : { ok: false, status: 429, json: async () => ({}) };
    const r = await market.fontes.fetchProventos(['PETR4'], [], 5000, ok);
    assert.equal(r.PETR4.fonte, 'b3');
    assert.equal(r.PETR4.pagamentos.length, 2);

    const erros = [];
    const falha = async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => '',
    });
    const r2 = await market.fontes.fetchProventos(['PETR4'], erros, 5000, falha);
    assert.equal(r2.PETR4, undefined);
    assert.deepEqual(
      erros.map((e) => `${e.fonte}:${e.erro}`),
      ['b3_div:b3_403', 'yahoo_div:yahoo_div_403']
    );
  } finally {
    if (antes !== undefined) process.env.BRAPI_TOKEN = antes;
  }
});

test('proventos: B3 sem nenhum provento vira erro com o formato (não grava lista vazia)', async () => {
  const antes = process.env.BRAPI_TOKEN;
  delete process.env.BRAPI_TOKEN;
  try {
    const vazio = async (url) =>
      /b3\.com\.br/.test(url)
        ? {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([{ code: 'PETR', cashDividends: [] }]),
          }
        : { ok: false, status: 429, json: async () => ({}) };
    const erros = [];
    const r = await market.fontes.fetchProventos(['PETR4'], erros, 5000, vazio);
    assert.equal(r.PETR4, undefined);
    assert.match(erros[0].erro, /^b3_vazio array\[1\] \{code,cashDividends\} cash=0/);
  } finally {
    if (antes !== undefined) process.env.BRAPI_TOKEN = antes;
  }
});
