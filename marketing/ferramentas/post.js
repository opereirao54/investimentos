// Post ou story com a identidade da Appliquei, a partir de uma especificação.
//
//   ./marketing/fontes.sh            (uma vez: baixa as fontes da marca)
//   node marketing/ferramentas/post.js spec.json saida.png
//
// spec.json (todos os campos opcionais, menos "titulo"):
// {
//   "formato": "post",                 // "post" 1080×1350 ou "story" 1080×1920
//   "rotulo": "Finanças + investimentos",
//   "titulo": "Seu dinheiro inteiro,<br><em>numa tela só.</em>",
//   "subtitulo": "Do gasto do dia ao próximo aporte.",
//   "itens": [
//     { "icone": "carteira", "nome": "Controle do mês", "texto": "Receitas, despesas e cartões." }
//   ],
//   "cta": "Comece grátis por 7 dias.",
//   "ctaNota": "Sem cartão. Sem cobrança automática no fim do teste."
// }
// Ícones: carteira, camadas, aperto, alvo, bandeira, relatorio, aviao, calendario.
// <em> no título pinta de verde-sinal. Identidade: marketing/clareza-instrumental.md.

const fs = require('fs');
const path = require('path');

const [, , specArq, saida] = process.argv;
if (!specArq || !saida) {
  console.error('uso: node marketing/ferramentas/post.js spec.json saida.png');
  process.exit(1);
}
const MK = path.join(__dirname, '..');
const CSS_FONTES = path.join(MK, '.fontes.css');
if (!fs.existsSync(CSS_FONTES)) {
  console.error('Faltam as fontes da marca. Rode ./marketing/fontes.sh primeiro.');
  process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(specArq, 'utf8'));
const FONTES = fs.readFileSync(CSS_FONTES, 'utf8');
const WM = fs.readFileSync(path.join(MK, '..', 'appliquei-wordmark.svg')).toString('base64');

const C = {
  campo1: '#0b1410',
  campo2: '#0f1f18',
  campo3: '#112720',
  tinta: '#f0faf4',
  deck: '#c8d6cf',
  sinal: '#34d399',
  primaria: '#059669',
};
const L = 1080;
const A = spec.formato === 'story' ? 1920 : 1350;
const M = 80;

function malha() {
  const t = [];
  for (let x = 60; x < L; x += 60)
    t.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${A}" stroke="${C.tinta}" stroke-opacity=".018"/>`
    );
  for (let y = 60; y < A; y += 60)
    t.push(
      `<line x1="0" y1="${y}" x2="${L}" y2="${y}" stroke="${C.tinta}" stroke-opacity=".018"/>`
    );
  for (let y = 120; y < A; y += 120) {
    t.push(
      `<line x1="0" y1="${y}" x2="13" y2="${y}" stroke="${C.sinal}" stroke-opacity=".14" stroke-width="1.5"/>`
    );
    t.push(
      `<line x1="${L - 13}" y1="${y}" x2="${L}" y2="${y}" stroke="${C.sinal}" stroke-opacity=".14" stroke-width="1.5"/>`
    );
  }
  return t.join('');
}

// Ícones desenhados aqui (o render é offline); mesmo traço das peças do beta.
const IC = {
  carteira:
    '<rect x="2.5" y="5.5" width="19" height="14" rx="3"/><path d="M2.5 9.5h19"/><circle cx="17" cy="14.5" r="1.4" fill="currentColor" stroke="none"/>',
  camadas:
    '<path d="M12 3 2.8 7.6 12 12.2l9.2-4.6L12 3Z"/><path d="M2.8 12.4 12 17l9.2-4.6"/><path d="M2.8 16.9 12 21.5l9.2-4.6"/>',
  aperto:
    '<path d="M2.5 8c3 0 4.2 7.5 7 7.5S15.5 6 19 6s2.5 3 2.5 3"/><path d="M2.5 12.5h19" stroke-dasharray="1.6 2.6" opacity=".55"/>',
  alvo: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  bandeira: '<path d="M5.2 21V3.6"/><path d="M5.2 4.4h12.4l-2.6 4.2 2.6 4.2H5.2"/>',
  relatorio:
    '<path d="M6 2.6h8.4L19 7.2V21.4H6z"/><path d="M14.2 2.8v4.6h4.6"/><path d="M9 12.4h7M9 16.2h5"/>',
  aviao:
    '<path d="M21.3 3.2 2.9 10.4l6.6 2.6 2.5 7 3.4-4.6 4.9 3.7z"/><path d="m9.5 13 11.8-9.8"/>',
  calendario:
    '<rect x="3" y="4.6" width="18" height="16.4" rx="2.6"/><path d="M3 9.4h18M8 2.6v4M16 2.6v4"/><path d="M12 12.6v3.4l2.2 1.4"/>',
};
const ico = (k) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${IC[k] || IC.alvo}</svg>`;
const SETA = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 5l7 7-7 7"/></svg>`;

