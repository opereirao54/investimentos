'use strict';

// Ações do usuário autenticado que não são de faturação. Sub-router por `?op=`,
// no mesmo padrão de api/market.js:
//
//   GET  /api/user?op=feedback              lista as sugestões do próprio uid
//   POST /api/user?op=feedback              cria uma sugestão
//   GET  /api/user?op=feedback-anexo&id=    devolve a imagem anexada a uma delas
//   POST /api/user?op=resend-verification   novo link de verificação de e-mail
//
// POR QUE O FEEDBACK VIVE AQUI, E NÃO NO CLIENTE
//
// O formulário de Dúvidas & Sugestões escrevia (e lia) a coleção `feedback`
// DIRETO pelo SDK do cliente, e portanto dependia da Security Rule
// `match /feedback/{id}` estar publicada no projeto. Essa regra e o formulário
// entraram no MESMO commit (836024c) e não há passo de CI que publique
// `firestore.rules` — o deploy é manual (`firebase deploy --only
// firestore:rules`). Com a regra ausente em produção vale a negação implícita:
// TODA tentativa de enviar volta `permission-denied`, mesmo com o e-mail
// verificado, e o histórico fica em "0 total" para sempre. É exatamente o
// sintoma relatado ("nunca consegui enviar nada por lá") e a razão de o resto
// do app não sofrer do mesmo mal: o sync de dados tem caminho servidor
// (/api/sync/push, Admin SDK) que ignora as rules.
//
// O Admin SDK não passa por Security Rules. Roteando por aqui, a sugestão
// deixa de depender de um deploy manual de rules — e também de enforcement de
// App Check ou de propagação de claim no token, que produzem o mesmo
// `permission-denied` indistinguível no cliente.
//
// As travas que a regra fazia continuam existindo: uid carimbado pelo token
// (nunca vindo do corpo), texto entre 10 e 1000 caracteres (schema Zod),
// leitura restrita ao próprio uid, e `status`/`reply` gravados só pelo
// servidor — o painel admin responde por /api/admin/action.
//
// POR QUE `resend-verification` MUDOU DE CASA
//
// O plano Vercel Hobby permite 12 Serverless Functions e o projeto já estava
// exatamente nas 12 (ver commit 2cf4021, que consolidou os endpoints de
// market pelo mesmo motivo). Um arquivo novo para o feedback seria a 13ª e o
// deploy falharia inteiro. As duas rotas são irmãs — ação de usuário logado,
// fora de faturação — então dividem o arquivo. `/api/auth/resend-verification`
// continua respondendo por um rewrite em vercel.json, para não quebrar cliente
// com aba antiga aberta.

const { db, auth, fieldValue } = require('./_lib/firebase-admin');
const { handler } = require('./_lib/handler');
const { feedbackCreateBody, feedbackListQuery } = require('./_lib/schemas');
const rl = require('./_lib/rate-limit');

const LIMITE_PADRAO = 50;

// ─── FEEDBACK (Dúvidas & Sugestões) ─────────────────────────────────────────

function paraMs(v) {
  return v && typeof v.toMillis === 'function' ? v.toMillis() : 0;
}

/**
 * Projeção enviada ao cliente. `uid` e `email` ficam de fora: ele já é dono.
 *
 * Do anexo sai só o RESUMO (formato, tamanho, dimensões), nunca os bytes: a
 * listagem é carregada toda vez que a aba abre, e uma imagem de meio mega por
 * item transformaria isso numa transferência de vários megabytes. Quem quiser
 * ver a imagem pede uma por uma em `op=feedback-anexo`.
 */
function paraItem(doc) {
  const d = doc.data() || {};
  return {
    id: doc.id,
    aba: d.aba || '',
    outroTema: d.outroTema || '',
    tipo: d.tipo || 'melhoria',
    texto: d.texto || '',
    status: d.status || 'aberto',
    reply: d.reply || null,
    anexo: d.anexo || null,
    createdAtMs: paraMs(d.createdAt),
    repliedAtMs: paraMs(d.repliedAt),
  };
}

// Assinatura dos primeiros bytes de cada formato aceito. Conferimos o ARQUIVO,
// não o que o corpo diz que ele é: o `mime` chega do cliente e é ele que vai
// virar o `src` de um <img> no painel admin e no histórico. Aceitar bytes
// arbitrários com rótulo de imagem seria guardar conteúdo desconhecido e
// devolvê-lo depois como imagem.
const ASSINATURA_IMAGEM = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** Decodifica o base64 já validado pelo schema e confere a assinatura. */
function anexoBytes(anexo) {
  const buf = Buffer.from(anexo.dados, 'base64');
  if (buf.length < 12) return null;
  const confere = ASSINATURA_IMAGEM[anexo.mime];
  return confere && confere(buf) ? buf : null;
}

