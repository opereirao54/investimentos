"""Junta a narração (partes.json de narrar-kokoro.py) à trilha e grava o vídeo.

    python3 marketing/ferramentas/shorts/mixar-narracao.py <pasta-voz> <trilha.wav> <video-sem-audio.mp4> <saida.mp4>

A trilha abaixa sozinha quando a voz fala (sidechaincompress) e o resultado
sai normalizado para ~-15 LUFS com pico abaixo de -2 dBFS.
"""
import json, subprocess, sys
VOZ, TRILHA, VIDEO, SAIDA = sys.argv[1:5]
partes = json.load(open(f'{VOZ}/partes.json'))
args = ['ffmpeg', '-y', '-loglevel', 'error', '-i', VIDEO, '-i', TRILHA]
for p in partes:
    args += ['-i', p[1]]
fil = []
for i, p in enumerate(partes):
    ms = int(p[0] * 1000)
    fil.append(f'[{i+2}:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=90,'
               f'acompressor=threshold=0.12:ratio=3:attack=5:release=80,adelay={ms}|{ms}[v{i}]')
fil.append(''.join(f'[v{i}]' for i in range(len(partes))) + f'amix=inputs={len(partes)}:normalize=0,volume=1.6,apad[voz]')
fil.append('[voz]asplit[vozA][vozB]')
fil.append('[1:a]lowpass=f=13000,volume=0.62[mus]')
fil.append('[mus][vozA]sidechaincompress=threshold=0.04:ratio=6:attack=25:release=350:makeup=1[musd]')
fil.append('[musd][vozB]amix=inputs=2:normalize=0:duration=first,'
           'loudnorm=I=-15:TP=-2:LRA=11,alimiter=limit=0.75:level=disabled[a]')
args += ['-filter_complex', ';'.join(fil), '-map', '0:v', '-map', '[a]', '-c:v', 'copy',
         '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', SAIDA]
subprocess.run(args, check=True)
print('gerado:', SAIDA)
