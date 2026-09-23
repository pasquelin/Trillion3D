// A cluster's world sphere went from an inline matrix × point product to `transformAffinePoint`:
// that formula never had a sum initialised to zero (see the note in `mathMatrix4.ts`), so no signed-
// zero regression is expected here, unlike matrix × matrix products. This test checks it on matrices
// and boxes hostile to signed zeros, against the previous code copied into
// `../../bench/oracles/browser/socle-math.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { noteResidenceChange } from './webgpuShadowBounds.ts';
import { createWebgpuLightState } from './webgpuPagesStateLights.ts';
import { referenceClusterSphere } from '../../bench/oracles/browser/socle-math.ts';
import type { PageRec } from './pageSelectionTypes.ts';

function record(matrice: number[], min: number[], max: number[]) {
  return { matrix: new THREE.Matrix4().fromArray(matrice), min, max } as unknown as PageRec;
}
const CAS = [
  record([1, -0, 0, 0, 0, 1, -0, 0, -0, 0, 1, 0, -0, -0, -0, 1], [-0, -2, -0], [2, 0, 2]),
  record([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], [-3, -0, -3], [-0, 3, -0]),
  record([-1, 0, 0, 0, 0, -1, -0, 0, 0, 0, 1, 0, 0, -0, 0, 1], [0, 0, 0], [4, 4, 4]),
];

test('noteResidenceChange: matrices and boxes hostile to signed zeros — the bounding box stays identical to the previous code', () => {
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
    const lumieres = createWebgpuLightState();
    lumieres.store.add({
      id: 'l0',
      kind: 'point',
      position: [0, 0, 0],
      color: [1, 1, 1],
      intensity: 100,
      range: 20,
      castsShadow: true,
    });
    lumieres.plan.representationChanged = (min, max) => {
      recu = [...Array.from(min), ...Array.from(max)];
    };
    noteResidenceChange(lumieres, rec);
    assert.ok(recu, 'representationChanged must be called');
    for (let i = 0; i < 6; i++)
      assert.ok(Object.is(attendu[i], recu![i]), `composante ${i} : ${attendu[i]} ≠ ${recu![i]}`);
  }
});
