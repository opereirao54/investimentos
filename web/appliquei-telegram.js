/**
 * Appliquei — Lançar pelo Telegram (lado do app).
 *
 * O bot (api/_lib/telegram-bot.js) NÃO grava nas transações: deixa cada
 * lançamento numa caixa de entrada no servidor. Este arquivo:
 *   1. busca a caixa (GET /api/user?op=telegram-inbox),
 *   2. aplica cada item pelo MESMO criarLancamentos() do formulário,
 *   3. salva, e só então confirma ao servidor que pode apagar os itens.
 * Se a confirmação falhar, a próxima busca traz os mesmos itens — e eles são
 * reconhecidos pelo id fixo (`tg<chat>_<msg>_<n>`) e não duplicam.
 *
 * Também desenha a seção "Lançar pelo Telegram" em Configurações: conectar,
 * desconectar e escolher a CONTA PRINCIPAL (de onde sai o dinheiro quando a
 * mensagem não cita conta). A conta principal é a flag `principal: true` em
 * `contas` — sincronizada como o resto, e lida pelo bot direto do servidor.
 *
 * Classic script: depende de transacoes/cartoes/contas, criarLancamentos,
 * validarLancamento, salvarTransacoes, salvarContas, cartaoFaturasCandidatas,
 * faturaYmd e mostrarToast, todos declarados nos arquivos carregados antes.
 */

// Lançamentos já aplicados e desfeitos, por id do item. Sincronizado (prefixo
// appliquei_) para que dois aparelhos abertos não reapliquem o que o outro já
// tratou, nem ressuscitem um lançamento desfeito.
var TELEGRAM_CHAVE_HISTORICO = 'appliquei_telegram_historico';
var TELEGRAM_HISTORICO_MAX = 400;
var TELEGRAM_INTERVALO_MS = 2 * 60 * 1000;

var telegramEstado = { conectado: null, bot: null, nome: null, username: null };
var telegramAplicando = false;
var telegramTimer = null;
var telegramLinkAtual = null;

// No navegador timers são números; no Node (testes) o unref deixa o processo
// terminar sem esperar a próxima tentativa.
function telegramSemPrender(h) {
  if (h && typeof h.unref === 'function') h.unref();
  return h;
}

// ─── utilidades ─────────────────────────────────────────────────────────────

function telegramLerHistorico() {
  try {
    var h = JSON.parse(localStorage.getItem(TELEGRAM_CHAVE_HISTORICO) || '{}');
    return {
      aplicados: Array.isArray(h.aplicados) ? h.aplicados : [],
      desfeitos: Array.isArray(h.desfeitos) ? h.desfeitos : [],
    };
  } catch (e) {
    return { aplicados: [], desfeitos: [] };
  }
}

function telegramSalvarHistorico(h) {
  try {
    localStorage.setItem(
      TELEGRAM_CHAVE_HISTORICO,
      JSON.stringify({
        aplicados: h.aplicados.slice(-TELEGRAM_HISTORICO_MAX),
        desfeitos: h.desfeitos.slice(-TELEGRAM_HISTORICO_MAX),
      })
    );
  } catch (e) {}
}

