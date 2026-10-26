import { NO_INDEX } from '../../../../math/src/constants.ts'
import type { CloudPart } from '../../../../sdk-core/src/modules/sky/clouds.ts'
import { skyAtQuality, type ResolvedSky } from '../../../../sdk-core/src/modules/sky/descriptor.ts'
import type { SkyQualityValues } from '../../../../sdk-core/src/modules/sky/quality.ts'
import { cloudShadowOfLight } from '../../../../sdk-core/src/scene/light/lightCloudShadow.ts'
import {
  createCloudMaterialGpu,
  type CloudMaterialGpu,
} from '../../modules/sky/clouds/materialGpu.ts'
import { vsmConsumerResources } from '../../lighting/shadows/vsm/frame/vsmConsumers.ts'
import type { SceneCaptureHost } from '../../modules/sky/skyLight/captureScene.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { airStateOf, atmosphereDeclared } from './airState.ts'
import {
  followSkyCubemaps,
  releaseSkyCubemaps,
  sameSkyCubes,
  type SkyCubemaps,
  type SkyCubes,
} from './skyCubemaps.ts'
import { applySkyModule } from './skyModuleGate.ts'
import { skyLightReadOf, type SkyLightSource } from './skyLightState.ts'
import { type CaptureClouds, WHITE, noiseOf, captureCloudsOf } from './captureCloudsState.ts'

/**
 * THE SKY MODULE IN THE BACKEND: the word the world gives the engine of its sky (`applySky`), kept
 * for the frame to follow (`followSkyModule`). A sky with nothing resolved holds nothing: no
 * material, no source, no pass — what an earlier word made is released at once. With a clouds part
 * the material (`createCloudMaterialGpu`: the block, the generated textures, the sampler) is made
 * on the first frame, and the sources — the sky light's capture, the clouds' shadow maps — are set
 * once its textures have landed, and again when the word changes. The sky light stands at the
 * scene's origin, as the level's sky light does.
 */

interface SkyState {
  /** The word as given: the parts with the quality settings' defaults; none while the module is off. */
  given?: ResolvedSky
  /** The sky as the frame follows it: the word under the live quality settings (`followQuality`). */
  sky?: ResolvedSky
  /** The quality settings `sky` was made under: the air's own object, the same until a setting
   *  moves (`airStateOf`). None asks for `sky` to be made again. */
  quality?: SkyQualityValues
  /** What draws the scene aside for the sky light's captured scene: the engine. */
  scene: SceneCaptureHost
  /** The time in seconds the clouds drift by: the world's at the image, the one the material graphs
   *  read (`WebgpuRun.graphClocks.time`, taken once an image). */
  readonly clock: () => number
  material?: CloudMaterialGpu
  /** The part the material's block was written for. */
  part?: CloudPart
  /** The sources have to be set again: the word changed, or the textures landed. */
  dirty: boolean
  entries?: readonly GPUBindGroupEntry[]
  capture?: CaptureClouds
  /** The textures of the sky light's specified cubemap and its blend, and the cubes the sources were
   *  last set with. */
  readonly cubemaps: SkyCubemaps
  cubes?: SkyCubes
}

const states = new WeakMap<WebgpuPagesRuntime, SkyState>()
const ORIGIN = [0, 0, 0] as const

/** The sky word `rt` holds: none while no word was given. */
export const skyStateOf = (rt: WebgpuPagesRuntime) => states.get(rt)

/** Whether a cube of the sky light is still being written, face by face over the images
 *  (`followSkyCubemaps`): a quiet view is drawn again until it is whole. */
export const skyCubemapsPending = (rt: WebgpuPagesRuntime) =>
  states.get(rt)?.cubemaps.pending === true

/** Gives back the material of a sky with clouds. */
function dropMaterial(state: SkyState) {
  state.material?.dispose()
  state.material = state.part = state.entries = state.capture = undefined
}

/** Gives back what the sky module holds in `rt`: the sources, the material, the sky light's cubes,
 *  the lights of the air packed for the clouds. Nothing where it holds nothing. */
function dropSky(rt: WebgpuPagesRuntime, state: SkyState) {
  applySkyModule(rt, undefined, { position: ORIGIN, time: state.clock })
  rt.lights.store.setAirlessSuns(false)
  dropMaterial(state)
  releaseSkyCubemaps(rt.gpu.device, state.cubemaps)
  state.cubes = undefined
}

/** Gives back what the sky module holds in `rt`. Nothing where it holds nothing. */
export function disposeSkyModule(rt: WebgpuPagesRuntime) {
  const state = states.get(rt)
  if (!state) return
  states.delete(rt)
  dropSky(rt, state)
}

