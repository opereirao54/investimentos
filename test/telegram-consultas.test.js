'use strict';

// Paridade das consultas do bot (/saldo, /fatura, /mes) com o app.
//
// api/_lib/telegram-consultas.js é CÓPIA das regras do app, porque o servidor
// não carrega os classic scripts do navegador. Este arquivo sobe o app de
// verdade (sandbox vm, mundo do simulador com dado em todas as telas), roda as
// funções do app e as do servidor sobre o MESMO estado e exige o mesmo número.
// Se alguém mudar a regra de saldo, fatura ou resumo no app e esquecer o
// servidor, o bot passaria a mostrar um valor que a tela não mostra — e é aqui
// que isso aparece.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'api/_lib/telegram-consultas.js'));
const { criarMundo } = require('./_simulador.js');
const { estadoDe } = require('./_harness-integracao.js');

const HOJE = new Date();
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const centavos = (n) => Math.round(n * 100);

// O mundo do simulador + os casos de borda de cada regra.
function mundo() {
  const { s, ref } = criarMundo();
  const M = HOJE.getMonth();
  const A = HOJE.getFullYear();
  const arquivada = s.criarConta({ nome: 'Banco Velho', tipo: 'banco', saldoInicial: 300 });
  arquivada.arquivada = true;
  // Saldo inicial com data no futuro: ainda não vale.
  s.criarConta({
    nome: 'Inter',
    tipo: 'banco',
    saldoInicial: 999,
    dataSaldoInicial: ymd(new Date(A, M + 2, 1)),
  });
  const futuro = ymd(new Date(A, M, HOJE.getDate() + 5));
  s.transacoes.push(
    // receita com vencimento futuro: não está no caixa ainda
    {
      id: 'x1',
      categoria: 'receita',
      valor: 1200,
      contaId: ref.itau.id,
      banco: 'Itaú',
      mes: M,
      ano: A,
      dataVencimento: futuro,
    },
    // despesa paga em conta arquivada (vai para "fora")
    {
      id: 'x2',
      categoria: 'despesa_variavel',
      valor: 40,
      contaId: arquivada.id,
      banco: 'Banco Velho',
      mes: M,
      ano: A,
      pago: true,
      categoriaDespesa: 'lazer',
    },
    // banco digitado sem conta cadastrada, com acento e espaço diferente
    {
      id: 'x3',
      categoria: 'despesa_fixa',
      valor: 75.5,
      banco: '  Caixa  Econômica ',
      mes: M,
      ano: A,
      pago: true,
      categoriaDespesa: 'moradia',
    },
    // despesa fixa NÃO paga: fica fora do caixa, dentro do resumo do mês
    {
      id: 'x4',
      categoria: 'despesa_fixa',
      valor: 1800,
      contaId: ref.nubank.id,
      banco: 'Nubank',
      mes: M,
      ano: A,
      pago: false,
      categoriaDespesa: 'moradia',
    },
    // aporte externo: investimento sem saída de caixa
    {
      id: 'x5',
      categoria: 'investimento_fixo',
      valor: 500,
      origemExterna: true,
      mes: M,
      ano: A,
      pago: true,
    },
    // banco pelo alias da conta
    {
      id: 'x6',
      categoria: 'receita',
      valor: 10,
      banco: 'itau personnalite',
      mes: M,
      ano: A,
    },
    // sem banco nenhum: "a reconciliar"
    { id: 'x7', categoria: 'dividendo', valor: 33, mes: M, ano: A },
    // cartão sem categoria
    {
      id: 'x8',
      categoria: 'cartao_credito',
      cartaoId: ref.cartaoId,
      valor: 99.9,
      mes: M,
      ano: A,
      dataVencimento: ymd(new Date(A, M, 10)),
      pago: false,
    },
    // mês anterior
    {
      id: 'x9',
      categoria: 'despesa_variavel',
      valor: 61,
      contaId: ref.nubank.id,
      banco: 'Nubank',
      mes: M === 0 ? 11 : M - 1,
      ano: M === 0 ? A - 1 : A,
      pago: true,
      categoriaDespesa: 'alimentacao',
    }
  );
  ref.itau.aliases = ['itau personnalite'];
  return { s, ref };
}

// O estado como o servidor o recebe: JSON que veio do Firestore.
function dadosServidor(s) {
  return JSON.parse(JSON.stringify(estadoDe(s)));
}

