// Peças do convite de beta da Appliquei para WhatsApp.
//
//   ./fontes.sh && node gerar.js   →  status.html + quadrado.html
//
// A identidade não é recriada aqui: o gradiente e os halos são copiados da
// landing (.hero), as fontes são as mesmas três do app (Syne, Figtree, DM
// Mono) e o wordmark é o SVG da raiz. Ver clareza-instrumental.md para a
// filosofia visual.
//
// Para ajustar o convite, mexa nos parâmetros — não redesenhe:
//   STATUS / QUADRADO  → escalas tipográficas e margens de cada formato
//   peca({ deck })     → o texto de apoio
//   <h1>               → a chamada (cuidado: Syne 800 é larga, ~10 car./linha
//                        a 98px numa caixa de 888px — meça antes)

const fs = require('fs');
const { curvaCaixa, suavizar, areaAbaixo, cruzamentos } = require('./curva.js');
const CAMINHO_FONTES = require('path').join(__dirname, '.fontes.css');
if (!fs.existsSync(CAMINHO_FONTES)) {
  console.error('Faltam as fontes da marca. Rode ./fontes.sh neste diretório primeiro.');
  process.exit(1);
}
const FONTES = fs.readFileSync(CAMINHO_FONTES, 'utf8');
// O wordmark vem do SVG da marca, na raiz do repositório — nunca redesenhado.
const WM = Buffer.from(
  fs.readFileSync(require('path').join(__dirname, '..', 'appliquei-wordmark.svg'))
).toString('base64');

// Paleta — exatamente a da marca (landing .hero + tokens do app).
const C = {
  campo1: '#0b1410',
  campo2: '#0f1f18',
  campo3: '#112720',
  tinta: '#f0faf4',
  deck: '#c8d6cf',
  mudo: '#9fb3aa',
  sinal: '#34d399',
  verde: '#10b981',
  primaria: '#059669',
  pill: '#6ee7b7',
  ambar: '#d97706',
};

/** A malha milimétrica + marcas de escala. Densa, mas quase invisível. */
function malha(L, A, passo) {
  const t = [];
  for (let x = passo; x < L; x += passo)
    t.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${A}" stroke="${C.tinta}" stroke-opacity=".020" stroke-width="1"/>`
    );
  for (let y = passo; y < A; y += passo)
    t.push(
      `<line x1="0" y1="${y}" x2="${L}" y2="${y}" stroke="${C.tinta}" stroke-opacity=".020" stroke-width="1"/>`
    );
  // Marcas de escala nas bordas: o carimbo do instrumento.
  for (let y = passo * 2; y < A; y += passo * 2) {
    t.push(
      `<line x1="0" y1="${y}" x2="14" y2="${y}" stroke="${C.sinal}" stroke-opacity=".16" stroke-width="1.5"/>`
    );
    t.push(
      `<line x1="${L - 14}" y1="${y}" x2="${L}" y2="${y}" stroke="${C.sinal}" stroke-opacity=".16" stroke-width="1.5"/>`
    );
  }
  return t.join('');
}

