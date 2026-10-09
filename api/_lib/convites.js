'use strict';

// Cadastro por convite — fase de testes com usuários reais.
//
// Enquanto o interruptor `config/convites.obrigatorio` estiver ligado, uma
// conta NOVA só ganha registro de billing (e portanto acesso) em
// /api/billing/init se trouxer um código de convite válido.
//
// O BENEFÍCIO DO TESTADOR (decisão do dono do produto):
//   · grátis desde já até 1 ano depois da DATA DE LANÇAMENTO (inclusive o
//     dia do aniversário) — a cortesia com prazo do admin (courtesyUntil);
//   · depois, 50% de desconto na mensalidade, para sempre
//     (recurringDiscountPercent, o mesmo campo do cupom do Applicash).
// A data de lançamento é editável no admin. Enquanto não houver data, a
// cortesia fica sem prazo (courtesyPermanent); ao definir ou mudar a data,
// `aplicarLancamento` recalcula o prazo de todos os testadores.
//
// Por que a trava fica no /init e não no login: criar o login (Google ou
// e-mail) acontece no navegador, direto no Firebase Auth, e barrar ali exige
// o plano pago. Mas sem o billing o servidor já bloqueia tudo (computeAccess
// → no_billing; sync, firestore.rules e bot recusam). Um login sem convite é
// um login vazio.
//
// Coleções (só o Admin SDK escreve; as regras do Firestore negam o cliente):
//   config/convites          { obrigatorio: bool, dataLancamento: 'aaaa-mm-dd',
//                              atualizadoEm, atualizadoPor }
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
const DESCONTO_TESTADOR = 50;
const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

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

/** 'aaaa-mm-dd' válida → a mesma string; qualquer outra coisa → null. */
function dataValida(str) {
  const m = RE_DATA.exec(String(str || '').trim());
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(a, me - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== me - 1 || dt.getUTCDate() !== d)
    return null;
  if (a < 2024 || a > 2100) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Fim do acesso grátis: 1 ano depois do lançamento, valendo o dia inteiro do
 * aniversário no horário de Brasília (UTC−3, sem horário de verão).
 * Lançamento 2026-12-01 → acesso até 01/12/2027 23:59:59 → 2027-12-02 03:00Z.
 * 29/02 cai em 01/03 no ano seguinte (Date.UTC normaliza).
 */
function fimCortesiaMs(dataLancamento) {
  const d = dataValida(dataLancamento);
  if (!d) return null;
  const [a, m, dia] = d.split('-').map(Number);
  return Date.UTC(a + 1, m - 1, dia + 1, 3, 0, 0);
}

/** Último dia grátis, como a pessoa lê: 'dd/mm/aaaa' no horário de Brasília. */
function ultimoDiaGratisTexto(dataLancamento) {
  const fim = fimCortesiaMs(dataLancamento);
  if (!fim) return null;
  const [a, m, d] = new Date(fim - 1 - 3 * 3600000).toISOString().slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

async function lerConfig(D) {
  const s = await refConfig(D).get();
  const x = (s.exists && s.data()) || {};
  return { obrigatorio: x.obrigatorio === true, dataLancamento: dataValida(x.dataLancamento) };
}

async function modoObrigatorio(D) {
  return (await lerConfig(D)).obrigatorio;
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

/**
 * O que o convite grava no billing de uma conta SEM cortesia de convite
 * ainda (conta nova ou conta que acabou de resgatar).
 *
 * Sem `fieldValue().delete()` de propósito: na conta nova o /init devolve
 * computeAccess(data) do próprio objeto, e um sentinela de delete ali seria
 * lido como valor.
 */
function camposCortesia(codigo, ts, dataLancamento) {
  const fim = fimCortesiaMs(dataLancamento);
  const out = {
    courtesyGrantedAt: ts.now(),
    courtesyGrantedBy: `convite:${codigo}`,
    conviteCodigo: codigo,
    conviteDescontoPercent: DESCONTO_TESTADOR,
    recurringDiscountPercent: DESCONTO_TESTADOR,
  };
  if (fim) out.courtesyUntil = ts.fromMillis(fim);
  else out.courtesyPermanent = true;
  return out;
}

/** A cortesia deste billing ainda é a do convite (o admin não mexeu nela)? */
function cortesiaEhDeConvite(b) {
  if (!b || !String(b.courtesyGrantedBy || '').startsWith('convite:')) return false;
  // Revogada pelo admin ("Revogar PRO" apaga os dois campos): não devolve.
  return b.courtesyPermanent === true || !!b.courtesyUntil;
}

/**
 * Define (ou limpa, com '') a data de lançamento e recalcula o prazo de
 * TODOS os testadores. Quem teve a cortesia trocada pelo admin depois
 * (Tornar PRO, Oferecer dias, Revogar) fica como o admin deixou.
 */
async function aplicarLancamento(D, dataBruta, actor, ts, fv) {
  const data = dataBruta ? dataValida(dataBruta) : null;
  if (dataBruta && !data) return { ok: false, erro: 'data_invalida' };
  await refConfig(D).set(
    { dataLancamento: data, atualizadoEm: ts.now(), atualizadoPor: actor || 'admin' },
    { merge: true }
  );
  const fim = fimCortesiaMs(data);
  const snap = await D.collection(COLECAO).get();
  let atualizados = 0;
  for (const d of snap.docs || []) {
    const x = d.data() || {};
    if (x.status !== 'usado' || !x.usadoPor) continue;
    const ref = D.collection('users').doc(x.usadoPor).collection('billing').doc('account');
    const mudou = await D.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const b = s.exists ? s.data() : null;
      if (!cortesiaEhDeConvite(b)) return false;
      tx.set(
        ref,
        fim
          ? { courtesyPermanent: fv.delete(), courtesyUntil: ts.fromMillis(fim) }
          : { courtesyPermanent: true, courtesyUntil: fv.delete() },
        { merge: true }
      );
      return true;
    });
    if (mudou) atualizados++;
  }
  return { ok: true, dataLancamento: data, fimCortesiaMs: fim, atualizados };
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
  DESCONTO_TESTADOR,
  dataValida,
  fimCortesiaMs,
  ultimoDiaGratisTexto,
  lerConfig,
  aplicarLancamento,
  cortesiaEhDeConvite,
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
