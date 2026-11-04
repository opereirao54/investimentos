# Avaliação de cliques — aba Controle financeiro (04/11/2026)

Pergunta: quantos toques (celular) e cliques (web) custam as tarefas do dia a
dia no Controle, e onde dá para cortar?

Método: as tarefas mais comuns foram **executadas de verdade** no app
(`vite preview`, dados de exemplo de `e2e/_seed-paridade.js` + um cartão), com
Playwright, em **celular 390×844** (toque) e **web 1440×900** (clique). Cada
tarefa parte da tela inicial do Controle no mês atual e só conta como feita se
o dado foi gravado. "Antes" é o `main` em a73b2a1; "depois" é esta branch, com
os três lotes abaixo aplicados. Conta-se:

- **T** = toques/cliques; **C** = campos digitados; **R** = rolagens para achar
  o próximo botão (o alvo estava fora da tela).
- O seletor de data nativo do celular custa mais ~2–3 toques (abrir, dia, OK);
  aparece como 1 campo.

Complementa a `docs/AVALIACAO-UX-2026-10.md` (que tratou de clareza e
arquitetura); aqui o foco é só **esforço**.

## Resultado medido (antes → depois)

| #   | Tarefa                                    | Celular antes | Celular depois | Web antes                     | Web depois |
| --- | ----------------------------------------- | ------------- | -------------- | ----------------------------- | ---------- |
| 1   | Gasto no débito (Mercado 52,90 · Nubank)  | 4T 2C 1R      | 4T 2C ¹        | 5T 2C                         | 3T 2C ¹    |
| 2   | Receita (Salário · Nubank)                | 3T 2C 1R      | 3T 2C          | 4T 2C                         | 3T 2C      |
| 3   | Compra no cartão em 3x                    | 7T 2C         | 5T 2C ²        | 6T 2C                         | 5T 2C ²    |
| 3b  | …a mesma compra em **10x**                | **14T** 2C    | 5T 2C          | **13T** 2C                    | 5T 2C      |
| 4   | Conta fixa mensal (Aluguel dia 10 · Itaú) | 5T 3C 1R      | 5T 3C 1R       | 6T 3C                         | 4T 3C      |
| 5   | Marcar conta como paga                    | 2T 1R         | 2T 1R          | 2T 2R                         | 2T         |
| 6   | Corrigir o valor de um lançamento         | 4T 1C 1R      | 3T 1C 1R       | 2T 1C 2R                      | 2T 1C 1R   |
| 7   | Excluir um lançamento avulso              | 4T 1R         | 3T 2R          | 2T 2R                         | 1T 1R      |
| 8   | Pagar a fatura do cartão                  | 3T 1R         | 2T 1R          | 3T 2R                         | 2T         |
| 9   | Ver o mês passado e voltar                | 2T            | 2T             | 2T                            | 2T         |
| 10  | Ver só uma categoria no extrato           | 4T            | 2T             | 1T 1R                         | 1T 1R      |
| 11  | Transferir entre contas                   | 2T 1C 1R      | 3T 1C ³        | 3T 1C 1R **fora do Controle** | 2T 1C      |

**Soma das 11 tarefas (sem a 3b):**

- celular: **40 toques + 8 rolagens → 34 toques + 6 rolagens** (48 → 40
  gestos, −17%);
- web: **36 cliques + 10 rolagens → 27 cliques + 3 rolagens** (46 → 30
  gestos, −35%);
- parcelado longo (3b): **14 → 5** no celular, **13 → 5** no web.

Notas da medição:

1. No "Mercado" a categoria ainda foi tocada porque a do dado de exemplo
   (`mercado`) não existe na lista de categorias; com a categoria real, o
   segundo "Mercado" já vem com ela (como o "Aluguel" da tarefa 4, que veio
   com Moradia e a conta Itaú sem toque). Num gasto repetido: −1 toque.
2. "Tênis" e "TV" nunca foram lançados, então a categoria é escolhida; a partir
   da segunda vez vem sozinha (−1).
3. No celular o atalho "Transferir" do Início continua (2 toques, mas abaixo da
   dobra); a medição usou o "+" (3 toques, sem rolar).

Correção do relatório anterior: o "Para" da transferência **já vinha** na outra
conta (`web/appliquei-contas.js`); a primeira versão contou um toque a mais
nessa tarefa.

## Onde estavam os cliques a mais

1. **Os atalhos do celular estão abaixo da dobra.** Despesa, Receita, Pagar e
   Transferir ficam depois do card da sobra (390×844). O "+" da barra custava
   3 toques (+ → Lançamento → Saída).
2. **A conta nunca vinha escolhida**, mesmo para quem tem uma conta só ou
   sempre usa a mesma. Sem conta, o salvar trava.
3. **No web o "Novo lançamento" abria sem tipo** — um clique a mais em toda
   saída.
4. **Parcelas só por − / +.** 3x = 2 toques; 10x = 9; 12x = 11.
5. **A categoria sugerida precisava de "Usar"** em todo gasto repetido.
6. **No celular, editar exigia descobrir as ações** (Extrato → linha → lápis);
   as Movimentações do Início não eram tocáveis.
