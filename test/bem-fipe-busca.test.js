'use strict';

// Busca única na FIPE ("civic 2020") do novo bem em passos. A API pública só
// anda por marca → modelo → ano; a busca acha a marca (pelo nome ou pelo
// modelo), filtra os modelos e, com ano, traz as opções com o valor. Aqui a
// API é o cache preenchido — o teste não sai para a rede.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

function mundo() {
  const s = carregarApp({}, ORDEM_CONTROLE.concat(['web/appliquei-bens.js']));
  const c = s._fipeCache;
  c['/carros/marcas'] = [
    { codigo: '25', nome: 'Honda' },
    { codigo: '23', nome: 'GM - Chevrolet' },
    { codigo: '59', nome: 'VW - VolksWagen' },
  ];
  c['/carros/marcas/25/modelos'] = {
    modelos: [
      { codigo: 1, nome: 'Civic EXL 2.0 Flex 16V Aut.' },
      { codigo: 2, nome: 'Civic LX 2.0 Flex 16V Aut.' },
      { codigo: 3, nome: 'City EX 1.5 Flex' },
    ],
  };
  c['/carros/marcas/25/modelos/1/anos'] = [
    { codigo: '2020-5', nome: '2020 Flex' },
    { codigo: '2019-5', nome: '2019 Flex' },
  ];
  c['/carros/marcas/25/modelos/2/anos'] = [{ codigo: '2020-5', nome: '2020 Flex' }];
  c['/carros/marcas/25/modelos/1/anos/2020-5'] = {
    Valor: 'R$ 112.400,00',
    MesReferencia: 'novembro de 2026 ',
  };
  c['/carros/marcas/25/modelos/2/anos/2020-5'] = { Valor: 'R$ 104.900,00' };
  return s;
}

test('interpreta o ano e as palavras', () => {
  const s = mundo();
  const q = s.fipeInterpretarBusca('  Civic EXL 2020 ');
  assert.equal(q.ano, '2020');
  assert.deepEqual(Array.from(q.palavras), ['civic', 'exl']);
});

test('acha a marca pelo modelo mais vendido ou pelo nome', () => {
  const s = mundo();
  const marcas = s._fipeCache['/carros/marcas'];
  assert.equal(s.fipeAcharMarca(marcas, ['civic']).nome, 'Honda');
  assert.equal(s.fipeAcharMarca(marcas, ['onix']).nome, 'GM - Chevrolet');
  assert.equal(s.fipeAcharMarca(marcas, ['chevrolet', 'xyz']).nome, 'GM - Chevrolet');
  assert.equal(s.fipeAcharMarca(marcas, ['banana']), null);
});

test('"civic 2020" traz os dois Civic de 2020 com o valor; o City fica de fora', async () => {
  const s = mundo();
  const res = await s.fipeBuscar('civic 2020', 'carros');
  assert.equal(res.length, 2);
  assert.match(res[0].modelo, /^Civic EXL/);
  assert.equal(res[0].anoCodigo, '2020-5');
  assert.equal(res[0].valor, 'R$ 112.400,00');
  assert.equal(res[1].valor, 'R$ 104.900,00');
});

test('sem ano: só os modelos, para escolher o ano depois', async () => {
  const s = mundo();
  const res = await s.fipeBuscar('honda civic exl', 'carros');
  assert.equal(res.length, 1);
  assert.equal(res[0].anoCodigo, '');
  assert.equal(await s.fipeBuscar('banana 2020', 'carros').then((r) => r.length), 0);
});
