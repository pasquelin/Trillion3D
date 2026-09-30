import { heavyStep } from './heavy-lock.ts';
import { run } from './run.ts';

/** Every maintained unit test: the one rule `pnpm test` and `check:changed` both read. */
export function isUnitTest(file: string): boolean {
  return /^(?:packages|bench|tests|scripts|site\/examples\/kit)\/.*\.test\.(?:ts|mts)$/.test(file);
}

/** The test that holds `docs/TESTS.md` to the tree it counts. */
export const INVENTORY_TEST = 'scripts/tests-inventory.test.ts';

/** A change the inventory counts: any unit test, or any file of the test and bench trees. */
export function movesInventory(file: string): boolean {
  return isUnitTest(file) || file.startsWith('tests/') || file.startsWith('bench/');
}

/** The `node --test` flags of a run under `env`. A shard, `TRILLION3D_TEST_SHARD` (`2/3`), which
 *  `node` itself checks, runs its share of the one file list at full parallelism, as does any CI
 *  run. A local run keeps every test but starts two processes at once (`TRILLION3D_TEST_CONCURRENCY`
 *  overriding): `node` would start one per core but one, and several agents checking at once would
 *  stall the machine. */
export function testRunFlags(env: NodeJS.ProcessEnv): string[] {
  if (env.TRILLION3D_TEST_SHARD) return [`--test-shard=${env.TRILLION3D_TEST_SHARD}`];
  if (env.CI) return [];
  return [`--test-concurrency=${env.TRILLION3D_TEST_CONCURRENCY || '2'}`];
}

/** Runs `files` under `node --test`, one heavy step on the machine, capped locally. */
export function runUnitTests(files: readonly string[]): void {
  const args = ['--experimental-strip-types', '--test', ...testRunFlags(process.env), ...files];
  heavyStep('test', () => run(process.execPath, args));
}
