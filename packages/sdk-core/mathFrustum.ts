/**
 * Planes of a viewing frustum, stored flat: twenty-four floats, four per plane `a, b, c, d`,
 * facing inward — a point is inside when `a*x + b*y + c*z + d >= 0` for all six.
 *
 * Plane order matches the reference: right (`w - x`), left (`w + x`), bottom (`w + y`), top
 * (`w - y`), far, near. Engine depth is REVERSED in `[0, 1]` — near plane at 1,
 * far plane at 0 (`mathCamera.ts`) — so the FAR plane is `z >= 0` and the NEAR plane is `w - z >= 0`,
 * the exact inverse of their roles in standard depth. The combined rows are those of the
 * column-major matrix `m`: `x = (m0, m4, m8, m12)`, `w = (m3, m7, m11, m15)`.
 *
 * Infinite far plane: the `z` row of projection is `(0, 0, 0, near)`, so the FAR plane
 * ends up with a zero normal and, normalized, non-numeric components — no comparison
 * satisfies it, so it rejects nothing, which is exactly what an infinite far plane means.
 * `frustumFarPlane` replaces it with the far plane declared by the host when present.
 */

/** Float count for the six planes of a frustum. */
export const FRUSTUM_PLANE_VALUES = 24;

/** Writes a plane, normalized if required: the four components multiplied by `1 / ‖(a, b, c)‖`.
 *  Everything is computed in double precision before writing, so single precision output rounds
 *  only once. Components are passed as arguments rather than via a module buffer: measured
 *  twice as fast, the compiler inlines the call and none are wrapped. */
function writePlane(
  out: Float32Array | Float64Array,
  at: number,
  a: number,
  b: number,
  c: number,
  d: number,
  normalize: boolean,
) {
  if (normalize) {
    const inverse = 1.0 / Math.sqrt(a * a + b * b + c * c);
    a *= inverse;
    b *= inverse;
    c *= inverse;
    d *= inverse;
  }
  out[at] = a;
  out[at + 1] = b;
  out[at + 2] = c;
  out[at + 3] = d;
}

function writePlanes(out: Float32Array | Float64Array, m: ArrayLike<number>, normalize: boolean) {
  const m0 = m[0],
    m1 = m[1],
    m2 = m[2],
    m3 = m[3];
  const m4 = m[4],
    m5 = m[5],
    m6 = m[6],
    m7 = m[7];
  const m8 = m[8],
    m9 = m[9],
    m10 = m[10],
    m11 = m[11];
  const m12 = m[12],
    m13 = m[13],
    m14 = m[14],
    m15 = m[15];
  writePlane(out, 0, m3 - m0, m7 - m4, m11 - m8, m15 - m12, normalize);
  writePlane(out, 4, m3 + m0, m7 + m4, m11 + m8, m15 + m12, normalize);
  writePlane(out, 8, m3 + m1, m7 + m5, m11 + m9, m15 + m13, normalize);
  writePlane(out, 12, m3 - m1, m7 - m5, m11 - m9, m15 - m13, normalize);
  writePlane(out, 16, m2, m6, m10, m14, normalize);
  writePlane(out, 20, m3 - m2, m7 - m6, m11 - m10, m15 - m14, normalize);
}

/**
 * The six normalized planes of the frustum of a clip matrix — a view-projection, or a
 * projection alone for planes in view space. Unit normals: `a*x + b*y + c*z + d` is
 * a signed distance. A degenerate matrix yields NaN or infinite planes without throwing.
 */
export function frustumPlanesFromMatrix(out: Float32Array | Float64Array, m: ArrayLike<number>) {
  writePlanes(out, m, true);
}

/**
 * The same six planes without normalization: the raw sums and differences of the rows of `m`. The
 * sign of `a*x + b*y + c*z + d` alone decides, without square root or division — this is the form of
 * the exact clip test, where normalizing would shift rounding.
 */
export function clipPlanesFromMatrix(out: Float64Array, m: ArrayLike<number>) {
  writePlanes(out, m, false);
}

/**
 * The FAR plane of a frustum whose projection does not have one, written into `out` at `at`.
 *
 * Engine projection has an INFINITE far plane: its depth row no longer bounds anything and
 * `writePlanes` extracts a zero plane from it, which rejects nothing. The frustum, however, keeps the far plane
 * DECLARED by the host — otherwise a scene would suddenly gain all objects that the camera was not showing.
 * That plane is not read from the clip matrix but from the VIEW matrix, whose third row
 * gives view depth `z`: a point is inside when `far + z >= 0`. A non-finite `far` leaves
 * the zero plane in place, meaning a truly unbounded far plane.
 */
export function frustumFarPlane(
  out: Float32Array | Float64Array,
  at: number,
  view: ArrayLike<number>,
  far: number,
  normalize: boolean,
) {
  if (!Number.isFinite(far)) return;
  writePlane(out, at, view[2], view[6], view[10], view[14] + far, normalize);
}

/**
 * Transforms planes back into the local space of a transformation `m` (4x4 column-major): each plane
 * `p` becomes `p · m`, so a local point `q` yields `p · (m q)`. A local box can then be
 * tested without being transformed.
 */
export function frustumPlanesToLocal(
  out: Float64Array,
  planes: ArrayLike<number>,
  m: ArrayLike<number>,
) {
  for (let i = 0; i < 6; i++) {
    const a = planes[i * 4],
      b = planes[i * 4 + 1],
      c = planes[i * 4 + 2],
      d = planes[i * 4 + 3];
    out[i * 4] = m[0] * a + m[1] * b + m[2] * c + m[3] * d;
    out[i * 4 + 1] = m[4] * a + m[5] * b + m[6] * c + m[7] * d;
    out[i * 4 + 2] = m[8] * a + m[9] * b + m[10] * c + m[11] * d;
    out[i * 4 + 3] = m[12] * a + m[13] * b + m[14] * c + m[15] * d;
  }
}
