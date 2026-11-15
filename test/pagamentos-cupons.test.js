'use strict';

/**
 * Cupons promocionais (api/_lib/cupons.js) — campanha com código, com e sem
 * prazo.
 *
 * As perguntas que estes testes respondem são as do usuário e as do caixa:
 *   · "o cupom venceu ontem, ainda entra?"            → prazo de resgate
 *   · "50% por 3 meses: e no 4º?"                     → duração do benefício
 *   · "já assino — o desconto chega na minha fatura?" → faturas já projetadas
 *   · "usei duas vezes / em duas abas"                → uma vez por conta
 *   · "ganhei dias grátis — perdi o resto do teste?"  → soma, nunca reinicia
 *
 * Roda no mundo fiel ao Asaas (faturas projetadas, cartão que captura na
 * hora, updatePayment rigoroso). Ver .claude/skills/pagamentos/SKILL.md.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const S = require('./_simulador-pagamentos.js');

const DIA = S.DIA;
// 2026-11-15 12:00 em Brasília — relógio fixo para os testes de prazo.
const AGORA = Date.UTC(2026, 10, 15, 15, 0, 0);

function valores(uid, status) {
  return S.cobrancas(uid)
    .filter((p) => !status || p.status === status)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .map((p) => Math.round(p.value * 100));
}

async function criar(cupom) {
  const r = await S.criarCupom(cupom);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r;
}

// ─── Definição (admin) ──────────────────────────────────────────────────────

test('admin: cria, lista e recusa definição inválida', async () => {
  S.criarMundoPagamentos({ agora: AGORA });
  const r = await criar({
    codigo: 'lancamento-50',
    tipo: 'desconto',
    percent: 50,
    ciclos: 3,
    validoAte: '2026-12-31',
    maxResgates: 100,
    nota: 'Campanha de lançamento',
  });
  const c = r.body.itens[0];
  assert.equal(c.codigo, 'LANCAMENTO50', 'código normalizado');
  assert.equal(c.beneficio, '50% de desconto nas 3 primeiras mensalidades');
  assert.equal(c.situacao, 'ativo');
  assert.equal(c.publico, 'novos', 'padrão: só primeira assinatura');

  const recusa = async (cupom, erro) => {
    const x = await S.criarCupom(cupom);
    assert.equal(x.status, 400, JSON.stringify(cupom));
    assert.equal(x.body.error, erro);
  };
  await recusa({ codigo: 'LANCAMENTO50', tipo: 'desconto', percent: 10 }, 'codigo_ja_existe');
  await recusa({ codigo: 'AB', tipo: 'desconto', percent: 10 }, 'codigo_invalido');
  await recusa({ codigo: 'APP-ABC123', tipo: 'desconto', percent: 10 }, 'codigo_reservado');
  await recusa({ codigo: 'ZERO', tipo: 'desconto', percent: 0 }, 'percent_invalido');
  // 70% de R$ 15 = R$ 4,50, abaixo do piso de R$ 5 do gateway.
  await recusa({ codigo: 'SETENTA', tipo: 'desconto', percent: 70 }, 'percent_acima_do_piso');
  await recusa({ codigo: 'CICLOS', tipo: 'desconto', percent: 10, ciclos: 0 }, 'ciclos_invalido');
  await recusa({ codigo: 'DIAS', tipo: 'dias_gratis', dias: 0 }, 'dias_invalido');
  await recusa({ codigo: 'TIPO', tipo: 'brinde' }, 'tipo_invalido');
  await recusa(
    {
      codigo: 'DATAS',
      tipo: 'dias_gratis',
      dias: 7,
      validoDe: '2026-12-10',
      validoAte: '2026-12-01',
    },
    'validade_invertida'
  );
  await recusa(
    { codigo: 'DATA', tipo: 'dias_gratis', dias: 7, validoAte: '31/12/2026' },
    'data_invalida'
  );
});

// ─── Prazo de resgate ───────────────────────────────────────────────────────

test('prazo: vale o dia inteiro do vencimento (Brasília) e não vale no dia seguinte', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'NATAL', tipo: 'desconto', percent: 20, validoAte: '2026-11-16' });
  await S.criarConta(m, 'ana');
  await S.criarConta(m, 'bia');

  // 16/11 às 23:30 de Brasília = 17/11 02:30 UTC: ainda vale.
  S.store.now = Date.UTC(2026, 10, 17, 2, 30, 0);
  const ok = await S.resgatarCupom('ana', 'natal');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  // 17/11 às 00:30 de Brasília: acabou.
  S.store.now = Date.UTC(2026, 10, 17, 3, 30, 0);
  const tarde = await S.resgatarCupom('bia', 'NATAL');
  assert.equal(tarde.status, 400);
  assert.equal(tarde.body.error, 'cupom_expirado');
  assert.ok(tarde.body.detail, 'mensagem para a tela');
  assert.equal(S.billing('bia').promo, undefined);
  // Quem resgatou no prazo continua com o benefício depois que ele acaba.
  assert.equal(S.billing('ana').promo.percent, 20);
});

test('prazo: cupom agendado não entra antes; sem prazo vale indefinidamente', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'BLACK', tipo: 'desconto', percent: 30, validoDe: '2026-11-27' });
  await criar({ codigo: 'SEMPRE10', tipo: 'desconto', percent: 10 });
  await S.criarConta(m, 'ana');
  await S.criarConta(m, 'bia');

  const cedo = await S.resgatarCupom('ana', 'BLACK');
  assert.equal(cedo.body.error, 'cupom_nao_iniciado');

  S.avancarDias(13); // 28/11
  assert.equal((await S.resgatarCupom('ana', 'BLACK')).status, 200);

  S.avancarDias(700);
  assert.equal((await S.resgatarCupom('bia', 'SEMPRE10')).status, 200, 'sem prazo não expira');
});

test('pausar tira o cupom do ar; prorrogar o prazo devolve', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'CAMP', tipo: 'desconto', percent: 20, validoAte: '2026-11-20' });
  await S.criarConta(m, 'ana');

  await S.adminAcao({
    action: 'cupons_atualizar',
    codigo: 'CAMP',
    mudancas: { status: 'pausado' },
  });
  assert.equal((await S.resgatarCupom('ana', 'CAMP')).body.error, 'cupom_indisponivel');

  S.avancarDias(10); // 25/11: venceu
  await S.adminAcao({ action: 'cupons_atualizar', codigo: 'CAMP', mudancas: { status: 'ativo' } });
  assert.equal((await S.resgatarCupom('ana', 'CAMP')).body.error, 'cupom_expirado');

  const r = await S.adminAcao({
    action: 'cupons_atualizar',
    codigo: 'CAMP',
    mudancas: { validoAte: '2026-12-31' },
  });
  assert.equal(r.body.itens[0].situacao, 'ativo');
  assert.equal((await S.resgatarCupom('ana', 'CAMP')).status, 200);

  // O benefício não é editável: mudar o percentual é ignorado.
  await S.adminAcao({ action: 'cupons_atualizar', codigo: 'CAMP', mudancas: { percent: 60 } });
  const lista = await S.adminAcao({ action: 'cupons_listar' });
  assert.equal(lista.body.itens[0].percent, 20);
});

// ─── Limites de uso ─────────────────────────────────────────────────────────

test('uma vez por conta, limite total e disputa pelo último uso', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'DOIS', tipo: 'dias_gratis', dias: 10, maxResgates: 2 });
  for (const u of ['ana', 'bia', 'caio']) await S.criarConta(m, u);

  assert.equal((await S.resgatarCupom('ana', 'DOIS')).status, 200);
  assert.equal((await S.resgatarCupom('ana', 'DOIS')).body.error, 'cupom_ja_usado');

  // bia e caio disputam o último uso no mesmo instante: só um leva.
  const [b, c] = await Promise.all([
    S.resgatarCupom('bia', 'DOIS'),
    S.resgatarCupom('caio', 'DOIS'),
  ]);
  const sucessos = [b, c].filter((x) => x.status === 200).length;
  assert.equal(sucessos, 1, 'só um dos dois leva o último uso');
  assert.equal([b, c].find((x) => x.status !== 200).body.error, 'cupom_esgotado');

  const lista = await S.adminAcao({ action: 'cupons_listar' });
  assert.equal(lista.body.itens[0].resgates, 2);
  assert.equal(lista.body.itens[0].situacao, 'esgotado');
});

test('dois cliques no mesmo cupom: um resgate só', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'DUPLO', tipo: 'dias_gratis', dias: 10 });
  await S.criarConta(m, 'ana');
  const fimTrial = S.billing('ana').trialEndsAt.toMillis();
  const rs = await Promise.all([S.resgatarCupom('ana', 'DUPLO'), S.resgatarCupom('ana', 'DUPLO')]);
  assert.equal(rs.filter((x) => x.status === 200).length, 1);
  assert.equal(S.billing('ana').courtesyUntil.toMillis(), fimTrial + 10 * DIA, 'somou uma vez só');
});

test('público "novos" recusa quem já pagou; "todos" aceita', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'BEMVINDO', tipo: 'desconto', percent: 20, ciclos: 1 });
  await criar({ codigo: 'VOLTA', tipo: 'desconto', percent: 20, ciclos: 1, publico: 'todos' });
  await S.criarConta(m, 'ana');
  const a = await S.assinar(m, 'ana', { modo: 'avulso' });
  await S.pagar('ana', a.body.paymentId);

  assert.equal((await S.resgatarCupom('ana', 'BEMVINDO')).body.error, 'cupom_so_novos');
  assert.equal((await S.resgatarCupom('ana', 'VOLTA')).status, 200);
  assert.equal(S.problemas(m), '');
});

test('código que não existe e tentativas em série', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await S.criarConta(m, 'ana');
  const r = await S.resgatarCupom('ana', 'NAOEXISTE');
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'cupom_invalido');
  assert.equal((await S.resgatarCupom('ana', '!!')).body.error, 'cupom_invalido');
  let ultimo;
  for (let i = 0; i < 12; i++) ultimo = await S.resgatarCupom('ana', 'CHUTE' + i);
  assert.equal(ultimo.status, 429, 'conta logada não serve de sonda de códigos');
});

// ─── Desconto com duração ───────────────────────────────────────────────────

test('desconto por 3 mensalidades (assinatura): 3 com desconto, a 4ª cheia', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'TRES', tipo: 'desconto', percent: 50, ciclos: 3 });
  await S.criarConta(m, 'ana');
  const r = await S.resgatarCupom('ana', 'TRES');
  assert.equal(r.body.promo.ciclosRestantes, 3);
  assert.equal(r.body.recurringDiscountPercent, 50);

  await S.assinar(m, 'ana');
  await S.anunciarFaturasNovas('ana');
  assert.deepEqual(new Set(valores('ana')), new Set([750]), 'todas as projetadas nascem a R$ 7,50');

  for (let i = 0; i < 3; i++) {
    await S.pagar('ana', S.faturaEmAberto('ana'));
    assert.equal(S.problemas(m), '');
    if (i < 2) S.avancarDias(30);
  }
  const b = S.billing('ana');
  assert.equal(b.promo.ciclosUsados, 3);
  assert.ok(b.promo.encerradaEm, 'cupom encerrado');
  assert.equal(b.promo.ajustePendente, false);
  // As pagas ficaram a R$ 7,50; as que faltam voltaram ao preço cheio.
  assert.deepEqual(valores('ana', 'RECEIVED'), [750, 750, 750]);
  assert.deepEqual(new Set(valores('ana', 'PENDING')), new Set([1500]));
  assert.equal(S.asaasState.subscriptions.get(b.subscriptionId).value, 15);

  const me = await S.verMinhaConta('ana');
  assert.equal(me.recurringDiscountPercent, 0);
  assert.equal(me.promo.ativa, false);
  assert.equal(me.subscriptionBaseValueCents, 1500);
  assert.equal(S.problemas(m), '');
});

test('CONFIRMED + RECEIVED da mesma cobrança gastam um ciclo só', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'DOISM', tipo: 'desconto', percent: 20, ciclos: 2 });
  await S.criarConta(m, 'ana');
  await S.resgatarCupom('ana', 'DOISM');
  await S.assinar(m, 'ana', { cartao: true });
  const paga = S.cobrancas('ana').find((p) => p.status === 'CONFIRMED');
  await S.pagar('ana', paga); // CONFIRMED e depois RECEIVED
  await S.evento('PAYMENT_CONFIRMED', { payment: Object.assign({}, paga) }, 'de-novo:' + paga.id);
  assert.equal(S.billing('ana').promo.ciclosUsados, 1);
  assert.equal(S.problemas(m), '');
});

test('desconto sem duração: vale em todas as mensalidades', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'SEMPRE20', tipo: 'desconto', percent: 20 });
  await S.criarConta(m, 'ana');
  await S.resgatarCupom('ana', 'SEMPRE20');
  await S.assinar(m, 'ana');
  for (let i = 0; i < 5; i++) {
    await S.pagar('ana', S.faturaEmAberto('ana'));
    S.avancarDias(30);
  }
  assert.deepEqual(new Set(valores('ana')), new Set([1200]));
  assert.equal((await S.verMinhaConta('ana')).promo.ciclosRestantes, null);
  assert.equal(S.problemas(m), '');
});

test('avulso: o desconto vale nas N cobranças e depois o preço volta', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'UMAVEZ', tipo: 'desconto', percent: 40, ciclos: 1 });
  await S.criarConta(m, 'ana');
  await S.resgatarCupom('ana', 'UMAVEZ');

  const a = await S.assinar(m, 'ana', { modo: 'avulso', cartao: true });
  assert.equal(a.body.value, 9, 'primeiro mês a R$ 9,00');
  await S.pagar('ana', a.body.paymentId);
  assert.ok(S.billing('ana').promo.encerradaEm);

  S.avancarDias(25);
  const b = await S.assinar(m, 'ana', { modo: 'avulso', cartao: true });
  assert.equal(b.body.value, 15, 'renovação já sem o cupom');
  assert.equal(S.problemas(m), '');
});

test('quem já assina: o desconto chega às faturas em aberto e sai delas no fim', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'FIEL', tipo: 'desconto', percent: 20, ciclos: 2, publico: 'todos' });
  await S.criarConta(m, 'ana');
  await S.assinar(m, 'ana');
  await S.pagar('ana', S.faturaEmAberto('ana'));
  assert.deepEqual(new Set(valores('ana')), new Set([1500]));

  const r = await S.resgatarCupom('ana', 'FIEL');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(valores('ana', 'RECEIVED'), [1500], 'o que já foi pago não muda');
  assert.deepEqual(new Set(valores('ana', 'PENDING')), new Set([1200]));
  assert.equal((await S.verMinhaConta('ana')).subscriptionBaseValueCents, 1200);

  S.avancarDias(30);
  await S.pagar('ana', S.faturaEmAberto('ana'));
  S.avancarDias(30);
  await S.pagar('ana', S.faturaEmAberto('ana'));
  assert.deepEqual(valores('ana', 'RECEIVED'), [1500, 1200, 1200]);
  assert.deepEqual(new Set(valores('ana', 'PENDING')), new Set([1500]));
  assert.equal(S.problemas(m), '');
});

test('Asaas recusa no resgate de quem já assina: o resgate é desfeito', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'FALHA', tipo: 'desconto', percent: 20, publico: 'todos', maxResgates: 1 });
  await S.criarConta(m, 'ana');
  await S.assinar(m, 'ana');

  S.asaasState.failUpdateSubscription = true;
  const r = await S.resgatarCupom('ana', 'FALHA');
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'cupom_falha_gateway');
  assert.equal(S.billing('ana').promo, undefined, 'nada ficou marcado');
  assert.deepEqual(new Set(valores('ana')), new Set([1500]));

  // O uso voltou para o cupom: dá para tentar de novo.
  S.asaasState.failUpdateSubscription = false;
  assert.equal((await S.resgatarCupom('ana', 'FALHA')).status, 200);
  assert.deepEqual(new Set(valores('ana', 'PENDING')), new Set([1200]));
  assert.equal(S.problemas(m), '');
});

test('Asaas fora do ar no fim do cupom: fica pendente e a reconciliação conclui', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'UMMES', tipo: 'desconto', percent: 50, ciclos: 1 });
  await S.criarConta(m, 'ana');
  await S.resgatarCupom('ana', 'UMMES');
  await S.assinar(m, 'ana');

  S.asaasState.failUpdateSubscription = true;
  await S.pagar('ana', S.faturaEmAberto('ana'));
  let b = S.billing('ana');
  assert.ok(b.promo.encerradaEm);
  assert.equal(b.promo.ajustePendente, true);
  // O erro é a favor do usuário: as faturas seguem com desconto, nunca acima.
  assert.deepEqual(new Set(valores('ana', 'PENDING')), new Set([750]));

  S.asaasState.failUpdateSubscription = false;
  const r = await S.superpoder('reconcile_user', 'ana');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  b = S.billing('ana');
  assert.equal(b.promo.ajustePendente, false);
  assert.deepEqual(new Set(valores('ana', 'PENDING')), new Set([1500]));
  assert.equal(S.problemas(m), '');
});

// ─── Não acumula ────────────────────────────────────────────────────────────

test('não acumula: vale o maior desconto; um cupom de desconto por vez', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'DEZOFF', tipo: 'desconto', percent: 10 });
  await criar({ codigo: 'TRINTA', tipo: 'desconto', percent: 30, ciclos: 2 });
  await criar({ codigo: 'VINTE', tipo: 'desconto', percent: 20 });
  // dono do cupom de indicação
  await S.criarConta(m, 'dono');
  const codigoDono = S.billing('dono').referralCode;
  await S.criarConta(m, 'ana', { cupom: codigoDono });
  assert.equal(S.billing('ana').recurringDiscountPercent, 10);

  // 10% do cupom não melhora os 10% de indicação.
  assert.equal((await S.resgatarCupom('ana', 'DEZOFF')).body.error, 'cupom_sem_vantagem');

  // 30% por 2 mensalidades: paga 70%, não 60% (não soma com os 10%).
  assert.equal((await S.resgatarCupom('ana', 'TRINTA')).status, 200);
  assert.equal((await S.resgatarCupom('ana', 'VINTE')).body.error, 'cupom_ja_ativo');
  await S.assinar(m, 'ana');
  assert.deepEqual(new Set(valores('ana')), new Set([1050]));

  await S.pagar('ana', S.faturaEmAberto('ana'));
  S.avancarDias(30);
  await S.pagar('ana', S.faturaEmAberto('ana'));
  // Acabou o cupom: volta para os 10% de indicação, não para o preço cheio.
  assert.deepEqual(new Set(valores('ana', 'PENDING')), new Set([1350]));
  assert.equal((await S.verMinhaConta('ana')).recurringDiscountPercent, 10);

  // Encerrado o primeiro, outro cupom pode entrar.
  assert.equal((await S.resgatarCupom('ana', 'VINTE')).body.error, 'cupom_so_novos');
  assert.equal(S.problemas(m, { paresApplicash: [['dono', 'ana']] }), '');
});

// ─── Dias grátis ────────────────────────────────────────────────────────────

test('dias grátis somam ao resto da avaliação e não queimam na hora de assinar', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'MES30', tipo: 'dias_gratis', dias: 30 });
  await S.criarConta(m, 'ana');
  S.avancarDias(3); // dia 3 de 7 da avaliação
  const fimTrial = S.billing('ana').trialEndsAt.toMillis();

  const r = await S.resgatarCupom('ana', 'MES30');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.beneficio, '30 dias grátis');
  assert.equal(r.body.access.status, 'active');
  assert.equal(S.billing('ana').courtesyUntil.toMillis(), fimTrial + 30 * DIA);

  // Dia 20: avaliação vencida, segue com acesso pelo cupom.
  S.avancarDias(17);
  assert.equal(S.acesso('ana').status, 'active');

  // Assina no meio dos dias grátis: a 1ª cobrança só vence depois deles.
  await S.assinar(m, 'ana');
  const primeira = S.faturaEmAberto('ana');
  assert.ok(Date.parse(primeira.dueDate + 'T23:59:59Z') >= fimTrial + 30 * DIA - DIA);

  // Dias grátis acabam sem pagar: bloqueia.
  S.avancarDias(30);
  assert.notEqual(S.acesso('ana').status, 'active');
  assert.equal(S.problemas(m), '');
});

test('dias grátis: recusado para quem tem assinatura viva ou PRO sem prazo', async () => {
  const m = S.criarMundoPagamentos({ agora: AGORA });
  await criar({ codigo: 'SEMANA', tipo: 'dias_gratis', dias: 7, publico: 'todos' });
  await S.criarConta(m, 'ana');
  await S.assinar(m, 'ana');
  assert.equal((await S.resgatarCupom('ana', 'SEMANA')).body.error, 'cupom_dias_com_assinatura');

  await S.criarConta(m, 'bia');
  await S.superpoder('make_pro', 'bia');
  assert.equal((await S.resgatarCupom('bia', 'SEMANA')).body.error, 'cupom_sem_vantagem');
  assert.equal(S.problemas(m), '');
});
