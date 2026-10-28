import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { RayTracing } from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import type { SurfaceCacheSettings } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import { directLayerStale } from './directLayer.ts'
import {
  readCutSetting,
  viewDistanceFactor,
} from '../../../../../sdk-core/src/contracts/cutOptions.ts'
import type { SurfaceCache } from '../../../../../sdk-core/src/lighting/surfaceCache/state.ts'
import { SURFACE_CACHE_LIGHTING_PASS } from '../../../diagnostic/stage/passLabels.ts'
import type { CutTables } from '../../../geometry/dag/cut/cutReaders.ts'
import type { DagReadTables } from '../../../geometry/dag/shader/bindings.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { LazyComputePass } from '../../../gpu/core/lazyComputePass.ts'
import { groupWidth } from '../../../gpu/dispatch/grid.ts'
import { noiseViewOn } from '../../../gpu/noise/blueNoiseTextures.ts'
import type { SkyLightReadSet } from '../../../modules/sky/skyLight/read.ts'
import type { CloudShadowSet } from '../../atmosphere/cloudShadowRead.ts'
import type { GlobalFieldRead } from '../../distanceField/view.ts'
import {
  ensureSceneTrace,
  sceneTraceWords,
  type SceneTrace,
  type SceneTraceWords,
} from '../../rays/sceneTrace/sceneTraceResources.ts'
import type { SurfaceHitResources } from '../hitWgsl.ts'
import { cacheRootsOf } from '../placements.ts'
import { clearLayer, type SurfaceAtlases } from '../atlases.ts'
import type { SurfaceTables } from '../tables.ts'
import {
  fixedKernels,
  shapedKernels,
  tracedRadiosityKernels,
  tracedShadowKernels,
  type ShapedKernels,
} from './kernels.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import type { LightProfileResources } from '../../lightProfile/profileBindings.ts'
import {
  lightFunctionFormatOf,
  lightFunctionSlotSize,
  markStandalonePending,
} from '../../lightFunction/frame.ts'
import { LIGHTING_PARAMS, lightSlotsOf, standaloneScratchAt } from './layout.ts'
import {
  createStandaloneState,
  disposeStandaloneState,
  readyStandalone,
  uploadStandalone,
  type StandaloneState,
} from './lightFunctionPass.ts'
import {
  contextPasses,
  directPasses,
  radiosityPasses,
  type Encoding,
  type TracedScene,
  type TracedShadows,
} from './passes.ts'
import {
  feedbackWritten,
  shapeOf,
  traceViewOf,
  tracedRaysFit,
  writeLightingParams,
  type BufferLimits,
  type LightingImage,
  type LightingShape,
} from './params.ts'
import {
  ensureLighting,
  ensureLightSlots,
  ensureStandaloneScratch,
  ensureTracedShadows,
  type LightingResources,
  type LightSlots,
  type StandaloneScratch,
  type TracedShadowBuffers,
} from './resources.ts'

/**
 * THE SURFACE CACHE'S LIGHTING FOR AN IMAGE, in the order the reference runs it, in one compute pass:
 *
 * 1. the update context (`contextWgsl.ts`): which tiles of which pages are lit this image;
 * 2. the direct light: the depth range of each tile (`tileDepthRangeWgsl.ts`, where the lights are culled to it), the lights of each tile
 *    (`cullWgsl.ts`) gathered into light tiles, placed by slot and compacted (`lightTilesWgsl.ts`), the light functions
 *    the atlas holds no slot of, evaluated at the texels of the light tiles of their lights (`lightFunctionPassWgsl.ts`), their light on its texels (`directWgsl.ts`), the final light
 *    of the tiles combined (`combineWgsl.ts`). Where the scene has acceleration structures
 *    (`surfaceCacheDirectLightingHardwareRayTracing`) the light's shadows come between the lights of the tiles and their
 *    light: the masks of each light on each tile (`shadowMaskWgsl.ts`), the traces they list counted and traced through the
 *    scene's triangles (`shadowTraceWgsl.ts`, the scene trace of `../../rays/sceneTrace/`);
 * 3. the radiosity: the probes' tiles, a ray a thread through the scene's triangles where the scene has acceleration structures
 *    (`surfaceCacheRadiosityHardwareRayTracing`, the scene trace as the traced shadows' is) else through the global distance
 *    field, the rays filtered, projected on the harmonics, the indirect light of the texels integrated, and the final light of
 *    its tiles combined again (`radiosityBuildWgsl.ts`, `radiosityTraceWgsl.ts`, `radiosityFilterWgsl.ts`,
 *    `radiosityIntegrateWgsl.ts`).
 *
 * What the image has not made — the pipelines still compiling, the budget refusing the memory — leaves the lighting where it was
 * and says so (`why`); the programs of the rays through the scene's triangles alone are not waited for: until they are
 * compiled, and where the cut has no tables or the buffers do not fit the device or its budget,
 * the image's shadows and radiosity rays are the distance field's. The traced shadows' memory and the scene trace are the
 * state's own, made when they are wanted and given back when they are not: they are no part of the lighting's shape. The scene
 * trace is also the other rays' (`SceneRays`, `inputs.probes`): the radiance cache, the screen probes and the reflections cast
 * theirs through it, each as its own program compiles, where the image has it. The pages' light settles over images after a change (`settle`: the images the updates take to cycle the atlas and blend): while
 * it does, the frame is not held.
 */

