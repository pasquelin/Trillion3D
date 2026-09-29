import { boxTransform, boxUnionBatch } from '../../../sdk-core/src/index.ts';
import { readHostBox } from '../host/boxBounds.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { SessionDeformation } from './session.ts';
import { noteDeformedBounds } from '../webgpu/pages/render/movedBatch.ts';
import { refitBlendHierarchy } from '../webgpu/blend/hierarchy.ts';

const local = new Float64Array(6),
  before = new Float64Array(6);
/**
 * Whole-copy bounds use the same measured reach as clustered placements and dirty only their
 * region. A record that did not change can still be carried by its node (`worldsMoved`): a skin
 * palette, morph weights and soft sources are read in the mesh's own frame, so the box follows the
 * matrix too. The transparent tree is refit to the boxes rewritten.
 */
export function updateWholeDeformationBounds(
  rt: WebgpuPagesRuntime,
  deformation: SessionDeformation,
  worldsMoved = false,
) {
  let rewritten = false;
  for (const item of rt.blendState.blendGpu) {
    const box = item.deformBounds,
      source = item.sourceGeometry.boundingBox;
    if (!box || !source || !(worldsMoved || deformation.changedOfWorld(item.matrix))) continue;
    rewritten = true;
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
  if (rewritten) refitBlendHierarchy(rt.blendState);
}
