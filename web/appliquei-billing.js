/**
 * Controlo de acesso (trial + assinatura Asaas).
 * Executa após Firebase Auth: inicializa billing no backend, lê status,
 * mostra gate de pagamento quando trial expira ou assinatura bloqueia.
 *
 * Onda 3 — convertido para ES module. O IIFE e o bloco-com-chaves que
 * embrulhavam o conteúdo foram removidos: o escopo do módulo já isola as
 * `var` do global, e o bloco extra induzia o esbuild minifier a gerar
 * conflito de nome no chunk minificado (ver appliquei-cloud-sync.js).
 * A indentação +2 ficou para minimizar o diff da conversão.
 * `window.AppliqueiBilling` continua exposto no final para os
 * consumidores legados (HTML inline e onClick handlers).
 */
var API = (window.__APPLIQUEI_API_BASE__ || '') + '/api/billing';
var POLL_MS = 30000;
var pollTimer = null;
var lastAccess = null;
var lastBilling = null;

// Reporta ao Sentry erros que antes eram engolidos em silêncio (catch vazio).
// Usado só nos pontos onde o catch esconde uma falha de integridade real —
// rede de billing, estado de acesso e sync de applicash/crédito —, não nos
// best-effort de UI/localStorage (esses falham por design e gerariam ruído).
// Mantém o comportamento original (não relança): o fluxo segue como antes,
// só que agora a divergência fica visível em vez de invisível.
function reportSwallowed(err, where) {
  try {
    var S = window.AppliqueiSentry;
    if (S && typeof S.captureException === 'function') {
      S.captureException(err instanceof Error ? err : new Error(String(err)), {
        level: 'warning',
        tags: { swallowed: 'billing', where: where },
      });
    } else if (typeof console !== 'undefined' && console.debug) {
      console.debug('[billing] erro engolido @' + where, (err && err.message) || err);
    }
  } catch (_) {
    // O reporte nunca pode quebrar o fluxo que originalmente ignorava o erro.
  }
}

function effectivePriceCents() {
  if (!lastBilling) return 1500;
  // Se a subscription já existe, o valor cobrado já está fixado
  if (lastBilling.subscriptionBaseValueCents) return lastBilling.subscriptionBaseValueCents;
  // Caso contrário, calcular a partir do desconto registado em /init
  var base = lastBilling.monthlyPriceCents || 1500;
  var pct = lastBilling.recurringDiscountPercent || 0;
  return Math.round((base * (100 - pct)) / 100);
}
function priceLabel() {
  // fmtBRL é declarada abaixo (hoisting via var/function); evita uso antes de definição
  return typeof fmtBRL === 'function'
    ? fmtBRL(effectivePriceCents())
    : 'R$ ' + (effectivePriceCents() / 100).toFixed(2).replace('.', ',');
}
function updateGatePrices() {
  var pct = (lastBilling && lastBilling.recurringDiscountPercent) || 0;
  var listCents = (lastBilling && lastBilling.monthlyPriceCents) || 1500;
  var effective = effectivePriceCents();
  var total = $('billingSummaryTotal');
  var label = $('billingSummaryLabel');
  var row = $('billingSummaryRowDiscount');
  var rowVal = $('billingSummaryDiscountValue');
  var isOnce = typeof selectedBillingMode !== 'undefined' && selectedBillingMode === 'one_shot';
  if (total) total.textContent = typeof fmtBRL === 'function' ? fmtBRL(effective) : priceLabel();
  if (label) label.textContent = isOnce ? 'Total (1 mês de acesso)' : 'Total mensal';
  if (row && rowVal) {
    var diff = listCents - effective;
    if (diff > 0 && pct > 0) {
      row.style.display = '';
      rowVal.textContent =
        '− ' +
        (typeof fmtBRL === 'function'
          ? fmtBRL(diff)
          : 'R$ ' + (diff / 100).toFixed(2).replace('.', ','));
      var lbl = document.getElementById('billingSummaryDiscountLabel');
      if (lbl) lbl.textContent = 'Cupom ' + pct + '% off';
    } else {
      row.style.display = 'none';
    }
  }
  // Texto do CTA fica em ctaText(); aqui só re-aplica via setMethod (mantém o tab visualmente sincronizado também).
  if (typeof setMethod === 'function' && typeof selectedMethod !== 'undefined')
    setMethod(selectedMethod);
  renderCouponState();
}

function renderCouponState() {
  var section = $('billingCouponSection');
  if (!section) return;
  var b = lastBilling || {};
  section.style.display = '';
  var body = $('billingCouponBody');
  var toggle = $('billingCouponToggle');
  var inputRow = $('billingCouponInputRow');
  var appliedBox = $('billingCouponApplied');
  var msg = $('billingCouponMsg');
  if (msg) {
    msg.style.display = 'none';
    msg.textContent = '';
  }
  if (b.referredByCode) {
    // Abre o body e oculta toggle: o cupom já foi aplicado e o usuário
    // deve ver a confirmação proeminente, não um link "Tem cupom?".
    if (toggle) toggle.style.display = 'none';
    if (body) body.style.display = 'block';
    if (inputRow) inputRow.style.display = 'none';
    if (appliedBox) {
      appliedBox.style.display = 'flex';
      appliedBox.innerHTML =
        '<i class="ph-fill ph-check-circle"></i><span>Cupom <strong>' +
        b.referredByCode +
        '</strong> aplicado · ' +
        (b.recurringDiscountPercent || 0) +
        '% off no plano recorrente.</span>';
    }
  } else {
    if (toggle) toggle.style.display = '';
    // Mantém o body com o estado escolhido pelo toggle (não força reabrir).
    if (inputRow) inputRow.style.display = 'flex';
    if (appliedBox) {
      appliedBox.style.display = 'none';
      appliedBox.innerHTML = '';
    }
  }
}

function showCouponMsg(text, ok) {
  var msg = $('billingCouponMsg');
  if (!msg) return;
  msg.textContent = text;
  msg.style.color = ok ? '#059669' : '#7f1d1d';
  msg.style.display = 'block';
}

async function applyCoupon() {
  var inp = $('billingCoupon');
  var btn = $('billingCouponApply');
  if (!inp) return;
  var raw = (inp.value || '').trim().toUpperCase();
  if (!raw) {
    showCouponMsg('Informe o código do cupom.', false);
    return;
  }
  if (!/^APP-[A-Z0-9]{6}$/.test(raw)) {
    showCouponMsg('Formato inválido. Use APP-XXXXXX.', false);
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Aplicando…';
  }
  try {
    var r = await authedFetch('/init', {
      method: 'POST',
      body: JSON.stringify({ referralCode: raw }),
    });
    lastBilling = r.billing || lastBilling;
    lastAccess = r.access || lastAccess;
    updateGatePrices();
    if (lastBilling && lastBilling.referredByCode === raw) {
      showCouponMsg('Cupom aplicado com sucesso.', true);
    } else {
      // Back-end aceitou o /init mas não aplicou o cupom (ex.: já havia
      // referral vinculado ou subscription já criada). renderCouponState
      // reflete o estado real; só sinalizamos a quem ainda vê o input.
      showCouponMsg('Não foi possível aplicar este cupom no estado atual da conta.', false);
    }
  } catch (e) {
    var code = e.detail && e.detail.error;
    var text;
    if (code === 'invalid_referral_code') text = 'Formato inválido. Use APP-XXXXXX.';
    else if (code === 'referral_code_not_found') text = 'Cupom não encontrado.';
    else if (code === 'self_referral_not_allowed')
      text = 'Não é possível usar o seu próprio cupom.';
    else text = e.message || 'Erro ao aplicar o cupom. Tente novamente.';
    showCouponMsg(text, false);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Aplicar';
    }
  }
}

function $(id) {
  return document.getElementById(id);
}

function injectGateStyles() {
  if (document.getElementById('billingGateStyles')) return;
  var st = document.createElement('style');
  st.id = 'billingGateStyles';
  st.textContent = [
    '#billingGate{position:fixed;inset:0;z-index:10060;display:none;padding:32px 16px;overflow-y:auto;box-sizing:border-box;',
    '  background:radial-gradient(1200px 600px at 50% -10%, #1a3a2a 0%, transparent 60%), linear-gradient(180deg,#0a1410 0%,#0d1a14 100%);',
    '  font-family:Figtree,system-ui,-apple-system,Segoe UI,sans-serif;-webkit-font-smoothing:antialiased;}',
    '.bg-card{width:100%;max-width:480px;margin:0 auto;background:#fff;border-radius:20px;box-shadow:0 30px 80px -20px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.04);color:#0f172a;overflow:hidden;}',
    '.bg-inner{padding:28px 26px 24px;}',
    '.bg-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#047857;background:#ecfdf5;padding:5px 10px;border-radius:999px;letter-spacing:.04em;text-transform:uppercase;margin-bottom:14px;}',
    '.bg-h1{font-family:Syne,sans-serif;font-size:24px;font-weight:700;letter-spacing:-.02em;margin:0 0 8px;line-height:1.2;color:#0f172a;}',
    '.bg-sub{font-size:14px;color:#475569;line-height:1.55;margin:0 0 22px;}',
    '.bg-section{margin-bottom:22px;}',
    '.bg-section-title{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;display:flex;align-items:center;gap:6px;}',
    '.bg-tiers{display:grid;grid-template-columns:1fr 1fr;gap:10px;}',
    '.bg-tier{position:relative;border:1.5px solid #e5e7eb;background:#fff;border-radius:14px;padding:14px 14px 12px;}',
    '.bg-tier-current{border-color:#059669;background:linear-gradient(180deg,#f0fdf4 0%,#ecfdf5 100%);box-shadow:0 0 0 4px rgba(5,150,105,.06);}',
    '.bg-tier-soon{opacity:.85;background:#f8fafc;}',
    '.bg-tier-pill{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;padding:3px 9px;border-radius:999px;letter-spacing:.06em;text-transform:uppercase;}',
    '.bg-tier-pill-current{background:#059669;color:#fff;}',
    '.bg-tier-pill-soon{background:#fef3c7;color:#92400e;}',
    '.bg-tier-title{font-family:Syne,sans-serif;font-weight:700;font-size:18px;color:#0f172a;margin-top:8px;letter-spacing:-.02em;}',
    '.bg-tier-soon .bg-tier-title{color:#64748b;}',
    '.bg-tier-sub{font-size:12.5px;color:#334155;margin-top:4px;line-height:1.45;}',
    '.bg-tier-soon .bg-tier-sub{color:#64748b;}',
    '.bg-modes{display:grid;grid-template-columns:1fr 1fr;gap:10px;}',
    '.bg-mode{position:relative;text-align:left;background:#fff;border:1.5px solid #e5e7eb;border-radius:14px;padding:14px 14px 12px;cursor:pointer;transition:all .15s ease;font-family:inherit;}',
    '.bg-mode:hover{border-color:#cbd5e1;}',
    '.bg-mode[aria-checked="true"]{border-color:#059669;background:#f0fdf4;box-shadow:0 0 0 4px rgba(5,150,105,.08);}',
    '.bg-mode-pill{position:absolute;top:-8px;right:10px;background:#059669;color:#fff;font-size:9.5px;font-weight:700;padding:3px 8px;border-radius:999px;letter-spacing:.06em;text-transform:uppercase;}',
    '.bg-mode-title{display:block;font-family:Syne,sans-serif;font-weight:700;font-size:15px;color:#0f172a;margin-bottom:2px;}',
    '.bg-mode-price{display:flex;align-items:baseline;gap:3px;margin:6px 0 10px;}',
    '.bg-mode-price strong{font-family:Syne,sans-serif;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-.02em;}',
    '.bg-mode-price small{font-size:12px;color:#64748b;font-weight:500;}',
    '.bg-mode-feat{display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;line-height:1.5;margin-top:3px;}',
    '.bg-mode-feat i{color:#059669;font-size:13px;flex-shrink:0;}',
    '.bg-segments{display:flex;gap:0;background:#f1f5f9;border-radius:12px;padding:4px;}',
    '.bg-segment{flex:1;border:none;background:transparent;color:#475569;padding:10px 12px;border-radius:9px;font-size:13.5px;font-weight:600;cursor:pointer;transition:all .15s ease;display:inline-flex;align-items:center;justify-content:center;gap:7px;font-family:inherit;}',
    '.bg-segment[aria-checked="true"]{background:#fff;color:#059669;box-shadow:0 1px 3px rgba(15,23,42,.06),0 1px 1px rgba(15,23,42,.04);}',
    '.bg-segment i{font-size:15px;}',
    '.bg-hint{font-size:12px;color:#64748b;margin:8px 0 0;line-height:1.45;}',
    '.bg-parity{display:flex;gap:9px;align-items:flex-start;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:11px;padding:10px 12px;margin-top:10px;font-size:12px;color:#065f46;line-height:1.5;}',
    '.bg-parity i{color:#059669;font-size:16px;flex-shrink:0;margin-top:1px;}',
    '.bg-parity strong{font-weight:700;}',
    '.bg-field{margin-bottom:12px;}',
    '.bg-field label{display:block;font-size:12px;font-weight:600;color:#334155;margin-bottom:5px;}',
    '.bg-input{width:100%;padding:11px 13px;font-size:14px;border:1.5px solid #e2e8f0;border-radius:10px;box-sizing:border-box;background:#fff;color:#0f172a;font-family:inherit;transition:border-color .15s ease,box-shadow .15s ease;}',
    '.bg-input::placeholder{color:#94a3b8;}',
    '.bg-input:focus{outline:none;border-color:#059669;box-shadow:0 0 0 3px rgba(5,150,105,.12);}',
    '.bg-field-row{display:flex;gap:10px;}',
    '.bg-field-row .bg-field{flex:1;}',
    '.bg-coupon-toggle{background:none;border:none;font-size:13px;color:#059669;font-weight:600;cursor:pointer;padding:0;display:inline-flex;align-items:center;gap:5px;font-family:inherit;}',
    '.bg-coupon-toggle:hover{text-decoration:underline;}',
    '.bg-coupon-body{margin-top:10px;}',
    '.bg-coupon-row{display:flex;gap:8px;}',
    '.bg-coupon-row .bg-input{flex:1;text-transform:uppercase;}',
    '.bg-coupon-row button{padding:0 16px;border:1.5px solid #059669;background:#fff;color:#059669;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit;transition:all .15s ease;}',
    '.bg-coupon-row button:hover{background:#ecfdf5;}',
    '.bg-coupon-row button:disabled{opacity:.5;cursor:not-allowed;}',
    '.bg-applied{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:10px 12px;border-radius:10px;font-size:13px;display:flex;align-items:center;gap:8px;line-height:1.4;}',
    '.bg-applied i{flex-shrink:0;color:#059669;font-size:16px;}',
    '.bg-card-fields-head{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin:18px 0 10px;}',
    '.bg-card-fields-head i{color:#059669;}',
    '.bg-err{font-size:13px;color:#991b1b;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px 12px;margin-bottom:14px;line-height:1.5;display:flex;gap:8px;align-items:flex-start;}',
    '.bg-err i{color:#dc2626;font-size:16px;flex-shrink:0;margin-top:1px;}',
    '.bg-summary{background:linear-gradient(180deg,#f8fafc 0%,#f1f5f9 100%);border-top:1px solid #e2e8f0;padding:18px 26px 20px;}',
    '.bg-summary-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;font-size:13px;color:#475569;}',
    '.bg-summary-row.bg-summary-discount{color:#059669;font-weight:600;}',
    '.bg-summary-total{margin-top:8px;padding-top:10px;border-top:1px dashed #cbd5e1;display:flex;justify-content:space-between;align-items:baseline;}',
    '.bg-summary-total span{font-size:13px;color:#334155;font-weight:600;}',
    '.bg-summary-total strong{font-family:Syne,sans-serif;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-.02em;}',
    '.bg-cta{margin-top:14px;width:100%;border:none;cursor:pointer;padding:14px 16px;border-radius:12px;font-size:14.5px;font-weight:700;background:linear-gradient(180deg,#10b981 0%,#059669 100%);color:#fff;box-shadow:0 4px 12px -2px rgba(5,150,105,.4),inset 0 1px 0 rgba(255,255,255,.2);display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:inherit;transition:transform .1s ease,box-shadow .15s ease;letter-spacing:.01em;}',
    '.bg-cta:hover{box-shadow:0 6px 16px -2px rgba(5,150,105,.5),inset 0 1px 0 rgba(255,255,255,.2);}',
    '.bg-cta:active{transform:translateY(1px);}',
    '.bg-cta:disabled{opacity:.6;cursor:not-allowed;transform:none;}',
    '.bg-cta i{font-size:15px;}',
    '.bg-trust{display:flex;justify-content:center;align-items:center;gap:14px;margin-top:12px;font-size:11.5px;color:#64748b;}',
    '.bg-trust span{display:inline-flex;align-items:center;gap:4px;}',
    '.bg-trust i{color:#059669;font-size:13px;}',
    '.bg-footer{padding:14px 26px 22px;display:flex;flex-direction:column;gap:8px;align-items:center;background:#fff;border-top:1px solid #f1f5f9;}',
    '.bg-link{background:none;border:none;color:#475569;font-size:12.5px;font-weight:500;cursor:pointer;padding:6px 10px;border-radius:6px;font-family:inherit;transition:background .15s ease;}',
    '.bg-link:hover{background:#f1f5f9;color:#0f172a;}',
    '.bg-link-muted{color:#94a3b8;font-size:11.5px;}',
    '@media (max-width:480px){.bg-modes{grid-template-columns:1fr;}.bg-tiers{grid-template-columns:1fr;}.bg-inner{padding:24px 20px 20px;}.bg-summary{padding:16px 20px 18px;}.bg-footer{padding:12px 20px 18px;}.bg-h1{font-size:21px;}}',
  ].join('\n');
  document.head.appendChild(st);
}

