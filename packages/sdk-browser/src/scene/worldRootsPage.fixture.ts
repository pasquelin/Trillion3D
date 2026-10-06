import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { worldBundlePages, type WorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts'
import { worldRootsPageSource } from './worldRootsPage.ts'
import { worldPageServer } from './worldPageServe.ts'

/** The page source of `table` over `bin`, the cook's world binary, and the bundles it reads. */
export function worldRootsBinSource(table: WorldRoots, bin: Uint8Array, pendingBundles?: number) {
  const reads: number[] = []
  const server = worldPageServer(
    table,
    async (bundle) => {
      reads.push(bundle)
      const { offset, bytes, count } = table.bundles[bundle]
      return worldBundlePages(bin.slice(offset, offset + bytes), count, bundle)
    },
    pendingBundles,
  )
  const source = worldRootsPageSource(server)
  return { source, reads }
}

/** The cook's world fixture, its table and its page source. */
export function worldRootsPageFixtureSource(pendingBundles?: number) {
  const { table, bin } = worldRootsFixture()
  return { table, ...worldRootsBinSource(table, bin, pendingBundles) }
}
