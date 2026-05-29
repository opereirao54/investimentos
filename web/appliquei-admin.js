/**
 * Appliquei — Painel Admin.
 *
 * Onda 3 — extraído de admin.html (linhas 873-1714) para arquivo classic
 * independente. Mesmo padrão de Appliquei_v13.0.html: o admin tem
 * handlers onclick referenciando funções globais, então mantemos classic
 * script (não module) para preservar contrato.
 */

/* ========================================
   STATE
   ======================================== */
var DESTRUCTIVE = new Set(['reset_billing', 'make_pro', 'disable_user', 'suspend_trial']);
var allUsers = [];
var userFilter = 'all';
var userSort = { field: 'createdAtMs', dir: 'desc' };
var userPage = 1;
var USERS_PER_PAGE = 25;
var currentData = null;
var activePeriod = 'all';
var drawerUser = null;

/* ========================================
   HELPERS
   ======================================== */
var $ = (id) => document.getElementById(id);
var formatBRL = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
var formatPct = (n, digits = 1) => `${(n * 100).toFixed(digits)}%`;
var formatInt = (n) => (n || 0).toLocaleString('pt-PT');
var escHTML = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleDateString('pt-PT') : '—';
}
function fmtDateTime(ms) {
  return ms ? new Date(ms).toLocaleString('pt-PT') : '—';
}
function relativeTime(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d atrás`;
  return new Date(ms).toLocaleDateString('pt-PT');
}

/* ========================================
   TOASTS
   ======================================== */
function toast(msg, type = 'info', timeout = 4000) {
  const c = $('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icon =
    { success: 'ph-check-circle', error: 'ph-x-circle', info: 'ph-info', warn: 'ph-warning' }[
      type
    ] || 'ph-info';
  t.innerHTML = `<i class="ph-fill ${icon}"></i><span class="toast-msg"></span><button class="toast-close" aria-label="Fechar"><i class="ph ph-x"></i></button>`;
  t.querySelector('.toast-msg').textContent = msg;
  t.querySelector('.toast-close').onclick = () => t.remove();
  c.appendChild(t);
  if (timeout > 0)
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateX(20px)';
      setTimeout(() => t.remove(), 300);
    }, timeout);
}

/* ========================================
   THEME
   ======================================== */
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const btn = $('sidebar-theme-btn');
  if (isDark) {
    html.setAttribute('data-theme', 'light');
    btn.innerHTML = '<i class="ph ph-moon"></i> Modo Escuro';
    localStorage.setItem('adminTheme', 'light');
  } else {
    html.setAttribute('data-theme', 'dark');
    btn.innerHTML = '<i class="ph ph-sun"></i> Modo Claro';
    localStorage.setItem('adminTheme', 'dark');
  }
}
if (localStorage.getItem('adminTheme') === 'dark') toggleTheme();

/* ========================================
   MOBILE SIDEBAR
   ======================================== */
$('mobileToggle').addEventListener('click', () => {
  $('mainSidebar').classList.toggle('vis');
  $('sidebarBackdrop').classList.toggle('vis');
});
$('sidebarBackdrop').addEventListener('click', () => {
  $('mainSidebar').classList.remove('vis');
  $('sidebarBackdrop').classList.remove('vis');
});

/* ========================================
   KEYBOARD SHORTCUTS
   ======================================== */
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('global-search-overlay').classList.remove('vis');
    closeDrawer();
  }
  if (
    e.target.tagName === 'INPUT' ||
    e.target.tagName === 'SELECT' ||
    e.target.tagName === 'TEXTAREA'
  )
    return;
  if (e.key.toLowerCase() === 'r') {
    e.preventDefault();
    loadStats();
  }
  if (e.key === '/') {
    e.preventDefault();
    ($('user-search') || {}).focus && $('user-search').focus();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('global-search-overlay').classList.add('vis');
    $('gs-input').focus();
  }
  if (e.key === '1') mudarAba(null, 'dashboard');
  if (e.key === '2') mudarAba(null, 'users');
  if (e.key === '3') mudarAba(null, 'superpower');
  if (e.key === '4') mudarAba(null, 'audit');
  if (e.key === '5') mudarAba(null, 'feedback');
  if (e.key === '6') mudarAba(null, 'carteira');
});

$('gs-input').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  const res = $('gs-results');
  res.innerHTML = '';
  if (!q) return;
  const tabs = [
    { name: 'Dashboard', id: 'dashboard' },
    { name: 'Utilizadores', id: 'users' },
    { name: 'Superpoderes', id: 'superpower' },
    { name: 'Audit Log', id: 'audit' },
  ];
  tabs
    .filter((t) => t.name.toLowerCase().includes(q))
    .forEach((t) => {
      const div = document.createElement('div');
      div.className = 'gs-item';
      div.innerHTML = `<i class="ph ph-hash"></i> Aba: ${escHTML(t.name)}`;
      div.onclick = () => {
        mudarAba(null, t.id);
        $('global-search-overlay').classList.remove('vis');
      };
      res.appendChild(div);
    });
  const uMatches = (allUsers || [])
    .filter((u) => (u.email || '').toLowerCase().includes(q))
    .slice(0, 5);
  uMatches.forEach((u) => {
    const div = document.createElement('div');
    div.className = 'gs-item';
    div.innerHTML = `<i class="ph ph-user"></i> ${escHTML(u.email || u.uid)}`;
    div.onclick = () => {
      $('global-search-overlay').classList.remove('vis');
      openDrawer(u);
    };
    res.appendChild(div);
  });
});

/* ========================================
   NAVIGATION
   ======================================== */
function mudarAba(e, tab) {
  document.querySelectorAll('.section').forEach((s) => s.classList.remove('ativa'));
  document.querySelectorAll('.menu-btn[data-tab]').forEach((b) => b.classList.remove('ativo'));
  const sec = $('sec-' + tab);
  if (sec) sec.classList.add('ativa');
  if (e && e.currentTarget) e.currentTarget.classList.add('ativo');
  else document.querySelector(`.menu-btn[data-tab="${tab}"]`)?.classList.add('ativo');
  if (window.innerWidth < 768) {
    $('mainSidebar').classList.remove('vis');
    $('sidebarBackdrop').classList.remove('vis');
  }
  if (tab === 'audit') loadAudit();
  if (tab === 'feedback') loadFeedback();
  if (tab === 'carteira') loadCarteira();
}

/* ========================================
   PERIOD CHIPS
   ======================================== */
document.querySelectorAll('#period-chips .period-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document
      .querySelectorAll('#period-chips .period-chip')
      .forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    activePeriod = chip.dataset.period;
    renderDashboard(currentData);
  });
});

/* ========================================
   SUPERPOWER
   ======================================== */
function toggleValueInput() {
  const v = $('action-value');
  const act = $('action-type').value;
  if (act === 'set_discount' || act === 'gift_pro_days') {
    v.classList.add('vis');
    v.placeholder = act === 'gift_pro_days' ? 'Dias (ex: 30)' : 'R$ (ex: 5.00)';
  } else {
    v.classList.remove('vis');
    v.value = '';
  }
}

function quickAction(action, val = '') {
  $('action-type').value = action;
  $('action-value').value = val;
  toggleValueInput();
  const email = $('action-email').value.trim();
  if (email) executeSuperpower();
  else {
    mudarAba(null, 'superpower');
    $('action-email').focus();
  }
}

function inlineAction(email, action, value = '') {
  mudarAba(null, 'superpower');
  $('action-email').value = email;
  $('action-type').value = action;
  $('action-value').value = value;
  toggleValueInput();
  executeSuperpower();
}

/* ========================================
   USER FILTER CHIPS
   ======================================== */
document.querySelectorAll('#user-filter-chips .filter-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document
      .querySelectorAll('#user-filter-chips .filter-chip')
      .forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    userFilter = chip.dataset.filter;
    userPage = 1;
    renderUsers();
  });
});

/* ========================================
   USERS TABLE SORT
   ======================================== */
document.querySelectorAll('.tbl th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const field = th.dataset.sort;
    if (userSort.field === field) {
      userSort.dir = userSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      userSort.field = field;
      userSort.dir = field === 'email' ? 'asc' : 'desc';
    }
    document.querySelectorAll('.tbl th.sortable').forEach((t) => {
      t.classList.toggle('active', t.dataset.sort === userSort.field);
      const ind = t.querySelector('.sort-ind');
      if (ind)
        ind.textContent =
          t.dataset.sort === userSort.field ? (userSort.dir === 'asc' ? '↑' : '↓') : '↕';
    });
    renderUsers();
  });
});

/* ========================================
   USERS — FILTER + SORT + PAGINATE
   ======================================== */
function statusBadge(status) {
  const map = {
    paying: ['badge-ok', 'Pagante'],
    trial: ['badge-info', 'Trial'],
    overdue: ['badge-danger', 'Inadimplente'],
    unverified: ['badge-warn', 'Não verif.'],
    suspended: ['badge-danger', 'Suspenso'],
    churned: ['badge-muted', 'Cancelado'],
    inactive: ['badge-muted', 'Inativo'],
    unknown: ['badge-muted', '—'],
  };
  const [cls, lbl] = map[status] || map.unknown;
  return `<span class="badge-s ${cls}">${lbl}</span>`;
}

function getFilteredUsers() {
  const q = ($('user-search').value || '').toLowerCase();
  let arr = (allUsers || []).filter((u) => {
    if (userFilter !== 'all' && u.status !== userFilter) return false;
    if (q && !(u.email || '').toLowerCase().includes(q) && !(u.uid || '').toLowerCase().includes(q))
      return false;
    return true;
  });
  arr.sort((a, b) => {
    const va = a[userSort.field] ?? '';
    const vb = b[userSort.field] ?? '';
    if (typeof va === 'string' && typeof vb === 'string') {
      return userSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return userSort.dir === 'asc' ? va - vb : vb - va;
  });
  return arr;
}

function renderUsers() {
  const arr = getFilteredUsers();
  const total = arr.length;
  const totalPages = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
  if (userPage > totalPages) userPage = totalPages;
  const start = (userPage - 1) * USERS_PER_PAGE;
  const slice = arr.slice(start, start + USERS_PER_PAGE);

  const tbody = $('users-table');
  tbody.innerHTML = '';
  if (!slice.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="tbl-empty">Sem utilizadores neste filtro.</td></tr>';
  } else
    slice.forEach((u) => {
      const email = u.email || u.uid;
      const tr = document.createElement('tr');
      tr.className = 'clickable';
      tr.innerHTML = `
            <td style="font-weight:500">${escHTML(email)} ${u.emailVerified ? '<i class="ph ph-seal-check" style="color:var(--cor-primaria);font-size:14px;vertical-align:middle"></i>' : ''}</td>
            <td style="white-space:nowrap">${fmtDate(u.createdAtMs)}</td>
            <td style="white-space:nowrap;color:var(--cor-texto-mutado)">${relativeTime(u.lastSignInMs)}</td>
            <td>${statusBadge(u.status)}</td>
            <td style="text-align:right" onclick="event.stopPropagation()">
                <div class="quick-actions" style="justify-content:flex-end;">
                    <button class="qa-pill" style="font-size:11px;padding:3px 8px;" onclick="inlineAction('${email.replace(/'/g, "\\'")}','full_xray')"><i class="ph ph-magnifying-glass"></i></button>
                    ${
                      u.disabled
                        ? `<button class="qa-pill" style="font-size:11px;padding:3px 8px;" onclick="inlineAction('${email.replace(/'/g, "\\'")}','enable_user')">✅</button>`
                        : `<button class="qa-pill destructive" style="font-size:11px;padding:3px 8px;" onclick="inlineAction('${email.replace(/'/g, "\\'")}','disable_user')">⛔</button>`
                    }
                </div>
            </td>`;
      tr.addEventListener('click', () => openDrawer(u));
      tbody.appendChild(tr);
    });

  // Pagination UI
  $('users-page-info').textContent =
    total === 0
      ? '0 utilizadores'
      : `${start + 1}–${Math.min(start + USERS_PER_PAGE, total)} de ${total} utilizadores`;
  const controls = $('users-page-controls');
  controls.innerHTML = '';
  const mkBtn = (label, page, disabled, active) => {
    const b = document.createElement('button');
    b.className = 'pagination-btn' + (active ? ' active' : '');
    b.disabled = !!disabled;
    b.innerHTML = label;
    b.onclick = () => {
      userPage = page;
      renderUsers();
    };
    return b;
  };
  controls.appendChild(mkBtn('‹', userPage - 1, userPage <= 1));
  const maxBtns = 5;
  let from = Math.max(1, userPage - 2);
  let to = Math.min(totalPages, from + maxBtns - 1);
  from = Math.max(1, to - maxBtns + 1);
  for (let i = from; i <= to; i++) controls.appendChild(mkBtn(String(i), i, false, i === userPage));
  controls.appendChild(mkBtn('›', userPage + 1, userPage >= totalPages));

  // Update counts
  const counts = {
    all: allUsers.length,
    paying: 0,
    trial: 0,
    overdue: 0,
    unverified: 0,
    suspended: 0,
    churned: 0,
    inactive: 0,
  };
  allUsers.forEach((u) => {
    if (counts[u.status] !== undefined) counts[u.status]++;
  });
  Object.keys(counts).forEach((k) => {
    const el = $('ct-' + k);
    if (el) el.textContent = formatInt(counts[k]);
  });
}

/* ========================================
   USER DRAWER
   ======================================== */
$('drawer-close').addEventListener('click', closeDrawer);
$('drawer-backdrop').addEventListener('click', closeDrawer);

function openDrawer(user) {
  drawerUser = user;
  const u = user;
  const email = u.email || u.uid;
  $('drawer-title').textContent = email;
  const body = $('drawer-body');

  const trialMs = u.trialEndsMs;
  const trialTxt = trialMs
    ? trialMs > Date.now()
      ? `Termina em ${fmtDateTime(trialMs)}`
      : `Terminou em ${fmtDateTime(trialMs)}`
    : '—';

  body.innerHTML = `
        <div class="drawer-section">
            <div class="drawer-section-title">Identidade</div>
            <div class="drawer-field"><span class="drawer-field-label">Email</span><span class="drawer-field-value">${escHTML(u.email || '—')}</span></div>
            <div class="drawer-field"><span class="drawer-field-label">UID</span><span class="drawer-field-value" style="font-size:11px">${escHTML(u.uid)}</span></div>
            <div class="drawer-field"><span class="drawer-field-label">Provedores</span><span class="drawer-field-value">${escHTML((u.providers || []).join(', ') || '—')}</span></div>
            <div class="drawer-field"><span class="drawer-field-label">E-mail verificado</span><span class="drawer-field-value">${u.emailVerified ? '✅ Sim' : '⚠️ Não'}</span></div>
            <div class="drawer-field"><span class="drawer-field-label">Estado</span><span class="drawer-field-value">${statusBadge(u.status)}</span></div>
            <div class="drawer-field"><span class="drawer-field-label">Conta ativa</span><span class="drawer-field-value">${u.disabled ? '⛔ Suspensa' : '✅ Ativa'}</span></div>
        </div>
        <div class="drawer-section">
            <div class="drawer-section-title">Atividade</div>
            <div class="drawer-field"><span class="drawer-field-label">Criado em</span><span class="drawer-field-value">${fmtDateTime(u.createdAtMs)}</span></div>
            <div class="drawer-field"><span class="drawer-field-label">Último login</span><span class="drawer-field-value">${fmtDateTime(u.lastSignInMs)} <span style="color:var(--cor-texto-mutado);font-size:11px">(${relativeTime(u.lastSignInMs)})</span></span></div>
        </div>
        <div class="drawer-section">
            <div class="drawer-section-title">Subscrição & Billing</div>
            <div class="drawer-field"><span class="drawer-field-label">Status Asaas</span><span class="drawer-field-value">${escHTML(u.subscriptionStatus || 'NÃO ASSINANTE')}</span></div>
            <div class="drawer-field"><span class="drawer-field-label">Último pagamento</span><span class="drawer-field-value">${escHTML(u.lastPaymentStatus || '—')}</span></div>
            <div class="drawer-field"><span class="drawer-field-label">Trial</span><span class="drawer-field-value">${trialTxt}</span></div>
            <div class="drawer-field"><span class="drawer-field-label">Desconto pendente</span><span class="drawer-field-value">${formatBRL(u.pendingDiscountCents)}</span></div>
            <div class="drawer-field"><span class="drawer-field-label">Ganhos indicações</span><span class="drawer-field-value">${formatBRL(u.earningsCents)}</span></div>
            <div class="drawer-field"><span class="drawer-field-label">Veio por indicação</span><span class="drawer-field-value">${u.hasReferrer ? 'Sim' : 'Não'}</span></div>
            <div class="drawer-field"><span class="drawer-field-label">Indicou</span><span class="drawer-field-value">${formatInt(u.indications || 0)} pessoa(s)</span></div>
        </div>
        <div class="drawer-section" id="drawer-payments-section">
            <div class="drawer-section-title">Histórico de Pagamentos <button class="qa-pill" style="font-size:11px" onclick="loadDrawerPayments()">Carregar</button></div>
            <div id="drawer-payments">Click "Carregar" para ver histórico.</div>
        </div>`;

  const acts = $('drawer-actions');
  acts.innerHTML = `
        <div class="quick-actions">
            <button class="qa-pill" onclick="inlineAction('${email.replace(/'/g, "\\'")}','full_xray')"><i class="ph ph-magnifying-glass"></i> Raio-X</button>
            <button class="qa-pill" onclick="inlineAction('${email.replace(/'/g, "\\'")}','reconcile_user')"><i class="ph ph-arrows-clockwise"></i> Reconciliar</button>
            <button class="qa-pill" onclick="inlineAction('${email.replace(/'/g, "\\'")}','extend_trial')"><i class="ph ph-hourglass"></i> +7d Trial</button>
            ${u.status === 'trial' ? `<button class="qa-pill destructive" onclick="inlineAction('${email.replace(/'/g, "\\'")}','suspend_trial')"><i class="ph ph-hourglass-low"></i> Suspender Trial</button>` : ''}
            <button class="qa-pill" onclick="inlineAction('${email.replace(/'/g, "\\'")}','gift_pro_days','30')"><i class="ph ph-gift"></i> +30d PRO</button>
            <button class="qa-pill" onclick="inlineAction('${email.replace(/'/g, "\\'")}','password_reset_link')"><i class="ph ph-key"></i> Reset senha</button>
            ${u.emailVerified ? '' : `<button class="qa-pill" onclick="inlineAction('${email.replace(/'/g, "\\'")}','send_verify_link')"><i class="ph ph-envelope"></i> Verificar email</button>`}
            ${
              u.disabled
                ? `<button class="qa-pill" onclick="inlineAction('${email.replace(/'/g, "\\'")}','enable_user')"><i class="ph ph-check"></i> Reativar</button>`
                : `<button class="qa-pill destructive" onclick="inlineAction('${email.replace(/'/g, "\\'")}','disable_user')"><i class="ph ph-prohibit"></i> Suspender</button>`
            }
        </div>`;

  $('user-drawer').classList.add('vis');
  $('drawer-backdrop').classList.add('vis');
  $('user-drawer').setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  $('user-drawer').classList.remove('vis');
  $('drawer-backdrop').classList.remove('vis');
  $('user-drawer').setAttribute('aria-hidden', 'true');
  drawerUser = null;
}

async function loadDrawerPayments() {
  if (!drawerUser) return;
  const email = drawerUser.email || drawerUser.uid;
  const target = $('drawer-payments');
  target.innerHTML = '⏳ A carregar...';
  const token = sessionStorage.getItem('adminToken');
  try {
    const res = await fetch('/api/admin/action', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'view_payments', email }),
    });
    const data = await res.json();
    if (!res.ok) {
      target.innerHTML = `<span style="color:var(--cor-erro)">Erro: ${escHTML(data.error || 'falhou')}</span>`;
      return;
    }
    if (!data.payments || !data.payments.length) {
      target.innerHTML = '<span style="color:var(--cor-texto-mutado)">Sem pagamentos.</span>';
      return;
    }
    target.innerHTML = data.payments
      .map(
        (p) => `
            <div class="drawer-field">
                <span class="drawer-field-label">${fmtDate(p.receivedAtMs)}</span>
                <span class="drawer-field-value">R$ ${p.value.toFixed(2)} · ${escHTML(p.status)}<br><span style="color:var(--cor-texto-mutado);font-size:11px">${escHTML(p.billingType)}</span></span>
            </div>`
      )
      .join('');
  } catch (err) {
    target.innerHTML = `<span style="color:var(--cor-erro)">${escHTML(err.message)}</span>`;
  }
}

/* ========================================
   RENDER RANKING
   ======================================== */
function renderRanking(tbodyId, rows, valueField, valueFormatter, opts = {}) {
  const tbody = $(tbodyId);
  const extraCol = opts.extraCol; // {field, format} para coluna extra (indicações)
  const colCount = extraCol ? 3 : 2;
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="tbl-empty">Sem dados.</td></tr>`;
    return;
  }
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    const val = valueFormatter ? valueFormatter(row) : formatBRL(row[valueField] || 0);
    let html = `<td style="font-weight:500">${escHTML(row.email || row.uid)}</td>`;
    if (extraCol) {
      const ev = extraCol.format ? extraCol.format(row) : row[extraCol.field] || 0;
      html += `<td class="mono" style="text-align:right">${ev}</td>`;
    }
    html += `<td class="mono" style="text-align:right">${val}</td>`;
    tr.innerHTML = html;
    tr.addEventListener('click', () => {
      const found = allUsers.find((u) => u.uid === row.uid);
      if (found) openDrawer(found);
      else toast('Utilizador não encontrado em cache. Recarregue.', 'warn');
    });
    tbody.appendChild(tr);
  });
}

