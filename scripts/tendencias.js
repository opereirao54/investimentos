#!/usr/bin/env node
'use strict';

// Google Trends para escolher a pauta do dia (um conteúdo por vez, decidido
// no dia: passa pelo filtro do bolso antes de virar Reel).
//
//   npm run tendencias                         pesquisas em alta no Brasil agora
//   npm run tendencias -- "13º salário" "pix"  curva de 12 meses + buscas em alta
//
// Só lê; não grava nada. Os números do Trends são relativos (0 a 100 = pico do
// período), não quantidade de pessoas.

const { spawnSync } = require('child_process');

// Atrás de proxy (sessão na nuvem), o fetch do Node só usa HTTPS_PROXY com
// NODE_USE_ENV_PROXY=1. Reabre o próprio script com ele ligado.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ['--no-warnings', __filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status == null ? 1 : r.status);
}

const BASE = 'https://trends.google.com';
const UA = 'Mozilla/5.0 (compatible; appliquei-tendencias)';
const TZ = 180; // Brasília (UTC-3), em minutos

// Assuntos que mexem no bolso de quem vive de salário (o filtro do bolso).
const BOLSO =
  /sal[aá]rio|13[ºo°]|d[eé]cimo terceiro|\bpix\b|pre[cç]o|infla[cç][aã]o|ipca|d[oó]lar|gasolina|combust[ií]vel|diesel|juros|selic|copom|imposto|receita federal|imposto de renda|inss|fgts|black ?friday|conta de luz|bandeira tarif|aluguel|cart[aã]o de cr[eé]dito|fatura|financiamento|aposentad|bolsa fam[ií]lia|aux[ií]lio|p[eé] de meia|ipva|iptu|cesta b[aá]sica|tarifa|d[ií]vida|serasa|desenrola|poupan[cç]a|\bcdb\b|tesouro direto|abono|pis\b|seguro.desemprego|dia [uú]til|feriado|sal[aá]rio m[ií]nimo/i;

// Categorias da página "Em alta" do Trends (campo 10 de cada tendência).
const CAT = { FINANCAS: 3, POLITICA: 14, ESPORTES: 17 };

