#!/usr/bin/env node
'use strict';

/**
 * Caça intensiva de defeitos de interação.
 *
 * Roda muitas sequências aleatórias de ações contra um mundo completo,
 * validando todas as invariantes entre cada passo. O CI roda 40 sementes de 12
 * passos (test/simulacao-sequencias.test.js); aqui dá para subir à vontade,
 * porque leva minutos.
 *
 * Uso:
 *   node scripts/cacar-interacoes.js                    # 300 sementes × 25 passos
 *   node scripts/cacar-interacoes.js 1000 40            # mais fundo
 *   node scripts/cacar-interacoes.js --de 500 --ate 600 # faixa específica
 *
 * Toda falha imprime a sequência exata e a semente — cole-a como caso fixo em
 * test/simulacao-sequencias.test.js depois de corrigir, para virar trava.
 */

const { rodarSequencia } = require('../test/_sequencias.js');

function main() {
  const args = process.argv.slice(2);
  const num = (flag, padrao) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? parseInt(args[i + 1], 10) : padrao;
  };
  const posicionais = args.filter((a) => !a.startsWith('--') && !isNaN(parseInt(a, 10)));
  const de = num('--de', 1);
  const ate = num('--ate', de + (parseInt(posicionais[0], 10) || 300) - 1);
  const passos = parseInt(posicionais[1], 10) || num('--passos', 25);

  const total = ate - de + 1;
  process.stdout.write(
    `Caçando interações: sementes ${de}–${ate} (${total}), ${passos} passos cada.\n\n`
  );

  let falhas = 0;
  let acoes = 0;
  const inicio = Date.now();

  for (let semente = de; semente <= ate; semente++) {
    const r = rodarSequencia(semente, passos);
    if (r.falhou) {
      falhas++;
      process.stdout.write(`\n${'='.repeat(72)}\nSEMENTE ${semente}\n${r.mensagem}\n`);
    } else {
      acoes += r.trilha.length;
    }
    if ((semente - de + 1) % 50 === 0) {
      process.stdout.write(`  ... ${semente - de + 1}/${total} sequências\n`);
    }
  }

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  process.stdout.write(
    `\n${'-'.repeat(72)}\n` +
      `${total - falhas}/${total} sequências limpas · ${acoes} ações executadas e validadas · ${seg}s\n`
  );
  if (falhas) {
    process.stdout.write(
      `\n${falhas} sequência(s) falharam. Depois de corrigir, some a semente à lista fixa de\n` +
        `test/simulacao-sequencias.test.js para o caso virar trava permanente.\n`
    );
  }
  process.exit(falhas ? 1 : 0);
}

if (require.main === module) main();
