// Capa de Reels/Shorts com a frase do gancho, na identidade da Appliquei.
//
//   node marketing/ferramentas/shorts/capa.js capa.json saida.png
//
// capa.json:
// {
//   "frase": "Seu carro custa<br><em>R$ 2.100 por mês.</em><br>Parado.",
//   "rotulo": "Appliquei Explica",      // opcional (selo acima da frase)
//   "apoio": "A conta que ninguém faz", // opcional (linha menor abaixo)
//   "tamanho": 112                       // opcional (px da frase; diminua se quebrar mal)
//   "news": true                         // opcional: capa da série Appliquei News (faixa
//                                           vermelha de telejornal no topo, como a vinheta)
//   "explica": true                      // opcional: a mesma capa em verde, série Appliquei Explica
//   "appliquei": true                    // opcional: série da reta final (27/12 a 02/01): faixa
//                                           dourada metálica com a logo (fundador e sócio,
//                                           29/10); "aviso": "Faltam 6 dias" (ou "É hoje")
//                                           no selo de ouro
//   "verde": true                        // com "appliquei": a faixa em verde em vez de dourado
// }
// <em> pinta de âmbar (o número que choca); <em class="v"> pinta de verde-sinal.
// Tudo fica dentro do recorte 3:4 da grade do perfil (1080×1440 no meio da
// tela de 1080×1920), longe da barra de botões do Reels.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [, , specArq, saida] = process.argv;
if (!specArq || !saida) {
  console.error('uso: node marketing/ferramentas/shorts/capa.js capa.json saida.png');
  process.exit(1);
}
const MK = path.join(__dirname, '..', '..');
const CSS_FONTES = path.join(MK, '.fontes.css');
if (!fs.existsSync(CSS_FONTES)) {
  console.error('Faltam as fontes da marca. Rode ./marketing/fontes.sh primeiro.');
  process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(specArq, 'utf8'));
