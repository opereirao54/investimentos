"""Trilha da animação "Conheça o Appli" (12 s): marimba alegre em dó maior
(I–V–vi–IV, 100 bpm) e os efeitos sincronizados com video.html (pouso, pulo,
giro, brilhos do joinha e pulinhos).

    python3 marketing/mascote/appli/trilha.py saida.wav
"""
import sys
import numpy as np
import soundfile as sf

SR, DUR = 48000, 12.0
n = int(SR * DUR)
mix = np.zeros(n)


def nota(f, t, d=0.6, v=0.18):
    i = int(t * SR)
    tt = np.arange(int(d * SR)) / SR
    s = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 4 * f * tt) * np.exp(-tt * 30)) * np.exp(-tt * 7)
    s *= np.minimum(1, tt / 0.003)
    j = min(n, i + len(s))
    mix[i:j] += v * s[: j - i]


def varre(f0, f1, t, d, v, decai=8):
    i = int(t * SR)
    tt = np.arange(int(d * SR)) / SR
    f = f0 + (f1 - f0) * tt / d
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * decai) * np.minimum(1, tt / 0.004)
    j = min(n, i + len(s))
    mix[i:j] += v * s[: j - i]


def sopro(t, d, v):
    i = int(t * SR)
    m = int(d * SR)
    r = np.random.default_rng(1).standard_normal(m)
    r = np.convolve(r, np.ones(24) / 24, 'same')
    env = np.sin(np.linspace(0, np.pi, m)) ** 2
    mix[i : i + m] += v * r * env


hz = lambda m: 440 * 2 ** ((m - 69) / 12)
BAT = 60 / 100
acordes = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]
melodia = [72, 76, 79, 76, 74, 71, 74, 79, 72, 76, 81, 79, 77, 76, 74, 72]
t, k = 0.9, 0
while t < 11.4:
    ac = acordes[(k // 4) % 4]
    nota(hz(ac[0] - 12), t, 0.9, 0.16)
    nota(hz(ac[(k % 2) + 1]), t + BAT / 2, 0.5, 0.09)
    nota(hz(melodia[k % 16]), t, 0.5, 0.11)
    t += BAT
    k += 1
nota(hz(84), 11.0, 1.0, 0.12)
nota(hz(79), 11.0, 1.0, 0.1)
# efeitos
varre(160, 55, 0.6, 0.22, 0.5, 14)  # pouso
varre(220, 900, 4.95, 0.35, 0.22, 6)  # pulo
sopro(5.0, 0.8, 0.5)  # giro
varre(160, 55, 5.85, 0.22, 0.45, 14)  # pouso
for tb, f in [(6.5, 2637), (6.7, 3136), (7.1, 3520)]:  # brilhos
    nota(f, tb, 0.5, 0.08)
for tb in (8.6, 9.1):  # pulinhos
    varre(300, 700, tb, 0.12, 0.15, 18)
mix *= np.minimum(1, (DUR - np.arange(n) / SR) / 0.6)
mix /= np.abs(mix).max() / 0.8
sf.write(sys.argv[1], np.stack([mix, mix], 1), SR)
print('gerado:', sys.argv[1])
