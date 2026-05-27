'use strict';

// Wrapper Sentry para o lado Node (API). Degrada graciosamente quando
// SENTRY_DSN não está setada: todas as funções viram no-op silencioso, sem
// instalar handlers nem importar o SDK pesado.
//
// Em produção (Vercel): seta SENTRY_DSN em Project Settings → Environment
// Variables. Em dev/CI: deixe sem — não polui erros locais.

let Sentry = null;
let initialized = false;
let initFailed = false;

function ensureInit() {
  if (initialized || initFailed) return Sentry;
  initialized = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    initFailed = true;
    return null;
  }
  try {
    // require lazy: evita carregar o SDK quando não tem DSN.
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      // tracesSampleRate=0: começa sem APM tracing para evitar overhead
      // e custo extra. Aumente se quiser distribuir traces.
      tracesSampleRate: 0,
      // Não envia request bodies — pode conter dados pessoais (cpfCnpj,
      // cardNumber). Stack traces e mensagens chegam mesmo assim.
      sendDefaultPii: false,
    });
    return Sentry;
  } catch (e) {
    console.warn('[sentry] init failed', e && e.message);
    initFailed = true;
    return null;
  }
}

function captureError(err, context) {
  const s = ensureInit();
  if (!s) return;
  try {
    s.captureException(err, context ? { extra: context } : undefined);
  } catch (_) {}
}

function captureMessage(msg, level, context) {
  const s = ensureInit();
  if (!s) return;
  try {
    s.captureMessage(msg, {
      level: level || 'info',
      extra: context || undefined,
    });
  } catch (_) {}
}

module.exports = { ensureInit, captureError, captureMessage };
