// Disclaimer de investimentos — texto legal único, exibido em dois lugares.
//
// O texto é DADO, não HTML escrito à mão. Ele aparece na aba Carteira
// sugerida (junto das recomendações, que é onde o risco importa) e na aba
// Regulamento, dentro de Dúvidas & Sugestões (que é onde se procura por um
// documento). Duas cópias do mesmo parágrafo divergiriam na primeira revisão
// jurídica, e a versão desatualizada seria justamente a que o usuário leu.
//
// Fica FECHADO por omissão: o resumo é o que se lê, o texto integral é o que
// se abre. Um bloco de treze seções aberto por padrão empurra a carteira para
// fora da tela e não é lido por ninguém.

/** Data da última revisão do texto. Atualize junto com o conteúdo. */
var DISCLAIMER_ATUALIZADO_EM = '28 de agosto de 2026';

/** Parágrafo de abertura, antes das seções numeradas. */
var DISCLAIMER_ABERTURA =
  'As informações, análises, conteúdos educacionais, simulações, projeções, ' +
  'classificações de perfil e sugestões de alocação disponibilizados pelo ' +
  'Appliquei têm caráter informativo e educacional e destinam-se exclusivamente ' +
  'a auxiliar o usuário em seu processo de conhecimento e tomada de decisão ' +
  'financeira.';

/**
 * O aviso curto — o único trecho visível com o bloco fechado.
 * É a versão que o usuário lê se nunca clicar em "ler o documento completo".
 */
var DISCLAIMER_RESUMO =
  'Investimentos envolvem riscos e podem resultar em perdas, inclusive do ' +
  'capital investido. Rentabilidade passada não garante rentabilidade futura. ' +
  'Projeções e estimativas são meramente ilustrativas e não representam ' +
  'garantia de resultados. Avalie seu perfil, objetivos e tolerância ao risco ' +
  'antes de investir.';

/**
 * As treze seções do documento, na ordem.
 * `paragrafos` são blocos de texto; `lista` vira <ul> depois deles.
 */
