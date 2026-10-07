// ============================================================
// --- Política de Privacidade: texto, aceite e registro ---
// ============================================================
// O texto da política mora aqui, num lugar só: a janela de aceite, o cadastro
// e a aba "Privacidade" de Dúvidas & sugestões leem daqui. Duas cópias do
// mesmo documento divergiriam na primeira revisão — e a desatualizada seria a
// que o usuário aceitou.
//
// O aceite é registrado no SERVIDOR (/api/user?op=privacidade), com o uid do
// token e a hora do servidor: é a prova do consentimento. O navegador guarda
// uma cópia só para não perguntar de novo a cada abertura.
//
// Mudou o texto de forma relevante: mude PRIVACIDADE_VERSAO (aqui e em
// api/user.js — um teste confere que são iguais). Quem aceitou a versão
// anterior vê a política de novo e aceita a nova.

var PRIVACIDADE_VERSAO = '2026-10-06';
var PRIVACIDADE_CHAVE = 'appliquei_privacidade_aceite';

// Identificação do controlador (LGPD, art. 9º). Preencha antes de publicar:
// o que estiver vazio sai do texto em vez de aparecer como lacuna.
var PRIVACIDADE_CONTROLADOR = {
  nome: 'Appliquei',
  razaoSocial: '',
  cnpj: '',
  email: '',
};

function _privEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function privacidadeDataVersao() {
  const [a, m, d] = PRIVACIDADE_VERSAO.split('-');
  return d + '/' + m + '/' + a;
}

