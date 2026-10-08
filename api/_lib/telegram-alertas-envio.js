'use strict';

// Alertas do bot do Telegram — o ENVIO. As regras (o que avisar) estão em
// telegram-alertas.js; aqui fica o resto:
//   - a rodada agendada (GitHub Actions → POST /api/user?op=telegram-alertas)
//   - as preferências de cada usuário (o que está ligado, pausa geral)
//   - o registro do que já foi enviado, para nada sair duas vezes
//   - o painel 🔔 Alertas e o botão 🔕 de cada aviso
//
// Estado por usuário em users/{uid}/integracoes/telegramAlertas — documento
// separado do vínculo (integracoes/telegram) porque desconectar reescreve o
// vínculo, e as preferências devem sobreviver a desconectar e reconectar.
//   desligados  {tipo: true}        tipos que o usuário desligou
//   pausado     bool                nada sai enquanto true
//   enviados    {chave: ms}         avisos já enviados (limpos após 90 dias)
//   janelas     {'aaaa-mm-dd:manha': ms}  janela já tratada naquele dia
//   pagaveis    {k: {...}}          alvos do botão "Já paguei" (etapa 2b)
//   apresentado bool                a 1ª mensagem já explicou como desligar
//   bloqueadoEmMs ms                o usuário bloqueou o bot (Telegram 403)
//   semeados    {tipo: true}        tipos já avaliados uma vez (ver silenciosoNaPrimeira)
//   ultimaAtividadeMs ms            último lançamento feito pelo Telegram (lembrete)

const crypto = require('crypto');
const { db, fieldValue } = require('./firebase-admin');
const { computeAccess } = require('./access');
const tg = require('./telegram-api');
const parser = require('./telegram-parser');
const C = require('./telegram-consultas');
const A = require('./telegram-alertas');

const PAGINA = 25;
const PRAZO_MS = 9000; // a function tem 15 s; sobra folga para a resposta
const MAX_AVISOS = 12; // mensagem do Telegram tem teto de 4096 caracteres
const ENVIADOS_TTL_MS = 90 * 86400000;
const JANELAS_TTL_MS = 10 * 86400000;
const BLOQUEIO_RETENTA_MS = 7 * 86400000;

function refEstado(uid) {
  return db().collection('users').doc(uid).collection('integracoes').doc('telegramAlertas');
}

function lerJSON(s, padrao) {
  try {
    const v = JSON.parse(s);
    return v == null ? padrao : v;
  } catch (_) {
    return padrao;
  }
}

/** Rótulo de cada categoria de despesa, inclusive as ocultas e as criadas. */
function rotulosCategorias(custom) {
  const r = {};
  parser.CATEGORIAS_PADRAO.forEach((c) => (r[c.v] = c.label));
  (custom || []).forEach((c) => {
    if (c && c.v && c.label) r[c.v] = c.label;
  });
  r.__sem_categoria__ = '🏷️ Sem categoria';
  return r;
}

/** As chaves sincronizadas do app que bot e alertas leem, já parseadas. */
async function lerDadosUsuario(uid) {
  const snap = await db().collection('users').doc(uid).collection('data').doc('main').get();
  const doc = snap.exists ? snap.data() || {} : {};
  const keys = doc.keys || {};
  const lista = (k) => {
    const v = lerJSON(keys[k], []);
    return Array.isArray(v) ? v : [];
  };
  const categoriasCustom = lista('futurorico_categoriasDespesa');
  return {
    transacoes: lista('futurorico_transacoes'),
    contas: lista('appliquei_contas'),
    cartoes: lista('futurorico_cartoes'),
    sonhos: lista('appliquei_sonhos'),
    // Ajustes manuais do saldo trazido entre meses (objeto, não lista).
    saldoCarregado: (() => {
      const v = lerJSON(keys.futurorico_saldoCarregado, {});
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    })(),
    categoriasCustom,
    rotulos: rotulosCategorias(categoriasCustom),
    atualizadoEmMs:
      doc.updatedAt && typeof doc.updatedAt.toMillis === 'function'
        ? doc.updatedAt.toMillis()
        : null,
  };
}

async function lerEstado(uid) {
  const s = await refEstado(uid).get();
  return s.exists ? s.data() || {} : {};
}

function ligado(estado, tipo) {
  return !(estado.desligados && estado.desligados[tipo]);
}

// ─── preferências ───────────────────────────────────────────────────────────

async function definirTipo(uid, tipo, ligar) {
  if (!A.TIPO_POR_ID[tipo]) return false;
  await refEstado(uid).set(
    { desligados: { [tipo]: ligar ? fieldValue().delete() : true } },
    { merge: true }
  );
  return true;
}

async function definirPausa(uid, pausar) {
  await refEstado(uid).set({ pausado: !!pausar }, { merge: true });
}