var DISCLAIMER_SECOES = [
  {
    titulo: 'Ausência de garantia de rentabilidade',
    paragrafos: [
      'Nenhuma informação apresentada pelo Appliquei constitui promessa, garantia ou asseguração de rentabilidade futura.',
      'Rentabilidade passada não garante rentabilidade futura.',
      'Os resultados efetivamente obtidos pelo usuário poderão ser diferentes das estimativas, projeções ou cenários apresentados na plataforma.',
      'Investimentos estão sujeitos a riscos e podem resultar em perdas, inclusive perda parcial ou total do capital investido.',
    ],
  },
  {
    titulo: 'Projeções e simulações',
    paragrafos: [
      'As projeções, simulações e estimativas apresentadas pelo Appliquei são baseadas em premissas, dados históricos, taxas hipotéticas ou informações disponíveis no momento de sua elaboração.',
      'Essas informações possuem caráter meramente ilustrativo e não representam previsão ou garantia de resultado futuro.',
      'Alterações nas condições econômicas, inflação, juros, preços dos ativos, tributação, liquidez, câmbio, condições de mercado e demais fatores podem produzir resultados significativamente diferentes dos apresentados.',
    ],
  },
  {
    titulo: 'Carteiras e sugestões de investimento',
    paragrafos: [
      'As carteiras, ativos, classes de investimento ou estratégias apresentadas na plataforma representam sugestões baseadas nas informações e premissas utilizadas pelo sistema e não devem ser interpretadas como garantia de desempenho.',
      'A indicação de determinado investimento não significa que ele seja adequado para todos os investidores.',
      'Antes de investir, o usuário deve avaliar seus próprios objetivos, situação financeira, horizonte de investimento, conhecimento e tolerância a riscos.',
    ],
  },
  {
    titulo: 'Perfil de investidor',
    paragrafos: [
      'O Appliquei poderá utilizar informações fornecidas pelo usuário para identificar um perfil de investidor, como Conservador, Moderado ou Arrojado, e apresentar conteúdos ou sugestões compatíveis com esse perfil.',
      'O perfil apresentado é uma ferramenta de apoio à decisão e não elimina os riscos dos investimentos.',
      'O usuário é responsável por fornecer informações verdadeiras, completas e atualizadas.',
      'A classificação de perfil não constitui recomendação individual definitiva e não substitui, quando aplicável, o processo de suitability exigido pela regulamentação.',
    ],
  },
  {
    titulo: 'Riscos dos investimentos',
    paragrafos: [
      'Todo investimento possui algum nível de risco.',
      'Entre os riscos que podem existir estão, entre outros:',
    ],
    lista: [
      'risco de mercado;',
      'risco de crédito;',
      'risco de liquidez;',
      'risco de inflação;',
      'risco cambial;',
      'risco de concentração;',
      'risco de taxa de juros;',
      'risco operacional;',
      'risco regulatório;',
      'risco de perda do capital investido.',
    ],
    depois: ['O nível e a natureza dos riscos variam de acordo com cada produto e estratégia.'],
  },
  {
    titulo: 'Rentabilidade passada',
    paragrafos: [
      'Eventuais informações sobre rentabilidade histórica, desempenho passado, índices, benchmarks ou resultados anteriores são apresentadas exclusivamente para fins informativos.',
      'Desempenhos passados não constituem garantia, promessa ou indicação de desempenho futuro.',
    ],
  },
  {
    titulo: 'Inteligência Artificial',
    paragrafos: [
      'Quando utilizados recursos de Inteligência Artificial, as informações produzidas pelo sistema são geradas com base nos dados, parâmetros e fontes disponíveis no momento da análise.',
      'A Inteligência Artificial pode apresentar erros, omissões, interpretações inadequadas ou informações desatualizadas.',
      'Por isso, conteúdos produzidos por IA não devem ser considerados infalíveis, suficientes ou substitutos da análise do próprio usuário ou de profissionais devidamente habilitados.',
    ],
  },
  {
    titulo: 'Responsabilidade pela decisão',
    paragrafos: [
      'A decisão de realizar, manter, alterar ou encerrar um investimento é exclusivamente do usuário.',
      'O Appliquei não garante que qualquer investimento, carteira ou estratégia apresentada seja adequada aos objetivos individuais do usuário ou produza determinado resultado.',
      'O usuário deve analisar cuidadosamente as características, custos, riscos, tributação e condições de cada investimento antes de tomar qualquer decisão.',
    ],
  },
  {
    titulo: 'Informações de terceiros',
    paragrafos: [
      'Informações provenientes de fontes externas podem estar sujeitas a alterações, erros, atrasos ou divergências.',
      'O Appliquei buscará utilizar informações consideradas confiáveis, mas não garante a exatidão, integralidade ou atualização permanente de todas as informações disponibilizadas.',
    ],
  },
  {
    titulo: 'Não constituição de garantia',
    paragrafos: ['Nenhuma informação disponibilizada pelo Appliquei deverá ser interpretada como:'],
    lista: [
      'garantia de retorno;',
      'promessa de rentabilidade;',
      'garantia de preservação do capital;',
      'recomendação de lucro;',
      'previsão certa de valorização;',
      'promessa de desempenho futuro.',
    ],
    depois: [
      'Expressões como “potencial”, “estimativa”, “projeção”, “cenário”, “possível retorno” ou similares devem ser interpretadas dentro de seu caráter hipotético e informativo.',
    ],
  },
  {
    titulo: 'Ausência de recomendação automática individualizada',
    paragrafos: [
      'As informações apresentadas pela plataforma destinam-se a auxiliar o usuário em sua educação financeira e processo de tomada de decisão.',
      'Quando uma funcionalidade puder caracterizar recomendação individualizada de produto ou serviço de investimento, sua disponibilização deverá observar a regulamentação aplicável e os procedimentos de adequação ao perfil do cliente.',
    ],
  },
  {
    titulo: 'Conflitos de interesse',
    paragrafos: [
      'O usuário deverá ser informado sobre eventuais relações comerciais, remunerações, comissões, incentivos ou outros potenciais conflitos de interesse relacionados aos produtos, serviços ou parceiros apresentados pelo Appliquei, quando aplicável.',
    ],
  },
  {
    titulo: 'Decisão consciente',
    paragrafos: [
      'Ao utilizar as funcionalidades de investimentos do Appliquei, o usuário declara estar ciente de que:',
      'Investir envolve riscos. Não existe garantia de rentabilidade. Resultados futuros podem ser diferentes das estimativas apresentadas. O usuário deve tomar suas próprias decisões de investimento de acordo com seus objetivos, situação financeira e tolerância ao risco.',
    ],
  },
];

/** Escapa texto para interpolação em HTML. */
function disclaimerEsc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** O corpo escondido: as treze seções numeradas. A abertura fica de fora, à
 *  vista, junto do resumo — ver disclaimerHtmlBloco. */
