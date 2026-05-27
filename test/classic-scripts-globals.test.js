'use strict';

// Guard contra a regressão que travou o preview do PR #54:
//
// Top-level `let`/`const` em <script> clássico são SCRIPT-SCOPED — NÃO viram
// propriedades de `window` como `var` faz. Quando o monolítico inline foi
// quebrado em 17 classic scripts, declarações como `let historicoCompras` em
// app.js viraram invisíveis para sonhos.js, aba1-charts.js, etc. que as
// consumiam como se fossem globais — ReferenceError silencioso em runtime.
//
// Estes testes garantem que classic scripts só usam `var` no top-level
// (que vira window.X). Módulos ES (cloud-sync, billing, etc.) ficam fora —
// escopo de módulo os isola e não há cross-refs.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

// Mantida em sincronia com a lista classic-script no eslint.config.js.
// appliquei-app.js tem indent 8 (extraído inline com indentação preservada
// para diff mínimo); os demais foram dedentados para 0.
const CLASSIC_SCRIPTS = [
  { file: 'web/appliquei-utils.js', indent: '' },
  { file: 'web/appliquei-yahoo-finance.js', indent: '' },
  { file: 'web/appliquei-app.js', indent: '        ' },
  { file: 'web/appliquei-aba1-charts.js', indent: '' },
  { file: 'web/appliquei-renda-fixa.js', indent: '' },
  { file: 'web/appliquei-previdencia.js', indent: '' },
  { file: 'web/appliquei-aba-simulador.js', indent: '' },
  { file: 'web/appliquei-aba-carteira-recomendada.js', indent: '' },
  { file: 'web/appliquei-aba-info-mercado.js', indent: '' },
  { file: 'web/appliquei-aba-dividendos.js', indent: '' },
  { file: 'web/appliquei-aba-controle-financeiro.js', indent: '' },
  { file: 'web/appliquei-relatorio-mensal.js', indent: '' },
  { file: 'web/appliquei-applicash.js', indent: '' },
  { file: 'web/appliquei-duvidas.js', indent: '' },
  { file: 'web/appliquei-patrimonio.js', indent: '' },
  { file: 'web/appliquei-jornada.js', indent: '' },
  { file: 'web/appliquei-sonhos.js', indent: '' },
  { file: 'web/appliquei-admin.js', indent: '' },
];

for (const { file, indent } of CLASSIC_SCRIPTS) {
  test(`${file}: zero let/const top-level (devem ser var p/ leak em window)`, () => {
    const abs = path.join(ROOT, file);
    assert.ok(fs.existsSync(abs), `arquivo não encontrado: ${file}`);
    const src = fs.readFileSync(abs, 'utf8');
    const re = new RegExp(`^${indent}(let|const)\\s+[a-zA-Z_$]`);
    const offenders = [];
    src.split('\n').forEach((line, i) => {
      if (re.test(line)) offenders.push(`  L${i + 1}: ${line.trim()}`);
    });
    assert.equal(
      offenders.length,
      0,
      `Top-level let/const em classic script (${file}):\n${offenders.join('\n')}\n\n` +
        `Classic scripts compartilham estado via window. Top-level let/const são ` +
        `script-scoped (invisíveis a outros scripts). Use \`var\` para que a ` +
        `declaração vire propriedade de window e seja visível cross-file.`
    );
  });
}

// Sanity: os arquivos referenciados no HTML estão na nossa lista.
// Pega novos classic scripts adicionados sem atualizar este teste.
test('lista CLASSIC_SCRIPTS cobre os <script src="/web/*"> dos HTMLs', () => {
  const htmlFiles = ['Appliquei_v13.0.html', 'admin.html'];
  const referenced = new Set();
  for (const h of htmlFiles) {
    const src = fs.readFileSync(path.join(ROOT, h), 'utf8');
    const re = /<script\s+src="\/web\/([a-z0-9-]+\.js)/g;
    let m;
    while ((m = re.exec(src))) referenced.add('web/' + m[1]);
  }
  const covered = new Set(CLASSIC_SCRIPTS.map((c) => c.file));
  const missing = [...referenced].filter((r) => !covered.has(r));
  assert.equal(
    missing.length,
    0,
    `Classic scripts referenciados em HTML mas fora da lista:\n  ${missing.join('\n  ')}\n` +
      `Adicione em test/classic-scripts-globals.test.js para evitar regressões.`
  );
});
