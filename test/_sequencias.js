'use strict';

/**
 * Motor de sequências aleatórias de ações.
 *
 * Os testes de simulação exercitam UMA ação por vez, com entradas que alguém
 * pensou em escrever. Este módulo encadeia ações em ordens arbitrárias e valida
 * o sistema inteiro ENTRE CADA PASSO — é assim que aparecem os defeitos de
 * interação, os que só existem quando A acontece depois de B e que nenhuma
 * lista de casos cobre, porque a lista é finita e as ordens não são.
 *
 * O gerador é determinístico: mesma semente, mesma sequência, em toda máquina e
 * no CI. Um teste que falha às vezes não serve como trava, e um bug que não
 * reproduz não se conserta.
 *
 * Consumido por test/simulacao-sequencias.test.js (40 sementes, no CI) e por
 * scripts/cacar-interacoes.js (caça intensiva, sob demanda).
 */

const { criarMundo, executar, problemas, ymd } = require('./_simulador.js');

const H = ymd(new Date());

/** PRNG determinístico (mulberry32) — mesma semente, mesma sequência. */
function rng(semente) {
  let a = semente >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Catálogo de ações encadeáveis. Cada uma recebe o mundo e o gerador, e devolve
 * null quando não se aplica ao estado atual (ex.: pagar sem parcela pendente).
 */
const ACOES = [
  {
    nome: 'aporte extra',
    fn: (m, r) => {
      if (!m.s.sonhos.length) return null;
      const valor = Math.round(r() * 800) + 50;
      return () => m.s.finalizarAporteSonho(m.s.sonhos[0].id, valor, H, 'esporadico', null);
    },
  },
  {
    nome: 'aporte por migração',
    fn: (m, r) => {
      if (!m.s.sonhos.length) return null;
      const valor = Math.round(r() * 500) + 50;
      return () =>
        m.s.finalizarAporteSonho(m.s.sonhos[0].id, valor, H, 'migracao', { origemAtivo: 'PETR4' });
    },
  },
  {
    nome: 'editar o último aporte',
    fn: (m, r) => {
      const s = m.s.sonhos[0];
      if (!s || !(s.aportes || []).length) return null;
      const ap = s.aportes[s.aportes.length - 1];
      const novo = Math.round(r() * 900) + 50;
      return () => {
        m.campos.editAporteValor = String(novo);
        m.campos.editAporteData = H;
        m.s.salvarEdicaoAporteSonho(s.id, ap.id);
      };
    },
  },
  {
    nome: 'excluir o último aporte',
    fn: (m) => {
      const s = m.s.sonhos[0];
      if (!s || !(s.aportes || []).length) return null;
      const ap = s.aportes[s.aportes.length - 1];
      return () => m.s.confirmarExcluirAporteSonho(s.id, ap.id);
    },
  },
  {
    nome: 'pagar a próxima parcela do sonho',
    fn: (m) => {
      const p = m.s.transacoes.find((t) => t.categoria === 'sonho' && !t.aporteExtra && !t.pago);
      if (!p) return null;
      return () => {
        m.campos['input-pago-' + p.id] = String(p.valor).replace('.', ',');
        m.s.confirmarPagamento(p.id);
      };
    },
  },
  {
    nome: 'pular o mês do sonho',
    fn: (m) => {
      if (!m.s.sonhos.length) return null;
      return () => m.s.pularMesSonho(m.s.sonhos[0].id);
    },
  },
  {
    nome: 'editar a meta do sonho',
    fn: (m, r) => {
      const s = m.s.sonhos[0];
      if (!s) return null;
      const meta = (Math.round(r() * 30) + 5) * 1000;
      return () => {
        Object.assign(m.campos, {
          sonhoNome: 'Viagem',
          sonhoValorTotal: String(meta),
          sonhoPrazo: '12',
          sonhoPrazoUnidade: 'meses',
          sonhoValorInicial: String(s.valorAtual),
          sonhoDescricao: '',
          sonhoContaOrigem: s.contaOrigemId,
          sonhoMesInicio: '',
          sonhoCategoria: 'viagem',
          sonhoEsforco: 'medio',
        });
        m.s.sonhoEditandoId = s.id;
        m.s.salvarSonho();
      };
    },
  },
  {
    nome: 'trocar a conta do sonho',
    fn: (m, r) => {
      const s = m.s.sonhos[0];
      if (!s) return null;
      const ativas = m.s.contasAtivas();
      const conta = ativas[Math.floor(r() * ativas.length)];
      if (!conta) return null;
      return () => {
        Object.assign(m.campos, {
          sonhoNome: 'Viagem',
          sonhoValorTotal: String(s.valorTotal),
          sonhoPrazo: '12',
          sonhoPrazoUnidade: 'meses',
          sonhoValorInicial: String(s.valorAtual),
          sonhoDescricao: '',
          sonhoContaOrigem: conta.id,
          sonhoMesInicio: '',
          sonhoCategoria: 'viagem',
          sonhoEsforco: 'medio',
        });
        m.s.sonhoEditandoId = s.id;
        m.s.salvarSonho();
      };
    },
  },
  {
    nome: 'pagar a fatura do cartão',
    fn: (m) => {
      const f = m.s.transacoes.find((t) => t.categoria === 'cartao_credito' && !t.pago);
      if (!f) return null;
      return () => {
        m.campos['input-pago-' + f.id] = String(f.valor).replace('.', ',');
        m.s.confirmarPagamento(f.id);
      };
    },
  },
  {
    nome: 'reverter um pagamento reversível',
    fn: (m) => {
      const t = m.s.transacoes.find((x) => m.s.controlePodeReverterPagamento(x));
      if (!t) return null;
      return () => m.s.reverterPagamento(t.id);
    },
  },
  {
    nome: 'transferência entre contas',
    fn: (m, r) => {
      const ativas = m.s.contasAtivas();
      if (ativas.length < 2) return null;
      const a = ativas[Math.floor(r() * ativas.length)];
      const b = ativas.find((c) => c.id !== a.id);
      if (!b) return null;
      const valor = Math.round(r() * 400) + 10;
      return () => m.s.criarTransferencia(a.id, b.id, valor, H);
    },
  },
  {
    nome: 'venda parcial de ativo',
    fn: (m, r) => {
      const conta = m.s.contasAtivas()[0];
      if (!conta || !m.s.historicoCompras.some((o) => o.ticker === 'PETR4')) return null;
      const qtd = Math.max(1, Math.round(r() * 30));
      return () => {
        Object.assign(m.campos, {
          compraTicker: 'PETR4',
          tipoOperacao: 'venda',
          compraCategoria: 'renda_variavel',
          compraCorretora: 'Rico',
          compraQtd: String(qtd),
          compraPreco: '30,00',
          compraSubcategoria: 'acoes',
          compraDestinoRecurso: conta.id,
          compraData: '',
          compraVencimento: '',
          compraRentabilidade: '',
          compraOrigemRecurso: '',
          compraTotalOp: '',
        });
        m.s.registrarOperacaoAtivo();
      };
    },
  },
  {
    nome: 'excluir o sonho (manter histórico)',
    fn: (m) => {
      if (!m.s.sonhos.length) return null;
      const id = m.s.sonhos[0].id;
      return () => m.s.confirmarExcluirSonho(id);
    },
  },
];

/** Roda uma sequência de N passos com a semente dada. */
function rodarSequencia(semente, passos) {
  const r = rng(semente);
  const m = criarMundo();
  const trilha = [];
  for (let i = 0; i < passos; i++) {
    const disponiveis = ACOES.map((a) => ({ a, exec: a.fn(m, r) })).filter((x) => x.exec);
    if (!disponiveis.length) break;
    const escolha = disponiveis[Math.floor(r() * disponiveis.length)];
    trilha.push(escolha.a.nome);
    const rel = executar(m, {
      nome: `semente ${semente}, passo ${i + 1}: ${escolha.a.nome}`,
      fn: escolha.exec,
    });
    const p = problemas(rel);
    if (p) {
      return {
        falhou: true,
        mensagem:
          `${p}\nSEQUÊNCIA ATÉ AQUI (semente ${semente}):\n` +
          trilha.map((n, k) => `  ${k + 1}. ${n}`).join('\n') +
          `\n\nPara reproduzir: rodarSequencia(${semente}, ${i + 1})`,
      };
    }
  }
  return { falhou: false, trilha };
}

module.exports = { rng, ACOES, rodarSequencia };
