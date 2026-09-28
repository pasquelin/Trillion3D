import { MOVE_PROMOTED } from '../../../placement/update.ts';
import {
  BOX_VALUES,
  EngineError,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  boxUnionBatch,
} from '../../../../../sdk-core/src/index.ts';
import { moveRootRows } from './movedRoot.ts';
import { findNode, rootsUnder, underSource } from './movedNode.ts';
import { poseNode } from './movedPose.ts';
import { transformRootBoxes } from '../../../math/batchBoxes.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

const moved = new Float64Array(BOX_VALUES),
  movedMin = moved.subarray(0, 3),
  movedMax = moved.subarray(3, 6),
  request = new Float32Array(16);
/** The nodes a move names, reused: one call builds no array. Emptied after the move, so that a
 *  released scene is not kept alive by it. */
const one: Object3D[] = [];
/** Ranks of the roots under each moved node, node after node, each node's increasing; where each
 *  node's ranks end; the distinct ranks, increasing; one node's. All reused from call to call. */
const movedList: number[] = [],
  movedEnds: number[] = [],
  distinct: number[] = [],
  under: number[] = [];
/** Each moved node's box before its move, `BOX_VALUES` per node; 1 for a root whose move in this
 *  call was its first. Grown only by a call larger than every one before it. */
let movedBoxes = new Float64Array(BOX_VALUES),
  promotedRoots = new Uint8Array(0);
/** Below one moved root in this many, the moved boxes are transformed one by one rather than as
 *  the lot, which transforms every root: the same `boxTransform` yields the same bits. */
const LOT_SHARE = 8;
const ascending = (a: number, b: number) => a - b;

/**
 * Moves a named node of the prepared scene (R8): `setWebgpuTransforms` on that one node. The name
 * is looked up in the index of `movedNode.ts`; a host moving the same nodes frame after frame
 * resolves them once and hands them to `setWebgpuTransforms` instead.
 */
export function setWebgpuTransform(rt: WebgpuPagesRuntime, nodeName: string, matrix: Float32Array) {
  if (matrix.length !== 16)
    throw new EngineError('INVALID_TRANSFORM', `${nodeName}: sixteen floats expected`, {
      length: matrix.length,
    });
  const node = findNode(rt.setup.source, nodeName);
  if (!node)
    throw new EngineError(
      'UNKNOWN_SCENE_NODE',
      `node ${nodeName} missing from the prepared scene`,
      {
        nodeName,
      },
    );
  one[0] = node;
  try {
    setWebgpuTransforms(rt, one, matrix);
  } finally {
    one.length = 0;
  }
}

/**
 * Moves nodes of the prepared scene in one call (#971, CPU-19). `nodes` are handles the host holds
 * — nodes of the scene it prepared, no name looked up —, `matrices` their column-major WORLD poses,
 * sixteen floats per node, in the same order. Each node takes its pose exactly as its own call would,
 * in order, so a node reads the poses the nodes before it just set (`movedPose.ts`); only its subtree
 * is passed again. The rest is paid once for the call: the moved roots' boxes are reprojected in
 * one pass, their rows alone rewritten (`movedRoot.ts`), the scene revision bumped once, and each
 * node's motion box declared to the shadow scheduler — two nodes far apart are two boxes, never
 * the room between them. A refused node throws once the nodes before it took effect, as the same
 * calls one by one would.
 *
 * Nothing is drawn here: the moves take effect at the next image, with no per-image allocation.
 */
export function setWebgpuTransforms(
  rt: WebgpuPagesRuntime,
  nodes: readonly Object3D[],
  matrices: Float32Array,
) {
  if (matrices.length !== nodes.length * 16)
    throw new EngineError('INVALID_TRANSFORM', `${nodes.length} nodes: sixteen floats each`, {
      length: matrices.length,
    });
  const { setup, run, layout } = rt;
  // A host pose written in this same task is read before the engine's own write hides it: the
  // first move then passes the whole index, which leaves it current for every move after.
  let whole = run.gate.engineWriting();
  try {
    for (let k = 0; k < nodes.length; k++) {
      const node = nodes[k];
      // A handle outlives nothing: a node the host removed, or never prepared, is refused by name.
      if (!underSource(setup.source, node))
        throw new EngineError(
          'UNKNOWN_SCENE_NODE',
          `node ${node.name} missing from the prepared scene`,
          { nodeName: node.name },
        );
      for (let i = 0; i < 16; i++) request[i] = matrices[k * 16 + i];
      if (!poseNode(setup.worlds, node, request, !whole)) continue;
      // The moved roots are those whose mesh lies in the node's subtree, walked once, visited in
      // increasing rank, as the loop over every root visited them; their box is taken before.
      rootsUnder(layout.selectionRoots, node, under);
      boxEmpty(moved, 0);
      for (const i of under) {
        movedList.push(i);
        const box = layout.selectionRoots[i].worldBox;
        if (box) boxUnionBatch(moved, box, 1);
      }
      noteMovedBox();
      // The pose is set: the engine index takes it, and every matrix it holds carries the new
      // place at that instant. With no host write owed, only the moved subtree and its ancestors
      // have new inputs (`refreshFrom`); a matrix set by hand elsewhere is announced by the next
      // image's scan, whose walk runs first.
      if (whole) setup.worlds.refresh();
      else setup.worlds.refreshFrom(node);
      whole = false;
    }
  } finally {
    if (movedEnds.length) finishMoves(rt);
  }
}

/** The box in `moved` kept as the next moved node's, and where its roots end. */
function noteMovedBox() {
  const at = movedEnds.length * BOX_VALUES;
  if (at + BOX_VALUES > movedBoxes.length) {
    const grown = new Float64Array(movedBoxes.length * 2);
    grown.set(movedBoxes);
    movedBoxes = grown;
  }
  movedBoxes.set(moved, at);
  movedEnds.push(movedList.length);
}

/** One pass over the distinct moved roots, then each moved node's motion box. */
function finishMoves(rt: WebgpuPagesRuntime) {
  const { lights, run, layout } = rt,
    roots = layout.selectionRoots;
  for (const i of movedList) distinct.push(i);
  distinct.sort(ascending);
  let count = 0;
  for (let j = 0; j < distinct.length; j++)
    if (!count || distinct[count - 1] !== distinct[j]) distinct[count++] = distinct[j];
  distinct.length = count;
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
  for (const i of distinct) promotedRoots[i] = 0;
  movedList.length = movedEnds.length = distinct.length = 0;
}
