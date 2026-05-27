/**
 * Sentry browser init — ES module com dynamic import.
 *
 * Carrega @sentry/browser SOMENTE se window.__APPLIQUEI_SENTRY_DSN__ estiver
 * setado por um inline script anterior. Em dev/sem DSN, este módulo é
 * essencialmente no-op e não custa nada além do parse.
 *
 * Vite faz code-splitting do dynamic import: o chunk do Sentry vira um
 * arquivo separado em dist/assets/ e só é baixado quando init() chamar.
 *
 * Setar DSN: adicione no <head> da HTML (antes deste módulo):
 *   <script>window.__APPLIQUEI_SENTRY_DSN__ = 'https://abc@sentry.io/123';</script>
 *
 * Em deploys que não querem Sentry, deixe vazio — comportamento é o mesmo
 * do estado pré-Onda C.
 */

const dsn = (typeof window !== 'undefined' && window.__APPLIQUEI_SENTRY_DSN__) || '';

if (dsn) {
  (async () => {
    try {
      const Sentry = await import('@sentry/browser');
      Sentry.init({
        dsn,
        environment: window.__APPLIQUEI_ENV__ || 'production',
        release: window.__APPLIQUEI_RELEASE__ || undefined,
        // Não captura request bodies (PII: cpfCnpj, número de cartão).
        sendDefaultPii: false,
        // tracesSampleRate=0 começa sem APM — habilite quando quiser.
        tracesSampleRate: 0,
        // Captura erros de scripts cross-origin sem detalhes apenas se
        // existir um Sentry SDK aceitando esse evento. Ajuda devs a verem
        // que "alguma coisa" quebrou em third-party JS sem detalhe útil.
        beforeSend(event) {
          // Filtra erros conhecidos/ruidosos que não acionáveis.
          const msg = event.exception?.values?.[0]?.value || '';
          if (/ResizeObserver loop|Non-Error promise rejection captured/.test(msg)) {
            return null;
          }
          return event;
        },
      });
      // Expõe para resto do código capturar manualmente quando quiser:
      //   if (window.AppliqueiSentry) AppliqueiSentry.captureException(err);
      window.AppliqueiSentry = Sentry;
    } catch (e) {
      // Falha do dynamic import (ex.: rede). Loga e segue — não bloqueia app.
      console.warn('[Sentry] init failed', e && e.message);
    }
  })();
}
