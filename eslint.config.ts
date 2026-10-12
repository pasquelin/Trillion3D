import { localFileGlobs } from './scripts/repository-files.ts'
import { MATHS_FORMS, MATHS_HOME, MATHS_ORACLES } from './scripts/lint-maths.ts'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      ...localFileGlobs(),
      '**/target/**',
      // Measurement bench outputs: extracted source trees are built there.
      '.mesure/**',
      // Worktrees and agents' logs inside the project (#452).
      '.worktrees/**',
    ],
  },
  js.configs.recommended,
  {
    // The inline forms of a formula `packages/math` holds (`scripts/lint-maths.ts`), refused outside
    // it and its declared oracles. A later block that sets `no-restricted-syntax` for its own files
    // replaces these entries there, so it lists them too.
    files: ['**/*.{ts,mts}'],
    ignores: [MATHS_HOME, ...MATHS_ORACLES],
    rules: { 'no-restricted-syntax': ['error', ...MATHS_FORMS] },
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,mts}'],
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
    files: ['**/*.{ts,mts}'],
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The shadow scheduler reads these objects page by page: V8 keeps an object literal with an
    // accessor in dictionary mode, a hash lookup per read (#26). The plan and the request reader
    // are read a few times a frame.
    files: ['packages/sdk-core/src/scene/light-shadow/*.ts'],
    ignores: ['**/plan.ts', '**/requests.ts', ...MATHS_ORACLES],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ObjectExpression > Property[kind=/^(get|set)$/]',
          message:
            'A data field or a function, never an accessor: it puts the object in dictionary mode.',
        },
        ...MATHS_FORMS,
      ],
    },
  },
  {
    // Tests and golden fixtures; `timingDevice.ts` was a fixture before it joined the kit.
    files: ['**/*.test.ts', 'tests/fixtures/**/*.ts', 'tests/kit/gpu/timingDevice.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
)
