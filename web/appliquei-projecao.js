/**
 * Appliquei — Projeção de investimentos (sub-aba "Futuro" de Meus Investimentos).
 *
 * A aba respondia "quanto eu tenho hoje" e "quanto rendeu até aqui". Faltava a
 * pergunta que a pessoa realmente faz na frente do próprio saldo: "e se eu
 * deixar esses R$ 10.000 quietos, quanto isso vira daqui a dez anos?".
 *
 * Este arquivo responde isso em duas camadas:
 *
 *   1. MOTOR (puro, sem DOM, exportado em module.exports p/ os testes).
 *      Juros compostos mês a mês, por CLASSE de ativo — não por uma taxa
 *      única chutada para a carteira inteira. Renda fixa e previdência
 *      projetam pela taxa CONTRATADA de cada posição (o mesmo texto
 *      "110% CDI"/"IPCA+6%" que já valoriza o saldo de hoje); renda variável
 *      projeta por prêmio real sobre o IPCA vigente.
 *
 *   2. TELA (render + handlers). Hero com o valor projetado, régua de tempo,
 *      gráfico de cenários, a decomposição "seu dinheiro × seus aportes ×
 *      juros", marcos de patrimônio e as premissas — editáveis e visíveis,
 *      porque projeção com premissa escondida é adivinhação com gráfico.
 *
 * Deps (classic script, carregado DEPOIS de renda-fixa/previdencia):
 *   obterResumoCarteira, valorAtualRendaFixa, calcularSaldoPrevidencia,
 *   taxaMensalOperacao, taxasMercado, subcategoriaEfetiva, inferirCategoria,
 *   mockAtivosMercado, historicoCompras, formatarMoeda, parseBRL, Chart.
 *
 * NADA aqui escreve em historicoCompras/transacoes: a aba é só leitura. O
 * único estado gravado é a preferência da própria projeção (horizonte, aporte
 * simulado e premissas ajustadas), em localStorage.
 */

// ============================================================
// === MOTOR — juros compostos por classe (puro, testável)    ===
// ============================================================

/**
 * Premissas de retorno por classe de ativo.
 *
 * `base` diz COMO a taxa nominal anual nasce:
 *   - { tipo: 'cdi',   valor: 1 }     → 100% do CDI vigente
 *   - { tipo: 'ipca+', valor: 0.07 }  → IPCA vigente + 7% ao ano (juro real)
 *   - { tipo: 'fixa',  valor: 0.10 }  → 10% ao ano, sem indexador
 *
 * `faixa` é a amplitude do cenário, em pontos percentuais ao ano, para cada
 * lado do base. Renda fixa tem faixa curta porque a taxa é contratada; ação
 * tem faixa larga; cripto tem faixa larga o bastante para o cenário ruim ser
 * de PERDA — que é o que a classe faz de verdade, e esconder isso seria
 * vender otimismo com cara de conta.
 *
 * `contratavel` diz se a classe TEM uma taxa que a pessoa possa informar. Em
 * renda fixa, reserva e previdência ela existe e vence a premissa; em ação,
 * FII, ETF, BDR e cripto não existe nada a contratar — quem cadastra informa
 * ticker, quantidade e preço. A distinção decide o rótulo de procedência, e
 * é declarada aqui em vez de deduzida do indexador: o dia em que uma classe
 * de renda variável ganhar base 'cdi', a dedução mentiria em silêncio.
 */
var PROJ_PREMISSAS = {
  acoes: { rotulo: 'Ações', base: { tipo: 'ipca+', valor: 0.07 }, faixa: 0.06, contratavel: false },
  fiis: {
    rotulo: 'Fundos imobiliários',
    base: { tipo: 'ipca+', valor: 0.06 },
    faixa: 0.05,
    contratavel: false,
  },
  etfs: {
    rotulo: 'ETFs',
    base: { tipo: 'ipca+', valor: 0.065 },
    faixa: 0.055,
    contratavel: false,
  },
  bdrs: {
    rotulo: 'BDRs',
    base: { tipo: 'ipca+', valor: 0.065 },
    faixa: 0.06,
    contratavel: false,
  },
  cripto: {
    rotulo: 'Criptomoedas',
    base: { tipo: 'ipca+', valor: 0.1 },
    faixa: 0.25,
    contratavel: false,
  },
  renda_fixa: {
    rotulo: 'Renda fixa',
    base: { tipo: 'cdi', valor: 1 },
    faixa: 0.015,
    contratavel: true,
  },
  previdencia: {
    rotulo: 'Previdência',
    base: { tipo: 'cdi', valor: 0.95 },
    faixa: 0.02,
    contratavel: true,
  },
  reserva_emergencia: {
    rotulo: 'Reserva de emergência',
    base: { tipo: 'cdi', valor: 1 },
    faixa: 0.01,
    contratavel: true,
  },
};

/** Ordem de exibição das classes — da mais volátil para a mais previsível. */
var PROJ_ORDEM_CLASSES = [
  'acoes',
  'fiis',
  'etfs',
  'bdrs',
  'cripto',
  'renda_fixa',
  'previdencia',
  'reserva_emergencia',
];

/** Piso do cenário conservador, ao ano. Abaixo disto a curva vira ficção. */
var PROJ_PISO_CONSERVADOR = -0.1;

/** Horizontes das pílulas de atalho, em anos. */
var PROJ_HORIZONTES = [1, 2, 5, 10, 20, 30];

/** Marcos de patrimônio testados na régua "quando eu chego lá". */
var PROJ_MARCOS = [10000, 50000, 100000, 250000, 500000, 1000000, 2000000, 5000000, 10000000];

/** Taxa anual efetiva → mensal efetiva. */
function projAnualParaMensal(anual) {
  var a = Number(anual);
  if (!isFinite(a) || a <= -1) return 0;
  return Math.pow(1 + a, 1 / 12) - 1;
}

/** Taxa mensal efetiva → anual efetiva. */
function projMensalParaAnual(mensal) {
  var m = Number(mensal);
  if (!isFinite(m) || m <= -1) return 0;
  return Math.pow(1 + m, 12) - 1;
}

/**
 * Taxa nominal anual da classe, resolvida contra as taxas de mercado do dia.
 * `taxas` é o objeto `taxasMercado` (cdi/ipca/selic em fração decimal).
 */
function projTaxaBaseClasse(chave, taxas) {
  var premissa = PROJ_PREMISSAS[chave];
  if (!premissa) return 0;
  var t = taxas || {};
  var cdi = isFinite(t.cdi) ? t.cdi : 0.105;
  var ipca = isFinite(t.ipca) ? t.ipca : 0.045;
  var base = premissa.base;
  if (base.tipo === 'cdi') return cdi * base.valor;
  // Prêmio real compõe sobre a inflação, não soma: IPCA 4,5% + 7% real dá
  // 11,8% nominal, não 11,5%. Em trinta anos a diferença é visível.
  if (base.tipo === 'ipca+') return (1 + ipca) * (1 + base.valor) - 1;
  return base.valor;
}

