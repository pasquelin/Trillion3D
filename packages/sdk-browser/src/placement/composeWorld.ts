/**
 * THE ONE CPU PRODUCT OF A PARENT'S WORLD AND A LOCAL MATRIX: `parent · local`, in double precision
 * and in the order the transform tree composes it (`multiplyMatrix4`), which the GPU's composition
 * reproduces word for word (`gpuComposeWgsl.ts`, proven by `gpuComposeWgsl.test.ts`). Every CPU
 * reader that needs a composed world — a root read through its parent, the rows a reader holds,
 * the pose a session opens on, a parent in the frame of its model — takes it here.
 */
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'

/** `parent · local`, written into `out` and returned. */
export function composeWorld(
  out: Float64Array,
  parent: ArrayLike<number>,
  local: ArrayLike<number>,
) {
  return multiplyMatrix4(out, parent as Float64Array, local as Float64Array)
}
