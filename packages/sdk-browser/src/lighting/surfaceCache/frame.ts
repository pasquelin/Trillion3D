import { clamp } from '../../../../math/src/scalar/reals.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import {
  GLOBAL_DISTANCE_FIELD_RULES,
  type GlobalDistanceFieldSettings,
} from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { resolveSettingsInto } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  readSurfaceCacheSetting,
  type SurfaceCacheSettings,
} from '../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
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
import {
  addStreamingViewOrigins,
  createViewOriginHold,
  maxCapturesPerFrame,
  viewOriginOf,
  type ViewOriginHold,
} from '../../../../sdk-core/src/lighting/surfaceCache/requests.ts'
import { confirmPages } from '../../../../sdk-core/src/lighting/surfaceCache/virtualSurface.ts'
import { updateSurfaceCache } from '../../../../sdk-core/src/lighting/surfaceCache/update.ts'
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
import { rayTracingOf } from '../rays/sceneTrace/runtimeRays.ts'
import { screenProbeSettingsOf } from '../bounce/screen/settingsOf.ts'
import { createHitCards } from '../reflections/hitCards.ts'
import { ensureSurfaceAtlases, type SurfaceAtlases } from './atlases.ts'
import { surfaceCacheLightOf, surfaceCacheLightWanted } from './light.ts'
import { periodicResetDue } from './periodicReset.ts'
import { closeImage, metricsOf } from './closeImage.ts'
import { cardShadingBytes, createCardShading, type CardShading } from './capture/shade.ts'
import type { CardRaster } from './capture/raster.ts'
import { texturesPending } from './capture/objectTextures.ts'
import { MOST_VIEWS, cardRasterBytes, createCardRaster } from './capture/cardRaster.ts'
import { atlasCompression } from './compress.ts'
import { createCaptureKernels, type CaptureKernels, type CaptureSettings } from './copy.ts'
import { createAtlasViewer, type AtlasViewer } from './debug.ts'
import { ATLAS_VIEWS } from './debugWgsl.ts'
import { createSurfaceFeedback, type SurfaceFeedback } from './feedbackBuffer.ts'
import { disposeSurfaceLighting, type SurfaceLightingState } from './lighting/surfaceLighting.ts'
import { placementChannelsOf } from '../../geometry/dag/info/placementInfoLayout.ts'
import {
  cacheRootsOf,
  createCardPlacements,
  type CardPlacements,
  type CardRoot,
} from './placements.ts'
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
  /** Where the main view's origin was left when it stopped following the eye (`surfaceCacheUpdateViewOrigin`). */
  readonly originHold: ViewOriginHold
  /** Whether this image updated the cache: the lighting (`lighting/frame.ts`) follows it. */
  updated: boolean
  /** Whether `surfaceCacheReset` and `surfaceCacheForceEvictHiResPages` were on in the last image: each acts once when it is turned on. */
  resetHeld: boolean
  evictHeld: boolean
  /** The lighting's own state (`lighting/surfaceLighting.ts`), made when it first lights. */
  lighting?: SurfaceLightingState
}

/** The eyes the image keeps the cards for: the main view's, then those of the streaming views; each slot is reused. */
const eye: [number, number, number] = [0, 0, 0]
const origin: [number, number, number] = [0, 0, 0]
const NO_OFFSET: readonly [number, number, number] = [0, 0, 0]
const origins: [number, number, number][] = [origin]
const streamingOrigins: [number, number, number][] = []
const streamingSlots: [number, number, number][] = []
/** The camera of the streaming view whose eye the image kept, if any: the second view the lighting's priority is measured from. */
let keptView: EngineCamera | undefined
const cardViews: CardView[] = []
const drawnPages: CapturePage[] = []
/** The page-table indices an image confirms, reused. */
const confirmed: number[] = []

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
    originHold: createViewOriginHold(),
    updated: false,
    resetHeld: false,
    evictHeld: false,
  }
}

/** What each list of roots held, as it was last read: its length and whether a run-time primitive was among them. */
const runtimeRootsHeld = new WeakMap<object, { length: number; any: boolean }>()

/** Whether the cut holds a primitive a world cut at run time, whose cards the cache makes from its box (`runtimeMeshCards`). */
function holdsRuntimeCards(rt: WebgpuPagesRuntime) {
  if (!readSurfaceCacheSetting(rt, 'runtimeMeshCards')) return false
  const roots = cacheRootsOf(rt) as readonly CardRoot[]
  let held = runtimeRootsHeld.get(roots)
  if (!held || held.length !== roots.length) {
    held = { length: roots.length, any: roots.some((root) => root.runtime && root.localBox) }
    runtimeRootsHeld.set(roots, held)
  }
  return held.any
}

