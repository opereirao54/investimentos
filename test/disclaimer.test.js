'use strict';

// O disclaimer é documento legal: o que se cobra aqui não é implementação, é
// que o texto CHEGUE ao usuário e chegue inteiro. Um parágrafo perdido numa
// refatoração é um risco jurídico, não um bug de layout.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const disc = require('../web/appliquei-disclaimer.js');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');

test('o documento começa FECHADO — o resumo é o que se lê sem clicar', () => {
  const bloco = disc.disclaimerHtmlBloco('cartRisco');
  assert.match(
    bloco,
    /id="cartRiscoCorpo" hidden/,
    'o corpo do documento tem de nascer com [hidden]: treze seções abertas empurram a carteira para fora da tela'
  );
  assert.match(bloco, /aria-expanded="false"/);
  assert.ok(
    bloco.indexOf(disc.DISCLAIMER_RESUMO) !== -1,
    'o resumo fica FORA do bloco escondido — é o único trecho que o usuário lê se nunca expandir'
  );
});

test('as treze seções do documento estão todas lá', () => {
  const titulos = disc.DISCLAIMER_SECOES.map((s) => s.titulo);
  const esperados = [
    'Ausência de garantia de rentabilidade',
    'Projeções e simulações',
    'Carteiras e sugestões de investimento',
    'Perfil de investidor',
    'Riscos dos investimentos',
    'Rentabilidade passada',
    'Inteligência Artificial',
    'Responsabilidade pela decisão',
    'Informações de terceiros',
    'Não constituição de garantia',
    'Ausência de recomendação automática individualizada',
    'Conflitos de interesse',
    'Decisão consciente',
  ];
  assert.deepEqual(titulos, esperados, 'seção removida ou reordenada altera o documento legal');
});

test('o texto integral é renderizado, numerado e escapado', () => {
  const html = disc.disclaimerHtmlCompleto();
  disc.DISCLAIMER_SECOES.forEach((secao, i) => {
    assert.ok(
      html.indexOf('<span class="disc-num">' + (i + 1) + '</span>') !== -1,
      `falta o número da seção ${i + 1}`
    );
    (secao.paragrafos || []).concat(secao.depois || []).forEach((p) => {
      const escapado = p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      assert.ok(html.indexOf(escapado) !== -1, `parágrafo ausente na seção "${secao.titulo}"`);
    });
    (secao.lista || []).forEach((item) => {
      assert.ok(html.indexOf('<li>' + item + '</li>') !== -1, `item de lista ausente: ${item}`);
    });
  });
});

test('os dez riscos nomeados continuam nomeados', () => {
  const riscos = disc.DISCLAIMER_SECOES.find((s) => s.titulo === 'Riscos dos investimentos');
  assert.equal(riscos.lista.length, 10);
  [
    'mercado',
    'crédito',
    'liquidez',
    'inflação',
    'cambial',
    'concentração',
    'taxa de juros',
    'operacional',
    'regulatório',
    'perda do capital',
  ].forEach((r) => {
    assert.ok(
      riscos.lista.some((item) => item.indexOf(r) !== -1),
      `risco "${r}" saiu da lista`
    );
  });
});

test('a data de última atualização aparece no documento', () => {
  assert.match(disc.DISCLAIMER_ATUALIZADO_EM, /\d{1,2} de \w+ de \d{4}/);
  assert.ok(
    disc
      .disclaimerHtmlBloco('x')
      .indexOf('Última atualização: ' + disc.DISCLAIMER_ATUALIZADO_EM) !== -1
  );
});

test('a página tem os dois destinos: a carteira e o regulamento', () => {
  assert.ok(
    HTML.indexOf('id="cartRiscoWrap"') !== -1,
    'sumiu o ponto do disclaimer na Carteira sugerida'
  );
  assert.ok(
    HTML.indexOf('id="dsRegulamentoWrap"') !== -1,
    'sumiu o ponto do disclaimer no Regulamento'
  );
  assert.ok(HTML.indexOf('id="dsConteudoRegulamento"') !== -1);
  assert.ok(
    HTML.indexOf("trocarTabDuvidas('regulamento')") !== -1,
    'a aba Regulamento não tem como ser aberta'
  );
  assert.ok(
    HTML.indexOf('appliquei-disclaimer.js') !== -1,
    'o script do disclaimer não é carregado — os dois pontos ficariam vazios'
  );
});

test('o texto do documento não está escrito à mão no HTML', () => {
  // Duas cópias divergem na primeira revisão jurídica, e a desatualizada é a
  // que o usuário leu. O HTML tem os slots; o texto vive num lugar só.
  const trechos = [disc.DISCLAIMER_RESUMO, disc.DISCLAIMER_ABERTURA];
  trechos.forEach((t) => {
    assert.equal(HTML.indexOf(t), -1, 'trecho do disclaimer duplicado no HTML: ' + t.slice(0, 50));
  });
});

test('as três abas de Dúvidas & Sugestões estão na tabela do seletor', () => {
  const src = fs.readFileSync(path.join(ROOT, 'web/appliquei-duvidas.js'), 'utf8');
  ['faq', 'sugestao', 'regulamento'].forEach((chave) => {
    assert.ok(src.indexOf("chave: '" + chave + "'") !== -1, `aba "${chave}" fora de DS_TABS`);
  });
});