/* ========================================
   BAR LIST RENDERER
   ======================================== */
function renderBarList(elId, entries, fillClass = '') {
  const el = $(elId);
  el.innerHTML = '';
  if (!entries || !entries.length) {
    el.innerHTML =
      '<div style="color:var(--cor-texto-mutado);font-size:12.5px;padding:8px 0">Sem dados.</div>';
    return;
  }
  const max = Math.max(...entries.map((e) => e.value));
  entries.forEach((e) => {
    const pct = max > 0 ? (e.value / max) * 100 : 0;
    const row = document.createElement('div');
    row.className = 'bar-list-item';
    row.innerHTML = `
            <div class="bar-list-label" title="${escHTML(e.label)}">${escHTML(e.label)}</div>
            <div class="bar-list-bar"><div class="bar-list-fill ${fillClass}" style="width:${pct.toFixed(1)}%"></div></div>
            <div class="bar-list-val">${escHTML(e.display || String(e.value))}</div>`;
    el.appendChild(row);
  });
}

/* ========================================
   SPARKLINE SVG
   ======================================== */
function renderSparkline(svgId, points) {
  const svg = $(svgId);
  if (!svg) return;
  svg.innerHTML = '';
  if (!points || points.length === 0) return;
  const W = 600,
    H = 140,
    P = 8;
  const max = Math.max(1, ...points.map((p) => p.count));
  const min = 0;
  const step = (W - 2 * P) / Math.max(1, points.length - 1);
  const yFor = (v) => H - P - ((v - min) / (max - min)) * (H - 2 * P);
  const xFor = (i) => P + i * step;
  let d = '';
  let area = '';
  points.forEach((p, i) => {
    const x = xFor(i),
      y = yFor(p.count);
    d += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
    area += i === 0 ? `M${x},${H - P}` : ` L${x},${y}`;
  });
  const last = points[points.length - 1];
  area += ` L${xFor(points.length - 1)},${H - P} Z`;
  const gradId = 'sparkGrad-' + svgId;
  svg.innerHTML = `
        <defs>
            <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#10b981" stop-opacity="0.35"/>
                <stop offset="100%" stop-color="#10b981" stop-opacity="0"/>
            </linearGradient>
        </defs>
        <path d="${area}" fill="url(#${gradId})" stroke="none"/>
        <path d="${d}" fill="none" stroke="#059669" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${xFor(points.length - 1)}" cy="${yFor(last.count)}" r="3.5" fill="#059669"/>`;
}