/** O texto integral da política, em HTML. */
function privacidadeTextoHtml() {
  const c = PRIVACIDADE_CONTROLADOR;
  const ident = [
    c.razaoSocial ? _privEsc(c.razaoSocial) : _privEsc(c.nome),
    c.cnpj ? 'CNPJ ' + _privEsc(c.cnpj) : '',
  ]
    .filter(Boolean)
    .join(', ');
  const contato = c.email
    ? 'pelo e-mail <strong>' +
      _privEsc(c.email) +
      '</strong> ou pela aba <strong>Enviar sugestão</strong>, em Dúvidas &amp; sugestões'
    : 'pela aba <strong>Enviar sugestão</strong>, em Dúvidas &amp; sugestões';
  return (
    '<p class="pol-versao">Versão de ' +
    privacidadeDataVersao() +
    '</p>' +
    '<p>Esta política explica quais dados pessoais a ' +
    ident +
    ' (“Appliquei”, “nós”) trata quando você usa o aplicativo, para que, com quem compartilha e quais são os seus direitos, nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018, “LGPD”).</p>' +
    '<h4>1. Quem é o controlador</h4>' +
    '<p>O controlador dos seus dados é a ' +
    ident +
    '. Para qualquer assunto sobre privacidade, inclusive falar com o encarregado pelo tratamento de dados, fale conosco ' +
    contato +
    '.</p>' +
    '<h4>2. Quais dados tratamos</h4>' +
    '<ul>' +
    '<li><strong>Dados de cadastro:</strong> e-mail e, se entrar com o Google, o nome e a foto da sua conta Google.</li>' +
    '<li><strong>Dados que você registra no app:</strong> receitas, despesas, contas, cartões, investimentos, bens, sonhos e demais informações financeiras que você mesmo digita. A Appliquei não se conecta à sua conta bancária.</li>' +
    '<li><strong>Dados de cobrança:</strong> se você assinar, nome, CPF ou CNPJ e, conforme a forma de pagamento, telefone e endereço. Os dados do cartão de crédito são enviados ao processador de pagamentos e não ficam guardados na Appliquei.</li>' +
    '<li><strong>Dados de uso e técnicos:</strong> telas abertas e eventos de navegação (Google Analytics), registros de erros técnicos (sem dados pessoais) e o endereço IP, usado para limitar abusos.</li>' +
    '<li><strong>Mensagens de suporte:</strong> o que você envia pela aba Enviar sugestão, inclusive imagens anexadas.</li>' +
    '<li><strong>Indicações (Applicash):</strong> o código de indicação usado no cadastro e o vínculo entre quem indicou e quem foi indicado.</li>' +
    '</ul>' +
    '<h4>3. Para que usamos e com que base legal</h4>' +
    '<ul>' +
    '<li><strong>Prestar o serviço</strong> (guardar, calcular e sincronizar suas informações entre aparelhos): execução do contrato (art. 7º, V).</li>' +
    '<li><strong>Cobrar a assinatura</strong> e emitir as cobranças: execução do contrato e cumprimento de obrigação legal (art. 7º, II e V).</li>' +
    '<li><strong>Segurança, prevenção de fraude e correção de erros:</strong> legítimo interesse (art. 7º, IX).</li>' +
    '<li><strong>Estatísticas de uso para melhorar o app:</strong> legítimo interesse (art. 7º, IX), sem uso dos seus valores financeiros.</li>' +
    '<li><strong>Responder às suas mensagens:</strong> execução do contrato (art. 7º, V).</li>' +
    '</ul>' +
    '<p>Não usamos seus dados financeiros para publicidade e não vendemos nem cedemos seus dados a terceiros.</p>' +
    '<h4>4. Com quem compartilhamos</h4>' +
    '<p>Só com os prestadores necessários para o app funcionar, cada um limitado ao que precisa:</p>' +
    '<ul>' +
    '<li><strong>Google (Firebase e Google Cloud):</strong> login, banco de dados e estatísticas de uso (Google Analytics).</li>' +
    '<li><strong>Vercel:</strong> hospedagem do aplicativo e dos serviços do servidor.</li>' +
    '<li><strong>Asaas:</strong> processamento dos pagamentos da assinatura.</li>' +
    '<li><strong>Sentry:</strong> registro de erros técnicos, sem dados pessoais.</li>' +
    '<li><strong>ViaCEP e BrasilAPI:</strong> o CEP digitado no cadastro de um imóvel, só para buscar o endereço.</li>' +
    '<li><strong>Fontes de dados de mercado</strong> (como B3/BRAPI, Yahoo Finance, CoinGecko, Tesouro Direto, Banco Central e tabela FIPE): recebem apenas os códigos de ativos, veículos e índices consultados, nunca dados seus.</li>' +
    '</ul>' +
    '<p>Também podemos compartilhar dados quando a lei ou uma autoridade competente exigir.</p>' +
    '<h4>5. Transferência internacional</h4>' +
    '<p>Google, Vercel e Sentry podem guardar e processar dados em servidores fora do Brasil, principalmente nos Estados Unidos. Essas empresas adotam cláusulas contratuais e medidas de segurança compatíveis com a LGPD (art. 33).</p>' +
    '<h4>6. Como protegemos</h4>' +
    '<ul>' +
    '<li>Toda comunicação entre o seu aparelho e os nossos servidores é criptografada (HTTPS).</li>' +
    '<li>Os dados ficam guardados criptografados em disco no Google Cloud.</li>' +
    '<li>As regras do banco de dados só liberam a leitura dos seus lançamentos para a sua própria conta, com e-mail confirmado.</li>' +
    '<li>A senha é tratada pelo Firebase Authentication; a Appliquei não a vê nem a armazena.</li>' +
    '<li>O acesso administrativo é restrito, usado para manter o serviço e atender pedidos de suporte. A criptografia não é de ponta a ponta.</li>' +
    '</ul>' +
    '<p>Uma cópia dos seus dados fica no navegador do seu aparelho, para o app abrir rápido. Mantenha o bloqueio de tela ativado e não use o app em aparelhos compartilhados sem sair da conta.</p>' +
    '<h4>7. Armazenamento no navegador</h4>' +
    '<p>O app usa o armazenamento local do navegador para guardar seus dados e preferências (tema, valores ocultos, abas abertas). O Google Analytics usa cookies para contar visitas. Você pode limpar esses dados nas configurações do navegador; os dados da sua conta continuam na nuvem.</p>' +
    '<h4>8. Por quanto tempo guardamos</h4>' +
    '<ul>' +
    '<li>Seus dados financeiros e de cadastro: enquanto a conta existir.</li>' +
    '<li>Registros de cobrança: pelo prazo exigido pela legislação fiscal.</li>' +
    '<li>Registros de erros e de uso: pelo período de retenção dos prestadores (Sentry e Google Analytics).</li>' +
    '</ul>' +
    '<p>Ao excluir a conta, apagamos os dados, exceto o que a lei nos obriga a guardar.</p>' +
    '<h4>9. Seus direitos</h4>' +
    '<p>Pela LGPD (art. 18), você pode pedir a qualquer momento: confirmação de que tratamos seus dados; acesso; correção; anonimização, bloqueio ou eliminação de dados desnecessários; portabilidade; informação sobre com quem compartilhamos; e revogação do consentimento, quando ele for a base legal.</p>' +
    '<ul>' +
    '<li><strong>Exportar seus dados:</strong> botão Backup, a qualquer momento.</li>' +
    '<li><strong>Apagar seus lançamentos:</strong> Recomeçar do zero, em Configurações.</li>' +
    '<li><strong>Corrigir dados:</strong> editando no próprio app.</li>' +
    '<li><strong>Excluir a conta e os dados</strong> e os demais pedidos: ' +
    contato +
    '.</li>' +
    '</ul>' +
    '<p>Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).</p>' +
    '<h4>10. Menores de idade</h4>' +
    '<p>O app é destinado a maiores de 18 anos. Se soubermos que tratamos dados de um menor sem autorização dos responsáveis, os apagaremos.</p>' +
    '<h4>11. Mudanças nesta política</h4>' +
    '<p>Se mudarmos esta política de forma relevante, avisaremos no app e pediremos que você leia e aceite a nova versão antes de continuar.</p>'
  );
}

