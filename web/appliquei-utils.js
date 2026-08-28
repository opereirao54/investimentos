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
 *  - Recomeçar do zero (abrirModalRecomecar, executarRecomecarDoZero)
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
    bens: JSON.parse(localStorage.getItem('appliquei_bens') || '[]'),
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

// Restauração de backup. É o ÚNICO ponto legítimo que grava
// futurorico_transacoes sem passar por salvarTransacoes(): aqui a fonte é o
// arquivo do usuário (`dados.transacoes`), não o array global `transacoes` —
// que ainda tem o conteúdo antigo neste instante. Chamar a função canônica
// gravaria os dados velhos por cima da importação. A página recarrega logo
// depois, e é o boot que repovoa o global a partir do que ficou gravado.
// Ver .claude/integracoes/mapa.json → RISCO-01 e test/transacoes-escrita-canonica.test.js.
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
    if (dados.bens) localStorage.setItem('appliquei_bens', JSON.stringify(dados.bens));
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
    if (typeof bens !== 'undefined') {
      bens = JSON.parse(localStorage.getItem('appliquei_bens') || '[]');
      if (typeof window !== 'undefined') window.bens = bens;
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

// --- RECOMEÇAR DO ZERO ---
//
// Apaga tudo o que o usuário registrou e devolve a Appliquei ao estado de
// primeiro uso, sem mexer na conta, na assinatura nem no Applicash.
//
// A remoção passa pelo interceptador de `removeItem` (mais abaixo neste
// arquivo), que avisa o AppliqueiCloudSync: cada chave vira um tombstone com
// rev, a deleção sobe para o Firestore e alcança os outros aparelhos. Um
// `localStorage.clear()` aqui limparia só este device — e o próximo pull
// traria tudo de volta.

// Palavra que o usuário digita para confirmar. Comparada sem acento e sem
// diferenciar maiúsculas (ver _normalizarConfirmacaoReset).
var RESET_PALAVRA_CONFIRMACAO = 'RECOMECAR';

// Chaves com prefixo de app que NÃO são anotações do usuário e por isso
// sobrevivem ao reset: identidade, indicações (vêm do backend) e preferências
// puramente visuais. Todo o resto em futurorico_*/appliquei_* é apagado —
// blocklist em vez de allowlist para que uma feature nova entre no reset
// automaticamente, sem precisar lembrar de atualizar esta lista.
var RESET_CHAVES_PRESERVADAS = [
  'appliquei_auth_guest', // estado do gate de autenticação
  'appliquei_user_id', // id local que gera o cupom de indicação
  'appliquei_cupom_codigo', // cupom do usuário (vem do backend)
  'appliquei_applicash_indicacoes',
  'appliquei_applicash_assinatura',
  'appliquei_applicash_creditos',
  'appliquei_applicash_resumo',
  'appliquei_email_verify_snooze',
  'appliquei_valores_ocultos', // preferência de UI
  'appliquei_sidebar_collapsed', // preferência de UI
];

function _ehChavePreservadaNoReset(key) {
  if (typeof key !== 'string') return true;
  // appliquei_cloud_*: metadados do sync (revs e tombstones) e caches globais
  // como a carteira modelo. Apagar os tombstones faria o pull seguinte
  // ressuscitar exatamente o que acabamos de apagar.
  if (key.indexOf('appliquei_cloud_') === 0) return true;
  return RESET_CHAVES_PRESERVADAS.indexOf(key) !== -1;
}

// Chaves do localStorage que o "Recomeçar do zero" apaga.
function listarChavesDoUsuario() {
  var chaves = [];
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!_ehChaveApp(k)) continue;
      if (_ehChavePreservadaNoReset(k)) continue;
      chaves.push(k);
    }
  } catch (_) {}
  return chaves;
}

// Contagens mostradas na confirmação — o usuário precisa ver o tamanho do
// estrago antes de aceitar.
function resumoDadosParaApagar() {
  function tamanho(chave) {
    try {
      var v = JSON.parse(localStorage.getItem(chave) || '[]');
      return Array.isArray(v) ? v.length : 0;
    } catch (_) {
      return 0;
    }
  }
  return {
    lancamentos: tamanho('futurorico_transacoes'),
    investimentos: tamanho('futurorico_compras'),
    contas: tamanho('appliquei_contas'),
    cartoes: tamanho('futurorico_cartoes'),
    bens: tamanho('appliquei_bens'),
    sonhos: tamanho('appliquei_sonhos'),
  };
}

function _normalizarConfirmacaoReset(txt) {
  return String(txt == null ? '' : txt)
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
}

// Habilita o botão só quando a palavra está digitada. Chamada pelo oninput do
// campo e uma vez ao abrir o modal (para nascer desabilitado).
function validarConfirmacaoRecomecar() {
  var input = document.getElementById('inputConfirmaRecomecar');
  var btn = document.getElementById('btnConfirmaRecomecar');
  var ok = _normalizarConfirmacaoReset(input && input.value) === RESET_PALAVRA_CONFIRMACAO;
  if (btn) {
    btn.disabled = !ok;
    btn.style.opacity = ok ? '1' : '0.45';
    btn.style.cursor = ok ? 'pointer' : 'not-allowed';
  }
  return ok;
}

