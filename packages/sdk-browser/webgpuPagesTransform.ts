import type * as THREE from 'three';
import {
  BOX_VALUES,
  EngineError,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  boxUnion,
  decomposeMatrix4,
  determinantMatrix4,
  invertMatrix4,
  multiplyMatrix4,
} from '../sdk-core/index.ts';
import { assertFiniteTransform } from './hostWorldMatrices.ts';
import { hostWorldChainInto } from './hostWorldChain.ts';
import { copyElements, sameElements } from './matrixElements.ts';
import { invalidateOccluderHistory } from './webgpuPagesDrops.ts';
import { transformRootBoxes } from './mathBatchBoxes.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const local = new Float64Array(16),
  parentWorld = new Float64Array(16),
  parentInverse = new Float64Array(16),
  trs = new Float64Array(3),
  trsRotation = new Float64Array(4),
  trsScale = new Float64Array(3),
  movedMin = [0, 0, 0],
  movedMax = [0, 0, 0],
  moved = new Float64Array(BOX_VALUES);

/** The named node of the prepared scene, or `undefined`: the search is a walk, not an index. */
function findNode(source: THREE.Object3D, nodeName: string) {
  let found: THREE.Object3D | undefined;
  source.traverse((node) => {
    if (!found && node.name === nodeName) found = node;
  });
  return found;
}

/**
 * Moves a named node of the prepared scene (R8). The matrix is a column-major world matrix: it is
 * brought back into the parent's space, then set as-is as the local matrix, so that
 * `updateMatrixWorld` finds it identical. World boxes of the moved primitives are reprojected,
 * occluder history is dropped, and the motion box is declared to the shadow scheduler — slices of
 * lamps whose range touches this box become candidates again.
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
  copyElements(local, matrix);
  if (node.parent) {
    // The requested pose is a WORLD pose: bringing it back into the parent's space needs the
    // parent's world matrix, and the host is allowed to have written a local pose above without
    // climbing the graph. The engine therefore COMPUTES it itself, from the local poses of the
    // ancestor chain (`hostWorldChain.ts`), asking nothing of the host and writing nothing to it.
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
  boxEmpty(moved, 0);
  for (const root of layout.selectionRoots)
    if (root.worldBox && isUnder(root.pages[0]?.sourceMesh, node)) unionInto(root.worldBox);
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
  node.matrix.fromArray(local);
  node.matrixAutoUpdate = false;
  // The pose is set: the engine index takes it, and every matrix it holds — page records,
  // selection roots, transparent copies — carries the new place at that instant, with no snapshot
  // to retake. The host scene, itself, is not climbed: the engine no longer reads its world
  // matrices.
  setup.worlds.refresh();
  // World boxes of the moved roots reproject IN BATCH, through the governor, in the buffer
  // reserved at prepare. A missing or released buffer hands over to the box-by-box computation,
  // which yields the same bits — the same `boxTransform` on the same inputs.
  const enLot =
    !!layout.rootBoxes &&
    transformRootBoxes(layout.rootBoxes, layout.selectionRoots, (root) =>
      isUnder(root.pages[0]?.sourceMesh, node),
    );
  for (const root of layout.selectionRoots) {
    if (!root.localBox || !root.worldBox || !isUnder(root.pages[0]?.sourceMesh, node)) continue;
    if (!enLot) boxTransform(root.worldBox, 0, root.localBox, 0, root.world.elements);
    unionInto(root.worldBox);
  }
  layout.rows.tableEpoch++;
  // Origin of the scene change: this subtree's world matrices have just been rewritten.
  run.gate.sceneChanged();
  // The hierarchy already carries this revision's matrices: the next image does not climb it.
  run.gate.noteWorldsUpdated();
  invalidateOccluderHistory(run);
  if (boxIsEmpty(moved, 0)) return;
  for (let axis = 0; axis < 3; axis++) {
    movedMin[axis] = moved[axis];
    movedMax[axis] = moved[axis + 3];
  }
  lights.plan.worldChanged(movedMin, movedMax);
}

/** Adds a world box to the motion box. */
function unionInto(box: Float64Array) {
  boxUnion(moved, 0, box[0], box[1], box[2], box[3], box[4], box[5]);
}

/** True when `mesh` is the moved node or one of its descendants. */
function isUnder(mesh: THREE.Object3D | undefined, node: THREE.Object3D) {
  let walk: THREE.Object3D | null = mesh ?? null;
  while (walk) {
    if (walk === node) return true;
    walk = walk.parent;
  }
  return false;
}
