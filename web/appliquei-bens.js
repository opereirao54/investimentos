/**
 * Appliquei — Cadastro de Bens (imóveis, veículos, outros).
 *
 * Classic script. Carregado DEPOIS de appliquei-contas.js e ANTES de
 * appliquei-patrimonio.js. Persiste em localStorage 'appliquei_bens'
 * (auto-sincronizado pelo cloud-sync via prefixo appliquei_*).
 *
 * Integração com a API FIPE (parallelum) para veículos: busca marca,
 * modelo, ano e valor de referência automaticamente.
 */

// ============================================================
// === CADASTRO DE BENS                                      ===
// ============================================================

var bens = (function () {
  try {
    var arr = JSON.parse(localStorage.getItem('appliquei_bens'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
})();

var BEM_TIPOS = [
  { v: 'veiculo', label: 'Veículo', icon: 'ph-car-simple' },
  { v: 'imovel', label: 'Imóvel', icon: 'ph-house-line' },
  { v: 'outro', label: 'Outro', icon: 'ph-package' },
];

var BEM_VEICULO_TIPOS = [
  { v: 'carros', label: 'Carro', icon: 'ph-car-simple' },
  { v: 'motos', label: 'Moto', icon: 'ph-motorcycle' },
  { v: 'caminhoes', label: 'Caminhão', icon: 'ph-truck' },
];

var FIPE_BASE = 'https://parallelum.com.br/fipe/api/v1';

// ============================================================
// === PERSISTÊNCIA                                          ===
// ============================================================

function salvarBens() {
  try {
    localStorage.setItem('appliquei_bens', JSON.stringify(bens));
  } catch (e) {}
  try {
    if (window.AppliqueiCloudSync && typeof AppliqueiCloudSync.forceFlush === 'function') {
      AppliqueiCloudSync.forceFlush();
    }
  } catch (e) {}
}

// ============================================================
// === CRUD                                                  ===
// ============================================================

function criarBem(dados) {
  dados = dados || {};
  var nome = (dados.nome || '').trim();
  if (!nome) return null;
  var agora = new Date().toISOString();
  var novo = {
    id: 'bem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    nome: nome,
    tipo: dados.tipo || 'outro',
    descricao: (dados.descricao || '').trim(),
    valorAtual: Number(dados.valorAtual) || 0,
    valorCompra: Number(dados.valorCompra) || 0,
    dataCompra: dados.dataCompra || null,
    fipe: dados.fipe || null,
    arquivado: false,
    criadoEm: agora,
    atualizadoEm: agora,
  };
  bens.push(novo);
  salvarBens();
  return novo;
}

function obterBem(id) {
  for (var i = 0; i < bens.length; i++) {
    if (bens[i].id === id) return bens[i];
  }
  return null;
}

function editarBem(id, patch) {
  var b = obterBem(id);
  if (!b) return null;
  patch = patch || {};
  if (patch.nome != null) b.nome = String(patch.nome).trim() || b.nome;
  if (patch.tipo != null) b.tipo = patch.tipo;
  if (patch.descricao != null) b.descricao = String(patch.descricao).trim();
  if (patch.valorAtual != null) b.valorAtual = Number(patch.valorAtual) || 0;
  if (patch.valorCompra != null) b.valorCompra = Number(patch.valorCompra) || 0;
  if (patch.dataCompra !== undefined) b.dataCompra = patch.dataCompra;
  if (patch.fipe !== undefined) b.fipe = patch.fipe;
  if (patch.arquivado != null) b.arquivado = !!patch.arquivado;
  b.atualizadoEm = new Date().toISOString();
  salvarBens();
  return b;
}

function excluirBem(id) {
  bens = bens.filter(function (b) { return b.id !== id; });
  salvarBens();
}

function bensAtivos() {
  return bens.filter(function (b) { return !b.arquivado; });
}

function totalBensAtual() {
  return bensAtivos().reduce(function (s, b) { return s + (b.valorAtual || 0); }, 0);
}

// ============================================================
// === FIPE API                                              ===
// ============================================================

var _fipeCache = {};

function fipeFetch(path) {
  if (_fipeCache[path]) return Promise.resolve(_fipeCache[path]);
  return fetch(FIPE_BASE + path)
    .then(function (r) {
      if (!r.ok) throw new Error('FIPE ' + r.status);
      return r.json();
    })
    .then(function (data) {
      _fipeCache[path] = data;
      return data;
    });
}

function fipeMarcas(tipoVeiculo) {
  return fipeFetch('/' + tipoVeiculo + '/marcas');
}

function fipeModelos(tipoVeiculo, marcaCodigo) {
  return fipeFetch('/' + tipoVeiculo + '/marcas/' + marcaCodigo + '/modelos');
}

function fipeAnos(tipoVeiculo, marcaCodigo, modeloCodigo) {
  return fipeFetch('/' + tipoVeiculo + '/marcas/' + marcaCodigo + '/modelos/' + modeloCodigo + '/anos');
}

function fipeValor(tipoVeiculo, marcaCodigo, modeloCodigo, anoCodigo) {
  return fipeFetch('/' + tipoVeiculo + '/marcas/' + marcaCodigo + '/modelos/' + modeloCodigo + '/anos/' + anoCodigo);
}

// ============================================================
// === UI — FORMULÁRIO                                       ===
// ============================================================

function abrirNovoBemForm() {
  var form = document.getElementById('formNovoBem');
  if (!form) return;
  form.style.display = '';
  document.getElementById('bemEditId').value = '';
  document.getElementById('tituloFormBem').textContent = 'Novo bem';
  document.getElementById('bemNome').value = '';
  document.getElementById('bemDescricao').value = '';
  var selTipo = document.getElementById('bemTipo');
  selTipo.innerHTML = BEM_TIPOS.map(function (t) {
    return '<option value="' + t.v + '">' + t.label + '</option>';
  }).join('');
  selTipo.value = 'veiculo';
  document.getElementById('bemValorAtual').value = '';
  document.getElementById('bemValorCompra').value = '';
  document.getElementById('bemDataCompra').value = new Date().toISOString().slice(0, 10);
  bemToggleFipe();
  bemLimparFipe();
  document.getElementById('bemNome').focus();
}

function editarBemForm(id) {
  var b = obterBem(id);
  if (!b) return;
  abrirNovoBemForm();
  document.getElementById('bemEditId').value = id;
  document.getElementById('tituloFormBem').textContent = 'Editar bem';
  document.getElementById('bemNome').value = b.nome;
  document.getElementById('bemDescricao').value = b.descricao || '';
  document.getElementById('bemTipo').value = b.tipo;
  if (typeof setValorBRLInput === 'function') {
    setValorBRLInput(document.getElementById('bemValorAtual'), b.valorAtual);
    setValorBRLInput(document.getElementById('bemValorCompra'), b.valorCompra);
  }
  document.getElementById('bemDataCompra').value = b.dataCompra || '';
  bemToggleFipe();
  if (b.fipe) {
    var info = document.getElementById('bemFipeInfo');
    if (info) {
      info.style.display = '';
      info.innerHTML =
        '<i class="ph ph-car-simple" style="color:var(--cor-primaria);"></i> ' +
        '<strong>' + (b.fipe.modelo || '') + '</strong> — FIPE ' +
        (b.fipe.codigoFipe || '') + ' — Ref. ' + (b.fipe.mesReferencia || '');
    }
  }
}

function cancelarFormBem() {
  var form = document.getElementById('formNovoBem');
  if (form) form.style.display = 'none';
}

function salvarFormBem() {
  var nome = (document.getElementById('bemNome').value || '').trim();
  if (!nome) return mostrarToast('Informe o nome do bem.', 'erro');
  var tipo = document.getElementById('bemTipo').value;
  var valorAtual = typeof parseBRL === 'function' ? parseBRL(document.getElementById('bemValorAtual').value) : 0;
  var valorCompra = typeof parseBRL === 'function' ? parseBRL(document.getElementById('bemValorCompra').value) : 0;
  var dataCompra = document.getElementById('bemDataCompra').value || null;
  var descricao = (document.getElementById('bemDescricao').value || '').trim();

  var fipeData = null;
  var fipeInfo = document.getElementById('bemFipeInfo');
  if (fipeInfo && fipeInfo.dataset.fipe) {
    try { fipeData = JSON.parse(fipeInfo.dataset.fipe); } catch (e) {}
  }

  var editId = document.getElementById('bemEditId').value;
  if (editId) {
    editarBem(editId, {
      nome: nome, tipo: tipo, valorAtual: valorAtual, valorCompra: valorCompra,
      dataCompra: dataCompra, descricao: descricao, fipe: fipeData,
    });
    mostrarToast('Bem atualizado.', 'sucesso');
  } else {
    criarBem({
      nome: nome, tipo: tipo, valorAtual: valorAtual, valorCompra: valorCompra,
      dataCompra: dataCompra, descricao: descricao, fipe: fipeData,
    });
    mostrarToast('Bem cadastrado.', 'sucesso');
  }
  cancelarFormBem();
  renderMeusBens();
  if (typeof renderMeuPatrimonio === 'function') renderMeuPatrimonio(true);
}

function confirmarExcluirBem(id) {
  var b = obterBem(id);
  if (!b) return;
  var modal = document.getElementById('modalConfirmacao');
  if (!modal) return;
  document.getElementById('modalTitulo').innerHTML =
    '<i class="ph ph-trash" style="color:var(--cor-erro);"></i> Excluir bem';
  document.getElementById('modalMensagem').innerHTML =
    'Excluir <strong>' + b.nome + '</strong>? Essa ação não pode ser desfeita.';
  document.getElementById('modalAcoes').innerHTML =
    '<button class="btn-acao" style="background-color:var(--cor-erro);" onclick="executarExcluirBem(\'' + id + '\')"><i class="ph ph-trash"></i> Sim, excluir</button>';
  modal.style.display = 'flex';
}

function executarExcluirBem(id) {
  excluirBem(id);
  fecharModal();
  renderMeusBens();
  if (typeof renderMeuPatrimonio === 'function') renderMeuPatrimonio(true);
  mostrarToast('Bem excluído.', 'sucesso');
}

// ============================================================
// === UI — FIPE (cascata: tipo → marca → modelo → ano)      ===
// ============================================================

function bemToggleFipe() {
  var tipo = document.getElementById('bemTipo').value;
  var wrap = document.getElementById('bemFipeWrap');
  if (wrap) wrap.style.display = tipo === 'veiculo' ? '' : 'none';
}

function bemLimparFipe() {
  var ids = ['bemFipeVeiculoTipo', 'bemFipeMarca', 'bemFipeModelo', 'bemFipeAno'];
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) { el.innerHTML = '<option value="">— selecione —</option>'; el.disabled = true; }
  });
  var tipo = document.getElementById('bemFipeVeiculoTipo');
  if (tipo) {
    tipo.innerHTML = '<option value="">— tipo de veículo —</option>' +
      BEM_VEICULO_TIPOS.map(function (t) {
        return '<option value="' + t.v + '">' + t.label + '</option>';
      }).join('');
    tipo.disabled = false;
  }
  var info = document.getElementById('bemFipeInfo');
  if (info) { info.style.display = 'none'; info.innerHTML = ''; info.dataset.fipe = ''; }
}

