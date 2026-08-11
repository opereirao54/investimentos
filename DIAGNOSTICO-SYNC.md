# Diagnóstico — "cadastrei no celular e não gravou no banco"

**Status:** causa raiz confirmada com evidência e corrigida. 11/08/2026.

Este documento existe porque o bug sobreviveu a **quatro** correções que se
declararam "causa raiz". Se você é a próxima pessoa (ou o próximo agente) a
mexer em sync, leia a seção _"Por que as quatro tentativas anteriores
falharam"_ antes de escrever qualquer linha.

---

## Sintoma

Lançamento cadastrado pelo celular não aparecia no PC. O app exibia
"Salvo às HH:MM" normalmente. Nenhum erro no console, nenhum erro de rede,
resposta HTTP 200 do servidor. Escrita pelo PC funcionava.

## Cadeia mapeada

```
setItem (utils.js:341, interceptado)
  └─ onLocalWrite  →  marca rev + agenda push
       ├─ SDK Firestore   set(merge)  debounce 2s   ← sem teto de tamanho
       └─ beacon HTTP  /api/sync/push  debounce 300ms ← TETO DE 200KB NO SERVIDOR
                                                         (o elo partido)
```

Os dois caminhos existem porque o iOS congela o tab antes de o SDK transmitir.
No PC o tab fica vivo e o SDK completa; no celular só o beacon sobrevive.

## Evidência que fechou o caso

Teste divisor (cadastro com descrição única, busca por conteúdo no Firestore,
sem filtro): **o registro não estava no banco** → falha de escrita, não de
leitura. Isso eliminou de saída identidade de usuário, timezone e cache de
leitura como suspeitos.

Medição do `localStorage` no dispositivo:

| chave                   | tamanho                                  |
| ----------------------- | ---------------------------------------- |
| `futurorico_transacoes` | **354,3 KB**                             |
| todas as outras (28)    | 5,5 KB                                   |
| **documento inteiro**   | **359,8 KB** (limite Firestore: 1024 KB) |

`futurorico_transacoes` guarda **todas** as transações num único JSON — ~1.200
registros, 18 séries recorrentes de 60 parcelas cada. Sozinho é 98% do
documento.

## Causa raiz

`api/sync/push.js` aplicava `MAX_VALUE_BYTES = 200 * 1024` com um `return`
dentro do `forEach`:

```js
if (!isDelete && Buffer.byteLength(v, 'utf8') > MAX_VALUE_BYTES) return;
```

Consequência: a chave era **descartada em silêncio**. Não entrava em
`updateFields`, não incrementava `accepted`, não gerava erro, e o endpoint
respondia **HTTP 200**. O cliente lia sucesso e escrevia "Salvo às HH:MM"
para um write que nunca existiu.

Com 354 KB contra um teto de 200 KB, **todo** push do celular era descartado.
O teto está no repositório desde 26/05 — antes das quatro tentativas de
correção.

## Por que as quatro tentativas anteriores falharam

Todas mexeram **só no cliente**. Nenhuma tocou `api/sync/push.js`:

| commit    | diagnóstico declarado         | arquivos tocados              |
| --------- | ----------------------------- | ----------------------------- |
| `d6c6af0` | write durante o pull inicial  | `web/appliquei-cloud-sync.js` |
| `c40fa7b` | clock skew / rev Lamport      | `web/appliquei-cloud-sync.js` |
| `f9f2d83` | log de `accepted:0`           | `web/appliquei-cloud-sync.js` |
| `cbb3b86` | limite de 64KB do `keepalive` | `web/appliquei-cloud-sync.js` |

A `cbb3b86` chegou pertíssimo: corrigiu o teto de 64 KB do `keepalive` no
cliente e o comentário dela até registra que "futurorico_transacoes passa disso
facilmente". Corrigiu o teto do cliente e parou — o teto do servidor seguiu
intacto.

Duas coisas mantiveram o erro escondido, e as duas foram corrigidas:

