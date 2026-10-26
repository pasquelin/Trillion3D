import type { CloudPart } from '../../../../sdk-core/src/modules/sky/clouds.ts'
import { cloudShadowWanted } from '../../../../sdk-core/src/modules/sky/cloudShadow.ts'
import {
  cloudSkyOcclusionWanted,
  type CloudSkyOcclusionLight,
} from '../../../../sdk-core/src/modules/sky/cloudSkyOcclusion.ts'
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { cloudShadowOfLight } from '../../../../sdk-core/src/scene/light/lightCloudShadow.ts'
import type { CloudShadowSet } from '../../lighting/atmosphere/cloudShadowRead.ts'
import {
  createCloudShadowRun,
  type CloudShadowLightInput,
  type CloudShadowRun,
} from '../../modules/sky/clouds/shadowRun.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { writeAirlessFrame } from './airlessFrame.ts'
import { atmosphereDeclared } from './airState.ts'

/**
 * THE CLOUDS' SHADOW MAPS IN THE FRAME: what the clouds tell the frame of the maps
 * (`CloudShadowSource`), the maps built on the image's encoder before the air, the fog and the
 * surfaces read them (`encodeCloudShadow`), and the set they read (`cloudShadowOf`): the maps, the
 * sampler and the block of matrices and strengths (`CloudShadowSet`), or none while no map is built.
 * The maps are built for the main view, which keeps their history (`keepsState`). Each of the air's
 * two lights has its own, from the cloud shadow settings of the light the store holds for its index
 * (`cloudShadowLightsOf`). The clouds' sky occlusion map is built with them where the sky light asks
 * for it (`CloudShadowSource.skyLight`); no map is made, and no pass run, while neither light nor
 * the sky light asks for one.
 */
export interface CloudShadowSource {
  readonly part: CloudPart
  /** The material's seven bindings of the trace's group, kept the same while the material is. */
  readonly material: readonly GPUBindGroupEntry[]
  /** The time, seconds. */
  readonly time: () => number
  /** The sky light's settings the sky occlusion map reads: the sky light of the scene, where it
   *  affects the world; none otherwise. */
  readonly skyLight?: CloudSkyOcclusionLight
}

interface CloudShadowState {
  source?: CloudShadowSource
  run?: CloudShadowRun
  set?: CloudShadowSet
}

type Pair = [CloudShadowLightInput | undefined, CloudShadowLightInput | undefined]

const states = new WeakMap<WebgpuPagesRuntime, CloudShadowState>()
/** The inputs made of a record, once for each: the store replaces a record at every change. */
const inputs = new WeakMap<SceneLight, CloudShadowLightInput>()
const pair: Pair = [undefined, undefined]

/** The air's two lights as the clouds know them: the settings of the light the store holds for
 *  each index and the unit direction toward it; none for an index without a light. One array,
 *  rewritten at each call. */
function cloudShadowLightsOf(store: WebgpuPagesRuntime['lights']['store']): Pair {
  for (const index of [0, 1] as const) {
    const light = store.atmosphereLight(index)
    let input = light && inputs.get(light)
    if (light?.direction && !input) {
      const [x, y, z] = light.direction
      input = { light: cloudShadowOfLight(light), toward: [-x, -y, -z] }
      inputs.set(light, input)
    }
    pair[index] = input
  }
  return pair
}

const stateOf = (rt: WebgpuPagesRuntime) => {
  let state = states.get(rt)
  if (!state) states.set(rt, (state = {}))
  return state
}

/** The clouds of `rt` give these shadow maps, or none (`undefined`). */
export function setCloudShadowSource(
  rt: WebgpuPagesRuntime,
  source: CloudShadowSource | undefined,
) {
  const state = stateOf(rt)
  state.source = source
  if (!source) {
    state.run?.dispose()
    state.run = state.set = undefined
  }
}

/** The shade the clouds cast this image, none while no map is built. */
export const cloudShadowOf = (rt: WebgpuPagesRuntime) => states.get(rt)?.set

/** What the maps are traced over: the atmosphere's planet and frame; with no atmosphere, the planet
 *  of the clouds part and the frame of the stand-in air (`writeAirlessFrame`). None while an
 *  atmosphere is on and its programs are not compiled yet. */
function overWhat(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera, part: CloudPart) {
  const { gpu, lights } = rt
  if (!atmosphereDeclared(rt))
    return {
      radiusKm: part.settings.planetRadiusKm,
      groundHeight: 0,
      groundPosition: [0, 0],
      frame: writeAirlessFrame(rt, device, cam, part.settings.planetRadiusKm).frame,
    }
  const air = lights.store.environment?.atmosphere
  if (!air || !gpu.atmosphere?.ready) return undefined
  return {
    radiusKm: air.planetRadius,
    groundHeight: air.groundHeight,
    groundPosition: air.groundPosition,
    frame: gpu.atmosphere.frameBuffer,
  }
}

/** The maps of this image, built on `encoder` ahead of the air, the fog and the surfaces that read
 *  them. None where the clouds give none or the atmosphere's programs are not compiled. */
export function encodeCloudShadow(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const state = stateOf(rt),
    { source } = state,
    { lights } = rt
  state.set = undefined
  if (!source || !lights.buffer) return
  const asked = cloudShadowLightsOf(lights.store)
  // No light and no sky light asks for a map: none is made, and what an earlier image made is released.
  if (
    !cloudSkyOcclusionWanted(source.part.quality, source.skyLight) &&
    !asked.some((input) => cloudShadowWanted(source.part.quality, input?.light))
  ) {
    state.run?.dispose()
    state.run = undefined
    return
  }
  const over = overWhat(rt, device, cam, source.part)
  if (!over) return
  state.run ??= createCloudShadowRun(device, (error) =>
    rt.diag.diagnosticFailure('cloud-shadow-program-failed', error),
  )
  if (!state.run.ready) return
  const { eye } = cam
  state.set = state.run.encode(encoder, {
    part: source.part,
    lights: asked,
    eye,
    eyeFromPlanetKm: [
      (eye[0] - over.groundPosition[0]) / 1000,
      (eye[1] - over.groundHeight) / 1000 + over.radiusKm,
      (eye[2] - over.groundPosition[1]) / 1000,
    ],
    planetRadiusKm: over.radiusKm,
    time: source.time(),
    frameIndex: rt.run.frame,
    material: source.material,
    air: { buffer: lights.buffer, frame: over.frame },
    keepsState: rt.views.active === rt.views.main,
    skyLight: source.skyLight,
  })
}
