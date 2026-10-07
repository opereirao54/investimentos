/**
 * Appliquei — APPLICASH $ (programa de indicações).
 *
 * A tela tem DOIS públicos com necessidades opostas, e é isso que decide o
 * layout:
 *
 *   sem indicações  → só quer entender o programa e mandar o link. Recebe o
 *                     link, um CTA e o "como funciona". Nada de KPI zerado.
 *   com indicações  → quer saber quanto está entrando e se abateu na fatura.
 *                     Recebe o valor da próxima cobrança em destaque, o funil
 *                     e a lista.
 *
 * A composição troca por `data-fase` na <section> (carregando · deslogado ·
 * vazio · ativo); o CSS mostra/esconde os blocos. Antes existia uma
 * composição só, com widgets zerados por cima de um empty state improvisado.
 *
 * FONTE DE VERDADE: todo número vem do `me` do servidor. A tela não recalcula
 * cashback por conta própria — quando recalculava (`valorPago × 10%` no
 * cliente) havia dois saldos na mesma página, com significados diferentes e
 * linguagem parecida.
 *
 * Deps: AppliqueiBilling.syncApplicash() (módulo ES deferred) e os utilitários
 * globais formatarMoeda/mostrarToast.
 */

// ============================================================
// === APPLICASH $ — programa de indicações                   ===
// ============================================================
var APPLICASH_CONFIG = {
  cupomKey: 'appliquei_cupom_codigo',
  comissaoPct: 0.1, // 10% do valor pago pelo indicado
  descontoCupomPct: 0.1, // 10% de desconto p/ o indicado
};

// Marcos do programa. O `descontoPct` é DERIVADO do motor, não prometido:
// cada indicado ativo gera 10% de R$ 13,50 = R$ 1,35/mês de abatimento, e o
// piso do gateway (R$ 5,00) impede a fatura chegar a zero. Ver o teto fixado
// em test/pagamentos-applicash.test.js — a tela não pode prometer mais do que
// `api/_lib/credits.js` consegue entregar.
var APPLICASH_PRECO_CENTS = 1500;
var APPLICASH_PISO_CENTS = 500;
var APPLICASH_CASHBACK_CENTS = 135;

var APPLICASH_METAS = [
  { qtd: 1, recompensa: 'Cashback ligado — abatimento todo mês' },
  { qtd: 5, recompensa: 'Quase metade da mensalidade paga por amigos' },
  { qtd: 8, recompensa: 'A um passo do mínimo da sua fatura' },
  { qtd: 12, recompensa: '🏆 Fatura no mínimo — e o excedente acumula' },
  { qtd: 30, recompensa: '🌟 Status Embaixador · brindes + destaque na comunidade' },
];

/** Quanto a fatura cai com N indicados ativos, respeitando o piso do gateway. */
function apcAbatimentoCents(indicados) {
  var bruto = Math.max(0, indicados) * APPLICASH_CASHBACK_CENTS;
  var teto = APPLICASH_PRECO_CENTS - APPLICASH_PISO_CENTS;
  return Math.min(bruto, teto);
}
function apcFaturaCents(indicados) {
  return APPLICASH_PRECO_CENTS - apcAbatimentoCents(indicados);
}

// ------------------------------------------------------------
// Captura do ?ref= + ping de clique
// ------------------------------------------------------------

