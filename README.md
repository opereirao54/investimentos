# Appliquei

Gestão financeira pessoal — frontend SPA + API serverless + Firestore.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Frontend | HTML/CSS/JS vanilla, Chart.js, módulos ES + classic scripts (bundle Vite) |
| Build | Vite 5 em modo MPA (multi-page app) |
| API | Node.js serverless (Vercel Functions) — 12 endpoints |
| Validação API | Zod schemas + wrapper unificado em `api/_lib/handler.js` |
| Banco | Firestore (regras enforced em `firestore.rules`) |
| Auth | Firebase Auth (e-mail/senha + Google) |
| Pagamentos | Asaas (assinaturas, cartão, webhooks idempotentes) |
| Observabilidade | Sentry (browser e Node) — lazy-loaded por DSN |
| CI | GitHub Actions (lint + 58 unit tests + 108 flow tests + Vite build) |

## Desenvolvimento

Requer **Node.js 22+** (testes usam `node --test` com glob expansion).

```bash
npm install
npm run dev       # Vite dev server em :5173
npm run build     # build de produção em dist/
npm run preview   # serve dist/ em :4173
```

`/api/*` **não roda** em `vite dev` (são Vercel Functions). Para testar billing/auth/admin localmente, em outro terminal:

```bash
npx vercel dev    # serve dist/ + api/ em :3000
```

## Scripts npm

| Script | O que faz |
| --- | --- |
| `npm run dev` | Vite dev server (HMR, sem API) |
| `npm run build` | `vite build` → `dist/` |
| `npm run preview` | Serve `dist/` localmente |
| `npm run lint` | ESLint 9 em `api/`, `scripts/`, `web/` |
| `npm run lint:fix` | Lint com auto-fix |
| `npm run format` | Prettier write em todos os JS/JSON/MD |
| `npm run format:check` | Verifica formatação sem alterar |
| `npm test` | 58 unit tests (`node --test`) |
| `npm run test:flows` | 108 checks de billing/referral (mock Asaas + Firestore) |
| `npm run optimize:assets` | Re-encoda JPGs grandes com sharp |

## Estrutura

```
.
├── Appliquei_v13.0.html         # SPA principal (~6700 linhas, 99% layout/CSS)
├── admin.html                    # Painel admin
├── landing.html                  # Página de marketing
├── api/                          # 12 endpoints Vercel Functions
│   ├── _lib/
│   │   ├── handler.js            # Wrapper unificado (cors + auth + Zod + try/catch + Sentry)
│   │   ├── schemas.js            # Zod schemas reusáveis (cpfCnpj, email, etc.)
│   │   ├── sentry.js             # Sentry @sentry/node lazy init
│   │   ├── auth.js               # requireUser/Verified/Fresh
│   │   ├── firebase-admin.js     # Firebase Admin SDK
│   │   ├── asaas.js              # Cliente Asaas
│   │   ├── access.js             # computeAccess (pagou usa, não pagou não usa)
│   │   ├── billing-sync.js       # sync billing ↔ Asaas
│   │   ├── codes.js              # geração + reserva de cupons APP-XXXXXX
│   │   ├── referral-guard.js     # bloqueia self-referral (uid/device/IP/CPF)
│   │   ├── rate-limit.js         # rate-limit Firestore-based
│   │   ├── access.js
│   │   └── cpf-cnpj.js           # validação DV módulo 11
│   ├── admin/{action,stats}.js   # Painel admin (token estático)
│   ├── auth/resend-verification.js
│   ├── billing/{init,subscribe,cancel,me,card,customer,webhook}.js
│   ├── market.js                 # Dispatcher: ?op=quote|history|warmup
│   └── sync/push.js              # Beacon endpoint para mobile freeze
├── web/                          # JS frontend (modular: 23 arquivos)
│   ├── appliquei-firebase-init.js    # ES module — bootstrap Firebase
│   ├── appliquei-cloud-sync.js       # ES module — sync localStorage ↔ Firestore
│   ├── appliquei-billing.js          # ES module — gate de assinatura
│   ├── appliquei-auth-gate.js        # ES module — verificação de e-mail
│   ├── appliquei-sentry-init.js      # ES module — Sentry browser dynamic import
│   ├── appliquei-utils.js            # Classic — parseBRL, mostrarToast, export/import
│   ├── appliquei-app.js              # Classic — bootstrap + ABA 1 core
│   ├── appliquei-aba-*.js            # Classic — ABAs 2, 4, 5, 6, Dividendos
│   ├── appliquei-aba1-charts.js      # Classic — charts da Meus Investimentos
│   ├── appliquei-{sonhos,patrimonio,jornada,relatorio-mensal,…}.js  # Features
│   ├── appliquei-admin.js            # Classic — lógica do admin.html
│   ├── appliquei-yahoo-finance.js    # Classic — proxy multi-fallback de cotações
│   ├── appliquei-renda-fixa.js       # Classic — projeção CDI/Selic/IPCA
│   ├── appliquei-previdencia.js      # Classic — recorrência mensal
│   └── firebase-config.{example,appliquei-prod}.js  # ES modules
├── test/                         # 58 unit tests
│   ├── access.test.js
│   ├── cpf-cnpj.test.js
│   ├── handler.test.js            # Cobre o wrapper api/_lib/handler.js
│   ├── schemas.test.js            # Cobre os Zod schemas
│   ├── classic-scripts-globals.test.js  # Guard: top-level let/const em classic scripts
│   ├── classic-scripts-load.test.js     # Smoke runtime: carrega tudo em vm sandbox
│   └── build-bundle-parse.test.js       # Roda vite build e parseia o chunk
├── scripts/                       # Utilities Node (testes flow, backfills, etc.)
├── docs/                          # ONDA2-VITE.md, scaling-analysis.md, …
├── vite.config.js                 # MPA com 3 entradas + plugin copyWebDir
├── eslint.config.js               # Flat config 9 (separa module vs classic-script)
├── firestore.rules                # Regras enforced
└── vercel.json                    # buildCommand: npm run build, outputDirectory: dist
```

