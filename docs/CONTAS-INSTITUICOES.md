# Contas / Instituições financeiras — design e plano de migração

> Status: **Fase 1 (fundação) em andamento.** Este documento descreve o
> modelo da entidade `Conta`, como ela se encaixa na arquitetura atual e o
> roteiro em fases para que **toda entrada e saída de dinheiro passe por uma
> instituição financeira**.

## 1. Problema (resumo do diagnóstico)

Hoje o app **não tem uma entidade "Conta/Instituição"**. Instituição é
representada por dois campos de **texto livre**, reconciliados por nome na hora
de renderizar o "Por instituição" (Meu Patrimônio):

- `corretora` — onde o ativo fica guardado (em cada `historicoCompras[]`).
  Obrigatório na compra/venda (`web/appliquei-renda-fixa.js:178-182`).
- `banco` — de onde o caixa sai / para onde entra (em cada `transacoes[]`).
  Obrigatório **só em algumas categorias** (`controleBancoObrigatorio`,
  `web/appliquei-aba-controle-financeiro.js:79-86`).

A obrigatoriedade vive **só no formulário manual**, então tudo que é criado por
código (aporte de investimento, resgate/venda, previdência, sonho,
transferência) **escapa** e cai num balde **"Sem banco" / "Sem corretora"** —
reconhecido no próprio código (`web/appliquei-patrimonio.js:313` e `:435`).

### Vazamentos conhecidos (onde o dinheiro NÃO passa por instituição)

| Movimento                                | Direção | Evidência                                                                      | Cai em    |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------ | --------- |
| Aporte de investimento (origem do caixa) | saída   | `renda-fixa.js:232` (tx sem `banco`); origem opcional default `externo` `:310` | Sem banco |
| Venda / Resgate de ativo                 | entrada | `renda-fixa.js:260` (tx sem `banco`)                                           | Sem banco |
| Pagamento de fatura do cartão            | saída   | `controle-financeiro.js:1115-1124` (só marca `pago`); cartão sem instituição   | Sem banco |
| Previdência recorrente                   | saída   | `previdencia.js:77, 158` (sem `banco`)                                         | Sem banco |
| Sonhos (aporte / "sem lançar")           | saída   | `sonhos.js` (sem `banco`)                                                      | Sem banco |
| Dividendos / Proventos                   | entrada | `aba-dividendos.js` (nunca vira caixa)                                         | Invisível |
| Transferência entre contas               | —       | não existe como ação; `transferencia_entrada` definida mas nunca criada        | —         |

Consequências: "Por instituição" não fecha com a realidade; não há **saldo de
abertura** de conta-corrente; e há **provável duplo-débito** quando a origem do
recurso é declarada (a tx `investimento_*` e a `transferencia_saida` abatem o
caixa pelo mesmo valor — `patrimonio.js:282-316`).

## 2. Decisão

Criar a entidade **Conta/Instituição** como cadastro-mestre, com identidade
estável (`contaId`), e migrar — em fases — os campos de texto livre
`banco`/`corretora` para referências a essa entidade. Isso elimina o balde "Sem
banco", habilita saldo de abertura por conta e torna o "Por instituição" uma
fonte de verdade.

## 3. Modelo de dados

### Entidade `Conta` — chave localStorage `appliquei_contas` (array)

```js
{
  id: 'conta_<ts>_<rand>',     // identidade estável (FK usada por contaId)
  nome: 'Itaú',                // grafia legível
  tipo: 'banco',               // 'banco' | 'corretora' | 'carteira' | 'outro'
  saldoInicial: 0,             // caixa de abertura (na dataSaldoInicial)
  dataSaldoInicial: null,      // 'YYYY-MM-DD' — quando esse saldo valia
  cor: null,                   // opcional, para gráficos
  arquivada: false,            // soft-delete (igual a cartões)
  criadaEm, atualizadaEm,      // ISO timestamps
}
```

> Futuro (não nesta fase): `instituicaoCodigo` (COMPE/ISPB) para um eventual
> Open Finance, e `contaPagadoraId` em cartões.

### Mudanças incrementais nos registros existentes (Fases 2+)

- **`transacoes[]`** ganha `contaId` (FK). `banco` (string) é mantido como
  fallback durante a transição.
- **`historicoCompras[]`** ganha `contaId` apontando para a conta-corretora.
  `corretora` (string) mantido na transição.
- **`cartoes[]`** ganha `contaPagadoraId` (qual conta paga a fatura).
- **Transferência** passa a ser um **par** de transações ligadas por
  `transferenciaId` (saída na conta origem + entrada na conta destino).