function telegramYmdParaData(ymd) {
  var p = String(ymd || '').split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function telegramYmd(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

// Próximo dia N a partir da data da compra (o próprio mês, se ainda não
// passou; senão o seguinte). Dia 31 em mês curto vira o último dia.
function telegramProximoDia(base, dia) {
  var ano = base.getFullYear();
  var mes = base.getMonth();
  if (base.getDate() > dia) mes += 1;
  var ultimo = new Date(ano, mes + 1, 0).getDate();
  return new Date(ano, mes, Math.min(dia, ultimo));
}

function telegramContasDeCaixa() {
  return (typeof contas !== 'undefined' ? contas : []).filter(function (c) {
    return c && !c.arquivada && c.tipo !== 'corretora';
  });
}

/** Mesma regra do bot: a marcada; se só houver uma conta de caixa, ela. */
function telegramContaPrincipal() {
  var caixa = telegramContasDeCaixa();
  var marcada = caixa.find(function (c) {
    return c.principal === true;
  });
  return marcada || (caixa.length === 1 ? caixa[0] : null);
}

function telegramDefinirContaPrincipal(id) {
  var mudou = false;
  (typeof contas !== 'undefined' ? contas : []).forEach(function (c) {
    var deve = c.id === id;
    if (deve && c.principal !== true) {
      c.principal = true;
      mudou = true;
    } else if (!deve && c.principal) {
      delete c.principal;
      mudou = true;
    }
  });
  if (mudou && typeof salvarContas === 'function') salvarContas();
  return mudou;
}

// ─── aplicação da caixa de entrada ──────────────────────────────────────────

/**
 * Converte o lançamento vindo do bot nos `dados` de criarLancamentos. Devolve
 * {dados} ou {erro}. Separada para teste.
 */
function telegramMontarDados(item) {
  var l = item.lanc || {};
  var compra = telegramYmdParaData(l.dataCompra) || new Date();
  var hoje = new Date();
  // Compra de hoje fica com a hora real; compra passada, meio-dia do dia dela.
  var agora = telegramYmd(compra) === telegramYmd(hoje) ? hoje : compra;
  var dados = {
    descricao: String(l.descricao || '').slice(0, 80),
    valor: Number(l.valor),
    categoria: l.categoria,
    fixo: !!l.fixo,
    parcelas: l.parcelas || 1,
    tipoCartao: l.categoria === 'cartao_credito' ? l.tipoCartao || 'parcelado' : '',
    cartaoId: l.categoria === 'cartao_credito' ? l.cartaoId : null,
    banco: null,
    contaId: undefined,
    categoriaDespesa: l.categoriaDespesa || undefined,
    obs: 'via Telegram',
    dataVencimento: '',
    mesBase: compra.getMonth(),
    anoBase: compra.getFullYear(),
    idBase: item.id + '_',
    agora: agora,
  };

  if (l.categoria === 'cartao_credito') {
    // Busca exata, NÃO obterCartao(): ele cai no primeiro cartão quando o id
    // não existe, e a compra entraria na fatura de outro cartão (INV-20).
    var cartao = (typeof cartoes !== 'undefined' ? cartoes : []).find(function (c) {
      return c && c.id === l.cartaoId;
    });
    if (!cartao || cartao.arquivado) return { erro: 'cartao_sumiu' };
    // A fatura ABERTA na data da compra — o padrão do formulário.
    var cand =
      typeof cartaoFaturasCandidatas === 'function'
        ? cartaoFaturasCandidatas(compra, cartao.diaFechamento, cartao.diaVencimento)
        : null;
    if (cand) dados.dataVencimento = telegramYmd(cand.aberta.vencimento);
  } else {
    // A conta pelo id; renomeada ou apagada desde a mensagem, pelo nome; se
    // nem isso, a principal de agora.
    var caixa = telegramContasDeCaixa();
    var conta =
      caixa.find(function (c) {
        return c.id === l.contaId;
      }) ||
      (l.banco && typeof obterOuCriarContaPorNome === 'function'
        ? obterOuCriarContaPorNome(l.banco)
        : null) ||
      telegramContaPrincipal();
    if (!conta) return { erro: 'sem_conta' };
    dados.banco = conta.nome;
    dados.contaId = conta.id;
    if (l.diaVencimento)
      dados.dataVencimento = telegramYmd(telegramProximoDia(compra, l.diaVencimento));
  }

  var erro = typeof validarLancamento === 'function' ? validarLancamento(dados) : null;
  if (erro) return { erro: erro };
  return { dados: dados };
}

// Formato do id que o servidor gera: tg<chat>_<mensagem>. Qualquer outra
// coisa é recusada ANTES de tocar em transações — um alvo curto como "sim"
// casaria por prefixo com transações que não vieram do Telegram e as apagaria
// (a simulação pegou exatamente isso: desfazer "sim" levava sim_receita junto).
var TELEGRAM_RE_ID = /^tg\d+_\d+$/;

function telegramIdValido(id) {
  return typeof id === 'string' && TELEGRAM_RE_ID.test(id);
}

function telegramDoItem(t, id) {
  return telegramIdValido(id) && t && typeof t.id === 'string' && t.id.indexOf(id + '_') === 0;
}

// Entradas não se "pagam": a agenda de vencimentos do app não as lista, e o
// bot nunca oferece "Já paguei" para elas. Conferido de novo aqui porque os
// alvos vêm do servidor.
function telegramPagavel(t) {
  if (!t || !t.dataVencimento) return false;
  var c = t.categoria;
  return !(
    c === 'receita' ||
    c === 'dividendo' ||
    c === 'resgate_investimento' ||
    c === 'transferencia_entrada'
  );
}

/**
 * "✅ Já paguei" de um alerta do bot: dá baixa nos alvos pela MESMA regra do
 * botão Baixar (marcarTransacaoPaga + efeitosDoPagamento: conta pagadora do
 * cartão, aporte do sonho, posição do compromisso). Alvo que não existe mais,
 * já pago, ou que não é conta a pagar fica como está. Devolve quantos pagou.
 */
function telegramPagar(alvos) {
  var ids = Array.isArray(alvos) ? alvos.slice(0, 200) : [];
  var pagas = [];
  ids.forEach(function (id) {
    var t = transacoes.find(function (x) {
      return x && x.id === id;
    });
    if (!t || t.pago || !telegramPagavel(t)) return;
    marcarTransacaoPaga(t);
    // Só o que o Telegram pagou pode ser despago pelo Telegram.
    t.pagoVia = 'telegram';
    pagas.push(t);
  });
  pagas.forEach(function (t) {
    if (typeof efeitosDoPagamento === 'function') efeitosDoPagamento(t);
  });
  return pagas.length;
}

/**
 * "↩️ Desfazer" do "Já paguei": volta para a pagar o que o Telegram pagou e
 * cuja baixa é só o flag (controlePodeReverterPagamento — sonho e compromisso
 * geram aporte e são revertidos na aba deles, como no app).
 */
function telegramDespagar(alvos) {
  var ids = Array.isArray(alvos) ? alvos.slice(0, 200) : [];
  var n = 0;
  ids.forEach(function (id) {
    var t = transacoes.find(function (x) {
      return x && x.id === id;
    });
    if (!t || !t.pago || t.pagoVia !== 'telegram') return;
    if (typeof controlePodeReverterPagamento === 'function' && !controlePodeReverterPagamento(t))
      return;
    t.pago = false;
    delete t.pagoEm;
    delete t.pagoVia;
    n++;
  });
  return n;
}

/**
 * Aplica os itens da caixa de entrada. Devolve {confirmar, lancados, desfeitos,
 * recusados}. NÃO chama a rede: quem chama confirma `confirmar` ao servidor
 * depois de salvo.
 */
function telegramAplicarItens(itens) {
  var hist = telegramLerHistorico();
  var r = { confirmar: [], lancados: 0, desfeitos: 0, recusados: [], pagos: 0 };
  var mudou = false;
  var ordenados = (itens || []).slice().sort(function (a, b) {
    return (a.criadoEmMs || 0) - (b.criadoEmMs || 0);
  });

  ordenados.forEach(function (item) {
    if (!item || !item.id) return;
    if (item.tipo === 'lancamento' && !telegramIdValido(item.id)) {
      r.confirmar.push(item.id);
      return;
    }
    if (item.tipo === 'lancamento') {
      var jaAplicado =
        hist.aplicados.indexOf(item.id) !== -1 ||
        transacoes.some(function (t) {
          return telegramDoItem(t, item.id);
        });
      if (jaAplicado || hist.desfeitos.indexOf(item.id) !== -1) {
        r.confirmar.push(item.id);
        return;
      }
      var m = telegramMontarDados(item);
      if (m.erro) {
        // Confirma mesmo assim: um item que nunca vai entrar não pode travar
        // a caixa para sempre. O usuário é avisado e manda de novo.
        r.recusados.push({ id: item.id, erro: m.erro, descricao: (item.lanc || {}).descricao });
        r.confirmar.push(item.id);
        return;
      }
      var novos = criarLancamentos(m.dados);
      novos.forEach(function (t) {
        transacoes.push(t);
      });
      hist.aplicados.push(item.id);
      r.confirmar.push(item.id);
      r.lancados++;
      mudou = true;
    } else if (item.tipo === 'desfazer' && item.alvo) {
      var antes = transacoes.length;
      for (var i = transacoes.length - 1; i >= 0; i--) {
        if (telegramDoItem(transacoes[i], item.alvo)) transacoes.splice(i, 1);
      }
      if (transacoes.length !== antes) {
        r.desfeitos++;
        mudou = true;
      }
      if (hist.desfeitos.indexOf(item.alvo) === -1) hist.desfeitos.push(item.alvo);
      r.confirmar.push(item.id);
    } else if (item.tipo === 'pagar') {
      var p = telegramPagar(item.alvos);
      if (p) {
        r.pagos += p;
        mudou = true;
      }
      r.confirmar.push(item.id);
    } else if (item.tipo === 'despagar') {
      if (telegramDespagar(item.alvos)) mudou = true;
      r.confirmar.push(item.id);
    } else if (item.tipo === 'categoria' && item.alvo) {
      transacoes.forEach(function (t) {
        if (telegramDoItem(t, item.alvo) && t.categoriaDespesa !== item.categoriaDespesa) {
          t.categoriaDespesa = item.categoriaDespesa || undefined;
          mudou = true;
        }
      });
      r.confirmar.push(item.id);
    } else if (item.tipo === 'descricao' && item.alvo && typeof item.descricao === 'string') {
      // ✏️ Descrição no bot. A parcela "(2/10)" é do app, não da descrição:
      // fica no fim de cada parcela.
      var nova = item.descricao.trim().slice(0, 60);
      if (nova) {
        transacoes.forEach(function (t) {
          if (!telegramDoItem(t, item.alvo)) return;
          var parcela = (String(t.descricao || '').match(/\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*$/) || [
            '',
          ])[0];
          var final = nova + parcela;
          if (t.descricao !== final) {
            t.descricao = final;
            mudou = true;
          }
        });
      }
      r.confirmar.push(item.id);
    } else {
      r.confirmar.push(item.id);
    }
  });

  if (mudou && typeof salvarTransacoes === 'function') {
    if (!salvarTransacoes({ flush: true })) {
      // Não gravou no aparelho: não confirma nada, a próxima busca tenta de novo.
      return { confirmar: [], lancados: 0, desfeitos: 0, recusados: [], pagos: 0, falhou: true };
    }
  }
  telegramSalvarHistorico(hist);
  r.mudou = mudou;
  return r;
}

// ─── rede ───────────────────────────────────────────────────────────────────

function telegramUsuario() {
  var fb = window.AppliqueiFirebase;
  return (fb && fb.auth && fb.auth.currentUser) || null;
}

function telegramApi(op, opcoes) {
  var u = telegramUsuario();
  if (!u) return Promise.reject(new Error('sem_sessao'));
  var o = opcoes || {};
  return u.getIdToken().then(function (token) {
    return fetch('/api/user?op=' + op, {
      method: o.method || 'GET',
      headers: Object.assign(
        { Authorization: 'Bearer ' + token },
        o.body ? { 'Content-Type': 'application/json' } : {}
      ),
      body: o.body ? JSON.stringify(o.body) : undefined,
      credentials: 'same-origin',
    }).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (j) {
          if (r.ok) return j;
          var e = new Error(j.error || 'http_' + r.status);
          e.status = r.status;
          throw e;
        });
    });
  });
}

