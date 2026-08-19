// Painel de log na própria tela, para diagnosticar sync no celular — onde não
// existe DevTools. Inerte por padrão: só liga com ?debug=1 na URL ou com
// localStorage.dbg_sync_on === '1'. Não altera nenhum comportamento do app;
// apenas observa.
//
// Por que existe: o bug "cadastrei no celular e não gravou" sobreviveu a quatro
// correções feitas às cegas, por leitura de código. Sem ver o que o aparelho
// realmente faz, a quinta seria mais um chute.
//
// O log é PERSISTIDO a cada linha. A aba morre no meio do que estamos
// investigando; log em memória morre junto e não sobra prova.
//
// CUSTO: a primeira versão guardava um array e fazia JSON.stringify do log
// inteiro a cada linha — dentro de um `while` que reserializava a cada volta.
// Com o log perto de 120KB, cada linha custava uma serialização completa mais
// uma escrita em disco, e o painel passou a pesar mais que o app que ele
// observa. No aparelho isso coincidiu com sessões caindo para 64ms. Efeito do
// observador: o instrumento contaminando a medição. Agora é string com
// append, corte por fatia e teto menor — sem JSON, sem varredura.
//
// A chave `dbg_sync_log` NÃO usa os prefixos `appliquei_`/`futurorico_` de
// propósito — assim o interceptador de setItem não a vê e o log não entra no
// próprio sync que estamos investigando.

const LOG_KEY = 'dbg_sync_log';
const ON_KEY = 'dbg_sync_on';
const MAX_CHARS = 48 * 1024;

function isOn() {
  try {
    if (/[?&]debug=1/.test(location.search)) {
      localStorage.setItem(ON_KEY, '1');
      return true;
    }
    if (/[?&]debug=0/.test(location.search)) {
      localStorage.removeItem(ON_KEY);
      return false;
    }
    return localStorage.getItem(ON_KEY) === '1';
  } catch (_) {
    return false;
  }
}

if (isOn()) start();