/** What an image's lighting reads that the frame holds: the lights, the sky, the clouds' shade, the light functions, the field. */
export interface LightingInputs {
  readonly lights: GPUBuffer
  readonly sky: SkyLightReadSet
  readonly cloudShadow: CloudShadowSet
  readonly lightFunction: GPUTextureView
  /** The light profiles' atlas and sampler, the stand-in's where the scene names none (a lane of 0 never samples it). */
  readonly lightProfile: LightProfileResources
  readonly field: GlobalFieldRead
  /** What the radiosity's rays read of the cache at their hits (`surfaceHitReads`). */
  readonly hit: SurfaceHitResources
  /** The buffer the rays that read the cards write their feedback into, none while the image writes none (`feedbackBuffer.ts`). */
  readonly feedback?: GPUBuffer
  /** The unit vector the camera looks along, which the scene trace's culling of the placements reads. */
  readonly direction: readonly [number, number, number]
  /** The image's own numbers (`LightingImage`, less what the cache gives). */
  readonly image: Omit<
    LightingImage,
    'frame' | 'pages' | 'historyLost' | 'feedback' | 'tracedRadiosity' | 'scratchAt'
  >
  /** Changes when the lights' transport does: the lighting then settles again. */
  readonly transportEpoch: number
  /** Whether the radiance cache of the world's probes, the screen probes or the reflections cast their rays through the scene's triangles this image: the
   *  scene trace is then made for them as well (`SceneRays`), whatever the lighting's own rays are. */
  readonly probes: boolean
}

/**
 * The scene trace of an image that the radiance cache of the world's probes, the screen probes and the reflections cast their rays through
 * (`bounce/cache/`, `bounce/screen/`, `reflections/`), the one the lighting's traced rays use: its parameters are written for the image's eye `frame`
 * and the cut's tables `views` it traces beside, the depth bias the cards are read at a hit with and the nearest hit that lights
 * anything, in centimetres, and the way a ray avoids the geometry it starts on (`selfIntersections`,
 * `surfaceCacheHardwareRayTracingAvoidSelfIntersections`). Only the image `frame` it was made for may use it.
 */
export interface SceneRays {
  readonly sceneTrace: SceneTrace
  readonly views: DagReadTables
  readonly depthBias: number
  readonly minHitDistance: number
  readonly selfIntersections: number
  readonly frame: number
}

