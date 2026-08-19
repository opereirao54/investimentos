# Diagnóstico — "cadastrei no celular e não apareceu no PC"

**Status:** causa raiz confirmada por medição no aparelho e corrigida.

Este documento existe porque o bug sobreviveu a **cinco** correções que se
declararam "causa raiz" — quatro anteriores e uma minha. Se você vai mexer em
sync, leia _"Por que tantas tentativas falharam"_ antes de escrever código.

---

## Sintoma

Lançamento cadastrado no iPhone não aparecia no PC. O app exibia "Salvo às
HH:MM", o dado aparecia na lista e **persistia entre sessões no próprio
celular**. Nenhum erro em lugar nenhum. Escrita pelo PC funcionava.

## Causa raiz

`appliquei-utils.js` instalava o gatilho do sync assim:

```js
localStorage.setItem = function (key, value) {
  /* ... */ AppliqueiCloudSync.onLocalWrite(key);
};
```

`Storage` é um _legacy platform object_ com setter de propriedade nomeada. Em
navegadores que seguem o WebIDL à risca (**Safari/iOS**), atribuir uma
propriedade que não é _own property_ vai para o setter nomeado: grava um **item
chamado `"setItem"`** e **não sombreia** o método do protótipo. Em Chrome
sombreia e tudo funciona — foi isso que escondeu o defeito.

No iPhone, portanto:

- o app salvava direto no método nativo → **dado aparecia e persistia** ✓
- o interceptador ficava instalado num lugar por onde nada passava
- `onLocalWrite` **nunca** era chamado
- nenhuma chave era marcada como suja
- **nenhum push jamais era disparado**

Não havia o que sincronizar. Nunca houve.

### A evidência

Sonda no aparelho, mesmo salvamento, três linhas consecutivas:

```
ENTRA executarInsercao
GRAVA futurorico_transacoes 354KB via prototipo
TOAST "Lançamento salvo com sucesso!"
```

`via prototipo` = a atribuição na instância não sombreou nada. E logo depois,
nenhum aviso ao sync. Duas confirmações independentes na mesma coleta.

## Correção

Patch em `Storage.prototype.setItem` / `removeItem`, que funciona nos dois
casos, com guard `this !== localStorage` porque `sessionStorage` compartilha o
mesmo protótipo. **O que o interceptador notifica não mudou — mudou apenas onde
ele é instalado.**

`test/storage-interceptor.test.js` simula a semântica do Safari com um `Proxy`
cujo `[[Set]]` grava item em vez de sombrear. Verificado: 3 dos 6 testes falham
com o código antigo, incluindo o que detecta o item lixo `"setItem"`.

## Por que tantas tentativas falharam

| commit    | causa declarada              | onde mexeu                    |
| --------- | ---------------------------- | ----------------------------- |
| `d6c6af0` | write durante o pull inicial | `web/appliquei-cloud-sync.js` |
| `c40fa7b` | clock skew / rev Lamport     | `web/appliquei-cloud-sync.js` |
| `f9f2d83` | log de `accepted:0`          | `web/appliquei-cloud-sync.js` |
| `cbb3b86` | limite de 64KB do keepalive  | `web/appliquei-cloud-sync.js` |
| (esta)    | teto de 200KB no servidor    | `api/sync/push.js`            |

Todas consertaram elos **depois** de um gatilho que nunca disparava. Enquanto
`onLocalWrite` não é chamado, nada no cloud-sync importa.

Três vícios sustentaram o erro, e os três foram corrigidos:

1. **Falha silenciosa em cadeia.** O interceptador não avisava que não estava
   instalado; o servidor descartava chaves grandes respondendo HTTP 200; o
   cliente exibia "Salvo" de qualquer jeito.
2. **Palpite escrito como fato.** O log dizia `"descartado pelo LWW (conflito
de rev)"` sem ter lido rev nenhum. Quem investigou depois tomou como
   verdade e foi caçar clock skew, que estava correto.
3. **Diagnóstico por leitura de código.** Nenhuma das tentativas mediu o
   aparelho. O defeito era invisível no código — só aparece em runtime, e só
   no Safari.

## Outros defeitos reais encontrados no caminho

Todos corrigidos, nenhum era a causa raiz:

- **Teto de 200KB no servidor** (`api/sync/push.js`), aplicado com `return`
  dentro de um `forEach`: descartava `futurorico_transacoes` (354KB) em
  silêncio e respondia 200. Teria bloqueado o sync mesmo depois da correção do
  gatilho. Hoje 800KB, com `MAX_DOC_BYTES` de 900KB e `rejected[]` nomeando
  toda recusa.
- **`stale` sem detalhe.** `accepted:0, stale:1` não dizia por quê. Hoje vem
  `staleKeys[{key, sentRev, serverRev, kind}]`.
- **Duplicata lida como perda.** `onLocalWrite` dispara SDK e beacon com o
  mesmo rev; o segundo a chegar encontra `curRev === rev`. Eu tratei isso como
  falha e quase pus "Não sincronizado" na tela no momento em que o dado era
  salvo. Hoje `kind: 'duplicate'` vs `'superseded'`.

## Dívida conhecida

1. **`futurorico_transacoes` como chave única de 354 KB.** ~1.200 registros num
   JSON só, 98% do documento (360KB de 1024KB no Firestore). Cada salvamento
   reenvia tudo: 3,3 s de upload medidos no celular. Particionar por ano é o
   próximo passo.
2. **Cache-busting manual quebrado.** 11 de 20 tokens `?v=` desatualizados em
   relação à data do arquivo — o pior é `appliquei-utils.js?v=fase2` (token de
   28/05, arquivo alterado em 29/06). Não causou este bug, mas impede saber
   qual versão um aparelho está rodando, o que atrapalha qualquer diagnóstico.
3. **Painel de debug** (`web/appliquei-debug-sync.js`), ligado com `?debug=1`.
   Vale manter enquanto a dívida 1 não for paga.

## Método que funcionou

O que destravou não foi ler código — foi medir o aparelho:

1. **Teste divisor.** Cadastre um registro com descrição única e procure **por
   conteúdo** no banco, sem filtro. Achou → problema de leitura. Não achou →
   de escrita. Corta o espaço de busca ao meio antes de qualquer teoria.
2. **Separar os elos.** `GRAVA` → `AVISA` → `PUSH→` → resposta. "Não
   sincronizou" cobre quatro bugs distintos; só instrumentando cada ponto dá
   para saber qual.
3. **Aferir o instrumento.** Duas vezes a sonda é que estava errada — uma vez
   cega (mesma atribuição defeituosa do `utils.js`), outra pesada demais
   (serializava o log inteiro a cada linha e derrubava o app que observava).
   Sem aferição, teria virado mais uma causa raiz falsa.
