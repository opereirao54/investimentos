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

### Fase 1 — Fundação (NÃO-QUEBRA). ◐ em andamento

- `web/appliquei-contas.js`: modelo, CRUD (`criarConta`, `editarConta`,
  `arquivarConta`, `obterConta`, `obterContaPorNome`, `obterOuCriarContaPorNome`),
  normalização e **seed idempotente** que cria uma `Conta` para cada instituição
  já citada em `corretora`/`banco`.
- Global `contas` + chave `appliquei_contas` (auto-sincronizada).
- Export/import incluindo `contas`. Testes de unidade do módulo.
- **Inerte para os cálculos**: não carimba `contaId`, não toca `futurorico_*`,
  nenhum saldo muda. Ganho: o cadastro passa a existir e fica pronto p/ Fase 2.

### Fase 1b — UI "Minhas Contas"

- Tela de gestão: listar, criar, editar, arquivar contas; definir **saldo de
  abertura** (`saldoInicial` + `dataSaldoInicial`); opção de **fundir** contas
  duplicadas (ex.: "Itaú" vs "Itaú Unibanco").

### Fase 2 — Caixa por conta (switch de leitura)

- `patrimonio.js` passa a agrupar por `contaId` e a somar `saldoInicial`.
- Carimba `contaId` nas transações/operações por match de nome (migração
  coordenada com o short-circuit de boot do sync, `cloud-sync.js:251-274`).
- O campo de banco no formulário vira **seletor de conta** (+ "nova conta").
- "Sem banco" deixa de ser silencioso: vira lista **"A reconciliar"** acionável.
- Ganho: saldo por instituição correto, com saldo de abertura.

### Fase 1b — UI "Minhas Contas". ✅

- Card "Minhas Contas" dentro de Meu Patrimônio: listar, criar, editar, arquivar;
  definir **saldo de abertura** (`saldoInicial` + `dataSaldoInicial`); **fundir
  duplicadas** (`fundirContas` re-aponta `contaId` e soma saldos iniciais).
- Ainda registro-apenas: nenhum cálculo de saldo usa `contaId` (isso é a Fase 2).

### Fase 2 — Caixa por conta (switch de leitura)

- `patrimonio.js` passa a agrupar por `contaId` e a somar `saldoInicial`.
- Carimba `contaId` nas transações/operações por match de nome (migração
  coordenada com o short-circuit de boot do sync, `cloud-sync.js:251-274`).
- O campo de banco no formulário vira **seletor de conta** (+ "nova conta").
- "Sem banco" deixa de ser silencioso: vira lista **"A reconciliar"** acionável.
- Ganho: saldo por instituição correto, com saldo de abertura.

### Fase 3 — Fechar as saídas

- **Aporte de investimento exige conta-origem** e vira `transferencia_saida` com
  `contaId` — o aporte deixa de abater o caixa como `investimento_*` (decisão 3),
  acabando com o duplo-débito.
- **Pagamento de fatura** debita a **conta pagadora padrão do cartão**
  (`cartoes[].contaPagadoraId`, decisão 2).
- Previdência e sonho passam a gravar `contaId`.
- Ganho: toda **saída** passa por conta.

### Fase 4 — Fechar as entradas

- Venda/Resgate credita uma conta.
- **Dividendos são lançados automaticamente** como entrada de caixa na corretora
  pagadora (decisão 1).
- Ganho: toda **entrada** passa por conta.

### Fase 5 — Transferência de 1ª classe

- Ação "Transferência entre contas" (dupla-perna). Deprecação dos campos string
  `banco`/`corretora` (mantidos só para ler backups antigos).

## 6. Decisões de produto (fechadas)

1. **Dividendos**: **lançamento automático** — assume recebimento na corretora
   pagadora (Fase 4).
2. **Cartão**: **conta pagadora padrão vinculada ao cartão**
   (`cartoes[].contaPagadoraId`); a baixa da fatura debita essa conta (Fase 3).
3. **Duplo-débito do aporte**: o aporte vira **`transferencia_saida` com
   `contaId`** e deixa de abater o caixa como `investimento_*` (Fase 3).
4. **Fusão de contas**: **incluída na Fase 1b** (merge de duplicadas com soma de
   saldos iniciais e re-aponte de `contaId`).

## 7. Riscos e mitigação

- **Corrida seed × cloud-sync**: o classic script roda antes do pull do
  Firestore (localStorage pode estar vazio). Mitigado: o seed só "trava" a flag
  `appliquei_contas_seed_v1` quando havia dados; sem dados, re-roda no próximo
  boot. Não re-semeia depois de travado — respeita edições futuras.
- **Carimbar `contaId` reescreve as chaves grandes** (`futurorico_transacoes`,
  `futurorico_compras`). Fazer na Fase 2, dentro do short-circuit de boot do
  sync, de forma idempotente.
- **Nomes divergentes** ("Itaú" vs "Itaú Unibanco") geram contas separadas —
  resolver com a feature de fusão (Fase 1b).
- **Classic script**: `var` no topo, function declarations globais; manter as
  listas de testes/eslint em sincronia ao adicionar arquivos.
