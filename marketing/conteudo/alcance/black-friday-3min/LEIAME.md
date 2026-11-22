# "O Beto tem 3 minutos de Black Friday" (44,7 s) · Appliquei News

Reel de **qua 25/11/2026** (faltam 38). Tema aprovado pelo fundador em 22/11.
Primeiro Reel com **personagens 3D estilo Pixar** e **clipes de IA**.

- **Premissa:** o Beto ganha R$ 3.000 e tem 3 minutos de Black Friday. Gancho:
  "Quanto você acha que ele gasta?". Virada: **R$ 3.508**, mais que o salário,
  sem nenhum item acima de R$ 400. A Lia levou 1 item, que estava na lista.
- **A conta (valores de exemplo):** 249 + 159 + 349 + 279 + 399 + 189 + 329 +
  399 + 219 + 289 + 349 + 299 = R$ 3.508 (R$ 508 acima do salário).
- **Voz:** Lia com Sulafat (roteiro em um pedido só) e Beto com Charon ("Mas
  era tudo oferta?!"). A Sulafat lê "Appliquei" como "Aplique": no roteiro de
  voz está "Apliquêi" (soa "Aplicaí", como na narração aprovada da Charon); a
  legenda usa `narracao.json`, com a grafia certa.

## Estado em 22/11

Pronto: narração, trilha, camada transparente (`camada.html`: relógio, contador,
12 ofertas, BIP, barra salário × gasto, "1 item", regra de bolso, comentários
de palpite, assinatura; legenda leve sincronizada) e as 5 imagens das cenas
(`cenas/e1` a `e5`, editadas a partir de `marketing/personagens/beto-lia-3d.png`
para manter os mesmos rostos). Falta: os 5 clipes (a cota grátis do Hugging
Face acabou em 22/11; renova 24 h após o 1º uso, ~7h de 23/11).

| Cena | Tempo        | Imagem | Clipe (prompt)                                                                                                   |
| ---- | ------------ | ------ | ---------------------------------------------------------------------------------------------------------------- |
| 1    | 0 – 6,5 s    | e1     | c1: the excited man taps his smartphone quickly, big smile, cardboard boxes appear and pile up behind the sofa   |
| 2    | 6,5 – 16,3 s | e2     | c2: he keeps tapping the phone with a huge smile while the very tall stack of boxes behind him wobbles           |
| 3    | 16,3 – 23,6  | e3     | c3: boxes keep tumbling down around the dazed man; he presses his hand on his forehead, shocked, mouth wide open |
| 4    | 23,6 – 31,8  | e4     | c4: the woman smiles calmly at the camera and nods, holding one small box on her lap                             |
| 5    | 31,8 – 44,7  | e5     | c5: the woman smiles and turns to look at the man; the man with headphones sighs and his shoulders drop          |

Começar cada prompt com "Pixar-style 3D animation." e terminar com "Static
camera, same character(s), same room."

## Montar (amanhã)

```bash
D=marketing/conteudo/alcance/black-friday-3min; O=/tmp/bf; mkdir -p $O/clipes
# 1. clipes (Hugging Face primeiro; o ia.py cai no local se a cota faltar)
python3 marketing/ferramentas/ia-video/ia.py clipe $D/cenas/e1.jpg "<prompt c1>" $O/clipes/c1.mp4 --segundos 5
#    ... c2 a c5 (5 clipes de 5 s cabem nos 300 s grátis do dia, ~50 s cada)
# 2. camada transparente (gráficos + legenda), se mudar algo no camada.html
CAMADA=1 LEGENDA=$D/legenda.json LEGENDA_ESTILO=leve LEGENDA_Y=1415 \
  node marketing/ferramentas/shorts/render.js $O/camada $D/camada.html
# 3. fundo (clipes + zoom) e camada por cima
python3 $D/montar_fundo.py $O/clipes $O/fundo.mp4        # clipes locais: acrescente 33
ffmpeg -i $O/fundo.mp4 -framerate 30 -i $O/camada/quadros/%05d.png \
  -filter_complex "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]" -map "[v]" -crf 12 $O/sem-audio.mp4
# 4. vozes: refaz os cortes da leitura salva sem gastar cota e mixa com a trilha
ROTEIRO=$D/roteiro-lia.json LEITURA=$D/narracao-sulafat-lia-leitura.wav \
  python3 marketing/ferramentas/shorts/narrar-gemini.py $O/voz-lia Sulafat
ROTEIRO=$D/roteiro-beto.json LEITURA=$D/narracao-charon-beto-leitura.wav \
  python3 marketing/ferramentas/shorts/narrar-gemini.py $O/voz-beto Charon
#    partes.json com as 7 falas nos tempos de tempos.json (Lia 0-2, Beto, Lia 3-5)
python3 marketing/ferramentas/shorts/mixar-narracao.py $O/voz $D/trilha.wav $O/sem-audio.mp4 $O/narrado.mp4
# 5. selo e compressão final
node marketing/ferramentas/shorts/contagem.js $O/narrado.mp4 38 marketing/conteudo/publicar/12-25-11-black-friday-3min.mp4
```

**Antes de postar:** marcar "conteúdo de IA" nas três redes (personagens 3D
gerados por IA). 44,7 s: no limite dos 45 s do News.

**O que medir:** taxa de pulados e curva dos 3 primeiros segundos (o relógio e
o contador correm desde o quadro 0), comentários com palpite e compartilhamentos;
comparar com a gasolina (12,5 s, 35%) e com a Black Friday de 16/11 (3,3 s).
