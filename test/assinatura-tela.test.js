'use strict';

// Tela "Minha assinatura": cada estado responde UMA pergunta — "preciso
// pagar alguma coisa agora, e qual?".
//
// Mesma técnica de billing-report-swallowed.test.js: extrai as funções REAIS
// de web/appliquei-billing.js e roda num vm isolado, sem stubbar o app todo.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'appliquei-billing.js'), 'utf8');

function extract(name, kind) {
  const decl = (kind || 'function') + ' ' + name;
  const start = SRC.indexOf(decl);
  assert.notEqual(start, -1, name + ' não encontrada');
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1) + ';';
  }
  throw new Error('chaves de ' + name);
}

const FNS = [
  'escapeHtml',
  'fmtBRL',
  'fmtDate',
  'clamp',
  'pluralDays',
  'daysBetween',
  'isPaidWindow',
  'paymentStatusLabel',
  'statusBadge',
  'eventNote',
  'cardBrandLabel',
  'paymentMethodLabel',
  'billingTypeLabel',
  'acessoGarantidoTxt',
  'renderPrevistas',
  'renderUpcomingBlock',
  'renderHeroBlock',
  'renderPlanInfoBlock',
  'renderHistoryBlock',
];

function ctx() {
  const c = vm.createContext({ Date, Math, Number, String, isFinite, isNaN });
  vm.runInContext(extract('HISTORY_HIDDEN', 'var'), c);
  FNS.forEach((n) => vm.runInContext(extract(n), c));
  return c;
}
const C = ctx();

const AMANHA = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
const ONTEM = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
const ATE = new Date(Date.now() + 20 * 86400000).toISOString();

function me(extra) {
  return Object.assign(
    {
      access: { status: 'active', reason: 'paid' },
      subscriptionId: 'sub_1',
      subscriptionStatus: 'ACTIVE',
      paymentMethod: 'UNDEFINED',
      subscriptionBaseValueCents: 1500,
      accessExpiresAt: ATE,
      accessExpiresInDays: 20,
      upcomingCharges: [],
      payments: [],
    },
    extra
  );
}
const fatura = (status, date, extra) =>
  Object.assign(
    { date, amountCents: 1500, status, source: 'invoice', invoiceUrl: 'https://asaas/f' },
    extra
  );

test('cartão: fatura no prazo é cobrança automática, sem botão de pagar', () => {
  const html = C.renderUpcomingBlock(
    me({
      paymentMethod: 'CREDIT_CARD',
      cardBrand: 'VISA',
      cardLast4: '4242',
      upcomingCharges: [fatura('PENDING', AMANHA)],
    })
  );
  assert.match(html, /Cobrança automática/);
  assert.match(html, /Você não precisa fazer nada/);
  assert.doesNotMatch(html, /class="ma-cob-cta"/, 'sem botão grande de pagar');
  assert.doesNotMatch(html, /Aguardando pagamento/);
});

test('Pix/boleto no prazo: fatura disponível + acesso garantido, um botão só', () => {
  const html = C.renderUpcomingBlock(me({ upcomingCharges: [fatura('PENDING', AMANHA)] }));
  assert.match(html, /Fatura disponível/);
  assert.match(html, /acesso está garantido até/);
  assert.equal((html.match(/class="ma-cob-cta"/g) || []).length, 1);
});

test('várias em aberto: só a mais antiga tem botão', () => {
  const html = C.renderUpcomingBlock(
    me({
      access: { status: 'blocked', reason: 'overdue' },
      upcomingCharges: [fatura('PENDING', AMANHA), fatura('OVERDUE', ONTEM)],
    })
  );
  assert.match(html, /Fatura atrasada/);
  assert.equal((html.match(/class="ma-cob-cta"/g) || []).length, 1);
  assert.match(html, /mais antiga em aberto/);
});

test('cortesia sem assinatura: hero de cortesia, nada para pagar, valor R$ 0', () => {
  const m = me({
    subscriptionId: null,
    subscriptionStatus: null,
    access: { status: 'active', reason: 'courtesy' },
    courtesy: { active: true, permanent: true, until: null, daysLeft: null },
  });
  const hero = C.renderHeroBlock(m);
  assert.match(hero, /is-courtesy/);
  assert.match(hero, /Acesso Pro liberado/);
  assert.match(hero, /Não há nada para pagar/);
  assert.doesNotMatch(hero, /próxima cobrança/i);
  assert.equal(C.renderUpcomingBlock(m), '');
  assert.match(C.renderPlanInfoBlock(m), /Sem cobrança/);
});

test('cortesia COM assinatura viva: avisa que a fatura é real', () => {
  const m = me({
    access: { status: 'active', reason: 'courtesy' },
    courtesy: { active: true, permanent: true },
    upcomingCharges: [fatura('PENDING', AMANHA)],
  });
  assert.match(C.renderHeroBlock(m), /continua ativa e segue cobrando/);
  assert.match(C.renderUpcomingBlock(m), /acesso Pro é cortesia/);
});

test('histórico mostra só pagamentos realizados — sem "Pagar" duplicado', () => {
  const html = C.renderHistoryBlock(
    me({
      payments: [
        { status: 'PENDING', value: 15, dueDate: AMANHA, invoiceUrl: 'x' },
        { status: 'OVERDUE', value: 15, dueDate: ONTEM, invoiceUrl: 'x' },
        { status: 'DELETED', value: 15, dueDate: ONTEM },
        { status: 'RECEIVED', value: 15, paymentDate: ONTEM, billingType: 'PIX' },
      ],
    })
  );
  assert.match(html, /Pagamentos realizados \(1\)/);
  assert.match(html, /Pix/);
  assert.doesNotMatch(html, />Pagar</);
  assert.doesNotMatch(html, /Pendente|Atrasado|Cancelado/);
});

test('avulso gerado e não pago: link para concluir, com prazo de compensação', () => {
  const html = C.renderUpcomingBlock(
    me({
      subscriptionId: null,
      subscriptionStatus: null,
      paymentMode: 'one_shot',
      upcomingCharges: [fatura('PENDING', AMANHA, { oneShot: true })],
    })
  );
  assert.match(html, /Concluir pagamento/);
  assert.match(html, /somamos 30 dias/);
});
