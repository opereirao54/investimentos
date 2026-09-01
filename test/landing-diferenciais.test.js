'use strict';

// A landing: a história em quatro atos, os prints reais e a linguagem jurídica.
//
// Três coisas foram pedidas e as três podem regredir em silêncio numa
// reescrita de marketing:
//
//   1. a carteira sugerida e os investimentos com destaque próprio;
//   2. prints das telas REAIS do sistema, não mockups desenhados;
//   3. cuidado jurídico junto do que fala de investimento.
//
// O item 1 mudou de FORMA sem mudar de exigência. As duas seções "Diferencial
// 1/2" viraram quatro atos de um palco só (onde o dinheiro está → o mês →
// a carteira → o próximo aporte), porque empilhadas elas liam-se como fila.
// O que este arquivo trava continua a ser o mesmo: os dois assuntos têm
// destaque próprio, são alcançáveis por âncora, vêm ANTES da grade de
// funcionalidades, e o aviso de risco acompanha quem fala de investimento.
// A carteira sugerida ganhou uma exigência a mais que não tinha: é o ÚLTIMO
// ato, o clímax — é o diferencial da casa e não pode voltar para o meio.
//
// O item 3 é o que dói caro. No Brasil, recomendar valor mobiliário de forma
// individualizada é atividade regulada — consultoria (Resolução CVM 19) e
// análise (Resolução CVM 20) exigem registro. Uma landing que diga "nossa
// equipe recomenda os melhores ativos para você" descreve, em texto de venda,
// uma atividade que a empresa não exerce; e contradiz o próprio aviso de risco
// que o app exibe. Este arquivo trava o vocabulário nos dois lados.
//
// NÃO substitui revisão jurídica. Trava o que já foi decidido; texto novo
// continua tendo de passar por um advogado.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const LP = fs.readFileSync(path.join(ROOT, 'landing.html'), 'utf8');
const DUVIDAS = fs.readFileSync(path.join(ROOT, 'web/appliquei-duvidas.js'), 'utf8');
const DISCLAIMER = require('../web/appliquei-disclaimer.js');

/** O HTML sem os comentários — o que o visitante realmente lê. */
const VISIVEL = LP.replace(/<!--[\s\S]*?-->/g, '');

// ---------------------------------------------------------------------------
// 1. Os dois diferenciais
// ---------------------------------------------------------------------------

test('a história tem seção própria, ancorável, e cada ato tem id', () => {
  assert.match(VISIVEL, /<section class="palco" id="historia">/);
  assert.match(VISIVEL, /href="#historia"/, 'e entrada no menu');
  for (const n of [1, 2, 3, 4]) {
    assert.match(VISIVEL, new RegExp(`id="ato-${n}"`), `ato ${n} sem id`);
  }
  // A carteira sugerida é o que a casa vende: continua a ter âncora própria e
  // lugar no menu, como tinha quando era uma seção inteira.
  assert.match(VISIVEL, /id="proximo-passo"/);
  assert.match(VISIVEL, /href="#proximo-passo"/, 'carteira sugerida no menu');
});

test('a história vem ANTES da grade de funcionalidades', () => {
  // Enterrada depois da lista de funcionalidades, deixa de ser destaque.
  const iHist = VISIVEL.indexOf('id="historia"');
  const iFunc = VISIVEL.indexOf('id="funcionalidades"');
  assert.ok(iHist > -1 && iFunc > -1);
  assert.ok(iHist < iFunc, 'a história vem antes da grade');
});

test('os quatro atos estão na ordem, e a carteira sugerida é o clímax', () => {
  const pos = [1, 2, 3, 4].map((n) => VISIVEL.indexOf(`id="ato-${n}"`));
  for (let i = 1; i < pos.length; i++) {
    assert.ok(pos[i] > pos[i - 1], `ato ${i + 1} fora de ordem`);
  }
  // O ato do próximo aporte é o ÚLTIMO — voltá-lo para o meio devolve o
  // diferencial da casa à posição em que competia com o resto.
  const iCarteira = VISIVEL.indexOf('id="proximo-passo"');
  assert.ok(iCarteira > pos[2], 'a carteira sugerida tem de ser o último ato');
  assert.ok(iCarteira < VISIVEL.indexOf('id="funcionalidades"'));
});

