/**
 * Appliquei — PAINEL DE INSIGHTS (camada de tela).
 *
 * Desenha os cards a partir do que appliquei-insights.js apurou. Carregado
 * DEPOIS dele e depois de aba-controle-financeiro.js, de quem consome
 * `rotuloCategoriaDespesa` e `formatarMoeda`.
 *
 * A REGRA QUE GOVERNA ESTE ARQUIVO: nenhuma ação daqui altera transação.
 * O botão primário de cada card LEVA o usuário até onde a mudança é feita —
 * abre o mês certo, filtra a categoria, destaca a linha — e ele decide lá,
 * no fluxo normal, com as validações e os testes de integração que já
 * existem. Um atalho que gravasse direto passaria por fora de
 * salvarTransacoes() e de tudo o que o mapa de integrações protege.
 *
 * O único estado que este arquivo escreve é a lista de dispensados, em
 * `appliquei_insights_dispensados` — chave `appliquei_*`, portanto já
 * sincronizada pelo cloud-sync sem nada a mais.
 *
 * Top-level só com `var`/`function` (ver test/classic-scripts-globals.test.js).
 */

var INSIGHTS_LS_DISPENSADOS = 'appliquei_insights_dispensados';

/** Meia-vida da dispensa. Ver insightsUiDispensar. */
var INSIGHTS_DISPENSA_TTL_MS = 120 * 86400000;

// ════════════════════════════════════════════════════════════
// 1. ESTADO DE DISPENSA
// ════════════════════════════════════════════════════════════

function insightsUiLerDispensados() {
  try {
    var raw = localStorage.getItem(INSIGHTS_LS_DISPENSADOS);
    if (!raw) return {};
    var v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    // Poda o que envelheceu. Sem isso o mapa cresce para sempre e entra
    // inteiro no documento do Firestore, que tem teto rígido de 1 MiB.
    var corte = Date.now() - INSIGHTS_DISPENSA_TTL_MS;
    var limpo = {};
    Object.keys(v).forEach(function (k) {
      if (Number(v[k]) > corte) limpo[k] = Number(v[k]);
    });
    return limpo;
  } catch (_) {
    return {};
  }
}

/**
 * Dispensar é "já vi isto", não "nunca mais me fale disto".
 *
 * O id do insight carrega a competência (`anomalia:transporte:2026-09`), então
 * dispensar em setembro não cala outubro — em outubro a condição é reavaliada
 * com um id novo. É o comportamento que a pessoa espera: ela reconheceu o gasto
 * deste mês, não desligou o detector.
 */
function insightsUiDispensar(id) {
  if (!id) return;
  try {
    var m = insightsUiLerDispensados();
    m[id] = Date.now();
    localStorage.setItem(INSIGHTS_LS_DISPENSADOS, JSON.stringify(m));
    if (window.AppliqueiCloudSync && typeof AppliqueiCloudSync.forceFlush === 'function') {
      AppliqueiCloudSync.forceFlush();
    }
  } catch (e) {
    console.error('[insights] dispensar', e);
  }
  insightsUiRenderizar();
}

function insightsUiRestaurarTodos() {
  try {
    localStorage.removeItem(INSIGHTS_LS_DISPENSADOS);
    if (window.AppliqueiCloudSync && typeof AppliqueiCloudSync.forceFlush === 'function') {
      AppliqueiCloudSync.forceFlush();
    }
  } catch (_) {}
  insightsUiRenderizar();
}

// ════════════════════════════════════════════════════════════
// 2. SPARKLINE
// ════════════════════════════════════════════════════════════

/**
 * Série única de 6 meses: linha em tom de-ênfase, ponto do mês corrente em
 * destaque, e a MEDIANA como linha tracejada de referência.
 *
 * A linha de base é o que faz o desenho valer o espaço. Sem ela o sparkline
 * mostra "subiu"; com ela mostra "subiu em relação a ISTO" — que é exatamente
 * a frase do card, desenhada. O gráfico vira a prova do argumento em vez de
 * enfeite ao lado dele.
 *
 * Sem legenda de propósito: série única, e o título do card já a nomeia.
 */
