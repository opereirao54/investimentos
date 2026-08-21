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

var BEM_IMOVEL_TIPOS = [
  { v: 'apartamento', label: 'Apartamento' },
  { v: 'casa', label: 'Casa' },
  { v: 'terreno', label: 'Terreno' },
  { v: 'sala_comercial', label: 'Sala comercial' },
  { v: 'galpao', label: 'Galpão' },
  { v: 'rural', label: 'Imóvel rural' },
  { v: 'outro', label: 'Outro' },
];

// Busca de CEP: ViaCEP como principal, BrasilAPI como reserva. As duas são
// públicas e sem chave. Só preenchem ENDEREÇO — valor por m² não existe em API
// pública no Brasil (FipeZAP é publicação, não API), por isso a referência de
// R$/m² é um campo que o usuário informa.
var CEP_ENDPOINTS = [
  {
    url: function (cep) {
      return 'https://viacep.com.br/ws/' + cep + '/json/';
    },
    parse: function (d) {
      if (!d || d.erro) return null;
      return {
        logradouro: d.logradouro || '',
        bairro: d.bairro || '',
        cidade: d.localidade || '',
        uf: d.uf || '',
      };
    },
  },
  {
    url: function (cep) {
      return 'https://brasilapi.com.br/api/cep/v1/' + cep;
    },
    parse: function (d) {
      if (!d || !d.city) return null;
      return {
        logradouro: d.street || '',
        bairro: d.neighborhood || '',
        cidade: d.city || '',
        uf: d.state || '',
      };
    },
  },
];
var _cepCache = {};

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
    imovel: dados.imovel || null,
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
  // `!== undefined` (e não `!= null`) para que passar null LIMPE o bloco —
  // é assim que trocar o tipo de imóvel para veículo descarta CEP/área, em vez
  // de deixá-los pendurados num bem que não é imóvel.
  if (patch.imovel !== undefined) b.imovel = patch.imovel;
  if (patch.arquivado != null) b.arquivado = !!patch.arquivado;
  b.atualizadoEm = new Date().toISOString();
  salvarBens();
  return b;
}

function excluirBem(id) {
  bens = bens.filter(function (b) {
    return b.id !== id;
  });
  salvarBens();
}

function bensAtivos() {
  return bens.filter(function (b) {
    return !b.arquivado;
  });
}

function totalBensAtual() {
  return bensAtivos().reduce(function (s, b) {
    return s + (b.valorAtual || 0);
  }, 0);
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
  return fipeFetch(
    '/' + tipoVeiculo + '/marcas/' + marcaCodigo + '/modelos/' + modeloCodigo + '/anos'
  );
}

function fipeValor(tipoVeiculo, marcaCodigo, modeloCodigo, anoCodigo) {
  return fipeFetch(
    '/' + tipoVeiculo + '/marcas/' + marcaCodigo + '/modelos/' + modeloCodigo + '/anos/' + anoCodigo
  );
}

// ============================================================
// === UI — FORMULÁRIO                                       ===
// ============================================================

// ============================================================
// === CEP e estimativa por m² (imóveis)                     ===
// ============================================================

function bemMascaraCep(input) {
  var d = String(input.value || '')
    .replace(/\D/g, '')
    .slice(0, 8);
  input.value = d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
}

function _cepLimpo(v) {
  return String(v || '').replace(/\D/g, '');
}

function _mostrarEnderecoBem(html, erro) {
  var box = document.getElementById('bemEnderecoInfo');
  if (!box) return;
  if (!html) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = '';
  box.style.background = erro ? 'var(--cor-bg-amber)' : 'var(--cor-bg-info)';
  box.style.borderColor = erro ? 'var(--cor-borda-amber)' : 'var(--cor-borda-info)';
  box.style.color = erro ? 'var(--cor-txt-amber)' : 'var(--cor-txt-info)';
  box.innerHTML = html;
}

