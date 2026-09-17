import type * as THREE from 'three';
import { BOX_VALUES, boxEmpty } from '../sdk-core/index.ts';
import { boxUnionCollector } from './mathBatchBoxes.ts';
import { createBoxTransformLot, type BoxTransformLot } from './mathBatchRuntime.ts';
import { hostWorldTree } from './hostWorldTree.ts';
import type { HierarchyLot } from './mathBatchHierarchy.ts';

/**
 * Bornes monde d'un sous-arbre de l'hôte, calculées par le socle sur des boîtes à plat.
 *
 * C'est la règle de `Box3.setFromObject` de la référence, terme à terme : tout objet du sous-arbre
 * qui porte une géométrie donne sa boîte locale, transformée par sa matrice monde, et l'union des
 * huit coins est prise. La matrice monde est celle que LE MOTEUR calcule depuis les poses locales de
 * l'hôte (`hostWorldTree.ts`), jamais celle que sa bibliothèque compose. Un objet qui tient sa propre boîte — les maillages instanciés — la préfère à
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
  const n = bornes(source);
  return n ? await createBoxTransformLot(n) : null;
}

/**
 * Union des bornes monde de `source` et de sa descendance dans `into`, qui doit arriver vide ou
 * déjà commencée. Les matrices monde du sous-arbre sont calculées une fois, en une passe : `worlds`
 * est le tampon de hiérarchie réservé pour lui, et sans lui la passe se fait sur l'arbre du socle.
 * Quand `lot` porte exactement ces boîtes, elles partent EN LOT par le gouverneur ; sinon chacune
 * passe seule, par le même `boxTransform` et sur les mêmes entrées.
 */
export function hostWorldBounds(
  source: THREE.Object3D,
  into = emptyWorldBox(),
  lot?: BoxTransformLot | null,
  worlds?: HierarchyLot | null,
) {
  const mondes = hostWorldTree(source, worlds);
  const union = boxUnionCollector(into, lot, bornes(source));
  source.traverse((object) => {
    const box = localBoxOf(object as Bounded);
    if (!box) return;
    const out = union.boxes,
      at = union.at;
    out[at] = box.min.x;
    out[at + 1] = box.min.y;
    out[at + 2] = box.min.z;
    out[at + 3] = box.max.x;
    out[at + 4] = box.max.y;
    out[at + 5] = box.max.z;
    union.pose(mondes.world(object));
  });
  return union.ferme();
}
