const fs = require('fs'),
  path = require('path');
const { execFileSync } = require('child_process');
const R = '/home/user/investimentos',
  OUT = process.argv[2];
const F = fs.readFileSync(R + '/marketing/.fontes.css', 'utf8');
const SVG = fs.readFileSync(R + '/appliquei-wordmark.svg', 'utf8');
const WMO = Buffer.from(SVG.replace(/#10b981/g, '#fbbf24')).toString('base64');
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
const V = {
  '6-numero': corpo(
    `<div class="num">6</div><div class="sobre"><img src="data:image/svg+xml;base64,${WMO}"></div>`,
    `.num{position:absolute;left:0;right:0;top:120px;text-align:center;font-weight:900;font-size:620px;line-height:1;color:transparent;-webkit-text-stroke:6px rgba(251,191,36,.55);letter-spacing:-.05em}.sobre{position:absolute;left:0;right:0;top:400px;text-align:center}.sobre img{width:640px;filter:drop-shadow(0 18px 40px rgba(0,0,0,.6))}`,
    '',
    '<div class="aviso">DIAS PARA O LANÇAMENTO</div>'
  ),
  '7-ingresso': corpo(
    `<div class="tk"><div class="furo e"></div><div class="furo d"></div><img src="data:image/svg+xml;base64,${WMO}"><div class="pic"></div><small>INGRESSO · ESTREIA 02.01.2027</small></div>`,
    `.tk{position:absolute;left:90px;right:90px;top:280px;height:340px;border-radius:30px;background:linear-gradient(135deg,#059669,#047857);border:4px solid #fbbf24;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 24px 60px rgba(0,0,0,.4)}.tk img{width:560px}.tk small{margin-top:18px;font-family:'DM Mono',monospace;font-size:28px;letter-spacing:.3em;color:#fde68a}.furo{position:absolute;top:50%;width:70px;height:70px;margin-top:-35px;border-radius:50%;background:#0d1b15;border:4px solid #fbbf24}.furo.e{left:-39px}.furo.d{right:-39px}.pic{position:absolute;left:60px;right:60px;bottom:110px;border-top:4px dashed rgba(251,191,36,.6)}`,
    ''
  ),
  '8-fitas': corpo(
    `<div class="faixa">${L}</div><div class="fita"></div>`,
    `.fita{position:absolute;left:-60px;right:-60px;top:560px;height:34px;background:linear-gradient(90deg,#d97706,#fbbf24,#fde68a,#fbbf24,#d97706);transform:rotate(5deg);box-shadow:0 10px 24px rgba(0,0,0,.35)}`,
    ''
  ),
  '9-anel': corpo(
    `<div class="anel"><svg viewBox="0 0 400 400">${Array.from({ length: 7 }, (_, k) => {
      const a0 = ((-90 + (k * 360) / 7 + 3) * Math.PI) / 180,
        a1 = ((-90 + ((k + 1) * 360) / 7 - 3) * Math.PI) / 180;
      const p = (a) => [200 + 180 * Math.cos(a), 200 + 180 * Math.sin(a)];
      const [x0, y0] = p(a0),
        [x1, y1] = p(a1);
      return `<path d="M${x0} ${y0} A180 180 0 0 1 ${x1} ${y1}" stroke="${k < 1 ? '#fbbf24' : 'rgba(240,250,244,.15)'}" stroke-width="18" fill="none" stroke-linecap="round"/>`;
    }).join('')}</svg><div class="disco"><img src="data:image/svg+xml;base64,${WMO}"></div></div>`,
    `.anel{position:absolute;left:290px;top:150px;width:500px;height:500px}.anel svg{position:absolute;inset:0}.disco{position:absolute;inset:60px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#10b981,#047857);display:flex;align-items:center;justify-content:center;box-shadow:0 24px 60px rgba(0,0,0,.45)}.disco img{width:300px}`,
    ''
  ),
  '10-minimal': corpo(
    `<div class="top"><img src="data:image/svg+xml;base64,${WMO}"><div class="linha"></div><small>LANÇAMENTO · 02.01.2027</small></div>`,
    `.top{position:absolute;left:0;right:0;top:300px;text-align:center}.top img{width:720px}.linha{width:300px;height:4px;margin:34px auto 0;background:linear-gradient(90deg,transparent,#fbbf24,transparent)}.top small{display:block;margin-top:24px;font-family:'DM Mono',monospace;font-size:34px;letter-spacing:.32em;color:#fde68a}`,
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
