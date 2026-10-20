"""Trilha original do anúncio de 18 s "o Appliquei te avisa dias antes".

    python3 marketing/ferramentas/shorts/trilha-aviso.py <saida.wav> [--sonhos]

Composta em código (sem licença de terceiros) e sincronizada com as cenas de
marketing/comercial-mesmo-salario/anuncio-aviso-18s.html:

  0,0–3,4 s  tensão: drone grave em lá menor, tique-taque de relógio e o
             "bip de erro" da maquininha nos dois tremores (0,15 s e 1,6 s);
             subida de ruído que leva ao corte.
  3,4–13,6 s virada: 120 BPM, Dó–Sol–Lám–Fá (I–V–vi–IV), bumbo, palma, chimbal,
             baixo e arpejo; "plim" de notificação (3,8 s), "pop" do card (4,3 s)
             e dos destaques 1 e 2 (9,4 s e 10,4 s).
  13,6–18 s  resolução: acorde de Dó cheio com impacto no logo, brilho, "pop"
             do botão (14,6 s) e saída em fade.

Volume: saturação suave (tanh) aqui e, no ffmpeg, corte de agudos e ganho —
fica em ~-15,5 LUFS com pico abaixo de -0,9 dBFS (as redes nivelam perto de
-14; loudnorm direto não chegava lá sem estourar o pico):

    ffmpeg -i trilha-aviso.wav -af "lowpass=f=13000,lowpass=f=13000,volume=0dB" trilha.wav
    ffmpeg -i video-sem-audio.mp4 -i trilha.wav -c:v copy -c:a aac -b:a 192k -shortest final.mp4
"""
import sys
import wave

import numpy as np

SR = 48000
# --sonhos: abertura com caixinha de música no lugar do bip de erro (anuncio-sonhos-18s).
TEMA = 'sonhos' if '--sonhos' in sys.argv else 'aviso'
DUR = 18.0
N = int(SR * DUR)
rng = np.random.default_rng(7)


def t_of(n):
    return np.arange(n) / SR


def env(n, a=0.005, r=0.2):
    """Envelope ataque/decaimento exponencial."""
    t = t_of(n)
    e = np.minimum(1.0, t / max(a, 1e-4)) * np.exp(-t / max(r, 1e-4))
    return e


def add(buf, start, sig, gain=1.0):
    i = int(start * SR)
    j = min(len(buf), i + len(sig))
    if i < len(buf):
        buf[i:j] += sig[: j - i] * gain


def nota(f, dur, forma='sine', a=0.01, r=0.4):
    n = int(dur * SR)
    t = t_of(n)
    if forma == 'sine':
        s = np.sin(2 * np.pi * f * t)
    elif forma == 'saw':  # dente de serra suave (poucas harmônicas)
        s = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 7))
    elif forma == 'square':
        s = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 9, 2))
    elif forma == 'pluck':
        s = np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * 2 * f * t) + 0.15 * np.sin(2 * np.pi * 3 * f * t)
    return s * env(n, a, r)


def lowpass(x, fc):
    """Passa-baixa de 1 polo (suaviza ruído e pads)."""
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for k in range(len(x)):
        acc = (1 - a) * x[k] + a * acc
        y[k] = acc
    return y


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


musica = np.zeros(N)
efeitos = np.zeros(N)

# ── 1. Tensão (0–3,4 s) ─────────────────────────────────────────────
n1 = int(3.6 * SR)
t1 = t_of(n1)
drone = (np.sin(2 * np.pi * hz(45) * t1) + 0.6 * np.sin(2 * np.pi * hz(45) * 1.003 * t1)
         + 0.5 * np.sin(2 * np.pi * hz(48) * t1) + 0.3 * np.sin(2 * np.pi * hz(52) * t1))
drone *= np.minimum(1, t1 / 0.3) * np.clip((3.6 - t1) / 0.4, 0, 1)
add(musica, 0, drone, 0.16)
for k in range(7):  # tique-taque a cada 0,5 s
    tick = rng.standard_normal(int(0.03 * SR)) * env(int(0.03 * SR), 0.001, 0.008)
    add(musica, 0.05 + k * 0.5, np.diff(tick, prepend=0), 0.5 if k % 2 == 0 else 0.3)
if TEMA == 'sonhos':  # caixinha de música em lá menor: "um dia…"
    for k2, m in enumerate((81, 76, 84, 83, 79, 76)):
        add(efeitos, 0.2 + k2 * 0.5, nota(hz(m), 1.0, 'sine', 0.002, 0.45) + 0.3 * nota(hz(m + 12), 1.0, 'sine', 0.002, 0.2), 0.10)
else:
    for t0 in (0.15, 1.6):  # bip de erro: dois toques graves e ásperos
        for d, f in ((0.0, 330), (0.16, 262)):
            add(efeitos, t0 + d, nota(f, 0.14, 'square', 0.003, 0.09), 0.22)
riser = rng.standard_normal(int(0.6 * SR))
riser = lowpass(riser, 3000) * np.linspace(0, 1, len(riser)) ** 2
add(musica, 2.8, riser, 0.35)

