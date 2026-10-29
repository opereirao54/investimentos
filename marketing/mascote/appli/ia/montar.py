"""Monta o vídeo final do Appli a partir das cenas do Wan 2.2: junta as cenas,
sobe para 1080×1920 a 30 fps (etapas em crf 10 e uma só compressão final,
crf 16 slow, como no padrão de qualidade de COMBINADOS.md), põe a voz Charon, a legenda de cada frase e um
fecho com a marca sobre o último quadro.

    python3 marketing/mascote/appli/ia/montar.py <pasta-das-cenas> <saida.mp4>

Precisa do ffmpeg, do Playwright do Node em node_modules (para desenhar legenda e marca com as fontes
da marca) e de marketing/.fontes.css (rode marketing/fontes.sh).
"""
import glob, json, os, subprocess, sys, tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
MK = os.path.join(AQUI, '..', '..', '..')
RAIZ = os.path.join(MK, '..')
VOZ = os.path.join(AQUI, '..', 'voz', 'apresentacao-charon.wav')
FECHO = 2.6  # segundos de marca depois da última fala

# (início, fim, texto) — tempos medidos nas pausas da voz Charon
LEGENDAS = [
    (0.00, 1.90, 'Oi! Eu sou o <em>Appli</em>.'),
    (2.00, 3.60, 'A moedinha do Appliquei.'),
    (3.75, 4.80, 'Meu trabalho?'),
    (4.85, 7.40, 'Te ajudar a ver pra onde vai <em>cada real</em>…'),
    (7.50, 10.50, '…e transformar organização em <em>conquista</em>.'),
    (10.65, 12.95, 'Sem planilha, sem complicação.'),
    (13.05, 15.85, 'Porque o seu dinheiro precisa de <em>direção</em>.'),
    (16.10, 18.45, 'A gente se vê no dia <em>2 de janeiro</em>.'),
    (18.55, 19.60, 'Bora junto?'),
]

pasta, saida = sys.argv[1], sys.argv[2]
cenas = sorted(glob.glob(os.path.join(pasta, 'cena[0-9].mp4')))
tmp = tempfile.mkdtemp()
fontes = open(os.path.join(MK, '.fontes.css')).read()
wordmark = open(os.path.join(RAIZ, 'appliquei-wordmark.svg')).read()


def ff(*a):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *a], check=True)


# 1. Cenas juntas, em 1080×1920 a 30 fps (o Wan sai 480×832 a 16 fps)
lista = os.path.join(tmp, 'lista.txt')
open(lista, 'w').write(''.join(f"file '{os.path.abspath(c)}'\n" for c in cenas))
corpo = os.path.join(tmp, 'corpo.mp4')
ff('-f', 'concat', '-safe', '0', '-i', lista, '-vf',
   'scale=1108:1920:flags=lanczos,crop=1080:1920,fps=30,setsar=1', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', corpo)
dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', corpo],
                           capture_output=True, text=True).stdout)

# 2. Legendas e fecho desenhados em PNG transparente
html = lambda corpo_html: f"""<!doctype html><html><head><meta charset="utf-8"><style>{fontes}
html,body{{margin:0;width:1080px;height:1920px;background:transparent;font-family:'Figtree',sans-serif}}
.leg{{position:absolute;left:70px;right:70px;top:300px;text-align:center}}
.leg span{{display:inline;padding:10px 22px;line-height:1.5;border-radius:18px;background:rgba(6,40,26,.82);color:#f0faf4;
 font-weight:900;font-size:64px;letter-spacing:-.02em;-webkit-box-decoration-break:clone;box-decoration-break:clone}}
.leg em{{font-style:normal;color:#34d399}}
.fecho{{position:absolute;inset:0;background:rgba(8,22,16,.72);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px}}
.fecho svg{{width:620px;height:auto}}
.fecho p{{margin:0;color:#f0faf4;font-weight:900;font-size:72px;letter-spacing:-.03em}}
.fecho p em{{font-style:normal;color:#fbbf24}}
.fecho small{{font-family:'DM Mono',monospace;font-size:30px;letter-spacing:.2em;color:#9fb3aa;text-transform:uppercase}}
</style></head><body>{corpo_html}</body></html>"""

pedidos = [[html(f'<div class="leg"><span>{t}</span></div>'), os.path.join(tmp, f'leg{i}.png')] for i, (_, _, t) in enumerate(LEGENDAS)]
pedidos.append([html(f'<div class="fecho">{wordmark}<p>Seu dinheiro precisa de <em>direção</em>.</p><small>Em 02/01/2027</small></div>'),
                os.path.join(tmp, 'fecho.png')])
json.dump(pedidos, open(os.path.join(tmp, 'pedidos.json'), 'w'))
JS = """const {chromium} = require(process.argv[2]); const ps = require(process.argv[3]);
(async () => { const b = await chromium.launch(); const pg = await b.newPage({viewport: {width: 1080, height: 1920}});
for (const [h, o] of ps) { await pg.setContent(h); await pg.waitForTimeout(150); await pg.screenshot({path: o, omitBackground: true}); }
await b.close(); })();"""
open(os.path.join(tmp, 'desenha.js'), 'w').write(JS)
subprocess.run(['node', os.path.join(tmp, 'desenha.js'), os.path.join(os.path.abspath(RAIZ), 'node_modules', 'playwright'),
                os.path.join(tmp, 'pedidos.json')], check=True)

# 3. Fecho: o último quadro parado, com a marca entrando por cima
ultimo = os.path.join(tmp, 'ultimo.png')
ff('-sseof', '-0.05', '-i', corpo, '-update', '1', '-frames:v', '1', ultimo)
fim = os.path.join(tmp, 'fim.mp4')
ff('-loop', '1', '-t', str(FECHO), '-framerate', '30', '-i', ultimo, '-loop', '1', '-t', str(FECHO), '-framerate', '30',
   '-i', os.path.join(tmp, 'fecho.png'), '-filter_complex',
   '[1:v]format=rgba,fade=t=in:st=0:d=0.4:alpha=1[f];[0:v][f]overlay=0:0,format=yuv420p,setsar=1',
   '-c:v', 'libx264', '-crf', '10', fim)
lista2 = os.path.join(tmp, 'lista2.txt')
open(lista2, 'w').write(f"file '{corpo}'\nfile '{fim}'\n")
tudo = os.path.join(tmp, 'tudo.mp4')
ff('-f', 'concat', '-safe', '0', '-i', lista2, '-c', 'copy', tudo)

# 4. Legendas por cima, voz Charon e normalização
ent, filt, ult = ['-i', tudo], [], '0:v'
for i, (a, z, _) in enumerate(LEGENDAS):
    ent += ['-i', os.path.join(tmp, f'leg{i}.png')]
    filt.append(f"[{ult}][{i + 1}:v]overlay=0:0:enable='between(t,{a},{min(z, dur)})'[v{i}]")
    ult = f'v{i}'
ent += ['-i', VOZ]
na = len(LEGENDAS) + 1
filt.append(f'[{na}:a]apad,loudnorm=I=-15:TP=-1.5[a]')
ff(*ent, '-filter_complex', ';'.join(filt), '-map', f'[{ult}]', '-map', '[a]', '-t', str(dur + FECHO),
   '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-maxrate', '12M', '-bufsize', '24M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', saida)
print('gerado:', saida, round(dur + FECHO, 2), 's')
