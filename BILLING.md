# Auth + Trial 7 dias + Assinatura Asaas (R$ 15/mês)

## Arquitetura

```
┌────────────────────────┐         ┌─────────────────────────┐
│  Browser               │         │  Vercel Serverless      │
│  Appliquei_v13.0.html  │  HTTPS  │  /api/billing/*         │
│  + appliquei-billing.js├────────►│  + firebase-admin       │
│  + Firebase Auth (SDK) │  Bearer │  + Asaas REST           │
└─────────┬──────────────┘  IDtok  └──────────┬──────────────┘
          │ Auth state                        │ Admin SDK
          ▼                                   ▼
   ┌────────────────────────────────────────────────┐
   │  Firestore                                     │
   │  users/{uid}/data/main            (app data)   │
   │  users/{uid}/billing/account      (server-only)│
   │  users/{uid}/billing/account/payments/{id}     │
   └────────────────────────────────────────────────┘
                  ▲
                  │ webhook (POST + token header)
                  │
           ┌─────────────┐
           │  Asaas      │
           └─────────────┘
```

## Fluxo do utilizador

1. **Cadastro/Login** — UI já existente no HTML (Firebase Auth e-mail/senha).
2. **Inicialização do billing (1º login)** — `appliquei-billing.js` chama `POST /api/billing/init` com o ID token. O backend:
   - cria o cliente no Asaas (`POST /v3/customers`),
   - guarda `customerId`, `createdAt`, `trialEndsAt` (+7 dias) em `users/{uid}/billing/account`.
3. **Acesso durante o trial** — `applyAccess` mostra um banner verde no topo (“Avaliação gratuita: N dias restantes”) e libera a app.
4. **Trial expirado** — o frontend mostra o gate de assinatura com o botão **Assinar agora (R$ 15/mês)**.
5. **Assinatura** — `POST /api/billing/subscribe` cria a `Subscription` no Asaas (`MONTHLY`, `value=15.00`, `billingType=UNDEFINED`) e devolve o `invoiceUrl` da 1ª fatura. O browser abre o link num separador novo.
6. **Webhook** — o Asaas notifica `POST /api/billing/webhook` em cada evento. O endpoint atualiza `subscriptionStatus` e `lastPaymentStatus` e grava o documento em `payments/{paymentId}`.
7. **Liberação automática** — o frontend faz polling a cada 30s; assim que o status passa a `active` o gate desaparece.
8. **Cancelamento/inadimplência** — `SUBSCRIPTION_DELETED`/`PAYMENT_OVERDUE` bloqueiam **depois** de a janela já paga acabar (`paidUntil`); até lá o utilizador mantém o mês que comprou. Estorno e chargeback bloqueiam de imediato.

## Ciclo de acesso: crédito de tempo, nunca reinício

`billing.paidUntil` é a fonte canônica de **até quando o acesso foi comprado**.
Cada pagamento confirmado o estende por `nextPaidUntilMs()`
(`api/_lib/access.js`): a base é o **maior** entre agora, a janela já paga e o
fim do trial — e só então soma 30 dias.

Consequências que o desenho garante:

- **Antecipar não custa dias.** Renovar o avulso no dia 20 de 30 leva a janela
  para o dia 60, não para o dia 50.
- **O trial é honrado.** Assinar no dia 3 de 7 agenda a primeira cobrança para
  o fim do trial (`/subscribe` usa `max(amanhã, trialEndsAt, paidUntil)`), e o
  saldo de trial entra no ciclo pago.
- **Um pagamento estende uma vez.** O Asaas emite `CONFIRMED` **e** `RECEIVED`
  para a mesma cobrança; `paidUntilFromPaymentId` impede a dupla contagem.
- **Contas antigas continuam válidas.** Sem `paidUntil` gravado, `paidUntilMs()`
  cai em `lastPaidAt + 30d`. Não remover esse fallback.

## Estados de acesso (`api/_lib/access.js`)

