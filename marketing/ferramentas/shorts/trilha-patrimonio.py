"""Trilha original do vídeo do Patrimônio (35,6 s) "Quanto você tem, somando tudo?".

    python3 marketing/ferramentas/shorts/trilha-patrimonio.py <saida.wav>

Composta em código (sem licença de terceiros), no método de trilha-lancamento.py,
sincronizada com marketing/patrimonio/patrimonio-36s.html:

  0–4,1 s      a soma: piano em lá menor, um "pop" a cada ícone (🏦 📈 🚗 🏠)
               e um baque no "R$ ???".
  4,1–10,75    cada coisa num lugar: pulso a 60 BPM e um "pop" por cartão.
  10,75–15,1   um número só: sopro dos ícones voando, impacto e o acorde
               abrindo enquanto o total sobe.
  15,1–30,65   a aba: 100 BPM, Dó–Sol–Lám–Fá; "pop" nas quatro partes, tiques
               do "Consultando FIPE…", plim quando acha o valor, nota grave na
               dívida, brilho na linha do tempo.
  30,65–35,6   marca: impacto, acorde de Dó cheio, "pop" do botão e fade.

Mixe com a narração usando mixar-narracao.py (a trilha abaixa sob a voz).
"""
import sys
import wave

import numpy as np

SR = 48000
DUR = 35.6
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


def plim(f=1320):
    n = int(0.35 * SR)
    tt = t_of(n)
    return (np.sin(2 * np.pi * f * tt) + 0.5 * np.sin(2 * np.pi * f * 1.5 * tt)) * np.exp(-tt * 14)


# ── 1. A soma (0–4,1 s) ─────────────────────────────────────────────
add(musica, 0, pad([45, 52, 57, 60], 4.3, 0.6, 0.6), 0.030)
for t0, m in ((0.1, 69), (0.9, 72), (1.7, 76), (3.0, 74)):
    add(musica, t0, nota(hz(m), 2.2, 'piano', 0.004, 1.2), 0.16)
for i in range(4):
    add(efeitos, 0.5 + i * 0.25, pop(760 + i * 90), 0.18)
add(musica, 1.75, kick(42, 6), 0.50)

# ── 2. Cada coisa num lugar (4,1–10,75 s) ───────────────────────────
add(musica, 4.1, pad([45, 48, 52, 57], 6.8, 0.5, 0.6), 0.032)
for b in range(7):
    add(musica, 4.2 + b, kick(46, 14), 0.40)
    add(musica, 4.2 + b + 0.24, kick(46, 16), 0.26)
for i, a in enumerate((0.2, 1.1, 2.2, 2.9)):
    add(efeitos, 4.1 + a, pop((640, 700, 590, 660)[i]), 0.22)
add(musica, 8.2, nota(hz(64), 2.2, 'piano', 0.004, 1.3), 0.12)
riser = lowpass(rng.standard_normal(int(1.3 * SR)), 3500) * np.linspace(0, 1, int(1.3 * SR)) ** 2
add(musica, 9.45, riser, 0.30)

# ── 3. Um número só (10,75–15,1 s) ──────────────────────────────────
add(musica, 10.75, pad([48, 55, 60, 64, 67], 4.5, 0.4, 0.5), 0.045)
whoosh = lowpass(rng.standard_normal(int(0.9 * SR)), 2600) * np.hanning(int(0.9 * SR))
add(efeitos, 10.9, whoosh, 0.25)
imp_n = int(0.6 * SR)
it = t_of(imp_n)
add(musica, 11.65, np.sin(2 * np.pi * (45 + 80 * np.exp(-it * 25)) * it) * np.exp(-it * 6), 0.45)
for s, m in enumerate((72, 76, 79, 84)):
    add(musica, 11.8 + s * 0.3, nota(hz(m), 1.2, 'sine', 0.003, 0.5), 0.05)
for k in range(16):  # total contando
    add(efeitos, 11.75 + k * 0.1, nota(1800 + k * 40, 0.05, 'sine', 0.001, 0.02), 0.04)

# ── 4. A aba (15,1–30,65 s), 100 BPM ────────────────────────────────
INI, FIM, BPM = 15.1, 30.65, 100
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
add(musica, 15.1, crash, 0.10)
add(efeitos, 15.15, pop(700), 0.28)  # celular sobe
for i in range(4):  # as quatro partes
    add(efeitos, 15.7 + i * 0.3, pop(900 + i * 100), 0.18)
for k in range(8):  # "Consultando FIPE…"
    add(efeitos, 21.4 + k * 0.13, clique(), 0.14)
add(efeitos, 22.5, plim(1568), 0.14)  # achou o valor
add(efeitos, 23.0, pop(950), 0.20)  # apartamento
add(musica, 24.0, nota(hz(43), 1.0, 'saw', 0.01, 0.4), 0.10)  # a dívida
add(efeitos, 24.05, plim(1175), 0.10)
sobe = int(3.0 * SR)
ts_ = t_of(sobe)
add(efeitos, 27.4, np.sin(2 * np.pi * (300 * ts_ + 400 * ts_ ** 2 / 3.0)) * np.hanning(sobe), 0.04)  # linha do tempo
add(efeitos, 30.35, pop(1200), 0.24)

# ── 5. Marca (30,65–35,6 s) ─────────────────────────────────────────
n3 = int(5.0 * SR)
t3 = t_of(n3)
acorde = sum(np.sin(2 * np.pi * hz(m) * t3) + 0.25 * np.sin(2 * np.pi * hz(m) * 2.003 * t3) for m in (48, 55, 60, 64, 67, 72))
add(musica, 30.65, acorde * np.exp(-t3 * 0.3), 0.05)
add(musica, 30.65, np.sin(2 * np.pi * (45 + 80 * np.exp(-it * 25)) * it) * np.exp(-it * 6), 0.6)
add(musica, 30.65, crash, 0.10)
for s, m in enumerate((72, 76, 79, 84)):
    add(musica, 30.95 + s * 0.12, nota(hz(m), 1.2, 'sine', 0.003, 0.5), 0.05)
add(efeitos, 33.45, pop(900), 0.20)  # "Em breve"
add(efeitos, 33.85, pop(1000), 0.28)  # botão

# ── Mix ────────────────────────────────────────────────────────────
mix = musica + efeitos
tt = t_of(N)
mix *= np.clip((DUR - tt) / 1.6, 0, 1)
mix /= max(1e-9, np.max(np.abs(mix))) / 0.9
mix = np.tanh(mix * 3.4) / np.tanh(3.4) * 0.82
est = np.stack([mix, mix], axis=1)
est[:, 1] = np.roll(mix, int(0.006 * SR)) * 0.35 + mix * 0.65

saida = sys.argv[1] if len(sys.argv) > 1 else 'trilha-patrimonio.wav'
with wave.open(saida, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(est, -1, 1) * 32767).astype('<i2').tobytes())
print('gerado:', saida)
