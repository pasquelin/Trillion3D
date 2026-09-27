/**
 * The engine's graph draws the core's own `Mesh` and `InstancedMesh` (#874): a walk finds them,
 * the guards pick them out and nothing else, a pose write on one is heard by the hook, and a copy
 * keeps what the draw reads — the placements, their count, the morph weights and the creation
 * number a draw breaks ties with.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as G from './graph.fixture.ts';
import { meshes } from '../../scene/meshes.ts';
import { wholeMeshTriangles, type WholeMesh } from '../../cluster/batchMesh.ts';
import { hookHostNode } from '../scene/hooks.ts';

const placed = () => new G.InstancedMesh(G.boxGeometry(), G.basicSurface(), 4);

test('a walk of the graph draws the core mesh and instanced mesh, placements counted', () => {
  const root = new G.Group(),
    single = G.mesh(G.boxGeometry()),
    several = placed();
  several.count = 3;
  root.add(single, new G.Group().add(several), new G.Object3D());
  assert.deepEqual(meshes(root), [single, several], 'both drawn, in preorder, nothing else');
  assert.equal(wholeMeshTriangles(single as unknown as WholeMesh), 12);
  assert.equal(wholeMeshTriangles(several as unknown as WholeMesh), 36, 'once per placement');
});

test('the guards pick the core meshes, never a node that only looks like one', () => {
  const single = G.mesh(),
    several = placed();
  assert.ok(G.isDrawnNode(single) && G.isDrawnNode(several));
  assert.ok(!G.isInstancedNode(single) && G.isInstancedNode(several));
  const witness = new THREE.InstancedMesh(new THREE.BufferGeometry(), undefined, 1);
  for (const other of [witness, { kind: 'mesh' }, { kind: 'instancedMesh' }, new G.Group()])
    assert.ok(!G.isDrawnNode(other) && !G.isInstancedNode(other));
});

test('a pose write on a hooked core mesh is heard, as on any node of the graph', () => {
  for (const mesh of [G.mesh(), placed()]) {
    const revision = { revision: 0 };
    hookHostNode(mesh, revision);
    mesh.position.x = 2;
    assert.equal(revision.revision, 1);
  }
});

test('a copied instanced mesh keeps its placements, count, morph weights and draw order', () => {
  const geometry = G.boxGeometry();
  geometry.morphAttributes.position = [
    Object.assign(G.floatAttribute(new Float32Array(72), 3), { name: 'open' }),
  ];
  const light = new G.GraphLight('point'),
    source = new G.InstancedMesh(geometry, [G.basicSurface()], 2);
  assert.ok(light.serial < source.serial, 'one count of creation with the engine nodes');
  assert.deepEqual(source.morphTargetDictionary, { open: 0 });
  source.morphTargetInfluences![0] = 0.5;
  source.instanceMatrix.array.set([7], 16);
  source.count = 1;
  const copy = source.clone();
  assert.ok(copy instanceof G.InstancedMesh && copy.serial > source.serial);
  assert.equal(copy.geometry, geometry, 'the geometry shared');
  assert.notEqual(copy.material, source.material, 'the surface list its own');
  assert.equal(copy.instanceMatrix.array[16], 7);
  assert.equal(copy.count, 1);
  assert.deepEqual(copy.morphTargetInfluences, [0.5]);
  assert.equal(geometry._listeners.size, 0, 'a mesh in engine surfaces holds no listener');
});
