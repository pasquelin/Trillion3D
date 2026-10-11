// Pure A9 oracle, no side effects: `pages-webgpu.perf.ts` measures it; unit tests import it as
// reference.
import { referenceWindingCw as windingOf } from './core-math.ts'

/** `packages/sdk-browser/src/webgpu/pages/prepare/pipelineFor.ts:22-30`: one 3×3 determinant per call. */
export const referenceWindingCw = (rec: { matrix: { elements: ArrayLike<number> } }) =>
  windingOf(rec.matrix.elements)
