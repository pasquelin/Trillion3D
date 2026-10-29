import { meshStageOf, meshTraceSettingsOf, wantsMeshStage } from './meshStage.ts'
import { imagesSinceChange } from '../../../frame/render/noiseFrame.ts'
import { skyLightReadOf } from '../../../frame/render/skyLightState.ts'
import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { ReflectionSettings } from '../../../../../sdk-core/src/contracts/reflectionOptions.ts'
import type { ScreenProbeFrameMetrics } from '../../../../../sdk-core/src/contracts/shadowMetrics.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { readHizSetting } from '../../../../../sdk-core/src/contracts/hizOptions.ts'
import { screenRelativeThickness } from '../../../visibility/hiz/gpu/screenSlab.ts'
import { blueNoiseNow, blueNoiseRefused } from '../../../gpu/noise/blueNoiseTextures.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { lightAtlasFormat, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { FLAGS_VIEW, viewOf } from '../../../materials/surface/surfaceOutputs.ts'
import { waterFrontOf } from '../../../blend/water/waterReflection.ts'
import {
  reflectionSceneGroup,
  reflectionGroup,
  reflectionLightView,
} from '../../reflections/group.ts'
import { rayFogReadOf } from '../../reflections/rayFog.ts'
import { demandSurfaceCache, surfaceHitReads } from '../../surfaceCache/frame.ts'
import { sceneRaysOf, type SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import type { MarkProbes } from '../pool/pool.ts'
import { lightingPhase } from '../../surfaceCache/lighting/phase.ts'
import { castsThroughTriangles, screenProbesCast, screenProbesCut } from './cast.ts'
import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { encodeOcclusionOnly } from './encode.ts'
import { OCCLUSION_BINDINGS } from './occlusionWgsl.ts'
import {
  ensureFieldOcclusion,
  type FieldOcclusion,
  fieldOcclusionGeometry,
  fieldOcclusionSettings,
  fieldSearchesOcclusion,
} from './occlusionOnly.ts'
import { followHistory, imagesToForget, probeInputsReady } from './historyReady.ts'
import {
  encodeProbePlacement,
  encodeProbeTrace,
  type CastRun,
  type ScreenProbeRun,
} from './encode.ts'
import { createScreenProbeGroups, type ScreenProbeGroups } from './groups.ts'
import { passRanks, type ScreenProbeInputs } from './groupParts.ts'
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
    traced?: boolean
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
    raysPerImage: g && settings.enabled ? (g.uniform + g.maxAdaptive) * g.tracing * g.tracing : 0,
    atlas: g && settings.enabled ? [g.tilesX, g.rows] : [0, 0],
    history: !!read.history,
    screenTraces: settings.enabled && !!read.screen && settings.values.screenProbeScreenTraces,
    sceneTraces: !!g && settings.enabled && settings.values.screenProbeSceneTraces,
    meshTraces: !!read.traced,
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

/** The frame's resources the probes read, handed to `placeProbes`. */
type Needed = NonNullable<ReturnType<typeof neededOf>>

const BASE_VIEW = viewOf('baseMetal')
const NORMALS_VIEW = viewOf('normalRough')
const EMISSIVE_AO_VIEW = viewOf('emissiveAo')

/** What the groups name of the frame, filled in `store.inputs` (made on the first image, then written over, nothing allocated): its normals, flags and lobes, its base colours and metalness and its emission and occlusion, the lights, the cascades (or the lighting's stand-ins), the global
 *  distance field the rays are marched through and the surface cache their hits read, the vectors of the image (or the stand-in of
 *  none) and the blue noise (made: the image asked for it before it cast). */
function inputsOf(
  rt: WebgpuPagesRuntime,
  { device, surfaces, deferred, lights, noise }: Needed,
  store: ScreenProbeStore,
  vectors: GPUTextureView | undefined,
  light: LightAtlasFormat,
): ScreenProbeInputs {
  const frames = surfaces.views(),
    probes = rt.bounce.probes
  const cache = probes?.cache.views ?? store.noCache(device, light)
  // The groups tell a change by each resource they name (`createScreenProbeGroups`), not by the object that holds them.
  const inputs = (store.inputs ??= {} as ScreenProbeInputs)
  inputs.normals = frames[NORMALS_VIEW]
  inputs.flags = frames[FLAGS_VIEW]
  inputs.base = frames[BASE_VIEW]
  inputs.emissiveAo = frames[EMISSIVE_AO_VIEW]
  inputs.lobes = surfaces.lobesView
  inputs.lights = lights
  inputs.fog = rayFogReadOf(rt.gpu, deferred.placeholders)
  inputs.bounceGrid = probes?.uniform ?? deferred.placeholders.bounceGrid
  inputs.probes = probes?.table ?? deferred.placeholders.probes
  surfaceHitReads(rt, device, inputs, light)
  inputs.vectors = vectors ?? store.noVectors(device)
  inputs.blue = noise.view
  inputs.cacheFinal = cache.final
  inputs.cacheRaw = cache.raw
  inputs.cacheSky = cache.sky
  return inputs
}

/** The groups of the view for the kernels and the filter's passes asked: made again where either changed (each pass has a group of its own),
 *  the history dropped where the passes' parity did (the rays read the gathered texture the last passes wrote). The passes' uniforms are
 *  made again only where their count changed. */
function groupsOf(
  view: ScreenProbeView,
  device: GPUDevice,
  kernels: NonNullable<ScreenProbeView['kernels']>,
  settings: ScreenProbeSettings,
) {
  const passes = settings.spatialFilterPasses
  let ranks = view.ranks
  if (!ranks || view.passes !== passes) {
    if (view.passes !== undefined && (view.passes & 1) !== (passes & 1)) view.history = false
    view.passes = passes
    // The passes' uniforms of the groups it replaces may still be named by this image's commands: they go with the frame's retire list.
    if (ranks) retire(device, ranks)
    ranks = view.ranks = passRanks(device, passes)
    view.groups = undefined
  }
  if (view.kernels !== kernels || !view.groups) {
    view.kernels = kernels
    view.groups = createScreenProbeGroups(device, kernels, view.resources, ranks.buffers)
  }
  return view.groups
}

/** What the lighting is told of the probes (`mode`, the bits of the parameters' mode word it reads): the setting's occlusion strengths and albedo ceiling, and the mode. */
export function tellLighting(
  deferred: Pick<Needed['deferred'], 'setScreenProbes'>,
  settings: ScreenProbeSettings,
  mode: number,
) {
  const { values } = settings
  deferred.setScreenProbes(
    settings.occlusionFoliageStrength,
    values.screenProbeOcclusionMaxAlbedo,
    values.screenProbeOcclusionIntensity,
    mode,
  )
}

/** The lighting told the probes left it nothing this image: it reads their occlusion alone, which is none, over the sky light's irradiance (mode bit 0),
 *  never the black a pixel the probes could not read has where they gather — except where the host switched the probes off under a bounce it asked (`screenProbesCut`):
 *  their light is then told, none of it left, so the pixels are black, as the reference's are with its screen probe gather off. */
function leaveToSkyLight(rt: WebgpuPagesRuntime, settings: ScreenProbeSettings) {
  if (rt.gpu.deferred) tellLighting(rt.gpu.deferred, settings, screenProbesCut(rt) ? 0 : 1)
}

/** The result handed to the lighting, and the view moved on to its next image. */
function handOver(
  needed: Needed,
  state: ScreenProbeView,
  settings: ScreenProbeSettings,
  ready: boolean,
) {
  tellLighting(
    needed.deferred,
    settings,
    (settings.backfaceDiffuse ? 0 : 2) +
      (settings.occlusion && settings.values.screenProbeShortRangeAOApplyDuringIntegration ? 4 : 0),
  )
  state.indirect = state.resources.history[state.turn]
  state.shortRangeGi = settings.shortRangeGi
    ? state.resources.shortRangeGiHistory[state.turn]
    : undefined
  state.viewProjection.set(needed.reflection.frame.viewProjection)
  state.turn = (1 - state.turn) as 0 | 1
  followHistory(state, ready)
}

/** An image of probes placed and not yet traced: what its trace and its hand-over to the lighting read. */
interface PlacedProbes {
  /** The probes just placed, which the pool's pass marks the cells they stand in from. */
  marks: MarkProbes
  store: ScreenProbeStore
  needed: Needed
  state: ScreenProbeView
  settings: ScreenProbeSettings
  run: ScreenProbeRun
  /** The run of the probes placed (`encodeProbePlacement`). */
  cast: CastRun
  geometry: ScreenProbeGeometry
  /** What the image read of the last one, and whether its rays went through the scene's triangles, for its metrics. */
  read: { history: boolean; screen: boolean; velocity: boolean; traced: boolean }
}

/** Writes the parameters of an image: the stochastic phase, what the image reads of the last one (`read`),
 *  the radiance cache where it is on, and the thickness and depth settings. */
function writeImageParameters(
  rt: WebgpuPagesRuntime,
  state: Pick<ScreenProbeView, 'write' | 'previousInverse'>,
  geometry: ScreenProbeGeometry,
  settings: ScreenProbeSettings,
  reflection: Needed['reflection'],
  { history, screen, velocity }: PlacedProbes['read'],
  lobes: ReflectionSettings,
  rays: SceneRays | undefined,
) {
  const { held } = reflection.lit
  const cacheViews = rt.bounce.probes?.cache.views
  const phase = lightingPhase(rt)
  invertMatrix4(state.previousInverse, held.viewProjection)
  state.write(geometry, settings, {
    frame: phase,
    previousFrame: Math.max(phase - 1, 0),
    history,
    screen,
    cache: !!cacheViews && settings.radianceCache,
    velocity,
    previousInverse: state.previousInverse,
    relativeThickness: screenRelativeThickness(
      reflection.frame.viewProjection,
      settings.values.screenProbeRelativeDepthThickness,
    ),
    depthThicknessScale: screenRelativeThickness(reflection.frame.viewProjection, 1),
    historyThickness: screenRelativeThickness(
      reflection.frame.viewProjection,
      settings.values.screenProbeHistoryDepthTestThickness,
    ),
    fullResDepth: readHizSetting(rt, 'hizFullResDepth'),
    skylightLeak: lobes.skylightLeakColor,
    roughSpecularFoliage: lobes.maxRoughnessEvaluateFoliage,
    posesMoving: !!rt.run.gpuSelection?.posesMoving,
    exactLight: settings.cache.light !== 'r11g11b10',
    rays,
  })
}

/**
 * The scene stage that casts the rays the screen left through the scene's triangles, or none where this image marches them through the
 * global distance field: the level casts probes with scene traces and `screenProbeHardwareRayTracing` on, the lighting made the scene
 * trace for this image (`sceneRaysOf`) and the stage's program is compiled (`ScreenProbeStore.tracedFor`, not waited for). The scene trace it
 * answers with is the one the image's parameters are written for.
 */
function tracedSceneOf(
  rt: WebgpuPagesRuntime,
  store: ScreenProbeStore,
  device: GPUDevice,
  settings: ScreenProbeSettings,
  groups: ScreenProbeGroups,
  light: LightAtlasFormat,
) {
  if (!castsThroughTriangles(settings.values)) return undefined
  const rays = sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame)
  const previous = rt.run.gpuSelection?.previous
  if (!rays || !previous) return undefined
  const kernel = store.tracedFor(device, settings, light)
  if (!kernel.ready) return undefined
  return {
    rays,
    traced: {
      pipeline: kernel.pipeline(),
      groups: groups.cast.tracedScene(kernel.layouts, rays, previous),
    },
  }
}

