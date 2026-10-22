import { skyLightSource, type SkyLightPart } from '../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { FogRead } from '../../lighting/fog/read.ts'
import type { SkyLightCapture, SkyLightInputs } from '../../modules/sky/skyLight/capture.ts'
import type { SceneCaptureHost } from '../../modules/sky/skyLight/captureScene.ts'
import {
  createSkyLightSampler,
  SKY_LIGHT_READ_WORDS,
  type SkyLightReadSet,
} from '../../modules/sky/skyLight/read.ts'
import { skyLightStandIn } from '../../modules/sky/skyLight/standIn.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { holdSkyLight } from './skyLightHeld.ts'

/**
 * What the frame holds of the sky light, apart from its capture's encoding (`./encodeSkyLight.ts`):
 * the light the sky module gives (`setSkyLightSource`), whether the bounce waits for it
 * (`skyLightPending`), and what the programs read it with (`skyLightReadOf`). The passes that read
 * the light import this module alone, never the capture that draws the scene.
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
  /** What draws the scene aside for a captured scene: the engine (`SceneCaptureHost`). */
  readonly scene?: SceneCaptureHost
}

/** What the frame keeps of the sky light, per runtime. */
export interface SkyLightState {
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

export const skyLightStateOf = (rt: WebgpuPagesRuntime) => {
  let state = states.get(rt)
  if (!state) states.set(rt, (state = { uniform: new Float32Array(SKY_LIGHT_READ_WORDS) }))
  return state
}

/** The sky light of `rt` is `source`, or none (`undefined`). */
export function setSkyLightSource(rt: WebgpuPagesRuntime, source: SkyLightSource | undefined) {
  const state = skyLightStateOf(rt)
  state.source = source
  holdSkyLight(rt, source?.part)
  // No light: the capture and its textures are released, nothing of it is encoded again.
  if (!source && state.capture) {
    state.capture.dispose()
    state.capture = state.shape = undefined
  }
}

/**
 * Whether the bounce probes must wait for the sky: the scene has a sky light that captures in real time and no
 * cube of it is ready yet — the probes would hold a sky of none, and the surfaces they answer be dark until
 * they were made again. Meanwhile a surface reads the sky light's own diffuse light where the probes answer
 * nothing, once the harmonics land.
 */
export function skyLightPending(rt: WebgpuPagesRuntime) {
  const { source, capture } = skyLightStateOf(rt)
  return !!source && skyLightSource(source.part) === 'realTime' && !capture?.read()
}

/**
 * What a program reads the sky light with this image (`SkyLightReadSet`): the capture's filtered
 * cubes, the trilinear sampler, the harmonics and the view's uniform, or the stand-in that gives no
 * light while no cube is ready. The set is the same object while the cube and the buffers are.
 */
export function skyLightReadOf(rt: WebgpuPagesRuntime): SkyLightReadSet {
  const device = rt.gpu.device!,
    state = skyLightStateOf(rt),
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
