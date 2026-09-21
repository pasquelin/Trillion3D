import { localFileGlobs } from './scripts/repository-files.ts';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      ...localFileGlobs(),
      'benchmark-runs/**',
      '**/target/**',
      // Measurement bench outputs: extracted source trees are built there.
      '.mesure/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['site/app/**/*.tsx'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      'react/jsx-uses-vars': 'error',
      'react/jsx-key': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,mts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        GPUBufferUsage: 'readonly',
        GPUTextureUsage: 'readonly',
        GPUShaderStage: 'readonly',
        GPUMapMode: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,mts,tsx}'],
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'test/fixtures/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
