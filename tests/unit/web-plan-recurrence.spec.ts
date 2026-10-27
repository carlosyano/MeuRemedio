// @trace TL-004 RF-003 DEC-037 createPlan updatePlan (periodicidade no editor de plano)
// Periodicidade na web (DEC-037): todos os dias, dias da semana escolhidos ou a cada N dias (2 a
// 365, contados do inicio). A tela confere antes de enviar, monta o objeto recurrence do contrato
// e descreve a rotina no formato da receita.
import { describe, expect, it } from 'vitest';
import {
  WEEKDAY_OPTIONS,
  describeRoutine,
  toFormInput,
  toPlanPayload,
  validatePlanForm,
  type PlanFormInput,
  type PlanPayload,
} from '../../apps/web/src/lib/plan-form.js';

const input: PlanFormInput = {
  medication_name: 'Alendronato 70 mg',
  dose_text: '1 comprimido',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  instructions: '',
  prescriber_name: '',
  prescriber_crm: '',
  start_date: '2026-11-02',
  end_date: '',
  schedule_times: ['07:00'],
};

const payload = (over: Partial<PlanPayload> = {}): PlanPayload => ({
  ...toPlanPayload(input),
  ...over,
});

describe('WEEKDAY_OPTIONS', () => {
  it('os sete dias do contrato, de segunda a domingo, com o nome por extenso', () => {
    expect(WEEKDAY_OPTIONS).toEqual([
      ['MONDAY', 'Segunda'],
      ['TUESDAY', 'Terça'],
      ['WEDNESDAY', 'Quarta'],
      ['THURSDAY', 'Quinta'],
      ['FRIDAY', 'Sexta'],
      ['SATURDAY', 'Sábado'],
      ['SUNDAY', 'Domingo'],
    ]);
  });
});

describe('validatePlanForm com periodicidade', () => {
  it('sem periodicidade informada vale todos os dias e nao ha erro', () => {
    expect(validatePlanForm(input)).toEqual({});
    expect(validatePlanForm({ ...input, recurrence_kind: 'DAILY' })).toEqual({});
  });

  it('dias da semana exige pelo menos um dia', () => {
    expect(validatePlanForm({ ...input, recurrence_kind: 'WEEKDAYS', weekdays: [] })).toEqual({
      recurrence: 'Escolha pelo menos um dia da semana.',
    });
    expect(
      validatePlanForm({ ...input, recurrence_kind: 'WEEKDAYS', weekdays: ['MONDAY'] }),
    ).toEqual({});
  });

  it.each(['', '1', '366', '2,5', 'tres', '-3'])('a cada N dias recusa "%s"', (interval_days) => {
    expect(validatePlanForm({ ...input, recurrence_kind: 'EVERY_N_DAYS', interval_days })).toEqual({
      recurrence: 'Informe um número inteiro de dias, de 2 a 365.',
    });
  });

  it.each(['2', '7', ' 30 ', '365'])('a cada N dias aceita "%s"', (interval_days) => {
    expect(validatePlanForm({ ...input, recurrence_kind: 'EVERY_N_DAYS', interval_days })).toEqual(
      {},
    );
  });
});

describe('toPlanPayload e toFormInput', () => {
  it('todos os dias vira { kind: DAILY }', () => {
    expect(toPlanPayload(input).recurrence).toEqual({ kind: 'DAILY' });
  });

  it('dias da semana saem na ordem da semana, sem repetir', () => {
    expect(
      toPlanPayload({
        ...input,
        recurrence_kind: 'WEEKDAYS',
        weekdays: ['FRIDAY', 'MONDAY', 'FRIDAY'],
      }).recurrence,
    ).toEqual({ kind: 'WEEKDAYS', weekdays: ['MONDAY', 'FRIDAY'] });
  });

  it('a cada N dias leva o numero', () => {
    expect(
      toPlanPayload({ ...input, recurrence_kind: 'EVERY_N_DAYS', interval_days: ' 7 ' }).recurrence,
    ).toEqual({ kind: 'EVERY_N_DAYS', interval_days: 7 });
  });

  it('o plano lido volta para o formulario com a periodicidade', () => {
    expect(
      toFormInput(payload({ recurrence: { kind: 'WEEKDAYS', weekdays: ['TUESDAY'] } })),
    ).toMatchObject({ recurrence_kind: 'WEEKDAYS', weekdays: ['TUESDAY'], interval_days: '' });
    expect(
      toFormInput(payload({ recurrence: { kind: 'EVERY_N_DAYS', interval_days: 3 } })),
    ).toMatchObject({ recurrence_kind: 'EVERY_N_DAYS', weekdays: [], interval_days: '3' });
    expect(toFormInput(payload())).toMatchObject({ recurrence_kind: 'DAILY' });
  });
});

describe('describeRoutine com periodicidade', () => {
  it('todos os dias: a frase de antes', () => {
    expect(describeRoutine(payload())).toBe(
      'Tomar 1 comprimido, via oral, 1 vez ao dia (07:00), uso contínuo a partir de 02/11/2026.',
    );
  });

  it('dias da semana, com o artigo de cada dia', () => {
    expect(
      describeRoutine(payload({ recurrence: { kind: 'WEEKDAYS', weekdays: ['MONDAY'] } })),
    ).toBe(
      'Tomar 1 comprimido, via oral, 1 vez ao dia (07:00), às segundas, uso contínuo a partir de 02/11/2026.',
    );
    expect(
      describeRoutine(
        payload({ recurrence: { kind: 'WEEKDAYS', weekdays: ['MONDAY', 'THURSDAY', 'SATURDAY'] } }),
      ),
    ).toBe(
      'Tomar 1 comprimido, via oral, 1 vez ao dia (07:00), às segundas, às quintas e aos sábados, uso contínuo a partir de 02/11/2026.',
    );
  });

  it('a cada N dias, contados do inicio', () => {
    expect(
      describeRoutine(payload({ recurrence: { kind: 'EVERY_N_DAYS', interval_days: 3 } })),
    ).toBe(
      'Tomar 1 comprimido, via oral, 1 vez ao dia (07:00), a cada 3 dias, uso contínuo a partir de 02/11/2026.',
    );
  });
});
