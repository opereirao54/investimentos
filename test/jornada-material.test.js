'use strict';

// Material de estudo da Jornada Financeira.
//
// Os oito módulos tinham título, uma frase e dois objetivos — e o modal
// terminava num aviso de "conteúdo em desenvolvimento". A pessoa clicava para
// estudar e encontrava a promessa de que um dia haveria o que estudar.
//
// O conteúdo agora existe, e é DADO (appliquei-jornada-conteudo.js), não HTML.
// Estes testes cuidam de três coisas que quebram em silêncio:
//
//  1. COBERTURA — um módulo novo em JORNADA_MODULOS sem entrada no conteúdo
//     abre a tela com um aviso de material faltando. Melhor descobrir aqui.
//  2. ESCAPE — o arquivo de conteúdo vai ser editado por quem escreve. Um `<`
//     digitado sem querer não pode virar markup na tela do usuário.
//  3. HONESTIDADE — número de mercado ou alíquota apresentados como fato viram
//     mentira na próxima reunião do Copom. O material fala de mecânica; todo
//     valor é exemplo, e o aviso de regras acompanha todo módulo.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SRC_CONTEUDO = fs.readFileSync(path.join(ROOT, 'web/appliquei-jornada-conteudo.js'), 'utf8');
const SRC_JORNADA = fs.readFileSync(path.join(ROOT, 'web/appliquei-jornada.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');

// O conteúdo é um arquivo de dados puro: dá para avaliar sem DOM nenhum.
const { JORNADA_CONTEUDO, JORNADA_AVISO_REGRAS } = new Function(
  SRC_CONTEUDO + '\nreturn { JORNADA_CONTEUDO, JORNADA_AVISO_REGRAS };'
)();

// Os módulos vivem em appliquei-jornada.js; extraímos só a lista.
const JORNADA_MODULOS = (() => {
  const ini = SRC_JORNADA.indexOf('var JORNADA_MODULOS');
  const fim = SRC_JORNADA.indexOf('var JORNADA_STORAGE_KEY');
  return new Function(SRC_JORNADA.slice(ini, fim) + '\nreturn JORNADA_MODULOS;')();
})();

// Renderizador, isolado do resto do arquivo (que toca localStorage e DOM).
const render = (() => {
  const ini = SRC_JORNADA.indexOf('function jornadaEscapar');
  const fim = SRC_JORNADA.indexOf('var jornadaModuloAberto');
  assert.ok(ini > -1 && fim > ini, 'o renderizador precisa estar em appliquei-jornada.js');
  return new Function(
    'JORNADA_CONTEUDO',
    SRC_JORNADA.slice(ini, fim) +
      '\nreturn { jornadaEscapar, jornadaTexto, jornadaBlocoHtml, jornadaMaterialHtml };'
  )(JORNADA_CONTEUDO);
})();

const TIPOS = ['ideia', 'h', 'p', 'lista', 'passos', 'chave', 'conta', 'alerta', 'noapp'];

// ---------------------------------------------------------------------------
// Cobertura
// ---------------------------------------------------------------------------

test('todo módulo da trilha tem material', () => {
  const sem = JORNADA_MODULOS.filter((m) => !JORNADA_CONTEUDO[m.id]).map((m) => m.id);
  assert.deepEqual(
    sem,
    [],
    `módulos sem material: ${sem.join(', ')}. Cadastrar o módulo sem escrever o ` +
      `texto abre a tela com um aviso de "material em preparação" — que é ` +
      `exatamente o que este trabalho veio remover.`
  );
});

test('nenhum material órfão — todo conteúdo pertence a um módulo', () => {
  const ids = new Set(JORNADA_MODULOS.map((m) => m.id));
  const orfaos = Object.keys(JORNADA_CONTEUDO).filter((k) => !ids.has(k));
  assert.deepEqual(orfaos, [], `material sem módulo correspondente: ${orfaos.join(', ')}`);
});

for (const m of JORNADA_MODULOS) {
  test(`${m.id} (${m.titulo}): o material está completo`, () => {
    const mat = JORNADA_CONTEUDO[m.id];
    assert.ok(mat, 'sem material');
    assert.ok(typeof mat.resumo === 'string' && mat.resumo.length > 40, 'resumo curto demais');
    assert.ok(Number.isInteger(mat.tempo) && mat.tempo > 0, 'tempo de leitura ausente');
    assert.ok(Array.isArray(mat.blocos) && mat.blocos.length >= 8, 'material raso demais');

    const tipos = mat.blocos.map((b) => b.t);
    for (const t of tipos) assert.ok(TIPOS.includes(t), `tipo de bloco desconhecido: ${t}`);
    assert.ok(tipos.includes('ideia'), 'falta a frase que resume o módulo');
    assert.ok(tipos.filter((t) => t === 'h').length >= 2, 'material sem seções');
    assert.ok(
      tipos.includes('noapp'),
      'todo módulo precisa dizer o que fazer DENTRO do app — é o que ' +
        'diferencia este material de um texto genérico sobre finanças'
    );
  });
}

test('todo bloco tem os campos que o renderizador espera', () => {
  const faltas = [];
  for (const [id, mat] of Object.entries(JORNADA_CONTEUDO)) {
    mat.blocos.forEach((b, i) => {
      const falta = (campo) => faltas.push(`${id}[${i}] ${b.t}: sem ${campo}`);
      if (['ideia', 'h', 'p'].includes(b.t) && !b.texto) falta('texto');
      if (['lista', 'passos'].includes(b.t) && !(b.itens || []).length) falta('itens');
      if (b.t === 'chave' && (!b.termo || !b.texto)) falta('termo/texto');
      if (b.t === 'alerta' && !b.texto) falta('texto');
      if (b.t === 'noapp' && (!b.aba || !b.texto)) falta('aba/texto');
      if (b.t === 'conta') {
        if (!(b.linhas || []).length) falta('linhas');
        (b.linhas || []).forEach((l, j) => {
          if (!Array.isArray(l) || l.length < 2) faltas.push(`${id}[${i}] conta: linha ${j} torta`);
        });
      }
    });
  }
  assert.deepEqual(faltas, [], faltas.join('\n'));
});

test('cada exemplo numérico destaca no máximo uma linha de resultado', () => {
  // Duas linhas verdes numa conta é o mesmo que nenhuma: o olho não sabe qual
  // é a resposta.
  const erros = [];
  for (const [id, mat] of Object.entries(JORNADA_CONTEUDO)) {
    mat.blocos.forEach((b, i) => {
      if (b.t !== 'conta') return;
      const n = (b.linhas || []).filter((l) => l[2]).length;
      if (n > 1) erros.push(`${id}[${i}]: ${n} linhas de destaque`);
    });
  }
  assert.deepEqual(erros, [], erros.join('\n'));
});

// ---------------------------------------------------------------------------
// Escape e marcação
// ---------------------------------------------------------------------------

test('o renderizador escapa HTML do conteúdo', () => {
  const html = render.jornadaBlocoHtml({
    t: 'p',
    texto: 'risco de <script>alert(1)</script> & "aspas"',
  });
  assert.ok(!html.includes('<script>'), 'HTML do conteúdo não pode chegar cru à tela');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&quot;'));
});

test('a ênfase **assim** é a única marcação aceita', () => {
  const html = render.jornadaTexto('vale **muito** a pena');
  assert.equal(html, 'vale <strong>muito</strong> a pena');
  // E ela continua valendo depois do escape, não antes: senão dava para
  // injetar markup escrevendo `**<b>`.
  const perigo = render.jornadaTexto('**<b>oi</b>**');
  assert.ok(perigo.includes('&lt;b&gt;'));
  assert.equal(perigo.match(/<strong>/g).length, 1);
});

test('nenhuma ênfase fica aberta no material', () => {
  // `**` ímpar num texto deixa asteriscos visíveis na tela.
  const erros = [];
  for (const [id, mat] of Object.entries(JORNADA_CONTEUDO)) {
    const textos = JSON.stringify(mat).match(/"[^"]*"/g) || [];
    textos.forEach((t) => {
      const n = (t.match(/\*\*/g) || []).length;
      if (n % 2 !== 0) erros.push(`${id}: ênfase aberta em ${t.slice(0, 60)}`);
    });
  }
  assert.deepEqual(erros, [], erros.join('\n'));
});

test('tipo de bloco desconhecido não derruba a tela', () => {
  assert.equal(render.jornadaBlocoHtml({ t: 'inexistente', texto: 'x' }), '');
  assert.equal(render.jornadaBlocoHtml(null), '');
  assert.equal(render.jornadaBlocoHtml({}), '');
});

test('módulo sem material mostra aviso, não tela em branco', () => {
  const html = render.jornadaMaterialHtml('modulo-que-nao-existe');
  assert.match(html, /Material em preparação/);
});

test('todos os oito módulos renderizam sem erro e com conteúdo de verdade', () => {
  for (const m of JORNADA_MODULOS) {
    const html = render.jornadaMaterialHtml(m.id);
    assert.ok(html.length > 2000, `${m.id}: material curto demais (${html.length} chars)`);
    assert.ok(!/undefined|\[object Object\]/.test(html), `${m.id}: buraco no render`);
    assert.ok(!/Material em preparação/.test(html), `${m.id}: caiu no aviso de material faltando`);
  }
});

// ---------------------------------------------------------------------------
// Honestidade do conteúdo
// ---------------------------------------------------------------------------

test('o aviso sobre regras que mudam existe e é exibido', () => {
  assert.ok(JORNADA_AVISO_REGRAS.length > 150);
  assert.match(JORNADA_AVISO_REGRAS, /mudam/, 'tem de dizer que as regras mudam');
  assert.match(
    JORNADA_AVISO_REGRAS,
    /não é recomendação/i,
    'material sobre dinheiro sem essa frase é problema'
  );
  assert.match(SRC_JORNADA, /jornadaModalAvisoRegras/, 'o aviso precisa ir para a tela');
  assert.match(HTML, /id="jornadaModalAvisoRegras"/);
});

test('valores de mercado aparecem como exemplo, não como fato', () => {
  // "o CDI está em 10%" envelhece em semanas e vira desinformação. "supondo
  // CDI de 10%" continua correto para sempre.
  const suspeitos = [];
  for (const [id, mat] of Object.entries(JORNADA_CONTEUDO)) {
    for (const b of mat.blocos) {
      if (b.t !== 'conta') continue;
      const texto = [b.titulo || '', b.nota || ''].join(' ');
      const linhas = (b.linhas || []).map((l) => l[0]).join(' ');
      const tudo = texto + ' ' + linhas;
      // Só o que envelhece: percentual ligado a RENDIMENTO. "70% da sobra" é
      // regra do próprio material e não depende do Copom.
      const temTaxaDeMercado =
        /\d+(?:,\d+)?%\s*(a\.a\.|a\.m\.|do CDI)|\b(CDI|Selic|IPCA|inflação)\b/i.test(tudo);
      const marcado = /supondo|exemplo|estimad|cenário|hipótes|referência/i.test(tudo);
      if (temTaxaDeMercado && !marcado) suspeitos.push(`${id}: "${b.titulo}"`);
    }
  }
  assert.deepEqual(
    suspeitos,
    [],
    `conta com percentual sem marcar que é hipótese:\n  ${suspeitos.join('\n  ')}`
  );
});

test('o material não promete rentabilidade nem manda comprar', () => {
  const proibido =
    /\b(garante retorno|rentabilidade garantida|lucro garantido|vai valorizar|compre agora|dica quente|投)/i;
  for (const [id, mat] of Object.entries(JORNADA_CONTEUDO)) {
    const texto = JSON.stringify(mat);
    assert.ok(!proibido.test(texto), `${id}: linguagem de promessa no material`);
  }
});

// ---------------------------------------------------------------------------
// A tela
// ---------------------------------------------------------------------------

test('o aviso de "conteúdo em desenvolvimento" saiu do modal', () => {
  assert.ok(
    !HTML.includes('Conteúdo em desenvolvimento'),
    'era a única coisa que o modal dizia sobre o material — não pode voltar'
  );
});

test('o leitor tem topo e rodapé fixos', () => {
  // Com doze minutos de texto no meio, rolar de volta ao topo para marcar como
  // concluído é atrito puro.
  assert.match(HTML, /class="jm-folha"/);
  assert.match(HTML, /class="jm-rolagem" id="jornadaModalRolagem"/);
  assert.match(HTML, /class="jm-rodape"/);
  assert.match(HTML, /\.jm-folha \{[^}]*flex-direction: column/s);
  assert.match(HTML, /\.jm-rolagem \{ overflow-y: auto/);
});

test('reabrir um módulo começa do início do texto', () => {
  assert.match(
    SRC_JORNADA,
    /rolagem\.scrollTop = 0/,
    'sem isto, reabrir cai no meio da leitura anterior'
  );
});

test('cada tipo de bloco tem estilo próprio no CSS', () => {
  for (const classe of [
    'jm-ideia',
    'jm-h',
    'jm-p',
    'jm-lista',
    'jm-passos',
    'jm-chave',
    'jm-conta',
    'jm-alerta',
    'jm-noapp',
  ]) {
    assert.match(HTML, new RegExp('\\.' + classe + '[ ,{:]'), `${classe} sem estilo`);
  }
});

test('o material carrega ANTES do renderizador', () => {
  // jornada.js lê JORNADA_CONTEUDO em parse-time do primeiro clique; inverter
  // a ordem das tags deixaria todo módulo com "material em preparação".
  const iConteudo = HTML.indexOf('appliquei-jornada-conteudo.js');
  const iJornada = HTML.indexOf('appliquei-jornada.js?');
  assert.ok(iConteudo > -1 && iJornada > -1, 'os dois scripts precisam estar no HTML');
  assert.ok(iConteudo < iJornada, 'o conteúdo tem de vir primeiro');
});
