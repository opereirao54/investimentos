'use strict';

// Ações do usuário autenticado que não são de faturação. Sub-router por `?op=`,
// no mesmo padrão de api/market.js:
//
//   GET  /api/user?op=feedback              lista as sugestões do próprio uid
//   POST /api/user?op=feedback              cria uma sugestão
//   GET  /api/user?op=feedback-anexo&id=    devolve a imagem anexada a uma delas
//   POST /api/user?op=resend-verification   novo link de verificação de e-mail
//   GET  /api/user?op=privacidade           o aceite da Política de Privacidade e dos Termos de Uso vigentes
//   POST /api/user?op=privacidade           registra o aceite (versões vigentes)
//   POST /api/user?op=telegram              webhook do bot (público; header secreto)
//   POST /api/user?op=telegram-alertas      rodada dos alertas (agendador; Bearer CRON_SECRET)
//   POST /api/user?op=telegram-link         gera o link t.me/<bot>?start=<código>
//   GET  /api/user?op=telegram-status       o Telegram está conectado?
//   POST /api/user?op=telegram-unlink       desconecta
//   GET  /api/user?op=telegram-inbox        lançamentos do Telegram ainda não aplicados
//   POST /api/user?op=telegram-inbox        confirma os aplicados (apaga da caixa)
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

const crypto = require('crypto');
const { db, auth, fieldValue } = require('./_lib/firebase-admin');
const { handler } = require('./_lib/handler');
const { feedbackCreateBody, feedbackListQuery, telegramInboxAckBody } = require('./_lib/schemas');
const rl = require('./_lib/rate-limit');
const codes = require('./_lib/codes');
const convites = require('./_lib/convites');
const { requireUser } = require('./_lib/auth');
const telegram = require('./_lib/telegram-bot');
const telegramAlertas = require('./_lib/telegram-alertas-envio');

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

// ─── APPLICASH: CLIQUES NO LINK DE INDICAÇÃO ────────────────────────────────

// Conta quantas pessoas ABRIRAM um link de indicação. É a primeira etapa do
// funil que o indicador vê ("3 abriram · 1 cadastrou · 1 assinou"); as outras
// duas já saem dos dados de billing.
//
// PRIVACIDADE (LGPD): grava um CONTADOR AGREGADO e nada mais. Sem IP, sem
// user-agent, sem fingerprint, sem identificador do visitante — nem no
// documento, nem em log. O que fica é `referralCodes/{CODE}.hits`, um número.
// Não há dado pessoal envolvido, por desenho, e não há como reconstruir quem
// clicou a partir dele.
//
// ABUSO: o endpoint é público (quem clica ainda não tem conta), então
// qualquer um poderia inflar o contador de qualquer cupom. Como o número não
// vale dinheiro — o crédito Applicash nasce só de pagamento confirmado, no
// webhook — o risco é vaidade, não fraude. Mesmo assim há rate-limit por IP
// (hash, via rate-limit.js) para não virar vetor de escrita barata no
// Firestore, e o cliente deduplica por sessão para um F5 não contar de novo.
async function registrarCliqueIndicacao(req, res) {
  const codigo = codes.normalize((req.body && req.body.code) || '');
  if (!codes.isValid(codigo)) {
    // 204 e não 400: é telemetria, o visitante não tem nada a corrigir e a
    // resposta não deve dizer se um cupom existe (evita enumeração).
    return res.status(204).end();
  }

  const limite = await rl.check({
    scope: 'ref-hit-ip',
    key: rl.ipFrom(req) || 'unknown',
    windowMs: 60 * 60 * 1000,
    max: 60,
  });
  if (!limite.allowed) return res.status(204).end();

  try {
    // Só incrementa em cupom que existe. `update` (e não `set`) falha em doc
    // inexistente — é o que impede criar reservas de cupom por aqui.
    await db()
      .collection('referralCodes')
      .doc(codigo)
      .update({
        hits: fieldValue().increment(1),
        lastHitAt: fieldValue().serverTimestamp(),
      });
  } catch (_) {
    // Cupom inexistente ou escrita falhou. Silencioso de propósito: a
    // resposta não pode revelar quais cupons existem.
  }
  return res.status(204).end();
}

// ─── POLÍTICA DE PRIVACIDADE: ACEITE ────────────────────────────────────────

// Versão vigente da Política de Privacidade. É a data da redação e tem de ser
// a mesma de PRIVACIDADE_VERSAO em web/appliquei-privacidade.js (um teste
// confere). Mudou o texto de forma relevante, muda a versão: quem aceitou a
// anterior volta a ver a política e aceita de novo.
const PRIVACIDADE_VERSAO = '2026-10-11';
// Versão vigente dos Termos de Uso — a mesma de TERMOS_VERSAO em
// web/appliquei-termos.js (um teste confere). Os Termos são aceitos junto com
// a política, no mesmo POST, mas cada um tem o seu documento de prova.
const TERMOS_VERSAO = '2026-10-11';
const PRIVACIDADE_ORIGENS = new Set(['cadastro', 'app']);