/**
 * De onde veio a taxa desta classe. É o rótulo que a tela mostra ao lado do
 * número, e ele precisa ser verdade — a aba inteira se apoia na promessa de
 * que a premissa está à vista.
 *
 * Classes de renda variável não têm taxa a contratar: quem cadastra uma ação
 * informa ticker, quantidade e preço. Ali a premissa de longo prazo é a única
 * resposta possível, e dizer isso não é confissão de fraqueza.
 *
 * Renda fixa, reserva e previdência têm. Quando a pessoa informou, a projeção
 * usa a taxa dela; quando não, este arquivo aplica um padrão — e é esse caso
 * que precisa aparecer, porque antes ele se escondia atrás de "contratada".
 *
 * @param {Object} c { chave, pesoComTaxa, pesoSemTaxa, temCustom }
 * @returns {'ajustada'|'premissa'|'contratada'|'mista'|'padrao'}
 */
function projOrigemTaxa(c) {
  var d = c || {};
  if (d.temCustom) return 'ajustada';
  var premissa = PROJ_PREMISSAS[d.chave];
  if (!premissa || !premissa.contratavel) return 'premissa';
  var com = Number(d.pesoComTaxa) || 0;
  var sem = Number(d.pesoSemTaxa) || 0;
  if (com <= 0 && sem <= 0) return 'premissa';
  if (sem <= 0) return 'contratada';
  if (com <= 0) return 'padrao';
  return 'mista';
}

/**
 * Taxa do cenário. 'conservador' e 'otimista' afastam a base pela faixa da
 * classe; 'base' devolve a própria. O piso só existe do lado conservador.
 */
function projTaxaCenario(taxaBase, faixa, cenario) {
  var f = isFinite(faixa) ? faixa : 0;
  if (cenario === 'conservador') return Math.max(PROJ_PISO_CONSERVADOR, taxaBase - f);
  if (cenario === 'otimista') return taxaBase + f;
  return taxaBase;
}

/**
 * Projeta a carteira mês a mês.
 *
 * @param {Object} config
 * @param {Array}  config.classes      [{ chave, valor, taxaAnual, peso? }]
 * @param {number} config.aporteMensal Aporte novo por mês (R$), distribuído
 *                                     entre as classes pelo peso.
 * @param {number} config.meses        Horizonte em meses.
 * @returns {Object} { meses, pontos, totalHoje, totalFinal, aportado, juros, porClasse }
 *
 * Convenção: o aporte entra no FIM do mês (annuity ordinária) — não rende no
 * mês em que foi depositado. É o cenário menos otimista dos dois possíveis, e
 * numa tela que projeta futuro a escolha default tem de ser essa.
 */
function projProjetar(config) {
  var cfg = config || {};
  var meses = Math.max(0, Math.round(Number(cfg.meses) || 0));
  var aporte = Math.max(0, Number(cfg.aporteMensal) || 0);
  var entradas = (cfg.classes || []).filter(function (c) {
    return c && (Number(c.valor) > 0 || Number(c.peso) > 0);
  });

  var totalHoje = entradas.reduce(function (s, c) {
    return s + (Number(c.valor) || 0);
  }, 0);

  // Peso do aporte por classe: o informado vence; senão, a proporção atual da
  // carteira; e se a carteira está zerada, divide igualmente entre as classes
  // presentes. Sem esse último caso, aporte em carteira vazia sumia.
  var somaPesoInformado = entradas.reduce(function (s, c) {
    return s + (Number(c.peso) > 0 ? Number(c.peso) : 0);
  }, 0);
  var pesos = entradas.map(function (c) {
    if (somaPesoInformado > 0) return (Number(c.peso) || 0) / somaPesoInformado;
    if (totalHoje > 0) return (Number(c.valor) || 0) / totalHoje;
    return 1 / entradas.length;
  });

  var mensais = entradas.map(function (c) {
    return projAnualParaMensal(c.taxaAnual);
  });
  var saldos = entradas.map(function (c) {
    return Number(c.valor) || 0;
  });

  var pontos = [{ mes: 0, total: totalHoje, principal: totalHoje, aportado: 0, juros: 0 }];
  var aportadoAcum = 0;

  for (var m = 1; m <= meses; m++) {
    for (var k = 0; k < saldos.length; k++) {
      saldos[k] = saldos[k] * (1 + mensais[k]) + aporte * pesos[k];
    }
    aportadoAcum += aporte;
    var total = saldos.reduce(function (s, v) {
      return s + v;
    }, 0);
    pontos.push({
      mes: m,
      total: total,
      principal: totalHoje,
      aportado: aportadoAcum,
      juros: total - totalHoje - aportadoAcum,
    });
  }

  var ultimo = pontos[pontos.length - 1];
  return {
    meses: meses,
    pontos: pontos,
    totalHoje: totalHoje,
    totalFinal: ultimo.total,
    aportado: ultimo.aportado,
    juros: ultimo.juros,
    porClasse: entradas.map(function (c, i) {
      return {
        chave: c.chave,
        rotulo: c.rotulo || (PROJ_PREMISSAS[c.chave] && PROJ_PREMISSAS[c.chave].rotulo) || c.chave,
        valorHoje: Number(c.valor) || 0,
        taxaAnual: Number(c.taxaAnual) || 0,
        valorFinal: saldos[i],
        peso: pesos[i],
      };
    }),
  };
}

/**
 * Primeiro mês em que a série alcança `alvo`. Devolve null se nunca alcança
 * dentro do horizonte projetado. Interpola dentro do mês para o marco não
 * pular meio ano por causa do arredondamento.
 */
function projMesesParaAlvo(pontos, alvo) {
  if (!pontos || !pontos.length) return null;
  var meta = Number(alvo);
  if (!isFinite(meta)) return null;
  if (pontos[0].total >= meta) return 0;
  for (var i = 1; i < pontos.length; i++) {
    if (pontos[i].total >= meta) {
      var anterior = pontos[i - 1].total;
      var passo = pontos[i].total - anterior;
      var fracao = passo > 0 ? (meta - anterior) / passo : 0;
      return pontos[i - 1].mes + Math.max(0, Math.min(1, fracao));
    }
  }
  return null;
}

/** Valor nominal → poder de compra de hoje, descontada a inflação do período. */
function projDeflacionar(valor, ipcaAnual, anos) {
  var i = Number(ipcaAnual);
  var a = Number(anos);
  if (!isFinite(i) || !isFinite(a) || i <= -1 || a <= 0) return Number(valor) || 0;
  return (Number(valor) || 0) / Math.pow(1 + i, a);
}

// ============================================================
// === ESTADO DA TELA                                         ===
// ============================================================

var PROJ_CHAVE_PREFS = 'appliquei_projecao_prefs';

var projEstado = {
  anos: 10,
  aporteMensal: 0,
  emValoresDeHoje: false,
  /** Taxas anuais sobrescritas pela pessoa, por classe. {} = tudo automático. */
  taxasCustom: {},
  /** Último cálculo, guardado para os handlers não recalcularem tudo à toa. */
  ultimo: null,
};

