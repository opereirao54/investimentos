# Formatos, estruturas e ganchos

## Especificações por formato

| Formato                   | Tamanho                        | Duração / texto                             | Área segura                                                                                           |
| ------------------------- | ------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Reels / Shorts / TikTok   | 1080×1920 (9:16)               | 15–30 s converte melhor; 60 s para tutorial | deixe ~250 px livres no topo e ~380 px no rodapé (nome, legenda, botões) e ~120 px à direita (ícones) |
| Story                     | 1080×1920                      | 1 ideia por story, até 7 em sequência       | mesmas margens do Reels                                                                               |
| Post feed                 | 1080×1350 (4:5)                | título que se lê em 1 s                     | margem 80 px                                                                                          |
| Carrossel                 | 1080×1350, até 10 lâminas      | 6–8 lâminas                                 | capa vende o clique; última lâmina tem o CTA                                                          |
| LinkedIn                  | 1080×1350 ou documento PDF     | texto de 800–1.300 caracteres               | 1ª linha é o gancho                                                                                   |
| WhatsApp / grupo de teste | imagem 1080×1350 + texto curto | até 5 linhas                                | um pedido só ("me conta o que achou")                                                                 |

Legenda: gancho na 1ª linha, 3–6 linhas de valor, CTA, 3–5 hashtags de nicho
(#financaspessoais #controlefinanceiro #educacaofinanceira #investimentos
#organizacaofinanceira). No TikTok, palavras-chave na legenda valem mais que
hashtag.

## Estrutura de vídeo curto (30 s)

| Tempo   | Bloco      | O que fazer                                                                                |
| ------- | ---------- | ------------------------------------------------------------------------------------------ |
| 0–3 s   | **Gancho** | pergunta ou frase que a persona reconhece; texto grande na tela; movimento já no 1º quadro |
| 3–7 s   | **Dor**    | o problema concreto (planilha abandonada, fim do mês no vermelho, tudo espalhado)          |
| 7–11 s  | **Virada** | a marca + a promessa em uma linha ("Seu dinheiro inteiro, numa tela só.")                  |
| 11–24 s | **Prova**  | 2 ou 3 telas reais do app, uma por funcionalidade, cada uma com uma frase                  |
| 24–30 s | **CTA**    | oferta com condição ("7 dias grátis, sem cartão") + "link na bio"                          |

Regras: legenda/texto na tela em toda cena (muita gente assiste sem som);
corte a cada 2–4 s; nada de logo parado nos 3 primeiros segundos; termine com
o CTA na tela por pelo menos 2 s.

Modelo pronto: `marketing/ferramentas/shorts/video.html` (o primeiro Shorts).

### Outras estruturas de vídeo

- **Tutorial (30–60 s):** "Como eu lanço um gasto em 3 segundos" → mostra o
  Telegram → mostra entrando no app → CTA.
- **Antes × depois do processo** (não do dinheiro): planilha bagunçada × tela
  do app. Nunca "antes eu tinha R$ X, depois R$ Y".
- **Bastidor do fundador:** "Construí um app porque eu mesmo chegava no fim do
  mês sem saber pra onde foi o dinheiro" — rosto, celular na mão, 20–40 s.
- **Mito × verdade:** "Mito: controle financeiro dá trabalho" → Telegram.
- **POV / meme:** "POV: é dia 25 e o app já tinha te avisado" (cuidado para
  não virar só humor sem produto).

## Carrossel (7 lâminas)

1. **Capa:** promessa ou pergunta forte + elemento visual (número grande).
2. **Dor:** o problema em uma frase.
   3–5. **Conteúdo útil:** 3 passos/dicas que funcionam mesmo sem o app.
3. **Como o app faz isso por você:** 1 tela real.
4. **CTA:** "Salva este post" + "7 dias grátis, sem cartão — link na bio".

Ideias: "3 sinais de que o seu dinheiro vai apertar este mês", "Quanto separar
por mês para a viagem dos sonhos", "Reserva de emergência: quanto é o seu
número", "Por que planilha não funciona pra você (e o que funciona)".

## Post único

Título forte (6–9 palavras), um subtítulo, no máximo 8 itens com ícone e um CTA.
Gere com `marketing/ferramentas/post.js`.

## Stories (sequência de venda)

1. Enquete: "Você sabe quanto sobra no fim do mês?" (sim / mais ou menos / não)
2. Dor: "Se respondeu 'mais ou menos', isso é pra você."
3. Tela real do aviso de aperto.
4. Tela do Telegram.
5. CTA com link: "7 dias grátis, sem cartão."

## Banco de ganchos

Dor

- "Chega o dia 20 e você já não sabe pra onde foi o salário?"
- "Pra onde foi o seu dinheiro este mês?"
- "Você abriu a planilha de gastos quantas vezes depois de janeiro?"
- "O app do banco mostra o saldo. Mas e o que ainda vai sair?"

Curiosidade

- "Esse app me avisou 6 dias antes de o dinheiro acabar."
- "Eu lanço meus gastos mandando mensagem no Telegram."
- "Descobri que pagava duas vezes a mesma assinatura."

Desejo

- "Quanto separar por mês para viajar pro Japão em 2 anos?"
- "Quanto você precisa juntar pra viver de renda?"
- "Seu dinheiro inteiro numa tela só."

Inimigo comum

- "Planilha não é controle financeiro. É dever de casa."
- "Cinco apps pra ver o seu próprio dinheiro?"

Bastidor

- "Sou desenvolvedor e criei o app que eu queria usar."
- "Mostrei meu app pra 20 pessoas. A reclamação mais comum foi…"

Prova (só com dado real)

- "N pessoas já testaram. O que elas mais usam é…"