function abrirModalRecomecar() {
  var modal = document.getElementById('modalConfirmacao');
  if (!modal) return;
  // O modal de configurações vem depois no DOM e disputaria o mesmo z-index.
  if (typeof fecharModalConfig === 'function') fecharModalConfig();

  var r = resumoDadosParaApagar();
  var itens = [
    [r.lancamentos, 'lançamento', 'lançamentos'],
    [r.investimentos, 'investimento', 'investimentos'],
    [r.contas, 'conta', 'contas'],
    [r.cartoes, 'cartão', 'cartões'],
    [r.bens, 'bem', 'bens'],
    [r.sonhos, 'sonho', 'sonhos'],
  ]
    .filter(function (i) {
      return i[0] > 0;
    })
    .map(function (i) {
      return '<strong>' + i[0] + '</strong> ' + (i[0] === 1 ? i[1] : i[2]);
    });

  var linhaResumo = itens.length
    ? 'Hoje você tem ' + itens.join(' · ') + '.'
    : 'Não encontramos nenhum registro seu para apagar.';

  document.getElementById('modalTitulo').innerHTML =
    '<i class="ph-fill ph-warning-octagon" style="color: var(--cor-erro);"></i> Recomeçar do zero';

  document.getElementById('modalMensagem').innerHTML =
    '<span style="display:block;margin-bottom:10px;">' +
    linhaResumo +
    '</span>' +
    'Vamos apagar <strong>tudo o que você registrou</strong> — lançamentos, investimentos, contas, cartões, bens, sonhos, metas, perfil de investidor e progresso da Jornada.<br><br>' +
    '<span style="display:block;background:var(--cor-bg-erro);border:1px solid var(--cor-borda-erro);color:var(--cor-txt-erro);border-radius:9px;padding:10px 12px;font-size:12.5px;line-height:1.55;margin-bottom:14px;">' +
    '<i class="ph-fill ph-warning" style="vertical-align:-2px;"></i> <strong>Não dá para desfazer.</strong> Se você usa a Appliquei em mais de um aparelho, todos ficam vazios. ' +
    'Sua conta, sua assinatura e o Applicash continuam ativos.' +
    '</span>' +
    '<label for="inputConfirmaRecomecar" style="display:block;font-size:12px;font-weight:600;color:var(--cor-texto-secundario);margin-bottom:6px;">' +
    'Para confirmar, digite <strong style="font-family:\'DM Mono\',monospace;color:var(--cor-erro);">' +
    RESET_PALAVRA_CONFIRMACAO +
    '</strong></label>' +
    '<input type="text" id="inputConfirmaRecomecar" autocomplete="off" autocapitalize="characters" spellcheck="false" ' +
    'placeholder="' +
    RESET_PALAVRA_CONFIRMACAO +
    '" oninput="validarConfirmacaoRecomecar()" ' +
    'style="width:100%;padding:10px 13px;border:1.5px solid var(--cor-borda);border-radius:9px;font-size:14px;' +
    "font-family:'DM Mono',monospace;letter-spacing:1px;text-transform:uppercase;background:var(--cor-superficie);color:var(--cor-texto-principal);\">";

  // `background` e não `background-color`: .btn-acao pinta um gradiente verde
  // (background-image), que fica POR CIMA de qualquer background-color inline —
  // o botão destrutivo sairia idêntico ao "Salvar". O shorthand limpa a imagem.
  document.getElementById('modalAcoes').innerHTML =
    '<button class="btn-secundario" onclick="exportarDados()"><i class="ph ph-download-simple"></i> Baixar backup antes</button>' +
    '<button class="btn-acao" id="btnConfirmaRecomecar" style="background:var(--cor-erro);box-shadow:0 2px 8px rgba(220,38,38,0.25);" onclick="executarRecomecarDoZero()">' +
    '<i class="ph ph-trash"></i> Apagar tudo e recomeçar</button>';

  modal.style.display = 'flex';
  validarConfirmacaoRecomecar();
  // Teclado virtual no mobile cobriria o texto do aviso antes de ser lido.
  if (!isMobileViewport()) {
    setTimeout(function () {
      var input = document.getElementById('inputConfirmaRecomecar');
      if (input && input.focus) input.focus();
    }, 150);
  }
}

