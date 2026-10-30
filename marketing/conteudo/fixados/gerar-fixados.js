// Os 3 posts fixados do perfil: 3 posts 4:5 (1080×1350) que, lado a lado na
// grade, formam uma peça só (o logo atravessa os três) com um bloco por post:
// Missão, Visão e Valores (tirados do carrossel "Por que o Appliquei existe").
//
// A grade do Instagram mostra cada post em 3:4 e corta 34 px de cada lado de
// um post 4:5. Por isso o desenho é feito numa tela de 3036×1350 (3 × 1012, só
// o que a grade mostra) e cada post ganha 34 px de fundo espelhado em cada
// lateral: na grade, as emendas fecham sem perder nada. Postar em 4:5 (o
// padrão do Instagram), sem recortar.
//
//   node marketing/conteudo/fixados/gerar-fixados.js [logo|direcao|conquistas]
//
// Gera fixado-1.png, fixado-2.png, fixado-3.png (ordem de postagem: 3, 2, 1,
// para o 1 ficar à esquerda na grade) e grade.png (prévia do perfil, com o
// corte da grade).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MK = path.join(__dirname, '..', '..');
const FONTES = fs.readFileSync(path.join(MK, '.fontes.css'), 'utf8');
const WM = fs.readFileSync(path.join(MK, '..', 'appliquei-wordmark.svg')).toString('base64');

const malha = [];
for (let x = 60; x < 3036; x += 60)
  malha.push(`<line x1="${x}" y1="0" x2="${x}" y2="1350" stroke="#f0faf4" stroke-opacity=".03"/>`);
for (let y = 60; y < 1350; y += 60)
  malha.push(`<line x1="0" y1="${y}" x2="3036" y2="${y}" stroke="#f0faf4" stroke-opacity=".03"/>`);

