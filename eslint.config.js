'use strict';

// Flat config — ESLint 9. Escopo: api/, scripts/, web/. NÃO lintamos os HTMLs
// monolíticos (Appliquei_v13.0.html, admin.html, landing.html) — JS inline
// neles fica fora do escopo da Onda 1 e seria milhares de avisos sem ganho.

const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '.vercel/**',
      'graphify-out/**',
      '*.html',
      'web/firebase-config.local.js',
    ],
  },

  // API + scripts: Node (CommonJS).
  {
    files: ['api/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-undef': 'error',
      'no-var': 'warn',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-prototype-builtins': 'off',
    },
  },

  // web/: navegador. Mix de IIFE legado (script) e ES modules da Onda 3.
  // sourceType=module aceita export/import sem rejeitar IIFEs antigos —
  // wrapper `(function () { ... })()` continua válido como expressão.
  {
    files: ['web/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        firebase: 'readonly',
        google: 'readonly',
        AppliqueiFirebase: 'readonly',
        // Globais definidos no <script> inline grande do Appliquei_v13.0.html
        // que módulos extraídos durante a Onda 3 ainda consomem (até serem
        // migrados também). Lista crescerá conforme novas extrações.
        mostrarToast: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'error',
      'no-var': 'off',
      'prefer-const': 'off',
      eqeqeq: 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
      'no-constant-condition': ['warn', { checkLoops: false }],
    },
  },

  // appliquei-app.js + appliquei-utils.js: classic scripts (não-módulos)
  // extraídos do inline. Funções top-level são globais por contrato — o
  // HTML tem 100+ handlers `onclick="funcaoX()"` dependendo disso. Tratar
  // como módulo levaria a milhares de "undefined" falsos.
  // no-undef desligado pelo mesmo motivo: cross-refs internas viram globais
  // entre os arquivos (utils.js -> app.js, e vice-versa).
  {
    files: [
      'web/appliquei-app.js',
      'web/appliquei-utils.js',
      'web/appliquei-aba-simulador.js',
      'web/appliquei-aba-carteira-recomendada.js',
      'web/appliquei-aba-info-mercado.js',
      'web/appliquei-aba-dividendos.js',
      'web/appliquei-aba-controle-financeiro.js',
      'web/appliquei-relatorio-mensal.js',
      'web/appliquei-applicash.js',
      'web/appliquei-duvidas.js',
      'web/appliquei-patrimonio.js',
      'web/appliquei-jornada.js',
      'web/appliquei-sonhos.js',
      'web/appliquei-aba1-charts.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        firebase: 'readonly',
        google: 'readonly',
        Chart: 'readonly',
        ChartDataLabels: 'readonly',
        AppliqueiFirebase: 'readonly',
        AppliqueiBilling: 'readonly',
        AppliqueiCloudSync: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-constant-condition': 'off',
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'off',
      'no-irregular-whitespace': 'off',
      'no-async-promise-executor': 'off',
      'no-inner-declarations': 'off',
    },
  },
];
