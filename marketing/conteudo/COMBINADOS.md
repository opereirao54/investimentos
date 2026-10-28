# Combinados com o fundador (marketing e redes)

Fonte única do que já foi decidido. Ler antes de produzir qualquer peça e
lembrar o fundador do que estiver pendente. Atualizar quando um combinado
mudar (com a data).

> **Datas sempre no horário de Brasília.** Antes de dizer "hoje" ou "amanhã",
> rodar `TZ=America/Sao_Paulo date '+%A %d/%m %H:%M'` e conferir o dia da
> semana e a data no `CALENDARIO.md`. O relógio do servidor é UTC e vira o
> dia 3 horas antes do Brasil (erro de 26/10: o fundador ainda estava na
> segunda e o pacote mandado foi o de quarta).

## Série até o lançamento (aprovada em 25/10/2026)

- **Lançamento:** sábado, **02/01/2027**. Calendário em `CALENDARIO.md` (PDF
  simples gerado dele com `node marketing/conteudo/gerar-pdf.js`).
- **Ritmo:** **3 Reels por semana** (seg, qua, sex) de 26/10 a 26/12 e **todo
  dia** de 27/12 a 02/01 (os 7 vídeos de produto prontos). 34 Reels: 12
  prontos e 22 novos.
- **Stories todo dia.** A **contagem regressiva** (o vídeo de suspense
  "relógio", 6–8 s, sem narração: o número anterior vira o do dia, "Algo novo
  em 2027.", espaço para o adesivo "Lançamento Appliquei", 02/01/2027, 00:00)
  sai **só nos marcos de 10 em 10 dias** e **todo dia na última semana**
  (fundador, 27/10): faltam **58 (qui 05/11), 48 (dom 15/11), 38 (qua 25/11),
  28 (sáb 05/12), 18 (ter 15/12)** e de **7 a 1 (26/12 a 01/01)**, com "É
  hoje" em 02/01. No relógio de marco, o número anterior é o do marco
  passado (68 → 58, 58 → 48…). Nos outros dias, os stories são só os de
  interação (enquete, caixa, quiz) e o repost do Reel. As **pistas de sábado**
  saem como story de imagem (`capa.js`). Gerar o relógio com
  `marketing/ferramentas/shorts/relogio.js`.
- **Selo "Faltam X dias"** em todo Reel (`contagem.js`) e linha "⏳ Faltam X
  dias…" na legenda.
- **Até 26/12 o app não aparece.** Pistas falam do que a pessoa vai sentir,
  nunca de telas. Sem urgência ou escassez inventadas (CONAR).
- **Reel #2 (qua 28/10) é o "Parcelado ou à vista?"**; o das tarifas foi para
  seg 23/11 (trocados a pedido do fundador em 25/10).

## Produção e entrega

- **Lembrete diário** (tarefa agendada `trig_019vXHyXmHucriBQz9u1PASR`, 9h56,
  horário de Brasília): produz e manda o pacote do dia seguinte e lembra os
  pendentes. Desligar depois de 02/01/2027.

- **Um dia por vez:** cada dia se produz só o pacote do dia seguinte.
- **Pacote para quem posta:** um **bloco de texto por postagem**, pronto para
  copiar e encaminhar, **sem nome de arquivo** (chamar a imagem/vídeo pelo que
  mostra), com **horário**, passo a passo, **legenda e hashtags** (stories
  também levam 2–3 hashtags). Mandar os arquivos junto.
- **Três redes, o mesmo vídeo e a mesma capa** (arquivo original, nunca o
  baixado de outra rede com marca d'água). O Reel vai para **Instagram,
  TikTok e YouTube Shorts**, com um bloco de texto para cada rede:
  - **Instagram:** legenda completa, 5 hashtags, capa pela galeria, CTA "ativa
    o lembrete nos stories". Stories só no Instagram.
  - **TikTok:** legenda curta (gancho + regra em 1–2 frases + CTA "segue pra
    não perder"), 4–5 hashtags, capa = primeiro quadro.
  - **YouTube Shorts:** título de até 100 caracteres com a pergunta do gancho
    e `#shorts`, descrição curta com a regra, aviso e 3–4 hashtags, CTA
    "inscreva-se"; capa = primeiro quadro (escolher no app do YouTube).
- **Horários (fundador, 26/10): os mesmos nas três redes.** Story 8h30 e
  12h30 (Instagram), **Reel às 19h no Instagram, TikTok e YouTube Shorts**,
  repost no story 19h30. Ajustar pelas estatísticas de cada rede depois de 3
  semanas.
- Guia diário com os arquivos: `publicar/LEIAME.md`; arquivos em `publicar/`.

## Como os vídeos são feitos

- **Voz:** sempre a **Charon** (Gemini TTS). Regravar o roteiro inteiro num
  pedido só (frase emendada muda volume e tom). Trocar palavras que o TTS
  confunde no contexto ("caro" num vídeo sobre "carro" → "pesa no bolso").
- **Personagens:** sempre **Caio e Mateus**, fictícios. **Mateus é sempre o
  mau exemplo; Caio, o bom.** (Vale para vídeos novos desde 23/10.)
- **Formato que funciona:** "conta na tela", educativo primeiro, situação do
  dia a dia, conta que surpreende, regra de bolso, Mateus × Caio, didático.
  Ideias rejeitadas: repetir o tema "pagar antes com desconto", queda de 50%
  (não é do dia a dia), cheque especial, horas de trabalho, álcool ou
  gasolina.
- **Assunto da semana (fundador, 28/10):** quando houver notícia em alta,
  o Reel pode trocar de tema para pegá-la, desde que seja **popular** (pão,
  mercado, cartão) e **apartidário**. Abertura com **manchetes reais
  recriadas no visual da marca** (texto, veículo e data como publicados, sem
  print, logo ou foto do veículo), **sem rosto de político nem nome de
  partido**: o Instagram não recomenda conteúdo político a quem não segue a
  conta. Primeiro: "O dólar disparou. E o seu pãozinho?" (qui 29/10, antecipado da sexta).
- **Capa** com a frase do gancho em todo vídeo (`capa.js`), na capa e no
  primeiro quadro (`appliquei-<tema>-com-capa.mp4`).
- **Números conferidos com fonte** antes de gravar; aviso educacional e
  "Personagens fictícios" no fim; nada de recomendação (CVM).

## Pendentes (lembrar o fundador)

- **Métricas:** pedir os números de cada Reel no dia seguinte (visualizações,
  retenção, salvamentos, compartilhamentos) e anotar no calendário. Revisão
  dos temas em **16/11**.
- **Tarifas do banco (23/11):** renderizar de novo antes de postar (o mp4
  ainda diz "Em 66 dias"; o `video.html` já diz 40).
- **Carteira sugerida:** trocar a cena "conta aberta" por "O próximo aporte,
  com o cálculo à vista" (o fundador deixou para depois) e resolver a
  pendência CVM antes de usar.
- **Adiados pelo fundador:** Jornada em vídeos longos; postagem automática
  pela API do Instagram.
- **Mascote Pingo** (`marketing/mascote/`, criado em 28/10): o fundador
  ainda decide se aprova e quando estreia (sugestão: semana do lançamento).
- **Os 12 vídeos prontos** ganham o selo "Faltam X dias" na véspera de cada um.