/** O instrumento: saldo projetado cruzando o zero e voltando. */
function instrumento(L, A) {
  const Z = Math.round(A * 0.6);
  const p = curvaCaixa(L, A * 0.355, Z);
  const ys = p.map((q) => q[1]);
  // A moldura se fecha sobre a curva: ar morto dentro de um gráfico é ruído,
  // não respiro — o respiro mora na página, não dentro do instrumento.
  const pad = A * 0.11;
  const y0 = Math.min(...ys) - pad,
    y1 = Math.max(...ys) + pad;
  const fundo = p.reduce((m, q) => (q[1] > m[1] ? q : m), p[0]);
  const fim = p[p.length - 1];
  const cruz = cruzamentos(p, Z);
  const marcas = [];
  for (let x = 0; x <= L + 0.1; x += L / 24)
    marcas.push(
      `<line x1="${x.toFixed(1)}" y1="${Z}" x2="${x.toFixed(1)}" y2="${Z + A * 0.018}" stroke="${C.tinta}" stroke-opacity=".10" stroke-width="1"/>`
    );
  // Os dois instantes em que o saldo cruza o zero: tiques verticais finos,
  // como um instrumento marca o que mediu.
  const tiques = cruz
    .map(
      (x) =>
        `<line x1="${x.toFixed(1)}" y1="${(Z - A * 0.05).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(Z + A * 0.05).toFixed(1)}" stroke="${C.ambar}" stroke-opacity=".55" stroke-width="2"/>`
    )
    .join('');
  return `
<svg viewBox="0 ${y0.toFixed(1)} ${L} ${(y1 - y0).toFixed(1)}" width="100%" style="display:block">
  <defs>
    <linearGradient id="gAperto" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.ambar}" stop-opacity=".30"/>
      <stop offset="1" stop-color="${C.ambar}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="gSinal" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.primaria}"/>
      <stop offset=".34" stop-color="${C.ambar}"/>
      <stop offset=".72" stop-color="${C.verde}"/>
      <stop offset="1" stop-color="${C.sinal}"/>
    </linearGradient>
  </defs>
  ${marcas.join('')}
  <path d="${areaAbaixo(p, Z)}" fill="url(#gAperto)"/>
  <line x1="0" y1="${Z}" x2="${L}" y2="${Z}" stroke="${C.tinta}" stroke-opacity=".28" stroke-width="1.5" stroke-dasharray="2 7"/>
  ${tiques}
  <path d="${suavizar(p)}" fill="none" stroke="url(#gSinal)" stroke-width="4.5" stroke-linecap="round"/>
  <circle cx="${fundo[0].toFixed(1)}" cy="${fundo[1].toFixed(1)}" r="14" fill="${C.ambar}" fill-opacity=".15"/>
  <circle cx="${fundo[0].toFixed(1)}" cy="${fundo[1].toFixed(1)}" r="5.5" fill="${C.ambar}"/>
  <circle cx="${fim[0]}" cy="${fim[1].toFixed(1)}" r="5.5" fill="${C.sinal}"/>
</svg>`;
}

function peca({ L, A, escala, deck, nome }) {
  const m = Math.round(L * escala.margem);
  const instL = L - m * 2;
  return `<!doctype html><meta charset="utf-8"><style>
${FONTES}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${L}px;height:${A}px;overflow:hidden;background:${C.campo1}}
.peca{position:relative;width:${L}px;height:${A}px;
  background:linear-gradient(150deg,${C.campo1} 0%,${C.campo2} 50%,${C.campo3} 100%);
  font-family:'Figtree',sans-serif;-webkit-font-smoothing:antialiased}
/* Os dois halos da landing, nas mesmas coordenadas e opacidades. */
.halo{position:absolute;inset:-20%;pointer-events:none;
  background:radial-gradient(60% 40% at 80% 10%,rgba(16,185,129,.18),transparent 70%),
             radial-gradient(40% 35% at 10% 90%,rgba(5,150,105,.14),transparent 70%)}
.malha{position:absolute;inset:0;pointer-events:none}
.corpo{position:absolute;inset:0;padding:${m}px;display:flex;flex-direction:column}
.marca{width:${escala.wm}px;opacity:.97}
.pill{display:inline-flex;align-items:center;gap:${escala.pillGap}px;align-self:flex-start;
  padding:${escala.pillPy}px ${escala.pillPx}px;border-radius:999px;
  background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.22);
  color:${C.pill};font-family:'DM Mono',monospace;font-size:${escala.pill}px;
  font-weight:500;letter-spacing:.17em;text-transform:uppercase}
.ponto{width:${escala.ponto}px;height:${escala.ponto}px;border-radius:50%;background:${C.sinal};
  box-shadow:0 0 ${escala.ponto * 2.4}px ${C.sinal}}
h1{font-family:'Syne',sans-serif;font-weight:800;font-size:${escala.h1}px;line-height:.94;
  letter-spacing:-.034em;color:${C.tinta}}
h1 em{font-style:normal;color:${C.sinal}}
.deck{font-size:${escala.deck}px;line-height:1.52;color:${C.deck};max-width:${escala.deckMax}px;font-weight:400}
.inst{position:relative}
.eixo{display:flex;justify-content:space-between;margin-top:${escala.eixoTop}px;
  font-family:'DM Mono',monospace;font-size:${escala.micro}px;letter-spacing:.14em;
  text-transform:uppercase;color:${C.mudo};opacity:.62}
.legenda{font-family:'DM Mono',monospace;font-size:${escala.micro}px;letter-spacing:.14em;
  text-transform:uppercase;color:${C.ambar};opacity:.95;margin-bottom:${escala.legMb}px}
.cta{display:flex;align-items:center;gap:${escala.ctaGap}px}
.seta{flex:none;width:${escala.seta}px;height:${escala.seta}px;border-radius:50%;
  background:${C.primaria};display:flex;align-items:center;justify-content:center}
.seta svg{width:${escala.seta * 0.42}px;height:${escala.seta * 0.42}px}
.ctaTxt{font-family:'Syne',sans-serif;font-weight:700;font-size:${escala.cta}px;
  line-height:1.16;letter-spacing:-.02em;color:${C.tinta}}
.rodape{display:flex;align-items:center;gap:${escala.rodGap}px;
  font-family:'DM Mono',monospace;font-size:${escala.micro}px;letter-spacing:.15em;
  text-transform:uppercase;color:${C.mudo}}
.rodape b{color:${C.pill};font-weight:500}
.risco{flex:1;height:1px;background:${C.tinta};opacity:.12}
.v1{flex:1.05}
.v2{flex:.78}
.v3{flex:.86}
.v4{flex:.52}
</style>
<div class="peca">
  <div class="halo"></div>
  <svg class="malha" viewBox="0 0 ${L} ${A}">${malha(L, A, escala.passo)}</svg>
  <div class="corpo">
    <img class="marca" src="data:image/svg+xml;base64,${WM}" alt="Appliquei">
    <div class="v1"></div>
    <div class="pill"><span class="ponto"></span>Beta fechado</div>
    <h1 style="margin-top:${escala.h1Top}px">Você entra<br><em>antes.</em></h1>
    ${deck ? `<p class="deck" style="margin-top:${escala.deckTop}px">${deck}</p>` : ''}
    <div class="v2"></div>
    <div class="inst">
      <div class="legenda">o aperto, três dias antes de acontecer</div>
      ${instrumento(instL, escala.instA)}
      <div class="eixo"><span>hoje</span><span>saldo projetado</span><span>dia do salário</span></div>
    </div>
    <div class="v3"></div>
    <div class="cta">
      <span class="seta"><svg viewBox="0 0 24 24" fill="none" stroke="#06281c" stroke-width="3.4"
        stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 5l7 7-7 7"/></svg></span>
      <span class="ctaTxt">Responda esta mensagem<br>para entrar no teste.</span>
    </div>
    <div class="v4"></div>
    <div class="rodape"><span>Vagas limitadas</span><span class="risco"></span><b>fecha quando lotar</b></div>
  </div>
</div>`;
}

