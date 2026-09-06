'use strict';

/**
 * Travas da tela do Applicash.
 *
 * A página foi reconstruída porque servia ao usuário errado: era um painel
 * para quem já tinha indicações (KPIs, pizza, tabela de seis colunas) com um
 * empty state improvisado por cima — e a esmagadora maioria de quem abre não
 * indicou ninguém ainda.
 *
 * O harness de DOM deste repositório devolve um nó para QUALQUER id (ver
 * test/drawer-operacao-dom.test.js), então renderizar de verdade não pega
 * elemento inexistente. A trava aqui é de CONTRATO, lida do HTML e do JS
 * reais: todo id que o script toca existe, todo onclick resolve, e as três
 * regressões que a reconstrução corrigiu não podem voltar.
 */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'web/appliquei-applicash.js'), 'utf8');

/** Só a copy que o usuário lê — comentários explicam o que FOI removido. */
function semComentarios(txt) {
  return txt
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const SECAO = HTML.slice(
  HTML.indexOf('<section id="applicash"'),
  HTML.indexOf('<section id="duvidas_sugestoes"')
);
const IDS_NO_HTML = new Set(Array.from(HTML.matchAll(/\sid="([^"]+)"/g), (m) => m[1]));

test('todo id que o script toca existe no HTML', () => {
  const usados = new Set();
  const padroes = [
    /apcEl\(\s*'([^']+)'/g,
    /apcTexto\(\s*'([^']+)'/g,
    /apcMostrar\(\s*'([^']+)'/g,
    /getElementById\(\s*'([^']+)'/g,
    /\[\s*'(apc[A-Za-z]+)'/g, // a lista de botões em apcHabilitarAcoes
  ];
  for (const p of padroes) for (const m of JS.matchAll(p)) usados.add(m[1]);

  assert.ok(usados.size > 20, 'esperava dezenas de ids — o extrator quebrou?');
  const faltando = [...usados].filter((id) => !IDS_NO_HTML.has(id));
  assert.deepEqual(faltando, [], 'ids referenciados pelo JS que não existem no HTML');
});

