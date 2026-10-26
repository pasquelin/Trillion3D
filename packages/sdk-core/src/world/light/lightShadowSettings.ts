import type { SceneLight } from '../../scene/light/contracts.ts'
import {
  LIGHT_SHADOW_FIELDS,
  LIGHT_SHADOW_RULES,
  type LightShadow,
  type LightShadowField,
  type LightShadowOptions,
} from '../../contracts/lightShadowOptions.ts'
import { resolveSetting } from '../../contracts/settingRules.ts'
import type { Light } from './light.ts'
import { lightChanged } from './lightNumbers.ts'

/** What a page may pass to a light about its shadows (`SceneLight` shadow fields, one for each rule
 *  of `LIGHT_SHADOW_RULES`); a directional light's alone. A distance is metres, `true` its default,
 *  `false` none. */
export type LightShadowParameters = LightShadowOptions

declare module './light.ts' {
  interface Light {
    /** Directional only: how far from the eye, in metres, its shadow maps are asked to reach, scaled
     *  by the view's `shadowDistanceScale`; 400. The far-shadow test's edge lies a little farther
     *  (427.0 at the defaults): a caster whose depth along the view, less its radius, is past it,
     *  and whose object does not set `castFarShadow`, is left out of the light's shadows. A write
     *  reaches the world at once, and makes the light's shadows again. */
    shadowDistance: number
    /** Directional only: the near levels its shadows are cut into, at most the view's
     *  `shadowNearLevels`; 4. */
    shadowCascades: number
    /** Directional only: how many times the span of the one before each near level takes; 3. */
    shadowCascadeExponent: number
    /** Directional only: the share of its span a near level overlaps into the next; 0.1. */
    shadowCascadeTransition: number
    /** Directional only: the far levels between its shadow distance and `farShadowDistance`; 0. */
    farShadowCascades: number
    /** Directional only: where its far levels end, in metres; 3000. */
    farShadowDistance: number
    /** Directional only: whether the cascade of the distance fields follows its near levels, where
     *  the scene has distance fields; on. */
    distanceFieldShadows: boolean
    /** Directional only: where that cascade ends, in metres, scaled by the view's
     *  `distanceFieldDistanceScale`; 512. */
    distanceFieldShadowDistance: number
    /** Directional only: how far a ray of that cascade goes, in metres, from 10 to 10 000; 100. */
    distanceFieldTraceDistance: number
    /** Directional only: the share of a pixel's depth its rays of that cascade start off the
     *  surface by; 0.003. */
    distanceFieldRayStartOffset: number
    /** Directional only: how dark the distance-field cascade's shadow is, from 0 to 1; 1. */
    shadowAmount: number
  }
}

const DEFAULTS = /* @__PURE__ */ Object.freeze(
  Object.fromEntries(
    LIGHT_SHADOW_FIELDS.map((field) => [field, LIGHT_SHADOW_RULES[field].default]),
  ),
) as Readonly<LightShadow>

/** What a light holds of its shadows: few lights hold any, so a map and not fields each light would
 *  carry. */
const STATES = new WeakMap<Light, Record<string, number | boolean>>()

const valuesOf = (light: Light) => {
  let values = STATES.get(light)
  if (!values) STATES.set(light, (values = { ...DEFAULTS }))
  return values
}

/** Gives `light` the shadow settings `p` names, each as its rule takes it; the others stay at their
 *  defaults. A light that is not a sun takes none. */
export function take(light: Light, p: LightShadowParameters) {
  if (light.kind !== 'directional') return
  for (const field of LIGHT_SHADOW_FIELDS)
    if (p[field] !== undefined)
      valuesOf(light)[field] = resolveSetting(LIGHT_SHADOW_RULES[field], p[field] as never)
}

/** Gives `light` the shadow settings `source` has. */
export function copy(light: Light, source: Light) {
  const from = STATES.get(source)
  if (from) STATES.set(light, { ...from })
  else STATES.delete(light)
}

/** The shadow settings of `light` that differ from their default, by field; a directional light's
 *  alone. Empty for a light that sets none. */
export function settingsSet(light: Light): LightShadowParameters {
  const values = STATES.get(light)
  if (!values || light.kind !== 'directional') return {}
  const out: Record<string, number | boolean> = {}
  for (const field of LIGHT_SHADOW_FIELDS)
    if (values[field] !== DEFAULTS[field]) out[field] = values[field]
  return out
}

/** The shadow settings a record holds, as the parameters of a light. */
export function fromRecord(record: SceneLight): LightShadowParameters {
  const from = record as unknown as Record<string, number | boolean | undefined>
  return Object.fromEntries(LIGHT_SHADOW_FIELDS.map((field) => [field, from[field]]))
}

/** Defines the shadow settings as accessors of `proto`: a write is checked by its rule, noted on the
 *  light and reaches the world at once. */
export function define(proto: Light) {
  for (const field of LIGHT_SHADOW_FIELDS)
    Object.defineProperty(proto, field, {
      get(this: Light) {
        return valuesOf(this)[field]
      },
      set(this: Light, value: number | boolean) {
        valuesOf(this)[field] = resolveSetting(
          LIGHT_SHADOW_RULES[field as LightShadowField],
          value as never,
        )
        lightChanged(this)
      },
    })
}