/* ========================================
   LOAD AUDIT
   ======================================== */
async function loadAudit() {
  const token = sessionStorage.getItem('adminToken');
  if (!token) return;
  const tbody = $('audit-table');
  tbody.innerHTML =
    '<tr><td colspan="5" class="tbl-empty"><i class="ph ph-spinner ph-spin"></i> A carregar...</td></tr>';
  const params = new URLSearchParams({ include: 'audit' });
  params.set('limit', $('audit-limit').value || '50');
  const action = $('audit-action-filter').value;
  const email = $('audit-email-filter').value;
  if (action) params.set('actionFilter', action);
  if (email) params.set('emailFilter', email);
  try {
    const res = await fetch('/api/admin/stats?' + params.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Falha ao carregar audit');
    const data = await res.json();
    renderAudit(data.entries);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="tbl-empty" style="color:var(--cor-erro)">Erro: ${escHTML(err.message)}</td></tr>`;
  }
}

function renderAudit(entries) {
  const tbody = $('audit-table');
  tbody.innerHTML = '';
  if (!entries || !entries.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="tbl-empty">Sem registos com estes filtros.</td></tr>';
    return;
  }
  const danger = new Set(['reset_billing', 'disable_user', 'make_pro']);
  entries.forEach((e) => {
    const tr = document.createElement('tr');
    const dt = e.at ? new Date(e.at).toLocaleString('pt-PT') : '—';
    const badgeCls = danger.has(e.action) ? 'badge-danger' : 'badge-info';
    const info = e.extra || (e.after ? JSON.stringify(e.after) : '');
    tr.innerHTML = `
            <td style="white-space:nowrap;color:var(--cor-texto-mutado);font-size:12px">${dt}</td>
            <td><span class="badge-s ${badgeCls}">${escHTML(e.action)}</span></td>
            <td style="font-weight:500">${escHTML(e.email || e.uid || '—')}</td>
            <td style="color:var(--cor-texto-mutado);font-size:12px">${escHTML(e.actor)}</td>
            <td class="mono" style="font-size:11px; color:var(--cor-texto-mutado); max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${escHTML(info)}">${escHTML(info)}</td>`;
    tbody.appendChild(tr);
  });
}

/* ========================================
   DOWNLOAD CSV
   ======================================== */
async function downloadCsv() {
  const token = sessionStorage.getItem('adminToken');
  if (!token) return;
  const btn = $('sidebar-export-btn');
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> A gerar...';
  btn.disabled = true;
  try {
    const res = await fetch('/api/admin/stats?format=csv', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `appliquei-billing-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('CSV exportado.', 'success');
  } catch (err) {
    toast('Falha CSV: ' + err.message, 'error');
  } finally {
    btn.innerHTML = orig;
    btn.disabled = false;
  }
}

/* ========================================
   STALE INDICATOR
   ======================================== */
var lastStatsMs = 0;
function updateStaleIndicator() {
  const status = $('sb-status');
  if (!lastStatsMs) return;
  const ageMs = Date.now() - lastStatsMs;
  if (ageMs > 5 * 60 * 1000) status.classList.add('stale');
  else status.classList.remove('stale');
  $('sb-last-update').textContent = relativeTime(lastStatsMs);
}
setInterval(updateStaleIndicator, 30000);

/* ========================================
   RENDER DASHBOARD
   ======================================== */
function renderDashboard(data) {
  if (!data) return;
  document.querySelectorAll('.skeleton-text').forEach((e) => e.classList.remove('skeleton'));

  const b = data.billing || {};
  const u = data.users || {};

  // Financeiro
  $('val-mrr').textContent = formatBRL(b.mrrCents || 0);
  $('val-arr').textContent = formatBRL(b.arrCents || 0);
  $('val-arpu').textContent = formatBRL(b.arpu || 0);
  $('val-ltv').textContent = b.ltvCents > 0 ? formatBRL(b.ltvCents) : '—';

  // Receita Realizada + cupom
  $('val-rev-month').textContent = formatBRL(b.revenueThisMonthCents || 0);
  $('val-rev-month-count').textContent = formatInt(b.paymentsThisMonth);
  $('val-rev-30d').textContent = formatBRL(b.revenueLast30dCents || 0);
  $('val-rev-30d-count').textContent = formatInt(b.paymentsLast30d);
  $('val-discount-rate').textContent = formatPct(b.discountRate || 0);
  $('val-discount-abs').textContent = formatInt(b.usersWithDiscount);
  $('val-network').textContent = formatInt(b.withReferral);

  // Crescimento
  $('val-active').textContent = formatInt(b.active);
  $('val-trial').textContent = formatInt(b.trialActive);
  $('val-new7').textContent = formatInt(u.newUsers7d);
  $('val-new30').textContent = formatInt(u.newUsers30d);

  // Risco
  $('val-churn').textContent = formatPct(b.churnRate || 0);
  $('val-conv').textContent = formatPct(b.conversionRate || 0);
  $('val-overdue').textContent = formatInt(b.overdueCount);
  $('val-expiring').textContent = formatInt(b.trialExpiringSoon48h);

  // Indicações / Auth
  $('val-earnings').textContent = formatBRL(b.totalEarningsCents || 0);
  $('val-cashback').textContent = formatBRL(b.totalPendingCashbackCents || 0);
  $('val-viral').textContent = formatPct(b.viralCoefficient || 0);
  $('val-disabled').textContent = formatInt(u.disabled);

  // Funil
  if (data.funnel) {
    const f = data.funnel;
    const max = f.registered || 1;
    $('fn-registered').textContent = formatInt(f.registered);
    $('fn-verified').textContent = formatInt(f.emailVerified);
    $('fn-billing').textContent = formatInt(f.billingInitiated);
    $('fn-converted').textContent = formatInt(f.converted);
    $('funnel-bar-1').style.width = '100%';
    $('funnel-bar-2').style.width = `${(((f.emailVerified || 0) / max) * 100).toFixed(1)}%`;
    $('funnel-bar-3').style.width = `${(((f.billingInitiated || 0) / max) * 100).toFixed(1)}%`;
    $('funnel-bar-4').style.width = `${(((f.converted || 0) / max) * 100).toFixed(1)}%`;
    $('fn-rate-1').textContent = `${(((f.emailVerified || 0) / max) * 100).toFixed(1)}% do total`;
    $('fn-rate-2').textContent = f.emailVerified
      ? `${(((f.billingInitiated || 0) / f.emailVerified) * 100).toFixed(1)}% verificados`
      : '0%';
    $('fn-rate-3').textContent = f.billingInitiated
      ? `${(((f.converted || 0) / f.billingInitiated) * 100).toFixed(1)}% iniciaram trial`
      : '0%';
  }

  // Rankings
  renderRanking('top-referrers', b.topReferrers || [], 'earningsCents', null, {
    extraCol: { field: 'indications', format: (r) => formatInt(r.indications || 0) },
  });
  renderRanking('top-pending', b.topPending || [], 'pendingCents');
  renderRanking('overdue-list', b.overdueList || [], 'valueCents', (r) =>
    formatBRL(r.valueCents || 0)
  );
  renderRanking('expiring-list', b.expiringList || [], null, (r) => relativeTime(r.trialEndsMs));

  // Sparkline & domínios
  const series = data.series || {};
  let spark = series.dailyNewUsers30d || [];
  // Filtrar por período
  if (activePeriod === '7d') spark = spark.slice(-7);
  else if (activePeriod === '30d') spark = spark.slice(-30);
  else if (activePeriod === '90d') spark = spark.slice(-90);
  renderSparkline('spark-svg', spark);
  $('spark-total').textContent = formatInt(spark.reduce((a, p) => a + p.count, 0));

  const domains = (series.topEmailDomains || []).map((d) => ({
    label: d.domain,
    value: d.count,
    display: formatInt(d.count),
  }));
  renderBarList('email-domains-list', domains, 'purple');

  // Saúde operacional
  $('webhook-24h').textContent = formatInt(
    (data.webhooks && data.webhooks.last24h && data.webhooks.last24h.total) || 0
  );
  $('webhook-7d').textContent = formatInt(
    (data.webhooks && data.webhooks.last7d && data.webhooks.last7d.total) || 0
  );
  const wh = (data.webhooks && data.webhooks.last24h && data.webhooks.last24h.byEvent) || {};
  const whEntries = Object.entries(wh)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => ({ label: k, value: v, display: formatInt(v) }));
  renderBarList('webhook-events-list', whEntries, 'blue');

  $('suspicious-hits').textContent = formatInt(
    (data.rateLimits24h && data.rateLimits24h.suspiciousHits) || 0
  );
  const rl = (data.rateLimits24h && data.rateLimits24h.byScope) || {};
  const rlEntries = Object.entries(rl)
    .sort((a, b) => b[1].highCount - a[1].highCount)
    .slice(0, 8)
    .map(([k, v]) => ({
      label: k,
      value: v.highCount || 0,
      display: `${formatInt(v.highCount || 0)} / ${formatInt(v.totalDocs || 0)}`,
    }));
  renderBarList('ratelimit-scopes-list', rlEntries);

  // Distribuições
  const ss = b.subscriptionStatus || {};
  const ssEntries = Object.entries(ss)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: k, value: v, display: formatInt(v) }));
  renderBarList('subscription-status-list', ssEntries);
  const pm = b.paymentMethods || {};
  const pmEntries = Object.entries(pm)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: k, value: v, display: formatInt(v) }));
  renderBarList('payment-methods-list', pmEntries, 'purple');

  // Integridade & Reconciliação (P3)
  renderReconcile(data.reconcile || {});

  // Sidebar count + last update
  $('sb-user-count').textContent = formatInt(u.totalKnown);
  lastStatsMs = Date.now();
  updateStaleIndicator();

  // Alert antifraude
  const alertBox = $('alert-antifraud');
  alertBox.style.display = 'flex';
  if (data.readinessHints && data.readinessHints.antifraudInitSafeToEnable) {
    alertBox.className = 'alert-bar safe';
    alertBox.innerHTML =
      '<i class="ph-fill ph-shield-check"></i> Segurança: tráfego estável. Seguro ativar antifraude.';
  } else {
    alertBox.className = 'alert-bar warn';
    alertBox.innerHTML = `<i class="ph-fill ph-warning"></i> ${formatInt((data.rateLimits24h || {}).suspiciousHits || 0)} hits suspeitos em 24h. Considere ativar antifraude.`;
  }
}

