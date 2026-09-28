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

/** The `node --test` flag that runs one shard of the suite, `TRILLION3D_TEST_SHARD` (`2/3`), which
 *  `node` itself checks: the CI splits the one file list over parallel jobs. None when unset, so a
 *  local run keeps every test. */
export function shardFlags(env: NodeJS.ProcessEnv): string[] {
  return env.TRILLION3D_TEST_SHARD ? [`--test-shard=${env.TRILLION3D_TEST_SHARD}`] : [];
}
