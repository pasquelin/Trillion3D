import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { SurfaceCacheSettings } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import type { SurfaceCache } from '../../../../../sdk-core/src/lighting/surfaceCache/state.ts'
import { SURFACE_CACHE_LIGHTING_PASS } from '../../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { LazyComputePass } from '../../../gpu/core/lazyComputePass.ts'
import { groupWidth } from '../../../gpu/dispatch/grid.ts'
import { noiseViewOn } from '../../../gpu/noise/blueNoiseTextures.ts'
import type { SkyLightReadSet } from '../../../modules/sky/skyLight/read.ts'
import type { CloudShadowSet } from '../../atmosphere/cloudShadowRead.ts'
import type { GlobalFieldRead } from '../../distanceField/view.ts'
import type { SurfaceHitResources } from '../hitWgsl.ts'
import type { SurfaceAtlases } from '../atlases.ts'
import type { SurfaceTables } from '../tables.ts'
import { shapedKernels, staticKernels, type ShapedKernels } from './kernels.ts'
import { LIGHTING_PARAMS } from './layout.ts'
import { contextPasses, directPasses, radiosityPasses, type Encoding } from './passes.ts'
import { shapeOf, writeLightingParams, type LightingImage } from './params.ts'
import { ensureLighting, type LightingResources } from './resources.ts'

/**
 * THE SURFACE CACHE'S LIGHTING FOR AN IMAGE, in the order the reference runs it, in one compute pass:
 *
 * 1. the update context (`contextWgsl.ts`): which tiles of which pages are lit this image;
 * 2. the direct light: the lights of each tile (`cullWgsl.ts`), their light on its texels (`directWgsl.ts`), the final light
 *    of the tiles combined (`combineWgsl.ts`);
 * 3. the radiosity: the probes' tiles, a ray a thread through the global distance field, the rays filtered, projected on
 *    the harmonics, the indirect light of the texels integrated, and the final light of its tiles combined again
 *    (`radiosityBuildWgsl.ts`, `radiosityTraceWgsl.ts`, `radiosityFilterWgsl.ts`, `radiosityIntegrateWgsl.ts`).
 *
 * What the image has not made — the pipelines still compiling, the budget refusing the memory — leaves the lighting where it was
 * and says so (`why`). The pages' light settles over images after a change (`settle`: the images the updates take to cycle the
 * atlas and blend): while it does, the frame is not held.
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
  /** The image's own numbers (`LightingImage`, less what the cache gives). */
  readonly image: Omit<LightingImage, 'frame' | 'pages' | 'historyLost'>
  /** Changes when the lights' transport does: the lighting then settles again. */
  readonly transportEpoch: number
}

/** What the surface cache keeps of its lighting. */
export interface SurfaceLightingState {
  shaped?: ShapedKernels
  resources?: LightingResources
  readonly words: Uint32Array<ArrayBuffer>
  readonly pass: LazyComputePass
  /** Why the lighting is not made, none while it is. */
  why: string | null
  /** The images it still takes to settle. */
  settle: number
  epoch: number
  /** Whether the radiosity's history is lost: the atlases or the lighting's memory were made again. */
  historyLost: boolean
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
function prepared(
  state: SurfaceLightingState,
  device: GPUDevice,
  shape: ReturnType<typeof shapeOf>,
) {
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
    ? { resources: state.resources, shaped: state.shaped!, fixed }
    : undefined
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
  })
  state.historyLost = false
  device.queue.writeBuffer(ready.resources.params, 0, state.words)
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
  owner.lighting = undefined
}
