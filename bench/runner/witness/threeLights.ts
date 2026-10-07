// Contract lights converted to the Three witness's units, served under `/runner/` with
// `witness/threeBareScene.ts`, its one user, and imported by its URL.
//
// No light is written here by hand: the witness places the contract lights the harness hands it
// (`options.lights` of `witness/threeMeasurePage.ts`), never a named scene's. Both engines then
// receive the same lighting, and their per-pixel delta measures materials and rendering, not the
// lighting convention.
import type { SceneLight } from '../../../packages/sdk-core/src/scene/light/contracts.ts'
import { saturate } from '../../../packages/math/src/scalar/reals.ts'

/** Physical inverse-square of the contract: `directIncidence` knows no other falloff. */
const DECAY = 2

/**
 * The Three penumbra that reproduces the contract's cone edge. The engine softens the cone
 * with `smoothstep(cos θ, cos θ + douceur, cos α)`; Three with `smoothstep(cos θ, cos(θ(1 − p)), cos α)`.
 * The two edges therefore coincide for `p = 1 − acos(cos θ + douceur) / θ`, clamped to [0, 1].
 */
function penombre(coneAngle: number, douceur: number) {
  const interieur = Math.acos(Math.min(1, Math.cos(coneAngle) + douceur))
  return saturate(1 - interieur / Math.max(coneAngle, 1e-6))
}

/** A light as `appliquer` writes it: a Three light of the witness (`witness/threeBareScene.ts`). */
export type Lamp = {
  readonly color: { setRGB(r: number, g: number, b: number): unknown }
  intensity: number
  castShadow: boolean
  readonly position: {
    set(x: number, y: number, z: number): unknown
    fromArray(a: number[]): unknown
  }
  readonly target?: { readonly position: { set(x: number, y: number, z: number): unknown } }
  distance?: number
  decay?: number
  angle?: number
  penumbra?: number
}

/**
 * Contract values applied to the Three light, in Three units: linear colour, radiometric
 * intensity with no factor, `distance` = range and `decay` = 2, which gives exactly the
 * engine's windowed attenuation. A directional has neither position nor range: only the
 * direction counts, which Three reads as `position − target`, hence the opposite of
 * propagation.
 */
export function appliquer(object: Lamp, light: SceneLight, douceur: number) {
  object.color.setRGB(light.color[0], light.color[1], light.color[2])
  object.intensity = light.intensity
  object.castShadow = false
  if (light.kind === 'directional') {
    const direction = light.direction ?? [0, -1, 0]
    object.position.set(-direction[0], -direction[1], -direction[2])
    object.target!.position.set(0, 0, 0)
    return
  }
  const position = light.position ?? [0, 0, 0]
  object.position.fromArray(position)
  object.distance = light.range ?? 0
  object.decay = DECAY
  if (light.kind !== 'spot') return
  const spot = object
  const direction = light.direction ?? [0, -1, 0]
  const range = light.range ?? 0
  spot.angle = light.coneAngle ?? 0
  spot.penumbra = penombre(light.coneAngle ?? 0, douceur)
  spot.target!.position.set(
    position[0] + direction[0] * range,
    position[1] + direction[1] * range,
    position[2] + direction[2] * range,
  )
}