// Preenche o endereço a partir do CEP. Nunca bloqueia o cadastro: se as duas
// APIs falharem (offline, fora do ar), avisa e deixa o usuário seguir.
function buscarCepBem() {
  var input = document.getElementById('bemCep');
  if (!input) return;
  var cep = _cepLimpo(input.value);
  if (!cep) return _mostrarEnderecoBem('');
  if (cep.length !== 8) {
    return _mostrarEnderecoBem('<i class="ph ph-warning"></i> CEP incompleto.', true);
  }
  if (_cepCache[cep]) return _aplicarEnderecoBem(_cepCache[cep]);

  _mostrarEnderecoBem('<i class="ph ph-circle-notch"></i> Buscando endereço…');
  var i = 0;
  function tentar() {
    if (i >= CEP_ENDPOINTS.length) {
      return _mostrarEnderecoBem(
        '<i class="ph ph-warning"></i> Não consegui consultar o CEP agora. Você pode preencher o endereço na descrição e seguir.',
        true
      );
    }
    var ep = CEP_ENDPOINTS[i++];
    fetch(ep.url(cep))
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        var end = d ? ep.parse(d) : null;
        if (!end) return tentar();
        _cepCache[cep] = end;
        _aplicarEnderecoBem(end);
      })
      .catch(function () {
        tentar();
      });
  }
  tentar();
}

function _aplicarEnderecoBem(end) {
  var partes = [end.logradouro, end.bairro].filter(Boolean).join(', ');
  var cidade = [end.cidade, end.uf].filter(Boolean).join('/');
  _mostrarEnderecoBem(
    '<i class="ph-fill ph-map-pin"></i> ' +
      (partes ? '<strong>' + partes + '</strong><br>' : '') +
      cidade
  );
}

function _enderecoAtualBem() {
  var cep = _cepLimpo((document.getElementById('bemCep') || {}).value);
  return cep && _cepCache[cep] ? _cepCache[cep] : null;
}

// Compara o valor cadastrado com área × referência de R$/m². Não substitui o
// valor: só mostra a diferença, para o usuário decidir.
function bemEstimarPorM2() {
  var box = document.getElementById('bemEstimativaM2');
  if (!box) return;
  var area = parseFloat(
    String((document.getElementById('bemAreaM2') || {}).value || '').replace(',', '.')
  );
  var refM2 =
    typeof parseBRL === 'function'
      ? parseBRL((document.getElementById('bemValorM2') || {}).value)
      : 0;
  if (!area || area <= 0 || !refM2 || refM2 <= 0) {
    box.style.display = 'none';
    return;
  }
  var estimado = area * refM2;
  var fmt =
    typeof formatarMoeda === 'function'
      ? formatarMoeda
      : function (v) {
          return 'R$ ' + v.toFixed(2);
        };
  var atual =
    typeof parseBRL === 'function'
      ? parseBRL((document.getElementById('bemValorAtual') || {}).value)
      : 0;

  var linhaComparacao = '';
  if (atual > 0) {
    var dif = ((atual - estimado) / estimado) * 100;
    var acima = dif >= 0;
    linhaComparacao =
      '<br>O valor que você cadastrou (' +
      fmt(atual) +
      ') está <strong>' +
      Math.abs(dif).toFixed(0) +
      '% ' +
      (acima ? 'acima' : 'abaixo') +
      '</strong> dessa referência.';
  }
  box.style.display = '';
  box.style.background = 'var(--cor-bg-primaria)';
  box.style.border = '1px solid var(--cor-borda-primaria)';
  box.style.color = 'var(--cor-txt-primaria)';
  box.innerHTML =
    '<i class="ph ph-calculator"></i> ' +
    area.toLocaleString('pt-BR') +
    ' m² × ' +
    fmt(refM2) +
    '/m² = <strong>' +
    fmt(estimado) +
    '</strong>' +
    linhaComparacao;
}

// ============================================================
// === MODAL EM PASSOS                                       ===
// ============================================================

