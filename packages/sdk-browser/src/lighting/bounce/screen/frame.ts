import { skyLightReadOf } from '../../../frame/render/skyLightState.ts'
import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { ScreenProbeFrameMetrics } from '../../../../../sdk-core/src/contracts/shadowMetrics.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { readHizSetting } from '../../../../../sdk-core/src/contracts/hizOptions.ts'
import { screenRelativeThickness } from '../../../visibility/hiz/gpu/screenSlab.ts'
import { blueNoiseNow, blueNoiseRefused } from '../../../gpu/noise/blueNoiseTextures.ts'
import { reflectionGroup, reflectionLightView } from '../../reflections/group.ts'
import { demandSurfaceCache, surfaceHitReads } from '../../surfaceCache/frame.ts'
import type { MarkProbes } from '../pool/pool.ts'
import { stochasticPhase } from '../../../post/taa/frameState.ts'
import { screenProbesCast } from './cast.ts'
import { encodeScreenProbes as encodePass } from './encode.ts'
import { createScreenProbeGroups } from './groups.ts'
import type { ScreenProbeInputs } from './groupParts.ts'
import { createScreenProbeStore, type ScreenProbeStore } from './store.ts'
import type { ScreenProbeGeometry } from './screenProbeLayout.ts'
import { ensureScreenProbeView, imageGeometry, type ScreenProbeView } from './view.ts'
import { screenProbeVectors } from './vectorSource.ts'

/** The metrics of an image of `settings`: what it cast — `geometry`, with what it read — or, with none, why it cast none. */
function metricsOf(
  settings: ScreenProbeSettings,
  geometry: ScreenProbeGeometry | undefined,
  read: {
    history?: boolean
    screen?: boolean
    velocity?: boolean
    bytes?: number
    cacheBytes?: number
  },
  unavailable: string | null,
): ScreenProbeFrameMetrics {
  const g = geometry
  return {
    level: settings.level,
    tile: g?.tile ?? settings.downsampleFactor,
    uniformProbes: g?.uniform ?? 0,
    adaptiveCapacity: g?.maxAdaptive ?? 0,
    tracingResolution: settings.tracingResolution,
    raysPerImage: g && settings.casts ? (g.uniform + g.maxAdaptive) * g.tracing * g.tracing : 0,
    atlas: g && settings.casts ? [g.tilesX, g.rows] : [0, 0],
    history: !!read.history,
    screenTraces: settings.casts && !!read.screen && settings.values.screenProbeScreenTraces,
    sceneTraces: !!g && settings.casts && settings.values.screenProbeSceneTraces,
    meshTraces: false,
    velocity: !!read.velocity,
    bytes: read.bytes ?? 0,
    radianceCache: !!read.cacheBytes && settings.radianceCache,
    radianceCacheResolution: read.cacheBytes ? settings.cache.resolution : 0,
    radianceCacheBytes: read.cacheBytes ?? 0,
    unavailable,
  }
}

/** What an image needs of the frame to cast probes, or nothing while the frame lacks any of it: the device, the
 *  reflection (its depth pyramid, its last lit image, its view), the G-buffer, the lights, the lighting and the blue noise. */
function neededOf(rt: WebgpuPagesRuntime) {
  const { gpu, vis, lights, run } = rt
  const { device, reflection, surfaces, deferred } = gpu
  const depth = vis.gpuHiz?.depth(),
    lightView = reflectionLightView(rt)
  if (
    !device ||
    !reflection ||
    !surfaces ||
    !deferred ||
    !depth ||
    !lightView ||
    !vis.reflectionPipelines ||
    !lights.buffer ||
    !run.depthDrawn
  )
    return undefined
  const noise = blueNoiseNow(device)
  return (
    noise && {
      device,
      reflection,
      surfaces,
      deferred,
      depth,
      lightView,
      lights: lights.buffer,
      noise,
    }
  )
}

/** Why the blue noise is not there to read, or nothing where it is. */
const noiseWhy = (device: GPUDevice | undefined) =>
  device && !blueNoiseNow(device)
    ? blueNoiseRefused(device)
      ? 'the blue noise was refused'
      : 'the blue noise is loading'
    : undefined

/** The frame's resources the probes read, handed to `castProbes`. */
type Needed = NonNullable<ReturnType<typeof neededOf>>

/** What the groups name of the frame: its normals and flags, the lights, the cascades (or the lighting's stand-ins), the global
 *  distance field the rays are marched through and the surface cache their hits read, the vectors of the image (or the stand-in of
 *  none) and the blue noise (made: the image asked for it before it cast). */
