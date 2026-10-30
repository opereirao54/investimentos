'use strict';

/**
 * Caça de furos na IMPORTAÇÃO DE FATURA — sequências aleatórias de uso real.
 *
 * Um teste de caso só pega o que alguém imaginou. Aqui um cartão vive meses
 * (test/_faturas-sinteticas.js) e a pessoa usa o app do jeito que usaria:
 *
 *   telegram    lança uma compra antes de a fatura fechar — às vezes com o
 *               valor arredondado ("padaria 20" contra R$ 19,87 no banco) e
 *               sempre com outro nome; parcelada, lança as N parcelas
 *   importar    importa a fatura de um mês qualquer (fora de ordem também),
 *               num dos 12 formatos de arquivo, aceitando o que a tela sugere
 *   reimportar  importa de novo uma fatura já importada, noutro formato
 *   desfazer    importa e desfaz na hora (o Desfazer da tela)
 *   pagar       marca como paga uma fatura importada
 *
 * Depois de CADA ação valem:
 *   IMP01  as invariantes do app: INV-08 (competência), INV-20 (cartão),
 *          INV-27 (a mesma linha do banco não vira dois lançamentos);
 *   IMP02  fatura importada tem exatamente uma entrada por compra do banco
 *          (nem duplicada, nem faltando — a estornada lançada antes sai junto);
 *   IMP03  o total da fatura no app = o do banco, no centavo (a "parecida"
 *          lançada arredondada assume o valor do banco);
 *   IMP04  desfazer volta o app EXATAMENTE ao que era antes da importação;
 *   IMP05  a mesma compra não é criada duas vezes pela importação na mesma
 *          fatura — inclusive importando os meses fora de ordem;
 *   IMP06  reimportar não cria nada;
 *   IMP07  a diferença de totais que a tela mostra é explicada e fecha;
 *   IMP08  uma fatura por mês: em metade dos mundos o cartão vence noutro dia
 *          no app (relato: dia 10 no app, dia 5 no banco) e a importação
 *          não pode abrir uma segunda fatura no mesmo mês;
 *   e nenhuma ação lança exceção.
 *
 * Uma falha devolve a semente e a sequência exata. Uso:
 *   node scripts/cacar-importacao.js 500 30
 */

const F = require('../web/appliquei-importar-fatura.js');
const Palavras = require('../web/appliquei-categorias-palavras.js');
const Insights = require('../web/appliquei-insights.js');
const { validarEstado, formatar } = require('../scripts/lib/invariantes.js');
const S = require('./_faturas-sinteticas.js');

const CARTAO = 'card_sim';
const CATEGORIAS = Object.keys(Palavras.PALAVRAS_CATEGORIA).map((v) => ({ v, label: v }));
const AGORA = new Date(2026, 9, 27, 12, 0, 0);

function criarMundo(semente) {
  const hist = S.gerarHistorico(semente, { meses: 6 });
  return {
    semente,
    hist,
    g: S.gerador(semente * 7919 + 13),
    transacoes: [],
    registros: [], // { id, k }
    telegram: {}, // compraId → { ids, ruido, k }
    origem: {}, // id do lançamento → compraId
    seq: 0,
    log: [],
    // Dia de vencimento do cartão no app. Metade dos mundos tem um dia
    // diferente do banco; a importação nunca muda o cartão: a fatura entra no
    // mês do arquivo, no dia do cartão (como a tela faz).
    diaCartao: semente % 2 === 0 ? 1 + ((semente * 31) % 28) : null,
  };
}

/** O vencimento como o app lançaria: mês do banco, dia do cartão no app. */
function noDiaDoCartao(m, ymd) {
  return m.diaCartao ? F.diaNoMes(ymd, m.diaCartao) : ymd;
}

function mesmoMes(a, b) {
  return String(a).slice(0, 7) === String(b).slice(0, 7);
}

function venc(m, k) {
  return m.hist.vencimentos[k];
}

function importadas(m) {
  return new Set(m.registros.map((r) => r.k));
}

