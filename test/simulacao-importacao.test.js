'use strict';

// Caça de furos na importação de fatura — a parte que entra no CI.
//
// O motor está em test/_sequencias-importacao.js, compartilhado com
// scripts/cacar-importacao.js (`npm run cacar:importacao`, que vai fundo:
// dezenas de milhares de sequências). Aqui rodam sementes fixas, rápidas e
// determinísticas, e uma trava por defeito que a caça achou:
//
//  1. importar os meses fora de ordem (novembro, depois outubro) criava de
//     novo as parcelas de novembro em diante;
//  2. "lançada na fatura errada, mover?" movia a parcela 2/12 de dezembro
//     para a 1/12 de novembro — dezembro perdia a parcela;
//  3. a regra de conflito de parcelas (P7) roubava o "(3/12)" de outra compra
//     na mesma loja, e a linha 3/12 era criada de novo;
//  4. o casamento era guloso pela ordem das linhas: "Juros R$ 13,60" levava o
//     "ótica 14" do Telegram e a ótica de R$ 13,92 entrava como nova;
//  5. a compra estornada lançada pelo Telegram com valor arredondado não era
//     reconhecida, e o lançamento órfão casava com outra compra;
//  6. R$ 52,00 contava como igual a R$ 51,99 (tolerância de 1 centavo);
//  7. "doceria 33" do Telegram casava pelo valor com a parcela "Auto Peças
//     4/7 R$ 33,00";
//  8. mover da fatura vizinha que já tinha sido importada fazia uma compra
//     sumir dela;
//  9. a compra à vista do Telegram casava com a parcela de outra compra na
//     mesma loja;
// 10. o estorno de "Pet Shop R$ 18,00" mandava apagar o "lanchonete 18" —
//     uma compra legítima;
// 11. "pet" não casava com "MP*PETSHOPAMIGOFIEL" (nome grudado da
//     maquininha): o "pet 109" estornado casava com outra compra no pet shop;
// 12. com duas compras no açougue (R$ 31,14 e uma estornada de R$ 31,48), o
//     aviso mandava apagar o "açougue 31" da legítima; e o "livraria 124"
//     estornado casava só pelo valor com uma compra de R$ 124,00 em outra loja;
// 13. (relato do fundador: duas faturas de novembro) com o cartão vencendo
//     noutro dia no app, a importação não via o que já estava no mês e abria
//     uma segunda fatura; e, corrigido isso, um mês anterior ainda em aberto
//     ficava no dia antigo e ganhava uma segunda fatura no lançamento seguinte.

const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../web/appliquei-importar-fatura.js');
const { rodarSequenciaImportacao } = require('./_sequencias-importacao.js');

// Sementes que já acharam defeito: rodam sempre.
const ACHADAS = [1, 8, 10, 13, 16, 716, 2213, 3175, 5133, 5739, 7588, 7770, 11762, 13791];
const SEMENTES_CI = Number(process.env.SEMENTES_IMPORTACAO) || 300;

test('caça: sementes que já acharam defeito', () => {
  for (const s of ACHADAS) {
    const r = rodarSequenciaImportacao(s, 30);
    assert.ok(
      r.ok,
      `semente ${s}, passo ${r.passo} (${r.acao}):\n${r.erro}\n${(r.log || []).join('\n')}`
    );
  }
});

test(`caça: ${SEMENTES_CI} sequências de 30 ações`, () => {
  for (let s = 1; s <= SEMENTES_CI; s++) {
    const r = rodarSequenciaImportacao(s, 30);
    assert.ok(
      r.ok,
      `semente ${s}, passo ${r.passo} (${r.acao}):\n${r.erro}\n${(r.log || []).join('\n')}`
    );
  }
});

// ── As travas, uma por defeito ─────────────────────────────────────────────

const CARTAO = 'card';
const NOV = '2026-11-05';
const DEZ = '2026-12-05';

function csv(linhas) {
  return F.lerArquivo(
    'date,title,amount\n' + linhas.map((l) => l.join(',')).join('\n') + '\n',
    'f.csv'
  );
}

