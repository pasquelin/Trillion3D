import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts';
import { worldBundlePages, type WorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts';
import { worldRootsPageSource } from './worldRootsPage.ts';

/** The page source of `table` over `bin`, the cook's world binary, and the bundles it reads. */
export function worldRootsBinSource(table: WorldRoots, bin: Uint8Array) {
  const reads: number[] = [];
  const source = worldRootsPageSource(table, async (bundle) => {
    reads.push(bundle);
    const { offset, bytes, count } = table.bundles[bundle];
    return worldBundlePages(bin.slice(offset, offset + bytes), count, bundle);
  });
  return { source, reads };
}

/** The cook's world fixture, its table and its page source. */
export function worldRootsPageFixtureSource() {
  const { table, bin } = worldRootsFixture();
  return { table, ...worldRootsBinSource(table, bin) };
}
