'use strict';

// Bot de lançamentos pelo Telegram — o lado do servidor.
//
// O BOT NÃO GRAVA NAS TRANSAÇÕES. Todas as transações do usuário vivem num
// único JSON (`futurorico_transacoes` em users/{uid}/data/main), sincronizado
// por "última versão vence" (api/sync/push.js). Se o servidor escrevesse nesse
// JSON, o próximo salvamento de um aparelho com a cópia antiga apagaria o
// lançamento do Telegram sem ninguém ver. Então o bot deixa o lançamento numa
// CAIXA DE ENTRADA (users/{uid}/telegramInbox) e o app, ao abrir, aplica cada
// item pelo mesmo criarLancamentos() do formulário e apaga o item.
//
// Coleções (todas escritas só pelo Admin SDK; o cliente lê pela API, nunca
// direto — as Security Rules negam por padrão o que não está listado nelas):
//   telegramCodigos/{codigo}          código de vínculo, uso único, 15 min
//   telegramLinks/{chatId}            chat → uid
//   telegramPendentes/{chat_msg}      lançamento esperando o usuário escolher o cartão
//   telegramUpdates/{update_id}       update já processado (Telegram reentrega)
//   users/{uid}/integracoes/telegram  status do vínculo + categorias aprendidas
//   users/{uid}/telegramInbox/{id}    caixa de entrada que o app consome
//
// Itens da caixa de entrada:
//   {tipo:'lancamento', lanc:{...}}          vira transação(ões) no app
//   {tipo:'desfazer',   alvo:<id>}           remove as transações daquele lançamento
//   {tipo:'categoria',  alvo:<id>, categoriaDespesa}  troca a categoria delas
// O id do lançamento é `tg<chat>_<mensagem>`; as transações nascem com
// `tg<chat>_<mensagem>_<n>`. Id fixo = Telegram reentregando a mesma mensagem
// não duplica, e Desfazer/Categoria sabem exatamente o que tocar.

const crypto = require('crypto');
const { db, fieldValue, timestamp } = require('./firebase-admin');
const { computeAccess } = require('./access');
const rl = require('./rate-limit');
const tg = require('./telegram-api');
const parser = require('./telegram-parser');

const CODIGO_TTL_MS = 15 * 60 * 1000;
const PENDENTE_TTL_MS = 24 * 60 * 60 * 1000;
const RE_ID_INBOX = /^[A-Za-z0-9_-]{1,80}$/;

// A IA de reserva é injetável: o módulo real é carregado sob demanda e os
// testes trocam por um falso. null = desligada.
let ia = null;
function definirIA(impl) {
  ia = impl;
}
function iaAtiva() {
  if (ia) return ia;
  if (!process.env.GEMINI_API_KEY) return null;
  return require('./telegram-ia');
}

// ─── utilidades ─────────────────────────────────────────────────────────────

