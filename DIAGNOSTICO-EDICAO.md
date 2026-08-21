# Diagnóstico — "editei a data da despesa e não corrigiu" — 2026-08-20

**Status:** quatro defeitos confirmados por reprodução em browser, corrigidos e
reprovados com os mesmos roteiros que falhavam.

Companheiro de `DIAGNOSTICO-SYNC.md`. Ali o dado não subia para a nuvem; aqui o
dado subia certo — só que **incompleto**, e a tela filtra justamente pelo campo
que a edição não atualizava.

---

## Sintoma relatado

1. "Fui editar uma despesa que tinha cadastrado com a data errada e ela não
   corrige."
2. "Se eu selecionar um cartão com vencimento 05/08 e mudar de cartão no meio do
   cadastro, ele não muda a data no campo."

## Cadeia de persistência (elo a elo)

```
formulário do painel  →  executarEdicao(modo)  →  mutação em `transacoes`
   →  localStorage.setItem('futurorico_transacoes')      (interceptador em
       appliquei-utils.js avisa o cloud-sync)
   →  Firestore
   →  leitura: calcularResumoMes / atualizarTelaControle FILTRAM POR t.mes e t.ano
```

O último elo é a chave do caso: **nada na tela olha `dataVencimento` para decidir
o mês**. Quem decide é a competência (`t.mes` / `t.ano`).

## Teste divisor (Etapa 1)

Criada a despesa `TESTE-DIAG-DATA` com vencimento em 2026-08-10, editada para
2026-06-10, e inspecionado o `futurorico_transacoes` direto no storage:

```
criada:  {"venc":"2026-08-10","mes":7,"ano":2026}
gravado: {"venc":"2026-06-10","mes":7,"ano":2026}   ← a data mudou, a competência não
esperado:                     mes:5, ano:2026
aparece no mês novo da tela? NÃO
```

**A escrita funciona.** O dado chega ao storage. O problema é que ele chega
_pela metade_ — os suspeitos S1–S9 do protocolo (cache, identidade, regra de
segurança, timezone) estão todos descartados por este resultado.

## Suspeitos verificados

| Suspeito                                              | Veredito   | Evidência                                                              |
| ----------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| Arquitetura sem banco compartilhado                   | DESCARTADO | Existe cloud-sync → Firestore; escrita confirmada no storage           |
| S1 versão velha em cache                              | DESCARTADO | Reproduzido em build limpo do `dist/`                                  |
| S3 erro silencioso engolido                           | DESCARTADO | Zero erros de página em todas as reproduções                           |
| S7 identidade / S8 timezone / S9 cache                | DESCARTADO | O registro está lá, sob a mesma chave; só com o campo errado           |
| **Competência não recalculada na edição**             | CONFIRMADO | Tabela acima                                                           |
| **Modo "todas" ignora a data**                        | CONFIRMADO | Série de 3 meses: valor propagou, `dataVencimento` não mudou em nenhum |
| **prepararEdicao sobrescreve data de cartão**         | CONFIRMADO | Guardado `2026-05-05`; ao abrir a edição o campo virou `2026-09-05`    |
| **Cartão sem `diaVencimento` mantém a data anterior** | CONFIRMADO | Troca A→"Cartão principal": campo ficou em `2026-09-20` (fatura do A)  |

## Causas raiz

1. **`executarEdicao` nunca atribuía `mes`/`ano`.** Na inserção a competência é
   derivada (do mês em visão, ou da fatura no caso de cartão); na edição ficava
   congelada. Corrigir a data gravava a data e deixava o lançamento no mês
   antigo — invisível onde o usuário foi procurá-lo.

2. **O branch `modo === 'todas'` não tocava em `dataVencimento`.** Numa conta
   fixa (que é o caso "uma conta", com `groupId`), a edição oferece
   "este mês / todos os meses"; escolhendo "todos", a data era descartada em
   silêncio. Só valor e descrição chegavam.

3. **`prepararEdicao` chamava `verificarRegraCartao()` depois de preencher o
   campo de data.** Para cartão, essa função chama `preencherVencimentoPorCartao()`,
   que calcula a fatura de **hoje** e sobrescreve o campo. Abrir uma despesa
   antiga só para ajustar a descrição já trocava a data dela.

4. **`preencherVencimentoPorCartao` saía calado quando o cartão não tem
   `diaVencimento`.** `cartaoCalcularVencimento` devolve `null` nesse caso e a
   função dava `return` — deixando no campo a data do **cartão anterior**. Como
   o campo fica `readOnly` para cartão, o usuário nem conseguia corrigir à mão.
   O `Cartão principal` que o app cria no primeiro boot nasce sem
   `diaVencimento`, então o caminho é comum.

## Correção aplicada

- `competenciaDaData(dataStr)`: helper único que traduz `yyyy-mm-dd` em
  `{mes, ano}`, devolvendo `null` para entrada inválida.
- Modo "este mês": recalcula `mes`/`ano` **apenas quando a data muda**. A
  condicional é essencial — competência e vencimento divergem de propósito
  (conta de agosto que vence em setembro), e recalcular sempre arrastaria esses
  lançamentos sozinho.
- Modo "todos os meses": propaga o **dia** do vencimento para a série, mantendo
  o mês de cada parcela e respeitando meses curtos (31 em fevereiro vira 28).
  Parcelas anteriores à editada continuam intactas.
- `prepararEdicao`: reaplica `trans.dataVencimento` **depois** de
  `verificarRegraCartao()`. Trocar de cartão a seguir recalcula normalmente.
- `preencherVencimentoPorCartao`: cartão sem dia de vencimento agora **esvazia e
  destrava** o campo e avisa por toast; cartão com vencimento volta a travar.

## Prova

Os mesmos roteiros que falhavam, re-executados em Chromium sobre o build de
produção:

```
editar a data:            venc=2026-06-10 mes=5 ano=2026  ✔  aparece no mês novo ✔
abrir despesa de cartão:  campo preservado em 2026-05-05  ✔  salvar não altera ✔
série "todos os meses":   2026-08-25 / 09-25 / 10-25      ✔  valor propagado ✔
cartão sem vencimento:    campo vazio e editável + aviso  ✔
troca entre cartões:      -05 → -20, sempre reescreve     ✔  (desktop e mobile)
```

13 testes de regressão em `test/edicao-lancamento.test.js`.

## Riscos residuais e pendências

- **`pago` não é reavaliado na edição.** Mover uma despesa variável já paga para
  uma data futura mantém `pago: true`, então ela segue debitada do caixa do Meu
  Patrimônio. Não foi alterado de propósito: `pago` mexe em saldo e pode ter
  sido marcado à mão pelo usuário — reavaliar sozinho é decisão de produto, não
  correção de bug.
- **`cartaoFixoMensal` não é atualizado na edição.** Alternar
  parcelado ↔ fixo numa despesa de cartão já existente não persiste.
- **Lançamentos gravados antes desta correção** continuam com a competência
  antiga. Editar a data de cada um agora os move para o lugar certo; não há
  migração automática.
