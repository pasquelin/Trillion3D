// Batch M4a, bounds.ts: world bounds of a host subtree, checked bit-for-bit
// (Object.is) against Three's `Box3.setFromObject` (hence `expandByObject`), empty boxes and
// geometry without a mesh included.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { emptyWorldBox, hostWorldBounds } from './bounds.ts';
import { assertBits } from '../../../../../tests/kit/assert/bits.ts';
import * as G from '../graph/graph.fixture.ts';
import { threeGraph } from '../../../../../bench/witnesses/three/fromGraphNodes.ts';
import { threeGeometry } from '../../../../../bench/witnesses/three/fromGraph.ts';

/** The same box, flattened, as `Box3.setFromObject` computes it. */
function referenceBox(graph: G.GraphNode) {
  const source = threeGraph(graph);
  const box = new THREE.Box3().setFromObject(source);
  return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
}

/** Hostile subtree, depth 3: negative then non-uniform scale, two meshes. */
function hostileScene() {
  const racine = new G.GraphGroup();
  racine.scale.set(-2, 1, 1);
  const enfant = new G.GraphGroup();
  enfant.position.set(5, -5, 0);
  enfant.scale.set(1, 3, 0.001);
  racine.add(enfant);
  const geometrieA = G.boxGeometry(2, 2, 2);
  const meshA = G.mesh(geometrieA, G.basicSurface());
  meshA.position.set(1, 1, 1);
  enfant.add(meshA);
  const petitEnfant = new G.GraphGroup();
  petitEnfant.position.set(0, 0, 100);
  enfant.add(petitEnfant);
  const geometrieB = G.sphereGeometry(1);
  const meshB = G.mesh(geometrieB, G.basicSurface());
  meshB.position.set(-3, 2, -1);
  petitEnfant.add(meshB);
  return racine;
}

test('hostWorldBounds agrees with Box3.setFromObject on a hostile subtree, depth 3', () => {
  const obtenu = hostWorldBounds(hostileScene());
  assertBits(obtenu, referenceBox(hostileScene()));
});

test('a subtree with no geometry at all returns an empty box, like Box3.setFromObject', () => {
  const source = new G.GraphGroup();
  source.add(new G.GraphGroup(), new G.GraphNode());
  const obtenu = hostWorldBounds(source);
  const attendu = new G.Box3().setFromObject(source);
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

test('geometry carried by a node that is not a mesh counts, like expandByObject', () => {
  const source = new G.GraphGroup();
  const nuage = Object.assign(new G.GraphNode(), { geometry: G.sphereGeometry(3) });
  nuage.position.set(10, -10, 10);
  source.add(nuage);
  // The reference reads a point cloud of the same geometry, the library's node carrying one.
  const temoin = new THREE.Points(threeGeometry(nuage.geometry), new THREE.PointsMaterial());
  temoin.position.set(10, -10, 10);
  const attendu = new THREE.Box3().setFromObject(new THREE.Group().add(temoin));
  assertBits(hostWorldBounds(source), [...attendu.min.toArray(), ...attendu.max.toArray()]);
});

test("an object's own box (object.boundingBox) wins over its geometry's, like expandByObject", () => {
  const source = new G.GraphGroup();
  const mesh: G.GraphMesh & { boundingBox?: G.Box3 | null } = G.mesh(
    G.boxGeometry(100, 100, 100),
    G.basicSurface(),
  );
  // Object box much smaller than its 100×100×100 geometry box.
  mesh.boundingBox = new G.Box3(new G.Vector3(-1, -1, -1), new G.Vector3(1, 1, 1));
  source.add(mesh);
  const obtenu = hostWorldBounds(source);
  // The library's copy carries no own box: the witness is given the same one.
  const temoin = threeGraph(source);
  Object.assign(temoin.children[0], {
    boundingBox: new THREE.Box3().setFromArray([-1, -1, -1, 1, 1, 1]),
  });
  const box = new THREE.Box3().setFromObject(temoin);
  assertBits(obtenu, [...box.min.toArray(), ...box.max.toArray()]);
  // Check the test is not empty: the small object box is indeed the one returned.
  assert.ok(obtenu[3] < 50, 'the geometry box (100×100×100) should not have been taken');
});

test('hostWorldBounds accumulates into an already started `into` instead of replacing it', () => {
  const into = new Float64Array(6);
  into.set([-1, -1, -1, 1, 1, 1]);
  const mesh = G.mesh(G.boxGeometry(1, 1, 1), G.basicSurface());
  mesh.position.set(50, 0, 0);
  const obtenu = hostWorldBounds(mesh, into);
  assert.equal(obtenu, into, 'the same buffer is returned');
  assert.ok(obtenu[3] > 40, 'the starting box is extended, not overwritten');
  assert.equal(obtenu[0], -1, 'the starting low bound is kept on x');
});
