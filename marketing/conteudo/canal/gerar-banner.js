// Capa (banner) do canal do YouTube, 2560×1440, na identidade da Appliquei.
// Tudo o que importa fica na área segura de 1546×423 no centro (o que aparece
// no celular); o resto é fundo, que só a TV e o computador mostram.
//
//   node marketing/conteudo/canal/gerar-banner.js
//
// Gera youtube-banner.png nesta pasta e youtube-banner-area-segura.png (prévia
// com a área do celular marcada, só para conferir).

const fs = require('fs');
const path = require('path');

const MK = path.join(__dirname, '..', '..');
const FONTES = fs.readFileSync(path.join(MK, '.fontes.css'), 'utf8');
const WM = fs.readFileSync(path.join(MK, '..', 'appliquei-wordmark.svg')).toString('base64');

const malha = [];
for (let x = 80; x < 2560; x += 80)
  malha.push(`<line x1="${x}" y1="0" x2="${x}" y2="1440" stroke="#f0faf4" stroke-opacity=".035"/>`);
for (let y = 80; y < 1440; y += 80)
  malha.push(`<line x1="0" y1="${y}" x2="2560" y2="${y}" stroke="#f0faf4" stroke-opacity=".035"/>`);

const html = (guia) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
${FONTES}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 2560px; height: 1440px; overflow: hidden; }
body { font-family: 'Figtree', sans-serif; -webkit-font-smoothing: antialiased; color: #f0faf4; position: relative;
  background: linear-gradient(150deg, #0b1410 0%, #0f1f18 50%, #112720 100%); }
.halo { position: absolute; inset: 0;
  background: radial-gradient(40% 55% at 70% 45%, rgba(16,185,129,.28), transparent 70%),
              radial-gradient(30% 45% at 20% 70%, rgba(5,150,105,.2), transparent 70%); }
svg.malha { position: absolute; inset: 0; }
.seg { position: absolute; left: 507px; top: 509px; width: 1546px; height: 423px; display: flex; align-items: center; justify-content: space-between; padding: 0 40px; }
.esq img { width: 520px; display: block; }
.esq p { margin-top: 22px; font-size: 44px; font-weight: 800; color: #c8d6cf; letter-spacing: -.01em; }
.esq p em { font-style: normal; color: #34d399; }
.dir { text-align: right; }
.dir .selo { display: inline-block; padding: 12px 26px; border-radius: 99px; border: 2px solid rgba(52,211,153,.5); background: rgba(52,211,153,.12);
  font-family: 'DM Mono', monospace; font-size: 26px; letter-spacing: .14em; text-transform: uppercase; color: #34d399; }
.dir b { display: block; margin-top: 22px; font-size: 64px; font-weight: 900; letter-spacing: -.03em; line-height: 1.05; }
.dir b em { font-style: normal; color: #fbbf24; }
.dir small { display: block; margin-top: 16px; font-family: 'DM Mono', monospace; font-size: 28px; color: #9fb3aa; letter-spacing: .06em; }
.guia { position: absolute; left: 507px; top: 509px; width: 1546px; height: 423px; outline: 4px dashed #f87171; }
</style></head><body>
<div class="halo"></div><svg class="malha" viewBox="0 0 2560 1440">${malha.join('')}</svg>
<div class="seg">
  <div class="esq">
    <img src="data:image/svg+xml;base64,${WM}" alt="Appliquei">
    <p>Seu dinheiro precisa de <em>direção.</em></p>
  </div>
  <div class="dir">
    <span class="selo">Conta de padaria</span>
    <b>A conta que <em>ninguém</em><br>te mostrou.</b>
    <small>Shorts toda seg · qua · sex</small>
  </div>
</div>
${guia ? '<div class="guia"></div>' : ''}
</body></html>`;

(async () => {
  const { chromium } = require(path.join(MK, '..', 'node_modules', 'playwright'));
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: 2560, height: 1440 } });
  for (const [guia, nome] of [
    [false, 'youtube-banner.png'],
    [true, 'youtube-banner-area-segura.png'],
  ]) {
    await p.setContent(html(guia));
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(__dirname, nome) });
    console.log('gerado:', path.join(__dirname, nome));
  }
  await b.close();
})();
