/**
 * Planes of a viewing frustum, stored flat: twenty-four floats, four per plane `a, b, c, d`,
 * facing inward — a point is inside when `a*x + b*y + c*z + d >= 0` for all six.
 *
 * Each plane is one bound of clip space. With `(x, y, z, w)` the clip coordinates of a point, it
 * is visible where `-w <= x <= w` and `-w <= y <= w`, and, engine depth being REVERSED in `[0, 1]`
 * (`../primitives/camera.ts`: near plane at 1, far plane at 0), where `0 <= z <= w`. A bound moved
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

/** Stores one plane at `at`, scaled to a unit normal when `unit` is set: one division by the
 *  normal's length, then four products. Everything is computed in double precision before the
 *  store, so a single-precision output rounds only once. The components travel as arguments, not
 *  through a module buffer: measured twice as fast, the compiler inlines the call and none are
 *  wrapped. */
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
    const reciprocal = 1 / Math.sqrt(a * a + b * b + c * c)
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
  // The rows of `m` that give clip x, y, z and w; the digit is the column: `m[4 · column + row]`.
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

/**
 * The six normalized planes of the frustum of a clip matrix — a view-projection, or a
 * projection alone for planes in view space. Unit normals: `a*x + b*y + c*z + d` is
 * a signed distance. A degenerate matrix yields NaN or infinite planes without throwing.
 */
export function frustumPlanesFromMatrix(out: Float32Array | Float64Array, m: ArrayLike<number>) {
  storeClipBounds(out, m, true)
}

/**
 * The same six planes without normalization: the raw sums and differences of the rows of `m`. The
 * sign of `a*x + b*y + c*z + d` alone decides, without square root or division — this is the form of
 * the exact clip test, where normalizing would shift rounding.
 */
export function clipPlanesFromMatrix(out: Float64Array, m: ArrayLike<number>) {
  storeClipBounds(out, m, false)
}

/**
 * The FAR plane of a frustum whose projection does not have one, written into `out` at `at`.
 *
 * Engine projection has an INFINITE far plane: its depth row no longer bounds anything and the
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
  storePlane(out, at, view[2], view[6], view[10], view[14] + far, normalize)
}
