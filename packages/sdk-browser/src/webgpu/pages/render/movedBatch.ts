import { MOVE_PROMOTED } from '../../../placement/update.ts';
import {
  BOX_VALUES,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  boxUnionBatch,
} from '../../../../../sdk-core/src/index.ts';
import { moveRootRows } from './movedRoot.ts';
import { ascending, rootsUnder } from './movedNode.ts';
import { transformRootBoxes } from '../../../math/batchBoxes.ts';
import { grown } from '../../../../../sdk-core/src/math/transform-tree/transformTree.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

/**
 * What the nodes of one move call leave to do, done once for the call (#971, CPU-19): the moved
 * roots' boxes reprojected in one pass, their rows alone rewritten (`movedRoot.ts`), the scene
 * revision bumped once, then each node's motion box declared to the shadow scheduler as its own
 * call would — two nodes far apart are two boxes, never the room between them. A root under two
 * moved nodes is passed once, at the pose it ends at.
 *
 * No allocation per call: every list is reused, grown only by a call larger than any before it.
 */

const moved = new Float64Array(BOX_VALUES),
  movedMin = moved.subarray(0, 3),
  movedMax = moved.subarray(3, 6);
/** Ranks of the roots under each moved node, node after node, each node's increasing; where each
 *  node's ranks end; the distinct ranks, increasing; one node's. */
const movedList: number[] = [],
  movedEnds: number[] = [],
  distinct: number[] = [],
  under: number[] = [];
/** Each moved node's box before its move, `BOX_VALUES` per node; 1 for a root whose move in this
 *  call was its first. */
let movedBoxes = new Float64Array(BOX_VALUES),
  promotedRoots = new Uint8Array(0);
/** Below one moved root in this many, the moved boxes are transformed one by one rather than as
 *  the lot, which transforms every root: the same `boxTransform` yields the same bits. */
const LOT_SHARE = 8;

/** `node` was just posed: the roots whose mesh lies in its subtree — walked once, visited in
 *  increasing rank, as the loop over every root visited them — and their box before the move. */
export function noteMoved(rt: WebgpuPagesRuntime, node: Object3D) {
  const roots = rt.layout.selectionRoots;
  rootsUnder(roots, node, under);
  boxEmpty(moved, 0);
  for (const i of under) {
    movedList.push(i);
    const box = roots[i].worldBox;
    if (box) boxUnionBatch(moved, box, 1);
  }
  const at = movedEnds.length * BOX_VALUES;
  if (at + BOX_VALUES > movedBoxes.length)
    movedBoxes = grown(movedBoxes, Float64Array, movedBoxes.length * 2);
  movedBoxes.set(moved, at);
  movedEnds.push(movedList.length);
}

/** The pass over the roots the noted nodes moved, then each node's motion box; nothing if none.
 *  The lists are emptied even when the pass throws: a later call never inherits stale ranks. */
export function finishMoves(rt: WebgpuPagesRuntime) {
  if (!movedEnds.length) return;
  try {
    passMoves(rt);
  } finally {
    for (const i of distinct) promotedRoots[i] = 0;
    movedList.length = movedEnds.length = distinct.length = 0;
  }
}

function passMoves(rt: WebgpuPagesRuntime) {
  const { lights, run, layout } = rt,
    roots = layout.selectionRoots;
  for (const i of movedList) distinct.push(i);
  // One node's ranks are already increasing and distinct (`rootsUnder`); several may overlap.
  let count = distinct.length;
  if (movedEnds.length > 1) {
    distinct.sort(ascending);
    count = 0;
    for (let j = 0; j < distinct.length; j++)
      if (!count || distinct[count - 1] !== distinct[j]) distinct[count++] = distinct[j];
    distinct.length = count;
  }
  if (promotedRoots.length < roots.length) promotedRoots = new Uint8Array(roots.length);
  // World boxes of the moved roots reproject IN BATCH, through the governor, in the buffer
  // reserved at prepare. A missing or released buffer hands over to the box-by-box computation,
  // which yields the same bits — the same `boxTransform` on the same inputs.
  const lot = count * LOT_SHARE >= roots.length ? layout.rootBoxes : null;
  const enLot = !!lot && transformRootBoxes(lot, roots, distinct);
  for (const i of distinct) {
    const root = roots[i];
    moveRootRows(rt, root);
    if (!root.worldBox) continue;
    // A node moved: each root under it moved, at the pose it now reads.
    promotedRoots[i] = lights.mobility.move(i, root.world.elements, true) === MOVE_PROMOTED ? 1 : 0;
    if (root.localBox && !enLot)
      boxTransform(root.worldBox, 0, root.localBox, 0, root.world.elements);
  }
  // Origin of the scene change: these subtrees' world matrices have just been rewritten. Only
  // poses moved — no node entered or left the scene — so the watched set is left as it stands
  // instead of being rebuilt from a walk of the source graph on the next image.
  run.gate.sceneMoved();
  // The hierarchy already carries this revision's matrices: the next image does not climb it.
  run.gate.noteWorldsUpdated();
  let start = 0;
  for (let k = 0; k < movedEnds.length; k++) {
    for (let v = 0; v < BOX_VALUES; v++) moved[v] = movedBoxes[k * BOX_VALUES + v];
    let promoted = false;
    for (let j = start; j < movedEnds[k]; j++) {
      const root = roots[movedList[j]];
      if (!root.worldBox) continue;
      promoted = promotedRoots[movedList[j]] === 1 || promoted;
      if (root.localBox) boxUnionBatch(moved, root.worldBox, 1);
    }
    start = movedEnds[k];
    // A root's first move changes the static layer: the pages it crossed are staled whole.
    if (!boxIsEmpty(moved, 0)) lights.plan.worldChanged(movedMin, movedMax, !promoted);
  }
}
