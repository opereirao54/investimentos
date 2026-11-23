"""Tempos de cada palavra da narração, para a legenda sincronizada.

    python3 marketing/ferramentas/shorts/legenda-tempos.py <pasta-voz> <narracao.json> <legenda.json>

<pasta-voz> é a saída do narrar-gemini.py (partes.json + seg*.wav, já no tempo
do vídeo). Para cada frase, acha no áudio os trechos com voz (as pausas mais
longas que 0,08 s separam um trecho do outro), casa as pausas com a pontuação
do texto e distribui as palavras de cada trecho pelo número de sílabas
(grupos de vogais). Não é alinhamento fonético, mas erra pouco: cada pausa da
fala vira um ponto de acerto.

Saída: [{"i": frase, "t0": s, "t1": s, "w": "palavra"}, ...] em segundos do
vídeo (sem a capa de 0,1 s, que o render não vê).
"""
import json
import os
import re
import sys

import numpy as np
import soundfile as sf

VOZ, ROTEIRO, SAIDA = sys.argv[1:4]
partes = json.load(open(os.path.join(VOZ, 'partes.json')))
frases = [f[2] for f in json.load(open(ROTEIRO))]
VOGAIS = re.compile(r'[aeiouáéíóúâêôãõày]+', re.I)


def silabas(p):
    return max(1, len(VOGAIS.findall(p)))


def trechos(arq):
    """Trechos com voz [(ini, fim)] em segundos dentro do arquivo."""
    a, sr = sf.read(arq, dtype='float32')
    if a.ndim > 1:
        a = a.mean(axis=1)
    jan = int(sr * 0.02)
    n = len(a) // jan
    rms = np.sqrt((a[: n * jan].reshape(n, jan) ** 2).mean(axis=1) + 1e-12)
    limiar = max(rms.max() * 0.06, 1e-4)
    voz = rms > limiar
    out, ini, sil = [], None, 0
    for k, v in enumerate(voz):
        if v:
            if ini is None:
                ini = k
            sil = 0
        elif ini is not None:
            sil += 1
            if sil * 0.02 >= 0.08:
                out.append((ini * 0.02, (k - sil + 1) * 0.02))
                ini, sil = None, 0
    if ini is not None:
        out.append((ini * 0.02, n * 0.02))
    return out


saida = []
for i, (txt, (t0, arq, dur, _vel)) in enumerate(zip(frases, partes)):
    palavras = txt.replace('...', '…').split()
    # blocos de texto separados pela pontuação que costuma virar pausa
    blocos, atual = [], []
    for p in palavras:
        atual.append(p)
        if re.search(r'[,.:;!?…]$', p):
            blocos.append(atual)
            atual = []
    if atual:
        blocos.append(atual)
    tr = trechos(arq)
    # junta os trechos de voz até ficarem tantos quantos os blocos (as menores
    # pausas somem primeiro); se houver menos trechos, junta blocos
    while len(tr) > len(blocos):
        k = min(range(len(tr) - 1), key=lambda j: tr[j + 1][0] - tr[j][1])
        tr[k : k + 2] = [(tr[k][0], tr[k + 1][1])]
    while len(blocos) > len(tr) and len(blocos) > 1:
        k = min(range(len(blocos) - 1), key=lambda j: len(blocos[j]) + len(blocos[j + 1]))
        blocos[k : k + 2] = [blocos[k] + blocos[k + 1]]
    if not tr:
        tr = [(0, dur)]
    for bloco, (a, b) in zip(blocos, tr):
        s = [silabas(p) for p in bloco]
        tot, acc = sum(s), 0
        for p, n in zip(bloco, s):
            w0 = a + (b - a) * acc / tot
            acc += n
            w1 = a + (b - a) * acc / tot
            saida.append({'i': i, 't0': round(t0 + w0, 3), 't1': round(t0 + w1, 3), 'w': p})

json.dump(saida, open(SAIDA, 'w'), ensure_ascii=False, indent=0)
print(f'gerado: {SAIDA} ({len(saida)} palavras)')