function textoPainel(estado) {
  const l = ['🔔 <b>Seus alertas</b>', 'Toque num alerta para ligar ou desligar.', ''];
  l.push(`☀️ Os da manhã saem por volta das ${A.JANELAS.manha.de}h.`);
  l.push(`🌙 Os da noite, por volta das ${A.JANELAS.noite.de}h.`);
  l.push('No máximo uma mensagem em cada horário, juntando tudo.');
  if (estado.pausado) l.push('\n⏸️ <b>Pausados:</b> nenhum alerta sai até você retomar.');
  return l.join('\n');
}

function tecladoPainel(estado) {
  const linhas = A.TIPOS.map((t) => [
    {
      text: `${ligado(estado, t.id) ? '✅' : '⬜'} ${t.janela === 'manha' ? '☀️' : '🌙'} ${t.rotulo}`,
      callback_data: `a:t:${t.id}`,
    },
  ]);
  linhas.push([
    estado.pausado
      ? { text: '▶️ Retomar todos', callback_data: 'a:p:0' }
      : { text: '⏸️ Pausar todos', callback_data: 'a:p:1' },
  ]);
  return linhas;
}

// ─── a mensagem ─────────────────────────────────────────────────────────────

function dataHoraBR(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function idPagavel(chave) {
  return crypto.createHash('sha1').update(chave).digest('base64url').slice(0, 10);
}

function encurtar(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Texto + teclado de uma rodada. `avisos` já filtrados (ligados, inéditos).
 * Devolve também os pagáveis, que o envio grava para o botão "Já paguei".
 */
function montarMensagem(avisos, janela, estado, dados) {
  const mostrados = avisos.slice(0, MAX_AVISOS);
  const l = [A.JANELAS[janela].titulo];
  l.push(mostrados.map((a) => a.texto).join('\n\n'));
  if (avisos.length > mostrados.length)
    l.push(`➕ Mais ${avisos.length - mostrados.length} no app.`);

  const rodape = [];
  if (dados.atualizadoEmMs)
    rodape.push(`<i>Dados do app de ${dataHoraBR(dados.atualizadoEmMs)}.</i>`);
  if (!estado.apresentado)
    rodape.push(
      '<i>Estes são os alertas automáticos do Appliquei. Para escolher quais receber, ' +
        'toque em 🔕 abaixo ou em 🔔 Alertas.</i>'
    );
  let texto = l.join('\n\n');
  if (rodape.length) texto += '\n\n' + rodape.join('\n');

  const teclado = [];
  const pagaveis = {};
  mostrados
    .filter((a) => a.pagar && a.pagar.alvos && a.pagar.alvos.length)
    .slice(0, 6)
    .forEach((a) => {
      const k = idPagavel(a.chave);
      pagaveis[k] = { rotulo: a.pagar.rotulo, alvos: a.pagar.alvos, criadoEmMs: Date.now() };
      teclado.push([
        { text: `✅ Já paguei: ${encurtar(a.pagar.rotulo, 28)}`, callback_data: `pg:${k}` },
      ]);
    });
  // Um 🔕 por TIPO presente, dois por linha.
  const tipos = [...new Set(mostrados.map((a) => a.tipo))];
  for (let i = 0; i < tipos.length; i += 2) {
    teclado.push(
      tipos.slice(i, i + 2).map((t) => ({
        text: `🔕 ${A.TIPO_POR_ID[t].rotulo}`,
        callback_data: `a:o:${t}`,
      }))
    );
  }
  teclado.push([{ text: '🔔 Ajustar alertas', callback_data: 'a:v' }]);
  return { texto, teclado, pagaveis };
}

// ─── a rodada ───────────────────────────────────────────────────────────────

// Limpeza do registro, na mesma escrita do envio: chaves velhas viram delete.
function limpeza(estado, agoraMs) {
  const enviados = {};
  Object.entries(estado.enviados || {}).forEach(([k, ms]) => {
    if (!(agoraMs - ms < ENVIADOS_TTL_MS)) enviados[k] = fieldValue().delete();
  });
  const janelas = {};
  Object.entries(estado.janelas || {}).forEach(([k, ms]) => {
    if (!(agoraMs - ms < JANELAS_TTL_MS)) janelas[k] = fieldValue().delete();
  });
  const pagaveis = {};
  Object.entries(estado.pagaveis || {}).forEach(([k, p]) => {
    if (!(agoraMs - ((p && p.criadoEmMs) || 0) < JANELAS_TTL_MS))
      pagaveis[k] = fieldValue().delete();
  });
  return { enviados, janelas, pagaveis };
}

// Os tipos da janela ficam "semeados" na primeira avaliação, mesmo sem aviso.
function semeadosDaJanela(janela) {
  const out = {};
  A.TIPOS.filter((t) => t.janela === janela).forEach((t) => (out[t.id] = true));
  return out;
}

async function marcarJanela(uid, chaveJanela, extra) {
  await refEstado(uid).set(Object.assign({ janelas: { [chaveJanela]: Date.now() } }, extra || {}), {
    merge: true,
  });
}

/** Lançamento feito pelo Telegram conta como atividade para o lembrete. */
async function registrarAtividade(uid) {
  await refEstado(uid).set({ ultimaAtividadeMs: Date.now() }, { merge: true });
}

async function acessoBloqueado(uid) {
  const b = await db().collection('users').doc(uid).collection('billing').doc('account').get();
  return computeAccess(b.exists ? b.data() : null).status === 'blocked';
}

/** Trata um usuário na janela. Devolve o motivo (para o log da rodada). */
async function processarUsuario(chatId, uid, agora, janela) {
  const chaveJanela = `${C.ymdLocal(agora)}:${janela}`;
  const estado = await lerEstado(uid);
  if (estado.janelas && estado.janelas[chaveJanela]) return 'ja_tratado';
  if (estado.bloqueadoEmMs && Date.now() - estado.bloqueadoEmMs < BLOQUEIO_RETENTA_MS)
    return 'bot_bloqueado';
  if (estado.pausado) {
    await marcarJanela(uid, chaveJanela);
    return 'pausado';
  }
  if (await acessoBloqueado(uid)) {
    await marcarJanela(uid, chaveJanela);
    return 'assinatura';
  }

  const dados = await lerDadosUsuario(uid);
  dados.ultimaAtividadeMs = estado.ultimaAtividadeMs || null;
  const enviados = estado.enviados || {};
  const semeados = estado.semeados || {};
  const todos = A.avaliar(dados, agora, janela);
  // 1ª avaliação de um tipo "de evento": o que já é verdade vira histórico.
  const silenciados = {};
  todos
    .filter((a) => a.silenciosoNaPrimeira && !semeados[a.tipo])
    .forEach((a) => (silenciados[a.chave] = Date.now()));
  const avisos = todos.filter(
    (a) => ligado(estado, a.tipo) && !enviados[a.chave] && !silenciados[a.chave]
  );
  const semear = { semeados: semeadosDaJanela(janela), enviados: silenciados };
  if (!avisos.length) {
    await marcarJanela(uid, chaveJanela, semear);
    return 'nada';
  }

  const msg = montarMensagem(avisos, janela, estado, dados);
  const r = await tg.enviar(chatId, msg.texto, msg.teclado);
  if (!r || !r.ok) {
    if (r && r.error_code === 403) {
      await refEstado(uid).set({ bloqueadoEmMs: Date.now() }, { merge: true });
      return 'bot_bloqueado';
    }
    // Falha passageira: não marca nada, a próxima rodada da janela tenta de novo.
    return 'falha_envio';
  }

  const agoraMs = Date.now();
  const lim = limpeza(estado, agoraMs);
  const novosEnviados = Object.assign({}, lim.enviados, silenciados);
  avisos.slice(0, MAX_AVISOS).forEach((a) => {
    novosEnviados[a.chave] = agoraMs;
    (a.implica || []).forEach((k) => (novosEnviados[k] = agoraMs));
  });
  await refEstado(uid).set(
    {
      enviados: novosEnviados,
      janelas: Object.assign({}, lim.janelas, { [chaveJanela]: agoraMs }),
      pagaveis: Object.assign({}, lim.pagaveis, msg.pagaveis),
      apresentado: true,
      semeados: semear.semeados,
      bloqueadoEmMs: fieldValue().delete(),
    },
    { merge: true }
  );
  return 'enviado';
}

/**
 * Uma página da rodada. O agendador chama de novo com `proximo` até vir null.
 *
 * @param {object} [o]
 * @param {string} [o.cursor]   id do último chat tratado na página anterior
 * @param {string} [o.janela]   força a janela (teste manual pelo "Run workflow")
 * @param {Date}   [o.agoraReal]
 */
async function rodar(o) {
  o = o || {};
  const inicio = Date.now();
  const agora = C.agoraBrasilia(o.agoraReal);
  const janela = A.JANELAS[o.janela] ? o.janela : A.janelaDaHora(agora);
  if (!janela) return { janela: null, processados: 0, motivos: {}, proximo: null };

  let q = db().collection('telegramLinks').orderBy('__name__').limit(PAGINA);
  if (o.cursor) q = q.startAfter(String(o.cursor));
  const snap = await q.get();
  const motivos = {};
  let ultimo = null;
  let processados = 0;
  for (const doc of snap.docs) {
    if (Date.now() - inicio > PRAZO_MS) break;
    const uid = (doc.data() || {}).uid;
    let motivo = 'sem_uid';
    if (uid) {
      try {
        motivo = await processarUsuario(doc.id, uid, agora, janela);
      } catch (e) {
        // Um usuário com dado estranho não pode derrubar a rodada dos outros.
        console.error('[telegram-alertas]', uid, e && e.message);
        motivo = 'erro';
      }
    }
    motivos[motivo] = (motivos[motivo] || 0) + 1;
    ultimo = doc.id;
    processados++;
  }
  const acabou = processados === snap.docs.length && snap.docs.length < PAGINA;
  return { janela, processados, motivos, proximo: acabou ? null : ultimo || o.cursor || null };
}

module.exports = {
  rodar,
  lerDadosUsuario,
  rotulosCategorias,
  lerEstado,
  definirTipo,
  definirPausa,
  registrarAtividade,
  textoPainel,
  tecladoPainel,
  montarMensagem,
  refEstado,
  // para teste
  processarUsuario,
  idPagavel,
};
