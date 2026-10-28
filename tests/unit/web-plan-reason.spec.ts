// @trace TL-004 RF-003 DEC-038 createPlan updatePlan listTreatmentReasons (motivo do tratamento)
// Motivo do tratamento na web (DEC-038): campo opcional de ate 80 caracteres no editor, enviado
// aparado (vazio vira null), devolvido ao formulario ao editar e mostrado na lista de planos.
import { describe, expect, it } from 'vitest';
import {
  toFormInput,
  toPlanPayload,
  validatePlanForm,
  type PlanFormInput,
  type PlanPayload,
} from '../../apps/web/src/lib/plan-form.js';

const input: PlanFormInput = {
  medication_name: 'Losartana',
  dose_text: '50 mg',
  medication_form: 'TABLET',
  administration_route: 'ORAL',
  instructions: '',
  prescriber_name: '',
  prescriber_crm: '',
  start_date: '2026-11-02',
  end_date: '',
  schedule_times: ['08:00'],
};

describe('motivo do tratamento no formulario', () => {
  it('e opcional: vazio ou so espacos vira null', () => {
    expect(validatePlanForm(input)).toEqual({});
    expect(toPlanPayload(input).treatment_reason).toBeNull();
    expect(toPlanPayload({ ...input, treatment_reason: '   ' }).treatment_reason).toBeNull();
  });

  it('vai aparado; ate 80 caracteres', () => {
    expect(toPlanPayload({ ...input, treatment_reason: '  Pressão alta ' }).treatment_reason).toBe(
      'Pressão alta',
    );
    expect(validatePlanForm({ ...input, treatment_reason: 'x'.repeat(80) })).toEqual({});
    expect(validatePlanForm({ ...input, treatment_reason: 'x'.repeat(81) })).toEqual({
      treatment_reason: 'Use no máximo 80 caracteres.',
    });
  });

  it('o plano lido volta para o formulario com o nome do motivo', () => {
    const plan: PlanPayload & {
      treatment_reason: { treatment_reason_id: string; name: string } | null;
    } = {
      ...toPlanPayload(input),
      treatment_reason: { treatment_reason_id: 'r-1', name: 'Pressão alta' },
    };
    expect(toFormInput(plan)).toMatchObject({ treatment_reason: 'Pressão alta' });
    expect(toFormInput({ ...plan, treatment_reason: null })).toMatchObject({
      treatment_reason: '',
    });
  });
});
