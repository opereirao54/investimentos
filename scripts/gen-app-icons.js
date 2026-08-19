'use strict';

// Gera os ícones de "adicionar à tela de início" (PWA) a partir do vetor
// appliquei-icon.svg. Rodar `npm run icons:build` depois de mexer no logo.
//
// Os PNGs ficam versionados em icons/ — o build NÃO depende deste script; ele
// existe só para regerar quando a marca mudar.
//
// Duas variantes, porque as plataformas mascaram o ícone de formas diferentes:
//
//  - "any" (transparente): o quadrado arredondado do próprio logo, com os
//    cantos vazados. É o que Chrome desktop e alguns launchers desenham como
//    veio.
//  - "maskable"/apple-touch (sangria total): fundo verde ocupando 100% da
//    tela e a seta reduzida ao centro. Android recorta o ícone num círculo ou
//    squircle e o iOS aplica o próprio arredondamento — nas duas, um logo já
//    arredondado perderia os cantos, e no iOS a transparência viraria PRETO.
//    Por isso aqui o fundo é opaco e a seta fica dentro da zona segura
//    (círculo de 80% do lado).

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'appliquei-icon.svg');
const OUT_DIR = path.join(ROOT, 'icons');

const VERDE = '#10b981';

// Bounding boxes medidas no vetor de origem (appliquei-icon.svg): o viewBox
// declarado lá é mais folgado que a arte, então recortamos pela geometria real.
const QUADRADO = { x: 218.95, y: 297.25, w: 196.33, h: 187.75 };
const SETA = { x: 250.95, y: 340.0, w: 131.05, h: 95.0 };

// Quanto da largura do ícone a seta ocupa na variante de sangria total. 54%
// deixa a arte inteira dentro do círculo de zona segura do maskable (80%).
const SETA_PROPORCAO = 0.54;
// Respiro em volta do quadrado arredondado na variante transparente.
const FOLGA = 1.04;

function lerPaths() {
  const svg = fs.readFileSync(SRC, 'utf8');
  const paths = [...svg.matchAll(/<path fill="(#[0-9a-fA-F]{6})" d="([^"]+)"/g)].map((m) => ({
    fill: m[1],
    d: m[2],
  }));
  const quadrado = paths.find((p) => p.fill.toLowerCase() === VERDE);
  const seta = paths.find((p) => p.fill.toLowerCase() === '#ffffff');
  if (!quadrado || !seta) {
    throw new Error('appliquei-icon.svg mudou: não achei o quadrado verde e/ou a seta branca');
  }
  return { quadrado, seta };
}

// Logo completo (quadrado + seta) centrado num canvas quadrado, cantos vazados.
function svgTransparente({ quadrado, seta }) {
  const lado = Math.max(QUADRADO.w, QUADRADO.h) * FOLGA;
  const cx = QUADRADO.x + QUADRADO.w / 2;
  const cy = QUADRADO.y + QUADRADO.h / 2;
  const vb = [cx - lado / 2, cy - lado / 2, lado, lado].map((n) => n.toFixed(2)).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">
  <path fill="${quadrado.fill}" d="${quadrado.d}"/>
  <path fill="${seta.fill}" d="${seta.d}"/>
</svg>`;
}

// Fundo verde de ponta a ponta + seta centrada e reduzida à zona segura.
function svgSangriaTotal({ seta }, lado) {
  const escala = (lado * SETA_PROPORCAO) / SETA.w;
  const dx = lado / 2 - (SETA.x + SETA.w / 2) * escala;
  const dy = lado / 2 - (SETA.y + SETA.h / 2) * escala;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}">
  <rect width="${lado}" height="${lado}" fill="${VERDE}"/>
  <g transform="translate(${dx.toFixed(3)} ${dy.toFixed(3)}) scale(${escala.toFixed(6)})">
    <path fill="${seta.fill}" d="${seta.d}"/>
  </g>
</svg>`;
}

async function gravar(nome, svg, tamanho, { opaco = false } = {}) {
  let pipeline = sharp(Buffer.from(svg), { density: 384 }).resize(tamanho, tamanho);
  // iOS não respeita alpha no apple-touch-icon: o que for transparente é
  // renderizado PRETO. Achatamos contra o verde da marca por segurança.
  if (opaco) pipeline = pipeline.flatten({ background: VERDE });
  const buf = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  const abs = path.join(OUT_DIR, nome);
  fs.writeFileSync(abs, buf);
  console.log(`ok: icons/${nome} ${tamanho}x${tamanho} (${(buf.length / 1024).toFixed(1)}KB)`);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const arte = lerPaths();
  const transparente = svgTransparente(arte);
  const sangria = svgSangriaTotal(arte, 512);

  await gravar('appliquei-icon-192.png', transparente, 192);
  await gravar('appliquei-icon-512.png', transparente, 512);
  await gravar('appliquei-maskable-512.png', sangria, 512, { opaco: true });
  await gravar('appliquei-apple-touch-180.png', sangria, 180, { opaco: true });
})().catch((e) => {
  console.error('falhou:', e.message);
  process.exit(1);
});
