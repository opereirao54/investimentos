'use strict';

// IA de reserva (Gemini). Rede falsa: prova o que vai no pedido (só o texto,
// nada do usuário), como a resposta é limpa, e que toda falha vira null.

const test = require('node:test');
const assert = require('node:assert/strict');
const ia = require('../api/_lib/telegram-ia');

function respostaGemini(texto, status = 200) {
  return {
    ok: status === 200,
    status,
    json: async () => ({ candidates: [{ content: { parts: [{ text: texto }] } }] }),
  };
}

let pedidos;
test.beforeEach(() => {
  pedidos = [];
  process.env.GEMINI_API_KEY = 'chave-teste';
  delete process.env.GEMINI_MODEL;
});
test.after(() => {
  delete process.env.GEMINI_API_KEY;
});

test('sem GEMINI_API_KEY não chama a rede', async () => {
  delete process.env.GEMINI_API_KEY;
  global.fetch = async () => {
    throw new Error('não deveria chamar');
  };
  assert.equal(await ia.reescrever('mercado cinquenta'), null);
});

test('reescrever manda só o texto, com a chave no header, e limpa a resposta', async () => {
  global.fetch = async (url, opts) => {
    pedidos.push({ url, opts });
    return respostaGemini('"mercado 50 ontem"\nexplicação que deve sumir');
  };
  const r = await ia.reescrever('gastei uns cinquenta conto no mercado ontem');
  assert.equal(r, 'mercado 50 ontem');
  assert.match(pedidos[0].url, /models\/gemini-flash-lite-latest:generateContent$/);
  assert.equal(pedidos[0].opts.headers['x-goog-api-key'], 'chave-teste');
  assert.ok(!pedidos[0].url.includes('chave-teste'), 'chave não vai na URL (fica fora de logs)');
  assert.match(JSON.parse(pedidos[0].opts.body).contents[0].parts[0].text, /cinquenta conto/);
});

test('modelo configurável por GEMINI_MODEL', async () => {
  process.env.GEMINI_MODEL = 'gemini-x';
  global.fetch = async (url) => {
    pedidos.push(url);
    return respostaGemini('NADA');
  };
  assert.equal(await ia.reescrever('oi'), null, 'NADA vira null');
  assert.match(pedidos[0], /models\/gemini-x:/);
});

test('cota estourada, erro de rede e resposta vazia viram null', async () => {
  global.fetch = async () => respostaGemini('', 429);
  assert.equal(await ia.reescrever('x'), null);
  global.fetch = async () => {
    throw new Error('rede');
  };
  assert.equal(await ia.reescrever('x'), null);
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  assert.equal(await ia.reescrever('x'), null);
});

test('categorizar devolve só o slug', async () => {
  global.fetch = async (url, opts) => {
    pedidos.push(JSON.parse(opts.body).contents[0].parts[0].text);
    return respostaGemini(' Lazer \n');
  };
  const cats = [
    { v: 'alimentacao', label: '🛒 Alimentação' },
    { v: 'lazer', label: '🍿 Lazer e Assinaturas' },
  ];
  assert.equal(await ia.categorizar('Presente', cats), 'lazer');
  assert.match(pedidos[0], /lazer = Lazer e Assinaturas/);
});
