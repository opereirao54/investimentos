"""Narração do teaser de lançamento com o TTS do Gemini, no mesmo roteiro e nos
mesmos tempos de narrar-kokoro.py, e na mesma saída (seg0–7.wav + partes.json),
para mixar com mixar-narracao.py.

    pip install soundfile numpy praat-parselmouth
    export GEMINI_API_KEY=...
    python3 marketing/ferramentas/shorts/narrar-gemini.py <pasta-saida> [voz] [modelo]
    python3 marketing/ferramentas/shorts/mixar-narracao.py <pasta-saida> trilha.wav video-sem-audio.mp4 final.mp4

    # refazer o corte e a entonação de uma leitura já baixada, sem gastar cota:
    LEITURA=<pasta-saida>/leitura0.wav python3 marketing/ferramentas/shorts/narrar-gemini.py <pasta-saida>

Voz padrão da marca: Charon (escolhida pelo fundador para o teaser de
lançamento; mantenha nas próximas peças). Também testadas em pt-BR: Achird
(masc., amigável) e Sulafat (fem., calorosa). Modelo padrão:
gemini-2.5-flash-preview-tts. A leitura que virou o teaser está guardada em
marketing/lancamento-janeiro/narracao-charon-leitura.wav (o Gemini não repete a
mesma leitura duas vezes; use LEITURA= com ela para refazer os cortes). O plano
gratuito da API dá 10 pedidos por dia por modelo, por isso o roteiro inteiro sai
num pedido só (com uma direção de leitura) e é cortado nas pausas entre as
linhas; o corte confere se a duração de cada pedaço bate com o tamanho do texto
e, se não bater, pede a leitura de novo (até 3 vezes).

O Gemini muitas vezes lê "Quanto você gasta?" com o tom caindo, mesmo pedindo
entonação de pergunta. A subida é medida no áudio (pico de tom na última
palavra sobre o tom mediano da frase, com o Praat); abaixo de 1,15 a pergunta
recebe a subida por PSOLA de narrar-kokoro.py, mais forte se a primeira não
bastar.

Não há parâmetro de velocidade: se a frase não couber na janela da cena, ela é
acelerada com atempo (mantém o tom), até 1,25x. Limpeza igual à do Kokoro:
corta o silêncio das pontas, passa-alta 85 Hz, passa-baixa 9,5 kHz, redução de
ruído leve e suaviza a entrada e a saída.
"""
import base64, io, json, os, re, subprocess, sys, time, urllib.error, urllib.request
import numpy as np
import soundfile as sf

OUT = sys.argv[1]
VOZ = sys.argv[2] if len(sys.argv) > 2 else 'Charon'
MODELO = sys.argv[3] if len(sys.argv) > 3 else 'gemini-2.5-flash-preview-tts'
CHAVE = os.environ.get('GEMINI_API_KEY')
# Mesmo roteiro e tempos de narrar-kokoro.py: (início, fim, texto).
CENAS = [
    (0.25, 3.9, "Você sabe quanto realmente tem?"),
    (4.25, 8.8, "Você trabalha, recebe seu dinheiro... mas sabe para onde ele está indo?"),
    (9.1, 10.4, "Quanto você gasta?"),
    (10.42, 11.75, "Quanto já acumulou?"),
    (11.8, 13.9, "E como estão seus investimentos?"),
    (14.45, 22.3, "Com o Appliquei, você organiza suas finanças, acompanha seus investimentos e vê seu patrimônio, em um só lugar."),
    (22.55, 26.75, "Cuidar do seu dinheiro hoje é construir o futuro que você deseja amanhã."),
    (26.95, 30.6, "Appliquei. Seu dinheiro precisa de direção. Em breve."),
]
DIRECAO = ('Leia em voz alta, em português do Brasil, como locutor de um comercial de '
           'app de finanças pessoais: voz próxima, confiante e natural, sem exagero. '
           'As frases com ponto de interrogação são perguntas ao espectador: leia com '
           'entonação de pergunta, com o tom subindo no fim. Faça uma pausa longa '
           'entre uma linha e outra. Leia só as linhas abaixo:\n\n')


