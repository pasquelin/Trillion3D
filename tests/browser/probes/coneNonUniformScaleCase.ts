// The trigger case of cone rejection under a non-uniform transform at small scale, shared by the
// probe (`cone-non-uniform-scale.ts`) and the render proof of the same name: two real triangles at
// large local coordinates, placed by a scale (1e-8, 1e-6, 1e-6), their face visible and large.
import * as THREE from 'three';
import { triangleCone } from '../../../packages/sdk-browser/src/page/cone/cone.ts';

export function triggerCase() {
  const positions = [0, 0, 0, 1e6, 0, -1e6, 0, 1e6, 0, 0, 0, 0, -1e6, 0, -1e6, 0, -1e6, 0];
  const indices = [0, 1, 2, 3, 4, 5];
  const cone = triangleCone(positions, indices);
  const min = [-1e6, -1e6, -1e6],
    max = [1e6, 1e6, 0];
  const world = new THREE.Matrix4().makeScale(1e-8, 1e-6, 1e-6);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(6, 0, -9);
  camera.lookAt(0, 0, -0.5);
  camera.updateMatrixWorld(true);
  return { positions, indices, cone, min, max, world, camera };
}
