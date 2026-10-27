import { resolveSettingsStamped } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  TRANSLUCENCY_GI_RULES,
  type TranslucencyGiValues,
} from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { TRANSLUCENCY_GI_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { WebgpuGpuState } from '../../frame/backend/state/gpu.ts'
import { litImageShown } from '../../frame/prepare/contractLight.ts'
import { blueNoiseNow } from '../../gpu/noise/blueNoiseTextures.ts'
import { screenProbesCast } from '../bounce/screen/cast.ts'
import { surfaceHitReads } from '../surfaceCache/frame.ts'
import { historyImages } from '../translucency/gpu.ts'
import {
  encodeGiPasses,
  LAW_HISTORY_WORDS,
  LAW_WORDS,
  newGiState,
  writeGiFrame,
  type GiImage,
  type TranslucencyGiState,
} from './gpu.ts'
import { imageOf, lawOf, reflectionGroupOf, sameLaw } from './image.ts'
import { takeTranslucencyGiRefusal, translucencyGiKernels } from './kernels.ts'
import { log } from '../../diagnostic/log.ts'
import {
  translucencyGiGrid,
  type TranslucencyGiGrid,
  type TranslucencyGiGridInto,
} from './layout.ts'
import { clearVolumeView } from '../../gpu/core/standIns.ts'
import { createGiResources, giSampler, giveBack, resourcesKey } from './resources.ts'

/** The volume's settings as this image reads them: one object, rewritten. */
const resolved = {} as TranslucencyGiValues
const settingsOf = (rt: WebgpuPagesRuntime) =>
  resolveSettingsStamped(TRANSLUCENCY_GI_RULES, rt.context, resolved)

/** Whether the see-through surfaces read the volume this image: the setting is on, the scene holds blended surfaces, the lit image is shown and the
 *  screen probes cast (they own the radiance cache the cells read and the parameters of the march). */
const wanted = (rt: WebgpuPagesRuntime, settings: TranslucencyGiValues) =>
  settings.translucencyGi && !!rt.vis.blendPipelines && litImageShown(rt) && screenProbesCast(rt)

/** Asks the volume's kernels of the device off the frame once the scene's surfaces could read it: the frames are drawn without it while they compile. */
export function askTranslucencyGi(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!wanted(rt, settingsOf(rt))) return
  translucencyGiKernels(device)
  // A refusal leaves the see-through surfaces without the volume: said once, on the console too,
  // as a refused pipeline is (`framePipelines.ts`).
  const reason = takeTranslucencyGiRefusal(device)
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

/** The images a volume that is no longer made keeps its textures for before it gives them back (a camera that is not a perspective for a
 *  moment, a setting turned off and on): the cache of probes it reads keeps its own for as many. */
const KEEP_IMAGES = 8

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
  held.published.view = undefined
  held.known = false
  held.marking = false
  if (++held.idle >= KEEP_IMAGES) release(device, held)
}

/** The resources at the size of `grid`: the held ones, else made, the old given back. */
function resourcesFor(
  device: GPUDevice,
  held: TranslucencyGiState,
  grid: TranslucencyGiGrid,
  tracing: number,
) {
  const key = resourcesKey(grid, tracing)
  if (held.resources?.key === key) return held.resources
  if (held.resources) giveBack(device, held.resources)
  held.resources = createGiResources(device, grid, tracing)
  held.groups = held.traceGroup = undefined
  held.known = false
  return held.resources
}

/** What the trace reads of the frame, written into the state's inputs: the screen probes' parameters, the cascades, the lights, the noise,
 *  the radiance cache and the field; false while the frame lacks any of it. */
function traceInputs(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  held: TranslucencyGiState,
  params: GPUBuffer,
  lights: GPUBuffer,
  blue: GPUTextureView,
) {
  const probes = rt.bounce.probes
  const placeholders = rt.gpu.deferred?.placeholders
  if (!placeholders) return false
  const cache = probes?.cache.views ?? rt.bounce.screen?.noCache(device)
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
  inputs.cacheTags = cache.tags
  inputs.reads = surfaceHitReads(rt, device, inputs.reads)
  return true
}

