import type { TranslucencyGiValues } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { TRANSLUCENCY_GI_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { WebgpuGpuState } from '../../frame/backend/state/gpu.ts'
import { blueNoiseNow } from '../../gpu/noise/blueNoiseTextures.ts'
import { surfaceHitReads } from '../surfaceCache/frame.ts'
import { historyImages } from '../translucency/gpu.ts'
import {
  encodeGiPasses,
  LAW_HISTORY_WORDS,
  LAW_WORDS,
  newGiState,
  writeGiFrame,
  type GiCacheRead,
  type GiImage,
  type TranslucencyGiState,
} from './gpu.ts'
import { imageOf, lawOf, reflectionGroupOf, sameLaw } from './image.ts'
import { takeTranslucencyGiRefusal, translucencyGiKernels } from './kernels.ts'
import { log } from '../../diagnostic/log.ts'
import {
  translucencyGiConeFormat,
  translucencyGiGrid,
  type TranslucencyGiGrid,
  type TranslucencyGiGridInto,
} from './layout.ts'
import { clearVolumeView } from '../../gpu/core/standIns.ts'
import { trianglesStageOf } from './trianglesStage.ts'
import { createGiResources, giSampler, giveBack, resourcesKey } from './resources.ts'
import { idleExpired } from '../bounce/probes/hold.ts'
import {
  translucencyGiEndDistanceOf,
  translucencyCacheLight,
  translucencyCacheProbes,
  translucencyGiFormatSetting,
  translucencyGiSettings,
  wanted,
} from './settings.ts'
import { cacheReadOf, type CacheRead } from './cache.ts'

/** Asks the volume's kernels of the device off the frame once the scene's surfaces could read it: the frames are drawn without it while they compile. */
export function askTranslucencyGi(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const v = translucencyGiSettings(rt)
  if (!wanted(rt, v)) return
  const format = translucencyGiConeFormat(device.features, translucencyGiFormatSetting(rt, v))
  const light = translucencyCacheLight(rt, device, v)
  translucencyGiKernels(device, format, light)
  // A refusal leaves the see-through surfaces without the volume: said once, on the console too,
  // as a refused pipeline is (`framePipelines.ts`).
  const reason = takeTranslucencyGiRefusal(device, format, light)
  if (!reason) return
  log.warn(`WebGPU translucency volume refused: ${reason}`)
  rt.diag.engineDiagnostic(
    'translucency-gi-refused',
    'The device refused the translucency volume',
    {
      reason,
    },
  )
}

/** Whether this image wants the scene trace made for the volume's cones (`LightingInputs.probes`): the volume is made, its cones are cast through the
 *  scene's triangles where it can (`translucencyGiHardwareRayTracing`, with the march of the cells on) and the frame holds what the volume needs — a
 *  perspective camera, a grid that fits the device, its four kernels compiled. The lighting then keeps the scene trace for the image (`sceneRaysOf`),
 *  as it does for the screen probes and the radiance cache. */
export function translucencyGiTraced(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const v = translucencyGiSettings(rt)
  if (
    !v.translucencyGiHardwareRayTracing ||
    !v.translucencyGiTraceFromVolume ||
    !wanted(rt, v) ||
    cam.perspective !== 1
  )
    return false
  const format = translucencyGiConeFormat(device.features, translucencyGiFormatSetting(rt, v))
  const light = translucencyCacheLight(rt, device, v)
  return (
    !!translucencyGiKernels(device, format, light) &&
    !!fittedGrid(rt, device, v, cam, v.translucencyGiTracingResolution)
  )
}

/** The textures given back, their groups forgotten: the next image makes them again. */
function release(device: GPUDevice, held: TranslucencyGiState) {
  if (!held.resources) return
  giveBack(device, held.resources)
  held.resources = held.groups = held.traceGroup = undefined
  held.known = false
}

/** Nothing published: the surfaces read the sky light's irradiance alone, and the history is none; the textures are given back once the
 *  volume has not been made for `KEEP_IMAGES` images: the eighth image without it frees them. */
function unpublish(device: GPUDevice, held: TranslucencyGiState) {
  held.published.volume = held.published.fogView = undefined
  held.known = false
  held.marks = 'none'
  if (idleExpired(held)) release(device, held)
}

/** The resources at the size of `grid`: the held ones, else made, the old given back. */
function resourcesFor(
  device: GPUDevice,
  held: TranslucencyGiState,
  grid: TranslucencyGiGrid,
  tracing: number,
  coneFormat: GPUTextureFormat,
) {
  const key = resourcesKey(grid, tracing, coneFormat)
  if (held.resources?.key === key) return held.resources
  if (held.resources) giveBack(device, held.resources)
  held.resources = createGiResources(device, grid, tracing, coneFormat)
  held.groups = held.traceGroup = undefined
  held.known = false
  return held.resources
}

/** What the trace reads of the frame, written into the state's inputs: the screen probes' parameters, the cascades, the lights, the noise,
 *  the radiance cache (the volume's own, or the world's where shared) and the field; false while the frame lacks any of it. */
function traceInputs(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  held: TranslucencyGiState,
  v: TranslucencyGiValues,
  params: GPUBuffer,
  lights: GPUBuffer,
  blue: GPUTextureView,
) {
  const probes = translucencyCacheProbes(rt, v)
  const placeholders = rt.gpu.deferred?.placeholders
  if (!placeholders) return false
  const light = translucencyCacheLight(rt, device, v)
  const cache = probes?.cache.views ?? rt.bounce.screen?.noCache(device, light)
  if (!cache) return false
  const inputs = held.inputs
  inputs.params = params
  inputs.bounceGrid = probes?.uniform ?? placeholders.bounceGrid
  inputs.probes = probes?.table ?? placeholders.probes
  inputs.lights = lights
  inputs.blue = blue
  inputs.cacheFinal = cache.final
  inputs.cacheRaw = cache.raw
  inputs.cacheSky = cache.sky
  inputs.reads = surfaceHitReads(rt, device, inputs.reads, light)
  return true
}

/** The state after an image: the volume written is the history of the next, the surfaces read it, the history's view-projection is kept; the
 *  cells' probes are marked in the pool `marks` names, where the radiance cache is read. */
function publish(
  held: TranslucencyGiState,
  grid: TranslucencyGiGrid,
  v: TranslucencyGiValues,
  image: GiImage,
  kept: boolean,
  marks: TranslucencyGiState['marks'],
) {
  const { published } = held
  published.volume = held.resources!.volumes[held.turn]
  published.fogView = held.resources!.fogVolume
  const cells = published.grid
  cells[0] = grid.x
  cells[1] = grid.y
  cells[2] = grid.z
  cells[3] = 1
  const law = published.z
  law[0] = grid.logZScale
  law[1] = grid.logZOffset
  law[2] = grid.zScale
  law[3] = 0
  held.turn = (1 - held.turn) as 0 | 1
  held.known = true
  held.previous.set(image.viewProjection)
  held.previousEye.set(image.eye)
  held.frames = kept ? held.frames + 1 : 1
  held.horizon = v.translucencyGiTemporalReprojection
    ? historyImages(v.translucencyGiTemporalHistoryWeight)
    : 1
  held.marks = marks
}

/** Whether the frame holds what the trace reads, written into the state's inputs (`traceInputs`): the screen probes' parameters, the lights
 *  and the blue noise among it. */
function traceReady(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  held: TranslucencyGiState,
  v: TranslucencyGiValues,
) {
  const probes = rt.gpu.screenProbes
  const params = probes?.indirect && probes.resources.params
  const noise = blueNoiseNow(device)
  const lights = rt.lights.buffer
  return !!(
    lights &&
    params &&
    noise &&
    traceInputs(rt, device, held, v, params, lights, noise.view)
  )
}

/** The pool the cells' probes are marked in: none without a cache read, the world's where shared, else the volume's own. */
const marksOf = (cached: boolean, shared: boolean): TranslucencyGiState['marks'] =>
  !cached ? 'none' : shared ? 'shared' : 'own'

/** The numbers an image is made at, and its grid: scratch, rewritten by each image. */
const LAW = new Float64Array(LAW_WORDS)
const GRID = {} as TranslucencyGiGridInto
const PASS = { label: TRANSLUCENCY_GI_PASS }
/** How this image reads the radiance cache: rewritten by each image. */
const CACHE_READ: CacheRead = { radiusScale: 0, resolution: 0, mipmaps: 0, sky: false }
const READ: GiCacheRead = { cached: false, bias: 0, cache: CACHE_READ }

/** The grid fitted to the view, none where a side of the traced cones' texture would pass the device's 3D textures. */
function fittedGrid(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  v: TranslucencyGiValues,
  cam: EngineCamera,
  tracing: number,
) {
  const { targetSize } = rt.gpu
  const grid = translucencyGiGrid(
    v,
    targetSize[0],
    targetSize[1],
    cam.near,
    translucencyGiEndDistanceOf(rt, v),
    GRID,
  )
  const limit = device.limits?.maxTextureDimension3D ?? 2048
  return Math.max(grid.x * tracing, grid.y * tracing, grid.z * 2) > limit ? undefined : grid
}

/** How this image reads the radiance cache (`READ`, `CACHE_READ`), and the history it keeps: whether the volume of the last image is the
 *  history of this one, the law of its slices, the way the cones are traced (`traced`: through the scene's triangles or the field) and the world's temporal revision unmoved. */
function settleHistory(
  rt: WebgpuPagesRuntime,
  held: TranslucencyGiState,
  grid: TranslucencyGiGrid,
  v: TranslucencyGiValues,
  cam: EngineCamera,
  cached: boolean,
  shared: boolean,
  traced: boolean,
) {
  READ.cached = cached
  // Only the world's cache is read and marked coarser than the cascade that covers a cell: the volume's own has no bias.
  READ.bias = cached && shared ? v.translucencyGiRadianceCacheClipmapBias : 0
  cacheReadOf(CACHE_READ, rt, v)
  lawOf(LAW, grid, v.translucencyGiTracingResolution, cam.near, v, traced, READ.bias)
  const sameHistory = sameLaw(held.law, LAW, LAW_HISTORY_WORDS)
  if (!sameLaw(held.law, LAW, LAW_WORDS)) held.law.set(LAW)
  const cut = rt.run.gate.temporalRevision !== held.revision
  held.revision = rt.run.gate.temporalRevision
  return held.known && !cut && v.translucencyGiTemporalReprojection && sameHistory
}

/**
 * The translucency global illumination volume of this image, built after the screen probes and the radiance cache (`traceScreenProbes`,
 * `flushRadianceCache`) and before the blends read it: the grid fitted to the view, its cells' cones traced, filtered and integrated into
 * the harmonics (`encodeGiPasses`). An image that casts no screen probe, a scene with no blended surface, a camera that is not a perspective
 * or a setting off makes nothing and publishes none: the surfaces read the sky light.
 */
export function encodeTranslucencyGi(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const v = translucencyGiSettings(rt)
  if (!wanted(rt, v)) return void (gpu.translucencyGi && unpublish(device, gpu.translucencyGi))
  const held = (gpu.translucencyGi ??= newGiState(rt))
  // The four kernels are made whole, asked at the frame's entry (`askTranslucencyGi`): none, no pass.
  const coneFormat = translucencyGiConeFormat(device.features, translucencyGiFormatSetting(rt, v))
  const light = translucencyCacheLight(rt, device, v)
  const kernels = translucencyGiKernels(device, coneFormat, light)
  const probes = gpu.screenProbes
  const group = reflectionGroupOf(rt)
  const ready = traceReady(rt, device, held, v)
  if (!kernels || !ready || !group || cam.perspective !== 1) return unpublish(device, held)
  const tracing = v.translucencyGiTracingResolution
  const grid = fittedGrid(rt, device, v, cam, tracing)
  if (!grid) return unpublish(device, held)
  resourcesFor(device, held, grid, tracing, coneFormat)
  held.idle = 0
  const cached = probes !== undefined && !!translucencyCacheProbes(rt, v)?.cache.views
  const shared = v.translucencyGiShareRadianceCacheWithOpaque
  const triangles = trianglesStageOf(rt, device, held, v, coneFormat, light)
  const history = settleHistory(rt, held, grid, v, cam, cached, shared, !!triangles)
  const image = imageOf(rt, cam, history, triangles?.rays)
  writeGiFrame(device, held, grid, v, image, READ)
  const pass = encoder.beginComputePass(PASS)
  encodeGiPasses(device, pass, held, kernels, grid, v, held.inputs, group, triangles)
  pass.end()
  publish(held, grid, v, image, history, marksOf(cached, shared))
}

/** The texture the blends bind as the volume, the ambient and the directional light stacked: this image's, the one-cell stand-in (black, half floats, whichever format the volume would hold its light in) where none is made. */
export const translucencyGiView = (rt: WebgpuPagesRuntime, device: GPUDevice): GPUTextureView =>
  rt.gpu.translucencyGi?.published.volume ?? clearVolumeView(device)

/** The sampler the blends read the volume through. */
export const translucencyGiSampler = giSampler

/** The view's words (`BlendView.giGrid`, `giZ`) for this image: the grid's cells and whether a volume is made, and the slices' law; the last
 *  word of the first 0 where none is made, which the surfaces read as the sky light's irradiance alone. */
export function writeTranslucencyGiView(
  rt: Pick<WebgpuPagesRuntime, 'gpu'>,
  out: Float32Array,
  grid: number,
  z: number,
) {
  const published = rt.gpu.translucencyGi?.published
  if (!published?.volume) return void (out[grid + 3] = 0)
  out.set(published.grid, grid)
  out.set(published.z, z)
}

/** Whether the volume still advances toward the light its history converges to: a still view is drawn again till it is whole. */
export const translucencyGiSettling = (gpu: Pick<WebgpuGpuState, 'translucencyGi'>) => {
  const held = gpu.translucencyGi
  return !!held?.published.volume && held.frames < held.horizon
}

/** The volume released: its textures. */
export function disposeTranslucencyGi(
  gpu: Pick<WebgpuGpuState, 'translucencyGi'>,
  device?: GPUDevice,
) {
  const held = gpu.translucencyGi
  if (held?.resources) {
    if (device) giveBack(device, held.resources)
    else held.resources.destroy()
  }
  gpu.translucencyGi = undefined
}

export type { TranslucencyGiState }
