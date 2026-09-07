'use strict';

/**
 * Editar um lançamento de sonho pela aba Controle Financeiro.
 *
 * O DEFEITO QUE ORIGINOU ISTO. O <select> de classificação do painel de
 * lançamento oferece receita, despesa fixa, despesa variável e cartão — não
 * existe opção "sonho". Abrir um compromisso de sonho para editar fazia
 * `select.value = 'sonho'` não casar com nada, o campo voltava para
 * "Selecione..." e a validação passava a EXIGIR uma classificação. Qualquer
 * uma que o usuário escolhesse para conseguir salvar transformava o aporte em
 * despesa: contava como gasto no DRE, o `valorAtual` do sonho não acompanhava,
 * e o registro dentro do sonho ficava com o valor velho. Sonho e Controle
 * divergiam em silêncio.
 *
 * O CONTRATO AGORA. Editando um lançamento de sonho, o formulário encolhe para
 * valor e data; a classificação não é perguntada porque já está decidida. E o
 * salvamento passa pelo MESMO funil do modal da aba Sonhos
 * (`aplicarEdicaoAporteSonho`), para que a guarda de saldo, o `valorAtual` e o
 * recálculo do plano não existam em duas versões.
 *
 * Ver .claude/skills/simular-acao/SKILL.md.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { criarMundo, executar, problemas } = require('./_simulador.js');

const parcelaFutura = (s) =>
  s.transacoes.find((t) => t.categoria === 'sonho' && !t.pago && !t.aporteExtra);

/** Abre a edição do lançamento no painel, preenche e salva — como o usuário. */
function editarPeloControle(m, txId, valor, data) {
  return executar(m, {
    nome: 'editar lançamento de sonho pelo Controle',
    fn: (s) => {
      s.prepararEdicao(txId);
      m.campos.valorTransacao = valor;
      m.campos.dataVencimento = data || '';
      s.tentarSalvarTransacao();
    },
  });
}

/** Paga a parcela pelo valor planejado — confirmarPagamento lê input-pago-<id>. */
function pagar(m, tx) {
  m.campos['input-pago-' + tx.id] = String(tx.valor);
  m.s.confirmarPagamento(tx.id);
  return m.s.transacoes.find((t) => t.id === tx.id);
}

// ---------------------------------------------------------------------------

test('o lançamento continua sendo sonho — nunca vira despesa', () => {
  const m = criarMundo();
  const alvo = parcelaFutura(m.s);
  const rel = editarPeloControle(m, alvo.id, '2.000,00');

  const tx = m.s.transacoes.find((t) => t.id === alvo.id);
  assert.equal(problemas(rel), '');
  assert.equal(tx.categoria, 'sonho', 'a classificação não pode ser reescrita pela edição');
  assert.ok(tx.sonhoId, 'o vínculo com o sonho tem de sobreviver');
  assert.equal(tx.valor, 2000);
});

test('editar não exige categoria, descrição nem banco', () => {
  // A validação genérica pedia os três. Com o formulário encolhido ela não
  // pode disparar — se disparar, o usuário fica preso sem campo para preencher.
  const m = criarMundo();
  const alvo = parcelaFutura(m.s);
  m.campos.descTransacao = '';
  m.campos.categoriaTransacao = '';
  m.campos.bancoTransacao = '';
  const rel = editarPeloControle(m, alvo.id, '1.500,00');

  assert.equal(rel.recusou, false, 'toasts de erro: ' + JSON.stringify(rel.toasts));
  assert.equal(m.s.transacoes.find((t) => t.id === alvo.id).valor, 1500);
});

