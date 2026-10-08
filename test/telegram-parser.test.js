'use strict';

// Interpretação das mensagens do bot do Telegram. Cada caso aqui é uma frase
// que um usuário real mandaria; o que se prova é o lançamento que sai dela.

const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretar, lerNumeroBR } = require('../api/_lib/telegram-parser');

const HOJE = new Date(2026, 9, 7, 15, 0, 0); // 07/10/2026

const CTX = {
  hoje: HOJE,
  contas: [
    { id: 'c_itau', nome: 'Itaú', tipo: 'banco' },
    { id: 'c_nu', nome: 'Nubank', tipo: 'banco' },
    { id: 'c_xp', nome: 'XP Investimentos', tipo: 'corretora' },
    { id: 'c_velha', nome: 'Banco Inter', tipo: 'banco', arquivada: true },
  ],
  cartoes: [
    { id: 'card_nu', nome: 'Nubank' },
    { id: 'card_c6', nome: 'C6 Carbon' },
    { id: 'card_velho', nome: 'Santander', arquivado: true },
  ],
  categorias: [{ v: 'academia', label: '🏋️ Academia' }],
  aprendidas: { padoca: 'alimentacao' },
};

function ok(texto, ctx) {
  const r = interpretar(texto, ctx || CTX);
  assert.equal(r.ok, true, `"${texto}" deveria ser entendido, veio ${JSON.stringify(r)}`);
  return r.lanc;
}

test('lerNumeroBR entende os formatos brasileiros', () => {
  assert.equal(lerNumeroBR('52,90'), 52.9);
  assert.equal(lerNumeroBR('1.234,56'), 1234.56);
  assert.equal(lerNumeroBR('1.500'), 1500);
  assert.equal(lerNumeroBR('12.50'), 12.5);
  assert.equal(lerNumeroBR('1500'), 1500);
});

test('despesa simples: "mercado 52,90"', () => {
  const l = ok('mercado 52,90');
  assert.equal(l.categoria, 'despesa_variavel');
  assert.equal(l.valor, 52.9);
  assert.equal(l.descricao, 'Mercado');
  assert.equal(l.categoriaDespesa, 'alimentacao');
  assert.equal(l.dataCompra, '2026-10-07');
  assert.equal(l.contaId, null, 'sem conta citada → conta principal (decidida pelo webhook)');
  assert.equal(l.cartaoId, null);
});

test('valor antes da descrição e com R$', () => {
  const l = ok('R$ 18 uber');
  assert.equal(l.valor, 18);
  assert.equal(l.descricao, 'Uber');
  assert.equal(l.categoriaDespesa, 'transporte');
  assert.equal(ok('52.90 farmácia').valor, 52.9);
  assert.equal(ok('farmácia 52.90').categoriaDespesa, 'saude');
});

test('milhar com ponto e centavos com vírgula', () => {
  assert.equal(ok('aluguel 1.800,00').valor, 1800);
  assert.equal(ok('notebook 3.500').valor, 3500);
});

test('ontem / anteontem / dd/mm mudam a data da compra', () => {
  assert.equal(ok('ontem farmácia 35').dataCompra, '2026-10-06');
  assert.equal(ok('anteontem padaria 12').dataCompra, '2026-10-05');
  assert.equal(ok('ontem farmácia 35').descricao, 'Farmácia');
  const l = ok('03/10 mercado 80');
  assert.equal(l.dataCompra, '2026-10-03');
  assert.equal(l.valor, 80);
  assert.equal(l.descricao, 'Mercado');
});

test('dd/mm de dezembro digitado em janeiro é do ano anterior', () => {
  const l = ok('28/12 presente 100', { ...CTX, hoje: new Date(2027, 0, 5) });
  assert.equal(l.dataCompra, '2026-12-28');
});

test('data impossível é recusada, não ajustada', () => {
  assert.equal(interpretar('31/02 mercado 10', CTX).motivo, 'data_invalida');
});

test('receita por sinal +', () => {
  const l = ok('+3500 salário');
  assert.equal(l.categoria, 'receita');
  assert.equal(l.valor, 3500);
  assert.equal(l.descricao, 'Salário');
  assert.equal(l.categoriaDespesa, null, 'receita não tem categoria de despesa');
});

test('receita por palavra', () => {
  assert.equal(ok('recebi 200 pix do João').categoria, 'receita');
  assert.equal(ok('freela 800').categoria, 'receita');
  assert.equal(ok('reembolso 45,50').categoria, 'receita');
});

