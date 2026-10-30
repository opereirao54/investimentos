// Ideias de mascote em ilustração plana (flat), desenhadas à mão em SVG:
// a Capivara (calma, sábia, de moletom verde e caderninho) e o Caramelo
// (vira-lata caramelo, leal, de bandana verde e moeda) e o João-de-barro
// (constrói aos poucos: capacete de obra verde, tijolinho e a casinha de barro).
//
//   node marketing/mascote/ilustrados.js
//
// Gera marketing/mascote/ilustrados/{capivara,caramelo}.svg e folha.png.

const fs = require('fs');
const path = require('path');

const MK = path.join(__dirname, '..');
const PASTA = path.join(__dirname, 'ilustrados');
fs.mkdirSync(PASTA, { recursive: true });

const V = { verde: '#10b981', verdeEsc: '#047857', verdeClaro: '#6ee7b7', tinta: '#1f140c' };

const capivara = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 420">
<defs>
  <radialGradient id="cpPelo" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#b98252"/><stop offset="1" stop-color="#8a5a32"/></radialGradient>
  <linearGradient id="cpMol" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="${V.verdeEsc}"/></linearGradient>
</defs>
<ellipse cx="200" cy="398" rx="130" ry="13" fill="#000" opacity=".25"/>
<!-- pés -->
<ellipse cx="148" cy="388" rx="34" ry="16" fill="#6b4425"/><ellipse cx="252" cy="388" rx="34" ry="16" fill="#6b4425"/>
<path d="M126 392 v-6 M140 395 v-7 M154 395 v-7 M230 392 v-6 M244 395 v-7 M258 395 v-7" stroke="#4a2e17" stroke-width="3" stroke-linecap="round"/>
<!-- corpo de moletom -->
<path d="M92 300 C 92 220, 140 196, 200 196 C 260 196, 308 220, 308 300 C 308 360, 270 392, 200 392 C 130 392, 92 360, 92 300 Z" fill="url(#cpMol)"/>
<path d="M150 206 Q200 236 250 206" stroke="${V.verdeEsc}" stroke-width="6" fill="none" stroke-linecap="round"/>
<path d="M186 222 v40 M214 222 v40" stroke="#ecfdf5" stroke-width="4" stroke-linecap="round"/>
<circle cx="186" cy="265" r="5" fill="#ecfdf5"/><circle cx="214" cy="265" r="5" fill="#ecfdf5"/>
<path d="M140 320 H260 Q262 352 240 356 H160 Q138 352 140 320 Z" fill="${V.verdeEsc}" opacity=".55"/>
<!-- caderninho e lápis -->
<g transform="rotate(-8 200 300)">
  <rect x="150" y="262" width="100" height="74" rx="8" fill="#fff"/>
  <rect x="150" y="262" width="12" height="74" rx="4" fill="${V.verde}"/>
  <path d="M172 282 H236 M172 298 H236 M172 314 H220" stroke="#cbd5e1" stroke-width="4" stroke-linecap="round"/>
  <path d="M172 314 l8 8 l16 -18" stroke="${V.verde}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<!-- patinhas segurando -->
