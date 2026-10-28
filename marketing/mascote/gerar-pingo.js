// Pingo, o mascote do Appliquei: o "$" que fica no pingo do "i" da logo,
// virado gotinha verde. Desenhado em SVG puro (escala sem perder nitidez).
//
//   node marketing/mascote/gerar-pingo.js
//
// Gera em marketing/mascote/pingo/: um SVG por pose (pingo-<pose>.svg) e a
// folha de apresentação (folha.png, 1600×1200) com as poses, o Pingo ao lado
// da marca e em tamanho de ícone.

const fs = require('fs');
const path = require('path');

const MK = path.join(__dirname, '..');
const PASTA = path.join(__dirname, 'pingo');
fs.mkdirSync(PASTA, { recursive: true });

const COR = {
  claro: '#6ee7b7',
  sinal: '#34d399',
  primaria: '#059669',
  escuro: '#047857',
  tinta: '#052e1f',
  ambar: '#fbbf24',
};

// corpo: uma gota com a ponta para cima (o "pingo"), 200×240
const CORPO =
  'M100 18 C 92 34, 38 96, 38 152 C 38 190, 66 216, 100 216 C 134 216, 162 190, 162 152 C 162 96, 108 34, 100 18 Z';

function olhos(tipo) {
  const o = (x, dx, dy) =>
    `<ellipse cx="${x}" cy="138" rx="13" ry="16" fill="#fff"/>` +
    `<circle cx="${x + dx}" cy="${140 + dy}" r="7.5" fill="${COR.tinta}"/>` +
    `<circle cx="${x + dx + 2.5}" cy="${137 + dy}" r="2.4" fill="#fff"/>`;
  if (tipo === 'fechados')
    return `<path d="M66 140 Q78 128 90 140 M110 140 Q122 128 134 140" stroke="${COR.tinta}" stroke-width="5" stroke-linecap="round" fill="none"/>`;
  if (tipo === 'piscando')
    return (
      o(78, 1, 0) +
      `<path d="M110 140 Q122 132 134 140" stroke="${COR.tinta}" stroke-width="5" stroke-linecap="round" fill="none"/>`
    );
  if (tipo === 'cima') return o(78, 3, -6) + o(122, 3, -6);
  if (tipo === 'lado') return o(78, 4, 0) + o(122, 4, 0);
  return o(78, 1, 1) + o(122, 1, 1);
}

function boca(tipo) {
  const s = `stroke="${COR.tinta}" stroke-width="4.5" stroke-linecap="round" fill="none"`;
  if (tipo === 'aberta')
    return `<path d="M86 164 Q100 186 114 164 Z" fill="${COR.tinta}"/><path d="M93 174 Q100 180 107 174" fill="#f87171"/>`;
  if (tipo === 'o') return `<ellipse cx="100" cy="171" rx="6" ry="7" fill="${COR.tinta}"/>`;
  if (tipo === 'reta') return `<path d="M92 170 Q100 172 108 168" ${s}/>`;
  return `<path d="M87 164 Q100 177 113 164" ${s}/>`;
}

const sobrancelhas = {
  alerta: `<path d="M64 116 L88 122 M136 116 L112 122" stroke="${COR.tinta}" stroke-width="4.5" stroke-linecap="round"/>`,
  pensando: `<path d="M66 118 Q78 112 90 118 M110 114 Q122 108 134 114" stroke="${COR.tinta}" stroke-width="4" stroke-linecap="round" fill="none"/>`,
};

// braço: do ombro (x, 160) até a mão (hx, hy), com a mão redonda
function braco(x, hx, hy, cx, cy) {
  return (
    `<path d="M${x} 162 Q${cx} ${cy} ${hx} ${hy}" stroke="${COR.primaria}" stroke-width="10" stroke-linecap="round" fill="none"/>` +
    `<circle cx="${hx}" cy="${hy}" r="9" fill="${COR.sinal}" stroke="${COR.primaria}" stroke-width="3"/>`
  );
}
const BRACOS = {
  baixo: braco(42, 24, 190, 30, 176) + braco(158, 176, 190, 170, 176),
  acena: braco(42, 24, 190, 30, 176) + braco(158, 190, 104, 186, 140),
  queixo: braco(42, 24, 190, 30, 176) + braco(156, 128, 178, 166, 196),
  cima: braco(42, 14, 96, 18, 130) + braco(158, 186, 96, 182, 130),
  aponta: braco(42, 24, 190, 30, 176) + braco(158, 200, 150, 182, 152),
};