test('parcela FUTURA: muda só o mês editado, sem mexer no guardado', () => {
  // Nada saiu do caixa ainda — `valorAtual` não pode se mover.
  const m = criarMundo();
  const guardadoAntes = m.s.sonhos[0].valorAtual;
  const alvo = parcelaFutura(m.s);

  const rel = editarPeloControle(m, alvo.id, '700,00');
  assert.equal(problemas(rel), '');
  assert.equal(m.s.transacoes.find((t) => t.id === alvo.id).valor, 700);
  assert.equal(
    m.s.sonhos[0].valorAtual,
    guardadoAntes,
    'parcela planejada não é dinheiro guardado'
  );
  assert.equal(rel.deltaPatrimonio, 0, 'planejar não move patrimônio');
});

test('parcela PAGA: o guardado do sonho acompanha o novo valor (INV-14)', () => {
  const m = criarMundo();
  const paga = pagar(m, parcelaFutura(m.s));
  const guardadoAposPagar = m.s.sonhos[0].valorAtual;

  const rel = editarPeloControle(m, paga.id, '2.000,00');
  assert.equal(problemas(rel), '');
  assert.equal(
    m.s.sonhos[0].valorAtual,
    guardadoAposPagar + 1000,
    'guardar mais R$ 1.000 tem de aparecer no sonho, senão a barra de progresso mente'
  );
  const aporte = m.s.sonhos[0].aportes.find((a) => a.txId === paga.id);
  assert.equal(aporte.valor, 2000, 'INV-11: o aporte e a transação não podem divergir');
});

test('parcela PAGA: diminuir devolve dinheiro e nunca é bloqueado', () => {
  const m = criarMundo();
  const paga = pagar(m, parcelaFutura(m.s));
  const guardado = m.s.sonhos[0].valorAtual;

  const rel = editarPeloControle(m, paga.id, '400,00');
  assert.equal(problemas(rel), '');
  assert.equal(m.s.sonhos[0].valorAtual, guardado - 600);
});

test('aumentar acima do saldo é recusado sem mexer em nada', () => {
  // A guarda de saldo vive no funil, não no formulário — este é o caminho que
  // não passa pelo modal da aba Sonhos e mesmo assim tem de respeitá-la.
  const m = criarMundo();
  const paga = pagar(m, parcelaFutura(m.s));
  const rel = editarPeloControle(m, paga.id, '900.000,00');

  assert.equal(rel.recusou, true, 'tirar mais do que há na conta inventa dinheiro');
  assert.equal(rel.fantasma, false, 'recusar e gravar assim mesmo é o pior dos dois mundos');
  assert.equal(problemas(rel, { deveRecusar: true }), '');
});

test('valor inválido é recusado em todas as formas', () => {
  for (const entrada of ['0,00', '', '-500,00']) {
    const m = criarMundo();
    const alvo = parcelaFutura(m.s);
    const valorAntes = alvo.valor;
    const rel = editarPeloControle(m, alvo.id, entrada);

    assert.equal(rel.recusou, true, 'aceitou "' + entrada + '"');
    assert.equal(rel.fantasma, false, 'mutação fantasma com "' + entrada + '"');
    assert.equal(m.s.transacoes.find((t) => t.id === alvo.id).valor, valorAntes);
  }
});

test('parcela planejada não pode ultrapassar o que falta para a meta', () => {
  // Um dígito a mais (R$ 999.999.999 numa meta de R$ 12.000) inflaria o "a
  // pagar" do mês inteiro no Controle. Aporte JÁ PAGO pode passar da meta — a
  // realidade ultrapassa, o plano não.
  const m = criarMundo();
  const alvo = parcelaFutura(m.s);
  const rel = editarPeloControle(m, alvo.id, '999.999.999,00');
  assert.equal(rel.recusou, true);
  assert.equal(rel.fantasma, false);

  const m2 = criarMundo();
  const s2 = m2.s.sonhos[0];
  const falta = s2.valorTotal - s2.valorAtual;
  const rel2 = editarPeloControle(m2, parcelaFutura(m2.s).id, String(falta));
  assert.equal(rel2.recusou, false, 'quitar o sonho de uma vez é legítimo');
});

