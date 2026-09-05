/**
 * Appliquei — ABA 2: Controle Financeiro e DRE.
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script, carregado
 * DEPOIS de app.js porque depende de state global (transacoes, cartoes)
 * e helpers (formatarMoeda em app.js, parseBRL/mostrarToast em utils.js).
 *
 * Estado local da aba: visaoMes, visaoAno, qtdMesesDRE, offsetMesesDRE,
 * chartComposicao. Funções top-level são globais — chamadas por troca
 * de aba e por onclick handlers no HTML (~80 referências).
 *
 * Sem IIFEs de parse-time — pode carregar em qualquer momento depois
 * de app.js.
 */

// --- ABA 2: CONTROLE FINANCEIRO E DRE ---
var visaoMes = new Date().getMonth();
var visaoAno = new Date().getFullYear();
var qtdMesesDRE = 12; // Variável de controle das abas do DRE
var offsetMesesDRE = 0; // Deslocamento em meses do início do DRE (negativo = passado)
var chartComposicao = null;

function mudarMesVisao(delta) {
  visaoMes += delta;
  if (visaoMes > 11) {
    visaoMes = 0;
    visaoAno++;
  }
  if (visaoMes < 0) {
    visaoMes = 11;
    visaoAno--;
  }
  atualizarTelaControle();
}

function irParaMesAtual() {
  const dataHoje = new Date();
  visaoMes = dataHoje.getMonth();
  visaoAno = dataHoje.getFullYear();
  atualizarTelaControle();
}

function selecionarMesVisao() {
  const inputVal = document.getElementById('inputMesAnoVisao').value;
  if (inputVal) {
    const partes = inputVal.split('-');
    visaoAno = parseInt(partes[0]);
    visaoMes = parseInt(partes[1]) - 1;
    atualizarTelaControle();
  }
}

function mudarMesesDRE(e, meses, offset = 0) {
  qtdMesesDRE = meses;
  offsetMesesDRE = offset;
  const grupoBotoes = e.currentTarget.parentElement;
  const escopo = grupoBotoes || document;
  escopo.querySelectorAll('.btn-tab-dre').forEach((btn) => btn.classList.remove('ativo'));
  e.currentTarget.classList.add('ativo');
  atualizarTelaControle();
}

// Categorias cujo lançamento carrega a instituição (campo `banco`). Entradas
// (receita/resgate) exigem; despesas é opcional, mas quando informado abate o
// caixa da instituição certa em "Por instituição" (Meu Patrimônio) — sem isso
// a despesa paga caía num bucket "Sem banco".
function controleCategoriaUsaBanco(cat) {
  return (
    cat === 'receita' ||
    cat === 'resgate_investimento' ||
    cat === 'despesa_fixa' ||
    cat === 'despesa_variavel'
  );
}
// Toda despesa precisa estar atrelada a um banco — assim "Meu Patrimônio"
// abate o valor pago da instituição certa (ex.: PicPay 500 → conta de 400 paga
// → caixa 100). Antes só receita/resgate eram obrigatórios e despesas sem banco
// caíam num bucket "Sem banco", deixando o saldo da instituição inflado.
function controleBancoObrigatorio(cat) {
  return (
    cat === 'receita' ||
    cat === 'resgate_investimento' ||
    cat === 'despesa_fixa' ||
    cat === 'despesa_variavel'
  );
}

// === Categorização de despesas (alimentação, saúde, transporte...) ===
// Lista fixa + categorias dinâmicas criadas pelo usuário ("➕ Outros").
var CATEGORIAS_DESPESA_PADRAO = [
  { v: 'moradia', label: '🏠 Moradia' },
  { v: 'alimentacao', label: '🛒 Alimentação' },
  { v: 'transporte', label: '🚗 Transporte' },
  { v: 'saude', label: '⚕️ Saúde' },
  { v: 'educacao', label: '📚 Educação' },
  { v: 'lazer', label: '🍿 Lazer e Assinaturas' },
  { v: 'cuidados_pessoais', label: '💆 Cuidados Pessoais' },
  { v: 'pets', label: '🐶 Pets' },
  { v: 'impostos_taxas', label: '🏦 Impostos e Taxas' },
];