function refAceite(uid, id) {
  return db().collection('users').doc(uid).collection('consentimentos').doc(id);
}

function refAceitePrivacidade(uid) {
  return refAceite(uid, 'privacidade-' + PRIVACIDADE_VERSAO);
}

function refAceiteTermos(uid) {
  return refAceite(uid, 'termos-' + TERMOS_VERSAO);
}

// Grava o aceite de um documento, se ainda não existir. Idempotente: o
// primeiro aceite é o que vale como prova; repetir não reescreve a data.
async function gravarAceite(ref, uid, versao, origem) {
  const snap = await ref.get();
  if (snap && snap.exists) return { novo: false, aceitoEmMs: paraMs((snap.data() || {}).aceitoEm) };
  await ref.set({
    uid: uid,
    versao: versao,
    origem: origem,
    aceitoEm: fieldValue().serverTimestamp(),
  });
  return { novo: true, aceitoEmMs: Date.now() };
}

// O registro do aceite é a PROVA do consentimento (LGPD, art. 8º, §2º: o ônus
// da prova é do controlador). Por isso mora no servidor, gravado pelo Admin
// SDK com o uid do TOKEN e a hora do SERVIDOR — nada disso vem do cliente.
// Um documento por versão: o histórico de aceites fica preservado.
//
// Não exige e-mail verificado: o aceite acontece no cadastro, antes da
// verificação, e registrar consentimento não dá acesso a dado nenhum.
async function privacidadeStatus(res, user) {
  const [snap, snapT] = await Promise.all([
    refAceitePrivacidade(user.uid).get(),
    refAceiteTermos(user.uid).get(),
  ]);
  const d = snap && snap.exists ? snap.data() || {} : null;
  const t = snapT && snapT.exists ? snapT.data() || {} : null;
  return res.json({
    versao: PRIVACIDADE_VERSAO,
    aceito: !!d,
    aceitoEmMs: d ? paraMs(d.aceitoEm) : 0,
    termosVersao: TERMOS_VERSAO,
    termosAceito: !!t,
    termosAceitoEmMs: t ? paraMs(t.aceitoEm) : 0,
  });
}

async function privacidadeAceitar(res, user, bruto) {
  const corpo = bruto || {};
  // Só se aceita a versão vigente: um cliente com a página antiga aberta não
  // pode registrar o aceite de um texto que já não é o publicado.
  if (corpo.versao !== PRIVACIDADE_VERSAO) {
    return res.status(409).json({
      error: 'versao_desatualizada',
      versao: PRIVACIDADE_VERSAO,
      termosVersao: TERMOS_VERSAO,
    });
  }
  // Termos ausentes = cliente de antes dos Termos: registra só a política, e
  // o GET seguinte (termosAceito: false) pede os Termos. Versão errada dos
  // Termos é recusada como a da política.
  const comTermos = corpo.termosVersao != null && corpo.termosVersao !== '';
  if (comTermos && corpo.termosVersao !== TERMOS_VERSAO) {
    return res.status(409).json({
      error: 'versao_desatualizada',
      versao: PRIVACIDADE_VERSAO,
      termosVersao: TERMOS_VERSAO,
    });
  }
  const origem = PRIVACIDADE_ORIGENS.has(corpo.origem) ? corpo.origem : 'app';
  const priv = await gravarAceite(
    refAceitePrivacidade(user.uid),
    user.uid,
    PRIVACIDADE_VERSAO,
    origem
  );
  const termos = comTermos
    ? await gravarAceite(refAceiteTermos(user.uid), user.uid, TERMOS_VERSAO, origem)
    : null;
  return res.status(priv.novo || (termos && termos.novo) ? 201 : 200).json({
    ok: true,
    versao: PRIVACIDADE_VERSAO,
    aceitoEmMs: priv.aceitoEmMs,
    termosVersao: TERMOS_VERSAO,
    termosAceito: !!termos,
    termosAceitoEmMs: termos ? termos.aceitoEmMs : 0,
  });
}

// ─── TELEGRAM ───────────────────────────────────────────────────────────────
// Lógica em api/_lib/telegram-bot.js. Aqui só a borda HTTP. O webhook mora
// neste arquivo pelo mesmo motivo do feedback: o teto de 12 functions do Hobby.

async function telegramWebhook(req, res, body) {
  // Sem o header secreto qualquer um poderia forjar mensagens "do Telegram"
  // e lançar despesas na conta de um usuário vinculado.
  if (!telegram.segredoConfere(req)) return res.status(401).json({ error: 'unauthorized' });
  const r = await telegram.processarUpdate(body);
  return res.status(200).json(Object.assign({ ok: true }, r));
}

