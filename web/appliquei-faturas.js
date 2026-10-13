// Faturas do cartão — uma tela por cartão, um ciclo por mês.
//
// O PROBLEMA QUE ISTO RESOLVE: a fatura "sumia" depois de paga. Não era o
// dado (pagar só marca os lançamentos como `pago`, nada é apagado): era a
// TELA. O único lugar que mostrava a fatura como fatura era o painel de
// Vencimentos, que por definição só lista o que falta pagar — paga a fatura,
// ela saía do único lugar onde existia, e o histórico virava itens soltos no
// extrato de outro mês.
//
// O MODELO NÃO MUDA. Fatura continua sendo o agrupamento (cartão + data de
// vencimento) dos lançamentos — ver faturaLancamentos em
// appliquei-aba-controle-financeiro.js. Gravar uma entidade "fatura" com
// total e status duplicaria o estado (total gravado × soma dos lançamentos) e
// brigaria com as regras que já valem: a baixa debita a conta pagadora
// (INV-17) e a competência do cartão é o mês do vencimento (INV-08). O status
// de cada ciclo é DERIVADO, aqui, toda vez:
//
//   paga      todos os lançamentos pagos
//   vencida   fechou, venceu e ainda tem coisa a pagar
//   fechada   fechou e ainda não venceu — "a pagar"
//   aberta    o ciclo que ainda acumula compras
//   futura    ciclos à frente (parcelas e fixos já lançados)
//   vazia     ciclo recente sem nenhum lançamento
//
// A tela (#telaFaturas) só desenha o que faturasDoCartao devolve.

