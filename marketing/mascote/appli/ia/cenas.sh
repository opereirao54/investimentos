# Gera os 6 clipes do Appli se apresentando no Wan 2.2 (Space gratuito do
# Hugging Face, ZeroGPU), cada um a partir do último quadro do anterior.
# Rodar de dentro desta pasta com HF_TOKEN; retoma de onde parou.
#   cd marketing/mascote/appli/ia && bash cenas.sh
set -u
BASE="Pixar-style 3D animation, keep exactly the same green coin mascot design, white gloves and sneakers, dark green background, static camera, full body in frame. He talks to the camera, mouth moving naturally as he speaks."
NEG="static, blurry, deformed, extra limbs, extra fingers, text, watermark, camera movement, morphing"
declare -a DUR=(3.6 3.8 3.1 2.5 3.0 3.4)
declare -a GESTO=(
"The green coin cartoon mascot waves hello to the camera with his white-gloved hand, smiles, then points to himself with his thumb proudly."
"The green coin cartoon mascot shrugs with both hands open as if asking a question, then points forward at the camera with his gloved index finger, explaining."
"The green coin cartoon mascot raises his gloved fist in the air in celebration, excited, big smile."
"The green coin cartoon mascot shakes his head and wags his gloved index finger side to side meaning no, playful expression."
"The green coin cartoon mascot points forward confidently with his gloved hand, determined and friendly face."
"The green coin cartoon mascot gives a big thumbs up to the camera and does a small happy hop, cheerful."
)
img=appli-480.png
for i in 0 1 2 3 4 5; do
  [ -s cena$i.mp4 ] || {
    P="${GESTO[$i]} $BASE"
    timeout 600 python3 -u space.py zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space generate_video cena$i.mp4 "$(python3 -c "import json,sys;print(json.dumps(['@'+sys.argv[1], sys.argv[2], 4, sys.argv[3], float(sys.argv[4]), 1, 1, 42, False]))" "$img" "$P" "$NEG" "${DUR[$i]}")" 2>&1 | grep -E "ok|ERRO|download|Traceback|Error" | tail -3
    [ -s cena$i.mp4 ] || { echo "PAROU na cena $i"; exit 1; }
  }
  ffmpeg -y -loglevel error -sseof -0.1 -i cena$i.mp4 -update 1 -frames:v 1 ult$i.png && img=ult$i.png
  echo "cena $i pronta"
done
