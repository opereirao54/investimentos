'use strict';

/**
 * Importar fatura: TODA fatura sintética × TODO dialeto de arquivo.
 *
 * Ninguém tem cartão em todos os bancos para testar com arquivo de verdade.
 * Então o teste inventa a fatura (test/_faturas-sinteticas.js), sabe a
 * VERDADE de cada linha, escreve a mesma fatura nas formas que os bancos usam
 * (OFX SGML/XML/numa linha/vírgula; CSV com vírgula, ponto e vírgula,
 * Latin-1, BOM, colunas trocadas, colunas a mais, parcela em coluna própria,
 * compra negativa, "R$") e confere, para cada combinação:
 *
 *   D1  o arquivo é lido sem erro, linha a linha igual à verdade
 *       (data, título e valor);
 *   D2  cada linha recebe o destino certo: compra nova, anulada pelo estorno,
 *       crédito de outra fatura, pagamento ignorado;
 *   D3  parcela N/M reconhecida, inclusive quando vem numa coluna própria;
 *   D4  num app vazio, o app fica com exatamente as compras do banco: mesma
 *       quantidade, mesmo total, e o número certo de lançamentos (parcelas
 *       futuras incluídas);
 *   D5  a diferença entre o total do banco e o do app é explicada motivo a
 *       motivo, e a soma dos motivos fecha EXATAMENTE;
 *   D6  todo lançamento criado tem competência = mês do vencimento (INV-08),
 *       valor positivo e id único;
 *   D7  reimportar o mesmo arquivo não cria nada (o CSV não tem FITID);
 *   D8  importar num dialeto e depois noutro (OFX e depois CSV da mesma
 *       fatura) também não cria nada.
 *
 * O CI roda as sementes abaixo; `npm run cacar:importacao` vai mais fundo.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const F = require('../web/appliquei-importar-fatura.js');
const Palavras = require('../web/appliquei-categorias-palavras.js');
const Insights = require('../web/appliquei-insights.js');
const S = require('./_faturas-sinteticas.js');

const SEMENTES = Number(process.env.SEMENTES_DIALETOS) || 40;
const CARTAO = 'card_x';
const CATEGORIAS = Object.keys(Palavras.PALAVRAS_CATEGORIA).map((v) => ({ v, label: v }));
const AGORA = new Date(2026, 9, 27, 12, 0, 0);

function planejar(arquivo, venc, transacoes) {
  return F.planejar({
    arquivo,
    vencimento: venc,
    cartaoId: CARTAO,
    transacoes: transacoes || [],
    categorias: CATEGORIAS,
    insights: Insights,
    palavras: Palavras,
  });
}

const DESTINO = {
  compra: 'nova',
  encargo: 'nova',
  estorno: 'anulada',
  credito_fora: 'credito_fora',
  pagamento: 'ignorada',
  saldo_anterior: 'ignorada',
};

function contar(lista, chave) {
  const m = {};
  lista.forEach((x) => {
    const k = chave(x);
    m[k] = (m[k] || 0) + 1;
  });
  return m;
}

/** D5: a soma dos motivos fecha a diferença. */
function reconcilia(res, contexto) {
  const soma = Math.round(res.porque.reduce((s, m) => s + m.valor, 0) * 100) / 100;
  assert.ok(
    Math.abs(soma - res.diferenca) < 0.005,
    `${contexto}: diferença ${res.diferenca} e motivos somam ${soma} — ${JSON.stringify(res.porque)}`
  );
}

