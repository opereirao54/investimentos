'use strict';

/**
 * Sequências aleatórias de PAGAMENTO e CUPOM — a caça de interações aplicada
 * ao dinheiro.
 *
 * `test/_sequencias.js` encadeia botões do app; este encadeia o que mexe em
 * dinheiro: criar conta com cupom do Applicash (ou com o próprio, ou com um
 * inventado), resgatar convite de testador (e tentar resgatar de novo com
 * outra conta), assinar no cartão, no boleto, avulso, com duplo clique,
 * com o CPF de outra pessoa; o Asaas pagando, vencendo, estornando,
 * contestando (chargeback), apagando fatura, repetindo o mesmo webhook,
 * mandando webhook forjado sem token; o admin dando e tirando acesso; o
 * relógio andando.
 *
 * Depois de CADA ação valem:
 *   - os invariantes de dinheiro do simulador (PAG01–PAG09, `verificar`);
 *   - os invariantes de cupom e fraude daqui (CUP01–CUP08, `verificarCupons`);
 *   - nenhum handler pode lançar exceção nem responder 5xx.
 *
 * Uma falha devolve a semente e a sequência exata — reproduz igual em
 * qualquer máquina. Uso:
 *   node scripts/cacar-pagamentos.js 500 30
 *
 * Ver .claude/skills/pagamentos/SKILL.md.
 */

const { rng } = require('./_sequencias.js');
const S = require('./_simulador-pagamentos.js');

const { store, asaasState, handlers: H } = S;
const { call } = require('../scripts/lib/mock-billing');

const PESSOAS = ['ana', 'bia', 'caio', 'duda'];
const REFERRAL_PERCENT = 10;
const DESCONTOS_LEGITIMOS = new Set([0, 10, 50]);
// Espelha INDICATOR_BLOCKED_STATUSES de api/billing/webhook.js (regra A6).
const BLOQUEIA_INDICADOR = new Set([
  'INACTIVE',
  'CHARGEBACK',
  'CHARGEBACK_REVERSAL_PENDING',
  'PAYMENT_REPROVED',
]);
const ADMIN_TOKEN = 'admin_test_token';
const WEBHOOK_OK = { 'asaas-access-token': 'test_webhook_token' };

function escolher(r, lista) {
  return lista[Math.floor(r() * lista.length)];
}
function existe(uid) {
  return !!S.billing(uid).uid;
}
function contas() {
  return PESSOAS.filter(existe);
}
function token(uid) {
  return { authorization: 'Bearer fake:' + uid + ':' + uid + '@example.com' };
}

async function admin(body) {
  process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
  return call(H.adminAction, { headers: { authorization: 'Bearer ' + ADMIN_TOKEN }, body });
}

/** Foto serializável de todo o estado — para provar que algo NÃO mudou nada. */
function foto() {
  const docs = {};
  for (const [k, v] of store.docs) docs[k] = v;
  const pays = {};
  for (const [k, v] of asaasState.payments) pays[k] = v;
  const subs = {};
  for (const [k, v] of asaasState.subscriptions) subs[k] = v;
  return JSON.stringify({ docs, pays, subs }, (_k, v) =>
    v && typeof v === 'object' && typeof v.toMillis === 'function' ? 'ts:' + v.toMillis() : v
  );
}

/** Webhook que o Asaas mandaria para `p` agora, com o status dado. */
async function webhookPagamento(m, nome, p, status, idEvento) {
  if (status) p.status = status;
  p.__avisada = true;
  const corpo = {
    id: idEvento || nome + ':' + p.id + ':' + asaasState.seq++,
    event: nome,
    payment: Object.assign({}, p),
  };
  m.ultimoWebhook = corpo;
  return call(H.webhook, { headers: WEBHOOK_OK, body: corpo });
}

function pagas(uid) {
  return S.cobrancas(uid).filter((p) => p.status === 'CONFIRMED' || p.status === 'RECEIVED');
}
function abertas(uid) {
  return S.cobrancas(uid).filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE');
}

// ---------------------------------------------------------------------------
// Catálogo. Cada ação devolve a descrição do que fez, ou null se não se aplica
// ao estado atual (o motor sorteia outra). A resposta HTTP vai em m.resposta
// para o motor conferir 5xx.
// ---------------------------------------------------------------------------

