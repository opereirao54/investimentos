"""Som da vinheta Appliquei News (1,6 s): sopro de entrada, impacto grave no
"APPLIQUEI", dois toques de jornal (dó e sol agudos) no "NEWS" e um sopro de
saída na limpeza da tela.

    python3 marketing/ferramentas/shorts/trilha-vinheta.py saida.wav
"""
import sys
import numpy as np
import soundfile as sf

SR, DUR = 48000, 1.6
n = int(SR * DUR)
mix = np.zeros(n)
rng = np.random.default_rng(7)


def por(t, s, v):
    i = int(t * SR)
    j = min(n, i + len(s))
    mix[i:j] += v * s[: j - i]


def sopro(d, sobe=True):
    m = int(d * SR)
    r = np.convolve(rng.standard_normal(m), np.ones(30) / 30, 'same')
    env = np.linspace(0, 1, m) ** 2 if sobe else np.linspace(1, 0, m) ** 2
    return r * env


def impacto():
    tt = np.arange(int(0.5 * SR)) / SR
    f = 110 * np.exp(-tt * 6) + 45
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 7)
    s += 0.4 * np.convolve(rng.standard_normal(len(tt)), np.ones(8) / 8, 'same') * np.exp(-tt * 30)
    return s


def toque(f):
    tt = np.arange(int(0.6 * SR)) / SR
    return (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2 * f * tt)) * np.exp(-tt * 6) * np.minimum(1, tt / 0.002)


por(0.0, sopro(0.3), 0.9)
por(0.2, impacto(), 1.0)
por(0.36, toque(1046.5), 0.45)
por(0.52, toque(1568), 0.45)
por(1.2, sopro(0.4), 0.7)
mix *= np.minimum(1, (DUR - np.arange(n) / SR) / 0.05)
mix /= np.abs(mix).max() / 0.85
sf.write(sys.argv[1], np.stack([mix, mix], 1), SR)
print('gerado:', sys.argv[1])
