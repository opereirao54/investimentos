'use strict';

// Guard contra o bug que travou o app em "A preparar autenticação…":
// o minifier do esbuild gerava `Identifier 'w' has already been declared`
// no chunk module porque o conteúdo de cloud-sync.js e billing.js estava
// envolto em `{ ... }` (block leftover do IIFE). Sem este bloco extra, os
// nomes de função module-scope não colidem com o single-letter renaming.
//
// Este teste roda `vite build` e tenta parsear o chunk JS resultante. Se
// o build gerar SyntaxError, o teste falha imediatamente.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

test('vite build gera chunk module que parseia sem SyntaxError', () => {
  // Build is idempotent; tolera múltiplas runs em paralelo no CI.
  execFileSync('npx', ['vite', 'build'], {
    cwd: ROOT,
    stdio: 'pipe',
  });

  const html = fs.readFileSync(path.join(ROOT, 'dist', 'Appliquei_v13.0.html'), 'utf8');
  const match = html.match(/src="\/assets\/(Appliquei_v13\.0-[A-Za-z0-9_-]+\.js)"/);
  assert.ok(match, 'chunk module reference não encontrada no HTML built');

  const chunkPath = path.join(ROOT, 'dist', 'assets', match[1]);
  const code = fs.readFileSync(chunkPath, 'utf8');

  // new vm.Script(code) faz parse-only sem executar — pega SyntaxError
  // sem precisar dos globals (firebase, window, etc.) que o bundle usa
  // em runtime.
  assert.doesNotThrow(
    () => new vm.Script(code, { filename: match[1] }),
    'chunk JS bundlado contém SyntaxError — esbuild renomeou identificadores em conflito.\n' +
      'Provável causa: bloco { ... } extra no topo de algum ES module (cloud-sync, billing).\n' +
      'Fix: remover o bloco; o escopo do módulo já isola os `var`.'
  );
});
