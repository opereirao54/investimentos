# Appliquei

Gestão financeira pessoal — frontend SPA + API serverless + Firestore.

## Stack

| Camada          | Tecnologia                                                                |
| --------------- | ------------------------------------------------------------------------- |
| Frontend        | HTML/CSS/JS vanilla, Chart.js, módulos ES + classic scripts (bundle Vite) |
| Build           | Vite 5 em modo MPA (multi-page app)                                       |
| API             | Node.js serverless (Vercel Functions) — 12 endpoints                      |
| Validação API   | Zod schemas + wrapper unificado em `api/_lib/handler.js`                  |
| Banco           | Firestore (regras enforced em `firestore.rules`)                          |
| Auth            | Firebase Auth (e-mail/senha + Google)                                     |
| Pagamentos      | Asaas (assinaturas, cartão, webhooks idempotentes)                        |
| Observabilidade | Sentry (browser e Node) — lazy-loaded por DSN                             |
| CI              | GitHub Actions (lint + 58 unit tests + 108 flow tests + Vite build)       |

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

| Script                    | O que faz                                               |
| ------------------------- | ------------------------------------------------------- |
| `npm run dev`             | Vite dev server (HMR, sem API)                          |
| `npm run build`           | `vite build` → `dist/`                                  |
| `npm run preview`         | Serve `dist/` localmente                                |
| `npm run lint`            | ESLint 9 em `api/`, `scripts/`, `web/`                  |
| `npm run lint:fix`        | Lint com auto-fix                                       |
| `npm run format`          | Prettier write em todos os JS/JSON/MD                   |
| `npm run format:check`    | Verifica formatação sem alterar                         |
| `npm test`                | 58 unit tests (`node --test`)                           |
| `npm run test:flows`      | 108 checks de billing/referral (mock Asaas + Firestore) |
| `npm run optimize:assets` | Re-encoda JPGs grandes com sharp                        |
| `npm run icons:build`     | Regera `icons/` (tela de início) a partir do SVG        |
| `npm run ingest:cvm`      | Dry-run da ingestão da CVM (relatório, não grava)       |

## Estrutura

```
.
├── Appliquei_v13.0.html         # SPA principal (~6700 linhas, 99% layout/CSS)
├── admin.html                    # Painel admin
├── landing.html                  # Página de marketing
├── manifest.webmanifest          # "Adicionar à tela de início" (nome, cores, ícones)
├── icons/                        # Ícones da tela de início — gerados, não editar à mão
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
│   ├── user.js                   # ?op=feedback | ?op=resend-verification
│   ├── billing/{init,subscribe,cancel,me,card,customer,webhook}.js
│   ├── market.js                 # Dispatcher: ?op=quote|history|news|fundamentals|ranking|diagnostico|indicadores|rendafixa|warmup
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
│   ├── appliquei-motor-carteira.js   # Classic — motor de score + alocação (puro, sem DOM)
│   ├── appliquei-yahoo-finance.js    # Classic — proxy multi-fallback de cotações
│   ├── appliquei-renda-fixa.js       # Classic — projeção CDI/Selic/IPCA
│   ├── appliquei-previdencia.js      # Classic — recorrência mensal
│   ├── appliquei-primeiros-passos.js # Classic — guia do 1º uso e do pós-reset
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

| Variável                          | Obrigatória | Descrição                                                               |
| --------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | ✓           | Service account JSON em base64                                          |
| `FIREBASE_PROJECT_ID`             | ✓           | `appliquei-prod`                                                        |
| `ASAAS_API_KEY`                   | ✓           | Token Asaas                                                             |
| `ASAAS_API_URL`                   | ✓           | `https://api.asaas.com/v3`                                              |
| `ASAAS_WEBHOOK_TOKEN`             | ✓           | Token do webhook (Asaas envia em `asaas-access-token`)                  |
| `CRON_SECRET`                     | auto        | Vercel injeta para `api/market?op=warmup`                               |
| `ADMIN_API_TOKEN`                 | opt         | Habilita `/api/admin/*`                                                 |
| `BRAPI_TOKEN`                     | opt         | Cotações e proventos. Fundamentos vêm da CVM (`docs/MOTOR-CARTEIRA.md`) |
| `SENTRY_DSN`                      | opt         | Observabilidade API (Sentry @sentry/node)                               |
| `EMAIL_VERIFY_ENFORCE`            | opt         | `true` = bloqueia hard quem não verificou e-mail                        |
| `ANTIFRAUD_INIT_ENABLED`          | opt         | `true` = rate-limit 5/dia IP + 3/mês device em `/init`                  |
| `REFERRAL_BLOCK_SAME_IP`          | opt         | `true` = bloqueia referral entre mesmo IP                               |

Para Sentry browser, edite no HTML:

```html
<script>
  window.__APPLIQUEI_SENTRY_DSN__ = 'https://...@sentry.io/...';
</script>
```

## Arquitetura — pontos importantes

