/**
 * Appliquei — Contas / Instituições financeiras (entidade central).
 *
 * Objetivo de longo prazo: toda entrada e saída de dinheiro passa por uma
 * instituição. Hoje isso é representado por dois campos de TEXTO LIVRE —
 * `banco` (em transacoes) e `corretora` (em historicoCompras) — reconciliados
 * por nome na hora de renderizar o "Por instituição". Esta entidade introduz um
 * cadastro-mestre com identidade estável (`contaId`) para substituir, em fases,
 * esses strings. Ver docs/CONTAS-INSTITUICOES.md para o plano completo.
 *
 * FASE 1 (esta) — fundação NÃO-QUEBRA. O módulo é inerte para os cálculos:
 *   (a) mantém o array global `contas` em localStorage `appliquei_contas`
 *       (auto-sincronizado pelo cloud-sync, que espelha chaves appliquei_*);
 *   (b) faz um seed idempotente criando uma Conta para cada instituição já
 *       citada nos dados do usuário (corretora/banco).
 * NENHUM caminho de saldo foi alterado, e os campos `banco`/`corretora`
 * continuam sendo a fonte de verdade. O switch dos cálculos vem na Fase 2.
 *
 * Classic script: carregado logo DEPOIS de appliquei-app.js (que define
 * `transacoes` e `historicoCompras`). Top-level usa só `var` (vira window.*).
 */