function inputsOf(
  rt: WebgpuPagesRuntime,
  { device, surfaces, deferred, lights, noise }: Needed,
  store: ScreenProbeStore,
  vectors: GPUTextureView | undefined,
): ScreenProbeInputs {
  const frames = surfaces.views(),
    probes = rt.bounce.probes
  const cache = probes?.cache.views ?? store.noCache(device)
  return {
    normals: frames[1],
    flags: frames[3],
    lights,
    bounceGrid: probes?.uniform ?? deferred.placeholders.bounceGrid,
    probes: probes?.table ?? deferred.placeholders.probes,
    ...surfaceHitReads(rt, device),
    vectors: vectors ?? store.noVectors(device),
    blue: noise.view,
    cacheFinal: cache.final,
    cacheRaw: cache.raw,
    cacheSky: cache.sky,
    cacheTags: cache.tags,
    cachePdf: cache.pdf,
  }
}

/** The groups of the view for the kernels and the filter's passes asked: made again where either changed, the history dropped where the
 *  passes' parity did (the rays read the gathered texture the last passes wrote). */
function groupsOf(
  view: ScreenProbeView,
  device: GPUDevice,
  kernels: NonNullable<ScreenProbeView['kernels']>,
  settings: ScreenProbeSettings,
) {
  const parity = settings.casts ? settings.spatialFilterPasses & 1 : 0
  if (view.kernels !== kernels || view.parity !== parity) {
    if (view.parity !== undefined && view.parity !== parity) view.history = false
    view.kernels = kernels
    view.parity = parity
    view.groups = createScreenProbeGroups(
      device,
      kernels,
      view.resources,
      settings.spatialFilterPasses,
    )
  }
  return view.groups!
}

/** The result handed to the lighting, and the view moved on to its next image. */
function handOver(
  needed: Needed,
  state: ScreenProbeView,
  settings: ScreenProbeSettings,
  reflection: Needed['reflection'],
) {
  const { values } = settings
  needed.deferred.setScreenProbes(
    +values.screenProbeMaterialAO,
    values.screenProbeOcclusionMaxAlbedo,
    values.screenProbeOcclusionIntensity,
    (settings.casts ? 0 : 1) + (settings.backfaceDiffuse ? 0 : 2),
  )
  state.indirect = state.resources.history[state.turn]
  state.viewProjection.set(reflection.frame.viewProjection)
  state.history = true
  state.turn = (1 - state.turn) as 0 | 1
  state.frame++
}

/**
 * One image of probes, over the frame's resources: the inputs the groups name, the history read only where the
 * last image of the view left one drawn with the view-projection the last lit image holds, at the same size,
 * the surfaces' vectors of this image read with it, the parameters written, the pass encoded, and the result
 * handed to the lighting; what it cast is the result.
 */
function castProbes(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  needed: Needed,
  store: ScreenProbeStore,
  state: ScreenProbeView,
  kernels: NonNullable<ScreenProbeView['kernels']>,
  settings: ScreenProbeSettings,
) {
  const { device, reflection, depth, lightView } = needed
  // The rays marched through the field read the surface cache at their hits: it is made for the images to come.
  if (settings.values.screenProbeSceneTraces) demandSurfaceCache(rt)
  const vectors = screenProbeVectors(rt)
  const groups = groupsOf(state, device, kernels, settings)
  const { held } = reflection.lit
  const geometry = imageGeometry(state, rt.gpu.targetSize, settings)
  const history =
    state.history &&
    held.valid &&
    held.size[0] === geometry.width &&
    held.size[1] === geometry.height &&
    sameValues(held.viewProjection, state.viewProjection)
  const screen = reflection.frame.depthDrawn && held.valid
  const velocity = history && !!vectors
  const cacheViews = rt.bounce.probes?.cache.views
  const taa = rt.gpu.temporal?.frame,
    phase = stochasticPhase(taa)
  invertMatrix4(state.previousInverse, held.viewProjection)
  state.write(geometry, settings, {
    frame: phase,
    previousFrame: taa?.active ? Math.max(phase - 1, 0) : phase,
    history,
    screen,
    cache: !!cacheViews && settings.radianceCache,
    velocity,
    previousInverse: state.previousInverse,
    relativeThickness: screenRelativeThickness(
      reflection.frame.viewProjection,
      settings.values.screenProbeRelativeDepthThickness,
    ),
    fullResDepth: readHizSetting(rt, 'hizFullResDepth'),
  })
  encodePass(encoder, {
    kernels,
    resources: state.resources,
    groups: groups(state.turn, inputsOf(rt, needed, store, vectors)),
    reflection: reflectionGroup(reflection, depth, lightView, skyLightReadOf(rt)),
    settings,
    cache: rt.bounce.probes?.cache,
  })
  handOver(needed, state, settings, reflection)
  const cacheBytes = rt.bounce.probes?.cache.bytes
  return metricsOf(
    settings,
    geometry,
    { history, screen, velocity, bytes: state.bytes, cacheBytes },
    null,
  )
}

