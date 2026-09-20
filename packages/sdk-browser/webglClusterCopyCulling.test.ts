import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createHostDrawCamera, readHostDrawCamera } from './cameraWorld.ts';
import { WebglClusterCopyCulling } from './webglClusterCopyCulling.ts';

const copyAt = (x: number, frustumCulled = true) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, -3, 1, -1, -3, 0, 1, -3], 3),
  );
  const copy = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  copy.frustumCulled = frustumCulled;
  copy.matrix.makeTranslation(x, 0, 0);
  return copy;
};

test('a scene copy outside the frustum is skipped unless it declares itself never culled', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10),
    culling = new WebglClusterCopyCulling();
  culling.begin(readHostDrawCamera(createHostDrawCamera(), camera));
  assert.equal(culling.visible(copyAt(0)), true);
  assert.equal(culling.visible(copyAt(100)), false);
  assert.equal(culling.visible(copyAt(100, false)), true, 'frustumCulled false always draws');
});