test('mover para um mês que já tem parcela é recusado antes de gravar (INV-13)', () => {
  // Duas parcelas do mesmo sonho na mesma competência dobram o "a pagar"
  // daquele mês. A caça de sequências achou esta colisão.
  const m = criarMundo();
  const parcelas = m.s.transacoes
    .filter((t) => t.categoria === 'sonho' && !t.aporteExtra)
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes);
  const primeira = parcelas[0];
  const segunda = parcelas[1];

  const rel = editarPeloControle(m, segunda.id, '900,00', primeira.dataVencimento);
  assert.equal(rel.recusou, true, 'aceitou empilhar duas parcelas no mesmo mês');
  assert.equal(rel.fantasma, false);
  assert.equal(problemas(rel, { deveRecusar: true }), '');
});

test('mudar a data leva a competência junto', () => {
  // A tela do Controle desenha por t.mes/t.ano. Gravar só dataVencimento
  // deixaria o lançamento no mês antigo com a data nova.
  const m = criarMundo();
  const alvo = parcelaFutura(m.s);
  const livre = '2028-07-15';

  const rel = editarPeloControle(m, alvo.id, '900,00', livre);
  assert.equal(problemas(rel), '');
  const tx = m.s.transacoes.find((t) => t.id === alvo.id);
  assert.equal(tx.dataVencimento, livre);
  assert.equal(tx.mes, 6, 'julho');
  assert.equal(tx.ano, 2028);
});

test('a parcela editada à mão sobrevive ao recálculo do plano', () => {
  // `removerLancamentosFuturosSonho` varre as parcelas futuras não pagas. Sem
  // proteção, ajustar um mês futuro e depois pagar qualquer outra parcela
  // apagava a edição em silêncio.
  const m = criarMundo();
  const futuras = m.s.transacoes
    .filter((t) => t.categoria === 'sonho' && !t.pago && !t.aporteExtra)
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes);
  const editada = futuras[futuras.length - 1];

  editarPeloControle(m, editada.id, '250,00');
  m.s.removerLancamentosFuturosSonho(m.s.sonhos[0].id);

  const sobreviveu = m.s.transacoes.find((t) => t.id === editada.id);
  assert.ok(sobreviveu, 'o mês editado à mão foi apagado pelo recálculo');
  assert.equal(sobreviveu.valor, 250);
});

test('duplo clique no salvar não dispara o erro do formulário antigo', () => {
  // O primeiro clique grava e limpa editTransacaoId; o segundo caía na
  // validação genérica e mostrava "escolha uma Classificação Contábil válida"
  // — num formulário que nem tem esse campo.
  const m = criarMundo();
  const alvo = parcelaFutura(m.s);
  const rel = executar(m, {
    nome: 'duplo clique',
    fn: (s) => {
      s.prepararEdicao(alvo.id);
      m.campos.valorTransacao = '2.000,00';
      s.tentarSalvarTransacao();
      s.tentarSalvarTransacao();
    },
  });

  assert.equal(problemas(rel), '');
  assert.equal(rel.recusou, false, 'toasts: ' + JSON.stringify(rel.toasts));
  assert.equal(m.s.transacoes.find((t) => t.id === alvo.id).valor, 2000);
});

test('os dois formulários usam o mesmo funil', () => {
  // Se a aba Sonhos e a aba Controle tiverem cada uma o seu caminho, a guarda
  // de saldo acaba existindo só num deles — foi assim que a edição pelo
  // Controle passou a transformar aporte em despesa.
  const m = criarMundo();
  assert.equal(typeof m.s.aplicarEdicaoAporteSonho, 'function', 'falta o funil compartilhado');
  assert.equal(typeof m.s.editarLancamentoSonhoPorTransacao, 'function');

  const fonte = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'web/appliquei-aba-controle-financeiro.js'),
    'utf8'
  );
  assert.match(
    fonte,
    /editarLancamentoSonhoPorTransacao\(/,
    'o Controle tem de delegar ao funil, não escrever em transacoes por conta própria'
  );
});
