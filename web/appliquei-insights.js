/**
 * Appliquei — MOTOR DE INSIGHTS (Camada 1: inteligência sem LLM).
 *
 * Classic script SEM DOM: só leitura de `transacoes` e estatística. Carregado
 * ANTES de appliquei-insights-ui.js, que é quem desenha os cards e chama estas
 * funções. A separação é a mesma de motor-carteira.js ↔ aba-carteira: o motor
 * precisa rodar em `node --test` sem browser, e regra de negócio misturada com
 * innerHTML não dá para testar.
 *
 * CONTRATO CENTRAL — O MOTOR SUGERE, NUNCA APLICA.
 * Nenhuma função deste arquivo escreve em `transacoes`, em localStorage ou em
 * lugar nenhum. Todas devolvem descrições do que foi observado. Quem decide é o
 * usuário, num clique explícito. O motivo é concreto: uma categorização errada
 * aplicada em silêncio contamina a DRE e o relatório mensal sem deixar rastro —
 * o dado fica errado e ninguém sabe que ficou. Sugestão errada custa um "não".
 *
 * Os seis detectores, na ordem em que a tela usa:
 *   1. insightsSugerirCategoria()   — aprende do histórico do próprio usuário.
 *   2. insightsAnomalias()          — categoria muito acima do normal dela.
 *   3. insightsRecorrentesOcultos() — parece despesa fixa e não está marcada.
 *   4. insightsReajustes()          — cobrança recorrente que mudou de preço.
 *   5. insightsDuplicadas()         — a mesma assinatura cobrada duas vezes.
 *   6. insightsAperto()             — o caixa fura antes do fim da janela.
 *
 * Top-level só com `var`/`function`: classic script compartilha estado via
 * window (ver test/classic-scripts-globals.test.js).
 */

// ════════════════════════════════════════════════════════════
// 0. LIMIARES — todos num lugar só, para poder afinar com uso real
// ════════════════════════════════════════════════════════════

/**
 * Calibragem inicial deliberadamente CONSERVADORA. O erro caro aqui não é
 * deixar de mostrar um insight: é mostrar cinco por mês, treinar a pessoa a
 * ignorar o painel inteiro e perder junto o alerta que importava. Fadiga de
 * alerta não é incômodo, é perda de função. Cada limiar abaixo pode descer
 * depois que o uso real disser que está calado demais — o caminho contrário
 * (afrouxar e depois apertar) já queimou a confiança.
 */
var INSIGHTS_LIMIARES = {
  // Anomalia: quantas vezes a mediana da categoria para virar alerta, e o piso
  // em reais. O piso existe porque 3× num café é R$ 12 — verdadeiro, inútil.
  fatorAnomalia: 2.5,
  minDeltaAnomalia: 80,
  minMesesHistorico: 3,

  // Categorização: quantas vezes a descrição precisa ter aparecido, e quanto a
  // categoria vencedora precisa dominar as demais para virar sugestão.
  minOcorrenciasCategoria: 2,
  dominanciaCategoria: 0.6,
  minSimilaridadeToken: 0.5,

  // Recorrência: meses distintos com a mesma descrição, e quão estável o valor
  // precisa ser (coeficiente de variação) para ser tratado como assinatura.
  minMesesRecorrencia: 3,
  cvMaxRecorrencia: 0.15,

  // Reajuste: variação mínima, relativa e absoluta, para valer um aviso.
  minReajustePct: 0.05,
  minReajusteAbs: 5,

  // Aperto de caixa: horizonte olhado à frente.
  diasJanelaAperto: 45,
};

/** Categorias contábeis que representam saída de consumo. */
var INSIGHTS_CATEGORIAS_SAIDA = ['despesa_fixa', 'despesa_variavel', 'cartao_credito'];

// ════════════════════════════════════════════════════════════
// 1. NORMALIZAÇÃO E ESTATÍSTICA
// ════════════════════════════════════════════════════════════