function ensureGate() {
  if ($('billingGate')) return;
  injectGateStyles();
  var div = document.createElement('div');
  div.id = 'billingGate';
  div.innerHTML = [
    '<div class="bg-card" role="dialog" aria-modal="true" aria-labelledby="billingTitle">',
    '  <div class="bg-inner">',
    '    <div class="bg-eyebrow"><i class="ph-fill ph-sparkle"></i> Appliquei Pro</div>',
    '    <h2 id="billingTitle" class="bg-h1">Acesso completo ao Appliquei</h2>',
    '    <p id="billingSub" class="bg-sub">Carteira recomendada, dashboards, Applicash e tudo mais. Escolha como prefere pagar.</p>',
    '    <div class="bg-section">',
    '      <div class="bg-section-title">Plano</div>',
    '      <div class="bg-tiers">',
    '        <div class="bg-tier bg-tier-current">',
    '          <span class="bg-tier-pill bg-tier-pill-current"><i class="ph-fill ph-check-circle"></i> Plano atual</span>',
    '          <div class="bg-tier-title">Pro</div>',
    '          <div class="bg-tier-sub">Todas as 10 abas do Appliquei · Applicash · suporte.</div>',
    '        </div>',
    '        <div class="bg-tier bg-tier-soon" aria-disabled="true">',
    '          <span class="bg-tier-pill bg-tier-pill-soon"><i class="ph ph-wrench"></i> Em construção</span>',
    '          <div class="bg-tier-title">Pro + IA</div>',
    '          <div class="bg-tier-sub">Diagnóstico, sugestões e chat com IA. Em breve.</div>',
    '        </div>',
    '      </div>',
    '    </div>',
    '    <div class="bg-section">',
    '      <div class="bg-section-title">Como deseja pagar</div>',
    '      <div class="bg-modes" role="radiogroup" aria-label="Tipo de cobrança">',
    '        <button id="billingModeSub" type="button" class="bg-mode" aria-checked="true">',
    '          <span class="bg-mode-pill">Recomendado</span>',
    '          <span class="bg-mode-title">Assinatura mensal</span>',
    '          <span class="bg-mode-price"><strong>R$ 15</strong><small>/mês</small></span>',
    '          <span class="bg-mode-feat"><i class="ph-fill ph-check"></i> Cobrança automática mensal</span>',
    '          <span class="bg-mode-feat"><i class="ph-fill ph-check"></i> Cancele a qualquer hora</span>',
    '          <span class="bg-mode-feat"><i class="ph-fill ph-check"></i> Sem se preocupar com renovação</span>',
    '        </button>',
    '        <button id="billingModeOnce" type="button" class="bg-mode" aria-checked="false">',
    '          <span class="bg-mode-title">Pagar 1 mês</span>',
    '          <span class="bg-mode-price"><strong>R$ 15</strong><small>/30 dias</small></span>',
    '          <span class="bg-mode-feat"><i class="ph-fill ph-check"></i> Sem compromisso recorrente</span>',
    '          <span class="bg-mode-feat"><i class="ph-fill ph-check"></i> Avisamos antes do fim</span>',
    '          <span class="bg-mode-feat"><i class="ph-fill ph-check"></i> Renove no seu ritmo</span>',
    '        </button>',
    '      </div>',
    '      <p id="billingModeHint" class="bg-hint">Renovação automática. Cancele quando quiser.</p>',
    '      <div class="bg-parity"><i class="ph-fill ph-gift"></i> <span><strong>Applicash funciona igual nos dois:</strong> entrou com cupom de indicação? Paga 10% menos sempre. Indica alguém? Recebe 10% por cada pagamento dele — assinatura ou avulso.</span></div>',
    '    </div>',
    '    <div class="bg-section">',
    '      <div class="bg-section-title">Forma de pagamento</div>',
    '      <div class="bg-segments" role="radiogroup" aria-label="Método de pagamento">',
    '        <button id="billingTabCard" type="button" class="bg-segment" aria-checked="true"><i class="ph-fill ph-credit-card"></i> Cartão</button>',
    '        <button id="billingTabPix" type="button" class="bg-segment" aria-checked="false"><i class="ph ph-qr-code"></i> PIX / Boleto</button>',
    '      </div>',
    '      <p id="billingMethodLabel" class="bg-hint">Cartão cobrado automaticamente todo mês.</p>',
    '    </div>',
    '    <div class="bg-section">',
    '      <div class="bg-section-title">Seus dados</div>',
    '      <div class="bg-field">',
    '        <label for="billingName">Nome completo</label>',
    '        <input id="billingName" class="bg-input" type="text" autocomplete="name" placeholder="Como aparece no documento">',
    '      </div>',
    '      <div class="bg-field">',
    '        <label for="billingCpfCnpj">CPF ou CNPJ</label>',
    '        <input id="billingCpfCnpj" class="bg-input" type="text" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00">',
    '      </div>',
    '      <div id="billingCouponSection">',
    '        <button id="billingCouponToggle" type="button" class="bg-coupon-toggle"><i class="ph ph-tag"></i> Tem cupom de desconto?</button>',
    '        <div id="billingCouponBody" class="bg-coupon-body" style="display:none;">',
    '          <div id="billingCouponInputRow" class="bg-coupon-row">',
    '            <input id="billingCoupon" class="bg-input" type="text" autocomplete="off" placeholder="APP-XXXXXX">',
    '            <button id="billingCouponApply" type="button">Aplicar</button>',
    '          </div>',
    '          <div id="billingCouponApplied" class="bg-applied" style="display:none;margin-top:8px;"></div>',
    '          <div id="billingCouponMsg" style="font-size:12px;margin-top:6px;display:none;"></div>',
    '        </div>',
    '      </div>',
    '    </div>',
    '    <div id="billingCardFields">',
    '      <div class="bg-card-fields-head"><i class="ph-fill ph-credit-card"></i> Dados do cartão</div>',
    '      <div class="bg-field">',
    '        <label for="ccNumber">Número do cartão</label>',
    '        <input id="ccNumber" class="bg-input" type="text" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000">',
    '      </div>',
    '      <div class="bg-field-row">',
    '        <div class="bg-field"><label for="ccExp">Validade</label><input id="ccExp" class="bg-input" type="text" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AA"></div>',
    '        <div class="bg-field"><label for="ccCvv">CVV</label><input id="ccCvv" class="bg-input" type="text" inputmode="numeric" autocomplete="cc-csc" placeholder="000"></div>',
    '      </div>',
    '      <div class="bg-field">',
    '        <label for="ccHolder">Nome impresso no cartão</label>',
    '        <input id="ccHolder" class="bg-input" type="text" autocomplete="cc-name" placeholder="Como impresso no cartão">',
    '      </div>',
    '      <div class="bg-field-row">',
    '        <div class="bg-field"><label for="ccZip">CEP</label><input id="ccZip" class="bg-input" type="text" inputmode="numeric" autocomplete="postal-code" placeholder="00000-000"></div>',
    '        <div class="bg-field"><label for="ccAddrNum">Nº endereço</label><input id="ccAddrNum" class="bg-input" type="text" inputmode="numeric" placeholder="123"></div>',
    '      </div>',
    '      <div class="bg-field">',
    '        <label for="ccPhone">Telefone</label>',
    '        <input id="ccPhone" class="bg-input" type="tel" inputmode="tel" autocomplete="tel" placeholder="(00) 00000-0000">',
    '      </div>',
    '    </div>',
    '    <div id="billingErr" class="bg-err" style="display:none;"><i class="ph-fill ph-warning-circle"></i><span></span></div>',
    '  </div>',
    '  <div class="bg-summary">',
    '    <div id="billingSummaryRowDiscount" class="bg-summary-row bg-summary-discount" style="display:none;">',
    '      <span id="billingSummaryDiscountLabel">Cupom de desconto</span>',
    '      <span id="billingSummaryDiscountValue">— R$ 0,00</span>',
    '    </div>',
    '    <div class="bg-summary-total">',
    '      <span id="billingSummaryLabel">Total mensal</span>',
    '      <strong id="billingSummaryTotal">R$ 15,00</strong>',
    '    </div>',
    '    <button id="billingSubscribeBtn" type="button" class="bg-cta"><i class="ph-fill ph-lock-simple"></i> <span>Pagar com segurança</span></button>',
    '    <div class="bg-trust">',
    '      <span><i class="ph-fill ph-shield-check"></i> Pagamento seguro</span>',
    '      <span><i class="ph ph-buildings"></i> Processado pela Asaas</span>',
    '    </div>',
    '  </div>',
    '  <div class="bg-footer">',
    '    <button id="billingRefreshBtn" type="button" class="bg-link">Já paguei — verificar status</button>',
    '    <button id="billingLogoutBtn" type="button" class="bg-link bg-link-muted">Sair desta conta</button>',
    '  </div>',
    '</div>',
  ].join('');
  document.body.appendChild(div);
  div.style.display = 'none';

  var couponToggle = $('billingCouponToggle');
  if (couponToggle) {
    couponToggle.addEventListener('click', function () {
      var body = $('billingCouponBody');
      if (!body) return;
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      couponToggle.innerHTML = open
        ? '<i class="ph ph-tag"></i> Tem cupom de desconto?'
        : '<i class="ph ph-tag"></i> Ocultar cupom';
      if (!open) {
        try {
          $('billingCoupon').focus();
        } catch (_) {}
      }
    });
  }

  selectedMethod = 'CREDIT_CARD';
  selectedBillingMode = 'subscription';
  $('billingTabCard').addEventListener('click', function () {
    setMethod('CREDIT_CARD');
  });
  $('billingTabPix').addEventListener('click', function () {
    setMethod('UNDEFINED');
  });
  $('billingModeSub').addEventListener('click', function () {
    setBillingMode('subscription');
  });
  $('billingModeOnce').addEventListener('click', function () {
    setBillingMode('one_shot');
  });
  $('billingSubscribeBtn').addEventListener('click', subscribe);
  $('billingCouponApply').addEventListener('click', applyCoupon);
  $('billingCoupon').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyCoupon();
    }
  });
  $('billingRefreshBtn').addEventListener('click', function () {
    refresh(true);
  });
  $('billingLogoutBtn').addEventListener('click', function () {
    try {
      window.AppliqueiFirebase.auth.signOut();
    } catch (_) {}
  });
}

var selectedMethod = 'CREDIT_CARD';
var selectedBillingMode = 'subscription'; // 'subscription' | 'one_shot'

function ctaText() {
  var p = priceLabel();
  if (selectedBillingMode === 'one_shot') {
    return selectedMethod === 'CREDIT_CARD'
      ? 'Pagar ' + p + ' • 30 dias'
      : 'Gerar fatura única • ' + p;
  }
  return selectedMethod === 'CREDIT_CARD'
    ? 'Assinar por ' + p + '/mês'
    : 'Gerar fatura • ' + p + '/mês';
}

function methodHintText() {
  if (selectedBillingMode === 'one_shot') {
    return selectedMethod === 'CREDIT_CARD'
      ? 'Cobrança única no cartão. Sem renovação automática.'
      : 'PIX ou boleto avulso — válido por 30 dias.';
  }
  return selectedMethod === 'CREDIT_CARD'
    ? 'Cartão cobrado automaticamente todo mês.'
    : 'PIX ou boleto — fatura nova todo mês.';
}

function setMethod(m) {
  selectedMethod = m;
  var card = $('billingTabCard');
  var pix = $('billingTabPix');
  var fields = $('billingCardFields');
  var label = $('billingMethodLabel');
  var btn = $('billingSubscribeBtn');
  var btnLabel = btn && btn.querySelector('span');
  if (card) card.setAttribute('aria-checked', m === 'CREDIT_CARD' ? 'true' : 'false');
  if (pix) pix.setAttribute('aria-checked', m === 'CREDIT_CARD' ? 'false' : 'true');
  if (fields) fields.style.display = m === 'CREDIT_CARD' ? '' : 'none';
  if (label) label.textContent = methodHintText();
  if (btnLabel) btnLabel.textContent = ctaText();
  else if (btn) btn.textContent = ctaText();
}

function setBillingMode(mode) {
  selectedBillingMode = mode;
  var sub = $('billingModeSub');
  var once = $('billingModeOnce');
  var hint = $('billingModeHint');
  var label = $('billingMethodLabel');
  var btn = $('billingSubscribeBtn');
  var btnLabel = btn && btn.querySelector('span');
  if (sub) sub.setAttribute('aria-checked', mode === 'subscription' ? 'true' : 'false');
  if (once) once.setAttribute('aria-checked', mode === 'subscription' ? 'false' : 'true');
  if (hint)
    hint.textContent =
      mode === 'subscription'
        ? 'Renovação automática. Cancele quando quiser.'
        : 'Pagamento único de 30 dias. Avisamos antes do vencimento.';
  if (label) label.textContent = methodHintText();
  if (btnLabel) btnLabel.textContent = ctaText();
  else if (btn) btn.textContent = ctaText();
  // Atualiza o card de resumo (label "Total mensal" vs "Total (1 mês)").
  if (typeof updateGatePrices === 'function') {
    // Evita recursão infinita: updateGatePrices chama setMethod, que NÃO
    // chama updateGatePrices. setBillingMode pode chamar com segurança.
    try {
      updateGatePrices();
    } catch (_) {}
  }
}

// Estado do gate observado por gateGuard(). Quando true, o
// MutationObserver re-aplica display:block / re-insere o elemento se
// o cliente tentar removê-lo via DevTools / userscript.
var gateLocked = false;
var gateUpdating = false;
var gateObserver = null;

function showGate(title, sub) {
  ensureGate();
  $('billingTitle').textContent = title;
  $('billingSub').textContent = sub;
  $('billingErr').style.display = 'none';
  gateUpdating = true;
  $('billingGate').style.display = 'block';
  document.body.style.overflow = 'hidden';
  gateUpdating = false;
  gateLocked = true;
  startGateGuard();
  // Sincroniza preço/desconto com lastBilling sempre que o gate aparece.
  // Sem isto, entradas que pulam o updateGatePrices em applyAccess (trial
  // banner → openSubscribeForm) mostravam o R$ 15,00 estático do template
  // ignorando o cupom já aplicado.
  updateGatePrices();
}
function hideGate() {
  gateLocked = false;
  stopGateGuard();
  var g = $('billingGate');
  if (!g) return;
  gateUpdating = true;
  g.style.display = 'none';
  document.body.style.overflow = '';
  gateUpdating = false;
}

// Defesa em profundidade: se algum script externo (extensão, console,
// userscript) remover o elemento ou setar display:none enquanto o gate
// deveria estar ativo, restauramos. Não impede um atacante determinado
// — toda defesa client-side é contornável — mas eleva o esforço acima
// do "uma linha no console". A barreira real é firestore.rules e o
// /api/sync/push rejeitarem dados de conta bloqueada.
function startGateGuard() {
  if (gateObserver || typeof MutationObserver !== 'function') return;
  try {
    gateObserver = new MutationObserver(function (mutations) {
      if (!gateLocked || gateUpdating) return;
      var g = $('billingGate');
      // Removido do DOM → re-injeta e re-aplica os textos atuais.
      if (!g) {
        var title = (lastAccess && titleForAccess(lastAccess)) || 'Assinatura necessária';
        var sub =
          (lastAccess && subForAccess(lastAccess)) ||
          'O acesso à plataforma requer uma assinatura ativa.';
        ensureGate();
        $('billingTitle').textContent = title;
        $('billingSub').textContent = sub;
        gateUpdating = true;
        $('billingGate').style.display = 'block';
        document.body.style.overflow = 'hidden';
        gateUpdating = false;
        return;
      }
      // Display foi forçado para none / hidden — restaura.
      if (g.style.display !== 'block') {
        gateUpdating = true;
        g.style.display = 'block';
        gateUpdating = false;
      }
      if (document.body.style.overflow !== 'hidden') {
        gateUpdating = true;
        document.body.style.overflow = 'hidden';
        gateUpdating = false;
      }
    });
    gateObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    });
  } catch (_) {
    gateObserver = null;
  }
}
function stopGateGuard() {
  if (gateObserver) {
    try {
      gateObserver.disconnect();
    } catch (_) {}
    gateObserver = null;
  }
}
// Textos canônicos por reason — duplica o switch de applyAccess para
// que o guard possa reaplicar sem reentrar em applyAccess (que faria
// efeitos colaterais de polling/banners).
function titleForAccess(a) {
  if (a.status === 'pending_payment')
    return a.reason === 'risk_analysis'
      ? 'Cartão em análise'
      : 'Aguardando confirmação de pagamento';
  if (a.reason === 'overdue') return 'Assinatura em atraso';
  if (a.reason === 'card_reproved') return 'Cartão recusado';
  if (a.reason === 'chargeback') return 'Chargeback em curso';
  if (a.reason === 'cancelled') return 'Assinatura cancelada';
  if (a.reason === 'trial_expired') return 'Avaliação gratuita terminou';
  return 'Assinatura necessária';
}
function subForAccess(a) {
  if (a.status === 'pending_payment') {
    return a.reason === 'risk_analysis'
      ? 'O Asaas está a verificar este pagamento. Aguarde alguns minutos — actualizamos automaticamente.'
      : 'A sua assinatura está ativa. Estamos a aguardar a confirmação do pagamento pela Asaas.';
  }
  if (a.reason === 'overdue')
    return 'Identificámos um pagamento em atraso. Troque o método de pagamento ou pague a fatura pendente.';
  if (a.reason === 'card_reproved')
    return 'O Asaas recusou a cobrança no cartão. Tente outro cartão ou outra forma de pagamento.';
  if (a.reason === 'chargeback')
    return 'Há um chargeback em curso para esta assinatura. Contacte o suporte para regularizar.';
  if (a.reason === 'cancelled')
    return 'A sua assinatura foi cancelada. Para voltar a usar a plataforma, crie uma nova assinatura.';
  if (a.reason === 'trial_expired')
    return 'Os seus 7 dias gratuitos terminaram. Assine para continuar a usar.';
  return 'O acesso à plataforma requer uma assinatura ativa.';
}
function showErr(msg) {
  ensureGate();
  var e = $('billingErr');
  if (!e) return;
  var span = e.querySelector('span');
  if (span) span.textContent = msg;
  else e.textContent = msg;
  e.style.display = 'flex';
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
  ['position', 'top', 'left', 'right', 'bottom', 'height', 'width', 'margin'].forEach(function (k) {
    body.style.removeProperty(k);
  });
}
// Banner pró-ativo de verificação de e-mail. Mostra ANTES de
// EMAIL_VERIFY_ENFORCE estar ligado, dando ao utilizador tempo de
// verificar voluntariamente. Tem prioridade sobre o trial banner
// (verificação é mais urgente).
function ensureVerifyBanner(show) {
  var b = $('verifyBanner');
  if (!show) {
    if (b) {
      b.remove();
    }
    return;
  }
  if (!b) {
    b = document.createElement('div');
    b.id = 'verifyBanner';
    b.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9001;background:#f59e0b;color:#1f2937;font-family:Figtree,sans-serif;font-size:13px;padding:8px 14px;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 6px rgba(0,0,0,.18);flex-wrap:wrap;';
    b.innerHTML =
      '<span style="display:flex;align-items:center;gap:6px;"><i class="ph-fill ph-envelope-simple" style="font-size:16px;"></i> <strong>Verifique seu e-mail</strong> para garantir o acesso. <span style="opacity:.85;font-weight:500;">Confira também a pasta de spam.</span></span>' +
      '<button type="button" id="verifyBannerBtn" style="background:#1f2937;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-weight:600;font-size:12px;cursor:pointer;">Reenviar e-mail</button>' +
      '<button type="button" id="verifyBannerCheckBtn" style="background:transparent;color:#1f2937;border:1px solid #1f2937;border-radius:6px;padding:4px 10px;font-weight:600;font-size:12px;cursor:pointer;">Já verifiquei</button>';
    document.body.appendChild(b);
    $('verifyBannerBtn').addEventListener('click', resendVerification);
    $('verifyBannerCheckBtn').addEventListener('click', recheckVerification);
    if (typeof ResizeObserver === 'function') {
      try {
        new ResizeObserver(function () {
          syncTrialBannerOffset(b);
        }).observe(b);
      } catch (_) {}
    }
    window.addEventListener('resize', function () {
      syncTrialBannerOffset(b);
    });
  }
  syncTrialBannerOffset(b);
}