function somarMeses(ymd, n) {
  const [a, mes, d] = ymd.split('-').map(Number);
  const dt = new Date(a, mes - 1, d);
  dt.setMonth(dt.getMonth() + n);
  return (
    dt.getFullYear() +
    '-' +
    String(dt.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(dt.getDate()).padStart(2, '0')
  );
}

/** Planeja e confirma como a tela faz, aceitando as sugestões. */
function importar(m, k, dialeto) {
  const verdade = S.linhasDaFatura(m.hist, k);
  const { conteudo, arquivo } = dialeto.montar(verdade, venc(m, k));
  const v = noDiaDoCartao(m, venc(m, k));
  const lido = F.lerArquivo(new Uint8Array(conteudo), arquivo);
  const plano = F.planejar({
    arquivo: lido,
    vencimento: v,
    cartaoId: CARTAO,
    transacoes: m.transacoes,
    categorias: CATEGORIAS,
    insights: Insights,
    palavras: Palavras,
    faturasImportadas: m.registros.map((r) => noDiaDoCartao(m, venc(m, r.k))),
  });
  // IMP07: a diferença mostrada é explicada.
  const res = F.resumo(plano);
  const soma = Math.round(res.porque.reduce((s, x) => s + x.valor, 0) * 100) / 100;
  if (Math.abs(soma - res.diferenca) >= 0.005) {
    throw new Error(`IMP07 fatura ${k}: diferença ${res.diferenca} e motivos somam ${soma}`);
  }
  const r = F.confirmar(m.transacoes, plano, {
    agora: AGORA,
    idBase: 's' + m.semente + 'n' + m.seq++,
    arquivo,
  });
  // De que compra é cada lançamento criado (para IMP05): o grupo diz a linha.
  r.novos.forEach((t) => {
    const ref = Number(String(t.groupId).split('g').pop());
    const it = plano.itens.find((x) => x.ref === ref);
    const linha = verdade[plano.itens.indexOf(it)];
    m.origem[t.id] = linha ? linha.compraId : null;
  });
  return { r, plano, res };
}

const ACOES = {
  telegram(m) {
    const imp = importadas(m);
    const candidatas = m.hist.compras.filter((c) => {
      if (c.tipo !== 'compra' || m.telegram[c.id]) return false;
      for (let k = c.ciclo; k < c.ciclo + c.m; k++) if (imp.has(k)) return false;
      return true;
    });
    if (!candidatas.length) return 'nada a lançar';
    const c = m.g.um(candidatas);
    const palavra = c.loja.split(' ')[0].toLowerCase();
    const ids = [];
    let ruido = 0;
    if (c.m === 1) {
      let valor = c.valor;
      if (m.g.chance(0.4) && Math.round(valor) > 0) {
        ruido = Math.abs(Math.round(valor) - valor);
        valor = Math.round(valor);
      }
      const id = 'tg' + m.semente + '_' + m.seq++;
      const v = noDiaDoCartao(m, venc(m, c.ciclo));
      const [a, mes] = v.split('-').map(Number);
      m.transacoes.push({
        id,
        groupId: id,
        descricao: palavra,
        valor,
        categoria: 'cartao_credito',
        cartaoId: CARTAO,
        mes: mes - 1,
        ano: a,
        dataVencimento: v,
        pago: false,
        obs: '',
        data: AGORA.toISOString(),
      });
      ids.push(id);
    } else {
      const grupo = 'tg' + m.semente + '_' + m.seq++;
      for (let i = 0; i < c.m; i++) {
        const v = somarMeses(noDiaDoCartao(m, venc(m, c.ciclo)), i);
        const [a, mes] = v.split('-').map(Number);
        const id = grupo + '_' + i;
        m.transacoes.push({
          id,
          groupId: grupo,
          descricao: `${palavra} (${i + 1}/${c.m})`,
          valor: c.valor,
          categoria: 'cartao_credito',
          cartaoId: CARTAO,
          mes: mes - 1,
          ano: a,
          dataVencimento: v,
          pago: false,
          obs: '',
          data: AGORA.toISOString(),
        });
        ids.push(id);
      }
    }
    ids.forEach((id) => (m.origem[id] = c.id));
    m.telegram[c.id] = { ids, ruido, k: c.ciclo };
    return `${palavra} ${c.m > 1 ? c.m + 'x ' : ''}(fatura ${c.ciclo}${ruido ? ', arredondado' : ''})`;
  },

  importar(m) {
    const k = m.g.int(0, m.hist.vencimentos.length - 1);
    const d = m.g.um(S.DIALETOS);
    const { r } = importar(m, k, d);
    m.registros.push({ id: r.registro.id, k });
    return `fatura ${k} via ${d.nome}: ${r.novos.length} criados`;
  },

  reimportar(m) {
    if (!m.registros.length) return 'nada importado ainda';
    const k = m.g.um(m.registros).k;
    const d = m.g.um(S.DIALETOS);
    const { r } = importar(m, k, d);
    if (r.novos.length)
      throw new Error(`IMP06 reimportar a fatura ${k} via ${d.nome} criou ${r.novos.length}`);
    return `fatura ${k} de novo via ${d.nome}`;
  },

  desfazer(m) {
    const k = m.g.int(0, m.hist.vencimentos.length - 1);
    const d = m.g.um(S.DIALETOS);
    const antes = JSON.stringify(m.transacoes);
    const { r } = importar(m, k, d);
    const des = F.desfazer(m.transacoes, r.registro);
    m.transacoes = des.transacoes;
    if (JSON.stringify(m.transacoes) !== antes) {
      throw new Error(`IMP04 desfazer a fatura ${k} (${d.nome}) não voltou ao estado anterior`);
    }
    return `fatura ${k} via ${d.nome}, desfeita`;
  },

  pagar(m) {
    const imp = Array.from(importadas(m));
    if (!imp.length) return 'nada importado ainda';
    const k = m.g.um(imp);
    m.transacoes.forEach((t) => {
      if (t.cartaoId === CARTAO && mesmoMes(t.dataVencimento, venc(m, k))) t.pago = true;
    });
    return `fatura ${k} paga`;
  },
};

const PESOS = [
  ['telegram', 4],
  ['importar', 4],
  ['reimportar', 2],
  ['desfazer', 1],
  ['pagar', 1],
];

function sortearAcao(m) {
  const total = PESOS.reduce((s, p) => s + p[1], 0);
  let x = m.g.r() * total;
  for (const [nome, peso] of PESOS) {
    x -= peso;
    if (x < 0) return nome;
  }
  return PESOS[0][0];
}

/** Os invariantes IMP01–IMP05 sobre o estado atual. Devolve a lista de problemas. */
function verificar(m) {
  const problemas = [];
  const v = validarEstado(
    {
      transacoes: m.transacoes,
      contas: [{ id: 'c1', nome: 'Banco' }],
      cartoes: [{ id: CARTAO, nome: 'Cartão', contaPagadoraId: 'c1' }],
    },
    { apenas: ['INV-08', 'INV-20', 'INV-27'] }
  );
  if (v.length) problemas.push('IMP01 ' + formatar(v));

  const imp = importadas(m);
  for (let k = 0; k < m.hist.vencimentos.length; k++) {
    const vk = venc(m, k);
    const naFatura = m.transacoes.filter(
      (t) => t.cartaoId === CARTAO && mesmoMes(t.dataVencimento, vk)
    );

    // IMP08: uma fatura por mês (um único vencimento no mês).
    const dias = new Set(naFatura.map((t) => t.dataVencimento));
    if (dias.size > 1)
      problemas.push(
        `IMP08 fatura ${k}: ${dias.size} vencimentos no mesmo mês (${[...dias].join(', ')})`
      );

    // IMP05: a importação não cria a mesma compra duas vezes na mesma fatura.
    const porCompra = {};
    naFatura.forEach((t) => {
      if (!t.importacao) return;
      const c = m.origem[t.id];
      if (!c) return;
      porCompra[c] = (porCompra[c] || 0) + 1;
      if (porCompra[c] === 2)
        problemas.push(
          `IMP05 fatura ${k}: a compra ${c} foi criada duas vezes pela importação (${t.descricao})`
        );
    });

    if (!imp.has(k)) continue;
    const verdade = S.linhasDaFatura(m.hist, k);
    const esperado = S.esperadoDaFatura(verdade);
    // Com as escolhas que a tela sugere, a fatura do app fica IGUAL à do banco:
    // a "parecida" (lançada arredondada pelo Telegram) assume o valor do banco
    // e a compra estornada que estava no app sai junto.
    if (naFatura.length !== esperado.compras) {
      problemas.push(
        `IMP02 fatura ${k}: ${naFatura.length} lançamentos no app, o banco tem ${esperado.compras} compras` +
          ` — ${naFatura.map((t) => t.descricao + ' ' + t.valor).join(', ')}`
      );
    }
    const totalApp = naFatura.reduce((s, t) => s + t.valor, 0);
    if (Math.abs(totalApp - esperado.total) > 0.01) {
      problemas.push(
        `IMP03 fatura ${k}: total no app ${totalApp.toFixed(2)}, no banco ${esperado.total.toFixed(2)}`
      );
    }
  }
  return problemas;
}

function rodarSequenciaImportacao(semente, passos) {
  const m = criarMundo(semente);
  for (let i = 0; i < passos; i++) {
    const acao = sortearAcao(m);
    let desc;
    try {
      desc = ACOES[acao](m);
    } catch (e) {
      m.log.push(`${i + 1}. ${acao} → EXCEÇÃO`);
      return { ok: false, semente, passo: i + 1, acao, erro: e.message, log: m.log, mundo: m };
    }
    m.log.push(`${i + 1}. ${acao}: ${desc}`);
    const problemas = verificar(m);
    if (problemas.length) {
      return {
        ok: false,
        semente,
        passo: i + 1,
        acao,
        erro: problemas.join('\n'),
        log: m.log,
        mundo: m,
      };
    }
  }
  return { ok: true, semente, passos, log: m.log, mundo: m };
}

module.exports = { ACOES, rodarSequenciaImportacao, verificar, criarMundo };