function bemFipeOnTipoVeiculo() {
  var tipoV = document.getElementById('bemFipeVeiculoTipo').value;
  var marca = document.getElementById('bemFipeMarca');
  var modelo = document.getElementById('bemFipeModelo');
  var ano = document.getElementById('bemFipeAno');
  [marca, modelo, ano].forEach(function (el) {
    if (el) { el.innerHTML = '<option value="">— selecione —</option>'; el.disabled = true; }
  });
  if (!tipoV) return;
  marca.innerHTML = '<option value="">Carregando…</option>';
  marca.disabled = true;
  fipeMarcas(tipoV).then(function (list) {
    marca.innerHTML = '<option value="">— marca —</option>' +
      list.map(function (m) { return '<option value="' + m.codigo + '">' + m.nome + '</option>'; }).join('');
    marca.disabled = false;
  }).catch(function () {
    marca.innerHTML = '<option value="">Erro ao carregar</option>';
    mostrarToast('Não foi possível carregar marcas da FIPE.', 'erro');
  });
}

function bemFipeOnMarca() {
  var tipoV = document.getElementById('bemFipeVeiculoTipo').value;
  var marcaC = document.getElementById('bemFipeMarca').value;
  var modelo = document.getElementById('bemFipeModelo');
  var ano = document.getElementById('bemFipeAno');
  [modelo, ano].forEach(function (el) {
    if (el) { el.innerHTML = '<option value="">— selecione —</option>'; el.disabled = true; }
  });
  if (!marcaC) return;
  modelo.innerHTML = '<option value="">Carregando…</option>';
  modelo.disabled = true;
  fipeModelos(tipoV, marcaC).then(function (data) {
    var list = data.modelos || data;
    modelo.innerHTML = '<option value="">— modelo —</option>' +
      list.map(function (m) { return '<option value="' + m.codigo + '">' + m.nome + '</option>'; }).join('');
    modelo.disabled = false;
  }).catch(function () {
    modelo.innerHTML = '<option value="">Erro ao carregar</option>';
    mostrarToast('Não foi possível carregar modelos da FIPE.', 'erro');
  });
}