const FONTES = fs.readFileSync(CSS_FONTES, 'utf8');
const WM_SVG = fs.readFileSync(path.join(MK, '..', 'appliquei-wordmark.svg'), 'utf8');
const WM = Buffer.from(WM_SVG).toString('base64');
// a logo com as letras escuras, para a faixa dourada (o $ continua verde)
const WM_ESCURA = Buffer.from(WM_SVG.replace(/#f0faf4/g, '#0b1410')).toString('base64');
// e com o $ dourado, para a faixa verde
const WM_OURO = Buffer.from(WM_SVG.replace(/#10b981/g, '#fbbf24')).toString('base64');

const malha = [];
for (let x = 60; x < 1080; x += 60)
  malha.push(`<line x1="${x}" y1="0" x2="${x}" y2="1920" stroke="#f0faf4" stroke-opacity=".03"/>`);
for (let y = 60; y < 1920; y += 60)
  malha.push(`<line x1="0" y1="${y}" x2="1080" y2="${y}" stroke="#f0faf4" stroke-opacity=".03"/>`);

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
${FONTES}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1920px; overflow: hidden; }
body { font-family: 'Figtree', sans-serif; -webkit-font-smoothing: antialiased; color: #f0faf4;
  background: linear-gradient(150deg, #0b1410 0%, #0f1f18 50%, #112720 100%); position: relative; }
.halo { position: absolute; inset: -20%;
  background: radial-gradient(60% 40% at 80% 25%, rgba(16,185,129,.26), transparent 70%),
              radial-gradient(40% 35% at 10% 80%, rgba(5,150,105,.2), transparent 70%); }
svg.malha { position: absolute; inset: 0; }
.miolo { position: absolute; left: 80px; right: 80px; top: 240px; height: 1440px;
  display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
.rotulo { padding: 12px 26px; border-radius: 99px; border: 2px solid rgba(52,211,153,.5); background: rgba(52,211,153,.12);
  font-family: 'DM Mono', monospace; font-size: 30px; letter-spacing: .14em; text-transform: uppercase; color: #34d399; }
.faixa-news { position: absolute; left: -40px; right: -40px; top: 300px; height: 300px; background: #b91c1c;
  display: flex; flex-direction: column; align-items: center; justify-content: center; transform: skewY(-4deg);
  box-shadow: 0 24px 60px rgba(0,0,0,.35); }
.faixa-news b { font-size: 150px; font-weight: 900; letter-spacing: -.045em; line-height: 1; color: #fff; transform: skewY(4deg); }
.faixa-news span { margin-top: 10px; padding: 6px 34px; background: #fff; color: #b91c1c; font-family: 'DM Mono', monospace;
  font-size: 70px; letter-spacing: .32em; text-indent: .32em; transform: skewY(4deg); }
.faixa-news.explica { background: #059669; }
.faixa-news.ouro { background: linear-gradient(100deg, #a86b12 0%, #f6d365 18%, #fff3c4 28%, #e2a72e 42%, #b97a17 58%, #f9dc7a 74%, #fff1b8 82%, #c88a1e 100%); border-top: 3px solid #fff1b8; border-bottom: 3px solid #8a5a0c; }
.faixa-news.ouro img { width: 640px; transform: skewY(4deg); }
.faixa-news.lanc-verde { background: #059669; }
.faixa-news.lanc-verde img { width: 640px; transform: skewY(4deg); }
.aviso-lanc { padding: 14px 34px; border-radius: 99px; background: linear-gradient(100deg, #a86b12 0%, #f6d365 18%, #fff3c4 28%, #e2a72e 42%, #b97a17 58%, #f9dc7a 74%, #fff1b8 82%, #c88a1e 100%); font-family: 'DM Mono', monospace; font-weight: 500;
  font-size: 40px; letter-spacing: .14em; text-transform: uppercase; color: #2a1a04; margin-bottom: 56px; box-shadow: 0 10px 24px rgba(0,0,0,.4); }
.faixa-news.explica span { color: #047857; }
.miolo.news { top: 660px; height: 1020px; justify-content: flex-start; padding-top: 70px; }
.miolo.news .frase { margin-top: 0; }
.frase { margin-top: 56px; font-weight: 900; font-size: ${spec.tamanho || 112}px; line-height: 1.04; letter-spacing: -.04em; }
.frase em { font-style: normal; color: #fbbf24; }
.frase em.v { color: #34d399; }
.apoio { margin-top: 48px; font-size: 44px; font-weight: 800; color: #c8d6cf; }
.marca { margin-top: 90px; width: 300px; opacity: .95; }
</style></head><body>
<div class="halo"></div><svg class="malha" viewBox="0 0 1080 1920">${malha.join('')}</svg>
${spec.news ? '<div class="faixa-news"><b>APPLIQUEI</b><span>NEWS</span></div>' : ''}
${spec.explica ? '<div class="faixa-news explica"><b>APPLIQUEI</b><span>EXPLICA</span></div>' : ''}
${spec.appliquei ? `<div class="faixa-news ${spec.verde ? 'lanc-verde' : 'ouro'}"><img src="data:image/svg+xml;base64,${spec.verde ? WM_OURO : WM_ESCURA}" alt="Appliquei"></div>` : ''}
<div class="miolo${spec.news || spec.explica || spec.appliquei ? ' news' : ''}">
  ${spec.appliquei && spec.aviso ? `<div class="aviso-lanc">${spec.aviso}</div>` : ''}
  ${spec.rotulo === '' || spec.news || spec.explica || spec.appliquei ? '' : `<div class="rotulo">${spec.rotulo || 'Appliquei Explica'}</div>`}
  <div class="frase">${spec.frase}</div>
  ${spec.apoio ? `<div class="apoio">${spec.apoio}</div>` : ''}
  ${spec.appliquei ? '' : `<img class="marca" src="data:image/svg+xml;base64,${WM}" alt="Appliquei">`}
</div>
</body></html>`;

(async () => {
  const { chromium } = require(path.join(MK, '..', 'node_modules', 'playwright'));
  const exe =
    process.env.CHROMIUM_PATH ||
    (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  // desenha em 2x e reduz: letras e bordas mais nítidas
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 2 });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  const dobro = saida.replace(/\.png$/, '') + `-2x-${process.pid}.png`;
  await p.screenshot({ path: dobro });
  await b.close();
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    dobro,
    '-vf',
    'scale=1080:1920:flags=lanczos',
    saida,
  ]);
  fs.rmSync(dobro, { force: true });
  console.log('gerado: ' + saida);
})();
