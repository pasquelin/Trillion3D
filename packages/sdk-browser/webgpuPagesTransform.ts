import * as THREE from 'three';
import { EngineError } from '../sdk-core/index.ts';
import { invalidateOccluderHistory } from './webgpuPagesDrops.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const requested = new THREE.Matrix4(),
  parentInverse = new THREE.Matrix4(),
  movedMin = [0, 0, 0],
  movedMax = [0, 0, 0],
  moved = new THREE.Box3();

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
  moved.makeEmpty();
  for (const root of layout.opaqueRoots)
    if (root.worldBox && isUnder(root.pages[0]?.sourceMesh, node)) moved.union(root.worldBox);
  requested.fromArray(matrix as unknown as number[]);
  if (node.parent) {
    parentInverse.copy(node.parent.matrixWorld).invert();
    requested.premultiply(parentInverse);
  }
  requested.decompose(node.position, node.quaternion, node.scale);
  node.matrix.copy(requested);
  setup.source.updateMatrixWorld(true);
  for (const root of layout.opaqueRoots) {
    if (!root.localBox || !root.worldBox || !isUnder(root.pages[0]?.sourceMesh, node)) continue;
    root.worldBox.copy(root.localBox).applyMatrix4(root.world);
    moved.union(root.worldBox);
  }
  layout.rows.tableEpoch++;
  invalidateOccluderHistory(run);
  if (moved.isEmpty()) return;
  moved.min.toArray(movedMin);
  moved.max.toArray(movedMax);
  lights.plan.worldChanged(movedMin, movedMax);
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
