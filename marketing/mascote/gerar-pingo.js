// Pingo, o mascote do Appliquei: o próprio "$" da logo (o que fica no pingo do
// "i") virado personagem. O corpo é o mesmo desenho do cifrão de
// appliquei-wordmark.svg, só um pouco mais encorpado para o rosto caber na
// faixa do meio. SVG puro (escala sem perder nitidez).
//
//   node marketing/mascote/gerar-pingo.js
//
// Gera em marketing/mascote/pingo/: um SVG por pose (pingo-<pose>.svg) e a
// folha de apresentação (folha.png, 1600×1200).

const fs = require('fs');
const path = require('path');

const MK = path.join(__dirname, '..');
const PASTA = path.join(__dirname, 'pingo');
fs.mkdirSync(PASTA, { recursive: true });
for (const f of fs.readdirSync(PASTA)) if (f.endsWith('.svg')) fs.rmSync(path.join(PASTA, f));

const WM_SVG = fs.readFileSync(path.join(MK, '..', 'appliquei-wordmark.svg'), 'utf8');
const CIFRAO = WM_SVG.match(/<path fill="#10b981" d="([^"]+)"/)[1];
const COR = {
  claro: '#6ee7b7',
  marca: '#10b981',
  escuro: '#047857',
  tinta: '#052e1f',
  ambar: '#fbbf24',
};

// Coordenadas no espaço do cifrão da logo (x 970–1011, y 292–353).
function olhos(tipo) {
  const o = (x, dx, dy) =>
    `<ellipse cx="${x}" cy="318.5" rx="4.3" ry="4.9" fill="#fff" stroke="${COR.tinta}" stroke-width=".8"/>` +
    `<circle cx="${x + dx}" cy="${319.2 + dy}" r="2.3" fill="${COR.tinta}"/>` +
    `<circle cx="${x + dx + 0.8}" cy="${318.2 + dy}" r=".75" fill="#fff"/>`;
  const arco = (x) =>
    `<path d="M${x - 3.6} 319.5 Q${x} 314.5 ${x + 3.6} 319.5" stroke="${COR.tinta}" stroke-width="1.5" stroke-linecap="round" fill="none"/>`;
  if (tipo === 'fechados') return arco(985) + arco(995.5);
  if (tipo === 'piscando') return o(985, 0.6, 0.4) + arco(995.5);
  if (tipo === 'cima') return o(985, 1, -1.8) + o(995.5, 1, -1.8);
  return o(985, 0.6, 0.4) + o(995.5, 0.6, 0.4);
}

function boca(tipo) {
  const s = `stroke="${COR.tinta}" stroke-width="1.5" stroke-linecap="round" fill="none"`;
  if (tipo === 'aberta')
    return `<path d="M986.5 326 Q990.5 332.5 994.5 326 Z" fill="${COR.tinta}"/><path d="M988.6 329.4 Q990.5 331 992.4 329.4" fill="#f87171"/>`;
  if (tipo === 'o') return `<ellipse cx="990.5" cy="327.8" rx="1.8" ry="2.1" fill="${COR.tinta}"/>`;
  if (tipo === 'reta') return `<path d="M987.5 327.5 Q990.5 328 993.5 326.6" ${s}/>`;
  return `<path d="M986.8 326.2 Q990.5 330.6 994.2 326.2" ${s}/>`;
}

const sobrancelhas = {
  alerta: `<path d="M980.5 311.6 L987.8 313.6 M1000 311.6 L992.7 313.6" stroke="${COR.tinta}" stroke-width="1.4" stroke-linecap="round"/>`,
  pensando: `<path d="M981.5 312.4 Q985 310.6 988.5 312.4 M992 311.2 Q995.5 309.4 999 311.2" stroke="${COR.tinta}" stroke-width="1.3" stroke-linecap="round" fill="none"/>`,
};

// braço: do ombro até a mão, com a mão redonda
function braco(x, y, hx, hy, cx, cy) {
  return (
    `<path d="M${x} ${y} Q${cx} ${cy} ${hx} ${hy}" stroke="${COR.escuro}" stroke-width="2.8" stroke-linecap="round" fill="none"/>` +
    `<circle cx="${hx}" cy="${hy}" r="2.7" fill="${COR.marca}" stroke="${COR.escuro}" stroke-width="1"/>`
  );
}
const ESQ = [969, 321];
const DIR = [1013.5, 331];
const BRACOS = {
  baixo: braco(...ESQ, 961, 334, 962, 326) + braco(...DIR, 1020, 343, 1019, 335),
  acena: braco(...ESQ, 961, 334, 962, 326) + braco(...DIR, 1023, 312, 1024, 326),
  queixo: braco(...ESQ, 961, 334, 962, 326) + braco(...DIR, 998, 329, 1012, 342),
  cima: braco(...ESQ, 958, 304, 958, 316) + braco(...DIR, 1024, 312, 1026, 324),
  aponta: braco(...ESQ, 961, 334, 962, 326) + braco(...DIR, 1027, 329, 1020, 333),
};

