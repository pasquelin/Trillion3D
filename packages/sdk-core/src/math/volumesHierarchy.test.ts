// Batch M2, parent/child cases: a real Three.js Object3D chain (depth ≥ 3, negative
// scale on one axis, parent rotation on non-uniform scale) whose `matrixWorld` we take, to
// check that our volumes match Box3.applyMatrix4 / getBoundingSphere / Frustum.intersectsBox
// bit-exact. Three is used here only as a reference, never in a `math*.ts` file.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  boxTransform,
  frustumExcludesBox,
  frustumPlanesFromMatrix,
  sphereFromBounds,
} from '../index.ts';
import { assertBits } from '../../../../tests/kit/assert/bits.ts';

/** Chain root → rotated parent with non-uniform scale → child with negative scale → grandchild. */
function chaineProfondeurQuatre() {
  const racine = new THREE.Object3D();
  racine.position.set(5, -3, 2);
  racine.rotation.set(0.2, 0.1, -0.3);
  racine.scale.set(1.5, 1.5, 1.5);

  const parent = new THREE.Object3D();
  parent.position.set(-2, 4, 1);
  parent.rotation.set(0.9, -1.2, 0.4); // parent rotation on a non-uniform scale
  parent.scale.set(3, 0.25, 1.7);
  racine.add(parent);

  const enfant = new THREE.Object3D();
  enfant.position.set(1, 1, -1);
  enfant.rotation.set(-0.5, 0.3, 0.6);
  enfant.scale.set(-1, 1, 1); // negative scale on a single axis
  parent.add(enfant);

  const petitEnfant = new THREE.Object3D();
  petitEnfant.position.set(0.3, -0.6, 0.9);
  petitEnfant.scale.set(2, -0.5, -3); // negative scale on three axes
  enfant.add(petitEnfant);

  racine.updateMatrixWorld(true);
  return { racine, parent, enfant, petitEnfant };
}

const boitesLocales = [
  [-1, -2, -3, 4, 5, 6],
  [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5],
  [0, 0, 0, 0, 0, 0], // ponctuelle
];

test('boxTransform under each matrixWorld of a depth ≥ 3 chain equals Box3.applyMatrix4 bit-exact', () => {
  const { parent, enfant, petitEnfant } = chaineProfondeurQuatre();
  for (const noeud of [parent, enfant, petitEnfant]) {
    assert.ok(noeud.matrixWorld.elements.some((v) => v !== 0));
    for (const b of boitesLocales) {
      const attendu = new THREE.Box3(
        new THREE.Vector3(b[0], b[1], b[2]),
        new THREE.Vector3(b[3], b[4], b[5]),
      ).applyMatrix4(noeud.matrixWorld);
      const obtenu = new Float64Array(6);
      boxTransform(obtenu, 0, b, 0, noeud.matrixWorld.elements);
      assertBits(
        obtenu,
        Float64Array.of(
          attendu.min.x,
          attendu.min.y,
          attendu.min.z,
          attendu.max.x,
          attendu.max.y,
          attendu.max.z,
        ),
      );
    }
  }
});

test('sphereFromBounds after a grandchild matrixWorld equals getBoundingSphere bit-exact', () => {
  const { petitEnfant } = chaineProfondeurQuatre();
  for (const b of boitesLocales) {
    const boxThree = new THREE.Box3(
      new THREE.Vector3(b[0], b[1], b[2]),
      new THREE.Vector3(b[3], b[4], b[5]),
    ).applyMatrix4(petitEnfant.matrixWorld);
    const sphereAttendue = boxThree.getBoundingSphere(new THREE.Sphere());

    const boiteMonde = new Float64Array(6);
    boxTransform(boiteMonde, 0, b, 0, petitEnfant.matrixWorld.elements);
    const obtenu = new Float64Array(4);
    sphereFromBounds(
      obtenu,
      0,
      boiteMonde[0],
      boiteMonde[1],
      boiteMonde[2],
      boiteMonde[3],
      boiteMonde[4],
      boiteMonde[5],
    );
    assertBits(
      obtenu,
      Float64Array.of(
        sphereAttendue.center.x,
        sphereAttendue.center.y,
        sphereAttendue.center.z,
        sphereAttendue.radius,
      ),
    );
  }
});

test('frustumExcludesBox for a camera posed in the hierarchy equals !Frustum.intersectsBox on descendant world boxes', () => {
  const { racine, parent, enfant, petitEnfant } = chaineProfondeurQuatre();
  const camera = new THREE.PerspectiveCamera(45, 1.5, 0.3, 300);
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
  camera.position.set(2, 1, 6);
  camera.rotation.set(0.1, -0.4, 0);
  camera.updateProjectionMatrix();
  enfant.add(camera); // the camera is itself a child of the chain
  racine.updateMatrixWorld(true);

  const vp = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const tronc = new THREE.Frustum().setFromProjectionMatrix(vp, THREE.WebGPUCoordinateSystem);
  const plans = new Float64Array(24);
  frustumPlanesFromMatrix(plans, vp.elements);

  for (const noeud of [parent, enfant, petitEnfant]) {
    for (const b of boitesLocales) {
      const monde = new THREE.Box3(
        new THREE.Vector3(b[0], b[1], b[2]),
        new THREE.Vector3(b[3], b[4], b[5]),
      ).applyMatrix4(noeud.matrixWorld);
      const attenduExclue = !tronc.intersectsBox(monde);
      const obtenu = frustumExcludesBox(
        plans,
        monde.min.x,
        monde.min.y,
        monde.min.z,
        monde.max.x,
        monde.max.y,
        monde.max.z,
      );
      assert.equal(obtenu, attenduExclue, `node ${noeud.id}, box ${b.join(',')}`);
    }
  }
});
