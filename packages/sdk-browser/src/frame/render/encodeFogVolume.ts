import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { resolveSettingsInto } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  VOLUMETRIC_FOG_RULES,
  type VolumetricFogValues,
} from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { shownHeightFog } from '../../../../sdk-core/src/scene/core/fog.ts'
import type { ResolvedHeightFog } from '../../../../sdk-core/src/scene/core/fogHeight.ts'
import { cloudShadowStandIn } from '../../lighting/atmosphere/cloudShadowStandIn.ts'
import { lightFunctionResources } from '../../lighting/lightFunction/frame.ts'
import { fogCubemapView, type createFogCubemap } from '../../lighting/fog/cubemapGpu.ts'
import { writeFogViewBlock } from '../../lighting/fog/frame.ts'
import {
  createFogVolumeGpu,
  unset,
  type FogVolumeGpu,
  type FogVolumeInputs,
} from '../../lighting/fog/gpu.ts'
import type { FogRead } from '../../lighting/fog/read.ts'
import { fillFogStaticLight } from '../../lighting/fog/staticFrame.ts'
import { newFogStaticLight } from '../../lighting/fog/staticLight.ts'
import { FOG_VIEW_FLOATS } from '../../lighting/fog/viewSlots.ts'
import { opaquePyramidOf } from '../../lighting/reflections/frame.ts'
import { vsmOrStandIns } from '../../lighting/shadows/vsm/frame/vsmConsumers.ts'
import { cameraForward } from '../../camera/forward.ts'
import { viewProj } from '../backend/helpers.ts'
import { LIGHT_BUFFER_AT } from '../backend/state/lightBufferLayout.ts'
import type { WebgpuGpuState } from '../backend/state/gpu.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { cloudShadowOf } from './encodeCloudShadow.ts'
import { skyLightReadOf } from './encodeSkyLight.ts'
import { fogSkyField } from './encodeSkyOcclusion.ts'
import { directLightResources, litImageShown } from '../prepare/contractLight.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'

/** What a view holds of the scene's fog beyond the light buffer: the volume's passes, made once a
 *  scene turns the volume on; the cubemap's texture, made for the picture the fog holds; what the
 *  programs read the fog through; and the last image's camera cut. */
export interface FogVolumeState {
  gpu?: FogVolumeGpu
  cube?: { texels: ArrayLike<number>; made: ReturnType<typeof createFogCubemap> }
  /** A new object where one of its resources changed, so that a program keeps its group while it
   *  has not (`FogRead`). */
  read?: FogRead
  revision?: number
  /** Bytes of the textures the view holds for the fog. */
  readonly bytes: number
}

const newState = (): FogVolumeState => ({
  get bytes() {
    return (this.gpu?.bytes ?? 0) + (this.cube?.made.bytes ?? 0)
  },
})

/** The height fog each fog a scene set shows, resolved once; none where it shows nothing. */
const shownOf = new WeakMap<object, ResolvedHeightFog | undefined>()
const settings = {} as VolumetricFogValues
const inverse = new Float64Array(16)
const forward = new Float64Array(3)
const lightCells: [number, number] = [0, 0]
const viewBlock = new Float32Array(FOG_VIEW_FLOATS)

/** What the image tells the volume's passes, rewritten each image: nothing is allocated, and
 *  nothing is held past the image (`clearInputs`). */
const inputs: FogVolumeInputs = {
  camera: {
    eye: forward,
    forward,
    projection: forward,
    viewProj: forward,
    inverseViewProj: inverse,
    depthViewProj: viewProj,
    world: forward,
    near: 0,
    width: 0,
    height: 0,
    perspective: true,
  },
  medium: unset(),
  settings,
  sunRank: -1,
  lightCells,
  frameIndex: 0,
  preExposure: 1,
  allocated: [0, 0],
  depth: unset(),
  lights: unset(),
  tiles: unset(),
  lightFunction: unset(),
  cloudShadow: unset(),
  sky: unset(),
  staticLight: newFogStaticLight(),
  vsm: {
    pageTable: unset(),
    projectionData: unset(),
    uniforms: unset(),
    pool: unset(),
    view: unset(),
  },
}

/** The height fog this image shows over the lit image: the scene's, in a lit view of the lit image —
 *  the unlit view and the views that paint raw values show none. */
