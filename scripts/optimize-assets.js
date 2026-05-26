'use strict';

// Re-encoda os JPGs grandes da raiz em place, preservando o nome (referenciado
// nos HTMLs). Sem mudar formato => zero alteração de código. Idempotente:
// se o arquivo já está abaixo do alvo, pula.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');

// Alvos: arquivos pesados referenciados nos HTMLs (logo + favicon).
// width=null preserva o original; favicon é cortado para 512px (uso real é
// muito menor — 32/64px no <link rel="icon">).
const TARGETS = [
  { file: 'appliquei_logo_white.jpg', quality: 82, maxWidth: 1600 },
  { file: 'appliquei_favicon.jpg', quality: 82, maxWidth: 512 },
];

async function optimize({ file, quality, maxWidth }) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) {
    console.log(`skip: ${file} (não existe)`);
    return;
  }
  const before = fs.statSync(abs).size;
  const img = sharp(abs, { failOn: 'none' });
  const meta = await img.metadata();
  const resize = meta.width && meta.width > maxWidth ? { width: maxWidth } : null;

  const pipeline = sharp(abs, { failOn: 'none' });
  if (resize) pipeline.resize(resize);
  const buf = await pipeline.jpeg({ quality, mozjpeg: true, progressive: true }).toBuffer();

  if (buf.length >= before) {
    console.log(`skip: ${file} (já otimizado: ${(before / 1024).toFixed(0)}KB)`);
    return;
  }
  fs.writeFileSync(abs, buf);
  const after = buf.length;
  const saved = (((before - after) / before) * 100).toFixed(1);
  console.log(
    `ok:   ${file} ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB (-${saved}%)`
  );
}

(async () => {
  for (const t of TARGETS) {
    try {
      await optimize(t);
    } catch (e) {
      console.error(`erro em ${t.file}:`, e.message);
      process.exitCode = 1;
    }
  }
})();
