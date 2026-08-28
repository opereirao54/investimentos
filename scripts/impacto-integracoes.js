#!/usr/bin/env node
'use strict';

/**
 * Análise de impacto: dado um conjunto de arquivos alterados (ou o diff atual),
 * diz QUAIS contratos de integração entram em risco e QUAIS testes provam cada um.
 *
 * Consome .claude/integracoes/mapa.json — a mesma fonte dos testes e da skill.
 *
 * Uso:
 *   node scripts/impacto-integracoes.js                 # usa o diff atual (working tree + HEAD)
 *   node scripts/impacto-integracoes.js web/x.js ...    # arquivos explícitos
 *   node scripts/impacto-integracoes.js --json          # saída legível por máquina
 *   node scripts/impacto-integracoes.js --testes        # só a linha de comando dos testes
 *   node scripts/impacto-integracoes.js --silencioso    # nada na saída quando não há risco
 *
 * Silêncio é a regra: arquivo sem contrato declarado, ou alteração que não toca
 * nenhum símbolo crítico, sai com código 0 e sem imprimir nada. É o que permite
 * ligar isto num hook sem virar ruído em mudança de CSS ou de texto.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const MAPA = JSON.parse(
  fs.readFileSync(path.join(ROOT, '.claude', 'integracoes', 'mapa.json'), 'utf8')
);

const ORDEM_GRAVIDADE = { critica: 0, alta: 1, media: 2 };

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  } catch {
    return '';
  }
}

/** Arquivos alterados: working tree + staged + o último commit se ambos vazios. */
function arquivosDoDiff() {
  const set = new Set();
  for (const cmd of [
    ['diff', '--name-only'],
    ['diff', '--name-only', '--cached'],
  ]) {
    for (const l of git(cmd).split('\n')) if (l.trim()) set.add(l.trim());
  }
  if (!set.size) {
    for (const l of git(['diff', '--name-only', 'HEAD~1', 'HEAD']).split('\n')) {
      if (l.trim()) set.add(l.trim());
    }
  }
  return [...set];
}

/** Texto adicionado/removido no diff de um arquivo — para casar símbolos. */
function trechoAlterado(arquivo) {
  const partes = [
    git(['diff', '--unified=0', '--', arquivo]),
    git(['diff', '--unified=0', '--cached', '--', arquivo]),
  ].join('\n');
  if (partes.trim()) return partes;
  return git(['diff', '--unified=0', 'HEAD~1', 'HEAD', '--', arquivo]);
}

/**
 * Cruza arquivos alterados com o mapa.
 * @returns {{invariantes: Array, entidades: Set<string>, cadeias: Array}}
 */
function analisar(arquivos, opcoes) {
  opcoes = opcoes || {};
  const emRisco = [];

  for (const inv of MAPA.invariantes) {
    const tocados = (inv.arquivos || []).filter((a) => arquivos.includes(a));
    if (!tocados.length) continue;

    // Filtro fino: se conseguimos ler o diff, só reporta quando um símbolo
    // crítico aparece nele. Sem diff legível (ex.: arquivo novo, ou chamada com
    // caminhos explícitos), reporta pelo arquivo — errar para o lado do aviso.
    let simbolos = [];
    let temDiff = false;
    if (!opcoes.semFiltroFino) {
      for (const a of tocados) {
        const d = trechoAlterado(a);
        if (!d.trim()) continue;
        temDiff = true;
        for (const sim of inv.simbolos || []) {
          if (d.includes(sim) && !simbolos.includes(sim)) simbolos.push(sim);
        }
      }
    }
    if (temDiff && !simbolos.length) continue;

    emRisco.push({
      id: inv.id,
      titulo: inv.titulo,
      gravidade: inv.gravidade,
      sintoma: inv.sintoma,
      arquivos: tocados,
      simbolos,
      cadeia: inv.cadeia || null,
      prova: inv.prova,
      status: inv.status,
    });
  }

  emRisco.sort((a, b) => (ORDEM_GRAVIDADE[a.gravidade] ?? 9) - (ORDEM_GRAVIDADE[b.gravidade] ?? 9));

  // Cadeia só entra se for realmente atravessada. INV-01 participa de quase
  // tudo — bastasse ela, toda alteração mostraria as três cadeias e o aviso
  // viraria papel de parede. Critério: alguma invariante em risco declara esta
  // cadeia como a SUA, ou pelo menos duas das invariantes da cadeia caíram.
  const idsRisco = new Set(emRisco.map((r) => r.id));
  const cadeias = (MAPA.cadeiasDeEfeito || []).filter((c) => {
    if (emRisco.some((r) => r.cadeia === c.id)) return true;
    const env = c.invariantesEnvolvidas || [];
    return env.filter((i) => idsRisco.has(i)).length >= 2;
  });

  return { emRisco, cadeias };
}

function provasDe(emRisco) {
  return [...new Set(emRisco.map((r) => r.prova).filter(Boolean))].filter((p) =>
    fs.existsSync(path.join(ROOT, p))
  );
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const soTestes = args.includes('--testes');
  const silencioso = args.includes('--silencioso');
  const explicitos = args.filter((a) => !a.startsWith('--'));

  const arquivos = explicitos.length ? explicitos : arquivosDoDiff();
  const { emRisco, cadeias } = analisar(arquivos, { semFiltroFino: explicitos.length > 0 });
  const provas = provasDe(emRisco);

  if (json) {
    process.stdout.write(JSON.stringify({ arquivos, emRisco, cadeias, provas }, null, 2) + '\n');
    return;
  }
  if (soTestes) {
    if (provas.length) process.stdout.write(`node --test ${provas.join(' ')}\n`);
    return;
  }
  if (!emRisco.length) {
    if (!silencioso) process.stdout.write('Nenhum contrato de integração em risco.\n');
    return;
  }

  const L = [];
  L.push('');
  L.push('┌─ CONTRATOS DE INTEGRAÇÃO EM RISCO ' + '─'.repeat(38));
  L.push('│');
  for (const r of emRisco) {
    const marca = r.gravidade === 'critica' ? '!!' : r.gravidade === 'alta' ? ' !' : '  ';
    L.push(`│ ${marca} ${r.id} — ${r.titulo}`);
    if (r.simbolos.length) L.push(`│      tocou: ${r.simbolos.join(', ')}`);
    L.push(`│      quebra assim: ${r.sintoma}`);
    if (r.cadeia) {
      const c = (MAPA.cadeiasDeEfeito || []).find((x) => x.id === r.cadeia);
      if (c) L.push(`│      cadeia: ${c.id} — ${c.titulo}`);
    }
    L.push('│');
  }
  if (cadeias.length) {
    L.push('├─ CADEIAS ATRAVESSADAS ' + '─'.repeat(50));
    L.push('│');
    for (const c of cadeias) {
      L.push(`│ ${c.id} — ${c.titulo}`);
      (c.passos || []).forEach((p, i) => L.push(`│   ${i + 1}. ${p}`));
      L.push('│');
    }
  }
  L.push('└' + '─'.repeat(72));
  L.push('');
  if (provas.length) {
    L.push('Prove antes de seguir:');
    L.push(`  node --test ${provas.join(' ')}`);
    L.push('');
  }
  process.stdout.write(L.join('\n'));
}

if (require.main === module) main();

module.exports = { analisar, provasDe, arquivosDoDiff, MAPA };
