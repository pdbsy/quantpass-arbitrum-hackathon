import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      '.artifacts/**',
      '.checks/**',
      'dist/**',
      '**/dist/**',
      '.data/**',
      'build/**',
      'outputs/**',
      'work/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{js,mjs,ts}'], languageOptions: { globals: globals.node } },
  { files: ['apps/web/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  { files: ['docs/task-board.js'], languageOptions: { globals: globals.browser } },
];