var TELEGRAM_ERROS = {
  cartao_sumiu: 'o cartão não existe mais',
  sem_conta: 'não há conta principal',
  dados_invalidos: 'dados incompletos',
  banco_obrigatorio: 'sem conta',
  cartao_invalido: 'cartão inválido',
};

/** Redesenha a tela e conta ao usuário o que entrou (ou não) do Telegram. */
function telegramAvisar(r) {
  if (!r) return;
  if (r.mudou && typeof atualizarTelaControle === 'function') {
    try {
      atualizarTelaControle();
    } catch (e) {}
  }
  if (r.lancados && typeof mostrarToast === 'function') {
    mostrarToast(
      r.lancados === 1
        ? '📲 1 lançamento do Telegram entrou.'
        : '📲 ' + r.lancados + ' lançamentos do Telegram entraram.',
      'sucesso'
    );
  }
  if (r.pagos && typeof mostrarToast === 'function') {
    mostrarToast(
      r.pagos === 1
        ? '📲 1 pagamento marcado pelo Telegram.'
        : '📲 ' + r.pagos + ' pagamentos marcados pelo Telegram.',
      'sucesso'
    );
  }
  if (r.recusados && r.recusados.length && typeof mostrarToast === 'function') {
    var x = r.recusados[0];
    mostrarToast(
      'Não lancei "' +
        (x.descricao || 'item') +
        '" do Telegram: ' +
        (TELEGRAM_ERROS[x.erro] || x.erro) +
        '. Mande de novo.',
      'erro',
      6000
    );
  }
}

