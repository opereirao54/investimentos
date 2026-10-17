// Captura telas reais do app no celular, com dados de demonstração, para
// posts e vídeos. Nada aqui toca em dado de usuário: o app abre vazio no
// navegador headless e recebe contas, lançamentos e sonhos de exemplo.
//
//   npm run build && BROWSER=none npx vite preview --port 4173 --strictPort &
//   node marketing/ferramentas/telas-app.js <pasta-saida>
//
// Gera (1170×2532, iPhone 3x): tela-inicio.png, tela-inicio2.png,
// tela-sonhos.png, tela-sim.png, tela-patrimonio.png, tela-extrato.png e
// card-aviso.png (o cartão "sai mais do que entra" recortado).
//
// Os ícones (Phosphor) vêm do unpkg no app; quando o CDN está bloqueado, o
// pacote é baixado do npm (`npm pack`) e servido localmente.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const saida = path.resolve(process.argv[2] || 'telas');
fs.mkdirSync(saida, { recursive: true });
const URL_APP = process.env.APP_URL || 'http://localhost:4173/Appliquei_v13.0.html';
const RAIZ = path.join(__dirname, '..', '..');

function phosphorLocal() {
  const dir = path.join(os.tmpdir(), 'appliquei-phosphor');
  const pkg = path.join(dir, 'package');
  if (!fs.existsSync(pkg)) {
    fs.mkdirSync(dir, { recursive: true });
    execSync('npm pack @phosphor-icons/web@2.1.1 --silent', { cwd: dir });
    execSync('tar xzf phosphor-icons-web-2.1.1.tgz', { cwd: dir });
  }
  return pkg;
}

/** Monta um mês de exemplo saudável: salário, fixas, variáveis, investimento e contas a vencer. */
async function popular(p, { aperto }) {
  await p.evaluate(async (aperto) => {
    document
      .querySelectorAll('[id^=authGate], #ppBoasVindas, .pp-boas-vindas')
      .forEach((e) => e.remove());
    const nu = criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: aperto ? 400 : 2400 });
    const it = criarConta({ nome: 'Itaú', tipo: 'banco', saldoInicial: 1200 });
    const h = new Date();
    const m = h.getMonth();
    const a = h.getFullYear();
    const dia = (d) => new Date(a, m, d, 12).toISOString();
    let n = 0;
    const tx = (o) =>
      transacoes.push(
        Object.assign(
          {
            id: 'demo' + ++n,
            mes: m,
            ano: a,
            banco: 'Nubank',
            contaId: nu.id,
            data: dia(o.d),
            dataVencimento: dia(o.d).slice(0, 10),
            pago: o.p !== false,
          },
          o.p !== false ? { pagoEm: dia(Math.min(o.d, h.getDate())) } : {},
          o
        )
      );
    tx({ descricao: 'Salário', categoria: 'receita', valor: aperto ? 6800 : 11500, d: 5 });
    tx({ descricao: 'Aluguel', categoria: 'despesa_fixa', valor: 1900, d: 6 });
    tx({ descricao: 'Mercado', categoria: 'despesa_variavel', valor: 780, d: 9 });
    tx({ descricao: 'Academia', categoria: 'despesa_fixa', valor: 120, d: 10 });
    tx({ descricao: 'Restaurante', categoria: 'despesa_variavel', valor: 240, d: 14 });
    tx({
      descricao: 'Tesouro Selic',
      categoria: 'investimento_fixo',
      valor: aperto ? 900 : 2500,
      d: 8,
    });
    tx({ descricao: 'Condomínio', categoria: 'despesa_fixa', valor: 650, d: 20, p: false });
    tx({ descricao: 'Internet', categoria: 'despesa_fixa', valor: 130, d: 22, p: false });
    tx({ descricao: 'Escola', categoria: 'despesa_fixa', valor: 2200, d: 25, p: false });
    transacoes.forEach((t) => {
      if (!t.pago) delete t.pagoEm;
    });
    salvarTransacoes();
    void it;
    window.confirm = () => true;
    const set = (id, v) => {
      const e = document.getElementById(id);
      e.value = v;
      e.dispatchEvent(new Event('input'));
      e.dispatchEvent(new Event('change'));
    };
    const novo = async (nome, total, ini, prazo, cat) => {
      abrirCadastroSonho();
      set('sonhoNome', nome);
      set('sonhoValorTotal', total);
      set('sonhoValorInicial', ini);
      set('sonhoPrazo', prazo);
      set('sonhoCategoria', cat);
      const s = document.getElementById('sonhoContaOrigem');
      s.value = Array.from(s.options).find((o) => o.value).value;
      irParaPreviaSonho();
      await new Promise((r) => setTimeout(r, 100));
      salvarSonho();
      await new Promise((r) => setTimeout(r, 200));
      document.querySelectorAll('#modalConfirmacao').forEach((x) => (x.style.display = 'none'));
    };
    await novo('Viagem para o Japão', '24.000,00', '6.200,00', '24', 'viagem');
    await novo('Reserva de emergência', '30.000,00', '14.500,00', '18', 'reserva');
    await novo('Carro novo', '45.000,00', '8.000,00', '36', 'veiculo');
    mobIrPara('controle');
    atualizarTelaControle();
  }, aperto);
}