function bemOnTrocarTipo() {
  var tipo = (document.getElementById('bemTipo') || {}).value;
  var imovel = document.getElementById('bemImovelWrap');
  if (imovel) imovel.style.display = tipo === 'imovel' ? '' : 'none';
  bemToggleFipe();
  bemLimparFipe();
}

function resetarPassosBem() {
  var p1 = document.getElementById('bemPasso1');
  var p2 = document.getElementById('bemPasso2');
  var a1 = document.getElementById('bemAcoesPasso1');
  var a2 = document.getElementById('bemAcoesPasso2');
  if (p1) p1.style.display = '';
  if (p2) p2.style.display = 'none';
  if (a1) a1.style.display = 'flex';
  if (a2) a2.style.display = 'none';
  var card = document.querySelector('#modalBem > div');
  if (card) card.scrollTop = 0;
}

function irParaValoresBem() {
  var nome = ((document.getElementById('bemNome') || {}).value || '').trim();
  if (!nome) return mostrarToast('Informe o nome do bem.', 'erro');
  document.getElementById('bemPasso1').style.display = 'none';
  document.getElementById('bemAcoesPasso1').style.display = 'none';
  document.getElementById('bemPasso2').style.display = '';
  document.getElementById('bemAcoesPasso2').style.display = 'flex';
  var card = document.querySelector('#modalBem > div');
  if (card) card.scrollTop = 0;
  // A comparação por m² usa o valor atual, que só existe neste passo.
  bemEstimarPorM2();
}

function voltarParaDadosBem() {
  document.getElementById('bemPasso2').style.display = 'none';
  document.getElementById('bemAcoesPasso2').style.display = 'none';
  document.getElementById('bemPasso1').style.display = '';
  document.getElementById('bemAcoesPasso1').style.display = 'flex';
}

function fecharModalBem() {
  var m = document.getElementById('modalBem');
  if (m) m.style.display = 'none';
}

