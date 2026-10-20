/**
 * Appliquei — imposto de renda sobre as vendas de renda variável (estimativa).
 *
 * Quem vende ação com lucro precisa saber, até o fim do mês seguinte, se deve
 * DARF e quanto. O app tinha as operações e o preço médio, mas não fazia a
 * conta — e esquecer o DARF gera multa e juros.
 *
 * AS REGRAS (pessoa física, operações comuns, 2026):
 *   - Ações: isento quando o total VENDIDO de ações no mês não passa de
 *     R$ 20 mil. Acima disso, 15% sobre o lucro.
 *   - ETF e BDR: 15%, sem a isenção dos R$ 20 mil.
 *   - FII: 20% sobre o lucro, sem isenção.
 *   - Prejuízo compensa lucro de meses seguintes do mesmo grupo: ações, ETF
 *     e BDR juntos; FII à parte. Prejuízo de mês isento também compensa.
 *   - IRRF de 0,005% sobre as vendas ("dedo-duro") é descontado do DARF.
 *   - DARF código 6015, vence no último dia útil do mês seguinte; abaixo de
 *     R$ 10 não se paga — o valor passa para o mês seguinte.
 *   - Cripto: isento quando as vendas do mês não passam de R$ 35 mil; acima,
 *     15% sobre o ganho (DARF código 4600). Sem compensação de prejuízo.
 *
 * O QUE FICA DE FORA (e o card diz): day trade, corretagem e emolumentos
 * (o app não guarda taxas) e feriados no vencimento.
 *
 * Classic script: `var` no top-level, funções viram globais.
 */

var IR_ISENCAO_ACOES = 20000;
var IR_ISENCAO_CRIPTO = 35000;
var IR_DARF_MINIMO = 10;
var IR_IRRF = 0.00005;

function _irGrupo(op) {
  var sub = op.subcategoria;
  if (!sub && typeof subcategoriaInferidaDoTicker === 'function')
    sub = subcategoriaInferidaDoTicker(op.ticker);
  return sub || 'acoes';
}

