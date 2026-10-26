import type { SceneLight } from '../../scene/light/contracts.ts'
import { LIGHT_FUNCTION_DEFAULTS } from '../../scene/light/lightFunction.ts'
import { lightFunctionIdOf } from '../material/lightFunctionMaterial.ts'
import type { Material } from '../material/material.ts'
import { Vector3 } from '../math/vector3.ts'
import { listen } from '../observed.ts'
import type { Light } from './light.ts'
import { lightChanged } from './lightNumbers.ts'

/** What a page may pass to a light about its light function. */
export interface LightFunctionParameters {
  /** The light function material the light's colour is multiplied by, point by point. */
  lightFunction?: Material | null
  /** The scale of the projection in metres a tile: `x` along the light's up, `y` along its
   *  right, `z` along its direction; 10.24 on each by default. */
  lightFunctionScale?: readonly [number, number, number]
  /** The distance in metres from the eye past which the light function has faded, over a fifth of
   *  it, to `lightFunctionDisabledBrightness`; 1000 by default. */
  lightFunctionFadeDistance?: number
  /** The brightness of the light where its light function is faded out; 0.5 by default. */
  lightFunctionDisabledBrightness?: number
  /** A rectangle light's light function cone, the half-angle in degrees, at most 89; 0, the
   *  default, lays it flat on the face's plane. */
  lightFunctionConeAngle?: number
}

declare module './light.ts' {
  interface Light {
    /** The light function material the light's colour is multiplied by, point by point, one per
     *  light; none, `null`. A write reaches the world at once. */
    lightFunction: Material | null
    /** The light function's scale in metres a tile (`[up, right, along]`); 10.24 on each. Change it
     *  in place with `set`. */
    readonly lightFunctionScale: Vector3
    /** The distance in metres from the eye past which the light function has faded over a fifth of
     *  it to `lightFunctionDisabledBrightness`; 1000. */
    lightFunctionFadeDistance: number
    /** The brightness of the light where its light function is faded out; 0.5. */
    lightFunctionDisabledBrightness: number
    /** A rectangle's light function cone, its half-angle in degrees, at most 89; 0, the default,
     *  lays it flat on the face's plane. */
    lightFunctionConeAngle: number
  }
}

/** What a light holds of its light function: few lights hold any, so a map and not fields each
 *  light would carry. */
interface State {
  material: Material | null
  readonly scale: Vector3
  fadeDistance: number
  disabledBrightness: number
  coneAngle: number
  /** Removes the hearing of the material's writes, while the light is in a world. */
  stop?: () => void
}
const STATES = new WeakMap<Light, State>()

/** The state of `light`, made with the reference's defaults on its first use. */
function stateOf(light: Light): State {
  let state = STATES.get(light)
  if (!state) {
    const [x, y, z] = LIGHT_FUNCTION_DEFAULTS.scale
    state = {
      material: null,
      scale: new Vector3(x, y, z),
      fadeDistance: LIGHT_FUNCTION_DEFAULTS.fadeDistance,
      disabledBrightness: LIGHT_FUNCTION_DEFAULTS.disabledBrightness,
      coneAngle: LIGHT_FUNCTION_DEFAULTS.coneAngle,
    }
    STATES.set(light, state)
    listen(state.scale, () => lightChanged(light))
  }
  return state
}

/** Writes into `record` the light function `light` wears: the material's id, and each setting that
 *  differs from its default (`LIGHT_FUNCTION_DEFAULTS`), as the record holds them. A light that wears
 *  none adds nothing. */
export function record(light: Light, into: SceneLight) {
  const state = STATES.get(light)
  if (!state?.material) return
  const { scale, fadeDistance, coneAngle, disabledBrightness } = LIGHT_FUNCTION_DEFAULTS
  into.lightFunction = lightFunctionIdOf(state.material)
  if (!state.scale.equals({ x: scale[0], y: scale[1], z: scale[2] }))
    into.lightFunctionScale = state.scale.toArray()
  if (state.fadeDistance !== fadeDistance) into.lightFunctionFadeDistance = state.fadeDistance
  if (state.disabledBrightness !== disabledBrightness)
    into.lightFunctionDisabledBrightness = state.disabledBrightness
  if (light.kind === 'rectArea' && state.coneAngle !== coneAngle)
    into.lightFunctionConeAngle = state.coneAngle
}

/** Hears the writes of the material `light` wears while it is in a world (`on`), else not: out of
 *  one, a material holds no reference to the light. */
export function hear(light: Light, on: boolean) {
  const state = STATES.get(light)
  if (!state) return
  state.stop?.()
  state.stop = on ? state.material?._listeners.subscribe(() => lightChanged(light)) : undefined
}

/** Gives `light` the material `material`. */
function wear(light: Light, material: Material | null) {
  const state = stateOf(light)
  if (material) lightFunctionIdOf(material)
  if (state.material === material) return
  state.material = material
  hear(light, !!light._link)
}

/** Gives `light` the light function settings `p` names; the others stay at their defaults. */
export function take(light: Light, p: LightFunctionParameters) {
  if (p.lightFunction) wear(light, p.lightFunction)
  if (p.lightFunctionScale) stateOf(light).scale.set(...p.lightFunctionScale)
  if (p.lightFunctionFadeDistance !== undefined)
    stateOf(light).fadeDistance = p.lightFunctionFadeDistance
  if (p.lightFunctionDisabledBrightness !== undefined)
    stateOf(light).disabledBrightness = p.lightFunctionDisabledBrightness
  if (p.lightFunctionConeAngle !== undefined) stateOf(light).coneAngle = p.lightFunctionConeAngle
}

/** Gives `light` the light function settings `source` has. */
export function copy(light: Light, source: Light) {
  const from = stateOf(source)
  wear(light, from.material)
  stateOf(light).scale.copy(from.scale)
  Object.assign(stateOf(light), {
    fadeDistance: from.fadeDistance,
    disabledBrightness: from.disabledBrightness,
    coneAngle: from.coneAngle,
  })
}

const SCALARS = [
  'lightFunctionFadeDistance',
  'lightFunctionDisabledBrightness',
  'lightFunctionConeAngle',
] as const
const FIELD_OF = {
  lightFunctionFadeDistance: 'fadeDistance',
  lightFunctionDisabledBrightness: 'disabledBrightness',
  lightFunctionConeAngle: 'coneAngle',
} as const

/** Defines the light function settings as accessors of `proto`: a write is noted on the light and
 *  reaches the world at once. */
export function define(proto: Light) {
  Object.defineProperty(proto, 'lightFunction', {
    get(this: Light) {
      return STATES.get(this)?.material ?? null
    },
    set(this: Light, value: Material | null) {
      wear(this, value ?? null)
      lightChanged(this)
    },
  })
  Object.defineProperty(proto, 'lightFunctionScale', {
    get(this: Light) {
      return stateOf(this).scale
    },
  })
  for (const name of SCALARS)
    Object.defineProperty(proto, name, {
      get(this: Light) {
        return stateOf(this)[FIELD_OF[name]]
      },
      set(this: Light, value: number) {
        stateOf(this)[FIELD_OF[name]] = value
        lightChanged(this)
      },
    })
}
