# Graph Report - investimentos  (2026-05-15)

## Corpus Check
- 26 files · ~397,900 words (extração original em `e143015e`)
- 29 files no HEAD `2171440` (3 novos: `scripts/lib/mock-billing.js`, `scripts/test-referral-flow.js`, `scripts/test-subscription-flow.js`)
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 334 nodes · 617 edges · 25 communities (24 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output
- Acrescentado manualmente (Manual Patch abaixo): +9 funções, +1 módulo, +2 scripts de teste

## Graph Freshness
- ⚠️ **STALE** — graph estrutural foi construído em `e143015e`; HEAD atual é `2171440` (+14 commits).
- Patches manuais aplicados neste relatório cobrem mudanças que afetam hubs / criam nós novos. Métricas exatas (centralidade, comunidades) **não** foram recalculadas.
- Para regenerar de fato: `graphify update .` (sem custo de API), depois substituir este arquivo.
- Para comparar: `git rev-parse HEAD` vs `e143015e`.

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]

## God Nodes (most connected - your core abstractions)
1. `$()` - 25 edges
2. `renderMyAccount()` - 20 edges
3. `P()` - 15 edges
4. `main()` - 15 edges
5. `db()` - 14 edges
6. `call()` - 14 edges
7. `make_table()` - 14 edges
8. `Appliquei v13.0 - Gestão Financeira Inteligente` - 14 edges
9. `Appliquei v13.0 - Gestão Financeira Inteligente` - 14 edges
10. `caption()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `findBillingByCustomer()` --calls--> `db()`  [EXTRACTED]
  api/billing/webhook.js → api/_lib/firebase-admin.js
- `findBillingBySubscription()` --calls--> `db()`  [EXTRACTED]
  api/billing/webhook.js → api/_lib/firebase-admin.js
- `applyPendingCreditsTo()` --calls--> `fieldValue()`  [EXTRACTED]
  api/billing/webhook.js → api/_lib/firebase-admin.js
- `creditIndicatorFromIndicado()` --calls--> `fieldValue()`  [EXTRACTED]
  api/billing/webhook.js → api/_lib/firebase-admin.js
- `syncBillingFromAsaas()` --calls--> `fieldValue()`  [EXTRACTED]
  api/_lib/billing-sync.js → api/_lib/firebase-admin.js

## Communities (25 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.33
Nodes (10): attach(), attachWhenReady(), collectKeysPayload(), flushPush(), mainRef(), onUser(), pullAndApply(), shouldSyncKey() (+2 more)

### Community 1 - "Community 1"
Cohesion: 0.1
Nodes (20): Appliquei v13.0 - Gestão Financeira Inteligente, code:bash (git clone <repositorio>), code:block2 (/workspace), code:css (:root {), code:bash (python -m pip install -r requirements-graphify.txt), 🚀 Como Usar, 🤝 Contribuição, 👨‍💻 Desenvolvimento (+12 more)

### Community 2 - "Community 2"
Cohesion: 0.35
Nodes (23): build_styles(), bullets(), callout(), caption(), cell(), cover(), main(), make_table() (+15 more)

### Community 3 - "Community 3"
Cohesion: 0.1
Nodes (20): Appliquei v13.0 - Gestão Financeira Inteligente, code:bash (git clone <repositorio>), code:block2 (/workspace), code:css (:root {), code:bash (python -m pip install -r requirements-graphify.txt), 🚀 Como Usar, 🤝 Contribuição, 👨‍💻 Desenvolvimento (+12 more)

### Community 4 - "Community 4"
Cohesion: 0.1
Nodes (56): $(), applyAccess(), authedFetch(), bindMyAccountActions(), cardBrandLabel(), clearTrialBannerOffset(), closeMyAccount(), closeSubModal() (+48 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (13): Arquitetura, Auth + Trial 7 dias + Assinatura Asaas (R$ 15/mês), code:block1 (┌────────────────────────┐         ┌────────────────────────), code:block2 (users/{uid}/data/main                       (já existente)), code:bash (# 1. Login + link), Configurar webhook Asaas, Deploy Vercel, Endpoints (+5 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (14): asaas, billing, billingUpdate, brandFromNumber(), cardMetadataFromAsaas(), cpfCnpj, customerName, { db, fieldValue } (+6 more)

### Community 7 - "Community 7"
Cohesion: 0.14
Nodes (13): asaas, billing, codes, { computeAccess, TRIAL_DAYS }, D, data, { db, fieldValue, timestamp }, now (+5 more)

### Community 8 - "Community 8"
Cohesion: 0.16
Nodes (15): applyPendingCreditsTo(), asaas, billing, creditIndicatorFromIndicado(), creditsCol(), { db, fieldValue }, { db, fieldValue, timestamp }, findBillingByCustomer() (+7 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (18): addMonthsYmd(), b, billing, billingRef, buildUpcoming(), c, { computeAccess }, credits (+10 more)

### Community 14 - "Community 14"
Cohesion: 0.26
Nodes (14): apiKey(), baseUrl(), call(), cancelSubscription(), createCustomer(), createSubscription(), getPaymentLink(), getSubscription() (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.19
Nodes (12): asaas, billing, { db, fieldValue }, ref, { requireUser, cors }, { auth }, cors(), requireUser() (+4 more)

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (8): access, billingRef, { computeAccess }, { db }, { requireUser, cors }, { syncBillingFromAsaas }, computeAccess(), toMillis()

### Community 17 - "Community 17"
Cohesion: 0.2
Nodes (6): asaas, billing, billingUpdate, { db, fieldValue }, ref, { requireUser, cors }

### Community 18 - "Community 18"
Cohesion: 0.22
Nodes (8): dependencies, firebase-admin, engines, node, name, private, type, version

### Community 19 - "Community 19"
Cohesion: 0.25
Nodes (7): maxDuration, memory, functions, api/**/*.js, headers, rewrites, $schema

### Community 20 - "Community 20"
Cohesion: 0.4
Nodes (5): asaas, { fieldValue }, PAID_STATUSES, syncBillingFromAsaas(), fieldValue()

### Community 21 - "Community 21"
Cohesion: 0.6
Nodes (5): isValid(), lookupOwner(), normalize(), randomCode(), reserveUniqueCode()

### Community 22 - "Community 22"
Cohesion: 0.5
Nodes (3): firestore, indexes, rules

### Community 24 - "Community 24"
Cohesion: 0.09
Nodes (18): address, addressNumber, asaas, asaasFields, billing, city, complement, cpfCnpj (+10 more)

## Knowledge Gaps
- **138 isolated node(s):** `indexes`, `fieldOverrides`, `$schema`, `rewrites`, `memory` (+133 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Manual Patch since `e143015e`
_Anotações à mão dos 14 commits aplicados após a última extração automática. Cobre apenas estrutura de código (símbolos, arquivos, arestas relevantes); não recalcula centralidade nem comunidades._

### Novos arquivos
- `scripts/lib/mock-billing.js` — mock em memória de `firebase-admin` + `asaas` para testes. Exporta `setup()`, `call()`, `makeReq()`, `makeRes()`, `store`, `asaasState`, sentinels (`SERVER_TS`, `DELETE`) e `makeTimestamp()`.
- `scripts/test-referral-flow.js` — harness end-to-end do fluxo de indicação (41 asserções).
- `scripts/test-subscription-flow.js` — harness de assinatura "pagou usa, não pagou não usa" (57 asserções).

### Novas funções (nós a acrescentar)
| Função | Arquivo | Comunidade provável |
|---|---|---|
| `reverseReferralCredit()` | `api/billing/webhook.js` | Community 8 (créditos referral) |
| `signupIp()` | `api/billing/init.js` | Community 7 (init/customer) |
| `maskEmail()` | `api/billing/me.js` | Community 13 (`me` / billing readouts) |
| `hasActiveAccess()` | `firestore.rules` | Community 22 (firestore) |
| `billingDoc()` | `firestore.rules` | Community 22 |
| `setup()` | `scripts/lib/mock-billing.js` | nova Community (testes) |
| `call()` (helper) | `scripts/lib/mock-billing.js` | nova Community (testes) |
| `resolveValue()` / `mergeData()` | `scripts/lib/mock-billing.js` | nova Community (testes) |

### Funções modificadas (mantêm o nó; mudam arestas)
- `creditIndicatorFromIndicado()` (`api/billing/webhook.js`) — agora chama nova guard set `INDICATOR_BLOCKED_STATUSES`, checa CPF do indicador e idempotência por `payment.id`. Arestas novas para `creditsCol()` (idempotency read) e `indicatorBillingRef.collection('credits').doc(creditId).get()`.
- `module.exports` do webhook — agora consulta `webhookEvents/{eventKey}` em transação (nova chamada a `db().runTransaction`). Nova aresta `webhook.js → webhookEvents` collection.
- `module.exports` do `init.js` — wrap em `db.runTransaction()` para lock por uid; nova aresta `init.js → fieldValue().delete` para `initLock`/`initLockAt`. Função interna `releaseLock` (closure, não é nó separado).
- `computeAccess()` (`api/_lib/access.js`) — consome 2 novos sets `PAID_PAYMENT_STATUSES`, `BAD_PAYMENT_STATUSES`.
- `cors()` (`api/_lib/auth.js`) — lê `process.env.ALLOWED_ORIGINS`; cabeçalho `Vary: Origin` adicionado.
- `requireUser()` (`api/_lib/auth.js`) — deixa de devolver `e.code`/`e.message` no JSON; aresta para `console.error` mantida, sem nova dependência.
- `initBilling()` (`web/appliquei-billing.js`) — em erro de referral, agora refaz POST `/init` sem cupom (retry interno); arestas novas para `authedFetch('/init')` chamado em 2 caminhos.
- `appliqueiAuthSetModo()` (`Appliquei_v13.0.html`) — lê `sessionStorage.appliquei_pending_referral` para pré-popular `#authCupom`.
- `appliqueiAuthSubmit()` (`Appliquei_v13.0.html`) — só grava cupom em sessionStorage se o campo não estiver vazio (preserva o cupom da URL).
- `customer.js` e `subscribe.js` — nova aresta para `db().collectionGroup('billing').where('cpfCnpj', '==', ...)`.
- `subscribe.js` — nova chamada cruzada à billing do indicador para checar CPF idêntico (aresta `subscribe.js → users/{indicatorUid}/billing/account`).

