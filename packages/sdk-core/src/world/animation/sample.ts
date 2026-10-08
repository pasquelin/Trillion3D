import {
  conjugateQuaternion,
  multiplyQuaternion,
  normalizeQuaternion,
  slerpArc,
  slerpOnArc,
} from '../../../../math/src/quaternion/quaternion.ts'
import type { Track, TrackBinding } from './clip.ts'
import { hermiteBasis } from '../../../../math/src/scalar/hermite.ts'
import { mix, saturate } from '../../../../math/src/scalar/reals.ts'

const basis = new Float64Array(4)

/** The track's value at `t`, from the last key reached: between two keys by its interpolation —
 *  a straight line (quaternions on the arc), the earlier key held (`step`), or glTF's cubic
 *  spline, whose keys carry an in-tangent, the value and an out-tangent. */
export function sample(tr: Track, t: number, bound: TrackBinding) {
  const { times, values } = tr,
    out = bound.value,
    size = out.length,
    cubic = tr.interpolation === 'cubic',
    stride = cubic ? size * 3 : size,
    at = cubic ? size : 0
  let i = bound.key > 0 && times[bound.key] < t ? bound.key : 0
  while (i < times.length - 1 && times[i + 1] <= t) i++
  bound.key = i
  const j = Math.min(i + 1, times.length - 1)
  const span = times[j] - times[i],
    w = span > 0 ? saturate((t - times[i]) / span) : 0
  if (tr.interpolation === 'step' || w === 0) {
    for (let c = 0; c < size; c++) out[c] = values[i * stride + at + c]
  } else if (cubic) {
    hermiteBasis(basis, w)
    const a = basis[0],
      b = basis[1],
      c1 = basis[2],
      d = basis[3]
    for (let c = 0; c < size; c++)
      out[c] =
        a * values[i * stride + size + c] +
        b * span * values[i * stride + 2 * size + c] +
        c1 * values[j * stride + size + c] +
        d * span * values[j * stride + c]
  } else if (tr.kind === 'quaternion') {
    // The arc between two keys is the same at every sample between them: found once a segment.
    const arc = (bound.arc ??= new Float64Array(3))
    if (bound.arcKey !== i) slerpArc(arc, 0, values, i * size, values, j * size)
    bound.arcKey = i
    slerpOnArc(out, 0, values, i * size, values, j * size, w, arc, 0)
  } else {
    for (let c = 0; c < size; c++) out[c] = mix(values[i * size + c], values[j * size + c], w)
  }
  // Once, whatever the branch: the slerp's line too.
  if (tr.kind === 'quaternion') normalizeQuaternion(out)
  return out
}

/** An additive action's difference from its clip's reference pose `reference`: a vector's
 *  difference, a rotation's turn from it, `reference⁻¹ · value`. */
export function difference(tr: Track, value: Float64Array, reference: Float64Array) {
  if (tr.kind !== 'quaternion') {
    for (let c = 0; c < value.length; c++) value[c] -= reference[c]
    return value
  }
  return multiplyQuaternion(value, conjugateQuaternion(inverted, reference), value)
}
const inverted = new Float64Array(4)
