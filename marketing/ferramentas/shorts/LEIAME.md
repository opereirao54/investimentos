# Shorts / Reels / TikTok — vídeo vertical a partir de cenas HTML

O primeiro vídeo de venda (30 s, 1080×1920) saiu daqui. Para fazer outro,
copie `video.html`, troque textos e telas e rode os passos abaixo.

## Passo a passo

```bash
# 0. Uma vez: fontes da marca
./marketing/fontes.sh

# 1. Telas reais do app, com dados de demonstração
npm run build
BROWSER=none npx vite preview --port 4173 --strictPort &
node marketing/ferramentas/telas-app.js /tmp/shorts

# 2. (Opcional) narração offline no tempo das cenas
pip install piper-tts
python3 marketing/ferramentas/shorts/narrar.py /tmp/shorts marketing/ferramentas/shorts/roteiro.json --trilha

# 3. Render: quadros → MP4 (e junta a narração se /tmp/shorts/narracao.wav existir)
node marketing/ferramentas/shorts/render.js /tmp/shorts marketing/ferramentas/shorts/video.html
```

Saída: `video-sem-audio.mp4` e, com narração, `video-narrado.mp4`.

## Como o modelo funciona

- Cada cena é um `<div class="cena">`. Os tempos ficam em `CENAS` (id, início,
  fim) e a duração total em `DUR`.
- Elementos com `class="linha"` e `data-in="0.3"` entram sozinhos 0,3 s depois
  do início da cena (sobem e aparecem).
- Movimentos específicos (celular subindo, chat do Telegram, gráfico) ficam em
  `cenaExtra(id, tempoNaCena)`.
- `render(t)` desenha o quadro do segundo `t`; o render tira 30 por segundo,
  então o vídeo é idêntico toda vez.

## Regras de roteiro

Seguir `.claude/skills/marketing-saas/referencias/formatos.md` (estrutura de
30 s, áreas seguras) e o checklist de `voz-e-compliance.md` antes de publicar.

## Limites do ambiente de nuvem

- Vozes online (Microsoft, Google) e o Hugging Face ficam bloqueados; a voz do
  Piper usada aqui é robótica. Para o post final: voz do fundador ou o "texto
  para fala" do CapCut com o mesmo roteiro.
- Sem acesso ao CDN do Chart.js, os gráficos das telas capturadas saem vazios;
  prefira telas sem gráfico grande ou capture fora da nuvem.
