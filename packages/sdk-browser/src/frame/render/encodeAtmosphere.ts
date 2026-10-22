import type { AirShadowMaps } from '../../lighting/atmosphere/bindings.ts'
import { createAtmosphereGpu } from '../../lighting/atmosphere/gpu.ts'
import type { AirInputs } from '../../lighting/atmosphere/encode.ts'
import { FRAME_FLOATS, captureKmOf, writeAirFrame } from '../../lighting/atmosphere/frame.ts'
import { airShapeKey } from '../../lighting/atmosphere/shape.ts'
import {
  vsmConsumerResources,
  vsmOrStandIns,
} from '../../lighting/shadows/vsm/frame/vsmConsumers.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { airStateOf } from './airState.ts'
import { cloudShadowOf } from './encodeCloudShadow.ts'
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
  maps: undefined as unknown as AirShadowMaps,
  separate: false,
  capture360: false,
  captureKm: 0,
}

/** The atmosphere this image shows: the scene's, in a lit view of the lit image, the quality settings
 *  not turning it off (`atmosphereOn`) — the unlit view and the views that paint raw values show
 *  none. The lights' store is told whether the air shades them. */
function atmosphereShown(rt: WebgpuPagesRuntime) {
  const { store } = rt.lights
  const air = store.environment?.atmosphere
  if (!air) return undefined
  const on = airStateOf(rt).quality.atmosphereOn
  store.setAirOn(on)
  return on && litImageShown(rt) ? air : undefined
}

/** Starts the atmosphere's GPU work once a scene shows one: its pipelines compile off the frame
 *  and the frames wait for them (`createAtmosphereGpu`). Made again when the quality settings made
 *  another shape of it. A scene with none makes nothing. */
export function askAtmosphere(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!atmosphereShown(rt)) return
  const { shape, key } = airStateOf(rt)
  if (rt.gpu.atmosphere && airShapeKey(rt.gpu.atmosphere.shape) === key) return
  rt.gpu.atmosphere?.dispose()
  rt.gpu.atmosphere = createAtmosphereGpu(device, shape, (error) =>
    rt.diag.diagnosticFailure('atmosphere-program-failed', error),
  )
}

/** The virtual shadow maps and the blue noise this image's air reads: the engine's where it
 *  projects some, their stand-ins else (`vsmOrStandIns`). */
export function mapsOf(rt: WebgpuPagesRuntime) {
  const { placeholders } = rt.gpu.deferred!
  return vsmOrStandIns(vsmConsumerResources(rt), placeholders)
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
  const { requests } = airStateOf(rt)
  const capture = requests.capturePosition && { position: requests.capturePosition }
  writeAirFrame(inputs.frame, cam, air, viewProj, inverseViewProj, width, height, {
    capture,
    frameIndex: rt.run.frame,
    preExposure: preExposureOf(rt).now,
  })
  const maps = mapsOf(rt)
  inputs.buffer = lights.buffer
  inputs.version = lights.store.atmosphereVersion
  inputs.epoch = lights.store.atmosphereEpoch
  inputs.maps = maps
  inputs.cloudShadow = cloudShadowOf(rt)
  inputs.separate = requests.separate
  inputs.capture360 = requests.capture360
  inputs.captureKm = captureKmOf(inputs.frame)
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
  const lightShaft = gpu.lightShafts?.mask ?? gpu.deferred.placeholders.lightShaft
  gpu.atmosphere.drawSky(
    encoder,
    gpu.hdrView,
    flags,
    width,
    height,
    fog,
    lightShaft,
    mapsOf(rt).noise,
  )
}

/** The haze marched on the opaque surfaces, over the lit image after the sky (`aerialFastOnOpaque`
 *  off; nothing otherwise): each pixel a surface drew is hazed up to its depth. */
export function encodeOpaqueHaze(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu } = rt,
    flags = gpu.surfaces?.views()[3]
  if (!gpu.atmosphere?.drawOpaqueHaze || !gpu.hdrView || !flags || !gpu.depthView || !gpu.deferred)
    return
  const [width, height] = gpu.targetSize
  gpu.atmosphere.drawOpaqueHaze(
    encoder,
    gpu.hdrView,
    flags,
    gpu.depthView,
    width,
    height,
    mapsOf(rt).noise,
  )
}
