// @trace TL-006 RF-007 RN-009 RN-010 CA-009 TS-005 TS-010 TS-022 TS-037 ERR-001 ERR-011 getHistory
// Historico (TL-006; DC-056), contra a API e o PostgreSQL reais: filtros com os ultimos 30 dias no
// fuso da conta, vazio, resultados em ordem decrescente com a resposta de cada ocorrencia, plano
// excluido preservado (TS-037), periodo invalido (DC-041), paginacao e erro sem resultado falso;
// axe sem violacoes WCAG 2.2 A/AA.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y.js';
import {
  PASSWORD,
  activeUser,
  deletePlanOf,
  planWithOccurrences,
  uniqueEmail,
} from './support/seed.js';

const alertIn = (page: Page) => page.getByRole('main').getByRole('alert');
const rows = (page: Page) => page.getByRole('main').getByRole('listitem');
const consult = (page: Page) => page.getByRole('button', { name: 'Consultar' }).click();

/** Data civil de hoje em America/Sao_Paulo (fuso da conta dos testes), N dias atras. */
function civilDaysAgo(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function signedIn(page: Page): Promise<string> {
  const email = uniqueEmail();
  const userId = await activeUser(email);
  await page.goto('/entrar?proximo=%2Fhistorico');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/historico$/);
  return userId;
}

test.describe('TL-006 historico', () => {
  test('filtros iniciais: ultimos 30 dias; vazio acessivel', async ({ page }) => {
    await signedIn(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Histórico' })).toBeVisible();
    await expect(page.getByLabel('Data inicial')).toHaveValue(civilDaysAgo(29));
    await expect(page.getByLabel('Data final')).toHaveValue(civilDaysAgo(0));
    await expect(page.getByText('Nenhum registro no período.')).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('resultados: mais recente primeiro, com a resposta de cada ocorrencia (CA-009)', async ({
    page,
  }) => {
    const userId = await signedIn(page);
    const [taken, notTaken, open, late] = await planWithOccurrences(
      userId,
      { name: 'Losartana', dose: '50 mg' },
      [
        { minutesAgo: 30, response: { type: 'TAKEN' } },
        { minutesAgo: 120, response: { type: 'NOT_TAKEN', reason: 'FORGOT' } },
        { minutesAgo: 180, status: 'NO_RESPONSE' },
        { minutesAgo: 240, response: { type: 'TAKEN', late: true } },
        { minutesAgo: 300, status: 'CANCELED' },
        { minutesAgo: -60 },
      ],
    );
    await page.reload();
    await expect(rows(page)).toHaveCount(4);
    await expect(rows(page).nth(0)).toContainText(taken?.localTime ?? '');
    await expect(rows(page).nth(0)).toContainText('Losartana · 50 mg');
    await expect(rows(page).nth(0)).toContainText('Tomei');
    await expect(rows(page).nth(1)).toContainText(notTaken?.localTime ?? '');
    await expect(rows(page).nth(1)).toContainText('Não tomei · Esqueci');
    await expect(rows(page).nth(2)).toContainText(open?.localTime ?? '');
    await expect(rows(page).nth(2)).toContainText('Sem resposta');
    await expect(rows(page).nth(3)).toContainText(late?.localTime ?? '');
    await expect(rows(page).nth(3)).toContainText('Tomei · registrado com atraso');
    await expectNoA11yViolations(page);
  });

  test('plano excluido: o historico continua (TS-005, TS-037)', async ({ page }) => {
    const userId = await signedIn(page);
    const [slot] = await planWithOccurrences(userId, { name: 'Metformina', dose: '850 mg' }, [
      { minutesAgo: 30, response: { type: 'TAKEN' } },
    ]);
    await deletePlanOf(slot?.id ?? '');
    await page.reload();
    await expect(rows(page).filter({ hasText: 'Metformina' })).toContainText('Tomei');
  });

  test('periodo invalido: termino antes do inicio e mais de 12 meses (DC-041)', async ({
    page,
  }) => {
    await signedIn(page);
    await page.getByLabel('Data inicial').fill('2026-03-10');
    await page.getByLabel('Data final').fill('2026-03-09');
    await consult(page);
    await expect(alertIn(page)).toHaveText('Revise os campos destacados e tente novamente.');
    await expect(
      page.getByText('A data final deve ser igual ou posterior à inicial.'),
    ).toBeVisible();
    await expect(page.getByLabel('Data final')).toHaveAttribute('aria-invalid', 'true');
    await expectNoA11yViolations(page);

    await page.getByLabel('Data inicial').fill('2025-01-01');
    await page.getByLabel('Data final').fill('2026-01-01');
    await consult(page);
    await expect(page.getByText('O período pode ter no máximo 12 meses.')).toBeVisible();

    await page.getByLabel('Data final').fill('2025-12-31');
    await consult(page);
    await expect(page.getByText('Nenhum registro no período.')).toBeVisible();
    await expect(alertIn(page)).toHaveCount(0);
  });

  test('paginacao: 20 por pagina e carregar mais', async ({ page }) => {
    const userId = await signedIn(page);
    for (const [index, name] of ['Losartana', 'Metformina', 'Sinvastatina'].entries()) {
      await planWithOccurrences(
        userId,
        { name, dose: '1 comprimido' },
        Array.from({ length: 7 }, (_v, i) => ({
          minutesAgo: 10 + index * 7 + i,
          response: { type: 'TAKEN' as const },
        })),
      );
    }
    await page.reload();
    await expect(rows(page)).toHaveCount(20);
    await page.getByRole('button', { name: 'Carregar mais' }).click();
    await expect(rows(page)).toHaveCount(21);
    await expect(page.getByRole('button', { name: 'Carregar mais' })).toHaveCount(0);
  });

  test('erro ao consultar: ERR-011 sem resultado falso (TS-010)', async ({ page }) => {
    await signedIn(page);
    await page.route('**/api/history*', (route) => route.abort('connectionrefused'));
    await consult(page);
    await expect(alertIn(page)).toHaveText(
      'O serviço está temporariamente indisponível. Tente novamente.',
    );
    await expect(page.getByText('Nenhum registro no período.')).toHaveCount(0);
    await page.unroute('**/api/history*');
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByText('Nenhum registro no período.')).toBeVisible();
  });

  test('acesso pela navegacao da area logada', async ({ page }) => {
    await signedIn(page);
    await page.getByRole('link', { name: 'Hoje' }).click();
    await page.getByRole('link', { name: 'Histórico' }).click();
    await expect(page).toHaveURL(/\/historico$/);
  });
});
