import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { replicateInstances } from '../../packages/sdk/browser.ts';
test('1/4/9/12 replicas share assets, preserve associations and extend real bounds', () => {
  const counts: readonly (1 | 4 | 9 | 12)[] = [1, 4, 9, 12];
  for (const count of counts) {
    const source = new THREE.Group(),
      geometry = new THREE.BoxGeometry(2, 1, 3),
      material = new THREE.MeshBasicMaterial(),
      mesh = new THREE.Mesh(geometry, material);
    source.add(mesh);
    const associations: Map<THREE.Object3D, { meshes: number; primitives: number }> = new Map([
        [mesh, { meshes: 7, primitives: 0 }],
      ]),
      grid = replicateInstances(source, associations, count),
      meshes: THREE.Mesh[] = [];
    grid.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
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
