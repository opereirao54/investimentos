// Renderiza um vídeo de cenas HTML em MP4 (H.264, 30 fps) e, se houver
// narracao.wav na pasta, junta o áudio. Quadros em PNG (sem perda) e vídeo
// intermediário quase sem perda (crf 10): a compressão de verdade é uma só, no
// fim, em contagem.js (desde 29/10, para não somar perdas a cada etapa).
//
//   node marketing/ferramentas/shorts/render.js <pasta> [video.html]
//
// <pasta> precisa ter as telas usadas pelo HTML (telas-app.js gera). O
// modelo e as fontes da marca são copiados para lá. Precisa do ffmpeg.

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
  const dur = await p.evaluate(() => (typeof DUR !== 'undefined' ? DUR : 30));
  const quadros = path.join(pasta, 'quadros');
  fs.rmSync(quadros, { recursive: true, force: true });
  fs.mkdirSync(quadros);
  const n = Math.round(dur * FPS);
  for (let i = 0; i < n; i++) {
    await p.evaluate((t) => render(t), i / FPS);
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
