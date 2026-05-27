'use strict';

// Vite em modo MPA (multi-page app) — Onda 2 da modernização.
//
// Estratégia: Vite convive com o estado atual sem reescrever nada. Os três
// HTMLs continuam sendo arquivos completos (com JS/CSS inline e tags
// <script src> apontando para web/ e CDNs). O build:
//   - resolve as referências locais (web/*.js, *.png/jpg, *.css)
//   - mantém os CDNs como external
//   - aplica content-hash em assets locais (cache-busting automático,
//     substituindo o esquema manual ?v=YYYYMMDD)
//   - emite tudo para dist/
//
// Migração incremental: por enquanto, este config NÃO substitui o deploy
// (vercel.json continua servindo os HTMLs direto da raiz). O `npm run build`
// existe como sinal de viabilidade — quando estiver verde, atualizamos
// vercel.json para apontar pra dist/.

const { resolve } = require('path');
const fs = require('fs');
const { defineConfig } = require('vite');

// Plugin: copia web/ para dist/web/ no fim do build. Os HTMLs referenciam
// scripts como <script src="web/foo.js"> (sem type=module), então Vite não
// os bundla; eles precisam estar no mesmo path relativo no output. Quando
// migrarmos cada script para ES module (Onda 3), este plugin some.
function copyWebDir() {
  return {
    name: 'appliquei-copy-web',
    apply: 'build',
    closeBundle() {
      const src = resolve(__dirname, 'web');
      const dst = resolve(__dirname, 'dist', 'web');
      if (!fs.existsSync(src)) return;
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        // firebase-config.local.js fica no .gitignore e pode não existir.
        const s = resolve(src, f);
        if (fs.statSync(s).isFile()) fs.copyFileSync(s, resolve(dst, f));
      }
    },
  };
}

module.exports = defineConfig({
  // appType=mpa: cada HTML é uma entrada independente; não há fallback
  // para index.html no dev server (cada rota serve seu próprio HTML).
  appType: 'mpa',

  // publicDir=false: ainda não usamos public/. Arquivos como
  // appliquei-favicon.png ficam na raiz e Vite resolve via inputs.
  publicDir: false,

  plugins: [copyWebDir()],

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Mantém estrutura previsível em dist/ — debug fica mais fácil que com
    // hashes em todo lugar enquanto a base não foi modularizada.
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'landing.html'),
        // Nome do arquivo final preservado nas rewrites de vercel.json
        // (/app/* -> /Appliquei_v13.0.html). Mantemos o entry name.
        'Appliquei_v13.0': resolve(__dirname, 'Appliquei_v13.0.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
      // CDNs externos: Vite os reconhece como URL absoluta e deixa
      // intactos. Nada a configurar aqui.
    },
    // Inline scripts grandes e CSS inline são copiados sem split — o
    // bundle ainda é "uma coisa só por HTML". Onda 3 quebra isso.
    cssCodeSplit: false,
    // Minificação default (esbuild). Desligável se houver regressão visual.
    minify: 'esbuild',
    // O HTML monolítico passa de 900KB; o warning default a 500kb é ruído.
    chunkSizeWarningLimit: 2000,
  },

  server: {
    port: 5173,
    open: '/landing.html',
    // /api/* não existe no dev server (são Vercel Functions). Em dev,
    // chamadas a /api/* falham — para testar billing localmente, rode
    // `vercel dev` em paralelo na porta 3000 e ajuste fetch base URL.
  },
});
