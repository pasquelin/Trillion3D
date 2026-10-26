import { settingsWatch } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  SKY_QUALITY_RULES,
  type SkyQualityOptions,
  type SkyQualityValues,
} from '../../../../sdk-core/src/modules/sky/quality.ts'
import { airShapeKey, airShapeOf, type AirShape } from '../../lighting/atmosphere/shape.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * WHAT THE AIR HOLDS PER RUNTIME, which the atmosphere's encoding (`encodeAtmosphere.ts`), the
 * clouds and the sky light share: the quality settings it watches, the shape they make of its
 * programs, and what the clouds and the sky light ask of it.
 */

/** What the clouds and the sky light ask of the air, written before the image encodes it: the
 *  volumes of the haze's light and the air's apart (the clouds that fade each in at a distance of
 *  its own), the haze all around the capture's place (the clouds a capture draws), and the place the
 *  sky is captured from, scene metres — the sky light's, the eye's height over the origin where
 *  none is given. Each rests until it is written again. */
interface AirRequests {
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
export function airStateOf(rt: WebgpuPagesRuntime) {
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
      state.shape = airShapeOf(values, rt.setup.localFog)
      state.key = airShapeKey(state.shape)
    }
  }
  return state as AirState & { quality: SkyQualityValues; shape: AirShape; key: string }
}

/** What the clouds and the sky light ask of the air in `rt` (`AirRequests`): written by them each
 *  image, ahead of the encoding. */
export const airRequests = (rt: WebgpuPagesRuntime) => airStateOf(rt).requests

/** Whether the scene has an atmosphere that is on: declared, and not turned off by the quality
 *  settings (`atmosphereOn`). Where it is not, the clouds stand on the planet of no atmosphere
 *  (`airlessPlanet`). */
export const atmosphereDeclared = (rt: WebgpuPagesRuntime) =>
  !!rt.lights.store.environment?.atmosphere && airStateOf(rt).quality.atmosphereOn

/** The shape the air's programs of `rt` are made under: what the quality settings make of the air,
 *  whether or not an atmosphere is shown — the clouds' programs are made under it too. */
export const airShapeOfRuntime = (rt: WebgpuPagesRuntime) => airStateOf(rt).shape
