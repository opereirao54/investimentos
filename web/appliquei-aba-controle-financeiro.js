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

function obterCategoriasDespesa() {
  return CATEGORIAS_DESPESA_PADRAO.concat(obterCategoriasDespesaCustom());
}

function rotuloCategoriaDespesa(v) {
  if (!v) return '';
  const c = obterCategoriasDespesa().find((x) => x.v === v);
  return c ? c.label : v;
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

function renderEmojiPickerCategoria() {
  const picker = document.getElementById('categoriaDespesaEmojiPicker');
  if (!picker) return;
  const atual = document.getElementById('categoriaDespesaNovaEmoji')?.value || '🏷️';
  picker.innerHTML = EMOJIS_CATEGORIA_DESPESA.map(
    (e) =>
      `<button type="button" onclick="selecionarEmojiCategoria('${e}')" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:18px;line-height:1;border-radius:8px;cursor:pointer;background:transparent;border:1.5px solid ${e === atual ? 'var(--cor-primaria)' : 'transparent'};">${e}</button>`
  ).join('');
}

function toggleEmojiPickerCategoria() {
  const picker = document.getElementById('categoriaDespesaEmojiPicker');
  if (!picker) return;
  const aberto = picker.style.display === 'flex';
  if (aberto) {
    picker.style.display = 'none';
  } else {
    renderEmojiPickerCategoria();
    picker.style.display = 'flex';
  }
}

function resetarEmojiCategoriaNova() {
  const hidden = document.getElementById('categoriaDespesaNovaEmoji');
  const btn = document.getElementById('categoriaDespesaNovaEmojiBtn');
  if (hidden) hidden.value = '🏷️';
  if (btn) btn.textContent = '🏷️';
  const picker = document.getElementById('categoriaDespesaEmojiPicker');
  if (picker) picker.style.display = 'none';
}

function selecionarEmojiCategoria(emoji) {
  const hidden = document.getElementById('categoriaDespesaNovaEmoji');
  const btn = document.getElementById('categoriaDespesaNovaEmojiBtn');
  if (hidden) hidden.value = emoji;
  if (btn) btn.textContent = emoji;
  const picker = document.getElementById('categoriaDespesaEmojiPicker');
  if (picker) picker.style.display = 'none';
  document.getElementById('categoriaDespesaNova')?.focus();
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
    const slug =
      nome
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'outros';
    const todas = obterCategoriasDespesa();
    const existente = todas.find((c) => c.v === slug);
    if (existente) return existente.v;
    const emoji = (document.getElementById('categoriaDespesaNovaEmoji')?.value || '🏷️').trim();
    const custom = obterCategoriasDespesaCustom();
    custom.push({ v: slug, label: `${emoji} ${nome}` });
    salvarCategoriasDespesaCustom(custom);
    return slug;
  }
  return valor || null;
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

  // 4.6 — a data de cartão é derivada do cartão cadastrado, não editável.
  const inputVenc = document.getElementById('dataVencimento');
  if (inputVenc) {
    const ehCartao = cat === 'cartao_credito';
    inputVenc.readOnly = ehCartao;
    inputVenc.style.opacity = ehCartao ? '0.7' : '';
    inputVenc.title = ehCartao
      ? 'Definida automaticamente pelo fechamento/vencimento do cartão cadastrado.'
      : '';
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

function preencherVencimentoPorCartao() {
  const sel = document.getElementById('selectCartao');
  const inputVenc = document.getElementById('dataVencimento');
  if (!sel || !inputVenc) return;
  if (!sel.value || sel.value === '__novo__') return;
  const cartao = obterCartao(sel.value);
  const data = cartaoCalcularVencimento(new Date(), cartao?.diaFechamento, cartao?.diaVencimento);
  if (!data) return;
  const yyyy = data.getFullYear();
  const mm = String(data.getMonth() + 1).padStart(2, '0');
  const dd = String(data.getDate()).padStart(2, '0');
  inputVenc.value = `${yyyy}-${mm}-${dd}`;
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

// Autocompletar Inteligente
function atualizarDatalistDescricoes() {
  const datalist = document.getElementById('listaDescricoes');
  datalist.innerHTML = '';
  const descricoesUnicas = [
    ...new Set(
      transacoes.map((t) => {
        let d = t.descricao;
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
  }
  document.getElementById('descTransacao').focus();

  document.getElementById('tituloPainelControle').innerHTML =
    '<i class="ph ph-pencil-simple" style="color: var(--cor-info);"></i> Editando Operação';

  // Abre o drawer/bottom-sheet automaticamente ao iniciar edição
  abrirPainelLancamento();
}

function cancelarEdicaoControle() {
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
    transacoes = transacoes.map((t) => {
      if (
        t.groupId === transAtual.groupId &&
        (t.ano > transAtual.ano || (t.ano === transAtual.ano && t.mes >= transAtual.mes))
      ) {
        t.descricao = desc;
        t.valor = valorTotal;
        t.categoria = categoria;
        t.obs = obs;
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
  try {
    localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
  } catch (e) {
    console.error('[executarEdicao] localStorage', e);
    mostrarToast('Falha ao salvar localmente. Espaço de armazenamento esgotado?', 'erro');
    return;
  }
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

    // Cartão de crédito: a competência (mes/ano) é a da fatura (dataVencimento),
    // não a do mês em visão. Assim a compra entra na próxima fatura, não no mês actual.
    if (categoria === 'cartao_credito' && dataVencFinal) {
      const [fAno, fMes] = dataVencFinal.split('-').map(Number);
      if (!isNaN(fAno) && !isNaN(fMes)) {
        a = fAno;
        m = fMes - 1;
      }
    }

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
      pago: false,
    });
  }

  try {
    localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
  } catch (e) {
    console.error('[executarInsercao] localStorage', e);
    mostrarToast('Falha ao salvar localmente. Espaço de armazenamento esgotado?', 'erro');
    return;
  }
  // Força sync imediato em vez de esperar o debounce de 2s — cobre
  // o caso do usuário lançar uma despesa e fechar o tab antes do
  // flush automático (que era o sintoma do "falso salvamento").
  try {
    if (window.AppliqueiCloudSync && typeof AppliqueiCloudSync.forceFlush === 'function') {
      AppliqueiCloudSync.forceFlush();
    }
  } catch (_) {}
  document.getElementById('descTransacao').value = '';
  document.getElementById('valorTransacao').value = '';
  document.getElementById('transacaoFixa').checked = false;
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
  mostrarToast('Lançamento salvo com sucesso!', 'sucesso');
  atualizarTelaControle();
  atualizarDatalistDescricoes();
  fecharPainelLancamento();
}

function calcularResumoMes(mesAlvo, anoAlvo) {
  let res = {
    receita: 0,
    resgate: 0,
    despFixa: 0,
    despVar: 0,
    cartao: 0,
    invFixo: 0,
    invVar: 0,
    sonho: 0,
  };
  transacoes.forEach((t) => {
    if (t.mes === mesAlvo && t.ano === anoAlvo) {
      if (t.categoria === 'receita') res.receita += t.valor;
      else if (t.categoria === 'resgate_investimento') res.resgate += t.valor;
      else if (t.categoria === 'despesa_fixa') res.despFixa += t.valor;
      else if (t.categoria === 'despesa_variavel') res.despVar += t.valor;
      else if (t.categoria === 'cartao_credito') res.cartao += t.valor;
      else if (t.categoria === 'investimento_fixo') res.invFixo += t.valor;
      else if (t.categoria === 'investimento_variavel') res.invVar += t.valor;
      else if (t.categoria === 'sonho') res.sonho += t.valor;
    }
  });
  return res;
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

// Resultado bruto do mês (receitas - despesas - aportes - sonhos), isolado.
function calcularResultadoMes(mes, ano) {
  const r = calcularResumoMes(mes, ano);
  const totRec = r.receita + r.resgate;
  const totDesp = r.despFixa + r.despVar + r.sonho;
  const totInv = r.invFixo + r.invVar;
  return totRec - totDesp - r.cartao - totInv;
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
    ? `<i class="ph-bold ph-pencil-simple" style="color:#7c3aed;margin-right:4px;"></i> Saldo do mês anterior <strong>ajustado manualmente</strong> para <strong style="color:${cor};font-family:'DM Mono',monospace;">${formatarMoeda(saldo)}</strong>.`
    : `<i class="ph-fill ph-arrow-fat-line-right" style="color:#7c3aed;margin-right:4px;"></i> O fechamento de <strong>${nomeMeses[mesAnt]}/${anoAnt}</strong> (<strong style="color:${cor};font-family:'DM Mono',monospace;">${formatarMoeda(saldo)}</strong>) é carregado automaticamente para <strong>${nomeMeses[mesAtual]}/${anoAtual}</strong>.`;
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
    msg.innerHTML = `Tem certeza que deseja excluir o lançamento <strong>"${transacao.descricao}"</strong>?`;
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
  localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
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
  msg.innerHTML = `Tem certeza que deseja baixar <strong>${qtd} ${qtd === 1 ? 'lançamento' : 'lançamentos'}</strong> do cartão no valor total de <strong>${formatarMoeda(total)}</strong> como pago?`;

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
    ids.has(t.id) ? { ...t, pago: true, contaId: contaPag || t.contaId } : t
  );
  localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));
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
  localStorage.setItem('futurorico_transacoes', JSON.stringify(transacoes));

  // Se for compromisso mensal de sonho, registrar como aporte e atualizar valorAtual
  let toastMsg = 'Pagamento confirmado!';
  if (txPaga && txPaga.categoria === 'sonho' && !txPaga.aporteExtra && txPaga.sonhoId) {
    registrarAportePorPagamentoSonho(txPaga);
    toastMsg = 'Pagamento confirmado e aporte registrado no sonho!';
  }

  mostrarToast(toastMsg, 'sucesso');
  atualizarTelaControle();
  if (typeof renderizarSonhos === 'function') renderizarSonhos();
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

function atualizarTelaControle() {
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

  const divRec = document.getElementById('extratoReceitas');
  divRec.innerHTML = '';
  const divDesp = document.getElementById('extratoDespesas');
  divDesp.innerHTML = '';
  const divCartao = document.getElementById('extratoCartao');
  divCartao.innerHTML = '';
  const divInv = document.getElementById('extratoInvestimentos');
  divInv.innerHTML = '';

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
                        <div class="venc-name">${conta.descricao}${obsIcone}${badgeAtraso}</div>
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

  let totRec = 0,
    totDesp = 0,
    totCartao = 0,
    totInv = 0;
  const nomesCat = {
    receita: 'Receita',
    resgate_investimento: 'Resgate',
    despesa_fixa: 'Desp. Fixa',
    despesa_variavel: 'Desp. Variável',
    cartao_credito: 'C. Crédito',
    investimento_fixo: 'Inv. Fixo',
    investimento_variavel: 'Inv. Variável',
    sonho: '⭐ Sonho',
  };

  transacoes.forEach((t) => {
    if (t.mes === visaoMes && t.ano === visaoAno) {
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
      let itemHtml = `
            <div class="extrato-item">
                <div>
                    <span class="desc">${t.descricao}${iconFixo}${iconFixoCartao}${iconObs}</span>
                    <span class="cat">${nomesCat[t.categoria] || 'Outros'}${nomeCartaoExtrato}${catDespExtrato}${vencimentoHtml}</span>
                </div>
                <div style="text-align: right;">
                    <span class="valor">${formatarMoeda(t.valor)}</span>
                    <div style="margin-top: 4px; display: flex; justify-content: flex-end; align-items: center; gap: 8px;" id="acao-pagar-list-${t.id}">
                        ${!t.pago && t.categoria !== 'receita' ? `<button onclick="prepararPagamento('${t.id}', 'list')" style="background:none; border:none; cursor:pointer; color:var(--cor-primaria); font-size:16px;" title="Registrar Pagamento"><i class="ph-bold ph-check-circle"></i></button>` : ''}
                        <button onclick="prepararEdicao('${t.id}')" style="background:none; border:none; cursor:pointer; color:var(--cor-info); font-size:15px;" title="Editar"><i class="ph ph-pencil-simple"></i></button>
                        <button onclick="deletarTransacao('${t.id}')" style="background:none; border:none; cursor:pointer; color:var(--cor-erro); font-size:15px;" title="Excluir"><i class="ph ph-trash"></i></button>
                    </div>
                </div>
            </div>`;

      if (t.categoria === 'receita' || t.categoria === 'resgate_investimento') {
        totRec += t.valor;
        divRec.innerHTML += itemHtml;
      } else if (
        t.categoria === 'despesa_fixa' ||
        t.categoria === 'despesa_variavel' ||
        t.categoria === 'sonho'
      ) {
        totDesp += t.valor;
        divDesp.innerHTML += itemHtml;
      } else if (t.categoria === 'cartao_credito') {
        totCartao += t.valor;
        divCartao.innerHTML += itemHtml;
      } else {
        totInv += t.valor;
        divInv.innerHTML += itemHtml;
      }
    }
  });

  if (divRec.innerHTML === '')
    divRec.innerHTML = `<div class="kanban-empty"><i class="ph ph-arrow-down-left"></i>Sem entradas este mês</div>`;
  if (divDesp.innerHTML === '')
    divDesp.innerHTML = `<div class="kanban-empty"><i class="ph ph-arrow-up-right"></i>Sem despesas este mês</div>`;
  if (divCartao.innerHTML === '')
    divCartao.innerHTML = `<div class="kanban-empty"><i class="ph ph-credit-card"></i>Nenhuma fatura lançada</div>`;
  if (divInv.innerHTML === '')
    divInv.innerHTML = `<div class="kanban-empty"><i class="ph ph-trend-up"></i>Nenhum aporte registrado</div>`;

  document.getElementById('totalColReceitas').innerText = formatarMoeda(totRec);
  document.getElementById('totalColDespesas').innerText = formatarMoeda(totDesp);
  document.getElementById('totalColCartao').innerText = formatarMoeda(totCartao);
  document.getElementById('totalColInv').innerText = formatarMoeda(totInv);

  // KPI cards do topo — investimentos/cartão/despesa têm cards próprios e
  // todos são deduzidos da receita para compor o saldo livre.
  const kpiRec = document.getElementById('kpiReceitaMes');
  const kpiDesp = document.getElementById('kpiDespesasMes');
  const kpiCart = document.getElementById('kpiCartaoMes');
  const kpiInv = document.getElementById('kpiInvestimentosMes');
  const kpiSaldo = document.getElementById('kpiSaldoLivre');
  const lblCarregado = document.getElementById('lblSaldoCarregado');
  const saldoCarregado = obterSaldoCarregadoParaMes(visaoMes, visaoAno);
  if (kpiRec) kpiRec.innerText = formatarMoeda(totRec);
  if (kpiDesp) kpiDesp.innerText = formatarMoeda(totDesp);
  if (kpiCart) kpiCart.innerText = formatarMoeda(totCartao);
  if (kpiInv) kpiInv.innerText = formatarMoeda(totInv);
  if (kpiSaldo) {
    const saldo = totRec - totDesp - totCartao - totInv + saldoCarregado;
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

  // ALERTA CARTÃO
  const limitCartao = cartoes.reduce((sum, c) => sum + (c.limite || 0), 0);
  const alertaCartao = document.getElementById('alertaCartaoKanban');

  if (limitCartao > 0) {
    let percCartao = (totCartao / limitCartao) * 100;
    document.getElementById('barCartao').style.width = Math.min(100, percCartao) + '%';

    if (percCartao > 100) {
      document.getElementById('barCartao').style.background = 'var(--cor-erro)';
      let extrapolouReais = totCartao - limitCartao;
      let extrapolouPerc = ((totCartao - limitCartao) / limitCartao) * 100;
      const txtAlerta = document.getElementById('txtAlertaCartao');
      if (txtAlerta)
        txtAlerta.innerHTML = `Fatura estourou em ${extrapolouPerc.toFixed(1)}% — passou ${formatarMoeda(extrapolouReais)} do limite.`;
      alertaCartao.style.display = 'flex';
    } else {
      document.getElementById('barCartao').style.background = 'var(--cor-cartao)';
      alertaCartao.style.display = 'none';
    }
  } else {
    document.getElementById('barCartao').style.width = '0%';
    alertaCartao.style.display = 'none';
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
        layout: { padding: { right: 60 } },
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
    htmlLinhas += `<td style="text-align: right; color: var(--cor-primaria); font-weight: 600; ${i === indiceMesAtual ? 'background-color: #eff6ff;' : ''}">${formatarMoeda(d.receita)}</td>`;
  });
  htmlLinhas += `</tr>`;

  htmlLinhas += `<tr><td class="coluna-fixa" style="font-weight: 600; background: var(--cor-branco);">Resgates (Venda de Ativos)</td>`;
  dreDados.forEach((d, i) => {
    htmlLinhas += `<td style="text-align: right; color: var(--cor-primaria); font-weight: 600; ${i === indiceMesAtual ? 'background-color: #eff6ff;' : ''}">${formatarMoeda(d.resgate)}</td>`;
  });
  htmlLinhas += `</tr>`;

  htmlLinhas += `<tr><td class="coluna-fixa" style="font-weight: 600; background: var(--cor-branco);">Investimento (Renda Fixa)</td>`;
  dreDados.forEach((d, i) => {
    htmlLinhas += `<td style="text-align: right; color: var(--cor-info); font-weight: 600; ${i === indiceMesAtual ? 'background-color: #eff6ff;' : ''}">${d.invFixo > 0 ? '-' + formatarMoeda(d.invFixo) : 'R$ 0,00'}</td>`;
  });
  htmlLinhas += `</tr>`;

  htmlLinhas += `<tr><td class="coluna-fixa" style="font-weight: 600; background: var(--cor-branco);">Investimento (Renda Variável)</td>`;
  dreDados.forEach((d, i) => {
    htmlLinhas += `<td style="text-align: right; color: var(--cor-info); font-weight: 600; ${i === indiceMesAtual ? 'background-color: #eff6ff;' : ''}">${d.invVar > 0 ? '-' + formatarMoeda(d.invVar) : 'R$ 0,00'}</td>`;
  });
  htmlLinhas += `</tr>`;

  htmlLinhas += `<tr><td class="coluna-fixa" style="font-weight: 600; background: var(--cor-branco);">Sonhos (separado p/ metas)</td>`;
  dreDados.forEach((d, i) => {
    htmlLinhas += `<td style="text-align: right; color: #7c3aed; font-weight: 600; ${i === indiceMesAtual ? 'background-color: #eff6ff;' : ''}">${d.sonho > 0 ? '-' + formatarMoeda(d.sonho) : 'R$ 0,00'}</td>`;
  });
  htmlLinhas += `</tr>`;

  htmlLinhas += `<tr><td class="coluna-fixa" style="font-weight: 600; background: var(--cor-branco);">Despesas Consumidas</td>`;
  dreDados.forEach((d, i) => {
    htmlLinhas += `<td style="text-align: right; color: var(--cor-erro); font-weight: 600; ${i === indiceMesAtual ? 'background-color: #eff6ff;' : ''}">${d.despesas > 0 ? '-' + formatarMoeda(d.despesas) : 'R$ 0,00'}</td>`;
  });
  htmlLinhas += `</tr>`;

  // Linha fixa: saldo do mês anterior carregado automaticamente (running balance).
  // Cor própria (roxo) p/ destacar que é herdado, não gerado no mês. O lápis no
  // mês em foco permite um ajuste manual pontual.
  const algumCarregado = dreDados.some((d) => Math.abs(d.saldoCarregado || 0) > 0.005);
  if (algumCarregado) {
    htmlLinhas += `<tr style="background:rgba(124,58,237,0.05);"><td class="coluna-fixa" style="font-weight: 600; background: rgba(124,58,237,0.07); color:#7c3aed;" title="Resultado do mês anterior, carregado automaticamente">↳ Saldo do mês anterior</td>`;
    dreDados.forEach((d, i) => {
      const v = d.saldoCarregado || 0;
      const cor = v >= 0 ? '#7c3aed' : 'var(--cor-erro)';
      const lapis =
        i === indiceMesAtual
          ? ` <i class="ph ph-pencil-simple" title="Ajustar saldo trazido" style="cursor:pointer;color:#7c3aed;font-size:12px;" onclick="editarSaldoMesAnterior(${d.mes},${d.ano})"></i>`
          : '';
      htmlLinhas += `<td style="text-align: right; color: ${cor}; font-weight: 600; ${i === indiceMesAtual ? 'background-color: #eff6ff;' : ''}">${Math.abs(v) > 0.005 ? formatarMoeda(v) : '—'}${lapis}</td>`;
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
    htmlLinhas += `<td class="${classeMeta}" style="text-align: right; font-weight: ${fontW}; ${i === indiceMesAtual ? 'background-color: #d1fae5;' : 'background-color: var(--cor-bg-primaria);'}">${formatarMoeda(d.saldoAcumulado)}${alertaBadget}</td>`;
  });
  htmlLinhas += `</tr>`;

  tbodyDRE.innerHTML = htmlLinhas;

  atualizarTermometro60();
}
