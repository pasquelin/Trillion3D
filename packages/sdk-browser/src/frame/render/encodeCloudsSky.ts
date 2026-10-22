import { NO_INDEX } from '../../../../math/src/constants.ts'
import type { CloudPart } from '../../../../sdk-core/src/modules/sky/clouds.ts'
import type { ResolvedSky } from '../../../../sdk-core/src/modules/sky/descriptor.ts'
import { cloudShadowOfLight } from '../../../../sdk-core/src/scene/light/lightCloudShadow.ts'
import { cpuNow } from '../../diagnostic/stopwatch.ts'
import {
  createCloudMaterialGpu,
  type CloudMaterialGpu,
} from '../../modules/sky/clouds/materialGpu.ts'
import {
  vsmConsumerResources,
  vsmOrStandIns,
} from '../../lighting/shadows/vsm/frame/vsmConsumers.ts'
import type { SceneCaptureHost } from '../../modules/sky/skyLight/captureScene.ts'
import type { SkyLightReadSet } from '../../modules/sky/skyLight/read.ts'
import type { SkyHost } from '../../session/engine/types.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { atmosphereDeclared } from './airState.ts'
import { applySkyModule } from './skyModuleGate.ts'
import { skyLightReadOf, type SkyLightSource } from './skyLightState.ts'

/**
 * THE SKY MODULE IN THE BACKEND: the word the world gives the engine of its sky (`applySky`), kept
 * for the frame to follow (`followSkyModule`). A sky with nothing resolved holds nothing: no
 * material, no source, no pass — what an earlier word made is released at once. With a clouds part
 * the material (`createCloudMaterialGpu`: the block, the generated textures, the sampler) is made
 * on the first frame, and the sources — the sky light's capture, the clouds' shadow maps — are set
 * once its textures have landed, and again when the word changes. The sky light stands at the
 * scene's origin, as the level's sky light does.
 */

/** What the capture of the sky light is told of the clouds, refilled each frame: the time, the blue
 *  noise, the air, the channel of the sun in the shadow maps and the sky light's read set; the part
 *  and the material are the sky's. */
type CaptureClouds = {
  part: CloudPart
  material: readonly GPUBindGroupEntry[]
  blueNoise: GPUTextureView
  time: number
  air: {
    airPresent: boolean
    lightScales: [ArrayLike<number>, ArrayLike<number>]
    sunShadowChannel?: number
  }
  skyLight: SkyLightReadSet
}

interface SkyState {
  sky?: ResolvedSky
  host: SkyHost
  /** What draws the scene aside for the sky light's captured scene: the engine. */
  scene: SceneCaptureHost
  /** The time in seconds the clouds drift by: from the first word given. */
  readonly clock: () => number
  material?: CloudMaterialGpu
  /** The part the material's block was written for. */
  part?: CloudPart
  /** The sources have to be set again: the word changed, or the textures landed. */
  dirty: boolean
  entries?: readonly GPUBindGroupEntry[]
  capture?: CaptureClouds
}

const states = new WeakMap<WebgpuPagesRuntime, SkyState>()
const WHITE = [1, 1, 1]
const ORIGIN = [0, 0, 0] as const

/** The sky word `rt` holds: none while no word was given. */
export const skyStateOf = (rt: WebgpuPagesRuntime) => states.get(rt)

/** Gives back the material of a sky with clouds. */
function dropMaterial(state: SkyState) {
  state.material?.dispose()
  state.material = state.part = state.entries = state.capture = undefined
}

/** Gives back what the sky module holds in `rt`: the sources, the material. Nothing where it holds
 *  nothing. */
export function disposeSkyModule(rt: WebgpuPagesRuntime) {
  const state = states.get(rt)
  if (!state) return
  states.delete(rt)
  applySkyModule(rt, undefined, { position: ORIGIN, time: state.clock })
  dropMaterial(state)
}

/**
 * The world's sky for the engine (`Engine.applySky`): the module's resolved parts, none when the
 * module is off, what the host holds that the module does not, and the engine `scene` that draws
 * the scene aside for a captured sky light. Takes effect at the next frame.
 */
export function applySkyToRuntime(
  rt: WebgpuPagesRuntime,
  sky: ResolvedSky | undefined,
  host: SkyHost,
  scene: SceneCaptureHost,
) {
  let state = states.get(rt)
  if (!state) {
    // Never given a sky, and given none: nothing to hold, nothing to release.
    if (!sky) return
    const startMs = cpuNow()
    states.set(rt, (state = { host, scene, clock: () => (cpuNow() - startMs) / 1000, dirty: true }))
  }
  state.sky = sky
  state.host = host
  state.dirty = true
  if (!sky) {
    applySkyModule(rt, undefined, { position: ORIGIN, time: state.clock })
    dropMaterial(state)
  }
}

/** The channel of the air's first light in the shadow maps, none unless it casts a shadow that is
 *  projected this image (`shadowed`). */
export function sunChannelOf(rt: WebgpuPagesRuntime, shadowed: boolean) {
  const { store } = rt.lights
  const slot = store.fogSunSlot
  const slice = slot >= 0 ? store.sliceOf(slot) : -1
  return shadowed && slice >= 0 ? slice & 63 : NO_INDEX
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
  const channel = sunChannelOf(
    rt,
    !!vsmConsumerResources(rt) && !!store.atmosphereLight(0)?.castsShadow,
  )
  capture.air.sunShadowChannel = channel === NO_INDEX ? undefined : channel
  capture.skyLight = skyLightReadOf(rt)
  const { placeholders } = rt.gpu.deferred!
  capture.blueNoise = vsmOrStandIns(vsmConsumerResources(rt), placeholders).noise
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
    state.capture = {
      part: clouds,
      material: entries,
      blueNoise: undefined as unknown as GPUTextureView,
      time: 0,
      air: { airPresent: false, lightScales: [WHITE, WHITE] },
      skyLight: undefined as unknown as SkyLightReadSet,
    }
  if (state.capture) refillCapture(rt, state, state.capture)
}

/**
 * Follows the sky word at the start of an image: the clouds' material made and written, the
 * sources set where the word or the material's textures changed since the last image. Does nothing,
 * allocates nothing, while no sky word was given or the module is off.
 */
export function followSkyModule(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const state = states.get(rt)
  if (!state?.sky) return
  const clouds = state.sky.clouds
  if (clouds) followClouds(rt, device, state, clouds)
  else if (state.material) dropMaterial(state)
  const entries = state.material?.entries
  if (!state.dirty && state.entries === entries) return
  state.dirty = false
  state.entries = entries
  applySkyModule(rt, state.sky, {
    position: ORIGIN,
    cubemap: state.host.cubemap,
    captureClouds: state.capture as SkyLightSource['clouds'],
    scene: state.scene,
    material: entries,
    time: state.clock,
  })
}
