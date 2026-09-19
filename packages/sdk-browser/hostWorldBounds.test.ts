// Batch M4a, hostWorldBounds.ts: world bounds of a host subtree, checked bit-for-bit
// (Object.is) against Three's `Box3.setFromObject` (hence `expandByObject`), empty boxes and
// geometry without a mesh included.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { emptyWorldBox, hostWorldBounds } from './hostWorldBounds.ts';
import { assertBits } from '../sdk-core/bench/oracles/volumes.mjs';

/** The same box, flattened, as `Box3.setFromObject` computes it. */
function referenceBox(source: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(source);
  return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
}

/** Hostile subtree, depth 3: negative then non-uniform scale, two meshes. */
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

test('hostWorldBounds agrees with Box3.setFromObject on a hostile subtree, depth 3', () => {
  const obtenu = hostWorldBounds(hostileScene());
  assertBits(obtenu, referenceBox(hostileScene()));
});

test('a subtree with no geometry at all returns an empty box, like Box3.setFromObject', () => {
  const source = new THREE.Group();
  source.add(new THREE.Group(), new THREE.Object3D());
  const obtenu = hostWorldBounds(source);
  const attendu = new THREE.Box3().setFromObject(source);
  assert.ok(attendu.isEmpty(), 'the reference must be empty for this test to mean anything');
  assertBits(obtenu, [
    attendu.min.x,
    attendu.min.y,
    attendu.min.z,
    attendu.max.x,
    attendu.max.y,
    attendu.max.z,
  ]);
});

test('emptyWorldBox returns an independent empty box on every call', () => {
  const a = emptyWorldBox(),
    b = emptyWorldBox();
  assert.notEqual(a, b, 'two distinct buffers');
  assertBits(a, [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
});

test('geometry carried by a non-mesh object (Points) counts, like expandByObject', () => {
  const source = new THREE.Group();
  const nuage = new THREE.Points(new THREE.SphereGeometry(3), new THREE.PointsMaterial());
  nuage.position.set(10, -10, 10);
  source.add(nuage);
  assertBits(hostWorldBounds(source), referenceBox(source));
});

test("an object's own box (object.boundingBox) wins over its geometry's, like expandByObject", () => {
  const source = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial());
  // Object box much smaller than its 100×100×100 geometry box.
  mesh.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  source.add(mesh);
  const obtenu = hostWorldBounds(source);
  const attendu = referenceBox(source);
  assertBits(obtenu, attendu);
  // Check the test is not empty: the small object box is indeed the one returned.
  assert.ok(obtenu[3] < 50, 'the geometry box (100×100×100) should not have been taken');
});

test('hostWorldBounds accumulates into an already started `into` instead of replacing it', () => {
  const into = new Float64Array(6);
  into.set([-1, -1, -1, 1, 1, 1]);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.position.set(50, 0, 0);
  const obtenu = hostWorldBounds(mesh, into);
  assert.equal(obtenu, into, 'the same buffer is returned');
  assert.ok(obtenu[3] > 40, 'the starting box is extended, not overwritten');
  assert.equal(obtenu[0], -1, 'the starting low bound is kept on x');
});
