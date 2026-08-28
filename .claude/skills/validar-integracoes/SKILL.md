---
name: validar-integracoes
description: Valida os contratos de integração entre as telas da Appliquei e propõe a correção quando uma alteração os coloca em risco. Use SEMPRE que mexer em qualquer arquivo de web/ que produza ou consuma transações, contas, sonhos, cartões, bens ou operações — e sempre que o usuário perguntar "isso vai quebrar alguma coisa?", "o que mais é afetado?", "isso mexe em outra tela?". Use também quando o sintoma relatado for de valor errado atravessando telas — "gastei e o saldo do banco não mudou", "paguei a fatura e o saldo não mexeu", "apaguei o sonho e as parcelas continuam", "o mesmo dividendo apareceu duas vezes", "o patrimônio subiu sozinho", "o lançamento caiu no mês errado", "o sonho mostra mais guardado do que eu paguei", "a compra descontou duas vezes". E antes de fechar qualquer alteração que mexa em como o dinheiro anda entre as telas.
---

# Validar integrações da Appliquei

**O que este projeto tem não são APIs entre módulos — são contratos de dados
implícitos.** As telas conversam por chaves de `localStorage` compartilhadas
(`futurorico_transacoes` é escrita por 9 arquivos em 29 pontos), por globais em
`window`, e por ligações que existem só como convenção de campo: `sonhoId`,
`contaId`, `operacaoId`, `txId`, `divKey`, e prefixos de id que embutem a chave
estrangeira (`tx_origem_{operacaoId}`).

**Por isso quebram caladas.** Nada lança erro. O número só fica errado. E o
padrão `typeof x === 'function' && x(...)`, usado em todo lugar para chamar
código de outro módulo, transforma "a função sumiu" em "o trecho foi pulado".

Conduza o trabalho em português brasileiro.

---

## As três peças

| Peça | Onde | Para quê |
| --- | --- | --- |
| Mapa de contratos | `.claude/integracoes/mapa.json` | A verdade declarada: quem escreve, quem lê, que regra nunca pode ser violada |
| Validador | `scripts/lib/invariantes.js` | Recebe um estado e devolve as violações |
| Travas | `test/integracao-inv*.test.js` | A garantia executável — roda no CI |

**A skill é a peça mais fraca das quatro.** O que garante é o teste. O papel
desta skill é ser a ponte: alteração → contratos em risco → teste que prova →
correção proposta.

## Modo A — "mexi aqui, o que quebra?"

Este é o modo padrão. Rode-o **antes de considerar a alteração pronta**.

### 1. Levante o impacto

```
node scripts/impacto-integracoes.js
```

Cruza o diff com o mapa e lista os contratos em risco, ordenados por gravidade,
com o sintoma que o usuário veria. Silêncio significa que nenhum contrato foi
tocado — siga.

Para um arquivo específico: `node scripts/impacto-integracoes.js web/arquivo.js`

### 2. Rode as provas

O comando sai pronto no fim da análise:

```
node scripts/impacto-integracoes.js --testes | sh
```

### 3. Se algo quebrou

Leia a mensagem: ela cita o `INV-NN` e explica o que o usuário veria. Vá ao
mapa, leia a `regra` inteira e o campo `fragilidade` **antes** de mexer.

Depois pergunte-se, nesta ordem:

1. **A alteração está errada?** → corrija a alteração.
2. **A invariante está errada?** → pode acontecer, e já aconteceu (ver INV-08
   abaixo). Aí corrija o mapa E o teste, e explique ao usuário por que a regra
   anterior era falsa. Nunca relaxe um teste só para ficar verde.
3. **A regra mudou de propósito?** → é decisão do usuário. Pergunte.

### 4. Se o contrato tocado não tinha trava

Escreva o teste agora, no molde dos que existem. **A skill fica mais forte a
cada uso** — cada contrato validado à mão uma vez vira trava permanente.

## Modo B — "valida tudo"

```
npm test -- test/integracao-inv*.test.js
```

Ou, para varrer um estado avulso (export do usuário, fixture, dump):

```js
const { validarEstado, formatar } = require('./scripts/lib/invariantes.js');
console.log(formatar(validarEstado({ transacoes, contas, historicoCompras, sonhos, cartoes, bens })));
```

## Modo C — partindo do sintoma

O usuário raramente diz "INV-17 quebrou". Ele diz "paguei a fatura e o saldo não
mudou". Cada invariante tem o campo `sintoma` escrito nas palavras dele:

```
grep -i "saldo do banco" .claude/integracoes/mapa.json
```

Ache a invariante pelo sintoma, rode a prova dela, e você já sabe se o contrato
está de pé ou não — antes de ler uma linha de código.

## Escrever uma invariante nova

Uma entrada em `invariantes[]` (ver `.claude/integracoes/mapa.schema.md` para
os campos) mais um `test/integracao-invNN-*.test.js` que faz **duas** coisas:

1. prova que o fluxo REAL respeita a regra (rodando o código de verdade no
   harness `test/_harness-integracao.js`);
2. prova que o validador ACUSA quando a regra é quebrada.

Sem a segunda, você não tem trava — tem um teste que passaria mesmo com o
validador vazio.

## Três armadilhas desta base — leia antes de propor qualquer correção

**A regra ingênua costuma estar errada, e "corrigir" para ela apaga dado do
usuário.** Os três casos reais:

**1. `sonhoId` órfão nem sempre é órfão.** Ao excluir um sonho o produto oferece
duas saídas, e as duas são corretas: "excluir tudo" e "manter histórico". A
segunda deixa DE PROPÓSITO as transações pagas apontando para um sonho que já
não existe. O que separa órfão de histórico é `pago`, não a existência do sonho.
Uma trava escrita pela leitura ingênua acusaria o comportamento certo e
empurraria para uma correção que apaga histórico.

**2. `mes/ano` não têm de bater com `dataVencimento`.** Registrar em agosto o
aluguel que vence em 10/set é o fluxo normal. Só `cartao_credito` amarra
competência ao vencimento (a fatura). São três caminhos com três origens de
competência — inserção usa `visaoMes`, edição usa `competenciaDaData`, cartão
sobrescreve com o mês da fatura.

**3. Aporte tem DOIS padrões legítimos.** Duas pernas (compra avulsa:
`temLegCaixa` + `tx_origem_*`) e perna única (parcela recorrente de previdência:
`contaId` direto, sem flag). Exigir `temLegCaixa` em todo aporte acusa
`previdencia.js` como falso positivo. A checagem é relacional — existe perna de
caixa irmã? — nunca por presença da flag isolada.

**A lição das três: leia a `regra` e a `fragilidade` inteiras no mapa antes de
concluir que algo está quebrado.** Se o mapa não explica o caso que você está
vendo, é sinal de que o mapa está incompleto — não de que o código está errado.

## Riscos estruturais em aberto

`riscosConhecidos` no mapa lista o que torna classes inteiras de bug possíveis e
depende de decisão do usuário. Não os "corrija" por conta própria — traga-os
quando forem relevantes para o que está sendo feito:

- **RISCO-01** — `transacoes` não tem escrita canônica (29 `setItem` manuais,
  contra `salvarContas()` que centraliza tudo).
- **RISCO-02** — sonho não exige conta de origem; compromisso pago debita
  "A reconciliar" por fora da trava de `controleBancoObrigatorio`.
- **RISCO-03** — inserção e edição derivam a competência de fontes diferentes.
