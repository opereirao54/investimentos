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

  // web/: navegador (ES5+ legado, IIFE, vars). Permissivo de propósito —
  // refatoração estrutural é Onda 2/3, aqui só travamos os erros de fato.
  {
    files: ['web/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        firebase: 'readonly',
        google: 'readonly',
        AppliqueiFirebase: 'readonly',
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
];