test('saldo por conta: igual a mpCalcularSaldoPorInstituicao, em várias datas', () => {
  const { s } = mundo();
  const d = dadosServidor(s);
  for (const delta of [-40, -5, 0, 3, 6, 30]) {
    const ref = new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate() + delta, 15).getTime();
    const app = s.mpCalcularSaldoPorInstituicao(ref);
    const srv = C.saldoPorInstituicao(d, ref);
    assert.deepEqual(Object.keys(srv).sort(), Object.keys(app).sort(), `chaves em ${delta}`);
    for (const k of Object.keys(app)) {
      assert.equal(centavos(srv[k].caixa), centavos(app[k].caixa), `${k} em ${delta}`);
      assert.equal(srv[k].label, app[k].label, `rótulo de ${k}`);
    }
    // e o total do /saldo é o "Saldo em conta" do Patrimônio
    assert.equal(
      centavos(C.resumoSaldo(d, ref).total),
      centavos(s.mpCalcularSaldoTotal(ref)),
      `total em ${delta}`
    );
  }
});

test('saldo: conta arquivada e banco sem cadastro caem em "fora", e a soma fecha', () => {
  const { s } = mundo();
  const d = dadosServidor(s);
  const r = C.resumoSaldo(d, Date.now());
  assert.ok(!r.contas.some((c) => c.nome === 'Banco Velho'), 'arquivada não aparece como conta');
  assert.ok(Math.abs(r.fora) > 0, 'há saldo fora de conta ativa');
  const soma = r.contas.reduce((acc, c) => acc + c.saldo, 0) + r.fora;
  assert.equal(centavos(soma), centavos(r.total));
});

test('resumo do mês: igual a calcularResumoMes, despesas por categoria e resultado', () => {
  const { s } = mundo();
  const d = dadosServidor(s);
  for (let k = -2; k <= 2; k++) {
    const alvo = new Date(HOJE.getFullYear(), HOJE.getMonth() + k, 1);
    const m = alvo.getMonth();
    const a = alvo.getFullYear();
    const r = C.resumoMes(d, m, a);
    const app = s.calcularResumoMes(m, a);
    for (const campo of Object.keys(app)) {
      assert.equal(centavos(r.bruto[campo]), centavos(app[campo]), `${campo} em ${m}/${a}`);
    }
    const porCat = s.calcularDespesasPorCategoria(m, a);
    assert.deepEqual(
      Object.fromEntries(Object.entries(r.porCategoria).map(([c, v]) => [c, centavos(v)])),
      Object.fromEntries(Object.entries(porCat).map(([c, v]) => [c, centavos(v)])),
      `categorias em ${m}/${a}`
    );
    assert.equal(
      centavos(r.resultado),
      centavos(s.calcularResultadoMes(m, a)),
      `resultado ${m}/${a}`
    );
  }
});

test('faturas: mesmas datas de cartaoFaturasCandidatas e mesmo total/pago, todo dia do ano', () => {
  const { s } = mundo();
  const combinacoes = [
    [1, 10],
    [25, 5],
    [31, 10],
    [28, 28],
    [5, 31],
    [null, 15],
  ];
  const A = HOJE.getFullYear();
  s.cartoes = combinacoes.map(([f, v], i) => ({
    id: 'k' + i,
    nome: 'Cartão ' + i,
    diaFechamento: f,
    diaVencimento: v,
  }));
  // Um lançamento em cada fatura possível do ano, metade paga.
  for (let i = 0; i < combinacoes.length; i++) {
    for (let mes = -1; mes <= 13; mes++) {
      const venc = s.cartaoCalcularVencimento(
        new Date(A, mes, 1),
        combinacoes[i][0],
        combinacoes[i][1]
      );
      s.transacoes.push({
        id: `f${i}_${mes}`,
        categoria: 'cartao_credito',
        cartaoId: 'k' + i,
        valor: 10 + i + mes,
        dataVencimento: ymd(venc),
        mes: venc.getMonth(),
        ano: venc.getFullYear(),
        pago: mes % 2 === 0,
      });
    }
  }
  const d = dadosServidor(s);
  for (let dia = 0; dia < 366; dia++) {
    const hoje = new Date(A, 0, 1 + dia, 10);
    const srv = C.resumoFaturas(d, hoje);
    s.cartoes.forEach((c, i) => {
      const cand = s.cartaoFaturasCandidatas(hoje, c.diaFechamento, c.diaVencimento);
      const r = srv[i];
      const quando = `${ymd(hoje)} cartão ${i}`;
      assert.equal(r.aberta.vencimento, s.faturaYmd(cand.aberta.vencimento), quando);
      assert.equal(r.aberta.fechamento, s.faturaYmd(cand.aberta.fechamento), quando);
      assert.equal(r.fechada.vencimento, s.faturaYmd(cand.fechada.vencimento), quando);
      assert.equal(r.fechada.fechamento, s.faturaYmd(cand.fechada.fechamento), quando);
      for (const qual of ['aberta', 'fechada']) {
        const v = r[qual].vencimento;
        assert.equal(
          centavos(r[qual].total),
          centavos(s.faturaTotal(c.id, v)),
          `${quando} ${qual}`
        );
        assert.equal(r[qual].paga, s.faturaEstaPaga(c.id, v), `${quando} ${qual} paga`);
      }
    });
  }
});

