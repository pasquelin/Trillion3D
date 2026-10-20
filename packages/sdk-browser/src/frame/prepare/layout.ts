import { rootBlended } from '../../geometry/selection/collectBlend.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import type { PageRec } from '../../geometry/selection/types.ts'
import { createWebgpuRowState } from '../../geometry/rows/state.ts'
import { DRAW_ITEM_U32 } from '../../visibility/draw/contract.ts'
import { createCornerHold } from '../../visibility/passes/corners.ts'
import { createDrawItemWordsHold } from '../../visibility/passes/itemWords.ts'
import { VIS_MAX_PAGES } from '../../visibility/types.ts'
import { boundTableRows, ROW_STEP, VIEW_ROWS } from '../../geometry/rows/tableRows.ts'
import type { WebgpuPagesSetup } from './setup.ts'
import { postPackedBases } from '../../geometry/selection/placements.ts'
import { createPackedPages, createPageCatalogue } from '../../geometry/selection/catalogue.ts'
import { createPackedInstances } from '../../geometry/rows/instances.ts'
import type { NodeIndex } from '../render/movedNode.ts'
import { pagesHeld } from '../../geometry/pages/pool/placement.ts'

export type WebgpuPagesLayout = ReturnType<typeof createWebgpuPagesLayout>

/**
 * The page table a scene of `opaque` and `blended` packed pages asks, on a pool holding `pages` at
 * most (`pagesHeld`) whose address feeds `maxCopies` rows at most, bounded by one binding of the
 * device (`limits`). Visibility IDs reserve 24 bits for row+1 (zero means background) and 8 for the
 * triangle: rows are the visibility buffer's, and only opaque clusters ever claim one. Blended
 * clusters cast from rows behind them, which only the shadow pass reads: as many as the pool can
 * hold resident at once, and none in a scene that blends nothing. Neither side passes the rows the
 * view holds, `viewRows` (`VIEW_ROWS`, `ROW_STEP` past it, until the cut asked more): a thousand
 * placements of a page ask no more than the view draws (#1232).
 */
export function askedTableRows(
  opaque: number,
  blended: number,
  pages: number,
  maxCopies: number,
  limits: GPUSupportedLimits | undefined,
  viewRows: number,
) {
  const resident = pages * maxCopies
  const draw = Math.max(1, Math.min(VIS_MAX_PAGES, opaque || 1, resident, viewRows))
  return boundTableRows(limits, draw, Math.min(blended, resident, viewRows))
}

/** The pages of `root` the transparent pass draws: those whose page is blended (`PageRec.transparent`),
 *  wherever its root is filed. */
export const blendedPagesOf = (root: { pages: readonly { transparent?: boolean }[] }) =>
  root.pages.reduce((total, page) => total + (page.transparent ? 1 : 0), 0)

/** The geometry of the drawing path: the packed opaque pages, the row table sized to the slot
 *  budget and to one binding of the device (`limits`), and every per-row scratch array the image
 *  reuses instead of reallocating. The table grows in place when a larger pool or the GPU cut's
 *  requests ask more rows (`growTables.ts`). */
export function createWebgpuPagesLayout(
  setup: WebgpuPagesSetup,
  limits: GPUSupportedLimits | undefined,
  /** The pool slot, in words, an address holds in the page cache, -1 none: the cache's own. */
  slotWords: (address: string) => number,
) {
  const { roots, bootstrap, cap: slots, pageBytes, homes } = setup
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
  // belongs to. Every reader finds a page's world, row and winding through `placement`, never on
  // the shared record.
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
  // A scene whose instances fit the rows of a view holds them all; a larger one opens at one step
  // of the row cache and grows by what its cut asks (`growTables.ts`, `../../geometry/rows/slots.ts`).
  const viewRows = packedPages.length > VIEW_ROWS ? ROW_STEP : VIEW_ROWS
  const { drawSlots, blendSlots, bounded } = askedTableRows(
    packedPages.length - blendedPageCount,
    blendedPageCount,
    pagesHeld(pageBytes, slots, homes),
    instances.copiesMax,
    limits,
    viewRows,
  )
  // The one catalogue over `packedPages`: its `recordOf` is how a consumer resolves the packed
  // ranks the cut publishes, and the row state indexes it once (`./catalogue.ts`).
  const catalogue = createPageCatalogue(packedPages)
  const rows = createWebgpuRowState(packedPages, drawSlots, blendSlots, instances, slotWords)
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
    blendedPageCount,
    /** The rows the view holds (`../../geometry/rows/tableRows.ts`): the table is never asked past them, and
     *  only a cut that selected more raises them (`growTables.ts`, `followCutRows`). */
    viewRows,
    worldUpdates,
    /** The placements a host walk's scan found moved, without a GPU cut (`rootWorldsMoved`). */
    worldsScanned: new Int32Array(8),
    gpuWanted,
    /** The visibility rows, as the table stands: it grows in place (`growTables.ts`), so every
     *  reader of the table's size reads it here, at each use. */
    get drawSlots() {
      return rows.blendFirst
    },
    rows,
    /** The rows the scene asked when one binding of the device held fewer, else null. */
    pageTableBound: bounded,
    /** The growth under way — the tables', the layers', an atlas lane's —, which the next one
     *  waits for (`growthQueue.ts`). */
    growing: undefined as Promise<unknown> | undefined,
    ...rowScratch(drawSlots, pageBytes),
  }
}

/** The per-row scratch arrays of a table of `drawSlots` visibility rows, and the witnesses of what
 *  the GPU holds of them: made anew when the table grows (`growTables.ts`), they then send every
 *  row again, once. */
export function rowScratch(drawSlots: number, pageBytes: number) {
  return {
    /** Every triangle of every drawable row: the bound a raster list cannot exceed. */
    rasterCapacity: drawSlots * workgroupCount(pageBytes / 4, 3),
    /** The drawable rank the partition holds an occlusion history for (`forgetRewrittenRows`). */
    cornerHold: createCornerHold(),
    /** Draw rows, held from one image to the next: only a changing row rewrites them. */
    drawItemWords: new Uint32Array(drawSlots * DRAW_ITEM_U32),
    itemWordsHold: createDrawItemWordsHold(drawSlots),
  }
}
