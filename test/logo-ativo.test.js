'use strict';

/**
 * Logo do ativo: proxy no servidor + monograma no cliente.
 *
 * POR QUE PROXY. Um `<img src="https://cdn-de-terceiro/PETR4.png">` sai do
 * navegador do usuário com IP e Referer. Quem serve o arquivo passa a saber,
 * a cada abertura do app, exatamente quais ativos aquela pessoa tem — a
 * carteira inteira, entregue de graça, num app de finanças. Servindo pelo
 * nosso domínio o terceiro só vê o nosso servidor.
 *
 * O QUE ESTE ARQUIVO CERCA. Um proxy de imagem é, por construção, um pedido
 * de "busque esta URL para mim". As travas são sobre quem escolhe a URL
 * (nós, do nosso cache — nunca o cliente), para onde ela pode apontar
 * (allowlist), e o que aceitamos de volta (tipo e tamanho). E o degrade:
 * ativo sem logo é o caso COMUM, não o excepcional.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const M = require('../scripts/lib/mock-billing');
M.setup();
const { store, call } = M;
const ROOT = path.resolve(__dirname, '..');
const market = require(path.join(ROOT, 'api/market.js'));
const { handleLogo, LOGO_HOSTS, LOGO_TIPOS, LOGO_MAX_BYTES } = market.__test;

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

/** Chama o proxy como o dispatcher chamaria, com um `fetch` de mentira. */
async function pedirLogo(ticker, respostaDoCdn) {
  const fetchOriginal = globalThis.fetch;
  const pedidos = [];
  globalThis.fetch = async (url) => {
    pedidos.push(String(url));
    if (typeof respostaDoCdn === 'function') return respostaDoCdn(String(url));
    if (respostaDoCdn instanceof Error) throw respostaDoCdn;
    return respostaDoCdn;
  };
  try {
    const r = await call((req, res) => handleLogo(req, res), {
      method: 'GET',
      query: { ticker },
      headers: {},
    });
    return { ...r, pedidos };
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

function respostaImagem(tipo, corpo) {
  return {
    ok: true,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? tipo : null) },
    arrayBuffer: async () => corpo,
  };
}

function cachear(ticker, logoUrl) {
  store.docs.set('marketQuotes/' + ticker, { ticker, price: 10, logoUrl });
}

test.beforeEach(() => store.docs.clear());

// --------------------------------------------------------------- caminho bom

test('serve a imagem com o tipo do CDN e cache longo', async () => {
  cachear('PETR4', 'https://cdn.brapi.dev/PETR4.png');
  const r = await pedirLogo('PETR4', respostaImagem('image/png', PNG));

  assert.equal(r.status, 200);
  assert.ok(Buffer.isBuffer(r.body) && r.body.equals(PNG), 'os bytes têm de chegar inteiros');
  assert.equal(r.headers['Content-Type'], 'image/png');
  assert.match(r.headers['Cache-Control'], /max-age=86400/, 'logo não muda: cache longo');
  assert.match(r.headers['Cache-Control'], /s-maxage=\d{5,}/, 'a borda evita uma função por linha');
  assert.equal(
    r.headers['X-Content-Type-Options'],
    'nosniff',
    'servimos byte de terceiro: o navegador não pode adivinhar o tipo'
  );
});

test('o content-type do CDN é respeitado, não fixado em png', async () => {
  cachear('VALE3', 'https://cdn.brapi.dev/VALE3.svg');
  const r = await pedirLogo('VALE3', respostaImagem('image/svg+xml; charset=utf-8', PNG));
  assert.equal(r.status, 200);
  assert.equal(r.headers['Content-Type'], 'image/svg+xml', 'o charset não entra no cabeçalho');
});

// ------------------------------------------------------- não virar proxy aberto

