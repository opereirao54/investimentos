# Auditoria técnica — Appliquei

> Data: 2026-05-28. Escopo: estado atual do repositório (Ondas 1–3 em
> andamento). **Esta auditoria considera o que já existe** — ESLint flat
> config, CI no GitHub Actions, Sentry instalado (browser + node), testes
> unitários com `node --test`, Vite MPA build verde, Husky + lint-staged
> rodando pre-commit. Não relista nada disso como "lacuna".

## Convenção

- **Criticidade**: Alta = bloqueia venda / risco de dado ou receita. Média
  = degrada confiabilidade ou velocidade do time. Baixa = polimento.
- **Esforço**: P = pontual (horas), M = médio (1–2 dias), G = grande (semana+).
- **Ganho**: o que a correção destrava.

---

## Alta

### A1. Não há testes E2E (Playwright/Cypress) — endereçado nesta sessão
- **Status**: Suíte atual cobre handlers de API, schemas Zod, parse de
  bundle Vite, classic scripts. Nenhuma cobre o **fluxo real do usuário**
  no browser (login UI, navegação entre abas, billing flow visível).
- **Impacto**: regressões visuais ou de fluxo passam pelo CI verde. O
  `docs/CHECKLIST-TESTES-PRE-VENDA.md` lista isso como **manual** —
  esforço repetido toda release.
- **Correção**: ver Fase 4 abaixo. Esforço: M. Ganho: smoke automatizado
  contra `vite preview` em cada PR.

