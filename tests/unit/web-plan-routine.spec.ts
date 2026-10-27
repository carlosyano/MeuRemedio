// @trace TL-004 RF-003 RN-001 createPlan updatePlan (cadastro no formato da receita, DC-074)
// Ajudas do editor de plano para transcrever a receita (DC-074): horarios a cada N horas a partir
// do primeiro horario informado, duracao em dias que vira data de termino e a frase de conferencia
// no formato da receita. Nada e inferido: tudo sai do que a pessoa digitou.
import { describe, expect, it } from 'vitest';
import {
  INTERVAL_HOURS,
  addDays,
  describeRoutine,
  durationDays,
  endDateForDays,
  parseDays,
  timesEvery,
  type PlanPayload,
} from '../../apps/web/src/lib/plan-form.js';

describe('timesEvery', () => {
  it('8/8h a partir das 08:00: tres horarios na ordem do dia de tomada', () => {
    expect(timesEvery(8, '08:00')).toEqual(['08:00', '16:00', '00:00']);
  });

  it('6/6h, 12/12h e 24/24h preservam os minutos', () => {
    expect(timesEvery(6, '07:30')).toEqual(['07:30', '13:30', '19:30', '01:30']);
    expect(timesEvery(12, '21:15')).toEqual(['21:15', '09:15']);
    expect(timesEvery(24, '22:00')).toEqual(['22:00']);
  });

  it('4/4h gera seis horarios, dentro do limite de 10', () => {
    expect(timesEvery(4, '00:00')).toEqual(['00:00', '04:00', '08:00', '12:00', '16:00', '20:00']);
  });

  it('so oferece intervalos que fecham o dia sem passar de 10 horarios', () => {
    expect(INTERVAL_HOURS).toEqual([4, 6, 8, 12, 24]);
    for (const hours of INTERVAL_HOURS) {
      expect(24 % hours).toBe(0);
      expect(24 / hours).toBeLessThanOrEqual(10);
    }
  });

  it('intervalo fora da lista ou primeiro horario invalido nao gera nada', () => {
    expect(timesEvery(5, '08:00')).toEqual([]);
    expect(timesEvery(36, '08:00')).toEqual([]);
    expect(timesEvery(8, '')).toEqual([]);
    expect(timesEvery(8, '24:00')).toEqual([]);
  });
});

describe('duracao em dias', () => {
  it('soma dias em data civil, atravessando mes e ano bissexto', () => {
    expect(addDays('2026-10-27', 4)).toBe('2026-10-31');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('"por 5 dias" a partir de hoje termina no quinto dia, inclusive', () => {
    expect(endDateForDays('2026-10-27', 5)).toBe('2026-10-31');
    expect(endDateForDays('2026-10-27', 1)).toBe('2026-10-27');
  });

  it('duracao inclusiva entre inicio e termino', () => {
    expect(durationDays('2026-10-27', '2026-10-31')).toBe(5);
    expect(durationDays('2026-10-27', '2026-10-27')).toBe(1);
    expect(durationDays('2026-12-30', '2027-01-02')).toBe(4);
  });

  it('aceita so inteiro positivo de ate 3650 dias', () => {
    expect(parseDays('7')).toBe(7);
    expect(parseDays(' 10 ')).toBe(10);
    expect(parseDays('3650')).toBe(3650);
    for (const text of ['', '0', '-1', '2,5', '1.5', 'sete', '3651']) {
      expect(parseDays(text)).toBeUndefined();
    }
  });
});

describe('describeRoutine', () => {
  const base: PlanPayload = {
    medication_name: 'Levofloxacino 500 mg',
    dose_text: '1 comprimido',
    medication_form: 'TABLET',
    administration_route: 'ORAL',
    instructions: null,
    prescriber_name: null,
    prescriber_crm: null,
    start_date: '2026-10-27',
    end_date: '2026-11-02',
    schedule_times: ['08:00'],
  };

  it('uma vez ao dia, por 7 dias', () => {
    expect(describeRoutine(base)).toBe(
      'Tomar 1 comprimido, via oral, 1 vez ao dia (08:00), por 7 dias, de 27/10/2026 a 02/11/2026.',
    );
  });

  it('varias vezes ao dia, horarios em ordem, por 1 dia', () => {
    expect(
      describeRoutine({
        ...base,
        dose_text: '3 ml',
        medication_form: 'LIQUID',
        end_date: '2026-10-27',
        schedule_times: ['00:00', '08:00', '16:00'],
      }),
    ).toBe(
      'Tomar 3 ml, via oral, 3 vezes ao dia (00:00, 08:00 e 16:00), por 1 dia, em 27/10/2026.',
    );
  });

  it('uso continuo e outra via', () => {
    expect(describeRoutine({ ...base, administration_route: 'OTHER', end_date: null })).toBe(
      'Tomar 1 comprimido, por outra via, 1 vez ao dia (08:00), uso contínuo a partir de 27/10/2026.',
    );
  });
});
