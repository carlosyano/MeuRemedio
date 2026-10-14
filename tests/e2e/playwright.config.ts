// Playwright (QG-007 E2E e QG-008 acessibilidade com axe; DC-052). O global-setup sobe o
// PostgreSQL, a API e a aplicacao web; os testes rodam em serie contra esse ambiente.
import { defineConfig, devices } from '@playwright/test';
import { WEB_ORIGIN } from './support/global-setup.js';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  globalSetup: './support/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  forbidOnly: process.env['CI'] !== undefined,
  reporter: [['list']],
  use: {
    baseURL: WEB_ORIGIN,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