test('faturas: cartão arquivado não aparece; sem dia de vencimento vira semDatas', () => {
  const d = {
    transacoes: [],
    cartoes: [
      { id: 'a', nome: 'Velho', diaFechamento: 1, diaVencimento: 10, arquivado: true },
      { id: 'b', nome: 'Sem dia', diaFechamento: 3 },
    ],
  };
  const r = C.resumoFaturas(d, new Date(2026, 9, 8));
  assert.equal(r.length, 1);
  assert.equal(r[0].nome, 'Sem dia');
  assert.equal(r[0].semDatas, true);
});

test('agoraBrasilia: o mês vira pelo relógio de Brasília, não pelo UTC do servidor', () => {
  // 01/11 01:30 UTC = 31/10 22:30 em Brasília (UTC−3, sem horário de verão).
  const a = C.agoraBrasilia(new Date('2026-11-01T01:30:00Z'));
  assert.equal(a.getFullYear(), 2026);
  assert.equal(a.getMonth(), 9);
  assert.equal(a.getDate(), 31);
  assert.equal(a.getHours(), 22);
  assert.equal(a.getMinutes(), 30);
});

test('dados vazios ou estranhos não estouram', () => {
  assert.deepEqual(C.resumoSaldo({}, Date.now()), { contas: [], fora: 0, total: 0 });
  assert.deepEqual(C.resumoFaturas({}, new Date()), []);
  const r = C.resumoMes({ transacoes: [null, {}, { mes: 1, ano: 2026 }] }, 1, 2026);
  assert.equal(r.resultado, 0);
});

// ─── saldo livre do mês (card do Controle Financeiro) ───────────────────────

test('saldo livre e saldo em conta: os mesmos números que o Controle desenha, em vários meses', () => {
  const { s, ref } = mundo();
  const M = HOJE.getMonth();
  const A = HOJE.getFullYear();
  const mesAnt = new Date(A, M - 1, 1);
  const mes2 = new Date(A, M - 2, 1);
  s.transacoes.push(
    // meses anteriores: o resultado deles vira o saldo trazido
    {
      id: 'sl1',
      categoria: 'receita',
      valor: 3000,
      contaId: ref.nubank.id,
      banco: 'Nubank',
      mes: mes2.getMonth(),
      ano: mes2.getFullYear(),
    },
    {
      id: 'sl2',
      categoria: 'despesa_variavel',
      valor: 1200,
      contaId: ref.nubank.id,
      banco: 'Nubank',
      mes: mesAnt.getMonth(),
      ano: mesAnt.getFullYear(),
      pago: true,
    },
    // resgate de investimento: entra como receita do mês
    {
      id: 'sl4',
      categoria: 'resgate_investimento',
      valor: 650,
      contaId: ref.nubank.id,
      banco: 'Nubank',
      mes: M,
      ano: A,
    },
    // transferência entre contas: fora do saldo livre
    {
      id: 'sl3',
      categoria: 'transferencia_saida',
      valor: 400,
      contaId: ref.nubank.id,
      banco: 'Nubank',
      mes: M,
      ano: A,
      pago: true,
    }
  );
  // Ajuste manual do saldo trazido no mês passado (o app guarda só os manuais).
  s.salvarMapaSaldoCarregado({
    [`${mesAnt.getFullYear()}-${mesAnt.getMonth()}`]: { valor: 777, manual: true },
  });

  const d = dadosServidor(s);
  d.saldoCarregado = JSON.parse(s.localStorage.getItem('futurorico_saldoCarregado') || '{}');

  let capturado = null;
  s.mobRenderInicio = (x) => (capturado = x);
  for (const alvo of [mes2, mesAnt, new Date(A, M, 1), new Date(A, M + 1, 1)]) {
    s.visaoMes = alvo.getMonth();
    s.visaoAno = alvo.getFullYear();
    capturado = null;
    s.atualizarTelaControle();
    assert.ok(capturado, 'a tela entregou os números');
    const srv = C.saldoLivreMes(d, alvo.getMonth(), alvo.getFullYear());
    const quando = `${alvo.getMonth() + 1}/${alvo.getFullYear()}`;
    assert.equal(
      Math.round(srv.livre * 100),
      Math.round(capturado.saldoLivre * 100),
      `livre ${quando}`
    );
    assert.equal(
      Math.round(srv.carregado * 100),
      Math.round(capturado.carregado * 100),
      `carregado ${quando}`
    );
  }
  // E o saldo em conta do mês corrente é o total do /saldo.
  s.visaoMes = M;
  s.visaoAno = A;
  s.atualizarTelaControle();
  assert.equal(
    Math.round(C.resumoSaldo(d, Date.now()).total * 100),
    Math.round(capturado.saldoConta * 100)
  );
});
