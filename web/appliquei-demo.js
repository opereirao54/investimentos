/**
 * Modo demonstração — mostrar o app a alguém sem mostrar as suas finanças.
 *
 * Entra por /demo (ou ?demo=1). É o PRIMEIRO script da página, síncrono, e
 * roda antes de qualquer outro tocar no armazenamento. Três travas, cada uma
 * suficiente sozinha para os dados reais não aparecerem nem serem estragados:
 *
 *   1. ARMAZENAMENTO EM MEMÓRIA. `localStorage` e `sessionStorage` passam a
 *      ser objetos que vivem só nesta aba, já com os dados fictícios. O
 *      armazenamento real do navegador nem é lido: os seus lançamentos não
 *      chegam à tela, e nada do que se fizer na demonstração é gravado nele.
 *      Fechou ou recarregou, volta ao começo.
 *   2. SEM NUVEM. `window.__APPLIQUEI_DEMO__` faz o Firebase não inicializar
 *      (sem login, nada de puxar a sua conta) e o sync não enviar nada —
 *      a demonstração jamais pode sobrescrever os dados da sua conta.
 *   3. SEM SERVIDOR. Chamadas a /api ficam bloqueadas, exceto cotações e
 *      logos (públicas, sem dado de ninguém).
 *
 * Se o navegador não deixar trocar o armazenamento (trava 1), a página para
 * e explica — abrir o app "normal" no lugar mostraria exatamente o que a
 * pessoa quis esconder.
 */
