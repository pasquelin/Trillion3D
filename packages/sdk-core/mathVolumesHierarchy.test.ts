// Lot M2, cas parent/enfant : une vraie chaîne d'Object3D de Three.js (profondeur ≥ 3, échelle
// négative sur un axe, rotation parente sur échelle non uniforme) dont on prend `matrixWorld`, pour
// vérifier que nos volumes égalent Box3.applyMatrix4 / getBoundingSphere / Frustum.intersectsBox au
// bit près. Three n'est utilisé ici qu'en référence, jamais dans un fichier `math*.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  boxTransform,
  frustumExcludesBox,
  frustumPlanesFromMatrix,
  sphereFromBounds,
} from './index.ts';
import { assertBits } from './bench/oracles/volumes.mjs';

/** Chaîne racine → parent tourné à échelle non uniforme → enfant à échelle négative → petit-enfant. */
function chaineProfondeurQuatre() {
  const racine = new THREE.Object3D();
  racine.position.set(5, -3, 2);
  racine.rotation.set(0.2, 0.1, -0.3);
  racine.scale.set(1.5, 1.5, 1.5);

  const parent = new THREE.Object3D();
  parent.position.set(-2, 4, 1);
  parent.rotation.set(0.9, -1.2, 0.4); // rotation parente sur une échelle non uniforme
  parent.scale.set(3, 0.25, 1.7);
  racine.add(parent);

  const enfant = new THREE.Object3D();
  enfant.position.set(1, 1, -1);
  enfant.rotation.set(-0.5, 0.3, 0.6);
  enfant.scale.set(-1, 1, 1); // échelle négative sur un seul axe
  parent.add(enfant);

  const petitEnfant = new THREE.Object3D();
  petitEnfant.position.set(0.3, -0.6, 0.9);
  petitEnfant.scale.set(2, -0.5, -3); // échelle négative sur trois axes
  enfant.add(petitEnfant);

  racine.updateMatrixWorld(true);
  return { racine, parent, enfant, petitEnfant };
}

const boitesLocales = [
  [-1, -2, -3, 4, 5, 6],
  [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5],
  [0, 0, 0, 0, 0, 0], // ponctuelle
];

test('boxTransform sous chaque matrixWorld d’une chaîne de profondeur ≥ 3 égale Box3.applyMatrix4 au bit près', () => {
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

test('sphereFromBounds après la matrixWorld d’un petit-enfant égale getBoundingSphere au bit près', () => {
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

test('frustumExcludesBox pour une caméra posée dans la hiérarchie égale !Frustum.intersectsBox sur les boîtes monde des descendants', () => {
  const { racine, parent, enfant, petitEnfant } = chaineProfondeurQuatre();
  const camera = new THREE.PerspectiveCamera(45, 1.5, 0.3, 300);
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
  camera.position.set(2, 1, 6);
  camera.rotation.set(0.1, -0.4, 0);
  camera.updateProjectionMatrix();
  enfant.add(camera); // la caméra est elle-même un enfant de la chaîne
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
      assert.equal(obtenu, attenduExclue, `nœud ${noeud.id}, boîte ${b.join(',')}`);
    }
  }
});
