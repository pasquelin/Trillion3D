import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createHostDrawCamera, readHostDrawCamera } from './cameraWorld.ts';
import { WebglClusterCopies } from './webglClusterCopyCulling.ts';

const copyAt = (x: number, frustumCulled = true, material = new THREE.MeshBasicMaterial()) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, -3, 1, -1, -3, 0, 1, -3], 3),
  );
  const copy = new THREE.Mesh(geometry, material);
  copy.frustumCulled = frustumCulled;
  copy.matrix.makeTranslation(x, 0, 0);
  return copy;
};

test('a scene copy outside the frustum is skipped unless it declares itself never culled, and each kept copy takes the pass its material asks for', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10),
    copies = new WebglClusterCopies<THREE.Mesh>(),
    glass = new THREE.MeshPhysicalMaterial({ transmission: 1 }),
    inView = copyAt(0),
    away = copyAt(100),
    neverCulled = copyAt(100, false),
    glassInView = copyAt(0, true, glass),
    glassAway = copyAt(100, true, glass);
  copies.cull(
    [inView, away, neverCulled, glassInView, glassAway],
    readHostDrawCamera(createHostDrawCamera(), camera),
  );
  assert.deepEqual(copies.plain, [inView, neverCulled], 'frustumCulled false always draws');
  assert.deepEqual(copies.transmissive, [glassInView]);
  // The painted glass of a diagnostic mode no longer transmits: it draws as a whole mesh.
  glassInView.material = new THREE.MeshBasicMaterial();
  copies.cull([glassInView], readHostDrawCamera(createHostDrawCamera(), camera));
  assert.deepEqual([copies.plain, copies.transmissive], [[glassInView], []]);
});
