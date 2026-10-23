// Gera plano-instagram.pdf a partir de plano-instagram.html (A4, com as
// fontes e cores da marca). Uso: node marketing/conteudo/gerar-pdf.js
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright'));

(async () => {
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage();
  await p.goto('file://' + path.join(__dirname, 'plano-instagram.html'));
  await p.evaluate(() => document.fonts.ready);
  const saida = path.join(__dirname, 'plano-instagram.pdf');
  await p.pdf({ path: saida, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close();
  console.log('gerado:', saida);
})();
