import { length3 } from '../../vector/vector.ts'

/**
 * Planes of a viewing frustum, stored flat: twenty-four floats, four per plane `a, b, c, d`,
 * facing inward — a point is inside when `a*x + b*y + c*z + d >= 0` for all six.
 *
 * Each plane is one bound of clip space. With `(x, y, z, w)` the clip coordinates of a point, it
 * is visible where `-w <= x <= w` and `-w <= y <= w`, and, engine depth being REVERSED in `[0, 1]`
 * (`../../projection/camera.ts`: near plane at 1, far plane at 0), where `0 <= z <= w`. A bound moved
 * to one side is a row of the column-major matrix `m`, or a sum or difference of two rows, dotted
 * with the point: the `x` row is `(m0, m4, m8, m12)`, the `w` row `(m3, m7, m11, m15)`. Slots, in
 * floats: 0 `x <= w`, 4 `-w <= x`, 8 `-w <= y`, 12 `y <= w`, 16 the FAR plane `z >= 0`, 20 the
 * NEAR plane `z <= w`. Readers address a plane by its slot: the FAR plane is rewritten at 16.
 *
 * Infinite far plane: projection's `z` row is then `(0, 0, 0, near)`, so the FAR plane has a zero
 * normal and, normalized, non-numeric components — no comparison satisfies it, so it rejects
 * nothing, which is exactly what an infinite far plane means. `frustumFarPlane` replaces it with
 * the far plane declared by the host when present.
 */

/** Float count for the six planes of a frustum. */
export const FRUSTUM_PLANE_VALUES = 24

/** Stores the plane `a, b, c, d` at `at`, scaled to a unit normal: one division by the normal's
 *  length, then four products. Everything is computed in double precision before the store, so a
 *  single-precision output rounds only once. The components travel as arguments, not through a
 *  module buffer: measured twice as fast, the compiler inlines the call and none are wrapped. */
function storeUnitPlane(
  out: Float32Array | Float64Array,
  at: number,
  a: number,
  b: number,
  c: number,
  d: number,
) {
  const reciprocal = 1 / length3(a, b, c)
  out[at] = a * reciprocal
  out[at + 1] = b * reciprocal
  out[at + 2] = c * reciprocal
  out[at + 3] = d * reciprocal
}

/**
 * The six normalized planes of the frustum of a clip matrix — a view-projection, or a
 * projection alone for planes in view space. Unit normals: `a*x + b*y + c*z + d` is
 * a signed distance. A degenerate matrix yields NaN or infinite planes without throwing.
 */
export function frustumPlanesFromMatrix(out: Float32Array | Float64Array, m: ArrayLike<number>) {
  // The rows of `m` that give clip x, y, z and w; the digit is the column: `m[4 · column + row]`.
  // The sixteen are all read before the first store, so `out` may share memory with `m`.
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
  storeUnitPlane(out, 0, w0 - x0, w1 - x1, w2 - x2, w3 - x3) // x <= w
  storeUnitPlane(out, 4, w0 + x0, w1 + x1, w2 + x2, w3 + x3) // -w <= x
  storeUnitPlane(out, 8, w0 + y0, w1 + y1, w2 + y2, w3 + y3) // -w <= y
  storeUnitPlane(out, 12, w0 - y0, w1 - y1, w2 - y2, w3 - y3) // y <= w
  // z >= 0, FAR. Under an infinite far plane the z row is (0, 0, 0, near): the reciprocal is
  // 1 / 0 = ∞ and the plane 0 · ∞ = NaN and near · ∞, a plane no point fails.
  storeUnitPlane(out, 16, z0, z1, z2, z3)
  storeUnitPlane(out, 20, w0 - z0, w1 - z1, w2 - z2, w3 - z3) // z <= w, NEAR
}

/**
 * The same six planes without normalization: the raw sums and differences of the rows of `m`. The
 * sign of `a*x + b*y + c*z + d` alone decides, without square root or division — this is the form of
 * the exact clip test, where normalizing would shift rounding.
 */