## 4. Como encaixa na arquitetura (pontos de integração verificados)

- **Sync automático**: o cloud-sync espelha qualquer chave `futurorico_*` /
  `appliquei_*` com LWW por-chave (`web/appliquei-cloud-sync.js:62-64`). A chave
  `appliquei_contas` entra no sync **sem trabalho extra**.
- **Estado global**: segue o molde de `transacoes`/`cartoes`
  (`web/appliquei-app.js:484-509`). Classic script exige `var` no topo
  (`test/classic-scripts-globals.test.js`).
- **Ordem de carga**: `appliquei-contas.js` carrega **logo após** `app.js`
  (`Appliquei_v13.0.html`, após a linha 7203), para o global `contas` e o seed
  existirem antes de patrimônio/controle/renda-fixa/sonhos rodarem.
- **Export/Import**: lista manual de chaves em `web/appliquei-utils.js` —
  `contas` foi incluído no backup e na importação.
- **ESLint + testes**: `appliquei-contas.js` foi adicionado à lista de
  classic-scripts (`eslint.config.js`) e às listas dos testes de smoke
  (`test/classic-scripts-load.test.js`, `test/classic-scripts-globals.test.js`).

## 5. Plano em fases

Cada fase é **independente e shippável**. Os campos string (`banco`/`corretora`)
permanecem como fallback até a Fase 5, então nada quebra entre as fases.

### Fase 0 — Design (este documento). ✅

### Fase 1 — Fundação (NÃO-QUEBRA). ✅

- `web/appliquei-contas.js`: modelo, CRUD (`criarConta`, `editarConta`,
  `arquivarConta`, `obterConta`, `obterContaPorNome`, `obterOuCriarContaPorNome`),
  normalização e **seed idempotente** que cria uma `Conta` para cada instituição
  já citada em `corretora`/`banco`.
- Global `contas` + chave `appliquei_contas` (auto-sincronizada).
- Export/import incluindo `contas`. Testes de unidade do módulo.
- **Inerte para os cálculos**: não carimba `contaId`, não toca `futurorico_*`,
  nenhum saldo muda. Ganho: o cadastro passa a existir e fica pronto p/ Fase 2.

### Fase 1b — UI "Minhas Contas". ✅

- Card "Minhas Contas" dentro de Meu Patrimônio: listar, criar, editar, arquivar;
  definir **saldo de abertura** (`saldoInicial` + `dataSaldoInicial`); **fundir
  duplicadas** (`fundirContas` re-aponta `contaId`, soma saldos iniciais e grava
  o nome absorvido como `alias`).

### Fase 2 — Caixa por conta (switch de leitura). ✅

- `patrimonio.js` agrupa por **conta resolvida** e soma o **saldo de abertura**
  (`saldoInicial`, respeitando `dataSaldoInicial`) no caixa.
- **Resolução em tempo de leitura** (`resolverContaDeTransacao` / `...Operacao`):
  prioriza `contaId`, cai para nome/alias do `banco`/`corretora`. Assim os
  registros antigos entram no agrupamento **sem reescrever `futurorico_*`** —
  evita a corrida de LWW com o cloud-sync (que poderia clobberar edição feita em
  outro dispositivo).
- `contaId` é carimbado apenas nas **escritas novas** do formulário (rev bump
  normal); digitar um nome novo cria a conta na hora (`obterOuCriarContaPorNome`).
- Datalist de instituição do formulário passa a sugerir as contas cadastradas.
- "Sem banco" deixou de ser silencioso: virou a linha **"A reconciliar"** no
  "Por instituição" (os vazamentos conhecidos agora aparecem explicitamente).
- Ganho: saldo por instituição correto, com saldo de abertura.

### Fase 3 — Fechar as saídas (em andamento)

- **Pagamento de fatura → conta pagadora do cartão.** ✅ `cartoes[].contaPagadoraId`
  (seletor **obrigatório** na config do cartão — `salvarNovoCartaoConfig` bloqueia
  o salvamento sem conta pagadora); a baixa (`confirmarBaixarGrupoCartao` /
  `confirmarPagamento`) carimba `contaId` nas parcelas pagas, debitando a conta
  certa em vez de cair em "A reconciliar".
- **Compra manual de ativo → conta-origem obrigatória.** ✅ O aporte gera uma
  perna `transferencia_saida` com `contaId` (decisão 3); a tx do ativo fica
  marcada `temLegCaixa` e sai do cálculo de caixa (sem duplo-débito). A perna é
  plumbing: aparece no "Por instituição" do Patrimônio, **não** no extrato/DRE
  (ocultada em `atualizarTelaControle` p/ não duplicar linha nem o KPI de aporte).
  Conta-origem guardada no template (`contaOrigemId`) p/ as recorrências.
