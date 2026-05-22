# Graph Report - investimentos  (2026-05-22)

## Corpus Check
- 41 files · ~437,136 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 659 nodes · 1196 edges · 43 communities (38 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4ff56ad7`
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
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
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
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]

## God Nodes (most connected - your core abstractions)
1. `$()` - 33 edges
2. `renderMyAccount()` - 32 edges
3. `db()` - 23 edges
4. `fieldValue()` - 18 edges
5. `call()` - 15 edges
6. `P()` - 15 edges
7. `main()` - 15 edges
8. `make_table()` - 14 edges
9. `Appliquei - Gestão Financeira Inteligente` - 14 edges
10. `Appliquei - Gestão Financeira Inteligente` - 14 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `init()`  [INFERRED]
  scripts/diag-referral-code.js → api/_lib/firebase-admin.js
- `markBilling()` --calls--> `db()`  [INFERRED]
  scripts/backfill-email-verification.js → api/_lib/firebase-admin.js
- `diagOne()` --calls--> `db()`  [INFERRED]
  scripts/diag-referral-code.js → api/_lib/firebase-admin.js
- `scanAll()` --calls--> `db()`  [INFERRED]
  scripts/diag-referral-code.js → api/_lib/firebase-admin.js
- `fixOne()` --calls--> `db()`  [INFERRED]
  scripts/diag-referral-code.js → api/_lib/firebase-admin.js

## Communities (43 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (85): $(), applyAccess(), applyCoupon(), authedFetch(), bindMyAccountActions(), cardBrandLabel(), clamp(), clearTrialBannerOffset() (+77 more)

### Community 1 - "Community 1"
Cohesion: 0.18
Nodes (10): asaasState, call(), DELETE, firestore, makeReq(), makeRes(), mockAsaas, mockFirebaseAdmin (+2 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (35): 0. Preparação (1x), 1.1 Cadastro com e-mail e senha (E1), 1.2 Login Google "novo" pela aba **Entrar** (G1), 1.3 Cadastro Google pela aba **Criar conta** (G1), 1.4 Banner de transição (e-mails antigos), 1.5 Reset de senha (E1), 1.6 Isolamento entre contas (commit `fa6d97a`), 1.7 Cloud sync no signOut (commit `81be8ce`) (+27 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (30): Arquitetura, Auth + Trial 7 dias + Assinatura Asaas (R$ 15/mês), code:block1 (┌────────────────────────┐         ┌────────────────────────), code:block2 (users/{uid}/data/main                       (já existente)), code:bash (# 1. Login + link), Configurar webhook Asaas, Deploy Vercel, Endpoints (+22 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (25): address, addressNumber, asaas, asaasFields, billing, city, complement, conflict (+17 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (23): asaas, { assertReferralAllowed }, billing, billingUpdate, brandFromNumber(), cardMetadataFromAsaas(), conflict, cpfCnpj (+15 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (20): releaseLock(), applyPendingCreditsTo(), asaas, billing, creditIndicatorFromIndicado(), creditsCol(), { db, fieldValue }, { db, fieldValue, timestamp } (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.35
Nodes (23): build_styles(), bullets(), callout(), caption(), cell(), cover(), main(), make_table() (+15 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (21): asaas, { assertReferralAllowed }, billing, codes, { computeAccess, TRIAL_DAYS }, D, data, { db, fieldValue, timestamp } (+13 more)

### Community 9 - "Community 9"
Cohesion: 0.15
Nodes (21): apiKey(), baseUrl(), call(), cancelSubscription(), createCustomer(), createSubscription(), findCustomerByExternalReference(), getPaymentLink() (+13 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (36): addMonthsYmd(), b, billing, billingRef, buildUpcoming(), c, { computeAccess }, credits (+28 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (21): Appliquei - Gestão Financeira Inteligente, Appliquei v13.0 - Gestão Financeira Inteligente, code:bash (git clone <repositorio>), code:block2 (/workspace), code:css (:root {), code:bash (python -m pip install -r requirements-graphify.txt), 🚀 Como Usar, 🤝 Contribuição (+13 more)

### Community 12 - "Community 12"
Cohesion: 0.17
Nodes (33): applyRemoteSnapshot(), attach(), attachWhenReady(), beaconFlushNow(), buildBeaconPayload(), clearUserScopedKeys(), collectDirtyPayload(), collectKeysPayload() (+25 more)

### Community 13 - "Community 13"
Cohesion: 0.10
Nodes (20): Appliquei - Gestão Financeira Inteligente, code:bash (git clone <repositorio>), code:block2 (/workspace), code:css (:root {), code:bash (python -m pip install -r requirements-graphify.txt), 🚀 Como Usar, 🤝 Contribuição, 👨‍💻 Desenvolvimento (+12 more)

### Community 14 - "Community 14"
Cohesion: 0.10
Nodes (20): Appliquei v13.0 - Gestão Financeira Inteligente, code:bash (git clone <repositorio>), code:block2 (/workspace), code:css (:root {), code:bash (python -m pip install -r requirements-graphify.txt), 🚀 Como Usar, 🤝 Contribuição, 👨‍💻 Desenvolvimento (+12 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (16): authUsers, { cors }, D, dayAgo, { db, auth }, lastPaymentStatus, m, now (+8 more)

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (14): 1.1 Stack e custos unitários, 1.2 Dinâmica do Applicash (lida em `Appliquei_v13.0.html:10724`), 1.3 Outras premissas, 1. Premissas, 2.1 Quebra de custos (mensal), 2.2 Faturamento anualizado e marcos, 2. Cenários de escala (assinantes **pagantes**), 3.1 E se o Applicash for mais agressivo do que o modelado? (+6 more)

### Community 17 - "Community 17"
Cohesion: 0.22
Nodes (7): access, billingRef, { computeAccess }, { db }, { requireUser, cors }, { requireVerifiedUser, cors }, { syncBillingFromAsaas }

### Community 18 - "Community 18"
Cohesion: 0.29
Nodes (10): timestamp(), check(), crypto, { db, fieldValue, timestamp }, deviceFingerprint(), hashKey(), ipFrom(), windowStart() (+2 more)

### Community 19 - "Community 19"
Cohesion: 0.18
Nodes (7): asaas, billing, billingUpdate, { db, fieldValue }, ref, { requireUser, cors }, { requireVerifiedUser, cors }

### Community 20 - "Community 20"
Cohesion: 0.29
Nodes (8): APP_ORIGIN, { auth, db, fieldValue }, color(), listAllUsers(), main(), markBilling(), path, sendMail()

### Community 21 - "Community 21"
Cohesion: 0.39
Nodes (8): codes, color(), { db, init, timestamp }, diagOne(), fixOne(), main(), path, scanAll()

### Community 22 - "Community 22"
Cohesion: 0.36
Nodes (9): { auth }, cacheGet(), cacheSet(), invalidateUid(), requireFreshVerifiedUser(), requireUser(), requireVerifiedUser(), tokenCache (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.22
Nodes (8): dependencies, firebase-admin, engines, node, name, private, type, version

### Community 24 - "Community 24"
Cohesion: 0.25
Nodes (7): maxDuration, memory, functions, api/**/*.js, headers, rewrites, $schema

### Community 25 - "Community 25"
Cohesion: 0.29
Nodes (6): asaas, billing, { db, fieldValue }, ref, { requireUser, cors }, { requireVerifiedUser, cors }

### Community 26 - "Community 26"
Cohesion: 0.57
Nodes (6): ensureReserved(), isValid(), lookupOwner(), normalize(), randomCode(), reserveUniqueCode()

### Community 27 - "Community 27"
Cohesion: 0.52
Nodes (6): check(), H, log(), M, main(), step()

### Community 28 - "Community 28"
Cohesion: 0.52
Nodes (6): check(), H, log(), M, main(), step()

### Community 29 - "Community 29"
Cohesion: 0.40
Nodes (4): { auth }, { requireUser, cors }, rl, cors()

### Community 30 - "Community 30"
Cohesion: 0.67
Nodes (3): admin, loadServiceAccount(), main()

### Community 31 - "Community 31"
Cohesion: 0.50
Nodes (3): firestore, indexes, rules

### Community 39 - "Community 39"
Cohesion: 0.46
Nodes (7): check(), getPayment(), H, log(), M, main(), step()

### Community 41 - "Community 41"
Cohesion: 0.43
Nodes (6): deepClone(), isIncrement(), isTimestamp(), makeTimestamp(), mergeData(), resolveValue()

## Knowledge Gaps
- **278 isolated node(s):** `indexes`, `fieldOverrides`, `$schema`, `rewrites`, `memory` (+273 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `db()` connect `Community 6` to `Community 4`, `Community 5`, `Community 8`, `Community 10`, `Community 42`, `Community 15`, `Community 17`, `Community 18`, `Community 19`, `Community 20`, `Community 21`, `Community 25`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `fieldValue()` connect `Community 6` to `Community 4`, `Community 5`, `Community 8`, `Community 9`, `Community 42`, `Community 10`, `Community 18`, `Community 19`, `Community 20`, `Community 25`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `cors()` connect `Community 29` to `Community 4`, `Community 5`, `Community 8`, `Community 10`, `Community 15`, `Community 17`, `Community 19`, `Community 22`, `Community 25`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `db()` (e.g. with `markBilling()` and `diagOne()`) actually correct?**
  _`db()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `indexes`, `fieldOverrides`, `$schema` to the rest of the system?**
  _278 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07457898957497995 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05555555555555555 - nodes in this community are weakly interconnected._