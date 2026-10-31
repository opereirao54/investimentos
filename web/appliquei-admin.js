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
var DESTRUCTIVE = new Set([
  'reset_billing',
  'make_pro',
  'revoke_pro',
  'cancel_asaas_sub',
  'disable_user',
  'suspend_trial',
]);
var allUsers = [];
var userFilter = 'all';
var userSort = { field: 'createdAtMs', dir: 'desc' };
var userPage = 1;
var USERS_PER_PAGE = 25;
var currentData = null;
var activePeriod = '30d';
var drawerUser = null;

/* ========================================
   HELPERS
   ======================================== */
var $ = (id) => document.getElementById(id);
var formatBRL = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
var formatPct = (n, digits = 1) => `${(n * 100).toFixed(digits).replace('.', ',')}%`;
var formatInt = (n) => (n || 0).toLocaleString('pt-BR');
var escHTML = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleDateString('pt-PT') : '—';
}
// "21/10/2026 14:32" — dia e hora, sem segundos.
function fmtDiaHora(ms) {
  return ms
    ? new Date(ms).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
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
    { name: 'Usuários', id: 'users' },
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
  // Celular: a barra inferior acompanha qualquer caminho de navegação
  // (busca global, atalhos de teclado, links internos).
  if (typeof admSincronizar === 'function') admSincronizar(tab);
  if (tab === 'audit') loadAudit();
  if (tab === 'feedback') loadFeedback();
  if (tab === 'carteira') loadCarteira();
  if (tab === 'redes') loadRedes();
  if (tab === 'convites') loadConvites();
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
    courtesy: ['badge-info', 'Cortesia'],
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
    tbody.innerHTML = '<tr><td colspan="5" class="tbl-empty">Sem usuários neste filtro.</td></tr>';
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
      ? '0 usuários'
      : `${start + 1}–${Math.min(start + USERS_PER_PAGE, total)} de ${total} usuários`;
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
    courtesy: 0,
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
            <div class="drawer-section-title">Assinatura & Billing</div>
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
            <button class="qa-pill destructive" onclick="inlineAction('${email.replace(/'/g, "\\'")}','delete_user')"><i class="ph ph-trash"></i> Excluir cadastro</button>
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
  target.innerHTML = '⏳ Carregando...';
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
      else toast('Usuário não encontrado em cache. Recarregue.', 'warn');
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
    '<tr><td colspan="5" class="tbl-empty"><i class="ph ph-spinner ph-spin"></i> Carregando...</td></tr>';
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
      '<tr><td colspan="5" class="tbl-empty">Sem registros com estes filtros.</td></tr>';
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
  btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Gerando...';
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

  // Visão de negócio (receita, previsão, volumetria, conversão)
  renderNegocio(data.negocio || null);

  // Indicações / Auth
  $('val-earnings').textContent = formatBRL(b.totalEarningsCents || 0);
  $('val-cashback').textContent = formatBRL(b.totalPendingCashbackCents || 0);
  $('val-discount-abs').textContent = formatInt(b.usersWithDiscount);
  $('val-network').textContent = formatInt(b.withReferral);
  $('val-viral').textContent = formatPct(b.viralCoefficient || 0);
  $('val-disabled').textContent = formatInt(u.disabled);

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
  if (data.negocio && data.negocio.volume) spark = data.negocio.volume.cadastrosPorDia || spark;
  var dias = activePeriod === '7d' ? 7 : activePeriod === '90d' ? 90 : 30;
  spark = spark.slice(-dias);
  $('spark-titulo').textContent = 'Cadastros por dia (' + dias + ' dias)';
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
   VISÃO DE NEGÓCIO
   ======================================== */
