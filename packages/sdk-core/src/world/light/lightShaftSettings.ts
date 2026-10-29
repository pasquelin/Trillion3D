import type { SceneLight } from '../../scene/light/contracts.ts'
import { resolveLightShaftLight } from '../../modules/sky/lightShafts.ts'
import { Color, type ColorInput } from '../math/color.ts'
import { Vector3, readVec3, type Vec3Input } from '../math/vector3.ts'
import type { Light } from './light.ts'
import { defineReadonly, defineWritable, lightStates, scalarGroup } from './lightNumbers.ts'

/** What a page may pass to a light about its light shafts (`SceneLight.shaft*`). */
export interface LightShaftParameters {
  /** Directional only: whether the light darkens the fog's inscattering where the scene hides it;
   *  off by default. */
  shaftOcclusion?: boolean
  /** Directional only: what an occlusion of 0 maps to, 1 darkening nothing; 0.05 by default. */
  shaftOcclusionDarkness?: number
  /** Directional only: everything closer to the eye than this distance, in metres, occludes the
   *  shafts; 1000 by default. */
  shaftOcclusionDepthRange?: number
  /** Directional only: when not zero, the direction the shafts come from instead of the light's
   *  own; zero by default. */
  shaftOverrideDirection?: Vec3Input
  /** Whether the light adds a bloom around itself; off by default. */
  shaftBloom?: boolean
  /** The factor on the colour the bloom adds; 0.2 by default. */
  shaftBloomScale?: number
  /** The brightness the image must pass, after exposure, to bloom; 0 by default. */
  shaftBloomThreshold?: number
  /** A brightness above it, after exposure, is brought down to it; 100 by default. */
  shaftBloomMaxBrightness?: number
  /** The factor on the bloom's colour, linear; white by default. */
  shaftBloomTint?: ColorInput
}

declare module './light.ts' {
  interface Light {
    /** Directional only: whether the light darkens the fog's inscattering where the scene hides
     *  it; off by default. A write reaches the world at once. */
    shaftOcclusion: boolean
    /** Directional only: what an occlusion of 0 maps to, 1 darkening nothing; 0.05. */
    shaftOcclusionDarkness: number
    /** Directional only: everything closer to the eye than this distance, in metres, occludes the
     *  shafts; 1000. */
    shaftOcclusionDepthRange: number
    /** Directional only: when not zero, the direction the shafts come from instead of the light's
     *  own; zero. Change it in place with `set`. */
    readonly shaftOverrideDirection: Vector3
    /** Whether the light adds a bloom around itself; off by default. */
    shaftBloom: boolean
    /** The factor on the colour the bloom adds; 0.2. */
    shaftBloomScale: number
    /** The brightness the image must pass, after exposure, to bloom; 0. */
    shaftBloomThreshold: number
    /** A brightness above it, after exposure, is brought down to it; 100. */
    shaftBloomMaxBrightness: number
    /** The factor on the bloom's colour, linear; white. Change it in place with `set`. */
    readonly shaftBloomTint: Color
  }
}

const DEFAULTS = /* @__PURE__ */ resolveLightShaftLight({})
const SCALARS = [
  'shaftOcclusion',
  'shaftOcclusionDarkness',
  'shaftOcclusionDepthRange',
  'shaftBloom',
  'shaftBloomScale',
  'shaftBloomThreshold',
  'shaftBloomMaxBrightness',
] as const
const DIRECTIONAL_ONLY = new Set<string>([
  'shaftOcclusion',
  'shaftOcclusionDarkness',
  'shaftOcclusionDepthRange',
])

/** What a light holds of its shafts: few lights hold any, so a map and not fields each light would
 *  carry. */
interface State {
  values: Record<(typeof SCALARS)[number], number | boolean>
  readonly direction: Vector3
  readonly tint: Color
}
const GROUP = scalarGroup(SCALARS, DEFAULTS)
const STATES = lightStates<State>(
  () => {
    const [x, y, z] = DEFAULTS.shaftOverrideDirection
    return {
      values: GROUP.fresh(),
      direction: new Vector3(x, y, z),
      tint: new Color(DEFAULTS.shaftBloomTint as [number, number, number]),
    }
  },
  (state) => [state.direction, state.tint],
)
const stateOf = STATES.of

/** Gives `light` the shaft settings `p` names; the others stay at their defaults. */
export function take(light: Light, p: LightShaftParameters) {
  GROUP.take(stateOf(light).values, p)
  if (p.shaftOverrideDirection) stateOf(light).direction.set(...readVec3(p.shaftOverrideDirection))
  if (p.shaftBloomTint !== undefined) stateOf(light).tint.set(p.shaftBloomTint)
}

/** Gives `light` the shaft settings `source` has. */
export function copy(light: Light, source: Light) {
  const from = stateOf(source),
    to = stateOf(light)
  to.values = { ...from.values }
  to.direction.copy(from.direction)
  to.tint.copy(from.tint)
}

/** The shaft settings of `light` that differ from their default, by field; the occlusion and the
 *  override direction, a directional light's alone. Empty for a light that sets none. */
export function settingsSet(light: Light): LightShaftParameters {
  const state = STATES.peek(light)
  if (!state) return {}
  const directional = light.kind === 'directional'
  const out: Record<string, unknown> = GROUP.differing(
    state.values,
    (name) => !directional && DIRECTIONAL_ONLY.has(name),
  )
  const differs = (now: number[], by: readonly number[]) => now.some((v, i) => v !== by[i])
  const direction = state.direction.toArray()
  if (directional && differs(direction, DEFAULTS.shaftOverrideDirection))
    out.shaftOverrideDirection = direction
  const tint = state.tint.toArray()
  if (differs(tint, DEFAULTS.shaftBloomTint)) out.shaftBloomTint = tint
  return out
}

/** The shaft settings a record holds, as the parameters of a light. */
export function fromRecord(record: SceneLight): LightShaftParameters {
  const { shaftOverrideDirection, shaftBloomTint } = record
  const out: Record<string, unknown> = {
    shaftOverrideDirection,
    shaftBloomTint,
    ...GROUP.fromRecord(record),
  }
  return out
}

/** Defines the shaft settings as accessors of `proto`: a write is noted on the light and reaches
 *  the world at once. */
export function define(proto: Light) {
  defineWritable(proto, SCALARS, (light) => stateOf(light).values)
  defineReadonly(proto, {
    shaftOverrideDirection: (light) => stateOf(light).direction,
    shaftBloomTint: (light) => stateOf(light).tint,
  })
}
