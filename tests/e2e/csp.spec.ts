// @trace RNF-009 TS-022 (ADR-001 v1.5 S6)
// Content-Security-Policy com nonce nas paginas (DC-059), contra a aplicacao em modo de producao:
// cabecalho em toda pagina, nonce novo por requisicao aplicado aos scripts do Next e nenhuma
// violacao de CSP numa jornada autenticada por todas as telas.
import { expect, test } from '@playwright/test';
import { PASSWORD, activeUser, uniqueEmail } from './support/seed.js';

const NONCE = /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'/;

test.describe('CSP com nonce', () => {
  test('cabecalho com nonce novo a cada requisicao, aplicado aos scripts', async ({ page }) => {
    const first = await page.goto('/entrar');
    const policy = first?.headers()['content-security-policy'] ?? '';
    expect(policy).toMatch(NONCE);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toMatch(/unsafe-(inline|eval)/);
    const nonce = NONCE.exec(policy)?.[1];

    const scripts = await page
      .locator('script')
      .evaluateAll((elements) => elements.map((element) => (element as { nonce?: string }).nonce));
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every((value) => value === nonce)).toBe(true);

    const second = await page.goto('/entrar');
    const again = NONCE.exec(second?.headers()['content-security-policy'] ?? '')?.[1];
    expect(again).toBeDefined();
    expect(again).not.toBe(nonce);
  });

  test('jornada autenticada sem violacoes de CSP', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
    });
    // Script como texto: os testes nao carregam os tipos do DOM.
    await page.addInitScript({
      content: `document.addEventListener('securitypolicyviolation', (event) => {
        console.error('Content Security Policy: ' + event.violatedDirective + ' ' + event.blockedURI);
      });`,
    });

    const email = uniqueEmail();
    await activeUser(email);
    await page.goto('/entrar');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Hoje' })).toBeVisible();
    for (const [link, heading] of [
      ['Planos', 'Planos'],
      ['Histórico', 'Histórico'],
      ['Exportar', 'Exportar histórico'],
      ['Privacidade', 'Privacidade'],
    ] as const) {
      await page
        .getByRole('navigation', { name: 'Principal' })
        .getByRole('link', { name: link })
        .click();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
    await page.goto('/planos/novo');
    await expect(page.getByRole('heading', { level: 1, name: 'Novo plano' })).toBeVisible();
    await page.goto('/cadastro');
    await expect(page.getByRole('heading', { level: 1, name: 'Criar conta' })).toBeVisible();
    expect(violations).toEqual([]);
  });
});
