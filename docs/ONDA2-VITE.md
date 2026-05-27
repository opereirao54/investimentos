# Onda 2 — Vite em modo MPA

Status: **build verde, deploy ainda não migrado**.

## O que entrou

- `vite.config.js` com os três HTMLs como entradas (`landing.html`,
  `Appliquei_v13.0.html`, `admin.html`).
- Scripts npm: `dev`, `build`, `preview`.
- Plugin inline que copia `web/` para `dist/web/` (scripts legados sem
  `type="module"` continuam servidos no mesmo path relativo).
- Assets com content-hash automático em `dist/assets/` (substitui o
  cache-busting manual `?v=YYYYMMDD`).
- CI roda `npm run build` em todo PR — regressão de build = vermelho.

## O que ainda **NÃO** mudou

- **Deploy continua direto da raiz**: `vercel.json` aponta para
  `landing.html` e `Appliquei_v13.0.html` na raiz (não em `dist/`).
- Os HTMLs e `web/*.js` na raiz seguem sendo a fonte servida em produção.
- O build local apenas valida que a migração para Vite é viável quando
  topar mudar o deploy.

## Como rodar

```bash
npm run dev        # dev server em http://localhost:5173/landing.html
npm run build      # gera dist/
npm run preview    # serve dist/ em http://localhost:4173
```

`/api/*` **não** está disponível no dev server do Vite (são funções
serverless da Vercel). Para testar billing localmente, abra um terminal
paralelo com `vercel dev` na porta 3000 e ajuste a base URL do fetch.

## Próximo passo — mudar o deploy

Quando o build estiver consolidado, atualize `vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/", "destination": "/landing.html" },
    { "source": "/app", "destination": "/Appliquei_v13.0.html" },
    { "source": "/app/(.*)", "destination": "/Appliquei_v13.0.html" }
  ],
  "functions": { "api/**/*.js": { "memory": 256, "maxDuration": 15 } },
  "crons": [{ "path": "/api/market?op=warmup", "schedule": "0 22 * * 1-5" }],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "no-store" }]
    }
  ]
}
```

Faça isso em PR separada com rollback fácil (Vercel mantém histórico de
deploys). Validações antes do merge:

1. `npm run build && npm run preview` localmente — clicar pelo app
   (login, dashboard, billing) e confirmar zero regressão visual/funcional.
2. Deploy preview no Vercel (PR gera preview automático) — repetir
   smoke test no preview URL.
3. Verificar que `/api/*` ainda responde (Vercel detecta `api/` em paralelo
   ao `outputDirectory`).

## Avisos esperados no build

Vite avisa para cada `<script src>` sem `type="module"`:

```
<script src="web/appliquei-billing.js"> can't be bundled without type="module"
```

**Esperado**. São scripts legados que o plugin `copyWebDir` move para
`dist/web/` sem transformação. Conforme cada um for migrado para ES
module (Onda 3), o aviso some.

## Roteiro Onda 3 (incremental, sem big-bang)

A partir daqui, atacar **um script por vez**:

1. Pegar o menor — `web/appliquei-firebase-init.js` (43 linhas). ✅ feito
2. Converter para ES module (`export function init() { ... }`).
3. Trocar `<script src="web/appliquei-firebase-init.js">` por
   `<script type="module" src="/web/appliquei-firebase-init.js">`.
4. `npm run build` — Vite agora bundla e aplica hash.
5. Smoke test no preview, merge.
6. Próximo script.

Quando todos os `web/*.js` forem módulos, o plugin `copyWebDir` pode ser
removido. Quando o JS inline nos HTMLs também for extraído para
módulos, os HTMLs ficam pequenos e a Onda 3 está completa.

## Padrão estabelecido na primeira conversão

`web/appliquei-firebase-init.js` virou ES module com:

- **Exports nomeados**: `initFirebase()`, `getFirebase()` em vez do IIFE.
- **Side effect no import**: `if (typeof window !== 'undefined') initFirebase();`
  preserva o contrato do IIFE original — código existente que lê
  `window.AppliqueiFirebase` segue funcionando.
- **Idempotência explícita**: `firebase.apps.length` impede dupla
  inicialização quando inline + módulo rodam juntos.
- **HTML mantém o bloco inline** como defesa em profundidade. Adicionado
  `<script type="module" src="/web/appliquei-firebase-init.js">` logo
  depois. Ordem: inline (sync, durante parse) → módulo (deferred). Ambos
  no-op idempotente.
- **Vite output**: módulo vira `dist/assets/Appliquei_v13.0-<hash>.js`
  (~2 KB minificado). HTML reescrito automaticamente para o path hasheado.

**Replicação para os próximos scripts** (`web/appliquei-cloud-sync.js`,
`web/appliquei-billing.js`):

1. Identificar exports lógicos (funções que outros scripts consomem via
   globals — converter cada um em `export function`).
2. Manter atribuição a `window.*` no final do módulo durante a transição.
3. Adicionar `<script type="module" src="/web/X.js">` no HTML; remover o
   `<script src="web/X.js?v=...">` antigo **só depois** do preview validar.
4. Ajustar imports cruzados entre módulos da pasta `web/` quando aplicável.

Quando todos os arquivos de `web/` forem ES modules carregados via
`<script type="module">`, o plugin `copyWebDir()` em `vite.config.js`
pode ser removido — Vite bundla tudo nativamente.
