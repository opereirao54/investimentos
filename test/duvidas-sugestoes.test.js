'use strict';

// Dúvidas & Sugestões — o seletor de tipo e o form de envio.
//
// O apontamento: "ele já entra clicado em melhoria e não sai desse bloco, e eu
// nunca consegui enviar nada por lá".
//
// O primeiro é reproduzível: o botão "✨ Melhoria" trazia o visual SELECIONADO
// cravado no atributo style (borda e fundo da cor primária). Estilo inline
// vence classe, então `classList.remove('ativo')` não desfazia nada — ele ficava
// aceso para sempre, e escolher "🐛 Bug" deixava DOIS botões acesos. Estes
// testes travam a correção: o visual mora na classe, o estado é a classe.
//
// O segundo é de diagnóstico. O envio dependia de um toast que nasce no topo da
// página e some em 3,5s — no celular, quem olha para o botão no fim de um
// formulário longo nunca vê por que falhou. Agora há uma linha fixa ao lado do
// botão, um teto de tempo (uma escrita pendente não deixa mais o botão travado
// para sempre) e o carimbo de data não depende mais do global `firebase` cru.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const DUVIDAS = fs.readFileSync(path.join(ROOT, 'web/appliquei-duvidas.js'), 'utf8');

/** Os três botões de tipo, como estão escritos no HTML. */
function botoesTipo() {
  return HTML.match(/<button[^>]*class="sug-tipo-btn[^"]*"[^>]*>/g) || [];
}

// ---------------------------------------------------------------------------
// O seletor de tipo
// ---------------------------------------------------------------------------

test('nenhum botão de tipo carrega estilo inline — o visual é da classe', () => {
  const btns = botoesTipo();
  assert.equal(btns.length, 3, 'melhoria, novo e bug');
  btns.forEach((b) => {
    assert.ok(
      !/\sstyle=/.test(b),
      `"${b}" ainda tem style inline: ele venceria .sug-tipo-btn.ativo e o botão ficaria aceso para sempre`
    );
  });
});

test('só o botão de melhoria nasce com a classe ativo', () => {
  const ativos = botoesTipo().filter((b) => /class="sug-tipo-btn ativo"/.test(b));
  assert.equal(ativos.length, 1);
  assert.match(ativos[0], /data-tipo="melhoria"/);
});

test('o estado do botão também é anunciado por aria-pressed', () => {
  const btns = botoesTipo();
  btns.forEach((b) => assert.match(b, /aria-pressed="(true|false)"/));
  assert.equal(btns.filter((b) => /aria-pressed="true"/.test(b)).length, 1);
});

