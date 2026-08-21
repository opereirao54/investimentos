/**
 * Appliquei — Regras do INSS para a comparação do "Simule sua liberdade".
 *
 * Classic script (só `var` no top-level, como os demais). Todas as funções
 * daqui são PURAS: recebem números, devolvem números. É o que permite testar
 * a regra sem DOM e manter a tela burra.
 *
 * Por que este arquivo existe: o simulador comparava o aporte da pessoa com um
 * "INSS" que recebia esse mesmo aporte e rendia 3% ao ano. Isso não é o INSS.
 * A contribuição é calculada sobre a RENDA e trava no teto; o retorno não é um
 * saldo acumulado e sim um BENEFÍCIO MENSAL vitalício, definido por regra.
 */

// ============================================================
// === TABELA OFICIAL — ATUALIZAR TODO JANEIRO                ===
// ============================================================
//
// Origem: Portaria Interministerial MPS/MF nº 13, de 9 de janeiro de 2026.
//
// CONFIRMADOS em fontes públicas: salário mínimo R$ 1.621,00, teto do salário
// de contribuição R$ 8.475,55 e as quatro alíquotas (7,5% / 9% / 12% / 14%).
//
// DERIVADOS: os dois limites intermediários. A portaria reajusta as faixas
// intermediárias pelo INPC, então aplicamos aqui o mesmo fator do teto
// (8.475,55 / 8.157,41 = 1,039) sobre os limites de 2025 (2.793,88 e
// 4.190,83). O erro possível é pequeno — a contribuição máxima varia menos de
// R$ 7/mês entre as leituras concorrentes —, mas confira no Anexo II da
// portaria ao atualizar.
var INSS_TABELA = {
  ano: 2026,
  fonte: 'Portaria Interministerial MPS/MF nº 13, de 9/1/2026',
  salarioMinimo: 1621.0,
  teto: 8475.55,
  // Faixas progressivas: cada alíquota incide SÓ sobre a parte do salário
  // dentro da faixa, como uma escada — não sobre o salário inteiro.
  faixas: [
    { ate: 1621.0, aliquota: 0.075 },
    { ate: 2903.84, aliquota: 0.09 },
    { ate: 4354.27, aliquota: 0.12 },
    { ate: 8475.55, aliquota: 0.14 },
  ],
};

// Como a pessoa contribui. O vínculo muda a conta inteira — e para o MEI muda
// também o teto do que ele pode receber, porque ele contribui sobre o mínimo.
var INSS_VINCULOS = [
  { v: 'clt', label: 'CLT / empregado' },
  { v: 'autonomo', label: 'Autônomo (20%)' },
  { v: 'mei', label: 'MEI (5% do mínimo)' },
];

// Idade mínima e tempo mínimo de contribuição da aposentadoria por idade
// (EC 103/2019). O tempo mínimo é também o piso do coeficiente de 60%.
var INSS_REGRAS = {
  mulher: { idadeMinima: 62, anosMinimos: 15 },
  homem: { idadeMinima: 65, anosMinimos: 20 },
};

function _inssRegra(sexo) {
  return sexo === 'homem' ? INSS_REGRAS.homem : INSS_REGRAS.mulher;
}

function _inssTabela(tabela) {
  return tabela || INSS_TABELA;
}

// O salário de contribuição: a renda, limitada ao teto. Acima dele a pessoa
// não contribui mais nem um centavo — e é exatamente isso que o simulador
// ignorava ao tratar o aporte como contribuição.
function inssSalarioDeContribuicao(renda, tabela) {
  var t = _inssTabela(tabela);
  var r = Number(renda) || 0;
  if (r <= 0) return 0;
  return Math.min(r, t.teto);
}

// Contribuição mensal do trabalhador, por vínculo.
function inssContribuicaoMensal(renda, vinculo, tabela) {
  var t = _inssTabela(tabela);
  var r = Number(renda) || 0;
  if (r <= 0) return 0;

  // MEI recolhe 5% do salário mínimo, independente do que fatura.
  if (vinculo === 'mei') return _arred(t.salarioMinimo * 0.05);

  // Autônomo (contribuinte individual, plano normal): 20% sobre o salário de
  // contribuição declarado, entre o mínimo e o teto.
  if (vinculo === 'autonomo') {
    var base = Math.min(Math.max(r, t.salarioMinimo), t.teto);
    return _arred(base * 0.2);
  }

  // CLT: progressiva por faixa. Só a parte do salário dentro de cada faixa
  // paga a alíquota daquela faixa.
  var sc = Math.min(r, t.teto);
  var total = 0;
  var piso = 0;
  for (var i = 0; i < t.faixas.length; i++) {
    var f = t.faixas[i];
    if (sc <= piso) break;
    total += (Math.min(sc, f.ate) - piso) * f.aliquota;
    piso = f.ate;
  }
  return _arred(total);
}

