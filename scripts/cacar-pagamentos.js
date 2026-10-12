#!/usr/bin/env node
'use strict';

/**
 * Caça intensiva de furos em PAGAMENTOS e CUPONS (Applicash e convite).
 *
 * Roda muitas sequências aleatórias contra os handlers reais de billing
 * (/init, /subscribe, /webhook, /cancel, /me, admin) num Asaas simulado fiel,
 * validando os invariantes de dinheiro e de cupom entre cada passo. O CI roda
 * sementes fixas (test/simulacao-pagamentos.test.js); aqui dá para subir à
 * vontade.
 *
 * Uso:
 *   node scripts/cacar-pagamentos.js                 # 300 sementes × 30 passos
 *   node scripts/cacar-pagamentos.js 2000 40         # mais fundo
 *   node scripts/cacar-pagamentos.js --semente 77 40 # uma semente só
 *   node scripts/cacar-pagamentos.js 500 30 --inicio 1000
 *
 * Toda falha imprime a semente e a sequência exata. Depois de corrigir, some a
 * semente a ACHADAS em test/simulacao-pagamentos.test.js.
 */

const { rodarSequenciaPagamentos } = require('../test/_sequencias-pagamentos.js');
const { restaurarRelogio } = require('../test/_simulador-pagamentos.js');

async function main() {
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
    ate = de + (pos[0] || 300) - 1;
    passos = pos[1] || 30;
  }
  const total = ate - de + 1;
  const relogio = Date.now.bind(Date);
  const inicioMs = relogio();
  process.stdout.write(
    `Caçando furos em pagamentos e cupons: sementes ${de}–${ate} (${total}), ${passos} passos cada.\n\n`
  );

  let falhas = 0;
  let acoes = 0;
  const assinaturas = new Map();
  for (let semente = de; semente <= ate; semente++) {
    const r = await rodarSequenciaPagamentos(semente, passos);
    acoes += r.trilha.length;
    if (r.falhou) {
      falhas++;
      // Agrupa pelo tipo de violação para não afogar a saída em repetidas.
      const tipo = (r.mensagem.match(/Violações:\n\s+- (?:\[[^\]]+\] )?(\S+)/) || [])[1] || '?';
      const n = (assinaturas.get(tipo) || 0) + 1;
      assinaturas.set(tipo, n);
      if (n <= 3) process.stdout.write(`\n${'='.repeat(72)}\nSEMENTE ${semente}\n${r.mensagem}\n`);
    }
    if ((semente - de + 1) % 100 === 0) {
      process.stdout.write(`  ... ${semente - de + 1}/${total} sequências\n`);
    }
  }
  restaurarRelogio();

  const seg = ((relogio() - inicioMs) / 1000).toFixed(1);
  process.stdout.write(
    `\n${'-'.repeat(72)}\n` +
      `${total - falhas}/${total} sequências limpas · ${acoes} ações validadas · ${seg}s\n`
  );
  if (falhas) {
    process.stdout.write('\nFalhas por tipo (até 3 exemplos de cada impressos acima):\n');
    for (const [t, n] of assinaturas) process.stdout.write(`  ${t}: ${n}\n`);
  }
  process.exit(falhas ? 1 : 0);
}

if (require.main === module) main();
