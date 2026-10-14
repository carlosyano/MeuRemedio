import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Pacotes do workspace resolvidos pelo codigo-fonte: os testes nao dependem de build previo (dist/).
const resolve = {
  alias: {
    '@meuremedio/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        test: { name: 'unit', include: ['tests/unit/**/*.spec.ts'], environment: 'node' },
      },
      {
        resolve,
        test: { name: 'contract', include: ['tests/contract/**/*.spec.ts'], environment: 'node' },
      },
      {
        resolve,
        test: {
          // TS-040 com Schemathesis contra a API em execucao (QG-001); requer o Schemathesis fixado.
          name: 'schemathesis',
          include: ['tests/schemathesis/**/*.spec.ts'],
          environment: 'node',
          testTimeout: 1_800_000,
          hookTimeout: 180_000,
        },
      },
      {
        resolve,
        test: {
          name: 'integration',
          // tests/security: cenarios de seguranca (TS-033, TS-041...) contra PostgreSQL real.
          include: ['tests/integration/**/*.spec.ts', 'tests/security/**/*.spec.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
