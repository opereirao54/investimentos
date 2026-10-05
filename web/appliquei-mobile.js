// ============================================================
// --- App mobile: barra inferior, tela "Mais" e voltar ---
// ============================================================
// No celular o app era o site de desktop espremido: o menu morava atrás de
// um ☰ no canto, cada troca de tela custava dois toques e nada dizia onde a
// pessoa estava. Aqui fica a casca de app que vale só até 768px:
//
//   - uma barra fixa embaixo, na zona do polegar, com as três telas de uso
//     diário, o "+" de cadastro no centro e o "Mais";
//   - a tela "Mais", que reúne as demais seções e as preferências que antes
//     viviam no rodapé da sidebar;
//   - um "‹ Mais" no topo das telas que se abre a partir dela.
//
// A casca NÃO duplica lógica: navegar é clicar no botão da sidebar (que já
// chama mudarAba com o callback certo — Info Mercado carrega notícias, por
// exemplo), e o "+" reaproveita o menu de cadastro global. No desktop nada
// disto aparece; o CSS esconde a barra e a seção "Mais" acima de 768px.

var MOB_ABAS_BARRA = ['controle', 'meu_patrimonio', 'patrimonio'];
var MOB_ABA_MAIS = 'mais_mobile';

function mobEhCelular() {
  return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
}

/** Leva à seção pelo mesmo caminho do menu lateral. */
function mobIrPara(idAba) {
  if (typeof fecharMenuCadastro === 'function') fecharMenuCadastro();
  if (idAba === MOB_ABA_MAIS) {
    mobMostrarMais();
    return;
  }
  const btn = Array.from(document.querySelectorAll('#mainSidebar .menu-btn')).find((b) =>
    (b.getAttribute('onclick') || '').includes("'" + idAba + "'")
  );
  if (btn) btn.click();
  // mudarAba já sincroniza no fim; repetir aqui garante a barra certa mesmo
  // se o render da aba lançar no meio do caminho.
  mobSincronizarAba(idAba);
}

/**
 * A seção "Mais" não tem botão na sidebar (no desktop a própria sidebar já é
 * o "mais"), então a troca é feita aqui, espelhando o que mudarAba faz.
 */
function mobMostrarMais() {
  const sec = document.getElementById(MOB_ABA_MAIS);
  if (!sec) return;
  document.querySelectorAll('.section').forEach((s) => s.classList.remove('ativa'));
  document.querySelectorAll('.menu-btn').forEach((b) => b.classList.remove('ativo'));
  sec.classList.add('ativa');
  document.body.classList.remove('controle-ativo');
  if (typeof fecharPainelLancamento === 'function') fecharPainelLancamento();
  mobAtualizarMais();
  mobSincronizarAba(MOB_ABA_MAIS);
}

/**
 * Acende a aba certa da barra e decide se a tela ganha o "‹ Mais".
 * Chamada por mudarAba a cada troca — é o único ponto que sabe a aba nova.
 */
