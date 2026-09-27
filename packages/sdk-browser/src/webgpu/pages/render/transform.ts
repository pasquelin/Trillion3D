import { MOVE_PROMOTED } from '../../../placement/update.ts';
import {
  BOX_VALUES,
  EngineError,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  decomposeMatrix4,
  determinantMatrix4,
  invertMatrix4,
  multiplyMatrix4,
  boxUnionBatch,
} from '../../../../../sdk-core/src/index.ts';
import { assertFiniteTransform } from '../../../host/world/matrices.ts';
import { hostWorldChainInto } from '../../../host/world/chain.ts';
import { copyElements, sameElements } from '../../../math/matrixElements.ts';
import { moveRootRows } from './movedRoot.ts';
import { findNode, rootsUnder } from './movedNode.ts';
import { transformRootBoxes } from '../../../math/batchBoxes.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

const local = new Float64Array(16),
  current = new Float64Array(16),
  parentWorld = new Float64Array(16),
  parentInverse = new Float64Array(16),
  trs = new Float64Array(3),
  trsRotation = new Float64Array(4),
  trsScale = new Float64Array(3),
  moved = new Float64Array(BOX_VALUES),
  movedMin = moved.subarray(0, 3),
  movedMax = moved.subarray(3, 6);
/** One flag per selection root: under the moved node or not. Grown once, never per move. */
let underNode = new Uint8Array(0);
/** Ranks of the roots under the moved node, increasing. Reused from move to move. */
const movedList: number[] = [];
/** Below one moved root in this many, the moved boxes are transformed one by one rather than as
 *  the lot, which transforms every root: the same `boxTransform` yields the same bits. */
const LOT_SHARE = 8;

/** True when `world`, rounded to single precision, is `matrix`. */
function standsAt(world: Float64Array, matrix: Float32Array) {
  for (let i = 0; i < 16; i++) if (Math.fround(world[i]) !== matrix[i]) return false;
  return true;
}

/**
 * Moves a named node of the prepared scene (R8). The matrix is a column-major world matrix: it is
 * brought back into the parent's space, then set as-is as the local matrix, so that
 * `updateMatrixWorld` finds it identical. World boxes of the moved primitives are reprojected,
 * their rows alone are rewritten (`movedRoot.ts`), and the motion box is declared to the shadow
 * scheduler — slices of lamps whose range touches this box become candidates again.
 *
 * Nothing is drawn here: the move takes effect at the next image, with no per-image allocation.
 */
