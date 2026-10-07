// The catalogue's root cover: the pages the session holds whatever the view, and the pool's floor.
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts'
import { rootCoverage } from '../../../page/selection/selection.ts'
import { rootChildren } from '../../../residency/minimumCapacity.ts'
import { pageAddress } from '../../row/pageSlots.ts'
import type { createWebgpuPageTracking } from '../../row/pageTracking.ts'

/** Whether a record is a page: a world root no mesh wears is a record without one
 *  (`../../../scene/worldRecords.ts`), never loaded nor counted. */
const isPage = (rec: Pick<PageRec, 'url' | 'geometryPage'>) => pageAddress(rec) !== ''

/** The root cover, by address and by key — the roots the session holds, a root a cell holds
 *  (`PageRec.holder`) joining it with its cell —, and the pool's floor: the root cover and the
 *  pages its groups replace (`minimumCapacity.ts`). Records without a page take no slot. */
export function rootCoverOf(
  roots: readonly ClusterRoot<PageRec>[],
  tracking: ReturnType<typeof createWebgpuPageTracking>,
) {
  const covered = rootCoverage(roots, pageAddress),
    bootstrap = covered.filter((page) => page.holder === undefined && isPage(page)),
    bootstrapUrls = new Set(bootstrap.map(pageAddress))
  const children = rootChildren(roots).filter(isPage).map(pageAddress),
    floorPages = new Set([...bootstrapUrls, ...children]).size
  const bootstrapKeys = new Int32Array(bootstrap.length),
    bootstrapKey = new Uint8Array(tracking.keyCount)
  for (let i = 0; i < bootstrap.length; i++) {
    bootstrapKeys[i] = tracking.keyOf(bootstrap[i])
    bootstrapKey[bootstrapKeys[i]] = 1
  }
  return { bootstrap, bootstrapUrls, floorPages, bootstrapKeys, bootstrapKey }
}
