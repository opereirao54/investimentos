'use strict';

/**
 * Simulador de ações da Appliquei.
 *
 * O validador de invariantes (scripts/lib/invariantes.js) responde "este estado
 * está são?". Este módulo responde a pergunta seguinte: "e se o usuário apertar
 * ESTE botão, de TODAS as formas possíveis?".
 *
 * A ideia: montar um mundo realista onde todas as telas têm dado — contas com
 * saldo, receita, cartão com fatura, investimento com as duas pernas, sonho com
 * compromissos, bem — e então executar uma ação de UI de verdade, validando o
 * sistema INTEIRO depois de cada execução. Assim um botão da aba Sonhos que
 * estrague o Patrimônio é pego, mesmo que ninguém tenha pensado em olhar lá.
 *
 * Três classes de defeito são detectadas automaticamente:
 *
 *   excecao    a ação estourou — o usuário vê a tela travar
 *   violacoes  o estado ficou inconsistente (qualquer INV do mapa)
 *   fantasma   a ação RECUSOU (mostrou erro) mas mexeu no estado assim mesmo
 *
 * A terceira é a mais traiçoeira: valida a entrada, avisa "valor inválido", e
 * já tinha gravado metade. Nenhum teste tradicional a pega, porque o toast de
 * erro parece o comportamento certo.
 *
 * Ver .claude/skills/simular-acao/SKILL.md.
 */

const { carregarApp, estadoDe } = require('./_harness-integracao.js');
const { validarEstado, formatar } = require('../scripts/lib/invariantes.js');

// Tudo que o HTML carrega e que toca dinheiro. Um botão só é simulado de
// verdade quando o resto do sistema está presente para reagir a ele.
const ORDEM_COMPLETA = [
  'web/appliquei-utils.js',
  'web/appliquei-yahoo-finance.js',
  'web/appliquei-app.js',
  'web/appliquei-combobox.js',
  'web/appliquei-contas.js',
  'web/appliquei-aba1-charts.js',
  'web/appliquei-renda-fixa.js',
  'web/appliquei-previdencia.js',
  'web/appliquei-aba-controle-financeiro.js',
  'web/appliquei-relatorio-mensal.js',
  'web/appliquei-bens.js',
  'web/appliquei-patrimonio.js',
  'web/appliquei-sonhos.js',
  'web/appliquei-aba-dividendos.js',
];

const HOJE = new Date();

// Data da compra semeada no mundo. Tem de ser SEMPRE passado: obterResumoCarteira
// ignora aporte com data futura ("programado, ainda não aconteceu"), então uma
// data fixa no mês — era o dia 2 — apagava a posição nos primeiros dias e fazia
// a venda ser recusada. Meia-noite de hoje é passado em qualquer dia do mês e
// mantém a competência do mês corrente.
const COMPRA_EM = new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate());
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Monta um mundo com dado em TODAS as telas.
 *
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.semSonho]  não cria o sonho (para testar a criação)
 * @returns {{s: object, campos: object, ref: object}}
 */