/** The state of `rt`, made at the first image that asks for the cache, none for a session whose cache
 *  carries no cards: no compiled mesh's and no run-time primitive's. */
function stateOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (rt.surfaceCache) return rt.surfaceCache
  if (!rt.context.meshCards?.length && !holdsRuntimeCards(rt)) return undefined
  return (rt.surfaceCache = createState(rt, device))
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
 * of a hit where the cache is not made, is made in another format than `light` — the format the pass's programs read the final light in, the cache's own
 * by default — or the session has no cards, the reads of an empty field where the scene has none.
 */
export function surfaceHitReads(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  into?: SurfaceHitReads,
  light = surfaceCacheLightOf(rt, device),
): SurfaceHitReads {
  const standIns = hitStandIns(device)
  const field = rt.distanceFields?.scene ?? standIns.field
  const hit = (rt.surfaceCache?.hit ?? standIns.hit).resources(rt, light)
  if (!into) return { field, hit }
  into.field = field
  into.hit = hit
  return into
}

/** Whether the cache has work left or an atlas view is shown: a frame that is still is not held. The view
 *  follows the cache's own clocks — the age of a page —, which an image advances. */
export const surfaceCacheBusy = (rt: Pick<WebgpuPagesRuntime, 'surfaceCache' | 'run'>) =>
  !!rt.surfaceCache?.busy || atlasViewOf(rt.run.diagnostic) !== undefined

/** What keeps the cache busy, term by term (`closeImage`, `updateImage`), for a trace: the capture's programs, the requests the last
 *  image left (mesh cards to add, locked cards to update, high-resolution pages to add), the pages it asked again, and the diagnostic
 *  view of an atlas. None without a cache. */
export function surfaceCacheWhy(rt: Pick<WebgpuPagesRuntime, 'surfaceCache' | 'run' | 'lights'>) {
  const state = rt.surfaceCache
  if (!state) return undefined
  const { meshCardsToAdd, lockedCardsToUpdate, hiResPagesToAdd } = state.cache.stats
  return {
    busy: state.busy,
    capturePrograms: !!state.shading?.ready && !!state.kernels?.ready,
    refused: state.refused,
    meshCardsToAdd,
    lockedCardsToUpdate,
    hiResPagesToAdd,
    waiting: state.metrics?.waiting ?? null,
    // The lighting's own hold (`lighting/frame.ts`: `busy` while the light reaches the pages): the images it still settles for, restarted by
    // every image that captured or copied a page and by a new transport epoch, and what the last image captured and copied.
    lightingSettle: state.lighting?.settle ?? null,
    // The light table's epochs: the lighting settles again when `transportEpoch` moves (`surfaceLighting.ts` `uploadParams`).
    transportEpoch: rt.lights.store.transportEpoch,
    lightEpoch: rt.lights.store.epoch,
    captured: state.metrics?.captured ?? null,
    copied: state.metrics?.copied ?? null,
    // What gates the image's lighting (`lighting/frame.ts`, `encodeLighting`): the cache updated and asked this image, the lighting's own
    // resources and programs, the cache's tables and pages, and the reason the cache or the lighting gave for lighting nothing.
    updated: state.updated,
    demanded: state.demanded,
    lightingResources: !!state.lighting?.resources,
    lightingProgramsReady:
      !!state.lighting?.shaped?.cull.ready && !!state.lighting.shaped.combine.ready,
    tables: !!state.tables.buffer,
    pages: state.cache.pages.length,
    why: state.lighting?.why ?? state.why,
    atlasView: atlasViewOf(rt.run.diagnostic) !== undefined,
  }
}

/** The settings of the global distance field the cache's sizes follow: the scene's, or the options' where it has none. */
export const fieldSettingsOf = (rt: WebgpuPagesRuntime, state: SurfaceCacheFrameState) =>
  rt.distanceFields?.settings ??
  resolveSettingsInto(GLOBAL_DISTANCE_FIELD_RULES, rt.context, state.field)

/** The distance the cards are kept to, in centimetres: the outermost clipmap of the global distance
 *  field's half side, or its view distance where it makes none; where the scene has acceleration structures and the rays through them
 *  are culled (`rayTracingCulling` over 0), the culling radius (`rayTracingCullingRadius`) in its place. */
