// @trace TL-008 RF-010 RF-011 RN-012 CA-014 TS-010 TS-022 TS-026 ERR-011 getPrivacy requestAccountDeletion getCurrentAccount
// Privacidade (TL-008; DC-058), contra a API e o PostgreSQL reais: dados (direitos, canal externo e
// prazos), confirmacao destrutiva, reautenticacao com senha errada sem excluir, exclusao agendada
// com o acesso encerrado na hora (RN-012) e erro ao carregar; axe sem violacoes WCAG 2.2 A/AA.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y.js';
import { PASSWORD, activeUser, uniqueEmail } from './support/seed.js';

const alertIn = (page: Page) => page.getByRole('main').getByRole('alert');
const statusIn = (page: Page) => page.getByRole('main').getByRole('status');
const CONFIRMATION = 'EXCLUIR MINHA CONTA';

async function signedIn(page: Page): Promise<string> {
  const email = uniqueEmail();
  await activeUser(email);
  await page.goto('/entrar?proximo=%2Fprivacidade');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/privacidade$/);
  return email;
}

async function openDeletion(page: Page) {
  await page.getByRole('button', { name: 'Excluir minha conta' }).click();
  return page.getByRole('region', { name: 'Excluir a conta' });
}

test.describe('TL-008 privacidade', () => {
  test('dados: direitos, canal externo e prazos de retencao (RF-010, RF-011)', async ({ page }) => {
    await signedIn(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacidade' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Consultar o histórico' })).toHaveAttribute(
      'href',
      '/historico',
    );
    await expect(page.getByRole('link', { name: 'Exportar o histórico em PDF' })).toHaveAttribute(
      'href',
      '/exportacao',
    );
    await expect(page.getByRole('link', { name: 'Canal de direitos do titular' })).toHaveAttribute(
      'href',
      'https://privacidade.example.invalid/direitos',
    );
    const retention = page.getByRole('list', { name: 'Prazos de retenção' });
    await expect(retention).toContainText('PDF exportado: 24 horas');
    await expect(retention).toContainText('Dados da conta após o pedido de exclusão: até 30 dias');
    await expect(retention).toContainText('Registro mínimo de conta excluída: 180 dias');
    await expectNoA11yViolations(page);
  });

  test('confirmacao destrutiva: avisos, validacao e cancelar', async ({ page }) => {
    await signedIn(page);
    const deletion = await openDeletion(page);
    await expect(deletion).toContainText('O acesso termina na hora');
    await expect(deletion).toContainText('não pode ser desfeita');
    await expectNoA11yViolations(page);

    await deletion.getByRole('button', { name: 'Excluir conta definitivamente' }).click();
    await expect(alertIn(page)).toHaveText('Revise os campos destacados e tente novamente.');
    await expect(page.getByText(`Digite ${CONFIRMATION} para confirmar.`)).toBeVisible();
    await expect(page.getByText('Informe sua senha.')).toBeVisible();
    await expectNoA11yViolations(page);

    await deletion.getByRole('button', { name: 'Cancelar' }).click();
    await expect(deletion).toHaveCount(0);
  });

  test('reautenticacao: senha errada nao exclui e a sessao continua', async ({ page }) => {
    await signedIn(page);
    const deletion = await openDeletion(page);
    await deletion.getByLabel(`Digite ${CONFIRMATION}`).fill(CONFIRMATION);
    await deletion.getByLabel('Senha atual').fill('Senha-Errada-2026');
    await deletion.getByRole('button', { name: 'Excluir conta definitivamente' }).click();
    await expect(alertIn(page)).toHaveText(
      'Não foi possível confirmar a senha. Confira e tente de novo; depois de 5 tentativas erradas, aguarde 15 minutos.',
    );
    await expect(deletion.getByLabel('Senha atual')).toHaveAttribute('aria-invalid', 'true');
    await page.goto('/hoje');
    await expect(page).toHaveURL(/\/hoje$/);
  });

  test('exclusao agendada: acesso encerrado na hora (RN-012, TS-026)', async ({ page }) => {
    const email = await signedIn(page);
    const deletion = await openDeletion(page);
    await deletion.getByLabel(`Digite ${CONFIRMATION}`).fill(CONFIRMATION);
    await deletion.getByLabel('Senha atual').fill(PASSWORD);
    await deletion.getByRole('button', { name: 'Excluir conta definitivamente' }).click();
    await expect(statusIn(page)).toContainText('Exclusão agendada.');
    await expect(statusIn(page)).toContainText('Os dados serão removidos até');
    await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(0);
    await expectNoA11yViolations(page);

    await page.goto('/hoje');
    await expect(page).toHaveURL(/\/entrar\?proximo=%2Fhoje$/);
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(alertIn(page)).toBeVisible();
    await expect(page).toHaveURL(/\/entrar/);
  });

  test('erro ao carregar: ERR-011 com nova tentativa (TS-010)', async ({ page }) => {
    await signedIn(page);
    await page.route('**/api/privacy', (route) => route.abort('connectionrefused'));
    await page.reload();
    await expect(alertIn(page)).toHaveText(
      'O serviço está temporariamente indisponível. Tente novamente.',
    );
    await expect(page.getByRole('button', { name: 'Excluir minha conta' })).toHaveCount(0);
    await page.unroute('**/api/privacy');
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByRole('link', { name: 'Canal de direitos do titular' })).toBeVisible();
  });
});
