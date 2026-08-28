/**
 * Appliquei — Contas / Instituições financeiras (entidade central).
 *
 * Objetivo de longo prazo: toda entrada e saída de dinheiro passa por uma
 * instituição. Hoje isso é representado por dois campos de TEXTO LIVRE —
 * `banco` (em transacoes) e `corretora` (em historicoCompras) — reconciliados
 * por nome na hora de renderizar o "Por instituição". Esta entidade introduz um
 * cadastro-mestre com identidade estável (`contaId`) para substituir, em fases,
 * esses strings. Ver docs/CONTAS-INSTITUICOES.md para o plano completo.
 *
 * FASE 1 (esta) — fundação NÃO-QUEBRA. O módulo é inerte para os cálculos:
 *   (a) mantém o array global `contas` em localStorage `appliquei_contas`
 *       (auto-sincronizado pelo cloud-sync, que espelha chaves appliquei_*);
 *   (b) faz um seed idempotente criando uma Conta para cada instituição já
 *       citada nos dados do usuário (corretora/banco).
 * NENHUM caminho de saldo foi alterado, e os campos `banco`/`corretora`
 * continuam sendo a fonte de verdade. O switch dos cálculos vem na Fase 2.
 *
 * Classic script: carregado logo DEPOIS de appliquei-app.js (que define
 * `transacoes` e `historicoCompras`). Top-level usa só `var` (vira window.*).
 */

