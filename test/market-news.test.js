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
const { parseRssItems, decodeXmlText } = market.__test || {};

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

test('parseRssItems respeita o teto de itens', () => {
  const um = (i) => `<item><title>N ${i}</title><link>https://ex.com/${i}/</link></item>`;
  const muitos =
    '<rss><channel>' + Array.from({ length: 200 }, (_, i) => um(i)).join('') + '</channel></rss>';
  const itens = parseRssItems(muitos);
  assert.ok(itens.length <= 60, 'teto estourou: ' + itens.length);
  assert.equal(itens[0].title, 'N 0');
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
