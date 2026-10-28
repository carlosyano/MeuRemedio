// @trace TL-005 RF-004 RF-005 RF-006 RN-008 RN-009 RN-015 CA-007 CA-013 TS-001 TS-007 TS-010 TS-022 ERR-007 ERR-011 DEC-035 listOccurrences createResponse
// Ocorrencias na tela Hoje (TL-005; DC-055), contra a API e o PostgreSQL reais: vazio, acionaveis
// (so as ja alcancadas, sem CANCELED), resposta TAKEN e NOT_TAKEN com motivo, conflito com outra
// sessao (RN-008), desconectado sem declarar sucesso (RN-015, TS-010), consulta a cada 60 s
// (RF-005) e tempo limite com reenvio idempotente (CA-013); remedios do dia com a situacao de cada
// horario (DEC-035); axe sem violacoes WCAG 2.2 A/AA.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y.js';
import { PASSWORD, activeUser, planWithOccurrences, uniqueEmail } from './support/seed.js';

const alertIn = (page: Page) => page.getByRole('main').getByRole('alert');
const statusIn = (page: Page) => page.getByRole('main').getByRole('status');
const itemFor = (page: Page, name: string) =>
  page
    .getByRole('region', { name: 'Para registrar' })
    .getByRole('listitem')
    .filter({ hasText: name });
const dayList = (page: Page) => page.getByRole('region', { name: 'Remédios de hoje' });

/** Minutos desde a meia-noite em America/Sao_Paulo (fuso da conta dos testes). */
function minutesOfDay(): number {
  const [hour = '0', minute = '0'] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date())
    .split(':');
  return Number(hour) * 60 + Number(minute);
}

async function signedIn(page: Page): Promise<string> {
  const email = uniqueEmail();
  const userId = await activeUser(email);
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/hoje$/);
  return userId;
}

