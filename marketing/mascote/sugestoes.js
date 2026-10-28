// 3 estilos para o Pingo (o "$" da logo virado personagem), para o fundador
// escolher: 1) Minimalista, só o rosto no cifrão da logo; 2) Fofo, olhão,
// luvas e tênis, estilo mascote clássico; 3) Descolado, boné e óculos escuros.
//
//   node marketing/mascote/sugestoes.js
//
// Gera marketing/mascote/pingo/sugestoes.png (1600×1000) e um SVG por estilo
// e pose em marketing/mascote/pingo/estilos/.

const fs = require('fs');
const path = require('path');

const MK = path.join(__dirname, '..');
const PASTA = path.join(__dirname, 'pingo', 'estilos');
fs.mkdirSync(PASTA, { recursive: true });

const WM_SVG = fs.readFileSync(path.join(MK, '..', 'appliquei-wordmark.svg'), 'utf8');
const CIFRAO = WM_SVG.match(/<path fill="#10b981" d="([^"]+)"/)[1];
const C = {
  claro: '#6ee7b7',
  marca: '#10b981',
  fundo: '#059669',
  escuro: '#047857',
  tinta: '#052e1f',
  ambar: '#fbbf24',
};

const uid = () => 'g' + Math.random().toString(36).slice(2, 7);
const svg = (corpo, rot) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="948 278 86 90"><g transform="rotate(${rot || 0} 991 330)">${corpo}</g></svg>`;
const sombra = `<ellipse cx="991" cy="361" rx="15" ry="2.2" fill="#000" opacity=".22"/>`;
const sorriso = (w) =>
  `<path d="M986.8 326.2 Q990.5 330.6 994.2 326.2" stroke="${C.tinta}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
const boca = `<path d="M986.2 325.6 Q990.5 333 994.8 325.6 Z" fill="${C.tinta}"/><path d="M988.4 329.6 Q990.5 331.4 992.6 329.6" fill="#f87171"/>`;
function braco(x, y, hx, hy, cx, cy, mao) {
  return (
    `<path d="M${x} ${y} Q${cx} ${cy} ${hx} ${hy}" stroke="${C.escuro}" stroke-width="2.8" stroke-linecap="round" fill="none"/>` +
    mao(hx, hy)
  );
}
const ESQ = [969, 321];
const DIR = [1013.5, 331];

// 1) MINIMALISTA: o cifrão quase igual ao da logo, cor chapada, só o rosto
function minimalista(pose) {
  const olho = (x, fechado) =>
    fechado
      ? `<path d="M${x - 2.4} 319 Q${x} 316 ${x + 2.4} 319" stroke="${C.tinta}" stroke-width="1.5" stroke-linecap="round" fill="none"/>`
      : `<ellipse cx="${x}" cy="318.6" rx="2.1" ry="3" fill="${C.tinta}"/>`;
  return svg(
    `<path d="${CIFRAO}" fill="${C.marca}" stroke="${C.marca}" stroke-width="3.2" stroke-linejoin="round"/>` +
      olho(985.4) +
      olho(995.4, pose === 'acenando') +
      sorriso(1.8),
    pose === 'acenando' ? -10 : 0
  );
}

