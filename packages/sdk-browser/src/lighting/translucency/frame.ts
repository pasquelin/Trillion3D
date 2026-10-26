import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { resolveSettingsStamped } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  TRANSLUCENCY_VOLUME_RULES,
  type TranslucencyVolumeValues,
} from '../../../../sdk-core/src/contracts/translucencyVolumeOptions.ts'
import { writeDividedVector3 } from '../../../../math/src/vector/vector.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { cameraForward } from '../../camera/forward.ts'
import { clearVolumeView } from '../../gpu/core/standIns.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { WebgpuGpuState } from '../../frame/backend/state/gpu.ts'
import { litImageShown } from '../../frame/prepare/contractLight.ts'
import { cloudShadowOf } from '../../frame/render/encodeCloudShadow.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { cloudShadowStandIn } from '../atmosphere/cloudShadowStandIn.ts'
import { lightFunctionResources } from '../lightFunction/frame.ts'
import { vsmConsumerResources, vsmOrStandIns } from '../shadows/vsm/frame/vsmConsumers.ts'
import type { CascadeView } from './bounds.ts'
import {
  createTranslucencyVolumeGpu,
  type TranslucencyInputs,
  type TranslucencyVolumeGpu,
} from './gpu.ts'

/** What a view holds of the translucency lighting volume: its GPU work, made once the scene's surfaces are lit from it, and the last
 *  camera cut (`TranslucencyInputs.cut`). */
export interface TranslucencyVolumeState {
  gpu?: TranslucencyVolumeGpu
  revision?: number
  /** Bytes of the textures the view holds for the volume. */
  readonly bytes: number
}

const newState = (): TranslucencyVolumeState => ({
  get bytes() {
    return this.gpu?.bytes ?? 0
  },
})

/** The volume's settings as this image reads them: one object, rewritten. */
const resolved = {} as TranslucencyVolumeValues
const settingsOf = (rt: WebgpuPagesRuntime) =>
  resolveSettingsStamped(TRANSLUCENCY_VOLUME_RULES, rt.context, resolved)

/** The camera's axes this image places the cascades by: written here, never allocated. */
const forward = new Float64Array(3)
const right = new Float64Array(3)
const up = new Float64Array(3)
const view: { -readonly [K in keyof CascadeView]: CascadeView[K] } = {
  eye: forward,
  forward,
  right,
  up,
  scaleX: 1,
  scaleY: 1,
  perspective: true,
}

/** What the image tells the volume's passes, rewritten each image — nothing is allocated — and let go when the image is encoded: no
 *  GPU object is held past it. */
const inputs: {
  -readonly [K in Exclude<keyof TranslucencyInputs, 'lights'>]: TranslucencyInputs[K] | undefined
} & {
  lights: { -readonly [K in keyof TranslucencyInputs['lights']]: TranslucencyInputs['lights'][K] }
} = {
  camera: view,
  settings: resolved,
  lights: { packed: [], kindOf: () => 0, count: 0, capacity: 0 },
  lightBuffer: undefined,
  vsm: undefined,
  lightFunction: undefined,
  cloudShadow: undefined,
  preExposure: 1,
  previousPreExposure: 1,
  cut: false,
}

/** Whether the scene's surfaces read the volume: some blended item now in the table is lit from it
 *  (`TransparentTable.volumeReaders`, the count of `readsVolume` items, which grows with the table and starts again from zero when
 *  the table is rebuilt), the setting is on and the lit image is shown. It reads no frame's run count, so the first frame already
 *  asks the passes; it stops once no item of the table reads it. */
const wanted = (rt: WebgpuPagesRuntime, settings: TranslucencyVolumeValues) =>
  settings.translucencyVolume && litImageShown(rt) && !!rt.blendState.table?.volumeReaders

/** Whether the volume is made this image: it is wanted and the blend draws runs. */
const made = (rt: WebgpuPagesRuntime, settings: TranslucencyVolumeValues) =>
  rt.blendState.runCount > 0 && wanted(rt, settings)

/** The volume's GPU work made where there is none: its pipelines compile off the frame, the frames wait for them. */
function start(rt: WebgpuPagesRuntime, device: GPUDevice, held: TranslucencyVolumeState) {
  held.gpu ??= createTranslucencyVolumeGpu(device, (error) =>
    rt.diag.diagnosticFailure('translucency-volume-program-failed', error),
  )
}

/** Starts the volume's GPU work once a scene's surfaces are lit from it, at a frame's entry: the frames wait for its pipelines. A
 *  scene whose surfaces are lit forward makes nothing, and reads no setting. */