// Timestamp para a política de TTL do Firestore (que só aceita Timestamp, não
// número). As regras do bot leem os campos *Ms; este existe só para a limpeza
// automática das coleções temporárias (ver docs/TELEGRAM.md).
function expiraEm(ms) {
  return timestamp().fromMillis(ms);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function brl(n) {
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataBR(ymd) {
  const [a, m, d] = String(ymd).split('-');
  return `${d}/${m}/${a}`;
}

function lerJSON(s, padrao) {
  try {
    const v = JSON.parse(s);
    return v == null ? padrao : v;
  } catch (_) {
    return padrao;
  }
}

function botUsername() {
  return (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
}

function gerarCodigo() {
  // 12 caracteres base62 ≈ 71 bits: impossível de adivinhar em 15 minutos.
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += alfabeto[bytes[i] % alfabeto.length];
  return s;
}

function idLancamento(chatId, messageId) {
  return `tg${String(chatId).replace(/[^0-9]/g, '')}_${messageId}`;
}

// Contas que podem pagar/receber: ativas e que não são corretora.
function contasDeCaixa(contas) {
  return (contas || []).filter((c) => c && !c.arquivada && c.tipo !== 'corretora');
}

/** A conta principal: a marcada no app; se só houver uma conta de caixa, ela. */
function contaPrincipal(contas) {
  const caixa = contasDeCaixa(contas);
  return caixa.find((c) => c.principal === true) || (caixa.length === 1 ? caixa[0] : null);
}

// Categorias de despesa visíveis do usuário, na mesma ordem do app.
function categoriasDoUsuario(custom) {
  const ajustes = Array.isArray(custom) ? custom : [];
  const porV = {};
  ajustes.forEach((a) => {
    if (a && a.v) porV[a.v] = a;
  });
  const out = [];
  parser.CATEGORIAS_PADRAO.forEach((c) => {
    const a = porV[c.v];
    if (a && a.oculta) return;
    out.push({ v: c.v, label: (a && a.label) || c.label });
  });
  ajustes.forEach((a) => {
    if (!a || !a.v || a.oculta || parser.CATEGORIAS_PADRAO.some((c) => c.v === a.v)) return;
    out.push({ v: a.v, label: a.label });
  });
  return out;
}

function rotuloCategoria(v, categorias) {
  if (!v) return '🏷️ Sem categoria';
  const c = (categorias || []).find((x) => x.v === v);
  return c ? c.label : v;
}

async function carregarContexto(uid) {
  const D = db();
  const [dataSnap, integSnap] = await Promise.all([
    D.collection('users').doc(uid).collection('data').doc('main').get(),
    D.collection('users').doc(uid).collection('integracoes').doc('telegram').get(),
  ]);
  const keys = (dataSnap.exists && (dataSnap.data() || {}).keys) || {};
  const integ = integSnap.exists ? integSnap.data() || {} : {};
  const contas = lerJSON(keys.appliquei_contas, []);
  const cartoes = lerJSON(keys.futurorico_cartoes, []);
  const categorias = categoriasDoUsuario(lerJSON(keys.futurorico_categoriasDespesa, []));
  return {
    contas: Array.isArray(contas) ? contas : [],
    cartoes: Array.isArray(cartoes) ? cartoes : [],
    categorias,
    aprendidas: integ.aprendidas || {},
  };
}

// ─── textos ─────────────────────────────────────────────────────────────────

const EXEMPLOS =
  '• <code>mercado 52,90</code>\n' +
  '• <code>ontem uber 18</code>\n' +
  '• <code>+3500 salário</code>\n' +
  '• <code>nubank 300 tênis 3x</code>\n' +
  '• <code>aluguel 1800 fixa dia 10</code>\n' +
  '• <code>netflix 55,90 todo mês no cartão</code>';

const AJUDA =
  '<b>Como lançar</b>\nMande o que gastou ou recebeu, com o valor:\n' +
  EXEMPLOS +
  '\n\n' +
  '<b>Dicas</b>\n' +
  '• <code>+</code> ou "recebi" = receita\n' +
  '• Nome do cartão, "cartão" ou <code>3x</code> = compra no cartão\n' +
  '• "pix" ou "débito" = sai da conta\n' +
  '• Sem dizer a conta, usa a sua <b>conta principal</b>\n' +
  '• <code>ontem</code> ou <code>05/10</code> muda a data\n\n' +
  '/desfazer — desfaz o último lançamento\n' +
  '/desconectar — desliga este Telegram da sua conta';

function textoNaoConectado() {
  return (
    '👋 Este Telegram ainda não está ligado a uma conta Appliquei.\n\n' +
    'No app, abra <b>Configurações → Lançar pelo Telegram</b> e toque em ' +
    '<b>Conectar</b>. Você volta para cá já conectado.'
  );
}

function descreverLancamento(lanc, ctx) {
  const linhas = [];
  const receita = lanc.categoria === 'receita';
  linhas.push(receita ? '✅ <b>Receita lançada</b>' : '✅ <b>Despesa lançada</b>');
  linhas.push(`${esc(lanc.descricao)} · <b>${brl(lanc.valor)}</b>`);
  if (!receita) linhas.push(esc(rotuloCategoria(lanc.categoriaDespesa, ctx.categorias)));
  if (lanc.categoria === 'cartao_credito') {
    const cartao = (ctx.cartoes || []).find((c) => c.id === lanc.cartaoId);
    const nome = cartao ? cartao.nome : 'Cartão';
    if (lanc.tipoCartao === 'fixo') linhas.push(`💳 ${esc(nome)} · todo mês na fatura`);
    else if (lanc.parcelas > 1)
      linhas.push(`💳 ${esc(nome)} · ${lanc.parcelas}x de ${brl(lanc.valor / lanc.parcelas)}`);
    else linhas.push(`💳 ${esc(nome)} · fatura aberta`);
  } else {
    linhas.push(`🏦 ${esc(lanc.banco)}`);
    if (lanc.fixo)
      linhas.push(
        lanc.diaVencimento ? `🔁 Fixa mensal · vence dia ${lanc.diaVencimento}` : '🔁 Fixa mensal'
      );
  }
  linhas.push(`📅 ${dataBR(lanc.dataCompra)}`);
  linhas.push('\n<i>Aparece no app assim que ele abrir.</i>');
  return linhas.join('\n');
}

function tecladoLancamento(id, lanc) {
  const linha = [{ text: '↩️ Desfazer', callback_data: `u:${id}` }];
  if (lanc.categoria !== 'receita') linha.push({ text: '🏷️ Categoria', callback_data: `c:${id}` });
  return [linha];
}

const DICA_FORMATO = '🤔 Não entendi o valor. Mande a descrição e o valor, assim:\n' + EXEMPLOS;

const MOTIVOS = {
  vazio: DICA_FORMATO,
  sem_valor: DICA_FORMATO,
  varios_valores:
    '🤔 Achei mais de um número e não sei qual é o valor. Mande só um, por exemplo ' +
    '<code>aluguel 1800</code>.',
  data_invalida: '📅 Essa data não existe. Use <code>dd/mm</code>, por exemplo <code>05/10</code>.',
  parcelas: '💳 Dá para parcelar de 1 a 48 vezes.',
  valor_alto: '💸 Valor alto demais para um lançamento. Confira e mande de novo.',
  longo_demais: '✂️ Mensagem longa demais. Mande só a descrição e o valor.',
  sem_cartao:
    '💳 Você ainda não tem cartão cadastrado. Cadastre no app (Controle Financeiro → Cartões) ' +
    'ou mande sem "cartão" para sair da conta principal.',
};

// ─── vínculo (chamado pelo app, autenticado) ────────────────────────────────

async function criarCodigoVinculo(uid) {
  const codigo = gerarCodigo();
  await db()
    .collection('telegramCodigos')
    .doc(codigo)
    .set({
      uid,
      expiraEmMs: Date.now() + CODIGO_TTL_MS,
      expiraEm: expiraEm(Date.now() + CODIGO_TTL_MS),
      criadoEm: fieldValue().serverTimestamp(),
    });
  const user = botUsername();
  return {
    codigo,
    expiraEmMs: Date.now() + CODIGO_TTL_MS,
    url: user ? `https://t.me/${user}?start=${codigo}` : null,
    bot: user || null,
  };
}

async function statusVinculo(uid) {
  const snap = await db()
    .collection('users')
    .doc(uid)
    .collection('integracoes')
    .doc('telegram')
    .get();
  const d = snap.exists ? snap.data() || {} : {};
  return {
    conectado: !!d.chatId,
    nome: d.nome || null,
    username: d.username || null,
    conectadoEmMs: d.conectadoEmMs || null,
    bot: botUsername() || null,
  };
}

async function desvincular(uid) {
  const D = db();
  const ref = D.collection('users').doc(uid).collection('integracoes').doc('telegram');
  const snap = await ref.get();
  const d = snap.exists ? snap.data() || {} : {};
  if (d.chatId) {
    const link = D.collection('telegramLinks').doc(String(d.chatId));
    const ls = await link.get();
    // Só apaga o link se ele ainda aponta para este uid — o mesmo chat pode ter
    // sido ligado a outra conta depois.
    if (ls.exists && (ls.data() || {}).uid === uid) await link.delete();
  }
  // Mantém as categorias aprendidas: reconectar não deve esquecer o que o
  // usuário já ensinou.
  if (snap.exists) {
    await ref.set({ aprendidas: d.aprendidas || {} });
  }
  return { ok: true, chatId: d.chatId || null };
}

// ─── caixa de entrada (chamada pelo app, autenticado) ───────────────────────

async function listarInbox(uid) {
  const snap = await db()
    .collection('users')
    .doc(uid)
    .collection('telegramInbox')
    .orderBy('criadoEmMs', 'asc')
    .limit(100)
    .get();
  return snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
}

async function confirmarInbox(uid, ids) {
  const col = db().collection('users').doc(uid).collection('telegramInbox');
  const validos = (ids || []).filter((id) => typeof id === 'string' && RE_ID_INBOX.test(id));
  await Promise.all(validos.map((id) => col.doc(id).delete()));
  return validos.length;
}

// ─── webhook ────────────────────────────────────────────────────────────────

async function vincularPorCodigo(chat, from, codigo) {
  const D = db();
  const codRef = D.collection('telegramCodigos').doc(codigo);
  const cod = await codRef.get();
  const dados = cod.exists ? cod.data() || {} : null;
  if (!dados || !dados.uid || !(dados.expiraEmMs > Date.now())) {
    if (cod.exists) await codRef.delete();
    return tg.enviar(
      chat.id,
      '⌛ Esse link de conexão expirou ou já foi usado. Gere um novo no app ' +
        '(<b>Configurações → Lançar pelo Telegram</b>).'
    );
  }
  const uid = dados.uid;
  await codRef.delete();

  // Se esta conta já estava ligada a OUTRO chat, aquele perde o acesso.
  const integRef = D.collection('users').doc(uid).collection('integracoes').doc('telegram');
  const integ = await integRef.get();
  const anterior = integ.exists ? (integ.data() || {}).chatId : null;
  if (anterior && String(anterior) !== String(chat.id)) {
    await D.collection('telegramLinks').doc(String(anterior)).delete();
  }
  // E se este chat estava ligado a OUTRA conta, ela deixa de vê-lo como conectado.
  const linkRef = D.collection('telegramLinks').doc(String(chat.id));
  const linkAntigo = await linkRef.get();
  const uidAntigo = linkAntigo.exists ? (linkAntigo.data() || {}).uid : null;
  if (uidAntigo && uidAntigo !== uid) {
    const outro = D.collection('users').doc(uidAntigo).collection('integracoes').doc('telegram');
    const os = await outro.get();
    if (os.exists) await outro.set({ aprendidas: (os.data() || {}).aprendidas || {} });
  }

  await linkRef.set({ uid, criadoEm: fieldValue().serverTimestamp() });
  await integRef.set(
    {
      chatId: chat.id,
      nome: [from && from.first_name, from && from.last_name].filter(Boolean).join(' ') || null,
      username: (from && from.username) || null,
      conectadoEmMs: Date.now(),
    },
    { merge: true }
  );

  const ctx = await carregarContexto(uid);
  const principal = contaPrincipal(ctx.contas);
  const avisoConta = principal
    ? `Quando você não disser a conta, uso a sua conta principal: <b>${esc(principal.nome)}</b>.`
    : '⚠️ Você ainda não escolheu a <b>conta principal</b>. Escolha no app, na mesma tela ' +
      'onde conectou, para eu saber de onde sai o dinheiro.';
  return tg.enviar(chat.id, `🎉 <b>Conectado!</b>\n\n${avisoConta}\n\n${AJUDA}`);
}

async function linkDoChat(chatId) {
  const s = await db().collection('telegramLinks').doc(String(chatId)).get();
  return s.exists ? (s.data() || {}).uid || null : null;
}

async function acessoBloqueado(uid) {
  const b = await db().collection('users').doc(uid).collection('billing').doc('account').get();
  return computeAccess(b.exists ? b.data() : null).status === 'blocked';
}

async function gravarLancamento(uid, id, lanc, texto) {
  await db()
    .collection('users')
    .doc(uid)
    .collection('telegramInbox')
    .doc(id)
    .set({
      tipo: 'lancamento',
      lanc,
      texto: String(texto || '').slice(0, 300),
      criadoEmMs: Date.now(),
    });
  await db()
    .collection('users')
    .doc(uid)
    .collection('integracoes')
    .doc('telegram')
    .set({ ultimoId: id }, { merge: true });
}

// Completa conta/banco (despesa e receita) a partir do que o parser achou.
// Devolve null se não há conta para usar.
function resolverConta(lanc, ctx) {
  if (lanc.categoria === 'cartao_credito') return lanc;
  const caixa = contasDeCaixa(ctx.contas);
  const conta =
    (lanc.contaId && caixa.find((c) => c.id === lanc.contaId)) || contaPrincipal(ctx.contas);
  if (!conta) return null;
  return Object.assign({}, lanc, { contaId: conta.id, banco: conta.nome });
}

async function interpretarComReserva(texto, ctx) {
  let r = parser.interpretar(texto, ctx);
  const motor = iaAtiva();
  if (!motor) return r;
  try {
    if (!r.ok && (r.motivo === 'sem_valor' || r.motivo === 'varios_valores')) {
      // A IA só reescreve a frase no formato que o parser entende — quem decide
      // valor, conta e categoria continua sendo o parser. Assim um erro da IA
      // nunca inventa um campo que a regra não validaria.
      const canonico = await motor.reescrever(texto, ctx);
      if (canonico) {
        const r2 = parser.interpretar(canonico, ctx);
        if (r2.ok || r2.motivo === 'cartao_ambiguo') r = r2;
      }
    }
    if (r.ok && r.lanc.categoria !== 'receita' && !r.lanc.categoriaDespesa) {
      const v = await motor.categorizar(r.lanc.descricao, ctx.categorias);
      if (v && ctx.categorias.some((c) => c.v === v)) {
        r.lanc.categoriaDespesa = v;
        r.lanc.origemCategoria = 'ia';
      }
    }
  } catch (e) {
    console.error('[telegram] IA de reserva falhou', e && e.message);
  }
  return r;
}

async function concluirLancamento(chatId, uid, id, lanc, ctx, texto, editarMsgId) {
  const completo = resolverConta(lanc, ctx);
  if (!completo) {
    const msg =
      '🏦 Não sei de qual conta sai esse dinheiro. Escolha sua <b>conta principal</b> no app ' +
      '(<b>Configurações → Lançar pelo Telegram</b>) ou cite o banco na mensagem, ' +
      'por exemplo <code>itaú mercado 50</code>.';
    return editarMsgId ? tg.editar(chatId, editarMsgId, msg) : tg.enviar(chatId, msg);
  }
  await gravarLancamento(uid, id, completo, texto);
  const corpo = descreverLancamento(completo, ctx);
  const teclado = tecladoLancamento(id, completo);
  return editarMsgId
    ? tg.editar(chatId, editarMsgId, corpo, teclado)
    : tg.enviar(chatId, corpo, teclado);
}

async function tratarTexto(msg) {
  const chat = msg.chat;
  const texto = String(msg.text || '').trim();

  const mStart = texto.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9]{12}))?\s*$/);
  if (mStart && mStart[1]) return vincularPorCodigo(chat, msg.from, mStart[1]);

  const uid = await linkDoChat(chat.id);
  if (!uid) return tg.enviar(chat.id, textoNaoConectado());

  if (/^\/(start|ajuda|help)(@\w+)?\b/i.test(texto)) return tg.enviar(chat.id, AJUDA);
  if (/^\/desconectar(@\w+)?\b/i.test(texto)) {
    await desvincular(uid);
    return tg.enviar(chat.id, '👋 Desconectado. Para voltar, conecte de novo pelo app.');
  }

  if (await acessoBloqueado(uid)) {
    return tg.enviar(
      chat.id,
      '🔒 Sua assinatura do Appliquei está inativa, então não consigo lançar. ' +
        'Regularize no app e volte a mandar.'
    );
  }

  const limite = await rl.check({ scope: 'telegram', key: uid, windowMs: 60000, max: 20 });
  if (!limite.allowed) {
    return tg.enviar(chat.id, '⏳ Muitas mensagens em pouco tempo. Espere um minuto.');
  }

  if (/^\/desfazer(@\w+)?\b/i.test(texto)) {
    const integ = await db()
      .collection('users')
      .doc(uid)
      .collection('integracoes')
      .doc('telegram')
      .get();
    const ultimo = integ.exists ? (integ.data() || {}).ultimoId : null;
    if (!ultimo) return tg.enviar(chat.id, 'Não há lançamento recente para desfazer.');
    await desfazer(uid, ultimo);
    return tg.enviar(chat.id, '↩️ Último lançamento desfeito.');
  }
  if (texto.startsWith('/')) return tg.enviar(chat.id, AJUDA);

  const ctx = Object.assign({ hoje: new Date() }, await carregarContexto(uid));
  const r = await interpretarComReserva(texto, ctx);
  const id = idLancamento(chat.id, msg.message_id);

  if (!r.ok && r.motivo === 'cartao_ambiguo') {
    const pendId = id;
    await db()
      .collection('telegramPendentes')
      .doc(pendId)
      .set({
        uid,
        lanc: r.lanc,
        opcoes: r.opcoes,
        texto,
        expiraEmMs: Date.now() + PENDENTE_TTL_MS,
        expiraEm: expiraEm(Date.now() + PENDENTE_TTL_MS),
      });
    const teclado = r.opcoes.map((o, i) => [
      { text: `💳 ${o.nome}`, callback_data: `p:${pendId}:${i}` },
    ]);
    return tg.enviar(
      chat.id,
      `💳 Em qual cartão foi <b>${esc(r.lanc.descricao)}</b> de <b>${brl(r.lanc.valor)}</b>?`,
      teclado
    );
  }
  if (!r.ok) return tg.enviar(chat.id, MOTIVOS[r.motivo] || DICA_FORMATO);

  return concluirLancamento(chat.id, uid, id, r.lanc, ctx, texto, null);
}