| status                                | quando                                                                |
| ------------------------------------- | --------------------------------------------------------------------- |
| `active` (`paid`)                     | `subscriptionStatus=ACTIVE` e último pagamento `CONFIRMED`/`RECEIVED` |
| `active` (`paid_period`)              | dentro de `paidUntil` — cobre cancelado com mês pago                  |
| `active` (`paid_period_overdue_next`) | fatura **seguinte** vencida, mas a janela comprada ainda vale         |
| `trial`                               | dentro de `trialEndsAt`                                               |
| `pending_payment`                     | assinatura criada mas pagamento ainda não confirmado                  |
| `blocked` (`trial_expired`)           | trial expirou sem pagamento                                           |
| `blocked` (`cancelled`)               | `SUBSCRIPTION_DELETED` e a janela paga já acabou                      |
| `blocked` (`overdue`)                 | `PAYMENT_OVERDUE` **e** a janela paga já acabou                       |
| `blocked` (`refunded`/`chargeback`)   | dinheiro devolvido — bloqueia **mesmo dentro** da janela paga         |

`OVERDUE` não revoga um mês já pago: a fatura que vence é sempre a seguinte, e
boleto/PIX levam 1-3 dias úteis a compensar. Estorno e chargeback bloqueiam na
hora, porque aí o pagamento deixou de existir.

## Esquema Firestore

```
users/{uid}/data/main                       (já existente)
users/{uid}/billing/account                 (server-only)
   uid, email, customerId, createdAt,
   trialStartsAt, trialEndsAt,
   subscriptionId, subscriptionStatus,
   lastPaymentId, lastPaymentStatus, lastPaidAt,
   paidUntil, paidUntilFromPaymentId,      (janela comprada + idempotência)
   paymentMode ('subscription' | 'one_shot'),
   stats.pendingDiscountCents, stats.totalReferralEarningsCents,
   lastEvent, updatedAt
users/{uid}/billing/account/credits/{creditId}     (Applicash do indicador)
   fromUid, fromEmail, paymentId, amountCents,
   appliedAt, appliedToPaymentId, appliedAmountCents,
   splitFrom, voidedAt, voidedReason, createdAt
users/{uid}/payments/{paymentId}
   id, status, value, netValue, billingType,
   dueDate, paymentDate, invoiceUrl, event, receivedAt
```

### Applicash — as duas pontas

| Ponta         | O que ganha                       | Onde é aplicado                               |
| ------------- | --------------------------------- | --------------------------------------------- |
| **Indicado**  | 10% off na mensalidade, sempre    | `/subscribe`, no valor da assinatura/cobrança |
| **Indicador** | 10% de cada pagamento do indicado | abatido numa fatura dele, por três caminhos   |

Os três caminhos do crédito do indicador (`api/_lib/credits.js`):

1. `pushCreditToOpenInvoice` — assim que o crédito nasce, abate na fatura
   aberta. É o caminho principal: o Asaas projeta 6-12 faturas no ato da
   criação da assinatura, então os `PAYMENT_CREATED` do indicador já
   aconteceram, com saldo zero, antes de existir qualquer crédito.
2. `applyPendingCreditsTo` no evento `PAYMENT_CREATED` — para quem ainda não
   tinha fatura aberta.
3. `reservePendingCredits` em `/subscribe` (avulso) — abate **antes** de criar
   a cobrança, porque o cartão captura no ato do `POST /payments` e depois o
   Asaas recusa alterar o valor.

Um crédito consumido em parte é **partido em dois** (a fatia gasta e uma sobra
pendente): marcar o documento inteiro como gasto tendo abatido metade fazia a
diferença evaporar do saldo.

**Teto conhecido:** `MIN_PAYMENT_CENTS` (R$ 5,00) é o piso do gateway, então a
fatura nunca chega a zero. A tela do Applicash promete "12 indicações → 100% ·
Assinatura ZERADA"; cumprir isso exige decisão de produto (baixar o piso, ou
pular a cobrança e estender `paidUntil` quando o crédito cobre o mês).
`test/pagamentos-applicash.test.js` fixa o teto real.

