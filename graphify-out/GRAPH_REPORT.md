# Graph Report - investimentos  (2026-05-19)

## Corpus Check
- 39 files · ~419,590 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 545 nodes · 1010 edges · 40 communities (36 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `dc85bbe4`
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
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]

## God Nodes (most connected - your core abstractions)
1. `$()` - 33 edges
2. `renderMyAccount()` - 31 edges
3. `db()` - 22 edges
4. `fieldValue()` - 16 edges
5. `call()` - 15 edges
6. `P()` - 15 edges
7. `main()` - 15 edges
8. `make_table()` - 14 edges
9. `Appliquei v13.0 - Gestão Financeira Inteligente` - 14 edges
10. `Appliquei v13.0 - Gestão Financeira Inteligente` - 14 edges

## Surprising Connections (you probably didn't know these)
- `markBilling()` --calls--> `db()`  [INFERRED]
  scripts/backfill-email-verification.js → api/_lib/firebase-admin.js
- `listAllUsers()` --calls--> `auth()`  [INFERRED]
  scripts/backfill-email-verification.js → api/_lib/firebase-admin.js
- `main()` --calls--> `auth()`  [INFERRED]
  scripts/backfill-email-verification.js → api/_lib/firebase-admin.js
- `markBilling()` --calls--> `fieldValue()`  [INFERRED]
  scripts/backfill-email-verification.js → api/_lib/firebase-admin.js
- `fixOne()` --calls--> `timestamp()`  [INFERRED]
  scripts/diag-referral-code.js → api/_lib/firebase-admin.js

