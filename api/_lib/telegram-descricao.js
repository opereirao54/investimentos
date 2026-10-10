'use strict';

// "✏️ Descrição" no bot: sugestões para corrigir a descrição de um lançamento,
// sem IA e sem custo de token.
//
// De onde vêm as sugestões, da mais forte para a mais fraca:
//   1. descrições que a PRÓPRIA pessoa já usou e que se parecem com a
//      digitada ("uber" → "Uber", "mc" → "McDonald's", "mercado" →
//      "Mercado Extra") — a pessoa reconhece o próprio vocabulário;
//   2. a digitada, só arrumada (maiúsculas, espaços): "padaria do ze" →
//      "Padaria do Ze";
//   3. as mais frequentes da mesma categoria, para completar.
// Nunca repete a descrição atual nem duas que só diferem em maiúsculas.
//
// A régua de semelhança é a mesma da sugestão de categoria do app
// (web/appliquei-insights.js), para as duas telas concordarem.

const I = require('../../web/appliquei-insights.js');

const MAX_SUGESTOES = 3;
const MAX_TAMANHO = 60;
const RE_PARCELA = /\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*$/;
const MINUSCULAS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'para',
  'pra',
  'com',
  'por',
  'a',
  'o',
]);

/** "(2/10)" é da parcela, não da descrição. */
function semParcela(s) {
  return String(s || '')
    .replace(RE_PARCELA, '')
    .trim();
}

/** Limpa o que a pessoa digitou: sem quebra de linha, sem espaço duplo, até 60. */
function limpar(s) {
  return String(s || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TAMANHO)
    .trim();
}

/**
 * Maiúscula no começo de cada palavra, menos preposições no meio. Palavra que
 * já tem maiúscula no meio (iFood, McDonald's) ou é sigla fica como está.
 */
function arrumar(s) {
  const palavras = limpar(s).split(' ');
  return palavras
    .map((p, i) => {
      if (!p) return p;
      const min = p.toLowerCase();
      if (i > 0 && MINUSCULAS.has(min)) return min;
      if (/[A-Z]/.test(p.slice(1)) || (p.length <= 4 && p === p.toUpperCase() && /[A-Z]/.test(p)))
        return p;
      return min.charAt(0).toUpperCase() + min.slice(1);
    })
    .join(' ');
}

/** Distância de edição (Levenshtein) — para erro de digitação: "ubr" ↔ "uber". */
function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = ant[0];
    ant[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = ant[j];
      ant[j] = Math.min(ant[j] + 1, ant[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return ant[b.length];
}

/**
 * Alguma palavra de uma "bate" com a outra? Começo igual ("mc" ↔
 * "mcdonalds", "farm" ↔ "farmacia") ou um erro de digitação ("ubr" ↔ "uber",
 * "mercdo" ↔ "mercado").
 */
function palavraBate(tokensA, tokensB) {
  return tokensA.some((a) =>
    tokensB.some((b) => {
      if (a.length < 2 || b.length < 2) return false;
      if (b.startsWith(a) || a.startsWith(b)) return true;
      const curta = Math.min(a.length, b.length);
      return curta >= 3 && distancia(a, b) <= (curta >= 6 ? 2 : 1);
    })
  );
}

/**
 * As descrições já usadas, agrupadas pela "identidade" (normalizada), com a
 * grafia mais usada de cada uma, quantas vezes e a categoria mais comum.
 */
function vocabulario(transacoes) {
  const grupos = new Map();
  (Array.isArray(transacoes) ? transacoes : []).forEach((t) => {
    if (!t || typeof t.descricao !== 'string') return;
    const exibir = limpar(semParcela(t.descricao));
    const chave = I.normalizarDescricao(exibir);
    if (!chave) return;
    let g = grupos.get(chave);
    if (!g) {
      g = { chave, grafias: new Map(), total: 0, cats: new Map(), tokens: I.tokens(exibir) };
      grupos.set(chave, g);
    }
    g.total++;
    g.grafias.set(exibir, (g.grafias.get(exibir) || 0) + 1);
    if (t.categoriaDespesa)
      g.cats.set(t.categoriaDespesa, (g.cats.get(t.categoriaDespesa) || 0) + 1);
  });
  const maisUsado = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  return [...grupos.values()].map((g) => ({
    chave: g.chave,
    texto: maisUsado(g.grafias)[0],
    total: g.total,
    categoria: g.cats.size ? maisUsado(g.cats)[0] : null,
    tokens: g.tokens,
  }));
}

/**
 * Até 3 sugestões de descrição.
 *
 * @param {string}   atual          descrição do lançamento agora
 * @param {object[]} transacoes     transações do usuário (como o app grava)
 * @param {string}   [categoria]    categoriaDespesa do lançamento
 * @returns {string[]}
 */
function sugerir(atual, transacoes, categoria) {
  const atualLimpa = limpar(semParcela(atual));
  const tokensAtual = I.tokens(atualLimpa);
  // Do histórico, uma variação só de maiúsculas da atual não acrescenta nada
  // ("UBER" para quem já tem "Uber"); a digitada ARRUMADA é a exceção — é
  // justamente a correção de maiúsculas que ela oferece.
  const vistos = new Set();
  const out = [];
  const pegar = (texto, soMaiusculasVale) => {
    const t = limpar(texto);
    if (!t || out.length >= MAX_SUGESTOES || t === atualLimpa) return;
    if (!soMaiusculasVale && t.toLowerCase() === atualLimpa.toLowerCase()) return;
    if (vistos.has(t.toLowerCase())) return;
    vistos.add(t.toLowerCase());
    out.push(t);
  };

  const voc = vocabulario(transacoes);

  // 1. Parecidas com a digitada, no vocabulário da pessoa.
  voc
    .map((v) => {
      const sim = I.similaridade(tokensAtual, v.tokens);
      const pref = palavraBate(tokensAtual, v.tokens) ? 0.5 : 0;
      return { v, nota: Math.max(sim, pref) * 10 + Math.log(1 + v.total) };
    })
    .filter((x) => x.nota >= 5)
    .sort((a, b) => b.nota - a.nota)
    .forEach((x) => pegar(x.v.texto));

  // 2. A própria digitada, arrumada.
  pegar(arrumar(atualLimpa), true);

  // 3. As mais usadas da mesma categoria.
  if (categoria) {
    voc
      .filter((v) => v.categoria === categoria)
      .sort((a, b) => b.total - a.total)
      .forEach((v) => pegar(v.texto));
  }
  return out;
}

/** Chave do "da próxima vez, troque X por Y" (só letras e números). */
function chaveApelido(descricao) {
  return I.normalizarDescricao(semParcela(descricao));
}

module.exports = { sugerir, limpar, arrumar, semParcela, chaveApelido, MAX_TAMANHO };
