// @trace RF-003 DEC-036 changePlanStatus listPlans
// Situacao do plano na web (DEC-036): grupos da lista (em andamento, finalizados, interrompidos e
// cancelados), acoes permitidas com as mesmas regras da API e motivos em pt-BR do enum do contrato.
import { describe, expect, it } from 'vitest';
import {
  PLAN_STATUS_REASONS,
  RESUME_REASONS,
  STOP_REASONS,
  allowedActions,
  planGroup,
  statusReasonText,
} from '../../apps/web/src/lib/plan-status.js';

const TODAY = '2026-10-15';
const plan = (
  status: 'ACTIVE' | 'INTERRUPTED' | 'CANCELED',
  start_date: string,
  end_date: string | null = null,
) => ({ status, start_date, end_date });

describe('planGroup', () => {
  it('ativo sem fim ou com fim a partir de hoje esta em andamento, mesmo antes de comecar', () => {
    expect(planGroup(plan('ACTIVE', '2026-10-01'), TODAY)).toBe('IN_PROGRESS');
    expect(planGroup(plan('ACTIVE', '2026-10-01', TODAY), TODAY)).toBe('IN_PROGRESS');
    expect(planGroup(plan('ACTIVE', '2026-10-20'), TODAY)).toBe('IN_PROGRESS');
  });

  it('ativo com fim antes de hoje esta finalizado; os demais seguem a situacao', () => {
    expect(planGroup(plan('ACTIVE', '2026-10-01', '2026-10-14'), TODAY)).toBe('FINISHED');
    expect(planGroup(plan('INTERRUPTED', '2026-10-01'), TODAY)).toBe('INTERRUPTED');
    expect(planGroup(plan('CANCELED', '2026-10-20'), TODAY)).toBe('CANCELED');
  });
});

describe('allowedActions (mesmas regras da API)', () => {
  it('cancelar so antes de comecar; interromper so em andamento', () => {
    expect(allowedActions(plan('ACTIVE', '2026-10-16'), TODAY)).toEqual(['CANCEL']);
    expect(allowedActions(plan('ACTIVE', TODAY), TODAY)).toEqual(['INTERRUPT']);
    expect(allowedActions(plan('ACTIVE', '2026-10-01', TODAY), TODAY)).toEqual(['INTERRUPT']);
    expect(allowedActions(plan('ACTIVE', '2026-10-01', '2026-10-14'), TODAY)).toEqual([]);
  });

  it('retomar so o interrompido que ainda nao terminou; cancelado nao tem acao', () => {
    expect(allowedActions(plan('INTERRUPTED', '2026-10-01'), TODAY)).toEqual(['RESUME']);
    expect(allowedActions(plan('INTERRUPTED', '2026-10-01', '2026-10-14'), TODAY)).toEqual([]);
    expect(allowedActions(plan('CANCELED', '2026-10-20'), TODAY)).toEqual([]);
  });
});

describe('motivos', () => {
  it('o enum do contrato, na mesma ordem, com rotulo', () => {
    expect(PLAN_STATUS_REASONS.map(([value]) => value)).toEqual([
      'MEDICAL_ADVICE',
      'SIDE_EFFECT',
      'IMPROVED',
      'COST_OR_ACCESS',
      'OWN_DECISION',
      'OTHER',
    ]);
    expect(STOP_REASONS.map(([value]) => value)).toEqual(
      PLAN_STATUS_REASONS.map(([value]) => value),
    );
    expect(RESUME_REASONS.map(([value]) => value)).toEqual([
      'MEDICAL_ADVICE',
      'COST_OR_ACCESS',
      'OWN_DECISION',
      'OTHER',
    ]);
  });

  it('texto do motivo conforme a acao', () => {
    expect(statusReasonText('INTERRUPTED', 'SIDE_EFFECT')).toBe('Efeito colateral');
    expect(statusReasonText('ACTIVE', 'COST_OR_ACCESS')).toBe('Voltei a ter o medicamento');
    expect(statusReasonText('CANCELED', 'COST_OR_ACCESS')).toBe('Custo ou falta do medicamento');
  });
});