// Roda em parse-time: guarda o cupom da URL para o /init o enviar no signup e
// limpa o parâmetro do endereço. O ping de clique alimenta a 1ª etapa do
// funil que o indicador vê.
//
// PRIVACIDADE: o ping manda o CÓDIGO e nada mais. Nenhum dado do visitante
// sai daqui — o servidor incrementa um contador agregado (ver a op `ref-hit`
// em api/user.js). A trava de sessão evita que um F5 conte de novo.
(function capturarRefDaUrl() {
  try {
    var p = new URLSearchParams(window.location.search);
    var raw = p.get('ref') || p.get('cupom') || p.get('coupon') || '';
    if (!raw) return;
    var c = String(raw).trim().toUpperCase();
    if (!/^APP-[A-Z0-9]{6}$/.test(c)) return;
    sessionStorage.setItem('appliquei_pending_referral', c);

    var jaContou = 'appliquei_ref_hit_' + c;
    if (!sessionStorage.getItem(jaContou)) {
      sessionStorage.setItem(jaContou, '1');
      var corpo = JSON.stringify({ code: c });
      // sendBeacon não atrasa a navegação e sobrevive ao unload. O fetch é o
      // plano B; ambos são best-effort — telemetria nunca pode travar a tela.
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/ref-hit', new Blob([corpo], { type: 'application/json' }));
        } else {
          fetch('/api/ref-hit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: corpo,
            keepalive: true,
          }).catch(function () {});
        }
      } catch (_) {}
    }

    p.delete('ref');
    p.delete('cupom');
    p.delete('coupon');
    var qs = p.toString();
    var url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState({}, '', url);
  } catch (_) {}
})();

// ------------------------------------------------------------
// Estado da tela
// ------------------------------------------------------------

var apcEstado = { fase: 'carregando', me: null, erro: false, atualizadoEm: null };

function apcEl(id) {
  return document.getElementById(id);
}
function apcTexto(id, valor) {
  var el = apcEl(id);
  if (el) el.textContent = valor;
}
function apcMostrar(id, visivel) {
  var el = apcEl(id);
  if (el) el.hidden = !visivel;
}

/** Troca a composição da página. O CSS reage a [data-fase]. */
function apcSetFase(fase) {
  apcEstado.fase = fase;
  var sec = apcEl('applicash');
  if (sec) sec.setAttribute('data-fase', fase);
}

/** Desabilita os CTAs enquanto não há cupom — evita clique que só dá erro. */
function apcHabilitarAcoes(ligado) {
  ['apcBtnWhatsapp', 'apcBtnCompartilhar', 'apcBtnCopiarLink', 'apcHeroLinkPill'].forEach(
    function (id) {
      var b = apcEl(id);
      if (!b) return;
      b.disabled = !ligado;
      b.setAttribute('aria-disabled', ligado ? 'false' : 'true');
    }
  );
}

function cupomValido(c) {
  return /^APP-[A-Z0-9]{6}$/.test(c || '');
}

/** Cupom atual, ou null. Nunca devolve texto de estado disfarçado de cupom. */
function obterCupomApplicash() {
  if (apcEstado.me && cupomValido(apcEstado.me.referralCode)) return apcEstado.me.referralCode;
  try {
    var c = localStorage.getItem(APPLICASH_CONFIG.cupomKey);
    if (cupomValido(c)) return c;
  } catch (_) {}
  return null;
}

function gerarLinkApplicash(cupom) {
  var origin = window.location.origin || '';
  var path = window.location.pathname || '/';
  return (
    origin + path + (path.indexOf('?') === -1 ? '?' : '&') + 'ref=' + encodeURIComponent(cupom)
  );
}

// ------------------------------------------------------------
// Render
// ------------------------------------------------------------