test('receita citando o banco que recebe', () => {
  const l = ok('+3500 salário itaú');
  assert.equal(l.categoria, 'receita');
  assert.equal(l.contaId, 'c_itau');
  assert.equal(l.descricao, 'Salário');
});

test('sinal - força despesa mesmo com palavra de receita', () => {
  assert.equal(ok('-50 venda de garagem taxa').categoria, 'despesa_variavel');
});

test('cartão citado pelo nome com parcelas: "nubank 300 tênis 3x"', () => {
  const l = ok('nubank 300 tênis 3x');
  assert.equal(l.categoria, 'cartao_credito');
  assert.equal(l.cartaoId, 'card_nu');
  assert.equal(l.parcelas, 3);
  assert.equal(l.tipoCartao, 'parcelado');
  assert.equal(l.valor, 300);
  assert.equal(l.descricao, 'Tênis');
});

test('"em 10 vezes" também é parcelamento', () => {
  const l = ok('geladeira 4.000 em 10 vezes no c6');
  assert.equal(l.parcelas, 10);
  assert.equal(l.cartaoId, 'card_c6');
  assert.equal(l.valor, 4000);
  assert.equal(l.descricao, 'Geladeira');
});

test('"cartão" sem nome com vários cartões pergunta qual', () => {
  const r = interpretar('cartão 89 farmácia', CTX);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'cartao_ambiguo');
  assert.deepEqual(
    r.opcoes.map((o) => o.id),
    ['card_nu', 'card_c6'],
    'cartão arquivado não é opção'
  );
  assert.equal(r.lanc.valor, 89);
  assert.equal(r.lanc.descricao, 'Farmácia');
});

test('"cartão" com um cartão só usa esse', () => {
  const ctx = { ...CTX, cartoes: [{ id: 'card_unico', nome: 'Cartão principal' }] };
  const l = ok('cartão 89 farmácia', ctx);
  assert.equal(l.cartaoId, 'card_unico');
  assert.equal(l.descricao, 'Farmácia');
});

test('crédito sem cartão cadastrado é recusado', () => {
  assert.equal(interpretar('crédito 50 lanche', { ...CTX, cartoes: [] }).motivo, 'sem_cartao');
});

test('nome que é conta E cartão: sem pista vai para o cartão; "pix"/"débito" vai para a conta', () => {
  assert.equal(ok('nubank 50 ifood').cartaoId, 'card_nu');
  const pix = ok('nubank 50 ifood pix');
  assert.equal(pix.categoria, 'despesa_variavel');
  assert.equal(pix.contaId, 'c_nu');
  assert.equal(pix.descricao, 'Ifood');
  assert.equal(ok('débito nubank 50 ifood').contaId, 'c_nu');
});

test('conta citada só como conta', () => {
  const l = ok('itau 120 luz');
  assert.equal(l.categoria, 'despesa_variavel');
  assert.equal(l.contaId, 'c_itau');
  assert.equal(l.categoriaDespesa, 'moradia');
});

test('corretora e conta arquivada não são destino de despesa', () => {
  assert.equal(ok('xp 50 lanche').contaId, null);
  assert.equal(ok('inter 50 lanche').contaId, null);
});

test('despesa fixa com dia de vencimento', () => {
  const l = ok('aluguel 1800 fixa dia 10');
  assert.equal(l.categoria, 'despesa_fixa');
  assert.equal(l.fixo, true);
  assert.equal(l.diaVencimento, 10);
  assert.equal(l.valor, 1800);
  assert.equal(l.descricao, 'Aluguel');
  assert.equal(l.categoriaDespesa, 'moradia');
});

test('assinatura fixa no cartão vira cartão fixo mensal', () => {
  const l = ok('netflix 55,90 todo mês no cartão c6');
  assert.equal(l.categoria, 'cartao_credito');
  assert.equal(l.tipoCartao, 'fixo');
  assert.equal(l.cartaoId, 'card_c6');
  assert.equal(l.categoriaDespesa, 'lazer');
  assert.equal(l.descricao, 'Netflix');
});

test('categoria aprendida e categoria criada pelo usuário', () => {
  assert.equal(ok('padoca 9').categoriaDespesa, 'alimentacao');
  assert.equal(ok('padoca 9').origemCategoria, 'aprendida');
  assert.equal(ok('academia 120').categoriaDespesa, 'academia');
});

