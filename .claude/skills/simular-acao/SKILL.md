---
name: simular-acao
description: Simula exaustivamente um botão ou ação da Appliquei — todas as entradas possíveis, todas as ordens de execução — e valida o sistema inteiro depois de cada uma, achando o que quebra em OUTRAS telas. Use SEMPRE que o usuário criar ou alterar um botão, formulário, modal ou fluxo de tela e pedir para "simular todos os comportamentos", "fechar todas as pontas", "ver se quebra alguma coisa", "testar todos os casos", "mitigar os erros", "validar a integração com as outras páginas". Use também quando ele descrever uma ação nova ("criei uma função de editar / de aporte / de excluir") sem pedir explicitamente, e antes de dar por pronta qualquer alteração em ação que mexa com dinheiro — lançamento, pagamento, aporte, compra, venda, transferência, exclusão. Não confundir com validar-integracoes, que analisa o impacto de um DIFF; esta dirige a ação de verdade e observa o estrago.
---

# Simular uma ação da Appliquei

**A pergunta que esta skill responde é outra.** `validar-integracoes` pergunta
*"o que meu diff coloca em risco?"*. Esta pergunta *"e se o usuário apertar este
botão, de todas as formas possíveis, em todas as ordens possíveis?"*.

A técnica é **teste baseado em modelo com verificação de invariantes**: dirigir a
ação de verdade num mundo completo e, depois de cada execução, validar o sistema
inteiro — não só a tela que foi tocada.

Conduza o trabalho em português brasileiro.

---

## As peças

| Peça | Onde | Papel |
| --- | --- | --- |
| Motor | `test/_simulador.js` | Mundo completo + `executar()` que audita cada ação |
| Sequências | `test/_sequencias.js` | Encadeia ações aleatórias com semente fixa |
| Caça intensiva | `scripts/cacar-interacoes.js` | `npm run cacar` — muitas sequências, sob demanda |
| Travas | `test/simulacao-*.test.js` | O que ficou permanente, roda no CI |

O mundo de `criarMundo()` tem dado em **todas** as telas: três contas (uma
cheia, uma quase vazia, uma corretora zerada), receita do mês, cartão com fatura
pendente, investimento com as duas pernas, bem, e sonho com plano vinculado e
aporte. É o que faz um botão da aba Sonhos que estrague o Patrimônio ser pego.

## O protocolo

### 1. Enumere as entradas — não só as que fazem sentido

Para cada campo que a ação lê, exercite no mínimo:

| Classe | Por que |
| --- | --- |
| válida | a linha de base |
| zero, negativa | quase sempre passa quando ninguém testou |
| vazia | `parseBRL('')` devolve 0, que passa em `> 0`? |
| não-finita (`NaN`, `Infinity`) | **`NaN <= 0` é `false`** — passa por qualquer guarda escrita assim |
| acima do saldo disponível | deixa o caixa negativo: dinheiro inventado |
| id inexistente | conta apagada entre abrir o modal e confirmar |
| data inválida | `new Date('abacaxi').toISOString()` **lança** e trava a tela |
| gigante | estoura formatação e cálculo |
| duplo clique | mede como DUAS execuções separadas, nunca uma |

### 2. Ache o funil antes de escrever guarda

Quase toda ação tem vários caminhos que desembocam numa função só —
`finalizarAporteSonho` recebe de três lugares. **A guarda vive no funil**, não em
cada chamador: validar só no formulário deixa os outros caminhos abertos.

Mas confira se existe mais de um funil. Editar um sonho tem **dois** caminhos —
o direto e o `aplicarEdicaoSonhoComModo` (modal de confirmação, quando já há
aportes e o valor mudou) — e só a ordem das ações decide qual roda. Fechar um
deixou o outro aberto por uma rodada inteira.

### 3. Rode e leia os três defeitos que o motor separa

```js
const { criarMundo, executar, problemas } = require('./test/_simulador.js');
const m = criarMundo();
const rel = executar(m, { nome: '...', campos: {...}, fn: (s) => s.minhaAcao() });
assert.equal(problemas(rel, { deveRecusar: true, semMudarPatrimonio: true }), '');
```

| Sinal | O que significa |
| --- | --- |
| `excecao` | a tela trava na mão do usuário |
| `violacoes` | o estado ficou inconsistente — em QUALQUER tela |
| `fantasma` | **recusou e mexeu assim mesmo** |

A terceira é a mais traiçoeira: valida a entrada, avisa "valor inválido", e já
tinha gravado metade. Nenhum teste tradicional pega, porque o toast de erro
parece o comportamento certo.

Expectativas disponíveis: `deveRecusar`, `semMudarPatrimonio`,
`deltaPatrimonio`.

### 4. Encadeie — é onde estão os bugs que ninguém imagina

```
npm run cacar              # 300 sequências × 25 passos
npm run cacar 1000 40      # mais fundo, ao investigar
```

Ação nova deve entrar no catálogo `ACOES` de `test/_sequencias.js`, senão as
sequências nunca a exercitam. Quando a caça achar algo, a saída traz a semente e
a sequência exata: corrija, e **some a semente à lista fixa do teste** para o
caso virar trava permanente.

### 5. Consolide

O que passou vira `test/simulacao-*.test.js`. Uma exploração que achou bug e não
virou teste não protege ninguém da próxima vez.

## O erro a não cometer

**Quando a simulação acusa, o defeito pode estar na invariante, não no código.**
Já aconteceu três vezes nesta base:

- INV-08 reprovava o fluxo normal de despesa fixa;
- INV-10 acusaria a exclusão de sonho que preserva histórico de propósito;
- INV-22 acusava parcela **paga** — que debitou a conta que debitou na época, e
  recarimbá-la moveria dinheiro entre bancos retroativamente.

Antes de "corrigir" o código, leia a `regra` e a `fragilidade` inteiras em
`.claude/integracoes/mapa.json`. Se a regra não previu o caso que você está
vendo, é a regra que está incompleta. **Uma trava escrita pela leitura ingênua
acusa o comportamento certo e empurra para uma correção que apaga dado do
usuário.**

E o contrário também: expectativa de teste pode estar errada. Migração para
sonho derruba o patrimônio total de propósito — o sonho não é um bolso do
patrimônio. Confirme a regra de negócio antes de chamar de bug.
