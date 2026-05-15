/**
 * Controlo de acesso (trial + assinatura Asaas).
 * Executa após Firebase Auth: inicializa billing no backend, lê status,
 * mostra gate de pagamento quando trial expira ou assinatura bloqueia.
 */
(function () {
  var API = (window.__APPLIQUEI_API_BASE__ || '') + '/api/billing';
  var POLL_MS = 30000;
  var pollTimer = null;
  var lastAccess = null;

  function $(id) { return document.getElementById(id); }

  function ensureGate() {
    if ($('billingGate')) return;
    var div = document.createElement('div');
    div.id = 'billingGate';
    div.style.cssText = 'position:fixed;inset:0;z-index:10060;display:none;align-items:center;justify-content:center;padding:24px 16px;background:linear-gradient(145deg,#0b1410 0%,#0f1f18 45%,#111c17 100%);overflow-y:auto;';
    var fld = 'width:100%;padding:10px 12px;font-size:14px;border:1px solid #d4dad7;border-radius:8px;box-sizing:border-box;';
    div.innerHTML = '\
      <div style="width:100%;max-width:460px;background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:28px;color:#0b1410;font-family:Figtree,sans-serif;">\
        <h2 id="billingTitle" style="font-family:Syne,sans-serif;font-size:1.4rem;font-weight:700;margin:0 0 8px;">Assine para continuar</h2>\
        <p id="billingSub" style="font-size:14px;color:#4a5b53;line-height:1.5;margin:0 0 18px;">A sua avaliação gratuita terminou.</p>\
        <div id="billingDetail" style="background:#f1f5f3;border-radius:10px;padding:12px 14px;font-size:13px;color:#1d2a23;margin-bottom:14px;">\
          <div><strong>Plano:</strong> Mensal Appliquei</div>\
          <div><strong>Valor:</strong> R$ 15,00 / mês</div>\
          <div><strong>Pagamento:</strong> <span id="billingMethodLabel">Cartão (renovação automática) ou PIX/boleto</span></div>\
        </div>\
        <div role="tablist" style="display:flex;gap:6px;margin-bottom:14px;">\
          <button id="billingTabCard" type="button" style="flex:1;padding:9px 0;border:1px solid #059669;background:#059669;color:#fff;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">Cartão recorrente</button>\
          <button id="billingTabPix" type="button" style="flex:1;padding:9px 0;border:1px solid #d4dad7;background:#fff;color:#384a42;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;">PIX / Boleto</button>\
        </div>\
        <div style="margin-bottom:12px;">\
          <label style="display:block;font-size:12px;font-weight:600;color:#384a42;margin-bottom:4px;">Nome completo</label>\
          <input id="billingName" type="text" autocomplete="name" placeholder="Como aparece no documento" style="' + fld + '">\
        </div>\
        <div style="margin-bottom:12px;">\
          <label style="display:block;font-size:12px;font-weight:600;color:#384a42;margin-bottom:4px;">CPF ou CNPJ</label>\
          <input id="billingCpfCnpj" type="text" inputmode="numeric" autocomplete="off" placeholder="Somente números" style="' + fld + '">\
        </div>\
        <div id="billingCardFields">\
          <div style="margin-bottom:12px;">\
            <label style="display:block;font-size:12px;font-weight:600;color:#384a42;margin-bottom:4px;">Número do cartão</label>\
            <input id="ccNumber" type="text" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000" style="' + fld + '">\
          </div>\
          <div style="display:flex;gap:8px;margin-bottom:12px;">\
            <div style="flex:1;">\
              <label style="display:block;font-size:12px;font-weight:600;color:#384a42;margin-bottom:4px;">Validade</label>\
              <input id="ccExp" type="text" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AA" style="' + fld + '">\
            </div>\
            <div style="flex:1;">\
              <label style="display:block;font-size:12px;font-weight:600;color:#384a42;margin-bottom:4px;">CVV</label>\
              <input id="ccCvv" type="text" inputmode="numeric" autocomplete="cc-csc" placeholder="000" style="' + fld + '">\
            </div>\
          </div>\
          <div style="margin-bottom:12px;">\
            <label style="display:block;font-size:12px;font-weight:600;color:#384a42;margin-bottom:4px;">Nome impresso no cartão</label>\
            <input id="ccHolder" type="text" autocomplete="cc-name" placeholder="Como impresso no cartão" style="' + fld + '">\
          </div>\
          <div style="display:flex;gap:8px;margin-bottom:12px;">\
            <div style="flex:1;">\
              <label style="display:block;font-size:12px;font-weight:600;color:#384a42;margin-bottom:4px;">CEP</label>\
              <input id="ccZip" type="text" inputmode="numeric" autocomplete="postal-code" placeholder="00000-000" style="' + fld + '">\
            </div>\
            <div style="flex:1;">\
              <label style="display:block;font-size:12px;font-weight:600;color:#384a42;margin-bottom:4px;">Nº endereço</label>\
              <input id="ccAddrNum" type="text" inputmode="numeric" placeholder="123" style="' + fld + '">\
            </div>\
          </div>\
          <div style="margin-bottom:12px;">\
            <label style="display:block;font-size:12px;font-weight:600;color:#384a42;margin-bottom:4px;">Telefone</label>\
            <input id="ccPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(00) 00000-0000" style="' + fld + '">\
          </div>\
        </div>\
        <div id="billingErr" style="display:none;font-size:12.5px;color:#7f1d1d;background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;margin-bottom:12px;"></div>\
        <button id="billingSubscribeBtn" type="button" style="width:100%;border:none;cursor:pointer;padding:13px 16px;border-radius:10px;font-size:14px;font-weight:600;background:#059669;color:#fff;">Assinar agora (R$ 15/mês)</button>\
        <button id="billingRefreshBtn" type="button" style="margin-top:10px;width:100%;border:1px solid #d4dad7;background:#fff;cursor:pointer;padding:10px 14px;border-radius:10px;font-size:13px;color:#384a42;">Já paguei — verificar status</button>\
        <button id="billingLogoutBtn" type="button" style="margin-top:14px;width:100%;border:none;background:none;cursor:pointer;font-size:12.5px;color:#6b7d75;text-decoration:underline;">Sair desta conta</button>\
      </div>';
    document.body.appendChild(div);

    selectedMethod = 'CREDIT_CARD';
    $('billingTabCard').addEventListener('click', function () { setMethod('CREDIT_CARD'); });
    $('billingTabPix').addEventListener('click', function () { setMethod('UNDEFINED'); });
    $('billingSubscribeBtn').addEventListener('click', subscribe);
    $('billingRefreshBtn').addEventListener('click', function () { refresh(true); });
    $('billingLogoutBtn').addEventListener('click', function () {
      try { window.AppliqueiFirebase.auth.signOut(); } catch (_) {}
    });
  }

  var selectedMethod = 'CREDIT_CARD';
  function setMethod(m) {
    selectedMethod = m;
    var card = $('billingTabCard');
    var pix = $('billingTabPix');
    var fields = $('billingCardFields');
    var label = $('billingMethodLabel');
    var btn = $('billingSubscribeBtn');
    if (m === 'CREDIT_CARD') {
      if (card) { card.style.background = '#059669'; card.style.color = '#fff'; card.style.borderColor = '#059669'; card.style.fontWeight = '600'; }
      if (pix) { pix.style.background = '#fff'; pix.style.color = '#384a42'; pix.style.borderColor = '#d4dad7'; pix.style.fontWeight = '500'; }
      if (fields) fields.style.display = '';
      if (label) label.textContent = 'Cartão recorrente — cobrado automaticamente todo mês';
      if (btn) btn.textContent = 'Assinar com cartão (R$ 15/mês)';
    } else {
      if (pix) { pix.style.background = '#059669'; pix.style.color = '#fff'; pix.style.borderColor = '#059669'; pix.style.fontWeight = '600'; }
      if (card) { card.style.background = '#fff'; card.style.color = '#384a42'; card.style.borderColor = '#d4dad7'; card.style.fontWeight = '500'; }
      if (fields) fields.style.display = 'none';
      if (label) label.textContent = 'PIX ou boleto — fatura nova todo mês';
      if (btn) btn.textContent = 'Gerar fatura (R$ 15/mês)';
    }
  }

  function showGate(title, sub) {
    ensureGate();
    $('billingTitle').textContent = title;
    $('billingSub').textContent = sub;
    $('billingErr').style.display = 'none';
    $('billingGate').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  function hideGate() {
    var g = $('billingGate');
    if (!g) return;
    g.style.display = 'none';
    document.body.style.overflow = '';
  }
  function showErr(msg) {
    ensureGate();
    var e = $('billingErr');
    e.textContent = msg;
    e.style.display = 'block';
  }

  function syncTrialBannerOffset(b) {
    if (!b) return;
    var apply = function () {
      var h = b.offsetHeight || 40;
      var body = document.body;
      if (!body) return;
      body.style.setProperty('position', 'absolute', 'important');
      body.style.setProperty('top', h + 'px', 'important');
      body.style.setProperty('left', '0', 'important');
      body.style.setProperty('right', '0', 'important');
      body.style.setProperty('bottom', '0', 'important');
      body.style.setProperty('height', 'auto', 'important');
      body.style.setProperty('width', 'auto', 'important');
      body.style.setProperty('margin', '0', 'important');
    };
    apply();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
  }
  function clearTrialBannerOffset() {
    var body = document.body;
    if (!body) return;
    ['position','top','left','right','bottom','height','width','margin'].forEach(function (k) {
      body.style.removeProperty(k);
    });
  }
  function ensureTrialBanner(daysLeft) {
    var b = $('trialBanner');
    if (daysLeft <= 0) {
      if (b) b.remove();
      clearTrialBannerOffset();
      return;
    }
    if (!b) {
      b = document.createElement('div');
      b.id = 'trialBanner';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9000;background:#059669;color:#fff;font-family:Figtree,sans-serif;font-size:13px;padding:8px 14px;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 6px rgba(0,0,0,.12);';
      b.innerHTML = '<span id="trialBannerText"></span><button type="button" id="trialBannerBtn" style="background:#fff;color:#059669;border:none;border-radius:6px;padding:5px 10px;font-weight:600;font-size:12px;cursor:pointer;">Assinar agora</button>';
      document.body.appendChild(b);
      $('trialBannerBtn').addEventListener('click', openSubscribeForm);
      if (typeof ResizeObserver === 'function') {
        try { new ResizeObserver(function () { syncTrialBannerOffset(b); }).observe(b); } catch (_) {}
      }
      window.addEventListener('resize', function () { syncTrialBannerOffset(b); });
    }
    var txt = daysLeft === 1 ? 'Último dia da avaliação gratuita.' : 'Avaliação gratuita: ' + daysLeft + ' dias restantes.';
    $('trialBannerText').textContent = txt;
    syncTrialBannerOffset(b);
  }

  async function authedFetch(path, opts) {
    var fb = window.AppliqueiFirebase;
    var u = fb && fb.auth && fb.auth.currentUser;
    if (!u) throw new Error('not_authenticated');
    var token = await u.getIdToken();
    var r = await fetch(API + path, Object.assign({}, opts, {
      headers: Object.assign({
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      }, (opts && opts.headers) || {}),
    }));
    var text = await r.text();
    var data = text ? JSON.parse(text) : {};
    if (!r.ok) {
      var msg = data.error || ('http_' + r.status);
      if (data.code) msg += ' (' + data.code + ')';
      if (data.detail) msg += ': ' + data.detail;
      if (data.asaasErrors) {
        try { msg += ' — Asaas: ' + JSON.stringify(data.asaasErrors); } catch (_) {}
      }
      var err = new Error(msg);
      err.detail = data;
      throw err;
    }
    return data;
  }

  function applyAccess(access) {
    lastAccess = access;
    if (!access) return;
    if (access.status === 'active') {
      hideGate();
      ensureTrialBanner(0);
      stopPolling();
      return;
    }
    if (access.status === 'trial') {
      hideGate();
      ensureTrialBanner(access.trialDaysLeft || 0);
      stopPolling();
      return;
    }
    ensureTrialBanner(0);
    if (access.status === 'pending_payment') {
      if (access.reason === 'risk_analysis') {
        showGate('Cartão em análise', 'O Asaas está a verificar este pagamento. Aguarde alguns minutos — actualizamos automaticamente.');
      } else {
        showGate('Aguardando confirmação de pagamento', 'A sua assinatura está ativa. Estamos a aguardar a confirmação do pagamento pela Asaas.');
      }
    } else if (access.reason === 'overdue') {
      showGate('Assinatura em atraso', 'Identificámos um pagamento em atraso. Troque o método de pagamento ou pague a fatura pendente.');
    } else if (access.reason === 'card_reproved') {
      showGate('Cartão recusado', 'O Asaas recusou a cobrança no cartão. Tente outro cartão ou outra forma de pagamento.');
    } else if (access.reason === 'chargeback') {
      showGate('Chargeback em curso', 'Há um chargeback em curso para esta assinatura. Contacte o suporte para regularizar.');
    } else if (access.reason === 'cancelled') {
      showGate('Assinatura cancelada', 'A sua assinatura foi cancelada. Para voltar a usar a plataforma, crie uma nova assinatura.');
    } else if (access.reason === 'trial_expired') {
      showGate('Avaliação gratuita terminou', 'Os seus 7 dias gratuitos terminaram. Assine para continuar a usar.');
    } else {
      showGate('Assinatura necessária', 'O acesso à plataforma requer uma assinatura ativa.');
    }
    startPolling();
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () { refresh(false); }, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  async function initBilling() {
    var pending = '';
    try { pending = sessionStorage.getItem('appliquei_pending_referral') || ''; } catch (_) {}
    var bodyObj = pending ? { referralCode: pending } : {};
    try {
      var r = await authedFetch('/init', { method: 'POST', body: JSON.stringify(bodyObj) });
      try { sessionStorage.removeItem('appliquei_pending_referral'); } catch (_) {}
      applyAccess(r.access);
    } catch (e) {
      console.warn('[billing] init', e);
      if (e.detail && e.detail.error === 'self_referral_not_allowed') {
        showGate('Cupom inválido', 'Não é possível usar o seu próprio cupom.');
      } else if (e.detail && (e.detail.error === 'invalid_referral_code' || e.detail.error === 'referral_code_not_found')) {
        showGate('Cupom inválido', 'O cupom informado não foi encontrado. Crie a conta sem cupom ou peça outro.');
      } else {
        showGate('Não foi possível verificar a sua assinatura', 'Tente novamente. Se persistir, contacte o suporte.');
      }
      showErr(e.message || 'Erro de rede.');
    }
  }

  async function fetchMe() {
    return authedFetch('/me', { method: 'GET' });
  }

  function fmtBRL(cents) {
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function ensureMyAccountModal() {
    if ($('myAccountModal')) return;
    var div = document.createElement('div');
    div.id = 'myAccountModal';
    div.style.cssText = 'position:fixed;inset:0;z-index:10070;display:none;align-items:center;justify-content:center;padding:24px 16px;background:rgba(15,23,42,.55);overflow-y:auto;';
    div.innerHTML = '\
      <div style="width:100%;max-width:520px;background:#fff;border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.3);padding:26px;color:#0b1410;font-family:Figtree,sans-serif;">\
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">\
          <h2 style="font-family:Syne,sans-serif;font-size:1.25rem;margin:0;">Minha assinatura</h2>\
          <button type="button" id="myAccountClose" style="border:none;background:none;cursor:pointer;font-size:22px;color:#6b7d75;">&times;</button>\
        </div>\
        <div id="myAccountBody" style="font-size:13.5px;color:#1d2a23;">A carregar…</div>\
      </div>';
    document.body.appendChild(div);
    div.addEventListener('click', function (e) { if (e.target === div) closeMyAccount(); });
    $('myAccountClose').addEventListener('click', closeMyAccount);
  }
  function closeMyAccount() {
    var m = $('myAccountModal');
    if (m) m.style.display = 'none';
  }
  async function openMyAccount() {
    ensureMyAccountModal();
    $('myAccountModal').style.display = 'flex';
    $('myAccountBody').innerHTML = 'A carregar…';
    try {
      var me = await fetchMe();
      renderMyAccount(me);
    } catch (e) {
      $('myAccountBody').textContent = 'Erro: ' + (e.message || 'tente mais tarde');
    }
  }
  function statusLabel(s) {
    if (!s) return 'Sem assinatura';
    if (s === 'ACTIVE') return 'Ativa';
    if (s === 'OVERDUE') return 'Em atraso';
    if (s === 'INACTIVE') return 'Cancelada';
    return s;
  }
  function statusColor(s) {
    if (s === 'ACTIVE') return '#059669';
    if (s === 'OVERDUE') return '#a16207';
    if (s === 'INACTIVE') return '#7f1d1d';
    return '#6b7d75';
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('pt-BR'); } catch (_) { return iso; }
  }
  function paymentStatusLabel(s) {
    var map = {
      CONFIRMED: 'Confirmado', RECEIVED: 'Recebido', RECEIVED_IN_CASH: 'Recebido',
      PENDING: 'Pendente', OVERDUE: 'Atrasado', REFUNDED: 'Devolvido', DELETED: 'Cancelado'
    };
    return map[s] || s || '—';
  }
  function renderMyAccount(me) {
    var pct = me.recurringDiscountPercent || 0;
    var baseCents = me.subscriptionBaseValueCents || me.monthlyPriceCents || 1500;
    var subStatus = me.subscriptionStatus;
    var trialEndsAt = me.trialEndsAt;
    var inTrial = me.access && me.access.status === 'trial';

    var subBlock = '';
    if (inTrial) {
      subBlock = '<div style="background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:10px;padding:12px 14px;font-size:13px;">' +
        'Você está na <strong>avaliação gratuita</strong>. Termina em ' + fmtDate(trialEndsAt) + '.</div>';
    } else {
      subBlock = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
        statCard('Status', '<span style="color:' + statusColor(subStatus) + ';">' + statusLabel(subStatus) + '</span>') +
        statCard('Plano', 'Mensal Appliquei') +
        statCard('Valor cobrado', fmtBRL(baseCents)) +
        statCard('Próxima cobrança', fmtBRL(me.projectedNextBillCents || baseCents)) +
        '</div>';
    }

    var discountNote = pct > 0
      ? '<div style="margin-top:10px;font-size:12px;color:#059669;"><strong>' + pct + '% off recorrente</strong> aplicado por uso do cupom ' + (me.referredByCode || '') + '.</div>'
      : '';

    var payments = (me.payments || []);
    var paymentsRows = payments.length ? payments.map(function (p) {
      return '<tr>' +
        '<td style="padding:5px 0;color:#4a5b53;">' + fmtDate(p.paymentDate || p.dueDate || p.receivedAt) + '</td>' +
        '<td style="padding:5px 0;">' + (p.billingType || '—') + '</td>' +
        '<td style="text-align:right;padding:5px 0;font-weight:600;">R$ ' + (p.value || 0).toFixed(2) + '</td>' +
        '<td style="text-align:right;padding:5px 0;color:' + statusColor(p.status === 'CONFIRMED' || p.status === 'RECEIVED' ? 'ACTIVE' : (p.status === 'OVERDUE' ? 'OVERDUE' : null)) + ';">' + paymentStatusLabel(p.status) + '</td>' +
        '<td style="text-align:right;padding:5px 0;">' + (p.invoiceUrl ? '<a href="' + p.invoiceUrl + '" target="_blank" rel="noopener" style="color:#059669;">Fatura</a>' : '—') + '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="5" style="padding:10px 0;color:#6b7d75;text-align:center;">Sem pagamentos ainda.</td></tr>';

    var html = subBlock + discountNote +
      '<div style="margin-top:18px;">' +
        '<div style="font-size:12px;font-weight:600;color:#384a42;margin-bottom:6px;">Histórico de cobranças</div>' +
        '<table style="width:100%;font-size:12.5px;border-collapse:collapse;">' +
          '<thead><tr style="color:#6b7d75;font-size:11px;text-transform:uppercase;letter-spacing:.4px;">' +
          '<th style="text-align:left;padding-bottom:4px;">Data</th>' +
          '<th style="text-align:left;padding-bottom:4px;">Forma</th>' +
          '<th style="text-align:right;padding-bottom:4px;">Valor</th>' +
          '<th style="text-align:right;padding-bottom:4px;">Status</th>' +
          '<th style="text-align:right;padding-bottom:4px;"></th></tr></thead>' +
          '<tbody>' + paymentsRows + '</tbody>' +
        '</table>' +
      '</div>' +
      '<div style="margin-top:14px;font-size:11.5px;color:#6b7d75;">Programa de indicação (cupom, indicados, créditos) está em <strong>Applicash $</strong>.</div>';

    $('myAccountBody').innerHTML = html;
  }

  async function syncApplicashFromServer() {
    try {
      var me = await fetchMe();
      if (me.referralCode) {
        try { localStorage.setItem('appliquei_cupom_codigo', me.referralCode); } catch (_) {}
      }
      var assin = {
        plano: 'Mensal',
        valorMensal: (me.subscriptionBaseValueCents || me.monthlyPriceCents || 1500) / 100,
        proximaCobranca: (me.projectedNextBillCents || 0) / 100,
        status: me.subscriptionStatus || null,
        descontoPct: me.recurringDiscountPercent || 0,
      };
      try { localStorage.setItem('appliquei_applicash_assinatura', JSON.stringify(assin)); } catch (_) {}

      var indicacoes = (me.referrals || []).map(function (r) {
        return {
          nome: r.email || 'Indicado',
          plano: 'Mensal',
          valorPago: (r.baseValueCents || 0) / 100,
          periodicidade: 'mensal',
          status: r.subscriptionStatus === 'ACTIVE' ? 'ativo' : 'inativo',
          dataAdesao: r.referralUsedAt || null,
        };
      });
      try { localStorage.setItem('appliquei_applicash_indicacoes', JSON.stringify(indicacoes)); } catch (_) {}

      try {
        var creditsLog = (me.credits || []).map(function (c) {
          return { id: c.id, fromEmail: c.fromEmail, amountCents: c.amountCents, appliedAt: c.appliedAt, createdAt: c.createdAt };
        });
        localStorage.setItem('appliquei_applicash_creditos', JSON.stringify(creditsLog));
        localStorage.setItem('appliquei_applicash_resumo', JSON.stringify({
          activeReferrals: me.activeReferrals,
          totalReferrals: me.totalReferrals,
          pendingDiscountCents: me.pendingDiscountCents,
          totalReferralEarningsCents: me.totalReferralEarningsCents,
          projectedNextBillCents: me.projectedNextBillCents,
        }));
      } catch (_) {}

      return me;
    } catch (e) {
      console.warn('[billing] syncApplicash', e);
      return null;
    }
  }
  function statCard(label, value) {
    return '<div style="background:#fff;border:1px solid #e4ebe7;border-radius:10px;padding:10px 12px;">' +
      '<div style="font-size:11px;color:#6b7d75;text-transform:uppercase;letter-spacing:.4px;">' + label + '</div>' +
      '<div style="font-size:15px;font-weight:700;color:#0b1410;margin-top:2px;">' + value + '</div>' +
      '</div>';
  }

  async function refresh(verbose) {
    try {
      var r = await authedFetch('/status', { method: 'GET' });
      applyAccess(r.access);
      if (verbose && r.access && r.access.status !== 'active') {
        showErr('Ainda não recebemos a confirmação. Tente novamente em alguns instantes.');
      }
    } catch (e) {
      if (verbose) showErr(e.message || 'Erro de rede.');
    }
  }

  function writePopupMessage(popup, title, body) {
    if (!popup || popup.closed) return;
    try {
      popup.document.open();
      popup.document.write('<!doctype html><meta charset="utf-8"><title>' + title + '</title>' +
        '<body style="font-family:system-ui,sans-serif;padding:32px;max-width:560px;margin:auto;color:#0b1410;">' +
        '<h2 style="margin:0 0 8px;">' + title + '</h2>' +
        '<pre style="white-space:pre-wrap;background:#f1f5f3;padding:12px;border-radius:8px;font-size:13px;">' +
        body.replace(/[<>&]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]; }) +
        '</pre><p style="font-size:13px;color:#4a5b53;">Pode fechar esta aba.</p>');
      popup.document.close();
    } catch (_) {}
  }

  function openSubscribeForm() {
    showGate('Assine para continuar', 'Preencha os dados para emitir a fatura.');
    setTimeout(function () { var el = $('billingCpfCnpj'); if (el) el.focus(); }, 50);
  }

  function parseExpiry(v) {
    var d = String(v || '').replace(/\D+/g, '');
    if (d.length < 3) return null;
    var mm = d.slice(0, 2);
    var yy = d.slice(2);
    if (yy.length === 2) yy = '20' + yy;
    if (yy.length !== 4) return null;
    var m = parseInt(mm, 10);
    if (m < 1 || m > 12) return null;
    return { expiryMonth: mm, expiryYear: yy };
  }

  function collectCardPayload() {
    var num = ($('ccNumber') || {}).value || '';
    var exp = parseExpiry(($('ccExp') || {}).value);
    var cvv = (($('ccCvv') || {}).value || '').replace(/\D+/g, '');
    var holder = (($('ccHolder') || {}).value || '').trim();
    var zip = (($('ccZip') || {}).value || '').replace(/\D+/g, '');
    var addrNum = (($('ccAddrNum') || {}).value || '').replace(/\D+/g, '');
    var phone = (($('ccPhone') || {}).value || '').replace(/\D+/g, '');
    var digits = num.replace(/\D+/g, '');
    if (digits.length < 13 || digits.length > 19) return { error: 'Número do cartão inválido.' };
    if (!exp) return { error: 'Validade do cartão inválida (MM/AA).' };
    if (cvv.length < 3) return { error: 'CVV inválido.' };
    if (holder.length < 3) return { error: 'Informe o nome impresso no cartão.' };
    if (zip.length !== 8) return { error: 'CEP inválido (8 dígitos).' };
    if (!addrNum) return { error: 'Informe o número do endereço.' };
    if (phone.length < 10) return { error: 'Telefone inválido.' };
    return {
      creditCard: {
        holderName: holder,
        number: digits,
        expiryMonth: exp.expiryMonth,
        expiryYear: exp.expiryYear,
        ccv: cvv,
      },
      holder: { zip: zip, addrNum: addrNum, phone: phone },
    };
  }

  async function subscribe() {
    var btn = $('billingSubscribeBtn');
    var nameEl = $('billingName');
    var cpfEl = $('billingCpfCnpj');
    var cpfRaw = cpfEl ? cpfEl.value : '';
    var cpfDigits = (cpfRaw || '').replace(/\D+/g, '');
    var nameVal = nameEl ? nameEl.value.trim() : '';

    if (cpfEl && cpfDigits.length !== 11 && cpfDigits.length !== 14) {
      showErr('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).');
      return;
    }
    if (nameEl && nameVal.length < 3) {
      showErr('Informe o seu nome completo.');
      return;
    }

    var payload = { cpfCnpj: cpfDigits, name: nameVal };
    var fb = window.AppliqueiFirebase;
    var userEmail = (fb && fb.auth && fb.auth.currentUser && fb.auth.currentUser.email) || null;

    if (selectedMethod === 'CREDIT_CARD') {
      var card = collectCardPayload();
      if (card.error) { showErr(card.error); return; }
      payload.creditCard = card.creditCard;
      payload.creditCardHolderInfo = {
        name: nameVal,
        email: userEmail,
        cpfCnpj: cpfDigits,
        postalCode: card.holder.zip,
        addressNumber: card.holder.addrNum,
        phone: card.holder.phone,
      };
    }

    if (btn) btn.disabled = true;
    var popup = selectedMethod === 'CREDIT_CARD' ? null : window.open('about:blank', '_blank');
    if (popup) writePopupMessage(popup, 'A criar assinatura…', 'A contactar o Asaas. Esta aba abrirá a fatura em instantes.');
    try {
      var r = await authedFetch('/subscribe', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      console.log('[billing] subscribe response', r);

      if (r.paymentMethod === 'CREDIT_CARD') {
        showGate('A processar pagamento', 'Cobrança em curso no cartão terminado em ' + (r.cardLast4 || '••••') + '. Vamos confirmar em instantes.');
        await waitForActive(20);
        return;
      }

      if (r.invoiceUrl) {
        if (popup && !popup.closed) {
          popup.location.href = r.invoiceUrl;
        } else {
          window.location.href = r.invoiceUrl;
          return;
        }
        showGate('Conclua o pagamento', 'Abrimos a fatura numa nova aba. Após pagar, prima “Já paguei” para verificar.');
        startActivePolling();
      } else if (r.alreadyActive) {
        writePopupMessage(popup, 'Já tem assinatura ativa', 'A sua assinatura (id: ' + (r.subscriptionId || '?') + ') já existe, mas não há fatura pendente. Verifique no painel Asaas. Resposta:\n\n' + JSON.stringify(r, null, 2));
        await refresh(false);
      } else {
        writePopupMessage(popup, 'Sem link de pagamento', 'O backend respondeu mas não devolveu invoiceUrl. Resposta:\n\n' + JSON.stringify(r, null, 2));
        showErr('Não foi possível obter o link de pagamento.');
      }
    } catch (e) {
      console.warn('[billing] subscribe', e, e.detail);
      if (popup) writePopupMessage(popup, 'Erro ao criar assinatura', (e.message || 'erro') + '\n\n' + JSON.stringify(e.detail || {}, null, 2));
      showErr(e.message || 'Falha ao criar assinatura.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function waitForActive(maxAttempts) {
    var attempts = 0;
    while (attempts < maxAttempts) {
      await new Promise(function (r) { setTimeout(r, 2500); });
      attempts++;
      try {
        var s = await authedFetch('/status', { method: 'GET' });
        if (s.access && s.access.status === 'active') {
          applyAccess(s.access);
          try { await syncApplicashFromServer(); } catch (_) {}
          return true;
        }
      } catch (_) {}
    }
    showErr('Não recebemos confirmação ainda. Use "Já paguei — verificar status".');
    return false;
  }

  function startActivePolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    pollTimer = setInterval(function () { refresh(false); }, 5000);
  }

  function onUser(user) {
    if (!user) {
      hideGate();
      ensureTrialBanner(0);
      stopPolling();
      lastAccess = null;
      return;
    }
    initBilling().then(function () {
      syncApplicashFromServer().then(function () {
        if (typeof window.atualizarTelaApplicash === 'function') {
          try {
            var sec = document.getElementById('applicash');
            if (sec && sec.classList && sec.classList.contains('ativa')) window.atualizarTelaApplicash();
          } catch (_) {}
        }
      });
    });
  }

  var attempts = 0;
  function attach() {
    attempts++;
    var fb = window.AppliqueiFirebase;
    if (fb && fb.ready && fb.auth) {
      fb.auth.onAuthStateChanged(onUser);
      return;
    }
    if (attempts > 80) return;
    setTimeout(attach, 250);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }

  window.AppliqueiBilling = {
    refresh: function () { return refresh(true); },
    subscribe: subscribe,
    getAccess: function () { return lastAccess; },
    openMyAccount: openMyAccount,
    closeMyAccount: closeMyAccount,
    fetchMe: fetchMe,
    syncApplicash: syncApplicashFromServer,
  };
})();
