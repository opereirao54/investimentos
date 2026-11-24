#!/usr/bin/env bash
# Montagem final do News no padrão da Appliquei (vinheta.sh + contagem.js, sem Playwright):
#   [capa 0,1 s] [episódio até o fim do gancho] [vinheta-news.mp4 1,6 s] [resto do episódio]
# + capa embutida (attached_pic) + a única compressão final no perfil C do contagem.js.
# O selo "Faltam X dias" já vem desenhado no HTML (mesmo CSS e posição do contagem.js).
#
#   ./juntar.sh <episodio-mixado.mp4> <saida.mp4>        (VINHETA=0 para sair sem vinheta)
#
# <episodio-mixado.mp4>: render do HyperFrames já com narração + trilha (capa nos últimos 0,7 s).
set -euo pipefail
AQ="$(cd "$(dirname "$0")" && pwd)"
EP="$1"; OUT="$2"
VIN="$AQ/../../../../"marketing/ferramentas/shorts/vinheta-news.mp4
CORTE=$(python3 -c "import json;print(json.load(open('$AQ/video/corte.json'))['corte'])")
CAPA="${OUT%.mp4}-capa.png"
# capa = último quadro do episódio (a capa capa.js "news" desenhada no fim do HTML)
ffmpeg -v error -y -sseof -0.05 -i "$EP" -frames:v 1 -update 1 "$CAPA"
NORM="fps=30,scale=1080:1920,setsar=1,format=yuv420p"
AUD="aresample=48000,aformat=channel_layouts=stereo"
if [ "${VINHETA:-1}" = 1 ]; then
  FC="[0:v]$NORM[c];[1:v]$NORM,split[e1][e2];[e1]trim=0:$CORTE,setpts=PTS-STARTPTS[va];[e2]trim=start=$CORTE,setpts=PTS-STARTPTS[vb];[2:v]$NORM[vv];
      [1:a]$AUD,asplit[x1][x2];[x1]atrim=0:$CORTE,asetpts=PTS-STARTPTS[aa];[x2]atrim=start=$CORTE,asetpts=PTS-STARTPTS[ab];[2:a]$AUD[av];
      [c][va][vv][vb]concat=n=4:v=1:a=0[vo];[aa][av][ab]concat=n=3:v=0:a=1,adelay=100:all=1[ao]"
else
  FC="[0:v]$NORM[c];[1:v]$NORM[ve];[c][ve]concat=n=2:v=1:a=0[vo];[1:a]$AUD,adelay=100:all=1[ao]"
fi
# perfil C (contagem.js, 29/10): nitidez leve, BT.709, 10 Mbps, preset slow, tune animation
ffmpeg -v error -y -loop 1 -framerate 30 -t 0.1 -i "$CAPA" -i "$EP" -i "$VIN" -i "$CAPA" -filter_complex \
  "$FC;[vo]unsharp=5:5:0.4:5:5:0,scale=out_color_matrix=bt709,format=yuv420p[vf]" \
  -map "[vf]" -map "[ao]" -map 3:v \
  -c:v:0 libx264 -b:v 10M -minrate 8M -maxrate 12M -bufsize 20M -preset slow -tune animation \
  -profile:v:0 high -level:v:0 4.2 -g:v:0 60 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 192k -c:v:1 png -disposition:v:1 attached_pic -movflags +faststart "$OUT"
echo "gerado: $OUT e $CAPA (corte da vinheta em ${CORTE}s)"
