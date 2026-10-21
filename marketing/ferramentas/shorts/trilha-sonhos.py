"""Trilha original do vídeo dos Sonhos (30,5 s) "Qual é o seu sonho?".

    python3 marketing/ferramentas/shorts/trilha-sonhos.py <saida.wav>

Composta em código (sem licença de terceiros), no método de trilha-lancamento.py,
sincronizada com marketing/sonhos/sonhos-30s.html:

  0–2,1 s     o sonho: piano em Dó maior, aberto, um "plim" por sonho que surge.
  2,1–7,15 s  ninguém sabe: o acorde vira lá menor, notas suspensas sem resolver.
  7,15–10,35  "um dia": três folhas caindo (sopro + baque) e o piano parando.
  10,35–25,4  o app: 96 BPM, Fá–Dó–Sol–Lám; teclas do formulário, "pop" no
              plano, nota tensa no "aperta", acorde que resolve no "cabe com
              folga", clique da caixa e "pop" da linha no extrato.
  25,4–30,5   marca: impacto, acorde de Dó cheio com brilho, "pop" do botão.

Mixe com a narração usando mixar-narracao.py (a trilha abaixa sob a voz).
"""
import sys
import wave

import numpy as np

SR = 48000
DUR = 30.5
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


def tecla():
    n = int(0.02 * SR)
    return np.diff(rng.standard_normal(n), prepend=0) * env(n, 0.0005, 0.004)


# ── 1. O sonho (0–2,1 s) ────────────────────────────────────────────
add(musica, 0, pad([48, 55, 60, 64], 2.3, 0.4, 0.4), 0.032)
for t0, m in ((0.05, 72), (0.6, 76), (1.2, 79)):
    add(musica, t0, nota(hz(m), 2.0, 'piano', 0.004, 1.1), 0.16)
for i, f in enumerate((1047, 1175, 1319, 1397, 1568)):
    add(efeitos, 0.2 + i * 0.22, plim(f), 0.07)

# ── 2. Ninguém sabe (2,1–7,15 s) ────────────────────────────────────
add(musica, 2.1, pad([45, 52, 57, 60], 5.2, 0.5, 0.6), 0.034)
for t0, m in ((2.3, 69), (3.3, 72), (4.3, 74), (5.6, 71)):  # sobe e não resolve
    add(musica, t0, nota(hz(m), 2.0, 'piano', 0.004, 1.1), 0.15)
for b in range(5):
    add(musica, 2.6 + b, kick(46, 14), 0.30)
for i in range(3):
    add(efeitos, 2.6 + i * 0.3, pop(700 + i * 90), 0.14)

# ── 3. Um dia (7,15–10,35 s) ────────────────────────────────────────
add(musica, 7.15, pad([45, 48, 52], 3.2, 0.4, 1.2), 0.030)
for i, t0 in enumerate((7.75, 8.35, 8.95)):
    folha = lowpass(rng.standard_normal(int(0.45 * SR)), 2400) * np.hanning(int(0.45 * SR))
    add(efeitos, t0, folha, 0.22)
    add(musica, t0 + 0.4, kick(52 - i * 4, 10), 0.32)
add(musica, 7.4, nota(hz(64), 2.6, 'piano', 0.004, 1.6), 0.14)
add(musica, 9.4, nota(hz(57), 1.4, 'piano', 0.004, 1.0), 0.10)  # "…talvez"
riser = lowpass(rng.standard_normal(int(1.0 * SR)), 3500) * np.linspace(0, 1, int(1.0 * SR)) ** 2
add(musica, 9.35, riser, 0.26)