// Remove o lançamento da caixa de entrada (se o app ainda não pegou) E deixa
// a ordem de desfazer (para o caso de já ter pego). As duas coisas sempre:
// saber se o app já aplicou exigiria olhar o JSON das transações, e um app
// lendo a caixa neste exato instante tornaria a resposta errada de qualquer jeito.
async function desfazer(uid, alvo) {
  const col = db().collection('users').doc(uid).collection('telegramInbox');
  await col.doc(alvo).delete();
  await col.doc(`desfazer_${alvo}`).set({ tipo: 'desfazer', alvo, criadoEmMs: Date.now() });
}

async function trocarCategoria(uid, alvo, categoriaDespesa, descricao) {
  const D = db();
  const col = D.collection('users').doc(uid).collection('telegramInbox');
  const ref = col.doc(alvo);
  const s = await ref.get();
  if (s.exists && (s.data() || {}).tipo === 'lancamento') {
    const d = s.data();
    await ref.set(Object.assign({}, d, { lanc: Object.assign({}, d.lanc, { categoriaDespesa }) }));
  }
  await col
    .doc(`cat_${alvo}`)
    .set({ tipo: 'categoria', alvo, categoriaDespesa, criadoEmMs: Date.now() });
  // Aprende: a próxima mensagem com esta palavra já vem nesta categoria.
  const palavra = parser
    .normalizar(descricao)
    .split(/[^a-z0-9]+/)
    .find((p) => p.length >= 3);
  if (palavra) {
    await D.collection('users')
      .doc(uid)
      .collection('integracoes')
      .doc('telegram')
      .set({ aprendidas: { [palavra]: categoriaDespesa } }, { merge: true });
  }
}

