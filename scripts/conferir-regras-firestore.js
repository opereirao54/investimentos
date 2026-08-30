#!/usr/bin/env node
'use strict';

// Compara o `firestore.rules` do repositório com as regras REALMENTE publicadas
// no projeto Firebase.
//
// POR QUE ISTO EXISTE
//
// Não havia nada ligando o arquivo versionado à produção: o deploy das regras é
// manual (`firebase deploy --only firestore:rules`) e nenhum passo de CI o
// fazia. As duas coisas divergiram em silêncio — a regra `match /feedback/{id}`
// entrou no repositório e nunca foi publicada, e com ela ausente vale a negação
// implícita: toda tentativa de enviar uma sugestão voltava `permission-denied`,
// com o e-mail verificado e tudo. Ninguém tinha como saber, porque nada
// comparava as duas pontas.
//
// Este script é essa comparação, e roda em dois momentos (ver
// .github/workflows/firestore-rules.yml):
//   · depois de publicar, para provar que o publish pegou;
//   · uma vez por semana, para pegar deriva — inclusive edição feita à mão
//     direto no Console, que o repositório nunca ficaria sabendo.
//
// USO
//   FIREBASE_SERVICE_ACCOUNT_BASE64=... node scripts/conferir-regras-firestore.js
//
// SAÍDA
//   0  regras publicadas batem com o arquivo
//   1  DIVERGEM (ou não há release nenhuma publicada)
//   0 + aviso  não deu para ler (falta de permissão, rede) — não é o mesmo que
//              "está errado", então não derruba o pipeline por conta disso.

const fs = require('node:fs');
const path = require('node:path');
const { GoogleAuth } = require('google-auth-library');
const { lerServiceAccount } = require('../api/_lib/firebase-admin');

const RAIZ = path.resolve(__dirname, '..');
const API = 'https://firebaserules.googleapis.com/v1';
// Nome fixo da release do Firestore no serviço de Rules. O Storage usa
// `firebase.storage/<bucket>`; aqui é sempre este.
const RELEASE = 'cloud.firestore';

