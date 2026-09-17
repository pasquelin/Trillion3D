import type * as THREE from 'three';
import {
  EngineError,
  POSITION_VALUES,
  QUATERNION_VALUES,
  composeMatrix4,
} from '../sdk-core/index.ts';
import { copyElements } from './matrixElements.ts';

/**
 * La frontière de lecture du graphe hôte.
 *
 * La scène appartient à l'hôte : c'est lui qui écrit les POSES LOCALES de ses nœuds. Ce qu'il en
 * compose ne regarde plus le moteur — les matrices monde dont le moteur a besoin sont les SIENNES,
 * calculées par le socle depuis ces poses locales : `hostWorldChain.ts` pour la chaîne d'ancêtres
 * d'un nœud, `hostWorldTree.ts` pour un sous-arbre entier.
 *
 * Il ne reste donc ici que deux gestes : LIRE la pose locale d'un nœud, et refuser une pose non
 * finie. Le seul appel de composition qui subsiste tient la scène de l'HÔTE à jour pour ses propres
 * lecteurs — la réplication (`replicateInstances.ts`) part des matrices monde qu'il porte ; aucun
 * nombre que le moteur dessine n'en sort, les siennes sont celles de `hostWorldPlacements.ts`. Le
 * test `test/integration/engineNoThreeMath.test.mjs` tient cette frontière.
 */

/** Le sous-arbre entier de `node` remis à jour DANS LA SCÈNE DE L'HÔTE, pour ses propres lecteurs. */
export function resolveHostSubtree(node: THREE.Object3D) {
  node.updateMatrixWorld(true);
}

const position = new Float64Array(POSITION_VALUES),
  rotation = new Float64Array(QUATERNION_VALUES),
  scale = new Float64Array(POSITION_VALUES);

/**
 * La matrice LOCALE de `node`, écrite dans `out`. C'est `updateMatrix` de la référence : un nœud qui
 * recompose rend le produit translation-rotation-échelle de sa pose, composé par le socle et aux
 * mêmes bits ; un nœud dont l'hôte a coupé la recomposition rend la matrice qu'il a posée, telle
 * quelle. Rien de la bibliothèque hôte n'est appelé — les dix nombres de la pose sont LUS.
 */
export function hostLocalInto(out: Float64Array, node: THREE.Object3D) {
  if (!node.matrixAutoUpdate) {
    copyElements(out, node.matrix.elements);
    return out;
  }
  const { position: p, quaternion: q, scale: s } = node;
  position[0] = p.x;
  position[1] = p.y;
  position[2] = p.z;
  rotation[0] = q.x;
  rotation[1] = q.y;
  rotation[2] = q.z;
  rotation[3] = q.w;
  scale[0] = s.x;
  scale[1] = s.y;
  scale[2] = s.z;
  return composeMatrix4(out, position, rotation, scale);
}

/**
 * Refuse une pose dont l'un des seize nombres n'est pas fini. Une transformation NaN ou infinie ne
 * se transporte dans aucune normale : le noyau d'inverse-transposée la verrait par sa somme non
 * finie et rendrait le vecteur nul, donc une surface éteinte sans que personne sache pourquoi.
 * Elle est donc refusée à l'ENTRÉE — au chargement (`explorerScene.ts`) et à chaque pose demandée
 * (`webgpuPagesTransform.ts`) —, avec le nom du nœud et le rang fautif. C'est le cas 4 de la
 * convention des normales singulières, écrite dans `inverseTransposeWgsl.ts` ; les cas 1 à 3 y
 * répondent par un calcul, celui-ci par un refus.
 */
export function assertFiniteTransform(elements: ArrayLike<number>, nodeName: string) {
  for (let index = 0; index < 16; index++)
    if (!Number.isFinite(elements[index]))
      throw new EngineError('NON_FINITE_TRANSFORM', `${nodeName}: matrice non finie`, {
        nodeName,
        index,
        value: elements[index],
      });
}
