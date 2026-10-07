'use strict';

// IA de reserva do bot do Telegram — Gemini, no plano gratuito.
//
// Só entra quando as regras (telegram-parser.js) não dão conta, e mesmo assim
// NÃO decide nada sozinha:
//   reescrever(texto) → devolve a frase no formato que o parser entende
//                       ("gastei uns cinquenta conto no mercado" → "mercado 50");
//                       o parser é quem lê valor, conta e cartão dessa frase.
//   categorizar(desc) → escolhe UM slug da lista de categorias do usuário; o
//                       webhook confere se o slug existe antes de usar.
// Assim um erro da IA nunca inventa um campo que a regra não validaria.
//
// Privacidade: vai só o texto da mensagem (ou a descrição) e os nomes das
// categorias. Nunca uid, nome, e-mail, contas ou saldos. No plano gratuito o
// Google pode usar o conteúdo para melhorar os produtos dele — isso precisa
// constar na Política de Privacidade (ver docs/TELEGRAM.md).
//
// Desligada quando GEMINI_API_KEY não existe. Qualquer falha (cota, rede,
// timeout) devolve null e o bot cai na dica de formato: nunca vira custo nem
// trava o webhook.

const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 5000;

function modelo() {
  // Alias "-latest" acompanha o Flash-Lite vigente sem trocar código quando o
  // Google aposenta uma versão. Pode ser fixado por variável de ambiente.
  return process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
}

async function gerar(prompt) {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${URL_BASE}/${modelo()}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 256 },
      }),
      signal: ctl.signal,
    });
    if (!r.ok) {
      console.warn('[telegram-ia] HTTP', r.status);
      return null;
    }
    const j = await r.json();
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const texto = parts
      .map((p) => p.text || '')
      .join('')
      .trim();
    return texto || null;
  } catch (e) {
    console.warn('[telegram-ia] falhou', e && e.name);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function limparLinha(s) {
  return String(s || '')
    .split('\n')[0]
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .slice(0, 200);
}

async function reescrever(texto) {
  const prompt =
    'Você converte mensagens de gastos e ganhos em português para um formato fixo.\n' +
    'Formato: [+ se for dinheiro recebido] descrição curta valor [Nx se parcelado] ' +
    '[ontem | dd/mm se a data foi dita] [nome do cartão ou banco, se dito] [pix | cartão, se dito]\n' +
    'Valor em número com vírgula decimal (ex.: 52,90). Escreva números por extenso como dígitos.\n' +
    'Exemplos:\n' +
    '"gastei uns cinquenta conto no mercado ontem" → mercado 50 ontem\n' +
    '"caiu meu salário de três mil e quinhentos" → +3500 salário\n' +
    '"comprei um tênis de trezentos em três vezes no nubank" → tênis 300 3x nubank\n' +
    'Se não houver um valor claro, responda exatamente: NADA\n' +
    'Responda só a linha, sem explicação.\n\n' +
    `Mensagem: "${String(texto).slice(0, 300).replace(/"/g, "'")}"`;
  const saida = limparLinha(await gerar(prompt));
  if (!saida || /^nada$/i.test(saida)) return null;
  return saida;
}

async function categorizar(descricao, categorias) {
  const lista = (categorias || []).map(
    (c) => `${c.v} = ${String(c.label).replace(/^[^\p{L}]+/u, '')}`
  );
  if (!lista.length) return null;
  const prompt =
    'Classifique o gasto em UMA categoria. Responda só o código da esquerda, ' +
    'ou NADA se nenhuma servir.\n' +
    lista.join('\n') +
    `\n\nGasto: "${String(descricao).slice(0, 80).replace(/"/g, "'")}"`;
  const saida = limparLinha(await gerar(prompt)).toLowerCase();
  if (!saida || saida === 'nada') return null;
  return saida.replace(/[^a-z0-9_]/g, '') || null;
}

module.exports = { reescrever, categorizar, modelo };
