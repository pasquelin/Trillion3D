import type { Primitive } from '../../../../sdk-core/src/contracts/geometry.ts'
import type { PageRec } from './types.ts'

const NONE: readonly PageRec[] = []

/**
 * The compiled install order, read once per placement: each record receives, as `dependencies`, one
 * record of every streaming bundle its own bundle lists (`streams.pages[].dependencies`,
 * `docs/FORMAT.md`) and whose bytes a cluster draws from. A bundle's clusters receive their bytes
 * together, so one record of it says whether the bundle is there and under which request it is
 * fetched — a geometry page as a slice of it (`../../streaming/pageStreamer.ts`). The list is
 * shared by every record of the bundle, and a bundle that depends on nothing — the root cover —
 * shares an empty one.
 *
 * `recs` are the records of one placement, in the order of `primitive.pages`.
 */
export function linkBundleDependencies(primitive: Primitive, recs: readonly PageRec[]) {
  const bundles = primitive.streams?.pages
  if (!bundles?.length) return
  const fetched: PageRec[] = []
  primitive.pages.forEach((page, index) => {
    const rec = recs[index]
    if (typeof page.stream === 'number') fetched[page.stream] ??= rec
  })
  const lists = bundles.map((bundle) => {
    const records = (bundle.dependencies ?? []).flatMap((dependency) => fetched[dependency] ?? [])
    return records.length ? records : NONE
  })
  primitive.pages.forEach((page, index) => {
    if (typeof page.stream === 'number') recs[index].dependencies = lists[page.stream]
  })
}
