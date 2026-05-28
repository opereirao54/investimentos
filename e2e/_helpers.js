'use strict';

// Helpers compartilhados entre specs E2E.
//
// Estratégia de filtro: páginas como `Appliquei_v13.0.html` integram com
// vários serviços externos (Yahoo Finance, CORS proxies) e tentam chamar
// /api/* da Vercel — que não existe no `vite preview`. Esses 404s aparecem
// como "Failed to load resource" no console do Chromium, mas NÃO são
// regressão de código do app. Filtramos por **conteúdo da mensagem** e
// por **URL do recurso** (msg.location().url).
//
// Erros reais de código (JS quebrado, throw não capturado) caem em
// `pageerror`, que NÃO passa pelo filtro — esses sempre falham o teste.

const IGNORED_CONSOLE_PATTERNS = [
  /Sentry/i,
  /firebase.*measurement/i,
  /ph-/i, // ícones que ainda não chegaram do CDN no momento do snapshot
  /favicon/i,
  /ResizeObserver/i,
  // APIs Firebase deprecadas ainda em uso noutros pontos (legado Onda 3).
  // Warning de deprecação não é regressão.
  /IndexedDbPersistence|enablePersistence/i,
  // Mensagem genérica do Chromium para 404/CORS — recurso especificado
  // via URL é o que importa, filtrado abaixo por IGNORED_URL_PATTERNS.
  /Failed to load resource/i,
];

const IGNORED_URL_PATTERNS = [
  // /api/* são Vercel Functions; não rodam no `vite preview`. Esperado 404.
  /\/api\//,
  // APIs financeiras e proxies CORS externos podem falhar em CI.
  /finance\.yahoo\.com|brapi\.dev|thingproxy\.freeboard\.io|allorigins\.win|cors-anywhere/i,
];

function attachConsoleCollector(page) {
  const messages = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    const text = msg.text();
    if (IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text))) return;
    const url = (msg.location && msg.location().url) || '';
    if (url && IGNORED_URL_PATTERNS.some((re) => re.test(url))) return;
    messages.push({ type: msg.type(), text, url });
  });
  page.on('pageerror', (err) => {
    messages.push({ type: 'pageerror', text: err.message });
  });
  return messages;
}

module.exports = { attachConsoleCollector };