function telegramBuscarEAplicar() {
  if (telegramAplicando) return Promise.resolve(null);
  if (!telegramUsuario()) return Promise.resolve(null);
  var cs = window.AppliqueiCloudSync;
  // Antes do primeiro pull o localStorage pode ser o de um aparelho vazio — e o
  // pull termina recarregando a página. Aplicar agora seria gravar sobre nada.
  if (cs && typeof cs.pullInicialConcluido === 'function' && !cs.pullInicialConcluido()) {
    return Promise.resolve(null);
  }
  telegramAplicando = true;
  return telegramApi('telegram-inbox')
    .then(function (j) {
      var itens = (j && j.itens) || [];
      if (!itens.length) return null;
      var r = telegramAplicarItens(itens);
      telegramAvisar(r);
      if (!r.confirmar.length) return r;
      return telegramApi('telegram-inbox', { method: 'POST', body: { ids: r.confirmar } })
        .catch(function () {})
        .then(function () {
          return r;
        });
    })
    .catch(function (e) {
      // 401/403: sessão ou assinatura — para de insistir até o próximo boot.
      if (e && (e.status === 401 || e.status === 403)) telegramPararPolling();
      return null;
    })
    .then(function (r) {
      telegramAplicando = false;
      return r;
    });
}

function telegramPararPolling() {
  if (telegramTimer) clearInterval(telegramTimer);
  telegramTimer = null;
}