def pedir(texto):
    corpo = {
        'contents': [{'parts': [{'text': texto}]}],
        'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': {
            'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': VOZ}}}},
    }
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{MODELO}:generateContent'
    for tentativa in range(5):
        req = urllib.request.Request(url, data=json.dumps(corpo).encode(), headers={
            'x-goog-api-key': CHAVE, 'Content-Type': 'application/json'})
        try:
            d = json.load(urllib.request.urlopen(req, timeout=180))
            dado = d['candidates'][0]['content']['parts'][0]['inlineData']
            break
        except urllib.error.HTTPError as e:
            corpo_erro = e.read().decode()
            # cota diária do plano gratuito: não adianta esperar
            if tentativa == 4 or 'PerDay' in corpo_erro:
                sys.exit(f'Gemini {e.code}: {corpo_erro[:400]}')
            print('  repetindo após erro', e.code)
            time.sleep(8 * 2 ** tentativa)
    cru = base64.b64decode(dado['data'])
    if cru[:4] == b'RIFF':
        a, sr = sf.read(io.BytesIO(cru), dtype='float32')
    else:  # audio/L16;codec=pcm;rate=24000
        taxa = re.search(r'rate=(\d+)', dado['mimeType'])
        sr = int(taxa.group(1)) if taxa else 24000
        a = np.frombuffer(cru, dtype='<i2').astype(np.float32) / 32768
    return a, sr


