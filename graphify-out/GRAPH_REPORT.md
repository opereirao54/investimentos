# Graph Report - investimentos  (2026-05-16)

## Corpus Check
- 31 files · ~407,243 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 426 nodes · 764 edges · 22 communities (21 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `aed0c807`
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
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]

## God Nodes (most connected - your core abstractions)
1. `$()` - 26 edges
2. `renderMyAccount()` - 20 edges
3. `db()` - 18 edges
4. `P()` - 15 edges
5. `main()` - 15 edges
6. `call()` - 14 edges
7. `make_table()` - 14 edges
8. `Appliquei v13.0 - Gestão Financeira Inteligente` - 14 edges
9. `Appliquei v13.0 - Gestão Financeira Inteligente` - 14 edges
10. `fieldValue()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `init()`  [INFERRED]
  scripts/diag-referral-code.js → api/_lib/firebase-admin.js
- `diagOne()` --calls--> `db()`  [INFERRED]
  scripts/diag-referral-code.js → api/_lib/firebase-admin.js
- `scanAll()` --calls--> `db()`  [INFERRED]
  scripts/diag-referral-code.js → api/_lib/firebase-admin.js
- `fixOne()` --calls--> `db()`  [INFERRED]
  scripts/diag-referral-code.js → api/_lib/firebase-admin.js
- `fixOne()` --calls--> `timestamp()`  [INFERRED]
  scripts/diag-referral-code.js → api/_lib/firebase-admin.js

## Communities (22 total, 1 thin omitted)

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
Nodes (59): $(), applyAccess(), authedFetch(), bindMyAccountActions(), cardBrandLabel(), clearTrialBannerOffset(), closeMyAccount(), closeSubModal() (+51 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (13): Arquitetura, Auth + Trial 7 dias + Assinatura Asaas (R$ 15/mês), code:block1 (┌────────────────────────┐         ┌────────────────────────), code:block2 (users/{uid}/data/main                       (já existente)), code:bash (# 1. Login + link), Configurar webhook Asaas, Deploy Vercel, Endpoints (+5 more)

### Community 6 - "Community 6"
Cohesion: 0.1
Nodes (16): asaas, billing, billingUpdate, brandFromNumber(), cardMetadataFromAsaas(), conflict, cpfCnpj, customerName (+8 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (27): asaasState, Batch, call(), CollRef, deepClone(), DELETE, DocRef, firestore (+19 more)

### Community 8 - "Community 8"
Cohesion: 0.1
Nodes (29): releaseLock(), applyPendingCreditsTo(), asaas, billing, creditIndicatorFromIndicado(), creditsCol(), { db, fieldValue }, { db, fieldValue, timestamp } (+21 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (40): asaas, billing, codes, { computeAccess, TRIAL_DAYS }, D, data, { db, fieldValue, timestamp }, ip (+32 more)

### Community 14 - "Community 14"
Cohesion: 0.26
Nodes (14): apiKey(), baseUrl(), call(), cancelSubscription(), createCustomer(), createSubscription(), getPaymentLink(), getSubscription() (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.24
Nodes (12): check(), H, log(), M, main(), step(), check(), H (+4 more)

### Community 18 - "Community 18"
Cohesion: 0.22
Nodes (8): dependencies, firebase-admin, engines, node, name, private, type, version

### Community 19 - "Community 19"
Cohesion: 0.25
Nodes (7): maxDuration, memory, functions, api/**/*.js, headers, rewrites, $schema

### Community 21 - "Community 21"
Cohesion: 0.57
Nodes (6): ensureReserved(), isValid(), lookupOwner(), normalize(), randomCode(), reserveUniqueCode()

### Community 22 - "Community 22"
Cohesion: 0.5
Nodes (3): firestore, indexes, rules

### Community 24 - "Community 24"
Cohesion: 0.05
Nodes (42): asaas, billing, { db, fieldValue }, ref, { requireUser, cors }, asaas, billing, billingUpdate (+34 more)

## Knowledge Gaps
- **162 isolated node(s):** `indexes`, `fieldOverrides`, `$schema`, `rewrites`, `memory` (+157 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `db()` connect `Community 8` to `Community 24`, `Community 13`, `Community 6`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `fieldValue()` connect `Community 8` to `Community 24`, `Community 13`, `Community 6`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `requireUser()` connect `Community 24` to `Community 13`, `Community 6`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `db()` (e.g. with `diagOne()` and `scanAll()`) actually correct?**
  _`db()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `indexes`, `fieldOverrides`, `$schema` to the rest of the system?**
  _162 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._