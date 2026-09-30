import { MOVE_PROMOTED } from '../../../placement/update.ts';
import {
  BOX_VALUES,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  boxUnionBatch,
} from '../../../../../sdk-core/src/index.ts';
import { boxGrow } from '../../../../../sdk-core/src/math/primitives/box.ts';
import { staleTemporalBox } from '../../../hiz/staleRegions.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/**
 * Geometry that moves in place — rewritten vertices, a GPU deformation —, declared as a node's
 * move (`movedBatch.ts`): one world box to the shadow scheduler and the Hi-Z, its pages whole on
 * the first move of what it holds.
 */

const moved = new Float64Array(BOX_VALUES),
  movedMin = moved.subarray(0, 3),
  movedMax = moved.subarray(3, 6);

/** Root `rank` moved: whether it was its first move, the static shadow layer's to leave it out. */
const promote = (rt: WebgpuPagesRuntime, rank: number) =>
  rt.lights.mobility.move(rank, rt.layout.selectionRoots[rank].world.elements, true) ===
  MOVE_PROMOTED;
/** `moved` declared to the shadow scheduler and the Hi-Z: a first move stales its pages whole. */
function declare(rt: WebgpuPagesRuntime, promoted: boolean) {
  if (boxIsEmpty(moved, 0)) return;
  rt.lights.plan.worldChanged(movedMin, movedMax, !promoted);
  staleTemporalBox(rt.run.temporalHizState, movedMin, movedMax);
}

const local = new Float64Array(BOX_VALUES);
/** A dynamic geometry's rewrite, its moved vertices within `box`, declared as a node's move: each
 *  root drawing `attributes` moves, and the world box of `box` stales its shadow pages (#573). */
export function noteRewritten(rt: WebgpuPagesRuntime, attributes: object, box: Float64Array) {
  const roots = rt.layout.selectionRoots;
  let promoted = false;
  boxEmpty(moved, 0);
  for (let rank = 0; rank < roots.length; rank++) {
    const root = roots[rank];
    if (root.pages[0]?.attributes !== attributes) continue;
    promoted = promote(rt, rank) || promoted;
    boxTransform(local, 0, box, 0, root.world.elements);
    boxUnionBatch(moved, local, 1);
  }
  declare(rt, promoted);
}

/** Root `rank`'s GPU deformation moved (#357): it moves, and its rest world box grown by `reach`
 *  world units — the most it reached this frame or the last — stales its shadow pages. */
export function noteDeformed(rt: WebgpuPagesRuntime, rank: number, reach: number) {
  const box = rt.layout.selectionRoots[rank].worldBox;
  if (!box) return;
  boxGrow(moved, 0, box, 0, reach);
  declare(rt, promote(rt, rank));
}

/** A whole-copy deformation changed only this bounded world region. */
export function noteDeformedBounds(rt: WebgpuPagesRuntime, box: Float64Array) {
  moved.set(box);
  declare(rt, false);
}