// 2) FOFO: olhão com brilho, luvas brancas e tênis
function fofo(pose) {
  const g = uid();
  const luva = (x, y) =>
    `<circle cx="${x}" cy="${y}" r="4.6" fill="#fff" stroke="${C.tinta}" stroke-width=".9"/><circle cx="${x - 3.4}" cy="${y - 1.6}" r="1.7" fill="#fff" stroke="${C.tinta}" stroke-width=".8"/>`;
  const olho = (x) =>
    `<ellipse cx="${x}" cy="318" rx="5" ry="6" fill="#fff" stroke="${C.tinta}" stroke-width=".9"/><ellipse cx="${x + 0.6}" cy="319.2" rx="3.2" ry="3.8" fill="${C.tinta}"/>` +
    `<circle cx="${x + 1.8}" cy="317.4" r="1.3" fill="#fff"/><circle cx="${x - 0.6}" cy="321" r=".6" fill="#fff"/>`;
  const tenis = (x) =>
    `<path d="M${x - 5.5} 359.4 Q${x - 5.5} 354.4 ${x} 354.4 Q${x + 6} 354.4 ${x + 6.2} 359.4 Z" fill="#fff" stroke="${C.tinta}" stroke-width=".8"/><rect x="${x - 5.8}" y="358.6" width="12.3" height="1.8" rx=".9" fill="${C.escuro}"/>`;
  const bracos =
    pose === 'acenando'
      ? braco(...ESQ, 961, 335, 962, 327, luva) + braco(...DIR, 1023, 310, 1025, 325, luva)
      : braco(...ESQ, 961, 335, 962, 327, luva) + braco(...DIR, 1021, 343, 1019, 335, luva);
  return svg(
    sombra +
      tenis(986.5) +
      tenis(997) +
      `<defs><linearGradient id="${g}" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="${C.claro}"/><stop offset=".45" stop-color="${C.marca}"/><stop offset="1" stop-color="${C.fundo}"/></linearGradient></defs>` +
      `<path d="${CIFRAO}" fill="${C.escuro}" stroke="${C.escuro}" stroke-width="9.6" stroke-linejoin="round"/>` +
      `<path d="${CIFRAO}" fill="url(#${g})" stroke="url(#${g})" stroke-width="7" stroke-linejoin="round"/>` +
      `<path d="M975 304 Q977 298 984 296" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".55" fill="none"/>` +
      `<ellipse cx="978.6" cy="325.4" rx="2.6" ry="1.5" fill="#fb7185" opacity=".45"/><ellipse cx="1002.4" cy="325.4" rx="2.6" ry="1.5" fill="#fb7185" opacity=".45"/>` +
      olho(984.6) +
      olho(996.4) +
      boca +
      bracos
  );
}

// 3) DESCOLADO: boné de aba pra trás, óculos escuros, joinha
function descolado(pose) {
  const g = uid();
  const mao = (x, y) =>
    `<circle cx="${x}" cy="${y}" r="2.8" fill="${C.marca}" stroke="${C.escuro}" stroke-width="1"/>`;
  const joinha = (x, y) =>
    `<rect x="${x - 2.8}" y="${y - 2.2}" width="5.6" height="5" rx="1.6" fill="${C.marca}" stroke="${C.escuro}" stroke-width="1"/><rect x="${x - 1}" y="${y - 6.6}" width="2.2" height="5" rx="1.1" fill="${C.marca}" stroke="${C.escuro}" stroke-width="1"/>`;
  const tenis = (x) =>
    `<path d="M${x - 5.2} 359.4 Q${x - 5.2} 354.6 ${x} 354.6 Q${x + 5.8} 354.6 ${x + 6} 359.4 Z" fill="${C.ambar}" stroke="${C.tinta}" stroke-width=".8"/><rect x="${x - 5.5}" y="358.6" width="11.8" height="1.8" rx=".9" fill="#fff"/>`;
  const bracos =
    pose === 'acenando'
      ? braco(...ESQ, 961, 334, 962, 326, mao) + braco(...DIR, 1023, 318, 1024, 330, joinha)
      : braco(...ESQ, 961, 334, 962, 326, mao) + braco(...DIR, 1020, 343, 1019, 335, mao);
  return svg(
    sombra +
      tenis(986.5) +
      tenis(997) +
      `<defs><linearGradient id="${g}" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="${C.claro}"/><stop offset=".45" stop-color="${C.marca}"/><stop offset="1" stop-color="${C.fundo}"/></linearGradient></defs>` +
      `<path d="${CIFRAO}" fill="${C.escuro}" stroke="${C.escuro}" stroke-width="8.6" stroke-linejoin="round"/>` +
      `<path d="${CIFRAO}" fill="url(#${g})" stroke="url(#${g})" stroke-width="6" stroke-linejoin="round"/>` +
      // boné com a aba pra trás
      `<path d="M982.6 294.6 Q983 284.6 991.4 284.4 Q999.8 284.6 1000.2 294.6 Z" fill="${C.tinta}"/>` +
      `<path d="M976.4 293.8 Q979 291.4 983.6 292.4 L983.4 295.2 Q979.6 295 976.4 296.2 Z" fill="${C.tinta}"/>` +
      `<rect x="982" y="293.4" width="18.8" height="2.6" rx="1.3" fill="${C.ambar}"/>` +
      // óculos escuros
      `<path d="M979.8 315.4 H989.2 Q989.4 322.6 984.6 322.6 Q980 322.6 979.8 315.4 Z M991.4 315.4 H1000.8 Q1000.6 322.6 996 322.6 Q991.4 322.6 991.4 315.4 Z" fill="#0b1410"/>` +
      `<path d="M989 316 H991.6" stroke="#0b1410" stroke-width="1.4"/>` +
      `<path d="M981.8 317 L984 317 M993.4 317 L995.6 317" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".7"/>` +
      `<path d="M986.4 326 Q990.5 331.4 994.6 326 Z" fill="#fff" stroke="${C.tinta}" stroke-width="1.2" stroke-linejoin="round"/>` +
      bracos
  );
}