/**
 * Reduz a descrição à sua "identidade": o que faz "Netflix (3/12)", "netflix"
 * e "NETFLIX  " serem a mesma coisa.
 *
 * O sufixo de parcela sai porque senão cada parcela vira uma descrição
 * diferente e NENHUMA recorrência é detectada — que é exatamente o caso que
 * mais interessa. Os números soltos saem pelo mesmo motivo ("uber 23/08").
 */
function insightsNormalizarDescricao(texto) {
  return String(texto == null ? '' : texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/\(\s*\d+\s*\/\s*\d+\s*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens úteis da descrição — descarta preposições e ruído de 1 letra. */
var INSIGHTS_STOPWORDS = {
  de: 1,
  da: 1,
  do: 1,
  das: 1,
  dos: 1,
  e: 1,
  a: 1,
  o: 1,
  as: 1,
  os: 1,
  em: 1,
  no: 1,
  na: 1,
  nos: 1,
  nas: 1,
  para: 1,
  pra: 1,
  com: 1,
  por: 1,
  um: 1,
  uma: 1,
};

function insightsTokens(texto) {
  var norm = insightsNormalizarDescricao(texto);
  if (!norm) return [];
  return norm.split(' ').filter(function (t) {
    return t.length > 1 && !INSIGHTS_STOPWORDS[t];
  });
}

/**
 * Similaridade de Jaccard entre dois conjuntos de tokens.
 * Serve para "mercado extra" casar com "extra mercado" e com "mercado".
 */
function insightsSimilaridade(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  var set = {};
  tokensB.forEach(function (t) {
    set[t] = 1;
  });
  var intersecao = 0;
  var vistos = {};
  tokensA.forEach(function (t) {
    if (set[t] && !vistos[t]) {
      intersecao++;
      vistos[t] = 1;
    }
  });
  var uniao = {};
  tokensA.concat(tokensB).forEach(function (t) {
    uniao[t] = 1;
  });
  return intersecao / Object.keys(uniao).length;
}

/**
 * Mediana — e não média, de propósito.
 *
 * A média é arrastada justamente pelo outlier que estamos caçando: um mês de
 * R$ 3.000 em Saúde levanta a própria régua que deveria denunciá-lo, e o
 * alerta não dispara. A mediana ignora a ponta e continua descrevendo o mês
 * típico da pessoa.
 */
function insightsMediana(valores) {
  var arr = (valores || [])
    .map(Number)
    .filter(function (n) {
      return isFinite(n);
    })
    .sort(function (a, b) {
      return a - b;
    });
  if (!arr.length) return 0;
  var meio = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[meio] : (arr[meio - 1] + arr[meio]) / 2;
}

/** Coeficiente de variação: desvio padrão / média. Mede estabilidade. */
function insightsCoefVariacao(valores) {
  var arr = (valores || []).map(Number).filter(function (n) {
    return isFinite(n) && n > 0;
  });
  if (arr.length < 2) return 0;
  var media =
    arr.reduce(function (s, n) {
      return s + n;
    }, 0) / arr.length;
  if (media === 0) return Infinity;
  var variancia =
    arr.reduce(function (s, n) {
      return s + (n - media) * (n - media);
    }, 0) / arr.length;
  return Math.sqrt(variancia) / media;
}

/** Chave ordenável de competência: 2026-09. */
function insightsChaveMes(ano, mes) {
  return String(ano) + '-' + String(Number(mes) + 1).padStart(2, '0');
}

/** Índice absoluto do mês, para medir distância entre competências. */
function insightsIndiceMes(ano, mes) {
  return Number(ano) * 12 + Number(mes);
}

function insightsEhSaida(t) {
  return !!t && INSIGHTS_CATEGORIAS_SAIDA.indexOf(t.categoria) >= 0;
}

// ════════════════════════════════════════════════════════════
// 2. CATEGORIZAÇÃO APRENDIDA DO PRÓPRIO HISTÓRICO
// ════════════════════════════════════════════════════════════

/**
 * Monta o mapa "descrição normalizada → como o usuário SEMPRE classificou
 * isso". É o núcleo da Camada 1: não há modelo treinado, tabela de mercado nem
 * chamada de rede — a régua é o comportamento passado da própria pessoa, que é
 * a única fonte que sabe que "extra" é mercado para ela e farmácia para outra.
 */
function insightsMapaCategorias(transacoes) {
  var mapa = {};
  (transacoes || []).forEach(function (t) {
    if (!insightsEhSaida(t)) return;
    var chave = insightsNormalizarDescricao(t.descricao);
    if (!chave) return;
    if (!mapa[chave]) {
      mapa[chave] = { total: 0, contabil: {}, despesa: {}, tokens: insightsTokens(t.descricao) };
    }
    var reg = mapa[chave];
    reg.total++;
    reg.contabil[t.categoria] = (reg.contabil[t.categoria] || 0) + 1;
    if (t.categoriaDespesa) {
      reg.despesa[t.categoriaDespesa] = (reg.despesa[t.categoriaDespesa] || 0) + 1;
    }
  });
  return mapa;
}

/** Vencedor de um histograma, com a fração que ele representa do total. */
function insightsVencedor(hist, total) {
  var melhor = null;
  var melhorN = 0;
  Object.keys(hist || {}).forEach(function (k) {
    if (hist[k] > melhorN) {
      melhorN = hist[k];
      melhor = k;
    }
  });
  if (melhor == null || !total) return null;
  return { valor: melhor, ocorrencias: melhorN, dominancia: melhorN / total };
}

/**
 * Sugere a classificação de um lançamento novo a partir do histórico.
 *
 * Duas passadas, da mais forte para a mais fraca:
 *   1. descrição normalizada IGUAL a algo já lançado — sinal mais confiável;
 *   2. maior similaridade de tokens acima do piso — pega "mercado extra" a
 *      partir de "extra", que é o caso comum de quem digita apressado.
 *
 * Devolve `null` — e não um palpite fraco — quando não há base. Sugerir com
 * pouca evidência é pior que não sugerir: ensina o usuário a desconfiar da
 * sugestão e ele passa a ignorar inclusive as boas.
 */
function insightsSugerirCategoria(descricao, transacoes, opcoes) {
  var cfg = Object.assign({}, INSIGHTS_LIMIARES, opcoes || {});
  var chave = insightsNormalizarDescricao(descricao);
  if (!chave) return null;

  var mapa = (opcoes && opcoes.mapa) || insightsMapaCategorias(transacoes);
  var reg = mapa[chave];
  var via = 'exata';
  var similaridade = 1;

  if (!reg) {
    var tokens = insightsTokens(descricao);
    if (!tokens.length) return null;
    var melhorSim = 0;
    var melhorReg = null;
    Object.keys(mapa).forEach(function (k) {
      var sim = insightsSimilaridade(tokens, mapa[k].tokens);
      if (sim > melhorSim) {
        melhorSim = sim;
        melhorReg = mapa[k];
      }
    });
    if (!melhorReg || melhorSim < cfg.minSimilaridadeToken) return null;
    reg = melhorReg;
    via = 'aproximada';
    similaridade = melhorSim;
  }

  if (reg.total < cfg.minOcorrenciasCategoria) return null;

  var contabil = insightsVencedor(reg.contabil, reg.total);
  if (!contabil || contabil.dominancia < cfg.dominanciaCategoria) return null;

  var totalDespesa = Object.keys(reg.despesa).reduce(function (s, k) {
    return s + reg.despesa[k];
  }, 0);
  var despesa = insightsVencedor(reg.despesa, totalDespesa);
  var temDespesa = despesa && despesa.dominancia >= cfg.dominanciaCategoria;

  // A confiança mistura três coisas que o usuário consegue conferir de olho:
  // quão dominante foi a escolha, quanta base existe e quão parecida é a
  // descrição. Ela é exibida no card — número escondido não é auditável.
  var forcaBase = Math.min(1, reg.total / 5);
  var confianca = contabil.dominancia * 0.5 + forcaBase * 0.25 + similaridade * 0.25;

  return {
    categoria: contabil.valor,
    categoriaDespesa: temDespesa ? despesa.valor : null,
    confianca: Math.round(confianca * 100) / 100,
    baseadoEm: reg.total,
    via: via,
    dominancia: Math.round(contabil.dominancia * 100) / 100,
  };
}

// ════════════════════════════════════════════════════════════
// 3. ANOMALIA DE GASTO POR CATEGORIA
// ════════════════════════════════════════════════════════════

/** Soma por (categoriaDespesa, mês), só de saídas. */
function insightsSomasPorCategoriaMes(transacoes) {
  var por = {};
  (transacoes || []).forEach(function (t) {
    if (!insightsEhSaida(t)) return;
    var cat = t.categoriaDespesa || '__sem_categoria__';
    var mes = insightsChaveMes(t.ano, t.mes);
    if (!por[cat]) por[cat] = {};
    por[cat][mes] = (por[cat][mes] || 0) + (Number(t.valor) || 0);
  });
  return por;
}

/**
 * Categoria cujo mês de referência destoa da própria mediana histórica.
 *
 * Exige `minMesesHistorico` meses ANTERIORES: com dois pontos, "mediana" é
 * uma palavra elegante para "o outro mês", e qualquer variação normal vira
 * alerta. O piso em reais corta o barulho de categoria pequena.
 */
function insightsAnomalias(transacoes, ref, opcoes) {
  var cfg = Object.assign({}, INSIGHTS_LIMIARES, opcoes || {});
  var alvo = insightsChaveMes(ref.ano, ref.mes);
  var por = insightsSomasPorCategoriaMes(transacoes);
  var achados = [];

  Object.keys(por).forEach(function (cat) {
    if (cat === '__sem_categoria__') return;
    var meses = por[cat];
    var atual = meses[alvo] || 0;
    if (!atual) return;

    var anteriores = Object.keys(meses)
      .filter(function (m) {
        return m < alvo;
      })
      .sort()
      .map(function (m) {
        return meses[m];
      });
    if (anteriores.length < cfg.minMesesHistorico) return;

    var mediana = insightsMediana(anteriores);
    if (mediana <= 0) return;
    var fator = atual / mediana;
    var delta = atual - mediana;
    if (fator < cfg.fatorAnomalia || delta < cfg.minDeltaAnomalia) return;

    achados.push({
      id: 'anomalia:' + cat + ':' + alvo,
      tipo: 'anomalia',
      severidade: fator >= cfg.fatorAnomalia * 1.6 ? 'critico' : 'atencao',
      categoriaDespesa: cat,
      valor: atual,
      referencia: mediana,
      fator: Math.round(fator * 10) / 10,
      delta: delta,
      mesesBase: anteriores.length,
    });
  });

  return achados.sort(function (a, b) {
    return b.delta - a.delta;
  });
}

// ════════════════════════════════════════════════════════════
// 4. GRUPOS RECORRENTES — base dos detectores 3, 4 e 5
// ════════════════════════════════════════════════════════════

/**
 * Agrupa saídas por descrição normalizada e descreve o comportamento de cada
 * grupo ao longo dos meses. Três detectores leem daqui, então a extração é uma
 * só: recorrência oculta, reajuste e duplicata olham o MESMO grupo por ângulos
 * diferentes, e recalcular isso três vezes só criaria três verdades.
 */
function insightsAgruparRecorrentes(transacoes) {
  var grupos = {};
  (transacoes || []).forEach(function (t) {
    if (!insightsEhSaida(t)) return;
    var chave = insightsNormalizarDescricao(t.descricao);
    if (!chave) return;
    if (!grupos[chave]) {
      grupos[chave] = { chave: chave, rotulo: t.descricao, itens: [], meses: {} };
    }
    var g = grupos[chave];
    var mes = insightsChaveMes(t.ano, t.mes);
    g.itens.push(t);
    if (!g.meses[mes]) g.meses[mes] = [];
    g.meses[mes].push(t);
  });

  return Object.keys(grupos).map(function (k) {
    var g = grupos[k];
    var chavesMes = Object.keys(g.meses).sort();
    var valoresPorMes = chavesMes.map(function (m) {
      return g.meses[m].reduce(function (s, t) {
        return s + (Number(t.valor) || 0);
      }, 0);
    });
    // O valor UNITÁRIO típico do mês, separado da soma. Sem esta distinção, um
    // mês com cobrança duplicada entra no detector de reajuste como se o preço
    // tivesse dobrado: a Netflix cobrada duas vezes a R$ 59,90 viraria "subiu
    // 200%". São dois fenômenos diferentes e cada detector precisa do seu.
    var unitarioPorMes = chavesMes.map(function (m) {
      return insightsMediana(
        g.meses[m].map(function (t) {
          return Number(t.valor) || 0;
        })
      );
    });
    g.mesesOrdenados = chavesMes;
    g.valoresPorMes = valoresPorMes;
    g.unitarioPorMes = unitarioPorMes;
    g.qtdMeses = chavesMes.length;
    g.cv = insightsCoefVariacao(unitarioPorMes);
    g.declaradoFixo = g.itens.some(function (t) {
      return !!t.groupId || t.categoria === 'despesa_fixa' || !!t.cartaoFixoMensal;
    });
    return g;
  });
}

/** Meses consecutivos no fim da série — "3 meses seguidos", não "3 meses". */
function insightsMesesConsecutivosFinais(chavesMes) {
  if (!chavesMes.length) return 0;
  var indices = chavesMes.map(function (m) {
    var p = m.split('-');
    return insightsIndiceMes(Number(p[0]), Number(p[1]) - 1);
  });
  var corrida = 1;
  for (var i = indices.length - 1; i > 0; i--) {
    if (indices[i] - indices[i - 1] === 1) corrida++;
    else break;
  }
  return corrida;
}

/**
 * Despesa que se comporta como fixa mas não está declarada como tal.
 *
 * Só conta série CONSECUTIVA: "jan, mar, jun" com o mesmo valor não é
 * assinatura, é coincidência. E `declaradoFixo` exclui quem já está marcado —
 * sugerir o que já está feito é o jeito mais rápido de perder credibilidade.
 */
function insightsRecorrentesOcultos(transacoes, ref, opcoes) {
  var cfg = Object.assign({}, INSIGHTS_LIMIARES, opcoes || {});
  var alvo = insightsChaveMes(ref.ano, ref.mes);
  return insightsAgruparRecorrentes(transacoes)
    .filter(function (g) {
      if (g.declaradoFixo) return false;
      if (g.mesesOrdenados.indexOf(alvo) < 0) return false;
      if (insightsMesesConsecutivosFinais(g.mesesOrdenados) < cfg.minMesesRecorrencia) return false;
      return g.cv <= cfg.cvMaxRecorrencia;
    })
    .map(function (g) {
      var valorTipico = insightsMediana(g.unitarioPorMes);
      return {
        id: 'recorrente:' + g.chave,
        tipo: 'recorrente_oculto',
        severidade: 'informativo',
        rotulo: g.rotulo,
        valor: valorTipico,
        mesesSeguidos: insightsMesesConsecutivosFinais(g.mesesOrdenados),
        anualizado: valorTipico * 12,
      };
    })
    .sort(function (a, b) {
      return b.valor - a.valor;
    });
}

/**
 * Cobrança recorrente que mudou de preço — o "reajuste silencioso".
 *
 * Compara o último mês com a mediana dos anteriores DO MESMO grupo. Exige
 * variação relativa e absoluta: 6% de R$ 20 é R$ 1,20 e não merece um card.
 */
function insightsReajustes(transacoes, ref, opcoes) {
  var cfg = Object.assign({}, INSIGHTS_LIMIARES, opcoes || {});
  var alvo = insightsChaveMes(ref.ano, ref.mes);
  var achados = [];

  insightsAgruparRecorrentes(transacoes).forEach(function (g) {
    var idx = g.mesesOrdenados.indexOf(alvo);
    // Precisa do mês de referência, do anterior, e de pelo menos um mês antes
    // dos dois para formar a linha de base.
    if (idx < 2) return;

    var atual = g.unitarioPorMes[idx];
    var anterior = g.unitarioPorMes[idx - 1];
    var base = insightsMediana(g.unitarioPorMes.slice(0, idx - 1));
    if (base <= 0) return;

    // A linha de base precisa ter sido ESTÁVEL: num gasto que já oscilava,
    // "mudou 20%" é o normal dele, e apontar isso como reajuste é ruído com
    // cara de descoberta.
    if (insightsCoefVariacao(g.unitarioPorMes.slice(0, idx - 1)) > cfg.cvMaxRecorrencia) return;

    // O PREÇO NOVO PRECISA TER SE SUSTENTADO por dois meses.
    //
    // É o que separa reajuste de pico. Com um único mês no valor novo os dois
    // são indistinguíveis pelos dados — e chamar de "reajuste" um Uber que
    // disparou uma vez produz o mesmo fato contado duas vezes, já que o
    // detector de anomalia também o pega. Aqui a escolha é atrasar o aviso de
    // reajuste em um mês e ser honesto, em vez de adivinhar e duplicar o card.
    // O pico não fica descoberto nesse meio-tempo: quem responde por ele é
    // insightsAnomalias, que é o detector desenhado para isso.
    var novoNivel = insightsMediana([atual, anterior]);
    if (insightsCoefVariacao([atual, anterior]) > cfg.cvMaxRecorrencia) return;

    var delta = novoNivel - base;
    var pct = delta / base;
    if (Math.abs(pct) < cfg.minReajustePct || Math.abs(delta) < cfg.minReajusteAbs) return;

    achados.push({
      id: 'reajuste:' + g.chave + ':' + alvo,
      tipo: 'reajuste',
      severidade: delta > 0 ? 'atencao' : 'positivo',
      rotulo: g.rotulo,
      valor: novoNivel,
      anterior: base,
      delta: delta,
      pct: Math.round(pct * 1000) / 10,
      impactoAnual: delta * 12,
      desdeMes: g.mesesOrdenados[idx - 1],
    });
  });

  return achados.sort(function (a, b) {
    return Math.abs(b.delta) - Math.abs(a.delta);
  });
}

/**
 * A mesma assinatura cobrada duas vezes no mesmo mês.
 *
 * A trava contra falso positivo é o histórico: só acusa quando o grupo SEMPRE
 * apareceu uma vez por mês e agora apareceu mais. Sem isso, todo mercado e todo
 * Uber viram "duplicata" — o alerta dispararia justamente nos gastos em que
 * repetir é o comportamento normal.
 */
function insightsDuplicadas(transacoes, ref, opcoes) {
  var cfg = Object.assign({}, INSIGHTS_LIMIARES, opcoes || {});
  var alvo = insightsChaveMes(ref.ano, ref.mes);
  var achados = [];

  insightsAgruparRecorrentes(transacoes).forEach(function (g) {
    var noAlvo = g.meses[alvo];
    if (!noAlvo || noAlvo.length < 2) return;

    var anteriores = g.mesesOrdenados.filter(function (m) {
      return m < alvo;
    });
    if (anteriores.length < cfg.minMesesRecorrencia) return;
    var sempreUmaVez = anteriores.every(function (m) {
      return g.meses[m].length === 1;
    });
    if (!sempreUmaVez) return;

    // Parcelamento e recorrência declarada geram várias linhas de propósito.
    var mesmoGrupo = noAlvo.every(function (t) {
      return t.groupId && t.groupId === noAlvo[0].groupId;
    });
    if (mesmoGrupo) return;

    var valores = noAlvo.map(function (t) {
      return Number(t.valor) || 0;
    });
    if (insightsCoefVariacao(valores) > cfg.cvMaxRecorrencia) return;

    achados.push({
      id: 'duplicada:' + g.chave + ':' + alvo,
      tipo: 'duplicada',
      severidade: 'atencao',
      rotulo: g.rotulo,
      ocorrencias: noAlvo.length,
      valor: valores.reduce(function (s, n) {
        return s + n;
      }, 0),
      valorUnitario: insightsMediana(valores),
      ids: noAlvo.map(function (t) {
        return t.id;
      }),
    });
  });

  return achados;
}

// ════════════════════════════════════════════════════════════
// 5. APERTO DE CAIXA
// ════════════════════════════════════════════════════════════

/**
 * A JANELA em que o dinheiro sai antes de entrar.
 *
 * NÃO é "seu saldo vai ficar negativo", e a distinção não é de palavra: o
 * Controle Financeiro inteiro raciocina por COMPETÊNCIA — o saldo livre é
 * receita menos saídas do mês inteiro, independente do dia em que cada uma
 * cai. Um card gritando "caixa negativo" ao lado de um saldo livre positivo
 * lê-se como contradição, e a primeira pessoa a usar isto travou exatamente
 * aí: "o saldo livre já é o fim do mês, de onde vem esse negativo?".
 *
 * A pergunta legítima que sobra não é sobre quanto sobra no mês — é sobre a
 * ORDEM: as contas do começo do mês vencem antes de o salário cair? Por isso
 * o insight devolve um intervalo (furo → recuperação), e não um saldo.
 *
 * NÃO recalcula projeção: recebe `saldoEm(ms)` de fora, que em produção é
 * `saldoCaixaPorConta` (contas.js) FILTRADA para contas cadastradas — ver
 * insightsUiRenderizar. Reimplementar criaria um segundo saldo projetado que
 * diverge do primeiro no dia em que alguém corrigir só um dos dois.
 */
function insightsAperto(opcoes) {
  var cfg = Object.assign({}, INSIGHTS_LIMIARES, opcoes || {});
  var saldoEm = cfg.saldoEm;
  if (typeof saldoEm !== 'function') return null;

  var agora = cfg.agora != null ? cfg.agora : Date.now();
  var DIA = 86400000;
  var furo = null;
  var recupera = null;
  var pior = 0;

  for (var d = 1; d <= cfg.diasJanelaAperto; d++) {
    var ms = agora + d * DIA;
    var saldo = Number(saldoEm(ms));
    if (!isFinite(saldo)) continue;
    if (saldo < 0) {
      if (!furo) furo = { dia: d, ms: ms };
      if (saldo < pior) pior = saldo;
    } else if (furo && !recupera) {
      // Primeiro dia de volta ao azul depois do furo: é o que fecha a janela
      // e transforma o alerta em "aperto de passagem" em vez de rombo.
      recupera = { dia: d, ms: ms };
    }
  }

  if (!furo) return null;
  return {
    id: 'aperto:' + new Date(furo.ms).toISOString().slice(0, 10),
    tipo: 'aperto',
    // Recupera dentro da janela = descompasso de datas, não falta de dinheiro.
    // Tratar os dois como a mesma emergência é o que gera alarme falso.
    severidade: recupera ? 'atencao' : 'critico',
    valor: pior,
    emDias: furo.dia,
    quandoMs: furo.ms,
    recuperaMs: recupera ? recupera.ms : null,
    recuperaEmDias: recupera ? recupera.dia : null,
    diasNoVermelho: recupera ? recupera.dia - furo.dia : null,
  };
}

// ════════════════════════════════════════════════════════════
// 6. ORQUESTRAÇÃO
// ════════════════════════════════════════════════════════════

/**
 * Roda todos os detectores e devolve a lista pronta para a tela, já ordenada
 * por severidade e já sem o que o usuário dispensou.
 *
 * `opcoes.dispensados` é um mapa { id: timestamp }. O id de cada insight
 * carrega a competência (`anomalia:transporte:2026-09`), então dispensar em
 * setembro não cala outubro: a condição volta a ser avaliada no mês seguinte
 * com um id novo. Dispensa é "já vi isto", não "nunca mais me fale disto".
 */
var INSIGHTS_PESO_SEVERIDADE = { critico: 0, atencao: 1, informativo: 2, positivo: 3 };

function insightsAnalisar(transacoes, opcoes) {
  var cfg = Object.assign({}, INSIGHTS_LIMIARES, opcoes || {});
  var agora = cfg.agora != null ? new Date(cfg.agora) : new Date();
  var ref = cfg.ref || { ano: agora.getFullYear(), mes: agora.getMonth() };
  var lista = (transacoes || []).filter(function (t) {
    return t && typeof t === 'object';
  });

  var achados = []
    .concat(insightsAnomalias(lista, ref, cfg))
    .concat(insightsRecorrentesOcultos(lista, ref, cfg))
    .concat(insightsReajustes(lista, ref, cfg))
    .concat(insightsDuplicadas(lista, ref, cfg));

  var aperto = insightsAperto(cfg);
  if (aperto) achados.push(aperto);

  var dispensados = cfg.dispensados || {};
  var visiveis = achados.filter(function (i) {
    return !dispensados[i.id];
  });

  visiveis.sort(function (a, b) {
    var pa = INSIGHTS_PESO_SEVERIDADE[a.severidade];
    var pb = INSIGHTS_PESO_SEVERIDADE[b.severidade];
    if (pa !== pb) return pa - pb;
    return (b.valor || 0) - (a.valor || 0);
  });

  return {
    insights: visiveis,
    meta: {
      total: achados.length,
      dispensados: achados.length - visiveis.length,
      ref: insightsChaveMes(ref.ano, ref.mes),
      // Sem histórico suficiente a tela não deve prometer análise: mostra o
      // estado "ainda aprendendo" com quantos meses faltam.
      mesesDisponiveis: insightsMesesDisponiveis(lista),
      minMesesHistorico: cfg.minMesesHistorico,
    },
  };
}

/** Quantos meses distintos de saída existem — mede a maturidade da base. */
function insightsMesesDisponiveis(transacoes) {
  var meses = {};
  (transacoes || []).forEach(function (t) {
    if (!insightsEhSaida(t)) return;
    meses[insightsChaveMes(t.ano, t.mes)] = 1;
  });
  return Object.keys(meses).length;
}

var AppliqueiInsights = {
  analisar: insightsAnalisar,
  sugerirCategoria: insightsSugerirCategoria,
  mapaCategorias: insightsMapaCategorias,
  anomalias: insightsAnomalias,
  recorrentesOcultos: insightsRecorrentesOcultos,
  reajustes: insightsReajustes,
  duplicadas: insightsDuplicadas,
  aperto: insightsAperto,
  agruparRecorrentes: insightsAgruparRecorrentes,
  normalizarDescricao: insightsNormalizarDescricao,
  tokens: insightsTokens,
  similaridade: insightsSimilaridade,
  mediana: insightsMediana,
  coefVariacao: insightsCoefVariacao,
  mesesDisponiveis: insightsMesesDisponiveis,
  mesesConsecutivosFinais: insightsMesesConsecutivosFinais,
  LIMIARES: INSIGHTS_LIMIARES,
  CATEGORIAS_SAIDA: INSIGHTS_CATEGORIAS_SAIDA,
};
if (typeof window !== 'undefined') window.AppliqueiInsights = AppliqueiInsights;
if (typeof module !== 'undefined' && module.exports) module.exports = AppliqueiInsights;
