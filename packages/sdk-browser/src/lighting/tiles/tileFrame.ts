import { invertMatrix4, matrixAtRenderOrigin } from '../../../../sdk-core/src/index.ts';

const atOrigin = new Float64Array(16);
/**
 * The tile pass's frame (`sdk-core` `renderOrigin.ts`): `origin` the eye rounded to f32, the words
 * the shader subtracts from a light's centre, and `out` the f64 inverse of `viewProjection ·
 * T(origin)` — the jittered render matrix, not the camera's `viewProjectionRelative`. `rows`, when
 * given, receives that matrix's depth row then its w row: what gives a point of the frame its depth
 * (`depthAt` and `lightRun`, `./boundsWgsl.ts`).
 */
export function tileViewInverse(
  out: Float64Array,
  origin: Float64Array,
  viewProjection: ArrayLike<number>,
  eye: ArrayLike<number>,
  rows?: Float64Array,
) {
  for (let axis = 0; axis < 3; axis++) origin[axis] = Math.fround(eye[axis]);
  matrixAtRenderOrigin(atOrigin, viewProjection, origin);
  // Column-major: row `r` is every fourth word from `r`.
  if (rows) for (let i = 0; i < 8; i++) rows[i] = atOrigin[(i >> 2) + 2 + (i & 3) * 4];
  return invertMatrix4(out, atOrigin);
}
