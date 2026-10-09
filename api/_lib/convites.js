'use strict';

// Cadastro por convite — fase de testes com usuários reais.
//
// Enquanto o interruptor `config/convites.obrigatorio` estiver ligado, uma
// conta NOVA só ganha registro de billing (e portanto acesso) em
// /api/billing/init se trouxer um código de convite válido. Quem resgata
// recebe o Pro vitalício que o admin já dá em "Tornar PRO"
// (courtesyPermanent) — sem trial e sem cobrança.
//
// Por que a trava fica no /init e não no login: criar o login (Google ou
// e-mail) acontece no navegador, direto no Firebase Auth, e barrar ali exige
// o plano pago. Mas sem o billing o servidor já bloqueia tudo (computeAccess
// → no_billing; sync, firestore.rules e bot recusam). Um login sem convite é
// um login vazio.
//
// Coleções (só o Admin SDK escreve; as regras do Firestore negam o cliente):
//   config/convites          { obrigatorio: bool, atualizadoEm, atualizadoPor }
//   convites/{codigo}        { status: livre|usado|cancelado, nota, criadoEm,
//                              criadoPor, usadoPor, usadoEmail, usadoEm, ... }
//
// Uso único: o resgate é transacional. O mesmo uid pode repetir o resgate do
// próprio código (o /init pode falhar no Asaas depois de marcar o convite e
// ser refeito); qualquer outro uid recebe `convite_usado`.

const crypto = require('node:crypto');

const COLECAO = 'convites';
const CONFIG_DOC = ['config', 'convites'];

// Sem 0/O, 1/I/L: o código é ditado por WhatsApp e digitado no celular.
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PREFIXO = 'BETA';
const RE_CODIGO = /^BETA-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;
const MAX_POR_VEZ = 50;
const MAX_NOTA = 120;

function bloco(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return s;
}

function gerarCodigo() {
  return `${PREFIXO}-${bloco(4)}-${bloco(4)}`;
}

/**
 * Aceita o código como a pessoa digitar: minúsculas, espaços, sem hífens,
 * com "O" no lugar de "0" não (o alfabeto não tem nenhum dos dois).
 * Devolve o formato canônico ou null.
 */
