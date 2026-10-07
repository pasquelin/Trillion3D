// One segment of a track between two keys, as `sample` draws it: the most its value moves per
// second, which bounds how far a pose kept since lags the true one (`trackMotion.ts`).
import type { Track } from './clip.ts'
import { lengthQuaternion, slerpArc } from '../../../../math/src/quaternion/quaternion.ts'
import { saturate } from '../../../../math/src/scalar/reals.ts'

/** What `segmentSpeed` gives a segment at whose end the value itself leaps. */
export const LEAPS = -1

/**
 * The most `|c'|` on segment `i` of `tr`, from key `i` to `i + 1`, `span` seconds long, `c` its
 * value read as a point of ℝⁿ — a rotation as the unit quaternion `sample` writes, on the sphere
 * of ℝ⁴; `LEAPS` when the value leaps at its end (a step that changes, two keys at one time).
 */
export function segmentSpeed(tr: Track, i: number, span: number, width: number) {
  const { values } = tr,
    stride = tr.interpolation === 'cubic' ? width * 3 : width,
    at = tr.interpolation === 'cubic' ? width : 0
  if (tr.interpolation === 'step' || span <= 0) {
    for (let c = 0; c < width; c++)
      if (values[i * stride + at + c] !== values[(i + 1) * stride + at + c]) return LEAPS
    return 0
  }
  if (tr.interpolation === 'cubic') {
    const { bend, speed } = cubicLine(values, i, span, width)
    if (tr.kind !== 'quaternion') return speed
    for (let c = 0; c < 4; c++) [from[c], to[c]] = [values[i * 12 + 4 + c], values[i * 12 + 16 + c]]
    return normalised(from, to, span, bend, speed)
  }
  if (tr.kind === 'quaternion') return arcSpeed(values, i, span)
  let squares = 0
  for (let c = 0; c < width; c++) {
    const rise = (values[(i + 1) * width + c] - values[i * width + c]) / span
    squares += rise * rise
  }
  return Math.sqrt(squares)
}

/** The slerp from key `i` to `i + 1`, as `slerpArc` takes it (the shorter way round). Between unit
 *  keys, a great circle at angular speed `ω = φ / span`: `|c'| = ω`. Between keys of other
 *  lengths, `p = (sin((1 − w)φ) a + sin(wφ) b) / sin φ` is normalised after (`normalised`):
 *  `|p''| = ω² |p| ≤ ω² R`, `R = max(|a|, |b|) / cos(φ/2)`, and
 *  `|p'| ≤ ω |b − a| / sin φ + ω φ max(|a|, |b|)`; nearly one key, the line from `a` to `b`. */
function arcSpeed(values: ArrayLike<number>, i: number, span: number) {
  for (let c = 0; c < 4; c++) [from[c], to[c]] = [values[i * 4 + c], values[i * 4 + 4 + c]]
  const lengthA = lengthQuaternion(from),
    lengthB = lengthQuaternion(to)
  slerpArc(arc, 0, from, 0, to, 0)
  const sign = arc[0],
    angle = arc[1],
    sin = arc[2],
    omega = angle / span
  if (Math.abs(lengthA - 1) < 1e-6 && Math.abs(lengthB - 1) < 1e-6 && sin >= 1e-6) return omega
  let chord = 0
  for (let c = 0; c < 4; c++) chord += (sign * to[c] - from[c]) ** 2
  for (let c = 0; c < 4; c++) to[c] *= sign
  if (sin < 1e-6) return normalised(from, to, span, 0, Math.sqrt(chord) / span)
  const longest = Math.max(lengthA, lengthB)
  return normalised(
    from,
    to,
    span,
    (omega * omega * longest) / Math.cos(angle / 2),
    (omega * Math.sqrt(chord)) / sin + omega * angle * longest,
  )
}
const from = new Float64Array(4),
  to = new Float64Array(4),
  arc = new Float64Array(3)

/** glTF's cubic spline from key `i` (value `p₀`, out-tangent `m₀`) to `i + 1` (`p₁`, in-tangent
 *  `m₁`): `c''` is linear in `t`, largest at an end (`bend`); `c'` is the quadratic Bézier of `m₀`,
 *  `3(p₁ − p₀)/span − m₀ − m₁` and `m₁`, within their largest length (`speed`). */
function cubicLine(v: ArrayLike<number>, i: number, span: number, width: number) {
  const s = width * 3,
    p0 = i * s + width,
    m0 = i * s + 2 * width,
    m1 = (i + 1) * s,
    p1 = (i + 1) * s + width
  let start = 0,
    end = 0,
    middle = 0,
    m0Length = 0,
    m1Length = 0
  for (let c = 0; c < width; c++) {
    const rise = v[p1 + c] - v[p0 + c]
    start += ((6 * rise - 4 * span * v[m0 + c] - 2 * span * v[m1 + c]) / span ** 2) ** 2
    end += ((-6 * rise + 2 * span * v[m0 + c] + 4 * span * v[m1 + c]) / span ** 2) ** 2
    middle += ((3 * rise) / span - v[m0 + c] - v[m1 + c]) ** 2
    m0Length += v[m0 + c] ** 2
    m1Length += v[m1 + c] ** 2
  }
  return {
    bend: Math.sqrt(Math.max(start, end)),
    speed: Math.sqrt(Math.max(middle, m0Length, m1Length)),
  }
}

/**
 * The top speed of a curve `p` from `a` to `b` drawn normalised, `q = p / |p|`, from `p`'s bounds
 * `|p''| ≤ bend` and `|p'| ≤ speed`: `|q'| ≤ |p'| / |p|`, and `|p| ≥ m`, the chord's distance from
 * the origin less the most `p` leaves its chord, `bend · span² / 8`. Unbounded when `m` reaches 0.
 */
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
  return least > 0 && lengthQuaternion(a) > 0 && lengthQuaternion(b) > 0 ? speed / least : Infinity
}
