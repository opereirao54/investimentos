// Três versões do convite de beta — três ESTRATÉGIAS de recado, não três
// cores da mesma peça.
//
//   ./fontes.sh && node versoes.js   →  v1.html v2.html v3.html
//
// A lição da primeira tentativa: arte bonita que não diz o que é nem o que se
// quer da pessoa não convida ninguém. Aqui o propósito vem antes da estética —
// em toda versão, nos dois primeiros segundos de leitura, tem de estar claro
// (1) que é um app de finanças, (2) que se procura gente para testar,
// (3) que se responde ali mesmo.
//
// Identidade: gradiente e halos da landing (.hero), fontes do app, wordmark da
// raiz. Ver clareza-instrumental.md.

const fs = require('fs');
const path = require('path');
const { curvaCaixa, suavizar, areaAbaixo, cruzamentos } = require('./curva.js');

const CSS_FONTES = path.join(__dirname, '.fontes.css');
if (!fs.existsSync(CSS_FONTES)) {
  console.error('Faltam as fontes da marca. Rode ./fontes.sh primeiro.');
  process.exit(1);
}
const FONTES = fs.readFileSync(CSS_FONTES, 'utf8');
const WM = fs.readFileSync(path.join(__dirname, '..', 'appliquei-wordmark.svg')).toString('base64');

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

const L = 1080,
  A = 1920,
  M = 96,
  UTIL = L - M * 2;

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

/** A curva do aperto. Só entra onde ela PROVA alguma coisa dita em texto. */
function grafico(largura, altura) {
  const Z = Math.round(altura * 0.6);
  const p = curvaCaixa(largura, altura * 0.355, Z);
  const ys = p.map((q) => q[1]);
  const pad = altura * 0.1;
  const y0 = Math.min(...ys) - pad,
    y1 = Math.max(...ys) + pad;
  const fundo = p.reduce((m, q) => (q[1] > m[1] ? q : m), p[0]);
  const tiques = cruzamentos(p, Z)
    .map(
      (x) =>
        `<line x1="${x.toFixed(1)}" y1="${(Z - altura * 0.05).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(Z + altura * 0.05).toFixed(1)}" stroke="${C.ambar}" stroke-opacity=".55" stroke-width="2"/>`
    )
    .join('');
  return `<svg viewBox="0 ${y0.toFixed(1)} ${largura} ${(y1 - y0).toFixed(1)}" width="100%" style="display:block">
<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${C.ambar}" stop-opacity=".30"/><stop offset="1" stop-color="${C.ambar}" stop-opacity="0"/></linearGradient>
<linearGradient id="gs" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.primaria}"/>
<stop offset=".34" stop-color="${C.ambar}"/><stop offset=".72" stop-color="${C.verde}"/><stop offset="1" stop-color="${C.sinal}"/></linearGradient></defs>
<path d="${areaAbaixo(p, Z)}" fill="url(#ga)"/>
<line x1="0" y1="${Z}" x2="${largura}" y2="${Z}" stroke="${C.tinta}" stroke-opacity=".28" stroke-width="1.5" stroke-dasharray="2 7"/>
${tiques}<path d="${suavizar(p)}" fill="none" stroke="url(#gs)" stroke-width="4.5" stroke-linecap="round"/>
<circle cx="${fundo[0].toFixed(1)}" cy="${fundo[1].toFixed(1)}" r="13" fill="${C.ambar}" fill-opacity=".15"/>
<circle cx="${fundo[0].toFixed(1)}" cy="${fundo[1].toFixed(1)}" r="5" fill="${C.ambar}"/>
<circle cx="${p[p.length - 1][0]}" cy="${p[p.length - 1][1].toFixed(1)}" r="5" fill="${C.sinal}"/></svg>`;
}

// Ícones desenhados aqui, não importados: Phosphor vem de CDN e o render é
// offline. Traço fino e geometria simples, na mesma família do instrumento.
const IC = {
  carteira:
    '<rect x="2.5" y="5.5" width="19" height="14" rx="3"/><path d="M2.5 9.5h19"/><circle cx="17" cy="14.5" r="1.4" fill="currentColor" stroke="none"/>',
  camadas:
    '<path d="M12 3 2.8 7.6 12 12.2l9.2-4.6L12 3Z"/><path d="M2.8 12.4 12 17l9.2-4.6"/><path d="M2.8 16.9 12 21.5l9.2-4.6"/>',
  // O mergulho do saldo, em miniatura — o mesmo gesto do gráfico grande.
  aperto:
    '<path d="M2.5 8c3 0 4.2 7.5 7 7.5S15.5 6 19 6s2.5 3 2.5 3"/><path d="M2.5 12.5h19" stroke-dasharray="1.6 2.6" opacity=".55"/>',
  alvo: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  bandeira: '<path d="M5.2 21V3.6"/><path d="M5.2 4.4h12.4l-2.6 4.2 2.6 4.2H5.2"/>',
  relatorio:
    '<path d="M6 2.6h8.4L19 7.2V21.4H6z"/><path d="M14.2 2.8v4.6h4.6"/><path d="M9 12.4h7M9 16.2h5"/>',
};
const ico = (k) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${IC[k]}</svg>`;

/** Uma funcionalidade: ícone, nome e a frase que a explica em uma linha. */
const func = (k, nome, txt) => `<div class="f"><span class="fi">${ico(k)}</span>
      <span class="ft"><b>${nome}</b>${txt}</span></div>`;

const BASE = `${FONTES}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${L}px;height:${A}px;overflow:hidden;background:${C.campo1}}
.peca{position:relative;width:${L}px;height:${A}px;font-family:'Figtree',sans-serif;
  -webkit-font-smoothing:antialiased;
  background:linear-gradient(150deg,${C.campo1} 0%,${C.campo2} 50%,${C.campo3} 100%)}
