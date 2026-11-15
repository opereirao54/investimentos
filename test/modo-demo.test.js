'use strict';

// Modo demonstração — as garantias que não dependem de navegador.
//
// O spec e2e/modo-demo.spec.js prova o comportamento de ponta a ponta; aqui
// ficam as travas de ORDEM e de presença, que um HTML editado às pressas
// quebraria em silêncio:
//   1. appliquei-demo.js é o PRIMEIRO <script> da página — qualquer script
//      antes dele poderia ler o armazenamento real;
//   2. a semeadura vem depois do utils e antes do app.js;
//   3. Firebase, sync, cobrança e login têm cada um a sua saída para o demo;
//   4. o /demo é uma rota.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = ler('Appliquei_v13.0.html');

test('appliquei-demo.js é o primeiro script da página', () => {
  const primeiro = HTML.match(/<script\b[^>]*>/i)[0];
  assert.match(primeiro, /src="\/web\/appliquei-demo\.js/);
});

test('a semeadura vem depois do utils e antes do app.js', () => {
  const utils = HTML.indexOf('/web/appliquei-utils.js');
  const semear = HTML.indexOf('appliqueiDemoSemear();');
  const app = HTML.indexOf('/web/appliquei-app.js');
  assert.ok(utils > 0 && semear > utils && app > semear, { utils, semear, app });
});

test('Firebase, sync, cobrança e login respeitam o modo demonstração', () => {
  for (const f of [
    'web/appliquei-firebase-init.js',
    'web/appliquei-cloud-sync.js',
    'web/appliquei-billing.js',
    'web/appliquei-auth-gate.js',
  ]) {
    assert.match(ler(f), /__APPLIQUEI_DEMO__/, f + ' sem a saída do modo demonstração');
  }
});

test('/demo é rota e cai no app', () => {
  const v = JSON.parse(ler('vercel.json'));
  const r = v.rewrites.find((x) => x.source === '/demo');
  assert.ok(r, 'falta o rewrite /demo');
  assert.equal(r.destination, '/Appliquei_v13.0.html');
});