<ellipse cx="146" cy="318" rx="20" ry="16" fill="#8a5a32"/><ellipse cx="256" cy="304" rx="20" ry="16" fill="#8a5a32"/>
<g transform="rotate(35 268 280)"><rect x="262" y="236" width="10" height="58" rx="3" fill="${'#fbbf24'}"/><path d="M262 294 L267 306 L272 294 Z" fill="#f5d0a9"/><rect x="262" y="236" width="10" height="9" rx="2" fill="#f87171"/></g>
<!-- capuz atrás da cabeça -->
<path d="M108 170 C 100 110, 150 78, 200 78 C 250 78, 300 110, 292 170 C 286 206, 250 214, 200 214 C 150 214, 114 206, 108 170 Z" fill="${V.verdeEsc}"/>
<!-- cabeça (focinho de capivara, largo e quadradão) -->
<rect x="116" y="56" width="168" height="172" rx="64" fill="url(#cpPelo)"/>
<path d="M128 150 C 128 128, 156 122, 200 122 C 244 122, 272 128, 272 150 L272 186 C 272 214, 246 226, 200 226 C 154 226, 128 214, 128 186 Z" fill="#a06d40"/>
<!-- orelhinhas -->
<ellipse cx="142" cy="62" rx="14" ry="12" fill="#7a4b28"/><ellipse cx="258" cy="62" rx="14" ry="12" fill="#7a4b28"/>
<ellipse cx="142" cy="64" rx="7" ry="6" fill="#5c3519"/><ellipse cx="258" cy="64" rx="7" ry="6" fill="#5c3519"/>
<!-- olhos tranquilos, meio fechados -->
<ellipse cx="160" cy="112" rx="13" ry="10" fill="${V.tinta}"/><ellipse cx="240" cy="112" rx="13" ry="10" fill="${V.tinta}"/>
<path d="M144 108 Q160 98 176 108 L176 102 Q160 92 144 102 Z" fill="#8a5a32"/><path d="M224 108 Q240 98 256 108 L256 102 Q240 92 224 102 Z" fill="#8a5a32"/>
<path d="M145 109 Q160 101 175 109 M225 109 Q240 101 255 109" stroke="#5c3519" stroke-width="3" fill="none" stroke-linecap="round"/>
<circle cx="165" cy="114" r="3" fill="#fff"/><circle cx="245" cy="114" r="3" fill="#fff"/>
<!-- focinho -->
<rect x="170" y="146" width="60" height="30" rx="13" fill="#4a2c17"/>
<path d="M186 154 L183 166 M214 154 L217 166" stroke="#140b05" stroke-width="5" stroke-linecap="round"/>
<path d="M176 150 Q186 147 196 149" stroke="#7a4b28" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>
<path d="M200 184 v12 M182 200 Q200 212 218 200" stroke="#3d2414" stroke-width="4" fill="none" stroke-linecap="round"/>
<ellipse cx="140" cy="172" rx="14" ry="8" fill="#e8a27a" opacity=".45"/><ellipse cx="260" cy="172" rx="14" ry="8" fill="#e8a27a" opacity=".45"/>
<!-- brilho do pelo -->
<path d="M140 92 Q156 74 182 70" stroke="#d4a373" stroke-width="6" fill="none" stroke-linecap="round" opacity=".6"/>
</svg>`;

const caramelo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 420">
<defs>
  <radialGradient id="cmPelo" cx=".45" cy=".3" r=".85"><stop offset="0" stop-color="#e9a456"/><stop offset="1" stop-color="#c47a2c"/></radialGradient>
  <radialGradient id="cmMoeda" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#d97706"/></radialGradient>
</defs>
<ellipse cx="200" cy="398" rx="130" ry="13" fill="#000" opacity=".25"/>
<!-- rabo abanando -->
<path d="M288 330 C 336 320, 350 280, 336 248" stroke="#c47a2c" stroke-width="26" fill="none" stroke-linecap="round"/>
<path d="M336 262 C 342 256, 342 250, 336 246" stroke="#f3d9b1" stroke-width="16" fill="none" stroke-linecap="round"/>
<!-- corpo sentado -->
<path d="M112 310 C 112 236, 150 206, 200 206 C 250 206, 288 236, 288 310 C 288 366, 256 392, 200 392 C 144 392, 112 366, 112 310 Z" fill="url(#cmPelo)"/>
<path d="M164 236 C 170 300, 230 300, 236 236 C 236 330, 228 382, 200 382 C 172 382, 164 330, 164 236 Z" fill="#f3d9b1"/>
<!-- patas -->
<rect x="146" y="330" width="40" height="62" rx="20" fill="#d88e3e"/><rect x="214" y="330" width="40" height="62" rx="20" fill="#d88e3e"/>
<path d="M156 388 v-8 M166 390 v-9 M176 388 v-8 M224 388 v-8 M234 390 v-9 M244 388 v-8" stroke="#a5611f" stroke-width="3" stroke-linecap="round"/>
<!-- moeda na pata -->
<circle cx="268" cy="300" r="30" fill="url(#cmMoeda)" stroke="#b45309" stroke-width="4"/>
<circle cx="268" cy="300" r="21" fill="none" stroke="#b45309" stroke-width="3" opacity=".6"/>
<path d="M276 290 Q268 284 261 289 Q256 296 268 300 Q280 304 275 311 Q268 316 259 310 M268 282 v36" stroke="#92400e" stroke-width="4" fill="none" stroke-linecap="round"/>
<ellipse cx="252" cy="318" rx="20" ry="16" fill="#d88e3e"/>
<!-- bandana verde -->
<path d="M140 224 Q200 250 260 224 L250 214 Q200 236 150 214 Z" fill="${V.verdeEsc}"/>
<path d="M150 224 Q200 248 250 224 L208 292 Q200 302 192 292 Z" fill="${V.verde}"/>
<circle cx="186" cy="254" r="5" fill="#ecfdf5"/><circle cx="212" cy="252" r="5" fill="#ecfdf5"/><circle cx="200" cy="274" r="5" fill="#ecfdf5"/>
<!-- orelhas caídas -->
<path d="M118 92 C 86 100, 78 158, 98 196 C 112 214, 132 196, 136 168 Z" fill="#a5611f"/>
<path d="M282 92 C 314 100, 322 158, 302 196 C 288 214, 268 196, 264 168 Z" fill="#a5611f"/>
<!-- cabeça -->
<ellipse cx="200" cy="140" rx="92" ry="86" fill="url(#cmPelo)"/>
<!-- focinho claro -->
<ellipse cx="200" cy="178" rx="56" ry="42" fill="#f3d9b1"/>
<path d="M200 70 C 188 100, 188 130, 200 150 C 212 130, 212 100, 200 70 Z" fill="#f3d9b1" opacity=".7"/>
<!-- sobrancelhas de caramelo -->
<ellipse cx="160" cy="108" rx="11" ry="7" fill="#f3d9b1"/><ellipse cx="240" cy="108" rx="11" ry="7" fill="#f3d9b1"/>
<!-- olhos grandes -->
<circle cx="164" cy="134" r="16" fill="${V.tinta}"/><circle cx="236" cy="134" r="16" fill="${V.tinta}"/>
<circle cx="170" cy="128" r="6" fill="#fff"/><circle cx="242" cy="128" r="6" fill="#fff"/>
<circle cx="159" cy="141" r="2.6" fill="#fff"/><circle cx="231" cy="141" r="2.6" fill="#fff"/>
<!-- nariz e boca com língua -->
<path d="M182 160 Q200 150 218 160 Q216 176 200 178 Q184 176 182 160 Z" fill="${V.tinta}"/>
<ellipse cx="194" cy="161" rx="5" ry="3" fill="#fff" opacity=".5"/>
<path d="M200 178 v10 M176 186 Q188 200 200 188 Q212 200 224 186" stroke="${V.tinta}" stroke-width="4" fill="none" stroke-linecap="round"/>
<path d="M190 194 Q200 222 210 194 Z" fill="#f87171"/><path d="M200 197 v14" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/>
<ellipse cx="146" cy="170" rx="13" ry="8" fill="#f87171" opacity=".3"/><ellipse cx="254" cy="170" rx="13" ry="8" fill="#f87171" opacity=".3"/>
</svg>`;

