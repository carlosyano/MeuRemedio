// @trace TL-002 RF-002 RN-004 RN-005 CA-003 CA-004 TS-010 TS-018 TS-019 TS-022 TS-033 ERR-004 ERR-011 ERR-013 createSession getCurrentAccount deleteCurrentSession
// Jornada de entrada na aplicacao web (TL-002; DC-052), contra a API e o PostgreSQL reais:
// credencial invalida, bloqueio apos 5 falhas (RN-005), limite de 3 sessoes (TS-018), servico
// indisponivel sem declarar sucesso (TS-010), link de area logada sem sessao (TS-019), sucesso e
// saida; axe sem violacoes WCAG 2.2 A/AA nas telas (TS-022).
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y.js';
import { PASSWORD, activeUser, uniqueEmail } from './support/seed.js';

async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test.describe('TL-002 entrar', () => {
  test('estado inicial acessivel, com campos rotulados', async ({ page }) => {
    await page.goto('/entrar');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
    await expect(page).toHaveTitle(/Entrar/);
    await expectNoA11yViolations(page);
  });

  test('credencial invalida: mensagem sem revelar se o e-mail existe', async ({ page }) => {
    const email = uniqueEmail();
    await activeUser(email);
    await page.goto('/entrar');
    await signIn(page, email, 'Senha-Errada-2026');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'E-mail ou senha incorretos.',
    );
    await signIn(page, uniqueEmail('inexistente'), 'Senha-Errada-2026');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'E-mail ou senha incorretos.',
    );
    await expect(page).toHaveURL(/\/entrar/);
    await expectNoA11yViolations(page);
  });

  test('bloqueio apos 5 falhas: ERR-004 com o tempo de espera (RN-005, TS-033)', async ({
    page,
  }) => {
    const email = uniqueEmail();
    await activeUser(email);
    await page.goto('/entrar');
    for (let i = 0; i < 5; i += 1) await signIn(page, email, `Senha-Errada-${String(i)}`);
    await signIn(page, email);
    const alert = page.getByRole('main').getByRole('alert');
    await expect(alert).toContainText(
      'Não foi possível entrar agora. Tente novamente após o período informado.',
    );
    await expect(alert).toContainText(/Aguarde \d+ minutos?\./);
    await expect(page).toHaveURL(/\/entrar/);
  });

  test('limite de 3 sessoes: ERR-013 (TS-018)', async ({ page, browser }) => {
    const email = uniqueEmail();
    await activeUser(email);
    for (let i = 0; i < 3; i += 1) {
      const context = await browser.newContext();
      const other = await context.newPage();
      await other.goto('/entrar');
      await signIn(other, email);
      await expect(other).toHaveURL(/\/hoje/);
      await context.close();
    }
    await page.goto('/entrar');
    await signIn(page, email);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Você já tem 3 sessões ativas. Encerre uma sessão para entrar.',
    );
  });

  test('servico indisponivel: ERR-011 e nenhum sucesso declarado (TS-010)', async ({ page }) => {
    const email = uniqueEmail();
    await activeUser(email);
    await page.goto('/entrar');
    await page.route('**/api/sessions', (route) => route.abort('connectionrefused'));
    await signIn(page, email);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'O serviço está temporariamente indisponível. Tente novamente.',
    );
    await expect(page).toHaveURL(/\/entrar/);
    await page.unroute('**/api/sessions');
    await signIn(page, email);
    await expect(page).toHaveURL(/\/hoje/);
  });

  test('sucesso: area logada com o nome do titular; sair encerra a sessao', async ({ page }) => {
    const email = uniqueEmail();
    await activeUser(email, 'Ana Silva');
    await page.goto('/entrar');
    await signIn(page, email);
    await expect(page).toHaveURL(/\/hoje$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Hoje' })).toBeVisible();
    await expect(page.getByText('Olá, Ana Silva')).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/entrar/);
    await page.goto('/hoje');
    await expect(page).toHaveURL(/\/entrar\?proximo=%2Fhoje/);
  });

  test('link da area logada sem sessao: entrar e voltar ao destino (TS-019)', async ({ page }) => {
    const email = uniqueEmail();
    await activeUser(email);
    await page.goto('/hoje');
    await expect(page).toHaveURL(/\/entrar\?proximo=%2Fhoje/);
    await signIn(page, email);
    await expect(page).toHaveURL(/\/hoje$/);
  });

  test('destino externo no parametro proximo e ignorado (sem redirecionamento aberto)', async ({
    page,
  }) => {
    const email = uniqueEmail();
    await activeUser(email);
    await page.goto('/entrar?proximo=https%3A%2F%2Fevil.example%2F');
    await signIn(page, email);
    await expect(page).toHaveURL(/localhost:3100\/hoje$/);
  });
});
