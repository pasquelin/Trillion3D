import { boxTransform, boxUnionBatch } from '../../../sdk-core/src/index.ts';
import { boxEquals, boxGrow } from '../../../sdk-core/src/math/primitives/box.ts';
import { readHostBox } from '../host/boxBounds.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { SessionDeformation } from './session.ts';
import { noteDeformedBounds } from '../webgpu/pages/render/movedGeometry.ts';
import { refitBlendHierarchy } from '../webgpu/blend/hierarchy.ts';

const local = new Float64Array(6),
  before = new Float64Array(6);

/**
 * Whole-copy bounds use the same measured reach as clustered placements and dirty only their
 * region. A record that did not change can still be carried by its node (`worldsMoved`): a skin
 * palette, morph weights and soft sources are read in the mesh's own frame, so the box follows the
 * matrix too. A changed record dirties its region even inside the same box (its surface moved); a
 * carried one only when its box changed. The transparent tree is refit to the boxes rewritten,
 * unless a matrix moved: `refreshBlendBoxes` refits it that frame anyway.
 */
export function updateWholeDeformationBounds(
  rt: WebgpuPagesRuntime,
  deformation: SessionDeformation,
  worldsMoved: boolean,
) {
  let rewritten = false;
  for (const item of rt.blendState.blendGpu) {
    const box = item.deformBounds,
      source = item.sourceGeometry.boundingBox;
    const changed = deformation.changedOfWorld(item.matrix);
    if (!box || !source || !(worldsMoved || changed)) continue;
    before.set(box);
    readHostBox(local, source);
    boxGrow(local, 0, local, 0, deformation.reachOfWorld(item.matrix));
    boxTransform(box, 0, local, 0, item.matrix.elements);
    item.bounds = box;
    const same = boxEquals(box, 0, before, 0);
    if (!same) rewritten = true;
    else if (!changed) continue;
    boxUnionBatch(before, box, 1);
    noteDeformedBounds(rt, before);
  }
  if (rewritten && !worldsMoved) refitBlendHierarchy(rt.blendState);
}
