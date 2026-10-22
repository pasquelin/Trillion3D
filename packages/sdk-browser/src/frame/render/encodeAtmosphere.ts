import { createAtmosphereGpu } from '../../lighting/atmosphere/gpu.ts'
import type { AirInputs } from '../../lighting/atmosphere/encode.ts'
import { FRAME_FLOATS, writeAirFrame } from '../../lighting/atmosphere/frame.ts'
import { litImageShown } from '../prepare/contractLight.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** What the image tells the air's passes, its frame included, rewritten each image: nothing is
 *  allocated. */
const inputs: AirInputs = {
  buffer: undefined as unknown as GPUBuffer,
  version: 0,
  epoch: 0,
  frame: new Float32Array(FRAME_FLOATS),
}

/** The atmosphere this image shows: the scene's, in a lit view of the lit image — the unlit view
 *  and the views that paint raw values show none. */
function atmosphereShown(rt: WebgpuPagesRuntime) {
  const { store } = rt.lights
  return litImageShown(rt) ? store.environment?.atmosphere : undefined
}

/** Whether the bounce probes must wait for the sky: the scene has a sky light and an atmosphere this
 *  image shows, and the sky by direction their rays that leave the scene read is not built yet — the
 *  probes would hold a sky of none, and the surfaces they answer be dark until they were made again.
 *  Meanwhile a surface reads the sky light's own irradiance where the probes answer nothing. */
export function probesWaitForSky(rt: WebgpuPagesRuntime) {
  return (
    !!rt.lights.store.environment?.sky?.light &&
    !!atmosphereShown(rt) &&
    !rt.gpu.atmosphere?.skyBuilds
  )
}

/** Starts the atmosphere's GPU work once a scene shows one: its pipelines compile off the frame
 *  and the frames wait for them (`createAtmosphereGpu`). A scene with none makes nothing. */
export function askAtmosphere(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (rt.gpu.atmosphere || !atmosphereShown(rt)) return
  rt.gpu.atmosphere = createAtmosphereGpu(device, (error) =>
    rt.diag.diagnosticFailure('atmosphere-program-failed', error),
  )
}

/**
 * The air's tables and volume for this image, before the lighting resolve reads them: the tables
 * of the air when it changed, the sky around the eye and the haze volume, and the sky's sums when
 * the sun moved. False when the image shows no atmosphere, or its programs are not compiled yet —
 * then the image draws without one, and `encodeSky` draws nothing.
 */
export function encodeAtmosphere(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  viewProj: ArrayLike<number>,
  inverseViewProj: ArrayLike<number>,
) {
  const air = atmosphereShown(rt),
    { lights, gpu } = rt
  if (!air || !lights.buffer) return false
  askAtmosphere(rt, device)
  if (!gpu.atmosphere?.ready) return false
  const [width, height] = gpu.targetSize
  writeAirFrame(inputs.frame, cam, air, viewProj, inverseViewProj, width, height)
  inputs.buffer = lights.buffer
  inputs.version = lights.store.atmosphereVersion
  inputs.epoch = lights.store.atmosphereEpoch
  gpu.atmosphere.encode(encoder, inputs)
  return true
}

/** The sky over the lit image where the resolve drew no surface: after the lighting, before the
 *  transparents, the fog over it read from what this image's fog volume built (`encodeFogVolume`). */
export function encodeSky(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu } = rt,
    flags = gpu.surfaces?.views()[3]
  if (!gpu.atmosphere || !gpu.hdrView || !flags || !gpu.deferred) return
  const [width, height] = gpu.targetSize
  const fog = gpu.fogVolume?.read ?? gpu.deferred.placeholders.fog
  gpu.atmosphere.drawSky(encoder, gpu.hdrView, flags, width, height, fog)
}