# ── 4. O app (10,35–25,4 s), 96 BPM ─────────────────────────────────
INI, FIM, BPM = 10.35, 25.4, 96
bt = 60 / BPM
acordes = [(41, [57, 60, 65, 69]), (48, [60, 64, 67, 72]), (43, [59, 62, 67, 71]), (45, [57, 60, 64, 69])]
compasso = 4 * bt
k = 0
t = INI
while t < FIM - 1e-6:
    raiz, notas = acordes[k % 4]
    dur = min(compasso, FIM - t)
    add(musica, t, pad(notas, dur, 0.15, 0.15), 0.032)
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
    add(musica, tb, kick(), 0.48)
    if b % 2 == 1:
        clap = rng.standard_normal(int(0.12 * SR)) * env(int(0.12 * SR), 0.001, 0.035)
        add(musica, tb, np.diff(lowpass(clap, 6000), prepend=0) * 3, 0.20)
    for h in (0, 0.5):
        hat = np.diff(rng.standard_normal(int(0.04 * SR)), prepend=0) * env(int(0.04 * SR), 0.001, 0.012)
        add(musica, tb + h * bt, hat, 0.10 if h else 0.06)
crash = lowpass(rng.standard_normal(int(1.5 * SR)), 7000) * np.exp(-t_of(int(1.5 * SR)) * 3)
add(musica, 10.35, crash, 0.10)
add(efeitos, 10.4, pop(700), 0.28)  # celular sobe
add(efeitos, 10.7, clique(), 0.25)  # ✈️
for a, b, n in ((10.85, 11.75, 15), (11.95, 12.55, 9), (12.75, 13.25, 8)):  # três campos
    for k in range(n):
        add(efeitos, a + (b - a) * k / n, tecla(), 0.28)
add(efeitos, 13.7, clique(), 0.35)  # "Ver o plano"
add(efeitos, 14.1, pop(1000), 0.26)
add(musica, 15.9, nota(hz(70), 1.6, 'piano', 0.004, 1.0), 0.12)  # "aperta": nota tensa
add(efeitos, 19.75, clique(), 0.35)  # "2 anos"
add(efeitos, 19.85, plim(1568), 0.14)
for s, m in enumerate((72, 76, 79, 84)):  # resolve: "cabe com folga"
    add(musica, 19.9 + s * 0.08, nota(hz(m), 1.2, 'sine', 0.003, 0.5), 0.06)
add(efeitos, 22.65, clique(), 0.35)  # caixa do Controle
add(efeitos, 23.25, pop(1100), 0.28)  # linha no extrato

# ── 5. Marca (25,4–30,5 s) ──────────────────────────────────────────
n3 = int(5.1 * SR)
t3 = t_of(n3)
acorde = sum(np.sin(2 * np.pi * hz(m) * t3) + 0.25 * np.sin(2 * np.pi * hz(m) * 2.003 * t3) for m in (48, 55, 60, 64, 67, 72))
add(musica, 25.4, acorde * np.exp(-t3 * 0.3), 0.05)
imp_n = int(0.6 * SR)
it = t_of(imp_n)
add(musica, 25.4, np.sin(2 * np.pi * (45 + 80 * np.exp(-it * 25)) * it) * np.exp(-it * 6), 0.6)
add(musica, 25.4, crash, 0.10)
for s, m in enumerate((72, 76, 79, 84, 88)):
    add(musica, 25.7 + s * 0.12, nota(hz(m), 1.2, 'sine', 0.003, 0.5), 0.05)
add(efeitos, 28.0, pop(900), 0.20)  # "Em breve"
add(efeitos, 28.4, pop(1000), 0.28)  # botão

# ── Mix ────────────────────────────────────────────────────────────
mix = musica + efeitos
tt = t_of(N)
mix *= np.clip((DUR - tt) / 1.6, 0, 1)
mix /= max(1e-9, np.max(np.abs(mix))) / 0.9
mix = np.tanh(mix * 3.4) / np.tanh(3.4) * 0.82
est = np.stack([mix, mix], axis=1)
est[:, 1] = np.roll(mix, int(0.006 * SR)) * 0.35 + mix * 0.65

saida = sys.argv[1] if len(sys.argv) > 1 else 'trilha-sonhos.wav'
with wave.open(saida, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(est, -1, 1) * 32767).astype('<i2').tobytes())
print('gerado:', saida)
