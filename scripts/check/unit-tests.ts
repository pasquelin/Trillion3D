import { availableParallelism } from 'node:os'
import { heavyStep } from '../native/heavy-lock.ts'
import { run } from './run.ts'

/** Every maintained unit test: the one rule `pnpm test` and `check:changed` both read. */
export function isUnitTest(file: string): boolean {
  return /^(?:packages|bench|tests|scripts)\/.*\.test\.(?:ts|mts)$/.test(file)
}

/** The `node --test` flags of a run under `env`. A shard, `TRILLION3D_TEST_SHARD` (`2/3`), which
 *  `node` itself checks, runs its share of the one file list at full parallelism, as does any CI
 *  run. A local run keeps every test but starts one process for two cores (`TRILLION3D_TEST_CONCURRENCY`
 *  overriding): `node` would start one per core but one, which leaves nothing to the agents and
 *  the compiler beside it. */
export function testRunFlags(env: NodeJS.ProcessEnv, cores = availableParallelism()): string[] {
  if (env.TRILLION3D_TEST_SHARD) return [`--test-shard=${env.TRILLION3D_TEST_SHARD}`]
  if (env.CI) return []
  const local = env.TRILLION3D_TEST_CONCURRENCY || String(Math.max(1, Math.floor(cores / 2)))
  return [`--test-concurrency=${local}`]
}

/** Runs `files` under `node --test`, one heavy step on the machine, capped locally. */
export function runUnitTests(files: readonly string[]): void {
  const args = [
    '--experimental-strip-types',
    '--test',
    '--test-timeout=300000',
    ...testRunFlags(process.env),
    ...files,
  ]
  heavyStep('test', () => run(process.execPath, args))
}
