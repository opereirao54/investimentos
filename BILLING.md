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
8. **Cancelamento/inadimplência** — `SUBSCRIPTION_DELETED`/`PAYMENT_OVERDUE` põem o utilizador em `blocked`, frontend mostra gate.

## Estados de acesso (`api/_lib/access.js`)

| status | quando |
|--------|--------|
| `active` | `subscriptionStatus=ACTIVE` e último pagamento `CONFIRMED`/`RECEIVED` |
| `trial` | dentro de `trialEndsAt` |
| `pending_payment` | assinatura criada mas pagamento ainda não confirmado |
| `blocked` | trial expirou OU `SUBSCRIPTION_DELETED` |
| `blocked` (overdue) | `PAYMENT_OVERDUE` |

## Esquema Firestore

```
users/{uid}/data/main                       (já existente)
users/{uid}/billing/account                 (server-only)
   uid, email, customerId, createdAt,
   trialStartsAt, trialEndsAt,
   subscriptionId, subscriptionStatus,
   lastPaymentId, lastPaymentStatus, lastPaidAt,
   lastEvent, updatedAt
users/{uid}/billing/account/payments/{paymentId}
   id, status, value, netValue, billingType,
   dueDate, paymentDate, invoiceUrl, event, receivedAt
```

Regras (`firestore.rules`): utilizador **lê** o seu billing mas **não escreve** — só o Admin SDK do backend escreve. App data continua restrita a `users/{uid}/data/main`.

## Variáveis de ambiente

| Nome | Onde |
|------|------|
| `ASAAS_API_KEY` | painel Asaas → Integrações → API |
| `ASAAS_API_URL` | `https://api.asaas.com/v3` (prod) ou `https://sandbox.asaas.com/api/v3` (sandbox) |
| `ASAAS_WEBHOOK_TOKEN` | token livre que define ao criar o webhook |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | `base64 -w0 service-account.json` |
| `FIREBASE_PROJECT_ID` | `appliquei-prod` |

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
- As credenciais do Firebase Web já vivem inline no HTML (config pública); só a *Service Account* (Admin) precisa de ser secreta.

## Endpoints

| Método | Rota | Auth | Função |
|--------|------|------|--------|
| `POST` | `/api/billing/init` | Bearer ID token | cria cliente Asaas + define `trialEndsAt` |
| `GET`  | `/api/billing/status` | Bearer ID token | devolve `{ access, billing }` |
| `POST` | `/api/billing/subscribe` | Bearer ID token | cria assinatura, devolve `invoiceUrl` |
| `POST` | `/api/billing/webhook` | header `asaas-access-token` | atualiza billing/payments |

## Segurança

- **Validação no backend**: `requireUser` verifica o Firebase ID token em todos os endpoints autenticados; o `uid` vem do token, nunca do body.
- **Sem bypass no frontend**: gate é decorativo — todo o estado de acesso depende do que o backend devolve, e as regras Firestore impedem o cliente de escrever o seu próprio `billing/account`.
- **Webhook**: rejeitado sem `asaas-access-token` correto.
- **Modo offline removido**: a opção “continuar sem conta” já não existe; força conta + trial.
- **Service Account**: apenas em env vars (nunca no repo).
