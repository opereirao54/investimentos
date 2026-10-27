/**
 * Appliquei — IMPORTAR FATURA: a TELA. A regra mora em
 * appliquei-importar-fatura.js; aqui só se desenha o plano e se recolhe a
 * decisão do usuário. Análise: docs/IMPORTAR-FATURA.md.
 *
 * Três passos no mesmo painel (#telaImportarFatura, por cima das Faturas):
 *   inicio   como pegar o arquivo no Nubank + escolher o arquivo
 *   revisao  cada linha com status, categoria e marcação; totais no rodapé
 *   feito    o que entrou, com Desfazer
 *
 * Nada é gravado antes de "Importar" (G1): a revisão só mexe no plano em
 * memória. A gravação é uma só, com salvarTransacoes({ flush: true }).
 *
 * Top-level só com `var`/`function` (classic script).
 */

var IMPFAT_CHAVE_REGISTROS = 'appliquei_importacoes_fatura';
var impfatUi = {
  passo: 'inicio',
  cartaoId: null,
  arquivoNome: '',
  arquivo: null,
  vencimento: '',
  plano: null,
  erro: '',
  registro: null,
  salvarDiaCartao: false,
};

function _impEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _impMoeda(v) {
  return typeof formatarMoeda === 'function' ? formatarMoeda(v) : AppliqueiImportarFatura.moeda(v);
}

