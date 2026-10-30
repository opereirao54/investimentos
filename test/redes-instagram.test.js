'use strict';

// Métricas do Instagram (api/_lib/redes-instagram.js): o que o painel do admin
// e a análise de conteúdo mostram tem de bater com o que a API devolve.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  serieDaLegenda,
  tituloDaLegenda,
  resumirReel,
  resumirConta,
  rankear,
  buscarInstagram,
  renovarSeVelho,
} = require('../api/_lib/redes-instagram');

const DIA = 24 * 3600 * 1000;
const AGORA = Date.UTC(2026, 9, 30, 15, 0, 0);
const ins = (o) => Object.entries(o).map(([name, v]) => ({ name, values: [{ value: v }] }));

test('série pela legenda', () => {
  assert.equal(serieDaLegenda('O dólar...\n📰 Appliquei News: a notícia'), 'news');
  assert.equal(serieDaLegenda('Carro...\n💡 Appliquei Explica: a conta'), 'explica');
  assert.equal(serieDaLegenda('É hoje! O Appliquei chegou'), 'appliquei');
  assert.equal(serieDaLegenda('Faltam 6 dias. Appliquei: sonhos'), 'appliquei');
  assert.equal(serieDaLegenda('Mesma geladeira, mesmo cartão'), 'outros');
  assert.equal(serieDaLegenda(undefined), 'outros');
});

test('título é a primeira linha não vazia, cortada em 120', () => {
  assert.equal(
    tituloDaLegenda('\n\nEsse carro custa R$ 2.100 por mês.\nresto'),
    'Esse carro custa R$ 2.100 por mês.'
  );
  assert.equal(tituloDaLegenda('x'.repeat(200)).length, 120);
  assert.equal(tituloDaLegenda(null), '');
});

test('resumo de um Reel: taxas sobre o alcance e tempo em segundos', () => {
  const r = resumirReel(
    {
      id: '1',
      caption: 'Gancho\n📰 Appliquei News',
      timestamp: '2026-10-29T22:00:00+0000',
      permalink: 'https://x',
    },
    ins({
      views: 1200,
      reach: 1000,
      likes: 50,
      comments: 5,
      saved: 30,
      shares: 20,
      total_interactions: 105,
      ig_reels_avg_watch_time: 12345,
    })
  );
  assert.equal(r.serie, 'news');
  assert.equal(r.views, 1200);
  assert.equal(r.taxaSalvos, 3);
  assert.equal(r.taxaCompartilhamentos, 2);
  assert.equal(r.taxaEngajamento, 10.5);
  assert.equal(r.tempoMedioSeg, 12.3);
});

test('sem insights, usa os contadores básicos e não inventa taxa', () => {
  const r = resumirReel({ id: '2', caption: 'a', like_count: 7, comments_count: 1 }, []);
  assert.equal(r.curtidas, 7);
  assert.equal(r.comentarios, 1);
  assert.equal(r.views, null);
  assert.equal(r.taxaSalvos, null);
  assert.equal(r.taxaEngajamento, null);
});

test('insight no formato total_value também é lido', () => {
  const r = resumirReel({ id: '3' }, [{ name: 'views', total_value: { value: 99 } }]);
  assert.equal(r.views, 99);
});

test('resumo da conta: só os últimos 30 dias entram nos totais; séries separadas', () => {
  const novo = {
    id: 'a',
    data: new Date(AGORA - 2 * DIA).toISOString(),
    serie: 'news',
    views: 100,
    alcance: 80,
    salvos: 4,
    compartilhamentos: 2,
    taxaSalvos: 5,
    taxaCompartilhamentos: 2.5,
    tempoMedioSeg: 10,
  };
  const novo2 = {
    id: 'b',
    data: new Date(AGORA - 5 * DIA).toISOString(),
    serie: 'explica',
    views: 300,
    alcance: 200,
    salvos: 10,
    compartilhamentos: 6,
    taxaSalvos: 5,
    taxaCompartilhamentos: 3,
    tempoMedioSeg: 20,
  };
  const velho = {
    id: 'c',
    data: new Date(AGORA - 60 * DIA).toISOString(),
    serie: 'outros',
    views: 9999,
    alcance: 9999,
    salvos: 999,
    compartilhamentos: 999,
  };
  const s = resumirConta(
    { username: 'appliquei', followers_count: 500, media_count: 40 },
    [novo, novo2, velho],
    AGORA
  );
  assert.equal(s.usuario, 'appliquei');
  assert.equal(s.reels30d, 2);
  assert.equal(s.views30d, 400);
  assert.equal(s.alcance30d, 280);
  assert.equal(s.salvos30d, 14);
  assert.equal(s.compartilhamentos30d, 8);
  assert.equal(s.viewsMedia30d, 200);
  assert.equal(s.tempoMedioSeg30d, 15);
  assert.deepEqual(s.series.map((x) => x.serie).sort(), ['explica', 'news', 'outros']);
});