async function tratarBotao(cb) {
  const msg = cb.message || {};
  const chatId = msg.chat && msg.chat.id;
  const dados = String(cb.data || '');
  if (!chatId) return tg.responderBotao(cb.id);

  const uid = await linkDoChat(chatId);
  if (!uid) {
    await tg.responderBotao(cb.id, 'Este Telegram não está mais conectado.');
    return null;
  }

  const [acao, id, extra] = dados.split(':');
  if (!RE_ID_INBOX.test(id || '')) return tg.responderBotao(cb.id);
  // Cada botão só age sobre lançamentos DESTE chat: o id carrega o chat.
  if (!id.startsWith(`tg${String(chatId).replace(/[^0-9]/g, '')}_`)) {
    return tg.responderBotao(cb.id);
  }

  if (acao === 'u') {
    await desfazer(uid, id);
    await tg.responderBotao(cb.id, 'Desfeito');
    return tg.editar(
      chatId,
      msg.message_id,
      `↩️ <s>${esc(msg.text || 'Lançamento')}</s>\n\n<b>Desfeito.</b>`
    );
  }

  const ctx = await carregarContexto(uid);

  if (acao === 'c') {
    await tg.responderBotao(cb.id);
    const teclado = [];
    ctx.categorias.forEach((c, i) => {
      const botao = { text: c.label, callback_data: `k:${id}:${i}` };
      if (i % 2 === 0) teclado.push([botao]);
      else teclado[teclado.length - 1].push(botao);
    });
    teclado.push([{ text: '↩️ Desfazer lançamento', callback_data: `u:${id}` }]);
    return tg.editar(
      chatId,
      msg.message_id,
      `${esc(msg.text || '')}\n\n<b>Qual categoria?</b>`,
      teclado
    );
  }

  if (acao === 'k') {
    const cat = ctx.categorias[parseInt(extra, 10)];
    if (!cat) return tg.responderBotao(cb.id, 'Categoria não encontrada.');
    const inbox = await db().collection('users').doc(uid).collection('telegramInbox').doc(id).get();
    const pendente = inbox.exists && (inbox.data() || {}).tipo === 'lancamento';
    const lancAntes = pendente ? inbox.data().lanc : null;
    // Linha 2 da mensagem de confirmação é "Descrição · R$ valor".
    const descricao = lancAntes
      ? lancAntes.descricao
      : (String(msg.text || '').split('\n')[1] || '').split(' · ')[0];
    await trocarCategoria(uid, id, cat.v, descricao);
    await tg.responderBotao(cb.id, 'Categoria trocada');
    const teclado = [
      [
        { text: '↩️ Desfazer', callback_data: `u:${id}` },
        { text: '🏷️ Categoria', callback_data: `c:${id}` },
      ],
    ];
    // Ainda na caixa de entrada: redesenha a confirmação inteira com a
    // categoria nova. Já aplicado pelo app: o texto antigo fica, sem a pergunta,
    // e a categoria nova vai numa linha no fim.
    const corpo = lancAntes
      ? descreverLancamento(Object.assign({}, lancAntes, { categoriaDespesa: cat.v }), ctx)
      : esc(
          String(msg.text || '')
            .split('\nQual categoria?')[0]
            .split('\n\n🏷️ Categoria:')[0]
            .trim()
        ) + `\n\n🏷️ Categoria: <b>${esc(cat.label)}</b>`;
    return tg.editar(chatId, msg.message_id, corpo, teclado);
  }

  if (acao === 'p') {
    const pendRef = db().collection('telegramPendentes').doc(id);
    const ps = await pendRef.get();
    const pend = ps.exists ? ps.data() || {} : null;
    if (!pend || pend.uid !== uid || !(pend.expiraEmMs > Date.now())) {
      await tg.responderBotao(cb.id, 'Expirou. Mande a mensagem de novo.');
      return tg.editar(chatId, msg.message_id, '⌛ Expirou. Mande a mensagem de novo.');
    }
    const opcao = (pend.opcoes || [])[parseInt(extra, 10)];
    const cartao = opcao && ctx.cartoes.find((c) => c.id === opcao.id && !c.arquivado);
    if (!cartao) return tg.responderBotao(cb.id, 'Cartão não encontrado.');
    await pendRef.delete();
    await tg.responderBotao(cb.id);
    const lanc = Object.assign({}, pend.lanc, { cartaoId: cartao.id });
    return concluirLancamento(chatId, uid, id, lanc, ctx, pend.texto, msg.message_id);
  }

  return tg.responderBotao(cb.id);
}