.halo{position:absolute;inset:-20%;pointer-events:none;
  background:radial-gradient(60% 40% at 80% 10%,rgba(16,185,129,.18),transparent 70%),
             radial-gradient(40% 35% at 10% 90%,rgba(5,150,105,.14),transparent 70%)}
.malha{position:absolute;inset:0;pointer-events:none}
.corpo{position:absolute;inset:0;padding:${M}px;display:flex;flex-direction:column}
.marca{width:224px;opacity:.97}
.oque{margin-top:13px;font-size:21px;font-weight:500;color:${C.mudo};letter-spacing:.005em}
.pill{display:inline-flex;align-items:center;gap:11px;align-self:flex-start;padding:12px 24px;
  border-radius:999px;background:rgba(217,119,6,.14);border:1px solid rgba(217,119,6,.38);
  color:#fbbf24;font-family:'DM Mono',monospace;font-size:20px;font-weight:500;
  letter-spacing:.16em;text-transform:uppercase}
.pt{width:10px;height:10px;border-radius:50%;background:#fbbf24;box-shadow:0 0 16px #fbbf24}
h1{font-weight:900;font-size:92px;line-height:1.0;letter-spacing:-.035em;color:${C.tinta}}
h1 em{font-style:normal;color:${C.sinal}}
.sub{font-size:32px;line-height:1.5;color:${C.deck};font-weight:400}
.sub b{color:${C.tinta};font-weight:700}
.rot{font-family:'DM Mono',monospace;font-size:19px;letter-spacing:.17em;text-transform:uppercase;
  color:${C.sinal};opacity:.9}
.rotA{font-family:'DM Mono',monospace;font-size:18px;letter-spacing:.17em;text-transform:uppercase;
  color:${C.ambar}}
.linha{height:1px;background:${C.tinta};opacity:.13}
.cta{display:flex;align-items:center;gap:24px;background:${C.primaria};border-radius:20px;padding:30px 34px}
.cta .ic{flex:none;width:58px;height:58px;border-radius:50%;background:rgba(255,255,255,.18);
  display:flex;align-items:center;justify-content:center}
.cta .ic svg{width:27px;height:27px}
.cta .tx{font-weight:800;font-size:38px;line-height:1.14;letter-spacing:-.02em;color:#ffffff}
.rodape{display:flex;align-items:center;gap:20px;font-family:'DM Mono',monospace;font-size:18px;
  letter-spacing:.15em;text-transform:uppercase;color:${C.mudo}}
.rodape b{color:#fbbf24;font-weight:500}
.risco{flex:1;height:1px;background:${C.tinta};opacity:.12}
.g{flex:1}
.f{display:flex;align-items:flex-start;gap:22px;padding:21px 0}
.f + .f{border-top:1px solid rgba(240,250,244,.085)}
.fi{flex:none;width:50px;height:50px;border-radius:14px;color:${C.sinal};
  background:rgba(52,211,153,.10);border:1px solid rgba(52,211,153,.20);
  display:flex;align-items:center;justify-content:center}
.fi svg{width:26px;height:26px}
.ft{font-size:27px;line-height:1.38;color:${C.deck};padding-top:3px}
.ft b{display:block;font-weight:800;font-size:30px;color:${C.tinta};
  letter-spacing:-.012em;margin-bottom:3px}
.mais{font-size:24px;line-height:1.5;color:${C.mudo};margin-top:24px}
.mais b{color:${C.pill};font-weight:600}`;

const SETA = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 5l7 7-7 7"/></svg>`;

const topo = () => `<img class="marca" src="data:image/svg+xml;base64,${WM}" alt="Appliquei">
    <div class="oque">App de controle financeiro e investimentos</div>`;
const cta = (t) =>
  `<div class="cta"><span class="ic">${SETA}</span><span class="tx">${t}</span></div>`;
const rodape = (b) =>
  `<div class="rodape"><span>Vagas limitadas</span><span class="risco"></span><b>${b}</b></div>`;

const env = (miolo) => `<!doctype html><meta charset="utf-8"><style>${BASE}</style>
<div class="peca"><div class="halo"></div>
<svg class="malha" viewBox="0 0 ${L} ${A}">${malha()}</svg>
<div class="corpo">${miolo}</div></div>`;

// ── V1 · O ANÚNCIO ─ o título É o pedido. Zero rodeio, zero metáfora. ────────
const v1 = env(`${topo()}
    <div class="g"></div>
    <div class="pill"><span class="pt"></span>Procuro testadores</div>
    <h1 style="margin-top:34px">Estou<br>procurando<br>pessoas para<br><em>testar meu app.</em></h1>
    <p class="sub" style="margin-top:38px">Ele junta seu controle de gastos, seu patrimônio e
      seus investimentos <b>numa tela só</b> — e avisa quando o dinheiro vai faltar,
      <b>antes</b> de faltar.</p>
    <div class="g" style="flex:.42"></div>
    <div class="rot">O que eu preciso de você</div>
    <p class="sub" style="margin-top:16px">Usar no seu dia a dia e me dizer, sem filtro,
      <b>o que está ruim</b>.</p>
    <div class="g" style="flex:.62"></div>
    ${cta('Responda esta mensagem<br>para entrar.')}
    <div class="g" style="flex:.45"></div>
    ${rodape('fecha quando lotar')}`);

// ── V2 · A PERGUNTA ─ abre na dor que a pessoa reconhece; o gráfico responde. ─
const v2 = env(`${topo()}
    <div class="g"></div>
    <h1>Você sabe<br>quanto vai<br>sobrar até<br><em>o fim do mês?</em></h1>
    <div class="g" style="flex:.55"></div>
    <div class="rotA">Seu saldo, projetado dia a dia</div>
    <div style="margin-top:22px">${grafico(UTIL, 400)}</div>
    <div class="linha" style="margin-top:30px"></div>
    <p class="sub" style="margin-top:30px">Fiz um app que responde isso — e que te avisa
      <b>três dias antes</b> de o dinheiro acabar. <b>Procuro pessoas para testar</b>
      antes de ele abrir para o público.</p>
    <div class="g" style="flex:.55"></div>
    ${cta('Responda esta mensagem<br>para testar.')}
    <div class="g" style="flex:.45"></div>
    ${rodape('fecha quando lotar')}`);

// ── V3 · O BRIEFING ─ o mais explícito: o que é, o que peço, o que você ganha ─
const bloco = (rot, txt) => `<div class="linha" style="margin-top:30px"></div>
    <div class="rot" style="margin-top:28px">${rot}</div>
    <p class="sub" style="margin-top:12px;font-size:30px">${txt}</p>`;
const v3 = env(`${topo()}
    <div class="g" style="flex:.8"></div>
    <div class="pill"><span class="pt"></span>Beta fechado</div>
    <h1 style="margin-top:32px;font-size:86px">Quero te<br>convidar<br><em>para testar.</em></h1>
    ${bloco('O que é', 'Um app que junta seu controle de gastos, seu patrimônio e seus investimentos <b>numa tela só</b>.')}
    ${bloco('O que eu preciso', 'Que você use <b>no seu dia a dia</b> e me diga o que está ruim.')}
    ${bloco('O que você ganha', 'Acesso antes de todo mundo e <b>voz no que entra</b> no produto.')}
    <div class="g" style="flex:.5"></div>
    ${cta('Responda esta mensagem<br>para entrar.')}
    <div class="g" style="flex:.4"></div>
    ${rodape('vagas por ordem de resposta')}`);

// ── V4 · O PRODUTO ─ as funcionalidades carregam o convite. Cada linha é uma
// tela que existe de verdade; o texto sai da landing, não da imaginação. ────
const v4 = env(`${topo()}
    <div class="g" style="flex:.5"></div>
    <div class="pill"><span class="pt"></span>Procuro testadores</div>
    <h1 style="margin-top:30px;font-size:76px">Procuro pessoas<br><em>para testar meu app.</em></h1>
    <div class="rot" style="margin-top:40px">O que tem dentro</div>
    <div style="margin-top:10px">
      ${func('carteira', 'Controle do mês', 'Receitas, despesas, cartões — e quanto sobrou de verdade.')}
      ${func('camadas', 'Patrimônio somado', 'Contas, investimentos e bens num lugar só.')}
      ${func('aperto', 'Aviso de caixa apertado', 'O dia em que o saldo fura, dias antes de furar.')}
      ${func('alvo', 'Carteira sugerida', 'O próximo aporte com o cálculo à vista, ativo por ativo.')}
      ${func('bandeira', 'Sonhos e metas', 'Prazo e aporte calculados a partir da sua sobra real.')}
      ${func('relatorio', 'Relatório mensal', 'Termômetro com cinco critérios, exporta em PDF.')}
    </div>
    <p class="mais">E ainda: <b>jornada de estudo</b> em oito módulos, <b>Info Mercado</b> com
      indicadores e notícias, e <b>Applicash</b> — crédito por indicação.</p>
    <div class="g" style="flex:.6"></div>
    ${cta('Responda esta mensagem<br>para entrar.')}
    <div class="g" style="flex:.4"></div>
    ${rodape('fecha quando lotar')}`);

for (const [n, h] of [
  ['v1', v1],
  ['v2', v2],
  ['v3', v3],
  ['v4', v4],
])
  fs.writeFileSync(`${n}.html`, h);
console.log('geradas: v1 (anúncio) · v2 (pergunta) · v3 (briefing) · v4 (produto)');
