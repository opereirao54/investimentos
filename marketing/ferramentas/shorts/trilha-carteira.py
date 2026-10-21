"""Trilha original do vídeo da Carteira sugerida (35 s) "Onde investir o dinheiro que sobrou?".

    python3 marketing/ferramentas/shorts/trilha-carteira.py <saida.wav>

Composta em código (sem licença de terceiros), no método de trilha-lancamento.py,
sincronizada com marketing/carteira-sugerida/carteira-sugerida-35s.html:

  0–4,4 s     dúvida: piano em lá menor e um "pop" a cada ponto de interrogação.
  4,4–9,6 s   palpites: pulso tenso a 120 BPM, um "plim" de notificação por
              palpite e um risco áspero quando cada um é riscado.
  9,6–12,7 s  "e se você visse a conta?": tudo para, piano limpo e subida.
  12,7–22,5   o app: 100 BPM, Dó–Sol–Lám–Fá; teclas do aporte, "pop" nas
              barras e nos ativos, tique da nota subindo até 74.
  22,5–25,75  sem caixa-preta: estalo do cadeado, sopro e brilho a cada critério.
  25,75–35 s  marca: impacto, acorde de Dó cheio, "pop" do botão; no aviso legal
              a música baixa e sai em fade.

Mixe com a narração usando mixar-narracao.py (a trilha abaixa sob a voz).
"""
import sys
import wave

import numpy as np

SR = 48000
DUR = 35.0
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


def risco():
    n = int(0.22 * SR)
    r = lowpass(rng.standard_normal(n), 4500) * np.hanning(n)
    return r * (1 + 0.6 * np.sin(2 * np.pi * 38 * t_of(n)))


# ── 1. Dúvida (0–4,4 s) ─────────────────────────────────────────────
add(musica, 0, pad([45, 52, 57, 60], 4.6, 0.6, 0.6), 0.030)
for t0, m in ((0.1, 69), (0.9, 72), (1.7, 76), (3.0, 74)):
    add(musica, t0, nota(hz(m), 2.2, 'piano', 0.004, 1.2), 0.16)
add(musica, 0.45, kick(44, 7), 0.45)  # o valor aparece
for t0, f in ((1.6, 760), (2.0, 900), (2.5, 680)):
    add(efeitos, t0, pop(f), 0.22)

# ── 2. Palpites (4,4–9,6 s), 120 BPM tenso ─────────────────────────
add(musica, 4.4, pad([45, 48, 51, 57], 5.3, 0.3, 0.5), 0.034)  # lá diminuto: incômodo
for b in range(10):
    tb = 4.4 + b * 0.5
    add(musica, tb, kick(48, 14), 0.40)
    hat = np.diff(rng.standard_normal(int(0.04 * SR)), prepend=0) * env(int(0.04 * SR), 0.001, 0.012)
    add(musica, tb + 0.25, hat, 0.10)
for i, f in enumerate((1320, 1480, 1175, 1568, 1397)):
    add(efeitos, 4.65 + i * 0.55, plim(f), 0.11)
    add(efeitos, 7.82 + i * 0.12, risco(), 0.20)
add(musica, 8.5, kick(40, 5), 0.55)  # baque quando tudo é riscado

# ── 3. A conta (9,6–12,7 s) ─────────────────────────────────────────
add(musica, 9.6, pad([48, 55, 60, 64], 3.3, 0.5, 0.3), 0.032)
for t0, m in ((9.75, 72), (10.55, 76), (11.35, 79)):
    add(musica, t0, nota(hz(m), 2.0, 'piano', 0.004, 1.0), 0.17)
add(efeitos, 10.6, pop(820), 0.12)
riser = lowpass(rng.standard_normal(int(1.5 * SR)), 3500) * np.linspace(0, 1, int(1.5 * SR)) ** 2
add(musica, 11.2, riser, 0.30)

# ── 4. O app (12,7–22,5 s), 100 BPM ─────────────────────────────────
INI, FIM, BPM = 12.7, 22.5, 100
bt = 60 / BPM
acordes = [(48, [60, 64, 67, 72]), (43, [59, 62, 67, 71]), (45, [57, 60, 64, 69]), (41, [57, 60, 65, 69])]
compasso = 4 * bt
k = 0
t = INI
while t < FIM - 1e-6:
    raiz, notas = acordes[k % 4]
    dur = min(compasso, FIM - t)
    add(musica, t, pad(notas, dur, 0.12, 0.12), 0.034)
    for b in range(4):
        if t + b * bt < FIM:
            add(musica, t + b * bt, nota(hz(raiz), 0.5, 'saw', 0.005, 0.28), 0.10)
    for s in range(8):
        ts = t + s * bt / 2
        if ts < FIM:
            add(musica, ts, nota(hz(notas[s % 4] + 12), 0.3, 'pluck', 0.002, 0.13), 0.05)
    t += compasso
    k += 1
