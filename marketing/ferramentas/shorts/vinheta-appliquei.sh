#!/usr/bin/env bash
# Vinheta do dia da série Appliquei (reta final): FALTAM <dias> DIAS, ou É HOJE
# com 0. Gera vinheta-appliquei-<dias>.mp4 ao lado deste script, para usar com
#   vinheta.sh appliquei-<dias> <episodio.mp4> <capa.png> <saida-com-capa.mp4>
#
#   marketing/ferramentas/shorts/vinheta-appliquei.sh <dias>
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
DIAS="$1"
if [ "$DIAS" = "0" ]; then AVISO="É HOJE"; elif [ "$DIAS" = "1" ]; then AVISO="FALTA 1 DIA"; else AVISO="FALTAM $DIAS DIAS"; fi
TMP="$(mktemp -d)"
python3 - "$AQUI" "$TMP" "$AVISO" <<'PY'
import sys
aqui, tmp, aviso = sys.argv[1:]
logo = open(f'{aqui}/../../../appliquei-wordmark.svg').read().replace('#f0faf4', '#0b1410')
h = open(f'{aqui}/vinheta-appliquei.html').read().replace('{{LOGO}}', logo).replace('{{AVISO}}', aviso)
if aviso == 'É HOJE':
    h = h.replace('Um recurso por dia até o lançamento', 'O lançamento é hoje')
open(f'{tmp}/vinheta.html', 'w').write(h)
PY
node "$AQUI/render.js" "$TMP/r" "$TMP/vinheta.html" | tail -1
python3 "$AQUI/trilha-vinheta.py" "$TMP/som.wav" > /dev/null
ffmpeg -v error -y -i "$TMP/r/video-sem-audio.mp4" -i "$TMP/som.wav" -map 0:v -map 1:a -c:v libx264 -crf 10 -preset medium \
  -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k -ar 48000 -af loudnorm=I=-15:TP=-1.5 -shortest "$AQUI/vinheta-appliquei-$DIAS.mp4"
rm -rf "$TMP"
echo "gerado: $AQUI/vinheta-appliquei-$DIAS.mp4"
