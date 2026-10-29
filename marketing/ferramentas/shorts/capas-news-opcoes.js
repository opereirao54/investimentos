// 3 opções de capa com mais destaque para o Appliquei News (fundador, 29/10).
//   node marketing/ferramentas/shorts/capas-news-opcoes.js <pasta>
// Gera a.png (faixa vermelha no topo), b.png (logo do telejornal + letreiro)
// e c.png (tela de TV com o GC da notícia), com a frase do Reel do dólar.
const fs = require('fs'),
  path = require('path');
const R = '/home/user/investimentos';
const F = fs.readFileSync(R + '/marketing/.fontes.css', 'utf8');
const WM = fs.readFileSync(R + '/appliquei-wordmark.svg').toString('base64');
const OUT = process.argv[2];
const base = `<style>${F}*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1920px;overflow:hidden;font-family:'Figtree',sans-serif;color:#f0faf4;position:relative;
background:radial-gradient(60% 35% at 50% 50%,rgba(185,28,28,.22),transparent 70%),linear-gradient(150deg,#0b1410,#0f1f18 50%,#112720)}
.fr{font-weight:900;letter-spacing:-.04em;line-height:1.03}.fr em{font-style:normal;color:#fbbf24}
.wm{width:300px}</style>`;
const A = `${base}<style>
.topo{position:absolute;left:0;right:0;top:300px;height:300px;background:#b91c1c;display:flex;flex-direction:column;align-items:center;justify-content:center;transform:skewY(-4deg)}
.topo b{font-size:150px;font-weight:900;letter-spacing:-.045em;line-height:1;color:#fff;transform:skewY(4deg)}
.topo span{margin-top:10px;padding:6px 34px;background:#fff;color:#b91c1c;font-family:'DM Mono',monospace;font-size:70px;letter-spacing:.32em;text-indent:.32em;transform:skewY(4deg)}
.fr{position:absolute;left:70px;right:70px;top:760px;text-align:center;font-size:112px}
.ap{position:absolute;left:0;right:0;top:1130px;text-align:center;font-size:44px;font-weight:800;color:#c8d6cf}
.mk{position:absolute;left:0;right:0;top:1400px;text-align:center}</style>
<div class="topo"><b>APPLIQUEI</b><span>NEWS</span></div>
<div class="fr">O dólar disparou.<br>E o seu <em>pãozinho?</em></div><div class="ap">O que muda no seu bolso</div><div class="mk"><img class="wm" src="data:image/svg+xml;base64,${WM}"></div>`;
const B = `${base}<style>
.live{position:absolute;left:90px;top:300px;display:flex;align-items:center;gap:18px;font-family:'DM Mono',monospace;font-size:34px;letter-spacing:.18em;color:#fca5a5}
.live i{width:26px;height:26px;border-radius:50%;background:#ef4444;box-shadow:0 0 22px #ef4444}
.logo{position:absolute;left:90px;top:380px}
.logo b{display:block;font-size:180px;font-weight:900;letter-spacing:-.05em;line-height:.9}
.logo span{display:inline-block;margin-top:14px;padding:8px 40px;background:#b91c1c;color:#fff;font-family:'DM Mono',monospace;font-size:96px;letter-spacing:.3em}
.fr{position:absolute;left:90px;right:70px;top:860px;font-size:110px}
.tk{position:absolute;left:0;right:0;top:1290px;height:90px;border-top:4px solid #b91c1c;border-bottom:4px solid #b91c1c;background:rgba(240,250,244,.06);display:flex;align-items:center;gap:26px;padding-left:90px;font-size:40px;font-weight:900;white-space:nowrap}
.tk i{font-style:normal;color:#ef4444}
.mk{position:absolute;left:90px;top:1460px}</style>
<div class="live"><i></i>AO VIVO NO SEU BOLSO</div>
<div class="logo"><b>APPLIQUEI</b><span>NEWS</span></div>
<div class="fr">O dólar disparou.<br>E o seu <em>pãozinho?</em></div>
<div class="tk">DÓLAR <i>●</i> PÃO <i>●</i> GASOLINA <i>●</i> CARTÃO <i>●</i> SEU BOLSO</div>
<div class="mk"><img class="wm" src="data:image/svg+xml;base64,${WM}"></div>`;
const C = `${base}<style>
.tela{position:absolute;left:70px;right:70px;top:290px;height:900px;border-radius:40px;background:linear-gradient(160deg,#1a2b23,#0f1f18);border:4px solid rgba(240,250,244,.12);overflow:hidden}
.tela .ic{position:absolute;left:0;right:160px;top:150px;text-align:center;font-size:250px;line-height:1}
.tela .din{position:absolute;right:40px;top:40px;padding:14px 26px;border-radius:20px;background:rgba(251,191,36,.14);border:3px solid #fbbf24;font-family:'DM Mono',monospace;font-size:56px;color:#fbbf24}
.gc{position:absolute;left:0;right:0;top:560px}
.gc .tag{display:inline-flex;margin-left:40px}
.gc .tag b{padding:14px 30px;background:#b91c1c;color:#fff;font-size:44px;font-weight:900;letter-spacing:.02em}
.gc .tag span{padding:14px 26px;background:#fff;color:#b91c1c;font-family:'DM Mono',monospace;font-size:44px;letter-spacing:.24em}
.gc .tx{margin:0 40px;padding:26px 32px;background:#f4f4f0;color:#111;font-size:76px;font-weight:900;letter-spacing:-.03em;line-height:1.05}
.gc .tx em{font-style:normal;color:#b91c1c}
.ap{position:absolute;left:0;right:0;top:1270px;text-align:center;font-size:46px;font-weight:800;color:#c8d6cf}
.mk{position:absolute;left:0;right:0;top:1420px;text-align:center}</style>
<div class="tela"><div class="din">US$ ▲ 8%</div><div class="ic">🥖</div>
<div class="gc"><div class="tag"><b>APPLIQUEI</b><span>NEWS</span></div><div class="tx">O dólar disparou.<br>E o seu <em>pãozinho?</em></div></div></div>
<div class="ap">O que muda no seu bolso</div><div class="mk"><img class="wm" src="data:image/svg+xml;base64,${WM}"></div>`;
(async () => {
  const { chromium } = require(R + '/node_modules/playwright');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  for (const [n, h] of [
    ['a', A],
    ['b', B],
    ['c', C],
  ]) {
    await p.setContent(
      '<!doctype html><html><head><meta charset="utf-8"></head><body>' + h + '</body></html>'
    );
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(OUT, n + '.png') });
  }
  await b.close();
})();
