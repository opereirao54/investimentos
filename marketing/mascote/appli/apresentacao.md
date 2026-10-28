# Appli se apresentando: roteiro, voz e como animar

O fundador quer o Appli "vivo como uma pessoa" (falando, com boca,
expressão e gestos). Com uma imagem parada só dá para mexer o boneco inteiro
(`conheca-o-appli.mp4` ficou "desenho no papel"); fala e gesto de verdade
saem de uma IA de vídeo que anima o personagem a partir da imagem e do áudio.

## Roteiro (cerca de 19 s)

> Oi! Eu sou o Appli. A moedinha do Appliquei. Meu trabalho? Te ajudar a ver
> pra onde vai cada real… e transformar organização em conquista. Sem
> planilha, sem complicação. Porque o seu dinheiro precisa de direção. A gente
> se vê no dia 2 de janeiro. Bora junto?

## Arquivos

- `appli-vertical.png`: o Appli em 1080×1920 no fundo da marca (para subir).
- `voz/apresentacao-puck.mp3`: voz Puck, mais leve e animada (personagem).
- `voz/apresentacao-charon.mp3`: voz Charon, a mesma dos Reels.

## Como animar (gerar fora daqui)

1. **Hedra** (hedra.com, personagem falando com sincronia labial): suba
   `appli-vertical.png` e o áudio escolhido. Texto de apoio: _friendly
   cartoon coin mascot talking to the camera like a TV host, expressive
   eyebrows, natural head movement, warm smile, keeps the exact same design._
2. **Kling** ou **Veo** (no app do Gemini), imagem para vídeo, para os
   gestos: suba a imagem e use o prompt:
   _The green coin mascot comes alive and introduces himself to the camera
   like a friendly TV host: waves hello, talks with natural lip movement,
   raises his eyebrows, points to himself with his thumb when he says his
   name, gives a thumbs up at the end and does a small happy hop. Smooth
   Pixar-style 3D animation. Keep exactly the same character design, colors
   and dark green background. Static camera, vertical 9:16._
3. Mandar o vídeo gerado: aqui entram legenda, trilha, logo e o selo
   "Faltam X dias", com as versões para Instagram, TikTok e Shorts.

Pela API do Gemini daqui, imagem e vídeo (Veo) não têm cota grátis (limite 0
em 28/10/2026); com o faturamento ativado, dá para gerar por aqui.

## Gerado de graça no Hugging Face (28/10/2026)

O Appli falando e gesticulando sai do **Wan 2.2** (Space gratuito
`zerogpu-aoti/wan2-2-fp8da-aoti-faster`, GPU ZeroGPU), a partir de
`ia/appli-480.png`. Pelo proxy da nuvem, o `gradio_client` falha ("session not
found"): `ia/space.py` faz upload, fila e download numa conexão só.

- `ia/cena0.mp4` + `previa-ola.mp4`: **pronto**, acena com a boca mexendo
  ("Oi! Eu sou o Appli. A moedinha do Appliquei.", com a voz Charon).
- `ia/cenas.sh`: gera as outras 5 cenas, cada uma a partir do último quadro
  da anterior (dá de ombros e aponta · punho erguido · "não" com o dedo ·
  aponta confiante · joinha e pulinho), nos tempos das frases da voz Charon.
  Retoma de onde parou.
- **Limite:** a conta gratuita tem poucas gerações de GPU por dia; ao bater
  ("ZeroGPU runs limit"), esperar até 24 h e rodar `cenas.sh` de novo. A boca
  mexe enquanto ele fala, mas não é sincronia labial exata (isso exigiria
  FantasyTalking, que pede mais GPU do que a conta gratuita permite).
- Depois das 6 cenas: juntar, subir para 1080×1920 a 30 fps, pôr a voz Charon,
  legenda na tela, marca no fim e selo "Faltam X dias".
