'use strict';

// Consultas do bot do Telegram: /saldo, /fatura e /mes.
//
// PURO: recebe os dados do usuário (as chaves sincronizadas de
// users/{uid}/data/main, já parseadas) e a data de referência, e devolve
// números. Não lê banco, não chama rede, não depende do relógio.
//
// AS REGRAS SÃO AS DO APP, PORTADAS LINHA A LINHA. O app é feito de classic
// scripts de navegador (globais, DOM), que o servidor não carrega. Cada função
// abaixo diz de qual função do app ela é cópia, e
// test/telegram-consultas.test.js roda o app de verdade (sandbox vm) e o
// servidor sobre o MESMO mundo e exige o mesmo número. Mudou a regra no app e
// não mudou aqui, o teste fica vermelho — o bot nunca mostra um saldo que a
// tela não mostraria.
//
// O que NÃO está nos números: os lançamentos do Telegram que ainda estão na
// caixa de entrada (o app só os aplica ao abrir) e o que outro aparelho ainda
// não sincronizou. Quem formata a resposta avisa o primeiro caso.

// ─── datas ──────────────────────────────────────────────────────────────────

const FUSO = 'America/Sao_Paulo';

/**
 * "Agora" no relógio de parede de Brasília, num Date do fuso do servidor.
 *
 * O app roda no navegador e toda a regra usa hora LOCAL (new Date(ano, mes, 1),
 * getMonth()). O servidor da Vercel roda em UTC: às 22h de 31/10 em Brasília já
 * é 01/11 lá, e o /mes responderia novembro. Montar o Date a partir dos
 * componentes de Brasília deixa todas as contas no mesmo referencial que o app
 * usa. A única coisa que fica fora dele é `data` em ISO com hora (instante
 * real), usado só como último recurso quando a transação não tem mes/ano —
 * ali o erro máximo é o próprio fuso (3 h).
 */
function agoraBrasilia(agoraReal) {
  const d = agoraReal instanceof Date ? agoraReal : new Date();
  const partes = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(d)
    .forEach((p) => {
      partes[p.type] = parseInt(p.value, 10);
    });
  return new Date(
    partes.year,
    partes.month - 1,
    partes.day,
    partes.hour,
    partes.minute,
    partes.second
  );
}

// appliquei-utils.js → appliqueiParseData
function parseData(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T12:00:00');
    return new Date(s);
  }
  return new Date(NaN);
}

