// Gera plano-instagram.pdf (A4, visual simples) a partir do CALENDARIO.md,
// para o PDF nunca divergir do calendário. Também grava o HTML intermediário
// (plano-instagram.html). Uso: node marketing/conteudo/gerar-pdf.js
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright'));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/✅/g, '<span class="ok">✓</span>')
    .replace(/🆕/g, '<span class="novo">novo</span>');

// Markdown do calendário → HTML: títulos, parágrafos, listas e tabelas.
function paraHtml(md) {
  const linhas = md.split('\n');
  const out = [];
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i];
    if (/^#{1,3} /.test(l)) {
      const n = l.match(/^#+/)[0].length;
      out.push(`<h${n}>${inline(l.slice(n + 1))}</h${n}>`);
      i++;
    } else if (l.startsWith('|')) {
      const bloco = [];
      while (i < linhas.length && linhas[i].startsWith('|')) bloco.push(linhas[i++]);
      const celulas = (r) =>
        r
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
      const [cab, , ...corpo] = bloco;
      out.push(
        '<table><thead><tr>' +
          celulas(cab)
            .map((c) => `<th>${inline(c)}</th>`)
            .join('') +
          '</tr></thead><tbody>' +
          corpo
            .map(
              (r) =>
                '<tr>' +
                celulas(r)
                  .map((c) => `<td>${inline(c)}</td>`)
                  .join('') +
                '</tr>'
            )
            .join('') +
          '</tbody></table>'
      );
    } else if (l.startsWith('- ')) {
      const itens = [];
      while (i < linhas.length && (linhas[i].startsWith('- ') || linhas[i].startsWith('  '))) {
        if (linhas[i].startsWith('- ')) itens.push(linhas[i].slice(2));
        else itens[itens.length - 1] += ' ' + linhas[i].trim();
        i++;
      }
      out.push('<ul>' + itens.map((t) => `<li>${inline(t)}</li>`).join('') + '</ul>');
    } else if (l.trim()) {
      const par = [];
      while (i < linhas.length && linhas[i].trim() && !/^(#|\||- )/.test(linhas[i]))
        par.push(linhas[i++]);
      out.push(`<p>${inline(par.join(' '))}</p>`);
    } else i++;
  }
  return out.join('\n');
}

const md = fs.readFileSync(path.join(__dirname, 'CALENDARIO.md'), 'utf8');
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Calendário até o lançamento</title><style>
@page { size: A4; margin: 16mm 14mm; }
body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a2420; font-size: 10.5pt; line-height: 1.45; }
h1 { font-size: 19pt; margin: 0 0 10pt; color: #0b3b2b; }
h2 { font-size: 13pt; margin: 18pt 0 6pt; color: #0b3b2b; border-bottom: 1.5pt solid #34d399; padding-bottom: 3pt; }
h3 { font-size: 11pt; margin: 12pt 0 4pt; }
p, ul { margin: 0 0 6pt; } li { margin-bottom: 2pt; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 8pt; font-size: 9.5pt; }
th { text-align: left; background: #eef6f2; font-weight: 700; }
th, td { padding: 4pt 6pt; border-bottom: .6pt solid #d5e2dc; vertical-align: top; }
tr { break-inside: avoid; }
code { font-family: Menlo, monospace; font-size: 8.5pt; color: #4b5d55; }
.ok { color: #059669; font-weight: 700; }
.novo { font-size: 8pt; font-weight: 700; color: #92400e; background: #fef3c7; padding: 0 4pt; border-radius: 3pt; }
</style></head><body>
${paraHtml(md)}
</body></html>`;
fs.writeFileSync(path.join(__dirname, 'plano-instagram.html'), html);

(async () => {
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage();
  await p.goto('file://' + path.join(__dirname, 'plano-instagram.html'));
  const saida = path.join(__dirname, 'plano-instagram.pdf');
  await p.pdf({ path: saida, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close();
  console.log('gerado:', saida);
})();
