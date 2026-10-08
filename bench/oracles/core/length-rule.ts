// The engine's expressions before the length rule (docs/MATHS.md "Lengths"), frozen word for
// word: the oracles the length-rule sweeps hold the rewritten sites to, each at its f32 bits.
import type { TrackKind } from '../../../packages/sdk-core/src/world/animation/clip.ts'
import { hypot2, hypot3 } from '../../../packages/math/src/float/hypot.ts'
import { clamp, saturate } from '../../../packages/math/src/scalar/reals.ts'
import { RADIUS_EPSILON } from '../../../packages/math/src/vector/spherical.ts'
import { copyMatrix4, determinantMatrix4 } from '../../../packages/math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../packages/math/src/matrix/matrix4Inverse.ts'
import { multiplyMatrix4Typed } from '../../../packages/math/src/matrix/matrix4Typed.ts'

type Point2 = [number, number]

/** `toSpherical` of `packages/math/src/vector/spherical.ts` as it was: the radius by `hypot3`. */
export function oldToSpherical(out: Float64Array, offset: ArrayLike<number>) {
  const radius = hypot3(offset[0], offset[1], offset[2])
  out[0] = radius
  if (radius <= RADIUS_EPSILON) return out
  out[1] = Math.atan2(offset[0], offset[2])
  out[2] = Math.acos(clamp(offset[1] / radius, -1, 1))
  return out
}

/** `driveTick`'s approach of `packages/sdk-core/src/collision/characterDrive.ts` as it was: the
 *  gap to the wished velocity `(tx, tz)` by `hypot2`, its integral over the tick `h` and what is
 *  left of it, `[dx, dz, vx, vz]` before the rest test. */
export function oldDriveApproach(
  vx: number,
  vz: number,
  tx: number,
  tz: number,
  h: number,
  rate: number,
  push: number,
) {
  const [gx, gz] = [vx - tx, vz - tz],
    gap = hypot2(gx, gz)
  const linear = gap > push / rate ? Math.min(h, (gap - push / rate) / push) : 0,
    middle = linear > 0 ? gap - push * linear : gap,
    decay = Math.exp(-rate * (h - linear)),
    reach = rate > 0 ? (1 - decay) / rate : h - linear
  const along = gap > 0 ? (((gap + middle) / 2) * linear + middle * reach) / gap : 0,
    left = gap > 0 ? (middle * decay) / gap : 0
  return [tx * h + gx * along, tz * h + gz * along, tx + gx * left, tz + gz * left]
}

/** `planeBasis` of `packages/sdk-core/src/scene/core/proxyDelta.ts` as it was: the normal by
 *  `Math.hypot` and three divisions. */
function oldPlaneBasis(out: Float64Array, matrix: ArrayLike<number>, a: number, b: number) {
  copyMatrix4(out, matrix)
  for (let row = 0; row < 3; row++) {
    out[row] = matrix[a * 4 + row]
    out[row + 4] = matrix[b * 4 + row]
  }
  const x = out[1] * out[6] - out[2] * out[5]
  const y = out[2] * out[4] - out[0] * out[6]
  const z = out[0] * out[5] - out[1] * out[4]
  const length = Math.hypot(x, y, z)
  out[8] = length ? x / length : 0
  out[9] = length ? y / length : 0
  out[10] = length ? z / length : 0
}

const bindBasis = new Float64Array(16),
  worldBasis = new Float64Array(16),
  inverse = new Float64Array(16)
/** `proxyAffineDelta` as it was, on `oldPlaneBasis`. */
export function oldAffineDelta(
  out: Float64Array,
  bind: Float64Array,
  world: ArrayLike<number>,
  bindInverse: Float64Array,
) {
  if (determinantMatrix4(bind) !== 0) return multiplyMatrix4Typed(out, world, bindInverse)
  let best = 0,
    first = 0,
    second = 1
  for (let a = 0; a < 3; a++)
    for (let b = a + 1; b < 3; b++) {
      oldPlaneBasis(bindBasis, bind, a, b)
      const area = Math.abs(determinantMatrix4(bindBasis))
      if (area > best) {
        best = area
        first = a
        second = b
      }
    }
  oldPlaneBasis(bindBasis, bind, first, second)
  oldPlaneBasis(worldBasis, world, first, second)
  invertMatrix4(inverse, bindBasis)
  return multiplyMatrix4Typed(out, worldBasis, inverse)
}

/** The former `norm` of `packages/sdk-core/src/world/geometry/shape.ts`, word for word:
 *  `hypot2 || 1`, then each component divided. */
const oldNorm = ([x, y]: Point2): Point2 => {
  const l = hypot2(x, y) || 1
  return [x / l, y / l]
}

/** The former `offsetRing` of `shape.ts` on `oldNorm`: each point pushed along its bisector. */
export function oldOffset(ring: Point2[], by: number): Point2[] {
  if (by === 0) return ring
  return ring.map((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length],
      b = ring[(i + 1) % ring.length]
    const e1 = oldNorm([p[0] - a[0], p[1] - a[1]]),
      e2 = oldNorm([b[0] - p[0], b[1] - p[1]])
    const n = oldNorm([e1[1] + e2[1], -(e1[0] + e2[0])])
    const miter = Math.max(0.25, n[0] * e1[1] - n[1] * e1[0])
    return [p[0] + (n[0] * by) / miter, p[1] + (n[1] * by) / miter]
  })
}

/** `segmentSpeed` of `packages/sdk-core/src/world/animation/trackSegment.ts` as it was, linear
 *  segments: speeds and quaternion lengths by `Math.hypot`. */
export function oldSegmentSpeed(
  values: Float32Array,
  kind: TrackKind,
  span: number,
  width: number,
) {
  if (kind !== 'quaternion') {
    let speed = 0
    for (let c = 0; c < width; c++)
      speed = Math.hypot(speed, (values[width + c] - values[c]) / span)
    return speed
  }
  const a = Float64Array.from(values.subarray(0, 4)),
    b = Float64Array.from(values.subarray(4, 8))
  const lengthA = Math.hypot(...a),
    lengthB = Math.hypot(...b)
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const sign = cos < 0 ? -1 : 1
  cos = Math.min(1, cos * sign)
  const angle = Math.acos(cos),
    sin = Math.sin(angle),
    omega = angle / span
  if (Math.abs(lengthA - 1) < 1e-6 && Math.abs(lengthB - 1) < 1e-6 && sin >= 1e-6) return omega
  let chord = 0
  for (let c = 0; c < 4; c++) chord += (sign * b[c] - a[c]) ** 2
  for (let c = 0; c < 4; c++) b[c] *= sign
  if (sin < 1e-6) return normalised(a, b, span, 0, Math.sqrt(chord) / span)
  const longest = Math.max(lengthA, lengthB)
  return normalised(
    a,
    b,
    span,
    (omega * omega * longest) / Math.cos(angle / 2),
    (omega * Math.sqrt(chord)) / sin + omega * angle * longest,
  )
}
function normalised(a: Float64Array, b: Float64Array, span: number, bend: number, speed: number) {
  let chord = 0,
    along = 0
  for (let c = 0; c < 4; c++) {
    chord += (b[c] - a[c]) ** 2
    along -= a[c] * (b[c] - a[c])
  }
  const lambda = chord > 0 ? saturate(along / chord) : 0
  let near = 0
  for (let c = 0; c < 4; c++) near += (a[c] + lambda * (b[c] - a[c])) ** 2
  const least = Math.sqrt(near) - (bend * span * span) / 8
  return least > 0 && Math.hypot(...a) > 0 && Math.hypot(...b) > 0 ? speed / least : Infinity
}
