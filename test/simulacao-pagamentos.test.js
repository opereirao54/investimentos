'use strict';

// Caça de furos em pagamentos e cupons — a parte que entra no CI.
//
// O motor está em test/_sequencias-pagamentos.js, compartilhado com
// scripts/cacar-pagamentos.js (`npm run cacar:pagamentos`, que vai fundo:
// milhares de sementes). Aqui rodam sementes fixas, rápidas e
// determinísticas, e uma trava por defeito que a caça achou:
//
//  1. duplo clique em "Assinar": o segundo request lia o billing ANTES da
//     trava e, se o primeiro terminasse no meio, criava outra assinatura;
//  2. estorno marcava INACTIVE só aqui — no Asaas a assinatura seguia
//     cobrando o cartão de quem já não tinha acesso, e assinar de novo
//     criava a segunda;
//  3. "Colocar desconto" do admin gravava só o contador: o desconto nunca
//     chegava a uma fatura e a reconciliação apagava;
//  4. estender o trial de quem já tem cobrança no Asaas não adiava a
//     cobrança — pagava por dias que eram grátis;
//  5. estorno/chargeback de cobrança de uma assinatura ANTERIOR era
//     descartado (billing não encontrado) — o crédito do indicador ficava;
//  6. auto-indicação: abrir a 2ª conta no próprio aparelho sem cupom e
//     mandar o cupom depois, de outro navegador, passava;
//  7. crédito partido (parte gasta, sobra pendente): o estorno anulava só o
//     original e a sobra seguia valendo desconto;
//  8. a sincronização dava como "apagada" a cobrança avulsa em aberto e
//     devolvia ao saldo o crédito usado nela — usado duas vezes.

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const { rodarSequenciaPagamentos } = require('./_sequencias-pagamentos.js');
const S = require('./_simulador-pagamentos.js');
const { call } = require('../scripts/lib/mock-billing');

after(() => S.restaurarRelogio());

const H = S.handlers;
const token = (uid, ua) => {
  const h = { authorization: 'Bearer fake:' + uid + ':' + uid + '@example.com' };
  if (ua) h['user-agent'] = ua;
  return h;
};
const subsAtivas = (uid) =>
  Array.from(S.asaasState.subscriptions.values()).filter(
    (s) => s.customer === S.billing(uid).customerId && s.status !== 'INACTIVE'
  );
const evento = (nome, p, status) => {
  if (status) p.status = status;
  return S.evento(nome, { payment: Object.assign({}, p) });
};
async function mudo(fn) {
  const orig = {};
  for (const k of ['log', 'warn', 'error']) {
    orig[k] = console[k];
    console[k] = () => {};
  }
  try {
    return await fn();
  } finally {
    Object.assign(console, orig);
  }
}

// Sementes que a caça já pegou, com os passos que a reproduziram.
const ACHADAS = [
  [134, 30],
  [3627, 40],
  [17326, 40],
];
for (const [semente, passos] of ACHADAS) {
  test(`pagamentos: sequência achada pela caça, semente ${semente}`, async () => {
    const r = await rodarSequenciaPagamentos(semente, passos);
    assert.equal(r.falhou, false, r.mensagem);
  });
}

test('pagamentos: 60 sequências aleatórias de 30 passos', async () => {
  for (let semente = 1; semente <= 60; semente++) {
    const r = await rodarSequenciaPagamentos(semente, 30);
    assert.equal(r.falhou, false, r.mensagem);
  }
});

test('1. duplo clique em Assinar cria UMA assinatura', async () => {
  await mudo(async () => {
    const m = S.criarMundoPagamentos();
    await S.criarConta(m, 'ana');
    // O pior encaixe: o 2º clique lê o billing e fica parado ANTES da trava
    // enquanto o 1º faz tudo (pega a trava, cria a assinatura, solta).
    const D = require('../api/_lib/firebase-admin').db();
    const original = D.runTransaction;
    let segurado;
    const bParado = new Promise((r) => (segurado = r));
    let soltar;
    const liberado = new Promise((r) => (soltar = r));
    let primeira = true;
    D.runTransaction = async (cb) => {
      if (primeira) {
        primeira = false;
        segurado();
        await liberado;
      }
      return original(cb);
    };
    try {
      const b = S.assinar(m, 'ana');
      await bParado;
      await S.assinar(m, 'ana');
      soltar();
      await b;
    } finally {
      D.runTransaction = original;
    }
    assert.equal(subsAtivas('ana').length, 1);
    assert.equal(S.problemas(m), '');
  });
});

test('2. estorno para a assinatura no Asaas; assinar de novo não duplica', async () => {
  await mudo(async () => {
    const m = S.criarMundoPagamentos();
    await S.criarConta(m, 'ana');
    await S.assinar(m, 'ana');
    const sub = S.billing('ana').subscriptionId;
    const p = S.faturaEmAberto('ana');
    await S.pagar('ana', p);
    await S.estornar('ana', p);
    assert.equal(S.asaasState.subscriptions.get(sub).status, 'INACTIVE', 'Asaas parou de cobrar');
    assert.equal(S.problemas(m), '');
    await S.assinar(m, 'ana');
    assert.equal(subsAtivas('ana').length, 1);
    assert.equal(S.problemas(m), '');
  });
});

