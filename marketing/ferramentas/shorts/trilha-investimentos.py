"""Trilha original do vídeo de Meus investimentos (33 s) "Você sabe quanto seus investimentos renderam?".

    python3 marketing/ferramentas/shorts/trilha-investimentos.py <saida.wav>

Composta em código (sem licença de terceiros), no método de trilha-lancamento.py,
sincronizada com marketing/investimentos/investimentos-33s.html:

  0–3,9 s     a dúvida: piano em lá menor e os "tics" do percentual girando,
              que para em "?,??%" com um baque.
  3,9–10,85   espalhado: pulso a 60 BPM e um "pop" desafinado a cada app.
  10,85–13,85 uma carteira só: subida, três "pops" se juntando e o acorde abrindo.
  13,85–27,75 a aba: 100 BPM, Dó–Sol–Lám–Fá; "pop" a cada ativo, brilho que
              sobe com as barras de dividendos e a régua do Futuro subindo.
  27,75–33,2  marca: impacto, acorde de Dó cheio, "pop" do botão e fade.

Mixe com a narração usando mixar-narracao.py (a trilha abaixa sob a voz).
"""
import sys
import wave

import numpy as np

SR = 48000
DUR = 33.2
N = int(SR * DUR)
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



musica = np.zeros(N)
efeitos = np.zeros(N)

# ── 1. A dúvida (0–3,9 s) ───────────────────────────────────────────
add(musica, 0, pad([45, 52, 57, 60], 4.1, 0.6, 0.6), 0.030)
for t0, m in ((0.1, 69), (0.9, 72), (1.7, 76), (3.0, 74)):
    add(musica, t0, nota(hz(m), 2.2, 'piano', 0.004, 1.2), 0.16)
for k in range(28):
    add(efeitos, 0.45 + 2.15 * (k / 28) ** 1.5, clique(), 0.10)
add(musica, 2.6, kick(42, 6), 0.55)

# ── 2. Espalhado (3,9–10,85 s) ──────────────────────────────────────
add(musica, 3.9, pad([45, 48, 52, 57], 7.0, 0.5, 0.6), 0.032)
for b in range(7):
    add(musica, 4.0 + b, kick(46, 14), 0.40)
    add(musica, 4.0 + b + 0.24, kick(46, 16), 0.26)
for t0, f in ((4.1, 620), (5.3, 700), (6.5, 585)):
    add(efeitos, t0, pop(f), 0.22)
add(musica, 7.6, nota(hz(64), 2.4, 'piano', 0.004, 1.3), 0.12)
add(musica, 9.0, nota(hz(63), 1.8, 'piano', 0.004, 1.0), 0.10)
riser = lowpass(rng.standard_normal(int(1.4 * SR)), 3500) * np.linspace(0, 1, int(1.4 * SR)) ** 2
add(musica, 9.45, riser, 0.30)

# ── 3. Uma carteira só (10,85–13,85 s) ──────────────────────────────
add(musica, 10.85, pad([48, 55, 60, 64, 67], 3.1, 0.3, 0.4), 0.045)
imp_n = int(0.6 * SR)
it = t_of(imp_n)
add(musica, 10.85, np.sin(2 * np.pi * (45 + 80 * np.exp(-it * 25)) * it) * np.exp(-it * 6), 0.45)
for i, f in enumerate((800, 950, 1100)):
    add(efeitos, 11.1 + i * 0.12, pop(f), 0.20)
for s, m in enumerate((72, 76, 79, 84)):
    add(musica, 11.3 + s * 0.1, nota(hz(m), 1.2, 'sine', 0.003, 0.5), 0.05)