/** Uma fatura × um dialeto: D1–D7. Devolve os lançamentos criados. */
function conferir(hist, k, dialeto) {
  const venc = hist.vencimentos[k];
  const verdade = S.linhasDaFatura(hist, k);
  const esperado = S.esperadoDaFatura(verdade);
  const ctx = `semente ${hist.semente}, fatura ${k} (${venc}), ${dialeto.nome}`;
  const { conteudo, arquivo } = dialeto.montar(verdade, venc);

  // D1
  let lido;
  try {
    lido = F.lerArquivo(new Uint8Array(conteudo), arquivo);
  } catch (e) {
    assert.fail(`${ctx}: não leu (${e.codigo || e.message})`);
  }
  assert.equal(lido.linhas.length, verdade.length, `${ctx}: quantidade de linhas`);
  lido.linhas.forEach((l, i) => {
    const v = verdade[i];
    assert.equal(l.data, v.data, `${ctx}, linha ${i}: data`);
    assert.equal(l.titulo, v.titulo, `${ctx}, linha ${i}: título`);
    assert.ok(
      Math.abs(l.valor - v.valor) < 0.005,
      `${ctx}, linha ${i}: valor ${l.valor} ≠ ${v.valor}`
    );
  });
  if (dialeto.vencNoNome) assert.equal(lido.vencimentoArquivo, venc, `${ctx}: vencimento no nome`);

  // D2 e D3
  const plano = planejar(lido, venc);
  assert.deepEqual(
    contar(plano.itens, (it) => it.status),
    contar(verdade, (v) => (v.anulada ? 'anulada' : DESTINO[v.tipo])),
    `${ctx}: destino das linhas`
  );
  plano.itens.forEach((it, i) => {
    const v = verdade[i];
    if (v.m > 1)
      assert.deepEqual([it.parcela.n, it.parcela.m], [v.n, v.m], `${ctx}, linha ${i}: parcela`);
    else assert.equal(it.parcela, null, `${ctx}, linha ${i}: não é parcela`);
  });

  // D4 e D5
  const res = F.resumo(plano);
  assert.equal(res.qtdNovas, esperado.compras, `${ctx}: compras novas`);
  assert.equal(res.appDepois, esperado.total, `${ctx}: total no app`);
  assert.equal(res.lancamentosCriados, esperado.lancamentos, `${ctx}: lançamentos`);
  if (lido.totalBanco != null)
    assert.equal(res.totalBanco, esperado.ledger, `${ctx}: total do banco`);
  reconcilia(res, ctx);

  // D6
  const r = F.aplicar(plano, { transacoes: [], agora: AGORA, idBase: String(hist.semente) + k });
  assert.equal(r.novos.length, esperado.lancamentos, `${ctx}: lançamentos criados`);
  const ids = new Set();
  r.novos.forEach((t) => {
    const [a, m] = t.dataVencimento.split('-').map(Number);
    assert.equal(t.mes, m - 1, `${ctx}: mês da competência`);
    assert.equal(t.ano, a, `${ctx}: ano da competência`);
    assert.ok(t.valor > 0 && Number.isFinite(t.valor), `${ctx}: valor ${t.valor}`);
    assert.ok(t.dataVencimento >= venc, `${ctx}: vencimento antes da fatura`);
    assert.equal(t.pago, false);
    assert.ok(!ids.has(t.id), `${ctx}: id repetido ${t.id}`);
    ids.add(t.id);
  });

  // D7
  const p2 = planejar(lido, venc, r.novos);
  const res2 = F.resumo(p2);
  assert.equal(res2.qtdNovas, 0, `${ctx}: reimportar criou ${res2.qtdNovas}`);
  assert.equal(res2.appDepois, esperado.total, `${ctx}: total depois de reimportar`);
  reconcilia(res2, ctx + ' (reimportação)');
  return { verdade, lido, novos: r.novos };
}

test(`dialetos: ${SEMENTES} históricos × 5 faturas × ${S.DIALETOS.length} formatos de arquivo`, () => {
  let combinacoes = 0;
  for (let semente = 1; semente <= SEMENTES; semente++) {
    const hist = S.gerarHistorico(semente);
    for (let k = 0; k < hist.vencimentos.length; k++) {
      for (const d of S.DIALETOS) {
        conferir(hist, k, d);
        combinacoes++;
      }
    }
  }
  assert.ok(combinacoes >= SEMENTES * 5 * S.DIALETOS.length);
});

test('D8: a mesma fatura importada num formato e depois noutro não duplica', () => {
  for (let semente = 1; semente <= SEMENTES; semente++) {
    const hist = S.gerarHistorico(semente);
    const k = semente % hist.vencimentos.length;
    const venc = hist.vencimentos[k];
    const verdade = S.linhasDaFatura(hist, k);
    const a = S.DIALETOS[semente % S.DIALETOS.length];
    const b = S.DIALETOS[(semente * 7 + 3) % S.DIALETOS.length];
    const lidoA = F.lerArquivo(new Uint8Array(a.montar(verdade, venc).conteudo), 'a');
    const novos = F.aplicar(planejar(lidoA, venc), {
      transacoes: [],
      agora: AGORA,
      idBase: 'x',
    }).novos;
    const lidoB = F.lerArquivo(new Uint8Array(b.montar(verdade, venc).conteudo), 'b');
    const res = F.resumo(planejar(lidoB, venc, novos));
    assert.equal(
      res.qtdNovas,
      0,
      `semente ${semente}: ${a.nome} e depois ${b.nome} criou ${res.qtdNovas}`
    );
    reconcilia(res, `semente ${semente}: ${a.nome} → ${b.nome}`);
  }
});

test('o gerador cobre o que importa: parcelas, estornos, créditos, encargos e milhar', () => {
  // Sem isto, um gerador "bonzinho" deixaria o teste verde sem testar nada.
  const tipos = {};
  let parcelasAntigas = 0;
  let milhar = 0;
  for (let semente = 1; semente <= SEMENTES; semente++) {
    const hist = S.gerarHistorico(semente);
    for (let k = 0; k < hist.vencimentos.length; k++) {
      S.linhasDaFatura(hist, k).forEach((l) => {
        tipos[l.anulada ? l.tipo + '_anulada' : l.tipo] = true;
        if (l.n > 1) parcelasAntigas++;
        if (Math.abs(l.valor) >= 1000) milhar++;
      });
    }
  }
  for (const t of [
    'compra',
    'encargo',
    'compra_anulada',
    'estorno_anulada',
    'credito_fora',
    'pagamento',
  ]) {
    assert.ok(tipos[t], 'o gerador nunca produziu: ' + t);
  }
  assert.ok(parcelasAntigas > 20, 'poucas parcelas antigas: ' + parcelasAntigas);
  assert.ok(milhar > 10, 'poucos valores com milhar: ' + milhar);
});