(function () {
  'use strict';
  var w = window;
  var ehDemo = false;
  try {
    ehDemo = /^\/demo\/?$/.test(location.pathname) || /(?:\?|&)demo=1(?:&|$)/.test(location.search);
  } catch (_) {}
  if (!ehDemo) return;

  w.__APPLIQUEI_DEMO__ = true;

  // ── 1. Armazenamento em memória ─────────────────────────────────────────
  // Mesma interface do Storage do navegador, inclusive length/key(i), que o
  // app usa para percorrer as chaves.
  function MemStorage() {
    this.__d = Object.create(null);
    this.__k = [];
  }
  MemStorage.prototype.getItem = function (k) {
    k = String(k);
    return k in this.__d ? this.__d[k] : null;
  };
  MemStorage.prototype.setItem = function (k, v) {
    k = String(k);
    if (!(k in this.__d)) this.__k.push(k);
    this.__d[k] = String(v);
  };
  MemStorage.prototype.removeItem = function (k) {
    k = String(k);
    if (!(k in this.__d)) return;
    delete this.__d[k];
    this.__k.splice(this.__k.indexOf(k), 1);
  };
  MemStorage.prototype.clear = function () {
    this.__d = Object.create(null);
    this.__k = [];
  };
  MemStorage.prototype.key = function (i) {
    return i >= 0 && i < this.__k.length ? this.__k[i] : null;
  };
  Object.defineProperty(MemStorage.prototype, 'length', {
    get: function () {
      return this.__k.length;
    },
  });

  // Gravação crua, guardada antes de appliquei-utils.js instrumentar o
  // protótipo: semear não é "o usuário mudou algo" e não deve avisar ninguém.
  var gravarCru = MemStorage.prototype.setItem;
  var local = new MemStorage();
  var sessao = new MemStorage();
  var isolado = false;
  try {
    Object.defineProperty(w, 'localStorage', {
      configurable: true,
      get: function () {
        return local;
      },
    });
    Object.defineProperty(w, 'sessionStorage', {
      configurable: true,
      get: function () {
        return sessao;
      },
    });
    isolado = w.localStorage === local && w.sessionStorage === sessao;
  } catch (_) {
    isolado = false;
  }
  if (!isolado) {
    try {
      document.documentElement.innerHTML =
        '<body style="font-family:sans-serif;padding:32px;line-height:1.5">' +
        '<h2>Modo demonstração indisponível neste navegador</h2>' +
        '<p>Não foi possível separar os dados de demonstração dos seus. Para não mostrar as suas finanças, o app não foi aberto.</p>' +
        '<p>Tente pelo Chrome, Edge, Firefox ou Safari atualizados.</p></body>';
      if (typeof w.stop === 'function') w.stop();
    } catch (_) {}
    throw new Error('[demo] armazenamento não pôde ser isolado');
  }

  // ── 3. Servidor: só o que é público ────────────────────────────────────
  function apiPermitida(url) {
    var u;
    try {
      u = new URL(String(url), location.href);
    } catch (_) {
      return false;
    }
    if (u.origin !== location.origin) return true; // CDN, cotações externas
    if (u.pathname.indexOf('/api/') !== 0) return true; // arquivos do app
    return /^\/api\/(market|logo)(\/|$|\?)/.test(u.pathname);
  }
  var fetchOriginal = w.fetch;
  if (typeof fetchOriginal === 'function') {
    w.fetch = function (input, init) {
      var url = input && typeof input === 'object' && 'url' in input ? input.url : input;
      if (!apiPermitida(url)) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Indisponível no modo demonstração.' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return fetchOriginal.apply(this, arguments);
    };
  }
  try {
    var beaconOriginal = navigator.sendBeacon;
    if (typeof beaconOriginal === 'function') {
      navigator.sendBeacon = function (url) {
        if (!apiPermitida(url)) return true; // finge que enviou; não envia
        return beaconOriginal.apply(navigator, arguments);
      };
    }
  } catch (_) {}

  // ── Dados fictícios ─────────────────────────────────────────────────────
  // Relativos a hoje, para a demonstração nunca envelhecer: seis meses de
  // história e doze à frente (a Projeção e os vencimentos precisam do futuro).
  //
  // Semeia em DOIS tempos. O isolamento acima tem de vir antes de tudo; os
  // dados, depois de appliquei-utils.js (que traz o calendário de dias
  // úteis) e antes de appliquei-app.js (que lê o armazenamento ao carregar).
  // O HTML chama appliqueiDemoSemear() entre os dois.
  var semeado = false;
  w.appliqueiDemoSemear = function (hoje) {
    if (semeado) return;
    semeado = true;
    semear(
      {
        setItem: function (k, v) {
          gravarCru.call(local, k, v);
        },
      },
      hoje || new Date()
    );
  };

  function semear(st, hoje) {
    var dd = function (n) {
      return String(n).padStart(2, '0');
    };
    var ymd = function (d) {
      return d.getFullYear() + '-' + dd(d.getMonth() + 1) + '-' + dd(d.getDate());
    };
    var noMes = function (ano, mes, dia) {
      var ultimo = new Date(ano, mes + 1, 0).getDate();
      return new Date(ano, mes, Math.min(dia, ultimo));
    };
    var hojeYmd = ymd(hoje);
    var agoraIso = hoje.toISOString();
    var inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 6, 1);

    var contas = [
      { id: 'demo_nu', nome: 'Nubank', tipo: 'banco', saldoInicial: 6200 },
      { id: 'demo_itau', nome: 'Itaú', tipo: 'banco', saldoInicial: 2400 },
      { id: 'demo_rico', nome: 'Rico', tipo: 'corretora', saldoInicial: 0 },
    ].map(function (c) {
      return Object.assign(c, {
        // Saldo de abertura antigo: a evolução do patrimônio parte de uma
        // pessoa que já tinha conta, não de zero há seis meses.
        dataSaldoInicial: ymd(new Date(hoje.getFullYear() - 2, hoje.getMonth(), 1)),
        cor: null,
        arquivada: false,
        criadaEm: agoraIso,
        atualizadaEm: agoraIso,
      });
    });
    var NU = { banco: 'Nubank', contaId: 'demo_nu' };
    var ITAU = { banco: 'Itaú', contaId: 'demo_itau' };

    var cartoes = [
      {
        id: 'demo_card_nu',
        nome: 'Nubank Roxinho',
        limite: 9000,
        diaFechamento: 28,
        diaVencimento: 5,
        contaPagadoraId: 'demo_nu',
      },
    ];

    var tx = [];
    var seq = 0;
    // Lança no dia `dia` do mês (ano, mes). Saída que já venceu nasce paga,
    // na data do vencimento — como se a pessoa tivesse dado baixa em dia.
    function lanc(desc, valor, categoria, ano, mes, dia, extra) {
      var d = noMes(ano, mes, dia);
      var venc = ymd(d);
      var entrada = categoria === 'receita';
      var paga = !entrada && venc <= hojeYmd;
      var t = Object.assign(
        {
          id: 'demo' + seq++,
          groupId: null,
          descricao: desc,
          valor: Math.round(valor * 100) / 100,
          categoria: categoria,
          mes: d.getMonth(),
          ano: d.getFullYear(),
          data: venc + 'T12:00:00.000Z',
          dataVencimento: venc,
          pago: paga,
          obs: '',
        },
        extra || {}
      );
      if (paga) t.pagoEm = venc + 'T12:00:00.000Z';
      tx.push(t);
      return t;
    }

    // Variação suave e determinística (nada de Math.random: a mesma
    // demonstração em toda abertura, e os testes podem conferir valores).
    function oscila(base, i, amp) {
      return base * (1 + amp * Math.sin(i * 1.7));
    }

    for (var k = -6; k <= 12; k++) {
      var ref = new Date(hoje.getFullYear(), hoje.getMonth() + k, 1);
      var a = ref.getFullYear();
      var m = ref.getMonth();
      var passadoOuAtual = k <= 0;

      // Salário de quinzena (15 e 30), antecipado quando cai em folga — a
      // regra de dia útil, que é a vitrine para quem recebe assim.
      [
        [15, 'demo_g_sal15'],
        [30, 'demo_g_sal30'],
      ].forEach(function (q) {
        var regra = { tipo: 'util_anterior', dia: q[0] };
        var venc =
          typeof w.appliqueiDataPelaRegra === 'function'
            ? w.appliqueiDataPelaRegra(a, m, regra)
            : null;
        var dia = venc ? Number(venc.slice(8, 10)) : q[0];
        lanc('Salário (quinzena)', 4250, 'receita', a, m, dia, {
          groupId: q[1],
          regraDia: regra,
          ...NU,
        });
      });
      lanc('Aluguel', 2300, 'despesa_fixa', a, m, 10, {
        groupId: 'demo_g_aluguel',
        categoriaDespesa: 'moradia',
        ...ITAU,
      });
      lanc('Condomínio', 480, 'despesa_fixa', a, m, 10, {
        groupId: 'demo_g_cond',
        categoriaDespesa: 'moradia',
        ...ITAU,
      });
      lanc('Internet', 119.9, 'despesa_fixa', a, m, 18, {
        groupId: 'demo_g_net',
        categoriaDespesa: 'moradia',
        ...ITAU,
      });
      lanc('Plano de saúde', 389, 'despesa_fixa', a, m, 20, {
        groupId: 'demo_g_saude',
        categoriaDespesa: 'saude',
        ...NU,
      });
      // Investe todo mês, logo depois da segunda quinzena: é o que faz a
      // Saúde do mês e a meta de investir aparecerem como num uso saudável.
      lanc('Aporte Tesouro Selic', 1200, 'investimento_fixo', a, m, 16, {
        groupId: 'demo_g_aporte',
        ...NU,
      });
      // Luz varia de verdade: lançada só até o mês corrente.
      if (passadoOuAtual) {
        var i = k + 6;
        lanc('Conta de luz', oscila(176, i, 0.18), 'despesa_fixa', a, m, 22, {
          categoriaDespesa: 'moradia',
          ...ITAU,
        });
        lanc('Mercado', oscila(620, i, 0.12), 'despesa_variavel', a, m, 4, {
          categoriaDespesa: 'mercado',
          ...NU,
        });
        lanc('Mercado', oscila(540, i + 2, 0.15), 'despesa_variavel', a, m, 19, {
          categoriaDespesa: 'mercado',
          ...NU,
        });
        lanc('Combustível', oscila(260, i, 0.2), 'despesa_variavel', a, m, 8, {
          categoriaDespesa: 'transporte',
          ...ITAU,
        });
        lanc('Farmácia', oscila(95, i + 1, 0.3), 'despesa_variavel', a, m, 13, {
          categoriaDespesa: 'saude',
          ...NU,
        });
        // O restaurante do mês corrente foge da curva: dá ao "O que notamos"
        // algo para mostrar.
        lanc('Restaurante', k === 0 ? 980 : oscila(310, i, 0.15), 'despesa_variavel', a, m, 6, {
          categoriaDespesa: 'restaurantes',
          ...NU,
        });
      }
    }

    // Cartão: fecha dia 28, vence dia 5 do mês seguinte. A compra entra na
    // fatura do vencimento seguinte ao fechamento; fatura vencida está paga
    // (debitada da conta pagadora, como a baixa do app faz).
    function noCartao(desc, valor, ano, mes, dia, extra) {
      var compra = noMes(ano, mes, dia);
      var fMes = compra.getMonth() + (compra.getDate() > 28 ? 1 : 0);
      var venc = noMes(compra.getFullYear(), fMes + 1, 5);
      var vencYmd = ymd(venc);
      var paga = vencYmd < hojeYmd;
      var t = Object.assign(
        {
          id: 'demo' + seq++,
          groupId: null,
          descricao: desc,
          valor: Math.round(valor * 100) / 100,
          categoria: 'cartao_credito',
          cartaoId: 'demo_card_nu',
          mes: venc.getMonth(),
          ano: venc.getFullYear(),
          data: ymd(compra) + 'T12:00:00.000Z',
          dataCompra: ymd(compra),
          dataVencimento: vencYmd,
          pago: paga,
          obs: '',
        },
        extra || {}
      );
      if (paga) {
        t.pagoEm = vencYmd + 'T12:00:00.000Z';
        t.contaId = 'demo_nu';
      }
      tx.push(t);
    }
    for (var c = -6; c <= 0; c++) {
      var r = new Date(hoje.getFullYear(), hoje.getMonth() + c, 1);
      var j = c + 6;
      noCartao('Streaming', 55.9, r.getFullYear(), r.getMonth(), 2, {
        cartaoFixoMensal: true,
        groupId: 'demo_g_stream',
        categoriaDespesa: 'lazer',
      });
      noCartao('Academia', 129, r.getFullYear(), r.getMonth(), 3, {
        cartaoFixoMensal: true,
        groupId: 'demo_g_acad',
        categoriaDespesa: 'saude',
      });
      noCartao('Delivery', oscila(210, j, 0.25), r.getFullYear(), r.getMonth(), 16, {
        categoriaDespesa: 'restaurantes',
      });
      noCartao('Roupas', oscila(180, j + 3, 0.5), r.getFullYear(), r.getMonth(), 21, {
        categoriaDespesa: 'compras',
      });
      noCartao('Uber', oscila(140, j + 1, 0.3), r.getFullYear(), r.getMonth(), 24, {
        categoriaDespesa: 'transporte',
      });
    }
    // Um parcelado em andamento: 10x, começou há quatro meses.
    var ini = new Date(hoje.getFullYear(), hoje.getMonth() - 4, 12);
    for (var p = 0; p < 10; p++) {
      var dc = new Date(ini.getFullYear(), ini.getMonth() + p, 12);
      noCartao('Notebook (' + (p + 1) + '/10)', 389.9, dc.getFullYear(), dc.getMonth(), 12, {
        groupId: 'demo_g_note',
        categoriaDespesa: 'compras',
      });
    }

    // Carteira: ações, FIIs e renda fixa, compradas ao longo do último ano.
    // Compradas há mais de um ano: sem lançamento de aporte que as pague, uma
    // compra recente apareceria como patrimônio que "surgiu" no período.
    var anoAtras = function (mesesAtras, dia) {
      return ymd(new Date(hoje.getFullYear(), hoje.getMonth() - 14 - mesesAtras, dia));
    };
    var op = function (id, ticker, qtd, preco, data, categoria, sub, extra) {
      return Object.assign(
        {
          id: id,
          ticker: ticker,
          quantidade: qtd,
          preco_op: preco,
          tipo: 'compra',
          data_op: data + 'T12:00:00.000Z',
          categoria: categoria,
          subcategoria: sub,
          corretora: 'Rico',
          contaId: 'demo_rico',
        },
        extra || {}
      );
    };
    var compras = [
      op(91001, 'ITUB4', 200, 31.2, anoAtras(11, 8), 'renda_variavel', 'acoes'),
      op(91002, 'WEGE3', 80, 41.5, anoAtras(10, 14), 'renda_variavel', 'acoes'),
      op(91003, 'BBAS3', 150, 27.8, anoAtras(8, 3), 'renda_variavel', 'acoes'),
      op(91004, 'PETR4', 120, 36.4, anoAtras(5, 22), 'renda_variavel', 'acoes'),
      op(91005, 'KNRI11', 40, 158, anoAtras(9, 10), 'renda_variavel', 'fiis'),
      op(91006, 'HGLG11', 30, 162, anoAtras(6, 17), 'renda_variavel', 'fiis'),
      op(91007, 'MXRF11', 600, 9.9, anoAtras(3, 5), 'renda_variavel', 'fiis'),
      op(91008, 'CDB Banco Demo', 1, 8000, anoAtras(10, 2), 'renda_fixa', undefined, {
        rentabilidade: '110% CDI',
        vencimento: ymd(new Date(hoje.getFullYear() + 2, 5, 15)),
      }),
      op(91009, 'Tesouro Selic', 1, 12000, anoAtras(7, 9), 'reserva_emergencia', undefined, {
        rentabilidade: '100% Selic',
      }),
    ];

    var sonho = function (id, nome, total, atual, prazo, categoria) {
      return {
        id: id,
        nome: nome,
        descricao: '',
        valorTotal: total,
        prazoMeses: prazo,
        valorAtual: atual,
        categoria: categoria,
        esforco: 'moderado',
        dataCriacao: agoraIso,
        dataInicio: agoraIso,
        dataFim: new Date(hoje.getFullYear(), hoje.getMonth() + prazo, 1).toISOString(),
        mesesRestantes: prazo,
        planoVinculado: false,
        aportes: [{ valor: atual, data: hojeYmd, tipo: 'inicial' }],
      };
    };
    var bem = function (id, nome, tipo, atual, compra, financiamento) {
      return {
        id: id,
        nome: nome,
        tipo: tipo,
        descricao: '',
        valorAtual: atual,
        valorCompra: compra,
        dataCompra: ymd(new Date(hoje.getFullYear() - 3, 2, 1)),
        fipe: null,
        imovel: null,
        financiamento: financiamento,
        arquivado: false,
        criadoEm: agoraIso,
        atualizadoEm: agoraIso,
      };
    };

    st.setItem('appliquei_contas', JSON.stringify(contas));
    st.setItem('appliquei_contas_seed_v1', '1');
    st.setItem('futurorico_cartoes', JSON.stringify(cartoes));
    st.setItem('futurorico_transacoes', JSON.stringify(tx));
    st.setItem('futurorico_compras', JSON.stringify(compras));
    st.setItem(
      'appliquei_sonhos',
      JSON.stringify([
        sonho('demo_sonho_1', 'Viagem para Portugal', 18000, 6200, 14, 'viagem'),
        sonho('demo_sonho_2', 'Troca do carro', 30000, 9500, 24, 'veiculo'),
      ])
    );
    st.setItem(
      'appliquei_bens',
      JSON.stringify([
        bem('demo_bem_1', 'Carro', 'veiculo', 62000, 78000, {
          ativo: true,
          valorFinanciado: 40000,
          saldoDevedor: 21500,
          parcela: 1180,
          parcelasRestantes: 22,
          taxaMensal: 0.0149,
        }),
      ])
    );
    // Entra como convidado, já com o guia de primeiros passos resolvido: quem
    // assiste vê o app em uso, não o cadastro.
    st.setItem('appliquei_auth_guest', '1');
    st.setItem(
      'appliquei_primeiros_passos',
      JSON.stringify({ v: 1, estado: 'concluido', em: agoraIso })
    );
  }

  // ── Faixa "Demonstração" ────────────────────────────────────────────────
  // Sempre à vista: ninguém pode confundir estes números com os de alguém.
  document.documentElement.classList.add('modo-demo');
  function faixa() {
    if (document.getElementById('demoFaixa')) return;
    var el = document.createElement('div');
    el.id = 'demoFaixa';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<span><b>Demonstração</b> · dados fictícios, nada é salvo</span>' +
      '<a href="/app" id="demoSair">Sair</a>';
    document.body.appendChild(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', faixa);
  else faixa();
})();
