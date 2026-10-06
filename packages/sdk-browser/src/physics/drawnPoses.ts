/**
 * The drawn poses of the listed slots, written into `position` (3 numbers a slot) and `quaternion`
 * (4 a slot) from the states the simulation delivered (7 numbers a slot), before the placer
 * commits them. Each turn is normalised by the engine's one quaternion normalisation
 * (`normalizeQuaternionAt`); the arithmetic is the drawn image's, so none of it may be reordered.
 */
import { normalizeQuaternionAt, slerpOnArc } from '../../../sdk-core/src/math/matrix/quaternion.ts'

/** The `count` slots listed in `list` on their newest states (`target`) exactly. */
export function landAll(
  list: Int32Array,
  count: number,
  target: Float32Array,
  position: Float64Array,
  quaternion: Float64Array,
) {
  for (let i = 0; i < count; i++) {
    const index = list[i]
    for (let k = 0; k < 3; k++) position[index * 3 + k] = target[index * 7 + k]
    for (let k = 0; k < 4; k++) quaternion[index * 4 + k] = target[index * 7 + 3 + k]
  }
}

/**
 * The `count` slots listed in `list` the fraction `alpha` of a step from their state a step before
 * (`from`) to their state at its end (`to`): on the line between the two places, as a step moves
 * a body (`x + v·h`), and on the arc between the two turns (`arcs`, `slerpArc`'s 3 numbers a
 * slot), as a step turns it (about one axis at one rate, `Body::AddRotationStep`).
 */
export function interpolateAll(
  list: Int32Array,
  count: number,
  from: Float32Array,
  to: Float32Array,
  arcs: Float64Array,
  alpha: number,
  position: Float64Array,
  quaternion: Float64Array,
) {
  for (let i = 0; i < count; i++) {
    const index = list[i],
      o = index * 7,
      p = index * 3,
      q = index * 4
    position[p] = from[o] + (to[o] - from[o]) * alpha
    position[p + 1] = from[o + 1] + (to[o + 1] - from[o + 1]) * alpha
    position[p + 2] = from[o + 2] + (to[o + 2] - from[o + 2]) * alpha
    slerpOnArc(quaternion, q, from, o + 3, to, o + 3, alpha, arcs, index * 3)
    normalizeQuaternionAt(
      quaternion,
      q,
      quaternion[q],
      quaternion[q + 1],
      quaternion[q + 2],
      quaternion[q + 3],
    )
  }
}

/** The `count` slots listed in `list` moved on from their newest states (`target`) by `ahead`
 *  simulated seconds of their velocities (`velocity`, 6 numbers a slot: linear, then angular). */
export function extrapolateAll(
  list: Int32Array,
  count: number,
  target: Float32Array,
  velocity: Float32Array,
  ahead: number,
  position: Float64Array,
  quaternion: Float64Array,
) {
  const h = ahead / 2
  for (let i = 0; i < count; i++) {
    const index = list[i],
      o = index * 7,
      v = index * 6,
      p = index * 3,
      q = index * 4
    for (let k = 0; k < 3; k++) position[p + k] = target[o + k] + velocity[v + k] * ahead
    // The turn at angular velocity ω over `ahead`: q += ½ (ω, 0) ⊗ q · ahead.
    const wx = velocity[v + 3],
      wy = velocity[v + 4],
      wz = velocity[v + 5]
    const tx = target[o + 3],
      ty = target[o + 4],
      tz = target[o + 5],
      tw = target[o + 6]
    const x = tx + h * (wx * tw + wy * tz - wz * ty),
      y = ty + h * (wy * tw + wz * tx - wx * tz),
      z = tz + h * (wz * tw + wx * ty - wy * tx),
      w = tw - h * (wx * tx + wy * ty + wz * tz)
    normalizeQuaternionAt(quaternion, q, x, y, z, w)
  }
}
