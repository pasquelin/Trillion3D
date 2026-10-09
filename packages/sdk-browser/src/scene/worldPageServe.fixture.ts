import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { worldBundlePages, type WorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts'
import { worldPageServer } from './worldPageServe.ts'

/** The page source of `table` over `bin`, the cook's world binary, and the bundles it reads;
 *  `landed` is told the other pages each bundle read lands. */
export function worldRootsBinSource(
  table: WorldRoots,
  bin: Uint8Array,
  landed?: (addresses: readonly string[]) => void,
) {
  const reads: number[] = []
  const read = async (bundle: number) => {
    reads.push(bundle)
    const { offset, bytes } = table.bundles[bundle]
    return worldBundlePages(table, bundle, bin.slice(offset, offset + bytes))
  }
  const source = worldPageServer(table, read, landed)
  return { source, reads }
}

/** The cook's world fixture, its table and its page source. */
export function worldRootsPageFixtureSource() {
  const { table, bin } = worldRootsFixture()
  return { table, ...worldRootsBinSource(table, bin) }
}