/**
 * Processa um update do Telegram. Idempotente por update_id: o Telegram
 * reentrega quando não recebe 200 a tempo, e a segunda entrega não pode
 * lançar de novo nem responder duas vezes.
 */
async function processarUpdate(update) {
  if (!update || typeof update.update_id !== 'number') return { ignorado: 'sem_update' };
  const marca = db().collection('telegramUpdates').doc(String(update.update_id));
  if ((await marca.get()).exists) return { ignorado: 'repetido' };

  let r = null;
  if (update.message && update.message.chat) {
    // Só conversa privada: num grupo, qualquer membro lançaria na conta do dono.
    if (update.message.chat.type !== 'private') r = { ignorado: 'nao_privado' };
    else if (typeof update.message.text !== 'string') {
      await tg.enviar(update.message.chat.id, 'Por enquanto eu só entendo texto. ' + DICA_FORMATO);
      r = { ignorado: 'sem_texto' };
    } else {
      await tratarTexto(update.message);
      r = { ok: true };
    }
  } else if (update.callback_query) {
    await tratarBotao(update.callback_query);
    r = { ok: true };
  } else {
    r = { ignorado: 'tipo' };
  }
  // Marca DEPOIS de processar: se algo lançou no meio, o Telegram reentrega e
  // tentamos de novo. O id fixo do lançamento impede a duplicata.
  await marca.set({
    em: fieldValue().serverTimestamp(),
    expiraEmMs: Date.now() + 7 * 86400000,
    expiraEm: expiraEm(Date.now() + 7 * 86400000),
  });
  return r;
}

/** Confere o header que o Telegram manda com o secret_token do setWebhook. */
function segredoConfere(req) {
  const esperado = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const recebido = String((req.headers || {})['x-telegram-bot-api-secret-token'] || '');
  if (!esperado || recebido.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
}

module.exports = {
  processarUpdate,
  segredoConfere,
  criarCodigoVinculo,
  statusVinculo,
  desvincular,
  listarInbox,
  confirmarInbox,
  definirIA,
  // exportados para teste
  contaPrincipal,
  categoriasDoUsuario,
  idLancamento,
  RE_ID_INBOX,
};