# ── 2. Virada (3,4–13,6 s), 120 BPM ──────────────────────────────────
INI, BPM = 3.4, 120
bt = 60 / BPM
acordes = [  # (raiz do baixo, notas do pad) — Dó, Sol, Lám, Fá, 2 s cada
    (48, [60, 64, 67, 72]),
    (43, [59, 62, 67, 71]),
    (45, [57, 60, 64, 69]),
    (41, [57, 60, 65, 69]),
]
fim2 = 13.6
k = 0
t = INI
while t < fim2 - 1e-6:
    raiz, notas = acordes[k % 4]
    dur = min(2.0, fim2 - t)
    n = int(dur * SR)
    tt = t_of(n)
    pad = sum(np.sin(2 * np.pi * hz(m) * tt) + 0.3 * np.sin(2 * np.pi * hz(m) * 2.002 * tt) for m in notas)
    pad *= np.minimum(1, tt / 0.15) * np.clip((dur - tt) / 0.12, 0, 1)
    add(musica, t, pad, 0.035)
    for b in range(4):  # baixo em semínimas
        if t + b * bt < fim2:
            add(musica, t + b * bt, nota(hz(raiz), 0.45, 'saw', 0.005, 0.25), 0.10)
    for s in range(8):  # arpejo em colcheias
        ts = t + s * bt / 2
        if ts < fim2:
            add(musica, ts, nota(hz(notas[s % 4] + 12), 0.3, 'pluck', 0.002, 0.12), 0.05)
    t += 2.0
    k += 1
nb = int((fim2 - INI) / bt)
for b in range(nb):
    tb = INI + b * bt
    kick_n = int(0.25 * SR)
    kt = t_of(kick_n)
    kick = np.sin(2 * np.pi * (50 + 90 * np.exp(-kt * 30)) * kt) * np.exp(-kt * 12)
    add(musica, tb, kick, 0.55)
    if b % 2 == 1:  # palma no 2 e no 4
        clap = rng.standard_normal(int(0.12 * SR)) * env(int(0.12 * SR), 0.001, 0.035)
        add(musica, tb, np.diff(lowpass(clap, 6000), prepend=0) * 3, 0.22)
    for h in (0, 0.5):  # chimbal em colcheias
        hat = np.diff(rng.standard_normal(int(0.04 * SR)), prepend=0) * env(int(0.04 * SR), 0.001, 0.012)
        add(musica, tb + h * bt, hat, 0.12 if h else 0.07)

# efeitos da cena 2 e 3
plim = nota(hz(88), 0.6, 'sine', 0.002, 0.25) + 0.6 * nota(hz(93), 0.6, 'sine', 0.002, 0.2)
add(efeitos, 3.8, plim, 0.16)


def pop(f=900):
    n = int(0.09 * SR)
    tt = t_of(n)
    return np.sin(2 * np.pi * (f + 1200 * np.exp(-tt * 60)) * tt) * np.exp(-tt * 45)


add(efeitos, 4.3, pop(700), 0.30)
add(efeitos, 9.4, pop(900), 0.30)
add(efeitos, 10.4, pop(1100), 0.30)
whoosh = lowpass(rng.standard_normal(int(0.45 * SR)), 2500) * np.hanning(int(0.45 * SR))
add(efeitos, 8.3, whoosh, 0.25)
add(efeitos, 13.2, whoosh, 0.3)

# ── 3. Resolução (13,6–18 s) ────────────────────────────────────────
n3 = int(4.4 * SR)
t3 = t_of(n3)
acorde = sum(np.sin(2 * np.pi * hz(m) * t3) + 0.25 * np.sin(2 * np.pi * hz(m) * 2.003 * t3) for m in (48, 55, 60, 64, 67, 72))
acorde *= np.exp(-t3 * 0.35)
add(musica, 13.6, acorde, 0.05)
imp_n = int(0.6 * SR)
it = t_of(imp_n)
impacto = np.sin(2 * np.pi * (45 + 80 * np.exp(-it * 25)) * it) * np.exp(-it * 6)
crash = lowpass(rng.standard_normal(int(1.5 * SR)), 7000) * np.exp(-t_of(int(1.5 * SR)) * 3)
add(musica, 13.6, impacto, 0.6)
add(musica, 13.6, crash, 0.10)
for s, m in enumerate((72, 76, 79, 84)):  # brilho subindo
    add(musica, 13.9 + s * 0.12, nota(hz(m), 1.2, 'sine', 0.003, 0.5), 0.05)
add(efeitos, 14.6, pop(1000), 0.28)

# ── Mix ────────────────────────────────────────────────────────────
mix = musica + efeitos
tt = t_of(N)
mix *= np.clip((DUR - tt) / 1.5, 0, 1)  # fade de saída
mix /= max(1e-9, np.max(np.abs(mix))) / 0.9
mix = np.tanh(mix * 3.4) / np.tanh(3.4) * 0.82  # segura picos, sobe o corpo
est = np.stack([mix, mix], axis=1)
# leve abertura estéreo: arpejo/efeitos defasados 6 ms num canal
est[:, 1] = np.roll(mix, int(0.006 * SR)) * 0.35 + mix * 0.65

args = [a for a in sys.argv[1:] if not a.startswith('--')]
saida = args[0] if args else 'trilha-aviso.wav'
with wave.open(saida, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(est, -1, 1) * 32767).astype('<i2').tobytes())
print('gerado:', saida)