1. **O servidor mentia sucesso.** Rejeição silenciosa + HTTP 200.
2. **O cliente atribuía uma causa errada.** No `accepted === 0` o log dizia
   `"write descartado pelo LWW (conflito de rev)"` — um palpite, não uma
   leitura. Quem investigou depois leu isso como fato e foi caçar LWW e clock
   skew, que estavam funcionando.

## O que foi corrigido

**`api/sync/push.js`**

- `MAX_VALUE_BYTES` 200KB → 800KB, compatível com o limite real do Firestore.
- Novo `MAX_DOC_BYTES` (900KB): recusa explícita antes de estourar o 1 MiB do
  Firestore, que hoje ninguém checava e viraria exceção opaca.
- **Toda** recusa volta em `rejected[]` com `key`, `reason` e `bytes`.
  Motivos: `too_large`, `doc_full`, `not_syncable`, `bad_rev`, `bad_value`,
  `too_many_keys`.
- Rev antigo conta em `stale` separado — é o LWW funcionando, não falha.

**`web/appliquei-cloud-sync.js`**

- `rejected[]` não vazio → `console.error` + `reportSyncFailure()`, que troca
  o rótulo para **"Não sincronizado"** em vermelho e expõe
  `AppliqueiCloudSync.lastError`. O app não pode mais dizer "Salvo" para um
  write perdido.
- Removida a atribuição de causa no `accepted:0`; agora reporta
  "causa desconhecida" em vez de acusar o LWW.

**`test/sync-push-limits.test.js`** — 5 testes. Verificado que falham com o
teto antigo de 200KB e passam com a correção.

## Dívida conhecida (NÃO corrigido aqui)

1. **`futurorico_transacoes` como chave única de 354 KB é o problema
   estrutural.** A correção comprou espaço, não resolveu o desenho. A 800 KB o
   teto volta a bater; particionar por ano/competência é o conserto de verdade.
   O documento está em 360 KB de 1024 KB — a margem é finita e só encolhe.

2. **Cache-busting manual quebrado.** Os scripts clássicos usam `?v=fase2` fixo
   no HTML. **11 dos 20 tokens estão desatualizados** em relação à data de
   alteração do arquivo — o pior é `appliquei-utils.js?v=fase2` (token de
   28/05, arquivo alterado em 29/06). Navegador que cacheou a versão antiga
   continua servindo ela. Verificado que **não** causou este bug (o
   `appliquei-cloud-sync.js` é ES module e o Vite já aplica hash de conteúdo
   nele), mas é defeito real e atrapalha qualquer diagnóstico futuro, porque
   nunca se sabe qual versão o dispositivo está rodando. A correção é gerar o
   `?v=` por hash de conteúdo no build.

3. **Transporte do beacon com payload grande no unload não foi validado em
   campo.** Com 354 KB, `useKeepalive` é `false` e o fallback `sendBeacon` é
   pulado — no `pagehide` a entrega depende de um `fetch` sem `keepalive`, que
   o browser pode cancelar. Só o beacon _eager_ (página ativa, linha 515)
   carrega esse tamanho com segurança. Se depois desta correção ainda houver
   perda no celular, **é aqui que se olha primeiro** — e agora ela aparece como
   "Não sincronizado" em vez de sumir calada.

## Como verificar no dispositivo

No console, com o app aberto:

```js
// tamanho por chave e total do documento
(() => {
  const enc = new TextEncoder(),
    all = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!/^(futurorico_|appliquei_)/.test(k)) continue;
    all.push({ chave: k, KB: +(enc.encode(localStorage.getItem(k)).length / 1024).toFixed(1) });
  }
  all.sort((a, b) => b.KB - a.KB);
  console.table(all);
  console.log('TOTAL:', all.reduce((s, x) => s + x.KB, 0).toFixed(1), 'KB de 1024 KB');
})();

// última falha de sync reportada pelo servidor
AppliqueiCloudSync.lastError;
```

Teste divisor, quando o sintoma voltar: cadastre um registro com descrição
única, procure **por conteúdo** no Firestore (sem filtro de data ou usuário).
Achou → problema de leitura. Não achou → problema de escrita. Esse corte vale
mais que qualquer leitura de código.