/**
 * The world's sky for the engine (`Engine.applySky`): the module's resolved parts, none when the
 * module is off, and the engine `scene` that draws the scene aside for a captured sky light. Takes
 * effect at the next frame.
 */
export function applySkyToRuntime(
  rt: WebgpuPagesRuntime,
  sky: ResolvedSky | undefined,
  scene: SceneCaptureHost,
) {
  let state = states.get(rt)
  if (!state) {
    // Never given a sky, and given none: nothing to hold, nothing to release.
    if (!sky) return
    states.set(
      rt,
      (state = {
        scene,
        clock: () => rt.run.graphClocks.time,
        dirty: true,
        cubemaps: {},
      }),
    )
  }
  state.given = sky
  state.quality = undefined
  state.dirty = true
  if (!sky) {
    state.sky = undefined
    dropSky(rt, state)
  }
}

/** The sky of `state` under the live quality settings, made again where they moved since it was
 *  made or the word changed: the settings are those of the session's context (`airStateOf`), as
 *  the air's are, so a setting written by the page, a preset or the editor reaches the sky light's
 *  capture, the clouds and their shadow maps in the image that follows. None while the module is
 *  off. */
function followQuality(rt: WebgpuPagesRuntime, state: SkyState) {
  const { quality } = airStateOf(rt)
  if (state.given && state.quality !== quality) {
    state.quality = quality
    state.sky = skyAtQuality(state.given, quality)
    state.dirty = true
  }
  return state.sky
}

/** The channel of the air's first light in the shadow maps, none unless it casts a shadow that the
 *  maps project this image. */
export function sunChannelOf(rt: WebgpuPagesRuntime) {
  const { store } = rt.lights
  const sun = store.atmosphereLight(0)
  if (!sun?.castsShadow || !vsmConsumerResources(rt)) return NO_INDEX
  const slice = store.sliceOf(store.slotOf(sun.id))
  return slice >= 0 ? slice & 63 : NO_INDEX
}

/** The refilled part of the capture's clouds: the time, the air, the sun's channel in the shadow
 *  maps, the sky light and the blue noise. */
function refillCapture(rt: WebgpuPagesRuntime, state: SkyState, capture: CaptureClouds) {
  const { store } = rt.lights
  capture.time = state.clock()
  capture.air.airPresent = atmosphereDeclared(rt)
  for (const index of [0, 1] as const) {
    const light = store.atmosphereLight(index)
    capture.air.lightScales[index] = light
      ? cloudShadowOfLight(light).cloudScatteredLuminanceScale
      : WHITE
  }
  const channel = sunChannelOf(rt)
  capture.air.sunShadowChannel = channel === NO_INDEX ? undefined : channel
  capture.skyLight = skyLightReadOf(rt)
  capture.blueNoise = noiseOf(rt)
}

/** The material's block written for the part, the capture's clouds made over it. */
function followClouds(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  state: SkyState,
  clouds: CloudPart,
) {
  state.material ??= createCloudMaterialGpu(device, (error) =>
    rt.diag.diagnosticFailure('cloud-material-failed', error),
  )
  if (state.part !== clouds) {
    state.material.update(clouds.material)
    state.part = clouds
    state.capture = undefined
  }
  const entries = state.material.entries
  if (entries && !state.capture && rt.gpu.deferred)
    state.capture = captureCloudsOf(rt, clouds, entries)
  if (state.capture) refillCapture(rt, state, state.capture)
}

/**
 * Follows the sky word at the start of an image: the clouds' material made and written, the sky
 * light's cubes made of its pictures, the sources set where the word, the material's textures or the
 * cubes changed since the last image. Does nothing,
 * allocates nothing, while no sky word was given or the module is off.
 */
export function followSkyModule(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const state = states.get(rt)
  const sky = state && followQuality(rt, state)
  if (!state || !sky) return
  const clouds = sky.clouds
  // Where there is no atmosphere, the clouds light a medium by the lights of the air: the light
  // store packs them for them alone.
  rt.lights.store.setAirlessSuns(!!clouds)
  if (clouds) followClouds(rt, device, state, clouds)
  else if (state.material) dropMaterial(state)
  const entries = state.material?.entries
  const cubes = followSkyCubemaps(device, state.cubemaps, sky.skyLight)
  if (!state.dirty && state.entries === entries && sameSkyCubes(state.cubes, cubes)) return
  state.dirty = false
  state.entries = entries
  state.cubes = cubes
  applySkyModule(rt, sky, {
    position: ORIGIN,
    cubemap: cubes.cubemap,
    cubemapScale: cubes.cubemapScale,
    blend: cubes.blend,
    captureClouds: state.capture as SkyLightSource['clouds'],
    scene: state.scene,
    material: entries,
    time: state.clock,
  })
}
