import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { replicateInstances } from '@web-geometry/sdk/browser';
test('1/4/9/12 replicas share assets, preserve associations and extend real bounds', () => {
  for (const count of [1, 4, 9, 12]) {
    const source = new THREE.Group(),
      geometry = new THREE.BoxGeometry(2, 1, 3),
      material = new THREE.MeshBasicMaterial(),
      mesh = new THREE.Mesh(geometry, material);
    source.add(mesh);
    const associations = new Map([[mesh, { meshes: 7, primitives: 0 }]]),
      grid = replicateInstances(source, associations, count),
      meshes = [];
    grid.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    assert.equal(meshes.length, count);
    for (const copy of meshes) {
      assert.equal(copy.geometry, geometry);
      assert.equal(copy.material, material);
      assert.deepEqual(associations.get(copy), { meshes: 7, primitives: 0 });
    }
    const size = new THREE.Box3().setFromObject(grid).getSize(new THREE.Vector3()),
      columns = count === 12 ? 4 : Math.sqrt(count),
      rows = count === 12 ? 3 : Math.sqrt(count);
    assert.equal(size.x, 2 * columns);
    assert.equal(size.z, 3 * rows);
    geometry.dispose();
    material.dispose();
  }
});