function telegramIniciarPolling() {
  if (telegramTimer) return;
  telegramBuscarEAplicar();
  telegramTimer = telegramSemPrender(
    setInterval(function () {
      if (document.visibilityState === 'visible') telegramBuscarEAplicar();
    }, TELEGRAM_INTERVALO_MS)
  );
}

function telegramAtualizarStatus() {
  return telegramApi('telegram-status')
    .then(function (j) {
      telegramEstado = {
        conectado: !!j.conectado,
        bot: j.bot || null,
        nome: j.nome || null,
        username: j.username || null,
      };
      // Mesmo desconectado busca a caixa uma vez: pode ter sobrado algo
      // lançado antes de desconectar.
      if (telegramEstado.conectado) telegramIniciarPolling();
      else {
        telegramPararPolling();
        telegramBuscarEAplicar();
      }
      telegramRenderConfig();
      // Página de boas-vindas do guia (appliquei-primeiros-passos.js): mostra
      // "conectado" na volta do Telegram, ou sai da frente de quem já tinha
      // conectado antes (o status chega depois de o convite abrir).
      if (typeof ppTelegramStatusMudou === 'function') ppTelegramStatusMudou();
      return telegramEstado;
    })
    .catch(function () {
      return null;
    });
}

// Boot: espera login + primeiro pull (até ~2 min), uma vez.
(function telegramBoot() {
  var tentativas = 0;
  function tentar() {
    tentativas++;
    var cs = window.AppliqueiCloudSync;
    var pronto =
      telegramUsuario() &&
      (!cs || typeof cs.pullInicialConcluido !== 'function' || cs.pullInicialConcluido());
    if (pronto) return telegramAtualizarStatus();
    if (tentativas < 60) telegramSemPrender(setTimeout(tentar, 2000));
  }
  telegramSemPrender(setTimeout(tentar, 1500));
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      // Voltou do Telegram depois de tocar em "Conectar": confere o status.
      if (telegramLinkAtual) {
        telegramLinkAtual = null;
        telegramAtualizarStatus();
      } else if (telegramEstado.conectado) telegramBuscarEAplicar();
    });
  } catch (e) {}
})();

