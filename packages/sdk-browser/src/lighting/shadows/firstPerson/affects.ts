import { sphereMeetsCone } from '../../../../../math/src/geometry/sphere.ts'
import type { VsmProjectionLight } from '../vsm/projection/projectionPass.ts'

/**
 * Whether `light` can light a sphere (`centre`, `radius`, the first-person objects' bounds): a sun always; a local light when the sphere lies
 * within its range, and a spot when it also meets the spot's outer cone — the cone tested apex-back by the sphere's radius over the cone's sine,
 * the sphere holding the apex excepted (the lights whose self shadow is traced are those that reach the first-person objects, one sphere for
 * them all).
 */
export function lightAffectsSphere(
  light: VsmProjectionLight,
  centre: ArrayLike<number>,
  radius: number,
) {
  if (light.type === 'directional') return true
  const p = light.position
  const dx = centre[0]! - p[0]!,
    dy = centre[1]! - p[1]!,
    dz = centre[2]! - p[2]!
  const reach = light.radius + radius
  if (dx * dx + dy * dy + dz * dz > reach * reach) return false
  if (light.type !== 'spot') return true
  // A cone of no width reaches nothing, one of a quarter turn or more every sphere within range.
  if (light.coneAngle <= 0) return false
  if (light.coneAngle >= Math.PI / 2) return true
  // The cone is tested apex-back by the sphere's radius over its sine, the sphere that holds the apex reached (`sphereMeetsCone`).
  return sphereMeetsCone(
    [centre[0]!, centre[1]!, centre[2]!, radius],
    p,
    light.direction,
    1,
    Math.sin(light.coneAngle),
    Math.cos(light.coneAngle),
  )
}