var projChart = null;
/** Evita animar o número na primeira pintura da aba (nasce no valor certo). */
var projJaPintou = false;

function projCarregarPrefs() {
  try {
    var bruto = localStorage.getItem(PROJ_CHAVE_PREFS);
    if (!bruto) return;
    var p = JSON.parse(bruto);
    if (p && typeof p === 'object') {
      if (isFinite(p.anos) && p.anos >= 1 && p.anos <= 40) projEstado.anos = Math.round(p.anos);
      if (isFinite(p.aporteMensal) && p.aporteMensal >= 0)
        projEstado.aporteMensal = Number(p.aporteMensal);
      projEstado.emValoresDeHoje = p.emValoresDeHoje === true;
      if (p.taxasCustom && typeof p.taxasCustom === 'object') {
        Object.keys(p.taxasCustom).forEach(function (k) {
          var v = Number(p.taxasCustom[k]);
          if (PROJ_PREMISSAS[k] && isFinite(v) && v > -1 && v < 5) projEstado.taxasCustom[k] = v;
        });
      }
    }
  } catch (_) {
    /* preferência corrompida não pode derrubar a aba */
  }
}

function projSalvarPrefs() {
  try {
    localStorage.setItem(
      PROJ_CHAVE_PREFS,
      JSON.stringify({
        anos: projEstado.anos,
        aporteMensal: projEstado.aporteMensal,
        emValoresDeHoje: projEstado.emValoresDeHoje,
        taxasCustom: projEstado.taxasCustom,
      })
    );
  } catch (_) {
    /* localStorage cheio não pode derrubar a aba */
  }
}

// ============================================================
// === LEITURA DA CARTEIRA — de posições para classes         ===
// ============================================================

/**
 * A operação traz uma taxa que a PESSOA informou?
 *
 * Espelha a precedência de taxaMensalOperacao — texto de rentabilidade que o
 * parser entende, depois taxaMensal explícita — para que a contabilidade de
 * "quanto desta taxa é informado" case exatamente com a matemática que a usa.
 * `taxaMensal: 0` conta como informada: zero escolhido é uma resposta.
 */
function projOperacaoTemTaxa(op) {
  if (!op) return false;
  if (op.rentabilidade && typeof parsearRentabilidade === 'function') {
    var parsed = parsearRentabilidade(op.rentabilidade);
    if (parsed && isFinite(parsed.taxa)) return true;
  }
  return op.taxaMensal != null;
}

/**
 * Taxa anual contratada de uma posição sem cotação (renda fixa, reserva,
 * previdência), ponderada pelo valor de cada aporte. É a MESMA função que
 * valoriza o saldo de hoje (taxaMensalOperacao), então a projeção continua a
 * curva que a carteira já desenha — em vez de começar de outro lugar.
 *
 * Devolve também QUANTO desse peso veio de taxa informada e quanto caiu no
 * padrão. Sem isso a tela chamava de "taxa contratada dos seus papéis" uma
 * média que podia ser inteiramente chutada por este arquivo — e o convite a
 * preencher a taxa, que a Carteira faz, perdia o sentido aqui.
 */
function projTaxaAnualContratada(ticker, categoria, padraoMensal) {
  var lista = typeof historicoCompras !== 'undefined' ? historicoCompras : [];
  var somaPeso = 0;
  var somaTaxa = 0;
  var pesoComTaxa = 0;
  lista.forEach(function (op) {
    if (op.ticker !== ticker || op.categoria !== categoria) return;
    if ((op.tipo || 'compra') !== 'compra') return;
    var peso = (op.preco_op || op.preco_pago || 0) * (op.quantidade || 1);
    if (!(peso > 0)) return;
    var tm =
      typeof taxaMensalOperacao === 'function'
        ? taxaMensalOperacao(op, padraoMensal)
        : op.taxaMensal != null
          ? op.taxaMensal
          : padraoMensal;
    somaPeso += peso;
    somaTaxa += tm * peso;
    if (projOperacaoTemTaxa(op)) pesoComTaxa += peso;
  });
  if (!(somaPeso > 0)) return null;
  return {
    taxaAnual: projMensalParaAnual(somaTaxa / somaPeso),
    pesoComTaxa: pesoComTaxa,
    pesoSemTaxa: somaPeso - pesoComTaxa,
  };
}

/**
 * Consolida a carteira de hoje em classes projetáveis.
 *
 * O valor de hoje de cada posição sai exatamente das mesmas funções que a
 * sub-aba Carteira usa (valorAtualRendaFixa, calcularSaldoPrevidencia,
 * quantidade × cotação). Se os dois números divergissem, a projeção estaria
 * partindo de um patrimônio que a pessoa não vê em lugar nenhum.
 */
