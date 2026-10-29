#!/usr/bin/env bash
# Põe a vinheta da série (news ou explica, 1,6 s) antes do episódio narrado e
# gera a versão com capa (capa no primeiro quadro e embutida no arquivo).
#
#   marketing/ferramentas/shorts/vinheta.sh <news|explica> <episodio.mp4> <capa.png> <saida-com-capa.mp4>
#
# A vinheta sai de vinheta-<serie>.html (render.js) com o som de
# trilha-vinheta.py, em vinheta-<serie>.mp4. Depois: contagem.js.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
SERIE="$1"; EP="$2"; CAPA="$3"; OUT="$4"
VIN="$AQUI/vinheta-$SERIE.mp4"
ffmpeg -v error -y -loop 1 -framerate 30 -t 0.1 -i "$CAPA" -i "$VIN" -i "$EP" -i "$CAPA" -filter_complex \
  "[0:v]scale=1080:1920,setsar=1,format=yuv420p[c];[1:v]fps=30,scale=1080:1920,setsar=1,format=yuv420p[vv];[2:v]fps=30,setsar=1,format=yuv420p[ve];\
   [1:a]aresample=48000,aformat=channel_layouts=stereo[av];[2:a]aresample=48000,aformat=channel_layouts=stereo[ae];\
   [c][vv][ve]concat=n=3:v=1:a=0[vo];[av][ae]concat=n=2:v=0:a=1,adelay=100:all=1[ao]" \
  -map "[vo]" -map "[ao]" -map 3:v -c:v:0 libx264 -crf 10 -preset medium -c:a aac -b:a 192k -c:v:1 png -disposition:v:1 attached_pic -movflags +faststart "$OUT"
echo "gerado: $OUT"