- **Cap de 12 endpoints** (limite Vercel Hobby). Market usa dispatcher por `?op=`.
- **Bundle ES module** (`Appliquei_v13.0-<hash>.js`) carrega Firebase init + sync + billing + auth-gate + Sentry deferred (após HTML parse).
- **Classic scripts** (`/web/appliquei-*.js`) carregam síncrono no fim do `<body>`. Ordem importa para variáveis globais cross-file.
- **CRÍTICO**: classic scripts NÃO podem usar `let`/`const` no top-level — viram script-scoped (invisíveis a outros arquivos). Use `var`. Test `classic-scripts-globals.test.js` enforce isso.
- **Idempotência do webhook**: `body.id` é a chave; eventos repetidos viram no-op via `webhookEvents/<id>` doc com TTL.
- **LWW por-chave** no sync localStorage ↔ Firestore: cada chave tem `keyRev` (timestamp local) que decide quem ganha em merge.
- **Motor da Carteira Recomendada** (`web/appliquei-motor-carteira.js`): pontua ativos por 5 pilares e monta o plano de aporte. Puro — sem DOM, rede ou Firebase — para rodar em `node --test`. Abaixo de 30% de cobertura de indicadores **não devolve score**: devolve a lista do que falta. Ver `docs/MOTOR-CARTEIRA.md`.
- **Quando o motor não pontua**, use `?op=diagnostico&ticker=X`: ele diz, por camada, o que cada fonte respondeu e qual elo partiu. O protocolo de leitura é a skill `.claude/skills/diagnostico-motor-carteira/`, que dispara sozinha nesse tipo de relato. Regra da casa: **fonte que falha degrada para a versão simples dela e nunca deixa o ticker sem registo** — card sem linha de procedência significa que o endpoint não devolveu nada.
- **O universo de candidatos vem do dado, não de lista escrita à mão**: o FCA da CVM declara o vínculo ticker ↔ `CD_CVM`, e `?op=ranking` pontua a bolsa inteira e devolve a lista curta por classe. A carteira do consultor virou um modo opcional ao lado de "Todo o mercado". Filtros de porte e liquidez são contados e mostrados na tela — universo que encolhe em silêncio não se depura.
- **Fundamentos vêm da CVM**, não de API comercial: `scripts/ingest-cvm.js` roda semanalmente no GitHub Actions (`.github/workflows/ingest-cvm.yml`), calcula os indicadores das DFP e do Informe Mensal de FII e grava no ramo `cvm` de `marketFundamentals`. A cotação grava no ramo `mercado`, e `api/market.js` compõe os dois na leitura — ramos separados porque a resposta da BRAPI traz `null` em quase todo campo fundamentalista e um merge plano apagaria o trabalho da ingestão.
- **As regras do Firestore são publicadas pelo CI**, não à mão: `.github/workflows/firestore-rules.yml` faz o deploy de `firestore.rules` a cada push em `main` que toque o arquivo, e confere semanalmente se o publicado ainda bate com o repositório (`npm run regras:conferir`). A publicação fala direto com a API de Rules (`npm run regras:publicar`), sem o `firebase-tools`: a CLI confere antes na Service Usage API se o Firestore está habilitado, e a service account do Admin SDK não tem permissão nem para isso — a primeira execução do workflow morreu exatamente aí. Existe porque as duas pontas já divergiram em silêncio: a regra `match /feedback/{id}` entrou no repositório com a tela de Dúvidas & Sugestões e nunca foi publicada — todo envio voltava `permission-denied` e nada no projeto comparava as duas coisas. A conferência semanal também pega edição feita à mão no Console. Índices ficam FORA do deploy de propósito: remover um índice derruba as consultas que dependiam dele.
- **O primeiro uso é guiado** (`web/appliquei-primeiros-passos.js`): com o app vazio — primeiro acesso ou logo após "Recomeçar do zero" — um convite responde à dúvida que trava todo mundo ("preciso criar a conta antes de lançar?" — não precisa: `executarInsercao` chama `obterOuCriarContaPorNome` com o nome digitado) e oferece **seguir** ou **pular**. Quem segue ganha um cartão de passos que se marca sozinho a partir dos DADOS, nunca de cliques. O estado mora em `appliquei_primeiros_passos` e está **fora** de `RESET_CHAVES_PRESERVADAS` — é isso que faz o guia voltar depois de zerar. Ele espera o pull inicial da nuvem antes de aparecer: no aparelho novo de um usuário antigo, o localStorage vazio é indistinguível de um usuário novo.
- **Selic, CDI e IPCA** vêm do SGS e do Focus do Banco Central (`?op=indicadores`), com validação de faixa por série: código de série errado devolve número válido de outra coisa, então cada candidata é conferida antes de ser aceita.

## Documentação

- [`docs/ONDA2-VITE.md`](docs/ONDA2-VITE.md) — migração para Vite MPA
- [`docs/APP-CHECK.md`](docs/APP-CHECK.md) — Firebase App Check (anti-abuso) e rollout do enforcement
- [`docs/scaling-analysis.md`](docs/scaling-analysis.md) — análise de escala
- [`docs/CHECKLIST-TESTES-PRE-VENDA.md`](docs/CHECKLIST-TESTES-PRE-VENDA.md) — QA manual
- [`BILLING.md`](BILLING.md) — fluxos de billing detalhados
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — workflow de desenvolvimento

## Licença

MIT — ver [`LICENSE`](LICENSE).
