'use strict';

// Helpers compartilhados entre specs E2E.

// Captura erros e warnings críticos de console para asserção pós-carga.
// Ignora ruído conhecido — DSN ausente do Sentry (esperado em CI), warnings
// do Firebase de measurement em ambiente sem domínio autorizado, e mensagens
// de CDN do Phosphor Icons.
const IGNORED_CONSOLE_PATTERNS = [
  /Sentry/i,
  /firebase.*measurement/i,
  /ph-/i, // ícones que ainda não chegaram do CDN no momento do snapshot
  /404.*favicon/i,
  /ResizeObserver/i,
];

function attachConsoleCollector(page) {
  const messages = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    const text = msg.text();
    if (IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text))) return;
    messages.push({ type: msg.type(), text });
  });
  page.on('pageerror', (err) => {
    messages.push({ type: 'pageerror', text: err.message });
  });
  return messages;
}

module.exports = { attachConsoleCollector };