function executarRecomecarDoZero() {
  if (!validarConfirmacaoRecomecar()) {
    mostrarToast('Digite ' + RESET_PALAVRA_CONFIRMACAO + ' para confirmar.', 'aviso');
    return 0;
  }

  var btn = document.getElementById('btnConfirmaRecomecar');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-circle-notch"></i> Apagando…';
  }

  var apagadas = 0;
  listarChavesDoUsuario().forEach(function (k) {
    try {
      localStorage.removeItem(k);
      apagadas++;
    } catch (_) {}
  });

  // Empurra as deleções agora, pelos dois caminhos (ambos idempotentes):
  // o SDK manda FieldValue.delete() por chave; o beacon manda null para
  // /api/sync/push, que faz LWW por rev no servidor. Se nenhum sair a tempo,
  // os tombstones ficam em appliquei_cloud_deletions e seguem no próximo boot.
  try {
    if (window.AppliqueiCloudSync) {
      if (typeof AppliqueiCloudSync.forceFlush === 'function') AppliqueiCloudSync.forceFlush();
      if (typeof AppliqueiCloudSync.beaconNow === 'function') AppliqueiCloudSync.beaconNow();
    }
  } catch (_) {}

  mostrarToast('Pronto! Recomeçando a Appliquei do zero…', 'sucesso', 2500);

  // Recarrega em vez de zerar o estado em memória de ~20 módulos (transacoes,
  // historicoCompras, contas, bens, sonhos, dbCarteira, cartEstado…): o boot
  // relê tudo do localStorage já vazio. A espera também dá tempo do push sair.
  setTimeout(function () {
    try {
      window.location.reload();
    } catch (_) {}
  }, 1500);

  return apagadas;
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

// CAUSA RAIZ de "cadastrei no celular e não apareceu no PC" (DIAGNOSTICO-SYNC.md).
//
// Este interceptador é o ÚNICO gatilho do sync: sem ele, onLocalWrite nunca é
// chamado, nenhuma chave é marcada como suja e nada é enviado — nunca.
//
// Ele era instalado com `localStorage.setItem = function(...)`. Storage é um
// legacy platform object com setter de propriedade nomeada: em navegadores que
// seguem o WebIDL à risca (Safari/iOS), atribuir uma propriedade que não é own
// property vai para o setter nomeado — grava um ITEM chamado "setItem" e NÃO
// sombreia o método do protótipo. Em Chrome sombreia e tudo funciona; no
// iPhone o interceptador ficava instalado num lugar por onde nada passava.
//
// Medido no aparelho, não deduzido: a sonda registrou
// `GRAVA futurorico_transacoes 354KB via prototipo` seguida do toast de
// sucesso e de NENHUM aviso ao sync. Duas confirmações independentes.
//
// Patch no protótipo funciona nos dois casos. O guard `this !== localStorage`
// existe porque sessionStorage compartilha este mesmo protótipo e não deve ser
// interceptado.
var _storageProto = Object.getPrototypeOf(localStorage);
var _setItemNative = _storageProto.setItem;
var _removeItemNative = _storageProto.removeItem;
var _getItemNative = _storageProto.getItem;

function _setItemOriginal(key, value) {
  return _setItemNative.call(localStorage, key, value);
}
function _getItemOriginal(key) {
  return _getItemNative.call(localStorage, key);
}

function _ehChaveApp(key) {
  return (
    typeof key === 'string' && (key.indexOf('futurorico_') === 0 || key.indexOf('appliquei_') === 0)
  );
}

_storageProto.setItem = function (key, value) {
  if (this !== localStorage) return _setItemNative.call(this, key, value);
  return _interceptarSetItem(key, value);
};

function _interceptarSetItem(key, value) {
  // Migrações de boot reescrevem várias keys com o MESMO conteúdo (ex.: futurorico_transacoes
  // na linha 5470, futurorico_cartoes na 5432). Sem este short-circuit, o sync cloud
  // marcaria essas keys como "alteradas agora" e o pull subsequente perderia escritas
  // genuínas vindas de outros devices (mobile → web): localRev=Date.now() > remoteRev.
  var prev = null;
  var notify = true;
  if (_ehChaveApp(key)) {
    try {
      prev = _getItemOriginal(key);
    } catch (_) {}
    if (prev === String(value)) notify = false;
  }
  _setItemOriginal(key, value);
  if (_ehChaveApp(key)) atualizarUltimoSalvo();
  if (
    notify &&
    window.AppliqueiCloudSync &&
    typeof AppliqueiCloudSync.onLocalWrite === 'function'
  ) {
    try {
      AppliqueiCloudSync.onLocalWrite(key);
    } catch (_) {}
  }
}

function _removeItemOriginal(key) {
  return _removeItemNative.call(localStorage, key);
}

_storageProto.removeItem = function (key) {
  if (this !== localStorage) return _removeItemNative.call(this, key);
  return _interceptarRemoveItem(key);
};

function _interceptarRemoveItem(key) {
  var existed = false;
  if (_ehChaveApp(key)) {
    try {
      existed = _getItemOriginal(key) !== null;
    } catch (_) {}
  }
  _removeItemOriginal(key);
  if (_ehChaveApp(key)) atualizarUltimoSalvo();
  if (
    existed &&
    window.AppliqueiCloudSync &&
    typeof AppliqueiCloudSync.onLocalDelete === 'function'
  ) {
    try {
      AppliqueiCloudSync.onLocalDelete(key);
    } catch (_) {}
  }
}