/** What the surface cache keeps of its lighting. */
export interface SurfaceLightingState {
  shaped?: ShapedKernels
  resources?: LightingResources
  readonly words: Uint32Array<ArrayBuffer>
  readonly pass: LazyComputePass
  /** Why the lighting is not made, or why its traced shadows are not, the distance field then lighting them (a budget
   *  that refused their memory, or buffers past the device's limits); none while all is. */
  why: string | null
  /** The images it still takes to settle. */
  settle: number
  /** Whether the light has begun: its inputs were ready once (`lightInputsReady`), and the image number it began at (`noiseFrame`). */
  begun: boolean
  begunAt?: number
  /** The view's stochastic rank (`stochasticPhase`) at that image: the phases that follow the light count from it (`lightingPhase`). */
  begunSample?: number
  /** The feedback clock (`SurfaceCache.feedbackFrame`) at that image: the places the rays write their feedback in the tile count from it. */
  begunFeedback?: number
  epoch: number
  /** Whether the radiosity's history is lost: the atlases or the lighting's memory were made again. */
  historyLost: boolean
  /** Whether the direct-light layer of the atlas may hold light: true until an image has found the direct light off. */
  directHeld: boolean
  /** The traced shadows' memory: their masks and traces, and the scene trace made for the acceleration structures
   *  (the radiosity's traced rays use it too). */
  tracedBuffers?: TracedShadowBuffers
  /** The counters of the light tiles of the scene's lights and the arguments of the dispatches over them, for as many light slots as its lights need. */
  lightSlots?: LightSlots
  sceneTrace?: SceneTrace
  /** The scene trace the last image made for the world probes' rays, none where it made none (`sceneRaysOf`). */
  rays?: SceneRays
  /** What evaluating the light functions the atlas holds no slot of keeps (`lightFunctionPass.ts`), and, where the shadows are
   *  not traced and such a light function is, the scratch it writes to alone. */
  standalone?: StandaloneState
  scratchBuffers?: StandaloneScratch
}

/** The scene trace the lighting made for the world probes' rays in the image `frame`, none where it made none in that image. */
export const sceneRaysOf = (state: SurfaceLightingState | undefined, frame: number) =>
  state?.rays?.frame === frame ? state.rays : undefined

export function createSurfaceLighting(): SurfaceLightingState {
  return {
    words: new Uint32Array(new ArrayBuffer(LIGHTING_PARAMS.words * 4)),
    pass: new LazyComputePass(SURFACE_CACHE_LIGHTING_PASS),
    why: null,
    settle: 0,
    begun: false,
    epoch: NaN,
    historyLost: true,
    directHeld: true,
  }
}

/** The images the updates take to cycle the atlas and, with the radiosity, to blend: the larger factor times the blend. */
export function settleImages(settings: SurfaceCacheSettings) {
  const blend = settings.surfaceCacheRadiosity
    ? settings.surfaceCacheRadiosityTemporalMaxFramesAccumulated
    : 1
  const cycle = Math.max(
    settings.surfaceCacheDirectLightingUpdateFactor,
    settings.surfaceCacheRadiosity ? settings.surfaceCacheRadiosityUpdateFactor : 0,
  )
  return ceilDiv(cycle * blend, settings.surfaceCacheLightingUpdateSpeed)
}

/** What the lighting is made of for this image, or why it is not: the resources and the kernels, compiled. */
function prepared(
  state: SurfaceLightingState,
  device: GPUDevice,
  shape: LightingShape,
  format: AtlasFormat,
) {
  const made = ensureLighting(state.resources, device, shape)
  state.why = made.why ?? null
  if (made.resources !== state.resources) state.historyLost = true
  state.resources = made.resources
  if (!state.resources) return undefined
  const { shaped } = state
  if (!shaped || shaped.maxLights !== shape.maxLights || shaped.compressed !== shape.compressed)
    state.shaped = shapedKernels(device, shape.maxLights, shape.compressed)
  const fixed = fixedKernels(device, format)
  const ready = state.shaped!.cull.ready && state.shaped!.combine.ready
  return ready && Object.values(fixed).every((kernel) => kernel.ready)
    ? {
        resources: state.resources,
        shaped: state.shaped!,
        fixed,
      }
    : undefined
}

/** Gives back the traced shadows' memory: the state holds none after. */
function releaseShadowBuffers(state: SurfaceLightingState) {
  state.tracedBuffers?.dispose()
  state.tracedBuffers = undefined
}

/** Gives back the scratch of the light functions that is not the masks': the state holds none after. */
function releaseScratch(state: SurfaceLightingState) {
  state.scratchBuffers?.dispose()
  state.scratchBuffers = undefined
}

/** Gives back the traced shadows' memory and the scene trace: the state holds none after. */
function releaseTraced(state: SurfaceLightingState) {
  releaseShadowBuffers(state)
  state.sceneTrace?.dispose()
  state.sceneTrace = undefined
  state.rays = undefined
}

