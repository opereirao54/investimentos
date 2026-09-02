/**
 * Appliquei — Guia de primeiros passos.
 *
 * O app abre vazio duas vezes na vida de uma pessoa: no primeiro acesso e
 * logo depois do "Recomeçar do zero". Nas duas a tela não diz por onde
 * começar, e a dúvida que aparece é sempre a mesma:
 *
 *   "preciso criar uma conta em Meu patrimônio para poder cadastrar uma
 *    despesa? e para a receita, também preciso?"
 *
 * A resposta é NÃO, e ela está no código: o campo "Banco / instituição" do
 * lançamento é texto livre, e executarInsercao() passa o que foi digitado
 * por obterOuCriarContaPorNome() — a conta nasce ali, no ato. Cadastrar
 * antes serve para outra coisa: informar o saldo que a pessoa JÁ tinha, para
 * o "Meu patrimônio" não mostrar caixa negativo na primeira despesa paga.
 *
 * Ninguém adivinha isso olhando para uma tela vazia. Este módulo diz em voz
 * alta e leva pela mão, com duas peças:
 *
 *   1. Modal de boas-vindas — só aparece com o app vazio. Responde à dúvida
 *      em uma frase e oferece as duas saídas: SEGUIR O GUIA ou PULAR.
 *   2. Cartão "Primeiros passos" — checklist no topo do conteúdo, um botão
 *      por passo que navega até a tela certa e já abre o formulário certo.
 *
 * Os passos marcam-se sozinhos a partir dos DADOS, nunca de cliques: quem
 * importa um backup, ou lança por fora do guia, encontra tudo já concluído.
 * É também o que faz o passo 1 marcar-se sozinho quando a pessoa lança a
 * receita primeiro — a demonstração de que a conta não precisava vir antes.
 *
 * Estado em `appliquei_primeiros_passos`, sincronizado como qualquer chave
 * appliquei_* (quem pulou no celular não reencontra o guia no PC) e FORA da
 * lista preservada do reset — é isso que faz o guia voltar ao zerar.
 *
 * Classic script: `var` no top-level, funções viram globais (o HTML chama
 * ppPularGuia() e companhia por onclick).
 */

var PP_CHAVE = 'appliquei_primeiros_passos';
var PP_VERSAO = 1;

// Marca deixada por executarRecomecarDoZero() antes do reload. sessionStorage
// e não localStorage de propósito: é um recado de uma aba para ela mesma, que
// não deve subir para a nuvem nem reaparecer no outro aparelho.
var PP_MARCA_POS_RESET = 'appliquei_pp_pos_reset';

// Teto da espera pelo pull inicial da nuvem. Decidir "o app está vazio" antes
// de o Firestore responder faria o guia piscar na cara de quem só trocou de
// aparelho — e o pull termina com um reload, então o piscar seria visível.
var PP_ESPERA_NUVEM_MS = 25000;
var PP_INTERVALO_MS = 700;

// Teto absoluto do vigia. Ele existe para o caso de a pessoa deixar a aba
// aberta na tela de login: sem isto o intervalo ficaria a rodar para sempre.
var PP_ESPERA_MAXIMA_MS = 10 * 60 * 1000;

var _ppIniciado = false;
var _ppTimerEspera = null;
var _ppVigiaDesde = 0;
var _ppLiberadoDesde = 0;
var _ppAuthResolvida = false;
var _ppRedesenhoTimer = null;

// ============================================================
// --- Estado persistido ---
// ============================================================

// 'pendente'  — nunca respondeu ao convite (é o estado de quem acabou de
//               chegar e o de quem acabou de zerar, porque o reset apaga a chave)
// 'guiando'   — aceitou o guia; o cartão de passos fica visível
// 'pulado'    — dispensou; nada aparece, e ele reabre por Configurações
// 'concluido' — fez os passos essenciais
function ppLerEstado() {
  var vazio = { v: PP_VERSAO, estado: 'pendente' };
  try {
    var bruto = localStorage.getItem(PP_CHAVE);
    if (!bruto) return vazio;
    var o = JSON.parse(bruto);
    if (!o || typeof o !== 'object') return vazio;
    var e = o.estado;
    if (e !== 'guiando' && e !== 'pulado' && e !== 'concluido') e = 'pendente';
    return { v: Number(o.v) || PP_VERSAO, estado: e };
  } catch (_) {
    return vazio;
  }
}