- **Previdência recorrente → conta-origem.** ✅ As parcelas geradas
  (`gerarLancamentosFuturosCompromisso` e `processarAportesRecorrentesPrevidencia`)
  carimbam `contaId` do template (`contaOrigemId`). Recorrentes usam `contaId`
  direto no `investimento_*` (sem perna separada) — mesmo efeito de caixa, sem
  ciclo de pago duplicado.
- **Sonho → conta-origem.** ✅ Seletor de conta no modal do sonho
  (`contaOrigemId`); as transações `sonho` (mensal, recalculada e aporte extra)
  carimbam `contaId`. Sem conta escolhida, ficam em "A reconciliar".
- Ganho: **toda saída passa por conta.** ✅

### Fase 4 — Fechar as entradas. ✅

- **Venda/Resgate credita a conta-corretora.** ✅ A venda grava `banco`+`contaId`
  da corretora no `resgate_investimento` (o dinheiro cai lá). A migração de sonho
  credita a conta-origem do sonho (compensa o aporte → caixa neutro).
- **Dividendos automáticos.** ✅ `lancarDividendosNoCaixa()` cria uma entrada
  `dividendo` por (ticker, ano, mês) na corretora pagadora, idempotente via
  `divKey`. Categoria `dividendo` tratada como entrada em `mpEhEntradaCaixa`,
  somada à receita no `calcularResumoMes` e exibida na coluna de entradas.
- Ganho: **toda entrada passa por conta.** ✅

### Fase 5 — Transferência de 1ª classe. ✅

- Ação **"Transferir"** no card Minhas Contas: abre um modal (origem, destino,
  valor, data) e cria um **par balanceado** via `criarTransferencia` — uma
  `transferencia_saida` na origem + uma `transferencia_entrada` no destino,
  ligadas por `transferenciaId`. Ambas são plumbing de caixa (ocultas no
  extrato/DRE); o total de caixa fica neutro, só muda a divisão por instituição.

### Fase 7 — (depois) Deprecar campos texto legados

> Numeração linear (1–7): 1 Fundação · 2 Minhas Contas · 3 Caixa por conta ·
> 4 Fechar saídas · 5 Fechar entradas · 6 Transferências · 7 Deprecação. As
> Fases 1–6 estão concluídas; a 7 fica para depois.

- Aposentar `banco`/`corretora` como fonte de verdade (mantê-los só para ler
  backups antigos) e oferecer reconciliação assistida do bucket "A reconciliar".
  **Deixado para depois**, conforme combinado.

## 6. Decisões de produto (fechadas)

1. **Dividendos**: **lançamento automático** — assume recebimento na corretora
   pagadora (Fase 4).
2. **Cartão**: **conta pagadora obrigatória vinculada ao cartão**
   (`cartoes[].contaPagadoraId`); a baixa da fatura debita essa conta (Fase 3).
   O cadastro do cartão exige escolher a conta pagadora — sem ela, a foto do
   patrimônio em "Meu Patrimônio" ficaria furada (a baixa cairia em "A reconciliar").
3. **Duplo-débito do aporte**: o aporte vira **`transferencia_saida` com
   `contaId`** e deixa de abater o caixa como `investimento_*` (Fase 3).
4. **Fusão de contas**: **incluída na Fase 1b** (merge de duplicadas com soma de
   saldos iniciais e re-aponte de `contaId`).

## 7. Riscos e mitigação

- **Corrida seed × cloud-sync**: o classic script roda antes do pull do
  Firestore (localStorage pode estar vazio). Mitigado: o seed só "trava" a flag
  `appliquei_contas_seed_v1` quando havia dados; sem dados, re-roda no próximo
  boot. Não re-semeia depois de travado — respeita edições futuras.
- **Carimbar `contaId` em massa reescreveria as chaves grandes**
  (`futurorico_transacoes`, `futurorico_compras`) e poderia clobberar, via LWW,
  edições feitas em outro dispositivo entre o boot e o primeiro pull. **Resolvido
  na Fase 2 evitando o bulk rewrite**: a leitura resolve a conta por
  `contaId` → nome → alias, e `contaId` só é persistido em escritas novas.
- **Nomes divergentes** ("Itaú" vs "Itaú Unibanco") geram contas separadas —
  resolver com a feature de fusão (Fase 1b).
- **Classic script**: `var` no topo, function declarations globais; manter as
  listas de testes/eslint em sincronia ao adicionar arquivos.