function start() {
  const t0 = Date.now();
  let logStr = '';
  let panel = null;
  let bodyEl = null;
  let pushCount = 0;

  try {
    logStr = localStorage.getItem(LOG_KEY) || '';
  } catch (_) {}

  // Fronteira entre sessões. Duas destas separadas por poucos milissegundos
  // significam que a aba morreu e recarregou — não é troca de app.
  push('---', 'sessão iniciada ' + new Date().toLocaleTimeString('pt-BR'));

  function persist() {
    try {
      if (logStr.length > MAX_CHARS) {
        const corte = logStr.length - MAX_CHARS;
        const nl = logStr.indexOf('\n', corte);
        logStr = logStr.slice(nl === -1 ? corte : nl + 1);
      }
      localStorage.setItem(LOG_KEY, logStr);
    } catch (_) {}
  }

  function push(tag, msg) {
    const line =
      '[' +
      new Date().toLocaleTimeString('pt-BR') +
      ' +' +
      (Date.now() - t0) +
      'ms] ' +
      tag +
      ' ' +
      msg;
    logStr += line + '\n';
    persist();
    render(line, tag);
  }

  // ---------------- captura de console e erros ----------------

  ['log', 'warn', 'error'].forEach((lvl) => {
    const orig = console[lvl].bind(console);
    console[lvl] = function () {
      try {
        const txt = Array.prototype.map
          .call(arguments, (a) => {
            if (a instanceof Error) return a.message;
            if (typeof a === 'object') {
              try {
                return JSON.stringify(a);
              } catch (_) {
                return String(a);
              }
            }
            return String(a);
          })
          .join(' ');
        // Só o que interessa ao sync — senão o painel vira ruído e custo.
        if (lvl === 'error' || /Cloud|ync|beacon|push/i.test(txt)) push(lvl, txt.slice(0, 300));
      } catch (_) {}
      return orig.apply(console, arguments);
    };
  });

  window.addEventListener('error', (ev) => {
    push('ERRO', (ev.message || 'erro') + ' @ ' + (ev.filename || '?') + ':' + (ev.lineno || '?'));
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    push('REJEIÇÃO', (r && (r.message || r)) + '');
  });

  // ---------------- ciclo de vida da página ----------------

  document.addEventListener('visibilitychange', () =>
    push('CICLO', 'visibility=' + document.visibilityState)
  );
  window.addEventListener('pagehide', (e) => push('CICLO', 'pagehide persisted=' + e.persisted));
  window.addEventListener('pageshow', (e) => push('CICLO', 'pageshow persisted=' + e.persisted));
  window.addEventListener('freeze', () => push('CICLO', 'freeze (SO congelou a aba)'));
  window.addEventListener('resume', () => push('CICLO', 'resume'));
  window.addEventListener('offline', () => push('REDE', 'offline'));

  // ---------------- interceptação do envio ----------------

  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  let seq = 0;
  if (origFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/api/sync/push') === -1) return origFetch(input, init);

      const n = ++seq;
      pushCount++;
      const body = (init && init.body) || '';
      const kb = Math.round((typeof body === 'string' ? body.length : 0) / 1024);
      const started = Date.now();
      push('PUSH→', '#' + n + ' iniciado ' + kb + 'KB keepalive=' + !!(init && init.keepalive));

      return origFetch(input, init).then(
        (r) => {
          const ms = Date.now() - started;
          r.clone()
            .text()
            .then((txt) =>
              push(
                'PUSH✓',
                '#' + n + ' HTTP ' + r.status + ' em ' + ms + 'ms → ' + txt.slice(0, 300)
              )
            )
            .catch(() => push('PUSH✓', '#' + n + ' HTTP ' + r.status + ' em ' + ms + 'ms'));
          return r;
        },
        (err) => {
          push(
            'PUSH✗',
            '#' +
              n +
              ' FALHOU em ' +
              (Date.now() - started) +
              'ms: ' +
              (err && (err.message || err))
          );
          throw err;
        }
      );
    };
  }

  // ---------------- cadeia de gravação ----------------
  //   setItem  →  onLocalWrite  →  beacon
  //     ↑             ↑              ↑
  //   grava?     foi avisado?     enviou?
  //
  // Sem separar esses pontos, "não sincronizou" cobre três bugs distintos: o
  // app não gravou; gravou mas o sync não soube; soube e desistiu. Cada um tem
  // correção diferente e nenhum se distingue do outro pelo sintoma.

  // A sonda GRAVA precisa de DOIS pontos, e a razão é a hipótese central agora.
  //
  // utils.js:341 faz `localStorage.setItem = function(...)` para notificar o
  // sync a cada escrita. Em Chrome isso sombreia o método do protótipo e
  // funciona. Mas `Storage` é um legacy platform object com setter de
  // propriedade nomeada: em navegadores que seguem o WebIDL à risca, atribuir
  // uma propriedade que não é own property vai para o setter nomeado — grava um
  // ITEM chamado "setItem" e NÃO sombreia o método.
  //
  // Se for esse o caso no Safari, o interceptador do utils.js nunca roda:
  // o app salva direto no método nativo (por isso o dado aparece na lista e
  // persiste), onLocalWrite nunca é chamado, e nada é sincronizado. Explicaria
  // a assimetria PC/iPhone inteira — e explicaria por que a minha primeira
  // sonda, que usava o mesmo truque, também ficou cega.
  //
  // Por isso instrumentamos instância E protótipo, e o log diz por qual
  // caminho a escrita passou. "via prototipo" é a confirmação da hipótese.
  function logGrava(k, v, via) {
    if (k && /^(futurorico_|appliquei_)/.test(k)) {
      push('GRAVA', k + ' ' + Math.round(String(v).length / 1024) + 'KB via ' + via);
    }
  }

  try {
    const origInst = localStorage.setItem.bind(localStorage);
    const w = function (k, v) {
      logGrava(k, v, 'instancia');
      return origInst(k, v);
    };
    w.__dbg = true;
    localStorage.setItem = w;
  } catch (e) {
    push('ERRO', 'wrap instância falhou: ' + (e && e.message));
  }

  try {
    const proto = Object.getPrototypeOf(localStorage);
    const origProto = proto.setItem;
    if (origProto && !origProto.__dbg) {
      const wp = function (k, v) {
        logGrava(k, v, 'prototipo');
        return origProto.call(this, k, v);
      };
      wp.__dbg = true;
      proto.setItem = wp;
    }
  } catch (e) {
    push('ERRO', 'wrap protótipo falhou: ' + (e && e.message));
  }

  // ---------------- caminho do salvamento ----------------
  // O usuário limpou o log, cadastrou uma despesa e NADA apareceu — nem GRAVA.
  // Isso tira o foco do sync: não havia o que sincronizar. Mas "nada apareceu"
  // ainda é ambíguo entre "o salvamento não rodou" e "o painel está morto", e
  // decidir errado aqui custa mais uma rodada. As sondas abaixo separam:
  //
  //   ENTRA  → a função de salvar foi chamada (o botão funciona)
  //   TOAST  → o app falou algo com o usuário (validação recusou, por exemplo)
  //   GRAVA  → chegou ao disco
  //
  // mostrarToast é o canal de erro do próprio app: os `return` de validação em
  // executarInsercao passam por ele. Capturá-lo mostra recusas que passariam
  // despercebidas na tela.
  function wrapGlobal(nome, tag) {
    const fn = window[nome];
    if (typeof fn !== 'function' || fn.__dbg) return false;
    const w = function () {
      try {
        const arg = arguments[0];
        push(tag, nome + (typeof arg === 'string' ? ': ' + String(arg).slice(0, 120) : ''));
      } catch (_) {}
      return fn.apply(this, arguments);
    };
    w.__dbg = true;
    window[nome] = w;
    return true;
  }

  const alvos = [
    ['executarInsercao', 'ENTRA'],
    ['executarEdicao', 'ENTRA'],
    ['executarDelecao', 'ENTRA'],
    ['mostrarToast', 'TOAST'],
  ];
  let restantes = alvos.slice();
  (function tentarWrap(n) {
    restantes = restantes.filter(([nome, tag]) => !wrapGlobal(nome, tag));
    if (restantes.length && n < 40) setTimeout(() => tentarWrap(n + 1), 500);
    else if (restantes.length) {
      push('ERRO', 'não encontrei: ' + restantes.map((r) => r[0]).join(', '));
    }
  })(0);

  let wrapped = false;
  function wrapSync() {
    if (wrapped) return true;
    const cs = window.AppliqueiCloudSync;
    if (!cs || typeof cs.onLocalWrite !== 'function') return false;
    wrapped = true;
    const orig = cs.onLocalWrite.bind(cs);
    cs.onLocalWrite = function (key) {
      push('AVISA', 'onLocalWrite(' + key + ')');
      return orig(key);
    };
    push('---', 'sync instrumentado');
    return true;
  }
  if (!wrapSync()) {
    let tries = 0;
    const iv = setInterval(() => {
      if (wrapSync()) return clearInterval(iv);
      if (++tries > 60) {
        clearInterval(iv);
        push('ERRO', 'AppliqueiCloudSync nunca apareceu — módulo não carregou');
      }
    }, 500);
  }

  // ---------------- painel ----------------

  function corDe(tag) {
    if (tag === 'ERRO' || tag === 'PUSH✗' || tag === 'error') return '#ff6b6b';
    if (tag === 'PUSH✓' || tag === 'GRAVA') return '#51cf66';
    if (tag === 'CICLO') return '#ffd43b';
    if (tag === 'AVISA' || tag === 'PUSH→') return '#74c0fc';
    return '#ced4da';
  }

  function render(line, tag) {
    if (!bodyEl) return;
    const el = document.createElement('div');
    el.textContent = line;
    el.style.cssText = 'padding:2px 0;border-bottom:1px solid #222;color:' + corDe(tag);
    bodyEl.appendChild(el);
    // Segura o custo de DOM: o painel não pode virar o gargalo do app.
    while (bodyEl.childNodes.length > 150) bodyEl.removeChild(bodyEl.firstChild);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function build() {
    if (panel) return;
    panel = document.createElement('div');
    panel.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#0b0b0d;' +
      'color:#ced4da;font:11px/1.4 ui-monospace,Menlo,monospace;border-top:2px solid #495057;' +
      'max-height:45vh;display:flex;flex-direction:column';

    const bar = document.createElement('div');
    bar.style.cssText =
      'display:flex;flex-wrap:wrap;gap:6px;padding:6px;background:#15151a;align-items:center;flex:0 0 auto';

    // Prova de vida visível. "Não apareceu nada no log" é ambíguo entre o app
    // não fazer nada e o painel ter morrido; um contador que sobe a cada toque
    // resolve isso sem custar uma rodada de ida e volta.
    const title = document.createElement('span');
    let toques = 0;
    title.textContent = 'sync debug · toques 0';
    title.style.cssText = 'color:#868e96;margin-right:auto';
    document.addEventListener(
      'click',
      () => {
        toques++;
        title.textContent = 'sync debug · toques ' + toques;
      },
      true
    );

    function btn(label, fn) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText =
        'background:#343a40;color:#e9ecef;border:0;border-radius:4px;padding:6px 10px;font:11px monospace';
      b.addEventListener('click', fn);
      return b;
    }

    // O painel tapava o formulário, então só dava para cadastrar desligando o
    // debug — e aí o salvamento, que é o momento sob investigação, não era
    // registrado. Esconder encolhe para um selo e MANTÉM tudo gravando.
    const badge = document.createElement('div');
    badge.textContent = '🐛';
    badge.style.cssText =
      'position:fixed;right:10px;bottom:10px;z-index:2147483647;width:44px;height:44px;' +
      'border-radius:22px;background:#0b0b0d;border:2px solid #495057;color:#fff;' +
      'display:none;align-items:center;justify-content:center;font-size:20px';
    badge.addEventListener('click', () => {
      panel.style.display = 'flex';
      badge.style.display = 'none';
    });
    document.body.appendChild(badge);

    const hide = btn('esconder', () => {
      panel.style.display = 'none';
      badge.style.display = 'flex';
    });

    const revs = btn('revs', () => {
      try {
        const m = JSON.parse(localStorage.getItem('appliquei_cloud_key_revs') || '{}');
        const now = Date.now();
        const r = Number(m['futurorico_transacoes'] || 0);
        push('REVS', 'agora=' + now + ' (' + new Date(now).toISOString() + ')');
        push('REVS', 'localRev=' + r + ' delta=' + (now - r) + 'ms');
      } catch (e) {
        push('ERRO', 'revs: ' + e.message);
      }
    });

    // Afere o próprio instrumento: sem isto, "nenhum PUSH no log" é ambíguo
    // entre o app não empurrar e o painel não ver.
    const forcar = btn('forçar push', () => {
      const cs = window.AppliqueiCloudSync;
      if (!cs) return push('ERRO', 'AppliqueiCloudSync não existe');
      const antes = pushCount;
      push('---', 'forçando push manual...');
      try {
        cs.onLocalWrite('futurorico_transacoes');
      } catch (e) {
        push('ERRO', 'onLocalWrite lançou: ' + e.message);
      }
      setTimeout(
        () => push('---', pushCount > antes ? 'instrumento OK' : 'NENHUM push após forçar'),
        3500
      );
    });

    const info = btn('estado', () => {
      try {
        const enc = new TextEncoder();
        const big = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!/^(futurorico_|appliquei_)/.test(k)) continue;
          const kb = Math.round(enc.encode(localStorage.getItem(k) || '').length / 1024);
          if (kb >= 1) big.push(k + '=' + kb + 'KB');
        }
        push('ESTADO', big.join(' '));
        const u = window.AppliqueiFirebase && window.AppliqueiFirebase.auth.currentUser;
        push('ESTADO', 'uid=' + (u ? u.uid : 'SEM LOGIN') + ' online=' + navigator.onLine);

        // Teste direto da hipótese: se atribuir em localStorage NÃO sombreia o
        // método, o interceptador do utils.js está morto neste navegador — e
        // com ele todo o sync. O item lixo "setItem" é a impressão digital
        // disso: a atribuição virou uma gravação de dado.
        push(
          'SONDA',
          'atribuição sombreou? ' +
            (localStorage.setItem && localStorage.setItem.__dbg === true ? 'SIM' : 'NÃO')
        );
        push(
          'SONDA',
          'item lixo "setItem"? ' +
            (localStorage.getItem('setItem') ? 'SIM — hipótese confirmada' : 'não')
        );
      } catch (err) {
        push('ESTADO', 'erro: ' + err.message);
      }
    });

    const copy = btn('copiar', () => {
      const done = () => (copy.textContent = 'copiado!');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(logStr).then(done, () => fallback(done));
      } else fallback(done);
    });

    function fallback(done) {
      const ta = document.createElement('textarea');
      ta.value = logStr;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        done();
      } catch (_) {
        copy.textContent = 'falhou';
      }
      ta.remove();
    }

    const clear = btn('limpar', () => {
      logStr = '';
      persist();
      bodyEl.textContent = '';
    });

    const off = btn('desligar', () => {
      try {
        localStorage.removeItem(ON_KEY);
      } catch (_) {}
      panel.remove();
      badge.remove();
    });

    bar.append(title, hide, revs, forcar, info, copy, clear, off);

    bodyEl = document.createElement('div');
    bodyEl.style.cssText =
      'overflow:auto;padding:6px;flex:1 1 auto;-webkit-overflow-scrolling:touch';

    panel.append(bar, bodyEl);
    document.body.appendChild(panel);

    // Só as últimas linhas: renderizar o log inteiro custaria caro na abertura.
    const linhas = logStr.split('\n').filter(Boolean).slice(-150);
    linhas.forEach((l) => {
      const m = l.match(/\]\s(\S+)\s/);
      render(l, m ? m[1] : '');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
}
