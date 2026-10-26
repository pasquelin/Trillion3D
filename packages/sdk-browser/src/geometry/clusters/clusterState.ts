import type { PageRec } from '../selection/types.ts'
import { createPageCatalogue, type PageList } from '../selection/catalogue.ts'
import { pageAddress } from '../rows/page/pageSlots.ts'
import { flatInstances, type PackedInstances } from '../rows/instances.ts'
import { createClusterJournal } from './journal.ts'
import { createClusterPageState } from './pageState.ts'
import { createPlacementInfo } from './placementInfo.ts'
import { createResidentSurfaces } from './surfaces.ts'

/** What the cluster residency keeps of a session's packed pages (`createClusterState`). */
export type ClusterState = ReturnType<typeof createClusterState>

/**
 * The residency of the clusters the cut draws: which packed page is in its pool slot and has its
 * cluster record written (`./clusterResidency.ts`), the log of the pages named since the last
 * pass (`./journal.ts`) and the packed ranks of each pool address. Nothing here is a row of a
 * table of drawn clusters: a drawn cluster is a record the GPU's cut writes the frame it cuts
 * (`../dag/visible/layout.ts`), and what it needs of its page is the page's cluster record.
 */
export function createClusterState(
  packedPages: PageList,
  /** Packed ranks by pool ADDRESS, the key the cache names when a slot moves: the layout's, per
   *  primitive page (`../rows/instances.ts`); made here over a flat list built without one. */
  instances: PackedInstances = flatInstances(packedPages),
  /** The pool slot, in words, an address holds in the page cache, -1 none (`./pageState.ts`). */
  slotWords: (address: string) => number,
) {
  const state = {
    /** Pages named by the cache and those whose residency flag just flipped. */
    ...createClusterJournal(),
    instances,
    /** A record's packed ranks all share its pool address: the address's first rank names it. A
     *  caller that needs ONE instance's rank uses the packed list the cut publishes, never this. */
    pageIndexOf: (rec: PageRec) => instances.first(pageAddress(rec)),
    ...createClusterPageState(
      createPageCatalogue(packedPages).recordOf,
      () => packedPages.length,
      slotWords,
    ),
    /**
     * Age of what the cluster records hold of the surfaces: advanced when a surface's record or the
     * atlases' headers changed since (`../../frame/render/render.ts`), the records of every resident
     * cluster are written again.
     */
    infoEpoch: 1,
    /** The opaque pages the cut may draw: resident, and their records written. */
    candidateCount: 0,
    /** The surfaces the clusters whose records are written wear (`./surfaces.ts`). */
    surfaces: createResidentSurfaces(),
    /** The placements' records, which a cluster is decoded with (`./placementInfo.ts`). */
    placementInfo: createPlacementInfo(),
    /** `packedPages` grew from `first` on (`addClusterPages`). */
    addPages(first: number) {
      state.instances.add()
      for (let page = first; page < packedPages.length; page++) state.touchPage(page)
    },
  }
  return state
}