/** The view's probes given back, and the lighting left none to read. */
function release(rt: WebgpuPagesRuntime) {
  rt.gpu.screenProbes?.dispose()
  rt.gpu.screenProbes = undefined
}

/**
 * THE SCREEN PROBES OF THE IMAGE (`encodeScreenProbes`), after the depth pyramid and the reflections — which made the view's
 * uniform and hold the last lit image — and before the lighting, which reads what they leave (`ScreenProbeView.indirect`, named
 * by `directLightResources`). An image that cannot cast them — no lit surface, kernels still compiling, a device that refused
 * them, a budget with no room — leaves the lighting none: its pixels then take the sky light's irradiance, as they did before the screen
 * probes. A level `'off'`, or no bounce, gives the view's probes back altogether.
 */
export function encodeScreenProbes(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { bounce, gpu } = rt
  const store = (bounce.screen ??= createScreenProbeStore())
  const settings = store.read(rt.context)
  if (!screenProbesCast(rt)) {
    release(rt)
    store.metrics = undefined
    return
  }
  const skip = (why: string) => {
    if (gpu.screenProbes) {
      gpu.screenProbes.indirect = undefined
      gpu.screenProbes.history = false
    }
    store.metrics = metricsOf(
      settings,
      undefined,
      { bytes: gpu.screenProbes?.bytes, cacheBytes: rt.bounce.probes?.cache.bytes },
      why,
    )
  }
  const needed = neededOf(rt)
  if (!needed) return skip(noiseWhy(gpu.device) ?? 'no lit image to cast the probes on')
  const kernels = store.kernelsFor(needed.device, settings)
  if (!kernels) return skip(store.reason ?? 'the screen probes are compiling')
  const { view, why } = ensureScreenProbeView(
    gpu.screenProbes,
    needed.device,
    gpu.allocatedSize,
    settings,
  )
  gpu.screenProbes = view
  if (!view) return skip(why!)
  store.metrics = castProbes(rt, encoder, needed, store, view, kernels, settings)
}

/** The probes the view's last image cast, for the pool to mark the cells they stand in from (`../pool/pool.ts`): their records, the
 *  count of the adaptive ones placed and the shape of the atlas they lie in; none where the last image cast none. The records are
 *  those of the turn the last image took, the one this image's cast then takes in its turn. */
export function lastCastProbes(view: ScreenProbeView | undefined): MarkProbes | undefined {
  const geometry = view?.image
  if (!view?.history || !geometry) return undefined
  const { resources } = view
  return {
    info: resources.info[1 - view.turn],
    normal: resources.normal,
    counts: resources.counts,
    uniform: geometry.uniform,
    maxAdaptive: geometry.maxAdaptive,
    tilesX: geometry.tilesX,
    rows: geometry.rows,
  }
}

/** Asks the screen probes' kernels of the device at a frame's entry, off the frame, once the image is lit by the probes' level
 *  (the blue noise they read is asked beside them, `askBlueNoise`): the kernels compile off the frame (`track`) and the image is
 *  drawn without the probes meanwhile, never compiling a kernel itself. */
export function askScreenProbes(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!screenProbesCast(rt)) return
  const store = (rt.bounce.screen ??= createScreenProbeStore())
  store.kernelsFor(device, store.read(rt.context))
}

/** Whether the view's screen probes still build their history: the last image cast them, the history is temporal, and fewer
 *  images were cast than the frames it holds at most — a quiet view is drawn again till then, not held on a history of one image. */
export function screenProbesSettling(rt: WebgpuPagesRuntime) {
  const view = rt.gpu.screenProbes,
    store = rt.bounce.screen
  if (!view?.indirect || !store) return false
  const settings = store.read(rt.context)
  return settings.values.screenProbeTemporal && view.frame < settings.maxFramesAccumulated
}