const ACOES = [
  // ---- contas e cupons ----
  async function criarContaSemCupom(m, r) {
    const uid = escolher(
      r,
      PESSOAS.filter((u) => !existe(u))
    );
    if (!uid) return null;
    m.resposta = await S.criarConta(m.mundo, uid);
    return 'criar conta ' + uid + ' sem cupom';
  },
  async function criarContaComCupomApplicash(m, r) {
    const uid = escolher(
      r,
      PESSOAS.filter((u) => !existe(u))
    );
    const ind = escolher(
      r,
      contas().filter((u) => S.billing(u).referralCode)
    );
    if (!uid || !ind) return null;
    m.resposta = await S.criarConta(m.mundo, uid, { cupom: S.billing(ind).referralCode });
    m.pares.push([ind, uid]);
    return 'criar conta ' + uid + ' com o cupom de ' + ind;
  },
  async function cupomDepoisDaContaCriada(m, r) {
    // A conta já existe e manda um cupom — inclusive o PRÓPRIO.
    const uid = escolher(r, contas());
    const dono = escolher(
      r,
      contas().filter((u) => S.billing(u).referralCode)
    );
    if (!uid || !dono) return null;
    m.resposta = await call(H.init, {
      headers: token(uid),
      body: { referralCode: S.billing(dono).referralCode },
    });
    return (
      uid + ' manda o cupom de ' + (dono === uid ? 'si mesmo' : dono) + ' com a conta já criada'
    );
  },
  async function contaGemeaNoMesmoAparelho(m, r) {
    // Auto-indicação: a mesma pessoa, do MESMO aparelho, abre outra conta (ou
    // usa uma que já tem) com o próprio cupom para ganhar os 10% dos dois lados.
    const ind = escolher(
      r,
      contas().filter((u) => S.billing(u).referralCode)
    );
    const uid = escolher(
      r,
      PESSOAS.filter((u) => u !== ind)
    );
    if (!ind || !uid) return null;
    const nova = !existe(uid);
    // Às vezes cria a conta no aparelho dela SEM cupom (passa) e manda o
    // cupom depois, de outro navegador.
    const semCupom = nova && r() < 0.5;
    m.resposta = await call(H.init, {
      headers: Object.assign(token(uid), { 'user-agent': 'test-ua/' + ind }),
      body: semCupom ? {} : { referralCode: S.billing(ind).referralCode },
    });
    if (nova) m.mundo.pessoas.set(uid, { uid, cpf: m.proximoCpf() });
    return (
      uid +
      (nova ? ' (nova)' : '') +
      (semCupom ? ' abre conta sem cupom' : ' usa o cupom de ' + ind) +
      ' no aparelho de ' +
      ind
    );
  },
  async function cupomEConviteJuntos(m, r) {
    // Empilhar benefícios: convite de testador (50%) + cupom (10%).
    const codigo = escolher(r, m.convites);
    const ind = escolher(
      r,
      contas().filter((u) => S.billing(u).referralCode)
    );
    const uid = escolher(
      r,
      PESSOAS.filter((u) => u !== ind)
    );
    if (!codigo || !ind || !uid) return null;
    const nova = !existe(uid);
    m.resposta = await call(H.init, {
      headers: token(uid),
      body: { convite: codigo, referralCode: S.billing(ind).referralCode },
    });
    if (nova) m.mundo.pessoas.set(uid, { uid, cpf: m.proximoCpf() });
    if (S.billing(uid).referredByUserId === ind) m.pares.push([ind, uid]);
    return uid + ' manda convite ' + codigo + ' e o cupom de ' + ind + ' juntos';
  },
  async function criarContaComCupomInventado(m, r) {
    const uid = escolher(
      r,
      PESSOAS.filter((u) => !existe(u))
    );
    if (!uid) return null;
    const cupom = escolher(r, [
      'APP-ZZZZZZ',
      'app-xxxxxx',
      'APP-',
      "APP-' OR 1=1",
      'A'.repeat(300),
    ]);
    m.resposta = await call(H.init, { headers: token(uid), body: { referralCode: cupom } });
    m.mundo.pessoas.set(uid, { uid, cpf: m.proximoCpf() });
    return 'criar conta ' + uid + ' com cupom inventado ' + JSON.stringify(cupom.slice(0, 20));
  },
  async function gerarConvite(m) {
    if (m.convites.length >= 3) return null;
    const res = await admin({ action: 'convites_gerar', quantidade: 1, nota: 'caça' });
    m.resposta = res;
    const novo = res.body && res.body.criados && res.body.criados[0];
    if (novo) m.convites.push(typeof novo === 'string' ? novo : novo.codigo);
    return 'admin gera um convite';
  },
  async function resgatarConvite(m, r) {
    // Conta nova OU já existente (vira testador), convite livre OU já usado.
    const codigo = escolher(r, m.convites);
    const uid = escolher(r, PESSOAS);
    if (!codigo || !uid) return null;
    const nova = !existe(uid);
    m.resposta = await call(H.init, { headers: token(uid), body: { convite: codigo } });
    if (nova) m.mundo.pessoas.set(uid, { uid, cpf: m.proximoCpf() });
    return uid + (nova ? ' (nova)' : ' (já com conta)') + ' resgata o convite ' + codigo;
  },
  async function adminCancelaConvite(m, r) {
    const codigo = escolher(r, m.convites);
    if (!codigo) return null;
    m.resposta = await admin({ action: 'convites_cancelar', codigo });
    return 'admin cancela o convite ' + codigo;
  },
  async function adminDefineLancamento(m, r) {
    const d = new Date(store.now + Math.floor(r() * 60 - 30) * S.DIA).toISOString().slice(0, 10);
    m.resposta = await admin({ action: 'convites_lancamento', data: d });
    return 'admin define a data de lançamento ' + d;
  },

  // ---- assinar ----
  async function assinar(m, r) {
    const uid = escolher(r, contas());
    if (!uid) return null;
    const modo = r() < 0.35 ? 'avulso' : undefined;
    const cartao = r() < 0.5;
    m.resposta = await S.assinar(m.mundo, uid, { modo, cartao });
    return uid + ' assina ' + (modo || 'recorrente') + (cartao ? ' no cartão' : ' no PIX/boleto');
  },
  async function assinarDuploClique(m, r) {
    const uid = escolher(r, contas());
    if (!uid) return null;
    const cartao = r() < 0.5;
    const modo = r() < 0.35 ? 'avulso' : undefined;
    const [a, b] = await Promise.all([
      S.assinar(m.mundo, uid, { modo, cartao }),
      S.assinar(m.mundo, uid, { modo, cartao }),
    ]);
    m.resposta = a.status >= 500 ? a : b;
    return uid + ' clica duas vezes em assinar (' + (modo || 'recorrente') + ')';
  },
  async function assinarComCpfDeOutro(m, r) {
    const uid = escolher(r, contas());
    const outro = escolher(
      r,
      contas().filter((u) => u !== uid && S.billing(u).cpfCnpj)
    );
    if (!uid || !outro) return null;
    const p = m.mundo.pessoas.get(uid) || { uid };
    const cpfReal = p.cpf;
    p.cpf = S.billing(outro).cpfCnpj;
    m.mundo.pessoas.set(uid, p);
    m.resposta = await S.assinar(m.mundo, uid, { cartao: r() < 0.5 });
    p.cpf = cpfReal;
    return uid + ' tenta assinar com o CPF de ' + outro;
  },
  async function cancelar(m, r) {
    const uid = escolher(
      r,
      contas().filter((u) => S.billing(u).subscriptionId)
    );
    if (!uid) return null;
    m.resposta = await S.cancelar(uid);
    return uid + ' cancela a assinatura';
  },

  // ---- o Asaas ----
  async function anunciarFaturas(m, r) {
    const uid = escolher(
      r,
      contas().filter((u) => S.cobrancas(u).some((p) => !p.__anunciada))
    );
    if (!uid) return null;
    await S.anunciarFaturasNovas(uid);
    return 'Asaas anuncia as faturas novas de ' + uid;
  },
  async function pagarFatura(m, r) {
    const uid = escolher(
      r,
      contas().filter((u) => abertas(u).length)
    );
    if (!uid) return null;
    // Às vezes a primeira, às vezes uma qualquer (pagou a do mês que vem antes).
    const lista = abertas(uid).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    const p = r() < 0.7 ? lista[0] : escolher(r, lista);
    const duplo = r() < 0.7;
    await webhookPagamento(m, 'PAYMENT_CONFIRMED', p, 'CONFIRMED');
    m.resposta = duplo ? await webhookPagamento(m, 'PAYMENT_RECEIVED', p, 'RECEIVED') : m.resposta;
    p.paymentDate = new Date(store.now).toISOString().slice(0, 10);
    return (
      uid + ' paga a fatura ' + p.id + ' de ' + p.dueDate + (duplo ? ' (CONFIRMED+RECEIVED)' : '')
    );
  },
  async function cartaoCapturadoAvisa(m, r) {
    // Cobrança que nasceu CONFIRMED no cartão e cujo webhook ainda não veio.
    const uid = escolher(
      r,
      contas().filter((u) => S.cobrancas(u).some((p) => p.status === 'CONFIRMED' && !p.__avisada))
    );
    if (!uid) return null;
    const p = S.cobrancas(uid).find((x) => x.status === 'CONFIRMED' && !x.__avisada);
    p.__avisada = true;
    m.resposta = await webhookPagamento(m, 'PAYMENT_CONFIRMED', p);
    return 'Asaas avisa a captura do cartão de ' + uid + ' (' + p.id + ')';
  },
  async function vencerFatura(m, r) {
    const uid = escolher(
      r,
      contas().filter((u) => abertas(u).some((p) => p.status === 'PENDING'))
    );
    if (!uid) return null;
    const p = abertas(uid).find((x) => x.status === 'PENDING');
    m.resposta = await webhookPagamento(m, 'PAYMENT_OVERDUE', p, 'OVERDUE');
    return 'fatura ' + p.id + ' de ' + uid + ' vence';
  },
  async function estornar(m, r) {
    const uid = escolher(
      r,
      contas().filter((u) => pagas(u).length)
    );
    if (!uid) return null;
    const p = escolher(r, pagas(uid));
    m.resposta = await webhookPagamento(m, 'PAYMENT_REFUNDED', p, 'REFUNDED');
    return 'estorno da cobrança paga ' + p.id + ' de ' + uid;
  },
  async function chargeback(m, r) {
    const uid = escolher(
      r,
      contas().filter((u) => pagas(u).length)
    );
    if (!uid) return null;
    const p = escolher(r, pagas(uid));
    m.resposta = await webhookPagamento(
      m,
      'PAYMENT_CHARGEBACK_REQUESTED',
      p,
      'CHARGEBACK_REQUESTED'
    );
    return 'chargeback da cobrança ' + p.id + ' de ' + uid;
  },
  async function asaasApagaFatura(m, r) {
    const uid = escolher(
      r,
      contas().filter((u) => abertas(u).length)
    );
    if (!uid) return null;
    const p = escolher(r, abertas(uid));
    const res = await webhookPagamento(m, 'PAYMENT_DELETED', p, 'DELETED');
    m.resposta = res;
    return 'Asaas apaga a fatura em aberto ' + p.id + ' de ' + uid;
  },
  async function asaasEncerraAssinatura(m, r) {
    const uid = escolher(
      r,
      contas().filter((u) => S.billing(u).subscriptionId)
    );
    if (!uid) return null;
    const sid = S.billing(uid).subscriptionId;
    const sub = asaasState.subscriptions.get(sid);
    if (sub) sub.status = 'INACTIVE';
    // Como no Asaas: as faturas ainda não pagas somem com a assinatura.
    for (const p of asaasState.payments.values()) {
      if (p.subscription === sid && (p.status === 'PENDING' || p.status === 'OVERDUE')) {
        p.status = 'DELETED';
      }
    }
    m.resposta = await call(H.webhook, {
      headers: WEBHOOK_OK,
      body: {
        id: 'subdel:' + sid + ':' + asaasState.seq++,
        event: 'SUBSCRIPTION_DELETED',
        subscription: { id: sid },
      },
    });
    return 'Asaas encerra a assinatura de ' + uid;
  },
  async function repetirUltimoWebhook(m, r) {
    if (!m.ultimoWebhook) return null;
    // Mesmo id (retry do Asaas) ou id novo com o mesmo conteúdo (evento
    // gêmeo, ex.: CONFIRMED reenviado por outra via).
    const mesmoId = r() < 0.5;
    const corpo = Object.assign(
      {},
      m.ultimoWebhook,
      mesmoId ? {} : { id: 'gemeo:' + asaasState.seq++ }
    );
    m.resposta = await call(H.webhook, { headers: WEBHOOK_OK, body: corpo });
    return (
      'Asaas repete o último webhook ' + corpo.event + (mesmoId ? ' (mesmo id)' : ' (id novo)')
    );
  },
  async function webhookForjado(m, r) {
    // Sem token, ou com token errado: não pode mudar NADA.
    const uid = escolher(
      r,
      contas().filter((u) => S.cobrancas(u).length)
    );
    if (!uid) return null;
    const p = Object.assign({}, escolher(r, S.cobrancas(uid)), { status: 'RECEIVED', value: 1500 });
    const antes = foto();
    const headers = r() < 0.5 ? {} : { 'asaas-access-token': 'chute' };
    m.resposta = await call(H.webhook, {
      headers,
      body: { id: 'forjado:' + asaasState.seq++, event: 'PAYMENT_RECEIVED', payment: p },
    });
    if (m.resposta.status < 400)
      m.extra.push('CUP07 webhook forjado aceito com status ' + m.resposta.status);
    if (foto() !== antes) m.extra.push('CUP07 webhook forjado MUDOU o estado');
    return 'atacante forja PAYMENT_RECEIVED para ' + uid;
  },

  // ---- admin e relógio ----
  async function superpoder(m, r) {
    const uid = escolher(r, contas());
    if (!uid) return null;
    const acao = escolher(r, [
      'make_pro',
      'revoke_pro',
      'gift_pro_days',
      'extend_trial',
      'suspend_trial',
      'cancel_asaas_sub',
      'reconcile_user',
      'set_discount',
    ]);
    const valor = acao === 'set_discount' ? escolher(r, [0, 10, 50]) : Math.ceil(r() * 40);
    m.resposta = await S.superpoder(acao, uid, valor);
    if (acao === 'set_discount') m.descontoAdmin.add(uid);
    if (acao === 'make_pro' || acao === 'gift_pro_days') m.cortesiaAdmin.add(uid);
    return 'admin: ' + acao + ' em ' + uid + ' (' + valor + ')';
  },
  async function verMinhaConta(m, r) {
    const uid = escolher(r, contas());
    if (!uid) return null;
    const res = await call(H.me, { method: 'GET', headers: token(uid) });
    m.resposta = res;
    return uid + ' abre Minha conta';
  },
  async function avancarDias(m, r) {
    const n = escolher(r, [1, 3, 7, 15, 29, 31, 45]);
    S.avancarDias(n);
    return 'passam ' + n + ' dias';
  },
];