Regras (`firestore.rules`): utilizador **lê** o seu billing mas **não escreve** — só o Admin SDK do backend escreve. App data continua restrita a `users/{uid}/data/main`.

## Testar pagamentos

```bash
node --test test/pagamentos-*.test.js   # ciclo de cobrança + Applicash
npm run test:flows                       # cenários ponta a ponta
npm test                                 # tudo
```

O simulador (`test/_simulador-pagamentos.js`) roda contra um Asaas **fiel**:
faturas futuras projetadas, cartão que captura na hora, `updatePayment` que
recusa alterar cobrança paga. Esses knobs vivem em `asaasState` e ficam
desligados por omissão no mock — um teste de pagamento com eles desligados
testa um gateway que não existe. Ver `.claude/skills/pagamentos/SKILL.md`.

## Variáveis de ambiente

| Nome                              | Onde                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `ASAAS_API_KEY`                   | painel Asaas → Integrações → API                                                  |
| `ASAAS_API_URL`                   | `https://api.asaas.com/v3` (prod) ou `https://sandbox.asaas.com/api/v3` (sandbox) |
| `ASAAS_WEBHOOK_TOKEN`             | token livre que define ao criar o webhook                                         |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | `base64 -w0 service-account.json`                                                 |
| `FIREBASE_PROJECT_ID`             | `appliquei-prod`                                                                  |

Local: `.env.local` na raiz (Vercel CLI lê automaticamente). Produção: `vercel env add ...` ou painel Vercel → Settings → Environment Variables.

## Configurar webhook Asaas

1. Painel Asaas → **Configurações → Integrações → Webhooks → Adicionar**.
2. URL: `https://SEU_DOMINIO.vercel.app/api/billing/webhook`.
3. Token de autenticação: o mesmo valor de `ASAAS_WEBHOOK_TOKEN`.
4. Versão da API: v3.
5. Eventos: marcar **todos os de Cobrança e Assinatura** (`PAYMENT_*`, `SUBSCRIPTION_*`). No mínimo:
   - `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `PAYMENT_DELETED`
   - `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED`
6. Modo: `Sequencial` (mantém ordem por evento).
7. Salvar — o Asaas envia um teste; deve responder `200 OK`.

## Deploy Vercel

```bash
# 1. Login + link
npm i -g vercel
vercel link

# 2. Variáveis (uma a uma ou bulk)
vercel env add ASAAS_API_KEY production
vercel env add ASAAS_API_URL production
vercel env add ASAAS_WEBHOOK_TOKEN production
vercel env add FIREBASE_SERVICE_ACCOUNT_BASE64 production
vercel env add FIREBASE_PROJECT_ID production

