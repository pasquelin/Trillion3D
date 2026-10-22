import type { VolumetricFogValues } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { shownHeightFog } from '../../../../sdk-core/src/scene/core/fog.ts'
import type { ResolvedHeightFog } from '../../../../sdk-core/src/scene/core/fogHeight.ts'
import { fogCubemapView, type createFogCubemap } from '../../lighting/fog/cubemapGpu.ts'
import { createFogVolumeGpu, type FogVolumeGpu } from '../../lighting/fog/gpu.ts'
import type { FogRead } from '../../lighting/fog/read.ts'
import type { WebgpuGpuState } from '../backend/state/gpu.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { litImageShown } from '../prepare/contractLight.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { clearFogInputs, fogInputsOf } from './fogInputs.ts'
import { fogSettingsOf } from './fogSettings.ts'
import { publishFogView } from './fogView.ts'

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

/** The height fog this image shows over the lit image: the scene's, in a lit view of the lit image —
 *  the unlit view and the views that paint raw values show none. */
function shownFog(rt: WebgpuPagesRuntime): ResolvedHeightFog | undefined {
  const fog = rt.lights.store.environment?.fog
  if (!fog || !litImageShown(rt)) return undefined
  if (!shownOf.has(fog)) shownOf.set(fog, shownHeightFog(fog))
  return shownOf.get(fog)
}

/** The medium of the volume this image builds: the scene's, unless the run holds the quality `off`,
 *  draws no fog or the volume reaches nowhere; none where the scene has no volume. */
function volumeMedium(fog: ResolvedHeightFog | undefined, settings: VolumetricFogValues) {
  const medium = fog?.volumetric
  const built = medium && medium.farEnd > 0 && settings.fogEnabled
  return built && settings.volumetricFogQuality !== 'off' ? medium : undefined
}

/** The medium of the volume this image builds, none where it builds none: what the light grid's
 *  cull keeps the lists of the cells behind the surfaces for (`lighting/tiles/cullView.ts`). The run's
 *  settings are not read where the scene has no volume. */
export function fogVolumeMedium(rt: WebgpuPagesRuntime) {
  const fog = shownFog(rt)
  return fog?.volumetric ? volumeMedium(fog, fogSettingsOf(rt)) : undefined
}

/** Whether this image shows an atmosphere: the scene's, in a lit view of the lit image. */
const airShown = (rt: WebgpuPagesRuntime) =>
  !!rt.lights.store.environment?.atmosphere && litImageShown(rt)

/** The volume's GPU work made where there is none: its pipelines compile off the frame
 *  (`createFogVolumeGpu`). */
function startVolume(rt: WebgpuPagesRuntime, device: GPUDevice, held: FogVolumeState) {
  const failed = (error: unknown) => rt.diag.diagnosticFailure('fog-volume-program-failed', error)
  held.gpu ??= createFogVolumeGpu(device, failed, rt.gpu.deferred!.placeholders.fog)
}

/** Starts the volume's GPU work once a scene turns the volume on, at a frame's entry: the frames
 *  wait for its pipelines. A scene with none makes nothing, and reads no setting. */
export function askFogVolume(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu } = rt
  const fog = shownFog(rt)
  if (!gpu.deferred || !fog?.volumetric) return
  if (volumeMedium(fog, fogSettingsOf(rt))) startVolume(rt, device, (gpu.fogVolume ??= newState()))
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
  settings: VolumetricFogValues,
  cubemap: GPUTextureView | undefined,
) {
  const medium = volumeMedium(fog, settings)
  const buffer = rt.lights.buffer
  if (medium) startVolume(rt, device, held)
  if (!medium || !buffer || !held.gpu?.ready) {
    held.gpu?.reset()
    if (buffer) publishFogView(rt, device, buffer, cam, undefined, settings, fog)
    return undefined
  }
  const cut = rt.run.gate.temporalRevision !== held.revision
  held.revision = rt.run.gate.temporalRevision
  const inputs = fogInputsOf(rt, cam, direct, device, buffer, { medium, settings, cubemap }, cut)
  let volume: GPUTextureView | undefined
  try {
    volume = held.gpu.encode(encoder, inputs)
  } finally {
    clearFogInputs()
  }
  publishFogView(rt, device, buffer, cam, volume && held.gpu.frame, settings, fog)
  return volume
}

/**
 * The fog's volume for this image, built before the lighting resolve, the blends and the sky read
 * it: the cubemap's texture, the volume's three passes where the scene turns the volume on, the
 * view block that tells a surface where its cell lies, and what the programs read the fog through
 * (`FogRead`, `directLightResources`), and the view's clip plane, which the fog is measured from. A
 * scene with no cubemap and no volume makes nothing and its programs read the stand-ins; one that
 * had them and no longer does lets them go. `direct` is what the light lists encoded
 * (`encodeDirectLights`), whose columns and rows the volume's lights are read from. Where the
 * passes are not compiled yet, or the lights are not on the GPU, the image shows the analytic fog
 * alone.
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
  if (!fog) {
    // The air's haze lies over the surfaces with no fog: the fog's switches reach it all the same.
    if (rt.lights.buffer && airShown(rt))
      publishFogView(rt, device, rt.lights.buffer, cam, undefined, fogSettingsOf(rt), undefined)
    return void (gpu.fogVolume && disposeFogVolume(gpu))
  }
  const settings = fogSettingsOf(rt)
  if (!fog.cubemap && !fog.volumetric) {
    // A height fog alone still starts at the view's clip plane.
    if (rt.lights.buffer)
      publishFogView(rt, device, rt.lights.buffer, cam, undefined, settings, fog)
    return void (gpu.fogVolume && disposeFogVolume(gpu))
  }
  const held = (gpu.fogVolume ??= newState())
  const cubemap = fogCubemapView(device, held, fog.cubemap)
  const volume = buildVolume(rt, device, encoder, cam, direct, held, fog, settings, cubemap)
  readOf(held, gpu.deferred!.placeholders.fog, cubemap, volume)
}

/** The fog's volume released: its passes, its textures, the cubemap's. */
export function disposeFogVolume(gpu: Pick<WebgpuGpuState, 'fogVolume'>) {
  gpu.fogVolume?.gpu?.dispose()
  gpu.fogVolume?.cube?.made.destroy()
  gpu.fogVolume = undefined
}
