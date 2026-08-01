import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['test/**/*.ts', 'examples/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['benchmark/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        performance: 'readonly',
        process: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
  {
    ignores: ['dist/', 'node_modules/', 'scripts/', '*.config.js', '*.config.ts'],
  },
);
