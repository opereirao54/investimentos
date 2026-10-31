# Análise de métricas e melhoria do conteúdo

Procedimento fixo para ler os números dos Reels e decidir o próximo conteúdo
(pedido do fundador em 30/10/2026: "quero que você olhe as métricas e melhore o
conteúdo"). O fundador vê os mesmos números na aba **Redes sociais** do admin
(`admin.html`), que lê o Instagram pelo mesmo código
(`api/_lib/redes-instagram.js`).

## Como puxar os números

```bash
npm run metricas:instagram
```

- Grava o retrato do dia em `marketing/metricas/instagram/AAAA-MM-DD.json` e
  imprime a tabela dos Reels.
- Fonte preferida: o admin em produção (`APPLIQUEI_URL` + `ADMIN_API_TOKEN` no
  ambiente da sessão), que usa o `IG_TOKEN` do Vercel e o renova sozinho.
  Alternativa: `IG_TOKEN` direto no ambiente (com `IG_USER_ID`, é o token do
  usuário do sistema do portfólio, que não vence; sem ele, o da Instagram
  API, de 60 dias).
- Sem acesso configurado, o script diz o que falta; peça ao fundador os
  números da tela "Estatísticas" do Reel em vez de inventar.
- TikTok e YouTube ainda não têm conexão: use o print que o fundador mandar.

## O que olhar, em ordem de peso

| Métrica                                    | Por que importa                                             | Referência inicial    |
| ------------------------------------------ | ----------------------------------------------------------- | --------------------- |
| **Compartilhamentos ÷ alcance**            | o que mais leva o Reel para fora dos seguidores             | bom acima de 1%       |
| **Salvos ÷ alcance**                       | diz se o conteúdo foi útil (educação financeira vive disso) | bom acima de 2%       |
| **Retenção** (tempo médio ÷ duração)       | o gancho segurou? queda cedo = abertura fraca               | bom acima de 50%      |
| **Seguiram pelo Reel**                     | converteu quem não seguia (o objetivo até o lançamento)     | a média da série      |
| Views por pessoa (views ÷ alcance)         | acima de 1,1 = gente reassistindo (sinal de conteúdo denso) | —                     |
| Visitas ao perfil e cliques no link da bio | interesse na marca além do vídeo                            | —                     |
| **Views** e **alcance**                    | volume; varia com o algoritmo, compare com a média da série | a média dos últimos 9 |
| Comentários                                | conversa; tema que divide gera comentário (ex.: carro)      | —                     |
| Seguidores ganhos no período               | o objetivo da série até o lançamento                        | —                     |

A retenção usa a duração registrada em `api/_lib/reels-duracoes.json`
(início da legenda → segundos). **Ao entregar cada Reel novo, acrescente a
duração lá** (`ffprobe` do mp4 final); sem isso o painel mostra "—" na
retenção daquele Reel. A curva segundo a segundo e a retenção dos 3 primeiros
segundos não vêm pela API: quando precisar, peça o print da tela
"Estatísticas" do Reel.

As referências são pontos de partida: depois de 3 semanas, troque pelas
médias reais do perfil (mediana dos Reels da própria série).

## Rotina

1. **Dia seguinte a cada Reel (no lembrete diário):** rode o script e mande
   ao fundador uma linha por Reel novo: views, salvos %, compart. %, tempo
   médio, e se ficou acima ou abaixo da média da série. Anote na coluna
   "Publicado" do `CALENDARIO.md`.
2. **Toda segunda (resumo da semana):**
   - ranking dos Reels da semana pela pontuação (compart. ×3, salvos ×2,
     coment. ×1,5, curtidas ×1, a mesma do painel);
   - comparar as séries (Appliquei News × Appliquei Explica);
   - 2 ou 3 hipóteses do porquê (gancho, tema, duração, horário);
   - 1 mudança concreta para a semana seguinte.
3. **Revisão de 16/11 (3 semanas):** relatório completo e decisão de temas da
   fase 3 (os temas que mais renderem ganham variações).

## Como transformar número em mudança

| Sinal                                        | Hipótese                      | O que mudar                                                     |
| -------------------------------------------- | ----------------------------- | --------------------------------------------------------------- |
| Tempo médio baixo (menos de 30% da duração)  | o gancho não segurou          | número ou pergunta no 1º segundo; cortar a introdução           |
| Views altas, salvos baixos                   | curioso, mas pouco útil       | fechar com regra de bolso clara e "salva pra quando…"           |
| Salvos altos, compart. baixos                | útil, mas pouco "de alguém"   | CTA "manda pra quem…" com uma pessoa concreta                   |
| Comentários altos                            | tema divide opinião           | responder com a conta; fazer a parte 2                          |
| Uma série muito acima da outra por 2 semanas | o público prefere aquele tipo | puxar o tom/tema vencedor para a outra série, sem mudar os dias |
| Reel longo (60 s+) com tempo médio baixo     | duração                       | testar versão de 30–45 s do mesmo tema                          |

Uma mudança por vez, para saber o que funcionou. Registre cada mudança e o
resultado em `marketing/metricas/LEIAME.md`.

## Limites

- Números só os que vieram da API ou do print do fundador; nunca estimar.
- Nada de mudar o combinado (séries, dias, horários, voz, personagens) sem
  perguntar: a análise propõe, o fundador decide.
