#!/usr/bin/env node
'use strict';

// Publica `firestore.rules` falando DIRETO com a API de Rules do Firebase.
//
// POR QUE NÃO O firebase-tools
//
// A primeira execução do workflow, no merge que trouxe estes arquivos, morreu
// assim:
//
//   i firestore: ensuring required API firestore.googleapis.com is enabled...
//   Error: Request to https://serviceusage.googleapis.com/v1/projects/…
//   had HTTP Error: 403, Permission denied to get service [firestore.googleapis.com]
//
// Não foi o publish das regras que foi negado — foi um passo PRELIMINAR da CLI,
// que confere na Service Usage API se o Firestore está habilitado. A service
// account do Admin SDK não tem nem `serviceusage.services.get`, e resolver isso
// exigiria conceder um segundo papel IAM para uma verificação que, no nosso
// caso, é inútil: o projeto usa Firestore em produção há meses.
//
// Estas duas chamadas fazem o mesmo trabalho tocando SÓ firebaserules
// .googleapis.com — some a classe inteira de erro, some a dependência de um
// segundo papel, e o job cai de ~2min (instalar 90MB de CLI) para segundos.
//
//   1. POST   /v1/projects/{p}/rulesets              cria o ruleset
//   2. PATCH  /v1/projects/{p}/releases/cloud.firestore   aponta a release
//
// Permissão necessária: roles/firebaserules.admin. Nada além disso.
//
// USO
//   FIREBASE_SERVICE_ACCOUNT_BASE64=... node scripts/publicar-regras-firestore.js

const fs = require('node:fs');
const path = require('node:path');
const { GoogleAuth } = require('google-auth-library');
const { lerServiceAccount } = require('../api/_lib/firebase-admin');

const RAIZ = path.resolve(__dirname, '..');
const API = 'https://firebaserules.googleapis.com/v1';
const RELEASE = 'cloud.firestore';

async function obterToken(sa) {
  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('não foi possível obter access token da service account');
  return token;
}

function fetcherComToken(token) {
  return async (url, opcoes) => {
    const o = opcoes || {};
    const r = await fetch(url, {
      method: o.method || 'GET',
      headers: Object.assign(
        { Authorization: 'Bearer ' + token },
        o.body ? { 'Content-Type': 'application/json' } : {}
      ),
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    const texto = await r.text();
    let corpo = null;
    try {
      corpo = JSON.parse(texto);
    } catch (_) {
      /* resposta não-JSON fica em `texto`, para o diagnóstico */
    }
    return { ok: r.ok, status: r.status, corpo, texto };
  };
}

/** Mensagem do erro do Google, quando vier no formato padrão. */
function motivo(resp) {
  const e = resp && resp.corpo && resp.corpo.error;
  if (e && e.message) return `${resp.status} ${e.message}`;
  return `${resp.status} ${(resp.texto || '').slice(0, 400)}`;
}

// Núcleo com o fetcher injetado — publicar é a operação mais destrutiva do
// repositório, e não dá para deixá-la sem teste só porque fala com a rede.
// Devolve { ok, rulesetName, mensagem } em vez de sair do processo.
async function publicar(opcoes) {
  const { conteudo, projeto, chamar } = opcoes;

  const criado = await chamar(`${API}/projects/${projeto}/rulesets`, {
    method: 'POST',
    body: { source: { files: [{ name: 'firestore.rules', content: conteudo }] } },
  });
  if (criado.status === 403) {
    return {
      ok: false,
      mensagem:
        'A service account não pode publicar regras.\n' +
        'Conceda o papel "Firebase Rules Admin" (roles/firebaserules.admin) em:\n' +
        `  https://console.cloud.google.com/iam-admin/iam?project=${projeto}\n\n` +
        'Detalhe da API: ' +
        motivo(criado),
    };
  }
  if (!criado.ok) {
    // 400 aqui é quase sempre erro de SINTAXE no firestore.rules, e a API diz
    // qual linha. Repassar a mensagem dela vale mais que qualquer paráfrase.
    return { ok: false, mensagem: 'Falha ao criar o ruleset: ' + motivo(criado) };
  }
  const rulesetName = criado.corpo && criado.corpo.name;
  if (!rulesetName) {
    return { ok: false, mensagem: 'A API criou o ruleset mas não devolveu `name`.' };
  }

  const nomeRelease = `projects/${projeto}/releases/${RELEASE}`;
  let pub = await chamar(`${API}/${nomeRelease}`, {
    method: 'PATCH',
    body: { release: { name: nomeRelease, rulesetName } },
  });
  // Projeto que nunca publicou regra nenhuma não tem release para atualizar.
  // Cria. (É o cenário de projeto novo — e também o pior dos diagnósticos num
  // projeto antigo: significa que TUDO estava em negação implícita.)
  if (pub.status === 404) {
    pub = await chamar(`${API}/projects/${projeto}/releases`, {
      method: 'POST',
      body: { name: nomeRelease, rulesetName },
    });
  }
  if (!pub.ok) {
    return {
      ok: false,
      mensagem:
        `O ruleset ${rulesetName} foi criado, mas NÃO virou a release ativa ` +
        '— as regras em vigor continuam as anteriores.\n' +
        'Detalhe da API: ' +
        motivo(pub),
    };
  }

  return { ok: true, rulesetName, mensagem: `Regras publicadas. Ruleset: ${rulesetName}` };
}

async function main() {
  const conteudo = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');
  const sa = lerServiceAccount();
  const projeto = process.env.FIREBASE_PROJECT_ID || sa.project_id;
  if (!projeto)
    throw new Error('Projeto indefinido: nem FIREBASE_PROJECT_ID nem project_id na SA.');

  console.log(`Publicando firestore.rules em ${projeto} (${conteudo.length} bytes)`);
  const r = await publicar({
    conteudo,
    projeto,
    chamar: fetcherComToken(await obterToken(sa)),
  });

  if (!r.ok) {
    console.error('::error::' + r.mensagem.split('\n')[0]);
    console.error('\n❌ ' + r.mensagem);
    process.exit(1);
  }
  console.log('\n✅ ' + r.mensagem);
}

module.exports = { publicar };

if (require.main === module) {
  main().catch((e) => {
    console.error('::error::' + (e && e.message));
    console.error(e);
    process.exit(1);
  });
}
