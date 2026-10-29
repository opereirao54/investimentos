const fs = require('fs'),
  path = require('path');
const { execFileSync } = require('child_process');
const R = '/home/user/investimentos',
  OUT = process.argv[2];
const F = fs.readFileSync(R + '/marketing/.fontes.css', 'utf8');
const SVG = fs.readFileSync(R + '/appliquei-wordmark.svg', 'utf8');
const WMO = Buffer.from(SVG.replace(/#10b981/g, '#fbbf24')).toString('base64');
const WME = Buffer.from(SVG.replace(/#f0faf4/g, '#0b1410')).toString('base64');
const WMEV = Buffer.from(
  SVG.replace(/#f0faf4/g, '#0b1410').replace(/#10b981/g, '#047857')
).toString('base64');
const malha = [];
for (let x = 60; x < 1080; x += 60)
  malha.push(`<line x1="${x}" y1="0" x2="${x}" y2="1920" stroke="#f0faf4" stroke-opacity=".03"/>`);
for (let y = 60; y < 1920; y += 60)
  malha.push(`<line x1="0" y1="${y}" x2="1080" y2="${y}" stroke="#f0faf4" stroke-opacity=".03"/>`);
const brilho = (x, y, s, o) =>
  `<svg style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;opacity:${o || 1}" viewBox="-10 -10 20 20"><path d="M0 -10 L2.4 -2.4 L10 0 L2.4 2.4 L0 10 L-2.4 2.4 L-10 0 L-2.4 -2.4 Z" fill="#fbbf24"/></svg>`;
const corpo = (
  faixa,
  extraCss,
  extraHtml,
  aviso
) => `<!doctype html><html><head><meta charset="utf-8"><style>${F}
*{margin:0;padding:0;box-sizing:border-box}body{width:1080px;height:1920px;overflow:hidden;font-family:'Figtree',sans-serif;color:#f0faf4;position:relative;background:linear-gradient(150deg,#0b1410,#0f1f18 50%,#112720)}
.halo{position:absolute;inset:-20%;background:radial-gradient(60% 40% at 80% 25%,rgba(16,185,129,.26),transparent 70%),radial-gradient(40% 35% at 10% 80%,rgba(5,150,105,.2),transparent 70%)}svg.malha{position:absolute;inset:0}
.faixa{position:absolute;left:-40px;right:-40px;top:300px;height:300px;background:#059669;display:flex;align-items:center;justify-content:center;transform:skewY(-4deg);box-shadow:0 24px 60px rgba(0,0,0,.35)}
.faixa img{width:640px;transform:skewY(4deg)}
.miolo{position:absolute;left:80px;right:80px;top:660px;text-align:center;padding-top:70px;display:flex;flex-direction:column;align-items:center}
.aviso{padding:14px 34px;border-radius:99px;border:3px solid #fbbf24;background:rgba(251,191,36,.12);font-family:'DM Mono',monospace;font-size:40px;letter-spacing:.14em;color:#fbbf24;margin-bottom:56px}
.fr{font-weight:900;font-size:112px;line-height:1.04;letter-spacing:-.04em}.fr em{font-style:normal;color:#fbbf24}
.ap{margin-top:48px;font-size:44px;font-weight:800;color:#c8d6cf}
${extraCss}</style></head><body><div class="halo"></div><svg class="malha" viewBox="0 0 1080 1920">${malha.join('')}</svg>
${faixa}${extraHtml}
<div class="miolo">${aviso || '<div class="aviso">FALTAM 6 DIAS</div>'}<div class="fr">Seus sonhos com<br><em>valor, prazo</em><br>e quanto falta.</div><div class="ap">O recurso de hoje: Sonhos</div></div></body></html>`;
const L = `<img src="data:image/svg+xml;base64,${WMO}">`;
const E = `<img src="data:image/svg+xml;base64,${WME}">`,
  EV = `<img src="data:image/svg+xml;base64,${WMEV}">`;
const V = {
  'a-original': corpo(
    `<div class="faixa" style="background:linear-gradient(100deg,#f59e0b,#fbbf24 45%,#fde68a 60%,#f59e0b)">${E}</div>`,
    '',
    ''
  ),
  'b-champanhe': corpo(
    `<div class="faixa" style="background:linear-gradient(100deg,#d9c48f,#efe0b5 45%,#fbf3dc 58%,#d9c48f)">${EV}</div>`,
    '',
    ''
  ),
  'c-metalico': corpo(
    `<div class="faixa" style="background:linear-gradient(100deg,#a86b12 0%,#f6d365 18%,#fff3c4 28%,#e2a72e 42%,#b97a17 58%,#f9dc7a 74%,#fff1b8 82%,#c88a1e 100%);border-top:3px solid #fff1b8;border-bottom:3px solid #8a5a0c">${E}</div>`,
    '',
    ''
  ),
  'd-ouro-velho': corpo(
    `<div class="faixa" style="background:linear-gradient(100deg,#8a5a14,#b7791f 40%,#d69e2e 60%,#8a5a14)"><img src="data:image/svg+xml;base64,${WMO}"></div>`,
    '',
    ''
  ),
  'e-chapado': corpo(
    `<div class="faixa" style="background:#fbbf24;box-shadow:0 24px 60px rgba(0,0,0,.35),inset 0 -10px 0 rgba(180,83,9,.35)">${EV}</div>`,
    '',
    ''
  ),
};
(async () => {
  const { chromium } = require(R + '/node_modules/playwright');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 2 });
  for (const [n, h] of Object.entries(V)) {
    await p.setContent(h);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(200);
    const t = path.join(OUT, n + '-2x.png');
    await p.screenshot({ path: t });
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      t,
      '-vf',
      'scale=1080:1920:flags=lanczos',
      path.join(OUT, n + '.png'),
    ]);
    fs.rmSync(t);
  }
  await b.close();
})();
