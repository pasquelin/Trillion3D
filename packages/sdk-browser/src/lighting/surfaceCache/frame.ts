import { clamp } from '../../../../math/src/scalar/reals.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import {
  GLOBAL_DISTANCE_FIELD_RULES,
  type GlobalDistanceFieldSettings,
} from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { resolveSettingsInto } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { SurfaceCacheSettings } from '../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import { resolveSurfaceCacheSettings } from '../../../../sdk-core/src/lighting/surfaceCache/levelSettings.ts'
import type { SurfaceCacheFrameMetrics } from '../../../../sdk-core/src/contracts/surfaceCacheMetrics.ts'
import {
  clipmapExtent,
  numClipmaps,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import {
  atlasPages,
  captureAtlasPages,
} from '../../../../sdk-core/src/lighting/surfaceCache/pageAllocator.ts'
import { PAGE_SIZE } from '../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import {
  cardPageView,
  type CardView,
} from '../../../../sdk-core/src/lighting/surfaceCache/cardViews.ts'
import type { CapturePage } from '../../../../sdk-core/src/lighting/surfaceCache/captures.ts'
import { maxCapturesPerFrame } from '../../../../sdk-core/src/lighting/surfaceCache/requests.ts'
import { confirmPages } from '../../../../sdk-core/src/lighting/surfaceCache/virtualSurface.ts'
import {
  advanceFrame,
  updateSurfaceCache,
} from '../../../../sdk-core/src/lighting/surfaceCache/update.ts'
import {
  createSurfaceCache,
  type SurfaceCache,
} from '../../../../sdk-core/src/lighting/surfaceCache/state.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { SURFACE_CACHE_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { EngineContext } from '../../session/engine/types.ts'
import { budgetRefused } from '../../gpu/core/deviceLedger.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { cachedLightingPreExposureOf } from '../../post/exposure/frame.ts'
import { createNoFieldRead } from '../distanceField/view.ts'
import { screenProbeSettingsOf } from '../bounce/screen/settingsOf.ts'
import { createHitCards } from '../reflections/hitCards.ts'
import { ensureSurfaceAtlases, type SurfaceAtlases } from './atlases.ts'
import { cardShadingBytes, createCardShading, type CardShading } from './capture/shade.ts'
import type { CardRaster } from './capture/raster.ts'
import { MOST_VIEWS, cardRasterBytes, createCardRaster } from './capture/cardRaster.ts'
import { atlasCompression } from './compress.ts'
import { createCaptureKernels, type CaptureKernels, type CaptureSettings } from './copy.ts'
import { createAtlasViewer, type AtlasViewer } from './debug.ts'
import { ATLAS_VIEWS } from './debugWgsl.ts'
import { createSurfaceFeedback, type SurfaceFeedback } from './feedbackBuffer.ts'
import { disposeSurfaceLighting, type SurfaceLightingState } from './lighting/surfaceLighting.ts'
import { cacheRootsOf, createCardPlacements, type CardPlacements } from './placements.ts'
import type { SurfaceHitReads } from './hitWgsl.ts'
import { createSurfaceTables, type SurfaceTables } from './tables.ts'

/**
 * THE SURFACE CACHE IN THE FRAME. A session whose cache carries the meshes' cards
 * (`EngineContext.meshCards`) holds the cache's state once something asks for it: a diagnostic view of
 * the atlas (`surface-cache-…`), or a pass that reads it (`demandSurfaceCache`, once an image, before
 * the image's lighting). Nothing is made, and nothing run, for a scene nobody reads the cache of.
 *
 * Each image of the main view, in the order of the passes: the placements follow the cut's roots
 * (`placements.ts`); the atlases are made at the size the settings ask, where the device's budget leaves
 * room (`atlases.ts`); the cache updates for the camera — which placements have mesh cards, which
 * pages of which cards are captured —; the pages that copy another card's texels are filled, and the
 * light each captured page's card held is carried into the capture atlas, from the tables as they were
 * (`copy.ts`, its resample stage); what the update changed then goes to the GPU's tables (`tables.ts`);
 * the pages it captures are drawn by the raster of the cards' views (`capture/cardRaster.ts`) — every
 * page of the image, up to the captures an image is budgeted —, shaded (`capture/shade.ts`), resolved
 * to the cards' encodings, copied into the atlas and given the light they start with (`copy.ts`), in one
 * compute pass; a compressed atlas has its blocks copied in after it (`compress.ts`). A page the image did not
 * draw stays pending (`Page.pending`): a read finds none there and goes on to the page above, and the
 * page is asked again. The cache makes no mesh cards' page until the raster can draw the placement.
 *
 * The update clock (`advanceFrame`) advances at the end of the update, once an image; the lighting of the
 * cards' texels (`lighting/frame.ts`) follows in the image's lighting, after the lights are in their buffer, and reads it.
 *
 * The feedback of the rays that read the cards (`feedbackBuffer.ts`) comes back a few images late and is
 * given to the update (`UpdateView.feedback`), which asks the finer pages the rays would have read.
 */

