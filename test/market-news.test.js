'use strict';

// /api/market?op=news — fonte própria do feed da aba Info Mercado.
//
// Existe porque a aba caiu em produção quando o rss2json recusou o request:
// serviço gratuito de terceiro, com cota por IP, era o único caminho até o
// feed. Aqui o RSS é buscado do nosso servidor e devolvido no MESMO formato
// do rss2json, para o cliente tratar as duas fontes igual.
//
// O parse é por regex (o feed é WordPress, formato estável, e um parser XML
// seria dependência nova só para isto) — então é justamente ele que precisa
// de teste: CDATA, entidades aninhadas, <category> repetido e item quebrado.

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const market = require(path.resolve(__dirname, '..', 'api', 'market.js'));

// O módulo exporta o handler; as funções de parse são internas. Reexecutar o
// arquivo num contexto próprio daria acesso, mas o valor está no contrato
// público: por isso exercitamos o parser através de um feed real montado à
// mão e do dispatcher.
const { parseRssItems, decodeXmlText, newsKey, NEWS_FEEDS, NEWS_MAX_PER_FEED } =
  market.__test || {};

test('o módulo expõe o parser para teste', () => {
  assert.equal(typeof parseRssItems, 'function', 'parseRssItems não exportado em __test');
  assert.equal(typeof decodeXmlText, 'function');
});

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>InfoMoney</title>
  <item>
    <title><![CDATA[Copom mantém a Selic &amp; sinaliza cautela]]></title>
    <link>https://www.infomoney.com.br/economia/copom-selic/</link>
    <pubDate>Fri, 21 Aug 2026 14:10:00 +0000</pubDate>
    <description><![CDATA[<p>O <b>Comitê</b> decidiu por unanimidade.</p>]]></description>
    <category><![CDATA[Economia]]></category>
    <category><![CDATA[Brasil]]></category>
  </item>
  <item>
    <title>Bitcoin passa de US$ 120 mil</title>
    <link>https://www.infomoney.com.br/criptomoedas/btc/</link>
    <pubDate>Fri, 21 Aug 2026 11:05:00 +0000</pubDate>
    <description>Fluxo institucional puxou a alta &lt;b&gt;forte&lt;/b&gt;</description>
    <category>Criptomoedas</category>
    <content:encoded><![CDATA[<p>Texto longo do post inteiro.</p>]]></content:encoded>
  </item>
  <item>
    <title>Item sem link nenhum</title>
    <pubDate>Fri, 21 Aug 2026 10:00:00 +0000</pubDate>
  </item>
</channel></rss>`;

test('parseRssItems lê os itens válidos e descarta o quebrado', () => {
  const itens = parseRssItems(FEED);
  assert.equal(itens.length, 2, 'item sem link tinha que ser descartado');
  assert.equal(itens[0].link, 'https://www.infomoney.com.br/economia/copom-selic/');
  assert.equal(itens[1].title, 'Bitcoin passa de US$ 120 mil');
});

test('CDATA é desembrulhado e as entidades viram texto', () => {
  const itens = parseRssItems(FEED);
  assert.equal(itens[0].title, 'Copom mantém a Selic & sinaliza cautela');
  assert.ok(itens[0].description.includes('<b>Comitê</b>'), itens[0].description);
  assert.ok(itens[1].description.includes('<b>forte</b>'), itens[1].description);
});

test('&amp; é resolvido por último — "&amp;lt;" não pode virar "<"', () => {
  // Se &amp; fosse trocado primeiro, isto viraria uma tag de verdade e o
  // texto do feed passaria a injetar markup no resumo do card.
  assert.equal(decodeXmlText('a &amp;lt;script&amp;gt; b'), 'a &lt;script&gt; b');
  assert.equal(decodeXmlText('5 &lt; 10 &amp;&amp; 10 &gt; 5'), '5 < 10 && 10 > 5');
});

test('entidade numérica vira caractere, e a inválida some sem quebrar', () => {
  assert.equal(decodeXmlText('caf&#233; &#39;forte&#39;'), "café 'forte'");
  assert.equal(decodeXmlText('lixo &#0; fim'), 'lixo  fim');
});

test('<category> repetido vira lista — é o sinal mais forte da classificação', () => {
  const itens = parseRssItems(FEED);
  assert.deepEqual(itens[0].categories, ['Economia', 'Brasil']);
  assert.deepEqual(itens[1].categories, ['Criptomoedas']);
});

test('description ganha de content:encoded (o card só mostra 160 caracteres)', () => {
  const itens = parseRssItems(FEED);
  assert.ok(!itens[1].description.includes('Texto longo do post inteiro'), itens[1].description);
});

test('feed vazio ou lixo devolve lista vazia em vez de lançar', () => {
  assert.deepEqual(parseRssItems(''), []);
  assert.deepEqual(parseRssItems('<html><body>página de erro</body></html>'), []);
  assert.deepEqual(parseRssItems('<rss><channel><item></item></channel></rss>'), []);
});

const feedCom = (n) =>
  '<rss><channel>' +
  Array.from(
    { length: n },
    (_, i) => `<item><title>N ${i}</title><link>https://ex.com/${i}/</link></item>`
  ).join('') +
  '</channel></rss>';

