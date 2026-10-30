'use strict';

/**
 * Importar fatura: ARQUIVO ESTRAGADO.
 *
 * O usuário vai mandar de tudo: arquivo cortado no download, aberto e salvo
 * no Excel, de outro banco, com linhas apagadas, com lixo no meio, outro
 * arquivo qualquer. Este teste pega faturas sintéticas válidas, estraga de
 * propósito (cortar, apagar e duplicar linhas, trocar bytes por lixo, tirar o
 * cabeçalho, trocar o separador, misturar formatos) e exige:
 *
 *   R1  nunca uma exceção sem código: ou lê, ou recusa com mensagem clara
 *       (MENSAGENS);
 *   R2  o que foi lido passa por planejar, resumo e aplicar sem quebrar;
 *   R3  nenhum lançamento criado tem valor inválido, zero ou negativo, nem
 *       vencimento ou competência inválidos;
 *   R4  linha com valor ilegível vira "erro" e não entra.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const F = require('../web/appliquei-importar-fatura.js');
const S = require('./_faturas-sinteticas.js');

const SEMENTES = Number(process.env.SEMENTES_ROBUSTEZ) || 400;
const CODIGOS = new Set(Object.keys(F.MENSAGENS));

function estragar(buf, g) {
  let b = Buffer.from(buf);
  const vezes = g.int(1, 3);
  const feitos = [];
  for (let i = 0; i < vezes; i++) {
    const tipo = g.int(0, 8);
    const linhas = () => b.toString('latin1').split(/\r?\n/);
    const juntar = (ls) => Buffer.from(ls.join('\n'), 'latin1');
    if (tipo === 0 && b.length > 2) {
      b = b.subarray(0, g.int(1, b.length - 1));
      feitos.push('cortado');
    } else if (tipo === 1) {
      const ls = linhas();
      ls.splice(g.int(0, ls.length - 1), 1);
      b = juntar(ls);
      feitos.push('linha apagada');
    } else if (tipo === 2) {
      const ls = linhas();
      const k = g.int(0, ls.length - 1);
      ls.splice(k, 0, ls[k]);
      b = juntar(ls);
      feitos.push('linha duplicada');
    } else if (tipo === 3 && b.length) {
      b = Buffer.from(b);
      for (let j = 0; j < g.int(1, 20); j++) b[g.int(0, b.length - 1)] = g.int(0, 255);
      feitos.push('bytes trocados');
    } else if (tipo === 4) {
      const ls = linhas();
      ls.splice(
        g.int(0, ls.length),
        0,
        g.um(['lixo;;;', '<<<>>>', '"aspas sem fim', ',,,,', '2026-13-45,X,abc', '\u0000\u0001'])
      );
      b = juntar(ls);
      feitos.push('linha de lixo');
    } else if (tipo === 5) {
      b = juntar(linhas().slice(1));
      feitos.push('sem cabeçalho');
    } else if (tipo === 6) {
      b = Buffer.from(b.toString('latin1').replace(/,/g, ';'), 'latin1');
      feitos.push('vírgula → ponto e vírgula');
    } else if (tipo === 7) {
      b = Buffer.from(b.toString('latin1').replace(/<\/?STMTTRN>/g, ''), 'latin1');
      feitos.push('OFX sem STMTTRN');
    } else {
      b = Buffer.concat([b, Buffer.from('\n%PDF-1.4 lixo binário ÿþ')]);
      feitos.push('lixo no fim');
    }
  }
  return { buf: b, feitos };
}

test(`robustez: ${SEMENTES} arquivos estragados nunca quebram o app`, () => {
  let lidos = 0;
  let recusados = 0;
  for (let semente = 1; semente <= SEMENTES; semente++) {
    const g = S.gerador(semente * 31 + 7);
    const hist = S.gerarHistorico(semente);
    const k = g.int(0, hist.vencimentos.length - 1);
    const venc = hist.vencimentos[k];
    const d = g.um(S.DIALETOS);
    const { conteudo, arquivo } = d.montar(S.linhasDaFatura(hist, k), venc);
    const { buf, feitos } = estragar(conteudo, g);
    const ctx = `semente ${semente}, ${d.nome}, ${feitos.join(' + ')}`;

    let lido;
    try {
      lido = F.lerArquivo(new Uint8Array(buf), arquivo);
    } catch (e) {
      // R1
      assert.ok(e.codigo && CODIGOS.has(e.codigo), `${ctx}: exceção sem código — ${e.stack}`);
      recusados++;
      continue;
    }
    lidos++;
    // R2
    let plano;
    let r;
    try {
      plano = F.planejar({
        arquivo: lido,
        vencimento: venc,
        cartaoId: 'c',
        transacoes: [],
        categorias: [],
      });
      F.resumo(plano);
      r = F.aplicar(plano, { transacoes: [], agora: new Date(2026, 9, 27), idBase: 'r' + semente });
    } catch (e) {
      assert.fail(`${ctx}: quebrou depois de ler — ${e.stack}`);
    }
    // R4
    plano.itens.forEach((it) => {
      if (!Number.isFinite(lido.linhas[plano.itens.indexOf(it)].valor))
        assert.equal(it.status, 'erro', ctx);
    });
    // R3
    r.novos.forEach((t) => {
      assert.ok(Number.isFinite(t.valor) && t.valor > 0, `${ctx}: valor ${t.valor}`);
      assert.match(t.dataVencimento, /^\d{4}-\d{2}-\d{2}$/, ctx);
      assert.ok(t.dataVencimento >= venc, ctx);
      assert.ok(t.mes >= 0 && t.mes <= 11 && t.ano >= 2000, ctx);
      if (t.dataCompra !== undefined) assert.match(t.dataCompra, /^\d{4}-\d{2}-\d{2}$/, ctx);
    });
  }
  // Sanidade: a maioria dos estragos ainda é legível, e alguns são recusados.
  assert.ok(lidos > SEMENTES / 4, `só ${lidos} lidos`);
  assert.ok(recusados > 0, 'nenhum recusado: o estrago não está estragando');
});

test('robustez: arquivos que não são fatura são recusados com mensagem', () => {
  const casos = [
    ['', 'vazio'],
    ['﻿', 'vazio'],
    ['%PDF-1.7\n...', 'pdf'],
    ['<html><body>Fatura</body></html>', 'formato'],
    ['{"date":"2026-10-01","amount":10}', 'formato'],
    ['nome;cpf;email\nAna;123;a@b.c\n', 'formato'],
    ['OFXHEADER:100\n<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>', 'extrato_conta'],
    ['OFXHEADER:100\n<OFX></OFX>', 'formato'],
    ['date,title,amount\n2026-10-01,Loja,0\n', 'vazio'],
  ];
  for (const [texto, codigo] of casos) {
    let erro = null;
    try {
      F.lerArquivo(texto, 'x');
    } catch (e) {
      erro = e.codigo;
    }
    assert.equal(erro, codigo, JSON.stringify(texto.slice(0, 30)));
  }
});