const ESTILOS = [
  {
    nome: '1 · Minimalista',
    f: minimalista,
    txt: 'O "$" da logo quase sem mudança: cor chapada, só olhos e sorriso.',
    pro: 'Mais elegante e mais "marca". Ótimo como ícone e figurinha.',
    contra: 'Menos expressivo para contar história.',
  },
  {
    nome: '2 · Fofo',
    f: fofo,
    txt: 'Olhão brilhante, luvas brancas e tênis: o mascote clássico.',
    pro: 'O mais carismático. Funciona com criança e adulto.',
    contra: 'Mais "desenho animado", menos sério.',
  },
  {
    nome: '3 · Descolado',
    f: descolado,
    txt: 'Boné pra trás, óculos escuros e joinha. Fala a língua da internet.',
    pro: 'Chama atenção no feed e combina com Reel e meme.',
    contra: 'Pode envelhecer rápido; os olhos ficam escondidos.',
  },
];
for (const e of ESTILOS) {
  const k = e.nome.split(' · ')[1].toLowerCase();
  for (const pose of ['feliz', 'acenando'])
    fs.writeFileSync(path.join(PASTA, `${k}-${pose}.svg`), e.f(pose));
}

const FONTES = fs.readFileSync(path.join(MK, '.fontes.css'), 'utf8');
const b64 = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${FONTES}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1600px;height:1000px;overflow:hidden;font-family:'Figtree',sans-serif;color:#f0faf4;
background:radial-gradient(50% 45% at 20% 25%,rgba(16,185,129,.2),transparent 70%),linear-gradient(150deg,#0b1410,#0f1f18 50%,#112720)}
h1{position:absolute;left:60px;top:44px;font-size:60px;font-weight:900;letter-spacing:-.03em}
h1 em{font-style:normal;color:#34d399}
.cols{position:absolute;left:50px;right:50px;top:150px;display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.col{min-width:0;border-radius:32px;background:rgba(240,250,244,.05);border:2px solid rgba(240,250,244,.12);padding:28px 30px;height:810px}
.col h2{font-size:38px;font-weight:900}
.par{display:flex;justify-content:center;gap:4px;margin-top:14px;height:300px}
.par img{width:205px}
.ic{display:flex;align-items:center;justify-content:center;gap:22px;margin-top:6px}
.ic div{display:flex;align-items:center;justify-content:center;border-radius:28%;background:#0f1f18;border:2px solid rgba(52,211,153,.4)}
.ic img{width:90%}
.ic div.branco{display:flex;background:#fff;align-items:center;justify-content:center;margin-left:8px;width:120px;height:120px;border-radius:24px;background:#fff}
.branco img{width:100px}
p{margin-top:24px;font-size:25px;line-height:1.35;color:#c8d6cf}
p b{color:#34d399}
p i{font-style:normal;color:#fbbf24;font-weight:700}
</style></head><body>
<h1>Pingo: <em>3 estilos</em> para escolher</h1>
<div class="cols">${ESTILOS.map(
  (e) => `<div class="col"><h2>${e.nome}</h2>
  <div class="par"><img src="${b64(e.f('feliz'))}"><img src="${b64(e.f('acenando'))}"></div>
  <div class="ic"><div style="width:120px;height:120px"><img src="${b64(e.f('feliz'))}"></div><div style="width:64px;height:64px"><img src="${b64(e.f('feliz'))}"></div><div class="branco"><img src="${b64(e.f('feliz'))}"></div></div>
  <p>${e.txt}</p><p><b>A favor:</b> ${e.pro}<br><i>Contra:</i> ${e.contra}</p></div>`
).join('')}</div>
</body></html>`;

(async () => {
  const { chromium } = require(path.join(MK, '..', 'node_modules', 'playwright'));
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(__dirname, 'pingo', 'sugestoes.png') });
  await b.close();
  console.log('gerado: pingo/sugestoes.png e pingo/estilos/*.svg');
})();