function projMontarClasses() {
  var consolidada = typeof obterResumoCarteira === 'function' ? obterResumoCarteira() : {};
  var mercado = typeof mockAtivosMercado !== 'undefined' ? mockAtivosMercado : [];
  var taxas = typeof taxasMercado !== 'undefined' ? taxasMercado : {};
  var acumulado = {};

  Object.keys(consolidada).forEach(function (ticker) {
    var ativo = consolidada[ticker];
    if (!ativo || ativo.qtdTotal <= 0) return;
    var ativoMercado = mercado.find(function (a) {
      return a.ticker === ticker;
    });

    var valor;
    var taxaContratada = null;
    if (ativo.categoria === 'previdencia') {
      valor = typeof calcularSaldoPrevidencia === 'function' ? calcularSaldoPrevidencia(ticker) : 0;
      taxaContratada = projTaxaAnualContratada(ticker, 'previdencia', 0.008);
    } else if (ativo.categoria === 'renda_fixa' || ativo.categoria === 'reserva_emergencia') {
      valor =
        typeof valorAtualRendaFixa === 'function'
          ? valorAtualRendaFixa(ticker, ativo.categoria)
          : ativo.valorTotalInvestido;
      var cdiMensal = projAnualParaMensal(isFinite(taxas.cdi) ? taxas.cdi : 0.105);
      taxaContratada = projTaxaAnualContratada(ticker, ativo.categoria, cdiMensal);
    } else {
      var preco = ativoMercado ? ativoMercado.preco_atual : ativo.precoMedio;
      valor = ativo.qtdTotal * preco;
    }
    if (!(valor > 0.01)) return;

    var chave;
    var categoria =
      typeof inferirCategoria === 'function'
        ? inferirCategoria(ticker, ativo, ativoMercado)
        : ativo.categoria || 'renda_variavel';
    if (categoria === 'renda_variavel') {
      chave =
        typeof subcategoriaEfetiva === 'function'
          ? subcategoriaEfetiva(ticker, ativo, ativoMercado)
          : 'acoes';
    } else {
      chave = categoria;
    }
    if (!PROJ_PREMISSAS[chave]) chave = 'acoes';

    if (!acumulado[chave])
      acumulado[chave] = {
        valor: 0,
        somaTaxa: 0,
        somaPeso: 0,
        pesoComTaxa: 0,
        pesoSemTaxa: 0,
        tickersSemTaxa: [],
      };
    var acc = acumulado[chave];
    acc.valor += valor;
    if (taxaContratada && isFinite(taxaContratada.taxaAnual)) {
      // A taxa da classe pondera pelo VALOR DE HOJE de cada posição (o que a
      // projeção vai capitalizar), não pelo custo dos aportes. Já a divisão
      // informada/estimada vem do peso dos aportes, que é onde a taxa mora.
      acc.somaTaxa += taxaContratada.taxaAnual * valor;
      acc.somaPeso += valor;
      var pesoOps = taxaContratada.pesoComTaxa + taxaContratada.pesoSemTaxa;
      if (pesoOps > 0) {
        // Reescala para o valor de hoje: uma posição de R$ 10 mil sem taxa
        // pesa como R$ 10 mil na conta de procedência, não como o aporte
        // original de anos atrás.
        acc.pesoComTaxa += (taxaContratada.pesoComTaxa / pesoOps) * valor;
        acc.pesoSemTaxa += (taxaContratada.pesoSemTaxa / pesoOps) * valor;
      }
      if (taxaContratada.pesoComTaxa <= 0) acc.tickersSemTaxa.push(ticker);
    }
  });

  return PROJ_ORDEM_CLASSES.filter(function (chave) {
    return acumulado[chave] && acumulado[chave].valor > 0;
  }).map(function (chave) {
    var dados = acumulado[chave];
    // Precedência da taxa: o ajuste da pessoa > a taxa contratada da posição >
    // a premissa da classe. A origem vai para a tela: número sem procedência
    // numa projeção é chute com aparência de cálculo.
    var taxaPremissa = projTaxaBaseClasse(chave, taxas);
    var taxaContrato = dados.somaPeso > 0 ? dados.somaTaxa / dados.somaPeso : null;
    var temCustom = projEstado.taxasCustom[chave] != null;
    var taxa = taxaPremissa;
    if (taxaContrato != null && isFinite(taxaContrato)) taxa = taxaContrato;
    if (temCustom) taxa = projEstado.taxasCustom[chave];
    return {
      chave: chave,
      rotulo: PROJ_PREMISSAS[chave].rotulo,
      valor: dados.valor,
      taxaAnual: taxa,
      taxaAutomatica: taxaContrato != null && isFinite(taxaContrato) ? taxaContrato : taxaPremissa,
      faixa: PROJ_PREMISSAS[chave].faixa,
      origem: projOrigemTaxa({
        chave: chave,
        pesoComTaxa: dados.pesoComTaxa,
        pesoSemTaxa: dados.pesoSemTaxa,
        temCustom: temCustom,
      }),
      // Quanto do valor de hoje desta classe cresce por uma taxa que este
      // arquivo arbitrou, e em quais papéis. É o que a tela precisa para
      // convidar a corrigir em vez de só avisar.
      valorSemTaxa: dados.pesoSemTaxa,
      tickersSemTaxa: dados.tickersSemTaxa,
    };
  });
}

/** Cor da classe, alinhada à paleta que a carteira e o donut já usam. */
function projCorClasse(chave) {
  var paleta = typeof paletaCarteira === 'function' ? paletaCarteira() : {};
  return paleta[chave] || 'var(--cor-primaria)';
}

/**
 * Roda os três cenários de uma vez. Devolve tudo o que a tela precisa desenhar
 * sem ter de projetar de novo a cada componente.
 */
function projCalcular() {
  var classes = projMontarClasses();
  var meses = Math.round(projEstado.anos * 12);
  var aporte = projEstado.aporteMensal;

  function comCenario(cenario) {
    return projProjetar({
      meses: meses,
      aporteMensal: aporte,
      classes: classes.map(function (c) {
        return {
          chave: c.chave,
          rotulo: c.rotulo,
          valor: c.valor,
          taxaAnual:
            cenario === 'base' ? c.taxaAnual : projTaxaCenario(c.taxaAnual, c.faixa, cenario),
        };
      }),
    });
  }

  var base = comCenario('base');
  var resultado = {
    classes: classes,
    meses: meses,
    anos: projEstado.anos,
    aporteMensal: aporte,
    base: base,
    conservador: comCenario('conservador'),
    otimista: comCenario('otimista'),
    // Referência "dinheiro parado": mesmo capital, mesmos aportes, zero
    // rendimento. É contra esta linha que os juros compostos aparecem.
    parado: base.totalHoje + aporte * meses,
    taxaCarteira: 0,
  };
  // Taxa efetiva da carteira: a anual que, aplicada ao total de hoje, chega no
  // mesmo lugar sem aportes. Só faz sentido com capital inicial.
  if (base.totalHoje > 0 && projEstado.anos > 0) {
    var semAporte = projProjetar({
      meses: meses,
      aporteMensal: 0,
      classes: classes.map(function (c) {
        return { chave: c.chave, valor: c.valor, taxaAnual: c.taxaAnual };
      }),
    });
    resultado.semAporte = semAporte;
    resultado.taxaCarteira =
      Math.pow(semAporte.totalFinal / base.totalHoje, 1 / projEstado.anos) - 1;
  } else {
    resultado.semAporte = base;
  }
  projEstado.ultimo = resultado;
  return resultado;
}

// ============================================================
// === HANDLERS                                               ===
// ============================================================

function projSetAnos(anos, origem) {
  var n = Math.round(Number(anos) || 0);
  if (!isFinite(n) || n < 1) n = 1;
  if (n > 40) n = 40;
  projEstado.anos = n;
  var range = document.getElementById('projRangeAnos');
  if (range && origem !== 'range') range.value = String(n);
  projSalvarPrefs();
  renderProjecao();
}

function projSetAporte(valor) {
  var v = typeof parseBRL === 'function' ? parseBRL(valor) : Number(valor) || 0;
  projEstado.aporteMensal = Math.max(0, v);
  var campo = document.getElementById('projAporteInput');
  if (campo && typeof formatarBRLInput === 'function') {
    campo.value = projEstado.aporteMensal > 0 ? formatarBRLInput(projEstado.aporteMensal) : '';
  }
  projSalvarPrefs();
  renderProjecao();
}

/** Chips de aporte rápido. Clicar no chip já ativo zera — vira um toggle. */
function projChipAporte(valor) {
  var v = Number(valor) || 0;
  projSetAporte(Math.abs(projEstado.aporteMensal - v) < 0.01 ? 0 : v);
}

function projAporteDoCampo() {
  var campo = document.getElementById('projAporteInput');
  if (!campo) return;
  projSetAporte(campo.value);
}

function projAlternarValoresDeHoje() {
  projEstado.emValoresDeHoje = !projEstado.emValoresDeHoje;
  projSalvarPrefs();
  renderProjecao();
}

function projAjustarTaxa(chave, valorPercentual) {
  if (!PROJ_PREMISSAS[chave]) return;
  var v = typeof parseBRL === 'function' ? parseBRL(valorPercentual) : Number(valorPercentual);
  if (!isFinite(v)) return;
  var taxa = v / 100;
  if (taxa <= -1 || taxa > 5) {
    if (typeof mostrarToast === 'function')
      mostrarToast('Informe uma taxa anual entre -99% e 500%.', 'aviso');
    renderProjecao();
    return;
  }
  projEstado.taxasCustom[chave] = taxa;
  projSalvarPrefs();
  renderProjecao();
}

