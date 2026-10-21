"""Trilha original do vídeo do Telegram (34 s) "Você já desistiu de anotar seus gastos?".

    python3 marketing/ferramentas/shorts/trilha-telegram.py <saida.wav>

Composta em código (sem licença de terceiros), no método de trilha-lancamento.py,
sincronizada com marketing/telegram/telegram-34s.html:

  0–3 s       desistência: piano em lá menor, o caderno afunda com um baque.
  3–9,2 s     dor: planilha (nota desafinada), dez toques secos acelerando,
              e o "fuuu" das notas de dinheiro sumindo.
  9,2–11,8 s  "e se bastasse mandar uma mensagem?": silêncio, piano limpo e o
              "zum" do avião decolando.
  11,8–24,9   o chat: 104 BPM leve, Dó–Sol–Lám–Fá; teclas, "whoosh" de envio,
              "plim" a cada resposta do bot e o clique do "Já paguei".
  24,9–29,15  cai no app: três "pops" quando as mensagens viram linhas.
  29,15–34 s  marca: impacto, acorde de Dó cheio, "pop" do botão e fade.

Mixe com a narração usando mixar-narracao.py (a trilha abaixa sob a voz).
"""
import sys
import wave

import numpy as np

SR = 48000
DUR = 34.0
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


def envio():
    n = int(0.28 * SR)
    tt = t_of(n)
    return np.sin(2 * np.pi * (500 + 1600 * tt / 0.28) * tt) * np.hanning(n)


def tecla():
    n = int(0.02 * SR)
    return np.diff(rng.standard_normal(n), prepend=0) * env(n, 0.0005, 0.004)


# ── 1. Desistência (0–3 s) ──────────────────────────────────────────
add(musica, 0, pad([45, 52, 57, 60], 3.2, 0.5, 0.5), 0.030)
for t0, m in ((0.1, 69), (0.8, 72), (1.5, 76)):
    add(musica, t0, nota(hz(m), 2.0, 'piano', 0.004, 1.1), 0.16)
add(musica, 1.3, kick(42, 6), 0.45)  # caderno afunda

# ── 2. Dor (3–9,2 s) ────────────────────────────────────────────────
add(musica, 3.0, pad([45, 48, 51, 57], 6.3, 0.3, 0.5), 0.032)
add(musica, 3.1, nota(hz(70) * 1.03, 1.6, 'piano', 0.004, 0.9), 0.15)  # planilha: nota desafinada
for k in range(10):  # dez toques acelerando
    add(efeitos, 4.8 + 1.5 * (k / 10) ** 0.9, kick(160, 40), 0.20)
    add(efeitos, 4.8 + 1.5 * (k / 10) ** 0.9, clique(), 0.20)
whoosh = lowpass(rng.standard_normal(int(1.6 * SR)), 2200) * np.hanning(int(1.6 * SR))
add(efeitos, 6.6, whoosh, 0.30)
for b in range(4):  # coração
    add(musica, 6.5 + b * 0.75, kick(46, 14), 0.38)

# ── 3. E se (9,2–11,8 s) ────────────────────────────────────────────
add(musica, 9.2, pad([48, 55, 60, 64], 2.7, 0.4, 0.3), 0.032)
for t0, m in ((9.3, 72), (9.9, 76), (10.5, 79)):
    add(musica, t0, nota(hz(m), 1.8, 'piano', 0.004, 0.9), 0.17)
add(efeitos, 9.7, pop(900), 0.20)  # avião aparece
zum = lowpass(rng.standard_normal(int(0.9 * SR)), 3000) * np.linspace(0, 1, int(0.9 * SR)) ** 2
add(efeitos, 10.9, zum, 0.30)

# ── 4. O chat (11,8–24,9 s), 104 BPM ────────────────────────────────
INI, FIM, BPM = 11.8, 24.9, 104
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
add(musica, 11.8, crash, 0.10)
add(efeitos, 11.85, pop(700), 0.28)  # celular sobe
for k in range(13):  # "mercado 52,90"
    add(efeitos, 12.2 + k * 0.09, tecla(), 0.30)
add(efeitos, 13.55, envio(), 0.12)
add(efeitos, 14.35, plim(1320), 0.13)  # resposta do bot
for k in range(22):  # "tênis 300 3x no cartão"
    add(efeitos, 18.2 + k * 0.045, tecla(), 0.30)
add(efeitos, 19.35, envio(), 0.12)
add(efeitos, 20.0, plim(1480), 0.13)
add(efeitos, 21.85, plim(1175), 0.13)  # lembrete
add(efeitos, 23.2, clique(), 0.40)  # "Já paguei"
add(efeitos, 23.55, plim(1568), 0.13)

# ── 5. Cai no app (24,9–29,15 s) ────────────────────────────────────
add(musica, 24.9, pad([48, 55, 60, 64, 67], 4.4, 0.8, 0.5), 0.045)
add(efeitos, 25.0, pop(700), 0.25)
for i, f in enumerate((900, 1050, 1200)):
    add(efeitos, 25.6 + 0.7 + i * 0.35, pop(f), 0.24)
for s, m in enumerate((72, 76, 79)):
    add(musica, 26.3 + s * 0.35, nota(hz(m), 1.2, 'sine', 0.004, 0.5), 0.05)

# ── 6. Marca (29,15–34 s) ───────────────────────────────────────────
n3 = int(4.9 * SR)
t3 = t_of(n3)
acorde = sum(np.sin(2 * np.pi * hz(m) * t3) + 0.25 * np.sin(2 * np.pi * hz(m) * 2.003 * t3) for m in (48, 55, 60, 64, 67, 72))
add(musica, 29.15, acorde * np.exp(-t3 * 0.3), 0.05)
imp_n = int(0.6 * SR)
it = t_of(imp_n)
add(musica, 29.15, np.sin(2 * np.pi * (45 + 80 * np.exp(-it * 25)) * it) * np.exp(-it * 6), 0.6)
add(musica, 29.15, crash, 0.10)
for s, m in enumerate((72, 76, 79, 84)):
    add(musica, 29.45 + s * 0.12, nota(hz(m), 1.2, 'sine', 0.003, 0.5), 0.05)
add(efeitos, 31.75, pop(900), 0.20)  # "Em breve"
add(efeitos, 32.15, pop(1000), 0.28)  # botão

# ── Mix ────────────────────────────────────────────────────────────
mix = musica + efeitos
tt = t_of(N)
mix *= np.clip((DUR - tt) / 1.6, 0, 1)
mix /= max(1e-9, np.max(np.abs(mix))) / 0.9
mix = np.tanh(mix * 3.4) / np.tanh(3.4) * 0.82
est = np.stack([mix, mix], axis=1)
est[:, 1] = np.roll(mix, int(0.006 * SR)) * 0.35 + mix * 0.65

saida = sys.argv[1] if len(sys.argv) > 1 else 'trilha-telegram.wav'
with wave.open(saida, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(est, -1, 1) * 32767).astype('<i2').tobytes())
print('gerado:', saida)