7. **Fatura: o card de Próximos dias só tinha "Ver fatura"** (3 toques para
   pagar, contra "Baixar" direto na conta comum).
8. **No web o que se usa todo dia estava longe**: extrato a ~1.500 px do topo
   e "Próximos vencimentos" recolhido.
9. **Transferir não existia no Controle do web** — só em Meu patrimônio.
10. **Excluir avulso pedia confirmação em modal.**

## O que foi feito

| Mudança                                                                                                                                                                                                                                    | Onde                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **Conta lembrada** num lançamento novo: a do último lançamento do mesmo tipo (entrada × saída), ou a única conta. Com a descrição, a do último lançamento de mesmo nome. Para de trocar assim que a pessoa mexe na conta. Nunca na edição. | `lancUiContaLembrada`, `lancUiAplicarContaLembrada` (`web/appliquei-lancamento-ui.js`) |
| **Categoria aplicada sozinha** quando o nome já foi lançado antes (sugestão "exata") e nenhuma categoria foi escolhida; aviso "Categoria X, como das outras vezes · Desfazer".                                                             | `insightsSugestaoAvaliar` (`web/appliquei-insights-ui.js`)                             |
| **Parcelas em botões**: À vista · 2x · 3x · 6x · 10x · 12x; o − / + continua.                                                                                                                                                              | `#lancParcChips`, `lancUiEscolherParcelas`                                             |
| **"+" com Despesa · Receita · Cartão · Transferir** em um toque (celular e o botão flutuante do web); Investimento e Telegram continuam abaixo.                                                                                            | `#fabMenu`, `cadastrarEm(destino, tipo)`, `cadastrarTransferencia`                     |
| **Web: "Novo lançamento" abre em Saída** e **"Transferir" no cabeçalho** do Controle.                                                                                                                                                      | `novoLancamentoControle`, `.btn-transferir`                                            |
| **Web: vencimentos e extrato sobem** (logo depois dos números do mês); O que notamos, saúde e composição ficam abaixo. Extrato de ~1.500 px para ~1.050 px.                                                                                | ordem dos blocos em `#controle`                                                        |
| **Próximos vencimentos abre sozinho** quando algo vence nos próximos 7 dias (a escolha de fechar continua valendo).                                                                                                                        | `vencDeveAbrir`                                                                        |
| **Celular: "Pagar" no card da fatura** em Próximos dias (mesma baixa do web, debita a conta pagadora — INV-17); tocar no card abre a fatura.                                                                                               | `_mobProximos` → `baixarGrupoCartao`                                                   |
| **Celular: tocar na linha do extrato abre a edição** (com Excluir dentro); o deslize continua mostrando as ações. **Movimentações do Início** também abrem a edição.                                                                       | `_mobLigarExtrato`, `_mobLinhaMovimento`                                               |
| **Celular: categorias no topo do Extrato** (faixa de deslizar, um toque filtra); a gaveta Filtros fica com ordem e conta.                                                                                                                  | CSS de `#extratoCategorias`                                                            |
| **Excluir avulso sem janela, com "Desfazer"** no aviso por 7 s. Série, sonho, transferência e lançamento ligado a investimento continuam perguntando.                                                                                      | `controleExclusaoDesfazivel`, `desfazerExclusaoLancamento`, `mostrarToastDesfazer`     |
| Transferência: trocar o "De" para a conta do "Para" move o "Para" para outra.                                                                                                                                                              | `transfOrigemMudou`                                                                    |

Travas novas: `test/reducao-cliques.test.js` (conta lembrada, exclusão
desfazível), `test/simulacao-excluir-desfazer.test.js` (Desfazer devolve o
patrimônio ao centavo, não duplica, funciona depois de outras ações) e as
ações "excluir avulso" / "apertar o Desfazer" no catálogo de sequências
(`test/_sequencias.js`), caçadas em 300 sequências × 25 passos sem achado.

## O que ainda dá para cortar

- **Celular: os atalhos do Início abaixo da dobra.** "Pagar" e "Próximos dias"
  ainda pedem uma rolagem (tarefas 5 e 8). Subir os atalhos para acima do card
  da sobra, ou encolher o card, tira essa rolagem.
- **Celular: o Excluir fica no fim do formulário de edição** (rolagem a mais na
  tarefa 7). Um botão de lixeira no topo da folha, ao lado do ✕, resolve.
- **Web: o extrato ainda começa abaixo da dobra** em 1440×900 (~1.050 px). Um
  cabeçalho de KPIs mais baixo, ou o extrato ao lado dos vencimentos, o traria
  para a primeira tela.
- **"Já pagou?"** (avaliação de outubro, item 9) continua pendente de decisão.

## Como medir de novo

- O roteiro desta medição pode virar `e2e/cliques-controle.spec.js` com um
  teto de toques por tarefa, para a contagem não subir sem ninguém ver.
- No grupo de teste: tempo do "abrir o formulário" ao "Salvar" e % de
  lançamentos salvos sem trocar a conta/categoria pré-escolhidas (se a troca
  passar de ~30%, o padrão está errado).

Limites: sem usuários reais; contagens com dados de exemplo (2 contas, 1
cartão). Com mais contas/cartões, a conta lembrada pesa mais; com um cartão só
ele já vem escolhido (como na medição).