## Communities (40 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.30
Nodes (12): attach(), attachWhenReady(), clearUserScopedKeys(), collectKeysPayload(), flushPush(), lastSeenUid(), mainRef(), onUser() (+4 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (40): Appliquei v13.0 - Gestão Financeira Inteligente, code:bash (git clone <repositorio>), code:block2 (/workspace), code:css (:root {), code:bash (python -m pip install -r requirements-graphify.txt), 🚀 Como Usar, 🤝 Contribuição, 👨‍💻 Desenvolvimento (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.35
Nodes (23): build_styles(), bullets(), callout(), caption(), cell(), cover(), main(), make_table() (+15 more)

### Community 3 - "Community 3"
Cohesion: 0.25
Nodes (15): apiKey(), baseUrl(), call(), cancelSubscription(), createCustomer(), createSubscription(), findCustomerByExternalReference(), getPaymentLink() (+7 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (83): $(), applyAccess(), applyCoupon(), authedFetch(), bindMyAccountActions(), cardBrandLabel(), clamp(), clearTrialBannerOffset() (+75 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (15): Arquitetura, Auth + Trial 7 dias + Assinatura Asaas (R$ 15/mês), code:block1 (┌────────────────────────┐         ┌────────────────────────), code:block2 (users/{uid}/data/main                       (já existente)), code:bash (# 1. Login + link), Configurar webhook Asaas, Deploy Vercel, Endpoints (+7 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (25): asaas, { assertReferralAllowed }, billing, billingUpdate, brandFromNumber(), cardMetadataFromAsaas(), conflict, cpfCnpj (+17 more)

### Community 7 - "Community 7"
Cohesion: 0.18
Nodes (10): asaasState, call(), DELETE, firestore, makeReq(), makeRes(), mockAsaas, mockFirebaseAdmin (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.15
Nodes (13): applyPendingCreditsTo(), asaas, billing, creditsCol(), { db, fieldValue }, { db, fieldValue, timestamp }, eventRef, INDICATOR_BLOCKED_STATUSES (+5 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (30): addMonthsYmd(), b, billing, billingRef, buildUpcoming(), c, { computeAccess }, credits (+22 more)

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (21): asaas, { assertReferralAllowed }, billing, codes, { computeAccess, TRIAL_DAYS }, D, data, { db, fieldValue, timestamp } (+13 more)

### Community 15 - "Community 15"
Cohesion: 0.52
Nodes (6): check(), H, log(), M, main(), step()

### Community 16 - "Community 16"
Cohesion: 0.36
Nodes (9): { auth }, cacheGet(), cacheSet(), invalidateUid(), requireFreshVerifiedUser(), requireUser(), requireVerifiedUser(), tokenCache (+1 more)

### Community 17 - "Community 17"
Cohesion: 0.18
Nodes (7): asaas, billing, billingUpdate, { db, fieldValue }, ref, { requireUser, cors }, { requireVerifiedUser, cors }

### Community 18 - "Community 18"
Cohesion: 0.22
Nodes (8): dependencies, firebase-admin, engines, node, name, private, type, version

### Community 19 - "Community 19"
Cohesion: 0.25
Nodes (7): maxDuration, memory, functions, api/**/*.js, headers, rewrites, $schema

### Community 20 - "Community 20"
Cohesion: 0.29
Nodes (8): APP_ORIGIN, { auth, db, fieldValue }, color(), listAllUsers(), main(), markBilling(), path, sendMail()

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (16): authUsers, { cors }, D, dayAgo, { db, auth }, lastPaymentStatus, m, now (+8 more)

### Community 22 - "Community 22"
Cohesion: 0.50
Nodes (3): firestore, indexes, rules

### Community 24 - "Community 24"
Cohesion: 0.08
Nodes (21): address, addressNumber, asaas, asaasFields, billing, city, complement, conflict (+13 more)

### Community 25 - "Community 25"
Cohesion: 0.25
Nodes (8): releaseLock(), creditIndicatorFromIndicado(), reverseReferralCredit(), asaas, { fieldValue }, PAID_STATUSES, syncBillingFromAsaas(), fieldValue()

### Community 26 - "Community 26"
Cohesion: 0.29
Nodes (6): asaas, billing, { db, fieldValue }, ref, { requireUser, cors }, { requireVerifiedUser, cors }

### Community 27 - "Community 27"
Cohesion: 0.57
Nodes (6): ensureReserved(), isValid(), lookupOwner(), normalize(), randomCode(), reserveUniqueCode()

### Community 28 - "Community 28"
Cohesion: 0.52
Nodes (6): check(), H, log(), M, main(), step()

### Community 29 - "Community 29"
Cohesion: 0.13
Nodes (14): 1.1 Stack e custos unitários, 1.2 Dinâmica do Applicash (lida em `Appliquei_v13.0.html:10724`), 1.3 Outras premissas, 1. Premissas, 2.1 Quebra de custos (mensal), 2.2 Faturamento anualizado e marcos, 2. Cenários de escala (assinantes **pagantes**), 3.1 E se o Applicash for mais agressivo do que o modelado? (+6 more)

### Community 30 - "Community 30"
Cohesion: 0.27
Nodes (12): findBillingByCustomer(), findBillingBySubscription(), db(), init(), codes, color(), { db, init, timestamp }, diagOne() (+4 more)

### Community 32 - "Community 32"
Cohesion: 0.33
Nodes (7): admin, timestamp(), check(), crypto, { db, fieldValue, timestamp }, hashKey(), windowStart()

### Community 34 - "Community 34"
Cohesion: 0.46
Nodes (7): check(), getPayment(), H, log(), M, main(), step()

### Community 36 - "Community 36"
Cohesion: 0.43
Nodes (6): deepClone(), isIncrement(), isTimestamp(), makeTimestamp(), mergeData(), resolveValue()

### Community 37 - "Community 37"
Cohesion: 0.40
Nodes (4): { auth }, { requireUser, cors }, rl, cors()

### Community 38 - "Community 38"
Cohesion: 0.70
Nodes (4): deviceFingerprint(), ipFrom(), assertReferralAllowed(), { deviceFingerprint, ipFrom }

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (3): admin, loadServiceAccount(), main()

## Knowledge Gaps
- **218 isolated node(s):** `indexes`, `fieldOverrides`, `$schema`, `rewrites`, `memory` (+213 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `db()` connect `Community 30` to `Community 32`, `Community 6`, `Community 8`, `Community 13`, `Community 14`, `Community 17`, `Community 20`, `Community 21`, `Community 24`, `Community 25`, `Community 26`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `fieldValue()` connect `Community 25` to `Community 32`, `Community 6`, `Community 8`, `Community 14`, `Community 17`, `Community 20`, `Community 24`, `Community 26`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `cors()` connect `Community 37` to `Community 6`, `Community 13`, `Community 14`, `Community 16`, `Community 17`, `Community 21`, `Community 24`, `Community 26`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `db()` (e.g. with `markBilling()` and `diagOne()`) actually correct?**
  _`db()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `indexes`, `fieldOverrides`, `$schema` to the rest of the system?**
  _218 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.07647058823529412 - nodes in this community are weakly interconnected._