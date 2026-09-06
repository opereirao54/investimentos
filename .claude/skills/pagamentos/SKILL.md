---
name: pagamentos
description: Especialista em integração e processos de pagamento da Appliquei — assinatura Asaas, cobrança avulsa, trial, cupom Applicash, webhooks e o gate de acesso. Use SEMPRE que mexer em api/billing/*, api/_lib/{access,credits,billing-sync,reconcile}.js ou na tela de assinatura/Applicash; e sempre que o sintoma envolver dinheiro do assinante — "paguei e continuo bloqueado", "antecipei o pagamento e perdi dias", "fui cobrado duas vezes", "o cupom não entrou", "o indicador não recebeu o cashback", "a fatura veio cheia mesmo com crédito", "cancelei e perdi o mês que paguei", "o desconto sumiu do saldo". Use também antes de dar por pronta qualquer alteração em preço, ciclo, desconto, estorno ou renovação, e quando o pedido for avaliar se o fluxo de pagamento está claro para o usuário.
---

# Pagamentos da Appliquei

Aqui não se testa "a função devolve o valor certo". Testa-se **"o usuário foi
cobrado o valor certo, no dia certo, e recebeu exatamente o acesso que
comprou"** — que é uma pergunta sobre o sistema inteiro, ao longo do tempo,
com um gateway externo no meio.

Conduza o trabalho em português brasileiro.

---

## A regra que governa tudo: ninguém perde tempo que já é seu

Todo defeito grave já encontrado neste código foi a mesma regra errada,
escrita em lugares diferentes: **tratar um pagamento como "reinicia a
contagem agora" em vez de "soma um ciclo ao que resta"**.

| Situação                         | O que fazia                 | O que tem de fazer        |
| -------------------------------- | --------------------------- | ------------------------- |
| Renova o avulso no dia 20 de 30  | acesso até o dia 50         | até o dia 60 — soma       |
| Assina no dia 3 de um trial de 7 | cobrava no dia 4            | cobra no fim do trial     |
| Paga boleto no dia do vencimento | `OVERDUE` bloqueava na hora | a janela já paga protege  |
| Cancela no dia 2 do mês pago     | —                           | mantém até o fim do ciclo |

O campo canônico é `billing.paidUntil`, calculado por
`nextPaidUntilMs()` em `api/_lib/access.js`: base = **o maior** entre agora,
a janela já paga e o fim do trial; depois soma o ciclo. Ele **nunca anda para
trás** — é o invariante PAG01.

Contas antigas não têm `paidUntil`. `paidUntilMs()` cai em `lastPaidAt + 30d`
para elas. **Não remova esse fallback**: sem ele, todo assinante anterior ao
campo é bloqueado no deploy.

---

## As peças

| Peça             | Onde                                    | Papel                                 |
| ---------------- | --------------------------------------- | ------------------------------------- |
| Simulador        | `test/_simulador-pagamentos.js`         | Mundo fiel ao Asaas + `verificar()`   |
| Ciclo            | `test/pagamentos-ciclo.test.js`         | Antecipação, trial, carência, estorno |
| Applicash        | `test/pagamentos-applicash.test.js`     | As duas pontas do cupom               |
| Mock do gateway  | `scripts/lib/mock-billing.js`           | Firestore + Asaas em memória          |
| Contabilidade    | `test/billing-credit-invariant.test.js` | Saldo × soma dos créditos             |
| Rede de proteção | `api/_lib/reconcile.js`                 | Varredura que corrige divergência     |

---

## O mock mente por omissão — ligue a fidelidade

Esta é a lição mais cara deste repositório. Durante meses os testes de billing
passaram contra um Asaas que não existe, e **cada mentira do mock escondeu um
defeito inteiro em produção**:

| Mentira do mock              | Realidade do Asaas                  | O que escondia                                         |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------ |
| assinatura gera **1** fatura | projeta **6-12** de uma vez         | o crédito do indicador nunca chegava a fatura nenhuma  |
| `updatePayment` aceita tudo  | recusa alterar cobrança **já paga** | avulso no cartão cobrava cheio com crédito parado      |
| cartão não captura           | captura **no ato** do POST          | descontar depois é sempre tarde                        |
| um evento por pagamento      | `CONFIRMED` **e** `RECEIVED`        | tudo que soma precisa ser idempotente por `payment.id` |

Os knobs vivem em `asaasState` e o simulador liga os três por omissão:

```js
asaasState.projectFutureInvoices = 6; // faturas projetadas
asaasState.cardCapturesImmediately = true; // cartão captura na hora
asaasState.strictUpdatePayment = true; // Asaas recusa o que recusaria
```

**Um teste de pagamento com os knobs desligados está a testar um gateway
imaginário.** Desligar algum é uma decisão consciente, com comentário.

---

## O protocolo

### 1. Monte o mundo e dirija a ação de verdade

```js
const S = require('./_simulador-pagamentos.js');

const m = S.criarMundoPagamentos();
await S.criarConta(m, 'ana');
const r = await S.assinar(m, 'ana', { modo: 'avulso' });
await S.pagar('ana', r.body.paymentId);

S.avancarDias(20);
// ...
assert.equal(S.problemas(m), ''); // valida o sistema INTEIRO
```

`criarMundoPagamentos` também **assume o relógio** (`Date.now` passa a ler
`store.now`). Sem isso o mundo tem dois tempos — os handlers no relógio real e
o Firestore mockado em `store.now` — e todo teste de vencimento mede a
diferença entre eles em vez do que queria medir.

### 2. Exercite a matriz inteira, não o caminho feliz

Para cada alteração, percorra:

| Eixo      | Valores                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| Modo      | assinatura recorrente · avulso (30 dias)                                           |
| Método    | cartão (captura na hora) · PIX/boleto (compensa em dias)                           |
| Momento   | dentro do trial · no fim do trial · no meio do ciclo · vencido · depois de expirar |
| Cupom     | sem · indicado · indicador · os dois · vínculo derrubado pelo antifraude           |
| Fim       | paga · atrasa · estorna · chargeback · cancela · reativa                           |
| Repetição | evento duplicado · fora de ordem · dois cliques · dois indicados no mesmo instante |

O cruzamento que quase ninguém testa e onde os defeitos moram:
**avulso + cartão + cupom + antecipação**.

### 3. Leia os invariantes que `verificar()` valida

Cada um é um erro que já aconteceu neste código, não uma hipótese.

| Sinal      | O que significa                                                           |
| ---------- | ------------------------------------------------------------------------- |
| `PAG01`    | `paidUntil` andou para trás — alguém perdeu dias comprados                |
| `PAG02`    | cobrança vencendo antes do fim do trial — cobrou por dia que já era dele  |
| `PAG03/04` | o saldo Applicash desgarrou da soma dos documentos de crédito             |
| `PAG05`    | crédito marcado como gasto sem ter abatido fatura nenhuma                 |
| `PAG06`    | cobrança negativa, acima do preço de tabela, ou abaixo do piso do gateway |
| `PAG07`    | assinatura recorrente e avulso vivos ao mesmo tempo — cobrança dupla      |
| `PAG08`    | acesso liberado sem janela paga nem assinatura por trás                   |
| `PAG09`    | o indicado pagou e o indicador não recebeu nada                           |

`PAG03` é o mais traiçoeiro. O saldo é derivado dos **documentos** de crédito
(`computeCreditTotals`), mas `stats.*` são contadores acumulados por seis
caminhos. Um `increment` perdido desgarra o saldo para sempre — e a
reconciliação depois "corrige" o contador para o valor errado, cimentando a
perda. Foi exatamente assim que os R$ 0,80 de um crédito parcialmente
consumido evaporavam.

---

## Applicash: são DUAS promessas, verifique as duas

```
INDICADO    entra com cupom → paga 10% menos, sempre.
            Aplicado em /subscribe, sobre o valor da assinatura.

INDICADOR   ganha 10% de cada pagamento do indicado, abatido na fatura dele.
            Nasce em creditIndicatorFromIndicado (webhook PAYMENT_CONFIRMED).
```

A ponta do indicado sempre funcionou. **A do indicador é a que quebra**, e
sempre pelo mesmo motivo: o desconto precisa encontrar uma cobrança onde
pousar, e a cobrança certa nem sempre existe no momento certo.

Os três caminhos por onde o crédito chega hoje — se mexer em um, teste os três:

1. `pushCreditToOpenInvoice` — assim que o crédito nasce, procura a fatura
   aberta do indicador e abate nela. É o caminho principal, porque as faturas
   futuras já foram criadas pelo Asaas antes de o crédito existir.
2. `applyPendingCreditsTo` no evento `PAYMENT_CREATED` — para quem ainda não
   tinha fatura aberta.
3. `reservePendingCredits` em `/subscribe` (avulso) — abate **antes** de criar
   a cobrança, porque o cartão captura no ato e depois já é tarde.

Regras que não podem cair:

- **Reserva é transacional.** Dois indicados a pagar no mesmo instante liam o
  mesmo saldo e cada um abatia na sua fatura — o crédito gastava-se duas vezes.
- **Crédito consumido em parte parte-se em dois.** A fatia gasta fica no
  documento; o resto vira crédito novo, pendente. Marcar o documento inteiro
  como gasto tendo abatido metade faz a diferença evaporar.
- **Rollback devolve tudo.** Se o Asaas recusar, `releaseReservation` repõe o
  valor cheio e apaga a sobra criada pela partição.
- **Estorno do indicado anula o crédito do indicador** — o dinheiro voltou.

### O teto que a tela não conta

`APPLICASH_METAS` promete _"12 indicações → 100% de desconto · Assinatura
ZERADA · Appliquei grátis para sempre"_. **O motor não entrega isso.**
`MIN_PAYMENT_CENTS` (R$ 5,00 por omissão) é o piso do gateway: a fatura desce
até R$ 5,00 e para. Com 12 indicados o usuário acumula R$ 16,20/mês de crédito,
paga R$ 5,00 e vê o excedente empilhar sem nunca zerar.

`test/pagamentos-applicash.test.js` fixa esse teto numa trava de coerência.
Para cumprir a promessa é preciso uma **decisão de produto**, não um patch:
baixar o piso, ou pular a cobrança e estender `paidUntil` quando o crédito
cobre o mês inteiro. Enquanto nenhuma das duas acontecer, a copy promete mais
do que o código dá.

---

## O gate de acesso: uma fonte de verdade só

`computeAccess()` em `api/_lib/access.js` decide tudo. A tela **nunca**
recalcula a mesma conta por fora — quando recalculava (`lastPaidAt + 30` no
cliente), prometia uma data diferente da que o gate honrava, e quem tinha
antecipado um pagamento via menos dias do que comprou.

- servidor: `computeAccess()` e `paidUntilMs()`
- API: `/api/billing/me` devolve `access`, `accessExpiresAt`, `accessExpiresInDays`
- tela: **consome** esses campos, não os deriva

A ordem das regras importa e é deliberada:

1. estorno/chargeback bloqueiam **mesmo dentro da janela paga** — o dinheiro voltou
2. `OVERDUE` **não** bloqueia dentro da janela paga — a fatura vencida é a _seguinte_
3. assinatura `ACTIVE` + pagamento confirmado → ativo
4. trial vivo → `trial` (antes do ciclo pago, para a tela mostrar a avaliação)
5. janela paga viva → `active` por `paid_period`

---

## Avaliar se está intuitivo

Não é opinião: são perguntas com resposta verificável na tela.

| Pergunta do usuário                            | Onde ele tem de encontrar a resposta          |
| ---------------------------------------------- | --------------------------------------------- |
| "Até quando meu acesso vale?"                  | data explícita, não "30 dias"                 |
| "Se eu pagar antes, perco os dias que sobram?" | dito **antes** de ele pagar, no card do modo  |
| "Quanto vou pagar no mês que vem?"             | valor já com o desconto Applicash aplicado    |
| "Por que a fatura veio R$ 13,50?"              | a origem do desconto, nomeada                 |
| "Meu amigo assinou — cadê meu cashback?"       | crédito visível com a fatura onde abateu      |
| "Cancelei. Perco o mês que paguei?"            | "acesso garantido até DD/MM"                  |
| "Paguei o boleto, por que estou bloqueado?"    | prazo de compensação dito no ato do pagamento |

Duas regras de copy que valem por qualquer redesign:

- **Nunca prometa o que o motor não entrega** (ver o teto do Applicash).
- **Números que a tela mostra vêm do servidor.** Quando a tela calcula
  `valorPago × 10%` por conta própria e o servidor tem
  `pendingDiscountCents`, existem dois saldos e eles vão discordar.

---

## Antes de dar por pronto

```bash
node --test test/pagamentos-*.test.js       # ciclo + applicash
node --test test/billing-credit-invariant.test.js test/access.test.js
npm test                                     # nada mais pode quebrar
npm run lint
```

E confira à mão, no diff:

- [ ] toda soma disparada por webhook é idempotente por `payment.id`
- [ ] toda chamada ao Asaas que pode falhar tem compensação (rollback)
- [ ] nenhum caminho novo reinicia `paidUntil` em vez de somar
- [ ] a tela consome `accessExpiresAt` do servidor em vez de recalcular
- [ ] os knobs de fidelidade do mock ficaram ligados nos testes novos