/* ========================================
   RECONCILIAÇÃO / DIVERGÊNCIAS (P3)
   ======================================== */
function formatBRLSigned(c) {
  const sign = c > 0 ? '+' : c < 0 ? '−' : '';
  return sign + formatBRL(Math.abs(c || 0));
}

function renderReconcile(r) {
  const last = r.lastRun;
  $('reconcile-scanned').textContent = formatInt(last ? last.scanned : 0);
  $('reconcile-billing').textContent = formatInt(last ? last.billingStateCorrected : 0);
  $('reconcile-credit').textContent = formatInt(last ? last.creditInvariantCorrected : 0);
  $('reconcile-errors').textContent = formatInt(last ? last.errors : 0);

  $('reconcile-last-sub').textContent = last
    ? `${relativeTime(last.atMs)} · origem ${last.source || 'manual'}`
    : 'Sem varreduras registadas';
  $('reconcile-window-sub').textContent = r.runs
    ? `Últimas ${formatInt(r.runs)} varreduras: ${formatInt(r.windowBillingCorrected)} cobrança · ${formatInt(r.windowCreditCorrected)} crédito · ${formatInt(r.windowErrors)} erros`
    : 'Acumulado das últimas varreduras aparecerá aqui.';

  const tbody = $('reconcile-corrections');
  tbody.innerHTML = '';
  const rows = r.recentCorrections || [];
  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="3" class="tbl-empty">Nenhuma divergência corrigida. ✅</td></tr>';
    return;
  }
  rows.forEach((c) => {
    const drift = c.pending && typeof c.pending.drift === 'number' ? c.pending.drift : 0;
    const cls = drift > 0 ? 'badge-ok' : drift < 0 ? 'badge-danger' : 'badge-muted';
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.innerHTML = `
            <td style="font-weight:500">${escHTML(c.email || c.uid)}</td>
            <td style="white-space:nowrap;color:var(--cor-texto-mutado);font-size:12px">${relativeTime(c.atMs)}</td>
            <td class="mono" style="text-align:right"><span class="badge-s ${cls}">${formatBRLSigned(drift)}</span></td>`;
    tr.addEventListener('click', () => {
      const found = allUsers.find((u) => u.uid === c.uid);
      if (found) openDrawer(found);
      else inlineAction(c.uid, 'full_xray');
    });
    tbody.appendChild(tr);
  });
}

