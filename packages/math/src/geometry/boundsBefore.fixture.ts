// The box and sphere bodies before their rewrites, word for word but their names: the oracles
// `boundsMoves.test.ts` holds the shipped ones to — `boxGrow` before its six constant stores,
// `boxFromPoints` before its bounds in locals, `boxTransform` before it
// skipped the divide by a `w` of exactly 1, `spheresOverlap` before its squared distance in place.
import { boxEmpty, boxExpandByPoint } from './box.ts'
import { distanceSqVector3 } from '../vector/vector.ts'

export function boxFromPointsBefore(
  out: Float64Array,
  o: number,
  points: ArrayLike<number>,
  at: number,
  count: number,
  stride = 3,
) {
  boxEmpty(out, o)
  for (let i = 0, p = at; i < count; i++, p += stride)
    boxExpandByPoint(out, o, points[p], points[p + 1], points[p + 2])
}

export function boxGrowBefore(
  out: Float64Array,
  o: number,
  box: ArrayLike<number>,
  bo: number,
  g: number,
) {
  for (let c = 0; c < 3; c++) {
    out[o + c] = box[bo + c] - g
    out[o + c + 3] = box[bo + c + 3] + g
  }
}

export function boxTransformBefore(
  out: Float64Array,
  o: number,
  box: ArrayLike<number>,
  bo: number,
  m: ArrayLike<number>,
) {
  const minX = box[bo],
    minY = box[bo + 1],
    minZ = box[bo + 2],
    maxX = box[bo + 3],
    maxY = box[bo + 4],
    maxZ = box[bo + 5]
  if (maxX < minX || maxY < minY || maxZ < minZ) {
    out[o] = minX
    out[o + 1] = minY
    out[o + 2] = minZ
    out[o + 3] = maxX
    out[o + 4] = maxY
    out[o + 5] = maxZ
    return
  }
  const m0 = m[0],
    m1 = m[1],
    m2 = m[2],
    m3 = m[3],
    m4 = m[4],
    m5 = m[5],
    m6 = m[6],
    m7 = m[7],
    m8 = m[8],
    m9 = m[9],
    m10 = m[10],
    m11 = m[11],
    m12 = m[12],
    m13 = m[13],
    m14 = m[14],
    m15 = m[15]
  let loX = Infinity,
    loY = Infinity,
    loZ = Infinity,
    hiX = -Infinity,
    hiY = -Infinity,
    hiZ = -Infinity
  for (let i = 0; i < 8; i++) {
    const lx = i & 1 ? maxX : minX,
      ly = i & 2 ? maxY : minY,
      lz = i & 4 ? maxZ : minZ
    const mw = 1 / (m3 * lx + m7 * ly + m11 * lz + m15)
    const x = (m0 * lx + m4 * ly + m8 * lz + m12) * mw,
      y = (m1 * lx + m5 * ly + m9 * lz + m13) * mw,
      z = (m2 * lx + m6 * ly + m10 * lz + m14) * mw
    loX = Math.min(loX, x)
    loY = Math.min(loY, y)
    loZ = Math.min(loZ, z)
    hiX = Math.max(hiX, x)
    hiY = Math.max(hiY, y)
    hiZ = Math.max(hiZ, z)
  }
  out[o] = loX
  out[o + 1] = loY
  out[o + 2] = loZ
  out[o + 3] = hiX
  out[o + 4] = hiY
  out[o + 5] = hiZ
}

export function spheresOverlapBefore(
  a: ArrayLike<number>,
  ar: number,
  b: ArrayLike<number>,
  br: number,
  aAt = 0,
  bAt = 0,
) {
  const s = ar + br
  return distanceSqVector3(a, b, aAt, bAt) <= s * s
}
