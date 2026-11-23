const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [url, out, fps, only] = [process.argv[2], process.argv[3], +process.argv[4] || 30, process.argv[5]];
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  p.on('pageerror', (e) => console.log('ERRO', e.message));
  await p.goto(url); await p.waitForFunction(() => window.pronto, null, { timeout: 120000 });
  await p.evaluate(() => document.fonts.ready);
  const dur = await p.evaluate(() => window.DUR);
  const ts = only ? only.split(',').map(Number) : Array.from({ length: Math.round(dur * fps) }, (_, i) => i / fps);
  const t0 = Date.now();
  for (let i = 0; i < ts.length; i++) {
    await p.evaluate((t) => window.render(t), ts[i]);
    await p.screenshot({ path: `${out}/${String(i).padStart(5, '0')}.png` });
    if (i % 30 === 0) console.log('quadro', i, '/', ts.length, Math.round((Date.now() - t0) / 1000) + 's');
  }
  await b.close();
})();