function plano(arquivo, venc, transacoes, extra) {
  return F.planejar(
    Object.assign(
      { arquivo, vencimento: venc, cartaoId: CARTAO, transacoes, categorias: [] },
      extra
    )
  );
}

function tx(id, descricao, valor, venc, extra) {
  const [a, m] = venc.split('-').map(Number);
  return Object.assign(
    {
      id,
      descricao,
      valor,
      categoria: 'cartao_credito',
      cartaoId: CARTAO,
      dataVencimento: venc,
      mes: m - 1,
      ano: a,
      pago: false,
    },
    extra
  );
}

function importar(transacoes, arquivo, venc, extra) {
  const p = plano(arquivo, venc, transacoes, extra);
  F.confirmar(transacoes, p, {
    agora: new Date(2026, 9, 27),
    idBase: venc + Math.random().toString(36).slice(2),
  });
  return p;
}

const naFatura = (lista, venc) => lista.filter((t) => t.dataVencimento === venc);

test('trava 1: importar novembro e depois outubro não duplica as parcelas', () => {
  const lista = [];
  importar(lista, csv([['2026-10-28', 'TV Loja - Parcela 2/4', '100.00']]), DEZ); // dez: 2/4 a 4/4
  importar(lista, csv([['2026-10-01', 'TV Loja - Parcela 1/4', '100.00']]), NOV); // nov: 1/4 a 4/4?
  for (const v of [NOV, DEZ, '2027-01-05', '2027-02-05']) {
    assert.equal(
      naFatura(lista, v).length,
      1,
      `fatura ${v}: ${naFatura(lista, v).map((t) => t.descricao)}`
    );
  }
});

test('trava 2: a parcela da fatura vizinha não é "movida" para esta', () => {
  const dez = tx('d', 'Loja X (2/12)', 50, DEZ);
  const p = plano(csv([['2026-10-02', 'Loja X - Parcela 1/12', '50.00']]), NOV, [dez]);
  assert.equal(p.itens[0].status, 'nova');
  assert.equal(F.aplicar(p, { transacoes: [dez] }).alteracoes.length, 0);
});

test('trava 3: compra nova na mesma loja não rouba a parcela de outra compra', () => {
  const lista = [tx('a', 'Cinema Central (3/12)', 231, NOV, { importacao: { id: 'x' } })];
  const p = plano(
    csv([
      ['2026-10-02', 'Cinema Central - Parcela 1/10', '725.77'],
      ['2026-09-28', 'Cinema Central - Parcela 3/12', '231.00'],
    ]),
    NOV,
    lista
  );
  assert.deepEqual(
    p.itens.map((it) => it.status),
    ['nova', 'ja_lancada']
  );
});

test('trava 4: o casamento escolhe o melhor par, não a primeira linha', () => {
  const lista = [tx('o', 'ótica', 14, NOV)];
  const p = plano(
    csv([
      ['2026-10-01', 'Juros de dívida encerrada', '13.60'],
      ['2026-10-05', 'Ótica Visão', '13.92'],
    ]),
    NOV,
    lista
  );
  assert.equal(p.itens[0].status, 'nova', 'juros');
  assert.equal(p.itens[1].status, 'parecida', 'ótica');
});

test('trava 5 e 10: estorno avisa a compra certa — com nome, mesmo arredondada', () => {
  const arq = csv([
    ['2026-10-02', 'Academia Forma', '75.30'],
    ['2026-10-05', 'Estorno de "Academia Forma"', '-75.30'],
    ['2026-10-06', 'Lanchonete do Zé', '18.43'],
  ]);
  const p = plano(arq, NOV, [tx('ac', 'academia', 75, NOV), tx('la', 'lanchonete', 18, NOV)]);
  assert.match(p.itens[0].aviso, /"academia": apague/);
  assert.equal(p.itens[2].status, 'parecida', 'a lanchonete continua dela');
  // Sem nome em comum, nada de mandar apagar.
  const p2 = plano(
    csv([
      ['2026-10-02', 'Pet Shop', '18.00'],
      ['2026-10-05', 'Estorno de "Pet Shop"', '-18.00'],
    ]),
    NOV,
    [tx('la', 'lanchonete', 18, NOV)]
  );
  assert.equal(p2.itens[0].aviso, '');
});