/** Mediana local: a UI não deve depender da ordem de carga do motor. */
function insightsUiMediana(arr) {
  var a = (arr || []).slice().sort(function (x, y) {
    return x - y;
  });
  if (!a.length) return 0;
  var m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function insightsUiSparkline(valores, opcoes) {
  var cfg = opcoes || {};
  var serie = (valores || [])
    .map(Number)
    .filter(function (n) {
      return isFinite(n);
    })
    .slice(-6);
  if (serie.length < 2) return '';

  var L = 84;
  var A = 28;
  var pad = 4;
  var max = Math.max.apply(null, serie);
  var min = Math.min.apply(null, serie);

  // PISO DE ESCALA — a correção que impede o gráfico de mentir.
  //
  // Um eixo que se ajusta sempre ao min/max transforma QUALQUER variação em
  // montanha: seis meses de mercado entre R$ 610 e R$ 640 (5%) viravam uma
  // rampa íngreme no card que afirma, em texto, que o valor é ESTÁVEL — o
  // desenho contradizendo a frase ao lado dele. Fixando um piso proporcional
  // ao nível da série, variação pequena parece pequena e o pico continua
  // parecendo pico, porque nele o intervalo real já é maior que o piso.
  var nivel = Math.abs(insightsUiMediana(serie)) || Math.abs(max) || 1;
  var spanMin = nivel * (cfg.spanMin != null ? cfg.spanMin : 0.25);
  var span = max - min;
  if (span < spanMin) {
    var meio = (max + min) / 2;
    min = meio - spanMin / 2;
    max = meio + spanMin / 2;
    span = spanMin;
  }
  if (!span) span = 1;
  var passo = serie.length > 1 ? (L - pad * 2) / (serie.length - 1) : 0;

  function y(v) {
    return A - pad - ((v - min) / span) * (A - pad * 2);
  }

  var pontos = serie.map(function (v, i) {
    return [pad + i * passo, y(v)];
  });
  var d = pontos
    .map(function (p, i) {
      return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    })
    .join(' ');

  var ultimo = pontos[pontos.length - 1];
  var base = cfg.base != null && isFinite(cfg.base) ? y(Number(cfg.base)) : null;
  var svg =
    '<svg class="ins-spark" width="' +
    L +
    '" height="' +
    A +
    '" viewBox="0 0 ' +
    L +
    ' ' +
    A +
    '" role="img" aria-label="' +
    insightsUiEscapar(cfg.rotuloAcessivel || 'Evolução dos últimos meses') +
    '">';
  if (base != null && base >= 0 && base <= A) {
    svg +=
      '<line x1="0" y1="' +
      base.toFixed(1) +
      '" x2="' +
      L +
      '" y2="' +
      base.toFixed(1) +
      '" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3" opacity="0.35"/>';
  }
  svg +=
    '<path d="' +
    d +
    '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" opacity="0.4"/>';
  svg +=
    '<circle cx="' +
    ultimo[0].toFixed(1) +
    '" cy="' +
    ultimo[1].toFixed(1) +
    '" r="3.5" fill="currentColor"/>';
  svg += '</svg>';
  return svg;
}

// ════════════════════════════════════════════════════════════
// 3. TRADUÇÃO: INSIGHT → CARD
// ════════════════════════════════════════════════════════════

function insightsUiEscapar(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function insightsUiMoeda(v) {
  if (typeof formatarMoeda === 'function') return formatarMoeda(v);
  return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
}

/** Concorda o número com o substantivo: 1 dia / 2 dias. */
function insightsUiPlural(n, singular, plural) {
  return n + ' ' + (Math.abs(n) === 1 ? singular : plural);
}

function insightsUiRotuloCategoria(v) {
  if (typeof rotuloCategoriaDespesa === 'function') {
    var r = rotuloCategoriaDespesa(v);
    if (r) return r;
  }
  return v || 'Sem categoria';
}

var INSIGHTS_UI_SEVERIDADE = {
  critico: { classe: 'critico', rotulo: 'Requer atenção' },
  atencao: { classe: 'atencao', rotulo: 'Vale conferir' },
  informativo: { classe: 'informativo', rotulo: 'Sugestão' },
  positivo: { classe: 'positivo', rotulo: 'Boa notícia' },
};

/**
 * Converte um insight cru na sua apresentação: ícone, título, frase, prova e
 * a ação sugerida. Um `case` por tipo, tudo num lugar só — é aqui que se
 * ajusta o tom sem tocar em regra de negócio.
 */
function insightsUiApresentar(ins) {
  var v = insightsUiMoeda;
  if (ins.tipo === 'anomalia') {
    var nome = insightsUiRotuloCategoria(ins.categoriaDespesa);
    return {
      icone: 'ph-fill ph-chart-line-up',
      titulo: nome + ' bem acima do seu normal',
      valor: v(ins.valor),
      valorSub: 'neste mês',
      delta: '×' + String(ins.fator).replace('.', ','),
      frase:
        'Costuma ficar perto de <strong>' +
        v(ins.referencia) +
        '</strong> por mês. Este mês está <strong>' +
        v(ins.delta) +
        '</strong> acima disso.',
      prova: [
        ['Mediana dos meses anteriores', v(ins.referencia)],
        ['Meses usados como base', String(ins.mesesBase)],
        ['Diferença', v(ins.delta)],
      ],
      acao: { rotulo: 'Ver os lançamentos', icone: 'ph ph-list-magnifying-glass' },
    };
  }
  if (ins.tipo === 'recorrente_oculto') {
    return {
      icone: 'ph-fill ph-arrows-clockwise',
      titulo: '“' + ins.rotulo + '” parece ser despesa fixa',
      valor: v(ins.valor),
      valorSub: 'por mês, em média',
      delta: insightsUiPlural(ins.mesesSeguidos, 'mês', 'meses'),
      frase:
        'Aparece há <strong>' +
        insightsUiPlural(ins.mesesSeguidos, 'mês seguido', 'meses seguidos') +
        '</strong> com valor parecido, mas não está marcada como fixa. ' +
        'Marcando, ela entra sozinha na projeção dos próximos meses.',
      prova: [
        ['Meses seguidos', String(ins.mesesSeguidos)],
        ['Valor típico', v(ins.valor)],
        ['Peso em 12 meses', v(ins.anualizado)],
      ],
      acao: { rotulo: 'Marcar como fixa', icone: 'ph ph-push-pin' },
    };
  }
  if (ins.tipo === 'reajuste') {
    var subiu = ins.delta > 0;
    return {
      icone: subiu ? 'ph-fill ph-trend-up' : 'ph-fill ph-trend-down',
      titulo: '“' + ins.rotulo + '” ' + (subiu ? 'subiu de preço' : 'ficou mais barata'),
      valor: v(ins.valor),
      valorSub: 'antes ' + v(ins.anterior),
      delta: (subiu ? '+' : '') + String(ins.pct).replace('.', ',') + '%',
      frase:
        'O valor mudou e <strong>se manteve</strong> por dois meses — é reajuste, não um mês fora da curva. ' +
        (subiu ? 'Custa ' : 'Economiza ') +
        '<strong>' +
        v(Math.abs(ins.impactoAnual)) +
        '</strong> a mais em 12 meses.',
      prova: [
        ['Valor anterior', v(ins.anterior)],
        ['Valor atual', v(ins.valor)],
        ['Efeito em 12 meses', v(ins.impactoAnual)],
      ],
      acao: { rotulo: 'Ver o histórico', icone: 'ph ph-clock-counter-clockwise' },
    };
  }
  if (ins.tipo === 'duplicada') {
    return {
      icone: 'ph-fill ph-copy',
      titulo: '“' + ins.rotulo + '” foi cobrada ' + ins.ocorrencias + ' vezes',
      valor: v(ins.valor),
      valorSub: 'somando as ' + ins.ocorrencias + ' cobranças',
      delta: ins.ocorrencias + '×',
      frase:
        'Nos meses anteriores esta cobrança aparecia <strong>uma vez só</strong>. ' +
        'Pode ser cobrança em duplicidade — ou um lançamento repetido sem querer.',
      prova: [
        ['Cobranças neste mês', String(ins.ocorrencias)],
        ['Valor de cada uma', v(ins.valorUnitario)],
        ['Total no mês', v(ins.valor)],
      ],
      acao: { rotulo: 'Conferir as duas', icone: 'ph ph-magnifying-glass' },
    };
  }
  if (ins.tipo === 'aperto') {
    var dia = function (ms) {
      return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    };
    var passageiro = ins.recuperaMs != null;
    // O CARD NÃO FALA DE SALDO — fala de ORDEM.
    //
    // O saldo livre da tela é de competência: receita menos saídas do mês
    // inteiro, independente do dia. Anunciar "seu caixa fica negativo" ao
    // lado de um saldo livre positivo lê-se como contradição, e foi
    // exatamente onde o primeiro usuário travou. A informação que sobra
    // de pé, e que a tela ainda não dava, é o DESCOMPASSO DE DATAS: neste
    // mês há contas vencendo antes de o dinheiro entrar.
    return {
      icone: passageiro ? 'ph-fill ph-calendar-x' : 'ph-fill ph-warning-circle',
      titulo: passageiro
        ? 'Entre ' + dia(ins.quandoMs) + ' e ' + dia(ins.recuperaMs) + ', sai antes de entrar'
        : 'A partir de ' + dia(ins.quandoMs) + ', sai mais do que entra',
      valor: v(Math.abs(ins.valor)),
      valorSub: 'é o que falta no pior dia',
      delta: passageiro ? insightsUiPlural(ins.diasNoVermelho, 'dia', 'dias') : 'sem data de volta',
      frase: passageiro
        ? 'O mês em si fecha no positivo — isto é ordem, não falta de dinheiro: ' +
          'algumas contas vencem <strong>antes</strong> de a receita cair. ' +
          'Adiar um vencimento para depois de ' +
          dia(ins.recuperaMs) +
          ' resolve.'
        : 'Somando o que já está agendado nas suas contas, as saídas passam as ' +
          'entradas a partir de <strong>' +
          dia(ins.quandoMs) +
          '</strong> e não voltam ao azul dentro da janela analisada.',
      prova: [
        ['Primeiro dia no vermelho', new Date(ins.quandoMs).toLocaleDateString('pt-BR')],
        passageiro
          ? ['Volta ao positivo em', new Date(ins.recuperaMs).toLocaleDateString('pt-BR')]
          : ['Volta ao positivo', 'não, dentro da janela'],
        ['Maior falta no período', v(Math.abs(ins.valor))],
        // Sem esta linha o número parece brigar com o saldo livre do topo.
        ['Conta feita sobre', 'saldo das contas cadastradas, por data'],
      ],
      acao: { rotulo: 'Ver os vencimentos', icone: 'ph ph-calendar-dots' },
    };
  }
  return null;
}

function insightsUiCard(ins, serie) {
  var ap = insightsUiApresentar(ins);
  if (!ap) return '';
  var sev = INSIGHTS_UI_SEVERIDADE[ins.severidade] || INSIGHTS_UI_SEVERIDADE.informativo;
  var idEsc = insightsUiEscapar(ins.id);

  var spark = serie && serie.valores ? insightsUiSparkline(serie.valores, serie) : '';

  var prova = ap.prova
    .map(function (p) {
      return (
        '<div class="ins-porque-linha"><span>' +
        insightsUiEscapar(p[0]) +
        '</span><b>' +
        insightsUiEscapar(p[1]) +
        '</b></div>'
      );
    })
    .join('');

  return (
    '<article class="ins-card ins-card--' +
    sev.classe +
    '">' +
    '<div class="ins-card-head">' +
    '<span class="ins-card-icone"><i class="' +
    ap.icone +
    '"></i></span>' +
    '<div class="ins-card-headtxt">' +
    '<div class="ins-card-sev">' +
    sev.rotulo +
    '</div>' +
    '<h4 class="ins-card-titulo">' +
    insightsUiEscapar(ap.titulo) +
    '</h4>' +
    '</div>' +
    '<button type="button" class="ins-dispensar" title="Dispensar este aviso" ' +
    'aria-label="Dispensar este aviso" onclick="insightsUiDispensar(\'' +
    idEsc +
    '\')"><i class="ph ph-x"></i></button>' +
    '</div>' +
    '<div class="ins-card-corpo">' +
    '<div>' +
    '<div class="ins-card-valor">' +
    insightsUiEscapar(ap.valor) +
    '</div>' +
    '<div class="ins-card-valor-sub">' +
    insightsUiEscapar(ap.valorSub) +
    '</div>' +
    '</div>' +
    (spark
      ? '<div style="text-align:right;color:var(--ins-cor);">' +
        spark +
        '<div style="margin-top:5px;"><span class="ins-delta">' +
        insightsUiEscapar(ap.delta) +
        '</span></div></div>'
      : '<span class="ins-delta">' + insightsUiEscapar(ap.delta) + '</span>') +
    '</div>' +
    '<p class="ins-card-frase">' +
    ap.frase +
    '</p>' +
    '<details class="ins-porque">' +
    '<summary><i class="ph ph-caret-down"></i> Por que estou vendo isto</summary>' +
    '<div class="ins-porque-corpo">' +
    prova +
    '</div>' +
    '</details>' +
    '<div class="ins-card-acoes">' +
    '<button type="button" class="ins-btn ins-btn--primario" ' +
    'onclick="insightsUiAgir(\'' +
    idEsc +
    '\')"><i class="' +
    ap.acao.icone +
    '"></i> ' +
    insightsUiEscapar(ap.acao.rotulo) +
    '</button>' +
    '<button type="button" class="ins-btn ins-btn--fantasma" ' +
    'onclick="insightsUiDispensar(\'' +
    idEsc +
    '\')">Dispensar</button>' +
    '</div>' +
    '</article>'
  );
}

// ════════════════════════════════════════════════════════════
// 4. SÉRIE HISTÓRICA PARA O SPARKLINE
// ════════════════════════════════════════════════════════════

/**
 * Monta a série que cada tipo de card desenha. Anomalia olha a categoria
 * inteira; reajuste e recorrência olham o grupo daquela descrição. Devolve
 * `null` quando o desenho não acrescentaria nada — card sem gráfico é melhor
 * que gráfico sem sentido.
 */
function insightsUiSerie(ins, lista) {
  var M = window.AppliqueiInsights;
  if (!M) return null;
  if (ins.tipo === 'anomalia') {
    var por = {};
    lista.forEach(function (t) {
      if (M.CATEGORIAS_SAIDA.indexOf(t.categoria) < 0) return;
      if ((t.categoriaDespesa || '__sem_categoria__') !== ins.categoriaDespesa) return;
      var k = t.ano + '-' + String(Number(t.mes) + 1).padStart(2, '0');
      por[k] = (por[k] || 0) + (Number(t.valor) || 0);
    });
    var chaves = Object.keys(por).sort();
    if (chaves.length < 2) return null;
    return {
      valores: chaves.map(function (k) {
        return por[k];
      }),
      base: ins.referencia,
      rotuloAcessivel:
        'Gastos mensais em ' +
        insightsUiRotuloCategoria(ins.categoriaDespesa) +
        '; último mês ' +
        insightsUiMoeda(ins.valor) +
        ', mediana anterior ' +
        insightsUiMoeda(ins.referencia),
    };
  }
  if (ins.tipo === 'reajuste' || ins.tipo === 'recorrente_oculto') {
    var alvo = ins.rotulo;
    var grupos = M.agruparRecorrentes(lista);
    var chave = M.normalizarDescricao(alvo);
    var g = grupos.filter(function (x) {
      return x.chave === chave;
    })[0];
    if (!g || g.unitarioPorMes.length < 2) return null;
    return {
      valores: g.unitarioPorMes,
      // No reajuste a referência é o preço ANTIGO (a linha que foi rompida);
      // na recorrência é a própria mediana, porque a afirmação do card é que
      // a série anda colada nela.
      base: ins.anterior != null ? ins.anterior : insightsUiMediana(g.unitarioPorMes),
      rotuloAcessivel: 'Valor mensal de ' + alvo + ' nos últimos meses',
    };
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// 5. AÇÃO — LEVA ATÉ O LUGAR, NUNCA ALTERA
// ════════════════════════════════════════════════════════════

var insightsUiUltimo = { insights: [], meta: null };

/**
 * O botão primário do card. Cada tipo leva a um lugar diferente da tela, e
 * nenhum deles grava: a mudança acontece no fluxo normal, onde as validações
 * e os contratos de integração já rodam.
 */
function insightsUiAgir(id) {
  var ins = insightsUiUltimo.insights.filter(function (i) {
    return i.id === id;
  })[0];
  if (!ins) return;

  if (ins.tipo === 'aperto') {
    insightsUiIrPara('painelVencimentos');
    if (typeof mostrarToast === 'function') {
      mostrarToast('Confira os vencimentos até a data do aperto.', 'aviso');
    }
    return;
  }

  // Anomalia é sobre uma CATEGORIA: usa o sub-filtro de chips que o extrato já
  // tem, em vez de um caminho paralelo. O usuário cai exatamente na lista que
  // ele veria clicando no chip à mão.
  if (ins.tipo === 'anomalia') {
    if (typeof filtrarExtratoPorCategoria === 'function' && ins.categoriaDespesa) {
      filtrarExtratoPorCategoria(ins.categoriaDespesa);
    }
    insightsUiIrPara('extratoUnificado');
    return;
  }

  // Os demais são sobre uma DESCRIÇÃO. Como o extrato não tem busca textual,
  // o card não inventa uma: destaca as linhas correspondentes onde elas já
  // estão. Marcar em vez de filtrar preserva o contexto — a pessoa vê a
  // duplicata ao lado dos outros lançamentos do mês, que é a comparação que
  // ela precisa fazer.
  insightsUiRealcar(ins.rotulo);
}

var insightsUiRealceTimer = null;

/** Rola até o elemento sem brigar com quem prefere menos movimento. */
function insightsUiIrPara(elId) {
  var el = document.getElementById(elId);
  if (!el || typeof el.scrollIntoView !== 'function') return;
  var suave =
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'center' });
}

/**
 * Realça no extrato as linhas de uma descrição e apaga o realce sozinho.
 *
 * O realce é temporário de propósito: é um "olhe aqui", não um estado. Estado
 * pedindo para ser limpo é a origem clássica do "por que essa linha está
 * amarela?" três telas depois.
 */
function insightsUiRealcar(descricao) {
  var M = window.AppliqueiInsights;
  if (!M) return;
  var alvo = M.normalizarDescricao(descricao);
  if (!alvo) return;

  var lista = document.getElementById('extratoUnificado');
  if (!lista) {
    if (typeof mostrarToast === 'function') {
      mostrarToast('Abra o extrato do mês para conferir estes lançamentos.', 'info');
    }
    return;
  }

  if (insightsUiRealceTimer) clearTimeout(insightsUiRealceTimer);
  var achou = 0;
  var primeiro = null;
  lista.querySelectorAll('.extrato-item').forEach(function (el) {
    var bate = (el.dataset.extDesc || '') === alvo;
    el.classList.toggle('ins-realce', bate);
    if (bate) {
      achou++;
      if (!primeiro) primeiro = el;
    }
  });

  if (!achou) {
    if (typeof mostrarToast === 'function') {
      mostrarToast('Não encontrei “' + descricao + '” no mês em visão.', 'aviso');
    }
    return;
  }

  // O chip de categoria pode estar escondendo a linha realçada: com um filtro
  // ativo, "destaquei 2 lançamentos" apontaria para o nada.
  if (primeiro && primeiro.style.display === 'none') {
    if (typeof filtrarExtratoPorCategoria === 'function') filtrarExtratoPorCategoria('');
  }
  if (primeiro && typeof primeiro.scrollIntoView === 'function') {
    var suave =
      typeof window.matchMedia === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    primeiro.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'center' });
  }
  if (typeof mostrarToast === 'function') {
    mostrarToast(
      achou === 1 ? 'Lançamento destacado no extrato.' : achou + ' lançamentos destacados.',
      'info'
    );
  }
  insightsUiRealceTimer = setTimeout(function () {
    lista.querySelectorAll('.ins-realce').forEach(function (el) {
      el.classList.remove('ins-realce');
    });
  }, 6000);
}

