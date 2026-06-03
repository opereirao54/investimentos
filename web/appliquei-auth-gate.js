/**
 * Auth gate — verificação de e-mail (soft → hard) + bloqueio de signup
 * pendente. Roda após o login do Firebase para decidir entre:
 *  - usuário verificado: libera o app
 *  - usuário não verificado, pré-deadline: banner amarelo persistente
 *  - usuário não verificado, pós-deadline: painel authGateVerify bloqueia
 *  - guest: trial flow (sem verificação)
 *
 * Onda 3 — extraído de Appliquei_v13.0.html (linhas 15911-16591). Era
 * IIFE inline; agora ES module bundlado pelo Vite. Sem API pública —
 * tudo é closure interna (intencional para impedir bypass via console).
 */

var GUEST_KEY = 'appliquei_auth_guest';
// Verificação de e-mail: transição soft → hard.
// Antes do deadline: usuário com emailVerified=false entra normalmente, mas
// vê banner amarelo persistente com botão de verificar/reenviar.
// A partir do deadline: gate hard (painel authGateVerify bloqueia).
// Para forçar gate hard antes (ex.: testes), seta window.__APPLIQUEI_FORCE_EMAIL_VERIFY = true.
var EMAIL_VERIFY_DEADLINE = '2026-06-01'; // ajustar quando rollout for definido
function emailVerifyGateHard() {
    if (window.__APPLIQUEI_FORCE_EMAIL_VERIFY === true) return true;
    try {
        var d = new Date(EMAIL_VERIFY_DEADLINE + 'T00:00:00');
        if (isNaN(d.getTime())) return false;
        return Date.now() >= d.getTime();
    } catch (_) { return false; }
}
function emailVerifyDeadlineLabel() {
    try {
        var d = new Date(EMAIL_VERIFY_DEADLINE + 'T00:00:00');
        if (isNaN(d.getTime())) return EMAIL_VERIFY_DEADLINE;
        return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
    } catch (_) { return EMAIL_VERIFY_DEADLINE; }
}
function $(id) { return document.getElementById(id); }
function isGuest() {
    try { return localStorage.getItem(GUEST_KEY) === '1'; } catch (_) { return false; }
}
// Proxy seguro para AppliqueiBilling.setSignupBlock. Antes este bloqueio
// vivia em window.__appliqueiBlockBilling — global público que qualquer
// script no console podia setar para impedir o gate de aparecer. Agora
// o estado é closure interna do módulo de billing; só a API setSignupBlock
// o altera. Mantém-se idempotente e tolerante a ordem de carregamento
// (se AppliqueiBilling ainda não montou, no-op).
function appliqueiSetSignupBlock(v) {
    try {
        if (window.AppliqueiBilling && typeof window.AppliqueiBilling.setSignupBlock === 'function') {
            window.AppliqueiBilling.setSignupBlock(v);
        }
    } catch (_) {}
}
function showGate() {
    var g = $('authGate');
    if (!g) return;
    g.style.display = 'block';
    g.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}
function hideGate() {
    var g = $('authGate');
    if (!g) return;
    g.style.display = 'none';
    g.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}