function normalizar(bruto) {
  const s = String(bruto || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (s.length !== 12 || !s.startsWith(PREFIXO)) return null;
  const c = `${PREFIXO}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  return RE_CODIGO.test(c) ? c : null;
}

function refConfig(D) {
  return D.collection(CONFIG_DOC[0]).doc(CONFIG_DOC[1]);
}

function refConvite(D, codigo) {
  return D.collection(COLECAO).doc(codigo);
}

async function modoObrigatorio(D) {
  const s = await refConfig(D).get();
  return !!(s.exists && s.data() && s.data().obrigatorio === true);
}

async function definirModo(D, obrigatorio, actor, ts) {
  await refConfig(D).set(
    { obrigatorio: !!obrigatorio, atualizadoEm: ts.now(), atualizadoPor: actor || 'admin' },
    { merge: true }
  );
  return !!obrigatorio;
}

/** Gera `quantidade` códigos livres. Colisão (40 bits) só por azar: tenta de novo. */
async function gerar(D, { quantidade, nota, actor }, ts) {
  const n = Math.max(1, Math.min(MAX_POR_VEZ, parseInt(quantidade, 10) || 1));
  const notaLimpa = String(nota || '')
    .trim()
    .slice(0, MAX_NOTA);
  const criados = [];
  for (let i = 0; i < n; i++) {
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const codigo = gerarCodigo();
      const ref = refConvite(D, codigo);
      const ok = await D.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (s.exists) return false;
        tx.set(ref, {
          codigo,
          status: 'livre',
          nota: notaLimpa || null,
          criadoEm: ts.now(),
          criadoPor: actor || 'admin',
        });
        return true;
      });
      if (ok) {
        criados.push(codigo);
        break;
      }
    }
  }
  return criados;
}

function msDe(t) {
  if (!t) return null;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t === 'number') return t;
  return null;
}

/** Todos os convites, mais novos primeiro (fase de testes: poucas dezenas). */
async function listar(D) {
  const snap = await D.collection(COLECAO).get();
  const itens = [];
  (snap.docs || []).forEach((d) => {
    const x = d.data() || {};
    itens.push({
      codigo: x.codigo || d.id,
      status: x.status || 'livre',
      nota: x.nota || null,
      criadoEm: msDe(x.criadoEm),
      usadoEmail: x.usadoEmail || null,
      usadoEm: msDe(x.usadoEm),
      canceladoEm: msDe(x.canceladoEm),
    });
  });
  itens.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
  return itens;
}

/** Cancela um convite ainda livre. Usado não se cancela: o acesso já foi dado. */
async function cancelar(D, codigoBruto, actor, ts) {
  const codigo = normalizar(codigoBruto);
  if (!codigo) return { ok: false, erro: 'convite_invalido' };
  const ref = refConvite(D, codigo);
  return D.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return { ok: false, erro: 'convite_inexistente' };
    const x = s.data() || {};
    if (x.status === 'usado') return { ok: false, erro: 'convite_ja_usado' };
    if (x.status === 'cancelado') return { ok: true, codigo };
    tx.set(
      ref,
      { status: 'cancelado', canceladoEm: ts.now(), canceladoPor: actor || 'admin' },
      { merge: true }
    );
    return { ok: true, codigo };
  });
}

/**
 * Lê o convite DENTRO de uma transação e diz se este uid pode usá-lo.
 * Separado de `marcarUsado` porque no Firestore todas as leituras de uma
 * transação vêm antes de qualquer escrita — o /init lê o billing e o convite
 * primeiro, decide, e só então escreve os dois.
 */
async function lerParaResgate(tx, D, codigo, uid) {
  const ref = refConvite(D, codigo);
  const s = await tx.get(ref);
  if (!s.exists) return { ok: false, erro: 'convite_invalido', ref };
  const x = s.data() || {};
  if (x.status === 'cancelado') return { ok: false, erro: 'convite_cancelado', ref };
  if (x.status === 'usado' && x.usadoPor !== uid) return { ok: false, erro: 'convite_usado', ref };
  return { ok: true, ref, jaEraDeste: x.status === 'usado' };
}

function marcarUsado(tx, leitura, { uid, email }, ts) {
  if (leitura.jaEraDeste) return;
  tx.set(
    leitura.ref,
    { status: 'usado', usadoPor: uid, usadoEmail: email || null, usadoEm: ts.now() },
    { merge: true }
  );
}

/** O que a cortesia de convite grava no billing (o mesmo "Tornar PRO" do admin). */
function camposCortesia(codigo, ts) {
  return {
    courtesyPermanent: true,
    courtesyGrantedAt: ts.now(),
    courtesyGrantedBy: `convite:${codigo}`,
    conviteCodigo: codigo,
  };
}

const MENSAGENS = {
  convite_obrigatorio:
    'O Appliquei está em fase de testes fechados. Para entrar, informe o código de convite que você recebeu.',
  convite_invalido: 'Código de convite não encontrado. Confira se digitou certo.',
  convite_usado: 'Este código de convite já foi usado por outra pessoa.',
  convite_cancelado: 'Este código de convite foi cancelado.',
  convite_com_assinatura:
    'Sua conta já tem uma assinatura ativa. Fale com o suporte para trocar pelo acesso de convite.',
};

module.exports = {
  ALFABETO,
  RE_CODIGO,
  MAX_POR_VEZ,
  MENSAGENS,
  gerarCodigo,
  normalizar,
  modoObrigatorio,
  definirModo,
  gerar,
  listar,
  cancelar,
  lerParaResgate,
  marcarUsado,
  camposCortesia,
  refConvite,
};