/** What the frame keeps of the surface cache. */
export interface SurfaceCacheFrameState {
  /** The cache, and the placements that feed it: made again when the cache is released. */
  cache: SurfaceCache
  placements: CardPlacements
  /** What the placements are made of. */
  readonly source: Pick<EngineContext, 'meshCards'>
  readonly settings: SurfaceCacheSettings
  readonly tables: SurfaceTables
  /** The feedback of the rays that read the cards: their buffer, its compaction, its read-back (`feedbackBuffer.ts`). */
  readonly feedback: SurfaceFeedback
  /** What the rays that read the cache bind of it: its tables, layers, the field's object grid and the table of instances (`surfaceHitReads`). */
  readonly hit: ReturnType<typeof createHitCards>
  atlases?: SurfaceAtlases
  shading?: CardShading
  kernels?: CaptureKernels
  viewer?: AtlasViewer
  /** The raster of the cards' views. */
  readonly raster: CardRaster
  /** Whether a pass asked for the cache for the image to come (`demandSurfaceCache`). */
  demanded: boolean
  /** Whether the last image left requests unserved: the frame is not held while it has. */
  busy: boolean
  /** The last image's account, none while the cache is not made. */
  metrics: SurfaceCacheFrameMetrics | null
  /** Why the cache is off, none while it runs. */
  why: string | null
  /** Why the atlas does not keep its albedo, normal and emission in blocks, none while it does. */
  compressionWhy: string | null
  /** Whether the memory budget refused the capture's surfaces: they are not asked again until the atlases are made again. */
  refused: boolean
  readonly pass: LazyComputePass
  /** The settings of the global distance field, which say how far the cards are kept. */
  readonly field: GlobalDistanceFieldSettings
  /** Whether this image updated the cache: the lighting (`lighting/frame.ts`) follows it. */
  updated: boolean
  /** The lighting's own state (`lighting/surfaceLighting.ts`), made when it first lights. */
  lighting?: SurfaceLightingState
}

const origin: [number, number, number] = [0, 0, 0]
const cardViews: CardView[] = []
const drawnPages: CapturePage[] = []
/** The page-table indices an image confirms, reused. */
const confirmed: number[] = []
const NO_PAGES: ReadonlySet<CapturePage> = new Set()

function createState(rt: WebgpuPagesRuntime, device: GPUDevice): SurfaceCacheFrameState {
  const settings = resolveSurfaceCacheSettings(
    rt.context,
    screenProbeSettingsOf(rt).level,
    {} as SurfaceCacheSettings,
  )
  return {
    raster: createCardRaster(
      rt,
      device,
      (placement) => rt.surfaceCache?.placements.rankOf(placement, cacheRootsOf(rt)) ?? -1,
    ),
    cache: createSurfaceCache(settings),
    placements: createCardPlacements(rt.context.meshCards ?? []),
    source: { meshCards: rt.context.meshCards },
    settings,
    tables: createSurfaceTables(device),
    feedback: createSurfaceFeedback(device),
    hit: createHitCards(device),
    demanded: false,
    busy: false,
    metrics: null,
    why: null,
    compressionWhy: null,
    refused: false,
    pass: new LazyComputePass(SURFACE_CACHE_PASS),
    field: {} as GlobalDistanceFieldSettings,
    updated: false,
  }
}

/** The state of `rt`, made at the first image that asks for the cache, none for a session whose cache
 *  carries no cards. */
function stateOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!rt.context.meshCards?.length) return undefined
  return (rt.surfaceCache ??= createState(rt, device))
}

/** The state of `rt` as it stands, or made where the device is: what a call that is not the cache's own
 *  image asks. */
const stateOfSession = (rt: WebgpuPagesRuntime) =>
  rt.surfaceCache ?? (rt.gpu.device ? stateOf(rt, rt.gpu.device) : undefined)