function mobSincronizarAba(idAba) {
  const naBarra = MOB_ABAS_BARRA.indexOf(idAba) > -1 || idAba === MOB_ABA_MAIS;
  const acesa = naBarra ? idAba : MOB_ABA_MAIS;
  document.querySelectorAll('#mobTabbar .mob-tab[data-aba]').forEach((t) => {
    const on = t.dataset.aba === acesa;
    t.classList.toggle('ativo', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  document.body.classList.toggle('mob-secundaria', !naBarra);
  // App de verdade abre a tela nova no topo. O rolador é .main-content.
  if (mobEhCelular()) {
    const rol = document.querySelector('.main-content');
    if (rol) rol.scrollTop = 0;
  }
}

/** Espelha na tela "Mais" o que a sidebar sabe: conta, tema, valores, salvo. */
function mobAtualizarMais() {
  const copia = (de, para) => {
    const a = document.getElementById(de);
    const b = document.getElementById(para);
    if (a && b) b.textContent = (a.textContent || '').trim();
  };
  copia('sidebarAuthEmail', 'mobContaEmail');
  copia('sidebarAuthBtnLabel', 'mobAuthLabel');
  copia('ultimoSalvoTxt', 'mobUltimoSalvo');

  const email = document.getElementById('mobContaEmail');
  const avatar = document.getElementById('mobContaAvatar');
  if (avatar && email) {
    const t = (email.textContent || '').trim();
    avatar.textContent = t && t !== 'Conta' ? t.charAt(0).toUpperCase() : '?';
  }

  const liga = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('aria-checked', on ? 'true' : 'false');
  };
  liga('mobPrefTema', document.body.classList.contains('dark'));
  liga('mobPrefValores', document.body.classList.contains('valores-ocultos'));
}

function mobAlternarTema() {
  if (typeof toggleDarkMode === 'function') toggleDarkMode();
  mobAtualizarMais();
}

function mobAlternarValores() {
  if (typeof toggleValoresOcultos === 'function') toggleValoresOcultos();
  mobAtualizarMais();
}

// Voltar ao desktop com a tela "Mais" aberta deixaria a página em branco:
// ela não existe acima de 768px. Cai no Controle, a tela inicial.
function _mobAoRedimensionar() {
  const sec = document.getElementById(MOB_ABA_MAIS);
  if (!mobEhCelular() && sec && sec.classList.contains('ativa')) mobIrPara('controle');
}

document.addEventListener('DOMContentLoaded', function () {
  const ativa = document.querySelector('.section.ativa');
  mobSincronizarAba(ativa ? ativa.id : 'controle');
  window.addEventListener('resize', _mobAoRedimensionar);
});

// ------------------------------------------------------------
// Controle no celular: Resumo | Extrato | Projeção
// ------------------------------------------------------------
// A seção empilhava indicadores, alertas, vencimentos, saúde, composição,
// extrato e DRE — umas quatro telas de rolagem. No celular ela vira três
// abas que trocam o conteúdo no mesmo espaço. Quem diz a que aba cada bloco
// pertence é o próprio HTML (data-mob-aba); aqui só se troca o estado.
var MOB_SEG_CONTROLE = ['resumo', 'extrato', 'projecao'];

function mobSegControle(aba) {
  if (MOB_SEG_CONTROLE.indexOf(aba) === -1) return;
  const sec = document.getElementById('controle');
  if (!sec) return;
  sec.dataset.mobAbaAtiva = aba;
  document.querySelectorAll('#mobSegControle [data-mob-seg]').forEach((b) => {
    b.setAttribute('aria-selected', b.dataset.mobSeg === aba ? 'true' : 'false');
  });
  const rol = document.querySelector('.main-content');
  const seg = document.getElementById('mobSegControle');
  // Volta ao começo da aba, mas sem esconder a própria barra de abas.
  if (rol && seg && rol.scrollTop > seg.offsetTop) rol.scrollTop = seg.offsetTop;
}

// ------------------------------------------------------------
// DRE no celular: gráfico do resultado + um cartão por mês
// ------------------------------------------------------------
// A DRE é uma tabela de 12 a 48 colunas; com a primeira coluna fixa, numa
// tela de 390px cabia um mês e pouco por vez, e comparar meses exigia rolar
// de lado e decorar números. A pergunta da Projeção é "vou ficar no vermelho
// em algum mês?" — então o celular mostra primeiro a resposta (barras e um
// alerta do primeiro mês negativo) e depois o detalhe, um mês por cartão,
// só com as linhas que tiveram movimento. A tabela segue a um toque.
//
// Os números chegam prontos de atualizarTelaControle: nada é recalculado.

var _mobDreTabela = false;

function _mobDreClasse(v, d) {
  if (v < 0) return 'neg';
  if (v < d.metaVermelha) return 'baixo';
  if (v >= d.metaVerde) return 'ok';
  return 'neutro';
}

function _mobDreFmt(v) {
  return typeof formatarMoeda === 'function'
    ? formatarMoeda(v)
    : 'R$ ' +
        Number(v || 0)
          .toFixed(2)
          .replace('.', ',');
}

function mobRenderDRE(d) {
  const alvo = document.getElementById('mobDRE');
  if (!alvo || !d || !Array.isArray(d.meses) || !d.meses.length) return;
  const meses = d.meses;
  const fmt = _mobDreFmt;
  const resultados = meses.map((m) => m.saldoAcumulado || 0);
  const maxAbs = Math.max(1, ...resultados.map((v) => Math.abs(v)));
  const temNeg = resultados.some((v) => v < 0);
  const maxPos = Math.max(0, ...resultados);
  const maxNeg = Math.max(0, ...resultados.map((v) => -v));
  // Linha do zero proporcional ao que existe acima e abaixo dela.
  const fracPos = temNeg ? maxPos / (maxPos + maxNeg || 1) : 1;

  // Alerta: o primeiro mês do horizonte em que o resultado fica negativo.
  const iNeg = resultados.findIndex((v) => v < 0);
  let alerta = '';
  if (iNeg > -1) {
    alerta =
      '<button type="button" class="mdre-alerta" onclick="mobDreIrPara(' +
      iNeg +
      ')"><i class="ph-fill ph-warning-circle"></i><span>Em <strong>' +
      d.rotulos[iNeg] +
      '</strong> o caixa fica negativo: <strong>' +
      fmt(resultados[iNeg]) +
      '</strong></span><i class="ph ph-caret-right"></i></button>';
  } else {
    const iMin = resultados.indexOf(Math.min(...resultados));
    alerta =
      '<div class="mdre-alerta ok"><i class="ph-fill ph-check-circle"></i><span>Sem mês negativo no período. O menor resultado é <strong>' +
      fmt(resultados[iMin]) +
      '</strong>, em ' +
      d.rotulos[iMin] +
      '.</span></div>';
  }

  // Barras: uma por mês; rótulo a cada N para não encavalar.
  const passo = meses.length > 24 ? 6 : meses.length > 12 ? 3 : 1;
  const barras = meses
    .map((m, i) => {
      const v = resultados[i];
      const h = Math.max(2, Math.round((Math.abs(v) / maxAbs) * 100));
      const cls = _mobDreClasse(v, d);
      const rot = i % passo === 0 || i === d.indiceAtual ? d.rotulos[i].split('/')[0] : '';
      return (
        '<button type="button" class="mdre-barra ' +
        cls +
        (i === d.indiceAtual ? ' atual' : '') +
        '" data-i="' +
        i +
        '" onclick="mobDreIrPara(' +
        i +
        ')" aria-label="' +
        d.rotulos[i] +
        ': ' +
        fmt(v) +
        '"><span class="mdre-col"><span class="mdre-pos"' +
        (v >= 0 ? ' style="height:' + h + '%"' : '') +
        '></span><span class="mdre-neg"' +
        (v < 0 ? ' style="height:' + h + '%"' : '') +
        '></span></span><span class="mdre-rot">' +
        rot +
        '</span></button>'
      );
    })
    .join('');

  // Cartões: só as linhas com movimento naquele mês.
  const linha = (rot, v, cls, sinal) =>
    Math.abs(v) < 0.005
      ? ''
      : '<div class="mdre-linha"><span>' +
        rot +
        '</span><span class="mdre-v ' +
        cls +
        '">' +
        (sinal === '-' ? '−' : sinal === '+' ? '+' : '') +
        fmt(Math.abs(v)) +
        '</span></div>';
  const cartoes = meses
    .map((m, i) => {
      const v = resultados[i];
      const atual = i === d.indiceAtual;
      const inv = (m.invFixo || 0) + (m.invVar || 0);
      const acum = d.acumulado ? d.acumulado[i] : 0;
      const antes = i === 0 ? d.acumuladoInicial || 0 : d.acumulado[i - 1];
      const deltaAcum = acum - antes;
      const lapis = atual
        ? ' <button type="button" class="mdre-lapis" aria-label="Ajustar saldo trazido" onclick="editarSaldoMesAnterior(' +
          m.mes +
          ',' +
          m.ano +
          ')"><i class="ph ph-pencil-simple"></i></button>'
        : '';
      const herdado =
        Math.abs(m.saldoCarregado || 0) < 0.005
          ? ''
          : '<div class="mdre-linha herdado"><span>Saldo anterior' +
            lapis +
            '</span><span class="mdre-v ' +
            (m.saldoCarregado < 0 ? 'neg' : 'roxo') +
            '">' +
            fmt(m.saldoCarregado) +
            '</span></div>';
      const corpo =
        linha('Receita', m.receita, 'verde', '+') +
        linha('Resgates', m.resgate, 'verde', '+') +
        linha('Despesas', m.despesas, 'vermelho', '-') +
        linha('Investimentos', inv, 'azul', '-') +
        linha('Aporte externo', m.invExterno, 'mudo', '') +
        linha('Sonhos', m.sonho, 'roxo', '-') +
        herdado;
      return (
        '<article class="mdre-card' +
        (atual ? ' atual' : '') +
        '" id="mdreCard' +
        i +
        '" data-i="' +
        i +
        '"><header><span class="mdre-mes">' +
        d.rotulos[i] +
        '</span>' +
        (atual ? '<span class="mdre-tag">mês em foco</span>' : '') +
        '</header><div class="mdre-res-rot">Resultado do mês</div><div class="mdre-res ' +
        _mobDreClasse(v, d) +
        '">' +
        fmt(v) +
        '</div><div class="mdre-linhas">' +
        (corpo || '<div class="mdre-vazio">Sem movimentos neste mês.</div>') +
        '</div><footer><span>Investimento acumulado</span><span><strong>' +
        fmt(acum) +
        '</strong>' +
        (Math.abs(deltaAcum) < 0.005
          ? ''
          : ' <em class="' +
            (deltaAcum < 0 ? 'neg' : '') +
            '">' +
            (deltaAcum > 0 ? '+' : '−') +
            fmt(Math.abs(deltaAcum)).replace('R$', '').trim() +
            '</em>') +
        '</span></footer></article>'
      );
    })
    .join('');

  alvo.innerHTML =
    alerta +
    '<div class="mdre-grafico" style="--mdre-zero:' +
    (fracPos * 100).toFixed(1) +
    '%">' +
    barras +
    '</div><div class="mdre-cards" id="mdreCards">' +
    cartoes +
    '</div><button type="button" class="mdre-tabela-btn" onclick="mobDreAlternarTabela()" aria-expanded="' +
    (_mobDreTabela ? 'true' : 'false') +
    '"><i class="ph ph-table"></i> ' +
    (_mobDreTabela ? 'Esconder tabela completa' : 'Ver tabela completa') +
    '</button>';

  // Abre no mês em foco (sem animação) e acende a barra dele.
  const foco = Math.max(0, Math.min(meses.length - 1, d.indiceAtual));
  mobDreIrPara(foco, true);
  _mobDreLigarRolagem();
}

/** Leva o carrossel ao cartão do mês i e acende a barra correspondente. */
function mobDreIrPara(i, instantaneo) {
  const trilho = document.getElementById('mdreCards');
  const card = document.getElementById('mdreCard' + i);
  if (trilho && card) {
    trilho.scrollTo({
      left: card.offsetLeft - trilho.offsetLeft - 16,
      behavior: instantaneo ? 'auto' : 'smooth',
    });
  }
  _mobDreAcender(i);
}

function _mobDreAcender(i) {
  document.querySelectorAll('#mobDRE .mdre-barra').forEach((b) => {
    b.classList.toggle('sel', Number(b.dataset.i) === i);
  });
}

// Deslizar os cartões também move o destaque nas barras.
function _mobDreLigarRolagem() {
  const trilho = document.getElementById('mdreCards');
  if (!trilho || trilho.dataset.ligado) return;
  trilho.dataset.ligado = '1';
  let t = null;
  trilho.addEventListener(
    'scroll',
    () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const cards = trilho.querySelectorAll('.mdre-card');
        let melhor = 0;
        let dist = Infinity;
        cards.forEach((c) => {
          const dd = Math.abs(c.offsetLeft - trilho.offsetLeft - 16 - trilho.scrollLeft);
          if (dd < dist) {
            dist = dd;
            melhor = Number(c.dataset.i);
          }
        });
        _mobDreAcender(melhor);
      }, 80);
    },
    { passive: true }
  );
}