// ─── Configurações ──────────────────────────────────────────────────────────

function telegramEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function telegramRenderConfig() {
  var el = document.getElementById('telegramConfig');
  if (!el) return;
  var caixa = telegramContasDeCaixa();
  var principal = telegramContaPrincipal();
  var marcada = caixa.some(function (c) {
    return c.principal === true;
  });

  var opcoes =
    '<option value=""' +
    (principal ? '' : ' selected') +
    ' disabled>Escolha a conta…</option>' +
    caixa
      .map(function (c) {
        return (
          '<option value="' +
          telegramEsc(c.id) +
          '"' +
          (principal && principal.id === c.id ? ' selected' : '') +
          '>' +
          telegramEsc(c.nome) +
          '</option>'
        );
      })
      .join('');

  var seletor = caixa.length
    ? '<div class="form-group" style="margin-bottom:10px;"><label style="font-size:11px;">Conta principal</label>' +
      '<select id="telegramContaPrincipal" onchange="telegramAoTrocarContaPrincipal(this.value)">' +
      opcoes +
      '</select>' +
      '<span style="display:block;font-size:10.5px;color:var(--cor-texto-mutado);margin-top:3px;line-height:1.4;">' +
      'De onde sai (ou para onde entra) o dinheiro quando a mensagem não cita a conta.' +
      (principal && !marcada ? ' Hoje é a sua única conta.' : '') +
      '</span></div>'
    : '<p style="font-size:12px;color:var(--cor-txt-amber);margin-bottom:10px;">Cadastre uma conta (banco ou carteira) antes: é dela que sai o dinheiro dos lançamentos.</p>';

  var status;
  if (telegramEstado.conectado === null) {
    status =
      '<p style="font-size:12px;color:var(--cor-texto-mutado);margin-bottom:10px;">Verificando…</p>';
  } else if (telegramEstado.conectado) {
    var quem = telegramEstado.username
      ? '@' + telegramEstado.username
      : telegramEstado.nome || 'seu Telegram';
    status =
      '<p style="font-size:12.5px;color:var(--cor-txt-verde, var(--cor-texto-principal));margin-bottom:10px;">' +
      '<i class="ph ph-check-circle"></i> Conectado a <strong>' +
      telegramEsc(quem) +
      '</strong>' +
      (telegramEstado.bot
        ? ' · converse com <a href="https://t.me/' +
          telegramEsc(telegramEstado.bot) +
          '" target="_blank" rel="noopener">@' +
          telegramEsc(telegramEstado.bot) +
          '</a>'
        : '') +
      '</p>' +
      '<button class="btn-secundario" style="width:100%;padding:8px;font-size:12px;" onclick="telegramDesconectar()"><i class="ph ph-plugs"></i> Desconectar</button>';
  } else {
    status =
      '<div id="telegramLinkArea"></div>' +
      '<button class="btn-acao" id="btnTelegramConectar" style="width:100%;padding:9px;font-size:12.5px;background:var(--cor-info);" onclick="telegramConectar()"' +
      (principal ? '' : ' disabled title="Escolha a conta principal primeiro"') +
      '><i class="ph ph-telegram-logo"></i> Conectar Telegram</button>';
  }

  el.innerHTML =
    '<p style="font-size:12px;color:var(--cor-texto-mutado);margin-bottom:10px;line-height:1.5;">' +
    'Mande <code>mercado 52,90</code> para o bot e a despesa entra aqui. Funciona para receitas, ' +
    'despesas fixas e compras no cartão (<code>nubank 300 tênis 3x</code>).</p>' +
    seletor +
    status;
}

