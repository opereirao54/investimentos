'use strict';

// Cobre o helper reportSwallowed (Onda P4): a rede de proteção que reporta
// ao Sentry os erros que antes eram engolidos em silêncio em catch vazios.
//
// billing.js é um ES module com efeitos colaterais de parse (listeners,
// Firebase) — rodá-lo inteiro num sandbox exigiria stubbar meio app e seria
// frágil. Em vez disso, extraímos o BLOCO REAL da função `reportSwallowed`
// da fonte e o executamos num contexto vm isolado. Assim testamos o código
// exatamente como é enviado, sem replicá-lo no teste (que mascararia bugs).

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'web', 'appliquei-billing.js'), 'utf8');

// Extrai `function reportSwallowed(...) { ... }` por brace-matching a partir
// da declaração. Se a função for renomeada/removida, a extração falha e o
// teste denuncia — garantindo que estamos sempre exercitando a fonte viva.
function extractFn(src, name) {
  const start = src.indexOf('function ' + name);
  assert.notEqual(start, -1, `função ${name} não encontrada em appliquei-billing.js`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`não consegui fechar as chaves de ${name}`);
}

const FN_SRC = extractFn(SRC, 'reportSwallowed');

// Monta um contexto vm com console/window controláveis e instala a função
// real dentro dele. Erros criados via `mk()` nascem no MESMO realm do
// contexto, então `err instanceof Error` dentro de reportSwallowed funciona.
function makeCtx({ sentry, withConsoleDebug = true } = {}) {
  const calls = { capture: [], debug: [] };
  const sandbox = {
    window: { AppliqueiSentry: sentry },
    console: withConsoleDebug ? { debug: (...a) => calls.debug.push(a) } : {},
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(FN_SRC, ctx, { filename: 'reportSwallowed.extracted.js' });
  // Helper de fábrica de Error no realm do contexto.
  vm.runInContext('function __mk(m){return new Error(m);}', ctx);
  return {
    calls,
    sandbox,
    // Dispara reportSwallowed com um Error nativo do contexto.
    fireError: (msg, where) =>
      vm.runInContext(
        `reportSwallowed(__mk(${JSON.stringify(msg)}), ${JSON.stringify(where)})`,
        ctx
      ),
    // Dispara com um valor não-Error (string).
    fireRaw: (raw, where) =>
      vm.runInContext(`reportSwallowed(${JSON.stringify(raw)}, ${JSON.stringify(where)})`, ctx),
  };
}

// Cross-realm: instanceof não atravessa realms, então identificamos Error
// pelo tag interno em vez de `instanceof`.
const isError = (v) => Object.prototype.toString.call(v) === '[object Error]';

test('Sentry presente: captura o erro com level e tags corretos', () => {
  const captured = [];
  const { fireError } = makeCtx({
    sentry: { captureException: (err, cfg) => captured.push({ err, cfg }) },
  });

  fireError('boom', 'reloadAccountStatus.refresh');

  assert.equal(captured.length, 1, 'captureException deve ser chamado uma vez');
  const { err, cfg } = captured[0];
  assert.ok(isError(err), 'primeiro argumento deve ser um Error');
  assert.equal(err.message, 'boom');
  assert.equal(cfg.level, 'warning');
  // cfg.tags nasce no realm do vm; comparar campo a campo evita o mismatch
  // de prototype cross-realm do deepEqual strict.
  assert.equal(cfg.tags.swallowed, 'billing');
  assert.equal(cfg.tags.where, 'reloadAccountStatus.refresh');
});

test('valor não-Error é embrulhado em Error com a mensagem original', () => {
  const captured = [];
  const { fireRaw } = makeCtx({
    sentry: { captureException: (err) => captured.push(err) },
  });

  fireRaw('falha-texto', 'syncApplicashFromServer');

  assert.equal(captured.length, 1);
  assert.ok(isError(captured[0]), 'string crua deve virar Error');
  assert.equal(captured[0].message, 'falha-texto');
});

test('sem Sentry: cai no fallback console.debug com o ponto de captura', () => {
  const { calls, fireError } = makeCtx({ sentry: null });

  fireError('offline', 'waitForActive.syncApplicash');

  assert.equal(calls.debug.length, 1, 'deve logar via console.debug');
  assert.match(calls.debug[0][0], /@waitForActive\.syncApplicash/);
});

test('Sentry sem captureException: não chama nada nem lança', () => {
  const { calls, fireError } = makeCtx({ sentry: {} });
  assert.doesNotThrow(() => fireError('x', 'openMyAccount.applyAccess'));
  // Sentry existe mas sem captureException → cai no fallback console.debug.
  assert.equal(calls.debug.length, 1);
});

test('reporte nunca quebra o fluxo: captureException que lança é contido', () => {
  const { fireError } = makeCtx({
    sentry: {
      captureException: () => {
        throw new Error('sentry indisponível');
      },
    },
  });
  // O catch interno de reportSwallowed deve engolir a falha do próprio reporte.
  assert.doesNotThrow(() => fireError('boom', 'myAccountReload.fetchMe'));
});
