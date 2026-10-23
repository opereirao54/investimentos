"""Trilha original do resumo de 45 s "E se o seu controle financeiro trabalhasse por você?".

    python3 marketing/ferramentas/shorts/trilha-resumo.py <saida.wav>

Composta em código (sem licença de terceiros), no método de trilha-lancamento.py,
sincronizada com marketing/resumo/resumo-45s.html. Mais enérgica que as trilhas
de uma função só, porque o vídeo é uma vitrine:

  0–3,8 s     pergunta: piano e pad em Dó, três "plins" das notificações.
  3,8–36,25   as automações: 112 BPM, Lám–Fá–Dó–Sol, bumbo, palma, chimbal,
              baixo e arpejo; um "ding" afinado a cada automação (o contador
              do canto sobe junto), mais grave no aviso de saldo vermelho.
  36,25–44,5  marca: impacto, acorde de Dó cheio, "pop" do botão e fade.

Mixe com a narração usando mixar-narracao.py (a trilha abaixa sob a voz).
"""
import sys
import wave

import numpy as np

SR = 48000
DUR = 44.5
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


def ding(f):
    n = int(0.6 * SR)
    tt = t_of(n)
    return (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * f * 2 * tt) + 0.12 * np.sin(2 * np.pi * f * 3.01 * tt)) * np.exp(-tt * 7)


# ── 1. Pergunta (0–3,8 s) ───────────────────────────────────────────
add(musica, 0, pad([48, 55, 60, 64], 4.0, 0.4, 0.4), 0.032)
for t0, m in ((0.05, 72), (0.7, 76), (1.4, 79)):
    add(musica, t0, nota(hz(m), 1.8, 'piano', 0.004, 1.0), 0.15)
for i, f in enumerate((1175, 1319, 1568)):
    add(efeitos, 0.75 + i * 0.5, plim(f), 0.10)
riser = lowpass(rng.standard_normal(int(1.2 * SR)), 3500) * np.linspace(0, 1, int(1.2 * SR)) ** 2
add(musica, 2.6, riser, 0.28)

# ── 2. As automações (3,8–36,25 s), 112 BPM ─────────────────────────
INI, FIM, BPM = 3.8, 36.25, 112
bt = 60 / BPM
acordes = [(45, [57, 60, 64, 69]), (41, [57, 60, 65, 69]), (48, [60, 64, 67, 72]), (43, [59, 62, 67, 71])]
compasso = 4 * bt
k = 0
t = INI
while t < FIM - 1e-6:
    raiz, notas = acordes[k % 4]
    dur = min(compasso, FIM - t)
    add(musica, t, pad(notas, dur, 0.1, 0.1), 0.030)
    for b in range(8):
        if t + b * bt / 2 < FIM:
            add(musica, t + b * bt / 2, nota(hz(raiz), 0.3, 'saw', 0.004, 0.16), 0.08)
    for s in range(8):
        ts = t + s * bt / 2
        if ts < FIM:
            add(musica, ts, nota(hz(notas[(s * 3) % 4] + 12), 0.25, 'pluck', 0.002, 0.11), 0.045)
    t += compasso
    k += 1
for b in range(int((FIM - INI) / bt)):
    tb = INI + b * bt
    add(musica, tb, kick(), 0.52)
    if b % 2 == 1:
        clap = rng.standard_normal(int(0.12 * SR)) * env(int(0.12 * SR), 0.001, 0.035)
        add(musica, tb, np.diff(lowpass(clap, 6000), prepend=0) * 3, 0.22)
    for h in (0, 0.5):
        hat = np.diff(rng.standard_normal(int(0.04 * SR)), prepend=0) * env(int(0.04 * SR), 0.001, 0.012)
        add(musica, tb + h * bt, hat, 0.12 if h else 0.07)
crash = lowpass(rng.standard_normal(int(1.5 * SR)), 7000) * np.exp(-t_of(int(1.5 * SR)) * 3)
for t0 in (3.8, 21.4, 31.4):
    add(musica, t0, crash, 0.09)
# um "ding" por automação, subindo a escala (o contador sobe junto)
AUTOMACOES = [7.6, 11.6, 14.4, 15.9, 18.1, 22.1, 23.4, 24.7, 28.0, 29.6]
escala = [72, 74, 76, 77, 79, 81, 83, 84, 86, 88]
for i, (t0, m) in enumerate(zip(AUTOMACOES, escala)):
    if i == 4:  # saldo no vermelho: alerta grave
        add(efeitos, t0, ding(hz(57)), 0.18)
        add(musica, t0, kick(40, 6), 0.35)
    else:
        add(efeitos, t0, ding(hz(m)), 0.10)
for t0 in (3.85, 9.65, 31.65, 32.25, 32.85, 33.45):  # celulares e cartões entrando
    add(efeitos, t0, pop(800), 0.16)
add(efeitos, 11.7, clique(), 0.30)  # "Usar"

# ── 3. Marca (36,25–44,5 s) ─────────────────────────────────────────
n3 = int(8.2 * SR)
t3 = t_of(n3)
acorde = sum(np.sin(2 * np.pi * hz(m) * t3) + 0.25 * np.sin(2 * np.pi * hz(m) * 2.003 * t3) for m in (48, 55, 60, 64, 67, 72))
add(musica, 36.25, acorde * np.exp(-t3 * 0.25), 0.05)
imp_n = int(0.6 * SR)
it = t_of(imp_n)
add(musica, 36.25, np.sin(2 * np.pi * (45 + 80 * np.exp(-it * 25)) * it) * np.exp(-it * 6), 0.6)
add(musica, 36.25, crash, 0.10)
for s, m in enumerate((72, 76, 79, 84)):
    add(musica, 36.55 + s * 0.12, nota(hz(m), 1.2, 'sine', 0.003, 0.5), 0.05)
add(efeitos, 38.45, pop(900), 0.20)  # "Em breve"
add(efeitos, 38.95, pop(1000), 0.28)  # botão

# ── Mix ────────────────────────────────────────────────────────────
mix = musica + efeitos
tt = t_of(N)
mix *= np.clip((DUR - tt) / 1.8, 0, 1)
mix /= max(1e-9, np.max(np.abs(mix))) / 0.9
mix = np.tanh(mix * 3.4) / np.tanh(3.4) * 0.82
est = np.stack([mix, mix], axis=1)
est[:, 1] = np.roll(mix, int(0.006 * SR)) * 0.35 + mix * 0.65

saida = sys.argv[1] if len(sys.argv) > 1 else 'trilha-resumo.wav'
with wave.open(saida, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(est, -1, 1) * 32767).astype('<i2').tobytes())
print('gerado:', saida)