function impfatLerRegistros() {
  try {
    var arr = JSON.parse(localStorage.getItem(IMPFAT_CHAVE_REGISTROS) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function impfatGravarRegistros(arr) {
  try {
    // Os 50 mais recentes bastam para o aviso de "já importada" e o Desfazer.
    localStorage.setItem(IMPFAT_CHAVE_REGISTROS, JSON.stringify(arr.slice(-50)));
  } catch (e) {
    if (window.console) console.error('[importar-fatura] registros', e);
  }
}

function _impCartoes() {
  return typeof cartoesAtivos === 'function' ? cartoesAtivos() : [];
}

function _impCartao(id) {
  return _impCartoes().find(function (c) {
    return c.id === id;
  });
}

function abrirImportarFatura(cartaoId) {
  impfatUi.passo = 'inicio';
  impfatUi.cartaoId = cartaoId || (_impCartoes()[0] || {}).id || null;
  impfatUi.arquivo = null;
  impfatUi.arquivoNome = '';
  impfatUi.plano = null;
  impfatUi.erro = '';
  impfatUi.registro = null;
  var el = document.getElementById('telaImportarFatura');
  if (!el) return;
  el.style.display = 'flex';
  renderizarImportarFatura();
}

function fecharImportarFatura() {
  var el = document.getElementById('telaImportarFatura');
  if (el) el.style.display = 'none';
  impfatUi.plano = null;
  impfatUi.arquivo = null;
}

function impfatUiEscolherArquivo() {
  var inp = document.getElementById('impfatArquivo');
  if (!inp) return;
  inp.value = '';
  inp.click();
}

function impfatUiArquivoSelecionado(input) {
  var f = input && input.files && input.files[0];
  if (!f) return;
  impfatUi.erro = '';
  if (f.size > AppliqueiImportarFatura.LIMITES.bytes) {
    impfatUi.erro = AppliqueiImportarFatura.MENSAGENS.grande;
    renderizarImportarFatura();
    return;
  }
  var leitor = new FileReader();
  leitor.onerror = function () {
    impfatUi.erro = 'Não foi possível ler o arquivo. Tente escolher de novo.';
    renderizarImportarFatura();
  };
  leitor.onload = function () {
    try {
      var arq = AppliqueiImportarFatura.lerArquivo(new Uint8Array(leitor.result), f.name);
      impfatUi.arquivo = arq;
      impfatUi.arquivoNome = f.name;
      var cartao = _impCartao(impfatUi.cartaoId);
      impfatUi.vencimento =
        arq.vencimentoArquivo ||
        AppliqueiImportarFatura.adivinharVencimento(arq.linhas, cartao && cartao.diaVencimento) ||
        '';
      impfatUi.passo = 'revisao';
      impfatUiReplanejar();
    } catch (e) {
      impfatUi.erro = (e && e.codigo && e.message) || AppliqueiImportarFatura.MENSAGENS.formato;
      if (!(e && e.codigo) && window.console) console.error('[importar-fatura]', e);
      renderizarImportarFatura();
    }
  };
  leitor.readAsArrayBuffer(f);
}

function impfatUiReplanejar() {
  impfatUi.plano = null;
  if (impfatUi.arquivo && impfatUi.vencimento && impfatUi.cartaoId) {
    impfatUi.plano = AppliqueiImportarFatura.planejar({
      arquivo: impfatUi.arquivo,
      vencimento: impfatUi.vencimento,
      cartaoId: impfatUi.cartaoId,
      transacoes: typeof transacoes !== 'undefined' ? transacoes : [],
      categorias: typeof obterCategoriasDespesa === 'function' ? obterCategoriasDespesa() : [],
      insights: window.AppliqueiInsights || null,
      palavras: window.AppliqueiCategoriasPalavras || null,
      faturasImportadas: impfatLerRegistros()
        .filter(function (r) {
          return r && r.cartaoId === impfatUi.cartaoId;
        })
        .map(function (r) {
          return r.vencimento;
        }),
    });
    // F3: cartão sem dia de vencimento aprende o do arquivo; com outro dia,
    // só se o usuário marcar.
    var cartao = _impCartao(impfatUi.cartaoId);
    var dia = +impfatUi.vencimento.slice(8, 10);
    impfatUi.salvarDiaCartao = !!cartao && !cartao.diaVencimento && !!dia;
  }
  renderizarImportarFatura();
}

function impfatUiMudarVencimento(v) {
  impfatUi.vencimento = AppliqueiImportarFatura.data(v) || '';
  impfatUiReplanejar();
}

function impfatUiMudarCartao(id) {
  impfatUi.cartaoId = id;
  impfatUiReplanejar();
}

function _impItem(ref) {
  return impfatUi.plano
    ? impfatUi.plano.itens.find(function (it) {
        return String(it.ref) === String(ref);
      })
    : null;
}

function impfatUiMarcar(ref, marcado) {
  var it = _impItem(ref);
  if (!it) return;
  it.marcado = !!marcado;
  renderizarImportarFatura();
}

function impfatUiCategoria(ref, v) {
  var it = _impItem(ref);
  if (!it) return;
  it.categoriaDespesa = v || null;
  it.origemCategoria = v ? 'usuario' : null;
  _impRenderRodape();
}

function impfatUiSalvarDia(v) {
  impfatUi.salvarDiaCartao = !!v;
}

function impfatUiConfirmar() {
  var plano = impfatUi.plano;
  if (!plano) return;
  var res = AppliqueiImportarFatura.resumo(plano);
  var mexe = plano.itens.some(function (it) {
    return (
      AppliqueiImportarFatura.entra(it) ||
      ((it.status === 'outra_fatura' || it.status === 'reajuste') && it.marcado)
    );
  });
  if (!mexe) {
    if (typeof mostrarToast === 'function')
      mostrarToast('Nada marcado para importar: tudo já está no app.', 'info');
    return;
  }
  // Uma escrita só (G1): novos + alterações em memória, depois um salvamento.
  var r = AppliqueiImportarFatura.confirmar(transacoes, plano, {
    agora: new Date(),
    arquivo: impfatUi.arquivoNome,
  });
  if (typeof salvarTransacoes === 'function' && !salvarTransacoes({ flush: true })) return;
  var regs = impfatLerRegistros();
  regs.push(r.registro);
  impfatGravarRegistros(regs);

  var cartao = _impCartao(plano.cartaoId);
  var dia = +plano.vencimento.slice(8, 10);
  if (impfatUi.salvarDiaCartao && cartao && dia && typeof salvarCartoes === 'function') {
    cartao.diaVencimento = dia;
    salvarCartoes();
  }

  impfatUi.registro = r.registro;
  impfatUi.resultado = {
    compras: res.qtdNovas,
    lancamentos: r.novos.length,
    jaLancadas: res.qtdJaLancadas,
    alteracoes: r.alteracoes.length,
  };
  impfatUi.passo = 'feito';
  impfatUiAtualizarTelas(plano.cartaoId, plano.vencimento);
  renderizarImportarFatura();
}

function impfatUiDesfazer() {
  var reg = impfatUi.registro;
  if (!reg) return;
  var r = AppliqueiImportarFatura.desfazer(transacoes, reg);
  transacoes.length = 0;
  r.transacoes.forEach(function (t) {
    transacoes.push(t);
  });
  if (typeof salvarTransacoes === 'function') salvarTransacoes({ flush: true });
  impfatGravarRegistros(
    impfatLerRegistros().filter(function (x) {
      return x && x.id !== reg.id;
    })
  );
  impfatUiAtualizarTelas(reg.cartaoId, reg.vencimento);
  if (typeof mostrarToast === 'function') {
    mostrarToast(
      'Importação desfeita: ' +
        r.removidos +
        ' lançamento(s) removido(s).' +
        (r.mantidosPagos ? ' ' + r.mantidosPagos + ' já pago(s) ficaram.' : ''),
      'sucesso',
      5000
    );
  }
  fecharImportarFatura();
}

function impfatUiAtualizarTelas(cartaoId, vencimento) {
  try {
    if (typeof atualizarTelaControle === 'function') atualizarTelaControle();
  } catch (e) {}
  try {
    var fat = document.getElementById('telaFaturas');
    if (fat && fat.style.display !== 'none' && typeof faturasEstado !== 'undefined') {
      faturasEstado.cartaoId = cartaoId;
      faturasEstado.vencimento = vencimento;
      if (typeof renderizarFaturas === 'function') renderizarFaturas();
    }
  } catch (e) {}
}

// ════════════════════════════════════════════════════════════
// DESENHO
// ════════════════════════════════════════════════════════════

var IMPFAT_STATUS_UI = {
  nova: { rotulo: 'Nova', classe: 'nova' },
  ja_lancada: { rotulo: 'Já no app', classe: 'ja' },
  parecida: { rotulo: 'Parecida', classe: 'atencao' },
  conflito: { rotulo: 'Confira', classe: 'atencao' },
  outra_fatura: { rotulo: 'Em outra fatura', classe: 'atencao' },
  reajuste: { rotulo: 'Preço novo', classe: 'atencao' },
  anulada: { rotulo: 'Estornada', classe: 'fora' },
  credito_fora: { rotulo: 'Crédito', classe: 'fora' },
  ignorada: { rotulo: 'Não é compra', classe: 'fora' },
  erro: { rotulo: 'Ilegível', classe: 'fora' },
};

function renderizarImportarFatura() {
  var corpo = document.getElementById('impfatCorpo');
  if (!corpo) return;
  if (impfatUi.passo === 'feito') corpo.innerHTML = _impHtmlFeito();
  else if (impfatUi.passo === 'revisao') corpo.innerHTML = _impHtmlRevisao();
  else corpo.innerHTML = _impHtmlInicio();
  _impRenderRodape();
}

function _impHtmlInicio() {
  return (
    '<div class="imp-passos">' +
    '<p class="imp-intro">Traga as compras da fatura fechada do Nubank de uma vez. Você revisa tudo antes de entrar.</p>' +
    '<ol class="imp-como">' +
    '<li><strong>No app do Nubank:</strong> cartão → <em>Resumo de faturas</em> → escolha a fatura fechada → <em>Enviar por e-mail</em> (OFX ou CSV).</li>' +
    '<li><strong>No celular:</strong> abra o e-mail, toque no anexo e salve em <em>Arquivos</em> (iPhone) ou <em>Downloads</em> (Android).</li>' +
    '<li>Volte aqui e escolha o arquivo.</li>' +
    '</ol>' +
    (impfatUi.erro
      ? '<div class="imp-erro" role="alert"><i class="ph-fill ph-warning-circle" aria-hidden="true"></i> ' +
        _impEsc(impfatUi.erro) +
        '</div>'
      : '') +
    '<button type="button" class="btn-acao imp-escolher" onclick="impfatUiEscolherArquivo()"><i class="ph ph-file-arrow-up" aria-hidden="true"></i> Escolher o arquivo da fatura</button>' +
    '<p class="imp-privado"><i class="ph ph-lock-key" aria-hidden="true"></i> O arquivo é lido aqui no seu aparelho e não é enviado a ninguém.</p>' +
    '</div>'
  );
}

function _impOpcoesCartao() {
  return _impCartoes()
    .map(function (c) {
      return (
        '<option value="' +
        _impEsc(c.id) +
        '"' +
        (c.id === impfatUi.cartaoId ? ' selected' : '') +
        '>' +
        _impEsc(c.nome || 'Cartão') +
        '</option>'
      );
    })
    .join('');
}

function _impSelectCategoria(it) {
  var cats = typeof obterCategoriasDespesa === 'function' ? obterCategoriasDespesa() : [];
  return (
    '<select class="imp-cat' +
    (it.categoriaDespesa ? '' : ' vazia') +
    '" aria-label="Categoria de ' +
    _impEsc(it.descricao) +
    '" onchange="impfatUiCategoria(\'' +
    it.ref +
    '\', this.value)"><option value="">Sem categoria</option>' +
    cats
      .map(function (c) {
        return (
          '<option value="' +
          _impEsc(c.v) +
          '"' +
          (c.v === it.categoriaDespesa ? ' selected' : '') +
          '>' +
          _impEsc(c.label) +
          '</option>'
        );
      })
      .join('') +
    '</select>'
  );
}

function _impHtmlItem(it) {
  var st = IMPFAT_STATUS_UI[it.status] || { rotulo: it.status, classe: 'fora' };
  var marcavel =
    ['nova', 'parecida', 'conflito', 'outra_fatura', 'reajuste'].indexOf(it.status) !== -1;
  var entra = it.status === 'nova' || it.status === 'parecida' || it.status === 'conflito';
  var rotuloCheck =
    it.status === 'outra_fatura'
      ? 'Mover para esta fatura'
      : it.status === 'reajuste'
        ? 'Atualizar o valor'
        : it.status === 'nova'
          ? 'Importar'
          : 'Importar mesmo assim';
  var parc = it.parcela
    ? ' <span class="imp-parc">' + it.parcela.n + '/' + it.parcela.m + '</span>'
    : '';
  return (
    '<div class="imp-item st-' +
    st.classe +
    (it.marcado ? ' on' : '') +
    '">' +
    '<div class="imp-item-linha">' +
    (marcavel
      ? '<input type="checkbox" class="imp-check" aria-label="' +
        _impEsc(rotuloCheck + ': ' + it.descricao) +
        '"' +
        (it.marcado ? ' checked' : '') +
        ' onchange="impfatUiMarcar(\'' +
        it.ref +
        '\', this.checked)">'
      : '<span class="imp-check-vazio" aria-hidden="true"></span>') +
    '<div class="imp-item-corpo"><span class="imp-item-desc">' +
    _impEsc(it.descricao) +
    parc +
    '</span><span class="imp-item-sub">' +
    (it.data ? AppliqueiImportarFatura.rotuloDia(it.data) + ' · ' : '') +
    '<span class="imp-chip">' +
    st.rotulo +
    '</span>' +
    (it.titulo && it.titulo !== it.descricao ? ' · ' + _impEsc(it.titulo) : '') +
    '</span></div>' +
    '<span class="imp-item-valor valor-mascarado">' +
    _impMoeda(it.valor) +
    '</span></div>' +
    (it.motivo ? '<p class="imp-motivo">' + _impEsc(it.motivo) + '</p>' : '') +
    (it.aviso ? '<p class="imp-aviso">' + _impEsc(it.aviso) + '</p>' : '') +
    (entra && it.marcado ? _impSelectCategoria(it) : '') +
    '</div>'
  );
}

function _impGrupo(titulo, itens, aberto, chave) {
  if (!itens.length) return '';
  var html = itens.map(_impHtmlItem).join('');
  if (aberto)
    return (
      '<section class="imp-grupo" data-grupo="' +
      chave +
      '"><h3>' +
      titulo +
      ' <span>' +
      itens.length +
      '</span></h3>' +
      html +
      '</section>'
    );
  return (
    '<details class="imp-grupo" data-grupo="' +
    chave +
    '"><summary>' +
    titulo +
    ' <span>' +
    itens.length +
    '</span></summary>' +
    html +
    '</details>'
  );
}

function _impHtmlRevisao() {
  var p = impfatUi.plano;
  var cab =
    '<div class="imp-cab">' +
    '<div class="imp-arquivo"><i class="ph ph-file-text" aria-hidden="true"></i> ' +
    _impEsc(impfatUi.arquivoNome) +
    ' <button type="button" class="imp-trocar" onclick="impfatUiEscolherArquivo()">Trocar</button></div>' +
    '<div class="imp-campos">' +
    '<label>Cartão no app<select onchange="impfatUiMudarCartao(this.value)">' +
    _impOpcoesCartao() +
    '</select></label>' +
    '<label>Vencimento da fatura<input type="date" value="' +
    _impEsc(impfatUi.vencimento) +
    '" onchange="impfatUiMudarVencimento(this.value)"></label>' +
    '</div>';
  if (!p) {
    return (
      cab +
      '<div class="imp-erro" role="alert">Informe o vencimento desta fatura (está no app do Nubank, no topo da fatura).</div></div>'
    );
  }
  var cartao = _impCartao(p.cartaoId);
  var dia = +p.vencimento.slice(8, 10);
  if (cartao && dia && +cartao.diaVencimento !== dia) {
    cab +=
      '<label class="imp-dia"><input type="checkbox"' +
      (impfatUi.salvarDiaCartao ? ' checked' : '') +
      ' onchange="impfatUiSalvarDia(this.checked)"> Guardar o dia ' +
      dia +
      ' como vencimento do cartão ' +
      _impEsc(cartao.nome || '') +
      (cartao.diaVencimento ? ' (hoje está dia ' + cartao.diaVencimento + ')' : '') +
      '</label>';
  }
  var ja = AppliqueiImportarFatura.jaImportada(impfatLerRegistros(), p.cartaoId, p.vencimento);
  if (ja) {
    cab +=
      '<div class="imp-aviso-topo"><i class="ph-fill ph-info" aria-hidden="true"></i> Esta fatura já foi importada em ' +
      AppliqueiImportarFatura.rotuloDia(String(ja.em).slice(0, 10)) +
      '. O que já entrou aparece como "Já no app".</div>';
  }
  if (p.banco !== 'nubank') {
    cab +=
      '<div class="imp-aviso-topo"><i class="ph-fill ph-warning" aria-hidden="true"></i> Este arquivo não parece do Nubank. Confira a revisão com atenção.</div>';
  }
  cab += '</div>';

  var atencao = [];
  var novas = [];
  var ja2 = [];
  var fora = [];
  p.itens.forEach(function (it) {
    if (['parecida', 'conflito', 'outra_fatura', 'reajuste'].indexOf(it.status) !== -1 || it.aviso)
      atencao.push(it);
    else if (it.status === 'nova' && !it.categoriaDespesa) atencao.push(it);
    else if (it.status === 'nova') novas.push(it);
    else if (it.status === 'ja_lancada') ja2.push(it);
    else fora.push(it);
  });
  return (
    cab +
    _impGrupo('Precisa da sua atenção', atencao, true, 'atencao') +
    _impGrupo('Novas', novas, true, 'novas') +
    _impGrupo('Já estão no app', ja2, false, 'ja') +
    _impGrupo('Não entram', fora, false, 'fora')
  );
}

function _impHtmlFeito() {
  var r = impfatUi.resultado || {};
  return (
    '<div class="imp-feito">' +
    '<i class="ph-fill ph-check-circle" aria-hidden="true"></i>' +
    '<strong>' +
    r.compras +
    ' compra(s) importada(s)</strong>' +
    '<span>' +
    r.lancamentos +
    ' lançamento(s) no total, contando as parcelas futuras.' +
    (r.jaLancadas ? ' ' + r.jaLancadas + ' já estavam no app.' : '') +
    (r.alteracoes ? ' ' + r.alteracoes + ' lançamento(s) ajustado(s).' : '') +
    '</span>' +
    '<p>Tudo entrou como a pagar. Quando pagar a fatura, use "Marcar como paga".</p>' +
    '</div>'
  );
}

function _impRenderRodape() {
  var rod = document.getElementById('impfatRodape');
  if (!rod) return;
  if (impfatUi.passo === 'feito') {
    rod.innerHTML =
      '<button type="button" class="btn-secundario" onclick="impfatUiDesfazer()"><i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i> Desfazer importação</button>' +
      '<button type="button" class="btn-acao" onclick="fecharImportarFatura()">Ver a fatura</button>';
    return;
  }
  if (impfatUi.passo !== 'revisao' || !impfatUi.plano) {
    rod.innerHTML =
      '<button type="button" class="btn-secundario" onclick="fecharImportarFatura()">Cancelar</button>';
    return;
  }
  var res = AppliqueiImportarFatura.resumo(impfatUi.plano);
  var bate = Math.abs(res.diferenca) < 0.01;
  // O motor explica a diferença motivo a motivo, e a soma fecha (resumo.porque).
  var explica = '';
  if (!bate && res.porque.length) {
    explica =
      '<span class="imp-dif-porque">Diferença: ' +
      res.porque
        .map(function (m) {
          return (
            m.qtd +
            ' ' +
            _impEsc(m.rotulo) +
            ' (' +
            (m.valor > 0 ? '+' : '−') +
            _impMoeda(Math.abs(m.valor)) +
            ')'
          );
        })
        .join('; ') +
      '.</span>';
  }
  rod.innerHTML =
    '<div class="imp-totais">' +
    '<div><span>Total do Nubank</span><strong class="valor-mascarado">' +
    _impMoeda(res.totalBanco) +
    '</strong></div>' +
    '<div><span>No app, depois de importar</span><strong class="valor-mascarado' +
    (bate ? ' bate' : ' nao-bate') +
    '">' +
    _impMoeda(res.appDepois) +
    '</strong></div>' +
    explica +
    '</div>' +
    '<div class="imp-botoes">' +
    '<button type="button" class="btn-secundario" onclick="fecharImportarFatura()">Cancelar</button>' +
    '<button type="button" class="btn-acao" onclick="impfatUiConfirmar()"' +
    (res.qtdNovas ||
    impfatUi.plano.itens.some(function (it) {
      return (it.status === 'outra_fatura' || it.status === 'reajuste') && it.marcado;
    })
      ? ''
      : ' disabled') +
    '><i class="ph-bold ph-check" aria-hidden="true"></i> Importar ' +
    res.qtdNovas +
    ' compra(s)</button>' +
    '</div>';
}
