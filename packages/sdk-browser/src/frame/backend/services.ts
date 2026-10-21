import type { PageRec } from '../../geometry/selection/types.ts'
import { createWebgpuResidencySets } from '../../geometry/residency/sets.ts'
import { createGroupClosure } from '../../geometry/cut/groupClosure.ts'
import { createImageRelevance } from '../../geometry/residency/imageRelevance.ts'
import { createWebgpuCutPublication } from '../../geometry/cut/adoption/publication.ts'
import { createPageSource } from './readPage.ts'
import { awaitsPageBytes, pageAddress } from '../../geometry/rows/page/pageSlots.ts'
import type { WebgpuPagesCore } from './runtime.ts'
import { createBootstrapFor, createResidencyFor, createRowSyncFor } from './serviceParts.ts'
import { coverHeldRoots } from '../prepare/worldRoot.ts'

export type WebgpuPagesServices = ReturnType<typeof createWebgpuPagesServices>

/** The residency machinery: the row table sync, the bootstrap cover, the pin updater, the
 *  streaming of the geometry pool and the GPU cut adopter. Each reads the runtime lazily, so none
 *  holds a stale frame. */
export function createWebgpuPagesServices(rt: WebgpuPagesCore) {
  const { gpu } = rt,
    { packedPages, placement } = rt.layout,
    { tracking, bootstrapKey, sourceBytes } = rt.setup
  /** The groups a cut's pages close over: what the cache must hold for the cut rule to draw them. */
  const closure = createGroupClosure(rt.layout.selectionRoots, placement, packedPages)
  const rowSync = createRowSyncFor(rt)
  const pageSource = createPageSource(rt)
  // A cluster drawn from its quantized page needs no index page: its slot is filled from the page
  // reader above. Only a cluster that still draws from an index buffer waits for one.
  const hasBytes = (rec: PageRec) => !awaitsPageBytes(rec) || sourceBytes.has(pageAddress(rec))
  /** True while the pool holds the slot this cluster draws from, at its own address. */
  const poolHolds = (rec: PageRec) => !!gpu.cache?.get(pageAddress(rec))
  /** The residency sets: an image that moves no page touches them not. */
  const residencySets = createWebgpuResidencySets({
    tracking,
    bootstrapKey,
    packedPages,
  })
  const bootstrapState = createBootstrapFor(rt, hasBytes)
  /** The streaming pool's pages: the pool's slots past its root region's grains, or past the root
   *  cover it holds now where it takes more (a pool holding the catalogue, no grain apart). */
  const streamingSlots = () => {
    const grains = rt.setup.geometryPool.roots.slots
    return Math.max(0, rt.setup.slots - Math.max(grains, residencySets.coverSlots))
  }
  /** Whether an arrival can change the image; the held frame survives one that cannot. */
  const affectsImage = createImageRelevance({
    tracking,
    bootstrapKey,
    requests: residencySets.requests,
    pinned: (key) => !!rt.gpu.cache?.isPinned(tracking.pageCatalog[key]),
  })
  // The roots the world's held cells add to the cover, followed for the backend's life.
  coverHeldRoots(rt, residencySets)
  const residency = createResidencyFor(rt, { residencySets, closure, hasBytes, streamingSlots })
  const publication = createWebgpuCutPublication(rt, residencySets, closure)
  const { syncRows, followCut, rowsOwed, blendCasters, rowWords, followRowOrder } = rowSync
  return {
    syncRows,
    followCut,
    rowsOwed,
    blendCasters,
    /** The rows' use words the GPU stamps (`../../geometry/rows/rowWords.ts`), and the queues of their victims
     *  the readbacks bring (`../../geometry/rows/rowOrder.ts`). */
    rowWords,
    followRowOrder,
    /** The frame's streaming update over the views' readbacks (`../../geometry/residency/queue.ts`). */
    queueCutResidency: () => residency.queueCuts(publication.viewReadbacks()),
    pageSource,
    hasBytes,
    poolHolds,
    residencySets,
    bootstrapState,
    residency,
    affectsImage,
    ...publication,
    // The publication's tables (the residency sets and the pages streamed among them), the
    // streaming's requests, then the rows'.
    hostTableBytes: () => publication.hostTableBytes() + residency.hostBytes + rowSync.cacheBytes,
  }
}
