// Renderiza um vídeo de cenas HTML em MP4 (H.264, 30 fps) e, se houver
// narracao.wav na pasta, junta o áudio. Quadros em PNG (sem perda) e vídeo
// intermediário quase sem perda (crf 10): a compressão de verdade é uma só, no
// fim, em contagem.js (desde 29/10, para não somar perdas a cada etapa).
//
//   node marketing/ferramentas/shorts/render.js <pasta> [video.html]
//
// <pasta> precisa ter as telas usadas pelo HTML (telas-app.js gera). O
// modelo e as fontes da marca são copiados para lá. Precisa do ffmpeg.
//
// Legenda sincronizada (teste de 18/11): LEGENDA=<legenda.json> (gerado por
// legenda-tempos.py) queima no vídeo as palavras da fala, 2 a 4 por vez, com
// a palavra dita destacada em verde. LEGENDA_Y=<px> é o centro da faixa
// (padrão 1430; abaixo de 1540 fica fora da área que o Instagram cobre).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const pasta = path.resolve(process.argv[2] || 'shorts-saida');
const modelo = path.resolve(process.argv[3] || path.join(__dirname, 'video.html'));
const MK = path.join(__dirname, '..', '..');
const RAIZ = path.join(MK, '..');
const FPS = 30;

fs.mkdirSync(pasta, { recursive: true });
const fontes = path.join(MK, '.fontes.css');
if (!fs.existsSync(fontes)) {
  console.error('Faltam as fontes da marca. Rode ./marketing/fontes.sh primeiro.');
  process.exit(1);
}
fs.copyFileSync(fontes, path.join(pasta, 'fontes.css'));
fs.copyFileSync(path.join(RAIZ, 'appliquei-wordmark.svg'), path.join(pasta, 'wordmark.svg'));
const html = path.join(pasta, path.basename(modelo));
if (modelo !== html) fs.copyFileSync(modelo, html);

const faltam = [...fs.readFileSync(html, 'utf8').matchAll(/src="([^"]+\.(?:png|jpg))"/g)]
  .map((m) => m[1])
  .filter((f) => !fs.existsSync(path.join(pasta, f)));
if (faltam.length) {
  console.error('Faltam telas na pasta: ' + faltam.join(', ') + ' (gere com telas-app.js)');
  process.exit(1);
}

// Agrupa as palavras em linhas curtas (até 4 palavras ou ~18 letras, quebrando
// na pontuação e entre frases) e injeta a camada da legenda na página.
async function legendaPrepara(p, palavras) {
  const grupos = [];
  let g = null;
  for (const w of palavras) {
    // não fecha a linha numa palavra curta sem pontuação ("de", "São"): ela vai junto da próxima
    const ult = g && g.ws[g.ws.length - 1].w;
    const presa = ult && ult.length <= 3 && !/[,.:;!?…]$/.test(ult);
    const cheio = g && !presa && (g.ws.length >= 4 || g.ws.map((x) => x.w).join(' ').length + w.w.length > 20);
    if (!g || g.i !== w.i || cheio) grupos.push((g = { i: w.i, ws: [] }));
    g.ws.push(w);
    if (/[,.:;!?…]$/.test(w.w)) g = null;
  }
  const y = Number(process.env.LEGENDA_Y || 1430);
  await p.evaluate(
    ({ grupos, y }) => {
      const st = document.createElement('style');
      st.textContent = `
        #legenda { position: absolute; left: 70px; right: 70px; top: ${y}px; transform: translateY(-50%); z-index: 40; text-align: center; pointer-events: none; }
        #legenda .lg { display: inline-block; padding: 14px 30px 18px; border-radius: 24px; background: rgba(6,12,9,.78); box-shadow: 0 10px 30px rgba(0,0,0,.35);
          font-family: 'Figtree', sans-serif; font-weight: 900; font-size: 66px; line-height: 1.12; letter-spacing: -.015em; color: #f0faf4; }
        #legenda .w { display: inline-block; margin: 0 .12em; transition: none; }
        #legenda .w.on { color: #34d399; }
        #legenda .w.fut { color: rgba(240,250,244,.55); }`;
      document.head.appendChild(st);
      const box = document.createElement('div');
      box.id = 'legenda';
      (document.getElementById('palco') || document.body).appendChild(box);
      let atual = -1;
      window.__legenda = (t) => {
        // grupo da vez: do início da 1ª palavra até o início do próximo grupo
        // (ou 0,35 s depois da última palavra, se vier uma pausa)
        let k = -1;
        for (let j = 0; j < grupos.length; j++) {
          const ini = grupos[j].ws[0].t0 - 0.05;
          const ult = grupos[j].ws[grupos[j].ws.length - 1].t1;
          const prox = j + 1 < grupos.length ? grupos[j + 1].ws[0].t0 - 0.05 : Infinity;
          if (t >= ini && t < Math.min(prox, ult + 0.35)) k = j;
        }
        if (k !== atual) {
          atual = k;
          box.innerHTML = k < 0 ? '' : '<span class="lg">' + grupos[k].ws.map((w, n) => `<span class="w" data-n="${n}">${w.w}</span>`).join('') + '</span>';
        }
        if (k < 0) return;
        const g = grupos[k];
        const lg = box.firstChild;
        const p0 = Math.min(1, (t - g.ws[0].t0 + 0.05) / 0.12);
        lg.style.transform = `scale(${0.92 + 0.08 * p0})`;
        lg.style.opacity = p0;
        box.querySelectorAll('.w').forEach((el, n) => {
          const w = g.ws[n];
          el.className = 'w' + (t >= w.t0 && t < w.t1 ? ' on' : t < w.t0 ? ' fut' : '');
          const pop = t >= w.t0 && t < w.t0 + 0.15 ? 1 + 0.08 * Math.sin(((t - w.t0) / 0.15) * Math.PI) : 1;
          el.style.transform = `scale(${pop})`;
        });
      };
    },
    { grupos, y }
  );
}

(async () => {
  const { chromium } = require(path.join(RAIZ, 'node_modules', 'playwright'));
  const exe =
    process.env.CHROMIUM_PATH ||
    (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('file://' + html);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);
  if (process.env.LEGENDA) await legendaPrepara(p, JSON.parse(fs.readFileSync(process.env.LEGENDA, 'utf8')));
  const dur = await p.evaluate(() => (typeof DUR !== 'undefined' ? DUR : 30));
  const quadros = path.join(pasta, 'quadros');
  fs.rmSync(quadros, { recursive: true, force: true });
  fs.mkdirSync(quadros);
  const n = Math.round(dur * FPS);
  for (let i = 0; i < n; i++) {
    await p.evaluate((t) => {
      render(t);
      if (window.__legenda) window.__legenda(t);
    }, i / FPS);
    await p.screenshot({
      path: path.join(quadros, String(i).padStart(5, '0') + '.png'),
      type: 'png',
    });
    if (i % 150 === 0) process.stdout.write(`quadro ${i}/${n}\n`);
  }
  await b.close();

  const mudo = path.join(pasta, 'video-sem-audio.mp4');
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    path.join(quadros, '%05d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'high',
    '-crf',
    '10',
    '-preset',
    'slow',
    '-movflags',
    '+faststart',
    mudo,
  ]);
  console.log('gerado:', mudo);
  const voz = path.join(pasta, 'narracao.wav');
  if (fs.existsSync(voz)) {
    const final = path.join(pasta, 'video-narrado.mp4');
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      mudo,
      '-i',
      voz,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      final,
    ]);
    console.log('gerado:', final);
  }
  fs.rmSync(quadros, { recursive: true, force: true });
})();
