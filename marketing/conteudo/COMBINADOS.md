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
- **Duas séries fixas (fundador, 29/10), só Reels:**
  - **Appliquei Explica** (seg, qua e sex): o dinheiro do dia a dia (gastos
    invisíveis, cartão, reserva, metas), no formato Mateus × Caio com a conta
    na tela. Os temas do `CALENDARIO.md` são desta série. Selo verde "Appliquei
    Explica" no topo (renomeada de "Conta de Padaria" em 29/10: soava
    infantil). Vinheta verde (`vinheta.sh explica`) e capa verde (`"explica":
true`), mesmo modelo do News.
  - **Appliquei News** (ter e qui): a notícia econômica do momento traduzida
    para o bolso (Selic, dólar, inflação, gasolina, financiamento, eleição,
    Black Friday, 13º). Tema escolhido **na véspera**, pela notícia mais
    quente; abertura com manchetes reais recriadas no visual da marca; 30 a
    45 s. Tarja vermelha "APPLIQUEI NEWS" no topo e **vinheta de 1,6 s** na
    abertura (`ferramentas/shorts/vinheta.sh news`); capa com `"news": true`. Apartidário e sem
    recomendação: explicar o mecanismo ("com juros menores, a renda fixa
    rende menos e muita gente olha outros investimentos"), nunca "invista em
    X" (CVM). O Reel do dólar (qui 29/10) conta como **News #1**.
  - Começam na **segunda 02/11**: 5 Reels por semana até 26/12 e **todo dia**
    de 27/12 a 02/01 (os 7 vídeos de produto prontos). Sexta 30/10: o carro
    (Appliquei Explica), antecipado de 02/11.
  - **Série "Appliquei"** (reta final, 27/12 a 02/01, todo dia): os vídeos de
    produto. Nome do fundador (29/10). **Capa: faixa dourada metálica com a
    logo e selo de ouro "FALTAM X DIAS"** (opção 3, escolhida pelo fundador e
    o sócio em 29/10; `capa.js` com `"appliquei": true` e `"aviso"`; em 02/01,
    "É HOJE"). **Vinheta do dia:** `vinheta-appliquei.sh <dias>` gera
    `vinheta-appliquei-<dias>.mp4`; montar com `vinheta.sh appliquei-<dias>`.
  - **Até o lançamento, pouca ferramenta:** as duas séries educam; o app só
    aparece de 26/12 em diante.
- **Sem stories (fundador, 29/10: "só reels").** Acabam a enquete, a caixa, o
  quiz, o repost, as pistas de sábado e o story "relógio" de contagem. A
  contagem fica só no selo do Reel e na legenda. (`relogio.js` fica guardado
  caso os stories voltem.)
- **Selo "Faltam X dias"** em todo Reel (`contagem.js`) e linha "⏳ Faltam X
  dias…" na legenda, com o CTA "Segue pra não perder" (não há mais lembrete
  nos stories).
- **Até 26/12 o app não aparece.** Pistas falam do que a pessoa vai sentir,
  nunca de telas. Sem urgência ou escassez inventadas (CONAR).
- **Reel #2 (qua 28/10) é o "Parcelado ou à vista?"**; o das tarifas foi para
  seg 23/11 (trocados a pedido do fundador em 25/10).

## Produção e entrega

- **Lembrete diário** (tarefa agendada `trig_019vXHyXmHucriBQz9u1PASR`, 9h56,
  horário de Brasília): produz e manda o pacote do dia seguinte e lembra os
  pendentes; na véspera do News, propõe as pautas do dia. Prompt atualizado em
  29/10 para "só Reels". Desligar depois de 02/01/2027.

- **Um dia por vez:** cada dia se produz só o pacote do dia seguinte.
- **Pacote para quem posta:** um **bloco de texto por postagem**, pronto para
  copiar e encaminhar, **sem nome de arquivo** (chamar a imagem/vídeo pelo que
  mostra), com **horário**, passo a passo, **legenda e hashtags**. Mandar os arquivos junto.
