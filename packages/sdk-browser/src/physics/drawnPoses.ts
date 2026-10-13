/**
 * The drawn poses of the listed slots, written into `position` (3 numbers a slot) and `quaternion`
 * (4 a slot) from the states the simulation delivered (7 numbers a slot), before the placer
 * commits them. Each turn is normalised by the engine's one quaternion normalisation
 * (`normalizeQuaternionAt`); the arithmetic is the drawn image's, so none of it may be reordered.
 */
import { lerp } from '../../../math/src/scalar/reals.ts'
import {
  arcAngularVelocity,
  normalizeQuaternionAt,
  slerpOnArc,
  turnByAngularVelocity,
} from '../../../math/src/quaternion/quaternion.ts'

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
    position[p] = lerp(from[o], to[o], alpha)
    position[p + 1] = lerp(from[o + 1], to[o + 1], alpha)
    position[p + 2] = lerp(from[o + 2], to[o + 2], alpha)
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

/**
 * THE ONE LAW OF A LATE TICK. The `count` slots listed in `list` moved on from their newest states
 * (`target`) by `ahead` of their velocities (`velocity`, 6 numbers a slot: linear, then angular, per
 * unit of `ahead`): on the line at their velocity, and turned about their angular velocity's axis
 * at its rate (`turnByAngularVelocity`, the exact turn), as a step moves and turns a body. A body
 * goes on at the velocities the simulation gave it (`poses.ts`); a thing the simulation gives no
 * velocity, a wheel, at those of its own last step (`stepVelocitiesAll`).
 */
export function extrapolateAll(
  list: Int32Array,
  count: number,
  target: ArrayLike<number>,
  velocity: ArrayLike<number>,
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
    // The turn at angular velocity ω over `ahead`: about ω's axis by |ω| · ahead.
    turnByAngularVelocity(quaternion, q, target, o + 3, velocity, v + 3, h)
  }
}

/** The velocities, per step, of the `count` slots listed in `list` over their last step: from their
 *  state a step before (`from`) to their newest (`to`), on the line `to − from` and about the arc
 *  between their turns (`arcs`, `slerpArc`'s 3 numbers a slot) at its rate (`arcAngularVelocity`),
 *  into `velocity` (6 numbers a slot) — what `extrapolateAll` moves them on by, a step ahead being
 *  1, as `interpolateAll` would go on past the step's end. */
export function stepVelocitiesAll(
  list: Int32Array,
  count: number,
  from: ArrayLike<number>,
  to: ArrayLike<number>,
  arcs: Float64Array,
  velocity: Float64Array,
) {
  for (let i = 0; i < count; i++) {
    const index = list[i],
      o = index * 7,
      v = index * 6
    for (let k = 0; k < 3; k++) velocity[v + k] = to[o + k] - from[o + k]
    arcAngularVelocity(velocity, v + 3, from, o + 3, to, o + 3, arcs, index * 3, 1)
  }
}
