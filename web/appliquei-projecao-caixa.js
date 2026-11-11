/**
 * Appliquei — Projeção do caixa (aba Projeção do Controle financeiro).
 *
 * A pergunta da aba é "vai faltar dinheiro em algum mês?". A resposta vem
 * primeiro: quanto você deve ter no fim do horizonte, o menor ponto e o
 * mês que fica negativo — com o MOTIVO e o que fazer. Depois: a linha da
 * sobra acumulada (contínua no que já aconteceu, tracejada no previsto),
 * entra × sai dos próximos meses, o que muda (conta que vem uma vez só,
 * parcela que acaba), o mês a mês e o "E se…?" para testar uma compra ou
 * uma entrada antes de lançar.
 *
 * Os números são os da DRE de atualizarTelaControle (dreDados): nada de
 * resultado é recalculado aqui. Daqui só saem leituras de `transacoes` para
 * explicar um mês (maiores saídas, o que muda) — nada é gravado.
 *
 * MOTOR: funções puras projXxx (testadas em test/projecao-caixa.test.js).
 * TELA: projHtmlXxx, usadas pelo web (renderDreBarras) e pelo celular
 * (mobRenderDRE). Simulador: projSimAbrir … projSimLancar.
 */

var PROJ_MESES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];
var PROJ_MESES_LONGOS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

// O último conjunto de números desenhado (o simulador e os botões leem daqui).
var projUltimo = null;

function _projN(v) {
  return Number(v) || 0;
}

function _projEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _projFmt(v) {
  return typeof formatarMoeda === 'function'
    ? formatarMoeda(v)
    : 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
}

/** "R$ 1.900" — sem centavos, para rótulos curtos. */
function _projFmtCurto(v) {
  const n = Math.round(Math.abs(Number(v) || 0));
  return (v < -0.5 ? '−' : '') + 'R$ ' + n.toLocaleString('pt-BR');
}

function projRotuloMes(m) {
  return PROJ_MESES[m.mes] + '/' + String(m.ano).slice(-2);
}

/** Índice do mês de HOJE na janela (o "hoje" do gráfico); -1 se fora. */
function projIdxHoje(meses, hoje) {
  const h = hoje || new Date();
  return (meses || []).findIndex((m) => m.mes === h.getMonth() && m.ano === h.getFullYear());
}

function projEntraSai(m) {
  return {
    entra: _projN(m.receita) + _projN(m.resgate),
    sai: _projN(m.despesas) + _projN(m.invFixo) + _projN(m.invVar) + _projN(m.sonho),
  };
}

/**
 * O resumo do topo: onde termina, o menor ponto, o primeiro mês negativo
 * (a partir de hoje) e a sobra média por mês (do mês, sem o que veio antes).
 */
function projResumo(meses, idxHoje) {
  const vals = meses.map((m) => _projN(m.saldoAcumulado));
  const desde = Math.max(0, idxHoje);
  let menorIdx = desde;
  for (let i = desde; i < vals.length; i++) if (vals[i] < vals[menorIdx]) menorIdx = i;
  let primeiroNeg = -1;
  for (let i = desde; i < vals.length; i++) {
    if (vals[i] < -0.005) {
      primeiroNeg = i;
      break;
    }
  }
  const sobras = meses.slice(desde).map((m) => _projN(m.saldoAcumulado) - _projN(m.saldoCarregado));
  return {
    finalIdx: vals.length - 1,
    final: vals[vals.length - 1] || 0,
    menorIdx,
    menor: vals[menorIdx] || 0,
    primeiroNeg,
    mediaSobra: sobras.length ? sobras.reduce((a, v) => a + v, 0) / sobras.length : 0,
  };
}

/** Primeiro mês depois de hoje sem nenhuma entrada lançada (havendo entrada antes). */
function projSemReceita(meses, idxHoje) {
  const desde = Math.max(0, idxHoje);
  const teveAntes = meses.slice(0, desde + 1).some((m) => projEntraSai(m).entra > 0.005);
  if (!teveAntes) return -1;
  for (let i = desde + 1; i < meses.length; i++) {
    if (projEntraSai(meses[i]).entra < 0.005) return i;
  }
  return -1;
}

var PROJ_SAIDAS = [
  'despesa_fixa',
  'despesa_variavel',
  'cartao_credito',
  'investimento_fixo',
  'investimento_variavel',
  'sonho',
];