function projRestaurarPremissas() {
  projEstado.taxasCustom = {};
  projSalvarPrefs();
  renderProjecao();
  if (typeof mostrarToast === 'function') mostrarToast('Premissas restauradas.', 'sucesso');
}

// ============================================================
// === RENDER                                                 ===
// ============================================================

/** Rótulo curto do horizonte: "1 ano", "18 meses", "10 anos". */
function projRotuloPrazo(anos) {
  var n = Math.round(Number(anos) || 0);
  return n === 1 ? '1 ano' : n + ' anos';
}

/** Mês/ano de uma distância em meses a partir de hoje. Ex.: "jun/2035". */
function projRotuloData(meses) {
  var d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + Math.round(Number(meses) || 0));
  return d
    .toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
    .replace('.', '')
    .replace(' de ', '/');
}

/** "3 anos e 4 meses" — o prazo por extenso dos marcos. */
function projPrazoPorExtenso(meses) {
  var total = Math.max(0, Math.round(Number(meses) || 0));
  var anos = Math.floor(total / 12);
  var resto = total % 12;
  var partes = [];
  if (anos > 0) partes.push(anos + (anos === 1 ? ' ano' : ' anos'));
  if (resto > 0) partes.push(resto + (resto === 1 ? ' mês' : ' meses'));
  if (!partes.length) return 'menos de um mês';
  return partes.join(' e ');
}

