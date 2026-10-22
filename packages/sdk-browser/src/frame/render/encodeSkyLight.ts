import {
  skyLightCubeWidth,
  skyLightSource,
  type SkyLightPart,
} from '../../../../sdk-core/src/modules/sky/skyLight.ts'
import { cloudSeparatesAir } from '../../../../sdk-core/src/modules/sky/clouds.ts'
import { cloudsInView } from '../../modules/sky/clouds/cloudModes.ts'
import { airShapeKey, DEFAULT_AIR_SHAPE } from '../../lighting/atmosphere/shape.ts'
import type { FogRead } from '../../lighting/fog/read.ts'
import {
  createSkyLightCapture,
  type SkyLightCapture,
  type SkyLightInputs,
} from '../../modules/sky/skyLight/capture.ts'
import {
  createSkyLightSampler,
  SKY_LIGHT_READ_WORDS,
  writeSkyLightRead,
  type SkyLightReadSet,
} from '../../modules/sky/skyLight/read.ts'
import { skyLightStandIn } from '../../modules/sky/skyLight/standIn.ts'
import { captureHdrViews } from '../io/hdrCapture.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { skyOcclusionUse } from '../../lighting/distanceField/ao/state.ts'
import { airRequests, mapsOf } from './encodeAtmosphere.ts'
import { holdSkyLight } from './skyLightHeld.ts'

/**
 * THE SKY LIGHT IN THE FRAME: what the sky module tells the frame of the light (`SkyLightSource`),
 * the capture made over the air's tables, the three steps of a frame — the air asked for what the
 * capture needs (`requestSkyAir`, before the air is encoded), the real-time capture encoded
 * (`encodeSkyLight`, before the passes that read the light), the static capture drawn between two
 * frames once the frame is submitted (`skyLightSubmitted`) — and what the light's read holds
 * (`skyLightUniform`, which the view's `skyLighting` override switches).
 */

/** What the sky module gives the frame of one sky light. */
export interface SkyLightSource {
  readonly part: SkyLightPart
  /** Where the light stands in the scene, metres. */
  readonly position: readonly [number, number, number]
  /** The host's cube, for a light whose source is a specified cubemap. */
  readonly cubemap?: GPUTexture
  /** The cube the host's cube blends to and the share of it (`SkyLightInputs.blend`, `SetCubemapBlend`). */
  readonly blend?: SkyLightInputs['blend']
  /** The clouds the capture draws, where the scene has them (`SkyLightInputs.clouds`). */
  readonly clouds?: SkyLightInputs['clouds']
}

/** What the frame keeps of the sky light, per runtime. */
interface SkyLightState {
  source?: SkyLightSource
  capture?: SkyLightCapture
  /** The shape of the air the capture's programs were written for. */
  shape?: string
  /** The fog the capture reads: the cubemap of the scene's, the sampler and the volume of none. */
  fog?: { cubemap: GPUTextureView; read: FogRead }
  readonly uniform: Float32Array
  /** What the programs read the light with (`skyLightReadOf`): the uniform buffer of the view and the
   *  set made over the capture's cube, kept the same while that is. */
  params?: GPUBuffer
  read?: SkyLightReadSet
}

const states = new WeakMap<WebgpuPagesRuntime, SkyLightState>()

const stateOf = (rt: WebgpuPagesRuntime) => {
  let state = states.get(rt)
  if (!state) states.set(rt, (state = { uniform: new Float32Array(SKY_LIGHT_READ_WORDS) }))
  return state
}

/** The sky light of `rt` is `source`, or none (`undefined`). */
export function setSkyLightSource(rt: WebgpuPagesRuntime, source: SkyLightSource | undefined) {
  const state = stateOf(rt)
  state.source = source
  holdSkyLight(rt, source?.part)
  // No light: the capture and its textures are released, nothing of it is encoded again.
  if (!source && state.capture) {
    state.capture.dispose()
    state.capture = state.shape = undefined
  }
}

/** What the capture asks of the air this image, written before the air is encoded: the place it
 *  captures from, the haze apart when the clouds ask for it and the haze all around that place when
 *  the capture draws the clouds. Rewritten each image, so a source taken away asks nothing. */
export function requestSkyAir(rt: WebgpuPagesRuntime) {
  const source = stateOf(rt).source
  const requests = airRequests(rt)
  const clouds = source?.clouds
  requests.capturePosition = source?.position
  requests.separate = !!clouds && cloudSeparatesAir(clouds.part.settings)
  requests.capture360 =
    !!clouds &&
    cloudsInView(clouds.part.settings, true) &&
    clouds.part.quality.cloudAerialPerspective
}

/** The fog the capture reads: the cubemap of the scene's, the sampler and the volume of none. */
function captureFog(rt: WebgpuPagesRuntime, state: SkyLightState, stand: FogRead) {
  const cubemap = (rt.gpu.fogVolume?.read ?? stand).cubemap
  if (state.fog?.cubemap !== cubemap)
    state.fog = { cubemap, read: { cubemap, volume: stand.volume, sampler: stand.sampler } }
  return state.fog.read
}

/** The air the capture reads once the image has built it: the resolved atmosphere, the light
 *  buffer, the tables and the volumes, and the fog. None where the scene shows no air or its
 *  programs are not compiled yet. */
