'use strict';

// Alertas do bot do Telegram — as REGRAS. Puro: recebe os dados do usuário e
// "agora" (relógio de Brasília, ver telegram-consultas.agoraBrasilia) e devolve
// a lista de avisos que valem neste momento. Quem decide se o usuário já
// recebeu, se desligou o tipo, e quem manda a mensagem é
// telegram-alertas-envio.js.
//
// Cada aviso tem uma `chave` estável: é ela que impede o mesmo aviso de sair
// duas vezes (o agendador roda de hora em hora e pode repetir, atrasar ou
// pular uma rodada).
//
// As regras são as do app, citadas em cada uma:
//   contas a vencer   → agenda de vencimentos de atualizarTelaControle
//   fatura            → cartaoFaturasCandidatas (via telegram-consultas)
//   limite de 60%     → atualizarTermometro60
//   saldo projetado   → saldoCaixaPorConta(refMs futuro)

const C = require('./telegram-consultas');

// Ordem = ordem do painel /alertas.
const TIPOS = [
  { id: 'vencimentos', rotulo: 'Contas vencendo', janela: 'manha' },
  { id: 'vencidas', rotulo: 'Contas vencidas', janela: 'manha' },
  { id: 'fatura_fecha', rotulo: 'Fatura fechando', janela: 'manha' },
  { id: 'fatura_vence', rotulo: 'Fatura vencendo', janela: 'manha' },
  { id: 'saldo_negativo', rotulo: 'Saldo vai ficar negativo', janela: 'manha' },
  { id: 'limite60', rotulo: 'Limite de 60% da receita', janela: 'noite' },
  { id: 'ritmo', rotulo: 'Ritmo de gasto', janela: 'noite' },
  { id: 'lembrete', rotulo: 'Lembrete de lançar', janela: 'noite' },
  { id: 'sonho', rotulo: 'Sonho conquistado', janela: 'noite' },
];
const TIPO_POR_ID = Object.fromEntries(TIPOS.map((t) => [t.id, t]));

// Horas de Brasília em que cada janela pode sair. Mais de uma hora por
// janela de propósito: o agendador do GitHub atrasa e às vezes pula uma
// rodada. A janela sai uma vez por dia, na primeira rodada que cair aqui.
const JANELAS = {
  manha: { de: 8, ate: 11, titulo: '☀️ <b>Bom dia!</b>' },
  noite: { de: 20, ate: 22, titulo: '🌙 <b>Boa noite!</b>' },
};

function janelaDaHora(agora) {
  const h = agora.getHours();
  for (const id of Object.keys(JANELAS)) {
    if (h >= JANELAS[id].de && h <= JANELAS[id].ate) return id;
  }
  return null;
}

// ─── utilidades ─────────────────────────────────────────────────────────────

const ymd = C.ymdLocal;
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

function diaMais(agora, n) {
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + n);
}