test('a classe .sug-tipo-btn define o visual inativo E o ativo', () => {
  const bloco = HTML.slice(HTML.indexOf('.sug-tipo-btn {'), HTML.indexOf('.sug-historico-item {'));
  assert.match(bloco, /\.sug-tipo-btn \{[^}]*background:/, 'o fundo padrão sai do inline');
  assert.match(bloco, /\.sug-tipo-btn \{[^}]*border:/, 'a borda padrão também');
  assert.match(bloco, /\.sug-tipo-btn\.ativo \{/, 'e o estado selecionado tem a sua regra');
});

test('selecionarTipoSugestao troca classe e aria em TODOS os botões', () => {
  // O bug era justamente não desfazer o estado do anterior. A função tem de
  // varrer os três, não só marcar o novo.
  const ini = DUVIDAS.indexOf('function selecionarTipoSugestao(');
  const corpo = DUVIDAS.slice(ini, DUVIDAS.indexOf('\n}', ini));
  assert.match(corpo, /querySelectorAll\('\.sug-tipo-btn'\)/);
  assert.match(corpo, /classList\.toggle\('ativo', ativo\)/);
  assert.match(corpo, /setAttribute\('aria-pressed'/);
});

test('um tipo desconhecido cai em melhoria, não grava lixo', () => {
  assert.match(DUVIDAS, /SUG_TIPOS\.indexOf\(tipo\) === -1 \? 'melhoria' : tipo/);
});

// ---------------------------------------------------------------------------
// O envio
// ---------------------------------------------------------------------------

test('há uma linha de status fixa ao lado do botão de enviar', () => {
  assert.match(HTML, /id="sugStatus"/, 'o toast some em 3,5s — o status fica');
  assert.match(HTML, /id="sugStatus"[^>]*aria-live="polite"/);
  assert.match(HTML, /id="sugBtnEnviar"/, 'o botão precisa de id próprio para ser travado');
});

test('a validação leva o cursor até o campo que falta', () => {
  const ini = DUVIDAS.indexOf('function enviarSugestao(');
  const corpo = DUVIDAS.slice(ini, DUVIDAS.indexOf('\nvar SUG_LABELS_ABA', ini));
  assert.match(corpo, /sugFocar\('sugAba'\)/);
  assert.match(corpo, /sugFocar\('sugTexto'\)/);
  assert.match(corpo, /sugFocar\('sugOutroTema'\)/);
});

test('o envio tem teto de tempo — escrita pendente não trava o botão para sempre', () => {
  assert.match(DUVIDAS, /var SUG_TIMEOUT_MS = \d+;/);
  assert.match(DUVIDAS, /function sugComTeto\(/);
  assert.match(DUVIDAS, /sugComTeto\(\s*ctx\.user/, 'o teto tem de envolver a cadeia de envio');
  assert.match(DUVIDAS, /code === 'app\/timeout'/, 'e o timeout tem mensagem própria');
});

test('o cliente não fala mais com o Firestore — envio e leitura vão pelo servidor', () => {
  // CAUSA RAIZ do "nunca consegui enviar nada por lá": a coleção `feedback`
  // era escrita e lida direto pelo SDK do cliente, e isso depende de a
  // Security Rule `match /feedback/{id}` estar PUBLICADA no projeto. A regra e
  // o formulário entraram no mesmo commit e não há CI que publique
  // firestore.rules — sem o deploy manual vale a negação implícita e todo
  // envio volta `permission-denied`, com o e-mail verificado e tudo.
  assert.ok(
    !/collection\('feedback'\)/.test(DUVIDAS),
    'nenhuma escrita/leitura direta da coleção pode sobrar no cliente'
  );
  assert.ok(
    !/\bfirebase\.firestore\b/.test(DUVIDAS),
    'nem o global cru do Firestore — o servidor carimba o createdAt'
  );
  assert.match(DUVIDAS, /sugApiFetch\('\/api\/user\?op=feedback', \{\s*method: 'POST'/);
  assert.match(
    DUVIDAS,
    /sugApiFetch\('\/api\/user\?op=feedback'\)/,
    'o histórico também vem do servidor'
  );
});

test('a chamada ao endpoint leva um token novo, não o do cache', () => {
  // Depois de confirmar o e-mail, o token em cache ainda traz
  // email_verified=false e o servidor recusaria com 403.
  const ini = DUVIDAS.indexOf('function sugApiFetch(');
  const corpo = DUVIDAS.slice(ini, DUVIDAS.indexOf('\nfunction ', ini + 10));
  assert.match(corpo, /\.reload\(\)/);
  assert.match(corpo, /getIdToken\(true\)/);
  assert.match(corpo, /Authorization: 'Bearer ' \+ token/);
});

test('cada erro do endpoint tem mensagem própria — nada de "não foi possível" genérico', () => {
  ['api/email_not_verified', 'api/rate_limited', 'api/invalid_body', 'api/invalid_token'].forEach(
    (c) => assert.ok(DUVIDAS.indexOf(`'${c}'`) !== -1, `falta tratar ${c}`)
  );
});

test('falha ao buscar o histórico não apaga o que já está na tela', () => {
  const ini = DUVIDAS.indexOf('function renderizarHistoricoSugestoes(');
  const corpo = DUVIDAS.slice(ini, DUVIDAS.indexOf('\nfunction desenharHistoricoSugestoes'));
  assert.match(corpo, /desenharHistoricoSugestoes\(carregarSugestoes\(\)\)/, 'pinta o cache antes');
  const catchIdx = corpo.indexOf('.catch(');
  assert.ok(catchIdx !== -1);
  assert.ok(
    !/desenharHistoricoSugestoes/.test(corpo.slice(catchIdx)),
    'o catch não pode redesenhar com lista vazia'
  );
});

test('a sessão é aferida pelo usuário autenticado, não pelo Firestore', () => {
  // Exigir `fb.db` fazia o app dizer "você não está conectado" só porque o
  // compat do Firestore não carregou — um erro sobre a coisa errada.
  const ini = DUVIDAS.indexOf('function sugFirebaseUser(');
  const corpo = DUVIDAS.slice(ini, DUVIDAS.indexOf('\n}', ini));
  assert.ok(!/fb\.db/.test(corpo));
  assert.match(corpo, /return u \? \{ fb: fb, user: u \} : null;/);
});

test('o botão é reabilitado em qualquer desfecho', () => {
  assert.match(DUVIDAS, /\.finally\(function \(\) \{\s*if \(btn\) btn\.disabled = false;/);
});

test('o formulário se inicializa ao abrir a aba, não só no window.onload', () => {
  // inicializarFormSugestao era a ÚLTIMA chamada de um window.onload longo: um
  // erro em qualquer passo anterior deixava o formulário sem listener nenhum —
  // contador travado em 0 e o campo "sobre o que é" invisível para sempre.
  const APP = fs.readFileSync(path.join(ROOT, 'web/appliquei-app.js'), 'utf8');
  const ini = APP.indexOf("if (idAba === 'duvidas_sugestoes')");
  const bloco = APP.slice(ini, APP.indexOf('}', ini));
  assert.match(bloco, /inicializarFormSugestao\(\)/, 'abrir a aba tem de garantir a montagem');
  assert.match(
    DUVIDAS,
    /var sugFormPronto = false;[\s\S]{0,200}if \(sugFormPronto\) return;/,
    'e a montagem precisa ser idempotente, senão duplica os listeners'
  );
});

// ---------------------------------------------------------------------------
// A revisão do conteúdo
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Anexo de imagem
//
// Descrever um defeito de tela em palavras é difícil; um print resolve. O que
// estes testes travam não é a existência do botão, é o que ele faz: a imagem
// que sobe é REDESENHADA aqui, nunca o arquivo original.
// ---------------------------------------------------------------------------

test('o campo aceita só imagem e o input nativo fica escondido atrás do botão', () => {
  const inp = HTML.match(/<input[^>]*id="sugAnexoInput"[^>]*>/);
  assert.ok(inp, 'o input de arquivo existe');
  assert.match(inp[0], /type="file"/);
  assert.match(inp[0], /accept="image\/\*"/, 'o seletor do sistema já abre filtrado');
  assert.match(inp[0], /display:\s*none/, 'o controle nativo não aceita estilo; o botão é a UI');
  assert.match(inp[0], /onchange="sugAnexoTrocou\(this\)"/);
  assert.match(HTML, /id="sugAnexoBtn"[^>]*onclick="sugAnexoAbrirSeletor\(\)"/);
});

test('o que sobe é a imagem REDESENHADA, não o arquivo escolhido', () => {
  // É o que garante os três efeitos de uma vez: tamanho previsível, EXIF (e
  // portanto o GPS da foto) descartado, e o corpo do POST cabendo na função.
  assert.match(DUVIDAS, /canvas/i);
  assert.match(DUVIDAS, /toDataURL\(/);
  assert.ok(
    !/readAsDataURL/.test(DUVIDAS),
    'ler o arquivo direto mandaria os bytes originais, com EXIF e tudo'
  );
});

test('o alvo do cliente fica abaixo do teto do servidor', () => {
  // Se a compressão errar por pouco, quem recusa é o formulário, com uma
  // mensagem em português — não um 400 da API.
  const SCHEMAS = fs.readFileSync(path.join(ROOT, 'api/_lib/schemas.js'), 'utf8');
  const teto = Number((SCHEMAS.match(/ANEXO_MAX_B64\s*=\s*(\d+)/) || [])[1]);
  const alvo = Number((DUVIDAS.match(/SUG_ANEXO_ALVO_B64\s*=\s*(\d+)/) || [])[1]);
  assert.ok(teto > 0 && alvo > 0, 'os dois limites existem');
  assert.ok(alvo < teto, `o alvo do cliente (${alvo}) tem de caber no teto do servidor (${teto})`);
});

test('a transparência vira branco antes de virar JPEG, não preto', () => {
  const desenhar = DUVIDAS.slice(DUVIDAS.indexOf('function sugAnexoDesenhar'));
  assert.match(desenhar.slice(0, 800), /fillStyle\s*=\s*'#ffffff'/);
  assert.match(desenhar.slice(0, 800), /fillRect\(/);
});

test('o suporte a WebP é aferido pelo resultado, não por lista de navegador', () => {
  // Navegador que não conhece o formato devolve PNG calado; pedir e conferir
  // o prefixo é a única checagem que não envelhece.
  assert.match(DUVIDAS, /indexOf\('data:image\/webp'\)\s*!==\s*0/);
});

test('o corpo enviado leva só os quatro campos que o schema conhece', () => {
  // feedbackCreateBody é strict(): um campo a mais derruba o envio com 400.
  const envio = DUVIDAS.slice(
    DUVIDAS.indexOf("sugApiFetch('/api/user?op=feedback'"),
    DUVIDAS.indexOf('.then(function () {', DUVIDAS.indexOf("sugApiFetch('/api/user?op=feedback'"))
  );
  const anexo = envio.slice(envio.indexOf('anexo:'));
  ['mime:', 'dados:', 'largura:', 'altura:'].forEach((c) =>
    assert.ok(anexo.includes(c), `falta ${c}`)
  );
  assert.ok(!anexo.includes('nome:'), 'nome é de uso local — o schema recusaria');
  assert.ok(!anexo.includes('bytes:'), 'bytes é medido pelo servidor');
});

test('enviar limpa o anexo junto com o resto do formulário', () => {
  // Sem isto, a sugestão seguinte sairia com o print da anterior.
  const sucesso = DUVIDAS.slice(
    DUVIDAS.indexOf("document.getElementById('sugContador').innerText")
  );
  assert.match(sucesso.slice(0, 400), /sugAnexoAtual\s*=\s*null/);
  assert.match(sucesso.slice(0, 400), /sugAnexoPintar\(\)/);
});

test('o histórico não baixa as imagens — busca sob demanda', () => {
  // São dezenas de itens com centenas de KB cada; carregar todas para mostrar
  // duas seria caro à toa, principalmente no celular.
  assert.match(DUVIDAS, /op=feedback-anexo/);
  const desenho = DUVIDAS.slice(
    DUVIDAS.indexOf('function desenharHistoricoSugestoes'),
    DUVIDAS.indexOf('function sugVerAnexo')
  );
  assert.ok(
    !/op=feedback-anexo/.test(desenho),
    'o desenho da lista só põe o botão; quem busca é sugVerAnexo'
  );
  assert.match(desenho, /sugVerAnexo\(/);
});

test('o id só vira atributo onclick se tiver o formato de id do Firestore', () => {
  // escSug() escapa só `<`. Em vez de um segundo escapador, exigimos o
  // formato — o que não passa não vira botão.
  const desenho = DUVIDAS.slice(
    DUVIDAS.indexOf('function desenharHistoricoSugestoes'),
    DUVIDAS.indexOf('function sugVerAnexo')
  );
  assert.match(desenho, /\[A-Za-z0-9_-\]\{1,64\}/);
});

test('a lista "Aba relacionada" cobre as abas do menu de hoje', () => {
  const bloco = HTML.slice(
    HTML.indexOf('<select id="sugAba">'),
    HTML.indexOf('</select>', HTML.indexOf('<select id="sugAba">'))
  );
  [
    'meu_patrimonio',
    'controle',
    'patrimonio',
    'carteira',
    'relatorio_mensal',
    'simulador',
    'meus_sonhos',
    'aulas',
    'noticias',
    'applicash',
    'conta',
    'duvidas_sugestoes',
    'outro',
  ].forEach((v) => assert.match(bloco, new RegExp(`value="${v}"`), `falta a opção ${v}`));
});

test('toda opção de "Aba relacionada" tem rótulo no histórico', () => {
  const bloco = HTML.slice(
    HTML.indexOf('<select id="sugAba">'),
    HTML.indexOf('</select>', HTML.indexOf('<select id="sugAba">'))
  );
  const valores = [...bloco.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  const rot = DUVIDAS.slice(
    DUVIDAS.indexOf('var SUG_LABELS_ABA = {'),
    DUVIDAS.indexOf('};', DUVIDAS.indexOf('var SUG_LABELS_ABA = {'))
  );
  valores.forEach((v) =>
    assert.match(rot, new RegExp(`\\b${v}:`), `sugestão gravada como "${v}" sairia sem rótulo`)
  );
});

test('toda pergunta do FAQ cai numa categoria que o filtro conhece', () => {
  const filtro = HTML.slice(
    HTML.indexOf('<select id="faqCategoriaFiltro"'),
    HTML.indexOf('</select>', HTML.indexOf('<select id="faqCategoriaFiltro"'))
  );
  const conhecidas = new Set([...filtro.matchAll(/value="([^"]*)"/g)].map((m) => m[1]));
  const usadas = new Set([...DUVIDAS.matchAll(/^\s{4}cat: '([^']+)',$/gm)].map((m) => m[1]));
  assert.ok(usadas.size > 0, 'o FAQ precisa ter itens');
  usadas.forEach((c) =>
    assert.ok(conhecidas.has(c), `a categoria "${c}" não existe no filtro — os itens sumiriam`)
  );
});

// Só as RESPOSTAS, sem o comentário de cabeçalho do arquivo.
const FAQ_TEXTO = DUVIDAS.slice(
  DUVIDAS.indexOf('var FAQ_DADOS = ['),
  DUVIDAS.indexOf('function abrirFaqItem(')
);

test('o FAQ fala do que existe hoje: aporte externo, retroativo, contas e bens', () => {
  assert.match(FAQ_TEXTO, /Aporte externo — dinheiro de fora do app/);
  assert.match(FAQ_TEXTO, /cadastro retroativo/i);
  assert.match(FAQ_TEXTO, /Minhas Contas/);
  assert.match(FAQ_TEXTO, /Meus Bens/);
  assert.match(FAQ_TEXTO, /anexe uma imagem/i, 'o campo existe no formulário; o FAQ o explica');
  assert.ok(
    !/Visão geral do patrimônio/.test(FAQ_TEXTO),
    'a aba mudou de nome para "Meus investimentos" — o FAQ mandava a pessoa a um lugar que não existe'
  );
  assert.ok(
    !/Líquido \(pós-IR\)/.test(FAQ_TEXTO),
    'o alternador Bruto/Líquido saiu do Meu patrimônio — o FAQ não pode explicar um botão que não existe mais'
  );
});

test('o FAQ explica que o aporte externo não desconta do caixa', () => {
  // É a regra que o usuário apontou. Se ela mudar no motor, a resposta aqui
  // tem de mudar junto — este teste é o lembrete.
  const item = FAQ_TEXTO.slice(FAQ_TEXTO.indexOf('O que é o "Aporte externo'));
  assert.match(item.slice(0, 1200), /não é descontado do caixa/);
  assert.match(item.slice(0, 1200), /Aporte externo \(fora do caixa\)/);
});