// ------------------------------------------------------------
// Estado do aceite
// ------------------------------------------------------------

function _privLer() {
  try {
    return JSON.parse(localStorage.getItem(PRIVACIDADE_CHAVE) || 'null');
  } catch (e) {
    return null;
  }
}

function _privGravar(reg) {
  try {
    localStorage.setItem(PRIVACIDADE_CHAVE, JSON.stringify(reg));
  } catch (e) {}
}

/**
 * Aceite da versão vigente registrado neste aparelho para a conta em uso (ou
 * null). O registro diz de quem é (uid, ou o e-mail digitado no cadastro,
 * antes de a conta existir): no mesmo navegador, o aceite de uma pessoa não
 * pode valer pela outra.
 */
function privacidadeAceiteLocal() {
  const r = _privLer();
  if (!r || r.versao !== PRIVACIDADE_VERSAO) return null;
  const u = _privUsuario();
  if (!u) return r;
  if (r.uid) return r.uid === u.uid ? r : null;
  const email = String(u.email || '').toLowerCase();
  return r.email && r.email === email ? r : null;
}

function _privUsuario() {
  const fb = window.AppliqueiFirebase;
  return fb && fb.auth && fb.auth.currentUser ? fb.auth.currentUser : null;
}

function _privApi(metodo, corpo) {
  const u = _privUsuario();
  if (!u) return Promise.reject(new Error('sem sessão'));
  return u.getIdToken().then(function (token) {
    return fetch('/api/user?op=privacidade', {
      method: metodo,
      headers: Object.assign(
        { Authorization: 'Bearer ' + token },
        corpo ? { 'Content-Type': 'application/json' } : {}
      ),
      body: corpo ? JSON.stringify(corpo) : undefined,
      credentials: 'same-origin',
    }).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (j) {
          if (!r.ok)
            throw Object.assign(new Error(j.error || 'http_' + r.status), { status: r.status });
          return j;
        });
    });
  });
}

/**
 * Registra o aceite: neste aparelho na hora, e no servidor assim que houver
 * sessão. Sem sessão (o cadastro ainda está criando a conta), fica pendente e
 * sobe na próxima verificação.
 */
function registrarAceitePrivacidade(origem, email) {
  const u = _privUsuario();
  const reg = {
    versao: PRIVACIDADE_VERSAO,
    em: new Date().toISOString(),
    origem: origem === 'cadastro' ? 'cadastro' : 'app',
    enviado: false,
    uid: u ? u.uid : null,
    email: String(email || (u && u.email) || '').toLowerCase(),
  };
  _privGravar(reg);
  _privEnviarPendente();
  privacidadeRenderStatus();
}

function _privEnviarPendente() {
  const r = privacidadeAceiteLocal();
  if (!r || r.enviado || !_privUsuario()) return Promise.resolve();
  return _privApi('POST', { versao: r.versao, origem: r.origem })
    .then(function (j) {
      const u = _privUsuario();
      _privGravar(
        Object.assign({}, r, {
          enviado: true,
          uid: u ? u.uid : r.uid,
          em: j && j.aceitoEmMs ? new Date(j.aceitoEmMs).toISOString() : r.em,
        })
      );
      privacidadeRenderStatus();
    })
    .catch(function () {
      // Rede fora: fica pendente e sobe na próxima abertura.
    });
}

/**
 * Chamada quando há sessão: confere no servidor se a versão vigente foi
 * aceita. Aceita lá: lembra aqui. Aceita só aqui (cadastro): sobe. Em lugar
 * nenhum: abre a janela de aceite.
 */
