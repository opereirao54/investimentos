// ============================================================
// --- Excluir a conta (LGPD) ---
// ============================================================
// Em Configurações, abaixo do "Recomeçar do zero". A diferença entre os dois
// precisa ficar óbvia na tela: recomeçar apaga os REGISTROS e mantém a conta;
// excluir apaga a CONTA — login, assinatura, Applicash e tudo o mais.
//
// Três travas antes do pedido sair:
//   1. digitar EXCLUIR (a mesma ideia do RECOMECAR);
//   2. confirmar a identidade de novo — a senha, ou a janela do Google. O
//      servidor recusa (401 reautenticar) um login com mais de 10 minutos;
//   3. o próprio servidor cancela a assinatura no Asaas ANTES de apagar
//      qualquer coisa, e devolve erro sem apagar nada se o Asaas falhar
//      (api/_lib/excluir-conta.js).
//
// Deu certo: limpa este aparelho (localStorage do app), sai da conta e vai
// para a landing com o aviso de conta excluída.

var EXCLUIR_PALAVRA_CONFIRMACAO = 'EXCLUIR';

function _exclUsuario() {
  var fb = window.AppliqueiFirebase;
  return fb && fb.auth && fb.auth.currentUser ? fb.auth.currentUser : null;
}

/** 'password' (e-mail e senha) ou 'google.com' — como pedir a identidade. */
function _exclProvedor(u) {
  var lista = (u && u.providerData) || [];
  for (var i = 0; i < lista.length; i++) {
    if (lista[i] && lista[i].providerId === 'password') return 'password';
  }
  return 'google.com';
}

function _exclEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function abrirModalExcluirConta() {
  var modal = document.getElementById('modalConfirmacao');
  if (!modal) return;
  if (typeof fecharModalConfig === 'function') fecharModalConfig();
  var u = _exclUsuario();
  var senha = _exclProvedor(u) === 'password';

  document.getElementById('modalTitulo').innerHTML =
    '<i class="ph-fill ph-user-minus" style="color: var(--cor-erro);"></i> Excluir minha conta';

  document.getElementById('modalMensagem').innerHTML =
    'Vamos apagar <strong>a sua conta' +
    (u && u.email ? ' (' + _exclEsc(u.email) + ')' : '') +
    '</strong> e tudo o que está nela: lançamentos, investimentos, contas, cartões, bens, sonhos, o vínculo com o Telegram e as sugestões que você enviou.<br><br>' +
    '<span style="display:block;background:var(--cor-bg-erro);border:1px solid var(--cor-borda-erro);color:var(--cor-txt-erro);border-radius:9px;padding:10px 12px;font-size:12.5px;line-height:1.55;margin-bottom:14px;">' +
    '<i class="ph-fill ph-warning" style="vertical-align:-2px;"></i> <strong>Não dá para desfazer.</strong> ' +
    'A assinatura é cancelada e os dias que ainda faltam do período pago são perdidos. ' +
    'O saldo do Applicash e o desconto de indicação também. ' +
    'Guardamos apenas o registro dos pagamentos, pelo prazo que a lei fiscal exige.' +
    '</span>' +
    '<span style="display:block;background:var(--cor-bg-info);border:1px solid var(--cor-borda-info);color:var(--cor-txt-info);border-radius:9px;padding:10px 12px;font-size:12.5px;line-height:1.55;margin-bottom:14px;">' +
    '<i class="ph-fill ph-info" style="vertical-align:-2px;"></i> Pagou nos últimos 7 dias e quer o dinheiro de volta? ' +
    'Peça o reembolso pela aba <strong>Enviar sugestão</strong> <em>antes</em> de excluir — depois não teremos como falar com você pela conta.' +
    '</span>' +
    '<label for="inputConfirmaExcluir" style="display:block;font-size:12px;font-weight:600;color:var(--cor-texto-secundario);margin-bottom:6px;">' +
    'Para confirmar, digite <strong style="font-family:\'DM Mono\',monospace;color:var(--cor-erro);">' +
    EXCLUIR_PALAVRA_CONFIRMACAO +
    '</strong></label>' +
    '<input type="text" id="inputConfirmaExcluir" autocomplete="off" autocapitalize="characters" spellcheck="false" ' +
    'placeholder="' +
    EXCLUIR_PALAVRA_CONFIRMACAO +
    '" oninput="validarConfirmacaoExcluir()" ' +
    'style="width:100%;padding:10px 13px;border:1.5px solid var(--cor-borda);border-radius:9px;font-size:14px;margin-bottom:12px;' +
    "font-family:'DM Mono',monospace;letter-spacing:1px;text-transform:uppercase;background:var(--cor-superficie);color:var(--cor-texto-principal);\">" +
    (senha
      ? '<label for="inputSenhaExcluir" style="display:block;font-size:12px;font-weight:600;color:var(--cor-texto-secundario);margin-bottom:6px;">Sua senha</label>' +
        '<input type="password" id="inputSenhaExcluir" autocomplete="current-password" oninput="validarConfirmacaoExcluir()" ' +
        'style="width:100%;padding:10px 13px;border:1.5px solid var(--cor-borda);border-radius:9px;font-size:14px;background:var(--cor-superficie);color:var(--cor-texto-principal);">'
      : '<p style="font-size:12px;color:var(--cor-texto-mutado);margin:0;">Para confirmar que é você, o Google vai pedir para entrar de novo.</p>') +
    '<p id="excluirErro" role="alert" style="display:none;margin-top:10px;font-size:12.5px;color:var(--cor-erro);"></p>';

  document.getElementById('modalAcoes').innerHTML =
    '<button class="btn-secundario" onclick="exportarDados()"><i class="ph ph-download-simple"></i> Baixar backup antes</button>' +
    '<button class="btn-acao" id="btnConfirmaExcluir" style="background:var(--cor-erro);box-shadow:0 2px 8px rgba(220,38,38,0.25);" onclick="executarExclusaoConta()">' +
    '<i class="ph ph-trash"></i> Excluir minha conta</button>';

  modal.style.display = 'flex';
  validarConfirmacaoExcluir();
}

