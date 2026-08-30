'use strict';

// Conferência entre o firestore.rules do repositório e o que está publicado.
//
// O bug que originou isto: a regra `match /feedback/{id}` entrou no repositório
// junto com a tela de Dúvidas & Sugestões e nunca foi publicada. Com ela
// ausente vale a negação implícita — todo envio de sugestão voltava
// `permission-denied`, com o e-mail verificado e tudo. Nada no projeto
// comparava as duas pontas, então o desvio durou meses sem sinal nenhum.
//
// O que estes testes travam é a REGRA DE DECISÃO do conferidor, que é onde
// mora o risco: um script que grita quando não deveria vira ruído e é
// ignorado; um que se cala quando deveria gritar é pior que não existir.
//
//   · divergiu de verdade                  → erro (derruba o pipeline)
//   · não há release publicada             → erro (é o caso mais grave)
//   · não deu para LER (403, rede, formato) → aviso, não derruba
//   · bate                                  → ok

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
  normalizar,
  primeirasDiferencas,
  compararComPublicado,
} = require('../scripts/conferir-regras-firestore.js');

const REGRAS_LOCAIS = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

/** Buscador falso: mapeia sufixo de URL → resposta. */
function buscador(respostas) {
  return async (url) => {
    for (const [chave, resp] of Object.entries(respostas)) {
      if (url.includes(chave)) return resp;
    }
    return { ok: false, status: 500, corpo: null, texto: 'sem stub para ' + url };
  };
}

const okRelease = {
  ok: true,
  status: 200,
  corpo: { name: 'projects/p/releases/cloud.firestore', rulesetName: 'projects/p/rulesets/abc' },
  texto: '',
};

function rulesetCom(conteudo) {
  return {
    ok: true,
    status: 200,
    corpo: {
      name: 'projects/p/rulesets/abc',
      createTime: '2026-01-02T03:04:05Z',
      source: { files: [{ name: 'firestore.rules', content: conteudo }] },
    },
    texto: '',
  };
}

const conferir = (respostas, local) =>
  compararComPublicado({
    local: local === undefined ? REGRAS_LOCAIS : local,
    projeto: 'appliquei-prod',
    buscar: buscador(respostas),
  });

// ---------------------------------------------------------------------------
// Os desfechos
// ---------------------------------------------------------------------------

test('publicado igual ao repositório → ok', async () => {
  const r = await conferir({
    '/releases/': okRelease,
    '/rulesets/': rulesetCom(REGRAS_LOCAIS),
  });
  assert.equal(r.estado, 'ok');
  assert.match(r.mensagem, /iguais ao firestore\.rules/);
});

test('diferença de espaço em branco NÃO é divergência', async () => {
  // Um espaço à direita ou CRLF do Windows não muda regra nenhuma. Acusar
  // isso treinaria todo mundo a ignorar o alarme.
  const bagunçado = REGRAS_LOCAIS.replace(/\n/g, '  \r\n') + '\n\n\n';
  const r = await conferir({ '/releases/': okRelease, '/rulesets/': rulesetCom(bagunçado) });
  assert.equal(r.estado, 'ok');
});

test('regra faltando no publicado → erro, e diz qual', async () => {
  // É EXATAMENTE o caso real: a produção sem o bloco de feedback.
  const semFeedback = REGRAS_LOCAIS.replace(
    /\n\s*match \/feedback\/\{id\} \{[\s\S]*?\n    \}\n/,
    '\n'
  );
  assert.ok(!/match \/feedback/.test(semFeedback), 'o fixture precisa mesmo perder o bloco');

  const r = await conferir({ '/releases/': okRelease, '/rulesets/': rulesetCom(semFeedback) });
  assert.equal(r.estado, 'erro');
  assert.match(r.mensagem, /diferem do firestore\.rules/);
  assert.match(r.mensagem, /firebase deploy --only firestore:rules/, 'a mensagem diz o que fazer');
  assert.match(r.mensagem, /linha \d+/, 'e mostra onde');
});

test('nenhuma release publicada (404) → erro, é o caso mais grave', async () => {
  const r = await conferir({ '/releases/': { ok: false, status: 404, corpo: null, texto: '' } });
  assert.equal(r.estado, 'erro');
  assert.match(r.mensagem, /NÃO tem regras publicadas/);
});

