// Painel de log na própria tela, para diagnosticar sync no celular — onde não
// existe DevTools. Inerte por padrão: só liga com ?debug=1 na URL ou com
// localStorage.dbg_sync_on === '1'. Não altera nenhum comportamento do app;
// apenas observa.
//
// Por que existe: o bug "cadastrei no celular e não gravou" sobreviveu a quatro
// correções feitas às cegas, por leitura de código. Sem ver o que o aparelho
// realmente faz, a quinta seria mais um chute.
//
// A parte que mais importa aqui é a PERSISTÊNCIA do log. A hipótese em teste é
// que o iOS mata a aba no meio do upload de 354KB (que leva ~2,7s até num PC).
// Se isso acontece, um log em memória morre junto e não sobra prova nenhuma.
// Por isso cada linha vai para o localStorage na hora: quando o app reabrir, o
// registro do que aconteceu antes da morte ainda está lá.
//
// A chave `dbg_sync_log` NÃO usa os prefixos `appliquei_`/`futurorico_` de
// propósito — assim o interceptador de setItem não a vê e o log não entra no
// próprio sync que estamos investigando.

const LOG_KEY = 'dbg_sync_log';
const ON_KEY = 'dbg_sync_on';
const MAX_ENTRIES = 400;
const MAX_CHARS = 120 * 1024;

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
  const entries = load();
  let panel = null;
  let bodyEl = null;

  // Marca visível de fronteira entre sessões: se o app reabriu, é porque a
  // anterior terminou — de propósito ou porque o SO matou a aba.
  push('---', 'sessão iniciada ' + new Date().toLocaleTimeString('pt-BR'));

  function load() {
    try {
      const raw = localStorage.getItem(LOG_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  function persist() {
    try {
      while (
        entries.length > MAX_ENTRIES ||
        (entries.length > 1 && JSON.stringify(entries).length > MAX_CHARS)
      ) {
        entries.shift();
      }
      localStorage.setItem(LOG_KEY, JSON.stringify(entries));
    } catch (_) {}
  }

  function push(tag, msg) {
    const e = { t: Date.now() - t0, clock: new Date().toLocaleTimeString('pt-BR'), tag, msg };
    entries.push(e);
    persist();
    render(e);
  }

  function fmt(e) {
    return '[' + e.clock + ' +' + e.t + 'ms] ' + e.tag + ' ' + e.msg;
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
        // Só o que interessa ao sync — senão o painel vira ruído.
        if (lvl === 'error' || /Cloud|ync|beacon|push|firebase/i.test(txt)) push(lvl, txt);
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
  // O cerne da investigação: queremos ver se a página é escondida/congelada
  // ENQUANTO um push está em voo. O par "push iniciado" sem o "push concluído"
  // correspondente, seguido de um evento destes, é a prova do transporte
  // morrendo no meio.

  document.addEventListener('visibilitychange', () =>
    push('CICLO', 'visibility=' + document.visibilityState)
  );
  window.addEventListener('pagehide', (e) => push('CICLO', 'pagehide persisted=' + e.persisted));
  window.addEventListener('pageshow', (e) => push('CICLO', 'pageshow persisted=' + e.persisted));
  window.addEventListener('freeze', () => push('CICLO', 'freeze (SO congelou a aba)'));
  window.addEventListener('resume', () => push('CICLO', 'resume'));
  window.addEventListener('online', () => push('REDE', 'online'));
  window.addEventListener('offline', () => push('REDE', 'offline'));

  // ---------------- interceptação do fetch ----------------

  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  let seq = 0;
  if (origFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/api/sync/push') === -1) return origFetch(input, init);

      const n = ++seq;
      const body = (init && init.body) || '';
      const kb = Math.round((typeof body === 'string' ? body.length : 0) / 1024);
      const ka = !!(init && init.keepalive);
      const started = Date.now();
      push('PUSH→', '#' + n + ' iniciado ' + kb + 'KB keepalive=' + ka);

      return origFetch(input, init).then(
        (r) => {
          const ms = Date.now() - started;
          r.clone()
            .text()
            .then((txt) => {
              push(
                'PUSH✓',
                '#' + n + ' HTTP ' + r.status + ' em ' + ms + 'ms → ' + txt.slice(0, 300)
              );
            })
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

  const origBeacon =
    typeof navigator !== 'undefined' && navigator.sendBeacon
      ? navigator.sendBeacon.bind(navigator)
      : null;
  if (origBeacon) {
    navigator.sendBeacon = function (url, data) {
      const ok = origBeacon(url, data);
      if (String(url).indexOf('/api/sync/push') !== -1) {
        push('BEACON', 'sendBeacon aceito pelo browser=' + ok + ' size=' + (data && data.size));
      }
      return ok;
    };
  }

  // ---------------- cadeia de gravação ----------------
  // A primeira coleta não mostrou UM ÚNICO push em 4 minutos: o upload não
  // morre no meio, ele nunca começa. Isso move a suspeita para antes do envio.
  // Os três pontos abaixo cercam a cadeia inteira, para localizar onde ela
  // corta em vez de adivinhar:
  //
  //   setItem  →  onLocalWrite  →  beacon
  //     ↑             ↑              ↑
  //   grava?     foi avisado?     enviou?
  //
  // Sem isso não dá para distinguir "o app não salvou", "salvou mas o sync não
  // soube" e "soube mas desistiu" — três bugs diferentes com o mesmo sintoma.
  // onLocalWrite tem dois `return` silenciosos logo na entrada (applyingPull e
  // shouldSyncKey); se a flag do pull ficar presa, toda gravação some sem
  // rastro. É a hipótese principal agora.

  try {
    const origSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      if (k && /^(futurorico_|appliquei_)/.test(k)) {
        push('GRAVA', k + ' ' + Math.round(String(v).length / 1024) + 'KB');
      }
      return origSet(k, v);
    };
  } catch (_) {}

  let wrapped = false;
  function wrapSync() {
    if (wrapped) return true;
    const cs = window.AppliqueiCloudSync;
    if (!cs || typeof cs.onLocalWrite !== 'function') return false;
    wrapped = true;
    const orig = cs.onLocalWrite.bind(cs);
    cs.onLocalWrite = function (key) {
      push('AVISA', 'onLocalWrite(' + key + ')');
      const r = orig(key);
      // Se nenhum PUSH→ aparecer depois desta linha, o sync foi avisado e
      // desistiu por dentro — provavelmente applyingPull preso.
      return r;
    };
    push('---', 'sync instrumentado');
    return true;
  }
  if (!wrapSync()) {
    let tries = 0;
    const iv = setInterval(() => {
      if (wrapSync() || ++tries > 60) clearInterval(iv);
      if (tries > 60) push('ERRO', 'AppliqueiCloudSync nunca apareceu — módulo não carregou');
    }, 500);
  }

  // ---------------- painel ----------------

  function render(e) {
    if (!bodyEl) return;
    const line = document.createElement('div');
    line.textContent = fmt(e);
    line.style.cssText =
      'padding:2px 0;border-bottom:1px solid #222;' +
      (e.tag === 'ERRO' || e.tag === 'PUSH✗' || e.tag === 'error'
        ? 'color:#ff6b6b'
        : e.tag === 'PUSH✓'
          ? 'color:#51cf66'
          : e.tag === 'CICLO'
            ? 'color:#ffd43b'
            : 'color:#ced4da');
    bodyEl.appendChild(line);
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
      'display:flex;gap:6px;padding:6px;background:#15151a;align-items:center;flex:0 0 auto';

    const title = document.createElement('span');
    title.textContent = 'sync debug';
    title.style.cssText = 'color:#868e96;margin-right:auto';

    function btn(label, fn) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText =
        'background:#343a40;color:#e9ecef;border:0;border-radius:4px;padding:6px 10px;font:11px monospace';
      b.addEventListener('click', fn);
      return b;
    }

    const copy = btn('copiar', () => {
      const txt = entries.map(fmt).join('\n');
      const done = () => (copy.textContent = 'copiado!');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, () => fallback(txt, done));
      } else fallback(txt, done);
    });

    function fallback(txt, done) {
      const ta = document.createElement('textarea');
      ta.value = txt;
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
      } catch (err) {
        push('ESTADO', 'erro: ' + err.message);
      }
    });

    const clear = btn('limpar', () => {
      entries.length = 0;
      persist();
      bodyEl.textContent = '';
    });

    const off = btn('desligar', () => {
      try {
        localStorage.removeItem(ON_KEY);
      } catch (_) {}
      panel.remove();
    });

    // Valida o próprio instrumento. Sem este botão, "nenhum PUSH no log" é
    // ambíguo: pode ser que o app não empurre, pode ser que o painel não veja.
    // Concluir com o medidor sem aferir seria repetir o erro das quatro
    // tentativas anteriores.
    const forcar = btn('forçar push', () => {
      const cs = window.AppliqueiCloudSync;
      if (!cs) return push('ERRO', 'AppliqueiCloudSync não existe');
      push('---', 'forçando push manual...');
      try {
        cs.onLocalWrite('futurorico_transacoes');
      } catch (e) {
        push('ERRO', 'onLocalWrite lançou: ' + e.message);
      }
      setTimeout(() => {
        const teve = entries.some((x) => x.tag === 'PUSH→' && x.t > Date.now() - t0 - 4000);
        push('---', teve ? 'instrumento OK: push observado' : 'NENHUM push após forçar');
      }, 3500);
    });

    bar.append(title, forcar, info, copy, clear, off);

    bodyEl = document.createElement('div');
    bodyEl.style.cssText =
      'overflow:auto;padding:6px;flex:1 1 auto;-webkit-overflow-scrolling:touch';

    panel.append(bar, bodyEl);
    document.body.appendChild(panel);
    entries.forEach(render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
}