function ddmm(ymdStr) {
  const [, m, d] = String(ymdStr).split('-');
  return `${d}/${m}`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function brl(n) {
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Entradas não são "conta a pagar". A agenda do app exclui receita e resgate;
// dividendo e transferência de entrada também são dinheiro que CHEGA, e um
// aviso "vence o dividendo" seria absurdo — por isso a lista aqui é a de
// mpEhEntradaCaixa, um pouco mais larga que a da agenda.
function ehEntrada(cat) {
  return (
    cat === 'receita' ||
    cat === 'dividendo' ||
    cat === 'resgate_investimento' ||
    cat === 'transferencia_entrada'
  );
}

// Agenda de vencimentos (atualizarTelaControle): tem vencimento, não está
// paga e não é entrada. Cartão é agrupado por (cartão, vencimento) = fatura.
function aPagar(transacoes) {
  return (transacoes || []).filter(
    (t) => t && t.dataVencimento && !t.pago && !ehEntrada(t.categoria)
  );
}

function gruposFatura(pendentes) {
  const g = {};
  pendentes
    .filter((t) => t.categoria === 'cartao_credito')
    .forEach((t) => {
      const k = `${t.cartaoId || 'sem'}__${t.dataVencimento}`;
      if (!g[k])
        g[k] = { cartaoId: t.cartaoId, dataVencimento: t.dataVencimento, ids: [], total: 0 };
      g[k].ids.push(t.id);
      g[k].total += Number(t.valor) || 0;
    });
  return Object.values(g);
}

function nomeCartao(cartoes, id) {
  const c = (cartoes || []).find((x) => x && x.id === id);
  return c ? c.nome : 'Cartão';
}

// ─── as regras ──────────────────────────────────────────────────────────────

function alertasVencimentos(d, agora) {
  const hoje = ymd(agora);
  const amanha = ymd(diaMais(agora, 1));
  return aPagar(d.transacoes)
    .filter((t) => t.categoria !== 'cartao_credito')
    .filter((t) => t.dataVencimento === hoje || t.dataVencimento === amanha)
    .sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento))
    .map((t) => {
      const quando = t.dataVencimento === hoje ? 'Hoje' : 'Amanhã';
      return {
        tipo: 'vencimentos',
        chave: `venc:${t.id}:${t.dataVencimento}:${quando === 'Hoje' ? 'h' : 'a'}`,
        texto: `📅 <b>${quando}</b> vence <b>${esc(t.descricao || 'conta')}</b> · ${brl(t.valor)}`,
        pagar: { rotulo: t.descricao || 'conta', alvos: [t.id] },
      };
    });
}

// Só as que venceram nos últimos 3 dias: quem liga o bot com 20 contas
// atrasadas do ano passado não recebe 20 avisos de uma vez, e o app já mostra
// o atraso em vermelho.
function alertasVencidas(d, agora) {
  const hoje = ymd(agora);
  const limite = ymd(diaMais(agora, -3));
  return aPagar(d.transacoes)
    .filter((t) => t.categoria !== 'cartao_credito')
    .filter((t) => t.dataVencimento < hoje && t.dataVencimento >= limite)
    .sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento))
    .map((t) => ({
      tipo: 'vencidas',
      chave: `vencida:${t.id}:${t.dataVencimento}`,
      texto:
        `⚠️ <b>${esc(t.descricao || 'Conta')}</b> venceu ${ddmm(t.dataVencimento)} e não ` +
        `está paga · ${brl(t.valor)}`,
      pagar: { rotulo: t.descricao || 'conta', alvos: [t.id] },
    }));
}

function alertasFaturaVence(d, agora) {
  const hoje = ymd(agora);
  const amanha = ymd(diaMais(agora, 1));
  const ativos = new Set((d.cartoes || []).filter((c) => c && !c.arquivado).map((c) => c.id));
  return gruposFatura(aPagar(d.transacoes))
    .filter((g) => ativos.has(g.cartaoId))
    .filter((g) => g.dataVencimento === hoje || g.dataVencimento === amanha)
    .filter((g) => g.total > 0.005)
    .map((g) => {
      const quando = g.dataVencimento === hoje ? 'Hoje' : 'Amanhã';
      const nome = nomeCartao(d.cartoes, g.cartaoId);
      return {
        tipo: 'fatura_vence',
        chave: `fv:${g.cartaoId}:${g.dataVencimento}:${quando === 'Hoje' ? 'h' : 'a'}`,
        texto: `💳 <b>${quando}</b> vence a fatura do <b>${esc(nome)}</b> · ${brl(g.total)}`,
        pagar: { rotulo: `fatura ${nome}`, alvos: g.ids },
      };
    });
}

