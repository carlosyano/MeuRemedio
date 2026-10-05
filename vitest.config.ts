import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.spec.ts'], environment: 'node' } },
      { test: { name: 'contract', include: ['tests/contract/**/*.spec.ts'], environment: 'node' } },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.spec.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