function privacidadeVerificar() {
  if (!_privUsuario()) return;
  const local = privacidadeAceiteLocal();
  if (local && !local.enviado) {
    _privEnviarPendente();
    return;
  }
  _privApi('GET')
    .then(function (j) {
      if (j && j.aceito) {
        const u = _privUsuario();
        _privGravar({
          versao: PRIVACIDADE_VERSAO,
          em: new Date(j.aceitoEmMs || Date.now()).toISOString(),
          origem: (local && local.origem) || 'app',
          enviado: true,
          uid: u ? u.uid : null,
          email: String((u && u.email) || '').toLowerCase(),
        });
        privacidadeRenderStatus();
      } else if (!local) {
        abrirModalPrivacidade(true);
      } else {
        // Marcado como enviado aqui, mas o servidor não tem: reenvia.
        _privGravar(Object.assign({}, local, { enviado: false }));
        _privEnviarPendente();
      }
    })
    .catch(function () {
      // Sem resposta do servidor não se bloqueia ninguém: sem aceite local, a
      // janela abre; com aceite local, segue.
      if (!local) abrirModalPrivacidade(true);
    });
}

// ------------------------------------------------------------
// Janela da política
// ------------------------------------------------------------

/**
 * `exigir`: true abre a janela de aceite (sem fechar, com "Aceitar" e
 * "Sair da conta"); false abre só para leitura.
 */
function abrirModalPrivacidade(exigir) {
  const m = document.getElementById('modalPrivacidade');
  if (!m) return;
  const corpo = document.getElementById('modalPrivacidadeTexto');
  if (corpo) corpo.innerHTML = privacidadeTextoHtml();
  m.dataset.exigir = exigir ? '1' : '0';
  const chk = document.getElementById('modalPrivacidadeChk');
  if (chk) chk.checked = false;
  const btn = document.getElementById('modalPrivacidadeAceitar');
  if (btn) btn.disabled = true;
  m.style.display = 'flex';
  if (corpo) corpo.scrollTop = 0;
}

function fecharModalPrivacidade() {
  const m = document.getElementById('modalPrivacidade');
  if (!m || m.dataset.exigir === '1') return;
  m.style.display = 'none';
}

function privacidadeMarcou(chk) {
  const btn = document.getElementById('modalPrivacidadeAceitar');
  if (btn) btn.disabled = !chk.checked;
}

function aceitarPrivacidadeModal() {
  const chk = document.getElementById('modalPrivacidadeChk');
  if (!chk || !chk.checked) return;
  registrarAceitePrivacidade('app');
  const m = document.getElementById('modalPrivacidade');
  if (m) {
    m.dataset.exigir = '0';
    m.style.display = 'none';
  }
  if (typeof mostrarToast === 'function')
    mostrarToast('Obrigado! Política de privacidade aceita.', 'sucesso');
}

/** Recusar = não usar o app com esta conta: sai da conta. */
function recusarPrivacidade() {
  const m = document.getElementById('modalPrivacidade');
  if (m) {
    m.dataset.exigir = '0';
    m.style.display = 'none';
  }
  if (typeof window.appliqueiAuthSignOut === 'function') window.appliqueiAuthSignOut();
}

/** Status do aceite na aba "Privacidade". */
function privacidadeRenderStatus() {
  const el = document.getElementById('privStatusAceite');
  if (!el) return;
  const r = privacidadeAceiteLocal();
  el.innerHTML = r
    ? '<i class="ph-fill ph-check-circle"></i> Você aceitou esta versão em ' +
      _privEsc(new Date(r.em).toLocaleDateString('pt-BR')) +
      '.'
    : '<i class="ph ph-info"></i> Versão de ' + privacidadeDataVersao() + '.';
}

// O Firebase sobe num módulo à parte; espera ele ficar pronto (até ~30s) para
// ouvir o login. Cada login (e a sessão restaurada ao abrir) confere o aceite.
function _privLigarAuth(tentativa) {
  const fb = window.AppliqueiFirebase;
  if (fb && fb.ready && fb.auth && typeof fb.auth.onAuthStateChanged === 'function') {
    fb.auth.onAuthStateChanged(function (u) {
      if (u) setTimeout(privacidadeVerificar, 800);
    });
    return;
  }
  if ((tentativa || 0) < 60) setTimeout(() => _privLigarAuth((tentativa || 0) + 1), 500);
}

document.addEventListener('DOMContentLoaded', function () {
  privacidadeRenderStatus();
  _privLigarAuth(0);
});