// Rodada dos alertas. Quem chama é o agendador (.github/workflows/
// telegram-alertas.yml), com o mesmo CRON_SECRET dos crons da Vercel. Uma
// página por chamada; o agendador repete com `cursor` enquanto vier `proximo`.
async function telegramRodadaAlertas(req, res, body) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return res.status(503).json({ error: 'cron_disabled' });
  const recebido = Buffer.from(String((req.headers || {}).authorization || ''), 'utf8');
  const esperado = Buffer.from(`Bearer ${segredo}`, 'utf8');
  if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const b = body && typeof body === 'object' ? body : {};
  const cursor = typeof b.cursor === 'string' && b.cursor.length <= 40 ? b.cursor : null;
  const janela = b.janela === 'manha' || b.janela === 'noite' ? b.janela : null;
  const r = await telegramAlertas.rodar({ cursor, janela });
  return res.status(200).json(Object.assign({ ok: true }, r));
}

async function telegramRotas(op, req, res, user, body) {
  if (!exigeEmailVerificado(res, user)) return;
  if (op === 'telegram-link') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const lim = await rl.check({ scope: 'tg-link', key: user.uid, windowMs: 600000, max: 10 });
    if (!lim.allowed) return res.status(429).json({ error: 'rate_limited' });
    const r = await telegram.criarCodigoVinculo(user.uid);
    if (!r.url) return res.status(503).json({ error: 'telegram_nao_configurado' });
    return res.json(Object.assign({ ok: true }, r));
  }
  if (op === 'telegram-status') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    return res.json(Object.assign({ ok: true }, await telegram.statusVinculo(user.uid)));
  }
  if (op === 'telegram-unlink') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    return res.json(await telegram.desvincular(user.uid));
  }
  // telegram-inbox
  if (req.method === 'GET') {
    return res.json({ ok: true, itens: await telegram.listarInbox(user.uid) });
  }
  const parsed = telegramInboxAckBody.safeParse(body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });
  const n = await telegram.confirmarInbox(user.uid, parsed.data.ids);
  return res.json({ ok: true, removidos: n });
}

const OPS_TELEGRAM_APP = new Set([
  'telegram-link',
  'telegram-status',
  'telegram-unlink',
  'telegram-inbox',
]);

// ─── ROTEADOR ───────────────────────────────────────────────────────────────

// Ops que podem ser chamadas SEM login. Allowlist explícita, e não
// `auth: 'none'` no wrapper: assim o padrão do arquivo continua sendo
// "autenticado", e uma op nova só fica pública se alguém a escrever aqui de
// propósito. Inverter o default deixaria uma rota futura aberta por descuido.
// `telegram` é o webhook do bot: quem chama é o Telegram, sem login, e a
// autenticação é o header secreto conferido em telegramWebhook.
const OPS_PUBLICAS = new Set(['ref-hit', 'telegram', 'telegram-alertas', 'convite-modo']);

module.exports = handler({
  method: ['GET', 'POST'],
  // 'none' no wrapper porque o roteador faz a autenticação ele mesmo, logo
  // abaixo — é 'user' e não 'verified' porque resend-verification existe
  // justamente para quem ainda NÃO verificou. O feedback exige verificação
  // na própria rota.
  auth: 'none',
  handle: async ({ req, res, body }) => {
    const op = String((req.query && req.query.op) || '');

    if (op === 'ref-hit') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
      return registrarCliqueIndicacao(req, res);
    }

    // Só diz se o cadastro está pedindo convite — a tela de login usa para
    // mostrar o campo. Não revela nada sobre códigos.
    if (op === 'convite-modo') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
      const obrigatorio = await convites.modoObrigatorio(db());
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.json({ obrigatorio });
    }

    if (op === 'telegram') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
      return telegramWebhook(req, res, body);
    }

    if (op === 'telegram-alertas') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
      return telegramRodadaAlertas(req, res, body);
    }

    let user = null;
    if (!OPS_PUBLICAS.has(op)) {
      user = await requireUser(req, res);
      if (!user) return; // requireUser já respondeu 401
    }

    if (op === 'feedback') {
      if (req.method === 'GET') return feedbackListar(req, res, user);
      return feedbackCriar(res, user, body);
    }

    if (op === 'feedback-anexo') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
      return feedbackAnexoLer(req, res, user);
    }

    if (op === 'privacidade') {
      if (req.method === 'GET') return privacidadeStatus(res, user);
      return privacidadeAceitar(res, user, body);
    }

    if (OPS_TELEGRAM_APP.has(op)) return telegramRotas(op, req, res, user, body);

    if (op === 'resend-verification') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
      return reenviarVerificacao(req, res, user);
    }

    return res.status(400).json({ error: 'unknown_op' });
  },
});

// Para o teste que confere a versão do cliente.
module.exports.PRIVACIDADE_VERSAO = PRIVACIDADE_VERSAO;
module.exports.TERMOS_VERSAO = TERMOS_VERSAO;