function obterCategoriasDespesaCustom() {
  try {
    const arr = JSON.parse(localStorage.getItem('futurorico_categoriasDespesa') || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function salvarCategoriasDespesaCustom(arr) {
  try {
    localStorage.setItem('futurorico_categoriasDespesa', JSON.stringify(arr));
    if (window.AppliqueiCloudSync && typeof AppliqueiCloudSync.forceFlush === 'function')
      AppliqueiCloudSync.forceFlush();
  } catch (e) {
    console.error('[categoriasDespesa] localStorage', e);
  }
}

// A chave futurorico_categoriasDespesa guarda um array que faz TRÊS papéis, para
// não precisar de uma segunda chave (que teria de entrar no sync, no backup e no
// "Recomeçar do zero"):
//   { v, label }          categoria criada pelo usuário
//   { v, label } com v de padrão   renomeia aquela categoria padrão
//   { v, oculta: true }   esconde a categoria (padrão ou criada)
// Arrays antigos, que só tinham categorias criadas, continuam válidos.

function ehCategoriaDespesaPadrao(v) {
  return CATEGORIAS_DESPESA_PADRAO.some((c) => c.v === v);
}

// Categorias visíveis, na ordem: padrões primeiro, depois as criadas.
function obterCategoriasDespesa() {
  const ajustes = obterCategoriasDespesaCustom();
  const porV = {};
  ajustes.forEach((a) => {
    if (a && a.v) porV[a.v] = a;
  });

  const out = [];
  CATEGORIAS_DESPESA_PADRAO.forEach((c) => {
    const a = porV[c.v];
    if (a && a.oculta) return;
    out.push({ v: c.v, label: (a && a.label) || c.label, padrao: true });
  });
  ajustes.forEach((a) => {
    if (!a || !a.v || a.oculta || ehCategoriaDespesaPadrao(a.v)) return;
    out.push({ v: a.v, label: a.label, padrao: false });
  });
  return out;
}

// Inclui as ocultas — lançamentos antigos (ou vindos de outro aparelho) ainda
// apontam para elas e precisam de rótulo. Sem isto o extrato mostraria o slug.
function rotuloCategoriaDespesa(v) {
  if (!v) return '';
  const ajuste = obterCategoriasDespesaCustom().find((x) => x && x.v === v);
  if (ajuste && ajuste.label) return ajuste.label;
  const padrao = CATEGORIAS_DESPESA_PADRAO.find((x) => x.v === v);
  if (padrao) return padrao.label;
  return v;
}

// Quantos lançamentos usam a categoria — a exclusão precisa dizer isso ao
// usuário antes de mexer no histórico dele.
function contarLancamentosDaCategoria(v) {
  if (!v || typeof transacoes === 'undefined') return 0;
  return transacoes.filter((t) => t.categoriaDespesa === v).length;
}

// Move (ou limpa, com destino vazio) a categoria dos lançamentos. Grava via
// localStorage.setItem porque é o interceptador de appliquei-utils.js que avisa
// o cloud-sync — sem ele a mudança ficaria só neste aparelho.
function reatribuirCategoriaDespesa(de, para) {
  if (!de || typeof transacoes === 'undefined') return 0;
  let n = 0;
  transacoes.forEach((t) => {
    if (t.categoriaDespesa !== de) return;
    if (para) t.categoriaDespesa = para;
    else delete t.categoriaDespesa;
    n++;
  });
  if (n) salvarTransacoes();
  return n;
}

// Slug estável a partir do nome. É a chave gravada em t.categoriaDespesa, por
// isso NUNCA é recalculada ao renomear — só o label muda.
function slugCategoriaDespesa(nome) {
  return (
    (nome || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'outros'
  );
}

function categoriaDespesaUsada(cat) {
  return cat === 'despesa_fixa' || cat === 'despesa_variavel' || cat === 'cartao_credito';
}

function popularSelectCategoriaDespesa(selecionado) {
  const sel = document.getElementById('categoriaDespesa');
  if (!sel) return;
  const atual = selecionado != null ? selecionado : sel.value;
  const opts = obterCategoriasDespesa()
    .map((c) => `<option value="${c.v}">${c.label}</option>`)
    .join('');
  sel.innerHTML =
    `<option value="" disabled ${atual ? '' : 'selected'}>Selecione...</option>` +
    opts +
    `<option value="__nova__">➕ Adicionar nova categoria</option>`;
  if (atual && atual !== '__nova__' && obterCategoriasDespesa().some((c) => c.v === atual))
    sel.value = atual;
  onChangeCategoriaDespesa();
}

// Emojis sugeridos para o usuário escolher ao criar uma categoria de despesa.
var EMOJIS_CATEGORIA_DESPESA = [
  '🏷️',
  '🏠',
  '🛒',
  '🚗',
  '⚕️',
  '📚',
  '🍿',
  '💆',
  '🐶',
  '🏦',
  '✈️',
  '🎁',
  '👕',
  '💡',
  '📱',
  '🎮',
  '🍔',
  '☕',
  '🏋️',
  '💊',
  '🎓',
  '🐱',
  '🧾',
  '💳',
  '🚌',
  '⛽',
  '🎉',
  '💼',
  '🔧',
  '🌱',
  '👶',
  '🎵',
  '📷',
  '🍷',
  '🛠️',
  '🧹',
  '🎬',
  '💄',
  '⚽',
  '💰',
];

// O picker serve dois formulários: o de criar categoria dentro do lançamento
// (sufixo '') e o de Configurações (sufixo 'Config'). Os ids são os mesmos com
// o sufixo colado no fim.
function _idsEmojiCategoria(sufixo) {
  const s = sufixo || '';
  return {
    picker: 'categoriaDespesaEmojiPicker' + s,
    hidden: 'categoriaDespesaNovaEmoji' + s,
    btn: 'categoriaDespesaNovaEmojiBtn' + s,
    nome: 'categoriaDespesaNova' + s,
  };
}

function renderEmojiPickerCategoria(sufixo) {
  const ids = _idsEmojiCategoria(sufixo);
  const picker = document.getElementById(ids.picker);
  if (!picker) return;
  const atual = document.getElementById(ids.hidden)?.value || '🏷️';
  const suf = sufixo || '';
  picker.innerHTML = EMOJIS_CATEGORIA_DESPESA.map(
    (e) =>
      `<button type="button" onclick="selecionarEmojiCategoria('${e}','${suf}')" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:18px;line-height:1;border-radius:8px;cursor:pointer;background:transparent;border:1.5px solid ${e === atual ? 'var(--cor-primaria)' : 'transparent'};">${e}</button>`
  ).join('');
}

function toggleEmojiPickerCategoria(sufixo) {
  const picker = document.getElementById(_idsEmojiCategoria(sufixo).picker);
  if (!picker) return;
  const aberto = picker.style.display === 'flex';
  if (aberto) {
    picker.style.display = 'none';
  } else {
    renderEmojiPickerCategoria(sufixo);
    picker.style.display = 'flex';
  }
}

function definirEmojiCategoria(emoji, sufixo) {
  const ids = _idsEmojiCategoria(sufixo);
  const hidden = document.getElementById(ids.hidden);
  const btn = document.getElementById(ids.btn);
  if (hidden) hidden.value = emoji;
  if (btn) btn.textContent = emoji;
  const picker = document.getElementById(ids.picker);
  if (picker) picker.style.display = 'none';
}

function resetarEmojiCategoriaNova(sufixo) {
  definirEmojiCategoria('🏷️', sufixo);
}

function selecionarEmojiCategoria(emoji, sufixo) {
  definirEmojiCategoria(emoji, sufixo);
  document.getElementById(_idsEmojiCategoria(sufixo).nome)?.focus();
}

function onChangeCategoriaDespesa() {
  const sel = document.getElementById('categoriaDespesa');
  const novaWrap = document.getElementById('grupoCategoriaDespesaNova');
  if (!sel || !novaWrap) return;
  novaWrap.style.display = sel.value === '__nova__' ? 'block' : 'none';
  const picker = document.getElementById('categoriaDespesaEmojiPicker');
  if (picker) picker.style.display = 'none';
  if (sel.value === '__nova__') document.getElementById('categoriaDespesaNova')?.focus();
}

// Resolve a categoria de despesa do formulário. Se "Outros" foi escolhido,
// normaliza o texto livre num slug, cadastra para o perfil (se inédito) e
// devolve o valor. Retorna null para categorias que não usam o campo.
function resolverCategoriaDespesaSelecionada(categoriaContabil) {
  if (!categoriaDespesaUsada(categoriaContabil)) return null;
  const sel = document.getElementById('categoriaDespesa');
  if (!sel) return null;
  let valor = sel.value;
  if (valor === '__nova__') {
    const nome = (document.getElementById('categoriaDespesaNova')?.value || '').trim();
    if (!nome) return null;
    const slug = slugCategoriaDespesa(nome);
    if (obterCategoriasDespesa().some((c) => c.v === slug)) return slug;
    const emoji = (document.getElementById('categoriaDespesaNovaEmoji')?.value || '🏷️').trim();
    // O slug pode colidir com uma categoria oculta (o usuário escondeu "Pets" e
    // agora digitou "Pets"). Reativa a existente em vez de criar uma duplicata
    // que ficaria invisível atrás da regra de ocultação.
    const ajustes = obterCategoriasDespesaCustom();
    const oculta = ajustes.find((a) => a && a.v === slug && a.oculta);
    if (oculta) {
      delete oculta.oculta;
      oculta.label = `${emoji} ${nome}`;
    } else {
      ajustes.push({ v: slug, label: `${emoji} ${nome}` });
    }
    salvarCategoriasDespesaCustom(ajustes);
    return slug;
  }
  return valor || null;
}

// ============================================================
// === Categorias de despesa: gerenciar em Configurações     ===
// ============================================================
// Criar já existia (pelo próprio formulário de lançamento); editar e excluir
// não. A lista vive no modal de Configurações, no mesmo padrão dos cartões.
//
// Duas regras que sustentam o resto:
//   1. RENOMEAR NUNCA MEXE NO SLUG. O slug (`v`) é o que está gravado em
//      t.categoriaDespesa de cada lançamento; recalculá-lo a partir do nome
//      novo desligaria a categoria de todo o histórico dela em silêncio.
//   2. PADRÃO OCULTA, CRIADA EXCLUI. As 9 padrões são código, não dado — não
//      dá para removê-las de verdade, então somem do formulário e voltam pelo
//      botão de restaurar. As criadas pelo usuário somem para valer.

// v da categoria aguardando confirmação de exclusão (linha expandida na lista).
var categoriaConfigExcluindo = null;

function renderizarListaCategoriasConfig() {
  const container = document.getElementById('listaCategoriasConfig');
  if (!container) return;

  const visiveis = obterCategoriasDespesa();
  const ocultas = obterCategoriasDespesaCustom().filter((a) => a && a.oculta);

  const linhaVisivel = (c) => {
    const usos = contarLancamentosDaCategoria(c.v);
    const usoTxt = usos ? `${usos} lançamento${usos > 1 ? 's' : ''}` : 'Sem lançamentos';
    const tipoTxt = c.padrao ? 'Padrão' : 'Criada por você';
    const acaoTitulo = c.padrao ? 'Ocultar (histórico preservado)' : 'Excluir';
    const acaoIcone = c.padrao ? 'ph-eye-slash' : 'ph-trash';
    return `
      <div style="display:flex;align-items:center;gap:10px;background:var(--cor-superficie);border:1px solid var(--cor-borda);border-radius:9px;padding:10px 12px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--cor-texto-principal);">${c.label}</div>
          <div style="font-size:11px;color:var(--cor-texto-mutado);">${tipoTxt} • ${usoTxt}</div>
        </div>
        <button class="btn-secundario" style="padding:4px 8px;font-size:11px;color:var(--cor-info);border-color:var(--cor-info);" onclick="editarCategoriaConfig('${c.v}')" title="Renomear"><i class="ph ph-pencil-simple"></i></button>
        <button class="btn-secundario" style="padding:4px 8px;font-size:11px;color:var(--cor-erro);border-color:var(--cor-erro);" onclick="pedirExclusaoCategoriaConfig('${c.v}')" title="${acaoTitulo}"><i class="ph ${acaoIcone}"></i></button>
      </div>`;
  };

  const linhaOculta = (a) => `
      <div style="display:flex;align-items:center;gap:10px;background:var(--cor-superficie);border:1px solid var(--cor-borda);border-radius:9px;padding:10px 12px;opacity:0.6;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--cor-texto-principal);">${rotuloCategoriaDespesa(a.v)}<span style="background:var(--cor-borda);color:var(--cor-texto-mutado);padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-left:6px;">Oculta</span></div>
          <div style="font-size:11px;color:var(--cor-texto-mutado);">Não aparece em novos lançamentos</div>
        </div>
        <button class="btn-secundario" style="padding:4px 8px;font-size:11px;color:var(--cor-primaria);border-color:var(--cor-primaria);" onclick="restaurarCategoriaConfig('${a.v}')" title="Restaurar"><i class="ph ph-arrow-counter-clockwise"></i></button>
      </div>`;

  // Confirmação inline em vez de modal: o modalConfirmacao vem depois no DOM e
  // ficaria por baixo do de Configurações (mesmo z-index).
  const blocoConfirmacao = (v) => {
    const cat = obterCategoriasDespesa().find((c) => c.v === v);
    if (!cat) return '';
    const usos = contarLancamentosDaCategoria(v);
    const destinos = obterCategoriasDespesa()
      .filter((c) => c.v !== v)
      .map((c) => `<option value="${c.v}">${c.label}</option>`)
      .join('');
    // Só a exclusão de uma categoria criada apaga o slug e obriga a decidir o
    // destino dos lançamentos. Ocultar uma padrão não mexe no histórico.
    const seletor =
      usos && !cat.padrao
        ? `<label style="display:block;font-size:11px;font-weight:600;color:var(--cor-texto-secundario);margin:10px 0 5px;">Mover ${usos} lançamento${usos > 1 ? 's' : ''} para</label>
         <select id="categoriaConfigDestino" style="width:100%;padding:8px 10px;border:1.5px solid var(--cor-borda);border-radius:8px;font-size:12.5px;background:var(--cor-branco);color:var(--cor-texto-principal);font-family:'Figtree',sans-serif;">
           <option value="">Deixar sem categoria</option>${destinos}
         </select>`
        : '';
    const usoTxt = usos
      ? usos === 1
        ? ' 1 lançamento continua nela.'
        : ` ${usos} lançamentos continuam nela.`
      : '';
    const explicacao = cat.padrao
      ? `Some do formulário de novos lançamentos.${usoTxt} O histórico continua igual e dá para restaurar depois.`
      : 'A categoria é removida de vez. Não dá para desfazer.';
    return `
      <div style="background:var(--cor-bg-erro);border:1px solid var(--cor-borda-erro);border-radius:9px;padding:12px;">
        <div style="font-size:12.5px;font-weight:600;color:var(--cor-txt-erro);margin-bottom:4px;">${cat.padrao ? 'Ocultar' : 'Excluir'} ${cat.label}?</div>
        <div style="font-size:11.5px;color:var(--cor-txt-erro);line-height:1.5;">${explicacao}</div>
        ${seletor}
        <div style="display:flex;gap:6px;margin-top:12px;">
          <button class="btn-secundario" style="flex:1;padding:7px;font-size:12px;" onclick="cancelarExclusaoCategoriaConfig()">Cancelar</button>
          <button class="btn-acao" style="flex:1;padding:7px;font-size:12px;background:var(--cor-erro);box-shadow:none;" onclick="confirmarExclusaoCategoriaConfig('${v}')"><i class="ph ph-check"></i> ${cat.padrao ? 'Ocultar' : 'Excluir'}</button>
        </div>
      </div>`;
  };

  if (categoriaConfigExcluindo) {
    container.innerHTML = blocoConfirmacao(categoriaConfigExcluindo);
    return;
  }
  container.innerHTML = visiveis.map(linhaVisivel).join('') + ocultas.map(linhaOculta).join('');
}

function abrirNovaCategoriaConfig() {
  const form = document.getElementById('formCategoriaConfig');
  const btn = document.getElementById('btnAbrirNovaCategoria');
  if (!form) return;
  form.style.display = 'block';
  if (btn) btn.style.display = 'none';
  const nome = document.getElementById('categoriaDespesaNovaConfig');
  if (nome) {
    nome.value = '';
    nome.dataset.editandoV = '';
  }
  resetarEmojiCategoriaNova('Config');
  const titulo = document.getElementById('tituloFormCategoriaConfig');
  if (titulo) titulo.textContent = 'Nova categoria';
  const salvar = document.getElementById('btnSalvarCategoriaConfig');
  if (salvar) salvar.innerHTML = '<i class="ph ph-check"></i> Adicionar';
  if (nome) nome.focus();
}

function cancelarCategoriaConfig() {
  const form = document.getElementById('formCategoriaConfig');
  const btn = document.getElementById('btnAbrirNovaCategoria');
  if (form) form.style.display = 'none';
  if (btn) btn.style.display = 'block';
}

// Separa "🏷️ Mercado" em emoji + nome para reabrir no formulário de edição.
function _partesRotuloCategoria(label) {
  const m = String(label || '').match(/^(\S+)\s+(.*)$/);
  if (m && !/^[a-zA-Z0-9]/.test(m[1])) return { emoji: m[1], nome: m[2] };
  return { emoji: '🏷️', nome: String(label || '') };
}

function editarCategoriaConfig(v) {
  const cat = obterCategoriasDespesa().find((c) => c.v === v);
  if (!cat) return;
  categoriaConfigExcluindo = null;
  const form = document.getElementById('formCategoriaConfig');
  const btn = document.getElementById('btnAbrirNovaCategoria');
  if (!form) return;
  form.style.display = 'block';
  if (btn) btn.style.display = 'none';
  const partes = _partesRotuloCategoria(cat.label);
  const nome = document.getElementById('categoriaDespesaNovaConfig');
  if (nome) {
    nome.value = partes.nome;
    nome.dataset.editandoV = v;
  }
  definirEmojiCategoria(partes.emoji, 'Config');
  const titulo = document.getElementById('tituloFormCategoriaConfig');
  if (titulo) titulo.textContent = 'Renomear categoria';
  const salvar = document.getElementById('btnSalvarCategoriaConfig');
  if (salvar) salvar.innerHTML = '<i class="ph ph-check"></i> Salvar';
  renderizarListaCategoriasConfig();
  if (nome) nome.focus();
}

function salvarCategoriaConfig() {
  const inputNome = document.getElementById('categoriaDespesaNovaConfig');
  const nome = (inputNome?.value || '').trim();
  if (!nome) return mostrarToast('Informe o nome da categoria.', 'erro');
  const emoji = (document.getElementById('categoriaDespesaNovaEmojiConfig')?.value || '🏷️').trim();
  const label = `${emoji} ${nome}`;
  const editandoV = inputNome?.dataset.editandoV || '';
  const ajustes = obterCategoriasDespesaCustom();

  if (editandoV) {
    // Só o rótulo muda: o slug segue amarrado aos lançamentos existentes.
    const existente = ajustes.find((a) => a && a.v === editandoV);
    if (existente) existente.label = label;
    else ajustes.push({ v: editandoV, label });
  } else {
    const slug = slugCategoriaDespesa(nome);
    if (obterCategoriasDespesa().some((c) => c.v === slug)) {
      return mostrarToast('Já existe uma categoria com esse nome.', 'erro');
    }
    const oculta = ajustes.find((a) => a && a.v === slug && a.oculta);
    if (oculta) {
      delete oculta.oculta;
      oculta.label = label;
    } else {
      ajustes.push({ v: slug, label });
    }
  }

  salvarCategoriasDespesaCustom(ajustes);
  cancelarCategoriaConfig();
  renderizarListaCategoriasConfig();
  popularSelectCategoriaDespesa();
  atualizarTelaControle();
  mostrarToast(editandoV ? 'Categoria atualizada.' : 'Categoria adicionada.', 'sucesso');
}

function pedirExclusaoCategoriaConfig(v) {
  cancelarCategoriaConfig();
  categoriaConfigExcluindo = v;
  renderizarListaCategoriasConfig();
}

function cancelarExclusaoCategoriaConfig() {
  categoriaConfigExcluindo = null;
  renderizarListaCategoriasConfig();
}

function confirmarExclusaoCategoriaConfig(v) {
  const cat = obterCategoriasDespesa().find((c) => c.v === v);
  if (!cat) {
    cancelarExclusaoCategoriaConfig();
    return;
  }
  // Ocultar uma padrão deixa o histórico como está — o slug continua existindo
  // no código e o rótulo continua resolvendo.
  const destino = cat.padrao
    ? ''
    : (document.getElementById('categoriaConfigDestino') || {}).value || '';
  const movidos = cat.padrao ? 0 : reatribuirCategoriaDespesa(v, destino);

  const ajustes = obterCategoriasDespesaCustom();
  if (cat.padrao) {
    const existente = ajustes.find((a) => a && a.v === v);
    if (existente) existente.oculta = true;
    else ajustes.push({ v, oculta: true });
  } else {
    const i = ajustes.findIndex((a) => a && a.v === v);
    if (i >= 0) ajustes.splice(i, 1);
  }
  salvarCategoriasDespesaCustom(ajustes);

  categoriaConfigExcluindo = null;
  renderizarListaCategoriasConfig();
  popularSelectCategoriaDespesa();
  atualizarTelaControle();

  const sufixo = movidos
    ? ` ${movidos} lançamento${movidos > 1 ? 's' : ''} ${destino ? 'movido' + (movidos > 1 ? 's' : '') : 'ficou' + (movidos > 1 ? 'ram' : '') + ' sem categoria'}${destino ? ' para ' + rotuloCategoriaDespesa(destino) : ''}.`
    : '';
  mostrarToast((cat.padrao ? 'Categoria oculta.' : 'Categoria excluída.') + sufixo, 'sucesso');
}

function restaurarCategoriaConfig(v) {
  const ajustes = obterCategoriasDespesaCustom();
  const a = ajustes.find((x) => x && x.v === v);
  if (!a) return;
  if (ehCategoriaDespesaPadrao(v) && !a.label) {
    // Sem rótulo próprio, o ajuste só existia para esconder — some junto.
    ajustes.splice(ajustes.indexOf(a), 1);
  } else {
    delete a.oculta;
  }
  salvarCategoriasDespesaCustom(ajustes);
  renderizarListaCategoriasConfig();
  popularSelectCategoriaDespesa();
  atualizarTelaControle();
  mostrarToast('Categoria restaurada.', 'sucesso');
}

function verificarRegraCartao() {
  const cat = document.getElementById('categoriaTransacao').value;
  const divParcelas = document.getElementById('grupoParcelas');
  const divFixa = document.getElementById('grupoFixa');
  const divCartao = document.getElementById('grupoCartaoSelect');
  const divBanco = document.getElementById('grupoBancoReceita');
  const lblValor = document.getElementById('lblValorOpControle');
  const chkFixa = document.getElementById('transacaoFixa');

  if (divBanco) {
    if (controleCategoriaUsaBanco(cat)) {
      divBanco.style.display = 'block';
      const lbl = document.getElementById('lblBancoTransacao');
      if (lbl) {
        const ehEntrada = cat === 'receita' || cat === 'resgate_investimento';
        lbl.innerHTML = ehEntrada
          ? 'Banco / instituição que recebe <span style="color:var(--cor-erro);">*</span>'
          : 'Banco / instituição de onde sai <span style="color:var(--cor-erro);">*</span>';
      }
      inicializarDatalistBancosTransacao(cat);
    } else {
      divBanco.style.display = 'none';
    }
  }

  // Categoria da despesa (alimentação, saúde, transporte...) — só em saídas.
  const divCatDesp = document.getElementById('grupoCategoriaDespesa');
  if (divCatDesp) {
    if (categoriaDespesaUsada(cat)) {
      divCatDesp.style.display = 'block';
      popularSelectCategoriaDespesa();
    } else {
      divCatDesp.style.display = 'none';
    }
  }

  // 4.6 — em cartão o campo "Vencimento" SAI da tela e dá lugar ao seletor de
  // fatura, dentro do bloco do cartão. A pergunta ali não é "que dia vence" —
  // é "em qual fatura isto entra", e a resposta depende do cartão e do tipo.
  // O input continua no DOM e continua sendo o que o salvamento lê; quem o
  // preenche passa a ser preencherVencimentoPorCartao.
  const ehCartao = cat === 'cartao_credito';
  const grupoVenc = document.getElementById('grupoVencimentoControle');
  const gridCatVenc = document.getElementById('gridCategoriaVencimento');
  if (grupoVenc) grupoVenc.style.display = ehCartao ? 'none' : '';
  // Sem o vencimento, a grade de duas colunas deixaria a Categoria sozinha
  // ocupando metade da linha, com um buraco do lado.
  if (gridCatVenc) gridCatVenc.style.gridTemplateColumns = ehCartao ? '1fr' : '';
  const inputVenc = document.getElementById('dataVencimento');
  if (inputVenc && !ehCartao) {
    inputVenc.readOnly = false;
    inputVenc.style.opacity = '';
    inputVenc.title = '';
  }

  if (cat === 'cartao_credito') {
    divCartao.style.display = 'block';
    divFixa.style.display = 'none';
    chkFixa.checked = false;
    atualizarSelectCartoesForm();
    aplicarTipoCartaoUI();
    preencherVencimentoPorCartao();
  } else {
    divCartao.style.display = 'none';
    divParcelas.style.display = 'none';
    divFixa.style.display = 'flex';
    document.getElementById('qtdParcelas').value = 1;
    lblValor.innerText = 'Valor Monetário (R$)';
    const formInlineCart = document.getElementById('formNovoCartaoInline');
    if (formInlineCart) formInlineCart.style.display = 'none';

    if (cat === 'receita' || cat === 'despesa_fixa') {
      chkFixa.checked = true;
    } else {
      chkFixa.checked = false;
    }
  }
}

function atualizarSelectCartoesForm() {
  const sel = document.getElementById('selectCartao');
  if (!sel) return;
  const valorAtual = sel.value;
  const ativos = cartoesAtivos();
  sel.innerHTML =
    ativos.map((c) => `<option value="${c.id}">${c.nome}</option>`).join('') +
    `<option value="__novo__">+ Adicionar novo cartão</option>`;
  if (valorAtual && ativos.some((c) => c.id === valorAtual)) sel.value = valorAtual;
}

function onChangeSelectCartao() {
  const sel = document.getElementById('selectCartao');
  if (sel.value === '__novo__') {
    document.getElementById('formNovoCartaoInline').style.display = 'block';
    document.getElementById('inlineCartaoNome').value = '';
    document.getElementById('inlineCartaoLimite').value = '';
    document.getElementById('inlineCartaoDiaFech').value = '';
    document.getElementById('inlineCartaoDiaVenc').value = '';
    document.getElementById('inlineCartaoNome').focus();
  } else {
    document.getElementById('formNovoCartaoInline').style.display = 'none';
    preencherVencimentoPorCartao();
  }
}

// Data de vencimento da fatura onde uma compra de cartão entra (pura/testável).
// Regra: a compra entra na fatura ainda ABERTA — se o fechamento deste mês já
// passou (hoje > diaFech), entra na que fecha no mês seguinte. O vencimento é
// SEMPRE depois do fechamento; quando o dia do vencimento é <= dia do
// fechamento, ele cai no mês seguinte ao fechamento (corrige o bug em que
// "venc 5 < fech 25" jogava a compra na fatura atual em vez da próxima).
function cartaoCalcularVencimento(hoje, diaFech, diaVenc) {
  const dVenc = parseInt(diaVenc, 10);
  let dFech = parseInt(diaFech, 10);
  if (!dVenc || dVenc < 1 || dVenc > 31) return null;
  if (!dFech || dFech < 1 || dFech > 31) dFech = dVenc;

  let fMes = hoje.getMonth();
  const fAno = hoje.getFullYear();
  if (hoje.getDate() > dFech) fMes += 1;

  const vMes = fMes + (dVenc <= dFech ? 1 : 0);
  const ultimoDia = new Date(fAno, vMes + 1, 0).getDate();
  const diaFinal = Math.min(dVenc, ultimoDia);
  return new Date(fAno, vMes, diaFinal);
}

// Competência (mes/ano) a partir de uma data yyyy-mm-dd. Devolve null se a
// string não for uma data válida — o chamador decide o que fazer.
function competenciaDaData(dataStr) {
  if (!dataStr) return null;
  const [a, m] = String(dataStr).split('-').map(Number);
  if (!a || !m || m < 1 || m > 12) return null;
  return { mes: m - 1, ano: a };
}

// Último fechamento que JÁ ocorreu, olhando de `hoje`. Puro/testável.
//
// Segue exatamente o mesmo critério de borda de cartaoCalcularVencimento: lá,
// `hoje.getDate() > dFech` é o que empurra a compra para a fatura seguinte —
// ou seja, comprar NO dia do fechamento ainda entra na fatura que fecha nesse
// dia. Aqui a condição espelhada é `<=`: no dia 2, com fechamento no dia 2, o
// último fechamento concluído é o do mês passado.
//
// O dia é limitado ao tamanho do mês porque fechamento 31 existe e fevereiro
// não tem dia 31 — cartaoCalcularVencimento já faz isso para o vencimento.
function cartaoUltimoFechamento(hoje, diaFech, diaVenc) {
  const dVenc = parseInt(diaVenc, 10);
  let dFech = parseInt(diaFech, 10);
  if (!dVenc || dVenc < 1 || dVenc > 31) return null;
  if (!dFech || dFech < 1 || dFech > 31) dFech = dVenc; // mesmo fallback da regra
  const diaNoMes = (ano, mes) => Math.min(dFech, new Date(ano, mes + 1, 0).getDate());
  let ano = hoje.getFullYear();
  let mes = hoje.getMonth();
  if (hoje.getDate() <= diaNoMes(ano, mes)) {
    mes -= 1;
    if (mes < 0) {
      mes = 11;
      ano -= 1;
    }
  }
  return new Date(ano, mes, diaNoMes(ano, mes));
}

/** O fechamento seguinte a um fechamento dado — um mês à frente, com o dia
 *  limitado ao tamanho do mês de destino (fechamento 31 em fevereiro). */
function cartaoProximoFechamento(fechamento, diaFech, diaVenc) {
  const dVenc = parseInt(diaVenc, 10);
  let dFech = parseInt(diaFech, 10);
  if (!dVenc || dVenc < 1 || dVenc > 31) return null;
  if (!dFech || dFech < 1 || dFech > 31) dFech = dVenc;
  const ano = fechamento.getFullYear();
  const mes = fechamento.getMonth() + 1;
  return new Date(ano, mes, Math.min(dFech, new Date(ano, mes + 1, 0).getDate()));
}

/** Um dia depois de `d`, sem mexer no original. */
function cartaoDiaSeguinte(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + 1);
  return x;
}

// As faturas entre as quais o usuário pode escolher ao lançar uma compra.
// Puro/testável — a tela só desenha o que sai daqui.
//
// POR QUE ISTO EXISTE: a regra decide a fatura pela data, e a data que ela
// recebe é HOJE. Quem compra antes do fechamento e só lança depois cai na
// fatura seguinte, e não tinha como corrigir — o campo era readOnly. A regra
// continua intacta: ela é chamada duas vezes, com duas datas, e as duas
// respostas viram as duas opções.
//
// `aberta` é a fatura que ainda acumula (é o que a regra devolve para hoje).
// `fechada` é a que acabou de fechar e ainda vai ser paga — o destino de quem
// comprou antes do fechamento e lançou atrasado.
function cartaoFaturasCandidatas(hoje, diaFech, diaVenc) {
  const vencAberta = cartaoCalcularVencimento(hoje, diaFech, diaVenc);
  if (!vencAberta) return null;
  const ultimoFech = cartaoUltimoFechamento(hoje, diaFech, diaVenc);
  if (!ultimoFech) return null;
  const penultimoFech = cartaoUltimoFechamento(ultimoFech, diaFech, diaVenc);
  const vencFechada = cartaoCalcularVencimento(ultimoFech, diaFech, diaVenc);
  return {
    aberta: {
      vencimento: vencAberta,
      fechamento: cartaoProximoFechamento(ultimoFech, diaFech, diaVenc),
      inicio: cartaoDiaSeguinte(ultimoFech),
      fim: null, // ainda acumula
    },
    fechada: {
      vencimento: vencFechada,
      fechamento: ultimoFech,
      inicio: penultimoFech ? cartaoDiaSeguinte(penultimoFech) : null,
      fim: ultimoFech,
    },
  };
}

var FATURA_MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Modo do seletor na edição: começa recolhido, mostrando só onde o
 *  lançamento está. A maioria das edições é para corrigir descrição, e abrir o
 *  seletor convidaria a mover a fatura sem querer — mover em silêncio já foi
 *  bug aqui uma vez. */
var faturaSeletorExpandido = false;

function faturaYmd(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function faturaDdMm(d) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}

/** A fatura é nomeada pelo mês em que se PAGA — é assim que o banco a chama e
 *  é assim que o usuário pensa nela. */
function faturaNome(venc) {
  return 'Fatura de ' + FATURA_MESES[venc.getMonth()];
}

/** Lançamentos já registrados numa fatura. A chave é a mesma do painel de
 *  vencimentos (cartão + data de vencimento): fatura não é entidade no modelo,
 *  é um agrupamento por essa dupla. */
function faturaLancamentos(cartaoId, ymdVenc) {
  if (typeof transacoes === 'undefined') return [];
  return transacoes.filter(
    (t) =>
      t.categoria === 'cartao_credito' && t.cartaoId === cartaoId && t.dataVencimento === ymdVenc
  );
}

/** Total já lançado na fatura — serve para o usuário bater com o app do banco
 *  antes de escolher. */
function faturaTotal(cartaoId, ymdVenc) {
  return faturaLancamentos(cartaoId, ymdVenc).reduce((soma, t) => soma + (Number(t.valor) || 0), 0);
}

/** Não existe flag de "fatura paga": o estado é dos lançamentos. Fatura vazia
 *  não conta como paga — senão toda fatura nova nasceria "paga". */
function faturaEstaPaga(cartaoId, ymdVenc) {
  const itens = faturaLancamentos(cartaoId, ymdVenc);
  return itens.length > 0 && itens.every((t) => t.pago);
}

/** O cartão selecionado no formulário, ou null. */
function faturaCartaoDoForm() {
  const sel = document.getElementById('selectCartao');
  if (!sel || !sel.value || sel.value === '__novo__') return null;
  return typeof obterCartao === 'function' ? obterCartao(sel.value) : null;
}

/** As duas candidatas para o cartão selecionado, ou null se faltam os dias. */
function faturaCandidatasDoForm() {
  const cartao = faturaCartaoDoForm();
  if (!cartao) return null;
  return cartaoFaturasCandidatas(new Date(), cartao.diaFechamento, cartao.diaVencimento);
}

/** Escolha do usuário. Guarda a INTENÇÃO, não a data: trocar de cartão
 *  recalcula as datas e mantém "eu quero a fechada". */
function faturaIntencao() {
  const el = document.getElementById('faturaEscolhida');
  return el ? el.value || 'aberta' : 'aberta';
}

function selecionarFatura(qual) {
  const el = document.getElementById('faturaEscolhida');
  if (el) el.value = qual;
  preencherVencimentoPorCartao();
}

function expandirSeletorFatura() {
  faturaSeletorExpandido = true;
  // 'manter' = nenhuma opção marcada e a data GUARDADA intacta. Abrir as
  // opções não pode mover nada: quem clicou em "mover" ainda não escolheu para
  // onde, e sair sem escolher tem de deixar o lançamento onde estava.
  const el = document.getElementById('faturaEscolhida');
  if (el) el.value = 'manter';
  preencherVencimentoPorCartao();
}

/** Completa fechamento/vencimento do cartão SEM sair do lançamento. Mandar o
 *  usuário para Configurações aqui custaria o lançamento que ele estava
 *  digitando. */
function salvarDiasCartaoInline() {
  const cartao = faturaCartaoDoForm();
  if (!cartao) return;
  const fech = parseInt(document.getElementById('faturaDiaFech').value, 10);
  const venc = parseInt(document.getElementById('faturaDiaVenc').value, 10);
  if (!fech || fech < 1 || fech > 31)
    return mostrarToast('Informe o dia de fechamento (1 a 31).', 'erro');
  if (!venc || venc < 1 || venc > 31)
    return mostrarToast('Informe o dia de vencimento (1 a 31).', 'erro');
  cartao.diaFechamento = fech;
  cartao.diaVencimento = venc;
  if (typeof salvarCartoes === 'function') salvarCartoes();
  mostrarToast('Cartão atualizado. Agora dá para escolher a fatura.', 'sucesso');
  preencherVencimentoPorCartao();
}

/** A linha que explica o que vai ser criado: parcelado gera N lançamentos a
 *  partir da fatura escolhida, e sem isto ninguém adivinha até onde vão. */
function atualizarResumoFatura() {
  const box = document.getElementById('seletorFaturaResumo');
  if (!box) return;
  const cand = faturaCandidatasDoForm();
  const alvo = cand ? (faturaIntencao() === 'fechada' ? cand.fechada : cand.aberta) : null;
  if (!alvo) {
    box.style.display = 'none';
    return;
  }
  const tipo = (document.getElementById('tipoCartaoSelecionado') || {}).value;
  const parcelas = parseInt((document.getElementById('qtdParcelas') || {}).value, 10) || 1;
  const primeiro = FATURA_MESES[alvo.vencimento.getMonth()];

  if (tipo === 'fixo') {
    box.className = 'fatura-resumo';
    box.innerHTML =
      '<i class="ph ph-repeat"></i> Repete todo mês, a partir da fatura de <strong>' +
      primeiro +
      '</strong>.';
    box.style.display = 'block';
    return;
  }
  if (parcelas > 1) {
    const valor =
      typeof parseBRL === 'function'
        ? parseBRL((document.getElementById('valorTransacao') || {}).value)
        : 0;
    const ultimo = new Date(
      alvo.vencimento.getFullYear(),
      alvo.vencimento.getMonth() + parcelas - 1,
      1
    );
    const porParcela = Number.isFinite(valor) && valor > 0 ? formatarMoeda(valor / parcelas) : null;
    box.className = 'fatura-resumo';
    box.innerHTML =
      '<i class="ph ph-list-numbers"></i> ' +
      parcelas +
      (porParcela ? ' parcelas de <strong>' + porParcela + '</strong>' : ' parcelas') +
      ', de <strong>' +
      primeiro +
      '</strong> a <strong>' +
      FATURA_MESES[ultimo.getMonth()] +
      '</strong>.';
    box.style.display = 'block';
    return;
  }
  box.style.display = 'none';
}

/** Desenha o seletor e — o que importa para o resto do app — grava a data
 *  escolhida em #dataVencimento, que continua sendo o único campo que o
 *  salvamento lê. O seletor é uma camada de escolha por cima do mesmo valor.
 *
 *  Mantém o nome antigo porque é o ponto de entrada que verificarRegraCartao e
 *  onChangeSelectCartao já chamam. */
/** O que dizer depois de salvar. Em cartão, o usuário acabou de escolher uma
 *  fatura — "salvo com sucesso" não conta se a escolha pegou. Nomeia a fatura,
 *  e no parcelado diz até onde as parcelas vão. */
function mensagemLancamentoSalvo(categoria, ymdVenc, qtdLancamentos) {
  if (categoria !== 'cartao_credito' || !ymdVenc) return 'Lançamento salvo com sucesso!';
  const comp = competenciaDaData(ymdVenc);
  if (!comp) return 'Lançamento salvo com sucesso!';
  const primeiro = FATURA_MESES[comp.mes];
  const [, , dia] = ymdVenc.split('-');
  if (qtdLancamentos > 1) {
    const ultimo = new Date(comp.ano, comp.mes + (qtdLancamentos - 1), 1);
    return (
      qtdLancamentos +
      ' parcelas lançadas — de ' +
      primeiro +
      ' a ' +
      FATURA_MESES[ultimo.getMonth()] +
      '.'
    );
  }
  return (
    'Lançado na fatura de ' + primeiro + ' — vence em ' + dia + '/' + ymdVenc.split('-')[1] + '.'
  );
}

function preencherVencimentoPorCartao() {
  const inputVenc = document.getElementById('dataVencimento');
  const grupo = document.getElementById('grupoSeletorFatura');
  const opcoes = document.getElementById('seletorFaturaOpcoes');
  const aviso = document.getElementById('seletorFaturaAviso');
  const semDados = document.getElementById('seletorFaturaSemDados');
  if (!inputVenc || !grupo || !opcoes) return;

  const cartao = faturaCartaoDoForm();
  if (!cartao) {
    grupo.style.display = 'none';
    return;
  }
  grupo.style.display = 'block';

  const cand = cartaoFaturasCandidatas(new Date(), cartao.diaFechamento, cartao.diaVencimento);

  // ---- Estado: cartão sem os dias (o "Cartão principal" do primeiro boot) ---
  if (!cand) {
    opcoes.innerHTML = '';
    aviso.style.display = 'none';
    document.getElementById('seletorFaturaResumo').style.display = 'none';
    semDados.className = 'fatura-sem-dados';
    semDados.innerHTML =
      '<div><i class="ph ph-warning-circle" style="color:var(--cor-txt-amber);vertical-align:-2px;"></i> ' +
      '<strong>' +
      cartao.nome +
      '</strong> ainda não tem fechamento e vencimento. ' +
      'Sem eles não dá para saber em qual fatura a compra entra.</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end;margin-top:10px;">' +
      '<div class="form-group" style="margin-bottom:0;"><label style="font-size:11px;">Dia do fechamento</label>' +
      '<input type="number" id="faturaDiaFech" min="1" max="31" placeholder="Ex: 2" value="' +
      (cartao.diaFechamento || '') +
      '"></div>' +
      '<div class="form-group" style="margin-bottom:0;"><label style="font-size:11px;">Dia do vencimento</label>' +
      '<input type="number" id="faturaDiaVenc" min="1" max="31" placeholder="Ex: 10" value="' +
      (cartao.diaVencimento || '') +
      '"></div>' +
      '<button type="button" class="btn-acao" style="background:var(--cor-primaria);padding:9px 14px;font-size:12.5px;" onclick="salvarDiasCartaoInline()"><i class="ph ph-check"></i> Salvar</button>' +
      '</div>';
    semDados.style.display = 'block';
    // Sem faturas calculáveis, a data volta a ser digitável à mão: é o único
    // caminho que resta para não travar o lançamento.
    inputVenc.readOnly = false;
    inputVenc.style.opacity = '';
    inputVenc.title = '';
    // E some a data que estava lá. Ela é do cartão ANTERIOR, e deixá-la faria
    // a despesa entrar na fatura de outro cartão sem ninguém perceber.
    // EXCEÇÃO: editando, a data guardada é do próprio lançamento — apagá-la
    // moveria de fatura quem só abriu para corrigir a descrição.
    if (!(document.getElementById('editTransacaoId') || {}).value) inputVenc.value = '';
    return;
  }
  semDados.style.display = 'none';

  const ymdAberta = faturaYmd(cand.aberta.vencimento);
  const ymdFechada = faturaYmd(cand.fechada.vencimento);
  const editando = (document.getElementById('editTransacaoId') || {}).value;
  const guardada = inputVenc.value;

  // ---- Estado: editando um lançamento que está numa TERCEIRA fatura --------
  // Ex.: uma compra de março. Nunca mover em silêncio — mostra onde está e
  // exige um clique para abrir as opções.
  if (
    editando &&
    guardada &&
    guardada !== ymdAberta &&
    guardada !== ymdFechada &&
    !faturaSeletorExpandido
  ) {
    const [ga, gm, gd] = guardada.split('-').map(Number);
    const dv = new Date(ga, gm - 1, gd);
    opcoes.innerHTML =
      '<div class="fatura-sem-dados" style="grid-column:1/-1;">' +
      '<i class="ph ph-credit-card" style="vertical-align:-2px;"></i> Está na <strong>' +
      faturaNome(dv).toLowerCase() +
      '</strong> — vence em ' +
      faturaDdMm(dv) +
      '.' +
      ' <button type="button" onclick="expandirSeletorFatura()" style="background:none;border:none;padding:0;margin-left:4px;color:var(--cor-primaria);font-weight:600;font-size:12.5px;cursor:pointer;font-family:inherit;text-decoration:underline;">Mover para outra fatura</button>' +
      '</div>';
    aviso.style.display = 'none';
    atualizarResumoFatura();
    return;
  }

  // ---- Estado normal: as duas candidatas ----------------------------------
  // 'manter' só existe na edição de um lançamento que está numa terceira
  // fatura: as opções aparecem, mas nenhuma marcada, e a data não se mexe até
  // o usuário escolher.
  const bruta = faturaIntencao();
  const intencao = bruta === 'fechada' ? 'fechada' : bruta === 'manter' ? 'manter' : 'aberta';
  const tipoFixo = (document.getElementById('tipoCartaoSelecionado') || {}).value === 'fixo';

  const cartaoOpcao = (chave, dados, marcada) => {
    const ymd = faturaYmd(dados.vencimento);
    const paga = faturaEstaPaga(cartao.id, ymd);
    const venceu = ymd < faturaYmd(new Date());
    const total = faturaTotal(cartao.id, ymd);

    let estado, corEstado;
    if (chave === 'aberta') {
      estado = 'Aberta · fecha em ' + faturaDdMm(dados.fechamento);
      corEstado = 'var(--cor-primaria)';
    } else {
      estado = 'Fechada em ' + faturaDdMm(dados.fechamento);
      corEstado = 'var(--cor-texto-secundario)';
    }
    const pagamento = paga
      ? 'Paga'
      : (venceu ? 'Venceu em ' : 'Você paga em ') + faturaDdMm(dados.vencimento);

    // A linha decisiva: traduz "comprei dia 30" numa escolha, sem exigir que o
    // usuário entenda fechamento.
    let janela;
    if (tipoFixo) {
      janela = chave === 'aberta' ? 'Começa a cobrar nesta' : 'Já cobrava nesta';
    } else if (chave === 'aberta') {
      janela = 'Compras de ' + faturaDdMm(dados.inicio) + ' em diante';
    } else {
      janela = 'Compras feitas até ' + faturaDdMm(dados.fim);
    }

    return (
      '<label class="fatura-op">' +
      '<input type="radio" name="faturaOpcao" value="' +
      chave +
      '"' +
      (marcada ? ' checked' : '') +
      ' onchange="selecionarFatura(\'' +
      chave +
      '\')">' +
      '<span class="fatura-op-corpo">' +
      '<span class="fatura-op-nome">' +
      faturaNome(dados.vencimento) +
      '</span>' +
      '<span class="fatura-op-estado" style="color:' +
      corEstado +
      ';display:block;">' +
      estado +
      '</span>' +
      '<span class="fatura-op-paga" style="display:block;">' +
      pagamento +
      '</span>' +
      '<span class="fatura-op-janela" style="display:block;">' +
      janela +
      '</span>' +
      '<span class="fatura-op-total" style="display:block;">' +
      formatarMoeda(total) +
      (chave === 'aberta' ? ' até agora' : '') +
      '</span>' +
      '</span>' +
      '</label>'
    );
  };

  opcoes.innerHTML =
    cartaoOpcao('aberta', cand.aberta, intencao === 'aberta') +
    cartaoOpcao('fechada', cand.fechada, intencao === 'fechada');

  const lbl = document.getElementById('lblSeletorFatura');
  if (lbl) {
    lbl.innerText =
      intencao === 'manter'
        ? 'Escolha para onde mover'
        : tipoFixo
          ? 'A partir de qual fatura?'
          : 'Em qual fatura essa compra entra?';
  }

  // ---- Aviso de fatura já paga --------------------------------------------
  // Não bloqueia: se o banco cobrou e o usuário esqueceu de lançar, lançar é o
  // que faz o app bater com a realidade. Mas ele precisa saber que o mês
  // anterior vai mudar.
  if (intencao === 'fechada' && faturaEstaPaga(cartao.id, ymdFechada)) {
    aviso.className = 'fatura-aviso';
    aviso.innerHTML =
      '<i class="ph-fill ph-warning-circle"></i><span>Essa fatura já está paga no app. ' +
      'Se a compra estava nela e você não tinha lançado, pode seguir — o total de <strong>' +
      FATURA_MESES[cand.fechada.vencimento.getMonth()] +
      '</strong> vai subir.</span>';
    aviso.style.display = 'block';
  } else {
    aviso.style.display = 'none';
  }

  // O valor que o salvamento lê. O seletor é só a camada de escolha.
  // Em 'manter' a data guardada fica como está — nada se move sem escolha.
  if (intencao !== 'manter') {
    inputVenc.value = intencao === 'fechada' ? ymdFechada : ymdAberta;
  }
  inputVenc.readOnly = true;
  inputVenc.style.opacity = '0.7';
  inputVenc.title = 'Definida pela fatura escolhida acima.';

  atualizarResumoFatura();
}

function cancelarNovoCartaoInline() {
  document.getElementById('formNovoCartaoInline').style.display = 'none';
  document.getElementById('selectCartao').value = cartoes[0]?.id || '';
}

function salvarNovoCartaoInline() {
  const nome = document.getElementById('inlineCartaoNome').value.trim();
  const limite = parseBRL(document.getElementById('inlineCartaoLimite').value) || 0;
  const diaFech = parseInt(document.getElementById('inlineCartaoDiaFech').value);
  const diaVenc = parseInt(document.getElementById('inlineCartaoDiaVenc').value);
  if (!nome) return mostrarToast('Informe o nome do cartão.', 'erro');
  if (!diaFech || diaFech < 1 || diaFech > 31)
    return mostrarToast('Informe o dia de fechamento (1 a 31).', 'erro');
  if (!diaVenc || diaVenc < 1 || diaVenc > 31)
    return mostrarToast('Informe o dia de vencimento (1 a 31).', 'erro');
  const novo = {
    id: 'card_' + Date.now(),
    nome,
    limite,
    diaFechamento: diaFech,
    diaVencimento: diaVenc,
  };
  cartoes.push(novo);
  salvarCartoes();
  atualizarSelectCartoesForm();
  document.getElementById('selectCartao').value = novo.id;
  document.getElementById('formNovoCartaoInline').style.display = 'none';
  preencherVencimentoPorCartao();
  renderizarListaCartoesConfig();
  mostrarToast('Cartão adicionado.', 'sucesso');
}

function selecionarTipoCartao(tipo) {
  document.getElementById('tipoCartaoSelecionado').value = tipo;
  aplicarTipoCartaoUI();
}

function aplicarTipoCartaoUI() {
  const tipo = document.getElementById('tipoCartaoSelecionado').value;
  const btnPar = document.getElementById('btnTipoParcelado');
  const btnFix = document.getElementById('btnTipoFixo');
  const divParcelas = document.getElementById('grupoParcelas');
  const lblValor = document.getElementById('lblValorOpControle');

  if (tipo === 'fixo') {
    btnFix.style.background = 'var(--cor-branco)';
    btnFix.style.color = 'var(--cor-texto-principal)';
    btnPar.style.background = 'transparent';
    btnPar.style.color = 'var(--cor-texto-secundario)';
    divParcelas.style.display = 'none';
    document.getElementById('qtdParcelas').value = 1;
    lblValor.innerText = 'Valor mensal (R$)';
  } else {
    btnPar.style.background = 'var(--cor-branco)';
    btnPar.style.color = 'var(--cor-texto-principal)';
    btnFix.style.background = 'transparent';
    btnFix.style.color = 'var(--cor-texto-secundario)';
    divParcelas.style.display = 'block';
    lblValor.innerText = 'Valor Total da Compra (R$)';
  }
  // O seletor de fatura muda de pergunta entre parcelado e fixo mensal
  // ("em qual entra" vs. "a partir de qual"), e a linha do resumo também.
  if (typeof preencherVencimentoPorCartao === 'function') preencherVencimentoPorCartao();
}

// Compromissos PROGRAMADOS marcados como pagos por engano: uma despesa variável
// com vencimento FUTURO não pode estar quitada (ela nasce pendente). Corrige
// dados antigos (criados antes desta regra) e qualquer caminho que tenha
// marcado pago indevidamente. NÃO toca em pagamentos explícitos (com `pagoEm`)
// nem em despesa fixa/cartão (que nascem pendentes e podem ser pré-pagas de
// propósito). Idempotente — só grava quando muda algo.
function normalizarDespesasProgramadas() {
  if (typeof transacoes === 'undefined' || !Array.isArray(transacoes)) return false;
  const h = new Date();
  const hojeStr = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
  let mudou = false;
  transacoes.forEach((t) => {
    if (t.categoria !== 'despesa_variavel') return;
    if (!t.pago || t.pagoEm) return; // já pendente, ou pago explicitamente pelo usuário
    if (t.dataVencimento && t.dataVencimento > hojeStr) {
      t.pago = false; // vencimento no futuro → volta a ser compromisso a pagar
      mudou = true;
    }
  });
  if (mudou) salvarTransacoes({ flush: true });
  return mudou;
}

transacoes = transacoes.map((t) => {
  if (t.mes === undefined && t.data) {
    const ma = appliqueiMesAnoDe(t.data);
    t.mes = ma.mes;
    t.ano = ma.ano;
    t.id = t.id || Math.random().toString();
  }
  if (t.pago === undefined) t.pago = false;
  return t;
});
// Corrige, já no carregamento, despesas variáveis programadas que vieram pagas
// (dados antigos) — antes de qualquer aba (Controle/Patrimônio) renderizar.
normalizarDespesasProgramadas();

// Autocompletar Inteligente
function atualizarDatalistDescricoes() {
  const datalist = document.getElementById('listaDescricoes');
  datalist.innerHTML = '';
  const descricoesUnicas = [
    ...new Set(
      transacoes.map((t) => {
        // Transação sem descrição existe (importação de backup, dado legado):
        // `undefined.includes` lançava aqui e derrubava quem chamasse. Como
        // registrarOperacaoAtivo chama esta função DEPOIS de gravar, o erro
        // aparecia com a operação já salva e a tela pela metade.
        let d = t.descricao || '';
        if (d.includes(' (')) d = d.substring(0, d.lastIndexOf(' ('));
        return d;
      })
    ),
  ];
  descricoesUnicas
    .filter((d) => d && d.trim() !== '')
    .forEach((desc) => {
      const option = document.createElement('option');
      option.value = desc;
      datalist.appendChild(option);
    });
}

function prepararEdicao(id) {
  const trans = transacoes.find((t) => t.id === id);
  if (!trans) return;
  // Editando, a classificação já existe: sugerir outra seria discutir com o
  // usuário sobre uma decisão que ele tomou.
  if (typeof insightsSugestaoLimpar === 'function') insightsSugestaoLimpar();
  document.getElementById('descTransacao').value = trans.descricao;
  setValorBRLInput(document.getElementById('valorTransacao'), trans.valor);
  document.getElementById('categoriaTransacao').value = trans.categoria;
  document.getElementById('editTransacaoId').value = trans.id;
  document.getElementById('obsTransacao').value = trans.obs || '';
  document.getElementById('dataVencimento').value = trans.dataVencimento || '';
  const bancoEl = document.getElementById('bancoTransacao');
  if (bancoEl) bancoEl.value = trans.banco || '';
  if (categoriaDespesaUsada(trans.categoria)) popularSelectCategoriaDespesa(trans.categoriaDespesa);

  document.getElementById('btnSalvarControle').style.display = 'flex';
  document.getElementById('opcoesEdicaoRecorrente').style.display = 'none';
  document.getElementById('btnSalvarControle').innerHTML =
    '<i class="ph-bold ph-pencil-simple"></i> Atualizar Lançamento';
  document.getElementById('btnSalvarControle').style.backgroundColor = 'var(--cor-info)';
  document.getElementById('btnCancelarEdicao').style.display = 'block';
  verificarRegraCartao();
  if (trans.categoria === 'cartao_credito') {
    document.getElementById('grupoParcelas').style.display = 'none';
    if (trans.cartaoId) {
      atualizarSelectCartoesForm();
      document.getElementById('selectCartao').value = trans.cartaoId;
    }
    selecionarTipoCartao(trans.cartaoFixoMensal ? 'fixo' : 'parcelado');
    document.getElementById('grupoParcelas').style.display = 'none';
    // verificarRegraCartao() acabou de chamar preencherVencimentoPorCartao(),
    // que calcula a fatura de HOJE e sobrescreveu o campo. Numa despesa antiga
    // isso trocava a data guardada só por ela ter sido aberta para editar a
    // descrição — e salvar gravava a data nova. A data do lançamento manda;
    // trocar de cartão daqui em diante recalcula normalmente pelo onchange.
    document.getElementById('dataVencimento').value = trans.dataVencimento || '';
    // O seletor nasce recolhido a cada edição: quem abriu para corrigir a
    // descrição não pode mover a fatura por acidente.
    faturaSeletorExpandido = false;
    // A intenção vem da data GUARDADA, não de hoje. Se o lançamento está numa
    // das duas candidatas, o rádio correspondente nasce marcado; se está numa
    // terceira fatura, o seletor mostra onde ele está e exige um clique.
    const candEd = faturaCandidatasDoForm();
    const elIntencao = document.getElementById('faturaEscolhida');
    if (candEd && elIntencao) {
      elIntencao.value =
        trans.dataVencimento === faturaYmd(candEd.fechada.vencimento) ? 'fechada' : 'aberta';
    }
    preencherVencimentoPorCartao();
  }
  document.getElementById('descTransacao').focus();

  document.getElementById('tituloPainelControle').innerHTML =
    '<i class="ph ph-pencil-simple" style="color: var(--cor-info);"></i> Editando Operação';

  // Abre o drawer/bottom-sheet automaticamente ao iniciar edição
  abrirPainelLancamento();
}

function cancelarEdicaoControle() {
  if (typeof insightsSugestaoLimpar === 'function') insightsSugestaoLimpar();
  faturaSeletorExpandido = false;
  const elFat = document.getElementById('faturaEscolhida');
  if (elFat) elFat.value = 'aberta';
  document.getElementById('editTransacaoId').value = '';
  document.getElementById('descTransacao').value = '';
  document.getElementById('valorTransacao').value = '';
  document.getElementById('categoriaTransacao').value = '';
  document.getElementById('dataVencimento').value = '';
  document.getElementById('obsTransacao').value = '';
  const catDespEl = document.getElementById('categoriaDespesa');
  if (catDespEl) catDespEl.value = '';
  const catDespNovaEl = document.getElementById('categoriaDespesaNova');
  if (catDespNovaEl) catDespNovaEl.value = '';
  resetarEmojiCategoriaNova();
  selecionarTipoCartao('parcelado');

  document.getElementById('btnSalvarControle').style.display = 'flex';
  document.getElementById('opcoesEdicaoRecorrente').style.display = 'none';
  document.getElementById('btnSalvarControle').innerHTML =
    '<i class="ph ph-check-circle"></i> Salvar Lançamento';
  document.getElementById('btnSalvarControle').style.backgroundColor = 'var(--cor-primaria)';
  document.getElementById('btnCancelarEdicao').style.display = 'none';
  document.getElementById('tituloPainelControle').innerHTML =
    '<i class="ph ph-plus-circle" style="color: var(--cor-primaria);"></i> Registrar Operação';
  verificarRegraCartao();
}

function tentarSalvarTransacao() {
  const desc = (document.getElementById('descTransacao').value || '').trim();
  const valorTotal = Number(parseBRL(document.getElementById('valorTransacao').value));
  const categoria = document.getElementById('categoriaTransacao').value;
  const editId = document.getElementById('editTransacaoId').value;

  if (!desc || !Number.isFinite(valorTotal) || valorTotal <= 0 || !categoria)
    return mostrarToast(
      'Preencha a descrição, o valor e escolha uma Classificação Contábil válida!',
      'erro'
    );

  if (controleBancoObrigatorio(categoria)) {
    const bancoEl = document.getElementById('bancoTransacao');
    const banco = (bancoEl?.value || '').trim();
    if (!banco) {
      const ehEntrada = categoria === 'receita' || categoria === 'resgate_investimento';
      mostrarToast(
        ehEntrada
          ? 'Informe o banco/instituição que recebe.'
          : 'Informe o banco/instituição de onde a despesa será debitada.',
        'erro'
      );
      bancoEl?.focus();
      return;
    }
  }

  if (editId) {
    const transAtual = transacoes.find((t) => t.id === editId);
    // Se for do grupo fixo/recorrente, perguntar como salvar (mostra botões)
    if (transAtual && transAtual.groupId) {
      document.getElementById('btnSalvarControle').style.display = 'none';
      document.getElementById('opcoesEdicaoRecorrente').style.display = 'flex';
      return; // Para aqui, espera a decisão do usuário
    } else {
      executarEdicao('unica'); // Se não tiver grupo, edita normal
      return;
    }
  }
  executarInsercao();
}

function executarEdicao(modo) {
  const desc = (document.getElementById('descTransacao').value || '').trim();
  const valorTotal = Number(parseBRL(document.getElementById('valorTransacao').value));
  const categoria = document.getElementById('categoriaTransacao').value;
  const dataVencInput = document.getElementById('dataVencimento').value;
  const obs = (document.getElementById('obsTransacao').value || '').trim();

  if (!desc || !Number.isFinite(valorTotal) || valorTotal <= 0 || !categoria) {
    return mostrarToast(
      'Preencha a descrição, o valor e escolha uma Classificação Contábil válida!',
      'erro'
    );
  }
  const editId = document.getElementById('editTransacaoId').value;
  const transAtual = transacoes.find((t) => t.id === editId);
  const cartaoIdNovo =
    categoria === 'cartao_credito' ? document.getElementById('selectCartao').value : null;
  const bancoNovo = controleCategoriaUsaBanco(categoria)
    ? (document.getElementById('bancoTransacao')?.value || '').trim()
    : null;
  if (controleBancoObrigatorio(categoria) && !bancoNovo) {
    return mostrarToast('Informe o banco/instituição da operação.', 'erro');
  }
  // Fase 2: carimba a conta (cria se o nome for novo). Mantém `banco` string.
  const contaIdNovo =
    bancoNovo && typeof obterOuCriarContaPorNome === 'function'
      ? (obterOuCriarContaPorNome(bancoNovo) || {}).id
      : undefined;
  const catDespesaNovo = resolverCategoriaDespesaSelecionada(categoria);

  if (modo === 'todas') {
    // Numa série recorrente, mudar o vencimento significa mudar o DIA em todos
    // os meses ("o aluguel passou a vencer dia 25"), não empurrar as parcelas de
    // mês. Antes deste bloco a edição "todos os meses" simplesmente ignorava a
    // data: dava para mudar valor e descrição, nunca o vencimento.
    const diaNovo = competenciaDaData(dataVencInput)
      ? parseInt(String(dataVencInput).split('-')[2], 10)
      : null;
    transacoes = transacoes.map((t) => {
      if (
        t.groupId === transAtual.groupId &&
        (t.ano > transAtual.ano || (t.ano === transAtual.ano && t.mes >= transAtual.mes))
      ) {
        t.descricao = desc;
        t.valor = valorTotal;
        t.categoria = categoria;
        t.obs = obs;
        if (diaNovo) {
          // Preserva o mês de cada parcela e respeita meses curtos (dia 31 em
          // fevereiro vira o último dia do mês).
          const base = competenciaDaData(t.dataVencimento) || { mes: t.mes, ano: t.ano };
          const ultimoDia = new Date(base.ano, base.mes + 1, 0).getDate();
          const dia = Math.min(diaNovo, ultimoDia);
          t.dataVencimento = `${base.ano}-${String(base.mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        }
        if (categoria === 'cartao_credito' && cartaoIdNovo && cartaoIdNovo !== '__novo__')
          t.cartaoId = cartaoIdNovo;
        if (bancoNovo !== null) {
          t.banco = bancoNovo || undefined;
          t.contaId = contaIdNovo;
        }
        if (categoriaDespesaUsada(categoria)) t.categoriaDespesa = catDespesaNovo || undefined;
      }
      return t;
    });
  } else {
    // A competência (mes/ano) é o que decide em QUE MÊS o lançamento aparece —
    // toda a tela filtra por ela, não pela data. Sem isto, corrigir a data de um
    // lançamento gravava a data nova e deixava o lançamento no mês errado: o
    // sintoma "editei a data e não corrigiu".
    // Só recalcula quando a data MUDA. Lançamentos em que competência e
    // vencimento divergem de propósito (conta de agosto que vence em setembro)
    // continuam onde estão enquanto ninguém mexer na data.
    const dataMudou = (dataVencInput || '') !== (transAtual.dataVencimento || '');
    const comp = dataMudou ? competenciaDaData(dataVencInput) : null;
    if (comp) {
      transAtual.mes = comp.mes;
      transAtual.ano = comp.ano;
    }
    transAtual.descricao = desc;
    transAtual.valor = valorTotal;
    transAtual.categoria = categoria;
    transAtual.dataVencimento = dataVencInput;
    transAtual.obs = obs;
    if (categoria === 'cartao_credito' && cartaoIdNovo && cartaoIdNovo !== '__novo__')
      transAtual.cartaoId = cartaoIdNovo;
    if (bancoNovo !== null) {
      transAtual.banco = bancoNovo || undefined;
      transAtual.contaId = contaIdNovo;
    }
    if (categoriaDespesaUsada(categoria)) transAtual.categoriaDespesa = catDespesaNovo || undefined;
    if (transAtual.groupId) transAtual.groupId = null;
  }

  cancelarEdicaoControle();
  // Aborta quando a gravação falha — salvarTransacoes já logou e avisou o
  // usuário; aqui só não se pode seguir como se tivesse dado certo.
  if (!salvarTransacoes()) return;
  try {
    if (window.AppliqueiCloudSync && typeof AppliqueiCloudSync.forceFlush === 'function') {
      AppliqueiCloudSync.forceFlush();
    }
  } catch (_) {}
  mostrarToast('Lançamento atualizado!', 'sucesso');
  atualizarTelaControle();
  atualizarDatalistDescricoes();
  fecharPainelLancamento();
}

function executarInsercao() {
  const desc = (document.getElementById('descTransacao').value || '').trim();
  const valorTotal = Number(parseBRL(document.getElementById('valorTransacao').value));
  const categoria = document.getElementById('categoriaTransacao').value;
  const ehFixo = document.getElementById('transacaoFixa').checked;
  const parcelas = parseInt(document.getElementById('qtdParcelas').value, 10) || 1;
  const dataVencInput = document.getElementById('dataVencimento').value;
  const obs = (document.getElementById('obsTransacao').value || '').trim();
  const tipoCartao = document.getElementById('tipoCartaoSelecionado').value; // 'parcelado' | 'fixo'
  const cartaoId =
    categoria === 'cartao_credito' ? document.getElementById('selectCartao').value : null;

  // Revalidação no ponto de inserção: blinda contra entradas que
  // passaram pela validação anterior mas chegaram aqui inválidas
  // (ex.: parseBRL devolvendo 0 por máscara mal aplicada).
  if (!desc || !Number.isFinite(valorTotal) || valorTotal <= 0 || !categoria) {
    return mostrarToast(
      'Preencha a descrição, o valor e escolha uma Classificação Contábil válida!',
      'erro'
    );
  }

  if (categoria === 'cartao_credito' && (!cartaoId || cartaoId === '__novo__')) {
    return mostrarToast('Selecione um cartão válido.', 'erro');
  }

  const cartaoFixoMensal = categoria === 'cartao_credito' && tipoCartao === 'fixo';
  const groupId = ehFixo || categoria === 'cartao_credito' ? Date.now().toString() : null;
  const bancoReceita = controleCategoriaUsaBanco(categoria)
    ? (document.getElementById('bancoTransacao')?.value || '').trim()
    : null;
  if (controleBancoObrigatorio(categoria) && !bancoReceita) {
    return mostrarToast('Informe o banco/instituição da operação.', 'erro');
  }
  // Fase 2: carimba a conta (cria se o nome for novo). Mantém `banco` string.
  const contaIdReceita =
    bancoReceita && typeof obterOuCriarContaPorNome === 'function'
      ? (obterOuCriarContaPorNome(bancoReceita) || {}).id
      : undefined;
  const catDespesa = resolverCategoriaDespesaSelecionada(categoria);
  let mesesGerar = 1;
  let valorLancamento = valorTotal;

  // Despesa variável avulsa (sorvete, suco, etc.) é uma compra à vista: já saiu
  // do bolso no ato. Nasce `pago: true` para debitar o caixa do Meu Patrimônio
  // na hora — sem precisar clicar "pagar" depois. Despesa fixa e cartão são
  // compromissos a vencer, então seguem `pago: false` (entram em "a pagar").
  // EXCEÇÃO: se o usuário informou um vencimento FUTURO (ex.: "camisa do
  // congresso até dia 15"), a despesa variável é um compromisso PROGRAMADO —
  // nasce pendente (pago:false) e só entra no caixa quando for de fato paga.
  const pagoBase = categoria === 'despesa_variavel' && !ehFixo;
  const _hoje = new Date();
  const hojeStrIns = `${_hoje.getFullYear()}-${String(_hoje.getMonth() + 1).padStart(2, '0')}-${String(_hoje.getDate()).padStart(2, '0')}`;

  if (categoria === 'cartao_credito' && tipoCartao === 'parcelado' && parcelas > 1) {
    mesesGerar = parcelas;
    valorLancamento = valorTotal / parcelas;
  } else if (cartaoFixoMensal) {
    mesesGerar = 60;
  } else if (ehFixo) {
    mesesGerar = 60;
  }

  for (let i = 0; i < mesesGerar; i++) {
    let m = visaoMes + i;
    let a = visaoAno;
    while (m > 11) {
      m -= 12;
      a++;
    }
    let descFinal = desc;
    if (categoria === 'cartao_credito' && tipoCartao === 'parcelado' && parcelas > 1)
      descFinal += ` (${i + 1}/${parcelas})`;

    let dataVencFinal = null;
    if (dataVencInput) {
      let [vAno, vMes, vDia] = dataVencInput.split('-');
      let dVenc = new Date(vAno, vMes - 1, vDia);
      dVenc.setMonth(dVenc.getMonth() + i);
      dataVencFinal = `${dVenc.getFullYear()}-${String(dVenc.getMonth() + 1).padStart(2, '0')}-${String(dVenc.getDate()).padStart(2, '0')}`;
    }

    // Havendo vencimento, a competência (mes/ano) é a DELE — não a do mês em
    // visão. Isto valia só para cartão (a compra entra na fatura certa) e agora
    // vale para todas as categorias, porque o painel de Vencimentos filtra por
    // mes/ano e desenha só o DIA do dataVencimento: com a competência atrasada,
    // um aluguel registrado em agosto com vencimento em 10/set aparecia no
    // painel de AGOSTO exibindo um "10" pelado, que se lê como 10 de agosto. Em
    // despesa fixa recorrente o desencontro se repetia em todas as parcelas.
    //
    // Também alinha a inserção com salvarEdicaoTransacao, que já derivava a
    // competência de competenciaDaData(dataVencimento): antes, abrir e salvar a
    // edição sem mudar nada movia o lançamento de mês.
    //
    // Sem vencimento informado não há de onde derivar — fica o mês em visão.
    const compVenc = competenciaDaData(dataVencFinal);
    if (compVenc) {
      a = compVenc.ano;
      m = compVenc.mes;
    }

    // Vencimento futuro → compromisso programado (pendente); senão, paga à vista.
    const pagoLanc = pagoBase && !(dataVencFinal && dataVencFinal > hojeStrIns);

    transacoes.push({
      id: Date.now().toString() + i,
      groupId: groupId,
      descricao: descFinal,
      valor: Number(valorLancamento),
      categoria: categoria,
      cartaoId: cartaoId,
      cartaoFixoMensal: cartaoFixoMensal || undefined,
      banco: bancoReceita || undefined,
      contaId: contaIdReceita,
      categoriaDespesa: catDespesa || undefined,
      obs: obs,
      mes: m,
      ano: a,
      data: new Date().toISOString(),
      dataVencimento: dataVencFinal,
      pago: pagoLanc,
    });
  }

  if (!salvarTransacoes()) return;
  // Força sync imediato em vez de esperar o debounce de 2s — cobre
  // o caso do usuário lançar uma despesa e fechar o tab antes do
  // flush automático (que era o sintoma do "falso salvamento").
  try {
    if (window.AppliqueiCloudSync && typeof AppliqueiCloudSync.forceFlush === 'function') {
      AppliqueiCloudSync.forceFlush();
    }
  } catch (_) {}
  document.getElementById('descTransacao').value = '';
  if (typeof insightsSugestaoLimpar === 'function') insightsSugestaoLimpar();
  document.getElementById('valorTransacao').value = '';
  document.getElementById('transacaoFixa').checked = false;
  // O próximo lançamento recomeça na fatura aberta — que é o caso comum.
  // Herdar "fechada" do lançamento anterior mandaria a compra seguinte para o
  // mês passado sem ninguém pedir.
  faturaSeletorExpandido = false;
  const elFatNovo = document.getElementById('faturaEscolhida');
  if (elFatNovo) elFatNovo.value = 'aberta';
  document.getElementById('qtdParcelas').value = 1;
  document.getElementById('dataVencimento').value = '';
  document.getElementById('categoriaTransacao').value = '';
  document.getElementById('obsTransacao').value = '';
  const bancoEl = document.getElementById('bancoTransacao');
  if (bancoEl) bancoEl.value = '';
  const grupoBanco = document.getElementById('grupoBancoReceita');
  if (grupoBanco) grupoBanco.style.display = 'none';
  const catDespEl = document.getElementById('categoriaDespesa');
  if (catDespEl) catDespEl.value = '';
  const catDespNovaEl = document.getElementById('categoriaDespesaNova');
  if (catDespNovaEl) catDespNovaEl.value = '';
  resetarEmojiCategoriaNova();
  const grupoCatDesp = document.getElementById('grupoCategoriaDespesa');
  if (grupoCatDesp) grupoCatDesp.style.display = 'none';
  selecionarTipoCartao('parcelado');
  mostrarToast(mensagemLancamentoSalvo(categoria, dataVencInput, mesesGerar), 'sucesso');
  atualizarTelaControle();
  atualizarDatalistDescricoes();
  fecharPainelLancamento();
}

// Aporte externo (ver appliquei-utils.js). Fallback local para o caso de o
// módulo ser avaliado sozinho num sandbox de teste, sem utils carregado.
function cfEhAporteExterno(t) {
  if (typeof ehAporteExterno === 'function') return ehAporteExterno(t);
  return (
    !!t &&
    (t.categoria === 'investimento_fixo' || t.categoria === 'investimento_variavel') &&
    !!t.origemExterna
  );
}

// Resumo do mês por classificação contábil.
//
// `invFixo`/`invVar` são APORTES QUE SAÍRAM DO CAIXA — é o que a sobra do mês,
// a DRE e o relatório subtraem. O aporte externo ("dinheiro de fora do app")
// tem bucket próprio, `invExterno`: ele é investimento de verdade e soma no
// capital aplicado, mas nunca saiu de conta nenhuma, então descontá-lo aqui
// inventaria uma despesa que não existe. Foi o que acontecia com o aporte
// externo e com as parcelas da recorrência que ele agenda.
function calcularResumoMes(mesAlvo, anoAlvo) {
  let res = {
    receita: 0,
    resgate: 0,
    despFixa: 0,
    despVar: 0,
    cartao: 0,
    invFixo: 0,
    invVar: 0,
    invExterno: 0,
    sonho: 0,
  };
  transacoes.forEach((t) => {
    if (t.mes === mesAlvo && t.ano === anoAlvo) {
      if (t.categoria === 'receita' || t.categoria === 'dividendo') res.receita += t.valor;
      else if (t.categoria === 'resgate_investimento') res.resgate += t.valor;
      else if (t.categoria === 'despesa_fixa') res.despFixa += t.valor;
      else if (t.categoria === 'despesa_variavel') res.despVar += t.valor;
      else if (t.categoria === 'cartao_credito') res.cartao += t.valor;
      else if (cfEhAporteExterno(t)) res.invExterno += t.valor;
      else if (t.categoria === 'investimento_fixo') res.invFixo += t.valor;
      else if (t.categoria === 'investimento_variavel') res.invVar += t.valor;
      else if (t.categoria === 'sonho') res.sonho += t.valor;
    }
  });
  return res;
}

// Aporte líquido acumulado (aportes − resgates) de TUDO que é anterior ao mês
// dado — inclusive o aporte externo, que é capital aplicado ainda que não
// tenha saído do caixa. Serve de ponto de partida da linha
// "Investimento acumulado" da DRE:
// a tabela mostra uma janela de meses, e um acumulado que começasse do zero na
// borda esquerda esconderia todo o histórico anterior.
//
// A comparação é por competência (ano, mês) — a mesma chave canônica que o
// resto do Controle usa (INV-08). Estritamente ANTERIOR: o próprio mês entra
// pela soma da tabela.
function aporteLiquidoAcumuladoAte(mesAlvo, anoAlvo) {
  if (typeof transacoes === 'undefined') return 0;
  let total = 0;
  for (const t of transacoes) {
    if (t.ano > anoAlvo || (t.ano === anoAlvo && t.mes >= mesAlvo)) continue;
    if (t.categoria === 'investimento_fixo' || t.categoria === 'investimento_variavel')
      total += t.valor || 0;
    else if (t.categoria === 'resgate_investimento') total -= t.valor || 0;
  }
  return total;
}

// === Composição do mês: agrupamento do gráfico de barras ===
// 'contabil' = barras por classificação contábil (Receita, Cartão, Fixa...).
// 'despesa'  = despesas (fixa + variável + cartão) quebradas por categoria
//              de despesa (Alimentação, Transporte...), mantendo Receita/Sobra.
var agrupamentoComposicao = 'contabil';

// Paleta cíclica para as barras de categoria de despesa.
var PALETA_CATEGORIA_DESPESA = [
  '#e11d48',
  '#f97316',
  '#f59e0b',
  '#7c3aed',
  '#2563eb',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#9333ea',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
];

function setAgrupamentoComposicao(tipo) {
  agrupamentoComposicao = tipo === 'despesa' ? 'despesa' : 'contabil';
  const sel = document.getElementById('agrupamentoComposicao');
  if (sel && sel.value !== agrupamentoComposicao) sel.value = agrupamentoComposicao;
  if (typeof atualizarTelaControle === 'function') atualizarTelaControle();
}

// Soma as despesas do mês agrupadas pela categoria de despesa (campo
// categoriaDespesa). Lançamentos sem categoria caem em '__sem_categoria__'.
function calcularDespesasPorCategoria(mesAlvo, anoAlvo) {
  const mapa = {};
  transacoes.forEach((t) => {
    if (t.mes === mesAlvo && t.ano === anoAlvo && categoriaDespesaUsada(t.categoria)) {
      const chave = t.categoriaDespesa || '__sem_categoria__';
      mapa[chave] = (mapa[chave] || 0) + t.valor;
    }
  });
  return mapa;
}

// ============================================================
// === Saldo carregado entre meses (carregamento automático) ==
// ============================================================
// O resultado de um mês é carregado AUTOMATICAMENTE para o mês seguinte
// (saldo acumulado / running balance), igual ao extrato de uma conta.
// O localStorage `futurorico_saldoCarregado` guarda apenas AJUSTES MANUAIS:
//   { "ano-mes": { valor, manual:true } }
// Quando há ajuste manual num mês, ele substitui o saldo de abertura daquele
// mês e o acúmulo recomeça a partir dali. Entradas no formato antigo (sem a
// flag `manual`) são ignoradas — migração silenciosa do opt-in anterior.
function chaveMes(mes, ano) {
  return `${ano}-${mes}`;
}
function obterMapaSaldoCarregado() {
  try {
    return JSON.parse(localStorage.getItem('futurorico_saldoCarregado') || '{}');
  } catch (e) {
    return {};
  }
}
function salvarMapaSaldoCarregado(m) {
  localStorage.setItem('futurorico_saldoCarregado', JSON.stringify(m));
}

// Resultado bruto do mês (receitas - despesas - cartão - aportes - sonhos).
//
// O sonho tem parcela própria na subtração e não se esconde dentro de
// `totDesp`. O resultado é o mesmo — o dinheiro sai do caixa de qualquer
// forma —, mas quem ler esta função não vai concluir que guardar para uma meta
// é despesa de consumo, que foi como o número acabou parar no relatório.
function calcularResultadoMes(mes, ano) {
  const r = calcularResumoMes(mes, ano);
  const totRec = r.receita + r.resgate;
  const totDesp = r.despFixa + r.despVar;
  const totInv = r.invFixo + r.invVar;
  return totRec - totDesp - r.cartao - totInv - r.sonho;
}

// Competência (ano*12+mes) do primeiro lançamento — base do acúmulo.
function obterPrimeiroMesComLancamento() {
  if (typeof transacoes === 'undefined') return null;
  let min = null;
  transacoes.forEach((t) => {
    if (typeof t.mes !== 'number' || typeof t.ano !== 'number') return;
    const v = t.ano * 12 + t.mes;
    if (min === null || v < min) min = v;
  });
  return min;
}

// Resultado acumulado (fechamento) até (mes,ano) inclusive: soma os resultados
// brutos desde o 1º lançamento, reiniciando a base quando há ajuste manual.
function resultadoAcumuladoAteMes(mes, ano) {
  const alvo = ano * 12 + mes;
  const mapa = obterMapaSaldoCarregado();
  const primeiro = obterPrimeiroMesComLancamento();
  if (primeiro === null) {
    const ov = mapa[chaveMes(mes, ano)];
    const base = ov && ov.manual ? Number(ov.valor) || 0 : 0;
    return base + calcularResultadoMes(mes, ano);
  }
  let acc = 0;
  const inicio = Math.min(primeiro, alvo);
  for (let v = inicio; v <= alvo; v++) {
    const a = Math.floor(v / 12);
    const m = v % 12;
    const ov = mapa[`${a}-${m}`];
    if (ov && ov.manual) acc = (Number(ov.valor) || 0) + calcularResultadoMes(m, a);
    else acc = acc + calcularResultadoMes(m, a);
  }
  return acc;
}

// ============================================================
// === KPI "Saldo em conta" — o dinheiro que existe de verdade ===
// ============================================================
// O card vizinho, "Saldo livre", responde sobre o MÊS: quanto do que entrou
// ainda não tem destino. Este responde sobre o DINHEIRO: quanto há nas contas.
// São perguntas diferentes, e por isso dois cards — juntos num só, a pessoa
// lia o saldo do mês como se fosse o extrato do banco.
//
// A referência muda com o mês na tela, senão os dois cards ficariam falando
// de tempos diferentes sem avisar:
//   · mês corrente → AGORA (o mesmo número de Meu patrimônio);
//   · mês passado  → o fim daquele mês;
//   · mês futuro   → o projetado para o fim dele.
//
// Quem faz a conta é saldoCaixaPorConta (contas.js), que já reúne a foto de
// hoje e o que está agendado — e é a mesma função que decide se uma compra
// agendada cabe no saldo. Duplicar a regra aqui seria criar um segundo saldo.
function referenciaSaldoEmConta(mes, ano) {
  const agora = Date.now();
  const hoje = new Date();
  if (mes === hoje.getMonth() && ano === hoje.getFullYear()) return agora;
  return new Date(ano, mes + 1, 0, 23, 59, 59, 999).getTime();
}

function calcularSaldoEmContaDoMes(mes, ano) {
  if (typeof saldoCaixaPorConta !== 'function') return null;
  const saldos = saldoCaixaPorConta(referenciaSaldoEmConta(mes, ano)) || {};
  return Object.keys(saldos).reduce((s, k) => s + (Number(saldos[k]) || 0), 0);
}

function atualizarKpiSaldoEmConta(mes, ano) {
  const el = document.getElementById('kpiSaldoConta');
  const sub = document.getElementById('kpiSaldoContaSub');
  if (!el) return;

  const total = calcularSaldoEmContaDoMes(mes, ano);
  if (total == null) {
    // Sem o módulo de contas não há saldo a mostrar. Zerar seria pior que
    // calar: um R$ 0,00 lê como "você não tem dinheiro".
    el.innerText = '—';
    el.style.color = 'var(--cor-texto-mutado)';
    if (sub) sub.innerText = 'indisponível agora';
    return;
  }

  el.innerText = formatarMoeda(total);
  el.style.color = total < 0 ? 'var(--cor-erro)' : 'var(--cor-txt-info)';

  if (!sub) return;
  const hoje = new Date();
  const ehCorrente = mes === hoje.getMonth() && ano === hoje.getFullYear();
  const fimMes = new Date(ano, mes + 1, 0).getTime();
  const rotuloMes = new Date(ano, mes, 1)
    .toLocaleDateString('pt-BR', { month: 'long' })
    .replace('.', '');
  if (ehCorrente) sub.innerText = 'o que existe hoje, somando as suas contas';
  else if (fimMes < Date.now()) sub.innerText = `no fim de ${rotuloMes}, somando as suas contas`;
  else sub.innerText = `projetado para o fim de ${rotuloMes}, com o que está agendado`;
}

// Saldo de abertura do mês = ajuste manual (se houver) OU fechamento do mês anterior.
function obterSaldoCarregadoParaMes(mes, ano) {
  const mapa = obterMapaSaldoCarregado();
  const ov = mapa[chaveMes(mes, ano)];
  if (ov && ov.manual) return Number(ov.valor) || 0;
  const mesAnt = mes === 0 ? 11 : mes - 1;
  const anoAnt = mes === 0 ? ano - 1 : ano;
  return resultadoAcumuladoAteMes(mesAnt, anoAnt);
}

// Edição manual do saldo trazido (ajuste pontual no DRE). Branco = volta ao automático.
function editarSaldoMesAnterior(mes, ano) {
  const atual = obterSaldoCarregadoParaMes(mes, ano);
  const entrada = prompt(
    'Ajustar o saldo trazido do mês anterior (em R$). Deixe em branco para voltar ao cálculo automático:',
    (Number(atual) || 0).toFixed(2).replace('.', ',')
  );
  if (entrada === null) return;
  const mapa = obterMapaSaldoCarregado();
  const txt = entrada.trim();
  if (txt === '') {
    delete mapa[chaveMes(mes, ano)];
    salvarMapaSaldoCarregado(mapa);
    mostrarToast('Saldo do mês anterior voltou ao cálculo automático.', 'aviso');
  } else {
    const v = parseBRL(txt);
    if (!Number.isFinite(v)) return mostrarToast('Valor inválido.', 'erro');
    mapa[chaveMes(mes, ano)] = { valor: v, manual: true };
    salvarMapaSaldoCarregado(mapa);
    mostrarToast('Saldo do mês anterior ajustado manualmente.', 'sucesso');
  }
  try {
    if (window.AppliqueiCloudSync && typeof AppliqueiCloudSync.forceFlush === 'function')
      AppliqueiCloudSync.forceFlush();
  } catch (_) {}
  atualizarTelaControle();
}

function resetarSaldoMesAnterior(mes, ano) {
  const mapa = obterMapaSaldoCarregado();
  delete mapa[chaveMes(mes, ano)];
  salvarMapaSaldoCarregado(mapa);
  try {
    if (window.AppliqueiCloudSync && typeof AppliqueiCloudSync.forceFlush === 'function')
      AppliqueiCloudSync.forceFlush();
  } catch (_) {}
  mostrarToast('Saldo do mês anterior voltou ao cálculo automático.', 'aviso');
  atualizarTelaControle();
}

// Banner informativo: o carregamento é automático; oferece apenas o ajuste manual.
function atualizarBannerSaldoMesAnterior(mesAtual, anoAtual) {
  const banner = document.getElementById('bannerSaldoMesAnterior');
  const txt = document.getElementById('txtBannerSaldoMesAnt');
  const acoes = document.getElementById('acoesBannerSaldoMesAnt');
  if (!banner || !txt || !acoes) return;
  const nomeMeses = [
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
  const mesAnt = mesAtual === 0 ? 11 : mesAtual - 1;
  const anoAnt = mesAtual === 0 ? anoAtual - 1 : anoAtual;
  const saldo = obterSaldoCarregadoParaMes(mesAtual, anoAtual);
  const mapa = obterMapaSaldoCarregado();
  const reg = mapa[chaveMes(mesAtual, anoAtual)];
  const manual = !!(reg && reg.manual);

  if (Math.abs(saldo) < 0.005 && !manual) {
    banner.style.display = 'none';
    return;
  }
  const cor = saldo >= 0 ? '#10b981' : '#ef4444';
  txt.innerHTML = manual
    ? `<i class="ph-bold ph-pencil-simple" style="color:var(--tinta-roxo);margin-right:4px;"></i> Saldo do mês anterior <strong>ajustado manualmente</strong> para <strong style="color:${cor};font-family:'DM Mono',monospace;">${formatarMoeda(saldo)}</strong>.`
    : `<i class="ph-fill ph-arrow-fat-line-right" style="color:var(--tinta-roxo);margin-right:4px;"></i> O fechamento de <strong>${nomeMeses[mesAnt]}/${anoAnt}</strong> (<strong style="color:${cor};font-family:'DM Mono',monospace;">${formatarMoeda(saldo)}</strong>) é carregado automaticamente para <strong>${nomeMeses[mesAtual]}/${anoAtual}</strong>.`;
  acoes.innerHTML =
    `<button class="btn-secundario" style="font-size:11.5px;padding:6px 12px;" onclick="editarSaldoMesAnterior(${mesAtual},${anoAtual})"><i class="ph ph-pencil-simple"></i> Ajustar</button>` +
    (manual
      ? `<button class="btn-secundario" style="font-size:11.5px;padding:6px 12px;border-color:var(--cor-erro);color:var(--cor-erro);" onclick="resetarSaldoMesAnterior(${mesAtual},${anoAtual})"><i class="ph ph-arrow-counter-clockwise"></i> Voltar ao automático</button>`
      : '');
  banner.style.display = 'flex';
}

var itemParaDeletar = null;

function deletarTransacao(idStr) {
  const transacao = transacoes.find((t) => t.id == idStr);
  if (!transacao) return;

  itemParaDeletar = transacao;
  const modal = document.getElementById('modalConfirmacao');
  const titulo = document.getElementById('modalTitulo');
  const msg = document.getElementById('modalMensagem');
  const acoes = document.getElementById('modalAcoes');

  titulo.innerHTML = `<i class="ph-fill ph-warning-circle" style="color: var(--cor-erro);"></i> Excluir Lançamento`;

  if (transacao.groupId) {
    msg.innerHTML = `O lançamento <strong>"${transacao.descricao}"</strong> é uma conta fixa/parcelada.<br>Como deseja realizar a exclusão?`;
    acoes.innerHTML = `
            <button class="btn-acao" style="background-color: var(--cor-texto-principal);" onclick="executarDelecao('unica')"><i class="ph ph-target"></i> Excluir apenas este mês</button>
            <button class="btn-acao" style="background-color: var(--cor-erro);" onclick="executarDelecao('todas')"><i class="ph ph-trash"></i> Excluir este e os futuros</button>
        `;
  } else {
    msg.innerHTML = `Tem certeza de que deseja excluir o lançamento <strong>"${transacao.descricao}"</strong>?`;
    acoes.innerHTML = `
            <button class="btn-acao" style="background-color: var(--cor-erro);" onclick="executarDelecao('unica')"><i class="ph ph-trash"></i> Sim, excluir definitivamente</button>
        `;
  }
  modal.style.display = 'flex';
}

function fecharModal() {
  document.getElementById('modalConfirmacao').style.display = 'none';
  itemParaDeletar = null;
}

function executarDelecao(modo) {
  if (!itemParaDeletar) return;
  if (modo === 'todas') {
    transacoes = transacoes.filter(
      (t) =>
        !(
          t.groupId === itemParaDeletar.groupId &&
          (t.ano > itemParaDeletar.ano ||
            (t.ano === itemParaDeletar.ano && t.mes >= itemParaDeletar.mes))
        )
    );
  } else {
    transacoes = transacoes.filter((t) => t.id != itemParaDeletar.id);
  }
  salvarTransacoes();
  mostrarToast('Lançamento excluído.', 'aviso');
  fecharModal();
  atualizarTelaControle();
  atualizarDatalistDescricoes();
}

function abrirModalGrupoCartao(key) {
  const grupo = window._gruposCartaoVenc && window._gruposCartaoVenc[key];
  if (!grupo) return mostrarToast('Grupo não encontrado.', 'erro');
  const cartaoInfo = obterCartao(grupo.cartaoId);
  const nomeCartao = cartaoInfo ? cartaoInfo.nome : 'Cartão';
  const [vAno, vMes, vDia] = grupo.dataVencimento.split('-');
  const titulo = document.querySelector('#tituloModalGrupoCartao span');
  if (titulo) titulo.innerText = nomeCartao;
  document.getElementById('subtituloModalGrupoCartao').innerHTML =
    `Vence ${vDia}/${vMes}/${vAno} • ${grupo.itens.length} ${grupo.itens.length === 1 ? 'lançamento' : 'lançamentos'} • <strong style="color:var(--cor-texto-principal);">${formatarMoeda(grupo.total)}</strong>`;
  const corpo = document.getElementById('conteudoModalGrupoCartao');
  corpo.innerHTML = grupo.itens
    .map((it) => {
      const obsHint = it.obs
        ? `<div style="font-size:11px;color:var(--cor-texto-mutado);font-style:italic;margin-top:3px;">${it.obs}</div>`
        : '';
      return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 4px;border-bottom:1px dashed var(--cor-borda);">
            <div style="min-width:0;flex:1;">
                <div style="font-size:13px;color:var(--cor-texto-principal);font-weight:500;">${it.descricao}</div>
                ${obsHint}
            </div>
            <div style="font-size:13px;font-weight:600;font-family:'DM Mono',monospace;color:var(--cor-texto-principal);white-space:nowrap;">${formatarMoeda(it.valor)}</div>
        </div>`;
    })
    .join('');
  const btnBaixar = document.getElementById('btnBaixarModalGrupoCartao');
  btnBaixar.onclick = () => {
    fecharModalGrupoCartao();
    baixarGrupoCartao(key);
  };
  document.getElementById('modalGrupoCartao').style.display = 'flex';
}

function fecharModalGrupoCartao() {
  document.getElementById('modalGrupoCartao').style.display = 'none';
}

function baixarGrupoCartao(key) {
  const grupo = window._gruposCartaoVenc && window._gruposCartaoVenc[key];
  if (!grupo) return mostrarToast('Grupo não encontrado.', 'erro');
  const total = grupo.total;
  const qtd = grupo.itens.length;

  const modal = document.getElementById('modalConfirmacao');
  const titulo = document.getElementById('modalTitulo');
  const msg = document.getElementById('modalMensagem');
  const acoes = document.getElementById('modalAcoes');

  titulo.innerHTML = `<i class="ph-bold ph-credit-card" style="color:var(--cor-cartao);"></i> Baixar Cartão`;
  msg.innerHTML = `Tem certeza de que deseja baixar <strong>${qtd} ${qtd === 1 ? 'lançamento' : 'lançamentos'}</strong> do cartão no valor total de <strong>${formatarMoeda(total)}</strong> como pago?`;

  acoes.innerHTML = `
        <button class="btn-acao" style="background-color: var(--cor-primaria);" onclick="confirmarBaixarGrupoCartao('${key}')"><i class="ph-bold ph-check"></i> Sim, baixar fatura</button>
    `;

  modal.style.display = 'flex';
}

function confirmarBaixarGrupoCartao(key) {
  const grupo = window._gruposCartaoVenc && window._gruposCartaoVenc[key];
  if (!grupo) return;
  const ids = new Set(grupo.itens.map((i) => i.id));
  // Fase 3: a baixa debita a CONTA PAGADORA do cartão (carimba contaId nas
  // parcelas pagas). Sem conta pagadora definida, mantém o contaId existente.
  const cartao = typeof obterCartao === 'function' ? obterCartao(grupo.cartaoId) : null;
  const contaPag = cartao && cartao.contaPagadoraId ? cartao.contaPagadoraId : undefined;
  transacoes = transacoes.map((t) =>
    ids.has(t.id)
      ? { ...t, pago: true, pagoEm: new Date().toISOString(), contaId: contaPag || t.contaId }
      : t
  );
  salvarTransacoes();
  mostrarToast('Fatura baixada como paga.', 'sucesso');
  fecharModal();
  atualizarTelaControle();
}

function prepararPagamento(id, contexto) {
  const t = transacoes.find((t) => t.id === id);
  if (!t) return;
  const container = document.getElementById(`acao-pagar-${contexto}-${id}`);
  if (container) {
    container.innerHTML = `
            <div style="display: flex; gap: 5px; align-items: center; background: white; padding: 4px; border-radius: 6px; border: 1px solid var(--cor-primaria);">
                <span style="font-size: 11px; font-weight:600; color:var(--cor-texto-secundario);">R$</span>
                <input type="text" inputmode="decimal" id="input-pago-${id}" value="${formatarBRLInput(t.valor)}" oninput="aplicarMascaraBRL(this)" style="width: 90px; padding: 4px; border: 1px solid var(--cor-borda); border-radius: 4px; font-size: 13px; outline:none; color: var(--cor-texto-principal); font-weight: 600; text-align: right;">
                <button onclick="confirmarPagamento('${id}')" style="background: var(--cor-primaria); color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer; display:flex; align-items:center; gap:4px;"><i class="ph-bold ph-check"></i></button>
                <button onclick="atualizarTelaControle()" style="background: #e2e8f0; color: var(--cor-texto-secundario); border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer;"><i class="ph-bold ph-x"></i></button>
            </div>
        `;
  }
}

function confirmarPagamento(id) {
  const inputVal = document.getElementById(`input-pago-${id}`).value;
  const novoValor = parseBRL(inputVal);
  if (isNaN(novoValor) || novoValor < 0)
    return mostrarToast('Por favor, informe um valor válido.', 'erro');

  let txPaga = null;
  transacoes = transacoes.map((t) => {
    if (t.id === id) {
      t.pago = true;
      t.pagoEm = new Date().toISOString(); // pagamento explícito — protege da normalização
      if (t.valor !== novoValor) {
        t.valor = novoValor;
        if (t.groupId) t.groupId = null; // Isola o registro
      }
      // Fase 3: baixa de cartão debita a conta pagadora do cartão.
      if (t.categoria === 'cartao_credito' && t.cartaoId && typeof obterCartao === 'function') {
        const card = obterCartao(t.cartaoId);
        if (card && card.contaPagadoraId) t.contaId = card.contaPagadoraId;
      }
      txPaga = t;
    }
    return t;
  });
  salvarTransacoes();

  // Se for compromisso mensal de sonho, registrar como aporte e atualizar valorAtual
  let toastMsg = 'Pagamento confirmado!';
  if (txPaga && txPaga.categoria === 'sonho' && !txPaga.aporteExtra && txPaga.sonhoId) {
    registrarAportePorPagamentoSonho(txPaga);
    toastMsg = 'Pagamento confirmado e aporte registrado no sonho!';
  }
  // Compromisso de investimento (previdência/reserva): ao pagar, materializa a
  // posição em Patrimônio/Investimentos (aporte programado vira aporte realizado).
  if (
    txPaga &&
    txPaga.compromissoId &&
    typeof registrarAportePorPagamentoCompromisso === 'function' &&
    registrarAportePorPagamentoCompromisso(txPaga)
  ) {
    toastMsg = 'Aporte confirmado e somado ao seu patrimônio!';
  }

  mostrarToast(toastMsg, 'sucesso');
  atualizarTelaControle();
  if (typeof renderizarSonhos === 'function') renderizarSonhos();
}

// Pode reverter ("desfazer") o pagamento? Só lançamentos cujo pagamento apenas
// alterna o flag `pago` — despesa fixa/variável e cartão. Sonho e compromisso
// (previdência/reserva) geram aportes/posições vinculadas ao pagar; revertê-los
// aqui deixaria registros órfãos, então são tratados nas suas próprias abas.
function controlePodeReverterPagamento(t) {
  if (!t || !t.pago) return false;
  if (t.sonhoId || t.compromissoId) return false;
  return (
    t.categoria === 'despesa_fixa' ||
    t.categoria === 'despesa_variavel' ||
    t.categoria === 'cartao_credito'
  );
}

// Desfaz um pagamento marcado por engano: volta o lançamento para "a pagar"
// (pago:false), removendo-o do caixa do Meu Patrimônio. Reversível pelo botão
// de pagar normal.
function reverterPagamento(id) {
  const t = transacoes.find((x) => x.id === id);
  if (!t || !t.pago) return;
  if (!controlePodeReverterPagamento(t)) {
    return mostrarToast(
      'Este pagamento gerou um aporte vinculado — reverta pela aba correspondente.',
      'erro'
    );
  }
  t.pago = false;
  delete t.pagoEm; // deixa de ser pagamento explícito
  salvarTransacoes({ flush: true });
  mostrarToast('Pagamento desfeito — voltou para "a pagar".', 'sucesso');
  atualizarTelaControle();
}

// Liga um pagamento de compromisso mensal a um aporte registrado no sonho
function registrarAportePorPagamentoSonho(tx) {
  const s = sonhos.find((x) => x.id === tx.sonhoId);
  if (!s) return;
  // Evita duplicar se já houver aporte vinculado a esta tx
  if ((s.aportes || []).some((a) => a.txId === tx.id)) return;

  const dataAporte = new Date().toISOString().slice(0, 10);
  const novoAporte = {
    id: 'aporte_pago_' + Date.now(),
    valor: tx.valor,
    data: dataAporte,
    tipo: 'mensal_pago',
    origem: 'compromisso',
    txId: tx.id,
  };
  if (!s.aportes) s.aportes = [];
  s.aportes.push(novoAporte);
  s.valorAtual = (s.valorAtual || 0) + tx.valor;

  // Recalcula a parcela mensal e regenera lançamentos futuros
  if (s.planoVinculado && s.valorAtual < s.valorTotal) {
    const novoMensal = calcSonhoMensal(
      s.valorTotal,
      s.valorAtual,
      s.mesesRestantes || s.prazoMeses
    );
    removerLancamentosFuturosSonho(s.id);
    gerarLancamentosMensaisSonho(s, novoMensal, Math.min(60, s.mesesRestantes || s.prazoMeses));
    s.aporteMensalPlano = novoMensal;
  }
  salvarSonhos();
}

function atualizarTermometro60() {
  try {
    const painel = document.getElementById('painelTermometro');
    if (!painel) return;

    const badge = document.getElementById('badgeStatus60');
    const barra = document.getElementById('barTermometro60');
    const msg = document.getElementById('msgContextual60');
    const lblGasto = document.getElementById('lblGasto60');
    const lblReceita = document.getElementById('lblReceita60');
    const lblPerc = document.getElementById('lblPerc60');

    let resumo = calcularResumoMes(visaoMes, visaoAno);
    let totalReceita = resumo.receita;
    let totalDespesa = resumo.despFixa + resumo.despVar + resumo.cartao;
    let limite60 = totalReceita * 0.6;

    lblGasto.innerText = formatarMoeda(totalDespesa);
    lblReceita.innerText = formatarMoeda(limite60);

    if (totalReceita === 0) {
      barra.style.width = '0%';
      barra.style.background = 'var(--cor-texto-mutado)';
      badge.className = 'badge badge-status-warn';
      badge.innerText = 'Sem dados';
      msg.innerText = 'Adicione receitas para calcular seu limite de segurança.';
      msg.style.color = 'var(--cor-texto-mutado)';
      lblPerc.innerText = '0';
      return;
    }

    let percentualGasto = (totalDespesa / totalReceita) * 100;
    lblPerc.innerText = percentualGasto.toFixed(1);
    barra.style.width = Math.min(percentualGasto, 100) + '%';

    if (percentualGasto <= 50) {
      barra.style.background = 'var(--cor-primaria)';
      badge.className = 'badge badge-status-ok';
      badge.innerText = 'Dentro do limite';
      msg.innerHTML = '<i class="ph-fill ph-check-circle"></i> Seus gastos estão sob controle.';
      msg.style.color = 'var(--cor-txt-primaria)';
    } else if (percentualGasto <= 60) {
      barra.style.background = 'var(--cor-cartao)';
      badge.className = 'badge badge-status-warn';
      badge.innerText = 'Atenção';
      msg.innerHTML = '<i class="ph ph-warning"></i> Gastos próximos do limite de segurança.';
      msg.style.color = 'var(--cor-txt-amber)';
    } else {
      barra.style.background = 'var(--cor-erro)';
      badge.className = 'badge badge-status-danger';
      badge.innerText = 'Limite ultrapassado';
      msg.innerHTML =
        '<i class="ph-fill ph-warning-circle"></i> Você ultrapassou o limite de segurança de 60%.';
      msg.style.color = 'var(--cor-txt-erro)';
    }
  } catch (erro) {
    console.error('Appliquei - Erro não-crítico ao atualizar o termômetro:', erro);
  }
}

// ============================================================
// --- Termômetro do mês no cabeçalho ---
// ============================================================

// Ângulo da agulha e comprimento do arco preenchido para um score 0-100.
// Pura e exportada: é a única aritmética do chip, e é a mesma conta que
// rmAtualizarGauge faz no gauge grande — só com o arco de outro raio.
// (Semicírculo de raio 19 → π·19 ≈ 59,7; o dasharray do SVG é 60.)
function termChipGeometria(score, comprimentoArco) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const arco = Number(comprimentoArco) || 60;
  return { angulo: -90 + (s / 100) * 180, offset: arco - arco * (s / 100) };
}

// O score vem de rmCalcularTermometro(buildMonthlyReport(...)) — exatamente as
// funções que o Relatório mensal usa. Recalcular por conta própria aqui faria
// o chip e o relatório discordarem no dia em que a régua dos 5 critérios
// mudasse, e o chip é justamente o convite para abrir o relatório.
function atualizarTermometroControle(mes, ano) {
  const chip = document.getElementById('termometroControle');
  if (!chip) return;
  try {
    if (typeof buildMonthlyReport !== 'function' || typeof rmCalcularTermometro !== 'function') {
      chip.style.display = 'none';
      return;
    }
    chip.style.display = '';
    const yyyymm = ano + '-' + String(mes + 1).padStart(2, '0');
    const rep = buildMonthlyReport(yyyymm);
    const elScore = document.getElementById('termChipScore');
    const elRotulo = document.getElementById('termChipRotulo');
    const arco = document.getElementById('termChipArco');
    const ponteiro = document.getElementById('termChipPonteiro');

    // Mês sem nada lançado: o score seria 40 ("Atenção") só porque quatro dos
    // cinco critérios são neutros — um diagnóstico sobre dado nenhum.
    if (!rep.hasData) {
      chip.setAttribute('data-faixa', 'vazio');
      const g = termChipGeometria(0);
      if (arco) arco.setAttribute('stroke-dashoffset', String(g.offset));
      if (ponteiro) ponteiro.setAttribute('transform', 'rotate(' + g.angulo + ' 24 24)');
      if (elScore) elScore.textContent = '';
      if (elRotulo) elRotulo.textContent = 'Sem lançamentos';
      chip.title = 'Lance receitas e despesas deste mês para ver o termômetro';
      return;
    }

    const t = rmCalcularTermometro(rep);
    const g = termChipGeometria(t.score);
    chip.setAttribute('data-faixa', t.statusGeral);
    if (arco) arco.setAttribute('stroke-dashoffset', String(g.offset));
    if (ponteiro) ponteiro.setAttribute('transform', 'rotate(' + g.angulo + ' 24 24)');
    if (elScore) elScore.textContent = t.score;
    if (elRotulo) elRotulo.textContent = t.faixa ? t.faixa.rotulo : '';
    chip.title =
      'Termômetro de ' +
      (typeof rmFormatarMesLabel === 'function' ? rmFormatarMesLabel(yyyymm) : yyyymm) +
      ': ' +
      t.score +
      '/100. Clique para ver o Relatório mensal completo.';
  } catch (erro) {
    console.error('Appliquei - Erro não-crítico ao atualizar o termômetro do mês:', erro);
  }
}

// Abre o Relatório mensal já no mês que o Controle está exibindo. Vai pelo
// botão da barra lateral (e não por mudarAba direto) porque mudarAba usa
// e.currentTarget para marcar o item ativo do menu — mesmo caminho de
// ppNavegarPara.
function abrirRelatorioDoMesVisao() {
  const seletor = document.getElementById('rmSeletorMes');
  if (seletor) seletor.value = visaoAno + '-' + String(visaoMes + 1).padStart(2, '0');
  if (typeof ppNavegarPara === 'function' && ppNavegarPara('relatorio_mensal')) return;
  const botoes = document.querySelectorAll('.menu-btn');
  for (let i = 0; i < botoes.length; i++) {
    if ((botoes[i].getAttribute('onclick') || '').indexOf("'relatorio_mensal'") !== -1) {
      botoes[i].click();
      return;
    }
  }
}

// Estado do alerta de cartão (pura/testável). Recebe o total da fatura do mês e
// a lista de cartões ATIVOS (arquivados não entram, p/ não inflar o limite e
// mascarar o estouro). Devolve o limite somado, o % usado e, se estourou, quanto
// passou — em R$ e em %.
function calcularEstadoAlertaCartao(totCartao, cartoesAtivosLista) {
  const limite = (cartoesAtivosLista || []).reduce(
    (sum, c) => sum + (Number(c && c.limite) || 0),
    0
  );
  const total = Number(totCartao) || 0;
  if (limite <= 0) {
    return { limite: 0, perc: 0, estourou: false, extrapolouReais: 0, extrapolouPerc: 0 };
  }
  const perc = (total / limite) * 100;
  const estourou = perc > 100;
  return {
    limite,
    perc,
    estourou,
    extrapolouReais: estourou ? total - limite : 0,
    extrapolouPerc: estourou ? ((total - limite) / limite) * 100 : 0,
  };
}

function atualizarTelaControle() {
  // O histórico de preços da renda variável NÃO é mais usado nesta tela — a
  // linha "Rendimento acumulado" saiu da DRE. A carga continua aqui porque
  // este é o ÚNICO ponto do app que a dispara, e quem consome o histórico é o
  // gráfico de evolução de Meus investimentos (rendPrecoEm, em
  // appliquei-aba1-charts.js): sem ele, a posição de março volta a ser valorada
  // pela cotação de hoje e a barra nasce com o ganho do período embutido.
  // Pedir daqui em vez de no boot cobre quem registra o primeiro investimento
  // com o app já aberto; a função é idempotente e só vai à rede uma vez por
  // ticker, por sessão.
  //
  // O re-render em rendAoAtualizar saiu junto com a linha: não há mais nada no
  // Controle que dependa do histórico, e redesenhar a tela inteira quando ele
  // chega deixou de ter função.
  if (typeof rendCarregarHistorico === 'function') rendCarregarHistorico();
  // Garante que despesas variáveis com vencimento futuro não fiquem "pagas"
  // (cobre edição de data e qualquer caminho, além do carregamento inicial).
  normalizarDespesasProgramadas();
  const mesFormatado = (visaoMes + 1).toString().padStart(2, '0');
  document.getElementById('inputMesAnoVisao').value = `${visaoAno}-${mesFormatado}`;
  const nomeMeses = [
    'Jan',
    'Fev',
    'Mar',
    'Abr',
    'Mai',
    'Jun',
    'Jul',
    'Ago',
    'Set',
    'Out',
    'Nov',
    'Dez',
  ];
  document.getElementById('lblMesExtrato').innerText = `(${nomeMeses[visaoMes]} ${visaoAno})`;
  atualizarBannerSaldoMesAnterior(visaoMes, visaoAno);
  // O termômetro acompanha o mês em exibição, e não o mês corrente: navegar
  // para agosto e continuar vendo o score de setembro seria mentira.
  atualizarTermometroControle(visaoMes, visaoAno);

  const listaExtrato = document.getElementById('extratoUnificado');
  let htmlExtrato = '';

  const theadDRE = document.getElementById('cabecalhoDRE');
  const tbodyDRE = document.getElementById('corpoTabelaDRE');

  // AGENDA E ALERTA DE VENCIMENTOS
  const painelVenc = document.getElementById('painelVencimentos');
  const containerVenc = document.getElementById('listaVencimentosContainer');
  const bannerAlertaHoje = document.getElementById('alertaVencimentoHoje');
  const bannerAlertaAtraso = document.getElementById('alertaContaVencida');

  containerVenc.innerHTML = '';
  let qtdVencimentos = 0,
    temVencimentoHoje = false,
    temContaVencida = false;

  const hojeObj = new Date();
  const hojeStr = `${hojeObj.getFullYear()}-${String(hojeObj.getMonth() + 1).padStart(2, '0')}-${String(hojeObj.getDate()).padStart(2, '0')}`;

  // Filtro robusto: usa o mês/ano efetivo de dataVencimento (não a competência)
  const mesVisaoStr = `${visaoAno}-${String(visaoMes + 1).padStart(2, '0')}`;
  let contasComVencimento = transacoes.filter((t) => {
    if (!t.dataVencimento || t.pago) return false;
    // Receitas e resgates são entradas — não devem aparecer como "conta a vencer"
    if (t.categoria === 'receita' || t.categoria === 'resgate_investimento') return false;
    return t.dataVencimento.startsWith(mesVisaoStr);
  });
  // Ordena por string YYYY-MM-DD (sem timezone) — sempre ascendente
  contasComVencimento.sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento));

  // Separa cartão de crédito do restante e agrupa por (cartaoId + dataVencimento)
  const naoCartao = contasComVencimento.filter((t) => t.categoria !== 'cartao_credito');
  const cartao = contasComVencimento.filter((t) => t.categoria === 'cartao_credito');
  const grupos = {};
  cartao.forEach((t) => {
    const key = `${t.cartaoId || 'sem'}__${t.dataVencimento}`;
    if (!grupos[key])
      grupos[key] = { cartaoId: t.cartaoId, dataVencimento: t.dataVencimento, itens: [], total: 0 };
    grupos[key].itens.push(t);
    grupos[key].total += t.valor;
  });

  // Combina não-cartão e grupos consolidados, ordenados por dataVencimento
  const itensRender = [
    ...naoCartao.map((t) => ({ tipo: 'individual', dataVencimento: t.dataVencimento, conta: t })),
    ...Object.values(grupos).map((g) => ({
      tipo: 'cartao',
      dataVencimento: g.dataVencimento,
      grupo: g,
    })),
  ];
  itensRender.sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento));

  const renderEstadoVenc = (dataVencimento) => {
    let corBorda = 'var(--cor-borda)',
      corTextoData = 'var(--cor-texto-secundario)',
      badgeAtraso = '';
    if (dataVencimento === hojeStr) {
      corBorda = 'var(--cor-erro)';
      corTextoData = 'var(--cor-erro)';
      temVencimentoHoje = true;
    } else if (dataVencimento < hojeStr) {
      corBorda = 'var(--cor-erro)';
      corTextoData = 'var(--cor-erro)';
      temContaVencida = true;
      badgeAtraso = ` <span style="background: var(--cor-erro); color: white; padding: 1px 5px; border-radius: 4px; font-size: 9px; margin-left: 4px; font-weight:700;">ATRASADO</span>`;
    }
    return { corBorda, corTextoData, badgeAtraso };
  };

  itensRender.forEach((item) => {
    const [vAno, vMes, vDia] = item.dataVencimento.split('-');
    const { corBorda, corTextoData, badgeAtraso } = renderEstadoVenc(item.dataVencimento);

    if (item.tipo === 'individual') {
      const conta = item.conta;
      const obsIcone = conta.obs
        ? ` <i class="ph ph-note-pencil" title="${conta.obs.replace(/"/g, '&quot;')}" style="color:var(--cor-info);font-size:11px;cursor:help;"></i>`
        : '';
      containerVenc.innerHTML += `
                <div class="venc-card" style="border-color:${corBorda}">
                    <div class="venc-day" style="color:${corTextoData}">${vDia}</div>
                    <div style="flex:1;min-width:0;">
                        <div class="venc-name" title="${String(conta.descricao || '').replace(/"/g, '&quot;')}">${conta.descricao}${obsIcone}${badgeAtraso}</div>
                        <div class="venc-val">${formatarMoeda(conta.valor)}</div>
                    </div>
                    <div class="venc-badge" id="acao-pagar-card-${conta.id}">
                        <button onclick="prepararPagamento('${conta.id}', 'card')" class="btn-secundario" style="padding:5px 10px;font-size:11px;border-color:var(--cor-primaria);color:var(--cor-primaria);">
                            <i class="ph-bold ph-check"></i> Baixar
                        </button>
                    </div>
                </div>`;
      qtdVencimentos++;
    } else {
      const g = item.grupo;
      const cartaoInfo = obterCartao(g.cartaoId);
      const nomeCartao = cartaoInfo ? cartaoInfo.nome : 'Cartão';
      const grupoKey = `${g.cartaoId || 'sem'}_${g.dataVencimento}`;
      const qtdLanc = g.itens.length;
      containerVenc.innerHTML += `
                <div class="venc-card venc-card-grupo" style="border-color:${corBorda};border-left:4px solid var(--cor-cartao);cursor:pointer;" onclick="abrirModalGrupoCartao('${grupoKey}')">
                    <div class="venc-day" style="color:${corTextoData}">${vDia}</div>
                    <div style="flex:1;min-width:0;">
                        <div class="venc-name"><i class="ph-fill ph-credit-card" style="color:var(--cor-cartao);font-size:11px;"></i> ${nomeCartao}${badgeAtraso}</div>
                        <div class="venc-val">${formatarMoeda(g.total)}<span class="venc-meta">${qtdLanc} ${qtdLanc === 1 ? 'lançamento' : 'lançamentos'}</span></div>
                    </div>
                    <div class="venc-badge">
                        <button onclick="event.stopPropagation(); baixarGrupoCartao('${grupoKey}')" class="btn-secundario" style="padding:4px 8px;font-size:10.5px;border-color:var(--cor-primaria);color:var(--cor-primaria);">
                            <i class="ph-bold ph-check"></i> Baixar
                        </button>
                    </div>
                </div>`;
      qtdVencimentos++;
    }
  });

  // Guarda mapa de grupos para uso nas funções de toggle/baixar
  window._gruposCartaoVenc = {};
  Object.entries(grupos).forEach(([k, g]) => {
    window._gruposCartaoVenc[`${g.cartaoId || 'sem'}_${g.dataVencimento}`] = g;
  });

  painelVenc.style.display = qtdVencimentos > 0 ? 'block' : 'none';
  if (bannerAlertaHoje) bannerAlertaHoje.style.display = temVencimentoHoje ? 'flex' : 'none';
  if (bannerAlertaAtraso) bannerAlertaAtraso.style.display = temContaVencida ? 'flex' : 'none';

  // Sonho tem totalizador PRÓPRIO. Guardar o aporte de uma meta junto das
  // despesas dizia que poupar é gastar: a pessoa via "Total de despesas" subir
  // no mês em que se comportou melhor. O dinheiro sai do caixa igual — por isso
  // continua sendo subtraído do saldo livre, logo abaixo —, mas sai para ela
  // mesma, e o número que responde "quanto consumi" não pode contar isso.
  let totRec = 0,
    totDesp = 0,
    totCartao = 0,
    totInv = 0,
    totSonho = 0;
  const nomesCat = {
    receita: 'Receita',
    dividendo: 'Dividendo',
    resgate_investimento: 'Resgate',
    despesa_fixa: 'Desp. Fixa',
    despesa_variavel: 'Desp. Variável',
    cartao_credito: 'C. Crédito',
    investimento_fixo: 'Inv. Fixo',
    investimento_variavel: 'Inv. Variável',
    sonho: '⭐ Sonho',
  };

  // Do maior para o menor. O extrato saía na ordem de cadastro, que não diz
  // nada: quem abre o mês quer ver primeiro o que pesou. O desempate pela data
  // mantém a lista estável entre renders quando dois lançamentos empatam.
  const doMes = transacoes
    .filter((t) => t.mes === visaoMes && t.ano === visaoAno)
    .slice()
    .sort(
      (a, b) => (b.valor || 0) - (a.valor || 0) || String(a.data).localeCompare(String(b.data))
    );

  // Categorias presentes no mês, para os chips do sub-filtro.
  const catsDoMes = new Map();

  doMes.forEach((t) => {
    {
      // Fase 3B: as pernas de transferência (origem do aporte) são plumbing de
      // caixa — aparecem no Meu Patrimônio (por instituição), não no extrato/DRE
      // mensal. Sem isto, o aporte apareceria 2x (ativo + perna) e dobraria o KPI.
      if (t.categoria === 'transferencia_saida' || t.categoria === 'transferencia_entrada') return;
      let iconFixo =
        t.groupId && t.categoria !== 'cartao_credito'
          ? ' <i class="ph ph-arrows-clockwise" title="Recorrente"></i>'
          : '';
      let iconFixoCartao = t.cartaoFixoMensal
        ? ' <i class="ph ph-repeat" title="Fixo mensal no cartão" style="color:var(--cor-cartao);"></i>'
        : '';
      let iconObs = t.obs
        ? ` <i class="ph ph-note-pencil" title="${t.obs.replace(/"/g, '&quot;')}" style="color:var(--cor-info);cursor:help;"></i>`
        : '';
      let vencimentoHtml = '';
      if (t.dataVencimento) {
        let [vAno, vMes, vDia] = t.dataVencimento.split('-');
        if (t.pago) {
          vencimentoHtml = ` <span style="color: var(--cor-primaria); font-size: 10px; margin-left: 5px; font-weight: 600;"><i class="ph-bold ph-check"></i> Pago</span>`;
        } else if (t.dataVencimento === hojeStr) {
          vencimentoHtml = ` <span style="color: var(--cor-erro); font-weight: 700; background: var(--cor-bg-erro); padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 5px;"><i class="ph-fill ph-warning-circle"></i> HOJE</span>`;
        } else if (t.dataVencimento < hojeStr) {
          vencimentoHtml = ` <span style="color: var(--cor-erro); font-size: 10px; margin-left: 5px; font-weight: 600;"><i class="ph-bold ph-warning"></i> Atrasado</span>`;
        } else {
          vencimentoHtml = ` <span style="color: #94a3b8; font-size: 10px; margin-left: 5px;">• Vence: ${vDia}/${vMes}</span>`;
        }
      }

      let nomeCartaoExtrato = '';
      if (t.categoria === 'cartao_credito' && t.cartaoId) {
        const c = obterCartao(t.cartaoId);
        if (c) nomeCartaoExtrato = ` • ${c.nome}`;
      }
      const catDespExtrato = t.categoriaDespesa
        ? ` <span style="font-size:10.5px;background:var(--cor-superficie);border:1px solid var(--cor-borda);border-radius:6px;padding:1px 6px;color:var(--cor-texto-secundario);">${rotuloCategoriaDespesa(t.categoriaDespesa)}</span>`
        : '';
      // A categoria do sub-filtro: para despesa é a categoria de gasto que o
      // usuário escolheu; para o resto (receita, dividendo, aporte) o próprio
      // tipo já é a melhor etiqueta que existe.
      const catFiltro = t.categoriaDespesa || 'tipo:' + t.categoria;
      const catRotulo = t.categoriaDespesa
        ? rotuloCategoriaDespesa(t.categoriaDespesa)
        : nomesCat[t.categoria] || 'Outros';
      const acc = catsDoMes.get(catFiltro) || { rotulo: catRotulo, total: 0, qtd: 0 };
      acc.total += t.valor || 0;
      acc.qtd++;
      catsDoMes.set(catFiltro, acc);

      // O tipo classifica o item para as abas do topo (Entradas / Saídas /
      // Cartão / Investimentos), que antes escondiam a caixa inteira.
      const tipoFiltro =
        t.categoria === 'receita' ||
        t.categoria === 'dividendo' ||
        t.categoria === 'resgate_investimento'
          ? 'receita'
          : t.categoria === 'despesa_fixa' || t.categoria === 'despesa_variavel'
            ? 'despesa'
            : t.categoria === 'cartao_credito'
              ? 'cartao'
              : t.categoria === 'sonho'
                ? 'sonho'
                : 'investimento';

      let itemHtml = `
            <div class="extrato-item" data-ext-tipo="${tipoFiltro}" data-ext-cat="${catFiltro.replace(/"/g, '&quot;')}" data-ext-desc="${(typeof insightsNormalizarDescricao === 'function' ? insightsNormalizarDescricao(t.descricao) : '').replace(/"/g, '&quot;')}">
                <div>
                    <span class="desc">${t.descricao}${iconFixo}${iconFixoCartao}${iconObs}</span>
                    <span class="cat">${nomesCat[t.categoria] || 'Outros'}${nomeCartaoExtrato}${catDespExtrato}${vencimentoHtml}</span>
                </div>
                <div style="text-align: right;">
                    <span class="valor">${formatarMoeda(t.valor)}</span>
                    <div style="margin-top: 4px; display: flex; justify-content: flex-end; align-items: center; gap: 8px;" id="acao-pagar-list-${t.id}">
                        ${!t.pago && t.categoria !== 'receita' ? `<button onclick="prepararPagamento('${t.id}', 'list')" style="background:none; border:none; cursor:pointer; color:var(--cor-primaria); font-size:16px;" title="Registrar Pagamento"><i class="ph-bold ph-check-circle"></i></button>` : ''}
                        ${controlePodeReverterPagamento(t) ? `<button onclick="reverterPagamento('${t.id}')" style="background:none; border:none; cursor:pointer; color:var(--cor-texto-mutado); font-size:15px;" title="Desfazer pagamento (voltar para a pagar)"><i class="ph ph-arrow-counter-clockwise"></i></button>` : ''}
                        <button onclick="prepararEdicao('${t.id}')" style="background:none; border:none; cursor:pointer; color:var(--cor-info); font-size:15px;" title="Editar"><i class="ph ph-pencil-simple"></i></button>
                        <button onclick="deletarTransacao('${t.id}')" style="background:none; border:none; cursor:pointer; color:var(--cor-erro); font-size:15px;" title="Excluir"><i class="ph ph-trash"></i></button>
                    </div>
                </div>
            </div>`;

      if (tipoFiltro === 'receita') totRec += t.valor;
      else if (tipoFiltro === 'despesa') totDesp += t.valor;
      else if (tipoFiltro === 'cartao') totCartao += t.valor;
      else if (tipoFiltro === 'sonho') totSonho += t.valor;
      else totInv += t.valor;
      htmlExtrato += itemHtml;
    }
  });

  listaExtrato.innerHTML = htmlExtrato;
  renderizarChipsCategoriaExtrato(catsDoMes);
  aplicarFiltrosExtrato();

  document.getElementById('totalColReceitas').innerText = formatarMoeda(totRec);
  document.getElementById('totalColDespesas').innerText = formatarMoeda(totDesp);
  document.getElementById('totalColCartao').innerText = formatarMoeda(totCartao);
  document.getElementById('totalColInv').innerText = formatarMoeda(totInv);
  const colSonho = document.getElementById('totalColSonhos');
  if (colSonho) colSonho.innerText = formatarMoeda(totSonho);

  // KPI cards do topo — investimentos/cartão/despesa têm cards próprios e
  // todos são deduzidos da receita para compor o saldo livre.
  const kpiRec = document.getElementById('kpiReceitaMes');
  const kpiDesp = document.getElementById('kpiDespesasMes');
  const kpiCart = document.getElementById('kpiCartaoMes');
  const kpiInv = document.getElementById('kpiInvestimentosMes');
  const kpiSonho = document.getElementById('kpiSonhosMes');
  const kpiSaldo = document.getElementById('kpiSaldoLivre');
  const lblCarregado = document.getElementById('lblSaldoCarregado');
  const saldoCarregado = obterSaldoCarregadoParaMes(visaoMes, visaoAno);
  if (kpiRec) kpiRec.innerText = formatarMoeda(totRec);
  if (kpiDesp) kpiDesp.innerText = formatarMoeda(totDesp);
  if (kpiCart) kpiCart.innerText = formatarMoeda(totCartao);
  if (kpiInv) kpiInv.innerText = formatarMoeda(totInv);
  if (kpiSonho) kpiSonho.innerText = formatarMoeda(totSonho);
  if (kpiSaldo) {
    // `- totSonho` explícito: ele saiu de totDesp e sem esta parcela o saldo
    // livre subiria pelo valor guardado no mês — o app diria que sobrou o que
    // já foi reservado para a meta.
    const saldo = totRec - totDesp - totCartao - totInv - totSonho + saldoCarregado;
    kpiSaldo.innerText = formatarMoeda(saldo);
    kpiSaldo.style.color = saldo >= 0 ? 'var(--cor-primaria)' : 'var(--cor-erro)';
  }
  if (lblCarregado) {
    if (saldoCarregado !== 0) {
      const sinal = saldoCarregado > 0 ? '+' : '';
      lblCarregado.style.display = 'inline';
      lblCarregado.innerText = `(${sinal}${formatarMoeda(saldoCarregado)} do mês anterior)`;
    } else {
      lblCarregado.style.display = 'none';
    }
  }
  atualizarKpiSaldoEmConta(visaoMes, visaoAno);

  // ALERTA CARTÃO — usa só cartões ATIVOS. Cartões arquivados (ex.: o "Cartão
  // principal" de 5.000 criado na migração) não devem inflar o limite e mascarar
  // o estouro da fatura.
  const estadoCartao = calcularEstadoAlertaCartao(totCartao, cartoesAtivos());
  const alertaCartao = document.getElementById('alertaCartaoKanban');
  const barCartao = document.getElementById('barCartao');

  if (estadoCartao.limite > 0) {
    if (barCartao) barCartao.style.width = Math.min(100, estadoCartao.perc) + '%';
    if (estadoCartao.estourou) {
      if (barCartao) barCartao.style.background = 'var(--cor-erro)';
      const txtAlerta = document.getElementById('txtAlertaCartao');
      if (txtAlerta)
        txtAlerta.innerHTML = `Fatura estourou em ${estadoCartao.extrapolouPerc.toFixed(1)}% — passou ${formatarMoeda(estadoCartao.extrapolouReais)} do limite.`;
      if (alertaCartao) alertaCartao.style.display = 'flex';
    } else {
      if (barCartao) barCartao.style.background = 'var(--cor-cartao)';
      if (alertaCartao) alertaCartao.style.display = 'none';
    }
  } else {
    if (barCartao) barCartao.style.width = '0%';
    if (alertaCartao) alertaCartao.style.display = 'none';
  }

  // GRÁFICO BARRAS
  let rPizza = calcularResumoMes(visaoMes, visaoAno);
  if (chartComposicao) chartComposicao.destroy();
  let vSobra =
    rPizza.receita +
    rPizza.resgate -
    rPizza.cartao -
    rPizza.despFixa -
    rPizza.despVar -
    (rPizza.invFixo + rPizza.invVar) -
    rPizza.sonho;
  let somaParaGrafico =
    rPizza.receita +
    rPizza.resgate +
    rPizza.cartao +
    rPizza.despFixa +
    rPizza.despVar +
    rPizza.invFixo +
    rPizza.invVar +
    rPizza.sonho;

  if (somaParaGrafico > 0) {
    document.getElementById('legendaPizzaVazia').style.display = 'none';
    const ctx = document.getElementById('graficoComposicao').getContext('2d');
    let dadosGrafico;
    if (agrupamentoComposicao === 'despesa') {
      // Despesas quebradas por categoria de despesa, ordenadas da maior p/ menor.
      const mapaCat = calcularDespesasPorCategoria(visaoMes, visaoAno);
      let despesas = Object.keys(mapaCat).map((k) => ({
        label: k === '__sem_categoria__' ? 'Sem categoria' : rotuloCategoriaDespesa(k),
        valor: mapaCat[k],
      }));
      despesas.sort((a, b) => b.valor - a.valor);
      despesas.forEach((d, i) => {
        d.cor = PALETA_CATEGORIA_DESPESA[i % PALETA_CATEGORIA_DESPESA.length];
      });
      // Barras de referência: Receita (e Resgate, se houver) e Sobra.
      dadosGrafico = [{ label: 'Receita', valor: rPizza.receita, cor: '#10b981' }];
      if (rPizza.resgate > 0)
        dadosGrafico.push({ label: 'Resgate', valor: rPizza.resgate, cor: '#34d399' });
      dadosGrafico = dadosGrafico.concat(despesas);
      dadosGrafico.push({
        label: 'Sobra',
        valor: vSobra,
        cor: vSobra >= 0 ? '#10b981' : '#e11d48',
      });
    } else {
      dadosGrafico = [
        { label: 'Receita', valor: rPizza.receita, cor: '#10b981' },
        { label: 'Resgate', valor: rPizza.resgate, cor: '#34d399' },
        { label: 'Cartão', valor: rPizza.cartao, cor: '#f59e0b' },
        { label: 'Fixa', valor: rPizza.despFixa, cor: '#f97316' },
        { label: 'Var.', valor: rPizza.despVar, cor: '#e11d48' },
        { label: 'Aportes Mês', valor: rPizza.invFixo + rPizza.invVar, cor: '#2563eb' },
        { label: 'Sonhos', valor: rPizza.sonho, cor: '#7c3aed' },
      ];
      dadosGrafico.sort((a, b) => b.valor - a.valor);
      dadosGrafico.push({
        label: 'Sobra',
        valor: vSobra,
        cor: vSobra >= 0 ? '#10b981' : '#e11d48',
      });
    }

    // Altura adaptativa: a visão por categoria de despesa pode ter mais barras.
    const contGrafico = document.getElementById('graficoComposicao').parentElement;
    if (contGrafico) contGrafico.style.height = Math.max(180, dadosGrafico.length * 26) + 'px';

    // A folga da direita tem de caber o MAIOR rótulo, e o maior rótulo depende
    // do dinheiro de quem usa o app: "R$ 13.700,00" pede ~72px, e os 60px fixos
    // que estavam aqui cortavam o último dígito — o valor aparecia como
    // "R$ 13.700,0". Com sete dígitos ("R$ 1.234.567,89") faltariam ~50px.
    // Medir com a métrica do próprio canvas resolve para qualquer valor, em
    // qualquer fonte. measureText não depende da transformação do contexto,
    // então basta preservar a fonte anterior.
    ctx.save();
    ctx.font = 'bold 10px ' + ((Chart.defaults.font && Chart.defaults.font.family) || 'sans-serif');
    const larguraMaiorRotulo = dadosGrafico.reduce(
      (mx, d) => (d.valor === 0 ? mx : Math.max(mx, ctx.measureText(formatarMoeda(d.valor)).width)),
      0
    );
    ctx.restore();
    // + o offset do datalabel (4) + respiro para a borda do cartão.
    const folgaRotulos = Math.ceil(larguraMaiorRotulo) + 12;

    chartComposicao = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: dadosGrafico.map((d) => d.label),
        datasets: [
          {
            data: dadosGrafico.map((d) => d.valor),
            backgroundColor: dadosGrafico.map((d) => d.cor),
            borderRadius: 4,
          },
        ],
      },
      options: {
        layout: { padding: { right: folgaRotulos } },
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (context) {
                return ` Total: ${formatarMoeda(context.raw)}`;
              },
            },
          },
          datalabels: {
            color: '#0f172a',
            font: { weight: 'bold', size: 10 },
            anchor: 'end',
            align: 'right',
            offset: 4,
            formatter: (value) => {
              return value === 0 ? null : formatarMoeda(value);
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              callback: function (value) {
                return value >= 1e6
                  ? 'R$ ' + (value / 1e6).toFixed(1) + 'M'
                  : value >= 1e3
                    ? 'R$ ' + (value / 1e3).toFixed(0) + 'k'
                    : formatarMoeda(value);
              },
            },
          },
          y: { grid: { display: false } },
        },
      },
    });
  } else {
    document.getElementById('legendaPizzaVazia').style.display = 'block';
  }

  // DRE
  const metaVerde = parseBRL(document.getElementById('metaVerde').value) || 3000;
  const metaVermelha = parseBRL(document.getElementById('metaVermelha').value) || 1000;

  let inicioMes = visaoMes + offsetMesesDRE;
  let inicioAno = visaoAno;
  while (inicioMes < 0) {
    inicioMes += 12;
    inicioAno--;
  }
  while (inicioMes > 11) {
    inicioMes -= 12;
    inicioAno++;
  }
  const indiceMesAtual = -offsetMesesDRE;

  // Capital aplicado acumulado que já existia ANTES do primeiro mês da janela.
  // Sem isto o acumulado começaria do zero na borda esquerda da tabela e mentiria
  // para quem investe há anos: a DRE mostra 6 meses, não a vida toda.
  const aporteLiquidoAntesDaJanela = aporteLiquidoAcumuladoAte(inicioMes, inicioAno);

  // DRE mensal: o resultado de cada mês é carregado AUTOMATICAMENTE para o mês
  // seguinte (saldo acumulado / running balance). A linha "Saldo do mês anterior"
  // mostra o fechamento herdado; "Resultado do mês" já é o acumulado. Ajustes
  // manuais pontuais são possíveis (botão "Ajustar" no banner / lápis no DRE).
  let labelsMeses = [];
  let dreDados = [];
  for (let i = 0; i < qtdMesesDRE; i++) {
    let m = inicioMes + i;
    let a = inicioAno;
    while (m > 11) {
      m -= 12;
      a++;
    }
    let r = calcularResumoMes(m, a);
    let despesas = r.despFixa + r.despVar + r.cartao;
    const saldoCarregadoMes =
      typeof obterSaldoCarregadoParaMes === 'function' ? obterSaldoCarregadoParaMes(m, a) : 0;
    const resultadoMes =
      r.receita + r.resgate - despesas - (r.invFixo + r.invVar) - r.sonho + saldoCarregadoMes;
    dreDados.push({
      mes: m,
      ano: a,
      receita: r.receita,
      resgate: r.resgate,
      invFixo: r.invFixo,
      invVar: r.invVar,
      invExterno: r.invExterno || 0,
      sonho: r.sonho,
      despesas: despesas,
      saldoAcumulado: resultadoMes,
      saldoCarregado: saldoCarregadoMes,
    });
    labelsMeses.push(`${nomeMeses[m]}/${a.toString().slice(-2)}`);
  }

  let htmlThead = `<tr><th class="coluna-fixa" style="min-width: 190px;">Demonstrativo contábil</th>`;
  labelsMeses.forEach((lbl, index) => {
    htmlThead += `<th style="text-align: right; min-width: 120px; ${index === indiceMesAtual ? 'background-color: var(--cor-bg-info);' : ''}">${lbl}</th>`;
  });
  htmlThead += `</tr>`;
  theadDRE.innerHTML = htmlThead;

  let htmlLinhas = '';
  htmlLinhas += `<tr><td class="coluna-fixa" style="font-weight: 600; background: var(--cor-branco);">Receita Total</td>`;
  dreDados.forEach((d, i) => {
    htmlLinhas += `<td style="text-align: right; color: var(--tinta-verde); font-weight: 600; ${i === indiceMesAtual ? 'background-color: var(--dre-destaque);' : ''}">${formatarMoeda(d.receita)}</td>`;
  });
  htmlLinhas += `</tr>`;

  htmlLinhas += `<tr><td class="coluna-fixa" style="font-weight: 600; background: var(--cor-branco);">Resgates (Venda de Ativos)</td>`;
  dreDados.forEach((d, i) => {
    htmlLinhas += `<td style="text-align: right; color: var(--tinta-verde); font-weight: 600; ${i === indiceMesAtual ? 'background-color: var(--dre-destaque);' : ''}">${formatarMoeda(d.resgate)}</td>`;
  });
  htmlLinhas += `</tr>`;

  htmlLinhas += `<tr><td class="coluna-fixa" style="font-weight: 600; background: var(--cor-branco);">Investimento (Renda Fixa)</td>`;
  dreDados.forEach((d, i) => {
    htmlLinhas += `<td style="text-align: right; color: var(--tinta-azul); font-weight: 600; ${i === indiceMesAtual ? 'background-color: var(--dre-destaque);' : ''}">${d.invFixo > 0 ? '-' + formatarMoeda(d.invFixo) : 'R$ 0,00'}</td>`;
  });
  htmlLinhas += `</tr>`;

  htmlLinhas += `<tr><td class="coluna-fixa" style="font-weight: 600; background: var(--cor-branco);">Investimento (Renda Variável)</td>`;
  dreDados.forEach((d, i) => {
    htmlLinhas += `<td style="text-align: right; color: var(--tinta-azul); font-weight: 600; ${i === indiceMesAtual ? 'background-color: var(--dre-destaque);' : ''}">${d.invVar > 0 ? '-' + formatarMoeda(d.invVar) : 'R$ 0,00'}</td>`;
  });
  htmlLinhas += `</tr>`;

  // Aporte externo: entra no capital aplicado, mas NÃO saiu do caixa — por isso
  // vem sem o sinal de menos das linhas acima e não entra no "Resultado do mês".
  // Só aparece quando existe: para quem nunca usou a origem, é ruído.
  const algumExterno = dreDados.some((d) => (d.invExterno || 0) > 0.005);
  if (algumExterno) {
    htmlLinhas += `<tr><td class="coluna-fixa" style="font-weight: 600; background: var(--cor-branco);" title="Aporte feito com dinheiro de fora do app: soma no capital aplicado, mas não sai de nenhuma conta — por isso não desconta do resultado do mês.">Aporte externo (fora do caixa)</td>`;
    dreDados.forEach((d, i) => {
      const v = d.invExterno || 0;
      htmlLinhas += `<td style="text-align: right; color: var(--cor-texto-mutado); font-weight: 600; ${i === indiceMesAtual ? 'background-color: var(--dre-destaque);' : ''}">${v > 0.005 ? formatarMoeda(v) : 'R$ 0,00'}</td>`;
    });
    htmlLinhas += `</tr>`;
  }

  htmlLinhas += `<tr><td class="coluna-fixa" style="font-weight: 600; background: var(--cor-branco);">Sonhos (separado p/ metas)</td>`;
  dreDados.forEach((d, i) => {
    htmlLinhas += `<td style="text-align: right; color: var(--tinta-roxo); font-weight: 600; ${i === indiceMesAtual ? 'background-color: var(--dre-destaque);' : ''}">${d.sonho > 0 ? '-' + formatarMoeda(d.sonho) : 'R$ 0,00'}</td>`;
  });
  htmlLinhas += `</tr>`;

  htmlLinhas += `<tr><td class="coluna-fixa" style="font-weight: 600; background: var(--cor-branco);">Despesas Consumidas</td>`;
  dreDados.forEach((d, i) => {
    htmlLinhas += `<td style="text-align: right; color: var(--tinta-vermelho); font-weight: 600; ${i === indiceMesAtual ? 'background-color: var(--dre-destaque);' : ''}">${d.despesas > 0 ? '-' + formatarMoeda(d.despesas) : 'R$ 0,00'}</td>`;
  });
  htmlLinhas += `</tr>`;

  // Linha fixa: saldo do mês anterior carregado automaticamente (running balance).
  // Cor própria (roxo) p/ destacar que é herdado, não gerado no mês. O lápis no
  // mês em foco permite um ajuste manual pontual.
  const algumCarregado = dreDados.some((d) => Math.abs(d.saldoCarregado || 0) > 0.005);
  if (algumCarregado) {
    htmlLinhas += `<tr style="background:rgba(124,58,237,0.05);"><td class="coluna-fixa" style="font-weight: 600; background: rgba(124,58,237,0.07); color:var(--tinta-roxo);" title="Resultado do mês anterior, carregado automaticamente">↳ Saldo do mês anterior</td>`;
    dreDados.forEach((d, i) => {
      const v = d.saldoCarregado || 0;
      const cor = v >= 0 ? 'var(--tinta-roxo)' : 'var(--tinta-vermelho)';
      const lapis =
        i === indiceMesAtual
          ? ` <i class="ph ph-pencil-simple" title="Ajustar saldo trazido" style="cursor:pointer;color:var(--tinta-roxo);font-size:12px;" onclick="editarSaldoMesAnterior(${d.mes},${d.ano})"></i>`
          : '';
      htmlLinhas += `<td style="text-align: right; color: ${cor}; font-weight: 600; ${i === indiceMesAtual ? 'background-color: var(--dre-destaque);' : ''}">${Math.abs(v) > 0.005 ? formatarMoeda(v) : '—'}${lapis}</td>`;
    });
    htmlLinhas += `</tr>`;
  }

  htmlLinhas += `<tr class="linha-liquida"><td class="coluna-fixa" style="font-weight: 700; background: var(--cor-bg-primaria);" title="Resultado acumulado — inclui o saldo carregado do mês anterior.">Resultado do mês</td>`;
  dreDados.forEach((d, i) => {
    // Classe de meta (4.1): a cor é aplicada por CLASSE para vencer a regra
    // `.linha-liquida td { color: ... !important }` da folha de estilos, que
    // antes "engolia" o vermelho aplicado só via style inline.
    let classeMeta = 'dre-meta-neutro';
    let fontW = '600';
    let alertaBadget = '';
    if (d.saldoAcumulado < 0) {
      classeMeta = 'dre-meta-danger';
      fontW = '800';
      alertaBadget = `<br><span style="font-size: 10px; background: var(--cor-erro); color: white; padding: 2px 4px; border-radius: 4px;">NEGATIVO</span>`;
    } else if (d.saldoAcumulado < metaVermelha) {
      classeMeta = 'dre-meta-danger';
      fontW = '700';
    } else if (d.saldoAcumulado >= metaVerde) {
      classeMeta = 'dre-meta-ok';
      fontW = '700';
    }
    htmlLinhas += `<td class="${classeMeta}" style="text-align: right; font-weight: ${fontW}; ${i === indiceMesAtual ? 'background-color: var(--dre-destaque-forte);' : 'background-color: var(--cor-bg-primaria);'}">${formatarMoeda(d.saldoAcumulado)}${alertaBadget}</td>`;
  });
  htmlLinhas += `</tr>`;

  // Investimento acumulado.
  //
  // As linhas acima são FLUXO: quanto entrou e saiu naquele mês. Esta é ESTOQUE
  // — quanto de capital já foi aplicado até o fim daquele mês. Somar as duas
  // coisas na vertical daria um número sem significado, então ela fica abaixo do
  // resultado, com peso visual próprio e sem o sinal de menos das linhas de
  // saída.
  //
  // É aporte LÍQUIDO: aportes menos resgates. Resgatar reduz o capital aplicado,
  // e ignorar isso faria a linha só subir mesmo para quem tirou tudo. Sonhos
  // ficam de fora — é dinheiro separado para meta, não aplicado em ativo.
  //
  // O aporte externo entra aqui (é capital aplicado como qualquer outro), mas
  // não nas linhas de fluxo acima nem no resultado do mês: ele nunca passou
  // pelo caixa. É por isso que ele tem linha própria, sem sinal de menos.
  //
  // Note que é CUSTO DE AQUISIÇÃO, não valor de mercado: rendimento não passa
  // pelo Controle Financeiro. Quanto a carteira vale hoje é a aba Meus
  // investimentos que responde.
  let acumInv = aporteLiquidoAntesDaJanela;
  const acumPorMes = dreDados.map((d) => {
    acumInv += (d.invFixo || 0) + (d.invVar || 0) + (d.invExterno || 0) - (d.resgate || 0);
    return acumInv;
  });
  htmlLinhas += `<tr class="linha-acumulada"><td class="coluna-fixa" title="Quanto você já aplicou, somando os aportes e descontando os resgates, até o fim de cada mês. É o valor investido — o custo de aquisição. O que ele virou está na linha de baixo.">Investimento acumulado</td>`;
  acumPorMes.forEach((v, i) => {
    const delta = v - (i === 0 ? aporteLiquidoAntesDaJanela : acumPorMes[i - 1]);
    const seta =
      Math.abs(delta) < 0.005
        ? ''
        : ` <span class="dre-acum-delta${delta < 0 ? ' neg' : ''}">${delta > 0 ? '+' : '−'}${formatarMoeda(Math.abs(delta)).replace('R$', '').trim()}</span>`;
    htmlLinhas += `<td style="text-align: right; ${i === indiceMesAtual ? 'background-color: var(--dre-destaque-forte);' : ''}">${formatarMoeda(v)}${seta}</td>`;
  });
  htmlLinhas += `</tr>`;

  tbodyDRE.innerHTML = htmlLinhas;

  atualizarTermometro60();

  // O painel de insights fecha o render do Controle. Fica por ÚLTIMO de
  // propósito: ele lê o extrato já desenhado para realçar linhas, e roda
  // sobre o mês em visão — navegar para agosto reanalisa agosto em vez de
  // mostrar a leitura de setembro num mês que não é o dela.
  if (typeof insightsUiRenderizar === 'function') insightsUiRenderizar();
}