function pingo(p) {
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="950 282 82 86">
<defs><linearGradient id="${id}" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="${COR.claro}"/><stop offset=".4" stop-color="${COR.marca}"/><stop offset="1" stop-color="#059669"/></linearGradient></defs>
<ellipse cx="991" cy="361" rx="15" ry="2.2" fill="#000" opacity=".22"/>
<ellipse cx="986.5" cy="358" rx="4.6" ry="2.4" fill="${COR.escuro}"/><ellipse cx="996" cy="358" rx="4.6" ry="2.4" fill="${COR.escuro}"/>
<path d="${CIFRAO}" fill="${COR.escuro}" stroke="${COR.escuro}" stroke-width="8.6" stroke-linejoin="round"/>
<path d="${CIFRAO}" fill="url(#${id})" stroke="url(#${id})" stroke-width="6" stroke-linejoin="round"/>
<path d="M975 304 Q977 298 984 296" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".5" fill="none"/>
<ellipse cx="979.6" cy="324.6" rx="2.4" ry="1.4" fill="${COR.ambar}" opacity=".45"/><ellipse cx="1001.4" cy="324.6" rx="2.4" ry="1.4" fill="${COR.ambar}" opacity=".45"/>
${sobrancelhas[p.sobrancelha] || ''}
${olhos(p.olhos)}
${boca(p.boca)}
${BRACOS[p.bracos]}
${p.extra || ''}
</svg>`;
}

const brilho = (x, y, s) =>
  `<path d="M${x} ${y - s} L${x + s * 0.3} ${y - s * 0.3} L${x + s} ${y} L${x + s * 0.3} ${y + s * 0.3} L${x} ${y + s} L${x - s * 0.3} ${y + s * 0.3} L${x - s} ${y} L${x - s * 0.3} ${y - s * 0.3} Z" fill="${COR.ambar}"/>`;
const sinal = (t, x, y) =>
  `<text x="${x}" y="${y}" font-family="Figtree, sans-serif" font-weight="900" font-size="15" fill="${COR.ambar}">${t}</text>`;

const POSES = {
  feliz: {
    nome: 'Feliz',
    uso: 'padrão, assinatura',
    olhos: 'normal',
    boca: 'sorriso',
    bracos: 'baixo',
  },
  acenando: {
    nome: 'Acenando',
    uso: 'abertura, boas-vindas',
    olhos: 'normal',
    boca: 'aberta',
    bracos: 'acena',
  },
  apontando: {
    nome: 'Apontando',
    uso: 'regra de bolso, a conta',
    olhos: 'piscando',
    boca: 'sorriso',
    bracos: 'aponta',
  },
  pensando: {
    nome: 'Pensando',
    uso: 'pergunta do gancho',
    olhos: 'cima',
    boca: 'reta',
    bracos: 'queixo',
    sobrancelha: 'pensando',
    extra: sinal('?', 1013, 302),
  },
  alerta: {
    nome: 'Alerta',
    uso: '"antes de apertar"',
    olhos: 'normal',
    boca: 'o',
    bracos: 'baixo',
    sobrancelha: 'alerta',
    extra: sinal('!', 1015, 302),
  },
  comemorando: {
    nome: 'Comemorando',
    uso: 'meta batida, sobrou',
    olhos: 'fechados',
    boca: 'aberta',
    bracos: 'cima',
    extra:
      brilho(962, 292, 3.4) + brilho(1021, 294, 2.8) + brilho(1027, 340, 2) + brilho(955, 340, 1.8),
  },
};

for (const [k, p] of Object.entries(POSES))
  fs.writeFileSync(path.join(PASTA, `pingo-${k}.svg`), pingo(p));

const FONTES = fs.readFileSync(path.join(MK, '.fontes.css'), 'utf8');
const WM = Buffer.from(WM_SVG).toString('base64');
// a marca sem o "$", para o Pingo ocupar o lugar dele
const WM_SEM = Buffer.from(WM_SVG.replace(/<path fill="#10b981"[^>]+>/, '')).toString('base64');
const b64 = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${FONTES}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1600px;height:1200px;overflow:hidden;font-family:'Figtree',sans-serif;color:#f0faf4;
background:radial-gradient(50% 45% at 20% 25%,rgba(16,185,129,.22),transparent 70%),linear-gradient(150deg,#0b1410,#0f1f18 50%,#112720)}
.top{position:absolute;left:70px;top:56px;right:70px;display:flex;align-items:flex-end;justify-content:space-between}
.top h1{font-size:76px;font-weight:900;letter-spacing:-.03em;line-height:1}
.top h1 em{font-style:normal;color:#34d399}
.top p{margin-top:12px;font-size:28px;color:#c8d6cf;max-width:860px;line-height:1.3}
.top img{width:250px}
.poses{position:absolute;left:50px;right:50px;top:300px;display:grid;grid-template-columns:repeat(6,1fr);gap:18px}
.pose{text-align:center;padding:22px 8px 20px;border-radius:30px;background:rgba(240,250,244,.05);border:2px solid rgba(240,250,244,.12)}
.pose img{width:200px;height:210px}
.pose b{display:block;margin-top:10px;font-size:30px;font-weight:900}
.pose small{display:block;margin-top:4px;font-family:'DM Mono',monospace;font-size:18px;color:#9fb3aa}
.base{position:absolute;left:50px;right:50px;top:690px;display:grid;grid-template-columns:1.25fr 1fr 1fr;gap:18px}
.caixa{border-radius:30px;background:rgba(240,250,244,.05);border:2px solid rgba(240,250,244,.12);padding:30px;height:450px;position:relative}
.caixa .rot{font-family:'DM Mono',monospace;font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:#34d399}
.logo-vivo{position:relative;width:560px;height:200px;margin:110px auto 0}
.logo-vivo img.w{position:absolute;left:0;top:30px;width:560px}
.logo-vivo img.p{position:absolute;left:462px;top:-30px;width:140px}
.caixa p{margin-top:30px;text-align:center;font-size:24px;color:#c8d6cf}
.icones{display:flex;align-items:flex-end;justify-content:center;gap:34px;margin-top:70px}
.icones div{display:flex;align-items:center;justify-content:center;border-radius:28%;background:#0f1f18;border:2px solid rgba(52,211,153,.4)}
.icones img{width:86%}
.cena{margin-top:22px;height:340px;border-radius:24px;background:#fff;position:relative;overflow:hidden}
.cena .bal{position:absolute;right:16px;top:18px;width:190px;padding:14px 16px;border-radius:20px;background:#0f1f18;color:#f0faf4;font-size:22px;font-weight:800;line-height:1.25}
.cena .bal em{font-style:normal;color:#fbbf24}
.cena .bal:after{content:'';position:absolute;left:-22px;bottom:30px;border:12px solid transparent;border-right-color:#0f1f18}
.cena img{position:absolute;left:0;bottom:4px;width:170px}
</style></head><body>
<div class="top"><div><h1>Este é o <em>Pingo.</em></h1><p>O "$" que mora no pingo do "i" de Appliquei ganhou rosto. Calmo, direto, faz a conta com você. Nunca promete ganho.</p></div><img src="data:image/svg+xml;base64,${WM}"></div>
<div class="poses">${Object.values(POSES)
  .map(
    (p) =>
      `<div class="pose"><img src="${b64(pingo(p))}"><b>${p.nome}</b><small>${p.uso}</small></div>`
  )
  .join('')}</div>
<div class="base">
  <div class="caixa"><div class="rot">Saindo da logo</div>
    <div class="logo-vivo"><img class="w" src="data:image/svg+xml;base64,${WM_SEM}"><img class="p" src="${b64(pingo(POSES.acenando))}"></div>
    <p>Na abertura e no fim dos vídeos, o "$" pula da logo</p></div>
  <div class="caixa"><div class="rot">Em tamanho pequeno</div>
    <div class="icones"><div style="width:180px;height:180px"><img src="${b64(pingo(POSES.feliz))}"></div><div style="width:110px;height:110px"><img src="${b64(pingo(POSES.feliz))}"></div><div style="width:64px;height:64px"><img src="${b64(pingo(POSES.feliz))}"></div></div>
    <p style="margin-top:44px">Ícone, adesivo, notificação</p></div>
  <div class="caixa"><div class="rot">Num Reel</div>
    <div class="cena"><div class="bal">Ajuste o orçamento <em>antes do preço.</em></div><img src="${b64(pingo(POSES.apontando))}"></div></div>
</div>
</body></html>`;

(async () => {
  const { chromium } = require(path.join(MK, '..', 'node_modules', 'playwright'));
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: 1600, height: 1200 } });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(PASTA, 'folha.png') });
  await b.close();
  console.log('gerado: pingo-*.svg e folha.png em', PASTA);
})();
