import type * as THREE from 'three';
import { BOX_VALUES, MATRIX_VALUES, boxEmpty, boxTransform, boxUnion } from '../sdk-core/index.ts';
import { lotBoxesReady, unionLotBoxes } from './mathBatchBoxes.ts';
import { createBoxTransformLot, type BoxTransformLot } from './mathBatchRuntime.ts';
import { resolveHostSubtree } from './hostWorldMatrices.ts';

/**
 * Bornes monde d'un sous-arbre de l'hôte, calculées par le socle sur des boîtes à plat.
 *
 * C'est la règle de `Box3.setFromObject` de la référence, terme à terme : tout objet du sous-arbre
 * qui porte une géométrie donne sa boîte locale, transformée par sa matrice monde, et l'union des
 * huit coins est prise. Un objet qui tient sa propre boîte — les maillages instanciés — la préfère à
 * celle de sa géométrie, comme chez elle. La transformation et l'union sont celles de `mathBox.ts` :
 * les mêmes bits, boîtes vides, NaN et infinis compris.
 */

/** Une boîte à plat vide, prête pour une union : bornes basses à `+∞`, hautes à `−∞`. */
export function emptyWorldBox() {
  const box = new Float64Array(BOX_VALUES);
  boxEmpty(box, 0);
  return box;
}

/** Objet de l'hôte tel que la règle des bornes le lit : une géométrie, parfois sa propre boîte. */
type Bounded = THREE.Object3D & {
  geometry?: THREE.BufferGeometry;
  boundingBox?: THREE.Box3 | null;
  computeBoundingBox?: () => void;
};

/**
 * La boîte LOCALE que porte `object`, ou `undefined` s'il n'en a pas. Comme la référence, la boîte
 * de l'objet l'emporte sur celle de sa géométrie, et une boîte absente est calculée à la demande —
 * c'est une dérivée des sommets que l'hôte possède, pas une transformation.
 */
function localBoxOf(object: Bounded) {
  if (object.boundingBox !== undefined) {
    if (object.boundingBox === null) object.computeBoundingBox?.();
    return object.boundingBox ?? undefined;
  }
  const geometry = object.geometry;
  if (!geometry) return undefined;
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  return geometry.boundingBox ?? undefined;
}

const local = new Float64Array(BOX_VALUES);

/** Objets bornés du sous-arbre : la taille EXACTE que le lot de boîtes doit porter. */
function bornes(source: THREE.Object3D) {
  let n = 0;
  source.traverse((object) => {
    if (localBoxOf(object as Bounded)) n++;
  });
  return n;
}

/** Le lot qui porte les boîtes de ce sous-arbre, ou `null` quand il n'en a aucune. */
export async function hostBoundsLot(source: THREE.Object3D) {
  resolveHostSubtree(source);
  const n = bornes(source);
  return n ? await createBoxTransformLot(n) : null;
}

/**
 * Union des bornes monde de `source` et de sa descendance dans `into`, qui doit arriver vide ou
 * déjà commencée. Le sous-arbre est résolu une fois, au lieu d'un appel par objet. Quand `lot` porte
 * exactement ces boîtes, elles partent EN LOT par le gouverneur ; sinon chacune passe seule, par le
 * même `boxTransform` et sur les mêmes entrées.
 */
export function hostWorldBounds(
  source: THREE.Object3D,
  into = emptyWorldBox(),
  lot?: BoxTransformLot | null,
) {
  resolveHostSubtree(source);
  const enLot = lotBoxesReady(lot, bornes(source));
  let n = 0;
  source.traverse((object) => {
    const box = localBoxOf(object as Bounded);
    if (!box) return;
    const out = enLot ? enLot.boxes : local,
      at = enLot ? n * BOX_VALUES : 0;
    out[at] = box.min.x;
    out[at + 1] = box.min.y;
    out[at + 2] = box.min.z;
    out[at + 3] = box.max.x;
    out[at + 4] = box.max.y;
    out[at + 5] = box.max.z;
    if (enLot) {
      enLot.mats.set(object.matrixWorld.elements, n++ * MATRIX_VALUES);
      return;
    }
    boxTransform(local, 0, local, 0, object.matrixWorld.elements);
    boxUnion(into, 0, local[0], local[1], local[2], local[3], local[4], local[5]);
  });
  if (!enLot) return into;
  enLot.run();
  unionLotBoxes(into, enLot, n);
  return into;
}
