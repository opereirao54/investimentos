'use strict';

// Wrapper para handlers de API. Centraliza:
//  - CORS preflight + headers
//  - método HTTP permitido (405 se errado)
//  - autenticação (none | user | verified | fresh)
//  - validação de body/query com Zod (400 com issues estruturadas)
//  - try/catch global + Sentry captureException + 500 padronizado
//
// Uso:
//   const { handler } = require('../_lib/handler');
//   const { billingInitBody } = require('../_lib/schemas');
//
//   module.exports = handler({
//     method: 'POST',
//     auth: 'fresh',
//     bodySchema: billingInitBody,
//     handle: async ({ req, res, user, body }) => {
//       // ... lógica do endpoint, retorna res.json({...})
//     },
//   });
//
// Endpoints existentes que NÃO precisam validação (webhook do Asaas, market
// warmup do cron) passam `auth: 'none'` e nenhum schema — o wrapper ainda
// fornece o try/catch + Sentry.

const { cors, requireUser, requireVerifiedUser, requireFreshVerifiedUser } = require('./auth');
const { captureError } = require('./sentry');

const AUTH_LEVELS = {
  none: null,
  user: requireUser,
  verified: requireVerifiedUser,
  fresh: requireFreshVerifiedUser,
};

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function zodIssuesToPayload(zerr) {
  return zerr.issues.map((i) => ({
    path: i.path.join('.'),
    msg: i.message,
    code: i.code,
  }));
}

function handler(opts) {
  const { method = 'POST', auth = 'none', bodySchema = null, querySchema = null, handle } = opts;

  if (typeof handle !== 'function') {
    throw new Error('handler({ handle }) é obrigatório');
  }
  if (auth !== 'none' && !AUTH_LEVELS[auth]) {
    throw new Error('handler: auth inválido — use none|user|verified|fresh');
  }
  const authFn = AUTH_LEVELS[auth];
  const allowedMethods = Array.isArray(method) ? method : [method];

  return async (req, res) => {
    try {
      if (cors(req, res)) return;

      if (!allowedMethods.includes(req.method)) {
        return res.status(405).json({ error: 'method_not_allowed' });
      }

      let user = null;
      if (authFn) {
        user = await authFn(req, res);
        // authFn já respondeu 401/403 se falhou
        if (!user) return;
      }

      let body = {};
      if (bodySchema) {
        const raw = await readBody(req);
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
          return res.status(400).json({
            error: 'invalid_body',
            issues: zodIssuesToPayload(parsed.error),
          });
        }
        body = parsed.data;
      } else if (req.method !== 'GET') {
        body = await readBody(req);
      }

      let query = req.query || {};
      if (querySchema) {
        const parsed = querySchema.safeParse(query);
        if (!parsed.success) {
          return res.status(400).json({
            error: 'invalid_query',
            issues: zodIssuesToPayload(parsed.error),
          });
        }
        query = parsed.data;
      }

      await handle({ req, res, user, body, query });
    } catch (err) {
      console.error('[handler] uncaught', err);
      captureError(err, {
        url: req.url,
        method: req.method,
        auth,
      });
      if (!res.headersSent) {
        return res.status(500).json({ error: 'internal_error' });
      }
    }
  };
}

module.exports = { handler, readBody };