test('sem categoria conhecida fica sem categoria (não chuta)', () => {
  const l = ok('presente da Maria 150');
  assert.equal(l.categoriaDespesa, null);
  assert.equal(l.descricao, 'Presente da Maria');
});

test('mensagem sem valor ou com valores ambíguos não vira lançamento', () => {
  assert.equal(interpretar('mercado', CTX).motivo, 'sem_valor');
  assert.equal(interpretar('', CTX).motivo, 'vazio');
  assert.equal(interpretar('apto 302 aluguel 1800', CTX).motivo, 'varios_valores');
  assert.equal(interpretar('0 mercado', CTX).motivo, 'sem_valor');
});

test('dois números com um só tendo centavos: escolhe o com centavos', () => {
  const l = ok('2 pizzas 89,90');
  assert.equal(l.valor, 89.9);
  assert.equal(l.descricao, '2 pizzas');
});

test('número colado em palavra não é valor', () => {
  const l = ok('jogo ps5 250');
  assert.equal(l.valor, 250);
  assert.equal(l.descricao, 'Jogo ps5');
});

test('limites: valor absurdo e parcelas demais', () => {
  assert.equal(interpretar('casa 99999999', CTX).motivo, 'valor_alto');
  assert.equal(interpretar('tv 3000 60x', CTX).motivo, 'parcelas');
});

test('descrição só com valor ganha nome genérico', () => {
  assert.equal(ok('50').descricao, 'Despesa');
  assert.equal(ok('+50').descricao, 'Receita');
});

// ── "dia N": data da compra ou vencimento ─────────────────────────────────────
// A frase real que falhou: "Comprei dia 3 um celular no valor de 1000 no cartão
// de credito em 12x" entrou com a data de hoje e a descrição "Um celular no
// valor". Antes, "dia N" era sempre vencimento — e no cartão (que não tem
// vencimento próprio) o dia era jogado fora. HOJE aqui é 07/10/2026.

// Um cartão só (como o "MP" da conversa real): sem pergunta de qual cartão.
const CTX_UM_CARTAO = Object.assign({}, CTX, { cartoes: [{ id: 'card_mp', nome: 'MP' }] });

test('"comprei dia 3 ... no cartão em 12x" usa o dia 3 como data da compra', () => {
  const l = ok(
    'Comprei dia 3 um celular no valor de 1000 no cartão de credito em 12x',
    CTX_UM_CARTAO
  );
  assert.equal(l.cartaoId, 'card_mp');
  assert.equal(l.categoria, 'cartao_credito');
  assert.equal(l.dataCompra, '2026-10-03');
  assert.equal(l.parcelas, 12);
  assert.equal(l.valor, 1000);
  assert.equal(l.descricao, 'Celular');
});

test('dia que já passou no mês é data da compra; dia por vir com verbo no passado é do mês anterior', () => {
  const a = ok('mercado 80 dia 5');
  assert.equal(a.dataCompra, '2026-10-05');
  assert.equal(a.diaVencimento, null);
  const b = ok('paguei a luz 120 dia 25');
  assert.equal(b.dataCompra, '2026-09-25');
  assert.equal(b.diaVencimento, null);
});

test('cartão nunca leva "dia N" como vencimento, nem dia por vir', () => {
  const l = ok('nubank 300 tenis dia 20');
  assert.equal(l.categoria, 'cartao_credito');
  assert.equal(l.dataCompra, '2026-09-20');
  assert.equal(l.diaVencimento, null);
});

test('conta fixa, "vence" e dia por vir sem pista continuam sendo vencimento', () => {
  assert.equal(ok('aluguel 1800 fixa dia 10').diaVencimento, 10);
  const v = ok('luz 200 vence dia 20');
  assert.equal(v.diaVencimento, 20);
  assert.equal(v.descricao, 'Luz', '"vence" não entra na descrição');
  assert.equal(v.dataCompra, '2026-10-07');
  assert.equal(ok('internet 100 dia 20').diaVencimento, 20);
});

test('"dia 03/10" é a data completa e o "dia" sai da descrição', () => {
  const l = ok('tenis 300 dia 03/10 no cartao', CTX_UM_CARTAO);
  assert.equal(l.dataCompra, '2026-10-03');
  assert.equal(l.descricao, 'Tenis');
});

test('dia que o mês anterior não tem cai no último dia dele', () => {
  // 31 em 07/10 com verbo no passado: setembro não tem 31 → 30/09.
  assert.equal(ok('gastei 50 farmacia dia 31').dataCompra, '2026-09-30');
});