function criarMundo(opcoes) {
  opcoes = opcoes || {};
  const campos = {};
  const s = carregarApp(campos, ORDEM_COMPLETA);

  // --- Contas: uma com saldo alto, uma com pouco, uma corretora vazia -------
  const nubank = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 20000 });
  const itau = s.criarConta({ nome: 'Itaú', tipo: 'banco', saldoInicial: 500 });
  const rico = s.criarConta({ nome: 'Rico', tipo: 'corretora', saldoInicial: 0 });

  // --- Receita do mês ------------------------------------------------------
  s.transacoes.push({
    id: 'sim_receita',
    categoria: 'receita',
    descricao: 'Salário',
    valor: 8000,
    banco: 'Nubank',
    contaId: nubank.id,
    mes: HOJE.getMonth(),
    ano: HOJE.getFullYear(),
    data: new Date(HOJE.getFullYear(), HOJE.getMonth(), 1).toISOString(),
    pago: true,
  });

  // --- Cartão com uma fatura pendente --------------------------------------
  s.cartoes = [
    {
      id: 'sim_card',
      nome: 'Visa',
      limite: 5000,
      diaFechamento: 1,
      diaVencimento: 10,
      contaPagadoraId: nubank.id,
    },
  ];
  const vencCartao = ymd(new Date(HOJE.getFullYear(), HOJE.getMonth(), 10));
  s.transacoes.push({
    id: 'sim_fatura',
    categoria: 'cartao_credito',
    cartaoId: 'sim_card',
    descricao: 'Mercado',
    valor: 350,
    mes: HOJE.getMonth(),
    ano: HOJE.getFullYear(),
    dataVencimento: vencCartao,
    data: new Date().toISOString(),
    pago: false,
  });

  // --- Investimento: operação + as duas pernas (padrão A) ------------------
  s.historicoCompras.push({
    id: 9001,
    ticker: 'PETR4',
    quantidade: 100,
    preco_op: 30,
    tipo: 'compra',
    data_op: COMPRA_EM.toISOString(),
    categoria: 'renda_variavel',
    subcategoria: 'acoes',
    corretora: 'Rico',
    contaOrigemId: nubank.id,
  });
  s.transacoes.push(
    {
      id: '9001',
      operacaoId: 9001,
      descricao: 'Compra: 100x PETR4',
      valor: 3000,
      categoria: 'investimento_variavel',
      mes: HOJE.getMonth(),
      ano: HOJE.getFullYear(),
      data: COMPRA_EM.toISOString(),
      pago: true,
      temLegCaixa: true,
    },
    {
      id: 'tx_origem_9001',
      operacaoId: 9001,
      descricao: 'Transferência → PETR4 (Rico)',
      valor: 3000,
      categoria: 'transferencia_saida',
      banco: 'Nubank',
      contaId: nubank.id,
      mes: HOJE.getMonth(),
      ano: HOJE.getFullYear(),
      data: COMPRA_EM.toISOString(),
      pago: true,
    }
  );

  // --- Bem -----------------------------------------------------------------
  s.bens = [{ id: 'bem_sim', tipo: 'veiculo', nome: 'Carro', valorAtual: 45000, arquivado: false }];

  // --- Sonho com plano vinculado e um aporte extra -------------------------
  let sonho = null;
  if (!opcoes.semSonho) {
    sonho = {
      id: 'sonho_sim',
      nome: 'Viagem',
      valorTotal: 12000,
      valorAtual: 1000,
      aportes: [{ id: 'ap_inicial', valor: 1000, data: ymd(HOJE), tipo: 'inicial' }],
      contaOrigemId: nubank.id,
      prazoMeses: 12,
      mesesRestantes: 12,
      planoVinculado: true,
      dataInicio: new Date(HOJE.getFullYear(), HOJE.getMonth(), 1).toISOString(),
      dataFim: new Date(HOJE.getFullYear() + 1, HOJE.getMonth(), 0).toISOString(),
    };
    s.sonhos = [sonho];
    s.gerarLancamentosMensaisSonho(sonho, 1000, 6);
  }

  const ref = { nubank, itau, rico, sonho, cartaoId: 'sim_card', operacaoId: 9001 };
  return { s, campos, ref };
}

/** Fotografia profunda do estado, para comparar antes/depois. */
function foto(s) {
  const e = estadoDe(s);
  return {
    json: JSON.stringify(e),
    patrimonio: patrimonioTotal(s),
    contagens: {
      transacoes: e.transacoes.length,
      contas: e.contas.length,
      sonhos: e.sonhos.length,
      operacoes: e.historicoCompras.length,
    },
  };
}

/** Saldo + investido (a preço médio) + bens. A soma que o KPI mostra. */
function patrimonioTotal(s) {
  const saldo = s.mpCalcularSaldoTotal(Date.now());
  const investido = (s.historicoCompras || []).reduce((acc, o) => {
    const v = (Number(o.quantidade) || 0) * (Number(o.preco_op) || 0);
    return acc + (o.tipo === 'compra' ? v : -v);
  }, 0);
  const bens = typeof s.totalBensAtual === 'function' ? s.totalBensAtual() : 0;
  return Math.round((saldo + investido + bens) * 100) / 100;
}