// O wrapper só oferece 'user' | 'verified' para o arquivo INTEIRO, e
// resend-verification existe justamente para quem ainda não verificou. Então a
// exigência fica por rota. Mesma semântica de requireVerifiedUser: só bloqueia
// quando EMAIL_VERIFY_ENFORCE está ligado, para não derrubar contas legadas.
function exigeEmailVerificado(res, user) {
  if (user.email_verified === true) return true;
  const enforce = String(process.env.EMAIL_VERIFY_ENFORCE || '').toLowerCase() === 'true';
  if (!enforce) {
    console.warn('[user] email_not_verified (log-only)', user.uid, user.email);
    return true;
  }
  res.status(403).json({ error: 'email_not_verified' });
  return false;
}

// Lista as sugestões do próprio usuário, da mais recente para a mais antiga.
// Sem `orderBy` na query: ordenar por `createdAt` no Firestore exigiria índice
// composto (uid + createdAt) e um índice faltando derruba a leitura inteira —
// seria trocar um modo de falha por outro. O volume por usuário é pequeno
// (dezenas), então ordenamos em memória.
async function feedbackListar(req, res, user) {
  if (!exigeEmailVerificado(res, user)) return;
  const q = feedbackListQuery.safeParse(req.query || {});
  const limite = Math.min((q.success && Number(q.data.limit)) || LIMITE_PADRAO, 200);
  const snap = await db().collection('feedback').where('uid', '==', user.uid).get();
  const items = [];
  snap.forEach((d) => items.push(paraItem(d)));
  items.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return res.json({ items: items.slice(0, limite), total: items.length });
}

async function feedbackCriar(res, user, bruto) {
  if (!exigeEmailVerificado(res, user)) return;

  // O corpo é validado AQUI, não pelo wrapper: `bodySchema` no handler roda em
  // todo request, e o GET da listagem (sem corpo) morreria em 400 antes de
  // chegar à rota. Mesmo formato de erro do wrapper, para o cliente não
  // precisar distinguir os dois caminhos.
  const parsed = feedbackCreateBody.safeParse(bruto || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        msg: i.message,
        code: i.code,
      })),
    });
  }
  const body = parsed.data;

  // Teto de abuso por usuário. O rate-limit falha aberto quando o próprio
  // Firestore está com problema — não bloqueia legítimos.
  const limite = await rl.check({
    scope: 'feedback',
    key: user.uid,
    windowMs: 60 * 60 * 1000,
    max: 20,
  });
  if (!limite.allowed) {
    res.setHeader('Retry-After', Math.ceil(limite.retryAfterMs / 1000));
    return res.status(429).json({ error: 'rate_limited', retryAfterMs: limite.retryAfterMs });
  }

  const doc = {
    // O uid vem do TOKEN, nunca do corpo — é o que a regra garantia com
    // `request.resource.data.uid == request.auth.uid`.
    uid: user.uid,
    email: user.email || '',
    aba: body.aba,
    outroTema: body.aba === 'outro' ? body.outroTema || '' : '',
    tipo: body.tipo,
    texto: body.texto,
    // Estado e resposta são do servidor. O cliente nunca os define, e o painel
    // admin escreve por /api/admin/action (reply_feedback / resolve_feedback).
    status: 'aberto',
    reply: null,
    createdAt: fieldValue().serverTimestamp(),
    anexo: null,
  };

  // A imagem NÃO mora no documento da sugestão: ela vai para
  // `feedback_anexos/<id da sugestão>`, e aqui fica só o resumo. Motivo: tanto
  // a listagem do usuário quanto a do painel admin leem a coleção `feedback`
  // inteira (o painel, até 300 de uma vez) — com meio mega de base64 por
  // documento, cada abertura da tela puxaria centenas de megabytes do
  // Firestore. Separando, a listagem continua leve e a imagem é buscada só
  // quando alguém pede para ver.
  //
  // `bytes` é medido AQUI, sobre o buffer decodificado, e não aceito do corpo:
  // é um número que aparece na tela e não há razão para o cliente ditá-lo.
  let bufAnexo = null;
  if (body.anexo) {
    bufAnexo = anexoBytes(body.anexo);
    if (!bufAnexo) {
      return res.status(400).json({
        error: 'invalid_body',
        issues: [
          { path: 'anexo.dados', msg: 'o arquivo enviado não é uma imagem válida', code: 'custom' },
        ],
      });
    }
    doc.anexo = {
      mime: body.anexo.mime,
      bytes: bufAnexo.length,
      largura: body.anexo.largura,
      altura: body.anexo.altura,
    };
  }

  // `feedback_anexos` NÃO ganha regra no firestore.rules, e é de propósito: só
  // o Admin SDK escreve e lê essa coleção, e ele não passa por rules. A
  // negação implícita do fim do arquivo já a torna inalcançável pelo SDK do
  // cliente — que é o que queremos. Publicar uma regra a mais exigiria um
  // `firebase deploy --only firestore:rules` manual, o mesmo passo esquecido
  // que deixou o formulário de sugestões quebrado por meses (ver o topo deste
  // arquivo) e que o conferidor de regras existe para detectar.
  //
  // As duas gravações vão no mesmo lote, que é atômico. Meio caminho aqui dá
  // sempre um estado ruim: sugestão anunciando anexo que ninguém consegue
  // abrir, ou imagem órfã que nenhuma tela alcança e ninguém sabe apagar.
  const ref = db().collection('feedback').doc();
  const lote = db().batch();
  lote.set(ref, doc);
  if (bufAnexo) {
    lote.set(db().collection('feedback_anexos').doc(ref.id), {
      // Repetido de propósito: é por este campo que a leitura confere o dono,
      // sem precisar buscar o documento da sugestão antes.
      uid: user.uid,
      mime: body.anexo.mime,
      dados: body.anexo.dados,
      bytes: bufAnexo.length,
      largura: body.anexo.largura,
      altura: body.anexo.altura,
      createdAt: fieldValue().serverTimestamp(),
    });
  }
  await lote.commit();
  return res.status(201).json({ ok: true, id: ref.id });
}

