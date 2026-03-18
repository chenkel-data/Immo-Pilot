import js from '@eslint/js';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-console': 'off',
      // Empty catch blocks are used intentionally throughout (fire-and-forget patterns)
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    ignores: ['client/', 'public/', 'node_modules/', 'data/', 'reports/'],
  },
];