/**
 * The meshes' fields stage of this image (`wantsMeshStage`, `meshStageOf`): the scene's meshes culled to the view's grid and the stage's pipeline and group, or none while the trace is off, the scene stage
 * casts through triangles, or any resource is not ready (`ScreenProbeStore.meshesFor`, not waited for).
 */
function meshesOf(
  rt: WebgpuPagesRuntime,
  store: ScreenProbeStore,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  settings: ScreenProbeSettings,
  kernels: NonNullable<ScreenProbeView['kernels']>,
  traced: boolean,
  viewProjection: ArrayLike<number>,
) {
  const trace = meshTraceSettingsOf(rt)
  if (!wantsMeshStage(trace, settings.values.screenProbeSceneTraces, traced)) return undefined
  return meshStageOf(
    rt,
    device,
    encoder,
    store.meshes,
    store.meshesFor(device, settings, kernels),
    trace,
    viewProjection,
  )
}

/** Whether the history of the probes is read: the last image of the view left one, drawn with the view-projection the last lit image holds and at the same size. It is
 *  dropped as the reference drops it: on a cut of the view (`historyCut`) and when asked to be cleared at every image. */
function historyKept(
  rt: WebgpuPagesRuntime,
  state: ScreenProbeView,
  settings: ScreenProbeSettings,
  geometry: ReturnType<typeof imageGeometry>,
  reflection: Needed['reflection'],
) {
  const { held } = reflection.lit
  return (
    !rt.bounce.historyLost &&
    !reflection.frame.historyCut &&
    !settings.values.screenProbeClearHistoryEveryFrame &&
    !!state.history &&
    held.valid &&
    held.size[0] === geometry.width &&
    held.size[1] === geometry.height &&
    sameValues(held.viewProjection, state.viewProjection)
  )
}