// ════════════════════════════════════════════════════════════
// 6. RENDER
// ════════════════════════════════════════════════════════════

function insightsUiEstadoAprendendo(meta) {
  var faltam = Math.max(0, meta.minMesesHistorico - meta.mesesDisponiveis);
  var pct = Math.min(100, Math.round((meta.mesesDisponiveis / meta.minMesesHistorico) * 100));
  return (
    '<div class="ins-vazio">' +
    '<span class="ins-vazio-icone"><i class="ph-fill ph-sparkle"></i></span>' +
    '<div class="ins-vazio-txt">' +
    '<div class="ins-vazio-titulo">Ainda aprendendo o seu padrão</div>' +
    '<div class="ins-vazio-sub">Com ' +
    (faltam === 1 ? 'mais um mês' : 'mais ' + faltam + ' meses') +
    ' de lançamentos, o app começa a apontar gastos fora da curva, ' +
    'assinaturas que subiram e despesas que já viraram fixas.</div>' +
    '<div class="ins-progresso"><i style="width:' +
    pct +
    '%"></i></div>' +
    '</div>' +
    '</div>'
  );
}

function insightsUiEstadoLimpo(meta) {
  return (
    '<div class="ins-vazio">' +
    '<span class="ins-vazio-icone"><i class="ph-fill ph-check-circle"></i></span>' +
    '<div class="ins-vazio-txt">' +
    '<div class="ins-vazio-titulo">Nada fora do padrão neste mês</div>' +
    '<div class="ins-vazio-sub">' +
    (meta.dispensados
      ? meta.dispensados +
        ' aviso(s) dispensado(s). <a href="#" onclick="insightsUiRestaurarTodos();return false;" ' +
        'style="color:var(--cor-primaria);font-weight:600;">Mostrar novamente</a>'
      : 'Seus gastos seguem o comportamento dos meses anteriores.') +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

/**
 * Constrói a função de saldo projetado que o detector de aperto usa — ou
 * devolve `null` para ele NÃO rodar.
 *
 * ═══ O DEFEITO QUE ESTA FUNÇÃO CORRIGE ═══
 *
 * A primeira versão somava TODOS os baldes de saldoCaixaPorConta(). Só que
 * nem todo balde é uma conta: mpCalcularSaldoPorInstituicao cria buckets
 * sintéticos para o dinheiro que não dá para atribuir —
 *   · `a-reconciliar`  → lançamento sem conta e sem banco;
 *   · `nome:<banco>`   → banco digitado que não tem conta cadastrada.
 * Estes NÃO recebem saldo de abertura (abertura só vem de contasAtivas()),
 * então eles só acumulam saída e ficam negativos POR CONSTRUÇÃO.
 *
 * Medido num cenário de mês positivo sem contas atribuídas: a projeção dava
 * −2.500 no primeiro dia, e os −2.500 eram integralmente `a-reconciliar`. O
 * card anunciava um rombo que era, na verdade, cadastro incompleto. Somar um
 * balde contábil como se fosse dinheiro é inventar um saldo que não é de
 * ninguém.
 *
 * Agora: só contas cadastradas entram na conta. E se houver QUALQUER
 * movimento fora delas, a resposta certa não é um número menos errado — é
 * não responder. Com parte das saídas sem dono, nenhuma projeção de caixa é
 * confiável, e um alerta que erra em dinheiro custa mais do que um alerta que
 * não aparece.
 */
function insightsUiFonteDeSaldo() {
  if (typeof saldoCaixaPorConta !== 'function' || typeof contasAtivas !== 'function') return null;

  var idsReais = {};
  var qtdContas = 0;
  try {
    contasAtivas().forEach(function (c) {
      if (c && c.id) {
        idsReais[c.id] = true;
        qtdContas++;
      }
    });
  } catch (_) {
    return null;
  }
  if (!qtdContas) return null;

  function separar(ms) {
    var mapa = saldoCaixaPorConta(ms) || {};
    var emContas = 0;
    var foraDeConta = 0;
    Object.keys(mapa).forEach(function (k) {
      var v = Number(mapa[k]) || 0;
      if (idsReais[k]) emContas += v;
      else foraDeConta += v;
    });
    return { emContas: emContas, foraDeConta: foraDeConta };
  }

  // A validação é feita nas DUAS pontas, antes de devolver a função, e não
  // dia a dia lá dentro: o detector trata valor não-finito como "dia sem
  // dado" e simplesmente pula, então recusar por dentro deixaria a análise
  // seguir com metade da janela — pior que não analisar.
  //
  // Duas pontas bastam: a foto de hoje cobre o passado, e a projeção do
  // último dia acumula TUDO o que está agendado na janela (ver
  // aplicarAgendadoNoSaldo, que soma o intervalo inteiro). Se nem hoje nem o
  // fim da janela têm dinheiro fora de conta, nenhum dia do meio tem.
  var janela =
    (window.AppliqueiInsights && window.AppliqueiInsights.LIMIARES.diasJanelaAperto) || 45;
  var agora = Date.now();
  var pontas = [separar(agora), separar(agora + janela * 86400000)];
  for (var i = 0; i < pontas.length; i++) {
    if (Math.abs(pontas[i].foraDeConta) > 0.01) return null;
  }

  return function (ms) {
    return separar(ms).emContas;
  };
}

/**
 * Ponto de entrada. Chamado por atualizarTelaControle() — o painel acompanha
 * o mês em visão em vez de ficar preso ao mês corrente, senão navegar para
 * agosto mostraria a análise de setembro sem avisar.
 */
function insightsUiRenderizar() {
  var host = document.getElementById('painelInsights');
  if (!host) return;
  var M = window.AppliqueiInsights;
  if (!M || typeof transacoes === 'undefined') {
    host.innerHTML = '';
    return;
  }

  var ref =
    typeof visaoMes !== 'undefined' && typeof visaoAno !== 'undefined'
      ? { ano: visaoAno, mes: visaoMes }
      : null;

  // O saldo projetado vem da fonte canônica (contas.js), nunca recalculado
  // aqui — ver o comentário de insightsAperto. E só faz sentido perguntar
  // sobre o futuro quando o mês em visão é o corrente.
  var agoraD = new Date();
  var noMesCorrente = !ref || (ref.ano === agoraD.getFullYear() && ref.mes === agoraD.getMonth());
  var saldoEm = noMesCorrente ? insightsUiFonteDeSaldo() : null;

  var r;
  try {
    r = M.analisar(transacoes, {
      ref: ref,
      dispensados: insightsUiLerDispensados(),
      saldoEm: saldoEm,
    });
  } catch (e) {
    // Um insight que quebra não pode derrubar o Controle Financeiro inteiro:
    // o painel é acessório, o extrato não é.
    console.error('[insights] análise', e);
    host.innerHTML = '';
    return;
  }
  insightsUiUltimo = r;

  var lista = transacoes;
  var corpo;
  if (r.insights.length) {
    corpo =
      '<div class="ins-grid">' +
      r.insights
        .map(function (i) {
          return insightsUiCard(i, insightsUiSerie(i, lista));
        })
        .join('') +
      '</div>';
  } else if (r.meta.mesesDisponiveis < r.meta.minMesesHistorico) {
    corpo = insightsUiEstadoAprendendo(r.meta);
  } else {
    corpo = insightsUiEstadoLimpo(r.meta);
  }

  var contagem = r.insights.length
    ? '<span class="ins-painel-contagem">' + r.insights.length + '</span>'
    : '';
  var nota = r.meta.dispensados
    ? '<span class="ins-painel-nota">' +
      r.meta.dispensados +
      ' dispensado(s) · <a href="#" onclick="insightsUiRestaurarTodos();return false;" ' +
      'style="color:var(--cor-primaria);font-weight:600;">mostrar</a></span>'
    : '';

  host.innerHTML =
    '<div class="ins-painel">' +
    '<div class="ins-painel-head">' +
    '<span class="ins-painel-titulo"><i class="ph-fill ph-sparkle"></i> O que notamos' +
    '</span>' +
    contagem +
    nota +
    '</div>' +
    corpo +
    '</div>';
}

if (typeof window !== 'undefined') {
  window.AppliqueiInsightsUI = {
    renderizar: insightsUiRenderizar,
    card: insightsUiCard,
    dispensar: insightsUiDispensar,
    restaurarTodos: insightsUiRestaurarTodos,
    sparkline: insightsUiSparkline,
    apresentar: insightsUiApresentar,
    serie: insightsUiSerie,
    agir: insightsUiAgir,
    realcar: insightsUiRealcar,
    fonteDeSaldo: insightsUiFonteDeSaldo,
  };
}

// ════════════════════════════════════════════════════════════
// 7. SUGESTÃO DE CATEGORIA NO FORMULÁRIO
// ════════════════════════════════════════════════════════════

var insightsSugestaoTimer = null;
var insightsSugestaoAtual = null;
/** Descrições em que o usuário já disse "não" nesta sessão. */
var insightsSugestaoRecusada = {};

var INSIGHTS_ROTULO_CONTABIL = {
  receita: 'Receita',
  despesa_fixa: 'Despesa fixa',
  despesa_variavel: 'Despesa variável',
  cartao_credito: 'Cartão de crédito',
};

/** Qual chip do topo do formulário corresponde à categoria contábil. */
function insightsChipDaCategoria(cat) {
  if (cat === 'receita') return 'entrada';
  if (cat === 'cartao_credito') return 'cartao';
  if (cat === 'despesa_fixa' || cat === 'despesa_variavel') return 'saida';
  return null;
}

/**
 * Roda a cada tecla na descrição, com folga para não recalcular o mapa de
 * categorias a cada caractere.
 *
 * Três guardas antes de sugerir, todas pelo mesmo motivo — sugestão que
 * atrapalha é pior que sugestão nenhuma:
 *   · descrição curta demais ainda não identifica nada;
 *   · categoria JÁ escolhida pelo usuário não se questiona;
 *   · descrição recusada nesta sessão não volta a insistir.
 */
function insightsSugestaoAoDigitar() {
  if (insightsSugestaoTimer) clearTimeout(insightsSugestaoTimer);
  insightsSugestaoTimer = setTimeout(insightsSugestaoAvaliar, 280);
}

function insightsSugestaoAvaliar() {
  var host = document.getElementById('sugestaoCategoria');
  if (!host) return;
  var campo = document.getElementById('descTransacao');
  var M = window.AppliqueiInsights;
  if (!campo || !M || typeof transacoes === 'undefined') return insightsSugestaoLimpar();

  var texto = (campo.value || '').trim();
  if (texto.length < 3) return insightsSugestaoLimpar();
  if (insightsSugestaoRecusada[M.normalizarDescricao(texto)]) return insightsSugestaoLimpar();

  var selCat = document.getElementById('categoriaTransacao');
  if (selCat && selCat.value) return insightsSugestaoLimpar();

  var sug;
  try {
    sug = M.sugerirCategoria(texto, transacoes);
  } catch (e) {
    console.error('[insights] sugestão', e);
    return insightsSugestaoLimpar();
  }
  if (!sug) return insightsSugestaoLimpar();

  insightsSugestaoAtual = sug;
  var rotuloContabil = INSIGHTS_ROTULO_CONTABIL[sug.categoria] || sug.categoria;
  var rotuloDespesa = sug.categoriaDespesa ? insightsUiRotuloCategoria(sug.categoriaDespesa) : '';
  var alvo = rotuloContabil + (rotuloDespesa ? ' · ' + rotuloDespesa : '');

  host.innerHTML =
    '<div class="ins-sugestao">' +
    '<i class="ph-fill ph-sparkle ins-sugestao-icone"></i>' +
    '<div class="ins-sugestao-txt">' +
    'Você costuma lançar isso como <b>' +
    insightsUiEscapar(alvo) +
    '</b>' +
    '<span class="ins-sugestao-base">' +
    (sug.via === 'aproximada' ? 'por semelhança com ' : 'com base em ') +
    sug.baseadoEm +
    (sug.baseadoEm === 1 ? ' lançamento anterior' : ' lançamentos anteriores') +
    '</span>' +
    '</div>' +
    '<button type="button" class="ins-sugestao-usar" onclick="insightsSugestaoUsar()">Usar</button>' +
    '<button type="button" class="ins-sugestao-nao" title="Não sugerir para esta descrição" ' +
    'aria-label="Descartar sugestão" onclick="insightsSugestaoRecusar()">' +
    '<i class="ph ph-x"></i></button>' +
    '</div>';
}

function insightsSugestaoLimpar() {
  var host = document.getElementById('sugestaoCategoria');
  if (host) host.innerHTML = '';
  insightsSugestaoAtual = null;
}

/**
 * Aplica a sugestão pelo MESMO caminho do clique manual.
 *
 * Não escreve em transação nenhuma: só preenche os campos do formulário, que
 * o usuário ainda revisa e submete. selecionarChipTipo mantém o chip do topo
 * coerente com o select — preencher só o select deixaria o formulário dizendo
 * duas coisas diferentes ao mesmo tempo.
 */
function insightsSugestaoUsar() {
  var sug = insightsSugestaoAtual;
  if (!sug) return;
  var selCat = document.getElementById('categoriaTransacao');
  if (!selCat) return;

  var chip = insightsChipDaCategoria(sug.categoria);
  if (chip && typeof selecionarChipTipo === 'function') selecionarChipTipo(chip);
  selCat.value = sug.categoria;
  if (typeof verificarRegraCartao === 'function') verificarRegraCartao();

  // A categoria de despesa só existe depois que verificarRegraCartao popula o
  // select; e só é aplicada se a opção realmente existir — categoria apagada
  // no passado ainda aparece no histórico e selecioná-la deixaria o campo num
  // valor fantasma que o formulário não sabe validar.
  if (sug.categoriaDespesa) {
    var selDesp = document.getElementById('categoriaDespesa');
    if (selDesp) {
      var existe = Array.prototype.some.call(selDesp.options, function (o) {
        return o.value === sug.categoriaDespesa;
      });
      if (existe) selDesp.value = sug.categoriaDespesa;
    }
  }

  insightsSugestaoLimpar();
  if (typeof mostrarToast === 'function') {
    mostrarToast('Classificação preenchida — confira antes de salvar.', 'info');
  }
}

/** "Não" vale para esta descrição até a página recarregar. */
function insightsSugestaoRecusar() {
  var campo = document.getElementById('descTransacao');
  var M = window.AppliqueiInsights;
  if (campo && M) insightsSugestaoRecusada[M.normalizarDescricao(campo.value || '')] = true;
  insightsSugestaoLimpar();
}

if (typeof window !== 'undefined' && window.AppliqueiInsightsUI) {
  window.AppliqueiInsightsUI.sugerirAoDigitar = insightsSugestaoAoDigitar;
  window.AppliqueiInsightsUI.usarSugestao = insightsSugestaoUsar;
  window.AppliqueiInsightsUI.limparSugestao = insightsSugestaoLimpar;
}