// Lê a resposta com tolerância: a função serverless pode devolver uma página
// de erro NÃO-JSON (ex.: timeout da Vercel → "An error occurred..."). Nesse
// caso devolvemos o texto cru como erro em vez de quebrar no JSON.parse.
async function parseJsonSafe(res) {
  const text = await res.text();
  try {
    return { ok: res.ok, data: JSON.parse(text) };
  } catch (_) {
    const snippet = (text || '').trim().slice(0, 120) || `HTTP ${res.status}`;
    return { ok: false, data: { error: snippet } };
  }
}

async function triggerReconcile() {
  const token = sessionStorage.getItem('adminToken');
  if (!token) return;
  if (
    !confirm(
      'Rodar varredura de reconciliação em TODAS as contas agora?\n\nAlinha cobrança×Asaas e corrige contadores Applicash que desgarraram. Roda em lotes — pode demorar alguns segundos.'
    )
  )
    return;
  const btn = $('reconcile-run-btn');
  const orig = btn.innerHTML;
  btn.disabled = true;
  // A varredura roda em lotes (time-box no servidor p/ não estourar o limite
  // da função). Iteramos com o cursor `nextCursor` até concluir (partial=false).
  const acc = { scanned: 0, billing: 0, credit: 0, errors: 0 };
  let cursor = null,
    batches = 0;
  const MAX_BATCHES = 50; // guarda-corpo contra loop infinito
  try {
    do {
      batches++;
      btn.innerHTML = `<i class="ph ph-spinner ph-spin"></i> Lote ${batches} (${formatInt(acc.scanned)})...`;
      const url =
        '/api/admin/stats?op=reconcile' + (cursor ? '&after=' + encodeURIComponent(cursor) : '');
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const { ok, data } = await parseJsonSafe(res);
      if (!ok) throw new Error(data.error || `HTTP ${res.status}`);
      acc.scanned += data.scanned || 0;
      acc.billing += data.billingStateCorrected || 0;
      acc.credit += data.creditInvariantCorrected || 0;
      acc.errors += data.errors || 0;
      cursor = data.partial ? data.nextCursor : null;
    } while (cursor && batches < MAX_BATCHES);
    const incomplete = cursor ? ' (interrompida — muitos lotes)' : '';
    toast(
      `Varredura concluída${incomplete}: ${formatInt(acc.scanned)} contas · ${formatInt(acc.billing)} cobrança · ${formatInt(acc.credit)} crédito · ${formatInt(acc.errors)} erros.`,
      acc.errors ? 'warn' : 'success',
      7000
    );
    loadStats();
  } catch (err) {
    toast('Falha na varredura: ' + err.message, 'error');
  } finally {
    btn.innerHTML = orig;
    btn.disabled = false;
  }
}

