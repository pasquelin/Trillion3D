// Outils communs des tests et du banc des volumes (lot M2) : la boîte de Three.js bâtie depuis six
// flottants à plat et relue à plat, et la comparaison au bit près (`Object.is` sépare −0 de +0 et
// voit NaN). Three n'y sert qu'en référence, jamais dans un fichier `math*.ts`.
import assert from 'node:assert/strict';
import * as THREE from 'three';

/** Une `Box3` de Three.js depuis `[minX, minY, minZ, maxX, maxY, maxZ]`. */
export const boite3 = (b) =>
  new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));

/** Les bornes d'une `Box3` recopiées à plat, dans l'ordre de `boite3`. */
export const aPlat = (box) =>
  Float64Array.of(box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z);

/** Échoue au premier écart bit à bit entre deux suites de nombres de même longueur. */
export function assertBits(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++)
    assert.ok(
      Object.is(actual[i], expected[i]),
      `composante ${i} : ${actual[i]} !== ${expected[i]}`,
    );
}
