// Põe o selo da contagem regressiva ("Faltam 68 dias") num vídeo pronto, para
// a série até o lançamento (marketing/conteudo/CALENDARIO.md). O selo fica no
// alto, à direita, abaixo do selo da série, do primeiro ao último quadro
// (inclusive na capa do primeiro quadro), e grava ao lado a capa com o selo
// (<saida>-capa.png). No dia do lançamento, use 0: o selo vira "É hoje".
//
//   node marketing/ferramentas/shorts/contagem.js entrada.mp4 68 saida.mp4 [y]
//
// y (opcional): altura do selo em px, padrão 130. Precisa do ffmpeg.
// SELO_DESDE=<s>: o selo só entra a partir desse segundo, e a capa .png sai
// sem ele (série Appliquei: a capa e a vinheta já trazem a contagem).

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
const DESDE = Number(process.env.SELO_DESDE || 0);
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
    // perfil "C" (teste do fundador no Instagram, 29/10): sem granulado, um leve
    // reforço de nitidez nas letras e cores marcadas em BT.709
    `[0:v:0][1:v]overlay=x=W-w-60:y=${Y}${DESDE ? `:enable='gte(t,${DESDE})'` : ''},unsharp=5:5:0.4:5:5:0,scale=out_color_matrix=bt709,format=yuv420p[v]`,
    '-map',
    '[v]',
    '-map',
    '0:a',
    '-map',
    '0:v:1?',
    '-c:v:0',
    'libx264',
    // a única compressão final do vídeo (as etapas antes são quase sem perda)
    '-b:v',
    '10M',
    '-minrate',
    '8M',
    '-maxrate',
    '12M',
    '-bufsize',
    '20M',
    '-preset',
    'slow',
    '-tune',
    'animation',
    '-profile:v:0',
    'high',
    '-level:v:0',
    '4.2',
    '-g:v:0',
    '60',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_range',
    'tv',
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
  // capa com o selo, para subir em "Editar capa" no Instagram: o selo vai por
  // cima da capa embutida (PNG, sem perda); sem capa embutida, usa o 1º quadro
  const capa = saida.replace(/\.mp4$/, '-capa.png');
  try {
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      entrada,
      '-i',
      png,
      '-filter_complex',
      DESDE ? '[0:v:1]null' : `[0:v:1][1:v]overlay=x=W-w-60:y=${Y}`,
      '-frames:v',
      '1',
      capa,
    ]);
  } catch {
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
  }
  fs.rmSync(png, { force: true });
  console.log('gerado: ' + saida + ' e ' + capa);
})();
