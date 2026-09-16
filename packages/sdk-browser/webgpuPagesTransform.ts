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
import { sameElements } from './matrixElements.ts';
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
  // Une pose non finie est refusée ici, avant toute inversion : plus loin elle deviendrait une
  // matrice monde NaN, puis une normale nulle, puis une surface noire sans cause lisible.
  assertFiniteTransform(matrix, nodeName);
  for (let i = 0; i < 16; i++) local[i] = matrix[i];
  if (node.parent) {
    // La pose demandée est une pose MONDE : la ramener dans le repère du parent demande la matrice
    // monde du parent, et l'hôte a le droit d'avoir écrit une pose locale au-dessus sans remonter
    // le graphe. Le moteur la CALCULE donc lui-même, depuis les poses locales de la chaîne
    // d'ancêtres (`hostWorldChain.ts`), sans rien demander ni écrire à l'hôte. Sans ce calcul,
    // l'inversion porterait sur un parent périmé — un enfant demandé à x = 3 sous un parent passé à
    // x = 10 finirait à x = 13 —, et la comparaison qui suit jugerait « sans effet » une demande
    // refaite après le déplacement du parent. Il précède donc l'inversion ET la décision.
    hostWorldChainInto(parentWorld, node.parent);
    // Un parent écrasé sur un plan ou une droite n'a pas d'inverse : le socle rendrait seize zéros
    // et le nœud partirait silencieusement à l'origine. Le déterminant est le seul test qui
    // distingue ce cas de la sortie, et il attrape aussi une matrice non finie.
    const parentDeterminant = determinantMatrix4(parentWorld);
    if (parentDeterminant === 0 || !Number.isFinite(parentDeterminant))
      throw new EngineError(
        'SINGULAR_PARENT_TRANSFORM',
        `${nodeName}: matrice monde du parent non inversible`,
        { nodeName, parentName: node.parent.name, determinant: parentDeterminant },
      );
    invertMatrix4(parentInverse, parentWorld);
    multiplyMatrix4(local, parentInverse, local);
  }
  // Une pose identique à celle que ce nœud porte déjà — et posée par ici, d'où `matrixAutoUpdate`
  // à faux — ne change aucune matrice monde : la déclarer changée périmerait des pages d'ombre et
  // refuserait l'image tenue pour un résultat identique au pixel près. L'écriture directe d'un
  // hôte laisse `node.matrix` différent et repasse donc par le chemin complet. `local` est exprimé
  // dans le repère du parent VENANT D'ÊTRE RÉSOLU : un parent déplacé donne un autre `local` pour
  // la même pose monde demandée, et la demande n'est donc pas jugée sans effet.
  if (!node.matrixAutoUpdate && sameElements(node.matrix.elements, local)) return;
  boxEmpty(moved, 0);
  for (const root of layout.selectionRoots)
    if (root.worldBox && isUnder(root.pages[0]?.sourceMesh, node)) unionInto(root.worldBox);
  // La matrice locale fait foi, pas les trois champs : toute matrice n'est pas un produit
  // translation-rotation-échelle. Un cisaillement — deux axes non orthogonaux, ce que produit une
  // échelle non uniforme sous une rotation — ne s'y décompose pas, et `updateMatrixWorld`
  // recomposerait `matrix` depuis `position`, `quaternion` et `scale` par-dessus celle posée ici,
  // laissant le moteur dessiner une autre transformation que celle demandée. Couper la
  // recomposition sur le seul nœud déplacé est ce qui la préserve intacte. La décomposition du
  // socle renseigne quand même les trois champs, aux mêmes bits que `Matrix4.decompose` : exacts
  // sans cisaillement et approchés sinon, pour qui les lit.
  decomposeMatrix4(local, trs, trsRotation, trsScale);
  node.position.set(trs[0], trs[1], trs[2]);
  node.quaternion.set(trsRotation[0], trsRotation[1], trsRotation[2], trsRotation[3]);
  node.scale.set(trsScale[0], trsScale[1], trsScale[2]);
  node.matrix.fromArray(local);
  node.matrixAutoUpdate = false;
  // La pose est posée : l'index du moteur la reprend, et toutes les matrices qu'il tient —  fiches
  // de page, racines de sélection, copies transparentes — portent la nouvelle place à l'instant
  // même, sans qu'aucune photo soit à reprendre. La scène de l'hôte, elle, n'est pas remontée : le
  // moteur ne lit plus ses matrices monde.
  setup.worlds.refresh();
  // Les boîtes monde des racines déplacées se reprojettent EN LOT, par le gouverneur, dans le tampon
  // réservé à la préparation. Un tampon absent ou rendu passe la main au calcul boîte par boîte, qui
  // rend les mêmes bits — le même `boxTransform` sur les mêmes entrées.
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
  // Origine du changement de scène : les matrices monde de ce sous-arbre viennent d'être réécrites.
  run.gate.sceneChanged();
  // La hiérarchie porte déjà les matrices de cette révision : l'image suivante ne la remonte pas.
  run.gate.noteWorldsUpdated();
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
