#!/usr/bin/env node
'use strict';

/**
 * Caça intensiva de furos na IMPORTAÇÃO DE FATURA.
 *
 * Roda muitas sequências aleatórias de uso real (Telegram com valor
 * arredondado, importar meses fora de ordem, em 12 formatos de arquivo,
 * reimportar, desfazer, pagar) e valida IMP01–IMP07 depois de cada ação.
 * O CI roda sementes fixas (test/simulacao-importacao.test.js); aqui dá para
 * subir à vontade.
 *
 * Uso:
 *   node scripts/cacar-importacao.js                 # 2000 sementes × 30 passos
 *   node scripts/cacar-importacao.js 20000 40        # mais fundo
 *   node scripts/cacar-importacao.js --semente 77 30 # uma semente só
 *   node scripts/cacar-importacao.js 500 30 --inicio 1000
 *
 * Toda falha imprime a semente e a sequência exata. Depois de corrigir, some a
 * semente a ACHADAS em test/simulacao-importacao.test.js e escreva a trava.
 */

const { rodarSequenciaImportacao } = require('../test/_sequencias-importacao.js');

function main() {
  const args = process.argv.slice(2);
  const flag = (nome) => {
    const i = args.indexOf(nome);
    if (i === -1) return null;
    const v = parseInt(args[i + 1], 10);
    args.splice(i, 2);
    return v;
  };
  const unica = flag('--semente');
  const inicio = flag('--inicio');
  const pos = args.map((a) => parseInt(a, 10)).filter((n) => !isNaN(n));
  let de;
  let ate;
  let passos;
  if (unica != null) {
    de = ate = unica;
    passos = pos[0] || 30;
  } else {
    de = inicio || 1;
    ate = de + (pos[0] || 2000) - 1;
    passos = pos[1] || 30;
  }
  const t0 = Date.now();
  process.stdout.write(
    `Caçando furos na importação de fatura: sementes ${de}–${ate} (${ate - de + 1}), ${passos} passos cada.\n\n`
  );
  let falhas = 0;
  let acoes = 0;
  const vistas = new Set();
  for (let s = de; s <= ate; s++) {
    const r = rodarSequenciaImportacao(s, passos);
    acoes += r.ok ? passos : r.passo;
    if (r.ok) {
      if (unica != null) process.stdout.write(r.log.join('\n') + '\n');
      continue;
    }
    falhas++;
    const assinatura = r.erro.split('\n')[0].replace(/\d+(\.\d+)?/g, 'N');
    if (vistas.has(assinatura) && unica == null) continue;
    vistas.add(assinatura);
    process.stdout.write(
      `✗ semente ${s}, passo ${r.passo} (${r.acao})\n${r.erro}\n\nSequência:\n${r.log.join('\n')}\n\n` +
        `Reproduzir: node scripts/cacar-importacao.js --semente ${s} ${passos}\n\n`
    );
  }
  const seg = ((Date.now() - t0) / 1000).toFixed(1);
  const total = ate - de + 1;
  if (falhas) {
    process.stdout.write(`${falhas}/${total} sequências com furo · ${acoes} ações · ${seg}s\n`);
    process.exit(1);
  }
  process.stdout.write(
    `${total}/${total} sequências limpas · ${acoes} ações validadas · ${seg}s\n`
  );
}

main();