for b in range(int((FIM - INI) / bt)):
    tb = INI + b * bt
    add(musica, tb, kick(), 0.55)
    if b % 2 == 1:
        clap = rng.standard_normal(int(0.12 * SR)) * env(int(0.12 * SR), 0.001, 0.035)
        add(musica, tb, np.diff(lowpass(clap, 6000), prepend=0) * 3, 0.22)
    for h in (0, 0.5):
        hat = np.diff(rng.standard_normal(int(0.04 * SR)), prepend=0) * env(int(0.04 * SR), 0.001, 0.012)
        add(musica, tb + h * bt, hat, 0.12 if h else 0.07)
crash = lowpass(rng.standard_normal(int(1.5 * SR)), 7000) * np.exp(-t_of(int(1.5 * SR)) * 3)
add(musica, 12.7, crash, 0.10)
add(efeitos, 12.8, pop(700), 0.30)  # celular sobe
for k in range(10):  # teclas do aporte
    add(efeitos, 13.4 + k * 0.12, clique(), 0.22)
for i in range(4):  # barras das classes
    add(efeitos, 17.0 + i * 0.3, pop(900 + i * 120), 0.16)
for i in range(8):  # ativos
    add(efeitos, 17.9 + i * 0.18, clique(), 0.18)
add(efeitos, 19.7, pop(1100), 0.30)  # card do ativo
for k in range(12):  # nota subindo
    add(efeitos, 20.0 + k * 0.08, nota(1800 + k * 60, 0.05, 'sine', 0.001, 0.02), 0.05)

# ── 5. Sem caixa-preta (22,5–25,75 s) ───────────────────────────────
add(musica, 22.5, pad([48, 55, 60, 64, 67], 3.4, 0.8, 0.5), 0.045)
add(efeitos, 22.95, clique(), 0.45)  # cadeado
add(efeitos, 23.0, kick(90, 30), 0.15)
whoosh = lowpass(rng.standard_normal(int(0.9 * SR)), 2600) * np.hanning(int(0.9 * SR))
add(efeitos, 23.2, whoosh, 0.25)
for s, m in enumerate((72, 74, 76, 79, 81)):  # um brilho por critério
    add(musica, 23.35 + s * 0.1, nota(hz(m), 1.2, 'sine', 0.004, 0.5), 0.05)

# ── 6. Marca e aviso (25,75–35 s) ───────────────────────────────────
n3 = int(9.2 * SR)
t3 = t_of(n3)
acorde = sum(np.sin(2 * np.pi * hz(m) * t3) + 0.25 * np.sin(2 * np.pi * hz(m) * 2.003 * t3) for m in (48, 55, 60, 64, 67, 72))
add(musica, 25.75, acorde * np.exp(-t3 * 0.22), 0.05)
imp_n = int(0.6 * SR)
it = t_of(imp_n)
add(musica, 25.75, np.sin(2 * np.pi * (45 + 80 * np.exp(-it * 25)) * it) * np.exp(-it * 6), 0.6)
add(musica, 25.75, crash, 0.10)
for s, m in enumerate((72, 76, 79, 84)):
    add(musica, 26.05 + s * 0.12, nota(hz(m), 1.2, 'sine', 0.003, 0.5), 0.05)
add(efeitos, 28.95, pop(900), 0.20)  # "Em breve"
add(efeitos, 29.45, pop(1000), 0.28)  # botão
add(musica, 30.5, pad([48, 55, 60, 64], 4.5, 1.0, 2.0), 0.030)  # cama do aviso legal

# ── Mix ────────────────────────────────────────────────────────────
mix = musica + efeitos
tt = t_of(N)
mix *= np.clip((DUR - tt) / 2.0, 0, 1)
mix /= max(1e-9, np.max(np.abs(mix))) / 0.9
mix = np.tanh(mix * 3.4) / np.tanh(3.4) * 0.82
est = np.stack([mix, mix], axis=1)
est[:, 1] = np.roll(mix, int(0.006 * SR)) * 0.35 + mix * 0.65

saida = sys.argv[1] if len(sys.argv) > 1 else 'trilha-carteira.wav'
with wave.open(saida, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(est, -1, 1) * 32767).astype('<i2').tobytes())
print('gerado:', saida)
