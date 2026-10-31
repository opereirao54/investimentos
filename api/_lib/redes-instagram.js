'use strict';

// Métricas do Instagram para o painel do admin (aba Redes sociais) e para a
// análise de conteúdo do marketing (scripts/metricas-instagram.js).
//
// Usa a "Instagram API com login do Instagram" (graph.instagram.com), só de
// leitura: permissões instagram_business_basic e
// instagram_business_manage_insights. O token é de longa duração (60 dias) e
// é renovado aqui mesmo (renovarSeVelho), guardado em redesSociais/instagram,
// coleção que as regras do Firestore não deixam o app ler.
//
// As funções de montar (resumirReel, resumirConta, rankear) são PURAS para
// ter teste; buscarInstagram() recebe o fetch por parâmetro.

const VERSAO = process.env.IG_API_VERSION || 'v23.0';
const BASE = 'https://graph.instagram.com';
// Token do login unificado (usuário do sistema do portfólio da Meta): fala com
// a graph.facebook.com e precisa do ID da conta do Instagram (IG_USER_ID).
// Não vence, então não passa por renovarSeVelho.
const BASE_FB = 'https://graph.facebook.com';
const DIA = 24 * 3600 * 1000;

// métricas de insight de um Reel; as que a conta ainda não tiver voltam vazias
const METRICAS_REEL = [
  'views',
  'reach',
  'likes',
  'comments',
  'saved',
  'shares',
  'total_interactions',
  'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time',
];

// série pela legenda (os combinados de 29/10: News, Explica e Appliquei)
function serieDaLegenda(legenda) {
  const s = (legenda || '').toLowerCase();
  if (s.includes('appliquei news')) return 'news';
  if (s.includes('appliquei explica')) return 'explica';
  if (/faltam \d+ dias|é hoje|lançamento/.test(s) && s.includes('appliquei')) return 'appliquei';
  return 'outros';
}

// primeira linha útil da legenda, para servir de título do Reel na tabela
function tituloDaLegenda(legenda) {
  const linha = (legenda || '').split('\n').find((l) => l.trim()) || '';
  return linha.trim().slice(0, 120);
}

function valorInsight(insights, nome) {
  const m = (insights || []).find((i) => i && i.name === nome);
  if (!m) return null;
  if (Array.isArray(m.values) && m.values.length) return Number(m.values[0].value) || 0;
  if (m.total_value && typeof m.total_value.value === 'number') return m.total_value.value;
  return null;
}

// taxa em % com uma casa; null quando não há base
function taxa(parte, base) {
  if (!base || parte == null) return null;
  return Math.round((parte / base) * 1000) / 10;
}

function resumirReel(media, insights) {
  const i = (n) => valorInsight(insights, n);
  const views = i('views');
  const alcance = i('reach');
  const curtidas =
    i('likes') != null ? i('likes') : media.like_count != null ? media.like_count : null;
  const comentarios =
    i('comments') != null
      ? i('comments')
      : media.comments_count != null
        ? media.comments_count
        : null;
  const salvos = i('saved');
  const compartilhamentos = i('shares');
  const tempoMedioMs = i('ig_reels_avg_watch_time');
  return {
    id: media.id,
    data: media.timestamp || null,
    link: media.permalink || null,
    capa: media.thumbnail_url || null,
    titulo: tituloDaLegenda(media.caption),
    serie: serieDaLegenda(media.caption),
    views,
    alcance,
    curtidas,
    comentarios,
    salvos,
    compartilhamentos,
    interacoes: i('total_interactions'),
    tempoMedioSeg: tempoMedioMs == null ? null : Math.round(tempoMedioMs / 100) / 10,
    // salvar e compartilhar são o que o algoritmo mais premia e o que diz se
    // o conteúdo serviu; medidos sobre o alcance (contas únicas)
    taxaSalvos: taxa(salvos, alcance),
    taxaCompartilhamentos: taxa(compartilhamentos, alcance),
    taxaEngajamento: taxa(
      (curtidas || 0) + (comentarios || 0) + (salvos || 0) + (compartilhamentos || 0),
      alcance
    ),
  };
}

function soma(lista, campo) {
  return lista.reduce((t, r) => t + (Number(r[campo]) || 0), 0);
}

