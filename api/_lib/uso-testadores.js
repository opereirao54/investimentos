'use strict';

// Uso do app na fase de testes — a lista "Quem está usando" do admin.
//
// PRIVACIDADE É A REGRA DESTE ARQUIVO: o admin vê QUANDO cada pessoa mexeu em
// cada parte do app, nunca O QUÊ. Do documento sincronizado
// (users/{uid}/data/main) só se lê `updatedAt` e `keyRevs` — o instante da
// última gravação de cada chave —, pedidos com fieldMask para que nem o
// conteúdo (`keys`: lançamentos, saldos, descrições) trafegue até aqui.
//
// O que isto NÃO enxerga: quem abre o app só para olhar, sem alterar nada.
// Contar dias de acesso exigiria registrar um sinal por visita — coleta nova,
// que pede aviso na Política de Privacidade. Fica para quando fizer falta.

// Partes do app que contam como uso de verdade. Preferências de tela (tema,
// aba aberta, menu recolhido) ficam de fora: mudam sozinhas e não dizem que a
// pessoa usou a ferramenta.
const AREAS = [
  ['futurorico_transacoes', 'Lançamentos'],
  ['appliquei_contas', 'Contas'],
  ['futurorico_cartoes', 'Cartões'],
  ['futurorico_compras', 'Investimentos'],
  ['appliquei_sonhos', 'Sonhos'],
  ['appliquei_bens', 'Bens'],
  ['appliquei_jornada_progresso', 'Jornada'],
];

const DIA_MS = 24 * 60 * 60 * 1000;
const ATIVO_ATE_DIAS = 3;
const ESFRIANDO_ATE_DIAS = 14;
const LOTE = 100;

function msDe(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Situação a partir do último uso: 'ativo' (até 3 dias), 'esfriando' (até 14)
 * ou 'parado' (mais que isso, ou nunca usou nenhuma área).
 */
function situacaoDoUso(ultimoUsoMs, agoraMs) {
  if (!ultimoUsoMs) return 'parado';
  const dias = (agoraMs - ultimoUsoMs) / DIA_MS;
  if (dias <= ATIVO_ATE_DIAS) return 'ativo';
  if (dias <= ESFRIANDO_ATE_DIAS) return 'esfriando';
  return 'parado';
}

/**
 * Áreas usadas, cada uma com a data da última alteração, a partir de
 * `keyRevs` ({ chave: ms }) — a mais recente primeiro. `ultimoUsoMs` é a maior.
 */
function resumirUso(keyRevs) {
  const revs = keyRevs || {};
  const areas = [];
  AREAS.forEach(([chave, rotulo]) => {
    const rev = msDe(revs[chave]);
    if (rev) areas.push({ area: rotulo, ms: rev });
  });
  return finalizarAreas(areas);
}

function finalizarAreas(areas) {
  areas.sort((a, b) => b.ms - a.ms);
  return { areas, ultimoUsoMs: areas.length ? areas[0].ms : 0 };
}

/**
 * Telegram: a data do último lançamento pelo bot (integracoes/telegramAlertas
 * .ultimaAtividadeMs) conta como uso. Só conectado, sem lançar nada ainda,
 * aparece com a data da conexão e `soConectou`, mas não conta como uso.
 */
function areaTelegram(tg, tgAtiv) {
  if (!tg || !tg.chatId) return null;
  const lancou = msDe(tgAtiv && tgAtiv.ultimaAtividadeMs);
  if (lancou) return { area: 'Telegram', ms: lancou };
  return { area: 'Telegram', ms: msDe(tg.conectadoEmMs), soConectou: true };
}

async function lerEmLotes(D, refs, campos) {
  const out = [];
  for (let i = 0; i < refs.length; i += LOTE) {
    const parte = refs.slice(i, i + LOTE);
    if (!parte.length) continue;
    const snaps = await D.getAll(...parte, { fieldMask: campos });
    snaps.forEach((s) => out.push(s));
  }
  return out;
}

/**
 * Monta a lista. `deps` = { db, auth }. Testador = quem resgatou um convite;
 * os demais aparecem também (a equipe, contas antigas), marcados como tal.
 */
async function listarUso(deps, agoraMs) {
  const agora = agoraMs || Date.now();
  const D = deps.db();

  const page = await deps.auth().listUsers(1000);
  const usuarios = page.users || [];

  const convitePorUid = new Map();
  const snapCv = await D.collection('convites').where('status', '==', 'usado').get();
  (snapCv.docs || []).forEach((d) => {
    const x = d.data() || {};
    if (x.usadoPor)
      convitePorUid.set(x.usadoPor, { codigo: x.codigo || d.id, nota: x.nota || null });
  });

  const refsDados = usuarios.map((u) =>
    D.collection('users').doc(u.uid).collection('data').doc('main')
  );
  const integ = (uid, doc) => D.collection('users').doc(uid).collection('integracoes').doc(doc);
  const dados = await lerEmLotes(D, refsDados, ['updatedAt', 'keyRevs']);
  const tgs = await lerEmLotes(
    D,
    usuarios.map((u) => integ(u.uid, 'telegram')),
    ['chatId', 'conectadoEmMs']
  );
  const tgAtivs = await lerEmLotes(
    D,
    usuarios.map((u) => integ(u.uid, 'telegramAlertas')),
    ['ultimaAtividadeMs']
  );

  const itens = usuarios.map((u, i) => {
    const doc = dados[i] && dados[i].exists ? dados[i].data() || {} : {};
    const tg = tgs[i] && tgs[i].exists ? tgs[i].data() || {} : {};
    const tgAtiv = tgAtivs[i] && tgAtivs[i].exists ? tgAtivs[i].data() || {} : {};
    const doApp = resumirUso(doc.keyRevs).areas;
    const tgArea = areaTelegram(tg, tgAtiv);
    const { areas } = finalizarAreas(tgArea ? doApp.concat(tgArea) : doApp);
    // Conectar o Telegram sem lançar nada não é uso.
    const usos = areas.filter((a) => !a.soConectou);
    const ultimoUsoMs = usos.length ? usos[0].ms : 0;
    const cv = convitePorUid.get(u.uid) || null;
    return {
      uid: u.uid,
      email: u.email || null,
      nota: cv ? cv.nota : null,
      convite: cv ? cv.codigo : null,
      testador: !!cv,
      suspenso: !!u.disabled,
      criadoMs: u.metadata && u.metadata.creationTime ? Date.parse(u.metadata.creationTime) : 0,
      ultimoLoginMs:
        u.metadata && u.metadata.lastSignInTime ? Date.parse(u.metadata.lastSignInTime) : 0,
      ultimoUsoMs,
      ultimoSinalMs: msDe(doc.updatedAt),
      areas,
      situacao: situacaoDoUso(ultimoUsoMs, agora),
    };
  });
  itens.sort((a, b) => (b.ultimoUsoMs || 0) - (a.ultimoUsoMs || 0));
  return { geradoEm: agora, truncado: !!page.pageToken, itens };
}

module.exports = { listarUso, resumirUso, situacaoDoUso, AREAS };
