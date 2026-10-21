// The catalogue's root cover: the pages the session holds whatever the view, beside the streaming
// pool (`../../session/memory/pools.ts`); and its root pages, the root region they ask.
import type { ClusterRoot, PageRec } from '../../geometry/selection/types.ts'
import { rootCoverage } from '../../geometry/selection/selection.ts'
import {
  hasPage,
  pageAddress,
  rootSlotsOf,
  type PageSlotCensus,
} from '../../geometry/rows/page/pageSlots.ts'
import type { WebgpuPageTracking } from '../../geometry/rows/page/pageTracking.ts'
import { createCoverKeys } from '../../geometry/residency/coverKeys.ts'
import { DEFAULT_INITIAL_ROOT_PAGES } from '../../session/engine/common.ts'
import { alignUp, bitLength } from '../../../../math/src/scalar/integers.ts'

/** The pages `roots` hold whatever the view: each root page (`rootPages`), a page a cell holds
 *  (`PageRec.holder`) joining it with its cell. Records without a page take no slot. */
export const coverPagesOf = (roots: readonly ClusterRoot<PageRec>[]) =>
  rootPages(roots).filter((page) => page.holder === undefined && hasPage(page))

/** The root cover grown to each ROOT PAGE: every page of a primitive's root pages
 *  (`PageRec.pinned`) and of any bundle holding a root — the roots, then the coarsest groups the
 *  cook assigned beside them (`compiler/pages/bundles.rs`) —, so the cut refines it with nothing to
 *  load. A root in no bundle stands alone. Placements sharing their records are walked once. */
function rootPages(roots: readonly ClusterRoot<PageRec>[]) {
  const cover = new Map(rootCoverage(roots, pageAddress).map((page) => [pageAddress(page), page]))
  const walked = new Set<readonly PageRec[]>()
  for (const { pages } of roots) {
    if (walked.has(pages)) continue
    walked.add(pages)
    const bundles = new Set<string>()
    for (const page of pages)
      if ((page.parentError == null || page.pinned) && page.streamUrl !== undefined)
        bundles.add(page.streamUrl)
    if (bundles.size)
      for (const page of pages)
        if (page.streamUrl !== undefined && bundles.has(page.streamUrl))
          cover.set(pageAddress(page), page)
  }
  return [...cover.values()]
}

/** The root cover, by address and by key: the root pages the session holds; and every ROOT PAGE's
 *  address (`addRootUrls`), the root cover's first. */
export function rootCoverOf(roots: readonly ClusterRoot<PageRec>[], tracking: WebgpuPageTracking) {
  const bootstrap = coverPagesOf(roots)
  const coverUrls = new Set(bootstrap.map(pageAddress))
  const bootstrapKey = createCoverKeys(tracking.keyCount)
  for (const page of bootstrap) bootstrapKey[tracking.keyOf(page)] = 1
  const rootUrls = addRootUrls(roots, new Set(coverUrls))
  return { bootstrap, coverUrls, bootstrapKey, rootUrls }
}

/** `into`, the address of each page of `roots` an HLOD cell holds (`PageRec.holder`) added: the
 *  root pages its cell holds while its actor is loaded, which the pool's root region holds beside
 *  the root cover's (`../../geometry/pages/pool/placement.ts`). Placements sharing their records
 *  are walked once. */
export function addRootUrls(roots: readonly ClusterRoot<PageRec>[], into: Set<string>) {
  const walked = new Set<readonly PageRec[]>()
  for (const { pages } of roots) {
    if (walked.has(pages)) continue
    walked.add(pages)
    for (const page of pages)
      if (page.holder !== undefined && hasPage(page)) into.add(pageAddress(page))
  }
  return into
}

/** Rounded up to `bits` significant bits: the steps the reference's root page allocation grows by
 *  (`growWebgpuRootRegion`). */
export const roundUpToSignificantBits = (x: number, bits: number) =>
  alignUp(x, 2 ** Math.max(bitLength(x - 1) - bits, 0))

/**
 * The ROOT REGION the catalogue asks (`../../geometry/pages/pool/placement.ts`, `RootSlots`): a
 * grain as wide as its widest root page (`bytes`), and as many as every root page it has
 * (`rootUrls`, `most`), the root cover's (`coverUrls`) and every HLOD cell's, which the region
 * grows to as the cells hold theirs (`../io/memory.ts`, `growWebgpuRootRegion`). It opens at
 * `least`: the reference's first allocation (`DEFAULT_INITIAL_ROOT_PAGES`) within `most`, the root
 * cover's at least.
 */
export function rootRegionOf(
  census: Pick<PageSlotCensus, 'units' | 'unitWidths'>,
  coverUrls: ReadonlySet<string>,
  rootUrls: ReadonlySet<string>,
) {
  const every = rootSlotsOf(census, rootUrls),
    cover = rootSlotsOf(census, coverUrls).slots
  const least = Math.max(cover, Math.min(DEFAULT_INITIAL_ROOT_PAGES, every.slots))
  return { least, most: every.slots, bytes: every.bytes }
}
