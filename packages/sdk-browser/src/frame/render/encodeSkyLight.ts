import { skyLightCubeWidth } from '../../../../sdk-core/src/modules/sky/skyLight.ts'
import { cloudSeparatesAir } from '../../../../sdk-core/src/modules/sky/clouds.ts'
import type { SceneFog } from '../../../../sdk-core/src/scene/core/fog.ts'
import { cloudsInView } from '../../modules/sky/clouds/cloudModes.ts'
import { airlessAirOf } from '../../lighting/atmosphere/airless.ts'
import { airlessPlanet } from '../../lighting/atmosphere/frame.ts'
import { airShapeKey } from '../../lighting/atmosphere/shape.ts'
import type { FogRead } from '../../lighting/fog/read.ts'
import { createSkyLightCapture, type SkyLightInputs } from '../../modules/sky/skyLight/capture.ts'
import { SKY_LIGHT_READ_WORDS, writeSkyLightRead } from '../../modules/sky/skyLight/read.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { skyOcclusionUse } from '../../lighting/distanceField/ao/state.ts'
import { airRequests, airShapeOfRuntime, atmosphereDeclared } from './airState.ts'
import { mapsOf } from './encodeAtmosphere.ts'
import { shownHeightFogOf } from './encodeFogVolume.ts'
import { capturePreExposure } from './skyLightFog.ts'
import { skyLightStateOf, type SkyLightState } from './skyLightState.ts'

/**
 * THE SKY LIGHT IN THE FRAME: the capture made over the air's tables that the sky module's light
 * (`SkyLightSource`, `./skyLightState.ts`) asks for, and the three steps of a frame — the air asked for what the
 * capture needs (`requestSkyAir`, before the air is encoded), the real-time capture encoded
 * (`encodeSkyCapture`, before the surface cards that read the light), the static capture drawn between two
 * frames once the frame is submitted (`skyLightSubmitted`) — and the light's read uniform written
 * for the view drawn now (`writeSkyLightParams`, after the capture's step and the occlusion's, which the view's `skyLighting` override switches).
 */

/** What the capture asks of the air this image, written before the air is encoded: the place it
 *  captures from, the haze apart when the clouds ask for it and the haze all around that place when
 *  the capture draws the clouds. Rewritten each image, so a source taken away asks nothing. */
export function requestSkyAir(rt: WebgpuPagesRuntime) {
  const source = skyLightStateOf(rt).source
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
    state.fog = {
      cubemap,
      read: { cubemap, volume: stand.volume, sampler: stand.sampler, tiles: stand.tiles },
    }
  return state.fog.read
}

/** The air the capture reads once the image has built it: the resolved atmosphere, the light
 *  buffer, the tables and the volumes, and the fog — or, where the scene has no atmosphere and the
 *  capture draws clouds, the stand-in air and the planet of the clouds (`airlessAirOf`), whose sky
 *  is not drawn (`atmosphere` false). None where the atmosphere's programs are not compiled yet, or
 *  there is neither an atmosphere nor clouds to draw. */
function airOf(rt: WebgpuPagesRuntime, state: SkyLightState) {
  const { gpu, lights } = rt
  if (!lights.buffer || !gpu.deferred || !gpu.device) return undefined
  const resolved = lights.store.environment?.atmosphere
  const fog = () => captureFog(rt, state, gpu.deferred!.placeholders.fog)
  if (resolved && atmosphereDeclared(rt)) {
    if (!gpu.atmosphere?.ready) return undefined
    const air = {
      resolved,
      buffer: lights.buffer,
      ...gpu.atmosphere.tables,
      volumes: gpu.atmosphere.volumes,
      maps: mapsOf(rt),
    }
    return { air, fog: fog(), atmosphere: true }
  }
  const clouds = state.source?.clouds
  if (!clouds) return undefined
  const bare = airlessAirOf(gpu.device)
  const air = {
    resolved: airlessPlanet(clouds.part.settings.planetRadiusKm),
    buffer: lights.buffer,
    transmittance: bare.transmittance,
    multiScatter: bare.multiScatter,
    sampler: bare.sampler,
    volumes: bare.volumes,
    maps: mapsOf(rt),
  }
  return { air, fog: fog(), atmosphere: false }
}