### A2. `firestore.rules` em produção é a versão **transitória**, não a `.enforced`
- **Local**: `firestore.rules` linhas 56–59 e `firestore.rules.enforced`.
- **Impacto**: a regra atual permite **leitura** de `billing/account` sem
  `email_verified == true` ("legados podem ler o próprio estado durante
  o período de transição"). Quando o backfill terminar, manter a regra
  permissiva é exposição desnecessária — usuário não-verificado consegue
  inspecionar o doc via SDK no console.
- **Verificação**: rodar `scripts/backfill-email-verification.js` em dry-run
  e ver quantos usuários ainda estão sem `email_verified`. Se já é < 1%,
  promover `.enforced` para `firestore.rules`.
- **Esforço**: P (depois do backfill estar concluído). Ganho: fecha vetor
  documentado no próprio código.

### A3. CI não tem gate de formatação
- **Local**: `.github/workflows/ci.yml` — comentário explícito: *"Format
  check fica de fora por enquanto"*.
- **Impacto**: arquivo legado sem prettier passa, e novos arquivos podem
  divergir do estilo se o autor pular o pre-commit (`--no-verify`,
  contribuição via web UI do GitHub, dependabot). Diffs ruidosos no review.
- **Correção 1 (incremental, recomendada)**: rodar `npm run format` em
  PR isolado abrangendo só `api/`, `scripts/`, `web/`, `test/` — manter
  HTMLs grandes fora. Depois adicionar `npm run format:check` ao CI.
- **Correção 2**: aceitar o diff grande agora e ligar `format:check`.
- **Esforço**: P. Ganho: zero diff de formatação em reviews.

---

## Média

### M1. CI não verifica integridade da pasta `dist/` (smoke do build)
- **Local**: `.github/workflows/ci.yml` etapa "Vite build (Onda 2)".
- **Impacto**: build pode terminar com `dist/` vazio ou faltando assets
  e CI passa verde. Já há `test/build-bundle-parse.test.js` cobrindo
  parse, mas não tamanho/existência dos três entrypoints HTML.
- **Correção**: pequeno teste em `test/` que faz `ls dist/*.html` e
  exige `landing.html`, `Appliquei_v13.0.html`, `admin.html`, `web/`.
  Roda só se `dist/` existir (`if (!fs.existsSync('dist')) test.skip`).
- **Esforço**: P. Ganho: detecta regressão silenciosa no `vite.config.js`.

### M2. Sentry depende de DSN injetado por `<script>` inline no HTML
- **Local**: `web/appliquei-sentry-init.js` linhas 18–20.
- **Impacto**: se alguém remover o `<script>window.__APPLIQUEI_SENTRY_DSN__='...'</script>`
  do HTML por engano (ou esquecer ao criar um novo HTML, ex.: futuro
  `pricing.html`), Sentry vira no-op silencioso em produção e ninguém
  percebe — não há alerta. Pior: o init **engole exceções** do próprio
  `import('@sentry/browser')` em `try/catch` que só faz `console.warn`.
- **Correção**: ao buildar com Vite, ler `VITE_SENTRY_DSN` do env e
  injetar via `define` ou plugin html-inject. Em produção sem DSN
  configurado, falhar o build com aviso (ou pelo menos logar warning
  na pipeline).
- **Esforço**: P. Ganho: garantia de captura em produção.

### M3. `vercel.json` ainda aponta para HTMLs da raiz, não `dist/`
- **Local**: `vercel.json` + `docs/ONDA2-VITE.md` ("deploy ainda não migrado").
- **Impacto**: o build Vite está verde mas **não é o que vai pro ar**. CI
  valida que Vite compila; produção serve o HTML monolítico direto. Se
  o `vite.config.js` quebrar silenciosamente e ninguém migrar, vai dar
  surpresa no dia da migração.
- **Correção**: cumprir o roteiro descrito em `docs/ONDA2-VITE.md`
  ("Próximo passo — mudar o deploy") — fazer em PR separada com Vercel
  preview, smoke test do preview URL e merge.
- **Esforço**: M. Ganho: build do Vite vira fonte da verdade.

### M4. Linhas inline em HTML monolítico sem lint (já assumido — explicitar técnica)
- **Local**: `eslint.config.js` linhas 12–17 (`'*.html'` em ignores) +
  `Appliquei_v13.0.html` 6753 linhas.
- **Impacto**: ~80% da lógica visível ao usuário vive em JS inline do
  HTML grande, fora do linter e fora dos testes. Onda 3 está
  endereçando — mas no estado atual qualquer typo em `appliqueiAuthGoogle`
  inline passa pelo CI.
- **Correção temporária**: extrair em prioridade os blocos `<script>`
  inline que tocam autenticação (`#authGate` em `Appliquei_v13.0.html:4640+`)
  para módulo `web/appliquei-auth-ui.js` e linkar — fluxo crítico fica
  testável. Roteiro Onda 3 em `docs/ONDA2-VITE.md` já cobre estratégia.
- **Esforço**: G (incremental, um script por vez). Ganho: lint +
  testes cobrem o fluxo de login real.

### M5. `api/_lib/handler.js` engole erro de `readBody` no `JSON.parse`
- **Local**: `api/_lib/handler.js` linhas 45–48.
- **Impacto**: cliente envia JSON malformado → `catch (_)` retorna `{}` →
  `bodySchema.safeParse({})` falha por campos obrigatórios → 400 com
  `invalid_body` mas a issue real ("JSON inválido") nunca é reportada.
  Debug ruim em produção.
- **Correção**: distinguir parse error de body vazio. Se `raw` é
  não-vazio mas parse falhou, retornar 400 `invalid_json` antes de
  rodar o schema.
- **Esforço**: P. Ganho: erro mais claro nos logs e no cliente.

### M6. `package.json` declara `"private": true` mas não declara `"license"`/`"author"`
- **Local**: `package.json`.
- **Impacto**: `LICENSE` existe na raiz mas o `package.json` não aponta
  para ela — alguns scanners de compliance reclamam.
- **Correção**: adicionar `"license": "..."` no `package.json` espelhando
  o arquivo `LICENSE`.
- **Esforço**: P. Ganho: higiene.

---

## Baixa

### B1. Não há medição de cobertura de testes
- Hoje rodamos `node --test` mas não há `--experimental-test-coverage`
  nem c8/nyc. Sem baseline, não dá pra ver regressão de cobertura
  por PR.
- **Correção**: adicionar `node --test --experimental-test-coverage` no
  script de test e publicar resumo no PR via comment do CI.
- **Esforço**: P.

### B2. Não há checagem de acessibilidade automatizada
- `landing.html` é a porta de entrada do trial. axe-core no Playwright
  pegaria contraste, alt-text, labels.
- **Correção**: depois da Fase 4, adicionar `@axe-core/playwright` e
  validar landing/admin login.
- **Esforço**: P (depois de Playwright instalado).

### B3. `scripts/test-subscription-flow.js` e `test-referral-flow.js` rodam contra serviço externo
- Esses scripts chamam Asaas + Firebase Admin reais. Em CI, dependem
  de credenciais nos secrets. Se a chave expirar, o CI fica vermelho
  por motivo externo ao código.
- **Correção**: mover para job opcional (`workflow_dispatch` ou job
  `if: secrets...`) — não bloquear PR por instabilidade de terceiro.
- **Esforço**: P.

### B4. Dependências críticas sem renovate / audit no CI
- Dependabot existe (commits recentes), mas não há `npm audit` rodando
  no CI nem `--audit-level=high` no pipeline. Vulnerabilidade nova
  fica latente até o próximo dependabot.
- **Correção**: adicionar `npm audit --omit=dev --audit-level=high`
  como step não-bloqueante no CI (ou em workflow agendado weekly).
- **Esforço**: P.

### B5. `appliquei-sentry-init.js` filtra "ResizeObserver loop" sem normalizar a regex
- **Local**: `web/appliquei-sentry-init.js` linha 38. A regex casa
  `ResizeObserver loop` mas não `ResizeObserver loop completed with
  undelivered notifications` em todas as variações (alguns browsers
  emitem `ResizeObserver Loop Limit Exceeded`).
- **Correção**: trocar por `/ResizeObserver loop|ResizeObserver Loop Limit/i`.
- **Esforço**: P.

---

## Fase 4 (Playwright) — entregue nesta sessão

Esta auditoria foi feita em conjunto com a instalação de Playwright como
suíte E2E. Configuração entregue:

- `@playwright/test` em devDependencies.
- `playwright.config.js` rodando contra `vite preview` na porta 4173.
- Pasta `e2e/` com 3 specs cobrindo:
  - `landing.spec.js` — `landing.html` renderiza, seções `#funcionalidades`,
    `#planos`, `#faq` visíveis, footer com ano correto, **zero erro
    crítico de console**.
  - `app.spec.js` — `Appliquei_v13.0.html` carrega o `#authGate`, tabs
    `Entrar` / `Criar conta` alternam, campos `#authEmail` / `#authSenha`
    presentes, botão Google visível.
  - `admin.spec.js` — `admin.html` carrega `#login-overlay`, input
    `#admin-token` e botão `#login-btn` clicáveis, mensagem de erro
    aparece com token vazio.
- Scripts npm: `test:e2e`, `test:e2e:ui`, `test:e2e:install`.
- Job `e2e` adicionado ao `.github/workflows/ci.yml` — instala Chromium,
  builda, sobe `vite preview`, roda os specs. Falha = bloqueia merge.

Próximos incrementos sugeridos (não feitos aqui, decisão sua):

1. Conta Firebase de teste em `staging` para cobrir login real com
   email/senha (`Appliquei_v13.0.html` fluxo completo).
2. Mock do Firebase Auth via `page.route()` para testar sem rede.
3. `@axe-core/playwright` em landing + admin (B2).