// Avisa 2 dias antes do fechamento (ou 1, se a rodada de 2 dias não saiu).
// A chave é por fechamento, então sai uma vez só.
function alertasFaturaFecha(d, agora) {
  const em1 = ymd(diaMais(agora, 1));
  const em2 = ymd(diaMais(agora, 2));
  return C.resumoFaturas(d, agora)
    .filter((c) => !c.semDatas)
    .filter((c) => c.aberta.fechamento === em1 || c.aberta.fechamento === em2)
    .filter((c) => c.aberta.total > 0.005)
    .map((c) => {
      const [a, m, dia] = c.aberta.fechamento.split('-').map(Number);
      const data = new Date(a, m - 1, dia);
      const quando = c.aberta.fechamento === em1 ? 'amanhã' : DIAS_SEMANA[data.getDay()];
      return {
        tipo: 'fatura_fecha',
        chave: `ff:${c.id}:${c.aberta.fechamento}`,
        texto:
          `💳 A fatura do <b>${esc(c.nome)}</b> fecha <b>${quando} (${ddmm(c.aberta.fechamento)})</b>` +
          ` com ${brl(c.aberta.total)} até agora. O que você comprar depois entra na fatura seguinte.`,
      };
    });
}

/**
 * Termômetro dos 60% (atualizarTermometro60): gasto = despesas fixas +
 * variáveis + cartão do mês; limite = 60% da RECEITA (sem resgate). Faixas do
 * app: até 50% ok, até 60% atenção, acima ultrapassado.
 */
function termometro60(d, mes, ano) {
  const r = C.resumoMes(d, mes, ano);
  const receita = r.bruto.receita;
  const gasto = r.bruto.despFixa + r.bruto.despVar + r.bruto.cartao;
  if (!(receita > 0)) return { receita, gasto, limite: 0, pct: 0, faixa: 'sem_dados', resumo: r };
  const pct = (gasto / receita) * 100;
  let faixa = 'ok';
  if (pct > 60) faixa = 'ultrapassado';
  else if (pct > 50) faixa = 'atencao';
  return { receita, gasto, limite: receita * 0.6, pct, faixa, resumo: r };
}

function maioresCategorias(porCategoria, rotulos, n) {
  return Object.keys(porCategoria)
    .map((k) => ({ k, v: porCategoria[k] }))
    .filter((c) => c.v > 0.005)
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((c) => `${esc(rotulos[c.k] || c.k)} ${brl(c.v)}`)
    .join(' · ');
}

function alertasLimite60(d, agora) {
  const mes = agora.getMonth();
  const ano = agora.getFullYear();
  const t = termometro60(d, mes, ano);
  if (t.faixa !== 'atencao' && t.faixa !== 'ultrapassado') return [];
  const base = `l60:${ano}-${mes}`;
  const diasFaltam = new Date(ano, mes + 1, 0).getDate() - agora.getDate();
  const quem = maioresCategorias(t.resumo.porCategoria, d.rotulos || {}, 2);
  const pct = t.pct.toFixed(0);
  const linhas = [];
  if (t.faixa === 'atencao') {
    linhas.push(`🟡 <b>Atenção: seus gastos chegaram a ${pct}% da receita de ${MESES[mes]}</b>`);
    linhas.push(`Limite de segurança: ${brl(t.limite)} · gasto: ${brl(t.gasto)}`);
    linhas.push(
      `Faltam <b>${brl(t.limite - t.gasto)}</b> para o limite` +
        (diasFaltam > 0 ? `, e ainda faltam ${diasFaltam} dias no mês.` : '.')
    );
  } else {
    linhas.push(`🔴 <b>Você passou do limite de 60% da receita em ${MESES[mes]}</b> (${pct}%)`);
    linhas.push(
      `Gasto ${brl(t.gasto)} · limite ${brl(t.limite)} · <b>${brl(t.gasto - t.limite)} acima</b>`
    );
  }
  if (quem) linhas.push(`Quem mais pesou: ${quem}`);
  return [
    {
      tipo: 'limite60',
      chave: `${base}:${t.faixa}`,
      // Passou direto para "ultrapassado": o "atenção" do mês não sai depois.
      implica: t.faixa === 'ultrapassado' ? [`${base}:atencao`] : [],
      texto: linhas.join('\n'),
    },
  ];
}

