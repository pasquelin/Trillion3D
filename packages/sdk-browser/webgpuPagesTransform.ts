import * as THREE from 'three';
import {
  BOX_VALUES,
  EngineError,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  boxUnion,
} from '../sdk-core/index.ts';
import { invalidateOccluderHistory } from './webgpuPagesDrops.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const requested = new THREE.Matrix4(),
  parentInverse = new THREE.Matrix4(),
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
 * elle est ramenée dans le repère du parent, puis posée telle quelle comme matrice locale, pour que
 * `updateMatrixWorld` la retrouve à l'identique. Les boîtes monde des primitives déplacées sont
 * reprojetées, l'historique d'occulteurs est jeté, et la boîte du mouvement est déclarée à
 * l'ordonnanceur d'ombres — les tranches des lampes dont la portée touche cette boîte redeviennent
 * candidates.
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
  requested.fromArray(matrix as unknown as number[]);
  if (node.parent) {
    parentInverse.copy(node.parent.matrixWorld).invert();
    requested.premultiply(parentInverse);
  }
  // La matrice locale fait foi, pas les trois champs : toute matrice n'est pas un produit
  // translation-rotation-échelle. Un cisaillement — deux axes non orthogonaux, ce que produit une
  // échelle non uniforme sous une rotation — ne s'y décompose pas, et `updateMatrixWorld`
  // recomposerait `matrix` depuis `position`, `quaternion` et `scale` par-dessus celle posée ici,
  // laissant le moteur dessiner une autre transformation que celle demandée. Couper la
  // recomposition sur le seul nœud déplacé est ce qui la préserve intacte. `decompose` renseigne
  // quand même les trois champs, exacts sans cisaillement et approchés sinon, pour qui les lit.
  requested.decompose(node.position, node.quaternion, node.scale);
  node.matrix.copy(requested);
  node.matrixAutoUpdate = false;
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
