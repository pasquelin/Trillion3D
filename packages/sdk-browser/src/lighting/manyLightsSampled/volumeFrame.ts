/**
 * THE SAMPLED LIGHTING'S VOLUMES IN THE FRAME: the fog's volume is sampled, traced and hashed once an image (`encodeSampledVolume`) by a pass of its own, before the fog is built and apart from it, whenever the fog or the
 * translucency volume sharing its samples needs it; the fog's scatter (`sampledVolumeFog`) and the translucency volume's injection read it. Where the translucency volume has samples of its own
 * (`sampledLightsVolumeUnified` off) they are drawn in the injection's compute pass, over its cascades as it placed them (`sampleTranslucencyCells`).
 */
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { TRANSLUCENCY_VOLUME_RULES } from '../../../../sdk-core/src/contracts/translucencyVolumeOptions.ts'
import { readSetting } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { cameraForward } from '../../camera/forward.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { NO_CAMERA, previousCameraOf } from '../../frame/backend/state/previousCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { directLightResources } from '../../frame/prepare/contractLight.ts'
import type { CloudShadowSet } from '../atmosphere/cloudShadowRead.ts'
import { noiseFrame } from '../../frame/render/noiseFrame.ts'
import { lightFunctionResources } from '../lightFunction/frame.ts'
import { opaquePyramidOf } from '../reflections/frame.ts'
import { surfaceHitReads } from '../surfaceCache/frame.ts'
import type { Cascade } from '../translucency/bounds.ts'
import { followSampledLights, powerOf } from './frame.ts'
import { findRecord, partOf, viewRecord } from './release.ts'
import { createSampledVolume, type SampledVolumeBinding } from './volume.ts'
import {
  createVolumeGroups,
  createVolumePrograms,
  encodeVolumePass,
  volumePassReady,
  type VolumePassInputs,
} from './volumeProgram.ts'

/** What a view keeps of its volumes: their history and the groups that name it. */
export interface ViewVolumes {
  /** The camera-cut revision the last volume was drawn under. */
  lastRevision?: number
  readonly volume: ReturnType<typeof createSampledVolume>
  readonly fogGroups: ReturnType<typeof createVolumeGroups>
  readonly cellGroups: ReturnType<typeof createVolumeGroups>
}
interface DeviceVolumes {
  readonly programs: ReturnType<typeof createVolumePrograms>
}
const devices = new WeakMap<GPUDevice, DeviceVolumes>()

/**
 * What the frame gives the volumes that other modules of the frame own, handed in by the pass that builds the fog (`encodeSampledVolume`) and kept for the translucency volume's injection after it: the
 * columns and rows of the light grid, the pre-exposure, the clouds' shade, and the fog's scale of the inverse square's bias per cell.
 */
export interface VolumeFrameInputs {
  readonly lightCells: readonly [number, number]
  readonly preExposure: number
  readonly cloudShadow: CloudShadowSet
  readonly lampSoftening: number
}
const shared = new WeakMap<WebgpuPagesRuntime, VolumeFrameInputs>()
const drawn = new WeakMap<WebgpuPagesRuntime, SampledVolumeBinding>()

/** The device's programs and the volumes of the view being drawn (its record's), made at their first image. */
function volumesOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  let held = devices.get(device)
  if (!held) {
    held = {
      programs: createVolumePrograms(device, (error) =>
        rt.diag.diagnosticFailure('sampled-lights-program-failed', error),
      ),
    }
    devices.set(device, held)
  }
  const record = viewRecord(rt.gpu, device)
  const view = partOf(
    record,
    'volumes',
    () => ({
      volume: createSampledVolume(device),
      fogGroups: createVolumeGroups(),
      cellGroups: createVolumeGroups(),
    }),
    ({ volume }) => volume.dispose(),
  )
  return { programs: held.programs, view }
}

/** The camera matrices a volume is placed by, rewritten each image. */
const inverse = new Float64Array(16)
const forward = new Float64Array(3)
const cameraOf = (cam: EngineCamera) => {
  invertMatrix4(inverse, cam.viewProjection)
  cameraForward(forward, cam.world)
  return {
    eye: cam.eye,
    forward,
    viewProj: cam.viewProjection,
    inverseViewProj: inverse,
    projection: cam.projection,
    perspective: cam.perspective === 1,
  }
}

/** The inputs both domains' passes read of the frame, none while the lights or the light grid are not there. */
function passInputs(
  rt: WebgpuPagesRuntime,
  withField: boolean,
  inputs: VolumeFrameInputs,
): VolumePassInputs | undefined {
  const { device, deferred } = rt.gpu
  const direct = directLightResources(rt)
  if (!device || !deferred || !direct.lights) return undefined
  return {
    lights: direct.lights,
    tiles: direct.tiles ?? deferred.placeholders.tiles,
    lightFunction:
      lightFunctionResources(rt, 'lightFunctionDeferred') ?? deferred.placeholders.lightFunction,
    cloudShadow: inputs.cloudShadow,
    field: withField ? surfaceHitReads(rt, device).field : undefined,
  }
}

