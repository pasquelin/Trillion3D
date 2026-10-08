// The frustum's plane builders and tests before their rewrites, their code word for word but their
// names: the oracles `frustumMoves.test.ts` holds the shipped ones to.
import { length3 } from '../../vector/vector.ts'

function planeDistance(p: ArrayLike<number>, at: number, x: number, y: number, z: number) {
  return p[at] * x + p[at + 1] * y + p[at + 2] * z + p[at + 3]
}

export function frustumContainsPointBefore(
  planes: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
) {
  for (let i = 0; i < 24; i += 4) if (planeDistance(planes, i, x, y, z) < 0) return false
  return true
}

export function frustumExcludesSphereBefore(
  planes: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  reach: number,
) {
  for (let i = 0; i < 24; i += 4) if (planeDistance(planes, i, x, y, z) < -reach) return true
  return false
}

function storePlane(
  out: Float32Array | Float64Array,
  at: number,
  a: number,
  b: number,
  c: number,
  d: number,
  unit: boolean,
) {
  if (unit) {
    const reciprocal = 1 / length3(a, b, c)
    a *= reciprocal
    b *= reciprocal
    c *= reciprocal
    d *= reciprocal
  }
  out[at] = a
  out[at + 1] = b
  out[at + 2] = c
  out[at + 3] = d
}

function storeClipBounds(out: Float32Array | Float64Array, m: ArrayLike<number>, unit: boolean) {
  const x0 = m[0],
    x1 = m[4],
    x2 = m[8],
    x3 = m[12]
  const y0 = m[1],
    y1 = m[5],
    y2 = m[9],
    y3 = m[13]
  const z0 = m[2],
    z1 = m[6],
    z2 = m[10],
    z3 = m[14]
  const w0 = m[3],
    w1 = m[7],
    w2 = m[11],
    w3 = m[15]
  storePlane(out, 0, w0 - x0, w1 - x1, w2 - x2, w3 - x3, unit) // x <= w
  storePlane(out, 4, w0 + x0, w1 + x1, w2 + x2, w3 + x3, unit) // -w <= x
  storePlane(out, 8, w0 + y0, w1 + y1, w2 + y2, w3 + y3, unit) // -w <= y
  storePlane(out, 12, w0 - y0, w1 - y1, w2 - y2, w3 - y3, unit) // y <= w
  storePlane(out, 16, z0, z1, z2, z3, unit) // z >= 0, FAR
  storePlane(out, 20, w0 - z0, w1 - z1, w2 - z2, w3 - z3, unit) // z <= w, NEAR
}

export function frustumPlanesFromMatrixBefore(
  out: Float32Array | Float64Array,
  m: ArrayLike<number>,
) {
  storeClipBounds(out, m, true)
}

export function clipPlanesFromMatrixBefore(out: Float64Array, m: ArrayLike<number>) {
  storeClipBounds(out, m, false)
}

export function frustumFarPlaneBefore(
  out: Float32Array | Float64Array,
  at: number,
  view: ArrayLike<number>,
  far: number,
  normalize: boolean,
) {
  if (!Number.isFinite(far)) return
  storePlane(out, at, view[2], view[6], view[10], view[14] + far, normalize)
}
