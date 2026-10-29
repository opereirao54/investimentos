# O Appli na sala de estar: 6 cenas encadeadas no Wan 2.2 (Space gratuito,
# ZeroGPU), cada uma a partir do último quadro da anterior, nos tempos das
# frases da voz Charon. Retoma de onde parou.
#   cd marketing/mascote/appli/ia/sala && bash cenas.sh
set -u
BASE="Pixar-style 3D animation, keep exactly the same green coin mascot design, white gloves and dark green sneakers, same cozy sunny living room, static camera, full body in frame. He talks to the camera, mouth moving naturally as he speaks."
NEG="static, blurry, deformed, extra limbs, extra fingers, text, watermark, camera movement, morphing, new characters"
declare -a DUR=(3.6 3.8 3.1 2.5 3.0 3.4)
declare -a GESTO=(
"The green coin cartoon mascot waves hello enthusiastically with his white-gloved hand, then proudly points to himself with his thumb."
"The green coin cartoon mascot walks two steps toward the camera while talking, gesturing with both open gloved hands, explaining."
"The green coin cartoon mascot jumps up happily raising both gloved fists in the air, celebrating."
"The green coin cartoon mascot shakes his head and crosses his arms, playful expression meaning no."
"The green coin cartoon mascot dances happily side to side, swinging his arms to the rhythm."
"The green coin cartoon mascot gives two thumbs up to the camera and does a small happy hop, cheerful big smile."
)
img=partida-sala.png
for i in 0 1 2 3 4 5; do
  [ -s cena$i.mp4 ] || {
    P="${GESTO[$i]} $BASE"
    timeout 600 python3 -u ../space.py zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space generate_video cena$i.mp4 "$(python3 -c "import json,sys;print(json.dumps(['@'+sys.argv[1], sys.argv[2], 4, sys.argv[3], float(sys.argv[4]), 1, 1, 42, False]))" "$img" "$P" "$NEG" "${DUR[$i]}")" 2>&1 | grep -E "ok|ERRO|download|Traceback|Error" | tail -3
    [ -s cena$i.mp4 ] || { echo "PAROU na cena $i"; exit 1; }
  }
  ffmpeg -y -loglevel error -sseof -0.1 -i cena$i.mp4 -update 1 -frames:v 1 ult$i.png && img=ult$i.png
  echo "cena $i pronta"
done
