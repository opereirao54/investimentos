// Põe o selo da contagem regressiva ("Faltam 68 dias") num vídeo pronto, para
// a série até o lançamento (marketing/conteudo/CALENDARIO.md). O selo fica no
// alto, à direita, abaixo do selo da série, do primeiro ao último quadro
// (inclusive na capa do primeiro quadro), e grava ao lado a capa com o selo
// (<saida>-capa.png). No dia do lançamento, use 0: o selo vira "É hoje".
//
//   node marketing/ferramentas/shorts/contagem.js entrada.mp4 68 saida.mp4 [y]
//
// y (opcional): altura do selo em px, padrão 130. Precisa do ffmpeg.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const [, , entrada, diasArg, saida, yArg] = process.argv;
const dias = Number(diasArg);
if (!entrada || !saida || !Number.isInteger(dias) || dias < 0) {
  console.error(
    'uso: node marketing/ferramentas/shorts/contagem.js entrada.mp4 <dias> saida.mp4 [y]'
  );
  process.exit(1);
}
const Y = Number(yArg) || 130;
const MK = path.join(__dirname, '..', '..');
const FONTES = fs.readFileSync(path.join(MK, '.fontes.css'), 'utf8');
const texto = dias === 0 ? 'É hoje' : `Faltam <b>${dias}</b> ${dias === 1 ? 'dia' : 'dias'}`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${FONTES}
html, body { margin: 0; background: transparent; }
.selo { display: inline-flex; align-items: center; gap: 12px; padding: 12px 24px; border-radius: 99px;
  background: rgba(11,20,16,.82); border: 2px solid #fbbf24; color: #fde68a;
  font-family: 'DM Mono', monospace; font-size: 28px; letter-spacing: .06em; white-space: nowrap; }
.selo b { color: #fbbf24; font-weight: 500; font-size: 34px; }
.selo i { width: 12px; height: 12px; border-radius: 50%; background: #fbbf24; box-shadow: 0 0 12px #fbbf24; }
</style></head><body><div class="selo" id="s"><i></i>${texto}</div></body></html>`;

(async () => {
  const { chromium } = require(path.join(MK, '..', 'node_modules', 'playwright'));
  const exe =
    process.env.CHROMIUM_PATH ||
    (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: 1080, height: 300 } });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  const png = path.join(os.tmpdir(), `selo-contagem-${process.pid}.png`);
  await (await p.$('#s')).screenshot({ path: png, omitBackground: true });
  await b.close();

  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    entrada,
    '-i',
    png,
    '-filter_complex',
    `[0:v][1:v]overlay=x=W-w-60:y=${Y}[v]`,
    '-map',
    '[v]',
    '-map',
    '0:a',
    '-map',
    '0:v:1?',
    '-c:v:0',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-c:v:1',
    'copy',
    '-disposition:v:1',
    'attached_pic',
    '-movflags',
    '+faststart',
    saida,
  ]);
  fs.rmSync(png, { force: true });
  // capa com o selo, para subir em "Editar capa" no Instagram
  const capa = saida.replace(/\.mp4$/, '-capa.png');
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    saida,
    '-map',
    '0:v:0',
    '-frames:v',
    '1',
    capa,
  ]);
  console.log('gerado: ' + saida + ' e ' + capa);
})();