test('o palco nasce completo no HTML — o script só o promove', () => {
  // Se o JS não correr (falha de rede, tela estreita, reduced-motion), a
  // página tem de continuar inteira. Por isso os quatro prints e os quatro
  // textos moram no HTML, e a classe que liga o palco NÃO é escrita aqui.
  const palco = VISIVEL.slice(
    VISIVEL.indexOf('id="historia"'),
    VISIVEL.indexOf('id="aviso-carteira"')
  );
  assert.equal(
    (palco.match(/<figure class="ato-fig">/g) || []).length,
    4,
    'os quatro prints têm de estar no HTML, não injetados por script'
  );
  // Procurar a string solta apanharia as próprias regras de CSS
  // (`.palco--vivo .palco-corpo { … }`), que TÊM de existir. O que não pode
  // existir é a classe num atributo de elemento — aí o palco nasceria montado
  // e o fallback morreria com ele.
  assert.ok(
    !/class="[^"]*palco--vivo/.test(VISIVEL),
    'a classe do palco é adicionada por JS: escrevê-la no HTML quebra o fallback'
  );
});

// ---------------------------------------------------------------------------
// 2. Prints reais
// ---------------------------------------------------------------------------

test('as imagens da página são prints do sistema, e existem no repositório', () => {
  const srcs = [...VISIVEL.matchAll(/(?:src|srcset)="(prints\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.length >= 10, `esperava ao menos 10 prints, achei ${srcs.length}`);
  for (const src of new Set(srcs)) {
    assert.ok(fs.existsSync(path.join(ROOT, src)), `print ausente no repositório: ${src}`);
  }
});

test('todo print no repositório é usado pela página', () => {
  // Print que ninguém referencia é peso morto que ninguém percebe: entra no
  // deploy, é servido, e some da cabeça de quem o gerou. A varredura vale nos
  // dois sentidos — o teste acima cobra que todo src exista, este cobra que
  // todo arquivo seja usado.
  const usados = new Set(
    [...VISIVEL.matchAll(/(?:src|srcset)="prints\/([^"]+)"/g)].map((m) => m[1])
  );
  for (const arq of fs.readdirSync(path.join(ROOT, 'prints'))) {
    assert.ok(usados.has(arq), `print sem uso na landing: prints/${arq}`);
  }
});

test('o mockup desenhado à mão saiu do hero', () => {
  // Havia um "preview" em divs, com barras de CSS no lugar do gráfico e
  // números inventados. Print de tela real foi o que se pediu.
  assert.ok(!VISIVEL.includes('class="preview"'), 'a maquete falsa tem de sair');
  assert.ok(!VISIVEL.includes('class="preview-body"'));
  assert.match(VISIVEL, /<section class="hero">[\s\S]*?src="prints\//, 'o hero mostra um print');
});

test('toda imagem tem alt e dimensões declaradas', () => {
  // Sem width/height o texto pula quando o print carrega.
  //
  // `alt=""` é exigido, mas pode ser VAZIO: o ícone do rodapé fica ao lado do
  // wordmark que já diz "Appliquei", e descrevê-lo de novo faria o leitor de
  // tela anunciar a marca duas vezes. O que não pode é o atributo faltar —
  // aí o leitor lê o nome do arquivo.
  for (const tag of VISIVEL.match(/<img[^>]*>/g) || []) {
    assert.match(tag, /\salt="/, `img sem alt: ${tag.slice(0, 80)}`);
    assert.match(tag, /width="\d+"/, `img sem width: ${tag.slice(0, 80)}`);
    assert.match(tag, /height="\d+"/, `img sem height: ${tag.slice(0, 80)}`);
  }
});

test('todo print tem alt descritivo — alt vazio só para o que é decoração', () => {
  for (const tag of VISIVEL.match(/<img[^>]*>/g) || []) {
    if (!/src="prints\//.test(tag)) continue;
    const alt = (tag.match(/alt="([^"]*)"/) || [, ''])[1];
    assert.ok(alt.length > 30, `print com alt fraco: ${tag.slice(0, 80)}`);
  }
});

test('a página diz que os dados dos prints são de demonstração', () => {
  // A tela é real; os valores não são de um cliente. Dizer isso evita que o
  // print pareça patrimônio de alguém — e que alguém leia como resultado
  // prometido.
  const n = (VISIVEL.match(/Dados de demonstração/g) || []).length;
  assert.ok(n >= 3, `esperava a ressalva em ao menos 3 prints, achei ${n}`);
});

// ---------------------------------------------------------------------------
// 3. O cuidado jurídico
// ---------------------------------------------------------------------------

test('a página nega explicitamente as três atividades reguladas', () => {
  for (const termo of [
    /não é consultoria nem análise de valores mobiliários/i,
    /não faz recomendação individualizada/i,
    /caráter informativo e educacional|material informativo e educacional/i,
  ]) {
    assert.match(VISIVEL, termo, `falta a negativa: ${termo}`);
  }
});

test('o aviso de risco encosta no ato da carteira, não fica só no rodapé', () => {
  // Antes vivia dentro da seção da carteira. Agora é banda própria — mas tem
  // de continuar colada ao ato que ela qualifica: entre o fim da história e o
  // início da grade de funcionalidades. Empurrada para depois da grade, ou
  // para o rodapé, deixa de ser lida por quem acabou de ver a alocação.
  const iHist = VISIVEL.indexOf('id="historia"');
  const iAviso = VISIVEL.indexOf('id="aviso-carteira"');
  const iFunc = VISIVEL.indexOf('id="funcionalidades"');
  assert.ok(iAviso > iHist, 'o aviso vem depois da história');
  assert.ok(iAviso < iFunc, 'e ANTES da grade — nada se intromete entre os dois');

  const banda = VISIVEL.slice(iAviso, iFunc);
  assert.match(banda, /class="aviso"/, 'o aviso acompanha o que ele qualifica');
  assert.match(banda, /id="lpRiscoWrap"/, 'com o documento completo à mão');
});

test('o texto do aviso vem do arquivo do app, não de uma cópia', () => {
  // Duas cópias divergem na primeira revisão jurídica, e a desatualizada é
  // justamente a que o visitante leu antes de assinar.
  assert.match(LP, /<script src="web\/appliquei-disclaimer\.js">/);
  assert.match(LP, /disclaimerHtmlBloco\('lpRisco'\)/);
  assert.ok(
    !VISIVEL.includes(DISCLAIMER.DISCLAIMER_RESUMO),
    'o resumo não pode estar escrito à mão no HTML — é para vir do arquivo'
  );
});

test('sem promessa de retorno em lugar nenhum', () => {
  const proibidos = [
    /rentabilidade garantida/i,
    /retorno garantido/i,
    /lucro garantido/i,
    /ganho garantido/i,
    /melhores ativos para você/i,
    /nós indicamos o que comprar/i,
    /alocação ideal/i,
    /nossa equipe de consultoria/i,
  ];
  for (const re of proibidos) {
    assert.ok(!re.test(VISIVEL), `linguagem de risco na landing: ${re}`);
  }
});

test('a aba chama-se "sugerida"; a landing não a promove como "recomendada"', () => {
  // A diferença entre as duas palavras é exatamente a que importa aqui, e o
  // nome na tela é "Carteira sugerida".
  // Sem a flag `i` a trava só pegava o nome próprio: "uma carteira recomendada"
  // no meio de uma frase de venda — que é como um copywriter escreveria —
  // passava batido.
  assert.ok(!/carteira[s]? recomendada/i.test(VISIVEL), 'use "Carteira sugerida"');
  assert.ok(!/recomendamos (o|a|os|as|que)/i.test(VISIVEL), 'a página não recomenda ativo');
  assert.match(VISIVEL, /Carteira sugerida/);
});

test('o rodapé nega ser instituição financeira e corretora', () => {
  const legal = VISIVEL.slice(VISIVEL.indexOf('class="legal"'));
  assert.match(legal, /Não somos instituição financeira, corretora/i);
  assert.match(legal, /[Rr]entabilidade passada não garante rentabilidade futura/);
  assert.match(legal, /perdas?, inclusive do capital investido/i);
});

test('o FAQ do app não desmente o aviso que a mesma tela exibe', () => {
  // O texto antigo dizia "a carteira modelo é definida e revisada pela nossa
  // equipe de consultoria" — que descreve atividade regulada e contradiz a
  // seção 11 do próprio disclaimer ("ausência de recomendação automática
  // individualizada"), exibida na MESMA aba.
  assert.ok(!/equipe de consultoria/.test(DUVIDAS));
  assert.ok(!/alocação ideal/.test(DUVIDAS));
  assert.match(DUVIDAS, /não é consultoria nem análise de valores mobiliários/);
});

test('o disclaimer do app continua tendo as seções que a landing promete abrir', () => {
  assert.ok(DISCLAIMER.DISCLAIMER_SECOES.length >= 13);
  const titulos = DISCLAIMER.DISCLAIMER_SECOES.map((s) => s.titulo).join(' | ');
  assert.match(titulos, /Ausência de recomendação automática individualizada/);
  assert.match(titulos, /Ausência de garantia de rentabilidade/);
});
