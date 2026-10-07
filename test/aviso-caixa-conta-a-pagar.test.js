'use strict';

/**
 * O aviso de "vou ficar sem dinheiro" precisa contar a conta a pagar que
 * ainda não tem conta escolhida.
 *
 * ═══ O DEFEITO ═══
 *
 * Relato, com print: saldo em conta de R$ 303,69, sete vencimentos somando
 * R$ 3.434,90 — três deles no dia seguinte — e o salário só no dia 15. A tela
 * dizia "Nada fora do padrão neste mês".
 *
 * `insightsUiFonteDeSaldo()` exigia zero dinheiro fora de conta cadastrada nas
 * DUAS pontas da janela: hoje e daqui a 45 dias. A ponta de hoje é a certa —
 * é lá que mora o gasto já pago sem dono, que faz o balde `a-reconciliar`
 * ficar negativo por construção e inventaria um rombo.
 *
 * A ponta do futuro calava o alerta exatamente no caso para o qual ele existe:
 * uma conta a pagar NASCE sem conta escolhida (só se diz de onde sai ao clicar
 * "Baixar"), cai em `a-reconciliar`, e um único boleto bastava para desligar o
 * detector inteiro — em silêncio.
 *
 * Medido no navegador, mesmo saldo e mesmos vencimentos:
 *   com a conta escolhida → fura em 1 dia, pior R$ -1.126
 *   sem a conta escolhida → detector desligado, nenhum aviso
 *
 * ═══ O CONTRATO ═══
 *
 * Fora de conta na FOTO DE HOJE é fantasma contábil: recusa projetar.
 * Fora de conta NO FUTURO é agendamento sem dono: pesa na projeção, porque
 * esse dinheiro vai mesmo sair de uma conta real.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const FONTE = fs.readFileSync(path.join(ROOT, 'web/appliquei-insights-ui.js'), 'utf8');
const AGORA = Date.now();
const DIA = 86400000;

/**
 * Monta o módulo com um `saldoCaixaPorConta` de mentira, que é o único dado
 * que a função sob teste consome. `baldes(ms)` devolve o mapa daquele dia.
 */
function comSaldos(baldes, contas) {
  const ctx = {
    document: { getElementById: () => null },
    window: { AppliqueiInsightsUI: {}, AppliqueiInsights: { LIMIARES: { diasJanelaAperto: 45 } } },
    console: { log() {}, warn() {}, error() {} },
    saldoCaixaPorConta: baldes,
    contasAtivas: () => contas || [{ id: 'conta_nu', nome: 'Nubank' }],
    setTimeout,
    clearTimeout,
    Object,
    Array,
    String,
    Number,
    Math,
    JSON,
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx, { filename: 'web/appliquei-insights-ui.js' });
  return {
    fonte: () => vm.runInContext('insightsUiFonteDeSaldo()', ctx),
    motivo: () => vm.runInContext('insightsUiMotivoSemProjecao', ctx),
  };
}

/** O cenário do relato: R$ 303,69 hoje, R$ 1.430 vencendo antes do salário. */
function cenarioDoRelato({ comDono }) {
  return (ms) => {
    const d = Math.round((ms - AGORA) / DIA);
    const contas = { conta_nu: 303.69 };
    const fora = {};
    let saida = 0;
    if (d >= 1) saida += 770; // Enel + Gás + Condomínio, dia 10
    if (d >= 3) saida += 659.9; // Plano de saúde, dia 12
    const entrada = d >= 6 ? 6700 : 0; // salário, dia 15
    if (comDono) contas.conta_nu += entrada - saida;
    else {
      contas.conta_nu += entrada;
      if (saida) fora['a-reconciliar'] = -saida;
    }
    return Object.assign(contas, fora);
  };
}

test('vencimento sem conta escolhida ainda derruba o saldo projetado', () => {
  // O DEFEITO. Antes: fonte === null e nenhum aviso.
  const m = comSaldos(cenarioDoRelato({ comDono: false }));
  const saldoEm = m.fonte();
  assert.equal(typeof saldoEm, 'function', 'o detector foi desligado por um boleto sem conta');
  assert.equal(Math.round(saldoEm(AGORA)), 304, 'hoje é o que existe em conta');
  assert.equal(Math.round(saldoEm(AGORA + DIA)), -466, 'amanhã vencem R$ 770');
  assert.equal(Math.round(saldoEm(AGORA + 3 * DIA)), -1126, 'e mais R$ 659,90 no dia 12');
  assert.ok(saldoEm(AGORA + 6 * DIA) > 0, 'o salário do dia 15 recupera');
});

test('a projeção dá o mesmo número com e sem a conta escolhida', () => {
  // Quem paga a conta é a pessoa, não o cadastro. O aviso não pode depender
  // de um campo que só é preenchido na hora de baixar o lançamento.
  const comDono = comSaldos(cenarioDoRelato({ comDono: true })).fonte();
  const semDono = comSaldos(cenarioDoRelato({ comDono: false })).fonte();
  for (const d of [0, 1, 3, 6, 10]) {
    assert.equal(
      Math.round(comDono(AGORA + d * DIA)),
      Math.round(semDono(AGORA + d * DIA)),
      'divergiu no dia +' + d
    );
  }
});

test('gasto JÁ PAGO sem dono continua barrando a projeção', () => {
  // A proteção original, intacta: o dinheiro saiu de alguma conta real que
  // não sabemos qual, o balde é fantasma, e projetar sobre ele inventa rombo.
  const m = comSaldos((ms) => ({ conta_nu: 303.69, 'a-reconciliar': -500 }));
  assert.equal(m.fonte(), null);
  assert.equal(m.motivo(), 'sem_dono');
});

test('sem conta cadastrada não há o que projetar — e o motivo fica registrado', () => {
  const m = comSaldos(() => ({}), []);
  assert.equal(m.fonte(), null);
  assert.equal(m.motivo(), 'sem_contas');
});

test('a recusa é explicada na tela, nunca silenciosa', () => {
  // Sem isto a tela seguia dizendo "Nada fora do padrão neste mês" — que lê
  // como "está tudo bem" quando o app na verdade desistiu de olhar o caixa.
  const codigo = FONTE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.match(codigo, /function insightsUiSemProjecao/, 'falta o cartão que explica a recusa');
  assert.match(
    codigo,
    /noMesCorrente && !saldoEm && insightsUiMotivoSemProjecao/,
    'o render precisa consultar o motivo da recusa'
  );
  assert.match(FONTE, /Não consigo prever o seu caixa/, 'falta a frase que o usuário lê');
});

test('a guarda do futuro não pode voltar', () => {
  const codigo = FONTE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(
    !/separar\(agora \+ janela/.test(codigo),
    'voltou a checar a ponta futura — é ela que cala o aviso no caso que importa'
  );
  assert.match(
    codigo,
    /s\.emContas \+ \(s\.foraDeConta - foraHoje\)/,
    'a projeção precisa somar o que está agendado sem conta escolhida'
  );
});
