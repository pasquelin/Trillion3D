import { worldRootsFixture } from './worldRootsPages.fixture.ts'
import { worldBundlePages, type WorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts'
import { worldPageServer } from './worldPageServe.ts'

/** The page source of `table` over `bin`, the cook's world binary, and the bundles it reads —
 *  a read in flight shared by its callers, as the session's queue shares it —; `landed` is told
 *  the other pages each bundle read lands. */
export function worldRootsBinSource(
  table: WorldRoots,
  bin: Uint8Array,
  landed?: (addresses: readonly string[]) => void,
) {
  const reads: number[] = [],
    flying = new Map<number, Promise<ReturnType<typeof worldBundlePages>>>()
  const read = (bundle: number) => {
    let own = flying.get(bundle)
    if (own) return own
    reads.push(bundle)
    const { offset, bytes } = table.bundles[bundle]
    own = Promise.resolve(worldBundlePages(table, bundle, bin.slice(offset, offset + bytes)))
    flying.set(bundle, own)
    const done = () => void flying.delete(bundle)
    own.then(done, done)
    return own
  }
  const source = worldPageServer(table, table.payload.url, read, landed)
  return { source, reads }
}

/** The cook's world fixture, its table and its page source. */
export function worldRootsPageFixtureSource() {
  const { table, bin } = worldRootsFixture()
  return { table, ...worldRootsBinSource(table, bin) }
}
