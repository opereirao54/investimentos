#!/usr/bin/env node
'use strict';

// Puxa as métricas dos Reels do Instagram e guarda um retrato do dia em
// marketing/metricas/instagram/AAAA-MM-DD.json, para a análise de conteúdo
// (.claude/skills/marketing-saas/referencias/analise-metricas.md).
//
//   npm run metricas:instagram
//
// Duas fontes, nesta ordem:
//   1. O painel do admin em produção (APPLIQUEI_URL + ADMIN_API_TOKEN): usa o
//      token do Instagram que fica no Vercel e se renova sozinho. Preferida.
//   2. IG_TOKEN direto na graph.instagram.com (token de 60 dias, sem
//      renovação daqui).

const fs = require('fs');
const path = require('path');
const { buscarInstagram } = require('../api/_lib/redes-instagram');

async function lerDoAdmin() {
  const base = (process.env.APPLIQUEI_URL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/api/admin/stats?include=redes&refresh=1`, {
    headers: { Authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` },
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.detail || d.error || `HTTP ${res.status}`);
  return d;
}

function fmt(v, suf) {
  return v == null ? '—' : String(v) + (suf || '');
}

async function main() {
  let dados;
  if (process.env.APPLIQUEI_URL && process.env.ADMIN_API_TOKEN) dados = await lerDoAdmin();
  else if (process.env.IG_TOKEN)
    dados = await buscarInstagram({
      token: process.env.IG_TOKEN,
      igUserId: process.env.IG_USER_ID,
    });
  else {
    console.error(
      'Sem acesso: defina APPLIQUEI_URL + ADMIN_API_TOKEN (preferido) ou IG_TOKEN no ambiente.'
    );
    process.exit(2);
  }
  if (dados.configurado === false) {
    console.error('Instagram ainda não conectado (IG_TOKEN ausente no Vercel).');
    process.exit(3);
  }

  const dia = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const pasta = path.join(__dirname, '..', 'marketing', 'metricas', 'instagram');
  fs.mkdirSync(pasta, { recursive: true });
  const arq = path.join(pasta, `${dia}.json`);
  fs.writeFileSync(arq, JSON.stringify(dados, null, 2) + '\n');

  const r = dados.resumo || {};
  console.log(
    `@${r.usuario} · ${fmt(r.seguidores)} seguidores · ${fmt(r.reels30d)} Reels em 30 dias`
  );
  console.log(
    `30 dias: ${fmt(r.views30d)} views · salvos ${fmt(r.taxaSalvosMedia30d, '%')} · compart. ${fmt(
      r.taxaCompartilhamentosMedia30d,
      '%'
    )} · tempo médio ${fmt(r.tempoMedioSeg30d, ' s')} · retenção ${fmt(
      r.pctAssistidoMedio30d,
      '%'
    )} · seguiram pelos Reels ${fmt(r.seguiuPorReels30d)}`
  );
  const c = r.consolidado || {};
  console.log(
    `Todos os ${fmt(c.reels)} Reels: ${fmt(c.views)} views · salvos ${fmt(c.taxaSalvos, '%')} · compart. ${fmt(
      c.taxaCompartilhamentos,
      '%'
    )} · retenção ${fmt(c.pctAssistidoMedio, '%')} · seguiram ${fmt(c.seguiu)}`
  );
  console.log('');
  console.log('data   série     views  alcance  salvos%  compart%  tempo  ret%  seguiu  título');
  for (const x of dados.reels || []) {
    console.log(
      [
        (x.data || '').slice(5, 10),
        (x.serie || '').padEnd(9),
        fmt(x.views).padStart(6),
        fmt(x.alcance).padStart(8),
        fmt(x.taxaSalvos).padStart(8),
        fmt(x.taxaCompartilhamentos).padStart(9),
        fmt(x.tempoMedioSeg).padStart(6),
        fmt(x.pctAssistido).padStart(5),
        fmt(x.seguiu).padStart(7),
        ' ' + (x.titulo || '').slice(0, 60),
      ].join(' ')
    );
  }
  console.log(`\ngravado: ${path.relative(process.cwd(), arq)}`);
}

main().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});
