import { noteNodeWrite } from '../../scene/core/nodeEdits.ts'
import type { SceneLight } from '../../scene/light/contracts.ts'
import { resolveLightShaftLight } from '../../modules/sky/lightShafts.ts'
import { Color, type ColorInput } from '../math/color.ts'
import { Vector3, readVec3, type Vec3Input } from '../math/vector3.ts'
import { listen } from '../observed.ts'
import type { Light } from './light.ts'

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
const STATES = new WeakMap<Light, State>()

const changed = (light: Light) => {
  noteNodeWrite(light)
  light._link?.content(light)
}

function stateOf(light: Light): State {
  let state = STATES.get(light)
  if (!state) {
    const [x, y, z] = DEFAULTS.shaftOverrideDirection
    state = {
      values: Object.fromEntries(SCALARS.map((name) => [name, DEFAULTS[name]])) as State['values'],
      direction: new Vector3(x, y, z),
      tint: new Color(DEFAULTS.shaftBloomTint as [number, number, number]),
    }
    STATES.set(light, state)
    listen(state.direction, () => changed(light))
    listen(state.tint, () => changed(light))
  }
  return state
}

/** Gives `light` the shaft settings `p` names; the others stay at their defaults. */
export function take(light: Light, p: LightShaftParameters) {
  for (const name of SCALARS) if (p[name] !== undefined) stateOf(light).values[name] = p[name]
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
  const state = STATES.get(light)
  if (!state) return {}
  const directional = light.kind === 'directional'
  const out: Record<string, unknown> = {}
  for (const name of SCALARS)
    if (state.values[name] !== DEFAULTS[name] && (directional || !DIRECTIONAL_ONLY.has(name)))
      out[name] = state.values[name]
  const differs = (now: number[], by: readonly number[]) => now.some((v, i) => v !== by[i])
  const direction = state.direction.toArray()
  if (directional && differs(direction, DEFAULTS.shaftOverrideDirection))
    out.shaftOverrideDirection = direction
  const tint = state.tint.toArray()
  if (differs(tint, DEFAULTS.shaftBloomTint)) out.shaftBloomTint = tint
  return out
}

/** Writes into `record` each shaft setting of `light` that differs from its default. */
export function record(light: Light, into: SceneLight) {
  Object.assign(into, settingsSet(light))
}

/** The shaft settings a record holds, as the parameters of a light. */
export function fromRecord(record: SceneLight): LightShaftParameters {
  const { shaftOverrideDirection, shaftBloomTint } = record
  const from = record as unknown as Record<string, number | boolean | undefined>
  const out: Record<string, unknown> = { shaftOverrideDirection, shaftBloomTint }
  for (const name of SCALARS) out[name] = from[name]
  return out
}

/** Defines the shaft settings as accessors of `proto`: a write is noted on the light and reaches
 *  the world at once. */
export function define(proto: Light) {
  for (const name of SCALARS)
    Object.defineProperty(proto, name, {
      get(this: Light) {
        return stateOf(this).values[name]
      },
      set(this: Light, value: number | boolean) {
        stateOf(this).values[name] = value
        changed(this)
      },
    })
  Object.defineProperty(proto, 'shaftOverrideDirection', {
    get(this: Light) {
      return stateOf(this).direction
    },
  })
  Object.defineProperty(proto, 'shaftBloomTint', {
    get(this: Light) {
      return stateOf(this).tint
    },
  })
}