# ── 4. A aba (13,85–27,75 s), 100 BPM ───────────────────────────────
INI, FIM, BPM = 13.85, 27.75, 100
bt = 60 / BPM
acordes = [(48, [60, 64, 67, 72]), (43, [59, 62, 67, 71]), (45, [57, 60, 64, 69]), (41, [57, 60, 65, 69])]
compasso = 4 * bt
k = 0
t = INI
while t < FIM - 1e-6:
    raiz, notas = acordes[k % 4]
    dur = min(compasso, FIM - t)
    add(musica, t, pad(notas, dur, 0.12, 0.12), 0.032)
    for b in range(4):
        if t + b * bt < FIM:
            add(musica, t + b * bt, nota(hz(raiz), 0.5, 'saw', 0.005, 0.28), 0.09)
    for s in range(8):
        ts = t + s * bt / 2
        if ts < FIM:
            add(musica, ts, nota(hz(notas[s % 4] + 12), 0.3, 'pluck', 0.002, 0.13), 0.045)
    t += compasso
    k += 1
for b in range(int((FIM - INI) / bt)):
    tb = INI + b * bt
    add(musica, tb, kick(), 0.50)
    if b % 2 == 1:
        clap = rng.standard_normal(int(0.12 * SR)) * env(int(0.12 * SR), 0.001, 0.035)
        add(musica, tb, np.diff(lowpass(clap, 6000), prepend=0) * 3, 0.20)
    for h in (0, 0.5):
        hat = np.diff(rng.standard_normal(int(0.04 * SR)), prepend=0) * env(int(0.04 * SR), 0.001, 0.012)
        add(musica, tb + h * bt, hat, 0.11 if h else 0.06)
crash = lowpass(rng.standard_normal(int(1.5 * SR)), 7000) * np.exp(-t_of(int(1.5 * SR)) * 3)
add(musica, 13.85, crash, 0.10)
add(efeitos, 13.9, pop(700), 0.28)  # celular sobe
for i in range(4):  # ativos
    add(efeitos, 16.45 + i * 0.4, pop(900 + i * 80), 0.18)
add(efeitos, 19.15, clique(), 0.30)  # sub-aba Dividendos
for i in range(12):  # barras subindo
    add(musica, 19.55 + i * 0.08, nota(hz(72 + i), 0.25, 'sine', 0.002, 0.1), 0.035)
add(efeitos, 21.95, clique(), 0.30)  # sub-aba Futuro
sobe = int(2.2 * SR)
ts_ = t_of(sobe)
add(efeitos, 24.25, np.sin(2 * np.pi * (300 * ts_ + 500 * ts_ ** 2 / 2.2)) * np.hanning(sobe), 0.05)  # régua
add(efeitos, 26.45, pop(1200), 0.26)

# ── 5. Marca (27,75–33,2 s) ─────────────────────────────────────────
n3 = int(5.4 * SR)
t3 = t_of(n3)
acorde = sum(np.sin(2 * np.pi * hz(m) * t3) + 0.25 * np.sin(2 * np.pi * hz(m) * 2.003 * t3) for m in (48, 55, 60, 64, 67, 72))
add(musica, 27.75, acorde * np.exp(-t3 * 0.3), 0.05)
add(musica, 27.75, np.sin(2 * np.pi * (45 + 80 * np.exp(-it * 25)) * it) * np.exp(-it * 6), 0.6)
add(musica, 27.75, crash, 0.10)
for s, m in enumerate((72, 76, 79, 84)):
    add(musica, 28.05 + s * 0.12, nota(hz(m), 1.2, 'sine', 0.003, 0.5), 0.05)
add(efeitos, 30.55, pop(900), 0.20)  # "Em breve"
add(efeitos, 30.95, pop(1000), 0.28)  # botão

# ── Mix ────────────────────────────────────────────────────────────
mix = musica + efeitos
tt = t_of(N)
mix *= np.clip((DUR - tt) / 1.6, 0, 1)
mix /= max(1e-9, np.max(np.abs(mix))) / 0.9
mix = np.tanh(mix * 3.4) / np.tanh(3.4) * 0.82
est = np.stack([mix, mix], axis=1)
est[:, 1] = np.roll(mix, int(0.006 * SR)) * 0.35 + mix * 0.65

saida = sys.argv[1] if len(sys.argv) > 1 else 'trilha-investimentos.wav'
with wave.open(saida, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(est, -1, 1) * 32767).astype('<i2').tobytes())
print('gerado:', saida)