### God Nodes — provável re-ranking
- `webhook.js` ganhou ~6 arestas novas (idempotência, reverse, INDICATOR_BLOCKED_STATUSES, payment id guard, refund handler). Deve subir no ranking.
- `init.js` ganhou ~5 arestas (transação, signupIp, releaseLock, initLock fields).
- `db()` (hub central) provavelmente ultrapassa as 14 arestas anteriores (novas chamadas em webhookEvents, collectionGroup CPF, billing indicador).

### Novas arestas estruturais
- `webhook.js → fieldValue` (mais usos para void/delete/increment)
- `webhook.js → db().collection('webhookEvents')` (idempotência C2)
- `init.js → db().runTransaction` (lock A3)
- `customer.js → collectionGroup('billing')` (CPF uniqueness)
- `subscribe.js → collectionGroup('billing')` + `subscribe.js → users/{id}/billing/account` (cross-uid CPF check)
- `firestore.rules → users/{uid}/billing/account` (rules agora cruzam doc via `get()` em `hasActiveAccess`)
- novo cluster `scripts/lib/mock-billing.js` ← {`test-referral-flow.js`, `test-subscription-flow.js`}; importam handlers reais via `setup()` (arestas para todos os endpoints de billing)

### Knowledge Gaps — esperado mudar após `graphify update`
- `webhookEvents` (collection nova) — provavelmente vira nó isolado até as escritas em `webhook.js` serem indexadas.
- `signupIp`, `signupUserAgent` (campos novos em `users/{uid}/billing/account`) — campos só passam a estar conectados quando o futuro analytics/anti-fraude lê-los.
- Pelo menos 138 nós isolados anteriores permanecem (não foram tocados).

### Communities — impacto qualitativo
| Comunidade | Mudança |
|---|---|
| Community 7 (`init`/customer) | +signupIp, transação de lock, releaseLock — coesão deve subir |
| Community 8 (créditos referral / webhook) | +reverseReferralCredit, INDICATOR_BLOCKED_STATUSES, idempotência — coesão deve subir |
| Community 13 (`me` / billing readouts) | +maskEmail, +cálculo de credits ignorando voidedAt |
| Community 22 (firestore) | +hasActiveAccess, +billingDoc — antes tinha só `indexes`/`rules`/`firestore` (3 nós); agora deve quase dobrar |
| Nova Community (testes) | scripts/lib/mock-billing + 2 testes + handlers como dependências |

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `db()` connect `Community 8` to `Community 6`, `Community 7`, `Community 13`, `Community 15`, `Community 16`, `Community 17`, `Community 24`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `fieldValue()` connect `Community 20` to `Community 6`, `Community 7`, `Community 8`, `Community 15`, `Community 17`, `Community 24`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `requireUser()` connect `Community 15` to `Community 6`, `Community 7`, `Community 13`, `Community 16`, `Community 17`, `Community 24`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `indexes`, `fieldOverrides`, `$schema` to the rest of the system?**
  _138 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._