function media(lista, campo) {
  const vals = lista.map((r) => r[campo]).filter((v) => typeof v === 'number');
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

// resumo geral e por série, para os cartões do painel
function resumirConta(conta, reels, agoraMs) {
  const ultimos30 = reels.filter((r) => r.data && agoraMs - Date.parse(r.data) <= 30 * DIA);
  const porSerie = {};
  for (const r of reels) {
    const s = (porSerie[r.serie] = porSerie[r.serie] || []);
    s.push(r);
  }
  const series = Object.keys(porSerie).map((k) => ({
    serie: k,
    reels: porSerie[k].length,
    viewsMedia: media(porSerie[k], 'views'),
    taxaSalvosMedia: media(porSerie[k], 'taxaSalvos'),
    taxaCompartilhamentosMedia: media(porSerie[k], 'taxaCompartilhamentos'),
    tempoMedioSeg: media(porSerie[k], 'tempoMedioSeg'),
  }));
  return {
    usuario: conta.username || null,
    seguidores: conta.followers_count != null ? conta.followers_count : null,
    publicacoes: conta.media_count != null ? conta.media_count : null,
    reels30d: ultimos30.length,
    views30d: soma(ultimos30, 'views'),
    alcance30d: soma(ultimos30, 'alcance'),
    salvos30d: soma(ultimos30, 'salvos'),
    compartilhamentos30d: soma(ultimos30, 'compartilhamentos'),
    viewsMedia30d: media(ultimos30, 'views'),
    taxaSalvosMedia30d: media(ultimos30, 'taxaSalvos'),
    taxaCompartilhamentosMedia30d: media(ultimos30, 'taxaCompartilhamentos'),
    tempoMedioSeg30d: media(ultimos30, 'tempoMedioSeg'),
    series,
  };
}

// pontuação para o ranking: compartilhar e salvar pesam mais que curtir
function pontuacao(r) {
  return (
    (r.compartilhamentos || 0) * 3 +
    (r.salvos || 0) * 2 +
    (r.comentarios || 0) * 1.5 +
    (r.curtidas || 0)
  );
}

function rankear(reels, n) {
  return reels
    .slice()
    .sort((a, b) => pontuacao(b) - pontuacao(a))
    .slice(0, n || 3)
    .map((r) => r.id);
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url);
  let corpo = null;
  try {
    corpo = await res.json();
  } catch {
    corpo = null;
  }
  if (!res.ok || (corpo && corpo.error)) {
    const msg = (corpo && corpo.error && corpo.error.message) || `HTTP ${res.status}`;
    const e = new Error(msg);
    e.code = (corpo && corpo.error && corpo.error.code) || res.status;
    throw e;
  }
  return corpo;
}

// Lê a conta, os Reels mais recentes e os insights de cada um.
async function buscarInstagram({ token, fetchImpl, limite, agoraMs, igUserId }) {
  if (!token) return { configurado: false };
  const f = fetchImpl || fetch;
  const base = igUserId ? BASE_FB : BASE;
  const eu = igUserId || 'me';
  const q = (p) =>
    `${base}/${VERSAO}/${p}${p.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  const conta = await getJson(f, q(`${eu}?fields=username,followers_count,media_count`));
  const lista = await getJson(
    f,
    q(
      `${eu}/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp,like_count,comments_count&limit=${limite || 30}`
    )
  );
  const midias = (lista.data || []).filter(
    (m) => m.media_product_type === 'REELS' || m.media_type === 'VIDEO'
  );
  const reels = [];
  for (const m of midias) {
    let insights = [];
    try {
      const r = await getJson(f, q(`${m.id}/insights?metric=${METRICAS_REEL.join(',')}`));
      insights = r.data || [];
    } catch {
      // Reel recém-postado ou métrica indisponível: fica com os contadores básicos
      insights = [];
    }
    reels.push(resumirReel(m, insights));
  }
  const agora = agoraMs || Date.now();
  return {
    configurado: true,
    atualizadoEm: new Date(agora).toISOString(),
    resumo: resumirConta(conta, reels, agora),
    reels,
    destaques: rankear(reels, 3),
  };
}

// Renova o token de longa duração quando ele tem mais de 30 dias (a Meta só
// renova token com mais de 24 h e ainda válido). Devolve o token a usar.
async function renovarSeVelho({ token, obtidoEmMs, fetchImpl, agoraMs }) {
  const agora = agoraMs || Date.now();
  if (!token || (obtidoEmMs && agora - obtidoEmMs < 30 * DIA)) return { token, renovado: false };
  const f = fetchImpl || fetch;
  const r = await getJson(
    f,
    `${BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`
  );
  return { token: r.access_token || token, renovado: true, expiraEmSeg: r.expires_in || null };
}

module.exports = {
  METRICAS_REEL,
  serieDaLegenda,
  tituloDaLegenda,
  resumirReel,
  resumirConta,
  rankear,
  buscarInstagram,
  renovarSeVelho,
};