/** What an image that captured nothing reports. */
const NO_WORK = { captured: 0, copied: 0, refreshed: 0, waiting: 0 } as const

/** The atlas view the diagnostic mode `mode` shows, by its code in `ATLAS_VIEWS`; none for any other. */
const atlasViewOf = (mode: string): number | undefined =>
  (ATLAS_VIEWS as Record<string, number | undefined>)[mode]

/** Asks for the surface cache for the image to come: a pass that reads it calls it each image, before
 *  the surface cache's own encode. A session with no cards in its cache makes none. */
export function demandSurfaceCache(rt: WebgpuPagesRuntime) {
  const state = stateOfSession(rt)
  if (state) state.demanded = true
}

/** What a ray that reads the cache binds where the session holds none: the stand-ins of a hit and the reads of a field it does not have. */
const hitStandIns = oncePerDevice((device: GPUDevice) => ({
  hit: createHitCards(device),
  field: createNoFieldRead(device),
}))

/**
 * What a pass whose rays read the cache's light at their hits binds (`lighting/surfaceCache/hitWgsl.ts`): the global field they are
 * marched through and the cache's tables and layers with the field's object grid, one set a session — the cache's own, the stand-ins
 * of a hit where the cache is not made or the session has no cards, the reads of an empty field where the scene has none.
 */
export function surfaceHitReads(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  into?: SurfaceHitReads,
): SurfaceHitReads {
  const standIns = hitStandIns(device)
  const field = rt.distanceFields?.scene ?? standIns.field
  const hit = (rt.surfaceCache?.hit ?? standIns.hit).resources(rt)
  if (!into) return { field, hit }
  into.field = field
  into.hit = hit
  return into
}

/** Whether the cache has work left or an atlas view is shown: a frame that is still is not held. The view
 *  follows the cache's own clocks — the age of a page —, which an image advances. */
export const surfaceCacheBusy = (rt: Pick<WebgpuPagesRuntime, 'surfaceCache' | 'run'>) =>
  !!rt.surfaceCache?.busy || atlasViewOf(rt.run.diagnostic) !== undefined

/** The settings of the global distance field the cache's sizes follow: the scene's, or the options' where it has none. */
export const fieldSettingsOf = (rt: WebgpuPagesRuntime, state: SurfaceCacheFrameState) =>
  rt.distanceFields?.settings ??
  resolveSettingsInto(GLOBAL_DISTANCE_FIELD_RULES, rt.context, state.field)

/** The distance the cards are kept to, in centimetres: the outermost clipmap of the global distance
 *  field's half side, or its view distance where it makes none. */
function reachOf(rt: WebgpuPagesRuntime, state: SurfaceCacheFrameState) {
  const settings = fieldSettingsOf(rt, state)
  const clipmaps = numClipmaps(settings)
  return clipmaps > 0
    ? clipmapExtent(settings, clipmaps - 1)
    : settings.globalDistanceFieldViewDistance
}

/** The pages of `work` that cannot be served this image — the raster drew none of them — asked again. */
function askAgain(
  cache: SurfaceCache,
  pages: readonly CapturePage[],
  drawn: ReadonlySet<CapturePage>,
) {
  let waiting = 0
  for (const page of pages) {
    if (page.copyCard >= 0 || drawn.has(page)) continue
    cache.recapture.add(cache.frame, page.page)
    waiting++
  }
  return waiting
}

/** The views at most an image draws: the captures it is budgeted. */
const viewCapacity = (settings: SurfaceCacheSettings) =>
  clamp(maxCapturesPerFrame(settings), 1, MOST_VIEWS)

/** What the capture's kernels run with in this image. */
const captureSettingsOf = (
  state: SurfaceCacheFrameState,
  preExposure: number,
): CaptureSettings => ({
  dilate: state.settings.surfaceCacheDilationMode === 2,
  resample: state.settings.surfaceCacheResampleLighting,
  radiosity: state.settings.surfaceCacheRadiosity,
  preExposure,
})

/** The resample stage of the capture over the pages of the image, which reads the cards in `tables`
 *  (`CaptureKernels.resample`). */
function resample(
  encoder: GPUCommandEncoder,
  state: SurfaceCacheFrameState,
  pages: readonly CapturePage[],
  tables: GPUBuffer,
  settings: CaptureSettings,
) {
  state.pass.begin(encoder)
  state.kernels!.resample(state.pass, pages, { atlases: state.atlases!, tables }, settings)
  state.pass.end()
}