const joao = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 0 400 420">
<defs>
  <radialGradient id="jbPena" cx=".4" cy=".3" r=".85"><stop offset="0" stop-color="#d4823f"/><stop offset="1" stop-color="#a8561f"/></radialGradient>
  <radialGradient id="jbBarro" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#c98a52"/><stop offset="1" stop-color="#94592b"/></radialGradient>
  <linearGradient id="jbCap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="${V.verdeEsc}"/></linearGradient>
</defs>
<ellipse cx="210" cy="398" rx="170" ry="13" fill="#000" opacity=".25"/>
<!-- a casinha de barro -->
<path d="M236 392 C 222 300, 256 214, 318 214 C 380 214, 400 300, 386 392 Z" fill="url(#jbBarro)"/>
<path d="M250 330 Q300 316 376 330 M244 290 Q300 274 382 292 M256 254 Q310 240 370 256 M240 366 Q310 354 384 368" stroke="#7c4620" stroke-width="3" fill="none" opacity=".45" stroke-linecap="round"/>
<path d="M300 392 C 300 356, 312 336, 330 336 C 348 336, 358 356, 358 392 Z" fill="#3b2212"/>
<path d="M290 226 Q312 216 336 222" stroke="#e2b07d" stroke-width="6" fill="none" stroke-linecap="round" opacity=".6"/>
<!-- rabo -->
<path d="M206 300 L268 330 Q276 342 262 344 L200 322 Z" fill="#b0581d"/>
<!-- pernas -->
<path d="M150 336 L144 388 M176 336 L180 388" stroke="#7a6a5a" stroke-width="7" stroke-linecap="round"/>
<path d="M128 390 H152 M140 390 L146 382 M168 390 H194 M180 390 L186 382" stroke="#7a6a5a" stroke-width="6" stroke-linecap="round"/>
<!-- corpo -->
<ellipse cx="166" cy="276" rx="74" ry="72" fill="url(#jbPena)"/>
<path d="M108 262 C 110 314, 140 344, 176 344 C 196 344, 214 334, 222 318 C 190 330, 140 312, 108 262 Z" fill="#f1d9b5"/>
<ellipse cx="146" cy="292" rx="42" ry="40" fill="#f1d9b5"/>
<!-- asa segurando um tijolinho -->
<path d="M196 236 C 236 246, 246 300, 222 330 C 206 318, 190 290, 196 236 Z" fill="#8f4716"/>
<path d="M206 262 Q224 270 228 290 M204 282 Q220 290 222 306" stroke="#6e3510" stroke-width="3" fill="none" stroke-linecap="round" opacity=".6"/>
<g transform="rotate(-12 236 312)"><rect x="216" y="298" width="44" height="26" rx="5" fill="#c2703a" stroke="#7c4620" stroke-width="3"/><path d="M216 311 H260 M238 298 V311" stroke="#7c4620" stroke-width="2.5" opacity=".7"/></g>
<!-- cabeça -->
<circle cx="150" cy="170" r="62" fill="url(#jbPena)"/>
<path d="M100 192 C 108 222, 140 236, 168 230 C 150 222, 118 214, 100 192 Z" fill="#fbf3e6"/>
<!-- sobrancelha clara do joão-de-barro -->
<path d="M100 150 Q130 132 170 146" stroke="#f1d9b5" stroke-width="9" fill="none" stroke-linecap="round"/>
<!-- olho -->
<circle cx="132" cy="170" r="17" fill="#fff"/><circle cx="128" cy="172" r="12" fill="${V.tinta}"/>
<circle cx="132" cy="167" r="4.5" fill="#fff"/><circle cx="124" cy="177" r="2" fill="#fff"/>
<!-- bico -->
<path d="M96 184 C 70 186, 52 196, 44 206 C 62 202, 82 200, 100 198 Z" fill="#6b5a4a"/>
<path d="M96 192 C 78 194, 60 200, 46 205" stroke="#4a3d31" stroke-width="2" fill="none"/>
<ellipse cx="160" cy="200" rx="13" ry="8" fill="#f87171" opacity=".3"/>
<!-- capacete de obra verde -->
<path d="M96 130 C 98 92, 126 74, 156 74 C 190 74, 214 96, 214 130 Z" fill="url(#jbCap)"/>
<path d="M150 76 C 146 90, 146 116, 150 130 M128 82 C 120 98, 118 116, 120 130" stroke="${V.verdeEsc}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>
<rect x="84" y="126" width="142" height="14" rx="7" fill="${V.verdeEsc}"/>
<path d="M118 90 Q132 80 148 80" stroke="#a7f3d0" stroke-width="6" fill="none" stroke-linecap="round" opacity=".7"/>
</svg>`;

fs.writeFileSync(path.join(PASTA, 'capivara.svg'), capivara);
fs.writeFileSync(path.join(PASTA, 'joao-de-barro.svg'), joao);
fs.writeFileSync(path.join(PASTA, 'caramelo.svg'), caramelo);

const FONTES = fs.readFileSync(path.join(MK, '.fontes.css'), 'utf8');
const b64 = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${FONTES}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1600px;height:1000px;overflow:hidden;font-family:'Figtree',sans-serif;color:#f0faf4;
background:radial-gradient(60% 50% at 50% 45%,rgba(16,185,129,.2),transparent 70%),linear-gradient(150deg,#0b1410,#0f1f18 50%,#112720)}
.g{display:flex;justify-content:center;gap:20px;padding-top:150px}
.g div{text-align:center}
.g img{width:500px;height:525px}
.g b{display:block;font-size:56px;font-weight:900;letter-spacing:-.03em}
.g div{width:510px}
.g small{display:block;margin-top:8px;font-size:26px;color:#c8d6cf}
</style></head><body><div class="g">
<div><img src="${b64(capivara)}"><b>Capivara</b><small>calma, sábia, faz a conta sem pressa</small></div>
<div><img src="${b64(caramelo)}"><b>Caramelo</b><small>o amigo leal que entende de dinheiro</small></div>
<div><img src="${b64(joao)}"><b>João-de-barro</b><small>constrói aos poucos, tijolo por tijolo</small></div>
</div></body></html>`;

(async () => {
  const { chromium } = require(path.join(MK, '..', 'node_modules', 'playwright'));
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(PASTA, 'folha.png') });
  await b.close();
  console.log('gerado: ilustrados/capivara.svg, caramelo.svg, joao-de-barro.svg e folha.png');
})();
