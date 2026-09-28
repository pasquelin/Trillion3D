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

/**
 * The `node --test` flag that runs one shard of the suite, from `TRILLION3D_TEST_SHARD` (`2/3`):
 * the CI splits the suite over parallel jobs, each given the same file list. None when the variable
 * is unset, so a local run keeps every test; a malformed value stops the run rather than drop tests.
 */
export function shardFlags(env: NodeJS.ProcessEnv): string[] {
  const shard = env.TRILLION3D_TEST_SHARD;
  if (!shard) return [];
  const [, index, total] = /^(\d+)\/(\d+)$/.exec(shard) ?? [];
  if (!index || !total || +index < 1 || +index > +total)
    throw new Error(
      `TRILLION3D_TEST_SHARD='${shard}': expected <index>/<total>, 1 <= index <= total.`,
    );
  return [`--test-shard=${index}/${total}`];
}