# 3. Deploy
vercel --prod
```

Notas:

- O `vercel.json` já redireciona `/` para `Appliquei_v13.0.html` e configura cache `no-store` para `/api/*`.
- Em dev local: `vercel dev` (corre o front + as funções `/api`).
- As credenciais do Firebase Web já vivem inline no HTML (config pública); só a _Service Account_ (Admin) precisa de ser secreta.

## Endpoints

| Método | Rota                     | Auth                        | Função                                                                                 |
| ------ | ------------------------ | --------------------------- | -------------------------------------------------------------------------------------- |
| `POST` | `/api/billing/init`      | Bearer ID token             | cria cliente Asaas + define `trialEndsAt`                                              |
| `GET`  | `/api/billing/me`        | Bearer ID token             | devolve `{ access, billing, referrals, payments, ... }` (consolida o antigo `/status`) |
| `POST` | `/api/billing/subscribe` | Bearer ID token             | cria assinatura, devolve `invoiceUrl`                                                  |
| `POST` | `/api/billing/webhook`   | header `asaas-access-token` | atualiza billing/payments                                                              |

## Segurança

- **Validação no backend**: `requireVerifiedUser` (ou `requireFreshVerifiedUser` em `/init`) verifica o Firebase ID token em todos os endpoints autenticados; o `uid` vem do token, nunca do body. Cache LRU 60s do `verifyIdToken` reduz custo; `/init` força revalidação fresh para fechar a janela.
- **Email verificado**: backend exige `email_verified=true` quando `EMAIL_VERIFY_ENFORCE=true`; Firestore rules exigem em `users/{uid}/data/main`.
- **Antifraude /init**: rate-limit por IP (5/24h) e device fingerprint (3/30d) na primeira criação; rate-limit reduzido (10/h) também em retro-apply de cupom. Gated por `ANTIFRAUD_INIT_ENABLED`.
- **Referral guard unificado**: `api/_lib/referral-guard.js` bloqueia self-referral por uid/device/CPF/IP (IP opt-in via `REFERRAL_BLOCK_SAME_IP`) e indicador `INACTIVE`. Aplicado em `/init` (criação e retro-apply) e em `/subscribe` (revalidação quando CPF chega).
- **Idempotência Asaas**: `createCustomer` faz lookup por `externalReference=uid` antes de criar — evita customers duplicados após retry de função.
- **Sem bypass no frontend**: o gate visual é apenas UX; a barreira real é (a) `firestore.rules` exigir `hasActiveAccess(uid)` em LEITURA e ESCRITA de `users/{uid}/data/main` — então mesmo removendo o modal via DevTools o SDK Firestore não devolve dados de conta bloqueada; (b) `/api/sync/push` recusar 403 `access_blocked`; (c) cliente não consegue escrever `billing/account` (`allow write: if false`). Defesa em profundidade no front: `MutationObserver` re-injeta o gate se removido e o cache `localStorage` sincronizado é purgado quando `access.status === 'blocked'` com reason "dura" (trial_expired/overdue/cancelled/chargeback/refunded/card_reproved/no_billing).
- **Webhook**: rejeitado sem `asaas-access-token` correto.
- **Modo offline removido**: a opção “continuar sem conta” já não existe; força conta + trial.
- **Service Account**: apenas em env vars (nunca no repo).

### Variáveis de ambiente adicionais

| Variável                 | Default           | Função                                                                                                                                                                                           |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EMAIL_VERIFY_ENFORCE`   | `false`           | Quando `true`, backend devolve 403 `email_not_verified` se o token não tiver `email_verified=true`. Antes de ativar, rodar `scripts/backfill-email-verification.js` e deixar 7 dias em log-only. |
| `ANTIFRAUD_INIT_ENABLED` | `false`           | Quando `true`, rate-limit em `/init` (IP/device) responde 429. Default só loga.                                                                                                                  |
| `REFERRAL_BLOCK_SAME_IP` | `false`           | Quando `true`, bloqueia referral quando o IP do indicador é igual ao do indicado. NAT-unsafe (famílias compartilham IP).                                                                         |
| `TRUSTED_PROXY_HOPS`     | `0`               | Quantos proxies confiáveis estão na frente. Vercel sozinha = 0. Cloudflare+Vercel = 1. Usado pelo helper `ipFrom`.                                                                               |
| `RATE_LIMIT_SALT`        | `appliquei-rl-v1` | Salt para hash do device fingerprint e das chaves de rate-limit. Definir um valor aleatório por ambiente em produção.                                                                            |
| `APP_ORIGIN`             | (req origin)      | Base URL usada nos links de verificação de e-mail.                                                                                                                                               |

### Manutenção: TTL Firestore

As coleções `rateLimits` e `webhookEvents` crescem indefinidamente sem cleanup. Configurar TTL policy no Firebase Console → Firestore → TTL:

| Coleção         | Campo TTL   | Recomendação                                     |
| --------------- | ----------- | ------------------------------------------------ |
| `rateLimits`    | `expiresAt` | Já gravado pelo código. Ativar TTL.              |
| `webhookEvents` | `expiresAt` | Já gravado (TTL 30 dias). Ativar TTL no console. |

Sem TTL ativo, esses docs ficam para sempre — custo de storage cresce linear, custo de leitura inalterado.
