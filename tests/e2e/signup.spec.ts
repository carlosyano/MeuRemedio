// @trace TL-001 RF-001 RN-017 CA-001 CA-002 TS-009 TS-010 TS-021 TS-022 DEC-030 ERR-001 ERR-008 ERR-010 ERR-011 createAccount verifyAccount resendVerification
// Cadastro e confirmacao de e-mail na aplicacao web (TL-001; DC-053), contra a API, o worker e o
// PostgreSQL reais: validacao, senha comprometida, e-mail ja cadastrado, sucesso com o link do
// e-mail, link invalido, reenvio (o link anterior deixa de valer), limite de requisicoes e servico
// indisponivel sem declarar sucesso; axe sem violacoes WCAG 2.2 A/AA.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y.js';
import { linkFor } from './support/mailbox.js';
import { PASSWORD, activeUser, uniqueEmail } from './support/seed.js';

const alertIn = (page: Page) => page.getByRole('main').getByRole('alert');

async function fillSignup(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.getByLabel('Nome').fill('Ana Silva');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByLabel('Li e aceito os Termos de uso').check();
  await page.getByLabel('Li o Aviso de privacidade').check();
}

const submit = (page: Page) => page.getByRole('button', { name: 'Criar conta' }).click();

test.describe('TL-001 cadastro', () => {
  test('estado inicial acessivel; o fuso vem do navegador', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByRole('link', { name: 'Criar conta' }).click();
    await expect(page).toHaveURL(/\/cadastro$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Criar conta' })).toBeVisible();
    await expect(page.getByLabel('Fuso horário')).toHaveValue('America/Sao_Paulo');
    await expectNoA11yViolations(page);
  });

  test('validacao: campos obrigatorios destacados antes de enviar', async ({ page }) => {
    await page.goto('/cadastro');
    await submit(page);
    await expect(alertIn(page)).toHaveText('Revise os campos destacados e tente novamente.');
    await expect(page.getByLabel('Nome')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Informe seu nome.')).toBeVisible();
    await expect(page.getByText('Informe um e-mail válido.')).toBeVisible();
    await expect(
      page.getByText(
        'A senha precisa ter de 10 a 72 caracteres, com letra minúscula, letra maiúscula e número.',
      ),
    ).toBeVisible();
    await expect(page.getByText('É preciso aceitar os Termos de uso.')).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('senha da lista de vazadas: erro no campo, vindo da API (DEC-029)', async ({ page }) => {
    await page.goto('/cadastro');
    await fillSignup(page, uniqueEmail(), 'Password123');
    await submit(page);
    await expect(
      page.getByText('Esta senha aparece em listas de senhas vazadas. Escolha outra.'),
    ).toBeVisible();
    await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  });

  test('e-mail ja cadastrado: mensagem propria (DEC-030)', async ({ page }) => {
    const email = uniqueEmail();
    await activeUser(email);
    await page.goto('/cadastro');
    await fillSignup(page, email);
    await submit(page);
    await expect(alertIn(page)).toHaveText(
      'Já existe uma conta com este e-mail. Entre ou redefina a senha.',
    );
  });

  test('sucesso: link do e-mail confirma a conta e a entrada funciona (CA-001, CA-002)', async ({
    page,
  }) => {
    const email = uniqueEmail();
    await page.goto('/cadastro');
    await fillSignup(page, email);
    await submit(page);
    await expect(page.getByRole('status')).toContainText(
      `Enviamos um link de confirmação para ${email}.`,
    );
    await expectNoA11yViolations(page);

    await page.goto(await linkFor(email));
    await expect(page.getByRole('heading', { level: 1, name: 'Confirmar e-mail' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('E-mail confirmado. Você já pode entrar.');
    expect(new URL(page.url()).hash).toBe('');
    await expectNoA11yViolations(page);

    await page.getByRole('link', { name: 'Entrar' }).click();
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/hoje$/);
  });

  test('reenvio: novo link vale e o anterior nao (TS-021, TS-009)', async ({ page }) => {
    const email = uniqueEmail();
    await page.goto('/cadastro');
    await fillSignup(page, email);
    await submit(page);
    const first = await linkFor(email, 1);

    await page.getByRole('link', { name: 'Reenviar o link' }).click();
    await expect(page).toHaveURL(/\/conta\/reenviar-verificacao$/);
    await page.getByLabel('E-mail').fill(email);
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByRole('status')).toContainText('enviaremos um novo link');
    const second = await linkFor(email, 2);

    await page.goto(first);
    await expect(alertIn(page)).toHaveText('Este link não pode mais ser usado. Solicite um novo.');
    await expect(page.getByRole('link', { name: 'Enviar novo link' })).toBeVisible();
    await page.goto(second);
    await expect(page.getByRole('status')).toHaveText('E-mail confirmado. Você já pode entrar.');
  });

  test('link sem token: ERR-008', async ({ page }) => {
    await page.goto('/conta/verificar');
    await expect(alertIn(page)).toHaveText('Este link não pode mais ser usado. Solicite um novo.');
  });

  test('limite de requisicoes: ERR-010 sem declarar sucesso', async ({ page }) => {
    await page.route('**/api/accounts', (route) =>
      route.fulfill({
        status: 429,
        headers: { 'content-type': 'application/problem+json', 'retry-after': '30' },
        body: JSON.stringify({
          type: '/problems/rate_limited',
          title: 'x',
          status: 429,
          code: 'RATE_LIMITED',
          detail: 'x',
          instance: '/accounts',
          correlation_id: '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );
    await page.goto('/cadastro');
    await fillSignup(page, uniqueEmail());
    await submit(page);
    await expect(alertIn(page)).toHaveText(
      'Muitas tentativas. Aguarde o tempo informado e tente novamente.',
    );
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('servico indisponivel: ERR-011 sem declarar sucesso (TS-010)', async ({ page }) => {
    await page.route('**/api/accounts', (route) => route.abort('connectionrefused'));
    await page.goto('/cadastro');
    await fillSignup(page, uniqueEmail());
    await submit(page);
    await expect(alertIn(page)).toHaveText(
      'O serviço está temporariamente indisponível. Tente novamente.',
    );
    await expect(page.getByRole('status')).toHaveCount(0);
  });
});
