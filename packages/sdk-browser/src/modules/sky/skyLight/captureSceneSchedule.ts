import {
  lowerHemisphereOf,
  skyLightSource,
  type SkyLightPart,
} from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import { sameHeld, type Held, type SkyLightInputs } from './captureInputs.ts'

/**
 * WHEN A CAPTURED SCENE IS CAPTURED. Pure: it decides, `captureScene.ts` draws. A capture is
 * asked — the light is dirty — when it is created, when the light first captures a scene, when its
 * cube or the angle of its cube changes, when its real-time capture is switched, when its cube is
 * made again, when its lower hemisphere's colour or coverage changes, and when the host asks for
 * one (`recapture`). A change of the light's colour, of its intensity, of its lower hemisphere's
 * flag, of its distance threshold or of its emissive flag, and the light's moving, ask for none:
 * they apply at the next capture. A light
 * that does not affect the world is not captured, nor is a static one, which is baked.
 */
export interface SceneCaptureState {
  /** What the last look found: a different one asks a capture. */
  key?: Held
  /** A capture is asked and not started. */
  due: boolean
  /** A capture is drawing. */
  running: boolean
  /** A capture is in the cube: it stays there, shown, while the next is drawn. */
  done: boolean
}

export const newSceneCaptureState = (): SceneCaptureState => ({
  due: false,
  running: false,
  done: false,
})

/** Whether the light's sky is a scene the engine draws into its cube: that is its source, it
 *  affects the world, and it is not static. */
const capturesScene = (part: SkyLightPart) =>
  skyLightSource(part) === 'capturedScene' &&
  part.light.affectsWorld &&
  part.light.mobility !== 'static'

/** What a change of asks a capture: whether the light captures a scene, its real-time flag, its
 *  cube and the angle of its cube (`SetCubemap`, `SetSourceCubemapAngle`), and the colour and
 *  coverage of its lower hemisphere. */
const keyOf = (input: SkyLightInputs): Held => [
  capturesScene(input.part),
  input.part.light.realTimeCapture,
  input.cubemap,
  input.part.light.sourceCubemapAngle,
  ...lowerHemisphereOf(input.part.light),
]

/** This frame's look at the light: a different key asks a capture. True when one is due now. */
export function lookAtScene(state: SceneCaptureState, input: SkyLightInputs) {
  const key = keyOf(input)
  if (!sameHeld(state.key, key)) {
    state.key = key
    state.due = true
  }
  return state.due && !state.running && capturesScene(input.part)
}

/** The host asks for a capture (`RecaptureSky`). */
export function recaptureScene(state: SceneCaptureState) {
  state.due = true
}

/** The cube is made again, or the source changed: nothing is captured, and the next look asks. */
export function forgetScene(state: SceneCaptureState) {
  state.key = undefined
  state.due = false
  state.done = false
}