test('todo onclick da seção resolve para uma função declarada', () => {
  const chamadas = new Set(
    Array.from(SECAO.matchAll(/onclick="([a-zA-Z_$][\w$]*)\(/g), (m) => m[1])
  );
  const declaradas = new Set(
    Array.from(JS.matchAll(/^(?:async )?function ([a-zA-Z_$][\w$]*)/gm), (m) => m[1])
  );
  assert.ok(chamadas.size >= 3, 'a seção precisa ter handlers');
  const orfas = [...chamadas].filter((f) => !declaradas.has(f));
  assert.deepEqual(orfas, [], 'onclick sem função correspondente');
});

test('a tela não mascara de novo um e-mail que o servidor já mascarou', () => {
  // REGRESSÃO: api/billing/me.js manda `maskEmail(...)` → "j*o***@g***l.com".
  // O cliente aplicava `mascararNome()` por cima e produzia "J**************m"
  // em TODA linha — todas idênticas, e a tabela perdia a única função que
  // tinha, distinguir uma pessoa da outra.
  assert.ok(
    !/function mascararNome/.test(JS),
    'mascararNome foi removida de propósito: o servidor já entrega mascarado'
  );
  assert.ok(
    !/mascararNome\s*\(/.test(JS),
    'nenhuma chamada de máscara pode incidir sobre dado já mascarado'
  );
});

test('as cinco fases existem no HTML e no script', () => {
  // A composição troca por [data-fase]; sem os blocos correspondentes a
  // página fica em branco em alguma fase.
  for (const fase of ['deslogado', 'erro', 'vazio', 'ativo']) {
    assert.match(
      SECAO,
      new RegExp('data-so="[^"]*' + fase),
      'falta bloco marcado para a fase ' + fase
    );
    assert.match(HTML, new RegExp('data-fase="' + fase + '"\\]'), 'falta CSS da fase ' + fase);
  }
  assert.match(SECAO, /data-fase="carregando"/, 'a seção precisa nascer em carregando');
  for (const fase of ['carregando', 'deslogado', 'erro', 'vazio', 'ativo']) {
    assert.ok(JS.includes("apcSetFase('" + fase + "')"), 'o script nunca entra na fase ' + fase);
  }
});

test('os quatro estados de dados são tratados de verdade', () => {
  // Antes: "Carregando…" era escrito DENTRO do slot do cupom, em 36px
  // monoespaçado — o usuário lia aquilo como se fosse o código dele. E o
  // erro era engolido: a tela desenhava o cache antigo sem avisar.
  assert.ok(
    !/'Carregando…'|"Carregando…"/.test(semComentarios(JS)),
    'texto de estado não pode ser renderizado como se fosse conteúdo'
  );
  assert.match(SECAO, /id="apcErroFaixa"[^>]*role="alert"/, 'o erro precisa de faixa com role');
  assert.match(SECAO, /onclick="recarregarApplicash\(\)"/, 'o erro precisa de saída (retry)');
  assert.match(JS, /apcEstado\.atualizadoEm/, 'dado velho tem de ser rotulado com a hora');
  assert.match(HTML, /data-fase="carregando"\][^{]*\.apc-hero-code/, 'falta o skeleton');
});

test('os CTAs ficam desabilitados enquanto não há cupom', () => {
  // Clicar em Compartilhar durante o carregamento devolvia o toast "Entre na
  // sua conta para gerar o cupom" — mensagem errada para quem está logado.
  assert.match(JS, /function apcHabilitarAcoes/, 'falta o controle de habilitação');
  assert.match(JS, /apcHabilitarAcoes\(false\)/, 'nada desabilita os CTAs');
  assert.match(JS, /b\.disabled = !ligado/, 'aria-disabled sozinho não impede o clique');
  assert.match(HTML, /\.apc-hero-actions button:disabled/, 'o estado disabled precisa ser visível');
  assert.match(
    HTML,
    /\.apc-hero-actions button:focus-visible/,
    'foco visível é requisito de acessibilidade'
  );
});

test('há um CTA primário e ele é o WhatsApp', () => {
  // Eram quatro caminhos concorrentes para a mesma decisão: Compartilhar,
  // Copiar cupom, Copiar link e a própria pílula do link (que também copia).
  assert.match(SECAO, /id="apcBtnWhatsapp"/, 'falta o CTA primário');
  assert.match(JS, /wa\.me/, 'o CTA precisa abrir o WhatsApp');
  assert.ok(
    !/copiarCupomApplicash/.test(SECAO),
    'copiar o código sozinho não serve: sem o link o amigo teria de digitar'
  );
  const botoesHero = (SECAO.match(/class="btn-acao apc-cta"/g) || []).length;
  assert.equal(botoesHero, 1, 'só pode haver um CTA primário');
});

test('a tabela de indicados tem três colunas e nenhuma constante', () => {
  const cabecalhos = Array.from(SECAO.matchAll(/<th[^>]*>([^<]+)<\/th>/g), (m) => m[1].trim());
  assert.equal(cabecalhos.length, 3, 'três colunas: quem, quanto rende, situação');
  for (const morta of ['Plano contratado', 'Periodicidade']) {
    assert.ok(
      !cabecalhos.includes(morta),
      '"' + morta + '" era sempre "Mensal" — ocupava largura e forçava scroll no celular'
    );
  }
});

test('nada essencial depende só de cor', () => {
  // A pizza codificava paga/recebe apenas por cor, com a legenda desligada.
  assert.ok(!/new Chart\(/.test(JS), 'a pizza saiu — barra de progresso conta melhor a história');
  assert.ok(!/chartApplicash/.test(SECAO), 'sobrou o canvas da pizza no HTML');
  // Marco conquistado: ícone preenchido + rótulo textual, além da cor.
  assert.match(JS, /ph-fill ph-check-circle/, 'o marco feito precisa de ícone próprio');
  assert.match(JS, /apc-marco-tag/, 'o marco feito precisa de rótulo textual');
});

test('a tela não recalcula cashback por conta própria', () => {
  // Havia dois saldos na mesma página: um calculado no cliente
  // (`valorPago × 10%` somado sobre os ativos) e o `pendingDiscountCents` do
  // servidor. Números diferentes, significados diferentes, linguagem parecida.
  assert.ok(
    !/\.reduce\(/.test(JS),
    'somatório no cliente reintroduz um segundo saldo divergente do servidor'
  );
  assert.match(JS, /me\.projectedNextBillCents/, 'a próxima cobrança vem do servidor');
  assert.match(JS, /me\.totalReferralEarningsCents/, 'o acumulado vem do servidor');
});

test('a linguagem não promete dinheiro que não chega', () => {
  // O crédito ABATE na mensalidade; não é saque. "Total recebido no mês" e
  // "Lucro p/ você" faziam o usuário esperar dinheiro na conta.
  const visivel = SECAO.replace(/<!--[\s\S]*?-->/g, '');
  for (const termo of ['Total recebido', 'Lucro p/ você', 'Você recebe']) {
    assert.ok(!visivel.includes(termo), '"' + termo + '" promete saque; o crédito abate na fatura');
  }
  assert.match(visivel, /Abatido nesta fatura|abate na sua mensalidade/i);
});