// Aperto de caixa — o card "sai antes de entrar" do Controle
// (insightsAperto sobre a projeção de saldoCaixaPorConta). A mensagem segue a
// mesma escolha de palavras do app, e pelo mesmo motivo: o saldo livre da tela
// é de competência e fecha positivo; "seu saldo vai ficar negativo" ao lado
// dele parece contradição. O que se avisa é a ORDEM: há conta vencendo antes
// de o dinheiro entrar.
// Só avisa furo nos próximos 10 dias (antes disso não há o que fazer hoje),
// uma vez por data de furo: se a pessoa mexe e o furo muda de dia, é aviso novo.
const APERTO_JANELA_DIAS = 45; // INSIGHTS_LIMIARES.diasJanelaAperto
const APERTO_AVISO_ATE_DIAS = 10;

function dataBR(ms) {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function alertasSaldoNegativo(d, agora) {
  // Projeta pelo FIM de cada dia. O app projeta a partir do instante em que a
  // tela abre, e o vencimento é lido ao meio-dia (appliqueiParseData): às 9h a
  // conta do dia 12 só "cai" no passo do dia 13. Na tela isso oscila com a hora;
  // num alerta das 8h daria a data errada. Fim do dia responde "em que dia
  // fico no vermelho" igual de manhã e de noite. As funções são as mesmas do
  // app (paridade em test/telegram-alertas.test.js); muda só o relógio.
  const agoraMs = new Date(
    agora.getFullYear(),
    agora.getMonth(),
    agora.getDate(),
    23,
    59,
    59
  ).getTime();
  const fonte = C.fonteDeSaldo(d, agoraMs);
  if (!fonte.saldoEm) return [];
  const a = C.aperto(fonte.saldoEm, agoraMs, APERTO_JANELA_DIAS);
  if (!a || a.emDias > APERTO_AVISO_ATE_DIAS) return [];
  const furo = dataBR(a.quandoMs);
  const falta = brl(Math.abs(a.valor));
  const texto = a.recuperaMs
    ? `🗓️ <b>Entre ${furo} e ${dataBR(a.recuperaMs)}, sai antes de entrar.</b>\n` +
      `Com o que está agendado, suas contas ficam <b>${falta}</b> no vermelho no pior dia. ` +
      `O mês fecha no positivo: é a ordem das datas. Adiar um vencimento para depois de ` +
      `${dataBR(a.recuperaMs)} resolve.`
    : `🔻 <b>A partir de ${furo}, sai mais do que entra.</b>\n` +
      `Com o que está agendado, suas contas ficam <b>${falta}</b> no vermelho e não voltam ` +
      `ao azul nos próximos ${APERTO_JANELA_DIAS} dias.`;
  return [{ tipo: 'saldo_negativo', chave: `aperto:${ymd(new Date(a.quandoMs))}`, texto }];
}

// Ritmo: despesas variáveis + cartão do mês já passaram o mês anterior INTEIRO.
// Comparar o mês todo (e não "até o mesmo dia") porque o app não guarda o dia
// do gasto em todo lançamento — recorrente e cartão vivem pela competência.
// Uma vez por mês.
function alertasRitmo(d, agora) {
  const mes = agora.getMonth();
  const ano = agora.getFullYear();
  const ant = new Date(ano, mes - 1, 1);
  const r = C.resumoMes(d, mes, ano).bruto;
  const p = C.resumoMes(d, ant.getMonth(), ant.getFullYear()).bruto;
  const atual = r.despVar + r.cartao;
  const anterior = p.despVar + p.cartao;
  if (!(anterior > 0) || !(atual > anterior)) return [];
  const diasFaltam = new Date(ano, mes + 1, 0).getDate() - agora.getDate();
  return [
    {
      tipo: 'ritmo',
      chave: `ritmo:${ano}-${mes}`,
      texto:
        `📈 Em ${MESES[mes]} você já gastou <b>${brl(atual)}</b> em despesas variáveis e ` +
        `cartão: mais que ${MESES[ant.getMonth()]} inteiro (${brl(anterior)})` +
        (diasFaltam > 0 ? `, e ainda faltam ${diasFaltam} dias.` : '.'),
    },
  ];
}

// Lembrete: 3 dias sem lançar nada (nem no app, nem aqui). Uma vez por
// período parado: a chave é o dia da última atividade.
const LEMBRETE_DIAS = 3;

function ultimaAtividade(d) {
  let ult = Number(d.ultimaAtividadeMs) || 0;
  (d.transacoes || []).forEach((t) => {
    if (!t || !t.data) return;
    const ms = new Date(t.data).getTime();
    if (isFinite(ms) && ms > ult) ult = ms;
  });
  return ult || null;
}

function alertasLembrete(d, agora) {
  const ult = ultimaAtividade(d);
  if (!ult) return []; // nunca lançou nada: não é lembrete, é onboarding
  const dias = Math.floor((agora.getTime() - ult) / 86400000);
  if (dias < LEMBRETE_DIAS) return [];
  const desde = new Date(ult);
  return [
    {
      tipo: 'lembrete',
      chave: `lembrete:${ymd(desde)}`,
      texto:
        `✍️ Nada lançado desde ${DIAS_SEMANA[desde.getDay()]} (${dataBR(ult)}). ` +
        'Gastou alguma coisa? É só mandar aqui, por exemplo <code>mercado 52,90</code>.',
    },
  ];
}

// Sonho conquistado: o mesmo critério da aba Sonhos (valorAtual ≥ valorTotal).
// `silenciosoNaPrimeira`: na primeira avaliação de cada usuário, o que já
// estava conquistado é registrado sem aviso — quem ligou o bot não recebe
// parabéns por um sonho de dois anos atrás.
function alertasSonho(d) {
  return (d.sonhos || [])
    .filter((s) => s && s.id && Number(s.valorTotal) > 0)
    .filter((s) => (Number(s.valorAtual) || 0) >= Number(s.valorTotal))
    .map((s) => ({
      tipo: 'sonho',
      chave: `sonho:${s.id}`,
      silenciosoNaPrimeira: true,
      texto:
        `🎉 <b>Você conquistou o sonho ${esc(s.nome || '')}!</b> ` +
        `${brl(s.valorTotal)} guardados. Parabéns pela constância.`,
    }));
}

const REGRAS = {
  vencimentos: alertasVencimentos,
  vencidas: alertasVencidas,
  fatura_fecha: alertasFaturaFecha,
  fatura_vence: alertasFaturaVence,
  saldo_negativo: alertasSaldoNegativo,
  limite60: alertasLimite60,
  ritmo: alertasRitmo,
  lembrete: alertasLembrete,
  sonho: alertasSonho,
};

/**
 * Os avisos da janela, na ordem do painel. Não filtra preferências nem o que
 * já foi enviado — isso é do envio.
 *
 * @param {object} d     dados do usuário (transacoes, contas, cartoes, sonhos,
 *                       rotulos de categoria, ultimaAtividadeMs)
 * @param {Date}   agora relógio de Brasília
 * @param {string} janela 'manha' | 'noite'
 */
function avaliar(d, agora, janela) {
  const out = [];
  TIPOS.filter((t) => t.janela === janela && REGRAS[t.id]).forEach((t) => {
    REGRAS[t.id](d, agora).forEach((a) => out.push(a));
  });
  return out;
}

module.exports = {
  TIPOS,
  TIPO_POR_ID,
  JANELAS,
  janelaDaHora,
  avaliar,
  termometro60,
  // para teste e para a 2c registrar regras novas
  REGRAS,
  aPagar,
};
