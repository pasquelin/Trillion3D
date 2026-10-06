// The second pass of `check:unused` (`scripts/check-unused.ts`, #1366): the entries of
// `knip.config.ts` without the tests, the fixtures and the test kit, plus every script, bench and
// site module, which run outside `pnpm test`. Only `packages/` is reported: a source file or an
// export that only a test reaches is dead code, as one that nothing reaches.
import type { KnipConfig } from 'knip'
import config from './knip.config.ts'

/** Test code: the tests, their fixtures, the GPU proofs and the test kit. */
const TEST_CODE = ['**/*.test.ts', '**/*.fixture.ts', '**/*.gpu.ts', 'tests/**']

const isTestCode = (pattern: string) =>
  /\.(?:test|fixture|gpu)\.ts$|^tests\//.test(pattern.replace(/\{[^}]*\}$/, ''))

/** The first pass: `knip.config.ts` exports an object, its root workspace the one with sources. */
const base = config as Exclude<KnipConfig, (...args: never[]) => unknown>
const root = base.workspaces!['.']

const entries = [
  ...(root.entry as string[]).filter((pattern) => !isTestCode(pattern)),
  'bench/**/*.{ts,mts}',
  'scripts/**/*.{ts,mts}',
  'site/**/*.{ts,tsx}',
]

const production: KnipConfig = {
  ...base,
  workspaces: {
    ...base.workspaces,
    '.': {
      ...root,
      // `!` marks a production pattern, which is all `--production` reads.
      entry: [...entries.map((entry) => `${entry}!`), ...TEST_CODE.map((code) => `!${code}!`)],
      project: ['packages/**/*.{ts,mts}!', ...TEST_CODE.map((code) => `!${code}!`)],
    },
  },
}

export default production