// Arredondamento de dinheiro. O `* (1 + EPSILON)` não é firula: 1621 × 7,5%
// dá 121.57499999999999 em ponto flutuante, e um Math.round direto devolveria
// R$ 121,57 onde a folha de pagamento mostra R$ 121,58.
function _arred(v) {
  return Math.round(v * 100 * (1 + Number.EPSILON)) / 100;
}

// Coeficiente da regra geral pós-EC 103: 60% da média + 2% por ano que passar
// do tempo mínimo (15 anos mulher / 20 homem), limitado a 100%.
function inssCoeficiente(anosContribuicao, sexo) {
  var regra = _inssRegra(sexo);
  var anos = Math.floor(Number(anosContribuicao) || 0);
  if (anos < regra.anosMinimos) return 0;
  return Math.min(1, 0.6 + 0.02 * (anos - regra.anosMinimos));
}

// A média dos salários de contribuição, que é a base do benefício. Para MEI a
// base é sempre o mínimo — por isso ele nunca recebe mais que um mínimo.
function inssMediaSalarial(renda, vinculo, tabela) {
  var t = _inssTabela(tabela);
  if (vinculo === 'mei') return t.salarioMinimo;
  var r = Number(renda) || 0;
  if (r <= 0) return 0;
  return Math.min(Math.max(r, t.salarioMinimo), t.teto);
}

// Benefício mensal estimado depois de contribuir `anosTotais` anos.
//
// Devolve `qualifica: false` quando o tempo não fecha — e esse é o resultado
// mais importante da tela para prazos curtos: contribuir 10 anos não dá
// aposentadoria nenhuma, e o simulador antigo mostrava um "montante" gordo
// justamente aí.
function inssBeneficio(renda, anosTotais, sexo, vinculo, tabela) {
  var t = _inssTabela(tabela);
  var regra = _inssRegra(sexo);
  var anos = Math.floor(Number(anosTotais) || 0);
  var media = inssMediaSalarial(renda, vinculo, t);
  var coeficiente = inssCoeficiente(anos, sexo);

  if (anos < regra.anosMinimos) {
    return {
      qualifica: false,
      anos: anos,
      anosMinimos: regra.anosMinimos,
      anosFaltando: regra.anosMinimos - anos,
      idadeMinima: regra.idadeMinima,
      coeficiente: 0,
      media: media,
      beneficio: 0,
    };
  }

  // O benefício nunca é menor que um salário mínimo nem maior que o teto.
  var bruto = media * coeficiente;
  return {
    qualifica: true,
    anos: anos,
    anosMinimos: regra.anosMinimos,
    anosFaltando: 0,
    idadeMinima: regra.idadeMinima,
    coeficiente: coeficiente,
    media: media,
    beneficio: _arred(Math.min(t.teto, Math.max(t.salarioMinimo, bruto))),
    // Quem contribui sobre o mínimo (ou perto dele) recebe o mínimo mesmo com
    // coeficiente baixo. Dizer isso evita a leitura de que o piso é "bônus".
    limitadoAoMinimo: bruto < t.salarioMinimo,
    limitadoAoTeto: bruto > t.teto,
  };
}

// Retrato completo do lado INSS para o período simulado.
//
// `anosJaContribuidos` é o passado da pessoa; `anosSimulados` é o período do
// simulador. O tempo que conta para a regra é a soma dos dois — o simulador
// projeta os dois lados no MESMO prazo, que é o ponto do ajuste.
function inssProjecao(params) {
  params = params || {};
  var t = _inssTabela(params.tabela);
  var renda = Number(params.renda) || 0;
  var vinculo = params.vinculo || 'clt';
  var sexo = params.sexo === 'homem' ? 'homem' : 'mulher';
  var meses = Math.max(0, Math.round(Number(params.meses) || 0));
  var anosSimulados = meses / 12;
  var anosJa = Math.max(0, Math.floor(Number(params.anosJaContribuidos) || 0));

  var contribuicaoMensal = inssContribuicaoMensal(renda, vinculo, t);
  var totalPago = _arred(contribuicaoMensal * meses);
  var anosTotais = anosJa + Math.floor(anosSimulados);
  var beneficio = inssBeneficio(renda, anosTotais, sexo, vinculo, t);

  return {
    tabela: t,
    vinculo: vinculo,
    sexo: sexo,
    renda: renda,
    salarioDeContribuicao: inssSalarioDeContribuicao(renda, t),
    // Quanto da renda ficou de fora por causa do teto. É o número que explica
    // por que contribuir mais não é uma opção disponível.
    rendaAcimaDoTeto: Math.max(0, renda - t.teto),
    contribuicaoMensal: contribuicaoMensal,
    totalPago: totalPago,
    meses: meses,
    anosJaContribuidos: anosJa,
    anosTotais: anosTotais,
    beneficio: beneficio,
    // Quanto do que a pessoa ganha vai para o INSS — o "custo" do lado de lá.
    pesoNaRenda: renda > 0 ? contribuicaoMensal / renda : 0,
  };
}