test('trava 6: R$ 52,00 não é igual a R$ 51,99', () => {
  const p = plano(csv([['2026-10-02', 'Cabeleireiro', '51.99']]), NOV, [
    tx('e', 'esportes', 52, NOV),
  ]);
  assert.notEqual(p.itens[0].status, 'ja_lancada');
});

test('trava 7 e 9: parcela só casa com parcelado, à vista só com à vista', () => {
  const p = plano(
    csv([
      ['2026-09-28', 'Auto Pecas - Parcela 4/7', '33.00'],
      ['2026-10-05', 'Doceria Acucar', '33.24'],
    ]),
    NOV,
    [tx('d', 'doceria', 33, NOV)]
  );
  assert.equal(p.itens[0].status, 'nova', 'a parcela não pega o "doceria 33"');
  assert.equal(p.itens[1].status, 'parecida');
  const p2 = plano(
    csv([
      ['2026-09-28', 'Cabeleireiro Estilo - Parcela 2/11', '102.12'],
      ['2026-10-05', 'Cabeleireiro Estilo', '101.76'],
    ]),
    NOV,
    [tx('c', 'cabeleireiro', 102, NOV)]
  );
  assert.equal(p2.itens[0].status, 'nova');
  assert.equal(p2.itens[1].status, 'parecida');
});

test('trava 8: não move de uma fatura vizinha que já foi importada', () => {
  const dez = tx('c', 'Cinema Central', 55.9, DEZ);
  const arq = csv([['2026-10-02', 'Cinema Central', '55.90']]);
  assert.equal(plano(arq, NOV, [dez]).itens[0].status, 'outra_fatura');
  assert.equal(plano(arq, NOV, [dez], { faturasImportadas: [DEZ] }).itens[0].status, 'nova');
});

test('trava 11: "pet" reconhece o nome grudado da maquininha', () => {
  assert.ok(F.similaridade('pet', 'Petshopamigofiel') >= 0.5);
  const p = plano(
    csv([
      ['2026-10-02', 'MP*PETSHOPAMIGOFIEL', '109.00'],
      ['2026-10-05', 'Estorno de "MP*PETSHOPAMIGOFIEL"', '-109.00'],
      ['2026-10-06', 'PET SHOP AMIGO FIEL', '104.20'],
    ]),
    NOV,
    [tx('p', 'pet', 109, NOV)]
  );
  assert.match(p.itens[0].aviso, /"pet": apague/);
  assert.equal(p.itens[2].status, 'nova', 'a outra compra no pet shop entra');
});

test('trava 12: nome e valor mais perto decidem entre a compra estornada e a legítima', () => {
  const p = plano(
    csv([
      ['2026-10-02', 'Açougue São João', '31.48'],
      ['2026-10-05', 'Estorno de "Açougue São João"', '-31.48'],
      ['2026-10-06', 'Açougue São João', '31.14'],
    ]),
    NOV,
    [tx('a', 'açougue', 31, NOV)]
  );
  assert.equal(p.itens[0].aviso, '', 'não manda apagar o lançamento da compra legítima');
  assert.equal(p.itens[2].status, 'parecida');
  const p2 = plano(
    csv([
      ['2026-10-02', 'Livraria Leitura', '124.07'],
      ['2026-10-05', 'Estorno de "Livraria Leitura"', '-124.07'],
      ['2026-10-06', 'Auto Peças Centro', '124.00'],
    ]),
    NOV,
    [tx('l', 'livraria', 124, NOV)]
  );
  assert.match(p2.itens[0].aviso, /"livraria": apague/);
  assert.equal(p2.itens[2].status, 'nova', 'a compra de R$ 124,00 em outra loja entra');
});