test('ranking: compartilhar e salvar pesam mais que curtir', () => {
  const ids = rankear(
    [
      { id: 'curtido', curtidas: 60 },
      { id: 'compartilhado', compartilhamentos: 30 },
      { id: 'salvo', salvos: 40 },
      { id: 'fraco', curtidas: 5 },
    ],
    3
  );
  assert.deepEqual(ids, ['compartilhado', 'salvo', 'curtido']);
  assert.deepEqual(
    rankear(
      [
        { id: 'x', curtidas: 1 },
        { id: 'y', compartilhamentos: 1 },
      ],
      1
    ),
    ['y']
  );
});

function fetchFalso(rotas) {
  const chamadas = [];
  const f = async (url) => {
    chamadas.push(url);
    const chave = Object.keys(rotas).find((k) => url.includes(k));
    const corpo = chave ? rotas[chave] : { error: { message: 'rota inesperada', code: 100 } };
    const ok = !(corpo && corpo.error);
    return { ok, status: ok ? 200 : 400, json: async () => corpo };
  };
  f.chamadas = chamadas;
  return f;
}

test('buscarInstagram: sem token, avisa que não está configurado e não chama a API', async () => {
  const f = fetchFalso({});
  assert.deepEqual(await buscarInstagram({ token: '', fetchImpl: f }), { configurado: false });
  assert.equal(f.chamadas.length, 0);
});

test('buscarInstagram: lê conta, só Reels/vídeos e os insights de cada um', async () => {
  const f = fetchFalso({
    '/me?fields': { username: 'appliquei', followers_count: 321, media_count: 12 },
    '/me/media': {
      data: [
        {
          id: 'r1',
          caption: 'Reel\n📰 Appliquei News',
          media_product_type: 'REELS',
          timestamp: new Date(AGORA - DIA).toISOString(),
        },
        { id: 'f1', caption: 'foto', media_type: 'IMAGE', media_product_type: 'FEED' },
        {
          id: 'r2',
          caption: 'outro',
          media_product_type: 'REELS',
          timestamp: new Date(AGORA - DIA).toISOString(),
          like_count: 3,
        },
      ],
    },
    '/r1/insights': { data: ins({ views: 500, reach: 400, saved: 8, shares: 4 }) },
    // r2 sem insights (recém-postado): erro tratado
  });
  const d = await buscarInstagram({ token: 'tok', fetchImpl: f, agoraMs: AGORA });
  assert.equal(d.configurado, true);
  assert.equal(d.resumo.seguidores, 321);
  assert.deepEqual(
    d.reels.map((r) => r.id),
    ['r1', 'r2']
  );
  assert.equal(d.reels[0].taxaSalvos, 2);
  assert.equal(d.reels[1].curtidas, 3);
  assert.equal(d.reels[1].views, null);
  assert.ok(f.chamadas.every((u) => u.startsWith('https://graph.instagram.com/')));
  assert.ok(f.chamadas.every((u) => u.includes('access_token=tok')));
});

test('buscarInstagram: erro da conta sobe com a mensagem da Meta', async () => {
  const f = fetchFalso({
    '/me?fields': { error: { message: 'Invalid OAuth access token', code: 190 } },
  });
  await assert.rejects(buscarInstagram({ token: 'x', fetchImpl: f }), /Invalid OAuth access token/);
});

test('renovarSeVelho: não renova token com menos de 30 dias; renova o mais velho', async () => {
  const f = fetchFalso({ refresh_access_token: { access_token: 'novo', expires_in: 5184000 } });
  const novo = await renovarSeVelho({
    token: 'tok',
    obtidoEmMs: AGORA - 5 * DIA,
    fetchImpl: f,
    agoraMs: AGORA,
  });
  assert.deepEqual(novo, { token: 'tok', renovado: false });
  assert.equal(f.chamadas.length, 0);
  const velho = await renovarSeVelho({
    token: 'tok',
    obtidoEmMs: AGORA - 40 * DIA,
    fetchImpl: f,
    agoraMs: AGORA,
  });
  assert.equal(velho.token, 'novo');
  assert.equal(velho.renovado, true);
  assert.ok(f.chamadas[0].includes('grant_type=ig_refresh_token'));
});