// ---------------------------------------------------------------------------
// Invariantes de cupom e fraude
// ---------------------------------------------------------------------------

function verificarCupons(m) {
  const falhas = [];
  const doc = (p) => store.docs.get(p) || null;

  // Cobranças por id, para ligar crédito → pagamento que o gerou.
  const cobPorId = asaasState.payments;

  for (const uid of contas()) {
    const b = S.billing(uid);
    const rot = '[' + uid + '] ';

    // CUP01 — ninguém indica a si mesmo.
    if (b.referredByUserId && b.referredByUserId === uid) {
      falhas.push(rot + 'CUP01 a conta é indicada por ela mesma');
    }

    // CUP02 — indicador e indicado não podem ter o mesmo CPF (multi-conta).
    if (b.referredByUserId && b.cpfCnpj) {
      const ind = S.billing(b.referredByUserId);
      if (ind.cpfCnpj && ind.cpfCnpj === b.cpfCnpj) {
        const cs = S.creditos(b.referredByUserId).filter((c) => c.fromUid === uid && !c.voidedAt);
        if (cs.length) falhas.push(rot + 'CUP02 indicador com o MESMO CPF recebeu crédito');
      }
    }

    // CUP03 — desconto recorrente só nos valores do programa, ou por decisão do admin.
    const desc = b.recurringDiscountPercent || 0;
    if (!DESCONTOS_LEGITIMOS.has(desc) && !m.descontoAdmin.has(uid)) {
      falhas.push(rot + 'CUP03 desconto recorrente fora do programa: ' + desc + '%');
    }
    // ...e o desconto tem de ter origem: cupom do Applicash (10) ou convite (50).
    if (desc === 10 && !b.referredByUserId && !m.descontoAdmin.has(uid)) {
      falhas.push(rot + 'CUP03 10% de desconto sem indicador');
    }
    if (desc === 50 && !m.descontoAdmin.has(uid)) {
      const usou = m.convites.some((c) => (doc('convites/' + c) || {}).usadoPor === uid);
      if (!usou) falhas.push(rot + 'CUP03 50% de desconto sem convite resgatado');
    }

    // CUP04 — cortesia de testador só para quem resgatou convite (ou admin).
    if ((b.courtesyPermanent === true || b.courtesyUntil) && !m.cortesiaAdmin.has(uid)) {
      const usou = m.convites.some((c) => (doc('convites/' + c) || {}).usadoPor === uid);
      if (!usou) falhas.push(rot + 'CUP04 cortesia sem convite nem ação do admin');
    }

    // CUP05 — cada crédito vem de um pagamento REAL de um indicado DESTA
    // conta, e soma no máximo 10% dele (as partições somam o original).
    const porPagamento = new Map();
    for (const c of S.creditos(uid)) {
      if (c.origem === 'admin') continue; // desconto dado pelo admin
      const pid = c.paymentId;
      if (!pid) {
        falhas.push(rot + 'CUP05 crédito sem pagamento de origem');
        continue;
      }
      porPagamento.set(pid, (porPagamento.get(pid) || 0) + (c.amountCents || 0));
      const cob = cobPorId.get(pid);
      const dono = cob && contas().find((u) => S.billing(u).customerId === cob.customer);
      if (!dono) {
        falhas.push(rot + 'CUP05 crédito de um pagamento que não existe: ' + pid);
        continue;
      }
      if (dono === uid) falhas.push(rot + 'CUP05 crédito gerado pelo próprio pagamento');
      if (S.billing(dono).referredByUserId !== uid) {
        falhas.push(rot + 'CUP05 crédito de ' + dono + ', que não é indicado desta conta');
      }
    }
    for (const [pid, soma] of porPagamento) {
      const cob = cobPorId.get(pid);
      if (!cob) continue;
      // O valor que vale é o que foi cobrado; o teto é 10% do preço cheio.
      const teto = Math.round((S.PRECO_BASE_CENTS * REFERRAL_PERCENT) / 100);
      if (soma > teto) {
        falhas.push(
          rot + 'CUP05 ' + soma + 'c de crédito por um pagamento só (' + pid + '), teto ' + teto
        );
      }
    }

    // CUP06 — pagamento estornado/contestado não deixa crédito vivo e ainda
    // não gasto no indicador.
    for (const c of S.creditos(uid)) {
      const cob = cobPorId.get(c.paymentId);
      if (!cob || c.voidedAt || c.appliedAt) continue;
      if (cob.status === 'REFUNDED' || cob.status === 'CHARGEBACK_REQUESTED') {
        falhas.push(
          rot + 'CUP06 crédito pendente de pagamento ' + cob.status + ' (' + cob.id + ')'
        );
      }
    }
  }

  // CUP09 — auto-indicação pelo mesmo aparelho não pode vingar.
  // Vale pelo aparelho de CADASTRO de cada conta, gravado no billing.
  for (const uid of contas()) {
    const ind = S.billing(uid).referredByUserId;
    if (!ind) continue;
    const a = S.billing(uid).signupDevice;
    if (a && a === S.billing(ind).signupDevice) {
      falhas.push('[' + uid + '] CUP09 indicado por ' + ind + ' usando o aparelho de ' + ind);
    }
  }

  // CUP10 — ninguém paga menos que o maior desconto do programa (50%) sem
  // crédito Applicash que cubra a diferença: empilhar convite + cupom, ou um
  // desconto aplicado duas vezes, aparece aqui.
  for (const uid of contas()) {
    if (m.descontoAdmin.has(uid)) continue;
    const piso = Math.round(S.PRECO_BASE_CENTS * 0.5);
    for (const p of S.cobrancas(uid)) {
      // Estornada/apagada/contestada devolve o crédito que usou: o valor
      // dela já não diz nada.
      if (!['PENDING', 'OVERDUE', 'CONFIRMED', 'RECEIVED'].includes(p.status)) continue;
      const cents = Math.round((p.value || 0) * 100);
      const credito = S.creditos(uid)
        .filter((c) => c.appliedToPaymentId === p.id)
        .reduce((a, c) => a + (c.amountCents || 0), 0);
      if (cents + credito < piso) {
        falhas.push(
          '[' +
            uid +
            '] CUP10 cobrança ' +
            p.id +
            ' de ' +
            cents +
            'c com só ' +
            credito +
            'c de crédito'
        );
      }
    }
  }

  // CUP08 — convite: uso único.
  for (const c of m.convites) {
    const d = doc('convites/' + c) || {};
    const donos = contas().filter((u) => {
      const b = S.billing(u);
      return b.conviteCodigo === c;
    });
    if (donos.length > 1) falhas.push('CUP08 convite ' + c + ' benefícia ' + donos.join(', '));
    if (d.status === 'usado' && d.usadoPor && donos.length === 1 && donos[0] !== d.usadoPor) {
      falhas.push('CUP08 convite ' + c + ' usado por ' + d.usadoPor + ' mas beneficia ' + donos[0]);
    }
  }

  return falhas;
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

const CPFS_EXTRA = ['20000000027', '20001111140', '20002222264', '20003333388'];

/**
 * Roda uma sequência. Assíncrono: os handlers reais são async.
 * Devolve { falhou, mensagem, trilha }.
 */
async function rodarSequenciaPagamentos(semente, passos) {
  const r = rng(semente);
  const mundo = S.criarMundoPagamentos({ agora: Date.UTC(2026, 9, 1, 12) });
  let cpfI = 0;
  const m = {
    mundo,
    pares: [],
    convites: [],
    descontoAdmin: new Set(),
    cortesiaAdmin: new Set(),
    bloqueados: new Set(),
    ultimoWebhook: null,
    resposta: null,
    extra: [],
    proximoCpf: () => CPFS_EXTRA[cpfI++ % CPFS_EXTRA.length],
  };
  const trilha = [];

  const silencio = {};
  for (const k of ['log', 'warn', 'error', 'info']) {
    silencio[k] = console[k];
    if (!process.env.CACA_VERBOSO) console[k] = () => {};
  }
  try {
    for (let i = 0; i < passos; i++) {
      let desc = null;
      let acao = null;
      // Um segundo entre ações: sem isto tudo acontece no mesmo milissegundo
      // e "antes/depois do vínculo do cupom" deixa de ser distinguível.
      store.now += 1000;
      for (let t = 0; t < 12 && !desc; t++) {
        acao = escolher(r, ACOES);
        m.resposta = null;
        m.extra = [];
        try {
          desc = await acao(m, r);
        } catch (e) {
          desc = acao.name;
          m.extra.push('EXC ' + acao.name + ' lançou: ' + ((e && e.stack) || e));
        }
      }
      if (!desc) continue;
      trilha.push(desc);

      const falhas = m.extra.slice();
      if (m.resposta && m.resposta.status >= 500) {
        falhas.push(
          'HTTP ' + m.resposta.status + ' em "' + desc + '": ' + JSON.stringify(m.resposta.body)
        );
      }
      for (const u of contas()) {
        if (BLOQUEIA_INDICADOR.has(S.billing(u).subscriptionStatus)) m.bloqueados.add(u);
      }
      falhas.push(
        ...S.verificar(mundo, {
          paresApplicash: m.pares,
          indicadoresBloqueados: m.bloqueados,
          soAvisadas: true,
        })
      );
      falhas.push(...verificarCupons(m));
      if (falhas.length) {
        return {
          falhou: true,
          trilha,
          mensagem:
            'Semente ' +
            semente +
            ', passo ' +
            (i + 1) +
            '.\nSequência:\n' +
            trilha.map((d, j) => '  ' + (j + 1) + '. ' + d).join('\n') +
            '\nViolações:\n  - ' +
            falhas.join('\n  - ') +
            '\nReproduzir: node scripts/cacar-pagamentos.js --semente ' +
            semente +
            ' ' +
            passos,
        };
      }
    }
  } finally {
    Object.assign(console, silencio);
  }
  return { falhou: false, trilha, mensagem: '' };
}

module.exports = { ACOES, rodarSequenciaPagamentos, verificarCupons };