function abrirNovoBemForm() {
  var modal = document.getElementById('modalBem');
  if (!modal) return;
  document.getElementById('bemEditId').value = '';
  document.getElementById('tituloModalBem').querySelector('span').textContent = 'Novo bem';
  document.getElementById('bemNome').value = '';
  document.getElementById('bemDescricao').value = '';
  var selTipo = document.getElementById('bemTipo');
  selTipo.innerHTML = BEM_TIPOS.map(function (t) {
    return '<option value="' + t.v + '">' + t.label + '</option>';
  }).join('');
  selTipo.value = 'veiculo';
  var selImovel = document.getElementById('bemImovelTipo');
  if (selImovel) {
    selImovel.innerHTML = BEM_IMOVEL_TIPOS.map(function (t) {
      return '<option value="' + t.v + '">' + t.label + '</option>';
    }).join('');
    selImovel.value = 'apartamento';
  }
  ['bemCep', 'bemAreaM2', 'bemValorM2', 'bemValorAtual', 'bemValorCompra'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  _mostrarEnderecoBem('');
  var est = document.getElementById('bemEstimativaM2');
  if (est) est.style.display = 'none';
  document.getElementById('bemDataCompra').value = new Date().toISOString().slice(0, 10);
  bemOnTrocarTipo();
  resetarPassosBem();
  modal.style.display = 'flex';
  document.getElementById('bemNome').focus();
}

function editarBemForm(id) {
  var b = obterBem(id);
  if (!b) return;
  abrirNovoBemForm();
  document.getElementById('bemEditId').value = id;
  document.getElementById('tituloModalBem').querySelector('span').textContent = 'Editar bem';
  document.getElementById('bemNome').value = b.nome;
  document.getElementById('bemDescricao').value = b.descricao || '';
  document.getElementById('bemTipo').value = b.tipo;
  if (typeof setValorBRLInput === 'function') {
    setValorBRLInput(document.getElementById('bemValorAtual'), b.valorAtual);
    setValorBRLInput(document.getElementById('bemValorCompra'), b.valorCompra);
  }
  document.getElementById('bemDataCompra').value = b.dataCompra || '';
  bemOnTrocarTipo();
  if (b.imovel) {
    var elCep = document.getElementById('bemCep');
    if (elCep) {
      elCep.value = b.imovel.cep || '';
      bemMascaraCep(elCep);
    }
    var elArea = document.getElementById('bemAreaM2');
    if (elArea) elArea.value = b.imovel.areaM2 || '';
    var elTipoImovel = document.getElementById('bemImovelTipo');
    if (elTipoImovel && b.imovel.tipoImovel) elTipoImovel.value = b.imovel.tipoImovel;
    if (typeof setValorBRLInput === 'function' && b.imovel.valorM2) {
      setValorBRLInput(document.getElementById('bemValorM2'), b.imovel.valorM2);
    }
    // Endereço já resolvido antes: mostra sem gastar outra chamada de API.
    if (b.imovel.endereco) {
      var cepLimpo = _cepLimpo(b.imovel.cep);
      if (cepLimpo) _cepCache[cepLimpo] = b.imovel.endereco;
      _aplicarEnderecoBem(b.imovel.endereco);
    }
    bemEstimarPorM2();
  }
  bemToggleFipe();
  if (b.fipe) {
    var info = document.getElementById('bemFipeInfo');
    if (info) {
      info.style.display = '';
      info.innerHTML =
        '<i class="ph ph-car-simple" style="color:var(--cor-primaria);"></i> ' +
        '<strong>' +
        (b.fipe.modelo || '') +
        '</strong> — FIPE ' +
        (b.fipe.codigoFipe || '') +
        ' — Ref. ' +
        (b.fipe.mesReferencia || '');
    }
  }
}

function cancelarFormBem() {
  fecharModalBem();
}

function salvarFormBem() {
  var nome = (document.getElementById('bemNome').value || '').trim();
  if (!nome) return mostrarToast('Informe o nome do bem.', 'erro');
  var tipo = document.getElementById('bemTipo').value;
  var valorAtual =
    typeof parseBRL === 'function' ? parseBRL(document.getElementById('bemValorAtual').value) : 0;
  var valorCompra =
    typeof parseBRL === 'function' ? parseBRL(document.getElementById('bemValorCompra').value) : 0;
  var dataCompra = document.getElementById('bemDataCompra').value || null;
  var descricao = (document.getElementById('bemDescricao').value || '').trim();

  var fipeData = null;
  var fipeInfo = document.getElementById('bemFipeInfo');
  if (fipeInfo && fipeInfo.dataset.fipe) {
    try {
      fipeData = JSON.parse(fipeInfo.dataset.fipe);
    } catch (e) {}
  }

  // Dados de imóvel só existem para imóvel — trocar o tipo descarta o bloco em
  // vez de deixar CEP/área pendurados num veículo.
  var imovelData = null;
  if (tipo === 'imovel') {
    var cep = _cepLimpo((document.getElementById('bemCep') || {}).value);
    var area = parseFloat(
      String((document.getElementById('bemAreaM2') || {}).value || '').replace(',', '.')
    );
    var valorM2 =
      typeof parseBRL === 'function'
        ? parseBRL((document.getElementById('bemValorM2') || {}).value)
        : 0;
    var tipoImovel = (document.getElementById('bemImovelTipo') || {}).value || null;
    if (cep || area > 0 || valorM2 > 0 || tipoImovel) {
      imovelData = {
        cep: cep || null,
        areaM2: area > 0 ? area : null,
        tipoImovel: tipoImovel,
        valorM2: valorM2 > 0 ? valorM2 : null,
        endereco: _enderecoAtualBem(),
      };
    }
  }

  var editId = document.getElementById('bemEditId').value;
  if (editId) {
    editarBem(editId, {
      nome: nome,
      tipo: tipo,
      valorAtual: valorAtual,
      valorCompra: valorCompra,
      dataCompra: dataCompra,
      descricao: descricao,
      fipe: fipeData,
      imovel: imovelData,
    });
    mostrarToast('Bem atualizado.', 'sucesso');
  } else {
    criarBem({
      nome: nome,
      tipo: tipo,
      valorAtual: valorAtual,
      valorCompra: valorCompra,
      dataCompra: dataCompra,
      descricao: descricao,
      fipe: fipeData,
      imovel: imovelData,
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
    '<button class="btn-acao" style="background-color:var(--cor-erro);" onclick="executarExcluirBem(\'' +
    id +
    '\')"><i class="ph ph-trash"></i> Sim, excluir</button>';
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
    if (el) {
      el.innerHTML = '<option value="">— selecione —</option>';
      el.disabled = true;
    }
  });
  var tipo = document.getElementById('bemFipeVeiculoTipo');
  if (tipo) {
    tipo.innerHTML =
      '<option value="">— tipo de veículo —</option>' +
      BEM_VEICULO_TIPOS.map(function (t) {
        return '<option value="' + t.v + '">' + t.label + '</option>';
      }).join('');
    tipo.disabled = false;
  }
  var info = document.getElementById('bemFipeInfo');
  if (info) {
    info.style.display = 'none';
    info.innerHTML = '';
    info.dataset.fipe = '';
  }
}

function bemFipeOnTipoVeiculo() {
  var tipoV = document.getElementById('bemFipeVeiculoTipo').value;
  var marca = document.getElementById('bemFipeMarca');
  var modelo = document.getElementById('bemFipeModelo');
  var ano = document.getElementById('bemFipeAno');
  [marca, modelo, ano].forEach(function (el) {
    if (el) {
      el.innerHTML = '<option value="">— selecione —</option>';
      el.disabled = true;
    }
  });
  if (!tipoV) return;
  marca.innerHTML = '<option value="">Carregando…</option>';
  marca.disabled = true;
  fipeMarcas(tipoV)
    .then(function (list) {
      marca.innerHTML =
        '<option value="">— marca —</option>' +
        list
          .map(function (m) {
            return '<option value="' + m.codigo + '">' + m.nome + '</option>';
          })
          .join('');
      marca.disabled = false;
    })
    .catch(function () {
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
    if (el) {
      el.innerHTML = '<option value="">— selecione —</option>';
      el.disabled = true;
    }
  });
  if (!marcaC) return;
  modelo.innerHTML = '<option value="">Carregando…</option>';
  modelo.disabled = true;
  fipeModelos(tipoV, marcaC)
    .then(function (data) {
      var list = data.modelos || data;
      modelo.innerHTML =
        '<option value="">— modelo —</option>' +
        list
          .map(function (m) {
            return '<option value="' + m.codigo + '">' + m.nome + '</option>';
          })
          .join('');
      modelo.disabled = false;
    })
    .catch(function () {
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
  fipeAnos(tipoV, marcaC, modeloC)
    .then(function (list) {
      anoSel.innerHTML =
        '<option value="">— ano —</option>' +
        list
          .map(function (a) {
            return '<option value="' + a.codigo + '">' + a.nome + '</option>';
          })
          .join('');
      anoSel.disabled = false;
    })
    .catch(function () {
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
  if (info) {
    info.style.display = '';
    info.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Consultando FIPE…';
  }
  fipeValor(tipoV, marcaC, modeloC, anoC)
    .then(function (data) {
      if (info) {
        info.innerHTML =
          '<i class="ph ph-car-simple" style="color:var(--cor-primaria);"></i> ' +
          '<strong>' +
          (data.Modelo || data.modelo || '') +
          '</strong> — ' +
          (data.Valor || data.valor || '') +
          ' <span style="color:var(--cor-texto-mutado);font-size:11px;">(FIPE ' +
          (data.CodigoFipe || data.codigoFipe || '') +
          ' · Ref. ' +
          (data.MesReferencia || data.mesReferencia || '') +
          ')</span>';
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
    })
    .catch(function () {
      if (info) {
        info.innerHTML =
          '<span style="color:var(--cor-erro);"><i class="ph ph-warning"></i> Erro ao consultar FIPE</span>';
      }
      mostrarToast('Não foi possível consultar o valor FIPE.', 'erro');
    });
}

function bemAtualizarFipe(id) {
  var b = obterBem(id);
  if (!b || !b.fipe) return;
  var f = b.fipe;
  fipeValor(f.tipoVeiculo, f.marcaCodigo, f.modeloCodigo, f.anoCodigo)
    .then(function (data) {
      var valorStr = (data.Valor || data.valor || '').replace(/[^\d,]/g, '');
      var valorNum = typeof parseBRL === 'function' ? parseBRL(valorStr) : 0;
      if (valorNum > 0) {
        editarBem(id, {
          valorAtual: valorNum,
          fipe: Object.assign({}, b.fipe, {
            valor: data.Valor || data.valor || '',
            mesReferencia: data.MesReferencia || data.mesReferencia || '',
            ultimaAtualizacao: new Date().toISOString(),
          }),
        });
        renderMeusBens();
        if (typeof renderMeuPatrimonio === 'function') renderMeuPatrimonio(true);
        mostrarToast('Valor FIPE de ' + b.nome + ' atualizado.', 'sucesso');
      }
    })
    .catch(function () {
      mostrarToast('Erro ao atualizar FIPE de ' + b.nome + '.', 'erro');
    });
}

var _fipeAutoEmAndamento = false;
var FIPE_INTERVALO_MS = 24 * 60 * 60 * 1000;

function bemAtualizarFipeAuto() {
  if (_fipeAutoEmAndamento) return;
  var veiculos = bensAtivos().filter(function (b) {
    return b.tipo === 'veiculo' && b.fipe && b.fipe.tipoVeiculo && b.fipe.marcaCodigo;
  });
  var agora = Date.now();
  var pendentes = veiculos.filter(function (b) {
    var ultima = b.fipe.ultimaAtualizacao ? new Date(b.fipe.ultimaAtualizacao).getTime() : 0;
    return agora - ultima > FIPE_INTERVALO_MS;
  });
  if (!pendentes.length) return;
  _fipeAutoEmAndamento = true;
  var atualizados = 0;

  function processar(i) {
    if (i >= pendentes.length) {
      _fipeAutoEmAndamento = false;
      if (atualizados > 0) {
        renderMeusBens();
        if (typeof renderMeuPatrimonio === 'function') renderMeuPatrimonio(true);
        mostrarToast(
          atualizados +
            ' veículo' +
            (atualizados > 1 ? 's' : '') +
            ' atualizado' +
            (atualizados > 1 ? 's' : '') +
            ' pela FIPE.',
          'sucesso'
        );
      }
      return;
    }
    var b = pendentes[i];
    var f = b.fipe;
    fipeValor(f.tipoVeiculo, f.marcaCodigo, f.modeloCodigo, f.anoCodigo)
      .then(function (data) {
        var valorStr = (data.Valor || data.valor || '').replace(/[^\d,]/g, '');
        var valorNum = typeof parseBRL === 'function' ? parseBRL(valorStr) : 0;
        if (valorNum > 0) {
          editarBem(b.id, {
            valorAtual: valorNum,
            fipe: Object.assign({}, b.fipe, {
              valor: data.Valor || data.valor || '',
              mesReferencia: data.MesReferencia || data.mesReferencia || '',
              ultimaAtualizacao: new Date().toISOString(),
            }),
          });
          atualizados++;
        }
      })
      .catch(function () {})
      .then(function () {
        processar(i + 1);
      });
  }
  processar(0);
}

// ============================================================
// === UI — RENDERIZAÇÃO DA LISTA                            ===
// ============================================================

function renderMeusBens() {
  var wrap = document.getElementById('listaBens');
  if (!wrap) return;

  var ativos = bensAtivos();
  var arquivados = bens.filter(function (b) {
    return b.arquivado;
  });
  var todos = ativos.concat(arquivados);

  if (!todos.length) {
    wrap.innerHTML =
      '<div class="mp-empty"><i class="ph ph-package"></i>Nenhum bem cadastrado.</div>';
    return;
  }

  var fmt =
    typeof formatarMoeda === 'function'
      ? formatarMoeda
      : function (v) {
          return 'R$ ' + v.toFixed(2);
        };
  var iconMap = {};
  BEM_TIPOS.forEach(function (t) {
    iconMap[t.v] = t.icon;
  });

  wrap.innerHTML = todos
    .map(function (b) {
      var arq = b.arquivado;
      var icon = iconMap[b.tipo] || 'ph-package';
      var valorTxt = b.valorAtual ? fmt(b.valorAtual) : '—';
      var fipeBadge = '';
      if (b.fipe && b.fipe.codigoFipe) {
        fipeBadge =
          '<span class="mp-mov-tipo receita" style="font-size:9px;cursor:pointer;" onclick="bemAtualizarFipe(\'' +
          b.id +
          '\')" title="Clique para atualizar o valor FIPE">' +
          '<i class="ph ph-arrows-clockwise"></i> FIPE ' +
          (b.fipe.mesReferencia || '') +
          '</span>';
      }
      // Linha de contexto do imóvel: área, tipo e bairro/cidade. Cabe na mesma
      // linha da descrição — sem card novo na página.
      var linhas = [];
      if (b.descricao) linhas.push(b.descricao);
      if (b.tipo === 'imovel' && b.imovel) {
        var det = [];
        if (b.imovel.areaM2) det.push(b.imovel.areaM2.toLocaleString('pt-BR') + ' m²');
        var rotuloTipo = (
          BEM_IMOVEL_TIPOS.filter(function (t) {
            return t.v === b.imovel.tipoImovel;
          })[0] || {}
        ).label;
        if (rotuloTipo) det.push(rotuloTipo);
        var end = b.imovel.endereco;
        if (end && (end.bairro || end.cidade)) {
          det.push([end.bairro, end.cidade].filter(Boolean).join(', '));
        }
        if (det.length) linhas.push(det.join(' · '));
      }
      var descTxt = linhas.length
        ? '<span class="mp-inst-sub" style="text-align:left;">' + linhas.join(' — ') + '</span>'
        : '';
      var acoes = arq
        ? '<button class="btn-secundario" style="padding:3px 8px;font-size:11px;" onclick="editarBem(\'' +
          b.id +
          '\',{arquivado:false});renderMeusBens();" title="Restaurar"><i class="ph ph-arrow-counter-clockwise"></i></button>'
        : '<button class="btn-secundario" style="padding:3px 8px;font-size:11px;" onclick="editarBemForm(\'' +
          b.id +
          '\')" title="Editar"><i class="ph ph-pencil-simple"></i></button>' +
          '<button class="btn-secundario" style="padding:3px 8px;font-size:11px;" onclick="confirmarExcluirBem(\'' +
          b.id +
          '\')" title="Excluir"><i class="ph ph-trash" style="color:var(--cor-erro);"></i></button>';

      return (
        '<div class="mp-inst-item' +
        (arq ? ' mp-arq' : '') +
        '" style="' +
        (arq ? 'opacity:.5;' : '') +
        '">' +
        '<div style="min-width:0;display:flex;align-items:center;gap:9px;">' +
        '<i class="ph-fill ' +
        icon +
        '" style="font-size:20px;color:var(--cor-texto-mutado);flex-shrink:0;"></i>' +
        '<div style="min-width:0;">' +
        '<span class="mp-inst-nome">' +
        b.nome +
        (arq
          ? ' <span style="font-size:10px;color:var(--cor-texto-mutado);">(arquivado)</span>'
          : '') +
        '</span>' +
        descTxt +
        (fipeBadge ? '<div style="margin-top:3px;">' + fipeBadge + '</div>' : '') +
        '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
        '<span class="mp-inst-valor valor-mascarado">' +
        valorTxt +
        '</span>' +
        acoes +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}