function validarConfirmacaoExcluir() {
  var input = document.getElementById('inputConfirmaExcluir');
  var senha = document.getElementById('inputSenhaExcluir');
  var btn = document.getElementById('btnConfirmaExcluir');
  var palavra =
    typeof _normalizarConfirmacaoReset === 'function'
      ? _normalizarConfirmacaoReset(input && input.value)
      : String((input && input.value) || '')
          .trim()
          .toUpperCase();
  var ok = palavra === EXCLUIR_PALAVRA_CONFIRMACAO && (!senha || senha.value.length > 0);
  if (btn) {
    btn.disabled = !ok;
    btn.style.opacity = ok ? '1' : '0.45';
    btn.style.cursor = ok ? 'pointer' : 'not-allowed';
  }
  return ok;
}

function _exclMostrarErro(msg) {
  var el = document.getElementById('excluirErro');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
  var btn = document.getElementById('btnConfirmaExcluir');
  if (btn) btn.innerHTML = '<i class="ph ph-trash"></i> Excluir minha conta';
  validarConfirmacaoExcluir();
}

/** Mensagem para o usuário a partir do erro do Firebase ou do servidor. */
function _exclMensagemErro(e) {
  var code = (e && (e.code || e.error)) || '';
  if (
    code === 'auth/wrong-password' ||
    code === 'auth/invalid-credential' ||
    code === 'auth/invalid-login-credentials'
  )
    return 'Senha incorreta. Confira e tente de novo.';
  if (code === 'auth/too-many-requests')
    return 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request')
    return 'A janela do Google foi fechada antes de confirmar. Tente de novo.';
  if (code === 'auth/popup-blocked')
    return 'O navegador bloqueou a janela do Google. Libere pop-ups e tente de novo.';
  if (code === 'auth/user-mismatch') return 'Entre com a mesma conta Google que você quer excluir.';
  if (code === 'reautenticar') return 'Por segurança, confirme sua identidade de novo.';
  if (e && e.etapa === 'asaas')
    return 'Não conseguimos cancelar sua assinatura agora, então nada foi apagado. Tente de novo em alguns minutos.';
  if (code === 'sem_rede') return 'Sem conexão. Confira a internet e tente de novo.';
  return 'Não foi possível concluir a exclusão. Tente de novo em alguns minutos; se continuar, fale conosco pela aba Enviar sugestão.';
}

/** Pede a identidade de novo: senha ou janela do Google. */
function _exclReautenticar(u) {
  if (_exclProvedor(u) === 'password') {
    var senha = document.getElementById('inputSenhaExcluir');
    var cred = firebase.auth.EmailAuthProvider.credential(u.email, senha ? senha.value : '');
    return u.reauthenticateWithCredential(cred);
  }
  return u.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
}

function executarExclusaoConta() {
  if (!validarConfirmacaoExcluir()) return;
  var u = _exclUsuario();
  if (!u) return _exclMostrarErro('Sua sessão terminou. Entre de novo para excluir a conta.');
  var btn = document.getElementById('btnConfirmaExcluir');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner"></i> Excluindo…';
  }
  _exclReautenticar(u)
    .then(function () {
      // Token novo: o servidor confere a hora do login (auth_time).
      return u.getIdToken(true);
    })
    .then(function (token) {
      return fetch('/api/user?op=excluir-conta', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmacao: EXCLUIR_PALAVRA_CONFIRMACAO }),
        credentials: 'same-origin',
      }).catch(function () {
        throw { code: 'sem_rede' };
      });
    })
    .then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (j) {
          if (!r.ok) throw { code: j.error || 'http_' + r.status, error: j.error, etapa: j.etapa };
          return j;
        });
    })
    .then(function () {
      _exclLimparAparelho();
      var fb = window.AppliqueiFirebase;
      var sair = fb && fb.auth ? fb.auth.signOut().catch(function () {}) : Promise.resolve();
      return sair
        .then(function () {
          // O Firestore guarda uma cópia offline no IndexedDB
          // (enablePersistence). Ela só pode ser limpa com o cliente parado.
          if (!fb || !fb.db || typeof fb.db.terminate !== 'function') return;
          return fb.db
            .terminate()
            .then(function () {
              return fb.db.clearPersistence();
            })
            .catch(function () {});
        })
        .then(function () {
          location.replace('/?conta=excluida');
        });
    })
    .catch(function (e) {
      _exclMostrarErro(_exclMensagemErro(e));
    });
}

/** Apaga deste aparelho tudo o que o app guardou (dados e preferências). */
function _exclLimparAparelho() {
  try {
    var chaves = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (
        typeof k === 'string' &&
        (k.indexOf('futurorico_') === 0 || k.indexOf('appliquei_') === 0)
      )
        chaves.push(k);
    }
    chaves.forEach(function (k) {
      localStorage.removeItem(k);
    });
  } catch (_) {}
  try {
    sessionStorage.clear();
  } catch (_) {}
}
