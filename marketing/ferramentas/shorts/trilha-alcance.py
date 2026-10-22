"""Trilha dos vídeos de ALCANCE (modelo-alcance.html), 15–25 s.

    python3 marketing/ferramentas/shorts/trilha-alcance.py <narracao.json> <saida.wav> [--sem-moedas]

Lê os tempos do próprio narracao.json, então serve para qualquer vídeo feito
no modelo sem editar nada. O modelo tem 6 frases, nesta ordem: gancho, item 1,
item 2, item 3, CTA ("salva e manda") e fecho com a marca.

  gancho      pad em lá menor, "tic" de suspense e a lupa (sopro)
  itens       batida a 120 BPM, leve; um "ding" ambar a cada número (1, 2, 3)
              e um "pop" quando a linha do extrato acende
  CTA         a batida para; moedas quando a soma aparece e dois "pops"
              (Salva / Manda)
  fecho       acorde de Dó, três "plins" dos avisos do app e fade

Composta em código (sem licença de terceiros), no método de trilha-lancamento.py.
"""
import sys
import wave

import numpy as np

import json

SR = 48000
rng = np.random.default_rng(11)


def t_of(n):
    return np.arange(n) / SR


def env(n, a=0.005, r=0.2):
    t = t_of(n)
    return np.minimum(1.0, t / max(a, 1e-4)) * np.exp(-t / max(r, 1e-4))


def add(buf, start, sig, gain=1.0):
    i = int(start * SR)
    j = min(len(buf), i + len(sig))
    if i < len(buf):
        buf[i:j] += sig[: j - i] * gain


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def nota(f, dur, forma='sine', a=0.01, r=0.4):
    n = int(dur * SR)
    t = t_of(n)
    if forma == 'sine':
        s = np.sin(2 * np.pi * f * t)
    elif forma == 'saw':
        s = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 7))
    elif forma == 'pluck':
        s = np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * 2 * f * t) + 0.15 * np.sin(2 * np.pi * 3 * f * t)
    elif forma == 'piano':  # harmônicas que decaem em tempos diferentes
        s = sum(np.sin(2 * np.pi * f * k * t) * np.exp(-t * (1.2 + k * 0.9)) / k for k in range(1, 6))
    return s * env(n, a, r)


def lowpass(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for k in range(len(x)):
        acc = (1 - a) * x[k] + a * acc
        y[k] = acc
    return y


def pad(notas, dur, ataque=0.4, saida=0.5):
    n = int(dur * SR)
    tt = t_of(n)
    s = sum(np.sin(2 * np.pi * hz(m) * tt) + 0.3 * np.sin(2 * np.pi * hz(m) * 2.002 * tt) for m in notas)
    return s * np.minimum(1, tt / ataque) * np.clip((dur - tt) / saida, 0, 1)


def kick(grave=50, decai=12):
    n = int(0.3 * SR)
    kt = t_of(n)
    return np.sin(2 * np.pi * (grave + 90 * np.exp(-kt * 30)) * kt) * np.exp(-kt * decai)


def pop(f=900):
    n = int(0.09 * SR)
    tt = t_of(n)
    return np.sin(2 * np.pi * (f + 1200 * np.exp(-tt * 60)) * tt) * np.exp(-tt * 45)


def clique():
    n = int(0.03 * SR)
    return np.diff(rng.standard_normal(n), prepend=0) * env(n, 0.001, 0.007)



FALAS = json.load(open(sys.argv[1]))
inicio = [f[0] - 0.15 for f in FALAS]
ITEM1, ITEM2, ITEM3, CTA, FECHO = inicio[1:6]
DUR = round(FALAS[-1][1] + 2.05, 2)
N = int(SR * DUR)
musica = np.zeros(N)
efeitos = np.zeros(N)


def plim(f=1320):
    n = int(0.35 * SR)
    tt = t_of(n)
    return (np.sin(2 * np.pi * f * tt) + 0.5 * np.sin(2 * np.pi * f * 1.5 * tt)) * np.exp(-tt * 14)


def ding(f):
    n = int(0.6 * SR)
    tt = t_of(n)
    return (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * f * 2 * tt)) * np.exp(-tt * 7)


# gancho
add(musica, 0, pad([45, 52, 57, 60], ITEM1 + 0.2, 0.3, 0.4), 0.032)
for t0, m in ((0.05, 69), (0.8, 72), (1.6, 76)):
    add(musica, t0, nota(hz(m), 1.8, 'piano', 0.004, 1.0), 0.15)
