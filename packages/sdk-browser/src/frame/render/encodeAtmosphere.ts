import { settingsWatch } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  SKY_QUALITY_RULES,
  type SkyQualityOptions,
  type SkyQualityValues,
} from '../../../../sdk-core/src/modules/sky/quality.ts'
import type { AirShadowMaps } from '../../lighting/atmosphere/bindings.ts'
import { createAtmosphereGpu } from '../../lighting/atmosphere/gpu.ts'
import type { AirInputs } from '../../lighting/atmosphere/encode.ts'
import { FRAME_FLOATS, captureKmOf, writeAirFrame } from '../../lighting/atmosphere/frame.ts'
import { airShapeKey, airShapeOf, type AirShape } from '../../lighting/atmosphere/shape.ts'
import {
  vsmConsumerResources,
  vsmOrStandIns,
} from '../../lighting/shadows/vsm/frame/vsmConsumers.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
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

/** What the clouds and the sky light ask of the air, written before the image encodes it: the
 *  volumes of the haze's light and the air's apart (the clouds that fade each in at a distance of
 *  its own), the haze all around the capture's place (the clouds a capture draws), and the place the
 *  sky is captured from, scene metres — the sky light's, the eye's height over the origin where
 *  none is given. Each rests until it is written again. */
export interface AirRequests {
  separate: boolean
  capture360: boolean
  capturePosition?: readonly [number, number, number]
}

/** What the air holds per runtime: the quality settings it watches, the shape they make, and what
 *  is asked of it. */
interface AirState {
  readonly watch: ReturnType<typeof settingsWatch<typeof SKY_QUALITY_RULES>>
  readonly requests: AirRequests
  /** The image the settings were last read in. */
  read?: number
  quality?: SkyQualityValues
  shape?: AirShape
  key?: string
}

const states = new WeakMap<WebgpuPagesRuntime, AirState>()

/** The air's state in `rt`, its quality settings read again where they moved (the session's
 *  context holds them; a context holding none gives the defaults). */
function stateOf(rt: WebgpuPagesRuntime) {
  let state = states.get(rt)
  if (!state) {
    state = {
      watch: settingsWatch(SKY_QUALITY_RULES),
      requests: { separate: false, capture360: false },
    }
    states.set(rt, state)
  }
  // The settings are read once an image, however many times the air is asked about in it.
  if (state.read !== rt.run.frame || !state.shape) {
    state.read = rt.run.frame
    const values = state.watch.read(rt.context as SkyQualityOptions)
    if (state.watch.moved || !state.shape) {
      state.quality = { ...values }
      state.shape = airShapeOf(values)
      state.key = airShapeKey(state.shape)
    }
  }
  return state as AirState & { quality: SkyQualityValues; shape: AirShape; key: string }
}

/** What the clouds and the sky light ask of the air in `rt` (`AirRequests`): written by them each
 *  image, ahead of the encoding. */
export const airRequests = (rt: WebgpuPagesRuntime) => stateOf(rt).requests

/** The atmosphere this image shows: the scene's, in a lit view of the lit image, the quality settings
 *  not turning it off (`atmosphereOn`) — the unlit view and the views that paint raw values show
 *  none. The lights' store is told whether the air shades them. */
function atmosphereShown(rt: WebgpuPagesRuntime) {
  const { store } = rt.lights
  const air = store.environment?.atmosphere
  if (!air) return undefined
  const on = stateOf(rt).quality.atmosphereOn
  store.setAirOn(on)
  return on && litImageShown(rt) ? air : undefined
}

/** Starts the atmosphere's GPU work once a scene shows one: its pipelines compile off the frame
 *  and the frames wait for them (`createAtmosphereGpu`). Made again when the quality settings made
 *  another shape of it. A scene with none makes nothing. */
export function askAtmosphere(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!atmosphereShown(rt)) return
  const { shape, key } = stateOf(rt)
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
  const { requests } = stateOf(rt)
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
