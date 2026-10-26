import type { SceneLight } from '../../scene/light/contracts.ts'
import { resolveCloudShadowLight } from '../../modules/sky/cloudShadow.ts'
import { Color, type ColorInput } from '../math/color.ts'
import type { Light } from './light.ts'
import { defineWritable, lightStates, scalarGroup } from './lightNumbers.ts'

/** What a page may pass to a light about the clouds' shadows (`SceneLight.cloudShadow*`); a
 *  directional light's alone. */
export interface LightCloudShadowParameters {
  /** Whether the cloud march reads the light's opaque shadow map where it samples the clouds' light
   *  (of the air's lights only the first is read for it); off by default. */
  shadowsClouds?: boolean
  /** Whether the light has a cloud shadow map, as the air's light of its index
   *  (`atmosphereSunIndex`); off by default. */
  castCloudShadows?: boolean
  /** The weight of the map's extinction and optical depth, from 0; 1 by default. A strength of 0
   *  makes no map. */
  cloudShadowStrength?: number
  /** How much of the clouds' shade the air takes, from 0; 1 by default. */
  cloudShadowOnAtmosphereStrength?: number
  /** How much of the clouds' shade the surfaces take, from 0; 1 by default. */
  cloudShadowOnSurfaceStrength?: number
  /** Added to the depth where the cloud begins, in kilometres; 0 by default. */
  cloudShadowDepthBiasKm?: number
  /** The radius round the camera the map covers, in kilometres, from 1; 150 by default. */
  cloudShadowExtentKm?: number
  /** The factor on the map's 512 texels a side, from 0.25; 1 by default. */
  cloudShadowResolutionScale?: number
  /** The factor on the 16 samples a ray of the map takes, from 0.25; 1 by default. */
  cloudShadowRaySamplesScale?: number
  /** The factor on the light inside the clouds, linear; white by default. */
  cloudScatteredLuminanceScale?: ColorInput
}

declare module './light.ts' {
  interface Light {
    /** Whether the cloud march reads the light's opaque shadow map; off by default. A write reaches
     *  the world at once. */
    shadowsClouds: boolean
    /** Whether the light has a cloud shadow map; off by default. */
    castCloudShadows: boolean
    /** The weight of the map's extinction and optical depth, from 0; 1. */
    cloudShadowStrength: number
    /** How much of the clouds' shade the air takes, from 0; 1. */
    cloudShadowOnAtmosphereStrength: number
    /** How much of the clouds' shade the surfaces take, from 0; 1. */
    cloudShadowOnSurfaceStrength: number
    /** Added to the depth where the cloud begins, in kilometres; 0. */
    cloudShadowDepthBiasKm: number
    /** The radius round the camera the map covers, in kilometres, from 1; 150. */
    cloudShadowExtentKm: number
    /** The factor on the map's 512 texels a side, from 0.25; 1. */
    cloudShadowResolutionScale: number
    /** The factor on the 16 samples a ray of the map takes, from 0.25; 1. */
    cloudShadowRaySamplesScale: number
    /** The factor on the light inside the clouds, linear; white. Change it in place with `set`. */
    readonly cloudScatteredLuminanceScale: Color
  }
}

const DEFAULTS = /* @__PURE__ */ resolveCloudShadowLight({})
const SCALARS = [
  'shadowsClouds',
  'castCloudShadows',
  'cloudShadowStrength',
  'cloudShadowOnAtmosphereStrength',
  'cloudShadowOnSurfaceStrength',
  'cloudShadowDepthBiasKm',
  'cloudShadowExtentKm',
  'cloudShadowResolutionScale',
  'cloudShadowRaySamplesScale',
] as const

/** What a light holds of its cloud shadows: few lights hold any, so a map and not fields each light
 *  would carry. */
interface State {
  values: Record<(typeof SCALARS)[number], number | boolean>
  readonly scale: Color
}
const GROUP = scalarGroup(SCALARS, DEFAULTS)
const STATES = lightStates<State>(
  () => ({
    values: GROUP.fresh(),
    scale: new Color(DEFAULTS.cloudScatteredLuminanceScale as [number, number, number]),
  }),
  (state) => [state.scale],
)
const stateOf = STATES.of

/** Gives `light` the cloud shadow settings `p` names; the others stay at their defaults. */
export function take(light: Light, p: LightCloudShadowParameters) {
  GROUP.take(stateOf(light).values, p)
  if (p.cloudScatteredLuminanceScale !== undefined)
    stateOf(light).scale.set(p.cloudScatteredLuminanceScale)
}

/** Gives `light` the cloud shadow settings `source` has. */
export function copy(light: Light, source: Light) {
  const from = stateOf(source),
    to = stateOf(light)
  to.values = { ...from.values }
  to.scale.copy(from.scale)
}

/** The cloud shadow settings of `light` that differ from their default, by field; a directional
 *  light's alone. Empty for a light that sets none. */
export function settingsSet(light: Light): LightCloudShadowParameters {
  const state = STATES.peek(light)
  if (!state || light.kind !== 'directional') return {}
  const out: Record<string, unknown> = GROUP.differing(state.values)
  const scale = state.scale.toArray()
  if (scale.some((v, i) => v !== DEFAULTS.cloudScatteredLuminanceScale[i]))
    out.cloudScatteredLuminanceScale = scale
  return out
}

/** The cloud shadow settings a record holds, as the parameters of a light. */
export function fromRecord(record: SceneLight): LightCloudShadowParameters {
  const out: Record<string, unknown> = {
    cloudScatteredLuminanceScale: record.cloudScatteredLuminanceScale,
    ...GROUP.fromRecord(record),
  }
  return out
}

/** Defines the cloud shadow settings as accessors of `proto`: a write is noted on the light and
 *  reaches the world at once. */
export function define(proto: Light) {
  defineWritable(proto, SCALARS, (light) => stateOf(light).values)
  Object.defineProperty(proto, 'cloudScatteredLuminanceScale', {
    get(this: Light) {
      return stateOf(this).scale
    },
  })
}
