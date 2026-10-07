import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', 'validation-report/**'] },
  js.configs.recommended,
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: { Buffer: 'readonly', console: 'readonly', fetch: 'readonly', process: 'readonly' },
    },
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