function bemFipeOnModelo() {
  var tipoV = document.getElementById('bemFipeVeiculoTipo').value;
  var marcaC = document.getElementById('bemFipeMarca').value;
  var modeloC = document.getElementById('bemFipeModelo').value;
  var anoSel = document.getElementById('bemFipeAno');
  anoSel.innerHTML = '<option value="">— selecione —</option>';
  anoSel.disabled = true;
  if (!modeloC) return;
  anoSel.innerHTML = '<option value="">Carregando…</option>';
  fipeAnos(tipoV, marcaC, modeloC).then(function (list) {
    anoSel.innerHTML = '<option value="">— ano —</option>' +
      list.map(function (a) { return '<option value="' + a.codigo + '">' + a.nome + '</option>'; }).join('');
    anoSel.disabled = false;
  }).catch(function () {
    anoSel.innerHTML = '<option value="">Erro ao carregar</option>';
    mostrarToast('Não foi possível carregar anos da FIPE.', 'erro');
  });
}

function bemFipeOnAno() {
  var tipoV = document.getElementById('bemFipeVeiculoTipo').value;
  var marcaC = document.getElementById('bemFipeMarca').value;
  var modeloC = document.getElementById('bemFipeModelo').value;
  var anoC = document.getElementById('bemFipeAno').value;
  if (!anoC) return;
  var info = document.getElementById('bemFipeInfo');
  if (info) { info.style.display = ''; info.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Consultando FIPE…'; }
  fipeValor(tipoV, marcaC, modeloC, anoC).then(function (data) {
    if (info) {
      info.innerHTML =
        '<i class="ph ph-car-simple" style="color:var(--cor-primaria);"></i> ' +
        '<strong>' + (data.Modelo || data.modelo || '') + '</strong> — ' +
        (data.Valor || data.valor || '') +
        ' <span style="color:var(--cor-texto-mutado);font-size:11px;">(FIPE ' +
        (data.CodigoFipe || data.codigoFipe || '') + ' · Ref. ' +
        (data.MesReferencia || data.mesReferencia || '') + ')</span>';
      info.dataset.fipe = JSON.stringify({
        codigoFipe: data.CodigoFipe || data.codigoFipe || '',
        modelo: data.Modelo || data.modelo || '',
        marca: data.Marca || data.marca || '',
        valor: data.Valor || data.valor || '',
        mesReferencia: data.MesReferencia || data.mesReferencia || '',
        tipoVeiculo: tipoV,
        marcaCodigo: marcaC,
        modeloCodigo: modeloC,
        anoCodigo: anoC,
      });
    }
    var valorStr = (data.Valor || data.valor || '').replace(/[^\d,]/g, '');
    var inputValor = document.getElementById('bemValorAtual');
    if (inputValor && valorStr) {
      inputValor.value = valorStr;
      if (typeof aplicarMascaraBRL === 'function') aplicarMascaraBRL(inputValor);
    }
    var marcaNome = data.Marca || data.marca || '';
    var modeloNome = data.Modelo || data.modelo || '';
    var inputNome = document.getElementById('bemNome');
    if (inputNome && !inputNome.value.trim()) {
      inputNome.value = (marcaNome + ' ' + modeloNome).trim();
    }
  }).catch(function () {
    if (info) { info.innerHTML = '<span style="color:var(--cor-erro);"><i class="ph ph-warning"></i> Erro ao consultar FIPE</span>'; }
    mostrarToast('Não foi possível consultar o valor FIPE.', 'erro');
  });
}

function bemAtualizarFipe(id) {
  var b = obterBem(id);
  if (!b || !b.fipe) return;
  var f = b.fipe;
  fipeValor(f.tipoVeiculo, f.marcaCodigo, f.modeloCodigo, f.anoCodigo).then(function (data) {
    var valorStr = (data.Valor || data.valor || '').replace(/[^\d,]/g, '');
    var valorNum = typeof parseBRL === 'function' ? parseBRL(valorStr) : 0;
    if (valorNum > 0) {
      editarBem(id, {
        valorAtual: valorNum,
        fipe: Object.assign({}, b.fipe, {
          valor: data.Valor || data.valor || '',
          mesReferencia: data.MesReferencia || data.mesReferencia || '',
        }),
      });
      renderMeusBens();
      if (typeof renderMeuPatrimonio === 'function') renderMeuPatrimonio(true);
      mostrarToast('Valor FIPE de ' + b.nome + ' atualizado.', 'sucesso');
    }
  }).catch(function () {
    mostrarToast('Erro ao atualizar FIPE de ' + b.nome + '.', 'erro');
  });
}

// ============================================================
// === UI — RENDERIZAÇÃO DA LISTA                            ===
// ============================================================

function renderMeusBens() {
  var wrap = document.getElementById('listaBens');
  if (!wrap) return;

  var ativos = bensAtivos();
  var arquivados = bens.filter(function (b) { return b.arquivado; });
  var todos = ativos.concat(arquivados);

  if (!todos.length) {
    wrap.innerHTML = '<div class="mp-empty"><i class="ph ph-package"></i>Nenhum bem cadastrado.</div>';
    return;
  }

  var fmt = typeof formatarMoeda === 'function' ? formatarMoeda : function (v) { return 'R$ ' + v.toFixed(2); };
  var iconMap = {};
  BEM_TIPOS.forEach(function (t) { iconMap[t.v] = t.icon; });

  wrap.innerHTML = todos.map(function (b) {
    var arq = b.arquivado;
    var icon = iconMap[b.tipo] || 'ph-package';
    var valorTxt = b.valorAtual ? fmt(b.valorAtual) : '—';
    var fipeBadge = '';
    if (b.fipe && b.fipe.codigoFipe) {
      fipeBadge =
        '<span class="mp-mov-tipo receita" style="font-size:9px;cursor:pointer;" onclick="bemAtualizarFipe(\'' + b.id + '\')" title="Clique para atualizar o valor FIPE">' +
        '<i class="ph ph-arrows-clockwise"></i> FIPE ' + (b.fipe.mesReferencia || '') + '</span>';
    }
    var descTxt = b.descricao ? '<span class="mp-inst-sub" style="text-align:left;">' + b.descricao + '</span>' : '';
    var acoes = arq
      ? '<button class="btn-secundario" style="padding:3px 8px;font-size:11px;" onclick="editarBem(\'' + b.id + '\',{arquivado:false});renderMeusBens();" title="Restaurar"><i class="ph ph-arrow-counter-clockwise"></i></button>'
      : '<button class="btn-secundario" style="padding:3px 8px;font-size:11px;" onclick="editarBemForm(\'' + b.id + '\')" title="Editar"><i class="ph ph-pencil-simple"></i></button>' +
        '<button class="btn-secundario" style="padding:3px 8px;font-size:11px;" onclick="confirmarExcluirBem(\'' + b.id + '\')" title="Excluir"><i class="ph ph-trash" style="color:var(--cor-erro);"></i></button>';

    return '<div class="mp-inst-item' + (arq ? ' mp-arq' : '') + '" style="' + (arq ? 'opacity:.5;' : '') + '">' +
      '<div style="min-width:0;display:flex;align-items:center;gap:9px;">' +
        '<i class="ph-fill ' + icon + '" style="font-size:20px;color:var(--cor-texto-mutado);flex-shrink:0;"></i>' +
        '<div style="min-width:0;">' +
          '<span class="mp-inst-nome">' + b.nome + (arq ? ' <span style="font-size:10px;color:var(--cor-texto-mutado);">(arquivado)</span>' : '') + '</span>' +
          descTxt +
          (fipeBadge ? '<div style="margin-top:3px;">' + fipeBadge + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
        '<span class="mp-inst-valor valor-mascarado">' + valorTxt + '</span>' +
        acoes +
      '</div>' +
    '</div>';
  }).join('');
}
