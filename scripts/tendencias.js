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
  /sal[aá]rio|13[ºo°]?|d[eé]cimo|pix|pre[cç]o|infla[cç][aã]o|ipca|d[oó]lar|gasolina|combust|diesel|juros|selic|copom|imposto|receita federal|\bir\b|inss|fgts|black ?friday|conta de luz|bandeira tarif|energia|aluguel|cart[aã]o|banco|nubank|financiamento|aposentad|benef[ií]cio|bolsa fam[ií]lia|aux[ií]lio|ipva|iptu|desconto|promo[cç]|mercado|cesta b[aá]sica|feira|caro|tarifa|d[ií]vida|serasa|desenrola|poupan[cç]a|cdb|tesouro|greve|pis|abono|seguro.desemprego|emprego|demiss|dia [uú]til|feriado/i;

function decodificar(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function tag(bloco, nome) {
  const m = bloco.match(new RegExp(`<${nome}>([\\s\\S]*?)</${nome}>`));
  return m ? decodificar(m[1]) : '';
}

async function emAlta() {
  const res = await fetch(`${BASE}/trending/rss?geo=BR`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`RSS do Trends: HTTP ${res.status}`);
  const xml = await res.text();
  const itens = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const b = m[1];
    const noticia = (b.match(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/) || [])[1] || '';
    const termo = tag(b, 'title');
    const manchete = tag(noticia, 'ht:news_item_title');
    return {
      termo,
      trafego: tag(b, 'ht:approx_traffic'),
      quando: tag(b, 'pubDate'),
      manchete,
      fonte: tag(noticia, 'ht:news_item_source'),
      link: tag(noticia, 'ht:news_item_url'),
      // 2 = o termo é de bolso; 1 = só a manchete fala de bolso (conferir).
      bolso: BOLSO.test(termo) ? 2 : BOLSO.test(manchete) ? 1 : 0,
    };
  });

  const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`Pesquisas em alta no Brasil (Google Trends) · ${hora}`);
  console.log(
    '💰 = assunto de bolso · ❔ = só a manchete fala de bolso (conferir) · depois, as outras 3 perguntas do filtro\n'
  );
  const ordem = [...itens].sort((a, b) => b.bolso - a.bolso);
  for (const i of ordem) {
    console.log(`${['  ', '❔', '💰'][i.bolso]} ${i.termo}  (${i.trafego || '?'} buscas)`);
    if (i.manchete) console.log(`     ${i.manchete} — ${i.fonte}`);
    if (i.link) console.log(`     ${i.link}`);
  }
  if (!ordem.some((i) => i.bolso))
    console.log(
      '\nNenhum assunto de bolso em alta agora. Veja a curva de um termo:\n' +
        '  npm run tendencias -- "13º salário" "black friday"'
    );
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
