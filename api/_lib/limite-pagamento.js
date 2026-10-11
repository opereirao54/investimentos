'use strict';

// Limite de tentativas nas rotas que falam com o Asaas em nome do usuário
// (/api/billing/subscribe e /api/billing/card).
//
// O risco é o "teste de cartão": alguém com uma lista de cartões roubados usa
// o formulário de assinatura para descobrir quais passam. Cada tentativa vira
// uma transação recusada na conta Asaas da Appliquei, e um volume anormal de
// recusas faz o gateway bloquear a conta — e aí ninguém mais consegue pagar.
//
// Dois limites, porque um só é fácil de contornar:
//   - por conta (uid): quem erra o cartão 5 vezes em uma hora não está
//     digitando o próprio cartão;
//   - por IP: o mesmo atacante criando várias contas para recomeçar a conta.
// PIX e boleto não passam pelo emissor do cartão, então têm um limite mais
// folgado, só por conta (protege contra o laço de "gerar cobrança" em série).
//
// Falha do Firestore deixa passar (rate-limit.js é fail-open): um limite que
// derruba pagamento legítimo seria pior do que o abuso que ele evita.

const rl = require('./rate-limit');

const HORA_MS = 60 * 60 * 1000;
const LIMITES = {
  cartaoUid: { windowMs: HORA_MS, max: 5 },
  cartaoIp: { windowMs: HORA_MS, max: 15 },
  cobrancaUid: { windowMs: HORA_MS, max: 10 },
};

const MENSAGEM =
  'Muitas tentativas de pagamento em pouco tempo. Por segurança, espere um pouco e tente de novo.';

/**
 * `cartao`: a tentativa leva um número de cartão.
 * Devolve null (pode seguir) ou { status, body } para responder.
 */
async function conferirLimitePagamento(req, uid, cartao) {
  const checagens = cartao
    ? [
        rl.check({ scope: 'pag-cartao-uid', key: uid, ...LIMITES.cartaoUid }),
        rl.check({ scope: 'pag-cartao-ip', key: rl.ipFrom(req) || 'sem-ip', ...LIMITES.cartaoIp }),
      ]
    : [rl.check({ scope: 'pag-cobranca-uid', key: uid, ...LIMITES.cobrancaUid })];
  const resultados = await Promise.all(checagens);
  const barrado = resultados.find((r) => r && r.allowed === false);
  if (!barrado) return null;
  console.warn('[pagamento] limite de tentativas', { uid, cartao: !!cartao });
  return {
    status: 429,
    body: { error: 'rate_limited', detail: MENSAGEM, retryAfterMs: barrado.retryAfterMs || 0 },
  };
}

module.exports = { conferirLimitePagamento, LIMITES };