## Deploy

Automático via Vercel quando push em `main`. PRs geram preview deploys.

Variáveis de ambiente (Vercel Project Settings → Environment Variables):

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | ✓ | Service account JSON em base64 |
| `FIREBASE_PROJECT_ID` | ✓ | `appliquei-prod` |
| `ASAAS_API_KEY` | ✓ | Token Asaas |
| `ASAAS_API_URL` | ✓ | `https://api.asaas.com/v3` |
| `ASAAS_WEBHOOK_TOKEN` | ✓ | Token do webhook (Asaas envia em `asaas-access-token`) |
| `CRON_SECRET` | auto | Vercel injeta para `api/market?op=warmup` |
| `ADMIN_API_TOKEN` | opt | Habilita `/api/admin/*` |
| `BRAPI_TOKEN` | opt | Cotações renda variável (free tier sem token) |
| `SENTRY_DSN` | opt | Observabilidade API (Sentry @sentry/node) |
| `EMAIL_VERIFY_ENFORCE` | opt | `true` = bloqueia hard quem não verificou e-mail |
| `ANTIFRAUD_INIT_ENABLED` | opt | `true` = rate-limit 5/dia IP + 3/mês device em `/init` |
| `REFERRAL_BLOCK_SAME_IP` | opt | `true` = bloqueia referral entre mesmo IP |

Para Sentry browser, edite no HTML:

```html
<script>window.__APPLIQUEI_SENTRY_DSN__='https://...@sentry.io/...';</script>
```

## Arquitetura — pontos importantes

- **Cap de 12 endpoints** (limite Vercel Hobby). Market usa dispatcher por `?op=`.
- **Bundle ES module** (`Appliquei_v13.0-<hash>.js`) carrega Firebase init + sync + billing + auth-gate + Sentry deferred (após HTML parse).
- **Classic scripts** (`/web/appliquei-*.js`) carregam síncrono no fim do `<body>`. Ordem importa para variáveis globais cross-file.
- **CRÍTICO**: classic scripts NÃO podem usar `let`/`const` no top-level — viram script-scoped (invisíveis a outros arquivos). Use `var`. Test `classic-scripts-globals.test.js` enforce isso.
- **Idempotência do webhook**: `body.id` é a chave; eventos repetidos viram no-op via `webhookEvents/<id>` doc com TTL.
- **LWW por-chave** no sync localStorage ↔ Firestore: cada chave tem `keyRev` (timestamp local) que decide quem ganha em merge.

## Documentação

- [`docs/ONDA2-VITE.md`](docs/ONDA2-VITE.md) — migração para Vite MPA
- [`docs/scaling-analysis.md`](docs/scaling-analysis.md) — análise de escala
- [`docs/CHECKLIST-TESTES-PRE-VENDA.md`](docs/CHECKLIST-TESTES-PRE-VENDA.md) — QA manual
- [`BILLING.md`](BILLING.md) — fluxos de billing detalhados
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — workflow de desenvolvimento

## Licença

MIT — ver [`LICENSE`](LICENSE).
