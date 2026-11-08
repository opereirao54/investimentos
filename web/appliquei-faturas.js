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
      desfazerBaixaTransacao(t)
    ) {
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
// itemAberto: o lançamento da lista com as ações (Editar / Excluir) à vista.
var faturasEstado = { cartaoId: null, vencimento: null, itemAberto: null };

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

/**
 * Tocar num lançamento da fatura mostra Editar e Excluir logo abaixo dele.
 * Relato: um amigo do fundador quis excluir uma compra pela fatura e não
 * achou como — o lápis levava ao formulário, que não tinha "Excluir".
 */
function faturasAbrirItem(id) {
  faturasEstado.itemAberto = faturasEstado.itemAberto === id ? null : id;
  renderizarFaturas();
}

function faturasEditarItem(id) {
  faturasEstado.itemAberto = null;
  fecharFaturas();
  if (typeof prepararEdicao === 'function') prepararEdicao(id);
}

/** A confirmação é a do extrato (deletarTransacao): parcela e fixo perguntam
 *  "só este mês" ou "este e os futuros". A janela abre por cima da fatura. */
function faturasExcluirItem(id) {
  if (typeof deletarTransacao === 'function') deletarTransacao(id);
}

/** Depois de excluir/editar algo noutro lugar: a fatura aberta se atualiza. */
function faturasAtualizarSeAberta() {
  const modal = document.getElementById('telaFaturas');
  if (!modal || modal.style.display === 'none' || !modal.style.display) return;
  renderizarFaturas();
}

function fecharFaturas() {
  const modal = document.getElementById('telaFaturas');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('faturas-aberta');
}

function faturasEscolherCartao(id) {
  faturasEstado.itemAberto = null;
  faturasEstado.cartaoId = id;
  faturasEstado.vencimento = null;
  renderizarFaturas();
}

function faturasIrPara(ymd) {
  faturasEstado.itemAberto = null;
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

/** Sem cartão: leva ao formulário de lançamento, já em "novo cartão". */
function faturasCadastrarCartao() {
  fecharFaturas();
  if (typeof abrirPainelLancamento === 'function') abrirPainelLancamento();
  const cat = document.getElementById('categoriaTransacao');
  if (cat) {
    cat.value = 'cartao_credito';
    if (typeof verificarRegraCartao === 'function') verificarRegraCartao();
  }
  const sel = document.getElementById('selectCartao');
  if (sel) {
    sel.value = '__novo__';
    if (typeof onChangeSelectCartao === 'function') onChangeSelectCartao();
  }
}

/** Atalho "Cartões" do topo: a lista de cartões fica nas Configurações. */
function faturasAbrirCartoes() {
  fecharFaturas();
  if (typeof abrirModalConfig === 'function') abrirModalConfig('cartoes');
}

/** Lista lateral (web): leva direto a um ciclo de qualquer cartão. */
function faturasAbrir(cartaoId, ymd) {
  faturasEstado.itemAberto = null;
  faturasEstado.cartaoId = cartaoId;
  faturasEstado.vencimento = ymd || null;
  renderizarFaturas();
}

/** "TV (2/5)" → { base: 'TV', n: 2, m: 5 }. A parcela mora na descrição, no
 *  mesmo formato que o lançamento parcelado e a importação da fatura gravam. */
function faturaParcelaDe(t) {
  const desc = String((t && t.descricao) || '');
  const m = desc.match(/\s*\((\d+)\/(\d+)\)\s*$/);
  if (!m) return { base: desc, n: 0, m: 0 };
  return { base: desc.slice(0, m.index), n: +m[1], m: +m[2] };
}

/** Limite do cartão: usado = tudo o que ainda não foi pago neste cartão,
 *  inclusive as parcelas das próximas faturas (é o que o banco desconta do
 *  disponível). Sem limite cadastrado devolve null. */
function faturaUsoDoLimite(cartao, ciclos) {
  const limite = cartao ? Number(cartao.limite) || 0 : 0;
  if (limite <= 0) return null;
  const usado = ciclos.reduce((s, c) => s + Math.max(0, c.aPagar), 0);
  return {
    limite,
    usado,
    disponivel: limite - usado,
    pct: Math.round((usado / limite) * 100),
  };
}

/** O que já está lançado nas faturas depois desta (parcelas e fixos). */
function faturaComprometidoDepois(ciclos, ymd) {
  return ciclos.filter((c) => c.vencimento > ymd && c.status !== 'paga' && c.total > 0).slice(0, 6);
}

/** Texto do selo de status, com a data que importa para cada um. */
function _fatSelo(c) {
  const venc = _fatDdMm(c.vencimento);
  const fech = c.fechamento ? _fatDdMm(c.fechamento) : '';
  if (c.status === 'paga') {
    const em = c.pagoEm ? new Date(c.pagoEm) : null;
    return em && !isNaN(em) ? 'Paga em ' + _fatDdMm(_fatYmd(em)) : 'Paga';
  }
  if (c.status === 'vencida') return 'Vencida · venceu ' + venc;
  if (c.status === 'fechada') return 'Fechada · a pagar';
  if (c.status === 'vazia') return 'Sem lançamentos';
  if (c.status === 'futura') return 'Futura' + (fech ? ' · fecha ' + fech : '');
  return 'Aberta' + (fech ? ' · fecha ' + fech : '');
}

/** "4.690" — a lista lateral não tem espaço para "R$" e centavos. */
function _fatValorCurto(v) {
  return Math.round(Number(v) || 0).toLocaleString('pt-BR');
}

/** "Vence em 05/12 · paga pelo Itaú" — de onde o dinheiro sai. */
function _fatLinhaVence(c, cartao) {
  const venc = _fatDdMm(c.vencimento);
  let txt;
  if (c.status === 'paga' || c.status === 'vencida' || c.status === 'vazia')
    txt = 'Venceu em ' + venc;
  else txt = 'Vence em ' + venc;
  const conta =
    cartao && cartao.contaPagadoraId && typeof obterConta === 'function'
      ? obterConta(cartao.contaPagadoraId)
      : null;
  if (conta) return txt + ' · paga pelo ' + _fatEsc(conta.nome);
  return (
    txt +
    ' · <button type="button" class="fat-link-conta" onclick="faturasAbrirCartoes()">falta a conta que paga</button>'
  );
}

/** A lista lateral da versão web: cada cartão com as faturas que importam
 *  agora (a aberta, as que faltam pagar, as próximas e as últimas pagas). */
function _fatNavHtml(visiveis, cartaoIdAtual, ymdAtual) {
  let html = '<nav class="fat-lado" aria-label="Cartões e faturas">';
  visiveis.forEach((cd) => {
    const ciclos = faturasDoCartao(cd.id);
    html +=
      '<span class="fat-lado-cartao">' +
      _fatEsc(cd.nome) +
      (cd.arquivado ? ' <small>(arquivado)</small>' : '') +
      '</span>';
    if (!cd.contaPagadoraId) {
      html +=
        '<button type="button" class="fat-lado-item alerta" onclick="faturasAbrirCartoes()"><span>Falta a conta que paga</span><i class="ph ph-caret-right" aria-hidden="true"></i></button>';
    }
    const pendentes = ciclos.filter(
      (c) => c.status === 'vencida' || c.status === 'fechada' || c.atual
    );
    const proximas = ciclos.filter((c) => c.status === 'futura' && c.total > 0).slice(0, 2);
    const pagas = ciclos
      .filter((c) => c.status === 'paga')
      .slice(-3)
      .reverse();
    let lista = pendentes.concat(proximas, pagas);
    // A fatura aberta na tela sempre aparece na lista, mesmo antiga.
    if (cd.id === cartaoIdAtual && ymdAtual && !lista.some((c) => c.vencimento === ymdAtual)) {
      const sel = ciclos.find((c) => c.vencimento === ymdAtual);
      if (sel) lista = lista.concat([sel]);
    }
    if (!lista.length) {
      html += '<span class="fat-lado-vazio">Sem faturas ainda</span>';
    }
    lista.forEach((c) => {
      const on = cd.id === cartaoIdAtual && c.vencimento === ymdAtual;
      const st = FATURA_STATUS[c.status];
      html +=
        '<button type="button" class="fat-lado-item st-' +
        st.classe +
        (on ? ' on' : '') +
        '"' +
        (on ? ' aria-current="true"' : '') +
        ' onclick="faturasAbrir(\'' +
        _fatEsc(cd.id) +
        "','" +
        c.vencimento +
        '\')"><span><i aria-hidden="true"></i>' +
        _fatEsc(faturaTituloMes(_fatData(c.vencimento)).split(' ')[0]) +
        ' · ' +
        st.rotulo.split(' · ')[0].toLowerCase() +
        '</span><span class="fat-lado-valor valor-mascarado">' +
        _fatValorCurto(c.total) +
        '</span></button>';
    });
  });
  html += '</nav>';
  return html;
}

function renderizarFaturas() {
  const corpo = document.getElementById('faturasCorpo');
  if (!corpo) return;
  const visiveis = faturasCartoesVisiveis();

  if (!visiveis.length) {
    corpo.innerHTML =
      '<div class="fat-principal"><div class="fat-vazio"><i class="ph ph-credit-card" aria-hidden="true"></i>' +
      '<strong>Nenhum cartão cadastrado</strong>' +
      '<span>Cadastre o cartão para ver as faturas e importar a do banco.</span>' +
      '<button type="button" class="btn-acao fat-cadastrar" onclick="faturasCadastrarCartao()"><i class="ph ph-plus" aria-hidden="true"></i> Cadastrar um cartão</button></div></div>';
    return;
  }

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

  let html = _fatNavHtml(visiveis, cartaoId, faturasEstado.vencimento);
  html += '<div class="fat-principal">';

  // Celular: escolha do cartão em chips (na web, a lista lateral faz isso).
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
        '\')">' +
        _fatEsc(cd.nome) +
        (cd.arquivado ? ' <small>(arquivado)</small>' : '') +
        '</button>';
    });
    html += '</div>';
  }

  const podeImportar = typeof abrirImportarFatura === 'function';
  const btnImportar = podeImportar
    ? '<button type="button" class="btn-secundario fat-importar" onclick="abrirImportarFatura(\'' +
      _fatEsc(cartaoId) +
      '\')"><i class="ph ph-upload-simple" aria-hidden="true"></i> Importar fatura</button>'
    : '';

  if (!c) {
    corpo.innerHTML =
      html +
      '<div class="fat-vazio"><i class="ph ph-receipt" aria-hidden="true"></i>' +
      '<strong>Sem faturas ainda</strong><span>As compras lançadas neste cartão aparecem aqui, mês a mês.</span>' +
      btnImportar +
      '</div></div>';
    return;
  }

  const st = FATURA_STATUS[c.status];
  const nomeCartao = cartao ? cartao.nome : 'Cartão';
  const uso = faturaUsoDoLimite(cartao, ciclos);

  // Resumo: no celular, o cartão escuro com ‹ ›; na web, o cabeçalho da fatura.
  html +=
    '<section class="fat-heroi st-' +
    st.classe +
    '" aria-label="' +
    _fatEsc(faturaNome(_fatData(c.vencimento))) +
    '">' +
    '<div class="fat-nav">' +
    '<button type="button" class="fat-seta" onclick="faturasNavegar(-1)" aria-label="Fatura anterior"' +
    (i === 0 ? ' disabled' : '') +
    '><i class="ph ph-caret-left" aria-hidden="true"></i></button>' +
    '<strong class="fat-nav-tit">' +
    _fatEsc(faturaNome(_fatData(c.vencimento))) +
    (_fatData(c.vencimento).getFullYear() !== new Date().getFullYear()
      ? ' ' + _fatData(c.vencimento).getFullYear()
      : '') +
    '</strong>' +
    '<button type="button" class="fat-seta" onclick="faturasNavegar(1)" aria-label="Próxima fatura"' +
    (i === ciclos.length - 1 ? ' disabled' : '') +
    '><i class="ph ph-caret-right" aria-hidden="true"></i></button>' +
    '</div>' +
    '<div class="fat-heroi-selos"><span class="fat-chip st-' +
    st.classe +
    '">' +
    _fatSelo(c) +
    '</span>' +
    (!c.atual
      ? '<button type="button" class="fat-ir-atual" onclick="faturasIrParaAtual()">Ir para a atual</button>'
      : '') +
    '</div>' +
    '<h3 class="fat-heroi-tit">' +
    _fatEsc(nomeCartao) +
    ' · ' +
    _fatEsc(faturaNome(_fatData(c.vencimento)).toLowerCase()) +
    '</h3>' +
    '<div class="fat-total-valor valor-mascarado">' +
    formatarMoeda(c.total) +
    '</div>' +
    '<span class="fat-prazo">' +
    _fatLinhaVence(c, cartao) +
    '</span>' +
    (c.status !== 'paga' && c.qtdPagos > 0
      ? '<span class="fat-parcial">' +
        c.qtdPagos +
        ' de ' +
        c.itens.length +
        ' já pagos · falta <span class="valor-mascarado">' +
        formatarMoeda(c.aPagar) +
        '</span></span>'
      : '');
  if (uso) {
    const pct = Math.max(0, Math.min(100, uso.pct));
    html +=
      '<div class="fat-limite' +
      (uso.pct >= 90 ? ' alto' : '') +
      '" role="img" aria-label="' +
      uso.pct +
      '% do limite em uso"><i style="width:' +
      pct +
      '%"></i></div>' +
      '<span class="fat-limite-txt">' +
      uso.pct +
      '% do limite de <span class="valor-mascarado">' +
      formatarMoeda(uso.limite) +
      '</span> em uso · ' +
      (uso.disponivel >= 0
        ? 'disponível <span class="valor-mascarado">' + formatarMoeda(uso.disponivel)
        : 'acima do limite em <span class="valor-mascarado">' + formatarMoeda(-uso.disponivel)) +
      '</span></span>';
  }
  html += '</section>';

  // Ações: pagar (principal quando a fatura fechou) e importar do banco.
  let btnPagar = '';
  if (c.aPagar > 0 && (c.status === 'fechada' || c.status === 'vencida')) {
    btnPagar =
      '<button type="button" class="btn-acao fat-pagar" onclick="faturasPagar(\'' +
      _fatEsc(cartaoId) +
      "','" +
      c.vencimento +
      '\')"><i class="ph-bold ph-check" aria-hidden="true"></i> Pagar fatura</button>';
  } else if (c.aPagar > 0 && c.status === 'aberta' && c.itens.length) {
    // Pagar antes de fechar é raro (e a fatura ainda pode crescer), mas é do
    // usuário: fica como ação secundária.
    btnPagar =
      '<button type="button" class="btn-secundario fat-pagar" onclick="faturasPagar(\'' +
      _fatEsc(cartaoId) +
      "','" +
      c.vencimento +
      '\')">Pagar antecipado</button>';
  }
  if (btnPagar || btnImportar) {
    html += '<div class="fat-acoes">' + btnPagar + btnImportar + '</div>';
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

  // Fatura que veio de um arquivo do banco: o Desfazer continua aqui enquanto
  // nada daquela importação foi pago (appliquei-importar-fatura-ui.js).
  if (typeof impfatHtmlLinhaImportada === 'function') {
    html += impfatHtmlLinhaImportada(cartaoId, c.vencimento);
  }

  html += '<section class="fat-compras" aria-label="Compras desta fatura">';
  if (!c.itens.length) {
    html += '<div class="fat-itens-vazio">Nenhuma compra nesta fatura ainda.</div>';
  } else {
    html +=
      '<div class="fat-itens-cab" aria-hidden="true"><span>Compra</span><span>Categoria</span><span>Parcela</span><span>Valor</span><span></span></div>';
    html += '<div class="fat-itens">';
    // Compra importada da fatura do banco traz a data da COMPRA (dataCompra);
    // a lançada no app só tem `data`, o momento do cadastro.
    // Parcela antiga importada não tem data de compra (o banco manda a do início
    // do ciclo): fica sem dia, em vez de mostrar o dia da importação.
    const quando = (t) => {
      if (t.dataCompra && /^\d{4}-\d{2}-\d{2}$/.test(t.dataCompra)) return t.dataCompra;
      if (t.importacao) return '';
      const dt = t.data ? new Date(t.data) : null;
      return dt && !isNaN(dt) ? _fatYmd(dt) : '';
    };
    c.itens
      .slice()
      .sort((a, b) => quando(b).localeCompare(quando(a)))
      .forEach((t) => {
        const ymd = quando(t);
        const dia = ymd
          ? _fatData(ymd).getDate() + ' ' + FATURA_MES_CURTO[_fatData(ymd).getMonth()]
          : '';
        const cat =
          t.categoriaDespesa && typeof rotuloCategoriaDespesa === 'function'
            ? rotuloCategoriaDespesa(t.categoriaDespesa)
            : t.cartaoFixoMensal
              ? 'Fixo mensal'
              : 'Cartão';
        const p = faturaParcelaDe(t);
        const parcela = p.m ? p.n + ' de ' + p.m : t.cartaoFixoMensal ? 'todo mês' : 'à vista';
        const quandoTxt = p.m ? 'parcela ' + parcela : t.cartaoFixoMensal ? 'todo mês' : dia;
        const aberto = faturasEstado.itemAberto === t.id;
        html +=
          '<div class="fat-item-bloco' +
          (aberto ? ' aberto' : '') +
          '"><button type="button" class="fat-item' +
          (t.pago ? ' pago' : '') +
          '" aria-expanded="' +
          (aberto ? 'true' : 'false') +
          '" onclick="faturasAbrirItem(this.dataset.id)" data-id="' +
          _fatEsc(t.id) +
          '"><span class="fat-item-corpo"><span class="fat-item-desc">' +
          _fatEsc(p.base || t.descricao) +
          '</span><span class="fat-item-cat">' +
          _fatEsc(cat) +
          (quandoTxt ? ' · ' + _fatEsc(quandoTxt) : '') +
          (t.pago ? ' · pago' : '') +
          '</span><span class="fat-item-dia">' +
          _fatEsc(dia) +
          (t.pago ? (dia ? ' · ' : '') + 'pago' : '') +
          '</span></span><span class="fat-col-cat">' +
          _fatEsc(cat) +
          '</span><span class="fat-col-parc">' +
          _fatEsc(parcela) +
          '</span><span class="fat-item-valor valor-mascarado">' +
          formatarMoeda(t.valor) +
          '</span><i class="ph ph-dots-three-vertical fat-item-mais" aria-hidden="true"></i></button>' +
          (aberto
            ? '<div class="fat-item-acoes"><button type="button" class="btn-secundario" data-id="' +
              _fatEsc(t.id) +
              '" onclick="faturasEditarItem(this.dataset.id)"><i class="ph ph-pencil-simple" aria-hidden="true"></i> Editar</button>' +
              '<button type="button" class="btn-secundario fat-item-excluir" data-id="' +
              _fatEsc(t.id) +
              '" onclick="faturasExcluirItem(this.dataset.id)"><i class="ph ph-trash" aria-hidden="true"></i> Excluir</button></div>'
            : '') +
          '</div>';
      });
    html += '</div>';
  }
  html += '</section>';

  // Já comprometido: o que as parcelas e os fixos já ocupam nas próximas.
  const depois = faturaComprometidoDepois(ciclos, c.vencimento);
  if (depois.length) {
    const max = Math.max.apply(
      null,
      depois.map((x) => x.total)
    );
    html +=
      '<section class="fat-futuro" aria-label="Parcelas já assumidas"><strong>Já comprometido nas próximas faturas</strong>';
    depois.forEach((x) => {
      html +=
        '<button type="button" class="fat-futuro-linha" onclick="faturasIrPara(\'' +
        x.vencimento +
        '\')" aria-label="' +
        _fatEsc(faturaNome(_fatData(x.vencimento)) + ': ' + formatarMoeda(x.total)) +
        '"><span>' +
        _fatRotuloCurto(x.vencimento) +
        '</span><span class="fat-futuro-barra"><i style="width:' +
        Math.max(4, Math.round((x.total / max) * 100)) +
        '%"></i></span><span class="fat-futuro-valor valor-mascarado">' +
        formatarMoeda(x.total) +
        '</span></button>';
    });
    const parcelados = [];
    depois.forEach((x) =>
      x.itens.forEach((t) => {
        const b = faturaParcelaDe(t);
        if (b.m && parcelados.indexOf(b.base) === -1) parcelados.push(b.base);
      })
    );
    html +=
      '<span class="fat-futuro-nota">' +
      (parcelados.length
        ? _fatEsc(
            parcelados.slice(0, 2).join(' e ') +
              (parcelados.length > 2 ? ' e mais ' + (parcelados.length - 2) : '')
          ) + (parcelados.length === 1 ? ' parcelada. ' : ' parceladas. ')
        : '') +
      'Já entra na projeção dos próximos meses.</span></section>';
  }

  html += '</div>';
  corpo.innerHTML = html;
  const on = corpo.querySelector('.fat-lado-item.on');
  if (on && typeof on.scrollIntoView === 'function') {
    try {
      on.scrollIntoView({ block: 'nearest' });
    } catch (_e) {}
  }
}
