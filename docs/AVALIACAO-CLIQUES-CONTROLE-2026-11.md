# Avaliação de cliques — aba Controle financeiro (04/11/2026)

Pergunta: quantos toques (celular) e cliques (web) custam as tarefas do dia a
dia no Controle, e onde dá para cortar?

Método: as 11 tarefas mais comuns foram **executadas de verdade** no app
(`vite preview` do `main` em a73b2a1, dados de exemplo de
`e2e/_seed-paridade.js` + um cartão), com Playwright, em **celular 390×844**
(toque) e **web 1440×900** (clique). Cada tarefa parte da tela inicial do
Controle no mês atual e só conta como feita se o dado foi gravado. Conta-se:

- **T** = toques/cliques; **C** = campos digitados; **R** = rolagens para achar
  o próximo botão (o alvo estava fora da tela).
- O seletor de data nativo do celular custa mais ~2–3 toques (abrir, dia, OK);
  aparece como 1 campo.

Complementa a `docs/AVALIACAO-UX-2026-10.md` (que tratou de clareza e
arquitetura); aqui o foco é só **esforço**.

## Resultado

| #   | Tarefa                                    | Celular hoje | Web hoje                                      | Celular proposto | Web proposto |
| --- | ----------------------------------------- | ------------ | --------------------------------------------- | ---------------- | ------------ |
| 1   | Gasto no débito (Mercado 52,90 · Nubank)  | 4T 2C **1R** | 5T 2C                                         | 3T 2C            | 2T 2C        |
| 2   | Receita (Salário · Nubank)                | 3T 2C **1R** | 4T 2C                                         | 3T 2C            | 3T 2C        |
| 3   | Compra no cartão em 3x                    | 7T 2C        | 6T 2C                                         | 4T 2C            | 3T 2C        |
| 3b  | …a mesma compra em **10x**                | **14T** 2C   | **13T** 2C                                    | 4T 2C            | 3T 2C        |
| 4   | Conta fixa mensal (Aluguel dia 10 · Itaú) | 5T 3C **1R** | 6T 3C                                         | 4T 3C            | 3T 3C        |
| 5   | Marcar conta como paga                    | 2T **1R**    | 2T **2R** (extrato a ~1.500 px)               | 2T               | 2T           |
| 6   | Corrigir o valor de um lançamento         | 4T 1C **1R** | 2T 1C **2R**                                  | 3T 1C            | 2T 1C        |
| 7   | Excluir um lançamento avulso              | 4T **1R**    | 2T **2R**                                     | 3T               | 1T           |
| 8   | Pagar a fatura do cartão                  | 3T **1R**    | 3T **2R** (painel recolhido)                  | 2T               | 2T           |
| 9   | Ver o mês passado e voltar                | 2T           | 2T                                            | 2T               | 2T           |
| 10  | Ver só uma categoria no extrato           | 4T           | 1T **1R**                                     | 2T               | 1T           |
| 11  | Transferir entre contas                   | 3T 1C **1R** | **sai do Controle**: 4T 1C 1R + trocar de aba | 3T 1C            | 2T 1C        |

**Soma das 11 tarefas (sem a 3b):**

- celular: **41 toques + 8 rolagens → 31 toques e nenhuma rolagem** (−24% de
  toques; −37% contando as rolagens);
- web: **37 cliques + 10 rolagens → 23 cliques e nenhuma rolagem** (−38% de
  cliques; −51% contando as rolagens);
- no parcelado longo (3b): 14 → 4 no celular, 13 → 3 no web.

Os campos digitados (valor, descrição) não mudam: são o mínimo de cada tarefa.
A coluna "proposto" supõe os lotes A e B aplicados, num lançamento que já foi
feito antes (conta e categoria lembradas).

O que já está bom e fica como está: baixar uma conta (2 toques nas duas
plataformas), trocar de mês (2), filtro por categoria no web (1 clique), o
Salvar sempre à vista no formulário, e a sugestão de categoria pelo nome.

## Onde estão os cliques a mais

1. **Os atalhos do celular estão abaixo da dobra.** Despesa, Receita, Pagar e
   Transferir ficam depois do card da sobra (390×844): toda tarefa que começa
   por eles precisa rolar antes. A alternativa, o "+" da barra, custa 3 toques
   (+ → Lançamento → Saída), porque o menu pergunta "Lançamento ou
   Investimento" antes do tipo. `web/appliquei-mobile.js:1360`,
   `Appliquei_v13.0.html:13680`.
2. **A conta nunca vem escolhida.** Gasto, receita e conta fixa exigem tocar
   na conta todas as vezes, mesmo para quem tem uma conta só ou sempre usa a
   mesma (`web/appliquei-lancamento-ui.js:154`). Sem conta, o salvar trava.
3. **No web o "Novo lançamento" abre sem tipo.** Um clique a mais em toda
   saída (o caso mais comum), que o celular já resolve com o atalho.
4. **Parcelas só por − / +.** 3x = 2 toques; 10x = 9; 12x = 11
   (`Appliquei_v13.0.html:14911`).
5. **A categoria sugerida precisa de "Usar".** Quem lança "Mercado" pela
   décima vez ainda toca na categoria (`web/appliquei-insights-ui.js:1041`).
