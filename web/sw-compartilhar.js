/* global module */
/**
 * Appliquei — recebe a fatura COMPARTILHADA pelo Android.
 *
 * No anexo do e-mail do Nubank, "Compartilhar → Appliquei" manda o arquivo
 * para /web/compartilhar-fatura (share_target do manifest.webmanifest). Este
 * service worker guarda o arquivo numa área temporária e abre o app em
 * /app?importar=compartilhado, onde appliquei-importar-fatura-ui.js o lê e
 * abre a revisão.
 *
 * DE PROPÓSITO, ELE NÃO FAZ MAIS NADA:
 *   - escopo /web/: não controla as páginas do app (/app, /);
 *   - nenhum cache de página, script ou dado: o app nunca fica preso numa
 *     versão velha por causa dele;
 *   - qualquer requisição que não seja o POST do compartilhamento passa
 *     direto para a rede (não chama respondWith).
 */

var CACHE_COMPARTILHADO = 'appliquei-fatura-compartilhada';
var URL_COMPARTILHADO = '/web/fatura-compartilhada';
var LIMITE_BYTES = 1024 * 1024;

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

function ehCompartilhamento(request) {
  var url = new URL(request.url);
  return request.method === 'POST' && url.pathname === '/web/compartilhar-fatura';
}

async function receber(request) {
  try {
    var form = await request.formData();
    var arquivo = form.get('fatura');
    if (arquivo && typeof arquivo.arrayBuffer === 'function' && arquivo.size <= LIMITE_BYTES) {
      var cache = await caches.open(CACHE_COMPARTILHADO);
      await cache.put(
        URL_COMPARTILHADO,
        new Response(await arquivo.arrayBuffer(), {
          headers: { 'X-Nome-Arquivo': encodeURIComponent(arquivo.name || 'fatura') },
        })
      );
    }
  } catch (e) {
    // Sem arquivo legível o app abre a importação vazia, e a pessoa escolhe
    // o arquivo pelo botão — nunca uma tela de erro do navegador.
  }
  // Location relativa: o navegador resolve contra a origem do app.
  return new Response(null, { status: 303, headers: { Location: '/app?importar=compartilhado' } });
}

self.addEventListener('fetch', function (event) {
  if (!ehCompartilhamento(event.request)) return;
  event.respondWith(receber(event.request));
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ehCompartilhamento: ehCompartilhamento, receber: receber };
}