const itens = (spec.itens || [])
  .map(
    (i) =>
      `<div class="c"><span class="fi">${ico(i.icone)}</span><span class="ct"><b>${i.nome || ''}</b><span>${i.texto || ''}</span></span></div>`
  )
  .join('');
const colunas = (spec.itens || []).length > 4 ? 2 : 1;

const html = `<!doctype html><meta charset="utf-8"><style>${FONTES}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${L}px;height:${A}px;overflow:hidden;background:${C.campo1}}
.peca{position:relative;width:${L}px;height:${A}px;font-family:'Figtree',sans-serif;-webkit-font-smoothing:antialiased;
  background:linear-gradient(150deg,${C.campo1} 0%,${C.campo2} 50%,${C.campo3} 100%)}
.halo{position:absolute;inset:-20%;background:radial-gradient(60% 40% at 80% 10%,rgba(16,185,129,.18),transparent 70%),
  radial-gradient(40% 35% at 10% 90%,rgba(5,150,105,.14),transparent 70%)}
.malha{position:absolute;inset:0}
.corpo{position:absolute;inset:0;padding:${M}px;display:flex;flex-direction:column}
.topo{display:flex;align-items:center;justify-content:space-between}
.marca{width:200px}
.rot{font-family:'DM Mono',monospace;font-size:17px;letter-spacing:.17em;text-transform:uppercase;color:${C.sinal};opacity:.9}
h1{font-weight:900;font-size:${A > 1500 ? 88 : 72}px;line-height:1.02;letter-spacing:-.035em;color:${C.tinta}}
h1 em{font-style:normal;color:${C.sinal}}
.sub{font-size:${A > 1500 ? 30 : 25}px;line-height:1.45;color:${C.deck};margin-top:18px}
.grade{display:grid;grid-template-columns:repeat(${colunas},1fr);gap:14px}
.c{display:flex;align-items:flex-start;gap:16px;padding:20px;border-radius:18px;background:rgba(240,250,244,.035);border:1px solid rgba(240,250,244,.08)}
.ct{display:flex;flex-direction:column;gap:5px}
.ct b{font-weight:800;font-size:22px;line-height:1.15;color:${C.tinta}}
.ct span{font-size:18px;line-height:1.36;color:${C.deck}}
.fi{flex:none;width:44px;height:44px;border-radius:12px;color:${C.sinal};background:rgba(52,211,153,.10);border:1px solid rgba(52,211,153,.20);display:flex;align-items:center;justify-content:center}
.fi svg{width:23px;height:23px}
.cta{display:flex;align-items:center;justify-content:space-between;gap:24px;background:${C.primaria};border-radius:20px;padding:24px 30px}
.cta .tx{font-weight:800;font-size:31px;line-height:1.12;letter-spacing:-.02em;color:#fff}
.cta .tx small{display:block;font-weight:500;font-size:19px;letter-spacing:0;opacity:.85;margin-top:6px}
.cta .ic{flex:none;width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center}
.cta .ic svg{width:26px;height:26px}
.g{flex:1}</style>
<div class="peca"><div class="halo"></div><svg class="malha" viewBox="0 0 ${L} ${A}">${malha()}</svg>
<div class="corpo">
  <div class="topo"><img class="marca" src="data:image/svg+xml;base64,${WM}" alt="Appliquei"><span class="rot">${spec.rotulo || ''}</span></div>
  <div class="g" style="flex:.55"></div>
  <h1>${spec.titulo}</h1>
  ${spec.subtitulo ? `<p class="sub">${spec.subtitulo}</p>` : ''}
  <div class="g" style="flex:.5"></div>
  ${itens ? `<div class="grade">${itens}</div>` : ''}
  <div class="g" style="flex:.6"></div>
  ${spec.cta ? `<div class="cta"><span class="tx">${spec.cta}${spec.ctaNota ? `<small>${spec.ctaNota}</small>` : ''}</span><span class="ic">${SETA}</span></div>` : ''}
</div></div>`;

(async () => {
  const { chromium } = require(path.join(MK, '..', 'node_modules', 'playwright'));
  const exe =
    process.env.CHROMIUM_PATH ||
    (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: L, height: A } });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  const sobra = await p.evaluate(() => {
    const c = document.querySelector('.corpo');
    return c.scrollHeight - c.clientHeight;
  });
  await p.screenshot({ path: saida });
  await b.close();
  if (sobra > 0)
    console.warn(`atenção: o conteúdo passou ${sobra}px da peça — corte itens ou texto.`);
  console.log('gerado:', saida);
})();