test('parseRssItems respeita o limite pedido', () => {
  const itens = parseRssItems(feedCom(200), NEWS_MAX_PER_FEED);
  assert.equal(itens.length, NEWS_MAX_PER_FEED, 'teto por feed estourou');
  assert.equal(itens[0].title, 'N 0', 'tem que manter as primeiras do feed');
});

test('sem limite explícito, cai no teto global', () => {
  assert.ok(parseRssItems(feedCom(500)).length <= market.__test.NEWS_MAX_ITEMS);
});

// ---- juntar as editorias ----------------------------------------------
//
// O feed principal traz só as últimas horas, então categorias inteiras
// ficavam zeradas na tela por não ter saído matéria do assunto — e não por
// falta de notícia. As editorias do MESMO site resolvem isso; o preço é ter
// de deduplicar (a mesma matéria sai nos dois) e sobreviver a uma editoria
// fora do ar.

test('a lista de feeds é do InfoMoney e não aceita nada de fora', () => {
  assert.ok(NEWS_FEEDS.length > 1, 'só o feed principal não resolve o zerado');
  for (const url of NEWS_FEEDS) {
    assert.match(url, /^https:\/\/www\.infomoney\.com\.br\//, 'feed fora do domínio: ' + url);
    assert.match(url, /\/feed\/$/, url);
  }
  assert.equal(new Set(NEWS_FEEDS).size, NEWS_FEEDS.length, 'feed repetido na lista');
});

test('newsKey iguala a mesma matéria vinda de feeds diferentes', () => {
  const base = 'https://www.infomoney.com.br/economia/copom/';
  assert.equal(newsKey(base), newsKey(base + '?utm_source=feed'));
  assert.equal(newsKey(base), newsKey('https://www.infomoney.com.br/economia/copom'));
  assert.equal(newsKey(base), newsKey(base.toUpperCase()));
  assert.notEqual(newsKey(base), newsKey('https://www.infomoney.com.br/economia/selic/'));
  assert.equal(newsKey(''), '');
  assert.equal(newsKey(null), '');
});

test('a saída tem a forma que a aba já consome (mesma do rss2json)', () => {
  const itens = parseRssItems(FEED);
  assert.deepEqual(Object.keys(itens[0]).sort(), [
    'categories',
    'description',
    'link',
    'pubDate',
    'title',
  ]);
});

// ---- fetchAllFeeds: as editorias viram um acervo só -------------------

const { fetchAllFeeds, NEWS_MAX_ITEMS } = market.__test;

function itemXml(titulo, link, data) {
  return `<item><title>${titulo}</title><link>${link}</link><pubDate>${data}</pubDate></item>`;
}
function feedXml(itens) {
  return '<rss><channel>' + itens.join('') + '</channel></rss>';
}
function respostaXml(xml) {
  return { ok: true, text: async () => xml };
}

/** Troca o fetch global por um roteador por URL e devolve o restaurador. */
function comFetch(rotas) {
  const original = global.fetch;
  const pedidas = [];
  global.fetch = async (url) => {
    pedidas.push(String(url));
    for (const [trecho, resp] of rotas) {
      if (String(url).includes(trecho)) return resp();
    }
    throw new Error('ECONNREFUSED');
  };
  return { pedidas, restaurar: () => (global.fetch = original) };
}

const DIA = (d) => `Fri, ${d} Aug 2026 12:00:00 +0000`;

test('busca todas as editorias da lista, em paralelo', async (t) => {
  const f = comFetch([
    ['infomoney', () => respostaXml(feedXml([itemXml('N', 'https://ex.com/a/', DIA(21))]))],
  ]);
  t.after(f.restaurar);
  await fetchAllFeeds();
  assert.equal(f.pedidas.length, NEWS_FEEDS.length, 'nem todas as editorias foram pedidas');
  for (const url of NEWS_FEEDS) assert.ok(f.pedidas.includes(url), 'faltou ' + url);
});

test('a mesma matéria em duas editorias entra uma vez só', async (t) => {
  // O feed principal repete o que sai nas editorias — sem dedupe, a aba
  // mostraria a mesma manchete várias vezes.
  const mesma = itemXml(
    'Copom mantém a Selic',
    'https://www.infomoney.com.br/economia/copom/',
    DIA(21)
  );
  const f = comFetch([
    ['/economia/feed/', () => respostaXml(feedXml([mesma]))],
    // No principal a mesma URL vem com utm — continua sendo a mesma matéria.
    [
      '.com.br/feed/',
      () =>
        respostaXml(
          feedXml([
            itemXml(
              'Copom mantém a Selic',
              'https://www.infomoney.com.br/economia/copom/?utm=rss',
              DIA(21)
            ),
          ])
        ),
    ],
    ['infomoney', () => respostaXml(feedXml([]))],
  ]);
  t.after(f.restaurar);
  const { items } = await fetchAllFeeds();
  assert.equal(items.length, 1, 'matéria duplicada entre feeds: ' + items.length);
});

test('editoria fora do ar não derruba as outras', async (t) => {
  const f = comFetch([
    ['/politica/feed/', () => ({ ok: false, status: 404, text: async () => '' })],
    ['/mercados/feed/', () => Promise.reject(new Error('timeout'))],
    ['infomoney', () => respostaXml(feedXml([itemXml('Viva', 'https://ex.com/viva/', DIA(21))]))],
  ]);
  t.after(f.restaurar);
  const { items, failed } = await fetchAllFeeds();
  assert.ok(items.length >= 1, 'as editorias boas tinham que passar');
  assert.equal(failed.length, 2, 'as falhas precisam ser reportadas, não sumir');
  assert.ok(
    failed.some((x) => /politica/.test(x.feed) && /404/.test(x.error)),
    JSON.stringify(failed)
  );
});

test('todas fora do ar: lança, para o cliente cair no fallback', async (t) => {
  const f = comFetch([['infomoney', () => ({ ok: false, status: 503, text: async () => '' })]]);
  t.after(f.restaurar);
  await assert.rejects(() => fetchAllFeeds(), /feeds_sem_itens/);
});

test('acervo sai da mais recente para a mais antiga, entre editorias', async (t) => {
  const f = comFetch([
    [
      '/economia/feed/',
      () => respostaXml(feedXml([itemXml('Velha', 'https://ex.com/v/', DIA(18))])),
    ],
    [
      '/politica/feed/',
      () => respostaXml(feedXml([itemXml('Nova', 'https://ex.com/n/', DIA(21))])),
    ],
    [
      '/mercados/feed/',
      () => respostaXml(feedXml([itemXml('Media', 'https://ex.com/m/', DIA(20))])),
    ],
    ['infomoney', () => respostaXml(feedXml([]))],
  ]);
  t.after(f.restaurar);
  const { items } = await fetchAllFeeds();
  assert.deepEqual(
    items.map((i) => i.title),
    ['Nova', 'Media', 'Velha']
  );
});

test('item sem data legível vai para o fim, mas não some', async (t) => {
  const f = comFetch([
    [
      '/economia/feed/',
      () => respostaXml(feedXml([itemXml('Sem data', 'https://ex.com/s/', 'ontem')])),
    ],
    [
      '/politica/feed/',
      () => respostaXml(feedXml([itemXml('Com data', 'https://ex.com/c/', DIA(21))])),
    ],
    ['infomoney', () => respostaXml(feedXml([]))],
  ]);
  t.after(f.restaurar);
  const { items } = await fetchAllFeeds();
  assert.deepEqual(
    items.map((i) => i.title),
    ['Com data', 'Sem data']
  );
});

test('o acervo devolvido respeita o teto global', async (t) => {
  const muitos = (prefixo) =>
    feedXml(
      Array.from({ length: 40 }, (_, i) =>
        itemXml(prefixo + i, `https://ex.com/${prefixo}${i}/`, DIA(21))
      )
    );
  let n = 0;
  const f = comFetch([['infomoney', () => respostaXml(muitos('f' + n++ + '-'))]]);
  t.after(f.restaurar);
  const { items } = await fetchAllFeeds();
  assert.ok(items.length <= NEWS_MAX_ITEMS, 'teto global estourou: ' + items.length);
  // Teto por feed: 8 editorias x 20 = 160, cortado em NEWS_MAX_ITEMS.
  assert.equal(items.length, NEWS_MAX_ITEMS);
});