export function askTranslucencyVolume(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!rt.vis.blendPipelines?.translucencyVolume) return
  if (wanted(rt, settingsOf(rt))) start(rt, device, (rt.gpu.translucencyVolume ??= newState()))
}

/**
 * The translucency lighting volume of this image, built before the blends read it (after the shadow maps it reads): the cascades placed
 * round the camera, the light of the lights each reaches injected, filtered (`createTranslucencyVolumeGpu`). A scene whose surfaces
 * are lit forward, or with the setting off, makes nothing and lets go of what it held.
 */
export function encodeTranslucencyVolume(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  steps: ComputeRun,
  cam: EngineCamera,
) {
  const { gpu, lights } = rt
  const settings = settingsOf(rt)
  if (!made(rt, settings)) return void (gpu.translucencyVolume && disposeTranslucencyVolume(gpu))
  const held = (gpu.translucencyVolume ??= newState())
  start(rt, device, held)
  const volume = held.gpu!
  const buffer = lights.buffer
  if (!buffer || !gpu.deferred || !volume.ready) return void volume.reset()
  const { placeholders } = gpu.deferred
  const cut = rt.run.gate.temporalRevision !== held.revision
  held.revision = rt.run.gate.temporalRevision
  cameraForward(forward, cam.world)
  writeDividedVector3(right, 0, cam.world[0], cam.world[1], cam.world[2])
  writeDividedVector3(up, 0, cam.world[4], cam.world[5], cam.world[6])
  view.scaleX = cam.projection[0]
  view.scaleY = cam.projection[5]
  view.perspective = cam.perspective === 1
  const pre = preExposureOf(rt)
  view.eye = cam.eye
  inputs.lights.packed = lights.store.packed
  inputs.lights.kindOf = lights.store.kindOf
  inputs.lights.count = lights.store.count
  inputs.lights.capacity = lights.store.capacity
  inputs.lightBuffer = buffer
  inputs.vsm = vsmOrStandIns(vsmConsumerResources(rt), placeholders)
  // The injection is a lighting of the deferred kind: it reads the atlas where the opaque lighting does.
  inputs.lightFunction =
    lightFunctionResources(rt, 'lightFunctionDeferred') ?? placeholders.lightFunction
  inputs.cloudShadow = cloudShadowOf(rt) ?? cloudShadowStandIn(device)
  inputs.preExposure = pre.now
  inputs.previousPreExposure = pre.previous
  inputs.cut = cut
  try {
    volume.encode(steps, inputs as TranslucencyInputs)
  } finally {
    inputs.lightBuffer = inputs.vsm = inputs.lightFunction = inputs.cloudShadow = undefined
  }
}

/** The texture the blends bind as the volume: this image's, the one-cell stand-in where none is made. */
export const translucencyVolumeView = (rt: Pick<WebgpuPagesRuntime, 'gpu'>, device: GPUDevice) =>
  rt.gpu.translucencyVolume?.gpu?.published.view ?? clearVolumeView(device)

/** What the blends read of this image's volume beyond the texture — the cascades' boxes and the cells a side —, none where none is
 *  made (`BlendView.volumeRead` then says so). */
const translucencyVolumePublished = (rt: Pick<WebgpuPagesRuntime, 'gpu'>) => {
  const published = rt.gpu.translucencyVolume?.gpu?.published
  return published?.view ? published : undefined
}

/** The view's words (`BlendView.volumeCorner`, `volumeScale`, `volumeRead`) for this image: the cascades' boxes and the cells a side,
 *  the noise on the point a surface reads the volume at and the image's number; the cells a side 0 where no volume is made, which
 *  the surfaces read as black. */
export function writeTranslucencyVolumeView(
  rt: WebgpuPagesRuntime,
  out: Float32Array,
  corner: number,
  scale: number,
  read: number,
) {
  const published = translucencyVolumePublished(rt)
  if (!published) return void (out[read] = 0)
  out.set(published.corner, corner)
  out.set(published.scale, scale)
  out[read] = published.dim
  out[read + 1] = published.offsetRadius
  out[read + 2] = rt.run.frame
}

/** Whether the volume still advances toward the light its history converges to (`TranslucencyVolumeGpu.settling`). */
export const translucencyVolumeSettling = (gpu: Pick<WebgpuGpuState, 'translucencyVolume'>) =>
  !!gpu.translucencyVolume?.gpu?.settling

/** The volume released: its passes, its textures. */
export function disposeTranslucencyVolume(gpu: Pick<WebgpuGpuState, 'translucencyVolume'>) {
  gpu.translucencyVolume?.gpu?.dispose()
  gpu.translucencyVolume = undefined
}
