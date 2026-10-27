import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import type { RayTracing } from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import type { SurfaceCacheSettings } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import type { SurfaceCache } from '../../../../../sdk-core/src/lighting/surfaceCache/state.ts'
import { SURFACE_CACHE_LIGHTING_PASS } from '../../../diagnostic/stage/passLabels.ts'
import type { CutTables } from '../../../geometry/dag/cut/cutReaders.ts'
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
} from '../../rays/sceneTrace/sceneTraceResources.ts'
import type { SurfaceHitResources } from '../hitWgsl.ts'
import type { SurfaceAtlases } from '../atlases.ts'
import type { SurfaceTables } from '../tables.ts'
import {
  shapedKernels,
  staticKernels,
  tracedRadiosityKernels,
  tracedShadowKernels,
  type ShapedKernels,
} from './kernels.ts'
import { LIGHTING_PARAMS } from './layout.ts'
import {
  contextPasses,
  directPasses,
  radiosityPasses,
  type Encoding,
  type TracedScene,
  type TracedShadows,
} from './passes.ts'
import {
  shapeOf,
  tracedRaysFit,
  writeLightingParams,
  type LightingImage,
  type LightingShape,
} from './params.ts'
import {
  ensureLighting,
  ensureTracedShadows,
  type LightingResources,
  type TracedShadowBuffers,
} from './resources.ts'

/**
 * THE SURFACE CACHE'S LIGHTING FOR AN IMAGE, in the order the reference runs it, in one compute pass:
 *
 * 1. the update context (`contextWgsl.ts`): which tiles of which pages are lit this image;
 * 2. the direct light: the lights of each tile (`cullWgsl.ts`), their light on its texels (`directWgsl.ts`), the final light
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
 * compiled, and where the cut has no tables or draws the world DAG's cells or the buffers do not fit the device or its budget,
 * the image's shadows and radiosity rays are the distance field's. The traced shadows' memory and the scene trace are the
 * state's own, made when they are wanted and given back when they are not: they are no part of the lighting's shape. The
 * pages' light settles over images after a change (`settle`: the images the updates take to cycle the atlas and blend): while
 * it does, the frame is not held.
 */

/** What an image's lighting reads that the frame holds: the lights, the sky, the clouds' shade, the light functions, the field. */
export interface LightingInputs {
  readonly lights: GPUBuffer
  readonly sky: SkyLightReadSet
  readonly cloudShadow: CloudShadowSet
  readonly lightFunction: GPUTextureView
  readonly field: GlobalFieldRead
  /** What the radiosity's rays read of the cache at their hits (`surfaceHitReads`). */
  readonly hit: SurfaceHitResources
  /** The buffer the rays that read the cards write their feedback into, none while the image writes none (`feedbackBuffer.ts`). */
  readonly feedback?: GPUBuffer
  /** The image's own numbers (`LightingImage`, less what the cache gives). */
  readonly image: Omit<LightingImage, 'frame' | 'pages' | 'historyLost' | 'feedback'>
  /** Changes when the lights' transport does: the lighting then settles again. */
  readonly transportEpoch: number
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
  epoch: number
  /** Whether the radiosity's history is lost: the atlases or the lighting's memory were made again. */
  historyLost: boolean
  /** The traced shadows' memory: their masks, traces and light tiles, and the scene trace made for the acceleration structures
   *  (the radiosity's traced rays use it too). */
  tracedBuffers?: TracedShadowBuffers
  sceneTrace?: SceneTrace
}