6. **No celular, editar/excluir exige descobrir as ações.** Extrato → tocar na
   linha (ou deslizar) → lápis/lixeira. As "Movimentações" do Início não são
   tocáveis (`web/appliquei-mobile.js:1192`).
7. **Fatura: o card de Próximos dias só tem "Ver fatura".** Pagar passa pela
   tela de Faturas (3 toques), enquanto a conta comum tem "Baixar" direto
   (`web/appliquei-mobile.js:1883`).
8. **No web o que se usa todo dia está longe.** O extrato começa a ~1.500 px
   do topo e "Próximos vencimentos" vem recolhido: pagar ou editar sempre
   começa rolando (`Appliquei_v13.0.html:14794`).
9. **Transferir não existe no Controle do web** — só em Meu patrimônio
   (`Appliquei_v13.0.html:15963`). E nas duas plataformas o "Para" abre na
   mesma conta do "De" (`web/appliquei-contas.js:881`), um toque a mais
   sempre.
10. **Excluir avulso pede confirmação em modal** — num lançamento sem série,
    um "Desfazer" no aviso protege igual e custa um toque a menos.

## Propostas (impacto × esforço)

### Lote A — sem decisão de produto, código pequeno (1 PR)

| Proposta                                                                                                                                                                       | Corta                                   | Heurística                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------- |
| **Conta pré-escolhida**: a última usada naquele tipo (entrada/saída); com uma conta só, ela. O botão aparece aceso e troca com 1 toque.                                        | −1 em 1, 2, 4                           | Flexibilidade e eficiência   |
| **Parcelas em botões**: `1x 2x 3x 6x 10x 12x` + "outro" (mantém o − / +).                                                                                                      | −1 em 3; −8 a −10 em 10x/12x            | Reconhecer em vez de lembrar |
| **Categoria aplicada sozinha** quando o nome já foi lançado antes com a mesma categoria (o chip fica aceso e o resumo diz "Mercado · Alimentação"; trocar continua a 1 toque). | −1 em 1, 3, 4 a partir do 2º lançamento | Eficiência                   |
| **"Para" na outra conta**: com duas contas, já vem a que não é a de origem.                                                                                                    | −1 em 11                                | Defaults inteligentes        |
| **"Pagar" no card da fatura** em Próximos dias (abre a mesma confirmação da tela Faturas); "Ver fatura" vira toque no card.                                                    | −1 em 8                                 | Consistência (igual à conta) |

### Lote B — mexe no layout (1 PR por plataforma, vale um print antes)

| Proposta                                                                                                                                                                              | Corta                                     | Heurística                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------- |
| **Celular: o "+" da barra abre direto Despesa · Receita · Cartão · Transferir** (Investimento e Telegram numa segunda linha). É o atalho que já existe, sem precisar rolar.           | −1 toque e −1 rolagem em 1–4, 11          | Eficiência                        |
| **Celular: tocar numa linha do extrato ou das Movimentações abre a edição** (já tem Excluir dentro); o deslizar continua para quem conhece.                                           | −1 em 6                                   | Reconhecer em vez de lembrar      |
| **Celular: chips de categoria no topo do Extrato** (como no web), no lugar de Filtros → Categoria → Ver.                                                                              | −2 em 10                                  | Consistência entre plataformas    |
| **Web: "Novo lançamento" vira três botões** — `− Despesa` (principal) · `+ Receita` · `Cartão` — ou abre já em Saída.                                                                 | −1 em 1, 3, 4                             | Eficiência                        |
| **Web: extrato e vencimentos sobem.** Ordem: números do mês → Próximos vencimentos (aberto quando há algo vencido ou nos próximos 7 dias) → Extrato → Saúde/Composição/O que notamos. | −2 rolagens em 5–8, 10                    | Hierarquia (o que se usa no topo) |
| **Web: "Transferir" no Controle** (no cabeçalho ao lado de Faturas, ou como 4º tipo no Novo lançamento).                                                                              | Fica na aba; −2 cliques e a troca de tela | Consistência (o celular já tem)   |

### Lote C — pede decisão do fundador

- **Excluir avulso com "Desfazer" em vez de modal** (série continua com a
  pergunta "só este mês / este e os futuros"). −1 em 7. Mexe com dinheiro:
  passar pela skill `simular-acao` antes.
- **Repetir um lançamento**: ao escolher "Mercado" na lista de descrições
  (já existe `listaDescricoes`), preencher também conta e categoria do último
  igual. Na prática o gasto recorrente vira **valor + Salvar**. Combina com o
  item "Já pagou?" da avaliação de outubro (item 9) — decidir os dois juntos.

## Como medir depois

- Repetir esta medição no PR de cada lote (o roteiro está descrito acima;
  pode virar `e2e/cliques-controle.spec.js` com um teto de toques por tarefa,
  para a contagem não subir sem ninguém ver).
- No grupo de teste: tempo do "abrir o formulário" ao "Salvar" e % de
  lançamentos salvos sem trocar a conta/categoria pré-escolhidas (se a troca
  passar de ~30%, o default está errado).

Limites: sem usuários reais; contagens com dados de exemplo (2 contas, 1
cartão). Com mais contas/cartões, os itens 2 e 9 pesam mais; com um cartão só
ele já vem escolhido (como na medição).