/** What the rays of an image through the scene's triangles are made from — the traced shadows', the radiosity's and the world probes': the scene's file,
 *  the cut's tables and the programs, the light tiles the shadows are sized by (none where only the radiosity is traced) and the
 *  placements — or the first condition they lack, `keep` where it is a wait (for the cut's tables, for the programs that compile
 *  off the frame) that leaves the memory they hold, `refused` where the device refuses the buffers outright: said in `state.why`,
 *  beside the budget's refusals. */
type TracedNeeds =
  | { readonly why: string; readonly keep?: boolean; readonly refused?: boolean }
  | {
      readonly why?: undefined
      readonly keep?: undefined
      /** The shadows were wanted and their buffers do not fit the device: the radiosity's rays alone are traced. */
      readonly refused: boolean
      readonly file: RayTracing
      readonly cut: CutTables
      readonly shadows?: ReturnType<typeof tracedShadowKernels>
      readonly radiosity?: ReturnType<typeof tracedRadiosityKernels>
      readonly lightTiles: number
      readonly placements: number
    }

/** Why the device's limits keep rays out of the scene's triangles. */
const TRACED_REFUSED = "the device's limits leave no room for the traced rays' buffers"

/** `kernels` where every one of them has compiled, else none. */
const compiled = <K extends Record<string, { readonly ready: boolean }>>(kernels: K | undefined) =>
  kernels && Object.values(kernels).every((kernel) => kernel.ready) ? kernels : undefined

/** Which of the traced shadows and the traced radiosity the settings ask for. */
function tracedWanted(settings: SurfaceCacheSettings, shape: LightingShape) {
  return {
    shadows:
      settings.surfaceCacheDirectLighting && settings.surfaceCacheDirectLightingHardwareRayTracing,
    radiosity: shape.radiosity && settings.surfaceCacheRadiosityHardwareRayTracing,
  }
}

/** Whether the rays that need the scene trace's buffers alone (the radiosity's and the probes') have room: shadows whose buffers do not
 *  fit the device leave them their rays. */
function tracedAloneFits(
  limits: BufferLimits,
  wanted: boolean,
  scene: SceneTraceWords,
  format: AtlasFormat,
) {
  return wanted && tracedRaysFit(limits, 0, scene, format, false)
}

/**
 * What the rays of this image through the scene's triangles need, or the first condition they lack: neither the direct light's
 * traced shadows nor the radiosity's traced rays nor the world probes' (`probes`, whose program the radiance cache compiles and waits
 * for itself) wanted, the scene without acceleration structures, buffers that do not fit the device, the cut without tables,
 * programs not compiled yet.
 */
function tracedNeeds(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  settings: SurfaceCacheSettings,
  shape: LightingShape,
  probes: boolean,
  format: AtlasFormat,
  scratch: boolean,
): TracedNeeds {
  const { shadows, radiosity } = tracedWanted(settings, shape)
  if (!shadows && !radiosity && !probes)
    return {
      why: "neither the traced shadows nor the radiosity's nor the probes' traced rays are on",
    }
  const file = rt.context.rayTracing
  if (!file) return { why: 'the scene has no acceleration structures' }
  const selection = rt.run.gpuSelection
  const placements = rt.layout.selectionRoots.length
  const scene = sceneTraceWords(file, placements, selection)
  const wantedTiles = shadows ? shape.directTiles * shape.maxLights : 0
  const shadowsFit = shadows && tracedRaysFit(device.limits, wantedTiles, scene, format, scratch)
  if (!shadowsFit && !tracedAloneFits(device.limits, radiosity || probes, scene, format))
    return { why: TRACED_REFUSED, refused: true }
  const lightTiles = shadowsFit ? wantedTiles : 0
  const cut = selection?.cutTables()
  if (!cut) return { why: 'the cut has no tables yet', keep: true }
  // The programs compile off the frame, only those of what is traced, each feature on its own: until a feature's are ready its
  // rays are the distance field's.
  const traced = {
    shadows: compiled(shadowsFit ? tracedShadowKernels(device, format) : undefined),
    radiosity: compiled(radiosity ? tracedRadiosityKernels(device) : undefined),
  }
  if (!traced.shadows && !traced.radiosity && !probes)
    return { why: "the traced rays' programs are not compiled", keep: true }
  return { file, cut, ...traced, lightTiles, placements, refused: shadows && !shadowsFit }
}

