import js from '@eslint/js';
import ts from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
export default ts.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/next-env.d.ts',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  { files: ['**/*.cjs'], languageOptions: { globals: { module: 'readonly' } } },
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
);
