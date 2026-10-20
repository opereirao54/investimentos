# Avaliação de UX — Appliquei (20/10/2026)

Pergunta: o app está complexo demais comparado com os concorrentes? Como
reduzir sem perder o que só ele faz?

Método: auditoria heurística (Nielsen) do código no `main` (43e909b) em três
frentes — navegação e primeiro acesso, fluxos do dia a dia (Controle) e telas
de investimento — mais capturas do app no celular (390 px) e no desktop
(1440 px). Sem teste com usuários: os pontos abaixo são hipóteses fortes para
validar com o grupo de teste (métricas no fim).

Referências `H:` = `Appliquei_v13.0.html`; `CF:` =
`web/appliquei-aba-controle-financeiro.js`; `APP:` = `web/appliquei-app.js`;
`MOB:` = `web/appliquei-mobile.js`.

## Resumo

O app é mais amplo que qualquer concorrente (o "tudo junto" é o diferencial),
e a complexidade vem de três lugares, nesta ordem:

1. **Comportamentos silenciosos** — o app decide coisas importantes sem dizer
   (lançamento nasce pago, 60 repetições, parcela sai da série, baixa de R$ 0
   aceita). É o que gera dúvida do tipo "o que aconteceu com meu sonho?".
2. **Arquitetura e nomes** — ~27 destinos em até 3 níveis, o mesmo lugar com
   2–3 nomes, e a aba "Carteira" do celular abrindo a sugestão em vez dos
   investimentos da pessoa.
3. **Vocabulário** — termos de contador e de investidor (DRE, competência,
   proventos, Yield on Cost, preço médio, DARF) sem explicação no lugar.