/** Captures the pages of the image: drawn, shaded, resolved, copied. The account of it. */
function capture(
  encoder: GPUCommandEncoder,
  state: SurfaceCacheFrameState,
  pages: readonly CapturePage[],
  settings: CaptureSettings,
) {
  const { cache, atlases, raster, shading, kernels } = state
  if (!atlases || !shading?.ready || !kernels?.ready)
    return { ...NO_WORK, waiting: askAgain(cache, pages, NO_PAGES) }
  const toDraw = pages.filter((page) => page.copyCard < 0)
  cardViews.length = 0
  for (const page of toDraw)
    cardViews.push(cardPageView(cache.cards.at(page.card), page.uv, page.captureRect))
  const targets = {
    side: atlases.captureSide,
    viewRows: atlases.viewRows,
    ids: atlases.capture.ids,
    depth: atlases.capture.depth,
  }
  const image = toDraw.length
    ? raster.draw(encoder, targets, toDraw, cardViews, cache.frame)
    : undefined
  state.pass.begin(encoder)
  // Every page of the image is shaded in one go: the shading places a texel by the view of its row.
  const shaded = new Set<CapturePage>()
  if (image && shading.shade(state.pass, image, atlases.capture.ids))
    for (const at of image.pages) shaded.add(toDraw[at]!)
  drawnPages.length = 0
  for (const page of pages) if (page.copyCard >= 0 || shaded.has(page)) drawnPages.push(page)
  kernels.encode(
    state.pass,
    drawnPages,
    { atlases, tables: state.tables.buffer!, colours: shading.surfaces.stores()[0] },
    settings,
  )
  state.pass.end()
  kernels.copyBlocks(encoder, atlases)
  // A page mapped for a capture that was not made stays pending: nothing reads it, and it is asked again.
  // The pages the raster drew are confirmed when their counters come back (`settleDrawn`); a copy has none.
  confirmed.length = 0
  for (const page of drawnPages) if (page.copyCard >= 0) confirmed.push(page.page)
  confirmPages(cache, confirmed)
  const copied = confirmed.length
  let refreshed = 0
  for (const page of drawnPages) if (page.refresh) refreshed++
  return {
    captured: drawnPages.length - copied - refreshed,
    copied,
    refreshed,
    waiting: askAgain(cache, pages, shaded),
  }
}

/**
 * The pages of the batches whose counters came back: each whose view was drawn whole reads from now on
 * (`confirmPages`), each whose view a budget cut short is asked again. A page captured again since the
 * batch was drawn is left to the capture that followed.
 */
function settleDrawn(cache: SurfaceCache, raster: CardRaster) {
  confirmed.length = 0
  for (const batch of raster.landed())
    for (let rank = 0; rank < batch.pages.length; rank++) {
      const index = batch.pages[rank]!
      if (!cache.captured.has(index) || cache.captured.keyOf(index) !== batch.stamp) continue
      if (batch.lost[rank]) cache.recapture.add(cache.frame, index)
      else confirmed.push(index)
    }
  confirmPages(cache, confirmed)
}

/** The account of the last image. */
function metricsOf(
  state: SurfaceCacheFrameState,
  account: Pick<SurfaceCacheFrameMetrics, 'captured' | 'copied' | 'refreshed' | 'waiting'>,
): SurfaceCacheFrameMetrics {
  const { cache, atlases, shading, tables } = state
  const pagesTotal = cache.allocator.pagesX * cache.allocator.pagesY
  return {
    atlasSide: atlases?.side ?? 0,
    captureSide: atlases?.captureSide ?? 0,
    bytes: (atlases?.bytes ?? 0) + (shading?.bytes ?? 0) + tables.bytes,
    placements: state.placements.count,
    meshCards: cache.meshCards.length,
    cards: cache.cards.length,
    pagesUsed: pagesTotal - cache.allocator.freePages,
    pagesTotal,
    ...account,
    meshCardsToAdd: cache.stats.meshCardsToAdd,
    lockedCardsToUpdate: cache.stats.lockedCardsToUpdate,
    hiResPagesToAdd: cache.stats.hiResPagesToAdd,
    desiredTexels: cache.stats.desiredTexels,
    raster: !state.raster.failure,
    why: state.why,
    compressed: atlases?.compressed ?? false,
    compressionWhy: state.compressionWhy,
  }
}

/** Gives back what the cache holds on the GPU, and its place in the scene: the next image that asks
 *  makes them again. */