export function createSurfaceLighting(): SurfaceLightingState {
  return {
    words: new Uint32Array(new ArrayBuffer(LIGHTING_PARAMS.words * 4)),
    pass: new LazyComputePass(SURFACE_CACHE_LIGHTING_PASS),
    why: null,
    settle: 0,
    epoch: NaN,
    historyLost: true,
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
function prepared(state: SurfaceLightingState, device: GPUDevice, shape: LightingShape) {
  const made = ensureLighting(state.resources, device, shape)
  state.why = made.why ?? null
  if (made.resources !== state.resources) state.historyLost = true
  state.resources = made.resources
  if (!state.resources) return undefined
  const { shaped } = state
  if (!shaped || shaped.maxLights !== shape.maxLights || shaped.compressed !== shape.compressed)
    state.shaped = shapedKernels(device, shape.maxLights, shape.compressed)
  const fixed = staticKernels(device)
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

/** Gives back the traced shadows' memory and the scene trace: the state holds none after. */
function releaseTraced(state: SurfaceLightingState) {
  releaseShadowBuffers(state)
  state.sceneTrace?.dispose()
  state.sceneTrace = undefined
}

/** What the rays of an image through the scene's triangles are made from — the traced shadows' and the radiosity's: the scene's file,
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

/**
 * What the rays of this image through the scene's triangles need, or the first condition they lack: neither the direct light's
 * traced shadows nor the radiosity's traced rays wanted, the scene without acceleration structures or a cut that draws
 * geometry they do not hold, buffers that do not fit the device, the cut without tables, programs not compiled yet.
 */
function tracedNeeds(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  settings: SurfaceCacheSettings,
  shape: LightingShape,
): TracedNeeds {
  const shadows =
    settings.surfaceCacheDirectLighting && settings.surfaceCacheDirectLightingHardwareRayTracing
  const radiosity = shape.radiosity && settings.surfaceCacheRadiosityHardwareRayTracing
  if (!shadows && !radiosity)
    return { why: "neither the traced shadows nor the radiosity's traced rays are on" }
  const file = rt.context.rayTracing
  if (!file) return { why: 'the scene has no acceleration structures' }
  const selection = rt.run.gpuSelection
  // The file holds the triangles of the scene's primitives, none of the world DAG's HLOD cells: where the cut packs them a ray
  // would pass through them, so the rays stay in the distance field, which holds them.
  if (selection?.world)
    return { why: "the scene's acceleration structures hold none of the world DAG's cells" }
  const placements = rt.layout.selectionRoots.length
  const scene = sceneTraceWords(file, placements)
  const wantedTiles = shadows ? shape.directTiles * shape.maxLights : 0
  // Shadows whose buffers do not fit the device leave the radiosity its rays, which need the scene trace's buffers alone.
  const shadowsFit = shadows && tracedRaysFit(device.limits, wantedTiles, scene)
  if (!shadowsFit && !(radiosity && tracedRaysFit(device.limits, 0, scene)))
    return { why: TRACED_REFUSED, refused: true }
  const lightTiles = shadowsFit ? wantedTiles : 0
  const cut = selection?.cutTables()
  if (!cut) return { why: 'the cut has no tables yet', keep: true }
  // The programs compile off the frame, only those of what is traced, each feature on its own: until a feature's are ready its
  // rays are the distance field's.
  const traced = {
    shadows: compiled(shadowsFit ? tracedShadowKernels(device) : undefined),
    radiosity: compiled(radiosity ? tracedRadiosityKernels(device) : undefined),
  }
  if (!traced.shadows && !traced.radiosity)
    return { why: "the traced rays' programs are not compiled", keep: true }
  return { file, cut, ...traced, lightTiles, placements, refused: shadows && !shadowsFit }
}

/**
 * The scene the rays of this image are cast through, and the traced shadows made over it, or none where `tracedNeeds` says
 * they are not made — the image then lights through the distance field. Where none is wanted (not for the cut or the programs,
 * which are waited for) the memory they held is given back. Else the scene trace, made once for its size and file — where the
 * device's budget refuses it, `state.why` says so —, its table of placements brought level with the cut's roots and its
 * parameters written for the image's eye; and, where the shadows are traced, their buffers, made once for their size (the
 * memory of the shadows alone is given back where only the radiosity is traced).
 */
function tracedOf(
  state: SurfaceLightingState,
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  settings: SurfaceCacheSettings,
  shape: LightingShape,
  eye: ArrayLike<number>,
): { traced?: TracedShadows; scene?: TracedScene } {
  const needs = tracedNeeds(rt, device, settings, shape)
  if (needs.why !== undefined) {
    if (needs.refused) state.why = needs.why
    if (!needs.keep) releaseTraced(state)
    return {}
  }
  const { file, cut, shadows, radiosity, lightTiles, placements } = needs
  if (needs.refused) state.why = TRACED_REFUSED
  if (shadows) {
    const held = ensureTracedShadows(state.tracedBuffers, device, lightTiles)
    state.tracedBuffers = held.resources
    state.why = held.why ?? state.why
  } else releaseShadowBuffers(state)
  const made = ensureSceneTrace(state.sceneTrace, device, file, placements)
  const { sceneTrace } = made
  state.sceneTrace = sceneTrace
  state.why = made.why ?? state.why
  if (!sceneTrace) return {}
  sceneTrace.syncPlacements(rt.layout.selectionRoots)
  sceneTrace.writeParams({
    eye: [eye[0], eye[1], eye[2]],
    treeRoot: cut.treeRoot,
    maxIterations: settings.surfaceCacheHardwareRayTracingMaxIterations,
    skipBackFaceDistance: settings.surfaceCacheHardwareRayTracingSkipBackFaceHitDistance / CM,
    skipTwoSidedDistance: settings.surfaceCacheHardwareRayTracingSkipTwoSidedHitDistance / CM,
  })
  const views = cut.views
  return {
    scene: radiosity && { kernels: radiosity, sceneTrace, views },
    traced:
      shadows && state.tracedBuffers
        ? { kernels: shadows, sceneTrace, views, buffers: state.tracedBuffers }
        : undefined,
  }
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
  const ready = prepared(state, device, shape)
  if (!ready) return state.resources ? 'waiting' : 'none'
  if (!tables.buffer || !cache.pages.length) return 'none'
  if (inputs.transportEpoch !== state.epoch) {
    state.epoch = inputs.transportEpoch
    state.settle = settleImages(settings)
  }
  writeLightingParams(state.words, shape, settings, {
    ...inputs.image,
    frame: cache.frame,
    pages: cache.pages.length,
    historyLost: state.historyLost,
    feedback:
      inputs.feedback !== undefined &&
      settings.surfaceCacheDirectLightingHardwareRayTracing &&
      !!rt.context.rayTracing,
  })
  state.historyLost = false
  device.queue.writeBuffer(ready.resources.params, 0, state.words)
  const { traced, scene } = tracedOf(state, rt, device, settings, shape, inputs.image.eye)
  const encoding: Encoding = {
    ...ready,
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
    traced,
    scene,
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
  releaseTraced(lighting)
  owner.lighting = undefined
}