/** Moeda compacta para eixo e marcos: R$ 1,2 mi, R$ 340 mil. */
function projMoedaCompacta(valor) {
  var v = Number(valor) || 0;
  var sinal = v < 0 ? '-' : '';
  var abs = Math.abs(v);
  if (abs >= 1e6)
    return sinal + 'R$ ' + (abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace('.', ',') + ' mi';
  if (abs >= 1000) return sinal + 'R$ ' + Math.round(abs / 1000) + ' mil';
  return typeof formatarMoeda === 'function' ? formatarMoeda(v) : 'R$ ' + v.toFixed(2);
}

function projPercentual(v, casas) {
  var n = Number(v) || 0;
  return (n * 100).toFixed(casas == null ? 1 : casas).replace('.', ',') + '%';
}

/** Aplica (ou não) o desconto da inflação, conforme o toggle da tela. */
function projValorExibido(valor, anos) {
  if (!projEstado.emValoresDeHoje) return valor;
  var taxas = typeof taxasMercado !== 'undefined' ? taxasMercado : {};
  return projDeflacionar(valor, isFinite(taxas.ipca) ? taxas.ipca : 0.045, anos);
}

function renderProjecao() {
  var raiz = document.getElementById('subAbaFuturo');
  if (!raiz) return;

  var r = projCalcular();
  var vazia = !(r.base.totalHoje > 0);

  var elVazio = document.getElementById('projVazio');
  var elCorpo = document.getElementById('projCorpo');
  if (elVazio) elVazio.style.display = vazia ? 'block' : 'none';
  if (elCorpo) elCorpo.style.display = vazia ? 'none' : 'block';
  if (vazia) {
    projAtualizarTiraHero(null);
    return;
  }

  projRenderHero(r);
  projRenderComposicao(r);
  projRenderGrafico(r);
  projRenderMarcos(r);
  projRenderClasses(r);
  projRenderPremissas(r);
  projRenderAvisoSemTaxa(r);
  projAtualizarTiraHero(r);
  if (typeof atualizarMiniStats === 'function' && raiz.style.display !== 'none') {
    atualizarMiniStats('futuro');
  }
  projJaPintou = true;
}

function projRenderHero(r) {
  var anos = r.anos;
  var finalNominal = r.base.totalFinal;
  var exibido = projValorExibido(finalNominal, anos);

  var elValor = document.getElementById('projValorFuturo');
  if (elValor) {
    if (projJaPintou && typeof invAnimarValor === 'function') {
      invAnimarValor(
        elValor,
        exibido,
        typeof moedaComCentavosDiscretos === 'function'
          ? moedaComCentavosDiscretos
          : function (v) {
              return formatarMoeda(v);
            }
      );
    } else {
      elValor.innerHTML =
        typeof moedaComCentavosDiscretos === 'function'
          ? moedaComCentavosDiscretos(exibido)
          : formatarMoeda(exibido);
    }
  }

  var ganho = finalNominal - r.base.totalHoje - r.base.aportado;
  var elDelta = document.getElementById('projDelta');
  if (elDelta) {
    elDelta.innerHTML =
      '<i class="ph-bold ph-' +
      (ganho >= 0 ? 'arrow-up' : 'arrow-down') +
      '"></i> ' +
      (ganho >= 0 ? '+' : '') +
      formatarMoeda(projValorExibido(ganho, anos));
    elDelta.classList.toggle('neg', ganho < 0);
  }

  var elMultiplo = document.getElementById('projMultiplo');
  if (elMultiplo) {
    var investido = r.base.totalHoje + r.base.aportado;
    var mult = investido > 0 ? finalNominal / investido : 0;
    elMultiplo.innerText =
      mult > 0
        ? mult.toFixed(1).replace('.', ',') + '× o que você colocou'
        : 'sem capital projetado';
  }

  var elFaixa = document.getElementById('projFaixaCenarios');
  if (elFaixa) {
    elFaixa.innerHTML =
      '<span class="proj-cen proj-cen-baixo"><span class="proj-cen-rot">Pessimista</span>' +
      '<span class="proj-cen-val valor-mascarado">' +
      projMoedaCompacta(projValorExibido(r.conservador.totalFinal, anos)) +
      '</span></span>' +
      '<span class="proj-cen proj-cen-alto"><span class="proj-cen-rot">Otimista</span>' +
      '<span class="proj-cen-val valor-mascarado">' +
      projMoedaCompacta(projValorExibido(r.otimista.totalFinal, anos)) +
      '</span></span>';
  }

  var elPrazo = document.getElementById('projPrazoRotulo');
  if (elPrazo) elPrazo.innerText = projRotuloPrazo(anos);
  var elData = document.getElementById('projDataRotulo');
  if (elData) elData.innerText = projRotuloData(r.meses);

  var elModo = document.getElementById('projModoAporte');
  if (elModo) {
    elModo.innerText =
      r.aporteMensal > 0
        ? 'guardando ' + formatarMoeda(r.aporteMensal) + ' por mês'
        : 'sem colocar mais nada';
  }

  document.querySelectorAll('#subAbaFuturo [data-proj-anos]').forEach(function (b) {
    b.classList.toggle('ativo', Number(b.dataset.projAnos) === anos);
  });
  document.querySelectorAll('#subAbaFuturo [data-proj-aporte]').forEach(function (b) {
    b.classList.toggle(
      'ativo',
      Math.abs(Number(b.dataset.projAporte) - projEstado.aporteMensal) < 0.01
    );
  });
  var range = document.getElementById('projRangeAnos');
  if (range && Number(range.value) !== anos) range.value = String(anos);

  var btnReal = document.getElementById('projBtnValoresHoje');
  if (btnReal) {
    btnReal.classList.toggle('ativo', projEstado.emValoresDeHoje);
    btnReal.setAttribute('aria-pressed', projEstado.emValoresDeHoje ? 'true' : 'false');
  }
}

/**
 * A decomposição é o coração da aba: separa o que é SEU (capital de hoje +
 * aportes) do que o dinheiro fez sozinho. Ver a fatia de juros passar a
 * própria é o argumento inteiro de começar cedo, e nenhum número solto
 * consegue dizer isso.
 */
function projRenderComposicao(r) {
  var alvo = document.getElementById('projComposicao');
  if (!alvo) return;
  var anos = r.anos;
  var hoje = r.base.totalHoje;
  var aportes = r.base.aportado;
  var juros = Math.max(0, r.base.juros);
  var total = hoje + aportes + juros;
  if (!(total > 0)) {
    alvo.innerHTML = '';
    return;
  }

  var fatias = [
    { rot: 'Você já tem', valor: hoje, cls: 'hoje' },
    { rot: 'Você vai guardar', valor: aportes, cls: 'aportes' },
    { rot: 'Juros sobre juros', valor: juros, cls: 'juros' },
  ].filter(function (f) {
    return f.valor > 0;
  });

  var barra = fatias
    .map(function (f) {
      return (
        '<span class="proj-comp-fatia proj-comp-' +
        f.cls +
        '" style="flex:' +
        (f.valor / total).toFixed(6) +
        ';" title="' +
        f.rot +
        ': ' +
        formatarMoeda(f.valor) +
        '"></span>'
      );
    })
    .join('');

  var itens = fatias
    .map(function (f) {
      return (
        '<div class="proj-comp-item">' +
        '<span class="proj-comp-ponto proj-comp-' +
        f.cls +
        '"></span>' +
        '<span class="proj-comp-rot">' +
        f.rot +
        '</span>' +
        '<span class="proj-comp-val valor-mascarado">' +
        formatarMoeda(projValorExibido(f.valor, anos)) +
        '</span>' +
        '<span class="proj-comp-perc">' +
        Math.round((f.valor / total) * 100) +
        '%</span>' +
        '</div>'
      );
    })
    .join('');

  var frase;
  var percJuros = Math.round((juros / total) * 100);
  if (juros <= 0) {
    frase = 'Neste cenário o rendimento não cobre o período — reveja as premissas abaixo.';
  } else if (percJuros >= 50) {
    frase =
      'Mais da metade do seu patrimônio em ' +
      projRotuloPrazo(anos) +
      ' vem de juros, não de dinheiro novo.';
  } else {
    frase =
      'A cada R$ 100 que você colocar, o rendimento devolve mais R$ ' +
      Math.round((juros / Math.max(1, hoje + aportes)) * 100) +
      ' em ' +
      projRotuloPrazo(anos) +
      '.';
  }

  alvo.innerHTML =
    '<div class="proj-comp-barra">' +
    barra +
    '</div><div class="proj-comp-lista">' +
    itens +
    '</div><p class="proj-comp-frase">' +
    frase +
    '</p>';
}

function projRenderGrafico(r) {
  var canvas = document.getElementById('graficoProjecao');
  if (!canvas || typeof Chart === 'undefined') return;
  // Chart.js dimensiona pelo container. Enquanto a sub-aba (ou o bloco
  // recolhível) está fechada, o canvas mede 0px e o gráfico nasceria vazio —
  // e ficaria assim, porque um chart criado sem altura não se recupera ao
  // abrir. Quem abre chama renderProjecao de novo.
  if (!canvas.offsetParent && canvas.offsetWidth === 0) return;
  var vazioMsg = document.getElementById('msgProjecaoVazia');
  if (vazioMsg) vazioMsg.style.display = 'none';

  // Um ponto por mês em 30 anos são 360 rótulos ilegíveis. Amostra em no
  // máximo ~60 pontos, sempre incluindo o último — o número do hero tem de
  // ser exatamente o último ponto do gráfico.
  var passo = Math.max(1, Math.ceil(r.meses / 60));
  var indices = [];
  for (var i = 0; i <= r.meses; i += passo) indices.push(i);
  if (indices[indices.length - 1] !== r.meses) indices.push(r.meses);

  var anos = r.anos;
  var serie = function (proj) {
    return indices.map(function (i) {
      return projValorExibido(proj.pontos[i].total, i / 12);
    });
  };
  var rotulos = indices.map(function (i) {
    return projRotuloData(i);
  });
  var paradoSerie = indices.map(function (i) {
    return projValorExibido(r.base.totalHoje + r.aporteMensal * i, i / 12);
  });

  var corBase = typeof getToken === 'function' ? getToken('--cor-primaria') : '#059669';
  var corBanda =
    typeof corComAlpha === 'function' ? corComAlpha(corBase, 0.16) : 'rgba(5,150,105,0.16)';
  var corMuda = typeof getToken === 'function' ? getToken('--cor-texto-mutado') : '#546e5b';

  var dados = {
    labels: rotulos,
    datasets: [
      {
        label: 'Pessimista',
        data: serie(r.conservador),
        borderColor: 'transparent',
        backgroundColor: corBanda,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
        order: 3,
      },
      {
        label: 'Otimista',
        data: serie(r.otimista),
        borderColor: 'transparent',
        backgroundColor: corBanda,
        pointRadius: 0,
        fill: '-1',
        tension: 0.3,
        order: 3,
      },
      {
        label: 'Cenário provável',
        data: serie(r.base),
        borderColor: corBase,
        borderWidth: 2.5,
        backgroundColor: 'transparent',
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: false,
        tension: 0.3,
        order: 1,
      },
      {
        label: 'Sem render nada',
        data: paradoSerie,
        borderColor: corMuda,
        borderWidth: 1.5,
        borderDash: [5, 5],
        backgroundColor: 'transparent',
        pointRadius: 0,
        fill: false,
        tension: 0,
        order: 2,
      },
    ],
  };

  var opcoes = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: function (ctx) {
            return ctx.dataset.label + ': ' + formatarMoeda(ctx.parsed.y);
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { maxTicksLimit: 6, maxRotation: 0, autoSkip: true },
      },
      y: {
        border: { display: false },
        grid: { color: typeof getToken === 'function' ? getToken('--cor-borda') : '#dfe7e0' },
        ticks: {
          maxTicksLimit: 5,
          callback: function (v) {
            return projMoedaCompacta(v);
          },
        },
      },
    },
  };

  if (projChart) {
    projChart.data = dados;
    projChart.options = opcoes;
    projChart.update();
  } else {
    projChart = new Chart(canvas.getContext('2d'), { type: 'line', data: dados, options: opcoes });
  }

  var legenda = document.getElementById('legendaProjecao');
  if (legenda) {
    legenda.innerHTML =
      '<span class="chip-legenda"><span class="dot" style="background:' +
      corBase +
      '"></span>Cenário provável</span>' +
      '<span class="chip-legenda"><span class="dot" style="background:' +
      corBanda +
      '"></span>Faixa pessimista–otimista</span>' +
      '<span class="chip-legenda"><span class="dot proj-dot-tracejado" style="background:' +
      corMuda +
      '"></span>Parado, sem render</span>' +
      (projEstado.emValoresDeHoje
        ? '<span class="chip-legenda proj-chip-real"><i class="ph ph-scales"></i> Poder de compra de hoje</span>'
        : '');
  }
}

