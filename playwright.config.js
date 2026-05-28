'use strict';

// Playwright config — Fase 4 da auditoria.
//
// Estratégia: roda contra `vite preview` (build de produção em dist/),
// não contra `vite dev`. Razões:
//   1. Preview reflete o output real de produção (assets hasheados,
//      bundle minificado) — pega regressão de build.
//   2. Sem HMR / overlays do dev server — testes determinísticos.
//   3. `webServer` builda + serve antes de rodar; CI não precisa de step
//      separado.
//
// Browsers baixam em ~/.cache/ms-playwright (fora de node_modules). Em
// dev local, rodar uma vez: `npm run test:e2e:install`. Em CI, o step
// dedicado no workflow faz isso.

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  // Falhas isoladas valem mais que reportar tudo — em CI fail-fast no PR.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,

  reporter: process.env.CI ? [['github'], ['list']] : 'list',

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Builda + preview. `vite preview` default = 4173.
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173/landing.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