function mobDreAlternarTabela() {
  _mobDreTabela = !_mobDreTabela;
  const sec = document.getElementById('controle');
  if (sec) sec.classList.toggle('mob-dre-tabela', _mobDreTabela);
  const btn = document.querySelector('#mobDRE .mdre-tabela-btn');
  if (btn) {
    btn.setAttribute('aria-expanded', _mobDreTabela ? 'true' : 'false');
    btn.innerHTML =
      '<i class="ph ph-table"></i> ' +
      (_mobDreTabela ? 'Esconder tabela completa' : 'Ver tabela completa');
  }
}

// ------------------------------------------------------------
// Extrato no celular: ações por deslize (ou toque)
// ------------------------------------------------------------
// Cada linha trazia três ou quatro ícones de ~20px (pagar, desfazer,
// editar, excluir) lado a lado — pequenos para o dedo e perigosamente
// perto um do outro: excluir ficava a 8px de editar. No celular os mesmos
// botões viram um painel que entra pela direita, com alvos de 56px, ao
// deslizar a linha para a esquerda ou ao tocar nela. Os botões são os
// originais (mesmos onclick); só a apresentação muda.
var _mobExtToque = null;

function _mobExtFecharTodos(exceto) {
  document.querySelectorAll('#extratoUnificado .extrato-item.mob-acoes').forEach((el) => {
    if (el !== exceto) el.classList.remove('mob-acoes');
  });
}

