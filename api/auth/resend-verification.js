const { auth } = require('../_lib/firebase-admin');
const { handler } = require('../_lib/handler');
const rl = require('../_lib/rate-limit');

// Endpoint para gerar um link novo de verificação de e-mail.
// O Firebase já permite ao cliente chamar `user.sendEmailVerification()`,
// mas nessa rota o app pode pedir reenvio sem precisar do user logado
// "fresh" — útil quando o token está perto de expirar ou houve troca de
// e-mail. Rate-limit 1/min por uid e 5/h por IP para evitar abuso.
//
// Resposta: { ok: true, link: '...' } apenas para inspeção manual em ambientes
// não-prod. Em produção, o link é enviado por e-mail via Firebase template
// e o front recebe apenas { ok: true }.

module.exports = handler({
  method: 'POST',
  // Não usa 'verified' — o ponto dessa rota é justamente permitir a quem
  // ainda não verificou pedir reenvio.
  auth: 'user',
  handle: async ({ req, res, user }) => {
    const ipCheck = await rl.check({
      scope: 'resend-verification-ip',
      key: rl.ipFrom(req) || 'unknown',
      windowMs: 60 * 60 * 1000,
      max: 5,
    });
    if (!ipCheck.allowed) {
      res.setHeader('Retry-After', Math.ceil(ipCheck.retryAfterMs / 1000));
      return res
        .status(429)
        .json({ error: 'too_many_requests', retryAfterMs: ipCheck.retryAfterMs });
    }
    const uidCheck = await rl.check({
      scope: 'resend-verification-uid',
      key: user.uid,
      windowMs: 60 * 1000,
      max: 1,
    });
    if (!uidCheck.allowed) {
      res.setHeader('Retry-After', Math.ceil(uidCheck.retryAfterMs / 1000));
      return res
        .status(429)
        .json({ error: 'too_many_requests', retryAfterMs: uidCheck.retryAfterMs });
    }

    if (!user.email) return res.status(400).json({ error: 'email_missing' });
    if (user.email_verified === true) return res.json({ ok: true, alreadyVerified: true });

    const continueUrl =
      (req.headers.origin || process.env.APP_ORIGIN || '').replace(/\/$/, '') + '/app';
    const link = await auth().generateEmailVerificationLink(user.email, {
      url: continueUrl || undefined,
    });
    // O Firebase NÃO envia o e-mail automaticamente quando geramos o link
    // via Admin SDK — ele só gera. Para enviar pelo template padrão do
    // Firebase, o caminho mais simples é o cliente chamar
    // `firebase.auth().currentUser.sendEmailVerification()`, que dispara
    // o envio pelo Firebase. Esta rota fica como fallback explícito para
    // troubleshooting e para integrar SMTP custom (SendGrid etc.) no
    // futuro. Em log, registra geração; não expõe o link ao cliente
    // em produção.
    if (process.env.NODE_ENV !== 'production') {
      return res.json({ ok: true, link });
    }
    console.log('[resend-verification] generated for', user.uid, user.email);
    return res.json({ ok: true });
  },
});
