/**
 * Appliquei — utilities compartilhadas (Onda 3).
 *
 * Extraído de web/appliquei-app.js para um arquivo independente, cacheável,
 * carregado SÍNCRONO antes de app.js (classic <script src> ordena). As
 * funções viram globais por estarem em script clássico — mantém compat com
 * onclick handlers em HTML e com o resto de app.js que as chama em parse-time.
 *
 * Conteúdo:
 *  - Máscara para campo Quantidade (formatarQtd, parseQtd, etc.)
 *  - BRL helpers (parseBRL, formatarBRLInput, máscaras de input monetário)
 *  - Toast notifications (mostrarToast)
 *  - Exportação / Importação de backup (exportarDados, importarDados,
 *    confirmarImportacao)
 *
 * Quando app.js virar module (Onda 4+), este arquivo também migra.
 */

// ============================================================
// --- Máscara para campo Quantidade ---
// Permite frações até 8 casas decimais (padrão de criptomoedas, ex.: 0,000087 BTC).
// Não reformata a parte decimal enquanto o usuário digita — só remove
// caracteres inválidos e limita o número de vírgulas. O parse final
// (parseQtd) converte para Number ao gravar.
var QTD_MAX_DECIMAIS = 8;
function aplicarMascaraQtd(input) {
  let v = String(input.value || '');
  v = v.replace(/[^\d.,]/g, '');
  // Em pt-BR a vírgula é decimal; pontos são separadores de milhar.
  // Separamos parte inteira e decimal pela primeira vírgula.
  const idxVirg = v.indexOf(',');
  let inteiroStr, decimalStr, temDecimal;
  if (idxVirg === -1) {
    inteiroStr = v.replace(/\./g, '');
    temDecimal = false;
    decimalStr = '';
  } else {
    inteiroStr = v.slice(0, idxVirg).replace(/[.,]/g, '');
    decimalStr = v.slice(idxVirg + 1).replace(/[.,]/g, '');
    if (decimalStr.length > QTD_MAX_DECIMAIS) decimalStr = decimalStr.slice(0, QTD_MAX_DECIMAIS);
    temDecimal = true;
  }
  // Remove zeros à esquerda exceto se for o único dígito (preserva "0").
  const inteiroDigits = inteiroStr.replace(/^0+(?=\d)/, '');
  let inteiroFmt;
  if (inteiroDigits === '') {
    inteiroFmt = temDecimal ? '0' : '';
  } else {
    inteiroFmt = Number(inteiroDigits).toLocaleString('pt-BR');
  }
  input.value = temDecimal ? inteiroFmt + ',' + decimalStr : inteiroFmt;
}
function parseQtd(str) {
  if (str == null) return 0;
  if (typeof str === 'number') return Number.isFinite(str) ? str : 0;
  // Idêntica regra do parseBRL: ponto = milhar, última vírgula = decimal.
  let limpo = String(str)
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '');
  const ultimaVirgula = limpo.lastIndexOf(',');
  if (ultimaVirgula !== -1) {
    limpo =
      limpo.slice(0, ultimaVirgula).replace(/,/g, '') +
      '.' +
      limpo.slice(ultimaVirgula + 1).replace(/,/g, '');
  }
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : 0;
}
function setValorQtdInput(input, valor) {
  if (!input) return;
  if (valor === '' || valor == null) {
    input.value = '';
    return;
  }
  const n = Number(valor);
  if (!Number.isFinite(n)) {
    input.value = '';
    return;
  }
  // Preserva até 8 casas decimais sem zeros à direita.
  input.value = n.toLocaleString('pt-BR', { maximumFractionDigits: QTD_MAX_DECIMAIS });
}
function formatarQtd(valor) {
  const n = Number(valor) || 0;
  return n.toLocaleString('pt-BR', { maximumFractionDigits: QTD_MAX_DECIMAIS });
}

