"""Som do story "relógio" (7,5 s): tique-taque acelerando até o impacto em
2,0 s (quando o número vira), um pad grave que fica depois e o tique voltando
devagar, baixinho. Pico em -3 dBFS.

    python3 marketing/ferramentas/shorts/trilha-relogio.py saida.wav
"""
import sys
import numpy as np
import soundfile as sf

SR = 48000
DUR = 7.5
BATIDA = 2.0
t = np.arange(int(SR * DUR)) / SR
som = np.zeros_like(t)
rng = np.random.default_rng(7)


def tique(inicio, ganho, agudo=True):
    n = int(SR * 0.05)
    tt = np.arange(n) / SR
    f = 3200 if agudo else 2400
    s = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 140) + rng.normal(0, 0.3, n) * np.exp(-tt * 300)
    i = int(SR * inicio)
    som[i:i + n] += ganho * s[: len(som) - i]


# tique-taque acelerando até a batida
k, x, passo = 0, 0.15, 0.42
while x < BATIDA - 0.05:
    tique(x, 0.25 + 0.35 * x / BATIDA, agudo=k % 2 == 0)
    k += 1
    x += passo
    passo = max(0.16, passo * 0.86)

# impacto: grave que desce + estalo de ruído
i = int(SR * BATIDA)
tt = t[i:] - BATIDA
grave = np.sin(2 * np.pi * (55 + 40 * np.exp(-tt * 8)) * tt) * np.exp(-tt * 2.2)
estalo = rng.normal(0, 1, len(tt)) * np.exp(-tt * 25)
som[i:] += 0.9 * grave + 0.35 * estalo

# pad grave depois da batida (quinta, entra devagar e some no fim)
pad = (np.sin(2 * np.pi * 110 * t) + 0.6 * np.sin(2 * np.pi * 165 * t) + 0.3 * np.sin(2 * np.pi * 220.5 * t))
env = np.clip((t - BATIDA - 0.2) / 1.5, 0, 1) * np.clip((DUR - t) / 1.2, 0, 1)
som += 0.12 * pad * env

# tique voltando devagar, baixinho
x = 3.0
while x < DUR - 0.6:
    tique(x, 0.08, agudo=True)
    x += 1.0

# suaviza as pontas e normaliza
fade = int(SR * 0.02)
som[:fade] *= np.linspace(0, 1, fade)
som[-int(SR * 0.3):] *= np.linspace(1, 0, int(SR * 0.3))
som = som / np.abs(som).max() * 10 ** (-3 / 20)
sf.write(sys.argv[1], np.stack([som, som], axis=1), SR)
print('gerado:', sys.argv[1])