function release(state: SurfaceCacheFrameState) {
  disposeSurfaceLighting(state)
  state.viewer?.dispose()
  state.kernels?.dispose()
  state.shading?.dispose()
  state.raster.dispose()
  state.atlases?.dispose()
  state.tables.dispose()
  state.feedback.reset()
  state.viewer = state.kernels = state.shading = state.atlases = undefined
  state.cache = createSurfaceCache(state.settings)
  state.placements = createCardPlacements(state.source.meshCards ?? [])
  state.busy = false
  state.refused = false
  state.metrics = null
  state.why = null
  state.compressionWhy = null
}

/** The GPU's side of the cache made for this image: the atlases at the size the settings ask — with
 *  what the capture shades into and draws with —, the capture's kernels. Where the budget
 *  leaves no room, the cache is off and says why. */
function ensureGpu(rt: WebgpuPagesRuntime, device: GPUDevice, state: SurfaceCacheFrameState) {
  const pages = atlasPages(state.settings)
  const side = pages * PAGE_SIZE
  const captureSide = captureAtlasPages(state.settings, pages) * PAGE_SIZE
  const views = viewCapacity(state.settings)
  const extra = cardShadingBytes(captureSide) + cardRasterBytes(captureSide, views)
  const { compressed, why: compressionWhy } = atlasCompression(
    device,
    state.settings.surfaceCacheCompress,
  )
  state.compressionWhy = compressionWhy
  const made = ensureSurfaceAtlases(
    state.atlases,
    device,
    side,
    captureSide,
    compressed,
    views,
    extra,
  )
  if (!made.atlases) {
    state.atlases = undefined
    state.why = made.why ?? null
    return false
  }
  state.why = null
  const remade = made.atlases !== state.atlases
  state.atlases = made.atlases
  if (remade) {
    state.shading?.dispose()
    state.shading = undefined
    state.refused = false
  }
  // The kernels are for one kind of atlas: an atlas made the other kind brings new ones.
  if (state.kernels && state.kernels.compressed !== made.atlases.compressed) {
    state.kernels.dispose()
    state.kernels = undefined
  }
  if (!state.refused) {
    state.shading ??= createCardShading(rt, device, captureSide)
    state.kernels ??= createCaptureKernels(device, made.atlases.compressed)
  }
  return true
}

/**
 * The surface cache's update for this image of the main view, on `encoder`: the placements brought level
 * with the cut, the cache updated for `cam`, its tables written, the pages it captures drawn, shaded,
 * resolved and copied into the atlas. Nothing where nothing asks for the cache.
 */
export function encodeSurfaceCache(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  if (rt.views.active !== rt.views.main) return
  const shown = atlasViewOf(rt.run.diagnostic) !== undefined
  const state = stateOf(rt, device)
  if (!state) return
  if (!state.demanded && !shown) {
    if (state.atlases) release(state)
    return
  }
  state.demanded = false
  state.updated = false
  resolveSurfaceCacheSettings(rt.context, screenProbeSettingsOf(rt).level, state.settings)
  try {
    updateImage(rt, device, encoder, cam, state)
  } catch (error) {
    // The memory budget leaves no room for the capture's surfaces: the cache goes on without a capture.
    if (!budgetRefused(error)) throw error
    state.shading?.dispose()
    state.shading = undefined
    state.refused = true
    state.why = 'the memory budget refused the surfaces of the capture'
    state.metrics = metricsOf(state, NO_WORK)
    state.busy = false
  }
}

/** What closes an image: why the capture or the raster could not be made, if they could not; whether
 *  the cache still waits for work; the clock; the image's metrics from its `account`. */
function closeImage(state: SurfaceCacheFrameState, account: Parameters<typeof metricsOf>[1]) {
  const { cache, raster } = state
  if (state.shading?.failure)
    state.why = `the capture's shading could not be made: ${String(state.shading.failure)}`
  else if (raster.failure)
    state.why = `the cards' raster could not be made: ${String(raster.failure)}`
  // The requests the image left; the refresh of the pages captured longest ago goes on whatever the view
  // does, and keeps nothing unheld: it leaves the light of its pages (`CapturePage.refresh`), and a batch
  // of refreshes alone is not awaited (`CardRaster.awaiting`).
  const { meshCardsToAdd, lockedCardsToUpdate, hiResPagesToAdd } = cache.stats
  state.busy =
    meshCardsToAdd + lockedCardsToUpdate + hiResPagesToAdd > 0 ||
    account.waiting > 0 ||
    raster.awaiting
  // A frozen update frame keeps the clock where it is (`surfaceCacheFreezeUpdateFrame`).
  if (state.settings.surfaceCacheFreezeUpdateFrame === 0) advanceFrame(cache)
  state.updated = true
  state.metrics = metricsOf(state, account)
}

