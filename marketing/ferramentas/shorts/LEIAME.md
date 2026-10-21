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

# 2. (Opcional) narração rascunho, offline, no tempo das cenas
pip install piper-tts
python3 marketing/ferramentas/shorts/narrar.py /tmp/shorts marketing/ferramentas/shorts/roteiro.json --trilha

# 3. Render: quadros → MP4 (e junta a narração se /tmp/shorts/narracao.wav existir)
node marketing/ferramentas/shorts/render.js /tmp/shorts marketing/ferramentas/shorts/video.html
```

Saída: `video-sem-audio.mp4` e, com narração, `video-narrado.mp4`.

## Narração padrão da marca: Gemini, voz Charon

A voz oficial dos vídeos é a **Charon** do TTS do Gemini (escolhida pelo
fundador no teaser de lançamento). Precisa de `GEMINI_API_KEY`.

```bash
pip install soundfile numpy praat-parselmouth
python3 marketing/ferramentas/shorts/narrar-gemini.py /tmp/voz            # Charon
python3 marketing/ferramentas/shorts/mixar-narracao.py /tmp/voz trilha.wav video-sem-audio.mp4 final.mp4
```

- Roteiro e tempos ficam em `CENAS` no topo de `narrar-gemini.py` (início, fim,
  texto de cada cena); para um vídeo novo, troque essa lista.
- As perguntas sobem o tom no fim (medido no áudio; se o Gemini ler com o tom
  caindo, a subida é feita por PSOLA). Frase que não cabe na cena é acelerada
  até 1,25x.
- O plano gratuito dá 10 pedidos por dia por modelo; o roteiro inteiro sai num
  pedido. Guarde o `leitura*.wav` da tomada aprovada (a do teaser é
  `marketing/lancamento-janeiro/narracao-charon-leitura.wav`): com
  `LEITURA=<arquivo>` o script refaz cortes e entonação sem gastar cota.
- A mixagem abaixa a trilha sob a voz e sai em ~-15 LUFS, pico abaixo de -2 dBFS.

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

- O TTS do Gemini funciona na nuvem com `GEMINI_API_KEY` (é a voz padrão,
  acima). Hugging Face e as vozes online da Microsoft ficam bloqueados; o Piper
  de `narrar.py` é robótico e serve só de rascunho.
- Sem acesso ao CDN do Chart.js, os gráficos das telas capturadas saem vazios;
  prefira telas sem gráfico grande ou capture fora da nuvem.
