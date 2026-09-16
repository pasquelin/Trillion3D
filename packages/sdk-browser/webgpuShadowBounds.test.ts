// La sphère monde d'un cluster est passée d'un produit matrice × point écrit en ligne à
// `transformAffinePoint` : cette formule n'a jamais eu de somme initialisée à zéro (voir la note de
// `mathMatrix4.ts`), donc aucune régression de zéro signé n'est attendue ici, à la différence des
// produits matrice × matrice. Ce test le vérifie sur des matrices et des boîtes hostiles aux zéros
// signés, contre le code d'avant recopié dans `bench/oracles/socle-math.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { noteResidenceChange } from './webgpuShadowBounds.ts';
import { referenceClusterSphere } from './bench/oracles/socle-math.mjs';
import type { PageRec } from './pageSelectionTypes.ts';

function record(matrice: number[], min: number[], max: number[]) {
  return { matrix: new THREE.Matrix4().fromArray(matrice), min, max } as PageRec;
}
const CAS = [
  record([1, -0, 0, 0, 0, 1, -0, 0, -0, 0, 1, 0, -0, -0, -0, 1], [-0, -2, -0], [2, 0, 2]),
  record([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], [-3, -0, -3], [-0, 3, -0]),
  record([-1, 0, 0, 0, 0, -1, -0, 0, 0, 0, 1, 0, 0, -0, 0, 1], [0, 0, 0], [4, 4, 4]),
];

test("noteResidenceChange : matrices et boîtes hostiles aux zéros signés — la boîte englobante reste identique au code d'avant", () => {
  for (const rec of CAS) {
    const sphereAttendue = new Float32Array(4);
    referenceClusterSphere(rec, sphereAttendue, 0);
    const attendu = [
      sphereAttendue[0] - sphereAttendue[3],
      sphereAttendue[1] - sphereAttendue[3],
      sphereAttendue[2] - sphereAttendue[3],
      sphereAttendue[0] + sphereAttendue[3],
      sphereAttendue[1] + sphereAttendue[3],
      sphereAttendue[2] + sphereAttendue[3],
    ];
    let recu: number[] | undefined;
    noteResidenceChange(
      {
        store: { count: 1 },
        plan: { worldChanged: (min: number[], max: number[]) => (recu = [...min, ...max]) },
      } as Parameters<typeof noteResidenceChange>[0],
      rec,
    );
    assert.ok(recu, 'worldChanged doit être appelé');
    for (let i = 0; i < 6; i++)
      assert.ok(Object.is(attendu[i], recu![i]), `composante ${i} : ${attendu[i]} ≠ ${recu![i]}`);
  }
});
