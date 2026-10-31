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
// pedidas à parte: nem toda conta/versão da API tem estas para Reels
const METRICAS_REEL_EXTRAS = ['follows', 'profile_visits'];
// da conta, somadas nos últimos 30 dias
const METRICAS_CONTA = ['profile_views', 'website_clicks', 'accounts_engaged', 'reach'];

const DURACOES = require('./reels-duracoes.json').reels;
const normalizar = (t) =>
  (t || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9$ ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// duração (s) pelo começo do título; null se o Reel não está no registro
function duracaoDoTitulo(titulo, registro) {
  const t = normalizar(titulo);
  const d = (registro || DURACOES).find((r) => t.startsWith(normalizar(r.inicio)));
  return d ? d.seg : null;
}

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
  const tempoMedioSeg = tempoMedioMs == null ? null : Math.round(tempoMedioMs / 100) / 10;
  const titulo = tituloDaLegenda(media.caption);
  const duracaoSeg = duracaoDoTitulo(titulo);
  return {
    id: media.id,
    data: media.timestamp || null,
    link: media.permalink || null,
    capa: media.thumbnail_url || null,
    titulo,
    serie: serieDaLegenda(media.caption),
    duracaoSeg,
    views,
    alcance,
    curtidas,
    comentarios,
    salvos,
    compartilhamentos,
    interacoes: i('total_interactions'),
    tempoMedioSeg,
    // retenção: quanto do vídeo, em média, cada view assistiu (pode passar de
    // 100% quando a pessoa reassiste). Precisa da duração do registro.
    pctAssistido:
      duracaoSeg && tempoMedioSeg != null ? Math.round((tempoMedioSeg / duracaoSeg) * 100) : null,
    // views por conta alcançada: acima de 1, gente reassistindo ou voltando
    viewsPorPessoa: views != null && alcance ? Math.round((views / alcance) * 100) / 100 : null,
    seguiu: i('follows'),
    visitasPerfil: i('profile_visits'),
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

function pct(parte, total) {
  return total ? Math.round((parte / total) * 1000) / 10 : null;
}

// número geral de todos os Reels lidos (não só os de 30 dias)
function consolidar(reels) {
  const datas = reels
    .map((r) => r.data)
    .filter(Boolean)
    .sort();
  const alcance = soma(reels, 'alcance');
  return {
    reels: reels.length,
    desde: datas[0] || null,
    views: soma(reels, 'views'),
    alcanceSomado: alcance,
    curtidas: soma(reels, 'curtidas'),
    comentarios: soma(reels, 'comentarios'),
    salvos: soma(reels, 'salvos'),
    compartilhamentos: soma(reels, 'compartilhamentos'),
    seguiu: soma(reels, 'seguiu'),
    visitasPerfil: soma(reels, 'visitasPerfil'),
    viewsMedia: media(reels, 'views'),
    tempoMedioSeg: media(reels, 'tempoMedioSeg'),
    pctAssistidoMedio: media(reels, 'pctAssistido'),
    // taxas sobre o total (ponderadas pelo alcance), não média de taxas
    taxaSalvos: pct(soma(reels, 'salvos'), alcance),
    taxaCompartilhamentos: pct(soma(reels, 'compartilhamentos'), alcance),
    taxaEngajamento: pct(
      soma(reels, 'curtidas') +
        soma(reels, 'comentarios') +
        soma(reels, 'salvos') +
        soma(reels, 'compartilhamentos'),
      alcance
    ),
  };
}

// resumo geral e por série, para os cartões do painel
function resumirConta(conta, reels, agoraMs, conta30d) {
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
    pctAssistidoMedio: media(porSerie[k], 'pctAssistido'),
    seguiu: soma(porSerie[k], 'seguiu'),
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
    pctAssistidoMedio30d: media(ultimos30, 'pctAssistido'),
    viewsPorPessoa30d: media(ultimos30, 'viewsPorPessoa'),
    seguiuPorReels30d: soma(ultimos30, 'seguiu'),
    visitasPerfilReels30d: soma(ultimos30, 'visitasPerfil'),
    // da conta inteira (não só dos Reels), quando a API fornece
    visitasPerfil30d: (conta30d && conta30d.profile_views) ?? null,
    cliquesLink30d: (conta30d && conta30d.website_clicks) ?? null,
    contasEngajadas30d: (conta30d && conta30d.accounts_engaged) ?? null,
    alcanceConta30d: (conta30d && conta30d.reach) ?? null,
    consolidado: consolidar(reels),
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

// Um pedido com todas as métricas; se a API recusar o conjunto (basta uma
// métrica que a conta não tenha), pede uma por uma e fica com as que vierem.
async function insightsDoReel(f, q, id) {
  let dados = [];
  try {
    dados = (await getJson(f, q(`${id}/insights?metric=${METRICAS_REEL.join(',')}`))).data || [];
  } catch {
    for (const m of METRICAS_REEL) {
      try {
        dados = dados.concat((await getJson(f, q(`${id}/insights?metric=${m}`))).data || []);
      } catch {
        // métrica indisponível para este Reel (ou recém-postado)
      }
    }
  }
  for (const m of METRICAS_REEL_EXTRAS) {
    try {
      dados = dados.concat((await getJson(f, q(`${id}/insights?metric=${m}`))).data || []);
    } catch {
      // não disponível para Reels nesta conta/versão
    }
  }
  return dados;
}

// Totais da conta nos últimos 30 dias (visitas ao perfil, cliques no link…).
async function insightsDaConta(f, q, eu, agoraMs) {
  const ate = Math.floor(agoraMs / 1000);
  const desde = ate - 29 * 24 * 3600;
  const out = {};
  for (const m of METRICAS_CONTA) {
    try {
      const r = await getJson(
        f,
        q(
          `${eu}/insights?metric=${m}&period=day&metric_type=total_value&since=${desde}&until=${ate}`
        )
      );
      const v = valorInsight(r.data, m);
      if (v != null) out[m] = v;
    } catch {
      // conta pequena ou métrica indisponível: fica sem
    }
  }
  return out;
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
      `${eu}/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp,like_count,comments_count&limit=${limite || 50}`
    )
  );
  const midias = (lista.data || []).filter(
    (m) => m.media_product_type === 'REELS' || m.media_type === 'VIDEO'
  );
  const reels = [];
  for (const m of midias) {
    reels.push(resumirReel(m, await insightsDoReel(f, q, m.id)));
  }
  const agora = agoraMs || Date.now();
  const conta30d = await insightsDaConta(f, q, eu, agora);
  return {
    configurado: true,
    atualizadoEm: new Date(agora).toISOString(),
    resumo: resumirConta(conta, reels, agora, conta30d),
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
  duracaoDoTitulo,
  serieDaLegenda,
  tituloDaLegenda,
  resumirReel,
  resumirConta,
  rankear,
  buscarInstagram,
  renovarSeVelho,
};