// Estado global — mesmo molde de transacoes/cartoes (appliquei-app.js).
var contas = (function () {
  try {
    var arr = JSON.parse(localStorage.getItem('appliquei_contas'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
})();

// Tipos suportados. 'carteira' cobre dinheiro físico / carteira digital sem
// instituição formal; 'outro' é escape para casos não previstos.
var CONTA_TIPOS = [
  { v: 'banco', label: '🏦 Banco' },
  { v: 'corretora', label: '📈 Corretora' },
  { v: 'carteira', label: '👛 Carteira / Dinheiro' },
  { v: 'outro', label: '🔖 Outro' },
];

// Persistência local pura (sem forçar flush) — usada no seed de boot, antes do
// cloud-sync estar pronto. CRUD disparado pelo usuário usa salvarContas().
function persistirContasLocal() {
  try {
    localStorage.setItem('appliquei_contas', JSON.stringify(contas));
  } catch (e) {
    if (window.console) console.error('[contas] localStorage', e);
  }
}

function salvarContas() {
  persistirContasLocal();
  try {
    if (window.AppliqueiCloudSync && typeof AppliqueiCloudSync.forceFlush === 'function') {
      AppliqueiCloudSync.forceFlush();
    }
  } catch (e) {}
}

// Normaliza nome para comparação/dedup: sem acento, minúsculo, espaços únicos.
// Mesma regra de mpNormalizarInstituicao (patrimonio.js) — mantida aqui para o
// módulo ser autossuficiente; as duas convergem para o mesmo `key`.
function appliqueiNormalizarNomeConta(nome) {
  return (nome || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
}

function contasAtivas() {
  return contas.filter(function (c) {
    return !c.arquivada;
  });
}

function obterConta(id) {
  if (!id) return null;
  return (
    contas.find(function (c) {
      return c.id === id;
    }) || null
  );
}

// Busca uma conta pelo nome (normalizado). Retorna a conta ou null.
function obterContaPorNome(nome) {
  const key = appliqueiNormalizarNomeConta(nome);
  if (!key) return null;
  return (
    contas.find(function (c) {
      return appliqueiNormalizarNomeConta(c.nome) === key;
    }) || null
  );
}

// Cria e persiste uma conta. `dados`: {nome, tipo, saldoInicial, dataSaldoInicial, cor}.
function criarConta(dados) {
  dados = dados || {};
  const nome = (dados.nome || '').trim();
  if (!nome) return null;
  const agora = new Date().toISOString();
  const nova = {
    id: 'conta_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    nome: nome,
    tipo: dados.tipo || 'banco',
    saldoInicial: Number(dados.saldoInicial) || 0,
    dataSaldoInicial: dados.dataSaldoInicial || null,
    cor: dados.cor || null,
    arquivada: false,
    criadaEm: agora,
    atualizadaEm: agora,
  };
  contas.push(nova);
  salvarContas();
  return nova;
}

// Idempotente: devolve a conta existente com aquele nome ou cria uma nova.
function obterOuCriarContaPorNome(nome, tipo) {
  const existente = obterContaPorNome(nome);
  if (existente) return existente;
  return criarConta({ nome: nome, tipo: tipo || 'banco' });
}

function editarConta(id, patch) {
  const c = obterConta(id);
  if (!c) return null;
  patch = patch || {};
  if (patch.nome != null) c.nome = String(patch.nome).trim() || c.nome;
  if (patch.tipo != null) c.tipo = patch.tipo;
  if (patch.saldoInicial != null) c.saldoInicial = Number(patch.saldoInicial) || 0;
  if (patch.dataSaldoInicial !== undefined) c.dataSaldoInicial = patch.dataSaldoInicial;
  if (patch.cor !== undefined) c.cor = patch.cor;
  if (patch.arquivada != null) c.arquivada = !!patch.arquivada;
  c.atualizadaEm = new Date().toISOString();
  salvarContas();
  return c;
}

function arquivarConta(id) {
  return editarConta(id, { arquivada: true });
}

// === Seed/backfill idempotente (Fase 1) ===
// Cria uma Conta para cada instituição já citada nos dados do usuário:
//   - `corretora` em historicoCompras → tipo 'corretora'
//   - `banco` em transacoes           → tipo 'banco'
// NÃO carimba contaId nos registros nem mexe em futurorico_* — isso é Fase 2.
// Usa obterOuCriarContaPorNome (dedup), logo é seguro rodar mais de uma vez.
// Retorna quantas contas foram criadas.
function appliqueiSeedContasDeStrings() {
  const nomesCorretora = {};
  const nomesBanco = {};
  try {
    if (typeof historicoCompras !== 'undefined' && Array.isArray(historicoCompras)) {
      historicoCompras.forEach(function (op) {
        const n = op && op.corretora ? String(op.corretora).trim() : '';
        if (n) nomesCorretora[appliqueiNormalizarNomeConta(n)] = n;
      });
    }
    if (typeof transacoes !== 'undefined' && Array.isArray(transacoes)) {
      transacoes.forEach(function (t) {
        const n = t && t.banco ? String(t.banco).trim() : '';
        if (n) nomesBanco[appliqueiNormalizarNomeConta(n)] = n;
      });
    }
  } catch (e) {
    return 0;
  }
  const antes = contas.length;
  Object.keys(nomesCorretora).forEach(function (k) {
    obterOuCriarContaPorNome(nomesCorretora[k], 'corretora');
  });
  Object.keys(nomesBanco).forEach(function (k) {
    obterOuCriarContaPorNome(nomesBanco[k], 'banco');
  });
  return contas.length - antes;
}

// Executa o seed uma vez por dispositivo, MAS só "trava" a flag quando havia
// dados de onde semear. Isso cobre a corrida em que o classic script roda antes
// do cloud-sync puxar o Firestore (localStorage ainda vazio): sem dados, a flag
// não é setada e o seed roda de novo no próximo boot, já com os dados puxados.
// Quando a flag está setada, não re-semeia — respeita edições futuras de conta.
(function seedContasBoot() {
  try {
    if (localStorage.getItem('appliquei_contas_seed_v1')) return;
    const temDados =
      (typeof historicoCompras !== 'undefined' && (historicoCompras || []).length > 0) ||
      (typeof transacoes !== 'undefined' && (transacoes || []).length > 0);
    const criadas = appliqueiSeedContasDeStrings();
    if (criadas > 0) persistirContasLocal();
    if (temDados) localStorage.setItem('appliquei_contas_seed_v1', '1');
  } catch (e) {}
})();

// Contrato público explícito em window (classic script já vaza var; deixamos
// claro o que o módulo expõe para os demais arquivos e para a Fase 2).
if (typeof window !== 'undefined') {
  window.contas = contas;
  window.CONTA_TIPOS = CONTA_TIPOS;
  window.salvarContas = salvarContas;
  window.criarConta = criarConta;
  window.obterConta = obterConta;
  window.obterContaPorNome = obterContaPorNome;
  window.obterOuCriarContaPorNome = obterOuCriarContaPorNome;
  window.editarConta = editarConta;
  window.arquivarConta = arquivarConta;
  window.contasAtivas = contasAtivas;
  window.appliqueiNormalizarNomeConta = appliqueiNormalizarNomeConta;
  window.appliqueiSeedContasDeStrings = appliqueiSeedContasDeStrings;
}
