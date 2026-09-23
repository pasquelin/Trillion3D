// Pure A9 oracle, no side effects: `pages.bench.ts` measures it; unit tests import it as
// reference.
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts';

/** `packages/sdk-browser/src/webgpu/pages/prepare/pipelineFor.ts:22-30` before batch A: one 3×3 determinant per call. */
export function referenceWindingCw(rec: PageRec) {
  const e = rec.matrix.elements;
  return (
    e[0] * (e[5] * e[10] - e[6] * e[9]) -
      e[1] * (e[4] * e[10] - e[6] * e[8]) +
      e[2] * (e[4] * e[9] - e[5] * e[8]) <
    0
  );
}