async function resendVerification() {
  var btn = $('verifyBannerBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'A enviar…';
  }
  try {
    var fb = window.AppliqueiFirebase;
    var u = fb && fb.auth && fb.auth.currentUser;
    if (!u) throw new Error('not_authenticated');
    // Caminho principal: cliente Firebase dispara o e-mail nativo do
    // template padrão. continueUrl aponta para /app (e não para "/",
    // que agora é a landing) — após verificar, usuário volta ao app.
    await u.sendEmailVerification({ url: location.origin + '/app' });
    // Caminho secundário (best-effort): bate no /api/auth/resend-verification
    // pra rate-limit/log do lado do servidor. Ignora falha — o e-mail
    // primário já foi.
    try {
      await authedFetch('/../auth/resend-verification', { method: 'POST' });
    } catch (_) {}
    // Aviso ao usuário sobre spam (sender padrão noreply@*.firebaseapp.com
    // ainda cai como suspeito em vários provedores).
    try {
      if (typeof window.mostrarToast === 'function') {
        window.mostrarToast('E-mail reenviado. Confira também a caixa de spam.', 'sucesso', 8000);
      }
    } catch (_) {}
    // Cooldown 60s — Firebase Auth throttle server-side é ~1/min por user.
    // Antes ficava 4s e o usuário re-clicava esperando novo envio.
    startResendCooldown(btn, 60);
  } catch (e) {
    console.warn('[verify] resend failed', e && e.code, e && e.message);
    if (btn) {
      var msg = e && e.code === 'auth/too-many-requests' ? 'Aguarde — limite atingido.' : 'Erro';
      btn.textContent = msg;
      setTimeout(function () {
        btn.disabled = false;
        btn.textContent = 'Reenviar e-mail';
      }, 4000);
    }
  }
}

function startResendCooldown(btn, secs) {
  if (!btn) return;
  btn.disabled = true;
  var tick = function () {
    btn.textContent = 'Aguarde ' + secs + 's';
    if (secs <= 0) {
      btn.disabled = false;
      btn.textContent = 'Reenviar e-mail';
      return;
    }
    secs--;
    setTimeout(tick, 1000);
  };
  tick();
}

async function recheckVerification() {
  var btn = $('verifyBannerCheckBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'A verificar…';
  }
  try {
    var fb = window.AppliqueiFirebase;
    var u = fb && fb.auth && fb.auth.currentUser;
    if (!u) throw new Error('not_authenticated');
    await u.reload();
    if (u.emailVerified) {
      ensureVerifyBanner(false);
      try {
        await u.getIdToken(true);
      } catch (_) {} // força refresh do token
      await refresh(false);
    } else if (btn) {
      btn.textContent = 'Ainda não verificado';
      setTimeout(function () {
        btn.disabled = false;
        btn.textContent = 'Já verifiquei';
      }, 3000);
    }
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Já verifiquei';
    }
  }
}

function needsEmailVerification() {
  var fb = window.AppliqueiFirebase;
  var u = fb && fb.auth && fb.auth.currentUser;
  if (!u || !u.email) return false;
  // Só mostra para quem entrou via e-mail/senha — provedores OAuth
  // (Google) sempre vêm com emailVerified=true.
  var hasPasswordProvider =
    Array.isArray(u.providerData) &&
    u.providerData.some(function (p) {
      return p.providerId === 'password';
    });
  return hasPasswordProvider && !u.emailVerified;
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
    b.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9000;background:#059669;color:#fff;font-family:Figtree,sans-serif;font-size:13px;padding:8px 14px;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 6px rgba(0,0,0,.12);';
    b.innerHTML =
      '<span id="trialBannerText"></span><button type="button" id="trialBannerBtn" style="background:#fff;color:#059669;border:none;border-radius:6px;padding:5px 10px;font-weight:600;font-size:12px;cursor:pointer;">Assinar agora</button>';
    document.body.appendChild(b);
    $('trialBannerBtn').addEventListener('click', openSubscribeForm);
    if (typeof ResizeObserver === 'function') {
      try {
        new ResizeObserver(function () {
          syncTrialBannerOffset(b);
        }).observe(b);
      } catch (_) {}
    }
    window.addEventListener('resize', function () {
      syncTrialBannerOffset(b);
    });
  }
  var txt =
    daysLeft === 1
      ? 'Último dia da avaliação gratuita.'
      : 'Avaliação gratuita: ' + daysLeft + ' dias restantes.';
  $('trialBannerText').textContent = txt;
  syncTrialBannerOffset(b);
}

