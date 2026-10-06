import { deformationSlotBytes } from '../../../deformation/slotLayout.ts'
import type { MatrixElements } from '../../../math/matrixElements.ts'
import type { BlendCopy } from '../../../cluster/blendCopyContract.ts'
import { createBlendCopyRecord } from '../../../cluster/blendCopyRecord.ts'
import { indexSourceBytes } from '../io/catalogue.ts'
import { describePageSlots, pageAddress } from '../../row/pageSlots.ts'
import { pageHomes } from '../../../gpu/page/homes.ts'
import type { BackendContext } from '../../../backend/types.ts'
import type { createWebgpuDiagnostics } from '../io/diagnostics.ts'
import { createWebgpuPageTracking } from '../../row/pageTracking.ts'
import {
  collectClusterPages,
  indexPagesByUrl,
  RequestStamps,
  rootCoverage,
} from '../../../page/selection/selection.ts'
import { createBlendScene } from '../../../cluster/blendSceneRecord.ts'
import { createHostRankDelta } from '../../../streaming/hostRanks.ts'
import { RASTER_BACKGROUND } from '../../../page/raster.ts'
import { DEFAULT_TEXTURE_POOL_BUDGET } from '../../../residency/pools.ts'
import type { TexturePools } from '../../residency/memoryBudgets.ts'
import { textureTransferBytesFor, textureUploadMsFor } from '../../../residency/transferBudgets.ts'
import { sessionGeometryPool } from '../../../residency/sessionPool.ts'
import { floorDiagnostic, rootChildren } from '../../../residency/minimumCapacity.ts'
import { DEFAULT_PIXEL_RATIO } from '../../../backend/common.ts'
export type WebgpuDiagnostics = ReturnType<typeof createWebgpuDiagnostics> & {
  traceEnabled: boolean
}
export type WebgpuPagesSetup = ReturnType<typeof createWebgpuPagesSetup>

/** Everything the backend derives once from the host context: the page catalogue, its bootstrap
 *  cover, the request index, the slot budget and the scene the forward copies live in. */
