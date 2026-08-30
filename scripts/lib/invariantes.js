'use strict';

/**
 * Validador de invariantes de integração da Appliquei.
 *
 * Recebe um ESTADO ({ transacoes, contas, historicoCompras }) e devolve a lista
 * de violações. É deliberadamente puro e sem DOM: serve tanto aos testes de
 * cenário (que rodam o fluxo real numa sandbox vm e validam o estado depois)
 * quanto à análise de impacto e à skill, que precisam validar um estado avulso.
 *
 * O vocabulário de categorias vem de .claude/integracoes/mapa.json — mapa e
 * validador não podem divergir. Ver .claude/integracoes/mapa.schema.md.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const MAPA = JSON.parse(
  fs.readFileSync(path.join(ROOT, '.claude', 'integracoes', 'mapa.json'), 'utf8')
);

const VOCAB = MAPA.entidades.transacao.vocabularioCategorias;
const CATEGORIAS_CONHECIDAS = new Set(
  [].concat(VOCAB.entradaCaixa, VOCAB.aporte, VOCAB.transferenciaSaida, VOCAB.despesaConsumo)
);

// Espelha mpEhEntradaCaixa (patrimonio.js). Se divergir, INV-05 acusa.
const ehEntradaCaixa = (cat) => VOCAB.entradaCaixa.includes(cat);
const ehAporte = (cat) => VOCAB.aporte.includes(cat);

// Espelha controleBancoObrigatorio (aba-controle-financeiro.js).
const CATEGORIAS_BANCO_OBRIGATORIO = [
  'receita',
  'resgate_investimento',
  'despesa_fixa',
  'despesa_variavel',
];

function normalizarNome(nome) {
  return (nome || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
}

/** Espelha resolverContaDeTransacao: contaId → nome/alias → null. */
function resolverConta(t, contas) {
  if (!t) return null;
  if (t.contaId) {
    const porId = contas.find((c) => c.id === t.contaId);
    if (porId) return porId;
  }
  const key = normalizarNome(t.banco);
  if (!key) return null;
  return (
    contas.find(
      (c) => normalizarNome(c.nome) === key || (Array.isArray(c.aliases) && c.aliases.includes(key))
    ) || null
  );
}

function rotulo(t) {
  return `${t.id || '(sem id)'} · ${t.categoria || '(sem categoria)'} · ${t.descricao || ''}`.trim();
}

/**
 * Valida um estado contra as invariantes da Onda 1.
 *
 * @param {{transacoes?: Array, contas?: Array, historicoCompras?: Array}} estado
 * @param {{apenas?: string[]}} [opcoes] lista de ids (ex.: ['INV-03']) para validar só algumas
 * @returns {Array<{inv: string, gravidade: string, mensagem: string, registro?: object}>}
 */
