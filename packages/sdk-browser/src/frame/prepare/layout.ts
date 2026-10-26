import { rootBlended } from '../../geometry/selection/collectBlend.ts'
import type { PageRec } from '../../geometry/selection/types.ts'
import { createClusterState } from '../../geometry/clusters/clusterState.ts'
import type { WebgpuPagesSetup } from './setup.ts'
import { postPackedBases } from '../../geometry/selection/placements.ts'
import { createPackedPages, createPageCatalogue } from '../../geometry/selection/catalogue.ts'
import { createPackedInstances } from '../../geometry/rows/instances.ts'
import type { NodeIndex } from '../render/movedNode.ts'

export type WebgpuPagesLayout = ReturnType<typeof createWebgpuPagesLayout>

/** The pages of `root` the transparent pass draws: those whose page is blended (`PageRec.transparent`),
 *  wherever its root is filed. */
export const blendedPagesOf = (root: { pages: readonly { transparent?: boolean }[] }) =>
  root.pages.reduce((total, page) => total + (page.transparent ? 1 : 0), 0)

/** The roots of the cut in order, the packed pages they make, and the one catalogue over them. */
function packedCatalogue(setup: WebgpuPagesSetup) {
  const { roots, bootstrap } = setup
  // The world DAG is one more opaque root, wherever it sits (`worldRoot.ts`), its blended pages, if
  // any, the transparent pass's (`ClusterRoot.mixed`).
  const opaqueRoots = roots.filter((root) => !rootBlended(root)),
    transparentRoots = roots.filter(rootBlended)
  // One cluster catalogue for one cut: the opaque primitives first, then the transparent ones. The
  // GPU selection, the residency and the page budget read all of it; only the drawing path splits,
  // because a transparent cluster is blended in source order instead of entering the visibility
  // buffer. Placements grown in place append their opaque pages after the transparent ones: a
  // page's kind is read from the page, never from its rank.
  const selectionRoots = [...opaqueRoots, ...transparentRoots]
  // One record serves every placement of its primitive (#1235): the packed order is the INSTANCES
  // — a (placement, page) pair —, and the per-placement tables say which root each packed rank
  // belongs to. Every reader finds a page's world and winding through `placement`, never on the
  // shared record.
  // No list holds one entry per instance: a rank resolves through `placement` to its root and the
  // root's shared `pages` (`createPackedPages`): an instance reads the pages of its geometry from
  // its own base.
  const placement = postPackedBases(selectionRoots)
  const packedPages = createPackedPages(selectionRoots, placement)
  // Counted by their pages' own kind: the world DAG, an opaque root, holds blended pages too.
  const blendedPageCount = selectionRoots.reduce((total, root) => total + blendedPagesOf(root), 0)
  const worldUpdates = new Float32Array(Math.max(1, selectionRoots.length) * 16)
  const gpuWanted: PageRec[] = bootstrap
  const instances = createPackedInstances(selectionRoots, placement)
  // The one catalogue over `packedPages`: its `recordOf` is how a consumer resolves the packed
  // ranks the cut publishes, and the cluster state indexes it once (`./catalogue.ts`).
  const catalogue = createPageCatalogue(packedPages)
  return {
    transparentRoots,
    selectionRoots,
    placement,
    packedPages,
    blendedPageCount,
    worldUpdates,
    gpuWanted,
    instances,
    catalogue,
  }
}

/** The geometry of the drawing path: the packed pages, the placements that place them and the
 *  residency of their clusters (`../../geometry/clusters/`). Nothing here is sized by the clusters a
 *  frame draws: those are the cut's list of visible clusters, written by the GPU
 *  (`../../geometry/dag/visible/layout.ts`). */
export function createWebgpuPagesLayout(
  setup: WebgpuPagesSetup,
  /** The pool slot, in words, an address holds in the page cache, -1 none: the cache's own. */
  slotWords: (address: string) => number,
) {
  const {
    transparentRoots,
    selectionRoots,
    placement,
    packedPages,
    blendedPageCount,
    worldUpdates,
    gpuWanted,
    instances,
    catalogue,
  } = packedCatalogue(setup)
  const clusters = createClusterState(packedPages, instances, slotWords)
  return {
    transparentRoots,
    selectionRoots,
    /** The roots' index by node, its slots made at its first read (`../render/movedNode.ts`). */
    rootIndex: { revision: 0 } as NodeIndex,
    packedPages,
    /** The packed rank of a page to its record: the engine's one catalogue accessor. */
    recordOf: catalogue.recordOf,
    /** The packed rank of a page to where its placement's deformation writes its results, none for
     *  a page that is not deformed (`../../deformation/outputs.ts`). */
    deformationOutputOf: catalogue.outputOf,
    /** The root rank of each packed rank, and the packed base of each root (#1235): one object for
     *  the session, read-only here, which a growth rewrites in place (`postPackedBases(roots, into)`)
     *  so the readers built once — the closure, the page parents, the held residency — follow it. */
    get placement() {
      return placement
    },
    /** The pages the blend pass draws, which the cut lists but no raster draws: the opaque ones are
     *  the rest. */
    blendedPageCount,
    worldUpdates,
    /** The placements a host walk's scan found moved, without a GPU cut (`rootWorldsMoved`). */
    worldsScanned: new Int32Array(8),
    gpuWanted,
    /** The clusters' residency: which page is in its pool slot, its cluster record written
     *  (`../../geometry/clusters/clusterResidency.ts`), and the placements' records. */
    clusters,
    /** The growth under way — the tables', the layers', an atlas lane's —, which the next one
     *  waits for (`growthQueue.ts`). */
    growing: undefined as Promise<unknown> | undefined,
  }
}
