// The catalogue's root cover: the pages the session holds whatever the view, and the pool's floor.
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts'
import { rootCoverage } from '../../../page/selection/selection.ts'
import { rootChildren } from '../../../residency/minimumCapacity.ts'
import { pageAddress } from '../../row/pageSlots.ts'
import type { WebgpuPageTracking } from '../../row/pageTracking.ts'
import { createCoverKeys } from '../../residency/coverKeys.ts'

/** Whether a record is a page: a world root no mesh wears is a record without one
 *  (`../../../scene/worldRecords.ts`), never loaded nor counted. */
const isPage = (rec: Pick<PageRec, 'url' | 'geometryPage'>) => pageAddress(rec) !== ''

/** The pages `roots` hold whatever the view — the root cover, a root a cell holds
 *  (`PageRec.holder`) joining it with its cell — and the pages their groups replace
 *  (`minimumCapacity.ts`). Records without a page take no slot. */
export function coverPagesOf(roots: readonly ClusterRoot<PageRec>[]) {
  const bootstrap = rootCoverage(roots, pageAddress).filter(
    (page) => page.holder === undefined && isPage(page),
  )
  return { bootstrap, children: rootChildren(roots).filter(isPage) }
}

/** The root cover, by address and by key — the roots the session holds —, and the pool's floor:
 *  the root cover and the pages its groups replace, by address. */
export function rootCoverOf(roots: readonly ClusterRoot<PageRec>[], tracking: WebgpuPageTracking) {
  const { bootstrap, children } = coverPagesOf(roots)
  const coverUrls = new Set(bootstrap.map(pageAddress))
  const floorUrls = new Set([...coverUrls, ...children.map(pageAddress)])
  const bootstrapKey = createCoverKeys(tracking.keyCount)
  for (const page of bootstrap) bootstrapKey[tracking.keyOf(page)] = 1
  return { bootstrap, coverUrls, floorUrls, bootstrapKey }
}