function pingo(p) {
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 230 250">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${COR.claro}"/><stop offset=".45" stop-color="${COR.sinal}"/><stop offset="1" stop-color="${COR.primaria}"/></linearGradient></defs>
<ellipse cx="100" cy="228" rx="52" ry="7" fill="#000" opacity=".22"/>
<ellipse cx="80" cy="216" rx="15" ry="8" fill="${COR.escuro}"/><ellipse cx="120" cy="216" rx="15" ry="8" fill="${COR.escuro}"/>
${p.bracosAtras || ''}
<path d="${CORPO}" fill="url(#${id})" stroke="${COR.escuro}" stroke-width="3"/>
<path d="M72 92 C 62 108, 56 124, 58 138" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".45" fill="none"/>
<circle cx="84" cy="62" r="5" fill="#fff" opacity=".5"/>
<ellipse cx="62" cy="160" rx="10" ry="6" fill="${COR.ambar}" opacity=".35"/><ellipse cx="138" cy="160" rx="10" ry="6" fill="${COR.ambar}" opacity=".35"/>
${sobrancelhas[p.sobrancelha] || ''}
${olhos(p.olhos)}
${boca(p.boca)}
<text x="100" y="205" text-anchor="middle" font-family="Figtree, sans-serif" font-weight="900" font-size="26" fill="${COR.tinta}" opacity=".55">$</text>
${BRACOS[p.bracos]}
${p.extra || ''}
</svg>`;
}

const brilho = (x, y, s) =>
  `<path d="M${x} ${y - s} L${x + s * 0.3} ${y - s * 0.3} L${x + s} ${y} L${x + s * 0.3} ${y + s * 0.3} L${x} ${y + s} L${x - s * 0.3} ${y + s * 0.3} L${x - s} ${y} L${x - s * 0.3} ${y - s * 0.3} Z" fill="${COR.ambar}"/>`;

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
    extra: `<text x="168" y="70" font-family="Figtree, sans-serif" font-weight="900" font-size="52" fill="${COR.ambar}">?</text>`,
  },
  alerta: {
    nome: 'Alerta',
    uso: '"antes de apertar"',
    olhos: 'normal',
    boca: 'o',
    bracos: 'baixo',
    sobrancelha: 'alerta',
    extra: `<text x="164" y="72" font-family="Figtree, sans-serif" font-weight="900" font-size="58" fill="${COR.ambar}">!</text>`,
  },
  comemorando: {
    nome: 'Comemorando',
    uso: 'meta batida, sobrou',
    olhos: 'fechados',
    boca: 'aberta',
    bracos: 'cima',
    extra: brilho(30, 60, 12) + brilho(176, 50, 10) + brilho(190, 110, 7) + brilho(14, 130, 6),
  },
};

for (const [k, p] of Object.entries(POSES))
  fs.writeFileSync(path.join(PASTA, `pingo-${k}.svg`), pingo(p));

const FONTES = fs.readFileSync(path.join(MK, '.fontes.css'), 'utf8');
const WM = fs.readFileSync(path.join(MK, '..', 'appliquei-wordmark.svg')).toString('base64');
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
.pose img{width:190px;height:206px}
.pose b{display:block;margin-top:10px;font-size:30px;font-weight:900}
.pose small{display:block;margin-top:4px;font-family:'DM Mono',monospace;font-size:18px;color:#9fb3aa}
.base{position:absolute;left:50px;right:50px;top:690px;display:grid;grid-template-columns:1.25fr 1fr 1fr;gap:18px}
.caixa{border-radius:30px;background:rgba(240,250,244,.05);border:2px solid rgba(240,250,244,.12);padding:30px;height:450px;position:relative}
.caixa .rot{font-family:'DM Mono',monospace;font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:#34d399}
.assin{display:flex;align-items:center;gap:26px;margin-top:70px;justify-content:center}
.assin img.p{width:190px}
.assin img.w{width:380px}
.assin+p{margin-top:40px;text-align:center;font-size:26px;color:#c8d6cf}
.icones{display:flex;align-items:flex-end;justify-content:center;gap:34px;margin-top:70px}
.icones div{display:flex;align-items:center;justify-content:center;border-radius:28%;background:#0f1f18;border:2px solid rgba(52,211,153,.4)}
.icones img{width:72%}
.cena{margin-top:22px;height:340px;border-radius:24px;background:#fff;position:relative;overflow:hidden}
.cena .bal{position:absolute;right:16px;top:18px;width:190px;padding:14px 16px;border-radius:20px;background:#0f1f18;color:#f0faf4;font-size:22px;font-weight:800;line-height:1.25}
.cena .bal em{font-style:normal;color:#fbbf24}
.cena .bal:after{content:'';position:absolute;left:-22px;bottom:30px;border:12px solid transparent;border-right-color:#0f1f18}
.cena img{position:absolute;left:0;bottom:4px;width:140px}
</style></head><body>
<div class="top"><div><h1>Este é o <em>Pingo.</em></h1><p>O "$" que mora no pingo do "i" de Appliquei virou gente. Calmo, direto, faz a conta com você. Nunca promete ganho.</p></div><img src="data:image/svg+xml;base64,${WM}"></div>
<div class="poses">${Object.entries(POSES)
  .map(
    ([k, p]) =>
      `<div class="pose"><img src="${b64(pingo(p))}"><b>${p.nome}</b><small>${p.uso}</small></div>`
  )
  .join('')}</div>
<div class="base">
  <div class="caixa"><div class="rot">Com a marca</div>
    <div class="assin"><img class="p" src="${b64(pingo(POSES.acenando))}"><img class="w" src="data:image/svg+xml;base64,${WM}"></div>
    <p>Assinatura no fim dos vídeos e no perfil</p></div>
  <div class="caixa"><div class="rot">Em tamanho pequeno</div>
    <div class="icones"><div style="width:180px;height:180px"><img src="${b64(pingo(POSES.feliz))}"></div><div style="width:110px;height:110px"><img src="${b64(pingo(POSES.feliz))}"></div><div style="width:64px;height:64px"><img src="${b64(pingo(POSES.feliz))}"></div></div>
    <p style="margin-top:44px;text-align:center;font-size:24px;color:#c8d6cf">Ícone, adesivo, notificação</p></div>
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