function shownFog(rt: WebgpuPagesRuntime): ResolvedHeightFog | undefined {
  const fog = rt.lights.store.environment?.fog
  if (!fog || !litImageShown(rt)) return undefined
  if (!shownOf.has(fog)) shownOf.set(fog, shownHeightFog(fog))
  return shownOf.get(fog)
}

/** The medium of the volume this image builds: the scene's, unless the run holds the quality
 *  `off` (`volumetricFogQuality`); none where the scene has no volume — the run's settings are not
 *  read then. */
function volumeMedium(rt: WebgpuPagesRuntime, fog: ResolvedHeightFog | undefined) {
  if (!fog?.volumetric) return undefined
  resolveSettingsInto(VOLUMETRIC_FOG_RULES, rt.context, settings)
  return settings.volumetricFogQuality === 'off' ? undefined : fog.volumetric
}

/** The medium of the volume this image builds, none where it builds none: what the light grid's
 *  cull keeps the lists of the cells behind the surfaces for (`lighting/tiles/cullView.ts`). */
export const fogVolumeMedium = (rt: WebgpuPagesRuntime) => volumeMedium(rt, shownFog(rt))

/** The volume's GPU work made where there is none: its pipelines compile off the frame
 *  (`createFogVolumeGpu`). */
function startVolume(rt: WebgpuPagesRuntime, device: GPUDevice, held: FogVolumeState) {
  const failed = (error: unknown) => rt.diag.diagnosticFailure('fog-volume-program-failed', error)
  held.gpu ??= createFogVolumeGpu(device, failed, rt.gpu.deferred!.placeholders.fog)
}

/** Starts the volume's GPU work once a scene turns the volume on, at a frame's entry: the frames
 *  wait for its pipelines. A scene with none makes nothing. */
export function askFogVolume(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu } = rt
  if (gpu.deferred && volumeMedium(rt, shownFog(rt)))
    startVolume(rt, device, (gpu.fogVolume ??= newState()))
}

/** The image's camera and lights written into the volume's inputs: the unjittered matrices and the
 *  render matrix the depth was drawn with, the light buffer and its lists, the sun's rank, and the
 *  virtual shadow maps the sun's shadow reads — the very ones a blended surface binds
 *  (`directLightResources`), or their stand-ins. */
function fillInputs(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  direct: ArrayLike<number>,
  buffer: GPUBuffer,
) {
  const { gpu, lights } = rt
  const { placeholders } = gpu.deferred!
  const contract = directLightResources(rt)
  const { camera } = inputs
  invertMatrix4(inverse, cam.viewProjection)
  cameraForward(forward, cam.world)
  camera.eye = cam.eye
  camera.world = cam.world
  camera.projection = cam.projection
  camera.viewProj = cam.viewProjection
  camera.near = cam.near
  camera.width = gpu.targetSize[0]
  camera.height = gpu.targetSize[1]
  inputs.allocated = gpu.allocatedSize
  camera.perspective = cam.perspective === 1
  inputs.depth = gpu.depthView!
  inputs.hiz = opaquePyramidOf(rt)
  inputs.field = fogSkyField(rt, camera.perspective)
  inputs.lights = buffer
  inputs.tiles = contract.tiles ?? placeholders.tiles
  const vsm = vsmOrStandIns(contract.vsm, placeholders)
  inputs.vsm.pageTable = vsm.pageTable
  inputs.vsm.projectionData = vsm.projectionData
  inputs.vsm.uniforms = vsm.uniforms
  inputs.vsm.pool = vsm.pool
  inputs.vsm.view = vsm.view
  inputs.sunRank = lights.store.fogSunSlot
  inputs.volumes = rt.context.sceneVolumes
  lightCells[0] = direct[1]
  lightCells[1] = direct[2]
  inputs.frameIndex = rt.run.frame
  inputs.preExposure = preExposureOf(rt).now
}

/** The inputs let go: the scratch object holds no GPU object past the image. */
function clearInputs() {
  const { vsm } = inputs
  inputs.depth = unset()
  inputs.lights = inputs.tiles = unset()
  inputs.medium = unset()
  inputs.hiz = inputs.cubemap = inputs.field = undefined
  inputs.lightFunction = unset()
  inputs.cloudShadow = unset()
  inputs.sky = unset()
  inputs.lightmap = undefined
  vsm.pageTable = vsm.projectionData = vsm.uniforms = vsm.pool = vsm.view = unset()
}