function apcRenderHero(cupom) {
  apcTexto('apcCupomCodigo', cupom || '—');
  var elLink = apcEl('apcHeroLinkUrl');
  var pill = apcEl('apcHeroLinkPill');
  if (cupom) {
    var link = gerarLinkApplicash(cupom);
    if (elLink) elLink.textContent = link.replace(/^https?:\/\//, '');
    if (pill) pill.title = 'Copiar ' + link;
  } else if (elLink) {
    elLink.textContent = '—';
    if (pill) pill.title = '';
  }
}

/** O payoff: quanto a próxima cobrança vai custar depois do abatimento. */
function apcRenderFatura(me) {
  var base = me.subscriptionBaseValueCents || me.monthlyPriceCents || APPLICASH_PRECO_CENTS;
  var prox = me.projectedNextBillCents != null ? me.projectedNextBillCents : base;
  var abatido = Math.max(0, base - prox);

  apcTexto('apcFaturaValor', formatarMoeda(prox / 100));
  apcMostrar('apcFaturaDe', abatido > 0);
  apcTexto('apcFaturaDeValor', formatarMoeda(base / 100));
  apcTexto(
    'apcFaturaAbatido',
    abatido > 0
      ? '−' + formatarMoeda(abatido / 100) + ' de Applicash já aplicado'
      : 'Nenhum abatimento nesta cobrança ainda'
  );

  // Barra: quanto da mensalidade os amigos já cobrem. Substitui a pizza
  // "paga vs recebe", que com 1 indicação desenhava um fiapo verde num
  // círculo vermelho e desmotivava justamente quem tinha acabado de começar.
  var pct = base > 0 ? Math.min(100, (abatido / base) * 100) : 0;
  var barra = apcEl('apcFaturaBarra');
  if (barra) {
    barra.style.width = pct.toFixed(1) + '%';
    barra.parentElement.setAttribute('aria-valuenow', String(Math.round(pct)));
  }
  apcTexto('apcFaturaPct', Math.round(pct) + '% coberto por indicações');
}

/** Funil: abriu o link → criou conta → está pagando. */
function apcRenderFunil(me) {
  var f = me.funnel || { hits: 0, signups: 0, subscribers: 0, pending: 0 };
  apcTexto('apcFunilHits', String(f.hits || 0));
  apcTexto('apcFunilSignups', String(f.signups || 0));
  apcTexto('apcFunilSubs', String(f.subscribers || 0));

  // A etapa do meio é a acionável: quem se cadastrou e ainda não assinou é
  // exatamente quem vale um empurrãozinho.
  var pendentes = f.pending || 0;
  apcMostrar('apcFunilDica', pendentes > 0);
  apcTexto(
    'apcFunilDicaTexto',
    pendentes === 1
      ? '1 pessoa criou conta com seu cupom e ainda não assinou. Um lembrete costuma resolver.'
      : pendentes + ' pessoas criaram conta com seu cupom e ainda não assinaram.'
  );
}

function apcRenderMeta(ativos) {
  var meta = APPLICASH_METAS.find(function (m) {
    return m.qtd > ativos;
  });
  var ultima = !meta;
  if (!meta) meta = APPLICASH_METAS[APPLICASH_METAS.length - 1];

  var progresso = Math.min(100, (ativos / meta.qtd) * 100);
  apcTexto(
    'apcMetaTitulo',
    ultima
      ? 'Todos os marcos conquistados'
      : 'Indique ' + meta.qtd + (meta.qtd === 1 ? ' pessoa' : ' pessoas')
  );
  apcTexto('apcMetaRecompensa', formatarMoeda(apcFaturaCents(meta.qtd) / 100) + '/mês');
  apcTexto('apcMetaSubtitulo', meta.recompensa);
  var bar = apcEl('apcMetaProgressoBar');
  if (bar) {
    bar.style.width = progresso.toFixed(1) + '%';
    bar.parentElement.setAttribute('aria-valuenow', String(Math.round(progresso)));
  }
  apcTexto('apcMetaAtual', String(ativos));
  apcTexto('apcMetaAlvo', String(meta.qtd));
  apcTexto('apcMetaRestante', String(Math.max(0, meta.qtd - ativos)));

  var lista = apcEl('apcMetasLista');
  if (!lista) return;
  lista.innerHTML = APPLICASH_METAS.map(function (m) {
    var feita = ativos >= m.qtd;
    // O ícone (preenchido vs. vazio) carrega o mesmo significado que a cor —
    // nada essencial pode depender só de cor.
    return (
      '<li class="apc-marco' +
      (feita ? ' is-feito' : '') +
      '">' +
      '<i class="' +
      (feita ? 'ph-fill ph-check-circle' : 'ph ph-circle') +
      '" aria-hidden="true"></i>' +
      '<div><strong>' +
      m.qtd +
      (m.qtd === 1 ? ' indicação' : ' indicações') +
      ' — fatura de ' +
      formatarMoeda(apcFaturaCents(m.qtd) / 100) +
      '</strong><span>' +
      m.recompensa +
      '</span></div>' +
      (feita ? '<span class="apc-marco-tag">Conquistado</span>' : '') +
      '</li>'
    );
  }).join('');
}

/**
 * Lista de indicados. Três colunas: quem, quanto rende, situação.
 *
 * "Plano" e "Periodicidade" saíram: eram sempre "Mensal" nas duas, ocupavam
 * metade da largura e empurravam a tabela para scroll horizontal no celular.
 */
function apcRenderLista(me) {
  var corpo = apcEl('apcTabelaIndicacoesCorpo');
  var vazia = apcEl('apcTabelaVazia');
  var tabela = apcEl('apcTabelaIndicacoes');
  var refs = me.referrals || [];
  if (!corpo) return;

  if (!refs.length) {
    corpo.innerHTML = '';
    if (tabela) tabela.hidden = true;
    if (vazia) vazia.hidden = false;
    return;
  }
  if (tabela) tabela.hidden = false;
  if (vazia) vazia.hidden = true;

  corpo.innerHTML = refs
    .map(function (r) {
      // O servidor JÁ manda o e-mail mascarado (maskEmail em api/billing/me.js).
      // Mascarar de novo no cliente produzia "J**************m" em toda linha —
      // todas idênticas, e a tabela perdia a função de distinguir uma pessoa
      // da outra.
      var quem = r.email || 'Indicado';
      var rende = r.active ? apcCashbackDe(r) : 0;
      var modo = r.paymentMode === 'one_shot' ? 'Avulso' : 'Mensal';
      return (
        '<tr>' +
        '<td><strong>' +
        escapeHtmlApc(quem) +
        '</strong><span class="apc-td-sub">' +
        modo +
        (r.referralUsedAt ? ' · desde ' + apcData(r.referralUsedAt) : '') +
        '</span></td>' +
        '<td class="apc-td-num valor-mascarado">' +
        (rende > 0 ? formatarMoeda(rende / 100) : '—') +
        '</td>' +
        '<td class="apc-td-status">' +
        (r.active
          ? '<span class="apc-pill is-ok"><i class="ph-fill ph-check-circle" aria-hidden="true"></i> Assinando</span>'
          : '<span class="apc-pill"><i class="ph ph-clock" aria-hidden="true"></i> Não assinou</span>') +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
}

function apcCashbackDe(r) {
  var base = r.baseValueCents || APPLICASH_PRECO_CENTS;
  return Math.round(base * APPLICASH_CONFIG.comissaoPct);
}

function apcData(iso) {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
  } catch (_) {
    return '';
  }
}

function escapeHtmlApc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ------------------------------------------------------------
// Orquestração
// ------------------------------------------------------------

/**
 * Carrega e desenha. Os quatro estados existem de verdade:
 * carregando (skeleton) · erro (faixa + retry) · vazio · ativo.
 */
async function atualizarTelaApplicash() {
  var logado = false;
  try {
    var fb = window.AppliqueiFirebase;
    logado = !!(fb && fb.ready && fb.auth && fb.auth.currentUser);
  } catch (_) {}

  if (!logado) {
    apcSetFase('deslogado');
    apcHabilitarAcoes(false);
    apcRenderHero(null);
    return;
  }

  // Skeleton: antes o slot do cupom recebia a string "Carregando…" e o
  // usuário lia isso como se fosse o código dele, em 36px monoespaçado.
  if (!apcEstado.me) apcSetFase('carregando');
  apcHabilitarAcoes(false);

  var me = null;
  try {
    if (window.AppliqueiBilling && typeof AppliqueiBilling.syncApplicash === 'function') {
      me = await AppliqueiBilling.syncApplicash();
    }
  } catch (_) {
    me = null;
  }

  if (!me) {
    // Falhou. Se há dado de antes, mostra-o AVISANDO que está velho — nunca
    // em silêncio, que é o que acontecia (o catch engolia e a tela desenhava
    // cache antigo como se fosse de agora).
    apcEstado.erro = true;
    apcMostrar('apcErroFaixa', true);
    apcTexto(
      'apcErroTexto',
      apcEstado.atualizadoEm
        ? 'Não conseguimos atualizar agora. Mostrando os dados de ' + apcEstado.atualizadoEm + '.'
        : 'Não conseguimos carregar seu Applicash agora.'
    );
    if (!apcEstado.me) {
      // Fase própria: mandar quem ESTÁ logado para a tela de "entre na sua
      // conta" repete o erro que esta reconstrução veio corrigir — dizer ao
      // usuário algo que não corresponde ao estado dele.
      apcSetFase('erro');
      apcRenderHero(null);
    }
    return;
  }

  apcEstado.me = me;
  apcEstado.erro = false;
  apcEstado.atualizadoEm = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  apcMostrar('apcErroFaixa', false);

  var cupom = obterCupomApplicash();
  apcRenderHero(cupom);
  apcHabilitarAcoes(!!cupom);

  var ativos = me.activeReferrals || 0;
  var temIndicados = ativos > 0 || (me.referrals || []).length > 0;
  if (temIndicados) apcSetFase('ativo');
  else apcSetFase('vazio');

  apcRenderFatura(me);
  apcRenderFunil(me);
  apcRenderMeta(ativos);
  apcRenderLista(me);

  apcTexto('apcKpiAtivos', String(ativos));
  apcTexto(
    'apcKpiAbatimento',
    formatarMoeda(
      ((me.subscriptionBaseValueCents || APPLICASH_PRECO_CENTS) -
        (me.projectedNextBillCents != null
          ? me.projectedNextBillCents
          : me.subscriptionBaseValueCents || APPLICASH_PRECO_CENTS)) /
        100
    )
  );
  apcTexto('apcKpiAcumulado', formatarMoeda((me.totalReferralEarningsCents || 0) / 100));
}

function recarregarApplicash() {
  apcEstado.me = null;
  atualizarTelaApplicash();
}

// ------------------------------------------------------------
// Ações de compartilhamento
// ------------------------------------------------------------

function apcTextoConvite(cupom) {
  return (
    'Uso a Appliquei pra organizar meus investimentos e minhas contas. ' +
    'Com meu cupom ' +
    cupom +
    ' você entra com 10% de desconto pra sempre 💚'
  );
}

function apcExigirCupom() {
  var cupom = obterCupomApplicash();
  if (!cupom) {
    mostrarToast('Seu cupom ainda está carregando. Tente em instantes.', 'aviso');
    return null;
  }
  return cupom;
}

/** CTA primário. No Brasil a indicação acontece no WhatsApp. */
function compartilharWhatsappApplicash() {
  var cupom = apcExigirCupom();
  if (!cupom) return;
  var msg = apcTextoConvite(cupom) + '\n' + gerarLinkApplicash(cupom);
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener');
}

function compartilharCupomApplicash() {
  var cupom = apcExigirCupom();
  if (!cupom) return;
  var link = gerarLinkApplicash(cupom);
  // Sem o link no texto: o navigator.share usa `url` à parte e os apps
  // acrescentam-no sozinhos — repetir duplicaria.
  var texto = apcTextoConvite(cupom);
  if (navigator.share) {
    navigator.share({ title: 'Appliquei', text: texto, url: link }).catch(function () {});
    return;
  }
  apcCopiar(texto + '\n' + link, 'Convite copiado!');
}

function copiarLinkApplicash() {
  var cupom = apcExigirCupom();
  if (!cupom) return;
  apcCopiar(gerarLinkApplicash(cupom), 'Link copiado!', 'lblLinkBtn');
}

function apcCopiar(texto, aviso, rotuloId) {
  var lbl = rotuloId ? apcEl(rotuloId) : null;
  var rotuloOriginal = lbl ? lbl.textContent : null;
  var ok = function () {
    if (lbl) {
      lbl.textContent = 'Copiado!';
      setTimeout(function () {
        lbl.textContent = rotuloOriginal;
      }, 1800);
    }
    mostrarToast(aviso, 'sucesso');
  };
  var fallback = function () {
    var ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (_) {}
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(ok, function () {
      fallback();
      ok();
    });
  } else {
    fallback();
    ok();
  }
}
