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
    div.innerHTML = '\
      <div style="width:100%;max-width:460px;background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:28px;color:#0b1410;font-family:Figtree,sans-serif;">\
        <h2 id="billingTitle" style="font-family:Syne,sans-serif;font-size:1.4rem;font-weight:700;margin:0 0 8px;">Assine para continuar</h2>\
        <p id="billingSub" style="font-size:14px;color:#4a5b53;line-height:1.5;margin:0 0 18px;">A sua avaliação gratuita terminou.</p>\
        <div id="billingDetail" style="background:#f1f5f3;border-radius:10px;padding:12px 14px;font-size:13px;color:#1d2a23;margin-bottom:14px;">\
          <div><strong>Plano:</strong> Mensal Appliquei</div>\
          <div><strong>Valor:</strong> R$ 15,00 / mês</div>\
          <div><strong>Pagamento:</strong> PIX, boleto ou cartão (Asaas)</div>\
        </div>\
        <div style="margin-bottom:12px;">\
          <label style="display:block;font-size:12px;font-weight:600;color:#384a42;margin-bottom:4px;">Nome completo</label>\
          <input id="billingName" type="text" autocomplete="name" placeholder="Como aparece no documento" style="width:100%;padding:10px 12px;font-size:14px;border:1px solid #d4dad7;border-radius:8px;box-sizing:border-box;">\
        </div>\
        <div style="margin-bottom:12px;">\
          <label style="display:block;font-size:12px;font-weight:600;color:#384a42;margin-bottom:4px;">CPF ou CNPJ</label>\
          <input id="billingCpfCnpj" type="text" inputmode="numeric" autocomplete="off" placeholder="Somente números" style="width:100%;padding:10px 12px;font-size:14px;border:1px solid #d4dad7;border-radius:8px;box-sizing:border-box;">\
        </div>\
        <div id="billingErr" style="display:none;font-size:12.5px;color:#7f1d1d;background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;margin-bottom:12px;"></div>\
        <button id="billingSubscribeBtn" type="button" style="width:100%;border:none;cursor:pointer;padding:13px 16px;border-radius:10px;font-size:14px;font-weight:600;background:#059669;color:#fff;">Assinar agora (R$ 15/mês)</button>\
        <button id="billingRefreshBtn" type="button" style="margin-top:10px;width:100%;border:1px solid #d4dad7;background:#fff;cursor:pointer;padding:10px 14px;border-radius:10px;font-size:13px;color:#384a42;">Já paguei — verificar status</button>\
        <button id="billingLogoutBtn" type="button" style="margin-top:14px;width:100%;border:none;background:none;cursor:pointer;font-size:12.5px;color:#6b7d75;text-decoration:underline;">Sair desta conta</button>\
      </div>';
    document.body.appendChild(div);

    $('billingSubscribeBtn').addEventListener('click', subscribe);
    $('billingRefreshBtn').addEventListener('click', function () { refresh(true); });
    $('billingLogoutBtn').addEventListener('click', function () {
      try { window.AppliqueiFirebase.auth.signOut(); } catch (_) {}
    });
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

  function ensureTrialBanner(daysLeft) {
    var b = $('trialBanner');
    if (daysLeft <= 0) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('div');
      b.id = 'trialBanner';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9000;background:#059669;color:#fff;font-family:Figtree,sans-serif;font-size:13px;padding:8px 14px;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 6px rgba(0,0,0,.12);';
      b.innerHTML = '<span id="trialBannerText"></span><button type="button" id="trialBannerBtn" style="background:#fff;color:#059669;border:none;border-radius:6px;padding:5px 10px;font-weight:600;font-size:12px;cursor:pointer;">Assinar agora</button>';
      document.body.appendChild(b);
      $('trialBannerBtn').addEventListener('click', openSubscribeForm);
    }
    var txt = daysLeft === 1 ? 'Último dia da avaliação gratuita.' : 'Avaliação gratuita: ' + daysLeft + ' dias restantes.';
    $('trialBannerText').textContent = txt;
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
      showGate('Aguardando confirmação de pagamento', 'A sua assinatura está ativa. Estamos a aguardar a confirmação do pagamento pela Asaas.');
    } else if (access.reason === 'overdue') {
      showGate('Assinatura em atraso', 'Identificámos um pagamento em atraso. Regularize para reactivar o acesso.');
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
    try {
      var r = await authedFetch('/init', { method: 'POST', body: '{}' });
      applyAccess(r.access);
    } catch (e) {
      console.warn('[billing] init', e);
      showGate('Não foi possível verificar a sua assinatura', 'Tente novamente. Se persistir, contacte o suporte.');
      showErr(e.message || 'Erro de rede.');
    }
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

    if (btn) btn.disabled = true;
    var popup = window.open('about:blank', '_blank');
    writePopupMessage(popup, 'A criar assinatura…', 'A contactar o Asaas. Esta aba abrirá a fatura em instantes.');
    try {
      var r = await authedFetch('/subscribe', {
        method: 'POST',
        body: JSON.stringify({ cpfCnpj: cpfDigits, name: nameVal }),
      });
      console.log('[billing] subscribe response', r);
      if (r.invoiceUrl) {
        if (popup && !popup.closed) {
          popup.location.href = r.invoiceUrl;
        } else {
          window.location.href = r.invoiceUrl;
          return;
        }
        showGate('Conclua o pagamento', 'Abrimos a fatura numa nova aba. Após pagar, prima “Já paguei” para verificar.');
      } else if (r.alreadyActive) {
        writePopupMessage(popup, 'Já tem assinatura ativa', 'A sua assinatura (id: ' + (r.subscriptionId || '?') + ') já existe, mas não há fatura pendente. Verifique no painel Asaas. Resposta:\n\n' + JSON.stringify(r, null, 2));
        await refresh(false);
      } else {
        writePopupMessage(popup, 'Sem link de pagamento', 'O backend respondeu mas não devolveu invoiceUrl. Resposta:\n\n' + JSON.stringify(r, null, 2));
        showErr('Não foi possível obter o link de pagamento.');
      }
    } catch (e) {
      console.warn('[billing] subscribe', e, e.detail);
      writePopupMessage(popup, 'Erro ao criar assinatura', (e.message || 'erro') + '\n\n' + JSON.stringify(e.detail || {}, null, 2));
      showErr(e.message || 'Falha ao criar assinatura.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function onUser(user) {
    if (!user) {
      hideGate();
      ensureTrialBanner(0);
      stopPolling();
      lastAccess = null;
      return;
    }
    initBilling();
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
  };
})();