/** The view block written into the light buffer (`LIGHT_BUFFER_AT.fogView`), where the programs
 *  that read the volume find the image's cells: from the frame the volume was built with, or zero
 *  where none was built (`writeFogViewBlock`). */
function publishView(device: GPUDevice, buffer: GPUBuffer, frame: Float32Array | undefined) {
  writeFogViewBlock(viewBlock, frame, settings)
  device.queue.writeBuffer(buffer, LIGHT_BUFFER_AT.fogView, viewBlock)
}

/** What the programs read the fog through this image: the held object where nothing changed. */
function readOf(
  held: FogVolumeState,
  none: FogRead,
  cubemap?: GPUTextureView,
  volume?: GPUTextureView,
) {
  const { read } = held
  const next = { cubemap: cubemap ?? none.cubemap, volume: volume ?? none.volume }
  if (read?.cubemap === next.cubemap && read.volume === next.volume) return read
  return (held.read = { ...next, sampler: none.sampler })
}

/** This image's volume, built on `encoder` where the scene turns it on, the passes are compiled and
 *  the lights are on the GPU: its integrated view, none otherwise — the view block then says so. */
function buildVolume(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  direct: ArrayLike<number>,
  held: FogVolumeState,
  fog: ResolvedHeightFog,
  cubemap: GPUTextureView | undefined,
) {
  const medium = volumeMedium(rt, fog)
  const buffer = rt.lights.buffer
  if (medium) startVolume(rt, device, held)
  if (!medium || !buffer || !held.gpu?.ready) {
    held.gpu?.reset()
    if (buffer && fog.volumetric) publishView(device, buffer, undefined)
    return undefined
  }
  fillInputs(rt, cam, direct, buffer)
  inputs.medium = medium
  fillFogStaticLight(inputs, rt, device, medium)
  inputs.cubemap = cubemap
  inputs.lightFunction =
    lightFunctionResources(rt, 'lightFunctionFog') ?? rt.gpu.deferred!.placeholders.lightFunction
  inputs.cloudShadow = cloudShadowOf(rt) ?? cloudShadowStandIn(device)
  inputs.sky = skyLightReadOf(rt)
  inputs.cut = rt.run.gate.temporalRevision !== held.revision
  held.revision = rt.run.gate.temporalRevision
  let volume: GPUTextureView | undefined
  try {
    volume = held.gpu.encode(encoder, inputs)
  } finally {
    clearInputs()
  }
  publishView(device, buffer, volume && held.gpu.frame)
  return volume
}

/**
 * The fog's volume for this image, built before the lighting resolve, the blends and the sky read
 * it: the cubemap's texture, the volume's three passes where the scene turns the volume on, the
 * view block that tells a surface where its cell lies, and what the programs read the fog through
 * (`FogRead`, `directLightResources`). A scene with no cubemap and no volume makes nothing and its
 * programs read the stand-ins; one that had them and no longer does lets them go. `direct` is what
 * the light lists encoded (`encodeDirectLights`), whose columns and rows the volume's lights are
 * read from. Where the passes are not compiled yet, or the lights are not on the GPU, the image
 * shows the analytic fog alone.
 */
export function encodeFogVolume(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  direct: ArrayLike<number>,
) {
  const { gpu } = rt
  const fog = shownFog(rt)
  if (!fog || (!fog.cubemap && !fog.volumetric))
    return void (gpu.fogVolume && disposeFogVolume(gpu))
  const held = (gpu.fogVolume ??= newState())
  const cubemap = fogCubemapView(device, held, fog.cubemap)
  const volume = buildVolume(rt, device, encoder, cam, direct, held, fog, cubemap)
  readOf(held, gpu.deferred!.placeholders.fog, cubemap, volume)
}

/** The fog's volume released: its passes, its textures, the cubemap's. */
export function disposeFogVolume(gpu: Pick<WebgpuGpuState, 'fogVolume'>) {
  gpu.fogVolume?.gpu?.dispose()
  gpu.fogVolume?.cube?.made.destroy()
  gpu.fogVolume = undefined
}
