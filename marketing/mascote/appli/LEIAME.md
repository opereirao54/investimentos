# Appli, o mascote escolhido (28/10/2026)

Uma moeda verde com o "$" no peito, luvas brancas e tênis. A imagem
(`referencia.png`) foi gerada pelo fundador e escolhida entre as sugestões
(coruja, robô, camaleão e broto ficaram de fora).

- `conheca-o-appli.mp4`: **a animação** (12 s, 1080×1920, com som): o Appli cai
  e amassa ao pousar, respira, pisca, dança, pula girando como moeda, faz
  joinha ("Seu dinheiro precisa de direção.") e assina com a marca.
- `preparar.py`: recorta o Appli da imagem (rembg) e separa as camadas
  `corpo.png` (moeda, braços e mãos) e `pernas.png` (pernas e tênis), em 2x.
- `video.html`: a animação; a piscada são duas pálpebras desenhadas por cima
  dos olhos. `trilha.py`: marimba em dó maior e os efeitos sincronizados.

Refazer:

    python3 marketing/mascote/appli/preparar.py
    cp marketing/mascote/appli/{corpo,pernas}.png <pasta>/
    node marketing/ferramentas/shorts/render.js <pasta> marketing/mascote/appli/video.html
    python3 marketing/mascote/appli/trilha.py <pasta>/trilha.wav
    ffmpeg -i <pasta>/video-sem-audio.mp4 -i <pasta>/trilha.wav -map 0:v -map 1:a \
      -c:v copy -c:a aac -af loudnorm=I=-16:TP=-1.5 -shortest conheca-o-appli.mp4

**Limite:** a animação mexe a imagem inteira e as duas camadas (não dá para
dobrar o braço ou mudar a boca). Para poses novas (pensando, alerta,
comemorando), gerar novas imagens do Appli no mesmo gerador, com o mesmo
prompt de personagem, e recortar com `preparar.py`.

Personalidade: a voz da marca (calmo, direto, faz a conta com você); nunca
promete ganho nem indica investimento (CVM e CONAR).