function telegramAoTrocarContaPrincipal(id) {
  if (!id) return;
  telegramDefinirContaPrincipal(id);
  if (typeof mostrarToast === 'function') mostrarToast('Conta principal definida.', 'sucesso');
  telegramRenderConfig();
}

/**
 * Pede ao servidor um link de conexão (uso único, 15 min). Devolve
 * {url, bot, codigo}. Usado pelas Configurações e pela página de boas-vindas
 * do guia (appliquei-primeiros-passos.js).
 */
function telegramGerarLink() {
  return telegramApi('telegram-link', { method: 'POST', body: {} }).then(function (j) {
    // Ao voltar do Telegram, o visibilitychange do boot confere o status.
    telegramLinkAtual = j.url;
    return j;
  });
}

function telegramMensagemErroLink(e) {
  return e && e.message === 'telegram_nao_configurado'
    ? 'O Telegram ainda não foi configurado no servidor.'
    : 'Não consegui gerar o link agora. Tente de novo.';
}

function telegramConectar() {
  var btn = document.getElementById('btnTelegramConectar');
  if (btn) btn.disabled = true;
  telegramGerarLink()
    .then(function (j) {
      var area = document.getElementById('telegramLinkArea');
      // Link em vez de window.open: abrir janela depois de um await é
      // bloqueado como pop-up em vários navegadores.
      if (area) {
        area.innerHTML =
          '<a class="btn-acao" href="' +
          telegramEsc(j.url) +
          '" target="_blank" rel="noopener" style="display:flex;justify-content:center;align-items:center;gap:6px;width:100%;padding:10px;font-size:13px;background:var(--cor-primaria);color:#fff;text-decoration:none;border-radius:9px;margin-bottom:8px;">' +
          '<i class="ph ph-telegram-logo"></i> Abrir o Telegram e tocar em Iniciar</a>' +
          '<p style="font-size:11px;color:var(--cor-texto-mutado);margin-bottom:8px;line-height:1.5;">' +
          'O link vale 15 minutos. Se o botão não abrir, procure <strong>@' +
          telegramEsc(j.bot) +
          '</strong> no Telegram e mande:<br><code style="user-select:all;">/start ' +
          telegramEsc(j.codigo) +
          '</code></p>';
      }
      if (btn) btn.style.display = 'none';
    })
    .catch(function (e) {
      if (btn) btn.disabled = false;
      if (typeof mostrarToast === 'function') mostrarToast(telegramMensagemErroLink(e), 'erro');
    });
}

function telegramDesconectar() {
  telegramApi('telegram-unlink', { method: 'POST', body: {} })
    .then(function () {
      telegramEstado.conectado = false;
      telegramPararPolling();
      telegramRenderConfig();
      if (typeof mostrarToast === 'function') mostrarToast('Telegram desconectado.', 'sucesso');
    })
    .catch(function () {
      if (typeof mostrarToast === 'function')
        mostrarToast('Não consegui desconectar agora. Tente de novo.', 'erro');
    });
}

/** Chamada por abrirModalConfig(). */
function telegramAoAbrirConfig() {
  telegramRenderConfig();
  if (telegramUsuario()) telegramAtualizarStatus();
}