/** What both domains read of the image alike. */
function imageOf(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  cut: boolean,
  inputs: VolumeFrameInputs,
) {
  return {
    settings: followSampledLights(rt),
    image: rt.run.frame,
    frame: noiseFrame(rt),
    cut,
    camera: cameraOf(cam),
    preExposure: inputs.preExposure,
    previousViewProjection: (previousCameraOf(rt).image > 0 ? previousCameraOf(rt) : NO_CAMERA)
      .viewProjection,
    ratios: powerOf(rt),
    sunRank: rt.lights.store.forwardDirectionalSlot,
    lightCells: inputs.lightCells,
  }
}

/**
 * Samples, traces and hashes the fog's volume of this image, before the fog is built: where the fog's volume (`medium`) is built, or the translucency volume lit from the sampled lighting shares the samples. Nothing
 * where the settings leave the lights to the walk of their lists, or while the pipelines compile.
 */
export function encodeSampledVolume(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  medium: { farEnd: number; startAt: number; anisotropy: number } | undefined,
  frameInputs: VolumeFrameInputs,
) {
  drawn.delete(rt)
  shared.set(rt, frameInputs)
  const settings = followSampledLights(rt)
  const sharesWithTranslucency =
    settings.sampledLightsTranslucencyVolume &&
    settings.sampledLightsVolumeUnified &&
    readSetting(TRANSLUCENCY_VOLUME_RULES, rt.context, 'translucencyVolume')
  if (
    !settings.sampledLights ||
    !settings.sampledLightsVolume ||
    (!medium && !sharesWithTranslucency)
  ) {
    findRecord(rt.gpu, device)?.volumes?.volume.releaseFog()
    return
  }
  const { programs, view } = volumesOf(rt, device)
  const { volume, fogGroups } = view
  const inputs = passInputs(rt, settings.sampledLightsVolumeWorldSpaceTraces, frameInputs)
  if (!inputs) return
  inputs.hiz = settings.sampledLightsVolumeHzbOcclusionTest ? opaquePyramidOf(rt) : undefined
  if (!volumePassReady(programs, inputs)) return
  const [width, height] = rt.gpu.targetSize
  const outer = readSetting(
    TRANSLUCENCY_VOLUME_RULES,
    rt.context,
    'translucencyVolumeOuterDistance',
  )
  const binding = volume.prepare({
    ...imageOf(rt, cam, rt.run.gate.temporalRevision !== view.lastRevision, frameInputs),
    width,
    height,
    near: Math.max(cam.near, medium?.startAt ?? 0),
    far: Math.max(medium?.farEnd ?? 0, sharesWithTranslucency ? outer : 0),
    anisotropy: medium?.anisotropy ?? 0,
    lampSoftening: frameInputs.lampSoftening,
  })
  view.lastRevision = rt.run.gate.temporalRevision
  if (!binding) return
  const pass = encoder.beginComputePass({ label: 'Trillion3D sampled volume' })
  encodeVolumePass(device, pass, programs, fogGroups, inputs, binding)
  pass.end()
  drawn.set(rt, binding)
}

/** The fog's volume of this image if its samples were drawn: what the fog's scatter and the translucency volume's injection read. */
export function sampledVolumeFog(rt: WebgpuPagesRuntime) {
  const binding = drawn.get(rt)
  return binding && binding.drawn === binding.image && binding.image === rt.run.frame
    ? binding
    : undefined
}

/**
 * Samples, traces and hashes the translucency volume's own cells into `pass` (the injection's), over the cascades as it placed them, where it does not share the fog's samples. None while the
 * pipelines compile.
 */
export function sampleTranslucencyCells(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  pass: GPUComputePassEncoder,
  cascades: readonly Cascade[],
  dim: number,
): SampledVolumeBinding | undefined {
  const { device } = rt.gpu
  const settings = followSampledLights(rt)
  if (!device || !settings.sampledLights || settings.sampledLightsVolumeUnified) return undefined
  const { programs, view } = volumesOf(rt, device)
  const { volume, cellGroups } = view
  const frameInputs = shared.get(rt)
  const inputs =
    frameInputs && passInputs(rt, settings.sampledLightsVolumeWorldSpaceTraces, frameInputs)
  if (!frameInputs || !inputs || !volumePassReady(programs, inputs)) return undefined
  const [width, height] = rt.gpu.targetSize
  const binding = volume.prepareTranslucency({
    ...imageOf(rt, cam, false, frameInputs),
    width,
    height,
    dim,
    cascades: [
      { corner: cascades[0]!.min, cell: cascades[0]!.voxel },
      { corner: cascades[1]!.min, cell: cascades[1]!.voxel },
    ],
  })
  if (!binding) return undefined
  encodeVolumePass(device, pass, programs, cellGroups, inputs, binding)
  return binding
}

/** Forgets the programs of a device (a session's dispose; the views' volumes are freed with their records, `releaseSampledViewsOf`). */
export function disposeSampledVolumes(device: GPUDevice) {
  devices.delete(device)
}