def cortar(a, sr, n):
    """Divide a leitura do roteiro inteiro nas n-1 pausas mais longas.

    Confere se cada pedaço tem duração coerente com o tamanho do texto; se não
    tiver (uma pausa interna foi mais longa que a pausa entre frases), devolve
    None e a leitura é pedida de novo.
    """
    q = int(0.02 * sr)
    rms = np.sqrt(np.convolve(a ** 2, np.ones(q) / q, 'same'))[::q]
    fala = rms > 0.01
    pausas, k = [], 0
    while k < len(fala):
        if not fala[k]:
            j = k
            while j < len(fala) and not fala[j]:
                j += 1
            if k > 0 and j < len(fala):
                pausas.append((j - k, (k + j) // 2 * q))
            k = j
        else:
            k += 1
    if len(pausas) < n - 1:
        return None
    cortes = sorted(p for _, p in sorted(pausas, reverse=True)[:n - 1])
    pedacos = [aparar(x, sr) for x in np.split(a, cortes)]
    chars = np.array([len(t) for _, _, t in CENAS], dtype=float)
    durs = np.array([len(x) / sr for x in pedacos])
    razao = (durs / durs.sum()) / (chars / chars.sum())
    print('  pedaços', np.round(durs, 2), 'proporção', np.round(razao, 2))
    if razao.min() < 0.45 or razao.max() > 2.2:
        return None
    return pedacos


def subida(a, sr):
    """Pico de tom na última palavra (~0,35 s finais de voz) sobre o tom mediano
    da frase: acima de 1 a pergunta sobe no fim; abaixo, o tom cai."""
    import parselmouth
    pitch = parselmouth.Sound(a.astype(np.float64), sampling_frequency=sr).to_pitch(
        time_step=0.01, pitch_floor=75, pitch_ceiling=320)
    f0 = pitch.selected_array['frequency']
    voz = np.where(f0 > 85)[0]
    if len(voz) < 10:
        return 1.0
    fim = f0[voz[voz >= voz[-1] - 35]]
    return float(np.max(fim) / np.median(f0[voz]))


def entonar_pergunta(a, sr, subida=1.22, janela=0.5):
    """Sobe o tom no fim da frase, como numa pergunta.

    Cópia da de narrar-kokoro.py (lá o import carrega o modelo do Kokoro). Só
    entra quando a pergunta do Gemini saiu com o tom caindo no fim.

    A edição é feita com o PSOLA do Praat (parselmouth): só a curva de tom muda,
    o timbre e a duração ficam, e soa bem menos metálico que um phase vocoder.
    O trecho final segue uma rampa até `subida` vezes o tom médio da frase
    (nunca abaixa o tom original); o resto da frase fica intacto e as duas
    partes se emendam com 30 ms de transição.
    """
    import parselmouth
    from parselmouth.praat import call

    snd = parselmouth.Sound(a.astype(np.float64), sampling_frequency=sr)
    pitch = snd.to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=320)
    f0 = pitch.selected_array['frequency']
    tempos = pitch.xs()
    voz = f0 > 85  # abaixo disso é voz rangida, não tom
    if voz.sum() < 5:
        return a
    base = float(np.median(f0[voz]))
    t_fim = float(tempos[np.where(voz)[0][-1]])
    t_ini = max(float(tempos[np.where(voz)[0][0]]), t_fim - janela)
    if t_fim - t_ini < 0.08:
        return a
    manip = call(snd, 'To Manipulation', 0.01, 75, 320)
    tier = call(manip, 'Extract pitch tier')
    v_ini = call(tier, 'Get value at time', t_ini)
    alvo = base * subida
    pontos = []
    for t in np.arange(t_ini, t_fim + 0.0001, 0.01):
        x = (t - t_ini) / (t_fim - t_ini)
        desejado = v_ini + (alvo - v_ini) * x ** 1.2
        original = call(tier, 'Get value at time', float(t))
        pontos.append((float(t), max(original, desejado)))
    call(tier, 'Remove points between', t_ini, t_fim + 0.08)
    for t, v in pontos:
        call(tier, 'Add point', t, v)
    call(tier, 'Add point', t_fim + 0.06, pontos[-1][1])
    call([tier, manip], 'Replace pitch tier')
    novo = call(manip, 'Get resynthesis (overlap-add)').values[0].astype(np.float32)
    novo = np.pad(novo, (0, max(0, len(a) - len(novo))))[: len(a)]
    # emenda: original até pouco antes da rampa, PSOLA dali em diante
    i0 = max(0, int((t_ini - 0.04) * sr))
    xf = int(0.03 * sr)
    out = a.copy()
    out[i0 + xf:] = novo[i0 + xf:]
    w = np.linspace(0, 1, xf)
    out[i0:i0 + xf] = a[i0:i0 + xf] * (1 - w) + novo[i0:i0 + xf] * w
    return out


def aparar(a, sr, limiar=0.01):
    """Corta o silêncio (e o ruído) antes da primeira e depois da última sílaba."""
    idx = np.where(np.abs(a) > limiar)[0]
    if not len(idx):
        return a
    return a[max(0, idx[0] - int(0.015 * sr)):min(len(a), idx[-1] + int(0.06 * sr))]


os.makedirs(OUT, exist_ok=True)
roteiro = DIRECAO + '\n'.join(t for _, _, t in CENAS)
for tentativa in range(3):
    if os.environ.get('LEITURA'):
        a, sr = sf.read(os.environ['LEITURA'], dtype='float32')
    else:
        a, sr = pedir(roteiro)
        sf.write(f'{OUT}/leitura{tentativa}.wav', a, sr)
    pedacos = cortar(a, sr, len(CENAS))
    if pedacos or os.environ.get('LEITURA'):
        break
if not pedacos:
    sys.exit('não consegui dividir a leitura nas frases; ouça leitura*.wav')

partes = []
for n, ((ini, fim, txt), a) in enumerate(zip(CENAS, pedacos)):
    janela = fim - ini
    d = len(a) / sr
    s = subida(a, sr)
    if txt.endswith('?') and s < 1.15:
        # pergunta saiu com cara de afirmação: sobe o fim por PSOLA
        print(f'  {n} entonada por PSOLA: subida {s:.2f}', end='')
        for forca in (1.22, 1.32, 1.42):
            b = entonar_pergunta(a, sr, subida=forca)
            sb = subida(b, sr)
            print(f' -> {sb:.2f}', end='')
            if sb >= 1.15:
                break
        a, s = b, sb
        print()
    bruto = f'{OUT}/bruto{n}.wav'
    sf.write(bruto, a, sr)
    vel = 1.0 if d <= janela else min(1.25, d / janela * 1.02)
    tempo = f'atempo={vel:.3f},' if vel > 1 else ''
    d = d / vel
    fd = max(0.0, d - 0.05)
    limpo = f'{OUT}/seg{n}.wav'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', bruto, '-af',
                    f'aresample=48000,{tempo}highpass=f=85,lowpass=f=9500,'
                    'afftdn=nr=5:nf=-50,'
                    f'afade=t=in:st=0:d=0.012,afade=t=out:st={fd:.3f}:d=0.05',
                    '-ar', '48000', limpo], check=True)
    partes.append([ini, limpo, round(d, 2), round(vel, 2)])
    print(n, round(d, 2), 'de', round(janela, 2), 'vel', round(vel, 2), 'subida', round(s, 2))
json.dump(partes, open(f'{OUT}/partes.json', 'w'))