function airOf(rt: WebgpuPagesRuntime, state: SkyLightState) {
  const { gpu, lights } = rt
  const resolved = lights.store.environment?.atmosphere
  if (!resolved || !lights.buffer || !gpu.deferred || !gpu.atmosphere?.ready) return undefined
  return {
    air: {
      resolved,
      buffer: lights.buffer,
      ...gpu.atmosphere.tables,
      volumes: gpu.atmosphere.volumes,
      maps: mapsOf(rt),
    },
    fog: captureFog(rt, state, gpu.deferred.placeholders.fog),
  }
}

/** This image's inputs of the capture; none where there is no light. */
function inputsOf(rt: WebgpuPagesRuntime, state: SkyLightState): SkyLightInputs | undefined {
  const { source } = state,
    { gpu, lights } = rt
  if (!source || !gpu.device) return undefined
  const around = airOf(rt, state)
  return {
    part: source.part,
    width: skyLightCubeWidth(source.part, gpu.device.limits.maxTextureDimension2D),
    frame: rt.run.frame,
    position: source.position,
    air: around?.air,
    cubemap: source.cubemap,
    blend: source.blend,
    atmosphere: !!around,
    fog: around?.fog,
    fogShown: !!lights.store.environment?.fog,
    clouds: source.clouds,
  }
}

/** The capture over the air of the current shape: made again when the quality settings made another
 *  shape of the air, so that its programs follow them. */
function captureOf(rt: WebgpuPagesRuntime, state: SkyLightState, device: GPUDevice) {
  const shape = rt.gpu.atmosphere?.shape ?? DEFAULT_AIR_SHAPE
  const key = airShapeKey(shape)
  if (state.capture && state.shape !== key) {
    state.capture.dispose()
    state.capture = undefined
  }
  state.shape = key
  return (state.capture ??= createSkyLightCapture(
    device,
    (error) => rt.diag.diagnosticFailure('sky-light-capture-failed', error),
    shape,
  ))
}

/** The real-time capture's step of this image (`SkyLightCapture.encode`), on `encoder`, after the
 *  air's tables of the image are built and before the passes that read the light. */
export function encodeSkyLight(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const state = stateOf(rt),
    input = inputsOf(rt, state)
  const capture = input && captureOf(rt, state, device)
  if (input && capture?.ready) capture.encode(encoder, input)
  writeSkyLightParams(rt, device, state)
}

/** The image was submitted: a captured scene that is due is drawn aside, between two images
 *  (`SkyLightCapture.captureScene`), never from a capture's own image. */
export function skyLightSubmitted(rt: WebgpuPagesRuntime) {
  if (rt.capture.capturing || rt.views.active !== rt.views.main) return
  const state = stateOf(rt),
    input = inputsOf(rt, state),
    capture = state.capture
  if (input && capture?.sceneDue(input))
    void capture.captureScene({ captureHdrViews: (job) => captureHdrViews(rt, job) }, input)
}

/**
 * The light's read uniform written for the view drawn now (`writeSkyLightRead`), after the capture's
 * step of the image: the light's colour, black where the view's `skyLighting` override is off, the
 * cube of the ready capture, its last mip and the layer of it that is ready. Nothing while no cube
 * is ready: the programs read the stand-in.
 */
function writeSkyLightParams(rt: WebgpuPagesRuntime, device: GPUDevice, state: SkyLightState) {
  const ready = state.capture?.read()
  if (!ready || !state.source) return
  const { skyLighting } = rt.views.active.overrides
  state.params ??= device.createBuffer({
    label: 'Trillion3D sky light read',
    size: SKY_LIGHT_READ_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = writeSkyLightRead(
    state.uniform,
    state.source.part,
    ready.mips,
    skyLighting,
    ready.colorScale,
    skyOcclusionUse(rt),
    { layer: ready.layer, blend: ready.blend },
  )
  device.queue.writeBuffer(state.params, 0, words.buffer, words.byteOffset, words.byteLength)
}

/**
 * Whether the bounce probes must wait for the sky: the scene has a sky light that captures in real time and no
 * cube of it is ready yet — the probes would hold a sky of none, and the surfaces they answer be dark until
 * they were made again. Meanwhile a surface reads the sky light's own diffuse light where the probes answer
 * nothing, once the harmonics land.
 */
export function skyLightPending(rt: WebgpuPagesRuntime) {
  const { source, capture } = stateOf(rt)
  return !!source && skyLightSource(source.part) === 'realTime' && !capture?.read()
}

/**
 * What a program reads the sky light with this image (`SkyLightReadSet`): the capture's filtered
 * cubes, the trilinear sampler, the harmonics and the view's uniform, or the stand-in that gives no
 * light while no cube is ready. The set is the same object while the cube and the buffers are.
 */
export function skyLightReadOf(rt: WebgpuPagesRuntime): SkyLightReadSet {
  const device = rt.gpu.device!,
    state = stateOf(rt),
    ready = state.source && state.params ? state.capture?.read() : undefined
  if (!ready) return skyLightStandIn(device)
  const held = state.read
  if (held?.cube === ready.cube && held.harmonics === ready.harmonics) return held
  return (state.read = {
    cube: ready.cube,
    sampler: held?.sampler ?? createSkyLightSampler(device),
    harmonics: ready.harmonics,
    params: state.params!,
  })
}
