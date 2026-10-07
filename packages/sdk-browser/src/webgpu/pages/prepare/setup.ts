import { deformationSlotBytes } from '../../../deformation/slotLayout.ts'
import { indexSourceBytes } from '../io/catalogue.ts'
import { describePageSlots, pageAddress } from '../../row/pageSlots.ts'
import { pageHomes } from '../../../gpu/page/homes.ts'
import type { EngineContext } from '../../../engine/types.ts'
import type { createWebgpuDiagnostics } from '../io/diagnostics.ts'
import { RequestStamps } from '../../../page/selection/selection.ts'
import { createBlendScene } from '../../../cluster/blendSceneRecord.ts'
import { createHostRankDelta } from '../../../streaming/hostRanks.ts'
import { RASTER_BACKGROUND } from '../../../page/raster.ts'
import { DEFAULT_TEXTURE_POOL_BUDGET } from '../../../residency/pools.ts'
import type { TexturePools } from '../../residency/memoryBudgets.ts'
import { textureTransferBytesFor, textureUploadMsFor } from '../../../residency/transferBudgets.ts'
import { sessionGeometryPool } from '../../../residency/sessionPool.ts'
import { floorDiagnostic } from '../../../residency/minimumCapacity.ts'
import { DEFAULT_PIXEL_RATIO } from '../../../engine/common.ts'
import { bootstrapFields, setupPages } from './setupCatalogue.ts'
export type WebgpuDiagnostics = ReturnType<typeof createWebgpuDiagnostics> & {
  traceEnabled: boolean
}
export type WebgpuPagesSetup = ReturnType<typeof createWebgpuPagesSetup>

/** Everything the engine derives once from the session's context: the page catalogue, its
 *  bootstrap cover, the request index, the slot budget and the scene the forward copies live in. */
export function createWebgpuPagesSetup(context: EngineContext, diag: WebgpuDiagnostics) {
  const clearColor = announceClearColor(context, diag)
  const pages = setupPages(context, diag)
  const { requestCount, requestUrls, blendCopies } = pages
  const slots = setupSlots(context, diag, pages)
  const { geometry } = slots
  return {
    source: context.source,
    // Index of the engine's world matrices: what the image walks, and what a moved node recomputes.
    // Rows, roots and transparent copies carry the matrices.
    worlds: pages.worlds,
    viewport: context.viewport ?? [1, 1],
    pixelRatio: context.pixelRatio ?? (() => DEFAULT_PIXEL_RATIO),
    roots: pages.roots,
    allPages: pages.allPages,
    blendCopies,
    pagedBlendCopies: pages.pagedBlendCopies,
    ...bootstrapFields(pages),
    // Dedup of request keys without a hash table, shared by the two lists the host asks after the
    // render: their rank is posted once and for all by the catalogue.
    requestStamps: new RequestStamps(requestCount),
    requestUrls,
    // What the host pins, held from one image to the next and published as a rank delta.
    hostRanks: createHostRankDelta(requestCount, requestUrls),
    // The slots the tables sized by drawable page are sized for: the starting pool's, then each
    // larger pool they grew for (`growTables.ts`).
    cap: geometry.pool.slots,
    scene: createBlendScene(clearColor, blendCopies),
    ...slotFields(slots, context),
    // The two pools as they are held; `setMemoryBudgets` replaces them with another drawn from the
    // same rule, `slots` follows.
    geometryPool: geometry.pool,
    // The same pool for another budget: above `cap`, the tables grow first (`io/memory.ts`).
    geometryPoolFor: geometry.poolFor,
    texturePoolBudget: context.texturePoolBytes ?? DEFAULT_TEXTURE_POOL_BUDGET,
    /** The family, the encoding and the lane pools, set by prepare; `setMemoryBudgets` redraws. */
    texturePools: undefined as TexturePools | undefined,
    /** Prepare, while it runs: a report of `setMemoryBudgets` waits for it (`pages.ts`). */
    preparing: undefined as Promise<void> | undefined,
    get slots(): number {
      return this.geometryPool.slots
    },
  }
}

/** The background colour received, said out loud. */
function announceClearColor(context: EngineContext, diag: WebgpuDiagnostics) {
  const clearColor = context.clearColor ?? RASTER_BACKGROUND
  const inputColor = {
    clearColor: `#${clearColor.toString(16).padStart(6, '0')}`,
    value: clearColor,
    source: context.clearColor === undefined ? 'engine fallback' : 'host',
  }
  diag.engineDiagnostic(
    'clear-color-input',
    'Background colour received by Trillion3D WebGPU',
    inputColor,
  )
  return clearColor
}

/** What a pool slot holds, how wide it is, the corner count every page draw is bounded by, and
 *  the engine's two fixed pools. */
function setupSlots(
  context: EngineContext,
  diag: WebgpuDiagnostics,
  pages: ReturnType<typeof setupPages>,
) {
  const { allPages, roots, floorPages, bootstrapUrls } = pages
  const uniquePages = Math.max(1, new Set(allPages.map(pageAddress)).size)
  const {
    geometryUrls,
    pageBytes: sourcePageBytes,
    homes: widths,
    maxCorners,
    ...clusterSides
  } = describePageSlots(allPages)
  const pageBytes = deformationSlotBytes(allPages, sourcePageBytes, roots, widths)
  // Each page at its own width while the pool holds the whole catalogue (`gpu/page/homes.ts`).
  const homes = pageHomes(widths)
  // Said out loud, never silently: an opaque or masked cluster the cache gave no geometry page
  // still draws from the source float buffers, and that is what those bytes are there for.
  diag.engineDiagnostic('geometry-pages', 'Clusters drawn from their quantized page', {
    clusters: allPages.length,
    ...clusterSides,
    sharedBlendMeshes: pages.sharedBlendMeshes,
    slotBytes: pageBytes,
    homeBytes: homes?.bytes ?? null,
    drawCorners: maxCorners,
  })
  diag.engineDiagnostic(...floorDiagnostic(bootstrapUrls.size, floorPages))
  const sourceBytes = indexSourceBytes(allPages)
  // The engine's two fixed pools, in bytes: what does not fit renders coarser.
  // Image targets, themselves, follow resolution with no ceiling. Tables sized by drawable page start
  // at the pool, and grow in place past it (`growTables.ts`).
  const { maxResidentPages, gpuDevice } = context
  const limits = gpuDevice?.limits,
    homeBytes = homes?.bytes
  const geometry = sessionGeometryPool(
    { pageBytes, uniquePages, homeBytes, rootPages: floorPages, maxResidentPages, limits },
    context.geometryPoolBytes,
  )
  return { geometryUrls, pageBytes, homes, maxCorners, sourceBytes, geometry }
}

/** The setup's fields of the page slots and the transfer budgets. */
function slotFields(slots: ReturnType<typeof setupSlots>, context: EngineContext) {
  return {
    pageBytes: slots.pageBytes,
    homes: slots.homes,
    // Largest corner count of the catalogue: the ceiling of every page draw and of the compute
    // raster's triangle budget.
    maxCorners: slots.maxCorners,
    sourceBytes: slots.sourceBytes,
    // Geometry page url of every cluster drawn from one, by cluster address: what the pool reads
    // for that slot. A cluster absent from this table is uploaded from `sourceBytes`.
    geometryUrls: slots.geometryUrls,
    // The tile pass's two budgets: bytes, and a fixed upload cadence in the frame's own unit.
    textureBudget: textureTransferBytesFor(context.maxTextureTransferBytesPerFrame),
    textureUploadMs: textureUploadMsFor(context.maxTextureUploadMsPerFrame),
  }
}
