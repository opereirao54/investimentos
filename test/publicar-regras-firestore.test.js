'use strict';

// Publicação das regras do Firestore pela API de Rules.
//
// A primeira execução do workflow, no merge que o trouxe, falhou assim:
//
//   i firestore: ensuring required API firestore.googleapis.com is enabled...
//   Error: … serviceusage.googleapis.com … 403, Permission denied to get
//   service [firestore.googleapis.com]
//
// Não era o publish sendo negado — era um passo preliminar do firebase-tools
// consultando a Service Usage API, que a service account do Admin SDK não pode
// nem ler. A publicação passou a falar direto com firebaserules.googleapis.com,
// e estes testes cobrem o que aquele caminho não tinha: as duas chamadas na
// ordem certa, e cada modo de falha com a mensagem que resolve.
//
// Publicar regra é a operação mais destrutiva do repositório — ela decide quem
// lê e escreve os dados de todo mundo. Falar com a rede não é desculpa para
// deixá-la sem teste: o fetcher é injetado.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { publicar } = require('../scripts/publicar-regras-firestore.js');

const CONTEUDO = 'rules_version = "2";\nservice cloud.firestore { }';
const PROJETO = 'appliquei-prod';

/** Gravador de chamadas com respostas roteirizadas por passo. */
function chamador(roteiro) {
  const feitas = [];
  const chamar = async (url, opcoes) => {
    feitas.push({ url, method: (opcoes && opcoes.method) || 'GET', body: opcoes && opcoes.body });
    const proxima = roteiro.shift();
    if (!proxima) throw new Error('chamada inesperada: ' + url);
    return proxima;
  };
  return { chamar, feitas };
}

const ok = (corpo) => ({ ok: true, status: 200, corpo, texto: '' });
const falha = (status, mensagem) => ({
  ok: false,
  status,
  corpo: { error: { message: mensagem } },
  texto: mensagem,
});

const RULESET = { name: `projects/${PROJETO}/rulesets/nova` };

// ---------------------------------------------------------------------------
// O caminho feliz
// ---------------------------------------------------------------------------

test('cria o ruleset e aponta a release — nessa ordem', async () => {
  const { chamar, feitas } = chamador([ok(RULESET), ok({})]);
  const r = await publicar({ conteudo: CONTEUDO, projeto: PROJETO, chamar });

  assert.equal(r.ok, true);
  assert.equal(r.rulesetName, RULESET.name);
  assert.equal(feitas.length, 2);

  assert.match(feitas[0].url, /\/projects\/appliquei-prod\/rulesets$/);
  assert.equal(feitas[0].method, 'POST');
  assert.equal(feitas[0].body.source.files[0].content, CONTEUDO, 'sobe o arquivo do repositório');

  assert.match(feitas[1].url, /\/releases\/cloud\.firestore$/);
  assert.equal(feitas[1].method, 'PATCH');
  assert.equal(feitas[1].body.release.rulesetName, RULESET.name, 'aponta para o ruleset novo');
});

test('não toca a Service Usage API — foi o que derrubou a primeira execução', async () => {
  const { chamar, feitas } = chamador([ok(RULESET), ok({})]);
  await publicar({ conteudo: CONTEUDO, projeto: PROJETO, chamar });
  feitas.forEach((c) => {
    assert.ok(!/serviceusage/.test(c.url), `chamou serviceusage em ${c.url}`);
    assert.match(c.url, /^https:\/\/firebaserules\.googleapis\.com\//);
  });
});

test('projeto sem release nenhuma: cria em vez de atualizar', async () => {
  // 404 no PATCH = nunca houve regra publicada. Num projeto antigo esse é o
  // pior dos diagnósticos: tudo estava em negação implícita.
  const { chamar, feitas } = chamador([ok(RULESET), falha(404, 'not found'), ok({})]);
  const r = await publicar({ conteudo: CONTEUDO, projeto: PROJETO, chamar });

  assert.equal(r.ok, true);
  assert.equal(feitas.length, 3);
  assert.equal(feitas[2].method, 'POST');
  assert.match(feitas[2].url, /\/releases$/);
  assert.equal(feitas[2].body.rulesetName, RULESET.name);
});

// ---------------------------------------------------------------------------
// As falhas
// ---------------------------------------------------------------------------

test('403 ao criar → nomeia o papel IAM que falta e não segue adiante', async () => {
  const { chamar, feitas } = chamador([falha(403, 'caller lacks permission')]);
  const r = await publicar({ conteudo: CONTEUDO, projeto: PROJETO, chamar });

  assert.equal(r.ok, false);
  assert.match(r.mensagem, /roles\/firebaserules\.admin/);
  assert.match(r.mensagem, /iam-admin\/iam\?project=appliquei-prod/);
  assert.match(r.mensagem, /caller lacks permission/, 'e repassa o que a API disse');
  assert.equal(feitas.length, 1, 'sem permissão, não tenta publicar a release');
});

test('regra com erro de sintaxe → repassa a mensagem da API, que diz a linha', async () => {
  const { chamar } = chamador([falha(400, 'Line 12: Unexpected "}"')]);
  const r = await publicar({ conteudo: CONTEUDO, projeto: PROJETO, chamar });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /Line 12/, 'parafrasear isso seria perder a única pista útil');
});

test('ruleset criado mas release recusada → diz que as regras EM VIGOR não mudaram', async () => {
  // O pior desfecho silencioso possível: existe um ruleset novo no projeto e
  // ninguém está usando. Quem lê o log precisa saber que nada mudou de fato.
  const { chamar } = chamador([ok(RULESET), falha(403, 'no update permission')]);
  const r = await publicar({ conteudo: CONTEUDO, projeto: PROJETO, chamar });

  assert.equal(r.ok, false);
  assert.match(r.mensagem, /NÃO virou a release ativa/);
  assert.match(r.mensagem, /continuam as anteriores/);
});

test('API cria o ruleset sem devolver name → falha em vez de publicar lixo', async () => {
  const { chamar, feitas } = chamador([ok({})]);
  const r = await publicar({ conteudo: CONTEUDO, projeto: PROJETO, chamar });
  assert.equal(r.ok, false);
  assert.equal(feitas.length, 1);
});

// ---------------------------------------------------------------------------
// O workflow
// ---------------------------------------------------------------------------

test('o workflow publica pelo script, não pelo firebase-tools', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/firestore-rules.yml'), 'utf8');
  const passo = wf.slice(wf.indexOf('name: Publicar as regras'), wf.indexOf('name: Provar que'));
  assert.match(passo, /node scripts\/publicar-regras-firestore\.js/);
  assert.ok(
    !/firebase-tools/.test(passo),
    'a CLI trazia a checagem da Service Usage API, que é o que quebrou'
  );
  assert.ok(!/firestore:indexes/.test(wf), 'índices continuam fora: remover um derruba consultas');
});

test('a conferência posterior continua sendo quem prova o deploy', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/firestore-rules.yml'), 'utf8');
  const depois = wf.slice(wf.indexOf('Provar que o publicado bate'), wf.indexOf('Abrir issue'));
  assert.match(depois, /node scripts\/conferir-regras-firestore\.js/);
  assert.ok(!/continue-on-error/.test(depois));
});
