import type { DeformationOutput } from '../../geometry/selection/types.ts'
import { indexSourceBytes } from '../io/catalogue.ts'
import { describePageSlots } from '../../geometry/rows/page/pageSlots.ts'
import { rootRegionOf } from './rootCover.ts'
import { pageHomes } from '../../geometry/pages/pool/homes.ts'
import type { EngineContext } from '../../session/engine/types.ts'
import type { WebgpuDiagnosticChannel } from '../io/diagnostics.ts'
import { RequestStamps } from '../../geometry/selection/requests.ts'
import { createHostRankDelta } from '../../geometry/streaming/hostRanks.ts'
import { RASTER_BACKGROUND } from '../../geometry/pages/raster.ts'
import { DEFAULT_TEXTURE_POOL_BUDGET } from '../../../../sdk-core/src/contracts/poolBudgets.ts'
import type { TexturePools } from '../../geometry/residency/memoryBudgets.ts'
import {
  textureTransferBytesFor,
  textureUploadMsFor,
} from '../../session/memory/transferBudgets.ts'
import { sessionGeometryPool } from '../../session/memory/sessionPool.ts'
import { DEFAULT_PIXEL_RATIO } from '../../session/engine/common.ts'
import { bootstrapFields, setupPages } from './setupCatalogue.ts'
import { DAG_CLUSTER_TRIANGLES } from '../../../../sdk-core/src/page/format.ts'
import { clippingFor } from '../../gpu/core/clipDistances.ts'
import { VOLUMETRIC_FOG_RULES } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { SHADOW_RULES } from '../../../../sdk-core/src/contracts/shadowOptions.ts'
import { REFLECTION_RULES } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { readSetting } from '../../../../sdk-core/src/contracts/settingRules.ts'

/** The corners of the widest cluster the format holds. */
const CLUSTER_MAX_CORNERS = 3 * DAG_CLUSTER_TRIANGLES
export type WebgpuDiagnostics = WebgpuDiagnosticChannel & {
  traceEnabled: boolean
}
export type WebgpuPagesSetup = ReturnType<typeof createWebgpuPagesSetup>

/** The project switches the session reads once, here: its programs are made with them. */
function projectSwitches(context: EngineContext) {
  return {
    /** How every program of the session cuts at a view's clip plane, none while the project switch
     *  `cutClipPlane` is off: read once, here, as the reference's read-only switch is
     *  (`../../gpu/core/clipDistances.ts`). */
    clipping: clippingFor(context),
    /** Whether every program that lays the fog holds the local fog volumes' code, the project switch
     *  `localFogVolumeSupport` (on by default): read once, here, as `clipping` is; off, no program holds
     *  any of it and no pass, buffer or block is made for the volumes (`../render/encodeLocalFog.ts`). */
    localFog: readSetting(VOLUMETRIC_FOG_RULES, context, 'localFogVolumeSupport'),
    /** How the translucent surfaces read a light's shadow, the project switches
     *  `shadowTranslucentQuality` (0, one sample) and `shadowTranslucentLocalLights` (off, the sun's
     *  shadow alone): read once, here, as `localFog` is; the translucent programs are made with them
     *  (`../../blend/pipelines.ts`). */
    translucentShadow: {
      quality: readSetting(SHADOW_RULES, context, 'shadowTranslucentQuality'),
      localShadows: readSetting(SHADOW_RULES, context, 'shadowTranslucentLocalLights'),
      /** The classic shadow maps (`shadowVirtualEnable` off): the translucent surfaces read every light by the classic filter, as the opaque ones' projection does. */
      classic: !readSetting(SHADOW_RULES, context, 'shadowVirtualEnable'),
    },
    /** Whether the reflections' trace counts its rays, the project switch `reflectionStatistics` (off): read once, here, as
     *  `translucentShadow` is, for the trace's kernels are compiled with the counting or without it
     *  (`../../lighting/reflections/reflectionPipelines.ts`). */
    reflectionStatistics: readSetting(REFLECTION_RULES, context, 'reflectionStatistics'),
    /** Whether the translucent surfaces light a rectangle light as a rectangle, the project switch
     *  `translucentRectLights` (off, a point light at its centre): read once, here, as
     *  `translucentShadow` is (`../../blend/pipelines.ts`). */
    translucentRectLights: readSetting(SHADOW_RULES, context, 'translucentRectLights'),
  }
}

/** Everything the engine derives once from the session's context: the page catalogue, its
 *  bootstrap cover, the request index and the slot budget. */