O que já está bom e deve ser mantido: o modal de boas-vindas com 4 passos
claros e "pular"; o atalho "Despesa" do celular (2 toques + valor); o menu "+"
com 3 opções descritas; os modais de excluir série ("só este mês / este e os
futuros"); desfazer pagamento; avisos de cotação atrasada; avisos de risco na
Carteira sugerida e na Jornada.

## P0 — corrigir já (confundem ou deixam dado errado)

| #   | Problema                                                                                                                                                      | Onde                                                                     | Heurística                             | Proposta                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Baixa com **R$ 0** é aceita em qualquer conta (o mesmo padrão do sonho, corrigido só lá): a conta some como "paga"                                            | CF:2986                                                                  | Prevenção de erros                     | R$ 0 abre "Não pagou este mês?" com **Adiar para o mês que vem** / **Excluir só este mês** / **Cancelar**                                    |
| 2   | **Excluir** parcela de sonho já paga deixa o aporte e o `valorAtual` no sonho; "este e os futuros" deixa o plano apontando para parcelas que não existem      | CF:2790-2810                                                             | Consistência / prevenção               | Exclusão passa pela mesma porta do desfazer (tira o aporte junto) ou é bloqueada para parcela de sonho com "use Pular mês / excluir o sonho" |
| 3   | Despesa variável **nasce paga** em silêncio; "Repetir todo mês" gera **60 lançamentos** sem dizer                                                             | CF:1849-1866, CF:1035                                                    | Visibilidade do status                 | Mensagem de sucesso diz o que aconteceu: "Gasto lançado e descontado do Nubank" / "Repetido todo mês pelos próximos 5 anos"                  |
| 4   | Pagar valor diferente do previsto, ou editar "só este mês", **tira o lançamento da série** sem avisar                                                         | CF:3018-3022, CF:1778                                                    | Visibilidade                           | Aviso curto no ato: "Só esta parcela muda; as próximas continuam R$ X"                                                                       |
| 5   | **Arquivar conta** sem confirmação; arquivar cartão com `confirm()` do navegador que não diz que as parcelas futuras continuam                                | `web/appliquei-contas.js`:617-621, APP:929-946                           | Prevenção / controle                   | Modal da casa com o efeito ("as 4 parcelas futuras continuam a pagar") e desfazer no toast                                                   |
| 6   | Cartão criado **dentro do lançamento** não pede conta pagadora (nas Configurações pede): a fatura fica sem conta de onde sai o dinheiro                       | CF:1270-1295 × APP:875-885                                               | Consistência                           | Pedir a conta pagadora também no cartão rápido (pré-selecionar a principal)                                                                  |
| 7   | **Simulador sem aviso** de que é simulação (abre com 1% a.m. fictício); Carteira sugerida abre com **aporte de R$ 10.000/mês** e cita "carteira do consultor" | H:15088-15114, H:14882, `web/appliquei-aba-carteira-recomendada.js`:2030 | Correspondência com o mundo real / CVM | Aviso "simulação, não promessa" no Simulador; aporte vazio ou pela sobra real do mês; trocar "consultor" por "carteira de referência"        |

## P1 — reduzir a complexidade (arquitetura e formulário)

**8. Navegação: menos destinos, um nome por lugar.** Hoje são 11 seções na
lateral (H:13611-13633) + 8 subabas + 6 painéis de Configurações + Faturas
(~27 destinos). Nomes conflitantes:

- `controle` = "Controle financeiro" e "Início"; `meu_patrimonio` = "Meu
  patrimônio" e "Patrimônio";
- "Carteira" = a Carteira **sugerida** na barra do celular (H:13413), mas
  também a subaba das **posições do usuário** (H:13796);
- "Info Mercado" = "Radar de mercado" (H:15475) = "Radar do dia";
- "Dividendos" na aba, "proventos" no texto;
- três "projeções" diferentes (Projeção/DRE do Controle, Futuro dos
  investimentos, Simule sua liberdade).

Proposta (decisão do fundador):

| Destino              | Junta                                                    | Pergunta que responde        |
| -------------------- | -------------------------------------------------------- | ---------------------------- |
| **Meu mês** (início) | Controle + Faturas + contas e cartões                    | Quanto ainda dá pra gastar?  |
| **Patrimônio**       | Meu patrimônio + bens                                    | Quanto eu tenho?             |
| **Investimentos**    | Meus investimentos (posições, operações, dividendos, IR) | Como vão meus investimentos? |
| **Planejar**         | Sonhos + Simule sua liberdade + Carteira sugerida        | Onde quero chegar?           |
| **Aprender**         | Jornada + Info Mercado + Dúvidas                         | —                            |

No celular, a barra passa a ser **Mês · Patrimônio · + · Investimentos ·
Mais**, com a Carteira sugerida dentro de Planejar (hoje as posições da pessoa
ficam escondidas no "Mais" e a barra abre a sugestão). Tirar **Applicash** do
menu enquanto estiver em reformulação (grupo com um item só, H:13627).

**9. Formulário de lançamento: uma pergunta por conceito.**

- Os chips Entrada/Saída/Cartão e o select "Categoria" (Receita/Despesa
  fixa/variável/Cartão, H:14563-14574) fazem a mesma escolha duas vezes →
  ficar só com os chips e um interruptor "**Se repete todo mês?**" (fixa ×
  variável deixa de ser vocabulário).
- Dois campos chamados "Categoria" → o segundo vira só **Categoria**
  (Alimentação, Moradia…) e o primeiro some.
- "Pago × a pagar" decidido em silêncio → perguntar "**Já pagou?**" (padrão
  sim para gasto de hoje, não para data futura).
- Sem data, o lançamento cai no mês que está aberto na tela (CF:1945) →
  mostrar a data padrão no campo ("hoje") em vez de deixá-lo vazio.

**10. Coisas que exigem lembrar onde ficam.** Contas se cadastram em Meu
patrimônio (H:15611), cartões e categorias só em Configurações (H:13275),
Faturas num botão do Controle, o guia só se reabre em Configurações. →
"Contas e cartões" acessível a partir do Controle (onde a pessoa lança), e o
guia de primeiros passos reaberto pelo "?" de ajuda.

## P2 — linguagem, estados e mensagens

**11. Jargão sem explicação no lugar** (nenhum "?" nos títulos e KPIs do
Controle, Investimentos e Carteira):

| Hoje                                               | Sugestão                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| Projeção de caixa (DRE)                            | Projeção do mês                                                       |
| Termômetro / Regra dos 60%                         | manter, com "?" de uma linha                                          |
| Ganho capital                                      | Valorização                                                           |
| Yield on Cost                                      | "Rende por ano sobre o que você pagou" (com o termo entre parênteses) |
| Preço médio, proventos, CDI, IPCA, DARF, P/L, P/VP | "?" de uma frase cada (glossário único, reaproveitando a Jornada)     |
| Baixar / baixar fatura                             | Marcar como paga                                                      |
| Aporte (fora da área de investimentos)             | Guardar / guardado                                                    |

**12. Estados vazios.** O Controle de quem acabou de entrar mostra sete
"R$ 0,00" e gráficos vazios (H:14264-14362) — trocar o bloco de números por um
estado vazio com **uma** ação ("Lance seu primeiro gasto"). A tabela DRE não
tem estado vazio (CF:3385). O Simulador abre com números fictícios
(H:15088-15114) — usar os do usuário quando houver. O guia espera até 25 s pela
primeira sincronização (`web/appliquei-primeiros-passos.js`:52, 1025-1028):
mostrar "carregando seus dados…" nesse intervalo.

**13. Mensagens técnicas ou vagas** (dizer causa + saída):

| Hoje                                                                                    | Sugestão                                                                                                                 |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| "Falha ao salvar localmente. Espaço de armazenamento esgotado?" (APP:989)               | "Não deu para salvar neste aparelho (memória cheia). Seus dados na nuvem estão seguros — libere espaço e tente de novo." |
| "Grupo não encontrado." (CF:2814, 2856)                                                 | "Esse lançamento não existe mais — atualize a página."                                                                   |
| "Por favor, informe um valor válido." / "Valor inválido."                               | "Digite o valor em reais, ex.: 52,90."                                                                                   |
| "Este pagamento gerou um aporte vinculado — reverta pela aba correspondente." (CF:3091) | dizer qual aba, com link                                                                                                 |
| "Informe o banco/instituição da operação." (CF:1959)                                    | "De qual banco saiu esse dinheiro?"                                                                                      |

## Como validar (grupo de teste)

- **Ativação:** % que lança 1 receita e 1 gasto no primeiro dia.
- **Retenção:** % que volta e lança algo na 2ª semana.
- **Onde param:** telas abertas e abandonadas sem ação (o app já tem Sentry;
  um evento de navegação simples basta).
- **Tarefas guiadas** com 3–5 testadores: "lance um gasto no cartão em 3x",
  "quanto ainda dá pra gastar este mês?", "não vou conseguir guardar para o
  sonho este mês — o que faço?". Anotar onde hesitam.

## Ordem sugerida

1. **P0 (1–2 PRs):** itens 1–7 — pequenos, sem decisão de produto.
2. **Decisão do fundador:** nomes e a nova navegação (item 8) e o formulário
   enxuto (item 9) — mudam o app inteiro, valem um protótipo antes.
3. **P2 em lotes:** glossário "?", estados vazios, mensagens.