export function setWebgpuTransform(rt: WebgpuPagesRuntime, nodeName: string, matrix: Float32Array) {
  const { setup, lights, run, layout } = rt;
  if (matrix.length !== 16)
    throw new EngineError('INVALID_TRANSFORM', `${nodeName}: sixteen floats expected`, {
      length: matrix.length,
    });
  const node = findNode(setup.source, nodeName);
  if (!node)
    throw new EngineError(
      'UNKNOWN_SCENE_NODE',
      `node ${nodeName} missing from the prepared scene`,
      {
        nodeName,
      },
    );
  // A non-finite pose is refused here, before any inversion: further on it would become a NaN
  // world matrix, then a null normal, then a black surface with no readable cause.
  assertFiniteTransform(matrix, nodeName);
  // The world the node already stands at, to the precision the request carries: moving it there
  // moves nothing — a node's first write included, which the local comparison below cannot judge.
  if (standsAt(hostWorldChainInto(current, node), matrix)) return;
  copyElements(local, matrix);
  if (node.parent) {
    // The requested pose is a WORLD pose: bringing it back into the parent's space needs the
    // parent's world matrix, and the host is allowed to have written a local pose above without
    // climbing the graph. The engine therefore COMPUTES it itself, from the local poses of the
    // ancestor chain (`../../../host/world/chain.ts`), asking nothing of the host and writing nothing to it.
    // Without that computation, inversion would bear on a stale parent — a child requested at
    // x = 3 under a parent that moved to x = 10 would end at x = 13 — and the comparison that
    // follows would judge "no effect" a request remade after the parent moved. It therefore
    // precedes inversion AND the decision.
    hostWorldChainInto(parentWorld, node.parent);
    // A parent flattened onto a plane or a line has no inverse: the base would yield sixteen
    // zeros and the node would silently leave for the origin. The determinant is the only test
    // that distinguishes this case from the exit, and it also catches a non-finite matrix.
    const parentDeterminant = determinantMatrix4(parentWorld);
    if (parentDeterminant === 0 || !Number.isFinite(parentDeterminant))
      throw new EngineError(
        'SINGULAR_PARENT_TRANSFORM',
        `${nodeName}: parent world matrix not invertible`,
        { nodeName, parentName: node.parent.name, determinant: parentDeterminant },
      );
    invertMatrix4(parentInverse, parentWorld);
    multiplyMatrix4(local, parentInverse, local);
  }
  // A pose identical to the one this node already carries — and set from here, hence
  // `matrixAutoUpdate` false — changes no world matrix: declaring it changed would invalidate
  // shadow pages and refuse the held image for a result identical to the pixel. A host's direct
  // write leaves `node.matrix` different and therefore takes the full path again. `local` is
  // expressed in the parent space JUST RESOLVED: a moved parent gives another `local` for the
  // same requested world pose, and the request is therefore not judged as no-effect.
  if (!node.matrixAutoUpdate && sameElements(node.matrix.elements, local)) return;
  // A host pose written in this same task is read before the engine's own write hides it.
  const hostPending = run.gate.engineWriting();
  // The moved roots are those whose mesh lies in the node's subtree: the subtree is walked once,
  // and the roots are visited in increasing rank, as the loop over every root visited them.
  const roots = layout.selectionRoots;
  if (underNode.length < roots.length) underNode = new Uint8Array(roots.length);
  underNode.fill(0, 0, roots.length);
  rootsUnder(roots, node, movedList);
  for (const i of movedList) underNode[i] = 1;
  boxEmpty(moved, 0);
  let promoted = false;
  for (const i of movedList) {
    const root = roots[i];
    if (!root.worldBox) continue;
    boxUnionBatch(moved, root.worldBox, 1);
  }
  // The local matrix is authoritative, not the three fields: not every matrix is a
  // translation-rotation-scale product. A shear — two non-orthogonal axes, which a non-uniform
  // scale under a rotation produces — does not decompose into it, and `updateMatrixWorld` would
  // recompose `matrix` from `position`, `quaternion` and `scale` over the one set here, leaving
  // the engine drawing another transform than the one requested. Cutting recomposition on the
  // moved node alone is what keeps it intact. The base's decompose still fills the three fields,
  // at the same bits as `Matrix4.decompose`: exact without shear and approximate otherwise, for
  // whoever reads them.
  decomposeMatrix4(local, trs, trsRotation, trsScale);
  node.position.set(trs[0], trs[1], trs[2]);
  node.quaternion.set(trsRotation[0], trsRotation[1], trsRotation[2], trsRotation[3]);
  node.scale.set(trsScale[0], trsScale[1], trsScale[2]);
  copyElements(node.matrix.elements, local);
  node.matrixAutoUpdate = false;
  // The pose is set: the engine index takes it, and every matrix it holds — page records,
  // selection roots, transparent copies — carries the new place at that instant, with no snapshot
  // to retake. The host scene, itself, is not climbed: the engine no longer reads its world
  // matrices.
  // With no hooked host pose unread, only the moved subtree and its ancestors can have new inputs,
  // and the pass on them alone yields the bits of the whole pass there (`refreshFrom`,
  // `../../../host/world/tree.ts`). A matrix the host set by hand elsewhere is no hooked write:
  // the next image's scan announces it, and its walk completes the index before anything draws.
  if (hostPending) setup.worlds.refresh();
  else setup.worlds.refreshFrom(node);
  // World boxes of the moved roots reproject IN BATCH, through the governor, in the buffer
  // reserved at prepare. A missing or released buffer hands over to the box-by-box computation,
  // which yields the same bits — the same `boxTransform` on the same inputs.
  const enLot =
    movedList.length * LOT_SHARE >= roots.length &&
    !!layout.rootBoxes &&
    transformRootBoxes(layout.rootBoxes, roots, underNode);
  for (const i of movedList) {
    const root = roots[i];
    moveRootRows(rt, root);
    if (!root.worldBox) continue;
    // A node moved: each root under it moved, at the pose it now reads.
    promoted = lights.mobility.move(i, root.world.elements, true) === MOVE_PROMOTED || promoted;
    if (!root.localBox) continue;
    if (!enLot) boxTransform(root.worldBox, 0, root.localBox, 0, root.world.elements);
    boxUnionBatch(moved, root.worldBox, 1);
  }
  // Origin of the scene change: this subtree's world matrices have just been rewritten. Only
  // poses moved — no node entered or left the scene — so the watched set is left as it stands
  // instead of being rebuilt from a walk of the source graph on the next image.
  run.gate.sceneMoved();
  // The hierarchy already carries this revision's matrices: the next image does not climb it.
  run.gate.noteWorldsUpdated();
  if (boxIsEmpty(moved, 0)) return;
  // A root's first move changes the static layer: the pages it crossed are staled whole.
  lights.plan.worldChanged(movedMin, movedMax, !promoted);
}
