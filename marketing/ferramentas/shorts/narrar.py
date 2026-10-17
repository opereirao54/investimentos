"""Narração offline para o Shorts, com o Piper, no tempo de cada cena.

    pip install piper-tts
    python3 marketing/ferramentas/shorts/narrar.py <pasta> [roteiro.json] [--trilha]

Gera <pasta>/narracao.wav (30 s, 48 kHz). Cada fala entra no seu "inicio" e
é acelerada um pouco, se preciso, para caber até o "fim" (sem passar de 1,28×,
para não virar voz de esquilo). --trilha põe um acorde suave e baixo de fundo.

A voz baixada é a pt-br-edresson-low (GitHub do Piper; o Hugging Face, onde
estão as vozes melhores, costuma ficar bloqueado na nuvem). Ela é robótica:
serve para conferir ritmo e roteiro. Para o post final, grave a voz ou use o
"texto para fala" do CapCut com o mesmo roteiro.
"""
import json
import os
import subprocess
import sys
import tarfile
import urllib.request
import wave

AQUI = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
pasta = os.path.abspath(args[0] if args else 'shorts-saida')
roteiro = json.load(open(args[1] if len(args) > 1 else os.path.join(AQUI, 'roteiro.json')))
trilha = '--trilha' in sys.argv
os.makedirs(pasta, exist_ok=True)

VOZES = os.path.join(os.path.expanduser('~'), '.cache', 'appliquei-piper')
modelo = os.path.join(VOZES, roteiro.get('voz', 'pt-br-edresson-low') + '.onnx')
if not os.path.exists(modelo):
    os.makedirs(VOZES, exist_ok=True)
    url = 'https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-pt-br-edresson-low.tar.gz'
    arq = os.path.join(VOZES, 'voz.tar.gz')
    urllib.request.urlretrieve(url, arq)
    with tarfile.open(arq) as t:
        t.extractall(VOZES)


def duracao(f):
    with wave.open(f) as w:
        return w.getnframes() / w.getframerate()


partes = []
for i, fala in enumerate(roteiro['falas']):
    janela = fala['fim'] - fala['inicio'] - 0.1
    escala = 0.92
    f = os.path.join(pasta, f'_fala{i}.wav')
    for _ in range(6):
        subprocess.run([sys.executable, '-m', 'piper', '-m', modelo, '-f', f, '--length-scale', str(escala),
                        '--sentence-silence', '0.12'], input=fala['texto'].encode(), check=True, capture_output=True)
        d = duracao(f)
        if d <= janela or escala <= 0.78:
            break
        escala = max(0.78, escala * janela / d * 0.98)
    partes.append((fala['inicio'], f))
    aviso = '' if d <= janela else '  (passa do fim da cena — encurte o texto)'
    print(f'fala {i}: {d:.2f}s de {janela:.2f}s{aviso}')

dur = max(f['fim'] for f in roteiro['falas'])
entradas, filtros = [], []
for i, (ini, f) in enumerate(partes):
    entradas += ['-i', f]
    ms = int(ini * 1000)
    filtros.append(f'[{i}:a]aresample=48000,highpass=f=90,'
                   f'acompressor=threshold=-20dB:ratio=3:attack=5:release=80,adelay={ms}|{ms}[v{i}]')
n = len(partes)
filtros.append(''.join(f'[v{i}]' for i in range(n)) +
               f'amix=inputs={n}:normalize=0,apad=whole_dur={dur},atrim=0:{dur},loudnorm=I=-16:TP=-1.5:LRA=7[voz]')
saida_rotulo = '[voz]'
if trilha:
    pad = ("aevalsrc='0.10*sin(2*PI*130.81*t)+0.08*sin(2*PI*164.81*t)+0.07*sin(2*PI*196*t)"
           f"+0.05*sin(2*PI*246.94*t)+0.04*sin(2*PI*261.63*t)*(0.6+0.4*sin(2*PI*0.25*t))':s=48000:d={dur}")
    entradas += ['-f', 'lavfi', '-i', pad]
    filtros.append(f'[{n}:a]lowpass=f=900,volume=0.22,afade=t=in:d=1.2,afade=t=out:st={dur - 1.7}:d=1.7[pad]')
    filtros.append('[voz][pad]amix=inputs=2:normalize=0,alimiter=limit=0.95[final]')
    saida_rotulo = '[final]'
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error'] + entradas +
               ['-filter_complex', ';'.join(filtros), '-map', saida_rotulo, '-ar', '48000', '-ac', '2',
                os.path.join(pasta, 'narracao.wav')], check=True)
for _, f in partes:
    os.remove(f)
print('gerado:', os.path.join(pasta, 'narracao.wav'))