// Comparação por conteúdo semântico: espaços à direita, quebras de linha do
// Windows e uma linha em branco a mais no fim não são diferença de regra.
function normalizar(txt) {
  return String(txt || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

function primeirasDiferencas(a, b, quantas) {
  const la = normalizar(a).split('\n');
  const lb = normalizar(b).split('\n');
  const out = [];
  for (let i = 0; i < Math.max(la.length, lb.length) && out.length < quantas; i++) {
    if (la[i] !== lb[i]) {
      out.push(
        `  linha ${i + 1}\n    repositório: ${la[i] === undefined ? '(fim do arquivo)' : la[i]}\n    publicado:   ${lb[i] === undefined ? '(fim do arquivo)' : lb[i]}`
      );
    }
  }
  return out;
}

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

async function get(url, token) {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const texto = await r.text();
  let corpo = null;
  try {
    corpo = JSON.parse(texto);
  } catch (_) {
    /* resposta não-JSON: fica em `texto` para o diagnóstico */
  }
  return { ok: r.ok, status: r.status, corpo, texto };
}

// `aviso` é a saída para "não consegui verificar", que é diferente de
// "verifiquei e está errado". Só a segunda derruba o pipeline.
function aviso(msg) {
  console.warn('::warning::' + msg);
  console.warn('\n⚠️  ' + msg);
  process.exit(0);
}

function erro(msg) {
  console.error('::error::' + msg.split('\n')[0]);
  console.error('\n❌ ' + msg);
  process.exit(1);
}

// Núcleo da conferência, com o buscador HTTP injetado. Devolve
// { estado, mensagem } em vez de sair do processo: assim dá para testar cada
// desfecho (bate, diverge, sem release, sem permissão) sem rede nem credencial.
//   estado 'ok'      → publicado == repositório
//   estado 'aviso'   → não deu para verificar (não derruba o pipeline)
//   estado 'erro'    → verificado e DIVERGE (derruba)
async function compararComPublicado(opcoes) {
  const { local, projeto, buscar } = opcoes;

  const rel = await buscar(`${API}/projects/${projeto}/releases/${RELEASE}`);
  if (rel.status === 403) {
    return {
      estado: 'aviso',
      mensagem:
        'A service account não tem permissão para LER as regras do Firestore.\n' +
        'Conceda o papel "Firebase Rules Viewer" (roles/firebaserules.viewer) — ou\n' +
        '"Firebase Rules Admin" (roles/firebaserules.admin), que também publica — em\n' +
        `https://console.cloud.google.com/iam-admin/iam?project=${projeto}`,
    };
  }
  if (rel.status === 404) {
    return {
      estado: 'erro',
      mensagem:
        `O projeto ${projeto} NÃO tem regras publicadas para o Firestore.\n` +
        'É a negação implícita valendo para tudo. Publique com:\n' +
        '  firebase deploy --only firestore:rules',
    };
  }
  if (!rel.ok) {
    return {
      estado: 'aviso',
      mensagem: `API de Rules devolveu ${rel.status} ao ler a release: ${rel.texto}`,
    };
  }

  const rulesetName = rel.corpo && rel.corpo.rulesetName;
  if (!rulesetName) {
    return { estado: 'aviso', mensagem: 'Resposta da API sem `rulesetName` — formato inesperado.' };
  }

  const rs = await buscar(`${API}/${rulesetName}`);
  if (!rs.ok) {
    return {
      estado: 'aviso',
      mensagem: `Não foi possível ler o ruleset ${rulesetName}: ${rs.status}`,
    };
  }

  const arquivos = (rs.corpo && rs.corpo.source && rs.corpo.source.files) || [];
  if (!arquivos.length) {
    return { estado: 'aviso', mensagem: 'Ruleset publicado sem arquivos — formato inesperado.' };
  }
  // O deploy do Firestore publica um arquivo só; se um dia forem vários,
  // concatenar mantém a comparação honesta em vez de olhar só o primeiro.
  const publicado = arquivos.map((f) => f.content || '').join('\n');

  const cabecalho =
    `Projeto:   ${projeto}\n` +
    `Release:   ${RELEASE}\n` +
    `Ruleset:   ${rulesetName}\n` +
    `Publicado: ${(rs.corpo && rs.corpo.createTime) || '(sem data)'}`;

  if (normalizar(local) === normalizar(publicado)) {
    return {
      estado: 'ok',
      mensagem:
        cabecalho + '\n\n✅ As regras publicadas são iguais ao firestore.rules do repositório.',
    };
  }

  const difs = primeirasDiferencas(local, publicado, 12);
  return {
    estado: 'erro',
    mensagem:
      cabecalho +
      '\n\nAs regras PUBLICADAS diferem do firestore.rules do repositório.\n\n' +
      'Foi exatamente assim que a tela de sugestões ficou quebrada: a regra estava\n' +
      'no repositório e não em produção. Publique com:\n\n' +
      '  firebase deploy --only firestore:rules\n\n' +
      `Primeiras divergências (${difs.length} mostradas):\n\n` +
      difs.join('\n'),
  };
}

async function main() {
  const local = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');

  let sa;
  try {
    sa = lerServiceAccount();
  } catch (e) {
    return aviso(
      'Sem credencial para conferir as regras (' +
        e.message +
        '). Configure o secret FIREBASE_SERVICE_ACCOUNT_BASE64.'
    );
  }
  const projeto = process.env.FIREBASE_PROJECT_ID || sa.project_id;
  if (!projeto) return aviso('Projeto indefinido: nem FIREBASE_PROJECT_ID nem project_id na SA.');

  let token;
  try {
    token = await obterToken(sa);
  } catch (e) {
    return aviso('Falha ao autenticar na API de Rules: ' + e.message);
  }

  const r = await compararComPublicado({
    local,
    projeto,
    buscar: (url) => get(url, token),
  });
  if (r.estado === 'ok') {
    console.log(r.mensagem);
    return process.exit(0);
  }
  if (r.estado === 'aviso') return aviso(r.mensagem);
  return erro(r.mensagem);
}

module.exports = { normalizar, primeirasDiferencas, compararComPublicado };

// Só roda como CLI quando invocado direto — `require` a partir do teste não
// dispara chamada de rede nenhuma.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    aviso('Erro inesperado ao conferir as regras: ' + (e && e.message));
  });
}
