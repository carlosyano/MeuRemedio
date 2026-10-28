// @trace TL-004 RF-003 RN-001 RN-016 CA-005 TS-012 ERR-001 ERR-009 createPlan updatePlan
// Regras do formulario de plano na web (TL-004; DC-054): a tela confere antes de enviar as mesmas
// regras do contrato (PlanWrite) e a regra de periodo da API; o payload sai aparado, com opcionais
// vazios como null, CRM em caixa alta e horarios ordenados; datas e rotulos em pt-BR.
import { describe, expect, it } from 'vitest';
import {
  ADMINISTRATION_ROUTES,
  MEDICATION_FORMS,
  formatDate,
  formatPeriod,
  labelOf,
  todayIn,
  toPlanPayload,
  validatePlanForm,
  type PlanFormInput,
} from '../../apps/web/src/lib/plan-form.js';

const valid: PlanFormInput = {
  medication_name: ' Losartana ',
  dose_text: '50 mg ',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  instructions: '',
  prescriber_name: '',
  prescriber_crm: '',
  start_date: '2026-10-15',
  end_date: '',
  schedule_times: ['20:00', '08:00'],
};

describe('validatePlanForm', () => {
  it('formulario valido nao tem erros', () => {
    expect(validatePlanForm(valid)).toEqual({});
  });

  it('obrigatorios ausentes: um erro por campo', () => {
    expect(
      validatePlanForm({
        ...valid,
        medication_name: '  ',
        dose_text: '',
        medication_form: '',
        administration_route: '',
        start_date: '',
        schedule_times: [],
      }),
    ).toEqual({
      medication_name: 'Informe o medicamento.',
      dose_text: 'Informe a dose.',
      medication_form: 'Escolha a forma farmacêutica.',
      administration_route: 'Escolha a via de administração.',
      start_date: 'Informe a data de início.',
      schedule_times: 'Informe pelo menos um horário.',
    });
  });

  it('limites de tamanho do contrato', () => {
    const errors = validatePlanForm({
      ...valid,
      medication_name: 'a'.repeat(121),
      dose_text: 'a'.repeat(81),
      instructions: 'a'.repeat(501),
      prescriber_name: 'a'.repeat(121),
    });
    expect(errors).toEqual({
      medication_name: 'Use no máximo 120 caracteres.',
      dose_text: 'Use no máximo 80 caracteres.',
      instructions: 'Use no máximo 500 caracteres.',
      prescriber_name: 'Use no máximo 120 caracteres.',
    });
  });

  it.each(['SP-123', 'sp123456', 'SPX-123456', 'SP-12345678901'])(
    'CRM fora do formato UF-numero (%s) e recusado; so o formato e conferido (TS-012)',
    (crm) => {
      expect(validatePlanForm({ ...valid, prescriber_crm: crm })).toEqual({
        prescriber_crm: 'Informe o CRM no formato UF-número, por exemplo SP-123456.',
      });
    },
  );

  it.each(['SP-1234', 'sp-123456', ' RJ-1234567890 '])('CRM %s e aceito', (crm) => {
    expect(validatePlanForm({ ...valid, prescriber_crm: crm })).toEqual({});
  });

  it('termino antes do inicio: mesma regra e mensagem da API (ERR-009)', () => {
    expect(validatePlanForm({ ...valid, end_date: '2026-10-14' })).toEqual({
      end_date: 'A data de término deve ser igual ou posterior à data de início.',
    });
    expect(validatePlanForm({ ...valid, end_date: '2026-10-15' })).toEqual({});
  });

  it('horarios repetidos, vazios ou mais de 10 sao recusados', () => {
    expect(validatePlanForm({ ...valid, schedule_times: ['08:00', '08:00'] })).toEqual({
      schedule_times: 'Os horários não podem se repetir.',
    });
    expect(validatePlanForm({ ...valid, schedule_times: ['08:00', ''] })).toEqual({
      schedule_times: 'Preencha ou remova os horários vazios.',
    });
    const eleven = Array.from({ length: 11 }, (_v, i) => `${String(i + 10)}:00`);
    expect(validatePlanForm({ ...valid, schedule_times: eleven })).toEqual({
      schedule_times: 'Informe no máximo 10 horários.',
    });
  });
});

describe('toPlanPayload', () => {
  it('apara textos, opcionais vazios viram null e horarios saem ordenados', () => {
    expect(toPlanPayload(valid)).toEqual({
      medication_name: 'Losartana',
      dose_text: '50 mg',
      medication_form: 'TABLET',
      administration_route: 'ORAL',
      instructions: null,
      prescriber_name: null,
      prescriber_crm: null,
      start_date: '2026-10-15',
      end_date: null,
      schedule_times: ['08:00', '20:00'],
      recurrence: { kind: 'DAILY' },
    });
  });

  it('CRM em caixa alta e opcionais preenchidos', () => {
    expect(
      toPlanPayload({
        ...valid,
        instructions: ' Após o café ',
        prescriber_name: ' Bruno Costa ',
        prescriber_crm: ' sp-123456 ',
        end_date: '2026-12-31',
      }),
    ).toMatchObject({
      instructions: 'Após o café',
      prescriber_name: 'Bruno Costa',
      prescriber_crm: 'SP-123456',
      end_date: '2026-12-31',
    });
  });
});

describe('datas e rotulos', () => {
  it('hoje no fuso da conta, nao no do processo', () => {
    const instant = new Date('2026-10-16T01:30:00Z');
    expect(todayIn('America/Sao_Paulo', instant)).toBe('2026-10-15');
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-10-16');
  });

  it('datas e periodo em pt-BR', () => {
    expect(formatDate('2026-10-05')).toBe('05/10/2026');
    expect(formatPeriod('2026-10-05', null)).toBe('A partir de 05/10/2026');
    expect(formatPeriod('2026-10-05', '2026-11-04')).toBe('De 05/10/2026 a 04/11/2026');
  });

  it('todas as formas e vias do contrato tem rotulo', () => {
    expect(MEDICATION_FORMS.map(([value]) => value)).toEqual([
      'TABLET',
      'CAPSULE',
      'LIQUID',
      'DROPS',
      'INJECTION',
      'CREAM',
      'OINTMENT',
      'INHALER',
      'PATCH',
      'OTHER',
    ]);
    expect(ADMINISTRATION_ROUTES.map(([value]) => value)).toEqual([
      'ORAL',
      'TOPICAL',
      'INHALED',
      'NASAL',
      'OPHTHALMIC',
      'OTIC',
      'RECTAL',
      'VAGINAL',
      'SUBCUTANEOUS',
      'INTRAMUSCULAR',
      'OTHER',
    ]);
    expect(labelOf(MEDICATION_FORMS, 'TABLET')).toBe('Comprimido');
    expect(labelOf(ADMINISTRATION_ROUTES, 'ORAL')).toBe('Oral');
    expect(labelOf(MEDICATION_FORMS, 'DESCONHECIDO')).toBe('DESCONHECIDO');
  });
});
