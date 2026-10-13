// Pure A9 oracle, no side effects: `pages-webgpu.perf.ts` measures it; unit tests import it as
// reference.
import { matrixWindingCw } from '../../../packages/math/src/matrix/orientation.ts'

/** `packages/sdk-browser/src/webgpu/pages/prepare/pipelineFor.ts:22-30`: one 3×3 determinant per call. */
export const referenceWindingCw = (rec: { matrix: { elements: ArrayLike<number> } }) =>
  matrixWindingCw(rec.matrix.elements)