// ============================================================
// --- Sub-filtro do extrato por categoria ---
// ============================================================
// As abas de cima separam por TIPO (entrada / saída / cartão / investimento).
// Isso responde "o quê", não "no quê" — e "no quê" é a pergunta de quem abre o
// extrato. Os chips saem das categorias que existem NO MÊS, ordenados pelo
// total, então a própria linha já é o ranking de para onde o dinheiro foi.
//
// Os dois filtros se somam: escolher "Saídas" + "Alimentação" mostra a
// interseção. Trocar de mês mantém a categoria escolhida se ela ainda existir;
// se não existir, volta para "Todas" em vez de mostrar uma lista vazia.
var extratoCategoriaAtiva = '';
var extratoTipoAtivo = 'todos';

function renderizarChipsCategoriaExtrato(mapa) {
  const wrap = document.getElementById('extratoCategorias');
  if (!wrap) return;
  const cats = Array.from(mapa.entries()).sort((a, b) => b[1].total - a[1].total);

  // Um chip só não é filtro — é rótulo. Nesse caso a linha não aparece.
  if (cats.length < 2) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    extratoCategoriaAtiva = '';
    aplicarFiltrosExtrato();
    return;
  }
  if (extratoCategoriaAtiva && !mapa.has(extratoCategoriaAtiva)) extratoCategoriaAtiva = '';

  const total = cats.reduce((s, [, c]) => s + c.total, 0);
  let html =
    '<button type="button" class="ext-cat' +
    (extratoCategoriaAtiva ? '' : ' on') +
    '" data-ext-chip="" onclick="filtrarExtratoPorCategoria(\'\')">Todas' +
    '<span class="ext-cat-val">' +
    formatarMoeda(total) +
    '</span></button>';
  for (const [slug, c] of cats) {
    html +=
      '<button type="button" class="ext-cat' +
      (extratoCategoriaAtiva === slug ? ' on' : '') +
      '" data-ext-chip="' +
      slug.replace(/"/g, '&quot;') +
      '" onclick="filtrarExtratoPorCategoria(\'' +
      slug.replace(/\\/g, '\\\\').replace(/'/g, "\\'") +
      '\')">' +
      c.rotulo +
      '<span class="ext-cat-val">' +
      formatarMoeda(c.total) +
      '</span></button>';
  }
  wrap.innerHTML = html;
  wrap.style.display = 'flex';
  aplicarFiltrosExtrato();
}

function filtrarExtratoPorCategoria(slug) {
  extratoCategoriaAtiva = slug === extratoCategoriaAtiva ? '' : slug;
  document.querySelectorAll('#extratoCategorias .ext-cat').forEach((b) => {
    b.classList.toggle('on', (b.dataset.extChip || '') === extratoCategoriaAtiva);
  });
  aplicarFiltrosExtrato();
}

// Tipo (abas do topo) e categoria (chips) se somam: "Saídas" + "Alimentação"
// mostra a interseção. Esconder por item — e não re-renderizar — preserva os
// botões de pagar/editar já ligados e a posição do scroll.
function aplicarFiltrosExtrato() {
  const lista = document.getElementById('extratoUnificado');
  if (!lista) return;
  let visiveis = 0;
  lista.querySelectorAll('.extrato-item').forEach((el) => {
    const bate =
      (!extratoTipoAtivo ||
        extratoTipoAtivo === 'todos' ||
        el.dataset.extTipo === extratoTipoAtivo) &&
      (!extratoCategoriaAtiva || el.dataset.extCat === extratoCategoriaAtiva);
    el.style.display = bate ? '' : 'none';
    if (bate) visiveis++;
  });

  // Vazio por FILTRO e vazio por MÊS SEM LANÇAMENTO são situações diferentes:
  // na primeira, o caminho de volta é limpar o filtro, e a mensagem tem de
  // dizer isso.
  const vazio = document.getElementById('extratoVazio');
  if (!vazio) return;
  if (visiveis > 0) {
    vazio.style.display = 'none';
    return;
  }
  const temAlgum = lista.querySelectorAll('.extrato-item').length > 0;
  vazio.style.display = 'flex';
  vazio.innerHTML = temAlgum
    ? '<i class="ph ph-funnel"></i>Nenhum lançamento com este filtro'
    : '<i class="ph ph-tray"></i>Nenhum lançamento neste mês';
}