/** 'aaaa-mm-dd' de uma Date local. */
function _fatYmd(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function _fatData(ymd) {
  const [a, m, d] = String(ymd).split('-').map(Number);
  return new Date(a, m - 1, d);
}

function _fatEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** O cartão pelo id, SEM o fallback de obterCartao (que devolve o primeiro
 *  cartão para um id desconhecido — ver INV-20). */
function _fatCartao(id) {
  return (typeof cartoes !== 'undefined' ? cartoes : []).find((c) => c.id === id) || null;
}

/**
 * Dia em que fecha a fatura que vence em `venc`. Espelha
 * cartaoCalcularVencimento: quando o dia do vencimento é <= o do fechamento,
 * o vencimento cai no mês SEGUINTE ao fechamento; senão, no mesmo mês. O dia
 * é limitado ao tamanho do mês (fechamento 31 em fevereiro).
 */
function faturaFechamentoDe(venc, diaFech, diaVenc) {
  const dVenc = parseInt(diaVenc, 10);
  let dFech = parseInt(diaFech, 10);
  if (!dVenc || dVenc < 1 || dVenc > 31) return null;
  if (!dFech || dFech < 1 || dFech > 31) dFech = dVenc;
  let ano = venc.getFullYear();
  let mes = venc.getMonth() - (dVenc <= dFech ? 1 : 0);
  if (mes < 0) {
    mes = 11;
    ano -= 1;
  }
  return new Date(ano, mes, Math.min(dFech, new Date(ano, mes + 1, 0).getDate()));
}

/**
 * Todos os ciclos de um cartão, do mais antigo ao mais novo. Puro/testável:
 * lê `transacoes` e `cartoes`, não toca na tela.
 *
 * Entram os ciclos que têm lançamento e, mesmo vazios, a fatura aberta e a
 * que acabou de fechar — "Fatura atual" precisa existir no primeiro dia do
 * ciclo, antes da primeira compra.
 */
function faturasDoCartao(cartaoId, hoje) {
  const agora = hoje instanceof Date ? hoje : new Date();
  const hojeYmd = _fatYmd(agora);
  const cartao = _fatCartao(cartaoId);
  const lista = typeof transacoes !== 'undefined' ? transacoes : [];

  const vencs = new Set();
  lista.forEach((t) => {
    if (t.categoria === 'cartao_credito' && t.cartaoId === cartaoId && t.dataVencimento) {
      vencs.add(t.dataVencimento);
    }
  });

  let ymdAberta = null;
  let ymdFechada = null;
  const cand =
    cartao && typeof cartaoFaturasCandidatas === 'function'
      ? cartaoFaturasCandidatas(agora, cartao.diaFechamento, cartao.diaVencimento)
      : null;
  if (cand) {
    ymdAberta = _fatYmd(cand.aberta.vencimento);
    ymdFechada = _fatYmd(cand.fechada.vencimento);
    vencs.add(ymdAberta);
    // A que acabou de fechar só entra vazia enquanto não venceu: depois disso
    // um ciclo sem compra nenhuma é ruído no histórico.
    if (ymdFechada >= hojeYmd) vencs.add(ymdFechada);
  }

  return Array.from(vencs)
    .sort()
    .map((ymd) => {
      const venc = _fatData(ymd);
      const itens = lista.filter(
        (t) =>
          t.categoria === 'cartao_credito' && t.cartaoId === cartaoId && t.dataVencimento === ymd
      );
      const total = itens.reduce((s, t) => s + (Number(t.valor) || 0), 0);
      const pagos = itens.filter((t) => t.pago);
      const aPagar = total - pagos.reduce((s, t) => s + (Number(t.valor) || 0), 0);
      const fechamento = cartao
        ? faturaFechamentoDe(venc, cartao.diaFechamento, cartao.diaVencimento)
        : null;
      const fechYmd = fechamento ? _fatYmd(fechamento) : null;
      // Mesma borda da regra de compra: comprar NO dia do fechamento ainda
      // entra nesta fatura, então ela só está fechada a partir do dia seguinte.
      const fechou = fechYmd ? hojeYmd > fechYmd : ymd < hojeYmd;

      let status;
      if (itens.length && pagos.length === itens.length) status = 'paga';
      else if (!itens.length) status = ymd === ymdAberta ? 'aberta' : fechou ? 'vazia' : 'futura';
      else if (fechou) status = ymd < hojeYmd ? 'vencida' : 'fechada';
      else status = ymd === ymdAberta || !ymdAberta ? 'aberta' : 'futura';

      const pagoEm = pagos
        .map((t) => t.pagoEm || '')
        .sort()
        .pop();
      return {
        cartaoId,
        vencimento: ymd,
        fechamento: fechYmd,
        status,
        atual: ymd === ymdAberta,
        itens,
        total,
        aPagar,
        qtdPagos: pagos.length,
        pagoEm: pagoEm || null,
      };
    });
}

/** O ciclo que a tela abre quando a pessoa não escolheu nenhum: a fatura
 *  mais antiga que ainda tem coisa a pagar e já fechou; senão a atual. */
function faturaIndicePadrao(ciclos) {
  const devendo = ciclos.findIndex((c) => c.status === 'vencida' || c.status === 'fechada');
  if (devendo !== -1) return devendo;
  const atual = ciclos.findIndex((c) => c.atual);
  return atual !== -1 ? atual : Math.max(0, ciclos.length - 1);
}

/**
 * Baixa (marca como paga) o que falta pagar numa fatura. Mesma regra da baixa
 * pelo painel de Vencimentos e pelo Telegram — marcarTransacaoPaga carimba
 * pagoEm e a conta pagadora do cartão (INV-17). Devolve quantos itens baixou.
 */
function faturaBaixar(cartaoId, ymdVenc) {
  let n = 0;
  transacoes.forEach((t) => {
    if (
      t.categoria === 'cartao_credito' &&
      t.cartaoId === cartaoId &&
      t.dataVencimento === ymdVenc &&
      !t.pago
    ) {
      marcarTransacaoPaga(t);
      n++;
    }
  });
  if (n) salvarTransacoes();
  return n;
}

/** Desfaz o pagamento da fatura inteira — volta tudo para "a pagar". */
function faturaDesfazer(cartaoId, ymdVenc) {
  let n = 0;
  transacoes.forEach((t) => {
    if (
      t.categoria === 'cartao_credito' &&
      t.cartaoId === cartaoId &&
      t.dataVencimento === ymdVenc &&
      controlePodeReverterPagamento(t)
    ) {
      t.pago = false;
      delete t.pagoEm;
      n++;
    }
  });
  if (n) salvarTransacoes({ flush: true });
  return n;
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

var FATURA_STATUS = {
  paga: { rotulo: 'Paga', classe: 'paga' },
  vencida: { rotulo: 'Vencida', classe: 'vencida' },
  fechada: { rotulo: 'Fechada · a pagar', classe: 'fechada' },
  aberta: { rotulo: 'Aberta', classe: 'aberta' },
  futura: { rotulo: 'Futura', classe: 'futura' },
  vazia: { rotulo: 'Sem lançamentos', classe: 'vazia' },
};
var FATURA_MES_CURTO = [
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

// Estado da tela: cartão e ciclo (pela data de vencimento, que é estável
// entre renders — o índice muda quando nasce um ciclo novo).
var faturasEstado = { cartaoId: null, vencimento: null };

/** Cartões que a tela oferece: os ativos e os arquivados que ainda têm
 *  fatura (a história de um cartão encerrado continua consultável). */
function faturasCartoesVisiveis() {
  const lista = typeof cartoes !== 'undefined' ? cartoes : [];
  const usados = new Set(
    (typeof transacoes !== 'undefined' ? transacoes : [])
      .filter((t) => t.categoria === 'cartao_credito')
      .map((t) => t.cartaoId)
  );
  return lista.filter((c) => !c.arquivado || usados.has(c.id));
}

/**
 * Abre a tela de Faturas. Sem argumentos: o primeiro cartão, no ciclo que
 * pede atenção. `vencimento` = 'atual' abre direto a fatura aberta.
 */
function abrirFaturas(cartaoId, vencimento) {
  const visiveis = faturasCartoesVisiveis();
  faturasEstado.cartaoId =
    (cartaoId && visiveis.some((c) => c.id === cartaoId) && cartaoId) ||
    (visiveis[0] && visiveis[0].id) ||
    null;
  faturasEstado.vencimento = vencimento || null;
  const modal = document.getElementById('telaFaturas');
  if (!modal) return;
  renderizarFaturas();
  modal.style.display = 'flex';
  document.body.classList.add('faturas-aberta');
}

function fecharFaturas() {
  const modal = document.getElementById('telaFaturas');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('faturas-aberta');
}

function faturasEscolherCartao(id) {
  faturasEstado.cartaoId = id;
  faturasEstado.vencimento = null;
  renderizarFaturas();
}

function faturasIrPara(ymd) {
  faturasEstado.vencimento = ymd;
  renderizarFaturas();
}

function faturasNavegar(delta) {
  const ciclos = faturasDoCartao(faturasEstado.cartaoId);
  let i = ciclos.findIndex((c) => c.vencimento === faturasEstado.vencimento);
  if (i === -1) i = faturaIndicePadrao(ciclos);
  const j = Math.max(0, Math.min(ciclos.length - 1, i + delta));
  if (ciclos[j]) faturasIrPara(ciclos[j].vencimento);
}

function faturasIrParaAtual() {
  faturasIrPara('atual');
}

function faturasPagar(cartaoId, ymd) {
  const ciclo = faturasDoCartao(cartaoId).find((c) => c.vencimento === ymd);
  if (!ciclo || ciclo.aPagar <= 0) return;
  const cartao = _fatCartao(cartaoId);
  const conta =
    cartao && cartao.contaPagadoraId && typeof obterConta === 'function'
      ? obterConta(cartao.contaPagadoraId)
      : null;
  const pendentes = ciclo.itens.length - ciclo.qtdPagos;
  const modal = document.getElementById('modalConfirmacao');
  if (!modal) return;
  document.getElementById('modalTitulo').innerHTML =
    '<i class="ph-bold ph-credit-card" style="color:var(--cor-cartao);"></i> Pagar fatura';
  document.getElementById('modalMensagem').innerHTML =
    'Marcar como paga a <strong>' +
    _fatEsc(faturaNome(_fatData(ymd))) +
    '</strong> do ' +
    _fatEsc(cartao ? cartao.nome : 'cartão') +
    ' — <strong>' +
    formatarMoeda(ciclo.aPagar) +
    '</strong> em ' +
    pendentes +
    (pendentes === 1 ? ' lançamento' : ' lançamentos') +
    '?' +
    (conta
      ? '<br><span style="font-size:12.5px;color:var(--cor-texto-mutado);">Sai de ' +
        _fatEsc(conta.nome) +
        ', a conta pagadora do cartão.</span>'
      : '');
  document.getElementById('modalAcoes').innerHTML =
    '<button class="btn-acao" style="background-color: var(--cor-primaria);" onclick="faturasConfirmarPagar(\'' +
    _fatEsc(cartaoId) +
    "','" +
    ymd +
    '\')"><i class="ph-bold ph-check"></i> Sim, está paga</button>';
  modal.style.display = 'flex';
}

function faturasConfirmarPagar(cartaoId, ymd) {
  const n = faturaBaixar(cartaoId, ymd);
  if (typeof fecharModal === 'function') fecharModal();
  if (n) mostrarToast('Fatura paga — ela continua aqui no histórico.', 'sucesso');
  if (typeof atualizarTelaControle === 'function') atualizarTelaControle();
  renderizarFaturas();
}

function faturasDesfazerPagamento(cartaoId, ymd) {
  const n = faturaDesfazer(cartaoId, ymd);
  if (n) mostrarToast('Pagamento desfeito — a fatura voltou para "a pagar".', 'sucesso');
  if (typeof atualizarTelaControle === 'function') atualizarTelaControle();
  renderizarFaturas();
}

/** "Setembro 2026" — o mês em que a fatura VENCE, como o banco a chama. */
function faturaTituloMes(d) {
  const nome = FATURA_MESES[d.getMonth()];
  return nome.charAt(0).toUpperCase() + nome.slice(1) + ' ' + d.getFullYear();
}

function _fatRotuloCurto(ymd) {
  const d = _fatData(ymd);
  return (
    FATURA_MES_CURTO[d.getMonth()] +
    (d.getFullYear() !== new Date().getFullYear() ? ' ' + String(d.getFullYear()).slice(2) : '')
  );
}

function _fatDdMm(ymd) {
  if (!ymd) return '';
  const [, m, d] = ymd.split('-');
  return d + '/' + m;
}

function _fatLinhaPrazo(c) {
  const venc = _fatDdMm(c.vencimento);
  const fech = c.fechamento ? _fatDdMm(c.fechamento) : null;
  if (c.status === 'paga') {
    const em = c.pagoEm ? new Date(c.pagoEm) : null;
    return (
      (em && !isNaN(em) ? 'Paga em ' + _fatDdMm(_fatYmd(em)) + ' · ' : 'Paga · ') + 'venceu ' + venc
    );
  }
  if (c.status === 'vencida') return 'Venceu ' + venc + (fech ? ' · fechou ' + fech : '');
  if (c.status === 'fechada') return 'Fechou ' + fech + ' · vence ' + venc;
  if (c.status === 'vazia') return 'Venceu ' + venc;
  return (fech ? 'Fecha ' + fech + ' · ' : '') + 'vence ' + venc;
}

function renderizarFaturas() {
  const corpo = document.getElementById('faturasCorpo');
  if (!corpo) return;
  const visiveis = faturasCartoesVisiveis();
  const btnAtual = document.getElementById('faturasBtnAtual');

  if (!visiveis.length) {
    if (btnAtual) btnAtual.style.display = 'none';
    corpo.innerHTML =
      '<div class="fat-vazio"><i class="ph ph-credit-card" aria-hidden="true"></i>' +
      '<strong>Nenhum cartão cadastrado</strong>' +
      '<span>Cadastre um cartão ao lançar uma compra no crédito; as faturas aparecem aqui.</span></div>';
    return;
  }
  if (btnAtual) btnAtual.style.display = '';

  const cartaoId = faturasEstado.cartaoId || visiveis[0].id;
  faturasEstado.cartaoId = cartaoId;
  const cartao = _fatCartao(cartaoId);
  const ciclos = faturasDoCartao(cartaoId);

  let i = -1;
  if (faturasEstado.vencimento === 'atual') i = ciclos.findIndex((c) => c.atual);
  else if (faturasEstado.vencimento)
    i = ciclos.findIndex((c) => c.vencimento === faturasEstado.vencimento);
  if (i === -1) i = faturaIndicePadrao(ciclos);
  const c = ciclos[i];
  faturasEstado.vencimento = c ? c.vencimento : null;

  let html = '';
  // Cartões: só aparece a escolha quando há escolha.
  if (visiveis.length > 1) {
    html += '<div class="fat-cartoes" role="tablist" aria-label="Cartão">';
    visiveis.forEach((cd) => {
      const on = cd.id === cartaoId;
      html +=
        '<button type="button" role="tab" aria-selected="' +
        on +
        '" class="fat-cartao' +
        (on ? ' on' : '') +
        '" onclick="faturasEscolherCartao(\'' +
        _fatEsc(cd.id) +
        '\')"><i class="ph ph-credit-card" aria-hidden="true"></i> ' +
        _fatEsc(cd.nome) +
        (cd.arquivado ? ' <small>(arquivado)</small>' : '') +
        '</button>';
    });
    html += '</div>';
  } else {
    html +=
      '<div class="fat-cartao-unico"><i class="ph ph-credit-card" aria-hidden="true"></i> ' +
      _fatEsc(cartao ? cartao.nome : 'Cartão') +
      '</div>';
  }

  if (!c) {
    corpo.innerHTML =
      html +
      '<div class="fat-vazio"><i class="ph ph-receipt" aria-hidden="true"></i>' +
      '<strong>Sem faturas ainda</strong><span>As compras lançadas neste cartão aparecem aqui, mês a mês.</span></div>';
    return;
  }

  // Histórico: uma pílula por ciclo, com o status em cor e em texto.
  html +=
    '<div class="fat-hist-rotulo">Histórico de faturas</div><div class="fat-meses" id="faturasMeses">';
  ciclos.forEach((ci, k) => {
    const st = FATURA_STATUS[ci.status];
    html +=
      '<button type="button" class="fat-mes st-' +
      st.classe +
      (k === i ? ' on' : '') +
      '" onclick="faturasIrPara(\'' +
      ci.vencimento +
      '\')" aria-label="' +
      _fatEsc(faturaNome(_fatData(ci.vencimento)) + ', ' + st.rotulo) +
      '"' +
      (k === i ? ' aria-current="true"' : '') +
      '><span class="fat-mes-nome">' +
      _fatRotuloCurto(ci.vencimento) +
      '</span><span class="fat-mes-st"><i aria-hidden="true"></i>' +
      st.rotulo.split(' · ')[0] +
      '</span></button>';
  });
  html += '</div>';

  const st = FATURA_STATUS[c.status];
  const d = _fatData(c.vencimento);
  html +=
    '<div class="fat-cartao-det">' +
    '<div class="fat-nav">' +
    '<button type="button" class="fat-seta" onclick="faturasNavegar(-1)" aria-label="Fatura anterior"' +
    (i === 0 ? ' disabled' : '') +
    '><i class="ph ph-caret-left" aria-hidden="true"></i></button>' +
    '<div class="fat-titulo"><strong>' +
    _fatEsc(faturaTituloMes(d)) +
    '</strong><span class="fat-chip st-' +
    st.classe +
    '">' +
    st.rotulo +
    '</span></div>' +
    '<button type="button" class="fat-seta" onclick="faturasNavegar(1)" aria-label="Próxima fatura"' +
    (i === ciclos.length - 1 ? ' disabled' : '') +
    '><i class="ph ph-caret-right" aria-hidden="true"></i></button>' +
    '</div>' +
    '<div class="fat-total"><span class="fat-total-valor valor-mascarado">' +
    formatarMoeda(c.total) +
    '</span><span class="fat-prazo">' +
    _fatLinhaPrazo(c) +
    '</span>' +
    (c.status !== 'paga' && c.qtdPagos > 0
      ? '<span class="fat-parcial">' +
        c.qtdPagos +
        ' de ' +
        c.itens.length +
        ' já pagos · falta ' +
        formatarMoeda(c.aPagar) +
        '</span>'
      : '') +
    '</div>';

  if (c.aPagar > 0 && (c.status === 'fechada' || c.status === 'vencida')) {
    html +=
      '<button type="button" class="btn-acao fat-pagar" onclick="faturasPagar(\'' +
      _fatEsc(cartaoId) +
      "','" +
      c.vencimento +
      '\')"><i class="ph-bold ph-check" aria-hidden="true"></i> Marcar como paga</button>';
  } else if (c.aPagar > 0 && c.status === 'aberta' && c.itens.length) {
    // Pagar antes de fechar é raro (e a fatura ainda pode crescer), mas é do
    // usuário: fica como ação secundária.
    html +=
      '<button type="button" class="btn-secundario fat-pagar" onclick="faturasPagar(\'' +
      _fatEsc(cartaoId) +
      "','" +
      c.vencimento +
      '\')">Pagar antecipado</button>';
  }
  if (c.status === 'paga') {
    html +=
      '<div class="fat-paga-nota"><i class="ph-bold ph-check" aria-hidden="true"></i>' +
      '<span>Paga — e continua aqui. O histórico das faturas não some depois do pagamento.</span>' +
      '<button type="button" class="fat-desfazer" onclick="faturasDesfazerPagamento(\'' +
      _fatEsc(cartaoId) +
      "','" +
      c.vencimento +
      '\')">Desfazer</button></div>';
  }

  html += '<div class="fat-itens-rotulo">Lançamentos da fatura</div>';
  if (!c.itens.length) {
    html += '<div class="fat-itens-vazio">Nenhuma compra nesta fatura ainda.</div>';
  } else {
    html += '<div class="fat-itens">';
    c.itens
      .slice()
      .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
      .forEach((t) => {
        const dt = t.data ? new Date(t.data) : null;
        const dia = dt && !isNaN(dt) ? _fatDdMm(_fatYmd(dt)) : '';
        const cat =
          t.categoriaDespesa && typeof rotuloCategoriaDespesa === 'function'
            ? rotuloCategoriaDespesa(t.categoriaDespesa)
            : t.cartaoFixoMensal
              ? 'Fixo mensal'
              : 'Cartão';
        html +=
          '<div class="fat-item' +
          (t.pago ? ' pago' : '') +
          '"><span class="fat-item-dia">' +
          dia +
          '</span><div class="fat-item-corpo"><span class="fat-item-desc">' +
          _fatEsc(t.descricao) +
          '</span><span class="fat-item-cat">' +
          _fatEsc(cat) +
          (t.pago ? ' · pago' : '') +
          '</span></div><span class="fat-item-valor valor-mascarado">' +
          formatarMoeda(t.valor) +
          '</span><button type="button" class="fat-item-editar" onclick="fecharFaturas(); prepararEdicao(\'' +
          _fatEsc(t.id) +
          '\')" aria-label="Editar ' +
          _fatEsc(t.descricao) +
          '"><i class="ph ph-pencil-simple" aria-hidden="true"></i></button></div>';
      });
    html += '</div>';
  }
  html += '</div>';

  corpo.innerHTML = html;
  // A pílula escolhida fica à vista mesmo com muitos meses de histórico.
  const on = corpo.querySelector('.fat-mes.on');
  if (on && typeof on.scrollIntoView === 'function') {
    try {
      on.scrollIntoView({ block: 'nearest', inline: 'center' });
    } catch (_e) {}
  }
}