/**
 * The scene the rays of this image are cast through, and the traced shadows made over it, or none where `tracedNeeds` says
 * they are not made — the image then lights through the distance field. Where none is wanted (not for the cut or the programs,
 * which are waited for) the memory they held is given back. Else the scene trace, made once for its size and file — where the
 * device's budget refuses it, `state.why` says so —, its table of placements brought level with the cut's roots and its
 * parameters written for the image's eye; and, where the shadows are traced, their buffers, made once for their size (the
 * memory of the shadows alone is given back where only the radiosity is traced). Where the world probes' rays are cast through it
 * too (`probes`), the scene trace is handed out for the image (`SceneRays`).
 */
function tracedOf(
  state: SurfaceLightingState,
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  settings: SurfaceCacheSettings,
  shape: LightingShape,
  eye: ArrayLike<number>,
  direction: LightingInputs['direction'],
  probes: boolean,
  format: AtlasFormat,
  scratch: boolean,
): { traced?: TracedShadows; scene?: TracedScene; rays?: SceneRays } {
  const needs = tracedNeeds(rt, device, settings, shape, probes, format, scratch)
  if (needs.why !== undefined) {
    if (needs.refused) state.why = needs.why
    if (!needs.keep) releaseTraced(state)
    return {}
  }
  const { file, cut, shadows, radiosity, lightTiles, placements } = needs
  if (needs.refused) state.why = TRACED_REFUSED
  if (shadows) {
    const held = ensureTracedShadows(state.tracedBuffers, device, lightTiles, format, scratch)
    state.tracedBuffers = held.resources
    state.why = held.why ?? state.why
  } else releaseShadowBuffers(state)
  const made = ensureSceneTrace(state.sceneTrace, device, file, placements, rt.run.gpuSelection)
  const { sceneTrace } = made
  state.sceneTrace = sceneTrace
  state.why = made.why ?? state.why
  if (!sceneTrace) return {}
  sceneTrace.syncPlacements(rt.layout.selectionRoots, rt.run.gpuSelection, cacheRootsOf(rt))
  sceneTrace.writeParams(
    traceViewOf(settings, eye, direction, cut.treeRoot, {
      scale: viewDistanceFactor(rt),
      culled: readCutSetting(rt, 'cutDrawDistanceCulling'),
    }),
  )
  const views = cut.views
  return {
    rays: probes
      ? {
          sceneTrace,
          views,
          depthBias: settings.surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias,
          minHitDistance:
            settings.surfaceCacheHardwareRayTracingMinTraceDistanceToSampleSurfaceCache,
          selfIntersections: settings.surfaceCacheHardwareRayTracingAvoidSelfIntersections,
          frame: rt.run.frame,
        }
      : undefined,
    scene: radiosity && { kernels: radiosity, sceneTrace, views },
    traced:
      shadows && state.tracedBuffers
        ? { kernels: shadows, sceneTrace, views, buffers: state.tracedBuffers }
        : undefined,
  }
}

/** The image's parameters written to the lighting's buffer; a new transport epoch restarts the settling of the light. */
function uploadParams(
  state: SurfaceLightingState,
  device: GPUDevice,
  params: GPUBuffer,
  cache: SurfaceCache,
  settings: SurfaceCacheSettings,
  shape: LightingShape,
  inputs: LightingInputs,
  traces: Pick<LightingImage, 'feedback' | 'tracedRadiosity' | 'scratchAt'>,
) {
  if (inputs.transportEpoch !== state.epoch) {
    state.epoch = inputs.transportEpoch
    state.settle = settleImages(settings)
  }
  writeLightingParams(state.words, shape, settings, {
    ...inputs.image,
    frame: cache.frame,
    pages: cache.pages.length,
    historyLost: state.historyLost,
    ...traces,
  })
  state.historyLost = false
  device.queue.writeBuffer(params, 0, state.words)
}

/**
 * Lights the surface cache for this image on `encoder`: `lit`, or `waiting` for the programs to compile, or `none` where it
 * has nothing to light or no memory to do it in (`state.why` says why).
 */