function validarEstado(estado, opcoes) {
  const transacoes = (estado && estado.transacoes) || [];
  const contas = (estado && estado.contas) || [];
  const operacoes = (estado && estado.historicoCompras) || [];
  const sonhos = (estado && estado.sonhos) || [];
  const cartoes = (estado && estado.cartoes) || [];
  const bens = (estado && estado.bens) || [];
  const apenas = opcoes && opcoes.apenas ? new Set(opcoes.apenas) : null;
  const violacoes = [];

  const gravidadeDe = (id) => {
    const inv = MAPA.invariantes.find((i) => i.id === id);
    return inv ? inv.gravidade : 'media';
  };
  const acusar = (inv, mensagem, registro) => {
    if (apenas && !apenas.has(inv)) return;
    violacoes.push({ inv, gravidade: gravidadeDe(inv), mensagem, registro });
  };

  const idsOperacoes = new Set(operacoes.map((op) => String(op.id)));

  for (const t of transacoes) {
    const cat = t.categoria;

    // INV-05 — vocabulário fechado.
    if (!CATEGORIAS_CONHECIDAS.has(cat)) {
      acusar(
        'INV-05',
        `Categoria "${cat}" não consta no vocabulário do mapa. Ela será tratada ` +
          `silenciosamente como despesa de consumo (debita o caixa quando pago:true) ` +
          `e some do agrupamento do relatório. Classifique-a em ` +
          `.claude/integracoes/mapa.json → entidades.transacao.vocabularioCategorias.`,
        t
      );
    }

    // INV-01 — todo gasto pago desconta de uma conta identificável.
    // A perna do ativo (temLegCaixa) está isenta: quem debita é a perna de caixa.
    // `origemExterna` marca dinheiro que nunca passou por conta cadastrada
    // (aporte externo e suas parcelas recorrentes). A regra original supunha
    // que toda saída sai de alguma instituição — o que é verdade para gasto e
    // para aporte feito de dentro do app, mas não para este terceiro caso, já
    // reconhecido em INV-03 como padrão C-sem-perna. Sem a isenção, o
    // validador acusaria o comportamento CORRETO.
    //
    // A isenção vale SÓ PARA APORTE. Uma despesa paga saiu de algum lugar,
    // sempre; aceitar a marca ali abriria um buraco por onde qualquer gasto
    // escaparia da trava — é o que o teste "a marca não isenta uma DESPESA"
    // impede.
    const aporteExterno = ehAporte(cat) && !!t.origemExterna;
    const debitaCaixa =
      t.pago === true &&
      !ehEntradaCaixa(cat) &&
      !aporteExterno &&
      !(ehAporte(cat) && t.temLegCaixa);
    if (debitaCaixa && !resolverConta(t, contas)) {
      acusar(
        'INV-01',
        `Transação paga sem conta resolvível — ${rotulo(t)}. O valor sai do total do ` +
          `patrimônio mas não sai de nenhuma instituição: cai no bucket "A reconciliar". ` +
          `Preencha contaId (ou banco que case com o nome/alias de uma conta).`,
        t
      );
    }

    // INV-02 — banco obrigatório nas categorias de caixa direto.
    if (CATEGORIAS_BANCO_OBRIGATORIO.includes(cat) && !t.contaId && !normalizarNome(t.banco)) {
      acusar(
        'INV-02',
        `Categoria "${cat}" exige instituição e o registro não tem contaId nem banco — ` +
          `${rotulo(t)}. controleBancoObrigatorio deveria ter bloqueado esta gravação.`,
        t
      );
    }

    // INV-06 — resgate credita a conta de destino.
    if (cat === 'resgate_investimento') {
      if (!resolverConta(t, contas)) {
        acusar(
          'INV-06',
          `Resgate sem conta de destino resolvível — ${rotulo(t)}. O dinheiro entra no ` +
            `total mas não aparece em banco nenhum.`,
          t
        );
      }
      if (t.irRetido != null && t.valorBruto == null) {
        acusar(
          'INV-06',
          `Resgate com irRetido mas sem valorBruto — ${rotulo(t)}. Sem o bruto não dá ` +
            `para auditar o líquido creditado.`,
          t
        );
      }
      if (t.valorBruto != null) {
        const esperado = Number(t.valorBruto) - Number(t.irRetido || 0);
        if (Math.abs(Number(t.valor) - esperado) > 0.005) {
          acusar(
            'INV-06',
            `Resgate credita ${t.valor}, mas bruto ${t.valorBruto} − IR ${t.irRetido || 0} = ` +
              `${esperado} — ${rotulo(t)}.`,
            t
          );
        }
      }
    }

    // INV-04 — nenhuma perna de caixa órfã.
    if (typeof t.id === 'string' && t.id.indexOf('tx_origem_') === 0) {
      const opId = t.id.slice('tx_origem_'.length);
      if (!idsOperacoes.has(opId)) {
        acusar(
          'INV-04',
          `Perna de caixa órfã — ${rotulo(t)} referencia a operação ${opId}, que não ` +
            `existe em historicoCompras. Débito fantasma: o saldo segue descontado de ` +
            `uma compra que já não existe.`,
          t
        );
      }
    }

    // INV-08 — mes/ano é a competência canônica.
    if (t.mes == null || t.ano == null) {
      acusar(
        'INV-08',
        `Transação sem competência (mes/ano) — ${rotulo(t)}. Toda a filtragem de tela ` +
          `usa mes/ano; sem eles o lançamento não aparece em mês nenhum.`,
        t
      );
    } else if (t.dataVencimento && /^\d{4}-\d{2}-\d{2}$/.test(t.dataVencimento)) {
      // Havendo vencimento, a competência é a DELE, em qualquer categoria. O
      // painel de Vencimentos filtra por mes/ano e desenha só o DIA do
      // dataVencimento: competência fora do mês do vencimento faz o card
      // aparecer no mês errado mostrando um dia que se lê como sendo daquele
      // mês. (Regra antes restrita a cartão; generalizada junto com a correção
      // de executarInsercao — ver RISCO-03 no mapa.)
      const [aVenc, mVenc] = t.dataVencimento.split('-');
      if (Number(aVenc) !== Number(t.ano) || Number(mVenc) - 1 !== Number(t.mes)) {
        acusar(
          'INV-08',
          `Competência fora do mês do vencimento — ${rotulo(t)}: mes/ano dizem ` +
            `${Number(t.mes) + 1}/${t.ano}, o vencimento diz ${mVenc}/${aVenc}. ` +
            `O lançamento aparece no painel do mês errado, mostrando só o dia. ` +
            `(Num dado antigo isto pode ser resíduo de antes da correção do ` +
            `RISCO-03, quando a inserção usava o mês em visão.)`,
          t
        );
      }
    }
  }

  // INV-03 — compra de ativo tem duas pernas e só uma debita o caixa.
  const porOperacao = new Map();
  for (const t of transacoes) {
    if (t.operacaoId == null) continue;
    const k = String(t.operacaoId);
    if (!porOperacao.has(k)) porOperacao.set(k, []);
    porOperacao.get(k).push(t);
  }
  for (const [opId, pernas] of porOperacao) {
    const ativo = pernas.filter((t) => ehAporte(t.categoria));
    const caixa = pernas.filter((t) => t.categoria === 'transferencia_saida');
    if (!ativo.length) continue;

    for (const a of ativo) {
      if (a.temLegCaixa && !caixa.length) {
        acusar(
          'INV-03',
          `Aporte marcado com temLegCaixa mas SEM perna de caixa — operação ${opId}, ` +
            `${rotulo(a)}. A flag manda o patrimônio ignorar esta transação no caixa, ` +
            `e não há transferencia_saida para debitar: a compra não desconta de nada.`,
          a
        );
      }
      if (!a.temLegCaixa && caixa.length) {
        acusar(
          'INV-03',
          `DUPLO DÉBITO na operação ${opId} — ${rotulo(a)} não tem temLegCaixa e ` +
            `coexiste com uma perna transferencia_saida. O saldo vai cair duas vezes ` +
            `na mesma compra.`,
          a
        );
      }
    }
    for (const c of caixa) {
      const a = ativo[0];
      if (a && Math.abs(Number(c.valor) - Number(a.valor)) > 0.005) {
        acusar(
          'INV-03',
          `Pernas com valores diferentes na operação ${opId}: ativo ${a.valor} vs ` +
            `caixa ${c.valor}. As duas pernas representam o mesmo dinheiro.`,
          c
        );
      }
      if (!resolverConta(c, contas)) {
        acusar(
          'INV-03',
          `Perna de caixa da operação ${opId} sem conta resolvível — ${rotulo(c)}. ` +
            `É ela que debita o aporte; sem conta, a compra não sai de instituição nenhuma.`,
          c
        );
      }
    }
  }

  // ======================= Onda 2 — as origens ==========================

  const idsSonhos = new Set(sonhos.map((s) => s.id));
  const txPorId = new Map(transacoes.map((t) => [t.id, t]));

  // INV-10 — compromisso PENDENTE não sobrevive ao sonho.
  // Transação PAGA com sonhoId inexistente é histórico intencional (o usuário
  // escolheu "manter histórico" ao excluir), não órfã. O campo `pago` é o que
  // distingue as duas coisas — ver entidades.sonho.regrasDeExclusao no mapa.
  if (sonhos.length || transacoes.some((t) => t.sonhoId)) {
    for (const t of transacoes) {
      if (!t.sonhoId || idsSonhos.has(t.sonhoId)) continue;
      if (t.pago) continue;
      acusar(
        'INV-10',
        `Compromisso pendente órfão — ${rotulo(t)} aponta para o sonho ${t.sonhoId}, ` +
          `que já não existe. Ele continua inflando o "a pagar" do Controle. ` +
          `removerLancamentosFuturosSonho deveria tê-lo removido.`,
        t
      );
    }
  }

  // INV-22 — sonho tem conta de origem, e o compromisso a carrega.
  for (const s of sonhos) {
    const conta = s.contaOrigemId ? contas.find((c) => c.id === s.contaOrigemId) : null;
    if (!s.contaOrigemId) {
      acusar(
        'INV-22',
        `Sonho "${s.nome || s.id}" sem conta de origem. Os compromissos dele nascem com ` +
          `contaId indefinido e, ao serem pagos, caem em "A reconciliar" — o valor sai do ` +
          `total do patrimônio sem sair de nenhuma instituição. (Num dado antigo isto pode ` +
          `ser resíduo de antes da correção do RISCO-02, quando o cadastro não exigia a conta.)`,
        s
      );
    } else if (!conta) {
      acusar(
        'INV-22',
        `Sonho "${s.nome || s.id}" aponta para a conta ${s.contaOrigemId}, que não existe.`,
        s
      );
    }
    if (!conta) continue;
    for (const t of transacoes) {
      if (t.categoria !== 'sonho' || t.sonhoId !== s.id || t.aporteExtra) continue;
      // Parcela PAGA é história: ela debitou a conta que debitou na época.
      // Trocar a conta do sonho depois disso não pode — e não deve — reescrever
      // o passado; recarimbá-la moveria dinheiro entre bancos retroativamente.
      // A regra vale só para o que ainda vai debitar. (Mesma lógica de INV-10:
      // o campo `pago` é o que separa história de compromisso.)
      if (t.pago) continue;
      if (t.contaId !== s.contaOrigemId) {
        acusar(
          'INV-22',
          `Compromisso do sonho "${s.nome || s.id}" com contaId ${t.contaId || '(vazio)'}, ` +
            `mas o sonho debita a conta ${s.contaOrigemId} — ${rotulo(t)}.`,
          t
        );
      }
    }
  }

  // INV-11 — aporte extra e transação são um par de ligação dupla.
  for (const s of sonhos) {
    for (const ap of s.aportes || []) {
      if (!ap.txId) continue;
      const tx = txPorId.get(ap.txId);
      if (!tx) {
        acusar(
          'INV-11',
          `Aporte do sonho "${s.nome || s.id}" aponta para a transação ${ap.txId}, que ` +
            `não existe. O valor conta no valorAtual do sonho mas não existe no ` +
            `Controle: o sonho mostra dinheiro guardado que nunca saiu de conta nenhuma.`,
          ap
        );
      } else if (tx.sonhoId !== s.id) {
        acusar(
          'INV-11',
          `Ligação dupla quebrada: o aporte do sonho "${s.nome || s.id}" aponta para ` +
            `${ap.txId}, mas essa transação tem sonhoId="${tx.sonhoId}".`,
          ap
        );
      }
    }
  }

  // INV-12 — migração gera duas pernas que se anulam no orçamento.
  const migracoes = transacoes.filter(
    (t) => t.aporteExtra && t.categoria === 'sonho' && /migra/i.test(t.obs || '')
  );
  for (const mig of migracoes) {
    const resgate = transacoes.find(
      (t) =>
        t !== mig &&
        t.categoria === 'resgate_investimento' &&
        t.sonhoId === mig.sonhoId &&
        Math.abs(Number(t.valor) - Number(mig.valor)) <= 0.005
    );
    if (!resgate) {
      acusar(
        'INV-12',
        `Aporte por migração sem a perna de resgate — ${rotulo(mig)}. O dinheiro só ` +
          `mudou de lugar (investimento → sonho), mas sem o resgate compensatório o mês ` +
          `contabiliza um gasto novo e o orçamento fica no vermelho sem motivo.`,
        mig
      );
    }
  }

  // INV-13 — recalcular o plano não duplica compromissos.
  const compromissos = new Map();
  for (const t of transacoes) {
    if (t.categoria !== 'sonho' || t.aporteExtra || !t.sonhoId) continue;
    if (t.mes == null || t.ano == null) continue;
    const k = `${t.sonhoId}|${t.ano}-${t.mes}`;
    if (!compromissos.has(k)) compromissos.set(k, []);
    compromissos.get(k).push(t);
  }
  for (const [k, itens] of compromissos) {
    if (itens.length > 1) {
      const [sonhoId, comp] = k.split('|');
      acusar(
        'INV-13',
        `${itens.length} compromissos do sonho ${sonhoId} na mesma competência ${comp}. ` +
          `O "a pagar" do mês está dobrado. O recálculo do plano tem de reaproveitar a ` +
          `série (groupIdControle) em vez de criar outra.`,
        itens[1]
      );
    }
  }

  // INV-14 — valorAtual do sonho é a soma dos aportes.
  for (const s of sonhos) {
    if (s.valorAtual == null || !Array.isArray(s.aportes)) continue;
    const soma = s.aportes.reduce((acc, a) => acc + (Number(a.valor) || 0), 0);
    if (Math.abs(Number(s.valorAtual) - soma) > 0.005) {
      acusar(
        'INV-14',
        `valorAtual do sonho "${s.nome || s.id}" é ${s.valorAtual}, mas os aportes somam ` +
          `${soma}. A barra de progresso mostra um número que o histórico não sustenta.`,
        s
      );
    }
  }

  // INV-15 — dividendo é idempotente por (ticker, ano, mês).
  const divs = new Map();
  for (const t of transacoes) {
    if (t.categoria !== 'dividendo') continue;
    if (!t.divKey) {
      acusar(
        'INV-15',
        `Dividendo sem divKey — ${rotulo(t)}. Sem a chave de idempotência, rodar ` +
          `lancarDividendosNoCaixa de novo duplica este lançamento.`,
        t
      );
      continue;
    }
    if (divs.has(t.divKey)) {
      acusar(
        'INV-15',
        `divKey duplicada "${t.divKey}" — o mesmo dividendo foi lançado duas vezes e o ` +
          `caixa da corretora está inflado.`,
        t
      );
    }
    divs.set(t.divKey, t);
  }

  // ====================== Onda 3 — a periferia ==========================

  // INV-16 — pagar compromisso de sonho registra o aporte exatamente uma vez.
  for (const s of sonhos) {
    const porTx = new Map();
    for (const ap of s.aportes || []) {
      if (!ap.txId) continue;
      if (porTx.has(ap.txId)) {
        acusar(
          'INV-16',
          `Dois aportes do sonho "${s.nome || s.id}" apontam para a mesma transação ` +
            `${ap.txId}. O pagamento foi contado em dobro: o sonho subiu o dobro do que ` +
            `saiu da conta.`,
          ap
        );
      }
      porTx.set(ap.txId, ap);
      const tx = txPorId.get(ap.txId);
      if (tx && Math.abs(Number(ap.valor) - Number(tx.valor)) > 0.005) {
        acusar(
          'INV-16',
          `Aporte de ${ap.valor} para a transação ${ap.txId}, que vale ${tx.valor}. O ` +
            `aporte tem de espelhar o valor EFETIVAMENTE pago — o usuário pode editar o ` +
            `valor no ato do pagamento.`,
          ap
        );
      }
    }
  }

  // INV-17 / INV-20 — cartão: id válido e conta pagadora resolvível.
  if (cartoes.length || transacoes.some((t) => t.cartaoId)) {
    const idsCartoes = new Set(cartoes.map((c) => c.id));
    for (const c of cartoes) {
      if (!c.contaPagadoraId) {
        acusar(
          'INV-17',
          `Cartão "${c.nome || c.id}" sem contaPagadoraId. Quando a fatura for paga, o ` +
            `débito cai em "A reconciliar" e o saldo do banco não se move.`,
          c
        );
      } else if (!contas.find((x) => x.id === c.contaPagadoraId)) {
        acusar(
          'INV-17',
          `Cartão "${c.nome || c.id}" aponta para a conta pagadora ${c.contaPagadoraId}, ` +
            `que não existe.`,
          c
        );
      }
    }
    for (const t of transacoes) {
      if (t.categoria !== 'cartao_credito') continue;
      if (!t.cartaoId) {
        acusar('INV-20', `Lançamento de cartão sem cartaoId — ${rotulo(t)}.`, t);
      } else if (!idsCartoes.has(t.cartaoId)) {
        acusar(
          'INV-20',
          `Lançamento aponta para o cartão ${t.cartaoId}, que não existe — ${rotulo(t)}. ` +
            `obterCartao NÃO dá erro nesse caso: cai silenciosamente em cartoes[0], e a ` +
            `fatura passa a ser lida com o vencimento e a conta pagadora de outro cartão.`,
          t
        );
      }
      if (t.pago && t.cartaoId && idsCartoes.has(t.cartaoId)) {
        const card = cartoes.find((c) => c.id === t.cartaoId);
        if (card && card.contaPagadoraId && t.contaId !== card.contaPagadoraId) {
          acusar(
            'INV-17',
            `Fatura paga sem debitar a conta pagadora do cartão — ${rotulo(t)}: contaId ` +
              `${t.contaId || '(vazio)'}, mas o cartão "${card.nome || card.id}" é pago ` +
              `pela conta ${card.contaPagadoraId}.`,
            t
          );
        }
      }
    }
  }

  // INV-18 — pagamento com efeito colateral não pode voltar a pendente.
  // Uma transação de sonho/compromisso já paga que gerou aporte e depois foi
  // revertida deixa o aporte de pé: o mesmo dinheiro contado duas vezes.
  for (const s of sonhos) {
    for (const ap of s.aportes || []) {
      if (!ap.txId) continue;
      const tx = txPorId.get(ap.txId);
      if (tx && tx.pago === false) {
        acusar(
          'INV-18',
          `A transação ${ap.txId} voltou a "a pagar", mas o aporte que ela gerou continua ` +
            `no sonho "${s.nome || s.id}". O mesmo dinheiro está contado duas vezes: ` +
            `guardado no sonho e ainda pendente no Controle.`,
          ap
        );
      }
    }
  }
  for (const op of operacoes) {
    if (!op.geradoDoCompromissoTx) continue;
    const tx = txPorId.get(op.geradoDoCompromissoTx);
    if (tx && tx.pago === false) {
      acusar(
        'INV-18',
        `A parcela ${op.geradoDoCompromissoTx} voltou a "a pagar", mas a posição que ela ` +
          `gerou continua no patrimônio.`,
        op
      );
    }
  }

  // INV-21 — aporte de compromisso é idempotente e não rende no futuro.
  const porCompromisso = new Map();
  for (const op of operacoes) {
    if (!op.geradoDoCompromissoTx) continue;
    if (porCompromisso.has(op.geradoDoCompromissoTx)) {
      acusar(
        'INV-21',
        `Duas posições geradas pela mesma parcela ${op.geradoDoCompromissoTx}. O aporte ` +
          `foi materializado em dobro no patrimônio.`,
        op
      );
    }
    porCompromisso.set(op.geradoDoCompromissoTx, op);
    if (op.data_op && new Date(op.data_op).getTime() > Date.now() + 86400000) {
      acusar(
        'INV-21',
        `Posição ${op.id} com data_op no futuro (${op.data_op}). O rendimento passaria a ` +
          `ser calculado a partir de uma data que ainda não chegou.`,
        op
      );
    }
  }

  // INV-19 — bem arquivado não entra no patrimônio.
  for (const b of bens) {
    if (b.valorAtual != null && Number(b.valorAtual) < 0) {
      acusar('INV-19', `Bem "${b.nome || b.id}" com valorAtual negativo.`, b);
    }
  }

  // INV-07 — saldo de abertura entra uma única vez.
  const vistos = new Map();
  for (const c of contas) {
    if (vistos.has(c.id)) {
      acusar('INV-07', `Conta duplicada por id: ${c.id}.`, c);
    }
    vistos.set(c.id, c);
    const key = normalizarNome(c.nome);
    if (c.arquivada) continue;
    const colisao = contas.find(
      (o) => o !== c && !o.arquivada && normalizarNome(o.nome) === key && key
    );
    if (colisao) {
      acusar(
        'INV-07',
        `Duas contas ATIVAS com o mesmo nome normalizado ("${c.nome}" / "${colisao.nome}"). ` +
          `Os saldos de abertura entram duas vezes e o agrupamento por instituição ` +
          `fragmenta o mesmo banco.`,
        c
      );
    }
  }

  return violacoes;
}

/** Formata violações para mensagem de assert legível. */
function formatar(violacoes) {
  if (!violacoes.length) return '';
  const ordem = { critica: 0, alta: 1, media: 2 };
  return violacoes
    .slice()
    .sort((a, b) => (ordem[a.gravidade] ?? 9) - (ordem[b.gravidade] ?? 9))
    .map((v) => `  [${v.inv} · ${v.gravidade}] ${v.mensagem}`)
    .join('\n');
}

/** Atalho para os testes: falha com mensagem citando a invariante. */
function assertSemViolacoes(assert, estado, opcoes) {
  const v = validarEstado(estado, opcoes);
  assert.equal(v.length, 0, v.length ? `Invariantes violadas:\n${formatar(v)}` : '');
}

module.exports = {
  MAPA,
  CATEGORIAS_CONHECIDAS,
  CATEGORIAS_BANCO_OBRIGATORIO,
  ehEntradaCaixa,
  ehAporte,
  normalizarNome,
  resolverConta,
  validarEstado,
  formatar,
  assertSemViolacoes,
};
