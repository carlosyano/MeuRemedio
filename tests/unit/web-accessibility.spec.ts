// @trace RF-009 getAccessibilityPreferences updateAccessibilityPreferences
// Preferencias de acessibilidade na web (DC-061): as escalas do contrato e a aplicacao no elemento
// raiz (tamanho da fonte em porcentagem e marca de alto contraste), sem depender do DOM real.
import { describe, expect, it } from 'vitest';
import {
  TEXT_SCALES,
  applyPreferences,
  type PreferenceTarget,
} from '../../apps/web/src/lib/accessibility.js';

const target = (): PreferenceTarget => ({ style: { fontSize: '' }, dataset: {} });

describe('preferencias de acessibilidade', () => {
  it('escalas do contrato, na mesma ordem', () => {
    expect(TEXT_SCALES).toEqual([100, 125, 150, 175, 200]);
  });

  it('aplica a escala e o alto contraste; o padrao limpa os dois', () => {
    const root = target();
    applyPreferences(root, { text_scale: 150, high_contrast: true });
    expect(root.style.fontSize).toBe('150%');
    expect(root.dataset['contrast']).toBe('alto');
    applyPreferences(root, { text_scale: 100, high_contrast: false });
    expect(root.style.fontSize).toBe('');
    expect(root.dataset['contrast']).toBeUndefined();
  });
});
