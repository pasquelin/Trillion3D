import type { PageRec } from '../../page/selection/selection.ts'
import { createWebgpuResidencySets } from '../residency/sets.ts'
import { createLowerTier } from '../residency/lowerTier.ts'
import { createGroupClosure } from '../../page/cut/groupClosure.ts'
import { createImageRelevance } from '../residency/imageRelevance.ts'
import { createWebgpuCutPublication } from '../cut/publication.ts'
import { createPageSource } from './readPage.ts'
import { awaitsPageBytes, pageAddress } from '../row/pageSlots.ts'
import type { WebgpuPagesCore } from './runtime.ts'
import { createBootstrapFor, createResidencyFor, createRowSyncFor } from './serviceParts.ts'
import { coverHeldRoots } from './prepare/worldRoot.ts'

export type WebgpuPagesServices = ReturnType<typeof createWebgpuPagesServices>

/** The residency machinery: the row table sync, the bootstrap cover, the pin updater, the upload
 *  queue and the GPU cut adopter. Each reads the runtime lazily, so none holds a stale frame. */
export function createWebgpuPagesServices(rt: WebgpuPagesCore) {
  const { gpu } = rt,
    { packedPages, placement } = rt.layout,
    { tracking, bootstrapUrls, bootstrapKey, sourceBytes } = rt.setup
  /** The groups a cut's pages close over: what the cache must hold for the cut rule to draw them. */
  const closure = createGroupClosure(rt.layout.selectionRoots, placement, packedPages)
  const rowSync = createRowSyncFor(rt, closure)
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
    bootstrapUrls,
  })
  const bootstrapState = createBootstrapFor(rt, hasBytes)
  const room = () => Math.max(0, rt.setup.slots - bootstrapUrls.size)
  // The lower tier: the pages ahead of the camera.
  const aheadTier = createLowerTier({ keyOf: tracking.keyOf, room, closeOver: closure.closeOver }),
    lowerTiers = [aheadTier]
  /** Whether an arrival can change the image; the held frame survives one that cannot. */
  const affectsImage = createImageRelevance({
    tracking,
    bootstrapKey,
    requests: residencySets.requests,
  })
  // The roots the world's held cells add to the cover, followed for the backend's life.
  coverHeldRoots(rt, residencySets, room)
  const parts = { residencySets, closure, hasBytes, lowerTiers, room }
  const { ensureResident, residency } = createResidencyFor(rt, parts)
  const tiers = { all: lowerTiers, ahead: aheadTier }
  const publication = createWebgpuCutPublication(rt, residencySets, closure, tiers)
  const { syncRows, followCut, rowsOwed, blendCasters } = rowSync
  return {
    syncRows,
    followCut,
    rowsOwed,
    blendCasters,
    /** Asks the cache for what the views' cuts want, ranked by the GPU when the pool is short. */
    queueCutResidency: () => residency.queueCuts(publication.viewReadbacks()),
    pageSource,
    hasBytes,
    poolHolds,
    residencySets,
    bootstrapState,
    ensureResident,
    residency,
    affectsImage,
    ...publication,
    hostTableBytes: () => publication.hostTableBytes() + residency.hostBytes + rowSync.cacheBytes, // + admission, rows
  }
}