async function authedFetch(path, opts) {
  var fb = window.AppliqueiFirebase;
  var u = fb && fb.auth && fb.auth.currentUser;
  if (!u) throw new Error('not_authenticated');
  var token = await u.getIdToken();
  var r = await fetch(
    API + path,
    Object.assign({}, opts, {
      headers: Object.assign(
        {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        (opts && opts.headers) || {}
      ),
    })
  );
  var text = await r.text();
  var data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (parseErr) {
    // Resposta não-JSON (ex.: 404 do Vercel devolve HTML "The page
    // could not be found"). Erro genérico estruturado em vez do
    // críptico "Unexpected token 'T'" — mensagem útil pro usuário.
    var pe = new Error(
      r.status === 404
        ? 'Recurso indisponível no momento. Tente novamente em instantes.'
        : 'Resposta inválida do servidor. Atualize a página e tente outra vez.'
    );
    pe.detail = { error: 'invalid_response', status: r.status, body: text.slice(0, 200) };
    pe.code = 'invalid_response';
    throw pe;
  }
  if (!r.ok) {
    // Email não verificado: backend responde 403 email_not_verified quando
    // EMAIL_VERIFY_ENFORCE=true. Front delega o gate visual ao
    // onAuthStateChanged (que já força reload em emailVerified), aqui só
    // sinaliza o estado para quem chamou.
    if (r.status === 403 && data.error === 'email_not_verified') {
      try {
        await u.reload();
      } catch (_) {}
      // Se ainda não está verificado, lança erro estruturado.
      if (!u.emailVerified) {
        var ev = new Error('email_not_verified');
        ev.detail = data;
        ev.code = 'email_not_verified';
        throw ev;
      }
      // Caso raro: usuário verificou no meio do fetch. Retry com token fresh.
      var t2 = await u.getIdToken(true);
      var r2 = await fetch(
        API + path,
        Object.assign({}, opts, {
          headers: Object.assign(
            {
              Authorization: 'Bearer ' + t2,
              'Content-Type': 'application/json',
            },
            (opts && opts.headers) || {}
          ),
        })
      );
      var t2text = await r2.text();
      var t2data;
      try {
        t2data = t2text ? JSON.parse(t2text) : {};
      } catch (_) {
        t2data = { error: 'invalid_response' };
      }
      if (!r2.ok) {
        var e2 = new Error(t2data.error || 'http_' + r2.status);
        e2.detail = t2data;
        throw e2;
      }
      return t2data;
    }
    if (r.status === 429 && data.error === 'too_many_trials') {
      var rl = new Error('too_many_trials');
      rl.detail = data;
      rl.code = 'too_many_trials';
      throw rl;
    }
    var msg = data.error || 'http_' + r.status;
    if (data.code) msg += ' (' + data.code + ')';
    if (data.detail) msg += ': ' + data.detail;
    if (data.asaasErrors) {
      try {
        msg += ' — Asaas: ' + JSON.stringify(data.asaasErrors);
      } catch (_) {}
    }
    var err = new Error(msg);
    err.detail = data;
    throw err;
  }
  return data;
}

// Reasons "duras" que indicam ausência de direito de uso. Acionam o
// purge do cache local para que remover o modal via DevTools não dê
// acesso ao que foi sincronizado antes do bloqueio. NÃO inclui
// pending_payment (usuário acabou de assinar, está aguardando webhook).
var HARD_BLOCK_REASONS = {
  trial_expired: 1,
  overdue: 1,
  card_reproved: 1,
  chargeback: 1,
  cancelled: 1,
  refunded: 1,
  no_billing: 1,
};
function purgeLocalCacheIfBlocked(access) {
  if (!access || access.status !== 'blocked') return;
  if (!HARD_BLOCK_REASONS[access.reason]) return;
  try {
    if (
      window.AppliqueiCloudSync &&
      typeof window.AppliqueiCloudSync.purgeLocalCache === 'function'
    ) {
      window.AppliqueiCloudSync.purgeLocalCache();
    }
  } catch (_) {}
}

function applyAccess(access, billing) {
  lastAccess = access;
  if (billing !== undefined && billing !== null) lastBilling = billing;
  if (!access) return;
  purgeLocalCacheIfBlocked(access);
  // Verify banner tem prioridade sobre o trial. Quando os dois deveriam
  // aparecer ao mesmo tempo, mostra só o verify (mais urgente) e o usuário
  // ainda vê a info do trial dentro do modal Minha assinatura.
  var needVerify = needsEmailVerification();
  if (access.status === 'active') {
    hideGate();
    if (needVerify) {
      ensureTrialBanner(0);
      ensureVerifyBanner(true);
    } else {
      ensureVerifyBanner(false);
      ensureTrialBanner(0);
    }
    stopPolling();
    return;
  }
  if (access.status === 'trial') {
    hideGate();
    // U2: se o utilizador já assinou (subscriptionId existe e não é
    // INACTIVE) mas a primeira fatura ainda está PENDING, o backend
    // devolve trial — a cascata "active" do computeAccess exige
    // lastPaymentStatus pago. Mostrar "Assinar agora" aqui é enganoso:
    // a assinatura já está criada, só falta o webhook confirmar.
    // O hero de Minha assinatura já trata este caso ("Pagamento já em
    // curso · estamos a confirmar"); aqui apenas escondemos o banner.
    var hasPendingSub =
      lastBilling &&
      lastBilling.subscriptionId &&
      lastBilling.subscriptionStatus &&
      lastBilling.subscriptionStatus !== 'INACTIVE';
    if (hasPendingSub) {
      ensureTrialBanner(0);
      if (needVerify) ensureVerifyBanner(true);
      else ensureVerifyBanner(false);
      stopPolling();
      return;
    }
    if (needVerify) {
      ensureTrialBanner(0);
      ensureVerifyBanner(true);
    } else {
      ensureVerifyBanner(false);
      ensureTrialBanner(access.trialDaysLeft || 0);
    }
    stopPolling();
    return;
  }
  ensureVerifyBanner(false);
  ensureTrialBanner(0);
  if (access.status === 'pending_payment') {
    if (access.reason === 'risk_analysis') {
      showGate(
        'Cartão em análise',
        'O Asaas está a verificar este pagamento. Aguarde alguns minutos — actualizamos automaticamente.'
      );
    } else {
      showGate(
        'Aguardando confirmação de pagamento',
        'A sua assinatura está ativa. Estamos a aguardar a confirmação do pagamento pela Asaas.'
      );
    }
  } else if (access.reason === 'overdue') {
    showGate(
      'Assinatura em atraso',
      'Identificámos um pagamento em atraso. Troque o método de pagamento ou pague a fatura pendente.'
    );
  } else if (access.reason === 'card_reproved') {
    showGate(
      'Cartão recusado',
      'O Asaas recusou a cobrança no cartão. Tente outro cartão ou outra forma de pagamento.'
    );
  } else if (access.reason === 'chargeback') {
    showGate(
      'Chargeback em curso',
      'Há um chargeback em curso para esta assinatura. Contacte o suporte para regularizar.'
    );
  } else if (access.reason === 'cancelled') {
    showGate(
      'Assinatura cancelada',
      'A sua assinatura foi cancelada. Para voltar a usar a plataforma, crie uma nova assinatura.'
    );
  } else if (access.reason === 'trial_expired') {
    showGate(
      'Avaliação gratuita terminou',
      'Os seus 7 dias gratuitos terminaram. Assine para continuar a usar.'
    );
  } else {
    showGate('Assinatura necessária', 'O acesso à plataforma requer uma assinatura ativa.');
  }
  updateGatePrices();
  startPolling();
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(function () {
    refresh(false);
  }, POLL_MS);
}
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function initBilling() {
  var pending = '';
  try {
    pending = sessionStorage.getItem('appliquei_pending_referral') || '';
  } catch (_) {}
  var bodyObj = pending ? { referralCode: pending } : {};
  try {
    var r = await authedFetch('/init', { method: 'POST', body: JSON.stringify(bodyObj) });
    try {
      sessionStorage.removeItem('appliquei_pending_referral');
    } catch (_) {}
    applyAccess(r.access, r.billing);
  } catch (e) {
    console.warn('[billing] init', e);
    var refErr =
      e.detail &&
      (e.detail.error === 'invalid_referral_code' ||
        e.detail.error === 'referral_code_not_found' ||
        e.detail.error === 'self_referral_not_allowed');
    if (refErr && pending) {
      try {
        sessionStorage.removeItem('appliquei_pending_referral');
      } catch (_) {}
      try {
        var r2 = await authedFetch('/init', { method: 'POST', body: JSON.stringify({}) });
        applyAccess(r2.access, r2.billing);
        var msg =
          e.detail.error === 'self_referral_not_allowed'
            ? 'Não é possível usar o seu próprio cupom — a conta foi criada sem cupom.'
            : 'O cupom informado não foi encontrado — a conta foi criada sem cupom.';
        showErr(msg);
        return;
      } catch (e2) {
        console.warn('[billing] init retry', e2);
        showGate(
          'Não foi possível verificar a sua assinatura',
          'Tente novamente. Se persistir, contacte o suporte.'
        );
        showErr(e2.message || 'Erro de rede.');
        return;
      }
    }
    if (e.detail && e.detail.error === 'self_referral_not_allowed') {
      showGate('Cupom inválido', 'Não é possível usar o seu próprio cupom.');
    } else if (
      e.detail &&
      (e.detail.error === 'invalid_referral_code' || e.detail.error === 'referral_code_not_found')
    ) {
      showGate(
        'Cupom inválido',
        'O cupom informado não foi encontrado. Crie a conta sem cupom ou peça outro.'
      );
    } else {
      showGate(
        'Não foi possível verificar a sua assinatura',
        'Tente novamente. Se persistir, contacte o suporte.'
      );
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

// Validação CPF/CNPJ com dígito verificador. Espelha api/_lib/cpf-cnpj.js
// para falhar cedo no cliente antes de chegar ao Asaas.
function isValidCpf(c) {
  c = String(c || '').replace(/\D+/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  var s = 0,
    i;
  for (i = 0; i < 9; i++) s += parseInt(c[i], 10) * (10 - i);
  var d1 = (s * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(c[9], 10)) return false;
  s = 0;
  for (i = 0; i < 10; i++) s += parseInt(c[i], 10) * (11 - i);
  var d2 = (s * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(c[10], 10);
}
function isValidCnpj(c) {
  c = String(c || '').replace(/\D+/g, '');
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  var w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  var w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  var s = 0,
    i;
  for (i = 0; i < 12; i++) s += parseInt(c[i], 10) * w1[i];
  var d1 = s % 11;
  d1 = d1 < 2 ? 0 : 11 - d1;
  if (d1 !== parseInt(c[12], 10)) return false;
  s = 0;
  for (i = 0; i < 13; i++) s += parseInt(c[i], 10) * w2[i];
  var d2 = s % 11;
  d2 = d2 < 2 ? 0 : 11 - d2;
  return d2 === parseInt(c[13], 10);
}
function isValidCpfCnpj(v) {
  var c = String(v || '').replace(/\D+/g, '');
  if (c.length === 11) return isValidCpf(c);
  if (c.length === 14) return isValidCnpj(c);
  return false;
}

function ensureMyAccountStyles() {
  if ($('appliqueiMyAccountStyles')) return;
  var s = document.createElement('style');
  s.id = 'appliqueiMyAccountStyles';
  s.textContent = [
    // Backdrop em vidro: blur + tint escuro com gradiente sutil radial
    // (mesmo idiom da tela de pagamento) — sensação de overlay premium.
    '#myAccountModal{backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);background:radial-gradient(1200px 600px at 50% -10%, rgba(26,58,42,.45) 0%, transparent 60%), rgba(15,23,42,.62);}',
    // Shell: cantos amplos, sombra ampla com tint colorida, divisão clara entre head/body/foot.
    '#myAccountModal .ma-shell{width:100%;max-width:760px;background:#fff;border-radius:22px;box-shadow:0 30px 80px -20px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.04);color:#0f172a;font-family:Figtree,system-ui,-apple-system,Segoe UI,sans-serif;overflow:hidden;display:flex;flex-direction:column;max-height:calc(100vh - 48px);-webkit-font-smoothing:antialiased;}',
    '#myAccountModal .ma-head{display:flex;align-items:center;justify-content:space-between;padding:20px 26px;border-bottom:1px solid #f1f5f9;background:#fff;}',
    '#myAccountModal .ma-head h2{font-family:Syne,sans-serif;font-size:1.3rem;margin:0;letter-spacing:-.02em;font-weight:700;color:#0f172a;}',
    '#myAccountModal .ma-head .ma-close{border:none;background:transparent;cursor:pointer;width:34px;height:34px;line-height:1;color:#64748b;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-size:22px;transition:background .15s ease,color .15s ease;}',
    '#myAccountModal .ma-head .ma-close:hover{background:#f1f5f9;color:#0f172a;}',
    '#myAccountModal .ma-body{overflow-y:auto;padding:22px 26px 26px;background:#fafbfc;}',
    // Hero: gradients refinados com sombras tonais; cantos 16px; tipografia maior.
    '#myAccountModal .ma-hero{position:relative;padding:20px 22px;border-radius:16px;background:linear-gradient(135deg,#047857 0%,#059669 50%,#10b981 100%);color:#fff;box-shadow:0 12px 32px -8px rgba(5,150,105,.45),0 0 0 1px rgba(255,255,255,.06) inset;overflow:hidden;}',
    '#myAccountModal .ma-hero::after{content:"";position:absolute;inset:0;background:radial-gradient(600px 200px at 100% 0%, rgba(255,255,255,.12), transparent 60%);pointer-events:none;}',
    '#myAccountModal .ma-hero.is-trial{background:linear-gradient(135deg,#0369a1 0%,#0891b2 50%,#06b6d4 100%);box-shadow:0 12px 32px -8px rgba(8,145,178,.45),0 0 0 1px rgba(255,255,255,.06) inset;}',
    '#myAccountModal .ma-hero.is-blocked{background:linear-gradient(135deg,#b91c1c 0%,#dc2626 50%,#ef4444 100%);box-shadow:0 12px 32px -8px rgba(220,38,38,.45),0 0 0 1px rgba(255,255,255,.06) inset;}',
    '#myAccountModal .ma-hero.is-pending{background:linear-gradient(135deg,#a16207 0%,#ca8a04 50%,#eab308 100%);box-shadow:0 12px 32px -8px rgba(202,138,4,.45),0 0 0 1px rgba(255,255,255,.06) inset;}',
    '#myAccountModal .ma-hero.is-inactive{background:linear-gradient(135deg,#334155 0%,#475569 50%,#64748b 100%);box-shadow:0 12px 32px -8px rgba(71,85,105,.45),0 0 0 1px rgba(255,255,255,.06) inset;}',
    '#myAccountModal .ma-hero.is-oneshot{background:linear-gradient(135deg,#5b21b6 0%,#7c3aed 50%,#8b5cf6 100%);box-shadow:0 12px 32px -8px rgba(124,58,237,.45),0 0 0 1px rgba(255,255,255,.06) inset;}',
    '#myAccountModal .ma-hero > *{position:relative;z-index:1;}',
    '#myAccountModal .ma-hero-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:5px 11px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.22);border-radius:999px;backdrop-filter:blur(4px);}',
    '#myAccountModal .ma-hero-title{font-family:Syne,sans-serif;font-size:1.6rem;font-weight:700;margin:12px 0 5px;letter-spacing:-.02em;line-height:1.15;}',
    '#myAccountModal .ma-hero-sub{font-size:13.5px;line-height:1.55;color:rgba(255,255,255,.94);margin:0;}',
    '#myAccountModal .ma-hero-cta{display:inline-flex;align-items:center;justify-content:center;gap:7px;margin-top:16px;padding:11px 18px;background:#fff;color:#065f46;border:none;border-radius:11px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:.01em;box-shadow:0 4px 12px -2px rgba(0,0,0,.18);transition:transform .1s ease,box-shadow .15s ease;}',
    '#myAccountModal .ma-hero-cta:hover{box-shadow:0 6px 16px -2px rgba(0,0,0,.22);}',
    '#myAccountModal .ma-hero-cta:active{transform:translateY(1px);}',
    '#myAccountModal .ma-hero.is-trial .ma-hero-cta{color:#0369a1;}',
    '#myAccountModal .ma-hero.is-blocked .ma-hero-cta{color:#b91c1c;}',
    '#myAccountModal .ma-hero.is-pending .ma-hero-cta{color:#a16207;}',
    '#myAccountModal .ma-hero.is-inactive .ma-hero-cta{color:#334155;}',
    '#myAccountModal .ma-hero.is-oneshot .ma-hero-cta{color:#5b21b6;}',
    '#myAccountModal .ma-hero-bar{margin-top:16px;background:rgba(255,255,255,.2);border-radius:999px;height:8px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.1);}',
    '#myAccountModal .ma-hero-bar > span{display:block;height:100%;background:#fff;border-radius:999px;transition:width .6s ease;box-shadow:0 1px 2px rgba(0,0,0,.08);}',
    '#myAccountModal .ma-hero-meta{display:flex;justify-content:space-between;font-size:11.5px;color:rgba(255,255,255,.9);margin-top:7px;letter-spacing:.02em;font-weight:500;}',
    // Section spacing maior; título com letter-spacing maior — visual mais arejado.
    '#myAccountModal .ma-section{margin-top:24px;}',
    '#myAccountModal .ma-section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin:0 0 10px;display:flex;align-items:center;gap:7px;}',
    '#myAccountModal .ma-section-title i{color:#059669;font-size:13px;}',
    '#myAccountModal .ma-grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}',
    '#myAccountModal .ma-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}',
    // Cards: padding maior, border slate-200, hover lift sutil. Valores grandes em Syne.
    '#myAccountModal .ma-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:14px 16px;transition:border-color .15s ease,box-shadow .15s ease;}',
    '#myAccountModal .ma-card:hover{border-color:#cbd5e1;box-shadow:0 2px 6px rgba(15,23,42,.04);}',
    '#myAccountModal .ma-card-label{font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;}',
    '#myAccountModal .ma-card-value{font-family:Syne,sans-serif;font-size:20px;font-weight:700;color:#0f172a;margin-top:4px;line-height:1.2;letter-spacing:-.02em;}',
    '#myAccountModal .ma-card-foot{font-size:11.5px;color:#64748b;margin-top:5px;line-height:1.4;}',
    '#myAccountModal .ma-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.01em;}',
    '#myAccountModal .ma-badge.ok{background:#ecfdf5;color:#065f46;}',
    '#myAccountModal .ma-badge.warn{background:#fef3c7;color:#92400e;}',
    '#myAccountModal .ma-badge.bad{background:#fee2e2;color:#991b1b;}',
    '#myAccountModal .ma-badge.muted{background:#f1f5f9;color:#475569;}',
    // Rows: padding maior, ícone com leve sombra interna, hover state.
    '#myAccountModal .ma-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;transition:border-color .15s ease;}',
    '#myAccountModal .ma-row:hover{border-color:#cbd5e1;}',
    '#myAccountModal .ma-row + .ma-row{margin-top:8px;}',
    '#myAccountModal .ma-row-main{display:flex;align-items:center;gap:11px;min-width:0;flex:1;}',
    '#myAccountModal .ma-row-icon{flex:0 0 36px;height:36px;border-radius:10px;background:#ecfdf5;color:#065f46;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:inset 0 0 0 1px rgba(5,150,105,.1);}',
    '#myAccountModal .ma-row-text{font-size:13.5px;color:#0f172a;min-width:0;font-weight:600;line-height:1.35;}',
    '#myAccountModal .ma-row-text small{display:block;font-size:12px;color:#64748b;margin-top:2px;font-weight:500;}',
    '#myAccountModal .ma-row-action{flex:0 0 auto;}',
    // Buttons: ghost padrão; primary com gradient verde (alinhado com .bg-cta).
    '#myAccountModal .ma-btn{border:1.5px solid #e2e8f0;background:#fff;cursor:pointer;padding:8px 14px;border-radius:10px;font-size:12.5px;color:#334155;font-weight:600;font-family:inherit;transition:all .15s ease;display:inline-flex;align-items:center;justify-content:center;gap:5px;letter-spacing:.01em;}',
    '#myAccountModal .ma-btn:hover{background:#f8fafc;border-color:#cbd5e1;color:#0f172a;}',
    '#myAccountModal .ma-btn:active{transform:translateY(1px);}',
    '#myAccountModal .ma-btn-primary{border:none;background:linear-gradient(180deg,#10b981 0%,#059669 100%);color:#fff;box-shadow:0 2px 8px -1px rgba(5,150,105,.35),inset 0 1px 0 rgba(255,255,255,.18);padding:9px 16px;}',
    '#myAccountModal .ma-btn-primary:hover{background:linear-gradient(180deg,#10b981 0%,#047857 100%);color:#fff;border:none;box-shadow:0 4px 12px -2px rgba(5,150,105,.45),inset 0 1px 0 rgba(255,255,255,.18);}',
    '#myAccountModal .ma-btn-danger{border:none;background:#fff;color:#991b1b;text-decoration:none;padding:8px 14px;border-radius:10px;font-weight:600;font-size:12.5px;}',
    '#myAccountModal .ma-btn-danger:hover{background:#fef2f2;color:#7f1d1d;}',
    // Table: linha hover, mono digits, vertical padding maior.
    '#myAccountModal .ma-table{width:100%;font-size:12.5px;border-collapse:collapse;}',
    '#myAccountModal .ma-table th{font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;}',
    '#myAccountModal .ma-table td{padding:11px 10px;border-bottom:1px solid #f1f5f9;vertical-align:middle;color:#334155;font-size:13px;}',
    '#myAccountModal .ma-table tr:last-child td{border-bottom:none;}',
    '#myAccountModal .ma-table tr:hover td{background:#f8fafc;}',
    '#myAccountModal .ma-table .num{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:#0f172a;}',
    '#myAccountModal .ma-empty{padding:18px;text-align:center;color:#64748b;font-size:13px;background:#fff;border:1.5px dashed #e2e8f0;border-radius:12px;line-height:1.5;}',
    // Collapsible: visual mais limpo, chevron animado.
    '#myAccountModal .ma-collapsible{border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;background:#fff;transition:border-color .15s ease;}',
    '#myAccountModal .ma-collapsible:hover{border-color:#cbd5e1;}',
    '#myAccountModal .ma-collapsible > summary{cursor:pointer;list-style:none;padding:14px 16px;font-size:13px;font-weight:600;color:#0f172a;display:flex;align-items:center;justify-content:space-between;}',
    '#myAccountModal .ma-collapsible > summary::-webkit-details-marker{display:none;}',
    '#myAccountModal .ma-collapsible > summary::after{content:"\\25BE";color:#94a3b8;transition:transform .2s ease;font-size:14px;}',
    '#myAccountModal .ma-collapsible[open] > summary{border-bottom:1px solid #f1f5f9;}',
    '#myAccountModal .ma-collapsible[open] > summary::after{transform:rotate(180deg);color:#059669;}',
    '#myAccountModal .ma-collapsible > div{padding:14px 16px;}',
    // Alerts: borda mais marcada, ícone, fundo suave.
    '#myAccountModal .ma-alert{margin-top:16px;background:#fffbeb;border:1px solid #fde68a;color:#854d0e;border-radius:12px;padding:13px 15px;font-size:13px;line-height:1.5;display:flex;gap:9px;align-items:flex-start;}',
    '#myAccountModal .ma-alert.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}',
    '#myAccountModal .ma-alert i{flex-shrink:0;font-size:17px;margin-top:1px;}',
    // Foot mais limpo (sem fundo cinza, alinhado com o ma-body).
    '#myAccountModal .ma-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 26px;border-top:1px solid #f1f5f9;background:#fff;}',
    '#myAccountModal .ma-foot-link{font-size:12px;color:#64748b;display:inline-flex;align-items:center;gap:6px;}',
    '#myAccountModal .ma-foot-link i{color:#059669;}',
    '@media (max-width:560px){',
    '  #myAccountModal{padding:12px 8px;}',
    '  #myAccountModal .ma-shell{max-height:calc(100vh - 16px);border-radius:18px;}',
    '  #myAccountModal .ma-head{padding:16px 18px;}',
    '  #myAccountModal .ma-head h2{font-size:1.15rem;}',
    '  #myAccountModal .ma-body{padding:18px;}',
    '  #myAccountModal .ma-hero-title{font-size:1.35rem;}',
    '  #myAccountModal .ma-grid-2,#myAccountModal .ma-grid-3{grid-template-columns:1fr;}',
    '  #myAccountModal .ma-foot{padding:14px 18px;flex-wrap:wrap;}',
    '  #myAccountModal .ma-row{flex-wrap:wrap;}',
    '  #myAccountModal .ma-row-action{width:100%;}',
    '  #myAccountModal .ma-row-action .ma-btn{width:100%;}',
    '}',
  ].join('');
  document.head.appendChild(s);
}

function ensureMyAccountModal() {
  ensureMyAccountStyles();
  if ($('myAccountModal')) return;
  var div = document.createElement('div');
  div.id = 'myAccountModal';
  div.style.cssText =
    'position:fixed;inset:0;z-index:10070;display:none;align-items:center;justify-content:center;padding:24px 16px;background:rgba(15,23,42,.6);overflow-y:auto;';
  div.innerHTML =
    '\
      <div class="ma-shell" role="dialog" aria-modal="true" aria-labelledby="myAccountTitle">\
        <div class="ma-head">\
          <h2 id="myAccountTitle">Minha assinatura</h2>\
          <button type="button" id="myAccountClose" class="ma-close" aria-label="Fechar">&times;</button>\
        </div>\
        <div id="myAccountBody" class="ma-body">A carregar…</div>\
        <div class="ma-foot">\
          <span class="ma-foot-link"><i class="ph-fill ph-shield-check"></i> Cobranças processadas pela Asaas</span>\
          <button type="button" id="myAccountReload" class="ma-btn"><i class="ph ph-arrow-clockwise"></i> Atualizar</button>\
        </div>\
      </div>';
  document.body.appendChild(div);
  div.addEventListener('click', function (e) {
    if (e.target === div) closeMyAccount();
  });
  $('myAccountClose').addEventListener('click', closeMyAccount);
  $('myAccountReload').addEventListener('click', async function () {
    var btn = $('myAccountReload');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'A atualizar…';
    }
    try {
      var me = await fetchMe();
      renderMyAccount(me);
    } catch (e) {
      reportSwallowed(e, 'myAccountReload.fetchMe');
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Atualizar';
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('myAccountModal') && $('myAccountModal').style.display === 'flex')
      closeMyAccount();
  });
}
function closeMyAccount() {
  var m = $('myAccountModal');
  if (m) m.style.display = 'none';
}
async function openMyAccount() {
  ensureMyAccountModal();
  $('myAccountModal').style.display = 'flex';
  // Stale-while-revalidate: se já carregámos a tela alguma vez, mostramos
  // o último snapshot imediatamente e atualizamos em background. Evita o
  // "A carregar…" branco em ~todos os reopens.
  var hadCache = !!lastMe;
  if (hadCache) {
    renderMyAccount(lastMe);
    var reloadBtn = $('myAccountReload');
    if (reloadBtn) {
      reloadBtn.disabled = true;
      reloadBtn.textContent = 'A atualizar…';
    }
  } else {
    $('myAccountBody').innerHTML = '<div class="ma-empty">A carregar…</div>';
  }
  try {
    var me = await fetchMe();
    renderMyAccount(me);
    // U2: re-sincroniza o estado global do banner. /me devolve access
    // e billing fresh; sem isto, abrir Minha assinatura nunca corrige
    // um lastAccess perdido pelo race do kickstart (signup Google novo
    // em que onAuthStateChanged disparou com signupBlocked=true e
    // nenhuma das retries chegou a popular o banner).
    try {
      applyAccess(me.access, me);
    } catch (_) {
      reportSwallowed(_, 'openMyAccount.applyAccess');
    }
  } catch (e) {
    if (!hadCache) $('myAccountBody').textContent = 'Erro: ' + (e.message || 'tente mais tarde');
  } finally {
    var rb = $('myAccountReload');
    if (rb) {
      rb.disabled = false;
      rb.textContent = 'Atualizar';
    }
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
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch (_) {
    return iso;
  }
}
function paymentStatusLabel(s) {
  var map = {
    CONFIRMED: 'Confirmado',
    RECEIVED: 'Recebido',
    RECEIVED_IN_CASH: 'Recebido',
    PENDING: 'Pendente',
    OVERDUE: 'Atrasado',
    REFUNDED: 'Devolvido',
    DELETED: 'Cancelado',
    AWAITING_RISK_ANALYSIS: 'Em análise',
    APPROVED_BY_RISK_ANALYSIS: 'Aprovado',
    REPROVED_BY_RISK_ANALYSIS: 'Recusado',
    AUTHORIZED: 'Autorizado',
    CHARGEBACK_REQUESTED: 'Chargeback',
    CHARGEBACK_DISPUTE: 'Chargeback (em disputa)',
    REFUND_IN_PROGRESS: 'Reembolso em curso',
  };
  return map[s] || s || '—';
}
function statusBadge(status) {
  var cls = 'muted';
  if (
    status === 'CONFIRMED' ||
    status === 'RECEIVED' ||
    status === 'RECEIVED_IN_CASH' ||
    status === 'APPROVED_BY_RISK_ANALYSIS'
  )
    cls = 'ok';
  else if (status === 'PENDING' || status === 'AUTHORIZED' || status === 'AWAITING_RISK_ANALYSIS')
    cls = 'warn';
  else if (
    status === 'OVERDUE' ||
    status === 'REPROVED_BY_RISK_ANALYSIS' ||
    status === 'CHARGEBACK_REQUESTED' ||
    status === 'CHARGEBACK_DISPUTE'
  )
    cls = 'bad';
  return '<span class="ma-badge ' + cls + '">' + paymentStatusLabel(status) + '</span>';
}
function eventNote(p) {
  if (!p.event) return '';
  if (p.event === 'PAYMENT_DUNNING_REQUESTED' || p.event === 'PAYMENT_DUNNING_RECEIVED')
    return 'Re-cobrança automática';
  if (p.event === 'PAYMENT_REPROVED_BY_RISK_ANALYSIS') return 'Reprovado pela análise de risco';
  if (p.event === 'PAYMENT_AWAITING_RISK_ANALYSIS') return 'Aguardando análise de risco';
  if (p.event === 'PAYMENT_CHARGEBACK_REQUESTED') return 'Chargeback aberto';
  if (p.event === 'SYNC_CONFIRMED' || p.event === 'SYNC_RECEIVED') return 'Confirmado via sync';
  return '';
}
function cardBrandLabel(b) {
  if (!b) return '';
  var map = {
    VISA: 'Visa',
    MASTERCARD: 'Mastercard',
    AMEX: 'Amex',
    ELO: 'Elo',
    HIPERCARD: 'Hipercard',
    DINERS: 'Diners',
    DISCOVER: 'Discover',
  };
  return map[b] || b;
}
function paymentMethodLabel(m, brand, last4) {
  if (m === 'CREDIT_CARD') {
    var parts = ['Cartão recorrente'];
    if (brand) parts.push(cardBrandLabel(brand));
    if (last4) parts.push('•••• ' + last4);
    return parts.join(' · ');
  }
  if (m === 'UNDEFINED' || !m) return 'PIX ou boleto (fatura mensal)';
  return m;
}
function failureReasonLabel(r) {
  if (!r) return null;
  var map = {
    risk_analysis_reproved: 'Análise de risco reprovou o cartão',
    chargeback: 'Chargeback registado',
    card_reproved: 'Cartão recusado',
  };
  return map[r] || r;
}

function daysBetween(isoOrTs, now) {
  if (!isoOrTs) return null;
  var t;
  try {
    t = new Date(isoOrTs).getTime();
  } catch (_) {
    return null;
  }
  if (!t || isNaN(t)) return null;
  var diff = t - (now || Date.now());
  return Math.ceil(diff / 86400000);
}
function pluralDays(n) {
  return Math.abs(n) === 1 ? 'dia' : 'dias';
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function renderHeroBlock(me) {
  var access = me.access || {};
  var subStatus = me.subscriptionStatus;
  var hasSub = !!me.subscriptionId;
  var isInactive = subStatus === 'INACTIVE';
  var inTrial = access.status === 'trial';
  var trialEndsAt = me.trialEndsAt;
  var baseCents = me.subscriptionBaseValueCents || me.monthlyPriceCents || 1500;

  if (inTrial) {
    var totalDays = 7;
    var left = clamp(access.trialDaysLeft || daysBetween(trialEndsAt) || 0, 0, totalDays);
    var pct = clamp(((totalDays - left) / totalDays) * 100, 0, 100);
    var titleTxt =
      left <= 1
        ? 'Último dia da avaliação gratuita'
        : left + ' ' + pluralDays(left) + ' restantes na avaliação';
    var subTxt =
      'Sua avaliação gratuita termina em ' +
      fmtDate(trialEndsAt) +
      '. Garanta acesso contínuo assinando antes.';
    // "Pagamento em curso" só vale quando a sub realmente está aguardando
    // confirmação. Se a sub foi cancelada (INACTIVE) durante o trial,
    // mostrar isso seria mentir — oferecemos reativar.
    var cta;
    if (hasSub && !isInactive) {
      cta = 'Pagamento já em curso · estamos a confirmar';
    } else if (isInactive) {
      cta =
        '<button type="button" class="ma-hero-cta" data-act="reactivate"><i class="ph-fill ph-arrow-clockwise"></i> Assinatura cancelada · reative · ' +
        fmtBRL(baseCents) +
        '/mês</button>';
    } else {
      cta =
        '<button type="button" class="ma-hero-cta" data-act="subscribe-now"><i class="ph-fill ph-rocket-launch"></i> Assinar agora · ' +
        fmtBRL(baseCents) +
        '/mês</button>';
    }
    return (
      '<div class="ma-hero is-trial">' +
      '<span class="ma-hero-eyebrow"><i class="ph-fill ph-sparkle"></i> Avaliação gratuita</span>' +
      '<div class="ma-hero-title">' +
      titleTxt +
      '</div>' +
      '<p class="ma-hero-sub">' +
      subTxt +
      '</p>' +
      '<div class="ma-hero-bar"><span style="width:' +
      pct.toFixed(1) +
      '%;"></span></div>' +
      '<div class="ma-hero-meta"><span>Dia ' +
      (totalDays - left) +
      ' de ' +
      totalDays +
      '</span><span>Termina ' +
      fmtDate(trialEndsAt) +
      '</span></div>' +
      cta +
      '</div>'
    );
  }

  // Sub cancelada precisa cair no banner "Cancelada" mesmo quando o
  // backend devolve access.status='active' por causa do paid_period
  // (Fix 3). Caso contrário renderizaríamos "Renovação automática"
  // para alguém que acabou de cancelar.
  if (isInactive && access.status === 'active') {
    var paidUntilTxt = '';
    if (access.reason === 'paid_period' && me.lastPaidAt) {
      var paidMs = Date.parse(me.lastPaidAt);
      if (!isNaN(paidMs)) {
        var paidUntilMs = paidMs + 30 * 86400 * 1000;
        paidUntilTxt =
          ' Acesso garantido até ' + fmtDate(new Date(paidUntilMs).toISOString()) + '.';
      }
    }
    var cancelledTxt = me.cancelledAt
      ? 'Cancelada em ' +
        fmtDate(me.cancelledAt) +
        '.' +
        (paidUntilTxt || ' O acesso fica disponível até o fim do ciclo já pago.')
      : 'A sua assinatura está inativa.' + paidUntilTxt;
    return (
      '<div class="ma-hero is-inactive">' +
      '<span class="ma-hero-eyebrow"><i class="ph-fill ph-prohibit-inset"></i> Assinatura cancelada</span>' +
      '<div class="ma-hero-title">Reative quando quiser</div>' +
      '<p class="ma-hero-sub">' +
      cancelledTxt +
      ' Pode voltar a assinar nas mesmas condições — incluindo o desconto Applicash, se existir.</p>' +
      '<button type="button" class="ma-hero-cta" data-act="reactivate"><i class="ph-fill ph-rocket-launch"></i> Reativar assinatura · ' +
      fmtBRL(baseCents) +
      '/mês</button>' +
      '</div>'
    );
  }

  if (access.status === 'active') {
    // Avulso (one_shot): hero específico — sem "renovação automática".
    // Mostra a janela de 30 dias pagos como progress bar (dias decorridos).
    if (me.paymentMode === 'one_shot') {
      var daysLeftOnce =
        me.accessExpiresInDays != null ? me.accessExpiresInDays : daysBetween(me.accessExpiresAt);
      var dpctOnce =
        daysLeftOnce != null ? clamp(((30 - clamp(daysLeftOnce, 0, 30)) / 30) * 100, 0, 100) : 0;
      var expiresFmt = me.accessExpiresAt ? fmtDate(me.accessExpiresAt) : '—';
      var dleftLabel =
        daysLeftOnce != null
          ? daysLeftOnce <= 0
            ? 'expirou'
            : daysLeftOnce + ' ' + pluralDays(daysLeftOnce) + ' restantes'
          : '—';
      return (
        '<div class="ma-hero is-oneshot">' +
        '<span class="ma-hero-eyebrow"><i class="ph-fill ph-ticket"></i> Acesso avulso</span>' +
        '<div class="ma-hero-title">Acesso até ' +
        expiresFmt +
        '</div>' +
        '<p class="ma-hero-sub">Pagamento único de ' +
        fmtBRL(baseCents) +
        ' · sem renovação automática. Avisamos quando estiver próximo do fim.</p>' +
        '<div class="ma-hero-bar"><span style="width:' +
        dpctOnce.toFixed(1) +
        '%;"></span></div>' +
        '<div class="ma-hero-meta"><span>Janela de 30 dias</span><span>' +
        dleftLabel +
        '</span></div>' +
        '</div>'
      );
    }

    var nextCharge = (me.upcomingCharges && me.upcomingCharges[0]) || null;
    var nextDate = nextCharge ? nextCharge.date : me.nextDueDate;
    var dleft = daysBetween(nextDate);
    var dleftTxt =
      dleft != null ? (dleft <= 0 ? 'hoje' : 'em ' + dleft + ' ' + pluralDays(dleft)) : '—';
    var dpct = dleft != null ? clamp(((30 - clamp(dleft, 0, 30)) / 30) * 100, 0, 100) : 0;
    return (
      '<div class="ma-hero">' +
      '<span class="ma-hero-eyebrow"><i class="ph-fill ph-check-circle"></i> Assinatura ativa</span>' +
      '<div class="ma-hero-title">Appliquei Mensal · ' +
      fmtBRL(baseCents) +
      '<span style="font-size:.7em;font-weight:500;color:rgba(255,255,255,.85);">/mês</span></div>' +
      '<p class="ma-hero-sub">Próxima cobrança ' +
      dleftTxt +
      (nextDate ? ' (' + fmtDate(nextDate) + ')' : '') +
      '. Renovação automática.</p>' +
      '<div class="ma-hero-bar"><span style="width:' +
      dpct.toFixed(1) +
      '%;"></span></div>' +
      '<div class="ma-hero-meta"><span>Ciclo atual</span><span>' +
      (nextDate ? 'Renova ' + fmtDate(nextDate) : 'Renova mensalmente') +
      '</span></div>' +
      '</div>'
    );
  }

  if (access.status === 'pending_payment') {
    var pendTitle =
      access.reason === 'risk_analysis'
        ? 'Cartão em análise de risco'
        : 'Aguardando confirmação do pagamento';
    var pendSub =
      access.reason === 'risk_analysis'
        ? 'A Asaas está a validar a operação. Esta análise costuma demorar até alguns minutos — atualizamos sozinhos.'
        : 'Recebemos a sua assinatura. Estamos à espera da confirmação do pagamento pela Asaas.';
    return (
      '<div class="ma-hero is-pending">' +
      '<span class="ma-hero-eyebrow"><i class="ph-fill ph-clock-countdown"></i> Pagamento em processamento</span>' +
      '<div class="ma-hero-title">' +
      pendTitle +
      '</div>' +
      '<p class="ma-hero-sub">' +
      pendSub +
      '</p>' +
      '<button type="button" class="ma-hero-cta" data-act="reload-status"><i class="ph ph-arrow-clockwise"></i> Verificar status agora</button>' +
      '</div>'
    );
  }

  if (isInactive) {
    // Sub cancelada mas ainda dentro do ciclo pago (30 dias após
    // lastPaidAt). Mostra a data exata até quando o acesso vale.
    var paidUntilTxt = '';
    if (access.reason === 'paid_period' && me.lastPaidAt) {
      var paidMs = Date.parse(me.lastPaidAt);
      if (!isNaN(paidMs)) {
        var paidUntilMs = paidMs + 30 * 86400 * 1000;
        paidUntilTxt =
          ' Acesso garantido até ' + fmtDate(new Date(paidUntilMs).toISOString()) + '.';
      }
    }
    var cancelledTxt = me.cancelledAt
      ? 'Cancelada em ' +
        fmtDate(me.cancelledAt) +
        '.' +
        (paidUntilTxt || ' O acesso fica disponível até o fim do ciclo já pago.')
      : 'A sua assinatura está inativa.' + paidUntilTxt;
    return (
      '<div class="ma-hero is-inactive">' +
      '<span class="ma-hero-eyebrow"><i class="ph-fill ph-prohibit-inset"></i> Assinatura cancelada</span>' +
      '<div class="ma-hero-title">Reative quando quiser</div>' +
      '<p class="ma-hero-sub">' +
      cancelledTxt +
      ' Pode voltar a assinar nas mesmas condições — incluindo o desconto Applicash, se existir.</p>' +
      '<button type="button" class="ma-hero-cta" data-act="reactivate"><i class="ph-fill ph-rocket-launch"></i> Reativar assinatura · ' +
      fmtBRL(baseCents) +
      '/mês</button>' +
      '</div>'
    );
  }

  // blocked / overdue / chargeback / card_reproved
  var bTitle = 'Acesso bloqueado';
  var bSub = 'A sua assinatura precisa de regularização para continuar.';
  if (access.reason === 'overdue') {
    bTitle = 'Pagamento em atraso';
    bSub =
      'Identificámos uma fatura vencida. Troque o método de pagamento ou liquide a fatura pendente.';
  } else if (access.reason === 'card_reproved') {
    bTitle = 'Cartão recusado';
    bSub = 'A Asaas recusou a cobrança no cartão. Atualize os dados para retomar o acesso.';
  } else if (access.reason === 'chargeback') {
    bTitle = 'Chargeback em curso';
    bSub = 'Contacte o suporte para regularizar antes de criar uma nova cobrança.';
  } else if (access.reason === 'refunded') {
    bTitle = 'Pagamento estornado';
    bSub = 'O último pagamento foi estornado. Crie uma nova assinatura para continuar.';
  } else if (access.reason === 'trial_expired') {
    bTitle = 'Avaliação gratuita terminou';
    bSub = 'Os 7 dias gratuitos terminaram. Assine para continuar a usar a Appliquei.';
  }
  return (
    '<div class="ma-hero is-blocked">' +
    '<span class="ma-hero-eyebrow"><i class="ph-fill ph-warning"></i> ' +
    bTitle +
    '</span>' +
    '<div class="ma-hero-title">' +
    bTitle +
    '</div>' +
    '<p class="ma-hero-sub">' +
    bSub +
    '</p>' +
    (access.reason === 'overdue' || access.reason === 'card_reproved'
      ? '<button type="button" class="ma-hero-cta" data-act="change-card"><i class="ph-fill ph-credit-card"></i> Atualizar pagamento</button>'
      : '<button type="button" class="ma-hero-cta" data-act="reactivate"><i class="ph-fill ph-arrow-clockwise"></i> Regularizar agora</button>') +
    '</div>'
  );
}

function renderPlanInfoBlock(me) {
  var baseCents = me.subscriptionBaseValueCents || me.monthlyPriceCents || 1500;
  var listCents = me.monthlyPriceCents || 1500;
  var pct = me.recurringDiscountPercent || 0;
  var nextCents = me.projectedNextBillCents || baseCents;
  var nextCharge = (me.upcomingCharges && me.upcomingCharges[0]) || null;
  var nextDate = nextCharge ? nextCharge.date : me.nextDueDate;

  // Distinguir fatura ATUAL em aberto (PENDING/OVERDUE com cobrança real)
  // de uma simples previsão (FORECAST). O utilizador confunde "Próxima
  // fatura: 14/07" com "estou pago até 14/07", mesmo quando a fatura
  // corrente continua em aberto.
  var isOpenInvoice =
    nextCharge &&
    nextCharge.source === 'invoice' &&
    (nextCharge.status === 'PENDING' ||
      nextCharge.status === 'OVERDUE' ||
      nextCharge.status === 'AWAITING_RISK_ANALYSIS');
  var openCents = isOpenInvoice && nextCharge.amountCents ? nextCharge.amountCents : nextCents;
  var label = isOpenInvoice
    ? nextCharge.status === 'OVERDUE'
      ? 'Fatura em atraso'
      : 'Fatura em aberto'
    : 'Próxima fatura';
  var foot = '';
  if (isOpenInvoice) {
    var statusTxt = paymentStatusLabel(nextCharge.status);
    var badgeCls = nextCharge.status === 'OVERDUE' ? 'bad' : 'warn';
    foot =
      '<span class="ma-badge ' +
      badgeCls +
      '">' +
      statusTxt +
      '</span>' +
      ' · Vence ' +
      (nextDate ? fmtDate(nextDate) : '—');
  } else {
    foot = (nextDate ? fmtDate(nextDate) : '—') + (nextCents < baseCents ? ' · com Applicash' : '');
  }
  var payLink =
    isOpenInvoice && nextCharge.invoiceUrl
      ? '<a href="' +
        nextCharge.invoiceUrl +
        '" target="_blank" rel="noopener" class="ma-btn" style="margin-top:8px;text-decoration:none;display:inline-block;">Pagar agora</a>'
      : '';

  var isOneShot = me.paymentMode === 'one_shot';
  var rows = '';
  if (isOneShot) {
    var expiresFmt = me.accessExpiresAt ? fmtDate(me.accessExpiresAt) : '—';
    var daysLeft = me.accessExpiresInDays != null ? me.accessExpiresInDays : null;
    var daysFoot =
      daysLeft == null ? '' : daysLeft > 0 ? 'Faltam ' + daysLeft + ' dia(s)' : 'Expirado';
    rows +=
      '<div class="ma-card"><div class="ma-card-label">Plano ativo</div><div class="ma-card-value">Avulso</div><div class="ma-card-foot">Pagamento único de 30 dias</div></div>';
    rows +=
      '<div class="ma-card"><div class="ma-card-label">Valor pago</div><div class="ma-card-value">' +
      fmtBRL(baseCents) +
      '</div>' +
      (pct > 0
        ? '<div class="ma-card-foot"><span class="ma-badge ok">' +
          pct +
          '% off</span> de ' +
          fmtBRL(listCents) +
          '</div>'
        : '<div class="ma-card-foot">Sem desconto recorrente</div>') +
      '</div>';
    rows +=
      '<div class="ma-card"><div class="ma-card-label">Acesso até</div><div class="ma-card-value">' +
      expiresFmt +
      '</div><div class="ma-card-foot">' +
      daysFoot +
      '</div></div>';
  } else {
    rows +=
      '<div class="ma-card"><div class="ma-card-label">Plano ativo</div><div class="ma-card-value">Mensal</div><div class="ma-card-foot">Renovação automática</div></div>';
    rows +=
      '<div class="ma-card"><div class="ma-card-label">Valor base</div><div class="ma-card-value">' +
      fmtBRL(baseCents) +
      '<span style="font-family:Figtree,sans-serif;font-size:12px;font-weight:500;color:#64748b;letter-spacing:0;"> /mês</span></div>' +
      (pct > 0
        ? '<div class="ma-card-foot"><span class="ma-badge ok">' +
          pct +
          '% off</span> de ' +
          fmtBRL(listCents) +
          '</div>'
        : '<div class="ma-card-foot">Sem desconto recorrente</div>') +
      '</div>';
    rows +=
      '<div class="ma-card"><div class="ma-card-label">' +
      label +
      '</div><div class="ma-card-value">' +
      fmtBRL(openCents) +
      '</div><div class="ma-card-foot">' +
      foot +
      '</div>' +
      payLink +
      '</div>';
  }

  return (
    '<div class="ma-section">' +
    '<div class="ma-section-title"><i class="ph ph-receipt"></i> Plano</div>' +
    '<div class="ma-grid-3">' +
    rows +
    '</div>' +
    '</div>'
  );
}

function renderPlansBlock(me) {
  // Mostra Pro (atual) vs Pro+IA (em construção) também dentro do app.
  // Faz par com a landing — usuário descobre o roadmap sem sair do app.
  return (
    '<div class="ma-section">' +
    '<div class="ma-section-title"><i class="ph ph-stack"></i> Planos disponíveis</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
    '<div style="position:relative;border:1.5px solid #059669;background:linear-gradient(180deg,#f0fdf4 0%,#ecfdf5 100%);border-radius:14px;padding:16px;box-shadow:0 0 0 4px rgba(5,150,105,.06);">' +
    '<span style="position:absolute;top:-9px;right:14px;background:#059669;color:#fff;font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:999px;letter-spacing:.06em;text-transform:uppercase;">Atual</span>' +
    '<div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#047857;text-transform:uppercase;letter-spacing:.08em;"><i class="ph-fill ph-check-circle"></i> Pro</div>' +
    '<div style="font-family:Syne,sans-serif;font-weight:700;font-size:20px;margin-top:6px;letter-spacing:-.02em;color:#0f172a;">Acesso completo</div>' +
    '<p style="font-size:12.5px;color:#334155;margin:6px 0 12px;line-height:1.5;">Todas as 10 abas do Appliquei, Applicash e suporte por e-mail.</p>' +
    '<div style="display:flex;align-items:baseline;gap:4px;"><span style="font-family:Syne,sans-serif;font-weight:700;font-size:26px;letter-spacing:-.02em;color:#0f172a;">R$ 15</span><span style="font-size:12px;font-weight:500;color:#64748b;">/mês</span></div>' +
    '</div>' +
    '<div style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:14px;padding:16px;opacity:.95;">' +
    '<div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.08em;"><i class="ph ph-wrench"></i> Em construção</div>' +
    '<div style="font-family:Syne,sans-serif;font-weight:700;font-size:20px;margin-top:6px;letter-spacing:-.02em;color:#475569;">Pro + IA</div>' +
    '<p style="font-size:12.5px;color:#64748b;margin:6px 0 12px;line-height:1.5;">Diagnóstico, sugestões e chat com IA — em breve.</p>' +
    '<button type="button" class="ma-btn" disabled style="cursor:not-allowed;opacity:.6;width:100%;">Avise-me no lançamento</button>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function renderPaymentMethodBlock(me) {
  var hasSub = !!me.subscriptionId;
  var isInactive = me.subscriptionStatus === 'INACTIVE';
  if (!hasSub || isInactive) return '';
  var label = paymentMethodLabel(me.paymentMethod, me.cardBrand, me.cardLast4);
  var holder = me.cardHolderName
    ? '<small>Titular: ' + escapeHtml(me.cardHolderName) + '</small>'
    : '';
  var icon = me.paymentMethod === 'CREDIT_CARD' ? 'ph-fill ph-credit-card' : 'ph ph-qr-code';
  var btnTxt = me.paymentMethod === 'CREDIT_CARD' ? 'Trocar cartão' : 'Pagar com cartão';
  return (
    '<div class="ma-section">' +
    '<div class="ma-section-title"><i class="ph ph-wallet"></i> Método de pagamento</div>' +
    '<div class="ma-row">' +
    '<div class="ma-row-main">' +
    '<div class="ma-row-icon"><i class="' +
    icon +
    '"></i></div>' +
    '<div class="ma-row-text">' +
    label +
    holder +
    '</div>' +
    '</div>' +
    '<div class="ma-row-action"><button type="button" class="ma-btn" data-act="change-card">' +
    btnTxt +
    '</button></div>' +
    '</div>' +
    '</div>'
  );
}

function renderApplicashBlock(me) {
  var pending = me.pendingDiscountCents || 0;
  var earned = me.totalReferralEarningsCents || 0;
  var active = me.activeReferrals || 0;
  var total = me.totalReferrals || 0;
  var nextCents =
    me.projectedNextBillCents || me.subscriptionBaseValueCents || me.monthlyPriceCents || 1500;
  var baseCents = me.subscriptionBaseValueCents || me.monthlyPriceCents || 1500;
  var coverage = baseCents > 0 ? clamp((pending / baseCents) * 100, 0, 100) : 0;
  var code = me.referralCode || '—';

  var statCards =
    '<div class="ma-card"><div class="ma-card-label">Indicados ativos</div><div class="ma-card-value">' +
    active +
    '<span style="font-family:Figtree,sans-serif;font-size:12px;font-weight:500;color:#64748b;letter-spacing:0;"> / ' +
    total +
    '</span></div><div class="ma-card-foot">Pagantes neste momento</div></div>' +
    '<div class="ma-card"><div class="ma-card-label">Saldo a abater</div><div class="ma-card-value" style="color:#059669;">' +
    fmtBRL(pending) +
    '</div><div class="ma-card-foot">Aplicado na próxima fatura</div></div>' +
    '<div class="ma-card"><div class="ma-card-label">Ganhos totais</div><div class="ma-card-value">' +
    fmtBRL(earned) +
    '</div><div class="ma-card-foot">Acumulado desde o início</div></div>';

  var coverageBlock =
    pending > 0
      ? '<div class="ma-card" style="margin-top:10px;">' +
        '<div class="ma-card-label">Próxima fatura com Applicash</div>' +
        '<div style="display:flex;align-items:baseline;gap:6px;margin-top:4px;"><div class="ma-card-value">' +
        fmtBRL(nextCents) +
        '</div>' +
        '<div style="text-decoration:line-through;color:#9ca3af;font-size:12px;">' +
        fmtBRL(baseCents) +
        '</div></div>' +
        '<div style="margin-top:8px;background:#ecfdf5;border-radius:999px;height:8px;overflow:hidden;"><div style="width:' +
        coverage.toFixed(1) +
        '%;height:100%;background:linear-gradient(90deg,#059669,#10b981);"></div></div>' +
        '<div class="ma-card-foot" style="margin-top:6px;">Applicash cobre ' +
        coverage.toFixed(0) +
        '% da sua próxima cobrança</div>' +
        '</div>'
      : '';

  var codeRow =
    '<div class="ma-row" style="margin-top:10px;">' +
    '<div class="ma-row-main">' +
    '<div class="ma-row-icon" style="background:#fef3c7;color:#854d0e;"><i class="ph-fill ph-ticket"></i></div>' +
    '<div class="ma-row-text">Seu cupom <strong>' +
    escapeHtml(code) +
    '</strong><small>Cada indicado paga 10% menos · você recebe 10% do que ele paga, todo mês.</small></div>' +
    '</div>' +
    '<div class="ma-row-action"><button type="button" class="ma-btn" data-act="open-applicash">Ver Applicash</button></div>' +
    '</div>';

  return (
    '<div class="ma-section">' +
    '<div class="ma-section-title"><i class="ph-fill ph-currency-dollar"></i> Applicash · cashback</div>' +
    '<div class="ma-grid-3">' +
    statCards +
    '</div>' +
    coverageBlock +
    codeRow +
    '</div>'
  );
}

function renderUpcomingBlock(me) {
  var hasSub = !!me.subscriptionId;
  var isInactive = me.subscriptionStatus === 'INACTIVE';
  if (!hasSub || isInactive) return '';
  var charges = me.upcomingCharges || [];
  if (!charges.length) return '';
  var rows = charges
    .map(function (u) {
      var isForecast = u.source === 'forecast';
      var statusTxt = isForecast ? 'Previsto' : paymentStatusLabel(u.status);
      var badgeCls = 'muted';
      if (u.status === 'PENDING') badgeCls = 'warn';
      else if (u.status === 'OVERDUE') badgeCls = 'bad';
      var action = u.invoiceUrl
        ? '<a href="' +
          u.invoiceUrl +
          '" target="_blank" rel="noopener" class="ma-btn" style="text-decoration:none;display:inline-block;">Pagar</a>'
        : '<span style="color:#9ca3af;">—</span>';
      return (
        '<tr>' +
        '<td>' +
        fmtDate(u.date) +
        '</td>' +
        '<td class="num">' +
        fmtBRL(u.amountCents) +
        '</td>' +
        '<td><span class="ma-badge ' +
        badgeCls +
        '">' +
        statusTxt +
        '</span></td>' +
        '<td class="num">' +
        action +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
  return (
    '<div class="ma-section">' +
    '<div class="ma-section-title"><i class="ph ph-calendar-check"></i> Próximas cobranças</div>' +
    '<div style="border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;background:#fff;">' +
    '<table class="ma-table"><thead><tr><th>Data</th><th style="text-align:right;">Valor</th><th>Status</th><th></th></tr></thead><tbody>' +
    rows +
    '</tbody></table>' +
    '</div>' +
    '</div>'
  );
}

// Banner proativo de renovação para usuários avulsos (one_shot).
// Visual em "callout card" com ícone à esquerda e CTAs à direita.
// Critério: paymentMode 'one_shot' + ≤ 7 dias para expirar. Acima
// disso, o hero da Minha Conta já comunica a janela de 30 dias.
function renderRenewBanner(me) {
  if (me.paymentMode !== 'one_shot') return '';
  var days = me.accessExpiresInDays;
  if (days == null || days > 7) return '';
  var expiresFmt = me.accessExpiresAt ? fmtDate(me.accessExpiresAt) : '—';
  var title, sub, tone;
  if (days <= 0) {
    title = 'Seu acesso terminou';
    sub =
      'O pagamento de 30 dias venceu em ' + expiresFmt + '. Renove para voltar a usar o Appliquei.';
    tone = 'bad';
  } else if (days <= 3) {
    title = 'Faltam ' + days + ' ' + pluralDays(days) + ' para expirar';
    sub =
      'Renove agora para não perder o acesso em ' +
      expiresFmt +
      '. Você também pode trocar para assinatura mensal.';
    tone = 'urgent';
  } else {
    title = days + ' dias até o fim do ciclo';
    sub =
      'Seu acesso avulso expira em ' +
      expiresFmt +
      '. Renove no seu ritmo ou ative a renovação automática.';
    tone = 'warn';
  }
  var palette =
    tone === 'bad'
      ? {
          bg: 'linear-gradient(180deg,#fef2f2 0%,#fee2e2 100%)',
          border: '#fecaca',
          fg: '#991b1b',
          accent: '#dc2626',
          icon: 'ph-fill ph-warning-octagon',
        }
      : tone === 'urgent'
        ? {
            bg: 'linear-gradient(180deg,#fff7ed 0%,#ffedd5 100%)',
            border: '#fed7aa',
            fg: '#9a3412',
            accent: '#ea580c',
            icon: 'ph-fill ph-clock-countdown',
          }
        : {
            bg: 'linear-gradient(180deg,#fffbeb 0%,#fef3c7 100%)',
            border: '#fde68a',
            fg: '#92400e',
            accent: '#d97706',
            icon: 'ph-fill ph-clock',
          };
  var style =
    'margin-top:18px;padding:16px 18px;border-radius:16px;background:' +
    palette.bg +
    ';border:1px solid ' +
    palette.border +
    ';display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;';
  return (
    '<div style="' +
    style +
    '">' +
    '<div style="flex:0 0 44px;height:44px;border-radius:12px;background:' +
    palette.accent +
    ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 4px 10px -2px rgba(0,0,0,.15);">' +
    '<i class="' +
    palette.icon +
    '"></i></div>' +
    '<div style="flex:1;min-width:200px;">' +
    '<div style="font-family:Syne,sans-serif;font-weight:700;font-size:15px;color:' +
    palette.fg +
    ';letter-spacing:-.01em;">' +
    title +
    '</div>' +
    '<p style="font-size:12.5px;margin:4px 0 0;color:' +
    palette.fg +
    ';opacity:.85;line-height:1.5;">' +
    sub +
    '</p>' +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;flex:1 1 100%;margin-top:4px;">' +
    '<button type="button" class="ma-btn ma-btn-primary" data-act="renew-month">' +
    '<i class="ph-fill ph-arrow-clockwise"></i> Renovar 1 mês</button>' +
    '<button type="button" class="ma-btn" data-act="switch-to-subscription">' +
    '<i class="ph ph-arrows-clockwise"></i> Ativar renovação automática</button>' +
    '</div>' +
    '</div>'
  );
}

function renderAlertsBlock(me) {
  var failure = failureReasonLabel(me.lastFailureReason);
  var dunning = me.dunningRetryCount && me.dunningRetryCount > 0 ? me.dunningRetryCount : 0;
  if (!failure && !dunning) return '';
  var parts = [];
  if (failure) parts.push(failure);
  if (dunning) parts.push(dunning + ' tentativa(s) de re-cobrança automática');
  var cls = me.access && me.access.status === 'blocked' ? 'bad' : '';
  return (
    '<div class="ma-alert ' +
    cls +
    '"><strong><i class="ph-fill ph-warning"></i> Atenção:</strong> ' +
    parts.join(' · ') +
    '</div>'
  );
}

function renderCustomerBlock(me) {
  var c = me.customer || {};
  var lines = [];
  if (c.name) lines.push('<strong>' + escapeHtml(c.name) + '</strong>');
  if (c.cpfCnpj) lines.push(fmtCpfCnpj(c.cpfCnpj));
  if (c.email) lines.push(escapeHtml(c.email));
  if (c.phone) lines.push(fmtPhone(c.phone));
  if (c.address) {
    var addr = escapeHtml(c.address) + (c.addressNumber ? ', ' + escapeHtml(c.addressNumber) : '');
    if (c.city) addr += ' · ' + escapeHtml(c.city);
    if (c.state) addr += '/' + escapeHtml(c.state);
    lines.push('<span style="color:#64748b;font-size:12.5px;font-weight:500;">' + addr + '</span>');
  }
  var body = lines.length
    ? lines.join('<br>')
    : '<em style="color:#64748b;font-style:normal;">Sem dados — adicione para emitir faturas correctamente.</em>';
  return (
    '<div class="ma-section">' +
    '<div class="ma-section-title"><i class="ph ph-user-circle"></i> Dados de cobrança</div>' +
    '<div class="ma-row">' +
    '<div class="ma-row-main"><div class="ma-row-icon" style="background:#f1f5f9;color:#334155;box-shadow:inset 0 0 0 1px rgba(51,65,85,.1);"><i class="ph ph-identification-card"></i></div>' +
    '<div class="ma-row-text" style="line-height:1.55;">' +
    body +
    '</div></div>' +
    '<div class="ma-row-action"><button type="button" class="ma-btn" data-act="edit-customer"><i class="ph ph-pencil-simple"></i> Editar</button></div>' +
    '</div>' +
    '</div>'
  );
}

function renderHistoryBlock(me) {
  var payments = me.payments || [];
  if (!payments.length) {
    return (
      '<div class="ma-section">' +
      '<div class="ma-section-title"><i class="ph ph-clock-counter-clockwise"></i> Histórico</div>' +
      '<div class="ma-empty">Sem cobranças registadas até ao momento.</div>' +
      '</div>'
    );
  }
  var rows = payments
    .map(function (p) {
      var note = eventNote(p);
      var noteLine = note
        ? '<small style="display:block;font-size:11.5px;color:#64748b;margin-top:2px;font-weight:500;">' +
          note +
          '</small>'
        : '';
      var refLine =
        p.referralAppliedCents && p.referralAppliedCents > 0
          ? '<small style="display:block;font-size:11px;color:#059669;margin-top:2px;">−' +
            fmtBRL(p.referralAppliedCents) +
            ' Applicash</small>'
          : '';
      // Link mais útil por contexto:
      //  - Pago: comprovante (transactionReceiptUrl). Fallback: fatura.
      //  - Boleto pendente: PDF do boleto (bankSlipUrl).
      //  - Outros: página da fatura.
      var paid =
        p.status === 'CONFIRMED' || p.status === 'RECEIVED' || p.status === 'RECEIVED_IN_CASH';
      var linkUrl = null,
        linkLabel = null;
      if (paid && p.transactionReceiptUrl) {
        linkUrl = p.transactionReceiptUrl;
        linkLabel = 'Comprovante';
      } else if (p.billingType === 'BOLETO' && p.bankSlipUrl) {
        linkUrl = p.bankSlipUrl;
        linkLabel = 'Boleto PDF';
      } else if (p.invoiceUrl) {
        linkUrl = p.invoiceUrl;
        linkLabel = paid ? 'Fatura' : 'Pagar';
      }
      var actionCell = linkUrl
        ? '<a href="' +
          linkUrl +
          '" target="_blank" rel="noopener" class="ma-btn" style="text-decoration:none;display:inline-block;">' +
          linkLabel +
          '</a>'
        : '—';
      return (
        '<tr>' +
        '<td>' +
        fmtDate(p.paymentDate || p.dueDate || p.receivedAt) +
        noteLine +
        '</td>' +
        '<td>' +
        (p.billingType ? escapeHtml(String(p.billingType)) : '—') +
        '</td>' +
        '<td class="num">' +
        fmtBRL(Math.round((p.value || 0) * 100)) +
        refLine +
        '</td>' +
        '<td>' +
        statusBadge(p.status) +
        '</td>' +
        '<td class="num">' +
        actionCell +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
  return (
    '<div class="ma-section">' +
    '<details class="ma-collapsible"' +
    (payments.length <= 3 ? ' open' : '') +
    '>' +
    '<summary><span><i class="ph ph-clock-counter-clockwise"></i> Histórico (' +
    payments.length +
    ')</span></summary>' +
    '<div><table class="ma-table"><thead><tr><th>Data</th><th>Forma</th><th style="text-align:right;">Valor</th><th>Status</th><th></th></tr></thead><tbody>' +
    rows +
    '</tbody></table></div>' +
    '</details>' +
    '</div>'
  );
}

function renderActionsBlock(me) {
  var hasSub = !!me.subscriptionId;
  var isInactive = me.subscriptionStatus === 'INACTIVE';
  if (isInactive) return '';
  if (!hasSub) return '';
  return (
    '<div class="ma-section" style="display:flex;justify-content:flex-end;padding-top:8px;border-top:1px solid #e5e7eb;margin-top:24px;">' +
    '<button type="button" class="ma-btn ma-btn-danger" data-act="cancel-sub"><i class="ph ph-x-circle"></i> Cancelar assinatura</button>' +
    '</div>'
  );
}

function renderMyAccount(me) {
  lastMe = me;
  // Considera "billing inicializado" qualquer um destes: assinatura,
  // pagamento avulso registado, ou estado conhecido (trial/blocked/active
  // via paid_period). Sem isto, usuário one_shot ativo via paid_period
  // ficava na tela de "A inicializar…" mesmo com acesso liberado.
  var initialized =
    me &&
    (me.subscriptionId ||
      me.paymentMode === 'one_shot' ||
      me.lastPaidAt ||
      (me.access && me.access.status && me.access.status !== 'blocked' ? true : false) ||
      (me.access && (me.access.status === 'trial' || me.access.status === 'blocked')));
  if (!initialized) {
    $('myAccountBody').innerHTML =
      '<div class="ma-empty">A inicializar a sua conta… Atualize em instantes.</div>';
    return;
  }
  var html =
    renderHeroBlock(me) +
    renderRenewBanner(me) +
    renderAlertsBlock(me) +
    renderPlanInfoBlock(me) +
    renderPlansBlock(me) +
    renderApplicashBlock(me) +
    renderUpcomingBlock(me) +
    renderPaymentMethodBlock(me) +
    renderCustomerBlock(me) +
    renderHistoryBlock(me) +
    renderActionsBlock(me);
  $('myAccountBody').innerHTML = html;
  bindMyAccountActions();
}

var lastMe = null;
function bindMyAccountActions() {
  var body = $('myAccountBody');
  if (!body) return;
  var btns = body.querySelectorAll('[data-act]');
  for (var i = 0; i < btns.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-act');
        if (act === 'change-card') openChangeCardModal();
        else if (act === 'edit-customer') openEditCustomerModal();
        else if (act === 'cancel-sub') confirmCancelSubscription();
        else if (act === 'subscribe-now') {
          closeMyAccount();
          openSubscribeForm();
        } else if (act === 'reactivate') {
          closeMyAccount();
          openSubscribeForm();
        } else if (act === 'renew-month') {
          closeMyAccount();
          openSubscribeForm('one_shot');
        } else if (act === 'switch-to-subscription') {
          closeMyAccount();
          openSubscribeForm('subscription');
        } else if (act === 'reload-status') reloadAccountStatus(btn);
        else if (act === 'open-applicash') {
          closeMyAccount();
          try {
            if (typeof window.mudarAba === 'function')
              window.mudarAba(new Event('click'), 'applicash');
          } catch (_) {}
        }
      });
    })(btns[i]);
  }
}

async function reloadAccountStatus(btn) {
  if (btn) {
    btn.disabled = true;
    var prev = btn.innerHTML;
    btn.innerHTML = 'A verificar…';
  }
  try {
    await refresh(false);
    var me = await fetchMe();
    renderMyAccount(me);
  } catch (e) {
    reportSwallowed(e, 'reloadAccountStatus.refresh');
  }
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = prev || 'Verificar status agora';
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmtCpfCnpj(d) {
  d = String(d || '').replace(/\D+/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}
function fmtPhone(d) {
  d = String(d || '').replace(/\D+/g, '');
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return d;
}

// -------- Modais de gestão --------

function ensureSubModal() {
  if ($('subModal')) return;
  var div = document.createElement('div');
  div.id = 'subModal';
  div.style.cssText =
    'position:fixed;inset:0;z-index:10080;display:none;align-items:center;justify-content:center;padding:24px 16px;background:rgba(15,23,42,.6);overflow-y:auto;';
  div.innerHTML =
    '<div id="subModalCard" style="width:100%;max-width:460px;background:#fff;border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.3);padding:24px;color:#0b1410;font-family:Figtree,sans-serif;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
    '<h3 id="subModalTitle" style="font-family:Syne,sans-serif;font-size:1.1rem;margin:0;"></h3>' +
    '<button type="button" id="subModalClose" style="border:none;background:none;cursor:pointer;font-size:22px;color:#6b7d75;">&times;</button>' +
    '</div>' +
    '<div id="subModalBody" style="font-size:13.5px;color:#1d2a23;"></div>' +
    '</div>';
  document.body.appendChild(div);
  div.addEventListener('click', function (e) {
    if (e.target === div) closeSubModal();
  });
  $('subModalClose').addEventListener('click', closeSubModal);
}
function openSubModal(title, body) {
  ensureSubModal();
  $('subModalTitle').textContent = title;
  $('subModalBody').innerHTML = body;
  $('subModal').style.display = 'flex';
}
function closeSubModal() {
  var m = $('subModal');
  if (m) m.style.display = 'none';
}

function fld() {
  return 'width:100%;padding:9px 12px;font-size:13.5px;border:1px solid #d4dad7;border-radius:8px;box-sizing:border-box;';
}
function lbl() {
  return 'display:block;font-size:11.5px;font-weight:600;color:#384a42;margin-bottom:3px;';
}

function openChangeCardModal() {
  var f = fld(),
    l = lbl();
  var html =
    '<div style="margin-bottom:10px;"><label style="' +
    l +
    '">Número do cartão</label><input id="mcNumber" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000" style="' +
    f +
    '"></div>' +
    '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
    '<div style="flex:1;"><label style="' +
    l +
    '">Validade</label><input id="mcExp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AA" style="' +
    f +
    '"></div>' +
    '<div style="flex:1;"><label style="' +
    l +
    '">CVV</label><input id="mcCvv" inputmode="numeric" autocomplete="cc-csc" placeholder="000" style="' +
    f +
    '"></div>' +
    '</div>' +
    '<div style="margin-bottom:10px;"><label style="' +
    l +
    '">Nome impresso</label><input id="mcHolder" autocomplete="cc-name" style="' +
    f +
    '"></div>' +
    '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
    '<div style="flex:1;"><label style="' +
    l +
    '">CEP</label><input id="mcZip" inputmode="numeric" autocomplete="postal-code" style="' +
    f +
    '"></div>' +
    '<div style="flex:1;"><label style="' +
    l +
    '">Nº endereço</label><input id="mcAddrNum" inputmode="numeric" style="' +
    f +
    '"></div>' +
    '</div>' +
    '<div style="margin-bottom:10px;"><label style="' +
    l +
    '">Telefone</label><input id="mcPhone" type="tel" inputmode="tel" style="' +
    f +
    '"></div>' +
    '<div id="mcErr" style="display:none;font-size:12px;color:#7f1d1d;background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:8px 10px;margin-bottom:10px;"></div>' +
    '<button id="mcSubmit" type="button" style="width:100%;border:none;cursor:pointer;padding:11px 14px;border-radius:10px;font-size:13.5px;font-weight:600;background:#059669;color:#fff;">Confirmar novo cartão</button>' +
    '<p style="margin:10px 0 0;font-size:11.5px;color:#6b7d75;">As faturas pendentes serão re-cobradas no novo cartão imediatamente.</p>';
  openSubModal('Trocar cartão', html);
  $('mcSubmit').addEventListener('click', submitChangeCard);
}

function showSubModalErr(id, msg) {
  var e = $(id);
  if (!e) return;
  e.textContent = msg;
  e.style.display = 'block';
}

async function submitChangeCard() {
  var num = ($('mcNumber') || {}).value || '';
  var exp = parseExpiry(($('mcExp') || {}).value);
  var cvv = (($('mcCvv') || {}).value || '').replace(/\D+/g, '');
  var holder = (($('mcHolder') || {}).value || '').trim();
  var zip = (($('mcZip') || {}).value || '').replace(/\D+/g, '');
  var addrNum = (($('mcAddrNum') || {}).value || '').replace(/\D+/g, '');
  var phone = (($('mcPhone') || {}).value || '').replace(/\D+/g, '');
  var digits = num.replace(/\D+/g, '');
  if (digits.length < 13 || digits.length > 19)
    return showSubModalErr('mcErr', 'Número do cartão inválido.');
  if (!exp) return showSubModalErr('mcErr', 'Validade inválida (MM/AA).');
  if (exp.expired)
    return showSubModalErr('mcErr', 'Este cartão já está expirado. Use um cartão válido.');
  if (cvv.length < 3) return showSubModalErr('mcErr', 'CVV inválido.');
  if (holder.length < 3) return showSubModalErr('mcErr', 'Nome impresso obrigatório.');
  if (zip.length !== 8) return showSubModalErr('mcErr', 'CEP inválido.');
  if (!addrNum) return showSubModalErr('mcErr', 'Número do endereço obrigatório.');
  if (phone.length < 10) return showSubModalErr('mcErr', 'Telefone inválido.');

  var btn = $('mcSubmit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'A enviar…';
  }
  try {
    var c = (lastMe && lastMe.customer) || {};
    var cpfCnpj = (c.cpfCnpj || '').replace(/\D+/g, '');
    if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
      showSubModalErr('mcErr', 'CPF/CNPJ ausente nos dados de cobrança. Edite os dados primeiro.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Confirmar novo cartão';
      }
      return;
    }
    if (!isValidCpfCnpj(cpfCnpj)) {
      showSubModalErr('mcErr', 'CPF/CNPJ inválido nos dados de cobrança. Edite os dados primeiro.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Confirmar novo cartão';
      }
      return;
    }
    var fb = window.AppliqueiFirebase;
    var userEmail =
      (fb && fb.auth && fb.auth.currentUser && fb.auth.currentUser.email) || c.email || null;
    await authedFetch('/card', {
      method: 'POST',
      body: JSON.stringify({
        creditCard: {
          holderName: holder,
          number: digits,
          expiryMonth: exp.expiryMonth,
          expiryYear: exp.expiryYear,
          ccv: cvv,
        },
        creditCardHolderInfo: {
          name: c.name || holder,
          email: userEmail,
          cpfCnpj: cpfCnpj,
          postalCode: zip,
          addressNumber: addrNum,
          phone: phone,
        },
      }),
    });
    closeSubModal();
    var me = await fetchMe();
    renderMyAccount(me);
    refresh(false);
  } catch (e) {
    console.warn('[billing] change card', e, e.detail);
    showSubModalErr('mcErr', e.message || 'Falha ao actualizar cartão.');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Confirmar novo cartão';
    }
  }
}

function openEditCustomerModal() {
  var c = (lastMe && lastMe.customer) || {};
  var f = fld(),
    l = lbl();
  var html =
    '<div style="margin-bottom:10px;"><label style="' +
    l +
    '">Nome completo</label><input id="ecName" autocomplete="name" value="' +
    escapeHtml(c.name || '') +
    '" style="' +
    f +
    '"></div>' +
    '<div style="margin-bottom:10px;"><label style="' +
    l +
    '">E-mail</label><input id="ecEmail" type="email" autocomplete="email" value="' +
    escapeHtml(c.email || '') +
    '" style="' +
    f +
    '"></div>' +
    '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
    '<div style="flex:2;"><label style="' +
    l +
    '">CPF / CNPJ</label><input id="ecCpf" inputmode="numeric" value="' +
    escapeHtml(c.cpfCnpj || '') +
    '" style="' +
    f +
    '"></div>' +
    '<div style="flex:2;"><label style="' +
    l +
    '">Telefone</label><input id="ecPhone" type="tel" inputmode="tel" value="' +
    escapeHtml(c.phone || '') +
    '" style="' +
    f +
    '"></div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
    '<div style="flex:1;"><label style="' +
    l +
    '">CEP</label><input id="ecZip" inputmode="numeric" value="' +
    escapeHtml(c.postalCode || '') +
    '" style="' +
    f +
    '"></div>' +
    '<div style="flex:2;"><label style="' +
    l +
    '">Endereço</label><input id="ecAddr" value="' +
    escapeHtml(c.address || '') +
    '" style="' +
    f +
    '"></div>' +
    '<div style="flex:1;"><label style="' +
    l +
    '">Nº</label><input id="ecNum" inputmode="numeric" value="' +
    escapeHtml(c.addressNumber || '') +
    '" style="' +
    f +
    '"></div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
    '<div style="flex:1;"><label style="' +
    l +
    '">Complemento</label><input id="ecCompl" value="' +
    escapeHtml(c.complement || '') +
    '" style="' +
    f +
    '"></div>' +
    '<div style="flex:1;"><label style="' +
    l +
    '">Bairro</label><input id="ecProv" value="' +
    escapeHtml(c.province || '') +
    '" style="' +
    f +
    '"></div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
    '<div style="flex:2;"><label style="' +
    l +
    '">Cidade</label><input id="ecCity" value="' +
    escapeHtml(c.city || '') +
    '" style="' +
    f +
    '"></div>' +
    '<div style="flex:1;"><label style="' +
    l +
    '">UF</label><input id="ecState" maxlength="2" value="' +
    escapeHtml(c.state || '') +
    '" style="' +
    f +
    '"></div>' +
    '</div>' +
    '<div id="ecErr" style="display:none;font-size:12px;color:#7f1d1d;background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:8px 10px;margin-bottom:10px;"></div>' +
    '<button id="ecSubmit" type="button" style="width:100%;border:none;cursor:pointer;padding:11px 14px;border-radius:10px;font-size:13.5px;font-weight:600;background:#059669;color:#fff;">Guardar alterações</button>';
  openSubModal('Editar dados de cobrança', html);
  $('ecSubmit').addEventListener('click', submitEditCustomer);
}

async function submitEditCustomer() {
  var name = (($('ecName') || {}).value || '').trim();
  var email = (($('ecEmail') || {}).value || '').trim();
  var cpf = (($('ecCpf') || {}).value || '').replace(/\D+/g, '');
  var phone = (($('ecPhone') || {}).value || '').replace(/\D+/g, '');
  var zip = (($('ecZip') || {}).value || '').replace(/\D+/g, '');
  var addr = (($('ecAddr') || {}).value || '').trim();
  var num = (($('ecNum') || {}).value || '').trim();
  var compl = (($('ecCompl') || {}).value || '').trim();
  var prov = (($('ecProv') || {}).value || '').trim();
  var city = (($('ecCity') || {}).value || '').trim();
  var state = (($('ecState') || {}).value || '').trim().toUpperCase();

  if (name && name.length < 3) return showSubModalErr('ecErr', 'Nome muito curto.');
  if (cpf && cpf.length !== 11 && cpf.length !== 14)
    return showSubModalErr('ecErr', 'CPF (11) ou CNPJ (14 dígitos).');
  if (cpf && !isValidCpfCnpj(cpf))
    return showSubModalErr('ecErr', 'CPF/CNPJ inválido — verifique os dígitos.');
  if (zip && zip.length !== 8) return showSubModalErr('ecErr', 'CEP precisa ter 8 dígitos.');

  var btn = $('ecSubmit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'A guardar…';
  }
  try {
    await authedFetch('/customer', {
      method: 'POST',
      body: JSON.stringify({
        name: name || undefined,
        email: email || undefined,
        cpfCnpj: cpf || undefined,
        mobilePhone: phone || undefined,
        postalCode: zip || undefined,
        address: addr || undefined,
        addressNumber: num || undefined,
        complement: compl || undefined,
        province: prov || undefined,
        city: city || undefined,
        state: state || undefined,
      }),
    });
    closeSubModal();
    var me = await fetchMe();
    renderMyAccount(me);
  } catch (e) {
    console.warn('[billing] edit customer', e, e.detail);
    showSubModalErr('ecErr', e.message || 'Falha ao guardar dados.');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Guardar alterações';
    }
  }
}

function confirmCancelSubscription() {
  var html =
    '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:14px 16px;margin-bottom:14px;display:flex;gap:11px;align-items:flex-start;">' +
    '<div style="flex:0 0 36px;height:36px;border-radius:10px;background:#dc2626;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;"><i class="ph-fill ph-warning"></i></div>' +
    '<div>' +
    '<div style="font-family:Syne,sans-serif;font-weight:700;font-size:14px;color:#991b1b;letter-spacing:-.01em;">Tem certeza?</div>' +
    '<p style="margin:4px 0 0;font-size:12.5px;color:#7f1d1d;line-height:1.5;opacity:.9;">O acesso fica disponível até o fim do ciclo já pago. Nenhuma cobrança futura é emitida.</p>' +
    '</div>' +
    '</div>' +
    '<p style="margin:0 0 14px;font-size:12.5px;color:#64748b;line-height:1.5;">Pode voltar a assinar a qualquer momento mantendo o mesmo cupom Applicash, se houver.</p>' +
    '<div id="cancelErr" style="display:none;font-size:12.5px;color:#991b1b;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px 12px;margin-bottom:10px;"></div>' +
    '<div style="display:flex;gap:8px;">' +
    '<button id="cancelKeep" type="button" style="flex:1;border:1.5px solid #e2e8f0;background:#fff;cursor:pointer;padding:11px 14px;border-radius:11px;font-size:13.5px;font-weight:600;color:#334155;font-family:inherit;">Manter assinatura</button>' +
    '<button id="cancelConfirm" type="button" style="flex:1;border:none;cursor:pointer;padding:11px 14px;border-radius:11px;font-size:13.5px;font-weight:700;background:linear-gradient(180deg,#dc2626 0%,#b91c1c 100%);color:#fff;box-shadow:0 2px 8px -1px rgba(220,38,38,.4),inset 0 1px 0 rgba(255,255,255,.18);font-family:inherit;">Confirmar cancelamento</button>' +
    '</div>';
  openSubModal('Cancelar assinatura?', html);
  $('cancelKeep').addEventListener('click', closeSubModal);
  $('cancelConfirm').addEventListener('click', doCancelSubscription);
}

async function doCancelSubscription() {
  var btn = $('cancelConfirm');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'A cancelar…';
  }
  try {
    await authedFetch('/cancel', { method: 'POST' });
    closeSubModal();
    var me = await fetchMe();
    renderMyAccount(me);
    refresh(false);
  } catch (e) {
    console.warn('[billing] cancel', e, e.detail);
    showSubModalErr('cancelErr', e.message || 'Falha ao cancelar.');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Confirmar cancelamento';
    }
  }
}

async function syncApplicashFromServer() {
  try {
    var me = await fetchMe();
    if (me.referralCode) {
      try {
        localStorage.setItem('appliquei_cupom_codigo', me.referralCode);
      } catch (_) {}
    }
    var assin = {
      plano: 'Mensal',
      valorMensal: (me.subscriptionBaseValueCents || me.monthlyPriceCents || 1500) / 100,
      proximaCobranca: (me.projectedNextBillCents || 0) / 100,
      status: me.subscriptionStatus || null,
      descontoPct: me.recurringDiscountPercent || 0,
    };
    try {
      localStorage.setItem('appliquei_applicash_assinatura', JSON.stringify(assin));
    } catch (_) {}

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
    try {
      localStorage.setItem('appliquei_applicash_indicacoes', JSON.stringify(indicacoes));
    } catch (_) {}

    try {
      var creditsLog = (me.credits || []).map(function (c) {
        return {
          id: c.id,
          fromEmail: c.fromEmail,
          amountCents: c.amountCents,
          appliedAt: c.appliedAt,
          createdAt: c.createdAt,
        };
      });
      localStorage.setItem('appliquei_applicash_creditos', JSON.stringify(creditsLog));
      localStorage.setItem(
        'appliquei_applicash_resumo',
        JSON.stringify({
          activeReferrals: me.activeReferrals,
          totalReferrals: me.totalReferrals,
          pendingDiscountCents: me.pendingDiscountCents,
          totalReferralEarningsCents: me.totalReferralEarningsCents,
          projectedNextBillCents: me.projectedNextBillCents,
        })
      );
    } catch (_) {}

    return me;
  } catch (e) {
    console.warn('[billing] syncApplicash', e);
    reportSwallowed(e, 'syncApplicashFromServer');
    return null;
  }
}
function statCard(label, value) {
  return (
    '<div style="background:#fff;border:1px solid #e4ebe7;border-radius:10px;padding:10px 12px;">' +
    '<div style="font-size:11px;color:#6b7d75;text-transform:uppercase;letter-spacing:.4px;">' +
    label +
    '</div>' +
    '<div style="font-size:15px;font-weight:700;color:#0b1410;margin-top:2px;">' +
    value +
    '</div>' +
    '</div>'
  );
}

async function refresh(verbose) {
  try {
    // /me devolve access + billing + tudo da conta. Não há endpoint
    // /status — usar /me garante uma fonte única de verdade para
    // estado de acesso (caso contrário polling silencioso quebra e
    // o gate só atualiza ao abrir Minha assinatura, deixando user
    // bloqueado usando a app por inércia até clicar lá).
    var r = await authedFetch('/me', { method: 'GET' });
    applyAccess(r.access, r);
    if (verbose && r.access && r.access.status !== 'active') {
      showErr(
        'Ainda não recebemos a confirmação do pagamento. Aguarde alguns instantes e tente novamente — confirmações por PIX/boleto podem levar até 3 horas.'
      );
    }
  } catch (e) {
    if (verbose)
      showErr(e.message || 'Não foi possível verificar agora. Tente novamente em instantes.');
  }
}

function writePopupMessage(popup, title, body) {
  if (!popup || popup.closed) return;
  try {
    popup.document.open();
    popup.document.write(
      '<!doctype html><meta charset="utf-8"><title>' +
        title +
        '</title>' +
        '<body style="font-family:system-ui,sans-serif;padding:32px;max-width:560px;margin:auto;color:#0b1410;">' +
        '<h2 style="margin:0 0 8px;">' +
        title +
        '</h2>' +
        '<pre style="white-space:pre-wrap;background:#f1f5f3;padding:12px;border-radius:8px;font-size:13px;">' +
        body.replace(/[<>&]/g, function (c) {
          return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c];
        }) +
        '</pre><p style="font-size:13px;color:#4a5b53;">Pode fechar esta aba.</p>'
    );
    popup.document.close();
  } catch (_) {}
}

function openSubscribeForm(mode) {
  var title = mode === 'one_shot' ? 'Renovar 1 mês' : 'Assine para continuar';
  var sub =
    mode === 'one_shot'
      ? 'Pagamento único de 30 dias. Você decide quando renovar.'
      : 'Preencha os dados para emitir a fatura.';
  showGate(title, sub);
  if (mode === 'one_shot' || mode === 'subscription') {
    // Pré-seleciona o tab pedido pelo banner. Os botões só existem após
    // o ensureGate() ter sido feito (showGate o chama), então o timeout
    // já garante DOM montado.
    setTimeout(function () {
      try {
        setBillingMode(mode);
      } catch (_) {}
    }, 0);
  }
  setTimeout(function () {
    var el = $('billingCpfCnpj');
    if (el) el.focus();
  }, 50);
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
  var y = parseInt(yy, 10);
  var now = new Date();
  var curY = now.getFullYear();
  var curM = now.getMonth() + 1;
  if (y < curY || (y === curY && m < curM)) return { expired: true };
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
  if (exp.expired) return { error: 'Este cartão já está expirado. Use um cartão válido.' };
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
  if (cpfEl && !isValidCpfCnpj(cpfDigits)) {
    showErr('CPF/CNPJ inválido — verifique os dígitos.');
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
    if (card.error) {
      showErr(card.error);
      return;
    }
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
  if (popup) {
    var popupMsg =
      selectedBillingMode === 'one_shot' ? 'A gerar fatura única…' : 'A criar assinatura…';
    writePopupMessage(
      popup,
      popupMsg,
      'A contactar o Asaas. Esta aba abrirá a fatura em instantes.'
    );
  }
  // /subscribe lida com os dois modos via flag `mode`. Foi fundido com
  // o antigo /pay-month para caber no limite de 12 functions do Vercel.
  payload.mode = selectedBillingMode;
  try {
    var r = await authedFetch('/subscribe', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    console.log('[billing] subscribe response', r);

    if (r.paymentMethod === 'CREDIT_CARD') {
      showGate(
        'A processar pagamento',
        'Cobrança em curso no cartão terminado em ' +
          (r.cardLast4 || '••••') +
          '. Vamos confirmar em instantes.'
      );
      await waitForActive(20);
      return;
    }

    if (r.invoiceUrl) {
      if (popup && !popup.closed) {
        popup.location.href = r.invoiceUrl;
        showGate(
          'Conclua o pagamento',
          'Abrimos a fatura numa nova aba. Após pagar, prima “Já paguei” para verificar.'
        );
        startActivePolling();
      } else {
        // Popup bloqueado: oferece link explícito em vez de redirect destruir a sessão.
        showGate(
          'Conclua o pagamento',
          'Abra a fatura no link abaixo. Após pagar, volte aqui e prima "Já paguei — verificar status".'
        );
        var err = $('billingErr');
        if (err) {
          err.innerHTML =
            'A sua janela bloqueou o popup. <a href="' +
            r.invoiceUrl +
            '" target="_blank" rel="noopener" style="color:#059669;text-decoration:underline;font-weight:600;">Abrir fatura</a>';
          err.style.background = '#ecfdf5';
          err.style.borderColor = '#a7f3d0';
          err.style.color = '#065f46';
          err.style.display = 'block';
        }
        startActivePolling();
      }
    } else if (r.alreadyActive) {
      writePopupMessage(
        popup,
        'Já tem assinatura ativa',
        'A sua assinatura (id: ' +
          (r.subscriptionId || '?') +
          ') já existe, mas não há fatura pendente. Verifique no painel Asaas. Resposta:\n\n' +
          JSON.stringify(r, null, 2)
      );
      await refresh(false);
    } else {
      writePopupMessage(
        popup,
        'Sem link de pagamento',
        'O backend respondeu mas não devolveu invoiceUrl. Resposta:\n\n' +
          JSON.stringify(r, null, 2)
      );
      showErr('Não foi possível obter o link de pagamento.');
    }
  } catch (e) {
    console.warn('[billing] subscribe', e, e.detail);
    if (popup)
      writePopupMessage(
        popup,
        'Erro ao criar assinatura',
        (e.message || 'erro') + '\n\n' + JSON.stringify(e.detail || {}, null, 2)
      );
    showErr(e.message || 'Falha ao criar assinatura.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function waitForActive(maxAttempts) {
  var attempts = 0;
  while (attempts < maxAttempts) {
    await new Promise(function (r) {
      setTimeout(r, 2500);
    });
    attempts++;
    try {
      var s = await authedFetch('/me', { method: 'GET' });
      if (s.access && s.access.status === 'active') {
        applyAccess(s.access, s);
        try {
          await syncApplicashFromServer();
        } catch (_) {
          reportSwallowed(_, 'waitForActive.syncApplicash');
        }
        return true;
      }
    } catch (_) {}
  }
  showErr('Não recebemos confirmação ainda. Use "Já paguei — verificar status".');
  return false;
}

function startActivePolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  // Polling rápido (5s) por 5 minutos. Depois cai para o ritmo normal (30s)
  // para não desperdiçar requests se o utilizador deixar a aba aberta.
  var ticks = 0;
  var FAST_MAX_TICKS = 60; // 60 × 5s = 5min
  pollTimer = setInterval(function () {
    ticks++;
    refresh(false);
    if (ticks >= FAST_MAX_TICKS) {
      clearInterval(pollTimer);
      pollTimer = setInterval(function () {
        refresh(false);
      }, POLL_MS);
    }
  }, 5000);
}

// Bloqueio temporário durante verificação de signup Google na aba
// "Entrar" (evita criar customer no Asaas se o user será rejeitado).
// Antes vivia em window.__appliqueiBlockBilling — global público que
// qualquer script no console podia setar para impedir o gate. Agora é
// closure exposta só via AppliqueiBilling.setSignupBlock(boolean).
// Continua "bypassável" via DevTools (toda lógica client é), mas remove
// o atalho de uma palavra no console.
var signupBlocked = false;
function setSignupBlock(v) {
  signupBlocked = !!v;
}

function onUser(user) {
  if (!user) {
    hideGate();
    ensureTrialBanner(0);
    ensureVerifyBanner(false);
    stopPolling();
    lastAccess = null;
    return;
  }
  if (signupBlocked) return;
  initBilling().then(function () {
    syncApplicashFromServer().then(function () {
      if (typeof window.atualizarTelaApplicash === 'function') {
        try {
          var sec = document.getElementById('applicash');
          if (sec && sec.classList && sec.classList.contains('ativa'))
            window.atualizarTelaApplicash();
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

// Defesa em profundidade contra acesso indevido:
//   1) Re-checa o status ao voltar para a aba — pega trial que expirou
//      enquanto o user estava noutra aba, ou conta que foi bloqueada
//      server-side por chargeback/refund sem o front saber.
//   2) Se o app subiu sem nunca ter aplicado access (race de auth,
//      /init que falhou silenciosamente, etc.), força uma tentativa.
//   3) Sanity check a cada 5 min mesmo com a aba aberta — captura
//      mudanças server-side dentro de uma sessão longa.
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'visible') return;
  var fb = window.AppliqueiFirebase;
  var u = fb && fb.auth && fb.auth.currentUser;
  if (!u) return;
  if (lastAccess == null) {
    // Nunca aplicou: re-inicia a partir do zero.
    try {
      initBilling();
    } catch (_) {}
  } else {
    // Já aplicou: revalida o estado atual.
    try {
      refresh(false);
    } catch (_) {}
  }
});
setInterval(
  function () {
    if (document.visibilityState !== 'visible') return;
    var fb = window.AppliqueiFirebase;
    if (!fb || !fb.auth || !fb.auth.currentUser) return;
    if (lastAccess) {
      try {
        refresh(false);
      } catch (_) {}
    }
  },
  5 * 60 * 1000
);

window.AppliqueiBilling = {
  refresh: function () {
    return refresh(true);
  },
  subscribe: subscribe,
  getAccess: function () {
    return lastAccess;
  },
  getBilling: function () {
    return lastBilling;
  },
  openSubscribeForm: openSubscribeForm,
  openMyAccount: openMyAccount,
  closeMyAccount: closeMyAccount,
  fetchMe: fetchMe,
  syncApplicash: syncApplicashFromServer,
  // Dispara onUser manualmente para o user logado atual. Usado após
  // o block ser liberado (Google login validado) para iniciar billing.
  // Repete em 1.5s/4s para cobrir o caso em que onAuthStateChanged
  // disparou enquanto signupBlocked=true (race no signup Google novo):
  // sem isto o trial banner só apareceria depois do próximo refresh
  // manual, pois nenhum re-trigger de onUser aconteceria.
  kickstart: function () {
    var fb = window.AppliqueiFirebase;
    var attempt = function () {
      try {
        var u = fb && fb.ready && fb.auth && fb.auth.currentUser;
        if (u && !signupBlocked) onUser(u);
      } catch (_) {}
    };
    attempt();
    // Retry curto só se o primeiro /init ainda não populou lastAccess.
    // Cobre o race do signup Google novo, em que onAuthStateChanged
    // disparou enquanto signupBlocked=true e o trial banner ficava sem
    // aparecer até refresh manual.
    setTimeout(function () {
      if (!lastAccess) attempt();
    }, 1500);
    setTimeout(function () {
      if (!lastAccess) attempt();
    }, 4500);
  },
  setSignupBlock: setSignupBlock,
};
