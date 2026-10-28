import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Testes que o Stryker executa contra os mutantes de packages/domain (QG-010, DC-050): so os
// testes unitarios do dominio, sem banco nem rede.
export default defineConfig({
  resolve: {
    alias: {
      '@meuremedio/domain': fileURLToPath(
        new URL('./packages/domain/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: [
      'tests/unit/civil-time.spec.ts',
      'tests/unit/generation-horizon.spec.ts',
      'tests/unit/history-window.spec.ts',
      'tests/unit/occurrence-recurrence.spec.ts',
      'tests/unit/occurrence-slots.spec.ts',
      'tests/unit/plan-rules.spec.ts',
      'tests/unit/weekday-mask.spec.ts',
    ],
    environment: 'node',
  },
});
