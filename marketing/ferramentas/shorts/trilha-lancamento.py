"""Trilha original do teaser de lançamento (31 s) "Você sabe quanto realmente tem?".

    python3 marketing/ferramentas/shorts/trilha-lancamento.py <saida.wav>

Composta em código (sem licença de terceiros), no mesmo método de
trilha-aviso.py, sincronizada com marketing/lancamento-janeiro/teaser-lancamento-31s.html:

  0–4 s      pergunta: piano em lá menor, notas soltas, e o "tic" rápido do
             contador girando; o contador para em "???" (2,4 s) com um baque grave.
  4–9 s      dor: pulso de coração (bumbo abafado a 60 BPM), pad escuro e um
             "fuuu" quando as notas voam (4,4 s).
  9–14 s     as três perguntas: uma nota de piano a cada pergunta (9,2 / 10,4 /
             11,6 s) e subida de ruído até a virada.
  14–22,5 s  o Appliquei: 100 BPM, Dó–Sol–Lám–Fá, bumbo, palma, chimbal, baixo e
             arpejo; "pop" quando o celular sobe e um "clique" a cada tela.
  22,5–26,5  futuro: pad abrindo e brilho subindo junto com a curva.
  26,5–31 s  marca: impacto no logo, acorde de Dó cheio, "pop" do botão e fade.

Pós-processamento: lowpass de 13 kHz, +3 dB e limitador — fica em -15,3 LUFS
com pico em -1,8 dBFS depois do AAC (as redes nivelam perto de -14):

    ffmpeg -i trilha-lancamento.wav -af "lowpass=f=13000,lowpass=f=13000,volume=3dB,alimiter=limit=0.70:level=disabled:attack=1:release=60" trilha.wav
    ffmpeg -i video-sem-audio.mp4 -i trilha.wav -c:v copy -c:a aac -b:a 192k -shortest final.mp4
"""
import sys
import wave

import numpy as np

SR = 48000
DUR = 31.0
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

# ── 1. Pergunta (0–4 s) ─────────────────────────────────────────────
add(musica, 0, pad([45, 52, 57, 60], 4.3, 0.6, 0.6), 0.030)
for k, (t0, m) in enumerate(((0.1, 69), (0.9, 72), (1.7, 76), (3.0, 74))):
    add(musica, t0, nota(hz(m), 2.2, 'piano', 0.004, 1.2), 0.16)
for k in range(30):  # contador girando: tiques que vão espaçando até 2,4 s
    tk = 0.35 + 2.05 * (k / 30) ** 1.6
    add(efeitos, tk, clique(), 0.10)
add(musica, 2.4, kick(42, 6), 0.55)  # "???" — baque grave

# ── 2. Dor (4–9 s) ──────────────────────────────────────────────────
add(musica, 4.0, pad([45, 48, 52, 57], 5.2, 0.5, 0.6), 0.032)
for b in range(5):  # coração: tum-tum a 60 BPM
    add(musica, 4.1 + b, kick(46, 14), 0.42)
    add(musica, 4.1 + b + 0.24, kick(46, 16), 0.28)
whoosh = lowpass(rng.standard_normal(int(1.4 * SR)), 2200) * np.hanning(int(1.4 * SR))
add(efeitos, 4.4, whoosh, 0.28)
add(musica, 6.0, nota(hz(64), 2.5, 'piano', 0.004, 1.3), 0.12)

# ── 3. As três perguntas (9–14 s) ───────────────────────────────────
add(musica, 9.0, pad([45, 52, 57, 60, 64], 5.2, 0.4, 0.3), 0.032)
for t0, m in ((9.2, 69), (10.4, 71), (11.6, 72)):
    add(musica, t0, nota(hz(m), 2.0, 'piano', 0.004, 1.0), 0.17)
    add(efeitos, t0, pop(800), 0.12)
riser = lowpass(rng.standard_normal(int(1.6 * SR)), 3500) * np.linspace(0, 1, int(1.6 * SR)) ** 2
add(musica, 12.4, riser, 0.32)

# ── 4. O Appliquei (14–22,5 s), 100 BPM ─────────────────────────────
INI, FIM, BPM = 14.0, 22.5, 100
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
add(musica, 14.0, crash, 0.10)
add(efeitos, 14.5, pop(700), 0.30)  # celular sobe
for t0 in (15.0, 17.6, 20.0):  # cada tela
    add(efeitos, t0, clique(), 0.30)
    add(efeitos, t0 + 0.02, pop(1100), 0.14)

# ── 5. Futuro (22,5–26,5 s) ─────────────────────────────────────────
add(musica, 22.5, pad([48, 55, 60, 64, 67], 4.2, 1.0, 0.5), 0.045)
for s, m in enumerate((72, 74, 76, 79, 81, 84)):  # brilho subindo com a curva
    add(musica, 22.9 + s * 0.45, nota(hz(m), 1.4, 'sine', 0.004, 0.6), 0.05)
add(efeitos, 26.1, lowpass(rng.standard_normal(int(0.45 * SR)), 2500) * np.hanning(int(0.45 * SR)), 0.3)

# ── 6. Marca (26,5–31 s) ────────────────────────────────────────────
n3 = int(4.5 * SR)
t3 = t_of(n3)
acorde = sum(np.sin(2 * np.pi * hz(m) * t3) + 0.25 * np.sin(2 * np.pi * hz(m) * 2.003 * t3) for m in (48, 55, 60, 64, 67, 72))
add(musica, 26.5, acorde * np.exp(-t3 * 0.3), 0.05)
imp_n = int(0.6 * SR)
it = t_of(imp_n)
add(musica, 26.5, np.sin(2 * np.pi * (45 + 80 * np.exp(-it * 25)) * it) * np.exp(-it * 6), 0.6)
add(musica, 26.5, crash, 0.10)
for s, m in enumerate((72, 76, 79, 84)):
    add(musica, 26.8 + s * 0.12, nota(hz(m), 1.2, 'sine', 0.003, 0.5), 0.05)
add(efeitos, 27.7, pop(1000), 0.28)

# ── Mix ────────────────────────────────────────────────────────────
mix = musica + efeitos
tt = t_of(N)
mix *= np.clip((DUR - tt) / 1.6, 0, 1)
mix /= max(1e-9, np.max(np.abs(mix))) / 0.9
mix = np.tanh(mix * 3.4) / np.tanh(3.4) * 0.82
est = np.stack([mix, mix], axis=1)
est[:, 1] = np.roll(mix, int(0.006 * SR)) * 0.35 + mix * 0.65

saida = sys.argv[1] if len(sys.argv) > 1 else 'trilha-lancamento.wav'
with wave.open(saida, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(est, -1, 1) * 32767).astype('<i2').tobytes())
print('gerado:', saida)