// --- Date helpers (padronização de fuso) ---
// Datas "YYYY-MM-DD" (date-only) viram MEIO-DIA LOCAL para não "vazar" para o
// dia/mês anterior em fusos negativos (ex.: UTC-3 — `new Date('2024-01-01')`
// é meia-noite UTC = 31/12 21:00 em SP). ISO completo e timestamps passam
// direto. Use sempre que for derivar mês/ano de um campo de data persistido.
function appliqueiParseData(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T12:00:00');
    return new Date(s);
  }
  return new Date(NaN);
}

// Mês/ano locais de um campo de data persistido, com parsing padronizado.
function appliqueiMesAnoDe(value) {
  const d = appliqueiParseData(value);
  if (isNaN(d.getTime())) return { mes: undefined, ano: undefined, valido: false };
  return { mes: d.getMonth(), ano: d.getFullYear(), valido: true };
}

// --- BRL helpers (máscara em inputs monetários) ---
// Retorna sempre Number finito (nunca string/NaN/Infinity). Strings vazias
// ou sem dígitos viram 0. Entradas com múltiplas vírgulas (ex.: "1,234,56")
// usam só a última como separador decimal — qualquer outra é descartada.
function parseBRL(str) {
  if (str == null) return 0;
  if (typeof str === 'number') return Number.isFinite(str) ? str : 0;
  let limpo = String(str).replace(/[^\d,.-]/g, '');
  // Em pt-BR o ponto é separador de milhar e a vírgula é decimal.
  // Remove pontos (milhares) e converte a última vírgula em ponto.
  limpo = limpo.replace(/\./g, '');
  const ultimaVirgula = limpo.lastIndexOf(',');
  if (ultimaVirgula !== -1) {
    limpo =
      limpo.slice(0, ultimaVirgula).replace(/,/g, '') +
      '.' +
      limpo.slice(ultimaVirgula + 1).replace(/,/g, '');
  }
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : 0;
}
function formatarBRLInput(valor) {
  const n = typeof valor === 'number' ? valor : parseBRL(valor);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function aplicarMascaraBRL(input) {
  const apenasDigitos = (input.value || '').replace(/\D/g, '');
  if (!apenasDigitos) {
    input.value = '';
    return;
  }
  const numero = parseInt(apenasDigitos, 10) / 100;
  input.value = numero.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function setValorBRLInput(input, valor) {
  if (!input) return;
  input.value = valor === '' || valor == null ? '' : formatarBRLInput(valor);
}
function inicializarMascarasBRL() {
  document.querySelectorAll('input[data-brl="1"]').forEach((inp) => {
    if (inp.value !== '') setValorBRLInput(inp, inp.value);
  });
}

// ============================================================
// --- TOAST NOTIFICATIONS ---
function mostrarToast(mensagem, tipo = 'sucesso', duracao = 3500) {
  const container = document.getElementById('toast-container');
  const icons = {
    sucesso: 'ph-fill ph-check-circle',
    erro: 'ph-fill ph-x-circle',
    aviso: 'ph-fill ph-warning',
    info: 'ph-fill ph-info',
  };
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.innerHTML = `<i class="${icons[tipo] || icons.info}"></i><span>${mensagem}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('saindo');
    toast.addEventListener('animationend', () => toast.remove());
  }, duracao);
}

// --- EXPORTAÇÃO / IMPORTAÇÃO ---
function exportarDados() {
  const dados = {
    versao: 'v7',
    exportadoEm: new Date().toISOString(),
    compras: JSON.parse(localStorage.getItem('futurorico_compras') || '[]'),
    transacoes: JSON.parse(localStorage.getItem('futurorico_transacoes') || '[]'),
    carteira_admin: JSON.parse(localStorage.getItem('futurorico_carteira_admin') || 'null'),
    cartoes: JSON.parse(localStorage.getItem('futurorico_cartoes') || '[]'),
    contas: JSON.parse(localStorage.getItem('appliquei_contas') || '[]'),
    limiteCartao: localStorage.getItem('futurorico_limiteCartao'),
    metaVerde: localStorage.getItem('futurorico_metaVerde'),
    metaVermelha: localStorage.getItem('futurorico_metaVermelha'),
  };
  const json = JSON.stringify(dados, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `appliquei_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  mostrarToast('Backup exportado com sucesso!', 'sucesso');
}

function importarDados(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const dados = JSON.parse(e.target.result);
      if (!dados.compras && !dados.transacoes) throw new Error('Arquivo inválido');
      const modal = document.getElementById('modalConfirmacao');
      document.getElementById('modalTitulo').innerHTML =
        `<i class="ph-fill ph-upload-simple" style="color: var(--cor-info);"></i> Importar Backup`;
      document.getElementById('modalMensagem').innerHTML =
        `Arquivo: <strong>${file.name}</strong><br>Exportado em: <strong>${dados.exportadoEm ? new Date(dados.exportadoEm).toLocaleString('pt-BR') : 'Desconhecido'}</strong><br><br><span style="color: var(--cor-erro); font-weight: 600;">⚠ Atenção: os dados atuais serão <u>substituídos</u>.</span>`;
      document.getElementById('modalAcoes').innerHTML =
        `<button class="btn-acao" style="background-color: var(--cor-info);" onclick="confirmarImportacao(${JSON.stringify(JSON.stringify(dados)).replace(/"/g, '&quot;')})"><i class="ph ph-upload-simple"></i> Sim, importar dados</button>`;
      modal.style.display = 'flex';
    } catch (err) {
      mostrarToast('Arquivo inválido. Selecione um backup exportado pelo Appliquei.', 'erro');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function confirmarImportacao(dadosStr) {
  try {
    const dados = JSON.parse(dadosStr);
    if (dados.compras) localStorage.setItem('futurorico_compras', JSON.stringify(dados.compras));
    if (dados.transacoes)
      localStorage.setItem('futurorico_transacoes', JSON.stringify(dados.transacoes));
    if (dados.carteira_admin)
      localStorage.setItem('futurorico_carteira_admin', JSON.stringify(dados.carteira_admin));
    if (dados.cartoes) localStorage.setItem('futurorico_cartoes', JSON.stringify(dados.cartoes));
    if (dados.contas) localStorage.setItem('appliquei_contas', JSON.stringify(dados.contas));
    if (dados.limiteCartao) localStorage.setItem('futurorico_limiteCartao', dados.limiteCartao);
    if (dados.metaVerde) localStorage.setItem('futurorico_metaVerde', dados.metaVerde);
    if (dados.metaVermelha) localStorage.setItem('futurorico_metaVermelha', dados.metaVermelha);

    historicoCompras = JSON.parse(localStorage.getItem('futurorico_compras') || '[]');
    transacoes = JSON.parse(localStorage.getItem('futurorico_transacoes') || '[]');
    cartoes = JSON.parse(localStorage.getItem('futurorico_cartoes') || '[]');
    if (cartoes.length === 0)
      cartoes.push({
        id: 'card_padrao',
        nome: 'Cartão principal',
        limite: 5000,
        diaVencimento: null,
      });
    if (typeof contas !== 'undefined') {
      contas = JSON.parse(localStorage.getItem('appliquei_contas') || '[]');
      if (typeof window !== 'undefined') window.contas = contas;
    }
    dbCarteira = cartCarregarDB();

    fecharModal();
    carregarMetas();
    atualizarCarteiraAtivos();
    atualizarTelaControle();
    atualizarDatalistDescricoes();
    mostrarToast('Dados importados com sucesso!', 'sucesso');
  } catch (err) {
    fecharModal();
    mostrarToast('Erro ao importar. O arquivo pode estar corrompido.', 'erro');
  }
}

function isMobileViewport() {
  try {
    return window.matchMedia('(max-width: 768px)').matches;
  } catch (_) {
    return window.innerWidth <= 768;
  }
}
function openMobileNav() {
  document.getElementById('mainSidebar').classList.add('mobile-open');
  document.getElementById('sidebarBackdrop').classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeMobileNav() {
  document.getElementById('mainSidebar').classList.remove('mobile-open');
  document.getElementById('sidebarBackdrop').classList.remove('active');
  document.body.style.overflow = '';
}
function toggleMobileNav() {
  const sb = document.getElementById('mainSidebar');
  if (sb.classList.contains('mobile-open')) closeMobileNav();
  else openMobileNav();
}
window.addEventListener('resize', function () {
  if (!isMobileViewport()) closeMobileNav();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeMobileNav();
});

function toggleSidebar() {
  // Em mobile o toggle não recolhe — abre/fecha o drawer
  if (isMobileViewport()) {
    toggleMobileNav();
    return;
  }
  const sidebar = document.getElementById('mainSidebar'),
    icon = document.getElementById('iconToggle');
  const collapsed = sidebar.classList.toggle('collapsed');

  icon.className = collapsed ? 'ph ph-sidebar' : 'ph ph-sidebar-simple';
  document.getElementById('btnToggleSidebar').title = collapsed ? 'Expandir menu' : 'Recolher menu';

  // Troca de visual (ícone vs ícone+texto) é 100% CSS via .sidebar.collapsed .logo-txt.

  localStorage.setItem('appliquei_sidebar_collapsed', collapsed ? '1' : '0');
}

(function () {
  if (localStorage.getItem('appliquei_sidebar_collapsed') === '1') {
    const sidebar = document.getElementById('mainSidebar');
    sidebar.classList.add('collapsed');
    const icon = document.getElementById('iconToggle');
    if (icon) icon.className = 'ph ph-sidebar';
  }
})();

function atualizarUltimoSalvo() {
  const el = document.getElementById('ultimoSalvoTxt');
  if (!el) return;
  const agora = new Date();
  el.textContent = `Salvo às ${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
}

var _setItemOriginal = localStorage.setItem.bind(localStorage);
var _getItemOriginal = localStorage.getItem.bind(localStorage);
localStorage.setItem = function (key, value) {
  // Migrações de boot reescrevem várias keys com o MESMO conteúdo (ex.: futurorico_transacoes
  // na linha 5470, futurorico_cartoes na 5432). Sem este short-circuit, o sync cloud
  // marcaria essas keys como "alteradas agora" e o pull subsequente perderia escritas
  // genuínas vindas de outros devices (mobile → web): localRev=Date.now() > remoteRev.
  var prev = null;
  var notify = true;
  if (key && (key.indexOf('futurorico_') === 0 || key.indexOf('appliquei_') === 0)) {
    try {
      prev = _getItemOriginal(key);
    } catch (_) {}
    if (prev === String(value)) notify = false;
  }
  _setItemOriginal(key, value);
  if (key.startsWith('futurorico_') || key.startsWith('appliquei_')) atualizarUltimoSalvo();
  if (
    notify &&
    window.AppliqueiCloudSync &&
    typeof AppliqueiCloudSync.onLocalWrite === 'function'
  ) {
    try {
      AppliqueiCloudSync.onLocalWrite(key);
    } catch (_) {}
  }
};
var _removeItemOriginal = localStorage.removeItem.bind(localStorage);
localStorage.removeItem = function (key) {
  var existed = false;
  if (key && (key.indexOf('futurorico_') === 0 || key.indexOf('appliquei_') === 0)) {
    try {
      existed = _getItemOriginal(key) !== null;
    } catch (_) {}
  }
  _removeItemOriginal(key);
  if (key && (key.startsWith('futurorico_') || key.startsWith('appliquei_')))
    atualizarUltimoSalvo();
  if (
    existed &&
    window.AppliqueiCloudSync &&
    typeof AppliqueiCloudSync.onLocalDelete === 'function'
  ) {
    try {
      AppliqueiCloudSync.onLocalDelete(key);
    } catch (_) {}
  }
};
