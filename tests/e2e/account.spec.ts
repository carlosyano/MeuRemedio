// @trace RF-001 RF-002 RF-009 CA-015 TS-010 TS-022 TS-044 ERR-001 getCurrentAccount updateCurrentAccount getAccessibilityPreferences updateAccessibilityPreferences revokeAllSessions
// Conta na aplicacao web (DC-061), contra a API e o PostgreSQL reais: dados da conta com o fuso
// imutavel (CA-015), troca do nome, preferencias de acessibilidade aplicadas em todas as telas da
// area logada (RF-009) e encerramento de todas as sessoes com reautenticacao (TS-044); axe sem
// violacoes WCAG 2.2 A/AA, inclusive com alto contraste.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y.js';
import { PASSWORD, activeUser, uniqueEmail } from './support/seed.js';

const alertIn = (page: Page) => page.getByRole('main').getByRole('alert');
const statusIn = (page: Page) => page.getByRole('main').getByRole('status');

async function signIn(page: Page, email: string, next = '/conta'): Promise<void> {
  await page.goto(`/entrar?proximo=${encodeURIComponent(next)}`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL((url) => url.pathname === next);
}

async function signedIn(page: Page): Promise<string> {
  const email = uniqueEmail();
  await activeUser(email);
  await signIn(page, email);
  return email;
}

async function otherSession(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, '/hoje');
  return { context, page };
}

test.describe('conta', () => {
  test('dados: nome editavel, e-mail e fuso imutavel (CA-015)', async ({ page }) => {
    const email = await signedIn(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Conta' })).toBeVisible();
    await expect(page.getByLabel('Nome')).toHaveValue('Ana Silva');
    await expect(page.getByRole('main')).toContainText(email);
    await expect(page.getByRole('main')).toContainText('America/Sao_Paulo');
    await expect(page.getByRole('main')).toContainText('O fuso horário não pode ser alterado.');
    await expectNoA11yViolations(page);
  });

  test('alterar o nome: salvo e usado na area logada', async ({ page }) => {
    await signedIn(page);
    await page.getByLabel('Nome').fill('  Ana Souza ');
    await page.getByRole('button', { name: 'Salvar nome' }).click();
    await expect(statusIn(page)).toHaveText('Nome atualizado.');
    await page
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('link', { name: 'Hoje' })
      .click();
    await expect(page.getByText('Olá, Ana Souza')).toBeVisible();
  });

  test('nome vazio: validacao antes de enviar', async ({ page }) => {
    await signedIn(page);
    await page.getByLabel('Nome').fill('   ');
    await page.getByRole('button', { name: 'Salvar nome' }).click();
    await expect(alertIn(page)).toHaveText('Revise os campos destacados e tente novamente.');
    await expect(page.getByText('Informe seu nome.')).toBeVisible();
    await expect(page.getByLabel('Nome')).toHaveAttribute('aria-invalid', 'true');
  });

  test('preferencias de acessibilidade: aplicadas em todas as telas (RF-009)', async ({ page }) => {
    await signedIn(page);
    await expect(page.getByLabel('Tamanho do texto')).toHaveValue('100');
    await expect(page.getByLabel('Alto contraste')).not.toBeChecked();
    await page.getByLabel('Tamanho do texto').selectOption('150');
    await page.getByLabel('Alto contraste').check();
    await page.getByRole('button', { name: 'Salvar preferências' }).click();
    await expect(statusIn(page)).toHaveText('Preferências salvas.');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('style', /font-size: 150%/);
    await expect(html).toHaveAttribute('data-contrast', 'alto');
    await expectNoA11yViolations(page);

    // Outra tela, depois de recarregar: as preferencias vem da API.
    await page.goto('/planos');
    await expect(page.getByRole('heading', { level: 1, name: 'Planos' })).toBeVisible();
    await expect(html).toHaveAttribute('style', /font-size: 150%/);
    await expect(html).toHaveAttribute('data-contrast', 'alto');
    await expectNoA11yViolations(page);
  });

  test('encerrar todas as sessoes: senha errada nao encerra; certa encerra todas (TS-044)', async ({
    page,
    browser,
  }) => {
    const email = await signedIn(page);
    const other = await otherSession(browser, email);

    await page.getByRole('button', { name: 'Encerrar todas as sessões' }).click();
    const panel = page.getByRole('region', { name: 'Encerrar todas as sessões' });
    await expectNoA11yViolations(page);
    await panel.getByLabel('Senha atual').fill('Senha-Errada-2026');
    await panel.getByRole('button', { name: 'Encerrar sessões' }).click();
    await expect(alertIn(page)).toHaveText(
      'Não foi possível confirmar a senha. Confira e tente de novo; depois de 5 tentativas erradas, aguarde 15 minutos.',
    );
    await other.page.goto('/hoje');
    await expect(other.page).toHaveURL(/\/hoje$/);

    await panel.getByLabel('Senha atual').fill(PASSWORD);
    await panel.getByRole('button', { name: 'Encerrar sessões' }).click();
    await expect(statusIn(page)).toHaveText(
      'Todas as sessões foram encerradas, inclusive esta. Entre novamente para continuar.',
    );
    await other.page.goto('/hoje');
    await expect(other.page).toHaveURL(/\/entrar\?proximo=%2Fhoje$/);
    await page.goto('/conta');
    await expect(page).toHaveURL(/\/entrar\?proximo=%2Fconta$/);
    await other.context.close();
  });

  test('servico indisponivel ao salvar: ERR-011 sem declarar sucesso (TS-010)', async ({
    page,
  }) => {
    await signedIn(page);
    await page.route('**/api/preferences/accessibility', (route) =>
      route.request().method() === 'PUT' ? route.abort('connectionrefused') : route.fallback(),
    );
    await page.getByLabel('Alto contraste').check();
    await page.getByRole('button', { name: 'Salvar preferências' }).click();
    await expect(alertIn(page)).toHaveText(
      'O serviço está temporariamente indisponível. Tente novamente.',
    );
    await expect(statusIn(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-contrast', 'alto');
  });
});