// Estado global — mesmo molde de transacoes/cartoes (appliquei-app.js).
var contas = (function () {
  try {
    var arr = JSON.parse(localStorage.getItem('appliquei_contas'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
})();

// Tipos suportados. 'carteira' cobre dinheiro físico / carteira digital sem
// instituição formal; 'outro' é escape para casos não previstos.
var CONTA_TIPOS = [
  { v: 'banco', label: '🏦 Banco' },
  { v: 'corretora', label: '📈 Corretora' },
  { v: 'carteira', label: '👛 Carteira / Dinheiro' },
  { v: 'outro', label: '🔖 Outro' },
];

// Persistência local pura (sem forçar flush) — usada no seed de boot, antes do
// cloud-sync estar pronto. CRUD disparado pelo usuário usa salvarContas().
function persistirContasLocal() {
  try {
    localStorage.setItem('appliquei_contas', JSON.stringify(contas));
  } catch (e) {
    if (window.console) console.error('[contas] localStorage', e);
  }
}

function salvarContas() {
  persistirContasLocal();
  try {
    if (window.AppliqueiCloudSync && typeof AppliqueiCloudSync.forceFlush === 'function') {
      AppliqueiCloudSync.forceFlush();
    }
  } catch (e) {}
}

// Normaliza nome para comparação/dedup: sem acento, minúsculo, espaços únicos.
// Mesma regra de mpNormalizarInstituicao (patrimonio.js) — mantida aqui para o
// módulo ser autossuficiente; as duas convergem para o mesmo `key`.
function appliqueiNormalizarNomeConta(nome) {
  return (nome || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
}

function contasAtivas() {
  return contas.filter(function (c) {
    return !c.arquivada;
  });
}

// === Saldo de caixa por conta (fonte única de verdade p/ os seletores) =======
// Reaproveita o cálculo canônico do Patrimônio (mpCalcularSaldoPorInstituicao):
// caixa = saldo de abertura + entradas - saídas pagas, por instituição/conta.
// Retorna um mapa { contaId: saldoEmCaixa }. Sem o módulo de patrimônio (ex.:
// testes), cai para o saldo inicial cadastrado.
function saldoCaixaPorConta(refMs) {
  const agora = Date.now();
  const ref = refMs != null ? refMs : agora;
  // Numa data FUTURA o saldo relevante é o PROJETADO: parte da foto de hoje e
  // aplica o que já está agendado até lá. mpCalcularSaldoPorInstituicao sozinha
  // não serve para isso — ela só desconta saída com `pago:true`, e lançamento
  // futuro nasce `pago:false`; passar um ref futuro devolveria um saldo
  // otimista (contaria a receita de amanhã e ignoraria a fatura de amanhã).
  const base = ref > agora ? agora : ref;
  const mapa = {};
  if (typeof mpCalcularSaldoPorInstituicao === 'function') {
    const porInst = mpCalcularSaldoPorInstituicao(base) || {};
    Object.keys(porInst).forEach(function (k) {
      mapa[k] = Number(porInst[k] && porInst[k].caixa) || 0;
    });
  } else {
    contasAtivas().forEach(function (c) {
      mapa[c.id] = Number(c.saldoInicial) || 0;
    });
  }
  if (ref > agora) aplicarAgendadoNoSaldo(mapa, agora, ref);
  return mapa;
}

// Soma ao mapa de saldos tudo o que está AGENDADO na janela (agora, refMs],
// pago ou não — é a diferença entre "quanto tenho" e "quanto terei naquele dia".
// Espelha as regras de caixa do Patrimônio (mpTransacaoComputaCaixa) menos a
// exigência de `pago`, que é justamente o que ainda não aconteceu:
//   · perna do ativo com temLegCaixa não conta (quem debita é a perna de caixa);
//   · entrada soma, qualquer outra categoria subtrai.
function aplicarAgendadoNoSaldo(mapa, deMs, ateMs) {
  if (typeof transacoes === 'undefined') return mapa;
  if (typeof mpTimestampTransacao !== 'function') return mapa;
  // Aqui a granularidade é o DIA, não o mês: a pergunta é "quanto vou ter no dia
  // 15?", e mpTimestampTransacao devolve sempre o 1º dia da competência — o
  // aluguel do dia 20 apareceria descontado já no dia 15. mpDataMovimento é a
  // data real do lançamento (vencimento primeiro), que é a que responde isso.
  const quando = typeof mpDataMovimento === 'function' ? mpDataMovimento : mpTimestampTransacao;
  const ehEntrada =
    typeof mpEhEntradaCaixa === 'function'
      ? mpEhEntradaCaixa
      : function (cat) {
          return (
            cat === 'receita' ||
            cat === 'dividendo' ||
            cat === 'resgate_investimento' ||
            cat === 'transferencia_entrada'
          );
        };
  transacoes.forEach(function (t) {
    // A janela usa as duas datas: `quando` (dia real) decide se cabe até ateMs,
    // e a competência decide se já entrou na foto de hoje — assim nada é contado
    // duas vezes nem fica de fora na virada do mês.
    const ts = quando(t);
    if (ts > ateMs) return;
    if (!(ts > deMs) || !(mpTimestampTransacao(t) > deMs)) return;
    if (
      (t.categoria === 'investimento_fixo' || t.categoria === 'investimento_variavel') &&
      t.temLegCaixa
    )
      return;
    const chave =
      typeof mpChaveInstTransacao === 'function' ? mpChaveInstTransacao(t).key : t.contaId;
    if (!chave) return;
    if (mapa[chave] == null) mapa[chave] = 0;
    const valor = Number(t.valor) || 0;
    if (ehEntrada(t.categoria)) mapa[chave] += valor;
    else mapa[chave] -= valor;
  });
  return mapa;
}

// Contas ativas que TÊM dinheiro em caixa (saldo > 0), com o saldo anexado e
// ordenadas da maior para a menor. É a lista que deve aparecer em qualquer
// seletor de "de onde o dinheiro sai/entra": só instituições com dinheiro, e
// sempre com o saldo à mostra. Nunca inclui "a reconciliar".
function contasComSaldo(refMs) {
  const saldos = saldoCaixaPorConta(refMs);
  return contasAtivas()
    .map(function (c) {
      return { conta: c, saldo: Number(saldos[c.id]) || 0 };
    })
    .filter(function (x) {
      return x.saldo > 0.005;
    })
    .sort(function (a, b) {
      return b.saldo - a.saldo;
    });
}

// Monta o innerHTML de um <select> de conta. Por padrão lista só contas com
// saldo (origem do dinheiro). Opções:
//   selecionadoId   → marca a opção atual como selected
//   placeholder     → texto da 1ª opção vazia (default "— selecione a conta —")
//   semPlaceholder  → não inclui a opção vazia inicial
//   incluirTodas    → lista TODAS as contas ativas (destino do dinheiro), ainda
//                     assim mostrando o saldo de cada uma
//   vazioMsg        → texto quando não há nenhuma conta elegível
//   refMs           → data de referência do saldo. Numa data futura lista o
//                     saldo PROJETADO para aquele dia (ver saldoCaixaPorConta),
//                     que é o que importa quando a operação é agendada.
function optionsContasComSaldo(opcoes) {
  const o = opcoes || {};
  const fmt = function (v) {
    return typeof formatarMoeda === 'function'
      ? formatarMoeda(v)
      : 'R$ ' + (Number(v) || 0).toFixed(2);
  };
  let lista;
  if (o.incluirTodas) {
    const saldos = saldoCaixaPorConta(o.refMs);
    lista = contasAtivas().map(function (c) {
      return { conta: c, saldo: Number(saldos[c.id]) || 0 };
    });
  } else {
    lista = contasComSaldo(o.refMs);
  }
  if (!lista.length) {
    const msg = o.vazioMsg || '— nenhuma conta com saldo disponível —';
    return '<option value="">' + msg + '</option>';
  }
  const sel = o.selecionadoId != null ? String(o.selecionadoId) : '';
  const itens = lista
    .map(function (x) {
      const marca = String(x.conta.id) === sel ? ' selected' : '';
      return (
        '<option value="' +
        x.conta.id +
        '"' +
        marca +
        '>' +
        x.conta.nome +
        ' — ' +
        fmt(x.saldo) +
        '</option>'
      );
    })
    .join('');
  if (o.semPlaceholder) return itens;
  const ph = o.placeholder || '— selecione a conta —';
  return '<option value="">' + ph + '</option>' + itens;
}

function obterConta(id) {
  if (!id) return null;
  return (
    contas.find(function (c) {
      return c.id === id;
    }) || null
  );
}

// Busca uma conta pelo nome (normalizado). Retorna a conta ou null.
function obterContaPorNome(nome) {
  const key = appliqueiNormalizarNomeConta(nome);
  if (!key) return null;
  return (
    contas.find(function (c) {
      return appliqueiNormalizarNomeConta(c.nome) === key;
    }) || null
  );
}

// Cria e persiste uma conta. `dados`: {nome, tipo, saldoInicial, dataSaldoInicial, cor}.
function criarConta(dados) {
  dados = dados || {};
  const nome = (dados.nome || '').trim();
  if (!nome) return null;
  const agora = new Date().toISOString();
  const nova = {
    id: 'conta_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    nome: nome,
    tipo: dados.tipo || 'banco',
    saldoInicial: Number(dados.saldoInicial) || 0,
    dataSaldoInicial: dados.dataSaldoInicial || null,
    cor: dados.cor || null,
    arquivada: false,
    criadaEm: agora,
    atualizadaEm: agora,
  };
  contas.push(nova);
  salvarContas();
  return nova;
}

// Idempotente: devolve a conta existente com aquele nome ou cria uma nova.
function obterOuCriarContaPorNome(nome, tipo) {
  const existente = obterContaPorNome(nome);
  if (existente) return existente;
  return criarConta({ nome: nome, tipo: tipo || 'banco' });
}

// Como obterContaPorNome, mas também casa nos `aliases` (nomes absorvidos numa
// fusão). Usado na resolução de registros antigos que ainda guardam o `banco`/
// `corretora` em texto livre. Retorna a conta ou null.
function obterContaPorNomeOuAlias(nome) {
  const key = appliqueiNormalizarNomeConta(nome);
  if (!key) return null;
  return (
    contas.find(function (c) {
      if (appliqueiNormalizarNomeConta(c.nome) === key) return true;
      return Array.isArray(c.aliases) && c.aliases.indexOf(key) !== -1;
    }) || null
  );
}

// Resolve a conta de uma transação de caixa: prioriza `contaId`; cai para
// match por nome/alias do campo `banco`. Retorna a conta ou null (a reconciliar).
function resolverContaDeTransacao(t) {
  if (!t) return null;
  if (t.contaId) {
    const c = obterConta(t.contaId);
    if (c) return c;
  }
  return obterContaPorNomeOuAlias(t.banco);
}

// Resolve a conta-corretora de uma operação de investimento (contaId → corretora).
function resolverContaDeOperacao(op) {
  if (!op) return null;
  if (op.contaId) {
    const c = obterConta(op.contaId);
    if (c) return c;
  }
  return obterContaPorNomeOuAlias(op.corretora);
}

function editarConta(id, patch) {
  const c = obterConta(id);
  if (!c) return null;
  patch = patch || {};
  if (patch.nome != null) c.nome = String(patch.nome).trim() || c.nome;
  if (patch.tipo != null) c.tipo = patch.tipo;
  if (patch.saldoInicial != null) c.saldoInicial = Number(patch.saldoInicial) || 0;
  if (patch.dataSaldoInicial !== undefined) c.dataSaldoInicial = patch.dataSaldoInicial;
  if (patch.cor !== undefined) c.cor = patch.cor;
  if (patch.arquivada != null) c.arquivada = !!patch.arquivada;
  c.atualizadaEm = new Date().toISOString();
  salvarContas();
  return c;
}

function arquivarConta(id) {
  return editarConta(id, { arquivada: true });
}

// Funde contas duplicadas: re-aponta qualquer referência `contaId` (em
// transacoes/historicoCompras/cartoes) das contas-origem para a conta-destino,
// soma os saldos iniciais e remove as origens do cadastro. Na Fase 1 ainda não
// há `contaId` nos registros, mas a função já trata isso para as fases
// seguintes (ex.: usuário funde "Itaú" e "Itaú Unibanco").
function fundirContas(idDestino, idsOrigem) {
  const destino = obterConta(idDestino);
  if (!destino) return null;
  const origens = (idsOrigem || []).filter(function (id) {
    return id && id !== idDestino;
  });
  if (!origens.length) return destino;
  const setOrigem = new Set(origens);
  const reaponta = function (obj, campo) {
    if (obj && setOrigem.has(obj[campo])) obj[campo] = idDestino;
  };
  try {
    if (typeof transacoes !== 'undefined' && Array.isArray(transacoes)) {
      transacoes.forEach(function (t) {
        reaponta(t, 'contaId');
      });
    }
    if (typeof historicoCompras !== 'undefined' && Array.isArray(historicoCompras)) {
      historicoCompras.forEach(function (op) {
        reaponta(op, 'contaId');
      });
    }
    if (typeof cartoes !== 'undefined' && Array.isArray(cartoes)) {
      cartoes.forEach(function (c) {
        reaponta(c, 'contaPagadoraId');
      });
    }
  } catch (e) {}
  if (!Array.isArray(destino.aliases)) destino.aliases = [];
  const addAlias = function (k) {
    if (k && destino.aliases.indexOf(k) === -1) destino.aliases.push(k);
  };
  origens.forEach(function (id) {
    const o = obterConta(id);
    if (!o) return;
    destino.saldoInicial = (Number(destino.saldoInicial) || 0) + (Number(o.saldoInicial) || 0);
    // Guarda o nome (e aliases) absorvidos para que registros antigos que ainda
    // referenciam essa instituição por texto continuem resolvendo no destino.
    addAlias(appliqueiNormalizarNomeConta(o.nome));
    (o.aliases || []).forEach(addAlias);
  });
  destino.atualizadaEm = new Date().toISOString();
  // splice in-place preserva a referência do array global `contas`.
  for (let i = contas.length - 1; i >= 0; i--) {
    if (setOrigem.has(contas[i].id)) contas.splice(i, 1);
  }
  salvarContas();
  return destino;
}

// === Seed/backfill idempotente (Fase 1) ===
// Cria uma Conta para cada instituição já citada nos dados do usuário:
//   - `corretora` em historicoCompras → tipo 'corretora'
//   - `banco` em transacoes           → tipo 'banco'
// NÃO carimba contaId nos registros nem mexe em futurorico_* — isso é Fase 2.
// Usa obterOuCriarContaPorNome (dedup), logo é seguro rodar mais de uma vez.
// Retorna quantas contas foram criadas.
function appliqueiSeedContasDeStrings() {
  const nomesCorretora = {};
  const nomesBanco = {};
  try {
    if (typeof historicoCompras !== 'undefined' && Array.isArray(historicoCompras)) {
      historicoCompras.forEach(function (op) {
        const n = op && op.corretora ? String(op.corretora).trim() : '';
        if (n) nomesCorretora[appliqueiNormalizarNomeConta(n)] = n;
      });
    }
    if (typeof transacoes !== 'undefined' && Array.isArray(transacoes)) {
      transacoes.forEach(function (t) {
        const n = t && t.banco ? String(t.banco).trim() : '';
        if (n) nomesBanco[appliqueiNormalizarNomeConta(n)] = n;
      });
    }
  } catch (e) {
    return 0;
  }
  const antes = contas.length;
  Object.keys(nomesCorretora).forEach(function (k) {
    obterOuCriarContaPorNome(nomesCorretora[k], 'corretora');
  });
  Object.keys(nomesBanco).forEach(function (k) {
    obterOuCriarContaPorNome(nomesBanco[k], 'banco');
  });
  return contas.length - antes;
}

// Executa o seed uma vez por dispositivo, MAS só "trava" a flag quando havia
// dados de onde semear. Isso cobre a corrida em que o classic script roda antes
// do cloud-sync puxar o Firestore (localStorage ainda vazio): sem dados, a flag
// não é setada e o seed roda de novo no próximo boot, já com os dados puxados.
// Quando a flag está setada, não re-semeia — respeita edições futuras de conta.
(function seedContasBoot() {
  try {
    if (localStorage.getItem('appliquei_contas_seed_v1')) return;
    const temDados =
      (typeof historicoCompras !== 'undefined' && (historicoCompras || []).length > 0) ||
      (typeof transacoes !== 'undefined' && (transacoes || []).length > 0);
    const criadas = appliqueiSeedContasDeStrings();
    if (criadas > 0) persistirContasLocal();
    if (temDados) localStorage.setItem('appliquei_contas_seed_v1', '1');
  } catch (e) {}
})();

// ============================================================
// === UI: tela "Minhas Contas" (dentro de Meu Patrimônio) ===
// ============================================================
// CRUD + saldo de abertura + fusão de duplicadas. Render disparado por
// renderMeuPatrimonio (patrimonio.js). Reusa o modalConfirmacao para a fusão.

function popularSelectTipoConta() {
  const sel = document.getElementById('contaTipo');
  if (!sel || sel.options.length) return;
  sel.innerHTML = CONTA_TIPOS.map(function (t) {
    return '<option value="' + t.v + '">' + t.label + '</option>';
  }).join('');
}

function abrirNovaContaForm() {
  const f = document.getElementById('formNovaConta');
  if (!f) return;
  popularSelectTipoConta();
  document.getElementById('contaEditId').value = '';
  document.getElementById('contaNome').value = '';
  document.getElementById('contaTipo').value = 'banco';
  document.getElementById('contaSaldoInicial').value = '';
  document.getElementById('contaDataSaldoInicial').value = '';
  const titulo = document.getElementById('tituloFormConta');
  if (titulo) titulo.textContent = 'Nova conta';
  f.style.display = 'block';
  document.getElementById('contaNome').focus();
}

function cancelarFormConta() {
  const f = document.getElementById('formNovaConta');
  if (f) f.style.display = 'none';
}

function editarContaForm(id) {
  const c = obterConta(id);
  if (!c) return;
  popularSelectTipoConta();
  document.getElementById('contaEditId').value = c.id;
  document.getElementById('contaNome').value = c.nome;
  document.getElementById('contaTipo').value = c.tipo || 'banco';
  document.getElementById('contaSaldoInicial').value =
    c.saldoInicial && typeof formatarBRLInput === 'function'
      ? formatarBRLInput(c.saldoInicial)
      : '';
  document.getElementById('contaDataSaldoInicial').value = c.dataSaldoInicial || '';
  const titulo = document.getElementById('tituloFormConta');
  if (titulo) titulo.textContent = 'Editar conta';
  document.getElementById('formNovaConta').style.display = 'block';
  document.getElementById('contaNome').focus();
}

function salvarFormConta() {
  const id = document.getElementById('contaEditId').value;
  const nome = (document.getElementById('contaNome').value || '').trim();
  const tipo = document.getElementById('contaTipo').value || 'banco';
  const saldoInicial =
    typeof parseBRL === 'function'
      ? parseBRL(document.getElementById('contaSaldoInicial').value)
      : 0;
  const dataSaldoInicial = document.getElementById('contaDataSaldoInicial').value || null;
  if (!nome) return mostrarToast('Informe o nome da conta.', 'erro');
  const existente = obterContaPorNome(nome);
  if (existente && existente.id !== id) {
    return mostrarToast(
      'Já existe uma conta com esse nome. Use "Fundir" para unir duplicadas.',
      'erro'
    );
  }
  if (id) {
    editarConta(id, {
      nome: nome,
      tipo: tipo,
      saldoInicial: saldoInicial,
      dataSaldoInicial: dataSaldoInicial,
    });
    mostrarToast('Conta atualizada.', 'sucesso');
  } else {
    criarConta({
      nome: nome,
      tipo: tipo,
      saldoInicial: saldoInicial,
      dataSaldoInicial: dataSaldoInicial,
    });
    mostrarToast('Conta criada.', 'sucesso');
  }
  cancelarFormConta();
  renderMinhasContas();
}

function arquivarContaUI(id) {
  arquivarConta(id);
  renderMinhasContas();
  mostrarToast('Conta arquivada (histórico mantido).', 'aviso');
}

function restaurarContaUI(id) {
  editarConta(id, { arquivada: false });
  renderMinhasContas();
}

function fundirContaPrompt(idOrigem) {
  const origem = obterConta(idOrigem);
  if (!origem) return;
  const outras = contasAtivas().filter(function (c) {
    return c.id !== idOrigem;
  });
  if (!outras.length) return mostrarToast('Não há outra conta para fundir.', 'aviso');
  const modal = document.getElementById('modalConfirmacao');
  if (!modal) return;
  document.getElementById('modalTitulo').innerHTML =
    '<i class="ph ph-arrows-merge" style="color:var(--cor-info);"></i> Fundir conta';
  document.getElementById('modalMensagem').innerHTML =
    'Unir <strong>' +
    origem.nome +
    '</strong> em qual conta? O histórico e o saldo inicial passam para a conta escolhida, e <strong>' +
    origem.nome +
    '</strong> é removida.';
  document.getElementById('modalAcoes').innerHTML = outras
    .map(function (c) {
      return (
        '<button class="btn-acao" style="background:var(--cor-info);" onclick="confirmarFusaoUI(\'' +
        idOrigem +
        "','" +
        c.id +
        '\')"><i class="ph ph-bank"></i> ' +
        c.nome +
        '</button>'
      );
    })
    .join('');
  modal.style.display = 'flex';
}

function confirmarFusaoUI(idOrigem, idDestino) {
  fundirContas(idDestino, [idOrigem]);
  if (typeof fecharModal === 'function') fecharModal();
  renderMinhasContas();
  mostrarToast('Contas fundidas.', 'sucesso');
}

function renderMinhasContas() {
  const wrap = document.getElementById('listaContas');
  if (!wrap) return;
  popularSelectTipoConta();
  const tipoLabel = {};
  CONTA_TIPOS.forEach(function (t) {
    tipoLabel[t.v] = t.label;
  });
  const ativas = contasAtivas();
  const arquivadas = contas.filter(function (c) {
    return c.arquivada;
  });
  const ordem = ativas.concat(arquivadas);
  if (!ordem.length) {
    wrap.innerHTML =
      '<div class="mp-empty" style="padding:14px;"><i class="ph ph-bank"></i>Nenhuma conta cadastrada ainda. Crie uma para registrar de onde o dinheiro entra e sai.</div>';
    return;
  }
  const fmt = function (v) {
    return typeof formatarMoeda === 'function'
      ? formatarMoeda(v)
      : 'R$ ' + (Number(v) || 0).toFixed(2);
  };
  const btn = 'btn-secundario" style="padding:4px 8px;font-size:11px;';
  wrap.innerHTML = ordem
    .map(function (c) {
      const arq = c.arquivada;
      const saldo = Number(c.saldoInicial) || 0;
      const saldoTxt = saldo ? 'Saldo inicial ' + fmt(saldo) : 'Sem saldo inicial';
      const acao = arq
        ? '<button class="' +
          btn +
          'color:var(--cor-primaria);border-color:var(--cor-primaria);" onclick="restaurarContaUI(\'' +
          c.id +
          '\')" title="Restaurar"><i class="ph ph-arrow-counter-clockwise"></i></button>'
        : '<button class="' +
          btn +
          'color:var(--cor-texto-secundario);" onclick="fundirContaPrompt(\'' +
          c.id +
          '\')" title="Fundir em outra conta"><i class="ph ph-arrows-merge"></i></button>' +
          '<button class="' +
          btn +
          'color:var(--cor-info);border-color:var(--cor-info);" onclick="editarContaForm(\'' +
          c.id +
          '\')" title="Editar"><i class="ph ph-pencil-simple"></i></button>' +
          '<button class="' +
          btn +
          'color:var(--cor-erro);border-color:var(--cor-erro);" onclick="arquivarContaUI(\'' +
          c.id +
          '\')" title="Arquivar (mantém histórico)"><i class="ph ph-archive"></i></button>';
      const badgeTipo =
        '<span style="background:var(--cor-superficie);border:1px solid var(--cor-borda);border-radius:6px;padding:1px 6px;font-size:10px;color:var(--cor-texto-secundario);margin-left:6px;">' +
        (tipoLabel[c.tipo] || c.tipo) +
        '</span>';
      const badgeArq = arq
        ? '<span style="background:var(--cor-borda);color:var(--cor-texto-mutado);padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-left:6px;">Arquivada</span>'
        : '';
      return (
        '<div style="display:flex;align-items:center;gap:10px;background:var(--cor-superficie);border:1px solid var(--cor-borda);border-radius:9px;padding:10px 12px;' +
        (arq ? 'opacity:0.6;' : '') +
        '">' +
        '<i class="ph ph-bank" style="color:var(--cor-primaria);font-size:18px;"></i>' +
        '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:13px;font-weight:600;color:var(--cor-texto-principal);">' +
        c.nome +
        badgeTipo +
        badgeArq +
        '</div>' +
        '<div style="font-size:11px;color:var(--cor-texto-mutado);">' +
        saldoTxt +
        '</div></div>' +
        acao +
        '</div>'
      );
    })
    .join('');
}

// === Transferência entre contas (Fase 6) — ação de 1ª classe (dupla-perna) ==
// Cria um PAR de transações ligadas por transferenciaId: saída na origem +
// entrada no destino. Ambas são plumbing de caixa (ocultas no extrato) e o
// total de caixa fica neutro — só muda a divisão por instituição.
function abrirTransferenciaModal() {
  const ativas = contasAtivas();
  if (ativas.length < 2) {
    return mostrarToast('Cadastre pelo menos duas contas para transferir.', 'aviso');
  }
  // Origem ("De") = de onde o dinheiro sai: só contas com saldo, com o valor à
  // mostra. Destino ("Para") = para onde o dinheiro entra: qualquer conta ativa,
  // também mostrando o saldo atual de cada uma.
  const comSaldo = contasComSaldo();
  if (!comSaldo.length) {
    return mostrarToast('Nenhuma conta com saldo disponível para transferir.', 'aviso');
  }
  const modal = document.getElementById('modalConfirmacao');
  if (!modal) return;
  const optsOrigem = optionsContasComSaldo({ semPlaceholder: true });
  const optsDestino = optionsContasComSaldo({ incluirTodas: true, semPlaceholder: true });
  const campo = function (label, html) {
    return (
      '<div><label style="font-size:12px;color:var(--cor-texto-secundario);">' +
      label +
      '</label>' +
      html +
      '</div>'
    );
  };
  const estiloCtrl =
    'width:100%;padding:9px;border:1.5px solid var(--cor-borda);border-radius:8px;background:var(--cor-superficie);color:var(--cor-texto-principal);';
  document.getElementById('modalTitulo').innerHTML =
    '<i class="ph ph-arrows-left-right" style="color:var(--cor-info);"></i> Transferir entre contas';
  document.getElementById('modalMensagem').innerHTML =
    '<div style="display:flex;flex-direction:column;gap:10px;text-align:left;">' +
    campo(
      'De',
      '<select id="transfOrigem" style="' + estiloCtrl + '">' + optsOrigem + '</select>'
    ) +
    campo(
      'Para',
      '<select id="transfDestino" style="' + estiloCtrl + '">' + optsDestino + '</select>'
    ) +
    campo(
      'Valor (R$)',
      '<input type="text" inputmode="decimal" id="transfValor" placeholder="0,00" oninput="aplicarMascaraBRL(this)" style="' +
        estiloCtrl +
        '">'
    ) +
    campo(
      'Data',
      '<input type="date" id="transfData" value="' +
        new Date().toISOString().slice(0, 10) +
        '" style="' +
        estiloCtrl +
        '">'
    ) +
    '</div>';
  document.getElementById('modalAcoes').innerHTML =
    '<button class="btn-acao" style="background:var(--cor-info);" onclick="confirmarTransferencia()"><i class="ph ph-check"></i> Transferir</button>';
  // destino != origem por padrão: origem nasce na conta de maior saldo.
  const origemDefault = comSaldo[0].conta.id;
  const dst = document.getElementById('transfDestino');
  if (dst) {
    const outra = ativas.find(function (c) {
      return c.id !== origemDefault;
    });
    if (outra) dst.value = outra.id;
  }
  modal.style.display = 'flex';
}

// Lógica pura (testável): cria o par de transações balanceado. Retorna
// {saida, entrada} ou null se inválido. NÃO toca DOM.
// Choke point da transferência: confirmarTransferencia e qualquer outro
// chamador passam por aqui, então as guardas vivem neste ponto.
//
// Duas saíram da simulação dos botões (test/simulacao-patrimonio.test.js):
//
//  · conta INEXISTENTE passava. `obterConta(id) || {}` engolia o caso e as duas
//    pernas nasciam apontando para o nada — o valor saía do total do patrimônio
//    sem sair de instituição alguma (INV-01). O select da UI só oferece contas
//    reais, mas uma conta apagada entre abrir o modal e confirmar chega aqui.
//  · valor ACIMA DO SALDO passava, deixando a conta de origem negativa. É a
//    mesma saída de dinheiro que registrarOperacaoAtivo bloqueia na compra de
//    ativo (renda-fixa.js:796) e que o aporte de sonho passou a bloquear.
function criarTransferencia(origemId, destinoId, valor, dataStr) {
  if (!origemId || !destinoId || origemId === destinoId) return null;
  if (!(Number(valor) > 0)) return null;
  if (typeof transacoes === 'undefined' || !Array.isArray(transacoes)) return null;
  const cOrigem = obterConta(origemId);
  const cDestino = obterConta(destinoId);
  if (!cOrigem || !cDestino) return null;
  if (typeof mpCalcularSaldoPorInstituicao === 'function') {
    const saldos = mpCalcularSaldoPorInstituicao(Date.now()) || {};
    const caixa = saldos[origemId] ? saldos[origemId].caixa : 0;
    if (Number(valor) > caixa + 0.005) return null;
  }
  const d = dataStr ? new Date(dataStr + 'T12:00:00') : new Date();
  const transferenciaId = 'transf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const oNome = cOrigem.nome || '';
  const dNome = cDestino.nome || '';
  const base = {
    transferenciaId: transferenciaId,
    valor: Number(valor),
    mes: d.getMonth(),
    ano: d.getFullYear(),
    data: d.toISOString(),
    pago: true,
  };
  const saida = Object.assign({}, base, {
    id: transferenciaId + '_out',
    descricao: 'Transferência → ' + dNome,
    categoria: 'transferencia_saida',
    contaId: origemId,
    banco: oNome,
  });
  const entrada = Object.assign({}, base, {
    id: transferenciaId + '_in',
    descricao: 'Transferência ← ' + oNome,
    categoria: 'transferencia_entrada',
    contaId: destinoId,
    banco: dNome,
  });
  transacoes.push(saida, entrada);
  salvarTransacoes({ flush: true });
  return { saida: saida, entrada: entrada };
}

function confirmarTransferencia() {
  const origemId = (document.getElementById('transfOrigem') || {}).value;
  const destinoId = (document.getElementById('transfDestino') || {}).value;
  const valor =
    typeof parseBRL === 'function'
      ? parseBRL((document.getElementById('transfValor') || {}).value)
      : 0;
  const dataStr = (document.getElementById('transfData') || {}).value;
  if (!origemId || !destinoId)
    return mostrarToast('Escolha as contas de origem e destino.', 'erro');
  if (origemId === destinoId) return mostrarToast('Origem e destino devem ser diferentes.', 'erro');
  if (!(valor > 0)) return mostrarToast('Informe um valor válido.', 'erro');
  // criarTransferencia recusa por saldo devolvendo null; a mensagem genérica
  // não diria ao usuário o que fazer, então o caso provável é explicado aqui.
  if (typeof mpCalcularSaldoPorInstituicao === 'function') {
    const saldos = mpCalcularSaldoPorInstituicao(Date.now()) || {};
    const caixa = saldos[origemId] ? saldos[origemId].caixa : 0;
    if (valor > caixa + 0.005) {
      const fmt = typeof formatarMoeda === 'function' ? formatarMoeda : (v) => 'R$ ' + v;
      return mostrarToast(`Saldo insuficiente: a conta de origem tem ${fmt(caixa)}.`, 'erro');
    }
  }
  const r = criarTransferencia(origemId, destinoId, valor, dataStr);
  if (!r) return mostrarToast('Não foi possível registrar a transferência.', 'erro');
  if (typeof fecharModal === 'function') fecharModal();
  mostrarToast('Transferência registrada.', 'sucesso');
  if (typeof renderMeuPatrimonio === 'function') renderMeuPatrimonio(true);
  if (typeof atualizarTelaControle === 'function') atualizarTelaControle();
}

// Contrato público explícito em window (classic script já vaza var; deixamos
// claro o que o módulo expõe para os demais arquivos e para a Fase 2).
if (typeof window !== 'undefined') {
  window.contas = contas;
  window.CONTA_TIPOS = CONTA_TIPOS;
  window.salvarContas = salvarContas;
  window.criarConta = criarConta;
  window.obterConta = obterConta;
  window.obterContaPorNome = obterContaPorNome;
  window.obterOuCriarContaPorNome = obterOuCriarContaPorNome;
  window.obterContaPorNomeOuAlias = obterContaPorNomeOuAlias;
  window.resolverContaDeTransacao = resolverContaDeTransacao;
  window.resolverContaDeOperacao = resolverContaDeOperacao;
  window.editarConta = editarConta;
  window.arquivarConta = arquivarConta;
  window.fundirContas = fundirContas;
  window.contasAtivas = contasAtivas;
  window.saldoCaixaPorConta = saldoCaixaPorConta;
  window.contasComSaldo = contasComSaldo;
  window.optionsContasComSaldo = optionsContasComSaldo;
  window.appliqueiNormalizarNomeConta = appliqueiNormalizarNomeConta;
  window.appliqueiSeedContasDeStrings = appliqueiSeedContasDeStrings;
  // UI "Minhas Contas"
  window.renderMinhasContas = renderMinhasContas;
  window.abrirNovaContaForm = abrirNovaContaForm;
  window.cancelarFormConta = cancelarFormConta;
  window.editarContaForm = editarContaForm;
  window.salvarFormConta = salvarFormConta;
  window.arquivarContaUI = arquivarContaUI;
  window.restaurarContaUI = restaurarContaUI;
  window.fundirContaPrompt = fundirContaPrompt;
  window.confirmarFusaoUI = confirmarFusaoUI;
  window.abrirTransferenciaModal = abrirTransferenciaModal;
  window.confirmarTransferencia = confirmarTransferencia;
  window.criarTransferencia = criarTransferencia;
}
