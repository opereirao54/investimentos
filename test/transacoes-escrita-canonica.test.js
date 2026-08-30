'use strict';

// RISCO-01 — `transacoes` tem UMA porta de escrita.
//
// Antes eram 29 `localStorage.setItem('futurorico_transacoes', ...)` espalhados
// por 9 arquivos, sem nenhum ponto por onde todos passassem — o oposto de
// `contas`, que centraliza tudo em salvarContas(). Sem choke point não há onde
// validar o registro antes de gravar, e cada produtor novo repetia (ou
// esquecia) o ritual: uns faziam forceFlush, outros não, e um chamava uma
// função que não existe.
//
// Este teste é a trava que impede a dispersão de voltar. Ele NÃO valida
// conteúdo — isso é papel das invariantes; valida que a porta continua uma só.
//
// Ver .claude/integracoes/mapa.json → RISCO-01.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./_harness-integracao.js');

const ROOT = path.resolve(__dirname, '..');
const CHAVE = "setItem('futurorico_transacoes'";

// Os dois únicos pontos autorizados a gravar a chave diretamente.
const EXCECOES = {
  // A implementação da própria função canônica.
  'web/appliquei-app.js': 1,
  // Restauração de backup: a fonte é o arquivo do usuário (dados.transacoes),
  // não o array global — que neste instante ainda tem o conteúdo antigo.
  'web/appliquei-utils.js': 1,
};

function arquivosWeb() {
  return fs
    .readdirSync(path.join(ROOT, 'web'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => 'web/' + f);
}

test('só a função canônica (e o restore) gravam futurorico_transacoes', () => {
  const infratores = [];
  for (const arq of arquivosWeb()) {
    const src = fs.readFileSync(path.join(ROOT, arq), 'utf8');
    const linhas = src.split('\n');
    const achados = [];
    linhas.forEach((linha, i) => {
      // Ignora menções em comentário — os comentários explicam a regra.
      const semComentario = linha.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      if (semComentario.includes(CHAVE)) achados.push(i + 1);
    });
    const permitido = EXCECOES[arq] || 0;
    if (achados.length > permitido) {
      infratores.push(
        `${arq}: ${achados.length} escritas diretas (permitido: ${permitido}) — linhas ${achados.join(', ')}`
      );
    }
  }
  assert.deepEqual(
    infratores,
    [],
    'Escrita direta em futurorico_transacoes fora da porta canônica:\n  ' +
      infratores.join('\n  ') +
      '\n\nUse salvarTransacoes() — ela é o único lugar onde dá para validar o ' +
      'registro antes de gravar, e onde a decisão de dar flush imediato vive. ' +
      'Se este for mesmo um caso excepcional (como a restauração de backup), ' +
      'documente o porquê e registre-o em EXCECOES neste teste.'
  );
});

test('salvarTransacoes grava o array global e devolve true', () => {
  const s = carregarApp();
  s.transacoes = [
    { id: 't1', categoria: 'receita', valor: 100, banco: 'Nubank', mes: 0, ano: 2026 },
  ];
  assert.equal(s.salvarTransacoes(), true);
  const lido = JSON.parse(s.localStorage.getItem('futurorico_transacoes'));
  assert.equal(lido.length, 1);
  assert.equal(lido[0].id, 't1');
});

test('salvarTransacoes devolve false quando a gravação falha (o chamador aborta)', () => {
  const s = carregarApp();
  s.transacoes = [{ id: 't1', categoria: 'receita', valor: 100, mes: 0, ano: 2026 }];
  s.localStorage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  assert.equal(
    s.salvarTransacoes(),
    false,
    'sem isto, executarInsercao/executarEdicao seguiriam como se tivesse dado certo'
  );
  assert.equal(s.__ultimoToast.tipo, 'erro', 'e o usuário precisa saber');
});

test('flush só é disparado quando pedido', () => {
  const s = carregarApp();
  s.transacoes = [];
  let flushes = 0;
  s.AppliqueiCloudSync = {
    forceFlush() {
      flushes++;
    },
  };

  s.salvarTransacoes();
  assert.equal(flushes, 0, 'o default não força flush — o interceptador já agenda o push');

  s.salvarTransacoes({ flush: true });
  assert.equal(flushes, 1, 'flush:true cancela o debounce e empurra na hora');
});