function ymd(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

// ─── saldo por conta ────────────────────────────────────────────────────────

// appliquei-patrimonio.js → mpEhEntradaCaixa
function ehEntradaCaixa(categoria) {
  return (
    categoria === 'receita' ||
    categoria === 'dividendo' ||
    categoria === 'resgate_investimento' ||
    categoria === 'transferencia_entrada'
  );
}

// appliquei-utils.js → ehAporteExterno
function ehAporteExterno(t) {
  return (
    !!t &&
    (t.categoria === 'investimento_fixo' || t.categoria === 'investimento_variavel') &&
    !!t.origemExterna
  );
}

// appliquei-patrimonio.js → mpTimestampTransacao (sem o Date.now() do fim:
// transação sem data nenhuma conta como "agora", que é o refMs da consulta)
function timestampTransacao(t, refMs) {
  if (typeof t.mes === 'number' && typeof t.ano === 'number')
    return new Date(t.ano, t.mes, 1).getTime();
  if (t.data) return parseData(t.data).getTime();
  return refMs;
}

// appliquei-patrimonio.js → mpQuandoEntraNoCaixa
function quandoEntraNoCaixa(t, refMs) {
  if (t && t.dataVencimento) {
    const d = parseData(t.dataVencimento);
    if (d && !isNaN(d.getTime())) return d.getTime();
  }
  return timestampTransacao(t, refMs);
}

// appliquei-patrimonio.js → mpTransacaoComputaCaixa
function transacaoComputaCaixa(t, refMs) {
  const ehEntrada = ehEntradaCaixa(t.categoria);
  const quando = ehEntrada ? quandoEntraNoCaixa(t, refMs) : timestampTransacao(t, refMs);
  if (quando > refMs) return false;
  if (
    (t.categoria === 'investimento_fixo' || t.categoria === 'investimento_variavel') &&
    t.temLegCaixa
  )
    return false;
  if (ehAporteExterno(t)) return false;
  if (ehEntrada) return true;
  return !!t.pago;
}

// appliquei-contas.js → appliqueiNormalizarNomeConta (= mpNormalizarInstituicao().key)
function normalizarNome(nome) {
  return (nome || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// appliquei-contas.js → resolverContaDeTransacao (obterConta + obterContaPorNomeOuAlias)
function resolverConta(t, contas) {
  if (!t) return null;
  if (t.contaId) {
    const c = contas.find((x) => x.id === t.contaId);
    if (c) return c;
  }
  const key = normalizarNome(t.banco);
  if (!key) return null;
  return (
    contas.find(
      (c) =>
        normalizarNome(c.nome) === key ||
        (Array.isArray(c.aliases) && c.aliases.indexOf(key) !== -1)
    ) || null
  );
}

// appliquei-patrimonio.js → mpSaldoInicialConta
function saldoInicialConta(c, refMs) {
  const sIni = Number(c && c.saldoInicial) || 0;
  if (!sIni) return 0;
  if (c && c.dataSaldoInicial) {
    const tsIni = parseData(c.dataSaldoInicial).getTime();
    if (isFinite(tsIni) && tsIni > refMs) return 0;
  }
  return sIni;
}

// appliquei-patrimonio.js → mpChaveInstTransacao
function chaveInstTransacao(t, contas) {
  const conta = resolverConta(t, contas);
  if (conta) return { key: conta.id, label: conta.nome };
  const orig = ((t && t.banco) || '').trim().replace(/\s+/g, ' ');
  const key = normalizarNome(orig);
  return key
    ? { key: 'nome:' + key, label: orig }
    : { key: 'a-reconciliar', label: 'A reconciliar' };
}

/**
 * Saldo em caixa por conta, até `refMs`.
 * Cópia de appliquei-patrimonio.js → mpCalcularSaldoPorInstituicao.
 *
 * @returns {Object<string,{caixa:number,label:string,key:string}>}
 *   chave = id da conta; 'nome:<banco>' para banco digitado sem conta
 *   cadastrada; 'a-reconciliar' para transação sem banco nenhum.
 */
function saldoPorInstituicao(dados, refMs) {
  const contas = dados.contas || [];
  const mapa = {};
  const ensure = (key, label) => {
    if (!mapa[key]) mapa[key] = { caixa: 0, label: label || 'A reconciliar', key };
    else if (label && mapa[key].label === 'A reconciliar') mapa[key].label = label;
    return mapa[key];
  };
  contas
    .filter((c) => c && !c.arquivada)
    .forEach((c) => {
      const sIni = saldoInicialConta(c, refMs);
      if (sIni) ensure(c.id, c.nome).caixa += sIni;
    });
  (dados.transacoes || []).forEach((t) => {
    if (!t || !transacaoComputaCaixa(t, refMs)) return;
    const ci = chaveInstTransacao(t, contas);
    const b = ensure(ci.key, ci.label);
    const valor = Number(t.valor) || 0;
    if (ehEntradaCaixa(t.categoria)) b.caixa += valor;
    else b.caixa -= valor;
  });
  return mapa;
}

/**
 * O que o /saldo mostra: contas ativas (na ordem do cadastro), depois o que
 * caiu fora de conta cadastrada, e o total — que é a soma de tudo, igual a
 * mpCalcularSaldoTotal.
 */
function resumoSaldo(dados, refMs) {
  const mapa = saldoPorInstituicao(dados, refMs);
  const contas = (dados.contas || []).filter((c) => c && !c.arquivada);
  const linhas = contas.map((c) => ({
    id: c.id,
    nome: c.nome,
    corretora: c.tipo === 'corretora',
    saldo: mapa[c.id] ? mapa[c.id].caixa : 0,
  }));
  const ids = new Set(contas.map((c) => c.id));
  // Transação de conta arquivada (ou de banco digitado) continua no total do
  // app; aqui ela aparece agrupada, para a soma bater.
  let fora = 0;
  Object.keys(mapa).forEach((k) => {
    if (!ids.has(k)) fora += mapa[k].caixa;
  });
  const total = linhas.reduce((s, l) => s + l.saldo, 0) + fora;
  return { contas: linhas, fora, total };
}

// ─── fatura do cartão ───────────────────────────────────────────────────────

// appliquei-aba-controle-financeiro.js → cartaoCalcularVencimento
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
  return new Date(fAno, vMes, Math.min(dVenc, ultimoDia));
}

// appliquei-aba-controle-financeiro.js → cartaoUltimoFechamento
function cartaoUltimoFechamento(hoje, diaFech, diaVenc) {
  const dVenc = parseInt(diaVenc, 10);
  let dFech = parseInt(diaFech, 10);
  if (!dVenc || dVenc < 1 || dVenc > 31) return null;
  if (!dFech || dFech < 1 || dFech > 31) dFech = dVenc;
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

// appliquei-aba-controle-financeiro.js → cartaoProximoFechamento
function cartaoProximoFechamento(fechamento, diaFech, diaVenc) {
  const dVenc = parseInt(diaVenc, 10);
  let dFech = parseInt(diaFech, 10);
  if (!dVenc || dVenc < 1 || dVenc > 31) return null;
  if (!dFech || dFech < 1 || dFech > 31) dFech = dVenc;
  const ano = fechamento.getFullYear();
  const mes = fechamento.getMonth() + 1;
  return new Date(ano, mes, Math.min(dFech, new Date(ano, mes + 1, 0).getDate()));
}

// appliquei-aba-controle-financeiro.js → faturaLancamentos / faturaTotal / faturaEstaPaga
// (fatura não é entidade: é o agrupamento cartão + data de vencimento)
function fatura(transacoes, cartaoId, vencimento) {
  const chave = ymd(vencimento);
  const itens = (transacoes || []).filter(
    (t) =>
      t && t.categoria === 'cartao_credito' && t.cartaoId === cartaoId && t.dataVencimento === chave
  );
  return {
    vencimento: chave,
    total: itens.reduce((s, t) => s + (Number(t.valor) || 0), 0),
    itens: itens.length,
    paga: itens.length > 0 && itens.every((t) => t.pago),
  };
}

/**
 * Para cada cartão ativo: a fatura aberta (que ainda acumula) e a fechada (a
 * que acabou de fechar e pode estar por pagar). Mesmas datas que
 * cartaoFaturasCandidatas dá ao formulário de lançamento.
 */
function resumoFaturas(dados, hoje) {
  const transacoes = dados.transacoes || [];
  return (dados.cartoes || [])
    .filter((c) => c && !c.arquivado)
    .map((c) => {
      const vencAberta = cartaoCalcularVencimento(hoje, c.diaFechamento, c.diaVencimento);
      const ultimoFech = cartaoUltimoFechamento(hoje, c.diaFechamento, c.diaVencimento);
      const base = { id: c.id, nome: c.nome, limite: Number(c.limite) || 0 };
      if (!vencAberta || !ultimoFech) return Object.assign(base, { semDatas: true });
      const vencFechada = cartaoCalcularVencimento(ultimoFech, c.diaFechamento, c.diaVencimento);
      return Object.assign(base, {
        aberta: Object.assign(fatura(transacoes, c.id, vencAberta), {
          fechamento: ymd(cartaoProximoFechamento(ultimoFech, c.diaFechamento, c.diaVencimento)),
        }),
        fechada: Object.assign(fatura(transacoes, c.id, vencFechada), {
          fechamento: ymd(ultimoFech),
        }),
      });
    });
}

// ─── resumo do mês ──────────────────────────────────────────────────────────

/**
 * Cópia de calcularResumoMes + totaisDoResumo + calcularDespesasPorCategoria
 * (appliquei-aba-controle-financeiro.js). Competência = mes/ano da transação,
 * a chave canônica do Controle (INV-08).
 */
function resumoMes(dados, mes, ano) {
  const r = {
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
  const porCategoria = {};
  (dados.transacoes || []).forEach((t) => {
    if (!t || t.mes !== mes || t.ano !== ano) return;
    if (t.categoria === 'receita' || t.categoria === 'dividendo') r.receita += t.valor;
    else if (t.categoria === 'resgate_investimento') r.resgate += t.valor;
    else if (t.categoria === 'despesa_fixa') r.despFixa += t.valor;
    else if (t.categoria === 'despesa_variavel') r.despVar += t.valor;
    else if (t.categoria === 'cartao_credito') r.cartao += t.valor;
    else if (ehAporteExterno(t)) r.invExterno += t.valor;
    else if (t.categoria === 'investimento_fixo') r.invFixo += t.valor;
    else if (t.categoria === 'investimento_variavel') r.invVar += t.valor;
    else if (t.categoria === 'sonho') r.sonho += t.valor;
    // categoriaDespesaUsada
    if (
      t.categoria === 'despesa_fixa' ||
      t.categoria === 'despesa_variavel' ||
      t.categoria === 'cartao_credito'
    ) {
      const chave = t.categoriaDespesa || '__sem_categoria__';
      porCategoria[chave] = (porCategoria[chave] || 0) + t.valor;
    }
  });
  const n = (v) => Number(v) || 0;
  const totais = {
    receita: n(r.receita) + n(r.resgate),
    despesas: n(r.despFixa) + n(r.despVar),
    cartao: n(r.cartao),
    investimentos: n(r.invFixo) + n(r.invVar),
    sonhos: n(r.sonho),
  };
  // calcularResultadoMes
  const resultado =
    totais.receita - totais.despesas - totais.cartao - totais.investimentos - totais.sonhos;
  return { mes, ano, bruto: r, totais, porCategoria, resultado };
}

// ─── saldo projetado e aperto de caixa ──────────────────────────────────────

// appliquei-patrimonio.js → mpDataMovimento (data REAL do lançamento)
function dataMovimento(t, refMs) {
  if (t.dataVencimento) {
    const d = parseData(t.dataVencimento);
    if (d && !isNaN(d.getTime())) return d.getTime();
  }
  if (t.data && typeof t.mes === 'number' && typeof t.ano === 'number') {
    const d = parseData(t.data);
    if (d && !isNaN(d.getTime()) && d.getMonth() === t.mes && d.getFullYear() === t.ano)
      return d.getTime();
  }
  if (typeof t.mes === 'number' && typeof t.ano === 'number')
    return new Date(t.ano, t.mes, 1).getTime();
  if (t.data) {
    const d = parseData(t.data);
    if (d && !isNaN(d.getTime())) return d.getTime();
  }
  return refMs;
}

// appliquei-contas.js → ATRASO_MAXIMO_PROJETADO_MS
const ATRASO_MAXIMO_PROJETADO_MS = 30 * 86400000;

/**
 * Saldo por conta em `refMs`, como o app projeta.
 * Cópia de appliquei-contas.js → saldoCaixaPorConta + aplicarAgendadoNoSaldo:
 * a foto de hoje (mpCalcularSaldoPorInstituicao) e, numa data futura, tudo o
 * que está agendado até lá, pago ou não, sem contar duas vezes o que a foto
 * já contou. `agoraMs` é o "hoje" (o app usa Date.now()).
 *
 * @returns {Object<string, number>} chave da instituição → saldo
 */
function saldoCaixaPorConta(dados, refMs, agoraMs) {
  const base = refMs > agoraMs ? agoraMs : refMs;
  const porInst = saldoPorInstituicao(dados, base);
  const mapa = {};
  Object.keys(porInst).forEach((k) => (mapa[k] = Number(porInst[k].caixa) || 0));
  if (!(refMs > agoraMs)) return mapa;
  const contas = dados.contas || [];
  (dados.transacoes || []).forEach((t) => {
    if (!t) return;
    const ts = dataMovimento(t, agoraMs);
    if (ts > refMs) return;
    if (ts < agoraMs - ATRASO_MAXIMO_PROJETADO_MS) return;
    if (
      (t.categoria === 'investimento_fixo' || t.categoria === 'investimento_variavel') &&
      t.temLegCaixa
    )
      return;
    if (ehAporteExterno(t)) return;
    if (transacaoComputaCaixa(t, agoraMs)) return; // a foto de hoje já contou
    const chave = chaveInstTransacao(t, contas).key;
    if (!chave) return;
    if (mapa[chave] == null) mapa[chave] = 0;
    const valor = Number(t.valor) || 0;
    if (ehEntradaCaixa(t.categoria)) mapa[chave] += valor;
    else mapa[chave] -= valor;
  });
  return mapa;
}

/**
 * A função saldoEm(ms) que o card "aperto de caixa" usa.
 * Cópia de appliquei-insights-ui.js → insightsUiFonteDeSaldo: soma as contas
 * ativas; recusa projetar (devolve {motivo}) sem conta cadastrada ou com
 * dinheiro "sem dono" hoje; o que fica fora de conta DEPOIS de hoje pesa como
 * saída.
 */
function fonteDeSaldo(dados, agoraMs) {
  const idsReais = {};
  let qtd = 0;
  (dados.contas || []).forEach((c) => {
    if (c && c.id && !c.arquivada) {
      idsReais[c.id] = true;
      qtd++;
    }
  });
  if (!qtd) return { motivo: 'sem_contas' };
  const separar = (ms) => {
    const mapa = saldoCaixaPorConta(dados, ms, agoraMs);
    let emContas = 0;
    let foraDeConta = 0;
    Object.keys(mapa).forEach((k) => {
      const v = Number(mapa[k]) || 0;
      if (idsReais[k]) emContas += v;
      else foraDeConta += v;
    });
    return { emContas, foraDeConta };
  };
  const foraHoje = separar(agoraMs).foraDeConta;
  if (Math.abs(foraHoje) > 0.01) return { motivo: 'sem_dono' };
  return {
    saldoEm: (ms) => {
      const x = separar(ms);
      return x.emContas + (x.foraDeConta - foraHoje);
    },
  };
}

/**
 * Cópia de appliquei-insights.js → insightsAperto: o primeiro dia em que o
 * saldo projetado fica negativo, o pior valor e o dia em que volta ao azul.
 */
function aperto(saldoEm, agoraMs, dias) {
  const DIA = 86400000;
  let furo = null;
  let recupera = null;
  let pior = 0;
  for (let d = 1; d <= (dias || 45); d++) {
    const ms = agoraMs + d * DIA;
    const saldo = Number(saldoEm(ms));
    if (!isFinite(saldo)) continue;
    if (saldo < 0) {
      if (!furo) furo = { dia: d, ms };
      if (saldo < pior) pior = saldo;
    } else if (furo && !recupera) {
      recupera = { dia: d, ms };
    }
  }
  if (!furo) return null;
  return {
    valor: pior,
    emDias: furo.dia,
    quandoMs: furo.ms,
    recuperaMs: recupera ? recupera.ms : null,
  };
}

module.exports = {
  agoraBrasilia,
  saldoCaixaPorConta,
  fonteDeSaldo,
  aperto,
  saldoPorInstituicao,
  resumoSaldo,
  resumoFaturas,
  resumoMes,
  ymdLocal: ymd,
  // exportados para teste
  cartaoCalcularVencimento,
  cartaoUltimoFechamento,
};
