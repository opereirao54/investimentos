# Contribuindo para o Appliquei

## Setup

```bash
# Node 22+ obrigatório (testes usam glob expansion do node --test)
nvm use            # lê .nvmrc
npm install
npm run dev        # http://localhost:5173/landing.html
```

## Workflow

1. Crie uma branch a partir de `main`:
   ```bash
   git checkout -b feat/minha-feature
   ```
2. Faça mudanças. **lint-staged** roda automaticamente no pre-commit (eslint --fix + prettier).
3. Antes de pushar:
   ```bash
   npm run lint       # 0 erros (warnings ok)
   npm test           # 58 unit tests
   npm run test:flows # 108 checks de billing/referral
   npm run build      # vite build deve passar
   ```
4. Push e abra PR contra `main`. CI roda tudo automaticamente.
5. **Validação em browser real**: deploy preview do Vercel sobe automaticamente. Faça smoke test no URL antes de mergear (ver checklist abaixo).

## Convenções

### Mensagens de commit

Formato livre, mas com prefixo de tipo no estilo conventional commits:
- `feat:` nova feature
- `fix:` correção de bug
- `refactor:` mudança estrutural sem alterar comportamento
- `test:` adição/correção de testes
- `chore:` infraestrutura, build, deps
- `docs:` documentação
- `style:` formatação (não funcional)

Mensagem em PT-BR é OK. Corpo do commit deve explicar **o porquê**, não o **o quê**.

### Code style

- **Prettier** + **ESLint 9** configurados no repo. Não pelejam: rode `npm run format` se algo brigar.
- `var` no top-level de classic scripts (`/web/appliquei-app.js`, `/web/appliquei-aba-*.js` etc.) — top-level `let`/`const` viraria script-scoped e quebraria cross-refs. Tem teste guard pra isso.
- Módulos ES (`/web/appliquei-{firebase-init,cloud-sync,billing,auth-gate,sentry-init,firebase-config-*}.js`) podem usar `let`/`const` à vontade — escopo de módulo isola.

### Onde mexer

| Mudança | Arquivo(s) |
| --- | --- |
| Lógica de assinatura/billing | `api/billing/*.js` + `web/appliquei-billing.js` |
| ABA Meus Investimentos | `web/appliquei-app.js` (core) + `web/appliquei-aba1-charts.js` (visualizações) |
| Controle Financeiro | `web/appliquei-aba-controle-financeiro.js` |
| Sonhos / Dream Planner | `web/appliquei-sonhos.js` |
| Cotações / Yahoo | `web/appliquei-yahoo-finance.js` + `api/market.js` (cache server-side) |
| Validação de input API | `api/_lib/schemas.js` (Zod) |
| Auth/middleware comum API | `api/_lib/handler.js` |
| Painel admin | `admin.html` + `web/appliquei-admin.js` + `api/admin/*` |

### Regras estritas

- **NÃO adicione mais endpoints em `/api/`**: estamos no cap de **12** (Vercel Hobby). Adições reais devem consolidar via `?op=` (ver `api/market.js`) ou subir para Pro.
- **NÃO use `let`/`const` top-level em classic scripts**: o teste `classic-scripts-globals.test.js` falha.
- **NÃO converta classic scripts em modules sem expor os globais**: o HTML tem 100+ handlers `onclick="funcaoX()"` que dependem.
- **NÃO faça push direto em `main`**: sempre PR + review.

## Testes

### Unit tests (`npm test`)

`node --test` em `test/*.test.js`. Cobertura atual:
- `access.test.js` — matriz pagou/não pagou
- `cpf-cnpj.test.js` — validação DV
- `handler.test.js` — wrapper de API (cors, auth, Zod, exception)
- `schemas.test.js` — Zod schemas reusáveis
- `classic-scripts-globals.test.js` — guard contra `let`/`const` top-level
- `classic-scripts-load.test.js` — smoke runtime: carrega tudo em vm sandbox
- `build-bundle-parse.test.js` — roda `vite build` e parseia o chunk

### Contratos de integração (`npm run test:integracoes`)

As telas da Appliquei não conversam por API — conversam por **contratos de
dados implícitos**: chaves de `localStorage` compartilhadas, globais em
`window` e ligações que existem só como convenção de campo (`sonhoId`,
`contaId`, `operacaoId`, `txId`, `divKey`). Por isso quebram **caladas**: nada
lança erro, o número só fica errado.

`.claude/integracoes/mapa.json` declara esses contratos — quem escreve, quem lê,
que regra nunca pode ser violada, e o sintoma que o usuário vê quando quebra.
Cada regra tem uma trava executável em `test/integracao-inv*.test.js`.

**Antes de fechar qualquer alteração em `web/`:**

```bash
npm run impacto            # quais contratos a sua alteração coloca em risco
npm run test:integracoes   # roda todas as travas
```

`npm run impacto` cala a boca quando nada foi tocado. Quando fala, sai com o
comando exato dos testes a rodar.

Ao mudar como o dinheiro anda entre as telas, atualize o mapa **junto** com o
código — um contrato que não está no mapa não é validado por ninguém. Ver
`.claude/integracoes/mapa.schema.md`.

### Flow tests (`npm run test:flows`)

Cenários de billing e referral usando mocks de Asaas + Firestore.
- `scripts/test-subscription-flow.js` — 67 checks ("pagou usa, não pagou não usa")
- `scripts/test-referral-flow.js` — 41 checks (cupom Applicash)

Adicione cenário novo se mudar lógica de:
- `api/_lib/access.js` (computeAccess)
- `api/_lib/billing-sync.js`
- `api/billing/webhook.js` (especialmente eventos de pagamento)

## Checklist de PR

- [ ] `npm run lint` — 0 erros
- [ ] `npm test` — verde
- [ ] `npm run test:integracoes` — 102/102
- [ ] `npm run test:flows` — 108/108
- [ ] `npm run build` — verde
- [ ] CI passa (todas as steps verdes)
- [ ] Vercel preview deploy validado em browser real:
  - [ ] `/` carrega landing
  - [ ] `/app` faz login Firebase
  - [ ] Trocar de aba não dá ReferenceError em DevTools console
  - [ ] Operação básica (cadastrar lançamento, exportar PDF, etc.) funciona
- [ ] Variáveis de ambiente novas documentadas em `.env.example` e `README.md`
- [ ] Se mudou billing: cenário coberto em `scripts/test-*-flow.js`
- [ ] Se adicionou classic script: registrado em `test/classic-scripts-globals.test.js` + `test/classic-scripts-load.test.js`
- [ ] Se mexeu em `web/`: `npm run impacto` rodado e as provas que ele listou passam
- [ ] Se mudou como o dinheiro anda entre telas: contrato atualizado em `.claude/integracoes/mapa.json` + trava em `test/integracao-inv*.test.js`

## Releases

Não fazemos release tags ainda — deploy é contínuo via Vercel a partir de `main`. Quando precisar versionar (ex.: hotfix retroativo), usar SemVer simples no `package.json` + tag git.
