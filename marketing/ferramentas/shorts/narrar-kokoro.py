"""Narração do teaser de lançamento com Kokoro (voz pm_alex, a escolhida pelo
fundador), no tempo das cenas de marketing/lancamento-janeiro/teaser-lancamento-31s.html,
e limpeza de ruído de cada frase.

    pip install kokoro-onnx soundfile
    # modelo e vozes (uma vez): kokoro-v1.0.onnx e voices-v1.0.bin em ~/.cache/appliquei-kokoro/
    python3 marketing/ferramentas/shorts/narrar-kokoro.py <pasta-saida> [voz]
    python3 marketing/ferramentas/shorts/mixar-narracao.py <pasta-saida> trilha.wav video-sem-audio.mp4 final.mp4

Cada frase começa em `ini` e precisa caber até `fim`; se não couber, a fala é
acelerada aos poucos (até 1,35x). Limpeza: corta o silêncio das pontas,
passa-alta 85 Hz, passa-baixa 9,5 kHz, redução de ruído leve (afftdn — forte,
ela deixa a voz "aguada") e suaviza a entrada e a saída.
"""
import os
import json, subprocess, sys
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

OUT = sys.argv[1]
VOZ = sys.argv[2] if len(sys.argv) > 2 else 'pm_alex'
# (início, fim, texto). Frases com "?" ganham a subida de tom de pergunta.
CENAS = [
    (0.25, 3.9, "Você sabe quanto realmente tem?"),
    (4.25, 8.8, "Você trabalha, recebe seu dinheiro... mas sabe para onde ele está indo?"),
    (9.1, 10.4, "Quanto você gasta?"),
    (10.42, 11.75, "Quanto já acumulou?"),
    (11.8, 13.9, "E como estão seus investimentos?"),
    (14.45, 22.3, "Com o Appliquei, você organiza suas finanças, acompanha seus investimentos e vê seu patrimônio, em um só lugar."),
    (22.55, 26.75, "Cuidar do seu dinheiro hoje é construir o futuro que você deseja amanhã."),
    (26.95, 30.6, "Appliquei. Seu dinheiro precisa de direção. Em breve."),
]
_CACHE = os.path.expanduser('~/.cache/appliquei-kokoro')
k = Kokoro(os.path.join(_CACHE, 'kokoro-v1.0.onnx'), os.path.join(_CACHE, 'voices-v1.0.bin'))


def entonar_pergunta(a, sr, subida=1.22, janela=0.5):
    """Sobe o tom no fim da frase, como numa pergunta.

    O Kokoro lê "tem?" com o tom caindo, igual a uma afirmação, e ainda
    ensurdece a vogal final ("gasta" termina num sopro). Por isso a subida vai
    no último meio segundo com voz de verdade — a palavra final ("GAS-ta",
    "TEM", "acumu-LOU") —, e não no fim do arquivo.

    A edição é feita com o PSOLA do Praat (parselmouth): só a curva de tom muda,
    o timbre e a duração ficam, e soa bem menos metálico que um phase vocoder.
    O trecho final segue uma rampa até `subida` vezes o tom médio da frase
    (nunca abaixa o tom original); o resto da frase fica intacto e as duas
    partes se emendam com 30 ms de transição.
    """
    import parselmouth
    from parselmouth.praat import call

    snd = parselmouth.Sound(a.astype(np.float64), sampling_frequency=sr)
    pitch = snd.to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=320)
    f0 = pitch.selected_array['frequency']
    tempos = pitch.xs()
    voz = f0 > 85  # abaixo disso é voz rangida, não tom
    if voz.sum() < 5:
        return a
    base = float(np.median(f0[voz]))
    t_fim = float(tempos[np.where(voz)[0][-1]])
    t_ini = max(float(tempos[np.where(voz)[0][0]]), t_fim - janela)
    if t_fim - t_ini < 0.08:
        return a
    manip = call(snd, 'To Manipulation', 0.01, 75, 320)
    tier = call(manip, 'Extract pitch tier')
    v_ini = call(tier, 'Get value at time', t_ini)
    alvo = base * subida
    pontos = []
    for t in np.arange(t_ini, t_fim + 0.0001, 0.01):
        x = (t - t_ini) / (t_fim - t_ini)
        desejado = v_ini + (alvo - v_ini) * x ** 1.2
        original = call(tier, 'Get value at time', float(t))
        pontos.append((float(t), max(original, desejado)))
    call(tier, 'Remove points between', t_ini, t_fim + 0.08)
    for t, v in pontos:
        call(tier, 'Add point', t, v)
    call(tier, 'Add point', t_fim + 0.06, pontos[-1][1])
    call([tier, manip], 'Replace pitch tier')
    novo = call(manip, 'Get resynthesis (overlap-add)').values[0].astype(np.float32)
    novo = np.pad(novo, (0, max(0, len(a) - len(novo))))[: len(a)]
    # emenda: original até pouco antes da rampa, PSOLA dali em diante
    i0 = max(0, int((t_ini - 0.04) * sr))
    xf = int(0.03 * sr)
    out = a.copy()
    out[i0 + xf:] = novo[i0 + xf:]
    w = np.linspace(0, 1, xf)
    out[i0:i0 + xf] = a[i0:i0 + xf] * (1 - w) + novo[i0:i0 + xf] * w
    return out


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
        if txt.rstrip().endswith('?'):
            a = entonar_pergunta(a, sr)
        d = len(a) / sr
        if d <= janela:
            break
        vel = min(1.25, vel * d / janela * 1.02)
    bruto = f'{OUT}/bruto{n}.wav'
    sf.write(bruto, a, sr)
    limpo = f'{OUT}/seg{n}.wav'
    # Limpeza: tira o grave de fundo e o chiado agudo, reduz de leve o ruído de
    # fundo e suaviza as pontas.
    fd = max(0.0, d - 0.05)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', bruto, '-af',
                    'aresample=48000,highpass=f=85,lowpass=f=9500,'
                    'afftdn=nr=5:nf=-50,'
                    f'afade=t=in:st=0:d=0.012,afade=t=out:st={fd:.3f}:d=0.05',
                    '-ar', '48000', limpo], check=True)
    partes.append([ini, limpo, round(d, 2), round(vel, 2)])
    print(n, round(d, 2), 'de', round(janela, 2), 'vel', round(vel, 2))
json.dump(partes, open(f'{OUT}/partes.json', 'w'))