for k in range(int((ITEM1 - 0.6) / 0.25)):
    add(efeitos, 0.6 + k * 0.25, clique(), 0.08)
add(efeitos, 0.6, pop(700), 0.22)  # extrato entra
lupa = lowpass(rng.standard_normal(int(1.2 * SR)), 2000) * np.hanning(int(1.2 * SR))
add(efeitos, 1.3, lupa, 0.12)

# itens: batida leve a 120 BPM
bt = 0.5
acordes = [(45, [57, 60, 64, 69]), (41, [57, 60, 65, 69]), (48, [60, 64, 67, 72]), (43, [59, 62, 67, 71])]
k = 0
t = ITEM1
while t < CTA - 1e-6:
    raiz, notas = acordes[k % 4]
    dur = min(4 * bt, CTA - t)
    add(musica, t, pad(notas, dur, 0.1, 0.1), 0.028)
    for b in range(4):
        tb = t + b * bt
        if tb < CTA:
            add(musica, tb, kick(), 0.45)
            add(musica, tb, nota(hz(raiz), 0.3, 'saw', 0.004, 0.16), 0.07)
            hat = np.diff(rng.standard_normal(int(0.04 * SR)), prepend=0) * env(int(0.04 * SR), 0.001, 0.012)
            add(musica, tb + bt / 2, hat, 0.10)
            if b % 2 == 1:
                clap = rng.standard_normal(int(0.12 * SR)) * env(int(0.12 * SR), 0.001, 0.035)
                add(musica, tb, np.diff(lowpass(clap, 6000), prepend=0) * 3, 0.18)
    t += 4 * bt
    k += 1
for t0, m in zip((ITEM1, ITEM2, ITEM3), (76, 79, 83)):
    add(efeitos, t0 + 0.05, ding(hz(m)), 0.11)
    add(efeitos, t0 + 0.3, pop(1000), 0.16)

# CTA: a batida para
add(musica, CTA, pad([48, 55, 60, 64], FECHO - CTA + 0.2, 0.2, 0.3), 0.036)
add(musica, CTA, kick(42, 6), 0.45)
# moedas caindo quando a soma do exemplo aparece (--sem-moedas desliga, para
# vídeos em que a 5ª frase não mostra dinheiro)
if '--sem-moedas' not in sys.argv:
    for k, f in enumerate((2093, 2349, 1976, 2637, 2217, 2489)):
        add(efeitos, CTA + 0.55 + k * 0.07, ding(f) * np.exp(-t_of(int(0.6 * SR)) * 8), 0.05)
add(efeitos, CTA + 1.0, pop(900), 0.24)
add(efeitos, CTA + 1.6, pop(1050), 0.24)
for s, m in enumerate((72, 76, 79)):
    add(musica, CTA + 0.5 + s * 0.12, nota(hz(m), 1.0, 'sine', 0.003, 0.5), 0.05)

# fecho
n3 = int((DUR - FECHO) * SR)
t3 = t_of(n3)
acorde = sum(np.sin(2 * np.pi * hz(m) * t3) + 0.25 * np.sin(2 * np.pi * hz(m) * 2.003 * t3) for m in (48, 55, 60, 64, 67, 72))
add(musica, FECHO, acorde * np.exp(-t3 * 0.3), 0.05)
imp_n = int(0.6 * SR)
it = t_of(imp_n)
add(musica, FECHO, np.sin(2 * np.pi * (45 + 80 * np.exp(-it * 25)) * it) * np.exp(-it * 6), 0.5)
for i, f in enumerate((1319, 1568, 1760)):
    add(efeitos, FECHO + 0.9 + i * 0.45, plim(f), 0.10)

mix = musica + efeitos
tt = t_of(N)
mix *= np.clip((DUR - tt) / 1.4, 0, 1)
mix /= max(1e-9, np.max(np.abs(mix))) / 0.9
mix = np.tanh(mix * 3.4) / np.tanh(3.4) * 0.82
est = np.stack([mix, mix], axis=1)
est[:, 1] = np.roll(mix, int(0.006 * SR)) * 0.35 + mix * 0.65

with wave.open(sys.argv[2], 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(est, -1, 1) * 32767).astype('<i2').tobytes())
print('gerado:', sys.argv[2], f'({DUR} s)')
