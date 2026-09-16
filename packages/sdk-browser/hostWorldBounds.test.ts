// Lot M4a, hostWorldBounds.ts : bornes monde d'un sous-arbre hôte, confrontées au bit près
// (Object.is) à `Box3.setFromObject` (donc `expandByObject`) de Three, boîtes vides et géométrie sans
// maillage comprises.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { emptyWorldBox, hostWorldBounds } from './hostWorldBounds.ts';
import { assertBits } from '../sdk-core/bench/oracles/volumes.mjs';

/** La même boîte, rendue à plat, telle que `Box3.setFromObject` la calcule. */
function referenceBox(source: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(source);
  return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
}

/** Sous-arbre hostile, profondeur 3 : échelle négative puis non uniforme, deux maillages. */
function hostileScene() {
  const racine = new THREE.Group();
  racine.scale.set(-2, 1, 1);
  const enfant = new THREE.Group();
  enfant.position.set(5, -5, 0);
  enfant.scale.set(1, 3, 0.001);
  racine.add(enfant);
  const geometrieA = new THREE.BoxGeometry(2, 2, 2);
  const meshA = new THREE.Mesh(geometrieA, new THREE.MeshBasicMaterial());
  meshA.position.set(1, 1, 1);
  enfant.add(meshA);
  const petitEnfant = new THREE.Group();
  petitEnfant.position.set(0, 0, 100);
  enfant.add(petitEnfant);
  const geometrieB = new THREE.SphereGeometry(1);
  const meshB = new THREE.Mesh(geometrieB, new THREE.MeshBasicMaterial());
  meshB.position.set(-3, 2, -1);
  petitEnfant.add(meshB);
  return racine;
}

test('hostWorldBounds s’accorde avec Box3.setFromObject sur un sous-arbre hostile, profondeur 3', () => {
  const obtenu = hostWorldBounds(hostileScene());
  assertBits(obtenu, referenceBox(hostileScene()));
});

test('un sous-arbre sans aucune géométrie rend une boîte vide, comme Box3.setFromObject', () => {
  const source = new THREE.Group();
  source.add(new THREE.Group(), new THREE.Object3D());
  const obtenu = hostWorldBounds(source);
  const attendu = new THREE.Box3().setFromObject(source);
  assert.ok(attendu.isEmpty(), 'la référence doit être vide pour que ce test ait un sens');
  assertBits(obtenu, [
    attendu.min.x,
    attendu.min.y,
    attendu.min.z,
    attendu.max.x,
    attendu.max.y,
    attendu.max.z,
  ]);
});

test('emptyWorldBox rend une boîte vide indépendante à chaque appel', () => {
  const a = emptyWorldBox(),
    b = emptyWorldBox();
  assert.notEqual(a, b, 'deux tampons distincts');
  assertBits(a, [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
});

test('une géométrie portée par un objet qui n’est pas un maillage (Points) compte, comme expandByObject', () => {
  const source = new THREE.Group();
  const nuage = new THREE.Points(new THREE.SphereGeometry(3), new THREE.PointsMaterial());
  nuage.position.set(10, -10, 10);
  source.add(nuage);
  assertBits(hostWorldBounds(source), referenceBox(source));
});

test('la boîte propre d’un objet (object.boundingBox) l’emporte sur celle de sa géométrie, comme expandByObject', () => {
  const source = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial());
  // Boîte d’objet bien plus petite que celle de sa géométrie de 100×100×100.
  mesh.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  source.add(mesh);
  const obtenu = hostWorldBounds(source);
  const attendu = referenceBox(source);
  assertBits(obtenu, attendu);
  // Vérifie que le test n’est pas vide : la petite boîte d’objet est bien celle qui est rendue.
  assert.ok(obtenu[3] < 50, 'la boîte de géométrie (100×100×100) n’aurait pas dû être prise');
});

test('hostWorldBounds accumule dans `into` déjà commencée au lieu de le remplacer', () => {
  const into = new Float64Array(6);
  into.set([-1, -1, -1, 1, 1, 1]);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.position.set(50, 0, 0);
  const obtenu = hostWorldBounds(mesh, into);
  assert.equal(obtenu, into, 'le même tampon est rendu');
  assert.ok(obtenu[3] > 40, 'la boîte de départ est étendue, pas écrasée');
  assert.equal(obtenu[0], -1, 'la borne basse de départ est conservée côté x');
});