export function createWebgpuPagesSetup(context: EngineContext, diag: WebgpuDiagnostics) {
  announceClearColor(context, diag)
  const pages = setupPages(context, diag)
  const { requests, requestUrls, blendCopies } = pages
  const slots = setupSlots(context, diag, pages)
  const { geometry } = slots
  return {
    source: context.source,
    draws: context.draws,
    // Index of the engine's world matrices: what the image walks, and what a moved node recomputes.
    // Rows, roots and transparent copies carry the matrices.
    worlds: pages.worlds,
    viewport: context.viewport ?? [1, 1],
    ...projectSwitches(context),
    pixelRatio: context.pixelRatio ?? (() => DEFAULT_PIXEL_RATIO),
    roots: pages.roots,
    /** What collected the roots, which collects a source added later (`addPlacements`). */
    collector: pages.collector,
    allPages: pages.allPages,
    /** The blocks of floats the deformation writes its results in, in the float pool's tail: one a
     *  deformed page of a placement (`assignDeformationOutputs`). */
    deformationBlocks: [] as DeformationOutput[],
    blendCopies,
    pagedBlendCopies: pages.pagedBlendCopies,
    ...bootstrapFields(pages),
    // Dedup of request keys without a hash table, shared by the two lists the host asks after the
    // render: their rank is posted once and for all by the catalogue.
    requestStamps: new RequestStamps(requestUrls.length),
    requestUrls,
    /** Rank of each request key, which a source added later is ranked on (`growCatalogue`). */
    requests,
    // What the host pins, held from one image to the next and published as a rank delta.
    hostRanks: createHostRankDelta(requestUrls.length, requestUrls),
    ...slotFields(slots, context),
    // The two pools as they are held; `setMemoryBudgets` replaces them with another drawn from the
    // same rule, `slots` follows.
    geometryPool: geometry.pool,
    // The same pool for another budget (`io/memory.ts`).
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
}

/** What a pool slot holds, how wide it is, the corner count every page draw is bounded by, and
 *  the engine's two fixed pools. */
function setupSlots(
  context: EngineContext,
  diag: WebgpuDiagnostics,
  pages: ReturnType<typeof setupPages>,
) {
  const { allPages, coverUrls, rootUrls } = pages
  const census = describePageSlots(allPages)
  const { geometryUrls, pageBytes, maxCorners, unitWidths, unitPages } = census
  const { fromGeometryPage, fromSourceGeometry, transparentClusters } = census
  const clusterSides = { fromGeometryPage, fromSourceGeometry, transparentClusters, unitPages }
  // A slot holds a streaming page (`geometry/rows/page/pageSlots.ts`, `pageUnit`), each at its own
  // width while the pool holds the whole catalogue (`geometry/pages/pool/homes.ts`).
  const uniquePages = Math.max(1, unitWidths.size)
  const homes = pageHomes(unitWidths)
  // Said out loud, never silently: an opaque or masked cluster the cache gave no geometry page
  // still draws from the source float buffers, and that is what those bytes are there for.
  diag.engineDiagnostic('geometry-pages', 'Clusters drawn from their quantized page', {
    clusters: allPages.length,
    ...clusterSides,
    slotBytes: pageBytes,
    homeBytes: homes?.bytes ?? null,
    drawCorners: maxCorners,
  })
  const sourceBytes = indexSourceBytes(allPages)
  // The engine's two fixed pools, in bytes: what does not fit renders coarser, the root pages held
  // beside the geometry pool's streaming slots, in the grains of its root region, which grows as
  // HLOD cells hold theirs (`rootRegionOf`). Image targets, themselves, follow resolution with no
  // ceiling.
  const { maxResidentPages, gpuDevice } = context
  const limits = gpuDevice?.limits,
    homeBytes = homes?.bytes,
    rootRegion = rootRegionOf(census, coverUrls, rootUrls)
  const geometry = sessionGeometryPool(
    {
      ...{ pageBytes, uniquePages, homeBytes, maxResidentPages, limits },
      ...{ rootPages: rootRegion.least, rootBytes: rootRegion.bytes },
    },
    context.geometryPoolBytes,
  )
  return {
    ...{ census, geometryUrls, pageBytes, homes, sourceBytes, geometry, rootRegion },
    maxCorners: Math.max(maxCorners, CLUSTER_MAX_CORNERS),
  }
}

/** The setup's fields of the page slots and the transfer budgets. */
function slotFields(slots: ReturnType<typeof setupSlots>, context: EngineContext) {
  return {
    pageBytes: slots.pageBytes,
    homes: slots.homes,
    /** What the pages described so far weigh, which pages joining the session add to. */
    census: slots.census,
    /** The catalogue the geometry pool is drawn for, read at each draw (`sessionGeometryPool`). */
    geometryShape: slots.geometry.shape,
    /** The root region the catalogue asks (`rootRegionOf`), and its growth while one runs
     *  (`../io/memory.ts`, `growWebgpuRootRegion`). */
    rootRegion: slots.rootRegion,
    rootGrowth: undefined as Promise<void> | undefined,
    // The ceiling of every page draw: the widest cluster the format holds, whatever the
    // catalogue, so a page joining the session later fits.
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
