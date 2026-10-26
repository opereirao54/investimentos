// Os 3 posts fixados do perfil: uma imagem panorâmica (3240×1440) cortada em
// 3 posts de 1080×1440 (3:4, o formato da grade) que, lado a lado na grade, formam uma peça só — a
// frase grande atravessa os três, e cada post tem um bloco: Missão, Visão e
// Valores (tirados do carrossel "Por que o Appliquei existe").
//
//   node marketing/conteudo/fixados/gerar-fixados.js
//
// Gera fixado-1.png, fixado-2.png, fixado-3.png (ordem de postagem: 3, 2, 1,
// para o 1 ficar à esquerda na grade) e grade.png (prévia de como fica no
// perfil).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MK = path.join(__dirname, '..', '..');
const FONTES = fs.readFileSync(path.join(MK, '.fontes.css'), 'utf8');
const WM = fs.readFileSync(path.join(MK, '..', 'appliquei-wordmark.svg')).toString('base64');

const malha = [];
for (let x = 60; x < 3240; x += 60)
  malha.push(`<line x1="${x}" y1="0" x2="${x}" y2="1440" stroke="#f0faf4" stroke-opacity=".03"/>`);
for (let y = 60; y < 1440; y += 60)
  malha.push(`<line x1="0" y1="${y}" x2="3240" y2="${y}" stroke="#f0faf4" stroke-opacity=".03"/>`);

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
${FONTES}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 3240px; height: 1440px; overflow: hidden; }
body { font-family: 'Figtree', sans-serif; -webkit-font-smoothing: antialiased; color: #f0faf4; position: relative;
  background: linear-gradient(120deg, #0b1410 0%, #0f1f18 45%, #112720 100%); }
.halo { position: absolute; inset: 0;
  background: radial-gradient(28% 55% at 50% 48%, rgba(16,185,129,.30), transparent 70%),
              radial-gradient(22% 40% at 12% 85%, rgba(5,150,105,.2), transparent 70%),
              radial-gradient(22% 40% at 90% 15%, rgba(251,191,36,.10), transparent 70%); }
svg.malha { position: absolute; inset: 0; }
/* a frase que atravessa os três posts */
.faixa { position: absolute; left: 0; right: 0; top: 470px; text-align: center; white-space: nowrap;
  font-family: 'Syne', 'Figtree', sans-serif; font-weight: 800; font-size: 150px; letter-spacing: -.03em; line-height: 1;
  color: #f0faf4; text-shadow: 0 20px 60px rgba(0,0,0,.45); }
.faixa em { font-style: normal; color: #34d399; }
.sub { position: absolute; left: 0; right: 0; top: 700px; text-align: center; font-family: 'DM Mono', monospace; font-size: 34px;
  letter-spacing: .32em; text-transform: uppercase; color: #9fb3aa; }
/* um bloco por post */
.bloco { position: absolute; top: 840px; width: 900px; padding: 46px 50px; border-radius: 40px;
  background: rgba(11,20,16,.72); border: 2px solid rgba(52,211,153,.4); box-shadow: 0 30px 70px rgba(0,0,0,.35); }
.bloco .rot { font-family: 'DM Mono', monospace; font-size: 30px; letter-spacing: .2em; text-transform: uppercase; color: #34d399; }
.bloco b { display: block; margin-top: 18px; font-size: 50px; font-weight: 900; letter-spacing: -.02em; line-height: 1.15; }
.bloco b em { font-style: normal; color: #fbbf24; }
.bloco ul { list-style: none; margin-top: 18px; }
.bloco li { font-size: 40px; font-weight: 800; line-height: 1.45; }
.bloco li span { color: #34d399; margin-right: 14px; }
.logo { position: absolute; top: 70px; width: 260px; }
.num { position: absolute; bottom: 60px; font-family: 'DM Mono', monospace; font-size: 26px; letter-spacing: .14em; color: #6f8a7f; }
</style></head><body>
<div class="halo"></div><svg class="malha" viewBox="0 0 3240 1440">${malha.join('')}</svg>
<img class="logo" style="left:90px" src="data:image/svg+xml;base64,${WM}" alt="Appliquei">
<div class="faixa">Dinheiro com <em>direção.</em></div>
<div class="sub">por que o Appliquei existe</div>

<div class="bloco" style="left:90px">
  <div class="rot">Missão</div>
  <b>Ajudar você a enxergar o próprio dinheiro de um jeito diferente, e a transformar <em>organização em conquistas.</em></b>
</div>
<div class="bloco" style="left:1170px">
  <div class="rot">Visão</div>
  <b>Ser o lugar onde o brasileiro cuida do <em>dinheiro inteiro</em>: do gasto de hoje ao patrimônio de amanhã, sem complicação.</b>
</div>
<div class="bloco" style="left:2250px">
  <div class="rot">Valores</div>
  <ul>
    <li><span>●</span>Clareza: saber pra onde vai cada real</li>
    <li><span>●</span>Constância: pequenas atitudes, todo dia</li>
    <li><span>●</span>Propósito: dinheiro a serviço dos sonhos</li>
    <li><span>●</span>Honestidade: sem promessa fácil</li>
  </ul>
</div>
<div class="num" style="left:90px">01 / 03</div>
<div class="num" style="left:1170px">02 / 03</div>
<div class="num" style="left:2250px">03 / 03</div>
</body></html>`;

(async () => {
  const { chromium } = require(path.join(MK, '..', 'node_modules', 'playwright'));
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: 3240, height: 1440 } });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  const pano = path.join(__dirname, 'panorama.png');
  await p.screenshot({ path: pano });
  await b.close();
  for (let i = 0; i < 3; i++) {
    const saida = path.join(__dirname, `fixado-${i + 1}.png`);
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      pano,
      '-vf',
      `crop=1080:1440:${i * 1080}:0`,
      saida,
    ]);
  }
  // prévia da grade: os três lado a lado, com a fresta branca da grade
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    path.join(__dirname, 'fixado-1.png'),
    '-i',
    path.join(__dirname, 'fixado-2.png'),
    '-i',
    path.join(__dirname, 'fixado-3.png'),
    '-filter_complex',
    '[0]pad=iw+6:ih:0:0:white[a];[1]pad=iw+6:ih:0:0:white[b];[a][b][2]hstack=3,scale=1200:-1',
    path.join(__dirname, 'grade.png'),
  ]);
  console.log('gerado: fixado-1..3.png, panorama.png e grade.png em', __dirname);
})();
