/**
 * Appliquei — Jornada Financeira (módulos com progresso).
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script.
 * window.onload em app.js chama renderizarSonhos() (em app.js); o
 * DOMContentLoaded handler residual em app.js também chama
 * renderizarJornada() (aqui). Order via load chain.
 */

// ============================================================
// === JORNADA FINANCEIRA — módulos com progresso             ===
// ============================================================
var JORNADA_MODULOS = [
  {
    id: 'm1',
    titulo: '1. Alinhamento de mindset',
    icone: 'ph-brain',
    descricao:
      'Conceitos base sobre finanças comportamentais e tese de longo prazo. Entenda por que disciplina vale mais que retorno.',
    objetivos: [
      'Identificar 3 gatilhos pessoais de gasto impulsivo',
      'Definir sua tese de investimento em 1 frase',
    ],
  },
  {
    id: 'm2',
    titulo: '2. Otimização de caixa',
    icone: 'ph-piggy-bank',
    descricao:
      'Técnicas de engenharia financeira pessoal para provisionar aportes mensais consistentes.',
    objetivos: [
      'Mapear receitas e despesas fixas',
      'Definir % de aporte alvo (mín. 10% da receita)',
    ],
  },
  {
    id: 'm3',
    titulo: '3. Colchão de liquidez',
    icone: 'ph-shield-check',
    descricao:
      'Estruturação da reserva de emergência: quanto, onde e como alocar para acesso rápido sem perder rentabilidade.',
    objetivos: [
      'Calcular 6× despesas fixas mensais',
      'Alocar em Tesouro Selic ou CDB de liquidez diária',
    ],
  },
  {
    id: 'm4',
    titulo: '4. Execução no broker',
    icone: 'ph-storefront',
    descricao:
      'Tutorial técnico de compra de ativos reais passo a passo. Da escolha da corretora até o primeiro boletim de compra.',
    objetivos: ['Abrir conta em corretora', 'Executar primeira compra de ativo'],
  },
  {
    id: 'm5',
    titulo: '5. Renda fixa avançada',
    icone: 'ph-bank',
    descricao:
      'CDB, LCI, LCA, debêntures, Tesouro Direto: como comparar, indexadores e armadilhas comuns.',
    objetivos: ['Comparar CDI vs IPCA+ vs prefixado', 'Montar uma escada de vencimentos'],
  },
  {
    id: 'm6',
    titulo: '6. Renda variável & dividendos',
    icone: 'ph-chart-line-up',
    descricao:
      'Ações brasileiras, FIIs, dividend yield, payout. Como avaliar uma empresa antes de comprar.',
    objetivos: [
      'Selecionar 5 ativos pagadores consistentes',
      'Calcular dividend yield ponderado da carteira',
    ],
  },
  {
    id: 'm7',
    titulo: '7. Diversificação internacional',
    icone: 'ph-globe-hemisphere-west',
    descricao:
      'BDRs, ETFs internacionais, exposição cambial. Por que e quanto alocar fora do real.',
    objetivos: [
      'Definir % alvo de exposição internacional',
      'Escolher veículo (BDR vs ETF vs conta global)',
    ],
  },
  {
    id: 'm8',
    titulo: '8. Aposentadoria & longo prazo',
    icone: 'ph-tree-palm',
    descricao:
      'Previdência privada, regime de tributação, planejamento sucessório e o cálculo da sua liberdade financeira.',
    objetivos: ['Simular patrimônio-alvo para liberdade', 'Comparar PGBL vs VGBL pro seu caso'],
  },
];
var JORNADA_STORAGE_KEY = 'appliquei_jornada_progresso';

function carregarJornadaProgresso() {
  try {
    return JSON.parse(localStorage.getItem(JORNADA_STORAGE_KEY) || '{}');
  } catch (_) {
    return {};
  }
}
function salvarJornadaProgresso(p) {
  localStorage.setItem(JORNADA_STORAGE_KEY, JSON.stringify(p || {}));
}