export function reachOf(rt: WebgpuPagesRuntime, state: SurfaceCacheFrameState) {
  if (rayTracingOf(rt) && state.settings.rayTracingCulling > 0)
    return state.settings.rayTracingCullingRadius
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

/** The pages of `toDraw` drawn by the raster of the cards' views, none where there are none. */
function drawCards(
  encoder: GPUCommandEncoder,
  state: SurfaceCacheFrameState,
  toDraw: readonly CapturePage[],
) {
  const { cache, raster } = state
  const atlases = state.atlases!
  cardViews.length = 0
  for (const page of toDraw)
    cardViews.push(cardPageView(cache.cards.at(page.card), page.uv, page.captureRect))
  const targets = {
    side: atlases.captureSide,
    viewRows: atlases.viewRows,
    ids: atlases.capture.ids,
    depth: atlases.capture.depth,
    albedo: atlases.capture.albedo,
    normal: atlases.capture.normal,
    emissive: atlases.capture.emissive,
  }
  return toDraw.length ? raster.draw(encoder, targets, toDraw, cardViews) : undefined
}

/** The pages drawn and the pages copied read from now on, whole or not: what a budget cut from a view is
 *  not drawn, and the page is not asked again for it. The pages copied and refreshed among them. */
function confirmDrawn(cache: SurfaceCache) {
  confirmed.length = 0
  let copied = 0,
    refreshed = 0
  for (const page of drawnPages) {
    confirmed.push(page.page)
    if (page.copyCard >= 0) copied++
    if (page.refresh) refreshed++
  }
  confirmPages(cache, confirmed)
  return { copied, refreshed }
}

/** Captures the pages of the image: drawn, shaded, resolved, copied. The account of it. */
function capture(
  encoder: GPUCommandEncoder,
  state: SurfaceCacheFrameState,
  pages: readonly CapturePage[],
  settings: CaptureSettings,
) {
  // The image checked that the shading and the kernels are ready before it planned these pages (`updateImage`).
  const { cache } = state
  const atlases = state.atlases!,
    shading = state.shading!,
    kernels = state.kernels!
  const toDraw = pages.filter((page) => page.copyCard < 0)
  const image = drawCards(encoder, state, toDraw)
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
    {
      atlases,
      tables: state.tables.buffer!,
      colours: shading.surfaces.stores()[0],
      words: shading.surfaces.stores()[1],
      lobes: shading.surfaces.lobesView,
    },
    settings,
  )
  state.pass.end()
  kernels.copyBlocks(encoder, atlases)
  // A page mapped for a capture that was not made stays pending: nothing reads it, and it is asked again.
  const { copied, refreshed } = confirmDrawn(cache)
  return {
    captured: drawnPages.length - copied - refreshed,
    copied,
    refreshed,
    waiting: askAgain(cache, pages, shaded),
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
    surfaceCacheLightWanted(rt, device),
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
  // The kernels are for one kind of atlas and one format of its light: an atlas made the other kind brings new ones.
  if (
    state.kernels &&
    (state.kernels.compressed !== made.atlases.compressed ||
      state.kernels.light !== made.atlases.light)
  ) {
    state.kernels.dispose()
    state.kernels = undefined
  }
  if (!state.refused) {
    state.shading ??= createCardShading(rt, device, captureSide)
    state.kernels ??= createCaptureKernels(device, made.atlases.compressed, made.atlases.light)
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

/** The eyes of an image, centimetres: the main view's origin (the camera's eye moved ahead by the global distance field's velocity
 *  offset, held where it stopped while `surfaceCacheUpdateViewOrigin` is off), then the eyes of the views drawn beside the main one
 *  that have drawn, which are streaming views: each kept only if it lies `surfaceCacheViewOriginDistanceThreshold` or more from the eyes held, two at most
 *  (`addStreamingViewOrigins`). */
function eyesOf(rt: WebgpuPagesRuntime, cam: EngineCamera, state: SurfaceCacheFrameState) {
  const { settings } = state
  const field = fieldSettingsOf(rt, state)
  for (let k = 0; k < 3; k++) eye[k] = cam.eye[k] * CM
  viewOriginOf(
    origin,
    eye,
    rt.distanceFields?.scene.field.cameraOffset ?? NO_OFFSET,
    state.originHold,
    settings.surfaceCacheUpdateViewOrigin,
    numClipmaps(field) - 1,
    field,
  )
  origins.length = 1
  streamingOrigins.length = 0
  rt.views.persistent.forEach((view, at) => {
    if (view.drawnBeside === undefined) return
    const slot = (streamingSlots[at] ??= [0, 0, 0])
    for (let k = 0; k < 3; k++) slot[k] = view.cam.eye[k] * CM
    streamingOrigins.push(slot)
  })
  addStreamingViewOrigins(
    origins,
    streamingOrigins,
    settings.surfaceCacheViewOriginDistanceThreshold,
  )
  keptView = rt.views.persistent.find(
    (view, at) => view.drawnBeside !== undefined && origins.includes(streamingSlots[at]!),
  )?.cam
  return origins
}

/** The streaming view the last image kept the cards for, none when it kept only the main view's eye: what the lighting
 *  measures its pages' priority from beside the main view (`LightingImage.other`). */
export const keptStreamingView = () => keptView

/** What the debugging settings ask of this image: the cache reset (a setting turned on, or an image that is a multiple of the period) and the forced eviction of the optional pages, each once as it is turned on. */
function debugRequests(rt: WebgpuPagesRuntime, state: SurfaceCacheFrameState) {
  const { surfaceCacheReset, surfaceCacheResetEveryNthFrame, surfaceCacheForceEvictHiResPages } =
    state.settings
  const reset =
    (surfaceCacheReset && !state.resetHeld) ||
    periodicResetDue(rt.run.frame, surfaceCacheResetEveryNthFrame)
  const forceEvictHiResPages = surfaceCacheForceEvictHiResPages && !state.evictHeld
  state.resetHeld = surfaceCacheReset
  state.evictHeld = surfaceCacheForceEvictHiResPages
  return { reset, forceEvictHiResPages }
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
  state.placements.sync(
    cache,
    cacheRootsOf(rt),
    0,
    (rank) => placementChannelsOf(rt.vis.rootOffsets.rowOf(rank)?.bits ?? 0),
    state.settings.runtimeMeshCards,
  )
  const eyes = eyesOf(rt, cam, state)
  // The clocks wait for the capture's shading and kernels to compile: the cache's evolution counts the images it could
  // work in, never how long a compile took, so two runs of one scene meet the same cache at the same image.
  if (!state.shading?.ready || !state.kernels?.ready) {
    state.metrics = metricsOf(state, NO_WORK)
    state.busy = true
    return
  }
  const preExposure = cachedLightingPreExposureOf(rt)
  const colorBoost = 1 / state.settings.surfaceCacheDiffuseColorBoost
  state.tables.update(cache, preExposure, colorBoost, encoder)
  const gate = captureGate(rt, state)
  const { reset, forceEvictHiResPages } = debugRequests(rt, state)
  const work = updateSurfaceCache(cache, state.settings, {
    origins: eyes,
    orthographic: cam.perspective === 0,
    clipmapExtent: reachOf(rt, state),
    compressed: atlases.compressed,
    light: atlases.light,
    preExposure,
    reset,
    forceEvictHiResPages,
    ready: gate.ready,
    feedback: state.feedback.take(),
  })
  const settings = captureSettingsOf(state, preExposure)
  if (work.reset || !atlases.cleared) {
    atlases.clear(encoder)
    state.kernels.clearBlocks(encoder, atlases)
    // Every page lost its light, and the radiosity's probes with it.
    if (state.lighting) state.lighting.historyLost = true
  }
  // The pages' copied texels and carried light read the cards as they were, before the image's tables go up.
  resample(encoder, state, work.pages, state.tables.buffer!, settings)
  state.tables.update(cache, preExposure, colorBoost, encoder)
  const account = work.pages.length ? capture(encoder, state, work.pages, settings) : NO_WORK
  // The pages the image confirmed read from now on (`confirmPages`).
  state.tables.update(cache, preExposure, colorBoost, encoder)
  closeImage(state, account, gate.heldBack())
}

/** Whether a placement is captured: ready to draw and wearing whole textures (`texturesPending`); counts the objects held back for their textures, each once however many pages ask. The classes the capture shades with (`cards`) are
 *  asked with the frames waiting for them, so no image is drawn, nor a card captured, while one compiles: no gate of its own. */
function captureGate(rt: WebgpuPagesRuntime, state: SurfaceCacheFrameState) {
  const held = new Set<Parameters<CardRaster['ready']>[0]>()
  const counters = rt.vis.textures?.counters
  return {
    ready: (placement: Parameters<CardRaster['ready']>[0]) => {
      if (!state.raster.ready(placement)) return false
      const surface = state.placements.rootOf(placement)?.worn?.surface
      if (!counters || !texturesPending(counters, rt.vis, surface)) return true
      held.add(placement)
      return false
    },
    heldBack: () => held.size,
  }
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