/** The state after an image: the volume written is the history of the next, the surfaces read it, the history's view-projection is kept; the
 *  cells' probes are marked where the radiance cache is read. */
function publish(
  held: TranslucencyGiState,
  grid: TranslucencyGiGrid,
  v: TranslucencyGiValues,
  image: GiImage,
  kept: boolean,
  cached: boolean,
) {
  const { published } = held
  published.view = held.resources!.volumes[held.turn]
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
  held.marking = cached
}

/** The numbers an image is made at, and its grid: scratch, rewritten by each image. */
const LAW = new Float64Array(LAW_WORDS)
const GRID = {} as TranslucencyGiGridInto
const PASS = { label: TRANSLUCENCY_GI_PASS }

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
  const { gpu, lights } = rt
  const v = settingsOf(rt)
  if (!wanted(rt, v)) return void (gpu.translucencyGi && unpublish(device, gpu.translucencyGi))
  const held = (gpu.translucencyGi ??= newGiState(rt))
  // The four kernels are made whole, asked at the frame's entry (`askTranslucencyGi`): none, no pass.
  const kernels = translucencyGiKernels(device)
  const probes = gpu.screenProbes
  const params = probes?.indirect && probes.resources.params
  const noise = blueNoiseNow(device)
  const group = reflectionGroupOf(rt)
  const ready =
    lights.buffer &&
    params &&
    noise &&
    traceInputs(rt, device, held, params, lights.buffer, noise.view)
  if (!kernels || !ready || !group || cam.perspective !== 1) return unpublish(device, held)
  const grid = translucencyGiGrid(v, gpu.targetSize[0], gpu.targetSize[1], cam.near, GRID)
  const tracing = v.translucencyGiTracingResolution
  const limit = device.limits?.maxTextureDimension3D ?? 2048
  if (Math.max(grid.x * tracing, grid.y * tracing, grid.z * 2) > limit)
    return unpublish(device, held)
  resourcesFor(device, held, grid, tracing)
  held.idle = 0
  const cached =
    v.translucencyGiRadianceCache && probes !== undefined && !!rt.bounce.probes?.cache.views
  lawOf(LAW, grid, tracing, cam.near, v, cached)
  const sameHistory = sameLaw(held.law, LAW, LAW_HISTORY_WORDS)
  const lawMoved = !sameLaw(held.law, LAW, LAW_WORDS)
  if (lawMoved) held.law.set(LAW)
  // The one place the marks' revision moves (`PoolMarker.revision`; a volume that starts or stops marking changes the pool's list of markers
  // instead, which the pool watches too): when the law the cells are marked from moved, and every image while their point turns with the
  // jitter — the cascades not asked coarser — and so is marked again at the point of each image.
  if (
    lawMoved ||
    (cached && v.translucencyGiRadianceCacheClipmapBias === 0 && v.translucencyGiTemporalJitter)
  )
    held.markRevision++
  const cut = rt.run.gate.temporalRevision !== held.revision
  held.revision = rt.run.gate.temporalRevision
  const history = held.known && !cut && v.translucencyGiTemporalReprojection && sameHistory
  const image = imageOf(rt, cam, history)
  writeGiFrame(device, held, grid, v, image, cached)
  const pass = encoder.beginComputePass(PASS)
  encodeGiPasses(device, pass, held, kernels, grid, v, held.inputs, group)
  pass.end()
  publish(held, grid, v, image, history, cached)
}

/** The texture the blends bind as the volume: this image's, the one-cell stand-in where none is made. */
export const translucencyGiView = (rt: Pick<WebgpuPagesRuntime, 'gpu'>, device: GPUDevice) =>
  rt.gpu.translucencyGi?.published.view ?? clearVolumeView(device)

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
  if (!published?.view) return void (out[grid + 3] = 0)
  out.set(published.grid, grid)
  out.set(published.z, z)
}

/** Whether the volume still advances toward the light its history converges to: a still view is drawn again till it is whole. */
export const translucencyGiSettling = (gpu: Pick<WebgpuGpuState, 'translucencyGi'>) => {
  const held = gpu.translucencyGi
  return !!held?.published.view && held.frames < held.horizon
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