- **Três redes, o mesmo vídeo e a mesma capa** (arquivo original, nunca o
  baixado de outra rede com marca d'água). O Reel vai para **Instagram,
  TikTok e YouTube Shorts**, com um bloco de texto para cada rede:
  - **Instagram:** legenda completa, 5 hashtags, capa pela galeria, CTA "segue pra
    não perder".
  - **TikTok:** legenda curta (gancho + regra em 1–2 frases + CTA "segue pra
    não perder"), 4–5 hashtags, capa = primeiro quadro.
  - **YouTube Shorts:** título de até 100 caracteres com a pergunta do gancho
    e `#shorts`, descrição curta com a regra, aviso e 3–4 hashtags, CTA
    "inscreva-se"; capa = primeiro quadro (escolher no app do YouTube).
- **Horários (fundador, 26/10): os mesmos nas três redes.** **Reel às 19h no
  Instagram, TikTok e YouTube Shorts.** Sem stories desde 29/10. Ajustar pelas
  estatísticas de cada rede depois de 3 semanas.
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
- **Padrão de qualidade (fundador, 29/10: "mantenha esse padrão"):** quadros
  em PNG, etapas intermediárias quase sem perda (crf 10) e **uma só
  compressão final** em `contagem.js`, no **perfil C** escolhido pelo fundador
  no teste do Instagram em 29/10 (10 Mbps, sem granulado, nitidez leve nas
  letras, cores BT.709); capas desenhadas em 2x. Um Reel
  de ~1 min fica com ~6 Mbps e ~45 MB. Não voltar para JPEG nem recomprimir
  o vídeo em cada etapa. Quem posta: "Carregar na qualidade mais alta" ligado
  no Instagram.
- **Como o vídeo chega a quem posta (29/10):** nunca pelo WhatsApp como vídeo
  nem pelo álbum compartilhado do iPhone (os dois recomprimem; o álbum reduz
  para 720p). Usar AirDrop, link do Google Drive ou iCloud Drive (arquivo), ou
  WhatsApp como **Documento**. No Instagram, "Carregar na qualidade mais alta"
  ligado; no TikTok, "Permitir upload em alta qualidade".
- **Capa** com a frase do gancho em todo vídeo (`capa.js`), na capa e no
  primeiro quadro (`appliquei-<tema>-com-capa.mp4`).
- **Números conferidos com fonte** antes de gravar; aviso educacional e
  "Personagens fictícios" no fim; nada de recomendação (CVM).

## Métricas (30/10)

- O fundador vê os números na aba **Redes sociais** do admin; eu analiso e
  proponho mudanças seguindo
  `.claude/skills/marketing-saas/referencias/analise-metricas.md`
  (`npm run metricas:instagram`). Uma mudança por vez, registrada em
  `marketing/metricas/LEIAME.md`; a análise propõe, o fundador decide.
- Conexão do Instagram: o fundador cria o app na Meta e gera o token (com o
  sócio, dono do Instagram); `IG_TOKEN` vai no Vercel e se renova sozinho.
  TikTok e YouTube por print até ter conexão.

## Pendentes (lembrar o fundador)

- **Métricas:** pedir os números de cada Reel no dia seguinte (visualizações,
  retenção, salvamentos, compartilhamentos) e anotar no calendário. Revisão
  dos temas em **16/11**.
- **Carteira sugerida:** trocar a cena "conta aberta" por "O próximo aporte,
  com o cálculo à vista" (o fundador deixou para depois) e resolver a
  pendência CVM antes de usar.
- **Adiados pelo fundador:** Jornada em vídeos longos; postagem automática
  pela API do Instagram.
- **Mascote: Appli** (28/10): moeda verde com "$" no peito, luvas e tênis,
  imagem gerada pelo fundador (`marketing/mascote/appli/`). O Appli
  **falando e se mexendo sai de graça no Hugging Face** (Wan 2.2, ZeroGPU;
  29/10: `appli-se-apresenta-sala.mp4`, 22 s na sala de estar, voz Charon).
  A cota grátis rende um fundo e umas 6 cenas de até 5 s por dia; nada pago
  (o fundador quer grátis). Falta decidir quando estreia (sugestão: semana do
  lançamento). O Pingo e os ilustrados foram descartados.
- **Os 12 vídeos prontos** ganham o selo "Faltam X dias" na véspera de cada um.
