import { invertMatrix4 } from '../../../../../../math/src/matrix/matrix4Inverse.ts'
import { negateRowMatrix4 } from '../../../../../../math/src/matrix/matrix4.ts'
import { matrixAtRenderOrigin } from '../../../../../../math/src/projection/renderOrigin.ts'

/** The scratch of `vsmViewToShifted`. */
const shiftedToView = new Float64Array(16)
const origin = new Float64Array(3)
const inverse = new Float64Array(16)

/**
 * The matrix that takes the points of a view looking down +z to the shifted space the marking works
 * in (the world less the eye, `originShift`): the inverse of the shifted-to-view the projection
 * writes (`projection/projectionViewWrite.ts`), the view at the render origin `-originShift` with its
 * z row negated. Written into `out`, column-major.
 */
export function vsmViewToShifted(
  out: Float32Array,
  view: ArrayLike<number>,
  originShift: ArrayLike<number>,
) {
  for (let k = 0; k < 3; k++) origin[k] = -originShift[k]!
  matrixAtRenderOrigin(shiftedToView, view, origin)
  negateRowMatrix4(shiftedToView, shiftedToView, 2)
  invertMatrix4(inverse, shiftedToView)
  for (let k = 0; k < 16; k++) out[k] = inverse[k]!
  return out
}