test.describe('TL-005 ocorrencias', () => {
  test('vazio: nada para registrar', async ({ page }) => {
    await signedIn(page);
    await expect(page.getByText('Nada para registrar agora.')).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('acionaveis: so as ja alcancadas, sem canceladas; atraso indicado (RN-009)', async ({
    page,
  }) => {
    const userId = await signedIn(page);
    const [recent, late] = await planWithOccurrences(userId, { name: 'Losartana', dose: '50 mg' }, [
      { minutesAgo: 10 },
      { minutesAgo: 90, status: 'NO_RESPONSE' },
      { minutesAgo: -120 },
      { minutesAgo: 30, status: 'CANCELED' },
    ]);
    await page.reload();
    const items = itemFor(page, 'Losartana');
    await expect(items).toHaveCount(2);
    // Da mais recente para a mais antiga (DC-036).
    await expect(items.nth(0)).toContainText(recent?.localTime ?? '');
    await expect(items.nth(0)).toContainText('50 mg');
    await expect(items.nth(1)).toContainText(late?.localTime ?? '');
    await expect(items.nth(1)).toContainText('Sem resposta no prazo de 60 minutos.');
    await expectNoA11yViolations(page);
  });

  test('remedios de hoje: todos os horarios do dia com a situacao, sem cancelados (DEC-035)', async ({
    page,
  }) => {
    const userId = await signedIn(page);
    await expect(dayList(page).getByText('Nenhum remédio previsto para hoje.')).toBeVisible();
    // Horarios no meio da manha ja passada e da noite que falta, sempre no mesmo dia civil.
    const now = minutesOfDay();
    const before = Math.max(2, Math.floor(now / 2));
    const after = Math.max(2, Math.floor((24 * 60 - now) / 2));
    const [taken, , future] = await planWithOccurrences(
      userId,
      { name: 'Losartana', dose: '50 mg' },
      [
        { minutesAgo: before, response: { type: 'TAKEN' } },
        { minutesAgo: before - 1, status: 'CANCELED' },
        { minutesAgo: -after },
      ],
    );
    await page.reload();
    const items = dayList(page).getByRole('listitem');
    await expect(items).toHaveCount(2);
    // O horario mais tarde do dia vem primeiro.
    await expect(items.nth(0)).toContainText(`${future?.localTime ?? ''} Losartana · 50 mg`);
    await expect(items.nth(0)).toContainText('Previsto');
    await expect(items.nth(1)).toContainText(`${taken?.localTime ?? ''} Losartana · 50 mg`);
    await expect(items.nth(1)).toContainText('Tomado');
    // A lista do dia so informa: registrar continua em "Para registrar".
    await expect(dayList(page).getByRole('button')).toHaveCount(0);
    await expectNoA11yViolations(page);
  });

  test('tomei: registra e sai da lista (TS-001)', async ({ page }) => {
    const userId = await signedIn(page);
    const [slot] = await planWithOccurrences(userId, { name: 'Losartana', dose: '50 mg' }, [
      { minutesAgo: 5 },
    ]);
    await page.reload();
    await itemFor(page, 'Losartana').getByRole('button', { name: 'Tomei', exact: true }).click();
    await expect(statusIn(page)).toHaveText(
      `Resposta registrada: tomei Losartana (${slot?.localTime ?? ''}).`,
    );
    await expect(itemFor(page, 'Losartana')).toHaveCount(0);
    await expect(page.getByText('Nada para registrar agora.')).toBeVisible();
  });

  test('nao tomei: motivo opcional e resposta tardia permitida (RN-009, TS-007)', async ({
    page,
  }) => {
    const userId = await signedIn(page);
    const [slot] = await planWithOccurrences(userId, { name: 'Losartana', dose: '50 mg' }, [
      { minutesAgo: 90, status: 'NO_RESPONSE' },
    ]);
    await page.reload();
    const item = itemFor(page, 'Losartana');
    await item.getByRole('button', { name: 'Não tomei' }).click();
    const reasons = item.getByRole('group', { name: 'Motivo (opcional)' });
    await expect(reasons.getByLabel('Prefiro não informar')).toBeChecked();
    await expectNoA11yViolations(page);
    await item.getByRole('button', { name: 'Cancelar' }).click();
    await expect(reasons).toHaveCount(0);

    await item.getByRole('button', { name: 'Não tomei' }).click();
    await reasons.getByLabel('Esqueci').check();
    await item.getByRole('button', { name: 'Confirmar' }).click();
    await expect(statusIn(page)).toHaveText(
      `Resposta registrada: não tomei Losartana (${slot?.localTime ?? ''}).`,
    );
    await expect(itemFor(page, 'Losartana')).toHaveCount(0);
  });

  test('conflito: outra sessao respondeu antes (RN-008, ERR-007)', async ({ page }) => {
    const userId = await signedIn(page);
    await planWithOccurrences(userId, { name: 'Losartana', dose: '50 mg' }, [{ minutesAgo: 5 }]);
    await page.reload();
    await expect(itemFor(page, 'Losartana')).toHaveCount(1);

    const other = await page.context().newPage();
    await other.goto('/hoje');
    await itemFor(other, 'Losartana').getByRole('button', { name: 'Tomei', exact: true }).click();
    await expect(statusIn(other)).toContainText('Resposta registrada');
    await other.close();

    await itemFor(page, 'Losartana').getByRole('button', { name: 'Não tomei' }).click();
    await itemFor(page, 'Losartana').getByRole('button', { name: 'Confirmar' }).click();
    await expect(alertIn(page)).toHaveText('Esta ocorrência já recebeu uma resposta.');
    await expect(statusIn(page)).toHaveCount(0);
    await expect(itemFor(page, 'Losartana')).toHaveCount(0);
  });

  test('servico indisponivel ao responder: ERR-011 sem declarar sucesso (RN-015)', async ({
    page,
  }) => {
    const userId = await signedIn(page);
    await planWithOccurrences(userId, { name: 'Losartana', dose: '50 mg' }, [{ minutesAgo: 5 }]);
    await page.reload();
    await page.route('**/api/occurrences/*/responses', (route) => route.abort('connectionrefused'));
    await itemFor(page, 'Losartana').getByRole('button', { name: 'Tomei', exact: true }).click();
    await expect(alertIn(page)).toHaveText(
      'O serviço está temporariamente indisponível. Tente novamente.',
    );
    await expect(statusIn(page)).toHaveCount(0);
    await expect(itemFor(page, 'Losartana')).toHaveCount(1);
  });

  test('desconectado e consulta a cada 60 s (RF-005, TS-010)', async ({ page }) => {
    await page.clock.install();
    const userId = await signedIn(page);
    await expect(page.getByText('Nada para registrar agora.')).toBeVisible();

    // Nova ocorrencia aparece na consulta seguinte, sem recarregar a pagina.
    await planWithOccurrences(userId, { name: 'Losartana', dose: '50 mg' }, [{ minutesAgo: 1 }]);
    await page.clock.runFor(60_000);
    await expect(itemFor(page, 'Losartana')).toHaveCount(1);

    // Consulta que falha: aviso de desconectado, mantendo a lista ja carregada.
    await page.route('**/api/occurrences*', (route) => route.abort('internetdisconnected'));
    await page.clock.runFor(60_000);
    const notice = page
      .getByRole('main')
      .getByText('Sem conexão com o serviço. A lista pode estar desatualizada.');
    await expect(notice).toBeVisible();
    await expect(itemFor(page, 'Losartana')).toHaveCount(1);
    await expectNoA11yViolations(page);

    await page.unroute('**/api/occurrences*');
    await page.getByRole('button', { name: 'Tentar agora' }).click();
    await expect(notice).toHaveCount(0);
  });

  test('sem rede no navegador: desconectado ate a rede voltar', async ({ page, context }) => {
    const userId = await signedIn(page);
    await planWithOccurrences(userId, { name: 'Losartana', dose: '50 mg' }, [{ minutesAgo: 5 }]);
    await page.reload();
    await expect(itemFor(page, 'Losartana')).toHaveCount(1);
    await context.setOffline(true);
    const notice = page
      .getByRole('main')
      .getByText('Sem conexão com o serviço. A lista pode estar desatualizada.');
    await expect(notice).toBeVisible();
    await context.setOffline(false);
    await expect(notice).toHaveCount(0);
  });

  test('tempo limite: aviso proprio e repetir nao registra duas vezes (CA-013)', async ({
    page,
  }) => {
    await page.clock.install();
    const userId = await signedIn(page);
    const [slot] = await planWithOccurrences(userId, { name: 'Losartana', dose: '50 mg' }, [
      { minutesAgo: 5 },
    ]);
    await page.reload();
    // A API grava a resposta, mas ela nao chega ao navegador.
    let delivered = false;
    await page.route('**/api/occurrences/*/responses', async (route) => {
      if (delivered) return route.fallback();
      delivered = true;
      await route.fetch();
    });
    await itemFor(page, 'Losartana').getByRole('button', { name: 'Tomei', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Registrando…' })).toBeVisible();
    await page.clock.runFor(30_000);
    await expect(alertIn(page)).toHaveText(
      'A resposta demorou demais e não sabemos se foi registrada. Tente de novo: o envio repetido não registra duas vezes.',
    );
    await expect(statusIn(page)).toHaveCount(0);
    await itemFor(page, 'Losartana').getByRole('button', { name: 'Tomei', exact: true }).click();
    await expect(statusIn(page)).toHaveText(
      `Resposta registrada: tomei Losartana (${slot?.localTime ?? ''}).`,
    );
  });
});
