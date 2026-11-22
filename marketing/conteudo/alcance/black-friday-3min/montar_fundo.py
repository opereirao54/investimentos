"""Monta o fundo do Reel: em cada cena, o clipe de IA e, no resto do tempo, a
imagem da cena com zoom lento. Depois a camada (graficos + legenda) vai por cima.

    python3 montar_fundo.py <pasta-dos-clipes> <saida.mp4> [quadros-bons]

<pasta-dos-clipes> tem c1.mp4 a c5.mp4 (um por cena, de ia.py clipe). Clipe do
Hugging Face (bom): use todos os quadros (padrao). Clipe local (rascunho): passe
quadros-bons=33, porque depois do 1o segundo e pouco o rosto deforma.
"""
import json
import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
CLIPES, SAIDA = sys.argv[1], sys.argv[2]
BONS = int(sys.argv[3]) if len(sys.argv) > 3 else 0
T = json.load(open(f'{AQUI}/tempos.json'))
nar, DUR = T['nar'], T['dur']
# cortes: Beto comprando | torre no teto | BIP e torre caindo | Lia | regra e fecho (os dois)
cortes = [0, 6.5, nar[2][0], nar[4][0], nar[5][0] - 0.3, DUR]
# vaivem: o gesto vai e volta e emenda na imagem nitida; segura: fica no ultimo quadro
cenas = [('e1', 'c1', 'vaivem'), ('e2', 'c2', 'vaivem'), ('e3', 'c3', 'segura'), ('e4', 'c4', 'vaivem'), ('e5', 'c5', 'segura')]
LENTO, FPS = 1.35, 30
ESC = 'scale=1098:1920:flags=lanczos,crop=1080:1920,unsharp=5:5:0.5'
TMP = os.path.join(os.path.dirname(os.path.abspath(SAIDA)), 'fundo-partes')
os.makedirs(TMP, exist_ok=True)


def ff(*a):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *a], check=True)


def dur(p):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]))


partes = []
for i, (img, clip, modo) in enumerate(cenas):
    d = cortes[i + 1] - cortes[i]
    mov = f'{TMP}/m{i}.mp4'
    corte = f'trim=end_frame={BONS},' if BONS else ''
    base = (f'[0:v]{corte}setpts=PTS-STARTPTS,setpts={LENTO}*PTS,'
            f'minterpolate=fps={FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,{ESC},format=yuv420p')
    filtro = base + (',split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[v]' if modo == 'vaivem' else '[v]')
    ff('-i', f'{CLIPES}/{clip}.mp4', '-filter_complex', filtro, '-map', '[v]', '-c:v', 'libx264', '-crf', '10', mov)
    dm = min(dur(mov), d)
    if modo == 'vaivem':
        fonte = f'{AQUI}/cenas/{img}.jpg'
    else:
        fonte = f'{TMP}/ult{i}.png'
        ff('-sseof', '-0.05', '-i', mov, '-update', '1', '-frames:v', '1', fonte)
    n = max(1, int(round((d - dm) * FPS)))
    z = (f"scale=1620:-1:flags=lanczos,zoompan=z='1+0.07*on/{n}':x='iw/2-(iw/zoom/2)':"
         f"y='ih/2-(ih/zoom/2)':d={n}:s=1080x1920:fps={FPS},format=yuv420p")
    ff('-i', fonte, '-vf', z, '-frames:v', str(n), '-c:v', 'libx264', '-crf', '10', f'{TMP}/r{i}.mp4')
    ff('-i', mov, '-t', f'{dm:.3f}', '-c:v', 'libx264', '-crf', '10', f'{TMP}/m{i}c.mp4')
    partes += [f'{TMP}/m{i}c.mp4', f'{TMP}/r{i}.mp4']
    print(f'cena {i + 1}: {d:.2f}s = clipe {dm:.2f}s + zoom {d - dm:.2f}s', flush=True)

open(f'{TMP}/lista.txt', 'w').write(''.join(f"file '{p}'\n" for p in partes))
ff('-f', 'concat', '-safe', '0', '-i', f'{TMP}/lista.txt', '-vf', f'fps={FPS},format=yuv420p', '-c:v', 'libx264', '-crf', '10', SAIDA)
print('fundo:', SAIDA, round(dur(SAIDA), 2), 's')