/**
 * Executa uma ação e audita o resultado.
 *
 * @param {{s:object, campos:object}} mundo
 * @param {object} acao
 * @param {string} acao.nome        rótulo legível
 * @param {function} acao.fn        recebe a sandbox e dispara a ação
 * @param {object}  [acao.campos]   valores de formulário aplicados antes
 * @param {boolean} [acao.deveRecusar] a ação DEVE ser recusada nesta entrada
 * @returns {object} relatório
 */
function executar(mundo, acao) {
  const { s, campos } = mundo;
  Object.assign(campos, acao.campos || {});
  s.__toasts = [];

  const antes = foto(s);
  let excecao = null;
  try {
    acao.fn(s);
  } catch (e) {
    excecao = e;
  }
  const depois = foto(s);

  const violacoes = validarEstado(estadoDe(s));
  const toasts = s.__toasts.slice();
  const erro = toasts.filter((t) => t.tipo === 'erro');
  const mudou = antes.json !== depois.json;
  const recusou = erro.length > 0;

  // Fantasma: recusou a operação (avisou o usuário) mas mexeu no estado.
  const fantasma = recusou && mudou;

  return {
    nome: acao.nome,
    excecao,
    violacoes,
    mudou,
    recusou,
    fantasma,
    toasts,
    deltaPatrimonio: Math.round((depois.patrimonio - antes.patrimonio) * 100) / 100,
    antes,
    depois,
  };
}

/** Monta a mensagem de falha de um relatório, ou '' se estiver tudo certo. */
function problemas(rel, esperado) {
  esperado = esperado || {};
  const linhas = [];
  if (rel.excecao) {
    linhas.push(`  EXCEÇÃO: ${rel.excecao.message}`);
    const st = (rel.excecao.stack || '').split('\n').slice(1, 4).join('\n');
    if (st) linhas.push(st);
  }
  if (rel.violacoes.length) {
    linhas.push('  INVARIANTES VIOLADAS:');
    linhas.push(formatar(rel.violacoes));
  }
  if (rel.fantasma) {
    linhas.push(
      `  MUTAÇÃO FANTASMA: a ação recusou ("${rel.toasts.find((t) => t.tipo === 'erro').msg}") ` +
        `mas mexeu no estado assim mesmo — contagens antes ` +
        `${JSON.stringify(rel.antes.contagens)} vs depois ${JSON.stringify(rel.depois.contagens)}.`
    );
  }
  if (esperado.deveRecusar && !rel.recusou) {
    linhas.push('  DEVERIA TER RECUSADO e não recusou — a entrada inválida passou.');
  }
  if (esperado.deveRecusar && rel.mudou && !rel.fantasma) {
    linhas.push('  DEVERIA TER RECUSADO e alterou o estado.');
  }
  if (esperado.semMudarPatrimonio && rel.deltaPatrimonio !== 0) {
    linhas.push(
      `  PATRIMÔNIO MEXEU quando não devia: delta ${rel.deltaPatrimonio}. ` +
        'Dinheiro não pode nascer nem sumir numa operação que só reorganiza.'
    );
  }
  if (esperado.deltaPatrimonio != null) {
    const esp = Math.round(esperado.deltaPatrimonio * 100) / 100;
    if (rel.deltaPatrimonio !== esp) {
      linhas.push(`  PATRIMÔNIO ERRADO: esperado delta ${esp}, veio ${rel.deltaPatrimonio}.`);
    }
  }
  return linhas.length ? `\n[${rel.nome}]\n${linhas.join('\n')}\n` : '';
}

module.exports = { ORDEM_COMPLETA, criarMundo, executar, problemas, foto, patrimonioTotal, ymd };