const VARIANTES = {
  logo: {
    topo: `<img class="faixa-logo" src="data:image/svg+xml;base64,${WM}" alt="Appliquei">`,
    sub: 'Seu dinheiro precisa de <em>direção.</em>',
  },
  direcao: {
    topo: '<div class="faixa">Dinheiro com <em>direção.</em></div>',
    sub: 'Por que o Appliquei existe',
  },
  conquistas: {
    topo: '<div class="faixa duas">Pequenas atitudes,<br><em>grandes conquistas.</em></div>',
    sub: 'Por que o Appliquei existe',
  },
};
const variante = process.argv[2] || 'logo';
const V = VARIANTES[variante];
if (!V) {
  console.error('variantes: ' + Object.keys(VARIANTES).join(', '));
  process.exit(1);
}
const PASTA = path.join(__dirname, variante);
fs.mkdirSync(PASTA, { recursive: true });

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
${FONTES}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 3036px; height: 1350px; overflow: hidden; }
body { font-family: 'Figtree', sans-serif; -webkit-font-smoothing: antialiased; color: #f0faf4; position: relative;
  background: linear-gradient(120deg, #0b1410 0%, #0f1f18 45%, #112720 100%); }
.halo { position: absolute; inset: 0;
  background: radial-gradient(28% 55% at 50% 48%, rgba(16,185,129,.30), transparent 70%),
              radial-gradient(22% 40% at 12% 85%, rgba(5,150,105,.2), transparent 70%),
              radial-gradient(22% 40% at 90% 15%, rgba(251,191,36,.10), transparent 70%); }
svg.malha { position: absolute; inset: 0; }
body.fundo > :not(.halo):not(.malha) { visibility: hidden; }
/* a frase que atravessa os três posts */
.faixa { position: absolute; left: 0; right: 0; top: 430px; text-align: center; white-space: nowrap;
  font-family: 'Syne', 'Figtree', sans-serif; font-weight: 800; font-size: 150px; letter-spacing: -.03em; line-height: 1;
  color: #f0faf4; text-shadow: 0 20px 60px rgba(0,0,0,.45); }
.faixa em { font-style: normal; color: #34d399; }
.faixa.duas { top: 270px; font-size: 140px; line-height: 1.1; }
.logo { position: absolute; left: 76px; top: 70px; width: 240px; }
.sub { position: absolute; left: 0; right: 0; top: 620px; text-align: center; font-family: 'Figtree', sans-serif; font-size: 60px; font-weight: 800;
  letter-spacing: -.01em; color: #c8d6cf; }
.faixa-logo { position: absolute; left: 50%; top: 120px; width: 1700px; transform: translateX(-50%); filter: drop-shadow(0 20px 60px rgba(0,0,0,.45)); }
.sub em { font-style: normal; color: #34d399; }
/* um bloco por post */
.bloco { position: absolute; top: 760px; width: 860px; padding: 42px 46px; border-radius: 40px;
  background: rgba(11,20,16,.72); border: 2px solid rgba(52,211,153,.4); box-shadow: 0 30px 70px rgba(0,0,0,.35); }
.bloco .rot { font-family: 'DM Mono', monospace; font-size: 30px; letter-spacing: .2em; text-transform: uppercase; color: #34d399; }
.bloco b { display: block; margin-top: 16px; font-size: 46px; font-weight: 900; letter-spacing: -.02em; line-height: 1.15; }
.bloco b em { font-style: normal; color: #fbbf24; }
.bloco ul { list-style: none; margin-top: 18px; }
.bloco li { font-size: 37px; font-weight: 800; line-height: 1.45; }
.bloco li span { color: #34d399; margin-right: 14px; }
.logo { position: absolute; top: 70px; width: 260px; }
.num { position: absolute; bottom: 50px; font-family: 'DM Mono', monospace; font-size: 26px; letter-spacing: .14em; color: #6f8a7f; }
</style></head><body>
<div class="halo"></div><svg class="malha" viewBox="0 0 3036 1350">${malha.join('')}</svg>
${V.topo}
<div class="sub">${V.sub}</div>
${variante === 'logo' ? '' : `<img class="logo" src="data:image/svg+xml;base64,${WM}" alt="Appliquei">`}

<div class="bloco" style="left:76px">
  <div class="rot">Missão</div>
  <b>Ajudar você a enxergar o próprio dinheiro de um jeito diferente, e a transformar <em>organização em conquistas.</em></b>
</div>
<div class="bloco" style="left:1088px">
  <div class="rot">Visão</div>
  <b>Ser o lugar onde o brasileiro cuida do <em>dinheiro inteiro</em>: do gasto de hoje ao patrimônio de amanhã, sem complicação.</b>
</div>
<div class="bloco" style="left:2100px">
  <div class="rot">Valores</div>
  <ul>
    <li><span>●</span>Clareza: saber pra onde vai cada real</li>
    <li><span>●</span>Constância: pequenas atitudes, todo dia</li>
    <li><span>●</span>Propósito: dinheiro a serviço dos sonhos</li>
    <li><span>●</span>Honestidade: sem promessa fácil</li>
  </ul>
</div>
<div class="num" style="left:76px">01 / 03</div>
<div class="num" style="left:1088px">02 / 03</div>
<div class="num" style="left:2100px">03 / 03</div>
</body></html>`;

(async () => {
  const { chromium } = require(path.join(MK, '..', 'node_modules', 'playwright'));
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: 3036, height: 1350 } });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  const pano = path.join(PASTA, 'panorama.png');
  await p.screenshot({ path: pano });
  // só o fundo, para as bordas de 34 px que a grade corta (sem letra cortada)
  const fundo = path.join(PASTA, 'fundo.png');
  await p.evaluate(() => document.body.classList.add('fundo'));
  await p.screenshot({ path: fundo });
  await b.close();
  for (let i = 0; i < 3; i++) {
    const saida = path.join(PASTA, `fixado-${i + 1}.png`);
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      pano,
      '-i',
      fundo,
      '-filter_complex',
      `[0]crop=1012:1350:${i * 1012}:0[m];[1]crop=1012:1350:${i * 1012}:0,split=2[e][d];[e]crop=34:1350:0:0,hflip[ee];[d]crop=34:1350:978:0,hflip[dd];[ee][m][dd]hstack=3`,
      saida,
    ]);
  }
  // prévia da grade: o corte 3:4 de cada post (1012 do meio), com a fresta branca
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    path.join(PASTA, 'fixado-1.png'),
    '-i',
    path.join(PASTA, 'fixado-2.png'),
    '-i',
    path.join(PASTA, 'fixado-3.png'),
    '-filter_complex',
    '[0]crop=1012:1350[x];[1]crop=1012:1350[y];[2]crop=1012:1350[z];[x]pad=iw+6:ih:0:0:white[a];[y]pad=iw+6:ih:0:0:white[b];[a][b][z]hstack=3,scale=1200:-1',
    path.join(PASTA, 'grade.png'),
  ]);
  fs.rmSync(fundo, { force: true });
  console.log('gerado: fixado-1..3.png, panorama.png e grade.png em', PASTA);
})();