// A página "Em alta" (trends.google.com/trending) traz a lista completa das
// últimas 24 h embutida no HTML (bloco ds:0), com volume, alta e termos
// relacionados. O RSS público só traz ~10 itens, por isso não serve.
async function listaEmAlta(horas) {
  const res = await fetch(`${BASE}/trending?geo=BR&hl=pt-BR&hours=${horas}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`página Em alta: HTTP ${res.status}`);
  const html = await res.text();
  const i = html.indexOf("AF_initDataCallback({key: 'ds:0'");
  const ini = i < 0 ? -1 : html.indexOf('data:', i);
  const fim = ini < 0 ? -1 : html.indexOf(', sideChannel', ini);
  if (fim < 0) throw new Error('o Google mudou a página Em alta; mande o print enquanto eu ajusto');
  const lista = JSON.parse(html.slice(ini + 5, fim))[1] || [];
  return lista.map((t) => {
    const relacionados = t[9] || [];
    const categorias = t[10] || [];
    const deBolso =
      categorias.includes(CAT.FINANCAS) ||
      [t[0], ...relacionados.slice(0, 8)].some((q) => BOLSO.test(q));
    return {
      termo: t[0],
      volume: t[6] || 0,
      alta: t[8] || 0,
      inicio: t[3] && t[3][0] ? new Date(t[3][0] * 1000) : null,
      ativa: t[4] == null,
      relacionados,
      categorias,
      deBolso,
      politica: categorias.includes(CAT.POLITICA),
    };
  });
}

function volumeBR(n) {
  if (n >= 1e6) return `${n / 1e6} mi+`;
  if (n >= 1e3) return `${n / 1e3} mil+`;
  return `${n}+`;
}

function linha(t) {
  const h = t.inicio ? Math.max(0, Math.round((Date.now() - t.inicio) / 36e5)) : null;
  const quando = h == null ? '' : ` · há ${h} h`;
  const marca = t.politica ? '⚠️ ' : t.deBolso ? '💰 ' : '   ';
  console.log(
    `${marca}${t.termo}  ${volumeBR(t.volume)} buscas · ↑${t.alta}%${quando}${t.ativa ? ' · ativa' : ''}`
  );
  const rel = t.relacionados.filter((q) => q !== t.termo).slice(0, 4);
  if (rel.length) console.log(`      ${rel.join(' · ')}`);
}

async function emAlta() {
  const lista = await listaEmAlta(24);
  const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`Em alta no Brasil · últimas 24 h · ${lista.length} tendências · ${hora}`);
  console.log(
    '💰 de bolso · ⚠️ política (fora, pelo combinado) · depois, as outras 3 perguntas do filtro\n'
  );

  console.log('Os 5 primeiros da página (mesma ordem do site, "por relevância"):');
  lista.slice(0, 5).forEach(linha);

  const bolso = lista
    .filter((t) => t.deBolso)
    .sort((a, b) => b.volume - a.volume || b.alta - a.alta);
  console.log(`\nDe bolso (${bolso.length}), por volume:`);
  if (!bolso.length)
    console.log('   nenhum agora. Veja a curva de um termo: npm run tendencias -- "13º salário"');
  bolso.slice(0, 15).forEach(linha);
}

// --- Explorar: curva de 12 meses e buscas em ascensão -----------------------

async function cookie() {
  const res = await fetch(`${BASE}/trends/?geo=BR`, { headers: { 'User-Agent': UA } });
  const lista = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return lista.map((c) => c.split(';')[0]).join('; ');
}

async function api(caminho, params, ck) {
  const qs = new URLSearchParams({ hl: 'pt-BR', tz: String(TZ), ...params });
  const res = await fetch(`${BASE}/trends/api/${caminho}?${qs}`, {
    headers: { 'User-Agent': UA, Cookie: ck },
  });
  const txt = await res.text();
  if (res.status === 429)
    throw new Error('o Trends limitou as consultas (429); tente em alguns minutos');
  if (!res.ok) throw new Error(`${caminho}: HTTP ${res.status}`);
  return JSON.parse(txt.slice(txt.indexOf('{')));
}

function barra(v) {
  const n = Math.round((v / 100) * 20);
  return '█'.repeat(n) + '·'.repeat(20 - n);
}

async function curva(termo, ck) {
  const req = {
    comparisonItem: [{ keyword: termo, geo: 'BR', time: 'today 12-m' }],
    category: 0,
    property: '',
  };
  const exp = await api('explore', { req: JSON.stringify(req) }, ck);
  const w = (id) => exp.widgets.find((x) => x.id === id);

  console.log(`\n━━ "${termo}" · Brasil · últimos 12 meses (100 = pico) ━━`);
  const ts = w('TIMESERIES');
  if (ts) {
    const d = await api(
      'widgetdata/multiline',
      { req: JSON.stringify(ts.request), token: ts.token },
      ck
    );
    const pts = (d.default && d.default.timelineData) || [];
    if (!pts.length) console.log('sem dados suficientes para este termo');
    else {
      // Médias por mês, para ver quando sobe (é o que permite chegar antes do pico).
      const meses = new Map();
      for (const p of pts) {
        const dt = new Date(Number(p.time) * 1000);
        const k = dt.toLocaleDateString('pt-BR', {
          month: 'short',
          year: '2-digit',
          timeZone: 'UTC',
        });
        const a = meses.get(k) || [];
        a.push(p.value[0]);
        meses.set(k, a);
      }
      for (const [k, a] of meses) {
        const m = Math.round(a.reduce((s, v) => s + v, 0) / a.length);
        console.log(`  ${k.padEnd(9)} ${barra(m)} ${m}`);
      }
      const pico = pts.reduce((a, b) => (b.value[0] > a.value[0] ? b : a));
      const agora = pts[pts.length - 1];
      console.log(
        `  pico: semana de ${pico.formattedTime} · esta semana: ${agora.value[0]}${agora.isPartial ? ' (parcial)' : ''}`
      );
    }
  }

  const rel = w('RELATED_QUERIES');
  if (rel) {
    const d = await api(
      'widgetdata/relatedsearches',
      { req: JSON.stringify(rel.request), token: rel.token },
      ck
    );
    const listas = (d.default && d.default.rankedList) || [];
    const sobe = ((listas[1] && listas[1].rankedKeyword) || []).slice(0, 10);
    const top = ((listas[0] && listas[0].rankedKeyword) || []).slice(0, 5);
    if (sobe.length) {
      console.log('  buscas em ascensão (viram gancho):');
      for (const k of sobe) console.log(`    ↗ ${k.query}  (${k.formattedValue})`);
    }
    if (top.length) console.log(`  mais buscadas junto: ${top.map((k) => k.query).join(' · ')}`);
  }
}

async function main() {
  const termos = process.argv.slice(2).filter(Boolean);
  if (!termos.length) return emAlta();
  if (termos.length > 5)
    throw new Error('no máximo 5 termos por vez (o Trends limita as consultas)');
  const ck = await cookie();
  for (const t of termos) {
    await curva(t, ck);
    await new Promise((r) => setTimeout(r, 1200)); // gentil com o limite do Trends
  }
}

main().catch((e) => {
  const causa = e.cause && e.cause.code;
  if (causa === 'ENOTFOUND' || /CONNECT|403/.test(String(e.message)))
    console.error(
      'Sem acesso a trends.google.com (rede bloqueada?). Abra o Trends no celular e mande o print.'
    );
  else console.error('Erro:', e.message);
  process.exit(1);
});