function _irYm(ts) {
  var d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/** Último dia útil do mês seguinte a `ym` (sábado e domingo; feriados não). */
function irVencimentoDarf(ym) {
  var p = ym.split('-').map(Number);
  var d = new Date(p[0], p[1] + 1, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/**
 * Apuração mês a mês. `ops` são as operações (historicoCompras). Devolve os
 * meses com venda, do mais antigo ao mais novo, e o prejuízo que sobrou.
 */
function irApurar(ops) {
  var rv = (ops || [])
    .filter(function (op) {
      return (
        op &&
        op.ticker &&
        op.data_op &&
        (!op.categoria || op.categoria === 'renda_variavel') &&
        isFinite(new Date(op.data_op).getTime())
      );
    })
    .slice()
    .sort(function (a, b) {
      var d = new Date(a.data_op).getTime() - new Date(b.data_op).getTime();
      // No mesmo instante, compra antes de venda: o preço médio já a inclui.
      if (d) return d;
      return (a.tipo === 'venda' ? 1 : 0) - (b.tipo === 'venda' ? 1 : 0);
    });

  var posicao = {}; // { TICKER: { qtd, custo } }
  var meses = {};
  rv.forEach(function (op) {
    var t = String(op.ticker).toUpperCase();
    var qtd = Number(op.quantidade) || 0;
    var preco = Number(op.preco_op || op.preco_pago) || 0;
    var p = posicao[t] || (posicao[t] = { qtd: 0, custo: 0 });
    if ((op.tipo || 'compra') !== 'venda') {
      p.qtd += qtd;
      p.custo += qtd * preco;
      return;
    }
    var pm = p.qtd > 0 ? p.custo / p.qtd : 0;
    var vendida = Math.min(qtd, Math.max(p.qtd, 0));
    var valor = qtd * preco;
    var lucro = valor - vendida * pm;
    p.qtd -= vendida;
    p.custo -= vendida * pm;
    if (p.qtd <= 1e-9) {
      p.qtd = 0;
      p.custo = 0;
    }
    var ym = _irYm(new Date(op.data_op).getTime());
    var m =
      meses[ym] ||
      (meses[ym] = {
        ym: ym,
        vendasAcoes: 0,
        lucroAcoes: 0,
        vendasOutros: 0,
        lucroOutros: 0,
        vendasFii: 0,
        lucroFii: 0,
        vendasCripto: 0,
        lucroCripto: 0,
        operacoes: [],
      });
    var g = _irGrupo(op);
    if (g === 'fiis') {
      m.vendasFii += valor;
      m.lucroFii += lucro;
    } else if (g === 'cripto') {
      m.vendasCripto += valor;
      m.lucroCripto += lucro;
    } else if (g === 'etfs' || g === 'bdrs') {
      m.vendasOutros += valor;
      m.lucroOutros += lucro;
    } else {
      m.vendasAcoes += valor;
      m.lucroAcoes += lucro;
    }
    m.operacoes.push({
      ticker: t,
      grupo: g,
      valor: valor,
      lucro: lucro,
      semPosicao: vendida < qtd,
    });
  });

  var prejComum = 0;
  var prejFii = 0;
  var aPagarAnterior = 0;
  var lista = Object.keys(meses)
    .sort()
    .map(function (ym) {
      var m = meses[ym];
      m.isentoAcoes = m.vendasAcoes <= IR_ISENCAO_ACOES;
      // Lucro isento sai da base; prejuízo entra (compensa depois).
      var baseComum = (m.isentoAcoes && m.lucroAcoes > 0 ? 0 : m.lucroAcoes) + m.lucroOutros;
      m.lucroIsento = m.isentoAcoes && m.lucroAcoes > 0 ? m.lucroAcoes : 0;
      m.compensadoComum = 0;
      if (baseComum > 0) {
        m.compensadoComum = Math.min(prejComum, baseComum);
        prejComum -= m.compensadoComum;
        baseComum -= m.compensadoComum;
      } else {
        prejComum += -baseComum;
        baseComum = 0;
      }
      var baseFii = m.lucroFii;
      m.compensadoFii = 0;
      if (baseFii > 0) {
        m.compensadoFii = Math.min(prejFii, baseFii);
        prejFii -= m.compensadoFii;
        baseFii -= m.compensadoFii;
      } else {
        prejFii += -baseFii;
        baseFii = 0;
      }
      m.impostoComum = baseComum * 0.15;
      m.impostoFii = baseFii * 0.2;
      var vendasComIrrf = m.vendasOutros + m.vendasFii + (m.isentoAcoes ? 0 : m.vendasAcoes);
      m.irrf = vendasComIrrf * IR_IRRF;
      var devido = Math.max(0, m.impostoComum + m.impostoFii - m.irrf) + aPagarAnterior;
      m.acumuladoAnterior = aPagarAnterior;
      if (devido > 0 && devido < IR_DARF_MINIMO) {
        m.darf = 0;
        m.passaParaProximo = devido;
        aPagarAnterior = devido;
      } else {
        m.darf = devido;
        m.passaParaProximo = 0;
        aPagarAnterior = 0;
      }
      m.vencimento = irVencimentoDarf(ym);
      // Cripto: isenção própria e sem compensação.
      m.isentoCripto = m.vendasCripto <= IR_ISENCAO_CRIPTO;
      m.darfCripto = !m.isentoCripto && m.lucroCripto > 0 ? m.lucroCripto * 0.15 : 0;
      m.prejuizoComum = prejComum;
      m.prejuizoFii = prejFii;
      return m;
    });
  return { meses: lista, prejuizoComum: prejComum, prejuizoFii: prejFii };
}

function _irMoeda(v) {
  return typeof formatarMoeda === 'function' ? formatarMoeda(v) : 'R$ ' + v.toFixed(2);
}

function _irData(ymd) {
  var p = ymd.split('-');
  return p[2] + '/' + p[1];
}

function _irMesNome(ym) {
  var nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var p = ym.split('-');
  return nomes[Number(p[1]) - 1] + '/' + p[0].slice(2);
}

/** Uma linha por mês com venda (os 12 mais recentes). */
function htmlImpostoRenda(apuracao) {
  if (!apuracao || !apuracao.meses.length) return '';
  var hoje = new Date();
  var hojeYmd =
    hoje.getFullYear() +
    '-' +
    String(hoje.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(hoje.getDate()).padStart(2, '0');
  var linhas = apuracao.meses
    .slice(-12)
    .reverse()
    .map(function (m) {
      var vendas = m.vendasAcoes + m.vendasOutros + m.vendasFii + m.vendasCripto;
      var lucro = m.lucroAcoes + m.lucroOutros + m.lucroFii + m.lucroCripto;
      var situacao;
      var classe = 'ir-ok';
      if (m.darf > 0) {
        var vencido = m.vencimento < hojeYmd;
        classe = vencido ? 'ir-passado' : 'ir-pagar';
        situacao =
          'DARF <b class="valor-mascarado">' +
          _irMoeda(m.darf) +
          '</b> · código 6015 · ' +
          (vencido ? 'venceu ' : 'vence ') +
          _irData(m.vencimento);
      } else if (m.passaParaProximo > 0) {
        situacao =
          'Imposto de <span class="valor-mascarado">' +
          _irMoeda(m.passaParaProximo) +
          '</span> abaixo de R$ 10: soma no próximo DARF';
      } else if (m.lucroIsento > 0 && m.impostoFii === 0 && m.impostoComum === 0) {
        situacao = 'Isento: vendas de ações abaixo de R$ 20 mil no mês';
      } else if (m.compensadoComum + m.compensadoFii > 0) {
        situacao = 'Sem imposto: lucro compensado com prejuízo anterior';
      } else if (lucro < 0) {
        situacao = 'Prejuízo: guarda para compensar lucros futuros';
      } else {
        situacao = 'Sem imposto a pagar';
      }
      var cripto =
        m.darfCripto > 0
          ? '<div class="ir-cripto">Cripto: DARF <b class="valor-mascarado">' +
            _irMoeda(m.darfCripto) +
            '</b> · código 4600 · vence ' +
            _irData(m.vencimento) +
            '</div>'
          : '';
      return (
        '<div class="ir-mes ' +
        classe +
        '"><div class="ir-mes-cab"><b>' +
        _irMesNome(m.ym) +
        '</b><span>Vendas <span class="valor-mascarado">' +
        _irMoeda(vendas) +
        '</span> · ' +
        (lucro >= 0 ? 'lucro ' : 'prejuízo ') +
        '<span class="valor-mascarado">' +
        _irMoeda(Math.abs(lucro)) +
        '</span></span></div><div class="ir-situacao">' +
        situacao +
        '</div>' +
        cripto +
        '</div>'
      );
    })
    .join('');
  var prej = [];
  if (apuracao.prejuizoComum > 0.005)
    prej.push(
      'ações/ETF/BDR <span class="valor-mascarado">' + _irMoeda(apuracao.prejuizoComum) + '</span>'
    );
  if (apuracao.prejuizoFii > 0.005)
    prej.push('FII <span class="valor-mascarado">' + _irMoeda(apuracao.prejuizoFii) + '</span>');
  return (
    '<div class="ir-card">' +
    '<div class="ir-cab"><span class="ir-rot"><i class="ph ph-receipt"></i> Imposto de renda das vendas</span></div>' +
    '<div class="ir-meses">' +
    linhas +
    '</div>' +
    (prej.length
      ? '<p class="ir-prejuizo">Prejuízo para compensar: ' + prej.join(' · ') + '</p>'
      : '') +
    '<p class="ir-nota">Estimativa pelo preço médio das suas operações. Não inclui day trade, corretagem e taxas, nem feriados no vencimento. Confira com o informe da corretora antes de pagar o DARF.</p>' +
    '</div>'
  );
}

/** Desenha o card na sub-aba Operações. */
function renderizarImpostoRenda() {
  var el = document.getElementById('cardImpostoRenda');
  if (!el) return;
  var html = '';
  try {
    html = htmlImpostoRenda(
      irApurar(typeof historicoCompras !== 'undefined' ? historicoCompras : [])
    );
  } catch (e) {
    console.warn('[ir] falha na apuração:', e && e.message);
  }
  el.innerHTML = html;
  el.style.display = html ? '' : 'none';
}