function ppEstadoAtual() {
  return ppLerEstado().estado;
}

function ppGravarEstado(estado) {
  try {
    localStorage.setItem(
      PP_CHAVE,
      JSON.stringify({ v: PP_VERSAO, estado: estado, em: new Date().toISOString() })
    );
  } catch (_) {}
  return estado;
}

// ============================================================
// --- Leitura dos dados (a fonte de verdade dos passos) ---
// ============================================================

// Prefere o array global (já em memória, e é ele que as telas mostram) e cai
// para o localStorage quando o global ainda não existe — é o que permite
// testar as regras sem carregar o app inteiro.
function _ppLista(nomeGlobal, chave) {
  try {
    var g = typeof window !== 'undefined' ? window[nomeGlobal] : undefined;
    if (Array.isArray(g)) return g;
  } catch (_) {}
  try {
    var arr = JSON.parse(localStorage.getItem(chave) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function ppTransacoes() {
  return _ppLista('transacoes', 'futurorico_transacoes');
}
function ppContas() {
  return _ppLista('contas', 'appliquei_contas');
}
function ppOperacoes() {
  return _ppLista('historicoCompras', 'futurorico_compras');
}
function ppBens() {
  return _ppLista('bens', 'appliquei_bens');
}
function ppSonhos() {
  return _ppLista('sonhos', 'appliquei_sonhos');
}

// Conta ARQUIVADA continua sendo cadastro feito — o passo não desmarca por
// causa de uma arrumação de casa.
function ppTemConta() {
  return ppContas().length > 0;
}

function ppTemReceita() {
  return ppTransacoes().some(function (t) {
    return t && t.categoria === 'receita';
  });
}

// Saída do mês, em qualquer das três formas que o Controle aceita.
var PP_CATEGORIAS_DESPESA = ['despesa_fixa', 'despesa_variavel', 'cartao_credito'];
function ppTemDespesa() {
  return ppTransacoes().some(function (t) {
    return t && PP_CATEGORIAS_DESPESA.indexOf(t.categoria) !== -1;
  });
}

function ppTemInvestimento() {
  return ppOperacoes().length > 0;
}

// "Vazio" tem de ser generoso: qualquer registro do usuário desqualifica o
// convite. `cartoes` fica DE FORA de propósito — appliquei-app.js semeia um
// "Cartão principal" no boot de todo mundo, e usá-lo aqui esconderia o guia
// exatamente de quem mais precisa dele.
function ppAppVazio() {
  return (
    ppTransacoes().length === 0 &&
    ppOperacoes().length === 0 &&
    ppContas().length === 0 &&
    ppBens().length === 0 &&
    ppSonhos().length === 0
  );
}

// ============================================================
// --- Os passos ---
// ============================================================
//
// Três essenciais + um opcional. A ordem é a do dinheiro: onde ele está,
// de onde vem, para onde vai. O passo da conta é `recomendado` e não
// obrigatório porque de fato não é — está aqui pelo saldo de abertura,
// e o próprio cartão diz isso.
function ppPassos() {
  return [
    {
      id: 'conta',
      icone: 'ph-bank',
      titulo: 'Diga onde seu dinheiro está hoje',
      texto:
        'Cadastre suas contas (Nubank, Itaú, a carteira do dia a dia) com o saldo que você tem <strong>neste momento</strong>. É isso que faz o Meu patrimônio começar com o número certo.',
      selo: 'Recomendado',
      acao: 'Cadastrar conta',
      feito: ppTemConta(),
      essencial: true,
    },
    {
      id: 'receita',
      icone: 'ph-arrow-down-left',
      titulo: 'Lance a sua receita',
      texto:
        'Salário, pró-labore, aluguel recebido. Basta digitar o nome do banco onde o dinheiro cai — <strong>não precisa ter cadastrado a conta antes</strong>.',
      selo: '',
      acao: 'Lançar receita',
      feito: ppTemReceita(),
      essencial: true,
    },
    {
      id: 'despesa',
      icone: 'ph-arrow-up-right',
      titulo: 'Lance uma despesa',
      texto:
        'Aluguel, mercado, energia ou uma compra no cartão. Escolha de qual banco o dinheiro sai e a Appliquei desconta do saldo daquela conta.',
      selo: '',
      acao: 'Lançar despesa',
      feito: ppTemDespesa(),
      essencial: true,
    },
    {
      id: 'investimento',
      icone: 'ph-trend-up',
      titulo: 'Registre o que você já tem investido',
      texto:
        'Ações, fundos, Tesouro, cripto. Na origem do recurso escolha <strong>“Investimento já existente”</strong> para cadastrar sem descontar de nenhuma conta.',
      selo: 'Opcional',
      acao: 'Registrar investimento',
      feito: ppTemInvestimento(),
      essencial: false,
    },
  ];
}

function ppProgresso() {
  var passos = ppPassos();
  var essenciais = passos.filter(function (p) {
    return p.essencial;
  });
  return {
    feitos: essenciais.filter(function (p) {
      return p.feito;
    }).length,
    total: essenciais.length,
  };
}

function ppEssenciaisConcluidos() {
  var p = ppProgresso();
  return p.total > 0 && p.feitos >= p.total;
}

// ============================================================
// --- Quem aparece, e quando ---
// ============================================================

// Nada de guia por cima do login nem do bloqueio de assinatura: são telas
// modais com z-index acima de tudo, e o guia por baixo delas só assustaria.
function ppAppLiberado() {
  try {
    var gate = document.getElementById('authGate');
    if (gate && gate.style && gate.style.display && gate.style.display !== 'none') return false;
    var billing = document.getElementById('billingGate');
    if (billing && billing.style && billing.style.display === 'block') return false;
  } catch (_) {}
  return true;
}

// Vale a pena esperar a nuvem antes de decidir?
//
// Só quando existe um pull a caminho. Há três maneiras de não existir, e as
// três precisam devolver `true` — esperar por um pull que nunca vem seria
// esconder o guia justamente de quem está sozinho com o app vazio:
//   · não há cloud-sync nesta página;
//   · o Firebase não subiu (sem configuração, CDN fora do ar);
//   · o Firebase respondeu e não há ninguém autenticado.
function ppNuvemRespondeu() {
  try {
    var cs = window.AppliqueiCloudSync;
    if (!cs || typeof cs.pullInicialConcluido !== 'function') return true;
    if (cs.pullInicialConcluido() === true) return true;
    var fb = window.AppliqueiFirebase;
    if (!fb || !fb.ready || !fb.auth) return true;
    if (_ppAuthResolvida && !fb.auth.currentUser) return true;
    return false;
  } catch (_) {
    return true;
  }
}

// onAuthStateChanged dispara uma vez ao resolver a sessão — inclusive com
// `null`, que é a resposta "não há ninguém logado". É esse primeiro disparo
// que distingue "ainda a restaurar a sessão" de "não há sessão nenhuma".
function ppObservarAuth() {
  try {
    var fb = window.AppliqueiFirebase;
    if (!fb || !fb.ready || !fb.auth || typeof fb.auth.onAuthStateChanged !== 'function') return;
    fb.auth.onAuthStateChanged(function () {
      _ppAuthResolvida = true;
    });
  } catch (_) {}
}

function ppDeveMostrarBoasVindas() {
  return ppEstadoAtual() === 'pendente' && ppAppVazio();
}

function ppDeveMostrarCartao() {
  return ppEstadoAtual() === 'guiando';
}

// ============================================================
// --- Navegação: cada passo abre a tela E o formulário ---
// ============================================================

// Mesmo caminho de cadastrarEm(): clicar no botão da sidebar em vez de
// chamar mudarAba() direto, porque mudarAba usa e.currentTarget para marcar
// o item ativo do menu.
function ppNavegarPara(idAba) {
  try {
    var ativa = document.querySelector('.section.ativa');
    if (ativa && ativa.id === idAba) return true;
    var botoes = document.querySelectorAll('.menu-btn');
    for (var i = 0; i < botoes.length; i++) {
      var onclick = botoes[i].getAttribute('onclick') || '';
      if (onclick.indexOf("'" + idAba + "'") !== -1) {
        botoes[i].click();
        return true;
      }
    }
  } catch (_) {}
  return false;
}

function ppRolarAte(id) {
  try {
    var el = document.getElementById(id);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch (_) {}
}

// O cartão é o primeiro elemento do conteúdo, então "mostrar o cartão" é
// levar a rolagem ao topo — e não um scrollIntoView, que o centraliza: no
// celular, centralizar um cartão mais alto que a tela corta o cabeçalho e
// enfia o primeiro passo debaixo do botão do menu.
function ppMostrarCartaoNaTela() {
  try {
    var area = document.querySelector('.main-content');
    if (!area) return;
    if (typeof area.scrollTo === 'function') area.scrollTo({ top: 0, behavior: 'smooth' });
    else area.scrollTop = 0;
  } catch (_) {}
}

// O respiro entre trocar de aba e abrir o formulário é o mesmo de
// cadastrarEm(): a seção precisa pintar antes, senão o painel abre invisível.
function ppIrParaPasso(id) {
  if (id === 'conta') {
    ppNavegarPara('meu_patrimonio');
    setTimeout(function () {
      if (typeof abrirNovaContaForm === 'function') abrirNovaContaForm();
      ppRolarAte('formNovaConta');
    }, 200);
    return;
  }
  if (id === 'receita' || id === 'despesa') {
    ppNavegarPara('controle');
    setTimeout(function () {
      if (typeof abrirPainelLancamento === 'function') abrirPainelLancamento();
      if (typeof selecionarChipTipo === 'function') {
        selecionarChipTipo(id === 'receita' ? 'entrada' : 'saida');
      }
    }, 220);
    return;
  }
  if (id === 'investimento') {
    ppNavegarPara('patrimonio');
    setTimeout(function () {
      if (typeof abrirDrawerOperacao === 'function') abrirDrawerOperacao();
    }, 220);
  }
}

// ============================================================
// --- Modal de boas-vindas ---
// ============================================================

function ppAbrirBoasVindas() {
  var modal = document.getElementById('ppBoasVindas');
  if (!modal) return;

  // Depois de zerar, a abertura muda: quem apagou tudo de propósito não
  // precisa ouvir "bem-vindo", precisa saber que o caminho é o mesmo de novo.
  var posReset = false;
  try {
    posReset = sessionStorage.getItem(PP_MARCA_POS_RESET) === '1';
    if (posReset) sessionStorage.removeItem(PP_MARCA_POS_RESET);
  } catch (_) {}

  var tit = document.getElementById('ppBoasVindasTitulo');
  var sub = document.getElementById('ppBoasVindasSub');
  if (tit) {
    tit.innerHTML = posReset
      ? '<i class="ph-fill ph-confetti"></i> Tudo limpo. Vamos montar de novo?'
      : '<i class="ph-fill ph-hand-waving"></i> Bem-vindo à Appliquei';
  }
  if (sub) {
    sub.textContent = posReset
      ? 'Seus registros foram apagados. O caminho para reconstruir é curto — e é este aqui.'
      : 'Antes de qualquer coisa, a dúvida que todo mundo tem no primeiro dia:';
  }

  modal.style.display = 'flex';
  try {
    document.body.classList.add('pp-modal-aberto');
  } catch (_) {}
}

function ppFecharBoasVindas() {
  var modal = document.getElementById('ppBoasVindas');
  if (modal) modal.style.display = 'none';
  try {
    document.body.classList.remove('pp-modal-aberto');
  } catch (_) {}
}

function ppComecarGuia() {
  ppGravarEstado('guiando');
  ppFecharBoasVindas();
  ppRenderizarCartao();
  ppMostrarCartaoNaTela();
}

function ppPularGuia() {
  ppGravarEstado('pulado');
  ppFecharBoasVindas();
  ppRenderizarCartao();
  if (typeof mostrarToast === 'function') {
    mostrarToast('Guia dispensado. Ele volta pelo botão ⚙ Configurações.', 'sucesso', 4000);
  }
}

function ppConcluirGuia() {
  ppGravarEstado('concluido');
  ppRenderizarCartao();
  if (typeof mostrarToast === 'function') {
    mostrarToast('Boa! Seus primeiros passos estão prontos.', 'sucesso');
  }
}

// Chamado pelo botão em Configurações. Reabre onde a pessoa parou: quem
// nunca respondeu vê o convite; quem já conhece vê a lista direto.
function ppReabrirGuia() {
  if (typeof fecharModalConfig === 'function') fecharModalConfig();
  if (ppAppVazio() && ppEstadoAtual() !== 'guiando') {
    ppGravarEstado('pendente');
    ppAbrirBoasVindas();
    return;
  }
  ppGravarEstado('guiando');
  ppRenderizarCartao();
  ppMostrarCartaoNaTela();
}

// ============================================================
// --- Cartão "Primeiros passos" ---
// ============================================================

function ppHtmlPasso(p, numero) {
  var selo = p.selo
    ? '<span class="pp-selo' +
      (p.selo === 'Opcional' ? ' pp-selo-fraco' : '') +
      '">' +
      p.selo +
      '</span>'
    : '';
  var marcador = p.feito
    ? '<span class="pp-num pp-num-feito"><i class="ph-bold ph-check"></i></span>'
    : '<span class="pp-num">' + numero + '</span>';
  var botao = p.feito
    ? '<span class="pp-feito-txt"><i class="ph-fill ph-check-circle"></i> Feito</span>'
    : '<button type="button" class="pp-btn-passo" onclick="ppIrParaPasso(\'' +
      p.id +
      '\')"><i class="ph ph-arrow-right"></i> ' +
      p.acao +
      '</button>';

  return (
    '<li class="pp-passo' +
    (p.feito ? ' pp-passo-feito' : '') +
    '">' +
    marcador +
    '<div class="pp-passo-corpo">' +
    '<div class="pp-passo-tit"><i class="ph ' +
    p.icone +
    '"></i> ' +
    p.titulo +
    selo +
    '</div>' +
    '<p class="pp-passo-txt">' +
    p.texto +
    '</p>' +
    '</div>' +
    '<div class="pp-passo-acao">' +
    botao +
    '</div>' +
    '</li>'
  );
}

function ppHtmlCartao() {
  var passos = ppPassos();
  var prog = ppProgresso();
  var completo = ppEssenciaisConcluidos();
  var pct = prog.total ? Math.round((prog.feitos / prog.total) * 100) : 0;

  var itens = passos
    .map(function (p, i) {
      return ppHtmlPasso(p, i + 1);
    })
    .join('');

  var rodape = completo
    ? '<div class="pp-final">' +
      '<div class="pp-final-txt"><i class="ph-fill ph-seal-check"></i> <strong>Pronto!</strong> O essencial está registrado — daqui em diante é só manter o mês em dia.</div>' +
      '<button type="button" class="pp-btn-primario" onclick="ppConcluirGuia()"><i class="ph ph-check"></i> Fechar o guia</button>' +
      '</div>'
    : '<div class="pp-nota">' +
      '<i class="ph-fill ph-info"></i> <strong>Não precisa cadastrar conta antes de lançar.</strong> ' +
      'Na receita e na despesa você digita o nome do banco e a Appliquei cria a conta sozinha. ' +
      'Cadastrar antes serve só para informar o saldo que você <em>já tinha</em> — assim o patrimônio não nasce negativo.' +
      '</div>';

  return (
    '<section class="pp-cartao" aria-label="Primeiros passos">' +
    '<header class="pp-cab">' +
    '<div class="pp-cab-txt">' +
    '<h2><i class="ph-fill ph-compass"></i> Primeiros passos</h2>' +
    '<p>' +
    (completo
      ? 'Você concluiu os ' + prog.total + ' passos essenciais.'
      : prog.feitos + ' de ' + prog.total + ' passos essenciais concluídos.') +
    '</p>' +
    '</div>' +
    '<button type="button" class="pp-btn-fechar" onclick="ppPularGuia()" aria-label="Dispensar o guia" title="Dispensar o guia">' +
    '<i class="ph ph-x"></i></button>' +
    '</header>' +
    '<div class="pp-barra"><div class="pp-barra-fill" style="width:' +
    pct +
    '%;"></div></div>' +
    '<ol class="pp-passos">' +
    itens +
    '</ol>' +
    rodape +
    '<div class="pp-rodape-links">' +
    '<button type="button" class="pp-link" onclick="ppPularGuia()">Pular o guia</button>' +
    '<span class="pp-rodape-sep">·</span>' +
    '<span class="pp-rodape-dica">Ele volta em <strong>⚙ Configurações</strong> quando você quiser.</span>' +
    '</div>' +
    '</section>'
  );
}

function ppRenderizarCartao() {
  var alvo = document.getElementById('ppGuia');
  if (!alvo) return false;
  if (!ppDeveMostrarCartao()) {
    alvo.innerHTML = '';
    alvo.hidden = true;
    return false;
  }
  alvo.hidden = false;
  alvo.innerHTML = ppHtmlCartao();
  return true;
}

// ============================================================
// --- Reação a mudanças de dados ---
// ============================================================
//
// O cartão precisa marcar o passo assim que o lançamento entra, sem esperar
// um reload. appliquei-utils.js dispara `appliquei:dados` a cada escrita em
// chave do app; aqui só filtramos o que interessa e redesenhamos uma vez por
// rajada (salvar uma despesa fixa grava 60 parcelas de uma vez).
var PP_CHAVES_OBSERVADAS = [
  'futurorico_transacoes',
  'futurorico_compras',
  'appliquei_contas',
  'appliquei_bens',
  'appliquei_sonhos',
];

function ppAoMudarDados(chave) {
  if (chave && PP_CHAVES_OBSERVADAS.indexOf(chave) === -1) return;
  if (_ppRedesenhoTimer) {
    try {
      clearTimeout(_ppRedesenhoTimer);
    } catch (_) {}
  }
  _ppRedesenhoTimer = setTimeout(function () {
    _ppRedesenhoTimer = null;
    ppRenderizarCartao();
  }, 160);
}

// ============================================================
// --- Boot ---
// ============================================================

// Devolve true quando houve decisão (o guia apareceu, ou concluiu-se que não
// deve aparecer) e false quando ainda é cedo para decidir.
function ppAvaliar() {
  // Login ou bloqueio de assinatura na tela: não há decisão a tomar ainda, e
  // pode demorar o que a pessoa quiser — o vigia continua.
  if (!ppAppLiberado()) {
    _ppLiberadoDesde = 0;
    return false;
  }
  if (!_ppLiberadoDesde) _ppLiberadoDesde = Date.now();
  // A espera pela nuvem conta a partir da LIBERAÇÃO, não do boot: quem passou
  // dois minutos a digitar a senha não deve gastar a janela nisso. Estourado o
  // teto, decide-se com o que houver — um guia a mais é melhor que nenhum.
  if (!ppNuvemRespondeu() && Date.now() - _ppLiberadoDesde < PP_ESPERA_NUVEM_MS) return false;

  if (ppDeveMostrarBoasVindas()) {
    ppAbrirBoasVindas();
    return true;
  }
  ppRenderizarCartao();
  return true;
}

// A liberação do app (login) e a resposta da nuvem chegam por caminhos que não
// avisam ninguém. Em vez de acoplar o guia ao gate e ao sync, olhamos de tempos
// em tempos — barato (duas leituras de DOM) e com fim.
function ppEsperarEDecidir() {
  if (_ppTimerEspera) return;
  _ppVigiaDesde = Date.now();
  _ppTimerEspera = setInterval(function () {
    var decidiu = ppAvaliar();
    var desistiu = Date.now() - _ppVigiaDesde > PP_ESPERA_MAXIMA_MS;
    if (decidiu || desistiu) {
      try {
        clearInterval(_ppTimerEspera);
      } catch (_) {}
      _ppTimerEspera = null;
    }
  }, PP_INTERVALO_MS);
}

function ppBoot() {
  if (_ppIniciado) return;
  _ppIniciado = true;
  ppObservarAuth();
  try {
    window.addEventListener('appliquei:dados', function (ev) {
      ppAoMudarDados(ev && ev.detail ? ev.detail.chave : null);
    });
  } catch (_) {}
  if (!ppAvaliar()) ppEsperarEDecidir();
}

try {
  if (typeof document !== 'undefined' && document.readyState === 'complete') {
    setTimeout(ppBoot, 0);
  } else if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('load', function () {
      setTimeout(ppBoot, 0);
    });
  }
} catch (_) {}
