"""Narração do teaser de lançamento com Kokoro (voz pm_alex, a escolhida pelo
fundador), no tempo das cenas de marketing/lancamento-janeiro/teaser-lancamento-31s.html,
e limpeza de ruído de cada frase.

    pip install kokoro-onnx soundfile
    # modelo e vozes (uma vez): kokoro-v1.0.onnx e voices-v1.0.bin em ~/.cache/appliquei-kokoro/
    python3 marketing/ferramentas/shorts/narrar-kokoro.py <pasta-saida> [voz]
    python3 marketing/ferramentas/shorts/mixar-narracao.py <pasta-saida> trilha.wav video-sem-audio.mp4 final.mp4

Cada frase começa em `ini` e precisa caber até `fim`; se não couber, a fala é
acelerada aos poucos (até 1,35x). Limpeza: corta o silêncio das pontas,
passa-alta 85 Hz, passa-baixa 9,5 kHz, redução de ruído (afftdn), remove
estalos (adeclick) e suaviza a entrada e a saída.
"""
import os
import json, subprocess, sys
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

OUT = sys.argv[1]
VOZ = sys.argv[2] if len(sys.argv) > 2 else 'pm_alex'
CENAS = [
    (0.25, 3.9, "Você sabe quanto realmente tem?"),
    (4.25, 8.8, "Você trabalha, recebe seu dinheiro... mas sabe para onde ele está indo?"),
    (9.1, 10.4, "Quanto você gasta?"),
    (10.42, 11.62, "Quanto já acumulou?"),
    (11.66, 13.9, "E como estão seus investimentos?"),
    (14.45, 22.3, "Com o Appliquei, você organiza suas finanças, acompanha seus investimentos e vê seu patrimônio, em um só lugar."),
    (22.55, 26.75, "Cuidar do seu dinheiro hoje é construir o futuro que você deseja amanhã."),
    (26.95, 30.6, "Appliquei. Seu dinheiro precisa de direção. Em breve."),
]
_CACHE = os.path.expanduser('~/.cache/appliquei-kokoro')
k = Kokoro(os.path.join(_CACHE, 'kokoro-v1.0.onnx'), os.path.join(_CACHE, 'voices-v1.0.bin'))


def aparar(a, sr, limiar=0.01):
    """Corta o silêncio (e o ruído) antes da primeira e depois da última sílaba."""
    env = np.abs(a)
    idx = np.where(env > limiar)[0]
    if not len(idx):
        return a
    i = max(0, idx[0] - int(0.015 * sr))
    j = min(len(a), idx[-1] + int(0.06 * sr))
    return a[i:j]


partes = []
for n, (ini, fim, txt) in enumerate(CENAS):
    janela = fim - ini
    vel = 1.0
    for _ in range(8):
        a, sr = k.create(txt, voice=VOZ, speed=vel, lang='pt-br')
        a = aparar(np.asarray(a, dtype=np.float32), sr)
        d = len(a) / sr
        if d <= janela:
            break
        vel = min(1.35, vel * d / janela * 1.02)
    bruto = f'{OUT}/bruto{n}.wav'
    sf.write(bruto, a, sr)
    limpo = f'{OUT}/seg{n}.wav'
    # Limpeza: tira o grave de fundo e o chiado agudo, reduz o ruído de fundo
    # (perfil medido no próprio trecho), tira estalos e suaviza as pontas.
    fd = max(0.0, d - 0.05)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', bruto, '-af',
                    'aresample=48000,highpass=f=85,lowpass=f=9500,'
                    'afftdn=nr=14:nf=-42:tn=1,adeclick,'
                    f'afade=t=in:st=0:d=0.012,afade=t=out:st={fd:.3f}:d=0.05',
                    '-ar', '48000', limpo], check=True)
    partes.append([ini, limpo, round(d, 2), round(vel, 2)])
    print(n, round(d, 2), 'de', round(janela, 2), 'vel', round(vel, 2))
json.dump(partes, open(f'{OUT}/partes.json', 'w'))
