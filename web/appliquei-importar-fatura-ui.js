/**
 * Appliquei — IMPORTAR FATURA: a TELA. A regra mora em
 * appliquei-importar-fatura.js; aqui só se desenha o plano e se recolhe a
 * decisão do usuário. Análise: docs/IMPORTAR-FATURA.md.
 *
 * Três passos no mesmo painel (#telaImportarFatura, por cima das Faturas):
 *   inicio   escolher o arquivo (com o "como pegar no Nubank" completo só na
 *            primeira vez; depois, recolhido)
 *   revisao  1) "Decida antes de importar": só o que pede decisão, cada uma
 *               com as DUAS opções escritas por extenso (nada de caixinha
 *               que muda de sentido conforme a linha);
 *            2) compras novas em linhas compactas, categoria numa etiqueta;
 *            3) já no app / não entram, recolhidos;
 *            rodapé: total do banco × total do app, o porquê da diferença e
 *            quantas parcelas vão para as próximas faturas.
 *   feito    como ficou a fatura, com Desfazer
 *
 * Nada é gravado antes de "Importar" (G1). Desfazer também fica na tela da
 * fatura enquanto nada daquela importação foi pago.
 *
 * Android: o app aparece no menu "Compartilhar" do anexo do e-mail
 * (share_target no manifest + web/sw-compartilhar.js); o arquivo chega aqui
 * por impfatReceberCompartilhado().
 *
 * Top-level só com `var`/`function` (classic script).
 */

var IMPFAT_CHAVE_REGISTROS = 'appliquei_importacoes_fatura';
// Por aparelho (não sincroniza): só decide se as instruções vêm abertas.
var IMPFAT_CHAVE_JA_USOU = 'ui_impfat_ja_usou';
var IMPFAT_CACHE_COMPARTILHADO = 'appliquei-fatura-compartilhada';
var IMPFAT_URL_COMPARTILHADO = '/web/fatura-compartilhada';

