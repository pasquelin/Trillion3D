import { boxTransform, boxUnionBatch } from '../../../sdk-core/src/index.ts';
import { readHostBox } from '../host/boxBounds.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { noteDeformedBounds } from '../webgpu/pages/render/movedBatch.ts';

const local = new Float64Array(6),
  before = new Float64Array(6);
/** Whole-copy bounds use the same measured reach as clustered placements and dirty only their region. */
export function updateWholeDeformationBounds(rt: WebgpuPagesRuntime) {
  const deformation = rt.vis.deformation;
  if (!deformation) return;
  for (const item of rt.blendState.blendGpu) {
    const box = item.deformBounds,
      source = item.sourceGeometry.boundingBox;
    if (!box || !source || !deformation.changedOfWorld(item.matrix)) continue;
    before.set(box);
    readHostBox(local, source);
    const reach = deformation.reachOfWorld(item.matrix);
    for (let c = 0; c < 3; c++) {
      local[c] -= reach;
      local[c + 3] += reach;
    }
    boxTransform(box, 0, local, 0, item.matrix.elements);
    item.bounds = box;
    boxUnionBatch(before, box, 1);
    noteDeformedBounds(rt, before);
  }
}