function _projNormDesc(s) {
  return String(s || '')
    .replace(/\s*\(\d+\/\d+\)\s*$/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Saídas de um mês, da maior para a menor, com o tipo ("todo mês", "parcela", "uma vez"). */
function projSaidasDoMes(mes, ano) {
  const lista = typeof transacoes !== 'undefined' ? transacoes : [];
  return lista
    .filter(
      (t) =>
        t.mes === mes &&
        t.ano === ano &&
        PROJ_SAIDAS.indexOf(t.categoria) !== -1 &&
        !(typeof cfEhAporteExterno === 'function' && cfEhAporteExterno(t))
    )
    .map((t) => {
      const parc = String(t.descricao || '').match(/\((\d+)\/(\d+)\)\s*$/);
      let tipo = 'uma vez';
      if (parc) tipo = 'parcela ' + parc[1] + ' de ' + parc[2];
      else if (t.categoria === 'cartao_credito') tipo = 'cartão';
      else if (t.groupId) tipo = 'todo mês';
      return {
        id: t.id,
        desc: String(t.descricao || 'Lançamento').replace(/\s*\(\d+\/\d+\)\s*$/, ''),
        chave: _projNormDesc(t.descricao),
        valor: _projN(t.valor),
        tipo,
        recorrente: !!t.groupId,
      };
    })
    .sort((a, b) => b.valor - a.valor);
}

/**
 * Por que o mês i fica negativo: as maiores saídas que NÃO estavam no mês
 * anterior (conta do ano, matrícula, compra nova) e quanto guardar por mês
 * até lá para não ficar no vermelho.
 */
function projMotivoNegativo(meses, i, idxHoje) {
  const m = meses[i];
  if (!m) return null;
  const ant = meses[i - 1];
  const chavesAnt = new Set(ant ? projSaidasDoMes(ant.mes, ant.ano).map((x) => x.chave) : []);
  const novas = projSaidasDoMes(m.mes, m.ano).filter((x) => !chavesAnt.has(x.chave));
  const falta = Math.abs(Math.min(0, _projN(m.saldoAcumulado)));
  const mesesAte = i - Math.max(0, idxHoje);
  return {
    culpados: novas.slice(0, 2),
    falta,
    guardarPorMes: mesesAte > 0 ? Math.ceil(falta / mesesAte / 5) * 5 : 0,
    mesesAte,
  };
}

/**
 * O que muda dentro do horizonte, a partir do mês que vem: contas que vêm uma
 * vez só (acima de R$ 300) e séries (fixas, parcelas do cartão) que acabam —
 * a partir do mês seguinte ao fim, sobra aquele valor todo mês.
 */
function projOQueMuda(meses, idxHoje) {
  const lista = typeof transacoes !== 'undefined' ? transacoes : [];
  if (!meses.length) return [];
  const idx = (ano, mes) => ano * 12 + mes;
  const ini = idx(meses[0].ano, meses[0].mes);
  const hoje = meses[Math.max(0, idxHoje)];
  const desde = hoje ? idx(hoje.ano, hoje.mes) + 1 : ini;
  const fim = idx(meses[meses.length - 1].ano, meses[meses.length - 1].mes);
  const out = [];

  // Uma vez só: saída sem série, grande o bastante para mexer no mês.
  lista.forEach((t) => {
    if (t.groupId || PROJ_SAIDAS.indexOf(t.categoria) === -1 || t.categoria === 'cartao_credito')
      return;
    const k = idx(t.ano, t.mes);
    if (k < desde || k > fim || _projN(t.valor) < 300) return;
    out.push({
      k,
      mes: t.mes,
      ano: t.ano,
      titulo: String(t.descricao || 'Conta'),
      sub: 'vem uma vez só',
      valor: -_projN(t.valor),
    });
  });

  // Séries que acabam: o último mês da série cai dentro do horizonte.
  const series = {};
  lista.forEach((t) => {
    if (!t.groupId || PROJ_SAIDAS.indexOf(t.categoria) === -1) return;
    const k = idx(t.ano, t.mes);
    const s = series[t.groupId] || (series[t.groupId] = { ult: -Infinity, t: null });
    if (k > s.ult) {
      s.ult = k;
      s.t = t;
    }
  });
  Object.keys(series).forEach((g) => {
    const s = series[g];
    if (s.ult < desde - 1 || s.ult >= fim) return;
    const prox = s.ult + 1;
    const t = s.t;
    const parc = /\(\d+\/\d+\)\s*$/.test(String(t.descricao || ''));
    out.push({
      k: prox,
      mes: prox % 12,
      ano: Math.floor(prox / 12),
      titulo:
        (parc ? 'Acaba a parcela de ' : 'Acaba ') +
        _projNormDesc(t.descricao).replace(/^./, (c) => c.toUpperCase()),
      sub: 'sobra a mais todo mês depois disso',
      valor: _projN(t.valor),
    });
  });

  return out
    .filter((e) => e.k >= ini && e.k <= fim)
    .sort((a, b) => a.k - b.k || Math.abs(b.valor) - Math.abs(a.valor))
    .slice(0, 8);
}

/**
 * Simulação: a sobra acumulada com uma compra (sinal −1) ou entrada (+1) de
 * `valor` a partir do mês `idx`. `parcelas` > 1 divide a compra em parcelas
 * mensais; `recorrente` repete a entrada todo mês. Puro.
 */
function projSimularSerie(vals, idx, valor, parcelas, sinal, recorrente) {
  const v = Math.max(0, Number(valor) || 0);
  const n = Math.max(1, parseInt(parcelas, 10) || 1);
  return vals.map((x, j) => {
    if (j < idx) return x;
    const passados = j - idx + 1;
    let efeito;
    if (recorrente) efeito = v * passados;
    else efeito = (v / n) * Math.min(n, passados);
    return x + sinal * efeito;
  });
}

function projPrimeiroNegativo(vals, desde) {
  for (let i = Math.max(0, desde); i < vals.length; i++) if (vals[i] < -0.005) return i;
  return -1;
}

/**
 * A resposta do "E se…?" em uma frase, com as saídas possíveis quando a
 * compra deixa algum mês negativo: o menor parcelamento que não deixa, e o
 * primeiro mês em que ela cabe à vista.
 */
function projSimResposta(vals, idx, valor, forma, tipo, rotulos) {
  const compra = tipo !== 'entrada';
  const recorrente = !compra && forma === 'mensal';
  const n = compra ? Math.max(1, parseInt(forma, 10) || 1) : 1;
  const nova = projSimularSerie(vals, idx, valor, n, compra ? -1 : 1, recorrente);
  const neg = projPrimeiroNegativo(nova, idx);
  const fim = nova.length - 1;
  const dif = nova[fim] - vals[fim];
  const r = { nova, neg, dif, final: nova[fim], alternativas: [] };
  if (!compra || neg === -1) return r;
  [2, 3, 6, 10, 12].forEach((p) => {
    if (p <= n || r.alternativas.some((a) => a.tipo === 'parcelas')) return;
    if (projPrimeiroNegativo(projSimularSerie(vals, idx, valor, p, -1), idx) === -1)
      r.alternativas.push({ tipo: 'parcelas', n: p });
  });
  for (let k = idx + 1; k < vals.length; k++) {
    if (projPrimeiroNegativo(projSimularSerie(vals, k, valor, 1, -1), idx) === -1) {
      r.alternativas.push({ tipo: 'esperar', idx: k, rotulo: rotulos ? rotulos[k] : '' });
      break;
    }
  }
  return r;
}

// ------------------------------------------------------------
// TELA
// ------------------------------------------------------------

/** A linha da sobra acumulada. `extra` = a série simulada, por cima. */
function projSvgLinha(vals, idxHoje, opts) {
  const o = opts || {};
  const W = o.w || 342;
  const H = o.h || 150;
  const pad = 14;
  const todos = vals.concat(o.extra || []).concat([0]);
  const max = Math.max(...todos);
  const min = Math.min(...todos);
  const faixa = max - min || 1;
  const n = vals.length;
  const x = (i) => pad + (n > 1 ? (i * (W - pad * 2)) / (n - 1) : (W - pad * 2) / 2);
  const y = (v) => 14 + ((max - v) / faixa) * (H - 34);
  const pts = (vs) => vs.map((v, i) => x(i).toFixed(1) + ' ' + y(v).toFixed(1));
  const p = pts(vals);
  const corte = Math.max(0, Math.min(n - 1, idxHoje));
  const zero = y(0).toFixed(1);
  const area =
    'M' +
    p.join(' L') +
    ' L' +
    x(n - 1).toFixed(1) +
    ' ' +
    zero +
    ' L' +
    x(0).toFixed(1) +
    ' ' +
    zero +
    ' Z';
  const cor = o.extra ? '#9fb3a4' : '#047857';
  let svg =
    '<svg class="pj-svg" viewBox="0 0 ' +
    W +
    ' ' +
    H +
    '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' +
    _projEsc(o.rotulo || 'Sobra acumulada mês a mês') +
    '">';
  if (!o.extra) svg += '<path d="' + area + '" fill="#047857" fill-opacity="0.08"></path>';
  svg +=
    '<line x1="' +
    pad / 2 +
    '" y1="' +
    zero +
    '" x2="' +
    (W - pad / 2) +
    '" y2="' +
    zero +
    '" stroke="#9fb3a4" stroke-width="1"></line>';
  if (idxHoje >= 0) {
    svg +=
      '<path d="M' +
      p.slice(0, corte + 1).join(' L') +
      '" fill="none" stroke="' +
      cor +
      '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>';
  }
  if (corte < n - 1) {
    svg +=
      '<path d="M' +
      p.slice(Math.max(0, idxHoje)).join(' L') +
      '" fill="none" stroke="' +
      cor +
      '" stroke-width="2.5" stroke-dasharray="5 4" stroke-linecap="round" stroke-linejoin="round"></path>';
  }
  if (o.extra) {
    svg +=
      '<path d="M' +
      pts(o.extra).join(' L') +
      '" fill="none" stroke="#d97706" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>';
  }
  if (idxHoje >= 0) {
    svg +=
      '<circle cx="' +
      x(idxHoje).toFixed(1) +
      '" cy="' +
      y(vals[idxHoje]).toFixed(1) +
      '" r="4.5" fill="#047857" stroke="#ffffff" stroke-width="2"></circle>';
  }
  (o.marcas || []).forEach((mk) => {
    const serie = mk.serie || vals;
    if (mk.i < 0 || mk.i >= n) return;
    svg +=
      '<circle cx="' +
      x(mk.i).toFixed(1) +
      '" cy="' +
      y(serie[mk.i]).toFixed(1) +
      '" r="4.5" fill="' +
      mk.cor +
      '" stroke="#ffffff" stroke-width="2"></circle>';
  });
  svg += '</svg>';
  return svg;
}

function _projRotulosEixo(d) {
  const n = d.meses.length;
  const passo = n > 24 ? 6 : n > 12 ? 3 : 1;
  return (
    '<div class="pj-eixo" style="grid-template-columns: repeat(' +
    n +
    ', minmax(0, 1fr))">' +
    d.meses
      .map(
        (m, i) =>
          '<span class="' +
          (i === d.idxHoje ? 'hoje' : '') +
          (i === d.resumo.primeiroNeg ? ' neg' : '') +
          '">' +
          // Acima de 12 meses o mesmo mês aparece mais de uma vez: vai o ano.
          (i % passo === 0 || i === d.idxHoje || i === n - 1
            ? PROJ_MESES[m.mes] + (n > 12 ? '/' + String(m.ano).slice(-2) : '')
            : '') +
          '</span>'
      )
      .join('') +
    '</div>'
  );
}

/** Prepara os números de uma vez (resumo, hoje, rótulos) para os blocos. */
function projPreparar(d) {
  const meses = d.meses || [];
  const idxHoje = (() => {
    const i = projIdxHoje(meses);
    if (i !== -1) return i;
    // Janela toda no passado: "hoje" é o último mês; toda no futuro: nenhum.
    const h = new Date();
    const ult = meses[meses.length - 1];
    if (ult && ult.ano * 12 + ult.mes < h.getFullYear() * 12 + h.getMonth())
      return meses.length - 1;
    return -1;
  })();
  const out = Object.assign({}, d, {
    meses,
    idxHoje,
    rotulos: d.rotulos || meses.map(projRotuloMes),
    resumo: projResumo(meses, idxHoje),
  });
  projUltimo = out;
  return out;
}

function projHtmlTopo(d) {
  const r = d.resumo;
  const ultimo = d.meses[r.finalIdx];
  const passado = d.idxHoje >= r.finalIdx;
  const rotFinal = ultimo ? PROJ_MESES[ultimo.mes] + '/' + String(ultimo.ano).slice(-2) : '';
  const marcas = [];
  if (r.primeiroNeg !== -1) marcas.push({ i: r.primeiroNeg, cor: '#b91c1c' });
  return (
    '<section class="pj-card pj-topo" aria-label="Resumo da projeção">' +
    '<div class="pj-topo-nums"><div class="pj-num-principal"><span class="pj-rot">' +
    (passado ? 'Sobra acumulada hoje' : 'Em ' + rotFinal + ' você deve ter') +
    '</span><span class="pj-grande valor-mascarado ' +
    (r.final < 0 ? 'neg' : 'pos') +
    '">' +
    _projFmt(r.final) +
    '</span><span class="pj-sub">' +
    (passado
      ? 'somando o que sobrou mês a mês'
      : 'guardados no caixa, se o que está lançado acontecer') +
    '</span></div>' +
    // Janela toda no passado: o "menor ponto" olha de hoje em diante e só
    // repetiria o número de cima, contradizendo os meses zerados ao lado.
    (passado
      ? ''
      : '<div class="pj-num"><span class="pj-rot">Menor ponto</span><span class="valor-mascarado ' +
        (r.menor < 0 ? 'neg' : '') +
        '">' +
        _projFmtCurto(r.menor) +
        ' em ' +
        _projEsc(d.rotulos[r.menorIdx] || '') +
        '</span></div>') +
    '<div class="pj-num"><span class="pj-rot">Sobra média por mês</span><span class="valor-mascarado ' +
    (r.mediaSobra < 0 ? 'neg' : '') +
    '">' +
    _projFmtCurto(r.mediaSobra) +
    '</span></div></div>' +
    '<div class="pj-graf">' +
    projSvgLinha(
      d.meses.map((m) => _projN(m.saldoAcumulado)),
      d.idxHoje,
      { w: d.web ? 760 : 342, h: d.web ? 220 : 150, marcas }
    ) +
    _projRotulosEixo(d) +
    '</div><div class="pj-legenda"><span><i class="pj-traco"></i>já aconteceu</span><span><i class="pj-traco tracejado"></i>previsto</span></div>' +
    '</section>'
  );
}

function projHtmlAlertas(d) {
  let html = '';
  const r = d.resumo;
  if (r.primeiroNeg !== -1) {
    const mot = projMotivoNegativo(d.meses, r.primeiroNeg, d.idxHoje);
    const nomeMes = PROJ_MESES_LONGOS[d.meses[r.primeiroNeg].mes];
    const Nome = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);
    const culp = mot.culpados.map((c) => c.desc);
    let porque = '';
    if (culp.length === 1) porque = _projEsc(culp[0]) + ' cai nesse mês. ';
    else if (culp.length > 1)
      porque = _projEsc(culp[0]) + ' e ' + _projEsc(culp[1]) + ' caem no mesmo mês. ';
    const guardar =
      mot.guardarPorMes > 0
        ? 'Guardar ' +
          _projFmtCurto(mot.guardarPorMes) +
          (mot.mesesAte > 1 ? ' por mês até lá resolve.' : ' antes dele resolve.')
        : 'Adie uma saída ou antecipe uma entrada para cobrir.';
    html +=
      '<section class="pj-alerta neg" role="status"><b>' +
      Nome +
      ' fica negativo: <span class="valor-mascarado">' +
      _projFmtCurto(d.meses[r.primeiroNeg].saldoAcumulado) +
      '</span></b><span>' +
      porque +
      guardar +
      '</span><button type="button" class="pj-link" onclick="projAbrirMes(' +
      r.primeiroNeg +
      ')">Ver ' +
      nomeMes +
      ' ›</button></section>';
  }
  const semRec = projSemReceita(d.meses, d.idxHoje);
  if (semRec !== -1) {
    html +=
      '<section class="pj-alerta aviso" role="status"><b>A partir de ' +
      _projEsc(d.rotulos[semRec]) +
      ' não há receita lançada</b><span>A previsão está contando só as saídas. Lance o salário como entrada fixa para a linha ficar real.</span>' +
      '<button type="button" class="pj-link" onclick="projLancarEntradaFixa()">Lançar entrada fixa ›</button></section>';
  }
  return html;
}

function projHtmlEntraSai(d) {
  const desde = Math.max(0, Math.min(d.idxHoje, d.meses.length - 6));
  const sel = d.meses.slice(desde, desde + 6);
  if (!sel.length) return '';
  const vals = sel.map(projEntraSai);
  const max = Math.max(1, ...vals.map((v) => Math.max(v.entra, v.sai)));
  return (
    '<section class="pj-card pj-es" aria-label="Entra e sai por mês"><div class="pj-card-cab"><b>Entra e sai</b><small>' +
    (d.idxHoje >= d.meses.length - 1 ? 'últimos ' : 'próximos ') +
    sel.length +
    ' meses</small></div><div class="pj-es-grade" style="grid-template-columns: repeat(' +
    sel.length +
    ', minmax(0, 1fr))">' +
    sel
      .map((m, k) => {
        const v = vals[k];
        const negativo = v.sai > v.entra + 0.005;
        return (
          '<button type="button" class="pj-es-col' +
          (negativo ? ' neg' : '') +
          '" onclick="projAbrirMes(' +
          (desde + k) +
          ')" aria-label="' +
          _projEsc(
            d.rotulos[desde + k] + ': entra ' + _projFmt(v.entra) + ', sai ' + _projFmt(v.sai)
          ) +
          '"><span class="pj-es-barras"><i class="e" style="height:' +
          Math.max(2, (v.entra / max) * 100).toFixed(1) +
          '%"></i><i class="s" style="height:' +
          Math.max(2, (v.sai / max) * 100).toFixed(1) +
          '%"></i></span><small>' +
          PROJ_MESES[m.mes] +
          '</small></button>'
        );
      })
      .join('') +
    '</div><div class="pj-legenda"><span><i class="pj-q e"></i>entra</span><span><i class="pj-q s"></i>sai</span></div></section>'
  );
}

function projHtmlOQueMuda(d) {
  const ev = projOQueMuda(d.meses, d.idxHoje);
  if (!ev.length) return '';
  return (
    '<section class="pj-card pj-muda" aria-label="O que muda"><div class="pj-card-cab"><b>O que muda</b></div>' +
    ev
      .map(
        (e) =>
          '<div class="pj-muda-l"><span class="pj-muda-mes">' +
          PROJ_MESES[e.mes] +
          '/' +
          String(e.ano).slice(-2) +
          '</span><span><b>' +
          _projEsc(e.titulo) +
          '</b><small>' +
          _projEsc(e.sub) +
          '</small></span><span class="pj-muda-v valor-mascarado ' +
          (e.valor < 0 ? 'neg' : 'pos') +
          '">' +
          (e.valor < 0 ? '' : '+') +
          _projFmtCurto(e.valor) +
          '</span></div>'
      )
      .join('') +
    '</section>'
  );
}

/** Quanto do que entra no mês já está comprometido com saídas (0–100+). */
function projComprometido(m) {
  const v = projEntraSai(m);
  if (v.entra < 0.005) return v.sai > 0.005 ? 101 : 0;
  return Math.round((v.sai / v.entra) * 100);
}

/** O mês aberto: entra / sai / do mês, as linhas do demonstrativo e as maiores saídas. */
function projHtmlMes(d, i) {
  const m = d.meses[i];
  if (!m) return '';
  const v = projEntraSai(m);
  const doMes = _projN(m.saldoAcumulado) - _projN(m.saldoCarregado);
  const saida = (x) => (_projN(x) > 0.005 ? '−' + _projFmt(_projN(x)) : _projFmt(0));
  const lin = (rot, valor, cls, extra) =>
    '<div class="pj-dem-l' +
    (extra || '') +
    '"><span>' +
    rot +
    '</span><span class="valor-mascarado ' +
    (cls || '') +
    '">' +
    valor +
    '</span></div>';
  const carregado = _projN(m.saldoCarregado);
  const lapis =
    i === d.indiceAtual
      ? ' <button type="button" class="pj-lapis" aria-label="Ajustar saldo do mês anterior" onclick="editarSaldoMesAnterior(' +
        m.mes +
        ',' +
        m.ano +
        ')"><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>'
      : '';
  const saidas = projSaidasDoMes(m.mes, m.ano).slice(0, 4);
  const nomeMes = PROJ_MESES_LONGOS[m.mes];
  return (
    '<div class="pj-mes">' +
    '<div class="pj-trio"><div><small>Entra</small><b class="valor-mascarado pos">' +
    _projFmtCurto(v.entra) +
    '</b></div><div><small>Sai</small><b class="valor-mascarado neg">' +
    _projFmtCurto(v.sai) +
    '</b></div><div><small>Do mês</small><b class="valor-mascarado ' +
    (doMes < 0 ? 'neg' : 'pos') +
    '">' +
    _projFmtCurto(doMes) +
    '</b></div></div>' +
    '<div class="pj-dem">' +
    lin('Receita total', _projFmt(_projN(m.receita)), 'pos') +
    lin('Resgates (venda de ativos)', _projFmt(_projN(m.resgate)), 'pos') +
    lin('Investimento (renda fixa)', saida(m.invFixo), 'azul') +
    lin('Investimento (renda variável)', saida(m.invVar), 'azul') +
    (_projN(m.invExterno) > 0.005
      ? lin('Aporte externo (fora do caixa)', _projFmt(_projN(m.invExterno)), '')
      : '') +
    lin('Sonhos (separado p/ metas)', saida(m.sonho), 'roxo') +
    lin('Despesas consumidas', saida(m.despesas), 'neg') +
    lin(
      '<span class="pj-herd">↳ Saldo do mês anterior</span>' + lapis,
      Math.abs(carregado) > 0.005 ? _projFmt(carregado) : '—',
      carregado < 0 ? 'neg' : 'roxo',
      ' herdado'
    ) +
    lin(
      'Resultado do mês',
      _projFmt(_projN(m.saldoAcumulado)),
      _projN(m.saldoAcumulado) < 0 ? 'neg' : 'pos',
      ' total'
    ) +
    '</div>' +
    (saidas.length
      ? '<div class="pj-saidas"><b>Maiores saídas de ' +
        nomeMes +
        '</b>' +
        saidas
          .map(
            (s) =>
              '<div class="pj-saida-l"><span>' +
              _projEsc(s.desc) +
              ' <small>· ' +
              _projEsc(s.tipo) +
              '</small></span><span class="valor-mascarado neg">−' +
              _projFmtCurto(s.valor).replace('R$ ', '') +
              '</span></div>'
          )
          .join('') +
        '</div>'
      : '') +
    '<div class="pj-mes-acoes"><button type="button" class="pj-btn1" onclick="projVerNoExtrato(' +
    i +
    ')">Ver no extrato</button><button type="button" class="pj-btn2" onclick="projSimAbrir(' +
    i +
    ')">Simular ajuste</button></div>' +
    '</div>'
  );
}

// ------------------------------------------------------------
// Ações
// ------------------------------------------------------------

/** Abre o mês i: no web seleciona a coluna; no celular abre na lista. */
function projAbrirMes(i) {
  const celular = typeof mobEhCelular === 'function' && mobEhCelular();
  if (celular && typeof mobDreIrPara === 'function') return mobDreIrPara(i);
  if (typeof ctrlDreSelecionar === 'function') ctrlDreSelecionar(i);
  const el = document.getElementById('pjMesDetalhe');
  if (el && typeof el.scrollIntoView === 'function') {
    try {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (_e) {}
  }
}

/** "Ver no extrato": leva o Controle para aquele mês e abre o extrato. */
function projVerNoExtrato(i) {
  const d = projUltimo;
  const m = d && d.meses[i];
  if (!m) return;
  if (typeof visaoMes !== 'undefined') {
    visaoMes = m.mes;
    visaoAno = m.ano;
  }
  if (typeof atualizarTelaControle === 'function') atualizarTelaControle();
  const celular = typeof mobEhCelular === 'function' && mobEhCelular();
  if (celular && typeof mobSegControle === 'function') mobSegControle('extrato');
  else {
    const alvo = document.querySelector('.ctl-linha-extrato');
    if (alvo && typeof alvo.scrollIntoView === 'function') {
      try {
        alvo.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } catch (_e) {}
    }
  }
}

/** "Lançar entrada fixa": abre o lançamento já em Entrada, marcado como fixo. */
function projLancarEntradaFixa() {
  if (typeof cadastrarEm !== 'function') return;
  cadastrarEm('controle', 'entrada');
  setTimeout(() => {
    const fixo = document.getElementById('transacaoFixa');
    if (fixo && !fixo.checked) {
      fixo.checked = true;
      fixo.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (typeof lancUiSincronizar === 'function') lancUiSincronizar();
  }, 260);
}

// ------------------------------------------------------------
// E se…? (simulador) — nada é gravado até "Lançar esta compra"
// ------------------------------------------------------------
var projSim = { tipo: 'compra', valor: 0, idx: 0, forma: '1' };

function projSimAbrir(i) {
  const d = projUltimo;
  if (!d || !d.meses.length) return;
  const base = Math.max(0, d.idxHoje);
  projSim.idx = typeof i === 'number' && i >= base ? i : Math.min(d.meses.length - 1, base + 1);
  const ov = document.getElementById('projSim');
  if (!ov) return;
  projSimDesenhar();
  ov.hidden = false;
  document.body.classList.add('pj-sim-aberto');
  const campo = document.getElementById('projSimValor');
  if (campo) setTimeout(() => campo.focus({ preventScroll: true }), 120);
}

function projSimFechar() {
  const ov = document.getElementById('projSim');
  if (ov) ov.hidden = true;
  document.body.classList.remove('pj-sim-aberto');
}

function projSimTipo(t) {
  projSim.tipo = t === 'entrada' ? 'entrada' : 'compra';
  projSim.forma = projSim.tipo === 'entrada' ? 'vez' : '1';
  projSimDesenhar();
}

function projSimCampo(campo, valor) {
  if (campo === 'valor')
    projSim.valor = typeof parseBRL === 'function' ? parseBRL(valor) || 0 : Number(valor) || 0;
  else if (campo === 'idx') projSim.idx = parseInt(valor, 10) || 0;
  else if (campo === 'forma') projSim.forma = String(valor);
  projSimResultado();
}

function projSimDesenhar() {
  const d = projUltimo;
  const ov = document.getElementById('projSim');
  if (!d || !ov) return;
  const base = Math.max(0, d.idxHoje);
  const compra = projSim.tipo === 'compra';
  const opMeses = d.meses
    .map((m, k) =>
      k < base
        ? ''
        : '<option value="' +
          k +
          '"' +
          (k === projSim.idx ? ' selected' : '') +
          '>' +
          _projEsc(d.rotulos[k]) +
          '</option>'
    )
    .join('');
  const formas = compra
    ? [
        ['1', 'À vista'],
        ['2', '2x no cartão'],
        ['3', '3x no cartão'],
        ['6', '6x no cartão'],
        ['10', '10x no cartão'],
        ['12', '12x no cartão'],
      ]
    : [
        ['vez', 'Uma vez'],
        ['mensal', 'Todo mês'],
      ];
  ov.innerHTML =
    '<button type="button" class="pj-sim-fundo" aria-label="Fechar" onclick="projSimFechar()"></button>' +
    '<div class="pj-sim" role="dialog" aria-modal="true" aria-labelledby="projSimTit">' +
    '<header class="pj-sim-cab"><div><h2 id="projSimTit">E se…?</h2><small>Teste antes de lançar. Nada é gravado.</small></div>' +
    '<button type="button" class="pj-sim-x" aria-label="Fechar" onclick="projSimFechar()"><i class="ph ph-x" aria-hidden="true"></i></button></header>' +
    '<div class="pj-seg" role="group" aria-label="Tipo"><button type="button" aria-pressed="' +
    compra +
    '" onclick="projSimTipo(\'compra\')">Uma compra</button><button type="button" aria-pressed="' +
    !compra +
    '" onclick="projSimTipo(\'entrada\')">Uma entrada</button></div>' +
    '<label class="pj-campo" for="projSimValor">Quanto<span class="pj-campo-caixa"><span>R$</span><input id="projSimValor" type="text" inputmode="decimal" placeholder="0,00" value="' +
    (projSim.valor > 0 && typeof formatarBRLInput === 'function'
      ? formatarBRLInput(projSim.valor)
      : '') +
    '" oninput="aplicarMascaraBRL(this);projSimCampo(\'valor\', this.value)"></span></label>' +
    '<div class="pj-campos2"><label class="pj-campo" for="projSimMes">Quando<select id="projSimMes" onchange="projSimCampo(\'idx\', this.value)">' +
    opMeses +
    '</select></label><label class="pj-campo" for="projSimForma">' +
    (compra ? 'Como paga' : 'Repete?') +
    '<select id="projSimForma" onchange="projSimCampo(\'forma\', this.value)">' +
    formas
      .map(
        (f) =>
          '<option value="' +
          f[0] +
          '"' +
          (f[0] === projSim.forma ? ' selected' : '') +
          '>' +
          f[1] +
          '</option>'
      )
      .join('') +
    '</select></label></div>' +
    '<div id="projSimRes" class="pj-sim-res"></div>' +
    '<div class="pj-sim-acoes"><button type="button" class="pj-btn1" id="projSimLancarBtn" onclick="projSimLancar()">' +
    (compra ? 'Lançar esta compra' : 'Lançar esta entrada') +
    '</button><button type="button" class="pj-btn2" onclick="projSimFechar()">Só estava testando</button></div>' +
    '</div>';
  projSimResultado();
}

function projSimResultado() {
  const d = projUltimo;
  const el = document.getElementById('projSimRes');
  if (!d || !el) return;
  const vals = d.meses.map((m) => _projN(m.saldoAcumulado));
  const btn = document.getElementById('projSimLancarBtn');
  if (btn) btn.disabled = !(projSim.valor > 0);
  if (!(projSim.valor > 0)) {
    el.innerHTML =
      '<div class="pj-card"><b>Como fica a sobra acumulada</b>' +
      projSvgLinha(vals, d.idxHoje, { w: 342, h: 150 }) +
      _projRotulosEixo(d) +
      '<p class="pj-sim-dica">Digite um valor para ver o efeito.</p></div>';
    return;
  }
  const r = projSimResposta(
    vals,
    projSim.idx,
    projSim.valor,
    projSim.forma,
    projSim.tipo,
    d.rotulos
  );
  const compra = projSim.tipo === 'compra';
  const ult = d.meses[d.meses.length - 1];
  const rotFim = PROJ_MESES[ult.mes] + '/' + String(ult.ano).slice(-2);
  let titulo;
  let texto;
  let cls;
  if (compra && r.neg !== -1) {
    cls = 'neg';
    titulo =
      (projSim.forma === '1' ? 'À vista, ' : 'Assim, ') +
      PROJ_MESES_LONGOS[d.meses[r.neg].mes] +
      ' fica negativo: ' +
      _projFmtCurto(r.nova[r.neg]);
    const alt = [];
    const par = r.alternativas.find((a) => a.tipo === 'parcelas');
    const esp = r.alternativas.find((a) => a.tipo === 'esperar');
    if (par) alt.push('Em ' + par.n + 'x no cartão nenhum mês fica negativo.');
    if (esp) alt.push('Ou espere até ' + esp.rotulo + ': aí cabe à vista.');
    texto = alt.join(' ') || 'Nenhum parcelamento até 12x resolve dentro deste horizonte.';
  } else {
    cls = 'ok';
    titulo = compra ? 'Cabe: nenhum mês fica negativo' : 'Com essa entrada';
    texto =
      'Em ' +
      rotFim +
      ' você terá ' +
      _projFmt(r.final) +
      ' (' +
      _projFmt(Math.abs(r.dif)) +
      (r.dif < 0 ? ' a menos' : ' a mais') +
      ').';
  }
  el.innerHTML =
    '<div class="pj-card"><b>Como fica a sobra acumulada</b>' +
    projSvgLinha(vals, d.idxHoje, {
      w: 342,
      h: 150,
      extra: r.nova,
      marcas: r.neg !== -1 ? [{ i: r.neg, cor: '#b91c1c', serie: r.nova }] : [],
    }) +
    _projRotulosEixo(d) +
    '<div class="pj-legenda"><span><i class="pj-traco cinza tracejado"></i>como está hoje</span><span><i class="pj-traco laranja"></i>' +
    (compra ? 'com a compra' : 'com a entrada') +
    '</span></div></div>' +
    '<section class="pj-alerta ' +
    (cls === 'neg' ? 'neg' : 'ok') +
    '" role="status"><b>' +
    titulo +
    '</b><span>' +
    texto +
    '</span></section>';
}

/** Leva a simulação para o formulário de lançamento (que só grava no Salvar). */
function projSimLancar() {
  const d = projUltimo;
  if (!d || !(projSim.valor > 0) || typeof cadastrarEm !== 'function') return;
  const m = d.meses[projSim.idx];
  const compra = projSim.tipo === 'compra';
  const parcelas = compra ? parseInt(projSim.forma, 10) || 1 : 1;
  const valor = projSim.valor;
  projSimFechar();
  cadastrarEm('controle', compra ? (parcelas > 1 ? 'cartao' : 'saida') : 'entrada');
  setTimeout(() => {
    const campo = document.getElementById('valorTransacao');
    if (campo && typeof setValorBRLInput === 'function') {
      setValorBRLInput(campo, valor);
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (parcelas > 1 && typeof lancUiEscolherParcelas === 'function')
      lancUiEscolherParcelas(parcelas);
    if (!compra && projSim.forma === 'mensal') {
      const fixo = document.getElementById('transacaoFixa');
      if (fixo && !fixo.checked) {
        fixo.checked = true;
        fixo.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    // Fora do cartão, o vencimento no mês escolhido põe o lançamento nele.
    if (m && parcelas === 1) {
      const venc = document.getElementById('dataVencimento');
      if (venc) {
        venc.value = m.ano + '-' + String(m.mes + 1).padStart(2, '0') + '-10';
        venc.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (typeof lancUiSincronizar === 'function') lancUiSincronizar();
  }, 280);
}

if (typeof document !== 'undefined' && document.addEventListener)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.body.classList.contains('pj-sim-aberto')) projSimFechar();
  });

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    projResumo: projResumo,
    projSemReceita: projSemReceita,
    projSimularSerie: projSimularSerie,
    projSimResposta: projSimResposta,
  };
}
