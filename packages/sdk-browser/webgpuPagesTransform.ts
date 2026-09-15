import * as THREE from 'three';
import {
  BOX_VALUES,
  EngineError,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  boxUnion,
  decomposeMatrix4,
  invertMatrix4,
  multiplyMatrix4,
} from '../sdk-core/index.ts';
import { invalidateOccluderHistory } from './webgpuPagesDrops.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const requested = new THREE.Matrix4(),
  parentInverse = new Float64Array(16),
  trs = new Float64Array(3),
  trsRotation = new Float64Array(4),
  trsScale = new Float64Array(3),
  movedMin = [0, 0, 0],
  movedMax = [0, 0, 0],
  moved = new Float64Array(BOX_VALUES);

/** Le nœud nommé de la scène préparée, ou `undefined` : la recherche est un parcours, pas un index. */
function findNode(source: THREE.Object3D, nodeName: string) {
  let found: THREE.Object3D | undefined;
  source.traverse((node) => {
    if (!found && node.name === nodeName) found = node;
  });
  return found;
}

/**
 * Déplace un nœud nommé de la scène préparée (R8). La matrice est une matrice monde colonne-major :
 * elle est ramenée dans le repère du parent, puis décomposée, pour que `updateMatrixWorld` la
 * retrouve à l'identique. Les boîtes monde des primitives déplacées sont reprojetées, l'historique
 * d'occulteurs est jeté, et la boîte du mouvement est déclarée à l'ordonnanceur d'ombres — les
 * tranches des lampes dont la portée touche cette boîte redeviennent candidates.
 *
 * Rien n'est dessiné ici : le déplacement prend effet à l'image suivante, sans allocation par image.
 */
export function setWebgpuTransform(rt: WebgpuPagesRuntime, nodeName: string, matrix: Float32Array) {
  const { setup, lights, run, layout } = rt;
  if (matrix.length !== 16)
    throw new EngineError('INVALID_TRANSFORM', `${nodeName}: seize flottants attendus`, {
      length: matrix.length,
    });
  const node = findNode(setup.source, nodeName);
  if (!node)
    throw new EngineError('UNKNOWN_SCENE_NODE', `nœud ${nodeName} absent de la scène préparée`, {
      nodeName,
    });
  boxEmpty(moved, 0);
  for (const root of layout.selectionRoots)
    if (root.worldBox && isUnder(root.pages[0]?.sourceMesh, node)) unionInto(root.worldBox);
  const local = requested.fromArray(matrix as unknown as number[]).elements;
  if (node.parent) {
    invertMatrix4(parentInverse, node.parent.matrixWorld.elements);
    multiplyMatrix4(local, parentInverse, local);
  }
  decomposeMatrix4(local, trs, trsRotation, trsScale);
  node.position.set(trs[0], trs[1], trs[2]);
  node.quaternion.set(trsRotation[0], trsRotation[1], trsRotation[2], trsRotation[3]);
  node.scale.set(trsScale[0], trsScale[1], trsScale[2]);
  node.matrix.copy(requested);
  setup.source.updateMatrixWorld(true);
  for (const root of layout.selectionRoots) {
    if (!root.localBox || !root.worldBox || !isUnder(root.pages[0]?.sourceMesh, node)) continue;
    boxTransform(root.worldBox, 0, root.localBox, 0, root.world.elements);
    unionInto(root.worldBox);
  }
  layout.rows.tableEpoch++;
  invalidateOccluderHistory(run);
  if (boxIsEmpty(moved, 0)) return;
  for (let axis = 0; axis < 3; axis++) {
    movedMin[axis] = moved[axis];
    movedMax[axis] = moved[axis + 3];
  }
  lights.plan.worldChanged(movedMin, movedMax);
}

/** Ajoute une boîte monde à la boîte du mouvement. */
function unionInto(box: Float64Array) {
  boxUnion(moved, 0, box[0], box[1], box[2], box[3], box[4], box[5]);
}

/** Vrai quand `mesh` est le nœud déplacé ou l'un de ses descendants. */
function isUnder(mesh: THREE.Object3D | undefined, node: THREE.Object3D) {
  let walk: THREE.Object3D | null = mesh ?? null;
  while (walk) {
    if (walk === node) return true;
    walk = walk.parent;
  }
  return false;
}
