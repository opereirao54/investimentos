// Cópia para o navegador de api/_lib/sentry-scrub.js — mesmo conteúdo, em
// módulo ES. Mudou um, mude o outro: test/sentry-scrub.test.js roda os mesmos
// casos nas duas cópias.

// Limpeza de dados pessoais nos eventos do Sentry, antes de saírem daqui.
//
// `sendDefaultPii: false` só impede o SDK de anexar por conta própria o IP, os
// cookies e o corpo das requisições. O que o NOSSO código põe no evento passa
// direto: a mensagem de um erro que interpolou o e-mail do usuário, o `extra`
// de um captureError com o customer do Asaas, um console.log com o valor de
// um lançamento que virou breadcrumb. A Política de Privacidade promete
// "registro de erros técnicos, sem dados pessoais" — esta é a trava que
// sustenta a promessa.
//
// Duas cópias com o mesmo conteúdo: esta (CommonJS, servidor) e
// web/appliquei-sentry-scrub.js (módulo ES, navegador). O teste
// test/sentry-scrub.test.js roda os mesmos casos nas duas.

const CHAVES_SENSIVEIS =
  /^(e-?mail|cpf|cnpj|cpfcnpj|cpf_cnpj|documento|phone|telefone|celular|mobilephone|cardnumber|card_number|numero(cartao)?|ccv|cvv|holdername|nome|endereco|address|postalcode|cep|token|idtoken|authorization|senha|password|valor|saldo|amount)$/i;

const PADROES = [
  // Token de sessão (Bearer ...) e JWT soltos.
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [token]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[token]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // CNPJ antes de CPF: o CPF casaria um pedaço do CNPJ.
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]'],
  // Cartão: 15 a 19 dígitos, com ou sem espaço/hífen. Começa em 15 para não
  // apagar timestamps em milissegundos (13 dígitos), comuns nas mensagens.
  [/\b(?:\d[ -]?){14,18}\d\b/g, '[cartao]'],
  [/R\$\s?-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?/g, 'R$ [valor]'],
];

export function limparTexto(s) {
  if (typeof s !== 'string' || !s) return s;
  let out = s;
  for (const [re, troca] of PADROES) out = out.replace(re, troca);
  return out;
}

// Percorre objetos livres (extra, breadcrumb.data, request): campo com nome
// sensível vira "[removido]"; texto passa pela limpeza. Profundidade limitada
// para não travar num objeto circular ou gigante.
function limparValor(v, prof) {
  if (typeof v === 'string') return limparTexto(v);
  if (!v || typeof v !== 'object') return v;
  if (prof > 6) return '[profundo]';
  if (Array.isArray(v)) return v.map((x) => limparValor(x, prof + 1));
  const out = {};
  for (const k of Object.keys(v)) {
    out[k] = CHAVES_SENSIVEIS.test(k) ? '[removido]' : limparValor(v[k], prof + 1);
  }
  return out;
}

/** Devolve o evento sem e-mail, CPF/CNPJ, cartão, valores em R$ e tokens. */
export function limparEventoSentry(event) {
  if (!event || typeof event !== 'object') return event;
  try {
    if (event.message) event.message = limparTexto(event.message);
    if (event.logentry && event.logentry.message)
      event.logentry.message = limparTexto(event.logentry.message);
    const exc = event.exception && event.exception.values;
    if (Array.isArray(exc)) exc.forEach((e) => e && (e.value = limparTexto(e.value)));
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs.forEach((b) => {
        if (!b) return;
        if (b.message) b.message = limparTexto(b.message);
        if (b.data) b.data = limparValor(b.data, 0);
      });
    }
    if (event.extra) event.extra = limparValor(event.extra, 0);
    if (event.request) event.request = limparValor(event.request, 0);
    // O SDK pode preencher user com id/IP; fica só o id (uid), que não
    // identifica ninguém fora do sistema.
    if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  } catch (_) {
    // A limpeza nunca derruba o relato do erro.
  }
  return event;
}