function jornadaModulosConcluidosNoMes(yyyymm) {
  // yyyymm = "YYYY-MM"; conta módulos cujo concluidoEm cai dentro desse mês
  const prog = carregarJornadaProgresso();
  return Object.values(prog).filter((p) => {
    if (!p || !p.concluidoEm) return false;
    return p.concluidoEm.slice(0, 7) === yyyymm;
  }).length;
}

// ============================================================
// === Material de estudo — renderização                     ===
// ============================================================
// O conteúdo vem de appliquei-jornada-conteudo.js como DADO. Aqui ele vira
// tela. Todo texto passa por jornadaEscapar antes: o arquivo de conteúdo vai
// ser editado por quem escreve, não por quem programa, e um `<` digitado sem
// querer não pode virar markup.

function jornadaEscapar(txt) {
  return String(txt == null ? '' : txt)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escapa e converte a única marcação permitida: **ênfase**. */
function jornadaTexto(txt) {
  return jornadaEscapar(txt).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** Um bloco de conteúdo vira HTML. Tipo desconhecido não desenha nada. */
function jornadaBlocoHtml(b) {
  if (!b || !b.t) return '';
  switch (b.t) {
    case 'ideia':
      return (
        '<blockquote class="jm-ideia"><i class="ph-fill ph-quotes"></i><p>' +
        jornadaTexto(b.texto) +
        '</p></blockquote>'
      );
    case 'h':
      return '<h4 class="jm-h">' + jornadaTexto(b.texto) + '</h4>';
    case 'p':
      return '<p class="jm-p">' + jornadaTexto(b.texto) + '</p>';
    case 'lista':
      return (
        '<ul class="jm-lista">' +
        (b.itens || [])
          .map(function (i) {
            return '<li>' + jornadaTexto(i) + '</li>';
          })
          .join('') +
        '</ul>'
      );
    case 'passos':
      return (
        '<ol class="jm-passos">' +
        (b.itens || [])
          .map(function (i) {
            return '<li>' + jornadaTexto(i) + '</li>';
          })
          .join('') +
        '</ol>'
      );
    case 'chave':
      return (
        '<div class="jm-chave"><span class="jm-chave-termo">' +
        jornadaTexto(b.termo) +
        '</span><span class="jm-chave-texto">' +
        jornadaTexto(b.texto) +
        '</span></div>'
      );
    case 'conta':
      return (
        '<div class="jm-conta">' +
        (b.titulo ? '<div class="jm-conta-titulo">' + jornadaTexto(b.titulo) + '</div>' : '') +
        '<div class="jm-conta-linhas">' +
        (b.linhas || [])
          .map(function (l) {
            // Terceiro elemento opcional: marca a linha de resultado.
            return (
              '<div class="jm-conta-linha' +
              (l[2] ? ' destaque' : '') +
              '"><span>' +
              jornadaTexto(l[0]) +
              '</span><span class="jm-conta-val">' +
              jornadaTexto(l[1]) +
              '</span></div>'
            );
          })
          .join('') +
        '</div>' +
        (b.nota ? '<div class="jm-conta-nota">' + jornadaTexto(b.nota) + '</div>' : '') +
        '</div>'
      );
    case 'alerta':
      return (
        '<div class="jm-alerta"><i class="ph-fill ph-warning-circle"></i><div>' +
        (b.titulo ? '<strong>' + jornadaTexto(b.titulo) + '</strong>' : '') +
        '<span>' +
        jornadaTexto(b.texto) +
        '</span></div></div>'
      );
    case 'noapp':
      return (
        '<div class="jm-noapp"><i class="ph-fill ph-arrow-bend-down-right"></i><div>' +
        '<span class="jm-noapp-aba">Na Appliquei · ' +
        jornadaEscapar(b.aba) +
        '</span>' +
        '<span>' +
        jornadaTexto(b.texto) +
        '</span></div></div>'
      );
    default:
      return '';
  }
}

/** O material inteiro de um módulo, ou o aviso de que ele ainda não existe. */
function jornadaMaterialHtml(id) {
  var mat = typeof JORNADA_CONTEUDO !== 'undefined' ? JORNADA_CONTEUDO[id] : null;
  if (!mat) {
    // Módulo novo cadastrado sem material: melhor dizer isso do que abrir
    // uma tela vazia sem explicação.
    return (
      '<div class="jm-alerta"><i class="ph-fill ph-warning-circle"></i><div>' +
      '<strong>Material em preparação.</strong><span>Este módulo ainda não tem o texto de estudo. ' +
      'Leia o resumo, execute os objetivos e marque como concluído.</span></div></div>'
    );
  }
  return (mat.blocos || []).map(jornadaBlocoHtml).join('');
}

// ============================================================
// === Trilha sequencial: um módulo por vez                   ===
// ============================================================
// A trilha é ordenada de propósito — o módulo 5 fala de indexador de renda
// fixa supondo que a reserva do módulo 3 já existe, e o 8 calcula o
// patrimônio-alvo em cima do aporte que o módulo 2 dimensionou. Com tudo
// aberto, o caminho natural era pular para o assunto que soa mais
// interessante e ler fora de ordem o material que foi escrito em ordem.
//
// A regra tem três braços, e o terceiro importa: quem já concluiu um módulo
// nunca perde o acesso a ele. A trilha era livre até agora, então existe gente
// com o módulo 5 concluído e o 4 não — re-trancar seria apagar progresso que a
// pessoa já fez.

/** Índice do módulo na trilha, ou -1. */
function jornadaIndiceModulo(id) {
  for (var i = 0; i < JORNADA_MODULOS.length; i++) {
    if (JORNADA_MODULOS[i].id === id) return i;
  }
  return -1;
}

function jornadaConcluido(id, prog) {
  var p = (prog || carregarJornadaProgresso())[id];
  return !!(p && p.concluidoEm);
}

/**
 * O módulo está liberado?
 *   · o primeiro, sempre;
 *   · o já concluído, sempre (não se tranca o que já foi feito);
 *   · os demais, só com o anterior concluído.
 */
function jornadaModuloLiberado(id, prog) {
  var i = jornadaIndiceModulo(id);
  if (i <= 0) return true;
  var p = prog || carregarJornadaProgresso();
  if (jornadaConcluido(id, p)) return true;
  return jornadaConcluido(JORNADA_MODULOS[i - 1].id, p);
}

/** O módulo que a pessoa deve fazer agora — o primeiro não concluído. */
function jornadaProximoModulo(prog) {
  var p = prog || carregarJornadaProgresso();
  for (var i = 0; i < JORNADA_MODULOS.length; i++) {
    if (!jornadaConcluido(JORNADA_MODULOS[i].id, p)) return JORNADA_MODULOS[i];
  }
  return null;
}

var jornadaModuloAberto = null;
function abrirModalJornada(id) {
  const mod = JORNADA_MODULOS.find((m) => m.id === id);
  if (!mod) return;
  // A trava também vale aqui, não só no card: o cadeado na tela é a
  // sinalização, esta linha é a regra.
  if (!jornadaModuloLiberado(id)) {
    const i = jornadaIndiceModulo(id);
    const anterior = JORNADA_MODULOS[i - 1];
    if (typeof mostrarToast === 'function') {
      mostrarToast(
        'Conclua "' + (anterior ? anterior.titulo : 'o módulo anterior') + '" para abrir este.',
        'aviso'
      );
    }
    return;
  }
  jornadaModuloAberto = id;
  const mat = typeof JORNADA_CONTEUDO !== 'undefined' ? JORNADA_CONTEUDO[id] : null;
  const modal = document.getElementById('modalJornadaModulo');
  modal.querySelector('#jornadaModalTitulo span').innerText = mod.titulo;

  // Cabeçalho: ícone do módulo, tempo de leitura e a ideia central. É o que
  // a pessoa lê antes de decidir se tem tempo agora.
  const capa = document.getElementById('jornadaModalCapa');
  if (capa) {
    capa.innerHTML =
      '<div class="jm-capa-icone"><i class="ph-duotone ' +
      jornadaEscapar(mod.icone) +
      '"></i></div>' +
      '<div class="jm-capa-txt">' +
      (mat && mat.tempo
        ? '<span class="jm-capa-tempo"><i class="ph ph-clock"></i> ' +
          mat.tempo +
          ' min de leitura</span>'
        : '') +
      '<p class="jm-capa-resumo">' +
      jornadaTexto(mat && mat.resumo ? mat.resumo : mod.descricao) +
      '</p>' +
      '</div>';
  }

  const corpo = document.getElementById('jornadaModalMaterial');
  if (corpo) corpo.innerHTML = jornadaMaterialHtml(id);
  // Reabrir um módulo tem de começar do começo do texto, não de onde a
  // leitura anterior parou.
  const rolagem = document.getElementById('jornadaModalRolagem');
  if (rolagem) rolagem.scrollTop = 0;

  const aviso = document.getElementById('jornadaModalAvisoRegras');
  if (aviso && typeof JORNADA_AVISO_REGRAS === 'string') aviso.innerText = JORNADA_AVISO_REGRAS;

  document.getElementById('jornadaModalDescricao').innerText = mod.descricao;
  const objetivos = document.getElementById('jornadaModalObjetivos');
  objetivos.innerHTML =
    '<strong style="font-size:12px;color:var(--cor-texto-mutado);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:8px;">Ao concluir este módulo, você terá:</strong>' +
    '<ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.7;color:var(--cor-texto-principal);">' +
    mod.objetivos.map((o) => '<li>' + o + '</li>').join('') +
    '</ul>';
  const prog = carregarJornadaProgresso();
  const btn = document.getElementById('jornadaModalBtnConcluir');
  const concluido = !!(prog[id] && prog[id].concluidoEm);
  if (concluido) {
    btn.innerHTML =
      '<i class="ph-bold ph-arrow-counter-clockwise"></i> <span>Desmarcar conclusão</span>';
    btn.style.background = 'var(--cor-texto-mutado)';
  } else {
    btn.innerHTML = '<i class="ph-bold ph-check-circle"></i> <span>Marcar como concluído</span>';
    btn.style.background = 'var(--cor-primaria)';
  }
  btn.onclick = () => toggleJornadaModulo(id);
  modal.style.display = 'flex';
}
function fecharModalJornada() {
  document.getElementById('modalJornadaModulo').style.display = 'none';
  jornadaModuloAberto = null;
}
function toggleJornadaModulo(id) {
  const prog = carregarJornadaProgresso();
  if (prog[id] && prog[id].concluidoEm) {
    delete prog[id];
    mostrarToast('Módulo desmarcado.', 'aviso');
  } else {
    prog[id] = { concluidoEm: new Date().toISOString() };
    mostrarToast('Módulo concluído! 🎓', 'sucesso');
  }
  salvarJornadaProgresso(prog);
  fecharModalJornada();
  renderizarJornada();
}

function renderizarJornada() {
  const grid = document.getElementById('jornadaModulosGrid');
  if (!grid) return;
  const prog = carregarJornadaProgresso();
  const total = JORNADA_MODULOS.length;
  const concluidos = JORNADA_MODULOS.filter((m) => prog[m.id] && prog[m.id].concluidoEm).length;
  const pct = total ? Math.round((concluidos / total) * 100) : 0;

  // Cards
  const proximo = jornadaProximoModulo(prog);
  grid.innerHTML = JORNADA_MODULOS.map((m, idx) => {
    const ok = jornadaConcluido(m.id, prog);
    const liberado = jornadaModuloLiberado(m.id, prog);
    const anterior = idx > 0 ? JORNADA_MODULOS[idx - 1] : null;
    // "Seu próximo passo" é UM cartão só — o primeiro não concluído. Quem
    // concluiu fora de ordem no tempo em que a trilha era livre pode ter mais
    // de um módulo liberado; esses aparecem como "Disponível", sem disputar o
    // destaque com o passo que a trilha indica.
    const agora = !!(proximo && proximo.id === m.id);

    const badge = ok
      ? '<span class="jor-selo ok"><i class="ph-fill ph-check-circle"></i> Concluído</span>'
      : !liberado
        ? '<span class="jor-selo trancado"><i class="ph-fill ph-lock-simple"></i> Bloqueado</span>'
        : agora
          ? '<span class="jor-selo agora"><i class="ph-fill ph-play-circle"></i> Seu próximo passo</span>'
          : '<span class="jor-selo livre"><i class="ph ph-lock-simple-open"></i> Disponível</span>';

    const dataLbl = ok
      ? '<div class="jor-data">Concluído em ' +
        new Date(prog[m.id].concluidoEm).toLocaleDateString('pt-BR') +
        '</div>'
      : !liberado && anterior
        ? '<div class="jor-data">Abre ao concluir <strong>' + anterior.titulo + '</strong></div>'
        : '';

    const classes =
      'card-container jor-card' +
      (ok ? ' feito' : '') +
      (liberado ? '' : ' trancado') +
      (agora ? ' agora' : '');
    // Cartão trancado não vira botão: sem cursor de mão, sem hover, sem
    // onclick. Só o botão dentro dele responde, e responde explicando.
    const acaoCard = liberado ? ' onclick="abrirModalJornada(\'' + m.id + '\')"' : '';

    return (
      '<div class="' +
      classes +
      '"' +
      acaoCard +
      '>' +
      badge +
      '<div class="jor-card-topo"><i class="ph-duotone ' +
      (liberado ? m.icone : 'ph-lock-simple') +
      ' jor-card-icone"></i><h3>' +
      m.titulo +
      '</h3></div>' +
      '<p class="jor-card-desc">' +
      m.descricao +
      '</p>' +
      dataLbl +
      '<button class="' +
      (ok || !liberado ? 'btn-secundario' : 'btn-acao') +
      '" style="width:100%;"' +
      (liberado ? '' : ' aria-disabled="true"') +
      ' onclick="event.stopPropagation();abrirModalJornada(\'' +
      m.id +
      '\')">' +
      (ok
        ? '<i class="ph ph-eye"></i> Rever material'
        : !liberado
          ? '<i class="ph-fill ph-lock-simple"></i> Conclua o anterior'
          : '<i class="ph-bold ph-arrow-right"></i> Estudar módulo') +
      '</button></div>'
    );
  }).join('');

  // Barra de progresso
  const bar = document.getElementById('jornadaProgressoBar');
  const pctTxt = document.getElementById('jornadaPctTexto');
  const resumo = document.getElementById('jornadaResumoTexto');
  const chip = document.getElementById('jornadaResumoChip');
  const msg = document.getElementById('jornadaMensagem');
  if (bar) bar.style.width = pct + '%';
  if (pctTxt) pctTxt.innerText = pct + '%';
  if (resumo) resumo.innerText = concluidos + ' de ' + total + ' módulos';
  if (chip) chip.style.display = '';
  if (msg) {
    // A trilha é sequencial: a mensagem aponta UM módulo, o mesmo que o cartão
    // marca como "seu próximo passo".
    if (concluidos === total)
      msg.innerHTML =
        '🎉 <strong>Trilha completa.</strong> Releia os módulos sempre que precisar revisar um conceito.';
    else if (concluidos === 0)
      msg.innerHTML =
        'Os módulos abrem um por vez, na ordem — cada um se apoia no anterior. Comece por <strong>' +
        (proximo ? proximo.titulo : 'o primeiro') +
        '</strong>. A meta sugerida é <strong>1 módulo por mês</strong>, que vira critério verde no Relatório mensal.';
    else
      msg.innerHTML =
        '<strong>' +
        concluidos +
        ' de ' +
        total +
        ' concluídos.</strong> O próximo é <strong>' +
        (proximo ? proximo.titulo : '—') +
        '</strong>. O critério "verde" no termômetro mensal é <strong>≥ 1 módulo no mês</strong>.';
  }

  // Módulos concluídos no mês corrente
  const hoje = new Date();
  const yyyymm = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
  const noMes = jornadaModulosConcluidosNoMes(yyyymm);
  const elMes = document.getElementById('jornadaModulosMes');
  if (elMes) elMes.innerText = noMes;
}