/** The run of an image of probes: what the encoders of its passes read. */
function runOf(
  rt: WebgpuPagesRuntime,
  store: ScreenProbeStore,
  state: ScreenProbeView,
  kernels: NonNullable<ScreenProbeView['kernels']>,
  settings: ScreenProbeSettings,
  needed: Needed,
  bound: ScreenProbeRun['groups'],
  traced: ReturnType<typeof tracedSceneOf>,
  meshes: ScreenProbeRun['meshes'],
): ScreenProbeRun {
  const { device, reflection, depth, lightView } = needed
  return {
    kernels,
    resources: state.resources,
    groups: bound,
    reflection: reflectionGroup(reflection, depth, lightView, skyLightReadOf(rt)),
    sceneReflection: reflectionSceneGroup(reflection, lightView, skyLightReadOf(rt)),
    settings,
    cache: rt.bounce.probes?.cache,
    traced: traced?.traced,
    meshes,
    stage: stageOf(rt, store, device, settings, kernels),
  }
}

/**
 * The first half of an image of probes, over the frame's resources: the inputs the groups name, the history read only where the
 * last image of the view left one drawn with the view-projection the last lit image holds, at the same size,
 * the surfaces' vectors of this image read with it, the parameters written and the probes placed; the rest of the image is
 * `traceScreenProbes`.
 */