var impfatUi = {
  passo: 'inicio',
  cartaoId: null,
  arquivoNome: '',
  arquivo: null,
  vencimento: '',
  plano: null,
  erro: '',
  registro: null,
  resultado: null,
  salvarDiaCartao: false,
  desfazerPendente: null,
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

var IMPFAT_MESES_CURTOS = [
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

/** '2027-05-05' → 'mai/27' */
function _impMesCurto(ymd) {
  if (!ymd) return '';
  var p = String(ymd).split('-');
  return IMPFAT_MESES_CURTOS[+p[1] - 1] + '/' + p[0].slice(2);
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

function _impJaUsou() {
  try {
    return localStorage.getItem(IMPFAT_CHAVE_JA_USOU) === '1';
  } catch (e) {
    return false;
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
  impfatUi.resultado = null;
  var el = document.getElementById('telaImportarFatura');
  if (!el) return;
  el.style.display = 'flex';
  renderizarImportarFatura();
}

/** Atalho do formulário "Novo lançamento" (cartão escolhido, se houver). */
function abrirImportarFaturaDoLancamento() {
  var sel = document.getElementById('selectCartao');
  abrirImportarFatura(sel && sel.value && sel.value !== '__novo__' ? sel.value : null);
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
    impfatUiProcessarBytes(new Uint8Array(leitor.result), f.name);
  };
  leitor.readAsArrayBuffer(f);
}

/** Bytes do arquivo (escolhido ou compartilhado) → revisão, ou erro claro. */
function impfatUiProcessarBytes(bytes, nome) {
  try {
    var arq = AppliqueiImportarFatura.lerArquivo(bytes, nome);
    impfatUi.arquivo = arq;
    impfatUi.arquivoNome = nome || 'fatura';
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
    impfatUi.passo = 'inicio';
    renderizarImportarFatura();
  }
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

function impfatUiMarcarTodas(marcado) {
  if (!impfatUi.plano) return;
  impfatUi.plano.itens.forEach(function (it) {
    if (it.status === 'nova') it.marcado = !!marcado;
  });
  renderizarImportarFatura();
}

function impfatUiEscolha(ref, escolha) {
  var it = _impItem(ref);
  if (!it) return;
  it.escolha = escolha;
  renderizarImportarFatura();
}

function impfatUiCategoria(ref, v) {
  var it = _impItem(ref);
  if (!it) return;
  it.categoriaDespesa = v || null;
  it.origemCategoria = v ? 'usuario' : null;
  // A mesma loja noutras linhas desta fatura vai junto (escolher uma vez só).
  var outras = v ? AppliqueiImportarFatura.propagarCategoria(impfatUi.plano, ref) : 0;
  if (outras) renderizarImportarFatura();
  else _impRenderRodape();
}

function impfatUiSalvarDia(v) {
  impfatUi.salvarDiaCartao = !!v;
}

/** A importação muda alguma coisa no app? (senão o botão fica desligado) */
function _impMexe(plano) {
  return plano.itens.some(function (it) {
    if (AppliqueiImportarFatura.entra(it)) return true;
    if (it.status === 'outra_fatura' && it.escolha === 'mover') return true;
    if (it.status === 'reajuste' && it.escolha === 'atualizar') return true;
    if (it.status === 'anulada' && it.escolha === 'apagar') return true;
    return it.status === 'parecida' && it.escolha === 'mesma';
  });
}

function impfatUiConfirmar() {
  var plano = impfatUi.plano;
  if (!plano) return;
  var res = AppliqueiImportarFatura.resumo(plano);
  if (!_impMexe(plano)) {
    if (typeof mostrarToast === 'function')
      mostrarToast('Nada a importar: tudo já está no app.', 'info');
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
  try {
    localStorage.setItem(IMPFAT_CHAVE_JA_USOU, '1');
  } catch (e) {}

  var cartao = _impCartao(plano.cartaoId);
  var dia = +plano.vencimento.slice(8, 10);
  if (impfatUi.salvarDiaCartao && cartao && dia && typeof salvarCartoes === 'function') {
    cartao.diaVencimento = dia;
    salvarCartoes();
  }

  impfatUi.registro = r.registro;
  impfatUi.resultado = {
    compras: res.qtdNovas,
    futuras: res.parcelasFuturas,
    ate: res.ateVencimento,
    jaLancadas: res.qtdJaLancadas,
    ajustes: r.alteracoes.length + r.removidos.length,
    totalBanco: res.totalBanco,
    totalApp: res.appDepois,
    porque: res.porque,
    semCategoria: plano.itens.filter(function (it) {
      return AppliqueiImportarFatura.entra(it) && !it.categoriaDespesa;
    }).length,
    vencimento: plano.vencimento,
  };
  impfatUi.passo = 'feito';
  impfatUiAtualizarTelas(plano.cartaoId, plano.vencimento);
  renderizarImportarFatura();
}

/** Desfaz um registro de importação (da tela final ou da tela da fatura). */
function _impDesfazerRegistro(reg) {
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
  return r;
}

function impfatUiDesfazer() {
  if (!impfatUi.registro) return;
  _impDesfazerRegistro(impfatUi.registro);
  fecharImportarFatura();
}

/**
 * O registro de importação desta fatura que ainda dá para desfazer: algum
 * lançamento que ele criou continua lá e ninguém pagou nada dele.
 */
function impfatRegistroDesfazivel(cartaoId, vencimento) {
  var regs = impfatLerRegistros().filter(function (r) {
    return r && r.cartaoId === cartaoId && r.vencimento === vencimento;
  });
  for (var i = regs.length - 1; i >= 0; i--) {
    var reg = regs[i];
    var deles = (typeof transacoes !== 'undefined' ? transacoes : []).filter(function (t) {
      return t.importacao && t.importacao.id === reg.id;
    });
    if (
      deles.length &&
      !deles.some(function (t) {
        return t.pago;
      })
    ) {
      return { registro: reg, qtd: deles.length };
    }
  }
  return null;
}

/** Faturas: "Desfazer" pede confirmação na própria linha antes de agir. */
function impfatUiPedirDesfazer(id) {
  impfatUi.desfazerPendente = id || null;
  if (typeof renderizarFaturas === 'function') renderizarFaturas();
}

function impfatUiDesfazerDaFatura(id) {
  var reg = impfatLerRegistros().find(function (r) {
    return r && r.id === id;
  });
  impfatUi.desfazerPendente = null;
  if (reg) _impDesfazerRegistro(reg);
  else if (typeof renderizarFaturas === 'function') renderizarFaturas();
}

/** HTML da linha "Importada em … · Desfazer" para a tela da fatura. */
function impfatHtmlLinhaImportada(cartaoId, vencimento) {
  var d = impfatRegistroDesfazivel(cartaoId, vencimento);
  if (!d) return '';
  var reg = d.registro;
  var quando = AppliqueiImportarFatura.rotuloDia(String(reg.em).slice(0, 10));
  if (impfatUi.desfazerPendente === reg.id) {
    return (
      '<div class="fat-importada pendente" role="alert"><span>Apagar os ' +
      d.qtd +
      ' lançamento(s) que vieram do arquivo e voltar o que a importação mudou?</span>' +
      '<div class="fat-importada-botoes"><button type="button" class="btn-secundario" onclick="impfatUiPedirDesfazer(null)">Cancelar</button>' +
      '<button type="button" class="btn-acao" onclick="impfatUiDesfazerDaFatura(\'' +
      _impEsc(reg.id) +
      '\')">Desfazer importação</button></div></div>'
    );
  }
  return (
    '<div class="fat-importada"><i class="ph ph-file-arrow-up" aria-hidden="true"></i><span>Importada do arquivo em ' +
    quando +
    '</span><button type="button" class="fat-desfazer" onclick="impfatUiPedirDesfazer(\'' +
    _impEsc(reg.id) +
    '\')">Desfazer</button></div>'
  );
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

/** "Ver a fatura": fecha a importação e mostra a fatura importada. */
function impfatUiVerFatura() {
  var reg = impfatUi.registro;
  fecharImportarFatura();
  if (reg && typeof abrirFaturas === 'function') abrirFaturas(reg.cartaoId, reg.vencimento);
}

// ════════════════════════════════════════════════════════════
// COMPARTILHAR (Android): o arquivo chega pelo service worker
// ════════════════════════════════════════════════════════════

function impfatRegistrarCompartilhar() {
  try {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    // Escopo /web/: o service worker só recebe o arquivo compartilhado; não
    // controla as páginas do app nem guarda cache delas.
    navigator.serviceWorker
      .register('/web/sw-compartilhar.js', { scope: '/web/' })
      .catch(function () {});
  } catch (e) {}
}

/** /app?importar=compartilhado → abre a revisão com o arquivo compartilhado. */
function impfatReceberCompartilhado(tentativas) {
  try {
    if (!/[?&]importar=compartilhado\b/.test(window.location.search)) return;
    if (!window.caches) return;
    var pronto =
      typeof transacoes !== 'undefined' &&
      document.getElementById('telaImportarFatura') &&
      _impCartoes().length;
    if (!pronto) {
      // O app ainda está carregando os dados (login, nuvem): tenta de novo.
      if ((tentativas || 0) < 40) {
        setTimeout(function () {
          impfatReceberCompartilhado((tentativas || 0) + 1);
        }, 500);
      }
      return;
    }
    try {
      history.replaceState(null, '', window.location.pathname);
    } catch (e) {}
    caches.open(IMPFAT_CACHE_COMPARTILHADO).then(function (cache) {
      return cache.match(IMPFAT_URL_COMPARTILHADO).then(function (resp) {
        if (!resp) return;
        var nome = decodeURIComponent(resp.headers.get('X-Nome-Arquivo') || 'fatura');
        return resp.arrayBuffer().then(function (buf) {
          cache.delete(IMPFAT_URL_COMPARTILHADO);
          abrirImportarFatura(null);
          impfatUiProcessarBytes(new Uint8Array(buf), nome);
        });
      });
    });
  } catch (e) {
    if (window.console) console.warn('[importar-fatura] compartilhado', e);
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  try {
    window.addEventListener('load', function () {
      impfatRegistrarCompartilhar();
      impfatReceberCompartilhado(0);
    });
  } catch (e) {}
}

// ════════════════════════════════════════════════════════════
// DESENHO
// ════════════════════════════════════════════════════════════

var IMPFAT_STATUS_UI = {
  nova: { rotulo: 'Nova', classe: 'nova' },
  ja_lancada: { rotulo: 'Já no app', classe: 'ja' },
  parecida: { rotulo: 'Parecida com uma do app', classe: 'decisao' },
  conflito: { rotulo: 'Parcelas diferentes', classe: 'decisao' },
  outra_fatura: { rotulo: 'Está em outra fatura', classe: 'decisao' },
  reajuste: { rotulo: 'Preço novo', classe: 'decisao' },
  anulada: { rotulo: 'Estornada', classe: 'fora' },
  credito_fora: { rotulo: 'Crédito', classe: 'fora' },
  ignorada: { rotulo: 'Não é compra', classe: 'fora' },
  erro: { rotulo: 'Ilegível', classe: 'fora' },
};

function _impEhDecisao(it) {
  return (
    ['parecida', 'conflito', 'outra_fatura', 'reajuste'].indexOf(it.status) !== -1 ||
    (it.status === 'anulada' && !!it.escolha)
  );
}

function renderizarImportarFatura() {
  var corpo = document.getElementById('impfatCorpo');
  if (!corpo) return;
  // O título não é de um banco: o subtítulo diz de qual cartão é a fatura.
  var sub = document.getElementById('impfatSub');
  var cartao = _impCartao(impfatUi.cartaoId);
  if (sub) sub.textContent = cartao ? 'Faturas · ' + cartao.nome : 'Faturas';
  if (impfatUi.passo === 'feito') corpo.innerHTML = _impHtmlFeito();
  else if (impfatUi.passo === 'revisao') corpo.innerHTML = _impHtmlRevisao();
  else corpo.innerHTML = _impHtmlInicio();
  _impRenderRodape();
}

function _impHtmlComoPegar() {
  return (
    '<ol class="imp-como">' +
    '<li><i class="ph ph-credit-card" aria-hidden="true"></i><span><strong>No app do banco:</strong> abra a fatura fechada e peça o arquivo em OFX ou CSV. No Nubank: cartão → <em>Resumo de faturas</em> → fatura fechada → <em>Enviar por e-mail</em>.</span></li>' +
    '<li><i class="ph ph-envelope-simple" aria-hidden="true"></i><span><strong>No e-mail:</strong> toque no anexo. No Android, escolha <em>Compartilhar → Appliquei</em> e pronto. No iPhone, <em>Salvar em Arquivos</em>.</span></li>' +
    '<li><i class="ph ph-file-arrow-up" aria-hidden="true"></i><span>Volte aqui e escolha o arquivo.</span></li>' +
    '</ol>'
  );
}

function _impHtmlInicio() {
  var jaUsou = _impJaUsou();
  return (
    '<div class="imp-passos">' +
    (jaUsou
      ? ''
      : '<p class="imp-intro">Traga as compras da fatura fechada de uma vez, pelo arquivo OFX ou CSV que o banco envia. Você revisa tudo antes de entrar.</p>' +
        _impHtmlComoPegar()) +
    (impfatUi.erro
      ? '<div class="imp-erro" role="alert"><i class="ph-fill ph-warning-circle" aria-hidden="true"></i> ' +
        _impEsc(impfatUi.erro) +
        '</div>'
      : '') +
    '<button type="button" class="btn-acao imp-escolher" onclick="impfatUiEscolherArquivo()"><i class="ph ph-file-arrow-up" aria-hidden="true"></i> Escolher o arquivo da fatura</button>' +
    (jaUsou
      ? '<details class="imp-como-recolhido"><summary>Como pegar o arquivo da fatura?</summary>' +
        _impHtmlComoPegar() +
        '</details>'
      : '') +
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

/** Categoria numa etiqueta (um select nativo com cara de etiqueta: um toque). */
function _impSelectCategoria(it) {
  var cats = typeof obterCategoriasDespesa === 'function' ? obterCategoriasDespesa() : [];
  return (
    '<select class="imp-cat' +
    (it.categoriaDespesa ? '' : ' vazia') +
    '" aria-label="Categoria de ' +
    _impEsc(it.descricao) +
    '" onclick="event.stopPropagation()" onchange="impfatUiCategoria(\'' +
    it.ref +
    '\', this.value); this.classList.toggle(\'vazia\', !this.value)"><option value="">+ categoria</option>' +
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

function _impParc(it) {
  return it.parcela
    ? ' <span class="imp-parc">' + it.parcela.n + '/' + it.parcela.m + '</span>'
    : '';
}

function _impLinhaCabecalho(it, extraSub) {
  var st = IMPFAT_STATUS_UI[it.status] || { rotulo: it.status, classe: 'fora' };
  return (
    '<div class="imp-item-corpo"><span class="imp-item-desc">' +
    _impEsc(it.descricao) +
    _impParc(it) +
    '</span><span class="imp-item-sub">' +
    (it.data ? AppliqueiImportarFatura.rotuloDia(it.data) + ' · ' : '') +
    '<span class="imp-chip">' +
    st.rotulo +
    '</span>' +
    (extraSub || '') +
    '</span></div>' +
    '<span class="imp-item-valor valor-mascarado">' +
    _impMoeda(it.valor) +
    '</span>'
  );
}

/** Compra nova: a linha inteira liga/desliga; a categoria é uma etiqueta. */
function _impHtmlNova(it) {
  var id = 'impn' + it.ref;
  return (
    '<div class="imp-item imp-nova' +
    (it.marcado ? ' on' : '') +
    '">' +
    '<label class="imp-item-linha" for="' +
    id +
    '"><input type="checkbox" class="imp-check" id="' +
    id +
    '"' +
    (it.marcado ? ' checked' : '') +
    ' onchange="impfatUiMarcar(\'' +
    it.ref +
    '\', this.checked)">' +
    _impLinhaCabecalho(it) +
    '</label>' +
    (it.marcado
      ? '<div class="imp-nova-pe">' +
        _impSelectCategoria(it) +
        (it.motivo ? '<span class="imp-motivo-curto">' + _impEsc(it.motivo) + '</span>' : '') +
        '</div>'
      : '') +
    '</div>'
  );
}

/** As duas opções de uma decisão, escritas por extenso. */
function _impOpcoesDecisao(it) {
  var app = it.valorApp != null ? _impMoeda(it.valorApp) : '';
  var nomeApp = '';
  if (it.casadoCom && typeof transacoes !== 'undefined') {
    var t = transacoes.find(function (x) {
      return x.id === it.casadoCom;
    });
    nomeApp = t ? t.descricao : '';
  }
  var nome = '"' + _impEsc(nomeApp) + '"';
  var diferente = {
    v: 'diferente',
    titulo: 'Compras diferentes',
    sub: 'Importar esta também',
  };
  if (it.status === 'parecida')
    return {
      contexto: 'No app: ' + nome + ' por ' + app + '.',
      opcoes: [
        {
          v: 'mesma',
          titulo: 'É a mesma compra',
          sub: 'Usar o valor do banco: ' + nome + ' passa a ' + _impMoeda(it.valor),
        },
        diferente,
      ],
    };
  if (it.status === 'conflito')
    return {
      contexto: 'No app: ' + nome + ' (' + app + '). O número de parcelas não bate.',
      opcoes: [
        { v: 'manter', titulo: 'É a mesma compra', sub: 'Manter como está no app' },
        diferente,
      ],
    };
  if (it.status === 'outra_fatura') {
    var tOut = (typeof transacoes !== 'undefined' ? transacoes : []).find(function (x) {
      return x.id === it.casadoCom;
    });
    return {
      contexto: 'No app ela está na fatura de ' + _impMesCurto(tOut && tOut.dataVencimento) + '.',
      opcoes: [
        { v: 'mover', titulo: 'É a mesma compra', sub: 'Mover ' + nome + ' para esta fatura' },
        diferente,
      ],
    };
  }
  if (it.status === 'reajuste')
    return {
      contexto: 'No app: ' + nome + ' por ' + app + ' todo mês.',
      opcoes: [
        {
          v: 'atualizar',
          titulo: 'Atualizar para ' + _impMoeda(it.valor),
          sub: 'Nesta e nas próximas faturas',
        },
        { v: 'manter', titulo: 'Manter ' + app, sub: 'A diferença fica só nesta fatura do banco' },
      ],
    };
  if (it.status === 'anulada')
    return {
      contexto: 'O banco estornou esta compra, mas ela está lançada no app como ' + nome + '.',
      opcoes: [
        {
          v: 'apagar',
          titulo: 'Apagar ' + nome + ' do app',
          sub: 'O Desfazer devolve, se precisar',
        },
        { v: 'manter', titulo: 'Manter no app', sub: 'Fica fora da conta da fatura' },
      ],
    };
  return { contexto: '', opcoes: [] };
}

function _impHtmlDecisao(it) {
  var d = _impOpcoesDecisao(it);
  var grupo = 'impd' + it.ref;
  return (
    '<fieldset class="imp-item imp-decisao">' +
    '<legend class="imp-item-linha">' +
    _impLinhaCabecalho(it) +
    '</legend>' +
    (d.contexto ? '<p class="imp-contexto">' + d.contexto + '</p>' : '') +
    '<div class="imp-opcoes">' +
    d.opcoes
      .map(function (o) {
        var id = grupo + o.v;
        return (
          '<label class="imp-opcao' +
          (it.escolha === o.v ? ' on' : '') +
          '" for="' +
          id +
          '"><input type="radio" name="' +
          grupo +
          '" id="' +
          id +
          '" value="' +
          o.v +
          '"' +
          (it.escolha === o.v ? ' checked' : '') +
          ' onchange="impfatUiEscolha(\'' +
          it.ref +
          "', '" +
          o.v +
          '\')"><span><strong>' +
          o.titulo +
          '</strong><small>' +
          o.sub +
          '</small></span></label>'
        );
      })
      .join('') +
    '</div>' +
    (it.escolha === 'diferente'
      ? '<div class="imp-nova-pe">' + _impSelectCategoria(it) + '</div>'
      : '') +
    '</fieldset>'
  );
}

function _impHtmlSoLeitura(it) {
  return (
    '<div class="imp-item imp-leitura st-' +
    (IMPFAT_STATUS_UI[it.status] || { classe: 'fora' }).classe +
    '"><div class="imp-item-linha">' +
    _impLinhaCabecalho(it) +
    '</div>' +
    (it.motivo ? '<p class="imp-motivo">' + _impEsc(it.motivo) + '</p>' : '') +
    '</div>'
  );
}

function _impHtmlRevisao() {
  var p = impfatUi.plano;
  var cartoes = _impCartoes();
  var cab =
    '<div class="imp-cab">' +
    '<div class="imp-arquivo"><i class="ph ph-file-text" aria-hidden="true"></i> ' +
    _impEsc(impfatUi.arquivoNome) +
    ' <button type="button" class="imp-trocar" onclick="impfatUiEscolherArquivo()">Trocar</button></div>' +
    '<div class="imp-campos' +
    (cartoes.length > 1 ? '' : ' um') +
    '">' +
    // Um cartão só: não há o que escolher, o seletor só ocuparia espaço.
    (cartoes.length > 1
      ? '<label>Cartão no app<select onchange="impfatUiMudarCartao(this.value)">' +
        _impOpcoesCartao() +
        '</select></label>'
      : '') +
    '<label>Vencimento da fatura<input type="date" value="' +
    _impEsc(impfatUi.vencimento) +
    '" onchange="impfatUiMudarVencimento(this.value)"></label>' +
    '</div>';
  if (!p) {
    return (
      cab +
      '<div class="imp-erro" role="alert">Informe o vencimento desta fatura (está no app do banco, no topo da fatura).</div></div>'
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
      '. O que já entrou aparece em "Já estão no app".</div>';
  }
  if (p.banco !== 'nubank') {
    cab +=
      '<div class="imp-aviso-topo"><i class="ph-fill ph-warning" aria-hidden="true"></i> Este arquivo não é do Nubank, o único banco já conferido com arquivo de verdade. Confira a revisão com atenção.</div>';
  }
  cab += '</div>';

  var decisoes = [];
  var novas = [];
  var jaNoApp = [];
  var fora = [];
  p.itens.forEach(function (it) {
    if (_impEhDecisao(it)) decisoes.push(it);
    else if (it.status === 'nova') novas.push(it);
    else if (it.status === 'ja_lancada') jaNoApp.push(it);
    else fora.push(it);
  });

  var html = cab;
  if (decisoes.length) {
    html +=
      '<section class="imp-grupo" data-grupo="decisoes"><h3>Decida antes de importar <span>' +
      decisoes.length +
      '</span></h3>' +
      decisoes.map(_impHtmlDecisao).join('') +
      '</section>';
  }
  if (novas.length) {
    var marcadas = novas.filter(function (it) {
      return it.marcado;
    });
    var semCat = marcadas.filter(function (it) {
      return !it.categoriaDespesa;
    }).length;
    html +=
      '<section class="imp-grupo" data-grupo="novas"><div class="imp-grupo-topo"><h3>Compras novas <span>' +
      novas.length +
      '</span></h3>' +
      '<button type="button" class="imp-link" onclick="impfatUiMarcarTodas(' +
      (marcadas.length === novas.length ? 'false' : 'true') +
      ')">' +
      (marcadas.length === novas.length ? 'Desmarcar todas' : 'Marcar todas') +
      '</button></div>' +
      (semCat
        ? '<p class="imp-grupo-nota">' +
          semCat +
          ' sem categoria. Escolha agora ou depois, na fatura — não impede de importar.</p>'
        : '') +
      novas.map(_impHtmlNova).join('') +
      '</section>';
  }
  if (jaNoApp.length) {
    html +=
      '<details class="imp-grupo" data-grupo="ja"><summary>Já estão no app <span>' +
      jaNoApp.length +
      '</span></summary>' +
      jaNoApp.map(_impHtmlSoLeitura).join('') +
      '</details>';
  }
  if (fora.length) {
    html +=
      '<details class="imp-grupo" data-grupo="fora"><summary>Não entram <span>' +
      fora.length +
      '</span></summary>' +
      fora.map(_impHtmlSoLeitura).join('') +
      '</details>';
  }
  return html;
}

function _impHtmlFeito() {
  var r = impfatUi.resultado || {};
  var bate = Math.abs((r.totalApp || 0) - (r.totalBanco || 0)) < 0.01;
  var itens = [];
  if (r.compras)
    itens.push('<li><strong>' + r.compras + '</strong> compra(s) nova(s) nesta fatura</li>');
  if (r.futuras)
    itens.push(
      '<li><strong>' +
        r.futuras +
        '</strong> parcela(s) nas próximas faturas' +
        (r.ate ? ', até ' + _impMesCurto(r.ate) : '') +
        '</li>'
    );
  if (r.ajustes)
    itens.push('<li><strong>' + r.ajustes + '</strong> lançamento(s) ajustado(s)</li>');
  if (r.jaLancadas) itens.push('<li><strong>' + r.jaLancadas + '</strong> já estavam no app</li>');
  return (
    '<div class="imp-feito">' +
    '<i class="ph-fill ph-check-circle" aria-hidden="true"></i>' +
    '<strong>Fatura de ' +
    _impMesCurto(r.vencimento) +
    ' importada</strong>' +
    '<div class="imp-feito-total' +
    (bate ? ' bate' : '') +
    '"><span>No app</span><b class="valor-mascarado">' +
    _impMoeda(r.totalApp) +
    '</b><span>' +
    (bate
      ? '<i class="ph-bold ph-check" aria-hidden="true"></i> igual à do banco'
      : 'Banco: ' + _impMoeda(r.totalBanco)) +
    '</span></div>' +
    (itens.length ? '<ul class="imp-feito-lista">' + itens.join('') + '</ul>' : '') +
    (r.semCategoria
      ? '<p>' +
        r.semCategoria +
        ' compra(s) sem categoria: dá para escolher na fatura, no lápis de cada uma.</p>'
      : '') +
    '<p>Tudo entrou como a pagar. Quando pagar a fatura, use "Marcar como paga".</p>' +
    '</div>'
  );
}

function _impRenderRodape() {
  var rod = document.getElementById('impfatRodape');
  if (!rod) return;
  if (impfatUi.passo === 'feito') {
    rod.innerHTML =
      '<div class="imp-botoes">' +
      '<button type="button" class="btn-secundario" onclick="impfatUiDesfazer()"><i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i> Desfazer importação</button>' +
      '<button type="button" class="btn-acao" onclick="impfatUiVerFatura()">Ver a fatura</button>' +
      '</div>';
    return;
  }
  if (impfatUi.passo !== 'revisao' || !impfatUi.plano) {
    rod.innerHTML =
      '<div class="imp-botoes"><button type="button" class="btn-secundario" onclick="fecharImportarFatura()">Cancelar</button></div>';
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
  var mexe = _impMexe(impfatUi.plano);
  var rotulo = res.qtdNovas
    ? 'Importar ' + res.qtdNovas + (res.qtdNovas === 1 ? ' compra' : ' compras')
    : 'Aplicar os ajustes';
  rod.innerHTML =
    '<div class="imp-totais">' +
    '<div><span>Total do banco</span><strong class="valor-mascarado">' +
    _impMoeda(res.totalBanco) +
    '</strong></div>' +
    '<div><span>No app, depois de importar</span><strong class="valor-mascarado' +
    (bate ? ' bate' : ' nao-bate') +
    '">' +
    _impMoeda(res.appDepois) +
    (bate ? ' <i class="ph-bold ph-check" aria-label="igual"></i>' : '') +
    '</strong></div>' +
    explica +
    '</div>' +
    (res.parcelasFuturas
      ? '<p class="imp-futuras"><i class="ph ph-calendar-plus" aria-hidden="true"></i> E mais <strong>' +
        res.parcelasFuturas +
        ' parcela(s)</strong> nas próximas faturas' +
        (res.ateVencimento ? ', até ' + _impMesCurto(res.ateVencimento) : '') +
        '.</p>'
      : '') +
    '<div class="imp-botoes">' +
    '<button type="button" class="btn-secundario" onclick="fecharImportarFatura()">Cancelar</button>' +
    '<button type="button" class="btn-acao" onclick="impfatUiConfirmar()"' +
    (mexe ? '' : ' disabled') +
    '><i class="ph-bold ph-check" aria-hidden="true"></i> ' +
    rotulo +
    '</button>' +
    '</div>';
}
