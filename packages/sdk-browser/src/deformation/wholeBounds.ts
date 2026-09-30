import { boxTransform, boxUnionBatch } from '../../../sdk-core/src/index.ts';
import { boxGrow } from '../../../sdk-core/src/math/primitives/box.ts';
import { readHostBox } from '../host/boxBounds.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { SessionDeformation } from './session.ts';
import { noteDeformedBounds } from '../webgpu/pages/render/movedBatch.ts';
import { refitBlendHierarchy } from '../webgpu/blend/hierarchy.ts';

const local = new Float64Array(6),
  before = new Float64Array(6);

function sameBox(a: ArrayLike<number>, b: ArrayLike<number>) {
  for (let i = 0; i < 6; i++) if (a[i] !== b[i]) return false;
  return true;
}
/**
 * Whole-copy bounds use the same measured reach as clustered placements and dirty only their
 * region. A record that did not change can still be carried by its node (`worldsMoved`): a skin
 * palette, morph weights and soft sources are read in the mesh's own frame, so the box follows the
 * matrix too; only a box that changed dirties its region. The transparent tree is refit to the
 * boxes rewritten, unless a matrix moved: `refreshBlendBoxes` refits it that frame anyway.
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
    if (!box || !source || !(worldsMoved || deformation.changedOfWorld(item.matrix))) continue;
    before.set(box);
    readHostBox(local, source);
    boxGrow(local, 0, local, 0, deformation.reachOfWorld(item.matrix));
    boxTransform(box, 0, local, 0, item.matrix.elements);
    item.bounds = box;
    if (sameBox(box, before)) continue;
    rewritten = true;
    boxUnionBatch(before, box, 1);
    noteDeformedBounds(rt, before);
  }
  if (rewritten && !worldsMoved) refitBlendHierarchy(rt.blendState);
}