// Devolve a imagem de UMA sugestão do próprio usuário.
async function feedbackAnexoLer(req, res, user) {
  if (!exigeEmailVerificado(res, user)) return;
  const id = String((req.query && req.query.id) || '').trim();
  // Id de documento do Firestore. A validação também impede que um `id` com
  // barras escorregue para outro caminho da coleção.
  if (!id || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  const snap = await db().collection('feedback_anexos').doc(id).get();
  const d = snap && snap.exists ? snap.data() || {} : null;
  // Mesmo 404 para "não existe" e para "não é seu": quem chutar ids alheios
  // não fica sabendo nem quais existem.
  if (!d || d.uid !== user.uid) return res.status(404).json({ error: 'not_found' });
  return res.json({
    mime: d.mime || 'image/jpeg',
    dados: d.dados || '',
    bytes: d.bytes || 0,
    largura: d.largura || 0,
    altura: d.altura || 0,
  });
}

// ─── REENVIO DE VERIFICAÇÃO DE E-MAIL ───────────────────────────────────────
// Movido de api/auth/resend-verification.js sem mudança de comportamento.
//
// O Firebase já permite ao cliente chamar `user.sendEmailVerification()`, mas
// nessa rota o app pode pedir reenvio sem precisar do user logado "fresh" —
// útil quando o token está perto de expirar ou houve troca de e-mail.
// Rate-limit 1/min por uid e 5/h por IP para evitar abuso.
async function reenviarVerificacao(req, res, user) {
  const ipCheck = await rl.check({
    scope: 'resend-verification-ip',
    key: rl.ipFrom(req) || 'unknown',
    windowMs: 60 * 60 * 1000,
    max: 5,
  });
  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', Math.ceil(ipCheck.retryAfterMs / 1000));
    return res.status(429).json({ error: 'too_many_requests', retryAfterMs: ipCheck.retryAfterMs });
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
  // O Firebase NÃO envia o e-mail automaticamente quando geramos o link via
  // Admin SDK — ele só gera. Para enviar pelo template padrão, o caminho mais
  // simples é o cliente chamar `sendEmailVerification()`. Esta rota fica como
  // fallback explícito para troubleshooting e para integrar SMTP custom no
  // futuro. Não expõe o link ao cliente em produção.
  if (process.env.NODE_ENV !== 'production') {
    return res.json({ ok: true, link });
  }
  console.log('[resend-verification] generated for', user.uid, user.email);
  return res.json({ ok: true });
}

// ─── ROTEADOR ───────────────────────────────────────────────────────────────

module.exports = handler({
  method: ['GET', 'POST'],
  // 'user' e não 'verified': resend-verification existe para quem ainda NÃO
  // verificou. O feedback exige verificação na própria rota.
  auth: 'user',
  handle: async ({ req, res, user, body }) => {
    const op = String((req.query && req.query.op) || '');

    if (op === 'feedback') {
      if (req.method === 'GET') return feedbackListar(req, res, user);
      return feedbackCriar(res, user, body);
    }

    if (op === 'feedback-anexo') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
      return feedbackAnexoLer(req, res, user);
    }

    if (op === 'resend-verification') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
      return reenviarVerificacao(req, res, user);
    }

    return res.status(400).json({ error: 'unknown_op' });
  },
});