export function encodeLighting(
  state: SurfaceLightingState,
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cache: SurfaceCache,
  settings: SurfaceCacheSettings,
  atlases: SurfaceAtlases,
  tables: SurfaceTables,
  inputs: LightingInputs,
) {
  const shape = shapeOf(settings, atlases.side, atlases.compressed)
  const format = lightFunctionFormatOf(rt)
  const ready = prepared(state, device, shape, format)
  if (!ready) return state.resources ? 'waiting' : 'none'
  if (!tables.buffer || !cache.pages.length) return 'none'
  const slots = lightSlotsOf(rt.lights.store.capacity)
  const slotted = ensureLightSlots(state.lightSlots, device, slots)
  state.lightSlots = slotted.resources
  if (!slotted.resources) {
    state.why = slotted.why ?? state.why
    return 'none'
  }
  // The light functions the atlas holds no slot of: those ready are evaluated into a scratch, in the masks' buffer where the shadows
  // are traced, else in a buffer of its own; where that cannot be made they are lit as if they wore none.
  const standalone = (state.standalone ??= createStandaloneState(device))
  const apart = readyStandalone(rt, device, lightFunctionSlotSize(rt, device))
  markStandalonePending(rt, apart.pending)
  const { traced, scene, rays } = tracedOf(
    state,
    rt,
    device,
    settings,
    shape,
    inputs.image.eye,
    inputs.direction,
    inputs.probes,
    format,
    apart.ready.length > 0,
  )
  state.rays = rays
  const lightTiles = shape.directTiles * shape.maxLights
  let scratch: GPUBuffer | undefined
  let lightFunctions = apart.ready
  if (lightFunctions.length && !traced) {
    const made = ensureStandaloneScratch(state.scratchBuffers, device, lightTiles)
    state.scratchBuffers = made.resources
    state.why = made.why ?? state.why
    scratch = made.resources?.scratch
    if (!scratch) lightFunctions = []
  } else releaseScratch(state)
  uploadParams(state, device, ready.resources.params, cache, settings, shape, inputs, {
    feedback: feedbackWritten(inputs.feedback, rt.context.rayTracing),
    tracedRadiosity: !!scene,
    scratchAt: traced ? standaloneScratchAt(lightTiles, format) : 0,
  })
  // The placements the rays of this image can meet are chosen once, before any ray is cast.
  const placed = traced || scene || rays
  if (placed) placed.sceneTrace.cullPlacements(encoder, placed.views)
  // The direct light off, every texel of its layer holds none, the listed tiles' and the others' alike: cleared once, as it turns off.
  if (directLayerStale(state, settings)) clearLayer(encoder, 'direct', atlases.physical.direct)
  const encoding: Encoding = {
    ...ready,
    lightSlots: slotted.resources,
    slots,
    pass: state.pass.begin(encoder).pass,
    atlases,
    tables: tables.buffer,
    inputs,
    hit: inputs.hit,
    noise: noiseViewOn(device),
    width: groupWidth(device.limits),
    pages: cache.pages.length,
    indirectTiles: shape.indirectTiles,
    filtered:
      settings.surfaceCacheRadiositySpatialFilterProbes &&
      settings.surfaceCacheRadiositySpatialFilterProbesKernelSize > 0,
    cullToTileDepthRange: settings.surfaceCacheDirectLightingCullToTileDepthRange,
    traced,
    scene,
    standalone: uploadStandalone(standalone, rt, device, lightFunctions),
    scratch,
  }
  contextPasses(encoding)
  directPasses(encoding)
  if (shape.radiosity) radiosityPasses(encoding)
  state.pass.end()
  state.settle = Math.max(0, state.settle - 1)
  return 'lit'
}

/** Gives back the lighting's memory: the state of `owner` holds none after. */
export function disposeSurfaceLighting(owner: { lighting?: SurfaceLightingState }) {
  const lighting = owner.lighting
  if (!lighting) return
  lighting.resources?.dispose()
  lighting.lightSlots?.dispose()
  releaseTraced(lighting)
  releaseScratch(lighting)
  if (lighting.standalone) disposeStandaloneState(lighting.standalone)
  owner.lighting = undefined
}
