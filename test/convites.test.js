'use strict';

/**
 * Cadastro por convite — fase de testes com usuários reais.
 *
 * O pedido: "a pessoa só consegue se cadastrar (Google ou e-mail) se tiver um
 * código que eu passei, e o código vale uma vez só; quem entra assim ganha
 * acesso [...]". E é temporário: um interruptor no admin liga e desliga.
 *
 * O benefício virou: grátis até 1 ano depois da DATA DE LANÇAMENTO (editável
 * no admin) e, depois, 50% de desconto na mensalidade para sempre. Sem data
 * definida, a cortesia fica sem prazo até o admin definir.
 *
 * A trava fica em /api/billing/init (sem billing, o servidor bloqueia tudo),
 * então os testes dirigem o /init de verdade, no mundo de pagamentos fiel ao
 * Asaas, e validam o sistema inteiro no fim (S.problemas).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const S = require('./_simulador-pagamentos.js');
const M = require('../scripts/lib/mock-billing');
const C = require('../api/_lib/convites');

const ROOT = path.resolve(__dirname, '..');

function token(uid) {
  return 'fake:' + uid + ':' + uid + '@example.com';
}

async function init(uid, body) {
  return M.call(S.handlers.init, {
    headers: { authorization: 'Bearer ' + token(uid) },
    body: body || {},
  });
}

async function admin(action, extra) {
  process.env.ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || 'admin_test_token';
  return M.call(S.handlers.adminAction, {
    headers: { authorization: 'Bearer ' + process.env.ADMIN_API_TOKEN },
    body: Object.assign({ action }, extra || {}),
  });
}

async function ligar(obrigatorio) {
  const r = await admin('convites_modo', { obrigatorio });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.obrigatorio, obrigatorio);
}

async function gerarUm(nota) {
  const r = await admin('convites_gerar', { quantidade: 1, nota });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.criados.length, 1);
  return r.body.criados[0];
}

// ─── o código ───────────────────────────────────────────────────────────────

test('código: formato BETA-XXXX-XXXX, sem caracteres ambíguos, aleatório', () => {
  const vistos = new Set();
  for (let i = 0; i < 500; i++) {
    const c = C.gerarCodigo();
    assert.match(c, C.RE_CODIGO);
    assert.ok(!/[01OIL]/.test(c.slice(5)), `ambíguo em ${c}`);
    vistos.add(c);
  }
  assert.equal(vistos.size, 500, 'códigos repetidos — não é aleatório o bastante');
});

test('código: aceita como a pessoa digitar', () => {
  assert.equal(C.normalizar('beta-7k3p-q9xy'), 'BETA-7K3P-Q9XY');
  assert.equal(C.normalizar('  BETA 7K3P Q9XY '), 'BETA-7K3P-Q9XY');
  assert.equal(C.normalizar('BETA7K3PQ9XY'), 'BETA-7K3P-Q9XY');
  assert.equal(C.normalizar('APP-ABC123'), null, 'cupom do Applicash não é convite');
  assert.equal(C.normalizar('BETA-0000-0000'), null, 'fora do alfabeto');
  assert.equal(C.normalizar(''), null);
});

// ─── interruptor desligado: nada muda ───────────────────────────────────────

test('desligado: o cadastro segue igual a hoje (avaliação de 7 dias)', async () => {
  const m = S.criarMundoPagamentos();
  const r = await init('ana');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.access.status, 'trial');
  assert.notEqual(S.billing('ana').courtesyPermanent, true);
  assert.equal(S.problemas(m), '');
});

// ─── interruptor ligado ─────────────────────────────────────────────────────

test('ligado: conta nova sem convite não nasce — e não cria cliente no Asaas', async () => {
  const m = S.criarMundoPagamentos();
  await ligar(true);
  const r = await init('bia');
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'convite_obrigatorio');
  assert.ok(!M.store.docs.has('users/bia/billing/account'), 'billing não pode existir');
  assert.equal(M.asaasState.customers.size, 0, 'nada no Asaas');
  // Sem billing, o gate do servidor bloqueia.
  assert.equal(S.acesso('bia').status, 'blocked');
  assert.equal(S.problemas(m), '');
});

test('ligado: com convite (sem data de lançamento ainda), a conta nasce com cortesia sem prazo e 50%', async () => {
  const m = S.criarMundoPagamentos();
  await ligar(true);
  const codigo = await gerarUm('Carla – amiga do trabalho');

  const r = await init('carla', { convite: codigo.toLowerCase() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.access.status, 'active');
  assert.equal(r.body.access.reason, 'courtesy');

  const b = S.billing('carla');
  assert.equal(b.courtesyPermanent, true);
  assert.equal(b.conviteCodigo, codigo);
  assert.equal(b.courtesyGrantedBy, 'convite:' + codigo);

  // Vitalício de verdade: passa o "trial", passa um ano, continua ativo.
  S.avancarDias(400);
  assert.equal(S.acesso('carla').status, 'active');
  const me = await S.verMinhaConta('carla');
  assert.equal(me.courtesy.permanent, true);

  const lista = await admin('convites_listar');
  const item = lista.body.itens.find((i) => i.codigo === codigo);
  assert.equal(item.status, 'usado');
  assert.equal(item.usadoEmail, 'carla@example.com');
  assert.equal(item.nota, 'Carla – amiga do trabalho');
  assert.equal(S.problemas(m), '');
});

test('uso único: o mesmo código não serve para uma segunda pessoa', async () => {
  const m = S.criarMundoPagamentos();
  await ligar(true);
  const codigo = await gerarUm();
  assert.equal((await init('dani', { convite: codigo })).status, 200);

  const r = await init('edu', { convite: codigo });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'convite_usado');
  assert.ok(!M.store.docs.has('users/edu/billing/account'));
  assert.equal(S.problemas(m), '');
});

test('o dono pode repetir o próprio convite (o /init dele falhou no meio)', async () => {
  const m = S.criarMundoPagamentos();
  await ligar(true);
  const codigo = await gerarUm();
  assert.equal((await init('fabi', { convite: codigo })).status, 200);
  // Recarregou a página com o link do convite: entra normal, sem erro.
  const r = await init('fabi', { convite: codigo });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.access.reason, 'courtesy');
  assert.equal(S.problemas(m), '');
});

test('código inexistente, mal digitado ou cancelado: recusado com motivo', async () => {
  const m = S.criarMundoPagamentos();
  await ligar(true);
  assert.equal((await init('gil', { convite: 'BETA-2222-3333' })).body.error, 'convite_invalido');
  assert.equal((await init('gil', { convite: 'qualquer coisa' })).body.error, 'convite_invalido');

  const codigo = await gerarUm();
  const c = await admin('convites_cancelar', { codigo });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const r = await init('gil', { convite: codigo });
  assert.equal(r.body.error, 'convite_cancelado');
  assert.ok(!M.store.docs.has('users/gil/billing/account'));
  assert.equal(S.problemas(m), '');
});

test('convite usado não se cancela (o acesso já foi dado)', async () => {
  S.criarMundoPagamentos();
  await ligar(true);
  const codigo = await gerarUm();
  await init('hugo', { convite: codigo });
  const r = await admin('convites_cancelar', { codigo });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'convite_ja_usado');
  assert.equal(S.billing('hugo').courtesyPermanent, true);
});

test('quem já tinha conta continua entrando com o interruptor ligado', async () => {
  const m = S.criarMundoPagamentos();
  assert.equal((await init('iara')).status, 200); // criou antes de ligar
  await ligar(true);
  const r = await init('iara');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.access.status, 'trial');
  assert.equal(S.problemas(m), '');
});

test('quem já tem conta nunca fica preso por um convite ruim (link velho, já usado)', async () => {
  const m = S.criarMundoPagamentos();
  await init('nina');
  await ligar(true);
  const codigo = await gerarUm();
  await init('otto', { convite: codigo }); // otto usou primeiro
  const r = await init('nina', { convite: codigo });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.access.status, 'trial', 'o acesso dela segue o de antes');
  assert.equal(r.body.avisoConvite.erro, 'convite_usado');
  assert.notEqual(S.billing('nina').courtesyPermanent, true);
  assert.equal(S.problemas(m), '');
});

test('conta em avaliação que recebe um convite ganha o benefício de testador', async () => {
  const m = S.criarMundoPagamentos();
  await init('joao');
  await ligar(true);
  const codigo = await gerarUm();
  const r = await init('joao', { convite: codigo });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.access.reason, 'courtesy');
  assert.equal(S.billing('joao').courtesyPermanent, true);
  assert.equal(S.problemas(m), '');
});

test('conta com assinatura no Asaas não troca por convite sozinha (as cobranças seguiriam)', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'kai');
  await S.assinar(m, 'kai');
  await ligar(true);
  const codigo = await gerarUm();
  const r = await init('kai', { convite: codigo });
  // Entra normal (já é assinante) e só recebe o aviso.
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.avisoConvite.erro, 'convite_com_assinatura');
  assert.notEqual(S.billing('kai').courtesyPermanent, true);
  // O convite não foi gasto.
  const lista = await admin('convites_listar');
  assert.equal(lista.body.itens.find((i) => i.codigo === codigo).status, 'livre');
  assert.equal(S.problemas(m), '');
});

test('desligar o interruptor volta ao cadastro aberto; testadores continuam', async () => {
  const m = S.criarMundoPagamentos();
  await ligar(true);
  const codigo = await gerarUm();
  await init('lia', { convite: codigo });
  await ligar(false);
  const r = await init('max');
  assert.equal(r.status, 200);
  assert.equal(r.body.access.status, 'trial');
  assert.equal(S.acesso('lia').reason, 'courtesy');
  assert.equal(S.problemas(m), '');
});

// ─── painel ─────────────────────────────────────────────────────────────────

test('admin: gera vários de uma vez, com teto, e tudo fica no log de auditoria', async () => {
  S.criarMundoPagamentos();
  const r = await admin('convites_gerar', { quantidade: 5, nota: 'turma 1' });
  assert.equal(r.body.criados.length, 5);
  assert.equal(new Set(r.body.criados).size, 5);
  assert.ok(r.body.itens.every((i) => i.status === 'livre'));

  const teto = await admin('convites_gerar', { quantidade: 999 });
  assert.equal(teto.body.criados.length, C.MAX_POR_VEZ);

  const auditoria = [...M.store.docs.keys()].filter((k) => k.startsWith('adminAuditLog/'));
  assert.ok(auditoria.length >= 2);
});

test('admin: sem o token não mexe em convite nenhum', async () => {
  S.criarMundoPagamentos();
  process.env.ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || 'admin_test_token';
  const r = await M.call(S.handlers.adminAction, {
    headers: { authorization: 'Bearer errado' },
    body: { action: 'convites_modo', obrigatorio: false },
  });
  assert.equal(r.status, 401);
});

test('a tela de login descobre o modo sem login e sem ver código nenhum', async () => {
  S.criarMundoPagamentos();
  const user = require(path.join(ROOT, 'api/user.js'));
  const ver = () => M.call(user, { method: 'GET', query: { op: 'convite-modo' }, headers: {} });
  assert.deepEqual((await ver()).body, { obrigatorio: false });
  await ligar(true);
  await gerarUm();
  const r = await ver();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { obrigatorio: true });
});

// ─── benefício de testador: 1 ano depois do lançamento, depois 50% ──────────

const DIA = 86400000;
function ymdUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
async function lancamento(data) {
  const r = await admin('convites_lancamento', { data });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

test('data: válida, ano bissexto, e fim = dia inteiro do aniversário em Brasília', () => {
  assert.equal(C.dataValida('2026-12-01'), '2026-12-01');
  assert.equal(C.dataValida('2026-02-30'), null);
  assert.equal(C.dataValida('01/12/2026'), null);
  assert.equal(C.dataValida(''), null);
  // 01/12/2026 → vale até 01/12/2027 23:59 em Brasília = 02/12/2027 03:00Z.
  assert.equal(new Date(C.fimCortesiaMs('2026-12-01')).toISOString(), '2027-12-02T03:00:00.000Z');
  // 29/02 → 01/03 do ano seguinte (até o fim desse dia).
  assert.equal(new Date(C.fimCortesiaMs('2028-02-29')).toISOString(), '2029-03-02T03:00:00.000Z');
});

test('com data de lançamento: grátis até 1 ano depois dela; depois paga 50% (R$ 7,50)', async () => {
  const m = S.criarMundoPagamentos();
  await ligar(true);
  const lanc = ymdUtc(M.store.now + 30 * DIA); // lança daqui a 30 dias
  const st = await lancamento(lanc);
  assert.equal(st.dataLancamento, lanc);
  const codigo = await gerarUm('Rui');
  const r = await init('rui', { convite: codigo });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.access.reason, 'courtesy');
  assert.equal(r.body.billing.recurringDiscountPercent, 50);

  const b = S.billing('rui');
  assert.notEqual(b.courtesyPermanent, true, 'não é mais sem prazo');
  assert.equal(b.courtesyUntil.toMillis(), C.fimCortesiaMs(lanc));

  // Grátis antes do lançamento e durante o ano seguinte…
  S.avancarDias(30 + 360);
  assert.equal(S.acesso('rui').status, 'active');
  // …e acabou: agora precisa assinar.
  S.avancarDias(10);
  assert.equal(S.acesso('rui').status, 'blocked');

  // Assina: a mensalidade sai com 50%.
  const a = await S.assinar(m, 'rui');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(S.billing('rui').subscriptionBaseValueCents, 750);
  assert.equal(S.problemas(m), '');
});

test('mudar a data de lançamento recalcula o prazo de TODOS os testadores', async () => {
  const m = S.criarMundoPagamentos();
  await ligar(true);
  const c1 = await gerarUm();
  const c2 = await gerarUm();
  await init('sol', { convite: c1 }); // sem data ainda: sem prazo
  assert.equal(S.billing('sol').courtesyPermanent, true);

  const st = await lancamento('2027-03-15');
  assert.equal(st.recalculados, 1);
  assert.equal(S.billing('sol').courtesyUntil.toMillis(), C.fimCortesiaMs('2027-03-15'));
  assert.notEqual(S.billing('sol').courtesyPermanent, true);

  await init('tom', { convite: c2 }); // já nasce com a data
  const st2 = await lancamento('2027-06-01'); // adiou o lançamento
  assert.equal(st2.recalculados, 2);
  for (const u of ['sol', 'tom']) {
    assert.equal(S.billing(u).courtesyUntil.toMillis(), C.fimCortesiaMs('2027-06-01'), u);
  }

  // Apagar a data: voltam a ter cortesia sem prazo.
  await lancamento('');
  assert.equal(S.billing('sol').courtesyPermanent, true);
  assert.ok(!S.billing('sol').courtesyUntil);
  assert.equal(S.problemas(m), '');
});

test('data inválida é recusada e não mexe em ninguém', async () => {
  S.criarMundoPagamentos();
  const r = await admin('convites_lancamento', { data: '31/12/2026' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'data_invalida');
});

test('o que o admin mudou à mão depois não é sobrescrito pela data', async () => {
  const m = S.criarMundoPagamentos();
  await ligar(true);
  const c1 = await gerarUm();
  const c2 = await gerarUm();
  await init('ugo', { convite: c1 });
  await init('vera', { convite: c2 });
  await S.superpoder('revoke_pro', 'ugo'); // tirou o acesso do ugo
  await S.superpoder('make_pro', 'vera'); // deu PRO de verdade à vera

  const st = await lancamento('2027-01-10');
  assert.equal(st.recalculados, 0);
  assert.ok(
    !S.billing('ugo').courtesyPermanent && !S.billing('ugo').courtesyUntil,
    'revogado fica revogado'
  );
  assert.equal(S.billing('vera').courtesyPermanent, true, 'PRO do admin fica sem prazo');
  assert.equal(S.problemas(m), '');
});

test('o desconto de testador não cai para os 10% do cupom', async () => {
  const m = S.criarMundoPagamentos();
  // Um indicador com cupom.
  await init('xavi');
  const cupom = S.billing('xavi').referralCode;
  await ligar(true);
  const codigo = await gerarUm();
  // Entra com convite E cupom: fica com 50%.
  const r = await init('yara', { convite: codigo, referralCode: cupom });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(S.billing('yara').recurringDiscountPercent, 50);
  const a = await S.assinar(m, 'yara');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(S.billing('yara').subscriptionBaseValueCents, 750);
  assert.equal(S.problemas(m), '');
});

test('conta antiga com cupom de 10% que resgata convite passa a 50%', async () => {
  const m = S.criarMundoPagamentos();
  await init('zeca');
  const cupom = S.billing('zeca').referralCode;
  await init('wil', { referralCode: cupom });
  assert.equal(S.billing('wil').recurringDiscountPercent, 10);
  await ligar(true);
  const codigo = await gerarUm();
  const r = await init('wil', { convite: codigo });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(S.billing('wil').recurringDiscountPercent, 50);
  assert.equal(S.problemas(m), '');
});

test('a aba Convites mostra a data e até quando os testadores usam grátis', async () => {
  S.criarMundoPagamentos();
  await lancamento('2026-12-01');
  const r = await admin('convites_listar');
  assert.equal(r.body.dataLancamento, '2026-12-01');
  assert.equal(r.body.fimCortesiaMs, C.fimCortesiaMs('2026-12-01'));
  assert.equal(r.body.descontoPercent, 50);
  // O que a tela escreve: o último dia grátis, no calendário de Brasília.
  assert.equal(r.body.ultimoDiaGratis, '01/12/2027');
  assert.equal(C.ultimoDiaGratisTexto('2028-02-29'), '01/03/2029');
});

test('conta antiga que manda convite E cupom juntos fica com 50%, não 10%', async () => {
  const m = S.criarMundoPagamentos();
  await init('ana2');
  const cupom = S.billing('ana2').referralCode;
  await init('beto2'); // conta antiga, sem cupom
  await ligar(true);
  const codigo = await gerarUm();
  const r = await init('beto2', { convite: codigo, referralCode: cupom });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(S.billing('beto2').recurringDiscountPercent, 50);
  assert.equal(S.problemas(m), '');
});

test('cupom derrubado na hora de assinar não leva junto o desconto de testador', async () => {
  const m = S.criarMundoPagamentos();
  await init('ivo');
  const cupom = S.billing('ivo').referralCode;
  await ligar(true);
  const codigo = await gerarUm();
  await init('jade', { convite: codigo, referralCode: cupom });
  // O indicador ficou inativo: o /subscribe derruba o vínculo do cupom.
  const k = 'users/ivo/billing/account';
  M.store.docs.set(k, Object.assign({}, M.store.docs.get(k), { subscriptionStatus: 'INACTIVE' }));
  const a = await S.assinar(m, 'jade');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.ok(!S.billing('jade').referredByUserId, 'o cupom caiu');
  assert.equal(S.billing('jade').recurringDiscountPercent, 50);
  assert.equal(S.billing('jade').subscriptionBaseValueCents, 750);
});