export function clipPlanesFromMatrix(out: Float64Array, m: ArrayLike<number>) {
  // The rows of `m`, as `frustumPlanesFromMatrix` reads them, all before the first store: a shared
  // reader would hand them back through memory, not registers. The six bounds below are its
  // planes stored raw: a store shared with it, passed in or flagged, measured 77 % slower.
  // jscpd:ignore-start
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
  // jscpd:ignore-end
  out[0] = w0 - x0 // x <= w
  out[1] = w1 - x1
  out[2] = w2 - x2
  out[3] = w3 - x3
  out[4] = w0 + x0 // -w <= x
  out[5] = w1 + x1
  out[6] = w2 + x2
  out[7] = w3 + x3
  out[8] = w0 + y0 // -w <= y
  out[9] = w1 + y1
  out[10] = w2 + y2
  out[11] = w3 + y3
  out[12] = w0 - y0 // y <= w
  out[13] = w1 - y1
  out[14] = w2 - y2
  out[15] = w3 - y3
  out[16] = z0 // z >= 0, FAR
  out[17] = z1
  out[18] = z2
  out[19] = z3
  out[20] = w0 - z0 // z <= w, NEAR
  out[21] = w1 - z1
  out[22] = w2 - z2
  out[23] = w3 - z3
}

/**
 * The FAR plane of a frustum whose projection does not have one, written into `out` at `at`.
 *
 * Engine projection has an INFINITE far plane: its depth row bounds nothing and the
 * clip bounds give a zero plane, which rejects nothing. The frustum, however, keeps the far plane
 * DECLARED by the host — otherwise a scene would suddenly gain all objects that the camera was not
 * showing. That plane is not read from the clip matrix but from the VIEW matrix, whose third row
 * gives view depth `z`: a point is inside when `far + z >= 0`. A non-finite `far` leaves the zero
 * plane in place, meaning a truly unbounded far plane.
 */
export function frustumFarPlane(
  out: Float32Array | Float64Array,
  at: number,
  view: ArrayLike<number>,
  far: number,
  normalize: boolean,
) {
  if (!Number.isFinite(far)) return
  // The four read before the first store, so `out` may share memory with `view`.
  const a = view[2],
    b = view[6],
    c = view[10],
    d = view[14] + far
  if (normalize) {
    storeUnitPlane(out, at, a, b, c, d)
    return
  }
  out[at] = a
  out[at + 1] = b
  out[at + 2] = c
  out[at + 3] = d
}

/** The signed distance of `(x, y, z)` to the plane `a, b, c, d` stored at `p[at]` — a distance
 *  for a unit normal, a scaled one otherwise: `a*x + b*y + c*z + d`, summed left to right. */
function planeDistance(p: ArrayLike<number>, at: number, x: number, y: number, z: number) {
  return p[at] * x + p[at + 1] * y + p[at + 2] * z + p[at + 3]
}

/** True when `(x, y, z)` is on the inner side of all six `planes`, each `planeDistance`, the planes
 *  in their slot order at constant offsets; a NaN, comparing false, keeps the point. */
export function frustumContainsPoint(planes: ArrayLike<number>, x: number, y: number, z: number) {
  return !(
    planeDistance(planes, 0, x, y, z) < 0 ||
    planeDistance(planes, 4, x, y, z) < 0 ||
    planeDistance(planes, 8, x, y, z) < 0 ||
    planeDistance(planes, 12, x, y, z) < 0 ||
    planeDistance(planes, 16, x, y, z) < 0 ||
    planeDistance(planes, 20, x, y, z) < 0
  )
}

/** True when the sphere of centre `(x, y, z)` and radius `reach` lies wholly behind one of the six
 *  unit `planes`: some `planeDistance` below `−reach`, the planes in their slot order at constant
 *  offsets. A NaN, comparing false, keeps the sphere. */
export function frustumExcludesSphere(
  planes: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  reach: number,
) {
  const behind = -reach
  return (
    planeDistance(planes, 0, x, y, z) < behind ||
    planeDistance(planes, 4, x, y, z) < behind ||
    planeDistance(planes, 8, x, y, z) < behind ||
    planeDistance(planes, 12, x, y, z) < behind ||
    planeDistance(planes, 16, x, y, z) < behind ||
    planeDistance(planes, 20, x, y, z) < behind
  )
}