test('3. desconto do admin vira crédito de verdade e chega à fatura', async () => {
  await mudo(async () => {
    const m = S.criarMundoPagamentos();
    await S.criarConta(m, 'ana');
    await S.assinar(m, 'ana');
    await S.anunciarFaturasNovas('ana');
    const r = await S.superpoder('set_discount', 'ana', 5);
    assert.equal(r.status, 200);
    const fatura = S.faturaEmAberto('ana');
    assert.equal(Math.round(fatura.value * 100), 1000, 'R$ 15,00 − R$ 5,00');
    assert.equal(S.problemas(m), '', 'contadores batem com os documentos');
    // Tirar o desconto que ainda não foi usado anula o crédito.
    await S.superpoder('set_discount', 'ana', 0);
    assert.equal(S.billing('ana').stats.pendingDiscountCents, 0);
    assert.equal(S.problemas(m), '');
  });
});

test('4. estender trial de quem já tem cobrança no Asaas é recusado', async () => {
  await mudo(async () => {
    const m = S.criarMundoPagamentos();
    await S.criarConta(m, 'ana');
    await S.assinar(m, 'ana');
    const r = await S.superpoder('extend_trial', 'ana');
    assert.equal(r.status, 409);
    assert.match(r.body.error, /Oferecer dias/);
    assert.equal(S.problemas(m), '');
  });
});

test('5. estorno de cobrança de assinatura anterior anula o crédito do indicador', async () => {
  await mudo(async () => {
    const m = S.criarMundoPagamentos();
    await S.criarConta(m, 'ana');
    await S.criarConta(m, 'bia', { cupom: S.billing('ana').referralCode });
    await S.assinar(m, 'bia');
    const antiga = S.faturaEmAberto('bia');
    await S.pagar('bia', antiga);
    assert.equal(S.creditos('ana').length, 1, 'ana ganhou o crédito');
    await S.cancelar('bia');
    await S.assinar(m, 'bia'); // assinatura nova: o billing aponta para ela
    await S.estornar('bia', antiga);
    assert.ok(
      S.creditos('ana').every((c) => c.voidedAt),
      'crédito do pagamento estornado anulado'
    );
    assert.equal(S.problemas(m), '');
  });
});

test('6. auto-indicação: conta aberta no aparelho do indicador não aceita o cupom depois', async () => {
  await mudo(async () => {
    const m = S.criarMundoPagamentos();
    await S.criarConta(m, 'ana');
    // bia abre a conta no aparelho da ana, sem cupom...
    await call(H.init, { headers: token('bia', 'test-ua/ana'), body: {} });
    // ...e manda o cupom depois, do próprio navegador.
    const r = await call(H.init, {
      headers: token('bia'),
      body: { referralCode: S.billing('ana').referralCode },
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'self_referral_not_allowed');
    assert.equal(S.billing('bia').referredByUserId || null, null);
  });
});

test('7. estorno anula também a sobra de um crédito partido', async () => {
  await mudo(async () => {
    const m = S.criarMundoPagamentos({ faturasProjetadas: 0 });
    await S.criarConta(m, 'ana');
    await S.criarConta(m, 'bia', { cupom: S.billing('ana').referralCode });
    await S.assinar(m, 'bia');
    const pago = S.faturaEmAberto('bia');
    await S.pagar('bia', pago); // ana ganha R$ 1,35
    // A sobra: reserva de R$ 0,35 parte o crédito em 0,35 gasto + 1,00 pendente.
    const { reservePendingCredits } = require('../api/_lib/credits');
    const ref = require('../api/_lib/firebase-admin')
      .db()
      .collection('users')
      .doc('ana')
      .collection('billing')
      .doc('account');
    await reservePendingCredits(ref, 35, 'pay_x');
    assert.equal(S.creditos('ana').length, 2, 'crédito partido');
    await S.estornar('bia', pago);
    assert.ok(
      S.creditos('ana').every((c) => c.voidedAt),
      'original e sobra anulados'
    );
  });
});

test('8. sincronizar não devolve o crédito usado numa avulsa ainda em aberto', async () => {
  await mudo(async () => {
    const m = S.criarMundoPagamentos();
    await S.criarConta(m, 'ana');
    await S.criarConta(m, 'bia', { cupom: S.billing('ana').referralCode });
    await S.assinar(m, 'bia');
    await S.pagar('bia', S.faturaEmAberto('bia')); // ana: R$ 1,35 de crédito
    await S.assinar(m, 'ana', { modo: 'avulso' }); // avulsa já com o abatimento
    const avulsa = S.cobrancas('ana').find((p) => !p.subscription);
    await evento('PAYMENT_CREATED', avulsa);
    // ana assina recorrente depois e paga; uma hora depois a sincronização
    // compara as cobranças locais com a lista DA ASSINATURA — onde a avulsa
    // não está.
    await S.assinar(m, 'ana');
    await S.pagar(
      'ana',
      S.cobrancas('ana').find((p) => p.subscription && p.status === 'PENDING')
    );
    S.avancarDias(1);
    await S.verMinhaConta('ana');
    const c = S.creditos('ana')[0];
    assert.equal(c.appliedToPaymentId, avulsa.id, 'o crédito continua preso à avulsa');
  });
});