export function createWebgpuPagesSetup(context: BackendContext, diag: WebgpuDiagnostics) {
  const { source, metadata, indices, associations, maxResidentPages, gpuDevice } = context
  const viewport = context.viewport ?? [1, 1]
  const pixelRatio = context.pixelRatio ?? (() => DEFAULT_PIXEL_RATIO)
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
  const { roots, allPages, blendCopies, requestCount, worlds } = collectClusterPages(
    source,
    metadata,
    indices,
    associations,
    { allowMissing: true },
  )
  const sharedBlendMeshes = blendCopies.length
  // Transparent pages share selection/residency with opaque pages, but retain one forward draw
  // per placement (all back faces, then all front faces), keyed by the world of the root that
  // places its pages: the source mesh's own, or one row of its instance buffer.
  const pagedBlendCopies = new Map<MatrixElements, BlendCopy>()
  for (const { world, placement, pages } of roots) {
    const rec = pages[0]
    if (!rec?.transparent || !rec.sourceMesh || pagedBlendCopies.has(world)) continue
    const copy = createBlendCopyRecord(
      rec.sourceMesh,
      rec.renderOrder,
      world,
      rec.material,
      placement,
    )
    copy.userData.pagedBlend = true
    // The compiler writes a geometry page for every cluster of a primitive, or for none.
    copy.userData.pageGeometry = !!rec.geometryPage
    pagedBlendCopies.set(world, copy)
    blendCopies.push(copy)
  }
  blendCopies.sort((a, b) => a.renderOrder - b.renderOrder)
  // Request rank → address, posted once for the scene's life: the delta the host receives after the
  // render carries only integers, and it is this table that translates them.
  const requestUrls: string[] = new Array<string>(requestCount)
  for (let i = 0; i < allPages.length; i++) {
    const rec = allPages[i],
      rank = rec.requestIndex
    if (rank !== undefined && rank >= 0 && rank < requestCount)
      requestUrls[rank] = rec.streamUrl ?? rec.url
  }
  const tracking = createWebgpuPageTracking(allPages)
  diag.traceDiagnostic('page-catalog', 'Stable WebGPU page catalogue', {
    backend: 'webgpu-page-raster',
    count: tracking.pageCatalog.length,
    urls: tracking.pageCatalog,
  })
  const bootstrap = rootCoverage(roots, pageAddress),
    bootstrapUrls = new Set(bootstrap.map(pageAddress))
  // The pool's floor: the root cover and the pages its groups replace (`minimumCapacity.ts`).
  const floorPages = new Set([...bootstrapUrls, ...rootChildren(roots).map(pageAddress)]).size
  const bootstrapKeys = new Int32Array(bootstrap.length),
    bootstrapKey = new Uint8Array(tracking.keyCount)
  for (let i = 0; i < bootstrap.length; i++) {
    bootstrapKeys[i] = tracking.keyOf(bootstrap[i])
    bootstrapKey[bootstrapKeys[i]] = 1
  }
  // `byUrl` is indexed by REQUEST key: the streaming bundle when the cache publishes one, the cluster
  // object otherwise. One request therefore hands bytes to every cluster that shares it. The GPU page
  // cache stays keyed by pool address (`pageAddress`), the granularity it uploads and pins.
  const byUrl = indexPagesByUrl(allPages)
  const uniquePages = Math.max(1, new Set(allPages.map(pageAddress)).size)
  const scene = createBlendScene(clearColor, blendCopies)
  // What a pool slot holds, how wide it is, and the corner count every page draw is bounded by.
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
    backend: 'webgpu-page-raster',
    clusters: allPages.length,
    ...clusterSides,
    sharedBlendMeshes,
    slotBytes: pageBytes,
    homeBytes: homes?.bytes ?? null,
    drawCorners: maxCorners,
  })
  diag.engineDiagnostic(...floorDiagnostic(bootstrapUrls.size, floorPages))
  const sourceBytes = indexSourceBytes(allPages)
  // The engine's two fixed pools, in bytes: what does not fit renders coarser.
  // Image targets, themselves, follow resolution with no ceiling. Tables sized by drawable page start
  // at the ceiling the host names for the pool, and grow in place past it (`growTables.ts`).
  const geometry = sessionGeometryPool(
    {
      pageBytes,
      uniquePages,
      homeBytes: homes?.bytes,
      rootPages: floorPages,
      maxResidentPages,
      limits: gpuDevice?.limits,
    },
    context.geometryPoolBytes,
    context.geometryPoolCeilingBytes,
    true,
  )
  const texturePoolBudget = context.texturePoolBytes ?? DEFAULT_TEXTURE_POOL_BUDGET
  // The tile pass's two budgets: bytes, and a fixed upload cadence in the frame's own unit.
  const textureBudget = textureTransferBytesFor(context.maxTextureTransferBytesPerFrame)
  const textureUploadMs = textureUploadMsFor(context.maxTextureUploadMsPerFrame)
  return {
    source,
    // Index of the engine's world matrices: what the image walks, and what a moved node recomputes.
    // Rows, roots and transparent copies carry the matrices.
    worlds,
    viewport,
    pixelRatio,
    roots,
    allPages,
    blendCopies,
    pagedBlendCopies,
    tracking,
    bootstrap,
    bootstrapUrls,
    bootstrapKeys,
    bootstrapKey,
    byUrl,
    // Dedup of request keys without a hash table, shared by the two lists the host asks after the
    // render: their rank is posted once and for all by the catalogue.
    requestStamps: new RequestStamps(requestCount),
    requestUrls,
    // What the host pins, held from one image to the next and published as a rank delta.
    hostRanks: createHostRankDelta(requestCount, requestUrls),
    // The slots the tables sized by drawable page are sized for: the ceiling the host named, then
    // each larger pool they grew for (`growTables.ts`).
    cap: geometry.ceilingSlots,
    scene,
    pageBytes,
    homes,
    // Largest corner count of the catalogue: the ceiling of every page draw and of the compute
    // raster's triangle budget.
    maxCorners,
    sourceBytes,
    // Geometry page url of every cluster drawn from one, by cluster address: what the pool reads
    // for that slot. A cluster absent from this table is uploaded from `sourceBytes`.
    geometryUrls,
    textureBudget,
    textureUploadMs,
    // The two pools as they are held; `setMemoryBudgets` replaces them with another drawn from the
    // same rule, `slots` follows.
    geometryPool: geometry.pool,
    // The same pool for another budget: above `cap`, the tables grow first (`io/memory.ts`).
    geometryPoolFor: geometry.poolFor,
    texturePoolBudget,
    /** The family, the encoding and the lane pools, set by prepare; `setMemoryBudgets` redraws. */
    texturePools: undefined as TexturePools | undefined,
    /** Prepare, while it runs: a report of `setMemoryBudgets` waits for it (`pages.ts`). */
    preparing: undefined as Promise<void> | undefined,
    get slots() {
      return this.geometryPool.slots
    },
  }
}