function placeProbes(
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
  const history = historyKept(rt, state, settings, geometry, reflection)
  const screen = reflection.frame.depthDrawn && held.valid
  const velocity = history && !!vectors
  const bound = groups(state.turn, inputsOf(rt, needed, store, vectors, kernels.features.light))
  const traced = tracedSceneOf(rt, store, device, settings, bound, kernels.features.light)
  const meshes = meshesOf(
    rt,
    store,
    device,
    encoder,
    settings,
    kernels,
    !!traced,
    reflection.frame.viewProjection,
  )
  const read = { history, screen, velocity, traced: !!traced }
  writeImageParameters(
    rt,
    state,
    geometry,
    settings,
    reflection,
    read,
    reflection.settings(rt.context, waterFrontOf(rt)),
    traced?.rays,
  )
  const run = runOf(rt, store, state, kernels, settings, needed, bound, traced, meshes)
  // The turn the records are marked from is this image's: the hand-over, after the trace, moves it on.
  const cast = encodeProbePlacement(encoder, run)
  return {
    marks: probesOf(state, geometry, state.turn),
    store,
    needed,
    state,
    settings,
    run,
    cast,
    geometry,
    read,
  }
}

/** The bind group of the field's occlusion pass, made again where what it names moved. */
function fieldOcclusionGroup(
  device: GPUDevice,
  run: FieldOcclusion,
  kernel: NonNullable<ReturnType<ScreenProbeStore['occlusionFor']>>,
  surfaces: Needed['surfaces'],
  noise: Needed['noise'],
) {
  const frames = surfaces.views()
  const normals = frames[NORMALS_VIEW]
  const flags = frames[FLAGS_VIEW]
  const { next } = run.identity
  next[0] = normals
  next[1] = flags
  next[2] = noise.view
  next[3] = kernel.layout
  if (!run.group || run.identity.moved())
    run.group = device.createBindGroup({
      layout: kernel.layout,
      entries: namedEntries(OCCLUSION_BINDINGS.at, {
        params: { buffer: run.params },
        normals,
        flags,
        occlusion: run.view,
        blue: noise.view,
      }),
    })
}