function ensureEmailVerifyBanner() {
    var el = $('emailVerifyBanner');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'emailVerifyBanner';
    el.setAttribute('role', 'alert');
    // position:fixed (e NÃO sticky) é obrigatório: body é display:flex,
    // então sticky vira item flex e empurra sidebar/main para o lado.
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9001;background:#fef3c7;color:#78350f;border-bottom:1px solid #fcd34d;padding:10px 16px;font-size:13px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:center;line-height:1.45;box-shadow:0 2px 6px rgba(0,0,0,.10);font-family:Figtree,sans-serif;';
    el.innerHTML = ''
        + '<i class="ph ph-warning-circle" style="font-size:16px;flex-shrink:0;"></i>'
        + '<span><strong>Verifique seu e-mail.</strong> A partir de <strong id="emailVerifyDeadlineLbl"></strong> o acesso só ficará disponível após a confirmação. Enviamos um link para <strong id="emailVerifyEmailLbl"></strong>.</span>'
        + '<span style="display:inline-flex;gap:6px;flex-shrink:0;">'
        +   '<button type="button" id="emailVerifyBannerResend" style="background:#fff;border:1px solid #fcd34d;color:#78350f;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;font-weight:500;">Reenviar e-mail</button>'
        +   '<button type="button" id="emailVerifyBannerCheck" style="background:#78350f;border:1px solid #78350f;color:#fef3c7;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;font-weight:500;">Já verifiquei</button>'
        +   '<button type="button" id="emailVerifyBannerClose" aria-label="Esconder por agora" style="background:transparent;border:0;color:#78350f;cursor:pointer;font-size:18px;line-height:1;padding:0 4px;">&times;</button>'
        + '</span>';
    // Importante: anexa ao FINAL do body, não como primeiro filho.
    // Como body é display:flex, inserir como filho normal cria layout
    // horizontal indesejado. O position:fixed do banner já tira ele
    // do fluxo; appendChild evita "piscar" como item flex antes do
    // navegador aplicar o fixed.
    document.body.appendChild(el);
    if (typeof ResizeObserver === 'function') {
        try { new ResizeObserver(function () { syncEmailVerifyBannerOffset(el); }).observe(el); } catch (_) {}
    }
    window.addEventListener('resize', function () { syncEmailVerifyBannerOffset(el); });
    var resendBtn = el.querySelector('#emailVerifyBannerResend');
    var checkBtn = el.querySelector('#emailVerifyBannerCheck');
    var closeBtn = el.querySelector('#emailVerifyBannerClose');
    if (resendBtn) resendBtn.addEventListener('click', function () {
        var fb = window.AppliqueiFirebase;
        var u = fb && fb.ready && fb.auth && fb.auth.currentUser;
        if (!u) return;
        resendBtn.disabled = true;
        var orig = 'Reenviar e-mail';
        resendBtn.textContent = 'Enviando…';
        u.sendEmailVerification({ url: location.origin + '/app' }).then(function () {
            if (typeof mostrarToast === 'function') mostrarToast('E-mail reenviado. Pode levar alguns minutos — confira também a caixa de spam.', 'sucesso', 8000);
            // Cooldown 60s alinhado com server-side de Firebase Auth.
            var secs = 60;
            var tick = function () {
                if (!resendBtn) return;
                resendBtn.textContent = 'Aguarde ' + secs + 's';
                if (secs <= 0) {
                    resendBtn.disabled = false;
                    resendBtn.textContent = orig;
                    return;
                }
                secs--;
                setTimeout(tick, 1000);
            };
            tick();
        }).catch(function (err) {
            resendBtn.disabled = false;
            resendBtn.textContent = orig;
            if (typeof mostrarToast === 'function') mostrarToast(mapAuthErr(err), 'erro');
        });
    });
    if (checkBtn) checkBtn.addEventListener('click', function () {
        var fb = window.AppliqueiFirebase;
        var u = fb && fb.ready && fb.auth && fb.auth.currentUser;
        if (!u) return;
        checkBtn.disabled = true;
        var orig = checkBtn.textContent;
        checkBtn.textContent = 'Verificando…';
        u.reload().then(function () { return u.getIdToken(true); }).then(function () {
            if (u.emailVerified) {
                hideEmailVerifyBanner();
                if (typeof mostrarToast === 'function') mostrarToast('E-mail verificado com sucesso.', 'sucesso');
            } else {
                if (typeof mostrarToast === 'function') mostrarToast('Ainda não vimos a verificação. Clique no link do e-mail e tente novamente.', 'aviso');
            }
        }).catch(function (err) {
            if (typeof mostrarToast === 'function') mostrarToast(mapAuthErr(err), 'erro');
        }).finally(function () {
            if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = orig; }
        });
    });
    if (closeBtn) closeBtn.addEventListener('click', function () {
        // Snooze por 24h (apenas visual; backend ainda decide quando bloquear).
        try { localStorage.setItem('appliquei_email_verify_snooze', String(Date.now() + 24*3600*1000)); } catch (_) {}
        hideEmailVerifyBanner();
    });
    return el;
}
// Offset do body para o banner não cobrir sidebar/conteúdo.
// Necessário porque body é display:flex; height:100vh; overflow:hidden —
// sem offset, o banner fixed se sobrepõe ao topo da sidebar e da main.
function syncEmailVerifyBannerOffset(el) {
    if (!el || el.style.display === 'none') return;
    var h = el.offsetHeight || 44;
    var b = document.body;
    if (!b) return;
    var apply = function () {
        b.style.setProperty('position', 'absolute', 'important');
        b.style.setProperty('top', h + 'px', 'important');
        b.style.setProperty('left', '0', 'important');
        b.style.setProperty('right', '0', 'important');
        b.style.setProperty('bottom', '0', 'important');
        b.style.setProperty('height', 'auto', 'important');
        b.style.setProperty('width', 'auto', 'important');
        b.style.setProperty('margin', '0', 'important');
    };
    apply();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
}
function clearEmailVerifyBannerOffset() {
    var b = document.body;
    if (!b) return;
    ['position','top','left','right','bottom','height','width','margin'].forEach(function (k) {
        b.style.removeProperty(k);
    });
}
function showEmailVerifyBanner(email) {
    try {
        var snoozeUntil = parseInt(localStorage.getItem('appliquei_email_verify_snooze') || '0', 10);
        if (snoozeUntil && Date.now() < snoozeUntil) return;
    } catch (_) {}
    var el = ensureEmailVerifyBanner();
    var emLbl = $('emailVerifyEmailLbl');
    var dlLbl = $('emailVerifyDeadlineLbl');
    if (emLbl) emLbl.textContent = email;
    if (dlLbl) dlLbl.textContent = emailVerifyDeadlineLabel();
    el.style.display = 'flex';
    syncEmailVerifyBannerOffset(el);
}
function hideEmailVerifyBanner() {
    var el = $('emailVerifyBanner');
    if (el) el.style.display = 'none';
    clearEmailVerifyBannerOffset();
}
function setSub(t) {
    var s = $('authGateSub');
    if (s) s.textContent = t;
}
window.appliqueiAuthErr = function (msg) {
    var e = $('authErr');
    if (!e) return;
    if (msg) {
        e.textContent = msg;
        e.classList.add('vis');
    } else {
        e.textContent = '';
        e.classList.remove('vis');
    }
};
function setAuthPanel(mode) {
    var load = $('authGateLoading');
    var nc = $('authGateNoConfig');
    var form = $('authGateForm');
    var verify = $('authGateVerify');
    if (!load || !nc || !form) return;
    if (mode === 'load') {
        load.style.display = '';
        nc.classList.remove('ativo');
        form.classList.remove('ativo');
        if (verify) verify.style.display = 'none';
    } else if (mode === 'noconf') {
        load.style.display = 'none';
        nc.classList.add('ativo');
        form.classList.remove('ativo');
        if (verify) verify.style.display = 'none';
    } else if (mode === 'form') {
        load.style.display = 'none';
        nc.classList.remove('ativo');
        form.classList.add('ativo');
        if (verify) verify.style.display = 'none';
    } else if (mode === 'verify') {
        load.style.display = 'none';
        nc.classList.remove('ativo');
        form.classList.remove('ativo');
        if (verify) verify.style.display = '';
    }
}
function refreshSidebar() {
    var emailEl = $('sidebarAuthEmail');
    var btnLabel = $('sidebarAuthBtnLabel');
    var icon = $('sidebarAuthIcon');
    var btn = $('sidebarAuthBtn');
    var fb = window.AppliqueiFirebase;
    var u = fb && fb.ready && fb.auth && fb.auth.currentUser;
    if (u) {
        if (emailEl) {
            emailEl.textContent = u.email || 'Conta';
            emailEl.title = u.email || '';
        }
        if (btnLabel) btnLabel.textContent = 'Sair';
        if (icon) icon.className = 'ph ph-sign-out';
        if (btn) btn.setAttribute('data-tooltip', 'Sair');
        return;
    }
    if (emailEl) {
        emailEl.textContent = isGuest() ? 'Modo local (dados neste navegador)' : 'Não autenticado';
        emailEl.title = '';
    }
    if (btnLabel) btnLabel.textContent = 'Entrar';
    if (icon) icon.className = 'ph ph-sign-in';
    if (btn) btn.setAttribute('data-tooltip', 'Entrar');
}
window.__appliqueiAuthModo = 'login';
window.appliqueiAuthSetModo = function (modo) {
    window.__appliqueiAuthModo = modo === 'registro' ? 'registro' : 'login';
    var login = window.__appliqueiAuthModo === 'login';
    var tLogin = $('authTabLogin');
    var tReg = $('authTabReg');
    var btn = $('authBtnSubmit');
    var forg = $('authBtnForgot');
    var hintReg = $('authHintReg');
    var hintLogin = $('authHintLogin');
    var senha = $('authSenha');
    if (tLogin) tLogin.classList.toggle('ativo', login);
    if (tReg) tReg.classList.toggle('ativo', !login);
    if (btn) btn.textContent = login ? 'Entrar' : 'Criar conta';
    if (forg) forg.style.display = login ? '' : 'none';
    if (hintReg) hintReg.style.display = login ? 'none' : '';
    if (hintLogin) hintLogin.style.display = login ? '' : 'none';
    if (senha) senha.setAttribute('autocomplete', login ? 'current-password' : 'new-password');
    // Cupom só na aba "Criar conta" — em "Entrar" não faz sentido pois
    // signup acidental via Google é rejeitado (ver appliqueiAuthGoogle).
    var cupomWrap = $('authCupomWrap');
    if (cupomWrap) cupomWrap.style.display = login ? 'none' : '';
    if (!login) {
        var cupomInput = $('authCupom');
        if (cupomInput && !cupomInput.value) {
            try {
                var pending = sessionStorage.getItem('appliquei_pending_referral') || '';
                if (pending) cupomInput.value = pending;
            } catch (_) {}
        }
    }
    window.appliqueiAuthErr('');
};
function mapAuthErr(err) {
    if (!err || !err.code) return err && err.message ? String(err.message) : 'Não foi possível concluir.';
    var c = err.code;
    if (c === 'auth/invalid-email') return 'E-mail inválido.';
    if (c === 'auth/user-disabled') return 'Esta conta foi desativada.';
    // Mensagens unificadas para mitigar enumeração de contas.
    if (c === 'auth/user-not-found' || c === 'auth/wrong-password' || c === 'auth/invalid-credential') return 'E-mail ou senha incorretos.';
    if (c === 'auth/email-already-in-use') return 'Este e-mail já está em uso. Tente entrar ou redefinir a senha.';
    if (c === 'auth/weak-password') return 'Senha muito fraca (mínimo 6 caracteres).';
    if (c === 'auth/too-many-requests') return 'Muitas tentativas. Tente mais tarde.';
    if (c === 'auth/network-request-failed') return 'Falha de rede. Verifique a conexão.';
    if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return 'Login cancelado.';
    if (c === 'auth/popup-blocked') return 'O navegador bloqueou o popup. Permita popups para este site ou tente novamente.';
    if (c === 'auth/account-exists-with-different-credential') return 'Já existe uma conta com este e-mail usando outro método (senha). Entre com senha primeiro e depois vincule o Google em Configurações.';
    if (c === 'auth/unauthorized-domain' || /requests-from-referer-.*-are-blocked/i.test(c) || /requests-from-referer-.*-are-blocked/i.test(err.message || '')) {
        return 'Este endereço (' + location.hostname + ') não está autorizado no Firebase. Use o domínio oficial do app ou peça ao administrador para adicioná-lo em Authentication › Settings › Authorized domains.';
    }
    return err.message || 'Erro de autenticação.';
}
window.appliqueiAuthSubmit = function () {
    var fb = window.AppliqueiFirebase;
    if (!fb || !fb.ready || !fb.auth) {
        window.appliqueiAuthErr('Firebase não está configurado.');
        return;
    }
    var email = (($('authEmail') && $('authEmail').value) || '').trim();
    var senha = (($('authSenha') && $('authSenha').value) || '');
    if (!email) return window.appliqueiAuthErr('Informe o e-mail.');
    if (!senha || senha.length < 6) return window.appliqueiAuthErr('Informe a senha (mínimo 6 caracteres).');
    var btn = $('authBtnSubmit');
    if (btn) { btn.disabled = true; }
    window.appliqueiAuthErr('');
    var reg = window.__appliqueiAuthModo === 'registro';
    if (reg) {
        var cupomEl = $('authCupom');
        var cupom = cupomEl ? cupomEl.value.trim().toUpperCase() : '';
        if (cupom) {
            try { sessionStorage.setItem('appliquei_pending_referral', cupom); } catch (_) {}
        }
    }
    var p = reg
        ? fb.auth.createUserWithEmailAndPassword(email, senha).then(function (cred) {
            // Dispara verificação imediatamente; onAuthStateChanged em seguida
            // detecta emailVerified=false e mostra o painel verify.
            try {
                return cred.user.sendEmailVerification({ url: location.origin + '/app' }).then(function () { return cred; });
            } catch (_) { return cred; }
        })
        : fb.auth.signInWithEmailAndPassword(email, senha);
    p.catch(function (err) {
        window.appliqueiAuthErr(mapAuthErr(err));
    }).finally(function () {
        if (btn) btn.disabled = false;
    });
};
// Processa o resultado de signInWithPopup OU getRedirectResult.
// Centraliza: detecção isNewUser, política de rejeição de signup
// acidental, toast de boas-vindas, kickstart do billing.
function handleGoogleAuthResult(result, ctx) {
    var fb = window.AppliqueiFirebase;
    var info = result && result.additionalUserInfo;
    var isNew = !!(info && info.isNewUser);
    var requireExisting = !!(ctx && ctx.requireExisting);
    var pending = '';
    try { pending = sessionStorage.getItem('appliquei_pending_referral') || ''; } catch (_) {}

    if (isNew && requireExisting) {
        // Rejeita signup acidental: usuário clicou Google na aba "Entrar"
        // mas não tinha conta. Apaga o user recém-criado no Firebase Auth
        // (não tendo billing.account ainda — graças ao signupBlock
        // mantido até este handler executar — o cleanup é completo).
        //
        // Flag __appliqueiAuthGoogleRejecting: faz o onAuthStateChanged
        // skipar o setTimeout que mostraria o form e LIMPARIA o erro
        // que vamos exibir aqui.
        window.__appliqueiAuthGoogleRejecting = true;
        var u = fb && fb.auth && fb.auth.currentUser;
        var done = function () {
            appliqueiSetSignupBlock(false);
            showGate();
            setSub('Não encontramos sua conta');
            setAuthPanel('form');
            window.appliqueiAuthSetModo('registro');
            var rejectMsg = 'Não encontramos uma conta Google com este e-mail. Clique em "Continuar com Google" para criar sua conta agora.';
            window.appliqueiAuthErr(rejectMsg);
            if (typeof refreshSidebar === 'function') refreshSidebar();
            // Sticky: re-afirma a mensagem durante 6s caso outra
            // rotina (onAuthStateChanged, setModo, getRedirectResult) a
            // limpe. Antes a flag soltava em 800ms e a mensagem podia
            // sumir antes do usuário ler.
            var stickyDeadline = Date.now() + 6000;
            var stickyTick = setInterval(function () {
                var errEl = $('authErr');
                if (!errEl) { clearInterval(stickyTick); return; }
                if (Date.now() > stickyDeadline) {
                    clearInterval(stickyTick);
                    window.__appliqueiAuthGoogleRejecting = false;
                    return;
                }
                if (errEl.textContent !== rejectMsg) {
                    window.appliqueiAuthErr(rejectMsg);
                }
            }, 120);
        };
        if (u && typeof u.delete === 'function') {
            u.delete().then(done).catch(function () {
                try { fb.auth.signOut(); } catch (_) {}
                done();
            });
        } else {
            try { fb && fb.auth && fb.auth.signOut(); } catch (_) {}
            done();
        }
        return;
    }

    // Caminho positivo: libera billing e mostra feedback se for novo.
    appliqueiSetSignupBlock(false);
    try {
        if (window.AppliqueiBilling && typeof window.AppliqueiBilling.kickstart === 'function') {
            window.AppliqueiBilling.kickstart();
        }
    } catch (_) {}
    if (isNew && typeof mostrarToast === 'function') {
        mostrarToast(
            pending
                ? ('Conta criada com Google. Cupom ' + pending + ' será aplicado.')
                : 'Conta criada com Google. Sua avaliação de 7 dias começou.',
            'sucesso'
        );
    }
}
window.appliqueiAuthGoogle = function () {
    var fb = window.AppliqueiFirebase;
    if (!fb || !fb.ready || !fb.auth) {
        window.appliqueiAuthErr('Firebase não está configurado.');
        return;
    }
    if (!firebase.auth.GoogleAuthProvider) {
        window.appliqueiAuthErr('Provedor Google indisponível neste cliente.');
        return;
    }
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    // Persiste o cupom ANTES do popup. Cobre os 3 cenários:
    //  (a) usuário existente faz login Google (cupom será aplicado
    //      retroativamente no /init se ainda não tem subscription);
    //  (b) usuário novo cria conta Google (cupom usado no signup);
    //  (c) usuário veio de link ?ref=APP-XXX (já está em sessionStorage
    //      via outro caminho do código - aqui só não sobrescreve).
    try {
        var cupomEl = $('authCupom');
        var cupom = cupomEl ? cupomEl.value.trim().toUpperCase() : '';
        if (cupom) sessionStorage.setItem('appliquei_pending_referral', cupom);
    } catch (_) {}

    // Política: na aba "Entrar", rejeita signup acidental. Na aba
    // "Criar conta", aceita conta nova normalmente. Salvamos o modo
    // ANTES do popup, pois durante o redirect (mobile) o tab pode
    // mudar; persistimos em sessionStorage para o handler de
    // getRedirectResult ler depois do reload.
    var requireExisting = window.__appliqueiAuthModo === 'login';
    try {
        sessionStorage.setItem('appliquei_google_require_existing', requireExisting ? '1' : '0');
    } catch (_) {}

    // Bloqueia billing até o handler validar a intenção.
    appliqueiSetSignupBlock(true);

    window.appliqueiAuthErr('');
    var btn = $('authBtnGoogle');
    if (btn) btn.disabled = true;
    var isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    var p = isMobile ? fb.auth.signInWithRedirect(provider) : fb.auth.signInWithPopup(provider);
    Promise.resolve(p).then(function (result) {
        // Caminho popup. Redirect resolve via getRedirectResult em initAppliqueiAuth.
        handleGoogleAuthResult(result, { requireExisting: requireExisting });
    }).catch(function (err) {
        appliqueiSetSignupBlock(false);
        window.appliqueiAuthErr(mapAuthErr(err));
    }).finally(function () {
        if (btn) btn.disabled = false;
    });
};
// Cooldown local: Firebase Auth limita reenvios server-side (~1/min por
// user) e às vezes silencia o erro retornando ok sem enviar. Para evitar
// que o tester clique repetidamente esperando outro e-mail, mantemos a
// UI bloqueada por 60s e mostramos contagem regressiva.
var APPLIQUEI_RESEND_COOLDOWN_MS = 60000;
function appliqueiAuthResendCooldown(btn, secs) {
    if (!btn) return;
    btn.disabled = true;
    var tick = function () {
        btn.textContent = 'Aguarde ' + secs + 's';
        if (secs <= 0) {
            btn.disabled = false;
            btn.textContent = 'Reenviar e-mail';
            return;
        }
        secs--;
        setTimeout(tick, 1000);
    };
    tick();
}
window.appliqueiAuthResend = function () {
    var fb = window.AppliqueiFirebase;
    var u = fb && fb.ready && fb.auth && fb.auth.currentUser;
    if (!u) return;
    var btn = $('authVerifyResendBtn');
    var status = $('authVerifyStatus');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
    u.sendEmailVerification({ url: location.origin + '/app' }).then(function () {
        if (status) {
            status.innerHTML = 'E-mail reenviado. Pode levar alguns minutos — <strong>confira também a pasta de spam</strong>.';
            status.style.color = '#059669';
            status.style.display = 'block';
        }
        appliqueiAuthResendCooldown(btn, Math.ceil(APPLIQUEI_RESEND_COOLDOWN_MS / 1000));
    }).catch(function (err) {
        if (status) { status.textContent = mapAuthErr(err); status.style.color = '#7f1d1d'; status.style.display = 'block'; }
        if (btn) { btn.disabled = false; btn.textContent = 'Reenviar e-mail'; }
    });
};
window.appliqueiAuthVerifyCheck = function () {
    var fb = window.AppliqueiFirebase;
    var u = fb && fb.ready && fb.auth && fb.auth.currentUser;
    if (!u) return;
    var btn = $('authVerifyCheckBtn');
    var status = $('authVerifyStatus');
    if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }
    u.reload().then(function () {
        return u.getIdToken(true); // força refresh para email_verified entrar no claim
    }).then(function () {
        if (u.emailVerified) {
            hideGate();
            refreshSidebar();
            // initBilling/applyAccess seguem via onAuthStateChanged → guard novo
        } else {
            if (status) { status.textContent = 'Ainda não vimos a verificação. Clique no link do e-mail e tente novamente.'; status.style.color = '#7f1d1d'; status.style.display = 'block'; }
        }
    }).catch(function (err) {
        if (status) { status.textContent = mapAuthErr(err); status.style.color = '#7f1d1d'; status.style.display = 'block'; }
    }).finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Já verifiquei — entrar'; }
    });
};
// Empurra escritas pendentes para a nuvem ANTES de limpar a sessão. O beacon
// do forceFlush parte com o token ainda válido e sobrevive ao signOut (o
// request HTTP já está em curso), evitando perder um lançamento feito segundos
// antes de sair — o sintoma "saí e entrei e ele apagou o que eu tinha feito no
// mobile": o write nunca subiu, então o pull pós-login (com os dados do
// servidor, sem o item) sobrescreveu o local.
function appliqueiFlushBeforeSignOut() {
    try {
        if (window.AppliqueiCloudSync && typeof window.AppliqueiCloudSync.forceFlush === 'function') {
            window.AppliqueiCloudSync.forceFlush();
        }
    } catch (_) {}
}
window.appliqueiAuthSignOut = function () {
    var fb = window.AppliqueiFirebase;
    if (fb && fb.ready && fb.auth) {
        appliqueiFlushBeforeSignOut();
        fb.auth.signOut().catch(function () {});
    }
};
window.appliqueiAuthEsqueciSenha = function () {
    var fb = window.AppliqueiFirebase;
    if (!fb || !fb.ready || !fb.auth) return;
    if (window.__appliqueiAuthModo !== 'login') {
        window.appliqueiAuthSetModo('login');
    }
    var email = (($('authEmail') && $('authEmail').value) || '').trim();
    if (!email) return window.appliqueiAuthErr('Informe o e-mail para enviarmos o link de redefinição.');
    window.appliqueiAuthErr('');
    fb.auth.sendPasswordResetEmail(email).then(function () {
        if (typeof mostrarToast === 'function') {
            mostrarToast('Enviamos um e-mail com instruções para redefinir a senha.', 'sucesso');
        }
    }).catch(function (err) {
        window.appliqueiAuthErr(mapAuthErr(err));
    });
};
window.appliqueiContinuarOffline = function () {
    window.appliqueiAuthErr('O modo offline foi descontinuado. Crie uma conta para iniciar a avaliação gratuita de 7 dias.');
};
try { localStorage.removeItem(GUEST_KEY); } catch (_) {}
window.appliqueiSidebarAuthClick = function () {
    var fb = window.AppliqueiFirebase;
    if (fb && fb.ready && fb.auth && fb.auth.currentUser) {
        appliqueiFlushBeforeSignOut();
        fb.auth.signOut().catch(function () {});
        refreshSidebar();
        return;
    }
    try { localStorage.removeItem(GUEST_KEY); } catch (_) {}
    showGate();
    if (!fb || !fb.ready) {
        setSub('Firebase não configurado');
        setAuthPanel('noconf');
    } else {
        setSub('Entre com e-mail e senha');
        setAuthPanel('form');
        window.appliqueiAuthSetModo('login');
    }
    refreshSidebar();
};
function initAppliqueiAuth() {
    if (!$('authGate')) return;
    showGate();
    setAuthPanel('load');
    setSub('A carregar…');
    if (!window.AppliqueiFirebase || !AppliqueiFirebase.ready) {
        setAuthPanel('noconf');
        setSub('Firebase não configurado');
        if (isGuest()) {
            hideGate();
            refreshSidebar();
        }
        return;
    }
    // Caminho redirect (mobile/iOS): consome o resultado após o reload
    // de volta do Google. Recupera a intenção (login vs registro) que
    // foi persistida em sessionStorage antes do redirect. Bloqueia
    // billing até validar e o handler libera/rejeita.
    try {
        var redirectRequireExisting = false;
        try {
            redirectRequireExisting = sessionStorage.getItem('appliquei_google_require_existing') === '1';
            sessionStorage.removeItem('appliquei_google_require_existing');
        } catch (_) {}
        appliqueiSetSignupBlock(true);
        AppliqueiFirebase.auth.getRedirectResult().then(function (result) {
            if (result && result.user) {
                handleGoogleAuthResult(result, { requireExisting: redirectRequireExisting });
            } else {
                // Sem resultado pendente (página carregada sem vir de redirect).
                appliqueiSetSignupBlock(false);
            }
        }).catch(function (err) {
            appliqueiSetSignupBlock(false);
            if (err && err.code) window.appliqueiAuthErr(mapAuthErr(err));
        });
    } catch (_) {
        appliqueiSetSignupBlock(false);
    }
    var authUiTimer = null;
    AppliqueiFirebase.auth.onAuthStateChanged(function (user) {
        if (authUiTimer) {
            clearTimeout(authUiTimer);
            authUiTimer = null;
        }
        if (user) {
            window.appliqueiAuthErr('');
            // Provedores OAuth (google.com) sempre trazem emailVerified=true.
            if (user.emailVerified === false) {
                if (emailVerifyGateHard()) {
                    // Modo hard: bloqueia totalmente.
                    var emEl = $('authVerifyEmail');
                    if (emEl) emEl.textContent = user.email || '';
                    var st = $('authVerifyStatus');
                    if (st) { st.style.display = 'none'; st.textContent = ''; }
                    showGate();
                    setSub('Confirme seu e-mail para continuar');
                    setAuthPanel('verify');
                    refreshSidebar();
                    return;
                }
                // Modo soft: libera o app e mostra banner persistente.
                hideGate();
                try { localStorage.removeItem(GUEST_KEY); } catch (_) {}
                refreshSidebar();
                showEmailVerifyBanner(user.email || '');
                return;
            }
            hideEmailVerifyBanner();
            hideGate();
            try { localStorage.removeItem(GUEST_KEY); } catch (_) {}
            refreshSidebar();
            return;
        }
        hideEmailVerifyBanner();
        if (isGuest()) {
            hideGate();
            refreshSidebar();
            return;
        }
        // Durante rejeição de signup acidental Google, o handler já
        // gerencia a UI (modo registro + mensagem). NÃO sobrescrever.
        if (window.__appliqueiAuthGoogleRejecting) return;
        authUiTimer = setTimeout(function () {
            authUiTimer = null;
            if (AppliqueiFirebase.auth.currentUser || isGuest()) return;
            if (window.__appliqueiAuthGoogleRejecting) return;
            showGate();
            setAuthPanel('form');
            setSub('Entre com e-mail e senha ou use o Google');
            window.appliqueiAuthSetModo('login');
            refreshSidebar();
        }, 500);
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAppliqueiAuth);
} else {
    initAppliqueiAuth();
}
