// @trace RF-002 RN-017 TS-009 TS-022 TS-036 ERR-008 requestPasswordReset confirmPasswordReset createSession
// Redefinicao de senha na aplicacao web (DC-053), contra a API, o worker e o PostgreSQL reais:
// pedido com resposta neutra, link do e-mail, senha comprometida recusada (TS-036), confirmacao
// divergente, sucesso com entrada pela nova senha e link invalido (TS-009); axe nas telas.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y.js';
import { linkFor } from './support/mailbox.js';
import { activeUser, uniqueEmail } from './support/seed.js';

const NEW_PASSWORD = 'Outra-Senha-Sintetica-77';
const alertIn = (page: Page) => page.getByRole('main').getByRole('alert');

async function choose(page: Page, password: string, confirmation = password): Promise<void> {
  await page.getByLabel('Nova senha', { exact: true }).fill(password);
  await page.getByLabel('Confirme a nova senha').fill(confirmation);
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
}

test.describe('redefinicao de senha', () => {
  test('pedido neutro, link do e-mail e nova senha valendo na entrada', async ({ page }) => {
    const email = uniqueEmail();
    await activeUser(email);
    await page.goto('/entrar');
    await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Esqueci minha senha' }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByLabel('E-mail').fill(email);
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByRole('status')).toContainText('redefinir a senha');

    await page.goto(await linkFor(email));
    await expect(page.getByRole('heading', { level: 1, name: 'Redefinir senha' })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    await expectNoA11yViolations(page);

    await choose(page, NEW_PASSWORD, 'Outra-Diferente-77');
    await expect(page.getByText('As senhas não coincidem.')).toBeVisible();

    await choose(page, 'Password123');
    await expect(
      page.getByText('Esta senha aparece em listas de senhas vazadas. Escolha outra.'),
    ).toBeVisible();

    await choose(page, NEW_PASSWORD);
    await expect(page.getByRole('status')).toHaveText(
      'Senha alterada. Por segurança, todas as sessões foram encerradas.',
    );
    await page.getByRole('link', { name: 'Entrar' }).click();
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/hoje$/);
  });

  test('e-mail sem conta: mesma resposta neutra', async ({ page }) => {
    await page.goto('/conta/esqueci-senha');
    await page.getByLabel('E-mail').fill(uniqueEmail('sem.conta'));
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByRole('status')).toContainText('redefinir a senha');
  });

  test('link invalido: ERR-008 com caminho para pedir outro (TS-009)', async ({ page }) => {
    await page.goto('/conta/redefinir-senha#token=' + 'x'.repeat(43));
    await choose(page, NEW_PASSWORD);
    await expect(alertIn(page)).toHaveText('Este link não pode mais ser usado. Solicite um novo.');
    await page.getByRole('link', { name: 'Pedir novo link' }).click();
    await expect(page).toHaveURL(/\/conta\/esqueci-senha$/);
  });
});
