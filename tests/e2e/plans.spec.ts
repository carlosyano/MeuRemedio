// @trace TL-003 TL-004 RF-003 RN-001 RN-016 CA-005 CA-006 CA-012 CA-013 CA-017 TS-008 TS-010 TS-019 TS-022 TS-037 TS-043 ERR-001 ERR-003 ERR-005 ERR-009 ERR-011 ERR-014 listPlans createPlan getPlan updatePlan deletePlan
// Planos (TL-003) e editor de plano (TL-004) na aplicacao web (DC-054), contra a API e o
// PostgreSQL reais: lista vazia e lista, validacao, criacao, confirmacao de possivel duplicidade,
// edicao com If-Match e conflito de versao, exclusao logica, plano de outro titular (404), servico
// indisponivel e tempo limite sem declarar sucesso; axe sem violacoes WCAG 2.2 A/AA.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y.js';
import { PASSWORD, activeUser, uniqueEmail } from './support/seed.js';

const alertIn = (page: Page) => page.getByRole('main').getByRole('alert');
const statusIn = (page: Page) => page.getByRole('main').getByRole('status');

async function signedIn(page: Page, next = '/planos'): Promise<string> {
  const email = uniqueEmail();
  await activeUser(email);
  await page.goto(`/entrar?proximo=${encodeURIComponent(next)}`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(new RegExp(`${next}$`));
  return email;
}

async function fillPlan(
  page: Page,
  plan: { name: string; dose: string; times?: readonly string[] },
): Promise<void> {
  await page.getByLabel('Medicamento').fill(plan.name);
  await page.getByLabel('Dose').fill(plan.dose);
  await page.getByLabel('Forma farmacêutica').selectOption({ label: 'Comprimido' });
  await page.getByLabel('Via de administração').selectOption({ label: 'Oral' });
  const times = plan.times ?? ['08:00'];
  for (const [index, time] of times.entries()) {
    if (index > 0) await page.getByRole('button', { name: 'Adicionar horário' }).click();
    await page.getByLabel(`Horário ${String(index + 1)}`, { exact: true }).fill(time);
  }
}

const save = (page: Page) => page.getByRole('button', { name: 'Salvar plano' }).click();

async function createPlan(
  page: Page,
  plan: { name: string; dose: string; times?: readonly string[] },
): Promise<void> {
  await page.goto('/planos/novo');
  await fillPlan(page, plan);
  await save(page);
  await expect(statusIn(page)).toHaveText('Plano criado.');
}

/** Plano de outro titular, criado numa sessao separada; devolve o caminho do editor. */
async function foreignPlanPath(browser: Browser): Promise<string> {
  const context = await browser.newContext();
  const other = await context.newPage();
  await signedIn(other);
  await createPlan(other, { name: 'Metformina', dose: '850 mg' });
  await other.getByRole('link', { name: 'Metformina' }).click();
  await expect(other).toHaveURL(/\/planos\/[0-9a-f-]{36}$/);
  const path = new URL(other.url()).pathname;
  await context.close();
  return path;
}

test.describe('TL-003 planos', () => {
  test('sem sessao: leva a entrada e volta aos planos (TS-019)', async ({ page }) => {
    await page.goto('/planos');
    await expect(page).toHaveURL(/\/entrar\?proximo=%2Fplanos$/);
  });

  test('lista vazia acessivel, com acesso pela area logada', async ({ page }) => {
    await signedIn(page, '/hoje');
    await page.getByRole('link', { name: 'Planos' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Planos' })).toBeVisible();
    await expect(page.getByText('Você ainda não cadastrou planos.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Novo plano' })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('erro ao carregar: ERR-011 com nova tentativa, sem lista falsa (TS-010)', async ({
    page,
  }) => {
    await signedIn(page);
    await page.route('**/api/plans*', (route) => route.abort('connectionrefused'));
    await page.reload();
    await expect(alertIn(page)).toHaveText(
      'O serviço está temporariamente indisponível. Tente novamente.',
    );
    await expect(page.getByText('Você ainda não cadastrou planos.')).toHaveCount(0);
    await page.unroute('**/api/plans*');
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByText('Você ainda não cadastrou planos.')).toBeVisible();
  });
});

test.describe('TL-004 editor de plano', () => {
  test('validacao: campos destacados antes de enviar', async ({ page }) => {
    await signedIn(page);
    await page.getByRole('link', { name: 'Novo plano' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Novo plano' })).toBeVisible();
    await expectNoA11yViolations(page);
    await save(page);
    await expect(alertIn(page)).toHaveText('Revise os campos destacados e tente novamente.');
    await expect(page.getByLabel('Medicamento')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Informe o medicamento.')).toBeVisible();
    await expect(page.getByText('Informe a dose.')).toBeVisible();
    await expect(page.getByText('Escolha a forma farmacêutica.')).toBeVisible();
    await expect(page.getByText('Informe pelo menos um horário.')).toBeVisible();
    await expectNoA11yViolations(page);

    await fillPlan(page, { name: 'Losartana', dose: '50 mg', times: ['08:00', '08:00'] });
    await page.getByLabel('Data de término').fill('2000-01-01');
    await save(page);
    await expect(page.getByText('Os horários não podem se repetir.')).toBeVisible();
    await expect(
      page.getByText('A data de término deve ser igual ou posterior à data de início.'),
    ).toBeVisible();
  });

  test('criar: plano com dois horarios aparece na lista (CA-005)', async ({ page }) => {
    await signedIn(page);
    await createPlan(page, { name: 'Losartana', dose: '50 mg', times: ['20:00', '08:00'] });
    await expect(page).toHaveURL(/\/planos$/);
    const item = page.getByRole('listitem').filter({ hasText: 'Losartana' });
    await expect(item).toContainText('50 mg');
    await expect(item).toContainText('Comprimido, via oral');
    await expect(item).toContainText('08:00, 20:00');
    await expect(item).toContainText('A partir de');
    await expectNoA11yViolations(page);
  });

  test('possivel duplicidade: confirmar cria outro plano (RN-016, CA-017, TS-043)', async ({
    page,
  }) => {
    await signedIn(page);
    await createPlan(page, { name: 'Losartana', dose: '50 mg' });
    await page.goto('/planos/novo');
    await fillPlan(page, { name: ' losartana ', dose: '50 MG' });
    await save(page);
    const confirmation = page.getByRole('region', { name: 'Já existe um plano parecido' });
    await expect(confirmation).toContainText(
      'Já existe um plano parecido. Confirme se deseja criar outro.',
    );
    await expect(confirmation).toContainText('Losartana, 50 mg');
    await expectNoA11yViolations(page);

    await confirmation.getByRole('button', { name: 'Revisar o plano' }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByLabel('Medicamento')).toHaveValue(' losartana ');

    await save(page);
    await page.getByRole('button', { name: 'Criar mesmo assim' }).click();
    await expect(statusIn(page)).toHaveText('Plano criado.');
    await expect(page.getByRole('listitem').filter({ hasText: /losartana/i })).toHaveCount(2);
  });

  test('editar: salva com If-Match e mostra a nova versao (CA-006)', async ({ page }) => {
    await signedIn(page);
    await createPlan(page, { name: 'Losartana', dose: '50 mg' });
    await page.getByRole('link', { name: 'Losartana' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Editar plano' })).toBeVisible();
    await expect(page.getByLabel('Dose')).toHaveValue('50 mg');
    await expect(page.getByLabel('Horário 1', { exact: true })).toHaveValue('08:00');
    await expectNoA11yViolations(page);
    await page.getByLabel('Dose').fill('100 mg');
    await save(page);
    await expect(statusIn(page)).toHaveText('Plano salvo.');
    await expect(page.getByRole('listitem').filter({ hasText: 'Losartana' })).toContainText(
      '100 mg',
    );
  });

  test('conflito de versao: ERR-005 e recarregar traz a versao atual', async ({ page }) => {
    await signedIn(page);
    await createPlan(page, { name: 'Losartana', dose: '50 mg' });
    await page.getByRole('link', { name: 'Losartana' }).click();
    await expect(page.getByLabel('Dose')).toHaveValue('50 mg');
    const editorUrl = page.url();

    // Outra aba da mesma sessao altera o plano antes.
    const other = await page.context().newPage();
    await other.goto(editorUrl);
    await other.getByLabel('Dose').fill('75 mg');
    await other.getByRole('button', { name: 'Salvar plano' }).click();
    await expect(other.getByRole('main').getByRole('status')).toHaveText('Plano salvo.');
    await other.close();

    await page.getByLabel('Dose').fill('100 mg');
    await save(page);
    await expect(alertIn(page)).toContainText(
      'Este plano foi alterado em outra sessão. Recarregue antes de tentar novamente.',
    );
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Recarregar plano' }).click();
    await expect(page.getByLabel('Dose')).toHaveValue('75 mg');
    await page.getByLabel('Dose').fill('100 mg');
    await save(page);
    await expect(statusIn(page)).toHaveText('Plano salvo.');
  });

  test('excluir: confirmacao e o plano sai da lista (TS-037)', async ({ page }) => {
    await signedIn(page);
    await createPlan(page, { name: 'Losartana', dose: '50 mg' });
    await page.getByRole('link', { name: 'Losartana' }).click();
    await page.getByRole('button', { name: 'Excluir plano' }).click();
    const confirmation = page.getByRole('region', { name: 'Excluir este plano?' });
    await expect(confirmation).toContainText('O histórico já registrado é mantido.');
    await expectNoA11yViolations(page);
    await confirmation.getByRole('button', { name: 'Cancelar' }).click();
    await expect(confirmation).toHaveCount(0);

    await page.getByRole('button', { name: 'Excluir plano' }).click();
    await page.getByRole('button', { name: 'Excluir', exact: true }).click();
    await expect(statusIn(page)).toHaveText('Plano excluído.');
    await expect(page.getByText('Você ainda não cadastrou planos.')).toBeVisible();
  });

  test('plano de outro titular: 404 sem revelar o plano (TS-008, CA-012)', async ({
    page,
    browser,
  }) => {
    const path = await foreignPlanPath(browser);
    await signedIn(page);
    await page.goto(path);
    await expect(alertIn(page)).toHaveText('O item solicitado não foi encontrado.');
    await expect(page.getByLabel('Medicamento')).toHaveCount(0);
    await expect(page.getByText('Metformina')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Voltar aos planos' })).toBeVisible();
  });

  test('servico indisponivel ao salvar: ERR-011 sem declarar sucesso (TS-010)', async ({
    page,
  }) => {
    await signedIn(page);
    await page.goto('/planos/novo');
    await fillPlan(page, { name: 'Losartana', dose: '50 mg' });
    await page.route('**/api/plans', (route) => route.abort('connectionrefused'));
    await save(page);
    await expect(alertIn(page)).toHaveText(
      'O serviço está temporariamente indisponível. Tente novamente.',
    );
    await expect(statusIn(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/planos\/novo$/);
  });

  test('tempo limite: aviso proprio e repetir o envio nao duplica (CA-013)', async ({ page }) => {
    await page.clock.install();
    await signedIn(page);
    await page.goto('/planos/novo');
    await fillPlan(page, { name: 'Losartana', dose: '50 mg' });
    // A API recebe e grava o plano, mas a resposta nao chega ao navegador.
    let delivered = false;
    await page.route('**/api/plans', async (route) => {
      if (delivered) return route.fallback();
      delivered = true;
      await route.fetch();
    });
    await save(page);
    await expect(page.getByRole('button', { name: 'Salvando…' })).toBeVisible();
    await page.clock.runFor(30_000);
    await expect(alertIn(page)).toHaveText(
      'A resposta demorou demais e não sabemos se o plano foi salvo. Tente salvar de novo: o envio repetido não cria outro plano.',
    );
    await expect(statusIn(page)).toHaveCount(0);
    await save(page);
    await expect(statusIn(page)).toHaveText('Plano criado.');
    await expect(page.getByRole('listitem').filter({ hasText: 'Losartana' })).toHaveCount(1);
  });
});

test.describe('TL-004 cadastro no formato da receita (DC-074)', () => {
  test('a cada 8 horas por 5 dias, conferencia e proximo item da mesma receita', async ({
    page,
  }) => {
    await signedIn(page, '/planos/novo');
    await page.getByLabel('Medicamento').fill('Codein 3 mg/mL');
    await page.getByLabel('Dose').fill('3 ml');
    await page.getByLabel('Forma farmacêutica').selectOption({ label: 'Líquido' });
    await page.getByLabel('Via de administração').selectOption({ label: 'Oral' });
    // O intervalo calcula a lista a partir do Horario 1, sem campo nem botao a mais
    await expect(page.getByLabel('Primeiro horário')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Preencher horários' })).toHaveCount(0);
    await page.getByLabel('Intervalo').selectOption({ label: 'De 8 em 8 horas' });
    await expect(
      page.getByText('Informe o Horário 1: os demais são calculados a partir dele.'),
    ).toBeVisible();
    await page.getByLabel('Horário 1', { exact: true }).fill('07:00');
    await expect(page.getByLabel('Horário 2', { exact: true })).toHaveValue('15:00');
    await page.getByLabel('Horário 1', { exact: true }).fill('08:00');
    await expect(page.getByLabel('Horário 2', { exact: true })).toHaveValue('16:00');
    await expect(page.getByLabel('Horário 3', { exact: true })).toHaveValue('00:00');
    await page.getByLabel('Data de início').fill('2030-01-10');
    await page.getByLabel('Duração em dias').fill('5');
    await expect(page.getByLabel('Data de término')).toHaveValue('2030-01-14');
    await page.getByLabel('Nome de quem prescreveu').fill('Bruno Costa');
    await page.getByLabel('CRM de quem prescreveu').fill('SP-123456');
    const summary = page.getByRole('region', { name: 'Confira antes de salvar' });
    await expect(summary).toContainText('Codein 3 mg/mL');
    await expect(summary).toContainText(
      'Tomar 3 ml, via oral, 3 vezes ao dia (00:00, 08:00 e 16:00), por 5 dias, de 10/01/2030 a 14/01/2030.',
    );
    await expectNoA11yViolations(page);

    await page.getByRole('button', { name: 'Salvar e cadastrar outro item' }).click();
    await expect(statusIn(page)).toHaveText(
      'Plano criado: Codein 3 mg/mL. Cadastre o próximo item da receita.',
    );
    await expect(page.getByLabel('Medicamento')).toHaveValue('');
    await expect(page.getByLabel('Medicamento')).toBeFocused();
    await expect(page.getByLabel('Nome de quem prescreveu')).toHaveValue('Bruno Costa');
    await expect(page.getByLabel('CRM de quem prescreveu')).toHaveValue('SP-123456');
    await expect(page.getByLabel('Data de início')).toHaveValue('2030-01-10');
    await expect(page.getByLabel('Data de término')).toHaveValue('');

    await fillPlan(page, { name: 'Prednisona 20 mg', dose: '1 comprimido' });
    await page.getByLabel('Duração em dias').fill('5');
    await save(page);
    await expect(statusIn(page)).toHaveText('Plano criado.');
    const codein = page.getByRole('listitem').filter({ hasText: 'Codein' });
    await expect(codein).toContainText('00:00, 08:00, 16:00');
    await expect(codein).toContainText('De 10/01/2030 a 14/01/2030');
    await expect(page.getByRole('listitem').filter({ hasText: 'Prednisona' })).toContainText(
      'De 10/01/2030 a 14/01/2030',
    );
  });

  test('item repetido na receita cai na confirmacao de duplicidade (RN-016)', async ({ page }) => {
    await signedIn(page, '/planos/novo');
    await fillPlan(page, { name: 'Levofloxacino 500 mg', dose: '1 comprimido' });
    await page.getByRole('button', { name: 'Salvar e cadastrar outro item' }).click();
    await expect(statusIn(page)).toContainText('Plano criado: Levofloxacino 500 mg.');
    await fillPlan(page, { name: 'Levofloxacino 500 mg', dose: '1 comprimido' });
    await page.getByRole('button', { name: 'Salvar e cadastrar outro item' }).click();
    await expect(page.getByRole('region', { name: 'Já existe um plano parecido' })).toBeVisible();
  });
});