function disclaimerHtmlCompleto() {
  var partes = [];
  DISCLAIMER_SECOES.forEach(function (secao, i) {
    var bloco = '<section class="disc-secao">';
    bloco +=
      '<h4 class="disc-secao-titulo"><span class="disc-num">' +
      (i + 1) +
      '</span>' +
      disclaimerEsc(secao.titulo) +
      '</h4>';
    (secao.paragrafos || []).forEach(function (p) {
      bloco += '<p>' + disclaimerEsc(p) + '</p>';
    });
    if (secao.lista && secao.lista.length) {
      bloco += '<ul class="disc-lista">';
      secao.lista.forEach(function (item) {
        bloco += '<li>' + disclaimerEsc(item) + '</li>';
      });
      bloco += '</ul>';
    }
    (secao.depois || []).forEach(function (p) {
      bloco += '<p>' + disclaimerEsc(p) + '</p>';
    });
    bloco += '</section>';
    partes.push(bloco);
  });
  return partes.join('');
}

/**
 * O bloco inteiro: abertura e resumo sempre à vista, as treze seções atrás
 * de um botão. O que fica visível não é decoração — é o mínimo de
 * conformidade que test/carteira-aviso-risco.test.js cobra.
 * `id` distingue as duas instâncias — a da carteira e a do regulamento —
 * porque as duas podem existir na página ao mesmo tempo. O título fica com
 * quem hospeda: a carteira já tem "Aviso de risco" no topo do seu quadro.
 */
function disclaimerHtmlBloco(id) {
  var idCorpo = id + 'Corpo';
  return (
    '<p class="disc-abertura">' +
    disclaimerEsc(DISCLAIMER_ABERTURA) +
    '</p>' +
    '<p class="disc-resumo">' +
    disclaimerEsc(DISCLAIMER_RESUMO) +
    '</p>' +
    '<button type="button" class="disc-toggle" id="' +
    disclaimerEsc(id) +
    'Btn" aria-expanded="false" aria-controls="' +
    disclaimerEsc(idCorpo) +
    '" onclick="disclaimerAlternar(\'' +
    disclaimerEsc(id) +
    '\')">' +
    '<i class="ph ph-caret-down"></i>' +
    '<span class="disc-toggle-label">Ler o documento completo</span>' +
    '</button>' +
    '<div class="disc-corpo" id="' +
    disclaimerEsc(idCorpo) +
    '" hidden>' +
    '<p class="disc-atualizado">Última atualização: ' +
    disclaimerEsc(DISCLAIMER_ATUALIZADO_EM) +
    '</p>' +
    disclaimerHtmlCompleto() +
    '</div>'
  );
}

/** Abre e fecha o documento, mantendo o rótulo e o aria em dia. */
function disclaimerAlternar(id) {
  var corpo = document.getElementById(id + 'Corpo');
  var btn = document.getElementById(id + 'Btn');
  if (!corpo || !btn) return;
  var aberto = !corpo.hidden;
  corpo.hidden = aberto;
  btn.setAttribute('aria-expanded', aberto ? 'false' : 'true');
  var rotulo = btn.querySelector('.disc-toggle-label');
  if (rotulo) rotulo.textContent = aberto ? 'Ler o documento completo' : 'Fechar o documento';
  btn.classList.toggle('aberto', !aberto);
}

/**
 * Preenche os pontos onde o disclaimer aparece. Chamado no load — os dois
 * destinos são marcação estática, então não há corrida com render de aba.
 */
function disclaimerMontar() {
  var alvos = [
    { slot: 'cartRiscoWrap', id: 'cartRisco' },
    { slot: 'dsRegulamentoWrap', id: 'dsRegulamento' },
  ];
  alvos.forEach(function (alvo) {
    var el = document.getElementById(alvo.slot);
    if (el) el.innerHTML = disclaimerHtmlBloco(alvo.id);
  });
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('DOMContentLoaded', disclaimerMontar);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DISCLAIMER_ATUALIZADO_EM: DISCLAIMER_ATUALIZADO_EM,
    DISCLAIMER_ABERTURA: DISCLAIMER_ABERTURA,
    DISCLAIMER_RESUMO: DISCLAIMER_RESUMO,
    DISCLAIMER_SECOES: DISCLAIMER_SECOES,
    disclaimerHtmlCompleto: disclaimerHtmlCompleto,
    disclaimerHtmlBloco: disclaimerHtmlBloco,
  };
}