const STATUS = {
  margem: 0.089,
  wm: 236,
  passo: 60,
  instA: 530,
  pill: 19,
  pillPx: 22,
  pillPy: 11,
  pillGap: 11,
  ponto: 9,
  h1: 98,
  h1Top: 34,
  deck: 33,
  deckMax: 830,
  deckTop: 34,
  micro: 17,
  eixoTop: 26,
  legMb: 22,
  cta: 46,
  ctaGap: 26,
  seta: 74,
  rodGap: 22,
};
const QUADRADO = {
  margem: 0.074,
  wm: 196,
  passo: 54,
  instA: 300,
  pill: 16,
  pillPx: 18,
  pillPy: 9,
  pillGap: 9,
  ponto: 7.5,
  h1: 74,
  h1Top: 22,
  deck: 25,
  deckMax: 700,
  deckTop: 22,
  micro: 14,
  eixoTop: 18,
  legMb: 16,
  cta: 35,
  ctaGap: 20,
  seta: 58,
  rodGap: 18,
};

fs.writeFileSync(
  'status.html',
  peca({
    L: 1080,
    A: 1920,
    escala: STATUS,
    nome: 'status',
    deck: 'Seu mês, seu patrimônio e seus investimentos numa tela só — e um aviso quando o dinheiro vai faltar, <em style="color:#f0faf4;font-style:normal;font-weight:600">antes de faltar</em>.',
  })
);
fs.writeFileSync(
  'quadrado.html',
  peca({
    L: 1080,
    A: 1080,
    escala: QUADRADO,
    nome: 'quadrado',
    deck: 'Seu mês, seu patrimônio e seus investimentos numa tela só — e um aviso <em style="color:#f0faf4;font-style:normal;font-weight:600">antes</em> de o dinheiro faltar.',
  })
);
console.log(
  'html gerado:',
  ['status.html', 'quadrado.html']
    .map((f) => f + ' ' + Math.round(fs.statSync(f).size / 1024) + 'KB')
    .join(' · ')
);