test('sem permissão de leitura (403) → aviso, não derruba o pipeline', async () => {
  // Não conseguir verificar não é o mesmo que estar errado. Derrubar aqui
  // faria o time desligar o workflow no primeiro dia.
  const r = await conferir({ '/releases/': { ok: false, status: 403, corpo: null, texto: '' } });
  assert.equal(r.estado, 'aviso');
  assert.match(r.mensagem, /roles\/firebaserules\.viewer/, 'nomeia o papel IAM que falta');
});

test('erro transitório da API → aviso', async () => {
  const r = await conferir({
    '/releases/': { ok: false, status: 503, corpo: null, texto: 'indisponível' },
  });
  assert.equal(r.estado, 'aviso');
});

test('resposta em formato inesperado → aviso, não erro', async () => {
  const semRuleset = { ok: true, status: 200, corpo: { name: 'x' }, texto: '' };
  const r1 = await conferir({ '/releases/': semRuleset });
  assert.equal(r1.estado, 'aviso');

  const semArquivos = { ok: true, status: 200, corpo: { source: { files: [] } }, texto: '' };
  const r2 = await conferir({ '/releases/': okRelease, '/rulesets/': semArquivos });
  assert.equal(r2.estado, 'aviso');
});

test('ruleset com vários arquivos é concatenado, não só o primeiro', async () => {
  const varios = {
    ok: true,
    status: 200,
    corpo: {
      source: {
        files: [
          { name: 'a', content: 'primeira parte' },
          { name: 'b', content: 'segunda parte' },
        ],
      },
    },
    texto: '',
  };
  const r = await conferir(
    { '/releases/': okRelease, '/rulesets/': varios },
    'primeira parte\nsegunda parte'
  );
  assert.equal(r.estado, 'ok', 'olhar só o primeiro arquivo daria divergência falsa');
});

// ---------------------------------------------------------------------------
// Os utilitários
// ---------------------------------------------------------------------------

test('normalizar tira espaço à direita, CRLF e bordas', () => {
  assert.equal(normalizar('  a  \r\nb\t\n\n'), 'a\nb');
});

test('normalizar preserva a indentação do meio — ela é conteúdo, não ruído', () => {
  assert.equal(normalizar('match /x {\n  allow read;  \n}'), 'match /x {\n  allow read;\n}');
});

test('primeirasDiferencas respeita o teto e nomeia a linha', () => {
  const a = ['1', '2', '3', '4', '5'].join('\n');
  const b = ['1', 'x', 'y', 'z', 'w'].join('\n');
  const d = primeirasDiferencas(a, b, 2);
  assert.equal(d.length, 2);
  assert.match(d[0], /linha 2/);
});

test('arquivo publicado mais curto aparece como fim do arquivo', () => {
  const d = primeirasDiferencas('a\nb\nc', 'a', 5);
  assert.match(d[0], /linha 2/);
  assert.match(d[0], /publicado:\s+\(fim do arquivo\)/);
});

// ---------------------------------------------------------------------------
// O workflow
// ---------------------------------------------------------------------------

test('o workflow publica em main, sob demanda, e confere semanalmente', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/firestore-rules.yml'), 'utf8');
  assert.match(wf, /branches: \[main\]/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /cron: '20 6 \* \* 1'/, 'a conferência semanal é o que pega deriva');
  // Índices continuam fora do escopo: publicar índices remove os que não estão
  // no arquivo, e um índice removido em produção derruba as consultas que
  // dependiam dele. A publicação só sobe firestore.rules — ver
  // test/publicar-regras-firestore.test.js, que trava as chamadas de fato.
  assert.ok(!/firestore:indexes/.test(wf), 'nem citado, para ninguém copiar por engano');
  assert.match(wf, /node scripts\/publicar-regras-firestore\.js/);
});

test('o workflow confere DEPOIS de publicar, e essa conferência derruba o job', () => {
  // Publicar sem conferir seria repetir o erro original — acreditar que subiu.
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/firestore-rules.yml'), 'utf8');
  const depois = wf.slice(wf.indexOf('Provar que o publicado bate'));
  assert.match(depois, /node scripts\/conferir-regras-firestore\.js/);
  assert.ok(
    !/continue-on-error/.test(depois.slice(0, depois.indexOf('Abrir issue'))),
    'a conferência final não pode ser tolerante — é ela que prova o deploy'
  );
});
