// @trace TL-007 RF-008 RN-011 FL-005 CA-010 CA-011 CA-016 TS-008 TS-010 TS-011 TS-020 TS-022 TS-042 ERR-001 ERR-003 ERR-011 ERR-012 createExport getExport cancelExport downloadExport
// Exportacao em PDF (TL-007; DC-057), contra a API, o worker e o PostgreSQL reais: solicitando,
// processando, concluida com download do PDF, cancelamento (CA-016), falha, expirada (CA-011),
// pedido de outro titular (404), periodo invalido e servico indisponivel sem declarar sucesso;
// axe sem violacoes WCAG 2.2 A/AA.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y.js';
import {
  PASSWORD,
  activeUser,
  planWithOccurrences,
  seedExport,
  uniqueEmail,
} from './support/seed.js';

const alertIn = (page: Page) => page.getByRole('main').getByRole('alert');
const statusIn = (page: Page) => page.getByRole('main').getByRole('status');
const request = (page: Page) => page.getByRole('button', { name: 'Solicitar PDF' }).click();

async function signedIn(page: Page, next = '/exportacao'): Promise<string> {
  const email = uniqueEmail();
  const userId = await activeUser(email);
  await page.goto(`/entrar?proximo=${encodeURIComponent(next)}`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/exportacao/);
  return userId;
}

test.describe('TL-007 exportacao', () => {
  test('solicitar, acompanhar e baixar o PDF (CA-010, TS-020)', async ({ page }) => {
    const userId = await signedIn(page, '/hoje');
    await planWithOccurrences(userId, { name: 'Losartana', dose: '50 mg' }, [
      { minutesAgo: 30, response: { type: 'TAKEN' } },
    ]);
    await page.getByRole('link', { name: 'Exportar' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Exportar histórico' })).toBeVisible();
    await expect(page.getByLabel('Data inicial')).not.toHaveValue('');
    await expectNoA11yViolations(page);

    await request(page);
    await expect(page).toHaveURL(/\/exportacao\?pedido=[0-9a-f-]{36}$/);
    await expect(statusIn(page)).toContainText('PDF pronto.');
    await expect(statusIn(page)).toContainText('Disponível até');
    await expectNoA11yViolations(page);

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Baixar PDF' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.pdf$/);
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('processando: cancelar a exportacao (CA-016, TS-042)', async ({ page }) => {
    const userId = await signedIn(page);
    const id = await seedExport(userId, 'REQUESTED');
    await page.goto(`/exportacao?pedido=${id}`);
    await expect(statusIn(page)).toContainText('Gerando o PDF…');
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Cancelar exportação' }).click();
    await expect(statusIn(page)).toHaveText('Exportação cancelada.');
    await expect(page.getByRole('button', { name: 'Cancelar exportação' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Nova exportação' })).toBeVisible();
  });

  test('falha: aviso e nova exportacao', async ({ page }) => {
    const userId = await signedIn(page);
    const id = await seedExport(userId, 'FAILED');
    await page.goto(`/exportacao?pedido=${id}`);
    await expect(alertIn(page)).toHaveText(
      'Não foi possível gerar o PDF. Solicite uma nova exportação.',
    );
    await page.getByRole('link', { name: 'Nova exportação' }).click();
    await expect(page).toHaveURL(/\/exportacao$/);
    await expect(page.getByRole('button', { name: 'Solicitar PDF' })).toBeVisible();
  });

  test('expirada: ERR-012 sem link de download (CA-011, TS-011)', async ({ page }) => {
    const userId = await signedIn(page);
    const id = await seedExport(userId, 'EXPIRED');
    await page.goto(`/exportacao?pedido=${id}`);
    await expect(alertIn(page)).toHaveText('Este arquivo expirou. Solicite uma nova exportação.');
    await expect(page.getByRole('link', { name: 'Baixar PDF' })).toHaveCount(0);
    await expectNoA11yViolations(page);
  });

  test('pedido de outro titular: 404 sem dado do pedido (TS-008)', async ({ page }) => {
    const other = await activeUser(uniqueEmail('bruno.costa'), 'Bruno Costa');
    const id = await seedExport(other, 'REQUESTED');
    await signedIn(page);
    await page.goto(`/exportacao?pedido=${id}`);
    await expect(alertIn(page)).toHaveText('O item solicitado não foi encontrado.');
    await expect(page.getByRole('button', { name: 'Cancelar exportação' })).toHaveCount(0);
  });

  test('periodo invalido: mesma regra do historico (DC-041)', async ({ page }) => {
    await signedIn(page);
    await page.getByLabel('Data inicial').fill('2026-03-10');
    await page.getByLabel('Data final').fill('2026-03-09');
    await request(page);
    await expect(alertIn(page)).toHaveText('Revise os campos destacados e tente novamente.');
    await expect(
      page.getByText('A data final deve ser igual ou posterior à inicial.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/exportacao$/);
  });

  test('servico indisponivel ao solicitar: ERR-011 sem declarar sucesso (TS-010)', async ({
    page,
  }) => {
    await signedIn(page);
    await page.route('**/api/exports', (route) => route.abort('connectionrefused'));
    await request(page);
    await expect(alertIn(page)).toHaveText(
      'O serviço está temporariamente indisponível. Tente novamente.',
    );
    await expect(statusIn(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/exportacao$/);
  });
});