test('a URL vem do nosso cache — o cliente não escolhe o destino', async () => {
  // A trava principal. Se o ticker (ou qualquer parâmetro) pudesse virar URL,
  // isto seria um SSRF: alguém pediria http://169.254.169.254/... pelo nosso
  // servidor, com as nossas credenciais de rede.
  const fonte = fs.readFileSync(path.join(ROOT, 'api/market.js'), 'utf8');
  const corpo = fonte.slice(fonte.indexOf('async function handleLogo'));
  const fim = corpo.indexOf('\nfunction semLogo');
  const recorte = corpo.slice(0, fim);
  assert.ok(
    /collection\(CACHE_COLLECTION\)/.test(recorte),
    'a URL tem de ser lida do cache marketQuotes'
  );
  assert.ok(
    !/new URL\((?!logoUrl)/.test(recorte),
    'nenhuma URL pode ser montada a partir de dado do request'
  );
});

test('host fora da allowlist não é buscado', async () => {
  cachear('PETR4', 'https://cdn-invasor.example.com/PETR4.png');
  const r = await pedirLogo('PETR4', respostaImagem('image/png', PNG));
  assert.equal(r.status, 204);
  assert.deepEqual(r.pedidos, [], 'nem chegou a sair requisição');
});

test('endereço interno é recusado mesmo se entrar no cache', async () => {
  // Cenário de defesa em profundidade: a resposta de terceiro é que preenche
  // esse campo. Se um dia ela vier envenenada, a allowlist é quem segura.
  for (const url of [
    'http://169.254.169.254/latest/meta-data/',
    'https://169.254.169.254/token',
    'https://localhost/admin',
    'http://cdn.brapi.dev/PETR4.png',
    'file:///etc/passwd',
    'https://cdn.brapi.dev.invasor.com/x.png',
  ]) {
    store.docs.clear();
    cachear('PETR4', url);
    const r = await pedirLogo('PETR4', respostaImagem('image/png', PNG));
    assert.equal(r.status, 204, 'aceitou ' + url);
    assert.deepEqual(r.pedidos, [], 'buscou ' + url);
  }
});

test('a allowlist só tem host de CDN de logo', async () => {
  for (const host of LOGO_HOSTS) {
    assert.match(host, /^[a-z0-9.-]+$/, 'host suspeito na allowlist: ' + host);
    assert.ok(!host.includes('*'), 'curinga na allowlist abre subdomínio de terceiro');
  }
});

test('só tipo de imagem passa', async () => {
  for (const tipo of ['text/html', 'application/json', 'application/pdf', '']) {
    store.docs.clear();
    cachear('PETR4', 'https://cdn.brapi.dev/PETR4.png');
    const r = await pedirLogo('PETR4', respostaImagem(tipo, PNG));
    assert.equal(r.status, 204, 'passou content-type "' + tipo + '"');
  }
  for (const tipo of LOGO_TIPOS) assert.match(tipo, /^image\//);
});

test('resposta grande demais é descartada', async () => {
  cachear('PETR4', 'https://cdn.brapi.dev/PETR4.png');
  const gigante = Buffer.alloc(LOGO_MAX_BYTES + 1, 1);
  const r = await pedirLogo('PETR4', respostaImagem('image/png', gigante));
  assert.equal(r.status, 204, 'sem teto, um arquivo de 50MB estoura a função');
});

// ------------------------------------------------------------- degrade normal

test('ativo sem logo responde 204 com cache, não 404', async () => {
  // FII, Tesouro, cripto e ticker recém-listado normalmente NÃO têm logo.
  // Sendo o caso comum, não pode custar uma função por render de lista nem
  // sujar o console do usuário com erro.
  cachear('BTLG11', null);
  const r = await pedirLogo('BTLG11', respostaImagem('image/png', PNG));
  assert.equal(r.status, 204);
  assert.deepEqual(r.pedidos, [], 'sem URL não há o que buscar');
  assert.match(r.headers['Cache-Control'], /max-age=\d+/, 'o "não tem" também tem de ser cacheado');
});

test('ticker sem cotação em cache não dispara busca', async () => {
  const r = await pedirLogo('XPTO3', respostaImagem('image/png', PNG));
  assert.equal(r.status, 204);
  assert.deepEqual(r.pedidos, []);
});

test('CDN fora do ar não vira erro na tela', async () => {
  cachear('PETR4', 'https://cdn.brapi.dev/PETR4.png');
  for (const falha of [
    new Error('ECONNRESET'),
    { ok: false, status: 500, headers: { get: () => null }, arrayBuffer: async () => PNG },
  ]) {
    const r = await pedirLogo('PETR4', falha);
    assert.equal(r.status, 204, 'a lista continua desenhando com monograma');
  }
});

test('ticker inválido é recusado antes de qualquer leitura', async () => {
  for (const lixo of ['', 'AB', 'A'.repeat(40), undefined, '!!!!']) {
    const r = await pedirLogo(lixo, respostaImagem('image/png', PNG));
    assert.equal(r.status, 400, 'aceitou "' + lixo + '"');
  }
});

test('o ticker nunca vira caminho de documento', async () => {
  // `../../etc/passwd` não dá 400: o sanitizador corta tudo que não é letra
  // ou dígito e sobra ETCPASSWD, um ticker de forma válida. É o desfecho
  // certo — o que não pode acontecer é a barra sobreviver e o `.doc()`
  // receber um caminho em vez de um id.
  const lidos = [];
  const colOriginal = store.docs.get;
  cachear('ETCPASSWD', 'https://cdn.brapi.dev/x.png');
  store.docs.get = function (k) {
    lidos.push(k);
    return colOriginal.call(this, k);
  };
  try {
    const r = await pedirLogo('../../etc/passwd', respostaImagem('image/png', PNG));
    assert.equal(r.status, 200, 'sanitizou para um ticker comum e seguiu o caminho normal');
    for (const k of lidos) {
      assert.ok(
        !k.includes('..') && k.split('/').length === 2,
        'caminho montado com dado do request: ' + k
      );
    }
  } finally {
    store.docs.get = colOriginal;
  }
});

// ------------------------------------------------- a URL não chega ao cliente

test('op=quote não devolve a URL do CDN', async () => {
  // Se ela sair na resposta, mais cedo ou mais tarde alguém a usa direto num
  // <img src> — e aí o proxy inteiro deixa de servir para o que existe.
  const fonte = fs.readFileSync(path.join(ROOT, 'api/market.js'), 'utf8');
  assert.match(
    fonte,
    /delete quotes\[t\]\.logoUrl;/,
    'a resposta de cotação tem de limpar logoUrl'
  );

  const web = fs.readFileSync(path.join(ROOT, 'web/appliquei-utils.js'), 'utf8');
  assert.ok(!/logourl|logoUrl/i.test(web), 'o cliente não pode conhecer a URL de terceiro');
});

test('o cliente pede a imagem só ao nosso domínio', () => {
  const web = fs.readFileSync(path.join(ROOT, 'web/appliquei-utils.js'), 'utf8');
  const srcs = Array.from(web.matchAll(/src="([^"]*)/g), (m) => m[1]);
  for (const s of srcs) assert.ok(s.startsWith('/api/'), 'src externo no helper: ' + s);
  assert.match(
    web,
    /\/api\/logo\/'\s*\+\s*\n?\s*encodeURIComponent\(tk\)/,
    'o ticker tem de ir codificado na URL'
  );
});