// "R$ 1,2 mil" — rótulo curto para as colunas; o valor exato vai no title.
function fmtBRLCurto(c) {
  var r = (c || 0) / 100;
  if (r >= 1000)
    return 'R$ ' + (r / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return 'R$ ' + r.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}
var NG_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function ngRotuloMes(aaaaMm) {
  var p = String(aaaaMm).split('-');
  return NG_MESES[(+p[1] || 1) - 1] + (p[1] === '01' ? '/' + p[0].slice(2) : '');
}
function ngTexto(id, txt) {
  var el = $(id);
  if (el) el.textContent = txt;
}
function ngPct(x) {
  return x == null ? '—' : formatPct(x);
}
function ngDelta(atual, anterior) {
  if (!anterior) return atual ? 'primeiro período com dado' : 'sem dado para comparar';
  var d = (atual - anterior) / anterior;
  return (d >= 0 ? '▲ ' : '▼ ') + formatPct(Math.abs(d)) + ' vs. período anterior';
}

/** Colunas simples (uma série): altura = valor ÷ maior valor. */
function ngColunas(elId, itens, fmt) {
  var el = $(elId);
  if (!el) return;
  var max = Math.max.apply(null, itens.map((i) => i.valor).concat([0]));
  if (!itens.length || max <= 0) {
    el.innerHTML =
      '<div style="color:var(--cor-texto-mutado);font-size:12.5px;align-self:center;width:100%;text-align:center">Ainda sem dados neste período.</div>';
    return;
  }
  el.innerHTML = itens
    .map((i) => {
      var h = max > 0 ? Math.max(2, (i.valor / max) * 100) : 2;
      var exato = escHTML(i.titulo || fmt(i.valor));
      return (
        '<div class="ng-col" title="' +
        escHTML(i.rotulo) +
        ': ' +
        exato +
        '">' +
        '<div class="ng-col-val">' +
        (i.valor ? escHTML(fmt(i.valor)) : '') +
        '</div>' +
        '<div class="ng-col-barra' +
        (i.valor ? '' : ' zero') +
        '" style="height:' +
        h.toFixed(1) +
        '%"></div>' +
        '<div class="ng-col-mes">' +
        escHTML(i.rotulo) +
        '</div></div>'
      );
    })
    .join('');
}

function renderNegocio(n) {
  var aviso = $('ng-aviso');
  if (!n) {
    if (aviso) {
      aviso.style.display = 'flex';
      aviso.innerHTML =
        '<i class="ph-fill ph-warning"></i> O servidor ainda não enviou a visão de negócio. Atualize depois do deploy.';
    }
    return;
  }
  var r = n.receita;
  var p = n.previsao;
  var x = n.realizado;
  var c = n.conversao;
  var v = n.volume;
  var s = n.situacoes;
  if (aviso) {
    aviso.style.display = n.truncado ? 'flex' : 'none';
    if (n.truncado)
      aviso.innerHTML =
        '<i class="ph-fill ph-warning"></i> Mais de 1.000 cadastros: a volumetria considera os 1.000 primeiros. Receita e previsão usam todas as assinaturas.';
  }

  // Receita recorrente
  ngTexto('val-mrr', formatBRL(r.mrrCents));
  ngTexto('ng-mrr-sub', formatInt(r.assinantes) + ' assinaturas em dia');
  ngTexto('val-arr', formatBRL(r.arrCents));
  ngTexto('val-base', formatInt(r.basePagante));
  ngTexto(
    'ng-base-sub',
    formatInt(r.assinantes) +
      ' em dia · ' +
      formatInt(r.atraso) +
      ' em atraso · ' +
      formatInt(r.avulsos) +
      ' sem renovação'
  );
  ngTexto('val-arpu', formatBRL(r.arpuCents));
  ngTexto('val-mrr-risco', formatBRL(r.mrrRiscoCents));
  ngTexto('ng-risco-sub', formatInt(r.atraso) + ' assinaturas com fatura vencida');
  ngTexto('val-avulso', formatBRL(r.avulsoMensalCents));
  ngTexto('ng-avulso-sub', formatInt(r.avulsos) + ' pagaram o mês, sem renovação automática');
  ngTexto('val-desconto', formatBRL(r.descontoMensalCents));
  ngTexto(
    'ng-desconto-sub',
    formatInt(r.assinantesComDesconto) + ' assinantes abaixo do preço cheio'
  );
  ngTexto('val-credito', formatBRL(r.creditoPendenteCents));

  // Previsão
  var p30 = p.proximos30;
  ngTexto('val-prev-esperado', formatBRL(p30.esperadoCents));
  ngTexto(
    'ng-prev-esperado-sub',
    p30.trialsProvavelCents == null
      ? 'Só renovações — ainda sem histórico de conversão'
      : 'Renovações + testes na taxa de conversão atual'
  );
  ngTexto('val-prev-renov', formatBRL(p30.renovacoesCents));
  ngTexto('ng-prev-renov-sub', formatInt(p30.renovacoesQtd) + ' cobranças, com crédito abatido');
  ngTexto(
    'val-prev-trials',
    p30.trialsProvavelCents == null ? '—' : formatBRL(p30.trialsProvavelCents)
  );
  ngTexto(
    'ng-prev-trials-sub',
    formatInt(p30.trialsQtd) + ' em teste × ' + ngPct(c.taxa) + ' de conversão'
  );
  ngTexto('val-prev-avulsos', formatBRL(p30.avulsosCents));
  ngTexto(
    'ng-prev-avulsos-sub',
    formatInt(p30.avulsosQtd) + ' vencem em 30 dias · fora do esperado'
  );
  var proj = $('ng-proj');
  if (proj) {
    proj.innerHTML = [{ meses: 0, mrrCents: r.mrrCents }]
      .concat(p.projecao)
      .map(
        (it) =>
          '<div class="ng-proj-item"><div class="ng-proj-lbl">' +
          (it.meses ? 'Em ' + it.meses + ' meses' : 'Hoje') +
          '</div><div class="ng-proj-val">' +
          formatBRL(it.mrrCents) +
          '</div></div>'
      )
      .join('');
  }
  var liq = p.mrrLiquidoNovo30Cents;
  ngTexto(
    'ng-proj-nota',
    'Nos últimos 30 dias entraram ' +
      formatBRL(p.mrrNovo30Cents) +
      ' de MRR novo e saíram ' +
      formatBRL(p.mrrCancelado30Cents) +
      ' em cancelamentos (' +
      (liq >= 0 ? '+' : '−') +
      formatBRL(Math.abs(liq)) +
      '/mês). A projeção repete esse ritmo; é uma referência, não uma promessa.'
  );
  var tb = $('ng-renovacoes');
  if (tb) {
    var ren = p.renovacoes || [];
    tb.innerHTML = ren.length
      ? ren
          .map((it) => {
            var found = allUsers.find((uu) => uu.uid === it.uid);
            return (
              '<tr><td style="font-weight:500">' +
              escHTML((found && found.email) || it.uid) +
              '</td><td class="mono" style="text-align:right">' +
              fmtDate(it.quandoMs) +
              '</td><td class="mono" style="text-align:right">' +
              formatBRL(it.valorCents) +
              '</td></tr>'
            );
          })
          .join('')
      : '<tr><td colspan="3" class="tbl-empty">Nenhuma renovação nos próximos 30 dias.</td></tr>';
  }

  // Receita realizada
  ngTexto('val-rev-month', formatBRL(x.mesCents));
  ngTexto(
    'ng-mes-sub',
    formatInt(x.mesQtd) + ' pagamentos · ' + ngDelta(x.mesCents, x.mesAnteriorMesmoPeriodoCents)
  );
  ngTexto('val-rev-30d', formatBRL(x.ult30Cents));
  ngTexto('ng-30d-sub', formatInt(x.ult30Qtd) + ' pagamentos nos últimos 30 dias');
  ngTexto('val-rev-liquido', formatBRL(x.mesLiquidoCents));
  ngTexto('val-rev-total', formatBRL(x.totalCents));
  ngTexto('ng-total-sub', formatBRL(x.taxasCents) + ' em taxas · inclui contas excluídas');
  ngColunas(
    'ng-receita-meses',
    (x.porMes || []).map((m) => ({
      rotulo: ngRotuloMes(m.mes),
      valor: m.bruto,
      titulo:
        formatBRL(m.bruto) +
        ' (' +
        formatInt(m.qtd) +
        ' pagamentos, líquido ' +
        formatBRL(m.liquido) +
        ')',
    })),
    fmtBRLCurto
  );

  // Volumetria
  ngTexto('val-cadastros', formatInt(v.cadastros));
  ngTexto(
    'ng-cadastros-sub',
    formatInt(v.hoje) + ' hoje · ' + formatInt(v.verificados) + ' com e-mail verificado'
  );
  ngTexto('val-new7', formatInt(v.novos7));
  ngTexto(
    'ng-new7-sub',
    'Média de ' + (v.novos7 / 7).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' por dia'
  );
  ngTexto('val-new30', formatInt(v.novos30));
  ngTexto('ng-new30-sub', ngDelta(v.novos30, v.novos30Anterior));
  ngTexto('val-login30', formatInt(v.loginUlt30));
  ngTexto('ng-login-sub', formatInt(v.loginUlt7) + ' entraram nos últimos 7 dias');
  var a = v.ativos;
  ngTexto('val-dau', a ? formatInt(a.dia) : '—');
  ngTexto('val-wau', a ? formatInt(a.semana) : '—');
  ngTexto('val-mau', a ? formatInt(a.mes) : '—');
  ngTexto(
    'ng-mau-sub',
    a
      ? 'Aderência ' +
          ngPct(a.aderencia) +
          ' (hoje ÷ mês) · ' +
          formatInt(a.pagantesAtivos30) +
          ' pagantes'
      : 'Sem leitura de uso agora'
  );
  ngTexto('val-nunca', a ? formatInt(a.nuncaUsaram) : '—');
  ngTexto(
    'ng-nunca-sub',
    a ? 'Cadastraram e não lançaram nada · ' + formatInt(a.telegram) + ' usam o Telegram' : ''
  );
  ngColunas(
    'ng-cadastros-meses',
    (v.cadastrosPorMes || []).map((m) => ({ rotulo: ngRotuloMes(m.mes), valor: m.count })),
    formatInt
  );
  var nomes = {
    assinante: 'Assinantes em dia',
    atraso: 'Em atraso',
    avulso: 'Sem renovação',
    trial: 'Em teste',
    aguardando: 'Aguardando 1º pagto',
    cortesia: 'Cortesia',
    cancelado: 'Cancelaram',
    estornado: 'Estorno',
    trial_expirado: 'Teste expirou',
    sem_assinatura: 'Sem teste',
  };
  var semBilling = Math.max(0, v.cadastros - v.iniciaramTeste);
  var sit = Object.keys(nomes)
    .map((k) => ({ k: k, valor: k === 'sem_assinatura' ? (s[k] || 0) + semBilling : s[k] || 0 }))
    .filter((it) => it.valor > 0)
    .map((it) => ({ label: nomes[it.k], value: it.valor, display: formatInt(it.valor) }));
  renderBarList('ng-situacoes', sit);

  // Conversão & retenção
  ngTexto('val-conv', ngPct(c.taxa));
  ngTexto(
    'ng-conv-sub',
    formatInt(c.converteram) + ' de ' + formatInt(c.coorte) + ' que já terminaram o teste'
  );
  ngTexto('val-churn', ngPct(c.churnMensal));
  ngTexto('ng-churn-sub', formatInt(c.canceladosUlt30) + ' cancelaram nos últimos 30 dias');
  ngTexto('val-ltv', c.ltvCents ? formatBRL(c.ltvCents) : '—');
  ngTexto('val-trial', formatInt(c.trialsAtivos));
  ngTexto('ng-trial-sub', formatInt(c.novosPagantes30) + ' novos pagantes em 30 dias');
  ngTexto('val-expiring', formatInt(c.trialsAcabam48h));
  ngTexto('val-aguardando', formatInt(c.aguardandoPrimeiroPagamento));
  ngTexto('val-expirado', formatInt(c.trialExpiradoSemPagar));
  ngTexto('val-overdue', formatInt(r.atraso));

  // Funil: cadastros → testaram → usaram → pagaram
  var usaram = a ? a.algumaVez : null;
  var etapas = [v.cadastros, v.iniciaramTeste, usaram, c.converteram];
  var base = v.cadastros || 1;
  ngTexto('fn-registered', formatInt(etapas[0]));
  ngTexto('fn-verified', formatInt(etapas[1]));
  ngTexto('fn-billing', usaram == null ? '—' : formatInt(usaram));
  ngTexto('fn-converted', formatInt(etapas[3]));
  [1, 2, 3, 4].forEach((i) => {
    var val = etapas[i - 1] || 0;
    $('funnel-bar-' + i).style.width = ((val / base) * 100).toFixed(1) + '%';
  });
  ngTexto('fn-rate-1', ngPct(etapas[1] / base) + ' dos cadastros');
  ngTexto('fn-rate-2', usaram == null ? '—' : ngPct(usaram / base) + ' dos cadastros');
  ngTexto('fn-rate-3', ngPct(etapas[3] / base) + ' dos cadastros');
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
    : 'Sem varreduras registradas';
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
    refreshBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Carregando...';
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
  const token = sessionStorage.getItem('adminToken');
  const output = $('action-output');
  if (!email) {
    output.textContent = '⚠ Erro: insira o e-mail ou UID do usuário alvo.';
    toast('Insira o e-mail/UID alvo.', 'warn');
    return;
  }
  // Excluir é definitivo: em vez de um OK, pede o e-mail digitado de novo —
  // o servidor confere o mesmo (actionValue) antes de apagar.
  let actionValue = $('action-value').value;
  if (action === 'delete_user') {
    const digitado = prompt(
      `EXCLUIR DEFINITIVAMENTE o cadastro de ${email}?\n\n` +
        'Cancela a assinatura no Asaas, apaga todos os dados e o login. Não tem volta.\n' +
        'Se a ideia é só bloquear o acesso, use "Suspender".\n\n' +
        'Para confirmar, digite o e-mail da conta:'
    );
    if (digitado == null) return;
    actionValue = digitado.trim();
  } else if (DESTRUCTIVE.has(action)) {
    const labels = {
      reset_billing: 'APAGAR billing',
      make_pro: 'liberar PRO sem prazo (cortesia)',
      revoke_pro: 'REVOGAR a cortesia PRO',
      cancel_asaas_sub: 'CANCELAR a assinatura no Asaas (para as cobranças)',
      disable_user: 'SUSPENDER conta',
      suspend_trial: 'SUSPENDER trial (expira agora)',
    };
    if (!confirm(`${labels[action] || 'ação'} para ${email}?\n\nFica registrado no audit log.`))
      return;
  }
  output.textContent = '⏳ Falando com o backend...\n';
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
        [
          `Cortesia PRO: ${r.cortesia || 'não'}`,
          r.cortesia && r.cortesia !== 'não'
            ? 'color:var(--cor-txt-primaria);font-weight:700'
            : 'color:var(--cor-texto-mutado)',
        ],
        [`Acesso calculado: ${r.acesso || '—'}`, 'color:var(--cor-info);font-weight:700'],
        [`ID Asaas: ${r.idAsaas || '—'}`, 'color:var(--cor-texto-mutado)'],
        [
          `E-mail verificado: ${r.emailVerified ? 'sim' : 'não'}`,
          r.emailVerified ? 'color:var(--cor-txt-primaria)' : 'color:var(--cor-txt-amber)',
        ],
      ];
      if (a.creationTime) {
        lines.push(['', '']);
        lines.push([
          `Auth registrado em: ${new Date(a.creationTime).toLocaleString('pt-PT')}`,
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
      output.textContent += `\n✅ ${data.message}\n\nLink:\n${data.link}\n\nCopie e envie ao usuário.`;
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
  carteira: 'Carteira sugerida',
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
    '<div class="tbl-empty"><i class="ph ph-spinner ph-spin"></i> Carregando...</div>';
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
            <textarea class="fb-reply-input" id="fb-reply-${f.id}" placeholder="${f.reply ? 'Editar resposta…' : 'Escreva a resposta ao usuário…'}">${f.reply ? escHTML(f.reply) : ''}</textarea>
            <div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end;flex-wrap:wrap;">
                ${f.status !== 'resolvido' ? `<button class="btn-sec" onclick="resolveFeedback('${f.id}')"><i class="ph ph-check-circle"></i> Marcar resolvida</button>` : ''}
                <button class="sp-btn" onclick="replyFeedback('${f.id}')"><i class="ph-fill ph-paper-plane-tilt"></i> ${f.reply ? 'Atualizar resposta' : 'Responder'}</button>
            </div>`;
    // O print vem sob demanda: a listagem traz só o resumo do anexo, então o
    // botão é o que dispara o download daquela imagem. Sem isso o painel
    // carregaria centenas de KB por cartão só para abrir a aba.
    const idOk = /^[A-Za-z0-9_-]{1,64}$/.test(String(f.id || ''));
    const anexoBox =
      f.anexo && idOk
        ? `<div id="fb-anexo-${f.id}" style="margin-top:8px;">
                <button class="btn-sec" onclick="verAnexoFeedback('${f.id}')"><i class="ph ph-image"></i> Ver imagem (${fmtBytes(f.anexo.bytes)})</button>
               </div>`
        : '';
    card.innerHTML = `
            <div class="fb-card-head">
                <div>
                    <span class="fb-tag">${FB_TIPO_LABELS[f.tipo] || f.tipo} · ${escHTML(aba)}${tema}</span>
                    <span class="badge-s ${scls}" style="margin-left:6px">${slbl}</span>
                    <div class="fb-meta" style="margin-top:6px">${escHTML(f.email || f.uid || '—')} · ${fmtDateTime(f.createdAtMs)}</div>
                </div>
                <button class="qa-pill" onclick="inlineAction('${(f.email || f.uid).replace(/'/g, "\\'")}','full_xray')" title="Ver usuário"><i class="ph ph-magnifying-glass"></i></button>
            </div>
            <div class="fb-texto">${escHTML(f.texto)}</div>
            ${anexoBox}
            ${replyBox}
            ${replyForm}`;
    wrap.appendChild(card);
  });
}

function fmtBytes(n) {
  if (!(n > 0)) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

async function verAnexoFeedback(id) {
  const box = $('fb-anexo-' + id);
  if (!box) return;
  const token = sessionStorage.getItem('adminToken');
  if (!token) return;
  const btn = box.querySelector('button');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Carregando...';
  }
  try {
    const res = await fetch(
      '/api/admin/stats?include=feedback_anexo&id=' + encodeURIComponent(id),
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error('Falha ao carregar a imagem');
    const data = await res.json();
    if (!data || !data.dados) throw new Error('Imagem vazia');
    const img = document.createElement('img');
    img.alt = 'Imagem anexada à sugestão';
    img.style.cssText =
      'display:block;max-width:100%;height:auto;border-radius:8px;border:1px solid var(--cor-borda);margin-top:4px;';
    img.src = 'data:' + (data.mime || 'image/jpeg') + ';base64,' + data.dados;
    box.innerHTML = '';
    box.appendChild(img);
  } catch (err) {
    box.innerHTML = `<div class="fb-meta" style="color:var(--cor-erro)">${escHTML(err.message)}</div>`;
  }
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

/* ========================================
   CONVITES (fase de testes)
   ======================================== */
function cvLink(codigo) {
  return location.origin + '/app?convite=' + encodeURIComponent(codigo);
}

function cvRender(data) {
  const obrig = !!data.obrigatorio;
  $('cv-obrigatorio').checked = obrig;
  $('cv-modo-txt').textContent = obrig
    ? 'LIGADO — conta nova só entra com código. Quem já tem conta continua entrando normal.'
    : 'DESLIGADO — cadastro aberto, como antes (avaliação de 7 dias e assinatura).';
  const inpData = $('cv-lancamento');
  if (inpData && document.activeElement !== inpData) inpData.value = data.dataLancamento || '';
  const txt = $('cv-lancamento-txt');
  if (txt) {
    const pct = data.descontoPercent || 50;
    txt.innerHTML = data.ultimoDiaGratis
      ? `🎁 Testadores: <strong>grátis até ${escHTML(data.ultimoDiaGratis || '')}</strong>, depois <strong>${pct}% de desconto</strong> na mensalidade, para sempre.`
      : `⚠️ <strong>Sem data de lançamento:</strong> por enquanto os testadores têm acesso grátis sem prazo. Defina a data para valer o "1 ano depois do lançamento" (e depois ${pct}% de desconto).`;
  }
  const itens = data.itens || [];
  const tb = $('cv-lista');
  if (!itens.length) {
    tb.innerHTML = '<tr><td colspan="5" class="tbl-empty">Nenhum convite gerado ainda.</td></tr>';
    return;
  }
  const situacao = (i) => {
    if (i.status === 'usado')
      return `<span class="badge-s badge-ok">✅ Usado</span><div style="font-size:11.5px;color:var(--cor-texto-mutado);margin-top:3px;">${escHTML(i.usadoEmail || '')}${i.usadoEm ? ' · ' + fmtDateTime(i.usadoEm) : ''}</div>`;
    if (i.status === 'cancelado') return '<span class="badge-s badge-muted">Cancelado</span>';
    return '<span class="badge-s badge-warn">🟡 Livre</span>';
  };
  tb.innerHTML = itens
    .map(
      (i) => `<tr>
        <td style="font-family:'DM Mono',monospace;white-space:nowrap;">${escHTML(i.codigo)}</td>
        <td>${escHTML(i.nota || '—')}</td>
        <td>${situacao(i)}</td>
        <td style="white-space:nowrap;">${i.criadoEm ? fmtDate(i.criadoEm) : '—'}</td>
        <td style="white-space:nowrap;text-align:right;">${
          i.status === 'livre'
            ? `<button class="btn-sec" onclick="cvCopiar('${escHTML(i.codigo)}')"><i class="ph ph-copy"></i> Link</button>
               <button class="btn-sec danger" onclick="cvCancelar('${escHTML(i.codigo)}')"><i class="ph ph-x"></i></button>`
            : ''
        }</td>
      </tr>`
    )
    .join('');
}

// ─── Quem está usando (fase de testes) ───
var usoItens = [];
var usoFiltro = 'testadores';

function usoSituacaoBadge(s) {
  if (s === 'ativo') return '<span class="badge-s badge-ok">🟢 Ativo</span>';
  if (s === 'esfriando') return '<span class="badge-s badge-warn">🟡 Esfriando</span>';
  return '<span class="badge-s badge-danger">🔴 Parado</span>';
}

function usoRender() {
  const base = usoItens.filter((i) => i.testador);
  const cont = {
    testadores: base.length,
    todos: usoItens.length,
    ativo: 0,
    esfriando: 0,
    parado: 0,
  };
  // Os contadores de situação seguem o recorte de testadores quando há algum.
  const universo = base.length ? base : usoItens;
  universo.forEach((i) => (cont[i.situacao] = (cont[i.situacao] || 0) + 1));
  Object.keys(cont).forEach((k) => {
    const el = $('uso-ct-' + k);
    if (el) el.textContent = cont[k];
  });
  document
    .querySelectorAll('#uso-chips .filter-chip')
    .forEach((c) => c.classList.toggle('active', c.dataset.uso === usoFiltro));
  const lista =
    usoFiltro === 'todos'
      ? usoItens
      : usoFiltro === 'testadores'
        ? base
        : universo.filter((i) => i.situacao === usoFiltro);
  const tb = $('uso-lista');
  if (!lista.length) {
    tb.innerHTML =
      '<tr><td colspan="5" class="tbl-empty">' +
      (usoFiltro === 'testadores'
        ? 'Nenhum convite foi usado ainda. Veja em "Todos".'
        : 'Ninguém neste filtro.') +
      '</td></tr>';
    return;
  }
  tb.innerHTML = lista
    .map((i) => {
      const quem = i.nota
        ? `<strong>${escHTML(i.nota)}</strong><div style="font-size:11.5px;color:var(--cor-texto-mutado);">${escHTML(i.email || i.uid)}</div>`
        : `<strong>${escHTML(i.email || i.uid)}</strong>${i.testador ? '' : '<div style="font-size:11.5px;color:var(--cor-texto-mutado);">sem convite</div>'}`;
      const uso = i.ultimoUsoMs
        ? `<div>${relativeTime(i.ultimoUsoMs)}<div style="font-size:11.5px;color:var(--cor-texto-mutado);">${fmtDateTime(i.ultimoUsoMs)}</div></div>`
        : '<span style="color:var(--cor-texto-mutado);">nunca lançou</span>';
      // Uma linha por área, a mais recente primeiro: quando foi a última vez
      // que a pessoa mexeu em cada parte do app.
      const areas = i.areas.length
        ? `<div class="uso-areas">${i.areas
            .map(
              (a) =>
                `<div class="uso-area${a.soConectou ? ' so-conectou' : ''}"><span>${escHTML(a.area)}</span><span title="${a.ms ? fmtDateTime(a.ms) : ''}">${
                  a.soConectou
                    ? 'conectou' + (a.ms ? ' em ' + fmtDate(a.ms) : '') + ', nunca lançou'
                    : a.ms
                      ? `${fmtDiaHora(a.ms)} · ${relativeTime(a.ms)}`
                      : '—'
                }</span></div>`
            )
            .join('')}</div>`
        : '—';
      return `<tr>
        <td>${quem}${i.suspenso ? ' <span class="badge-s badge-danger">suspenso</span>' : ''}</td>
        <td style="white-space:nowrap;">${i.criadoMs ? fmtDate(i.criadoMs) : '—'}</td>
        <td style="white-space:nowrap;">${uso}</td>
        <td>${usoSituacaoBadge(i.situacao)}</td>
        <td>${areas}</td>
      </tr>`;
    })
    .join('');
}

function usoFiltrar(f) {
  usoFiltro = f;
  usoRender();
}

async function loadUso() {
  try {
    const data = await adminPost({ action: 'uso_listar' });
    usoItens = data.itens || [];
    // Sem nenhum testador ainda, abrir em "Todos" em vez de uma lista vazia.
    if (usoFiltro === 'testadores' && !usoItens.some((i) => i.testador)) usoFiltro = 'todos';
    usoRender();
  } catch (err) {
    $('uso-lista').innerHTML =
      `<tr><td colspan="5" class="tbl-empty" style="color:var(--cor-erro)">Erro: ${escHTML(err.message)}</td></tr>`;
  }
}

async function loadConvites() {
  loadUso();
  try {
    cvRender(await adminPost({ action: 'convites_listar' }));
  } catch (err) {
    $('cv-lista').innerHTML =
      `<tr><td colspan="5" class="tbl-empty" style="color:var(--cor-erro)">Erro: ${escHTML(err.message)}</td></tr>`;
  }
}

async function cvMudarModo(ligar) {
  const msg = ligar
    ? 'Ligar o cadastro só com convite? Quem não tiver código não consegue criar conta.'
    : 'Desligar? O cadastro volta a ser aberto para qualquer pessoa (7 dias grátis e depois assinatura).';
  if (!confirm(msg)) {
    $('cv-obrigatorio').checked = !ligar;
    return;
  }
  try {
    cvRender(await adminPost({ action: 'convites_modo', obrigatorio: ligar }));
    toast(ligar ? 'Cadastro só com convite: LIGADO' : 'Cadastro aberto novamente', 'success');
  } catch (err) {
    $('cv-obrigatorio').checked = !ligar;
    toast('Erro: ' + err.message, 'error');
  }
}

async function cvSalvarLancamento() {
  const data = $('cv-lancamento').value; // 'aaaa-mm-dd' ou '' (limpar)
  const msg = data
    ? 'Definir o lançamento em ' +
      data.split('-').reverse().join('/') +
      '? O acesso grátis de TODOS os testadores passa a valer até 1 ano depois desta data.'
    : 'Apagar a data de lançamento? Os testadores voltam a ter acesso grátis sem prazo até você definir uma data.';
  if (!confirm(msg)) return;
  try {
    const r = await adminPost({ action: 'convites_lancamento', data });
    cvRender(r);
    toast(
      'Data salva. ' + (r.recalculados || 0) + ' testador(es) com o prazo recalculado.',
      'success'
    );
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

async function cvGerar() {
  const nota = $('cv-nota').value.trim();
  const quantidade = Math.max(1, Math.min(50, parseInt($('cv-qtd').value, 10) || 1));
  try {
    const r = await adminPost({ action: 'convites_gerar', nota, quantidade });
    cvRender(r);
    const novos = r.criados || [];
    const texto = (c) =>
      `Você foi convidado(a) para testar o Appliquei! Crie sua conta por este link (o código já vem preenchido): ${cvLink(c)}\nSeu código: ${c}`;
    $('cv-novos').innerHTML = novos
      .map(
        (
          c
        ) => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;border:1px dashed var(--cor-borda);border-radius:10px;margin-bottom:8px;">
          <strong style="font-family:'DM Mono',monospace;">${escHTML(c)}</strong>
          <span style="font-size:12px;color:var(--cor-texto-mutado);flex:1;min-width:200px;word-break:break-all;">${escHTML(cvLink(c))}</span>
          <button class="btn-sec" onclick="cvCopiar('${escHTML(c)}')"><i class="ph ph-copy"></i> Copiar link</button>
          <a class="btn-sec" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(texto(c))}"><i class="ph ph-whatsapp-logo"></i> WhatsApp</a>
        </div>`
      )
      .join('');
    $('cv-nota').value = '';
    toast(novos.length === 1 ? 'Convite gerado' : novos.length + ' convites gerados', 'success');
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

async function cvCopiar(codigo) {
  const link = cvLink(codigo);
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copiado: ' + link, 'success');
  } catch (_) {
    prompt('Copie o link do convite:', link);
  }
}

async function cvCancelar(codigo) {
  if (!confirm('Cancelar o convite ' + codigo + '? Ele deixa de funcionar.')) return;
  try {
    cvRender(await adminPost({ action: 'convites_cancelar', codigo }));
    toast('Convite cancelado', 'success');
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

// ─── REDES SOCIAIS (Instagram) ─────────────────────────────────
var RD_SERIES = {
  news: 'Appliquei News',
  explica: 'Appliquei Explica',
  appliquei: 'Appliquei (reta final)',
  outros: 'Outros',
};

function rdNum(v) {
  return v == null ? '—' : formatInt(v);
}
function rdPct(v) {
  return v == null ? '—' : String(v).replace('.', ',') + '%';
}
function rdSeg(v) {
  return v == null ? '—' : String(v).replace('.', ',') + ' s';
}

async function loadRedes(forcar) {
  const token = sessionStorage.getItem('adminToken');
  if (!token) return;
  const aviso = $('rd-aviso');
  aviso.style.display = 'none';
  try {
    const res = await fetch('/api/admin/stats?include=redes' + (forcar ? '&refresh=1' : ''), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    if (d.configurado === false) {
      aviso.style.display = '';
      aviso.innerHTML =
        '<b>Instagram ainda não conectado.</b> Defina <code>IG_TOKEN</code> nas variáveis do Vercel ' +
        '(token da Instagram API com login do Instagram, permissões instagram_business_basic e ' +
        'instagram_business_manage_insights). Depois disso o token se renova sozinho.';
      return;
    }
    if (!res.ok) throw new Error(d.detail || 'Falha ao ler o Instagram');
    rdRender(d);
  } catch (err) {
    aviso.style.display = '';
    aviso.textContent = 'Erro ao ler o Instagram: ' + err.message;
  }
}

function rdRender(d) {
  const r = d.resumo || {};
  $('rd-seguidores').textContent = rdNum(r.seguidores);
  $('rd-usuario').textContent = r.usuario
    ? '@' + r.usuario + ' · ' + rdNum(r.publicacoes) + ' publicações'
    : '';
  $('rd-views').textContent = rdNum(r.views30d);
  $('rd-views-sub').textContent =
    rdNum(r.reels30d) + ' Reels · média de ' + rdNum(r.viewsMedia30d) + ' por Reel';
  $('rd-salvos').textContent = rdNum(r.salvos30d);
  $('rd-salvos-sub').textContent = 'média de ' + rdPct(r.taxaSalvosMedia30d) + ' do alcance';
  $('rd-compart').textContent = rdNum(r.compartilhamentos30d);
  $('rd-compart-sub').textContent =
    'média de ' + rdPct(r.taxaCompartilhamentosMedia30d) + ' do alcance';
  $('rd-retencao').textContent = rdPct(r.pctAssistidoMedio30d);
  $('rd-retencao-sub').textContent =
    'tempo médio ' +
    rdSeg(r.tempoMedioSeg30d) +
    ' · ' +
    (r.viewsPorPessoa30d == null
      ? '—'
      : String(r.viewsPorPessoa30d).replace('.', ',') + ' views por pessoa');
  $('rd-seguiu').textContent = rdNum(r.seguiuPorReels30d);
  $('rd-seguiu-sub').textContent =
    'nos Reels de 30 dias · ' + rdNum(r.visitasPerfilReels30d) + ' visitas ao perfil vindas deles';
  $('rd-visitas').textContent = rdNum(r.visitasPerfil30d ?? r.visitasPerfilReels30d);
  $('rd-visitas-sub').textContent = rdNum(r.contasEngajadas30d) + ' contas engajadas';
  $('rd-cliques').textContent = rdNum(r.cliquesLink30d);
  $('rd-cliques-sub').textContent = 'alcance da conta: ' + rdNum(r.alcanceConta30d);

  const series = (r.series || []).slice().sort((a, b) => (b.viewsMedia || 0) - (a.viewsMedia || 0));
  $('rd-series').innerHTML =
    '<thead><tr><th>Série</th><th style="text-align:right">Reels</th><th style="text-align:right">Views (média)</th>' +
    '<th style="text-align:right">Salvos</th><th style="text-align:right">Compart.</th><th style="text-align:right">Tempo médio</th>' +
    '<th style="text-align:right">Retenção</th><th style="text-align:right">Seguiram</th></tr></thead><tbody>' +
    series
      .map(
        (s) =>
          `<tr><td>${escHTML(RD_SERIES[s.serie] || s.serie)}</td><td style="text-align:right">${rdNum(s.reels)}</td>` +
          `<td style="text-align:right">${rdNum(s.viewsMedia)}</td><td style="text-align:right">${rdPct(s.taxaSalvosMedia)}</td>` +
          `<td style="text-align:right">${rdPct(s.taxaCompartilhamentosMedia)}</td><td style="text-align:right">${rdSeg(s.tempoMedioSeg)}</td>` +
          `<td style="text-align:right">${rdPct(s.pctAssistidoMedio)}</td><td style="text-align:right">${rdNum(s.seguiu)}</td></tr>`
      )
      .join('') +
    '</tbody>';

  const destaque = new Set(d.destaques || []);
  $('rd-reels').innerHTML =
    '<thead><tr><th>Data</th><th>Reel</th><th>Série</th><th style="text-align:right">Views</th><th style="text-align:right">Alcance</th>' +
    '<th style="text-align:right">Curtidas</th><th style="text-align:right">Coment.</th><th style="text-align:right">Salvos</th>' +
    '<th style="text-align:right">Compart.</th><th style="text-align:right">Tempo médio</th><th style="text-align:right">Retenção</th>' +
    '<th style="text-align:right">Seguiram</th><th style="text-align:right">Engaj.</th></tr></thead><tbody>' +
    (d.reels || [])
      .map((x) => {
        const dt = x.data
          ? new Date(x.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
          : '—';
        const titulo = escHTML(x.titulo || '(sem legenda)');
        const link = x.link
          ? `<a href="${escHTML(x.link)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">${titulo}</a>`
          : titulo;
        return (
          `<tr><td>${dt}</td><td style="min-width:280px">${destaque.has(x.id) ? '⭐ ' : ''}${link}</td><td>${escHTML(RD_SERIES[x.serie] || x.serie)}</td>` +
          `<td style="text-align:right">${rdNum(x.views)}</td><td style="text-align:right">${rdNum(x.alcance)}</td>` +
          `<td style="text-align:right">${rdNum(x.curtidas)}</td><td style="text-align:right">${rdNum(x.comentarios)}</td>` +
          `<td style="text-align:right">${rdNum(x.salvos)} <small>${rdPct(x.taxaSalvos)}</small></td>` +
          `<td style="text-align:right">${rdNum(x.compartilhamentos)} <small>${rdPct(x.taxaCompartilhamentos)}</small></td>` +
          `<td style="text-align:right">${rdSeg(x.tempoMedioSeg)}${x.duracaoSeg ? ` <small>de ${rdSeg(x.duracaoSeg)}</small>` : ''}</td>` +
          `<td style="text-align:right">${rdPct(x.pctAssistido)}</td><td style="text-align:right">${rdNum(x.seguiu)}</td>` +
          `<td style="text-align:right">${rdPct(x.taxaEngajamento)}</td></tr>`
        );
      })
      .join('') +
    '</tbody>';
  $('rd-atualizado').textContent =
    (d.doCache ? 'Do cache · ' : '') +
    'atualizado em ' +
    new Date(d.atualizadoEm).toLocaleString('pt-BR') +
    ' · ⭐ = os 3 com mais compartilhamentos e salvos';
}
