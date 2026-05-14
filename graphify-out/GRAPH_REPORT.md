# Graph Report - investimentos  (2026-05-14)

## Corpus Check
- 18 files · ~391,528 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 211 nodes · 393 edges · 18 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0cec9a69`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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

## God Nodes (most connected - your core abstractions)
1. `P()` - 15 edges
2. `main()` - 15 edges
3. `make_table()` - 14 edges
4. `Appliquei v13.0 - Gestão Financeira Inteligente` - 14 edges
5. `Appliquei v13.0 - Gestão Financeira Inteligente` - 14 edges
6. `caption()` - 13 edges
7. `$()` - 12 edges
8. `db()` - 11 edges
9. `call()` - 10 edges
10. `Auth + Trial 7 dias + Assinatura Asaas (R$ 15/mês)` - 10 edges

## Surprising Connections (you probably didn't know these)
- `findBillingByCustomer()` --calls--> `db()`  [EXTRACTED]
  api/billing/webhook.js → api/_lib/firebase-admin.js
- `findBillingBySubscription()` --calls--> `db()`  [EXTRACTED]
  api/billing/webhook.js → api/_lib/firebase-admin.js
- `requireUser()` --calls--> `auth()`  [EXTRACTED]
  api/_lib/auth.js → api/_lib/firebase-admin.js
- `applyPendingCreditsTo()` --calls--> `db()`  [EXTRACTED]
  api/billing/webhook.js → api/_lib/firebase-admin.js
- `creditIndicatorFromIndicado()` --calls--> `db()`  [EXTRACTED]
  api/billing/webhook.js → api/_lib/firebase-admin.js

## Communities (18 total, 0 thin omitted)

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
Cohesion: 0.23
Nodes (23): $(), applyAccess(), authedFetch(), closeMyAccount(), ensureGate(), ensureMyAccountModal(), ensureTrialBanner(), fetchMe() (+15 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (13): Arquitetura, Auth + Trial 7 dias + Assinatura Asaas (R$ 15/mês), code:block1 (┌────────────────────────┐         ┌────────────────────────), code:block2 (users/{uid}/data/main                       (já existente)), code:bash (# 1. Login + link), Configurar webhook Asaas, Deploy Vercel, Endpoints (+5 more)

### Community 6 - "Community 6"
Cohesion: 0.15
Nodes (9): asaas, billing, cpfCnpj, customerName, { db, fieldValue }, fields, nextDue, ref (+1 more)

### Community 7 - "Community 7"
Cohesion: 0.15
Nodes (12): asaas, billing, codes, { computeAccess, TRIAL_DAYS }, D, data, { db, fieldValue, timestamp }, now (+4 more)

### Community 8 - "Community 8"
Cohesion: 0.16
Nodes (16): applyPendingCreditsTo(), asaas, billing, creditIndicatorFromIndicado(), creditsCol(), { db, fieldValue }, { db, fieldValue, timestamp }, findBillingByCustomer() (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.24
Nodes (7): access, { computeAccess }, { db }, { requireUser, cors }, { auth }, cors(), requireUser()

### Community 14 - "Community 14"
Cohesion: 0.35
Nodes (10): apiKey(), baseUrl(), call(), createCustomer(), createSubscription(), getPaymentLink(), listPaymentsBySubscription(), updateCustomer() (+2 more)

### Community 15 - "Community 15"
Cohesion: 0.5
Nodes (4): admin, auth(), init(), timestamp()

### Community 16 - "Community 16"
Cohesion: 0.18
Nodes (10): billing, billingRef, { computeAccess }, credits, D, { db }, projectedNextCents, { requireUser, cors } (+2 more)

### Community 17 - "Community 17"
Cohesion: 0.6
Nodes (5): isValid(), lookupOwner(), normalize(), randomCode(), reserveUniqueCode()

## Knowledge Gaps
- **77 isolated node(s):** `admin`, `{ auth }`, `{ db }`, `{ requireUser, cors }`, `{ computeAccess }` (+72 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `db()` connect `Community 8` to `Community 6`, `Community 7`, `Community 13`, `Community 15`, `Community 16`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `Appliquei v13.0 - Gestão Financeira Inteligente` connect `Community 3` to `Community 1`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `admin`, `{ auth }`, `{ db }` to the rest of the system?**
  _77 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Community 5` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._