(async () => {
  const { chromium } = require(path.join(RAIZ, 'node_modules', 'playwright'));
  const exe =
    process.env.CHROMIUM_PATH ||
    (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const PH = phosphorLocal();

  async function abrir() {
    const ctx = await b.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      timezoneId: 'America/Sao_Paulo',
      locale: 'pt-BR',
    });
    await ctx.route(/unpkg\.com\/@phosphor-icons\/web/, (route) => {
      const u = new URL(route.request().url());
      const rel = u.pathname.replace(/^\/@phosphor-icons\/web(@[\d.]+)?\/?/, '') || 'src/index.js';
      const f = path.join(PH, rel);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      const tipo =
        {
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.woff2': 'font/woff2',
          '.woff': 'font/woff',
        }[path.extname(f)] || 'application/octet-stream';
      route.fulfill({
        status: 200,
        body: fs.readFileSync(f),
        headers: { 'content-type': tipo, 'access-control-allow-origin': '*' },
      });
    });
    // Sem rede para o Chart.js, os gráficos ficam vazios mas o resto desenha.
    await ctx.addInitScript(() => {
      if (window.Chart) return;
      const f = () =>
        new Proxy(function () {}, {
          get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k in t ? t[k] : (t[k] = f())),
          set: () => true,
          apply: () => f(),
          construct: () => ({
            destroy() {},
            update() {},
            data: { datasets: [], labels: [] },
            options: {},
          }),
        });
      window.Chart = f();
      window.ChartDataLabels = {};
    });
    const p = await ctx.newPage();
    await p.goto(URL_APP, { waitUntil: 'load' });
    await p.waitForTimeout(2500);
    return { ctx, p };
  }
  const limpar = (p) =>
    p.evaluate(() =>
      document.querySelectorAll('.toast, [class*=toast]').forEach((t) => t.remove())
    );
  const foto = async (p, nome, preparo) => {
    await p.evaluate(preparo);
    await p.waitForTimeout(700);
    await limpar(p);
    await p.screenshot({ path: path.join(saida, nome) });
  };

  // 1) Mês saudável: as telas de produto.
  {
    const { ctx, p } = await abrir();
    await popular(p, { aperto: false });
    await foto(p, 'tela-inicio.png', () => (document.querySelector('.main-content').scrollTop = 0));
    await foto(
      p,
      'tela-inicio2.png',
      () => (document.querySelector('.main-content').scrollTop = 520)
    );
    await foto(p, 'tela-sonhos.png', () => {
      mobIrPara('meus_sonhos');
      renderizarSonhos();
      document.querySelector('.main-content').scrollTop = 0;
    });
    await foto(p, 'tela-sim.png', () => {
      mobIrPara('simulador');
      document.querySelector('.main-content').scrollTop = 0;
    });
    await foto(p, 'tela-patrimonio.png', () => {
      mobIrPara('meu_patrimonio');
      document.querySelector('.main-content').scrollTop = 0;
    });
    await foto(p, 'tela-extrato.png', () => {
      mobIrPara('controle');
      mobSegControle('extrato');
      document.querySelector('.main-content').scrollTop = 0;
    });
    await ctx.close();
  }

  // 2) Mês apertado: o aviso "sai mais do que entra", recortado.
  {
    const { ctx, p } = await abrir();
    await popular(p, { aperto: true });
    await p.evaluate(() => mobStoryAbrir(0));
    await p.waitForTimeout(700);
    await limpar(p);
    const caixa = await p.evaluate(() => {
      // O cartão é o menor ancestro comum do título e do botão do aviso.
      const visiveis = (re) =>
        Array.from(document.querySelectorAll('body *')).filter((e) => {
          const proprio = Array.from(e.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent)
            .join('');
          return re.test(proprio) && e.getBoundingClientRect().width > 0;
        });
      const titulo = visiveis(/sai mais do que entra/i)[0];
      const botao = visiveis(/Ver os vencimentos/i)[0];
      if (!titulo || !botao) return null;
      let el = botao;
      while (el && !el.contains(titulo)) el = el.parentElement;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (caixa) await p.screenshot({ path: path.join(saida, 'card-aviso.png'), clip: caixa });
    else console.warn('aviso de aperto não apareceu; card-aviso.png não foi gerado');
    await ctx.close();
  }

  await b.close();
  console.log('telas em', saida);
})();