function _mobLigarExtrato() {
  const lista = document.getElementById('extratoUnificado');
  if (!lista || lista.dataset.mobAcoes) return;
  lista.dataset.mobAcoes = '1';

  lista.addEventListener(
    'touchstart',
    (e) => {
      const item = e.target.closest('.extrato-item');
      if (!item || !mobEhCelular()) return;
      const t = e.touches[0];
      _mobExtToque = { item, x: t.clientX, y: t.clientY, decidido: false };
    },
    { passive: true }
  );
  lista.addEventListener(
    'touchmove',
    (e) => {
      if (!_mobExtToque || _mobExtToque.decidido) return;
      const t = e.touches[0];
      const dx = t.clientX - _mobExtToque.x;
      const dy = t.clientY - _mobExtToque.y;
      if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      _mobExtToque.decidido = true;
      if (dx < 0) {
        _mobExtFecharTodos(_mobExtToque.item);
        _mobExtToque.item.classList.add('mob-acoes');
      } else {
        _mobExtToque.item.classList.remove('mob-acoes');
      }
    },
    { passive: true }
  );
  lista.addEventListener('touchend', () => {
    _mobExtToque = null;
  });

  // Toque simples na linha (fora dos botões) abre/fecha o painel: o deslize
  // não é descobrível por todo mundo.
  lista.addEventListener('click', (e) => {
    if (!mobEhCelular()) return;
    if (e.target.closest('button')) {
      _mobExtFecharTodos(null);
      return;
    }
    const item = e.target.closest('.extrato-item');
    if (!item) return;
    const abrir = !item.classList.contains('mob-acoes');
    _mobExtFecharTodos(item);
    item.classList.toggle('mob-acoes', abrir);
  });
}

document.addEventListener('DOMContentLoaded', _mobLigarExtrato);