/**
 * THE FIELD'S SHORT-RANGE OCCLUSION of this image (`irradianceFieldShortRangeAORadius`, the reference's `ComputeScreenSpaceShortRangeAO` run for the field with a reach of twice the radius in pixels): the
 * screen probes' occlusion pass alone, over the tile the radius names, no probe cast and no temporal blend (the field's gather has none). Answers the amount it wrote and the pixels a texel stands for, none
 * while the pass compiles, the frame lacks the surfaces or the field searches none.
 */
export function encodeFieldOcclusion(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const store = (rt.bounce.screen ??= createScreenProbeStore())
  const base = store.read(rt.context)
  if (!fieldSearchesOcclusion(base)) {
    store.fieldOcclusion?.dispose()
    store.fieldOcclusion = undefined
    return undefined
  }
  const needed = neededOf(rt)
  if (!needed) return undefined
  const { device, reflection, depth, lightView, surfaces, noise } = needed
  const settings = fieldOcclusionSettings(base)
  const kernel = store.occlusionFor(device, settings)
  if (!kernel) return undefined
  const size = rt.gpu.targetSize
  const run = (store.fieldOcclusion = ensureFieldOcclusion(
    store.fieldOcclusion,
    device,
    size,
    settings,
  ))
  const geometry = fieldOcclusionGeometry(run, size, settings)
  const { held } = reflection.lit
  writeImageParameters(
    rt,
    run,
    geometry,
    settings,
    reflection,
    {
      history: false,
      screen: reflection.frame.depthDrawn && held.valid,
      velocity: false,
      traced: false,
    },
    reflection.settings(rt.context, waterFrontOf(rt)),
    undefined,
  )
  fieldOcclusionGroup(device, run, kernel, surfaces, noise)
  encodeOcclusionOnly(
    encoder,
    reflectionGroup(reflection, depth, lightView, skyLightReadOf(rt)),
    kernel.pipelines.occlusion,
    run.group!,
    geometry,
    settings.occlusionDownsample,
  )
  return { view: run.view, reduction: settings.occlusionDownsample, bent: settings.bentNormal }
}

/** The stage a pass of the frame added (`rt.bounce.stage`) with its kernel, where it is compiled and the radiance cache is there to read. */
function stageOf(
  rt: WebgpuPagesRuntime,
  store: ScreenProbeStore,
  device: GPUDevice,
  settings: ScreenProbeSettings,
  kernels: NonNullable<ScreenProbeView['kernels']>,
) {
  const added = rt.bounce.stage
  if (!added || !rt.bounce.probes?.cache) return undefined
  const started = store.stageFor(device, settings, kernels, added)
  return started.ready
    ? { pipeline: started.pipeline(), encode: (pass: GPUComputePassEncoder) => added.encode(pass) }
    : undefined
}

/** The view's probes given back, and the lighting left none to read. */
function release(rt: WebgpuPagesRuntime) {
  rt.gpu.screenProbes?.dispose()
  rt.gpu.screenProbes = undefined
}

/**
 * THE SCREEN PROBES OF THE IMAGE, in two halves (`placeScreenProbes`, `traceScreenProbes`) with the probe pool's pass between them,
 * after the depth pyramid and the reflections — which made the view's uniform and hold the last lit image — and before the lighting,
 * which reads what they leave (`ScreenProbeView.indirect`, named by `directLightResources`). An image that cannot cast them — no lit
 * surface, kernels still compiling, a device that refused them, a budget with no room — leaves the lighting none: its pixels then
 * take the sky light's irradiance, as they did before the screen probes. A level `'off'`, or no bounce, gives the view's probes back
 * altogether. The placement is encoded here, and answers the image placed — none where the image cast none —, which the trace takes.
 */