/* ========================================
   LOAD STATS
   ======================================== */
async function loadStats() {
  const tokenInput = $('admin-token').value;
  const token = tokenInput || sessionStorage.getItem('adminToken');
  if (!token) return;

  const refreshBtn = $('btn-refresh');
  if (refreshBtn) {
    refreshBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> A carregar...';
    refreshBtn.disabled = true;
  }

  try {
    const res = await fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Falha na autenticação');
    const data = await res.json();
    sessionStorage.setItem('adminToken', token);
    $('login-overlay').classList.add('hidden');

    currentData = data;
    allUsers = data.allUsers || data.recentUsers || [];
    renderDashboard(data);
    renderUsers();
    updateFeedbackBadge();
    if ($('sec-audit').classList.contains('ativa')) loadAudit();
  } catch (err) {
    const el = $('error-msg');
    el.classList.add('vis');
    sessionStorage.removeItem('adminToken');
    setTimeout(() => el.classList.remove('vis'), 4000);
    if ($('login-overlay').classList.contains('hidden'))
      toast('Falha ao carregar stats: ' + err.message, 'error');
  } finally {
    if (refreshBtn) {
      refreshBtn.innerHTML = '<i class="ph ph-arrows-clockwise"></i> Atualizar';
      refreshBtn.disabled = false;
    }
  }
}

/* ========================================
   EXECUTE SUPERPOWER
   ======================================== */
async function executeSuperpower() {
  const email = $('action-email').value.trim();
  const action = $('action-type').value;
  const actionValue = $('action-value').value;
  const token = sessionStorage.getItem('adminToken');
  const output = $('action-output');
  if (!email) {
    output.textContent = '⚠ Erro: insira o e-mail ou UID do utilizador alvo.';
    toast('Insira o e-mail/UID alvo.', 'warn');
    return;
  }
  if (DESTRUCTIVE.has(action)) {
    const labels = {
      reset_billing: 'APAGAR billing',
      make_pro: 'forçar PRO',
      disable_user: 'SUSPENDER conta',
      suspend_trial: 'SUSPENDER trial (expira agora)',
    };
    if (!confirm(`${labels[action] || 'ação'} para ${email}?\n\nFica registado no audit log.`))
      return;
  }
  output.textContent = '⏳ A contactar o backend...\n';
  try {
    const res = await fetch('/api/admin/action', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, email, actionValue }),
    });
    const data = await res.json();
    if (!res.ok) {
      output.textContent += `\n❌ [ERRO] ${data.error || 'Falha'}\nDetalhe: ${data.detail || ''}`;
      toast('Erro: ' + (data.error || 'falhou'), 'error');
      return;
    }

    if (action === 'xray' || action === 'full_xray') {
      output.textContent = '';
      const r = data.resumo || {};
      const a = data.authInfo || {};
      const lines = [
        [
          `📋 VISÃO GERAL EXPANDIDA: ${email}`,
          'color:var(--cor-info);font-weight:700;margin-bottom:6px',
        ],
        [`UID: ${data.uid || '—'}`, 'color:var(--cor-texto-mutado)'],
        [
          `Status Asaas: ${r.statusAsaas || '—'}`,
          r.statusAsaas === 'ACTIVE'
            ? 'color:var(--cor-txt-primaria);font-weight:700'
            : 'color:var(--cor-txt-erro);font-weight:700',
        ],
        [`Último Pagamento: ${r.ultimoPagamento || '—'}`, 'color:var(--cor-texto-mutado)'],
        [
          `Desconto Pendente: ${r.descontoPendente || '—'}`,
          'color:var(--cor-txt-amber);font-weight:700',
        ],
        [`Trial expira: ${r.trialExpiraEm || '—'}`, 'color:var(--cor-texto-mutado)'],
        [`ID Asaas: ${r.idAsaas || '—'}`, 'color:var(--cor-texto-mutado)'],
        [
          `E-mail verificado: ${r.emailVerified ? 'sim' : 'não'}`,
          r.emailVerified ? 'color:var(--cor-txt-primaria)' : 'color:var(--cor-txt-amber)',
        ],
      ];
      if (a.creationTime) {
        lines.push(['', '']);
        lines.push([
          `Auth Registado em: ${new Date(a.creationTime).toLocaleString('pt-PT')}`,
          'color:var(--cor-texto-mutado)',
        ]);
        lines.push([
          `Último Login: ${new Date(a.lastSignInTime).toLocaleString('pt-PT')}`,
          'color:var(--cor-texto-mutado)',
        ]);
        lines.push([`Provedores: ${a.providerIds.join(', ')}`, 'color:var(--cor-texto-mutado)']);
      }
      if (data.payments && data.payments.length) {
        lines.push(['', '']);
        lines.push([
          `🧾 Histórico de Pagamentos (${data.payments.length}):`,
          'color:var(--cor-txt-amber);font-weight:700',
        ]);
        data.payments.forEach((p) => {
          const dt = new Date(p.receivedAtMs).toLocaleDateString('pt-PT');
          lines.push([
            `   ${dt} | ${p.status} | R$ ${p.value.toFixed(2)} | ${p.billingType}`,
            'color:var(--cor-texto-principal)',
          ]);
        });
      }
      lines.forEach(([text, style]) => {
        const p = document.createElement('p');
        p.style.cssText = style;
        p.textContent = text;
        output.appendChild(p);
      });
    } else if (action === 'view_payments') {
      output.textContent = `🧾 Histórico de Pagamentos de ${email}:\n\n`;
      if (data.payments && data.payments.length) {
        data.payments.forEach((p) => {
          const dt = new Date(p.receivedAtMs).toLocaleString('pt-PT');
          output.textContent += `${dt} | ${p.status} | R$ ${p.value.toFixed(2)} | ${p.billingType}\n`;
        });
      } else {
        output.textContent += 'Nenhum pagamento encontrado.';
      }
    } else if ((action === 'password_reset_link' || action === 'send_verify_link') && data.link) {
      output.textContent += `\n✅ ${data.message}\n\nLink:\n${data.link}\n\nCopia e envia ao utilizador.`;
      // Auto-copy to clipboard
      try {
        await navigator.clipboard.writeText(data.link);
        toast('Link copiado para a área de transferência.', 'success');
      } catch (_) {
        toast(data.message, 'success');
      }
    } else {
      output.textContent += `\n✅ ${data.message}`;
      toast(data.message, 'success');
      if (
        [
          'disable_user',
          'enable_user',
          'force_verify',
          'set_discount',
          'gift_pro_days',
          'make_pro',
          'extend_trial',
          'suspend_trial',
          'reset_billing',
          'reconcile_user',
        ].includes(action)
      ) {
        setTimeout(loadStats, 600);
      }
    }
  } catch (err) {
    output.textContent += `\n💀 [ERRO FATAL] ${err.message}`;
    toast('Erro fatal: ' + err.message, 'error');
  }
}

