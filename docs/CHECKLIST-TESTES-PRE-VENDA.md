# Checklist de Testes — Pré-venda Appliquei

> Objetivo: validar manualmente **tudo** que foi mexido nos últimos dias antes
> de abrir as vendas, garantindo que ninguém entra no app sem trial/assinatura
> válidos e que o Applicash não pode ser explorado.
>
> **Como usar**: marque ☐ → ✅ à medida que testar. Use **uma janela anônima
> nova** por bloco para não contaminar sessão. Anote o e-mail usado em cada
> teste — vai precisar limpar depois no Firebase Auth + Firestore.

---

## 0. Preparação (1x)

- ☐ Ter 3 contas Gmail diferentes disponíveis (G1, G2, G3) — preferível
  iCloud Hide-My-Email ou Gmail com `+sufixo`.
- ☐ Ter 2 e-mails reais para fluxo de senha (E1, E2).
- ☐ Ter 2 CPFs válidos diferentes (use [4devs](https://www.4devs.com.br/gerador_de_cpf)
  só para sandbox).
- ☐ Asaas em **sandbox** com cartão de teste `5162306219378829` (ou outro do painel).
- ☐ Webhook do Asaas apontando para o ambiente que vai testar.
- ☐ Variáveis Vercel populadas (`ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`,
  `FIREBASE_SERVICE_ACCOUNT_BASE64`, etc.).
- ☐ Abrir DevTools → aba Network + Console em todos os testes para flagrar
  requests `403`, `429`, `500`.

---

## 1. Login / Cadastro / E-mail verificado

### 1.1 Cadastro com e-mail e senha (E1)
- ☐ Abre a aba **"Criar conta"** → preenche → submete.
- ☐ Recebe e-mail de verificação na caixa de entrada (verificar **spam**).
- ☐ Antes de verificar: aparece **painel "Verifique seu e-mail"** com botão
  *Reenviar*.
- ☐ Botão *Reenviar* funciona (1ª vez) e bloqueia em rajada (`/api/auth/resend-verification`
  tem rate-limit).
- ☐ Clica no link do e-mail → volta no app, recarrega → painel some, app libera
  trial.
- ☐ **Tentativa de bypass**: chamar `/api/billing/init` antes de verificar →
  deve retornar **403 `email_not_verified`**.

### 1.2 Login Google "novo" pela aba **Entrar** (G1)
- ☐ Aba **"Entrar"** → "Continuar com Google" → escolhe conta nunca usada.
- ☐ App deve **rejeitar com mensagem persistente** ("essa conta não existe;
  use a aba Criar conta") e **desconectar** automaticamente. Não pode liberar
  trial silencioso.
- ☐ A mensagem permanece visível mesmo após mudar de aba/scroll
  (commit `fa6d97a`).

### 1.3 Cadastro Google pela aba **Criar conta** (G1)
- ☐ Aba **"Criar conta"** → Google → mesma conta acima.
- ☐ Cria billing + trial **sem pedir verificação** (Google já é verificado).
- ☐ Banner verde "Avaliação gratuita: 7 dias restantes" aparece no topo.

### 1.4 Banner de transição (e-mails antigos)
- ☐ Em conta antiga (criada antes do enforcement) o **banner "verifique seu
  e-mail até DD/MM"** aparece e oferece reenvio (commit `c314859`).
- ☐ Depois da data o app bloqueia (testar adiantando relógio só no servidor
  via env var; se não der, validar visualmente o copy).

### 1.5 Reset de senha (E1)
- ☐ "Esqueci minha senha" → recebe e-mail → consegue trocar → loga.

### 1.6 Isolamento entre contas (commit `fa6d97a`)
- ☐ Loga em E1, adiciona transação A.
- ☐ SignOut → loga em E2 num **mesmo browser** → **NÃO** pode ver transação A.
- ☐ Volta para E1 → transação A continua lá.

### 1.7 Cloud sync no signOut (commit `81be8ce`)
- ☐ Loga E1, faz alteração, espera sync.
- ☐ SignOut → faz login E2 → não enxerga dado de E1.
- ☐ Volta para E1 → dado **não foi sobrescrito** por localStorage vazio
  (commit `833f94b`).

---

## 2. Trial de 7 dias

- ☐ G1 acabou de criar conta → `GET /api/billing/me` retorna `status:"trial"` e
  `trialEndsAt` ~7 dias no futuro.
- ☐ Banner verde no topo: "Avaliação gratuita: 7 dias restantes".
- ☐ Botão "Assinar agora" visível, mas **sem gate** bloqueando uso.
- ☐ Forçar expiração do trial (script ou alterar `trialEndsAt` no Firestore
  para passado) → **gate aparece** após o polling (≤30s) ou reload.
- ☐ Sem trial expirado, conseguir usar **todas as abas** (controle, gráficos,
  Applicash, etc.).

---

## 3. Assinatura Asaas (R$ 15/mês)

### 3.1 Fluxo feliz com cartão
- ☐ Trial expirado → clica "Assinar agora" → abre formulário **redesenhado**
  (commit `7833b56`).
- ☐ Preenche CPF + cartão → submete → abre tab com **invoiceUrl**.
- ☐ Confirma pagamento no checkout Asaas sandbox.
- ☐ Volta no app → em ≤30s o gate **desaparece** sozinho (polling).
- ☐ Card "Minha assinatura" mostra próximo vencimento e status `ACTIVE`.

### 3.2 Validação CPF/CNPJ (commit `177f3fc`)
- ☐ Digita CPF com checksum **inválido** (ex.: `111.111.111-11`) → backend
  recusa com erro claro.
- ☐ CPF válido formato `999.999.999-99` mas sem checksum → recusa.
- ☐ CNPJ inválido → recusa.

### 3.3 Cupom no gate (commits `417bb6e`, `cf87225`, `52efe74`)
- ☐ Gate sem subscriptionId → campo "Cupom" **visível**.
- ☐ Gate com subscriptionId pendente → campo ainda **visível** (commit `52efe74`).
- ☐ Aplica cupom válido → mostra preço **com desconto** atualizado.
- ☐ Cupom inválido → mensagem de erro, não trava o form.
- ☐ Cupom de **Applicash** vindo da URL (`?ref=...`) → aplicado automaticamente
  e mantido entre reloads (commit `05de0ab`).

### 3.4 Cartão recusado
- ☐ Usa cartão de falha do sandbox → invoice fica `PENDING`/`OVERDUE`.
- ☐ Frontend mostra `pending_payment` → gate **continua** bloqueado.

### 3.5 Webhooks
- ☐ Após `PAYMENT_CONFIRMED` no Asaas → `users/{uid}/billing/account/payments/{id}`
  criado no Firestore.
- ☐ `webhookEvents/{eventId}` criado com `expiresAt` (TTL, commit `2bceae0`).
- ☐ **Replay do mesmo webhook** (reenvia pelo painel Asaas) → idempotente,
  não duplica pagamento (commit `a0b477e`).
- ☐ Token de webhook **inválido** no header → backend retorna 401 e ignora.
- ☐ `PAYMENT_RECEIVED_IN_CASH` (simulação sandbox) → libera acesso (commit `2c62ccf`).

### 3.6 Cancelamento
- ☐ "Cancelar assinatura" → confirma → status vai para `INACTIVE`.
- ☐ Próximo `GET /me`: `status=blocked` (se trial já passou) e gate volta.
- ☐ Reassinatura sobre conta `INACTIVE` → cria nova sub limpa (commit `subscribe.js:160`).

### 3.7 Cartão recusado / troca de cartão
- ☐ `POST /api/billing/card` com novo cartão → atualiza no Asaas.
- ☐ Próxima fatura processa com o novo cartão.

### 3.8 Inadimplência
- ☐ Forçar `PAYMENT_OVERDUE` via webhook do Asaas → `subscriptionStatus`
  atualiza e usuário cai em `blocked`.

---

## 4. Applicash (programa de indicações)

### 4.1 Geração e share (commit `d7c6bb7`)
- ☐ Aba Applicash → conta paga → gera **cupom único** e **link compartilhável**.
- ☐ Link tem apenas **um** parâmetro `?ref=` (não duplicado, commit `55d5127`).
- ☐ Copy do texto não fala "qualquer plano" (commit `55d5127`).
- ☐ Empty state (sem indicações ainda) mostra layout correto (commit `ca08b5e`).

### 4.2 Uso do cupom por indicado
- ☐ Abre link `?ref=CUPOM` em janela anônima → cadastra G2.
- ☐ Cupom é **persistido** mesmo após navegação interna (commit `05de0ab`).
- ☐ No gate de assinatura, cupom já vem **pré-preenchido** e com desconto visível.
- ☐ Indicado assina → owner do cupom **ganha crédito**.
- ☐ Painel Applicash do indicador soma +1 em "indicações ativas"
  (`activeReferrals` em `me.js`).

### 4.3 Anti-fraude (commits `a0b477e`, `8e81500`, `9d6e594`, `33202ab`)
- ☐ Mesmo IP + mesmo device tentando criar 3+ contas seguidas → bloqueio
  `too_many_trials` (HTTP 429, commit `2651230`).
- ☐ Mesmo CPF/CNPJ em duas contas → segunda não pode receber crédito de
  indicação (referral-guard).
- ☐ Auto-indicação (usuário usa o próprio cupom) → não credita.
- ☐ Indicação circular (A indica B, B indica A) → não credita.

---

## 5. Endpoints / Admin

- ☐ `GET /api/billing/me` autenticado retorna payload completo (status, trial,
  subscription, lastPayments, referrals).
- ☐ Tempo de resposta `<500ms` em cache quente (commit `177f3fc` melhora perf).
- ☐ `GET /api/admin/stats` **sem header admin** → 401/403.
- ☐ Com header admin correto → retorna totais (usuários, ativos, MRR estimado).
- ☐ `users/{uid}/billing/account` no Firestore **não é gravável** pelo cliente
  (rules), só leitura (validar com console do Firebase logado).

---

## 6. Segurança / Rules

- ☐ Tentar `setDoc` direto pelo SDK no `users/{uid}/billing/account` → bloqueado.
- ☐ Tentar ler `users/{outroUid}/...` → bloqueado.
- ☐ Comprovantes em `users/{uid}/data/main/proofs/...` só leitura/escrita do
  dono (commit `177f3fc`).
- ☐ Rules **enforced** (`firestore.rules.enforced`) exigem `email_verified`
  para escrita de dados sensíveis.

---

## 7. UX / Regressões

- ☐ Sidebar/mobile funcionam após últimos refactors.
- ☐ Cartão de crédito entra na **competência da fatura**, não no mês da compra
  (commit `62d56b3`).
- ☐ Gráficos regerados (`GRAPH_REPORT.md`) sem quebrar tela.
- ☐ Cache busting `appliquei-billing.js v20260515a` (commit `aed0c80`) — abrir
  em browsers que tinham versão antiga e confirmar que carregam o JS novo
  (sem `Ctrl+Shift+R`).

---

## 8. Pós-teste — Limpeza

- ☐ Apagar usuários de teste no Firebase Auth.
- ☐ Apagar `users/{uidTeste}` no Firestore.
- ☐ Cancelar assinaturas/clientes de teste no painel Asaas sandbox.
- ☐ Rodar `node scripts/seed-ttl-collections.js` se a TTL precisar de seed.

---

# Ferramentas / Extensões recomendadas antes de abrir as vendas

A ideia é montar **camadas** — nenhuma ferramenta sozinha resolve. O que mais
faz sentido para o stack atual (Vercel + Firebase + Asaas + frontend estático):

## A. Já em uso ou parcialmente
| Ferramenta | Status | O que cobre |
|---|---|---|
| **Cloudflare** (auto-detect já existe, commit `662861c`) | parcial | WAF, bot mitigation, rate-limit na borda. **Ativar Pro plan** quando vender — habilita regras WAF mais agressivas e *Bot Fight Mode*. |
| **Firebase Auth + rules** | ok | Identidade. Falta **App Check** (ver abaixo). |
| **Rate-limit interno** (`api/_lib/rate-limit.js`) | ok | Anti-fraude por device+IP. |

## B. **Instalar antes** de abrir vendas (prioridade alta)

1. **Firebase App Check** (com reCAPTCHA Enterprise v3 no browser).
   - Garante que só o **seu** frontend chama as APIs. Bloqueia bots que pegam
     o `idToken` válido e batem nos endpoints `/api/billing/*` direto.
   - Custo: grátis até cotas generosas.
   - Esforço: ~1 dia. Tem que adicionar header `X-Firebase-AppCheck` e validar
     no `api/_lib/auth.js`.

2. **Sentry** (frontend + serverless).
   - Captura exceções não tratadas no browser e nas funções Vercel, com
     **session replay** para reproduzir bug de pagamento.
   - Plano *Team* (~US$26/mês) já basta. Habilitar **filtros de PII** para
     não logar CPF/cartão.

3. **GitHub Dependabot + secret scanning** (grátis).
   - Já incluído no GitHub. Ativar em *Settings → Security*. Alerta de CVE
     em dependências (`firebase-admin`, `node-fetch`, etc.) e flagra se
     subir uma chave Asaas/Firebase por engano.

4. **Vercel Firewall / Rate Limit** (built-in plano Pro).
   - Limita requisições por IP no edge antes de chegar na função. Custa
     ~zero comparado a Lambda ddosado.

5. **Asaas → ativar "Notificação de tentativas de fraude"** + 3DS no cartão.
   - No painel Asaas: *Configurações → Antifraude*. Cobre chargebacks.

## C. Recomendado, baixo esforço

6. **Snyk** (free para repos públicos pequenos; pago p/ privados).
   - Sobreposição com Dependabot, mas tem **SAST** (analisa o próprio código,
     não só deps). Detecta SQL/XSS/SSRF.

7. **OWASP ZAP** (uma rodada manual antes do go-live).
   - Roda um *spider + active scan* no domínio. Pega coisas como CSRF
     ausente, headers fracos (HSTS, CSP), redirect aberto. Grátis.

8. **Mozilla Observatory** + **securityheaders.com**.
   - Dois cliques: cola a URL, ele dá nota A-F dos headers HTTP. Mira em
     A+ antes de vender (CSP, HSTS, X-Frame-Options).

9. **Cloudflare Turnstile** no formulário de signup (alternativa free ao
   reCAPTCHA, sem PII para o Google).

## D. Operacional / billing

10. **UptimeRobot** ou **BetterStack** (free tier).
    - Ping a cada 1 min em `/api/billing/me?ping=1` e webhook Asaas.
    - Avisa em Telegram/Slack se cair.

11. **LogSnag** ou **Slack webhook** custom para eventos críticos:
    - novo signup, primeira fatura paga, cancel, webhook falhou.
    - Permite responder rápido nos primeiros 100 clientes.

## E. Extensões VS Code / Cursor (DevEx)

- **GitGuardian** ou **TruffleHog** (pre-commit hook) — barra commit com
  segredo.
- **ESLint plugin security** (`eslint-plugin-security`) — pega `eval`,
  regex catastrófica, etc.
- **SonarLint** — análise estática enquanto digita.

## Prioridade prática (ordem do que eu faria)

1. **Firebase App Check + Sentry** ← antes do primeiro cliente real.
2. Dependabot + secret scanning ligados no GitHub (5 minutos).
3. Rodar OWASP ZAP + securityheaders.com, corrigir o que sair F/D.
4. Configurar Cloudflare Pro + Vercel rate-limit no edge.
5. UptimeRobot + alertas Slack/Telegram.
6. (depois das primeiras vendas) Snyk + SonarLint.

---

**Próximo passo sugerido**: imprime esse checklist, executa **bloco a bloco**
numa janela anônima, e abre uma issue por item que falhar com print do
DevTools/Network. Cada falha vira um commit pequeno antes de abrir vendas.
