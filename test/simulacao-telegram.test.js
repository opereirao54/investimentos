'use strict';

// Simulação do lançamento pelo Telegram no mundo completo (test/_simulador.js):
// contas, receita, cartão com fatura, investimento, bem e sonho. Cada item
// da caixa de entrada é aplicado como o app aplica (telegramAplicarItens +
// telegramAvisar) e o sistema INTEIRO é validado depois — não só o Controle.
//
// Classes de entrada do protocolo simular-acao: válida, zero, negativa, NaN,
// Infinity, vazia, id inexistente, data inválida, repetida (duplo envio).

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarMundo, executar, problemas, ymd } = require('./_simulador.js');

const HOJE = ymd(new Date());

function aplicar(itens) {
  return (s) => s.telegramAvisar(s.telegramAplicarItens(itens));
}

function mundo() {
  const m = criarMundo();
  const nubank = m.s.contas.find((c) => c.nome === 'Nubank');
  m.s.telegramDefinirContaPrincipal(nubank.id);
  m.nubank = nubank;
  return m;
}

function despesa(m, extra) {
  return {
    categoria: 'despesa_variavel',
    valor: 52.9,
    descricao: 'Mercado',
    dataCompra: HOJE,
    parcelas: 1,
    fixo: false,
    contaId: m.nubank.id,
    banco: 'Nubank',
    cartaoId: null,
    categoriaDespesa: 'alimentacao',
    ...extra,
  };
}

let seq = 0;
function item(lanc) {
  seq++;
  return { id: `tg1_${seq}`, tipo: 'lancamento', criadoEmMs: seq, lanc };
}

test('despesa válida: sai do patrimônio exatamente o valor, nada mais quebra', () => {
  const m = mundo();
  const rel = executar(m, { nome: 'tg despesa', fn: aplicar([item(despesa(m))]) });
  assert.equal(problemas(rel, { deltaPatrimonio: -52.9 }), '');
});

test('compra no cartão: não mexe no patrimônio agora (vira fatura a pagar)', () => {
  const m = mundo();
  const rel = executar(m, {
    nome: 'tg cartão 3x',
    fn: aplicar([
      item(
        despesa(m, {
          categoria: 'cartao_credito',
          valor: 300,
          parcelas: 3,
          tipoCartao: 'parcelado',
          contaId: null,
          banco: null,
          cartaoId: 'sim_card',
        })
      ),
    ]),
  });
  assert.equal(problemas(rel), '');
  assert.equal(rel.depois.contagens.transacoes - rel.antes.contagens.transacoes, 3);
});

test('receita e despesa fixa: estado consistente em todas as telas', () => {
  const m = mundo();
  const rel = executar(m, {
    nome: 'tg receita + fixa',
    fn: aplicar([
      item(
        despesa(m, {
          categoria: 'receita',
          valor: 3500,
          descricao: 'Salário',
          categoriaDespesa: null,
        })
      ),
      item(
        despesa(m, {
          categoria: 'despesa_fixa',
          fixo: true,
          valor: 1800,
          descricao: 'Aluguel',
          diaVencimento: 10,
        })
      ),
    ]),
  });
  assert.equal(problemas(rel), '');
});

for (const [nome, extra] of [
  ['valor zero', { valor: 0 }],
  ['valor negativo', { valor: -50 }],
  ['valor NaN', { valor: NaN }],
  ['valor Infinity', { valor: Infinity }],
  ['valor texto', { valor: 'abc' }],
  ['descrição vazia', { descricao: '' }],
  ['categoria desconhecida', { categoria: '' }],
  ['cartão inexistente', { categoria: 'cartao_credito', cartaoId: 'nao_existe', contaId: null }],
]) {
  test(`entrada inválida (${nome}): recusa, avisa e NÃO mexe em nada`, () => {
    const m = mundo();
    const rel = executar(m, { nome: `tg ${nome}`, fn: aplicar([item(despesa(m, extra))]) });
    assert.equal(problemas(rel, { deveRecusar: true, semMudarPatrimonio: true }), '');
  });
}

test('data inválida não trava a tela: cai na data de hoje', () => {
  const m = mundo();
  const rel = executar(m, {
    nome: 'tg data abacaxi',
    fn: aplicar([item(despesa(m, { dataCompra: 'abacaxi' }))]),
  });
  assert.equal(problemas(rel, { deltaPatrimonio: -52.9 }), '');
});

test('conta apagada entre a mensagem e a aplicação: usa a principal, sem bucket órfão', () => {
  const m = mundo();
  const rel = executar(m, {
    nome: 'tg conta sumiu',
    fn: aplicar([item(despesa(m, { contaId: 'conta_apagada', banco: '' }))]),
  });
  assert.equal(problemas(rel, { deltaPatrimonio: -52.9 }), '');
});

test('duplo envio (confirmação perdida): a segunda aplicação não mexe em nada', () => {
  const m = mundo();
  const it = item(despesa(m));
  executar(m, { nome: 'tg 1ª', fn: aplicar([it]) });
  const rel = executar(m, { nome: 'tg 2ª', fn: aplicar([it]) });
  assert.equal(problemas(rel, { semMudarPatrimonio: true }), '');
  assert.equal(rel.mudou, false);
});

test('Desfazer devolve exatamente o que saiu', () => {
  const m = mundo();
  const it = item(despesa(m, { valor: 120 }));
  executar(m, { nome: 'tg lança', fn: aplicar([it]) });
  const rel = executar(m, {
    nome: 'tg desfaz',
    fn: aplicar([{ id: `desfazer_${it.id}`, tipo: 'desfazer', alvo: it.id, criadoEmMs: 999 }]),
  });
  assert.equal(problemas(rel, { deltaPatrimonio: 120 }), '');
});

test('Desfazer de algo que nunca entrou não mexe em nada nem em lançamento alheio', () => {
  const m = mundo();
  const rel = executar(m, {
    nome: 'tg desfaz fantasma',
    fn: aplicar([{ id: 'desfazer_tg1_x', tipo: 'desfazer', alvo: 'sim', criadoEmMs: 1 }]),
  });
  // Regressão real: `alvo: 'sim'` casava por prefixo com sim_receita e o
  // Desfazer apagava o salário (delta -8000). Alvo fora do formato
  // tg<chat>_<msg> é recusado antes de tocar em qualquer transação.
  assert.equal(problemas(rel, { semMudarPatrimonio: true }), '');
});