/** Whether the scene's fog is a height fog that shows in the sky capture (`inSkyCapture`). */
const fogInSkyCapture = (fog: SceneFog | undefined) =>
  !!fog && !!shownHeightFogOf(fog)?.inSkyCapture

/** This image's inputs of the capture; none where there is no light. */
function inputsOf(rt: WebgpuPagesRuntime, state: SkyLightState): SkyLightInputs | undefined {
  const { source } = state,
    { gpu, lights } = rt
  if (!source || !gpu.device) return undefined
  const around = airOf(rt, state)
  return {
    part: source.part,
    width: skyLightCubeWidth(source.part, gpu.device.limits.maxTextureDimension2D),
    preExposure: capturePreExposure(rt),
    frame: rt.run.frame,
    position: source.position,
    air: around?.air,
    cubemap: source.cubemap,
    cubemapScale: source.cubemapScale,
    blend: source.blend,
    atmosphere: around?.atmosphere ?? false,
    fog: around?.fog,
    fogShown: fogInSkyCapture(lights.store.environment?.fog),
    clouds: source.clouds,
  }
}

/** The capture over the air of the current shape: made again when the quality settings made another
 *  shape of the air, so that its programs follow them — and the project switch of the local fog
 *  volumes (`localFogVolumeSupport`), also where the scene has no atmosphere. */
function captureOf(rt: WebgpuPagesRuntime, state: SkyLightState, device: GPUDevice) {
  const shape = airShapeOfRuntime(rt)
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

/** Whether this image makes the capture: the main view's, which is drawn first each frame. A view drawn
 *  beside it, or a capture of the image aside, only reads the light: the capture is the scene's, made
 *  once a frame, from the air and the clouds of the main view. */
const makesCapture = (rt: WebgpuPagesRuntime) =>
  rt.views.active === rt.views.main && !rt.capture.capturing

/** The real-time capture's step of this image (`SkyLightCapture.encode`), on `encoder`, after the
 *  air's tables of the image are built (`encodeAir`) and before the surface cards and the bounce that read
 *  the light, then the light's read uniform of the view drawn now: made and written here, so that the
 *  first image whose cube is ready is read as the sky, not the stand-in. The uniform is written again
 *  once the occlusion is known (`encodePreLight`). */
export function encodeSkyCapture(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  if (makesCapture(rt)) {
    const state = skyLightStateOf(rt)
    const input = inputsOf(rt, state)
    const capture = input && captureOf(rt, state, device)
    if (input && capture?.ready) capture.encode(encoder, input)
  }
  writeSkyLightParams(rt, device)
}

/** The image was submitted: a captured scene that is due is drawn aside, between two images
 *  (`SkyLightCapture.captureScene`), never from a capture's own image. */
export function skyLightSubmitted(rt: WebgpuPagesRuntime) {
  if (!makesCapture(rt)) return
  const state = skyLightStateOf(rt),
    input = inputsOf(rt, state),
    capture = state.capture,
    scene = state.source?.scene
  if (input && scene && capture?.sceneDue(input)) void capture.captureScene(scene, input)
}

/**
 * The light's read uniform written for the view drawn now (`writeSkyLightRead`), after the capture's
 * step of the image, and again once the occlusion is drawn: the surface cards and the bounce read its
 * light and cube words, the indirect pass the occlusion's (`mode`, `indirectPassWgsl.ts`). The words: the light's colour, black where the view's `skyLighting` override is off, the
 * cube of the ready capture, its last mip and the layer of it that is ready, and, for a real-time
 * capture, the inverse of the pre-exposure it is written with. Nothing while no cube is ready: the
 * programs read the stand-in.
 */
export function writeSkyLightParams(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const state = skyLightStateOf(rt)
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
    capturePreExposure(rt),
  )
  device.queue.writeBuffer(state.params, 0, words.buffer, words.byteOffset, words.byteLength)
}
