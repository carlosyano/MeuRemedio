// Preferencias de acessibilidade na web (RF-009; DC-061): escala do texto e alto contraste,
// aplicados no elemento raiz. Sem importar outros modulos locais: roda nos testes e no Next.

export interface AccessibilityPreferences {
  readonly text_scale: number;
  readonly high_contrast: boolean;
}

/** Enum de AccessibilityPreferences.text_scale na OpenAPI. */
export const TEXT_SCALES = [100, 125, 150, 175, 200] as const;

/** O suficiente do elemento <html> para aplicar as preferencias. */
export interface PreferenceTarget {
  readonly style: { fontSize: string };
  readonly dataset: Record<string, string | undefined>;
}

/**
 * Escala pelo font-size da raiz (o Tailwind usa rem, entao tudo acompanha) e alto contraste pela
 * marca data-contrast, que troca as cores em globals.css. O padrao volta aos valores do navegador.
 */
export function applyPreferences(
  root: PreferenceTarget,
  preferences: AccessibilityPreferences,
): void {
  root.style.fontSize = preferences.text_scale === 100 ? '' : `${String(preferences.text_scale)}%`;
  if (preferences.high_contrast) root.dataset['contrast'] = 'alto';
  else delete root.dataset['contrast'];
}
