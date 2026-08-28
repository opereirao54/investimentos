# Esquema do mapa de contratos

`mapa.json` é a fonte única de verdade sobre as integrações entre módulos da
Appliquei. Três consumidores leem este arquivo:

| Consumidor | Para quê |
| --- | --- |
| `test/integracao-*.test.js` | A garantia executável. Roda no CI e barra o merge. |
| `scripts/impacto-integracoes.js` | Análise de impacto: dado um diff, quais contratos estão em risco. |
| `.claude/skills/validar-integracoes` | O protocolo que a IA segue para validar e propor correção. |

**Adicionar uma integração nova = adicionar uma entrada aqui.** As três travas
aparecem sozinhas. Um contrato que não está no mapa não é validado por ninguém.

---

## `entidades`

Cada entidade é um conjunto de dados que atravessa módulos.

| Campo | O que é |
| --- | --- |
| `chaveArmazenamento` | A chave de `localStorage`. É o barramento real entre as páginas. |
| `globalWindow` | O nome da `var` top-level que os classic scripts compartilham via `window`. |
| `topologia` | `escrita-espalhada-leitura-central` (frágil) ou `escrita-central-leitura-espalhada` (saudável). |
| `produtores` | Arquivos que **escrevem**. Quanto mais, mais frágil. |
| `produtoresIndiretos` | Arquivos que criam registros chamando função de outro módulo (ex.: `obterOuCriarContaPorNome`). |
| `consumidores` | Arquivos que **leem** e calculam em cima. |
| `camposDeLigacao` | As chaves estrangeiras de facto. `apontaPara` diz onde o outro lado vive. |
| `vocabularioCategorias` | Conjuntos fechados de valores, agrupados **por consequência** (o que a categoria faz com o caixa), não por rótulo. |

## `invariantes`

Uma invariante é uma regra que **nunca** pode ser violada, escrita de forma
verificável.

| Campo | O que é |
| --- | --- |
| `id` | `INV-NN`. Estável. O teste e a mensagem de erro citam este id. |
| `regra` | A regra em português, precisa o bastante para virar `assert`. |
| `gravidade` | `critica` (o usuário perde ou vê dinheiro errado) · `alta` · `media`. Ordena a saída da análise de impacto. |
| `arquivos` | Se o diff toca um destes, a invariante entra em risco. **É o gatilho do hook.** |
| `simbolos` | Funções e campos que, se alterados, colocam a invariante em risco. Filtro fino sobre `arquivos`. |
| `sintoma` | O que o **usuário** vê quando quebra, nas palavras dele. Permite achar o contrato partindo da queixa. |
| `historico` | O bug real que originou a regra, quando houver. Cicatriz documentada. |
| `fragilidade` | Por que esta invariante é fácil de quebrar sem perceber. |
| `prova` | O arquivo de teste que a garante. `null` = invariante declarada mas **sem trava**. |
| `status` | `coberta` · `coberta-parcialmente` · `pendente`. |

Uma invariante com `prova: null` é uma promessa, não uma garantia. A skill trata
isso como dívida e escreve o teste na primeira vez que aquele contrato for tocado.

## `riscosConhecidos`

Problemas estruturais identificados que **não** são bugs hoje, mas tornam uma
classe inteira de bugs possível. Cada um tem `decisao`, porque a correção
costuma ser uma escolha de produto — não cabe à IA decidir sozinha.

## `prefixosDeId`

Convenções de id que carregam significado (`tx_origem_{operacaoId}` embute a
chave estrangeira no próprio id). Quem gera e quem consome cada prefixo.
