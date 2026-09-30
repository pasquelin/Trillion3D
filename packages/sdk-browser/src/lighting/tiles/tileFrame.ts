import { invertMatrix4, matrixAtRenderOrigin } from '../../../../sdk-core/src/index.ts';

const atOrigin = new Float64Array(16);
/**
 * The tile pass's frame (`sdk-core` `renderOrigin.ts`): `origin` the eye rounded to f32, the words
 * the shader subtracts from a light's centre, and `out` the f64 inverse of `viewProjection ·
 * T(origin)` — the jittered render matrix, not the camera's `viewProjectionRelative`.
 */
export function tileViewInverse(
  out: Float64Array,
  origin: Float64Array,
  viewProjection: ArrayLike<number>,
  eye: ArrayLike<number>,
) {
  for (let axis = 0; axis < 3; axis++) origin[axis] = Math.fround(eye[axis]);
  return invertMatrix4(out, matrixAtRenderOrigin(atOrigin, viewProjection, origin));
}