/* ========================================
   ADMIN POST HELPER
   ======================================== */
async function adminPost(payload) {
  const token = sessionStorage.getItem('adminToken');
  const res = await fetch('/api/admin/action', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  return data;
}

/* ========================================
   SUGESTÕES (FEEDBACK)
   ======================================== */
var FB_ABA_LABELS = {
  patrimonio: 'Patrimônio',
  controle: 'Controle financeiro',
  carteira: 'Carteira recomendada',
  relatorio_mensal: 'Relatório mensal',
  simulador: 'Simulador',
  meus_sonhos: 'Meus sonhos',
  aulas: 'Jornada',
  noticias: 'Info Mercado',
  applicash: 'Applicash $',
  duvidas_sugestoes: 'Dúvidas & Sugestões',
  outro: 'Outro',
};
var FB_TIPO_LABELS = { melhoria: '✨ Melhoria', novo: '🚀 Novo recurso', bug: '🐛 Bug' };
var FB_STATUS = {
  aberto: ['badge-warn', '🟡 Aberta'],
  respondido: ['badge-info', '💬 Respondida'],
  resolvido: ['badge-ok', '✅ Resolvida'],
};

async function loadFeedback() {
  const token = sessionStorage.getItem('adminToken');
  if (!token) return;
  const wrap = $('feedback-list');
  wrap.innerHTML =
    '<div class="tbl-empty"><i class="ph ph-spinner ph-spin"></i> A carregar...</div>';
  const params = new URLSearchParams({ include: 'feedback', limit: '200' });
  const status = $('feedback-status-filter').value;
  if (status) params.set('statusFilter', status);
  try {
    const res = await fetch('/api/admin/stats?' + params.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Falha ao carregar sugestões');
    const data = await res.json();
    renderFeedback(data.items || []);
    updateFeedbackBadge();
  } catch (err) {
    wrap.innerHTML = `<div class="tbl-empty" style="color:var(--cor-erro)">Erro: ${escHTML(err.message)}</div>`;
  }
}

function renderFeedback(items) {
  const wrap = $('feedback-list');
  if (!items.length) {
    wrap.innerHTML = '<div class="tbl-empty">Nenhuma sugestão neste filtro.</div>';
    return;
  }
  wrap.innerHTML = '';
  items.forEach((f) => {
    const [scls, slbl] = FB_STATUS[f.status] || FB_STATUS.aberto;
    const aba = FB_ABA_LABELS[f.aba] || f.aba || '—';
    const tema = f.outroTema ? ` · ${escHTML(f.outroTema)}` : '';
    const card = document.createElement('div');
    card.className = 'fb-card';
    const replyBox = f.reply
      ? `<div class="fb-reply-box"><strong style="color:var(--cor-primaria)"><i class="ph-fill ph-chat-teardrop-text"></i> Resposta:</strong><br>${escHTML(f.reply)}</div>`
      : '';
    const replyForm = `
            <textarea class="fb-reply-input" id="fb-reply-${f.id}" placeholder="${f.reply ? 'Editar resposta…' : 'Escreva a resposta ao utilizador…'}">${f.reply ? escHTML(f.reply) : ''}</textarea>
            <div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end;flex-wrap:wrap;">
                ${f.status !== 'resolvido' ? `<button class="btn-sec" onclick="resolveFeedback('${f.id}')"><i class="ph ph-check-circle"></i> Marcar resolvida</button>` : ''}
                <button class="sp-btn" onclick="replyFeedback('${f.id}')"><i class="ph-fill ph-paper-plane-tilt"></i> ${f.reply ? 'Atualizar resposta' : 'Responder'}</button>
            </div>`;
    card.innerHTML = `
            <div class="fb-card-head">
                <div>
                    <span class="fb-tag">${FB_TIPO_LABELS[f.tipo] || f.tipo} · ${escHTML(aba)}${tema}</span>
                    <span class="badge-s ${scls}" style="margin-left:6px">${slbl}</span>
                    <div class="fb-meta" style="margin-top:6px">${escHTML(f.email || f.uid || '—')} · ${fmtDateTime(f.createdAtMs)}</div>
                </div>
                <button class="qa-pill" onclick="inlineAction('${(f.email || f.uid).replace(/'/g, "\\'")}','full_xray')" title="Ver utilizador"><i class="ph ph-magnifying-glass"></i></button>
            </div>
            <div class="fb-texto">${escHTML(f.texto)}</div>
            ${replyBox}
            ${replyForm}`;
    wrap.appendChild(card);
  });
}

async function replyFeedback(id) {
  const ta = $('fb-reply-' + id);
  const replyText = (ta.value || '').trim();
  if (replyText.length < 2) {
    toast('Escreva uma resposta.', 'warn');
    return;
  }
  try {
    const data = await adminPost({ action: 'reply_feedback', feedbackId: id, replyText });
    toast(data.message || 'Resposta enviada.', 'success');
    loadFeedback();
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

async function resolveFeedback(id) {
  try {
    const data = await adminPost({ action: 'resolve_feedback', feedbackId: id });
    toast(data.message || 'Marcada como resolvida.', 'success');
    loadFeedback();
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

async function updateFeedbackBadge() {
  const token = sessionStorage.getItem('adminToken');
  if (!token) return;
  try {
    const res = await fetch('/api/admin/stats?include=feedback&statusFilter=aberto&limit=300', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    const el = $('sb-feedback-count');
    if (el) el.textContent = formatInt((data.items || []).length);
  } catch (_) {}
}

/* ========================================
   CARTEIRA MODELO (Painel do consultor)
   ======================================== */
var CM_ALLOC_DEFAULT = {
  Conservador: { rf: 70, acao: 15, fii: 15, cripto: 0 },
  Moderado: { rf: 40, acao: 32, fii: 25, cripto: 3 },
  Arrojado: { rf: 15, acao: 50, fii: 25, cripto: 10 },
};
var CM_ATIVOS_DEFAULT = {
  rf: [{ ticker: 'TESOURO_SELIC_2027', nome: 'Tesouro Selic 2027', obs: 'Liquidez e segurança' }],
  acao: [{ ticker: 'BBAS3', nome: 'Banco do Brasil', obs: 'Banco estatal sólido' }],
  fii: [{ ticker: 'MXRF11', nome: 'Maxi Renda', obs: 'Dividendos mensais' }],
  cripto: [{ ticker: 'BTC', nome: 'Bitcoin', obs: 'Reserva digital global' }],
};
var cmCarteira = null;
var cmPerfilAtivo = 'Conservador';
var cmClasseAtiva = 'rf';

async function loadCarteira() {
  const token = sessionStorage.getItem('adminToken');
  if (!token) return;
  try {
    const res = await fetch('/api/admin/stats?include=carteira', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Falha ao carregar carteira');
    const data = await res.json();
    const c = data.carteira;
    cmCarteira = {
      mesAno: (c && c.mesAno) || '',
      descricao: (c && c.descricao) || '',
      alocacoes: (c && c.alocacoes) || JSON.parse(JSON.stringify(CM_ALLOC_DEFAULT)),
      ativos: (c && c.ativos) || JSON.parse(JSON.stringify(CM_ATIVOS_DEFAULT)),
    };
    $('cm-mesAno').value = cmCarteira.mesAno;
    $('cm-desc').value = cmCarteira.descricao;
    cmPerfilAtivo = 'Conservador';
    cmClasseAtiva = 'rf';
    document
      .querySelectorAll('#cm-perfil-tabs .cm-tab')
      .forEach((b) => b.classList.toggle('active', b.dataset.perfil === 'Conservador'));
    document
      .querySelectorAll('#cm-classe-tabs .cm-tab')
      .forEach((b) => b.classList.toggle('active', b.dataset.classe === 'rf'));
    cmCarregarAlloc();
    cmRenderAtivos();
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

function cmSelPerfil(perfil) {
  cmGuardarAllocAtual();
  cmPerfilAtivo = perfil;
  document
    .querySelectorAll('#cm-perfil-tabs .cm-tab')
    .forEach((b) => b.classList.toggle('active', b.dataset.perfil === perfil));
  cmCarregarAlloc();
}

function cmSelClasse(classe) {
  cmClasseAtiva = classe;
  document
    .querySelectorAll('#cm-classe-tabs .cm-tab')
    .forEach((b) => b.classList.toggle('active', b.dataset.classe === classe));
  cmRenderAtivos();
}

function cmCarregarAlloc() {
  const a =
    (cmCarteira.alocacoes && cmCarteira.alocacoes[cmPerfilAtivo]) ||
    CM_ALLOC_DEFAULT[cmPerfilAtivo] ||
    {};
  $('cm-rf').value = a.rf ?? 0;
  $('cm-acao').value = a.acao ?? 0;
  $('cm-fii').value = a.fii ?? 0;
  $('cm-cripto').value = a.cripto ?? 0;
  cmTotal();
}

function cmGuardarAllocAtual() {
  if (!cmCarteira) return;
  if (!cmCarteira.alocacoes) cmCarteira.alocacoes = {};
  cmCarteira.alocacoes[cmPerfilAtivo] = {
    rf: parseFloat($('cm-rf').value) || 0,
    acao: parseFloat($('cm-acao').value) || 0,
    fii: parseFloat($('cm-fii').value) || 0,
    cripto: parseFloat($('cm-cripto').value) || 0,
  };
}

function cmTotal() {
  const t = ['cm-rf', 'cm-acao', 'cm-fii', 'cm-cripto'].reduce(
    (s, id) => s + (parseFloat($(id).value) || 0),
    0
  );
  const el = $('cm-total');
  el.textContent = t + '%';
  el.style.color = t === 100 ? 'var(--cor-primaria)' : 'var(--cor-erro)';
}

function cmRenderAtivos() {
  const tbody = $('cm-ativos-tbody');
  const ativos = (cmCarteira.ativos && cmCarteira.ativos[cmClasseAtiva]) || [];
  tbody.innerHTML =
    ativos
      .map(
        (a, i) => `
        <tr>
            <td class="mono" style="font-weight:700">${escHTML(a.ticker)}</td>
            <td>${escHTML(a.nome || '')}</td>
            <td style="color:var(--cor-texto-mutado);font-size:12px">${escHTML(a.obs || '')}</td>
            <td><button class="qa-pill destructive" onclick="cmRemoveAtivo(${i})"><i class="ph ph-trash"></i></button></td>
        </tr>`
      )
      .join('') || '<tr><td colspan="4" class="tbl-empty">Nenhum ativo.</td></tr>';
}

function cmRemoveAtivo(i) {
  if (!cmCarteira.ativos[cmClasseAtiva]) return;
  cmCarteira.ativos[cmClasseAtiva].splice(i, 1);
  cmRenderAtivos();
}

function cmAddAtivo() {
  const ticker = ($('cm-add-ticker').value || '').trim().toUpperCase();
  const nome = ($('cm-add-nome').value || '').trim();
  const obs = ($('cm-add-obs').value || '').trim();
  if (!ticker) {
    toast('Informe o ticker.', 'warn');
    return;
  }
  if (!cmCarteira.ativos[cmClasseAtiva]) cmCarteira.ativos[cmClasseAtiva] = [];
  cmCarteira.ativos[cmClasseAtiva].push({ ticker, nome, obs });
  $('cm-add-ticker').value = '';
  $('cm-add-nome').value = '';
  $('cm-add-obs').value = '';
  cmRenderAtivos();
}

async function cmSalvar() {
  cmGuardarAllocAtual();
  const total = Object.values(cmCarteira.alocacoes[cmPerfilAtivo]).reduce((s, v) => s + v, 0);
  if (Math.round(total) !== 100) {
    toast(`Alocação do perfil ${cmPerfilAtivo} soma ${total}% (precisa 100%).`, 'error');
    return;
  }
  cmCarteira.mesAno = $('cm-mesAno').value;
  cmCarteira.descricao = $('cm-desc').value;
  try {
    const data = await adminPost({ action: 'save_carteira', carteira: cmCarteira });
    toast(data.message || 'Carteira publicada.', 'success');
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

function logout() {
  sessionStorage.removeItem('adminToken');
  location.reload();
}

/* ========================================
   EVENTS
   ======================================== */
$('login-btn').addEventListener('click', loadStats);
$('admin-token').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadStats();
});
$('sb-logout').addEventListener('click', logout);
$('action-type').addEventListener('change', toggleValueInput);
$('execute-btn').addEventListener('click', executeSuperpower);

// Auto-login
if (sessionStorage.getItem('adminToken')) loadStats();