/** One image's work of the cache: `encodeSurfaceCache` after it knows the cache is asked for. */
function updateImage(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  state: SurfaceCacheFrameState,
) {
  if (!ensureGpu(rt, device, state)) {
    state.metrics = metricsOf(state, NO_WORK)
    state.busy = false
    return
  }
  const atlases = state.atlases!
  const { cache } = state
  // The roots the distance fields' scene placed, the HLOD cells' stand-ins among them: one list for both.
  state.placements.sync(cache, cacheRootsOf(rt), 0)
  for (let k = 0; k < 3; k++) origin[k] = cam.eye[k] * CM
  const { raster } = state
  settleDrawn(cache, raster)
  // The clocks wait for the capture's shading and kernels to compile: the cache's evolution counts the images it could
  // work in, never how long a compile took, so two runs of one scene meet the same cache at the same image.
  if (!state.shading?.ready || !state.kernels?.ready) {
    state.metrics = metricsOf(state, NO_WORK)
    state.busy = true
    return
  }
  const preExposure = cachedLightingPreExposureOf(rt)
  const colorBoost = 1 / state.settings.surfaceCacheDiffuseColorBoost
  // The pages whose counters came back read from now on — the resample below among the readers.
  state.tables.update(cache, preExposure, colorBoost, encoder)
  const work = updateSurfaceCache(cache, state.settings, {
    origins: [origin],
    orthographic: cam.perspective === 0,
    clipmapExtent: reachOf(rt, state),
    compressed: atlases.compressed,
    ready: (placement) => raster.ready(placement),
    feedback: state.feedback.take(),
  })
  const settings = captureSettingsOf(state, preExposure)
  if (work.reset || !atlases.cleared) {
    atlases.clear(encoder)
    state.kernels?.clearBlocks(encoder, atlases)
    // Every page lost its light, and the radiosity's probes with it.
    if (state.lighting) state.lighting.historyLost = true
  }
  // The pages' copied texels and carried light read the cards as they were, before the image's tables go up.
  resample(encoder, state, work.pages, state.tables.buffer!, settings)
  state.tables.update(cache, preExposure, colorBoost, encoder)
  const account = work.pages.length ? capture(encoder, state, work.pages, settings) : NO_WORK
  // The pages the image confirmed read from now on (`confirmPages`).
  state.tables.update(cache, preExposure, colorBoost, encoder)
  closeImage(state, account)
}

/** The surface cache's metrics for the last image, none while it is not made. */
export const surfaceCacheMetrics = (rt: Pick<WebgpuPagesRuntime, 'surfaceCache'>) =>
  rt.surfaceCache?.metrics ?? null

/** Whether the canvas of this image shows the atlas: a view of it is chosen, its atlas is made and the viewer's
 *  pipeline is compiled. */
export function atlasViewReady(rt: WebgpuPagesRuntime) {
  const state = rt.surfaceCache
  const device = rt.gpu.device
  if (atlasViewOf(rt.run.diagnostic) === undefined || !state?.atlases || !device) return false
  if (rt.views.active !== rt.views.main) return false
  return (state.viewer ??= createAtlasViewer(device)).ready
}

/** Draws the atlas, the view the diagnostic mode names, onto `canvas`, `size` texels (`createAtlasViewer`);
 *  false where it cannot be drawn yet. */
export function drawAtlasView(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  canvas: GPUTextureView,
  size: readonly [number, number],
) {
  const code = atlasViewOf(rt.run.diagnostic)
  const state = rt.surfaceCache
  if (code === undefined || !state?.atlases) return false
  const viewer = (state.viewer ??= createAtlasViewer(device))
  if (!viewer.ready) return false
  viewer.encode(
    encoder,
    SURFACE_CACHE_PASS + ' atlas view',
    state.atlases,
    state.cache,
    code,
    canvas,
    size,
  )
  return true
}

/** Frees the surface cache of `rt`. */
export function disposeSurfaceCache(rt: Pick<WebgpuPagesRuntime, 'surfaceCache'>) {
  const state = rt.surfaceCache
  if (!state) return
  release(state)
  state.raster.dispose()
  state.feedback.dispose()
  state.hit.dispose()
  rt.surfaceCache = undefined
}