function projRenderMarcos(r) {
  var alvo = document.getElementById('projMarcos');
  if (!alvo) return;

  // Projeta 40 anos só para responder "quando eu chego lá" — o horizonte da
  // tela não pode limitar a resposta, senão o marco some ao encurtar o prazo.
  var longo = projProjetar({
    meses: 480,
    aporteMensal: r.aporteMensal,
    classes: r.classes.map(function (c) {
      return { chave: c.chave, valor: c.valor, taxaAnual: c.taxaAnual };
    }),
  });

  var hoje = r.base.totalHoje;
  var encontrados = [];
  for (var i = 0; i < PROJ_MARCOS.length && encontrados.length < 3; i++) {
    var marco = PROJ_MARCOS[i];
    if (marco <= hoje * 1.05) continue;
    var meses = projMesesParaAlvo(longo.pontos, marco);
    if (meses == null) break;
    encontrados.push({ marco: marco, meses: meses });
  }

  if (!encontrados.length) {
    alvo.innerHTML =
      '<div class="proj-marco-vazio">Com as premissas atuais, o próximo marco fica além de 40 anos. ' +
      'Um aporte mensal muda isso mais do que qualquer taxa.</div>';
    return;
  }

  alvo.innerHTML = encontrados
    .map(function (m) {
      return (
        '<div class="proj-marco">' +
        '<div class="proj-marco-alvo">' +
        projMoedaCompacta(m.marco) +
        '</div>' +
        '<div class="proj-marco-prazo">em ' +
        projPrazoPorExtenso(m.meses) +
        '</div>' +
        '<div class="proj-marco-data">' +
        projRotuloData(m.meses) +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}

function projRenderClasses(r) {
  var alvo = document.getElementById('projClasses');
  if (!alvo) return;
  var anos = r.anos;
  var totalFinal = r.base.totalFinal;

  alvo.innerHTML = r.base.porClasse
    .slice()
    .sort(function (a, b) {
      return b.valorFinal - a.valorFinal;
    })
    .map(function (c) {
      var cor = projCorClasse(c.chave);
      var perc = totalFinal > 0 ? (c.valorFinal / totalFinal) * 100 : 0;
      var cresc = c.valorHoje > 0 ? c.valorFinal / c.valorHoje : 0;
      return (
        '<div class="proj-classe" style="--proj-cor:' +
        cor +
        ';">' +
        '<div class="proj-classe-cab">' +
        '<span class="proj-classe-ponto"></span>' +
        '<span class="proj-classe-rot">' +
        c.rotulo +
        '</span>' +
        '<span class="proj-classe-taxa">' +
        projPercentual(c.taxaAnual) +
        ' a.a.</span>' +
        '</div>' +
        '<div class="proj-classe-barra"><span style="width:' +
        Math.max(2, Math.min(100, perc)).toFixed(1) +
        '%;"></span></div>' +
        '<div class="proj-classe-linha">' +
        '<span class="proj-classe-de valor-mascarado">' +
        formatarMoeda(c.valorHoje) +
        '</span>' +
        '<i class="ph ph-arrow-right"></i>' +
        '<span class="proj-classe-para valor-mascarado">' +
        formatarMoeda(projValorExibido(c.valorFinal, anos)) +
        '</span>' +
        (cresc > 0
          ? '<span class="proj-classe-mult">' + cresc.toFixed(1).replace('.', ',') + '×</span>'
          : '') +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}

/**
 * Rótulo de procedência da taxa. Cada texto tem de descrever exatamente o que
 * aconteceu — em especial 'padrao' e 'mista', que antes se escondiam atrás de
 * "taxa contratada dos seus papéis" mesmo quando ninguém contratou nada.
 */
function projRotuloOrigem(c) {
  if (c.origem === 'ajustada') return 'ajustada por você';
  if (c.origem === 'contratada') return 'taxa contratada dos seus papéis';
  if (c.origem === 'mista') return 'parte contratada, parte estimada por nós';
  if (c.origem === 'padrao') {
    // A previdência avisa no próprio formulário que sem taxa usa 0,8% a.m.;
    // renda fixa e reserva avisam o contrário — que sem taxa o papel fica
    // parado. Onde a promessa é essa, a projeção não pode fingir que rende
    // sem dizer de onde tirou a taxa.
    return c.chave === 'previdencia'
      ? 'padrão do plano — você não informou a taxa'
      : 'estimada por nós — você não informou a taxa';
  }
  return 'premissa de longo prazo';
}

/** Classes cuja taxa foi arbitrada, no todo ou em parte, por falta de dado. */
function projClassesSemTaxa(classes) {
  return (classes || []).filter(function (c) {
    return c.origem === 'padrao' || c.origem === 'mista';
  });
}

function projRenderPremissas(r) {
  var alvo = document.getElementById('projPremissasLista');
  if (!alvo) return;
  var taxas = typeof taxasMercado !== 'undefined' ? taxasMercado : {};

  var pendentes = projClassesSemTaxa(r.classes);
  var papeis = pendentes.reduce(function (s, c) {
    return s + (c.tickersSemTaxa || []).length;
  }, 0);

  var fonte = document.getElementById('projPremissasFonte');
  if (fonte) {
    // O bloco nasce recolhido: o resumo é o único lugar onde a pendência
    // aparece sem um toque. Ela vem primeiro, antes das taxas do dia.
    fonte.innerText =
      (papeis ? '⚠ ' + papeis + ' sem taxa · ' : '') +
      'CDI ' +
      projPercentual(isFinite(taxas.cdi) ? taxas.cdi : 0.105) +
      ' · IPCA ' +
      projPercentual(isFinite(taxas.ipca) ? taxas.ipca : 0.045) +
      ' a.a. · fonte: ' +
      (taxas.fonte === 'BCB' ? 'Banco Central' : 'estimativa');
  }

  alvo.innerHTML = r.classes
    .map(function (c) {
      var rotuloOrigem = projRotuloOrigem(c);
      var pendente = c.origem === 'padrao' || c.origem === 'mista';
      return (
        '<div class="proj-premissa' +
        (pendente ? ' proj-premissa-pendente' : '') +
        '">' +
        '<div class="proj-premissa-info">' +
        '<span class="proj-premissa-rot">' +
        c.rotulo +
        '</span>' +
        '<span class="proj-premissa-org">' +
        rotuloOrigem +
        ' · faixa ±' +
        projPercentual(c.faixa, 1) +
        '</span>' +
        '</div>' +
        '<label class="proj-premissa-campo">' +
        '<input type="text" inputmode="decimal" value="' +
        (c.taxaAnual * 100).toFixed(2).replace('.', ',') +
        '" aria-label="Retorno anual estimado de ' +
        c.rotulo +
        '" onchange="projAjustarTaxa(\'' +
        c.chave +
        '\', this.value)">' +
        '<span>% a.a.</span>' +
        '</label>' +
        '</div>'
      );
    })
    .join('');

  var btnRestaurar = document.getElementById('projBtnRestaurar');
  if (btnRestaurar) {
    btnRestaurar.style.display = Object.keys(projEstado.taxasCustom).length
      ? 'inline-flex'
      : 'none';
  }
}

/**
 * Faixa de "parte desta projeção é estimativa nossa".
 *
 * Existe porque o painel de Premissas nasce recolhido: sem isto, a única
 * pista de que a taxa foi arbitrada estaria atrás de um toque que ninguém dá.
 * Chama o MESMO modal que a Carteira usa (abrirModalCompletarRentabilidade) —
 * corrigir num lugar corrige nos dois, que é o ponto.
 *
 * Respeita a mesma dispensa da faixa da Carteira: quem já disse "agora não"
 * naquela não precisa dizer de novo nesta.
 */
function projRenderAvisoSemTaxa(r) {
  var box = document.getElementById('projAvisoSemTaxa');
  if (!box) return;

  var pendentes = projClassesSemTaxa(r.classes);
  var papeis = pendentes.reduce(function (s, c) {
    return s + (c.tickersSemTaxa || []).length;
  }, 0);
  // Só renda fixa e reserva têm o convite a completar; a previdência usa um
  // padrão que o próprio formulário anuncia, então avisar dela aqui seria
  // pedir uma correção que não existe.
  var comConvite = pendentes.some(function (c) {
    return c.chave !== 'previdencia';
  });

  var dispensado = false;
  try {
    dispensado = sessionStorage.getItem('appliquei_aviso_rent_rf') === '1';
  } catch (_) {}

  if (!pendentes.length || dispensado) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }

  var valorEstimado = pendentes.reduce(function (s, c) {
    return s + (c.valorSemTaxa || 0);
  }, 0);
  var fatia = r.base.totalHoje > 0 ? (valorEstimado / r.base.totalHoje) * 100 : 0;

  box.style.display = 'block';
  box.innerHTML =
    '<div class="proj-aviso-faixa">' +
    '<i class="ph-fill ph-warning-circle"></i>' +
    '<div class="proj-aviso-texto">' +
    '<strong>Parte desta projeção é estimativa nossa.</strong> ' +
    (papeis
      ? papeis + (papeis === 1 ? ' papel está' : ' papéis estão') + ' sem rentabilidade informada'
      : 'Há posições sem rentabilidade informada') +
    (fatia >= 1 ? ' — ' + fatia.toFixed(0) + '% do que você tem hoje' : '') +
    '. Enquanto isso, usamos o CDI no lugar da taxa que você contratou.' +
    '</div>' +
    (comConvite
      ? '<button type="button" class="proj-aviso-btn" onclick="abrirModalCompletarRentabilidade()">' +
        '<i class="ph ph-pencil-simple"></i> Completar</button>'
      : '') +
    '<button type="button" class="proj-aviso-x" onclick="projDispensarAvisoSemTaxa()" ' +
    'aria-label="Dispensar aviso" title="Dispensar por agora"><i class="ph ph-x"></i></button>' +
    '</div>';
}

/** Mesma chave da faixa da Carteira: dispensar num lugar dispensa nos dois. */
function projDispensarAvisoSemTaxa() {
  try {
    sessionStorage.setItem('appliquei_aviso_rent_rf', '1');
  } catch (_) {}
  var box = document.getElementById('projAvisoSemTaxa');
  if (box) {
    box.style.display = 'none';
    box.innerHTML = '';
  }
  if (typeof renderAvisoRentabilidadeRF === 'function') renderAvisoRentabilidadeRF();
}

/**
 * A tira no hero da aba: é ela que faz a pergunta antes que a pessoa saiba que
 * queria fazê-la. Fica logo abaixo do saldo, diz o valor projetado em 10 anos
 * e abre a sub-aba Futuro.
 */
function projAtualizarTiraHero(resultado) {
  var tira = document.getElementById('tiraProjecao');
  if (!tira) return;
  var r = resultado || projCalcular();
  if (!(r.base.totalHoje > 0)) {
    tira.style.display = 'none';
    return;
  }
  tira.style.display = 'flex';
  var prazo = document.getElementById('tiraProjecaoPrazo');
  var valor = document.getElementById('tiraProjecaoValor');
  if (prazo) prazo.innerText = projRotuloPrazo(r.anos);
  // A tira mostra sempre o cenário SEM aporte novo: a pergunta que ela
  // responde é "e se eu deixar quieto?". O aporte simulado é assunto da aba.
  if (valor) valor.innerText = formatarMoeda(r.semAporte.totalFinal);
}

/** Chamada pelo bootstrap e pela troca de sub-aba. */
function inicializarProjecao() {
  projCarregarPrefs();
  var campo = document.getElementById('projAporteInput');
  if (campo && projEstado.aporteMensal > 0 && typeof formatarBRLInput === 'function') {
    campo.value = formatarBRLInput(projEstado.aporteMensal);
  }
  renderProjecao();
}

/**
 * Troca de tema: o gráfico guarda as cores resolvidas no momento em que foi
 * criado, então trocar os tokens não o repinta. Destrói e redesenha — só se a
 * sub-aba estiver visível, senão o canvas nasce com 0px de altura.
 * Chamada por toggleDarkMode (app.js).
 */
function projRedesenharPorTema() {
  if (projChart) {
    projChart.destroy();
    projChart = null;
  }
  var aba = document.getElementById('subAbaFuturo');
  if (aba && aba.style.display !== 'none') renderProjecao();
}

// Exportado para os testes exercitarem a matemática sem DOM, sem rede e sem
// estado global — mesmo contrato do motor da Carteira Recomendada.
var ProjecaoMotor = {
  PREMISSAS: PROJ_PREMISSAS,
  ORDEM_CLASSES: PROJ_ORDEM_CLASSES,
  HORIZONTES: PROJ_HORIZONTES,
  MARCOS: PROJ_MARCOS,
  PISO_CONSERVADOR: PROJ_PISO_CONSERVADOR,
  anualParaMensal: projAnualParaMensal,
  mensalParaAnual: projMensalParaAnual,
  taxaBaseClasse: projTaxaBaseClasse,
  taxaCenario: projTaxaCenario,
  origemTaxa: projOrigemTaxa,
  projetar: projProjetar,
  mesesParaAlvo: projMesesParaAlvo,
  deflacionar: projDeflacionar,
};
if (typeof window !== 'undefined') window.ProjecaoMotor = ProjecaoMotor;
if (typeof module !== 'undefined' && module.exports) module.exports = ProjecaoMotor;