export function placeScreenProbes(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
): PlacedProbes | undefined {
  const { bounce, gpu } = rt
  const store = (bounce.screen ??= createScreenProbeStore())
  const settings = store.read(rt.context)
  if (!screenProbesCast(rt)) {
    release(rt)
    leaveToSkyLight(rt, settings)
    store.metrics = undefined
    return
  }
  const skip = (why: string) => {
    leaveToSkyLight(rt, settings)
    if (gpu.screenProbes) {
      gpu.screenProbes.indirect = undefined
      gpu.screenProbes.shortRangeGi = undefined
      gpu.screenProbes.history = false
    }
    store.metrics = metricsOf(
      settings,
      undefined,
      { bytes: gpu.screenProbes?.bytes, cacheBytes: rt.bounce.probes?.cache.bytes },
      why,
    )
    return undefined
  }
  const needed = neededOf(rt)
  if (!needed) return skip(noiseWhy(gpu.device) ?? 'no lit image to cast the probes on')
  const kernels = store.kernelsFor(
    needed.device,
    settings,
    cacheLightOf(rt, needed.device, settings),
  )
  if (!kernels) return skip(store.reason ?? 'the screen probes are compiling')
  const { view, why } = ensureScreenProbeView(
    gpu.screenProbes,
    needed.device,
    gpu.allocatedSize,
    settings,
  )
  gpu.screenProbes = view
  if (!view) return skip(why!)
  return placeProbes(rt, encoder, needed, store, view, kernels, settings)
}

/** The second half of the screen probes of the image, once the pool's pass has marked the cells the placed probes stand in: the rays
 *  chosen and traced, the filter, the pixels shaded, the result handed to the lighting and the metrics of what the image cast.
 *  Nothing where the image could not cast (`placeScreenProbes` answered none). */
export function traceScreenProbes(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  placed: PlacedProbes | undefined,
) {
  if (!placed) return
  const { store, needed, state, settings, run, cast, geometry, read } = placed
  encodeProbeTrace(encoder, run, cast)
  handOver(needed, state, settings, probeInputsReady(rt))
  store.metrics = metricsOf(
    settings,
    geometry,
    { ...read, bytes: state.bytes, cacheBytes: rt.bounce.probes?.cache.bytes },
    null,
  )
}

/** The probes of the view's turn `turn`, for the pool to mark the cells they stand in from (`../pool/pool.ts`): their records, the
 *  count of the adaptive ones placed and the shape of the atlas they lie in. */
function probesOf(view: ScreenProbeView, geometry: ScreenProbeGeometry, turn: number): MarkProbes {
  return {
    info: view.resources.info[turn],
    counts: view.resources.counts,
    uniform: geometry.uniform,
    maxAdaptive: geometry.maxAdaptive,
    tilesX: geometry.tilesX,
    rows: geometry.rows,
  }
}

/** The probes the view's last image cast, the records of the turn it took, the one this image's cast then takes in its turn; none
 *  where the last image cast none. */
export function lastCastProbes(view: ScreenProbeView | undefined): MarkProbes | undefined {
  const geometry = view?.image
  if (!view?.history || !geometry) return undefined
  return probesOf(view, geometry, 1 - view.turn)
}

/** The format the radiance cache's final maps are read in this image: that of the maps held, else the one the settings ask of the device. */
const cacheLightOf = (rt: WebgpuPagesRuntime, device: GPUDevice, settings: ScreenProbeSettings) =>
  rt.bounce.probes?.cache.views?.light ?? lightAtlasFormat(settings.cache.light, device.features)

/** Asks the screen probes' kernels of the device at a frame's entry, off the frame, once the image is lit by the probes' level
 *  (the blue noise they read is asked beside them, `askBlueNoise`): the kernels compile off the frame (`track`) and the image is
 *  drawn without the probes meanwhile, never compiling a kernel itself. */
export function askScreenProbes(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!screenProbesCast(rt)) return
  const store = (rt.bounce.screen ??= createScreenProbeStore())
  const settings = store.read(rt.context)
  store.kernelsFor(device, settings, cacheLightOf(rt, device, settings))
}

/** Whether the view's screen probes still build their history: the last image cast them, the history is temporal, and fewer
 *  images were cast than the frames it holds at most — a quiet view is drawn again till then, not held on a history of one image —,
 *  or fewer than it takes the history to forget a change have passed since the view last changed (a texture tile landed, a light moved, a
 *  surface joined): the history follows the change by blending, it does not restart, and has taken it in only once the old light's share is
 *  under a display step (`imagesToForget`). */
export function screenProbesSettling(rt: WebgpuPagesRuntime) {
  const view = rt.gpu.screenProbes,
    store = rt.bounce.screen
  if (!view?.indirect || !store) return false
  const settings = store.read(rt.context)
  return (
    settings.values.screenProbeTemporal &&
    (view.frame < settings.maxFramesAccumulated ||
      imagesSinceChange(rt.run) < imagesToForget(settings.maxFramesAccumulated))
  )
}
